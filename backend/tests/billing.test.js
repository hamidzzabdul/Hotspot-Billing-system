import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { configuration } from '../src/config.js';
import { createApp } from '../src/app.js';
import { seed } from '../src/seed.js';
import {
  User,
  Plan,
  Router,
  Payment,
  Access,
  Loan,
  Settings,
  Voucher,
  GuestSession,
} from '../src/models.js';
import { encrypt, decrypt } from '../src/utils.js';
import { accessRecord, billingService } from '../src/billing.js';
import { routerClient } from '../src/router.js';
import { payheroClient } from '../src/payhero.js';

let mongo, server, base, billing, customer, other, admin, user, router, plan;
const config = configuration({
  NODE_ENV: 'development',
  ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  PAYMENT_MODE: 'live',
  ROUTER_MODE: 'live',
  PAYHERO_AUTH_TOKEN: 'test-token',
  PAYHERO_CHANNEL_ID: '1',
  PAYHERO_CALLBACK_SECRET: 'test-callback-secret-at-least-32-characters',
  PUBLIC_API_URL: 'https://payments.test.invalid',
  APP_ORIGIN: 'http://localhost:3000',
});
async function request(path, { method = 'GET', body, cookie, origin = config.origin } = {}) {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return {
    status: response.status,
    data,
    cookie: response.headers.get('set-cookie')?.split(';')[0],
  };
}
before(async () => {
  mongo = await MongoMemoryReplSet.create({
    binary: {
      downloadDir: new URL('../../.local/mongodb-binaries', import.meta.url).pathname.replace(
        /^\/(\w:)/,
        '$1',
      ),
    },
    replSet: { count: 1 },
  });
  await mongoose.connect(mongo.getUri());
  await seed({ email: 'admin@test.invalid', password: 'AdminTest12345!' });
  await Plan.create([
    { name: '1 hour', price: 10, durationMinutes: 60, speedMbps: 2 },
    { name: '1 day', price: 30, durationMinutes: 1440, speedMbps: 5 },
  ]);
  const created = createApp(config, {
    payments: {
      initiate: async (payment) => ({
        checkoutId: `TEST-${payment.reference}`,
        providerReference: `TEST-PH-${payment.reference}`,
      }),
    },
    routers: {
      inspect: async () => ({ connected: 0, uptime: '1h', active: [] }),
      validateDevice: async () => {},
      provision: async () => {},
      revoke: async () => {},
    },
  });
  billing = created.billing;
  server = created.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  admin = (
    await request('/auth/login', {
      method: 'POST',
      body: { identity: 'admin@test.invalid', password: 'AdminTest12345!' },
    })
  ).cookie;
  const registered = await request('/auth/register', {
    method: 'POST',
    body: { name: 'Test Customer', phone: '0712345678', password: 'CustomerTest123!' },
  });
  customer = registered.cookie;
  user = registered.data;
  other = (
    await request('/auth/register', {
      method: 'POST',
      body: { name: 'Other Customer', phone: '0112345678', password: 'OtherTest12345!' },
    })
  ).cookie;
  plan = await Plan.findOne({ price: 30 });
  router = await Router.create({
    name: 'Test hotspot',
    location: 'Test lab',
    baseUrl: 'https://router.test.invalid',
    username: 'api',
    password: encrypt('RouterSecret123', config),
    loginUrl: 'https://hotspot.test.invalid/login',
  });
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

test('authentication, validation, ownership, and origin controls', async () => {
  assert.equal((await request('/admin/overview')).status, 401);
  assert.equal((await request('/admin/overview', { cookie: customer })).status, 403);
  assert.equal(
    (await request('/auth/login', { method: 'POST', body: { identity: {}, password: {} } })).status,
    400,
  );
  assert.equal(
    (
      await request('/auth/login', {
        method: 'POST',
        body: { identity: '0712345678', password: 'WrongPass1' },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request('/auth/logout', {
        method: 'POST',
        body: {},
        cookie: customer,
        origin: 'https://evil.invalid',
      })
    ).status,
    403,
  );
  const stored = await User.findById(user._id).select('+password');
  assert.notEqual(stored.password, 'CustomerTest123!');
  const response = await request('/auth/me', { cookie: customer });
  assert.equal(response.data.password, undefined);
  assert.equal(
    (
      await request('/payments', {
        method: 'POST',
        cookie: customer,
        body: {
          planId: plan._id,
          routerId: router._id,
          macAddress: 'bad',
          phone: '0712345678',
          idempotencyKey: randomUUID(),
        },
      })
    ).status,
    400,
  );
  assert.throws(
    () => configuration({ NODE_ENV: 'production', PAYMENT_MODE: 'simulation' }),
    /Invalid PAYMENT_MODE/,
  );
  assert.equal(decrypt(encrypt('sensitive', config), config), 'sensitive');
});

let payment;
test('purchase uses stored pricing, idempotency, atomic settlement and one access pass', async () => {
  const body = {
    planId: plan._id,
    routerId: router._id,
    macAddress: '02:00:00:00:00:01',
    phone: '0712345678',
    idempotencyKey: randomUUID(),
    amount: 1,
  };
  const first = await request('/payments', { method: 'POST', cookie: customer, body });
  assert.equal(first.status, 201);
  payment = first.data;
  assert.equal(payment.amount, 30);
  assert.equal(payment.phone, '254712345678');
  assert.equal(payment.status, 'pending');
  const duplicate = await request('/payments', { method: 'POST', cookie: customer, body });
  assert.equal(duplicate.data._id, payment._id);
  assert.equal((await request(`/payments/${payment._id}`, { cookie: other })).status, 404);
  await Promise.all([
    billing.settle(payment._id, 'SIMTESTRECEIPT1'),
    billing.settle(payment._id, 'SIMTESTRECEIPT1'),
  ]);
  assert.equal(await Access.countDocuments({ payment: payment._id }), 1);
  assert.equal((await Payment.findById(payment._id)).checkoutId, payment.checkoutId);
  const settled = await Payment.findById(payment._id);
  assert.equal(settled.receipt, 'SIMTESTRECEIPT1');
  assert.equal(settled.status, 'completed');
  const receipt = await request(`/payments/${payment._id}/receipt`, { cookie: customer });
  assert.equal(receipt.status, 200);
  assert.match(receipt.data, /PAYMENT RECEIPT/);
  assert.doesNotMatch(receipt.data, /SIMULATED/);
  await billing.tick();
  const session = await Access.findOne({ payment: payment._id });
  assert.equal(session.status, 'active');
  assert.equal(session.speedMbps, 5);
  assert.equal(session.durationMinutes, 1440);
  assert.equal(
    (await request(`/me/sessions/${session._id}/credentials`, { cookie: other })).status,
    404,
  );
  const credentials = await request(`/me/sessions/${session._id}/credentials`, {
    cookie: customer,
  });
  assert.equal(credentials.status, 200);
  assert.equal(credentials.data.loginUrl, router.loginUrl);
  const passes = await request('/me/sessions', { cookie: customer });
  assert.equal(passes.data.items[0].password, undefined);
});

test('expiry revokes access and blocked customers lose all authenticated sessions', async () => {
  const session = await Access.findOne({ payment: payment._id });
  await Access.updateOne({ _id: session._id }, { expiresAt: new Date(Date.now() - 1000) });
  await billing.tick();
  assert.equal((await Access.findById(session._id)).status, 'expired');
  assert.equal(
    (await request(`/me/sessions/${session._id}/credentials`, { cookie: customer })).status,
    404,
  );
});

test('vouchers are single use, hashed, and create a real access pass', async () => {
  const generated = await request('/admin/vouchers', {
    method: 'POST',
    cookie: admin,
    body: { planId: plan._id, count: 2, validityDays: 7 },
  });
  assert.equal(generated.status, 201);
  assert.equal(generated.data.codes.length, 2);
  const code = generated.data.codes[0],
    body = { code, routerId: router._id, macAddress: '02:00:00:00:00:01' };
  const attempts = await Promise.all([
    request('/vouchers/redeem', { method: 'POST', cookie: customer, body }),
    request('/vouchers/redeem', { method: 'POST', cookie: customer, body }),
  ]);
  assert.deepEqual(attempts.map((r) => r.status).sort(), [200, 400]);
  assert.equal(await Voucher.countDocuments({ status: 'redeemed' }), 1);
  assert.equal(await Voucher.countDocuments({ codeHash: code }), 0);
});

test('credit eligibility, one open loan, repayment, and customer support replies', async () => {
  assert.equal((await request('/me/loans', { cookie: customer })).data.eligible, false);
  await Settings.updateOne({ key: 'main' }, { loansEnabled: true });
  assert.equal((await request('/me/loans', { cookie: customer })).data.eligible, true);
  const body = { routerId: router._id, macAddress: '02:00:00:00:00:01', acceptTerms: true };
  const loans = await Promise.all([
    request('/me/loans', { method: 'POST', cookie: customer, body }),
    request('/me/loans', { method: 'POST', cookie: customer, body }),
  ]);
  assert.deepEqual(loans.map((r) => r.status).sort(), [201, 409]);
  assert.equal(await Loan.countDocuments({ open: true }), 1);
  const loan = await Loan.findOne({ user: user._id });
  assert.equal(loan.amount, 10);
  assert.equal(loan.totalDue, 11);
  const repayment = await request(`/me/loans/${loan._id}/repay`, {
    method: 'POST',
    cookie: customer,
    body: { idempotencyKey: randomUUID() },
  });
  assert.equal(repayment.data.amount, 11);
  await billing.settle(repayment.data._id, 'SIMREPAYMENT01');
  assert.equal((await Loan.findById(loan._id)).status, 'repaid');
  const ticket = await request('/me/tickets', {
    method: 'POST',
    cookie: customer,
    body: {
      subject: 'Connection issue',
      message: 'My connection is not working.',
      reference: payment.reference,
    },
  });
  assert.equal(ticket.status, 201);
  const reply = await request(`/admin/tickets/${ticket.data._id}`, {
    method: 'PATCH',
    cookie: admin,
    body: { status: 'resolved', reply: 'Your access is ready. Please reconnect.' },
  });
  assert.equal(reply.status, 200);
  const history = await request('/me/tickets', { cookie: customer });
  assert.equal(history.data.items[0].replies.length, 1);
  assert.equal((await request('/me/tickets', { cookie: other })).data.items.length, 0);
  const blocked = await request(`/admin/customers/${user._id}`, {
    method: 'PATCH',
    cookie: admin,
    body: { blocked: true },
  });
  assert.equal(blocked.status, 200);
  assert.equal((await request('/auth/me', { cookie: customer })).status, 401);
  assert.equal(
    (
      await request('/auth/login', {
        method: 'POST',
        body: { identity: '0712345678', password: 'CustomerTest123!' },
      })
    ).status,
    401,
  );
  await billing.tick();
  assert.equal(await Access.countDocuments({ user: user._id, status: 'active' }), 0);
});

test('router failures stay visible and provisioning/revocation retry without duplicate grants', async () => {
  const payer = await User.findOne({ phone: '254112345678' });
  let failProvision = true,
    failRevoke = true,
    provisionCalls = 0;
  const service = billingService(
    config,
    {},
    {
      provision: async () => {
        provisionCalls++;
        if (failProvision) throw new Error('Router unreachable');
      },
      revoke: async () => {
        if (failRevoke) throw new Error('Router unreachable');
      },
    },
  );
  const pass = await Access.create(
    accessRecord(
      {
        user: payer._id,
        sourceKey: 'failure-retry-test',
        plan,
        router: router._id,
        macAddress: '02:00:00:00:00:04',
      },
      config,
    ),
  );
  await service.tick();
  let stored = await Access.findById(pass._id);
  assert.equal(stored.status, 'queued');
  assert.equal(stored.lastError, 'Router unreachable');
  const originalExpiry = stored.expiresAt.toISOString();
  failProvision = false;
  await service.tick();
  stored = await Access.findById(pass._id);
  assert.equal(stored.status, 'active');
  assert.equal(stored.expiresAt.toISOString(), originalExpiry);
  assert.ok(provisionCalls >= 2);
  await Access.updateOne({ _id: pass._id }, { expiresAt: new Date(Date.now() - 1000) });
  await service.tick();
  assert.equal((await Access.findById(pass._id)).status, 'revoking');
  failRevoke = false;
  await service.tick();
  assert.equal((await Access.findById(pass._id)).status, 'expired');
});

test('an interrupted provider response is reviewable and an idempotent retry never charges again', async () => {
  const payer = await User.findOne({ phone: '254112345678' });
  let calls = 0;
  const service = billingService(
    config,
    {
      initiate: async () => {
        calls++;
        throw new Error('Request timed out');
      },
    },
    { validateDevice: async () => {} },
  );
  const input = {
    user: payer,
    phone: payer.phone,
    plan,
    router,
    macAddress: '02:00:00:00:00:06',
    idempotencyKey: randomUUID(),
  };
  await assert.rejects(service.initiate(input), /timed out/);
  const retry = await service.initiate(input);
  assert.equal(retry.status, 'review');
  assert.equal(calls, 1);
});

test('callbacks persist before processing and are independently verified by the worker', async () => {
  const payer = await User.findOne({ phone: '254112345678' });
  const payment = await Payment.create({
    user: payer._id,
    phone: payer.phone,
    reference: 'INBOX-TEST',
    idempotencyKey: randomUUID(),
    amount: 30,
    planName: 'All day',
    durationMinutes: 1440,
    speedMbps: 5,
    router: router._id,
    macAddress: '02:00:00:00:00:08',
    checkoutId: 'inbox-checkout',
    providerReference: 'ph-inbox-reference',
    gateway: 'payhero',
    merchantId: 'inbox-merchant',
    status: 'pending',
  });
  const secret = randomBytes(32).toString('hex');
  const created = createApp(
    { ...config, paymentMode: 'live', callbackSecret: secret },
    {
      payments: {
        query: async (reference) => ({
          reference,
          provider: 'm-pesa',
          success: true,
          status: 'SUCCESS',
          provider_reference: 'INBOXRECEIPT01',
        }),
      },
      routers: { provision: async () => {}, revoke: async () => {} },
    },
  );
  const listener = created.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => listener.once('listening', resolve));
  const url = `http://127.0.0.1:${listener.address().port}/api/payhero/callback/`;
  const payload = {
    response: {
      CheckoutRequestID: payment.checkoutId,
      ExternalReference: payment.reference,
      ResultCode: 0,
      Status: 'Success',
      Amount: 30,
      Phone: '+' + payer.phone,
      MpesaReceiptNumber: 'INBOXRECEIPT01',
    },
    status: true,
  };
  try {
    assert.equal(
      (
        await fetch(url + 'wrong-secret', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      ).status,
      404,
    );
    const send = () =>
      fetch(url + secret, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    assert.equal((await send()).status, 200);
    assert.equal((await Payment.findById(payment._id)).status, 'pending');
    assert.equal((await send()).status, 200);
    await created.billing.tick();
    assert.equal((await Payment.findById(payment._id)).status, 'completed');
    assert.equal(await Access.countDocuments({ payment: payment._id }), 1);
  } finally {
    await new Promise((resolve) => listener.close(resolve));
  }
});

test('live RouterOS adapter installs expiry before enabling the user and removes access on revocation', async () => {
  const originalFetch = globalThis.fetch,
    calls = [],
    users = [],
    schedulers = [],
    active = [],
    cookies = [];
  globalThis.fetch = async (url, options) => {
    const path = new URL(url).pathname.replace('/rest/', ''),
      method = options.method;
    const data = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ path, method, data });
    if (method === 'GET') {
      if (path === 'system/resource') return Response.json({ uptime: '1d2h' });
      if (path === 'ip/hotspot/user/profile') return Response.json([{ name: 'wifex-5M' }]);
      return Response.json(
        path === 'ip/hotspot/user'
          ? users
          : path === 'system/scheduler'
            ? schedulers
            : path === 'ip/hotspot/active'
              ? active
              : cookies,
      );
    }
    if (method === 'PUT' && path === 'ip/hotspot/user') users.push({ ...data, '.id': '*1' });
    if (method === 'PUT' && path === 'system/scheduler') schedulers.push({ ...data, '.id': '*2' });
    return Response.json(data || {});
  };
  try {
    const client = routerClient({ ...config, routerMode: 'live' });
    const secretRouter = await Router.findById(router._id).select('+password');
    const pass = {
      _id: new mongoose.Types.ObjectId(),
      username: 'wf-abcd1234',
      password: encrypt('SecretPass123', config),
      macAddress: '02:00:00:00:00:09',
      speedMbps: 5,
      expiresAt: new Date(Date.now() + 3600000),
    };
    await client.provision(secretRouter, pass);
    const create = calls.findIndex(
      (call) => call.path === 'ip/hotspot/user' && call.method === 'PUT',
    );
    const scheduler = calls.findIndex(
      (call) => call.path === 'system/scheduler' && call.method === 'PUT',
    );
    const enable = calls.findIndex(
      (call) => call.method === 'PATCH' && call.data.disabled === 'false',
    );
    assert.equal(calls[create].data.disabled, 'true');
    assert.ok(create < scheduler && scheduler < enable);
    assert.match(calls[scheduler].data['on-event'], /:timestamp/);
    assert.equal((await client.inspect(secretRouter)).uptime, '1d2h');
    active.push({ user: pass.username, '.id': '*3' });
    cookies.push({ user: pass.username, '.id': '*4' });
    await client.revoke(secretRouter, pass);
    assert.ok(calls.some((call) => call.method === 'PATCH' && call.data.disabled === 'true'));
    assert.ok(
      calls.some((call) => call.path === 'ip/hotspot/active/*3' && call.method === 'DELETE'),
    );
    assert.ok(
      calls.some((call) => call.path === 'ip/hotspot/cookie/*4' && call.method === 'DELETE'),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('verified callback rejects mismatches and duplicate callbacks never duplicate access', async () => {
  const payer = await User.findOne({ phone: '254112345678' });
  const p = await Payment.create({
    user: payer._id,
    phone: payer.phone,
    reference: 'LIVE-TEST',
    idempotencyKey: randomUUID(),
    amount: 30,
    planName: 'All day',
    durationMinutes: 1440,
    speedMbps: 5,
    router: router._id,
    macAddress: '02:00:00:00:00:02',
    checkoutId: 'checkout-live-test',
    providerReference: 'ph-live-reference',
    gateway: 'payhero',
    merchantId: 'merchant-live-test',
    status: 'pending',
  });
  let queryStatus = 'SUCCESS';
  const service = createApp(
    { ...config, paymentMode: 'live' },
    {
      payments: {
        query: async (reference) => ({
          reference,
          provider: 'm-pesa',
          success: true,
          status: queryStatus,
          provider_reference: 'QWERTY12345',
        }),
      },
    },
  ).billing;
  const payload = (amount) => ({
    response: {
      CheckoutRequestID: p.checkoutId,
      ExternalReference: p.reference,
      ResultCode: 0,
      Status: 'Success',
      Amount: amount,
      Phone: payer.phone,
      MpesaReceiptNumber: 'QWERTY12345',
    },
    status: true,
  });
  await assert.rejects(service.callback(payload(1)), /do not match/);
  assert.equal((await Payment.findById(p._id)).status, 'review');
  assert.equal(await Access.countDocuments({ payment: p._id }), 0);
  queryStatus = 'FAILED';
  await assert.rejects(service.callback(payload(30)), /verification/);
  queryStatus = 'SUCCESS';
  await service.callback(payload(30));
  await service.callback(payload(30));
  assert.equal(await Access.countDocuments({ payment: p._id }), 1);
});

test('Pay Hero adapter sends server-side auth, channel and external reference, and queries the returned provider reference', async () => {
  const originalFetch = globalThis.fetch,
    calls = [];
  const live = {
    ...config,
    paymentMode: 'live',
    payheroAuthToken: 'TEST_ONLY_TOKEN',
    payheroChannelId: 133,
    publicUrl: 'https://wifi.test.invalid',
    callbackSecret: 'a'.repeat(32),
  };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return Response.json(
      options.method === 'POST'
        ? {
            success: true,
            status: 'QUEUED',
            reference: 'PH-TEST-REF',
            CheckoutRequestID: 'PH-TEST-CHECKOUT',
          }
        : { success: true, status: 'QUEUED', reference: 'PH-TEST-REF', provider: 'm-pesa' },
    );
  };
  try {
    const client = payheroClient(live);
    const result = await client.initiate({
      amount: 30,
      phone: '254712345678',
      reference: 'WF-TEST',
    });
    assert.deepEqual(result, { checkoutId: 'PH-TEST-CHECKOUT', providerReference: 'PH-TEST-REF' });
    assert.equal(calls[0].url, 'https://backend.payhero.co.ke/api/v2/payments');
    assert.equal(calls[0].options.headers.Authorization, 'Basic TEST_ONLY_TOKEN');
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.channel_id, 133);
    assert.equal(body.external_reference, 'WF-TEST');
    assert.equal(body.phone_number, '0712345678');
    assert.equal(body.amount, 30);
    assert.ok(body.callback_url.endsWith('/api/payhero/callback/' + live.callbackSecret));
    await client.query(result.providerReference);
    assert.equal(
      calls[1].url,
      'https://backend.payhero.co.ke/api/v2/transaction-status?reference=PH-TEST-REF',
    );
    await assert.rejects(
      payheroClient({ ...live, paymentMode: 'disabled' }).initiate({}),
      /not configured/,
    );
    await assert.rejects(
      payheroClient({ ...live, paymentMode: 'disabled' }).query('reference'),
      /not configured/,
    );
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('payments default to disabled, old Daraja configuration cannot enable them, and public configuration never reveals credentials', async () => {
  assert.equal(
    configuration({ MPESA_MODE: 'production', MPESA_CONSUMER_KEY: 'old' }).paymentMode,
    'disabled',
  );
  assert.throws(
    () => configuration({ PAYMENT_MODE: 'live', ENCRYPTION_KEY: config.encryptionKey }),
    /PAYHERO_AUTH_TOKEN/,
  );
  const previous = config.paymentMode;
  config.paymentMode = 'disabled';
  try {
    const before = await Payment.countDocuments();
    const result = await request('/payments', {
      method: 'POST',
      cookie: other,
      body: {
        planId: plan._id,
        routerId: router._id,
        macAddress: '02:00:00:00:00:10',
        phone: '0112345678',
        idempotencyKey: randomUUID(),
      },
    });
    assert.equal(result.status, 503);
    assert.match(result.data.error, /M-Pesa/);
    assert.equal(await Payment.countDocuments(), before);
    const publicConfig = await request('/public/config');
    assert.equal(publicConfig.data.paymentMode, 'disabled');
    assert.equal(publicConfig.data.payheroAuthToken, undefined);
    assert.equal((await request('/mpesa/callback/old', { method: 'POST', body: {} })).status, 404);
  } finally {
    config.paymentMode = previous;
  }
});

test('Pay Hero reconciliation keeps queued payments pending, settles verified receipts once, and never queries legacy payments', async () => {
  const payer = await User.findOne({ phone: '254112345678' });
  let state = 'QUEUED',
    queries = 0;
  const service = billingService(
    config,
    {
      query: async (reference) => {
        queries++;
        return {
          reference,
          provider: 'm-pesa',
          success: true,
          status: state,
          provider_reference: 'RECONCILE1234',
        };
      },
    },
    {},
  );
  const p = await Payment.create({
    user: payer._id,
    phone: payer.phone,
    reference: 'PH-RECONCILE',
    idempotencyKey: randomUUID(),
    amount: 30,
    planName: plan.name,
    durationMinutes: 1440,
    speedMbps: 5,
    router: router._id,
    macAddress: '02:00:00:00:00:11',
    checkoutId: 'ph-reconcile-checkout',
    providerReference: 'ph-reconcile-ref',
    gateway: 'payhero',
    status: 'pending',
  });
  await service.reconcile(p);
  assert.equal((await Payment.findById(p._id)).status, 'pending');
  state = 'SUCCESS';
  await service.reconcile(p);
  assert.equal((await Payment.findById(p._id)).status, 'completed');
  assert.equal(await Access.countDocuments({ payment: p._id }), 1);
  await service.reconcile(await Payment.findById(p._id));
  assert.equal(queries, 2);
  await assert.rejects(
    service.reconcile({ gateway: 'legacy', status: 'pending' }),
    /Legacy payments/,
  );
  assert.equal(queries, 2);
});

test('guest checkout purchases without an account and protects status, receipt, credentials and registered history', async () => {
  const identity = await request('/checkout/session', { method: 'POST', body: {} });
  assert.equal(identity.status, 200);
  assert.match(identity.cookie, /^wifex_guest=/);
  const guest = identity.cookie;
  assert.equal((await request('/auth/me', { cookie: guest })).status, 401);
  assert.equal((await request('/admin/overview', { cookie: guest })).status, 401);
  assert.equal((await request('/me/payments', { cookie: guest })).status, 401);
  const body = {
    planId: plan._id,
    expectedPrice: plan.price,
    routerId: router._id,
    macAddress: '02:00:00:00:00:12',
    phone: '0112345678',
    idempotencyKey: randomUUID(),
    amount: 1,
  };
  const first = await request('/payments', { method: 'POST', cookie: guest, body });
  assert.equal(first.status, 201);
  assert.equal(first.data.amount, 30);
  const paymentId = first.data._id;
  const guestUser = await User.findById(first.data.user).select('+password');
  assert.equal(guestUser.guest, true);
  assert.equal(guestUser.password, undefined);
  assert.equal(guestUser.phone, undefined);
  assert.equal(guestUser.contactPhone, '254112345678');
  const registered = await User.findOne({ phone: '254112345678' });
  assert.notEqual(String(registered._id), String(guestUser._id));
  const session = await GuestSession.findOne({ user: guestUser._id });
  assert.notEqual(session.tokenHash, guest.split('=')[1]);
  assert.equal(
    (await request('/payments', { method: 'POST', cookie: guest, body })).data._id,
    paymentId,
  );
  assert.equal(
    (await request('/checkout/session', { method: 'POST', cookie: guest, body: {} })).cookie,
    undefined,
  );
  assert.equal((await request('/payments/' + paymentId)).status, 401);
  assert.equal((await request('/payments/' + paymentId, { cookie: other })).status, 404);
  const stranger = (await request('/checkout/session', { method: 'POST', body: {} })).cookie;
  assert.equal((await request('/payments/' + paymentId, { cookie: stranger })).status, 404);
  assert.equal((await request('/payments/' + payment._id, { cookie: guest })).status, 404);
  assert.equal(
    (await request('/payments/' + paymentId + '/credentials', { cookie: guest })).status,
    404,
  );
  await billing.settle(paymentId, 'GUESTRECEIPT01');
  await billing.tick();
  const status = await request('/payments/' + paymentId, { cookie: guest });
  assert.equal(status.data.access.status, 'active');
  const credentials = await request('/payments/' + paymentId + '/credentials', { cookie: guest });
  assert.equal(credentials.status, 200);
  assert.equal(credentials.data.loginUrl, router.loginUrl);
  assert.equal(
    (await request('/payments/' + paymentId + '/credentials', { cookie: stranger })).status,
    404,
  );
  assert.equal(
    (await request('/payments/' + paymentId + '/receipt', { cookie: guest })).status,
    200,
  );
  assert.equal(
    (await request('/payments/' + paymentId + '/receipt', { cookie: stranger })).status,
    404,
  );
  const duplicateDevice = await request('/payments', {
    method: 'POST',
    cookie: stranger,
    body: { ...body, idempotencyKey: randomUUID() },
  });
  assert.equal(duplicateDevice.status, 409);
  assert.equal(await Access.countDocuments({ payment: paymentId }), 1);
});

test('guest checkout rejects stale pricing and blocked payers without creating payments', async () => {
  const count = await Payment.countDocuments();
  const body = {
    planId: plan._id,
    routerId: router._id,
    macAddress: '02:00:00:00:00:13',
    phone: '0112345678',
    idempotencyKey: randomUUID(),
    expectedPrice: 1,
  };
  assert.equal((await request('/payments', { method: 'POST', body })).status, 409);
  assert.equal(
    (
      await request('/payments', {
        method: 'POST',
        body: { ...body, expectedPrice: 30, phone: '0712345678' },
      })
    ).status,
    403,
  );
  assert.equal(await Payment.countDocuments(), count);
});

test('runtime rejects simulation modes and customer checkout requires captive-portal context', async () => {
  assert.throws(() => configuration({ ROUTER_MODE: 'simulation' }), /Invalid ROUTER_MODE/);
  assert.throws(() => configuration({ PAYMENT_MODE: 'simulation' }), /Invalid PAYMENT_MODE/);
  assert.equal((await request('/public/routers')).status, 404);
  const before = await Payment.countDocuments();
  const response = await request('/payments', {
    method: 'POST',
    cookie: other,
    body: {
      planId: plan._id,
      phone: '0112345678',
      idempotencyKey: randomUUID(),
    },
  });
  assert.equal(response.status, 400);
  assert.equal(await Payment.countDocuments(), before);
});

test('live device verification rejects a device absent from its hotspot', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([{ 'mac-address': '02:00:00:00:00:AA' }]);
  try {
    const secretRouter = await Router.findById(router._id).select('+password');
    const client = routerClient(config);
    await assert.rejects(client.validateDevice(secretRouter, '02:00:00:00:00:BB'), /not connected/);
    await client.validateDevice(secretRouter, '02:00:00:00:00:AA');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('guests redeem vouchers without signing in and only their browser can connect', async () => {
  const generated = await request('/admin/vouchers', {
    method: 'POST',
    cookie: admin,
    body: { planId: plan._id, count: 1, validityDays: 7 },
  });
  const body = {
    code: generated.data.codes[0],
    routerId: router._id,
    macAddress: '02:00:00:00:00:CD',
  };
  const redeemed = await request('/vouchers/redeem', { method: 'POST', body });
  assert.equal(redeemed.status, 200);
  assert.ok(redeemed.cookie.startsWith('wifex_guest='));
  const accessId = redeemed.data.accessId;
  assert.ok(accessId);
  assert.equal((await request(`/access/${accessId}`)).status, 401);
  assert.equal((await request(`/access/${accessId}`, { cookie: other })).status, 404);
  const pending = await request(`/access/${accessId}`, { cookie: redeemed.cookie });
  assert.equal(pending.status, 200);
  assert.equal(pending.data.password, undefined);
  assert.equal(
    (await request(`/access/${accessId}/credentials`, { cookie: redeemed.cookie })).status,
    404,
  );
  await billing.tick();
  const ready = await request(`/access/${accessId}/credentials`, { cookie: redeemed.cookie });
  assert.equal(ready.status, 200);
  assert.equal(ready.data.loginUrl, router.loginUrl);
  assert.ok(ready.data.password);
  assert.equal((await request(`/access/${accessId}/credentials`, { cookie: other })).status, 404);
  assert.equal(
    (await request('/vouchers/redeem', { method: 'POST', cookie: redeemed.cookie, body })).status,
    400,
  );
  assert.equal(await Access.countDocuments({ _id: accessId }), 1);
  await Access.updateOne({ _id: accessId }, { expiresAt: new Date(Date.now() - 1000) });
  assert.equal(
    (await request(`/access/${accessId}/credentials`, { cookie: redeemed.cookie })).status,
    404,
  );
});

test('a real verification payment is KES 1 and automatically reconciles without creating router access', async () => {
  const owner = await User.findOne({ role: 'admin' });
  let initiations = 0,
    queries = 0;
  const service = billingService(
    config,
    {
      initiate: async () => {
        initiations++;
        return { checkoutId: 'VERIFY-CHECKOUT', providerReference: 'VERIFY-PROVIDER' };
      },
      query: async () => {
        queries++;
        return {
          success: true,
          status: 'SUCCESS',
          reference: 'VERIFY-PROVIDER',
          provider: 'm-pesa',
          provider_reference: 'VERIFYRECEIPT01',
        };
      },
    },
    {
      validateDevice: async () => {
        throw new Error('Verification must not request device access');
      },
    },
  );
  const payload = {
    user: owner,
    phone: '254712345678',
    verification: true,
    idempotencyKey: randomUUID(),
  };
  const initiated = await service.initiate(payload);
  assert.equal(initiated.amount, 1);
  assert.equal(initiated.kind, 'verification');
  await service.initiate(payload);
  assert.equal(initiations, 1);
  await Payment.updateOne({ _id: initiated._id }, { nextVerificationAt: new Date(0) });
  await service.tick();
  const settled = await Payment.findById(initiated._id);
  assert.equal(settled.status, 'completed');
  assert.equal(settled.receipt, 'VERIFYRECEIPT01');
  assert.equal(await Access.countDocuments({ payment: initiated._id }), 0);
  assert.equal(queries, 1);
  await service.tick();
  assert.equal(queries, 1);
  await assert.rejects(
    service.initiate({
      ...payload,
      user: await User.findOne({ role: 'customer', blocked: false }),
      idempotencyKey: randomUUID(),
    }),
    /Administrator access/,
  );
});
