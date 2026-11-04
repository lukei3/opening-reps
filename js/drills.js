// Mate drills: checkmate with a bare minimum of material against a clock. You play the attacker; the engine defends.
import { Chess } from '../lib/chess.js';
import { Board } from './board.js';
import * as store from './store.js';
import { bestMove, warmUp } from './engine.js';
import { play, moveSound } from './sounds.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const KINDS = [
  { id: 'kq', name: 'Queen', pieces: ['Q'] },
  { id: 'kr', name: 'Rook', pieces: ['R'] },
  { id: 'krr', name: 'Two rooks', pieces: ['R', 'R'] },
  { id: 'kbb', name: 'Two bishops', pieces: ['B', 'B'], oppositeBishops: true },
  { id: 'kbn', name: 'Bishop + knight', pieces: ['B', 'N'] },
];
const TIMES = [[15, '15 s'], [30, '30 s'], [60, '1 min'], [120, '2 min'], [180, '3 min'], [300, '5 min']];

const data = () => {
  const s = store.S();
  s.drills = s.drills || { best: {}, wins: {}, fails: {} };
  s.drills.best = s.drills.best || {}; s.drills.wins = s.drills.wins || {}; s.drills.fails = s.drills.fails || {};
  return s.drills;
};
const prefs = () => { const p = store.S().prefs; p.drill = p.drill || { kind: 'kq', time: 60 }; return p.drill; };

// ---------- making a position ----------

const rand = (n) => Math.floor(Math.random() * n);
const FILES = 'abcdefgh';
const sqName = (f, r) => FILES[f] + (r + 1);

/** A random, fair starting position: the attacker (you) to move, nothing hanging, not mate in one. */
export function makePosition(kind) {
  for (let tries = 0; tries < 5000; tries += 1) {
    const used = new Set();
    const take = () => { for (;;) { const f = rand(8), r = rand(8), k = f + ',' + r; if (!used.has(k)) { used.add(k); return [f, r]; } } };
    const ak = take(), dk = take();
    const near = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) <= 1;
    if (near(ak, dk)) continue;
    const pcs = kind.pieces.map((p) => ({ p, sq: take() }));
    if (kind.oppositeBishops) {
      const colours = pcs.filter((x) => x.p === 'B').map((x) => (x.sq[0] + x.sq[1]) % 2);
      if (colours[0] === colours[1]) continue;
    }
    // a piece the lone king can simply take is not a drill
    if (pcs.some((x) => near(x.sq, dk) && !near(x.sq, ak))) continue;
    const attacker = Math.random() < 0.5 ? 'w' : 'b';
    const defender = attacker === 'w' ? 'b' : 'w';
    const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
    const put = (sq, letter, colour) => { grid[7 - sq[1]][sq[0]] = colour === 'w' ? letter.toUpperCase() : letter.toLowerCase(); };
    put(ak, 'k', attacker); put(dk, 'k', defender);
    pcs.forEach((x) => put(x.sq, x.p, attacker));
    const rows = grid.map((row) => { let s = '', n = 0; for (const c of row) { if (c) { if (n) s += n; n = 0; s += c; } else n += 1; } return n ? s + n : s; }).join('/');
    try {
      // the defender must not already be in check with the attacker to move
      if (new Chess(`${rows} ${defender} - - 0 1`).inCheck()) continue;
      const g = new Chess(`${rows} ${attacker} - - 0 1`);
      if (g.isGameOver()) continue;
      if (g.moves({ verbose: true }).some((m) => { g.move(m); const mate = g.isCheckmate(); g.undo(); return mate; })) continue;   // no mate in one
      return { fen: g.fen(), attacker };
    } catch (e) { /* not a legal position; try again */ }
  }
  return null;
}

// ---------- setup screen ----------

const board = new Board($('drBoard'), {
  getTargets: (from) => (R ? R.chess.moves({ square: from, verbose: true }).map((m) => m.to) : []),
  onMove: (from, to) => onUserMove(from, to),
});

