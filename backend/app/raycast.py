"""Point-in-Polygon Ray Casting Algorithm"""

from typing import List, Tuple


def point_in_polygon(point: Tuple[float, float], polygon: List[List[Tuple[float, float]]]) -> bool:
    """Check if point is inside polygon using ray casting"""
    if not polygon or len(polygon) == 0:
        return False
    
    # Check exterior ring
    if not _point_in_ring(point, polygon[0]):
        return False
    
    # Check holes
    for hole in polygon[1:]:
        if _point_in_ring(point, hole):
            return False
    
    return True


def _point_in_ring(point: Tuple[float, float], ring: List[Tuple[float, float]]) -> bool:
    """Ray casting for a single ring"""
    x, y = point
    n = len(ring)
    inside = False
    
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
        
        j = i
    
    return inside


def point_in_multipolygon(point: Tuple[float, float], multipolygon: List[List[List[Tuple[float, float]]]]) -> bool:
    """Check if point is in any polygon of a MultiPolygon"""
    for polygon in multipolygon:
        if point_in_polygon(point, polygon):
            return True
    return False