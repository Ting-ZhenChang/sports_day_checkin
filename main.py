from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
import secrets
import sqlite3
import string

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, StrictInt

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "demo.sqlite3"


def now():
    return datetime.now(
        timezone(timedelta(hours=8))
    ).strftime("%Y-%m-%d %H:%M:%S")


def token():
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(16))


@contextmanager
def database(write=False):
    db = sqlite3.connect(DB_PATH, timeout=30, isolation_level=None)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")

    try:
        db.execute("BEGIN IMMEDIATE" if write else "BEGIN")
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# 首次啟動建立資料表及假資料；再次啟動會保留操作紀錄。
def initialize():
    with database(True) as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS employees (
                emp_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                unit TEXT NOT NULL,
                team TEXT NOT NULL,
                email TEXT NOT NULL,
                seed_code TEXT NOT NULL UNIQUE,
                declared_relatives INTEGER NOT NULL 
                    CHECK(declared_relatives BETWEEN 0 AND 5),
                walk_in INTEGER NOT NULL DEFAULT 0,
                checked_in INTEGER NOT NULL DEFAULT 0,
                relatives INTEGER,
                operator_id TEXT,
                checked_in_at TEXT
            )
        """)

        db.execute("""
            CREATE TABLE IF NOT EXISTS receipts (
                emp_id TEXT PRIMARY KEY REFERENCES employees(emp_id),
                claim_code TEXT NOT NULL UNIQUE,
                claim_created_at TEXT NOT NULL,
                amount_snapshot INTEGER NOT NULL,
                claimed INTEGER NOT NULL DEFAULT 0,
                signer_id TEXT,
                signed_at TEXT
            )
        """)

        db.execute("""
            CREATE TABLE IF NOT EXISTS logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                emp_id TEXT NOT NULL REFERENCES employees(emp_id),
                action TEXT NOT NULL,
                operator_id TEXT NOT NULL,
                relatives INTEGER NOT NULL,
                reason TEXT,
                created_at TEXT NOT NULL
            )
        """)

        count = db.execute(
            "SELECT COUNT(*) FROM employees"
        ).fetchone()[0]

        if count == 0:
            db.executemany("""
                INSERT INTO employees
                (emp_id, name, unit, team, email,
                 seed_code, declared_relatives)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, [
                (
                    f"T{i:05d}",
                    f"測試員工{i:04d}",
                    f"測試部門{(i - 1) % 8 + 1}",
                    f"測試隊伍{(i - 1) % 4 + 1}",
                    f"test{i:04d}@example.invalid",
                    token(),
                    (i - 1) % 6,
                )
                for i in range(1, 501)
            ])


def fail(code, status=409, **extra):
    raise HTTPException(
        status_code=status,
        detail={"code": code, **extra},
    )


def employee_id(value, allow_hr=False):
    import re

    value = value.strip().upper()

    if allow_hr and value == "HR":
        return value

    if not re.fullmatch(r"(?:T|EE|111)\d{5}", value):
        fail(
            "INVALID_OPERATOR" if allow_hr else "INVALID_EMP_ID",
            422,
        )

    return value


def by_seed(db, seed):
    person = db.execute(
        "SELECT * FROM employees WHERE seed_code=?",
        (seed,),
    ).fetchone()

    if not person:
        fail("NOT_FOUND", 404)

    return person


# 統一回傳前端需要的員工、報到及簽收狀態。
def record(db, emp_id):
    person = db.execute(
        "SELECT * FROM employees WHERE emp_id=?",
        (emp_id,),
    ).fetchone()

    if not person:
        fail("NOT_FOUND", 404)

    result = dict(person)
    result["walk_in"] = bool(result["walk_in"])
    result["amount"] = (
        500 + 200 * result["relatives"]
        if result["checked_in"]
        else None
    )

    receipt = db.execute(
        "SELECT * FROM receipts WHERE emp_id=?",
        (emp_id,),
    ).fetchone()

    result.update(
        claim_code=receipt["claim_code"] if receipt else None,
        claim_created_at=(
            receipt["claim_created_at"] if receipt else None
        ),
        claimed=receipt["claimed"] if receipt else 0,
        signer_id=receipt["signer_id"] if receipt else None,
        signed_at=receipt["signed_at"] if receipt else None,
    )

    return result


