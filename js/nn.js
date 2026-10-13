const NN = (() => {
  const MODEL_URL = 'model/model.json';
  const LS_KEY = 'localstorage://2048-nn-model';
  const SCORE_MAX = 62144;
  const LEARNING_RATE = 0.0001;
  const FINE_TUNE_STEPS = 2;

  let model = null;
  let ready = false;

  // states and cumulative scores recorded during current game
  let game_states = [];
  let game_scores = [];

  function encode_board(board) {
    const input = [];
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++)
        input.push(board[r][c] > 0 ? Math.log2(board[r][c]) / 17 : 0);
    return input;
  }

  function nn_evaluate(board) {
    const input = encode_board(board);
    const t = tf.tensor2d([input], [1, 16]);
    const pred = model.predict(t);
    const val = pred.dataSync()[0] * SCORE_MAX;
    t.dispose();
    pred.dispose();
    return val;
  }

  function set_status(text) {
    const el = document.getElementById('stats-text');
    if (el) el.textContent = text;
  }

  async function load_model() {
    // try localstorage first (previously fine-tuned model)
    try {
      model = await tf.loadLayersModel(LS_KEY);
      model.compile({ optimizer: tf.train.adam(LEARNING_RATE), loss: 'meanSquaredError' });
      set_status('nn: loaded (local)');
    } catch (_) {
      // fall back to the shipped model
      try {
        model = await tf.loadLayersModel(MODEL_URL);
        model.compile({ optimizer: tf.train.adam(LEARNING_RATE), loss: 'meanSquaredError' });
        set_status('nn: loaded');
      } catch (e) {
        set_status('nn: unavailable -- using heuristic');
        return;
      }
    }

    ready = true;
    // override the global heuristic_evaluate used by ai.js
    window.heuristic_evaluate = nn_evaluate;
  }

  function record_state(board, score) {
    game_states.push(encode_board(board));
    game_scores.push(score);
  }

  async function on_game_over(final_score) {
    if (!ready || game_states.length === 0) {
      game_states = [];
      game_scores = [];
      return;
    }

    // label each state with remaining score from that point to end
    const labels = game_scores.map(s => [(final_score - s) / SCORE_MAX]);

    const xs = tf.tensor2d(game_states);
    const ys = tf.tensor2d(labels);

    for (let step = 0; step < FINE_TUNE_STEPS; step++) {
      await model.fit(xs, ys, { epochs: 1, batchSize: 64, verbose: 0 });
    }

    xs.dispose();
    ys.dispose();

    // persist updated weights to localstorage
    try {
      await model.save(LS_KEY);
    } catch (_) {
      // localstorage full or unavailable -- skip silently
    }

    game_states = [];
    game_scores = [];
  }

  function reset_game() {
    game_states = [];
    game_scores = [];
  }

  load_model();

  return { record_state, on_game_over, reset_game };
})();