# 2048-nn

a browser-based 2048 game with an ai agent powered by expectimax search and a 32-symmetric n-tuple network board evaluator. everything runs client-side in the browser -- no backend needed.

## what it is

play 2048 with keyboard arrow keys or touch swipes on mobile, or hand control over to the ai. the ai evaluates board states using a symmetric n-tuple network trained offline via temporal difference reinforcement learning, paired with expectimax tree search and 64-bit zobrist transposition caching. the agent fine-tunes itself locally using indexeddb.

## what's new in v3

- **32-symmetric n-tuple network:** replaced mlp neural network with 4 base 5-tuples expanded across 8 d4 dihedral symmetries into 32 lookup tables (4,194,304 float32 weights, 16.77 mb binary table).
- **sub-microsecond pure javascript inference:** direct float32array table lookups running in ~0.5us per evaluation (~2,000,000 evaluations/second), eliminating tensor allocation stalls and matrix multiplication overhead.
- **deep expectimax with 64-bit zobrist transposition table:** 131,072-entry transposition cache with 64-bit bitboard hashing and chance branch pruning, achieving ~30% cache hit rates and 5.58ms average move latencies.
- **live decision telemetry:** real-time directional evaluation cards displaying expected board values for up, down, right, and left when ai is playing.
- **client-side td fine-tuning via indexeddb:** asynchronous td(0) error updates stored directly in browser indexeddb (`2048_ai_db`), bypassing localstorage 5mb storage ceilings.
- **performance leap:** 2048+ achievement rate increased from 0% in v2 to 90% in v3; average score increased from 2,098 to 38,406; peak score reached 73,128 (4,096 tile).
- **personal benchmark comparison:** built to benchmark against a verified personal high score of 144,868 points (8,192 tile achieved in 4,913 moves), with modal tabs comparing technical architecture and gameplay statistics.

## features

- keyboard arrow keys and mobile touch swipe controls
- autonomous ai play with visible tile sliding and merging animations
- normal mode (200ms moves) and turbo mode (40ms moves with 50ms slide animations)
- live move latency indicator (ms/move)
- live decision telemetry displaying expected values for all valid directions
- 32-symmetric n-tuple network inference engine in pure javascript
- client-side model refinement stored in indexeddb
- dual-tab modal with technical notes and personal benchmark documentation
- clean, understated styling with 8k, 16k, and 32k tile styles
- fully client-side static application -- no backend

## tech stack

- vanilla javascript (bitboard engine, tuple inference, expectimax search, indexeddb storage, ui)
- python + numpy (offline td(0) reinforcement learning on kaggle)
- html5 + css3 (responsive single-page layout, no frameworks)
- space grotesk + jetbrains mono fonts
- vercel (static deployment)

## how to run locally

1. clone the repo
   ```bash
   git clone https://github.com/mahesh-kakde/2048-nn.git
   cd 2048-nn
   ```

2. serve the files with any static server
   ```bash
   npx serve .
   ```
   or with python:
   ```bash
   python -m http.server 8000
   ```
   (a local server is required for fetching binary model weights via fetch/xhr).

3. play with arrow keys or press "let ai play" to watch the ai.

## how the ai works

the ai uses **expectimax search** -- a game tree search algorithm designed for environments with stochastic elements. at each turn, max nodes evaluate player moves (up, right, down, left), while chance nodes average outcomes over random tile spawns (90% chance of a 2 tile, 10% chance of a 4 tile across all available empty cells).

board evaluations at leaf nodes are computed using a **32-symmetric n-tuple network**:
- 4 base 5-tuples capture spatial relationships across rows, columns, and rectangular blocks.
- each base tuple is reflected and rotated across 8 d4 dihedral symmetries, producing 32 lookup tables.
- each 5-tuple index is extracted directly from 64-bit integer bitboards via bit-shifts and masks, looking up pre-computed float32 weights in a single memory access.
- the network was trained offline across 100,000 self-play games using td(0) temporal difference learning with learning rate annealing.

to accelerate tree exploration, the engine maintains a 64-bit **zobrist transposition table** that caches previously computed subtree evaluations, reducing redundant branch calculations.

after each completed game, the client-side engine computes td errors along the game trajectory and updates tuple weights directly in browser indexeddb.

## performance comparisons

| version | avg score | median score | max score | max tile reached | 2048+ rate | move latency | model architecture |
|---|---|---|---|---|---|---|---|
| heuristic only | 19,815 | ~18,500 | 62,144 | 4096 | 35.4% | ~30ms | hand-crafted heuristic rules |
| model v1 | 19,800+ | ~18,200 | 60,000+ | 4096 | 34.0% | ~5,000ms+ | tensorflow.js mlp (548k states) |
| model v2 | 2,098 | 1,496 | 7,232 | 512 | 0.0% | ~12-25ms | pure js matrix mlp (47m states) |
| model v3 | 38,406 | 36,436 | 73,128 | 4096 | 90.0% | ~5.6ms | 32-symmetric n-tuple (100k games) |

## live demo

[mk-2048-nn.vercel.app](https://mk-2048-nn.vercel.app)

## license

mit