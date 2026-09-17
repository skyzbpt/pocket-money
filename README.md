# 零用金記錄表

一個單檔（single-file）的零用金收支記錄工具，含圖表分析。
不需要安裝、不需要伺服器、不連外網——**直接用瀏覽器打開 `index.html` 就能用**。

## 功能

### 記帳
每筆記錄包含：**日期、支出／收入、類別、項目名稱、記錄人、金額、付款方式、備註**。

- 送出後會保留日期／記錄人／付款方式，方便連續輸入多筆
- 明細列可直接**編輯**或**刪除**
- 明細表點欄位標題可排序

### 可自行維護的下拉選單
右上角「⚙️ 設定選單」可隨時**新增／改名／排序／刪除**這四組下拉選單：

| 選單 | 說明 |
|---|---|
| 支出類別 | 類型選「支出」時出現的類別 |
| 收入類別 | 類型選「收入」時出現的類別 |
| 記錄人 | 誰記的這筆帳 |
| 付款方式 | 現金、悠遊卡、信用卡…… |

- **改名**時會問你要不要一併更新既有記錄，選「確定」就會全部同步改掉
- **刪除**已被使用的項目時會提醒你有幾筆記錄在用；刪掉後那些記錄仍保留原值，只是不再出現在下拉選單裡
- 同一組選單裡不允許重複名稱，且每組至少保留一項

設定裡還可以填**期初零用金**：
`目前零用金餘額 = 期初零用金 + 全部收入 − 全部支出`

### 圖表
四張圖，都會跟著上方的篩選條件一起變動，每張都可以切換成**表格檢視**：

1. **每月收支與結餘** — 收入／支出長條 + 結餘折線（同一個座標軸、同一種單位）
2. **支出類別佔比** — 甜甜圈圖，超過 6 類會把尾端併成「其他」
3. **各記錄人支出** — 橫向長條
4. **各付款方式支出** — 橫向長條

滑鼠移到任一圖形上會顯示明細；用鍵盤 Tab 也可以逐一讀到相同內容。
配色通過色盲（protan／deutan／tritan）辨識度檢核，並提供淺色／深色兩套。

### 篩選
起訖日期、類型、類別、記錄人、付款方式、關鍵字（比對項目名稱與備註），
以及「本月／上月／近 90 天／今年／全部」快捷鍵。
篩選會同時套用到統計卡、四張圖表與明細表。

### 匯出與備份
- **匯出 CSV** — 匯出目前篩選結果，帶 BOM，Excel／Numbers 開啟不會亂碼
- **匯入 CSV** — 欄位需含「日期、類型、類別、項目名稱、記錄人、金額、付款方式」（備註選填）；匯入時出現的新類別／記錄人／付款方式會自動補進下拉選單。建議先匯出一份當格式範本
- **匯出／還原備份 JSON** — 連同設定一起備份，還原會覆蓋現有資料

## 使用方式

下載後用瀏覽器打開 `index.html` 即可；也可以放到任何靜態網頁空間（GitHub Pages 等）。

```bash
git clone https://github.com/skyzbpt/pocket-money.git
cd pocket-money
# macOS
open index.html
# Linux
xdg-open index.html
```

## 資料存在哪裡

預設資料存在**這台裝置這個瀏覽器**的 `localStorage`（key：`pocket-money-v1`），
不會上傳到任何伺服器。因此：

- 換裝置、換瀏覽器看不到同一份資料
- 清除瀏覽器資料（含「清除網站資料／Cookie」）會一併清掉記錄
- 要搬移或長期保存，請用**匯出備份 JSON**

如果只是偶爾要在裝置之間搬資料，把備份 JSON 傳給對方還原即可；
如果要**跨裝置即時同步**（例如手機記帳、電腦看報表），可以照下面的步驟
自己部署一個免費的雲端同步後端，帳號密碼登入後資料就會自動同步。

## 跨裝置雲端同步（選用，Cloudflare Workers + D1）

`worker/` 目錄是一個完整、可直接部署的 Cloudflare Worker API：
帳號登入、密碼用 PBKDF2（100,000 次迭代）雜湊後存放，整份
`{ settings, records }` 存成一筆 JSON，跟 app 內建的「匯出備份 JSON」
是同一種格式，同步方式是整份覆蓋（最後寫入者為準）。

**部署步驟**（約 5 分鐘，需要一個免費的 Cloudflare 帳號）：

