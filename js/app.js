import { Chess } from '../lib/chess.js';
import { Board, pieceSrc } from './board.js';
import { OPENINGS, byId, movesOf } from './openings.js';
import * as store from './store.js';
import { getPosition } from './data.js';
import { evaluate, analyse, prefetch, prefetchEval, cancelPrefetch, bestMove, warmUp } from './engine.js';
import { judge, verdictFromRaw, rawSignals } from './judge.js';
import { chooseBotMove } from './bot.js';
import { bookMeta } from './book.js';
import { openingsDb, nameFromFens } from './names.js';
import { play, moveSound, setSound, soundOn, warmSounds } from './sounds.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = () => store.S();
const cfg = () => store.settings();

store.load();

// ---------- small helpers ----------

function formatLine(sans, from = 0) {
  let out = '';
  sans.forEach((s, i) => {
    const n = Math.floor(i / 2) + 1;
    if (i % 2 === 0) out += `${n}.${s} `;
    else out += (i === 0 || i === from ? `${n}…${s} ` : `${s} `);
  });
  return out.trim();
}
const pieceMap = (g) => {
  const m = {};
  for (const row of g.board()) for (const p of row) if (p) m[p.square] = p.color + p.type.toUpperCase();
  return m;
};
const uciOf = (m) => m.from + m.to + (m.promotion || '');
const sanToUci = (g) => (san) => {
  const m = g.moves({ verbose: true }).find((x) => x.san === san);
  return m ? uciOf(m) : null;
};
const kingSquare = (g, color) => {
  for (const row of g.board()) for (const p of row) if (p && p.type === 'k' && p.color === color) return p.square;
  return null;
};
/** Pawns to one decimal with a proper minus sign; never "−0.0". */
const pawns = (cp) => { const v = Math.round(cp / 10) / 10; return v === 0 ? '0.0' : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(1); };
const fmtEval = (cp) => (cp >= 900 ? '+M' : cp <= -900 ? '−M' : pawns(cp));

function banner(text, err = false) {
  const b = $('banner');
  if (!text) { b.hidden = true; return; }
  b.textContent = text; b.className = 'banner' + (err ? ' err' : ''); b.hidden = false;
}

// ---------- tabs ----------

function showTab(name) {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  for (const t of ['train', 'progress', 'settings']) $('tab-' + t).hidden = t !== name;
  if (name === 'progress') renderProgress();
  if (name === 'settings') renderSettingsInfo();
}
$('tabs').addEventListener('click', (e) => { if (e.target.dataset.tab) showTab(e.target.dataset.tab); });

// ---------- setup form ----------

function fillOpenings(sel) {
  const groups = {};
  OPENINGS.forEach((o) => (groups[o.group] = groups[o.group] || []).push(o));
  sel.innerHTML = Object.entries(groups).map(([g, list]) =>
    `<optgroup label="${esc(g)}">${list.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</optgroup>`).join('');
}
fillOpenings($('opening'));
fillOpenings($('treeOpening'));

function loadPrefs() {
  const p = S().prefs;
  $('opening').value = p.opening || 'start';
  $('customMoves').value = p.customMoves || '';
  $('depthMode').value = p.depthMode || 'move';
  $('depthN').value = p.depthN || 12;
  $('restrict').checked = !!p.restrict;
  updateSetupUi();
}
function savePrefs() {
  Object.assign(S().prefs, {
    opening: $('opening').value, customMoves: $('customMoves').value,
    depthMode: $('depthMode').value, depthN: +$('depthN').value || 12, restrict: $('restrict').checked,
  });
  store.save();
}
function updateSideUi() {
  const side = sideOverride || byId($('opening').value).side;
  document.querySelectorAll('.sidebtn').forEach((b) => b.classList.toggle('on', b.dataset.side === side));
}
function updateSetupUi() {
  updateSideUi();
  const op = byId($('opening').value);
  $('restrictRow').hidden = !op.restrict;
  $('restrictLabel').textContent = op.restrictLabel || '';
  $('depthNRow').hidden = $('depthMode').value !== 'move';
  $('bracketText').textContent = `${cfg().ratingMin}–${cfg().ratingMax} (change in Settings)`;
}
$('opening').addEventListener('change', () => {
  // Picking an opening switches you to its usual side (Sicilian = Black); change the colour afterwards if you want the other one.
  sideOverride = null; S().prefs.sideChosen = false; store.save();
  updateSideUi();
});
document.querySelector('.sidepick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-side]'); if (!b) return;
  sideOverride = b.dataset.side;
  S().prefs.side = sideOverride; S().prefs.sideChosen = true; store.save();
  updateSideUi();
});
['opening', 'depthMode', 'depthN', 'restrict', 'customMoves'].forEach((id) =>
  $(id).addEventListener('change', () => { updateSetupUi(); savePrefs(); }));

// Where a line starts: the Drill button's weak spot, else moves typed in the box, else the chosen opening.
function resolveStart(op, forceMode) {
  if (forceMode !== 'wrong') {
    const typed = $('customMoves').value.replace(/\d+\.(\.\.)?/g, ' ').split(/\s+/).filter(Boolean);
    if (typed.length) {
      const g = new Chess();
      try { typed.forEach((s) => g.move(s)); } catch (e) { return { error: 'Those moves are not a legal game. Check the spelling (e4, Nf3, O-O) or clear the box to use the opening.' }; }
      return { sans: g.history() };
    }
    return { sans: movesOf(op) };
  }
  // earliest position where the user goes wrong, in any opening
  const prefix = [];
  const rec = Object.values(S().weak)
    .filter((w) => store.weakWeight(w) > 0)
    .map((w) => ({ w, sans: w.san ? w.san.split(' ') : [] }))
    .filter((x) => prefix.every((s, i) => x.sans[i] === s))
    .sort((a, b) => a.sans.length - b.sans.length || store.weakWeight(b.w) - store.weakWeight(a.w))[0];
  if (!rec) return { error: 'No mistakes recorded for this opening yet. Play a few lines first.', };
  return { sans: rec.sans, side: rec.w.side };
}

// ---------- game ----------

const board = new Board($('board'), {
  getTargets: (from) => {
    const g = A ? A.chess : G && G.chess;
    return g ? g.moves({ square: from, verbose: true }).map((m) => m.to) : [];
  },
  onMove: (from, to) => onUserMove(from, to),
});

let G = null;
let gameSeq = 0;
let sideOverride = S().prefs.sideChosen ? S().prefs.side : null; // your colour once chosen (Setup or Flip); null = the opening's usual side

function currentCfg() {
  return {
    opening: $('opening').value, depthMode: $('depthMode').value,
    depthN: Math.max(3, +$('depthN').value || 12), restrict: $('restrict').checked, customMoves: $('customMoves').value,
  };
}

// opts.sans replays an exact line (the Reset button, Another line) instead of reading the Setup form.
async function startGame(forceMode, opts) {
  savePrefs();
  const op = byId($('opening').value);
  const st = opts && opts.sans ? { sans: opts.sans } : resolveStart(op, forceMode);
  if (st.error) { banner(st.error, true); return; }
  if (!opts && forceMode !== 'wrong' && $('customMoves').value.trim()) { $('customMoves').value = ''; savePrefs(); } // typed moves are one-off
  if (st.side) { sideOverride = st.side; S().prefs.side = st.side; S().prefs.sideChosen = true; updateSideUi(); }
  const c = currentCfg();
  const g = new Chess();
  try { st.sans.forEach((s) => g.move(s)); } catch (e) { banner('Could not set up that start position.', true); return; }
  const startPly = g.history().length;
  if (c.depthMode === 'move' && 2 * c.depthN <= startPly) c.depthN = Math.ceil(startPly / 2) + 4;

  banner('');
  try { await getPosition(g.fen()); } catch (e) { banner(e.message, true); return; }
  warmUp();
  G = {
    id: ++gameSeq, chess: g, op, cfg: c, user: sideOverride || op.side, startPly, mode: 'play', busy: true,
    path: g.history({ verbose: true }).map(uciOf), data: null, preEval: null, retried: {}, mistakes: 0, decisions: 0,
    sans0: st.sans, pending: null,
  };
  $('setup').hidden = true; $('game').hidden = false;
  $('mistake').hidden = true; $('done').hidden = true; $('promo').hidden = true;
  hideAnalysis();
  board.set({ pieces: pieceMap(g), orientation: G.user, lastMove: lastMoveOf(g) });
  renderMoves(); setStatus('');
  const resetTip = startPly === 0 ? 'Reset: back to the start position' : `Reset: back to where this line began (move ${Math.ceil(startPly / 2)})`;
  $('restartBtn').title = resetTip; $('restartBtn').setAttribute('aria-label', resetTip);
  $('evalLine').textContent = '';
  await advance();
}

