// Scan the files Git would publish, without printing matching secret values.
import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) =>
  execFileSync('git', ['-c', `safe.directory=${root.replace(/[\\/]$/, '')}`, ...args], {
    cwd: root,
    encoding: 'utf8',
  });
const files = [
  ...new Set(
    git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean),
  ),
];
const secrets = new Set();
for (const name of ['backend/.env', 'deploy/.env']) {
  try {
    for (const [key, value] of Object.entries(
      parseEnv(await readFile(new URL(`../${name}`, import.meta.url), 'utf8')),
    )) {
      if (/PASSWORD|SECRET|TOKEN|ENCRYPTION_KEY/.test(key) && value.length >= 16)
        secrets.add(value);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
try {
  const credentials = JSON.parse(
    await readFile(new URL('../.local/live/operator-credentials.json', import.meta.url), 'utf8'),
  );
  if (credentials.password?.length >= 16) secrets.add(credentials.password);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const findings = [];
for (const file of files) {
  if (
    (/(?:^|\/)\.env(?:\.|$)/.test(file) && !/\.example$/.test(file)) ||
    /(?:^|\/)(?:\.local|backups)\//.test(file) ||
    /\.(?:backup|rsc|key|p12|pfx|archive(?:\.gz)?)$/i.test(file) ||
    /(?:^|\/)operator-credentials\.json$/.test(file)
  ) {
    findings.push(`${file}: private runtime file must not be committed`);
    continue;
  }
  try {
    if ((await stat(new URL(`../${file}`, import.meta.url))).size > 5_000_000) continue;
    const content = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    if (/-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/.test(content))
      findings.push(`${file}: private key detected`);
    if ([...secrets].some((value) => content.includes(value)))
      findings.push(`${file}: contains a configured local secret`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
if (findings.length) {
  findings.forEach((finding) => console.error(finding));
  process.exitCode = 1;
} else
  console.log(
    `Checked ${files.length} Git candidate files: no private runtime files, private keys or configured local secrets found. This does not audit prior Git history.`,
  );