def audit(db, emp_id, action, operator, relatives, reason=None):
    db.execute("""
        INSERT INTO logs
        (emp_id, action, operator_id, relatives, reason, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (emp_id, action, operator, relatives, reason, now()))


# API 輸入驗證；人數必須是整數，範圍 0～5。
class Input(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
    )


class CheckIn(Input):
    seed: str = Field(min_length=1, max_length=100)
    operatorId: str = Field(min_length=1, max_length=30)
    relatives: StrictInt = Field(ge=0, le=5)


class Claim(Input):
    seed: str = Field(min_length=1, max_length=100)
    expectedRelatives: StrictInt | None = Field(
        default=None, ge=0, le=5
    )


class Sign(Input):
    claimCode: str = Field(min_length=1, max_length=100)
    signerId: str = Field(min_length=1, max_length=30)


class Edit(Input):
    relatives: StrictInt = Field(ge=0, le=5)
    operatorId: str = Field(
        default="HR", min_length=1, max_length=30
    )
    reason: str = Field(
        default="HR 修改人數", min_length=1, max_length=255
    )


class WalkIn(Input):
    empId: str = Field(min_length=1, max_length=30)
    name: str = Field(min_length=1, max_length=100)
    unit: str = Field(min_length=1, max_length=100)
    team: str = Field(default="-", max_length=50)
    relatives: StrictInt = Field(ge=0, le=5)
    operatorId: str = Field(
        default="HR", min_length=1, max_length=30
    )


@asynccontextmanager
async def lifespan(app):
    initialize()
    yield


app = FastAPI(
    title="運動會 API：虛擬資料測試版",
    lifespan=lifespan,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)


@app.exception_handler(HTTPException)
async def business_error(request, exc):
    body = (
        exc.detail
        if isinstance(exc.detail, dict)
        else {"code": "REQUEST_ERROR"}
    )
    return JSONResponse(body, status_code=exc.status_code)


@app.middleware("http")
async def disable_cache(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/health")
def health():
    with database() as db:
        count = db.execute(
            "SELECT COUNT(*) FROM employees"
        ).fetchone()[0]

    return {
        "status": "ok",
        "employees": count,
        "max_relatives": 5,
    }


@app.get("/api/records")
def records():
    with database() as db:
        people = db.execute(
            "SELECT emp_id FROM employees ORDER BY emp_id"
        ).fetchall()
        return [record(db, person[0]) for person in people]


@app.get("/api/employee/by-seed/{seed}")
def lookup(seed: str):
    with database() as db:
        return record(db, by_seed(db, seed)["emp_id"])


def complete_checkin(
    db, emp_id, relatives, operator, manual=False
):
    person = record(db, emp_id)

    if person["checked_in"]:
        fail("ALREADY_CHECKED_IN")

    if not manual and relatives > person["declared_relatives"]:
        fail("INVALID_RELATIVES", 422)

    operator = employee_id(operator, allow_hr=True)

    db.execute("""
        UPDATE employees
        SET checked_in=1, relatives=?,
            operator_id=?, checked_in_at=?
        WHERE emp_id=?
    """, (relatives, operator, now(), emp_id))

    audit(
        db, emp_id,
        "MANUAL" if manual else "CHECKIN",
        operator, relatives,
    )

    return record(db, emp_id)


@app.post("/api/checkin")
def checkin(body: CheckIn):
    with database(True) as db:
        return complete_checkin(
            db,
            by_seed(db, body.seed)["emp_id"],
            body.relatives,
            body.operatorId,
        )


@app.post("/api/claim")
def claim(body: Claim):
    with database(True) as db:
        person = record(db, by_seed(db, body.seed)["emp_id"])

        if not person["checked_in"]:
            fail("NOT_CHECKED_IN")

        if person["claimed"]:
            fail("ALREADY_CLAIMED")

        if (
            body.expectedRelatives is not None
            and person["relatives"] != body.expectedRelatives
        ):
            fail("DATA_CHANGED")

        if not person["claim_code"]:
            db.execute("""
                INSERT INTO receipts
                (emp_id, claim_code, claim_created_at, amount_snapshot)
                VALUES (?, ?, ?, ?)
            """, (
                person["emp_id"],
                token(),
                now(),
                person["amount"],
            ))

        return record(db, person["emp_id"])


@app.post("/api/receipt/sign")
def sign(body: Sign):
    with database(True) as db:
        signer = employee_id(body.signerId, allow_hr=True)

        receipt = db.execute(
            "SELECT * FROM receipts WHERE claim_code=?",
            (body.claimCode,),
        ).fetchone()

        if not receipt:
            fail("NOT_FOUND", 404)

        if receipt["claimed"]:
            fail(
                "ALREADY_CLAIMED",
                row=record(db, receipt["emp_id"]),
            )

        db.execute("""
            UPDATE receipts
            SET claimed=1, signer_id=?, signed_at=?
            WHERE emp_id=?
        """, (signer, now(), receipt["emp_id"]))

        return record(db, receipt["emp_id"])


@app.put("/api/checkin/{emp_id}/relatives")
def edit(emp_id: str, body: Edit):
    with database(True) as db:
        person = record(db, emp_id)

        if not person["checked_in"]:
            fail("NOT_CHECKED_IN")

        if person["claimed"]:
            fail("ALREADY_CLAIMED")

        operator = employee_id(body.operatorId, allow_hr=True)

        db.execute(
            "UPDATE employees SET relatives=? WHERE emp_id=?",
            (body.relatives, emp_id),
        )

        # 人數更正後撤銷舊領取碼，員工必須重新確認。
        db.execute(
            "DELETE FROM receipts WHERE emp_id=?",
            (emp_id,),
        )

        audit(
            db, emp_id, "UPDATE",
            operator, body.relatives, body.reason,
        )

        return record(db, emp_id)


@app.post("/api/walk-in")
def walk_in(body: WalkIn):
    with database(True) as db:
        emp_id = employee_id(body.empId)

        matches = db.execute(
            "SELECT emp_id FROM employees WHERE substr(emp_id,-5)=?",
            (emp_id[-5:],),
        ).fetchall()

        if len(matches) > 1:
            fail("DUPLICATE_EMPLOYEE_ID")

        if matches:
            emp_id = matches[0][0]
        else:
            emp_id = "T" + emp_id[-5:]

            db.execute("""
                INSERT INTO employees
                (emp_id, name, unit, team, email,
                 seed_code, declared_relatives, walk_in)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1)
            """, (
                emp_id,
                body.name,
                body.unit,
                body.team or "-",
                "",
                token(),
                body.relatives,
            ))

        return complete_checkin(
            db, emp_id, body.relatives,
            body.operatorId, manual=True,
        )


# 若放入現有前端，就由同一個服務提供頁面。
if (ROOT / "frontend" / "index.html").is_file():
    app.mount(
        "/",
        StaticFiles(directory=ROOT / "frontend", html=True),
        name="frontend",
    )