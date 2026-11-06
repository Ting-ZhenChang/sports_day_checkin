## SQL Server 報到邏輯
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import os
import re
import secrets
import string


class StoreError(Exception):
    def __init__(self, code, status=409, **extra):
        self.code, self.status, self.extra = code, status, extra


def now():
    return datetime.now(
        timezone(timedelta(hours=8))
    ).replace(tzinfo=None, microsecond=0)


def token():
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(16))


def employee_id(value, operator=False):
    value = value.strip().upper()
    if operator and value == "HR":
        return value
    if not re.fullmatch(r"(?:T|EE|111)\d{5}", value):
        raise StoreError(
            "INVALID_OPERATOR" if operator else "INVALID_EMP_ID", 422
        )
    return value


def connection_string():
    required = [
        name for name in ("SQL_SERVER", "SQL_DATABASE")
        if not os.getenv(name)
    ]
    auth = os.getenv("SQL_AUTH", "windows").lower()

    if auth not in ("windows", "sql"):
        raise StoreError("INVALID_SQL_AUTH", 503)

    if auth == "sql":
        required += [
            name for name in ("SQL_USER", "SQL_PASSWORD")
            if not os.getenv(name)
        ]

    if required:
        raise StoreError(
            "SQL_CONFIGURATION_MISSING",
            503,
            missing_variables=required,
        )

    def quote(value):
        return "{" + value.replace("}", "}}") + "}"

    parts = [
        "DRIVER=" + quote(
            os.getenv("SQL_DRIVER", "ODBC Driver 18 for SQL Server")
        ),
        "SERVER=" + quote(os.environ["SQL_SERVER"]),
        "DATABASE=" + quote(os.environ["SQL_DATABASE"]),
        "Encrypt=yes",
        "TrustServerCertificate=yes", ## 內網測試用
        "APP=SportsDayAPI",
    ]

    if auth == "windows":
        parts.append("Trusted_Connection=yes")
    else:
        parts += [
            "UID=" + quote(os.environ["SQL_USER"]),
            "PWD=" + quote(os.environ["SQL_PASSWORD"]),
        ]

    return ";".join(parts)


@contextmanager
def database():
    config = connection_string()

    try:
        import pyodbc
    except ImportError:
        raise StoreError("PYODBC_NOT_INSTALLED", 503) from None

    driver = os.getenv("SQL_DRIVER", "ODBC Driver 18 for SQL Server")
    if driver not in pyodbc.drivers():
        raise StoreError("SQL_ODBC_DRIVER_MISSING", 503)

    connection = None
    try:
        connection = pyodbc.connect(
            config, timeout=5, autocommit=False
        )
        connection.timeout = 15
        cursor = connection.cursor()
        cursor.execute("SET XACT_ABORT ON")
        yield cursor
        connection.commit()

    except pyodbc.Error as exc:
        if connection:
            try:
                connection.rollback()
            except pyodbc.Error:
                pass

        state = str(exc.args[0]) if exc.args else ""
        code, status = {
            "28000": ("SQL_LOGIN_FAILED", 503),
            "42S02": ("SQL_SCHEMA_NOT_READY", 503),
            "42S22": ("SQL_SCHEMA_NOT_READY", 503),
            "23000": ("DATA_CONFLICT", 409),
            "40001": ("RETRY_TRANSACTION", 409),
        }.get(state, ("SQL_CONNECTION_OR_QUERY_FAILED", 503))

        diagnostic = " ".join(
            str(part) for part in exc.args[1:]
        ).lower()

        if re.search(
            r"certificate|certification path|ssl provider|tls handshake"
            r"|hostname.*mismatch|憑證|證書",
            diagnostic,
        ):
            code, status = "SQL_TLS_CERTIFICATE_ERROR", 503

        extra = (
            {"sqlstate": state}
            if re.fullmatch(r"[A-Z0-9]{5}", state)
            else {}
        )
        raise StoreError(code, status, **extra) from None

    except Exception:
        if connection:
            try:
                connection.rollback()
            except pyodbc.Error:
                pass
        raise

    finally:
        if connection:
            try:
                connection.close()
            except pyodbc.Error:
                pass


