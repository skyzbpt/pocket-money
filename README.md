# 零用金記錄表

一個單檔（single-file）的零用金收支記錄工具，含圖表分析。
不需要安裝、不需要伺服器、不連外網——**直接用瀏覽器打開 `worker/public/index.html`
就能用**（雲端同步是選用功能，見下方說明）。

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

下載後用瀏覽器打開 `worker/public/index.html` 即可；也可以放到任何靜態網頁空間。

```bash
git clone https://github.com/skyzbpt/pocket-money.git
cd pocket-money
# macOS
open worker/public/index.html
# Linux
xdg-open worker/public/index.html
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

部署完成後，先建立第一個帳號（管理員）。app 裡**沒有公開註冊**，
帳號一律由管理員建立，所以第一個帳號用指令直接寫進資料庫：

```bash
# 1) 產生建立帳號用的 SQL（換成你要的帳號密碼）
node scripts/make-user-sql.mjs 你的帳號 你的密碼 --admin

# 2) 把上一步印出來的那行 SQL 直接丟給 D1
npx wrangler d1 execute pocket-money-db --remote --command "<貼上那行 SQL>"
```

密碼雜湊方式跟 Worker 內部完全一樣，建好就能直接登入。
如果資料庫裡已經有舊帳號，也可以改成直接升級某個帳號為管理員：

```bash
npx wrangler d1 execute pocket-money-db --remote \
  --command "UPDATE users SET is_admin = 1 WHERE username = '你的帳號'"
```

若資料庫裡還沒有任何管理員，API 會暫時把「最早建立的帳號」視為管理員，
所以不會有沒人能管帳號的情況；設定好之後建議用上面的指令明確指定。

之後回到 app：右上角「設定選單」→「雲端同步」→ 用管理員帳號登入，
下方會出現「帳號管理（管理員）」區塊，可以：

- 建立新帳號（帳號＋密碼）；新帳號**一律是一般使用者**，
  要給管理員權限請建立後再從清單設定
- 重設任何帳號的密碼（改完該帳號所有裝置會被登出，需重新登入）
- 給予或取消管理員權限（不能取消自己的，也至少要保留一位管理員）
- 刪除帳號（連同它在雲端的資料一起刪除）

一般使用者只會看到登入欄位，**不能自己註冊，也不能自己改密碼**，
需要換密碼請找管理員。登入時也**不需要填伺服器網址**。

### 一般使用者能做什麼

登入為一般使用者時，明細是**唯讀**的：

- ✅ 可以用「新增記錄」卡片記帳（這是唯一能改資料的地方）
- ✅ 可以篩選、排序、看圖表、匯出 CSV／備份 JSON、匯入 CSV（只會新增記錄）
- ❌ 明細每一列沒有「編輯」「刪除」按鈕
- ❌ 沒有「清空所有記錄」「還原備份 JSON」

管理員則不受限制。**沒有登入**的純本機使用也不受限制（資料只在自己的瀏覽器裡，
沒有跨裝置同步的問題）。

> 這層限制做在前端 UI。每個帳號的雲端資料是各自獨立的一份，
> 一般使用者能動到的只有自己的資料，不會影響別人的帳本。

### 同步時機

登入後**任何記錄更動都會自動同步**（新增、編輯、刪除、匯入、設定調整），
所以沒有「立即同步」按鈕。實作上是變更後 0.8 秒內合併送出一次，
離開頁面或切到背景時會把還沒送出的變更補送完。

因為前端和 API 在同一個 Worker、同一個網址底下，app 會自己找到後端。
在另一台裝置打開同一個網址、用同一組帳號密碼登入，就會看到同一份資料。

app 裡沒有「伺服器網址」這個設定，也不提供自訂——API 一律走同網域的
相對路徑 `/api/...`。

還沒登入的話，app 的行為跟純本機版完全一樣，不影響原本的離線使用。

免費額度（Cloudflare Workers Free + D1 Free）對個人／家庭零用金記帳
綽綽有餘，不需要輸入信用卡。

## 部署與 CI

**前端和 API 都在同一個 Worker 裡**，網址是
`https://guoding.skyzbpt.workers.dev`：

| 路徑 | 由誰處理 |
|---|---|
| `/` 等靜態路徑 | `worker/public/index.html`（Workers static assets） |
| `/api/*` | `worker/src/index.js` |

因為同源，app 呼叫 `/api/...` 相對路徑就好，不需要設定伺服器網址，
也不會有 CORS 問題。

**部署由 Cloudflare 的 Git 整合負責**，push 到預設分支之後它會自己從這個
repo 建置並部署，不需要在 GitHub 這邊設定任何 token 或 secret。

**GitHub Actions 只跑測試**（`.github/workflows/ci.yml`），push 和 PR 都會觸發：

```bash
cd worker && node cors-test.mjs   # CORS 白名單 11 項
node syntax-check.mjs             # index.html 內嵌 JS 語法、DEFAULT_API_BASE 設定
```

這些在本機直接跑就可以，不需要任何相依套件。

**D1 的 schema 只需套用一次**，CI 不會自動跑
（目前的 `pocket-money-db` 已經套用過，不需要重跑）：

```bash
cd worker
npx wrangler d1 execute pocket-money-db --remote --file=./schema.sql
```

> **CORS 設定**：`worker/wrangler.toml` 裡的 `ALLOWED_ORIGIN` 是白名單，
> 目前設為 `"https://guoding.skyzbpt.workers.dev,null"`。
>
> 一般使用其實用不到 CORS——前端和 API 在同一個 Worker、同一個網址，
> 瀏覽器不會發出跨來源請求。白名單是為了保護「從別的網站直接打這個
> API」的情況。
>
> 要注意 `null` 不是 `file://` 專用：sandboxed iframe 等情況送出的 Origin
> 也是 `null`，所以任何網站都有辦法造出這種請求。不再需要用檔案方式開啟
> 的話，把 `,null` 拿掉會更嚴謹。
>
> 另外，CORS 只約束瀏覽器，不是身分驗證——真正擋住資料的是 Bearer token。

## 技術

原生 HTML／CSS／JavaScript，圖表為手寫 SVG，前端**零相依套件、零外部請求**。
雲端同步後端是零相依套件的 Cloudflare Worker（純 Web Crypto API 做密碼雜湊），
見 `worker/src/`。不啟用雲端同步的話，整個應用就是一個 `index.html`。
