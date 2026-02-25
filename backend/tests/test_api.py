"""
test_api.py — Integration tests for the FastAPI routes defined in main.py.

ROOT CAUSE OF ORIGINAL FAILURES
================================
FastAPI's `lifespan` context manager runs *inside* TestClient.__enter__,
which means patch.object(main_module, "data_store", fake_store) applied
BEFORE TestClient(...).__enter__ is immediately overwritten by the real
load_all_data() call inside the lifespan.

FIX
===
Instead of patching `data_store` directly, we patch `app.main.load_all_data`
(the function the lifespan calls) to return whatever DataStore we want.
For "no store" / 503 tests we patch it to return None and also patch
`app.main.data_store` to remain None after lifespan setup.

Coverage:
    GET /                             — root health check
    GET /health                       — detailed health check, 503 when no store
    GET /api/v1/lookup                — happy path, 404 outside boundary,
                                        503 when no store, 422 param validation
    GET /api/v1/constituencies        — list endpoint, 503 when no store
    GET /api/v1/constituencies/geojson/{ac_name}  — GeoJSON, 404, 503
"""

from __future__ import annotations

from contextlib import contextmanager
from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient

import app.main as main_module
from app.loader import DataStore
from app.main import app


# ── Helpers ───────────────────────────────────────────────────────────────────

@contextmanager
def _client_with_data_store(store: DataStore | None):
    """
    Context manager that builds a TestClient whose lifespan-loaded
    data_store is exactly `store`.

    Strategy: patch `load_all_data` so the lifespan populates
    `main_module.data_store` with our controlled value, then *also*
    force-set the module-level variable after lifespan runs (belt + braces).
    """
    # If store is None we want the app to behave as if data was never loaded.
    return_value = store if store is not None else DataStore()

    with patch("app.main.load_all_data", return_value=return_value):
        with TestClient(app, raise_server_exceptions=True) as client:
            # After lifespan has run, force the module variable to our value.
            # This handles any code path that reads `data_store` directly.
            main_module.data_store = store
            yield client


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def client_with_store(fake_store) -> TestClient:
    """
    TestClient whose lifespan loads fake_store (1 AC, 1 MLA, 1 MP).
    The fake_store square polygon covers MG Road (12.9716, 77.5946)
    but NOT coordinates like (13.19, 77.89).
    """
    with _client_with_data_store(fake_store) as client:
        yield client


@pytest.fixture
def client_no_store() -> TestClient:
    """
    TestClient where data_store is None after startup,
    simulating an uninitialised / failed-to-load app.
    """
    with _client_with_data_store(None) as client:
        yield client


# ════════════════════════════════════════════════════════════════
#  GET /
# ════════════════════════════════════════════════════════════════

class TestRootEndpoint:
    def test_returns_200(self, client_with_store):
        r = client_with_store.get("/")
        assert r.status_code == 200

    def test_returns_ok_status(self, client_with_store):
        r = client_with_store.get("/")
        assert r.json()["status"] == "ok"

    def test_message_field_present(self, client_with_store):
        r = client_with_store.get("/")
        assert "message" in r.json()


# ════════════════════════════════════════════════════════════════
#  GET /health
# ════════════════════════════════════════════════════════════════

class TestHealthEndpoint:
    def test_returns_200_with_store(self, client_with_store):
        r = client_with_store.get("/health")
        assert r.status_code == 200

    def test_response_has_ac_count_key(self, client_with_store):
        r = client_with_store.get("/health")
        assert "ac_constituencies_loaded" in r.json()

    def test_response_has_pc_count_key(self, client_with_store):
        r = client_with_store.get("/health")
        assert "pc_constituencies_loaded" in r.json()

    def test_ac_count_matches_fake_store(self, client_with_store):
        """
        fake_store contains exactly 1 AC feature.
        The patch ensures lifespan uses fake_store, so this must be 1.
        """
        r = client_with_store.get("/health")
        assert r.json()["ac_constituencies_loaded"] == 1

    def test_pc_count_matches_fake_store(self, client_with_store):
        """
        fake_store has 0 pc_features (pc_data has 1 entry, but
        pc_features list is empty — health reports len(pc_data)).
        """
        r = client_with_store.get("/health")
        # pc_data has 1 entry ("Bangalore Central")
        assert r.json()["pc_constituencies_loaded"] == 1

    def test_returns_503_without_store(self, client_no_store):
        """When data_store is None the endpoint must return 503."""
        r = client_no_store.get("/health")
        assert r.status_code == 503

    def test_503_detail_present(self, client_no_store):
        r = client_no_store.get("/health")
        assert "detail" in r.json()


# ════════════════════════════════════════════════════════════════
#  GET /api/v1/lookup  — happy path
# ════════════════════════════════════════════════════════════════

