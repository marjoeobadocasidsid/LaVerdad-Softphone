# Admin authentication setup

This feature adds a cookie-based Admin / Management login and a protected access-request dashboard. It is not ready for production until the required Cloudflare Worker secrets are configured and the branch is tested.

## Required Worker secrets

From the repository root, authenticate Wrangler to the Cloudflare account that owns \`laverdad-softphone\`, then set these values interactively. Do not commit credentials or put them in browser code.

\`\`\`sh
npx wrangler login
npx wrangler secret put ADMIN_USERNAME
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put ADMIN_SESSION_SECRET
\`\`\`

Enter the desired administrator username and a long, unique password when prompted. For \`ADMIN_SESSION_SECRET\`, enter a cryptographically random value of at least 32 characters. For example, generate a candidate locally with:

\`\`\`sh
openssl rand -hex 32
\`\`\`

Do not paste secrets into GitHub issues, pull-request comments, chat, or source files. If more than one administrator is needed, this initial implementation uses one shared administrator credential; implement individual accounts and MFA before a larger production rollout.

## Behavior and safeguards

- The Worker verifies the username and password server-side.
- Successful login issues an eight-hour signed session cookie with \`HttpOnly\`, \`Secure\`, \`SameSite=Strict\`, and \`Path=/\`.
- Admin API endpoints require a valid signed session; the old \`x-admin-key\` browser/API pattern is removed.
- Login attempts are rate-limited using the existing D1 \`request_rate_limits\` table.
- Access-request approve/reject actions require same-origin requests and are written to the existing audit log.
- Approving an access request does not provision employee credentials.
- Employee login remains demo-only; this feature does not implement employee authentication.

## Verification checklist before production deployment

1. Configure the three secrets in the correct Cloudflare Worker environment.
2. Test missing-secret behavior (login should return 503 without exposing configuration values).
3. Test invalid credentials (401) and rate limiting (429).
4. Test successful login, refresh, eight-hour session expiry, and logout.
5. Confirm \`/api/admin/session\` and \`/api/admin/access-requests\` return 401 without a valid session.
6. Confirm approve/reject actions fail without a session and succeed only for a pending request with a valid session.
7. Check browser developer tools to ensure no password or session token is written to local storage or rendered into the page.
8. Deploy only after review and tests pass.
