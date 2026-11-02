// Stockfish (WASM, runs in a Web Worker). Evaluations are always from White's point of view, in centipawns.
const MATE_CP = 1000; // mate scores are clamped here so "lost the game" is simply a very big drop

let worker = null;
let ready = null;
let current = null;
const cache = new Map();
export let engineOk = true;

function start() {
  if (ready) return ready;
  ready = new Promise((resolve) => {
    try {
      worker = new Worker('lib/sf19/stockfish-19-lite-single.js'); // Stockfish 19 lite, single-threaded WASM (no special server headers needed)
    } catch (e) { engineOk = false; resolve(false); return; }
    const timeout = setTimeout(() => { engineOk = false; resolve(false); }, 20000);
    worker.onerror = () => { engineOk = false; clearTimeout(timeout); resolve(false); };
    worker.onmessage = (ev) => {
      const line = typeof ev.data === 'string' ? ev.data : '';
      if (line === 'uciok') worker.postMessage('isready');
      else if (line === 'readyok') {
        clearTimeout(timeout);
        worker.onmessage = onLine;
        resolve(true);
      }
    };
    worker.postMessage('uci');
  });
  return ready;
}

function onLine(ev) {
  const line = typeof ev.data === 'string' ? ev.data : '';
  if (!current) return;
  if (line.startsWith('info') && line.includes(' score ') && !/bound/.test(line)) {
    const sc = line.match(/score (cp|mate) (-?\d+)/);
    if (!sc) return;
    const n = parseInt(sc[2], 10);
    let v = sc[1] === 'cp' ? n : (n > 0 ? MATE_CP : -MATE_CP);
    if (sc[1] === 'mate' && n === 0) v = -MATE_CP;
    const k = parseInt((line.match(/ multipv (\d+)/) || [0, 1])[1], 10);
    const pv = (line.match(/ pv (.+)$/) || [0, ''])[1].trim().split(/\s+/).filter(Boolean);
    const sign = current.turn === 'w' ? 1 : -1;
    current.lines[k - 1] = { uci: pv[0] || null, cp: sign * v, mate: sc[1] === 'mate' ? sign * n : null, pv };
  } else if (line.startsWith('bestmove')) {
    const best = line.split(' ')[1];
    const c = current; current = null;
    const lines = c.lines.filter(Boolean);
    const main = lines[0] || { cp: 0, mate: null };
    c.resolve({ cp: Math.max(-MATE_CP, Math.min(MATE_CP, main.cp)), mate: main.mate, best: best === '(none)' ? null : best, lines });
  }
}

// The engine does one search at a time. Jobs the user is waiting for (priority 1) always go before background
// look-ahead jobs (priority 0), and a running look-ahead search is stopped the moment a real request arrives.
const queue = [];
const pending = new Map();   // cache key -> queued or running job, so a waiting click can raise its priority
let running = null;
let seqNo = 0;

function enqueue(key, fen, go, multipv, prio) {
  const job = { key, fen, go, multipv, prio, seq: ++seqNo, aborted: false };
  job.promise = new Promise((resolve) => { job.resolve = resolve; });
  queue.push(job);
  if (key) pending.set(key, job);
  if (prio > 0 && running && running.prio === 0) { running.aborted = true; if (worker) worker.postMessage('stop'); }
  pump();
  return job;
}

function pump() {
  if (running || !queue.length) return;
  queue.sort((x, y) => y.prio - x.prio || x.seq - y.seq);
  const job = queue.shift();
  running = job;
  start().then((ok) => {
    if (!ok || job.aborted) return finish(job, null);
    current = { resolve: (r) => finish(job, r), turn: job.fen.split(' ')[1], lines: [] };
    worker.postMessage(`setoption name MultiPV value ${job.multipv}`);
    worker.postMessage('position fen ' + job.fen);
    worker.postMessage(job.go);
  });
}

function finish(job, result) {
  running = null;
  if (job.key) pending.delete(job.key);
  job.resolve(job.aborted ? null : result);
  pump();
}

function cached(key, fen, go, multipv, prio) {
  if (cache.has(key)) {
    const job = pending.get(key);
    if (job && job.prio < prio && !job.aborted) {       // someone now needs a result that was only queued as look-ahead
      job.prio = prio;
      if (running === job) { /* already searching: it will finish normally */ }
    }
    return cache.get(key);
  }
  const job = enqueue(key, fen, go, multipv, prio);
  const result = job.promise.then((r) => { if (!r) cache.delete(key); return r; });
  cache.set(key, result);
  return result;
}

/**
 * Several candidate lines at once, like an analysis board.
 * Resolves to {cp, best, lines: [{uci, cp, mate, pv}]} with cp from White's view, best line first.
 * prio 0 = quiet look-ahead (stopped if the user asks for something), 1 = the user is waiting.
 */
export function analyse(fen, depth = 14, multipv = 5, prio = 1) {
  return cached(`${fen}|${depth}|mpv${multipv}`, fen, `go depth ${depth}`, multipv, prio);
}

/** Look ahead: analyse a position quietly so it is ready if the user goes there. */
export const prefetch = (fen, depth = 14, multipv = 5) => analyse(fen, depth, multipv, 0);

/** Same as evaluate(), but quiet: for positions you might play into next. */
export const prefetchEval = (fen, depth = 12) => cached(fen + '|' + depth, fen, `go depth ${depth}`, 1, 0);

/** Drop look-ahead that has not started, and stop one that has; call when the user moves to a different position. */
export function cancelPrefetch() {
  for (let i = queue.length - 1; i >= 0; i--) {
    const job = queue[i];
    if (job.prio === 0) { queue.splice(i, 1); job.aborted = true; finish2(job); }
  }
  if (running && running.prio === 0 && worker) { running.aborted = true; worker.postMessage('stop'); }
}
function finish2(job) {
  if (job.key) { pending.delete(job.key); cache.delete(job.key); }
  job.resolve(null);
}

/** Evaluate a position. Resolves to {cp, mate, best} or null if the engine is unavailable. */
export function evaluate(fen, depth = 12) {
  return cached(fen + '|' + depth, fen, `go depth ${depth}`, 1, 1);
}

/** A quick strong move, used only after the user has chosen to play past a mistake and the database is empty. */
export function bestMove(fen, ms = 400) {
  return enqueue(null, fen, `go movetime ${ms}`, 1, 1).promise.then((r) => (r ? r.best : null));
}

export const warmUp = () => start();
