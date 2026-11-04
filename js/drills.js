// Mate drills: checkmate with a bare minimum of material against a clock. You play the attacker; the engine defends.
import { Chess } from '../lib/chess.js';
import { Board } from './board.js';
import * as store from './store.js';
import { analyse, prefetch, cancelPrefetch, bestMove, warmUp } from './engine.js';
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
const prefs = () => {
  const p = store.S().prefs;
  p.drill = { mode: 'mate', kind: 'kq', time: 60, cat: 'all', ctime: 'real', ...(p.drill || {}) };
  return p.drill;
};

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
  premove: true,
});

function chip(attr, val, label, on) {
  return `<button type="button" class="chip${on ? ' on' : ''}" data-${attr}="${val}" aria-pressed="${on}">${esc(label)}</button>`;
}
const fmtTime = (ms) => {
  const t = Math.max(0, ms);
  const m = Math.floor(t / 60000), s = (t % 60000) / 1000;
  return m ? `${m}:${s.toFixed(1).padStart(4, '0')}` : s.toFixed(1);
};

// ---------- real positions (Convert mode) ----------

const CATS = [['all', 'Any'], ['pawns', 'Pawns: promote'], ['rook', 'Rook endings'], ['queen', 'Queen'], ['ladder', 'Ladder mate'], ['mixed', 'Mixed']];
const CTIMES = [['real', 'Real clock'], [30, '30 s'], [60, '1 min'], [120, '2 min'], [180, '3 min']];
let bank = null;
async function loadBank() {
  if (bank) return bank;
  try {
    const r = await fetch('data/conversions.json');
    const j = r.ok ? await r.json() : { positions: [] };
    bank = j.positions || [];
  } catch (e) { bank = []; }
  return bank;
}
const recent = [];   // the last few positions you were given, so they do not come straight back

function renderSetup() {
  const p = prefs();
  const convert = p.mode === 'convert';
  $('drModes').innerHTML = chip('mode', 'mate', 'Checkmate drills', !convert) + chip('mode', 'convert', 'Convert real games', convert);
  $('drMateRows').hidden = convert;
  $('drConvertRows').hidden = !convert;
  $('drIntro').textContent = convert
    ? 'Real positions from Lichess games, with the clock you really had. The side that was winning is yours: convert it to checkmate before your time runs out. The engine defends.'
    : 'Deliver checkmate before your clock runs out. You play the stronger side from a random position, and the engine defends as well as it can.';
  const d = data();
  if (convert) {
    $('drCats').innerHTML = CATS.map(([k, l]) => chip('cat', k, l, p.cat === k)).join('');
    $('drCTimes').innerHTML = CTIMES.map(([k, l]) => chip('ctime', k, l, String(p.ctime) === String(k))).join('');
    const wins = d.wins['cv'] || 0, fails = d.fails['cv'] || 0;
    loadBank().then((b) => {
      const n = b.filter((e) => p.cat === 'all' || e.cat.includes(p.cat)).length;
      $('drBests').textContent = (n ? `${n} position${n === 1 ? '' : 's'} in this set. ` : 'No positions in this set yet. ') + (wins || fails ? `Converted ${wins}, missed ${fails}.` : '');
    });
  } else {
    $('drKinds').innerHTML = KINDS.map((k) => chip('kind', k.id, k.name, p.kind === k.id)).join('');
    $('drTimes').innerHTML = TIMES.map(([s, l]) => chip('time', s, l, p.time === s)).join('');
    const best = d.best[`${p.kind}:${p.time}`];
    const wins = d.wins[p.kind] || 0, fails = d.fails[p.kind] || 0;
    $('drBests').textContent = best ? `Your fastest ${KINDS.find((k) => k.id === p.kind).name.toLowerCase()} mate in ${TIMES.find(([s]) => s === p.time)[1]}: ${fmtTime(best)} s. Record: ${wins} mated, ${fails} missed.` : (wins || fails ? `Record: ${wins} mated, ${fails} missed.` : 'No attempts yet.');
  }
}

