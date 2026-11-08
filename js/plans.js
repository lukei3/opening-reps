// Plans: what real players do after the opening line ends, and how it turned out. Self-contained: it only reads
// data/plans/kid.json (made by tools/plans/build_cards.py) and draws a read-only board.

import { Chess } from '../lib/chess.js';
import { Board } from './board.js';
import { showAdvisor, openFen } from './advisor.js';
import { showPlanDrill } from './plandrill2.js';
import { showThemes } from './themes.js';
import { showIdeas } from './ideas.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let data = null, loading = null, board = null;
const view = { s: 0, side: 'b', plan: null };     // the King's Indian is a Black opening: Black's side of the board, Black's plan first

const COLORS = { w: '#2f9e6b', b: '#d9822b' };

const pieceMap = (fen) => {
  const m = {};
  for (const row of new Chess(fen).board()) for (const p of row) if (p) m[p.square] = p.color + p.type.toUpperCase();
  return m;
};

async function load() {
  if (data) return data;
  if (!loading) {
    loading = fetch('data/plans/kid.json').then((r) => { if (!r.ok) throw new Error('missing'); return r.json(); })
      .then((d) => { data = d; return d; })
      .catch((e) => { loading = null; throw e; });
  }
  return loading;
}

const pct = (x) => `${Math.round(x * 100)}%`;
const signed = (x, d = 1) => `${x >= 0 ? '+' : 'âˆ’'}${Math.abs(x).toFixed(d)}`;

function moveText(moves) {
  let out = '';
  moves.forEach((m, i) => { out += (i % 2 === 0 ? `${i / 2 + 1}. ` : '') + m + ' '; });
  return out.trim();
}

function overview() {
  const c = data.castling_engine || {};
  const lines = [];
  const a = c['attack on their king|same side'], o = c['attack on their king|opposite sides'], m = c['central play|same side'];
  if (a) lines.push(`When both kings are on the same side, pushing pawns at the king cost the engine's verdict <b>${Math.abs(a.cp)} centipawns</b> on average between move 12 and 25 (${a.n.toLocaleString()} games, Â± ${a.ci}). That is roughly a quarter of a pawn.`);
  if (o) lines.push(`With kings on opposite sides the same attack is ${o.cp >= 0 ? 'ahead' : 'behind'} by ${Math.abs(o.cp)} centipawns, but only ${o.n.toLocaleString()} games qualify (Â± ${o.ci}), so treat it as a hint.`);
  if (m) lines.push(`Breaking open the centre was the plan the engine liked best (${signed(m.cp / 100, 2)} pawns, Â± ${(m.ci / 100).toFixed(2)}), yet it is played in under one game in ten.`);
  return lines;
}

function renderOverview() {
  const items = overview().map((l) => `<li>${l}</li>`).join('');
  $('plOverview').innerHTML = `<h2>What ${data.games.toLocaleString()} real games say</h2>
    <p class="muted small">Whole ${esc(data.name)} games from Lichess, players rated 1400 to 2500. After move 12 each side's pawn moves are labelled as a plan, and the result is compared with what the rating gap predicts.</p>
    <ul class="pl-points">${items}</ul>`;
}

function renderPicker() {
  $('plPicker').innerHTML = data.structures.map((s, i) =>
    `<button type="button" class="chip${i === view.s ? ' on' : ''}" data-i="${i}">${esc(s.title)}<span class="pl-share">${pct(s.share)}</span></button>`).join('');
}

function drawBoard() {
  const s = data.structures[view.s];
  board.set({ pieces: pieceMap(s.fen), orientation: 'b', lastMove: s.last ? [s.last.slice(0, 2), s.last.slice(2, 4)] : null });
  const p = view.plan && s.plans[view.side].find((x) => x.plan === view.plan);
  const arrows = ((p && p.arrows) || []).map((a) => ({ from: a.uci.slice(0, 2), to: a.uci.slice(2, 4), color: COLORS[view.side], opacity: 0.85, width: 0.16 }));
  board.setShapes({ arrows, circles: [] });
}

