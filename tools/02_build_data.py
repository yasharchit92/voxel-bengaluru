"""Stage 2-4 preprocessing: turn raw geographic evidence into the compact scene data
embedded in voxel-bengaluru.html.

Inputs (see docs/SOURCES.md):  OSM pickles from 01_extract_osm.py, ESA WorldCover 2021,
Copernicus GLO-30 DEM, JRC GHSL GHS-BUILT-H (ANBH/AGBH 2018).
Outputs: data/processed/scene_data.json  (embedded by build.py)
         data/processed/*.npy            (rasters, used by tests)
         docs/manifest.json              (machine readable feature manifest)
"""
import pickle, json, re, zlib, base64, math, os, sys, collections
import numpy as np, shapely, rasterio
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union
from rasterio.features import rasterize
from rasterio.warp import reproject, Resampling
from scipy import ndimage as ndi
from affine import Affine
from config import *

SEED = 20261113
rng = np.random.default_rng(SEED)
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'processed'); os.makedirs(OUT, exist_ok=True)
DOCS = os.path.join(os.path.dirname(__file__), '..', 'docs')
A_ABS = Affine(CELL_M, 0, E0 - HALF, 0, -CELL_M, N0 + HALF)
EXT = box(-HALF, -HALF, HALF, HALF)
def log(*a): print(*a, flush=True)

# ----------------------------------------------------------------------------- class codes
C_BARE, C_GRASS, C_CROP, C_TREE, C_SCRUB, C_WATER, C_WETLAND, C_PARK, C_PROC, C_BLD, C_PAVED = range(11)
C_RD_MINOR, C_RD_TERT, C_RD_SEC, C_RD_ART, C_RAIL, C_PITCH, C_AIR, C_CONSTR = 11, 12, 13, 14, 15, 16, 17, 18
BLD0 = 32      # values >= 32 are building cells: height_m = (v-31)*1.6 ; bit meaning of source kept in 'src' raster

# ----------------------------------------------------------------------------- rasters: land cover, DEM, GHSL
log('worldcover...')
wc = np.zeros((N, N), np.uint8)
with rasterio.open(RAW + '/wc.tif') as src:
    reproject(rasterio.band(src, 1), wc, dst_transform=A_ABS, dst_crs='EPSG:32643', resampling=Resampling.nearest)
log(' wc classes', dict(zip(*np.unique(wc, return_counts=True))))

DEM_STEP = 8                               # 80 m vertex grid
ND = N // DEM_STEP + 1
A_DEM = Affine(CELL_M * DEM_STEP, 0, E0 - HALF - CELL_M * DEM_STEP / 2, 0, -CELL_M * DEM_STEP, N0 + HALF + CELL_M * DEM_STEP / 2)
dem = np.full((ND, ND), np.nan, np.float32)
for f in ('dem12.tif', 'dem13.tif'):
    tmp = np.full((ND, ND), np.nan, np.float32)
    with rasterio.open(RAW + '/' + f) as src:
        reproject(rasterio.band(src, 1), tmp, dst_transform=A_DEM, dst_crs='EPSG:32643', resampling=Resampling.bilinear, dst_nodata=np.nan)
    dem = np.where(np.isnan(dem), tmp, dem)
log(' dem range', np.nanmin(dem), np.nanmax(dem), 'nan', np.isnan(dem).sum())
dem = ndi.gaussian_filter(np.nan_to_num(dem, nan=float(np.nanmean(dem))), 1.6)   # ~130 m smoothing: DSM -> terrain proxy

NG = N // 10                               # 100 m grids
A_G = Affine(100, 0, E0 - HALF, 0, -100, N0 + HALF)
def ghsl(name):
    out = np.zeros((NG, NG), np.float32)
    with rasterio.open(RAW + f'/GHS_BUILT_H_{name}_E2018_GLOBE_R2023A_54009_100_V1_0_R8_C26.tif') as src:
        reproject(rasterio.band(src, 1), out, dst_transform=A_G, dst_crs='EPSG:32643', resampling=Resampling.bilinear)
    return out
anbh, agbh = ghsl('ANBH'), ghsl('AGBH')
anbh_s = ndi.gaussian_filter(anbh, 3.0)
bfrac = np.clip(agbh / np.maximum(anbh, 1.0), 0, 1)
log(' anbh', anbh.min(), np.percentile(anbh, [50, 90, 99]), anbh.max())

# ----------------------------------------------------------------------------- OSM geometry
log('load osm...')
L = pickle.load(open(RAW + '/osm_lines.pkl', 'rb'))
AR = pickle.load(open(RAW + '/osm_areas.pkl', 'rb'))
def to_m(c): return np.column_stack(ll_to_m(c[:, 0], c[:, 1]))
ageom = shapely.from_wkb([a[2] for a in AR])
ageom = shapely.transform(ageom, to_m)
ageom = shapely.make_valid(ageom)
atag = [a[3] for a in AR]; aid = [(('way' if a[1] else 'relation'), a[0]) for a in AR]
aarea = shapely.area(ageom)

def sel(pred): return [i for i, t in enumerate(atag) if pred(t)]
def rast(idx_or_geoms, value=1, all_touched=False, shape=(N, N), transform=TRANSFORM, dtype='uint8'):
    geoms = [ageom[i] if isinstance(i, (int, np.integer)) else i for i in idx_or_geoms]
    geoms = [g for g in geoms if g is not None and not g.is_empty]
    if not geoms: return np.zeros(shape, dtype)
    return rasterize(((g, value) for g in geoms), out_shape=shape, transform=transform, fill=0, all_touched=all_touched, dtype=dtype)

i_water = sel(lambda t: (t.get('natural') == 'water' or t.get('landuse') == 'reservoir') and t.get('leisure') != 'swimming_pool' and t.get('water') not in ('wastewater',))
i_wet = sel(lambda t: t.get('natural') == 'wetland')
i_park = sel(lambda t: t.get('leisure') in ('park', 'garden', 'golf_course', 'common', 'playground', 'dog_park', 'nature_reserve') or t.get('landuse') in ('recreation_ground', 'cemetery', 'grass', 'village_green'))
i_wood = sel(lambda t: t.get('natural') == 'wood' or t.get('landuse') in ('forest', 'orchard'))
i_scrub = sel(lambda t: t.get('natural') in ('scrub', 'grassland'))
i_pitch = sel(lambda t: t.get('leisure') in ('pitch', 'track'))
i_aero = sel(lambda t: t.get('aeroway') in ('aerodrome', 'apron', 'runway', 'taxiway') or (t.get('landuse') == 'military' and 'Airport' in t.get('name', '')))
i_rwy = sel(lambda t: t.get('landuse') == 'railway')
i_constr = sel(lambda t: t.get('landuse') in ('construction', 'brownfield'))
log(' areas', len(i_water), len(i_park), len(i_wood), len(i_pitch), len(i_aero))

m_water = rast(i_water).astype(bool); m_wet = rast(i_wet).astype(bool)
m_park = rast(i_park).astype(bool); m_wood = rast(i_wood).astype(bool); m_scrub = rast(i_scrub).astype(bool)
m_pitch = rast(i_pitch).astype(bool); m_aero = rast(i_aero).astype(bool); m_rwy = rast(i_rwy).astype(bool); m_constr = rast(i_constr).astype(bool)

# ----------------------------------------------------------------------------- roads & rail rasters
log('roads...')
HW_W = {'motorway': 13, 'trunk': 12, 'primary': 10, 'secondary': 8, 'tertiary': 6.5}
MAJ = set(HW_W) | {k + '_link' for k in HW_W}
def hw_base(h): return h[:-5] if h.endswith('_link') else h
road_m = [(r, to_m(r[1])) for r in L['roads']]
minor_lines, tert, sec, art = [], [], [], []
for r, p in road_m:
    t = r[2]; h = t['highway']
    if t.get('tunnel') in ('yes', 'building_passage') or h in ('construction', 'road', 'pedestrian'): continue
    if h == 'service' and t.get('service') in ('parking_aisle', 'driveway', 'drive-through', 'alley', 'emergency_access'): continue
    ls = LineString(p)
    if h in MAJ:
        b = hw_base(h); w = HW_W[b] * (0.6 if h.endswith('_link') else 1.0)
        try: lanes = float(t.get('lanes', 0))
        except ValueError: lanes = 0
        if lanes >= 3: w = max(w, lanes * 3.4 / 2 + 1.5)
        poly = ls.buffer(w, cap_style='flat', quad_segs=2)
        (art if b in ('motorway', 'trunk', 'primary') else sec if b == 'secondary' else tert).append(poly)
    else:
        minor_lines.append(ls)
