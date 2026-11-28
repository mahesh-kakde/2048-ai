const PROB_THRESHOLD = 0.0001;

// deterministic splitmix64 prng for 64-bit zobrist table generation
let prng_seed = 0x853c49e6748fea9bn;
function splitmix64() {
  prng_seed = (prng_seed + 0x9e3779b97f4a7c15n) & 0xFFFFFFFFFFFFFFFFn;
  let z = prng_seed;
  z = (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n & 0xFFFFFFFFFFFFFFFFn;
  z = (z ^ (z >> 27n)) * 0x94d049bb133111ebn & 0xFFFFFFFFFFFFFFFFn;
  return (z ^ (z >> 31n)) & 0xFFFFFFFFFFFFFFFFn;
}

const MAX_ZOBRIST_EXP = 32;

// 16 cells x 32 tile exponent values (0..31)
const ZOBRIST_TABLE = [];
for (let pos = 0; pos < 16; pos++) {
  const row = [];
  for (let exp = 0; exp < MAX_ZOBRIST_EXP; exp++) {
    row.push(splitmix64());
  }
  ZOBRIST_TABLE.push(row);
}

function compute_zobrist_hash(board) {
  let h = 0n;
  let idx = 0;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const v = board[r][c];
      let exp = v > 0 ? Math.round(Math.log2(v)) : 0;
      if (exp < 0) exp = 0;
      if (exp >= MAX_ZOBRIST_EXP) exp = MAX_ZOBRIST_EXP - 1;
      h ^= ZOBRIST_TABLE[idx][exp];
      idx++;
    }
  }
  return h;
}

// 131,072 entries (2^17) direct-mapped transposition table
const TT_SIZE = 131072;
const TT_MASK = 131071n;

const tt_keys = new BigUint64Array(TT_SIZE);
const tt_depths = new Int8Array(TT_SIZE);
const tt_values = new Float64Array(TT_SIZE);
const tt_probs = new Float32Array(TT_SIZE);
const tt_age = new Uint8Array(TT_SIZE);

let current_search_age = 0;
let tt_hits_count = 0;
let nodes_evaluated = 0;
let last_move_time_ms = 0;
let last_search_depth = 3;

let last_directional_telemetry = {
  up: null,
  right: null,
  down: null,
  left: null,
  best_dir: -1,
  raw: [null, null, null, null]
};

const EMBEDDED_WASM_B64 = "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AwF/An4BfCOAgICAAEEgayIAJICAgIAAAkBBAC0AkKGAgwANABCAgICAABoLIABBACkDoKGAgwAiATcDECAAQQApA6ihgIMAIgI3AxggACABNwMAIAAgAjcDCCAAEIWAgIAAIQMgAEEgaiSAgICAACADC5kCAgF/AX4jgICAgABBIGsiAiSAgICAACACIABCIIhCD4MgAEIciEKAHoOEIABCGIhCgIA8g4QgAEIUiEKAgID4AIOEIABCEIhCgICAgPABg4QgAEIMiEKAgICAgOADg4QgAEIIiEKAgICAgIDAB4OEIABCBIhCgICAgICAgIAPg4QiAzcDGCACIABCBIZCgB6DIABCD4OEIABCCIZCgIA8g4QgAEIMhkKAgID4AIOEIABCEIZCgICAgPABg4QgAEIUhkKAgICAgOADg4QgAEIYhkKAgICAgIDAB4OEIABCHIZCgICAgICAgIAPg4QiADcDECACIAA3AwAgAiADNwMIIAIgARCEgICAACEBIAJBIGokgICAgAAgAQuxAgMBfwJ+AXwjgICAgABBIGsiAiSAgICAAAJAQQAtAJChgIMADQAQgICAgAAaCyACIAGtIgNCBIZCgB6DIANCD4OEIANCCIZCgIA8g4QgA0IMhkKAgID4AIOEIANCEIZCgICAgPABg4QgA0IUhkKAgICAgOADg4QgA0IYhkKAgICAgIDAB4OEIANCHIZCgICAgICAgIAPg4QiBDcDGCACIACtIgNCBIZCgB6DIANCD4OEIANCCIZCgIA8g4QgA0IMhkKAgID4AIOEIANCEIZCgICAgPABg4QgA0IUhkKAgICAgOADg4QgA0IYhkKAgICAgIDAB4OEIANCHIZCgICAgICAgIAPg4QiAzcDECACIAM3AwAgAiAENwMIIAIQhYCAgAAhBSACQSBqJICAgIAAIAULnAICAX8CfiOAgICAAEEgayIDJICAgIAAIAMgAa0iBEIEhkKAHoMgBEIPg4QgBEIIhkKAgDyDhCAEQgyGQoCAgPgAg4QgBEIQhkKAgICA8AGDhCAEQhSGQoCAgICA4AODhCAEQhiGQoCAgICAgMAHg4QgBEIchkKAgICAgICAgA+DhCIFNwMYIAMgAK0iBEIEhkKAHoMgBEIPg4QgBEIIhkKAgDyDhCAEQgyGQoCAgPgAg4QgBEIQhkKAgICA8AGDhCAE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";

