#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  Joseph's Financial Command Center — Local Start (Mac/Linux)
#  Starts Python backend + React frontend side by side.
# ═══════════════════════════════════════════════════════════════

echo ""
echo "  ╔═══════════════════════════════════════════════════════════╗"
echo "  ║  Joseph's Financial Command Center                       ║"
echo "  ║  Starting backend (Python) + frontend (React)...         ║"
echo "  ╚═══════════════════════════════════════════════════════════╝"
echo ""

# Check prerequisites
command -v python3 >/dev/null 2>&1 || { echo "[ERROR] Python3 not found. Install from https://python.org"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "[ERROR] Node.js not found. Install from https://nodejs.org"; exit 1; }

# Install backend deps if needed
if [ ! -f "backend/.installed" ]; then
    echo "[1/3] Installing Python dependencies..."
    cd backend && pip3 install -r requirements.txt && touch .installed && cd ..
else
    echo "[1/3] Python dependencies ready."
fi

# Install frontend deps if needed
if [ ! -d "frontend/node_modules" ]; then
    echo "[2/3] Installing Node dependencies (first time only)..."
    cd frontend && npm install && cd ..
else
    echo "[2/3] Node dependencies ready."
fi

# Start both services
echo "[3/3] Starting services..."
echo ""
echo "  Backend:  http://localhost:8000  (Python FastAPI)"
echo "  Frontend: http://localhost:5173  (Vite + React)"
echo ""
echo "  Open http://localhost:5173 in your browser."
echo "  Press Ctrl+C to stop both services."
echo ""

# Trap Ctrl+C to kill both background processes
trap "echo ''; echo 'Stopping...'; kill 0; exit" SIGINT SIGTERM

# Start backend in background
cd backend && uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!
cd ..

# Start frontend in background
cd frontend && npm run dev &
FRONTEND_PID=$!
cd ..

# Wait for both
wait $BACKEND_PID $FRONTEND_PID
