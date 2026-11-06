export function configuration(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const config = {
    production,
    port: Number(env.PORT || 4000),
    host: env.HOST || '127.0.0.1',
    mongoUri: env.MONGODB_URI || 'mongodb://127.0.0.1:27017/wifex?replicaSet=rs0',
    origin: env.APP_ORIGIN || 'http://localhost:3000',
    trustProxy: env.TRUST_PROXY || 'loopback',
    encryptionKey: env.ENCRYPTION_KEY || '',
    paymentMode: env.PAYMENT_MODE || 'disabled',
    routerMode: env.ROUTER_MODE || 'live',
    allowRouterHttp: env.ALLOW_ROUTER_HTTP === 'true',
    sessionDays: Number(env.SESSION_DAYS || 7),
    payheroAuthToken: (env.PAYHERO_AUTH_TOKEN || '').trim().replace(/^Basic\s+/i, ''),
    payheroChannelId: Number(env.PAYHERO_CHANNEL_ID),
    callbackSecret: env.PAYHERO_CALLBACK_SECRET || '',
    publicUrl: env.PUBLIC_API_URL,
  };
  if (!['disabled', 'live'].includes(config.paymentMode)) throw new Error('Invalid PAYMENT_MODE');
  if (config.routerMode !== 'live') throw new Error('Invalid ROUTER_MODE');
  if (!Number.isFinite(config.sessionDays) || config.sessionDays < 1 || config.sessionDays > 30)
    throw new Error('SESSION_DAYS must be between 1 and 30');
  if (config.paymentMode !== 'disabled' && !/^[a-f0-9]{64}$/i.test(config.encryptionKey))
    throw new Error('Enabled payments require a 32-byte ENCRYPTION_KEY');
  if (
    production &&
    (!/^[a-f0-9]{64}$/i.test(config.encryptionKey) || !config.origin.startsWith('https://'))
  )
    throw new Error('Production requires a 32-byte ENCRYPTION_KEY and HTTPS APP_ORIGIN');
  if (
    config.paymentMode === 'live' &&
    (!config.payheroAuthToken ||
      /\s/.test(config.payheroAuthToken) ||
      !Number.isSafeInteger(config.payheroChannelId) ||
      config.payheroChannelId < 1 ||
      config.callbackSecret.length < 32 ||
      !config.publicUrl?.startsWith('https://'))
  )
    throw new Error(
      'Complete PAYHERO_AUTH_TOKEN, PAYHERO_CHANNEL_ID, HTTPS PUBLIC_API_URL, and PAYHERO_CALLBACK_SECRET before enabling live payments',
    );
  return config;
}
