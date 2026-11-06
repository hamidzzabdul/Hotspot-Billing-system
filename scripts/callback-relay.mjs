import { fileURLToPath } from 'node:url';
import { callbackRelay } from '../backend/src/callback-relay.js';

process.loadEnvFile(fileURLToPath(new URL('../backend/.env', import.meta.url)));
const server = callbackRelay({ callbackSecret: process.env.PAYHERO_CALLBACK_SECRET });
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(4001, '127.0.0.1', () =>
  console.log(
    'Payment callback relay listening on 127.0.0.1:4001. App and admin routes are not exposed.',
  ),
);
process.on('SIGINT', () => server.close());
process.on('SIGTERM', () => server.close());
