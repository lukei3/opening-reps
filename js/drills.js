// Mate drills: checkmate with a bare minimum of material against a clock. You play the attacker; the engine defends.
import { Chess } from '../lib/chess.js';
import { Board } from './board.js';
import * as store from './store.js';
import { analyse, evaluate, prefetch, cancelPrefetch, bestMove, warmUp } from './engine.js';
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
  p.drill = { mode: 'mate', kind: 'kq', time: 60, cat: 'all', ctime: 'real', countIn: true, ...(p.drill || {}) };
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
const CTIMES = [['real', 'Real clock'], [30, '30 s'], [60, '1 min'], [120, '2 min'], [180, '3 min'], [300, '5 min']];
const LEVELS = [['any', 'Any'], ['standard', 'Straightforward'], ['tricky', 'Tricky']];
const levelOf = (e) => e.level || 'standard';
const inSet = (e, p) => (p.cat === 'all' || e.cat.includes(p.cat)) && (!p.level || p.level === 'any' || levelOf(e) === p.level);
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
  $('drCountToggle').checked = p.countIn !== false;
  const d = data();
  if (convert) {
    $('drLevels').innerHTML = LEVELS.map(([k, l]) => chip('level', k, l, (p.level || 'any') === k)).join('');
    $('drCats').innerHTML = CATS.map(([k, l]) => chip('cat', k, l, p.cat === k)).join('');
    $('drCTimes').innerHTML = CTIMES.map(([k, l]) => chip('ctime', k, l, String(p.ctime) === String(k))).join('');
    const wins = d.wins['cv'] || 0, fails = d.fails['cv'] || 0;
    loadBank().then((b) => {
      const n = b.filter((e) => inSet(e, p)).length;
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

$('drCountToggle').addEventListener('change', () => { prefs().countIn = $('drCountToggle').checked; store.save(); });
$('drModes').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) { prefs().mode = b.dataset.mode; store.save(); renderSetup(); } });
$('drKinds').addEventListener('click', (e) => { const b = e.target.closest('[data-kind]'); if (b) { prefs().kind = b.dataset.kind; store.save(); renderSetup(); } });
$('drTimes').addEventListener('click', (e) => { const b = e.target.closest('[data-time]'); if (b) { prefs().time = +b.dataset.time; store.save(); renderSetup(); } });
$('drLevels').addEventListener('click', (e) => { const b = e.target.closest('[data-level]'); if (b) { prefs().level = b.dataset.level; store.save(); renderSetup(); } });
$('drCats').addEventListener('click', (e) => { const b = e.target.closest('[data-cat]'); if (b) { prefs().cat = b.dataset.cat; store.save(); renderSetup(); } });
$('drCTimes').addEventListener('click', (e) => { const b = e.target.closest('[data-ctime]'); if (b) { const v = b.dataset.ctime; prefs().ctime = v === 'real' ? 'real' : +v; store.save(); renderSetup(); } });

