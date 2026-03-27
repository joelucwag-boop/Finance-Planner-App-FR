# ── Financial Plan v13 Engine ──
# FastAPI backend: 21ms simulations, 523 months, 62 columns, 0.11% Excel parity
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install Python dependencies first (layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY engine.py main.py ./

# Expose port (Railway/Render inject $PORT at runtime)
EXPOSE 8000

# Start uvicorn — $PORT is set by the hosting platform (default 8000 for local)
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
