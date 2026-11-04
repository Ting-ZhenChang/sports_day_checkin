import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import security
from .db import Base, engine, get_db
from .models import Admin, AdminSession, CheckinRecord, Employee

EMPLOYEE_SUBSIDY = 500
RELATIVE_SUBSIDY = 200
MAX_RELATIVES = 5
SESSION_HOURS = 8

DEMO = os.getenv("ACES_DEMO") == "1"
FRONTEND_DIR = Path(os.getenv("FRONTEND_DIR", Path(__file__).resolve().parents[2] / "ACES_Frontend"))

app = FastAPI(
    title="ACES Visionflow API",
    docs_url="/api/docs" if DEMO else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if DEMO else None,
)
Base.metadata.create_all(engine)

throttle = security.LoginThrottle()


def now() -> datetime:
    return datetime.now().replace(microsecond=0)


def fmt(dt: datetime | None) -> str | None:
    return dt.strftime("%Y-%m-%d %H:%M:%S") if dt else None


def calc_amount(relatives: int) -> int:
    return EMPLOYEE_SUBSIDY + RELATIVE_SUBSIDY * relatives


# ---------- Schemas ----------


class RecordOut(BaseModel):
    relatives: int
    amount: int
    checked_in_at: str
    claim_token: str


class SessionOut(BaseModel):
    emp_id: str
    name: str
    dept: str
    record: RecordOut | None


class CompleteIn(BaseModel):
    qr_token: str = Field(min_length=1, max_length=64)
    relatives: int = Field(ge=0, le=MAX_RELATIVES)


class LoginIn(BaseModel):
    account: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class LoginOut(BaseModel):
    token: str
    account: str
    expires_in: int


class ClaimOut(BaseModel):
    emp_id: str
    name: str
    dept: str
    relatives: int
    amount: int
    checked_in_at: str
    claimed_at: str | None
    claimed_by: str | None


# ---------- Helpers ----------


def record_out(record: CheckinRecord) -> RecordOut:
    return RecordOut(
        relatives=record.relatives,
        amount=record.amount,
        checked_in_at=fmt(record.checked_in_at),
        claim_token=record.claim_token,
    )


def require_admin(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(get_db),
) -> Admin:
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(401, "請先登入管理者帳號")

    session = db.get(AdminSession, security.hash_session_token(token))
    if not session or session.expires_at <= now():
        raise HTTPException(401, "登入已過期，請重新登入")

    admin = db.get(Admin, session.account)
    if not admin:
        raise HTTPException(401, "請先登入管理者帳號")
    return admin


# ---------- 員工報到 ----------


@app.get("/api/checkin/session/{qr_token}", response_model=SessionOut)
def get_checkin_session(qr_token: str, db: Session = Depends(get_db)):
    employee = db.scalar(select(Employee).where(Employee.qr_token == qr_token))
    if not employee:
        raise HTTPException(404, "QR Code 無效")

    record = db.scalar(select(CheckinRecord).where(CheckinRecord.emp_id == employee.emp_id))
    return SessionOut(
        emp_id=employee.emp_id,
        name=employee.name,
        dept=employee.dept,
        record=record_out(record) if record else None,
    )


@app.post("/api/checkin/complete", response_model=RecordOut)
def complete_checkin(body: CompleteIn, db: Session = Depends(get_db)):
    employee = db.scalar(select(Employee).where(Employee.qr_token == body.qr_token))
    if not employee:
        raise HTTPException(404, "QR Code 無效")

    # 金額一律由後端計算，不信任前端傳來的數字。
    record = CheckinRecord(
        emp_id=employee.emp_id,
        relatives=body.relatives,
        amount=calc_amount(body.relatives),
        checked_in_at=now(),
        claim_token=security.new_token(),
    )
    db.add(record)
    try:
        db.commit()
    except IntegrityError:
        # emp_id 唯一約束：已經報到過，資料已鎖定。
        db.rollback()
        raise HTTPException(409, "此員工已完成報到，資料已鎖定")
    return record_out(record)


