"""
services.py — Business logic for the Geo-Representative Lookup service.

Responsibilities:
    - Iterating over AC boundary polygons to find which constituency contains
      a given coordinate (delegated to raycast.py).
    - Mapping the matched AC to a Parliamentary Constituency using the official
      ECI 2008 delimitation table.
    - Fetching MLA and MP metadata from the loaded data store.
"""

from __future__ import annotations

import logging
from typing import Optional

from app.loader import DataStore
from app.raycast import point_in_polygon

logger = logging.getLogger(__name__)

# ── Official ECI 2008 AC → PC mapping ────────────────────────────────────────
# Source: Election Commission of India, Delimitation Order 2008.
# Keys are Parliamentary Constituency names; values are lists of AC_NAME
# strings that exactly match the GeoJSON property.
AC_TO_PC_MAP: dict[str, list[str]] = {
    "Bangalore North (24)": [
        "K.R.Pura",
        "Byatarayanapura",
        "Yeshvanthapura",
        "Dasarahalli",
        "Mahalakshmi Layout",
        "Malleshwaram",
        "Hebbal",
        "Pulakeshinagar(SC)",
        "Yelahanka",
    ],
    "Bangalore Central (25)": [
        "Shivajinagar",
        "Shanti Nagar",
        "Gandhi Nagar",
        "Rajaji Nagar",
        "Chamrajpet",
        "Chickpet",
        "Sarvagnanagar",
        "C.V. Raman Nagar(SC)",
        "Mahadevapura",
    ],
    "Bangalore South (26)": [
        "Govindraj Nagar",
        "Vijay Nagar",
        "Basavanagudi",
        "Padmanaba Nagar",
        "B.T.M Layout",
        "Jayanagar",
        "Bommanahalli",
    ],
    "Bangalore Rural (23)": [
        "Rajarajeshwarinagar",
        "Bangalore South",   # ← The AC named "Bangalore South" (≠ Bangalore South PC)
        "Anekal(SC)",
        "Magadi",
        "Ramanagaram",
        "Kanakapura",
        "Channapatna",
        "Hosakote",
        "Doddaballapur",
        "Devanahalli(SC)",
        "Nelamangala(SC)",
    ],
}

# Inverted map: AC name → PC name for O(1) lookup
_AC_NAME_TO_PC: dict[str, str] = {
    ac.strip(): pc
    for pc, ac_list in AC_TO_PC_MAP.items()
    for ac in ac_list
}

# Canonical PC names (without the ECI numbering suffix) for data file lookup
_PC_DISPLAY_NAMES: dict[str, str] = {
    "Bangalore North (24)":   "Bangalore North",
    "Bangalore Central (25)": "Bangalore Central",
    "Bangalore South (26)":   "Bangalore South",
    "Bangalore Rural (23)":   "Bangalore Rural",
}


# ── Public API ────────────────────────────────────────────────────────────────

def find_representatives(
    lat: float,
    lon: float,
    store: DataStore,
) -> Optional[dict]:
    """
    Find the MLA and MP for a given geographic coordinate.

    Steps:
        1. Iterate over all loaded AC GeoJSON features.
        2. Use ray-casting to find the AC polygon that contains (lon, lat).
        3. Map the matched AC name to a Parliamentary Constituency.
        4. Look up MLA metadata from store.ac_data.
        5. Look up MP  metadata from store.pc_data.

    Args:
        lat:   Latitude  of the query point.
        lon:   Longitude of the query point.
        store: Populated DataStore with all loaded data.

    Returns:
        Dict with keys "mla" and "mp", each containing representative metadata;
        or None if no AC boundary contains the point.
    """
    matched_ac_name = _find_ac(lon=lon, lat=lat, ac_features=store.ac_features)

    if matched_ac_name is None:
        logger.debug("Point (%.6f, %.6f) matched no AC boundary.", lat, lon)
        return None

    pc_full_name  = _ac_name_to_pc(matched_ac_name)
    pc_short_name = _PC_DISPLAY_NAMES.get(pc_full_name, pc_full_name)

    mla_data = _get_mla_data(matched_ac_name, store)
    mp_data  = _get_mp_data(pc_short_name, store)

    return {"mla": mla_data, "mp": mp_data}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _find_ac(lon: float, lat: float, ac_features: list[dict]) -> Optional[str]:
    """
    Iterate over AC GeoJSON features and return the name of the first
    feature whose polygon contains the given coordinate.

    Args:
        lon:          Longitude to test.
        lat:          Latitude  to test.
        ac_features:  List of GeoJSON Feature dicts.

    Returns:
        The AC_NAME string of the matched feature, or None.
    """
    for feature in ac_features:
        geometry   = feature.get("geometry", {})
        properties = feature.get("properties", {})
        ac_name    = properties.get("AC_NAME", "")

        try:
            if point_in_polygon(lon=lon, lat=lat, geometry=geometry):
                logger.debug("Matched AC: %r", ac_name)
                return ac_name
        except (ValueError, TypeError, ZeroDivisionError) as exc:
            logger.warning("Skipping malformed AC %r: %s", ac_name, exc)

    return None


