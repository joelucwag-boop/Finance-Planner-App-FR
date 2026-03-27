# Joseph's Financial Command Center

50-year financial projection dashboard — v13 engine, 0.11% Excel parity.

## Prerequisites

You need two things installed:

1. **Python 3.10+** — [python.org/downloads](https://www.python.org/downloads/)
   - During install on Windows: **check "Add Python to PATH"**
   - Verify: open a terminal and run `python --version`

2. **Node.js 18+** — [nodejs.org](https://nodejs.org/) (LTS version)
   - Verify: open a terminal and run `node --version`

## Quick Start

### Option 1: Double-Click (Easiest)

**Windows:** Double-click `start.bat`

**Mac/Linux:**
```bash
chmod +x start.sh
./start.sh
```

This installs dependencies (first time only) and starts both services. Open **http://localhost:5173** in your browser.

### Option 2: VS Code Tasks

1. Open this folder in VS Code: `File → Open Folder → select joseph-finance`
2. Press `Ctrl+Shift+B` (or `Cmd+Shift+B` on Mac)
3. This runs the "Start Everything" task — launches backend + frontend in two terminals
4. Open **http://localhost:5173**

### Option 3: Manual (Two Terminals)

**Terminal 1 — Backend:**
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**

## What You'll See

The dashboard header shows the engine connection status:

- **● Live Engine (21ms)** in green = Python backend connected, all data is live
- **● Offline (cached data)** in orange = Backend not running, using baked-in fallback data

Both modes are fully functional. The live engine just means What-If scenarios use the validated Python simulation (0.11% Excel parity) instead of the JS approximation.

## Project Structure

```
joseph-finance/
├── start.bat                 # Windows launcher (double-click)
├── start.sh                  # Mac/Linux launcher
├── .vscode/
│   ├── tasks.json            # Ctrl+Shift+B runs both services
│   └── settings.json         # Python + JSX defaults
│
├── backend/                  # Python FastAPI engine
│   ├── engine.py             # 1,526 lines — simulation core
│   ├── main.py               # FastAPI endpoints
│   └── requirements.txt      # pip dependencies
│
└── frontend/                 # React + Vite dashboard
    ├── src/
    │   ├── Dashboard.jsx     # 2,696 lines — full dashboard
    │   └── main.jsx          # React entry point
    ├── package.json          # npm dependencies
    └── vite.config.js        # Dev server + API proxy
```

## Ports

| Service  | URL                     | What It Does                    |
|----------|-------------------------|---------------------------------|
| Backend  | http://localhost:8000   | Python simulation engine        |
| Frontend | http://localhost:5173   | React dashboard (open this one) |

The backend auto-reloads when you edit `engine.py` or `main.py`.
The frontend auto-reloads when you edit `Dashboard.jsx`.

## Troubleshooting

**"pip not found" or "python not found"**
- Windows: Reinstall Python, check "Add Python to PATH"
- Mac: Use `pip3` and `python3` instead, or install via `brew install python`

**"uvicorn not found" after pip install**
- Try: `python -m uvicorn main:app --reload --port 8000`
- Or: `python3 -m uvicorn main:app --reload --port 8000`

**Port 8000 already in use**
- Kill whatever's using it: `npx kill-port 8000` (or `lsof -ti:8000 | xargs kill` on Mac)
- Or change the backend port and update `frontend/.env.development`

**Dashboard shows "● Offline" even though backend is running**
- Open http://localhost:8000/health in your browser — should show `{"status":"ok"}`
- If that works but the dashboard still says offline, check browser console for CORS errors