def query(cursor, sql, *params):
    cursor.execute(sql, params)
    names = [column[0] for column in cursor.description]
    return [
        dict(zip(names, values))
        for values in cursor.fetchall()
    ]


def person(cursor, *, seed=None, emp_id=None, lock=False):
    hint = " WITH (UPDLOCK,HOLDLOCK)" if lock else ""
    if seed is not None:
        where = "seed_code COLLATE Latin1_General_100_BIN2=?"
        value = seed
    else:
        where = "employee_no=?"
        value = emp_id

    rows = query(
        cursor,
        "SELECT * FROM dbo.MASTER_PARTICIPANT"
        + hint + " WHERE " + where,
        value,
    )

    if not rows:
        raise StoreError("NOT_FOUND", 404)
    if len(rows) != 1:
        raise StoreError("DUPLICATE_EMPLOYEE_OR_SEED")
    return rows[0]


def receipt(cursor, emp_id):
    rows = query(
        cursor,
        "SELECT * FROM dbo.SIGN_RECEIPT WHERE employee_no=?",
        emp_id,
    )
    if len(rows) > 1:
        raise StoreError("DUPLICATE_RECEIPT")
    return rows[0] if rows else None


_UNSET = object()


def record(cursor, p, logs=None, r=_UNSET, manual=None):
    emp_id = p["employee_no"]

    if logs is None:
        logs = query(
            cursor,
            "SELECT TOP (1) * FROM dbo.CHECKIN_LOG "
            "WHERE employee_no=? ORDER BY checkin_log_id DESC",
            emp_id,
        )

    if p["is_checked_in"] and not logs:
        raise StoreError("CHECKIN_DATA_MISSING")

    count = (
        logs[0]["actual_guest_count"]
        if p["is_checked_in"] and logs else None
    )

    if p["is_checked_in"] and count is None:
        raise StoreError("CHECKIN_DATA_MISSING")

    r = receipt(cursor, emp_id) if r is _UNSET else r

    if manual is None:
        manual = query(
            cursor,
            "SELECT TOP (1) checkin_log_id FROM dbo.CHECKIN_LOG "
            "WHERE employee_no=? AND action_type='MANUAL_NEW'",
            emp_id,
        )

    def fmt(value):
        return value.strftime("%Y-%m-%d %H:%M:%S") if value else None

    return dict(
        emp_id=emp_id,
        name=p["employee_name"],
        unit=p["department"] or "",
        team=p["team"] or "-",
        email=p["email"] or "",
        seed_code=p["seed_code"],
        declared_relatives=p["expected_guest_count"],
        walk_in=bool(manual),
        checked_in=int(p["is_checked_in"]),
        relatives=count,
        amount=500 + 200 * count if count is not None else None,
        operator_id=p["responsible_person"],
        checked_in_at=fmt(p["checkin_time"]),
        claim_code=(
            r["receipt_token"]
            if r and r["member_confirmed"] else None
        ),
        claim_created_at=(
            fmt(r["member_confirmed_at"]) if r else None
        ),
        claimed=int(r["receipt_status"]) if r else 0,
        signer_id=r["receipt_operator"] if r else None,
        signed_at=fmt(r["receipt_time"]) if r else None,
    )


def records(cursor):
    people = query(
        cursor,
        "SELECT * FROM dbo.MASTER_PARTICIPANT ORDER BY employee_no",
    )
    latest, walkins, receipts = {}, set(), {}

    for log in query(
        cursor,
        "SELECT employee_no,actual_guest_count,action_type "
        "FROM dbo.CHECKIN_LOG ORDER BY checkin_log_id",
    ):
        latest[log["employee_no"]] = log
        if log["action_type"] == "MANUAL_NEW":
            walkins.add(log["employee_no"])

    for r in query(cursor, "SELECT * FROM dbo.SIGN_RECEIPT"):
        if r["employee_no"] in receipts:
            raise StoreError("DUPLICATE_RECEIPT")
        receipts[r["employee_no"]] = r

    return [
        record(
            cursor,
            p,
            [latest[p["employee_no"]]]
            if p["employee_no"] in latest else [],
            receipts.get(p["employee_no"]),
            p["employee_no"] in walkins,
        )
        for p in people
    ]


