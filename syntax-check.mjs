/** 語法檢查：worker/public/index.html 的內嵌 <script>。 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('./worker/public/index.html', import.meta.url), 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) {
  console.error('FAIL  index.html 裡找不到內嵌的 <script> 區塊');
  process.exit(1);
}
new vm.Script(m[1]);
console.log('PASS  index.html 內嵌 JS 語法');

// 前端必須走相對路徑（同源），不能寫死任何外部網址，也不能有自訂伺服器網址的設定
if (/apiBase|DEFAULT_API_BASE|pocket-money-sync-api'\s*[,)]/.test(m[1].replace("localStorage.removeItem('pocket-money-sync-api')", ''))) {
  console.error('FAIL  前端仍有自訂伺服器網址（apiBase）的殘留');
  process.exit(1);
}
if (!/fetch\(path,/.test(m[1])) {
  console.error('FAIL  syncRequest 應直接用相對路徑 fetch(path, …)');
  process.exit(1);
}
if (/https?:\/\/[^'"\s]*workers\.dev/.test(m[1])) {
  console.error('FAIL  前端不應寫死外部 API 網址');
  process.exit(1);
}
console.log('PASS  前端 API 一律走同源相對路徑');

// 帳號只能由管理員建立：前端不該還留著註冊入口
if (/\/api\/register/.test(html)) {
  console.error('FAIL  前端仍有註冊（/api/register）的呼叫');
  process.exit(1);
}
if (/id="sync-tab-register"/.test(html)) {
  console.error('FAIL  前端仍有「建立帳號」分頁');
  process.exit(1);
}
console.log('PASS  前端沒有公開註冊入口');