function chip(attr, val, label, on) {
  return `<button type="button" class="chip${on ? ' on' : ''}" data-${attr}="${val}" aria-pressed="${on}">${esc(label)}</button>`;
}
const fmtTime = (ms) => {
  const t = Math.max(0, ms);
  const m = Math.floor(t / 60000), s = (t % 60000) / 1000;
  return m ? `${m}:${s.toFixed(1).padStart(4, '0')}` : s.toFixed(1);
};

function renderSetup() {
  const p = prefs();
  $('drKinds').innerHTML = KINDS.map((k) => chip('kind', k.id, k.name, p.kind === k.id)).join('');
  $('drTimes').innerHTML = TIMES.map(([s, l]) => chip('time', s, l, p.time === s)).join('');
  const d = data(), best = d.best[`${p.kind}:${p.time}`];
  const wins = d.wins[p.kind] || 0, fails = d.fails[p.kind] || 0;
  $('drBests').textContent = best ? `Your fastest ${KINDS.find((k) => k.id === p.kind).name.toLowerCase()} mate in ${TIMES.find(([s]) => s === p.time)[1]}: ${fmtTime(best)} s. Record: ${wins} mated, ${fails} missed.` : (wins || fails ? `Record: ${wins} mated, ${fails} missed.` : 'No attempts yet.');
}

$('drKinds').addEventListener('click', (e) => { const b = e.target.closest('[data-kind]'); if (b) { prefs().kind = b.dataset.kind; store.save(); renderSetup(); } });
$('drTimes').addEventListener('click', (e) => { const b = e.target.closest('[data-time]'); if (b) { prefs().time = +b.dataset.time; store.save(); renderSetup(); } });

export function showDrills() {
  if (R) stopRun();
  $('drSetup').hidden = false; $('drPlay').hidden = true;
  renderSetup();
  warmUp();
}

// ---------- a run ----------

let R = null;     // the position being played
export const currentFen = () => (R ? R.chess.fen() : null);
let seq = 0;
let streak = 0;
let timer = null;

const pieceMap = (g) => {
  const m = {};
  for (const row of g.board()) for (const p of row) if (p) m[p.square] = p.color + p.type.toUpperCase();
  return m;
};
const lastMoveOf = (g) => { const h = g.history({ verbose: true }); const l = h[h.length - 1]; return l ? [l.from, l.to] : null; };
const kingSquare = (g, color) => { for (const row of g.board()) for (const p of row) if (p && p.type === 'k' && p.color === color) return p.square; return null; };

function stopRun() { if (R) R.id = -1; R = null; clearInterval(timer); timer = null; board.setEnabled(false); board.setArrows([]); }
function setStatus(text, cls = '') { const el = $('drStatus'); el.textContent = text; el.className = 'status ' + cls; }

function render() {
  const g = R.chess;
  board.set({ pieces: pieceMap(g), orientation: R.user, lastMove: lastMoveOf(g), check: g.inCheck() ? kingSquare(g, g.turn()) : null });
  board.setArrows([]);
}

function tick() {
  if (!R || R.over) return;
  const left = R.left - (R.turnStart ? performance.now() - R.turnStart : 0);
  const el = $('drClock');
  el.textContent = fmtTime(left);
  el.classList.toggle('low', left < 10000);
  if (left <= 0) end(false, 'Out of time');
}

function startPosition(kindId, seconds) {
  const kind = KINDS.find((k) => k.id === kindId);
  const pos = makePosition(kind);
  if (!pos) { setStatus('Could not set up a position. Try again.', 'bad'); return; }
  clearInterval(timer);
  R = { id: ++seq, kind, seconds, user: pos.attacker, chess: new Chess(pos.fen), left: seconds * 1000, turnStart: 0, moves: 0, hints: 0, over: false };
  $('drSetup').hidden = true; $('drPlay').hidden = false; $('drResult').hidden = true;
  $('drTitle').textContent = `${kind.name} mate · ${TIMES.find(([s]) => s === seconds)[1]}`;
  $('drStreak').textContent = streak ? `Streak ${streak}` : '';
  render();
  board.setEnabled(true, R.user);
  setStatus('Mate before the clock runs out', '');
  R.turnStart = performance.now();
  timer = setInterval(tick, 50);
  tick();
}

function pauseClock() { if (R.turnStart) { R.left -= performance.now() - R.turnStart; R.turnStart = 0; } }