function lastMoveOf(g) {
  const h = g.history({ verbose: true });
  return h.length ? [h[h.length - 1].from, h[h.length - 1].to] : null;
}

function renderBoard(keepHeld = false) {
  const g = G.chess;
  board.set({
    pieces: pieceMap(g), orientation: G.user, lastMove: lastMoveOf(g),
    check: g.inCheck() ? kingSquare(g, g.turn()) : null,
  }, keepHeld);
}

function renderMoves() {
  setTimeout(updateOpName, 0);
  const sans = G.chess.history();
  $('moves').innerHTML = sans.map((s, i) => {
    const pre = i < G.startPly ? ' class="pre"' : '';
    const num = i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : '';
    return `<span data-ply="${i + 1}"${pre}>${num}${i >= G.startPly ? `<b>${esc(s)}</b>` : esc(s)}</span>`;
  }).join(' ');
}

function setStatus(text, cls = '') {
  const el = $('status');
  const changed = el.textContent !== text;
  el.textContent = text; el.className = 'status ' + cls;
  if (changed) { void el.offsetWidth; el.classList.add('pulse'); }   // a quick ease-in when the message changes
}

function endReached(data) {
  const g = G.chess, c = G.cfg;
  if (g.isGameOver()) return 'The game is over.';
  if (c.depthMode === 'move' && g.history().length >= 2 * c.depthN) return `Reached move ${c.depthN}.`;
  if (c.depthMode !== 'move' && data && data.movesTotal < cfg().minGamesForData) return 'The database has run out of games here.';
  return null;
}

async function loadData(fen) {
  try { return await getPosition(fen); } catch (e) { banner(e.message, true); return null; }
}

async function advance() {
  const id = G.id;
  while (true) {
    const g = G.chess;
    if (g.isGameOver()) return finish('The game is over.');
    const fen = g.fen();

    if (g.turn() === G.user) {
      // Your turn: unlock the board at once. Explorer data and the engine load while you think.
      const early = G.mode === 'free' ? null : endReached(null);
      if (early) return finish(early);
      G.preFen = fen;
      G.data = null;
      G.dataP = loadData(fen);
      G.preEval = evaluate(fen, cfg().engineDepth);
      G.preEval.then((r) => { if (id === G.id && G.preFen === fen) liveBar(r); });
      G.busy = false;
      board.setEnabled(true, G.user);
      setStatus('');
      G.dataP.then((data) => {
        if (id !== G.id || G.preFen !== fen) return;
        G.data = data;
        lookAheadPlay(data, fen);
        const stillWaiting = G.chess.fen() === fen && !G.busy && G.mode !== 'analysis';
        const why = G.mode === 'free' ? null : endReached(data);
        if (why && stillWaiting) return finish(why);
        if (!data && stillWaiting) setStatus('No database games from here, so only the engine is judging.');
      });
      return;
    }

    const data = await loadData(fen);
    if (id !== G.id) return;
    G.data = data;
    const why = G.mode === 'free' ? null : endReached(data);
    if (why) return finish(why);

    // bot's turn: you can already pick a piece up and hold it; it only moves once the opponent has played
    board.setEnabled(true, G.user);
    board.canMove = false;
    setStatus('');
    let mv = null;
    const pick = chooseBotMove({
      data, fen, side: g.turn(), path: G.path, sans: g.history(),
      restrict: G.cfg.restrict && G.op.restrict ? G.op.restrict : null, toUci: sanToUci(g),
    });
    if (pick) {
      store.noteShown(fen, pick.uci);
      await sleep(cfg().botDelayMs);
      if (id !== G.id) return;
      mv = g.move(pick.san);
    } else if (G.mode === 'free') {
      const best = await bestMove(fen, 400);
      if (id !== G.id) return;
      if (!best) return finish('The game is over.');
      mv = g.move({ from: best.slice(0, 2), to: best.slice(2, 4), promotion: best[4] });
    } else {
      return finish('The database has no more games to play from here.');
    }
    G.path.push(uciOf(mv));
    store.addToTree(G.path, g.history());
    store.save();
    renderBoard(true); renderMoves();
    play(moveSound(mv, g));
  }
}

// ----- user move -----

/**
 * While you think, quietly fetch the opponent's options and the engine's verdict for the moves you are most likely
 * to play (the three most popular). When you play one of them the reply and the check are already waiting.
 */
function lookAheadPlay(data, fen) {
  if (!data || !data.movesTotal) return;
  const top = data.moves.slice().sort((a, b) => b.games - a.games).slice(0, 3).filter((m) => (100 * m.games) / data.movesTotal >= 4);
  for (const m of top) {
    const g2 = new Chess(fen);
    try { g2.move(m.san); } catch (e) { continue; }
    if (g2.isGameOver()) continue;
    getPosition(g2.fen()).catch(() => null);
    prefetchEval(g2.fen(), cfg().engineDepth);
  }
}

function onUserMove(from, to) {
  if (A) { analysisMove(from, to); return; } // exploring the mistake position
  if (!G || G.busy || G.mode === 'over') return;
  const cands = G.chess.moves({ verbose: true }).filter((m) => m.from === from && m.to === to);
  if (!cands.length) return;
  if (cands[0].promotion) { showPromo(from, to, G.user); return; }
  commitUserMove({ from, to });
}

function showPromo(from, to, color) {
  const el = $('promo');
  el.innerHTML = ['q', 'r', 'b', 'n'].map((p) => `<button data-p="${p}"><img src="${pieceSrc(color + p.toUpperCase())}" alt="${p}"></button>`).join('');
  el.hidden = false;
  el.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    el.hidden = true; commitUserMove({ from, to, promotion: b.dataset.p });
  };
}

async function commitUserMove(moveObj) {
  const id = G.id;
  const g = G.chess;
  G.busy = true;
  board.setEnabled(true, G.user); board.canMove = false;   // stay live so a piece can be picked up now; nothing is played until it is your turn again
  const dataP = G.dataP || Promise.resolve(G.data), preEval = G.preEval, fenBefore = G.preFen, side = G.user;
  const sansBefore = g.history();
  const pathBefore = G.path.slice();
  const mv = g.move(moveObj);
  const uci = uciOf(mv);
  G.path.push(uci);
  renderBoard(); renderMoves();
  play(moveSound(mv, g));

  const depth = cfg().engineDepth;
  const afterP = g.isCheckmate() ? Promise.resolve({ cp: side === 'w' ? 1000 : -1000, best: null })
    : g.isGameOver() ? Promise.resolve({ cp: 0, best: null }) : evaluate(g.fen(), depth);

  if (G.mode === 'free') {
    setStatus('Free play: no more stopping on mistakes.');
    const [b, a] = await Promise.all([preEval, afterP]);
    if (id !== G.id) return;
    liveBar(a);
    if (a && liveEvalOn()) $('evalLine').textContent = `Engine after your move: ${fmtEval(a.cp)} (White’s view)` + (b && b.best && b.best !== uci ? ` · it preferred ${prettyUci(fenBefore, b.best)}` : '');
    store.addToTree(G.path, g.history());
    return advance();
  }

  setStatus('');
  afterP.then((a) => { if (id === G.id) liveBar(a); });
  const [before, after, data] = await Promise.all([preEval, afterP, dataP]);
  if (id !== G.id) return;

  const verdict = judge({ data, san: mv.san, uci, side, before, after, moveNo: parseInt(fenBefore.split(' ')[5], 10), s: cfg() });
  if (verdict.mistake && store.isAccepted(fenBefore, mv.san)) verdict.mistake = false; // you told it this move is fine here
  const ply = pathBefore.length;
  const firstTry = !G.retried[ply];
  G.lastCheck = { fenBefore, san: mv.san, uci, data, before, after, verdict, sansBefore, pathBefore, firstTry };
  store.logMove({ t: Date.now(), fen: fenBefore, san: mv.san, line: sansBefore.join(' '), side, raw: verdict.raw, flagged: verdict.mistake, retry: !firstTry });

  if (verdict.mistake) {
    if (firstTry) { G.mistakes++; G.decisions++; store.recordDecision(fenBefore, pathBefore, sansBefore, false, uci, side); }
    G.retried[ply] = true;
    showMistake();
    return;
  }
  if (firstTry) { G.decisions++; store.recordDecision(fenBefore, pathBefore, sansBefore, true, uci, side); }
  store.addToTree(G.path, g.history());
  store.save();
  G.lastEval = after;
  $('evalLine').textContent = '';
  if (G.cfg.depthMode === 'equal' && g.history().length >= 12 && after && Math.abs(after.cp) <= 30) {
    return finish('The position is equal.');
  }
  if (verdict.earlyPass) {
    setStatus(`Early move, so no stop: the engine would prefer something else, but it doesn't lose material.`, 'good');
  } else if (verdict.savedByPractice) {
    const p = verdict.parts;
    setStatus(`Fine in practice${verdict.opening ? ` (${verdict.opening})` : ''}: the engine dislikes it by ${(p.eval.loss / 100).toFixed(1)}, but it scores ${Math.round(100 * p.score.mine)}% for you.`, 'good');
  } else setStatus('');
  return advance();
}

