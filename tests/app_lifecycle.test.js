const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, loadFullApp, createFakeTimers } = require('./helpers/load_game');

test('app handles restricted localStorage, quota errors, corrupted values, and purges legacy v3 storage', () => {
  const throwingStorage = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('QuotaExceededError'); },
    removeItem() { throw new Error('SecurityError'); }
  };
  const { ctx: c1 } = loadFullApp({
    localStorageImpl: throwingStorage,
    indexedDBImpl: { deleteDatabase() { throw new Error('SecurityError'); } }
  });
  assert.equal(c1.Game.get_board().flat().filter(x => x > 0).length, 2);

  for (const bad of ['NaN', '-100', 'abc', '', null]) {
    const { dom } = loadFullApp({
      localStorageImpl: { getItem: () => bad, setItem() {}, removeItem() {} }
    });
    assert.equal(String(dom.getEl('best').textContent), '0');
  }

  let deletedDb = null;
  let removedKey = null;
  const persisted = { '2048-best': '4096', '2048-tuple-games-learned': '12' };
  const { dom: normalDom } = loadFullApp({
    indexedDBImpl: { deleteDatabase: (name) => { deletedDb = name; } },
    localStorageImpl: {
      getItem: (k) => (k in persisted ? persisted[k] : null),
      setItem: (k, v) => { persisted[k] = v; },
      removeItem: (k) => { removedKey = k; delete persisted[k]; }
    }
  });
  assert.equal(deletedDb, '2048_ai_db');
  assert.equal(removedKey, '2048-tuple-games-learned');
  assert.equal(String(normalDom.getEl('best').textContent), '4096');
});

test('async AI, game-over, and input-lock timers cancel cleanly without leaks', () => {
  const timers = createFakeTimers();
  const { dom } = loadFullApp({ timersImpl: timers });
  const aiTimers = () => timers.list().filter(t => t.delay === 200 || t.delay === 40);

  dom.listeners['ai-btn:click']();
  assert.equal(aiTimers().length, 1);
  dom.listeners['ai-btn:click']();
  assert.equal(aiTimers().length, 0);
  dom.listeners['ai-btn:click']();
  assert.equal(aiTimers().length, 1);

  for (let i = 0; i < 4; i++) {
    assert.equal(aiTimers().length, 1);
    const nextAi = aiTimers()[0];
    timers.clearTimeout(nextAi.id);
    nextAi.fn();
  }

  dom.listeners['new-game-btn:click']();
  assert.equal(aiTimers().length, 0);
  const resetScore = String(dom.getEl('score').textContent);
  timers.flushAll();
  assert.equal(String(dom.getEl('score').textContent), resetScore);
});

test('game-over banner timer cancels cleanly if user resets within 300ms', () => {
  const timers = createFakeTimers();
  const { ctx, dom, runInContext } = loadFullApp({ timersImpl: timers });

  runInContext(`
    is_game_over = () => true;
    trace_move = (b) => ({ board: b, score: 4, moved: true, merges: [], movements: [] });
  `);
  ctx.Game.do_move(3);
  assert.equal(ctx.Game.is_over(), true);
  assert.equal(timers.activeCount, 2);

  dom.listeners['new-game-btn:click']();
  assert.equal(timers.activeCount, 0);
  timers.flushAll();
  assert.equal(dom.getEl('game-message').classList.contains('active'), false);
});

