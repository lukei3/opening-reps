// Studies: ready-made opening lines to learn and drill, plus import from Lichess (a study link) or any PGN.
// A study is a set of chapters; each chapter is a tree of moves with comments. You play your side and the opponent
// plays the study's replies; any move that is not in the study stops you so you can try again.
import { Chess } from '../lib/chess.js';
import { Board } from './board.js';
import * as store from './store.js';
import { parseStudy } from './pgn.js';
import { play, moveSound } from './sounds.js';
import { getPosition, scoreFor } from './data.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_PGN = 1.5e6;   // characters kept per imported study (browser storage is limited)

// ---------- storage ----------

const data = () => {
  const s = store.S();
  s.studies = s.studies || { mine: [], progress: {} };
  s.studies.mine = s.studies.mine || [];
  s.studies.progress = s.studies.progress || {};
  return s.studies;
};

// ---------- loading studies ----------

let index = null;                 // the built-in list
const loaded = new Map();         // study id -> parsed study

async function loadIndex() {
  if (index) return index;
  try {
    const r = await fetch('data/studies/index.json');
    index = r.ok ? await r.json() : [];
  } catch (e) { index = []; }
  return index;
}

async function loadStudy(entry) {
  if (loaded.has(entry.id)) return loaded.get(entry.id);
  let text = entry.pgn;
  if (!text) {
    const r = await fetch('data/studies/' + entry.file);
    if (!r.ok) throw new Error('Could not load that study.');
    text = await r.text();
  }
  const parsed = parseStudy(text);
  const study = { ...entry, name: entry.name || parsed.name || 'Study', chapters: parsed.chapters, warnings: parsed.warnings };
  loaded.set(entry.id, study);
  return study;
}

// ---------- list view ----------

function show(view) {
  for (const v of ['stList', 'stDetail', 'stTrain']) $(v).hidden = v !== view;
}

export async function showStudies() {
  if (T) { leaveTraining(); }
  show('stList');
  await renderList();
}

function sideLabel(side) { return side === 'b' ? 'Black' : 'White'; }

/** "Played 5× · 3 clean" for a study, from the progress saved for its chapters. */
function progressLine(e) {
  const p = data().progress[e.id];
  if (!p) return '';
  let done = 0, clean = 0;
  for (const k of Object.keys(p)) { done += p[k].done || 0; clean += p[k].clean || 0; }
  return done ? `<span class="stprog">Played ${done}× · ${clean} clean</span>` : '';
}

async function renderList() {
  const builtin = await loadIndex();
  const group = (title, items, mine) => items.length ? `
    <h3>${esc(title)}</h3>
    <div class="stcards">${items.map((e) => `
      <div class="stcard">
        <button type="button" class="stopen" data-open="${esc(e.id)}" data-mine="${mine ? 1 : 0}">
          <span class="stname">${esc(e.name)}</span>
          <span class="stmeta">${e.side ? 'You play ' + sideLabel(e.side) + ' · ' : ''}${esc(e.blurb || e.source || '')}</span>
          ${progressLine(e)}
        </button>
        ${mine ? `<button type="button" class="ghost stdel" data-del="${esc(e.id)}" title="Remove this study" aria-label="Remove ${esc(e.name)}">×</button>` : ''}
      </div>`).join('')}
    </div>` : '';
  const classics = builtin.filter((e) => e.group !== 'Gambits');
  const gambits = builtin.filter((e) => e.group === 'Gambits');
  const pops = await loadPopular();
  const popularIds = new Set(pops.map((p) => 'li-' + p.id));
  const have = new Set(data().mine.map((m) => m.id));
  const mine = data().mine.filter((m) => !popularIds.has(m.id));       // imported popular studies live in their own section
  const popGroup = pops.length ? `
    <h3>Popular on Lichess</h3>
    <p class="muted small stpopnote">Long studies written by other Lichess users, picked for being widely used. They stay on Lichess: Import copies one into this browser only, fetched from Lichess when you press the button. All credit to their authors.</p>
    <div class="stcards">${pops.map((p) => {
      const got = have.has('li-' + p.id);
      return `<div class="stcard stpop">
        <div class="stinfo">
          <span class="stname">${esc(p.title)}</span>
          <span class="stmeta">by ${esc(p.author)} · ${esc(p.topic)}${p.stats ? ` · ${esc(p.stats)}` : ''}</span>
          <a class="stlink" href="https://lichess.org/study/${esc(p.id)}" target="_blank" rel="noopener">View on Lichess ↗</a>
        </div>
        <button type="button" class="${got ? 'ghost' : 'primary'} stimport" data-import="${esc(p.id)}">${got ? 'Open' : 'Import'}</button>
        ${got ? `<button type="button" class="ghost stdel" data-del="li-${esc(p.id)}" title="Remove this copy" aria-label="Remove ${esc(p.title)}">×</button>` : ''}
      </div>`;
    }).join('')}</div>` : '';
  $('stCards').innerHTML = group('Classic openings', classics, false) + group('Gambits', gambits, false) + popGroup + group('Your imports', mine, true);
}

