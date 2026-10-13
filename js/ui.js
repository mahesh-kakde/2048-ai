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
    if (value > 2048) el.classList.add('tile-super');
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
    } else {
      latency_el.textContent = `${Math.round(ms)} ms`;
    }
  }

  function set_turbo(is_turbo) {
    if (board_el) {
      board_el.classList.toggle('turbo', is_turbo);
    }
  }

  return {
    render,
    update_score,
    update_best,
    show_message,
    hide_message,
    update_latency,
    set_turbo
  };
})();