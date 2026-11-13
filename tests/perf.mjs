// Performance probe. Usage: node tests/perf.mjs [low|normal]  -> docs/validation/perf_<quality>.json
// NOTE: in this sandbox Chromium has no GPU; WebGL runs on SwiftShader (CPU rasteriser, 2 vCPU). Wall-clock frame
// rates here are therefore NOT representative of a desktop GPU. The scene-complexity numbers (draw calls, triangles,
// instances, memory, JS main-thread time per frame) are hardware-independent.
import { chromium } from '/home/user/.cache/vb/node_modules/playwright/index.mjs';
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); const q = process.argv[2] || 'low';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 }, offline: true })).newPage();
const t0 = Date.now(); await page.goto('file://' + root + `/voxel-bengaluru.html?quality=${q}&bloom=0&dynres=0&ui=0`);
await page.waitForFunction(() => window.VB && VB.api && VB.api.ready, null, { timeout: 300000 }); const boot = Date.now() - t0;
const gl = await page.evaluate(() => { const g = VB.renderer.getContext(), e = g.getExtension('WEBGL_debug_renderer_info'); return { renderer: e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER), ua: navigator.userAgent, cores: navigator.hardwareConcurrency }; });
const rows = [];
for (const i of [0, 1, 2, 3, 5, 6, 8]) {
  const r = await page.evaluate((i) => new Promise(res => {
    VB.app.frozen = false; VB.app.goPreset(i, 0); const t = setInterval(() => { if (VB.api.stats().pending !== 0) return; clearInterval(t);
      // measure: JS main-thread time spent inside the frame callback, and wall time, over 20 frames
      const f0 = VB.app.frames, w0 = performance.now(); const js = []; let last = VB.app.frames;
      const t2 = setInterval(() => { const s = VB.api.stats(); if (VB.app.frames !== last) { last = VB.app.frames; js.push(s.cpuMs); } if (VB.app.frames >= f0 + 20) { clearInterval(t2); const w = performance.now() - w0; js.sort((a, b) => a - b);
        res({ preset: VB.app.presets[i].name, frames: VB.app.frames - f0, wall_ms_per_frame: +(w / (VB.app.frames - f0)).toFixed(1), js_main_thread_ms_per_frame: +js[js.length >> 1].toFixed(2), drawCalls: s.calls, triangles: s.triangles, instances: s.instances, nearChunks: s.nearChunks, vehicles: s.vehicles, peds: s.peds, geometries: s.geometries, textures: s.textures, heapMB: s.heap ? +(s.heap / 1048576).toFixed(0) : null }); } }, 20); }, 250); }), i);
  rows.push(r); console.log(JSON.stringify(r));
}
const out = { date: new Date().toISOString(), quality: q, viewport: '1920x1080', pixelRatio: await page.evaluate(() => VB.renderer.getPixelRatio()), boot_ms_to_first_interactive: boot, file_bytes: fs.statSync(root + '/voxel-bengaluru.html').size, gl, rows };
fs.writeFileSync(root + `/docs/validation/perf_${q}.json`, JSON.stringify(out, null, 1)); console.log('boot', boot, gl.renderer); await browser.close();
