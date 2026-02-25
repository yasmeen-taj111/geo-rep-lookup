"""
raycast.py — Point-in-polygon algorithm for constituency boundary testing.

Uses the ray-casting method: cast a horizontal ray from the test point
eastward to infinity, counting boundary crossings. An odd count means the
point is inside the polygon.

Reference:
    W. Randolph Franklin, "PNPOLY – Point Inclusion in Polygon Test"
    https://wrfranklin.org/Research/Short_Notes/pnpoly.html
"""

from __future__ import annotations


def _is_point_in_ring(lon: float, lat: float, ring: list[list[float]]) -> bool:
    """
    Run the ray-casting test for a single linear ring.

    A GeoJSON linear ring is a list of [longitude, latitude] pairs where
    the first and last points are identical (closed ring).

    Args:
        lon:  Longitude (x-axis) of the test point.
        lat:  Latitude  (y-axis) of the test point.
        ring: List of [lon, lat] coordinate pairs forming a closed ring.

    Returns:
        True if the point is inside the ring, False otherwise.
    """
    inside = False
    n = len(ring)

    # Iterate over each edge (ring[i], ring[j])
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]

        # Check whether the ray crosses this edge
        if ((yi > lat) != (yj > lat)) and (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi):
            inside = not inside

        j = i

    return inside


def point_in_polygon(lon: float, lat: float, geometry: dict) -> bool:
    """
    Test whether a geographic point falls inside a GeoJSON geometry.

    Supports both Polygon and MultiPolygon geometry types. For MultiPolygon,
    the point is considered inside if it is inside any of the constituent
    polygons.

    For a Polygon with holes, the point must be inside the exterior ring and
    NOT inside any hole (interior ring).

    Args:
        lon:      Longitude of the test point.
        lat:      Latitude  of the test point.
        geometry: GeoJSON geometry dict with keys "type" and "coordinates".

    Returns:
        True if the point is inside the geometry, False otherwise.

    Raises:
        ValueError: If the geometry type is unsupported.
    """
    geo_type    = geometry.get("type")
    coordinates = geometry.get("coordinates", [])

    if geo_type == "Polygon":
        return _test_polygon(lon, lat, coordinates)

    elif geo_type == "MultiPolygon":
        # A point is inside a MultiPolygon if it is inside any single polygon
        return any(_test_polygon(lon, lat, polygon) for polygon in coordinates)

    else:
        raise ValueError(f"Unsupported geometry type: {geo_type!r}")


def _test_polygon(lon: float, lat: float, rings: list[list[list[float]]]) -> bool:
    """
    Test a point against a single GeoJSON Polygon (exterior ring + optional holes).

    Args:
        lon:   Longitude of the test point.
        lat:   Latitude  of the test point.
        rings: List of linear rings — first is exterior, rest are interior (holes).

    Returns:
        True if the point is inside the exterior ring and outside all holes.
    """
    if not rings:
        return False

    exterior_ring = rings[0]
    if not _is_point_in_ring(lon, lat, exterior_ring):
        return False

    # If inside the exterior, check holes — point must be outside all of them
    for hole in rings[1:]:
        if _is_point_in_ring(lon, lat, hole):
            return False

    return True 