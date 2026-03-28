"""
serve.py — Single entry point for Railway deployment.

Railway runs: uvicorn serve:app --host 0.0.0.0 --port $PORT
"""
import sys
import subprocess
from pathlib import Path

ROOT     = Path(__file__).resolve().parent
BACKEND  = ROOT / "backend"
FRONTEND = ROOT / "frontend"

# ── Guard: fail loudly if files are missing so logs show a clear message ──────
assert BACKEND.exists(),              f"ERROR: backend/ not found at {BACKEND}"
assert FRONTEND.exists(),             f"ERROR: frontend/ not found at {FRONTEND}"
assert (FRONTEND / "index.html").exists(), \
    f"ERROR: frontend/index.html not found — did you commit the frontend folder?"

# ── Ensure aiofiles is installed (needed by StaticFiles) ──────────────────────
# This is a safety net in case Railway used backend/requirements.txt
# (which doesn't include aiofiles) instead of the root requirements.txt.
try:
    import aiofiles  # noqa: F401
except ImportError:
    print("aiofiles not found — installing now...", flush=True)
    subprocess.check_call([sys.executable, "-m", "pip", "install", "aiofiles==23.2.1"])
    import aiofiles  # noqa: F401

# ── Import FastAPI app (all /api/v1/* routes already registered on it) ─────────
sys.path.insert(0, str(BACKEND))
from app.main import app                     # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

# ── Mount frontend AFTER all API routes so /api/v1/* is never intercepted ──────
app.mount("/", StaticFiles(directory=str(FRONTEND), html=True), name="static")

print(f"✓ serve.py OK  — API routes + frontend/{FRONTEND.name} both mounted", flush=True)