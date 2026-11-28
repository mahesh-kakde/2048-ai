const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ROOT, getWasmBinaryPath, resolveVercelHeaders } = require('./helpers/load_game');
const { buildDist } = require('../scripts/build_dist');

test('legacy v2/v3 model files and script tags remain excluded from production runtime', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const scriptSrcs = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(scriptSrcs, ['js/game.js', 'js/ui.js', 'js/ai.js', 'js/main.js']);

  for (const legacy of ['model/pdf_tables_v4.bin', 'model/tuples_v3.bin', 'js/nn.js', 'js/tablebase.js', 'js/tuple.js']) {
    assert.equal(fs.existsSync(path.join(ROOT, legacy)), false, `legacy artifact exists: ${legacy}`);
  }

  let totalBytes = Buffer.byteLength(html, 'utf8');
  for (const rel of [...scriptSrcs, 'style.css', getWasmBinaryPath()]) {
    totalBytes += fs.statSync(path.join(ROOT, rel)).size;
  }
  assert.ok(totalBytes < 120 * 1024, `core runtime exceeds budget: ${totalBytes} bytes`);
});

test('404 page uses root-relative stylesheet and home navigation routes', () => {
  const html = fs.readFileSync(path.join(ROOT, '404.html'), 'utf8');
  assert.ok(html.includes('href="/style.css"'));
  assert.ok(html.includes('href="/"'));
  assert.equal(/href="style\.css"/.test(html), false);
});

test('vercel.json enforces hashed wasm immutability and strict CSP without unsafe directives', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const hashedPath = '/' + getWasmBinaryPath();

  assert.equal(resolveVercelHeaders(cfg, hashedPath)['Cache-Control'], 'public, max-age=31536000, immutable');
  assert.equal(resolveVercelHeaders(cfg, '/wasm/engine.wasm')['Cache-Control'], 'public, max-age=0, must-revalidate');
  assert.equal(resolveVercelHeaders(cfg, '/wasm/engine.c')['Cache-Control'], 'public, max-age=0, must-revalidate');
  assert.equal(resolveVercelHeaders(cfg, '/sw.js')['Cache-Control'], 'public, max-age=0, must-revalidate');

  const headers = resolveVercelHeaders(cfg, '/');
  const csp = headers['Content-Security-Policy'];
  assert.ok(csp && csp.includes("script-src 'self' 'wasm-unsafe-eval'"));
  assert.ok(csp.includes("worker-src 'self'"));
  assert.ok(csp.includes("manifest-src 'self'"));
  assert.ok(csp.includes("object-src 'none'"));
  assert.ok(csp.includes("frame-ancestors 'none'"));
  assert.equal(csp.includes("'unsafe-inline'"), false);
  assert.equal(/\s'unsafe-eval'(?:\s|;|$)/.test(csp), false);

  assert.equal(headers['Cross-Origin-Resource-Policy'], 'same-origin');
  assert.equal(headers['Cross-Origin-Opener-Policy'], 'same-origin');
  assert.equal(headers['Access-Control-Allow-Origin'], 'https://2048.maheshkakde.com');
  assert.equal(headers['Vary'], 'Origin');
  assert.notEqual(headers['Access-Control-Allow-Origin'], '*');

  for (const file of ['index.html', '404.html']) {
    const content = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.equal(/<script(?![^>]*\bsrc=)[^>]*>/i.test(content), false);
    assert.equal(/\sstyle\s*=/i.test(content), false);
    assert.equal(/\son[a-z]+\s*=/i.test(content), false);
  }
});

test('accessibility markup, reduced motion, reflow overflow, and wcag aa contrast hold', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /id="modal-overlay"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /class="modal-tabs"[^>]*role="tablist"/);
  assert.match(html, /role="tab"[^>]*aria-selected="true"[^>]*aria-controls="tab-benchmark"/);
  assert.match(html, /id="tab-benchmark"[^>]*role="tabpanel"[^>]*aria-labelledby="tab-btn-benchmark"/);

  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.equal(/html,\s*body\s*\{[^}]*overflow:\s*hidden/.test(css), false);
  assert.match(css, /html,\s*body\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(css, /\.board-wrapper\s*\{[^}]*touch-action:\s*none/);
  assert.match(css, /\.board\s*\{[^}]*touch-action:\s*none/);

  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const cr = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const varMap = Object.fromEntries([...css.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map(m => [m[1], m[2]]));

  assert.ok(cr(varMap['--text'], varMap['--bg']) >= 4.5, '--text contrast on --bg < 4.5');
  assert.ok(cr(varMap['--text-light'], varMap['--bg']) >= 4.5, '--text-light contrast on --bg < 4.5');
  for (const v of [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048]) {
    assert.ok(cr(varMap['--tile-text-dark'], varMap[`--tile-${v}`]) >= 4.5, `tile-${v} contrast < 4.5`);
  }
  assert.ok(cr('#ffffff', '#655c54') >= 4.5, 'primary/hud button contrast < 4.5');
  assert.ok(cr('#4e463f', '#e8e1d7') >= 4.5, 'hud invalid card contrast < 4.5');
  assert.ok(cr('#ffffff', '#7f1d1d') >= 4.5, 'hud danger card contrast < 4.5');
  assert.ok(cr('#756a60', varMap['--bg']) >= 4.5, '404 hero number contrast < 4.5');
});

