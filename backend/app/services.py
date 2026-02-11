"""
Service Layer - AC->PC mapping approach for accurate MP lookup.

KEY FIX: Your GeoJSON uses AC_NAME (all caps), not AC_Name.

OFFICIAL AC->PC MAPPING (2008 ECI Delimitation):
  Bangalore North (24)  - K.R.Pura, Byatarayanapura, Yeshvanthapura, Dasarahalli,
                          Mahalakshmi Layout, Malleshwaram, Hebbal, Pulakeshinagar
  Bangalore Central (25)- Shivajinagar, Shanti Nagar, Gandhi Nagar, Rajaji Nagar,
                          Chamrajpet, Chickpet, Sarvagnanagar, C.V.Raman Nagar,
                          Mahadevapura
  Bangalore South (26)  - Govindraj Nagar, Vijay Nagar, Basavanagudi, Padmanaba Nagar,
                          B.T.M Layout, Jayanagar, Bommanahalli
  Bangalore Rural (23)  - Rajarajeshwarinagar, Bangalore South (AC!), Anekal,
                          Magadi, Ramanagaram, Kanakapura, Channapatna, Hosakote,
                          Doddaballapur, Devanahalli, Nelamangala, Yelahanka

NOTE: The AC named "Bangalore South" (covers Electronic City, Begur, Anjanapura)
belongs to BANGALORE RURAL PC. This is correct per ECI delimitation.
"""

from typing import Dict, Optional, Tuple, Any
import logging
from .loader import DataLoader
from .raycast import point_in_polygon, point_in_multipolygon

logger = logging.getLogger(__name__)


AC_TO_PC: Dict[str, str] = {
    # ── Bangalore North PC (24) ──────────────────────────────────────────────
    "K.R.Pura":             "Bangalore North",
    "Byatarayanapura":      "Bangalore North",
    "Yeshvanthapura":       "Bangalore North",
    "Dasarahalli":          "Bangalore North",
    "Mahalakshmi Layout":   "Bangalore North",
    "Malleshwaram":         "Bangalore North",
    "Hebbal":               "Bangalore North",
    "Pulakeshinagar(SC)":   "Bangalore North",
    "Yelahanka":            "Bangalore North",

    # ── Bangalore Central PC (25) ────────────────────────────────────────────
    "Shivajinagar":         "Bangalore Central",
    "Shanti Nagar":         "Bangalore Central",
    "Gandhi Nagar":         "Bangalore Central",
    "Rajaji Nagar":         "Bangalore Central",
    "Chamrajpet":           "Bangalore Central",
    "Chickpet":             "Bangalore Central",
    "Sarvagnanagar":        "Bangalore Central",
    "C.V. Raman Nagar(SC)": "Bangalore Central",
    "Mahadevapura":         "Bangalore Central",

    # ── Bangalore South PC (26) ──────────────────────────────────────────────
    "Govindraj Nagar":      "Bangalore South",
    "Vijay Nagar":          "Bangalore South",
    "Basavanagudi":         "Bangalore South",
    "Padmanaba Nagar":      "Bangalore South",
    "B.T.M Layout":         "Bangalore South",
    "Jayanagar":            "Bangalore South",
    "Bommanahalli":         "Bangalore South",

    # ── Bangalore Rural PC (23) ──────────────────────────────────────────────
    # IMPORTANT: "Bangalore South" AC (Electronic City, Begur, Anjanapura)
    # is under Bangalore RURAL PC, NOT Bangalore South PC!
    "Rajarajeshwarinagar":  "Bangalore Rural",
    "Bangalore South":      "Bangalore Rural",
    "Anekal (SC)":          "Bangalore Rural",
    "Magadi":               "Bangalore Rural",
    "Ramanagaram":          "Bangalore Rural",
    "Kanakapura":           "Bangalore Rural",
    "Channapatna":          "Bangalore Rural",
    "Hosakote":             "Bangalore Rural",
    "Doddaballapur":        "Bangalore Rural",
    "Devanahalli (SC)":     "Bangalore Rural",
    "Nelamangala (SC)":     "Bangalore Rural",
}


class RepresentativeInfo:

    def __init__(self, name, party, constituency,
                 constituency_number=None, contact=None, email=None, office_address=None):
        self.name = name
        self.party = party
        self.constituency = constituency
        self.constituency_number = constituency_number
        self.contact = contact
        self.email = email
        self.office_address = office_address

    def to_dict(self) -> Dict[str, Any]:
        result = {"name": self.name, "party": self.party, "constituency": self.constituency}
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

    def __init__(self, data_loader: DataLoader):
        self.data_loader = data_loader
        logger.info("RepresentativeService initialized")

    def find_representatives(self, latitude: float, longitude: float) -> Dict:
        # GeoJSON coordinates are (longitude, latitude) - NOT (lat, lon)!
        point = (longitude, latitude)

        ac_feature = self._find_ac_feature(point)

        return {
            "mp":        self._build_mp(ac_feature)  if ac_feature else None,
            "mla":       self._build_mla(ac_feature) if ac_feature else None,
            "panchayat": None,
        }

    def _find_ac_feature(self, point: Tuple[float, float]) -> Optional[Dict]:
        for feature in self.data_loader.ac_features:
            if self._contains(point, feature):
                logger.info(f"AC found: {self._ac_name(feature)}")
                return feature
        logger.warning(f"No AC found for {point}")
        return None

    def _ac_name(self, feature: Dict) -> str:
        props = feature.get("properties", {})
        # YOUR GeoJSON uses AC_NAME (all caps) - this was the bug!
        return (
            props.get("AC_NAME") or
            props.get("AC_Name") or
            props.get("ac_name") or
            "Unknown"
        )

    def _build_mla(self, feature: Dict) -> "RepresentativeInfo":
        ac_name = self._ac_name(feature)
        props = feature.get("properties", {})
        ac_num = str(props.get("AC_Code") or props.get("AC_NO") or "")
        rep = self.data_loader.get_ac_representative(ac_name)
        if rep:
            return RepresentativeInfo(
                name=rep.get("name", "Data not available"),
                party=rep.get("party", "N/A"),
                constituency=ac_name,
                constituency_number=rep.get("constituency_number", ac_num),
                contact=rep.get("contact"),
                email=rep.get("email"),
            )
        return RepresentativeInfo("Data not available", "N/A", ac_name, ac_num)

    def _build_mp(self, ac_feature: Dict) -> Optional["RepresentativeInfo"]:
        ac_name = self._ac_name(ac_feature)
        pc_name = AC_TO_PC.get(ac_name)
        if not pc_name:
            logger.warning(f"No PC mapping for AC: '{ac_name}'")
            return None
        logger.info(f"PC: {ac_name} → {pc_name}")
        rep = self.data_loader.get_pc_representative(pc_name)
        if rep:
            return RepresentativeInfo(
                name=rep.get("name", "Data not available"),
                party=rep.get("party", "N/A"),
                constituency=pc_name,
                constituency_number=rep.get("constituency_number"),
                contact=rep.get("contact"),
                email=rep.get("email"),
                office_address=rep.get("office_address"),
            )
        return RepresentativeInfo("Data not available", "N/A", pc_name)

    def _contains(self, point: Tuple[float, float], feature: Dict) -> bool:
        geom = feature.get("geometry", {})
        gtype = geom.get("type")
        coords = geom.get("coordinates", [])
        if gtype == "Polygon":
            return point_in_polygon(point, coords)
        elif gtype == "MultiPolygon":
            return point_in_multipolygon(point, coords)
        return False