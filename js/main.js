const Game = (() => {
  function storage_get(key) {
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function storage_set(key, val) {
    try {
      localStorage.setItem(key, String(val));
    } catch (_) {}
  }

  function storage_remove(key) {
    try {
      localStorage.removeItem(key);
    } catch (_) {}
  }

  let board = null;
  let score = 0;
  const parsed_best = parseInt(storage_get('2048-best'), 10);
  let best = Number.isFinite(parsed_best) && parsed_best > 0 ? parsed_best : 0;
  let game_over = false;
  let input_locked = false;
  let ai_playing = false;
  let ai_timer_id = null;
  let game_over_timer_id = null;
  let input_lock_timer_id = null;

  function clear_ai_timer() {
    if (ai_timer_id !== null) {
      clearTimeout(ai_timer_id);
      ai_timer_id = null;
    }
  }

  function clear_game_over_timer() {
    if (game_over_timer_id !== null) {
      clearTimeout(game_over_timer_id);
      game_over_timer_id = null;
    }
  }

  function clear_input_lock_timer() {
    if (input_lock_timer_id !== null) {
      clearTimeout(input_lock_timer_id);
      input_lock_timer_id = null;
    }
  }

  const ai_btn = document.getElementById('ai-btn');
  const speed_btn = document.getElementById('speed-btn');
  const new_game_btn = document.getElementById('new-game-btn');
  const retry_btn = document.getElementById('retry-btn');
  let turbo_mode = false;

  function do_move(direction) {
    if (game_over || (!ai_playing && input_locked)) return;

    const result = typeof trace_move === 'function' ? trace_move(board, direction) : move(board, direction);
    if (!result.moved) return;

    if (!ai_playing) {
      clear_input_lock_timer();
      input_locked = true;
      input_lock_timer_id = setTimeout(() => {
        input_lock_timer_id = null;
        input_locked = false;
      }, 150);
    }

    board = result.board;
    score += result.score;

    const s = spawn(board);
    board = s.board;

    if (score > best) {
      best = score;
      storage_set('2048-best', best);
    }

    UI.update_score(score);
    UI.update_best(best);
    UI.render(board, s.pos, result.merges || null, result.movements || null);

    if (is_game_over(board)) {
      game_over = true;
      clear_game_over_timer();
      game_over_timer_id = setTimeout(() => {
        game_over_timer_id = null;
        if (game_over) UI.show_message('game over');
      }, 300);
    }
  }

  function new_game() {
    clear_ai_timer();
    clear_game_over_timer();
    clear_input_lock_timer();
    board = create_board();
    score = 0;
    game_over = false;
    input_locked = false;
    ai_playing = false;
    ai_btn.textContent = 'let ai play';
    if (typeof UI.update_latency === 'function') UI.update_latency(null);
    if (typeof UI.update_decision_hud === 'function') UI.update_decision_hud(null);
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

    clear_ai_timer();
    clear_input_lock_timer();
    input_locked = false;

    if (ai_playing) {
      ai_playing = false;
      ai_btn.textContent = 'let ai play';
      if (typeof UI.update_latency === 'function') UI.update_latency(null);
      return;
    }

    if (game_over) return;

    ai_playing = true;
    ai_btn.textContent = 'stop ai';
    ai_step();
  }

  function ai_step() {
    clear_ai_timer();
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
      return;
    }

    if (typeof get_last_search_stats === 'function') {
      const stats = get_last_search_stats();
      if (typeof UI.update_latency === 'function') {
        UI.update_latency(stats.time_ms);
      }
      if (typeof UI.update_decision_hud === 'function') UI.update_decision_hud(stats.directional, stats);
    }

    do_move(dir);
    if (!ai_playing || game_over) {
      ai_playing = false;
      ai_btn.textContent = 'let ai play';
      if (typeof UI.update_latency === 'function') UI.update_latency(null);
      return;
    }

    const delay = turbo_mode ? 40 : 200;
    ai_timer_id = setTimeout(ai_step, delay);
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

    // purge obsolete v3/v4 prototype storage left in returning visitors' browsers
    try {
      if (typeof indexedDB !== 'undefined') indexedDB.deleteDatabase('2048_ai_db');
    } catch (_) {}
    storage_remove('2048-tuple-games-learned');

    new_game();
  }

// expose do_move and board for ai module
  return { init, do_move, get_board: () => board, is_over: () => game_over };
})();

if (typeof window !== 'undefined') window.Game = Game;
Game.init();