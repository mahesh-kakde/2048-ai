const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, getWasmBinaryPath, loadAiEngine } = require('./helpers/load_game');

test('hashed wasm binary exists, matches sha256 filename, syncs with EMBEDDED_WASM_B64, and omits dead exports', () => {
  const rel = getWasmBinaryPath();
  assert.match(rel, /^wasm\/engine\.[0-9a-f]{8}\.wasm$/);
  assert.equal(fs.existsSync(path.join(ROOT, 'wasm', 'engine.wasm')), false);

  const bytes = fs.readFileSync(path.join(ROOT, rel));
  const shaShort = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 8);
  assert.equal(rel, `wasm/engine.${shaShort}.wasm`);

  const aiSource = fs.readFileSync(path.join(ROOT, 'js', 'ai.js'), 'utf8');
  const b64Match = aiSource.match(/const EMBEDDED_WASM_B64 = "([^"]*)";/);
  assert.ok(b64Match && b64Match[1].length > 0);
  assert.equal(Buffer.compare(bytes, Buffer.from(b64Match[1], 'base64')), 0);

  const mod = new WebAssembly.Module(bytes);
  assert.equal(WebAssembly.Module.imports(mod).length, 0);
  const exports = new Set(WebAssembly.Module.exports(mod).map(e => e.name));
  for (const name of [
    'memory', 'wasm_init', 'wasm_get_board_ptr', 'wasm_search_buf', 'wasm_evaluate_buf',
    'wasm_search', 'wasm_evaluate_board', 'wasm_search_parts',
    'wasm_is_dir_valid', 'wasm_get_dir_val', 'wasm_get_nodes', 'wasm_get_tt_hits', 'wasm_get_best_dir'
  ]) {
    assert.ok(exports.has(name), `missing wasm export: ${name}`);
  }
  assert.equal(exports.has('wasm_init_tuple_weights'), false);
  assert.equal(exports.has('wasm_set_use_tuple'), false);
});

test('init_wasm fetches hashed binary and falls back to EMBEDDED_WASM_B64 offline', async () => {
  const online = loadAiEngine({ enableWasm: true, allowFetch: true });
  assert.equal(await online.ctx.window.init_wasm(), true);
  assert.deepEqual(online.fetchedUrls, [online.wasmRel]);

  const offline = loadAiEngine({ enableWasm: true, allowFetch: false });
  assert.equal(await offline.ctx.window.init_wasm(), true);
});

test('wasm and js evaluators match across 65,536 row-lut codes and 1,000 high-tile 2^22 boards', () => {
  const { ctx, wasmBytes } = loadAiEngine({ enableWasm: false });
  const inst = new WebAssembly.Instance(new WebAssembly.Module(wasmBytes), {});
  inst.exports.wasm_init();
  const buf = new Uint8Array(inst.exports.memory.buffer, inst.exports.wasm_get_board_ptr(), 16);

  const evalWasm = (mat) => {
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        buf[r * 4 + c] = mat[r][c] > 0 ? Math.round(Math.log2(mat[r][c])) : 0;
      }
    }
    return inst.exports.wasm_evaluate_buf();
  };

  for (let code = 0; code < 65536; code++) {
    const row = [
      (code & 0xf) ? (1 << (code & 0xf)) : 0,
      ((code >> 4) & 0xf) ? (1 << ((code >> 4) & 0xf)) : 0,
      ((code >> 8) & 0xf) ? (1 << ((code >> 8) & 0xf)) : 0,
      ((code >> 12) & 0xf) ? (1 << ((code >> 12) & 0xf)) : 0
    ];
    const mat = [row, [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    assert.ok(Math.abs(ctx.evaluate_board(mat) - evalWasm(mat)) < 1e-6);
  }

  let seed = 0x12345678;
  const randInt = (n) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed % n;
  };
  for (let i = 0; i < 1000; i++) {
    const mat = Array.from({ length: 4 }, () =>
      Array.from({ length: 4 }, () => {
        const exp = randInt(23);
        return exp === 0 ? 0 : Math.pow(2, exp);
      })
    );
    const j = ctx.evaluate_board(mat);
    const w = evalWasm(mat);
    assert.ok(Math.abs(j - w) <= Math.max(1e-3, Math.abs(j) * 1e-12));
  }
});

