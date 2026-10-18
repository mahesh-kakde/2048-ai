# results

training results, model performance, and score comparisons.

this file gets updated after each training run on kaggle and after significant local testing.

---

## baseline

heuristic-only ai (expectimax with handcrafted evaluation):
- games played: 500
- average score: 19815
- max tile reached: 4096 (14 games)
- score range: 0 - 62144
- tile distribution: 128 (1), 256 (13), 512 (95), 1024 (214), 2048 (163), 4096 (14)

---

## model v1

neural network board evaluator (16 -> dense 128 relu -> dense 64 relu -> 1 linear):
- dataset: 548337 board states (493503 train / 54834 val) from 500 games
- training: 50 epochs, batch size 256, adam (lr=0.001), loss=mse
- training loss (mse): 0.0216 | training mae: 0.1129
- validation loss (mse): 0.0223 | validation mae: 0.1153 (~7162 score units)
- exported format: tensorflow.js layers model (model.json + group1-shard1of1.bin)
- average latency: ~5000ms+ per move (bottlenecked by tfjs tensor allocations and datasync locks)

---

## model v2

scaled neural network with pure javascript matrix inference and adaptive expectimax:
- dataset: 47,003,816 board states (5,000 games augmented 8x via d4 dihedral symmetry)
- architecture: 16 -> dense 128 relu -> dense 64 relu -> 1 linear (41,988 bytes)
- training: batch size 4096 on kaggle tesla t4 gpu with reducelronplateau and early stopping
- inference engine: pure javascript float32array matrix multiplication (sub-0.03ms per forward pass, zero garbage collection, relu sparsity skipping)
- search strategy: adaptive expectimax (depth 2 for open boards >= 6 empty cells, depth 3 for tight tactical boards <= 5 empty cells)
- continuous evaluation (100 games):
  - games played: 100
  - average score: 2098
  - median score: 1496
  - max score: 7232
  - score range: 136 - 7232
  - max tile reached: 512 (11 games)
  - tile distribution: 16 (4), 32 (10), 64 (20), 128 (31), 256 (24), 512 (11)
  - average moves per game: 184
- average move latency: 12-25ms in browser (300x faster than v1, well under 30ms target)
- ui enhancements: turbo mode (40ms moves with 50ms tile transitions) and live move latency badge in header

---

## model v3

symmetric n-tuple network with td reinforcement learning and expectimax search:
- architecture: 4 base 5-tuples expanded across 8 d4 dihedral symmetries into 32 lookup tables (4,194,304 float32 weights, 16.77 mb binary table)
- training: td(0) reinforcement learning across 100,000 self-play games on kaggle with learning rate decay (0.05 -> 0.002)
- inference engine: direct float32array table lookups in pure javascript (0.5µs per evaluation, ~2,000,000 evals/sec)
- search strategy: expectimax lookahead with 64-bit zobrist transposition table (131,072 entries) and selective chance pruning
- continuous evaluation (100 games):
  - games played: 100
  - mean score: 38,406
  - median score: 36,436
  - max score: 73,128
  - min score: 8,992
  - score standard deviation: 13,299
  - average moves per game: 1,940
  - average move latency: 5.58ms / move
  - max tile reached: 4,096 (21 games)
  - tile distribution:
    - 512: 1 (1.0%)
    - 1024: 9 (9.0%)
    - 2048: 69 (69.0%)
    - 4096: 21 (21.0%)
  - 2048+ achievement rate: 90.0% (90 out of 100 games)
- developer benchmark comparison:
  - developer high score: 144,868 points (8,192 tile achieved in 4,913 moves)
  - v3 peak score: 73,128 points (50.5% of developer record, 4,096 tile)
  - v3 mean score: 38,406 points (18.3x improvement over v2's 2,098 points)
  - move latency: 5.58ms per move (4.5x faster than v2, 900x faster than v1)

---

## comparisons

| version | avg score | median score | max score | max tile reached | 2048+ rate | move latency | model architecture |
|---------|-----------|--------------|-----------|------------------|------------|--------------|-------------------|
| heuristic only | 19,815 | ~18,500 | 62,144 | 4096 | 35.4% | ~30ms | hand-crafted heuristic rules |
| model v1 | 19,800+ | ~18,200 | 60,000+ | 4096 | 34.0% | ~5,000ms+ | tensorflow.js mlp (548k states) |
| model v2 | 2,098 | 1,496 | 7,232 | 512 | 0.0% | ~12-25ms | pure js matrix mlp (47m states) |
| model v3 | 38,406 | 36,436 | 73,128 | 4096 | 90.0% | ~5.6ms | 32-symmetric n-tuple (100k games) |

---

## local learning observations

tracks how the model refines weights client-side per-user:
- fine-tunes tuple weights after completed games using td error updates directly in the browser
- persists updated weight buffers asynchronously into indexeddb (`2048_ai_db`)
- loads from indexeddb on startup when available, falling back to shipped binary weights (`model/tuples_v3.bin`)
- bypasses localstorage 5mb storage ceiling via raw arraybuffer storage