let popular = null;
async function loadPopular() {
  if (popular) return popular;
  try { const r = await fetch('data/popular-studies.json'); popular = r.ok ? await r.json() : []; } catch (e) { popular = []; }
  return popular;
}

$('stCards').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-del]');
  if (del) {
    const d = data(); d.mine = d.mine.filter((m) => m.id !== del.dataset.del); delete d.progress[del.dataset.del];
    loaded.delete(del.dataset.del); store.save(); renderList(); return;
  }
  const imp = e.target.closest('[data-import]');
  if (imp) {
    const entry = data().mine.find((m) => m.id === 'li-' + imp.dataset.import);
    if (entry) { openStudy(entry); return; }                 // already imported: open it
    imp.disabled = true; imp.textContent = 'Importing…';
    await fetchStudyRef({ study: imp.dataset.import, chapter: null });
    await renderList();                                       // also restores the button if it failed
    return;
  }
  const open = e.target.closest('[data-open]');
  if (!open) return;
  const list = open.dataset.mine === '1' ? data().mine : await loadIndex();
  const entry = list.find((x) => x.id === open.dataset.open);
  if (entry) openStudy(entry);
});

// ---------- study detail (its chapters) ----------

let current = null;

async function openStudy(entry) {
  let study;
  try { study = await loadStudy(entry); } catch (e) { setMsg(e.message, true); return; }
  current = study;
  renderDetail();
  show('stDetail');
}

function progressOf(study, chapter) {
  return (data().progress[study.id] || {})[chapter.name] || { done: 0, clean: 0 };
}

function renderDetail() {
  const s = current;
  $('stDetailTitle').textContent = s.name;
  $('stDetailBlurb').textContent = [s.side ? `You play ${sideLabel(s.side)}.` : '', s.blurb || s.source || ''].filter(Boolean).join(' ');
  $('stChapters').innerHTML = s.chapters.map((c, i) => {
    const p = progressOf(s, c);
    return `<div class="stchapter">
      <div><b>${esc(c.name)}</b><div class="muted small">${sideLabel(c.orientation)} · ${c.lines} line${c.lines === 1 ? '' : 's'}${p.done ? ` · played ${p.done}×, ${p.clean} clean` : ''}</div></div>
      <button type="button" class="primary" data-ch="${i}">Train</button>
    </div>`;
  }).join('') || '<p class="muted">This study has no readable chapters.</p>';
  $('stWarn').innerHTML = s.warnings && s.warnings.length ? `<p class="muted small">Some moves could not be read: ${s.warnings.slice(0, 3).map(esc).join(' ')}</p>` : '';
  $('stAll').hidden = s.chapters.length < 2;
}

$('stChapters').addEventListener('click', (e) => { const b = e.target.closest('[data-ch]'); if (b) startTraining(current, +b.dataset.ch); });
$('stAll').addEventListener('click', () => startTraining(current, -1));
$('stDetailBack').addEventListener('click', () => { show('stList'); });

// ---------- import ----------

function setMsg(text, err = false) {
  for (const id of ['stMsg', 'stListMsg']) {     // one in the import panel, one up by the list so it is seen on a phone too
    const el = $(id);
    el.textContent = text || ''; el.className = 'stmsg' + (err ? ' err' : '');
  }
}

function parseStudyLink(text) {
  const t = text.trim();
  const m = /lichess\.org\/study\/(?:embed\/)?([A-Za-z0-9]{8})(?:\/([A-Za-z0-9]{8}))?/.exec(t) || /^([A-Za-z0-9]{8})$/.exec(t);
  return m ? { study: m[1], chapter: m[2] || null } : null;
}

