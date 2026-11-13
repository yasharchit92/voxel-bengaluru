"""Shared geographic configuration for the Voxel Bengaluru preprocessing pipeline.

Spatial model
-------------
WGS84 (EPSG:4326)  ->  UTM zone 43N (EPSG:32643)  ->  scene units.

* Scene origin  = UTM projection of (ORIGIN_LON, ORIGIN_LAT).
* Extent        = square of EXTENT_M metres centred on the origin, axis-aligned to UTM grid.
* Raster grid   = CELL_M metre cells, N x N, row 0 = northern edge, col 0 = western edge.
* Scene units   = 1 unit == CELL_M metres horizontally (strictly linear, no compression).
* Scene axes    = +X east, -Z north (grid north of UTM 43N), +Y up.
"""
import numpy as np
from pyproj import Transformer

ORIGIN_LON, ORIGIN_LAT = 77.62, 12.965
EXTENT_M = 38400.0
CELL_M = 10.0
N = int(EXTENT_M / CELL_M)          # 3840
HALF = EXTENT_M / 2
REFERENCE_DATE = "2026-11-13"
RAW = "/home/user/.cache/geo"   # large raw downloads (kept out of the repo)

_fwd = Transformer.from_crs("EPSG:4326", "EPSG:32643", always_xy=True)
_inv = Transformer.from_crs("EPSG:32643", "EPSG:4326", always_xy=True)
E0, N0 = _fwd.transform(ORIGIN_LON, ORIGIN_LAT)

def ll_to_m(lon, lat):
    """lon/lat -> metres east/north of the scene origin."""
    e, n = _fwd.transform(np.asarray(lon, dtype=float), np.asarray(lat, dtype=float))
    return e - E0, n - N0

def m_to_ll(x, y):
    return _inv.transform(np.asarray(x) + E0, np.asarray(y) + N0)

def m_to_grid(x, y):
    """metres from origin -> fractional (col,row) of the raster grid."""
    return (np.asarray(x) + HALF) / CELL_M, (HALF - np.asarray(y)) / CELL_M

def ll_to_scene(lon, lat):
    """lon/lat -> scene (x,z). 1 unit = CELL_M metres, -z is north."""
    x, y = ll_to_m(lon, lat)
    return x / CELL_M, -y / CELL_M

# bounding box (lon/lat) of the square, with margin, for filtering raw data
_cx, _cy = m_to_ll(np.array([-HALF, HALF, -HALF, HALF]) * 1.04, np.array([-HALF, -HALF, HALF, HALF]) * 1.04)
BBOX = (float(_cx.min()), float(_cy.min()), float(_cx.max()), float(_cy.max()))
# affine for rasterio: maps (col,row) -> metres-from-origin
from affine import Affine
TRANSFORM = Affine(CELL_M, 0, -HALF, 0, -CELL_M, HALF)
