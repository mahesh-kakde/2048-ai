const PROB_THRESHOLD = 0.0001;

let nodes_evaluated = 0;
let last_move_time_ms = 0;
let last_search_depth = 2;

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

      // smoothness: penalize difference with right and down neighbors
      if (c < 3 && board[r][c + 1] !== 0)
        smooth -= Math.abs(log_v - Math.log2(board[r][c + 1]));
      if (r < 3 && board[r + 1][c] !== 0)
        smooth -= Math.abs(log_v - Math.log2(board[r + 1][c]));
    }
  }

  // monotonicity: check if rows/cols are sorted (ascending or descending)
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

  // corner bonus: reward max tile in a corner
  const corners = [board[0][0], board[0][3], board[3][0], board[3][3]];
  const corner = corners.includes(max_val) ? Math.log2(max_val) : 0;

  return (empty * 2.7) + (mono * 1.0) + (smooth * 0.1) + (corner * 1.0);
}

function get_search_depth(board) {
  // adaptive search: depth 2 during open boards, depth 3 during tight tactical phases
  const empty = get_empty_cells(board).length;
  return empty <= 5 ? 3 : 2;
}

function expectimax(board, depth, is_max_node, prob) {
  if (depth === 0 || is_game_over(board)) {
    nodes_evaluated++;
    return heuristic_evaluate(board);
  }

  if (is_max_node) {
    let best = -Infinity;
    for (let dir = 0; dir < 4; dir++) {
      const result = move(board, dir);
      if (!result.moved) continue;
      const val = expectimax(result.board, depth - 1, false, prob);
      if (val > best) best = val;
    }
    return best === -Infinity ? heuristic_evaluate(board) : best;
  }

  // chance node
  const empty = get_empty_cells(board);
  if (empty.length === 0) {
    nodes_evaluated++;
    return heuristic_evaluate(board);
  }

  let avg = 0;
  const cell_prob = prob / empty.length;

  for (const [r, c] of empty) {
    for (const [val, tile_prob] of [[2, 0.9], [4, 0.1]]) {
      const branch_prob = cell_prob * tile_prob;
      if (branch_prob < PROB_THRESHOLD) continue;

      const b = clone(board);
      b[r][c] = val;
      avg += tile_prob * expectimax(b, depth - 1, true, branch_prob);
    }
  }

  return avg / empty.length;
}

function ai_best_move(board) {
  const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  nodes_evaluated = 0;
  const search_depth = get_search_depth(board);
  last_search_depth = search_depth;

  let best_dir = -1;
  let best_val = -Infinity;

  for (let dir = 0; dir < 4; dir++) {
    const result = move(board, dir);
    if (!result.moved) continue;
    const val = result.score + expectimax(result.board, search_depth - 1, false, 1.0);
    if (val > best_val) {
      best_val = val;
      best_dir = dir;
    }
  }

  const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  last_move_time_ms = t1 - t0;
  return best_dir;
}

function get_last_search_stats() {
  return {
    depth: last_search_depth,
    time_ms: last_move_time_ms,
    nodes: nodes_evaluated
  };
}