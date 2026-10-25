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

Open the app and use username `demo` with any password. This is only a UI demonstration. The prototype does **not** authenticate users, persist employee credentials, connect a microphone, place or receive real calls, or provide production-grade analytics. Contacts and call activity added in the browser are in-memory demo data.

## Cloudflare Pages deployment

This is a static site with no build step:
1. In Cloudflare, open **Workers & Pages** and create a Pages project connected to this GitHub repository.
2. Select the `main` branch.
3. Leave the build command blank and set the output directory to `/` (repository root).
4. Deploy. Subsequent commits to the connected branch can trigger automatic deployments.

## Production architecture required

Real inbound/outbound calling and employee accounts require backend services; do not treat the current interface as production-ready. Recommended next steps:

1. **Authentication and roles:** secure server-side sessions, password hashing, password reset, MFA option, rate limiting, audit trail, and role-based access (Owner/Admin, Supervisor, Agent).
2. **Telephony:** choose a provider/SIP trunk (for example, Twilio, Telnyx, or a company-managed SIP platform), then implement browser calling with a supported WebRTC/SIP SDK. Inbound routing, outbound caller ID, recordings, and call controls depend on provider configuration and regional/legal requirements.
3. **Cloudflare backend:** Cloudflare Workers API, D1 for application records, and encrypted secrets for provider credentials; never expose provider API secrets in browser code.
4. **Live team presence:** WebSocket or Durable Objects coordination for Available, Unavailable, On Phone, On Wrap, and Logged Out; enforce presence server-side.
5. **Operational records:** call detail records, dispositions, notes, queue/skill assignment, supervisor permissions, and reporting.
6. **Privacy and compliance:** consent notices, retention controls, access logging, recording policy, and applicable telecommunications/privacy compliance before handling real customer data.

## Current files

- `index.html` — app structure
- `styles.css` — responsive visual design
- `app.js` — prototype interactions and sample data

## Status

UI prototype only. Provider integration, secure account creation, persistent storage, live events, and production deployment validation remain future work.
