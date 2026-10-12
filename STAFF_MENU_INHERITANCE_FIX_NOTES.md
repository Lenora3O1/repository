# 現場工作目錄繼承修正（V2.7）

## 目標
修正平台預設目錄到公司目錄，再到現場人員工作台的讀取鏈；不改總後台頁面或樣式。

## 修改檔案
- `server.js`
  - 公司目錄沒有企業 override 時，使用最新平台預設目錄。
  - 建立新公司時不建立固定目錄快照。
  - 恢復平台預設 API 改為移除指定工作空間的企業 override。
  - 既有 override 若與平台目前目錄完全相同，啟動遷移時轉成繼承；若不同則保留，避免誤刪真實客製設定。
  - 修正無效舊班表角色回退判斷及自選休假交易保護（沿用先前已存在的變更）。
- `public/sidebar.js`
  - 現場與公司工作台目錄請求使用 `cache: 'no-store'`。
  - 限制動態側欄載入只適用於 staff/company 頁面，避免誤判總後台。
- `public/index.html`, `public/staff.html`, `public/company.html`
  - 更新現場／公司工作台前端快取版本標記。

## 明確未修改
- `public/admin.html`
- `public/admin.js`
- `public/styles.css`
- 正式資料庫與任何 SQLite 檔案

## 重要限制
舊版本的公司目錄快照如果與目前平台預設不同，程式無法僅靠現有資料可靠分辨「舊版恢復預設所複製的快照」與「真正的企業客製內容」。為避免破壞客製目錄，這種情況會保留 override。部署後，請在總後台對「系統測試公司」的「社區駐點」工作目錄執行一次「恢復平台預設」；新的 API 會刪除 override，之後就持續繼承平台預設。此操作只影響所選公司的所選工作空間目錄，不會刪除業務資料。

## 已執行檢查
- Node.js 語法檢查：server.js、public/sidebar.js、public/app.js、public/company.js、public/admin.js（均通過）。
- ZIP 完整性測試：通過。
- 核對 `public/admin.html`、`public/admin.js`、`public/styles.css` 與原始上傳專案一致。
- 檢查 ZIP 不含 SQLite 資料庫檔案。

## 尚未完成
未連線正式 Zeabur 執行環境，未讀取正式 menu-config.json，也未做線上登入驗收；不能宣稱線上已修復。
