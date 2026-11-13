/* Voxel Bengaluru — everyday activity: pooled, instanced traffic on the mapped road graph (left-hand traffic),
   Namma Metro trains on operational lines only, pedestrians near transit / markets, bilingual shop signage. */
'use strict';
(() => {
  const K = VB.K, C = VB.C, lin = VB.lin;
  // ---- voxel vehicle geometry: list of boxes [x,y,z,w,h,d,colour|null(tinted by instance colour),glow] -> BufferGeometry
  const voxGeo = (parts) => {
    const gs = [], box = VB.openBox(1, 1, 1), pos = [], nor = [], col = [], fix = [], glow = [], idx = []; let base = 0;      // boxes without bottom faces
    const bp = box.attributes.position.array, bn = box.attributes.normal.array, bi = box.index.array;
    for (const [x, y, z, w, h, d, c, g] of parts) {
      const cc = c === null ? [1, 1, 1] : lin(c);
      for (let i = 0; i < bp.length; i += 3) { pos.push(bp[i] * w + x, (bp[i + 1] + 0.5) * h + y, bp[i + 2] * d + z); nor.push(bn[i], bn[i + 1], bn[i + 2]); col.push(cc[0], cc[1], cc[2]); fix.push(c === null ? 0 : 1); glow.push(g || 0); }
      for (let i = 0; i < bi.length; i++) idx.push(bi[i] + base); base += bp.length / 3;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.setAttribute('aFix', new THREE.Float32BufferAttribute(fix, 1)); geo.setAttribute('aGlow', new THREE.Float32BufferAttribute(glow, 1));
    geo.setIndex(idx); return geo;
  };
  const PDX = new Int8Array([1, -1, 0, 0]), PDZ = new Int8Array([0, 0, 1, -1]);
  const HL = 0xfff2c0, TL = 0xff2a1a, DK = 0x22262c;
  const lights = (L, y, w) => [[L / 2, y, w, 0.02, 0.04, 0.06, HL, 1], [L / 2, y, -w, 0.02, 0.04, 0.06, HL, 1], [-L / 2, y, w, 0.02, 0.04, 0.06, TL, 1], [-L / 2, y, -w, 0.02, 0.04, 0.06, TL, 1]];
  const GEO = {
    car: () => voxGeo([[0, 0.04, 0, 0.67, 0.12, 0.27, null], [-0.03, 0.16, 0, 0.36, 0.09, 0.24, DK], ...lights(0.67, 0.09, 0.09)]),
    bus: () => voxGeo([[0, 0.05, 0, 1.92, 0.45, 0.41, null], [0, 0.28, 0, 1.8, 0.13, 0.415, DK], [0, 0.5, 0, 1.86, 0.025, 0.38, 0xf1f1ee], [0.955, 0.36, 0, 0.02, 0.07, 0.3, 0xffb030, 0.7], ...lights(1.92, 0.12, 0.14)]),
    auto: () => voxGeo([[0, 0.03, 0, 0.43, 0.1, 0.22, 0x2f8a3c], [0.02, 0.13, 0, 0.3, 0.09, 0.2, 0x1a1a1a], [0, 0.22, 0, 0.4, 0.05, 0.22, 0xf0c020], [0.2, 0.13, 0, 0.03, 0.09, 0.18, 0xf0c020], [0.215, 0.07, 0, 0.02, 0.04, 0.05, HL, 1], [-0.215, 0.07, 0, 0.02, 0.03, 0.14, TL, 1]]),
    scooter: () => voxGeo([[0, 0.03, 0, 0.29, 0.08, 0.08, null], [-0.02, 0.11, 0, 0.08, 0.13, 0.1, 0x3a4250], [-0.02, 0.24, 0, 0.07, 0.06, 0.07, 0xdcdcdc], [0.145, 0.09, 0, 0.02, 0.03, 0.04, HL, 1], [-0.145, 0.08, 0, 0.02, 0.03, 0.04, TL, 1]]),
    van: () => voxGeo([[0.2, 0.04, 0, 0.24, 0.2, 0.26, null], [0.26, 0.15, 0, 0.1, 0.08, 0.24, DK], [-0.1, 0.05, 0, 0.42, 0.26, 0.27, 0xe9e6de], ...lights(0.64, 0.08, 0.09)]),
    truck: () => voxGeo([[0.45, 0.05, 0, 0.38, 0.36, 0.38, null], [0.6, 0.26, 0, 0.1, 0.1, 0.34, DK], [-0.2, 0.09, 0, 0.88, 0.36, 0.38, 0x8a7a5a], ...lights(1.28, 0.1, 0.13)]),
    metro: () => voxGeo([[0, 0, 0, 2.1, 0.36, 0.29, 0xe6e8ea], [0, 0.17, 0, 2.0, 0.1, 0.295, 0x1d2228], [0, 0.07, 0, 2.11, 0.05, 0.3, null], [0, 0.36, 0, 1.9, 0.03, 0.2, 0xb9bdc2], [0, 0.19, 0, 1.6, 0.06, 0.3, 0xfff1c8, 0.35]]),
    ped: () => voxGeo([[0, 0, 0, 0.08, 0.18, 0.1, null], [0, 0.18, 0, 0.075, 0.075, 0.075, 0xb98a66]]),
  };
  const TINTS = {
    car: [0xf2f2f2, 0xf2f2f2, 0xc9ccd1, 0x8d9299, 0x2c2f36, 0xa5282a, 0x2c4f8f, 0xd8d2c2, 0x6b4a36],
    bus: [0x2f62b0, 0x2f62b0, 0x3a9a5a, 0xc23a2e, 0x62b6d8],          // BMTC-style liveries: blue, green, red (AC), light-blue (electric)
    scooter: [0x2a2a2e, 0xb02a2a, 0x2c4f8f, 0xd8d8d8, 0x3e8a8a, 0xe0b23c],
    van: [0xf2f2f2, 0xe9d24a, 0xf2f2f2, 0x3a7ab8],
    truck: [0xd9772e, 0x2c5f9f, 0xb8b8b8, 0x9a3a2a, 0xe0c040],
    ped: [0xf2f2f2, 0x3a5fa8, 0xd94f4f, 0xe0b23c, 0x4d9a57, 0x2a2a2e, 0xe88ab0, 0x8a5fb8, 0xf0a050, 0x62b6d8],
  };
  const makeMat = () => {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = VB.uniforms.uNight;
      sh.vertexShader = 'attribute float aFix; attribute float aGlow; varying float vGlow;\n' + sh.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\n if (aFix > 0.5) vColor.rgb = color.rgb; vGlow = aGlow;');
      sh.fragmentShader = 'uniform float uNight; varying float vGlow;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * vGlow * (0.15 + 2.4 * uNight);');
    };
    return m;
  };
  const TYPES = ['scooter', 'car', 'auto', 'bus', 'van', 'truck'];
  const SPEED = [1.0, 1.0, 0.85, 0.8, 0.9, 0.75];
  // base speeds in scene units / s (already includes the documented x2 time-lapse): motorway, trunk, primary, secondary, tertiary
  const VCLS = [2.8, 1.9, 1.5, 1.25, 1.0];
  const CLSW = [3, 3, 3, 2, 1];

  VB.Life = class {
    constructor(scene) {
      const D = this.D = VB.data, cap = this.cap = VB.cfg.maxVehicles; this.scene = scene; this.mat = makeMat(); this.t = 0; this.o = [0, 0, 0, 0];
      this.edge = new Int32Array(cap); this.dir = new Int8Array(cap); this.s = new Float32Array(cap); this.v = new Float32Array(cap); this.lane = new Uint8Array(cap);
      this.type = new Uint8Array(cap); this.vf = new Float32Array(cap); this.rs = new Uint32Array(cap); this.stop = new Uint8Array(cap); this.px = new Float32Array(cap); this.pz = new Float32Array(cap);
      this.q = new Uint8Array(D.edges.length * 2); this.active = 0; this.fresh = true; this.lastChunk = -2;
      for (let i = 0; i < cap; i++) { this.rs[i] = (Math.imul(i + 1, 2654435761) ^ VB.seed) >>> 0; this.edge[i] = -1; }
      const capOf = { scooter: 0.45, car: 0.34, auto: 0.16, bus: 0.09, van: 0.09, truck: 0.07 };
      this.meshes = TYPES.map((t, ti) => {
        const n = Math.ceil(cap * capOf[t]) + 8, m = new THREE.InstancedMesh(GEO[t](), this.mat, n); m.count = 0; m.frustumCulled = false; m.castShadow = false; m.name = 'veh-' + t;   // moving objects never cast into the cached shadow map
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3); m.userData.cap = n; scene.add(m); return m;
      });
      this.tint = new Float32Array(cap * 3);
      // per-chunk road weight for density control
      for (const c of VB.city.chunks) { let w = 0; for (const ei of c.edges) { const e = D.edges[ei]; if (e.lvl >= 0) w += Math.min(e.len, 128) * [1, 1, 1, 0.6, 0.35][e.cls]; } c.roadW = w; }
      this.initMetro(); this.initPeds(); this.initSigns();
    }
    rnd(i) { let a = this.rs[i] = (this.rs[i] + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }

    spawn(i, fx, fz, R) {
      const D = this.D, city = VB.city;
      for (let tries = 0; tries < 8; tries++) {
        const a = this.rnd(i) * 6.2832, r = R * (this.fresh ? Math.sqrt(this.rnd(i)) : 0.78 + 0.22 * this.rnd(i));
        const ci = city.chunkIndex(fx + Math.cos(a) * r, fz + Math.sin(a) * r); if (ci < 0) continue;
        const ce = city.chunks[ci].edges; if (!ce.length) continue;
        let e = D.edges[ce[(this.rnd(i) * ce.length) | 0]]; const e2 = D.edges[ce[(this.rnd(i) * ce.length) | 0]]; if (e2.cls < e.cls) e = e2;
        if (e.lvl < 0 || e.len < 1) continue;
        const s = this.rnd(i) * e.len, dir = e.ow ? 1 : (this.rnd(i) < 0.5 ? 1 : -1);
        VB.along(e.pts, e.cum, dir > 0 ? s : e.len - s, this.o); if (Math.hypot(this.o[0] - fx, this.o[1] - fz) > R * 1.15) continue;
        this.edge[i] = e.i; this.dir[i] = dir; this.s[i] = s; this.stop[i] = 0;
        const u = this.rnd(i); let t = u < 0.4 ? 0 : u < 0.7 ? 1 : u < 0.83 ? 2 : u < 0.9 ? 3 : u < 0.96 ? 4 : 5;
        if (t === 5 && e.cls > 2) t = 1; if (t === 3 && e.cls > 3) t = 0;
        this.type[i] = t; this.vf[i] = SPEED[t] * (0.85 + 0.3 * this.rnd(i));
        const nl = e.ow ? Math.min(3, e.lanes) : Math.min(3, Math.max(1, e.lanes >> 1)); this.lane[i] = (t === 3 || t === 5) ? 0 : (this.rnd(i) * nl) | 0;
        const pal = TINTS[TYPES[t]], c = pal ? lin(pal[(this.rnd(i) * pal.length) | 0]) : [1, 1, 1]; this.tint[i * 3] = c[0]; this.tint[i * 3 + 1] = c[1]; this.tint[i * 3 + 2] = c[2];
        return true;
      }
      this.edge[i] = -1; return false;
    }
    nextEdge(i, e, node, hx, hz) {
      const outs = this.D.out[node], D = this.D; let tot = 0; const w = this._w || (this._w = new Float32Array(16)); const n = Math.min(outs.length, 16);
      for (let k = 0; k < n; k++) {
        const [ei, d] = outs[k], c = D.edges[ei]; if (ei === e.i || c.lvl < 0 && e.lvl >= 0 && c.len < 3) { w[k] = 0; continue; }
        const p = c.pts, m = p.length; let dx, dz; if (d > 0) { dx = p[2] - p[0]; dz = p[3] - p[1]; } else { dx = p[m - 4] - p[m - 2]; dz = p[m - 3] - p[m - 1]; }
        const l = Math.hypot(dx, dz) || 1, dot = (dx * hx + dz * hz) / l; if (dot < -0.7) { w[k] = 0; continue; }
        w[k] = (dot + 1.15) * (dot + 1.15) * CLSW[c.cls] * (c.link ? 0.5 : 1); tot += w[k];
      }
      if (tot <= 0) { if (!e.ow) { this.dir[i] = -this.dir[i]; this.s[i] = 0; return true; } return false; }
      let r = this.rnd(i) * tot;
      for (let k = 0; k < n; k++) { r -= w[k]; if (r <= 0 && w[k] > 0) { const [ei, d] = outs[k]; this.edge[i] = ei; this.dir[i] = d; this.s[i] = 0; const c = D.edges[ei], nl = c.ow ? Math.min(3, c.lanes) : Math.min(3, Math.max(1, c.lanes >> 1)); if (this.lane[i] >= nl) this.lane[i] = nl - 1; return true; } }
      return false;
    }
    update(dt, focus, range) {
      this.t += dt;
      const D = this.D, o = this.o, fx = focus.x, fz = focus.z, show = range < VB.cfg.lifeCut, R = Math.min(430, Math.max(130, range * 0.95));
      const counts = this._counts || (this._counts = new Int32Array(TYPES.length)); counts.fill(0);
      if (show) {
        // density-controlled pool size for the current activity bubble
        const ci = VB.city.chunkIndex(fx, fz);
        if (ci !== this.lastChunk || Math.abs(R - (this.lastR || 0)) > 40) {
          this.lastChunk = ci; this.lastR = R; let w = 0; const nc = VB.city.nc, cx = ci % nc, cz = (ci / nc) | 0, rr = Math.ceil(R / K.CHUNK);
          if (ci >= 0) for (let a = -rr; a <= rr; a++) for (let b = -rr; b <= rr; b++) { const x = cx + a, z = cz + b; if (x < 0 || z < 0 || x >= nc || z >= nc) continue; const c = VB.city.chunks[z * nc + x]; if (Math.hypot(c.x - fx, c.z - fz) < R + 60) w += c.roadW; }
          this.active = Math.min(VB.cfg.vehicles, this.cap, Math.round(w * 0.2));
        }
        const T = this.t, q = this.q, sig = D.signals;
        for (let i = 0; i < this.active; i++) {
          if (this.edge[i] < 0 && !this.spawn(i, fx, fz, R)) continue;
          let e = D.edges[this.edge[i]], dir = this.dir[i], s = this.s[i];
          const node = dir > 0 ? e.b : e.a, rem = e.len - s; let v = VCLS[e.cls] * this.vf[i] * (e.link ? 0.7 : 1);
          if (sig.has(node)) {
            let axis = dir > 0 ? e.axB : e.axA;              // approach axis at the signal, cached per edge end
            if (axis === undefined) { VB.along(e.pts, e.cum, dir > 0 ? e.len : 0, o); axis = Math.abs(o[2]) > Math.abs(o[3]) ? 0 : 1; if (dir > 0) e.axB = axis; else e.axA = axis; }
            const ph = ((T + (node % 37)) / 16 | 0) & 1, qi = e.i * 2 + (dir > 0 ? 1 : 0);
            if (ph !== axis) { if (this.stop[i]) v = 0; else if (rem < 0.9 + q[qi] * 0.8 + this.lane[i] * 0.0 && rem > 0.3) { v = 0; this.stop[i] = 1; if (q[qi] < 250 && this.lane[i] === 0) q[qi]++; } else if (rem < 5 + q[qi] * 0.8) v *= 0.55; }
            else if (this.stop[i]) { this.stop[i] = 0; q[qi] = 0; }
          }
          s += v * dt;
          if (s >= e.len) {
            VB.along(e.pts, e.cum, dir > 0 ? e.len : 0, o);
            if (!this.nextEdge(i, e, node, o[2] * dir, o[3] * dir)) { this.spawn(i, fx, fz, R); if (this.edge[i] < 0) continue; }
            e = D.edges[this.edge[i]]; dir = this.dir[i]; s = this.s[i]; this.stop[i] = 0;
          }
          this.s[i] = s;
          const sa = dir > 0 ? s : e.len - s; VB.along(e.pts, e.cum, sa, o);
          const dx = o[2] * dir, dz = o[3] * dir, t = this.type[i];
          const off = e.ow ? (this.lane[i] - (Math.min(3, e.lanes) - 1) / 2) * 0.3 : 0.2 + this.lane[i] * 0.3 + (t === 0 ? 0.08 : 0);
          const x = o[0] + dz * off, z = o[1] - dx * off;                       // left of the direction of travel (India drives on the left)
          this.px[i] = x; this.pz[i] = z;
          if ((x - fx) * (x - fx) + (z - fz) * (z - fz) > R * R * 1.5) { this.edge[i] = -1; continue; }
          const m = this.meshes[t], k = counts[t]; if (k >= m.userData.cap) continue; counts[t]++;
          const a = m.instanceMatrix.array, p = k * 16, y = VB.H(x, z) + VB.roadY(e, sa) + 0.02;
          a[p] = dx; a[p + 1] = 0; a[p + 2] = dz; a[p + 3] = 0; a[p + 4] = 0; a[p + 5] = 1; a[p + 6] = 0; a[p + 7] = 0; a[p + 8] = -dz; a[p + 9] = 0; a[p + 10] = dx; a[p + 11] = 0; a[p + 12] = x; a[p + 13] = y; a[p + 14] = z; a[p + 15] = 1;
          const ca = m.instanceColor.array; ca[k * 3] = this.tint[i * 3]; ca[k * 3 + 1] = this.tint[i * 3 + 1]; ca[k * 3 + 2] = this.tint[i * 3 + 2];
        }
        this.fresh = false;
      } else { this.fresh = true; this.lastChunk = -2; for (let i = 0; i < this.active; i++) this.edge[i] = -1; }
      for (let t = 0; t < TYPES.length; t++) { const m = this.meshes[t]; m.count = counts[t]; m.visible = counts[t] > 0; if (counts[t]) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; } }
      let vc = 0; if (show) for (let t = 0; t < counts.length; t++) vc += counts[t]; this.vehicleCount = vc;
      this.updateMetro(dt, range); this.updatePeds(dt, focus, range, show); if (VB.city.signsDirty) this.fillSigns();
    }

    // ---- Namma Metro trains: operational lines only, six-car sets, left-hand running, dwell at mapped stations ----
    initMetro() {
      const l_stops = (l) => { if (!l.stopsF) l.stopsF = Float32Array.from(l.stops); };
      const D = this.D, trains = this.trains = []; let cars = 0;
      for (const l of D.metro) {
        if (l.status !== 'operational') continue;
        const sts = D.stations.filter(s => s.line === l.key && s.status === 'operational' && s.s !== undefined).map(s => s.s).sort((a, b) => a - b); l.stops = sts;
        const n = Math.max(2, Math.round(l.len / 520));
        for (let k = 0; k < n * 2; k++) { const dir = k % 2 ? 1 : -1; trains.push({ l, dir0: dir, s0: ((k >> 1) + 0.5 * (k % 2) + 0.25) / n * l.len, col: lin(parseInt(l.colour.slice(1), 16)) }); cars += 6; }
      }
      const nT = trains.length; this.tS = new Float32Array(nT); this.tDwell = new Float32Array(nT); this.tDir = new Int8Array(nT); trains.forEach((t, i) => { this.tS[i] = t.s0; this.tDir[i] = t.dir0; l_stops(t.l); });
      const m = this.metroMesh = new THREE.InstancedMesh(GEO.metro(), this.mat, cars); m.frustumCulled = false; m.castShadow = false; m.name = 'metro-trains';
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cars * 3), 3);
      trains.forEach((t, i) => { for (let c = 0; c < 6; c++) m.instanceColor.setXYZ(i * 6 + c, t.col[0], t.col[1], t.col[2]); }); this.scene.add(m);
    }
    updateMetro(dt, range) {
      const m = this.metroMesh, a = m.instanceMatrix.array, o = this.o, V = 2.0, T = this.trains, tS = this.tS, tW = this.tDwell, tD = this.tDir; let k = 0;
      for (let ti = 0; ti < T.length; ti++) {
        const l = T[ti].l, len = l.len, cum = l.cum, tun = l.tun, dir = tD[ti]; let s = tS[ti];
        if (tW[ti] > 0) tW[ti] -= dt; else {
          const s0 = s, st = l.stopsF; s += V * dt * dir;
          for (let j = 0; j < st.length; j++) { const p = st[j]; if ((s0 - p) * (s - p) <= 0 && s0 !== p) { s = p; tW[ti] = 3.5; break; } }
          if (s >= len - 7) { s = len - 7; tD[ti] = -1; tW[ti] = 4; } else if (s <= 7) { s = 7; tD[ti] = 1; tW[ti] = 4; }
          tS[ti] = s;
        }
        const d = tD[ti];
        for (let c = 0; c < 6; c++, k++) {
          const sc = s + (c - 2.5) * 2.2; VB.along(l.pts, cum, sc, o);
          let lo = 0, hi = cum.length - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= sc) lo = mid; else hi = mid; }
          const p = k * 16, under = tun[lo] && tun[lo + 1 < tun.length ? lo + 1 : tun.length - 1], dx = o[2] * d, dz = o[3] * d, sc1 = under ? 0 : 1;
          const x = o[0] + dz * 0.2, z = o[1] - dx * 0.2;
          a[p] = dx * sc1; a[p + 1] = 0; a[p + 2] = dz * sc1; a[p + 3] = 0; a[p + 4] = 0; a[p + 5] = sc1; a[p + 6] = 0; a[p + 7] = 0; a[p + 8] = -dz * sc1; a[p + 9] = 0; a[p + 10] = dx * sc1; a[p + 11] = 0;
          a[p + 12] = x; a[p + 13] = VB.H(x, z) + VB.METRO_Y + 0.06; a[p + 14] = z; a[p + 15] = 1;
        }
      }
      m.instanceMatrix.needsUpdate = true;
    }

    // ---- pedestrians: random walk over walkable 10 m cells near bus stops, markets and Metro stations ----
    initPeds() {
      const n = this.pedCap = VB.cfg.maxPeds; this.pp = new Float32Array(n * 4); this.pa = new Uint8Array(n); this.prs = new Uint32Array(n);
      for (let i = 0; i < n; i++) this.prs[i] = (Math.imul(i + 77, 2246822519) ^ VB.seed) >>> 0;
      const m = this.pedMesh = new THREE.InstancedMesh(GEO.ped(), this.mat, n); m.count = 0; m.frustumCulled = false; m.name = 'pedestrians';
      const col = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const c = lin(TINTS.ped[i % TINTS.ped.length]); col.set(c, i * 3); }
      m.instanceColor = new THREE.InstancedBufferAttribute(col, 3); this.scene.add(m); this.anchors = []; this.anchorChunk = -2;
    }
    prnd(i) { let a = this.prs[i] = (this.prs[i] + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
    walkable(x, z) { const v = VB.cellAt(x, z); return v === C.PAVED || v === C.RD_MINOR || v === C.PARK; }
    updatePeds(dt, focus, range, show) {
      const m = this.pedMesh; if (!show || range > 520) { m.count = 0; m.visible = false; this.anchorChunk = -2; this.pa.fill(0); return; }
      const D = this.D, city = VB.city, ci = city.chunkIndex(focus.x, focus.z);
      if (ci !== this.anchorChunk) {
        this.anchorChunk = ci; const A = this.anchors = []; const nc = city.nc, cx = ci % nc, cz = (ci / nc) | 0;
        if (ci >= 0) for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const x = cx + a, z = cz + b; if (x < 0 || z < 0 || x >= nc || z >= nc) continue; const c = city.chunks[z * nc + x];
          for (const k of c.stops) A.push(D.busStops[k], D.busStops[k + 1], 2); for (const k of c.markets) for (let r = 0; r < 8; r++) A.push(D.markets[k][0], D.markets[k][1], 3.5); }
        for (const s of D.stations) if (s.status === 'operational' && Math.hypot(s.x - focus.x, s.z - focus.z) < 260) for (let r = 0; r < 6; r++) A.push(s.x, s.z, 3);
        this.pa.fill(0);
      }
      const A = this.anchors, nA = A.length / 3, n = Math.min(this.pedCap, VB.cfg.peds, nA * 4), pp = this.pp, arr = m.instanceMatrix.array; let k = 0;
      const sp = 0.26 * dt;
      for (let i = 0; i < n; i++) {
        const q = i * 4;
        if (!this.pa[i]) {
          const an = ((this.prnd(i) * nA) | 0) * 3, r = A[an + 2], x = A[an] + (this.prnd(i) - 0.5) * 2 * r, z = A[an + 1] + (this.prnd(i) - 0.5) * 2 * r;
          if (!this.walkable(x, z)) continue;
          pp[q] = x; pp[q + 1] = z; pp[q + 2] = x; pp[q + 3] = z; this.pa[i] = 1;
        }
        let x = pp[q], z = pp[q + 1]; const dx = pp[q + 2] - x, dz = pp[q + 3] - z, d = Math.sqrt(dx * dx + dz * dz);
        if (d < sp + 0.01) {
          const pk = (this.prnd(i) * 4) | 0, p0 = PDX[pk], p1 = PDZ[pk], side = ((i % 2) - 0.5) * 0.66;
          const tx = Math.floor(x) + 0.5 + p0 + (p0 ? 0 : side), tz = Math.floor(z) + 0.5 + p1 + (p1 ? 0 : side);
          if (this.walkable(tx, tz)) { pp[q + 2] = tx; pp[q + 3] = tz; } else if (this.prnd(i) < 0.02) this.pa[i] = 0;
        } else { x += dx / d * sp; z += dz / d * sp; pp[q] = x; pp[q + 1] = z; }
        const p = k * 16, ux = d > 0.01 ? dx / d : 1, uz = d > 0.01 ? dz / d : 0, bob = Math.abs(Math.sin(this.t * 9 + i)) * 0.015;
        arr[p] = ux; arr[p + 1] = 0; arr[p + 2] = uz; arr[p + 3] = 0; arr[p + 4] = 0; arr[p + 5] = 1; arr[p + 6] = 0; arr[p + 7] = 0; arr[p + 8] = -uz; arr[p + 9] = 0; arr[p + 10] = ux; arr[p + 11] = 0;
        arr[p + 12] = x; arr[p + 13] = VB.H(x, z) + 0.01 + bob; arr[p + 14] = z; arr[p + 15] = 1; k++;
      }
      m.count = k; m.visible = k > 0; m.instanceMatrix.needsUpdate = true; this.pedCount = k;
    }

    // ---- bilingual (Kannada first, English second) shop boards, drawn with local system fonts into one canvas atlas ----
    initSigns() {
      const SIGNS = [['ಬೇಕರಿ', 'BAKERY'], ['ಮೆಡಿಕಲ್ಸ್', 'MEDICALS'], ['ದರ್ಶಿನಿ', 'DARSHINI'], ['ಕಾಫಿ', 'COFFEE'], ['ಚಹಾ', 'TEA STALL'], ['ಹೂವು', 'FLOWERS'], ['ಹಣ್ಣು', 'FRUITS'], ['ಪ್ರಾವಿಷನ್ ಸ್ಟೋರ್', 'PROVISION STORE'],
        ['ಸೂಪರ್ ಮಾರ್ಕೆಟ್', 'SUPERMARKET'], ['ಹೋಟೆಲ್', 'HOTEL'], ['ಬಟ್ಟೆ ಅಂಗಡಿ', 'TEXTILES'], ['ಮೊಬೈಲ್ಸ್', 'MOBILES'], ['ಕ್ಲಿನಿಕ್', 'CLINIC'], ['ಪುಸ್ತಕ', 'BOOKS'], ['ಜ್ಯೂಸ್', 'JUICE'], ['ಹಾರ್ಡ್‌ವೇರ್', 'HARDWARE']];
      const BG = ['#b3261e', '#1f5fa8', '#f2c230', '#1f7a4a', '#f4f1e8', '#7a3fa0', '#e0762a', '#22303c'], FG = ['#fff', '#fff', '#222', '#fff', '#a3211a', '#fff', '#fff', '#ffd75e'];
      const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 256; const g = cv.getContext('2d'); g.textAlign = 'center'; g.textBaseline = 'middle';
      const font = '"Noto Sans Kannada","Nirmala UI","Kannada Sangam MN",Tunga,"Noto Sans",system-ui,sans-serif';
      SIGNS.forEach((s, i) => { const x = (i % 4) * 256, y = (i >> 2) * 64, b = i % 8; g.fillStyle = BG[b]; g.fillRect(x, y, 256, 64); g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 3; g.strokeRect(x + 3, y + 3, 250, 58);
        g.fillStyle = FG[b]; g.font = '700 30px ' + font; g.fillText(s[0], x + 128, y + 24, 236); g.font = '700 17px ' + font; g.fillText(s[1], x + 128, y + 50, 236); });
      VB.signTexts = SIGNS;
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
      mat.onBeforeCompile = (sh) => { sh.vertexShader = 'attribute float aIdx;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n vMapUv = vec2((mod(aIdx, 4.0) + uv.x) / 4.0, 1.0 - (floor(aIdx / 4.0) + 1.0 - uv.y) / 4.0);'); };
      const cap = this.signCap = 3000, geo = new THREE.PlaneGeometry(0.92, 0.23); this.signIdx = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1); geo.setAttribute('aIdx', this.signIdx);
      const m = this.signMesh = new THREE.InstancedMesh(geo, mat, cap); m.count = 0; m.frustumCulled = false; m.name = 'signs'; this.scene.add(m);
    }
    fillSigns() {
      const m = this.signMesh, a = m.instanceMatrix.array, idx = this.signIdx.array; let k = 0;
      for (const c of VB.city.chunks) { if (!c.near || !c.signs) continue; const s = c.signs;
        for (let i = 0; i < s.length && k < this.signCap; i += 5, k++) { const p = k * 16, cs = Math.cos(s[i + 3]), sn = Math.sin(s[i + 3]);
          a[p] = cs; a[p + 1] = 0; a[p + 2] = -sn; a[p + 3] = 0; a[p + 4] = 0; a[p + 5] = 1; a[p + 6] = 0; a[p + 7] = 0; a[p + 8] = sn; a[p + 9] = 0; a[p + 10] = cs; a[p + 11] = 0; a[p + 12] = s[i]; a[p + 13] = s[i + 1]; a[p + 14] = s[i + 2]; a[p + 15] = 1; idx[k] = s[i + 4]; } }
      m.count = k; m.instanceMatrix.needsUpdate = true; this.signIdx.needsUpdate = true; VB.city.signsDirty = false; this.signCount = k;
    }
  };
})();
