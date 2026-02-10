"""Bangalore Geo-Representative Lookup API - Main FastAPI Application"""

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import logging
from datetime import datetime

from .services import RepresentativeService
from .loader import DataLoader

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize FastAPI
app = FastAPI(
    title="Bangalore Geo-Representative Lookup API",
    description="Find your MP and MLA by location",
    version="1.0.0"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Response models
class RepresentativeInfo(BaseModel):
    name: str
    party: str
    constituency: str
    constituency_number: Optional[str] = None
    contact: Optional[str] = None
    email: Optional[str] = None
    office_address: Optional[str] = None


class LookupResponse(BaseModel):
    latitude: float
    longitude: float
    mp: Optional[RepresentativeInfo] = None
    mla: Optional[RepresentativeInfo] = None
    panchayat: Optional[RepresentativeInfo] = None
    timestamp: str


# Bangalore bounds
BANGALORE_BOUNDS = {
    "lat_min": 12.7,
    "lat_max": 13.2,
    "lon_min": 77.3,
    "lon_max": 77.9
}


def validate_coordinates(lat: float, lon: float) -> bool:
    """Validate coordinates are within Bangalore"""
    return (
        BANGALORE_BOUNDS["lat_min"] <= lat <= BANGALORE_BOUNDS["lat_max"] and
        BANGALORE_BOUNDS["lon_min"] <= lon <= BANGALORE_BOUNDS["lon_max"]
    )


# Initialize services
try:
    data_loader = DataLoader()
    representative_service = RepresentativeService(data_loader)
    logger.info("Application initialized successfully")
except Exception as e:
    logger.error(f"Failed to initialize: {e}")
    raise


@app.on_event("startup")
async def startup_event():
    logger.info("API starting up")
    logger.info(f"Loaded {len(data_loader.ac_features)} AC constituencies")
    logger.info(f"Loaded {len(data_loader.pc_features)} PC constituencies")


@app.get("/")
async def root():
    """Health check"""
    return {
        "status": "healthy",
        "service": "Geo-Representative Lookup API",
        "version": "1.0.0"
    }


@app.get("/health")
async def health_check():
    """Detailed health check"""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "data_loaded": {
            "assembly_constituencies": len(data_loader.ac_features),
            "parliamentary_constituencies": len(data_loader.pc_features)
        }
    }


@app.get("/api/v1/lookup", response_model=LookupResponse)
async def lookup_representatives(
    lat: float = Query(..., ge=12.7, le=13.2, description="Latitude"),
    lon: float = Query(..., ge=77.3, le=77.9, description="Longitude")
):
    """Look up representatives for a location"""
    try:
        # Validate coordinates
        if not validate_coordinates(lat, lon):
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "Coordinates outside Bangalore bounds",
                    "provided": {"latitude": lat, "longitude": lon},
                    "valid_range": BANGALORE_BOUNDS
                }
            )
        
        logger.info(f"Lookup for ({lat}, {lon})")
        
        # Find representatives
        result = representative_service.find_representatives(lat, lon)
        
        # Check if any found
        if not result["mp"] and not result["mla"]:
            raise HTTPException(
                status_code=404,
                detail={
                    "error": "No representatives found",
                    "message": "Coordinates don't fall within any constituency",
                    "coordinates": {"latitude": lat, "longitude": lon}
                }
            )
        
        # Build response
        response = LookupResponse(
            latitude=lat,
            longitude=lon,
            mp=result["mp"].to_dict() if result["mp"] else None,
            mla=result["mla"].to_dict() if result["mla"] else None,
            panchayat=None,
            timestamp=datetime.utcnow().isoformat()
        )
        
        logger.info(f"Found: MP={result['mp'].constituency if result['mp'] else 'None'}, "
                   f"MLA={result['mla'].constituency if result['mla'] else 'None'}")
        
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={"error": "Internal server error", "message": str(e)}
        )


@app.get("/api/v1/constituencies")
async def list_constituencies():
    """List all constituencies"""
    try:
        ac_list = []
        for f in data_loader.ac_features:
            props = f.get("properties", {})
            ac_list.append({
                "name": props.get("AC_Name") or props.get("AC_NAME") or props.get("Name"),
                "number": props.get("AC_Code") or props.get("AC_NO")
            })
        
        pc_list = []
        for f in data_loader.pc_features:
            props = f.get("properties", {})
            pc_list.append({
                "name": props.get("PC_Name") or props.get("PC_NAME") or props.get("Name"),
                "number": props.get("PC_Code") or props.get("PC_NO")
            })
        
        return {
            "assembly_constituencies": ac_list,
            "parliamentary_constituencies": pc_list,
            "total": {"ac": len(ac_list), "pc": len(pc_list)}
        }
    except Exception as e:
        logger.error(f"Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)