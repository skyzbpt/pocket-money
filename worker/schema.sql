-- 零用金記錄表雲端同步 API 的資料庫結構
-- 這份 schema 已經直接套用到 Cloudflare D1 資料庫「pocket-money-db」
-- （uuid: ec22dfcd-87c6-4812-952f-407975e83372）。
-- 只有在你想另外新建一個資料庫時才需要手動執行這個檔案：
--   npx wrangler d1 execute pocket-money-db --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  -- 1 = 管理員：只有管理員能新增帳號、改別人的密碼、給或收回管理員權限
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 舊資料庫升級用（已經有 users 表、但還沒有 is_admin 欄位時執行一次）：
--   npx wrangler d1 execute pocket-money-db --remote \
--     --command "ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0"
-- 指定第一位管理員：
--   npx wrangler d1 execute pocket-money-db --remote \
--     --command "UPDATE users SET is_admin = 1 WHERE username = '你的帳號'"
-- 若資料庫裡還沒有任何管理員，API 會暫時把「最早建立的帳號」視為管理員，
-- 讓你不會被鎖在外面；設好之後建議照上面指令明確指定。

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- 全站共用的一份帳本（settings + records），所有帳號讀寫的都是這一列。
-- 格式跟 app 內建的「匯出備份 JSON」相同。
-- rev 是版本號：管理員整份覆寫時會檢查，避免蓋掉別人剛寫進來的資料。
CREATE TABLE IF NOT EXISTS shared_data (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 舊版是「每個帳號各自一份」，保留這張表只是為了保險（已不再使用）。
-- 從舊版升級時把各帳號的記錄合併成一份共用帳本，見 README 的升級說明。
CREATE TABLE IF NOT EXISTS user_data (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