async function importPgn(text, source, id) {
  if (text.length > MAX_PGN) { setMsg('That study is too large to keep in the browser (over 1.5 MB of moves).', true); return; }
  const parsed = parseStudy(text);
  if (!parsed.chapters.length) { setMsg('No usable chapters were found. ' + (parsed.warnings[0] || 'Is it standard chess PGN?'), true); return; }
  // the same PGN imported again replaces the earlier copy instead of adding a duplicate
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  const entry = { id: id || 'pgn-' + h.toString(36), name: parsed.name || 'Imported study', source, pgn: text };
  const d = data();
  d.mine = d.mine.filter((m) => m.id !== entry.id);
  d.mine.unshift(entry);
  loaded.delete(entry.id);
  store.save();
  const lines = parsed.chapters.reduce((a, c) => a + c.lines, 0);
  setMsg(`Imported "${entry.name}": ${parsed.chapters.length} chapter${parsed.chapters.length === 1 ? '' : 's'}, ${lines} lines.` + (parsed.warnings.length ? ` ${parsed.warnings.length} problem${parsed.warnings.length === 1 ? '' : 's'} skipped.` : ''));
  $('stUrl').value = ''; $('stPgn').value = '';
  await renderList();
}

async function fetchLichess() {
  const ref = parseStudyLink($('stUrl').value);
  if (!ref) { setMsg('That does not look like a Lichess study link. It should look like lichess.org/study/abcd1234.', true); return; }
  await fetchStudyRef(ref);
}

/** Fetch one study (or one chapter) straight from Lichess, as the person pressing the button, and keep it in this browser. */
async function fetchStudyRef(ref) {
  setMsg('Fetching from Lichess…');
  const path = ref.chapter ? `${ref.study}/${ref.chapter}` : ref.study;
  let r;
  try { r = await fetch(`https://lichess.org/api/study/${path}.pgn?comments=true&variations=true&clocks=false&orientation=true`); }
  catch (e) { setMsg('Could not reach Lichess. Check your connection and try again.', true); return; }
  if (r.status === 404 || r.status === 403 || r.status === 401) { setMsg('Lichess would not give that study out. It must be public or unlisted, and the link must be right.', true); return; }
  if (r.status === 429) { setMsg('Lichess asked us to slow down. Wait a minute and try again.', true); return; }
  if (!r.ok) { setMsg(`Lichess answered with an error (${r.status}).`, true); return; }
  await importPgn(await r.text(), 'Lichess study ' + ref.study, 'li-' + path.replace('/', '-'));
}

$('stFetch').addEventListener('click', fetchLichess);
$('stUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') fetchLichess(); });
$('stPgnBtn').addEventListener('click', () => {
  const t = $('stPgn').value.trim();
  if (!t) { setMsg('Paste some PGN first, or choose a file.', true); return; }
  importPgn(t, 'Pasted PGN');
});
$('stFile').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  try { await importPgn(await f.text(), f.name); } finally { e.target.value = ''; }
});

// ---------- training ----------

const pieceMap = (g) => {
  const m = {};
  for (const row of g.board()) for (const p of row) if (p) m[p.square] = p.color + p.type.toUpperCase();
  return m;
};
const lastMoveOf = (g) => { const h = g.history({ verbose: true }); const l = h[h.length - 1]; return l ? [l.from, l.to] : null; };
const kingSquare = (g, color) => {
  for (const row of g.board()) for (const p of row) if (p && p.type === 'k' && p.color === color) return p.square;
  return null;
};

let T = null;            // the line being trained
export const studyState = () => (T ? { fen: T.chess.fen(), user: T.user, over: T.over, children: T.node.children.map((c) => ({ san: c.san, uci: c.uci })), mistakes: T.mistakes, hints: T.hints, chapter: T.ch.name } : null);
let seq = 0;
const visits = new Map();   // "study|fen|san" -> how often the opponent chose it this session

const board = new Board($('stBoard'), {
  getTargets: (from) => (T ? T.chess.moves({ square: from, verbose: true }).map((m) => m.to) : []),
  onMove: (from, to) => onUserMove(from, to),
});

function leaveTraining() {
  if (T) T.id = -1;
  T = null;
  board.setEnabled(false); board.setArrows([]);
}

