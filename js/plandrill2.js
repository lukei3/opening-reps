// Plan drill: a real position you will reach in the King's Indian, and the question "what is the plan here?".
// The answers are the plans of the engine's good moves (each line's plan comes from grouping 109,000 engine lines);
// any plan a good move follows counts as right. Positions come back on a spaced-repetition schedule like Train:
// wrong answers return soon, right answers wait longer each time.

import { Chess } from '../lib/chess.js';
import { Board } from './board.js';
import { S } from './store.js';
import { resolveIdeas } from './whatnow.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KEY = 'opening-reps.plan-drill.v1';
const DAY = 86400000;
const GAPS = [10 * 60000, DAY, 3 * DAY, 7 * DAY, 21 * DAY, 60 * DAY];   // after 0, 1, 2 ... right answers in a row

let board = null, pool = null, cur = null, state = null;
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* private mode */ } };

function pieces(fen) {
  const m = {};
  new Chess(fen).board().forEach((row) => row.forEach((p) => { if (p) m[p.square] = p.color + p.type.toUpperCase(); }));
  return m;
}

async function buildPool() {
  const d = await fetch('data/plans/ideas.json').then((r) => r.json());
  const allPlans = new Set();
  const out = [];
  // positions from your own finished Train lines come first (the last 150), then the King's Indian set
  const mine = [];
  const seen = new Set();
  for (const h of (S().history || []).slice(-150).reverse()) {
    if (!h.fen) continue;
    try {
      const { p } = await resolveIdeas(h.fen);
      if (p && !seen.has(p.fen)) { seen.add(p.fen); mine.push({ ...p, mine: true }); }
    } catch (e) { /* skip */ }
  }
  for (const p of [...mine, ...d.positions]) {
    const moves = p.ideas.flatMap((g) => g.moves).filter((m) => m.plan);
    moves.forEach((m) => allPlans.add(m.plan));
    const plans = [...new Set(moves.map((m) => m.plan))];
    if (plans.length && !out.some((o) => o.fen === p.fen)) out.push({ ...p, plans, moves });
  }
  return { positions: out, allPlans: [...allPlans] };
}

function due() {
  const now = Date.now();
  const mineUnseen = pool.positions.filter((p) => p.mine && !state[p.fen]);
  const unseen = mineUnseen.length ? mineUnseen : pool.positions.filter((p) => !state[p.fen]);
  const ready = pool.positions.filter((p) => state[p.fen] && state[p.fen].due <= now).sort((a, b) => state[a.fen].due - state[b.fen].due);
  return ready[0] || unseen[Math.floor(Math.random() * unseen.length)] || pool.positions[Math.floor(Math.random() * pool.positions.length)];
}

function ask() {
  cur = due();
  const side = cur.side === 'w' ? 'White' : 'Black';
  board.set({ pieces: pieces(cur.fen), orientation: cur.side, lastMove: null });
  board.setShapes({ arrows: [], circles: [] });
  const right = cur.plans;
  const others = pool.allPlans.filter((x) => !right.includes(x)).sort(() => Math.random() - 0.5).slice(0, Math.max(2, 4 - right.length));
  const options = [...right.slice(0, 2), ...others].sort(() => Math.random() - 0.5);
  const st = state[cur.fen];
  $('pdQ').textContent = `${side} to move. What is the plan here?`;
  $('pdMeta').textContent = `${cur.line && cur.line.length ? cur.line.map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}.` : '') + m).slice(-8).join(' ') : ''}${st ? ` · seen ${st.seen}×, ${st.streak} right in a row` : ' · new position'}`;
  $('pdOpts').innerHTML = options.map((o, i) => `<button type="button" class="ghost pd-opt" data-o="${esc(o)}">${esc(o)} <span class="id-key">${i + 1}</span></button>`).join('');
  $('pdFb').innerHTML = '';
  $('pdNext').hidden = true;
  renderStats();
}

function answer(choice) {
  if (!$('pdNext').hidden) return;
  const ok = cur.plans.includes(choice);
  const st = state[cur.fen] || { seen: 0, streak: 0, due: 0 };
  st.seen++; st.streak = ok ? st.streak + 1 : 0;
  st.due = Date.now() + GAPS[Math.min(st.streak, GAPS.length - 1)];
  state[cur.fen] = st; save();
  document.querySelectorAll('.pd-opt').forEach((b) => b.classList.add(cur.plans.includes(b.dataset.o) ? 'right' : (b.dataset.o === choice ? 'wrong' : 'dim')));
  const show = cur.moves.filter((m) => m.plan).slice(0, 4);
  const arrows = show.map((m) => ({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), color: m.plan === choice ? '#2f9e6b' : '#4f8ff7', opacity: 0.85, width: 0.15 }));
  board.setShapes({ arrows, circles: [] });
  $('pdFb').innerHTML = `<p class="${ok ? 'good' : 'bad'}">${ok ? 'Right.' : 'Not quite.'} The engine's good moves here follow:</p>
    ${show.map((m) => `<div class="pd-line"><b>${esc(m.san)}</b> <span class="muted">${esc(m.plan)}</span> <span class="muted small">${esc((m.pv || []).slice(0, 6).join(' '))}</span></div>`).join('')}
    <p class="muted small">Next time: ${ok ? `in ${Math.round((st.due - Date.now()) / 3600000)} hours or more` : 'in about 10 minutes'}.</p>`;
  $('pdNext').hidden = false;
  renderStats();
}

function renderStats() {
  const seen = Object.keys(state).length;
  const now = Date.now();
  const dueN = Object.values(state).filter((s) => s.due <= now).length;
  const mine = pool.positions.filter((p) => p.mine).length;
  $('pdStats').textContent = `${pool.positions.length} positions (${mine} from your own lines) · seen ${seen} · due now ${dueN}`;
}

export async function showPlanDrill() {
  if (!board) {
    board = new Board($('pdBoard'), { getTargets: () => [], onMove: () => {} });
    board.setEnabled(false);
    state = load();
    try { pool = await buildPool(); } catch (e) { $('pdQ').textContent = 'The drill data did not load.'; return; }
    $('pdOpts').addEventListener('click', (e) => { const b = e.target.closest('[data-o]'); if (b) answer(b.dataset.o); });
    $('pdNext').addEventListener('click', ask);
    document.addEventListener('keydown', (e) => {
      if ($('plDrillPane').hidden || $('tab-plans').hidden || /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) return;
      if (!$('pdNext').hidden && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); ask(); return; }
      const n = +e.key; const b = document.querySelectorAll('.pd-opt')[n - 1];
      if (b && $('pdNext').hidden) { e.preventDefault(); answer(b.dataset.o); }
    });
    ask();
  }
}
