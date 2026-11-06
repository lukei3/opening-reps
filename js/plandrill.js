// Plan drill: a real position from a real game, you pick the plans the conditions support, then the advisor's answer is shown
// with the reasons. Uses the advisor's rules (js/advisor.js) so the two never disagree.

import { Chess } from '../lib/chess.js';
import { Board } from './board.js';
import { conditions, plans } from './advisor.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KEY = 'plansdrill.v1';

const CHOICES = [
  ['weak', 'Build up on a weak pawn'], ['outpost', 'Route a knight to an outpost'], ['rook', 'Rook to an open file'],
  ['storm', 'Pawn storm on the enemy king'], ['break', 'Play a pawn break'], ['bishops', 'Use or neutralise the bishop pair'],
  ['mobility', 'Free the pieces / keep them active'], ['counter', 'Counterplay on the other wing or in the centre'],
];
const BADGE = { good: 'Worth doing', maybe: 'Possible', avoid: 'Not now', na: 'Not available' };

let board = null, positions = null, cursor = 0, round = null, picked = new Set(), tally;
try { tally = JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { tally = null; }
tally = tally || { n: 0, perfect: 0, pts: 0, max: 0 };
const saveTally = () => { try { localStorage.setItem(KEY, JSON.stringify(tally)); } catch (e) { /* private mode */ } };

function pieceMap(fen) {
  const m = {};
  new Chess(fen).board().forEach((row) => row.forEach((p) => { if (p) m[p.square] = p.color + p.type.toUpperCase(); }));
  return m;
}

function nextRound() {
  for (let tries = 0; tries < 80; tries++) {
    const pos = positions[cursor++ % positions.length];
    const me = Math.random() < 0.7 ? 'b' : 'w';            // the King's Indian is mostly played as Black
    let list;
    try { list = plans(conditions(pos.fen, me)); } catch (e) { continue; }
    const good = list.filter((p) => p.status === 'good');
    if (good.length < 1 || good.length > 4) continue;
    round = { pos, me, list, good: new Set(good.map((p) => p.id)) };
    return true;
  }
  return false;
}

function renderTally() {
  const n = tally.n || 1;
  $('dpTally').innerHTML = `<div><b>${tally.n}</b>rounds</div><div><b>${Math.round(100 * tally.perfect / n)}%</b>perfect</div><div><b>${tally.max ? Math.round(100 * Math.max(0, tally.pts) / tally.max) : 0}%</b>of the points</div>`;
}

function show() {
  if (!nextRound()) { $('dpPrompt').textContent = 'The drill data did not load.'; return; }
  picked = new Set();
  const { pos, me } = round;
  board.set({ pieces: pieceMap(pos.fen), orientation: me, lastMove: null });
  board.setShapes({ arrows: [], circles: [] });
  $('dpPrompt').textContent = `You are ${me === 'w' ? 'White' : 'Black'}, move ${pos.move}. Which plans does this position support? Pick all that apply.`;
  $('dpChoices').innerHTML = CHOICES.map(([id, label]) => `<button type="button" class="chip" data-id="${id}">${esc(label)}</button>`).join('');
  $('dpChoices').hidden = false; $('dpCheck').hidden = false; $('dpCheck').disabled = false;
  $('dpResult').hidden = true; $('dpAfter').hidden = true;
  renderTally();
}

function check() {
  const { list, good, pos, me } = round;
  const byId = Object.fromEntries(list.map((p) => [p.id, p]));
  let right = 0, wrong = 0, missed = 0;
  const marks = {};
  for (const [id] of CHOICES) {
    const p = byId[id], st = p ? p.status : 'na', on = picked.has(id);
    if (st === 'good') { if (on) { right++; marks[id] = 'ok'; } else { missed++; marks[id] = 'missed'; } }
    else if (on && (st === 'avoid' || st === 'na')) { wrong++; marks[id] = 'bad'; }
    else if (on) marks[id] = 'neutral';
  }
  const perfect = missed === 0 && wrong === 0;
  const pts = Math.max(0, right - wrong);
  tally.n++; tally.perfect += perfect ? 1 : 0; tally.pts += pts; tally.max += good.size; saveTally();
  $('dpChoices').hidden = true; $('dpCheck').hidden = true;
  $('dpPrompt').textContent = perfect ? 'Exactly right.' : `You found ${right} of ${good.size}${wrong ? `, and picked ${wrong} that the data warns against or that do not apply` : ''}.`;
  const note = { ok: '✓ You picked this', missed: '✗ You missed this one', bad: '✗ You picked this, but it is not supported here', neutral: 'You picked this (acceptable)' };
  $('dpResult').innerHTML = list.map((p, i) => `<div class="ad-plan ${p.status}" data-i="${i}"><div class="ad-top"><b>${esc(p.title)}</b><span class="ad-badge ${p.status}">${BADGE[p.status]}</span></div>
    ${marks[p.id] ? `<p class="dp-mark ${marks[p.id]}">${note[marks[p.id]]}</p>` : ''}${p.why.map((w) => `<p>${esc(w)}</p>`).join('')}</div>`).join('');
  $('dpResult').hidden = false; $('dpAfter').hidden = false;
  const first = list.find((p) => p.shapes && p.status === 'good') || list.find((p) => p.shapes);
  if (first) board.setShapes({ arrows: first.shapes.arrows || [], circles: first.shapes.circles || [] });
  $('dpGame').href = `https://lichess.org/${pos.id}#${pos.move * 2}`;
  renderTally();
}

export async function showDrill() {
  if (!board) {
    board = new Board($('dpBoard'), { getTargets: () => [], onMove: () => {} });
    board.setEnabled(false);
    try { positions = await fetch('data/plans/drill.json').then((r) => r.json()); } catch (e) { positions = []; }
    for (let i = positions.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [positions[i], positions[j]] = [positions[j], positions[i]]; }
    $('dpChoices').addEventListener('click', (e) => {
      const b = e.target.closest('[data-id]'); if (!b) return;
      if (picked.has(b.dataset.id)) picked.delete(b.dataset.id); else picked.add(b.dataset.id);
      b.classList.toggle('on', picked.has(b.dataset.id));
    });
    $('dpCheck').onclick = check;
    $('dpNext').onclick = show;
    $('dpAdvisor').onclick = () => document.dispatchEvent(new CustomEvent('plans:advisor', { detail: { fen: round.pos.fen, me: round.me } }));
    $('dpResult').addEventListener('click', (e) => {
      const el = e.target.closest('.ad-plan'); if (!el || !round) return;
      const p = round.list[+el.dataset.i];
      board.setShapes(p && p.shapes ? { arrows: p.shapes.arrows || [], circles: p.shapes.circles || [] } : { arrows: [], circles: [] });
    });
    show();
  }
}
