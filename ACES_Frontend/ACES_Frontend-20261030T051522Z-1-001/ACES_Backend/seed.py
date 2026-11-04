"""建立資料表並寫入員工與管理者帳號。

用法：
  ACES_DEMO=1 python seed.py                      # 示範資料，管理者密碼 demo1234
  ADMIN_PASSWORD=xxxx python seed.py              # 只建立管理者帳號（正式環境，員工資料請另行匯入）

正式環境的員工資料來自公司資料庫；這裡的示範員工只在 ACES_DEMO=1 時寫入。
"""
import os
import secrets
import sys

from app import security
from app.db import Base, SessionLocal, engine
from app.models import Admin, Employee

DEMO_EMPLOYEES = [
    ("A10001", "王小明", "數位轉型部 DTD"),
    ("A10002", "林小花", "財務部"),
    ("A10003", "陳小華", "人力資源部"),
]


def main() -> None:
    demo = os.getenv("ACES_DEMO") == "1"
    account = os.getenv("ADMIN_ACCOUNT", "finance01")
    password = os.getenv("ADMIN_PASSWORD") or ("demo1234" if demo else None)
    if not password:
        sys.exit("請設定 ADMIN_PASSWORD 環境變數（或使用 ACES_DEMO=1 建立示範資料）。")

    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        if not db.get(Admin, account):
            db.add(Admin(account=account, password_hash=security.hash_password(password)))
            print(f"已建立管理者帳號：{account}")

        if demo:
            for emp_id, name, dept in DEMO_EMPLOYEES:
                if not db.get(Employee, emp_id):
                    db.add(Employee(emp_id=emp_id, name=name, dept=dept, qr_token=secrets.token_hex(16)))
                    print(f"已建立示範員工：{emp_id} {name}")
        db.commit()


if __name__ == "__main__":
    main()
