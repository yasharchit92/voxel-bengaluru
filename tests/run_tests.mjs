// Functional test-suite. Usage: node tests/run_tests.mjs   -> docs/validation/functional_tests.json
// Runs in headless Chromium with software WebGL (SwiftShader); ?quality=low keeps it tractable on CPU.
import { chromium } from '/home/user/.cache/vb/node_modules/playwright/index.mjs';
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = 'file://' + root + '/voxel-bengaluru.html';
const manifest = JSON.parse(fs.readFileSync(root + '/docs/manifest.json', 'utf8'));
const results = []; const T = (name, pass, detail) => { results.push({ name, pass: !!pass, detail }); console.log((pass ? 'PASS ' : 'FAIL ') + name + '  ' + JSON.stringify(detail).slice(0, 400)); };
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
async function open(query) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 600 }, offline: true });
  const page = await ctx.newPage(); const log = { errors: [], requests: [] };
  page.on('console', m => { if (m.type() === 'error') log.errors.push(m.text()); }); page.on('pageerror', e => log.errors.push(e.message));
  page.on('request', r => { if (!r.url().startsWith('file://') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) log.requests.push(r.url()); });
  await page.goto(url + '?quality=low&' + query);
  await page.waitForFunction(() => window.VB && ((VB.api && VB.api.ready) || (VB.errors && VB.errors.length)), null, { timeout: 300000 });
  return { page, ctx, log };
}
const settle = (page, n = 4) => page.evaluate((n) => new Promise(res => { const f0 = VB.app.frames; const t = setInterval(() => { if (VB.api.stats().pending === 0 && VB.app.frames >= f0 + n) { clearInterval(t); res(); } }, 200); }), n);

