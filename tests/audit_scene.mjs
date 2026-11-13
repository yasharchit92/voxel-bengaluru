// Scene-complexity breakdown + moving-camera hitch test. Usage: node tests/audit_scene.mjs <label> [query]
import { chromium } from '/home/user/.cache/vb/node_modules/playwright/index.mjs';
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [label = 'scene', query = 'norender=1&dynres=0&bloom=0'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 }, offline: true })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto('file://' + root + '/voxel-bengaluru.html?' + query);
await page.waitForFunction(() => window.VB && VB.api && VB.api.ready, null, { timeout: 300000 });
const settle = (i) => page.evaluate((i) => new Promise(res => { VB.app.goPreset(i, 0); const f0 = VB.app.frames; const t = setInterval(() => { if (VB.api.stats().pending === 0 && VB.app.frames > f0 + 20) { clearInterval(t); res(); } }, 100); }), i);
const out = { label, query, views: {}, errors: errs };
for (const i of [0, 1, 2, 8]) {
  await settle(i);
  out.views[i] = await page.evaluate(() => {
    const cam = VB.app.camera, fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const by = {}; let gpuGeo = 0; const seenG = new Set(), seenT = new Set(); let texBytes = 0; const texList = [];
    const tex = (t) => { if (!t || !t.isTexture || seenT.has(t.uuid)) return; seenT.add(t.uuid); const im = t.image || {}; const w = im.width || 0, h = im.height || 0; let b = w * h * 4; if (t.generateMipmaps && t.minFilter !== THREE.LinearFilter && t.minFilter !== THREE.NearestFilter) b *= 4 / 3; texBytes += b; texList.push([t.name || '?', w, h, +(b / 1048576).toFixed(1)]); };
    VB.app.scene.traverse(o => {
      if (!o.isMesh && !o.isLineSegments && !o.isLine) return; const g = o.geometry; if (!g) return;
      const inst = o.isInstancedMesh ? o.count : 1, tri = o.isMesh ? ((g.index ? g.index.count : g.attributes.position.count) / 3) * inst : 0;
      let vis = o.visible; for (let p = o.parent; p && vis; p = p.parent) vis = p.visible;
      let inFr = vis; if (vis && o.frustumCulled) { if (o.isInstancedMesh) { if (!o.boundingSphere) o.computeBoundingSphere(); inFr = fr.intersectsSphere(o.boundingSphere.clone().applyMatrix4(o.matrixWorld)); } else { if (!g.boundingSphere) g.computeBoundingSphere(); inFr = fr.intersectsSphere(g.boundingSphere.clone().applyMatrix4(o.matrixWorld)); } }
      const k = o.name || o.type, r = by[k] || (by[k] = { meshes: 0, drawn: 0, tris: 0, inst: 0, shadowTris: 0, bytes: 0 }); r.meshes++;
      if (inFr) { r.drawn++; r.tris += tri; r.inst += inst; } if (vis && o.castShadow) r.shadowTris += tri;
      let b = 0; if (!seenG.has(g.uuid)) { seenG.add(g.uuid); for (const a of Object.values(g.attributes)) b += a.array.byteLength; if (g.index) b += g.index.array.byteLength; }
      if (o.isInstancedMesh) { b += o.instanceMatrix.array.byteLength; if (o.instanceColor) b += o.instanceColor.array.byteLength; } r.bytes += b; gpuGeo += b;
      const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) { if (!m) continue; for (const v of Object.values(m)) tex(v); if (m.uniforms) for (const u of Object.values(m.uniforms)) tex(u.value); }
    });
    for (const r of Object.values(by)) r.bytes = +(r.bytes / 1048576).toFixed(1);
    const sm = VB.env.sun.shadow.mapSize;
    return { range: VB.app.range, by, geometryMB: +(gpuGeo / 1048576).toFixed(1), textureMB: +(texBytes / 1048576).toFixed(1), textures: texList, shadowMapMB: VB.cfg.shadows ? +(sm.x * sm.y * 4 / 1048576).toFixed(1) : 0, pixelRatio: VB.renderer.getPixelRatio(), cfg: VB.cfg };
  });
}
// ---- moving camera: pan across the city at a brisk speed, record per-frame main-thread time ----
await settle(1);
out.pan = await page.evaluate(() => new Promise(res => {
  const ts = []; let n = 0; const T = VB.app.controls.target, cam = VB.app.camera; VB.api.prof(true); let prev = 0;
  const t = setInterval(() => { const p = VB.api.prof(); if (p.n === n) return; const d = p.total - prev; prev = p.total; const k = p.n - n; n = p.n; for (let j = 0; j < k; j++) ts.push(d / k);
    T.x += 6 * k; cam.position.x += 6 * k;                                           // ~60 m per frame = 3.6 km/s at 60 fps
    if (ts.length >= 500) { clearInterval(t); ts.sort((a, b) => a - b); const q = (f) => +ts[Math.min(ts.length - 1, Math.floor(ts.length * f))].toFixed(2); const pr = VB.api.prof();
      res({ frames: ts.length, p50: q(0.5), p90: q(0.9), p99: q(0.99), max: +pr.max.toFixed(1), over16: ts.filter(x => x > 16.7).length, over33: ts.filter(x => x > 33.3).length, cityAvg: +(pr.city / pr.n).toFixed(2), pendingAtEnd: VB.api.stats().pending, sections: Object.fromEntries(['life', 'city', 'render', 'labels', 'hud'].map(k => [k, +(pr[k] / pr.n).toFixed(2)])) }); } }, 4); }));
fs.mkdirSync(root + '/docs/validation/audit', { recursive: true }); fs.writeFileSync(root + `/docs/validation/audit/${label}.json`, JSON.stringify(out, null, 1));
for (const [i, v] of Object.entries(out.views)) { console.log('view', i, 'range', Math.round(v.range), 'geoMB', v.geometryMB, 'texMB', v.textureMB, 'shadowMB', v.shadowMapMB); for (const [k, r] of Object.entries(v.by).sort((a, b) => b[1].tris - a[1].tris).slice(0, 12)) console.log('   ', k.padEnd(14), 'meshes', r.meshes, 'drawn', r.drawn, 'tris', Math.round(r.tris), 'inst', r.inst, 'shadowTris', Math.round(r.shadowTris), 'MB', r.bytes); }
console.log('textures', JSON.stringify(out.views[1].textures)); console.log('pan', JSON.stringify(out.pan)); console.log('errors', errs.slice(0, 3)); await browser.close();
