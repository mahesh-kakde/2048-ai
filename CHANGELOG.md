# changelog

all notable changes to `2048-ai` are documented in this file.

## [unreleased] - production hardening (post-v4.0.2)

### security & infrastructure
- removed unused v2/v3/tablebase startup assets (`22.86 mb`), scripts (`js/nn.js`, `js/tablebase.js`, `js/tuple.js`), legacy `model/` weights, and training `notebooks/` from `master` (preserved in `v2`, `v3`, and `v4` tags/branches).
- added `scripts/build_dist.js` (`outputDirectory: "dist"`) and `.vercelignore` to deploy strictly verified runtime files.
- content-hashed compiled webassembly binary (`wasm/engine.a528e904.wasm`) and scoped 1-year `immutable` caching strictly to hashed filenames.
- configured strict `Content-Security-Policy` (`'wasm-unsafe-eval'`, no `'unsafe-inline'`), `Cross-Origin-Resource-Policy: same-origin`, `Cross-Origin-Opener-Policy: same-origin`, and strict origin CORS in `vercel.json`.
- cropped/replaced public benchmark screenshots with metadata-stripped `high-score-1.webp` and `high-score-2.webp`.

### engine, ui, reliability & accessibility
- upgraded bitboard encoding from 4-bit nibbles to 8-bit hybrid cells supporting `65,536` through `1,048,576` without wrap-around, rebuilt with `zig 0.17.1` (`-target wasm32-freestanding`), and synced `EMBEDDED_WASM_B64`.
- restored 4-corner dynamic symmetry rotation at search root (`TL`, `TR`, `BL`, `BR`) in both c/wasm and javascript fallback.
- guarded `ai_timer_id`, `game_over_timer_id`, and `input_lock_timer_id` cancellation and enforced transposition-table `prob` monotonicity + `Float64Array` precision.
- tracked tile slide movements using css grid variables (`--row`, `--col`), fixed responsive resize alignment, and fixed nested `/404` root-relative styles.
- guarded `localStorage` calls, added global `error`/`unhandledrejection` handlers, `window.Telemetry`, and dismissible `#status-banner`.
- met wcag 2.1 aa contrast (`>= 4.5:1`), aria dialog/tablist semantics with focus trapping/restoration, `prefers-reduced-motion`, modal keyboard/touch isolation, and `touch-action: none`.
- normalized decision hud softmax rounded percentages via largest-remainder rounding so displayed valid probabilities always sum to `100%`.

### seo, pwa & ci/cd
- added `og-image.png`, `<noscript>` fallback banner, `robots.txt`, `manifest.webmanifest`, icons (`180`, `192`, `512`), and offline service worker (`sw.js`).
- added `tests/lint.js`, `node --test` unit/parity/security suites, `tests/e2e/smoke.mjs`, and `.github/workflows/ci.yml`.

## [v4.0.2] - 2026-11-17

- aligned wasm and js 16-bit monotonic score map evaluators (`12x` break penalty, pair merge bonus), root orientation selection, and adaptive softmax hud.

## [v4.0.1] - 2026-11-16

- tuned hybrid expectimax search parameters and telemetry hud styling.

## [v4.0.0] - 2026-11-15

- introduced compiled webassembly bitboard expectimax engine (`depth 5-6`) with 16-bit monotonic row/column tables and 64-bit zobrist transposition table.

## [v3.0.0] - 2026-10

- 32-symmetric n-tuple temporal-difference evaluator (`branch: v3`).

## [v2.0.1] - 2026-09

- scaled pure javascript matrix mlp (`branch: v2`).

## [v1.0.0] - 2026-08

- initial tensorflow.js expectimax browser prototype (`tag: v1.0.0`).