test('benchmark images use stripped WebP assets with intrinsic dimensions and eager modal visibility', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'High Score [1].jpg')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'High Score [2].jpg')), false);

  let totalBytes = 0;
  for (const imgName of ['high-score-1.webp', 'high-score-2.webp']) {
    const data = fs.readFileSync(path.join(ROOT, imgName));
    totalBytes += data.length;
    assert.equal(data.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(data.subarray(8, 12).toString('ascii'), 'WEBP');
    assert.equal(data.includes(Buffer.from('EXIF')), false, `${imgName} contains EXIF`);
    assert.equal(data.includes(Buffer.from('XMP ')), false, `${imgName} contains XMP`);
    assert.equal(data.includes(Buffer.from('ICCP')), false, `${imgName} contains ICC profile`);
  }
  assert.ok(totalBytes < 100 * 1024, `webp assets exceed 100 KB budget: ${totalBytes} bytes`);

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /src="high-score-1\.webp"[^>]*width="1080"[^>]*height="2340"/);
  assert.match(html, /src="high-score-2\.webp"[^>]*width="1080"[^>]*height="2340"/);
  assert.equal(/loading="lazy"/.test(html), false, 'modal benchmark images must not defer loading with lazy');
});

test('dist build strictly includes runtime assets and excludes notebooks, c source, tests, and docs', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'notebooks')), false, 'obsolete notebooks/ should not exist on master');

  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.equal(cfg.buildCommand, 'node scripts/build_dist.js');
  assert.equal(cfg.outputDirectory, 'dist');

  const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), '2048-dist-test-'));
  try {
    buildDist(tmpOut, ROOT);
    const listRel = (dir, base = '') => {
      const files = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = base ? `${base}/${entry.name}` : entry.name;
        if (entry.isDirectory()) files.push(...listRel(path.join(dir, entry.name), rel));
        else files.push(rel);
      }
      return files;
    };
    const actual = listRel(tmpOut).sort();
    const expected = [
      '404.html',
      'apple-touch-icon.png',
      'high-score-1.webp',
      'high-score-2.webp',
      'icon-192.png',
      'icon-512.png',
      'index.html',
      'js/ai.js',
      'js/game.js',
      'js/main.js',
      'js/ui.js',
      'manifest.webmanifest',
      'og-image.png',
      'robots.txt',
      'style.css',
      'sw.js',
      getWasmBinaryPath()
    ].sort();
    assert.deepEqual(actual, expected);
    assert.equal(fs.existsSync(path.join(tmpOut, 'wasm', 'engine.c')), false);
    assert.equal(fs.existsSync(path.join(tmpOut, 'package.json')), false);
    assert.equal(fs.existsSync(path.join(tmpOut, 'tests')), false);
    assert.equal(fs.existsSync(path.join(tmpOut, 'README.md')), false);
    assert.equal(fs.existsSync(path.join(tmpOut, 'CHANGELOG.md')), false);
  } finally {
    fs.rmSync(tmpOut, { recursive: true, force: true });
  }
});

test('seo, noscript, manifest, og-image, and service worker precache integrity hold', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /<noscript>[\s\S]*class="noscript-banner"[\s\S]*<\/noscript>/);
  assert.match(html, /<meta\s+property="og:image"\s+content="https:\/\/2048\.maheshkakde\.com\/og-image\.png"/);
  assert.match(html, /<meta\s+name="twitter:image"\s+content="https:\/\/2048\.maheshkakde\.com\/og-image\.png"/);
  assert.match(html, /<link\s+rel="apple-touch-icon"[^>]*href="\/apple-touch-icon\.png"/);
  assert.match(html, /<link\s+rel="manifest"\s+href="\/manifest\.webmanifest"/);

  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  assert.match(css, /\.noscript-banner\s*\{/);

  const robots = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8');
  assert.match(robots, /User-agent:\s*\*/);
  assert.match(robots, /Allow:\s*\//);

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2);
  assert.deepEqual(manifest.icons.map(i => i.sizes), ['192x192', '512x512']);

  const expectedPngDims = {
    'og-image.png': [1200, 630],
    'apple-touch-icon.png': [180, 180],
    'icon-192.png': [192, 192],
    'icon-512.png': [512, 512]
  };
  for (const [pngName, [expW, expH]] of Object.entries(expectedPngDims)) {
    const buf = fs.readFileSync(path.join(ROOT, pngName));
    assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${pngName} invalid png header`);
    assert.equal(buf.readUInt32BE(16), expW, `${pngName} width mismatch`);
    assert.equal(buf.readUInt32BE(20), expH, `${pngName} height mismatch`);
    assert.ok(buf.length < 100 * 1024, `${pngName} exceeds 100 KB: ${buf.length}`);
  }

  const swCode = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  assert.ok(swCode.includes(`const WASM_PATH = '/${getWasmBinaryPath()}';`), 'sw.js WASM_PATH out of sync');
  assert.equal(swCode.includes("'/index.html'"), false, 'sw.js must precache / instead of /index.html to avoid cleanUrls 308');
  const precacheList = [...swCode.matchAll(/'(\/[^']*)'/g)].map(m => m[1]);
  assert.ok(precacheList.includes('/'));
  for (const urlPath of precacheList) {
    const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1);
    assert.equal(fs.existsSync(path.join(ROOT, rel)), true, `missing sw.js precache asset: ${rel}`);
  }

  assert.match(html, /4-corner symmetry rotation/);
  assert.equal(fs.existsSync(path.join(ROOT, 'CHANGELOG.md')), true);
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.match(readme, /2048-ai\.git/);
  assert.equal(/2048-nn\.git/.test(readme), false);
  assert.match(readme, /2048\.maheshkakde\.com/);
});