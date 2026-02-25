"""
main.py — FastAPI application entry point for Geo-Representative Lookup.

Exposes:
    GET /                          — health check (root)
    GET /health                    — detailed health info
    GET /api/v1/lookup             — core lookup by lat/lon
    GET /api/v1/constituencies     — list all loaded constituencies
    GET /api/v1/constituencies/geojson/{ac_name}  — GeoJSON for one AC
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.loader import DataStore, load_all_data
from app.services import find_representatives

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# ── Application-level data store (loaded once at startup) ─────────────────────
data_store: DataStore | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load all GeoJSON and JSON data files before accepting requests."""
    global data_store
    data_store = load_all_data()
    logger.info("Loaded %d AC constituencies", len(data_store.ac_features))
    logger.info("Loaded %d PC constituencies", len(data_store.pc_data))
    yield
    logger.info("Shutting down — releasing data store.")


# ── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI(
    title="Geo-Representative Lookup API",
    description=(
        "Find your MLA (Member of Legislative Assembly) and MP (Member of Parliament) "
        "for any coordinate within Bangalore, Karnataka."
    ),
    version="2.0.0",
    lifespan=lifespan,
)

# Allow the frontend (any localhost port) to query the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/", tags=["health"])
def root():
    """Root health-check endpoint."""
    return {"status": "ok", "message": "Geo-Representative Lookup API is running."}


@app.get("/health", tags=["health"])
def health():
    """Detailed health check: returns loaded constituency counts."""
    if data_store is None:
        raise HTTPException(status_code=503, detail="Data not yet loaded.")
    return {
        "status": "ok",
        "ac_constituencies_loaded": len(data_store.ac_features),
        "pc_constituencies_loaded": len(data_store.pc_data),
    }


@app.get("/api/v1/lookup", tags=["lookup"])
def lookup(
    lat: float = Query(..., ge=12.7, le=13.2, description="Latitude (12.7 – 13.2)"),
    lon: float = Query(..., ge=77.3, le=77.9, description="Longitude (77.3 – 77.9)"),
):
    """
    Return the MLA and MP for the supplied geographic coordinate.

    The lookup runs a ray-casting point-in-polygon test against the
    assembly constituency GeoJSON, then maps the matched AC to its
    Parliamentary Constituency via the official 2008 ECI delimitation table.

    Args:
        lat: Latitude of the queried point.
        lon: Longitude of the queried point.

    Returns:
        JSON object with keys: latitude, longitude, mla, mp.

    Raises:
        HTTPException 404: If the point falls outside all known boundaries.
        HTTPException 503: If the data store has not been initialised.
    """
    if data_store is None:
        raise HTTPException(status_code=503, detail="Data store not initialised.")

    result = find_representatives(lat=lat, lon=lon, store=data_store)

    if result is None:
        logger.warning("No representatives found for (%.6f, %.6f)", lat, lon)
        raise HTTPException(
            status_code=404,
            detail=(
                f"No representatives found for coordinates ({lat}, {lon}). "
                "Ensure the point falls within Bangalore city limits."
            ),
        )

    logger.info("Lookup (%.4f, %.4f) → AC: %s | PC: %s", lat, lon,
                result.get("mla", {}).get("constituency"),
                result.get("mp", {}).get("constituency"))
    return {"latitude": lat, "longitude": lon, **result}


@app.get("/api/v1/constituencies", tags=["metadata"])
def list_constituencies():
    """
    Return a list of all loaded Assembly and Parliamentary constituency names.

    Useful for debugging data completeness.
    """
    if data_store is None:
        raise HTTPException(status_code=503, detail="Data store not initialised.")

    ac_names = [
        feat["properties"].get("AC_NAME", "Unknown")
        for feat in data_store.ac_features
    ]
    pc_names = list(data_store.pc_data.keys())

    return {
        "assembly_constituencies": sorted(ac_names),
        "parliamentary_constituencies": sorted(pc_names),
    }


@app.get("/api/v1/constituencies/geojson/{ac_name}", tags=["metadata"])
def get_ac_geojson(ac_name: str):
    """
    Return the GeoJSON feature for a single Assembly Constituency by name.

    This is used by the frontend to highlight the matched AC boundary on the map.

    Args:
        ac_name: The exact AC_NAME string as stored in the GeoJSON.

    Raises:
        HTTPException 404: If no matching AC feature is found.
    """
    if data_store is None:
        raise HTTPException(status_code=503, detail="Data store not initialised.")

    # Case-insensitive search for friendliness
    match = next(
        (feat for feat in data_store.ac_features
         if feat["properties"].get("AC_NAME", "").lower() == ac_name.lower()),
        None,
    )

    if match is None:
        raise HTTPException(
            status_code=404,
            detail=f"Assembly constituency '{ac_name}' not found."
        )

    return {"type": "FeatureCollection", "features": [match]}