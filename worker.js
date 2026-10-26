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

const SESSION_COOKIE = "__Host-laverdad_admin";
const SESSION_SECONDS = 8 * 60 * 60;
const encoder = new TextEncoder();
function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
async function hmac(secret, value) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
function cookieValue(request, name) {
  const cookies = request.headers.get("Cookie") || "";
  for (const item of cookies.split(";")) {
    const index = item.indexOf("=");
    if (index > -1 && item.slice(0, index).trim() === name) return item.slice(index + 1).trim();
  }
  return "";
}
function sessionCookie(value, maxAge = SESSION_SECONDS) {
  return "__Host-laverdad_admin=" + value + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" + maxAge;
}
async function createSession(env, username) {
  const payload = toBase64Url(encoder.encode(JSON.stringify({ sub: username, role: "admin", exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS })));
  return payload + "." + toBase64Url(await hmac(env.ADMIN_SESSION_SECRET, payload));
}
async function readAdminSession(request, env) {
  if (!env.ADMIN_SESSION_SECRET || env.ADMIN_SESSION_SECRET.length < 32) return null;
  const parts = cookieValue(request, SESSION_COOKIE).split(".");
  if (parts.length !== 2) return null;
  try {
    if (!constantTimeEqual(await hmac(env.ADMIN_SESSION_SECRET, parts[0]), fromBase64Url(parts[1]))) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[0])));
    if (payload.role !== "admin" || typeof payload.sub !== "string" || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return { username: payload.sub, role: "admin" };
  } catch { return null; }
}
async function loginRateLimited(request, env, username) {
  if (!env.DB) return true;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const keyHash = await sha256("admin-login:" + ip + ":" + username + ":" + (env.RATE_LIMIT_SALT || "laverdad-admin"));
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % 900);
  await env.DB.prepare("INSERT INTO request_rate_limits (key_hash, window_start, attempts) VALUES (?, ?, 1) ON CONFLICT(key_hash) DO UPDATE SET attempts = CASE WHEN window_start = excluded.window_start THEN attempts + 1 ELSE 1 END, window_start = excluded.window_start").bind(keyHash, windowStart).run();
  const row = await env.DB.prepare("SELECT attempts FROM request_rate_limits WHERE key_hash = ?").bind(keyHash).first();
  return (row?.attempts || 0) > 8;
}
async function adminLogin(request, env) {
  if (!sameOrigin(request)) return json({ error: "Cross-origin request rejected." }, 403);
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD || !env.ADMIN_SESSION_SECRET || env.ADMIN_SESSION_SECRET.length < 32) {
    return json({ error: "Administrator authentication is not configured. Ask the deployment owner to configure the required Cloudflare secrets." }, 503);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid request body." }, 400); }
  const username = clean(body.username, 120);
  const password = String(body.password || "");
  if (!username || !password || password.length > 1024) return json({ error: "Enter your administrator username and password." }, 400);
  if (await loginRateLimited(request, env, username.toLowerCase())) return json({ error: "Too many sign-in attempts. Try again in 15 minutes." }, 429);
  const expectedUser = await hmac(env.ADMIN_SESSION_SECRET, "username:" + env.ADMIN_USERNAME.trim().toLowerCase());
  const suppliedUser = await hmac(env.ADMIN_SESSION_SECRET, "username:" + username.toLowerCase());
  const expectedPass = await hmac(env.ADMIN_SESSION_SECRET, "password:" + env.ADMIN_PASSWORD);
  const suppliedPass = await hmac(env.ADMIN_SESSION_SECRET, "password:" + password);
  if (!constantTimeEqual(expectedUser, suppliedUser) || !constantTimeEqual(expectedPass, suppliedPass)) return json({ error: "Invalid administrator username or password." }, 401);
  const token = await createSession(env, env.ADMIN_USERNAME.trim());
  return new Response(JSON.stringify({ ok: true, user: { username: env.ADMIN_USERNAME.trim(), role: "admin" } }), {
    status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "set-cookie": sessionCookie(token) }
  });
}
async function adminRoutes(request, env, url) {
  if (url.pathname === "/api/admin/login") return adminLogin(request, env);
  if (url.pathname === "/api/admin/logout" && request.method === "POST") {
    if (!sameOrigin(request)) return json({ error: "Cross-origin request rejected." }, 403);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "set-cookie": sessionCookie("", 0) } });
  }
  const session = await readAdminSession(request, env);
  if (request.method === "GET" && url.pathname === "/api/admin/session") return session ? json({ authenticated: true, user: { username: session.username, role: session.role } }) : json({ authenticated: false }, 401);
  if (!session) return json({ error: "Administrator sign-in required." }, 401);
  if (!env.DB) return json({ error: "Database is not configured." }, 503);
  if (request.method === "GET" && url.pathname === "/api/admin/access-requests") {
    const status = url.searchParams.get("status") || "pending";
    if (!["pending", "approved", "rejected", "all"].includes(status)) return json({ error: "Invalid status filter." }, 400);
    const query = status === "all"
      ? env.DB.prepare("SELECT id, full_name AS fullName, username, email, status, requested_at AS requestedAt, reviewed_at AS reviewedAt, reviewed_by AS reviewedBy, review_note AS reviewNote FROM access_requests ORDER BY requested_at DESC LIMIT 200")
      : env.DB.prepare("SELECT id, full_name AS fullName, username, email, status, requested_at AS requestedAt, reviewed_at AS reviewedAt, reviewed_by AS reviewedBy, review_note AS reviewNote FROM access_requests WHERE status = ? ORDER BY requested_at DESC LIMIT 200").bind(status);
    const result = await query.all();
    return json({ requests: result.results || [] });
  }
  const match = url.pathname.match(/^\/api\/admin\/access-requests\/([0-9a-f-]{36})$/i);
  if (request.method === "POST" && match) {
    if (!sameOrigin(request)) return json({ error: "Cross-origin request rejected." }, 403);
    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid request body." }, 400); }
    const action = body.action;
    const note = clean(body.note, 500);
    if (!["approve", "reject"].includes(action)) return json({ error: "Action must be approve or reject." }, 400);
    const nextStatus = action === "approve" ? "approved" : "rejected";
    const result = await env.DB.prepare("UPDATE access_requests SET status = ?, reviewed_at = ?, reviewed_by = ?, review_note = ? WHERE id = ? AND status = 'pending'").bind(nextStatus, new Date().toISOString(), session.username, note || null, match[1]).run();
    if (!result.meta?.changes) return json({ error: "Request not found or it has already been reviewed." }, 404);
    await env.DB.prepare("INSERT INTO audit_events (id, actor, action, target_id, created_at, details) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), session.username, "access_request_" + nextStatus, match[1], new Date().toISOString(), note || null).run();
    return json({ ok: true, status: nextStatus, message: nextStatus === "approved" ? "Request marked approved. This does not create an employee login yet." : "Request rejected." });
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
