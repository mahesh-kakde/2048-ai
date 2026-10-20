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

// 16 cells x 17 tile exponent values (0..16)
const ZOBRIST_TABLE = [];
for (let pos = 0; pos < 16; pos++) {
  const row = [];
  for (let exp = 0; exp <= 16; exp++) {
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
      const exp = v > 0 ? (Math.round(Math.log2(v)) & 0xF) : 0;
      h ^= ZOBRIST_TABLE[idx][exp];
      idx++;
    }
  }
  return h;
}

function compute_zobrist_hash_bb(bb) {
  let h = 0n;
  let shift = 0n;
  for (let idx = 0; idx < 16; idx++) {
    const exp = Number((bb >> shift) & 0xFn);
    h ^= ZOBRIST_TABLE[idx][exp];
    shift += 4n;
  }
  return h;
}

// 131,072 entries (2^17) direct-mapped transposition table
const TT_SIZE = 131072;
const TT_MASK = 131071n;

const tt_keys = new BigUint64Array(TT_SIZE);
const tt_depths = new Int8Array(TT_SIZE);
const tt_values = new Float32Array(TT_SIZE);
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

function reset_transposition_table() {
  tt_keys.fill(0n);
  tt_depths.fill(0);
  tt_values.fill(0);
  tt_age.fill(0);
  current_search_age = 0;
  tt_hits_count = 0;
}

const EMBEDDED_WASM_B64 = "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";

let wasm_exports = null;
let wasm_ready = false;
let wasm_loading = false;

function sync_tuple_weights(weights) {
  return false;
}

async function init_wasm() {
  if (wasm_ready || wasm_loading) return;
  wasm_loading = true;
  try {
    let bytes = null;
    try {
      const response = await fetch('wasm/engine.wasm');
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
  } catch (err) {
    console.warn('wasm search engine unavailable, using javascript fallback:', err);
    wasm_ready = false;
  } finally {
    wasm_loading = false;
  }
}

if (typeof window !== 'undefined') {
  init_wasm();
}

function get_search_depth_wasm(board) {
  const empty = get_empty_cells(board).length;
  return empty <= 4 ? 6 : 5;
}

function encode_board_bitboard(board) {
  if (typeof board_to_bitboard === 'function') {
    return board_to_bitboard(board);
  }
  let bb = 0n;
  let shift = 0n;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const v = board[r][c];
      const exp = v > 0 ? BigInt(Math.round(Math.log2(v)) & 0xF) : 0n;
      bb |= (exp << shift);
      shift += 4n;
    }
  }
  return bb;
}

function rank_tile_score(r) {
  return r === 0 ? 0 : (r << r);
}

const SCORE_MAP_DESC = new Int32Array(65536);
const SCORE_MAP_ASC = new Int32Array(65536);

for (let i = 0; i < 65536; i++) {
  const c0 = i & 0xF;
  const c1 = (i >> 4) & 0xF;
  const c2 = (i >> 8) & 0xF;
  const c3 = (i >> 12) & 0xF;

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
  SCORE_MAP_DESC[i] = score_desc;

  // ascending (right to left)
  let score_asc = a3;
  score_asc += (a3 >= a2) ? (a3 + a2) : ((a3 - a2) * 12);
  if (a3 === a2 && a3 > 0) score_asc += a3;
  score_asc += (a2 >= a1) ? (a2 + a1) : ((a2 - a1) * 12);
  if (a2 === a1 && a2 > 0) score_asc += a2;
  score_asc += (a1 >= a0) ? (a1 + a0) : ((a1 - a0) * 12);
  if (a1 === a0 && a1 > 0) score_asc += a1;
  SCORE_MAP_ASC[i] = score_asc;
}

function heuristic_evaluate(board) {
  let total_score = 0;
  for (let r = 0; r < 4; r++) {
    const e0 = board[r][0] > 0 ? (Math.round(Math.log2(board[r][0])) & 0xF) : 0;
    const e1 = board[r][1] > 0 ? (Math.round(Math.log2(board[r][1])) & 0xF) : 0;
    const e2 = board[r][2] > 0 ? (Math.round(Math.log2(board[r][2])) & 0xF) : 0;
    const e3 = board[r][3] > 0 ? (Math.round(Math.log2(board[r][3])) & 0xF) : 0;
    const code = e0 | (e1 << 4) | (e2 << 8) | (e3 << 12);
    total_score += SCORE_MAP_DESC[code];
  }

  for (let c = 0; c < 4; c++) {
    const e0 = board[0][c] > 0 ? (Math.round(Math.log2(board[0][c])) & 0xF) : 0;
    const e1 = board[1][c] > 0 ? (Math.round(Math.log2(board[1][c])) & 0xF) : 0;
    const e2 = board[2][c] > 0 ? (Math.round(Math.log2(board[2][c])) & 0xF) : 0;
    const e3 = board[3][c] > 0 ? (Math.round(Math.log2(board[3][c])) & 0xF) : 0;
    const code = e0 | (e1 << 4) | (e2 << 8) | (e3 << 12);
    total_score += SCORE_MAP_DESC[code];
  }

  return total_score;
}

