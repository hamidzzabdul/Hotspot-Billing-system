// Persistent local installation. No sample data, test adapters, or payment simulation.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir, access, cp } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';
import mongoose from 'mongoose';
import { configuration } from '../backend/src/config.js';
import { createApp } from '../backend/src/app.js';
import { initializeModels, User } from '../backend/src/models.js';
import { seed } from '../backend/src/seed.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const local = path.join(root, '.local', 'live');
await mkdir(local, { recursive: true });
try {
  process.loadEnvFile(path.join(root, 'backend', '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const webPort = Number(process.env.WIFEX_WEB_PORT || 3001);
const apiPort = Number(process.env.PORT || 4000);
const origin = process.env.WIFEX_LOCAL_ORIGIN || `http://localhost:${webPort}`;
if (!['http:', 'https:'].includes(new URL(origin).protocol) || new URL(origin).origin !== origin)
  throw new Error('WIFEX_LOCAL_ORIGIN must be an origin without a trailing slash.');
for (const port of [webPort, apiPort]) {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', () =>
      reject(
        new Error(
          `Port ${port} is occupied. Stop the existing app before starting the local installation.`,
        ),
      ),
    );
    probe.listen(port, '0.0.0.0', () => probe.close(resolve));
  });
}
await access(path.join(root, 'frontend', '.next', 'BUILD_ID')).catch(() => {
  throw new Error('Run npm run build before npm run start:local.');
});
let encryptionKey = process.env.ENCRYPTION_KEY;
if (!encryptionKey) {
  const keyPath = path.join(local, 'encryption-key');
  try {
    encryptionKey = await readFile(keyPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    encryptionKey = randomBytes(32).toString('hex');
    await writeFile(keyPath, encryptionKey, { flag: 'wx', mode: 0o600 });
  }
}
// Use a separate database from any former preview installation.
const mongoUri =
  process.env.WIFEX_LOCAL_MONGODB_URI || 'mongodb://127.0.0.1:27019/wifex?replicaSet=wifex-local';
const config = configuration({
  ...process.env,
  NODE_ENV: 'development',
  APP_ORIGIN: origin,
  ENCRYPTION_KEY: encryptionKey,
  MONGODB_URI: mongoUri,
  ROUTER_MODE: 'live',
});
let database,
  web,
  server,
  tick,
  poll,
  stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  clearInterval(tick);
  clearInterval(poll);
  web?.kill();
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  database?.kill();
  process.exitCode = code;
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
try {
  if (!process.env.WIFEX_LOCAL_MONGODB_URI) {
    const cache = path.join(root, 'node_modules', '.cache', 'mongodb-memory-server');
    let binary = process.env.MONGOD_PATH;
    if (!binary && process.platform === 'win32') {
      const names = await readdir(cache).catch(() => []);
      const name = names.find((entry) => /^mongod.*\.exe$/.test(entry));
      if (name) binary = path.join(cache, name);
    }
    binary ||= 'mongod';
    const dbPath = path.join(local, 'mongo');
    await mkdir(dbPath, { recursive: true });
    database = spawn(
      binary,
      [
        '--port',
        '27019',
        '--bind_ip',
        '127.0.0.1',
        '--dbpath',
        dbPath,
        '--replSet',
        'wifex-local',
        '--logpath',
        path.join(local, 'mongo.log'),
        '--logappend',
      ],
      { windowsHide: true, stdio: 'ignore' },
    );
    let launchError;
    database.on('error', (error) => {
      launchError = error;
    });
    database.on('exit', () => {
      if (!stopping) launchError = new Error('MongoDB stopped. Inspect .local/live/mongo.log.');
    });
    let connection;
    for (let attempt = 0; attempt < 30; attempt++) {
      if (launchError) throw launchError;
      try {
        connection = await mongoose
          .createConnection('mongodb://127.0.0.1:27019/admin?directConnection=true', {
            serverSelectionTimeoutMS: 1000,
          })
          .asPromise();
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    if (!connection)
      throw new Error(
        'MongoDB did not start. Install MongoDB and set MONGOD_PATH, or set WIFEX_LOCAL_MONGODB_URI to a replica set.',
      );
    try {
      const hello = await connection.db.admin().command({ hello: 1 });
      if (!hello.setName)
        await connection.db.admin().command({
          replSetInitiate: { _id: 'wifex-local', members: [{ _id: 0, host: '127.0.0.1:27019' }] },
        });
    } finally {
      await connection.close();
    }
  }
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 30000 });
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName) throw new Error('The local database must be a replica set.');
  await initializeModels();
  if (!(await User.exists({ role: 'admin' }))) {
    const email = process.env.ADMIN_EMAIL || 'owner@wifex.local';
    const password = process.env.ADMIN_PASSWORD || randomBytes(24).toString('base64url') + '1a';
    const credentialPath = path.join(local, 'operator-credentials.json');
    // Write before creating the account so a failed disk write cannot lose the password.
    await writeFile(credentialPath, JSON.stringify({ email, password }, null, 2) + '\n', {
      mode: 0o600,
    });
    await seed({ email, password, name: process.env.ADMIN_NAME || 'WiFex owner' });
    console.log(`Your operator credentials are saved in ${credentialPath}`);
  }
  const created = createApp(config);
  server = created.app.listen(apiPort, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const run = () =>
    created.billing.tick().catch((error) => console.error('Billing:', error.message));
  tick = setInterval(run, 5000);
  poll = setInterval(
    () => created.billing.pollRouters().catch((error) => console.error('Router:', error.message)),
    30000,
  );
  await run();
  const standalone = path.join(root, 'frontend', '.next', 'standalone', 'frontend');
  await cp(path.join(root, 'frontend', 'public'), path.join(standalone, 'public'), {
    recursive: true,
  });
  await cp(
    path.join(root, 'frontend', '.next', 'static'),
    path.join(standalone, '.next', 'static'),
    { recursive: true },
  );
  const environment = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(webPort),
    HOSTNAME: '0.0.0.0',
  };
  for (const key of Object.keys(environment)) {
    if (
      key.startsWith('PAYHERO_') ||
      ['ENCRYPTION_KEY', 'ADMIN_PASSWORD', 'MONGODB_URI', 'WIFEX_LOCAL_MONGODB_URI'].includes(key)
    )
      delete environment[key];
  }
  web = spawn(process.execPath, [path.join(standalone, 'server.js')], {
    cwd: standalone,
    windowsHide: true,
    stdio: 'inherit',
    env: environment,
  });
  web.on('error', (error) => {
    console.error(error.message);
    void stop(1);
  });
  web.on('exit', () => {
    if (!stopping) void stop(1);
  });
  console.log(
    `WiFex: ${origin}\nOperator: ${origin}/admin\nDatabase: persistent local installation\nPayments: ${config.paymentMode}`,
  );
} catch (error) {
  console.error(error.message);
  await stop(1);
}
