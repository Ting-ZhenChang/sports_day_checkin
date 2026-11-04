## FastAPI 入口：定義 API 網址、驗證輸入，並啟動服務
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, StrictInt
import store


class Input(BaseModel):
    model_config = ConfigDict(
        extra="forbid", str_strip_whitespace=True
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


app = FastAPI(
    title="運動會 SQL Server API",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)


@app.exception_handler(store.StoreError)
async def store_error(request, exc):
    return JSONResponse(
        {"code": exc.code, **exc.extra},
        status_code=exc.status,
    )


@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    return JSONResponse(
        {
            "code": "INVALID_REQUEST",
            "fields": [
                ".".join(map(str, item["loc"]))
                for item in exc.errors()
            ],
        },
        status_code=422,
    )


@app.middleware("http")
async def no_cache(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/health")
def health():
    with store.database() as cursor:
        return store.health(cursor)


@app.get("/api/records")
def records():
    with store.database() as cursor:
        return store.records(cursor)


@app.get("/api/employee/by-seed/{seed}")
def lookup(seed: str):
    with store.database() as cursor:
        return store.record(cursor, store.person(cursor, seed=seed))


@app.post("/api/checkin")
def checkin(body: CheckIn):
    with store.database() as cursor:
        return store.check_in(
            cursor,
            store.person(cursor, seed=body.seed, lock=True),
            body.relatives,
            body.operatorId,
        )


@app.post("/api/claim")
def claim(body: Claim):
    with store.database() as cursor:
        return store.confirm(
            cursor,
            store.person(cursor, seed=body.seed, lock=True),
            body.expectedRelatives,
        )


@app.post("/api/receipt/sign")
def sign(body: Sign):
    with store.database() as cursor:
        return store.sign(
            cursor, body.claimCode, body.signerId
        )


@app.put("/api/checkin/{emp_id}/relatives")
def edit(emp_id: str, body: Edit):
    with store.database() as cursor:
        return store.edit(
            cursor,
            store.person(cursor, emp_id=emp_id, lock=True),
            body.relatives,
            body.operatorId,
            body.reason,
        )


@app.post("/api/walk-in")
def walk_in(body: WalkIn):
    with store.database() as cursor:
        return store.walk_in(cursor, body)


ROOT = Path(__file__).resolve().parent
FRONTEND = (
    ROOT.parent
    / "ACES_Frontend"
    / "ACES_Frontend-20261030T051522Z-1-001"
    / "ACES_Frontend"
)

if (FRONTEND / "index.html").is_file():
    app.mount(
        "/",
        StaticFiles(directory=FRONTEND, html=True),
        name="frontend",
    )


if __name__ == "__main__":
    import argparse
    import getpass
    import os
    import subprocess
    import sys
    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--seed-demo", action="store_true")
    parser.add_argument("--port", type=int, default=8010)
    args = parser.parse_args()

    os.environ.setdefault("SQL_SERVER", "10.0.1.28")
    os.environ.setdefault("SQL_DATABASE", "sports_day_checkin")
    os.environ.setdefault("SQL_AUTH", "sql")

    if os.environ["SQL_AUTH"].lower() == "sql":
        if not os.getenv("SQL_USER"):
            os.environ["SQL_USER"] = input(
                "SQL Server login: "
            ).strip()
        if not os.getenv("SQL_PASSWORD"):
            os.environ["SQL_PASSWORD"] = getpass.getpass(
                "SQL Server password: "
            )

    if args.seed_demo:
        child_env = os.environ.copy()
        child_env["SQL_TEST_MODE"] = "1"

        result = subprocess.run(
            [
                sys.executable,
                str(ROOT / "seed_test.py"),
                "--confirm-database",
                os.environ["SQL_DATABASE"],
            ],
            env=child_env,
        )

        if result.returncode:
            raise SystemExit(result.returncode)

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=args.port,
        access_log=False,
    )