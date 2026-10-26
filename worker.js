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
const DESIGNATIONS = ["CEO","COO","OP","OVP","OM","Assistant OM","Supervisor","Team Leader","Trainer","SME"];
const MODERATOR_USERNAME = "lv_admin123";
function isGovernanceModerator(session) { return session?.username?.trim().toLowerCase() === MODERATOR_USERNAME; }
async function designationRoutes(request, env, url, session) {
 const moderator=isGovernanceModerator(session);
 if(request.method==="GET"&&url.pathname==="/api/admin/designations"){
  const current=await env.DB.prepare("SELECT designation FROM management_designations WHERE username = ?").bind(session.username).first();
  const pending=moderator?await env.DB.prepare("SELECT id, username, requested_designation AS requestedDesignation, requested_at AS requestedAt FROM designation_requests WHERE status='pending' ORDER BY requested_at ASC LIMIT 200").all():{results:[]};
  const assignments=moderator?await env.DB.prepare("SELECT username,designation,assigned_by AS assignedBy,assigned_at AS assignedAt FROM management_designations ORDER BY username COLLATE NOCASE LIMIT 500").all():{results:[]};
  return json({username:session.username,designation:current?.designation||null,isModerator:moderator,pendingRequests:pending.results||[],assignments:assignments.results||[]});
 }
 if(request.method==="POST"&&url.pathname==="/api/admin/designation-requests"){
  if(!sameOrigin(request))return json({error:"Cross-origin request rejected."},403);
  let b;try{b=await request.json()}catch{return json({error:"Invalid request body."},400)}
  const d=clean(b.designation,40);if(!DESIGNATIONS.includes(d))return json({error:"Choose a valid designation."},400);
  if(await env.DB.prepare("SELECT id FROM designation_requests WHERE username=? AND status='pending'").bind(session.username).first())return json({error:"You already have a pending designation request."},409);
  const id=crypto.randomUUID(),now=new Date().toISOString();
  await env.DB.prepare("INSERT INTO designation_requests(id,username,requested_designation,status,requested_at) VALUES(?,?,?,'pending',?)").bind(id,session.username,d,now).run();
  await env.DB.prepare("INSERT INTO audit_events(id,actor,action,target_id,created_at,details) VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(),session.username,"designation_requested",id,now,d).run();
  return json({ok:true,message:"Designation request submitted for moderator review."},201);
 }
 if(request.method==="POST"&&url.pathname==="/api/admin/designations/assign"){
  if(!moderator)return json({error:"Only LV_Admin123, the IT & Admin Moderator, can assign designations."},403);
  if(!sameOrigin(request))return json({error:"Cross-origin request rejected."},403);
  let b;try{b=await request.json()}catch{return json({error:"Invalid request body."},400)}
  const username=clean(b.username,120),d=clean(b.designation,40);if(!username||!DESIGNATIONS.includes(d))return json({error:"Enter a username and valid designation."},400);
  const now=new Date().toISOString();
  await env.DB.prepare("INSERT INTO management_designations(username,designation,assigned_by,assigned_at) VALUES(?,?,?,?) ON CONFLICT(username) DO UPDATE SET designation=excluded.designation,assigned_by=excluded.assigned_by,assigned_at=excluded.assigned_at").bind(username,d,session.username,now).run();
  await env.DB.prepare("INSERT INTO audit_events(id,actor,action,target_id,created_at,details) VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(),session.username,"designation_assigned",username,now,d).run();
  return json({ok:true,message:"Designation assigned to "+username+"."});
 }
 const m=url.pathname.match(/^\/api\/admin\/designation-requests\/([0-9a-f-]{36})$/i);
 if(request.method==="POST"&&m){
  if(!moderator)return json({error:"Only LV_Admin123, the IT & Admin Moderator, can review designation requests."},403);
  if(!sameOrigin(request))return json({error:"Cross-origin request rejected."},403);
  let b;try{b=await request.json()}catch{return json({error:"Invalid request body."},400)}
  if(!["approve","reject"].includes(b.action))return json({error:"Action must be approve or reject."},400);
  const item=await env.DB.prepare("SELECT username,requested_designation AS designation FROM designation_requests WHERE id=? AND status='pending'").bind(m[1]).first();
  if(!item)return json({error:"Request not found or already reviewed."},404);
  const now=new Date().toISOString(),status=b.action==="approve"?"approved":"rejected";
  await env.DB.prepare("UPDATE designation_requests SET status=?,reviewed_at=?,reviewed_by=? WHERE id=? AND status='pending'").bind(status,now,session.username,m[1]).run();
  if(status==="approved")await env.DB.prepare("INSERT INTO management_designations(username,designation,assigned_by,assigned_at) VALUES(?,?,?,?) ON CONFLICT(username) DO UPDATE SET designation=excluded.designation,assigned_by=excluded.assigned_by,assigned_at=excluded.assigned_at").bind(item.username,item.designation,session.username,now).run();
  await env.DB.prepare("INSERT INTO audit_events(id,actor,action,target_id,created_at,details) VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(),session.username,"designation_request_"+status,m[1],now,item.username+":"+item.designation).run();
  return json({ok:true,message:status==="approved"?"Designation approved and assigned.":"Designation request rejected."});
 }
 return json({error:"Not found."},404);
}


const EMPLOYEE_COOKIE = "__Host-laverdad_employee";
const PASSWORD_ITERATIONS = 120000;
function randomHex(bytes = 16) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return [...data].map(v => v.toString(16).padStart(2, "0")).join("");
}
async function derivePassword(password, salt, iterations = PASSWORD_ITERATIONS) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations }, material, 256);
  return [...new Uint8Array(bits)].map(v => v.toString(16).padStart(2, "0")).join("");
}
async function employeeSessionToken(env, employee) {
  const payload = toBase64Url(encoder.encode(JSON.stringify({ sub: employee.username, employeeId: employee.id, role: "employee", exp: Math.floor(Date.now()/1000) + SESSION_SECONDS })));
  return payload + "." + toBase64Url(await hmac(env.ADMIN_SESSION_SECRET, payload));
}
async function readEmployeeSession(request, env) {
  if (!env.ADMIN_SESSION_SECRET || env.ADMIN_SESSION_SECRET.length < 32) return null;
  const parts = cookieValue(request, EMPLOYEE_COOKIE).split(".");
  if (parts.length !== 2) return null;
  try {
    if (!constantTimeEqual(await hmac(env.ADMIN_SESSION_SECRET, parts[0]), fromBase64Url(parts[1]))) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[0])));
    if (payload.role !== "employee" || typeof payload.sub !== "string" || typeof payload.employeeId !== "string" || payload.exp <= Math.floor(Date.now()/1000)) return null;
    const employee = await env.DB.prepare("SELECT id,full_name AS fullName,username,email,team,extension,status,active FROM employees WHERE id=? AND username=?").bind(payload.employeeId,payload.sub).first();
    return employee && employee.active ? employee : null;
  } catch { return null; }
}
async function employeeRoutes(request, env, url) {
  if (!env.DB) return json({error:"Database is not configured."},503);
  if (url.pathname === "/api/employee/login" && request.method === "POST") {
    if (!sameOrigin(request)) return json({error:"Cross-origin request rejected."},403);
    if (!env.ADMIN_SESSION_SECRET || env.ADMIN_SESSION_SECRET.length < 32) return json({error:"Authentication service is not configured."},503);
    let body; try { body = await request.json(); } catch { return json({error:"Invalid request body."},400); }
    const username=clean(body.username,120).toLowerCase(), password=String(body.password||"");
    if(!username||!password||password.length>1024) return json({error:"Enter your employee username and password."},400);
    if(await loginRateLimited(request,env,"employee:"+username)) return json({error:"Too many sign-in attempts. Try again in 15 minutes."},429);
    const employee=await env.DB.prepare("SELECT id,full_name AS fullName,username,email,team,extension,status,active,password_hash AS passwordHash,password_salt AS passwordSalt,password_iterations AS passwordIterations FROM employees WHERE username=?").bind(username).first();
    if(!employee||!employee.active) return json({error:"Invalid employee username or password."},401);
    const candidate=await derivePassword(password,employee.passwordSalt,employee.passwordIterations);
    if(candidate!==employee.passwordHash) return json({error:"Invalid employee username or password."},401);
    const now=new Date().toISOString();
    await env.DB.prepare("UPDATE employees SET last_login_at=?,updated_at=?,status=CASE WHEN status='Logged Out' THEN 'Available' ELSE status END WHERE id=?").bind(now,now,employee.id).run();
    const token=await employeeSessionToken(env,employee);
    return new Response(JSON.stringify({ok:true,user:{id:employee.id,fullName:employee.fullName,username:employee.username,email:employee.email,team:employee.team,extension:employee.extension}}),{status:200,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","set-cookie":EMPLOYEE_COOKIE+"="+token+"; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age="+SESSION_SECONDS}});
  }
  if (url.pathname === "/api/employee/logout" && request.method === "POST") {
    if(!sameOrigin(request))return json({error:"Cross-origin request rejected."},403);
    const session=await readEmployeeSession(request,env);
    if(session) await env.DB.prepare("UPDATE employees SET status='Logged Out',updated_at=? WHERE id=?").bind(new Date().toISOString(),session.id).run();
    return new Response(JSON.stringify({ok:true}),{status:200,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","set-cookie":EMPLOYEE_COOKIE+"=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"}});
  }
  const session=await readEmployeeSession(request,env);
  if(url.pathname==="/api/employee/session"&&request.method==="GET")return session?json({authenticated:true,user:session}):json({authenticated:false},401);
  if(!session)return json({error:"Employee sign-in required."},401);
  if(url.pathname==="/api/employee/status"&&request.method==="POST"){
    if(!sameOrigin(request))return json({error:"Cross-origin request rejected."},403);
    let body;try{body=await request.json()}catch{return json({error:"Invalid request body."},400)}
    const allowed=["Available","Unavailable","On Wrap"];
    if(!allowed.includes(body.status))return json({error:"Choose a supported agent status."},400);
    await env.DB.prepare("UPDATE employees SET status=?,updated_at=? WHERE id=?").bind(body.status,new Date().toISOString(),session.id).run();
    return json({ok:true,status:body.status});
  }
  if(url.pathname==="/api/employee/calls"&&request.method==="GET"){
    const result=await env.DB.prepare("SELECT id,call_type AS type,phone_number AS phone,started_at AS startedAt,ended_at AS endedAt,duration_seconds AS durationSeconds,disposition,notes FROM call_activity WHERE employee_id=? ORDER BY started_at DESC LIMIT 100").bind(session.id).all();
    return json({calls:result.results||[]});
  }
  if(url.pathname==="/api/employee/calls"&&request.method==="POST"){
    if(!sameOrigin(request))return json({error:"Cross-origin request rejected."},403);
    let body;try{body=await request.json()}catch{return json({error:"Invalid request body."},400)}
    const type=clean(body.type,20),phone=clean(body.phone,40),disposition=clean(body.disposition||"In progress",80),notes=clean(body.notes||"",2000);
    if(!["Inbound","Outbound"].includes(type)||!phone)return json({error:"Call type and phone number are required."},400);
    const id=crypto.randomUUID(),now=new Date().toISOString();
    await env.DB.prepare("INSERT INTO call_activity(id,employee_id,call_type,phone_number,started_at,disposition,notes,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(id,session.id,type,phone,now,disposition,notes||null,now).run();
    await env.DB.prepare("UPDATE employees SET status='On Phone',updated_at=? WHERE id=?").bind(now,session.id).run();
    return json({ok:true,id,startedAt:now},201);
  }
  return json({error:"Not found."},404);
}
async function adminEmployeeRoutes(request, env, url, session) {
  if(url.pathname==="/api/admin/employees"&&request.method==="GET"){
    const result=await env.DB.prepare("SELECT e.id,e.full_name AS fullName,e.username,e.email,e.team,e.extension,e.status,e.active,e.created_at AS createdAt,e.last_login_at AS lastLoginAt,COALESCE(GROUP_CONCAT(s.skill, ', '),'') AS skills FROM employees e LEFT JOIN employee_skills s ON s.employee_id=e.id GROUP BY e.id ORDER BY e.full_name COLLATE NOCASE LIMIT 500").all();
    return json({employees:result.results||[]});
  }
  if(url.pathname==="/api/admin/employees"&&request.method==="POST"){
    if(!sameOrigin(request))return json({error:"Cross-origin request rejected."},403);
    let b;try{b=await request.json()}catch{return json({error:"Invalid request body."},400)}
    const fullName=clean(b.fullName,160),username=clean(b.username,120).toLowerCase(),email=clean(b.email,254).toLowerCase(),team=clean(b.team||"Unassigned",100),extension=clean(b.extension||"",20),password=String(b.password||"");
    if(!fullName||!username||!/^[a-z0-9._-]{3,40}$/.test(username)||!emailPattern.test(email)||password.length<12||password.length>1024)return json({error:"Enter a name, valid username and work email, and a password of at least 12 characters."},400);
    const salt=randomHex(),hash=await derivePassword(password,salt),id=crypto.randomUUID(),now=new Date().toISOString();
    try{
      await env.DB.prepare("INSERT INTO employees(id,full_name,username,email,password_hash,password_salt,password_iterations,team,extension,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(id,fullName,username,email,hash,salt,PASSWORD_ITERATIONS,team,extension||null,now,now).run();
    }catch(e){return json({error:"Employee could not be created. Check for a duplicate username, email, or extension."},409)}
    await env.DB.prepare("INSERT INTO audit_events(id,actor,action,target_id,created_at,details) VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(),session.username,"employee_created",id,now,username).run();
    return json({ok:true,employee:{id,fullName,username,email,team,extension:extension||null,status:"Available",active:1},message:"Employee account created."},201);
  }
  const match=url.pathname.match(/^\/api\/admin\/employees\/([0-9a-f-]{36})$/i);
  if(match&&request.method==="PATCH"){
    if(!sameOrigin(request))return json({error:"Cross-origin request rejected."},403);
    let b;try{b=await request.json()}catch{return json({error:"Invalid request body."},400)}
    if(typeof b.active!=="boolean")return json({error:"Specify active as true or false."},400);
    const now=new Date().toISOString();
    const result=await env.DB.prepare("UPDATE employees SET active=?,status=CASE WHEN ?=0 THEN 'Logged Out' ELSE status END,updated_at=? WHERE id=?").bind(b.active?1:0,b.active?1:0,now,match[1]).run();
    if(!result.meta?.changes)return json({error:"Employee not found."},404);
    await env.DB.prepare("INSERT INTO audit_events(id,actor,action,target_id,created_at,details) VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(),session.username,b.active?"employee_activated":"employee_deactivated",match[1],now,null).run();
    return json({ok:true,message:b.active?"Employee activated.":"Employee deactivated."});
  }
  return json({error:"Not found."},404);
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
  if (url.pathname.startsWith("/api/admin/designation")) return designationRoutes(request, env, url, session);
  if (url.pathname.startsWith("/api/admin/employees")) return adminEmployeeRoutes(request, env, url, session);
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
    if (url.pathname.startsWith("/api/employee/")) return employeeRoutes(request, env, url);
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