function prettyUci(fen, uci) {
  try {
    const g = new Chess(fen);
    const m = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return m.san;
  } catch (e) { return uci; }
}

// ----- mistake screen: an analysis board -----
// The game pauses on the mistake. The board goes back to the position before it and becomes an
// analysis board: Stockfish's top lines merged with what players at your level actually chose there.

const ANA_DEPTH = 14;
const evalOn = () => cfg().showEval !== false;
let anaCounter = 0;
let A = null; // analysis state while stopped on a mistake: { chess, rootFen, seq, rows }

const arrowFor = (uci, color) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), color });
// Arrow colours in the style of Lichess's analysis board (pale blue best line, pale grey alternatives).
const ARROW = { blue: '#003088', grey: '#4a4a4a', mistake: '#e69d00', amber: '#e68f00' };   // mistake: the amber Lichess uses for a "mistake" move
const winPct = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1); // Lichess's eval-to-winning-chances curve
const compact = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(n));
const evalText = (r) => (r.mate != null && r.mate !== 0 ? `#${r.mate}` : pawns(r.cp));
/** w = White is clearly better (white box), b = Black is clearly better (dark box), z = within half a pawn (grey box). */
const evClass = (r) => {
  if (r.mate != null && r.mate !== 0) return r.mate > 0 ? 'w' : 'b';
  const v = Math.round(r.cp / 10) / 10;
  return Math.abs(v) <= 0.5 ? 'z' : v > 0 ? 'w' : 'b';
};
const evBox = (r) => `<span class="evbox ${evClass(r)}">${evalText(r)}</span>`;
/** Write an eval into an existing element as a box; with no eval, write plain text instead. */
function boxSet(el, r, plain = '') {
  el.classList.remove('evbox', 'w', 'b', 'z');
  if (r) { el.classList.add('evbox', evClass(r)); el.textContent = evalText(r); } else el.textContent = plain;
}

/** SAN line with move numbers, starting from the position `fen`. */
function sanLine(fen, ucis, max = 10) {
  const g = new Chess(fen);
  let n = parseInt(fen.split(' ')[5], 10) || 1;
  let out = '';
  for (const [i, u] of ucis.slice(0, max).entries()) {
    let m;
    try { m = g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); } catch (e) { break; }
    if (m.color === 'w') out += `${n}.${m.san} `;
    else { out += (i === 0 ? `${n}…${m.san} ` : `${m.san} `); n++; }
  }
  return out.trim();
}

/** Empty the eval bar but keep its space, so the board never moves. */
function idleBar() {
  $('evalbar').classList.add('idle');
  $('evaltxt').textContent = '';
}

/** Live eval while playing: the bar and one number, nothing else. Controlled by the Eval switch above the board. */
const liveEvalOn = () => !!cfg().liveEval;
function liveBar(res) {
  if (A || !G) return;
  const chip = $('liveChip');
  if (!liveEvalOn()) { idleBar(); boxSet(chip, null, '–'); return; }
  if (res) G.lastBarRes = res;
  const r = res || G.lastBarRes;
  if (!r) { $('evalbar').classList.remove('idle'); $('evalbar').classList.toggle('you-b', G.user === 'b'); $('evaltxt').textContent = '…'; boxSet(chip, null, '…'); return; }
  paintBar(r);
  boxSet(chip, r);
}
const refreshLiveBar = () => { if (G && !A) liveBar(null); };

function setEvalBar(res) {
  const bar = $('evalbar');
  const big = $('bigeval');
  if (!evalOn()) { idleBar(); if (big) boxSet(big, null, '–'); return; }
  bar.classList.remove('idle');
  bar.classList.toggle('you-b', G.user === 'b');
  if (!res) { $('evaltxt').textContent = '…'; if (big) boxSet(big, null, '…'); return; }
  if (big) boxSet(big, res);
  paintBar(res);
}

function paintBar(res) {
  const bar = $('evalbar');
  bar.classList.remove('idle');
  bar.classList.toggle('you-b', G.user === 'b');
  const youCp = G.user === 'w' ? res.cp : -res.cp;
  $('evalfill').style.height = `${Math.max(3, Math.min(97, winPct(youCp)))}%`;
  bar.classList.toggle('losing', youCp < 0);
  $('evaltxt').textContent = res.mate ? `M${Math.abs(res.mate)}` : (Math.abs(res.cp) / 100).toFixed(1);
}

/** The game's moves in the move bar during analysis: played ones bright, the ones ahead dim, the current one marked. */
function renderAnaMoves() {
  const done = A.chess.history();
  const ahead = A.fwd.slice().reverse().map((m) => { const g = new Chess(A.chess.fen()); return null; });
  const all = [];
  const g = new Chess();
  A.chess.history().forEach((s) => all.push({ san: s, ahead: false }));
  const probe = new Chess(A.chess.fen());
  for (const m of A.fwd.slice().reverse()) { let r; try { r = probe.move(m); } catch (e) { break; } all.push({ san: r.san, ahead: true }); }
  $('moves').innerHTML = all.map((m, i) => {
    const num = i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : '';
    const cls = ['ana-mv', m.ahead ? 'ahead' : '', i === done.length - 1 ? 'cur' : ''].join(' ').trim();
    return `<span class="${cls}" data-anaply="${i + 1}">${num}${esc(m.san)}</span>`;
  }).join(' ');
  const total = all.length;
  $('anaFirst').disabled = done.length === 0;
  $('anaPrev').disabled = done.length === 0;
  $('anaNext').disabled = A.fwd.length === 0;
  $('anaLast').disabled = A.fwd.length === 0;
  void total; void g; void ahead;
}

let OPDB = null;
openingsDb().then((db) => { OPDB = db; updateOpName(); });

/** ECO code and name of the position on the board (the deepest named position reached so far). */
function openingOf(chess) {
  if (!OPDB) return null;
  const g = new Chess();
  const fens = [g.fen()];
  for (const san of chess.history()) { g.move(san); fens.push(g.fen()); }
  return nameFromFens(OPDB, fens);
}

function updateOpName() {
  const chess = A ? A.chess : G && G.chess;
  const n = chess ? openingOf(chess) : null;
  const txt = n ? `${n.eco} ${n.name}` : '';
  const line = $('opLine'); if (line) line.textContent = txt;
  const head = document.getElementById('opname'); if (head) head.textContent = txt;
}

function hideAnalysis() {
  cancelPrefetch();
  A = null;
  setTimeout(refreshLiveBar, 0);
  $('anaNav').hidden = true;
  document.querySelector('.gamebar').classList.remove('analysing');
  idleBar();
  board.setArrows([]);
}

function sourceNote() {
  return `Games: Lichess <b>players</b>, rated ${cfg().ratingMin}–${cfg().ratingMax}, from the opening database stored in this app.`;
}

// Any game position can be opened on the analysis board: the Analyse button, or a click on a move.
const canAnalyse = () => G && !A && (G.mode === 'over' || ((G.mode === 'play' || G.mode === 'free') && !G.busy));

/** Replay the game's first `n` moves; the rest wait on the forward stack so → can play them again. */
function analysisBoardFor(moves, n) {
  const g = new Chess();
  moves.slice(0, n).forEach((m) => g.move(m.san));
  return { chess: g, fwd: moves.slice(n).reverse().map((m) => ({ from: m.from, to: m.to, promotion: m.promotion })), rootPly: n };
}

function openGameAnalysis(ply) {
  if (!canAnalyse()) return;
  const sans = G.chess.history({ verbose: true });
  const n = ply == null ? sans.length : Math.max(0, Math.min(ply, sans.length));
  const base = analysisBoardFor(sans, n);
  const g = base.chess;
  const last = sans[n - 1];
  const label = n === sans.length ? 'Current position'
    : n === 0 ? 'Start position'
    : `After ${Math.floor((n - 1) / 2) + 1}${last.color === 'w' ? '.' : '…'}${last.san}`;
  const next = sans[n];
  G.prevMode = G.mode; G.mode = 'analysis';
  A = { chess: g, fwd: base.fwd, rootPly: base.rootPly, rootFen: g.fen(), seq: 0, rows: [], rootLabel: label,
    played: next ? { san: next.san, uci: uciOf(next), after: null } : null, playedTag: 'game move', playedColor: ARROW.amber };
  $('mistake').classList.add('neutral');
  $('done').hidden = true;   // the finished-line card steps aside while you analyse; it returns when you close the analysis
  $('mistake').innerHTML = `
    <h2>Analysis</h2>
    <div class="row"><button id="closeAnaBtn" class="primary">Back to the game</button></div>
    <div id="anaBody"></div>
    <p class="muted small">${sourceNote()} Eval is Stockfish 19 from White’s side. Tap a move to play it, drag pieces to try your own, ← → step through the game, Esc to return.</p>`;
  $('mistake').hidden = false;
  setStatus('');
  $('closeAnaBtn').onclick = closeGameAnalysis;
  renderAnalysis();
}

