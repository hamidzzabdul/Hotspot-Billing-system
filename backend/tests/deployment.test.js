import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDeployment } from '../../scripts/check-deploy.mjs';

function settings() {
  return {
    deploy: {
      DOMAIN: 'wifi.wifex.test',
      MONGO_ROOT_PASSWORD: 'a'.repeat(64),
      MONGO_APP_PASSWORD: 'b'.repeat(64),
    },
    backend: {
      NODE_ENV: 'production',
      APP_ORIGIN: 'https://wifi.wifex.test',
      PUBLIC_API_URL: 'https://wifi.wifex.test',
      ENCRYPTION_KEY: 'c'.repeat(64),
      ADMIN_EMAIL: 'owner@wifex.test',
      ADMIN_PASSWORD: 'DeploymentFixture123!',
      PAYMENT_MODE: 'disabled',
      ROUTER_MODE: 'live',
      ALLOW_ROUTER_HTTP: 'false',
    },
  };
}
test('production preflight accepts disabled collections and private router CA', () => {
  const { deploy, backend } = settings();
  deploy.ROUTER_CA_FILE = '/app/certs/wifex-ca.crt';
  assert.deepEqual(validateDeployment(deploy, backend), []);
});
test('production preflight rejects local origin, unsafe database URI password and laptop CA path', () => {
  const { deploy, backend } = settings();
  deploy.MONGO_APP_PASSWORD = 'unsafe@password';
  backend.APP_ORIGIN = 'http://localhost:3001';
  backend.NODE_EXTRA_CA_CERTS = 'D:/local/ca.crt';
  const errors = validateDeployment(deploy, backend);
  assert.ok(errors.some((e) => e.includes('MONGO_APP_PASSWORD')));
  assert.ok(errors.some((e) => e.includes('APP_ORIGIN')));
  assert.ok(errors.some((e) => e.includes('laptop-specific')));
});
test('production preflight rejects live collections without complete provider settings', () => {
  const { deploy, backend } = settings();
  backend.PAYMENT_MODE = 'live';
  assert.ok(validateDeployment(deploy, backend).some((e) => e.includes('PAYHERO')));
});
test('production preflight rejects public placeholders and certificates outside mount', () => {
  const { deploy, backend } = settings();
  deploy.DOMAIN = 'wifi.example.com';
  deploy.ROUTER_CA_FILE = '/etc/private.key';
  const errors = validateDeployment(deploy, backend);
  assert.ok(errors.some((e) => e.includes('real public hostname')));
  assert.ok(errors.some((e) => e.includes('ROUTER_CA_FILE')));
});