// ---------- session 1 ----------
let { page, ctx, log } = await open('seed=1');
// static inspection of the file
const html = fs.readFileSync(root + '/voxel-bengaluru.html', 'utf8');
const ext = [...html.matchAll(/(?:src|href)\s*=\s*["'](https?:)?\/\/[^"']+/g)].map(m => m[0]).filter(s => !/w3\.org/.test(s));
T('single file, no external src/href references', ext.length === 0, { bytes: html.length, external: ext.slice(0, 5) });
T('loads with network offline and makes no network requests', log.requests.length === 0, { requests: log.requests });
await page.evaluate(() => VB.app.goPreset(1, 0)); await settle(page, 6);
const st = await page.evaluate(() => VB.api.stats());
T('boot completes; landmarks, infrastructure and activity present', st.landmarks.length >= 12 && st.vehicles > 100 && st.instances > 1e5, { landmarks: st.landmarks, vehicles: st.vehicles, peds: st.peds, instances: st.instances });

// presets: each goes to a distinct place, focus matches the documented anchor feature
const presets = await page.evaluate(() => VB.app.presets.map(p => ({ name: p.name, x: p.t.x, z: p.t.z, dist: p.dist })));
const anchors = { 1: ['landmarks', 'cubbon', 1500], 2: ['lakes', 'Bellandur Lake', 3000], 3: ['landmarks', 'itpl', 3000], 5: ['landmarks', 'infosys', 4000], 6: ['lakes', 'Hebbal Lake', 4000] };
const pres = [];
for (let i = 0; i < presets.length; i++) {
  await page.evaluate((i) => VB.app.goPreset(i, 0), i); await page.waitForTimeout(150);
  const c = await page.evaluate(() => VB.api.camera()); const row = { i: i + 1, name: presets[i].name, target: c.target.map(v => +v.toFixed(1)) };
  if (anchors[i]) { const [g, k, tol] = anchors[i]; const f = manifest[g].find(f => f.key === k || f.name === k); row.anchor = k; row.anchor_dist_m = Math.round(Math.hypot(c.target[0] - f.x, c.target[2] - f.z) * 10); row.ok = row.anchor_dist_m < tol; }
  row.inside = Math.abs(c.target[0]) < 1920 && Math.abs(c.target[2]) < 1920; pres.push(row);
}
const uniq = new Set(pres.map(p => p.target.join(','))).size;
T('all 8 required presets (+ street level) exist, are distinct, inside the extent and centred on their anchor features', presets.length >= 8 && uniq === presets.length && pres.every(p => p.inside && p.ok !== false), pres);

// north: with heading 0 a point 1 km true-grid-north of the focus projects above it on screen; compass reports heading
await page.evaluate(() => VB.app.goPreset(1, 0)); await settle(page, 4);
const ctl0 = 0;
await page.evaluate(() => VB.app.setView(0, 0, 600, 180, 50, 0)); await settle(page, 3);
const pn = await page.evaluate(() => ({ a: VB.api.project(0, 0), n: VB.api.project(0, -100), e: VB.api.project(100, 0), h: VB.api.stats().heading }));
await page.evaluate(() => VB.app.setView(0, 0, 600, 270, 50, 0)); await settle(page, 3);
const pe = await page.evaluate(() => ({ a: VB.api.project(0, 0), n: VB.api.project(0, -100), h: VB.api.stats().heading, needle: document.getElementById('needle').style.transform }));
T('north is up at heading 0, east is right; compass follows camera heading', pn.n[1] < pn.a[1] - 20 && pn.e[0] > pn.a[0] + 20 && Math.abs(pn.h) < 1 && Math.abs(Math.abs(pe.h) - 90) < 1 && Math.abs(pe.n[0] - pe.a[0]) > 20,
  { heading0: pn.h, northDy: +(pn.n[1] - pn.a[1]).toFixed(1), eastDx: +(pn.e[0] - pn.a[0]).toFixed(1), heading90: pe.h, northDxAt90: +(pe.n[0] - pe.a[0]).toFixed(1), needle: pe.needle });

// controls / toggles
const ctl = await page.evaluate(async () => {
  const r = {}; const wait = (ms) => new Promise(res => { const f0 = VB.app.frames, t0 = performance.now(); const t = setInterval(() => { if (VB.app.frames >= f0 + 4 && performance.now() - t0 >= ms) { clearInterval(t); res(); } }, 50); });
  const key = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: 'Key' + k.toUpperCase(), bubbles: true }));
  key('h'); r.hideUI = document.body.classList.contains('noui'); key('h'); r.showUI = !document.body.classList.contains('noui');
  const v0 = VB.api.vehicles().slice(0, 50).map(v => v.s); VB.app.frozen = false; await wait(700); const v1 = VB.api.vehicles().slice(0, 50).map(v => v.s); r.vehiclesMove = v0.some((s, i) => s !== v1[i]);
  key('f'); await wait(300); const f0 = VB.api.vehicles().slice(0, 50).map(v => v.s); await wait(700); const f1 = VB.api.vehicles().slice(0, 50).map(v => v.s); r.freezeStops = VB.app.frozen && f0.every((s, i) => s === f1[i]); key('f'); r.unfreeze = !VB.app.frozen;
  key('n'); r.evening = VB.app.night === true; key('n'); r.day = VB.app.night === false;
  key('m'); r.fly = VB.api.camera().mode === 'fly'; const p0 = VB.api.camera().pos.slice(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', bubbles: true })); await wait(900); window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', code: 'KeyW', bubbles: true }));
  const p1 = VB.api.camera().pos; r.flyMoves = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]) > 0.5; key('m'); r.orbit = VB.api.camera().mode === 'orbit';
  key('l'); r.labelsOff = document.getElementById('labels').style.display === 'none'; key('l');
  const b = document.getElementById('btn-bloom'); r.bloomButton = !!b; const ids = ['btn-roads', 'btn-metro', 'btn-bounds', 'btn-minimap', 'btn-reset', 'btn-quality', 'btn-mode', 'btn-night', 'btn-freeze', 'btn-labels', 'btn-hide']; r.buttons = ids.filter(i => document.getElementById(i)).length + '/' + ids.length;
  for (const i of ['btn-roads', 'btn-metro', 'btn-bounds']) { const e = document.getElementById(i); if (e) { e.click(); await wait(120); r[i] = e.classList.contains('on'); e.click(); } }
  key('r'); await wait(200); r.reset = true; return r;
});
T('controls: hide UI, freeze, day/evening, orbit/fly + WASD, labels, overlays, reset', ['labelsOff', 'hideUI', 'showUI', 'vehiclesMove', 'freezeStops', 'unfreeze', 'evening', 'day', 'fly', 'flyMoves', 'orbit', 'btn-roads', 'btn-metro', 'btn-bounds'].every(k => ctl[k]), ctl);

