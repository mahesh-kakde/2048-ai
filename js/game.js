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

const LINE_COORDS = [0, 1, 2, 3].map(dir =>
  [0, 1, 2, 3].map(i => {
    const coords = [];
    for (let j = 0; j < 4; j++) {
      if (dir === 0)      coords.push([j, i]);
      else if (dir === 1) coords.push([i, 3 - j]);
      else if (dir === 2) coords.push([3 - j, i]);
      else                coords.push([i, j]);
    }
    return coords;
  })
);

function move(board, direction) {
  const b = clone(board);
  let score = 0;
  let moved = false;
  const lines = LINE_COORDS[direction];

  for (let i = 0; i < 4; i++) {
    const coords = lines[i];
    const row = [
      b[coords[0][0]][coords[0][1]],
      b[coords[1][0]][coords[1][1]],
      b[coords[2][0]][coords[2][1]],
      b[coords[3][0]][coords[3][1]]
    ];

    const result = slide_row(row);
    score += result.score;

    for (let j = 0; j < 4; j++) {
      const [r, c] = coords[j];
      if (b[r][c] !== result.row[j]) moved = true;
      b[r][c] = result.row[j];
    }
  }

  return { board: b, score, moved };
}

function trace_move(board, direction) {
  const b = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0]
  ];
  let score = 0;
  let moved = false;
  const movements = [];
  const merges = [];
  const lines = LINE_COORDS[direction];

  for (let i = 0; i < 4; i++) {
    const coords = lines[i];
    const items = [];
    for (let j = 0; j < 4; j++) {
      const [r, c] = coords[j];
      const v = board[r][c];
      if (v !== 0) items.push({ r, c, value: v });
    }

    let out_idx = 0;
    let k = 0;
    while (k < items.length) {
      const [dr, dc] = coords[out_idx];
      if (k + 1 < items.length && items[k].value === items[k + 1].value) {
        const merged_val = items[k].value * 2;
        b[dr][dc] = merged_val;
        score += merged_val;
        moved = true;
        movements.push({ from: [items[k].r, items[k].c], to: [dr, dc], value: items[k].value, merged: true });
        movements.push({ from: [items[k + 1].r, items[k + 1].c], to: [dr, dc], value: items[k + 1].value, merged: true });
        merges.push([dr, dc]);
        k += 2;
      } else {
        b[dr][dc] = items[k].value;
        if (items[k].r !== dr || items[k].c !== dc) moved = true;
        movements.push({ from: [items[k].r, items[k].c], to: [dr, dc], value: items[k].value, merged: false });
        k += 1;
      }
      out_idx++;
    }
  }

  return { board: b, score, moved, movements, merges };
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

// checks if a move vacates or reduces an established top-left corner anchor tile
function check_anchor_violation(old_board, new_board) {
  const old_corner = old_board[0][0];
  const new_corner = new_board[0][0];
  if (old_corner >= 64 && new_corner < old_corner) {
    return true;
  }
  return false;
}