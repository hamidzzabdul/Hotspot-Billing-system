# Architecture and API

## Runtime

`frontend/` is a Next.js App Router application written in TypeScript. `backend/` is an independently runnable Node.js/Express application with Mongoose persistence. The root npm workspaces share installation and convenience scripts. The backend does not import Next.js or run the frontend.

The browser uses `/api` on the same origin. Next rewrites those requests to `API_INTERNAL_URL`, keeping backend addresses out of client code and letting HttpOnly session cookies work without cross-origin token storage. Set that variable before building; the rewrite destination is evaluated by Next at build time. Docker builds set it to `http://backend:4000`.

MongoDB must be a replica set, including in single-server deployments, because settlement, voucher redemption, and loan origination use transactions. The API checks this requirement on startup.

## Guest checkout

Plan purchases do not require a registered account. POST /checkout/session establishes a random, HttpOnly, SameSite browser cookie backed by a hashed GuestSession token. The internal guest customer has no login credentials and does not claim an existing phone-number account. POST /payments also accepts signed-in buyers. GET /payments/:id, /payments/:id/receipt, and /payments/:id/credentials authorize against the account or guest browser, and responses are not cached. Guest status remains visible through provisioning and exposes Connect device directly on the portal. Browser credentials cannot open account, credit, support, or operator endpoints.

## Payment lifecycle

`initiating → pending → completed` is the normal flow. A definitive provider rejection becomes `failed`. An interrupted or late confirmation becomes `review` and remains eligible for a verified later callback. The app never marks an unconfirmed payment as paid because time has passed.

The client sends a UUID idempotency key; a stored user-scoped key returns the same purchase on retries. Price, duration, and speed are selected from the database. The callback inbox persists events before returning 200; its worker queries Pay Hero and validates metadata. Settlement creates one queued access pass and marks the payment completed in a transaction. Unique source keys and receipts prevent duplicate grants.

Do not mutate a paid record to simulate a refund. Refunds/reversals are not implemented. The operator can investigate a pending/review payment using **Check payment**. A successful query can settle the purchase only when the returned Pay Hero reference matches the stored reference and includes a verified receipt. A queued result remains pending. Legacy transactions cannot be queried or settled through Pay Hero.

## Access lifecycle

`queued → provisioning → active → revoking → expired/disconnected`.

A 5-second worker claims queued passes with a lease. Credentials are generated per pass and encrypted. Router failures keep the pass queued with a visible reason. Provisioning uses RouterOS 7 REST, creates a speed-limited profile and a disabled MAC-bound user, installs a router-local expiry guard, and then enables the user. The window starts when provisioning begins; retries preserve the same window.

The server expires active passes and revokes router credentials, live sessions, cookies, and expiry schedulers. Revocation failures remain queued for retry. A router-local guard checks epoch time every 30 seconds so expiry is also enforced during VPS outages. Accurate router NTP and required script permissions are necessary. The router also has a cumulative uptime cap.

The connected flag is refreshed from actual RouterOS active entries every 30 seconds. An active paid pass does not imply a device is currently online. Simulation never reports real connected devices.

## Security and operation

- Passwords: bcrypt with cost 12. Cookie sessions: random 256-bit tokens, hashed in the database, TTL expiry, HttpOnly/SameSite cookies, Secure in production.
- Router/access credentials: AES-256-GCM with `ENCRYPTION_KEY`. Back up this key independently; losing it prevents credential recovery and revocation.
- Role checks are enforced by Express. Customer payment, access, credit, and support reads are scoped to the signed-in user.
- JSON-only write requests require the configured `APP_ORIGIN`. Provider callbacks use a random path secret and independent Pay Hero query verification.
- Body size limits, request limiting, explicit input schemas, bounded pagination, and escaped text searches.
- Secrets are configured in server environment files, not in the browser. There are no default production logins and no production simulation mode.
- Run one backend process for the supplied single-VPS deployment. Provisioning leases and database constraints provide additional protection, but router polling and rate-limit state are process-local. Horizontal scaling needs shared rate limiting and dedicated worker ownership.

## API groups

All routes have the `/api` prefix. JSON errors are `{ "error": "..." }`. List responses contain `items`, `total`, `page`, and `pages`; pagination uses `page` and `limit` (maximum 100).

| Access           | Routes                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| Public           | `GET /health`, `/public/config`, `/public/plans`                                                                |
| Authentication   | `POST /auth/register`, `/auth/login`, `/auth/logout`, `/auth/password`; `GET /auth/me`                          |
| Purchases        | `POST /payments`; `GET /payments/:id`, `/payments/:id/receipt`                                                  |
| Provider         | `POST /payhero/callback/:secret`                                                                                |
| Customer         | `GET /me/payments`, `/me/sessions`, `/me/sessions/:id/credentials`, `/me/loans`, `/me/tickets`                  |
| Customer actions | `POST /vouchers/redeem`, `/me/loans`, `/me/loans/:id/repay`, `/me/tickets`, `/me/tickets/:id/replies`           |
| Admin reporting  | `GET /admin/overview`, `/admin/payments`, `/admin/customers`, `/admin/sessions`, `/admin/loans`, `/admin/audit` |
| Plans            | `GET/POST /admin/plans`; `PATCH /admin/plans/:id`                                                               |
| Customers        | `POST /admin/customers`; `PATCH /admin/customers/:id` (block/restore)                                           |
| Sessions         | `POST /admin/sessions/:id/disconnect`                                                                           |
| Payments         | `POST /admin/payments/:id/reconcile`                                                                            |
| Routers          | `GET/POST /admin/routers`; `PATCH /admin/routers/:id`; `POST /admin/routers/:id/test`                           |
| Vouchers         | `GET/POST /admin/vouchers`; `POST /admin/vouchers/:id/revoke`                                                   |
| Support          | `GET /admin/tickets`; `PATCH /admin/tickets/:id`                                                                |
| Settings         | `GET/PATCH /admin/settings`                                                                                     |

## Integrations

Router implementation follows the [official RouterOS REST documentation](https://manual.mikrotik.com/docs/developer-guides/rest-api/), [HotSpot manual](https://manual.mikrotik.com/docs/authentication-authorization-accounting/hotspot-captive-portal/), and [scheduler documentation](https://help.mikrotik.com/docs/spaces/ROS/pages/40992881/Scheduler). Pay Hero Kenya v2 uses Basic Auth, the payments endpoint, and the transaction-status endpoint. See [Pay Hero setup](PAYHERO_SETUP.md) for configuration and official documentation. Direct Safaricom OAuth/Daraja endpoints are no longer used.
