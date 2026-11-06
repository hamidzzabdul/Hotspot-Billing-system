# Reference project review

Reviewed source: `D:\Projects\wifex\Mpesa-Based_Wi-Fi-Hotspot_Billing_System`.
The reference was read in place; it has not been modified. This is a fresh implementation in `wifex-2`.

## Product and workflows

The reference is a Kenyan prepaid hotspot service. Its main customer journey is:

1. Detect a device MAC from MikroTik or the captive portal.
2. Choose one of four plans: KES 10 / 1 hour / 2 Mbps, KES 15 / 4 hours / 3 Mbps, KES 20 / 12 hours / 4 Mbps, KES 30 / 24 hours / 5 Mbps.
3. Sign in, supply a Kenyan M-Pesa number, and request an STK prompt.
4. Store the checkout request, wait for the provider callback, and grant device access.
5. Show customer purchase history, provide help, and optionally offer borrowed internet access.

The operator journey covers customer accounts, payments, network devices, internet loans, support requests, and settings. Some parts of that UI are present without equivalent backend behavior.

## Source architecture

| Area               | Reference implementation                                    | Findings                                                                                                                                                                                                                                                 |
| ------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime            | `server.js` prepares Next and mounts Express in one process | Frontend deployment and API lifecycle are coupled. Several routes duplicate functionality from `routes/admin.js`.                                                                                                                                        |
| Persistence        | `prisma/schema.prisma`, `config/prismaClient.js`            | PostgreSQL is the declared primary database; local development also has SQLite compatibility. A separate admin model and two different customer models create identity ambiguity.                                                                        |
| Authentication     | `routes/auth.js`, `routes/admin.js`, auth middleware        | Customer passwords are bcrypt hashes. Admin sign-in compares environment passwords directly. Auth logic is repeated, and the frontend stores bearer tokens in local storage.                                                                             |
| STK initiation     | `config/mpesa.js`, `routes/mpesaRoutes.js`                  | OAuth, STK payload creation, local transaction reference, and provider checkout ID exist. The requested amount comes from the browser and is checked against a fixed price table.                                                                        |
| Callbacks          | `routes/mpesaCallback.js`                                   | Provider IDs and receipts share the `mpesaRef` column. The checkout ID is overwritten by the receipt. Loan detection assumes the provider ID contains the application’s loan prefix.                                                                     |
| Access             | `config/mikrotik.js`                                        | Adds `bypassed` IP bindings. The purchased time appears in a comment rather than an enforceable expiration. The configured speed is not provisioned. Disabled integration sometimes returns success.                                                     |
| Customers          | `server.js`, `routes/admin.js`                              | Block, unblock, and deletion handlers return success without performing the action. One disconnect path uses an undefined SQL connection; another reads a field name that does not match the Prisma selection.                                           |
| Reporting          | admin summary and transaction routes                        | Completed revenue is aggregated, but active sessions are a hardcoded zero. Some field names disagree (`time_purchased` versus `timePurchased`).                                                                                                          |
| Credit             | `routes/loanRoutes.js`, `services/loanService.js`           | A recent purchase is intended to establish eligibility. One outstanding loan, KES 10 principal, 10% interest, and a 7-day due date are the basic rules. The source creates a loan but does not consistently grant the borrowed access at borrowing time. |
| Repayment          | loan routes and M-Pesa callback                             | Uses STK collection, but callback correlation is unreliable and MAC lookup depends on a loosely related activity record. The customer status endpoint does not consistently apply ownership checks.                                                      |
| Support            | `routes/support.js`                                         | Stores requests and permits status updates. Some duplicate admin endpoints instead return empty data or unconditional success.                                                                                                                           |
| Refunds / receipts | `routes/transactions.js`, duplicate admin endpoints         | One refund route only changes a database status; it does not reverse a payment. The receipt route returns a PDF path without generating a file.                                                                                                          |
| Real-time updates  | Socket.IO in `server.js` and frontend client                | Room logic exists. Core data is not consistently populated or emitted by the purchase flow. The frontend frequently polls as well.                                                                                                                       |
| Local simulation   | `services/localPayments.js`, local dev script, test         | Explicit local-mode payment simulation exists, with production checks. It completes a purchase after a delay without real provider/router access.                                                                                                        |
| Deployment         | Docker, PM2, Render, Railway, Vercel configuration          | Multiple deployment patterns overlap. Some assume the combined Express/Next process and PostgreSQL. They are not appropriate unchanged for the requested separate MongoDB backend.                                                                       |