function planRow(p) {
  const vs = p.vs * 100, ci = p.ci * 100;
  const clear = Math.abs(vs) > ci;
  const width = Math.min(50, Math.abs(vs) * 6);       // bar grows from the centre line: 1 point = 6% of the half-width
  const bar = `<span class="pl-bar"><i class="${vs >= 0 ? 'up' : 'down'}${clear ? '' : ' faint'}" style="width:${width}%"></i></span>`;
  let eng = '<span class="muted">too few engine games</span>';
  if (p.engine) {
    const e = p.engine, sig = Math.abs(e.cp) > e.ci;
    eng = `Engine: <b>${signed(e.cp / 100, 2)}</b> pawns by move 25${sig ? '' : ' <span class="muted">(unclear)</span>'}`;
  }
  const on = view.plan === p.plan ? ' on' : '';
  const arrows = p.arrows.length ? `<span class="muted small">Typical pushes (arrows): ${p.arrows.map((a) => `${a.uci.slice(0, 2)}â€“${a.uci.slice(2, 4)}`).join(', ')}</span>` : '';
  return `<button type="button" class="pl-plan${on}" data-plan="${esc(p.plan)}">
    <span class="pl-top"><b>${esc(p.label)}</b><span class="muted">${pct(p.share)} of games</span></span>
    ${bar}
    <span class="pl-line">Scores ${(p.score * 100).toFixed(0)}%, ${esc(p.verdict.replace(/^scores /, ''))}</span>
    <span class="pl-line">${eng}</span>${arrows}
  </button>`;
}

function renderCard() {
  const s = data.structures[view.s];
  const rows = s.plans[view.side];
  if (!view.plan || !rows.some((r) => r.plan === view.plan)) view.plan = rows.length ? rows[0].plan : null;
  $('plSide').innerHTML = ['b', 'w'].map((k) => `<button type="button" class="chip${view.side === k ? ' on' : ''}" data-side="${k}">${k === 'w' ? "White's plan (your opponent)" : 'Your plan (Black)'}</button>`).join('');
  $('plPlans').innerHTML = rows.length ? rows.map(planRow).join('') : '<p class="muted">Not enough games here to say.</p>';
  $('plMoves').textContent = moveText(s.moves);
  $('plTitle').textContent = s.title;
  $('plCount').textContent = `${s.games.toLocaleString()} games reach this structure at move ${data.at_move}`;
  drawBoard();
}

let mode = 'ideas', modeWired = false;   // the advisor and the drill are parked (their chips are hidden) until they are reworked
export function showPlans() {
  if (!modeWired) {
    modeWired = true;
    $('plMode').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) { mode = b.dataset.mode; showPlans(); } });
    document.addEventListener('plans:advisor', (e) => { mode = 'adv'; showPlans(); openFen(e.detail.fen, e.detail.me); });
  }
  document.querySelectorAll('#plMode .chip').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  $('plAdvPane').hidden = mode !== 'adv';
  $('plDrillPane').hidden = mode !== 'drill';
  $('plStatsPane').hidden = mode !== 'stats';
  $('plThemesPane').hidden = mode !== 'themes';
  $('plIdeasPane').hidden = mode !== 'ideas';
  if (mode === 'adv') showAdvisor(); else if (mode === 'drill') showPlanDrill(); else if (mode === 'themes') showThemes(); else if (mode === 'ideas') showIdeas(); else showStats();
}

async function showStats() {
  const msg = $('plMsg');
  try { await load(); } catch (e) { msg.textContent = 'The plans data did not load. Check your connection and try again.'; return; }
  msg.textContent = '';
  if (!board) {
    board = new Board($('plBoard'), { getTargets: () => [], onMove: () => {} });
    board.setEnabled(false);
    $('plPicker').addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) { view.s = +b.dataset.i; view.plan = null; renderPicker(); renderCard(); } });
    $('plSide').addEventListener('click', (e) => { const b = e.target.closest('[data-side]'); if (b) { view.side = b.dataset.side; view.plan = null; renderCard(); } });
    $('plPlans').addEventListener('click', (e) => { const b = e.target.closest('[data-plan]'); if (b) { view.plan = b.dataset.plan; renderCard(); } });
  }
  renderOverview(); renderPicker(); renderCard();
}
