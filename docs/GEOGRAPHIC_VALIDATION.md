# Geographic validation report

Reference date 13 Nov 2026 · tests run 13 Nov 2026 · reproducible with `tools/03_validate.py` and `tests/run_tests.mjs`.
Machine-readable results: `docs/validation/geo_validation.json`, `docs/validation/functional_tests.json`, feature manifest `docs/manifest.json`.

## What was and was not tested

| Claim | Tested? | How |
|---|---|---|
| The WGS84 → UTM 43N → scene chain is implemented correctly | **Yes** | Independent Krüger-series projection (no pyproj) on all 412 manifest features |
| Named landmarks are where an independent source says they are | **Partly** | 26 features against Wikipedia article coordinates (an imprecise reference) |
| Landmark placement is not random | **Yes** | Null test, 2,000 random placements |
| Features sit on the right kind of ground in the scene raster | **Yes** | Raster-class lookups |
| Runtime positions equal the manifest; seed does not move geography | **Yes** | Browser test |
| OSM geometry itself is accurate | **No** | Taken as given. No ground truth, survey data or imagery comparison was performed |
| Building heights are accurate | **No** | 98 % are estimates; no comparison against measured heights was done |
| People can recognise the city | **No** | Protocol only (`RECOGNITION_TEST.md`) |

## A. Projection chain

Scene coordinates stored by the pipeline versus an independent re-projection of each feature's longitude/latitude:

| Group | n | median (m) | max (m) |
|---|---|---|---|
| Landmarks | 39 | 0.05 | 0.11 |
| Lakes | 164 | 0.45 | 0.64 |
| Parks | 40 | 0.39 | 0.68 |
| Places | 53 | 0.40 | 0.67 |
| Metro stations | 91 | 0.42 | 0.69 |
| Rail stations | 25 | 0.36 | 0.58 |
| **All** | **412** | **0.40** | **0.69** |

The residual is the rounding of stored coordinates (1 m for most groups, 0.1 m for landmarks), well under one 10 m cell.
The origin agrees to the centimetre (E 784,245.83, N 1,434,724.03).

## B. Against an independent source (Wikipedia coordinates)

| Subset | n | median | p90 | max |
|---|---|---|---|---|
| Individual buildings, reference quoted to ≥ 4 decimals | 11 | **17.7 m** | 58 m | 145 m |
| All features with a fine reference | 23 | 46.7 m | 419 m | 1,056 m |
| All compared | 26 | 60.5 m | 498 m | 1,056 m |

Per feature: Vikasa Soudha 1.9 m, High Court 1.5 m, World Trade Center 1.9 m, Kanteerava Stadium 8.8 m, Vidhana Soudha 13.9 m,
Kengeri station 16.8 m, Chinnaswamy Stadium 17.7 m, KR Puram station 17.9 m, Town Hall 18.4 m, Freedom Park 21.5 m, ISKCON 32.2 m,
St Mary's Basilica 46.7 m, UB City 58.4 m, Hebbal Lake 60.5 m, Cubbon Park 108 m, ITPL 114 m, IIM-B 116 m, Ulsoor Lake 120 m,
KIA 135 m, Majestic bus station 145 m, Madiwala Lake 419 m, Manyata 422 m, Yesvantpur Jn 428 m, Lalbagh 498 m, Cantonment station 959 m, Bellandur Lake 1,056 m.

How to read the large values: every offset above 100 m belongs to an **area** feature (a lake, park, campus or bus terminus hundreds of metres to
3.6 km across, where Wikipedia quotes some interior point and the model uses the polygon centroid) or to a reference rounded to 0.01° (≈ 1.1 km:
Lalbagh, Yesvantpur, Cantonment). They show the two sources describe the same place; they do not measure error at that scale.
The building subset is the meaningful accuracy figure, and it is limited by the reference, not demonstrably by the model.
`docs/validation/topdown_vs_reference.png` plots both positions on the scene raster.

Not compared (no usable Wikipedia coordinate or no name match): Bengaluru Palace, KSR Bengaluru station, Sankey Tank, Agara Lake, Jakkur Lake,
IISc, Whitefield and Yelahanka stations, SMVT. The other 13 landmarks/campuses were not checked against any second source.

## C. Raster consistency

| Check | Result |
|---|---|
| Lakes ≥ 10 ha whose centroid area is water/wetland | 79 / 79 |
| Rail stations within 50 m of a rail cell | 25 / 25 |
| Metro stations within 60 m of an arterial road or rail cell | 89 / 91 — the two exceptions (Majestic interchange, Mantri Square Sampige Road) are underground stations |
| Park landmarks on green cells | 4 / 5 — the Race Course centroid falls on the paved/grandstand part of the turf club |
| Modelled landmark footprints free of generic buildings | 12 / 13 — **defect:** at the Lalbagh Glass House a generic low building from an unnamed OSM footprint overlaps the model |

