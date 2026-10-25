# LaVerdad-Softphone

A blue-themed, web-based contact-center workspace prototype for teams handling inbound and outbound calls.

## Current prototype

- Sign-in screen and employee access request screen (demo only; no real authentication).
- Dashboard with team presence, sample service metrics, recent activity, and assigned skills.
- Hover-expand navigation: Dashboard, Softphone, Team & Presence, Call Activity, Contacts, Skills & Queues, and Reports.
- Softphone popup with dial pad, inbound/outbound mode, simulated call states, mute UI, presence selector, recent activity, and contacts.
- Contact directory with add-contact form and CSV exports for team/activity.
- Responsive layout for desktop and mobile.

## Preview access

Open the app and use username `demo` with any non-empty password. Other usernames are rejected by the preview login. This is only a UI demonstration: it does **not** authenticate real employees. The employee access form validates fields in the browser but does not save or send a request. Contacts and call activity added in the browser are in-memory demo data. Do not enter real passwords or sensitive employee/customer information.

## Cloudflare deployment

The current live address shared for this project is `https://laverdad-softphone.marjoeobadocasidsid.workers.dev/` (Cloudflare Workers hostname). The app files are static HTML, CSS, and JavaScript with no build step. Verify the deployment target and its GitHub integration in the Cloudflare dashboard before assuming that commits to `main` deploy automatically. If using Cloudflare Pages, select the `main` branch, leave the build command blank, and set the output directory to `/` (repository root).

## Production architecture required

Real inbound/outbound calling and employee accounts require backend services; do not treat the current interface as production-ready. Recommended next steps:

1. **Authentication and roles:** secure server-side sessions, password hashing, password reset, MFA option, rate limiting, audit trail, and role-based access (Owner/Admin, Supervisor, Agent).
2. **Telephony:** choose a provider/SIP trunk (for example, Twilio, Telnyx, or a company-managed SIP platform), then implement browser calling with a supported WebRTC/SIP SDK. Inbound routing, outbound caller ID, recordings, and call controls depend on provider configuration and regional/legal requirements.
3. **Cloudflare backend:** Cloudflare Workers API, D1 for application records, and encrypted secrets for provider credentials; never expose provider API secrets in browser code.
4. **Live team presence:** WebSocket or Durable Objects coordination for Available, Unavailable, On Phone, On Wrap, and Logged Out; enforce presence server-side.
5. **Operational records:** call detail records, dispositions, notes, queue/skill assignment, supervisor permissions, and reporting.
6. **Privacy and compliance:** consent notices, retention controls, access logging, recording policy, and applicable telecommunications/privacy compliance before handling real customer data.

## Backend foundation (implementation in progress)

The repository now includes a Cloudflare Worker API and a D1 migration for employee access requests. The request form submits only the employee name, requested username, and work email; it does not ask for a password. The API validates input, limits submissions per IP window, saves pending requests in D1, and provides protected endpoints for an administrator to list and review requests.

### API routes

- `GET /api/health` — reports whether the D1 binding is configured.
- `POST /api/access-requests` — validates and stores an access request as `pending`.
- `GET /api/admin/access-requests?status=pending` — lists requests; supports `pending`, `approved`, `rejected`, or `all`.
- `POST /api/admin/access-requests/:id` — JSON body `{"action":"approve"|"reject","reviewer":"Admin name","note":"optional"}`; records the review and an audit event.

Admin routes require an `x-admin-key` header. Set `ADMIN_API_KEY` as a Cloudflare Worker secret and use a randomly generated secret of at least 32 characters. Never commit that key to GitHub or embed it in frontend code. These endpoints are an initial backend control surface, not a substitute for full employee authentication or a secure Admin UI.

### Cloudflare setup required before deployment

1. Create a D1 database in the Cloudflare account that owns the Worker, for example `npx wrangler d1 create laverdad-softphone-db`.
2. Copy the generated database ID into `wrangler.toml`, replacing `REPLACE_WITH_D1_DATABASE_ID`.
3. Apply the migration to the intended database: `npx wrangler d1 migrations apply laverdad-softphone-db --remote`.
4. Add the secret: `npx wrangler secret put ADMIN_API_KEY` and enter a generated secret (do not paste it into source files).
5. Deploy with `npx wrangler deploy` only after checking the account, Worker name, D1 database ID, and deployment target.

Use a separate staging database for testing first. Cloudflare migrations and resources are not created just by committing files to GitHub. See the official [D1 getting started guide](https://developers.cloudflare.com/d1/get-started/) and [migration guide](https://developers.cloudflare.com/d1/reference/migrations/).

### Current boundaries

- An approved request is only marked approved; it does not create an employee account or grant login access.
- The existing `demo` login remains a frontend-only preview and is not secure authentication.
- The admin review endpoints are protected by a Worker secret, but a production Admin interface should use real server-side identity, roles, sessions, and audit controls.
- The live Cloudflare deployment and database are not confirmed updated by these GitHub commits. Configure and deploy through the correct Cloudflare account before testing the live API.

## Current files

- `index.html` — app structure
- `styles.css` — responsive visual design
- `app.js` — prototype interactions and sample data

## Login/access request test and next implementation plan

Manual smoke-test results reported on 2026-10-26: demo login opened the dashboard; the employee access form displayed its confirmation. These results confirm the observed preview flow only, not real authentication or request delivery.

### Immediate preview fixes

- Login accepts only the documented `demo` username, avoiding the impression that arbitrary employee credentials are valid.
- The access-request confirmation explicitly says the request was **not saved or sent**.
- Password reset remains a placeholder and does not change a password.

### Recommended delivery phases

1. **Backend foundation:** confirm the Cloudflare deployment model; create a Worker API and D1 schema for employees, access requests, roles, and audit events; configure environment bindings and secrets. Never put secrets in browser code.
2. **Employee access workflow:** submit requests to the API; store pending requests; provide an authenticated Admin review queue; support approve/reject with audit events and clear status feedback. Add validation, rate limiting, abuse protection, and privacy/retention rules.
3. **Real authentication:** use a secure identity provider or well-reviewed authentication implementation, server-validated sessions, password hashing if passwords are managed directly, secure password reset, session expiry, CSRF protections where applicable, and server-side role checks. Do not unlock dashboard access based on client-side checks.
4. **Verification and release:** test invalid credentials, missing fields, duplicate requests, unauthorized admin actions, session expiry, mobile layouts, and deployment rollback. Only then label login or requests as production-ready.
5. **Telephony integration:** after authentication and authorization are sound, connect a selected voice provider/SIP service, WebRTC calling, live presence, call records, and compliance controls.

## Status

Preview UI deployed at the URL above as reported by the project owner. Real authentication, access-request persistence/review, persistent storage, live events, and real telephony are not implemented.
