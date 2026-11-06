import mongoose from 'mongoose';
import { configuration } from './config.js';
import { initializeModels } from './models.js';
import { createApp } from './app.js';

const config = configuration();
await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10000 });
await initializeModels();
// Billing transactions require a replica set; fail early instead of failing after charging a customer.
const hello = await mongoose.connection.db.admin().command({ hello: 1 });
if (!hello.setName)
  throw new Error('MongoDB must run as a replica set. Use the supplied Docker Compose setup.');
const { app, billing } = createApp(config);
const server = app.listen(config.port, config.host, () =>
  console.log(`Wifex API listening on http://${config.host}:${config.port}`),
);
const tick = setInterval(
  () => billing.tick().catch((error) => console.error('Billing worker:', error.message)),
  5000,
);
const poll = setInterval(
  () => billing.pollRouters().catch((error) => console.error('Router monitor:', error.message)),
  30000,
);
await billing.tick();
await billing.pollRouters();
async function stop() {
  clearInterval(tick);
  clearInterval(poll);
  server.close(async () => {
    await mongoose.disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 15000).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
