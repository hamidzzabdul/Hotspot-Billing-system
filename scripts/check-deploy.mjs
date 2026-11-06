import { readFile, access } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { configuration } from '../backend/src/config.js';

export function validateDeployment(deploy, backend) {
  const errors = [];
  const domain = deploy.DOMAIN || '';
  if (
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain) ||
    /(?:^|\.)example\.(com|org|net)$/i.test(domain)
  )
    errors.push('DOMAIN must be your real public hostname, without a protocol or path.');
  for (const key of ['MONGO_ROOT_PASSWORD', 'MONGO_APP_PASSWORD']) {
    if (!/^[a-f0-9]{64}$/i.test(deploy[key] || ''))
      errors.push(
        `${key} must be 64 random hex characters (safe for connection URIs and Compose).`,
      );
  }
  if (deploy.MONGO_ROOT_PASSWORD === deploy.MONGO_APP_PASSWORD)
    errors.push('MongoDB root and app passwords must differ.');
  if (backend.NODE_ENV !== 'production') errors.push('NODE_ENV must be production.');
  for (const key of ['APP_ORIGIN', 'PUBLIC_API_URL']) {
    if (backend[key] !== `https://${domain}`) errors.push(`${key} must equal https://DOMAIN.`);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(backend.ADMIN_EMAIL || ''))
    errors.push('Set a valid ADMIN_EMAIL for initial seeding.');
  if (
    (backend.ADMIN_PASSWORD || '').length < 12 ||
    Buffer.byteLength(backend.ADMIN_PASSWORD || '') > 72
  )
    errors.push('ADMIN_PASSWORD must have at least 12 characters and at most 72 UTF-8 bytes.');
  if (backend.ALLOW_ROUTER_HTTP !== 'false') errors.push('ALLOW_ROUTER_HTTP must be false.');
  if (backend.ROUTER_MODE !== 'live') errors.push('ROUTER_MODE must be live.');
  if (backend.NODE_EXTRA_CA_CERTS || backend.WIFEX_LOCAL_ORIGIN)
    errors.push(
      'Remove laptop-specific NODE_EXTRA_CA_CERTS/WIFEX_LOCAL_ORIGIN; use ROUTER_CA_FILE in deploy/.env.',
    );
  if (deploy.ROUTER_CA_FILE && !/^\/app\/certs\/[a-z0-9_.-]+\.crt$/i.test(deploy.ROUTER_CA_FILE))
    errors.push('ROUTER_CA_FILE must name a .crt file directly under /app/certs.');
  try {
    configuration(backend);
  } catch (error) {
    errors.push(error.message);
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  try {
    const deploy = parseEnv(await readFile(path.join(root, 'deploy/.env'), 'utf8'));
    const backend = parseEnv(await readFile(path.join(root, 'backend/.env'), 'utf8'));
    const errors = validateDeployment(deploy, backend);
    if (deploy.ROUTER_CA_FILE && /^\/app\/certs\/[^/]+\.crt$/.test(deploy.ROUTER_CA_FILE)) {
      const cert = path.join(root, 'deploy/certs', path.basename(deploy.ROUTER_CA_FILE));
      await access(cert).catch(() =>
        errors.push('Copy the public router CA certificate into deploy/certs.'),
      );
    }
    if (errors.length) {
      for (const error of errors) console.error(`- ${error}`);
      process.exitCode = 1;
    } else
      console.log(
        'Production settings validated. No secrets were printed. Run docker compose config --quiet next.',
      );
  } catch (error) {
    console.error(
      error.code === 'ENOENT'
        ? 'Create deploy/.env and backend/.env from the production examples first.'
        : 'Could not validate production environment files.',
    );
    process.exitCode = 1;
  }
}
