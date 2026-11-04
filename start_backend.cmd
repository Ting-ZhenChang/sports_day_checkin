@echo off
cd /d "%~dp0"
"D:\sports_day_checkin\.venv\Scripts\python.exe" -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8010 --no-access-log
pause
