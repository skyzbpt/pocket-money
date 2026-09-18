/**
 * 零用金記錄表 — 雲端同步 API
 *
 * 純 Cloudflare Workers + D1，沒有用任何套件，方便直接 `wrangler deploy`。
 * 前端（public/index.html）也由這個 Worker 托管，因此 app 與 API 同源。
 *
 * 資料模型：**全站只有一本帳**。所有帳號讀寫的都是 shared_data 裡的同一份
 * { settings, records }（格式同 app 的「匯出備份 JSON」），誰記的帳大家都看得到。
 *
 * 寫入分兩條路，對應兩種身分：
 *   - 一般員工：只能 POST /api/records 追加記錄，永遠不會蓋掉別人的資料
 *   - 管理員：PUT /api/data 整份覆寫，但要帶 baseRev；版本對不上回 409，
 *     由前端重新拉取後再操作，避免兩個人同時改互相覆蓋
 *
 * 帳號一律由管理員建立與維護：沒有公開註冊，使用者也不能自己改密碼。
 *
 * 路由：
 *   POST   /api/login      { username, password } -> { token, username, isAdmin }
 *   POST   /api/logout     (需要 Authorization: Bearer <token>)
 *   GET    /api/me         (需要登入) -> { username, isAdmin }
 *   GET    /api/data       (需要登入) -> { data, rev } 或 { data: null, rev: 0 }
 *   POST   /api/records    (需要登入) { records: [...] } -> 追加記錄（員工用）
 *   PUT    /api/data       (需要管理員) { settings, records, baseRev } -> 整份覆寫
 *   GET    /api/users      (需要管理員) -> { users: [...] }
 *   POST   /api/users      (需要管理員) { username, password } -> 建立帳號（一律非管理員）
 *   PATCH  /api/users/:id  (需要管理員) { password?, isAdmin? } -> 改密碼／改權限
 *   DELETE /api/users/:id  (需要管理員) -> 刪除帳號（連同它的資料）
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
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
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
    `SELECT users.id AS id, users.username AS username, users.is_admin AS is_admin,
            sessions.expires_at AS expires_at
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token = ?`,
  ).bind(token).first();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return { id: row.id, username: row.username, isAdmin: !!row.is_admin, token };
}

/** 資料庫裡目前有沒有任何管理員。 */
async function hasAnyAdmin(env) {
  const row = await env.DB.prepare('SELECT id FROM users WHERE is_admin = 1 LIMIT 1').first();
  return !!row;
}

/** 實際上算不算管理員。
 *  若資料庫還沒有任何管理員（例如舊資料庫剛加上 is_admin 欄位），
 *  暫時把「最早建立的帳號」視為管理員，避免沒有人能管理帳號。 */
async function isAdminUser(env, user) {
  if (!user) return false;
  if (user.isAdmin) return true;
  if (await hasAnyAdmin(env)) return false;
  const first = await env.DB.prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').first();
  return !!first && first.id === user.id;
}

/** 取出登入中的管理員；不是管理員就回傳對應的錯誤 Response。 */
async function requireAdmin(env, request) {
  const user = await getUserFromRequest(env, request);
  if (!user) return { error: json({ error: '請先登入。' }, 401, env, request) };
  if (!(await isAdminUser(env, user))) {
    return { error: json({ error: '只有管理員可以管理帳號。' }, 403, env, request) };
  }
  return { user };
}

async function handleListUsers(env, request) {
  const { error } = await requireAdmin(env, request);
  if (error) return error;
  const { results } = await env.DB.prepare(
    'SELECT id, username, is_admin, created_at FROM users ORDER BY id ASC',
  ).all();
  const anyAdmin = await hasAnyAdmin(env);
  const users = (results || []).map((r, i) => ({
    id: r.id,
    username: r.username,
    // 還沒有任何管理員時，最早建立的帳號會被暫時視為管理員（見 isAdminUser）
    isAdmin: !!r.is_admin || (!anyAdmin && i === 0),
    createdAt: r.created_at,
  }));
  return json({ users }, 200, env, request);
}

async function handleCreateUser(env, request) {
  const { error } = await requireAdmin(env, request);
  if (error) return error;
  const body = await readJSON(request);
  if (!body || !isValidUsername(body.username) || !isValidPassword(body.password)) {
    return json({ error: '帳號需 3-40 個字元；密碼至少 6 個字元。' }, 400, env, request);
  }
  const username = body.username.trim();
  const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (existing) return json({ error: '這個帳號已經被使用了。' }, 409, env, request);

  const salt = randomHex(16);
  const hash = await hashPassword(body.password, salt);
  // 新帳號一律是一般使用者；要給管理員權限請建立後再用 PATCH 調整
  const inserted = await env.DB.prepare(
    'INSERT INTO users (username, password_hash, salt, is_admin) VALUES (?, ?, ?, 0) RETURNING id, created_at',
  ).bind(username, hash, salt).first();

  return json({
    user: { id: inserted.id, username, isAdmin: false, createdAt: inserted.created_at },
  }, 201, env, request);
}