function setStatus(text, cls = '') { const el = $('stStatus'); el.textContent = text; el.className = 'status ' + cls; }

const pref = (key, fallback) => { const v = store.S().prefs[key]; return v === undefined ? fallback : v; };

// the author's drawings, in the colours Lichess uses
const SHAPE_HEX = { green: '#15781b', red: '#c0392b', blue: '#1f6fd1', yellow: '#e6a100' };
function showShapes() {
  const s = T && T.shapes;       // the drawings from the latest move that had any; they stay up until your next move
  if (!s || pref('studyShapes', true) === false) { board.setShapes(null); return; }
  board.setShapes({
    arrows: s.arrows.map((a) => ({ from: a.from, to: a.to, color: SHAPE_HEX[a.color], opacity: 0.8, width: 0.15 })),
    circles: s.circles.map((c) => ({ sq: c.sq, color: SHAPE_HEX[c.color] })),
  });
}

function renderBoard() {
  const g = T.chess;
  board.set({ pieces: pieceMap(g), orientation: T.user, lastMove: lastMoveOf(g), check: g.inCheck() ? kingSquare(g, g.turn()) : null });
  board.setArrows([]);
  showShapes();
  const sans = g.history();
  $('stMoves').innerHTML = sans.map((s, i) => `${i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : ''}<b>${esc(s)}</b>`).join(' ');
}

function coach(html) { $('stCoach').innerHTML = html; }

function startTraining(study, chapterIndex) {
  const chapters = study.chapters;
  if (!chapters.length) return;
  const idx = chapterIndex >= 0 ? chapterIndex : Math.floor(Math.random() * chapters.length);
  newLine(study, chapterIndex, idx);
}

function newLine(study, chapterIndex, idx, flipUser) {
  const ch = study.chapters[idx];
  const user = flipUser || ch.orientation;
  T = {
    id: ++seq, study, chapterIndex, idx, ch, user, node: ch.root, chess: new Chess(ch.root.fen),
    mistakes: 0, hints: 0, over: false,
    prob: 1, known: true,      // the chance of meeting the opponent's replies in real games, and whether every one had data
    shapes: ch.root.shapes || null,
  };
  $('stReal').hidden = true; $('stReal').innerHTML = '';
  show('stTrain');
  $('stTitle').textContent = `${study.name} · ${ch.name}`;
  $('stCoach').hidden = false;
  coach(`<p class="muted">You play <b>${sideLabel(user)}</b>. Play the study's moves; the opponent answers with its lines.</p>
    <p class="muted small">This chapter has ${ch.lines} line${ch.lines === 1 ? '' : 's'}. A good move that is not in the study stops you so you can learn the study's choice; Hint shows it.</p>`);
  renderBoard();
  advance();
}

async function advance() {
  const id = T.id;
  while (T && T.id === id) {
    const node = T.node;
    if (!node.children.length) return finishLine();
    if (T.chess.turn() === T.user) {
      board.setEnabled(true, T.user);
      setStatus('Your move');
      return;
    }
    // the opponent's reply: mostly the main line, but other branches of the study come up too, favouring ones seen less
    board.setEnabled(false);
    setStatus('');
    // which branch of the study to play: the replies real players choose most often come up most, and branches already seen
    // this session come up less. Without real-game data it is mostly the main line.
    let real = null;
    if (pref('studyReal', true) !== false) {
      try { const d = await getPosition(node.fen); if (d && d.movesTotal >= 30) real = d; } catch (e) { real = null; }
      if (!T || T.id !== id) return;
    }
    const weights = node.children.map((c, i) => {
      const seen = 1 + (visits.get(`${T.study.id}|${node.fen}|${c.san}`) || 0);
      if (real) { const row = real.moves.find((m) => m.san === c.san); return (0.03 + (row ? row.games / real.movesTotal : 0)) / seen; }
      return (i === 0 ? 3 : 2) / seen;
    });
    let r = Math.random() * weights.reduce((a, b) => a + b, 0), pick = node.children[0];
    for (let i = 0; i < weights.length; i += 1) { r -= weights[i]; if (r <= 0) { pick = node.children[i]; break; } }
    visits.set(`${T.study.id}|${node.fen}|${pick.san}`, (visits.get(`${T.study.id}|${node.fen}|${pick.san}`) || 0) + 1);
    await sleep(Math.max(0, store.settings().botDelayMs || 180) + 120);
    if (!T || T.id !== id) return;
    applyMove(pick);
  }
}

