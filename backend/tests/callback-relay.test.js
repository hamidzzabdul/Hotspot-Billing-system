import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { callbackRelay } from '../src/callback-relay.js';

test('public relay accepts only the exact callback path and never forwards admin routes or cookies', async () => {
  const received = [];
  const target = createServer(async (req, res) => {
    for await (const chunk of req) {
      void chunk;
    }
    received.push({ url: req.url, cookie: req.headers.cookie });
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"accepted":true}');
  });
  // Avoid assumptions about an installed router or a live payment provider.
  await new Promise((resolve) => target.listen(0, '127.0.0.1', resolve));
  const secret = 'a'.repeat(64);
  const relay = callbackRelay({
    callbackSecret: secret,
    target: `http://127.0.0.1:${target.address().port}`,
  });
  await new Promise((resolve) => relay.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${relay.address().port}`;
  try {
    for (const path of [
      '/',
      '/admin/login',
      '/api/admin/overview',
      '/api/public/config',
      '/api/payhero/callback/wrong',
      `/api/payhero/callback/${secret}?extra=1`,
    ]) {
      assert.equal((await fetch(origin + path)).status, 404);
    }
    assert.equal((await fetch(origin + '/health')).status, 200);
    assert.equal(received.length, 0);
    assert.equal(
      (await fetch(`${origin}/api/payhero/callback/${secret}`, { method: 'POST', body: '{}' }))
        .status,
      415,
    );
    const response = await fetch(`${origin}/api/payhero/callback/${secret}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: 'private=secret' },
      body: '{}',
    });
    assert.equal(response.status, 200);
    assert.equal(received.length, 1);
    assert.equal(received[0].cookie, undefined);
    assert.equal(received[0].url, `/api/payhero/callback/${secret}`);
  } finally {
    await new Promise((resolve) => relay.close(resolve));
    await new Promise((resolve) => target.close(resolve));
  }
});
