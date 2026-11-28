const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, getWasmBinaryPath, resolveVercelHeaders } = require('./helpers/load_game');

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

  const csp = resolveVercelHeaders(cfg, '/')['Content-Security-Policy'];
  assert.ok(csp && csp.includes("script-src 'self' 'wasm-unsafe-eval'"));
  assert.ok(csp.includes("object-src 'none'"));
  assert.ok(csp.includes("frame-ancestors 'none'"));
  assert.equal(csp.includes("'unsafe-inline'"), false);
  assert.equal(/\s'unsafe-eval'(?:\s|;|$)/.test(csp), false);

  for (const file of ['index.html', '404.html']) {
    const content = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.equal(/<script(?![^>]*\bsrc=)[^>]*>/i.test(content), false);
    assert.equal(/\sstyle\s*=/i.test(content), false);
    assert.equal(/\son[a-z]+\s*=/i.test(content), false);
  }
});