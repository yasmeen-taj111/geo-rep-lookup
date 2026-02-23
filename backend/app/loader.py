"""Data Loader - Loads GeoJSON and representative data - UPDATED FOR  FILES"""

import json
import os
from pathlib import Path
from typing import Dict, List, Any, Optional
import logging

logger = logging.getLogger(__name__)


class DataLoader:
    """Loads and manages GeoJSON and representative data"""
    
    def __init__(self, data_dir: Optional[str] = None):
        if data_dir is None:
            current_dir = Path(__file__).parent
            data_dir = current_dir.parent / "data"
        
        self.data_dir = Path(data_dir)
        logger.info(f"Loading data from: {self.data_dir}")
        
        if not self.data_dir.exists():
            raise FileNotFoundError(f"Data directory not found: {self.data_dir}")
        
        # Load GeoJSON files
        self.ac_data = self._load_geojson("ac_bangalore.geojson")
        self.pc_data = self._load_geojson("pc_bangalore.geojson")
        
        # Extract features
        self.ac_features = self.ac_data.get("features", [])
        self.pc_features = self.pc_data.get("features", [])
        
        # Load representative data
        self.ac_representatives = self._load_json("ac_data.json")
        self.pc_representatives = self._load_json("pc_data.json")
        
        logger.info(f"Loaded {len(self.ac_features)} AC constituencies")
        logger.info(f"Loaded {len(self.pc_features)} PC constituencies")
        
        # Log first feature to see property names
        if self.ac_features:
            logger.info(f"AC properties: {list(self.ac_features[0].get('properties', {}).keys())}")
        if self.pc_features:
            logger.info(f"PC properties: {list(self.pc_features[0].get('properties', {}).keys())}")
    
    def _load_geojson(self, filename: str) -> Dict[str, Any]:
        """Load a GeoJSON file"""
        filepath = self.data_dir / filename
        
        if not filepath.exists():
            raise FileNotFoundError(f"GeoJSON file not found: {filepath}")
        
        logger.info(f"Loading: {filepath}")
        
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        if data.get("type") != "FeatureCollection":
            raise ValueError(f"{filename} is not a valid FeatureCollection")
        
        return data
    
    def _load_json(self, filename: str) -> Dict[str, Any]:
        """Load a JSON file"""
        filepath = self.data_dir / filename
        
        if not filepath.exists():
            logger.warning(f"File not found: {filepath}, creating empty dict")
            return {}
        
        logger.info(f"Loading: {filepath}")
        
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)
    
    def get_ac_representative(self, constituency_name: str) -> Optional[Dict[str, Any]]:
        """Get representative data for AC constituency"""
        return self.ac_representatives.get(constituency_name)
    
    def get_pc_representative(self, constituency_name: str) -> Optional[Dict[str, Any]]:
        """Get representative data for PC constituency"""
        return self.pc_representatives.get(constituency_name)