## Data model mapping

The new system consolidates `AuthUser` and billing customers into `User`, with a role and normalized phone number. `AuthSession` contains a hash of an opaque browser session token. Customer and operator authentication use the same server-enforced authorization path.

`Plan` is now a persisted record. `Payment` stores an immutable snapshot of the purchased plan’s price, speed, and duration. Later plan edits affect new purchases only. It has distinct application reference, checkout ID, merchant ID, and receipt fields.

`Access` represents the entitlement separately from the payment. Payment collection succeeds independently of a temporary router outage; queued access remains visible and can be retried. Active entitlement and actual connected device state are separate concepts.

`Router` contains encrypted REST credentials and operational status. `Voucher` stores hashed one-use codes. `Loan` records principal, agreed total due, open state, and due date. `Ticket` includes a conversation and status. `Audit` records operator and billing actions. `CallbackEvent` is a durable provider callback inbox.

## Current payment provider

The original project used direct Safaricom Daraja. At the operator’s request, the current implementation now uses Pay Hero Kenya v2. Direct Daraja code and routes have been removed; new payments remain disabled until Pay Hero credentials are configured. The source review above describes the historical reference, not the active provider.

## Rebuilt behavior

- Server-side plan pricing; client-supplied prices are ignored.
- Idempotent initiation, unique checkout/receipt constraints, and transactional payment settlement/access creation.
- Callback payloads are persisted before acknowledgement. The worker verifies checkout results independently with Pay Hero before settlement and checks amount, phone, provider reference, and receipt.
- Missing or interrupted provider responses are reviewable states, not fabricated success or a reason to charge a second time.
- Database-backed cookie sessions, HttpOnly cookies, origin checks for writes, rate limiting, schema validation, role checks, and ownership filters.
- RouterOS users with MAC binding, speed profiles, uptime limits, and a router-local expiry guard, plus server-side expiry/revocation retry.
- Real block/restore, disconnect, plan editing, router configuration, voucher creation/revocation/redemption, receipt downloads, and support responses.
- Credit is disabled by default. When enabled, eligible customers accept the displayed terms; borrowing grants the entry plan immediately. Repayment settles the loan instead of granting an unrelated second paid pass.
- No refund button that pretends to move money. Provider reversal is outside the implemented collection workflow; a real reversal integration would be a separate feature.
- A downloadable text receipt is generated from the completed payment, rather than returning a nonexistent PDF URL.
- Periodic refresh of operational pages replaces the incomplete Socket.IO paths. There is no requirement for a separate WebSocket service.

## UX direction

The operator workspace uses a fixed navigation rail, quiet green accents, neutral surfaces, compact readable data tables, and consistent forms. Actions show progress and visible results. Destructive access actions use confirmation dialogs; server errors are shown rather than replaced with successful-looking demo data.

The customer portal is a separate mobile-first flow with four comparable plans, a single purchase dialog, payment progress, a personal access page, voucher redemption, and support conversations. Payment PINs are entered only on the user’s phone. Device identity comes from the captive portal in live mode; the app does not invent a MAC address.

## Verification boundaries

Local integration tests use a real isolated MongoDB replica set. Provider and router adapters are simulated or controlled test doubles. Browser inspection covered the public portal, sign-in, desktop dashboard, mobile navigation, and saving plan edits.

Live Pay Hero settlement, RouterOS scripting/permissions on the actual hardware, certificates, captive-browser login, VPS networking, Docker startup, backup restore, and real device throughput require staging acceptance with the operator’s infrastructure. Those external outcomes have not been claimed as verified.