```bash
cd worker
npm install -g wrangler   # 或用 npx wrangler，不用全域安裝也可以
wrangler login             # 瀏覽器會跳出來，登入你的 Cloudflare 帳號

# 新建一個屬於你自己的 D1 資料庫，並套用資料庫結構
wrangler d1 create pocket-money-db
# ↑ 指令執行完會印出一組 database_id，把它貼到 wrangler.toml 裡的
#   database_id 欄位（取代裡面預設的那組）
wrangler d1 execute pocket-money-db --remote --file=./schema.sql

# 部署！完成後終端機會印出一個網址，長得像：
# https://guoding.你的帳號.workers.dev
wrangler deploy
```

部署完成後回到 app：右上角「設定選單」→「雲端同步」→ 直接建立帳號
（帳號＋密碼）就好，**不需要填伺服器網址**。

因為前端和 API 是同一個網域（`guoding.pages.dev` 底下的 `/api/*` 會由
`pages/_worker.js` 轉給 Worker），app 會自己找到後端。在另一台裝置打開
同一個網址、用同一組帳號密碼登入，就會看到同一份資料。

app 裡沒有「伺服器網址」這個設定——自己另外部署一套的人，直接改
`index.html` 裡的 `DEFAULT_API_BASE` 常數即可。

沒有設定伺服器網址、或還沒登入的話，app 的行為跟純本機版完全一樣，
不影響原本的離線使用。

免費額度（Cloudflare Workers Free + D1 Free）對個人／家庭零用金記帳
綽綽有餘，不需要輸入信用卡。

## 自動部署（GitHub Actions）

設定好之後，push 到預設分支就會自動部署，不用再手動跑 `wrangler`。

`.github/workflows/` 裡有兩個 workflow：

| 檔案 | 什麼時候跑 | 做什麼 |
|---|---|---|
| `deploy-worker.yml` | `worker/` 底下有檔案變動時 | 部署雲端同步 API 到 Cloudflare Workers |
| `deploy-pages.yml` | `index.html` 有變動時 | 把 `index.html` 部署到 Cloudflare Pages |

兩個都可以到 GitHub 的 Actions 分頁手動觸發（Run workflow）。

**第一次設定（做一次就好）：**

1. **建一組 Cloudflare API Token**
   到 [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) →
   Create Token → Custom token，權限勾這三個：
   - `Account` → `Workers Scripts` → `Edit`
   - `Account` → `D1` → `Edit`
   - `Account` → `Cloudflare Pages` → `Edit`

2. **把 Token 放進 GitHub Secrets**
   repo 的 Settings → Secrets and variables → Actions → New repository secret，
   建立兩個：

   | 名稱 | 值 |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | 上一步建立的 token |
   | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 儀表板右側的 Account ID |

3. **建立 Pages 專案**（只有要用 `deploy-pages.yml` 才需要）
   Cloudflare 儀表板 → Workers & Pages → Create → Pages → Direct Upload，
   專案名稱填 `guoding`（要跟 workflow 裡的 `--project-name` 一致）。

4. **D1 資料庫的 schema 只需套用一次**，workflow 不會自動跑
   （目前的 `pocket-money-db` 已經套用過了，不需要重跑）：
   ```bash
   cd worker
   npx wrangler d1 execute pocket-money-db --remote --file=./schema.sql
   ```

設定完成後，之後改 `index.html` 或 `worker/` 再 push，Cloudflare 上就會是最新版。

> **CORS 設定**：`worker/wrangler.toml` 裡的 `ALLOWED_ORIGIN` 是白名單，
> 目前設為 `"https://guoding.pages.dev,null"`——前者是實際的前端網址，
> `null` 是為了讓「直接用瀏覽器開啟本機 `index.html`」（`file://`）也能同步。
>
> 要注意 `null` 不是 `file://` 專用：sandboxed iframe 等情況送出的 Origin 也是 `null`，
> 所以任何網站都有辦法造出這種請求。如果之後不再用檔案方式開啟，把 `,null` 拿掉會更嚴謹。
>
> 另外，CORS 只約束瀏覽器，不是身分驗證——真正擋住資料的是 Bearer token。

## 技術

原生 HTML／CSS／JavaScript，圖表為手寫 SVG，前端**零相依套件、零外部請求**。
雲端同步後端是零相依套件的 Cloudflare Worker（純 Web Crypto API 做密碼雜湊），
見 `worker/` 目錄。不啟用雲端同步的話，整個應用就是一個 `index.html`。
