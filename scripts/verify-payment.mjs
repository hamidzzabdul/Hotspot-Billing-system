// Explicit, real KES 1 collection. Run only with the payer's authorization.
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { configuration } from '../backend/src/config.js';
import { User, Payment } from '../backend/src/models.js';
import { billingService } from '../backend/src/billing.js';
import { payheroClient } from '../backend/src/payhero.js';
import { routerClient } from '../backend/src/router.js';
import { phoneSchema } from '../backend/src/utils.js';

const root = new URL('../', import.meta.url);
process.loadEnvFile(fileURLToPath(new URL('backend/.env', root)));
const phone = phoneSchema.parse(process.argv[2]);
const config = configuration({ ...process.env, NODE_ENV: 'development' });
if (config.paymentMode !== 'live') throw new Error('Enable and configure live payments first.');
await mongoose.connect(
  process.env.WIFEX_LOCAL_MONGODB_URI || 'mongodb://127.0.0.1:27019/wifex?replicaSet=wifex-local',
);
try {
  const owner = await User.findOne({ role: 'admin', blocked: false });
  if (!owner) throw new Error('An owner account is required.');
  const recordPath = new URL('.local/live/payment-verification.json', root);
  await mkdir(new URL('.local/live/', root), { recursive: true });
  let record;
  try {
    record = JSON.parse(await readFile(recordPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (record && record.phone !== phone)
    throw new Error(
      'A payment verification already exists for a different number. Review it before requesting another.',
    );
  if (!record) {
    record = { phone, idempotencyKey: randomUUID() };
    await writeFile(recordPath, JSON.stringify(record, null, 2), { flag: 'wx', mode: 0o600 });
  }
  // A repeat invocation returns the existing payment and never sends another prompt.
  const service = billingService(config, payheroClient(config), routerClient(config));
  const payment = await service.initiate({
    user: owner,
    phone,
    verification: true,
    idempotencyKey: record.idempotencyKey,
  });
  await writeFile(
    recordPath,
    JSON.stringify(
      { ...record, paymentId: String(payment._id), reference: payment.reference },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  const current = await Payment.findById(payment._id);
  console.log(
    JSON.stringify({
      amount: current.amount,
      status: current.status,
      reference: current.reference,
      receipt: current.receipt || null,
    }),
  );
} finally {
  await mongoose.disconnect();
}