# ---------- 管理者 ----------


@app.post("/api/admin/login", response_model=LoginOut)
def admin_login(body: LoginIn, db: Session = Depends(get_db)):
    if throttle.is_locked(body.account):
        raise HTTPException(429, "登入失敗次數過多，請稍後再試")

    admin = db.get(Admin, body.account)
    if admin:
        ok = security.verify_password(body.password, admin.password_hash)
    else:
        security.verify_unknown_account(body.password)
        ok = False

    if not ok:
        throttle.record_failure(body.account)
        raise HTTPException(401, "帳號或密碼錯誤")

    throttle.reset(body.account)
    db.execute(delete(AdminSession).where(AdminSession.expires_at <= now()))
    token = security.new_session_token()
    db.add(
        AdminSession(
            token_hash=security.hash_session_token(token),
            account=admin.account,
            expires_at=now() + timedelta(hours=SESSION_HOURS),
        )
    )
    db.commit()
    return LoginOut(token=token, account=admin.account, expires_in=SESSION_HOURS * 3600)


@app.post("/api/admin/logout", status_code=204)
def admin_logout(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(get_db),
    _: Admin = Depends(require_admin),
):
    token = (authorization or "").partition(" ")[2]
    db.execute(delete(AdminSession).where(AdminSession.token_hash == security.hash_session_token(token)))
    db.commit()


# ---------- 財務領款 ----------


def load_claim(db: Session, claim_token: str) -> tuple[CheckinRecord, Employee]:
    row = db.execute(
        select(CheckinRecord, Employee)
        .join(Employee, Employee.emp_id == CheckinRecord.emp_id)
        .where(CheckinRecord.claim_token == claim_token)
    ).first()
    if not row:
        raise HTTPException(404, "領款 QR Code 無效")
    return row[0], row[1]


def claim_out(record: CheckinRecord, employee: Employee) -> ClaimOut:
    return ClaimOut(
        emp_id=employee.emp_id,
        name=employee.name,
        dept=employee.dept,
        relatives=record.relatives,
        amount=record.amount,
        checked_in_at=fmt(record.checked_in_at),
        claimed_at=fmt(record.claimed_at),
        claimed_by=record.claimed_by,
    )


@app.get("/api/claim/{claim_token}", response_model=ClaimOut)
def get_claim(claim_token: str, db: Session = Depends(get_db), _: Admin = Depends(require_admin)):
    record, employee = load_claim(db, claim_token)
    return claim_out(record, employee)


@app.post("/api/claim/{claim_token}/complete", response_model=ClaimOut)
def complete_claim(claim_token: str, db: Session = Depends(get_db), admin: Admin = Depends(require_admin)):
    # 條件式 UPDATE：只有 claimed_at 仍為空的那一次會成功，並發下也不會重複發放。
    result = db.execute(
        update(CheckinRecord)
        .where(CheckinRecord.claim_token == claim_token, CheckinRecord.claimed_at.is_(None))
        .values(claimed_at=now(), claimed_by=admin.account)
    )
    db.commit()

    record, employee = load_claim(db, claim_token)
    if result.rowcount == 0:
        raise HTTPException(409, "此筆補助款已領取，不可重複領取")
    return claim_out(record, employee)


# ---------- Demo 專用 ----------

if DEMO:

    @app.get("/api/dev/employees")
    def dev_employees(db: Session = Depends(get_db)):
        """僅 ACES_DEMO=1 時存在：讓登入頁示範不同員工的 QR。正式環境不會註冊此路由。"""
        rows = db.scalars(select(Employee).order_by(Employee.emp_id)).all()
        return [{"emp_id": e.emp_id, "name": e.name, "qr_token": e.qr_token} for e in rows]


# 前端靜態檔放最後，避免蓋掉 /api。
if FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
