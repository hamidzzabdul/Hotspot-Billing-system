# VPS deployment

This repository targets a single Linux VPS with Docker Engine and Docker Compose v2 (2.24 or later). Use Node.js 22 for validation outside containers. Docker is unavailable on the development laptop; GitHub Actions builds and starts the container stack with disposable credentials. A passing container job and actual VPS/router acceptance tests are still required before taking customer payments.

The deployment creates a fresh production database. Laptop records and settings are not copied automatically. Initially create real plans and the router on the VPS. If existing customer/payment data must be migrated, plan a separate backup/restore with the original encryption key before accepting further transactions; never copy live MongoDB data files or publish them to Git.

## 1. DNS and network

Point a domain such as `wifi.example.com` at the VPS. Allow inbound TCP 80/443 and UDP 443 if using HTTP/3. Only Caddy publishes ports; MongoDB, Express, and Next remain internal to Docker networks.

Connect the VPS to each MikroTik management network over a private VPN. RouterOS REST uses HTTPS and validates certificates. Keep the router clock synchronized with NTP. Minimum target: RouterOS 7.10 or later with `:timestamp` and `:tonsec`; test your specific RouterOS version before accepting paid users.

## 2. Configuration

```sh
cp deploy/.env.example deploy/.env
cp backend/.env.production.example backend/.env
chmod 600 deploy/.env backend/.env
```

Generate a different random hex secret for each password/key/secret field:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

In `deploy/.env` set `DOMAIN`, `MONGO_ROOT_PASSWORD`, and `MONGO_APP_PASSWORD`. Use URL-safe hex for MongoDB passwords because the app password is inserted into a connection URI.

In `backend/.env` set:

- `NODE_ENV=production`
- `APP_ORIGIN=https://wifi.example.com` (exact origin, without a trailing slash)
- `PUBLIC_API_URL=https://wifi.example.com`
- `ENCRYPTION_KEY`: exactly 64 hex characters
- `ADMIN_EMAIL`, `ADMIN_PASSWORD` (12+ characters), `ADMIN_NAME`: used only by the explicit seed command
- `PAYMENT_MODE=disabled` until the Pay Hero account is configured; then explicitly use `live`
- `PAYHERO_AUTH_TOKEN`, `PAYHERO_CHANNEL_ID`, and a random `PAYHERO_CALLBACK_SECRET` of at least 32 characters
- `ROUTER_MODE=live`, `ALLOW_ROUTER_HTTP=false`

Do not copy laptop `WIFEX_LOCAL_ORIGIN`, Windows certificate paths, or callback-tunnel settings. With a private router CA, securely copy only its public `.crt` to `deploy/certs/wifex-ca.crt` and set `ROUTER_CA_FILE=/app/certs/wifex-ca.crt` in `deploy/.env`. Compose mounts that directory read-only and supplies `NODE_EXTRA_CA_CERTS` before Node starts. Leave `ROUTER_CA_FILE` blank for a publicly trusted management certificate. Never copy CA private keys to the VPS.

Before startup, validate settings (no secret values are printed):

```sh
npm ci
npm run check:deploy
docker compose --env-file deploy/.env config --quiet
```

Do not post the output of `docker compose config` without `--quiet`; it contains resolved credentials.

Compose supplies the production MongoDB connection and container bind address. It initializes an authenticated, single-member replica set and a database-scoped app user. Database and key material persist in named volumes. Changing MongoDB passwords after first initialization requires changing the database users as well; editing environment variables alone does not rotate existing users.

## 3. Build and initialize

Run from the repository root:

```sh
docker compose --env-file deploy/.env build
docker compose --env-file deploy/.env up -d mongo
docker compose --env-file deploy/.env run --rm mongo-init
docker compose --env-file deploy/.env run --rm --no-deps backend node src/seed.js
docker compose --env-file deploy/.env up -d
docker compose --env-file deploy/.env ps
```

Sign in at `https://wifi.example.com/admin/login`. The seed preserves existing accounts and creates no plans, payment history, or sample customers. Create your real plans in the dashboard. Caddy issues and renews the public certificate automatically once DNS resolves and ports 80/443 are reachable.

Check `https://wifi.example.com/api/health`. Inspect logs without sharing full environment files:

```sh
docker compose --env-file deploy/.env logs --tail=100 backend frontend proxy
```

The frontend rewrite targets `http://backend:4000` in its Docker build. If deploying without Docker, build the frontend with `API_INTERNAL_URL` set to your internal Express address and start the backend independently. Keep both behind the same public HTTPS origin.

Only 80/443 are published. Permit SSH only from your administration addresses and permit the VPN's chosen UDP port. Do not publish MongoDB 27017, backend 4000, or frontend 3000. Use the domain for operator login so write requests carry the configured origin. Do not run `npm run start:local` on the VPS.

## 4. Pay Hero

Follow [Pay Hero setup](PAYHERO_SETUP.md). Direct Safaricom Daraja calls and callback routes have been removed. Configure these server-side variables before enabling real payments:

- PAYMENT_MODE=live
- PAYHERO_AUTH_TOKEN (Basic Authorization token from your Pay Hero API Keys)
- PAYHERO_CHANNEL_ID (the numeric collection channel ID)
- PAYHERO_CALLBACK_SECRET (a random secret of at least 32 characters)
- PUBLIC_API_URL=https://wifi.example.com