function closeGameAnalysis() {
  if (!G || G.mode !== 'analysis') return;
  hideAnalysis();
  renderMoves();
  $('mistake').hidden = true;
  G.mode = G.prevMode;
  renderBoard();
  if (G.mode === 'over') { board.setEnabled(false); setStatus('Line finished.', 'good'); $('done').hidden = false; return; }
  board.setEnabled(true, G.user);
  setStatus('');
  refreshLiveBar();
}

function showMistake() {
  G.mode = 'mistake';
  const L = G.lastCheck;
  const game = G.chess.history({ verbose: true });          // includes the mistake as the last move
  const base = analysisBoardFor(game, game.length - 1);
  A = { chess: base.chess, fwd: base.fwd, rootPly: base.rootPly, rootFen: L.fenBefore, seq: 0, rows: [],
    played: { san: L.san, uci: L.uci, after: L.after }, playedTag: 'you played', playedColor: ARROW.mistake,
    rootLabel: 'Position before your mistake' };
  $('mistake').classList.remove('neutral');
  const src = sourceNote(L.data && L.data.fromBook);
  $('mistake').innerHTML = `
    <h2>Mistake: ${esc(L.san)}</h2>
    <p class="why1">${L.verdict.reasons.map((r) => esc(r)).join(' ')}</p>
    <div class="row actions">
      <button id="takeBackBtn" class="primary">Take it back</button>
      <button id="playOnBtn">Play on</button>
      <button id="acceptBtn" class="ghost">${esc(L.san)} is fine here</button>
    </div>
    <div id="anaBody"></div>
    <p class="muted small">${src} Eval is Stockfish 19 from White’s side, like Lichess. Tap a move to play it, drag pieces to try your own. ← → step through the game, Home/End jump to the ends.</p>`;
  $('mistake').hidden = false;
  setStatus('Mistake. Look around, then take it back.', 'mistake');

  $('takeBackBtn').onclick = takeBack;
  $('playOnBtn').onclick = playOn;
  $('acceptBtn').onclick = async () => {
    const entry = (S().log || []).filter((e) => e.fen === L.fenBefore && e.san === L.san && !e.retry).pop();
    if (entry) entry.label = 'fine';
    store.acceptMove(L.fenBefore, L.pathBefore, L.uci, L.san, L.firstTry);
    if (L.firstTry) G.mistakes = Math.max(0, G.mistakes - 1);
    G.mode = 'play';
    hideAnalysis();
    $('mistake').hidden = true;
    store.addToTree(G.path, G.chess.history());
    renderBoard(); renderMoves();
    setStatus('');
    await advance();
  };
  renderAnalysis();
}

async function renderAnalysis() {
  if (!A) return;
  const P = A.played;
  const g = A.chess;
  const fen = g.fen();
  const atRoot = fen === A.rootFen;
  cancelPrefetch();   // look-ahead for the position we just left is no longer wanted
  const seq = (A.seq = ++anaCounter); // one global counter: a slow analysis from an earlier mistake can never match a newer board
  const hist = g.history({ verbose: true });
  const last = hist[hist.length - 1];
  board.set({ pieces: pieceMap(g), orientation: G.user, lastMove: last ? [last.from, last.to] : null,
    check: g.inCheck() ? kingSquare(g, g.turn()) : null });
  board.setEnabled(!g.isGameOver(), g.turn());
  $('anaNav').hidden = false;
  document.querySelector('.gamebar').classList.add('analysing');

  const ply = hist.length;
  const crumb = atRoot ? A.rootLabel
    : ply === 0 ? 'Start position'
    : `After ${Math.floor((ply - 1) / 2) + 1}${last.color === 'w' ? '.' : '…'}${last.san}`;
  renderAnaMoves();
  const slots = (first) => [0, 1, 2].map((i) => `<div class="engline ph"><span class="engev">&nbsp;</span><span class="engpv">${i === 0 ? first : ''}</span></div>`).join('');
  $('anaBody').innerHTML = `
    <div class="ana-head"><div class="crumb">${crumb}</div>
      ${atRoot ? '' : '<button id="anaRoot" class="ghost">Back to the mistake position</button>'}</div>
    <section class="enginebox">
      <div class="eng-top">
        <label class="evalswitch" title="Turn the engine on or off"><input type="checkbox" id="evalToggle"${evalOn() ? ' checked' : ''}><span class="track"><span class="knob"></span></span><b>Engine</b></label>
        <span class="bigeval" id="bigeval">${evalOn() ? '…' : '–'}</span>
        <span class="engmeta">Stockfish 19 · depth ${ANA_DEPTH}</span>
      </div>
      <div class="englines">${slots(evalOn() ? 'Analysing…' : 'Engine off')}</div>
    </section>
    <section class="gamesbox">
      <div class="gm-title"><b>Lichess players</b><span id="gmsrc">${cfg().ratingMin}–${cfg().ratingMax}</span></div>
      <div class="opname" id="opname"></div>
      <div class="tablewrap"><table class="ana"><thead><tr><th>Move</th><th>Eval</th><th>Played</th><th>White / Draw / Black</th></tr></thead>
      <tbody><tr><td colspan="4" class="muted">Loading games…</td></tr></tbody>
      <tfoot></tfoot></table></div>
    </section>`;
  $('anaBody').classList.toggle('noeval', !evalOn());
  updateOpName();
  bookMeta().then((m) => {
    const el = document.getElementById('gmsrc');
    if (!el || !m) return;
    el.textContent = `${cfg().ratingMin}–${cfg().ratingMax} · sample of ${compact(m.games)} games`;
    el.title = 'These counts come from a sample of Lichess games stored in this app, not all of Lichess, so they are far smaller than the totals on lichess.org. The percentages are reliable for common moves.';
  });
  $('evalToggle').onchange = () => {
    cfg().showEval = $('evalToggle').checked; store.save();
    if (!cfg().showEval) cancelPrefetch();
    renderAnalysis();
  };
  if (!atRoot) {
    $('anaRoot').onclick = () => analysisGoTo(A.rootPly);
  }
  setEvalBar(null);

  const [eng, data] = await Promise.all([
    (g.isGameOver() || !evalOn()) ? Promise.resolve(null) : analyse(fen, ANA_DEPTH, 3),
    getPosition(fen).catch(() => null),
  ]);
  if (!A || seq !== A.seq) return;
  if (eng) setEvalBar(eng);
  else if (g.isCheckmate()) setEvalBar({ cp: g.turn() === 'w' ? -1000 : 1000, mate: null });
  else setEvalBar({ cp: 0, mate: null });

  const rows = new Map();
  const toUci = sanToUci(g);
  (eng ? eng.lines : []).forEach((l, i) => {
    if (!l.uci) return;
    const san = prettyUci(fen, l.uci);
    rows.set(san, { san, uci: l.uci, cp: l.cp, mate: l.mate, rank: i, pv: l.pv });
  });
  if (data && data.movesTotal) {
    data.moves.forEach((m, i) => {
      const share = (100 * m.games) / data.movesTotal;
      if (share < 1 && i >= 6) return;
      const r = rows.get(m.san) || { san: m.san, uci: toUci(m.san), cp: null, mate: null, rank: 99 };
      Object.assign(r, { games: m.games, share, w: m.w, d: m.d, b: m.b });
      rows.set(m.san, r);
    });
  }
  if (atRoot && P) {
    if (!rows.has(P.san)) rows.set(P.san, { san: P.san, uci: P.uci, cp: null, mate: null, rank: 99 });
    const r = rows.get(P.san);
    r.played = true;
    if (r.cp == null && P.after && evalOn()) { r.cp = P.after.cp; r.mate = P.after.mate || null; }
  }
  A.rows = [...rows.values()];
  A.eng = eng;
  A.data = data;
  drawAnalysis(fen);

  // Moves people play that were not in the engine's top lines still get an eval, most popular first.
  const missing = !evalOn() ? [] : A.rows.filter((r) => r.cp == null && r.uci).sort((a, b) => (b.games || 0) - (a.games || 0)).slice(0, 6);
  for (const r of missing) {
    const g2 = new Chess(fen);
    try { g2.move({ from: r.uci.slice(0, 2), to: r.uci.slice(2, 4), promotion: r.uci[4] || 'q' }); } catch (e) { continue; }
    const res = g2.isCheckmate() ? { cp: g2.turn() === 'w' ? -1000 : 1000, mate: null }
      : g2.isGameOver() ? { cp: 0, mate: null } : await evaluate(g2.fen(), ANA_DEPTH);
    if (!A || seq !== A.seq) return;
    if (res) { r.cp = res.cp; r.mate = res.mate || null; drawAnalysis(fen); }
  }
  lookAhead(fen, seq);
}

