/* Voxel Bengaluru — HUD, camera presets, labels, compass, minimap. */
'use strict';
(() => {
  const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const $ = (id) => document.getElementById(id);

  // Camera presets are derived from the verified map geometry (OSM-located features), not hand-typed coordinates.
  VB.makePresets = () => {
    const D = VB.data, lm = {}, pl = {}, lk = {}; D.landmarks.forEach(l => lm[l.key] = l); D.places.forEach(p => pl[p.name] = p); D.lakes.forEach(l => lk[l.name] = l);
    const mid = (...a) => { a = a.filter(Boolean); return { x: a.reduce((s, p) => s + p.x, 0) / a.length, z: a.reduce((s, p) => s + p.z, 0) / a.length }; };
    const mg = D.corridors.find(c => c.key === 'mg');
    return [
      { name: 'Entire Bengaluru', t: { x: 0, z: 0 }, dist: 6100, az: 180, el: 63 },
      { name: 'Central · Cubbon Park & civic core', t: mid(lm.vidhana, lm.cubbon, lm.chinnaswamy), dist: 330, az: 205, el: 36 },
      { name: 'Bellandur Lake & Outer Ring Road', t: mid(lk['Bellandur Lake']), dist: 780, az: 188, el: 42 },
      { name: 'Whitefield tech corridor', t: mid(lm.itpl, pl['Whitefield']), dist: 600, az: 200, el: 37 },
      { name: 'Koramangala & HSR Layout', t: mid(pl['Koramangala'], pl['HSR Layout']), dist: 720, az: 185, el: 44 },
      { name: 'Electronic City & Hosur Road', t: mid(lm.infosys, pl['Electronic City']), dist: 640, az: 168, el: 38 },
      { name: 'Hebbal & the north', t: mid(lk['Hebbal Lake'], lm.manyata), dist: 760, az: 180, el: 40 },
      { name: 'West · Rajajinagar – Vijayanagar', t: mid(pl['Rajajinagar'], pl['Vijayanagar'], pl['Malleshwaram']), dist: 820, az: 160, el: 44 },
      { name: 'Street level · MG Road', t: mg && mg.labels.length ? { x: mg.labels[0][0], z: mg.labels[0][1] } : mid(lm.chinnaswamy), dist: 36, az: 200, el: 9, extra: true },
    ];
  };

  VB.UI = class {
    constructor(app) {
      this.app = app; const D = VB.data; this.labels = []; this.layer = $('labels'); this.showLabels = true; this.showCorp = false;
      // --- preset buttons
      const pb = $('presets'); app.presets.forEach((p, i) => { const b = document.createElement('button'); b.textContent = (i + 1) + ' · ' + p.name; b.onclick = () => app.goPreset(i); pb.appendChild(b); });
      // --- toggles
      const tg = $('toggles'), mk = (id, text, fn, on) => { const b = document.createElement('button'); b.id = 'btn-' + id; b.textContent = text; if (on) b.classList.add('on'); b.onclick = () => { const r = fn(); if (typeof r === 'boolean') b.classList.toggle('on', r); if (typeof r === 'string') b.textContent = r; }; tg.appendChild(b); return b; };
      mk('mode', 'Mode: Orbit', () => 'Mode: ' + (app.setMode(app.mode === 'orbit' ? 'fly' : 'orbit') === 'fly' ? 'Fly' : 'Orbit'));
      mk('night', 'Evening', () => app.setNight(!app.night));
      mk('freeze', 'Freeze', () => (app.frozen = !app.frozen));
      mk('bloom', 'Bloom', () => (app.bloom = !app.bloom), app.bloom);
      mk('labels', 'Labels', () => { this.showLabels = !this.showLabels; this.layer.style.display = this.showLabels ? '' : 'none'; return this.showLabels; }, true);
      mk('roads', 'Roads overlay', () => { this.ovR = !this.ovR; VB.overlays.set('roads', this.ovR); return this.ovR; });
      mk('metro', 'Metro & rail overlay', () => { this.ovM = !this.ovM; VB.overlays.set('metro', this.ovM); return this.ovM; });
      mk('bounds', 'City corporations', () => { this.showCorp = !this.showCorp; VB.overlays.set('bounds', this.showCorp); return this.showCorp; });
      mk('minimap', 'Minimap', () => !document.body.classList.toggle('nomap'), true);
      mk('quality', 'Quality: ' + VB.cfg.name, () => 'Quality: ' + app.setQuality(VB.cfg.name === 'normal' ? 'low' : 'normal'));
      mk('reset', 'Reset camera', () => { app.goPreset(0); });
      mk('hide', 'Hide UI (H)', () => { document.body.classList.add('noui'); });
      // --- legend (Metro status on the reference date)
      const lg = $('legend'); lg.innerHTML = D.metro.map(l => `<span><i style="background:${l.colour}"></i>${esc(l.name.replace(' (elevated section)', ''))} · in service</span>`).join('') +
        '<span><i style="background:repeating-linear-gradient(90deg,#b9b4aa 0 4px,#e0a030 4px 8px)"></i>under construction on 13 Nov 2026 (Blue Line, Pink Line underground section)</span><span><i style="background:repeating-linear-gradient(90deg,#bbb 0 3px,transparent 3px 6px)"></i>proposed (overlay only)</span>';
      this.buildLabels(); this.buildMinimap();
      addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT') return; const k = e.key.toLowerCase();
        if (k === 'h') document.body.classList.toggle('noui'); else if (k === 'f') $('btn-freeze').click(); else if (k === 'n') $('btn-night').click(); else if (k === 'l') $('btn-labels').click();
        else if (k === 'm') $('btn-mode').click(); else if (k === 'b') $('btn-bloom').click(); else if (k === 'r') app.goPreset(0); else if (k >= '1' && k <= '9') app.goPreset(+k - 1);
      });
    }
    add(x, z, lift, html, cls, maxR, pri, minR = 0, group = null) {
      const el = document.createElement('div'); el.className = 'lb ' + cls; el.innerHTML = html; el.style.display = 'none'; this.layer.appendChild(el);
      this.labels.push({ x, y: VB.H(x, z) + lift, z, el, maxR, minR, pri, w: 0, shown: false, group });
    }
    buildLabels() {
      const D = VB.data, kn = (o) => o.kn ? `<i lang="kn">${esc(o.kn)}</i>` : '';
      for (const p of D.places) this.add(p.x, p.z, 6, esc(p.name.toUpperCase()), 'place' + (p.tier === 2 ? ' t2' : ''), p.tier === 1 ? 9000 : 2300, p.tier === 1 ? 5 : 3, 140);
      const tall = { ubcity: 22, wtc: 22, vidhana: 9, chinnaswamy: 9 };
      for (const l of D.landmarks) this.add(l.x, l.z, tall[l.key] || (l.model ? 6 : 4), esc(l.label) + kn(l), 'landmark', ['park', 'campus', 'airfield', 'tech'].includes(l.kind) ? 2600 : 1500, 8);
      for (const l of D.lakes) this.add(l.x, l.z, 1.5, esc(l.name) + kn(l), 'lake', l.area_ha >= 30 ? 4200 : 1300, l.area_ha >= 30 ? 6 : 2);
      const lmNames = new Set(D.landmarks.map(l => l.label));
      for (const p of D.parks) if (!/Cubbon|Lalbagh|Palace Grounds/.test(p.name)) this.add(p.x, p.z, 3, esc(p.name), 'park', 1600, 2);
      for (const c of D.corridors) for (const q of c.labels) this.add(q[0], q[1], 2.5, esc(c.name) + kn(c), 'road', 2800, 4);
      const colOf = {}; D.metro.forEach(m => colOf[m.key] = m.colour); colOf.blue = '#2f6fd0';
      for (const s of D.stations) { if (s.status === 'proposed') continue; const uc = s.status !== 'operational';
        this.add(s.x, s.z, uc ? 3 : 3.2, esc(s.name) + (uc ? ' <small>(u/c)</small>' : '') + kn(s), 'metro' + (uc ? ' uc' : ''), 520, uc ? 1 : 2); this.labels[this.labels.length - 1].el.style.borderLeftColor = colOf[s.line] || '#999'; }
      for (const s of D.rail_stations) this.add(s.x, s.z, 2.5, esc(s.name) + kn(s), 'rail', s.halt ? 700 : 1800, 3);
      for (const p of D.periph) this.add(p.x, p.z + 3, 9, `↑ ${esc(p.name)}<i>${p.beyond_km} km beyond the northern map edge</i>`, 'periph', 1e9, 9);
      for (const b of D.bounds) { let sx = 0, sz = 0; const n = b.pts.length / 2; for (let i = 0; i < n; i++) { sx += b.pts[i * 2]; sz += b.pts[i * 2 + 1]; } if (n > 60) this.add(sx / n, sz / n, 8, esc(b.name), 'corp', 1e9, 7, 0, 'corp'); }
    }
    updateLabels(camera, w, h) {
      if (!this.showLabels) return;
      // nothing to do while the camera is still: skip the projection, the sort and (above all) the DOM writes
      const me = camera.matrixWorld.elements, pe = camera.projectionMatrix.elements, key = this._lk || (this._lk = new Float64Array(20)); let same = key[18] === w && key[19] === h && key[17] === (this.showCorp ? 1 : 0);
      for (let i = 0; i < 16 && same; i++) if (key[i] !== me[i]) same = false; if (same && key[16] !== pe[0]) same = false;
      if (same) return; for (let i = 0; i < 16; i++) key[i] = me[i]; key[16] = pe[0]; key[17] = this.showCorp ? 1 : 0; key[18] = w; key[19] = h;
      const v = this._v || (this._v = new THREE.Vector3()), occ = this._occ || (this._occ = new Uint8Array(64 * 96)), cp = camera.position, cand = this._cand || (this._cand = []); occ.fill(0); cand.length = 0;
      for (const L of this.labels) {
        const ax = L.x - cp.x, ay = L.y - cp.y, az = L.z - cp.z, d = Math.sqrt(ax * ax + ay * ay + az * az); let ok = d < L.maxR && d > L.minR && (L.group !== 'corp' || this.showCorp);
        if (ok) { v.set(L.x, L.y, L.z).project(camera); ok = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.02 && Math.abs(v.y) < 1.02; if (ok) { L.sx = (v.x * 0.5 + 0.5) * w; L.sy = (-v.y * 0.5 + 0.5) * h; L.d = d; cand.push(L); } }
        if (!ok && L.shown) { L.el.style.display = 'none'; L.shown = false; }
      }
      cand.sort(this._cmp || (this._cmp = (a, b) => b.pri - a.pri || a.d - b.d));
      let shown = 0;
      for (const L of cand) {
        if (!L.w) { L.el.style.display = ''; L.w = L.el.offsetWidth || 80; L.h = L.el.offsetHeight || 18; if (!L.shown) L.el.style.display = 'none'; }
        // collision grid: 40 x 16 px cells, 64 x 96 cells (covers 2560 x 1536 px; labels beyond it are simply not de-conflicted)
        const x0 = Math.max(0, Math.min(63, Math.floor((L.sx - L.w / 2) / 40))), x1 = Math.max(0, Math.min(63, Math.floor((L.sx + L.w / 2) / 40))), y0 = Math.max(0, Math.min(95, Math.floor((L.sy - L.h) / 16))), y1 = Math.max(0, Math.min(95, Math.floor(L.sy / 16))); let free = shown < 90;
        for (let y = y0; y <= y1 && free; y++) for (let x = x0; x <= x1; x++) if (occ[x + y * 64]) { free = false; break; }
        if (free) {
          for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) occ[x + y * 64] = 1; shown++;
          const px = Math.round(L.sx * 2), py = Math.round(L.sy * 2);                 // write the style only when the label moved by half a pixel or more
          if (px !== L.px || py !== L.py) { L.px = px; L.py = py; L.el.style.transform = 'translate(-50%,-100%) translate(' + px / 2 + 'px,' + py / 2 + 'px)'; }
          if (!L.shown) { L.el.style.display = ''; L.shown = true; }
        } else if (L.shown) { L.el.style.display = 'none'; L.shown = false; }
      }
      this.labelsShown = shown;
    }
    buildMinimap() {
      const D = VB.data, cv = $('minimap'), S = 200, base = document.createElement('canvas'); base.width = base.height = S; const g = base.getContext('2d'), img = g.createImageData(S, S), C = VB.C;
      const pal = { [C.WATER]: [70, 130, 180], [C.TREE]: [70, 120, 70], [C.PARK]: [110, 165, 90], [C.GRASS]: [150, 170, 110], [C.CROP]: [175, 180, 125], [C.SCRUB]: [135, 150, 100], [C.WETLAND]: [100, 150, 120], [C.RD_ART]: [235, 150, 70], [C.RD_SEC]: [215, 185, 120] };
      const k = D.N / S;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        let built = 0, water = 0, green = 0, art = 0, tot = 0, last = 0;
        for (let dy = 2; dy < k; dy += 5) for (let dx = 2; dx < k; dx += 5) { const v = D.cls[((y * k + dy) | 0) * D.N + ((x * k + dx) | 0)]; tot++; if (v >= 32 || v === C.PAVED || v === C.RD_MINOR) built++; else if (v === C.WATER) water++; else if (v === C.TREE || v === C.PARK) green++; else if (v === C.RD_ART) art++; else last = v; }
        const c = water / tot > 0.35 ? pal[C.WATER] : art / tot > 0.2 ? pal[C.RD_ART] : built / tot > 0.45 ? [196, 180, 168] : green / tot > 0.45 ? pal[C.TREE] : (pal[last] || [172, 176, 124]);
        const o = (y * S + x) * 4; img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      const toPx = (v) => (v + D.HALF) / D.N * S;
      g.lineWidth = 1.6; for (const l of D.metro) { g.strokeStyle = l.colour; g.beginPath(); for (let i = 0; i < l.pts.length; i += 2) g[i ? 'lineTo' : 'moveTo'](toPx(l.pts[i]), toPx(l.pts[i + 1])); g.stroke(); }
      this.mm = { cv, base, g: cv.getContext('2d'), toPx, S };
      cv.addEventListener('click', (e) => { const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * D.N - D.HALF, z = (e.clientY - r.top) / r.height * D.N - D.HALF; this.app.panTo(x, z); });
    }
    updateMinimap(camera, focus) {
      const m = this.mm, g = m.g; g.drawImage(m.base, 0, 0);
      const cx = m.toPx(camera.position.x), cz = m.toPx(camera.position.z), fx = m.toPx(focus.x), fz = m.toPx(focus.z), a = Math.atan2(fz - cz, fx - cx);
      g.strokeStyle = '#fff'; g.fillStyle = 'rgba(255,255,255,.28)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(cx, cz); g.arc(cx, cz, Math.max(14, Math.hypot(fx - cx, fz - cz) * 1.4), a - 0.4, a + 0.4); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#e4572e'; g.beginPath(); g.arc(fx, fz, 3, 0, 6.3); g.fill(); g.fillStyle = '#fff'; g.font = '700 10px sans-serif'; g.fillText('N', m.S / 2 - 3, 10);
    }
    updateCompass(camera) {
      const v = this._c || (this._c = new THREE.Vector3()); camera.getWorldDirection(v);
      const heading = Math.atan2(v.x, -v.z) * 180 / Math.PI;              // camera heading, clockwise from grid north
      $('needle').style.transform = `rotate(${(-heading - VB.data.meta.convergence_deg).toFixed(1)}deg)`; this.heading = heading;
    }
    readout(txt) { $('readout').textContent = txt; }
  };
})();