m_minor = rast(minor_lines, all_touched=True).astype(bool)
m_tert = rast(tert, all_touched=False).astype(bool) | rast([g.boundary for g in tert[:0]]).astype(bool)
m_sec = rast(sec).astype(bool); m_art = rast(art).astype(bool)
# guarantee continuity of thin majors: also burn their centre-lines
cl = [LineString(p) for r, p in road_m if r[2]['highway'] in MAJ and r[2].get('tunnel') != 'yes']
m_cl = rast(cl, all_touched=True).astype(bool)
rail_lines = [LineString(to_m(r[1])) for r in L['rails'] if r[2].get('railway') == 'rail' and r[2].get('tunnel') != 'yes']
m_rail = rast(rail_lines, all_touched=True).astype(bool)
del minor_lines, tert, sec, art

# ----------------------------------------------------------------------------- zone grid (100 m)
log('zones...')
TECH_RE = re.compile(r'tech|software|sez|\bit\b|infosys|wipro|bagmane|manyata|embassy|rmz|ecospace|ecoworld|global village|electronic|business park|itpl|itpb|biocon|cessna|salarpuria|prestige.*park|brigade.*park|divyasree|kalyani|sattva', re.I)
A_GR = Affine(100, 0, -HALF, 0, -100, HALF)
def zr(pred): return rast(sel(pred), all_touched=True, shape=(NG, NG), transform=A_GR).astype(bool)
zone = np.zeros((NG, NG), np.uint8)
zone[zr(lambda t: t.get('landuse') == 'commercial')] = 1
zone[zr(lambda t: t.get('landuse') == 'retail')] = 2
zone[zr(lambda t: t.get('landuse') in ('industrial', 'garages', 'railway'))] = 3
zone[zr(lambda t: t.get('landuse') in ('education', 'military', 'religious', 'institutional') or t.get('amenity') in ('university', 'college', 'school', 'hospital', 'research_institute'))] = 4
i_tech = [i for i in sel(lambda t: t.get('landuse') in ('commercial', 'industrial')) if (aarea[i] > 30000 and atag[i].get('landuse') == 'commercial') or (TECH_RE.search(atag[i].get('name', '')) and aarea[i] > 8000)]
zone[rast(i_tech, all_touched=True, shape=(NG, NG), transform=A_GR).astype(bool)] = 5
m_tech10 = rast(i_tech).astype(bool)
m_comm10 = rast(sel(lambda t: t.get('landuse') in ('commercial', 'retail'))).astype(bool)
log(' zone counts', np.bincount(zone.ravel()))

# ----------------------------------------------------------------------------- landmarks (positions strictly from OSM)
log('landmarks...')
B = pickle.load(open(RAW + '/osm_buildings.pkl', 'rb'))
bxy = to_m(B['xy']); boff = B['off']; btags = B['tags']; nb = len(btags)
bname = {}
for i, t in enumerate(btags):
    if t[3]: bname.setdefault(t[3], []).append(i)
def bpoly(i): return Polygon(bxy[boff[i]:boff[i + 1]])
aname = collections.defaultdict(list)
for i, t in enumerate(atag):
    if 'name' in t: aname[t['name']].append(i)
nodes = L['nodes']
nname = collections.defaultdict(list)
for n in nodes:
    if 'name' in n[3]: nname[n[3]['name']].append(n)

# key, label, kannada, kind, model, [OSM name candidates]
LM = [
 ('vidhana', 'Vidhana Soudha', 'ವಿಧಾನ ಸೌಧ', 'civic', 'vidhana', ['Vidhana Soudha']),
 ('vikasa', 'Vikasa Soudha', 'ವಿಕಾಸ ಸೌಧ', 'civic', 'vikasa', ['Vikasa Soudha']),
 ('highcourt', 'Karnataka High Court', 'ಕರ್ನಾಟಕ ಉಚ್ಚ ನ್ಯಾಯಾಲಯ', 'civic', 'highcourt', ['Karnataka High Court', 'High Court of Karnataka']),
 ('palace', 'Bengaluru Palace', 'ಬೆಂಗಳೂರು ಅರಮನೆ', 'heritage', 'palace', ['Bangalore Palace', 'Bengaluru Palace']),
 ('chinnaswamy', 'M. Chinnaswamy Stadium', 'ಎಂ. ಚಿನ್ನಸ್ವಾಮಿ ಕ್ರೀಡಾಂಗಣ', 'stadium', 'stadium', ['M Chinnaswamy Stadium', 'M. Chinnaswamy Stadium']),
 ('kanteerava', 'Sree Kanteerava Stadium', 'ಶ್ರೀ ಕಂಠೀರವ ಕ್ರೀಡಾಂಗಣ', 'stadium', 'athletics', ['Sree Kanteerava Outdoor Stadium', 'Sree Kanteerava Stadium']),
 ('kanteerava_indoor', 'Kanteerava Indoor Stadium', None, 'stadium', 'dome', ['Sree Kanteerava Indoor Stadium']),
 ('ubcity', 'UB City', 'ಯುಬಿ ಸಿಟಿ', 'commercial', 'ubcity', ['UB City']),
 ('glasshouse', 'Lalbagh Glass House', 'ಲಾಲ್‌ಬಾಗ್ ಗಾಜಿನ ಮನೆ', 'heritage', 'glasshouse', ['Lalbagh Glasshouse', 'Lalbagh Glass House']),
 ('iskcon', 'ISKCON Temple', 'ಇಸ್ಕಾನ್ ದೇವಸ್ಥಾನ', 'religious', 'temple', ['ISKCON Sri Radha Krishna-Chandra Temple']),
 ('wtc', 'World Trade Center', None, 'commercial', 'tower', ['World Trade Center Bangalore']),
 ('townhall', 'Town Hall', 'ಪುರಭವನ', 'civic', 'townhall', ['Sir Puttanna Chetty Town Hall']),
 ('basilica', "St. Mary's Basilica", None, 'religious', 'church', ["St Mary's Basilica", "St. Mary's Basilica"]),
 ('museum', 'Visvesvaraya Museum', None, 'civic', None, ['Visvesvaraya Industrial and Technology Museum']),
 ('ksr', 'KSR Bengaluru City Station', 'ಕೆಎಸ್‌ಆರ್ ಬೆಂಗಳೂರು', 'rail', None, ['Krantivira Sangolli Rayanna (Bengaluru)', 'KSR Bengaluru', 'Krantivira Sangolli Rayanna (Bengaluru Station)', 'KSR Bengaluru City Junction', 'Krantivira Sangolli Rayanna Bengaluru']),
 ('majestic_bus', 'Kempegowda Bus Station (Majestic)', 'ಕೆಂಪೇಗೌಡ ಬಸ್ ನಿಲ್ದಾಣ', 'transit', None, ['Kempegowda Bus Station']),
 ('krmarket', 'KR Market', 'ಕೆ.ಆರ್. ಮಾರುಕಟ್ಟೆ', 'market', None, ['K.R Market', 'KR Market', 'Krishnarajendra Market', 'KR Market Bus Terminus']),
 ('cubbon', 'Cubbon Park', 'ಕಬ್ಬನ್ ಪಾರ್ಕ್', 'park', None, ['Cubbon Park']),
 ('lalbagh', 'Lalbagh Botanical Garden', 'ಲಾಲ್‌ಬಾಗ್', 'park', None, ['Lalbagh Botanical Gardens', 'Lalbagh Botanical Garden']),
 ('freedom', 'Freedom Park', None, 'park', None, ['Freedom Park']),
 ('palacegrounds', 'Palace Grounds', None, 'park', None, ['Bangalore Palace Grounds']),
 ('racecourse', 'Race Course', None, 'park', None, ['Bangalore Race Course']),
 ('iisc', 'Indian Institute of Science', 'ಭಾರತೀಯ ವಿಜ್ಞಾನ ಸಂಸ್ಥೆ', 'campus', None, ['Indian Institute of Science']),
 ('iimb', 'IIM Bangalore', None, 'campus', None, ['Indian Institute of Management Bangalore']),
 ('hal', 'HAL Airport', 'ಎಚ್‌ಎಎಲ್ ವಿಮಾನ ನಿಲ್ದಾಣ', 'airfield', None, ['HAL Airport']),
 ('jakkur', 'Jakkur Aerodrome', None, 'airfield', None, ['Jakkur Aerodrome']),
 ('manyata', 'Manyata Tech Park', 'ಮಾನ್ಯತಾ ಟೆಕ್ ಪಾರ್ಕ್', 'tech', None, ['Manyata Tech Park']),
 ('ecospace', 'RMZ Ecospace', None, 'tech', None, ['RMZ Ecospace']),
 ('techvillage', 'Embassy TechVillage', None, 'tech', None, ['Embassy TechVillage']),
 ('bagmane', 'Bagmane Tech Park', None, 'tech', None, ['Bagmane Tech Park']),
 ('itpl', 'ITPL (International Tech Park)', 'ಐಟಿಪಿಎಲ್', 'tech', None, ['International Tech Park Bangalore', 'International Tech Park', 'ITPB', 'ITPL', 'International Tech Park Bengaluru', 'International Tech Park, Bangalore']),
 ('infosys', 'Infosys, Electronic City', 'ಇನ್ಫೋಸಿಸ್', 'tech', None, ['Infosys', 'Infosys Technologies Limited']),
 ('wipro_ec', 'Wipro, Electronic City', None, 'tech', None, ['Wipro EC 1', 'Wipro EC 2 / 3']),
 ('wipro_sjp', 'Wipro, Sarjapur Road', None, 'tech', None, ['Wipro Corporate Office']),
 ('biocon', 'Biocon', None, 'tech', None, ['Biocon Park', 'Biocon']),
 ('phoenix', 'Phoenix Marketcity', None, 'retail', None, ['Phoenix Market City']),
 ('orion', 'Orion Mall', None, 'retail', None, ['Orion Mall']),
 ('mantri', 'Mantri Square', None, 'retail', None, ['Mantri Square']),
 ('nimhans', 'NIMHANS', None, 'campus', None, ['NIMHANS', 'National Institute of Mental Health and Neuro Sciences', 'NIMHANS Administrative Block']),
]
landmarks, lm_clear = [], []
def obb(g):
    r = g.minimum_rotated_rectangle
    if r.geom_type != 'Polygon': return None
    c = np.array(r.exterior.coords)[:4]
    e1, e2 = c[1] - c[0], c[2] - c[1]
    l1, l2 = np.hypot(*e1), np.hypot(*e2)
    if l1 < l2: e1, e2, l1, l2 = e2, e1, l2, l1
    ang = math.atan2(e1[1], e1[0])       # direction of the long axis, radians CCW from east
    return float(l1), float(l2), float(ang)
