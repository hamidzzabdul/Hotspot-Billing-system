# Wifex

A Wi-Fi hotspot billing application with a Next.js/TypeScript frontend and a separate Node.js, Express, and MongoDB backend. Designed for Pay Hero collections and MikroTik RouterOS hotspots on a VPS.

## Deployment and GitHub

Use [the VPS deployment guide](docs/VPS_DEPLOYMENT.md) for production. The stack
includes Caddy HTTPS, separate frontend/backend containers, authenticated MongoDB
with a replica set, health checks, and a read-only mount for private router CA
certificates. Start from `backend/.env.production.example`, not the laptop's `.env`.

Before committing, run `npm run check:secrets`, `npm run format:check`,
`npm run lint`, `npm test`, and `npm run build`. GitHub Actions repeats these checks
and builds and starts the container stack with disposable credentials. It does not
deploy automatically or contact Pay Hero or a real MikroTik.

Local database files, environment files, operator credentials, customized captive
pages, router backups, and certificate keys must remain outside Git. The secret
check scans candidate files and known local secrets, not prior commit history.
Use a new production administrator password rather than a password shared in chat.

## Local installation

Requires Node.js 20.19+ and MongoDB. No sample users, routers, plans, payments, or history are created.

```sh
npm install
cp backend/.env.example backend/.env
npm run build
npm run start:local
```

The app runs at `http://localhost:3001` with a persistent database in `.local/live/mongo`. The first launch creates a single operator account with a random password, saved in `.local/live/operator-credentials.json` (or uses `ADMIN_EMAIL` and `ADMIN_PASSWORD` when configured). Keep that file private. Create your actual plans and routers from the dashboard. Restart with the same command; records and credentials persist.

The launcher uses an installed `mongod` executable (`MONGOD_PATH` can specify it). On this Windows installation it can reuse the already-downloaded MongoDB executable. Alternatively, set `WIFEX_LOCAL_MONGODB_URI` to an existing authenticated MongoDB replica set; no database process is launched in that case. The built-in local database binds to loopback only and is intended for a trusted local machine. Use the authenticated deployment stack for a shared server.

The web server listens on the LAN. To let hotspot clients use it, set `WIFEX_LOCAL_ORIGIN=http://YOUR_LAN_IP:3001` before starting and use that exact origin in the router bridge. Only allow the web port from your trusted network; the API and built-in database stay on loopback. The local launcher uses HTTP-compatible session cookies. For public production use, configure HTTPS and run the supplied production deployment; do not expose this local HTTP installation to the internet.

The local installation uses a separate database from the former preview. Existing preview data is left untouched and is never loaded into the live installation. There is no simulation mode. Online collections remain disabled until a public HTTPS callback endpoint and payment credentials are configured. A local-only callback URL cannot receive provider callbacks.

## Automatic hotspot context

Upload `hotspot/login.html` to each real router after setting its portal origin and router ID. RouterOS supplies the device MAC in the redirect. Customers select only their plan and enter their payment phone number; there is no building or hotspot dropdown. Without the captive-portal context, purchases, vouchers, and credit are blocked with an instruction to open the Wi-Fi sign-in page. The backend checks that the device is actually present on that router before starting payment or granting access. Context is kept together in session storage, and a new captive-portal link replaces it.

## Guest checkout

Clients can choose a plan and pay without registering or signing in. Checkout uses a private HttpOnly browser cookie to protect the payment status, receipt, and Connect device action. Keep the same browser to resume a purchase; knowing a phone number or payment ID alone does not grant access. Optional signed-in purchases still appear in account history. Guest purchases are never attached to an existing account based only on the payer’s phone number.

## Application

- Customer portal: `/` or `/connect`
- Customer account: `/account`
- Customer sign-in / registration: `/login`
- Operator dashboard: `/admin`
- Operator sign-in: `/admin/login`

Implemented workflows include persisted plan management; account registration, login and password changes; Pay Hero STK initiation, verification and durable callback processing; payment history and actual receipt downloads; MikroTik provisioning and access expiry; customer blocking/restoration; one-use vouchers; internet credit and repayments; support conversations; operator reports and CSV exports; and an audit log.

Financial collection, access provisioning, and connected-device monitoring have separate states. A paid customer is not shown as connected until the router reports a connection. A failed router call is retried and shown as a problem instead of being treated as success.

## Project layout

```text
frontend/        Next.js App Router, TypeScript, responsive operator/customer UI
backend/src/     Express API, MongoDB models, billing worker, integration adapters
backend/tests/   Integration and adapter tests
scripts/         Persistent local installation launcher
hotspot/         MikroTik captive-portal login bridge
 deploy/         Dockerfiles, Caddy HTTPS proxy, MongoDB initialization
 docs/           Reference review, architecture, deployment, screenshots
```

## Development with your own database

```sh
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

Set `MONGODB_URI` to a MongoDB replica set. Set a 64-character random hex `ENCRYPTION_KEY`, administrator credentials, and the desired integration modes. Use the documented production settings for live credentials; no real credentials are supplied with this repository.

```sh
npm run seed
npm run dev
```

The default API is `http://127.0.0.1:4000`. The web application uses `http://localhost:3000`. If you change the frontend port, change `APP_ORIGIN` to match it exactly. The frontend proxies `/api` using `API_INTERNAL_URL`. Do not run multiple API servers on the same port.

## Validation

```sh
npm run lint
npm test
npm run build
```

Tests use an isolated MongoDB replica set, not your development or production database. They cover authentication, authorization, input validation, ownership, idempotent settlement, callback verification, voucher races, credit repayment, support, account blocking, expiry, provider timeouts, and provisioning/revocation failures. Router and Pay Hero responses are controlled test adapters; live integrations require staging acceptance.

## Pay Hero configuration

Direct Safaricom Daraja integration has been removed. Keep `PAYMENT_MODE=disabled` until `PAYHERO_AUTH_TOKEN`, `PAYHERO_CHANNEL_ID`, `PAYHERO_CALLBACK_SECRET`, and `PUBLIC_API_URL` are configured in `backend/.env`. Set `PAYMENT_MODE=live` only when ready to accept real payments. Credentials stay on the server. See [Pay Hero setup](docs/PAYHERO_SETUP.md).

## VPS and live integration

Follow [the VPS deployment guide](docs/VPS_DEPLOYMENT.md). The supplied Docker Compose stack includes an authenticated MongoDB replica set, the separate API/frontend services, and Caddy for public HTTPS. No application or database port is published directly.

You will need a public domain, a Pay Hero Basic Auth token and payment channel ID, and VPN access to a configured RouterOS 7.10+ hotspot with HTTPS REST and HTTPS customer login. Real STK payments, hardware expiry, captive-browser login, and Docker startup must be verified on that infrastructure before serving paying customers. Docker was unavailable in the build environment.

For deployment configuration and credentials, use the example environment files. There are no default production credentials. Environment files and local data are ignored by Git.

Read [the reference analysis](docs/REFERENCE_ANALYSIS.md) for the original system's workflows and defects, and [the architecture/API guide](docs/ARCHITECTURE.md) for implementation details and integration boundaries.

Refunds/reversals are not implemented; the app never labels a database edit as a money transfer. Receipts are downloadable text files. SMS/OTP, a full accounting ledger, PDF invoices, and automatic router network setup are outside this release.
