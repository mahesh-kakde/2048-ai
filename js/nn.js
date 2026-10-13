const NN = (() => {
  const MODEL_URL = 'model/model.json';
  const LS_KEY = 'localstorage://2048-nn-model-v2';
  const SCORE_MAX = 76564;
  const LEARNING_RATE = 0.0001;
  const FINE_TUNE_STEPS = 2;

  let model = null;
  let ready = false;

  // fast inference weights and pre-allocated buffers
  let w1 = null, b1 = null;
  let w2 = null, b2 = null;
  let w3 = null, b3 = null;
  let fast_ready = false;

  const input_buf = new Float32Array(16);
  const h1_buf = new Float32Array(128);
  const h2_buf = new Float32Array(64);

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

  function sync_fast_weights() {
    if (!model) return;
    try {
      const weights = model.getWeights();
      // weights: [w1(16,128), b1(128), w2(128,64), b2(64), w3(64,1), b3(1)]
      w1 = weights[0].dataSync();
      b1 = weights[1].dataSync();
      w2 = weights[2].dataSync();
      b2 = weights[3].dataSync();
      w3 = weights[4].dataSync();
      b3 = weights[5].dataSync();
      fast_ready = true;
    } catch (_) {
      fast_ready = false;
    }
  }

  function fast_evaluate(board) {
    let idx = 0;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const val = board[r][c];
        input_buf[idx++] = val > 0 ? Math.log2(val) / 17 : 0;
      }
    }

    // layer 1: dense 128 relu
    for (let j = 0; j < 128; j++) {
      h1_buf[j] = b1[j];
    }
    for (let i = 0; i < 16; i++) {
      const x = input_buf[i];
      if (x === 0) continue;
      const row = i * 128;
      for (let j = 0; j < 128; j++) {
        h1_buf[j] += x * w1[row + j];
      }
    }
    for (let j = 0; j < 128; j++) {
      if (h1_buf[j] < 0) h1_buf[j] = 0;
    }

    // layer 2: dense 64 relu
    for (let j = 0; j < 64; j++) {
      h2_buf[j] = b2[j];
    }
    for (let i = 0; i < 128; i++) {
      const h = h1_buf[i];
      if (h === 0) continue;
      const row = i * 64;
      for (let j = 0; j < 64; j++) {
        h2_buf[j] += h * w2[row + j];
      }
    }
    for (let j = 0; j < 64; j++) {
      if (h2_buf[j] < 0) h2_buf[j] = 0;
    }

    // layer 3: dense 1 linear
    let out = b3[0];
    for (let i = 0; i < 64; i++) {
      const h = h2_buf[i];
      if (h > 0) out += h * w3[i];
    }

    return out * SCORE_MAX;
  }

  function nn_evaluate(board) {
    if (fast_ready) {
      return fast_evaluate(board);
    }
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
      sync_fast_weights();
      set_status(fast_ready ? 'nn: fast engine active (local)' : 'nn: loaded (local)');
    } catch (_) {
      // fall back to the shipped model
      try {
        model = await tf.loadLayersModel(MODEL_URL);
        model.compile({ optimizer: tf.train.adam(LEARNING_RATE), loss: 'meanSquaredError' });
        sync_fast_weights();
        set_status(fast_ready ? 'nn: fast engine active' : 'nn: loaded');
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

    // refresh fast matrix weights with newly updated local parameters
    sync_fast_weights();

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

  function benchmark(iterations = 1000) {
    const test_board = [
      [2, 4, 8, 16],
      [32, 64, 128, 256],
      [512, 1024, 2048, 4096],
      [0, 2, 4, 8]
    ];
    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) {
      fast_evaluate(test_board);
    }
    const t1 = performance.now();
    const total_ms = t1 - t0;
    return {
      iterations,
      total_ms: total_ms.toFixed(2),
      per_eval_us: ((total_ms / iterations) * 1000).toFixed(2)
    };
  }

  load_model();

  return { record_state, on_game_over, reset_game, benchmark, fast_evaluate };
})();