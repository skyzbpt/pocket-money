/**
 * 零用金記錄表 — 雲端同步 API
 *
 * 純 Cloudflare Workers + D1，沒有用任何套件，方便直接 `wrangler deploy`。
 * 資料模型很簡單：帳號登入後，前端把整份 { settings, records } 當一個
 * JSON 存到 user_data，裝置之間靠「登入同一個帳號」拿到同一份資料，
 * 存檔方式是整份覆蓋（last write wins），跟 app 原本「匯出/匯入備份」
 * 是同一種資料格式。
 *
 * 路由：
 *   POST /api/register   { username, password } -> { token, username }
 *   POST /api/login      { username, password } -> { token, username }
 *   POST /api/logout     (需要 Authorization: Bearer <token>)
 *   GET  /api/data        (需要 Authorization: Bearer <token>) -> { data } 或 { data: null }
 *   PUT  /api/data        (需要 Authorization: Bearer <token>) body: 完整的 { settings, records }
 */

const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 100000;

/**
 * ALLOWED_ORIGIN 可以填多個來源，用逗號分隔，例如：
 *   ALLOWED_ORIGIN = "https://guoding.pages.dev,null"
 * 其中 "null" 是瀏覽器直接開啟本機 index.html（file://）時送出的 Origin。
 * 填 "*" 則維持全開（不建議正式使用）。
 *
 * 注意：null 不只出現在 file://，sandboxed iframe 等情況也會送出 null。
 */
function allowedOrigins(env) {
  return (env.ALLOWED_ORIGIN || '*')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);
}

/** 這個 Origin 可不可以用這個 API；沒帶 Origin（curl、同源請求）回傳 null。 */
function resolveOrigin(env, request) {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  const list = allowedOrigins(env);
  if (list.includes('*')) return '*';
  return list.includes(origin) ? origin : false;
}

function corsHeaders(env, request) {
  const allowed = resolveOrigin(env, request);
  const headers = {
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    // 回應會隨 Origin 不同而不同，不加這個會被快取汙染
    'Vary': 'Origin',
  };
  // allowed === false 代表這個 Origin 不在清單裡：不送 ACAO，瀏覽器就會擋下來
  if (allowed) headers['Access-Control-Allow-Origin'] = allowed;
  return headers;
}
function json(data, status, env, request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(env, request) },
  });
}
function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function randomHex(byteLen) {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(byteLen)));
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial, 256,
  );
  return bytesToHex(bits);
}

function isValidUsername(u) {
  return typeof u === 'string' && /^[a-zA-Z0-9_.\-一-鿿]{3,40}$/.test(u);
}
function isValidPassword(p) {
  return typeof p === 'string' && p.length >= 6 && p.length <= 200;
}

async function readJSON(request) {
  try { return await request.json(); } catch { return null; }
}

async function createSession(env, userId) {
  const token = randomHex(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400 * 1000).toISOString();
  await env.DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(token, userId, expires).run();
  return token;
}

async function getUserFromRequest(env, request) {
  const auth = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/.exec(auth);
  if (!m) return null;
  const token = m[1].trim();
  const row = await env.DB.prepare(
    `SELECT users.id AS id, users.username AS username, sessions.expires_at AS expires_at
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token = ?`,
  ).bind(token).first();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return { id: row.id, username: row.username, token };
}

async function handleRegister(env, request) {
  const body = await readJSON(request);
  if (!body || !isValidUsername(body.username) || !isValidPassword(body.password)) {
    return json({ error: '帳號需 3-40 個字元；密碼至少 6 個字元。' }, 400, env, request);
  }
  const username = body.username.trim();
  const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (existing) return json({ error: '這個帳號已經被使用了。' }, 409, env, request);

  const salt = randomHex(16);
  const hash = await hashPassword(body.password, salt);
  const inserted = await env.DB.prepare(
    'INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?) RETURNING id',
  ).bind(username, hash, salt).first();

  const token = await createSession(env, inserted.id);
  return json({ token, username }, 201, env, request);
}

async function handleLogin(env, request) {
  const body = await readJSON(request);
  if (!body || typeof body.username !== 'string' || typeof body.password !== 'string') {
    return json({ error: '請輸入帳號密碼。' }, 400, env, request);
  }
  const username = body.username.trim();
  const user = await env.DB.prepare('SELECT id, username, password_hash, salt FROM users WHERE username = ?')
    .bind(username).first();
  if (!user) return json({ error: '帳號或密碼錯誤。' }, 401, env, request);

  const hash = await hashPassword(body.password, user.salt);
  if (!timingSafeEqual(hash, user.password_hash)) {
    return json({ error: '帳號或密碼錯誤。' }, 401, env, request);
  }
  const token = await createSession(env, user.id);
  return json({ token, username: user.username }, 200, env, request);
}

async function handleLogout(env, request) {
  const auth = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/.exec(auth);
  if (m) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(m[1].trim()).run();
  return json({ ok: true }, 200, env, request);
}

async function handleGetData(env, request) {
  const user = await getUserFromRequest(env, request);
  if (!user) return json({ error: '請先登入。' }, 401, env, request);
  const row = await env.DB.prepare('SELECT data, updated_at FROM user_data WHERE user_id = ?')
    .bind(user.id).first();
  return json({ data: row ? JSON.parse(row.data) : null, updatedAt: row ? row.updated_at : null }, 200, env, request);
}

async function handlePutData(env, request) {
  const user = await getUserFromRequest(env, request);
  if (!user) return json({ error: '請先登入。' }, 401, env, request);
  const body = await readJSON(request);
  if (!body || typeof body !== 'object' || !Array.isArray(body.records) || typeof body.settings !== 'object') {
    return json({ error: '資料格式不正確，需要 { settings, records }。' }, 400, env, request);
  }
  // 限制單一使用者的資料大小，避免異常資料把 D1 塞爆（每筆記錄約 200 bytes，
  // 這裡抓一個相對寬鬆但足以擋住異常情況的上限）
  const payload = JSON.stringify({ settings: body.settings, records: body.records });
  if (payload.length > 8 * 1024 * 1024) {
    return json({ error: '資料量過大，無法同步。' }, 413, env, request);
  }
  const updatedAt = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO user_data (user_id, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  ).bind(user.id, payload, updatedAt).run();
  return json({ ok: true, updatedAt }, 200, env, request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === 'OPTIONS') {
      // Origin 不在白名單時直接擋掉 preflight，不讓它拿到可用的 CORS 標頭
      if (resolveOrigin(env, request) === false) {
        return new Response(null, { status: 403, headers: { 'Vary': 'Origin' } });
      }
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }

    try {
      if (pathname === '/api/register' && request.method === 'POST') return await handleRegister(env, request);
      if (pathname === '/api/login' && request.method === 'POST') return await handleLogin(env, request);
      if (pathname === '/api/logout' && request.method === 'POST') return await handleLogout(env, request);
      if (pathname === '/api/data' && request.method === 'GET') return await handleGetData(env, request);
      if (pathname === '/api/data' && request.method === 'PUT') return await handlePutData(env, request);
      if (pathname === '/' || pathname === '/api') {
        return json({ ok: true, service: 'guoding' }, 200, env, request);
      }
      return json({ error: 'Not found' }, 404, env, request);
    } catch (err) {
      return json({ error: '伺服器錯誤：' + err.message }, 500, env, request);
    }
  },
};