class TestLookupHappyPath:
    """Tests for valid coordinates that fall inside fake_store's polygon."""

    def test_valid_inside_boundary_returns_200(self, client_with_store):
        r = client_with_store.get("/api/v1/lookup?lat=12.9716&lon=77.5946")
        assert r.status_code == 200

    def test_response_echoes_latitude(self, client_with_store):
        r = client_with_store.get("/api/v1/lookup?lat=12.9716&lon=77.5946")
        assert r.json()["latitude"] == pytest.approx(12.9716)

    def test_response_echoes_longitude(self, client_with_store):
        r = client_with_store.get("/api/v1/lookup?lat=12.9716&lon=77.5946")
        assert r.json()["longitude"] == pytest.approx(77.5946)

    def test_response_has_mla_key(self, client_with_store):
        r = client_with_store.get("/api/v1/lookup?lat=12.9716&lon=77.5946")
        assert "mla" in r.json()

    def test_response_has_mp_key(self, client_with_store):
        r = client_with_store.get("/api/v1/lookup?lat=12.9716&lon=77.5946")
        assert "mp" in r.json()

    def test_mla_name_from_fake_store(self, client_with_store):
        r = client_with_store.get("/api/v1/lookup?lat=12.9716&lon=77.5946")
        assert r.json()["mla"]["name"] == "Rizwan Arshad"

    def test_mp_name_from_fake_store(self, client_with_store):
        r = client_with_store.get("/api/v1/lookup?lat=12.9716&lon=77.5946")
        assert r.json()["mp"]["name"] == "PC Mohan"

    def test_mla_party_present(self, client_with_store):
        r = client_with_store.get("/api/v1/lookup?lat=12.9716&lon=77.5946")
        assert r.json()["mla"]["party"] == "INC"

    def test_mp_party_present(self, client_with_store):
        r = client_with_store.get("/api/v1/lookup?lat=12.9716&lon=77.5946")
        assert r.json()["mp"]["party"] == "BJP"


# ════════════════════════════════════════════════════════════════
#  GET /api/v1/lookup  — 404 outside boundary
# ════════════════════════════════════════════════════════════════

class TestLookupOutsideBoundary:
    """
    fake_store's polygon covers lon 77.50–77.70, lat 12.90–13.05.
    Any point outside that square must return 404.
    """

    OUTSIDE_COORDS = [
        # Clearly outside the fake square
        ("lat=12.80&lon=77.60",  "south of square"),
        ("lat=13.10&lon=77.60",  "north of square"),
        ("lat=12.95&lon=77.45",  "west of square"),
        ("lat=12.95&lon=77.75",  "east of square"),
    ]

    @pytest.mark.parametrize("params,description", OUTSIDE_COORDS)
    def test_outside_returns_404(self, client_with_store, params, description):
        r = client_with_store.get(f"/api/v1/lookup?{params}")
        assert r.status_code == 404, f"Expected 404 for {description}, got {r.status_code}"

    def test_404_detail_mentions_representatives(self, client_with_store):
        r = client_with_store.get("/api/v1/lookup?lat=12.80&lon=77.60")
        assert r.status_code == 404
        detail = r.json().get("detail", "")
        assert "No representatives" in detail or "no representatives" in detail.lower()

    def test_404_detail_is_string(self, client_with_store):
        r = client_with_store.get("/api/v1/lookup?lat=12.80&lon=77.60")
        assert isinstance(r.json()["detail"], str)


# ════════════════════════════════════════════════════════════════
#  GET /api/v1/lookup  — 503 when no store
# ════════════════════════════════════════════════════════════════

class TestLookupNoStore:
    def test_returns_503(self, client_no_store):
        r = client_no_store.get("/api/v1/lookup?lat=12.9716&lon=77.5946")
        assert r.status_code == 503

    def test_503_detail_present(self, client_no_store):
        r = client_no_store.get("/api/v1/lookup?lat=12.9716&lon=77.5946")
        assert "detail" in r.json()


# ════════════════════════════════════════════════════════════════
#  GET /api/v1/lookup  — 422 parameter validation
# ════════════════════════════════════════════════════════════════

