# SOP V13
基於目前上傳專案修正 SOP。
- company.html 預載 SOP 模組，避免動態載入競態。
- company.js loader 可處理已存在腳本。
- internal / hybrid 公司內勤可管理及代上傳 SOP。
- 不修改班表相關程式。

## 出勤／巡邏 V2
- 公司後台：出勤打卡點、巡邏點、QR Code 列印、出勤／巡邏紀錄。
- 現場人員：GPS 出勤打卡、QR 巡邏打卡、離線暫存與恢復網路同步。
- 地下室巡邏不依賴 GPS；QR token 由伺服器驗證公司／社區／巡邏點。
- 平台母規則新增出勤／巡邏設定，並保留原有班表與其他目錄。
- 不包含正式資料庫檔案與 .env 機密資料。

## 出勤／巡邏 V2.1：批次 QR 與 Google 地圖選點

- 公司後台巡邏點可多選，批次產生 A4 列印版；每張標籤約 5cm × 7cm，一頁 12 張。
- 新增 Google 地圖地點搜尋：公司管理員輸入社區、地址或地點名稱後，可選擇搜尋結果，自動帶入地址與經緯度。
- 若要啟用 Google 地圖搜尋，請在 Zeabur Environment Variables 新增 `GOOGLE_MAPS_API_KEY`。API Key 請勿寫入 GitHub。
- 未設定 API Key 時，既有「使用目前位置取得 GPS」功能仍可使用；巡邏 QR Code 不受影響。
- 既有 attendance_locations 資料會以相容性 migration 補上 `address` 與 `place_id` 欄位，不會刪除原有地點或紀錄。