The callback URL is https://wifi.example.com/api/payhero/callback/YOUR_RANDOM_CALLBACK_SECRET. New callbacks are durably queued, checked against the original external/checkout references, and independently verified with Pay Hero transaction-status. Successful status checks require the exact provider reference and a verified receipt. QUEUED is never treated as failed or paid. Legacy payments must be reviewed with their original provider.

The documented Pay Hero Kenya v2 endpoint is a production endpoint. There is no assumed sandbox mode in this app. Tests use offline fixtures. Arrange provider-approved testing for your account before real-money acceptance tests. Leave PAYMENT_MODE=disabled when credentials are unavailable. No API credentials belong in frontend environment variables.

Test success, cancellation, duplicate/delayed callbacks, provider timeout, missed-callback reconciliation, and router outages before accepting customer payments. Keep proxy/access logs disabled for secret callback URLs, or redact the callback path. The supplied Caddyfile does not enable access logs.

## 5. MikroTik

1. Enable a configured HotSpot service. This app manages billing users; it does not replace initial router interfaces, DHCP, NAT, DNS, or HotSpot server setup.
2. Enable `www-ssl` with a trusted certificate. If using a private CA, mount its CA certificate into the backend and set `NODE_EXTRA_CA_CERTS` to that path. Do not disable TLS validation.
3. Create a dedicated REST user limited to the permissions needed to read/write HotSpot users/profiles, active sessions/cookies, and schedulers. API and REST permissions are required; scheduler management may also require policy/test rights on your RouterOS version. Restrict the account and service to the VPS VPN IP. Test with the actual permission set rather than using the router’s primary administrator.
4. In Wifex **Routers**, add the origin-only REST base URL, API username/password, location, and the actual HotSpot HTTPS login URL (ending in `/login`). Test the connection.
5. Configure HotSpot HTTPS login and a matching certificate. The customer’s browser posts generated credentials to that configured URL. CHAP-only login is not supported by this form flow.
6. Replace the public origin and router ID placeholders in `hotspot/login.html`, then upload it as your HotSpot login page. The router ID can be obtained from the authenticated `GET /api/admin/routers` response.
7. Add the portal domain/IP to the unauthenticated HotSpot walled garden. Ensure the hotspot login hostname resolves correctly for captive clients. Verify both Android and iOS captive browser flows.
8. Run a real short-duration plan and confirm speed enforcement, MAC binding, login, disconnect, expiry, and cookie removal. Test expiry with the backend stopped and after router reboot; the local guard should disable expired users within its 30-second interval.

For the existing RB5009, `192.168.88.1` is currently a laptop-only management address. A VPS cannot reach it without the VPN and appropriate routing. Use a certificate whose SAN matches the VPN address or management hostname placed in Wifex. Restrict the router service, REST user allowed-address setting and firewall to the backend's actual VPN source address; allow required forwarded traffic from Docker through the host VPN and verify the return route.

Use separate hostnames such as `wifi.yourdomain.com` (portal, resolves to VPS) and `login.yourdomain.com` (customer login, resolves to the router HotSpot address for captive clients). Obtain a publicly trusted certificate for the latter, for example through DNS-01, and import it with its private key into RouterOS. Configure renewal and replacement on the router. Caddy's portal certificate does not automatically install a HotSpot certificate. Replace `hotspot.test` and LAN-only portal links before launch; never ask customers to install a CA.

Check `/system/device-mode/print`: both `hotspot` and `scheduler` must be `yes`. Check NTP and router clock. Remove the temporary test HotSpot account and its active sessions/cookies once production login passes. Do not enable broad bypass bindings for paying clients. Avoid FastTrack for HotSpot traffic so queue limits are enforced.

Do not enable paid production access until this test passes on the actual router. The test suite simulates the adapter and cannot verify your hardware, TLS, routing, NTP, or RouterOS script permissions.

## 6. Backup and recovery

Back up MongoDB, `backend/.env`, the encryption key, and the MongoDB replica-set key volume securely and separately. Protect environment files with restrictive permissions. Losing `ENCRYPTION_KEY` prevents decrypting router and access credentials. Do not remove named volumes during upgrades.

Example database archive using the database container’s root credentials:

```sh
mkdir -p backups
docker compose --env-file deploy/.env exec -T mongo bash -c 'mongodump --username root --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --db wifex --archive --gzip' > backups/wifex.archive.gz
```

Store encrypted off-VPS copies and verify restoration into an isolated replica set before relying on the backup. Establish a retention policy for payments, callback events, access records, and audit records appropriate to your business. Audit and callback collections are not automatically purged by this release.

Never run `docker compose down --volumes` on the VPS unless intentionally deleting all database and certificate data. A fresh server requires the production environment secrets, original encryption key for restored data, database archive, and router/VPN configuration. Keep these outside GitHub.

## 7. Updates

Back up first, then pull reviewed changes, rebuild, and run `docker compose --env-file deploy/.env up -d`. The API recreates missing indexes on startup; inspect index errors before serving traffic. Single-member MongoDB is durable across process/container restarts but is not highly available. Production monitoring should cover disk space, database health, callback backlogs, queued/revoking access, router status, TLS expiry, and backup restoration.
