#!/usr/bin/env python3
"""Geographic validation (stdlib + numpy/pillow only; deliberately does NOT use pyproj).

 A. Re-projects every manifest feature with an independent Krueger-series Transverse Mercator implementation
    and compares against the scene coordinates the pipeline stored (tests the CRS chain, not the source data).
 B. Compares landmark positions against an independent source: English Wikipedia article coordinates
    (docs/validation/wikipedia_coords_2026-11-13.json, fetched via the MediaWiki API on 2026-11-13).
 C. Checks that each landmark sits on a plausible raster class (water for lakes, park for parks, ...).
 D. Null test: the same Wikipedia comparison against uniformly random positions -> landmarks are not random.
 E. Distortion report for the projection over the extent.
 F. Writes a top-down comparison image: scene class raster with reference points over-plotted.
Run from tools/:  python3 03_validate.py
"""
import json, math, random, os, sys
import numpy as np
from PIL import Image, ImageDraw
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
M = json.load(open(f'{ROOT}/docs/manifest.json'))
LON0, LAT0 = 77.62, 12.965; UNIT = 10.0; HALF = 1920.0

def utm43(lon, lat):
    """WGS84 -> UTM zone 43N, Krueger n-series (Karney 2011, 6th order truncated to 4th)."""
    a, f = 6378137.0, 1 / 298.257223563; k0 = 0.9996; lam0 = math.radians(75.0)
    n = f / (2 - f); A = a / (1 + n) * (1 + n**2 / 4 + n**4 / 64)
    al = [n/2 - 2*n**2/3 + 5*n**3/16 + 41*n**4/180, 13*n**2/48 - 3*n**3/5 + 557*n**4/1440, 61*n**3/240 - 103*n**4/140, 49561*n**4/161280]
    phi, lam = math.radians(lat), math.radians(lon) - lam0; e = math.sqrt(f * (2 - f))
    t = math.sinh(math.atanh(math.sin(phi)) - e * math.atanh(e * math.sin(phi)))
    xi = math.atan2(t, math.cos(lam)); eta = math.atanh(math.sin(lam) / math.sqrt(1 + t * t))
    E = 500000 + k0 * A * (eta + sum(al[j] * math.cos(2*(j+1)*xi) * math.sinh(2*(j+1)*eta) for j in range(4)))
    N = k0 * A * (xi + sum(al[j] * math.sin(2*(j+1)*xi) * math.cosh(2*(j+1)*eta) for j in range(4)))
    return E, N
E0, N0 = utm43(LON0, LAT0)
def scene(lon, lat): E, N = utm43(lon, lat); return (E - E0) / UNIT, -(N - N0) / UNIT
def haversine(lo1, la1, lo2, la2):
    R = 6371008.8; p1, p2 = math.radians(la1), math.radians(la2); dl = math.radians(lo2 - lo1)
    h = math.sin((p2 - p1) / 2)**2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2)**2; return 2 * R * math.asin(math.sqrt(h))
