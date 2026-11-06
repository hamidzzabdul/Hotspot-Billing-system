import { HttpError } from './utils.js';

// M-Pesa Kenya v2. Credentials never leave this server-side adapter.
export function payheroClient(config) {
  async function request(path, options = {}) {
    if (config.paymentMode !== 'live')
      throw new HttpError(503, 'M-Pesa payments are not configured yet');
    const response = await fetch(`https://backend.payhero.co.ke/api/v2${path}`, {
      ...options,
      headers: {
        Authorization: `Basic ${config.payheroAuthToken}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
    });
    const body = await response.json().catch(() => {
      throw new HttpError(
        502,
        'M-Pesa returned an unreadable response. Check payment status before retrying.',
      );
    });
    if (!response.ok) {
      const error = new HttpError(
        502,
        'M-Pesa is temporarily unavailable. Check payment status before retrying.',
      );
      if ([400, 401, 403, 422].includes(response.status)) error.definitive = true;
      throw error;
    }
    return body;
  }
  return {
    async initiate(payment) {
      if (config.paymentMode === 'disabled')
        throw new HttpError(503, 'M-Pesa payments are not configured yet');
      const result = await request('/payments', {
        method: 'POST',
        body: JSON.stringify({
          amount: payment.amount,
          phone_number: `0${payment.phone.slice(3)}`,
          channel_id: config.payheroChannelId,
          provider: 'm-pesa',
          external_reference: payment.reference,
          callback_url: `${config.publicUrl}/api/payhero/callback/${config.callbackSecret}`,
        }),
      });
      if (
        result.success !== true ||
        typeof result.reference !== 'string' ||
        !result.reference ||
        typeof result.CheckoutRequestID !== 'string' ||
        !result.CheckoutRequestID
      ) {
        throw new HttpError(
          502,
          'M-Pesa did not return a complete payment reference. Check with support before retrying.',
        );
      }
      return { checkoutId: result.CheckoutRequestID, providerReference: result.reference };
    },
    async query(reference) {
      if (!reference) throw new HttpError(409, 'This payment has no M-Pesa reference to verify');
      return request(`/transaction-status?reference=${encodeURIComponent(reference)}`);
    },
  };
}
