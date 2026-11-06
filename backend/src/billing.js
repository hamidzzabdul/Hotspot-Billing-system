import mongoose from 'mongoose';
import { randomBytes } from 'node:crypto';
import { Payment, Access, Router, Loan, User, Audit, CallbackEvent } from './models.js';
import { encrypt, token, HttpError, phoneSchema } from './utils.js';

export function accessRecord({ user, sourceKey, plan, router, macAddress, payment }, config) {
  return {
    user,
    sourceKey,
    payment,
    planName: plan.name || plan.planName,
    durationMinutes: plan.durationMinutes,
    speedMbps: plan.speedMbps,
    router,
    macAddress,
    username: `wf-${randomBytes(10).toString('hex')}`,
    password: encrypt(token().slice(0, 24), config),
    status: 'queued',
  };
}

export function billingService(config, gateway, routers) {
  async function initiate({
    user,
    phone,
    plan,
    router,
    macAddress,
    idempotencyKey,
    loan,
    verification = false,
  }) {
    if (config.paymentMode === 'disabled')
      throw new HttpError(503, 'M-Pesa payments are not configured yet');
    const key = `${user._id}:${idempotencyKey}`;
    const existing = await Payment.findOne({ idempotencyKey: key });
    if (existing) return existing;
    const blocked = await User.findById(user._id);
    if (blocked.blocked) throw new HttpError(403, 'This account is suspended. Contact support.');
    if (verification && user.role !== 'admin')
      throw new HttpError(403, 'Administrator access required');
    if (!loan && !verification) {
      await routers.validateDevice(router, macAddress);
      if (
        await Access.exists({
          router: router._id,
          macAddress,
          status: { $in: ['queued', 'provisioning', 'active', 'revoking'] },
        })
      )
        throw new HttpError(
          409,
          'This device already has an access pass. Use it before purchasing another.',
        );
    }
    let payment;
    try {
      payment = await Payment.create({
        user: user._id,
        phone,
        reference: `WF${randomBytes(8).toString('hex').toUpperCase()}`,
        idempotencyKey: key,
        amount: verification ? 1 : loan ? loan.totalDue : plan.price,
        plan: plan?._id,
        planName: verification ? 'Payment verification' : plan?.name,
        durationMinutes: plan?.durationMinutes,
        speedMbps: plan?.speedMbps,
        router: router?._id,
        macAddress,
        kind: verification ? 'verification' : loan ? 'loan_repayment' : 'purchase',
        loan: loan?._id,
        gateway: 'payhero',
        nextVerificationAt: new Date(Date.now() + 15000),
      });
    } catch (error) {
      if (error.code === 11000) {
        const duplicate = await Payment.findOne({ idempotencyKey: key });
        if (duplicate) return duplicate;
        throw new HttpError(
          409,
          'A payment is already pending for this device or credit balance. Check its status before paying again.',
        );
      }
      throw error;
    }
    try {
      const result = await gateway.initiate(payment);
      payment.checkoutId = result.checkoutId;
      payment.providerReference = result.providerReference;
      payment.status = 'pending';
      await payment.save();
      return payment;
    } catch (error) {
      const definitiveFailure = error.status === 503 || error.definitive === true;
      await Payment.updateOne(
        { _id: payment._id, status: 'initiating' },
        {
          status: definitiveFailure ? 'failed' : 'review',
          failureReason: definitiveFailure
            ? error.message
            : 'Provider response was interrupted. Check with support before retrying.',
        },
      );
      throw error;
    }
  }

  async function settle(paymentId, receipt) {
    const transaction = await mongoose.startSession();
    try {
      await transaction.withTransaction(async () => {
        const payment = await Payment.findById(paymentId).session(transaction);
        if (!payment || payment.status === 'completed') return;
        if (!['pending', 'review'].includes(payment.status))
          throw new HttpError(409, 'Payment is not awaiting settlement');
        if (payment.kind === 'purchase') {
          await Access.updateOne(
            { sourceKey: `payment:${payment._id}` },
            {
              $setOnInsert: accessRecord(
                {
                  user: payment.user,
                  sourceKey: `payment:${payment._id}`,
                  payment: payment._id,
                  plan: payment,
                  router: payment.router,
                  macAddress: payment.macAddress,
                },
                config,
              ),
            },
            { upsert: true, session: transaction },
          );
        } else if (payment.kind === 'loan_repayment') {
          const loan = await Loan.findById(payment.loan).session(transaction);
          if (!loan || !loan.open)
            throw new HttpError(409, 'Loan is already settled; payment requires review');
          loan.status = 'repaid';
          loan.open = false;
          loan.repaidAt = new Date();
          await loan.save({ session: transaction });
        }
        payment.status = 'completed';
        payment.receipt = receipt;
        payment.paidAt = new Date();
        await payment.save({ session: transaction });
        await Audit.create(
          [
            {
              actor: payment.user,
              action: 'payment.completed',
              detail: `${payment.reference} · KES ${payment.amount}${payment.simulated ? ' · simulated' : ''}`,
            },
          ],
          { session: transaction },
        );
      });
    } finally {
      await transaction.endSession();
    }
  }

  async function verifyStatus(payment) {
    if (payment.gateway !== 'payhero' || !payment.providerReference)
      throw new HttpError(
        409,
        'This payment has no M-Pesa reference. Legacy payments must be reviewed with the original provider.',
      );
    const result = await gateway.query(payment.providerReference);
    if (
      result.reference !== payment.providerReference ||
      result.provider !== 'm-pesa' ||
      (result.CheckoutRequestID && result.CheckoutRequestID !== payment.checkoutId)
    )
      throw new HttpError(409, 'M-Pesa transaction reference does not match this purchase');
    const status = String(result.status || '').toUpperCase();
    if (!['SUCCESS', 'FAILED', 'QUEUED'].includes(status))
      throw new HttpError(409, 'M-Pesa has not returned a recognized payment status');
    const receipt = result.provider_reference || result.third_party_reference;
    if (
      status === 'SUCCESS' &&
      (result.success !== true || typeof receipt !== 'string' || !/^[A-Z0-9]{8,20}$/.test(receipt))
    )
      throw new HttpError(409, 'M-Pesa has not returned a verified payment receipt');
    return { status, receipt };
  }

  async function callback(body) {
    const data = body?.response;
    if (
      !data ||
      typeof data.CheckoutRequestID !== 'string' ||
      typeof data.ExternalReference !== 'string' ||
      !Number.isInteger(data.ResultCode)
    )
      throw new HttpError(400, 'Invalid M-Pesa callback');
    const payment = await Payment.findOne({
      reference: data.ExternalReference,
      gateway: 'payhero',
    });
    if (!payment) throw new HttpError(404, 'Unknown M-Pesa payment');
    if (payment.status === 'completed') return;
    if (!payment.checkoutId || !payment.providerReference)
      throw new HttpError(409, 'Payment initiation is still being recorded');
    if (data.CheckoutRequestID !== payment.checkoutId)
      throw new HttpError(400, 'Checkout reference mismatch');
    const verification = await verifyStatus(payment);
    const succeeded = data.ResultCode === 0 && String(data.Status).toUpperCase() === 'SUCCESS';
    if (verification.status === 'QUEUED' || succeeded !== (verification.status === 'SUCCESS'))
      throw new HttpError(409, 'Payment verification is not ready; callback may be retried');
    if (!succeeded) {
      await Payment.updateOne(
        { _id: payment._id, status: { $in: ['pending', 'review'] } },
        {
          status: 'failed',
          failureReason: String(data.ResultDesc || 'Payment cancelled').slice(0, 300),
        },
      );
      return;
    }
    const phone = phoneSchema.safeParse(data.Phone);
    if (
      Number(data.Amount) !== payment.amount ||
      !phone.success ||
      phone.data !== payment.phone ||
      data.MpesaReceiptNumber !== verification.receipt
    ) {
      await Payment.updateOne(
        { _id: payment._id },
        { status: 'review', failureReason: 'M-Pesa callback amount, phone, or receipt mismatch' },
      );
      throw new HttpError(400, 'Payment details do not match the purchase');
    }
    await settle(payment._id, verification.receipt);
  }

  async function reconcile(payment) {
    if (payment.status === 'completed') return 'This payment has already been settled.';
    if (payment.simulated)
      throw new HttpError(400, 'Simulated payments do not have a live provider transaction');
    const verification = await verifyStatus(payment);
    if (verification.status === 'SUCCESS') {
      await settle(payment._id, verification.receipt);
      return 'M-Pesa confirms payment. The purchase has been settled.';
    }
    if (verification.status === 'FAILED') {
      await Payment.updateOne(
        { _id: payment._id, status: { $ne: 'completed' } },
        { status: 'failed', failureReason: 'M-Pesa reports an unsuccessful payment' },
      );
      return 'M-Pesa reports an unsuccessful payment.';
    }
    return 'M-Pesa is still awaiting confirmation. The payment remains pending.';
  }

  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      for (const event of await CallbackEvent.find({
        status: 'pending',
        gateway: 'payhero',
        $or: [{ nextAttempt: { $exists: false } }, { nextAttempt: { $lte: new Date() } }],
      }).limit(20)) {
        try {
          await callback(event.payload);
          await CallbackEvent.updateOne({ _id: event._id }, { status: 'processed', lastError: '' });
        } catch (error) {
          await CallbackEvent.updateOne(
            { _id: event._id },
            {
              $inc: { attempts: 1 },
              $set: {
                lastError: error.message,
                nextAttempt: new Date(Date.now() + 30000),
                ...(error.status === 400 ? { status: 'rejected' } : {}),
              },
            },
          );
        }
      }
      // Recover missing callbacks without asking the customer to pay again.
      if (config.paymentMode === 'live' && typeof gateway.query === 'function') {
        const due = {
          status: { $in: ['pending', 'review'] },
          gateway: 'payhero',
          simulated: { $ne: true },
          providerReference: { $type: 'string' },
          $or: [
            { nextVerificationAt: { $lte: new Date() } },
            {
              nextVerificationAt: { $exists: false },
              createdAt: { $lt: new Date(Date.now() - 15000) },
            },
          ],
        };
        for (const payment of await Payment.find(due).limit(10)) {
          const claim = await Payment.updateOne(
            { _id: payment._id, ...due },
            { nextVerificationAt: new Date(Date.now() + 30000) },
          );
          if (!claim.modifiedCount) continue;
          try {
            await reconcile(payment);
          } catch (error) {
            console.error('Payment verification:', error.message);
          }
        }
      }
      // Never auto-fail an accepted checkout: late callbacks can still settle it.
      await Payment.updateMany(
        { status: 'pending', createdAt: { $lt: new Date(Date.now() - 5 * 60000) } },
        {
          status: 'review',
          failureReason: 'Awaiting provider confirmation; do not pay again until reviewed',
        },
      );
      await Payment.updateMany(
        { status: 'initiating', createdAt: { $lt: new Date(Date.now() - 2 * 60000) } },
        {
          status: 'review',
          failureReason: 'Initiation interrupted; reconcile with M-Pesa before retrying',
        },
      );
      await Loan.updateMany({ open: true, dueAt: { $lt: new Date() } }, { status: 'overdue' });
      await Access.updateMany(
        { status: 'active', expiresAt: { $lte: new Date() } },
        { status: 'revoking', endReason: 'expired' },
      );
      await Access.updateMany(
        { status: 'provisioning', leaseUntil: { $lt: new Date() } },
        { status: 'queued' },
      );
      const queued = await Access.find({ status: 'queued' }).limit(30).select('+password');
      for (const access of queued) {
        const claim = await Access.updateOne(
          { _id: access._id, status: 'queued' },
          { status: 'provisioning', leaseUntil: new Date(Date.now() + 60000) },
        );
        if (!claim.modifiedCount) continue;
        try {
          const user = await User.findById(access.user);
          if (user?.blocked) {
            await Access.updateOne(
              { _id: access._id },
              { status: 'disconnected', endReason: 'blocked' },
            );
            continue;
          }
          const router = await Router.findById(access.router).select('+password');
          if (!router) throw new Error('Router is unavailable');
          // Start the paid window only when provisioning begins; retries keep the same window.
          access.startedAt ||= new Date();
          access.expiresAt ||= new Date(
            access.startedAt.getTime() + access.durationMinutes * 60000,
          );
          await Access.updateOne(
            { _id: access._id },
            { startedAt: access.startedAt, expiresAt: access.expiresAt },
          );
          if (access.expiresAt <= new Date()) {
            await Access.updateOne(
              { _id: access._id },
              { status: 'revoking', endReason: 'expired' },
            );
            continue;
          }
          await routers.provision(router, access);
          const result = await Access.updateOne(
            { _id: access._id, status: 'provisioning' },
            { status: 'active', lastError: '' },
          );
          if (!result.modifiedCount) await routers.revoke(router, access);
        } catch (error) {
          await Access.updateOne(
            { _id: access._id, status: 'provisioning' },
            { status: 'queued', lastError: error.message },
          );
        }
      }
      for (const access of await Access.find({ status: 'revoking' }).limit(50)) {
        try {
          const router = await Router.findById(access.router).select('+password');
          if (router) await routers.revoke(router, access);
          await Access.updateOne(
            { _id: access._id, status: 'revoking' },
            {
              status: access.endReason === 'expired' ? 'expired' : 'disconnected',
              connected: false,
              lastError: '',
            },
          );
        } catch (error) {
          await Access.updateOne({ _id: access._id }, { lastError: error.message });
        }
      }
    } finally {
      running = false;
    }
  }
  async function pollRouters() {
    for (const router of await Router.find({ enabled: true }).select('+password')) {
      try {
        const result = await routers.inspect(router);
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
        await Access.updateMany({ router: router._id }, { connected: false });
        await Access.updateMany(
          {
            router: router._id,
            status: 'active',
            username: { $in: result.active.map((a) => a.user) },
          },
          { connected: true },
        );
      } catch (error) {
        await Router.updateOne(
          { _id: router._id },
          { status: 'offline', lastChecked: new Date(), error: error.message, connected: 0 },
        );
        await Access.updateMany({ router: router._id }, { connected: false });
      }
    }
  }
  return { initiate, settle, callback, reconcile, tick, pollRouters };
}
