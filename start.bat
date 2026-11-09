@echo off
cd /d "%~dp0"
echo Starting BagWise. Open http://127.0.0.1:8000 in your browser.
venv\Scripts\python.exe -m uvicorn api:api
pause