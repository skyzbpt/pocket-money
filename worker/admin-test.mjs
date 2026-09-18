/**
 * 帳號權限測試：帳號只能由管理員建立與修改。
 * 用 node:sqlite 做一個最小的 D1 替身（prepare/bind/first/run/all），
 * 直接把 worker 的 fetch 跑起來測真實的路由與權限判斷。
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import worker from './src/index.js';

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

/** D1 介面的最小替身。 */
function makeDB() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  const run = (sql, args) => {
    const stmt = db.prepare(sql);
    if (/^\s*select/i.test(sql) || /returning/i.test(sql)) return stmt.all(...args);
    stmt.run(...args);
    return [];
  };
  return {
    prepare(sql) {
      const args = [];
      const api = {
        bind(...a) { args.push(...a); return api; },
        async first() { return run(sql, args)[0] ?? null; },
        async all() { return { results: run(sql, args) }; },
        async run() { return run(sql, args); },
      };
      return api;
    },
  };
}

const env = { ALLOWED_ORIGIN: '*' };
let DB;

function call(method, path, { token, body } = {}) {
  return worker.fetch(new Request('https://x' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { ...env, DB });
}

let fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
};

DB = makeDB();

// 第一位管理員照 README 的方式直接寫進資料庫
const { execFileSync } = await import('node:child_process');
const insertSQL = execFileSync(process.execPath,
  ['scripts/make-user-sql.mjs', 'boss', 'secret123', '--admin'],
  { cwd: fileURLToPath(new URL('.', import.meta.url)) }).toString().trim();
await DB.prepare(insertSQL).run();

// 公開註冊已移除
const reg = await call('POST', '/api/register', { body: { username: 'someone', password: 'abcdef' } });
t('/api/register 已關閉', reg.status, 403);

// 管理員登入
const loginRes = await call('POST', '/api/login', { body: { username: 'boss', password: 'secret123' } });
const boss = await loginRes.json();
t('管理員登入成功', loginRes.status, 200);
t('登入回傳 isAdmin', boss.isAdmin, true);

// 管理員建立帳號：即使 body 帶了 isAdmin，新帳號一律是一般使用者
const created = await call('POST', '/api/users', {
  token: boss.token, body: { username: 'user1', password: 'abcdef', isAdmin: true },
});
t('管理員可以建立帳號', created.status, 201);
t('新帳號一律非管理員', (await created.json()).user.isAdmin, false);

// 一般使用者登入後不能管帳號
const u1 = await (await call('POST', '/api/login', { body: { username: 'user1', password: 'abcdef' } })).json();
t('一般使用者登入不是管理員', u1.isAdmin, false);
t('一般使用者不能列帳號', (await call('GET', '/api/users', { token: u1.token })).status, 403);
t('一般使用者不能建帳號',
  (await call('POST', '/api/users', { token: u1.token, body: { username: 'x1', password: 'abcdef' } })).status, 403);
t('一般使用者不能改別人密碼',
  (await call('PATCH', '/api/users/1', { token: u1.token, body: { password: 'newpass' } })).status, 403);
t('一般使用者不能改自己密碼',
  (await call('PATCH', '/api/users/2', { token: u1.token, body: { password: 'newpass' } })).status, 403);
t('沒登入不能列帳號', (await call('GET', '/api/users')).status, 401);

// 管理員的權限操作
const list = await (await call('GET', '/api/users', { token: boss.token })).json();
t('管理員看得到帳號清單', list.users.length, 2);

t('管理員不能移除自己的管理員權限',
  (await call('PATCH', '/api/users/1', { token: boss.token, body: { isAdmin: false } })).status, 400);
t('管理員可以重設別人的密碼',
  (await call('PATCH', '/api/users/2', { token: boss.token, body: { password: 'newpass1' } })).status, 200);
t('改密碼後舊 token 失效', (await call('GET', '/api/data', { token: u1.token })).status, 401);
t('新密碼可以登入',
  (await call('POST', '/api/login', { body: { username: 'user1', password: 'newpass1' } })).status, 200);
t('管理員可以給別人管理員權限',
  (await call('PATCH', '/api/users/2', { token: boss.token, body: { isAdmin: true } })).status, 200);