$('drModes').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) { prefs().mode = b.dataset.mode; store.save(); renderSetup(); } });
$('drKinds').addEventListener('click', (e) => { const b = e.target.closest('[data-kind]'); if (b) { prefs().kind = b.dataset.kind; store.save(); renderSetup(); } });
$('drTimes').addEventListener('click', (e) => { const b = e.target.closest('[data-time]'); if (b) { prefs().time = +b.dataset.time; store.save(); renderSetup(); } });
$('drCats').addEventListener('click', (e) => { const b = e.target.closest('[data-cat]'); if (b) { prefs().cat = b.dataset.cat; store.save(); renderSetup(); } });
$('drCTimes').addEventListener('click', (e) => { const b = e.target.closest('[data-ctime]'); if (b) { const v = b.dataset.ctime; prefs().ctime = v === 'real' ? 'real' : +v; store.save(); renderSetup(); } });

export function showDrills() {
  if (R) stopRun();
  $('drSetup').hidden = false; $('drPlay').hidden = true;
  renderSetup();
  warmUp();
}

// ---------- a run ----------

let R = null;     // the position being played
export const currentFen = () => (R ? R.chess.fen() : null);
export const drillBoard = () => board;
export const currentUser = () => (R ? R.user : null);
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

function stopRun() { if (R) R.id = -1; R = null; clearInterval(timer); timer = null; board.clearPremoves(); board.setEnabled(false); board.setArrows([]); cancelPrefetch(); }
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
  el.classList.toggle('on', !!R.turnStart);   // lit while your clock is running, like chess.com
  if (left <= 0) end(false, 'Out of time');
}

/** Start a position: { id, name, title, fen, user, seconds, inc, info (html), again } */
function begin(spec) {
  clearInterval(timer);
  board.clearPremoves();
  R = {
    id: ++seq, kind: { id: spec.id, name: spec.name }, seconds: spec.seconds, inc: spec.inc || 0, user: spec.user, chess: new Chess(spec.fen),
    left: spec.seconds * 1000, turnStart: 0, moves: 0, hints: 0, over: false, again: spec.again, convert: !!spec.convert,
  };
  $('drSetup').hidden = true; $('drPlay').hidden = false; $('drResult').hidden = true;
  $('drTitle').textContent = spec.title;
  $('drStreak').textContent = streak ? `Streak ${streak}` : '';
  $('drInfo').innerHTML = spec.info || '';
  $('drInfo').hidden = !spec.info;
  $('drOppClock').hidden = !spec.oppSeconds;                       // a real game's opponent clock, shown as it was
  if (spec.oppSeconds) $('drOppClock').textContent = fmtTime(spec.oppSeconds * 1000);
  render();
  board.setEnabled(false);
  setStatus('Get ready', '');
  timer = setInterval(tick, 50);
  tick();
  const run = R;
  if (run.chess.turn() === run.user) prefetchReplies();   // the engine warms up during the count-in
  // a short orientation first, so you know which side you are and which way you are going before the clock starts
  countIn(run, streak ? 2 : 3).then(() => {
    if (!R || R.id !== run.id) return;
    board.setEnabled(true, R.user);
    board.canMove = true;
    setStatus(spec.convert ? 'Convert it to checkmate' : 'Mate before the clock runs out', '');
    if (R.chess.turn() === R.user) R.turnStart = performance.now();
    else opponentTurn();     // the real position had the opponent to move
  });
}

/** Cover the board for a moment: your colour, the direction your pieces move, who starts, then 3-2-1 (tap or Enter to skip). */
function countIn(run, steps) {
  return new Promise((resolve) => {
    const el = $('drCount');
    const side = run.user === 'w' ? 'White' : 'Black';
    el.innerHTML = `<div class="drc-card">
      <div class="drc-side ${run.user === 'w' ? 'white' : 'black'}">You play <b>${side}</b></div>
      <div class="drc-dir"><span class="drc-arrow">↑</span> Your pieces start at the bottom and move <b>up</b> the board</div>
      <div class="drc-num" id="drNum">${steps}</div>
      <div class="drc-sub">${run.chess.turn() === run.user ? 'You move first' : 'The engine moves first'} · tap to start now</div>
    </div>`;
    el.hidden = false;
    let n = steps;
    const finish = () => { clearInterval(iv); window.removeEventListener('keydown', onKey); el.hidden = true; el.onclick = null; resolve(); };
    const onKey = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); finish(); } };
    const iv = setInterval(() => {
      n -= 1;
      if (n <= 0 || !R || R.id !== run.id) finish();
      else $('drNum').textContent = n;
    }, 800);
    el.onclick = finish;
    window.addEventListener('keydown', onKey);
  });
}

