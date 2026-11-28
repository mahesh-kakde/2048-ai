const UI = (() => {
  const board_el = document.getElementById('board');
  const wrapper = board_el.parentElement;
  const score_el = document.getElementById('score');
  const best_el = document.getElementById('best');
  const message_el = document.getElementById('game-message');
  const message_text = document.getElementById('message-text');

  let tile_elements = [];
  let tile_grid = [
    [null, null, null, null],
    [null, null, null, null],
    [null, null, null, null],
    [null, null, null, null]
  ];
  let retiring_tiles = [];
  let cleanup_timer = null;

  function set_tile_position(el, row, col) {
    el.style.setProperty('--row', row);
    el.style.setProperty('--col', col);
  }

  function create_tile_el(row, col, value) {
    const el = document.createElement('div');
    el.className = 'tile';
    if (value > 2048) {
      if (value === 4096) el.classList.add('tile-4096');
      else if (value === 8192) el.classList.add('tile-8192');
      else if (value === 16384) el.classList.add('tile-16384');
      else if (value === 32768) el.classList.add('tile-32768');
      else if (value === 65536) el.classList.add('tile-65536');
      else el.classList.add('tile-super');
    }
    el.setAttribute('data-value', value);
    el.textContent = value;
    set_tile_position(el, row, col);
    return el;
  }

  function clear_retiring() {
    if (cleanup_timer) {
      clearTimeout(cleanup_timer);
      cleanup_timer = null;
    }
    retiring_tiles.forEach(el => el.remove());
    retiring_tiles = [];
  }

  function clear_tiles() {
    clear_retiring();
    tile_elements.forEach(el => el.remove());
    tile_elements = [];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        tile_grid[r][c] = null;
      }
    }
  }

  function render(board, spawn_pos, merged_positions, movements) {
    clear_retiring();

    if (!movements) {
      clear_tiles();
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          if (board[r][c] === 0) continue;
          const el = create_tile_el(r, c, board[r][c]);

          if (spawn_pos && spawn_pos[0] === r && spawn_pos[1] === c) {
            el.classList.add('tile-new');
          }

          if (merged_positions) {
            for (const [mr, mc] of merged_positions) {
              if (mr === r && mc === c) {
                el.classList.add('tile-merged');
                break;
              }
            }
          }

          wrapper.appendChild(el);
          tile_elements.push(el);
          tile_grid[r][c] = el;
        }
      }
      return;
    }

    tile_elements.forEach(el => el.classList.remove('tile-new', 'tile-merged'));

    const next_grid = [
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null]
    ];
    const next_elements = [];
    const new_retiring = [];

    for (let i = 0; i < movements.length; i++) {
      const m = movements[i];
      const [fr, fc] = m.from;
      const [tr, tc] = m.to;
      let el = tile_grid[fr][fc];
      tile_grid[fr][fc] = null;

      if (!el) {
        el = create_tile_el(fr, fc, m.value);
        wrapper.appendChild(el);
        void el.offsetWidth;
      }

      set_tile_position(el, tr, tc);

      if (m.merged) {
        el.style.zIndex = '9';
        new_retiring.push(el);
      } else {
        next_grid[tr][tc] = el;
        next_elements.push(el);
      }
    }

    // remove any leftover elements from old tile_grid not consumed by movements
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        if (tile_grid[r][c]) {
          tile_grid[r][c].remove();
          tile_grid[r][c] = null;
        }
      }
    }

    if (merged_positions) {
      for (const [mr, mc] of merged_positions) {
        if (board[mr][mc] === 0) continue;
        const mel = create_tile_el(mr, mc, board[mr][mc]);
        mel.classList.add('tile-merged');
        wrapper.appendChild(mel);
        next_grid[mr][mc] = mel;
        next_elements.push(mel);
      }
    }

    if (spawn_pos) {
      const [sr, sc] = spawn_pos;
      if (board[sr][sc] !== 0) {
        const sel = create_tile_el(sr, sc, board[sr][sc]);
        sel.classList.add('tile-new');
        wrapper.appendChild(sel);
        next_grid[sr][sc] = sel;
        next_elements.push(sel);
      }
    }

    // reconcile any orphaned or missing cells against authoritative board state
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const val = board[r][c];
        if (val !== 0 && !next_grid[r][c]) {
          const el = create_tile_el(r, c, val);
          wrapper.appendChild(el);
          next_grid[r][c] = el;
          next_elements.push(el);
        } else if (val === 0 && next_grid[r][c]) {
          next_grid[r][c].remove();
          next_grid[r][c] = null;
        }
      }
    }

    tile_grid = next_grid;
    tile_elements = next_elements;
    retiring_tiles = new_retiring;

    if (retiring_tiles.length > 0) {
      const cleanup_ms = board_el.classList.contains('turbo') ? 55 : 155;
      cleanup_timer = setTimeout(clear_retiring, cleanup_ms);
    }
  }

  function update_score(score) {
    score_el.textContent = score;
  }

  function update_best(best) {
    best_el.textContent = best;
  }

  function show_message(text) {
    message_text.textContent = text;
    message_el.classList.add('active');
  }

  function hide_message() {
    message_el.classList.remove('active');
  }

  const status_el = document.getElementById('status-banner');
  const status_text_el = document.getElementById('status-text');

  function show_status(text, level) {
    if (!status_el || !status_text_el) return;
    if (status_el.classList.contains('status-error') && level !== 'error') return;
    status_text_el.textContent = text;
    status_el.classList.toggle('status-error', level === 'error');
    status_el.classList.add('active');
  }

  function hide_status() {
    if (!status_el) return;
    status_el.classList.remove('active', 'status-error');
    if (status_text_el) status_text_el.textContent = '';
  }

  const latency_el = document.getElementById('latency-badge');

  function update_latency(ms) {
    if (!latency_el) return;
    if (ms === null || ms === undefined) {
      latency_el.textContent = '-- ms';
    } else if (typeof ms === 'string') {
      latency_el.textContent = ms;
    } else if (ms < 1) {
      latency_el.textContent = `${ms.toFixed(1)} ms`;
    } else {
      latency_el.textContent = `${Math.round(ms)} ms`;
    }
  }

  function set_turbo(is_turbo) {
    if (board_el) {
      board_el.classList.toggle('turbo', is_turbo);
    }
  }

  const hud_el = document.getElementById('decision-hud');

  const hud_dirs = {
    0: {
      el: document.getElementById('hud-dir-up'),
      val_el: document.getElementById('hud-val-up'),
      prob_el: document.getElementById('hud-prob-up')
    },
    1: {
      el: document.getElementById('hud-dir-right'),
      val_el: document.getElementById('hud-val-right'),
      prob_el: document.getElementById('hud-prob-right')
    },
    2: {
      el: document.getElementById('hud-dir-down'),
      val_el: document.getElementById('hud-val-down'),
      prob_el: document.getElementById('hud-prob-down')
    },
    3: {
      el: document.getElementById('hud-dir-left'),
      val_el: document.getElementById('hud-val-left'),
      prob_el: document.getElementById('hud-prob-left')
    }
  };

  function update_decision_hud(telemetry) {
    if (!hud_el) return;
    if (!telemetry) {
      for (let d = 0; d < 4; d++) {
        const item = hud_dirs[d];
        if (!item || !item.el) continue;
        item.el.classList.remove('hud-dir-best', 'hud-dir-invalid', 'hud-dir-danger');
        if (item.val_el) item.val_el.textContent = '—';
        if (item.prob_el) item.prob_el.textContent = '';
      }
      return;
    }

    const vals = [telemetry.up, telemetry.right, telemetry.down, telemetry.left];
    const best_d = telemetry.best_dir;

    // compute winning probability percentages normalized via largest-remainder rounding
    const probs = [0, 0, 0, 0];
    let max_v = -Infinity;
    let valid_count = 0;
    for (let d = 0; d < 4; d++) {
      const v = vals[d];
      if (typeof v === 'number' && v > -5e9) {
        if (v > max_v) max_v = v;
        valid_count++;
      }
    }

    if (valid_count > 0 && max_v > -Infinity) {
      const weights = [0, 0, 0, 0];
      let total_weight = 0;
      const temp = Math.max(10, Math.abs(max_v) * 0.05);
      for (let d = 0; d < 4; d++) {
        const v = vals[d];
        if (typeof v === 'number' && v > -5e9) {
          const diff = (v - max_v) / temp;
          const w = Math.exp(Math.max(-20, diff));
          weights[d] = w;
          total_weight += w;
        }
      }
      if (total_weight > 0) {
        const remainders = [];
        let sum_floor = 0;
        for (let d = 0; d < 4; d++) {
          if (weights[d] > 0) {
            const exact = (weights[d] / total_weight) * 100;
            const floored = Math.floor(exact);
            probs[d] = floored;
            sum_floor += floored;
            remainders.push({ d, rem: exact - floored });
          }
        }
        remainders.sort((a, b) => {
          if (b.rem !== a.rem) return b.rem - a.rem;
          if (a.d === best_d) return -1;
          if (b.d === best_d) return 1;
          return a.d - b.d;
        });
        let leftover = 100 - sum_floor;
        for (let i = 0; i < remainders.length && leftover > 0; i++) {
          probs[remainders[i].d]++;
          leftover--;
        }
      }
    }

    // populate direction cards
    for (let d = 0; d < 4; d++) {
      const item = hud_dirs[d];
      if (!item || !item.el) continue;
      const v = vals[d];
      const is_danger = typeof v === 'number' && v < -5e9;

      item.el.classList.toggle('hud-dir-best', d === best_d);
      item.el.classList.toggle('hud-dir-invalid', v === null || v === undefined);
      item.el.classList.toggle('hud-dir-danger', is_danger);

      if (item.val_el) {
        if (v === null || v === undefined) {
          item.val_el.textContent = 'blocked';
        } else if (typeof v === 'string') {
          item.val_el.textContent = v;
        } else if (is_danger) {
          item.val_el.textContent = 'danger';
        } else {
          item.val_el.textContent = Math.round(v).toLocaleString();
        }
      }

      if (item.prob_el) {
        if (v === null || v === undefined) {
          item.prob_el.textContent = '';
        } else if (is_danger) {
          item.prob_el.textContent = '0% (risk)';
        } else {
          item.prob_el.textContent = `${probs[d]}%`;
        }
      }
    }
  }

  return {
    render,
    update_score,
    update_best,
    show_message,
    hide_message,
    show_status,
    hide_status,
    update_latency,
    set_turbo,
    update_decision_hud
  };
})();

if (typeof window !== 'undefined') window.UI = UI;