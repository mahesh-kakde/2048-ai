const Game = (() => {
  let board = null;
  let score = 0;
  let best = parseInt(localStorage.getItem('2048-best')) || 0;
  let game_over = false;
  let input_locked = false;
  let ai_playing = false;

  const ai_btn = document.getElementById('ai-btn');
  const speed_btn = document.getElementById('speed-btn');
  const new_game_btn = document.getElementById('new-game-btn');
  const retry_btn = document.getElementById('retry-btn');
  let turbo_mode = false;

  function find_merged_positions(old_board, new_board, direction) {
    // a cell in new_board was a merge if its value > 0, it's double some value
    // that existed in old_board, and the old cell at that position had a different value
    // simpler: re-run the move and track merges
    const merged = [];
    const b = clone(old_board);

    for (let i = 0; i < 4; i++) {
      let row;
      if (direction === 0)      row = [b[0][i], b[1][i], b[2][i], b[3][i]];
      else if (direction === 1) row = [b[i][3], b[i][2], b[i][1], b[i][0]];
      else if (direction === 2) row = [b[3][i], b[2][i], b[1][i], b[0][i]];
      else                      row = [b[i][0], b[i][1], b[i][2], b[i][3]];

      let vals = row.filter(v => v !== 0);
      for (let j = 0; j < vals.length - 1; j++) {
        if (vals[j] === vals[j + 1]) {
          // j is the position in the compacted row where the merge lands
          let r, c;
          if (direction === 0)      { r = j; c = i; }
          else if (direction === 1) { r = i; c = 3 - j; }
          else if (direction === 2) { r = 3 - j; c = i; }
          else                      { r = i; c = j; }
          merged.push([r, c]);
          vals.splice(j + 1, 1);
        }
      }
    }
    return merged;
  }

  function do_move(direction) {
    if (game_over || (!ai_playing && input_locked)) return;

    const old_board = clone(board);
    const result = move(board, direction);
    if (!result.moved) return;

    if (typeof NN !== 'undefined') NN.record_state(old_board, score, result.board, result.score);

    if (!ai_playing) {
      input_locked = true;
      setTimeout(() => { input_locked = false; }, 150);
    }

    const merged = find_merged_positions(old_board, result.board, direction);
    board = result.board;
    score += result.score;

    const s = spawn(board);
    board = s.board;

    if (score > best) {
      best = score;
      localStorage.setItem('2048-best', best);
    }

    UI.update_score(score);
    UI.update_best(best);
    UI.render(board, s.pos, merged);

    if (is_game_over(board)) {
      game_over = true;
      setTimeout(() => {
        UI.show_message('game over');
        if (typeof NN !== 'undefined') NN.on_game_over(score);
      }, 300);
    }
  }

  function new_game() {
    board = create_board();
    score = 0;
    game_over = false;
    input_locked = false;
    ai_playing = false;
    ai_btn.textContent = 'let ai play';
    if (typeof UI.update_latency === 'function') UI.update_latency(null);
    if (typeof UI.update_decision_hud === 'function') UI.update_decision_hud(null);
    if (typeof UI.show_decision_hud === 'function') UI.show_decision_hud(false);
    if (typeof NN !== 'undefined') NN.reset_game();
    UI.hide_message();
    UI.update_score(0);
    UI.update_best(best);
    UI.render(board, null, null);
  }

  function handle_key(e) {
    if (e.key === 'Escape') {
      document.getElementById('modal-overlay').classList.remove('active');
      return;
    }
    if (ai_playing) return;
    const map = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3 };
    if (map[e.key] !== undefined) {
      e.preventDefault();
      do_move(map[e.key]);
    }
  }

  // touch/swipe support
  let touch_start_x = 0;
  let touch_start_y = 0;

  function handle_touch_start(e) {
    if (ai_playing) return;
    const t = e.touches[0];
    touch_start_x = t.clientX;
    touch_start_y = t.clientY;
  }

  function handle_touch_end(e) {
    if (ai_playing) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch_start_x;
    const dy = t.clientY - touch_start_y;
    const min_swipe = 30;

    if (Math.abs(dx) < min_swipe && Math.abs(dy) < min_swipe) return;

    if (Math.abs(dx) > Math.abs(dy)) {
      do_move(dx > 0 ? 1 : 3);
    } else {
      do_move(dy > 0 ? 2 : 0);
    }
  }

  function toggle_speed() {
    turbo_mode = !turbo_mode;
    if (speed_btn) {
      speed_btn.textContent = turbo_mode ? 'speed: turbo' : 'speed: normal';
      speed_btn.classList.toggle('btn-turbo', turbo_mode);
    }
    if (typeof UI.set_turbo === 'function') UI.set_turbo(turbo_mode);
  }

  function toggle_ai() {
    if (typeof ai_best_move !== 'function') return;

    ai_playing = !ai_playing;
    ai_btn.textContent = ai_playing ? 'stop ai' : 'let ai play';
    if (!ai_playing) {
      if (typeof UI.update_latency === 'function') UI.update_latency(null);
    }

    if (ai_playing) ai_step();
  }

  function ai_step() {
    if (!ai_playing || game_over) {
      ai_playing = false;
      ai_btn.textContent = 'let ai play';
      if (typeof UI.update_latency === 'function') UI.update_latency(null);
      return;
    }

    const dir = ai_best_move(board);
    if (dir === -1) {
      ai_playing = false;
      ai_btn.textContent = 'let ai play';
      if (typeof UI.update_latency === 'function') UI.update_latency(null);
      if (typeof UI.update_decision_hud === 'function') UI.update_decision_hud(null);
      if (typeof UI.show_decision_hud === 'function') UI.show_decision_hud(false);
      return;
    }

    if (typeof get_last_search_stats === 'function') {
      const stats = get_last_search_stats();
      if (typeof UI.update_latency === 'function') {
        if (stats.source && stats.source.startsWith('pdf-')) {
          UI.update_latency(stats.time_ms < 0.1 ? '<0.1 ms' : `${stats.time_ms.toFixed(1)} ms`);
        } else {
          UI.update_latency(stats.time_ms);
        }
      }
      if (typeof UI.update_decision_hud === 'function') UI.update_decision_hud(stats.directional, stats);
    }

    do_move(dir);
    const delay = turbo_mode ? 40 : 200;
    setTimeout(ai_step, delay);
  }

  function init() {
    document.addEventListener('keydown', handle_key);
    document.addEventListener('touchstart', handle_touch_start, { passive: true });
    document.addEventListener('touchend', handle_touch_end, { passive: true });

    new_game_btn.addEventListener('click', new_game);
    retry_btn.addEventListener('click', new_game);
    ai_btn.addEventListener('click', toggle_ai);
    if (speed_btn) speed_btn.addEventListener('click', toggle_speed);

    const info_btn = document.getElementById('info-btn');
    const modal_overlay = document.getElementById('modal-overlay');
    const modal_close_btn = document.getElementById('modal-close');

    info_btn.addEventListener('click', () => modal_overlay.classList.add('active'));
    modal_close_btn.addEventListener('click', () => modal_overlay.classList.remove('active'));
    modal_overlay.addEventListener('click', e => {
      if (e.target === modal_overlay) modal_overlay.classList.remove('active');
    });

    const tab_btns = document.querySelectorAll('.modal-tab');
    tab_btns.forEach(btn => {
      btn.addEventListener('click', () => {
        tab_btns.forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.modal-tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        const tab_id = 'tab-' + btn.getAttribute('data-tab');
        const target = document.getElementById(tab_id);
        if (target) target.classList.add('active');
      });
    });

    new_game();
  }

// expose do_move and board for ai module
  return { init, do_move, get_board: () => board, is_over: () => game_over };
})();

if (typeof window !== 'undefined') window.Game = Game;
Game.init();