/** 改密碼或改管理員權限。兩個欄位都是選填，有帶才改。 */
async function handleUpdateUser(env, request, targetId) {
  const { user: admin, error } = await requireAdmin(env, request);
  if (error) return error;
  const target = await env.DB.prepare('SELECT id, username, is_admin FROM users WHERE id = ?')
    .bind(targetId).first();
  if (!target) return json({ error: '找不到這個帳號。' }, 404, env, request);

  const body = await readJSON(request);
  if (!body || (body.password === undefined && body.isAdmin === undefined)) {
    return json({ error: '沒有要修改的內容。' }, 400, env, request);
  }

  if (body.password !== undefined) {
    if (!isValidPassword(body.password)) {
      return json({ error: '密碼至少 6 個字元。' }, 400, env, request);
    }
    const salt = randomHex(16);
    const hash = await hashPassword(body.password, salt);
    await env.DB.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?')
      .bind(hash, salt, target.id).run();
    // 改完密碼就把這個帳號其他裝置上的登入狀態清掉
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id).run();
  }

  if (body.isAdmin !== undefined) {
    const nextIsAdmin = body.isAdmin ? 1 : 0;
    // 不讓管理員把自己降級，也不讓最後一位管理員消失（否則沒人能管帳號）
    if (!nextIsAdmin && target.id === admin.id) {
      return json({ error: '不能移除自己的管理員權限。' }, 400, env, request);
    }
    if (!nextIsAdmin && target.is_admin) {
      const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').first();
      if (Number(row.n) <= 1) {
        return json({ error: '至少要保留一位管理員。' }, 400, env, request);
      }
    }
    await env.DB.prepare('UPDATE users SET is_admin = ? WHERE id = ?').bind(nextIsAdmin, target.id).run();
  }

  return json({ ok: true }, 200, env, request);
}

async function handleDeleteUser(env, request, targetId) {
  const { user: admin, error } = await requireAdmin(env, request);
  if (error) return error;
  if (targetId === admin.id) return json({ error: '不能刪除自己的帳號。' }, 400, env, request);
  const target = await env.DB.prepare('SELECT id, is_admin FROM users WHERE id = ?').bind(targetId).first();
  if (!target) return json({ error: '找不到這個帳號。' }, 404, env, request);
  if (target.is_admin) {
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').first();
    if (Number(row.n) <= 1) return json({ error: '至少要保留一位管理員。' }, 400, env, request);
  }
  // D1 預設沒開 foreign key cascade，這裡自己把附屬資料清乾淨。
  // 帳本是全站共用的，不會跟著帳號一起刪。
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id).run();
  await env.DB.prepare('DELETE FROM user_data WHERE user_id = ?').bind(target.id).run();
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(target.id).run();
  return json({ ok: true }, 200, env, request);
}

async function handleLogin(env, request) {
  const body = await readJSON(request);
  if (!body || typeof body.username !== 'string' || typeof body.password !== 'string') {
    return json({ error: '請輸入帳號密碼。' }, 400, env, request);
  }
  const username = body.username.trim();
  const user = await env.DB.prepare(
    'SELECT id, username, password_hash, salt, is_admin FROM users WHERE username = ?',
  ).bind(username).first();
  if (!user) return json({ error: '帳號或密碼錯誤。' }, 401, env, request);

  const hash = await hashPassword(body.password, user.salt);
  if (!timingSafeEqual(hash, user.password_hash)) {
    return json({ error: '帳號或密碼錯誤。' }, 401, env, request);
  }
  const token = await createSession(env, user.id);
  const isAdmin = await isAdminUser(env, { id: user.id, isAdmin: !!user.is_admin });
  return json({ token, username: user.username, isAdmin }, 200, env, request);
}

async function handleMe(env, request) {
  const user = await getUserFromRequest(env, request);
  if (!user) return json({ error: '請先登入。' }, 401, env, request);
  return json({ username: user.username, isAdmin: await isAdminUser(env, user) }, 200, env, request);
}

async function handleLogout(env, request) {
  const auth = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/.exec(auth);
  if (m) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(m[1].trim()).run();
  return json({ ok: true }, 200, env, request);
}

const MAX_PAYLOAD = 8 * 1024 * 1024;

/** 讀出共用帳本；還沒有資料時回傳 rev 0。 */
async function readShared(env) {
  const row = await env.DB.prepare('SELECT data, rev, updated_at FROM shared_data WHERE id = 1').first();
  if (!row) return { data: null, rev: 0, updatedAt: null };
  return { data: JSON.parse(row.data), rev: Number(row.rev), updatedAt: row.updated_at };
}

