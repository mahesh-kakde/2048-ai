const Tuple = (() => {
  // four base 5-tuple patterns capturing corner stability, monotonicity, and clusters
  const BASE_TUPLES = [
    [0, 1, 2, 3, 4], // top row + corner support tile
    [0, 1, 4, 5, 2], // corner 2x2 + right extension
    [0, 1, 4, 5, 8], // corner 2x2 + down extension
    [0, 1, 2, 4, 8]  // corner L-corridor
  ];

  // d4 dihedral symmetry permutations for a 4x4 grid (0..15)
  // 0: identity, 1: rot90, 2: rot180, 3: rot270
  // 4: horiz-flip, 5: vert-flip, 6: main-diag-flip, 7: anti-diag-flip
  const SYMMETRIES = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    [3, 7, 11, 15, 2, 6, 10, 14, 1, 5, 9, 13, 0, 4, 8, 12],
    [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
    [12, 8, 4, 0, 13, 9, 5, 1, 14, 10, 6, 2, 15, 11, 7, 3],
    [3, 2, 1, 0, 7, 6, 5, 4, 11, 10, 9, 8, 15, 14, 13, 12],
    [12, 13, 14, 15, 8, 9, 10, 11, 4, 5, 6, 7, 0, 1, 2, 3],
    [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15],
    [15, 11, 7, 3, 14, 10, 6, 2, 13, 9, 5, 1, 12, 8, 4, 0]
  ];

  // precompute all 32 expanded symmetric tuples (4 base patterns x 8 symmetries)
  const EXPANDED_TUPLES = [];
  for (let b = 0; b < BASE_TUPLES.length; b++) {
    const base = BASE_TUPLES[b];
    for (let s = 0; s < 8; s++) {
      const sym = SYMMETRIES[s];
      EXPANDED_TUPLES.push({
        base_id: b,
        c0: sym[base[0]],
        c1: sym[base[1]],
        c2: sym[base[2]],
        c3: sym[base[3]],
        c4: sym[base[4]]
      });
    }
  }

  const NUM_BASE_TUPLES = BASE_TUPLES.length;
  const TUPLE_SIZE = 5;
  const ENTRIES_PER_TUPLE = 1048576; // 16^5
  const TOTAL_WEIGHTS = NUM_BASE_TUPLES * ENTRIES_PER_TUPLE;

  // reusable scratch buffers for zero-allocation extraction
  const powers_buf = new Uint8Array(16);
  const default_indices_buf = new Uint32Array(32);

  function board_to_powers(board, target_buf) {
    let idx = 0;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const v = board[r][c];
        target_buf[idx++] = v > 0 ? (Math.round(Math.log2(v)) & 0xF) : 0;
      }
    }
  }

  function bitboard_to_powers(bb, target_buf) {
    let shift = 0n;
    for (let i = 0; i < 16; i++) {
      target_buf[i] = Number((bb >> shift) & 0xFn);
      shift += 4n;
    }
  }

  // extracts 32 tuple lookup indices from a 4x4 array board
  function extract_indices(board, out_buf = default_indices_buf) {
    board_to_powers(board, powers_buf);
    for (let i = 0; i < 32; i++) {
      const t = EXPANDED_TUPLES[i];
      out_buf[i] = ((powers_buf[t.c0] << 16) |
                    (powers_buf[t.c1] << 12) |
                    (powers_buf[t.c2] << 8)  |
                    (powers_buf[t.c3] << 4)  |
                    powers_buf[t.c4]) >>> 0;
    }
    return out_buf;
  }

  // extracts 32 tuple lookup indices from a 64-bit bigint bitboard
  function extract_indices_bitboard(bb, out_buf = default_indices_buf) {
    bitboard_to_powers(bb, powers_buf);
    for (let i = 0; i < 32; i++) {
      const t = EXPANDED_TUPLES[i];
      out_buf[i] = ((powers_buf[t.c0] << 16) |
                    (powers_buf[t.c1] << 12) |
                    (powers_buf[t.c2] << 8)  |
                    (powers_buf[t.c3] << 4)  |
                    powers_buf[t.c4]) >>> 0;
    }
    return out_buf;
  }

  return {
    BASE_TUPLES,
    SYMMETRIES,
    EXPANDED_TUPLES,
    NUM_BASE_TUPLES,
    TUPLE_SIZE,
    ENTRIES_PER_TUPLE,
    TOTAL_WEIGHTS,
    extract_indices,
    extract_indices_bitboard,
    board_to_powers,
    bitboard_to_powers
  };
})();