export function showDrills() {
  closeAnalysis();
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
  closeAnalysis();
  board.clearPremoves();
  R = {
    id: ++seq, kind: { id: spec.id, name: spec.name }, seconds: spec.seconds, inc: spec.inc || 0, user: spec.user, chess: new Chess(spec.fen),
    left: spec.seconds * 1000, turnStart: 0, moves: 0, hints: 0, over: false, again: spec.again, convert: !!spec.convert,
    spec,                                    // kept so Retry can play the very same position again
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
  (spec.skipCountIn ? Promise.resolve() : countIn(run, 5)).then(() => {
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
  if (prefs().countIn === false) return Promise.resolve();   // switched off: straight into the position
  return new Promise((resolve) => {
    const el = $('drCount');
    const side = run.user === 'w' ? 'White' : 'Black';
    const arrow = '<svg class="drc-up" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4.5 12.5H9.5V21h5v-8.5h5z"/></svg>';
    el.innerHTML = `
      <div class="drc-card">
        <img class="drc-king" src="pieces/cburnett/${run.user}K.svg" alt="">
        <div class="drc-title">You play ${side}</div>
        <div class="drc-line">${arrow}<span>Your pieces move up the board</span></div>
        <div class="drc-note">${run.user === 'b' ? 'The board is turned around so you are at the bottom.<br>' : ''}${run.chess.turn() === run.user ? 'You move first.' : 'The engine moves first.'}</div>
        <div class="drc-ring"><svg viewBox="0 0 44 44"><circle class="bg" cx="22" cy="22" r="20"/><circle class="fg" cx="22" cy="22" r="20" style="animation-duration:${steps}s"/></svg><span id="drNum">${steps}</span></div>
        <div class="drc-actions"><button type="button" class="drc-go">Start now</button><button type="button" class="drc-off">Turn off count-in</button></div>
      </div>`;
    el.hidden = false;
    // centring can leave the card on a half pixel, which makes its text and icons slightly soft: snap it to whole pixels
    const card = el.querySelector('.drc-card'), cr = card.getBoundingClientRect();
    card.style.transform = `translate(${Math.round(cr.left) - cr.left}px, ${Math.round(cr.top) - cr.top}px)`;
    el.querySelector('.drc-off').onclick = (e) => { e.stopPropagation(); prefs().countIn = false; store.save(); finish(); };
    el.querySelector('.drc-go').onclick = (e) => { e.stopPropagation(); finish(); };
    let n = steps;
    const finish = () => { clearInterval(iv); window.removeEventListener('keydown', onKey); el.hidden = true; el.onclick = null; resolve(); };
    const onKey = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); finish(); } };
    const iv = setInterval(() => {
      n -= 1;
      if (n <= 0 || !R || R.id !== run.id) finish();
      else $('drNum').textContent = n;
    }, 1000);
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
  const pool = all.map((e, i) => ({ e, i })).filter(({ e }) => inSet(e, p));
  if (!pool.length) { $('drBests').textContent = 'No positions in this set yet. Try another set.'; showDrills(); return; }
  const fresh = pool.filter(({ i }) => !recent.includes(i));
  const choices = fresh.length ? fresh : pool;
  const { e, i } = choices[rand(choices.length)];
  recent.push(i); if (recent.length > 25) recent.shift();
  const real = p.ctime === 'real';
  const seconds = real ? Math.max(20, Math.min(300, Math.round(e.wc))) : +p.ctime;
  const inc = real ? parseInc(e.tc) : 0;
  const catName = (CATS.find(([k]) => k === (p.cat === 'all' ? e.cat[0] : p.cat)) || [0, 'Mixed'])[1];
  const where = e.synthetic ? (levelOf(e) === 'tricky' ? 'A tricky practice position: it is winning, but only one or two moves keep the win, so look for the plan.' : 'A practice position.') :
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
  if (legal) onUserMove(pm.from, pm.to, true);
  else board.clearPremoves();
}

function pauseClock() { if (R.turnStart) { R.left -= performance.now() - R.turnStart; R.turnStart = 0; } }

async function onUserMove(from, to, autoPromote = false) {
  if (!R || R.over || R.chess.turn() !== R.user) return;
  const g = R.chess;
  const options = g.moves({ square: from, verbose: true }).filter((m) => m.to === to);
  if (!options.length) { render(); return; }
  let promotion = options[0].promotion;       // only set when the pawn reaches the last rank
  if (promotion) {
    if (autoPromote) promotion = 'q';         // a premoved promotion becomes a queen, as on chess.com
    else {
      // chess.com's picker: the pawn sits on the last rank and a column of pieces opens there. Your clock keeps running.
      const id = R.id;
      const shown = pieceMap(g);
      shown[to] = shown[from]; delete shown[from];
      board.set({ pieces: shown, orientation: R.user, lastMove: [from, to] });
      const pick = await board.promptPromotion(to, R.user);
      if (!R || R.id !== id || R.over) return;
      if (!pick) { render(); return; }        // cancelled: the pawn goes back and you can choose another move
      promotion = pick;
    }
  }
  pauseClock();
  if (R.left <= 0) { end(false, 'Out of time'); return; }
  const mv = g.move({ from, to, promotion });
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
  $('drResult').innerHTML = `${line}<div class="row"><button type="button" class="primary" id="drNext">Next position</button><button type="button" class="ghost" id="drAnaOpen">Analyse</button><button type="button" class="ghost" id="drChange">Change drill</button></div>`;
  const again = R.again;
  $('drNext').onclick = () => again();
  $('drAnaOpen').onclick = () => openAnalysis();
  $('drChange').onclick = () => showDrills();
  $('drNext').focus();
}

// ---------- controls ----------

$('drStart').addEventListener('click', () => { streak = 0; (prefs().mode === 'convert' ? startConvert : startMate)(); });
$('drBack').addEventListener('click', () => showDrills());
$('drSkip').addEventListener('click', () => { if (R && R.again) R.again(); });

/** Play the same position again from the start, with a fresh clock and no count-in (you already know the position). */
function retry() {
  if (!R || !R.spec) return;
  begin({ ...R.spec, skipCountIn: true });
}
$('drRetry').addEventListener('click', retry);
window.addEventListener('keydown', (e) => {
  if (e.key !== 'r' && e.key !== 'R') return;
  if (e.ctrlKey || e.metaKey || e.altKey || $('drPlay').hidden || $('tab-drills').hidden) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''))) return;
  retry();
});
$('drHint').addEventListener('click', async () => {
  if (!R || R.over || R.chess.turn() !== R.user) return;
  const id = R.id;
  R.hints += 1;
  let uci = null;
  try { uci = await bestMove(R.chess.fen(), 150); } catch (e) { uci = null; }
  if (!R || R.id !== id || R.over || !uci) return;
  board.setArrows([{ from: uci.slice(0, 2), to: uci.slice(2, 4), color: '#003088', opacity: 0.55, width: 17 / 64 }]);
});