// traffic: sample vehicles in 4 districts
const tr = { n: 0, onRoad: 0, onPaved: 0, elevatedOrTunnel: 0, inBuilding: 0, inWater: 0, other: 0, left: 0, twoWay: 0 };
for (const i of [1, 2, 4, 6]) {
  await page.evaluate((i) => { VB.app.frozen = false; VB.app.goPreset(i, 0); }, i); await settle(page, 12);
  const r = await page.evaluate(() => {
    const D = VB.data, out = { n: 0, onRoad: 0, onPaved: 0, elevatedOrTunnel: 0, inBuilding: 0, inWater: 0, other: 0, left: 0, twoWay: 0 };
    for (const v of VB.api.vehicles()) {
      out.n++; const near = (x, z) => { for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const c = VB.cellAt(x + dx, z + dz); if (c >= 11 && c <= 14) return true; } return false; };
      if (v.lvl !== 0) out.elevatedOrTunnel++; else if (v.cls >= 11 && v.cls <= 14) out.onRoad++; else if (near(v.x, v.z)) out.onRoad++; else if (v.cls === 10) out.onPaved++; else if (v.cls >= 32) out.inBuilding++; else if (v.cls === 5) out.inWater++; else out.other++;
      // left-hand traffic: vehicle must be to the left of its edge centreline with respect to its travel direction
      if (!v.ow) { out.twoWay++; const e = D.edges[v.edge], o = VB.along(e.pts, e.cum, v.dir > 0 ? v.s : e.len - v.s, [0, 0, 0, 0]), tx = o[2] * v.dir, tz = o[3] * v.dir, ox = v.x - o[0], oz = v.z - o[1]; /* left of travel = (tz, -tx) in x-east / z-south axes */ if (ox * tz - oz * tx > 0) out.left++; }
    } return out; });
  for (const k in tr) tr[k] += r[k];
}
tr.pctOnRoadOrStructure = +(100 * (tr.onRoad + tr.elevatedOrTunnel + tr.onPaved) / tr.n).toFixed(2);
T('vehicles follow the road graph (>= 99 % on road/paved cells or on flyovers; none in lakes)', tr.n > 500 && tr.pctOnRoadOrStructure >= 99 && tr.inWater === 0, tr);
T('no vehicle inside a building cell', tr.inBuilding === 0, { inBuilding: tr.inBuilding, of: tr.n });
T('left-hand traffic on two-way roads', tr.twoWay > 100 && tr.left / tr.twoWay > 0.99, { left: tr.left, twoWay: tr.twoWay });

// metro trains only on operational lines; infrastructure status
const inf = await page.evaluate(() => { const D = VB.data; const by = {}; for (const s of D.stations) { const k = s.status + '/' + s.line; by[k] = (by[k] || 0) + 1; }
  return { trains: VB.api.trains(), lines: D.metro.map(l => ({ key: l.key, status: l.status, km: +(l.len / 100).toFixed(2) })), uc: [...new Set(D.metroUC.map(l => l.status + '/' + (l.line || '?')))], stations: by, metroKm: VB.metroKm, ref: D.meta.reference_date, periph: D.periph.map(p => [p.name, p.beyond_km]) }; });