function startMate() {
  const p = prefs();
  const kind = KINDS.find((k) => k.id === p.kind);
  const pos = makePosition(kind);
  if (!pos) { setStatus('Could not set up a position. Try again.', 'bad'); return; }
  begin({ id: kind.id, name: kind.name, title: `${kind.name} mate · ${TIMES.find(([s]) => s === p.time)[1]}`, fen: pos.fen, user: pos.attacker, seconds: p.time, again: startMate });
}

const parseInc = (tc) => { const m = /^\d+\+(\d+)$/.exec(tc || ''); return m ? +m[1] : 0; };

async function startConvert() {
  const p = prefs();
  const all = await loadBank();
  const pool = all.map((e, i) => ({ e, i })).filter(({ e }) => p.cat === 'all' || e.cat.includes(p.cat));
  if (!pool.length) { $('drBests').textContent = 'No positions in this set yet. Try another set.'; showDrills(); return; }
  const fresh = pool.filter(({ i }) => !recent.includes(i));
  const choices = fresh.length ? fresh : pool;
  const { e, i } = choices[rand(choices.length)];
  recent.push(i); if (recent.length > 25) recent.shift();
  const real = p.ctime === 'real';
  const seconds = real ? Math.max(20, Math.min(300, Math.round(e.wc))) : +p.ctime;
  const inc = real ? parseInc(e.tc) : 0;
  const catName = (CATS.find(([k]) => k === (p.cat === 'all' ? e.cat[0] : p.cat)) || [0, 'Mixed'])[1];
  const where = e.synthetic ? 'A practice position.' :
    `From a real ${esc(e.ev || 'online')} game${e.tc ? ` (${esc(e.tc.replace('+', ' + '))})` : ''}${e.elo ? `, rated about ${e.elo}` : ''}. In the game you had ${fmtTime(e.wc * 1000)} s and your opponent ${fmtTime(e.lc * 1000)} s.${e.site ? ` <a href="https://lichess.org/${esc(e.site)}" target="_blank" rel="noopener">See the game</a>` : ''}`;
  begin({
    id: 'cv', name: 'Convert', convert: true, title: `Convert · ${catName} · ${real ? 'real clock' : seconds + ' s'}`, fen: e.fen, user: e.winner, seconds, inc,
    oppSeconds: !e.synthetic && real ? e.lc : 0,
    info: `${where}${inc ? ` Increment: +${inc} s per move.` : ''}`, again: startConvert,
  });
}

// The opponent answers instantly, like a premoving human: while you think, the engine works out its reply to each move
// you could play (the engine keeps every result, so a reply it has already found costs nothing).
const REPLY_DEPTH = 8;
function prefetchReplies() {
  const g = R.chess, fen = g.fen();
  const weight = (m) => (m.san.includes('#') ? 3 : m.san.includes('+') ? 2 : m.captured ? 1 : 0);
  const moves = g.moves({ verbose: true }).sort((a, b) => weight(b) - weight(a));   // the likeliest moves first
  for (const m of moves) {
    const c = new Chess(fen);
    c.move(m);
    if (!c.isGameOver()) prefetch(c.fen(), REPLY_DEPTH, 1);
  }
}

/** Play the next queued premove if it is legal now; one that is not cancels the rest. */
function runPremoves() {
  if (!R || R.over || R.chess.turn() !== R.user) return;
  const pm = board.premoves[0];
  if (!pm) return;
  const legal = R.chess.moves({ square: pm.from, verbose: true }).some((m) => m.to === pm.to);
  board.shiftPremove();
  if (legal) onUserMove(pm.from, pm.to);
  else board.clearPremoves();
}

function pauseClock() { if (R.turnStart) { R.left -= performance.now() - R.turnStart; R.turnStart = 0; } }

async function onUserMove(from, to) {
  if (!R || R.over || R.chess.turn() !== R.user) return;
  const g = R.chess;
  const legal = g.moves({ square: from, verbose: true }).find((m) => m.to === to && (!m.promotion || m.promotion === 'q'));
  if (!legal) { render(); return; }
  pauseClock();
  if (R.left <= 0) { end(false, 'Out of time'); return; }
  const mv = g.move({ from, to, promotion: legal.promotion });
  R.moves += 1;
  R.left += R.inc * 1000;                    // the increment, as on a real clock
  render();
  play(moveSound(mv, g));
  if (g.isCheckmate()) { end(true, 'Checkmate'); return; }
  if (g.isGameOver()) { end(false, g.isStalemate() ? 'Stalemate: no legal moves left, but not in check' : 'Draw: not enough material left to mate'); return; }
  opponentTurn();
}