// ---------- analysis: see what happened, and how the position is won ----------

let A = null;   // { token, user, startFen, which: 'game' | 'plan', idx, lines: { game, plan } }
const fullmoveOf = (fen) => parseInt(fen.split(' ')[5], 10) || 1;

function buildLine(startFen, moves) {
  const c = new Chess(startFen);
  const line = { fens: [c.fen()], sans: [], movers: [], ucis: [], evals: [], building: false };
  for (const m of moves) {
    const turn = c.turn();
    const mv = c.move({ from: m.from, to: m.to, promotion: m.promotion });
    line.sans.push(mv.san); line.movers.push(turn); line.ucis.push(mv.from + mv.to + (mv.promotion || '')); line.fens.push(c.fen());
  }
  return line;
}

/** An evaluation chip's text and colour (White's point of view, like every analysis board). */
function chipOf(r) {
  if (!r) return { text: '…', cls: 'z' };
  if (r.text) return r;
  if (r.mate != null && r.mate !== 0) return { text: '#' + Math.abs(r.mate), cls: r.mate > 0 ? 'w' : 'b' };
  const v = Math.round(r.cp / 10) / 10;
  return { text: v === 0 ? '0.0' : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(1), cls: Math.abs(v) <= 0.5 ? 'z' : v > 0 ? 'w' : 'b' };
}

async function evalFor(fen) {
  const g = new Chess(fen);
  if (g.isCheckmate()) return { text: 'Mate', cls: g.turn() === 'w' ? 'b' : 'w' };
  if (g.isDraw() || g.isStalemate() || g.isInsufficientMaterial()) return { text: 'Draw', cls: 'z' };
  try { return await evaluate(fen, 12); } catch (e) { return null; }
}

