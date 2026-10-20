const NN = (() => {
  const TUPLE_MODEL_URL = 'model/tuples_v3.bin';
  const IDB_NAME = '2048_ai_db';
  const IDB_STORE = 'weights_store';
  const IDB_KEY = 'v3_tuple_weights';
  const LS_GAMES_KEY = '2048-tuple-games-learned';

  const ENTRIES_PER_TUPLE = 1048576; // 16^5
  const TOTAL_WEIGHTS = 4 * ENTRIES_PER_TUPLE; // 4 base tuples x 16^5

  let tuple_weights = null;
  let tuple_ready = false;
  let is_fine_tuned = false;

  // reusable scratch buffer for the 32 extracted tuple indices
  const indices_buf = new Uint32Array(32);

  // reusable scratch buffers for zero-allocation symmetry count normalization
  const count_keys = new Uint32Array(32);
  const count_vals = new Uint8Array(32);

  function set_status(text) {
    const el = document.getElementById('stats-text');
    if (el) el.textContent = text;
  }

  function open_db() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        return reject(new Error('indexedDB not supported'));
      }
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function get_idb_weights() {
    try {
      const db = await open_db();
      return new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const req = store.get(IDB_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (_) {
      return null;
    }
  }

  async function save_idb_weights(buffer) {
    try {
      const db = await open_db();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        const req = store.put(buffer, IDB_KEY);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    } catch (_) {
      return false;
    }
  }

  async function clear_idb_weights() {
    try {
      const db = await open_db();
      return new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        const req = store.delete(IDB_KEY);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      });
    } catch (_) {
      return false;
    }
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

  function load_weights_buffer(buf, is_local = false) {
    tuple_weights = new Float32Array(buf);
    tuple_ready = true;
    is_fine_tuned = is_local;

    if (is_local) {
      const count = localStorage.getItem(LS_GAMES_KEY) || '1';
      set_status(`v4 engine active (monotonic score map + local learned: ${count} games)`);
    } else {
      set_status('v4 engine active (monotonic score map)');
    }
  }

  function fetch_binary(url) {
    return new Promise((resolve, reject) => {
      fetch(url)
        .then(res => {
          if (!res.ok) throw new Error(`http ${res.status}`);
          return res.arrayBuffer();
        })
        .then(resolve)
        .catch(() => {
          try {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.responseType = 'arraybuffer';
            xhr.onload = () => {
              if (xhr.status === 200 || xhr.status === 0) {
                resolve(xhr.response);
              } else {
                reject(new Error(`xhr status ${xhr.status}`));
              }
            };
            xhr.onerror = () => reject(new Error('xhr failed'));
            xhr.send();
          } catch (e) {
            reject(e);
          }
        });
    });
  }

  async function load_model() {
    // 1. check indexeddb for user fine-tuned tuple weights
    try {
      const idb_buf = await get_idb_weights();
      if (idb_buf && idb_buf.byteLength === TOTAL_WEIGHTS * 4) {
        load_weights_buffer(idb_buf, true);
        return;
      }
    } catch (_) {}

    // 2. fetch shipped binary weights from model/tuples_v3.bin
    try {
      const array_buf = await fetch_binary(TUPLE_MODEL_URL);
      if (array_buf && array_buf.byteLength === TOTAL_WEIGHTS * 4) {
        load_weights_buffer(array_buf, false);
        return;
      }
    } catch (_) {
      // weights file unavailable: fall back to heuristic
      tuple_ready = false;
      set_status('v4 engine active (monotonic score map)');
    }
  }

  // records game trajectory for client-side td fine-tuning
  let game_history = [];

  function record_state(board, score, afterstate, move_score) {
    const target = afterstate || board;
    game_history.push({
      board: clone(target),
      score: typeof move_score === 'number' ? move_score : 0
    });
  }

  function reset_game() {
    game_history = [];
  }

  function apply_td_update(board, delta, alpha) {
    Tuple.extract_indices(board, indices_buf);
    const tuples = Tuple.EXPANDED_TUPLES;

    let unique_count = 0;
    let norm = 0;

    for (let i = 0; i < 32; i++) {
      const full_key = (tuples[i].base_id * ENTRIES_PER_TUPLE) + indices_buf[i];
      let found = false;
      for (let j = 0; j < unique_count; j++) {
        if (count_keys[j] === full_key) {
          count_vals[j]++;
          found = true;
          break;
        }
      }
      if (!found) {
        count_keys[unique_count] = full_key;
        count_vals[unique_count] = 1;
        unique_count++;
      }
    }

    for (let j = 0; j < unique_count; j++) {
      norm += count_vals[j] * count_vals[j];
    }

    if (norm === 0) return;
    const step = (alpha * delta) / norm;

    for (let j = 0; j < unique_count; j++) {
      tuple_weights[count_keys[j]] += count_vals[j] * step;
    }
  }

  async function on_game_over(final_score) {
    if (!tuple_ready || !tuple_weights || game_history.length === 0) {
      game_history = [];
      return;
    }

    const alpha = 0.001;
    const history = game_history;
    game_history = [];

    // backward replay td(0) updates
    for (let t = 0; t < history.length; t++) {
      const cur_board = history[t].board;
      const cur_val = tuple_evaluate(cur_board);

      let target = 0.0;
      if (t < history.length - 1) {
        const next_reward = history[t + 1].score;
        const next_board = history[t + 1].board;
        target = next_reward + tuple_evaluate(next_board);
      }

      const delta = target - cur_val;
      apply_td_update(cur_board, delta, alpha);
    }

    // persist updated weights buffer into indexeddb
    try {
      const ok = await save_idb_weights(tuple_weights.buffer);
      if (ok) {
        const count = (parseInt(localStorage.getItem(LS_GAMES_KEY), 10) || 0) + 1;
        localStorage.setItem(LS_GAMES_KEY, count);
        is_fine_tuned = true;
        set_status(`v4 hybrid engine active (tablebase + local learned: ${count} games)`);
      }
    } catch (e) {
      console.warn('idb save error:', e);
    }
  }

  async function reset_to_shipped_model() {
    await clear_idb_weights();
    localStorage.removeItem(LS_GAMES_KEY);
    await load_model();
  }

  function benchmark(iterations = 10000) {
    const test_board = [
      [2, 4, 8, 16],
      [32, 64, 128, 256],
      [512, 1024, 2048, 4096],
      [8192, 16384, 0, 2]
    ];

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
    reset_to_shipped_model,
    benchmark,
    is_ready: () => tuple_ready,
    is_local_learned: () => is_fine_tuned,
    get_weights: () => tuple_weights
  };
})();