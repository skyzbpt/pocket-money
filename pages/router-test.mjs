import worker from './_worker.js';

let fail = 0;
const t = (name, got, want) => {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
};

// 假的 env：記錄請求被送到哪一邊
const mkEnv = (withBinding = true) => {
  const hits = [];
  const env = {
    ASSETS: { fetch: (r) => { hits.push(['assets', new URL(r.url).pathname]); return new Response('asset'); } },
  };
  if (withBinding) env.API = { fetch: (r) => { hits.push(['api', new URL(r.url).pathname]); return new Response('api'); } };
  return { env, hits };
};

const go = async (path, withBinding = true, method = 'GET') => {
  const { env, hits } = mkEnv(withBinding);
  const res = await worker.fetch(new Request('https://guoding.pages.dev' + path, { method }), env);
  return { target: hits[0] && hits[0][0], path: hits[0] && hits[0][1], status: res.status };
};

t('/api/login → 轉給 Worker',      (await go('/api/login', true, 'POST')).target, 'api');
t('/api/login 路徑原樣傳過去',      (await go('/api/login', true, 'POST')).path, '/api/login');
t('/api/data → 轉給 Worker',        (await go('/api/data')).target, 'api');
t('/api（無斜線）→ 轉給 Worker',    (await go('/api')).target, 'api');
t('/ → 靜態檔案',                   (await go('/')).target, 'assets');
t('/index.html → 靜態檔案',         (await go('/index.html')).target, 'assets');
t('/apifoo → 靜態檔案（不誤判）',   (await go('/apifoo')).target, 'assets');
t('沒設 service binding → 503',     (await go('/api/login', false)).status, 503);

console.log(fail ? `\n${fail} 項失敗` : '\n全部通過');
process.exit(fail ? 1 : 0);
