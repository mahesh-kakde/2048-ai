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