def _ac_name_to_pc(ac_name: str) -> str:
    """
    Map an Assembly Constituency name to its Parliamentary Constituency.

    Uses the inverted ECI delimitation table. Falls back to "Unknown" if
    the AC name is not present in the mapping (should not happen for valid
    Bangalore data).

    Args:
        ac_name: The AC_NAME value from the matched GeoJSON feature.

    Returns:
        The full Parliamentary Constituency name (with ECI number suffix).
    """
    pc = _AC_NAME_TO_PC.get(ac_name.strip())
    if pc is None:
        logger.warning("AC %r not found in AC→PC mapping; defaulting to Unknown.", ac_name)
        return "Unknown"
    return pc


def _normalise_ac_name(ac_name: str) -> str:
    """
    Strip ECI administrative suffixes so the cleaned name matches
    the keys used in ac_data.json.

    The raw GeoJSON stores reserved-constituency ACs with a "(SC)"
    suffix (e.g. "Anekal(SC)", "Nelamangala(SC)").  The data file
    uses the common name without that suffix ("Anekal", "Nelamangala").

    Args:
        ac_name: Raw AC_NAME string from the GeoJSON feature.

    Returns:
        Cleaned AC name suitable for ac_data.json key lookup.
    """
    return ac_name.replace("(SC)", "").replace("(ST)", "").strip()


def _get_mla_data(ac_name: str, store: DataStore) -> dict:
    """
    Retrieve MLA metadata for a given Assembly Constituency name.

    Lookup strategy (in order):
      1. Exact key match  (handles names that are already clean)
      2. Normalised match (strips "(SC)" / "(ST)" suffix — the GeoJSON
         includes these but ac_data.json typically does not)
      3. Case-insensitive scan of all keys in store.ac_data (last resort)

    Args:
        ac_name: The AC_NAME value from the matched GeoJSON feature.
        store:   The loaded DataStore.

    Returns:
        MLA metadata dict, or a placeholder dict if no record found.
    """
    # 1. Exact match
    data = store.ac_data.get(ac_name)
    if data is not None:
        return data

    # 2. Normalised name (strip SC/ST suffix)
    clean = _normalise_ac_name(ac_name)
    data = store.ac_data.get(clean)
    if data is not None:
        logger.debug("MLA data for %r found under normalised key %r.", ac_name, clean)
        return data

    # 3. Case-insensitive fallback scan
    lower = clean.lower()
    for key, val in store.ac_data.items():
        if key.lower() == lower:
            logger.debug("MLA data for %r found via case-insensitive scan: %r.", ac_name, key)
            return val

    logger.warning("No MLA data for AC %r (also tried %r).", ac_name, clean)
    return {
        "name": "Data not available",
        "party": "N/A",
        "constituency": clean or ac_name,
        "contact": None,
        "email": None,
    }


def _get_mp_data(pc_name: str, store: DataStore) -> dict:
    """
    Retrieve MP metadata for a given Parliamentary Constituency name.

    Lookup strategy (in order):
      1. Exact key match
      2. Case-insensitive scan of all keys in store.pc_data

    The case-insensitive fallback handles any whitespace or capitalisation
    differences between the ECI delimitation table and pc_data.json.

    Args:
        pc_name: The short PC name derived from _PC_DISPLAY_NAMES.
        store:   The loaded DataStore.

    Returns:
        MP metadata dict, or a placeholder dict if no record found.
    """
    # 1. Exact match
    data = store.pc_data.get(pc_name)
    if data is not None:
        return data

    # 2. Case-insensitive scan
    lower = pc_name.lower().strip()
    for key, val in store.pc_data.items():
        if key.lower().strip() == lower:
            logger.debug("MP data for %r found via case-insensitive scan: %r.", pc_name, key)
            return val

    logger.warning("No MP data for PC %r.", pc_name)
    return {
        "name": "Data not available",
        "party": "N/A",
        "constituency": pc_name,
        "contact": None,
        "email": None,
        "office_address": None,
    }