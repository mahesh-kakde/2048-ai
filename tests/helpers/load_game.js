const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { performance } = require('perf_hooks');

const ROOT = path.resolve(__dirname, '..', '..');

function getWasmBinaryPath() {
  const aiCode = fs.readFileSync(path.join(ROOT, 'js', 'ai.js'), 'utf8');
  const match = aiCode.match(/const WASM_BINARY_PATH = '([^']+)';/);
  if (!match) throw new Error('WASM_BINARY_PATH constant missing in js/ai.js');
  return match[1];
}

function createFakeTimers() {
  let nextId = 1;
  const active = new Map();
  return {
    setTimeout(fn, delay) {
      const id = nextId++;
      active.set(id, { id, fn, delay });
      return id;
    },
    clearTimeout(id) {
      active.delete(id);
    },
    get activeCount() {
      return active.size;
    },
    list() {
      return Array.from(active.values());
    },
    runNext() {
      const first = active.values().next().value;
      if (!first) return false;
      active.delete(first.id);
      first.fn();
      return true;
    },
    flushAll(limit = 50) {
      let ran = 0;
      while (active.size > 0 && ran < limit) {
        this.runNext();
        ran++;
      }
      return ran;
    }
  };
}

function createDomMock() {
  const elements = {};
  const listeners = {};
  const makeEl = (id) => {
    const classes = new Set();
    const el = {
      id,
      className: '',
      textContent: '',
      attributes: {},
      style: {
        vars: {},
        setProperty(k, v) { this.vars[k] = String(v); },
        getPropertyValue(k) { return this.vars[k] || ''; }
      },
      children: [],
      parentElement: null,
      classList: {
        add: (...c) => c.forEach(x => classes.add(x)),
        remove: (...c) => c.forEach(x => classes.delete(x)),
        toggle: (c, f) => {
          if (f === undefined) {
            if (classes.has(c)) classes.delete(c);
            else classes.add(c);
          } else if (f) {
            classes.add(c);
          } else {
            classes.delete(c);
          }
        },
        contains: (c) => classes.has(c)
      },
      addEventListener: (ev, fn) => { listeners[id + ':' + ev] = fn; },
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return this.attributes[k] || ''; },
      remove() {
        if (this.parentElement) {
          this.parentElement.children = this.parentElement.children.filter(c => c !== this);
        }
      },
      appendChild(c) {
        c.parentElement = this;
        this.children.push(c);
      },
      focus() { document.activeElement = this; },
      querySelector: () => ({ offsetLeft: 8, offsetTop: 8 }),
      querySelectorAll: () => []
    };
    return el;
  };
  const getEl = (id) => (elements[id] || (elements[id] = makeEl(id)));
  const board = getEl('board');
  board.parentElement = getEl('board-wrapper');

  let tileSeq = 0;
  const document = {
    activeElement: null,
    getElementById: getEl,
    querySelectorAll: (sel) => {
      if (sel === '.modal-tab') return [getEl('tab-btn-benchmark'), getEl('tab-btn-technical')];
      if (sel === '.modal-tab-content') return [getEl('tab-benchmark'), getEl('tab-technical')];
      return [];
    },
    addEventListener: (ev, fn) => { listeners['doc:' + ev] = fn; },
    createElement: (tag) => makeEl(`${tag}-${++tileSeq}`)
  };

  const tab1 = getEl('tab-btn-benchmark');
  const tab2 = getEl('tab-btn-technical');
  tab1.setAttribute('data-tab', 'benchmark');
  tab2.setAttribute('data-tab', 'technical');
  getEl('modal').querySelectorAll = () => [getEl('modal-close'), tab1, tab2];

  return { document, getEl, listeners, makeEl };
}

function loadGameEngine() {
  const ctx = { console, Math, Number, BigInt, Array };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'game.js'), 'utf8'), ctx, { filename: 'js/game.js' });
  return ctx;
}

