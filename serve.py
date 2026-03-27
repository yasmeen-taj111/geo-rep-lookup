"""
serve.py — Production entry point.

Mounts the FastAPI backend AND serves the frontend static files from a single
Uvicorn process. This means Railway (or any single-process host) only needs
to run one command: uvicorn serve:app


"""

import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).parent / "backend"))

from fastapi.staticfiles import StaticFiles
from app.main import app


_frontend = Path(__file__).parent / "frontend"
app.mount("/", StaticFiles(directory=str(_frontend), html=True), name="frontend")