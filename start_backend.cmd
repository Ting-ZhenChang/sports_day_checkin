@echo off
set "SQL_DRIVER=ODBC Driver 17 for SQL Server"
cd /d "%~dp0"
"D:\sports_day_checkin\.venv\Scripts\python.exe" backend\main.py %*
pause