function applyMove(child) {
  const parent = T.node, mover = T.chess.turn();
  const mv = T.chess.move(child.san);
  T.node = child;
  // the opponent answers at once, so the author's drawings for a move would vanish before you could read them:
  // keep them up through the reply, and clear them when you make your next move
  if (child.shapes) T.shapes = child.shapes;
  else if (mover === T.user) T.shapes = null;
  renderBoard();
  play(moveSound(mv, T.chess));
  if (child.comment) coach(`<p>${esc(child.comment)}</p>`);
  realCheck(parent, child, mover, T.id);
}

// ---------- the real-game reality check: what players actually do in the position the move was played from ----------

const compact = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(n));
const pctText = (x) => (x >= 0.995 ? '100%' : x >= 0.1 ? `${Math.round(x * 100)}%` : x > 0 ? `${(x * 100).toFixed(1)}%` : '0%');

async function realCheck(parent, child, mover, id) {
  const box = $('stReal');
  if (pref('studyReal', true) === false) { box.hidden = true; return; }
  let d = null;
  try { d = await getPosition(parent.fen); } catch (e) { d = null; }
  if (!T || T.id !== id) return;
  const mine = mover === T.user;
  const filters = `${store.speedLabel()}, rated ${store.ratingLabel()}`;
  if (!d || d.movesTotal < 30) {
    if (!mine) T.known = false;
    box.innerHTML = '<h4>Real games</h4><p class="muted small">Not enough real games from this position to say what players choose.</p>';
    box.hidden = false;
    return;
  }
  const row = d.moves.find((m) => m.san === child.san);
  const total = d.movesTotal, share = row ? row.games / total : 0;
  if (!mine) T.prob *= share;
  const others = d.moves.filter((m) => m.san !== child.san).slice(0, 3).map((m) => `<b>${esc(m.san)}</b> ${pctText(m.games / total)}`).join(' · ');
  const score = row ? Math.round(scoreFor(row, mover) * 100) : null;
  let note = '';
  if (!row) note = mine ? 'No real game from here has this move.' : 'No real game from here has this reply, so you would almost never meet it.';
  else if (share < 0.03) note = mine ? 'A rare choice: opponents will be unfamiliar with it, but it has had little real-game testing.' : `A rare reply (about 1 in ${Math.round(1 / share)} games), so you will not meet this often.`;
  else if (share >= 0.4) note = mine ? 'The most popular choice here.' : 'The most common reply: expect to see this one a lot.';
  box.innerHTML = `<h4>Real games <span class="muted small">${esc(filters)}</span></h4>
    <p>${mine ? 'You played' : 'Your opponent plays'} <b>${esc(child.san)}</b>: ${row ? `${pctText(share)} of ${compact(total)} games` : 'not found in real games'}${score != null ? `, scoring ${score}% for ${mover === 'w' ? 'White' : 'Black'}` : ''}.</p>
    ${note ? `<p class="small">${note}</p>` : ''}
    ${others ? `<p class="muted small">Other moves: ${others}</p>` : ''}`;
  box.hidden = false;
}

async function onUserMove(from, to) {
  if (!T || T.over) return;
  const g = T.chess;
  const legal = g.moves({ square: from, verbose: true }).find((m) => m.to === to);
  if (!legal) { renderBoard(); return; }
  let promo = '';
  if (legal.promotion) {                      // chess.com's picker: choose the piece the pawn becomes
    const id = T.id;
    const shown = pieceMap(g);
    shown[to] = shown[from]; delete shown[from];
    board.set({ pieces: shown, orientation: T.user, lastMove: [from, to] });
    const pick = await board.promptPromotion(to, T.user);
    if (!T || T.id !== id || T.over) return;
    if (!pick) { renderBoard(); return; }
    promo = pick;
  }
  const uci = from + to + promo;
  const match = T.node.children.find((c) => c.uci === uci);
  if (!match) {
    T.mistakes += 1;
    renderBoard();   // put the piece back
    const best = T.node.children.map((c) => c.san);
    setStatus('Not the study move', 'bad');
    coach(`<p><b>${esc(legal.san)}</b> is not in this study.</p><p class="muted small">${T.mistakes > 1 ? `The study plays <b>${best.map(esc).join('</b> or <b>')}</b> here. ` : ''}Try again, or press Hint.</p>`);
    board.setEnabled(true, T.user);
    return;
  }
  board.setEnabled(false);
  setStatus('');
  applyMove(match);
  if (match.comment) setStatus('');
  advance();
}