for key, label, kn, kind, model, cands in LM:
    found = None
    for c in cands:
        if c in aname:
            i = max(aname[c], key=lambda j: aarea[j]); found = (ageom[i], aid[i], c, 'area'); break
        if c in bname:
            polys = [bpoly(i) for i in bname[c]]; g = max(polys, key=lambda p: p.area); found = (g, ('building', bname[c][0]), c, 'building'); break
        if c in nname:
            n = nname[c][0]; x, y = ll_to_m(n[1], n[2]); found = (Point(float(x), float(y)), ('node', n[0]), c, 'node'); break
    if not found:
        log('  !! landmark not found in OSM, omitted:', key); continue
    g, osm, nm, gk = found
    ctr = g.centroid if gk != 'area' or g.geom_type == 'Point' else g.representative_point() if not g.contains(g.centroid) else g.centroid
    lon, lat = m_to_ll(ctr.x, ctr.y)
    rec = dict(key=key, label=label, kn=kn, kind=kind, model=model, osm_type=osm[0], osm_id=int(osm[1]) if osm[0] != 'building' else None,
               osm_name=nm, lon=round(float(lon), 6), lat=round(float(lat), 6), x=round(ctr.x / CELL_M, 2), z=round(-ctr.y / CELL_M, 2),
               area_m2=round(float(g.area)), confidence='high' if gk != 'node' else 'medium', source='OpenStreetMap %s (%s)' % (gk, nm))
    if model and gk != 'node':
        gg = g
        if key in ('ubcity',):   # campus polygon: model occupies it
            pass
        o = obb(gg)
        if o: rec['obb'] = [round(o[0] / CELL_M, 2), round(o[1] / CELL_M, 2), round(o[2], 4)]
        lm_clear.append(gg.buffer(4))
    elif model:
        rec['obb_estimated'] = True      # node-only source: footprint size/orientation is an estimate
    landmarks.append(rec)
log(' landmarks', len(landmarks), [l['key'] for l in landmarks if l.get('obb')])

# ----------------------------------------------------------------------------- buildings raster
log('buildings...', nb)
def pf(s):
    try: return float(re.match(r'[\d.]+', s).group())
    except Exception: return np.nan
lev = np.array([pf(t[1]) if t[1] else np.nan for t in btags]); hgt = np.array([pf(t[2]) if t[2] else np.nan for t in btags])
btype = np.array([t[0] or 'yes' for t in btags])
x0, y0 = bxy[:, 0], bxy[:, 1]; x1, y1 = np.roll(x0, -1), np.roll(y0, -1)
cross = x0 * y1 - x1 * y0
last = boff[1:] - 1; cross[last] = 0
barea = np.abs(np.add.reduceat(cross, boff[:-1])) / 2
cnt = np.diff(boff)
bcx = np.add.reduceat(x0, boff[:-1]) / cnt; bcy = np.add.reduceat(y0, boff[:-1]) / cnt
gi = np.clip(((HALF - bcy) / 100).astype(int), 0, NG - 1); gj = np.clip(((bcx + HALF) / 100).astype(int), 0, NG - 1)
base = np.where(anbh[gi, gj] >= 3, anbh[gi, gj], np.maximum(anbh_s[gi, gj], 6.0))
u = rng.random(nb); ln = np.exp(rng.normal(0, 0.33, nb))
h = base * ln
ci = np.clip(((HALF - bcy) / 10).astype(int), 0, N - 1); cj = np.clip(((bcx + HALF) / 10).astype(int), 0, N - 1)
in_tech = m_tech10[ci, cj]; in_comm = m_comm10[ci, cj]
h = np.where(barea < 60, np.minimum(h, 7), h)
h = np.where(np.isin(btype, ['house', 'detached', 'hut', 'garage', 'shed']), np.minimum(h, 10), h)
h = np.where(np.isin(btype, ['apartments']) , np.maximum(h, 13 + 18 * u * (barea > 400)), h)
h = np.where(np.isin(btype, ['roof', 'carport']), 4.5, h)
h = np.where(np.isin(btype, ['industrial', 'warehouse']), np.clip(h, 6, 14), h)
big_res = (barea > 500) & (barea < 3500) & (base >= 11) & ~in_tech & np.isin(btype, ['yes', 'residential'])
h = np.where(big_res, np.maximum(h, base * (1.2 + 1.0 * u)), h)                 # estimate: apartment blocks
h = np.where(in_tech & (barea > 1500), np.maximum(h, 24 + 22 * u), h)           # estimate: tech-park office blocks
h = np.where(in_comm & ~in_tech & (barea > 1200), np.maximum(h, 16 + 14 * u), h)
h = np.clip(h, 3.5, 95)
est = np.ones(nb, bool)
h = np.where(~np.isnan(lev), lev * 3.2 + 1.0, h); est &= np.isnan(lev)
h = np.where(~np.isnan(hgt), hgt, h); est &= np.isnan(hgt)
h = np.clip(h, 3.2, 350)
log(' tagged heights', int((~est).sum()), 'estimated', int(est.sum()), 'h pct', np.percentile(h, [10, 50, 90, 99, 99.9]))
code = np.clip(np.round(h / 1.6), 2, 222).astype(np.uint8)
A5 = Affine(5, 0, -HALF, 0, -5, HALF)
b5 = np.zeros((2 * N, 2 * N), np.uint8)
order = np.argsort(code, kind='stable')        # taller buildings burn last (win)
inx = (bcx > -HALF - 200) & (bcx < HALF + 200) & (bcy > -HALF - 200) & (bcy < HALF + 200) & (cnt >= 4)
order = order[inx[order]]
for s in range(0, len(order), 60000):
    part = order[s:s + 60000]
    shapes = []
    for i in part:
        p = Polygon(bxy[boff[i]:boff[i + 1]])
        if p.is_valid and not p.is_empty: shapes.append((p, int(code[i])))
    rasterize(shapes, out=b5, transform=A5, all_touched=False)
    del shapes
