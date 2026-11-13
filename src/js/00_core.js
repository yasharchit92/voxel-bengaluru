/* Voxel Bengaluru — core: namespace, constants, deterministic hashing, data decoding, coordinate helpers. */
'use strict';
const VB = window.VB = {};
(() => {
  const q = new URLSearchParams(location.search);
  VB.seed = (parseInt(q.get('seed') || '20261113', 10) | 0);
  VB.query = q;
  // ---- documented artistic exaggerations (see README "Artistic simplifications") ----
  VB.K = {
    UNIT_M: 10,          // 1 scene unit = 10 m horizontally (linear, no compression)
    TERR_EX: 3.0,        // terrain relief vertical exaggeration
    BLD_EX: 1.5,         // building height vertical exaggeration
    VEH_EX: 1.6,         // vehicle size exaggeration
    TIME_EX: 2.0,        // traffic "time-lapse" factor
    FLOOR_M: 3.2,
    CHUNK: 128,
  };
  VB.K.TERR = VB.K.TERR_EX / VB.K.UNIT_M;                 // scene units per metre of elevation
  VB.K.HSTEP = 1.6 / VB.K.UNIT_M * VB.K.BLD_EX;           // scene units per building height code step
  VB.K.FLOOR = VB.K.FLOOR_M / VB.K.UNIT_M * VB.K.BLD_EX;  // scene units per storey

  VB.C = { BARE: 0, GRASS: 1, CROP: 2, TREE: 3, SCRUB: 4, WATER: 5, WETLAND: 6, PARK: 7, PAVED: 10, RD_MINOR: 11, RD_TERT: 12, RD_SEC: 13, RD_ART: 14, RAIL: 15, PITCH: 16, AIR: 17, CONSTR: 18, BLD0: 32 };

  // deterministic integer hash -> [0,1)
  VB.hash = (x, z, s) => {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul((VB.seed + (s | 0)) | 0, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  VB.rng = (seed) => { let a = (seed ^ VB.seed) >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

  const inflate = async (b64, Type) => {
    const bin = atob(b64), n = bin.length, bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) bytes[i] = bin.charCodeAt(i);
    const buf = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer();
    return new Type(buf);
  };
  const unpackLines = async (o) => {
    const counts = await inflate(o.n, Uint16Array), d = await inflate(o.d, Int16Array);
    const out = []; let k = 0;
    for (let i = 0; i < counts.length; i++) {
      const n = counts[i], a = new Float32Array(n * 2); let x = 0, y = 0;
      for (let j = 0; j < n; j++) { x += d[k++]; y += d[k++]; a[j * 2] = x / 10; a[j * 2 + 1] = -y / 10; }   // metres -> scene (x east, z south)
      out.push(a);
    }
    return out;
  };
  const flat = (arr) => { const a = new Float32Array(arr.length); for (let i = 0; i < arr.length; i += 2) { a[i] = arr[i] / 10; a[i + 1] = -arr[i + 1] / 10; } return a; };

  VB.loadData = async (progress) => {
    const raw = JSON.parse(document.getElementById('vb-data').textContent);
    const D = VB.data = { meta: raw.meta };
    const m = raw.meta; D.N = m.n; D.HALF = m.n / 2; D.ND = m.n / m.dem_step + 1; D.DS = m.dem_step; D.NG = m.n / 10;
    progress(0.1, 'Inflating 10 m land-cover and building raster…');
    D.cls = await inflate(raw.cls, Uint8Array);
    D.dem = await inflate(raw.dem, Uint8Array);
    D.zone = await inflate(raw.zone, Uint8Array);
    D.shop = await inflate(raw.shop, Uint8Array);
    progress(0.2, 'Decoding road graph…');
    const nodes = await inflate(raw.nodes, Int16Array);
    D.nodeX = new Float32Array(raw.n_nodes); D.nodeZ = new Float32Array(raw.n_nodes);
    for (let i = 0; i < raw.n_nodes; i++) { D.nodeX[i] = nodes[i * 2] / 10; D.nodeZ[i] = -nodes[i * 2 + 1] / 10; }
    const attr = await inflate(raw.edges.attr, Uint16Array), geom = await unpackLines(raw.edges.geom);
    D.edges = geom.map((pts, i) => {
      const a = attr.subarray(i * 6, i * 6 + 6);
      return { i, a: a[0], b: a[1], cls: a[2] & 7, link: (a[2] >> 3) & 1, ow: (a[2] >> 4) & 1, lvl: a[3] - 2, lanes: a[4], corr: a[5] - 1, pts };
    });
    D.signals = new Set(raw.signals);
    D.rail = await unpackLines(raw.rail);
    const bs = await inflate(raw.bus_stops, Int16Array);
    D.busStops = new Float32Array(bs.length); for (let i = 0; i < bs.length; i += 2) { D.busStops[i] = bs[i] / 10; D.busStops[i + 1] = -bs[i + 1] / 10; }
    D.markets = raw.markets.map(p => [p[0] / 10, -p[1] / 10]);
    D.metro = raw.metro.map(l => Object.assign({}, l, { pts: flat(l.pts), tun: Uint8Array.from(l.tun, c => +c) }));
    D.metroUC = raw.metro_uc.map(l => Object.assign({}, l, { pts: flat(l.pts) }));
    D.bounds = raw.bounds.map(b => ({ name: b.name, pts: flat(b.pts) }));
    for (const k of ['corridors', 'stations', 'rail_stations', 'landmarks', 'lakes', 'parks', 'places', 'periph']) D[k] = raw[k];
    return D;
  };

  // ---- geography helpers -------------------------------------------------
  VB.cellAt = (x, z) => { const D = VB.data, c = Math.floor(x + D.HALF), r = Math.floor(z + D.HALF); return (c < 0 || r < 0 || c >= D.N || r >= D.N) ? 255 : D.cls[r * D.N + c]; };
  VB.H = (x, z) => {          // terrain height in scene units (bilinear over the 80 m DEM grid)
    const D = VB.data, n = D.ND; let gx = (x + D.HALF) / D.DS, gz = (z + D.HALF) / D.DS;
    gx = gx < 0 ? 0 : gx > n - 1.001 ? n - 1.001 : gx; gz = gz < 0 ? 0 : gz > n - 1.001 ? n - 1.001 : gz;
    const i = gx | 0, j = gz | 0, fx = gx - i, fz = gz - j, d = D.dem, o = j * n + i;
    return ((d[o] * (1 - fx) + d[o + 1] * fx) * (1 - fz) + (d[o + n] * (1 - fx) + d[o + n + 1] * fx) * fz) * VB.K.TERR;
  };
  VB.elevM = (x, z) => VB.H(x, z) / VB.K.TERR + VB.data.meta.dem_min;
  // scene -> lon/lat by bilinear interpolation of the four projected corners (error < ~3 m over the extent; HUD read-out only)
  VB.toLonLat = (x, z) => {
    const D = VB.data, c = D.meta.corners_lonlat, u = (x + D.HALF) / D.N, v = (z + D.HALF) / D.N;
    const lon = (c[0][0] * (1 - u) + c[1][0] * u) * (1 - v) + (c[2][0] * (1 - u) + c[3][0] * u) * v;
    const lat = (c[0][1] * (1 - u) + c[1][1] * u) * (1 - v) + (c[2][1] * (1 - u) + c[3][1] * u) * v;
    return [lon, lat];
  };
  VB.col = (hex) => new THREE.Color(hex);
})();