async function opponentTurn() {
  const id = R.id, g = R.chess;
  board.setEnabled(true, R.user);
  board.canMove = false;                     // you may queue premoves while the opponent replies
  let uci = null;
  try { const r = await analyse(g.fen(), REPLY_DEPTH, 1, 1); uci = r && r.best; } catch (e) { uci = null; }
  if (!R || R.id !== id) return;
  cancelPrefetch();                          // the answers to the moves you did not play are no longer needed
  const replies = g.moves({ verbose: true });
  let reply = replies.find((m) => m.from + m.to + (m.promotion || '') === uci);
  if (!reply) reply = replies[rand(replies.length)];
  const rm = g.move(reply);
  render();
  play(moveSound(rm, g));
  if (g.isCheckmate()) { end(false, 'You were checkmated'); return; }
  if (g.isGameOver()) { end(false, 'Draw: the position repeated, or the fifty-move rule applied'); return; }
  board.canMove = true;
  R.turnStart = performance.now();
  prefetchReplies();
  runPremoves();
}

function end(won, why) {
  if (!R || R.over) return;
  pauseClock();
  R.over = true;
  clearInterval(timer);
  board.clearPremoves();
  board.setEnabled(false);
  cancelPrefetch();
  const d = data(), k = R.convert ? 'cv' : R.kind.id;
  const used = R.seconds * 1000 - Math.max(0, R.left);
  let line;
  if (won) {
    streak += 1;
    d.wins[k] = (d.wins[k] || 0) + 1;
    let record = false;
    if (!R.convert) {
      const key = `${k}:${R.seconds}`;
      record = R.hints === 0 && (!d.best[key] || used < d.best[key]);
      if (record) d.best[key] = used;
    }
    play('done');
    setStatus(R.convert ? 'Converted' : 'Checkmate', 'good');
    line = `<h3>${R.convert ? 'Converted: checkmate' : 'Checkmate'} in ${R.moves} move${R.moves === 1 ? '' : 's'}</h3><p class="muted">${fmtTime(Math.max(0, R.left))} s left on your clock.${R.hints ? ' Hints were used, so this does not count as a record.' : record ? ' <b>New fastest time.</b>' : ''}</p>`;
  } else {
    streak = 0;
    d.fails[k] = (d.fails[k] || 0) + 1;
    play('check');
    setStatus(why, 'bad');
    line = `<h3>${esc(why)}</h3><p class="muted">${R.moves} move${R.moves === 1 ? '' : 's'} played. ${R.convert ? 'Winning positions are won by finding the plan quickly: try another.' : 'Try the same drill again.'}</p>`;
  }
  store.save();
  $('drClock').classList.remove('low');
  $('drStreak').textContent = streak ? `Streak ${streak}` : '';
  $('drResult').hidden = false;
  $('drResult').innerHTML = `${line}<div class="row"><button type="button" class="primary" id="drNext">Next position</button><button type="button" class="ghost" id="drChange">Change drill</button></div>`;
  const again = R.again;
  $('drNext').onclick = () => again();
  $('drChange').onclick = () => showDrills();
  $('drNext').focus();
}

// ---------- controls ----------

$('drStart').addEventListener('click', () => { streak = 0; (prefs().mode === 'convert' ? startConvert : startMate)(); });
$('drBack').addEventListener('click', () => showDrills());
$('drSkip').addEventListener('click', () => { if (R && R.again) R.again(); });
$('drHint').addEventListener('click', async () => {
  if (!R || R.over || R.chess.turn() !== R.user) return;
  const id = R.id;
  R.hints += 1;
  let uci = null;
  try { uci = await bestMove(R.chess.fen(), 150); } catch (e) { uci = null; }
  if (!R || R.id !== id || R.over || !uci) return;
  board.setArrows([{ from: uci.slice(0, 2), to: uci.slice(2, 4), color: '#003088', opacity: 0.55, width: 17 / 64 }]);
});
