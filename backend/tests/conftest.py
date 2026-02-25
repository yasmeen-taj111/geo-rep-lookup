"""
conftest.py — Shared pytest fixtures for the Geo-Representative Lookup test suite.

Provides:
    - Minimal fake DataStore instances so unit tests never touch the filesystem.
    - A pre-configured FastAPI TestClient for integration/API tests.
    - Sample representative data dicts matching the real ac_data.json schema.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.loader import DataStore
from app.main import app


# ── Representative data fixtures ──────────────────────────────────────────────

@pytest.fixture
def sample_mla_record() -> dict:
    """Minimal MLA record matching the ac_data.json schema."""
    return {
        "name": "Rizwan Arshad",
        "party": "INC",
        "constituency": "Shivajinagar",
        "constituency_number": "157",
        "contact": "+91-80-22866530",
        "email": "rizwanarshad.mla@karnataka.gov.in",
    }


@pytest.fixture
def sample_mp_record() -> dict:
    """Minimal MP record matching the pc_data.json schema."""
    return {
        "name": "PC Mohan",
        "party": "BJP",
        "constituency": "Bangalore Central",
        "constituency_number": "25",
        "contact": "+91-11-23034660",
        "email": "pcmohan@sansad.nic.in",
        "office_address": "335-C, Parliament House Annexe, New Delhi - 110001",
    }


# ── GeoJSON geometry fixtures ──────────────────────────────────────────────────

@pytest.fixture
def square_polygon_geometry() -> dict:
    """
    A simple square GeoJSON Polygon geometry centred on Bangalore (approx).
    Interior point: (77.5946, 12.9716) — MG Road.
    Exterior point: (0.0, 0.0).
    """
    return {
        "type": "Polygon",
        "coordinates": [
            [
                [77.50, 12.90],
                [77.70, 12.90],
                [77.70, 13.05],
                [77.50, 13.05],
                [77.50, 12.90],   # closed ring
            ]
        ],
    }


@pytest.fixture
def polygon_with_hole_geometry() -> dict:
    """
    GeoJSON Polygon with a hole: a large square with a smaller square cut out.
    Points tested:
        - Inside outer ring, outside hole  → True
        - Inside hole                      → False
    """
    outer = [
        [77.40, 12.80], [77.80, 12.80],
        [77.80, 13.10], [77.40, 13.10],
        [77.40, 12.80],
    ]
    hole = [
        [77.58, 12.96], [77.62, 12.96],
        [77.62, 13.00], [77.58, 13.00],
        [77.58, 12.96],
    ]
    return {"type": "Polygon", "coordinates": [outer, hole]}


@pytest.fixture
def multi_polygon_geometry() -> dict:
    """
    GeoJSON MultiPolygon with two non-overlapping squares.
    """
    square_a = [[[77.50, 12.90], [77.60, 12.90], [77.60, 13.00], [77.50, 13.00], [77.50, 12.90]]]
    square_b = [[[77.70, 12.90], [77.80, 12.90], [77.80, 13.00], [77.70, 13.00], [77.70, 12.90]]]
    return {"type": "MultiPolygon", "coordinates": [square_a, square_b]}


# ── DataStore fixture ─────────────────────────────────────────────────────────

@pytest.fixture
def fake_store(sample_mla_record, sample_mp_record, square_polygon_geometry) -> DataStore:
    """
    Minimal DataStore with one AC feature and one MLA + MP record.
    The AC polygon covers MG Road (12.9716, 77.5946).
    """
    ac_feature = {
        "type": "Feature",
        "properties": {"AC_NAME": "Shivajinagar", "DIST_NAME": "BANGALORE"},
        "geometry": square_polygon_geometry,
    }
    return DataStore(
        ac_features=[ac_feature],
        pc_features=[],
        ac_data={"Shivajinagar": sample_mla_record},
        pc_data={"Bangalore Central": sample_mp_record},
    )


# ── API TestClient fixture ────────────────────────────────────────────────────

@pytest.fixture
def client() -> TestClient:
    """FastAPI TestClient. The app's lifespan (data loading) is bypassed."""
    return TestClient(app, raise_server_exceptions=True)