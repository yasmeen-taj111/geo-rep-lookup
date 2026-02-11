# 🗳️ Bangalore Geo-Representative Lookup

Find your **MP (Member of Parliament)** and **MLA (Member of Legislative Assembly)** by clicking anywhere on a map of Bangalore.

---

## 📁 Project Structure

```
geo-rep-lookup/
├── backend/
│   ├── app/
│   │   ├── __init__.py          # Package init
│   │   ├── main.py              # FastAPI application & API routes
│   │   ├── services.py          # Business logic & AC→PC mapping
│   │   ├── loader.py            # Loads GeoJSON and JSON data files
│   │   └── raycast.py           # Point-in-polygon algorithm
│   ├── data/
│   │   ├── ac_bangalore.geojson # Assembly constituency boundaries
│   │   ├── pc_bangalore.geojson # Parliamentary constituency boundaries
│   │   ├── ac_data.json         # MLA names, parties, contacts
│   │   └── pc_data.json         # MP names, parties, contacts
│   └── requirements.txt
└── frontend/
    ├── index.html               # Main UI
    ├── styles.css               # Styling
    └── app.js                   # Map interaction & API calls
```

---

## ⚙️ How It Works

### 1. User clicks on map
The frontend captures `(latitude, longitude)` coordinates from the click.

### 2. API call to backend
```
GET /api/v1/lookup?lat=12.9716&lon=77.5946
```

### 3. Point-in-polygon lookup (raycast.py)
The backend casts a horizontal ray from the clicked point and counts how many times it crosses a polygon boundary. Odd = inside, Even = outside. This runs against every AC polygon in `ac_bangalore.geojson`.

### 4. AC → PC mapping (services.py)
Instead of using the PC GeoJSON directly (which has overlapping boundaries), the code uses a **hardcoded official mapping** from the 2008 ECI delimitation to find the correct parliamentary constituency from the assembly constituency name.

### 5. Data lookup
The AC name looks up the MLA in `ac_data.json`. The PC name looks up the MP in `pc_data.json`.

### 6. Response returned to frontend
```json
{
  "latitude": 12.9716,
  "longitude": 77.5946,
  "mp": {
    "name": "PC Mohan",
    "party": "BJP",
    "constituency": "Bangalore Central"
  },
  "mla": {
    "name": "Rizwan Arshad",
    "party": "INC",
    "constituency": "Shivajinagar"
  }
}
```

---

## 🚀 Setup & Running

### Prerequisites
- Python 3.8+

### Step 1 — Install backend dependencies

