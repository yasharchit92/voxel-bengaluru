# Performance report

> **Updated by the performance audit (see the last section).** The tables under "Measured" below are the pre-audit baseline (build `da28d8…`); the audit section has the before/after numbers for the current build `2eaef36306d59d6e`.

## Context — read this first

**The 60 FPS target on a mid-range desktop GPU has not been measured.** The only machine available was a sandbox with no GPU:

| | |
|---|---|
| Browser | Headless Chromium 158 (Playwright) |
| WebGL backend | ANGLE → Vulkan → **SwiftShader** (CPU software rasteriser) |
| CPU / RAM | 2 virtual cores, ~2 GB |
| Viewport | 1920 × 1080, device pixel ratio 1 |
| Date | 13 Nov 2026 |

On this setup a frame takes 1.5–10 **seconds** of wall time, because every pixel is rasterised on two CPU cores. That figure says nothing about a real
GPU. What does transfer to other hardware is scene complexity (draw calls, triangles, instances, memory) and, with caveats, JavaScript time per frame.

## Measured

Raw data: `docs/validation/perf_low.json`, `docs/validation/perf_normal.json`. Animation running, bloom off, dynamic resolution off, 20 frames per view.

### Low quality (`?quality=low`) — all seven views

| View | Draw calls | Triangles | Instances | Vehicles / people | JS ms/frame | Heap |
|---|---|---|---|---|---|---|
| Entire Bengaluru | 43 | 1.40 M | 30 k | 0 / 0 | 6.7 | 136 MB |
| Central | 92 | 2.98 M | 323 k | 1,200 / 296 | 22.0 | 148 MB |
| Bellandur & ORR | 139 | 3.24 M | 289 k | 1,200 / 296 | 17.4 | 162 MB |
| Whitefield | 111 | 2.72 M | 272 k | 1,200 / 296 | 16.5 | 160 MB |
| Electronic City | 153 | 2.95 M | 201 k | 1,200 / 296 | 12.3 | 146 MB |
| Hebbal & north | 145 | 2.93 M | 329 k | 1,200 / 296 | 13.2 | 162 MB |
| Street level | 154 | 2.47 M | 350 k | 1,200 / 298 | 18.3 | 169 MB |

### Normal quality — all seven views

| View | Draw calls | Triangles | Instances | Vehicles / people | JS ms/frame | Heap |
|---|---|---|---|---|---|---|
| Entire Bengaluru | 43 | 1.40 M | 30 k | 0 / 0 | 7.2 | 137 MB |
| Central | 86 | 4.02 M | 524 k | 3,500 / 896 | 29.7 | 164 MB |
| Bellandur & ORR | 147 | 5.04 M | 513 k | 3,500 / 896 | 19.7 | 158 MB |
| Whitefield | 112 | 4.26 M | 521 k | 2,946 / 896 | 20.9 | 163 MB |
| Electronic City | 146 | 4.27 M | 432 k | 3,500 / 896 | 22.1 | 160 MB |
| Hebbal & north | 150 | 4.67 M | 509 k | 3,500 / 896 | 25.9 | 163 MB |
| Street level | 196 | 3.42 M | 569 k | 1,225 / 797 | 24.4 | 168 MB |

Bloom was off for the probe; the bloom path was exercised once, for the evening screenshot.

### Other

| | |
|---|---|
| File size | 7.18 MB (data 6.31 MB, three.js 0.72 MB, application code 0.13 MB) |
| Time from navigation to interactive | 1.9 s (this sandbox, local file) |
| JS heap | 136–169 MB. GPU memory was not measured. |
| Network requests at runtime | 0 |

## Interpretation — and one real concern

- Draw calls (≤ 196) and instance counts are modest; triangle counts of 3–5 M per frame are within reach of a mid-range discrete GPU but are **not light**
  for integrated graphics. Expect integrated GPUs to need low quality.
- **JS time of 12–30 ms per frame in city views is at or above the 16.7 ms budget** for 60 FPS. In this sandbox the main thread shares two cores with the
  software rasteriser, so the number is inflated by an unknown factor, but I cannot show that it falls under budget on real hardware. The likely costs
  are per-frame vehicle and pedestrian matrix updates and label placement. If frame rate is poor on a real machine, this is the first place to look;
  `?quality=low` cuts the simulated population by two-thirds.
- Whether the target is met is therefore **unknown**, with the JS figure a reason for caution rather than confidence.

## How to measure on real hardware