function pvText(fen, ucis, max = 9) {
  const c = new Chess(fen);
  let no = fullmoveOf(fen), out = '', first = true;
  for (const u of ucis.slice(0, max)) {
    const turn = c.turn();
    let mv;
    try { mv = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); } catch (e) { break; }
    out += turn === 'w' ? `${no}. ${mv.san} ` : `${first ? no + '… ' : ''}${mv.san} `;
    if (turn === 'b') no += 1;
    first = false;
  }
  return out.trim();
}

function openAnalysis() {
  if (!R || !R.spec) return;
  if (!R.over) end(false, 'You gave up to see the analysis');     // an attempt you stop to analyse counts as a miss
  const game = buildLine(R.spec.fen, R.chess.history({ verbose: true }));
  A = { token: ++seq, user: R.user, startFen: R.spec.fen, which: 'game', idx: 0, lines: { game, plan: null } };
  $('drSide').classList.add('analysing');
  $('drAna').hidden = false;
  document.querySelectorAll('#drAna .dra-tabs .chip').forEach((b) => b.classList.toggle('on', b.dataset.line === 'game'));
  board.clearPremoves(); board.setEnabled(false);
  renderAnalysis();
  fillEvals(game, A.token);
}

function closeAnalysis() {
  if (!A) return;
  A = null;
  $('drSide').classList.remove('analysing');
  $('drAna').hidden = true;
  cancelPrefetch();
  if (R) render();                                 // the board shows the real position again
}

const lineOf = () => A.lines[A.which];

async function fillEvals(line, token) {
  for (let i = 0; i < line.fens.length; i += 1) {
    if (!A || A.token !== token) return;
    if (line.evals[i]) continue;
    line.evals[i] = await evalFor(line.fens[i]);
    if (!A || A.token !== token) return;
    if (lineOf() === line) renderMoves();
  }
}

async function buildPlan() {
  const token = A.token;
  const line = { fens: [A.startFen], sans: [], movers: [], ucis: [], evals: [], building: true };
  A.lines.plan = line;
  const c = new Chess(A.startFen);
  for (let ply = 0; ply < 120 && !c.isGameOver(); ply += 1) {
    const u = await bestMove(c.fen(), 110);
    if (!A || A.token !== token) return;
    if (!u) break;
    const turn = c.turn();
    const mv = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    line.sans.push(mv.san); line.movers.push(turn); line.ucis.push(u); line.fens.push(c.fen());
    if (A.which === 'plan') renderMoves();
  }
  line.building = false;
  if (A && A.token === token && A.which === 'plan') renderMoves();
  fillEvals(line, token);
}

function renderMoves() {
  const line = lineOf();
  const startTurn = line.fens[0].split(' ')[1];
  const base = fullmoveOf(line.fens[0]);
  let html = `<span class="dra-ply${A.idx === 0 ? ' cur' : ''}" data-i="0">Start</span>`;
  line.sans.forEach((san, i) => {
    const moveNo = base + Math.floor((i + (startTurn === 'b' ? 1 : 0)) / 2);
    const mover = line.movers[i];
    const prefix = mover === 'w' ? `<span class="dra-no">${moveNo}.</span>` : (i === 0 || line.movers[i - 1] !== 'w' ? `<span class="dra-no">${moveNo}…</span>` : '');
    const chip = chipOf(line.evals[i + 1]);
    html += `${prefix}<span class="dra-ply ${mover === A.user ? 'me' : 'eng'}${A.idx === i + 1 ? ' cur' : ''}" data-i="${i + 1}">${esc(san)}<i class="evbox ${chip.cls} dra-ev">${esc(chip.text)}</i></span>`;
  });
  if (line.building) html += '<span class="dra-wait">working out the plan…</span>';
  const el = $('drAnaMoves');
  el.innerHTML = html;
  const cur = el.querySelector('.cur');
  if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  // the plan grows while the engine works it out, so the buttons follow its length
  $('drAnaPrev').disabled = $('drAnaFirst').disabled = A.idx === 0;
  $('drAnaNext').disabled = $('drAnaLast').disabled = A.idx >= line.fens.length - 1;
}