async function onUserMove(from, to) {
  if (!R || R.over || R.chess.turn() !== R.user) return;
  const g = R.chess;
  const legal = g.moves({ square: from, verbose: true }).find((m) => m.to === to);
  if (!legal) { render(); return; }
  const id = R.id;
  pauseClock();
  if (R.left <= 0) { end(false, 'Out of time'); return; }
  const mv = g.move({ from, to, promotion: legal.promotion });
  R.moves += 1;
  render();
  play(moveSound(mv, g));
  if (g.isCheckmate()) { end(true, 'Checkmate'); return; }
  if (g.isGameOver()) { end(false, g.isStalemate() ? 'Stalemate: no legal moves left, but not in check' : 'Draw: not enough material left to mate'); return; }
  board.setEnabled(false);
  const t0 = performance.now();
  let uci = null;
  try { uci = await bestMove(g.fen(), 100); } catch (e) { uci = null; }
  if (!R || R.id !== id) return;
  const replies = g.moves({ verbose: true });
  let reply = replies.find((m) => m.from + m.to + (m.promotion || '') === uci);
  if (!reply) reply = replies[rand(replies.length)];
  await sleep(Math.max(0, 140 - (performance.now() - t0)));
  if (!R || R.id !== id) return;
  const rm = g.move(reply);
  render();
  play(moveSound(rm, g));
  if (g.isGameOver()) { end(false, 'Draw: the position repeated or the fifty-move rule applied'); return; }
  board.setEnabled(true, R.user);
  R.turnStart = performance.now();
}

function end(won, why) {
  if (!R || R.over) return;
  pauseClock();
  R.over = true;
  clearInterval(timer);
  board.setEnabled(false);
  const d = data(), k = R.kind.id;
  const used = R.seconds * 1000 - Math.max(0, R.left);
  let line;
  if (won) {
    streak += 1;
    d.wins[k] = (d.wins[k] || 0) + 1;
    const key = `${k}:${R.seconds}`;
    const record = R.hints === 0 && (!d.best[key] || used < d.best[key]);
    if (record) d.best[key] = used;
    play('done');
    setStatus('Checkmate', 'good');
    line = `<h3>Checkmate in ${R.moves} move${R.moves === 1 ? '' : 's'}</h3><p class="muted">${fmtTime(used)} s used, ${fmtTime(R.left)} s left.${R.hints ? ' Hints were used, so this does not count as a record.' : record ? ' <b>New fastest time.</b>' : ''}</p>`;
  } else {
    streak = 0;
    d.fails[k] = (d.fails[k] || 0) + 1;
    play('check');
    setStatus(why, 'bad');
    line = `<h3>${esc(why)}</h3><p class="muted">${R.moves} move${R.moves === 1 ? '' : 's'} played. Try the same drill again.</p>`;
  }
  store.save();
  $('drClock').classList.remove('low');
  $('drStreak').textContent = streak ? `Streak ${streak}` : '';
  $('drResult').hidden = false;
  $('drResult').innerHTML = `${line}<div class="row"><button type="button" class="primary" id="drNext">Next position</button><button type="button" class="ghost" id="drChange">Change drill</button></div>`;
  $('drNext').onclick = () => startPosition(R.kind.id, R.seconds);
  $('drChange').onclick = () => showDrills();
  $('drNext').focus();
}

// ---------- controls ----------

$('drStart').addEventListener('click', () => { const p = prefs(); streak = 0; startPosition(p.kind, p.time); });
$('drBack').addEventListener('click', () => showDrills());
$('drSkip').addEventListener('click', () => { if (R) startPosition(R.kind.id, R.seconds); });
$('drHint').addEventListener('click', async () => {
  if (!R || R.over || R.chess.turn() !== R.user) return;
  const id = R.id;
  R.hints += 1;
  let uci = null;
  try { uci = await bestMove(R.chess.fen(), 150); } catch (e) { uci = null; }
  if (!R || R.id !== id || R.over || !uci) return;
  board.setArrows([{ from: uci.slice(0, 2), to: uci.slice(2, 4), color: '#003088', opacity: 0.55, width: 17 / 64 }]);
});
