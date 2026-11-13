# Voxel Bengaluru · ವೋಕ್ಸೆಲ್ ಬೆಂಗಳೂರು

A geographically grounded, explorable voxel miniature of Bengaluru in **one offline HTML file** (`voxel-bengaluru.html`, 7.2 MB).
Every lake, road, rail line, Metro station, park and named landmark sits where OpenStreetMap puts it; nothing named is placed by hand or at random.

- **Reference date for infrastructure status:** 13 November 2026.
- **Open it:** double-click `voxel-bengaluru.html` (any current desktop browser with WebGL 2). No server, no network.

## What is modelled

| | |
|---|---|
| Extent | 38.4 × 38.4 km square centred on 12.965° N, 77.62° E (Kengeri to beyond Whitefield, Electronic City to Yelahanka) |
| Boundary definition | The **municipal** one: the five Greater Bengaluru Authority city corporations (OSM admin level 8), 717.2 km², of which 716.9 km² is inside the square. Shown by the *City corporations* toggle. The square also includes the surrounding built-up fringe; it is not the metropolitan region. |
| Scale | 1 scene unit = 10 m, uniform everywhere. No district is enlarged or moved. |
| Projection | WGS84 → UTM zone 43N (EPSG:32643) → scene (+X east, −Z north, +Y up). Scene north is UTM grid north, 0.59° clockwise of true north. |
| Exaggeration | Terrain ×3, building height ×1.5, vehicles and people ×1.6 (so they are visible), traffic time-lapse ×2. Horizontal positions are never exaggerated. |
| Airport | Kempegowda International Airport lies 6.8 km beyond the northern edge, so it is a labelled edge marker at its true bearing, not a model. |

## Controls

| Input | Action |
|---|---|
| Drag / right-drag / wheel | Orbit, pan, zoom |
| `W A S D` or arrows | Pan (orbit mode) or fly (fly mode); `Q`/`E` down/up, `Shift` faster |
| `M` | Switch orbit ↔ fly |
| `1`–`9` | Presets: Entire Bengaluru · Central · Bellandur Lake & ORR · Whitefield · Koramangala & HSR · Electronic City · Hebbal & north · West · Street level (MG Road) |
| `R` | Reset camera |
| `N` | Day ↔ evening |
| `F` | Freeze / resume animation |
| `B` | Bloom on/off |
| `L` | Labels on/off |
| `H` | Hide / show the interface |
| Buttons | Roads overlay, Metro & rail overlay, city-corporation boundaries, minimap (click it to jump), quality normal/low |

URL options: `?quality=low`, `?seed=<n>`, `?night=1`, `?ui=0`, `?bloom=0`, `?shadows=0`, `?dynres=0`, `?msaa=<n>`, `?pr=<pixel ratio>`, `?norender=1` (profiling only: skips drawing).
The seed changes only procedural detail (façade colours, tree placement, traffic); geography is identical for every seed.

**Low-quality fallback** (`?quality=low` or the Quality button): no shadows, no bloom, pixel ratio 1, shorter detail radius, 1,200 vehicles instead of 3,500.

## Rebuild

```bash
python3 build.py            # src/ + vendor/ + data/processed/scene_data.json -> voxel-bengaluru.html (stdlib only)
```

Regenerate the geographic data (needs ~2 GB RAM, ~6 min; Python 3.11+):

```bash
pip install osmium shapely pyproj rasterio scipy numpy pillow
# download the inputs listed in docs/SOURCES.md into the folder named by RAW in tools/config.py
cd tools
python3 01_extract_osm.py   # OSM PBF -> pickles (~5 min)
python3 02_build_data.py    # rasters, road graph, Metro, landmarks -> data/processed/scene_data.json, docs/manifest.json (~1 min)
python3 03_validate.py      # docs/validation/geo_validation.json + topdown_vs_reference.png
cd .. && python3 build.py
```

Tests (Node 20 + Playwright Chromium; the scripts import Playwright from `/home/user/.cache/vb/node_modules` — adjust the path):

```bash
node tests/run_tests.mjs                       # 17 functional checks -> docs/validation/functional_tests.json
node tests/perf.mjs low|normal                 # -> docs/validation/perf_*.json
node tests/shot.mjs out.png <preset 0-8> <night 0|1> "<query>"
```

## Layout

```
voxel-bengaluru.html      the deliverable
build.py                  single-file builder
src/index.html, style.css template and UI styles
src/js/00_core.js         data decoding, constants, hashing/seed
src/js/10_env.js          terrain mesh, sky, light, shared voxel material
src/js/20_city.js         district grammar, chunks, three levels of detail
src/js/30_landmarks.js    hand-built landmark models (positions from data)
src/js/40_infra.js        flyovers, Metro viaducts and stations, rail, overlays
src/js/50_life.js         traffic, Metro trains, pedestrians, signage
src/js/60_ui.js           presets, toggles, labels, minimap, compass
src/js/90_main.js         boot, quality presets, render loop, test API
vendor/                   three.js r170 bundle + licence
tools/                    preprocessing pipeline and validation
data/processed/           runtime data + intermediate rasters
docs/                     SOURCES, validation and performance reports, manifest.json, recognition-test protocol
tests/, screenshots/
```

## Attribution

Map data © OpenStreetMap contributors (ODbL 1.0) · © ESA WorldCover project 2021 / contains modified Copernicus Sentinel data (CC BY 4.0) ·
Copernicus DEM GLO-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA ·
GHSL GHS-BUILT-H R2023A © European Union, JRC (CC BY 4.0) · three.js © three.js authors (MIT).
The same credit line is permanently visible in the page. Details: `docs/SOURCES.md`.
The embedded data is a derived database of OpenStreetMap and stays under ODbL.

## What is verified, estimated, stylised, omitted

See the table at the end of `docs/GEOGRAPHIC_VALIDATION.md`. In short:

- **From mapped data (positions tested):** lake outlines, road network and classes, rail, Metro alignments and stations, parks, 39 named landmarks/campuses, building footprints where OSM has them, city-corporation boundaries.
- **Estimated:** 98 % of building heights (neighbourhood averages); landmark model heights; the Lalbagh Glass House footprint (OSM has only a point); road widths from class and lane tags.
- **Stylised:** architecture of every generic building, façade colours, trees, street furniture, all traffic and pedestrians (plausible, not observed), Metro train timetable, sign texts (generic bilingual shop-type words, no real business names).
- **Omitted:** KIA (outside the extent), proposed Metro lines in 3D, underground track, minor lanes' individual character, interiors, real-time anything. A "Yeshwantpur" district label is missing (no matching OSM place node); the Yesvantpur Junction station is present.

## Known limitations

- Performance on real GPU hardware has **not** been measured; only software rendering was available during development (`docs/PERFORMANCE.md`).
- The blind recognition test is designed but **not run** (`docs/RECOGNITION_TEST.md`).
- Land cover is from 2021 and height estimates from 2018, so the newest peripheral development is under-represented.
- The Pink Line elevated section is shown operational; it was inaugurated on the reference date with public service starting the next day.
- Metro status rests on secondary sources (Wikipedia, press), not on BMRCL documents.
- Flyovers are raised wherever OSM tags `bridge`/`layer`; ramp shapes are schematic.
- Building blocks are generalised to a 10 m grid, so narrow lanes and small houses merge.
