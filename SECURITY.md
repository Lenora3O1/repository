# 資安設定與還原說明

## 主機環境變數（Render／Zeabur）

| 變數 | 用途 | 注意 |
|---|---|---|
| `ADMIN_PASS` | 系統總後台密碼 | 至少 10 個字元；正式主機上若是預設值會拒絕登入 |
| `SESSION_SECRET` | 登入憑證簽章金鑰 | 32 個字元以上亂碼；更換後所有人需重新登入 |
| `DATA_ENCRYPTION_KEY` | 個資欄位加密、備份加密 | **32 個字元以上亂碼。開始使用後不可更換；遺失＝加密的個資與備份都無法還原，請手抄保管** |
| `BACKUP_S3_ENDPOINT` `BACKUP_S3_BUCKET` `BACKUP_S3_ACCESS_KEY` `BACKUP_S3_SECRET_KEY` | 異地備份的儲存空間（S3 相容，例如 Cloudflare R2、Backblaze B2） | 金鑰只給「寫入／列出／刪除這個儲存桶」的權限 |
| `BACKUP_S3_REGION` | 預設 `auto`（R2）；AWS 填實際區域 | 選填 |
| `BACKUP_S3_PREFIX` | 預設 `hesi-backups/` | 選填 |
| `BACKUP_HOUR` | 每天幾點備份（台灣時間），預設 3 | 選填 |
| `BACKUP_KEEP_DAYS` | 異地備份保留天數，預設 30 | 選填 |
| `VIRUSTOTAL_API_KEY` | 上傳檔案另外比對 VirusTotal 病毒資料庫（只送檔案指紋） | 選填；免費版每分鐘 4 次 |
| `ADMIN_2FA_RESET` | 設為 `1` 並重新部署：清除總後台兩步驟驗證（手機與備用碼都遺失時） | 用完務必刪除 |
| `SECURITY_MODE` | 填 `production`：強制所有正式主機的資安規則（Render、Zeabur 會自動偵測，其他主機請設定） | 選填 |
| `REQUIRE_2FA` | 測試環境強制兩步驟驗證（正式主機一律強制） | 選填 |

設定狀態可在「系統總後台 → 🛡️ 資安狀態」查看。

## 帳號保護
- 現場／內勤帳號密碼連續錯 5 次即上鎖：一般人員由公司主管（人員管理權限）解鎖或重設密碼；公司負責人由系統總後台「重設負責人密碼」（產生臨時密碼並解鎖，登入後必須自行修改）。
- 同一 IP 15 分鐘內登入失敗 30 次，整個 IP 暫停 15 分鐘。
- 密碼規則：至少 8 碼、英文與數字都要有、不能包含帳號或手機、不能是常見密碼；舊的簡單密碼在下次登入時要求更換。
- 兩步驟驗證（TOTP）：系統總後台、公司管理員、負責人／總經理、有會計權限者登入內勤後台時需要。
- 內勤後台與總後台閒置 30 分鐘自動登出。

## 還原備份
```
DATA_ENCRYPTION_KEY=（原本的金鑰） node scripts/restore-backup.js hesi-YYYYMMDD-HHMM.tar.gz.enc ./restored
```
把 `restored` 資料夾的內容放回主機的 `/data`（先停止服務），再用同一組 `DATA_ENCRYPTION_KEY` 啟動。
