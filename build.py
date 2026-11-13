#!/usr/bin/env python3
"""Build the single self-contained deliverable  voxel-bengaluru.html.

Inputs
  src/index.html, src/style.css, src/js/*.js   application source (concatenated in filename order)
  vendor/three-bundle.min.js                    Three.js r170 + OrbitControls + post-processing (see vendor/README.md)
  data/processed/scene_data.json                compact scene data produced by tools/02_build_data.py
Output
  voxel-bengaluru.html                          no external requests at run time

Pure standard-library Python; run:  python3 build.py
"""
import glob, hashlib, json, os, sys, time
ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, 'voxel-bengaluru.html')
rd = lambda p: open(os.path.join(ROOT, p), encoding='utf8').read()

def main():
    data_path = os.path.join(ROOT, 'data', 'processed', 'scene_data.json')
    if not os.path.exists(data_path):
        sys.exit('data/processed/scene_data.json missing - run the preprocessing pipeline in tools/ first (see README).')
    data = rd('data/processed/scene_data.json')
    json.loads(data)                                             # sanity check
    data = data.replace('</', '<\\/')                            # keep the JSON inert inside <script>
    js = '\n'.join('// ---- %s ----\n%s' % (os.path.basename(p), open(p, encoding='utf8').read()) for p in sorted(glob.glob(os.path.join(ROOT, 'src', 'js', '*.js'))))
    vendor = rd('vendor/three-bundle.min.js').replace('</script', '<\\/script')
    html = rd('src/index.html')
    for key, val in (('/*__CSS__*/', rd('src/style.css')), ('/*__VENDOR__*/', vendor), ('/*__SRC__*/', js), ('__DATA__', data)):
        assert key in html, key
        html = html.replace(key, val, 1)
    for bad in ('http://', 'https://'):                           # no run-time network dependencies
        for tag in ('src="' + bad, 'href="' + bad, "url(" + bad, "import('" + bad, 'fetch("' + bad):
            assert tag not in html, 'external reference found: ' + tag
    open(OUT, 'w', encoding='utf8').write(html)
    size = os.path.getsize(OUT)
    print('wrote %s  %.2f MB  sha256 %s' % (os.path.relpath(OUT, ROOT), size / 1e6, hashlib.sha256(html.encode()).hexdigest()[:16]))
    print('  data %.2f MB · vendor %.2f MB · app js %.0f kB' % (len(data) / 1e6, len(vendor) / 1e6, len(js) / 1e3))

if __name__ == '__main__':
    main()
