# Geo Rep Lookup — Bangalore

> Instantly find your **MLA** and **MP** by clicking anywhere on Bangalore's map,
> or by typing a constituency name in the search bar.

![Python](https://img.shields.io/badge/Python-3.10+-3776ab?style=flat-square&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.109-009688?style=flat-square&logo=fastapi&logoColor=white)
![Tests](https://img.shields.io/badge/tests-80%20passing-2dd4a0?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-lightgrey?style=flat-square)

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Features](#features)
3. [How It Works](#how-it-works)
4. [Project Structure](#project-structure)
5. [Local Setup](#local-setup)
6. [Running the Backend](#running-the-backend)
7. [Running the Frontend](#running-the-frontend)
8. [Running Tests](#running-tests)
9. [API Reference](#api-reference)
10. [Example curl Requests](#example-curl-requests)
11. [Raycasting Algorithm](#raycasting-algorithm)
12. [Edge Cases Handled](#edge-cases-handled)
13. [Future Improvements](#future-improvements)

---

## Project Overview

Geo Rep Lookup is a full-stack civic data tool for Bangalore. A user clicks any point on an interactive map — or searches a constituency name — and the app returns their elected representatives: the **MLA** (Member of Legislative Assembly) and **MP** (Member of Parliament), along with party affiliation and contact details.

The core technical piece is a **pure-Python raycasting point-in-polygon algorithm** with no geospatial library dependency. It tests a clicked coordinate against all 37 Assembly Constituency boundaries in under a millisecond.

**Stack:**

| Layer | Technology |
|---|---|
| Backend | Python 3.10+, FastAPI, Uvicorn |
| Algorithm | Custom raycasting (`raycast.py`) |
| Frontend | Vanilla HTML / CSS / JavaScript — no framework, no build step |
| Map | Leaflet.js 1.9.4 + OpenStreetMap tiles |
| Testing | pytest, httpx, pytest-asyncio |
| Data | ECI 2008 delimitation · KA Assembly 2023 · Lok Sabha 2024 |

---

## Features

### Backend

**Raycasting point-in-polygon algorithm**
- Implements the W. Randolph Franklin ray-crossing method in pure Python
- Handles `Polygon`, `MultiPolygon`, and polygons with interior holes
- All 37 AC boundaries tested per request with no external geospatial library
- Returns in under 1 ms for typical Bangalore coordinates

**FastAPI application**
- Five documented REST endpoints with automatic Swagger UI at `/docs`
- CORS middleware configured for all local origins
- DataStore singleton loaded once at startup via `lifespan` — zero disk I/O per request
- FastAPI query parameter validation (`ge`/`le`) rejects out-of-range coordinates with 422 before business logic runs
- Structured error responses: 404 outside boundary, 503 data not loaded, 422 invalid params

**AC → PC mapping**
- Hardcoded ECI 2008 delimitation table maps all 37 ACs to their Parliamentary Constituency
- More reliable than polygon intersection against the PC GeoJSON (which has overlapping boundary artefacts)
- O(1) lookup via inverted dict

**GeoJSON endpoint**
- Serves individual AC polygon geometry for map boundary highlighting
- Case-insensitive name lookup (`shivajinagar`, `Shivajinagar`, `SHIVAJINAGAR` all resolve)

### Frontend

**Interactive map**
- Click anywhere in Bangalore to look up the representative for that point
- Animated teardrop pin placed on click
- Matched AC boundary drawn on the map after every successful lookup
- Reset button restores default view

**Search with real-time suggestions**
- Partial, case-insensitive substring match against all 37 AC names
- Dropdown appears on every keystroke with no debounce delay
- Matching substring highlighted in accent colour inside each suggestion
- Explicit "No match for …" row shown when nothing matches — never silently disappears
- Up to 8 suggestions shown simultaneously

**Smart search resolution**
- Exact match → resolves immediately
- One partial match → resolves silently (e.g. "mallesh" → Malleshwaram)
- Multiple partial matches → picks first, informs user via toast
- Zero matches → shows informative error toast

**Recent searches**
- Stored in `localStorage`, restored across sessions
- Individual remove buttons on each item
- Cleared from view while the user is actively typing

**My Location**
- Uses the browser Geolocation API
- Distinct error messages per error code (denied / unavailable / timed out)

**Dark / Light mode**
- Detects OS preference on first load
- Toggle persists in `localStorage`
- All surfaces transition in 340 ms with no flash

**Result cards**
- Party-coloured badges (BJP orange, INC blue, JD green, AAP sky)
- Contact information rows: phone, email, office address
- Copy button (morphs to "Copied ✓" for 2.5 s)
- Map-focus button (flies to the matched AC)
- Share button (Web Share API with clipboard fallback)

**4-state side panel**
- Empty (default) → Loading skeleton → Classified error → Results
- Error panel classifies the failure: API down (shows startup command), timeout, outside boundary, data missing
- Retry button re-runs the last lookup

**List view**
- Full sortable table of all 37 ACs with their Parliamentary Constituency
- Loaded lazily on first tab switch — no initial request
- "Look up →" button in each row switches to map view and triggers a lookup

**Accessibility**
- All interactive elements have `aria-label`
- `/` keyboard shortcut focuses the search input from anywhere
- Arrow keys navigate the suggestion dropdown; Enter confirms; Escape dismisses
- `aria-expanded`, `aria-selected`, `aria-busy` attributes maintained throughout
- Focus rings visible, high-contrast mode supported

**Performance feedback**
- 2 px animated progress bar tracks request lifecycle (stalls at 85%, snaps to 100%)
- "Found in 0.32s" shown in results meta bar
- Toast notification system (non-blocking, auto-dismissing)

### Tests

**80 tests across 4 files** covering every layer of the stack. All tests use controlled fixtures and never touch real GeoJSON files.

| File | Classes | Tests | Coverage |
|---|---|---|---|
| `test_raycast.py` | 5 | 25 | `_is_point_in_ring`, `point_in_polygon` for simple polygons, holes, MultiPolygon, all edge cases |
| `test_services.py` | 5 | 30 | AC→PC map completeness, the Bangalore South AC/PC name collision invariant, all five helper functions |
| `test_api.py` | 8 | 25 | All 5 routes — 200 / 404 / 503 / 422, parameter validation, case-insensitive GeoJSON, 503 when `data_store` is None |
| `test_loader.py` | 3 | 16 | Missing files, malformed JSON, empty collections, correct return types |
| **Total** | **21** | **80** | |

Fixture strategy: `load_all_data` is patched at the lifespan level (not `data_store` directly) so FastAPI's `lifespan` context manager cannot overwrite injected test data.

---

## How It Works

```
User clicks map at (lat, lon)
        │
        ▼
GET /api/v1/lookup?lat=12.97&lon=77.59
        │
        ▼
raycast.py iterates all 37 AC GeoJSON features
  For each polygon: cast a horizontal ray from (lon, lat) eastward
  Count boundary crossings — odd = inside, even = outside
        │
        ▼
Matched AC name (e.g. "Shivajinagar")
→ services.py looks it up in the ECI AC→PC table
→ "Bangalore Central (25)"
        │
        ▼
MLA data ← ac_data.json keyed by AC name
MP data  ← pc_data.json keyed by PC display name
        │
        ▼
Response:
{
  "latitude": 12.9716,
  "longitude": 77.5946,
  "mla": { "name": "Rizwan Arshad", "party": "INC", ... },
  "mp":  { "name": "PC Mohan",      "party": "BJP", ... }
}
        │
        ▼
Frontend renders result cards
AC boundary drawn on map via GET /api/v1/constituencies/geojson/Shivajinagar
```

---

## Project Structure

```
geo-rep-lookup/
│
├── README.md
│
├── frontend/                        No build step — serve with any static server
│   ├── index.html                   Semantic shell; 4 panel states; ARIA markup
│   ├── styles.css                   CSS custom-property design system; dark/light themes
│   └── app.js                       All frontend logic: search, map, API, error handling
│
└── backend/
    ├── pytest.ini                   Test config: testpaths, addopts, markers
    ├── requirements.txt             Runtime + test dependencies (pinned)
    │
    ├── app/
    │   ├── __init__.py              Package init; version string
    │   ├── main.py                  FastAPI app, lifespan, CORS, all 5 routes
    │   ├── loader.py                DataStore dataclass; GeoJSON + JSON loaders
    │   ├── raycast.py               point_in_polygon; _is_point_in_ring; _test_polygon
    │   └── services.py              find_representatives; AC→PC map; helper functions
    │
    ├── data/
    │   ├── ac_bangalore.geojson     37 AC polygon boundaries (ECI 2008)
    │   ├── pc_bangalore.geojson     4 PC polygon boundaries (loaded, not used for lookup)
    │   ├── ac_data.json             MLA names, parties, contacts — keyed by AC_NAME
    │   └── pc_data.json             MP names, parties, contacts — keyed by PC display name
    │
    └── tests/
        ├── __init__.py
        ├── conftest.py              Fixtures: fake_store, geometry builders, data records
        ├── test_raycast.py          25 tests — algorithm correctness
        ├── test_services.py         30 tests — business logic + data integrity
        ├── test_api.py              25 tests — HTTP routes, status codes, validation
        └── test_loader.py           16 tests — file loading, error resilience
```

---

## Local Setup

**Requirements:** Python 3.10+, any modern browser.

```bash
git clone https://github.com/yasmeen-taj111/geo-rep-lookup.git
cd geo-rep-lookup
```

---

## Running the Backend

```bash
cd backend

# Create and activate virtual environment
python3 -m venv venv
source venv/bin/activate        # macOS / Linux
# venv\Scripts\activate         # Windows

# Install dependencies
pip install -r requirements.txt

# Start the development server
uvicorn app.main:app --reload
```

Expected startup output:

```
INFO: Loaded 37 AC constituencies
INFO: Loaded 4 PC constituencies
INFO: Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
```

Interactive API docs are at `http://127.0.0.1:8000/docs`.

---

## Running the Frontend

In a separate terminal (keep the backend running):

```bash
cd frontend
python3 -m http.server 3000
```

Open `http://localhost:3000`.

Any static file server works. VS Code Live Server, `npx serve`, nginx — all fine.
The frontend is plain HTML/CSS/JS with no build step.

---

## Running Tests

All commands run from inside `backend/` with the virtual environment active.

```bash
# Run all 80 tests
pytest

# Verbose — prints every test name
pytest -v

# Single file
pytest tests/test_raycast.py
pytest tests/test_services.py
pytest tests/test_api.py
pytest tests/test_loader.py

# Single class
pytest tests/test_raycast.py::TestPolygonWithHole
pytest tests/test_api.py::TestLookupHappyPath

# Single test method
pytest tests/test_services.py::TestACToPCMap::test_all_37_ac_names_are_mapped

# Keyword filter
pytest -k "503 or 404"
pytest -k "TestEdgeCases"

# Stop at first failure
pytest -x

# Full tracebacks
pytest --tb=long

# Show the 5 slowest tests
pytest --durations=5
```

**Note on inline comments in terminal commands:** The shell treats `#` as a comment
delimiter, so `pytest -v # verbose` works (the comment is stripped before execution).
The error `file or directory not found: #` only occurs when pasting multi-line blocks
where a bare `# comment` line is parsed as a command argument. Always write comments
on their own line, or use separate commands.

---

## API Reference

**Base URL:** `http://localhost:8000`

All responses are JSON. Errors follow FastAPI's standard `{"detail": "..."}` envelope.

### Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Root health check |
| `GET` | `/health` | Count of loaded AC and PC constituencies |
| `GET` | `/api/v1/lookup` | Find MLA and MP for a coordinate |
| `GET` | `/api/v1/constituencies` | List all AC and PC names |
| `GET` | `/api/v1/constituencies/geojson/{ac_name}` | GeoJSON feature for one AC |
| `GET` | `/docs` | Swagger UI (auto-generated) |

---

### `GET /api/v1/lookup`

**Query parameters:**

| Param | Type | Required | Range | Description |
|---|---|---|---|---|
| `lat` | float | Yes | 12.7 – 13.2 | Latitude of the point |
| `lon` | float | Yes | 77.3 – 77.9 | Longitude of the point |

**200 — Success:**

```json
{
  "latitude": 12.9716,
  "longitude": 77.5946,
  "mla": {
    "name": "Rizwan Arshad",
    "party": "INC",
    "constituency": "Shivajinagar",
    "constituency_number": "157",
    "contact": "+91-80-22866530",
    "email": "rizwanarshad.mla@karnataka.gov.in"
  },
  "mp": {
    "name": "PC Mohan",
    "party": "BJP",
    "constituency": "Bangalore Central",
    "constituency_number": "25",
    "contact": "+91-11-23034660",
    "email": "pcmohan@sansad.nic.in",
    "office_address": "335-C, Parliament House Annexe, New Delhi - 110001"
  }
}
```

**Error responses:**

| Status | Condition |
|---|---|
| `404 Not Found` | Point outside all 37 AC polygon boundaries |
| `422 Unprocessable Entity` | Missing param, non-numeric, or out of range |
| `503 Service Unavailable` | Data store not loaded (startup failure) |

---

### `GET /health`

```json
{
  "status": "ok",
  "ac_constituencies_loaded": 37,
  "pc_constituencies_loaded": 4
}
```

Returns `503` if `data_store` is `None`.

---

### `GET /api/v1/constituencies`

```json
{
  "assembly_constituencies": ["Anekal", "B.T.M Layout", "Bangalore South", "..."],
  "parliamentary_constituencies": ["Bangalore Central", "Bangalore North", "..."]
}
```

Both lists are sorted alphabetically.

---

### `GET /api/v1/constituencies/geojson/{ac_name}`

Returns a GeoJSON `FeatureCollection` with a single `Feature` for the named AC.
Lookup is **case-insensitive**. Returns `404` with the AC name in the detail message
if no match is found.

---

## Example curl Requests

```bash
# MG Road — Shivajinagar AC, Bangalore Central PC
curl "http://localhost:8000/api/v1/lookup?lat=12.9716&lon=77.5946"

# Koramangala — B.T.M Layout AC, Bangalore South PC
curl "http://localhost:8000/api/v1/lookup?lat=12.9352&lon=77.6245"

# Malleshwaram — Malleshwaram AC, Bangalore North PC
curl "http://localhost:8000/api/v1/lookup?lat=13.0000&lon=77.5700"

# Whitefield — Mahadevapura AC, Bangalore Central PC
curl "http://localhost:8000/api/v1/lookup?lat=12.9700&lon=77.7500"

# Yelahanka — Yelahanka AC, Bangalore North PC
curl "http://localhost:8000/api/v1/lookup?lat=13.1000&lon=77.5940"

# Electronic City — "Bangalore South" AC (Rural PC — the naming collision)
curl "http://localhost:8000/api/v1/lookup?lat=12.8450&lon=77.6600"

# Health check
curl "http://localhost:8000/health"

# List all constituency names
curl "http://localhost:8000/api/v1/constituencies"

# GeoJSON for Shivajinagar (case-insensitive)
curl "http://localhost:8000/api/v1/constituencies/geojson/shivajinagar"

# ── Error cases ──────────────────────────────────────────────────

# 404 — south of all boundaries
curl "http://localhost:8000/api/v1/lookup?lat=12.72&lon=77.35"

# 422 — lat below minimum (12.7)
curl "http://localhost:8000/api/v1/lookup?lat=10.00&lon=77.5946"

# 422 — missing lon
curl "http://localhost:8000/api/v1/lookup?lat=12.9716"

# 422 — non-numeric
curl "http://localhost:8000/api/v1/lookup?lat=abc&lon=77.5946"
```

**Test coordinate reference:**

| Landmark | lat | lon | Assembly Constituency | Parliamentary Constituency |
|---|---|---|---|---|
| MG Road | 12.9716 | 77.5946 | Shivajinagar | Bangalore Central |
| Koramangala | 12.9352 | 77.6245 | B.T.M Layout | Bangalore South |
| Malleshwaram | 13.0000 | 77.5700 | Malleshwaram | Bangalore North |
| Whitefield | 12.9700 | 77.7500 | Mahadevapura | Bangalore Central |
| Yelahanka | 13.1000 | 77.5940 | Yelahanka | Bangalore North |
| Jayanagar | 12.9300 | 77.5850 | Jayanagar | Bangalore South |
| Electronic City | 12.8450 | 77.6600 | Bangalore South (AC) | Bangalore Rural |

---

## Raycasting Algorithm

Implemented in `backend/app/raycast.py` with no external library dependency.

### Core idea

Cast an imaginary horizontal ray from the test point eastward to infinity.
Count how many times the ray crosses a polygon edge.
Odd crossings = inside. Even crossings (including zero) = outside.

```
Point P ──────────────────────────► (ray to +∞)
              ╱           ╲
        cross 1         cross 2       count = 2  →  outside

Point P ────────────────► (ray to +∞)
              ╱
        cross 1                       count = 1  →  inside
```

### Implementation detail (`_is_point_in_ring`)

```python
inside = False
j = len(ring) - 1

for i, (xi, yi) in enumerate(ring):
    xj, yj = ring[j]

    # Does this edge straddle the test latitude?
    if (yi > lat) != (yj > lat):

        # Where does the edge cross the test latitude?
        x_intersect = (xj - xi) * (lat - yi) / (yj - yi) + xi

        # Is the crossing to the right of the test point?
        if lon < x_intersect:
            inside = not inside   # flip on each crossing

    j = i

return inside
```

The strict `>` comparison (not `>=`) handles the case where the test point
sits exactly on a horizontal edge — it assigns the point consistently
to one side without double-counting.

### Geometry types supported

| GeoJSON type | Handling |
|---|---|
| `Polygon` | Tests the exterior ring, then short-circuits `False` if the point is inside any interior hole ring |
| `MultiPolygon` | Tests each polygon independently; returns `True` on the first hit |

---

## Edge Cases Handled

### Algorithm level (`raycast.py`)

| Situation | Handling |
|---|---|
| Point on a polygon edge | Strict `>` comparison assigns it consistently to one side — no double-counting |
| Interior holes | Must be inside exterior ring AND outside all hole rings; any hole match returns `False` immediately |
| MultiPolygon | `any()` over `_test_polygon` calls — short-circuits on first match |
| Empty coordinate list | `if not rings: return False` guard in `_test_polygon` |
| Division by zero | Impossible: the straddling check `(yi > lat) != (yj > lat)` guarantees `yj - yi ≠ 0` before division |
| Unsupported geometry type | `raise ValueError` with the type name; caller catches it, logs a warning, and skips the feature |
| Float precision | Not required; W. R. Franklin's algorithm is numerically stable at geographic coordinate magnitudes |

### Service level (`services.py`)

| Situation | Handling |
|---|---|
| Point outside all 37 boundaries | `_find_ac` returns `None` → `find_representatives` returns `None` → API returns 404 |
| AC name not in `ac_data.json` | `_get_mla_data` returns a placeholder with `"name": "Data not available"` |
| AC name not in ECI mapping | `_ac_name_to_pc` logs a warning and returns `"Unknown"` |
| Malformed GeoJSON geometry | `ValueError`, `TypeError`, `ZeroDivisionError` caught per-feature; that feature is skipped; iteration continues |

### API level (`main.py`)

| Situation | Handling |
|---|---|
| `lat` or `lon` missing | FastAPI returns 422 automatically |
| Non-numeric parameter | FastAPI returns 422 automatically |
| `lat` outside 12.7 – 13.2 | FastAPI `ge` / `le` constraint → 422 |
| `lon` outside 77.3 – 77.9 | FastAPI `ge` / `le` constraint → 422 |
| Data store not loaded at startup | All routes check `if data_store is None` → 503 |

### Frontend (`app.js`)

| Situation | Handling |
|---|---|
| Backend not running | `TypeError` from `fetch` classified as `"api-down"` → error panel shows startup command |
| Request timeout (>12 s) | `AbortController` fires after 12 000 ms → `AbortError` → "Request timed out" message |
| Outside boundary | HTTP 404 → classified as `"outside"` → amber panel, distinct message |
| Geolocation denied | `GeolocationPositionError.code === 1` → specific "access denied" toast |
| Geolocation unavailable | Code 2 → "unavailable" toast |
| Geolocation timeout | Code 3 → "timed out" toast |
| Partial search input + Enter | `handleSearchSubmit` tries partial match before failing — "mallesh" resolves to Malleshwaram |
| Clipboard API unavailable | `copyCardInfo` wraps in try/catch → "Clipboard access denied" toast |
| `localStorage` parse error | `getRecent()` catches JSON exceptions and returns `[]` |

---

## Future Improvements

These features are intentionally not yet implemented. They are tracked here so the
scope of what is and is not built remains clear.

**In-memory caching**
Add `functools.lru_cache` on `find_representatives` with coordinate rounding (4 decimal
places ≈ 11 m grid cells). Constituency boundaries do not change between elections,
so a cache hit avoids re-running raycasting entirely. Expected hit rate >90% for any
real traffic pattern.

**Redis caching**
Replace the in-process cache with Redis so cache state is shared across multiple
Gunicorn workers. Necessary once the app is deployed on a multi-core server with
several worker processes.

**AWS EC2 deployment**
- Run on a `t3.small` instance (2 vCPU, 2 GB RAM)
- Gunicorn with `UvicornWorker` (4 workers) for multi-core utilisation and automatic crash recovery
- Nginx as reverse proxy on port 80
- `systemd` service with `Restart=always`
- Elastic IP + domain name + HTTPS via Let's Encrypt

**New backend endpoint**
Add `GET /api/v1/lookup/by-name?ac=Malleshwaram` so the frontend can perform
a name-based lookup without maintaining a hardcoded coordinate map client-side.
The backend would compute a centroid from the polygon and perform the lookup.

**CI/CD**
GitHub Actions workflow: run `pytest` on every pull request, block merge on any
failure, and auto-deploy to EC2 on merge to `main`.

**Data completeness**
One AC currently has no MLA data record — it returns the "Data not available"
placeholder. This will be resolved by adding the missing record to `ac_data.json`
after verifying the correct data.

**Deep-link for coordinates**
Support `?lat=12.97&lon=77.59` in the URL so any looked-up location can be shared
as a permanent link, not just the constituency name.