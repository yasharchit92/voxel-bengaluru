// Usage: node tests/bloom_sweep.mjs [query] [dist csv] — renders the overview at several zoom levels and reports mean brightness (detects black frames).
import { chromium } from '/home/user/.cache/vb/node_modules/playwright/index.mjs';
import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [query = '', dists = '600,1200,2000,2800,3200,4000,5000,6500,8000,11000', outDir = '/home/user/.cache/vb/sw'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const ctx = await browser.newContext({ viewport: { width: +(process.env.W || 320), height: +(process.env.H || 180) }, offline: true });
const page = await ctx.newPage(); const errs = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
await page.goto('file://' + root + '/voxel-bengaluru.html?ui=0&' + query);
await page.waitForFunction(() => window.VB && VB.api && VB.api.ready, null, { timeout: 240000 });
for (const d of dists.split(',')) {
  const f0 = await page.evaluate((d) => { const p = VB.app.presets[0]; VB.app.setView(0, 0, +d, +(new URLSearchParams(location.search).get('az') || 200), +(new URLSearchParams(location.search).get('el') || 35), 0); return VB.app.frames; }, d);
  await page.waitForFunction((n) => VB.app.frames >= n, f0 + 4, { timeout: 600000, polling: 300 });
  await page.screenshot({ path: `${outDir}/d${d}.png`, timeout: 500000 });
  console.log(d, JSON.stringify(await page.evaluate(() => { const s = VB.api.stats(); return { pr: s.pixelRatio, bloom: VB.app.bloom, range: Math.round(VB.app.range), far: VB.app.camera.far, near: VB.app.camera.near }; })));
}
console.log('errors', JSON.stringify(errs.slice(0, 8)));
await browser.close();
