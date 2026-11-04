# ACES Visionflow 報到系統 - Backend

> **注意：這份後端是依較早的需求（單一管理者登入、單一頁面）寫的，已與 2026-11-02 會議決議不一致，**
> **前端現在改成四個頁面並使用模擬資料，不再呼叫這裡的 API。** 接資料庫時請依會議決議重寫：
> 主表／報到表／簽收表三張表、種子碼與領取碼、不做登入（工號只作記錄）、`ACES_Frontend/README.md` 裡的 API 對照表。
> 目前的 PBKDF2、條件式更新（只能領取一次）等寫法仍可沿用。


FastAPI + SQLAlchemy。預設用 SQLite 方便本機開發，正式環境以 `DATABASE_URL` 切換成 MySQL。
前端（`../ACES_Frontend`）由同一個服務提供，所以前端與 `/api` 同網域，不需要設定 CORS。

## 本機執行（示範模式）

最簡單：在 `ACES_Backend` 資料夾執行 `powershell -ExecutionPolicy Bypass -File .
un_demo.ps1`，會自動建立 venv、安裝套件、寫入示範資料並啟動伺服器。

手動步驟：

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements-dev.txt

$env:ACES_DEMO = "1"
.\.venv\Scripts\python seed.py        # 建立資料表、3 位示範員工、管理者 finance01 / demo1234
.\.venv\Scripts\python -m uvicorn app.main:app --port 8000
```

開啟 http://127.0.0.1:8000 。API 文件（僅示範模式）：http://127.0.0.1:8000/api/docs

> 前端現在要透過後端網址開啟，直接雙擊 index.html 不會有資料。

## 測試

```powershell
.\.venv\Scripts\python -m pytest -q
```

## API

| Method | Path | 驗證 | 說明 |
| --- | --- | --- | --- |
| GET | `/api/checkin/session/{qr_token}` | 無 | 員工資料；已報到則含鎖定紀錄與領款 token |
| POST | `/api/checkin/complete` | 無 | `{qr_token, relatives(0-5)}`；後端算金額、鎖定、產生領款 token；重複呼叫回 409 |
| POST | `/api/admin/login` | 無 | 管理者登入，回傳 8 小時有效的 session token |
| POST | `/api/admin/logout` | 管理者 | 登出並使 token 失效 |
| GET | `/api/claim/{claim_token}` | 管理者 | 領款資料核對 |
| POST | `/api/claim/{claim_token}/complete` | 管理者 | 財務按下完成；同一筆只會成功一次，之後回 409 |
| GET | `/api/dev/employees` | 無 | **僅 `ACES_DEMO=1` 存在**，登入頁示範用 |

## 安全設計

- 金額只在後端計算（員工 500 + 親屬每位 200），前端傳的任何金額都會被忽略。
- 「只能報到一次」由 `checkin_record.emp_id` 唯一約束保證；「只能領款一次」由條件式 `UPDATE ... WHERE claimed_at IS NULL` 保證，並發請求也不會重複。
- 管理者密碼以 PBKDF2-SHA256（含 salt）儲存；session token 在資料庫只存 SHA-256；沒有 token 時領款 API 不回傳任何資料。
- 同一帳號連續登入失敗 5 次鎖定 5 分鐘；帳號不存在時也會做雜湊比對，避免從回應時間猜帳號。
- QR 只放 128 bit 隨機 token，不含姓名 / 工號。

## 上正式環境前

1. `DATABASE_URL=mysql+pymysql://user:password@127.0.0.1:3306/aces?charset=utf8mb4`，安裝 `pymysql`。
2. **不要**設 `ACES_DEMO`（會關閉 `/api/dev/employees` 與 `/api/docs`）；用 `ADMIN_PASSWORD=<強密碼> python seed.py` 建立管理者。
3. 員工資料改由公司人事資料庫匯入 `employee` 表，並為每位員工產生 `qr_token` 寄送 Email。
4. 經 Nginx 提供 HTTPS；MySQL 只允許 VM / Backend 連線。
5. 登入失敗鎖定目前存在記憶體，單一 worker 有效；若用多個 worker / 多台機器，需改放 Redis 或資料庫。
6. 目前的 DB 結構用 `create_all` 建立，正式版建議導入 Alembic 管理遷移。
