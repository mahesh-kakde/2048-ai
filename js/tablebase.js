const Tablebase = (() => {
  const BIN_URL = 'model/pdf_tables_v4.bin';
  const IDB_NAME = '2048_ai_db';
  const IDB_STORE = 'weights_store';
  const IDB_KEY = 'v4_pdf_tables';
  const HEADER_SIZE = 64;
  const MAGIC = 'PDF4';

  // d4 dihedral symmetry inverse move mappings for directions 0:up, 1:right, 2:down, 3:left
  const INVERSE_SYMMETRY_MOVES = [
    [0, 1, 2, 3], // s=0: identity
    [3, 0, 1, 2], // s=1: rot90 cw
    [2, 3, 0, 1], // s=2: rot180
    [1, 2, 3, 0], // s=3: rot270 cw
    [0, 3, 2, 1], // s=4: horiz flip
    [2, 1, 0, 3], // s=5: vert flip
    [3, 2, 1, 0], // s=6: main diag transpose
    [1, 0, 3, 2]  // s=7: anti diag transpose
  ];

  const TARGET_INDEX_MAP = {
    64: 0,
    128: 1,
    256: 2
  };

  let raw_buffer = null;
  let tables = [];
  let meta_info = [];
  let is_ready = false;
  let load_source = 'none';
  let init_promise = null;

  // zero-allocation scratch board for symmetry transformations
  const scratch_board = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0]
  ];

  function transform_board(b, s, target) {
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        if (s === 0) target[r][c] = b[r][c];
        else if (s === 1) target[r][c] = b[3 - c][r];
        else if (s === 2) target[r][c] = b[3 - r][3 - c];
        else if (s === 3) target[r][c] = b[c][3 - r];
        else if (s === 4) target[r][c] = b[r][3 - c];
        else if (s === 5) target[r][c] = b[3 - r][c];
        else if (s === 6) target[r][c] = b[c][r];
        else if (s === 7) target[r][c] = b[3 - c][3 - r];
      }
    }
    return target;
  }

  function open_db() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        return reject(new Error('indexeddb not supported'));
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

  async function get_idb_buffer() {
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

  async function save_idb_buffer(buffer) {
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

  function mount_tables(buffer) {
    if (!buffer || buffer.byteLength < HEADER_SIZE) return false;
    const view = new DataView(buffer);
    const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (magic !== MAGIC) {
      console.warn('invalid tablebase magic:', magic);
      return false;
    }
    const version = view.getUint32(4, true);
    const num_tables = view.getUint32(8, true);

    raw_buffer = buffer;
    tables = [];
    meta_info = [];

    for (let i = 0; i < num_tables; i++) {
      const off_meta = 16 + i * 16;
      const target = view.getUint16(off_meta, true);
      const radix = view.getUint16(off_meta + 2, true);
      const states = view.getUint32(off_meta + 4, true);
      const byte_offset = view.getUint32(off_meta + 8, true);
      const byte_length = view.getUint32(off_meta + 12, true);

      meta_info.push({ target, radix, states, byte_offset, byte_length });
      tables.push(new Uint8Array(buffer, byte_offset, byte_length));
    }

    is_ready = true;
    return true;
  }

  async function init() {
    if (init_promise) return init_promise;
    init_promise = (async () => {
      // check indexeddb cache first
      const cached = await get_idb_buffer();
      if (cached && mount_tables(cached)) {
        load_source = 'indexeddb';
        return true;
      }

      // fallback to network fetch
      try {
        const res = await fetch(BIN_URL);
        if (!res.ok) {
          console.warn('failed to fetch tablebase:', res.status);
          return false;
        }
        const buffer = await res.arrayBuffer();
        if (mount_tables(buffer)) {
          load_source = 'network';
          save_idb_buffer(buffer);
          return true;
        }
      } catch (err) {
        console.warn('network fetch error for tablebase:', err);
      }
      return false;
    })();
    return init_promise;
  }

  function lookup_index(table_idx, state_idx) {
    if (!is_ready || !tables[table_idx]) return -1;
    const byte_idx = state_idx >> 2;
    const shift = (state_idx & 3) << 1;
    return (tables[table_idx][byte_idx] >>> shift) & 0x03;
  }

  function corridor_to_state_index(b, radix) {
    const c0 = b[0][3] > 0 ? (Math.round(Math.log2(b[0][3])) & 0xF) : 0;
    const c1 = b[1][3] > 0 ? (Math.round(Math.log2(b[1][3])) & 0xF) : 0;
    const c2 = b[2][2] > 0 ? (Math.round(Math.log2(b[2][2])) & 0xF) : 0;
    const c3 = b[2][3] > 0 ? (Math.round(Math.log2(b[2][3])) & 0xF) : 0;
    const c4 = b[3][0] > 0 ? (Math.round(Math.log2(b[3][0])) & 0xF) : 0;
    const c5 = b[3][1] > 0 ? (Math.round(Math.log2(b[3][1])) & 0xF) : 0;
    const c6 = b[3][2] > 0 ? (Math.round(Math.log2(b[3][2])) & 0xF) : 0;
    const c7 = b[3][3] > 0 ? (Math.round(Math.log2(b[3][3])) & 0xF) : 0;

    if (c0 >= radix || c1 >= radix || c2 >= radix || c3 >= radix ||
        c4 >= radix || c5 >= radix || c6 >= radix || c7 >= radix) {
      return -1;
    }

    return ((((((c0 * radix + c1) * radix + c2) * radix + c3) * radix + c4) * radix + c5) * radix + c6) * radix + c7;
  }

  function match_formation(board, target_tile) {
    for (let s = 0; s < 8; s++) {
      transform_board(board, s, scratch_board);

      // check junction tile at (2,1)
      if (scratch_board[2][1] !== target_tile) continue;
      // check primary anchor chain support at (2,0)
      if (scratch_board[2][0] < target_tile * 2) continue;

      // check all 8 anchor tiles are >= target_tile
      if (scratch_board[0][0] < target_tile ||
          scratch_board[0][1] < target_tile ||
          scratch_board[0][2] < target_tile ||
          scratch_board[1][0] < target_tile ||
          scratch_board[1][1] < target_tile ||
          scratch_board[1][2] < target_tile) {
        continue;
      }

      // check all 8 corridor cells are strictly < target_tile
      if (scratch_board[0][3] >= target_tile ||
          scratch_board[1][3] >= target_tile ||
          scratch_board[2][2] >= target_tile ||
          scratch_board[2][3] >= target_tile ||
          scratch_board[3][0] >= target_tile ||
          scratch_board[3][1] >= target_tile ||
          scratch_board[3][2] >= target_tile ||
          scratch_board[3][3] >= target_tile) {
        continue;
      }

      return { matched: true, symmetry: s, target_tile };
    }
    return { matched: false };
  }

  function lookup_board(board, target_tile) {
    if (!is_ready) return { matched: false };
    const table_idx = TARGET_INDEX_MAP[target_tile];
    if (table_idx === undefined || !tables[table_idx]) return { matched: false };

    const match = match_formation(board, target_tile);
    if (!match.matched) return { matched: false };

    const s = match.symmetry;
    transform_board(board, s, scratch_board);
    const radix = meta_info[table_idx].radix;
    const state_idx = corridor_to_state_index(scratch_board, radix);
    if (state_idx < 0) return { matched: false };

    const canonical_move = lookup_index(table_idx, state_idx);
    const actual_move = INVERSE_SYMMETRY_MOVES[s][canonical_move];

    return {
      matched: true,
      move: actual_move,
      canonical_move,
      symmetry: s,
      target_tile,
      state_index: state_idx
    };
  }

  function query_any(board) {
    if (!is_ready) return { matched: false };
    for (const target of [256, 128, 64]) {
      const res = lookup_board(board, target);
      if (res.matched) return res;
    }
    return { matched: false };
  }

  function benchmark(iterations = 100000) {
    if (!is_ready) return { error: 'tablebase not ready' };
    const test_board = [
      [8192, 2048, 512, 0],
      [4096, 1024, 256, 0],
      [ 128,   64,   4, 2],
      [   2,    2,   2, 2]
    ];

    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    let moves_found = 0;
    for (let i = 0; i < iterations; i++) {
      const res = query_any(test_board);
      if (res.matched) moves_found++;
    }
    const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const total_ms = t1 - t0;

    return {
      iterations,
      moves_found,
      total_ms: total_ms.toFixed(2),
      avg_us: ((total_ms / iterations) * 1000).toFixed(3),
      lookups_per_sec: Math.round((iterations / total_ms) * 1000)
    };
  }

  // trigger asynchronous loading on module initialization
  init();

  return {
    init,
    mount_tables,
    is_ready: () => is_ready,
    get_load_source: () => load_source,
    get_meta: () => meta_info,
    lookup_index,
    match_formation,
    lookup_board,
    query_any,
    benchmark
  };
})();

if (typeof window !== 'undefined') window.Tablebase = Tablebase;