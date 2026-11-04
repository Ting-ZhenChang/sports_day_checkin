import os
import tempfile

# 必須在 import app 之前設定，測試才不會碰到真正的資料庫。
_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["ACES_DEMO"] = "1"
os.environ["FRONTEND_DIR"] = _tmp  # 不掛載前端

import pytest
from fastapi.testclient import TestClient

from app import security
from app.db import Base, SessionLocal, engine
from app.main import app, throttle
from app.models import Admin, Employee

QR = "a" * 32


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    throttle._failures.clear()
    with SessionLocal() as db:
        db.add(Employee(emp_id="A10001", name="王小明", dept="DTD", qr_token=QR))
        db.add(Admin(account="finance01", password_hash=security.hash_password("pw-test-123")))
        db.commit()
    yield


client = TestClient(app)


def admin_headers():
    r = client.post("/api/admin/login", json={"account": "finance01", "password": "pw-test-123"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


def checkin(relatives=2):
    return client.post("/api/checkin/complete", json={"qr_token": QR, "relatives": relatives})


def test_session_unknown_token_404():
    assert client.get("/api/checkin/session/nope").status_code == 404


def test_session_before_and_after_checkin():
    r = client.get(f"/api/checkin/session/{QR}")
    assert r.json() == {"emp_id": "A10001", "name": "王小明", "dept": "DTD", "record": None}
    checkin(3)
    record = client.get(f"/api/checkin/session/{QR}").json()["record"]
    assert record["relatives"] == 3 and record["amount"] == 1100
    assert len(record["claim_token"]) == 32


@pytest.mark.parametrize("relatives,amount", [(0, 500), (1, 700), (5, 1500)])
def test_amount_calculated_by_backend(relatives, amount):
    assert checkin(relatives).json()["amount"] == amount


@pytest.mark.parametrize("bad", [-1, 6, 100])
def test_relatives_out_of_range_rejected(bad):
    assert checkin(bad).status_code == 422


def test_client_cannot_send_amount():
    r = client.post("/api/checkin/complete", json={"qr_token": QR, "relatives": 0, "amount": 99999})
    assert r.status_code == 200 and r.json()["amount"] == 500


def test_checkin_locked_after_first_time():
    first = checkin(1)
    again = checkin(5)
    assert again.status_code == 409
    record = client.get(f"/api/checkin/session/{QR}").json()["record"]
    assert record["relatives"] == 1
    assert record["claim_token"] == first.json()["claim_token"]


def test_claim_requires_login():
    token = checkin().json()["claim_token"]
    assert client.get(f"/api/claim/{token}").status_code == 401
    assert client.post(f"/api/claim/{token}/complete").status_code == 401
    bad = {"Authorization": "Bearer not-a-real-token"}
    assert client.get(f"/api/claim/{token}", headers=bad).status_code == 401


def test_claim_flow_and_no_double_claim():
    token = checkin(2).json()["claim_token"]
    h = admin_headers()

    data = client.get(f"/api/claim/{token}", headers=h).json()
    assert data["name"] == "王小明" and data["amount"] == 900 and data["claimed_at"] is None

    done = client.post(f"/api/claim/{token}/complete", headers=h)
    assert done.status_code == 200 and done.json()["claimed_by"] == "finance01"

    again = client.post(f"/api/claim/{token}/complete", headers=h)
    assert again.status_code == 409
    after = client.get(f"/api/claim/{token}", headers=h).json()
    assert after["claimed_at"] == done.json()["claimed_at"]


def test_claim_unknown_token_404():
    assert client.get("/api/claim/zzz", headers=admin_headers()).status_code == 404


def test_login_wrong_password_and_lockout():
    for _ in range(5):
        r = client.post("/api/admin/login", json={"account": "finance01", "password": "bad"})
        assert r.status_code == 401
    locked = client.post("/api/admin/login", json={"account": "finance01", "password": "pw-test-123"})
    assert locked.status_code == 429


def test_login_unknown_account():
    r = client.post("/api/admin/login", json={"account": "ghost", "password": "x"})
    assert r.status_code == 401


def test_logout_invalidates_token():
    h = admin_headers()
    token = checkin().json()["claim_token"]
    assert client.post("/api/admin/logout", headers=h).status_code == 204
    assert client.get(f"/api/claim/{token}", headers=h).status_code == 401


def test_password_not_stored_in_plain_text():
    with SessionLocal() as db:
        stored = db.get(Admin, "finance01").password_hash
    assert "pw-test-123" not in stored and stored.startswith("pbkdf2_sha256$")


def test_dev_employees_demo_only():
    assert client.get("/api/dev/employees").json()[0]["qr_token"] == QR
