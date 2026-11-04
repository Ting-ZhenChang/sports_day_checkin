# One-click demo: create venv, install packages, seed demo data, start the server.
# Usage (inside ACES_Backend):  powershell -ExecutionPolicy Bypass -File .\run_demo.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path .\.venv\Scripts\python.exe)) {
    python -m venv .venv
}
.\.venv\Scripts\python -m pip install -q -r requirements.txt

$env:ACES_DEMO = "1"
$env:PYTHONIOENCODING = "utf-8"
.\.venv\Scripts\python seed.py

Write-Host ""
Write-Host "Open http://127.0.0.1:8000  (demo admin: finance01 / demo1234)" -ForegroundColor Green
.\.venv\Scripts\python -m uvicorn app.main:app --port 8000