/** 寫回共用帳本並把 rev 加一。 */
async function writeShared(env, data) {
  const payload = JSON.stringify(data);
  if (payload.length > MAX_PAYLOAD) return null;
  const updatedAt = new Date().toISOString();
  const row = await env.DB.prepare(
    `INSERT INTO shared_data (id, data, rev, updated_at) VALUES (1, ?, 1, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, rev = shared_data.rev + 1,
       updated_at = excluded.updated_at
     RETURNING rev, updated_at`,
  ).bind(payload, updatedAt).first();
  return { rev: Number(row.rev), updatedAt: row.updated_at };
}

/** 一筆記錄至少要有 id 與合法金額才收。 */
function validRecord(r) {
  return r && typeof r === 'object' && typeof r.id === 'string' && r.id
    && isFinite(Number(r.amount));
}

async function handleGetData(env, request) {
  const user = await getUserFromRequest(env, request);
  if (!user) return json({ error: '請先登入。' }, 401, env, request);
  const shared = await readShared(env);
  return json(shared, 200, env, request);
}

/** 追加記錄：任何登入的人都可以，只會新增，不會動到既有資料。
 *  id 已經存在的就跳過（重送同一批不會變成兩筆）。 */
async function handleAppendRecords(env, request) {
  const user = await getUserFromRequest(env, request);
  if (!user) return json({ error: '請先登入。' }, 401, env, request);
  const body = await readJSON(request);
  if (!body || !Array.isArray(body.records) || !body.records.length) {
    return json({ error: '沒有要新增的記錄。' }, 400, env, request);
  }
  if (!body.records.every(validRecord)) {
    return json({ error: '記錄格式不正確。' }, 400, env, request);
  }
  const shared = await readShared(env);
  const data = shared.data && Array.isArray(shared.data.records)
    ? shared.data
    : { settings: (shared.data && shared.data.settings) || {}, records: [] };
  const known = new Set(data.records.map(r => r.id));
  const added = body.records.filter(r => !known.has(r.id));
  if (!added.length) return json({ ...shared, added: 0 }, 200, env, request);
  data.records = [...data.records, ...added];
  const written = await writeShared(env, data);
  if (!written) return json({ error: '資料量過大，無法同步。' }, 413, env, request);
  return json({ data, rev: written.rev, updatedAt: written.updatedAt, added: added.length }, 200, env, request);
}

/** 整份覆寫（改、刪、設定）：只有管理員可以，而且要帶 baseRev。
 *  baseRev 跟伺服器目前的版本對不上就回 409，附上最新資料讓前端重新載入。 */
async function handlePutData(env, request) {
  const { error } = await requireAdmin(env, request);
  if (error) return error;
  const body = await readJSON(request);
  if (!body || typeof body !== 'object' || !Array.isArray(body.records) || typeof body.settings !== 'object') {
    return json({ error: '資料格式不正確，需要 { settings, records }。' }, 400, env, request);
  }
  if (!body.records.every(validRecord)) {
    return json({ error: '記錄格式不正確。' }, 400, env, request);
  }
  const shared = await readShared(env);
  if (Number(body.baseRev) !== shared.rev) {
    return json({
      error: '資料已被其他人更新，請重新載入後再試一次。',
      conflict: true, data: shared.data, rev: shared.rev,
    }, 409, env, request);
  }
  const data = { settings: body.settings, records: body.records };
  const written = await writeShared(env, data);
  if (!written) return json({ error: '資料量過大，無法同步。' }, 413, env, request);
  return json({ ok: true, rev: written.rev, updatedAt: written.updatedAt }, 200, env, request);
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
      if (pathname === '/api/login' && request.method === 'POST') return await handleLogin(env, request);
      if (pathname === '/api/logout' && request.method === 'POST') return await handleLogout(env, request);
      if (pathname === '/api/me' && request.method === 'GET') return await handleMe(env, request);
      if (pathname === '/api/data' && request.method === 'GET') return await handleGetData(env, request);
      if (pathname === '/api/data' && request.method === 'PUT') return await handlePutData(env, request);
      if (pathname === '/api/records' && request.method === 'POST') return await handleAppendRecords(env, request);
      if (pathname === '/api/users' && request.method === 'GET') return await handleListUsers(env, request);
      if (pathname === '/api/users' && request.method === 'POST') return await handleCreateUser(env, request);
      const userMatch = /^\/api\/users\/(\d+)$/.exec(pathname);
      if (userMatch) {
        const id = Number(userMatch[1]);
        if (request.method === 'PATCH') return await handleUpdateUser(env, request, id);
        if (request.method === 'DELETE') return await handleDeleteUser(env, request, id);
      }
      // 已移除公開註冊：帳號只能由管理員建立
      if (pathname === '/api/register') {
        return json({ error: '帳號請由管理員建立。' }, 403, env, request);
      }
      // '/' 不會走到這裡：靜態檔案（public/index.html）會先被比對到
      if (pathname === '/api') {
        return json({ ok: true, service: 'guoding' }, 200, env, request);
      }
      return json({ error: 'Not found' }, 404, env, request);
    } catch (err) {
      return json({ error: '伺服器錯誤：' + err.message }, 500, env, request);
    }
  },
};
