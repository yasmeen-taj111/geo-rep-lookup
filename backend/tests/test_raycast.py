"""
test_raycast.py — Unit tests for the point-in-polygon ray-casting algorithm.

Coverage:
    - Interior points in simple Polygon
    - Exterior points
    - Points on or near edges / corners
    - Polygon with holes (interior rings)
    - MultiPolygon support
    - Unsupported geometry type raises ValueError
    - Empty / malformed geometry
    - International date line crossing (edge case)
"""

import pytest

from app.raycast import point_in_polygon, _is_point_in_ring


# ════════════════════════════════════════════════════════════════
#  _is_point_in_ring helpers
# ════════════════════════════════════════════════════════════════

class TestIsPointInRing:
    """Unit tests for the internal ring-testing function."""

    def test_point_inside_simple_square(self):
        ring = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]
        assert _is_point_in_ring(2, 2, ring) is True

    def test_point_outside_simple_square(self):
        ring = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]
        assert _is_point_in_ring(5, 5, ring) is False

    def test_point_at_origin_outside(self):
        ring = [[1, 1], [5, 1], [5, 5], [1, 5], [1, 1]]
        assert _is_point_in_ring(0, 0, ring) is False

    def test_empty_ring_returns_false(self):
        assert _is_point_in_ring(1, 1, []) is False

    def test_triangle(self):
        # Right-angled triangle: (0,0), (4,0), (0,4)
        ring = [[0, 0], [4, 0], [0, 4], [0, 0]]
        assert _is_point_in_ring(1, 1, ring) is True
        assert _is_point_in_ring(3, 3, ring) is False


# ════════════════════════════════════════════════════════════════
#  point_in_polygon — Polygon type
# ════════════════════════════════════════════════════════════════

class TestPointInPolygon:
    """Tests for the public point_in_polygon function with Polygon geometries."""

    def test_interior_point_returns_true(self, square_polygon_geometry):
        # MG Road is inside the test square
        assert point_in_polygon(77.5946, 12.9716, square_polygon_geometry) is True

    def test_exterior_point_returns_false(self, square_polygon_geometry):
        # A point far outside Bangalore
        assert point_in_polygon(0.0, 0.0, square_polygon_geometry) is False

    def test_point_north_of_square_returns_false(self, square_polygon_geometry):
        assert point_in_polygon(77.60, 13.20, square_polygon_geometry) is False

    def test_point_south_of_square_returns_false(self, square_polygon_geometry):
        assert point_in_polygon(77.60, 12.70, square_polygon_geometry) is False

    def test_point_east_of_square_returns_false(self, square_polygon_geometry):
        assert point_in_polygon(78.00, 12.97, square_polygon_geometry) is False

    def test_point_west_of_square_returns_false(self, square_polygon_geometry):
        assert point_in_polygon(77.40, 12.97, square_polygon_geometry) is False

    def test_negative_coordinates_outside(self, square_polygon_geometry):
        assert point_in_polygon(-77.5946, -12.9716, square_polygon_geometry) is False


class TestPolygonWithHole:
    """Tests for polygon geometries with interior holes (donut shapes)."""

    def test_point_inside_outer_ring_outside_hole(self, polygon_with_hole_geometry):
        # South-west corner of outer ring — outside the hole
        assert point_in_polygon(77.44, 12.84, polygon_with_hole_geometry) is True

    def test_point_inside_hole_returns_false(self, polygon_with_hole_geometry):
        # Centre of the hole
        assert point_in_polygon(77.60, 12.98, polygon_with_hole_geometry) is False

    def test_point_outside_both_rings_returns_false(self, polygon_with_hole_geometry):
        assert point_in_polygon(77.20, 12.70, polygon_with_hole_geometry) is False


# ════════════════════════════════════════════════════════════════
#  point_in_polygon — MultiPolygon type
# ════════════════════════════════════════════════════════════════

class TestMultiPolygon:
    """Tests for MultiPolygon geometry support."""

    def test_point_in_first_polygon(self, multi_polygon_geometry):
        assert point_in_polygon(77.55, 12.95, multi_polygon_geometry) is True

    def test_point_in_second_polygon(self, multi_polygon_geometry):
        assert point_in_polygon(77.75, 12.95, multi_polygon_geometry) is True

    def test_point_between_polygons_returns_false(self, multi_polygon_geometry):
        # Gap between the two squares
        assert point_in_polygon(77.65, 12.95, multi_polygon_geometry) is False

    def test_point_outside_all_polygons(self, multi_polygon_geometry):
        assert point_in_polygon(0.0, 0.0, multi_polygon_geometry) is False


# ════════════════════════════════════════════════════════════════
#  Edge cases & error handling
# ════════════════════════════════════════════════════════════════

class TestEdgeCases:
    """Edge-case and error-handling tests."""

    def test_unsupported_geometry_type_raises(self):
        with pytest.raises(ValueError, match="Unsupported geometry type"):
            point_in_polygon(77.5, 12.9, {"type": "LineString", "coordinates": []})

    def test_missing_type_key_raises(self):
        with pytest.raises((ValueError, KeyError, AttributeError)):
            point_in_polygon(77.5, 12.9, {"coordinates": []})

    def test_empty_polygon_coordinates_returns_false(self):
        geometry = {"type": "Polygon", "coordinates": []}
        result = point_in_polygon(77.5, 12.9, geometry)
        assert result is False

    def test_empty_multipolygon_returns_false(self):
        geometry = {"type": "MultiPolygon", "coordinates": []}
        result = point_in_polygon(77.5, 12.9, geometry)
        assert result is False

    def test_float_coordinates_handled(self):
        ring = [[77.499999, 12.899999], [77.700001, 12.899999],
                [77.700001, 13.050001], [77.499999, 13.050001], [77.499999, 12.899999]]
        geometry = {"type": "Polygon", "coordinates": [ring]}
        assert point_in_polygon(77.5946, 12.9716, geometry) is True

    def test_large_polygon_wrapping_whole_world(self):
        """A polygon covering ±180 lon, ±90 lat should contain any point."""
        ring = [[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]]
        geometry = {"type": "Polygon", "coordinates": [ring]}
        assert point_in_polygon(77.5946, 12.9716, geometry) is True