import mongoose from 'mongoose';
const { Schema } = mongoose;
const ref = (model, extra = {}) => ({ type: Schema.Types.ObjectId, ref: model, ...extra });
const schema = (fields, options = {}) => new Schema(fields, { timestamps: true, ...options });
const userSchema = schema({
  name: { type: String, required: true },
  email: { type: String, lowercase: true, trim: true },
  phone: { type: String },
  password: { type: String, select: false },
  role: { type: String, enum: ['admin', 'customer'], default: 'customer' },
  blocked: { type: Boolean, default: false },
  guest: { type: Boolean, default: false },
  contactPhone: String,
});
userSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } },
);
userSchema.index(
  { phone: 1 },
  { unique: true, partialFilterExpression: { phone: { $type: 'string' } } },
);
export const User = mongoose.model('User', userSchema);
export const AuthSession = mongoose.model(
  'AuthSession',
  schema({
    tokenHash: { type: String, unique: true },
    user: ref('User'),
    expiresAt: { type: Date, index: { expireAfterSeconds: 0 } },
  }),
);
export const GuestSession = mongoose.model(
  'GuestSession',
  schema({
    tokenHash: { type: String, unique: true },
    user: ref('User'),
    expiresAt: { type: Date, index: { expireAfterSeconds: 0 } },
  }),
);
export const Plan = mongoose.model(
  'Plan',
  schema({
    name: String,
    description: String,
    price: Number,
    durationMinutes: Number,
    speedMbps: Number,
    active: { type: Boolean, default: true },
    popular: { type: Boolean, default: false },
  }),
);
export const Router = mongoose.model(
  'Router',
  schema({
    name: String,
    location: String,
    baseUrl: String,
    username: String,
    password: { type: String, select: false },
    loginUrl: String,
    enabled: { type: Boolean, default: true },
    status: { type: String, default: 'unknown' },
    lastChecked: Date,
    connected: { type: Number, default: 0 },
    uptime: String,
    error: String,
  }),
);
const paymentSchema = schema({
  user: ref('User', { required: true, index: true }),
  phone: String,
  reference: { type: String, unique: true },
  idempotencyKey: { type: String, unique: true },
  plan: ref('Plan'),
  planName: String,
  durationMinutes: Number,
  speedMbps: Number,
  router: ref('Router'),
  macAddress: String,
  amount: Number,
  kind: { type: String, enum: ['purchase', 'loan_repayment', 'verification'], default: 'purchase' },
  loan: ref('Loan'),
  status: {
    type: String,
    enum: ['initiating', 'pending', 'completed', 'failed', 'review'],
    default: 'initiating',
    index: true,
  },
  checkoutId: { type: String, unique: true, sparse: true },
  gateway: { type: String, enum: ['payhero', 'legacy'], default: 'legacy' },
  providerReference: { type: String, unique: true, sparse: true },
  merchantId: String,
  receipt: { type: String, unique: true, sparse: true },
  failureReason: String,
  paidAt: Date,
  nextVerificationAt: { type: Date, index: true },
  simulated: Boolean,
});
paymentSchema.index(
  { loan: 1 },
  {
    unique: true,
    partialFilterExpression: {
      kind: 'loan_repayment',
      status: { $in: ['initiating', 'pending', 'review', 'completed'] },
    },
  },
);
paymentSchema.index(
  { router: 1, macAddress: 1 },
  {
    unique: true,
    partialFilterExpression: {
      kind: 'purchase',
      status: { $in: ['initiating', 'pending', 'review'] },
    },
  },
);
export const Payment = mongoose.model('Payment', paymentSchema);
const accessSchema = schema({
  user: ref('User', { index: true }),
  payment: ref('Payment'),
  sourceKey: { type: String, unique: true },
  planName: String,
  durationMinutes: Number,
  speedMbps: Number,
  router: ref('Router'),
  macAddress: String,
  username: String,
  password: { type: String, select: false },
  status: {
    type: String,
    enum: ['queued', 'provisioning', 'active', 'revoking', 'expired', 'disconnected'],
    default: 'queued',
    index: true,
  },
  expiresAt: Date,
  startedAt: Date,
  connected: { type: Boolean, default: false },
  lastError: String,
  leaseUntil: Date,
  endReason: String,
});
accessSchema.index({ user: 1, createdAt: -1 });
export const Access = mongoose.model('Access', accessSchema);
export const Voucher = mongoose.model(
  'Voucher',
  schema({
    codeHash: { type: String, unique: true },
    prefix: String,
    plan: ref('Plan'),
    expiresAt: Date,
    status: { type: String, enum: ['available', 'redeemed', 'revoked'], default: 'available' },
    redeemedBy: ref('User'),
    redeemedAt: Date,
  }),
);
const loanSchema = schema({
  user: ref('User'),
  plan: ref('Plan'),
  planName: String,
  amount: Number,
  totalDue: Number,
  status: { type: String, enum: ['active', 'overdue', 'repaid'], default: 'active' },
  open: { type: Boolean, default: true },
  dueAt: Date,
  repaidAt: Date,
});
loanSchema.index({ user: 1 }, { unique: true, partialFilterExpression: { open: true } });
export const Loan = mongoose.model('Loan', loanSchema);
export const Ticket = mongoose.model(
  'Ticket',
  schema({
    user: ref('User'),
    subject: String,
    message: String,
    reference: String,
    status: { type: String, enum: ['open', 'in_progress', 'resolved'], default: 'open' },
    replies: [{ message: String, author: String, createdAt: { type: Date, default: Date.now } }],
  }),
);
export const Audit = mongoose.model(
  'Audit',
  schema({ actor: ref('User'), action: String, detail: String }),
);
export const CallbackEvent = mongoose.model(
  'CallbackEvent',
  schema({
    fingerprint: { type: String, unique: true },
    gateway: { type: String, enum: ['payhero', 'legacy'], default: 'legacy' },
    payload: Schema.Types.Mixed,
    status: { type: String, default: 'pending', index: true },
    attempts: { type: Number, default: 0 },
    nextAttempt: Date,
    lastError: String,
  }),
);
export const Settings = mongoose.model(
  'Settings',
  schema({
    key: { type: String, unique: true },
    businessName: { type: String, default: 'Wifex' },
    supportPhone: { type: String, default: '' },
    supportEmail: { type: String, default: '' },
    loansEnabled: { type: Boolean, default: false },
    loanInterestPercent: { type: Number, default: 10 },
    loanDueDays: { type: Number, default: 7 },
  }),
);
export async function initializeModels() {
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
}