Open the file in desktop Chrome at 1920 × 1080 and read the on-screen readout (fps, ms, draw calls, triangles, instances) for each preset, or run
`node tests/perf.mjs normal` with a GPU-backed Chromium (remove the `--use-angle=swiftshader` flag).

## Strategy implemented

| Technique | Where |
|---|---|
| One textured terrain mesh for all ground cover, roads and water (no per-cell geometry) | `10_env.js` |
| Instanced unit boxes with one shared material for every building, tree and street object | `10_env.js`, `20_city.js` |
| 128-cell chunks with three levels of detail: 10 m cells near the focus, 40 m blocks mid-range, 160 m blocks merged per 5 × 5 chunks beyond | `20_city.js` |
| Near chunks built incrementally under a 7 ms per-frame budget and disposed when left behind | `20_city.js` |
| Frustum culling per chunk via bounding spheres | `20_city.js` |
| Windows, shopfronts and night lighting drawn procedurally in the fragment shader (no façade textures or geometry) | `10_env.js` |
| Cached shadow map: re-rendered only when focus, zoom, sun or detailed-chunk set changes | `10_env.js` |
| Pooled, fixed-capacity instanced vehicles, pedestrians and signs; no per-frame allocation in the update loops by design | `50_life.js` |
| Activity simulated only near the camera focus, and switched off in whole-city views | `50_life.js` |
| Dynamic resolution: pixel ratio steps down to 0.6 when frames exceed 26 ms (normal quality) | `90_main.js` |
| Quality presets normal / low | `90_main.js` |

"No per-frame allocation" is a design property of the code; it was not verified with a heap profiler.


## Performance audit (build `2eaef36306d59d6e`)

### Method
- **No GPU was available.** Everything ran in headless Chromium on SwiftShader (software WebGL, 2 vCPU). Frame times from that rasteriser say nothing about a real GPU, so the audit measures what is hardware-independent: main-thread JS time with rendering disabled (`?norender=1`, per-section timers in `VB.api.prof()`), V8 CPU profile, allocation sampling (CDP heap sampler, 1 KB interval, including collected objects), and scene load (triangles and draw calls inside the frustum, shadow casters, buffer and texture memory).
- Scripts: `tests/audit.mjs` (JS timings, profile, allocations), `tests/audit_scene.mjs` (scene breakdown + 500-frame pan test), `tests/perf.mjs` (real rendering through SwiftShader). Raw output: `docs/validation/audit/before_*.json` and `after_*.json`.
- **60 FPS at 1080p on a mid-range GPU is still unverified.** The workload sent to the GPU is roughly 40 % smaller; whether that reaches 60 FPS has to be measured on real hardware (see "How to measure on real hardware").

### Issues found and what was done

| # | Issue (measured) | Fix | Status |
|---|---|---|---|
| 1 | Every box drew its never-visible bottom face (12 triangles) | Shared box and vehicle geometry without bottom face (10 triangles) | fixed |
| 2 | Near chunks carried 30–45 k small objects per view that are sub-pixel from the area presets, and all of them cast shadows | Near chunks split into a core mesh and a detail mesh; detail is drawn only within 170 units (110 on low) of the camera and casts no shadows | fixed |
| 3 | Road/flyover/metro structure was one 548 k-triangle mesh that was never culled | 33 tiles of 640 units, frustum culled | fixed |
| 4 | Terrain was one 460,800-triangle mesh that was never culled | 64 tiles sharing one vertex buffer, frustum culled | fixed |
| 5 | Shadow pass: vehicles and trains re-rendered into the shadow map; map refreshed after small pans | Moving objects no longer cast shadows; larger light frustum and less frequent refresh | fixed |
| 6 | 56–104 KB of garbage per frame (`Math.hypot`, for-of iterators, per-train and per-pedestrian arrays, label layout) | Allocation-free loops and typed arrays; labels are skipped while the camera is still | fixed |
| 7 | Chunk rebuild hitches while panning (max 27 ms, 2 frames over 16.7 ms in the pan test) | Build budget 7 → 4 ms per frame, reused scratch buffers | improved |
| 8 | Normal quality used 4× MSAA even at pixel ratio 2; dynamic resolution only ever went down and reacted to a noisy average | MSAA 2× above pixel ratio 1.25; new controller that also scales back up; `?pr=` and `?msaa=` | fixed, effect on a GPU unmeasured |
| 9 | Traffic simulation is the largest JS item (about 1.4–1.8 ms in dense views) | Signal axis cached per edge; otherwise left as is, because total JS is 2.3 ms of a 16.7 ms frame | accepted |
| 10 | Ground texture 3840² with mipmaps = 75 MB of GPU memory | Not changed: halving it blurs the 10 m ground raster at street level | accepted |
| 11 | Far chunks cast shadows (up to 2.4 M triangles if all were inside the light frustum) | Not changed: they are culled against the light frustum and the map is cached, so the real per-update count is much smaller; not measured separately | open |

