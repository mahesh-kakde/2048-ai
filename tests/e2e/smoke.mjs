import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ROOT, getWasmBinaryPath, resolveVercelHeaders } = require('../helpers/load_game.js');
const { buildDist } = require('../../scripts/build_dist.js');
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

function startServer(serveRoot) {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const server = http.createServer((req, res) => {
    const reqUrl = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = reqUrl === '/' ? 'index.html' : reqUrl.replace(/^\/+/, '');
    let target = path.join(serveRoot, rel);
    let status = 200;
    if (!target.startsWith(serveRoot) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      target = path.join(serveRoot, '404.html');
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

const distDir = fs.mkdtempSync(path.join(os.tmpdir(), '2048-e2e-dist-'));
buildDist(distDir, ROOT);
const { server, port } = await startServer(distDir);
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

  // verify 65,536 merge decision, bottom-right handoff orientation, and 8-bit bitboard round-trip inside browser wasm
  const engineCheck = await page.evaluate(() => {
    const b65 = [[32768, 32768, 16384, 8192], [4096, 2048, 1024, 512], [256, 128, 64, 32], [16, 8, 4, 2]];
    const dir65 = window.ai_best_move(b65);
    const stats = window.AI.get_stats();
    const bb = window.board_to_bitboard(b65);
    const restored = window.bitboard_to_board(bb);
    const brBoard = [[0, 0, 0, 0], [0, 2, 2, 0], [8, 16, 32, 64], [0, 256, 512, 1024]];
    const brDir = window.ai_best_move(brBoard);
    const brStats = window.AI.get_stats();
    return { dir65, source: stats.source, leftVal: stats.directional.left, restoredZeroZero: restored[0][0], brDir, brEv: brStats.directional.raw[brDir] };
  });
  assert.equal(engineCheck.dir65, 3);
  assert.equal(engineCheck.source, 'wasm-expectimax');
  assert.ok(engineCheck.leftVal > -5e9);
  assert.equal(engineCheck.restoredZeroZero, 32768);
  assert.ok(engineCheck.brDir === 1 || engineCheck.brDir === 2);
  assert.ok(engineCheck.brEv > 0);

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

  // verify aria modal dialog, eager image visibility, key isolation, touch-action, focus restoration, and zero telemetry errors
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.board-wrapper')).touchAction), 'none');
  const preModalMoves = await page.evaluate(() => window.Telemetry.get_report().moves_human);
  await page.click('#info-btn');
  assert.equal(await page.getAttribute('#modal-overlay', 'aria-hidden'), 'false');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => window.Telemetry.get_report().moves_human), preModalMoves);
  const modalImgsOk = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('#tab-benchmark img')];
    return imgs.length === 2 && imgs.every(im => im.complete && im.naturalWidth === 1080 && im.getBoundingClientRect().height > 0);
  });
  assert.equal(modalImgsOk, true, 'both modal benchmark webp images must render immediately on open');
  await page.keyboard.press('Escape');
  assert.equal(await page.getAttribute('#modal-overlay', 'aria-hidden'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'info-btn');
  const tel = await page.evaluate(() => window.Telemetry.get_report());
  assert.equal(tel.error_count, 0);
  assert.equal(tel.engine_mode, 'wasm');
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('noscript'))), true);

  // verify non-runtime files are not served from dist
  for (const blockedPath of ['/wasm/engine.c', '/package.json', '/README.md', '/RESULTS.md', '/tests/game.test.js']) {
    const r = await page.goto(`${baseUrl}${blockedPath}`);
    assert.equal(r.status(), 404, `non-runtime path should 404 on prod: ${blockedPath}`);
  }

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
  fs.rmSync(distDir, { recursive: true, force: true });
}