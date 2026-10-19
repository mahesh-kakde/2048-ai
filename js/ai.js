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

function heuristic_evaluate(board) {
  let empty = 0;
  let max_val = 0;
  let mono = 0;
  let smooth = 0;

  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const v = board[r][c];
      if (v === 0) { empty++; continue; }
      const log_v = Math.log2(v);
      if (v > max_val) max_val = v;

      if (c < 3 && board[r][c + 1] !== 0)
        smooth -= Math.abs(log_v - Math.log2(board[r][c + 1]));
      if (r < 3 && board[r + 1][c] !== 0)
        smooth -= Math.abs(log_v - Math.log2(board[r + 1][c]));
    }
  }

  for (let r = 0; r < 4; r++) {
    let inc = 0, dec = 0;
    for (let c = 0; c < 3; c++) {
      const cur = board[r][c] === 0 ? 0 : Math.log2(board[r][c]);
      const nxt = board[r][c + 1] === 0 ? 0 : Math.log2(board[r][c + 1]);
      if (cur > nxt) dec += nxt - cur;
      else inc += cur - nxt;
    }
    mono += Math.max(inc, dec);
  }
  for (let c = 0; c < 4; c++) {
    let inc = 0, dec = 0;
    for (let r = 0; r < 3; r++) {
      const cur = board[r][c] === 0 ? 0 : Math.log2(board[r][c]);
      const nxt = board[r + 1][c] === 0 ? 0 : Math.log2(board[r + 1][c]);
      if (cur > nxt) dec += nxt - cur;
      else inc += cur - nxt;
    }
    mono += Math.max(inc, dec);
  }

  const corners = [board[0][0], board[0][3], board[3][0], board[3][3]];
  const corner = corners.includes(max_val) ? Math.log2(max_val) : 0;

  return (empty * 2.7) + (mono * 1.0) + (smooth * 0.1) + (corner * 1.0);
}

function evaluate_board(board) {
  if (typeof NN !== 'undefined' && NN.is_ready && NN.is_ready()) {
    return NN.tuple_evaluate(board);
  }
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

  for (let dir = 0; dir < 4; dir++) {
    const res = move(board, dir);
    if (!res.moved) continue;
    has_valid_move = true;

    const penalty = (typeof check_anchor_violation === 'function' && check_anchor_violation(board, res.board)) ? -ANCHOR_PENALTY : 0;
    const val = res.score + penalty + expectimax_chance(res.board, depth - 1, prob);
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

  // 1. hybrid arbitrator: query perimeter defense tablebase first
  if (typeof Tablebase !== 'undefined' && Tablebase.is_ready()) {
    const tb = Tablebase.query_any(board);
    if (tb && tb.matched) {
      const tb_sim = move(board, tb.move);
      if (tb_sim.moved) {
        const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        last_move_time_ms = t1 - t0;
        last_search_depth = 'tablebase';

        const dir_values = [null, null, null, null];
        for (let d = 0; d < 4; d++) {
          const res = move(board, d);
          if (!res.moved) {
            dir_values[d] = null;
          } else if (d === tb.move) {
            dir_values[d] = 'pdf-' + tb.target_tile;
          } else {
            const is_violation = (typeof check_anchor_violation === 'function') && check_anchor_violation(board, res.board);
            dir_values[d] = is_violation ? -ANCHOR_PENALTY : 'tactical';
          }
        }

        last_directional_telemetry = {
          up: dir_values[0],
          right: dir_values[1],
          down: dir_values[2],
          left: dir_values[3],
          best_dir: tb.move,
          raw: dir_values,
          source: 'pdf-' + tb.target_tile,
          target_tile: tb.target_tile
        };

        return tb.move;
      }
    }
  }

  // 2. fallback to expectimax search during open-board phases
  const search_depth = get_search_depth(board);
  last_search_depth = search_depth;

  let best_dir = -1;
  let best_val = -Infinity;
  const dir_values = [null, null, null, null];

  for (let dir = 0; dir < 4; dir++) {
    const result = move(board, dir);
    if (!result.moved) {
      dir_values[dir] = null;
      continue;
    }

    const is_violation = (typeof check_anchor_violation === 'function') && check_anchor_violation(board, result.board);
    const penalty = is_violation ? -ANCHOR_PENALTY : 0;

    const val = result.score + penalty + expectimax_chance(result.board, search_depth - 1, 1.0);
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