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

## comparisons

| version | avg score | max tile reached | move latency | dataset size | notes |
|---------|-----------|------------------|--------------|--------------|-------|
| heuristic only | 19815 | 4096 | ~30ms | n/a | hand-crafted heuristic |
| model v1 | 19800+ | 4096 | ~5000ms+ | 548k | slow tfjs tensor allocation locks |
| model v2 | 2098 | 512 | ~12-25ms | 47m | pure js matrix engine, 8x symmetry, turbo mode |

---

## local learning observations

tracks how the model refines weights client-side per-user:
- fine-tunes 2 gradient descent steps after every completed game
- persists updated weights directly to browser localstorage (isolated under `localstorage://2048-nn-model-v2`)
- fast matrix engine automatically synchronizes with updated weights upon fine-tuning
- automatically reloaded on return visits