async function renderAnalysis() {
  const line = lineOf();
  A.idx = Math.max(0, Math.min(A.idx, line.fens.length - 1));
  const fen = line.fens[A.idx];
  const g = new Chess(fen);
  const last = A.idx > 0 ? line.ucis[A.idx - 1] : null;
  board.set({ pieces: pieceMap(g), orientation: A.user, lastMove: last ? [last.slice(0, 2), last.slice(2, 4)] : null, check: g.inCheck() ? kingSquare(g, g.turn()) : null });
  board.setArrows([]);
  renderMoves();
  $('drAnaPrev').disabled = $('drAnaFirst').disabled = A.idx === 0;
  $('drAnaNext').disabled = $('drAnaLast').disabled = A.idx >= line.fens.length - 1;
  // the engine's best lines for this position
  const box = $('drAnaEngine');
  const token = A.token, idx = A.idx, which = A.which;
  if (g.isGameOver()) { box.innerHTML = `<p class="muted small">${g.isCheckmate() ? `Checkmate: ${g.turn() === 'w' ? 'Black' : 'White'} wins.` : 'The game is drawn here.'}</p>`; return; }
  box.innerHTML = '<p class="muted small">The engine is looking…</p>';
  let res = null;
  try { res = await analyse(fen, 14, 3, 1); } catch (e) { res = null; }
  if (!A || A.token !== token || A.idx !== idx || A.which !== which) return;
  const lines = (res && res.lines || []).filter((l) => l.uci);
  if (!lines.length) { box.innerHTML = ''; return; }
  box.innerHTML = lines.map((l) => {
    const chip = chipOf(l);
    return `<div class="dra-line"><i class="evbox ${chip.cls}">${esc(chip.text)}</i><span>${esc(pvText(fen, l.pv && l.pv.length ? l.pv : [l.uci]))}</span></div>`;
  }).join('') + `<p class="muted small">Evaluations are from White's point of view. The arrow on the board is the engine's first choice.</p>`;
  board.setArrows([{ from: lines[0].uci.slice(0, 2), to: lines[0].uci.slice(2, 4), color: '#003088', opacity: 0.55, width: 17 / 64 }]);
}

function anaGo(i) { if (A) { A.idx = i; renderAnalysis(); } }
$('drAnaMoves').addEventListener('click', (e) => { const p = e.target.closest('[data-i]'); if (p) anaGo(+p.dataset.i); });
$('drAnaFirst').addEventListener('click', () => anaGo(0));
$('drAnaPrev').addEventListener('click', () => anaGo(A ? A.idx - 1 : 0));
$('drAnaNext').addEventListener('click', () => anaGo(A ? A.idx + 1 : 0));
$('drAnaLast').addEventListener('click', () => anaGo(A ? lineOf().fens.length - 1 : 0));
$('drAnaClose').addEventListener('click', () => closeAnalysis());
$('drAnalyseBtn').addEventListener('click', () => openAnalysis());
document.querySelector('#drAna .dra-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-line]'); if (!b || !A) return;
  A.which = b.dataset.line; A.idx = 0;
  document.querySelectorAll('#drAna .dra-tabs .chip').forEach((x) => x.classList.toggle('on', x === b));
  if (A.which === 'plan' && !A.lines.plan) buildPlan();
  renderAnalysis();
});
window.addEventListener('keydown', (e) => {
  if (!A || $('tab-drills').hidden || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); anaGo(A.idx - 1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); anaGo(A.idx + 1); }
  else if (e.key === 'Home') { e.preventDefault(); anaGo(0); }
  else if (e.key === 'End') { e.preventDefault(); anaGo(lineOf().fens.length - 1); }
});
