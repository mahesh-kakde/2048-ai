# 2048-nn

a browser-based 2048 game with an ai agent powered by expectimax search and a neural network board evaluator. everything runs client-side -- no backend needed.

## what it is

play 2048 yourself with arrow keys, or press a button and watch the ai take over. the ai uses a neural network (trained offline) to evaluate board positions, combined with expectimax tree search to pick the best move. the model improves locally over time as you play, using your browser's localstorage.

## features

- human play with keyboard and on-screen buttons
- ai play with visible tile animations
- seamless switching between human and ai mid-game
- neural network board evaluator (tensorflow.js)
- per-user local model improvement via localstorage
- minimal, clean ui with light color palette
- fully client-side -- no server, no backend

## tech stack

- vanilla javascript (game engine, ai, ui)
- tensorflow.js (in-browser nn inference and fine-tuning)
- tensorflow / keras + python (offline training on kaggle)
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
   or just open `index.html` in your browser.

3. play with arrow keys or press "let ai play" to watch the ai.

## how the ai works

the ai uses **expectimax search** -- a tree search algorithm for games with randomness. at each turn, it simulates all four possible moves and all possible random tile spawns, several moves deep. to evaluate how good a board position is, it uses a small **neural network** instead of hand-written rules. the network was trained on thousands of games played on kaggle. the model also improves locally in your browser as you play more games.

## live demo

[mk-2048-nn.vercel.app](https://mk-2048-nn.vercel.app)

## license

MIT