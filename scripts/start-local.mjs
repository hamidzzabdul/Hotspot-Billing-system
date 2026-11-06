// Node reads NODE_EXTRA_CA_CERTS at process startup, before loadEnvFile runs.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
try {
  process.loadEnvFile(new URL('../backend/.env', import.meta.url));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const child = spawn(process.execPath, [fileURLToPath(new URL('./local.mjs', import.meta.url))], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
