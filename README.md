# 社區交接清冊系統

給社區經理填寫「物業交接清冊」的前台表單，以及讓內勤人員查看紀錄、管理 Word 範本、
一鍵產生正式交接清冊 Word 檔的後台系統。

## 功能總覽

- **前台（社區經理）**：`/`，開啟就是動態產生的表單，依分類分區塊呈現題目，送出後存入資料庫。
- **後台（內勤人員）**：`/admin.html`，需登入。
  - **填答紀錄**：列表所有送出的清冊，可針對任一筆資料選擇範本，一鍵產生 Word 下載。
  - **Word 範本管理**：上傳 `.docx` 範本、設定預設範本、刪除範本。
  - **表單題目設定**：新增/修改/刪除/調整前台表單的題目，不用改程式碼。

## 版型設計方式（重點）

系統**不是**做一個網頁版的排版編輯器，而是讓內勤人員直接用最熟悉的 **Microsoft Word**
設計範本 —— 字型、顏色、行距、頁首頁尾、公司 Logo、簽名欄位置都在 Word 裡自由排版，
只要在要帶入資料的位置輸入 `{{欄位代碼}}`（雙大括號），系統就會自動把該筆填答資料套進去，
產生一份排版完整的正式 Word 文件。

- 欄位代碼請對照「表單題目設定」頁面裡每個題目的 `id`（例如 `community_name`、`handover_date`）。
- 專案內附上一份已經設計好、可直接使用或當作修改起點的範本：
  `sample-template/交接清冊範本-預設版.docx`
- 之後想換版型、加公司抬頭、換字型顏色，內勤人員只要複製一份範本用 Word 編輯、
  存檔後到「Word 範本管理」重新上傳、設為預設即可，完全不需要工程師介入。

## 安裝與啟動（開發環境）

需求：Node.js 18 以上版本。

```bash
cd handover-system
npm install
cp .env.example .env      # 複製並修改帳號密碼
npm start
```

啟動後：
- 前台表單：http://localhost:3000/
- 後台管理：http://localhost:3000/admin.html
  （預設帳密請見 `.env`，第一次上線請務必修改）

## 給完全沒有伺服器經驗的人：最簡單的上線方式（推薦 Zeabur）

如果您只有一台自己的電腦、沒架設過伺服器，最快的方式是用「雲端平台」，
不需要買主機、不需要懂 Linux 指令。這裡推薦 **Zeabur**（zeabur.com），
介面有繁體中文、有免費方案，操作方式如下：

1. 到 GitHub（github.com）註冊一個免費帳號。
2. 建立一個新的 Repository（儲存庫），把 `handover-system` 資料夾整個拖曳上傳
   （GitHub 網頁上有「uploading an existing file」的功能，可以直接拖資料夾上去，
   不需要用任何指令）。
3. 到 Zeabur（zeabur.com）用 GitHub 帳號登入，建立一個新專案，
   選擇「Deploy from GitHub」，選擇剛剛上傳的儲存庫，它會自動偵測是 Node.js 專案並開始部署。
4. 部署完成後，到該服務的「Variables（環境變數）」分頁，
   新增 `ADMIN_USER`、`ADMIN_PASS`、`SESSION_SECRET`、`DATA_DIR=/data` 這幾個變數
   （值請自己填，`DATA_DIR` 請照打 `/data`）。
5. 到「硬碟 / Volume」分頁，掛載一個 Volume，Mount Directory 填 `/data`
   （這樣資料庫和上傳的範本檔才會永久保存，重新部署也不會消失）。
6. 到「Domain（網域）」分頁點「產生網域」，就會得到一個像
   `https://your-app.zeabur.app` 的網址，這就是正式的網站網址，
   把它分享給社區經理（前台表單網址）和內勤同仁（後台網址請加 `/admin.html`）即可。

完成以上步驟，系統就會 24 小時在雲端運作，不需要您自己的電腦一直開著。

## 部署到正式伺服器（進階／自有主機方式）

這是一個標準的 Node.js + Express 應用，資料庫用 SQLite（單一檔案 `data.sqlite`），
不需要額外的資料庫伺服器，因此有幾種常見部署方式：

