import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ROOT, getWasmBinaryPath, resolveVercelHeaders } = require('../helpers/load_game.js');
const { chromium } = require('playwright');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.c': 'text/plain; charset=utf-8',
  '.json': 'application/json'
};

function startServer() {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const server = http.createServer((req, res) => {
    const reqUrl = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = reqUrl === '/' ? 'index.html' : reqUrl.replace(/^\/+/, '');
    let target = path.join(ROOT, rel);
    let status = 200;
    if (!target.startsWith(ROOT) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      target = path.join(ROOT, '404.html');
      status = 404;
    }
    const headers = {
      'Content-Type': MIME[path.extname(target)] || 'application/octet-stream',
      ...resolveVercelHeaders(cfg, reqUrl)
    };
    res.writeHead(status, headers);
    fs.createReadStream(target).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

const { server, port } = await startServer();
const baseUrl = `http://127.0.0.1:${port}`;
let browser;

try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  const badResponses = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('response', (res) => {
    const url = res.url();
    if (url.startsWith(baseUrl) && !url.includes('/nonexistent/') && res.status() >= 400) {
      badResponses.push(`${res.status()} ${url}`);
    }
  });

  const mainResp = await page.goto(baseUrl, { waitUntil: 'networkidle' });
  assert.equal(mainResp.status(), 200);
  assert.ok(mainResp.headers()['content-security-policy'], 'csp header missing on /');

  await page.waitForFunction(() => window.AI && window.AI.is_wasm_ready() === true);

  // verify 65,536 merge decision and 8-bit bitboard round-trip inside real browser wasm
  const engineCheck = await page.evaluate(() => {
    const b65 = [[32768, 32768, 16384, 8192], [4096, 2048, 1024, 512], [256, 128, 64, 32], [16, 8, 4, 2]];
    const dir65 = window.ai_best_move(b65);
    const stats = window.AI.get_stats();
    const bb = window.board_to_bitboard(b65);
    const restored = window.bitboard_to_board(bb);
    return { dir65, source: stats.source, leftVal: stats.directional.left, restoredZeroZero: restored[0][0] };
  });
  assert.equal(engineCheck.dir65, 3);
  assert.equal(engineCheck.source, 'wasm-expectimax');
  assert.ok(engineCheck.leftVal > -5e9);
  assert.equal(engineCheck.restoredZeroZero, 32768);

  // verify responsive viewport resize keeps every tile inside #board
  await page.setViewportSize({ width: 375, height: 667 });
  await page.waitForTimeout(100);
  const geometryOk = await page.evaluate(() => {
    const board = document.getElementById('board').getBoundingClientRect();
    const tiles = [...document.querySelectorAll('.board-wrapper .tile:not(.tile-retiring)')];
    return tiles.length >= 2 && tiles.every((t) => {
      const r = t.getBoundingClientRect();
      return r.left >= board.left && r.right <= board.right && r.top >= board.top && r.bottom <= board.bottom;
    });
  });
  assert.equal(geometryOk, true, 'tile leaked outside #board after mobile resize');

  // verify rapid ai toggle + reset safety
  await page.click('#ai-btn');
  await page.click('#ai-btn');
  await page.click('#ai-btn');
  await page.waitForTimeout(400);
  await page.click('#new-game-btn');
  await page.waitForTimeout(350);
  assert.equal(await page.textContent('#score'), '0');
  assert.equal(await page.textContent('#ai-btn'), 'let ai play');

  // verify aria modal dialog, eager image visibility, focus restoration, and zero runtime telemetry errors
  await page.click('#info-btn');
  assert.equal(await page.getAttribute('#modal-overlay', 'aria-hidden'), 'false');
  const modalImgsOk = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('#tab-benchmark img')];
    return imgs.length === 2 && imgs.every(im => im.complete && im.naturalWidth === 440 && im.getBoundingClientRect().height > 0);
  });
  assert.equal(modalImgsOk, true, 'both modal benchmark webp images must render immediately on open');
  await page.keyboard.press('Escape');
  assert.equal(await page.getAttribute('#modal-overlay', 'aria-hidden'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'info-btn');
  const tel = await page.evaluate(() => window.Telemetry.get_report());
  assert.equal(tel.error_count, 0);
  assert.equal(tel.engine_mode, 'wasm');

  // verify nested 404 route renders styled 404 page cleanly
  const resp404 = await page.goto(`${baseUrl}/nonexistent/nested`, { waitUntil: 'networkidle' });
  assert.equal(resp404.status(), 404);
  assert.equal(await page.textContent('.error-hero-num'), '404');
  const cssLoaded404 = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.ok(cssLoaded404 && cssLoaded404 !== 'rgba(0, 0, 0, 0)', '404 stylesheet failed to apply');

  assert.deepEqual(badResponses, []);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  console.log(`e2e smoke passed (wasm path=${getWasmBinaryPath()})`);
} finally {
  if (browser) await browser.close();
  server.close();
}