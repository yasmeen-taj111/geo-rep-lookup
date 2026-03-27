"""
serve.py — Single entry point for Railway deployment.

Imports the FastAPI app (which has all /api/v1/* routes already registered),
then mounts the frontend/ static files so the same process serves both.

Railway runs: uvicorn serve:app --host 0.0.0.0 --port $PORT
"""

import sys
from pathlib import Path

# Add backend/ to sys.path so "from app.main import app" resolves
sys.path.insert(0, str(Path(__file__).parent / "backend"))

from app.main import app  # FastAPI instance with all routes registered
from fastapi.staticfiles import StaticFiles

_FRONTEND = Path(__file__).parent / "frontend"

# IMPORTANT: mount AFTER all API routes so /api/v1/* is not intercepted.
# html=True means unknown paths return index.html (single-page app behaviour).
app.mount("/", StaticFiles(directory=str(_FRONTEND), html=True), name="static")