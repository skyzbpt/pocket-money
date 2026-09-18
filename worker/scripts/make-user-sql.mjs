/**
 * 產生「新增帳號」用的 SQL（給全新部署時建立第一個管理員用）。
 *
 * 密碼雜湊方式跟 Worker 裡的 hashPassword 完全一致（PBKDF2-SHA256、
 * 100,000 次迭代、16 bytes 隨機 salt），所以產出的資料可以直接登入。
 *
 * 用法：
 *   node scripts/make-user-sql.mjs <帳號> <密碼> [--admin]
 * 再把印出來的 SQL 丟給 D1：
 *   npx wrangler d1 execute pocket-money-db --remote --command "<上面那段 SQL>"
 */
import { webcrypto as crypto } from 'node:crypto';

const PBKDF2_ITERATIONS = 100000;

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
async function hashPassword(password, saltHex) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial, 256,
  );
  return bytesToHex(bits);
}

const [username, password, ...rest] = process.argv.slice(2);
const isAdmin = rest.includes('--admin');

if (!username || !password) {
  console.error('用法：node scripts/make-user-sql.mjs <帳號> <密碼> [--admin]');
  process.exit(1);
}
if (!/^[a-zA-Z0-9_.\-一-鿿]{3,40}$/.test(username)) {
  console.error('帳號需 3-40 個字元（英數字、底線、句點、連字號或中文）。');
  process.exit(1);
}
if (password.length < 6) {
  console.error('密碼至少 6 個字元。');
  process.exit(1);
}

const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
const hash = await hashPassword(password, salt);
const safeName = username.replace(/'/g, "''");

console.log(
  `INSERT INTO users (username, password_hash, salt, is_admin) ` +
  `VALUES ('${safeName}', '${hash}', '${salt}', ${isAdmin ? 1 : 0});`,
);