def audit(cursor, p, count, operator, action, reason=None):
    cursor.execute("""
        INSERT dbo.CHECKIN_LOG
        (employee_no,seed_code,operator_employee_no,
         expected_guest_count,actual_guest_count,actual_total_count,
         checkin_status,action_type,checkin_source,
         checkin_time,update_reason,created_at)
        VALUES (?,?,?,?,?,?,1,?,?,?,?,?)
    """,
        p["employee_no"], p["seed_code"], operator,
        p["expected_guest_count"], count, count + 1,
        action, "QR" if action == "CHECKIN" else "MANUAL",
        now(), reason, now(),
    )


def check_in(cursor, p, count, operator, manual=False, new=False):
    if p["is_checked_in"]:
        raise StoreError("ALREADY_CHECKED_IN")

    if not manual and count > p["expected_guest_count"]:
        raise StoreError("INVALID_RELATIVES", 422)

    operator = employee_id(operator, True)

    cursor.execute("""
        UPDATE dbo.MASTER_PARTICIPANT
        SET is_checked_in=1, responsible_person=?,
            checkin_time=?, updated_at=?
        WHERE employee_no=?
    """, operator, now(), now(), p["employee_no"])

    action = "MANUAL_NEW" if new else "MANUAL" if manual else "CHECKIN"
    audit(cursor, p, count, operator, action)

    return record(cursor, person(cursor, emp_id=p["employee_no"]))


def confirm(cursor, p, expected=None):
    row = record(cursor, p)

    if not row["checked_in"]:
        raise StoreError("NOT_CHECKED_IN")
    if row["claimed"]:
        raise StoreError("ALREADY_CLAIMED")
    if expected is not None and expected != row["relatives"]:
        raise StoreError("DATA_CHANGED")

    r = receipt(cursor, p["employee_no"])

    if r and r["member_confirmed"]:
        if (
            r["amount_snapshot"] is None
            or int(r["amount_snapshot"]) != row["amount"]
            or r["actual_total_count_snapshot"] != row["relatives"] + 1
        ):
            raise StoreError("DATA_CHANGED")
        return row

    if r:
        cursor.execute("""
            UPDATE dbo.SIGN_RECEIPT
            SET receipt_token=?,actual_total_count_snapshot=?,
                amount_snapshot=?,member_confirmed=1,
                member_confirmed_at=?,updated_at=?
            WHERE receipt_id=?
        """,
            token(), row["relatives"] + 1, row["amount"],
            now(), now(), r["receipt_id"],
        )
    else:
        cursor.execute("""
            INSERT dbo.SIGN_RECEIPT
            (employee_no,receipt_token,actual_total_count_snapshot,
             amount_snapshot,member_confirmed,member_confirmed_at,
             receipt_status,created_at,updated_at)
            VALUES (?,?,?,?,1,?,0,?,?)
        """,
            p["employee_no"], token(), row["relatives"] + 1,
            row["amount"], now(), now(), now(),
        )

    return record(cursor, p)