```bash
cd backend
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### Step 2 — Start the backend

```bash
# You must be inside the backend/ folder
cd backend
uvicorn app.main:app --reload
```

You should see:
```
INFO:  Uvicorn running on http://127.0.0.1:8000
INFO:  Loaded 37 AC constituencies
INFO:  Loaded 4 PC constituencies
```

### Step 3 — Start the frontend

Open a **new terminal**:

```bash
cd frontend
python3 -m http.server 3000
```

### Step 4 — Open in browser

```
http://localhost:3000
```

---

## 🗺️ Data Files

### ac_bangalore.geojson
GeoJSON FeatureCollection of 37 assembly constituency polygons.

**Required property:** `AC_NAME` (all caps — this is what your GeoJSON uses)

```json
{
  "type": "FeatureCollection",
  "features": [{
    "type": "Feature",
    "properties": {
      "AC_NAME": "Shivajinagar",
      "DIST_NAME": "BANGALORE",
      "ST_NAME": "KARNATAKA"
    },
    "geometry": {
      "type": "Polygon",
      "coordinates": [[[lon, lat], ...]]
    }
  }]
}
```

### pc_bangalore.geojson
GeoJSON FeatureCollection of 4 parliamentary constituency polygons.

> ⚠️ **Note:** This file is loaded but its polygons are **not used for MP lookup**. The AC→PC mapping in `services.py` is used instead, because the Bangalore Rural PC boundary is a large shape that incorrectly overlaps the other three constituencies.

### ac_data.json
Dictionary keyed by the **exact AC_NAME** value from the GeoJSON.

```json
{
  "Shivajinagar": {
    "name": "Rizwan Arshad",
    "party": "INC",
    "constituency": "Shivajinagar",
    "constituency_number": "157",
    "contact": "+91-80-22866530",
    "email": "rizwanarshad.mla@karnataka.gov.in"
  }
}
```

> ⚠️ Keys must **exactly match** AC_NAME in the GeoJSON — including spaces, dots, and `(SC)` suffixes.

### pc_data.json
Dictionary keyed by PC name.

```json
{
  "Bangalore Central": {
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

---

## 🗂️ Official AC → PC Mapping

Based on the **2008 Election Commission of India delimitation order**.

| Parliamentary Constituency | Assembly Constituencies |
|---|---|
| **Bangalore North (24)** | K.R.Pura, Byatarayanapura, Yeshvanthapura, Dasarahalli, Mahalakshmi Layout, Malleshwaram, Hebbal, Pulakeshinagar(SC), Yelahanka |
| **Bangalore Central (25)** | Shivajinagar, Shanti Nagar, Gandhi Nagar, Rajaji Nagar, Chamrajpet, Chickpet, Sarvagnanagar, C.V. Raman Nagar(SC), Mahadevapura |
| **Bangalore South (26)** | Govindraj Nagar, Vijay Nagar, Basavanagudi, Padmanaba Nagar, B.T.M Layout, Jayanagar, Bommanahalli |
| **Bangalore Rural (23)** | Rajarajeshwarinagar, Bangalore South (AC), Anekal(SC), Magadi, Ramanagaram, Kanakapura, Channapatna, Hosakote, Doddaballapur, Devanahalli(SC), Nelamangala(SC) |

> ⚠️ **Common confusion:** The AC named **"Bangalore South"** (covering Electronic City, Begur, Anjanapura, Yelachenahalli) belongs to **Bangalore Rural PC** — not Bangalore South PC. These are completely different entities per ECI.

---

## 🌐 API Reference

Base URL: `http://localhost:8000`

| Method | Endpoint | Description |
|---|---|---|
| GET | `/` | Root health check |
| GET | `/health` | Returns loaded constituency counts |
| GET | `/api/v1/lookup?lat=X&lon=Y` | Find MP and MLA for coordinates |
| GET | `/api/v1/constituencies` | List all constituencies |
| GET | `/docs` | Interactive Swagger API documentation |

### Lookup Parameters

| Parameter | Type | Required | Valid Range | Description |
|---|---|---|---|---|
| `lat` | float | Yes | 12.7 – 13.2 | Latitude |
| `lon` | float | Yes | 77.3 – 77.9 | Longitude |

### Example Request

```bash
curl "http://localhost:8000/api/v1/lookup?lat=12.9716&lon=77.5946"
```

---

## 🧪 Test Coordinates

| Location | Latitude | Longitude | AC Constituency | PC Constituency |
|---|---|---|---|---|
| MG Road | 12.9716 | 77.5946 | Shivajinagar | Bangalore Central |
| Koramangala | 12.9352 | 77.6245 | B.T.M Layout | Bangalore South |
| Malleshwaram | 13.0000 | 77.5700 | Malleshwaram | Bangalore North |
| Whitefield | 12.9698 | 77.7500 | Mahadevapura | Bangalore Central |
| Yelahanka | 13.1000 | 77.5940 | Yelahanka | Bangalore North |
| Jayanagar | 12.9300 | 77.5800 | Jayanagar | Bangalore South |
| Electronic City | 12.8450 | 77.6600 | Bangalore South (AC) | Bangalore Rural |
| Kanakapura Road | 12.8200 | 77.5500 | Bangalore South (AC) | Bangalore Rural |

---

## 🛠️ Troubleshooting

### "No module named 'app'"
You are running uvicorn from the wrong folder. You must run it from **inside** `backend/`:
```bash
cd backend          # ← must be here first
uvicorn app.main:app --reload
```

### "Loaded 0 constituencies"
GeoJSON files are missing or invalid. Check:
```bash
ls backend/data/
# Should show all 4 files

python3 -m json.tool backend/data/ac_bangalore.geojson > /dev/null && echo "Valid"
```

### "No representatives found" for a location
Coordinates may be outside all polygon boundaries. Try a coordinate from the test table above. Also check the backend terminal — it logs which AC was matched.

### MLA shows "Data not available"
The AC was found in the GeoJSON but its name is missing from `ac_data.json`. Find the exact name:
```bash
python3 -c "
import json
with open('backend/data/ac_bangalore.geojson') as f:
    d = json.load(f)
for feat in d['features']:
    print(repr(feat['properties']['AC_NAME']))
"
```
Then add or fix the matching key in `ac_data.json`.

### SyntaxError in `__init__.py`
Markdown backticks were accidentally copied into the file. It should contain **only**:
```python
"""Geo-Representative Lookup Backend"""
__version__ = "1.0.0"
```

---

## 📦 Dependencies

### Backend
```
fastapi==0.109.0
uvicorn[standard]==0.27.0
pydantic==2.5.3
```

### Frontend
- [Leaflet.js 1.9.4](https://leafletjs.com/) — interactive map (CDN)
- [OpenStreetMap](https://www.openstreetmap.org/) — map tiles

---

## 📊 Data Sources

| Data | Source |
|---|---|
| AC/PC boundary GeoJSON | Karnataka GIS / DataMeet Community Maps |
| AC → PC mapping | Election Commission of India, 2008 Delimitation Order |
| MLA data | Karnataka Legislative Assembly, 2023 Election Results |
| MP data | Lok Sabha, 2024 Election Results |

---

## ⚠️ Known Limitations

- **Coverage:** Only covers Bangalore Urban and Bangalore Rural districts.
- **PC GeoJSON not used for MP lookup:** Bangalore Rural's polygon wraps around the entire city causing overlaps. MP lookup uses the official ECI AC→PC mapping table instead.
- **Data currency:** Reflects 2023 Karnataka Assembly and 2024 Lok Sabha elections. Update `ac_data.json` and `pc_data.json` after future elections.