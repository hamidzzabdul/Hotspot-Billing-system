import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { z } from 'zod';
import {
  User,
  AuthSession,
  GuestSession,
  Plan,
  Router,
  Payment,
  Access,
  Voucher,
  Loan,
  Ticket,
  Audit,
  Settings,
  CallbackEvent,
} from './models.js';
import {
  HttpError,
  hash,
  token,
  encrypt,
  decrypt,
  phoneSchema,
  macSchema,
  objectId,
  listing,
  searchFilter,
} from './utils.js';
import { payheroClient } from './payhero.js';
import { routerClient } from './router.js';
import { billingService, accessRecord } from './billing.js';

const authInput = z.object({
  identity: z.string().trim().min(1).max(150),
  password: z.string().min(1).max(128),
});
const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128)
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Use a password of at most 72 bytes')
  .regex(/[a-zA-Z]/, 'Include a letter')
  .regex(/\d/, 'Include a number');
const planInput = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().max(200).optional(),
  price: z.number().int().min(1).max(150000),
  durationMinutes: z.number().int().min(1).max(525600),
  speedMbps: z.number().min(0.5).max(1000),
  active: z.boolean().optional(),
  popular: z.boolean().optional(),
});
const routerInput = z.object({
  name: z.string().trim().min(2).max(70),
  location: z.string().max(120).optional(),
  baseUrl: z.url(),
  loginUrl: z.url(),
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});
function validateRouterUrls(input, config) {
  for (const field of ['baseUrl', 'loginUrl']) {
    if (!input[field]) continue;
    const url = new URL(input[field]);
    if (
      !['https:', ...(config.allowRouterHttp && !config.production ? ['http:'] : [])].includes(
        url.protocol,
      ) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new HttpError(400, 'Use a clean HTTPS router URL with a trusted certificate');
  }
  if (input.baseUrl && new URL(input.baseUrl).pathname !== '/')
    throw new HttpError(400, 'REST base URL must contain only the router origin');
}
const purchaseInput = z.object({
  planId: objectId,
  routerId: objectId,
  macAddress: macSchema,
  phone: phoneSchema,
  idempotencyKey: z.string().uuid(),
  expectedPrice: z.number().int().positive().optional(),
});
const viewUser = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role,
  blocked: user.blocked,
});
const id = (request) => objectId.parse(request.params.id);
const ensure = (value, message = 'Record not found') => {
  if (!value) throw new HttpError(404, message);
  return value;
};
export function createApp(config, overrides = {}) {
  const app = express();
  const routerApi = overrides.routers || routerClient(config);
  const billing = billingService(config, overrides.payments || payheroClient(config), routerApi);
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(
    helmet(),
    cors({ origin: config.origin, credentials: true }),
    express.json({ limit: '32kb' }),
    cookieParser(),
  );
  app.use(
    '/api',
    rateLimit({
      windowMs: 60000,
      limit: 240,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many requests. Try again in a minute.' },
    }),
  );
  // Cookie-authenticated writes must originate from this application; callback uses its own path secret.
  app.use('/api', (req, res, next) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      !req.path.startsWith('/payhero/callback/')
    ) {
      if (req.get('origin') !== config.origin)
        return res.status(403).json({ error: 'Request origin is not allowed' });
      if (!req.is('application/json'))
        return res.status(415).json({ error: 'Use application/json' });
    }
    next();
  });
  const api = express.Router();
  const authLimiter = rateLimit({
    windowMs: 15 * 60000,
    limit: 25,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many sign-in attempts. Try again later.' },
  });
  async function authenticate(req, res, next) {
    const value = req.cookies.wifex_session;
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value))
      throw new HttpError(401, 'Sign in to continue');
    const session = await AuthSession.findOne({
      tokenHash: hash(value),
      expiresAt: { $gt: new Date() },
    }).populate('user');
    if (!session?.user) throw new HttpError(401, 'Your session has expired. Sign in again.');
    req.user = session.user;
    if (req.user.blocked) throw new HttpError(403, 'This account is suspended. Contact support.');
    next();
  }
  const admin = (req, res, next) =>
    req.user.role === 'admin' ? next() : next(new HttpError(403, 'Administrator access required'));
  async function openSession(res, user) {
    const value = token();
    const expiresAt = new Date(Date.now() + config.sessionDays * 86400000);
    await AuthSession.create({ tokenHash: hash(value), user: user._id, expiresAt });
    res.cookie('wifex_session', value, {
      httpOnly: true,
      secure: config.production,
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
  }
  async function audit(req, action, detail) {
    await Audit.create({ actor: req.user._id, action, detail });
  }
  async function purchaseIdentity(req, res, create = false) {
    const buyers = [];
    const accountToken = req.cookies.wifex_session;
    if (typeof accountToken === 'string' && /^[a-f0-9]{64}$/i.test(accountToken)) {
      const session = await AuthSession.findOne({
        tokenHash: hash(accountToken),
        expiresAt: { $gt: new Date() },
      }).populate('user');
      if (session?.user) {
        if (session.user.blocked)
          throw new HttpError(403, 'This account is suspended. Contact support.');
        req.user = session.user;
        buyers.push(session.user._id);
      }
    }
    const guestToken = req.cookies.wifex_guest;
    if (typeof guestToken === 'string' && /^[a-f0-9]{64}$/i.test(guestToken)) {
      const session = await GuestSession.findOne({
        tokenHash: hash(guestToken),
        expiresAt: { $gt: new Date() },
      }).populate('user');
      if (session?.user) {
        if (session.user.blocked)
          throw new HttpError(403, 'This browser’s access is suspended. Contact support.');
        req.guest = session.user;
        buyers.push(session.user._id);
      }
    }
    if (!req.user && !req.guest && create) {
      const value = token();
      const expiresAt = new Date(Date.now() + 30 * 86400000);
      const guest = await User.create({ name: 'Walk-in customer', guest: true });
      await GuestSession.create({ tokenHash: hash(value), user: guest._id, expiresAt });
      res.cookie('wifex_guest', value, {
        httpOnly: true,
        secure: config.production,
        sameSite: 'lax',
        path: '/',
        expires: expiresAt,
      });
      req.guest = guest;
      buyers.push(guest._id);
    }
    req.buyerIds = buyers;
    return req.user || req.guest;
  }
  async function purchaseAccess(req, res, next) {
    await purchaseIdentity(req, res);
    if (!req.buyerIds.length)
      throw new HttpError(401, 'This browser no longer has access to that purchase');
    res.set('Cache-Control', 'no-store');
    next();
  }
  const purchaseOwner = (req) =>
    req.user?.role === 'admin' ? {} : { user: { $in: req.buyerIds } };
  const checkoutLimiter = rateLimit({
    windowMs: 15 * 60000,
    limit: 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many checkout attempts. Please try again later.' },
  });
  api.post('/checkout/session', checkoutLimiter, async (req, res) => {
    await purchaseIdentity(req, res, true);
    res.set('Cache-Control', 'no-store').json({ ready: true });
  });
  api.get('/health', (req, res) =>
    res
      .status(mongoose.connection.readyState === 1 ? 200 : 503)
      .json({ status: mongoose.connection.readyState === 1 ? 'ok' : 'unavailable' }),
  );
  api.get('/public/config', async (req, res) => {
    const settings = await Settings.findOne({ key: 'main' }).lean();
    res.json({
      businessName: settings?.businessName || 'Wifex',
      supportPhone: settings?.supportPhone || '',
      supportEmail: settings?.supportEmail || '',
      loansEnabled: settings?.loansEnabled || false,
      paymentMode: config.paymentMode,
      routerMode: config.routerMode,
    });
  });
  api.get('/public/plans', async (req, res) =>
    res.json(await Plan.find({ active: true }).sort({ price: 1 }).lean()),
  );
  api.post('/auth/register', authLimiter, async (req, res) => {
    const input = z
      .object({
        name: z.string().trim().min(2).max(80),
        phone: phoneSchema,
        password: passwordSchema,
      })
      .parse(req.body);
    const user = await User.create({ ...input, password: await bcrypt.hash(input.password, 12) });
    await openSession(res, user);
    res.status(201).json(viewUser(user));
  });
  api.post('/auth/login', authLimiter, async (req, res) => {
    const input = authInput.parse(req.body);
    const identity = input.identity.toLowerCase();
    const normalized = phoneSchema.safeParse(identity);
    const user = await User.findOne(
      normalized.success ? { phone: normalized.data } : { email: identity },
    ).select('+password');
    if (!user?.password || !(await bcrypt.compare(input.password, user.password)) || user.blocked)
      throw new HttpError(401, 'The credentials do not match an active account');
    await openSession(res, user);
    res.json(viewUser(user));
  });
  api.post('/auth/logout', async (req, res) => {
    if (typeof req.cookies.wifex_session === 'string')
      await AuthSession.deleteOne({ tokenHash: hash(req.cookies.wifex_session) });
    res
      .clearCookie('wifex_session', {
        httpOnly: true,
        secure: config.production,
        sameSite: 'lax',
        path: '/',
      })
      .json({ ok: true });
  });
  api.get('/auth/me', authenticate, (req, res) => res.json(viewUser(req.user)));
  api.post('/auth/password', authenticate, async (req, res) => {
    const input = z
      .object({ currentPassword: z.string().max(128), newPassword: passwordSchema })
      .parse(req.body);
    const user = await User.findById(req.user._id).select('+password');
    if (!(await bcrypt.compare(input.currentPassword, user.password || '')))
      throw new HttpError(400, 'Current password is incorrect');
    user.password = await bcrypt.hash(input.newPassword, 12);
    await user.save();
    await AuthSession.deleteMany({ user: user._id });
    await openSession(res, user);
    res.json({ ok: true });
  });
  api.post('/payments', checkoutLimiter, async (req, res) => {
    const input = purchaseInput.parse(req.body);
    if (config.paymentMode === 'disabled')
      throw new HttpError(503, 'M-Pesa payments are not configured yet');
    if (
      await User.exists({
        blocked: true,
        $or: [{ phone: input.phone }, { contactPhone: input.phone }],
      })
    )
      throw new HttpError(403, 'Payments from this number are suspended. Contact support.');
    const plan = ensure(
      await Plan.findOne({ _id: input.planId, active: true }),
      'This plan is no longer available',
    );
    if (input.expectedPrice !== undefined && input.expectedPrice !== plan.price)
      throw new HttpError(409, 'This plan’s price has changed. Refresh the page before paying.');
    const router = ensure(
      await Router.findOne({ _id: input.routerId, enabled: true }).select('+password'),
      'Choose an available hotspot',
    );
    const buyer = await purchaseIdentity(req, res, true);
    if (buyer.guest) await User.updateOne({ _id: buyer._id }, { contactPhone: input.phone });
    res.status(201).json(await billing.initiate({ ...input, user: buyer, plan, router }));
  });
  api.get('/payments/:id', purchaseAccess, async (req, res) => {
    const payment = ensure(
      await Payment.findOne({
        _id: id(req),
        ...purchaseOwner(req),
      }).lean(),
    );
    const access = await Access.findOne({ payment: payment._id })
      .select('status expiresAt lastError')
      .lean();
    res.json({ ...payment, access });
  });
  api.get('/payments/:id/credentials', purchaseAccess, async (req, res) => {
    const payment = ensure(
      await Payment.findOne({ _id: id(req), status: 'completed', ...purchaseOwner(req) }),
    );
    const access = ensure(
      await Access.findOne({
        payment: payment._id,
        status: 'active',
        expiresAt: { $gt: new Date() },
      })
        .select('+password')
        .populate('router'),
    );
    res.json({
      username: access.username,
      password: decrypt(access.password, config),
      loginUrl: access.router.loginUrl,
    });
  });
  api.post('/payhero/callback/:secret', async (req, res) => {
    if (config.paymentMode !== 'live' || hash(req.params.secret) !== hash(config.callbackSecret))
      throw new HttpError(404, 'Not found');
    const callback = req.body?.response;
    if (
      !callback ||
      typeof callback.CheckoutRequestID !== 'string' ||
      typeof callback.ExternalReference !== 'string' ||
      !Number.isInteger(callback.ResultCode)
    )
      throw new HttpError(400, 'Invalid callback');
    // Persist first: provider acknowledgement does not depend on router availability or callback ordering.
    await CallbackEvent.updateOne(
      { fingerprint: hash(JSON.stringify(req.body)) },
      { $setOnInsert: { payload: req.body, status: 'pending', gateway: 'payhero' } },
      { upsert: true },
    );
    res.json({ accepted: true });
  });
  api.get('/me/payments', authenticate, async (req, res) =>
    res.json(await listing(Payment, { user: req.user._id }, req.query)),
  );
  api.get('/me/sessions', authenticate, async (req, res) =>
    res.json(
      await listing(Access, { user: req.user._id }, req.query, {
        path: 'router',
        select: 'name location status',
      }),
    ),
  );
  api.get('/me/sessions/:id/credentials', authenticate, async (req, res) => {
    const access = ensure(
      await Access.findOne({
        _id: id(req),
        user: req.user._id,
        status: 'active',
        expiresAt: { $gt: new Date() },
      })
        .select('+password')
        .populate('router'),
    );
    res.set('Cache-Control', 'no-store').json({
      username: access.username,
      password: decrypt(access.password, config),
      loginUrl: access.router.loginUrl,
    });
  });
  api.post('/vouchers/redeem', checkoutLimiter, async (req, res) => {
    const input = z
      .object({ code: z.string().min(6).max(50), routerId: objectId, macAddress: macSchema })
      .parse(req.body);
    const router = ensure(
      await Router.findOne({ _id: input.routerId, enabled: true }).select('+password'),
    );
    await routerApi.validateDevice(router, input.macAddress);
    const buyer = await purchaseIdentity(req, res, true);
    let accessId;
    const transaction = await mongoose.startSession();
    try {
      await transaction.withTransaction(async () => {
        const voucher = await Voucher.findOneAndUpdate(
          {
            codeHash: hash(input.code.toUpperCase().replace(/\s/g, '')),
            status: 'available',
            expiresAt: { $gt: new Date() },
          },
          { status: 'redeemed', redeemedBy: buyer._id, redeemedAt: new Date() },
          { new: true, session: transaction },
        );
        if (!voucher) throw new HttpError(400, 'This voucher is invalid, expired, or already used');
        const plan = ensure(await Plan.findById(voucher.plan).session(transaction));
        const [access] = await Access.create(
          [
            accessRecord(
              {
                user: buyer._id,
                sourceKey: `voucher:${voucher._id}`,
                plan,
                router: router._id,
                macAddress: input.macAddress,
              },
              config,
            ),
          ],
          { session: transaction },
        );
        accessId = access._id;
      });
    } finally {
      await transaction.endSession();
    }
    res.set('Cache-Control', 'no-store').json({ accessId });
  });
  api.get('/access/:id', purchaseAccess, async (req, res) => {
    const access = ensure(
      await Access.findOne({ _id: id(req), ...purchaseOwner(req) }).populate(
        'router',
        'name location status',
      ),
    );
    res.json(access);
  });
  api.get('/access/:id/credentials', purchaseAccess, async (req, res) => {
    const access = ensure(
      await Access.findOne({
        _id: id(req),
        ...purchaseOwner(req),
        status: 'active',
        expiresAt: { $gt: new Date() },
      })
        .select('+password')
        .populate('router'),
    );
    res.json({
      username: access.username,
      password: decrypt(access.password, config),
      loginUrl: access.router.loginUrl,
    });
  });
  api.get('/me/loans', authenticate, async (req, res) => {
    const settings = await Settings.findOne({ key: 'main' });
    const loans = await Loan.find({ user: req.user._id }).sort({ createdAt: -1 }).lean();
    const recent = await Payment.exists({
      user: req.user._id,
      kind: 'purchase',
      status: 'completed',
      createdAt: { $gte: new Date(Date.now() - 7 * 86400000) },
    });
    const plan = await Plan.findOne({ active: true }).sort({ price: 1 });
    const eligible = Boolean(
      settings?.loansEnabled && recent && plan && !loans.some((loan) => loan.open),
    );
    res.json({
      loans,
      eligible,
      reason: !settings?.loansEnabled
        ? 'Internet credit is not enabled for this network.'
        : loans.some((l) => l.open)
          ? 'Repay your current credit before borrowing again.'
          : !recent
            ? 'Make a successful purchase within the last 7 days to qualify.'
            : `Borrow the entry plan and repay within ${settings.loanDueDays} days.`,
      plan,
      totalDue: plan ? Math.ceil(plan.price * (1 + (settings?.loanInterestPercent || 0) / 100)) : 0,
      dueDays: settings?.loanDueDays || 7,
    });
  });
  api.post('/me/loans', authenticate, async (req, res) => {
    const input = z
      .object({ routerId: objectId, macAddress: macSchema, acceptTerms: z.literal(true) })
      .parse(req.body);
    const settings = await Settings.findOne({ key: 'main' });
    if (!settings?.loansEnabled) throw new HttpError(403, 'Internet credit is disabled');
    const recent = await Payment.exists({
      user: req.user._id,
      kind: 'purchase',
      status: 'completed',
      createdAt: { $gte: new Date(Date.now() - 7 * 86400000) },
    });
    if (!recent) throw new HttpError(403, 'A successful purchase in the last 7 days is required');
    const plan = ensure(await Plan.findOne({ active: true }).sort({ price: 1 }));
    const router = ensure(
      await Router.findOne({ _id: input.routerId, enabled: true }).select('+password'),
    );
    await routerApi.validateDevice(router, input.macAddress);
    const transaction = await mongoose.startSession();
    try {
      await transaction.withTransaction(async () => {
        const [loan] = await Loan.create(
          [
            {
              user: req.user._id,
              plan: plan._id,
              planName: plan.name,
              amount: plan.price,
              totalDue: Math.ceil(plan.price * (1 + settings.loanInterestPercent / 100)),
              dueAt: new Date(Date.now() + settings.loanDueDays * 86400000),
            },
          ],
          { session: transaction },
        );
        await Access.create(
          [
            accessRecord(
              {
                user: req.user._id,
                sourceKey: `loan:${loan._id}`,
                plan,
                router: router._id,
                macAddress: input.macAddress,
              },
              config,
            ),
          ],
          { session: transaction },
        );
      });
    } finally {
      await transaction.endSession();
    }
    res.status(201).json({ ok: true });
  });
  api.post('/me/loans/:id/repay', authenticate, async (req, res) => {
    const input = z.object({ idempotencyKey: z.string().uuid() }).parse(req.body);
    const loan = ensure(await Loan.findOne({ _id: id(req), user: req.user._id, open: true }));
    res.status(201).json(
      await billing.initiate({
        user: req.user,
        phone: req.user.phone,
        idempotencyKey: input.idempotencyKey,
        loan,
      }),
    );
  });
  api.get('/me/tickets', authenticate, async (req, res) =>
    res.json(await listing(Ticket, { user: req.user._id }, req.query)),
  );
  api.post('/me/tickets', authenticate, async (req, res) => {
    const input = z
      .object({
        subject: z.string().trim().min(4).max(120),
        message: z.string().trim().min(10).max(2000),
        reference: z.string().max(80).default(''),
      })
      .parse(req.body);
    res.status(201).json(await Ticket.create({ ...input, user: req.user._id }));
  });
  api.post('/me/tickets/:id/replies', authenticate, async (req, res) => {
    const input = z.object({ message: z.string().trim().min(2).max(2000) }).parse(req.body);
    const ticket = ensure(await Ticket.findOne({ _id: id(req), user: req.user._id }));
    ticket.replies.push({ message: input.message, author: req.user.name });
    ticket.status = 'open';
    await ticket.save();
    res.status(201).json(ticket);
  });
  api.get('/payments/:id/receipt', purchaseAccess, async (req, res) => {
    const payment = ensure(
      await Payment.findOne({
        _id: id(req),
        status: 'completed',
        ...purchaseOwner(req),
      }).lean(),
    );
    const settings = await Settings.findOne({ key: 'main' });
    // Plain text receipt is a real downloadable artifact, rather than a nonexistent PDF URL.
    res
      .type('text/plain')
      .attachment(`${payment.reference}.txt`)
      .send(
        `${settings?.businessName || 'Wifex'}\nPAYMENT RECEIPT${payment.simulated ? ' — SIMULATED / NO MONEY CHARGED' : ''}\n\nReference: ${payment.reference}\nPayment receipt: ${payment.receipt}\nPhone: ${payment.phone}\nPlan: ${payment.planName || 'Internet credit repayment'}\nAmount: KES ${payment.amount}\nPaid: ${payment.paidAt.toISOString()}\n`,
      );
  });

  const management = express.Router();
  management.use(authenticate, admin);
  management.get('/overview', async (req, res) => {
    const days = Math.max(7, Math.min(90, Number(req.query.days) || 7));
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Nairobi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const start = new Date(`${today}T00:00:00+03:00`);
    start.setUTCDate(start.getUTCDate() - days + 1);
    const [
      revenue,
      customers,
      active,
      connected,
      pending,
      tickets,
      payments,
      routers,
      popular,
      activity,
      trend,
    ] = await Promise.all([
      Payment.aggregate([
        { $match: { status: 'completed', paidAt: { $gte: start } } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      User.countDocuments({ role: 'customer' }),
      Access.countDocuments({ status: 'active', expiresAt: { $gt: new Date() } }),
      Access.countDocuments({ connected: true, status: 'active' }),
      Payment.countDocuments({ status: { $in: ['pending', 'initiating', 'review'] } }),
      Ticket.countDocuments({ status: { $ne: 'resolved' } }),
      Payment.find().sort({ createdAt: -1 }).limit(6).populate('user', 'name').lean(),
      Router.find().select('-password').lean(),
      Payment.aggregate([
        { $match: { status: 'completed', kind: 'purchase', paidAt: { $gte: start } } },
        { $group: { _id: '$planName', sales: { $sum: 1 }, revenue: { $sum: '$amount' } } },
        { $sort: { sales: -1 } },
      ]),
      Audit.find().sort({ createdAt: -1 }).limit(5).populate('actor', 'name').lean(),
      Payment.aggregate([
        { $match: { status: 'completed', paidAt: { $gte: start } } },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$paidAt', timezone: 'Africa/Nairobi' },
            },
            revenue: { $sum: '$amount' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);
    res.json({
      revenue: revenue[0]?.total || 0,
      completedPayments: revenue[0]?.count || 0,
      customers,
      active,
      connected,
      pending,
      openTickets: tickets,
      payments,
      routers,
      popular,
      activity,
      trend,
      days,
      asOf: new Date().toISOString(),
      paymentMode: config.paymentMode,
      routerMode: config.routerMode,
    });
  });
  management.get('/plans', async (req, res) =>
    res.json(await Plan.find().sort({ price: 1 }).lean()),
  );
  management.post('/plans', async (req, res) => {
    const plan = await Plan.create(planInput.parse(req.body));
    await audit(req, 'plan.created', plan.name);
    res.status(201).json(plan);
  });
  management.patch('/plans/:id', async (req, res) => {
    const plan = ensure(
      await Plan.findByIdAndUpdate(id(req), planInput.partial().parse(req.body), {
        new: true,
        runValidators: true,
      }),
    );
    await audit(req, 'plan.updated', plan.name);
    res.json(plan);
  });
  management.get('/customers', async (req, res) =>
    res.json(
      await listing(
        User,
        {
          role: 'customer',
          ...searchFilter(req.query.search, ['name', 'phone']),
          ...(req.query.status === 'blocked'
            ? { blocked: true }
            : req.query.status === 'active'
              ? { blocked: false }
              : {}),
        },
        req.query,
      ),
    ),
  );
  management.post('/customers', async (req, res) => {
    const input = z
      .object({
        name: z.string().trim().min(2).max(80),
        phone: phoneSchema,
        password: passwordSchema,
      })
      .parse(req.body);
    const user = await User.create({ ...input, password: await bcrypt.hash(input.password, 12) });
    await audit(req, 'customer.created', user.name);
    res.status(201).json(viewUser(user));
  });
  management.patch('/customers/:id', async (req, res) => {
    const input = z.object({ blocked: z.boolean() }).parse(req.body);
    const user = ensure(
      await User.findOneAndUpdate({ _id: id(req), role: 'customer' }, input, { new: true }),
    );
    if (input.blocked) {
      await AuthSession.deleteMany({ user: user._id });
      await Access.updateMany(
        { user: user._id, status: { $in: ['queued', 'provisioning', 'active'] } },
        { status: 'revoking', endReason: 'blocked' },
      );
    }
    await audit(req, input.blocked ? 'customer.blocked' : 'customer.unblocked', user.name);
    res.json(viewUser(user));
  });
  management.get('/payments', async (req, res) =>
    res.json(
      await listing(
        Payment,
        {
          ...searchFilter(req.query.search, ['phone', 'reference', 'receipt']),
          ...(req.query.status && req.query.status !== 'all'
            ? { status: String(req.query.status) }
            : {}),
        },
        req.query,
        'user',
      ),
    ),
  );
  management.post('/payments/:id/reconcile', async (req, res) => {
    const payment = ensure(await Payment.findById(id(req)));
    const message = await billing.reconcile(payment);
    await audit(req, 'payment.reconciled', payment.reference);
    res.json({ message });
  });
  management.get('/sessions', async (req, res) =>
    res.json(
      await listing(
        Access,
        {
          ...searchFilter(req.query.search, ['macAddress', 'username', 'planName']),
          ...(req.query.status && req.query.status !== 'all'
            ? { status: String(req.query.status) }
            : {}),
        },
        req.query,
        'user router',
      ),
    ),
  );
  management.post('/sessions/:id/disconnect', async (req, res) => {
    const access = ensure(
      await Access.findOneAndUpdate(
        { _id: id(req), status: { $in: ['active', 'queued', 'provisioning'] } },
        { status: 'revoking', endReason: 'disconnected' },
        { new: true },
      ),
    );
    await audit(req, 'session.disconnected', access.macAddress);
    res.json(access);
  });
  management.get('/routers', async (req, res) => res.json(await Router.find().lean()));
  management.post('/routers', async (req, res) => {
    const input = routerInput.parse(req.body);
    validateRouterUrls(input, config);
    const router = await Router.create({ ...input, password: encrypt(input.password, config) });
    await audit(req, 'router.created', router.name);
    res.status(201).json({ ...router.toObject(), password: undefined });
  });
  management.patch('/routers/:id', async (req, res) => {
    const input = routerInput.partial().extend({ enabled: z.boolean().optional() }).parse(req.body);
    validateRouterUrls(input, config);
    if (
      input.enabled === false &&
      (await Access.exists({
        router: id(req),
        status: { $in: ['active', 'queued', 'provisioning', 'revoking'] },
      }))
    )
      throw new HttpError(
        409,
        'Disconnect all sessions and wait for revocation before disabling this router',
      );
    if (input.password) input.password = encrypt(input.password, config);
    const router = ensure(await Router.findByIdAndUpdate(id(req), input, { new: true }));
    await audit(req, 'router.updated', router.name);
    res.json(router);
  });
  management.post('/routers/:id/test', async (req, res) => {
    const router = ensure(await Router.findById(id(req)).select('+password'));
    try {
      const result = await routerApi.inspect(router);
      await Router.updateOne(
        { _id: router._id },
        {
          status: 'online',
          connected: result.connected,
          uptime: result.uptime,
          lastChecked: new Date(),
          error: '',
        },
      );
      res.json({
        message: `Router reachable. ${result.connected} devices connected.`,
      });
    } catch (error) {
      await Router.updateOne(
        { _id: router._id },
        { status: 'offline', lastChecked: new Date(), error: error.message },
      );
      throw error;
    }
  });
  management.get('/vouchers', async (req, res) =>
    res.json(await listing(Voucher, {}, req.query, 'plan redeemedBy')),
  );
  management.post('/vouchers', async (req, res) => {
    const input = z
      .object({
        planId: objectId,
        count: z.number().int().min(1).max(100),
        validityDays: z.number().int().min(1).max(365),
      })
      .parse(req.body);
    ensure(await Plan.findOne({ _id: input.planId, active: true }));
    const codes = Array.from(
      { length: input.count },
      () => `WF-${token().slice(0, 12).toUpperCase()}`,
    );
    await Voucher.insertMany(
      codes.map((code) => ({
        codeHash: hash(code),
        prefix: `${code.slice(0, 6)}…`,
        plan: input.planId,
        expiresAt: new Date(Date.now() + input.validityDays * 86400000),
      })),
    );
    await audit(req, 'vouchers.created', `${codes.length} vouchers`);
    res.status(201).json({ codes });
  });
  management.post('/vouchers/:id/revoke', async (req, res) =>
    res.json(
      ensure(
        await Voucher.findOneAndUpdate(
          { _id: id(req), status: 'available' },
          { status: 'revoked' },
          { new: true },
        ),
      ),
    ),
  );
  management.get('/loans', async (req, res) =>
    res.json(await listing(Loan, {}, req.query, 'user')),
  );
  management.get('/tickets', async (req, res) =>
    res.json(
      await listing(
        Ticket,
        {
          ...(req.query.status && req.query.status !== 'all'
            ? { status: String(req.query.status) }
            : {}),
        },
        req.query,
        'user',
      ),
    ),
  );
  management.patch('/tickets/:id', async (req, res) => {
    const input = z
      .object({
        status: z.enum(['open', 'in_progress', 'resolved']),
        reply: z.string().max(2000).optional(),
      })
      .parse(req.body);
    const ticket = ensure(await Ticket.findById(id(req)));
    ticket.status = input.status;
    if (input.reply?.trim())
      ticket.replies.push({ message: input.reply.trim(), author: req.user.name });
    await ticket.save();
    await audit(req, 'ticket.updated', ticket.subject);
    res.json(ticket);
  });
  management.get('/settings', async (req, res) =>
    res.json(await Settings.findOne({ key: 'main' }).lean()),
  );
  management.patch('/settings', async (req, res) => {
    const input = z
      .object({
        businessName: z.string().trim().min(2).max(60),
        supportPhone: z.string().max(30),
        supportEmail: z.union([z.email(), z.literal('')]),
        loansEnabled: z.boolean(),
        loanInterestPercent: z.number().min(0).max(30),
        loanDueDays: z.number().int().min(1).max(30),
      })
      .parse(req.body);
    const settings = await Settings.findOneAndUpdate({ key: 'main' }, input, {
      new: true,
      upsert: true,
    });
    await audit(req, 'settings.updated', 'Business and credit settings updated');
    res.json(settings);
  });
  management.get('/audit', async (req, res) =>
    res.json(await listing(Audit, {}, req.query, 'actor')),
  );
  api.use('/admin', management);
  app.use('/api', api);
  app.use((req, res) => res.status(404).json({ error: 'Endpoint not found' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof z.ZodError)
      return res.status(400).json({ error: error.issues[0]?.message || 'Invalid input' });
    if (error.code === 11000)
      return res
        .status(409)
        .json({ error: 'This record already exists, or an operation is already in progress' });
    const status = error.status || (error.name === 'CastError' ? 400 : 500);
    if (status >= 500)
      console.error(
        JSON.stringify({
          level: 'error',
          message: error.message,
          path: req.path.replace(/\/payhero\/callback\/.*/, '/payhero/callback/[redacted]'),
        }),
      );
    res.status(status).json({
      error: status === 500 ? 'An unexpected error occurred. Please try again.' : error.message,
    });
  });
  return { app, billing };
}
