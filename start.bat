@echo off
REM ═══════════════════════════════════════════════════════════════
REM  Joseph's Financial Command Center — Local Start (Windows)
REM  This starts the Python backend and React frontend side by side.
REM ═══════════════════════════════════════════════════════════════

echo.
echo  ╔═══════════════════════════════════════════════════════════╗
echo  ║  Joseph's Financial Command Center                       ║
echo  ║  Starting backend (Python) + frontend (React)...         ║
echo  ╚═══════════════════════════════════════════════════════════╝
echo.

REM ── Check prerequisites ──
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found. Install from https://python.org
    pause
    exit /b 1
)

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org
    pause
    exit /b 1
)

REM ── Install backend dependencies if needed ──
if not exist "backend\__installed__" (
    echo [1/3] Installing Python dependencies...
    cd backend
    pip install -r requirements.txt
    echo. > __installed__
    cd ..
) else (
    echo [1/3] Python dependencies already installed.
)

REM ── Install frontend dependencies if needed ──
if not exist "frontend\node_modules" (
    echo [2/3] Installing Node dependencies (first time only)...
    cd frontend
    npm install
    cd ..
) else (
    echo [2/3] Node dependencies already installed.
)

REM ── Start both services ──
echo [3/3] Starting services...
echo.
echo   Backend:  http://localhost:8000  (Python FastAPI)
echo   Frontend: http://localhost:5173  (Vite + React)
echo.
echo   Open http://localhost:5173 in your browser.
echo   Press Ctrl+C in either window to stop.
echo.

REM Start backend in a new window
start "Finance Engine (Backend)" cmd /k "cd backend && uvicorn main:app --reload --port 8000"

REM Start frontend in a new window
start "Finance Dashboard (Frontend)" cmd /k "cd frontend && npm run dev"

echo Both services starting. Check the two new terminal windows.
echo.
pause