/**
 * Quietly get the positions you are most likely to click next ready: the most-played moves, the engine's top
 * moves, and the game's own next move. Clicking one then shows its analysis instantly.
 */
function lookAhead(fen, seq) {
  if (!A || seq !== A.seq) return;
  const rows = A.rows.filter((r) => r.uci);
  const byGames = rows.slice().sort((x, y) => (y.games || 0) - (x.games || 0)).slice(0, 3);
  const byEngine = rows.filter((r) => r.rank < 2);
  const ucis = new Set();
  const nextGame = A.fwd[A.fwd.length - 1];
  if (nextGame) ucis.add(nextGame.from + nextGame.to + (nextGame.promotion || ''));
  [...byEngine, ...byGames].forEach((r) => ucis.add(r.uci));
  for (const u of ucis) {
    const g2 = new Chess(fen);
    try { g2.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || 'q' }); } catch (e) { continue; }
    if (g2.isGameOver()) continue;
    getPosition(g2.fen()).catch(() => null);   // explorer games for that position
    if (evalOn()) prefetch(g2.fen(), ANA_DEPTH, 3);   // engine lines, at low priority
  }
}

function drawAnalysis(fen) {
  const g = new Chess(fen);
  const sgn = g.turn() === 'w' ? 1 : -1;
  const num = parseInt(fen.split(' ')[5], 10) || 1;
  const label = (san) => (g.turn() === 'w' ? `${num}.${san}` : `${num}…${san}`);
  const val = (r) => (r.mate ? sgn * Math.sign(r.mate) * (100000 - Math.abs(r.mate))
    : r.cp == null ? -Infinity : sgn * r.cp);
  // Like the Lichess explorer: most-played first. Moves nobody plays follow, best engine eval first.
  const rows = A.rows.slice().sort((a, b) => (b.games || 0) - (a.games || 0) || val(b) - val(a));
  const best = rows.find((r) => r.cp != null && val(r) === Math.max(...rows.map(val)));

  const winOf = (r) => ((G.user === 'w' ? r.w : r.b) || 0) / Math.max(1, (r.w || 0) + (r.d || 0) + (r.b || 0));
  const meOf = (r) => ((G.user === 'w' ? r.w : r.b) + r.d / 2) / ((r.w || 0) + (r.d || 0) + (r.b || 0));
  const allGames = rows.reduce((n, r) => n + (r.games || 0), 0);
  const avgWin = allGames ? rows.reduce((n, r) => n + (r.games ? winOf(r) * r.games : 0), 0) / allGames : 0;
  // One bar says it all: White / Draw / Black with the percentages inside.
  const bar = (w, d, b2) => {
    const tot = w + d + b2;
    const seg = (cls, n) => {
      const pc = (100 * n) / tot;
      return `<span class="${cls}" style="width:${pc}%">${pc >= 7 ? Math.round(pc) + '%' : ''}</span>`;
    };
    return `<div class="wdl">${seg('w', w)}${seg('d', d)}${seg('b', b2)}</div>`;
  };
  // Red marker only on moves the trainer itself would call a mistake here (on your turn, using the same rule as the game).
  const lead = A.eng && A.eng.lines[0];
  if (lead && g.turn() === G.user) {
    const moveNo = parseInt(fen.split(' ')[5], 10);
    for (const r of rows) {
      r.bad = false;
      if (r.cp == null || !r.uci || r.uci === lead.uci) continue;
      const raw = rawSignals({ data: A.data, san: r.san, uci: r.uci, side: G.user, before: { cp: lead.cp, best: lead.uci }, after: { cp: r.cp }, moveNo, s: cfg() });
      r.bad = verdictFromRaw(raw, cfg()).mistake && !store.isAccepted(fen, r.san);
    }
  }
  const tag = (r) => (r === best ? '<span class="tag best">best</span>' : '') + (r.played ? `<span class="tag">${A.playedTag}</span>` : '');

  $('anaBody').querySelector('tbody').innerHTML = rows.map((r) => {
    const tot = r.games || 0;
    const wdl = tot ? bar(r.w, r.d, r.b) : '<span class="muted small">no games</span>';
    const tip = tot ? `You win ${(winOf(r) * 100).toFixed(1)}% with this move (${(avgWin * 100).toFixed(1)}% on average here). You score ${Math.round(100 * meOf(r))}% counting draws as half.` : '';
    let leads = '';
    if (OPDB && r.uci) {
      try {
        const g3 = new Chess(fen); g3.move({ from: r.uci.slice(0, 2), to: r.uci.slice(2, 4), promotion: r.uci[4] || 'q' });
        const hit = OPDB[g3.fen().split(' ').slice(0, 4).join(' ')];
        if (hit) leads = `${hit[0]} ${hit[1]}`;
      } catch (e) { /* ignore */ }
    }
    return `<tr class="mv${r.played ? ' played' : ''}${r === best ? ' bestrow' : ''}${r.bad && !r.played ? ' badrow' : ''}" data-uci="${r.uci || ''}"${leads ? ` title="${esc(leads)}"` : ''}>
      <td class="san">${esc(label(r.san))}${tag(r)}</td>
      <td class="ev${r.cp == null ? ' pending' : ''}">${r.cp == null ? (evalOn() ? '…' : '') : evBox(r)}</td>
      <td class="num played">${tot ? `<b>${r.share.toFixed(r.share < 10 ? 1 : 0)}%</b><span>${compact(tot)}</span>` : '<span>no games</span>'}</td>
      <td title="${tip}">${wdl}</td></tr>`;
  }).join('') || '<tr><td colspan="4" class="muted">No moves (game over).</td></tr>';

  const sum = rows.reduce((a, r) => ({ w: a.w + (r.w || 0), d: a.d + (r.d || 0), b: a.b + (r.b || 0), n: a.n + (r.games || 0) }), { w: 0, d: 0, b: 0, n: 0 });
  $('anaBody').querySelector('tfoot').innerHTML = sum.n
    ? `<tr class="sigma"><td class="san">Σ</td><td></td><td class="num played"><b>100%</b><span>${compact(sum.n)}</span></td><td>${bar(sum.w, sum.d, sum.b)}</td></tr>` : '';

  // Engine lines, top three, in the style of the Lichess analysis panel.
  const lines = (A.eng ? A.eng.lines : []).filter((l) => l.uci).slice(0, 3);
  const empty = !evalOn() ? 'Engine off' : g.isGameOver() ? 'Game over' : '';
  $('anaBody').querySelector('.englines').innerHTML = [0, 1, 2].map((i) => {
    const l = lines[i];
    return l
      ? `<div class="engline" data-uci="${l.uci}"><span class="engev">${evBox(l)}</span><span class="engpv">${esc(sanLine(fen, l.pv, 12))}</span></div>`
      : `<div class="engline ph"><span class="engev">&nbsp;</span><span class="engpv">${i === 0 ? empty : ''}</span></div>`;
  }).join('');
  $('anaBody').querySelector('.englines').onclick = (e) => {
    const d = e.target.closest('.engline'); if (!d) return;
    analysisMove(d.dataset.uci.slice(0, 2), d.dataset.uci.slice(2, 4), d.dataset.uci[4]);
  };

  const P = A.played;
  const defaultArrows = () => {
    if (!A) return;   // the analysis may have been closed while the mouse was still over the table
    // Lichess's look: the best line is a wide pale-blue arrow; other lines are pale grey and get thinner
    // the more winning chances they give away, vanishing once they give away 0.2 (on a -1..1 scale).
    const engLines = (A.eng ? A.eng.lines : []).filter((l) => l.uci);
    const wc = (cp) => 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
    const bestWc = engLines.length ? wc(sgn * engLines[0].cp) : 0;
    const arrows = [];
    engLines.forEach((l, i) => {
      if (i === 0) { arrows.push({ ...arrowFor(l.uci, ARROW.blue), opacity: 0.45, width: 17 / 64 }); return; }
      const shift = bestWc - wc(sgn * l.cp);
      if (shift >= 0 && shift < 0.2) arrows.push({ ...arrowFor(l.uci, ARROW.grey), opacity: 0.4, width: Math.round(14 - shift * 60) / 64 });
    });
    arrows.reverse(); // best drawn last, on top
    if (fen === A.rootFen && P) arrows.push({ ...arrowFor(P.uci, A.playedColor), opacity: 0.5, width: 13 / 64 });
    board.setArrows(arrows);
  };
  defaultArrows();
  const tbody = $('anaBody').querySelector('tbody');
  tbody.onmouseover = (e) => {
    if (!A) return;
    const tr = e.target.closest('tr.mv'); if (!tr || !tr.dataset.uci) return;
    const played = tr.classList.contains('played');
    board.setArrows([{ ...arrowFor(tr.dataset.uci, played ? A.playedColor : ARROW.blue), opacity: played ? 0.5 : 0.45, width: 17 / 64 }]);
  };
  tbody.onmouseleave = defaultArrows;
  tbody.onclick = (e) => {
    const tr = e.target.closest('tr.mv'); if (!tr || !tr.dataset.uci) return;
    const u = tr.dataset.uci;
    analysisMove(u.slice(0, 2), u.slice(2, 4), u[4]);
  };
}