t('管理員不能刪除自己', (await call('DELETE', '/api/users/1', { token: boss.token })).status, 400);
t('管理員可以刪除別的帳號', (await call('DELETE', '/api/users/2', { token: boss.token })).status, 200);
t('刪掉後只剩一個帳號',
  (await (await call('GET', '/api/users', { token: boss.token })).json()).users.length, 1);

/* ── 共用帳本 ────────────────────────────────────────────────────── */
DB = makeDB();
DB.prepare(insertSQL).run();   // boss（管理員）
const boss2 = await (await call('POST', '/api/login', { body: { username: 'boss', password: 'secret123' } })).json();
await call('POST', '/api/users', { token: boss2.token, body: { username: 'staff', password: 'abcdef' } });
const staff = await (await call('POST', '/api/login', { body: { username: 'staff', password: 'abcdef' } })).json();

const rec = (id, amount) => ({ id, date: '2026-09-18', type: 'expense', category: '餐費',
  name: id, person: 'x', amount, payment: '現金', note: '' });

// 管理員先建立第一份帳本
const first = await call('PUT', '/api/data', {
  token: boss2.token, body: { settings: { people: ['boss'] }, records: [rec('r1', 100)], baseRev: 0 },
});
t('管理員可以整份覆寫', first.status, 200);
const rev1 = (await first.json()).rev;
t('覆寫後 rev 前進', rev1, 1);

// 員工看到的是同一本帳
const staffView = await (await call('GET', '/api/data', { token: staff.token })).json();
t('員工看得到管理員記的帳', staffView.data.records.map(r => r.id), ['r1']);
t('員工拿到同一個 rev', staffView.rev, rev1);

// 員工只能追加
const appended = await call('POST', '/api/records', { token: staff.token, body: { records: [rec('r2', 50)] } });
t('員工可以追加記錄', appended.status, 200);
const afterAppend = await appended.json();
t('追加後兩筆都在', afterAppend.data.records.map(r => r.id), ['r1', 'r2']);
t('管理員也看得到員工記的帳',
  (await (await call('GET', '/api/data', { token: boss2.token })).json()).data.records.length, 2);
t('重送同一批不會變兩筆',
  (await (await call('POST', '/api/records', { token: staff.token, body: { records: [rec('r2', 50)] } })).json())
    .data.records.filter(r => r.id === 'r2').length, 1);
t('員工不能整份覆寫',
  (await call('PUT', '/api/data', { token: staff.token, body: { settings: {}, records: [], baseRev: afterAppend.rev } })).status, 403);
t('員工不能用追加改掉既有記錄',
  (await (await call('POST', '/api/records', { token: staff.token, body: { records: [rec('r1', 99999)] } })).json())
    .data.records.find(r => r.id === 'r1').amount, 100);

// 版本檢查：管理員拿舊的 baseRev 覆寫會被擋下
const stale = await call('PUT', '/api/data', {
  token: boss2.token, body: { settings: {}, records: [rec('r1', 100)], baseRev: 0 },
});
t('用過期的 baseRev 覆寫回 409', stale.status, 409);
const staleBody = await stale.json();
t('409 會附上最新資料', staleBody.data.records.length, 2);
t('被擋下後資料沒有被改掉',
  (await (await call('GET', '/api/data', { token: boss2.token })).json()).data.records.length, 2);

// 用正確的 rev 就可以刪
const del = await call('PUT', '/api/data', {
  token: boss2.token, body: { settings: {}, records: [rec('r2', 50)], baseRev: staleBody.rev },
});
t('管理員用最新 rev 可以刪記錄', del.status, 200);
t('刪除後只剩一筆',
  (await (await call('GET', '/api/data', { token: boss2.token })).json()).data.records.map(r => r.id), ['r2']);

// 刪帳號不會刪掉共用帳本
await call('DELETE', '/api/users/2', { token: boss2.token });
t('刪帳號後帳本還在',
  (await (await call('GET', '/api/data', { token: boss2.token })).json()).data.records.length, 1);

console.log(fail === 0 ? '\n全部通過' : `\n${fail} 項失敗`);
process.exit(fail === 0 ? 0 : 1);
