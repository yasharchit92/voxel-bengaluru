/* Voxel Bengaluru — transport infrastructure: road graph preparation, flyovers, Namma Metro viaducts and stations
   (operational vs under construction), railway stations, map overlays. */
'use strict';
(() => {
  const S = VB.S, lin = VB.lin;
  const smooth = (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
  const DECK = 0.8;                                    // flyover deck height per level (8 m)
  VB.METRO_Y = 1.3;                                    // viaduct rail level above ground (13 m)

  VB.prepGraph = () => {
    const D = VB.data, nn = D.nodeX.length, deg = new Uint8Array(nn), brd = new Uint8Array(nn);
    D.out = Array.from({ length: nn }, () => []);       // per node: [edgeIndex, dir] leaving the node
    for (const e of D.edges) {
      const p = e.pts, n = p.length / 2, cum = new Float32Array(n);
      for (let k = 1; k < n; k++) cum[k] = cum[k - 1] + Math.hypot(p[k * 2] - p[k * 2 - 2], p[k * 2 + 1] - p[k * 2 - 1]);
      e.cum = cum; e.len = cum[n - 1]; e.n = n;
      deg[e.a]++; deg[e.b]++; if (e.lvl > 0) { brd[e.a]++; brd[e.b]++; }
      if (e.len > 0.05) { D.out[e.a].push([e.i, 1]); if (!e.ow) D.out[e.b].push([e.i, -1]); }
    }
    for (const e of D.edges) { e.aB = brd[e.a] === deg[e.a] && deg[e.a] > 1; e.bB = brd[e.b] === deg[e.b] && deg[e.b] > 1; }
  };
  // height of the carriageway above local ground at distance s along edge e (0 for at-grade roads)
  VB.roadY = (e, s) => {
    if (e.lvl <= 0) return 0;
    const R = Math.min(14, e.len * 0.45), ra = e.aB ? 1 : smooth(s / R), rb = e.bB ? 1 : smooth((e.len - s) / R);
    return DECK * e.lvl * Math.min(ra, rb);
  };
  // point at distance s along a polyline with cumulative lengths; out = [x, z, dirx, dirz]
  VB.along = (pts, cum, s, out) => {
    const n = cum.length; let lo = 0, hi = n - 1;
    if (s <= 0) { lo = 0; } else if (s >= cum[n - 1]) { lo = n - 2; } else { while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; } }
    if (lo > n - 2) lo = n - 2; if (lo < 0) lo = 0;
    const l = cum[lo + 1] - cum[lo] || 1e-6, t = (s - cum[lo]) / l, ax = pts[lo * 2], az = pts[lo * 2 + 1], dx = pts[lo * 2 + 2] - ax, dz = pts[lo * 2 + 3] - az;
    out[0] = ax + dx * t; out[1] = az + dz * t; out[2] = dx / l; out[3] = dz / l; return out;
  };
  const cumOf = (pts) => { const n = pts.length / 2, c = new Float32Array(n); for (let k = 1; k < n; k++) c[k] = c[k - 1] + Math.hypot(pts[k * 2] - pts[k * 2 - 2], pts[k * 2 + 1] - pts[k * 2 - 1]); return c; };
  const nearestOn = (pts, cum, x, z) => {              // -> {s, d, k}
    let best = { d: 1e9, s: 0, k: 0 };
    for (let k = 0; k + 3 < pts.length; k += 2) {
      const ax = pts[k], az = pts[k + 1], dx = pts[k + 2] - ax, dz = pts[k + 3] - az, l2 = dx * dx + dz * dz || 1e-9;
      let t = ((x - ax) * dx + (z - az) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(ax + dx * t - x, az + dz * t - z); if (d < best.d) best = { d, s: cum[k / 2] + Math.sqrt(l2) * t, k: k / 2 };
    }
    return best;
  };
  VB.nearestOn = nearestOn; VB.cumOf = cumOf;

  VB.buildInfra = (scene, city) => {
    const D = VB.data, b = new VB.Batch(8192), o = [0, 0, 0, 0];
    const conc = lin(0xa39f97), asph = lin(0x5f6065), raw = lin(0xbab5aa), barr = lin(0xe0a030), fence = lin(0x3b78b5);
    // ---- flyovers / elevated roads (OSM bridge=yes on the mapped main-road network) ----
    let flyKm = 0;
    for (const e of D.edges) {
      if (e.lvl <= 0 || e.len < 0.5) continue; flyKm += e.len / 100;
      const half = VB.roadHalf(e), step = 2.0, n = Math.max(1, Math.round(e.len / step)), sl = e.len / n;
      for (let i = 0; i < n; i++) {
        const s = (i + 0.5) * sl; VB.along(e.pts, e.cum, s, o); const y = VB.roadY(e, s), g = VB.H(o[0], o[1]);
        if (y < 0.06) continue;
        const a = Math.atan2(-o[3], o[2]);
        b.rbox(o[0], g + y - 0.14, o[1], sl + 0.06, 0.14, half * 2, a, conc[0], conc[1], conc[2], S.PLAIN);
        b.rbox(o[0], g + y, o[1], sl + 0.06, 0.015, half * 2 - 0.16, a, asph[0], asph[1], asph[2], S.PLAIN);
        b.rbox(o[0], g + y, o[1] , sl + 0.06, 0.07, 0.06, a, conc[0], conc[1], conc[2], S.PLAIN);
        if (i % 2 === 0 && y > 0.3) b.rbox(o[0], g - 0.2, o[1], 0.28, y + 0.06, 0.28, a, conc[0], conc[1], conc[2], S.PLAIN);
      }
    }
    // ---- Namma Metro ----
    const seen = new Set(), key = (x, z) => Math.round(x / 2.2) + ',' + Math.round(z / 2.2);
    const viaduct = (pts, tun, col, status) => {
      const cum = cumOf(pts), len = cum[cum.length - 1], n = Math.max(1, Math.round(len / 2.8)), sl = len / n; let km = 0;
      for (let i = 0; i < n; i++) {
        const s = (i + 0.5) * sl; VB.along(pts, cum, s, o);
        let lo = 0, hi = cum.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
        const under = tun ? (typeof tun === 'number' ? !!tun : (tun[lo] && tun[lo + 1])) : false;
        const k = key(o[0], o[1]); if (status !== 'operational') { if (seen.has(k)) continue; } seen.add(k);
        const g = VB.H(o[0], o[1]), a = Math.atan2(-o[3], o[2]); km += sl / 100;
        if (under) { if (i % 2 === 0) b.rbox(o[0], g + 0.02, o[1], 1.3, 0.03, 0.26, a, col[0], col[1], col[2], status === 'operational' ? S.LAMP : S.PLAIN); continue; }
        if (status === 'operational') {
          b.rbox(o[0], g + VB.METRO_Y - 0.16, o[1], sl + 0.05, 0.16, 0.95, a, conc[0], conc[1], conc[2], S.PLAIN);
          b.rbox(o[0], g + VB.METRO_Y, o[1], sl + 0.05, 0.05, 0.14, a, col[0], col[1], col[2], S.PLAIN);
          b.rbox(o[0], g - 0.2, o[1], 0.24, VB.METRO_Y + 0.05, 0.24, a, conc[0], conc[1], conc[2], S.PLAIN);
        } else {
          b.rbox(o[0], g + VB.METRO_Y - 0.16, o[1], sl + 0.05, 0.16, 0.95, a, raw[0], raw[1], raw[2], S.PLAIN);
          b.rbox(o[0], g - 0.2, o[1], 0.24, VB.METRO_Y + 0.05, 0.24, a, raw[0], raw[1], raw[2], S.PLAIN);
          b.rbox(o[0] + o[3] * 0.55, g, o[1] - o[2] * 0.55, sl + 0.05, 0.14, 0.05, a, barr[0], barr[1], barr[2], S.PLAIN);
          b.rbox(o[0] - o[3] * 0.55, g, o[1] + o[2] * 0.55, sl + 0.05, 0.14, 0.05, a, barr[0], barr[1], barr[2], S.PLAIN);
        }
      }
      return km;
    };
    const lineCol = {}; VB.metroKm = { operational: 0, construction: 0 };
    for (const l of D.metro) { l.cum = cumOf(l.pts); l.len = l.cum[l.cum.length - 1]; lineCol[l.key] = lin(parseInt(l.colour.slice(1), 16)); VB.metroKm.operational += viaduct(l.pts, l.tun, lineCol[l.key], 'operational'); }
    lineCol.blue = lin(0x2f6fd0); lineCol.pinkuc = lin(0xe8a9c8);
    for (const u of D.metroUC) if (u.status === 'construction') VB.metroKm.construction += viaduct(u.pts, u.tunnel, u.line === 'blue' ? lineCol.blue : lineCol.pinkuc, 'construction');
    // stations
    for (const st of D.stations) {
      const l = D.metro.find(m => m.key === st.line), g = VB.H(st.x, st.z);
      if (st.status === 'operational' && l) {
        const q = nearestOn(l.pts, l.cum, st.x, st.z); VB.along(l.pts, l.cum, q.s, o); st.s = q.s; st.under = !!(l.tun[q.k] && l.tun[Math.min(q.k + 1, l.tun.length - 1)]);
        const a = Math.atan2(-o[3], o[2]), col = lineCol[l.key];
        if (st.under) { for (const sd of [-1, 1]) { b.rbox(o[0] + o[3] * sd * 1.2, g, o[1] - o[2] * sd * 1.2, 0.8, 0.45, 0.6, a, 0.85, 0.85, 0.82, S.INST); b.rbox(o[0] + o[3] * sd * 1.2, g + 0.45, o[1] - o[2] * sd * 1.2, 0.95, 0.07, 0.75, a, col[0], col[1], col[2], S.PLAIN); } }
        else {
          b.rbox(o[0], g + VB.METRO_Y - 0.55, o[1], 13.5, 0.5, 2.3, a, 0.82, 0.8, 0.76, S.INST);       // concourse
          b.rbox(o[0], g + VB.METRO_Y - 0.05, o[1], 13.5, 0.55, 2.5, a, 0.9, 0.9, 0.88, S.GLASS);      // platform level
          b.rbox(o[0], g + VB.METRO_Y + 0.5, o[1], 13.8, 0.12, 2.7, a, col[0], col[1], col[2], S.PLAIN);   // roof in line colour
          for (const sd of [-1, 1]) b.rbox(o[0] + o[3] * sd * 1.9, g, o[1] - o[2] * sd * 1.9, 1.0, VB.METRO_Y - 0.3, 0.7, a, 0.8, 0.78, 0.74, S.INST);
          for (const t of [-5, 0, 5]) b.rbox(o[0] + o[2] * t, g - 0.2, o[1] + o[3] * t, 0.4, VB.METRO_Y - 0.3, 0.4, a, conc[0], conc[1], conc[2], S.PLAIN);
        }
      } else if (st.status === 'construction') {
        b.box(st.x, g, st.z, 5, 0.5, 1.8, raw[0], raw[1], raw[2], S.PLAIN); b.box(st.x, g, st.z, 6, 0.24, 2.6, fence[0], fence[1], fence[2], S.PLAIN);
        b.box(st.x + 2.2, g, st.z + 0.8, 0.14, 4.5, 0.14, 0.9, 0.72, 0.18, S.PLAIN); b.box(st.x + 3.2, g + 4.3, st.z + 0.8, 3, 0.12, 0.12, 0.9, 0.72, 0.18, S.PLAIN);
      }
    }
    // ---- conventional railway stations: platform canopies aligned to the nearest mapped track ----
    const railCum = D.rail.map(cumOf);
    for (const rs of D.rail_stations) {
      let best = null, bi = -1; D.rail.forEach((p, i) => { const q = nearestOn(p, railCum[i], rs.x, rs.z); if (!best || q.d < best.d) { best = q; bi = i; } });
      if (!best || best.d > 30) continue;
      VB.along(D.rail[bi], railCum[bi], best.s, o); const a = Math.atan2(-o[3], o[2]), g = VB.H(rs.x, rs.z);
      const major = /Krantivira|Yesvantpur|Visvesvaraya|Cantonment|Krishnarajapuram|Yelahanka/.test(rs.name), np = rs.halt ? 1 : major ? 4 : 2, L = rs.halt ? 12 : major ? 42 : 28;
      for (let i = 0; i < np; i++) { const off = (i - (np - 1) / 2) * 1.3; b.rbox(o[0] + o[3] * off, g + 0.42, o[1] - o[2] * off, L, 0.06, 0.7, a, 0.42, 0.5, 0.58, S.PLAIN); b.rbox(o[0] + o[3] * off, g, o[1] - o[2] * off, L, 0.1, 0.5, a, 0.7, 0.68, 0.64, S.PLAIN); }
      if (!rs.halt) { const off = (np / 2 + 0.6) * 1.3; b.rbox(o[0] + o[3] * off, g, o[1] - o[2] * off, major ? 14 : 6, 0.9, 1.1, a, 0.88, 0.8, 0.66, S.INST); b.rbox(o[0] + o[3] * off, g + 0.9, o[1] - o[2] * off, major ? 14.4 : 6.4, 0.14, 1.3, a, 0.6, 0.26, 0.2, S.PLAIN); }
    }
    // ---- peripheral marker: Kempegowda International Airport lies north of the modelled extent ----
    for (const p of D.periph) { const g = VB.H(p.x, p.z + 4); b.box(p.x, g, p.z + 4, 0.5, 6, 0.5, 0.75, 0.52, 0.12, S.PLAIN); b.box(p.x, g + 6, p.z + 3, 3, 1.2, 0.4, 0.95, 0.75, 0.2, S.LAMP); }
    // Split the 45 k infrastructure boxes into 6.4 km tiles so that they are frustum-culled like the rest of the city
    // (as one un-culled mesh they cost ~0.5 M triangles in every frame and in every shadow pass).
    const TS = 640, nt = Math.ceil(D.HALF * 2 / TS), tiles = new Map(), meshes = [];
    for (let i = 0; i < b.n; i++) {
      const x = b.m[i * 16 + 12], z = b.m[i * 16 + 14], tx = Math.max(0, Math.min(nt - 1, Math.floor((x + D.HALF) / TS))), tz = Math.max(0, Math.min(nt - 1, Math.floor((z + D.HALF) / TS))), k = tz * nt + tx;
      let t = tiles.get(k); if (!t) { t = { b: new VB.Batch(1024), x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9, y0: 1e9, y1: -1e9 }; tiles.set(k, t); }
      const tb = t.b; if (tb.n === tb.cap) tb.grow(); tb.m.set(b.m.subarray(i * 16, i * 16 + 16), tb.n * 16); tb.c.set(b.c.subarray(i * 3, i * 3 + 3), tb.n * 3); tb.s[tb.n++] = b.s[i];
      const y = b.m[i * 16 + 13], r = Math.max(Math.hypot(b.m[i * 16], b.m[i * 16 + 2]), Math.hypot(b.m[i * 16 + 8], b.m[i * 16 + 10])) * 0.75;
      t.x0 = Math.min(t.x0, x - r); t.x1 = Math.max(t.x1, x + r); t.z0 = Math.min(t.z0, z - r); t.z1 = Math.max(t.z1, z + r); t.y0 = Math.min(t.y0, y); t.y1 = Math.max(t.y1, y + b.m[i * 16 + 5]);
    }
    for (const t of tiles.values()) {
      const m = t.b.mesh(city.geo, city.mat, true); m.name = 'infra';
      m.boundingSphere = new THREE.Sphere(new THREE.Vector3((t.x0 + t.x1) / 2, (t.y0 + t.y1) / 2, (t.z0 + t.z1) / 2), Math.hypot(t.x1 - t.x0, t.y1 - t.y0, t.z1 - t.z0) / 2 + 1);
      scene.add(m); meshes.push(m);
    }
    VB.infra = { meshes, count: b.n, flyoverKm: flyKm };

    // ---- overlays (toggleable, drawn above everything) ----
    const mkLines = (segs, colours, dashed) => {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
      const mat = dashed ? new THREE.LineDashedMaterial({ vertexColors: true, dashSize: 6, gapSize: 5, depthTest: false, transparent: true, fog: false }) : new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, fog: false });
      const l = new THREE.LineSegments(g, mat); if (dashed) l.computeLineDistances(); l.renderOrder = 50; l.frustumCulled = false; l.visible = false; scene.add(l); return l;
    };
    const push = (segs, cols, pts, col, lift) => { for (let k = 0; k + 3 < pts.length; k += 2) { segs.push(pts[k], VB.H(pts[k], pts[k + 1]) + lift, pts[k + 1], pts[k + 2], VB.H(pts[k + 2], pts[k + 3]) + lift, pts[k + 3]); cols.push(col[0], col[1], col[2], col[0], col[1], col[2]); } };
    const rc = [[1, 0.25, 0.2], [1, 0.35, 0.2], [1, 0.6, 0.15], [1, 0.85, 0.3], [1, 1, 0.75]];
    let s1 = [], c1 = []; for (const e of D.edges) push(s1, c1, e.pts, rc[e.cls], 2.5);
    const roads = mkLines(s1, c1, false);
    s1 = []; c1 = []; for (const l of D.metro) push(s1, c1, l.pts, [parseInt(l.colour.slice(1, 3), 16) / 255, parseInt(l.colour.slice(3, 5), 16) / 255, parseInt(l.colour.slice(5, 7), 16) / 255], 4);
    const metroOp = mkLines(s1, c1, false);
    s1 = []; c1 = []; for (const u of D.metroUC) push(s1, c1, u.pts, u.status === 'proposed' ? [0.75, 0.75, 0.75] : u.line === 'blue' ? [0.3, 0.55, 1] : [1, 0.6, 0.8], 4);
    const metroUC = mkLines(s1, c1, true);
    s1 = []; c1 = []; for (const p of D.rail) push(s1, c1, p, [0.15, 0.15, 0.15], 3);
    const rail = mkLines(s1, c1, false);
    s1 = []; c1 = []; for (const bd of D.bounds) push(s1, c1, bd.pts, [1, 0.88, 0.4], 5);
    const bounds = mkLines(s1, c1, false);
    VB.overlays = { roads, metro: [metroOp, metroUC, rail], bounds, set(name, on) { const t = this[name]; (Array.isArray(t) ? t : [t]).forEach(x => x.visible = on); } };
  };
})();
