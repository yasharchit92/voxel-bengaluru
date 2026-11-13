/* Voxel Bengaluru — landmark massing. Every model is positioned at the centroid of its OpenStreetMap feature and
   oriented along that feature's minimum rotated rectangle. Only the massing *inside* the footprint is stylised. */
'use strict';
(() => {
  const S = VB.S, lin = VB.lin, hU = (m) => m / VB.K.UNIT_M * VB.K.BLD_EX;   // metres of height -> scene units
  const c = (hex) => lin(hex);
  const MODELS = {};

  // local-frame builder: +lx along the footprint's long axis, +lz across (front), y up from flattened ground
  const frame = (b, lm, front) => {
    const th = lm.obb ? lm.obb[2] : 0, cs = Math.cos(th), sn = Math.sin(th), y0 = VB.H(lm.x, lm.z) - 0.05, f = front || 1;
    const fn = (lx, ly, lz, w, h, d, col, st, rot = 0) => { lz *= f; b.rbox(lm.x + lx * cs + lz * sn, y0 + ly, lm.z - lx * sn + lz * cs, w, h, d, th + rot, col[0], col[1], col[2], st === undefined ? S.PLAIN : st); };
    fn.dome = (lx, ly, lz, r, h, col, st) => { const k = [1, 0.93, 0.8, 0.6, 0.34]; for (let i = 0; i < k.length; i++) { fn(lx, ly + h * i / k.length, lz, 2 * r * k[i], h / k.length + 0.01, 2 * r * k[i], col, st); fn(lx, ly + h * i / k.length, lz, 2 * r * k[i] * 0.92, h / k.length + 0.01, 2 * r * k[i] * 0.92, col, st, Math.PI / 4); } };
    return fn;
  };
  const frontToward = (lm, other) => {       // which side of the short axis faces another (OSM-located) feature
    if (!other || !lm.obb) return 1; const th = lm.obb[2], zx = Math.sin(th), zz = Math.cos(th);
    return ((other.x - lm.x) * zx + (other.z - lm.z) * zz) >= 0 ? 1 : -1;
  };

  MODELS.vidhana = (b, lm, all, small) => {
    const L = Math.min(lm.obb[0], small ? 14 : 21), W = Math.min(lm.obb[1], small ? 7 : 10.5), B = frame(b, lm, frontToward(lm, all[small ? 'vidhana' : 'highcourt']));
    const stone = c(0xd8d0bc), stone2 = c(0xc9c0aa), white = c(0xefeadc), hb = hU(20);
    B(0, 0, 0, L, hU(3), W, stone2, S.PLAIN);                                    // plinth
    B(0, hU(3), 0, L * 0.96, hb - hU(3), W * 0.72, stone, S.INST);                  // main block
    B(-L * 0.42, hU(3), 0, L * 0.12, hb - hU(1), W * 0.9, stone, S.INST); B(L * 0.42, hU(3), 0, L * 0.12, hb - hU(1), W * 0.9, stone, S.INST);   // end wings
    B(0, hb, 0, L * 0.96, hU(1.5), W * 0.76, white, S.PLAIN);                      // cornice
    B(0, hU(3), W * 0.42, L * 0.3, hb - hU(4), W * 0.16, stone2, S.PLAIN);          // portico mass
    for (let i = -5; i <= 5; i++) B(i * L * 0.027, hU(3), W * 0.52, 0.16, hb - hU(5), 0.16, white, S.PLAIN);   // columns
    B(0, hb - hU(2), W * 0.47, L * 0.32, hU(3), W * 0.2, white, S.PLAIN);
    for (let s = 0; s < 4; s++) B(0, 0, W * (0.56 + s * 0.035), L * 0.3, hU(3) * (1 - s / 4), W * 0.04, stone2, S.PLAIN);   // grand stairs
    if (!small) { B(0, hb + hU(1.5), 0, 2.6, hU(7), 2.6, stone, S.INST); B(0, hb + hU(1.5), 0, 2.4, hU(7), 2.4, stone, S.INST, Math.PI / 4); B.dome(0, hb + hU(8.5), 0, 1.25, hU(13), white); B(0, hb + hU(21.5), 0, 0.14, hU(4), 0.14, c(0xd9a520), S.PLAIN); }
    else B.dome(0, hb + hU(1.5), 0, 0.8, hU(7), white);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { B(sx * L * 0.42, hb + hU(1), sz * W * 0.3, 0.9, hU(3.5), 0.9, stone, S.PLAIN); B.dome(sx * L * 0.42, hb + hU(4.5), sz * W * 0.3, 0.42, hU(5), white); }
  };
  MODELS.vikasa = (b, lm, all) => MODELS.vidhana(b, lm, all, true);

  MODELS.highcourt = (b, lm, all) => {
    const L = Math.min(lm.obb[0], 22), W = Math.min(lm.obb[1], 8), B = frame(b, lm, frontToward(lm, all.vidhana)), red = c(0xb24a3a), red2 = c(0x9c3f32), trim = c(0xeee4d0);
    B(0, 0, 0, L, hU(12), W * 0.55, red, S.INST); B(0, hU(12), 0, L, hU(1), W * 0.6, trim, S.PLAIN);
    B(0, 0, W * 0.2, L * 0.16, hU(16), W * 0.5, red2, S.INST); B(0, hU(16), W * 0.2, L * 0.18, hU(2.5), W * 0.54, trim, S.PLAIN);
    for (const s of [-1, 1]) { B(s * L * 0.45, 0, W * 0.12, L * 0.1, hU(14), W * 0.7, red2, S.INST); B(s * L * 0.45, hU(14), W * 0.12, L * 0.1, hU(1.5), W * 0.74, trim, S.PLAIN); }
    for (let i = -8; i <= 8; i++) if (Math.abs(i) > 1) B(i * L * 0.05, 0, W * 0.3, 0.12, hU(11), 0.12, trim, S.PLAIN);
  };

  MODELS.palace = (b, lm) => {
    const L = Math.min(lm.obb[0], 14), W = Math.min(lm.obb[1], 9), B = frame(b, lm), g = c(0x9d968a), g2 = c(0x8a8478), ivy = c(0x5c7f4a), roof = c(0x7b3b30);
    B(0, 0, 0, L * 0.9, hU(12), W * 0.7, g, S.INST); B(0, hU(12), 0, L * 0.9, hU(1), W * 0.72, g2, S.PLAIN);
    B(-L * 0.2, 0, W * 0.36, L * 0.25, hU(8), 0.1, ivy, S.LEAF); B(L * 0.25, 0, W * 0.36, L * 0.2, hU(6), 0.1, ivy, S.LEAF);
    const tower = (lx, lz, w, hm) => { B(lx, 0, lz, w, hU(hm), w, g2, S.INST); for (const [ax, az] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B(lx + ax * w * 0.36, hU(hm), lz + az * w * 0.36, w * 0.26, hU(1.6), w * 0.26, g, S.PLAIN); };
    tower(-L * 0.45, W * 0.33, 1.1, 20); tower(L * 0.45, W * 0.33, 1.1, 20); tower(-L * 0.45, -W * 0.33, 0.9, 17); tower(L * 0.45, -W * 0.33, 0.9, 17);
    tower(0, W * 0.36, 1.5, 26); B(0, 0, W * 0.46, 1.9, hU(7), 0.8, g, S.PLAIN);
    B(0, hU(13), -W * 0.1, L * 0.5, hU(2.5), W * 0.3, roof, S.PLAIN);
  };

  const ring = (B, a, bb, inner, depth, y, h, n, col, st, band) => {
    for (let i = 0; i < n; i++) {
      const t = i / n * Math.PI * 2, x = a * inner * Math.cos(t), z = bb * inner * Math.sin(t), tx = -a * Math.sin(t), tz = bb * Math.cos(t);
      const seg = 2 * Math.PI * Math.hypot(tx, tz) * inner / n * 1.08;
      B(x, y, z, seg, h, depth, band && i % 2 ? band : col, st, Math.atan2(-tz, tx));
    }
  };
  MODELS.stadium = (b, lm) => {
    const a = Math.min(lm.obb[0], 22) / 2, bb = Math.min(lm.obb[1], 20) / 2, B = frame(b, lm), con = c(0xcfc8bb), seat = c(0x3c6ea5), seat2 = c(0xb8433a), grass = c(0x4f9e48);
    B(0, 0, 0, a * 1.2, 0.05, bb * 1.2, grass, S.PLAIN); ring(B, a, bb, 0.5, a * 0.3, 0, 0.06, 20, grass, S.PLAIN);
    B(0, 0.06, 0, 0.3, 0.02, 2.2, c(0xcdb88a), S.PLAIN);                         // cricket pitch strip
    ring(B, a, bb, 0.66, a * 0.14, 0, hU(7), 30, seat, S.PLAIN, seat2); ring(B, a, bb, 0.8, a * 0.16, 0, hU(14), 34, seat2, S.PLAIN, seat);
    ring(B, a, bb, 0.94, a * 0.14, 0, hU(22), 38, con, S.INST); ring(B, a, bb, 0.9, a * 0.26, hU(22), hU(1.2), 38, c(0xe9e6df), S.PLAIN);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { B(sx * a * 0.78, 0, sz * bb * 0.78, 0.14, hU(48), 0.14, c(0x8d9096), S.PLAIN); B(sx * a * 0.78, hU(48), sz * bb * 0.78, 0.8, 0.5, 0.12, c(0xfff3c4), S.LAMP, Math.atan2(sz, -sx)); }
  };
  MODELS.athletics = (b, lm) => {
    const a = Math.min(lm.obb[0], 26) / 2, bb = Math.min(lm.obb[1], 19) / 2, B = frame(b, lm), con = c(0xcbc4b6), grass = c(0x52a04a), track = c(0xb5533c);
    B(0, 0, 0, a * 1.15, 0.05, bb * 0.7, grass, S.PLAIN);
    ring(B, a, bb, 0.56, a * 0.14, 0, 0.04, 28, track, S.PLAIN);
    ring(B, a, bb, 0.78, a * 0.16, 0, hU(8), 32, c(0xd9cfae), S.PLAIN, c(0x5f86b0)); ring(B, a, bb, 0.92, a * 0.14, 0, hU(15), 36, con, S.INST);
    B(0, hU(15), -bb * 0.86, a * 1.2, hU(1.2), bb * 0.34, c(0xe6e3dc), S.PLAIN);          // grandstand roof
  };
  MODELS.dome = (b, lm) => {
    const r = Math.min(lm.obb[0], lm.obb[1], 12) / 2, B = frame(b, lm), w = c(0xe6e3dc);
    B(0, 0, 0, r * 1.9, hU(8), r * 1.9, c(0xcfc8bb), S.INST); B(0, 0, 0, r * 1.9, hU(8), r * 1.9, c(0xcfc8bb), S.INST, Math.PI / 4); B.dome(0, hU(8), 0, r * 0.98, hU(12), w);
  };
  MODELS.ubcity = (b, lm) => {
    const L = Math.min(lm.obb[0], 24), W = Math.min(lm.obb[1], 16), B = frame(b, lm), beige = c(0xd6c8aa), gl = c(0xbfc9c4), dark = c(0xa89c84);
    B(0, 0, 0, L * 0.82, hU(14), W * 0.7, beige, S.SHOP);
    const tw = (lx, lz, w, d, hm) => { B(lx, hU(14), lz, w, hU(hm - 14), d, gl, S.GLASS); B(lx, hU(hm), lz, w * 0.7, hU(4), d * 0.7, dark, S.PLAIN); };
    B(-L * 0.24, hU(14), 0, 2.6, hU(64), 2.6, beige, S.GLASS); B(-L * 0.24, hU(78), 0, 2.0, hU(22), 2.0, beige, S.GLASS); B(-L * 0.24, hU(100), 0, 1.3, hU(14), 1.3, beige, S.GLASS);
    B(-L * 0.24, hU(114), 0, 0.6, hU(6), 0.6, dark, S.PLAIN); B(-L * 0.24, hU(120), 0, 0.16, hU(8), 0.16, c(0xdddddd), S.PLAIN);     // UB Tower with stepped crown and mast (~123 m)
    tw(L * 0.2, W * 0.16, 2.4, 2.0, 74); tw(L * 0.2, -W * 0.18, 2.4, 2.0, 70); tw(-L * 0.02, W * 0.22, 2.0, 1.8, 60);
  };
  MODELS.glasshouse = (b, lm) => {
    const B = frame(b, lm), g = c(0xcfe4e2), f = c(0xf2f2ee);
    B(0, 0, 0, 7.2, hU(8), 2.2, g, S.GLASS); B(0, 0, 0, 2.2, hU(8), 5.2, g, S.GLASS); B(0, hU(8), 0, 7.2, hU(1.5), 1.5, f, S.PLAIN); B(0, hU(8), 0, 1.5, hU(1.5), 5.2, f, S.PLAIN);
    B(0, hU(8), 0, 2.6, hU(4), 2.6, g, S.GLASS); B.dome(0, hU(12), 0, 1.2, hU(4), f);
  };
  MODELS.temple = (b, lm) => {
    const L = Math.min(lm.obb[0], 16), W = Math.min(lm.obb[1], 10), B = frame(b, lm), w = c(0xf2efe8), gold = c(0xd9a520), gl = c(0xb9d2dc);
    B(0, 0, 0, L, hU(10), W * 0.75, w, S.INST); B(L * 0.22, hU(10), 0, L * 0.4, hU(7), W * 0.5, gl, S.GLASS);
    for (const fx of [-0.36, -0.14, 0.08]) { const k = [1.7, 1.4, 1.1, 0.8, 0.5]; k.forEach((s, i) => B(fx * L, hU(10) + i * hU(4), 0, s, hU(4), s, w, S.PLAIN)); B(fx * L, hU(30), 0, 0.2, hU(3), 0.2, gold, S.PLAIN); }
  };
  MODELS.tower = (b, lm) => {
    const s = Math.max(2.4, Math.min(lm.obb[0], lm.obb[1], 5) * 0.8), B = frame(b, lm), gl = c(0x8fb0c8);
    B(0, 0, 0, Math.min(lm.obb[0], 8), hU(14), Math.min(lm.obb[1], 6), c(0xcfd3d6), S.SHOP);
    B(0, hU(14), 0, s, hU(96), s, gl, S.GLASS); B(0, hU(110), 0, s * 0.8, hU(14), s * 0.8, gl, S.GLASS); B(0, hU(124), 0, s * 0.4, hU(4), s * 0.4, c(0x9aa0a6), S.PLAIN);
  };
  MODELS.townhall = (b, lm) => {
    const L = Math.min(lm.obb[0], 8), W = Math.min(lm.obb[1], 5), B = frame(b, lm), w = c(0xece6d8);
    B(0, 0, 0, L, hU(11), W * 0.8, w, S.INST); B(0, hU(11), 0, L * 1.02, hU(1.2), W * 0.84, c(0xddd5c2), S.PLAIN);
    for (const s of [-1, 1]) for (let i = -3; i <= 3; i++) B(i * L * 0.12, 0, s * W * 0.46, 0.14, hU(10), 0.14, w, S.PLAIN);
    B(0, hU(12.2), 0, L * 0.5, hU(2), W * 0.84, w, S.PLAIN);
  };
  MODELS.church = (b, lm) => {
    const L = Math.min(lm.obb[0], 8), W = Math.min(lm.obb[1], 4), B = frame(b, lm), w = c(0xe8dcc0), bl = c(0x6f8fb8);
    B(0, 0, 0, L, hU(13), W * 0.6, w, S.INST); B(0, hU(13), 0, L, hU(4), W * 0.36, bl, S.PLAIN);
    B(L * 0.42, 0, 0, 1.0, hU(28), 1.0, w, S.INST); B(L * 0.42, hU(28), 0, 0.62, hU(12), 0.62, w, S.PLAIN); B(L * 0.42, hU(40), 0, 0.26, hU(9), 0.26, bl, S.PLAIN);
  };

  VB.buildLandmarks = (scene, city) => {
    const D = VB.data, b = new VB.Batch(2048), all = {}; D.landmarks.forEach(l => all[l.key] = l);
    const built = [];
    for (const lm of D.landmarks) {
      if (!lm.model || !MODELS[lm.model]) continue;
      if (!lm.obb) lm.obb = [7.5, 5.2, 0];            // node-only source (Lalbagh Glasshouse): documented size estimate, axis aligned
      MODELS[lm.model](b, lm, all); built.push(lm.key);
    }
    const m = b.mesh(city.geo, city.mat, true); m.name = 'landmarks'; m.frustumCulled = false; scene.add(m);
    VB.landmarkMesh = m; VB.landmarksBuilt = built;
    return m;
  };
})();