def stats(v):
    v = sorted(v); n = len(v)
    return dict(n=n, mean=round(sum(v)/n, 3), median=round(v[n//2], 3), p90=round(v[min(n-1, int(n*0.9))], 3), max=round(v[-1], 3), rmse=round(math.sqrt(sum(x*x for x in v)/n), 3))

out = dict(generated='2026-11-13', origin_check=dict(pipeline=M['origin_utm'], independent=[round(E0, 2), round(N0, 2)]))

# ---- A. projection chain ----------------------------------------------------------------------
resid = []; per = {}
for grp in ('landmarks', 'lakes', 'parks', 'places', 'metro_stations', 'rail_stations'):
    r = []
    for f in M[grp]:
        if 'lon' not in f or f.get('x') is None: continue
        x, z = scene(f['lon'], f['lat']); r.append(math.hypot(x - f['x'], z - f['z']) * UNIT)
    per[grp] = stats(r); resid += r
out['A_projection_residual_m'] = dict(all=stats(resid), by_group=per, note='independent Krueger-series TM vs. pyproj-derived scene coordinates stored in the manifest; residual includes the 0.01-0.1 unit rounding of stored scene coordinates')

# ---- B. independent source ---------------------------------------------------------------------
W = {p['title']: p['coordinates'][0] for p in json.load(open(f'{ROOT}/docs/validation/wikipedia_coords_2026-11-13.json'))['query']['pages'].values() if p.get('coordinates')}
PAIRS = [  # (group, manifest key/name, wikipedia title, reference type)
 ('landmarks', 'vidhana', 'Vidhana Soudha', 'building'), ('landmarks', 'vikasa', 'Vikasa Soudha', 'building'), ('landmarks', 'highcourt', 'Karnataka High Court', 'building'),
 ('landmarks', 'chinnaswamy', 'M. Chinnaswamy Stadium', 'building'), ('landmarks', 'kanteerava', 'Sree Kanteerava Stadium', 'building'), ('landmarks', 'ubcity', 'UB City', 'building'),
 ('landmarks', 'iskcon', 'ISKCON Temple, Bengaluru', 'building'), ('landmarks', 'wtc', 'World Trade Center Bengaluru', 'building'), ('landmarks', 'townhall', 'Bengaluru Town Hall', 'building'),
 ('landmarks', 'basilica', "St. Mary's Basilica, Bengaluru", 'building'), ('landmarks', 'majestic_bus', 'Kempegowda Bus Station', 'building'), ('landmarks', 'freedom', 'Freedom Park, Bengaluru', 'area'),
 ('landmarks', 'cubbon', 'Cubbon Park', 'area'), ('landmarks', 'lalbagh', 'Lal Bagh', 'area'), ('landmarks', 'iimb', 'Indian Institute of Management Bangalore', 'area'),
 ('landmarks', 'manyata', 'Manyata Embassy Business Park', 'area'), ('landmarks', 'itpl', 'International Tech Park, Bengaluru', 'area'),
 ('lakes', 'Bellandur Lake', 'Bellandur Lake', 'area'), ('lakes', 'Ulsoor Lake', 'Ulsoor Lake', 'area'), ('lakes', 'Hebbal Lake', 'Hebbal Lake, Bengaluru', 'area'), ('lakes', 'Madiwala Lake', 'Madiwala Lake', 'area'),
 ('rail_stations', 'Krishnarajapuram', 'Krishnarajapuram railway station', 'station'), ('rail_stations', 'Kengeri', 'Kengeri railway station', 'station'),
 ('rail_stations', 'Yesvantpur Junction', 'Yesvantpur Junction railway station', 'station'), ('rail_stations', 'Bangalore Cantonment', 'Bengaluru Cantonment railway station', 'station'),
 ('rail_stations', 'Sir M. Visvesvaraya Terminal', 'Sir M. Visvesvaraya Terminal', 'station'), ('peripheral', 'Kempegowda Intl Airport (KIA)', 'Kempegowda International Airport', 'area'),
]
def find(grp, key):
    for f in M[grp]:
        if f.get('key') == key or f.get('name') == key or f.get('label') == key: return f
    for f in M[grp]:
        if key.lower() in (f.get('name') or '').lower(): return f
def decimals(v): s = repr(float(v)); return len(s.split('.')[1]) if '.' in s else 0
rows = []; missing = []
for grp, key, title, typ in PAIRS:
    f = find(grp, key); w = W.get(title)
    if not f or not w: missing.append([grp, key, title, 'no manifest feature' if not f else 'no wikipedia coordinate']); continue
    prec = min(decimals(w['lat']), decimals(w['lon']))           # 2 decimals ~ 1.1 km: too coarse to test a building
    d = haversine(f['lon'], f['lat'], w['lon'], w['lat'])
    rows.append(dict(group=grp, key=key, wikipedia_title=title, type=typ, src_lon=f['lon'], src_lat=f['lat'], ref_lon=w['lon'], ref_lat=w['lat'], ref_decimals=prec, error_m=round(d, 1), coarse_reference=prec <= 2))
fine = [r['error_m'] for r in rows if not r['coarse_reference']]; bld = [r['error_m'] for r in rows if not r['coarse_reference'] and r['type'] == 'building']
out['B_vs_wikipedia'] = dict(rows=rows, not_compared=missing, stats_all_m=stats([r['error_m'] for r in rows]), stats_fine_reference_m=stats(fine), stats_buildings_fine_reference_m=stats(bld),
    note='Wikipedia coordinates are an independent but imprecise reference (area features are quoted at arbitrary interior points; some are rounded to 0.01 deg = ~1.1 km and are flagged coarse_reference). They test for gross misplacement, not metre accuracy.')

# ---- C. raster class under each feature --------------------------------------------------------
cls = np.load(f'{ROOT}/data/processed/cls.npy') if os.path.exists(f'{ROOT}/data/processed/cls.npy') else None
C = {}
if cls is not None:
    N = cls.shape[0]
    def at(x, z, r=0):
        i, j = int(z + HALF), int(x + HALF)
        return cls[max(0, i-r):i+r+1, max(0, j-r):j+r+1]
    lk = [f for f in M['lakes'] if f['area_ha'] >= 10]
    ok = sum(1 for f in lk if np.isin(at(f['x'], f['z'], 6), (5, 6)).mean() > 0.3)
    C['lakes_ge_10ha_centroid_on_water_or_wetland'] = [ok, len(lk)]
    ms = [f for f in M['metro_stations'] if f.get('x') is not None]
    C['metro_stations_within_60m_of_arterial_road_or_rail_cell'] = [sum(1 for f in ms if np.isin(at(f['x'], f['z'], 6), (12, 13, 14, 15)).any()), len(ms)]
    rs = M['rail_stations']; C['rail_stations_within_50m_of_rail_cell'] = [sum(1 for f in rs if (at(f['x'], f['z'], 5) == 15).any()), len(rs)]
    pk = [f for f in M['landmarks'] if f['kind'] == 'park']; C['park_landmarks_on_green_cells'] = [sum(1 for f in pk if np.isin(at(f['x'], f['z'], 8), (1, 3, 7, 16)).mean() > 0.5), len(pk)]
    bl = [f for f in M['landmarks'] if f.get('model')]; C['modelled_landmarks_footprint_cleared_of_generic_buildings'] = [sum(1 for f in bl if (at(f['x'], f['z'], 1) < 32).all()), len(bl)]
out['C_raster_consistency'] = C

# ---- D. null test -------------------------------------------------------------------------------
rnd = random.Random(20261113); null = []
for t in range(2000):
    e = []
    for r in rows:
        if r['coarse_reference'] or r['group'] == 'peripheral': continue
        x, z = rnd.uniform(-HALF, HALF), rnd.uniform(-HALF, HALF); rx, rz = scene(r['ref_lon'], r['ref_lat']); e.append(math.hypot(x - rx, z - rz) * UNIT)
    null.append(sorted(e)[len(e)//2])
act = sorted(r['error_m'] for r in rows if not r['coarse_reference'] and r['group'] != 'peripheral'); med = act[len(act)//2]
out['D_null_test'] = dict(actual_median_error_m=med, random_placement_median_error_m=dict(min=round(min(null)), mean=round(sum(null)/len(null)), max=round(max(null))), trials=2000,
    n_features=len(act), p_value_upper_bound=round(1/2001, 5) if min(null) > med else None, passed=min(null) > med * 10)

# ---- E. distortion -------------------------------------------------------------------------------
def local_scale(lon, lat):
    d = 1e-4; x0, z0 = scene(lon, lat); x1, z1 = scene(lon + d, lat); x2, z2 = scene(lon, lat + d)
    ke = math.hypot(x1 - x0, z1 - z0) * UNIT / haversine(lon, lat, lon + d, lat); kn = math.hypot(x2 - x0, z2 - z0) * UNIT / haversine(lon, lat, lon, lat + d)
    conv = math.degrees(math.atan2(x2 - x0, -(z2 - z0))); return ke, kn, conv
pts = {'origin': (LON0, LAT0), 'NW corner': (77.4343, 13.1472), 'NE corner': (77.8059, 13.1472), 'SW corner': (77.4343, 12.7827), 'SE corner': (77.8059, 12.7827)}
out['E_distortion'] = dict(points={k: dict(zip(('scale_east', 'scale_north', 'grid_north_offset_deg'), [round(v, 6) for v in local_scale(*p)])) for k, p in pts.items()},
    horizontal='uniform 1 scene unit = 10 m grid distance; no rubber-sheeting, no selective enlargement of districts or landmarks footprints',
    vertical=dict(terrain_exaggeration=3.0, building_height_exaggeration=1.5, vehicle_size_exaggeration=1.6, traffic_time_lapse=2.0),
    note='scale vs. spherical haversine (mean radius) so north/east differ by ellipsoid flattening terms of ~0.3 %; UTM grid scale itself is ~1.0006 here (0.6 m per km)')

os.makedirs(f'{ROOT}/docs/validation', exist_ok=True)
json.dump(out, open(f'{ROOT}/docs/validation/geo_validation.json', 'w'), indent=1, ensure_ascii=False)

# ---- F. top-down comparison ----------------------------------------------------------------------
if cls is not None:
    PAL = np.zeros((256, 3), np.uint8); PAL[:] = (176, 160, 150)
    for k, c in {0: (190, 175, 150), 1: (150, 180, 110), 2: (190, 185, 120), 3: (70, 125, 70), 4: (150, 160, 105), 5: (60, 125, 165), 6: (95, 145, 130), 7: (95, 160, 85), 10: (200, 195, 188), 11: (205, 200, 195), 12: (120, 115, 110), 13: (95, 90, 88), 14: (60, 58, 58), 15: (40, 30, 30), 16: (120, 185, 100), 17: (170, 170, 175), 18: (205, 170, 120)}.items(): PAL[k] = c
    S = 2; im = Image.fromarray(PAL[cls[::S, ::S]]); dr = ImageDraw.Draw(im)
    for r in rows:
        if r['group'] == 'peripheral': continue
        sx, sz = scene(r['src_lon'], r['src_lat']); rx, rz = scene(r['ref_lon'], r['ref_lat']); p = lambda x, z: ((x + HALF) / S, (z + HALF) / S)
        a, b = p(sx, sz), p(rx, rz); dr.line([a, b], fill=(255, 255, 0), width=2)
        dr.ellipse([a[0]-5, a[1]-5, a[0]+5, a[1]+5], outline=(255, 255, 255), width=2); dr.ellipse([b[0]-4, b[1]-4, b[0]+4, b[1]+4], fill=(230, 30, 60) if not r['coarse_reference'] else (255, 150, 0))
        dr.text((a[0]+8, a[1]-6), r['key'], fill=(255, 255, 255), stroke_width=2, stroke_fill=(0, 0, 0))
    dr.text((12, 10), 'Scene raster (north up, 20 m/px). White ring = scene position (OSM). Red dot = Wikipedia coordinate; orange = Wikipedia coordinate rounded to 0.01 deg. Yellow = offset.', fill=(255, 255, 255), stroke_width=2, stroke_fill=(0, 0, 0))
    im.save(f'{ROOT}/docs/validation/topdown_vs_reference.png')
print(json.dumps({k: v for k, v in out.items() if k != 'B_vs_wikipedia'}, indent=1)[:3000])
print('B stats', out['B_vs_wikipedia']['stats_all_m'], out['B_vs_wikipedia']['stats_fine_reference_m'], out['B_vs_wikipedia']['stats_buildings_fine_reference_m'])
for r in rows: print(f"  {r['key'][:28]:28s} {r['error_m']:8.1f} m  dec={r['ref_decimals']} {r['type']}")
print('not compared', missing)