class TestLookupValidation:
    """FastAPI should reject malformed or out-of-range parameters with 422."""

    def test_missing_lat_returns_422(self, client_with_store):
        r = client_with_store.get("/api/v1/lookup?lon=77.5946")
        assert r.status_code == 422

    def test_missing_lon_returns_422(self, client_with_store):
        r = client_with_store.get("/api/v1/lookup?lat=12.9716")
        assert r.status_code == 422

    def test_missing_both_returns_422(self, client_with_store):
        r = client_with_store.get("/api/v1/lookup")
        assert r.status_code == 422

    def test_lat_below_minimum_returns_422(self, client_with_store):
        r = client_with_store.get("/api/v1/lookup?lat=12.69&lon=77.5946")
        assert r.status_code == 422

    def test_lat_above_maximum_returns_422(self, client_with_store):
        r = client_with_store.get("/api/v1/lookup?lat=13.21&lon=77.5946")
        assert r.status_code == 422

    def test_lon_below_minimum_returns_422(self, client_with_store):
        r = client_with_store.get("/api/v1/lookup?lat=12.9716&lon=77.29")
        assert r.status_code == 422

    def test_lon_above_maximum_returns_422(self, client_with_store):
        r = client_with_store.get("/api/v1/lookup?lat=12.9716&lon=77.91")
        assert r.status_code == 422

    def test_non_numeric_lat_returns_422(self, client_with_store):
        r = client_with_store.get("/api/v1/lookup?lat=abc&lon=77.5946")
        assert r.status_code == 422

    def test_non_numeric_lon_returns_422(self, client_with_store):
        r = client_with_store.get("/api/v1/lookup?lat=12.9716&lon=xyz")
        assert r.status_code == 422

    def test_empty_lat_returns_422(self, client_with_store):
        r = client_with_store.get("/api/v1/lookup?lat=&lon=77.5946")
        assert r.status_code == 422

    def test_boundary_lat_minimum_valid(self, client_with_store):
        """Exactly at lower bound (12.7) should not be rejected by validation."""
        r = client_with_store.get("/api/v1/lookup?lat=12.7&lon=77.5946")
        # May be 200 or 404 depending on geometry — but NOT 422
        assert r.status_code != 422

    def test_boundary_lat_maximum_valid(self, client_with_store):
        """Exactly at upper bound (13.2) should not be rejected by validation."""
        r = client_with_store.get("/api/v1/lookup?lat=13.2&lon=77.5946")
        assert r.status_code != 422


# ════════════════════════════════════════════════════════════════
#  GET /api/v1/constituencies
# ════════════════════════════════════════════════════════════════

class TestConstituenciesEndpoint:
    def test_returns_200(self, client_with_store):
        r = client_with_store.get("/api/v1/constituencies")
        assert r.status_code == 200

    def test_has_assembly_constituencies_key(self, client_with_store):
        r = client_with_store.get("/api/v1/constituencies")
        assert "assembly_constituencies" in r.json()

    def test_has_parliamentary_constituencies_key(self, client_with_store):
        r = client_with_store.get("/api/v1/constituencies")
        assert "parliamentary_constituencies" in r.json()

    def test_shivajinagar_in_assembly_list(self, client_with_store):
        r = client_with_store.get("/api/v1/constituencies")
        assert "Shivajinagar" in r.json()["assembly_constituencies"]

    def test_assembly_list_is_sorted(self, client_with_store):
        r = client_with_store.get("/api/v1/constituencies")
        lst = r.json()["assembly_constituencies"]
        assert lst == sorted(lst)

    def test_returns_503_without_store(self, client_no_store):
        r = client_no_store.get("/api/v1/constituencies")
        assert r.status_code == 503


# ════════════════════════════════════════════════════════════════
#  GET /api/v1/constituencies/geojson/{ac_name}
# ════════════════════════════════════════════════════════════════

class TestGeoJSONEndpoint:
    def test_valid_ac_returns_200(self, client_with_store):
        r = client_with_store.get("/api/v1/constituencies/geojson/Shivajinagar")
        assert r.status_code == 200

    def test_response_is_feature_collection(self, client_with_store):
        r = client_with_store.get("/api/v1/constituencies/geojson/Shivajinagar")
        assert r.json()["type"] == "FeatureCollection"

    def test_response_contains_exactly_one_feature(self, client_with_store):
        r = client_with_store.get("/api/v1/constituencies/geojson/Shivajinagar")
        assert len(r.json()["features"]) == 1

    def test_feature_has_geometry(self, client_with_store):
        r = client_with_store.get("/api/v1/constituencies/geojson/Shivajinagar")
        feature = r.json()["features"][0]
        assert "geometry" in feature

    def test_feature_has_ac_name_property(self, client_with_store):
        r = client_with_store.get("/api/v1/constituencies/geojson/Shivajinagar")
        props = r.json()["features"][0]["properties"]
        assert props.get("AC_NAME") == "Shivajinagar"

    def test_case_insensitive_lookup(self, client_with_store):
        """AC name lookup should be case-insensitive."""
        r = client_with_store.get("/api/v1/constituencies/geojson/shivajinagar")
        assert r.status_code == 200

    def test_mixed_case_lookup(self, client_with_store):
        r = client_with_store.get("/api/v1/constituencies/geojson/SHIVAJINAGAR")
        assert r.status_code == 200

    def test_unknown_ac_returns_404(self, client_with_store):
        r = client_with_store.get("/api/v1/constituencies/geojson/NonExistentConstituency")
        assert r.status_code == 404

    def test_404_detail_mentions_constituency_name(self, client_with_store):
        r = client_with_store.get("/api/v1/constituencies/geojson/FakeAC")
        assert "FakeAC" in r.json()["detail"]

    def test_returns_503_without_store(self, client_no_store):
        r = client_no_store.get("/api/v1/constituencies/geojson/Shivajinagar")
        assert r.status_code == 503