def sign(cursor, code, operator):
    operator = employee_id(operator, True)

    rows = query(
        cursor,
        "SELECT employee_no FROM dbo.SIGN_RECEIPT "
        "WHERE receipt_token COLLATE Latin1_General_100_BIN2=?",
        code,
    )

    if not rows:
        raise StoreError("NOT_FOUND", 404)
    if len(rows) > 1:
        raise StoreError("DUPLICATE_RECEIPT")

    p = person(cursor, emp_id=rows[0]["employee_no"], lock=True)
    r = receipt(cursor, p["employee_no"])

    if not r or r["receipt_token"] != code or not r["member_confirmed"]:
        raise StoreError("NOT_FOUND", 404)

    if r["receipt_status"]:
        raise StoreError("ALREADY_CLAIMED", row=record(cursor, p))

    row = record(cursor, p)

    if not row["checked_in"]:
        raise StoreError("NOT_CHECKED_IN")

    if (
        r["amount_snapshot"] is None
        or int(r["amount_snapshot"]) != row["amount"]
        or r["actual_total_count_snapshot"] != row["relatives"] + 1
    ):
        raise StoreError("DATA_CHANGED")

    cursor.execute("""
        UPDATE dbo.SIGN_RECEIPT
        SET receipt_status=1,receipt_operator=?,
            receipt_time=?,updated_at=?
        WHERE receipt_id=? AND receipt_status=0 AND member_confirmed=1
    """, operator, now(), now(), r["receipt_id"])

    if cursor.rowcount != 1:
        raise StoreError("ALREADY_CLAIMED")

    return record(cursor, p)


def edit(cursor, p, count, operator, reason):
    row = record(cursor, p)

    if not row["checked_in"]:
        raise StoreError("NOT_CHECKED_IN")
    if row["claimed"]:
        raise StoreError("ALREADY_CLAIMED")

    operator = employee_id(operator, True)
    audit(cursor, p, count, operator, "UPDATE", reason)

    cursor.execute(
        "UPDATE dbo.MASTER_PARTICIPANT SET updated_at=? "
        "WHERE employee_no=?",
        now(), p["employee_no"],
    )

    cursor.execute("""
        UPDATE dbo.SIGN_RECEIPT
        SET receipt_token=NULL,member_confirmed=0,
            member_confirmed_at=NULL,
            actual_total_count_snapshot=NULL,
            amount_snapshot=NULL,updated_at=?
        WHERE employee_no=?
    """, now(), p["employee_no"])

    return record(cursor, p)


def walk_in(cursor, body):
    normalized = employee_id(body.empId)

    matches = query(cursor, """
        SELECT * FROM dbo.MASTER_PARTICIPANT WITH (UPDLOCK,HOLDLOCK)
        WHERE RIGHT(UPPER(LTRIM(RTRIM(employee_no))),5)=?
    """, normalized[-5:])

    if len(matches) > 1:
        raise StoreError("DUPLICATE_EMPLOYEE_ID")

    new = not matches

    if new:
        emp_id = "T" + normalized[-5:]

        cursor.execute("""
            INSERT dbo.MASTER_PARTICIPANT
            (employee_no,employee_name,department,team,seed_code,
             expected_guest_count,is_checked_in,created_at,updated_at)
            VALUES (?,?,?,?,?,?,0,?,?)
        """,
            emp_id, body.name, body.unit, body.team or "-",
            token(), body.relatives, now(), now(),
        )

        p = person(cursor, emp_id=emp_id, lock=True)
    else:
        p = matches[0]

    return check_in(
        cursor, p, body.relatives,
        body.operatorId, manual=True, new=new,
    )


def health(cursor):
    tables = (
        "MASTER_PARTICIPANT", "CHECKIN_LOG", "SIGN_RECEIPT"
    )

    missing = [
        name for name in tables
        if not query(
            cursor,
            "SELECT OBJECT_ID(?, 'U') AS id",
            "dbo." + name,
        )[0]["id"]
    ]

    if missing:
        raise StoreError(
            "SQL_SCHEMA_NOT_READY", 503, missing_tables=missing
        )

    database_name = query(
        cursor, "SELECT DB_NAME() AS database_name"
    )[0]["database_name"]

    count = query(
        cursor,
        "SELECT COUNT(*) AS employees FROM dbo.MASTER_PARTICIPANT",
    )[0]["employees"]

    return {
        "status": "ok",
        "database": "sqlserver",
        "database_name": database_name,
        "employees": count,
        "tables": list(tables),
        "max_relatives": 5,
        "employee_amount": 500,
        "relative_amount": 200,
    }