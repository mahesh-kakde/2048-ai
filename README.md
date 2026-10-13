# 2048-nn

a browser-based 2048 game with an ai agent powered by adaptive expectimax search and a neural network board evaluator. everything runs client-side -- no backend needed.

## what it is

play 2048 yourself with keyboard arrow keys or touch swipes, or press a button and watch the ai take over. the ai uses a neural network (trained offline on kaggle) to evaluate board positions, combined with adaptive expectimax tree search to pick the best move. the model improves locally over time as you play, using your browser's localstorage.

## what's new in v2

- **pure javascript matrix inference engine:** custom float32array forward pass running in sub-0.03ms per evaluation, eliminating tensorflow.js tensor allocation stalls.
- **adaptive expectimax search:** dynamic depth switching (depth 2 on open boards with >= 6 empty cells, depth 3 during tight tactical phases with <= 5 empty cells).
- **speed toggle:** switch between normal mode (200ms moves) and turbo mode (40ms moves with 50ms slide animations).
- **live latency telemetry:** real-time decision latency badge (ms/move) displayed in the ui header.
- **massive offline dataset:** trained on 47 million board states across 5,000 games augmented 8x via d4 dihedral symmetry.
- **move speed leap:** decision latency dropped from ~5,000ms in v1 to 12-25ms in v2 (over 300x speedup).

## features

- human play with keyboard and touch swipes on mobile
- ai play with visible tile animations
- turbo and normal speed toggle
- live decision latency indicator (ms/move)
- seamless switching between human and ai mid-game
- pure javascript float32array matrix inference engine
- per-user local model improvement via localstorage
- minimal, clean ui with light color palette
- fully client-side -- no server, no backend

## tech stack

- vanilla javascript (game engine, fast matrix inference, adaptive expectimax, ui)
- tensorflow.js (model loading and client-side fine-tuning)
- tensorflow / keras + python (offline training on kaggle gpu)
- html + css (no framework)
- space grotesk + jetbrains mono fonts
- vercel (static site hosting)

## how to run locally

1. clone the repo
   ```
   git clone https://github.com/mahesh-kakde/2048-nn.git
   cd 2048-nn
   ```

2. serve the files with any static server
   ```
   npx serve .
   ```
   or with python:
   ```
   python -m http.server 8000
   ```
   (a local server is required for fetching model weights via fetch/xhr).

3. play with arrow keys or press "let ai play" to watch the ai.

## how the ai works

the ai uses **adaptive expectimax search** -- a tree search algorithm for games with randomness. at each turn, it simulates valid moves and stochastic tile spawns (weighted 90% for 2, 10% for 4). 

to evaluate board states at the leaves, it runs a 3-layer neural network (16 -> dense 128 relu -> dense 64 relu -> 1 linear) implemented in pure javascript using flat float32array buffers with relu sparsity skipping. the network was trained on kaggle across 47 million board states from 5,000 games using 8-fold dihedral symmetry augmentation. after each game, the model fine-tunes itself locally in your browser using gradient descent and saves the updated weights to localstorage.

## performance comparisons

| version | avg score | max tile reached | move latency | dataset size | notes |
|---------|-----------|------------------|--------------|--------------|-------|
| heuristic only | 19815 | 4096 | ~30ms | n/a | hand-crafted heuristic |
| model v1 | 19800+ | 4096 | ~5000ms+ | 548k | slow tfjs tensor allocation locks |
| model v2 | 2098 | 512 | ~12-25ms | 47m | pure js matrix engine, 8x symmetry, turbo mode |

## live demo

[mk-2048-nn.vercel.app](https://mk-2048-nn.vercel.app)

## license

mit