test('65536+ merges, 1M zobrist hashing, and depth-4 wasm/js search parity hold', async () => {
  const { ctx: jsCtx } = loadAiEngine({ enableWasm: false });
  const { ctx: wasmCtx } = loadAiEngine({ enableWasm: true, allowFetch: true });
  assert.equal(await wasmCtx.window.init_wasm(), true);

  const mergeBoards = [
    [[32768, 32768, 16384, 8192], [4096, 2048, 1024, 512], [256, 128, 64, 32], [16, 8, 4, 2]],
    [[65536, 65536, 32768, 16384], [4096, 2048, 1024, 512], [256, 128, 64, 32], [16, 8, 4, 2]],
    [[131072, 131072, 65536, 32768], [8192, 4096, 2048, 1024], [512, 256, 128, 64], [32, 16, 8, 4]]
  ];

  for (const board of mergeBoards) {
    assert.equal(wasmCtx.window.ai_best_move(board), 3);
    assert.equal(jsCtx.window.ai_best_move(board), 3);
    const st = wasmCtx.window.get_last_search_stats();
    assert.equal(st.source, 'wasm-expectimax');
    assert.ok(st.directional.left > -5e9);
    assert.equal(st.directional.up, null);
    assert.ok(st.directional.right < -5e9);
  }

  const millionBoard = [[1048576, 524288, 262144, 131072], [65536, 32768, 16384, 8192], [4096, 2048, 1024, 512], [256, 0, 128, 64]];
  assert.equal(typeof jsCtx.compute_zobrist_hash(millionBoard), 'bigint');
  assert.ok(wasmCtx.window.ai_best_move(millionBoard) >= 0);
  assert.ok(jsCtx.window.ai_best_move(millionBoard) >= 0);

  const depth4Board = [[65536, 16384, 8192, 0], [4096, 2048, 512, 128], [256, 64, 32, 16], [8, 4, 2, 0]];
  jsCtx.get_search_depth = () => 4;
  jsCtx.get_search_depth_wasm = () => 4;
  wasmCtx.get_search_depth_wasm = () => 4;

  const wDir = wasmCtx.window.ai_best_move(depth4Board);
  const jDir = jsCtx.window.ai_best_move(depth4Board);
  assert.equal(wDir, jDir);
  const wRaw = wasmCtx.window.get_directional_values().raw;
  const jRaw = jsCtx.window.get_directional_values().raw;
  for (let d = 0; d < 4; d++) {
    if (jRaw[d] === null) assert.equal(wRaw[d], null);
    else assert.ok(Math.abs(wRaw[d] - jRaw[d]) <= Math.max(1e-3, Math.abs(jRaw[d]) * 1e-12));
  }
});

test('transposition table enforces prob monotonicity without poisoning high-prob searches', () => {
  const sparse = [[2, 4, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  const { ctx: ref } = loadAiEngine({ enableWasm: false });
  const exactVal = ref.expectimax_max(sparse, 2, 1.0);

  const { ctx: tested } = loadAiEngine({ enableWasm: false });
  const lowVal = tested.expectimax_max(sparse, 2, 0.0005);
  assert.ok(Math.abs(lowVal - exactVal) > 1e-3);

  const highAfterLow = tested.expectimax_max(sparse, 2, 1.0);
  assert.equal(tested.window.get_last_search_stats().tt_hits, 0);
  assert.ok(Math.abs(highAfterLow - exactVal) < 1e-6);

  tested.expectimax_max(sparse, 2, 0.5);
  assert.equal(tested.window.get_last_search_stats().tt_hits, 1);
});

test('4-corner symmetry transformation gives invariant optimal moves across TL, TR, BL, BR in wasm and js', async () => {
  const { ctx: wasmCtx } = loadAiEngine({ enableWasm: true, allowFetch: true });
  const { ctx: jsCtx } = loadAiEngine({ enableWasm: false });
  assert.equal(await wasmCtx.window.init_wasm(), true);

  wasmCtx.get_search_depth_wasm = () => 4;
  jsCtx.get_search_depth = () => 4;

  const dirMap = [
    [0, 1, 2, 3], // corner 0: top-left
    [0, 3, 2, 1], // corner 1: top-right
    [2, 1, 0, 3], // corner 2: bottom-left
    [2, 3, 0, 1]  // corner 3: bottom-right
  ];
  const orient = (b, c) => [0, 1, 2, 3].map((r) => {
    const row = b[c >= 2 ? 3 - r : r];
    return (c === 1 || c === 3) ? [row[3], row[2], row[1], row[0]] : row.slice();
  });

  // canonical board where row 0 has [1024,512,256,0] so Right/Down vacate [0][0]
  const baseBoard = [
    [1024, 512, 256, 0],
    [64, 32, 16, 8],
    [0, 2, 2, 0],
    [0, 0, 0, 0]
  ];

  const baseWDir = wasmCtx.window.ai_best_move(baseBoard);
  const baseJDir = jsCtx.window.ai_best_move(baseBoard);
  assert.equal(baseWDir, baseJDir);
  assert.ok(baseWDir === 0 || baseWDir === 3, 'base TL board must choose anchor-preserving move');
  const baseWRaw = wasmCtx.window.get_directional_values().raw;

  for (let c = 0; c < 4; c++) {
    const rotBoard = orient(baseBoard, c);
    const wDir = wasmCtx.window.ai_best_move(rotBoard);
    const jDir = jsCtx.window.ai_best_move(rotBoard);
    const wRaw = wasmCtx.window.get_directional_values().raw;

    assert.equal(wDir, dirMap[c][baseWDir], `wasm corner ${c} best_dir mismatch`);
    assert.equal(jDir, dirMap[c][baseJDir], `js corner ${c} best_dir mismatch`);
    for (let d = 0; d < 4; d++) {
      const mapped = dirMap[c][d];
      if (baseWRaw[d] === null) assert.equal(wRaw[mapped], null);
      else assert.ok(Math.abs(wRaw[mapped] - baseWRaw[d]) <= Math.max(1e-3, Math.abs(baseWRaw[d]) * 1e-12));
    }
  }

  // explicitly check bottom-right 1024 board keeps anchor at [3][3] with positive EV instead of pulling UP
  const brBoard = orient(baseBoard, 3);
  const brDir = wasmCtx.window.ai_best_move(brBoard);
  const brStats = wasmCtx.window.get_last_search_stats();
  assert.ok(brDir === 1 || brDir === 2, `BR 1024 handoff must play Right or Down, got ${brDir}`);
  assert.ok(brStats.directional.raw[brDir] > 0, `BR 1024 best EV should be positive, got ${brStats.directional.raw[brDir]}`);
  assert.ok(brStats.directional.up < -5e9 && brStats.directional.left < -5e9, 'vacating BR corner must trigger danger penalty');
});