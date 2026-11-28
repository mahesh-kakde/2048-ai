# 2048-ai

a browser-based 2048 game with an ai agent powered by compiled webassembly expectimax search and 16-bit monotonic evaluation. everything runs client-side in the browser -- no backend needed.

## what it is

play 2048 with keyboard arrow keys or touch swipes on mobile, or hand control over to the ai. the ai evaluates board states using compiled webassembly expectimax search with 16-bit monotonic score maps, hard perimeter anchor invariants, and selective chance pruning. everything runs directly in your browser.

## what's new in v4

- **compiled webassembly bitboard expectimax:** sub-millisecond c-compiled search engine (`zig 0.17.1`, `-target wasm32-freestanding`) with 8-bit `65,536+` tile encoding running in-browser via wasm.
- **16-bit monotonic score maps:** precomputed 65,536-entry evaluation tables rewarding monotonic gradients, merge pairs, and corner anchors while applying 12x break penalties.
- **4-corner dynamic symmetry rotation:** topological corner anchor protection that rotates the established highest corner tile (`tl`, `tr`, `bl`, `br`) at search root, preventing mid-game human handoff collapse.
- **real-time decision telemetry & offline pwa:** largest-remainder normalized directional probability softmax hud, live move latency badge, wcag aa contrast/aria support, and offline service worker.

## what was new in v3

- **32-symmetric n-tuple network:** 4 base 5-tuples expanded across 8 d4 dihedral symmetries into 32 lookup tables (4,194,304 float32 weights, 16.77 mb binary table). *(preserved on historical `v3` branch; removed from current `master` runtime)*
- **sub-microsecond pure javascript inference:** direct float32array table lookups running in ~0.5us per evaluation (~2,000,000 evaluations/second).
- **deep expectimax with 64-bit zobrist transposition table:** 131,072-entry transposition cache with 64-bit bitboard hashing and chance branch pruning.
- **client-side td fine-tuning via indexeddb:** archived experiment (`2048_ai_db`), replaced in v4 by stateless compiled webassembly lookahead.

## features

- keyboard arrow keys and board-scoped mobile touch swipe controls
- autonomous ai play with visible css-grid tile sliding and merging animations
- normal mode (200ms moves) and turbo mode (40ms moves with 50ms slide animations)
- live move latency indicator (ms/move)
- live decision telemetry displaying expected values and 100%-normalized softmax probabilities for all directions
- compiled webassembly bitboard engine with embedded base64 and javascript fallback
- installable offline pwa -- no backend

## tech stack

- webassembly (c search engine, compiled with `zig 0.17.1` to `wasm/engine.<hash>.wasm`)
- vanilla javascript (bitboard engine, expectimax search, ui, offline service worker)
- html5 + css3 (responsive single-page layout, wcag 2.1 aa contrast, aria dialog/tablist)
- vercel static deployment (`node scripts/build_dist.js` -> `dist/`) + github actions ci

## how to run locally

1. clone the repo
   ```bash
   git clone https://github.com/mahesh-kakde/2048-ai.git
   cd 2048-ai
   ```

2. serve the files with any static server (or build `dist/` first)
   ```bash
   npm run build
   npx serve dist
   ```
   or serve the repository root directly with python:
   ```bash
   python -m http.server 8000
   ```
   (a local server is required for fetching the hashed webassembly binary and registering the service worker; embedded base64 and javascript fallback activate automatically if offline or blocked).

3. run automated lint, build, and tests
   ```bash
   npm run lint
   npm run build
   npm test
   ```

4. play with arrow keys or press "let ai play" to watch the ai.

## how the ai works

the ai uses **expectimax search** -- a game tree search algorithm designed for environments with stochastic elements. at each turn, max nodes evaluate player moves (up, right, down, left), while chance nodes average outcomes over random tile spawns (90% chance of a 2 tile, 10% chance of a 4 tile across all available empty cells).

board evaluations at leaf nodes are computed using **16-bit monotonic score maps**:
- 65,536 precomputed row and column patterns encode exponential tile valuations, monotonic gradient rewards, and merge pairing bonuses.
- any break in monotonicity is penalized with a 12x penalty gradient, keeping high tiles strictly ordered along the perimeter.
- 4-corner symmetry rotation aligns whichever corner currently holds the established maximum tile, enforcing corner anchor protection without forcing mid-game top-left abandonment.
- to accelerate tree exploration, the engine maintains a 64-bit **zobrist transposition table** that caches previously computed subtree evaluations with probability monotonicity guards.

## performance comparisons

| version | avg score | median score | max score | max tile reached | 2048+ rate | move latency | model architecture |
|---|---|---|---|---|---|---|---|
| heuristic only | 19,815 | ~18,500 | 62,144 | 4096 | 35.4% | ~30ms | hand-crafted heuristic rules |
| model v1 | 19,800+ | ~18,200 | 60,000+ | 4096 | 34.0% | ~5,000ms+ | tensorflow.js mlp (548k states) |
| model v2 | 2,098 | 1,496 | 7,232 | 512 | 0.0% | ~12-25ms | pure js matrix mlp (47m states) |
| model v3 | 38,406 | 36,436 | 73,128 | 4096 | 90.0% | ~5.6ms | 32-symmetric n-tuple (100k games) |
| model v4 | 128,849 | 125,514 | 361,092 | 16384 | 99.0% | ~23.7ms | wasm bitboard expectimax + 16-bit score maps |

## live demo

[2048.maheshkakde.com](https://2048.maheshkakde.com) (canonical subdomain only; no `www` subdomain)

## license

MIT