function finishLine() {
  T.over = true;
  board.setEnabled(false);
  const clean = T.mistakes === 0 && T.hints === 0;
  const byChapter = (data().progress[T.study.id] = data().progress[T.study.id] || {});
  const p = (byChapter[T.ch.name] = byChapter[T.ch.name] || { done: 0, clean: 0 });
  p.done += 1; if (clean) p.clean += 1; p.last = Date.now();
  store.save();
  play('done');
  setStatus(clean ? 'Clean line' : 'Line finished', clean ? 'good' : '');
  const last = T.node.comment ? `<p>${esc(T.node.comment)}</p>` : '';
  const key = `${T.study.id}|${T.ch.name}`;
  const seen = seenLines.get(key) || new Set();
  seen.add(T.chess.history().join(' ')); seenLines.set(key, seen);
  // how likely a real opponent is to follow this line: the product of how often players choose each of the opponent's moves
  let odds = '';
  if (pref('studyReal', true) !== false && T.known) {
    const opponentMoves = T.chess.history().length > 0;
    if (opponentMoves && T.prob < 1) odds = T.prob > 0 ? `<p class="small">In real games, an opponent follows this exact line about <b>1 time in ${Math.max(1, Math.round(1 / T.prob)).toLocaleString()}</b>.</p>` : '<p class="small">No real game follows this exact line.</p>';
  }
  coach(`${last}<h3>${clean ? 'Perfect — no mistakes' : 'Line complete'}</h3>
    <p class="muted small">${T.mistakes} wrong attempt${T.mistakes === 1 ? '' : 's'}, ${T.hints} hint${T.hints === 1 ? '' : 's'}. Lines covered in this chapter so far: ${Math.min(seen.size, T.ch.lines)} of ${T.ch.lines}.</p>
    ${odds}
    <div class="row"><button type="button" class="primary" id="stNext">Next line</button><button type="button" class="ghost" id="stChapters2">Chapters</button></div>`);
  const study = T.study;
  $('stNext').onclick = () => nextLine();
  $('stChapters2').onclick = () => { leaveTraining(); openStudy(study); };
}
const seenLines = new Map();   // "study|chapter" -> the distinct lines played this visit

function nextLine() {
  const { study, chapterIndex, idx, user, ch } = T;
  const flipped = user !== ch.orientation ? user : null;
  const nextIdx = chapterIndex >= 0 ? idx : Math.floor(Math.random() * study.chapters.length);
  newLine(study, chapterIndex, nextIdx, flipped && nextIdx === idx ? flipped : null);
}

// options
$('stShapesToggle').checked = pref('studyShapes', true) !== false;
$('stShapesToggle').addEventListener('change', () => { store.S().prefs.studyShapes = $('stShapesToggle').checked; store.save(); if (T) showShapes(); });
$('stRealToggle').checked = pref('studyReal', true) !== false;
$('stRealToggle').addEventListener('change', () => { store.S().prefs.studyReal = $('stRealToggle').checked; store.save(); if (!$('stRealToggle').checked) $('stReal').hidden = true; });

// controls
$('stBack').addEventListener('click', () => { const s = T && T.study; leaveTraining(); if (s) { current = s; renderDetail(); show('stDetail'); } else show('stList'); });
$('stRestart').addEventListener('click', () => { if (T) { const { study, chapterIndex, idx, user, ch } = T; newLine(study, chapterIndex, idx, user !== ch.orientation ? user : null); } });
$('stFlip').addEventListener('click', () => { if (T) { const { study, chapterIndex, idx, user } = T; newLine(study, chapterIndex, idx, user === 'w' ? 'b' : 'w'); } });
$('stHint').addEventListener('click', () => {
  if (!T || T.over || T.chess.turn() !== T.user || !T.node.children.length) return;
  T.hints += 1;
  const c = T.node.children[0];
  board.setArrows([{ from: c.uci.slice(0, 2), to: c.uci.slice(2, 4), color: '#003088', opacity: 0.55, width: 17 / 64 }]);
  setStatus('Hint: the arrow shows a study move');
});
