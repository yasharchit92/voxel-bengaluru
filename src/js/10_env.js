/* Voxel Bengaluru — environment: baked 10 m ground raster, terrain mesh, sky, lighting, shared voxel material. */
'use strict';
(() => {
  const C = VB.C;
  VB.uniforms = { uTime: { value: 0 }, uNight: { value: 0 } };

  // sRGB ground palette per land class
  const PAL = {
    [C.BARE]: [0xb9, 0x92, 0x6e], [C.GRASS]: [0x9c, 0xad, 0x6c], [C.CROP]: [0xb3, 0xb6, 0x7c], [C.TREE]: [0x4c, 0x7b, 0x43], [C.SCRUB]: [0x8b, 0x9b, 0x63],
    [C.WATER]: [0x3f, 0x7c, 0xa3], [C.WETLAND]: [0x6c, 0x92, 0x66], [C.PARK]: [0x7d, 0xad, 0x60], [C.PAVED]: [0xc6, 0xbb, 0xa8],
    [C.RD_MINOR]: [0x95, 0x92, 0x8e], [C.RD_TERT]: [0x7e, 0x7c, 0x7b], [C.RD_SEC]: [0x70, 0x6f, 0x71], [C.RD_ART]: [0x5c, 0x5d, 0x62], [C.RAIL]: [0x6d, 0x5e, 0x52],
    [C.PITCH]: [0x6c, 0xbb, 0x5c], [C.AIR]: [0x9b, 0x9c, 0x9f], [C.CONSTR]: [0xc8, 0xa4, 0x78], 31: [0xa6, 0x9c, 0x90],
  };
  const CROP_ALT = [[0xb3, 0xb6, 0x7c], [0xc4, 0xb4, 0x82], [0xa3, 0xb4, 0x70], [0xbf, 0xa5, 0x7a]];

  VB.buildGround = (scene) => {
    const D = VB.data, N = D.N, cls = D.cls, px = new Uint8Array(N * N * 4);
    const lut = new Uint8Array(32 * 3); for (const k in PAL) { lut[k * 3] = PAL[k][0]; lut[k * 3 + 1] = PAL[k][1]; lut[k * 3 + 2] = PAL[k][2]; }
    const seed = VB.seed | 0;
    for (let r = 0, i = 0, o = 0; r < N; r++) {
      for (let c = 0; c < N; c++, i++, o += 4) {
        const v = cls[i], k = v >= 32 ? 31 : v;
        let R = lut[k * 3], G = lut[k * 3 + 1], B = lut[k * 3 + 2];
        const h = (Math.imul(i ^ seed, 2654435761) >>> 24);
        let f = 0.94 + h * (0.11 / 255), a = 128;
        if (k === C.CROP) { const p = CROP_ALT[(Math.imul(((r >> 3) * 977 + (c >> 3)) ^ seed, 2246822519) >>> 30)]; R = p[0]; G = p[1]; B = p[2]; }
        else if (k === C.WATER) { a = 0; f = 0.97 + h * (0.05 / 255); }
        else if (k === C.RD_MINOR) { a = 196; f = 0.97 + h * (0.05 / 255); }
        else if (k >= C.RD_TERT && k <= C.RD_ART) { a = 255; f = 0.97 + h * (0.05 / 255); }
        else if (k === C.TREE || k === C.PARK) f = 0.88 + h * (0.2 / 255);
        px[o] = Math.min(255, R * f); px[o + 1] = Math.min(255, G * f); px[o + 2] = Math.min(255, B * f); px[o + 3] = a;
      }
    }
    const tex = new THREE.DataTexture(px, N, N, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true; tex.anisotropy = VB.cfg.aniso; tex.needsUpdate = true;

    const n = D.ND, pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2), idx = new Uint32Array((n - 1) * (n - 1) * 6);
    for (let j = 0, p = 0, q = 0; j < n; j++) for (let i = 0; i < n; i++) {
      pos[p++] = -D.HALF + i * D.DS; pos[p++] = D.dem[j * n + i] * VB.K.TERR; pos[p++] = -D.HALF + j * D.DS;
      uv[q++] = i / (n - 1); uv[q++] = j / (n - 1);
    }
    for (let j = 0, t = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + n, c = a + 1, d = b + 1;
      idx[t++] = a; idx[t++] = b; idx[t++] = c; idx[t++] = b; idx[t++] = d; idx[t++] = c;
    }
    const g = new THREE.BufferGeometry();
    const aPos = new THREE.BufferAttribute(pos, 3), aUv = new THREE.BufferAttribute(uv, 2);
    g.setAttribute('position', aPos); g.setAttribute('uv', aUv);
    g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals();
    const aNor = g.getAttribute('normal');
    const mat = new THREE.MeshLambertMaterial({ map: tex });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = VB.uniforms.uTime; sh.uniforms.uNight = VB.uniforms.uNight;
      sh.fragmentShader = 'uniform float uTime; uniform float uNight;\n' + sh.fragmentShader
        .replace('#include <map_fragment>', `#include <map_fragment>
          float vbA = sampledDiffuseColor.a;
          float vbWater = 1.0 - smoothstep(0.08, 0.35, vbA);
          float vbRoad = smoothstep(0.6, 0.95, vbA);
          vec2 vbP = vMapUv * ${N}.0;
          float vbFade = clamp(1.0 - 0.8 * fwidth(vbP.x), 0.0, 1.0);
          float vbRip = sin(vbP.x * 2.1 + uTime * 1.3) * sin(vbP.y * 1.7 - uTime * 0.9) + 0.6 * sin((vbP.x + vbP.y) * 0.55 + uTime * 0.5);
          diffuseColor.rgb += vbWater * (0.03 * vbRip * vbFade + vec3(0.0, 0.012, 0.03) * sin(vbP.x * 0.07 + vbP.y * 0.05));
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 0.7, 1.0) + vec3(0.02, 0.03, 0.06), vbWater * uNight * 0.6);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += vbRoad * uNight * vec3(1.0, 0.66, 0.32) * 0.20;`);
    };
    // the terrain is drawn as 8 x 8 frustum-culled tiles that share one vertex buffer (each tile has its own index buffer)
    const mesh = new THREE.Group(); mesh.name = 'ground-tiles'; const GT = 8, per = Math.ceil((n - 1) / GT);
    for (let tj = 0; tj < GT; tj++) for (let ti = 0; ti < GT; ti++) {
      const i0 = ti * per, i1 = Math.min(n - 1, i0 + per), j0 = tj * per, j1 = Math.min(n - 1, j0 + per); if (i1 <= i0 || j1 <= j0) continue;
      const ix = new Uint32Array((i1 - i0) * (j1 - j0) * 6); let t = 0, lo = 1e9, hi = -1e9;
      for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) { const a = j * n + i, b = a + n, c = a + 1, d = b + 1; ix[t++] = a; ix[t++] = b; ix[t++] = c; ix[t++] = b; ix[t++] = d; ix[t++] = c; }
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const y = pos[(j * n + i) * 3 + 1]; if (y < lo) lo = y; if (y > hi) hi = y; }
      const tg = new THREE.BufferGeometry(); tg.setAttribute('position', aPos); tg.setAttribute('uv', aUv); tg.setAttribute('normal', aNor); tg.setIndex(new THREE.BufferAttribute(ix, 1));
      const x0 = -D.HALF + i0 * D.DS, x1 = -D.HALF + i1 * D.DS, z0 = -D.HALF + j0 * D.DS, z1 = -D.HALF + j1 * D.DS;
      tg.boundingSphere = new THREE.Sphere(new THREE.Vector3((x0 + x1) / 2, (lo + hi) / 2, (z0 + z1) / 2), Math.hypot(x1 - x0, hi - lo, z1 - z0) / 2 + 1);
      const tm = new THREE.Mesh(tg, mat); tm.receiveShadow = true; tm.name = 'ground'; tm.matrixAutoUpdate = false; mesh.add(tm);
    }
    g.setIndex(null);
    scene.add(mesh);

    // diorama plinth: side walls from the terrain edge down to a common base
    const sp = [], si = []; const base = -14;
    const edge = (fn) => { const s0 = sp.length / 3; for (let k = 0; k < n; k++) { const [x, y, z] = fn(k); sp.push(x, y, z, x, base, z); } for (let k = 0; k < n - 1; k++) { const a = s0 + k * 2; si.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } };   // one winding only: indexing both windings on shared vertices makes the summed vertex normals zero, which normalises to NaN in the shader and blacks out the bloom pass
    const P = (i, j) => [-D.HALF + i * D.DS, D.dem[j * n + i] * VB.K.TERR, -D.HALF + j * D.DS];
    edge(k => P(k, 0)); edge(k => P(k, n - 1)); edge(k => P(0, k)); edge(k => P(n - 1, k));
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); sg.setIndex(si); sg.computeVertexNormals();
    const skirt = new THREE.Mesh(sg, new THREE.MeshLambertMaterial({ color: 0x5b4636, side: THREE.DoubleSide })); skirt.name = 'plinth'; scene.add(skirt);
    const table = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x3d4652 }));
    table.position.y = base; table.name = 'table'; table.receiveShadow = false; scene.add(table);
    VB.ground = { mesh, tex, mat };
    return mesh;
  };

  // ---- sky + lights + day/evening ---------------------------------------------------------
  VB.buildEnv = (scene) => {
    const sky = new THREE.Mesh(new THREE.SphereGeometry(15000, 24, 12), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, glow: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3() } },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vD; uniform vec3 top; uniform vec3 hor; uniform vec3 glow; uniform vec3 sunDir;
        void main(){ float h = clamp(vD.y, 0.0, 1.0); vec3 c = mix(hor, top, pow(h, 0.55));
          float s = max(dot(normalize(vD), sunDir), 0.0); c += glow * (pow(s, 6.0) * 0.5 + pow(s, 90.0) * 0.9);
          gl_FragColor = vec4(c, 1.0); }`,
    }));
    sky.name = 'sky'; sky.frustumCulled = false; sky.renderOrder = -10; scene.add(sky);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1); scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1); sun.castShadow = true;
    sun.shadow.mapSize.set(VB.cfg.shadowSize, VB.cfg.shadowSize); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.6;
    scene.add(sun); scene.add(sun.target);
    scene.fog = new THREE.FogExp2(0xd9c7ad, 0.00011);
    const DAY = { top: 0x5e9bd6, hor: 0xe9d3b4, glow: 0xffd9a0, fog: 0xdcc9ae, hemiS: 0xcfe2ff, hemiG: 0x8f7f6a, hemiI: 1.15, sun: 0xffdcb0, sunI: 2.5, el: 34, az: 252, exp: 1.0, fogD: 0.000105 };
    const EVE = { top: 0x14213f, hor: 0xc7684a, glow: 0xff8a4a, fog: 0x3a3550, hemiS: 0x6f7fb0, hemiG: 0x4a4048, hemiI: 1.05, sun: 0xff8f5a, sunI: 1.1, el: 7, az: 262, exp: 1.3, fogD: 0.00013 };
    const cA = new THREE.Color(), cB = new THREE.Color();
    const mix = (a, b, t) => cA.setHex(a).lerp(cB.setHex(b), t);
    const env = VB.env = { sky, hemi, sun, night: 0, target: 0, sunDir: new THREE.Vector3() };
    env.apply = (t) => {
      env.night = t; VB.uniforms.uNight.value = t;
      sky.material.uniforms.top.value.copy(mix(DAY.top, EVE.top, t)); sky.material.uniforms.hor.value.copy(mix(DAY.hor, EVE.hor, t)); sky.material.uniforms.glow.value.copy(mix(DAY.glow, EVE.glow, t));
      scene.fog.color.copy(mix(DAY.fog, EVE.fog, t)); scene.fog.density = DAY.fogD + (EVE.fogD - DAY.fogD) * t;
      hemi.color.copy(mix(DAY.hemiS, EVE.hemiS, t)); hemi.groundColor.copy(mix(DAY.hemiG, EVE.hemiG, t)); hemi.intensity = DAY.hemiI + (EVE.hemiI - DAY.hemiI) * t;
      sun.color.copy(mix(DAY.sun, EVE.sun, t)); sun.intensity = DAY.sunI + (EVE.sunI - DAY.sunI) * t;
      const el = (DAY.el + (EVE.el - DAY.el) * t) * Math.PI / 180, az = (DAY.az + (EVE.az - DAY.az) * t) * Math.PI / 180;   // azimuth clockwise from north
      env.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
      sky.material.uniforms.sunDir.value.copy(env.sunDir);
      if (VB.renderer) VB.renderer.toneMappingExposure = DAY.exp + (EVE.exp - DAY.exp) * t;
    };
    env.step = (dt) => { if (env.night !== env.target) { const d = Math.sign(env.target - env.night) * dt / 1.6; let t = env.night + d; if ((d > 0 && t > env.target) || (d < 0 && t < env.target)) t = env.target; env.apply(t); } };
    // The shadow map is cached: the city is static, so it is re-rendered only when the camera focus, the zoom
    // level, the sun or the set of detailed chunks changes (and at most every 6th frame while moving).
    // Vehicles and people are too small to cast shadows at this scale.
    sun.shadow.autoUpdate = false; const sf = new THREE.Vector3(1e9, 0, 0); let sS = 0, sT = -1, sKey = -1, sAge = 99;
    env.invalidateShadow = () => { sKey = -2; sAge = 99; };
    env.updateShadow = (focus, dist, key) => {
      sAge++;
      const S = Math.min(1800, Math.max(110, dist * 0.85)), cam = sun.shadow.camera;
      const moved = Math.abs(focus.x - sf.x) + Math.abs(focus.z - sf.z) > sS * 0.16 || Math.abs(S - sS) > sS * 0.12 || sT !== env.night || sKey !== key;
      if (!moved || sAge < 6) return;
      sf.copy(focus); sS = S; sT = env.night; sKey = key; sAge = 0;
      // the light frustum is 30 % larger than needed so pans of up to 16 % of the view reuse the cached map
      const E = S * 1.3; sun.target.position.copy(focus); sun.target.updateMatrixWorld(); sun.position.copy(focus).addScaledVector(env.sunDir, 3000);
      cam.left = -E; cam.right = E; cam.top = E; cam.bottom = -E; cam.near = 100; cam.far = 6000; cam.updateProjectionMatrix();
      sun.shadow.needsUpdate = true; env.shadowUpdates = (env.shadowUpdates || 0) + 1;
    };
    env.apply(0);
    return env;
  };

  // ---- shared voxel material ---------------------------------------------------------------
  // Per-instance attribute aStyle selects the procedural facade:
  // 0 residential plaster · 1 glass office · 2 industrial sheet · 3 institutional · 4 mixed-use with shopfront · 5 plain · 6 lamp (emissive at night) · 7 foliage
  VB.S = { RES: 0, GLASS: 1, IND: 2, INST: 3, SHOP: 4, PLAIN: 5, LAMP: 6, LEAF: 7 };
  VB.makeVoxMaterial = () => {
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = VB.uniforms.uTime; sh.uniforms.uNight = VB.uniforms.uNight;
      sh.vertexShader = 'attribute float aStyle; varying vec3 vWPos; varying vec3 vN0; varying float vH; varying float vStyle;\n' + sh.vertexShader
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec4 vbWP = vec4(transformed, 1.0); float vbSY = 1.0;
          #ifdef USE_INSTANCING
            vbWP = instanceMatrix * vbWP; vbSY = length(instanceMatrix[1].xyz);
          #endif
          vWPos = (modelMatrix * vbWP).xyz; vN0 = normal; vH = position.y * vbSY; vStyle = aStyle;`);
      sh.fragmentShader = `uniform float uTime; uniform float uNight; varying vec3 vWPos; varying vec3 vN0; varying float vH; varying float vStyle;
        float vbHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n` + sh.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec3 vbEmis = vec3(0.0);
          {
            float st = floor(vStyle + 0.5);
            bool roof = vN0.y > 0.5;
            if (st < 4.5) {
              float u = abs(vN0.x) > 0.5 ? vWPos.z : vWPos.x;
              float FH = ${VB.K.FLOOR.toFixed(4)}; float FW = st == 1.0 ? 0.36 : 0.5;
              vec2 g = vec2(u / FW, vH / FH); vec2 cell = floor(g); vec2 f = fract(g);
              float lod = clamp(1.25 - 1.6 * max(fwidth(g.x), fwidth(g.y)), 0.0, 1.0);
              float side = abs(vN0.x) > 0.5 ? 17.0 : 3.0;
              float rnd = vbHash(cell + side);
              if (roof) {
                diffuseColor.rgb *= st == 2.0 ? vec3(0.86, 0.9, 0.94) : (st == 1.0 ? vec3(0.62, 0.63, 0.66) : vec3(0.80, 0.77, 0.74));
              } else {
                diffuseColor.rgb *= mix(0.68, 1.0, smoothstep(0.0, 0.55, vH));           // contact shading at the base
                float avgLit = 0.0; vec3 litCol = vec3(1.0, 0.78, 0.46);
                if (st == 1.0) {
                  float pane = step(0.1, f.x) * step(0.12, f.y);
                  vec3 glass = mix(diffuseColor.rgb * 0.55, vec3(0.50, 0.68, 0.80), 0.30 + 0.25 * rnd);
                  diffuseColor.rgb = mix(mix(diffuseColor.rgb * 0.8, glass, 0.8), mix(diffuseColor.rgb * 0.75, glass, pane), lod);
                  litCol = vec3(0.80, 0.90, 1.0); avgLit = 0.11;
                  vbEmis = lod * pane * step(rnd, 0.42) * litCol * 0.7;
                } else if (st == 2.0) {
                  diffuseColor.rgb *= 1.0 - 0.07 * lod * step(0.5, fract(u / 0.14));
                  avgLit = 0.02;
                } else {
                  float win = step(0.26, f.x) * step(f.x, 0.74) * step(0.3, f.y) * step(f.y, 0.78);
                  float slab = step(0.93, f.y);
                  if (st == 4.0 && vH < FH) {
                    vec3 sc = 0.55 + 0.45 * cos(6.2831 * (vbHash(vec2(cell.x, side)) + vec3(0.0, 0.33, 0.67)));
                    float band = step(0.66, f.y);
                    diffuseColor.rgb = mix(diffuseColor.rgb * 0.8, mix(vec3(0.15, 0.14, 0.14), sc, band), lod);
                    vbEmis = lod * mix(vec3(1.0, 0.84, 0.58) * 0.9 * step(0.08, f.x), sc * 0.55, band);
                    avgLit = 0.5;
                  } else {
                    vec3 wc = st == 0.0 ? vec3(0.16, 0.19, 0.23) : vec3(0.2, 0.22, 0.25);
                    diffuseColor.rgb = mix(diffuseColor.rgb * 0.93, mix(diffuseColor.rgb * (1.0 - 0.12 * slab), wc, win), lod);
                    float litp = st == 0.0 ? 0.40 : (st == 3.0 ? 0.16 : 0.34);
                    litCol = mix(vec3(1.0, 0.78, 0.46), vec3(0.88, 0.93, 1.0), step(0.78, vbHash(cell + 5.0)));
                    vbEmis = lod * win * step(rnd, litp) * litCol * 0.9;
                    avgLit = litp * 0.42;
                  }
                }
                vbEmis = uNight * (vbEmis + (1.0 - lod) * avgLit * litCol * 0.75);
              }
            } else if (st == 6.0) {
              vbEmis = diffuseColor.rgb * uNight * 2.2;
            } else if (st == 7.0) {
              diffuseColor.rgb *= 0.9 + 0.1 * vN0.y;
            }
          }`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vbEmis;');
    };
    return mat;
  };

  // unit box with its base on y = 0. The bottom face is never visible (every box stands on the terrain or on another
  // box), so it is left out: 10 triangles / 20 vertices instead of 12 / 24  (-17 % triangles scene-wide).
  VB.openBox = (w = 1, h = 1, d = 1) => {
    const b = new THREE.BoxGeometry(w, h, d), pos = b.attributes.position, nor = b.attributes.normal, uv = b.attributes.uv, keep = [], map = new Int32Array(pos.count).fill(-1);
    for (let i = 0; i < pos.count; i++) if (nor.getY(i) > -0.5) { map[i] = keep.length; keep.push(i); }
    const P = new Float32Array(keep.length * 3), Nn = new Float32Array(keep.length * 3), U = new Float32Array(keep.length * 2), idx = [];
    keep.forEach((i, k) => { P[k * 3] = pos.getX(i); P[k * 3 + 1] = pos.getY(i); P[k * 3 + 2] = pos.getZ(i); Nn[k * 3] = nor.getX(i); Nn[k * 3 + 1] = nor.getY(i); Nn[k * 3 + 2] = nor.getZ(i); U[k * 2] = uv.getX(i); U[k * 2 + 1] = uv.getY(i); });
    const bi = b.index.array; for (let i = 0; i < bi.length; i += 3) if (map[bi[i]] >= 0 && map[bi[i + 1]] >= 0 && map[bi[i + 2]] >= 0) idx.push(map[bi[i]], map[bi[i + 1]], map[bi[i + 2]]);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(Nn, 3)); g.setAttribute('uv', new THREE.BufferAttribute(U, 2)); g.setIndex(idx); b.dispose(); return g;
  };
  VB.unitBox = () => { const g = VB.openBox(); g.translate(0, 0.5, 0); return g; };

  // growable instance batch -> InstancedMesh with matrix, colour and style
  VB.Batch = class {
    constructor(cap = 1024) { this.n = 0; this.cap = cap; this.m = new Float32Array(cap * 16); this.c = new Float32Array(cap * 3); this.s = new Float32Array(cap); }
    grow() { const cap = this.cap * 2, m = new Float32Array(cap * 16), c = new Float32Array(cap * 3), s = new Float32Array(cap); m.set(this.m); c.set(this.c); s.set(this.s); this.m = m; this.c = c; this.s = s; this.cap = cap; }
    // axis-aligned box: centre x,z; base y; size w,h,d ; colour (linear r,g,b) ; style
    box(x, y, z, w, h, d, r, g, b, style) {
      if (this.n === this.cap) this.grow();
      const o = this.n * 16, m = this.m; m[o] = w; m[o + 5] = h; m[o + 10] = d; m[o + 12] = x; m[o + 13] = y; m[o + 14] = z; m[o + 15] = 1;
      const k = this.n * 3; this.c[k] = r; this.c[k + 1] = g; this.c[k + 2] = b; this.s[this.n++] = style;
    }
    // box rotated about Y by angle a (radians, three.js convention)
    rbox(x, y, z, w, h, d, a, r, g, b, style) {
      this.box(x, y, z, w, h, d, r, g, b, style);
      const o = (this.n - 1) * 16, m = this.m, cs = Math.cos(a), sn = Math.sin(a);
      m[o] = cs * w; m[o + 2] = -sn * w; m[o + 8] = sn * d; m[o + 10] = cs * d;
    }
    mesh(geo, mat, shadows = true) {
      const g = new THREE.BufferGeometry(); g.index = geo.index; g.attributes.position = geo.attributes.position; g.attributes.normal = geo.attributes.normal; g.attributes.uv = geo.attributes.uv;
      g.setAttribute('aStyle', new THREE.InstancedBufferAttribute(this.s.slice(0, this.n), 1));
      const im = new THREE.InstancedMesh(g, mat, this.n);
      im.instanceMatrix = new THREE.InstancedBufferAttribute(this.m.slice(0, this.n * 16), 16);
      im.instanceColor = new THREE.InstancedBufferAttribute(this.c.slice(0, this.n * 3), 3);
      im.castShadow = shadows; im.receiveShadow = true; im.matrixAutoUpdate = false;
      return im;
    }
  };
  // free a batch mesh without deleting the vertex buffers it shares with every other batch mesh
  VB.disposeBatchMesh = (m) => { const g = m.geometry; delete g.attributes.position; delete g.attributes.normal; delete g.attributes.uv; g.index = null; g.dispose(); m.dispose(); };
  const tmpC = new THREE.Color();
  VB.lin = (hex) => { tmpC.setHex(hex); return [tmpC.r, tmpC.g, tmpC.b]; };   // sRGB hex -> linear rgb triple
})();
