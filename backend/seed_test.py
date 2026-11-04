## 產生測試用假員工資料（僅限空的測試資料庫）
import argparse
import os
import store

parser = argparse.ArgumentParser(
    description="Populate an EMPTY test database with fake employees."
)
parser.add_argument("--confirm-database", required=True)
parser.add_argument("--count", type=int, default=500)
args = parser.parse_args()

if not 1 <= args.count <= 10000:
    raise SystemExit("Count must be between 1 and 10000.")

if (
    os.getenv("SQL_TEST_MODE") != "1"
    or args.confirm_database != os.getenv("SQL_DATABASE")
):
    raise SystemExit("Test database confirmation is required.")

try:
    with store.database() as cursor:
        store.health(cursor)

        for table in (
            "MASTER_PARTICIPANT", "CHECKIN_LOG", "SIGN_RECEIPT"
        ):
            count = store.query(
                cursor,
                "SELECT COUNT(*) AS count FROM dbo." + table,
            )[0]["count"]

            if count:
                raise store.StoreError("TEST_DATABASE_NOT_EMPTY")

        stamp = store.now()

        cursor.executemany("""
            INSERT dbo.MASTER_PARTICIPANT
            (form_timestamp,email,employee_no,employee_name,
             department,team,seed_code,expected_guest_count,
             is_checked_in,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,0,?,?)
        """, [
            (
                stamp,
                f"test{i:04d}@example.invalid",
                f"T{i:05d}",
                f"測試員工{i:04d}",
                f"測試部門{(i-1)%8+1}",
                f"測試隊伍{(i-1)%4+1}",
                store.token(),
                (i-1)%6,
                stamp,
                stamp,
            )
            for i in range(1, args.count + 1)
        ])

    print(f"Created {args.count} synthetic employees.")

except store.StoreError as exc:
    raise SystemExit(exc.code)