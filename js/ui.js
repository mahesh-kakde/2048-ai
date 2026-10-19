const UI = (() => {
  const board_el = document.getElementById('board');
  const wrapper = board_el.parentElement;
  const score_el = document.getElementById('score');
  const best_el = document.getElementById('best');
  const message_el = document.getElementById('game-message');
  const message_text = document.getElementById('message-text');

  let tile_elements = [];

  function get_cell_position(row, col) {
    const cell = board_el.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
    return {
      left: cell.offsetLeft,
      top: cell.offsetTop
    };
  }

  function create_tile_el(row, col, value) {
    const pos = get_cell_position(row, col);
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
    el.style.left = pos.left + 'px';
    el.style.top = pos.top + 'px';
    return el;
  }

  function render(board, spawn_pos, merged_positions) {
    tile_elements.forEach(el => el.remove());
    tile_elements = [];

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
      }
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
  const hud_mode_el = document.getElementById('hud-mode');
  const hud_detail_el = document.getElementById('hud-detail');

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

  function update_decision_hud(telemetry, stats) {
    if (!hud_el) return;
    if (!telemetry) {
      hud_el.classList.remove('hud-mode-tablebase', 'hud-mode-wasm', 'hud-mode-js');
      if (hud_mode_el) hud_mode_el.textContent = 'ai standby';
      if (hud_detail_el) hud_detail_el.textContent = '—';
      for (let d = 0; d < 4; d++) {
        const item = hud_dirs[d];
        if (!item || !item.el) continue;
        item.el.classList.remove('hud-dir-best', 'hud-dir-invalid', 'hud-dir-danger', 'hud-dir-tablebase');
        if (item.val_el) item.val_el.textContent = '—';
        if (item.prob_el) item.prob_el.textContent = '';
      }
      return;
    }

    const vals = [telemetry.up, telemetry.right, telemetry.down, telemetry.left];
    const best_d = telemetry.best_dir;
    const is_tablebase = telemetry.source && telemetry.source.startsWith('pdf-');
    const is_wasm = telemetry.source === 'wasm-expectimax';

    // update mode banner
    hud_el.classList.toggle('hud-mode-tablebase', !!is_tablebase);
    hud_el.classList.toggle('hud-mode-wasm', !!is_wasm);
    hud_el.classList.toggle('hud-mode-js', !is_tablebase && !is_wasm);

    if (hud_mode_el) {
      if (is_tablebase) {
        hud_mode_el.textContent = `tablebase (${telemetry.source})`;
      } else if (is_wasm) {
        hud_mode_el.textContent = 'wasm lookahead';
      } else {
        hud_mode_el.textContent = 'js expectimax';
      }
    }

    if (hud_detail_el) {
      if (is_tablebase) {
        hud_detail_el.textContent = 'exact corridor • <0.1 ms';
      } else {
        const depth_val = telemetry.depth || (stats && stats.depth) || null;
        const depth_str = depth_val ? `depth ${depth_val}` : '';
        const nodes_val = telemetry.nodes || (stats && stats.nodes) || 0;
        const nodes_str = nodes_val > 0 ? (nodes_val >= 1000 ? `${(nodes_val / 1000).toFixed(1)}k nodes` : `${nodes_val} nodes`) : '';
        const time_val = stats && typeof stats.time_ms === 'number' ? stats.time_ms : null;
        const time_str = time_val !== null ? (time_val < 1 ? `${time_val.toFixed(1)} ms` : `${Math.round(time_val)} ms`) : '';
        hud_detail_el.textContent = [depth_str, nodes_str, time_str].filter(Boolean).join(' • ') || 'active';
      }
    }

    // compute winning probability percentages
    const probs = [0, 0, 0, 0];
    if (is_tablebase) {
      if (best_d >= 0 && best_d < 4) probs[best_d] = 100;
    } else {
      let max_v = -Infinity;
      let valid_count = 0;
      for (let d = 0; d < 4; d++) {
        const v = vals[d];
        if (typeof v === 'number' && v > -1e6) {
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
          if (typeof v === 'number' && v > -1e6) {
            const diff = (v - max_v) / temp;
            const w = Math.exp(Math.max(-20, diff));
            weights[d] = w;
            total_weight += w;
          }
        }
        if (total_weight > 0) {
          for (let d = 0; d < 4; d++) {
            if (weights[d] > 0) {
              probs[d] = Math.round((weights[d] / total_weight) * 100);
            }
          }
        }
      }
    }

    // populate direction cards
    for (let d = 0; d < 4; d++) {
      const item = hud_dirs[d];
      if (!item || !item.el) continue;
      const v = vals[d];
      const is_danger = typeof v === 'number' && v < -1e6;
      const is_tb_hit = is_tablebase && d === best_d;

      item.el.classList.toggle('hud-dir-best', d === best_d);
      item.el.classList.toggle('hud-dir-tablebase', is_tb_hit);
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
        } else if (is_tb_hit) {
          item.prob_el.textContent = '100% win';
        } else if (is_danger) {
          item.prob_el.textContent = '0% (risk)';
        } else if (is_tablebase) {
          item.prob_el.textContent = 'alt';
        } else {
          item.prob_el.textContent = `${probs[d]}%`;
        }
      }
    }
  }

  function show_decision_hud(show) {
    if (!hud_el) return;
    hud_el.classList.toggle('active', !!show);
    if (!show) {
      hud_el.classList.remove('hud-mode-tablebase', 'hud-mode-wasm', 'hud-mode-js');
      if (hud_mode_el) hud_mode_el.textContent = 'ai standby';
      if (hud_detail_el) hud_detail_el.textContent = '—';
      for (let d = 0; d < 4; d++) {
        const item = hud_dirs[d];
        if (!item || !item.el) continue;
        item.el.classList.remove('hud-dir-best', 'hud-dir-invalid', 'hud-dir-danger', 'hud-dir-tablebase');
        if (item.val_el) item.val_el.textContent = '—';
        if (item.prob_el) item.prob_el.textContent = '';
      }
    }
  }

  return {
    render,
    update_score,
    update_best,
    show_message,
    hide_message,
    update_latency,
    set_turbo,
    show_decision_hud,
    update_decision_hud
  };
})();

if (typeof window !== 'undefined') window.UI = UI;