function loadAiEngine({ enableWasm = true, allowFetch = true } = {}) {
  const wasmRel = getWasmBinaryPath();
  const wasmBytes = fs.readFileSync(path.join(ROOT, wasmRel));
  const fetchedUrls = [];

  const ctx = {
    console: enableWasm ? console : { ...console, warn: () => {} },
    Math,
    Number,
    BigInt,
    Uint8Array,
    Uint32Array,
    BigUint64Array,
    Int8Array,
    Int32Array,
    Float32Array,
    Float64Array,
    Array,
    Promise,
    Error,
    performance,
    WebAssembly: enableWasm ? WebAssembly : undefined,
    atob: (b64) => Buffer.from(b64, 'base64').toString('binary'),
    fetch: async (url) => {
      fetchedUrls.push(url);
      if (!allowFetch || url !== wasmRel) throw new Error(`fetch blocked: ${url}`);
      return {
        ok: true,
        arrayBuffer: async () => wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength)
      };
    },
    window: undefined
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'game.js'), 'utf8'), ctx, { filename: 'js/game.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'ai.js'), 'utf8'), ctx, { filename: 'js/ai.js' });
  return { ctx, fetchedUrls, wasmRel, wasmBytes };
}

function loadFullApp({ localStorageImpl, indexedDBImpl, timersImpl, navigatorImpl, enableWasm = true } = {}) {
  const dom = createDomMock();
  const timers = timersImpl || createFakeTimers();
  const wasmRel = getWasmBinaryPath();
  const wasmBytes = fs.readFileSync(path.join(ROOT, wasmRel));
  const winListeners = {};

  let store = {};
  const ls = localStorageImpl || {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  const idb = indexedDBImpl === undefined ? { deleteDatabase() {} } : indexedDBImpl;

  const ctx = {
    console: enableWasm ? console : { ...console, warn: () => {} },
    Math,
    Number,
    BigInt,
    Uint8Array,
    Uint32Array,
    Int8Array,
    Int32Array,
    Float32Array,
    Float64Array,
    BigUint64Array,
    DataView,
    ArrayBuffer,
    Array,
    Promise,
    Error,
    performance,
    WebAssembly: enableWasm ? WebAssembly : undefined,
    atob: (b64) => Buffer.from(b64, 'base64').toString('binary'),
    fetch: async (url) => {
      if (url === wasmRel) {
        return {
          ok: true,
          arrayBuffer: async () => wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength)
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    indexedDB: idb,
    localStorage: ls,
    navigator: navigatorImpl,
    document: dom.document,
    window: undefined
  };
  ctx.window = ctx;
  ctx.addEventListener = (ev, fn) => {
    winListeners[ev] = winListeners[ev] || [];
    winListeners[ev].push(fn);
  };
  vm.createContext(ctx);
  for (const script of ['js/game.js', 'js/ui.js', 'js/ai.js', 'js/main.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, script), 'utf8'), ctx, { filename: script });
  }
  return { ctx, dom, timers, store, winListeners, runInContext: (code) => vm.runInContext(code, ctx) };
}

function vercelSourceToRegex(source) {
  let i = 0;
  let pattern = '^';
  while (i < source.length) {
    if (source[i] === '(') {
      let depth = 0;
      let j = i;
      while (j < source.length) {
        if (source[j] === '\\') { j += 2; continue; }
        if (source[j] === '(') depth++;
        else if (source[j] === ')') {
          depth--;
          if (depth === 0) break;
        }
        j++;
      }
      pattern += source.slice(i, j + 1);
      i = j + 1;
    } else if (source[i] === ':') {
      i++;
      while (i < source.length && /[A-Za-z0-9_]/.test(source[i])) i++;
      if (i < source.length && source[i] === '(') {
        let depth = 0;
        let j = i;
        while (j < source.length) {
          if (source[j] === '\\') { j += 2; continue; }
          if (source[j] === '(') depth++;
          else if (source[j] === ')') {
            depth--;
            if (depth === 0) break;
          }
          j++;
        }
        pattern += source.slice(i, j + 1);
        i = j + 1;
      } else {
        pattern += '([^/#?]+)';
      }
    } else {
      pattern += source[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }
  return new RegExp(pattern + '$');
}

function resolveVercelHeaders(config, urlPath) {
  const out = {};
  for (const rule of config.headers || []) {
    if (vercelSourceToRegex(rule.source).test(urlPath)) {
      for (const h of rule.headers || []) out[h.key] = h.value;
    }
  }
  return out;
}

module.exports = {
  ROOT,
  getWasmBinaryPath,
  createFakeTimers,
  createDomMock,
  loadGameEngine,
  loadAiEngine,
  loadFullApp,
  resolveVercelHeaders
};