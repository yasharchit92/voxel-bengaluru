# Sources, licences and limitations

All data was acquired on **2026-11-13**. Infrastructure status is stated for the reference date **13 November 2026**.
Priority order used when sources disagree: OSM geometry > official/BMRCL-derived status > land cover > DEM > secondary.

| # | Source | Used for | Licence | Version / date | Coverage | Limitations |
|---|---|---|---|---|---|---|
| 1 | **OpenStreetMap**, Geofabrik extract `southern-zone-261112.osm.pbf` | Roads (198,196 ways), road graph, rail, Metro alignments and stations, building footprints (822,096 rings), lakes, parks, land use, place names, Kannada names (`name:kn`), bus stops, shops, signals, administrative boundaries | ODbL 1.0 — © OpenStreetMap contributors | data to 2026-11-12T21:23:05Z | whole extent | Volunteer data: building coverage is uneven (dense in the core, sparse on the periphery); only 14,199 of 822,096 buildings carry a height/levels tag; `railway=subway` tagging does not reliably distinguish open from unopened track. |
| 2 | **ESA WorldCover 10 m 2021 v200**, tile N12E075 | Ground cover where OSM has no polygon: tree cover, cropland, grass, scrub, bare, built-up, water, wetland | CC BY 4.0 — © ESA WorldCover project 2021 / contains modified Copernicus Sentinel data | 2021 | whole extent | Five years older than the reference date: recent peripheral development appears as cropland/scrub unless OSM maps it. |
| 3 | **Copernicus DEM GLO-30** (tiles N12 E077, N13 E077) | Terrain | Free use with attribution — © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA | 2011–2015 acquisition | whole extent | It is a *surface* model (includes buildings and canopy); it is smoothed before use, so only the broad ridge-and-valley form is kept. Raw 702.6–987.0 m, composed 704.0–971.1 m. |
| 4 | **GHSL GHS-BUILT-H R2023A** (AGBH, ANBH, 100 m, tile R8_C26) | Neighbourhood-level building-height estimates where OSM has no height tag | CC BY 4.0 — © European Union, JRC | epoch 2018 | whole extent | 100 m averages, not per-building truth; under-represents towers built after 2018. |
| 5 | Wikipedia: *Namma Metro*, *Pink Line (Namma Metro)* (read 2026-11-13); News18 and StationSeekers reports of the Pink Line opening | Operational status of Metro lines on the reference date | CC BY-SA 4.0 (facts only, no text reused) | 12–13 Nov 2026 | — | Secondary sources. BMRCL's own site was not consulted directly. |
| 6 | Wikipedia article coordinates (MediaWiki API, saved in `docs/validation/wikipedia_coords_2026-11-13.json`) | **Validation only** — independent check of landmark positions | CC BY-SA 4.0 | 2026-11-13 | 26 features | Imprecise: area features use arbitrary interior points; some rounded to 0.01°. Not used to place anything. |
| 7 | three.js r170 (+ OrbitControls, EffectComposer, UnrealBloomPass, OutputPass) | Rendering | MIT (`vendor/THREE-LICENSE`) | 0.170.0 | — | — |

No satellite imagery, photographs or third-party textures are embedded. The HTML contains only derived, generalised
rasters (10 m class grid, 80 m terrain grid, 100 m zone grid) and simplified vectors — not the raw datasets.

## How Metro status was decided (reference date 13 Nov 2026)

| Line | Shown as | Basis |
|---|---|---|
| Purple (43.5 km), Green (33.9 km), Yellow (18.1 km) | operational, trains running | OSM in-service route relations 7841331, 7842287, 19421944 |
| Pink, elevated Kalena Agrahara – Tavarekere (7.6 km, 6 stations) | operational | OSM route relation 21817260; reported inaugurated 13 Nov 2026 with public service from 14 Nov 2026. **Nuance:** on the reference date itself it was inaugurated but not yet carrying fare-paying passengers. |
| Pink, underground Dairy Circle – Nagawara | under construction (no trains, hatched amber, tunnel portals only) | reported opening 2027 |
| Blue (Silk Board – KR Puram – Hebbal – KIA) | under construction (bare viaduct, no trains) | reported opening 2027/28; no OSM route relation exists |
| Orange, Red and other planned lines | not built in 3D; dotted grey in the Metro overlay only | OSM `proposed` ways |

Operational length in the model: 103.1 km against 103.6 km reported — a 0.5 km (0.5 %) difference.

## Building heights

Missing height is **not** treated as low-rise. Order of preference per building:
1. OSM `height`, else `building:levels` × 3.2 m + 1 m (14,199 buildings — *tagged*).
2. GHSL mean building height of the surrounding 100 m cell, adjusted by OSM building type, footprint area, land-use zone (apartment blocks, tech-park offices, commercial blocks are raised; sheds and industrial units capped at 6–14 m) and a deterministic hash (807,897 buildings — *estimated*).
3. Where WorldCover says built-up but OSM has no footprints (615,313 cells, mostly periphery), buildings are generated procedurally from GHSL height and the land-use zone — *stylised*.

Result: height percentiles p10/p50/p90/p99/p99.9 = 5.5 / 8.7 / 16.6 / 30.4 / 71.4 m (before the ×1.5 display exaggeration).
