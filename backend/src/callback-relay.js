import { createServer } from 'node:http';

// Expose only the secret callback route; never proxy the app or administration APIs.
export function callbackRelay({ callbackSecret, target = 'http://127.0.0.1:4000' }) {
  if (!callbackSecret || callbackSecret.length < 32)
    throw new Error('A callback secret is required');
  const callbackPath = `/api/payhero/callback/${callbackSecret}`;
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200).end(JSON.stringify({ service: 'payment-callback', status: 'ok' }));
      return;
    }
    if (req.url !== callbackPath || req.method !== 'POST') {
      res.writeHead(404).end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
      res.writeHead(415).end(JSON.stringify({ error: 'Use application/json' }));
      return;
    }
    const chunks = [];
    let length = 0;
    try {
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 32768) {
          res.writeHead(413).end(JSON.stringify({ error: 'Payload too large' }));
          return;
        }
        chunks.push(chunk);
      }
      const response = await fetch(new URL(callbackPath, target), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.concat(chunks),
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      });
      res.writeHead(response.status).end(await response.text());
    } catch {
      if (!res.headersSent)
        res.writeHead(502).end(JSON.stringify({ error: 'Callback service unavailable' }));
    }
  });
}