## D. Null test — landmarks are not random

Median offset from the Wikipedia reference: **46.7 m** for the real placement, against 10,452 m (minimum), 16,196 m (mean) over 2,000 trials
that scatter the same 22 features uniformly over the map. No random trial came within a factor of 200. p < 0.0005.
In the browser test, runtime landmark coordinates equal the manifest exactly, and changing the seed changes procedural detail but no landmark position.

## E. Distortion

| | |
|---|---|
| Horizontal scale | Uniform, 1 unit = 10 m of UTM grid distance. UTM scale factor here 1.0006 (0.6 m per km). No rubber-sheeting. |
| Scale variation across the extent | < 0.03 % corner to corner |
| North | Scene north = grid north, 0.59° clockwise of true north at the centre (0.54°–0.64° across the extent). The compass shows scene north. |
| Vertical | Terrain ×3, buildings ×1.5 |
| Non-geometric | Vehicles and people ×1.6; traffic time-lapse ×2 |
| Generalisation | 10 m cells near, 40 m blocks mid-distance, 160 m blocks far. Footprints smaller than a cell merge. Road widths come from class and lanes, with a minimum of one cell, so minor roads are drawn wider than life. |

## F. Functional tests (headless Chromium, software WebGL, `?quality=low`): 17 / 17 passed

Single file with no external references · loads offline with zero network requests · no JS or console errors · 9 presets distinct, inside the extent,
centred on their anchor features · north up and east right at heading 0, compass follows · hide UI, freeze, day/evening, orbit/fly with WASD, labels,
three overlays, reset · 4,800 sampled vehicles: 100 % on road cells or flyovers, 0 in buildings, 0 in lakes · 1,564 of 1,564 vehicles on two-way roads
keep left · trains only on the four operational lines · Blue Line and Pink underground not operational · KIA is an edge marker ·
same seed gives an identical geometry hash across two fresh sessions · a different seed changes the hash but no landmark coordinate · no placeholder labels.

Limits of these tests: vehicle checks sample four districts once each; "vehicle not in building" is tested at the vehicle's centre on the 10 m grid;
pedestrians are not tested against buildings; the bloom toggle and minimap were checked for presence, not visual correctness; the normal-quality path
was exercised only by the screenshots.

## Infrastructure status shown (13 Nov 2026)

Operational Metro 103.1 km in the model against 103.6 km reported (Purple 43.5, Green 33.9, Yellow 18.1, Pink elevated 7.6).
Station counts: Purple 37, Green 30, Yellow 14, Pink 6. Under construction and shown as such: Blue Line viaduct, Pink underground.
Three under-construction stations and one proposed station exist in OSM as points and are labelled with their status; other future stations are not shown because OSM does not map them.
25 railway stations. See `SOURCES.md` for the basis of each status.

## Verified / estimated / stylised / omitted

| Element | Status | Note |
|---|---|---|
| Lake outlines (164 named ≥ 4 ha) | From OSM; consistency-checked | Bellandur and Varthur appear largely as wetland with open-water patches because land cover classes much of them as vegetation-covered |
| Roads, classes, flyover locations | From OSM | Widths estimated; ramp geometry schematic |
| Metro alignments, stations | From OSM; lengths cross-checked with reported totals | Status from secondary sources |
| Railways, 25 stations | From OSM; consistency-checked | Station buildings generic except platform canopies |
| 39 landmarks and campuses | Positions from OSM; 17 cross-checked with Wikipedia | 13 have bespoke models, the rest are labels on mapped fabric |
| Landmark model shapes and heights | Estimated | Built from general knowledge of each building, not from drawings or photos |
| Lalbagh Glass House footprint | Estimated | OSM has a point only; overlap defect noted above |
| Building footprints | From OSM where mapped (1.52 M cells); procedural elsewhere (0.62 M cells) | |
| Building heights | 1.7 % tagged, 98.3 % estimated | GHSL 2018 neighbourhood means + type rules |
| Land cover, trees | WorldCover 2021 + OSM | Individual trees are stylised |
| Terrain | Copernicus DEM, smoothed, ×3 | Surface model, so not bare earth |
| District character, façades, colours | Stylised | Rule-based on OSM land use, shop density, height |
| Traffic, pedestrians, trains | Stylised | Road-graph constrained, left-hand; volumes and timetable invented |
| Shop signs | Stylised | Sixteen generic Kannada + English trade words; no real businesses |
| KIA | Omitted from the model | Edge marker at true bearing, 6.8 km beyond the edge |
| Proposed Metro lines | Omitted in 3D | Overlay only |
| "Yeshwantpur" district label | Omitted | No OSM place node matched; the railway station is present |