function analysisMove(from, to, promo) {
  if (!A) return;
  const next = A.fwd[A.fwd.length - 1];
  let m;
  try { m = A.chess.move({ from, to, promotion: promo || 'q' }); } catch (e) { return; }
  // Playing the game's own next move just steps forward; anything else starts a new variation.
  if (next && next.from === m.from && next.to === m.to && (next.promotion || '') === (m.promotion || '')) A.fwd.pop();
  else A.fwd = [];
  play(moveSound(m, A.chess));
  renderAnalysis();
}

// Step through the game: back (undo onto the forward stack), forward (replay), or jump to any ply.
function analysisBack() {
  if (!A) return;
  const m = A.chess.undo();
  if (!m) return;
  A.fwd.push({ from: m.from, to: m.to, promotion: m.promotion });
  renderAnalysis();
}
function analysisForward() {
  if (!A || !A.fwd.length) return;
  const m = A.fwd.pop();
  const done = A.chess.move(m);
  play(moveSound(done, A.chess));
  renderAnalysis();
}
function analysisGoTo(ply) {
  if (!A) return;
  while (A.chess.history().length > ply) { const m = A.chess.undo(); A.fwd.push({ from: m.from, to: m.to, promotion: m.promotion }); }
  while (A.chess.history().length < ply && A.fwd.length) A.chess.move(A.fwd.pop());
  renderAnalysis();
}

document.addEventListener('keydown', (e) => {
  if (!A || (e.target instanceof Element && e.target.closest('input, select, textarea'))) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); analysisBack(); }
  if (e.key === 'ArrowRight') { e.preventDefault(); analysisForward(); }
  if (e.key === 'Home') { e.preventDefault(); analysisGoTo(0); }
  if (e.key === 'End') { e.preventDefault(); analysisGoTo(A.chess.history().length + A.fwd.length); }
  if (e.key === 'Escape' && G && G.mode === 'analysis') closeGameAnalysis();
});
$('anaFirst').onclick = () => analysisGoTo(0);
$('anaPrev').onclick = analysisBack;
$('anaNext').onclick = analysisForward;
$('anaLast').onclick = () => A && analysisGoTo(A.chess.history().length + A.fwd.length);

function takeBack() {
  hideAnalysis();
  G.chess.undo(); G.path.pop();
  G.mode = 'play';
  $('mistake').hidden = true;
  renderBoard(); renderMoves();
  G.busy = false;
  board.setEnabled(true, G.user);
  setStatus('');
}

async function playOn() {
  hideAnalysis();
  G.mode = 'free';
  $('mistake').hidden = true;
  store.addToTree(G.path, G.chess.history());
  renderBoard(); renderMoves();
  setStatus('Playing on. The game will not stop for mistakes now.');
  const after = G.lastCheck.after;
  if (after && liveEvalOn()) $('evalLine').textContent = `Engine after your move: ${fmtEval(after.cp)} (White’s view)`;
  if (!liveEvalOn()) setStatus('Playing on. Turn the Eval switch on to see how bad it was.');
  await advance();
}

// ----- finishing -----

function finish(msg, failed = false) {
  const id = G.id;
  G.mode = 'over'; G.busy = true;
  board.setEnabled(false); board.setArrows([]);
  setStatus(failed ? msg : 'Line finished.', failed ? 'bad' : 'good');
  if (!failed && G.mistakes === 0) play('done');
  if (!failed && G.decisions > 0) {
    S().history.push({ t: Date.now(), opening: G.op.id, moves: G.chess.history().length, mistakes: G.mistakes, decisions: G.decisions });
    store.save();
  }
  const clean = G.mistakes === 0;
  $('done').innerHTML = `
    <h2>${failed ? 'Stopped' : clean ? 'Clean line' : 'Line finished'}</h2>
    <p>${esc(msg)}${failed ? '' : ` You made ${G.decisions} decision${G.decisions === 1 ? '' : 's'} and ${G.mistakes} mistake${G.mistakes === 1 ? '' : 's'}.`}</p>
    <div class="row"><button class="primary" id="againBtn">Another line</button></div>
    <div id="sumBody" class="sumbody"></div>`;
  $('done').hidden = false;
  if (G.chess.history().length > G.startPly) lineSummary(id);
  $('againBtn').onclick = () => startGame(undefined, { sans: G.sans0 });
  $('mistake').hidden = true;
}

/**
 * How the evaluation moved through the line, move by move, from your side (positive = good for you).
 * Positions already analysed while you played come straight from the engine cache; only the rest are worked out now.
 */
async function lineSummary(id) {
  const box = $('sumBody');
  box.innerHTML = '<p class="muted small">Working out how the evaluation moved…</p>';
  const moves = G.chess.history({ verbose: true });
  const start = G.startPly, user = G.user, sign = user === 'w' ? 1 : -1, depth = cfg().engineDepth;
  const g = new Chess();
  const fens = [g.fen()];
  for (const m of moves) { g.move(m.san); fens.push(g.fen()); }
  const evals = [];
  for (let i = start; i <= moves.length; i++) {
    const c = new Chess(fens[i]);
    let cp = null;
    if (c.isCheckmate()) cp = c.turn() === 'w' ? -1000 : 1000;
    else if (c.isGameOver()) cp = 0;
    else { const r = await evaluate(fens[i], depth); cp = r ? r.cp : null; }
    if (id !== G.id) return;
    evals.push(cp === null ? null : sign * cp);
  }
  if (id !== G.id) return;
  if (evals.some((v) => v === null)) { box.innerHTML = '<p class="muted small">The engine was not available, so there is no evaluation summary.</p>'; return; }

  // chart (your side's view, clamped to ±3 pawns)
  const W = 320, H = 90, px = 10, py = 8, lim = 300;
  const X = (k) => px + (evals.length === 1 ? 0 : (k * (W - 2 * px)) / (evals.length - 1));
  const Y = (v) => py + ((lim - Math.max(-lim, Math.min(lim, v))) / (2 * lim)) * (H - 2 * py);
  const pts = evals.map((v, k) => `${X(k).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  const dots = evals.map((v, k) => {
    const mover = k === 0 ? null : moves[start + k - 1].color === user ? 'you' : 'opp';
    return `<circle cx="${X(k).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="${mover === 'you' ? 3.4 : 2.6}" class="dot ${mover || 'start'}"/>`;
  }).join('');
  const chart = `<svg class="sumchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evaluation through the line">
    <line x1="${px}" x2="${W - px}" y1="${Y(0)}" y2="${Y(0)}" class="zero"/>
    <polyline points="${pts}" class="trace"/>${dots}</svg>`;

  let worst = { d: 0, i: -1 }, best = { d: 0, i: -1 };
  const rows = [`<tr class="start"><td>Start of the line</td><td class="ev">${pawns(evals[0])}</td><td></td></tr>`];
  for (let k = 1; k < evals.length; k++) {
    const m = moves[start + k - 1], ply = start + k - 1;
    const d = evals[k] - evals[k - 1];
    if (m.color === user && d < worst.d) worst = { d, i: k };
    if (m.color === user && d > best.d) best = { d, i: k };
    const num = Math.floor(ply / 2) + 1, label = m.color === 'w' ? `${num}.${m.san}` : `${num}…${m.san}`;
    const cls = Math.abs(d) < 15 ? '' : d > 0 ? 'up' : 'down';
    rows.push(`<tr class="${m.color === user ? 'you' : 'opp'}"><td>${esc(label)}<span class="who">${m.color === user ? 'you' : 'opponent'}</span></td>` +
      `<td class="ev">${pawns(evals[k])}</td><td class="chg ${cls}">${Math.abs(d) < 5 ? '·' : pawns(d)}</td></tr>`);
  }
  const note = worst.i > 0 && worst.d <= -30
    ? `Your costliest move was <b>${esc(moves[start + worst.i - 1].san)}</b> (${pawns(worst.d)}).`
    : 'None of your moves cost you anything noticeable.';
  const total = evals[evals.length - 1] - evals[0];
  box.innerHTML = `
    <h3>How the evaluation moved</h3>
    ${chart}
    <p class="small muted">${note} Over the whole line the eval went from ${pawns(evals[0])} to ${pawns(evals[evals.length - 1])} (${pawns(total)}), from your side.</p>
    <div class="sumscroll"><table class="sumtab"><thead><tr><th>Move</th><th>Eval after</th><th>Change</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

$('startBtn').onclick = () => startGame();
$('drillBtn').onclick = () => startGame('wrong');
$('analyseBtn').onclick = () => openGameAnalysis();
$('moves').onclick = (e) => {
  const a = e.target.closest('[data-anaply]');
  if (a && A) { analysisGoTo(+a.dataset.anaply); return; }
  const s = e.target.closest('[data-ply]');
  if (s) openGameAnalysis(+s.dataset.ply);
};
$('restartBtn').onclick = () => startGame(undefined, { sans: G ? G.sans0 : [] });
$('setupBtn').onclick = () => { if (G) G.id = ++gameSeq; $('game').hidden = true; $('setup').hidden = false; banner(''); updateSetupUi(); };
function syncLive() {
  $('liveEvalToggle').checked = liveEvalOn();
  $('liveEvalSwitch').classList.toggle('on', liveEvalOn());
  if ($('s_liveEval')) $('s_liveEval').checked = liveEvalOn();
  if (!G || A) return;
  if (liveEvalOn()) { if (G.preEval) G.preEval.then((r) => liveBar(r)); else liveBar(null); }
  else { idleBar(); boxSet($('liveChip'), null, '–'); $('evalLine').textContent = ''; }
}
$('liveEvalToggle').onchange = () => { cfg().liveEval = $('liveEvalToggle').checked; store.save(); syncLive(); };
syncLive();

const SPEAKER = '<path d="M11 5L6 9H3v6h3l5 4z" fill="currentColor"/>';
const syncSoundBtn = () => {
  const waves = soundOn()
    ? '<path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>'
    : '<path d="M16 9l6 6"/><path d="M22 9l-6 6"/>';
  $('soundBtn').innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">${SPEAKER}${waves}</svg>`;
  $('soundBtn').title = soundOn() ? 'Sound on (click to mute)' : 'Sound off (click to unmute)';
};
$('soundBtn').onclick = () => { setSound(!soundOn()); syncSoundBtn(); play('move'); };
syncSoundBtn();