function evaluate_board(board) {
  return heuristic_evaluate(board);
}

function get_search_depth(board) {
  const empty = get_empty_cells(board).length;
  return empty <= 4 ? 4 : 3;
}

const ANCHOR_PENALTY = 1e7;

function expectimax_max(board, depth, prob) {
  if (depth <= 0 || is_game_over(board)) {
    nodes_evaluated++;
    return evaluate_board(board);
  }

  const hash = compute_zobrist_hash(board);
  const tt_idx = Number(hash & TT_MASK);

  if (tt_keys[tt_idx] === hash && tt_depths[tt_idx] >= depth) {
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
    if (depth >= tt_depths[tt_idx]) {
      tt_depths[tt_idx] = depth;
      tt_values[tt_idx] = final_val;
      tt_age[tt_idx] = current_search_age;
    }
  } else if (tt_age[tt_idx] !== current_search_age || depth >= tt_depths[tt_idx]) {
    tt_keys[tt_idx] = hash;
    tt_depths[tt_idx] = depth;
    tt_values[tt_idx] = final_val;
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

  return weight_sum > 0 ? (avg / weight_sum) : evaluate_board(board);
}

function expectimax(board, depth, is_max_node, prob) {
  if (is_max_node) return expectimax_max(board, depth, prob);
  return expectimax_chance(board, depth, prob);
}

function ai_best_move(board) {
  const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  nodes_evaluated = 0;
  tt_hits_count = 0;
  current_search_age = (current_search_age + 1) & 0xFF;

  // 1. wasm expectimax search (depth 5-6)
  if (wasm_ready && wasm_exports) {
    const search_depth = get_search_depth_wasm(board);
    last_search_depth = search_depth;
    const bb = encode_board_bitboard(board);

    let best_dir = -1;
    try {
      best_dir = wasm_exports.wasm_search(bb, search_depth);
    } catch (_) {
      const low = Number(bb & 0xFFFFFFFFn) >>> 0;
      const high = Number((bb >> 32n) & 0xFFFFFFFFn) >>> 0;
      best_dir = wasm_exports.wasm_search_parts(low, high, search_depth);
    }

    nodes_evaluated = wasm_exports.wasm_get_nodes ? wasm_exports.wasm_get_nodes() : 0;
    tt_hits_count = wasm_exports.wasm_get_tt_hits ? wasm_exports.wasm_get_tt_hits() : 0;

    const dir_values = [null, null, null, null];
    for (let d = 0; d < 4; d++) {
      const v = wasm_exports.wasm_get_dir_val ? wasm_exports.wasm_get_dir_val(d) : -1e9;
      dir_values[d] = v < -1e8 ? null : v;
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

  // 3. fallback to expectimax search during open-board phases
  const search_depth = get_search_depth(board);
  last_search_depth = search_depth;

  let best_dir = -1;
  let best_val = -Infinity;
  const dir_values = [null, null, null, null];

  const search_dirs = [0, 3, 1, 2];
  for (let i = 0; i < 4; i++) {
    const dir = search_dirs[i];
    const result = move(board, dir);
    if (!result.moved) {
      dir_values[dir] = null;
      continue;
    }

    const is_violation = (typeof check_anchor_violation === 'function') && check_anchor_violation(board, result.board);
    const penalty = is_violation ? -ANCHOR_PENALTY : 0;

    const val = penalty + expectimax_chance(result.board, search_depth - 1, 1.0);
    dir_values[dir] = val;

    if (val > best_val) {
      best_val = val;
      best_dir = dir;
    }
  }

  last_directional_telemetry = {
    up: dir_values[0],
    right: dir_values[1],
    down: dir_values[2],
    left: dir_values[3],
    best_dir: best_dir,
    raw: [dir_values[0], dir_values[1], dir_values[2], dir_values[3]],
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
    init_wasm,
    sync_tuple_weights
  };
}