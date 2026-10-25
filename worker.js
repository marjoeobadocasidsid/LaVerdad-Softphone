const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

const clean = (value, max = 160) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function sha256(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

async function requireAdmin(request, env) {
  const expected = env.ADMIN_API_KEY;
  const supplied = request.headers.get("x-admin-key") || "";
  if (!expected || expected.length < 32 || supplied.length !== expected.length) return false;
  return (await sha256(supplied)) === (await sha256(expected));
}

async function submitAccessRequest(request, env) {
  if (!sameOrigin(request)) return json({ error: "Cross-origin request rejected." }, 403);
  if (!env.DB) return json({ error: "Access requests are not configured yet." }, 503);

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return json({ error: "Send a JSON request." }, 415);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const fullName = clean(body.fullName, 120);
  const username = clean(body.username, 40).toLowerCase();
  const email = clean(body.email, 254).toLowerCase();

  if (fullName.length < 2) return json({ error: "Enter your full name." }, 400);
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
    return json({ error: "Username must be 3–40 characters and use letters, numbers, dots, underscores, or hyphens." }, 400);
  }
  if (!emailPattern.test(email) || email.length > 254) return json({ error: "Enter a valid work email address." }, 400);

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const rateKey = await sha256(ip + (env.RATE_LIMIT_SALT || "laverdad-access-request"));
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % 900);

  await env.DB.prepare(
    "INSERT INTO request_rate_limits (key_hash, window_start, attempts) VALUES (?, ?, 1) ON CONFLICT(key_hash) DO UPDATE SET attempts = CASE WHEN window_start = excluded.window_start THEN attempts + 1 ELSE 1 END, window_start = excluded.window_start"
  ).bind(rateKey, windowStart).run();

  const rate = await env.DB.prepare(
    "SELECT attempts FROM request_rate_limits WHERE key_hash = ?"
  ).bind(rateKey).first();
  if ((rate?.attempts || 0) > 5) return json({ error: "Too many requests. Please try again in 15 minutes." }, 429);

  const pendingDuplicate = await env.DB.prepare(
    "SELECT id FROM access_requests WHERE status = 'pending' AND (email = ? OR username = ?) LIMIT 1"
  ).bind(email, username).first();
  if (pendingDuplicate) {
    return json({ message: "A pending request already exists for that email or username." }, 409);
  }

  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      "INSERT INTO access_requests (id, full_name, username, email, status, requested_at) VALUES (?, ?, ?, ?, 'pending', ?)"
    ).bind(id, fullName, username, email, new Date().toISOString()).run();
  } catch (error) {
    const message = String(error?.message || "");
    if (/unique|constraint/i.test(message)) {
      return json({ error: "A request with these details already exists. Contact your administrator if you need help." }, 409);
    }
    return json({ error: "Unable to save your request right now." }, 500);
  }

  return json({ ok: true, requestId: id, status: "pending", message: "Your access request was submitted for administrator review." }, 201);
}

async function adminRoutes(request, env, url) {
  if (!await requireAdmin(request, env)) return json({ error: "Unauthorized. Admin API key required." }, 401);
  if (!env.DB) return json({ error: "Database is not configured." }, 503);

  if (request.method === "GET" && url.pathname === "/api/admin/access-requests") {
    const status = url.searchParams.get("status") || "pending";
    if (!["pending", "approved", "rejected", "all"].includes(status)) {
      return json({ error: "Invalid status filter." }, 400);
    }
    const query = status === "all"
      ? env.DB.prepare("SELECT id, full_name AS fullName, username, email, status, requested_at AS requestedAt, reviewed_at AS reviewedAt, reviewed_by AS reviewedBy, review_note AS reviewNote FROM access_requests ORDER BY requested_at DESC LIMIT 200")
      : env.DB.prepare("SELECT id, full_name AS fullName, username, email, status, requested_at AS requestedAt, reviewed_at AS reviewedAt, reviewed_by AS reviewedBy, review_note AS reviewNote FROM access_requests WHERE status = ? ORDER BY requested_at DESC LIMIT 200").bind(status);
    const result = await query.all();
    return json({ requests: result.results || [] });
  }

  const match = url.pathname.match(/^\/api\/admin\/access-requests\/([0-9a-f-]{36})$/i);
  if (request.method === "POST" && match) {
    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid request body." }, 400); }
    const action = body.action;
    const reviewer = clean(body.reviewer, 120) || "Admin";
    const note = clean(body.note, 500);
    if (!["approve", "reject"].includes(action)) return json({ error: "Action must be approve or reject." }, 400);

    const nextStatus = action === "approve" ? "approved" : "rejected";
    const result = await env.DB.prepare(
      "UPDATE access_requests SET status = ?, reviewed_at = ?, reviewed_by = ?, review_note = ? WHERE id = ? AND status = 'pending'"
    ).bind(nextStatus, new Date().toISOString(), reviewer, note || null, match[1]).run();

    if (!result.meta?.changes) return json({ error: "Request not found or it has already been reviewed." }, 404);

    await env.DB.prepare(
      "INSERT INTO audit_events (id, actor, action, target_id, created_at, details) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(crypto.randomUUID(), reviewer, "access_request_" + nextStatus, match[1], new Date().toISOString(), note || null).run();

    return json({
      ok: true,
      status: nextStatus,
      message: nextStatus === "approved"
        ? "Request marked approved. This does not create an employee login yet."
        : "Request rejected."
    });
  }

  return json({ error: "Not found." }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return new Response(null, { status: 204, headers: { "allow": "GET, POST, OPTIONS" } });
    }
    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, service: "laverdad-softphone-api", databaseConfigured: Boolean(env.DB) });
    }
    if (url.pathname === "/api/access-requests" && request.method === "POST") {
      return submitAccessRequest(request, env);
    }
    if (url.pathname.startsWith("/api/admin/")) {
      return adminRoutes(request, env, url);
    }
    if (url.pathname.startsWith("/api/")) return json({ error: "Not found." }, 404);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return json({ error: "Static asset binding is not configured." }, 500);
  }
};
