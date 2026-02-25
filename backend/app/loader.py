"""
loader.py — Data loading utilities for Geo-Representative Lookup.

Responsible for:
    - Reading GeoJSON boundary files (AC and PC polygons).
    - Reading JSON data files (MLA and MP records).
    - Exposing a unified DataStore dataclass used throughout the application.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)

# ── Paths ─────────────────────────────────────────────────────────────────────
_DATA_DIR = Path(__file__).resolve().parent.parent / "data"

_AC_GEOJSON_PATH = _DATA_DIR / "ac_bangalore.geojson"
_PC_GEOJSON_PATH = _DATA_DIR / "pc_bangalore.geojson"
_AC_DATA_PATH    = _DATA_DIR / "ac_data.json"
_PC_DATA_PATH    = _DATA_DIR / "pc_data.json"


# ── DataStore ────────────────────────────────────────────────────────────────
@dataclass
class DataStore:
    """
    Holds all data required for representative lookups.

    Attributes:
        ac_features: List of GeoJSON Feature objects for assembly constituencies.
        pc_features: List of GeoJSON Feature objects for parliamentary constituencies.
        ac_data:     Dict mapping AC name → MLA metadata dict.
        pc_data:     Dict mapping PC name → MP metadata dict.
    """
    ac_features: list[dict] = field(default_factory=list)
    pc_features: list[dict] = field(default_factory=list)
    ac_data:     dict[str, dict] = field(default_factory=dict)
    pc_data:     dict[str, dict] = field(default_factory=dict)


# ── Loaders ──────────────────────────────────────────────────────────────────

def _load_geojson(path: Path) -> list[dict]:
    """
    Load and parse a GeoJSON FeatureCollection from disk.

    Args:
        path: Absolute path to the .geojson file.

    Returns:
        List of GeoJSON Feature dicts, or an empty list on failure.
    """
    try:
        with path.open(encoding="utf-8") as fh:
            collection = json.load(fh)
        features = collection.get("features", [])
        logger.info("Loaded %d features from %s", len(features), path.name)
        return features
    except FileNotFoundError:
        logger.error("GeoJSON file not found: %s", path)
        return []
    except json.JSONDecodeError as exc:
        logger.error("Invalid JSON in %s: %s", path.name, exc)
        return []


def _load_json_data(path: Path) -> dict:
    """
    Load and parse a representative data JSON file from disk.

    Args:
        path: Absolute path to the .json file.

    Returns:
        Parsed dict, or an empty dict on failure.
    """
    try:
        with path.open(encoding="utf-8") as fh:
            data = json.load(fh)
        logger.info("Loaded %d records from %s", len(data), path.name)
        return data
    except FileNotFoundError:
        logger.error("Data file not found: %s", path)
        return {}
    except json.JSONDecodeError as exc:
        logger.error("Invalid JSON in %s: %s", path.name, exc)
        return {}


def load_all_data() -> DataStore:
    """
    Load all four data files and return a populated DataStore instance.

    This should be called exactly once at application startup.

    Returns:
        DataStore with ac_features, pc_features, ac_data, pc_data populated.
    """
    return DataStore(
        ac_features=_load_geojson(_AC_GEOJSON_PATH),
        pc_features=_load_geojson(_PC_GEOJSON_PATH),
        ac_data=_load_json_data(_AC_DATA_PATH),
        pc_data=_load_json_data(_PC_DATA_PATH),
    )