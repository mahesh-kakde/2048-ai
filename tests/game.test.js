const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGameEngine } = require('./helpers/load_game');

test('move and trace_move maintain exact parity across 2,000 random boards and edge patterns', () => {
  const ctx = loadGameEngine();

  const edgeBoards = [
    [[2, 2, 2, 2], [4, 2, 2, 4], [0, 2, 0, 2], [2, 2, 4, 4]],
    [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    [[32768, 32768, 16384, 8192], [65536, 65536, 4, 4], [2, 4, 8, 16], [32, 64, 128, 256]]
  ];

  for (const board of edgeBoards) {
    for (let dir = 0; dir < 4; dir++) {
      const m = JSON.parse(JSON.stringify(ctx.move(board, dir)));
      const t = JSON.parse(JSON.stringify(ctx.trace_move(board, dir)));
      assert.deepEqual(t.board, m.board);
      assert.equal(t.score, m.score);
      assert.equal(t.moved, m.moved);
    }
  }

  let seed = 0x9e3779b9;
  const nextRand = (mod) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed % mod;
  };

  for (let i = 0; i < 2000; i++) {
    const board = Array.from({ length: 4 }, () =>
      Array.from({ length: 4 }, () => {
        const exp = nextRand(10);
        return exp === 0 ? 0 : 1 << exp;
      })
    );
    const dir = nextRand(4);
    const m = JSON.parse(JSON.stringify(ctx.move(board, dir)));
    const t = JSON.parse(JSON.stringify(ctx.trace_move(board, dir)));
    assert.deepEqual(t.board, m.board);
    assert.equal(t.score, m.score);
    assert.equal(t.moved, m.moved);

    if (m.moved) {
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          if (m.board[r][c] > 0) {
            const matched = t.movements.some(
              mv => mv.to[0] === r && mv.to[1] === c && (mv.merged ? mv.value * 2 : mv.value) === m.board[r][c]
            );
            assert.ok(matched, 'non-empty cell must have movement trace');
          }
        }
      }
    }
  }
});

test('8-bit bitboard round-trips accurately from 0 up to 1,048,576 without nibble wrap', () => {
  const ctx = loadGameEngine();
  const boards = [
    [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    [[32768, 16384, 8192, 4096], [2048, 1024, 512, 256], [128, 64, 32, 16], [8, 4, 2, 0]],
    [[65536, 65536, 32768, 16384], [8192, 4096, 2048, 1024], [512, 256, 128, 64], [32, 16, 8, 4]],
    [[131072, 65536, 32768, 16384], [262144, 524288, 1048576, 8], [4, 2, 0, 2], [4, 8, 16, 32]]
  ];

  for (const board of boards) {
    const bb = ctx.board_to_bitboard(board);
    const restored = JSON.parse(JSON.stringify(ctx.bitboard_to_board(bb)));
    assert.deepEqual(restored, board);
  }
});

test('spawn, game-over detection, and corner anchor invariant checks behave correctly', () => {
  const ctx = loadGameEngine();
  const b0 = ctx.create_board();
  assert.equal(b0.flat().filter(v => v > 0).length, 2);

  const fullLocked = [
    [2, 4, 8, 16],
    [32, 64, 128, 256],
    [512, 1024, 2048, 4096],
    [8192, 16384, 32768, 65536]
  ];
  assert.equal(ctx.is_game_over(fullLocked), true);

  const before = [[65536, 32, 16, 8], [4, 8, 16, 32], [2, 4, 8, 16], [0, 2, 4, 8]];
  const violated = [[0, 32, 16, 8], [65536, 8, 16, 32], [2, 4, 8, 16], [0, 2, 4, 8]];
  const preserved = [[65536, 32, 16, 8], [4, 8, 16, 32], [2, 4, 8, 16], [2, 4, 8, 0]];
  assert.equal(ctx.check_anchor_violation(before, violated), true);
  assert.equal(ctx.check_anchor_violation(before, preserved), false);
});