### Before / after — scene load inside the frustum (normal quality, 1920×1080)

| View | Triangles before | after | change | Draw calls before | after |
|---|---|---|---|---|---|
| Entire Bengaluru | 1.40 M | 1.24 M | −11 % | 44 | 139 |
| Central | 4.12 M | 2.38 M | −42 % | 86 | 115 |
| Bellandur & ORR | 5.04 M | 2.89 M | −43 % | 147 | 183 |
| Street level | 2.97 M | 1.74 M | −42 % | 196 | 227 |

Draw calls rose because terrain and infrastructure are now tiles; in the overview nothing can be culled, so that view gains 95 calls for an 11 % triangle saving. Shadow-casting triangles (upper bound, before light-frustum culling) fell from 7.0–7.3 M to 4.6–5.1 M in the close views.

### Before / after — main-thread JS, rendering disabled (200 frames)

| View | ms/frame before | after | Garbage KB/frame before | after |
|---|---|---|---|---|
| Entire Bengaluru | 0.67 | 0.52 | 72 | 13–19 |
| Central | 3.05 | 2.23 | 96 | 9 |
| Bellandur & ORR | 2.13 | 1.72 | 80 | 8 |
| Street level | 1.47 | 1.15 | 104 | 32 |

Pan test (500 frames, 6 units per frame from Central): max 27.3 → 15.9 ms, frames over 16.7 ms 2 → 0, p50 1.5 → 1.4 ms, p99 8.6 → 11.2 ms (more frames carry a small build because the per-frame budget is lower).

### Before / after — real rendering on SwiftShader, low quality (20 frames per view)

| View | Triangles before | after | Wall s/frame before | after |
|---|---|---|---|---|
| Entire Bengaluru | 1.40 M | 1.24 M | 1.5 | 1.9 |
| Central | 2.98 M | 1.69 M | 3.4 | 3.5 |
| Bellandur & ORR | 3.24 M | 1.87 M | 4.6 | 5.7 |
| Whitefield | 2.72 M | 1.18 M | 5.8 | 4.3 |
| Electronic City | 2.95 M | 1.72 M | 4.9 | 4.1 |
| Hebbal | 2.93 M | 1.46 M | 5.7 | 4.6 |
| Street level | 2.47 M | 1.40 M | 5.9 | 5.0 |

The software-rendered wall times are mixed: four views are 15–26 % faster, Central is flat, and the overview and Bellandur are slower. With 20 frames on a shared 2-core machine these are noisy, and low quality now renders through the post-processing chain with 2× MSAA, so this table is not evidence of a GPU speed-up. The normal-quality real-render run was not repeated after the fixes.

### Verification
- Functional suite (`tests/run_tests.mjs`): 17 passed, 0 failed on the audited build.
- The determinism hash changed from `[2120986857,[1475314277,19]]` to `[3955321191,[3081621812,19]]` because instances are now grouped into different meshes; two runs with the same seed still match.
- Screenshots of Central, Bellandur and street level were checked by eye after the changes: no missing faces or shadow artefacts seen. Only those three views were checked, at 960×540.

### Follow-up fix: black screen with bloom when zoomed out (build `2eaef36306d59d6e`)
- Symptom: in normal quality with bloom on, the whole view turned black once the camera was more than roughly 3,200–4,000 units out.
- Cause: the plinth (side walls under the terrain edge) indexed every quad with both windings on shared vertices, so the computed vertex normals summed to zero. Normalising them in the shader gave NaN pixels, and the bloom blur spread the NaN over the whole frame. The walls only become visible when zoomed out.
- Fix: single winding plus a double-sided material (`src/js/10_env.js`).
- Check: `tests/bloom_sweep.mjs` renders the overview at several distances and reports brightness. Before: black from 4,000 units outward. After: 3,600, 5,000 and 11,000 units all render normally. Only the day mode at one camera angle was swept; the functional suite was not re-run for this one-line geometry change.