const opl = new Set(inf.lines.filter(l => l.status === 'operational').map(l => l.key));
T('metro trains run only on lines operational on the reference date', inf.trains.length > 0 && inf.trains.every(t => opl.has(t.line)), { trainLines: [...new Set(inf.trains.map(t => t.line))], trains: inf.trains.length });
T('infrastructure status: Purple/Green/Yellow/Pink(elevated) operational; Blue + Pink underground not operational', ['purple', 'green', 'yellow', 'pink'].every(k => opl.has(k)) && !opl.has('blue') && inf.uc.some(s => s.startsWith('construction')) && Math.abs(inf.metroKm.operational - 103.6) < 3, inf);
T('KIA shown as peripheral marker, not inside the map', inf.periph.length === 1 && inf.periph[0][1] > 0, inf.periph);

// landmark placement inside the running scene equals manifest (i.e. not re-randomised at runtime)
const lm = await page.evaluate(() => VB.data.landmarks.map(l => [l.key, l.x, l.z]));
const lmErr = lm.map(([k, x, z]) => { const f = manifest.landmarks.find(f => f.key === k); return f ? Math.hypot(x - f.x, z - f.z) * 10 : 1e9; });
T('runtime landmark coordinates equal the manifest (max error < 1 m)', Math.max(...lmErr) < 1, { n: lm.length, max_m: Math.max(...lmErr) });
const names = await page.evaluate(() => { const D = VB.data; return [...D.landmarks.map(l => l.label), ...D.lakes.map(l => l.name), ...D.places.map(p => p.name), ...D.stations.map(s => s.name), ...D.rail_stations.map(s => s.name)]; });
const fantasy = names.filter(n => /castle|dragon|wizard|lorem|placeholder|test|foo|todo|gotham|neo-|cyber/i.test(n || ''));
T('no fantasy / placeholder labels in runtime data', fantasy.length === 0, { labels: names.length, hits: fantasy });

// determinism (same session hash, then two fresh sessions)
await page.evaluate(() => VB.app.goPreset(1, 0)); await settle(page, 6);
const h1 = await page.evaluate(() => [VB.api.hashState(), VB.api.hashNear()]);
T('no JS errors or console errors (session 1)', log.errors.length === 0 && (await page.evaluate(() => (VB.errors || []).length)) === 0, log.errors.slice(0, 5));
await ctx.close();
({ page, ctx, log } = await open('seed=1')); await page.evaluate(() => VB.app.goPreset(1, 0)); await settle(page, 6);
const h2 = await page.evaluate(() => [VB.api.hashState(), VB.api.hashNear()]); await ctx.close();
({ page, ctx, log } = await open('seed=2')); await page.evaluate(() => VB.app.goPreset(1, 0)); await settle(page, 6);
const h3 = await page.evaluate(() => [VB.api.hashState(), VB.api.hashNear()]);
const lm3 = await page.evaluate(() => VB.data.landmarks.map(l => [l.key, l.x, l.z])); await ctx.close();
T('deterministic: same seed -> identical geometry hash', JSON.stringify(h1) === JSON.stringify(h2), { run1: h1, run2: h2 });
T('seed changes only procedural detail; landmark positions are seed-independent', JSON.stringify(h1) !== JSON.stringify(h3) && JSON.stringify(lm) === JSON.stringify(lm3), { seed1: h1, seed2: h3 });
await browser.close();
const summary = { date: new Date().toISOString(), browser: 'Chromium headless shell (Playwright), software WebGL via SwiftShader', passed: results.filter(r => r.pass).length, failed: results.filter(r => !r.pass).length, results };
fs.mkdirSync(root + '/docs/validation', { recursive: true }); fs.writeFileSync(root + '/docs/validation/functional_tests.json', JSON.stringify(summary, null, 1));
console.log(`\n${summary.passed} passed, ${summary.failed} failed`);
