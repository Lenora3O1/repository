# 現場班表入口與自選休假修正 V2.2

## 本次修改
- `server.js`
  - 修正 `resolveMenu()` 班表權限判斷：對具有有效案場派駐、且班表身分為行政／保全／機動的人員，使用 `schedule_profiles.schedule_role` 優先判斷；不再因舊帳號權限快照缺少 `schedule` 或主檔職務與班表身分不同步而隱藏班表目錄。
  - 自選休假的檢查與寫入包在同一個 SQLite 交易中，避免檢查與寫入分離造成競態。
  - 保留公司／案場資料隔離與既有排班規則。
- `public/staff.html`
  - 更新 `sidebar.js`、`app.js` 的版本查詢字串，避免瀏覽器繼續載入舊版工作目錄程式。
- `public/company.html`
  - 更新 `sidebar.js`、`company.js` 的版本查詢字串，避免公司後台載入舊版選單／班表介面。

## 本次檢查
- `node --check server.js`：通過。
- `node --check public/app.js`：通過。
- `node --check public/sidebar.js`：通過。
- `node --check public/company.js`：通過。
- ZIP 完整性與內容檢查：需以交付的 ZIP 再驗證。

## 尚未驗證
- 尚未連線 Zeabur 正式執行環境或正式 SQLite 資料庫。
- 尚未以王小明帳號驗收線上選單、班表 API、案場班表資料。
- 尚未執行實際資料庫整合測試；部署前請保留原版本與正式資料庫備份。

## V2.3：班表身分相容與選單快取

- `server.js`：`scheduleGetProfile()` 僅接受 `admin`、`security`、`mobile` 三種標準班表角色；若資料庫既有資料為非標準值，改依人員主檔職務推算有效角色，避免非空舊值阻止回退。此結果供班表選單與經理班表 API 共用。
- `server.js`：班表選單 API 回傳 `Cache-Control: no-store`，避免帳號/權限相關的選單回應被快取。
- `public/sidebar.js`：選單與釘選資料請求使用 `cache: no-store`。
- `public/staff.html`：更新 `sidebar.js`、`app.js` 版本標記，強制瀏覽器重新取得前端程式。
- 已執行 Node.js 語法檢查及 ZIP 完整性檢查。尚未連線正式 Zeabur 資料庫，故王小明帳號的實際 `schedule_role` 與線上顯示仍須部署後驗收；不宣稱已線上修復。


## V2.4：修正正式入口頁的前端版本與工作空間判斷
- 根網址 `/` 由 Express 靜態檔案服務載入 `public/index.html`，不是 `public/staff.html`。先前只更新 staff.html 的版本參數，無法讓根網址使用者取得新的前端程式。
- 更新 `public/index.html` 的 CSS、sidebar.js、app.js、messages.js 版本參數；同步更新 `public/staff.html` 與 `public/company.html` 的版本參數。
- `public/sidebar.js` 改用頁面 DOM 結構判斷 staff/company 工作空間，並支援直接開啟 `/staff.html`；選單請求失敗時會在 Console 留下狀態碼。
- 這修正了可由程式碼直接證實的入口／快取缺口；仍需部署後驗證正式環境回傳的選單及帳號資料，不能僅憑靜態檢查宣稱線上已修復。


## V2.6：平台預設目錄真正繼承（staff/company）

- `server.js`：停止啟動時替所有企業自動建立平台目錄快照。沒有企業 override 的工作空間會直接使用最新平台預設；儲存企業客製時才建立 override。
- `server.js`：舊版企業目錄若與目前平台目錄完全相同，遷移為繼承模式；有差異的既有客製目錄保留，避免覆蓋企業自訂內容。
- `server.js`：建立新公司時不再複製平台目錄快照；「恢復平台預設」改為移除該 scope 的 override，讓後續平台更新能同步。
- `public/admin.js`：只更新目錄客製設定的說明與「恢復平台預設」確認文字；沒有修改總後台版面、`public/admin.js` 以外的總後台功能或樣式。
- `public/admin.html`：只更新目錄設定程式 `admin.js` 的版本標記；沒有修改總後台選單結構、版面或樣式。
- 未打包正式資料庫；語法與 ZIP 完整性需在打包後再驗證。
