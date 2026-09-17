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

// 前端必須走相對路徑（同源），不能寫死任何外部網址
const base = m[1].match(/const DEFAULT_API_BASE = '([^']*)'/);
if (!base) {
  console.error('FAIL  找不到 DEFAULT_API_BASE');
  process.exit(1);
}
if (base[1] !== '') {
  console.error(`FAIL  DEFAULT_API_BASE 應為空字串（同源），目前是 ${JSON.stringify(base[1])}`);
  process.exit(1);
}
console.log('PASS  DEFAULT_API_BASE 是同源設定');
