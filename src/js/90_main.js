/* Voxel Bengaluru — application bootstrap, render loop, camera modes, quality management, test API. */
'use strict';
(() => {
  // Pixel budget: the device pixel ratio is honoured up to 1.5; multisampling is 4x at ratio <= 1.25 and 2x above it
  // (a 1.5x supersampled image needs less MSAA, and 4x MSAA on a 2880 x 1620 half-float target costs ~450 MB of VRAM).
  const DPR = window.devicePixelRatio || 1, PR_N = Math.min(DPR, 1.5);
  const QUALITY = {
    normal: { name: 'normal', pr: PR_N, shadows: true, shadowSize: 2048, lodRadius: 380, lodCut: 1300, detailDist: 170, coarseDist: 3000, lifeCut: 1500, vehicles: 3500, peds: 900, aniso: 8, bloom: true, msaa: PR_N > 1.25 ? 2 : 4 },
    low: { name: 'low', pr: Math.min(DPR, 1), shadows: false, shadowSize: 1024, lodRadius: 230, lodCut: 800, detailDist: 110, coarseDist: 1800, lifeCut: 900, vehicles: 1200, peds: 300, aniso: 2, bloom: false, msaa: 2 },
  };
  const q0 = VB.query.get('quality') === 'low' ? 'low' : 'normal';
  VB.cfg = Object.assign({ maxVehicles: 3500, maxPeds: 900 }, QUALITY[q0]);
  const $ = (id) => document.getElementById(id);
  const progress = (f, msg) => { $('loadbar').style.width = Math.round(f * 100) + '%'; if (msg) $('loadmsg').textContent = msg; return new Promise(r => setTimeout(r, 0)); };
  const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  if (VB.query.get('shadows') === '0') { QUALITY.normal.shadows = false; VB.cfg.shadows = false; }
  if (VB.query.get('msaa')) { QUALITY.normal.msaa = QUALITY.low.msaa = +VB.query.get('msaa'); VB.cfg.msaa = QUALITY.normal.msaa; }
  if (VB.query.get('pr')) { QUALITY.normal.pr = QUALITY.low.pr = VB.cfg.pr = +VB.query.get('pr'); }
  const app = VB.app = { mode: 'orbit', night: false, frozen: false, bloom: VB.cfg.bloom && VB.query.get('bloom') !== '0', keys: new Set(), tween: null, frames: 0, ms: 16, cpu: 0, focus: new THREE.Vector3(), range: 1000 };

  app.viewToPose = (p) => {
    const az = p.az * Math.PI / 180, el = p.el * Math.PI / 180, ty = VB.H(p.t.x, p.t.z);
    return { target: new THREE.Vector3(p.t.x, ty, p.t.z), pos: new THREE.Vector3(p.t.x + p.dist * Math.sin(az) * Math.cos(el), ty + p.dist * Math.sin(el), p.t.z - p.dist * Math.cos(az) * Math.cos(el)) };
  };
  app.flyTo = (pose, dur = 1.5) => { app.tween = { t: 0, dur, p0: app.camera.position.clone(), t0: app.controls.target.clone(), p1: pose.pos, t1: pose.target }; if (dur <= 0) app.stepTween(1); };
  app.stepTween = (dt) => {
    const w = app.tween; if (!w) return; w.t = Math.min(1, w.t + (w.dur > 0 ? dt / w.dur : 1)); const k = ease(w.t);
    app.camera.position.lerpVectors(w.p0, w.p1, k); app.controls.target.lerpVectors(w.t0, w.t1, k); app.camera.lookAt(app.controls.target);
    if (app.mode === 'fly') app.syncFlyAngles(); if (w.t >= 1) app.tween = null;
  };
  app.goPreset = (i, dur) => { const p = app.presets[i]; if (!p) return; app.preset = i; app.flyTo(app.viewToPose(p), dur === undefined ? 1.6 : dur); };
  app.setView = (x, z, dist, az, el, dur = 0) => app.flyTo(app.viewToPose({ t: { x, z }, dist, az, el }), dur);
  app.panTo = (x, z) => { const d = app.camera.position.clone().sub(app.controls.target); const t = new THREE.Vector3(x, VB.H(x, z), z); app.flyTo({ target: t, pos: t.clone().add(d) }, 1.0); };
  app.setNight = (on) => { app.night = on; VB.env.target = on ? 1 : 0; return on; };
  app.syncFlyAngles = () => { const d = new THREE.Vector3(); app.camera.getWorldDirection(d); app.yaw = Math.atan2(d.x, -d.z); app.pitch = Math.asin(Math.max(-1, Math.min(1, d.y))); };
  app.setMode = (m) => { app.mode = m; app.controls.enabled = m === 'orbit'; if (m === 'fly') app.syncFlyAngles(); else { const d = new THREE.Vector3(); app.camera.getWorldDirection(d); app.controls.target.copy(app.focus); } return m; };
  app.setQuality = (name) => {
    const hadShadows = VB.cfg.shadows; Object.assign(VB.cfg, QUALITY[name]); const r = app.renderer; r.setPixelRatio(VB.cfg.pr); r.shadowMap.enabled = VB.cfg.shadows; VB.env.sun.castShadow = VB.cfg.shadows;
    // materials only need recompiling when the shadow state changes (the rest of the preset is uniforms and counts)
    if (hadShadows !== VB.cfg.shadows) { app.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; }); VB.env.invalidateShadow(); }
    if (app.rt.samples !== VB.cfg.msaa) { app.rt.samples = VB.cfg.msaa; app.rt.dispose(); if (app.composer.renderTarget1) { app.composer.renderTarget1.samples = VB.cfg.msaa; app.composer.renderTarget1.dispose(); app.composer.renderTarget2.samples = VB.cfg.msaa; app.composer.renderTarget2.dispose(); } }
    app.bloom = VB.cfg.bloom; $('btn-bloom').classList.toggle('on', app.bloom); app.dyn.reset(); app.resize(); return name;
  };
  app.resize = () => {
    const w = innerWidth, h = innerHeight, r = app.renderer; r.setSize(w, h, false); app.camera.aspect = w / h; app.camera.updateProjectionMatrix();
    app.composer.setPixelRatio(r.getPixelRatio()); app.composer.setSize(w, h);
  };

  async function boot() {
    await progress(0.03, 'Unpacking geographic data…');
    const D = await VB.loadData(progress);
    const canvas = $('scene');
    const renderer = app.renderer = VB.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });   // AA comes from the multisampled composer target; a multisampled back buffer would only waste VRAM
    renderer.setPixelRatio(VB.cfg.pr); renderer.shadowMap.enabled = VB.cfg.shadows; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.info.autoReset = false; renderer.outputColorSpace = THREE.SRGBColorSpace;
    VB.cfg.aniso = Math.min(VB.cfg.aniso, renderer.capabilities.getMaxAnisotropy());
    const scene = app.scene = new THREE.Scene();
    const camera = app.camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 1, 40000);
    const controls = app.controls = new THREE.OrbitControls(camera, canvas);
    controls.enableDamping = true; controls.dampingFactor = 0.09; controls.screenSpacePanning = false; controls.minDistance = 14; controls.maxDistance = 11000; controls.maxPolarAngle = 1.52; controls.zoomSpeed = 1.1;
    VB.prepGraph();
    await progress(0.3, 'Baking the 10 m ground raster (3840 × 3840 cells)…');
    VB.buildGround(scene); VB.buildEnv(scene);
    await progress(0.5, 'Raising 900 city blocks (far level of detail)…');
    const city = VB.city = new VB.City(scene); city.buildFar(); city.buildCoarse();
    await progress(0.75, 'Placing landmarks, flyovers and Namma Metro…');
    VB.buildLandmarks(scene, city); VB.buildInfra(scene, city);
    await progress(0.88, 'Starting traffic…');
    VB.life = new VB.Life(scene);
    app.presets = VB.makePresets();
    const rt = app.rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: VB.cfg.msaa });
    const composer = app.composer = new THREE.EffectComposer(renderer, rt);
    composer.addPass(new THREE.RenderPass(scene, camera));
    const bloom = app.bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.22, 0.55, 0.92); composer.addPass(bloom);
    composer.addPass(new THREE.OutputPass());
    const ui = app.ui = new VB.UI(app);
    app.resize(); addEventListener('resize', app.resize);
    if (VB.query.get('ui') === '0') document.body.classList.add('noui');
    if (VB.query.get('night') === '1') { app.night = true; VB.env.target = 1; VB.env.apply(1); $('btn-night').classList.add('on'); }
    app.goPreset(0, 0);

    // ---- input: keys shared by both camera modes ----
    addEventListener('keydown', e => { app.keys.add(e.code); if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault(); });
    addEventListener('keyup', e => app.keys.delete(e.code)); addEventListener('blur', () => app.keys.clear());
    let drag = null;
    canvas.addEventListener('pointerdown', e => { if (app.mode === 'fly') { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); } app.tween = null; });
    canvas.addEventListener('pointermove', e => { if (drag && app.mode === 'fly') { app.yaw += (e.clientX - drag.x) * 0.0032; app.pitch = Math.max(-1.5, Math.min(1.5, app.pitch - (e.clientY - drag.y) * 0.0032)); drag.x = e.clientX; drag.y = e.clientY; } });
    canvas.addEventListener('pointerup', () => drag = null);
    canvas.addEventListener('wheel', e => { app.tween = null; if (app.mode === 'fly') { const d = new THREE.Vector3(); camera.getWorldDirection(d); camera.position.addScaledVector(d, -e.deltaY * 0.05 * Math.max(1, (camera.position.y - VB.H(camera.position.x, camera.position.z)) / 60)); } }, { passive: true });

    const fwd = new THREE.Vector3(), right = new THREE.Vector3(), tmp = new THREE.Vector3(), clock = new THREE.Clock(); let last = performance.now(), slow = 0, fast = 0;
    const K = app.keys, axis = (a, b, c, d) => ((K.has(a) || K.has(b)) ? 1 : 0) - ((K.has(c) || K.has(d)) ? 1 : 0);
    // ---- dynamic resolution (normal quality) -----------------------------------------------------------------
    // Frame interval is vsync-quantised, so "fast" cannot be detected by a threshold below the refresh period.
    // Policy: drop the pixel ratio after ~1 s below 45 fps; probe one step up after a quiet period while the display
    // rate is being held; if the probe makes frames slow again, revert and double the wait before the next probe.
    const dyn = app.dyn = { on: VB.query.get('dynres') !== '0', slow: 0, good: 0, wait: 6000, nextUp: 0, probe: null, best: 16.7, changes: 0,
      reset() { this.slow = this.good = 0; this.wait = 6000; this.nextUp = performance.now() + 4000; this.probe = null; },
      set(pr, now) { renderer.setPixelRatio(pr); app.resize(); this.slow = this.good = 0; this.changes++; },
      step(now) {                                                    // called every 12th frame
        if (!this.on || VB.cfg.name !== 'normal' || app.pending > 0 || app.tween) return;
        const ms = app.ms, pr = renderer.getPixelRatio(), min = Math.max(0.6, VB.cfg.pr * 0.5); if (ms < this.best) this.best = Math.max(4, ms);
        const refresh = Math.min(17.5, this.best * 1.06);            // estimated display period (the fastest sustained interval seen)
        if (this.probe && now > this.probe.t + 1500) { if (ms > Math.max(21, refresh * 1.25)) { this.set(this.probe.from, now); this.wait = Math.min(120000, this.wait * 2); } else this.wait = 6000; this.nextUp = now + this.wait; this.probe = null; return; }
        if (ms > 22) { this.good = 0; if (++this.slow >= 5 && pr > min) { this.set(Math.max(min, pr - 0.15), now); this.nextUp = now + this.wait; this.probe = null; } }
        else { this.slow = 0; if (ms <= refresh * 1.03) this.good++; else this.good = 0;
          if (!this.probe && this.good >= 10 && pr < VB.cfg.pr && now > this.nextUp && VB.prof.n && app.cpu < 9) { this.probe = { from: pr, t: now }; this.set(Math.min(VB.cfg.pr, pr + 0.15), now); } }
      } };
    // per-section main-thread timings (ms, accumulated; read through VB.api.prof())
    const P = VB.prof = { n: 0, camera: 0, life: 0, env: 0, city: 0, render: 0, labels: 0, hud: 0, total: 0, max: 0 }; let pt = 0;
    const lap = (k) => { const t = performance.now(); P[k] += t - pt; pt = t; };
    const noRender = VB.query.get('norender') === '1';
    function frame(now) {
      requestAnimationFrame(frame);
      if (app.paused) { last = now; return; }
      const tStart = pt = performance.now();
      const raw = now - last, dt = Math.min(0.1, raw / 1000); last = now; app.ms += (Math.min(raw, 250) - app.ms) * 0.08; app.frames++;
      // --- camera
      if (app.tween) app.stepTween(dt);
      const mf = axis('KeyW', 'ArrowUp', 'KeyS', 'ArrowDown'), mr = axis('KeyD', 'ArrowRight', 'KeyA', 'ArrowLeft'), mu = (K.has('KeyE') ? 1 : 0) - (K.has('KeyQ') ? 1 : 0), boost = (K.has('ShiftLeft') || K.has('ShiftRight')) ? 4 : 1;
      const gy = VB.H(camera.position.x, camera.position.z), alt = camera.position.y - gy;
      if (app.mode === 'orbit') {
        if (mf || mr) { app.tween = null; camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize(); right.set(-fwd.z, 0, fwd.x); const sp = Math.max(30, app.range * 0.7) * boost * dt; tmp.set(0, 0, 0).addScaledVector(fwd, mf * sp).addScaledVector(right, mr * sp); camera.position.add(tmp); controls.target.add(tmp); }
        const T = controls.target; T.x = Math.max(-D.HALF, Math.min(D.HALF, T.x)); T.z = Math.max(-D.HALF, Math.min(D.HALF, T.z)); T.y += (VB.H(T.x, T.z) - T.y) * 0.2;
        if (!app.tween) controls.update();
        app.focus.copy(T); app.range = camera.position.distanceTo(T);
      } else {
        fwd.set(Math.sin(app.yaw) * Math.cos(app.pitch), Math.sin(app.pitch), -Math.cos(app.yaw) * Math.cos(app.pitch)); right.set(Math.cos(app.yaw), 0, Math.sin(app.yaw));
        if (!app.tween) { const sp = Math.max(18, alt * 0.9) * boost * dt; camera.position.addScaledVector(fwd, mf * sp).addScaledVector(right, mr * sp); camera.position.y += mu * sp; tmp.copy(camera.position).add(fwd); camera.lookAt(tmp); }
        const t = fwd.y < -0.03 ? Math.min(900, Math.max(10, alt / -fwd.y)) : 260; app.focus.copy(camera.position).addScaledVector(fwd, t); app.focus.y = VB.H(app.focus.x, app.focus.z); app.range = Math.max(alt, t * 0.8);
        controls.target.copy(app.focus);
      }
      const minY = VB.H(camera.position.x, camera.position.z) + 1.2; if (camera.position.y < minY) camera.position.y = minY;
      camera.near = Math.max(0.4, Math.min(20, app.range * 0.01)); camera.far = Math.max(9000, app.range * 4 + 6000); camera.updateProjectionMatrix(); VB.env.sky.position.copy(camera.position); VB.env.sky.scale.setScalar(camera.far * 0.9 / 15000);
      lap('camera');
      // --- world
      if (!app.frozen) { VB.uniforms.uTime.value += dt; VB.life.update(dt, app.focus, app.range); }
      lap('life');
      VB.env.step(dt); scene.fog.density *= Math.max(0.22, Math.min(1, 1500 / app.range));
      VB.env.updateShadow(app.focus, app.range, city.nearCount);
      lap('env');
      app.pending = city.update(app.focus, app.range, 4, camera.position);
      lap('city');
      bloom.strength = 0.16 + 0.42 * VB.env.night; bloom.threshold = 0.95 - 0.33 * VB.env.night;
      // --- draw
      renderer.info.reset();
      bloom.enabled = app.bloom;
      if (noRender) { scene.updateMatrixWorld(); } else composer.render();
      lap('render');
      VB.env.apply(VB.env.night);         // restore un-scaled fog density for the next frame
      if (app.frames % 2 === 0) ui.updateLabels(camera, innerWidth, innerHeight);
      ui.updateCompass(camera);
      lap('labels');
      if (app.frames % 12 === 0) {
        ui.updateMinimap(camera, app.focus);
        const ll = VB.toLonLat(app.focus.x, app.focus.z), info = renderer.info;
        ui.readout(`${(1000 / app.ms).toFixed(0)} fps · ${app.ms.toFixed(1)} ms · ${info.render.calls} calls · ${(info.render.triangles / 1e6).toFixed(2)} M tris\n` +
          `instances ${(city.instanceCount() / 1000).toFixed(0)}k · near chunks ${city.nearCount} · vehicles ${VB.life.vehicleCount || 0} · people ${VB.life.pedCount || 0}\n` +
          `focus ${ll[1].toFixed(4)}°N ${ll[0].toFixed(4)}°E · ${VB.elevM(app.focus.x, app.focus.z).toFixed(0)} m asl · range ${(app.range / 100).toFixed(1)} km · px ratio ${renderer.getPixelRatio().toFixed(2)}`);
        app.dyn.step(now);
      }
      lap('hud'); const tt = performance.now() - tStart; P.total += tt; P.n++; if (tt > P.max) P.max = tt; app.cpu += (tt - app.cpu) * 0.1;
    }
    await progress(1, 'Ready');
    $('loading').style.display = 'none';
    requestAnimationFrame(frame);

    // ---- test / automation API ----
    VB.api = {
      ready: true,
      stats: () => ({ fps: 1000 / app.ms, ms: app.ms, cpuMs: app.cpu, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
        instances: city.instanceCount(), farInstances: city.farInstances, coarseInstances: city.coarseInstances, frames: app.frames, nearChunks: city.nearCount, pending: app.pending, vehicles: VB.life.vehicleCount || 0, peds: VB.life.pedCount || 0, signs: VB.life.signCount || 0,
        pixelRatio: renderer.getPixelRatio(), heap: performance.memory ? performance.memory.usedJSHeapSize : null, range: app.range, heading: ui.heading, metroKm: VB.metroKm, flyoverKm: VB.infra.flyoverKm, landmarks: VB.landmarksBuilt }),
      prof: (reset) => { const o = Object.assign({}, P); if (reset) for (const k in P) P[k] = 0; return o; },
      camera: () => ({ pos: camera.position.toArray(), target: controls.target.toArray(), mode: app.mode }),
      vehicles: () => { const L = VB.life, out = []; for (let i = 0; i < L.active; i++) if (L.edge[i] >= 0) { const e = D.edges[L.edge[i]]; out.push({ x: L.px[i], z: L.pz[i], edge: L.edge[i], dir: L.dir[i], s: L.s[i], lvl: e.lvl, cls: VB.cellAt(L.px[i], L.pz[i]), ow: e.ow, type: L.type[i] }); } return out; },
      trains: () => VB.life.trains.map((t, i) => ({ line: t.l.key, s: VB.life.tS[i], dir: VB.life.tDir[i] })),
      project: (x, z) => { const v = new THREE.Vector3(x, VB.H(x, z), z).project(camera); return [(v.x * 0.5 + 0.5) * innerWidth, (-v.y * 0.5 + 0.5) * innerHeight, v.z]; },
      hashState: () => {            // deterministic fingerprint of generated geometry (far LOD + landmarks + infrastructure)
        let h = 2166136261 >>> 0; const eat = (arr) => { const u = new Uint32Array(arr.buffer, arr.byteOffset, arr.byteLength >> 2); for (let i = 0; i < u.length; i += 7) { h ^= u[i]; h = Math.imul(h, 16777619) >>> 0; } };
        for (const c of city.chunks) if (c.far) { eat(c.far.instanceMatrix.array); eat(c.far.instanceColor.array); }
        eat(VB.landmarkMesh.instanceMatrix.array); for (const m of VB.infra.meshes) eat(m.instanceMatrix.array); return h >>> 0;
      },
      hashNear: () => { let h = 2166136261 >>> 0, n = 0; for (const c of city.chunks) if (c.near) { n++; const u = new Uint32Array(c.near.instanceMatrix.array.buffer); for (let i = 0; i < u.length; i += 5) { h ^= u[i]; h = Math.imul(h, 16777619) >>> 0; } } return [h >>> 0, n]; },
    };
  }
  window.addEventListener('error', (e) => { (VB.errors = VB.errors || []).push(String(e.message)); });
  boot().catch(e => { (VB.errors = VB.errors || []).push(String(e && e.stack || e)); $('loadmsg').textContent = 'Failed to start: ' + e; console.error(e); });
})();
