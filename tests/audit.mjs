// Performance audit probe. Usage: node tests/audit.mjs <label> [query] [presets csv] [--profile]
// Measures main-thread time per frame section, GC/allocation rate and (optionally) a CPU profile.
// ?norender=1 skips GPU submission so that the software rasteriser of this sandbox does not steal the CPU:
// the remaining numbers are pure JavaScript cost and transfer to real hardware (scaled by CPU speed).
import { chromium } from '/home/user/.cache/vb/node_modules/playwright/index.mjs';
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [label = 'audit', query = 'norender=1&dynres=0', presetCsv = '0,1,2,3,5,6,8'] = process.argv.slice(2); const doProfile = process.argv.includes('--profile');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const page = await (await browser.newContext({ viewport: { width: +(process.env.W || 1920), height: +(process.env.H || 1080) }, offline: true })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const cdp = await page.context().newCDPSession(page);
const t0 = Date.now(); await page.goto('file://' + root + '/voxel-bengaluru.html?' + query);
await page.waitForFunction(() => window.VB && ((VB.api && VB.api.ready) || (VB.errors && VB.errors.length)), null, { timeout: 300000 }); const boot = Date.now() - t0;
const rows = []; const N = +(process.env.FRAMES || 240);
for (const i of presetCsv.split(',').map(Number)) {
  await page.evaluate((i) => new Promise(res => { VB.app.frozen = false; VB.app.goPreset(i, 0); const t = setInterval(() => { if (VB.api.stats().pending === 0 && VB.app.frames > 30) { clearInterval(t); res(); } }, 100); }), i);
  await page.evaluate(() => new Promise(res => { const f0 = VB.app.frames; const t = setInterval(() => { if (VB.app.frames > f0 + 40) { clearInterval(t); res(); } }, 50); }));   // warm-up (JIT, spawn)
  await cdp.send('Performance.enable'); const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  if (process.env.ALLOC) { await cdp.send('HeapProfiler.enable'); await cdp.send('HeapProfiler.startSampling', { samplingInterval: 1024, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true }); }
  if (doProfile) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
  const r = await page.evaluate((N) => new Promise(res => {
    if (window.gc) gc(); VB.api.prof(true); const h0 = performance.memory.usedJSHeapSize, w0 = performance.now(), f0 = VB.app.frames; let hPrev = h0, alloc = 0, gcs = 0;
    const t = setInterval(() => { const h = performance.memory.usedJSHeapSize; if (h >= hPrev) alloc += h - hPrev; else gcs++; hPrev = h;
      if (VB.app.frames >= f0 + N) { clearInterval(t); const p = VB.api.prof(), s = VB.api.stats(), n = p.n || 1, o = { preset: VB.app.presets[VB.app.preset].name.slice(0, 22), frames: n, wall_ms: +((performance.now() - w0) / n).toFixed(1) };
        for (const k of ['total', 'camera', 'life', 'env', 'city', 'render', 'labels', 'hud']) o[k] = +(p[k] / n).toFixed(2); o.max = +p.max.toFixed(1);
        o.allocKBperFrame = +(alloc / n / 1024).toFixed(1); o.gcDrops = gcs; Object.assign(o, { calls: s.calls, tris: s.triangles, inst: s.instances, near: s.nearChunks, veh: s.vehicles, peds: s.peds, signs: s.signs, heapMB: Math.round(s.heap / 1048576) }); res(o); } }, 16); }), N);
  const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  for (const k of ['ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'TaskDuration']) r[k + '_ms'] = +(1000 * (m1[k] - m0[k]) / r.frames).toFixed(2);
  if (process.env.ALLOC) { const { profile: hp } = await cdp.send('HeapProfiler.stopSampling'); const acc = new Map(); const walk = (n) => { const k = (n.callFrame.functionName || '(anon)') + ' @' + n.callFrame.lineNumber; acc.set(k, (acc.get(k) || 0) + n.selfSize); n.children.forEach(walk); }; walk(hp.head);
    r.alloc = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${(v / 1024 / r.frames).toFixed(1)} KB/frame ${k}`); }
  if (doProfile) {
    const { profile } = await cdp.send('Profiler.stop'); const self = new Map(); const byId = new Map(profile.nodes.map(n => [n.id, n])); const dts = profile.timeDeltas; let tot = 0;
    profile.samples.forEach((id, k) => { const n = byId.get(id), f = n.callFrame, key = (f.functionName || '(anon)') + ' @' + f.lineNumber; self.set(key, (self.get(key) || 0) + dts[k]); tot += dts[k]; });
    r.top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22).map(([k, v]) => `${(100 * v / tot).toFixed(1)}% ${k}`);
  }
  rows.push(r); const { top, alloc, ...rest } = r; console.log(JSON.stringify(rest)); if (top) console.log('   ' + top.join('\n   ')); if (alloc) console.log('   ALLOC ' + alloc.join('\n   ALLOC '));
}
fs.mkdirSync(root + '/docs/validation/audit', { recursive: true });
fs.writeFileSync(root + `/docs/validation/audit/${label}.json`, JSON.stringify({ date: new Date().toISOString(), label, query, boot_ms: boot, frames_per_view: N, cores: 2, note: 'headless Chromium, SwiftShader, 2 vCPU sandbox', errors: errs, rows }, null, 1));
console.log('boot', boot, 'errors', errs.length, errs.slice(0, 3)); await browser.close();
