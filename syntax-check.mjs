/** 語法檢查：index.html 的內嵌 <script>，以及 _worker.js。 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) {
  console.error('FAIL  index.html 裡找不到內嵌的 <script> 區塊');
  process.exit(1);
}
new vm.Script(m[1]);
console.log('PASS  index.html 內嵌 JS 語法');

// _worker.js 是 ES module，用動態 import 驗證它能被解析並載入
const mod = await import('./_worker.js');
if (typeof mod.default?.fetch !== 'function') {
  console.error('FAIL  _worker.js 沒有輸出 default.fetch');
  process.exit(1);
}
console.log('PASS  _worker.js 語法與 default export');
