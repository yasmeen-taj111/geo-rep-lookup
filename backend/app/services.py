"""Service Layer - UPDATED for your GeoJSON property names"""

from typing import Dict, Optional, Tuple, Any
import logging
from .loader import DataLoader
from .raycast import point_in_polygon, point_in_multipolygon

logger = logging.getLogger(__name__)


class RepresentativeInfo:
    """Data class for representative information"""
    
    def __init__(
        self,
        name: str,
        party: str,
        constituency: str,
        constituency_number: Optional[str] = None,
        contact: Optional[str] = None,
        email: Optional[str] = None,
        office_address: Optional[str] = None
    ):
        self.name = name
        self.party = party
        self.constituency = constituency
        self.constituency_number = constituency_number
        self.contact = contact
        self.email = email
        self.office_address = office_address
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        result = {
            "name": self.name,
            "party": self.party,
            "constituency": self.constituency
        }
        
        if self.constituency_number:
            result["constituency_number"] = self.constituency_number
        if self.contact:
            result["contact"] = self.contact
        if self.email:
            result["email"] = self.email
        if self.office_address:
            result["office_address"] = self.office_address
        
        return result


class RepresentativeService:
    """Service for finding representatives based on location"""
    
    def __init__(self, data_loader: DataLoader):
        self.data_loader = data_loader
        logger.info("RepresentativeService initialized")
    
    def find_representatives(
        self,
        latitude: float,
        longitude: float
    ) -> Dict[str, Optional[RepresentativeInfo]]:
        """Find all representatives for a location"""
        point = (longitude, latitude)  # GeoJSON uses (lon, lat)
        
        mla = self._find_ac_representative(point)
        mp = self._find_pc_representative(point)
        panchayat = None
        
        return {
            "mp": mp,
            "mla": mla,
            "panchayat": panchayat
        }
    
    def _find_ac_representative(self, point: Tuple[float, float]) -> Optional[RepresentativeInfo]:
        """Find MLA for a point"""
        for feature in self.data_loader.ac_features:
            if self._point_in_feature(point, feature):
                return self._create_representative_info(feature, "ac")
        
        logger.warning(f"No AC constituency found for point {point}")
        return None
    
    def _find_pc_representative(self, point: Tuple[float, float]) -> Optional[RepresentativeInfo]:
        """Find MP for a point"""
        for feature in self.data_loader.pc_features:
            if self._point_in_feature(point, feature):
                return self._create_representative_info(feature, "pc")
        
        logger.warning(f"No PC constituency found for point {point}")
        return None
    
    def _point_in_feature(self, point: Tuple[float, float], feature: Dict) -> bool:
        """Check if point is inside a GeoJSON feature - handles MultiPolygon"""
        geometry = feature.get("geometry", {})
        geom_type = geometry.get("type")
        coordinates = geometry.get("coordinates", [])
        
        if geom_type == "Polygon":
            return point_in_polygon(point, coordinates)
        elif geom_type == "MultiPolygon":
            return point_in_multipolygon(point, coordinates)
        else:
            logger.warning(f"Unsupported geometry type: {geom_type}")
            return False
    
    def _create_representative_info(self, feature: Dict, level: str) -> RepresentativeInfo:
        """Create RepresentativeInfo from GeoJSON feature - UPDATED for your property names"""
        properties = feature.get("properties", {})
        
        if level == "ac":
            # Try multiple possible property names for AC
            constituency_name = (
                properties.get("AC_Name") or 
                properties.get("AC_NAME") or 
                properties.get("ac_name") or
                properties.get("Name") or
                "Unknown"
            )
            constituency_number = str(
                properties.get("AC_Code") or 
                properties.get("AC_NO") or 
                properties.get("ac_no") or
                ""
            )
            rep_data = self.data_loader.get_ac_representative(constituency_name)
        else:  # pc
            # Try multiple possible property names for PC
            constituency_name = (
                properties.get("PC_Name") or 
                properties.get("PC_NAME") or 
                properties.get("pc_name") or
                properties.get("Name") or
                "Unknown"
            )
            constituency_number = str(
                properties.get("PC_Code") or 
                properties.get("PC_NO") or 
                properties.get("pc_no") or
                ""
            )
            rep_data = self.data_loader.get_pc_representative(constituency_name)
        
        logger.info(f"Found constituency: {constituency_name} (#{constituency_number})")
        
        if rep_data:
            return RepresentativeInfo(
                name=rep_data.get("name", "Data not available"),
                party=rep_data.get("party", "N/A"),
                constituency=constituency_name,
                constituency_number=constituency_number,
                contact=rep_data.get("contact"),
                email=rep_data.get("email"),
                office_address=rep_data.get("office_address")
            )
        else:
            logger.info(f"No representative data for {constituency_name}")
            return RepresentativeInfo(
                name="Data not available",
                party="N/A",
                constituency=constituency_name,
                constituency_number=constituency_number
            )