// Flip swaps colours: you play the other side and the bot takes yours.
$('flipBtn').onclick = () => {
  if (!G || G.mode === 'mistake' || A) return;
  sideOverride = G.user === 'w' ? 'b' : 'w';
  S().prefs.side = sideOverride; S().prefs.sideChosen = true; store.save(); updateSideUi();
  G.user = sideOverride;
  G.id = ++gameSeq;           // abandon any bot move or check in flight
  board.setArrows([]);
  renderBoard();
  if (G.mode === 'over') { board.setEnabled(false); return; }
  G.busy = true; board.setEnabled(false);
  advance();
};

// ---------- progress tab ----------

function renderProgress() {
  const h = S().history;
  const clean = h.filter((x) => x.mistakes === 0).length;
  const dec = h.reduce((a, x) => a + x.decisions, 0), bad = h.reduce((a, x) => a + x.mistakes, 0);
  $('statsSummary').innerHTML =
    `<div><b>${h.length}</b><span>lines played</span></div>` +
    `<div><b>${clean}</b><span>clean lines</span></div>` +
    `<div><b>${dec ? Math.round((100 * (dec - bad)) / dec) + '%' : '–'}</b><span>moves right</span></div>`;

  $('treeOpening').value = S().prefs.treeOpening || $('opening').value;
  renderTree();
  renderLog();

  const weak = Object.entries(S().weak).filter(([, w]) => store.weakWeight(w) > 0)
    .sort((a, b) => store.weakWeight(b[1]) - store.weakWeight(a[1]));
  $('weakList').innerHTML = weak.length ? weak.slice(0, 15).map(([p, w], i) => `
      <div class="weakitem"><div class="l">${esc(formatLine(w.san.split(' ')))}<div class="muted small">missed ${w.n}×, right ${w.ok}× since</div></div>
      <button data-i="${i}" class="ghost">Drill</button></div>`).join('')
    : '<p class="muted">No weak spots yet. They appear here when you make a mistake.</p>';
  $('weakList').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    pickStart(weak[+b.dataset.i][1].san.split(' '));
  };
}

// ----- move log: every judged move, re-scored with the current settings -----

function renderLog() {
  const log = (S().log || []).filter((e) => !e.retry);
  const s = cfg();
  const rows = log.map((e) => ({ e, v: verdictFromRaw(e.raw, s) })).reverse();
  const labelled = rows.filter((r) => r.e.label);
  const falseAlarm = labelled.filter((r) => r.e.label === 'fine' && r.v.mistake).length;
  const missed = labelled.filter((r) => r.e.label === 'mistake' && !r.v.mistake).length;
  $('logSummary').textContent = labelled.length
    ? `You labelled ${labelled.length} moves. With the current settings: ${falseAlarm} false alarm${falseAlarm === 1 ? '' : 's'} (flagged but you said fine), ${missed} missed (not flagged but you said mistake).`
    : 'Label moves below as Fine or Mistake. This tells you how well the current strictness matches your own judgement.';
  const pct = (x) => (x === null ? '–' : x.toFixed(1) + '%');
  $('logList').innerHTML = rows.slice(0, 40).map(({ e, v }) => {
    const p = v.parts;
    const gap = p.score.mine === null ? '–' : (100 * (p.score.ref - p.score.mine)).toFixed(0) + 'pt';
    return `<div class="logitem ${v.mistake ? 'flag' : ''}">
      <div class="l"><b>${esc(e.san)}</b> <span class="muted small">after ${esc(e.line || 'start')}</span>
        <div class="muted small">eval −${p.eval.loss === null ? '–' : (Math.max(0, p.eval.loss) / 100).toFixed(1)} · played ${pct(p.rare.share)} · results gap ${gap} ·
        total ${v.total.toFixed(2)} / ${s.mistakeThreshold}</div></div>
      <span class="tag ${v.mistake ? '' : 'best'}">${v.mistake ? 'flagged' : 'passed'}</span>
      <button data-t="${e.t}" data-l="fine" class="ghost ${e.label === 'fine' ? 'on' : ''}">Fine</button>
      <button data-t="${e.t}" data-l="mistake" class="ghost ${e.label === 'mistake' ? 'on' : ''}">Mistake</button></div>`;
  }).join('') || '<p class="muted">Nothing yet. Every move you play is recorded here.</p>';
}
$('logList').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  store.setLabel(+b.dataset.t, b.dataset.l); renderLog();
};

function pickStart(sans) {
  S().prefs.customMoves = sans.join(' ');
  store.save();
  loadPrefs();
  showTab('train');
  $('game').hidden = true; $('setup').hidden = false;
}

$('treeOpening').onchange = () => { S().prefs.treeOpening = $('treeOpening').value; store.save(); renderTree(); };

function renderTree() {
  const op = byId($('treeOpening').value);
  const root = $('treeView');
  const sans = movesOf(op);
  const g = new Chess();
  const path = [];
  let node = S().tree;
  for (const s of sans) {
    const m = g.move(s); path.push(uciOf(m));
    node = node && node.c && node.c[uciOf(m)];
  }
  root.innerHTML = '';
  const ul = document.createElement('ul');
  const head = document.createElement('div');
  head.className = 'muted small';
  head.textContent = `Start: ${formatLine(sans)}`;
  root.append(head, ul);
  if (!node || !Object.keys(node.c || {}).length) {
    ul.innerHTML = '<li class="muted">You have not played this opening yet.</li>';
    return;
  }
  fillChildren(ul, node, g.fen(), path, sans, op.side);
}

