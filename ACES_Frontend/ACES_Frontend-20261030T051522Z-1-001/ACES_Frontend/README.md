# ACES Visionflow 運動會報到與簽收系統 - Frontend

依 2026-11-02 會議紀錄實作的前端。目前資料是模擬的（存在瀏覽器 localStorage），**後端完成後只需換掉一個檔案**（見下方）。

## 四個頁面

| 頁面 | 檔案 | 使用者 | 功能 |
| --- | --- | --- | --- |
| 報到頁 | `checkin.html` | 報到工作人員 | 輸入自己的工號（只記錄、不驗證）→ 掃員工 QR code → 顯示「員工 1 人、眷屬 N 人」→ ＋／－ 調整（0 ~ 表單填寫數，不可手打）→ 確認 → 「報到成功」 |
| HR 查詢看板 | `hr.html` | HR | 應報到／實際報到／未報到／已領取；依小隊、部門、工號、姓名查詢；補登記；修改人數（最高修改權） |
| 員工領取頁 | `claim.html?c=<種子碼>` | 員工（含外籍同仁，中英雙語） | 信件連結進入 → 未報到擋下 → 顯示工號、姓名、報到時間、人數、金額 → 勾選確認 → 再跳一次「請確認金額與人數」→ 產生領取碼 |
| HR 簽收掃碼頁 | `sign.html` | HR | 輸入自己的工號 → 掃員工領取碼 → 寫入簽收人與時間，掃完才算交易完成；之後員工頁顯示「領取成功」，再進入顯示「已領取」 |

`index.html` 是開發用導覽頁（四個頁面入口、示範員工的 QR code 與領取連結、重設示範資料），正式上線不對外開放。

不做登入系統，權限靠「連結發給誰」控制。

## 如何執行

```powershell
cd ACES_Frontend
python -m http.server 8080
```

開啟 http://localhost:8080 。手機相機掃碼需要 **HTTPS 或 localhost**，無法開相機時，報到頁與簽收頁都有「手動輸入代碼」。

目前資料只在同一個瀏覽器內共用，不同裝置之間不會同步（要等真後端）。可以在同一台電腦開四個分頁，用導覽頁的 QR 或手動輸入代碼測完整流程。

## 規則設定

規則集中在 [js/config.js](js/config.js)，標示「待 HR 確認」的項目請依 HR 決定調整：

- 金額：員工 500、眷屬每人 200、眷屬上限 5 人（每人最多 1,500）
- `ALLOW_EXCEED_DECLARED`：報到眷屬可否超過表單填寫數（目前不可）
- `ALLOW_WALKIN_REGISTER`：HR 看板是否開放補登記（目前開放）
- `EMP_ID_PATTERN`：工號格式。**會議紀錄內文寫 T 與 111，決議事項寫 T 與 EE，兩者不一致，目前三種都接受**，請與 HR 確認後修正
- 同一人以工號後 5 碼數字判斷

## 資料表（對應會議決議的三張表）

`js/mock-api.js` 的資料結構即後端要建立的表：

- **主表 employee**：工號（主鍵）、姓名、單位、小隊、眷屬填寫數、Email、種子碼。金額不重複存放，隨報到人數即時重算。
- **報到表 checkin**：工號、報到負責人工號、報到時間、報到人數、是否報到（0/1，預設 0）。
- **簽收表 receipt**：工號、領取碼、簽收人工號、簽收時間、是否領取（0/1）。

種子碼與領取碼都是 16 碼英文大小寫加數字、不含特殊符號；QR code 只放這串字串，不含工號等個資，也不串 URL 或 API。

## 接上後端時

頁面只透過全域物件 `api` 存取資料（`js/mock-api.js`）。後端完成後新增一份同樣函式簽章的 `js/rest-api.js`（用 `fetch` 呼叫 API），把各 HTML 裡的 `mock-api.js` 換成它即可，頁面程式不用改。失敗時請丟出帶 `code` 的 `ApiError`（代碼見 `js/ui.js` 的 `ERROR_TEXT`）。

| `api` 函式 | 建議的後端 API | 說明 |
| --- | --- | --- |
| `lookupBySeed(seed)` | `GET /api/employee/by-seed/{seed}` | 回傳員工資料與報到、簽收狀態 |
| `checkIn({seed, operatorId, relatives})` | `POST /api/checkin` | 驗證人數 0 ~ 填寫數；已報到回 `ALREADY_CHECKED_IN` |
| `confirmClaim(seed)` | `POST /api/claim` | 需已報到（`NOT_CHECKED_IN`）；產生領取碼寫入簽收表；重複呼叫回同一組 |
| `signReceipt({claimCode, signerId})` | `POST /api/receipt/sign` | 條件式更新，同一筆只會成功一次（`ALREADY_CLAIMED`） |
| `listRecords()` | `GET /api/records` | HR 看板（定期輪詢） |
| `updateRelatives({empId, relatives})` | `PUT /api/checkin/{empId}/relatives` | 已簽收者不可改（`ALREADY_CLAIMED`） |
| `registerWalkIn({...})` | `POST /api/walk-in` | 補登記；工號（後 5 碼）已存在則直接補報到 |

重要卡控請務必在後端做（前端只是輔助）：人數範圍、已報到不可重複、未報到不可領、只能簽收一次、金額由後端計算。

## 資安重點

QR code 只放隨機種子碼；領取頁連結自帶種子碼，員工不用登入或輸入工號，也避免只知道工號就能看到別人的頁面。MySQL 不應直接暴露給瀏覽器，前端只呼叫後端 API。

## 檔案結構

```
index.html        開發用導覽頁
checkin.html      報到頁
hr.html           HR 查詢看板
claim.html        員工領取頁
sign.html         HR 簽收掃碼頁
styles.css
js/
  config.js       規則設定
  mock-api.js     模擬後端（日後換成 rest-api.js）
  ui.js           共用小工具（提示、確認視窗、QR 顯示、人數選擇器）
  scanner.js      相機掃碼
  checkin.js / hr.js / claim.js / sign.js / index.js   各頁邏輯
  vendor/         qrcode.js（產生 QR）、jsQR.js（解碼 QR），皆為 MIT 授權
```
