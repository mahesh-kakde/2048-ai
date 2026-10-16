const NN = (() => {
  const TUPLE_MODEL_URL = 'model/tuples_v3.bin';
  const LS_KEY = 'localstorage://2048-tuple-v3';
  const ENTRIES_PER_TUPLE = 1048576; // 16^5
  const TOTAL_WEIGHTS = 4 * ENTRIES_PER_TUPLE; // 4 base tuples x 16^5

  let tuple_weights = null;
  let tuple_ready = false;

  // reusable buffer for the 32 extracted tuple indices
  const indices_buf = new Uint32Array(32);

  function set_status(text) {
    const el = document.getElementById('stats-text');
    if (el) el.textContent = text;
  }

  function tuple_evaluate(board) {
    if (!tuple_ready || !tuple_weights) {
      return typeof heuristic_evaluate === 'function' ? heuristic_evaluate(board) : 0;
    }

    Tuple.extract_indices(board, indices_buf);
    const tuples = Tuple.EXPANDED_TUPLES;
    let score = 0.0;

    for (let i = 0; i < 32; i++) {
      const offset = tuples[i].base_id * ENTRIES_PER_TUPLE;
      score += tuple_weights[offset + indices_buf[i]];
    }

    return score;
  }

  function tuple_evaluate_bitboard(bb) {
    if (!tuple_ready || !tuple_weights) {
      const board = bitboard_to_board(bb);
      return typeof heuristic_evaluate === 'function' ? heuristic_evaluate(board) : 0;
    }

    Tuple.extract_indices_bitboard(bb, indices_buf);
    const tuples = Tuple.EXPANDED_TUPLES;
    let score = 0.0;

    for (let i = 0; i < 32; i++) {
      const offset = tuples[i].base_id * ENTRIES_PER_TUPLE;
      score += tuple_weights[offset + indices_buf[i]];
    }

    return score;
  }

  function load_weights_buffer(buf) {
    tuple_weights = new Float32Array(buf);
    tuple_ready = true;
    window.heuristic_evaluate = tuple_evaluate;
    set_status('v3 tuple engine active (<2us/eval)');
  }

  async function load_model() {
    // 1. check localstorage for user fine-tuned tuple weights
    try {
      const local_b64 = localStorage.getItem(LS_KEY);
      if (local_b64) {
        const bin_str = atob(local_b64);
        const bytes = new Uint8Array(bin_str.length);
        for (let i = 0; i < bin_str.length; i++) bytes[i] = bin_str.charCodeAt(i);
        if (bytes.length === TOTAL_WEIGHTS * 4) {
          load_weights_buffer(bytes.buffer);
          set_status('v3 tuple engine active (local fine-tuned)');
          return;
        }
      }
    } catch (_) {}

    // 2. fetch shipped binary weights
    try {
      const res = await fetch(TUPLE_MODEL_URL);
      if (!res.ok) throw new Error(`http ${res.status}`);
      const array_buf = await res.arrayBuffer();
      if (array_buf.byteLength === TOTAL_WEIGHTS * 4) {
        load_weights_buffer(array_buf);
        return;
      }
    } catch (_) {
      // weights file not yet trained or loaded: fall back to heuristic
      tuple_ready = false;
      set_status('v3 engine ready -- awaiting trained tuple weights');
    }
  }

  // records game trajectory for client-side td updates (chunk 5)
  let game_history = [];

  function record_state(board, score) {
    if (typeof board_to_bitboard === 'function') {
      game_history.push({
        bb: board_to_bitboard(board),
        score: score
      });
    }
  }

  function reset_game() {
    game_history = [];
  }

  async function on_game_over(final_score) {
    game_history = [];
  }

  function benchmark(iterations = 10000) {
    const test_board = [
      [2, 4, 8, 16],
      [32, 64, 128, 256],
      [512, 1024, 2048, 4096],
      [8192, 16384, 0, 2]
    ];

    // temporary weights if uninitialized for latency testing
    let temp_allocated = false;
    if (!tuple_weights) {
      tuple_weights = new Float32Array(TOTAL_WEIGHTS);
      tuple_ready = true;
      temp_allocated = true;
    }

    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    for (let i = 0; i < iterations; i++) {
      tuple_evaluate(test_board);
    }
    const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const total_ms = t1 - t0;

    if (temp_allocated) {
      tuple_weights = null;
      tuple_ready = false;
    }

    return {
      iterations,
      total_ms: total_ms.toFixed(2),
      avg_us: ((total_ms / iterations) * 1000).toFixed(3),
      evals_per_sec: Math.round((iterations / total_ms) * 1000)
    };
  }

  load_model();

  return {
    tuple_evaluate,
    tuple_evaluate_bitboard,
    load_weights_buffer,
    record_state,
    reset_game,
    on_game_over,
    benchmark,
    is_ready: () => tuple_ready,
    get_weights: () => tuple_weights
  };
})();