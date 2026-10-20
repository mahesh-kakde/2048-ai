function clone(board) {
  return board.map(row => [...row]);
}

function get_empty_cells(board) {
  const cells = [];
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      if (board[r][c] === 0) cells.push([r, c]);
  return cells;
}

function spawn(board) {
  const b = clone(board);
  const empty = get_empty_cells(b);
  if (empty.length === 0) return { board: b, pos: null };
  const [r, c] = empty[Math.floor(Math.random() * empty.length)];
  b[r][c] = Math.random() < 0.9 ? 2 : 4;
  return { board: b, pos: [r, c] };
}

// slides a single row left, merging tiles. returns { row, score }
function slide_row(row) {
  let score = 0;

  // compact: remove zeros, push values left
  let vals = row.filter(v => v !== 0);

  // merge adjacent equal tiles (left to right, each tile merges at most once)
  for (let i = 0; i < vals.length - 1; i++) {
    if (vals[i] === vals[i + 1]) {
      vals[i] *= 2;
      score += vals[i];
      vals.splice(i + 1, 1);
    }
  }

  // pad with zeros on the right
  while (vals.length < 4) vals.push(0);
  return { row: vals, score };
}

function move(board, direction) {
  const b = clone(board);
  let score = 0;
  let moved = false;

  for (let i = 0; i < 4; i++) {
    let row;

    // extract the row/col as a left-aligned array based on direction
    if (direction === 0)      row = [b[0][i], b[1][i], b[2][i], b[3][i]]; // up: column top-to-bottom
    else if (direction === 1) row = [b[i][3], b[i][2], b[i][1], b[i][0]]; // right: row reversed
    else if (direction === 2) row = [b[3][i], b[2][i], b[1][i], b[0][i]]; // down: column bottom-to-top
    else                      row = [b[i][0], b[i][1], b[i][2], b[i][3]]; // left: row as-is

    const result = slide_row(row);
    score += result.score;

    // write the slid row back into the board
    for (let j = 0; j < 4; j++) {
      let r, c;
      if (direction === 0)      { r = j; c = i; }
      else if (direction === 1) { r = i; c = 3 - j; }
      else if (direction === 2) { r = 3 - j; c = i; }
      else                      { r = i; c = j; }

      if (b[r][c] !== result.row[j]) moved = true;
      b[r][c] = result.row[j];
    }
  }

  return { board: b, score, moved };
}

function is_game_over(board) {
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      if (board[r][c] === 0) return false;
      if (c < 3 && board[r][c] === board[r][c + 1]) return false;
      if (r < 3 && board[r][c] === board[r + 1][c]) return false;
    }
  return true;
}

function create_board() {
  const board = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0]
  ];
  const s1 = spawn(board);
  const s2 = spawn(s1.board);
  return s2.board;
}

// bitboard utilities (64-bit bigint, 4 bits per cell exponent)
function board_to_bitboard(board) {
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

function bitboard_to_board(bb) {
  const board = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0]
  ];
  let shift = 0n;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const exp = Number((bb >> shift) & 0xFn);
      board[r][c] = exp > 0 ? (1 << exp) : 0;
      shift += 4n;
    }
  }
  return board;
}

function bitboard_get_tile(bb, r, c) {
  const shift = BigInt((r * 4 + c) * 4);
  const exp = Number((bb >> shift) & 0xFn);
  return exp > 0 ? (1 << exp) : 0;
}

// checks if a move vacates or reduces an established top-left corner anchor tile
function check_anchor_violation(old_board, new_board) {
  const old_corner = old_board[0][0];
  const new_corner = new_board[0][0];
  if (old_corner >= 64 && new_corner < old_corner) {
    return true;
  }
  return false;
}