test('UI uses CSS grid variables, slides tiles cleanly without leaks, and separates -5e9 danger threshold', () => {
  const timers = createFakeTimers();
  const { ctx, dom } = loadFullApp({ timersImpl: timers });
  const wrapperEl = dom.getEl('board-wrapper');

  for (let m = 0; m < 40; m++) {
    ctx.Game.do_move(m % 4);
    timers.flushAll();
    if (ctx.Game.is_over()) dom.listeners['new-game-btn:click']();
  }

  const nonEmpty = ctx.Game.get_board().flat().filter(x => x > 0).length;
  const activeDomTiles = wrapperEl.children.filter(c => !c.classList.contains('tile-retiring'));
  assert.equal(activeDomTiles.length, nonEmpty);
  assert.ok(activeDomTiles.length > 0);
  assert.ok(activeDomTiles[0].style.getPropertyValue('--row') !== '');
  assert.ok(activeDomTiles[0].style.getPropertyValue('--col') !== '');

  ctx.UI.update_decision_hud({ up: 500, right: -6e9, down: null, left: -2e6, best_dir: 0 });
  assert.equal(dom.getEl('hud-val-right').textContent, 'danger');
  assert.equal(dom.getEl('hud-val-down').textContent, 'blocked');
  assert.notEqual(dom.getEl('hud-val-left').textContent, 'danger');

  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  assert.match(css, /\.tile\s*\{[\s\S]*left:\s*calc\(var\(--cell-gap\)\s*\+\s*var\(--col/);
  assert.match(css, /\.tile\s*\{[\s\S]*top:\s*calc\(var\(--cell-gap\)\s*\+\s*var\(--row/);
});

test('runtime telemetry tracks errors, wasm fallback, degraded storage, and dismissible status banner', async () => {
  // storage error degrades cleanly with dismissible warning banner
  const throwingStorage = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('QuotaExceededError'); },
    removeItem() {}
  };
  const app1 = loadFullApp({ localStorageImpl: throwingStorage });
  await app1.ctx.window.init_wasm();
  const rep1 = app1.ctx.window.Telemetry.get_report();
  assert.equal(rep1.storage_degraded, true);
  assert.equal(app1.dom.getEl('status-banner').classList.contains('active'), true);
  assert.match(app1.dom.getEl('status-text').textContent, /storage unavailable/);
  app1.dom.listeners['status-close:click']();
  assert.equal(app1.dom.getEl('status-banner').classList.contains('active'), false);

  // global error, unhandledrejection, and ai_step exception recovery keep event log bounded (<= 50)
  const app2 = loadFullApp({ enableWasm: false });
  await app2.ctx.window.init_wasm();
  assert.equal(app2.ctx.window.Telemetry.get_report().engine_mode, 'js-fallback');
  assert.equal(app2.dom.getEl('status-banner').classList.contains('active'), true);
  assert.match(app2.dom.getEl('status-text').textContent, /wasm unavailable/);

  for (let i = 0; i < 60; i++) {
    app2.winListeners.error[0]({ error: new Error(`boom-${i}`) });
  }
  app2.winListeners.unhandledrejection[0]({ reason: new Error('async-boom') });
  assert.equal(app2.dom.getEl('status-banner').classList.contains('status-error'), true);
  // non-error warning must not overwrite an active runtime error banner
  app2.ctx.UI.show_status('minor notice', 'warn');
  assert.equal(app2.dom.getEl('status-banner').classList.contains('status-error'), true);

  app2.runInContext('ai_best_move = () => { throw new Error("search crash"); };');
  app2.dom.listeners['ai-btn:click']();
  assert.equal(app2.dom.getEl('ai-btn').textContent, 'let ai play');

  const rep2 = app2.ctx.window.Telemetry.get_report();
  assert.equal(rep2.error_count, 62);
  assert.equal(rep2.events.length, 50);
  assert.ok(rep2.events.some(e => e.type === 'ai_step_error'));
});

test('info modal manages aria state, tablist keyboard switching, focus trap, and focus restoration', () => {
  const { dom } = loadFullApp();
  const infoBtn = dom.getEl('info-btn');
  const closeBtn = dom.getEl('modal-close');
  const overlay = dom.getEl('modal-overlay');
  const tab1 = dom.getEl('tab-btn-benchmark');
  const tab2 = dom.getEl('tab-btn-technical');
  const panel1 = dom.getEl('tab-benchmark');
  const panel2 = dom.getEl('tab-technical');

  dom.document.activeElement = infoBtn;
  dom.listeners['info-btn:click']();
  assert.equal(overlay.classList.contains('active'), true);
  assert.equal(overlay.getAttribute('aria-hidden'), 'false');
  assert.equal(dom.document.activeElement, closeBtn);

  // switch tabs via ArrowRight key on tablist button
  dom.listeners['tab-btn-benchmark:keydown']({ key: 'ArrowRight', preventDefault() {} });
  assert.equal(tab1.getAttribute('aria-selected'), 'false');
  assert.equal(tab2.getAttribute('aria-selected'), 'true');
  assert.equal(panel1.getAttribute('aria-hidden'), 'true');
  assert.equal(panel2.getAttribute('aria-hidden'), 'false');
  assert.equal(dom.document.activeElement, tab2);

  // wrap Tab forward from last focusable modal control back to first (#modal-close)
  let prevented = false;
  dom.listeners['doc:keydown']({ key: 'Tab', shiftKey: false, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(dom.document.activeElement, closeBtn);

  // wrap Shift+Tab backward from first control to last (#tab-btn-technical)
  prevented = false;
  dom.listeners['doc:keydown']({ key: 'Tab', shiftKey: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(dom.document.activeElement, tab2);

  // Escape closes modal and restores focus back to #info-btn
  dom.listeners['doc:keydown']({ key: 'Escape', preventDefault() {} });
  assert.equal(overlay.classList.contains('active'), false);
  assert.equal(overlay.getAttribute('aria-hidden'), 'true');
  assert.equal(dom.document.activeElement, infoBtn);
});

test('modal open blocks arrow keys and board-scoped swipes from mutating game state', () => {
  const timers = createFakeTimers();
  const { ctx, dom } = loadFullApp({ timersImpl: timers });
  const before = JSON.stringify(ctx.Game.get_board());

  assert.equal(dom.listeners['doc:touchstart'], undefined);
  assert.equal(typeof dom.listeners['board-wrapper:touchstart'], 'function');
  assert.equal(typeof dom.listeners['board-wrapper:touchend'], 'function');
  assert.equal(typeof dom.listeners['board-wrapper:touchcancel'], 'function');

  dom.listeners['info-btn:click']();
  for (const key of ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft']) {
    let prevented = false;
    dom.listeners['doc:keydown']({ key, preventDefault() { prevented = true; } });
    assert.equal(prevented, false);
  }
  assert.equal(JSON.stringify(ctx.Game.get_board()), before);

  dom.listeners['board-wrapper:touchstart']({ touches: [{ clientX: 200, clientY: 200 }] });
  dom.listeners['board-wrapper:touchend']({ changedTouches: [{ clientX: 50, clientY: 200 }] });
  assert.equal(JSON.stringify(ctx.Game.get_board()), before);
  assert.equal(ctx.window.Telemetry.get_report().moves_human, 0);

  // orphan touchend or cancelled swipe when modal closes should not move board
  dom.listeners['doc:keydown']({ key: 'Escape', preventDefault() {} });
  dom.listeners['board-wrapper:touchstart']({ touches: [{ clientX: 200, clientY: 200 }] });
  dom.listeners['board-wrapper:touchcancel']();
  dom.listeners['board-wrapper:touchend']({ changedTouches: [{ clientX: 50, clientY: 200 }] });
  assert.equal(ctx.window.Telemetry.get_report().moves_human, 0);
});

test('decision hud normalizes valid softmax percentages to sum to exactly 100', () => {
  const { ctx, dom } = loadFullApp();

  // exact 3-way tie must sum to 100% with remainder allocated to best_dir
  ctx.UI.update_decision_hud({ up: 100, right: 100, down: 100, left: null, best_dir: 2 });
  assert.deepEqual(
    ['up', 'right', 'down', 'left'].map(k => dom.getEl(`hud-prob-${k}`).textContent),
    ['33%', '33%', '34%', '']
  );

  // mixed valid + danger + blocked moves: valid moves sum to exact 100%, danger shows risk
  const cases = [
    { up: 500, right: 500, down: 499, left: 499, best_dir: 1 },
    { up: 1234, right: 1200, down: -6e9, left: 1180, best_dir: 0 },
    { up: 10, right: null, down: 10, left: null, best_dir: 0 },
    { up: 999999, right: 999998, down: 999997, left: 999996, best_dir: 0 }
  ];
  for (let i = 0; i < 60; i++) {
    const vals = [0, 1, 2, 3].map(d => {
      if ((i + d) % 7 === 0) return null;
      if ((i + d) % 9 === 0) return -6e9;
      return ((i * 73 + d * 197) % 1000) - 200;
    });
    if (vals.some(v => typeof v === 'number' && v > -5e9)) {
      const best = vals.reduce((bi, v, idx) => (typeof v === 'number' && (bi === -1 || v > vals[bi]) ? idx : bi), -1);
      cases.push({ up: vals[0], right: vals[1], down: vals[2], left: vals[3], best_dir: best });
    }
  }

  for (const c of cases) {
    ctx.UI.update_decision_hud(c);
    const dirs = ['up', 'right', 'down', 'left'];
    let sum = 0;
    let validCount = 0;
    for (const d of dirs) {
      const txt = dom.getEl(`hud-prob-${d}`).textContent;
      if (c[d] === null || c[d] === undefined) {
        assert.equal(txt, '');
      } else if (c[d] < -5e9) {
        assert.equal(txt, '0% (risk)');
      } else {
        validCount++;
        const n = Number(txt.replace('%', ''));
        assert.equal(Number.isInteger(n), true);
        assert.ok(n >= 0 && n <= 100);
        sum += n;
      }
    }
    if (validCount > 0) assert.equal(sum, 100, `expected 100% sum, got ${sum} for ${JSON.stringify(c)}`);
  }
});