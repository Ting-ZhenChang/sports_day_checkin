from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class Employee(Base):
    __tablename__ = "employee"

    emp_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(64))
    dept: Mapped[str] = mapped_column(String(64))
    # 報到 QR 內容，只放這個不可預測的 token，不放姓名 / 工號。
    qr_token: Mapped[str] = mapped_column(String(64), unique=True)


class CheckinRecord(Base):
    __tablename__ = "checkin_record"
    __table_args__ = (CheckConstraint("relatives BETWEEN 0 AND 5", name="ck_relatives_range"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    # unique：每位員工只能有一筆報到紀錄，鎖定由資料庫保證。
    emp_id: Mapped[str] = mapped_column(ForeignKey("employee.emp_id"), unique=True)
    relatives: Mapped[int] = mapped_column(Integer)
    amount: Mapped[int] = mapped_column(Integer)
    checked_in_at: Mapped[datetime] = mapped_column(DateTime)
    # 領款 QR 內容。
    claim_token: Mapped[str] = mapped_column(String(64), unique=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    claimed_by: Mapped[str | None] = mapped_column(String(64), nullable=True)


class Admin(Base):
    __tablename__ = "admin"

    account: Mapped[str] = mapped_column(String(64), primary_key=True)
    password_hash: Mapped[str] = mapped_column(String(255))


class AdminSession(Base):
    __tablename__ = "admin_session"

    # 只存 token 的 SHA-256，資料庫外洩也無法直接拿來登入。
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    account: Mapped[str] = mapped_column(ForeignKey("admin.account"))
    expires_at: Mapped[datetime] = mapped_column(DateTime)