const WASM_BINARY_PATH = 'wasm/engine.a528e904.wasm';

let wasm_exports = null;
let wasm_ready = false;
let wasm_init_promise = null;

async function init_wasm() {
  if (wasm_ready) return true;
  if (wasm_init_promise) return wasm_init_promise;

  wasm_init_promise = (async () => {
    try {
      let bytes = null;
      try {
        const response = await fetch(WASM_BINARY_PATH);
        if (response.ok) {
          bytes = await response.arrayBuffer();
        }
      } catch (_) {}

      if (!bytes && typeof EMBEDDED_WASM_B64 === 'string' && EMBEDDED_WASM_B64.length > 0) {
        const bin_str = atob(EMBEDDED_WASM_B64);
        const len = bin_str.length;
        const u8 = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          u8[i] = bin_str.charCodeAt(i);
        }
        bytes = u8.buffer;
      }

      if (!bytes) {
        throw new Error('wasm binary not available');
      }

      const { instance } = await WebAssembly.instantiate(bytes, {});
      wasm_exports = instance.exports;
      if (wasm_exports.wasm_init) {
        wasm_exports.wasm_init();
      }
      wasm_ready = true;
      return true;
    } catch (err) {
      console.warn('wasm search engine unavailable, using javascript fallback:', err);
      wasm_ready = false;
      return false;
    }
  })();

  return wasm_init_promise;
}

if (typeof window !== 'undefined') {
  init_wasm();
}

function get_search_depth_wasm(board) {
  const empty = get_empty_cells(board).length;
  return empty <= 4 ? 6 : 5;
}

function rank_tile_score(r) {
  return r === 0 ? 0 : (r * Math.pow(2, r));
}

function eval_line_exps(c0, c1, c2, c3) {
  const a0 = rank_tile_score(c0);
  const a1 = rank_tile_score(c1);
  const a2 = rank_tile_score(c2);
  const a3 = rank_tile_score(c3);

  // descending (left to right)
  let score_desc = a0;
  score_desc += (a0 >= a1) ? (a0 + a1) : ((a0 - a1) * 12);
  if (a0 === a1 && a0 > 0) score_desc += a0;
  score_desc += (a1 >= a2) ? (a1 + a2) : ((a1 - a2) * 12);
  if (a1 === a2 && a1 > 0) score_desc += a1;
  score_desc += (a2 >= a3) ? (a2 + a3) : ((a2 - a3) * 12);
  if (a2 === a3 && a2 > 0) score_desc += a2;
  return score_desc;
}

const SCORE_MAP_DESC = new Float64Array(65536);

for (let i = 0; i < 65536; i++) {
  SCORE_MAP_DESC[i] = eval_line_exps(i & 0xF, (i >> 4) & 0xF, (i >> 8) & 0xF, (i >> 12) & 0xF);
}

function cell_exp(v) {
  return v > 0 ? Math.round(Math.log2(v)) : 0;
}

function eval_line_fast(e0, e1, e2, e3) {
  const mask = e0 | e1 | e2 | e3;
  if (mask >= 0 && mask < 16) {
    return SCORE_MAP_DESC[e0 | (e1 << 4) | (e2 << 8) | (e3 << 12)];
  }
  return eval_line_exps(e0, e1, e2, e3);
}

function evaluate_board(board) {
  let total_score = 0;
  for (let r = 0; r < 4; r++) {
    total_score += eval_line_fast(
      cell_exp(board[r][0]),
      cell_exp(board[r][1]),
      cell_exp(board[r][2]),
      cell_exp(board[r][3])
    );
  }

  for (let c = 0; c < 4; c++) {
    total_score += eval_line_fast(
      cell_exp(board[0][c]),
      cell_exp(board[1][c]),
      cell_exp(board[2][c]),
      cell_exp(board[3][c])
    );
  }

  return total_score;
}

