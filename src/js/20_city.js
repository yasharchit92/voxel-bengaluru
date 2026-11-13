/* Voxel Bengaluru — urban fabric: chunked, LOD-ed building masses, vegetation and street furniture generated from the 10 m raster. */
'use strict';
(() => {
  const C = VB.C, S = VB.S, K = VB.K, CH = K.CHUNK, lin = VB.lin;
  const P = (arr) => arr.map(lin);
  const PALS = {
    res: P([0xf1e7d0, 0xf5efe2, 0xf1e7d0, 0xeed9a8, 0xf0c9a8, 0xe9b9b0, 0xcfe3cf, 0xcddff0, 0xe2c27a, 0xd9a273, 0xdcd3c4, 0xb5d6c2, 0xe8e0f0, 0xf3ede0, 0xe6d8bd]),
    tower: P([0xf3eee4, 0xeadfcd, 0xe0d2bd, 0xd9c9b4, 0xf0e6d6, 0xd5cfc6, 0xe7d3b8]),
    glass: P([0x9fc4d8, 0x8fb5c9, 0xa9c9c0, 0x7fa3bd, 0xb7c7d2, 0x8aa9a6, 0x9ab0c4]),
    ind: P([0xbfc5ca, 0xa9b9c9, 0xcdd0c8, 0x9fb3bf, 0xd6cdbb, 0xb8bfb0]),
    inst: P([0xeadfc4, 0xe6d5b0, 0xf2ead8, 0xd9c7a0, 0xe9dcc6, 0xb9785c, 0xe2dccf, 0xd6cbb2]),
    shop: P([0xf0e2c4, 0xe9d0a0, 0xf3ede0, 0xe5c0a0, 0xd8dfe6, 0xeacbb4, 0xdfe6cf]),
    leaf: P([0x3f7a3a, 0x4c8a40, 0x356b35, 0x5a9446, 0x2f6336, 0x6aa04e, 0x457f3c, 0x4f8f4a]),
    bloom: P([0xcf93ad, 0xc9604a, 0x9c8bc0, 0xd8c260]),       // tabebuia, gulmohar, jacaranda, copper-pod
    awning: P([0xc8453a, 0x3f6fb0, 0xe0b23c, 0x4d9a57, 0xf2efe6, 0xd9772e]),
    tank: P([0x1c1c1c, 0x1c1c1c, 0xe0b020, 0xf2f2f2]),
  };
  const COL = { trunk: lin(0x6f5a44), palm: lin(0x8a7458), palmLeaf: lin(0x4f8a3c), reed: lin(0x8fae6a), bush: lin(0x5f8a48), pole: lin(0x8d9096), lamp: lin(0xffd9a0), median: lin(0xb8b2a2),
    fenceB: lin(0x3b78b5), fenceG: lin(0x4f9a6a), rcc: lin(0x9c9a94), crane: lin(0xe5b82e), shelter: lin(0x5a7d9a), bench: lin(0xd8b040), plant: lin(0x8c8f94), cabin: lin(0xf0eee8), boom: lin(0xd23a30), scooter: lin(0x2b2d33), table: lin(0x8a6a4a) };
  const pick = (pal, h) => pal[Math.min(pal.length - 1, (h * pal.length) | 0)];

  VB.roadHalf = (e) => (e.cls <= 2 ? (e.lanes >= 6 ? 1.3 : 1.0) : e.cls === 3 ? 0.8 : 0.65) * (e.link ? 0.6 : 1) * (e.ow && e.cls <= 2 ? 0.75 : 1);

  const styleFor = (zone, hm, shop, h) => {
    if (zone === 5) return hm >= 12 ? (h < 0.8 ? S.GLASS : S.INST) : (h < 0.3 ? S.GLASS : S.INST);
    if (zone === 1) return hm >= 30 ? (h < 0.45 ? S.GLASS : S.SHOP) : S.SHOP;
    if (zone === 2) return S.SHOP;
    if (zone === 3) return hm > 20 ? S.INST : S.IND;
    if (zone === 4) return S.INST;
    if (hm >= 60 && h < 0.2) return S.GLASS;
    return (shop > 40 && hm <= 22) ? S.SHOP : S.RES;
  };
  const colourFor = (style, hm, h) => style === S.GLASS ? pick(PALS.glass, h) : style === S.IND ? pick(PALS.ind, h) : style === S.INST ? pick(PALS.inst, h) : style === S.SHOP ? pick(PALS.shop, h) : hm >= 28 ? pick(PALS.tower, h) : pick(PALS.res, h);

  VB.City = class {
    constructor(scene) {
      const D = VB.data; this.D = D; this.nc = D.N / CH; this.geo = VB.unitBox(); this.mat = VB.makeVoxMaterial();
      this.group = new THREE.Group(); this.group.name = 'city'; scene.add(this.group);
      this._byD = (a, b) => a.d - b.d; this.chunks = []; this.queue = []; this.nearCount = 0; this.farInstances = 0; this.signsDirty = false;
      for (let cz = 0; cz < this.nc; cz++) for (let cx = 0; cx < this.nc; cx++)
        this.chunks.push({ cx, cz, x: -D.HALF + (cx + 0.5) * CH, z: -D.HALF + (cz + 0.5) * CH, far: null, near: null, nearD: null, y0: 0, queued: false, signs: null, edges: [], stops: [], markets: [] });
      // spatial indices: major-road edges, bus stops, markets per chunk
      const ci = (x, z) => { const a = Math.floor((x + D.HALF) / CH), b = Math.floor((z + D.HALF) / CH); return (a < 0 || b < 0 || a >= this.nc || b >= this.nc) ? -1 : b * this.nc + a; };
      this.chunkIndex = ci;
      for (const e of D.edges) {
        const seen = new Set(), p = e.pts;
        for (let k = 0; k + 3 < p.length; k += 2) {
          const dx = p[k + 2] - p[k], dz = p[k + 3] - p[k + 1], n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 40));
          for (let s = 0; s <= n; s++) { const i = ci(p[k] + dx * s / n, p[k + 1] + dz * s / n); if (i >= 0 && !seen.has(i)) { seen.add(i); this.chunks[i].edges.push(e.i); } }
        }
      }
      for (let k = 0; k < D.busStops.length; k += 2) { const i = ci(D.busStops[k], D.busStops[k + 1]); if (i >= 0) this.chunks[i].stops.push(k); }
      D.markets.forEach((m, k) => { const i = ci(m[0], m[1]); if (i >= 0) this.chunks[i].markets.push(k); });
    }

    // ---- LOD1: every chunk, aggregated to 40 m blocks (built once at start-up) ----
    buildFar() {
      const D = this.D, N = D.N, cls = D.cls, HS = K.HSTEP;
      for (const c of this.chunks) {
        const b = new VB.Batch(256), r0 = c.cz * CH, c0 = c.cx * CH; c.y0 = VB.H(c.x, c.z);
        for (let bz = 0; bz < CH; bz += 4) for (let bx = 0; bx < CH; bx += 4) {
          let cnt = 0, sum = 0, mx = 0;
          for (let dz = 0; dz < 4; dz++) { let i = (r0 + bz + dz) * N + c0 + bx; for (let dx = 0; dx < 4; dx++, i++) { const v = cls[i]; if (v >= 32) { cnt++; sum += v - 31; if (v - 31 > mx) mx = v - 31; } } }
          if (!cnt) continue;
          const mean = sum / cnt, wx = -D.HALF + c0 + bx + 2, wz = -D.HALF + r0 + bz + 2, zone = D.zone[((r0 + bz + 2) / 10 | 0) * D.NG + ((c0 + bx + 2) / 10 | 0)], shop = D.shop[((r0 + bz + 2) / 10 | 0) * D.NG + ((c0 + bx + 2) / 10 | 0)];
          const y = VB.H(wx, wz) - 0.4, h1 = VB.hash(c0 + bx, r0 + bz, 11), h2 = VB.hash(c0 + bx, r0 + bz, 12);
          let tall = 0, tx = 0, tz = 0, lowCnt = cnt, lowSum = sum;
          if (mx >= 16 && mx > mean * 1.7) {      // keep towers: they define the skyline
            lowCnt = 0; lowSum = 0;
            for (let dz = 0; dz < 4; dz++) { let i = (r0 + bz + dz) * N + c0 + bx; for (let dx = 0; dx < 4; dx++, i++) { const v = cls[i] - 31; if (v >= mx * 0.75) { tall++; tx += dx + 0.5; tz += dz + 0.5; } else if (v > 0) { lowCnt++; lowSum += v; } } }
            const side = Math.sqrt(tall), hm = mx * 1.6, st = styleFor(zone, hm, shop, h1), col = colourFor(st, hm, h2);
            b.box(wx - 2 + tx / tall, y, wz - 2 + tz / tall, side, mx * HS + 0.4, side, col[0], col[1], col[2], st);
          }
          if (lowCnt >= 4) {
            const m2 = lowSum / lowCnt, side = 4 * Math.sqrt(lowCnt / 16) * 0.96, hm = m2 * 1.6, st = styleFor(zone, hm, shop, h1), col = colourFor(st, hm, VB.hash(c0 + bx, r0 + bz, 13));
            b.box(wx, y, wz, side, m2 * HS + 0.4, side, col[0], col[1], col[2], st);
          }
        }
        if (b.n) {
          const m = b.mesh(this.geo, this.mat, true); m.name = 'far'; m.boundingSphere = new THREE.Sphere(new THREE.Vector3(c.x, VB.H(c.x, c.z), c.z), 110);
          m.geometry.boundingSphere = m.boundingSphere; c.far = m; this.group.add(m); this.farInstances += b.n;
        }
      }
    }

    // ---- LOD2: 160 m blocks, merged per 5 x 5 chunk tile; used for tiles far from the camera (whole-city views) ----
    buildCoarse() {
      const D = this.D, N = D.N, cls = D.cls, HS = K.HSTEP, T = 5, nt = this.nc / T; this.tiles = []; this.coarseInstances = 0;
      for (let tz = 0; tz < nt; tz++) for (let tx = 0; tx < nt; tx++) {
        const b = new VB.Batch(1024), tile = { x: -D.HALF + (tx + 0.5) * T * CH, z: -D.HALF + (tz + 0.5) * T * CH, chunks: [], mesh: null, coarse: false };
        for (let a = 0; a < T; a++) for (let c = 0; c < T; c++) tile.chunks.push(this.chunks[(tz * T + a) * this.nc + tx * T + c]);
        for (let bz = tz * T * CH; bz < (tz + 1) * T * CH; bz += 16) for (let bx = tx * T * CH; bx < (tx + 1) * T * CH; bx += 16) {
          let cnt = 0, sum = 0;
          for (let dz = 0; dz < 16; dz++) { let i = (bz + dz) * N + bx; for (let dx = 0; dx < 16; dx++, i++) { const v = cls[i]; if (v >= 32) { cnt++; sum += v - 31; } } }
          if (cnt < 20) continue;
          const mean = sum / cnt, wx = -D.HALF + bx + 8, wz = -D.HALF + bz + 8, gz = ((bz + 8) / 10 | 0) * D.NG + ((bx + 8) / 10 | 0), hm = mean * 1.6;
          const st = styleFor(D.zone[gz], hm, D.shop[gz], VB.hash(bx, bz, 11)), col = colourFor(st, hm, VB.hash(bx, bz, 12)), f = cnt / 256, side = f > 0.3 ? 16 : 16 * Math.sqrt(f / 0.3);
          b.box(wx, VB.H(wx, wz) - 0.4, wz, side, mean * HS * 1.1 + 0.4, side, col[0], col[1], col[2], st);
        }
        if (b.n) { const m = b.mesh(this.geo, this.mat, false); m.name = 'coarse'; m.visible = false; m.boundingSphere = new THREE.Sphere(new THREE.Vector3(tile.x, VB.H(tile.x, tile.z), tile.z), 480); m.geometry.boundingSphere = m.boundingSphere; tile.mesh = m; this.group.add(m); this.coarseInstances += b.n; }
        this.tiles.push(tile);
      }
    }

    // ---- LOD0: full 10 m detail for chunks near the focus ----
    buildNear(c) {
      const D = this.D, N = D.N, cls = D.cls, HS = K.HSTEP, core = this._core || (this._core = new VB.Batch(16384)), det = this._det || (this._det = new VB.Batch(16384)), r0 = c.cz * CH, c0 = c.cx * CH, signs = [];
      core.n = 0; det.n = 0;                      // the two scratch batches are reused for every chunk (no per-build allocation of work buffers)
      // Objects under ~4 m (water tanks, trunks, poles, lamps, parked two-wheelers, fences, stalls, reeds) go to a separate
      // "detail" mesh that is only drawn close to the camera and never casts shadows.
      const b = {
        box(x, y, z, w, h, d, r, g, bl, st) { ((w <= 0.14 || d <= 0.14 || (w <= 0.4 && d <= 0.4 && h <= 0.5)) ? det : core).box(x, y, z, w, h, d, r, g, bl, st); },
        rbox(x, y, z, w, h, d, a, r, g, bl, st) { ((d <= 0.14 || h <= 0.12) ? det : core).rbox(x, y, z, w, h, d, a, r, g, bl, st); },
      };
      const used = new Uint8Array(CH * CH), X0 = -D.HALF + c0, Z0 = -D.HALF + r0;
      const at = (cx, cz) => { const gx = c0 + cx, gz = r0 + cz; return (gx < 0 || gz < 0 || gx >= N || gz >= N) ? 255 : cls[gz * N + gx]; };
      for (let z = 0; z < CH; z++) for (let x = 0; x < CH; x++) {
        const gi = (r0 + z) * N + c0 + x, v = cls[gi], wx = X0 + x + 0.5, wz = Z0 + z + 0.5;
        if (v >= 32) {
          if (used[z * CH + x]) continue;
          let w = 1; while (x + w < CH && w < 10 && !used[z * CH + x + w] && cls[gi + w] === v) w++;
          let d = 1; outer: while (z + d < CH && d < 10) { for (let k = 0; k < w; k++) if (used[(z + d) * CH + x + k] || cls[gi + d * N + k] !== v) break outer; d++; }
          for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) used[(z + dz) * CH + x + dx] = 1;
          const cx = X0 + x + w / 2, cz = Z0 + z + d / 2, gzn = ((r0 + z + d / 2) / 10 | 0) * D.NG + ((c0 + x + w / 2) / 10 | 0);
          const zone = D.zone[gzn], shop = D.shop[gzn], hm = (v - 31) * 1.6, h1 = VB.hash(c0 + x, r0 + z, 11), h2 = VB.hash(c0 + x, r0 + z, 12), h3 = VB.hash(c0 + x, r0 + z, 14);
          const st = styleFor(zone, hm, shop, h1), col = colourFor(st, hm, h2), y = VB.H(cx, cz) - 0.4, hh = (v - 31) * HS + 0.4, top = y + hh;
          b.box(cx, y, cz, w - 0.08, hh, d - 0.08, col[0], col[1], col[2], st);
          // rooftop character: water tanks on houses, lift rooms / plant on larger blocks
          if ((st === S.RES || st === S.SHOP) && hm < 26) { if (h3 < 0.62) { const t = pick(PALS.tank, VB.hash(c0 + x, r0 + z, 15)); b.box(cx + (h3 - 0.3) * (w - 0.5), top, cz + (h1 - 0.5) * (d - 0.5), 0.2, 0.2, 0.2, t[0], t[1], t[2], S.PLAIN); } }
          else if (w * d >= 2) b.box(cx + (h3 - 0.5) * (w - 1) * 0.6, top, cz + (h1 - 0.5) * (d - 1) * 0.6, Math.min(1.2, w * 0.4), 0.3, Math.min(1.2, d * 0.4), COL.plant[0], COL.plant[1], COL.plant[2], S.PLAIN);
          if (st === S.RES && hm < 14 && h2 > 0.86) b.box(cx, top, cz, w - 0.08, 0.1, d - 0.08, 0.52, 0.2, 0.12, S.PLAIN);     // occasional terracotta-tiled roof
          // shop signage + parked two-wheelers where the block faces a mapped main street in a shop-dense area
          if (shop > 24 && h3 < 0.5) {
            const dirs = [[1, 0, w / 2, 0], [-1, 0, -w / 2, 0], [0, 1, 0, d / 2], [0, -1, 0, -d / 2]];
            for (const [dx, dz, ox, oz] of dirs) {
              const nb = at(Math.floor(x + w / 2 + dx * (w / 2 + 0.5)), Math.floor(z + d / 2 + dz * (d / 2 + 0.5)));
              if (nb >= C.RD_TERT && nb <= C.RD_ART) {
                signs.push(cx + ox + dx * 0.03, y + 0.4 + K.FLOOR * 0.82, cz + oz + dz * 0.03, Math.atan2(dx, dz), (VB.hash(c0 + x, r0 + z, 16) * 16) | 0);
                for (let k = 0; k < 3; k++) b.box(cx + ox + dx * 0.22 + (dz ? (k - 1) * 0.2 : 0), y + 0.4, cz + oz + dz * 0.22 + (dx ? (k - 1) * 0.2 : 0), dz ? 0.06 : 0.17, 0.1, dx ? 0.06 : 0.17, COL.scooter[0], COL.scooter[1], COL.scooter[2], S.PLAIN);
                break;
              }
            }
          }
          continue;
        }
        const h = VB.hash(c0 + x, r0 + z, 21);
        if (v === C.TREE || v === C.PARK || v === C.GRASS) {
          const p = v === C.TREE ? 0.46 : v === C.PARK ? 0.09 : 0.012;
          if (h < p) {
            const h2 = VB.hash(c0 + x, r0 + z, 22), h3 = VB.hash(c0 + x, r0 + z, 23), y = VB.H(wx, wz), jx = wx + (h2 - 0.5) * 0.5, jz = wz + (h3 - 0.5) * 0.5;
            if (h3 < 0.05) {                                   // palm
              const th = 1.0 + h2 * 0.7; b.box(jx, y, jz, 0.09, th, 0.09, COL.palm[0], COL.palm[1], COL.palm[2], S.PLAIN);
              b.box(jx, y + th, jz, 0.9, 0.07, 0.2, COL.palmLeaf[0], COL.palmLeaf[1], COL.palmLeaf[2], S.LEAF); b.box(jx, y + th, jz, 0.2, 0.07, 0.9, COL.palmLeaf[0], COL.palmLeaf[1], COL.palmLeaf[2], S.LEAF);
            } else {
              const th = 0.3 + h2 * 0.5, s = 0.85 + h3 * 0.6, chh = 0.45 + h2 * 0.5, col = (h2 > 0.975) ? pick(PALS.bloom, h3) : pick(PALS.leaf, h3), sh = 0.85 + 0.3 * VB.hash(c0 + x, r0 + z, 24);
              b.box(jx, y + th, jz, s, chh, s, col[0] * sh, col[1] * sh, col[2] * sh, S.LEAF);
              if (h < p * 0.4) b.box(jx, y, jz, 0.13, th, 0.13, COL.trunk[0], COL.trunk[1], COL.trunk[2], S.PLAIN);
              if (h3 > 0.7) b.box(jx + 0.15, y + th + chh, jz - 0.1, s * 0.55, chh * 0.5, s * 0.55, col[0] * sh * 1.08, col[1] * sh * 1.08, col[2] * sh * 1.08, S.LEAF);
            }
          }
        } else if (v === C.SCRUB) { if (h < 0.16) b.box(wx, VB.H(wx, wz), wz, 0.5, 0.22 + h, 0.5, COL.bush[0], COL.bush[1], COL.bush[2], S.LEAF); }
        else if (v === C.WETLAND) { if (h < 0.3) b.box(wx + h - 0.15, VB.H(wx, wz), wz, 0.3, 0.16 + h * 0.4, 0.3, COL.reed[0], COL.reed[1], COL.reed[2], S.LEAF); }
        else if (v === C.CONSTR) {
          const y = VB.H(wx, wz), e = at(x + 1, z) !== C.CONSTR, w_ = at(x - 1, z) !== C.CONSTR, s_ = at(x, z + 1) !== C.CONSTR, n_ = at(x, z - 1) !== C.CONSTR;
          const fc = (c0 + r0) % 3 ? COL.fenceB : COL.fenceG;
          if (e && at(x + 1, z) < 32) b.box(wx + 0.46, y, wz, 0.06, 0.24, 1, fc[0], fc[1], fc[2], S.PLAIN); if (w_ && at(x - 1, z) < 32) b.box(wx - 0.46, y, wz, 0.06, 0.24, 1, fc[0], fc[1], fc[2], S.PLAIN);
          if (s_ && at(x, z + 1) < 32) b.box(wx, y, wz + 0.46, 1, 0.24, 0.06, fc[0], fc[1], fc[2], S.PLAIN); if (n_ && at(x, z - 1) < 32) b.box(wx, y, wz - 0.46, 1, 0.24, 0.06, fc[0], fc[1], fc[2], S.PLAIN);
          if (h < 0.035) { const fl = 2 + (h * 200 | 0); for (let f = 0; f < fl; f++) { b.box(wx, y + f * K.FLOOR + K.FLOOR - 0.06, wz, 0.95, 0.06, 0.95, COL.rcc[0], COL.rcc[1], COL.rcc[2], S.PLAIN); for (const [ax, az] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) b.box(wx + ax, y + f * K.FLOOR, wz + az, 0.08, K.FLOOR, 0.08, COL.rcc[0], COL.rcc[1], COL.rcc[2], S.PLAIN); } }
          else if (h > 0.9975) { b.box(wx, y, wz, 0.14, 5.5, 0.14, COL.crane[0], COL.crane[1], COL.crane[2], S.PLAIN); b.box(wx + 1.1, y + 5.3, wz, 3.6, 0.12, 0.12, COL.crane[0], COL.crane[1], COL.crane[2], S.PLAIN); }
        } else if (v === C.PAVED) {
          if (h < 0.012 && D.zone[((r0 + z) / 10 | 0) * D.NG + ((c0 + x) / 10 | 0)] === 5) {     // tech-campus gate: security cabin + boom barrier beside a road
            const r = at(x + 1, z), l = at(x - 1, z);
            if ((r >= C.RD_MINOR && r <= C.RD_ART) || (l >= C.RD_MINOR && l <= C.RD_ART)) { const y = VB.H(wx, wz), sgn = (r >= C.RD_MINOR && r <= C.RD_ART) ? 1 : -1; b.box(wx, y, wz, 0.26, 0.3, 0.26, COL.cabin[0], COL.cabin[1], COL.cabin[2], S.INST); b.box(wx + sgn * 0.6, y + 0.12, wz + 0.2, 0.9, 0.04, 0.04, COL.boom[0], COL.boom[1], COL.boom[2], S.PLAIN); }
          }
        }
      }
      // street furniture along mapped main roads
      for (const ei of c.edges) {
        const e = D.edges[ei]; if (e.lvl < 0) continue;
        const p = e.pts, half = VB.roadHalf(e); let acc = (VB.hash(ei, 0, 31) * 4), s0 = 0, side = 1;
        const median = !e.ow && e.cls <= 2 && e.lanes >= 4 && e.lvl === 0;
        for (let k = 0; k + 3 < p.length; k += 2) {
          const ax = p[k], az = p[k + 1], dx = p[k + 2] - ax, dz = p[k + 3] - az, len = Math.hypot(dx, dz); if (len < 1e-3) continue;
          const ux = dx / len, uz = dz / len, inside = (x, z) => x >= X0 && x < X0 + CH && z >= Z0 && z < Z0 + CH;
          if (e.cls <= 3) for (; acc < len; acc += 4.2, side = -side) {
            const px = ax + ux * acc + uz * half * side, pz = az + uz * acc - ux * half * side; if (!inside(px, pz)) continue;
            const y = VB.roadY ? VB.roadY(e, s0 + acc) + VB.H(px, pz) : VB.H(px, pz);
            b.box(px, y, pz, 0.06, 0.95, 0.06, COL.pole[0], COL.pole[1], COL.pole[2], S.PLAIN);
            b.box(px - uz * side * 0.16, y + 0.92, pz + ux * side * 0.16, 0.2, 0.05, 0.2, COL.lamp[0], COL.lamp[1], COL.lamp[2], S.LAMP);
          }
          acc -= len; s0 += len;
          if (median) {
            const mx = ax + dx / 2, mz = az + dz / 2;
            if (inside(mx, mz)) { b.rbox(mx, VB.H(mx, mz), mz, len, 0.07, 0.12, Math.atan2(-uz, ux), COL.median[0], COL.median[1], COL.median[2], S.PLAIN);
              for (let t = 1.2; t < len; t += 2.6) { const qx = ax + ux * t, qz = az + uz * t; b.box(qx, VB.H(qx, qz) + 0.07, qz, 0.16, 0.16, 0.16, COL.bush[0], COL.bush[1], COL.bush[2], S.LEAF); } }
          }
        }
      }
      // bus shelters at OSM bus-stop nodes (+ the occasional tea stall beside them)
      for (const k of c.stops) {
        const sx = D.busStops[k], sz = D.busStops[k + 1], y = VB.H(sx, sz), lx = Math.floor(sx - X0), lz = Math.floor(sz - Z0);
        const ns = (at(lx, lz - 1) >= C.RD_MINOR && at(lx, lz - 1) <= C.RD_ART) || (at(lx, lz + 1) >= C.RD_MINOR && at(lx, lz + 1) <= C.RD_ART);   // road continues north-south?
        const w = ns ? 0.34 : 0.9, d = ns ? 0.9 : 0.34;
        b.box(sx, y + 0.3, sz, w, 0.05, d, COL.shelter[0], COL.shelter[1], COL.shelter[2], S.PLAIN); b.box(sx, y, sz, w * 0.8, 0.08, d * 0.8, COL.bench[0], COL.bench[1], COL.bench[2], S.PLAIN);
        b.box(sx - w * 0.45, y, sz - d * 0.45, 0.04, 0.3, 0.04, COL.pole[0], COL.pole[1], COL.pole[2], S.PLAIN); b.box(sx + w * 0.45, y, sz + d * 0.45, 0.04, 0.3, 0.04, COL.pole[0], COL.pole[1], COL.pole[2], S.PLAIN);
        if (VB.hash(k, 0, 41) < 0.3) { const a = pick(PALS.awning, VB.hash(k, 1, 41)); b.box(sx + (ns ? 0.5 : 1.0), y, sz + (ns ? 1.0 : 0.5), 0.26, 0.24, 0.22, 0.25, 0.42, 0.62, S.PLAIN); b.box(sx + (ns ? 0.5 : 1.0), y + 0.26, sz + (ns ? 1.0 : 0.5), 0.36, 0.03, 0.34, a[0], a[1], a[2], S.PLAIN); }
      }
      // market stalls at OSM marketplace features
      for (const k of c.markets) {
        const [mx, mz] = D.markets[k];
        for (let i = 0; i < 14; i++) {
          const a = VB.hash(k, i, 51) * 6.283, r = 0.6 + VB.hash(k, i, 52) * 2.4, px = mx + Math.cos(a) * r, pz = mz + Math.sin(a) * r, cv = VB.cellAt(px, pz);
          if (cv >= 32 || cv === C.WATER || (cv >= C.RD_TERT && cv <= C.RD_ART)) continue;
          const y = VB.H(px, pz), aw = pick(PALS.awning, VB.hash(k, i, 53)), pr = VB.hash(k, i, 54);
          b.box(px, y, pz, 0.26, 0.11, 0.18, COL.table[0], COL.table[1], COL.table[2], S.PLAIN);
          b.box(px, y + 0.11, pz, 0.2, 0.05, 0.13, pr < 0.4 ? 0.85 : 0.3, pr < 0.4 ? 0.45 : 0.6, pr < 0.7 ? 0.08 : 0.2, S.PLAIN);     // produce: oranges / bananas / greens
          b.box(px, y + 0.27, pz, 0.34, 0.03, 0.26, aw[0], aw[1], aw[2], S.PLAIN);
        }
      }
      const sph = new THREE.Sphere(new THREE.Vector3(c.x, VB.H(c.x, c.z), c.z), 125);
      const m = core.mesh(this.geo, this.mat, true); m.name = 'near'; m.boundingSphere = sph;
      const dm = det.n ? det.mesh(this.geo, this.mat, false) : null; if (dm) { dm.name = 'near-detail'; dm.boundingSphere = sph; dm.visible = false; this.group.add(dm); }
      c.near = m; c.nearD = dm; c.signs = new Float32Array(signs); this.group.add(m); this.nearCount++; this.signsDirty = true;
      return core.n + det.n;
    }
    dropNear(c) {
      this.group.remove(c.near); VB.disposeBatchMesh(c.near); c.near = null;
      if (c.nearD) { this.group.remove(c.nearD); VB.disposeBatchMesh(c.nearD); c.nearD = null; }
      c.signs = null; this.nearCount--; this.signsDirty = true;
    }
    // focus: THREE.Vector3 on the ground the camera is looking at; range: camera distance to it
    update(focus, range, budgetMs, cam) {
      const R = range > VB.cfg.lodCut ? -1e9 : VB.cfg.lodRadius, t0 = performance.now(), q = this.queue, fx = focus.x, fz = focus.z;
      const rIn = R + 90, rOut = R + 230, rIn2 = rIn > 0 ? rIn * rIn : -1, rOut2 = rOut > 0 ? rOut * rOut : -1;
      const dd = VB.cfg.detailDist, dOn = (dd - 15) * (dd - 15), dOff = (dd + 15) * (dd + 15), cx = cam.x, cy = cam.y, cz = cam.z;
      q.length = 0;
      for (const c of this.chunks) {
        const ax = c.x - fx, az = c.z - fz, d2 = ax * ax + az * az;
        if (d2 < rIn2) { if (!c.near) { c.d = d2; q.push(c); } }
        else if (c.near && d2 > rOut2) this.dropNear(c);
        if (c.nearD) {                                    // small objects: only near the camera (hysteresis of +-150 m)
          const bx = c.x - cx, bz = c.z - cz, by = cy - c.y0, e2 = bx * bx + bz * bz + by * by, v = c.nearD.visible;
          if (v ? e2 > dOff : e2 < dOn) c.nearD.visible = !v;
        }
      }
      if (q.length) {
        q.sort(this._byD);
        for (let i = 0; i < q.length; i++) { this.buildNear(q[i]); if (performance.now() - t0 > budgetMs) break; }
      }
      // tile-level switch between 40 m blocks (LOD1) and 160 m blocks (LOD2)
      const cd = VB.cfg.coarseDist, cIn = (cd - 150) * (cd - 150), cOut = (cd + 150) * (cd + 150);
      for (const t of this.tiles) {
        const ax = t.x - cx, az = t.z - cz, ay = cy - 20, d2 = ax * ax + az * az + ay * ay; if (t.coarse ? d2 < cIn : d2 > cOut) t.coarse = !t.coarse;
        if (t.mesh) t.mesh.visible = t.coarse;
        const ch = t.chunks, co = t.coarse; for (let i = 0; i < ch.length; i++) { const c = ch[i]; if (c.far) c.far.visible = !co && !c.near; }
      }
      return q.length;
    }
    pending() { return this.queue.length; }
    instanceCount() { let n = 0; for (const t of this.tiles) { if (t.coarse && t.mesh) n += t.mesh.count; for (const c of t.chunks) { if (c.near) { n += c.near.count; if (c.nearD && c.nearD.visible) n += c.nearD.count; } else if (c.far && !t.coarse) n += c.far.count; } } return n; }
  };
})();