function fillChildren(ul, node, fen, path, sans, userSide) {
  const g = new Chess(fen);
  const mover = g.turn();
  const kids = Object.entries(node.c || {});
  kids.forEach(([uci, child]) => {
    const g2 = new Chess(fen);
    let m;
    try { m = g2.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); } catch (e) { return; }
    const p2 = path.concat(uci), s2 = sans.concat(m.san);
    const li = document.createElement('li');
    const label = `${mover === 'w' ? Math.floor(sans.length / 2) + 1 + '.' : Math.floor(sans.length / 2) + 1 + '…'}${m.san}`;
    let st = 'unmet', meta = '';
    if (mover === userSide) {
      const w = S().weak[path.join(' ')];
      if (w && (w.bad || []).includes(uci)) { st = 'weak'; meta = 'mistake'; }
      else st = 'solid';
    } else {
      st = store.status(g2.fen());
      const p = S().pos[store.fenKey(g2.fen())];
      if (p) meta = `${p.n - p.bad}/${p.n} right`;
    }
    const hasKids = Object.keys(child.c || {}).length > 0;
    const dot = `<span class="dotc st-${st}"></span>`;
    const go = `<button class="go" data-sans="${esc(s2.join(' '))}">Train from here</button>`;
    if (hasKids) {
      li.innerHTML = `<details><summary>${dot}<b>${esc(label)}</b> <span class="meta">${esc(meta)}</span>${go}</summary><ul></ul></details>`;
      const det = li.querySelector('details'), sub = li.querySelector('ul');
      det.addEventListener('toggle', () => {
        if (det.open && !sub.dataset.done) {
          sub.dataset.done = '1';
          fillChildren(sub, child, g2.fen(), p2, s2, userSide);
        }
      });
    } else {
      li.innerHTML = `<div class="leaf">${dot}<b>${esc(label)}</b> <span class="meta">${esc(meta)}</span>${go}</div>`;
    }
    ul.appendChild(li);
  });
  // Branches in the data that you have not met yet (needs cached explorer data).
  if (mover !== userSide) {
    getPosition(fen, { cacheOnly: true }).then((data) => {
      if (!data) return;
      for (const m of data.moves) {
        const g2 = new Chess(fen); let mv;
        try { mv = g2.move(m.san); } catch (e) { continue; }
        if (node.c && node.c[uciOf(mv)]) continue;
        const share = (100 * m.games) / data.movesTotal;
        if (share < 3) continue;
        const li = document.createElement('li');
        const num = Math.floor(sans.length / 2) + 1;
        li.innerHTML = `<div class="leaf unmet"><span class="dotc"></span>${num}${mover === 'w' ? '.' : '…'}${esc(m.san)} <span class="meta">not met · ${share.toFixed(0)}% of games</span>` +
          `<button class="go" data-sans="${esc(sans.concat(m.san).join(' '))}">Train from here</button></div>`;
        ul.appendChild(li);
      }
    }).catch(() => {});
  }
}

$('treeView').addEventListener('click', (e) => {
  const b = e.target.closest('.go'); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  pickStart(b.dataset.sans.split(' '));
});

// ---------- settings ----------

const TUNING = [
  ['weightEval', 'Weight: engine eval', 0.05, 0, 1],
  ['weightRare', 'Weight: rarely played', 0.05, 0, 1],
  ['weightScore', 'Weight: results', 0.05, 0, 1],
  ['mistakeThreshold', 'Flag at weighted total', 0.05, 0.05, 1],
  ['evalLowCp', 'Eval loss that starts to count (cp)', 5, 0, 300],
  ['evalHighCp', 'Eval loss that counts fully (cp)', 5, 10, 600],
  ['blunderCp', 'Always a mistake from (cp)', 10, 50, 1000],
  ['earlyMoves', 'Lenient for moves up to move number', 1, 0, 8],
  ['earlyLossCp', '...only flagged then if the engine loss is at least (cp)', 10, 50, 600],
  ['practicalMinShare', 'Gambits pass if played in ≥ % of games', 0.5, 0, 20],
  ['practicalSlackPp', '…and score within this many points of the best', 0.5, 0, 15],
  ['practicalMaxLossCp', '…unless the engine loss is at least (cp)', 10, 100, 1000],
  ['rareLowPct', 'Counts fully if played in ≤ % of games', 0.1, 0, 20],
  ['rareHighPct', 'Stops counting at ≥ % of games', 0.5, 0.5, 50],
  ['scoreLowPp', 'Result gap that starts to count (points)', 0.5, 0, 20],
  ['scoreHighPp', 'Result gap that counts fully (points)', 0.5, 1, 40],
  ['engineDepth', 'Engine depth', 1, 6, 22],
  ['minGamesForData', 'Games needed to trust a position', 1, 1, 500],
  ['botSharpness', 'Opponent: 1 = exactly real frequencies, lower = more variety', 0.05, 0.3, 1],
  ['varietyStrength', 'Variety: how fast lines you just saw fade', 0.1, 0, 5],
  ['weakBoost', 'Weak spots: how much extra to serve', 0.1, 0, 5],
];

function buildSettings() {
  const sel = (id, vals) => { $(id).innerHTML = vals.map((v) => `<option>${v}</option>`).join(''); };
  sel('s_ratingMin', [1400, 1600, 1800, 2000]);
  sel('s_ratingMax', [1600, 1800, 2000, 2200]);
  $('s_ratingMin').value = cfg().ratingMin; $('s_ratingMax').value = cfg().ratingMax;
  $('s_botDelayMs').value = cfg().botDelayMs;
  $('tuning').innerHTML = TUNING.map(([k, label, step, min, max]) =>
    `<label>${esc(label)}<input type="number" data-k="${k}" step="${step}" min="${min}" max="${max}" value="${cfg()[k]}"></label>`).join('');
}
buildSettings();

const applyLook = () => { document.documentElement.dataset.board = cfg().boardTheme || 'green'; };
applyLook();
$('s_boardTheme').value = cfg().boardTheme;
$('s_animations').checked = cfg().animations !== false;
$('s_animations').onchange = () => { cfg().animations = $('s_animations').checked; store.save(); document.documentElement.classList.toggle('no-motion', !cfg().animations); };
document.documentElement.classList.toggle('no-motion', cfg().animations === false);
$('s_liveEval').checked = liveEvalOn();
$('s_liveEval').onchange = () => { cfg().liveEval = $('s_liveEval').checked; store.save(); syncLive(); };
$('s_knightArrows').value = cfg().knightArrows || 'L';
$('s_showEval').checked = evalOn();
$('s_knightArrows').onchange = () => { cfg().knightArrows = $('s_knightArrows').value; store.save(); board.render(); };
$('s_showEval').onchange = () => { cfg().showEval = $('s_showEval').checked; store.save(); if (!cfg().showEval) cancelPrefetch(); if (A) renderAnalysis(); else if (!cfg().showEval) idleBar(); };
$('s_boardTheme').onchange = () => { cfg().boardTheme = $('s_boardTheme').value; store.save(); applyLook(); };
$('s_ratingMin').onchange = () => { cfg().ratingMin = +$('s_ratingMin').value; store.save(); updateSetupUi(); renderSettingsInfo(); };
$('s_ratingMax').onchange = () => { cfg().ratingMax = +$('s_ratingMax').value; store.save(); updateSetupUi(); renderSettingsInfo(); };
$('s_botDelayMs').onchange = () => { cfg().botDelayMs = Math.max(0, +$('s_botDelayMs').value || 0); store.save(); };
$('tuning').onchange = (e) => {
  const k = e.target.dataset.k; if (!k) return;
  const v = parseFloat(e.target.value);
  if (Number.isFinite(v)) { cfg()[k] = v; store.save(); }
};
$('resetTuningBtn').onclick = () => {
  for (const [k] of TUNING) cfg()[k] = store.DEFAULT_SETTINGS[k];
  store.save(); buildSettings();
};
async function renderSettingsInfo() {
  const m = await bookMeta();
  $('bookInfo').textContent = m
    ? `Opening database: ${m.games.toLocaleString()} rated games (${m.built}), ${m.positions.toLocaleString()} positions, ratings 1400–2200, first ${Math.ceil(m.maxPly / 2)} moves. Your bracket: ${cfg().ratingMin}–${cfg().ratingMax}.`
    : 'The opening database is missing (book/meta.json).';
}
$('exportBtn').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([store.exportJson()], { type: 'application/json' }));
  a.download = 'opening-reps-progress.json'; a.click();
};
$('importFile').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { store.importJson(await f.text()); buildSettings(); loadPrefs(); banner('Progress imported.'); }
  catch (err) { banner('That file could not be read.', true); }
};
$('clearAcceptedBtn').onclick = () => {
  const n = Object.values(S().accepted || {}).reduce((a, l) => a + l.length, 0);
  if (n && confirm(`Forget ${n} move${n === 1 ? '' : 's'} you marked as fine? They can be flagged again.`)) { S().accepted = {}; store.save(); }
};
$('resetBtn').onclick = () => {
  if (confirm('Erase all progress, weak spots and history? Settings are kept.')) { store.resetProgress(); renderProgress(); }
};

// ---------- boot ----------

loadPrefs();
// Open straight onto a board from the start position; Setup is there when wanted.
bookMeta().then((meta) => {
  if (meta) startGame();
  else banner('The opening database is missing (book/meta.json). Rebuild it with tools/build_book.py.', true);
});
window.__trainer = { get G() { return G; }, store, board, judge };