function get_search_depth(board) {
  const empty = get_empty_cells(board).length;
  return empty <= 4 ? 4 : 3;
}

const ANCHOR_PENALTY = 1e10;

function expectimax_max(board, depth, prob) {
  if (depth <= 0 || is_game_over(board)) {
    nodes_evaluated++;
    return evaluate_board(board);
  }

  const hash = compute_zobrist_hash(board);
  const tt_idx = Number(hash & TT_MASK);

  if (tt_keys[tt_idx] === hash && tt_depths[tt_idx] >= depth && tt_probs[tt_idx] >= prob * (1.0 - 1e-6)) {
    tt_hits_count++;
    return tt_values[tt_idx];
  }

  let best = -Infinity;
  let has_valid_move = false;

  const search_dirs = [0, 3, 1, 2];
  for (let i = 0; i < 4; i++) {
    const dir = search_dirs[i];
    const res = move(board, dir);
    if (!res.moved) continue;
    has_valid_move = true;

    const penalty = (typeof check_anchor_violation === 'function' && check_anchor_violation(board, res.board)) ? -ANCHOR_PENALTY : 0;
    const val = penalty + expectimax_chance(res.board, depth - 1, prob);
    if (val > best) best = val;
  }

  const final_val = has_valid_move ? best : evaluate_board(board);

  if (tt_keys[tt_idx] === hash) {
    if (depth > tt_depths[tt_idx] || (depth === tt_depths[tt_idx] && prob > tt_probs[tt_idx])) {
      tt_depths[tt_idx] = depth;
      tt_values[tt_idx] = final_val;
      tt_probs[tt_idx] = prob;
      tt_age[tt_idx] = current_search_age;
    }
  } else if (tt_age[tt_idx] !== current_search_age || depth >= tt_depths[tt_idx]) {
    tt_keys[tt_idx] = hash;
    tt_depths[tt_idx] = depth;
    tt_values[tt_idx] = final_val;
    tt_probs[tt_idx] = prob;
    tt_age[tt_idx] = current_search_age;
  }

  return final_val;
}

function expectimax_chance(board, depth, prob) {
  const empty = get_empty_cells(board);
  if (empty.length === 0) {
    nodes_evaluated++;
    return evaluate_board(board);
  }

  let avg = 0.0;
  let weight_sum = 0.0;
  const cell_prob = prob / empty.length;

  for (let i = 0; i < empty.length; i++) {
    const [r, c] = empty[i];
    for (let t = 0; t < 2; t++) {
      const val = t === 0 ? 2 : 4;
      const tile_prob = t === 0 ? 0.9 : 0.1;
      const branch_prob = cell_prob * tile_prob;
      if (branch_prob < PROB_THRESHOLD) continue;

      const b = clone(board);
      b[r][c] = val;
      const child_val = expectimax_max(b, depth, branch_prob);
      avg += tile_prob * child_val;
      weight_sum += tile_prob;
    }
  }

  if (weight_sum > 0) return avg / weight_sum;
  nodes_evaluated++;
  return evaluate_board(board);
}

const CORNER_DIR_MAP = [
  [0, 1, 2, 3],
  [0, 3, 2, 1],
  [2, 1, 0, 3],
  [2, 3, 0, 1]
];

function orient_board(board, corner) {
  if (corner === 0) return board;
  const out = new Array(4);
  for (let r = 0; r < 4; r++) {
    const sr = (corner >= 2) ? (3 - r) : r;
    const src_row = board[sr];
    if (corner === 1 || corner === 3) {
      out[r] = [src_row[3], src_row[2], src_row[1], src_row[0]];
    } else {
      out[r] = [src_row[0], src_row[1], src_row[2], src_row[3]];
    }
  }
  return out;
}

function choose_anchor_corner(board) {
  const corners = [
    cell_exp(board[0][0]),
    cell_exp(board[0][3]),
    cell_exp(board[3][0]),
    cell_exp(board[3][3])
  ];
  let max_c = corners[0];
  for (let i = 1; i < 4; i++) {
    if (corners[i] > max_c) max_c = corners[i];
  }
  if (max_c < 6) return 0;

  let best_corner = 0;
  let best_eval = -Infinity;
  for (let c = 0; c < 4; c++) {
    if (corners[c] === max_c) {
      const ev = evaluate_board(orient_board(board, c));
      if (ev > best_eval) {
        best_eval = ev;
        best_corner = c;
      }
    }
  }
  return best_corner;
}

