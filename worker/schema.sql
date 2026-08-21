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
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- 每個帳號的完整資料（settings + records）存成一份 JSON，
-- 跟 app 內建的「匯出備份 JSON」是同一種格式，同步邏輯就是整份覆蓋。
CREATE TABLE IF NOT EXISTS user_data (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