b4 = b5.reshape(N, 2, N, 2).transpose(0, 2, 1, 3).reshape(N, N, 4)
bcount = (b4 > 0).sum(2); bh = b4.max(2)
bh[bcount < 2] = 0
del b5, b4
m_lm = rast(lm_clear).astype(bool) if lm_clear else np.zeros((N, N), bool)
bh[m_lm] = 0
log(' osm building cells', int((bh > 0).sum()))

# ----------------------------------------------------------------------------- compose class raster
del B, x0, y0, x1, y1, cross; import gc; gc.collect()
log('compose...')
cls = np.zeros((N, N), np.uint8)
lut = np.zeros(256, np.uint8)
for k, v in {10: C_TREE, 20: C_SCRUB, 30: C_GRASS, 40: C_CROP, 50: 250, 60: C_BARE, 80: C_WATER, 90: C_WETLAND, 95: C_WETLAND}.items(): lut[k] = v
cls = lut[wc]
wc_built = cls == 250
cls[m_scrub & np.isin(cls, [C_BARE, C_GRASS, C_CROP])] = C_SCRUB
cls[m_wood & np.isin(cls, [C_BARE, C_GRASS, C_CROP, C_SCRUB])] = C_TREE
cls[m_park & (cls != C_TREE) & (cls != C_WATER)] = C_PARK
cls[m_constr & ~np.isin(cls, [C_TREE, C_WATER])] = C_CONSTR
cls[m_aero & (cls == 250)] = C_AIR
cls[m_pitch] = C_PITCH
cls[m_wet & (cls != C_WATER)] = C_WETLAND
veg_like = np.isin(wc, [30, 90, 20, 40, 95])
cls[m_water & veg_like] = C_WETLAND          # OSM lake polygon but imagery shows vegetation: weed-covered / marsh
cls[m_water & ~veg_like] = C_WATER
is_water = (cls == C_WATER)
roadmask = m_minor | m_tert | m_sec | m_art | m_cl
# buildings (OSM)
m_b = (bh > 0) & ~roadmask & ~m_water & ~m_rail
# built-up without mapped footprints -> procedural or paved
k = 21
osm_dens = ndi.uniform_filter(m_b.astype(np.float32), k)
wcb_dens = ndi.uniform_filter((wc_built & ~roadmask).astype(np.float32), k)
complete = osm_dens > 0.22 * np.maximum(wcb_dens, 0.05)
cand = wc_built & ~m_b & ~roadmask & ~m_rail & (cls == 250)
no_proc = m_aero | m_rwy | m_lm | m_pitch | m_park
up10 = lambda g: np.repeat(np.repeat(g, 10, 0), 10, 1)
p_build = np.clip(0.38 + 0.9 * up10(bfrac), 0.42, 0.9).astype(np.float32)
proc = cand & ~complete & ~no_proc & (rng.random((N, N), dtype=np.float32) < p_build)
del p_build, cand, complete, no_proc, osm_dens, wcb_dens
# procedural heights: coherent per jittered 2x2 parcel
ar = np.arange(N, dtype=np.int16)
jx = (rng.integers(0, 2, N).astype(np.int16)[:, None] + ar[None, :]) // 2; jy = (rng.integers(0, 2, N).astype(np.int16)[None, :] + ar[:, None]) // 2
parcel_u = rng.normal(0, 0.3, (N // 2 + 2, N // 2 + 2)).astype(np.float32)[jy, jx]
del jx, jy
ph = np.clip(np.maximum(up10(anbh_s), 5.0) * np.exp(parcel_u), 3.5, 45)
pcode = np.clip(np.round(ph / 1.6), 2, 60).astype(np.uint8)
del parcel_u, ph
cls[cls == 250] = C_PAVED
cls[m_rail & ~m_water] = C_RAIL
cls[m_minor & ~is_water] = C_RD_MINOR
cls[(m_tert | m_cl) & ~is_water] = C_RD_TERT
cls[m_sec] = C_RD_SEC
cls[m_art] = C_RD_ART
src = np.zeros((N, N), np.uint8)             # 1 = OSM footprint, 2 = procedural estimate
out = cls.copy()
out[m_b] = BLD0 - 1 + np.minimum(bh[m_b], 222); src[m_b] = 1
pm = proc & (out < BLD0) & ~np.isin(out, [C_RD_MINOR, C_RD_TERT, C_RD_SEC, C_RD_ART, C_RAIL, C_WATER, C_WETLAND])
out[pm] = BLD0 - 1 + pcode[pm]; src[pm] = 2
log(' class hist', np.bincount(np.minimum(out, 32).ravel()))
log(' building cells osm/proc', int((src == 1).sum()), int((src == 2).sum()))
np.save(OUT + '/cls.npy', out); np.save(OUT + '/src.npy', src); np.save(OUT + '/dem.npy', dem); np.save(OUT + '/zone.npy', zone)
np.save(OUT + '/osm_water_mask.npy', m_water)

# flatten DEM under lakes
big = ndi.label(m_water)[0]
dem_hi = ndi.zoom(dem, DEM_STEP, order=1)[:N, :N] if False else None
lab_ds = big[::DEM_STEP, ::DEM_STEP]
demc = dem[:-1, :-1].copy()
for lbl in np.unique(lab_ds):
    if lbl == 0: continue
    mm = lab_ds == lbl
    if mm.sum() >= 2: demc[mm] = np.median(demc[mm])
dem[:-1, :-1] = demc
dmin = float(np.floor(dem.min())); dem_q = np.clip(np.round((dem - dmin)), 0, 255).astype(np.uint8)
log(' dem min/max', dmin, float(dem.max()))

# ----------------------------------------------------------------------------- major road graph
log('graph...')
CLSI = {'motorway': 0, 'trunk': 1, 'primary': 2, 'secondary': 3, 'tertiary': 4}
CORR = [
 ('orr', 'Outer Ring Road', 'ಹೊರ ವರ್ತುಲ ರಸ್ತೆ', r'outer ring road|\borr\b'),
 ('hosur', 'Hosur Road', 'ಹೊಸೂರು ರಸ್ತೆ', r'hosur (main )?road|electronic city.*(express|elevated|flyover)|elevated (tollway|expressway)'),
 ('oldairport', 'Old Airport Road', 'ಹಳೆ ವಿಮಾನ ನಿಲ್ದಾಣ ರಸ್ತೆ', r'old airport road|hal (old )?airport road'),
 ('sarjapur', 'Sarjapur Road', 'ಸರ್ಜಾಪುರ ರಸ್ತೆ', r'sarjapura? (main )?road'),
 ('bellary', 'Bellary Road (Airport corridor)', 'ಬಳ್ಳಾರಿ ರಸ್ತೆ', r'bellary road|ballari road|bengaluru.?ballari|bangalore.?bellary|airport (express|road).*nh ?44'),
 ('bannerghatta', 'Bannerghatta Road', 'ಬನ್ನೇರುಘಟ್ಟ ರಸ್ತೆ', r'bannerghatta (main )?road'),
 ('mysore', 'Mysore Road', 'ಮೈಸೂರು ರಸ್ತೆ', r'mysore road|mysuru road|bengaluru.?mysuru road|bangalore.?mysore road'),
 ('whitefield', 'Whitefield Main Road', 'ವೈಟ್‌ಫೀಲ್ಡ್ ರಸ್ತೆ', r'whitefield (main )?road|itpl (main )?road'),
 ('tumkur', 'Tumkur Road', 'ತುಮಕೂರು ರಸ್ತೆ', r'tumkur road|tumakuru road'),
 ('oldmadras', 'Old Madras Road', 'ಹಳೆ ಮದ್ರಾಸ್ ರಸ್ತೆ', r'old madras road'),
 ('kanakapura', 'Kanakapura Road', 'ಕನಕಪುರ ರಸ್ತೆ', r'kanakapura (main )?road'),
 ('magadi', 'Magadi Road', 'ಮಾಗಡಿ ರಸ್ತೆ', r'magadi (main )?road'),
 ('mg', 'MG Road', 'ಎಂ.ಜಿ. ರಸ್ತೆ', r'^(mahatma gandhi|m\.? ?g\.?) road$'),
 ('nice', 'NICE Road', 'ನೈಸ್ ರಸ್ತೆ', r'\bnice\b|bmic|peripheral ring'),
 ('varthur', 'Varthur Road', 'ವರ್ತೂರು ರಸ್ತೆ', r'varthur (main )?road'),
 ('brigade', 'Brigade Road', 'ಬ್ರಿಗೇಡ್ ರಸ್ತೆ', r'^brigade road$'),
 ('church', 'Church Street', 'ಚರ್ಚ್ ಸ್ಟ್ರೀಟ್', r'^church street$'),
 ('ccb', 'Hennur Road', None, r'hennur (main )?road'),
]
CORR_RE = [re.compile(c[3], re.I) for c in CORR]
def corr_of(t):
    s = (t.get('name', '') + ' | ' + t.get('name:en', '') + ' | ' + t.get('ref', ''))
    for i, rx in enumerate(CORR_RE):
        if rx.search(t.get('name', '')) or rx.search(t.get('name:en', '')): return i
    return -1
EXTRA = {'church', 'brigade'}          # minor streets we still want in the graph for labels
maj = []
for r, p in road_m:
    t = r[2]; h = t['highway']; ci_ = corr_of(t)
    if h in MAJ or (ci_ >= 0 and CORR[ci_][0] in EXTRA and h in ('residential', 'unclassified', 'pedestrian', 'living_street')):
        maj.append((r, p, ci_))
keys = [np.round(r[1][:, 0] * 1e7).astype(np.int64) * 4000000000 + np.round(r[1][:, 1] * 1e7).astype(np.int64) for r, p, c in maj]
allk = np.concatenate(keys)
uk, cnts = np.unique(allk, return_counts=True)
endk = np.concatenate([[k[0], k[-1]] for k in keys])
junc = set(uk[cnts > 1].tolist()) | set(endk.tolist())
node_id = {}; node_xy = []
edges = []
name_ct = collections.Counter()
for (r, p, ci_), kk in zip(maj, keys):
    t = r[2]; h = t['highway']; b = hw_base(h) if h in MAJ else 'tertiary'
    ow = t.get('oneway'); oneway = 1 if (ow in ('yes', '1', 'true') or t.get('junction') == 'roundabout' or b == 'motorway') else (-1 if ow in ('-1', 'reverse') else 0)
    if ow == 'no': oneway = 0
    lvl = 0
    if t.get('bridge') and t.get('bridge') != 'no':
        try: lvl = max(1, int(float(t.get('layer', 1))))
        except ValueError: lvl = 1
    if t.get('tunnel') == 'yes': lvl = -1
    try: lanes = int(float(t.get('lanes', 0)))
    except ValueError: lanes = 0
    if not lanes: lanes = {0: 3, 1: 3, 2: 2, 3: 2, 4: 1}[CLSI[b]] if oneway else {0: 6, 1: 6, 2: 4, 3: 2, 4: 2}[CLSI[b]]
    if b in ('trunk', 'primary', 'motorway'): name_ct[t.get('name')] += 1
    cut = [i for i, k_ in enumerate(kk.tolist()) if k_ in junc]
    for a, bb in zip(cut[:-1], cut[1:]):
        seg = p[a:bb + 1]
        if oneway == -1: seg = seg[::-1]; ka, kb = int(kk[bb]), int(kk[a])
        else: ka, kb = int(kk[a]), int(kk[bb])
        if not ((np.abs(seg[:, 0]) < HALF + 300) & (np.abs(seg[:, 1]) < HALF + 300)).any(): continue
        if len(seg) > 2:
            seg = np.array(LineString(seg).simplify(2.0, preserve_topology=False).coords)
        for kq, pt in ((ka, seg[0]), (kb, seg[-1])):
            if kq not in node_id: node_id[kq] = len(node_xy); node_xy.append(pt)
        edges.append(dict(a=node_id[ka], b=node_id[kb], c=CLSI[b], link=int(h.endswith('_link')), ow=int(oneway != 0), lvl=lvl, lanes=min(lanes, 8), corr=ci_, pts=np.round(seg).astype(np.int32)))
node_xy = np.array(node_xy)
log(' graph nodes', len(node_xy), 'edges', len(edges), 'pts', sum(len(e['pts']) for e in edges))
log(' top arterial names', name_ct.most_common(40))
# traffic signals -> nearest graph node (<= 20 m)
from scipy.spatial import cKDTree
kt = cKDTree(node_xy)
sig = [n for n in nodes if n[3].get('highway') == 'traffic_signals']
sx, sy = ll_to_m([n[1] for n in sig], [n[2] for n in sig])
d, ii = kt.query(np.column_stack([sx, sy]))
signal_nodes = sorted(set(int(i) for i, dd in zip(ii, d) if dd < 20))
log(' signals', len(sig), '->', len(signal_nodes))

# ----------------------------------------------------------------------------- metro
log('metro...')
rail_by_id = {r[0]: r for r in L['rails']}
METRO = [  # key, name, kannada, colour, relation id (one direction), status on REFERENCE_DATE, note
 ('purple', 'Purple Line', 'ನೇರಳೆ ಮಾರ್ಗ', '#8e3aa8', 7841331, 'operational', 'Challaghatta - Whitefield (Kadugodi)'),
 ('green', 'Green Line', 'ಹಸಿರು ಮಾರ್ಗ', '#1f9d4d', 7842287, 'operational', 'Madavara - Silk Institute'),
 ('yellow', 'Yellow Line', 'ಹಳದಿ ಮಾರ್ಗ', '#e2b100', 19421944, 'operational', 'RV Road - Bommasandra (opened Aug 2025)'),
 ('pink', 'Pink Line (elevated section)', 'ಗುಲಾಬಿ ಮಾರ್ಗ', '#e8559d', 21817260, 'operational', 'Kalena Agrahara - Tavarekere; inaugurated 13 Nov 2026, public service from 14 Nov 2026'),
]
rel_by_id = {r[0]: r for r in L['rels']}
metro = []; used_ways = set()
def chain(way_ids):
    segs = []
    for wid in way_ids:
        r = rail_by_id.get(wid)
        if r is None: continue
        used_ways.add(wid)
        segs.append((to_m(r[1]), r[2].get('tunnel') == 'yes' or r[2].get('layer', '0').startswith('-')))
    if not segs: return None, None
    pts = [segs[0][0]]; tun = [np.full(len(segs[0][0]), segs[0][1])]
    # orient first segment using the second
    if len(segs) > 1:
        a, b2 = segs[0][0], segs[1][0]
        d_end = min(np.hypot(*(a[-1] - b2[0])), np.hypot(*(a[-1] - b2[-1]))); d_start = min(np.hypot(*(a[0] - b2[0])), np.hypot(*(a[0] - b2[-1])))
        if d_start < d_end: pts[0] = a[::-1]
    for s, tn in segs[1:]:
        endp = pts[-1][-1]
        if np.hypot(*(s[-1] - endp)) < np.hypot(*(s[0] - endp)): s = s[::-1]
        pts.append(s); tun.append(np.full(len(s), tn))
    return np.vstack(pts), np.concatenate(tun)
for key, name, kn, col, rid, status, note in METRO:
    rel = rel_by_id.get(rid)
    if rel is None: log('  !! metro relation missing', key); continue
    wids = [m[1] for m in rel[2] if m[0] == 'w' and m[1] in rail_by_id and rail_by_id[m[1]][2].get('railway') in ('subway', 'construction', 'light_rail')]
    pts, tun = chain(wids)
    gaps = np.hypot(*np.diff(pts, axis=0).T)
    ls = LineString(pts)
    log('  ', key, 'ways', len(wids), 'km', round(ls.length / 1000, 2), 'max gap m', round(float(gaps.max())), 'tunnel km', round(float(gaps[tun[1:] & tun[:-1]].sum()) / 1000, 2),
        'osm tags', collections.Counter(rail_by_id[w][2].get('railway') for w in wids))
    # simplify while keeping tunnel flags: simplify runs separately
    outp, outt = [], []
    s = 0
    for e in range(1, len(pts) + 1):
        if e == len(pts) or tun[e] != tun[s]:
            run = pts[s:e + 1] if e < len(pts) else pts[s:e]
            if len(run) >= 2:
                run = np.array(LineString(run).simplify(3.0, preserve_topology=False).coords)
                outp.append(run); outt.append(np.full(len(run), tun[s]))
            s = e
    P = np.vstack(outp); T = np.concatenate(outt)
    metro.append(dict(key=key, name=name, kn=kn, colour=col, status=status, note=note, relation=rid, km=round(ls.length / 1000, 2), pts=np.round(P).astype(np.int32), tun=T.astype(np.uint8), line=ls))
# under construction / proposed track geometry present in OSM
uc = []
for r in L['rails']:
    t = r[2]
    st = None
    if t.get('railway') == 'construction' and t.get('construction') in ('subway', 'light_rail'): st = 'construction'
    elif t.get('railway') == 'proposed' and t.get('proposed') in ('subway', 'light_rail', None): st = 'proposed'
    elif t.get('railway') == 'subway' and r[0] not in used_ways and t.get('service') is None: st = 'unassigned'
    if st:
        p = to_m(r[1]); uc.append((st, p, t, r[0]))
# OSM tags some not-yet-open track as railway=subway. Operational status is NOT taken from that tag: only track that belongs to
# the in-service route relations above counts as operational. Remaining named Phase-2A/2B (Blue) and Pink ways are under construction
# on the reference date (BMRCL / press, see docs/SOURCES.md).
op_union = unary_union([m['line'] for m in metro]).buffer(45)
uc2 = []
for st, p, t, wid in uc:
    nm = t.get('name', '') or ''
    ls = LineString(p)
    line = 'blue' if re.search(r'2A|2B|Blue', nm) else 'pink' if re.search('Pink', nm) else None
    if st == 'unassigned':
        if ls.intersection(op_union).length > 0.6 * ls.length or line is None: continue      # second running track / depot leads
        st = 'construction'
    tun = t.get('tunnel') == 'yes' or str(t.get('layer', '0')).startswith('-')
    if st == 'construction' and line is None: line = 'blue' if not tun else 'pink'
    uc2.append(dict(status=st, line=line, tunnel=bool(tun), name=nm, way=wid, geom=ls))
log(' metro not in service:', {(k_): round(sum(u_['geom'].length for u_ in uc2 if (u_['status'], u_['line'], u_['tunnel']) == k_) / 1000, 1) for k_ in sorted(set((u_['status'], u_['line'], u_['tunnel']) for u_ in uc2), key=str)})

# stations
st_nodes = [n for n in nodes if n[3].get('railway') in ('station', 'halt', 'construction', 'proposed') or n[3].get('station') == 'subway']
stations, rail_stations = [], []
seen = {}
for n in st_nodes:
    t = n[3]; nm = t.get('name')
    if not nm: continue
    x, y = map(float, ll_to_m(n[1], n[2]))
    if abs(x) > HALF or abs(y) > HALF: continue
    is_metro = t.get('station') == 'subway' or t.get('subway') == 'yes' or t.get('construction') == 'subway' or 'Metro' in nm
    if is_metro:
        pt = Point(x, y)
        best = min(metro, key=lambda m: m['line'].distance(pt))
        dline = best['line'].distance(pt)
        if dline < 90 and t.get('railway') == 'station':
            status, line = 'operational', best['key']
        else:
            status, line = ('construction' if t.get('railway') in ('construction',) or dline >= 90 else 'operational'), (best['key'] if dline < 90 else None)
            if t.get('railway') == 'proposed': status = 'proposed'
        kq = (nm, line)
        if kq in seen and math.hypot(x - seen[kq][0], y - seen[kq][1]) < 400: continue
        seen[kq] = (x, y)
        stations.append(dict(name=nm, kn=t.get('name:kn'), line=line, status=status, osm_id=n[0], lon=n[1], lat=n[2], x=round(x / CELL_M, 1), z=round(-y / CELL_M, 1), osm_railway=t.get('railway')))
    elif t.get('railway') in ('station', 'halt'):
        rail_stations.append(dict(name=nm, kn=t.get('name:kn'), osm_id=n[0], lon=n[1], lat=n[2], x=round(x / CELL_M, 1), z=round(-y / CELL_M, 1), halt=t.get('railway') == 'halt'))
uc_union = unary_union([u_['geom'] for u_ in uc2 if u_['status'] == 'construction']) if uc2 else None
for i in sel(lambda t: t.get('landuse') == 'construction' and t.get('name', '').endswith('Metro Station')):
    c = ageom[i].centroid
    if abs(c.x) > HALF or abs(c.y) > HALF: continue
    lon, lat = m_to_ll(c.x, c.y)
    nm = atag[i]['name'].replace(' Metro Station', '')
    if any(s_['name'] == nm for s_ in stations): continue
    stations.append(dict(name=nm, kn=atag[i].get('name:kn'), line=None, status='construction', osm_id=aid[i][1], lon=float(lon), lat=float(lat), x=round(c.x / CELL_M, 1), z=round(-c.y / CELL_M, 1), osm_railway='landuse=construction'))
for s_ in stations:
    if s_['status'] != 'operational' and s_['line'] is None and uc2:
        near = min(uc2, key=lambda u_: u_['geom'].distance(Point(s_['x'] * CELL_M, -s_['z'] * CELL_M)))
        if near['geom'].distance(Point(s_['x'] * CELL_M, -s_['z'] * CELL_M)) < 150: s_['line'] = near['line']
log(' metro stations', collections.Counter((s['line'], s['status']) for s in stations), 'rail stations', len(rail_stations))

# ----------------------------------------------------------------------------- labels: lakes, parks, places, boundaries
lakes = []
for i in i_water:
    t = atag[i]
    if 'name' in t and aarea[i] >= 40000:
        g = ageom[i].intersection(EXT)
        if g.is_empty or g.area < 0.5 * aarea[i]: continue
        c = g.representative_point(); lon, lat = m_to_ll(c.x, c.y)
        lakes.append(dict(name=t['name'], kn=t.get('name:kn'), osm_type=aid[i][0], osm_id=aid[i][1], area_ha=round(aarea[i] / 1e4, 1), lon=round(float(lon), 6), lat=round(float(lat), 6),
                          x=round(c.x / CELL_M, 1), z=round(-c.y / CELL_M, 1), _i=i))
lakes.sort(key=lambda l: -l['area_ha'])
dd = {}
for l in lakes: dd.setdefault(l['name'], l)
lakes = list(dd.values())
log(' named lakes >=4ha', len(lakes), [(l['name'], l['area_ha']) for l in lakes[:25]])
parks = []
for i in i_park + i_wood:
    t = atag[i]
    if 'name' in t and aarea[i] >= 80000:
        c = ageom[i].representative_point(); lon, lat = m_to_ll(c.x, c.y)
        if abs(c.x) < HALF and abs(c.y) < HALF:
            parks.append(dict(name=t['name'], kn=t.get('name:kn'), osm_type=aid[i][0], osm_id=aid[i][1], area_ha=round(aarea[i] / 1e4, 1), lon=round(float(lon), 6), lat=round(float(lat), 6), x=round(c.x / CELL_M, 1), z=round(-c.y / CELL_M, 1), _i=i))
parks.sort(key=lambda l: -l['area_ha'])
log(' named parks >=8ha', [(p['name'], p['area_ha']) for p in parks[:30]])

PLACES = [  # label, tier (1 = shown from far), OSM name candidates
 ('Majestic', 1, ['Majestic', 'Gandhi Nagar', 'Gandhinagar']), ('Shivajinagar', 2, ['Shivajinagar', 'Shivaji Nagar']), ('Chickpet', 2, ['Chickpet', 'Chikkapete', 'Chikpete']),
 ('Indiranagar', 1, ['Indiranagar', 'Indira Nagar']), ('Domlur', 2, ['Domlur', 'Domluru']), ('Marathahalli', 1, ['Marathahalli', 'Marathalli', 'Marathahalli Village']), ('Brookefield', 2, ['Brookefield', 'Brookfield']),
 ('Whitefield', 1, ['Whitefield']), ('Kadugodi', 2, ['Kadugodi']), ('Hoodi', 2, ['Hoodi']), ('Mahadevapura', 2, ['Mahadevapura']), ('KR Puram', 1, ['Krishnarajapura', 'Krishnarajapuram', 'KR Puram', 'K.R. Puram', 'K R Puram']),
 ('Koramangala', 1, ['Koramangala']), ('HSR Layout', 1, ['HSR Layout', 'H.S.R. Layout']), ('Bellandur', 1, ['Bellandur', 'Bellanduru']), ('Varthur', 2, ['Varthur', 'Varthuru']),
 ('Jayanagar', 1, ['Jayanagar', 'Jayanagara']), ('JP Nagar', 1, ['JP Nagar', 'J. P. Nagar', 'J.P. Nagar', 'J P Nagar', 'Jayaprakash Nagar', 'JP Nagar 2nd Phase', 'J. P. Nagar 2nd Phase']), ('BTM Layout', 1, ['BTM Layout', 'B.T.M. Layout', 'BTM 2nd Stage', 'BTM Layout 2nd Stage']),
 ('Banashankari', 1, ['Banashankari', 'Banashankari 2nd Stage', 'Banashankari Stage II']), ('Basavanagudi', 2, ['Basavanagudi']), ('Electronic City', 1, ['Electronic City', 'Electronics City', 'Electronic City Phase 1', 'Electronic City Phase I']),
 ('Bommanahalli', 2, ['Bommanahalli']), ('Bommasandra', 2, ['Bommasandra']), ('Begur', 2, ['Begur', 'Beguru']), ('Hulimavu', 2, ['Hulimavu']),
 ('Hebbal', 1, ['Hebbal', 'Hebbala']), ('Nagawara', 2, ['Nagawara', 'Nagavara']), ('Yelahanka', 1, ['Yelahanka']), ('Jakkur', 2, ['Jakkur', 'Jakkuru']), ('Vidyaranyapura', 2, ['Vidyaranyapura']),
 ('Thanisandra', 2, ['Thanisandra']), ('Hennur', 2, ['Hennur', 'Hennuru']), ('Banaswadi', 2, ['Banaswadi', 'Banasawadi', 'Banasavadi']), ('Kalyan Nagar', 2, ['Kalyan Nagar', 'Kalyana Nagara']), ('RT Nagar', 2, ['RT Nagar', 'R.T. Nagar', 'Rabindranath Tagore Nagar']),
 ('Rajajinagar', 1, ['Rajajinagar', 'Rajaji Nagar', 'Rajajinagara']), ('Malleshwaram', 1, ['Malleshwaram', 'Malleswaram', 'Malleshwara', 'Malleshwarama']), ('Yeshwantpur', 1, ['Yeshwantpur', 'Yeshwanthpur', 'Yeshwanthapura', 'Yesvantpur', 'Yeshwantpura']),
 ('Vijayanagar', 1, ['Vijayanagar', 'Vijayanagara', 'Vijaya Nagar']), ('RR Nagar', 1, ['Rajarajeshwari Nagar', 'Rajarajeshwari Nagara', 'RR Nagar', 'Raja Rajeshwari Nagar', 'Rajarajeshwarinagar']), ('Kengeri', 1, ['Kengeri']),
 ('Peenya', 2, ['Peenya', 'Peenya Industrial Area']), ('Dasarahalli', 2, ['Dasarahalli', 'T. Dasarahalli']), ('Jalahalli', 2, ['Jalahalli']), ('Nagarbhavi', 2, ['Nagarbhavi', 'Nagarabhavi']),
 ('Uttarahalli', 2, ['Uttarahalli']), ('Sadashivanagar', 2, ['Sadashivanagar', 'Sadashiva Nagar', 'Sadashivanagara']), ('Ulsoor', 2, ['Ulsoor', 'Halasuru']), ('Frazer Town', 2, ['Frazer Town', 'Pulakeshi Nagar', 'Pulikeshi Nagar']),
 ('Chamarajpet', 2, ['Chamarajpet', 'Chamrajpet', 'Chamarajapete']), ('Sarjapur Road', 2, ['Kaikondrahalli', 'Kasavanahalli']), ('CV Raman Nagar', 2, ['C V Raman Nagar', 'CV Raman Nagar', 'C. V. Raman Nagar']), ('Kumaraswamy Layout', 2, ['Kumaraswamy Layout']),
]
norm = lambda s: re.sub(r'[^a-z0-9]', '', s.lower())
place_nodes = collections.defaultdict(list)
PRI = {'suburb': 0, 'quarter': 1, 'town': 1, 'neighbourhood': 2, 'village': 3, 'locality': 4, 'hamlet': 5}
for n in nodes:
    if n[3].get('place') in PRI and 'name' in n[3]:
        place_nodes[norm(n[3]['name'])].append(n)
        if 'name:en' in n[3]: place_nodes[norm(n[3]['name:en'])].append(n)
places = []
for label, tier, cands in PLACES:
    hit = None
    for c in cands:
        if norm(c) in place_nodes:
            hit = min(place_nodes[norm(c)], key=lambda n: PRI[n[3]['place']]); break
    if not hit: log('  !! place not found, omitted:', label); continue
    x, y = map(float, ll_to_m(hit[1], hit[2]))
    if abs(x) > HALF or abs(y) > HALF: log('  place outside extent', label); continue
    note = 'label uses common name; anchored to OSM place node "%s"' % hit[3]['name']
    places.append(dict(name=label, kn=hit[3].get('name:kn'), tier=tier, osm_id=hit[0], osm_name=hit[3]['name'], osm_place=hit[3]['place'], lon=hit[1], lat=hit[2], x=round(x / CELL_M, 1), z=round(-y / CELL_M, 1), note=note))
log(' places', len(places))

bounds = []
for i in sel(lambda t: t.get('boundary') == 'administrative' and t.get('admin_level') == '8' and 'City Corporation' in t.get('name', '')):
    g = ageom[i].simplify(40)
    for poly in (g.geoms if g.geom_type == 'MultiPolygon' else [g]):
        ring = np.array(poly.exterior.coords)
        bounds.append(dict(name=atag[i]['name'], osm_id=aid[i][1], pts=np.round(ring).astype(np.int32)))
log(' corp boundaries', [(b['name'], len(b['pts'])) for b in bounds])
corp_union = unary_union([ageom[i] for i in sel(lambda t: t.get('boundary') == 'administrative' and t.get('admin_level') == '8' and 'City Corporation' in t.get('name', ''))])
log(' GBA corporations area km2', round(corp_union.area / 1e6, 1), 'inside extent km2', round(corp_union.intersection(EXT).area / 1e6, 1))

# bus stops, markets, shop density
def npts(pred):
    q = [n for n in nodes if pred(n[3])]
    if not q: return np.zeros((0, 2), np.int32)
    x, y = ll_to_m([n[1] for n in q], [n[2] for n in q]); m = (np.abs(x) < HALF) & (np.abs(y) < HALF)
    return np.round(np.column_stack([x[m], y[m]])).astype(np.int32)
bus_stops = npts(lambda t: t.get('highway') == 'bus_stop')
markets = npts(lambda t: t.get('amenity') == 'marketplace')
mk_areas = [ageom[i].representative_point() for i in sel(lambda t: t.get('amenity') == 'marketplace')]
if mk_areas: markets = np.vstack([markets, np.round([[p.x, p.y] for p in mk_areas if abs(p.x) < HALF and abs(p.y) < HALF]).astype(np.int32).reshape(-1, 2)])
shops = npts(lambda t: 'shop' in t or t.get('amenity') in ('cafe', 'restaurant'))
shopg = np.zeros((NG, NG), np.float32)
np.add.at(shopg, (np.clip(((HALF - shops[:, 1]) / 100).astype(int), 0, NG - 1), np.clip(((shops[:, 0] + HALF) / 100).astype(int), 0, NG - 1)), 1)
shopg = np.clip(ndi.gaussian_filter(shopg, 1.0) * 12, 0, 255).astype(np.uint8)
log(' bus stops', len(bus_stops), 'markets', len(markets), 'shops', len(shops))

# peripheral marker: Kempegowda International Airport (outside extent)
kx, ky = map(float, ll_to_m(77.7068, 13.1989))
periph = [dict(name='Kempegowda Intl Airport (KIA)', kn='ಕೆಂಪೇಗೌಡ ಅಂತಾರಾಷ್ಟ್ರೀಯ ವಿಮಾನ ನಿಲ್ದಾಣ', lon=77.7068, lat=13.1989, true_x=round(kx / CELL_M, 1), true_z=round(-ky / CELL_M, 1),
               x=round(kx / CELL_M, 1), z=-HALF / CELL_M, beyond_km=round((ky - HALF) / 1000, 1), source='airport reference point (ARP), approx.', confidence='medium')]

from pyproj import Proj
_f = Proj('EPSG:32643').get_factors(ORIGIN_LON, ORIGIN_LAT); CONV, KSC = _f.meridian_convergence, _f.meridional_scale
log(' grid convergence deg', CONV, 'scale factor', KSC)
# ----------------------------------------------------------------------------- pack
def b64z(arr): return base64.b64encode(zlib.compress(np.ascontiguousarray(arr).tobytes(), 9)).decode()
def pack_lines(lines):
    """list of int32 (n,2) arrays in metres -> delta-encoded int16 stream + counts"""
    counts = np.array([len(l) for l in lines], np.uint16)
    stream = []
    for l in lines:
        l = np.clip(l, -32000, 32000)
        d = np.diff(l, axis=0, prepend=np.zeros((1, 2), l.dtype)); stream.append(d)
    s = np.vstack(stream).astype(np.int16) if stream else np.zeros((0, 2), np.int16)
    return dict(n=b64z(counts), d=b64z(s), count=len(lines))
E = edges
corr_out = []
for i, c in enumerate(CORR):
    es = [e for e in E if e['corr'] == i]
    if not es: log('  !! corridor has no ways:', c[0]); corr_out.append(dict(key=c[0], name=c[1], kn=c[2], labels=[], km=0)); continue
    mids = np.array([e['pts'][len(e['pts']) // 2] for e in es]); lens = np.array([LineString(e['pts']).length if len(e['pts']) > 1 else 0 for e in es])
    ctr = mids.mean(0); _, _, vt = np.linalg.svd(mids - ctr, full_matrices=False); proj = (mids - ctr) @ vt[0]
    o = np.argsort(proj); cum = np.cumsum(lens[o]) / lens.sum()
    qs = [0.5] if lens.sum() < 6000 else [0.2, 0.5, 0.8] if lens.sum() < 60000 else [0.1, 0.3, 0.5, 0.7, 0.9]
    labs = [mids[o[min(np.searchsorted(cum, q), len(o) - 1)]] for q in qs]
    corr_out.append(dict(key=c[0], name=c[1], kn=c[2], km=round(float(lens.sum()) / 1000, 1), labels=[[round(float(p[0]) / CELL_M, 1), round(float(-p[1]) / CELL_M, 1)] for p in labs]))
log(' corridors km', [(c['key'], c['km']) for c in corr_out])

data = dict(
    meta=dict(reference_date=REFERENCE_DATE, seed=SEED, origin_lonlat=[ORIGIN_LON, ORIGIN_LAT], origin_utm=[E0, N0], crs='EPSG:32643', cell_m=CELL_M, n=N, extent_m=EXTENT_M,
              dem_step=DEM_STEP, dem_min=dmin, bbox_lonlat=[float(v) for v in np.concatenate(m_to_ll(np.array([-HALF, HALF]), np.array([-HALF, HALF])))],
              corners_lonlat=[[float(a) for a in m_to_ll(sx_ * HALF, sy_ * HALF)] for sx_, sy_ in ((-1, 1), (1, 1), (-1, -1), (1, -1))],
              osm_timestamp='2026-11-12T21:23:05Z', convergence_deg=round(float(CONV), 4), scale_factor=round(float(KSC), 6), bld0=BLD0, height_step_m=1.6),
    cls=b64z(out), dem=b64z(dem_q), zone=b64z(zone), shop=b64z(shopg), src=None,
    nodes=b64z(np.round(node_xy).astype(np.int16)), n_nodes=len(node_xy),
    edges=dict(attr=b64z(np.array([[e['a'], e['b'], e['c'] | (e['link'] << 3) | (e['ow'] << 4), e['lvl'] + 2, e['lanes'], e['corr'] + 1] for e in E], np.uint16)), geom=pack_lines([e['pts'] for e in E])),
    signals=signal_nodes,
    corridors=corr_out,
    metro=[dict(key=m['key'], name=m['name'], kn=m['kn'], colour=m['colour'], status=m['status'], note=m['note'], km=m['km'], pts=m['pts'].ravel().tolist(), tun=''.join(map(str, m['tun'].tolist()))) for m in metro],
    metro_uc=[dict(status=u_['status'], line=u_['line'], tunnel=int(u_['tunnel']), pts=np.round(np.array(u_['geom'].simplify(4).coords)).astype(int).ravel().tolist()) for u_ in uc2 if u_['geom'].intersects(EXT)],
    stations=[{k: v for k, v in s.items() if k in ('name', 'kn', 'line', 'status', 'x', 'z')} for s in stations],
    rail_stations=[{k: v for k, v in s.items() if k in ('name', 'kn', 'x', 'z', 'halt')} for s in rail_stations],
    rail=pack_lines([np.round(np.array(l.simplify(4).coords)).astype(np.int32) for l in rail_lines if l.intersects(EXT) and l.length > 150]),
    landmarks=[{k: v for k, v in l.items() if k in ('key', 'label', 'kn', 'kind', 'model', 'x', 'z', 'obb', 'lon', 'lat')} for l in landmarks],
    lakes=[{k: v for k, v in l.items() if k in ('name', 'kn', 'area_ha', 'x', 'z')} for l in lakes],
    parks=[{k: v for k, v in p.items() if k in ('name', 'kn', 'area_ha', 'x', 'z')} for p in parks[:40]],
    places=[{k: v for k, v in p.items() if k in ('name', 'kn', 'tier', 'x', 'z')} for p in places],
    bounds=[dict(name=b['name'], pts=b['pts'].ravel().tolist()) for b in bounds],
    bus_stops=b64z(bus_stops.astype(np.int16)), markets=markets.tolist(), periph=periph,
)
del data['src']
js = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
open(OUT + '/scene_data.json', 'w', encoding='utf8').write(js)
log('scene_data.json MB', round(len(js.encode()) / 1e6, 2), {k: round(len(json.dumps(v)) / 1e6, 2) for k, v in data.items() if len(json.dumps(v)) > 30000})

# manifest (machine readable, includes source coordinates + OSM ids for independent checking)
def clean(d): return {k: v for k, v in d.items() if not k.startswith('_')}
manifest = dict(reference_date=REFERENCE_DATE, crs_chain='EPSG:4326 -> EPSG:32643 -> scene (x = (E-E0)/10, z = -(N-N0)/10)', origin_utm=[E0, N0], origin_lonlat=[ORIGIN_LON, ORIGIN_LAT],
                osm_extract='Geofabrik southern-zone-261112 (timestamp 2026-11-12T21:23:05Z)',
                landmarks=landmarks, lakes=[clean(l) for l in lakes], parks=[clean(p) for p in parks[:40]], places=places, metro_stations=stations, rail_stations=rail_stations,
                metro_lines=[dict(key=m['key'], name=m['name'], status=m['status'], note=m['note'], osm_relation=m['relation'], km=m['km']) for m in metro],
                corridors=corr_out, peripheral=periph, admin_boundaries=[dict(name=b['name'], osm_relation=b['osm_id']) for b in bounds])
json.dump(manifest, open(DOCS + '/manifest.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1, default=lambda o: o.item() if hasattr(o, 'item') else str(o))
pickle.dump(dict(lake_idx=[l['_i'] for l in lakes], park_idx=[p['_i'] for p in parks[:40]]), open(OUT + '/idx.pkl', 'wb'))
log('done')
