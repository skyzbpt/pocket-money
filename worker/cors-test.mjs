import { readFileSync } from 'node:fs';
// 只抽出 CORS 相關的三個函式來測，不用啟整個 worker
const src = readFileSync(new URL('./src/index.js', import.meta.url), 'utf8');
const start = src.indexOf('function allowedOrigins');
const end = src.indexOf('function json(');
const mod = await import('data:text/javascript;base64,' + Buffer.from(
  src.slice(start, end) + '\nexport { allowedOrigins, resolveOrigin, corsHeaders };'
).toString('base64'));

const req = (origin) => new Request('https://x/', origin === undefined ? {} : { headers: { Origin: origin } });
const ACAO = (env, origin) => mod.corsHeaders(env, req(origin))['Access-Control-Allow-Origin'];

let fail = 0;
const t = (name, got, want) => {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
};

const tight = { ALLOWED_ORIGIN: 'https://guoding.skyzbpt.workers.dev,null' };
t('白名單內的網域（app 自己的網址）→ 回傳該網域', ACAO(tight, 'https://guoding.skyzbpt.workers.dev'), 'https://guoding.skyzbpt.workers.dev');
t('file:// 的 null → 允許', ACAO(tight, 'null'), 'null');
t('不在名單的網域 → 不送 ACAO',   ACAO(tight, 'https://evil.example'), undefined);
t('沒帶 Origin（curl）→ 不送 ACAO', ACAO(tight, undefined), undefined);
t('大小寫/尾斜線不算同一個',       ACAO(tight, 'https://guoding.skyzbpt.workers.dev/'), undefined);

const open = { ALLOWED_ORIGIN: '*' };
t('設成 * → 全開',                ACAO(open, 'https://anything.example'), '*');
const unset = {};
t('沒設定 → 預設全開（向後相容）', ACAO(unset, 'https://anything.example'), '*');

const spaced = { ALLOWED_ORIGIN: ' https://a.example , null ' };
t('逗號前後有空白也要能解析',      ACAO(spaced, 'https://a.example'), 'https://a.example');

t('Vary 一定要有', mod.corsHeaders(tight, req('https://evil.example'))['Vary'], 'Origin');
t('resolveOrigin 對不允許的回 false', mod.resolveOrigin(tight, req('https://evil.example')), false);
t('resolveOrigin 對沒 Origin 回 null', mod.resolveOrigin(tight, req(undefined)), null);

console.log(fail ? `\n${fail} 項失敗` : '\n全部通過');
process.exit(fail ? 1 : 0);