### 方式一：自有主機 / VPS
1. 將整個專案上傳到伺服器（或用 git clone）。
2. `npm install --production`
3. 設定 `.env`（正式帳密、`SESSION_SECRET` 請用亂數字串）。
4. 用 `pm2` 常駐執行：
   ```bash
   npm install -g pm2
   pm2 start server.js --name handover-system
   pm2 save
   ```
5. 前面架一台 Nginx 反向代理到 `localhost:3000`，並申請 HTTPS 憑證（例如 Let's Encrypt / certbot）。
   內部系統務必要有 HTTPS，避免登入密碼被竊聽。

### 方式二：雲端 PaaS（如 Render、Railway、Zeabur 等）
- 這類平台通常會抹除容器內的檔案系統，SQLite 檔案、上傳的範本檔在重新部署後可能消失，
  建議掛載一個「持久化磁碟（Persistent Disk / Volume）」到專案根目錄（存放 `data.sqlite`
  和 `uploads/` 資料夾），或改用平台提供的 PostgreSQL（見下方「後續可強化項目」）。

### 資料備份
- 定期備份 `data.sqlite`（所有填答紀錄）與 `uploads/templates/`（所有範本檔）即可完整備份系統資料。

## 安全性注意事項

- 上線前務必：
  1. 修改 `.env` 裡的 `ADMIN_USER` / `ADMIN_PASS`。
  2. 修改 `SESSION_SECRET` 為隨機字串。
  3. 全站啟用 HTTPS。
- 目前後台是單一組帳號密碼，若內勤人員不只一人、需要各自登入或做權限區分，
  建議下一步把帳號改成存在資料庫裡的多組使用者（見下方）。

## 後續可強化項目（依需求選用）

- **多組後台帳號 / 權限分級**：目前是單一帳密，可擴充成資料庫使用者表 + 密碼雜湊（bcrypt）。
- **改用 PostgreSQL / MySQL**：資料量大、需要多台伺服器同時運作時，把 `db.js`
  換成對應的資料庫驅動即可，其餘程式邏輯不需大改。
- **檔案上傳的圖片附件**（例如交接時拍攝的現場照片），可以另外做一個附件上傳欄位，
  存檔後在 Word 範本裡用 docxtemplater 的圖片模組插入。
- **Email 通知**：送出表單後自動寄信通知內勤主管。
- **匯出 Excel 總表**：除了逐筆產生 Word，也可以增加「匯出全部紀錄成 Excel」的功能。

## 專案結構

```
handover-system/
├── server.js              # 主要伺服器與所有 API
├── db.js                  # SQLite 資料庫初始化
├── generate.js             # 套用範本產生 Word 檔的邏輯
├── config/questions.json   # 表單題目設定（也可透過後台介面編輯）
├── public/                 # 前台表單 + 後台管理頁面（純 HTML/CSS/JS）
│   ├── index.html / app.js       # 前台填表
│   ├── admin.html / admin.js     # 後台管理
│   └── styles.css
├── sample-template/         # 範例 Word 範本（含 {{欄位代碼}}）
├── uploads/templates/       # 使用者上傳的範本檔存放處
└── generated/               # （保留）產生檔案可暫存於此
```

## 新版：完全不懂程式也能修改表單

前台 `/` 不需要帳號密碼，社區經理直接填寫即可。內勤管理後台 `/admin.html` 才需要登入。

### 最常修改的位置：後台「表單設計中心」

登入 `/admin.html` 後，第三個分頁「表單設計中心」就是主要設定區，不需要編輯任何 `.js` 或 `.json` 程式碼。

- **網站基本名稱**：修改前台最上方的大標題與副標題。
- **頁面／母標題管理**：一個頁面就是前台的一頁，例如「社區基本資料」「社區財務狀況」「社區代辦事項」。可新增、刪除、上下移動、修改標題與說明。
- **題目／子標題管理**：可指定題目在哪一頁、修改子標題、修改題目文字、回答格式、是否必填，以及調整順序。
- **欄位代碼**：這是 Word 範本使用的識別碼，例如 `{{community_name}}`。若已有 Word 範本，除非你也會同步修改 Word 裡的代碼，否則不要更改既有欄位代碼。

### 資料保存

表單設定現在會保存到 `/data/form-config.json`，而填答資料仍保存於 `/data/data.sqlite`。因此 Zeabur 的 Volume 請維持掛載 `/data`。