function ai_best_move(board) {
  const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  nodes_evaluated = 0;
  tt_hits_count = 0;
  current_search_age = (current_search_age + 1) & 0xFF;

  // 1. wasm expectimax search (depth 5-6)
  if (wasm_ready && wasm_exports && wasm_exports.wasm_get_board_ptr && wasm_exports.wasm_search_buf && wasm_exports.memory) {
    const search_depth = get_search_depth_wasm(board);
    last_search_depth = search_depth;

    const ptr = wasm_exports.wasm_get_board_ptr();
    const buf = new Uint8Array(wasm_exports.memory.buffer, ptr, 16);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        buf[r * 4 + c] = cell_exp(board[r][c]);
      }
    }

    const best_dir = wasm_exports.wasm_search_buf(search_depth);

    nodes_evaluated = wasm_exports.wasm_get_nodes ? wasm_exports.wasm_get_nodes() : 0;
    tt_hits_count = wasm_exports.wasm_get_tt_hits ? wasm_exports.wasm_get_tt_hits() : 0;

    const dir_values = [null, null, null, null];
    for (let d = 0; d < 4; d++) {
      const valid = wasm_exports.wasm_is_dir_valid
        ? wasm_exports.wasm_is_dir_valid(d) !== 0
        : (wasm_exports.wasm_get_dir_val ? wasm_exports.wasm_get_dir_val(d) > -1e15 : false);
      dir_values[d] = (valid && wasm_exports.wasm_get_dir_val) ? wasm_exports.wasm_get_dir_val(d) : null;
    }

    last_directional_telemetry = {
      up: dir_values[0],
      right: dir_values[1],
      down: dir_values[2],
      left: dir_values[3],
      best_dir: best_dir,
      raw: dir_values,
      source: 'wasm-expectimax'
    };

    const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    last_move_time_ms = t1 - t0;
    return best_dir;
  }

  // fallback to javascript expectimax search
  const search_depth = get_search_depth(board);
  last_search_depth = search_depth;

  const corner = choose_anchor_corner(board);
  const canon_board = orient_board(board, corner);
  const dir_map = CORNER_DIR_MAP[corner];

  let best_dir = -1;
  let best_val = -Infinity;
  const dir_values = [null, null, null, null];

  const search_dirs = [0, 3, 1, 2];
  for (let i = 0; i < 4; i++) {
    const canon_dir = search_dirs[i];
    const orig_dir = dir_map[canon_dir];
    const result = move(canon_board, canon_dir);
    if (!result.moved) {
      dir_values[orig_dir] = null;
      continue;
    }

    const is_violation = (typeof check_anchor_violation === 'function') && check_anchor_violation(canon_board, result.board);
    const penalty = is_violation ? -ANCHOR_PENALTY : 0;

    const val = penalty + expectimax_chance(result.board, search_depth - 1, 1.0);
    dir_values[orig_dir] = val;

    if (val > best_val) {
      best_val = val;
      best_dir = orig_dir;
    }
  }

  last_directional_telemetry = {
    up: dir_values[0],
    right: dir_values[1],
    down: dir_values[2],
    left: dir_values[3],
    best_dir: best_dir,
    raw: dir_values,
    source: 'expectimax'
  };

  const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  last_move_time_ms = t1 - t0;
  return best_dir;
}

function get_directional_values() {
  return last_directional_telemetry;
}

function get_last_search_stats() {
  return {
    depth: last_search_depth,
    time_ms: last_move_time_ms,
    nodes: nodes_evaluated,
    tt_hits: tt_hits_count,
    directional: last_directional_telemetry,
    source: last_directional_telemetry.source || 'expectimax'
  };
}

if (typeof window !== 'undefined') {
  window.ai_best_move = ai_best_move;
  window.get_directional_values = get_directional_values;
  window.get_last_search_stats = get_last_search_stats;
  window.init_wasm = init_wasm;
  window.AI = {
    best_move: ai_best_move,
    get_stats: get_last_search_stats,
    is_wasm_ready: () => wasm_ready,
    init_wasm
  };
}