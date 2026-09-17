import worker from './_worker.js';

let fail = 0;
const t = (name, got, want) => {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
};

const mkEnv = (withBinding) => {
  const hits = [];
  const env = {
    ASSETS: { fetch: (r) => { hits.push(['assets', new URL(r.url).href]); return new Response('asset'); } },
  };
  if (withBinding) env.API = { fetch: (r) => { hits.push(['binding', new URL(r.url).href]); return new Response('api'); } };
  return { env, hits };
};

// 攔截全域 fetch，才能驗證「沒有 service binding」時打到哪裡
const realFetch = globalThis.fetch;
let outbound = [];
globalThis.fetch = async (req) => { outbound.push({ url: req.url, method: req.method }); return new Response('proxied'); };

const go = async (path, withBinding, init = {}) => {
  const { env, hits } = mkEnv(withBinding);
  outbound = [];
  const res = await worker.fetch(new Request('https://guoding.pages.dev' + path, init), env);
  return { via: hits[0]?.[0] ?? (outbound.length ? 'proxy' : null), url: hits[0]?.[1] ?? outbound[0]?.url, method: outbound[0]?.method, status: res.status };
};

// 有 service binding
t('有 binding：/api/login 走內部網路', (await go('/api/login', true, { method: 'POST' })).via, 'binding');
t('有 binding：網址原樣不動',          (await go('/api/login', true, { method: 'POST' })).url, 'https://guoding.pages.dev/api/login');

// 沒有 service binding → 走公開網址
const p = await go('/api/login', false, { method: 'POST' });
t('無 binding：改打 workers.dev',      p.via, 'proxy');
t('無 binding：換成正確的 origin',     p.url, 'https://guoding.skyzbpt.workers.dev/api/login');
t('無 binding：method 保留',           p.method, 'POST');

const q = await go('/api/data?since=1', false);
t('無 binding：查詢字串保留',          q.url, 'https://guoding.skyzbpt.workers.dev/api/data?since=1');

// 靜態檔案
t('/ → 靜態檔案',                      (await go('/', true)).via, 'assets');
t('/index.html → 靜態檔案',            (await go('/index.html', true)).via, 'assets');
t('/apifoo → 靜態檔案（不誤判）',      (await go('/apifoo', true)).via, 'assets');
t('/api（無斜線）→ 轉給 Worker',       (await go('/api', true)).via, 'binding');

globalThis.fetch = realFetch;
console.log(fail ? `\n${fail} 項失敗` : '\n全部通過');
process.exit(fail ? 1 : 0);
