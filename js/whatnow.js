// "What now?": when a Train line ends, show the ideas for the position you reached (the engine's good moves grouped by the
// idea they serve) and offer a one-question quiz. Reads the same data as the Ideas view: data/plans/ideas.json (the common
// King's Indian positions) and, when present, data/plans/ideas-all.json (common positions from every opening).

import { Chess } from '../lib/chess.js';
import { getBookPosition } from './book.js';

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let index = null, loading = null;

async function load() {
  if (index) return index;
  if (!loading) {
    loading = (async () => {
      const map = new Map();
      for (const url of ['data/plans/ideas.json']) {
        try {
          const r = await fetch(url);
          if (!r.ok) continue;
          const d = await r.json();
          for (const p of d.positions || []) map.set(p.fen.split(' ').slice(0, 4).join(' '), p);
        } catch (e) { /* that file is optional */ }
      }
      index = map;
      return map;
    })();
  }
  return loading;
}

const pawns = (cp) => `${cp >= 0 ? '+' : '−'}${Math.abs(cp / 100).toFixed(2)}`;

// The ideas for every opening are split into 256 small files by the same position hash as the opening book.
const shardCache = new Map();
function shardOf(key, n = 256) {
  let h = 5381;
  for (const ch of new TextEncoder().encode(key)) h = (Math.imul(h, 33) ^ ch) >>> 0;
  return h % n;
}
async function fromShards(key) {
  const s = shardOf(key);
  if (!shardCache.has(s)) {
    shardCache.set(s, fetch(`data/plans/ideas/s${String(s).padStart(3, '0')}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
  }
  return (await shardCache.get(s))[key] || null;
}

/** The ideas position for `fen`: the position itself, or the nearest one along the book's usual moves. */
export async function resolveIdeas(fen) {
  const map = await load();
  const key = fen.split(' ').slice(0, 4).join(' ');
  const p = map.get(key) || await fromShards(key);
  if (p && p.ideas.some((g) => g.theme !== 'unclear')) return { p, via: [] };
  return nearby(fen, map);
}

/** Fill `box` with the ideas for `fen`, or leave it empty if this position has none yet. */
export async function showWhatNow(box, fen) {
  if (!box) return;
  const map = await load();
  const key = fen.split(' ').slice(0, 4).join(' ');
  let p = map.get(key) || await fromShards(key);
  let via = [];
  const clear = (x) => x && x.ideas.some((g) => g.theme !== 'unclear');
  if (!clear(p)) ({ p, via } = await nearby(fen, map));
  if (!p) { box.innerHTML = ''; return; }
  const ideas = p.ideas.filter((g) => g.theme !== 'unclear').slice(0, 3);
  if (!ideas.length) { box.innerHTML = ''; return; }
  const who = p.side === 'w' ? 'White' : 'Black';
  box.innerHTML = `<div class="wn card">
    <h3>What now? ${who}'s ideas here</h3>
    ${via.length ? `<p class="small">Your line stops just before a common position. Play usually goes on <b>${esc(via.join(' '))}</b>, and from there:</p>` : ''}
    <p class="muted small">The engine's good moves from this position, grouped by the idea they serve (${p.games ? p.games.toLocaleString() + ' real games reached it' : 'from the opening book'}).</p>
    ${ideas.map((g) => `<div class="wn-idea"><b>${esc(g.name)}</b>: ${g.moves.map((m) => `${esc(m.san)}${m.prepares ? ` <span class="muted small">(preparing ${esc(m.prepares)})</span>` : ''}${m.plan ? ` <span class="muted small">· plan: ${esc(m.plan)}</span>` : ''} <span class="muted small">${pawns(m.cp)}</span>`).join(', ')}</div>`).join('')}
    <div class="row"><button type="button" class="ghost" data-wn="quiz">Test me</button></div>
    <div class="wn-quiz" hidden></div></div>`;
  box.querySelector('[data-wn="quiz"]').onclick = () => quiz(box.querySelector('.wn-quiz'), p, ideas);
}

// When the line ends just short of a position with ideas, follow the opening book's most-played moves (up to six) to reach one.
async function nearby(fen, map) {
  const g = new Chess(fen);
  const via = [];
  for (let k = 0; k < 6; k++) {
    let data;
    try { data = await getBookPosition(g.fen()); } catch (e) { return { p: null, via: [] }; }
    if (!data || !data.moves.length) return { p: null, via: [] };
    const top = data.moves[0];
    const mv = g.move(top.san);
    if (!mv) return { p: null, via: [] };
    via.push((g.turn() === 'b' ? `${g.moveNumber()}.` : `${g.moveNumber() - 1}...`) + mv.san);
    const key = g.fen().split(' ').slice(0, 4).join(' ');
    const p = map.get(key) || await fromShards(key);
    if (p && p.ideas.some((x) => x.theme !== 'unclear')) return { p, via };
  }
  return { p: null, via: [] };
}

function quiz(el, p, ideas) {
  const main = ideas[0];
  const right = main.moves[0];
  // the wrong answers: good moves that serve other ideas, then moves real players chose
  const others = [...ideas.slice(1).flatMap((g) => g.moves), ...p.played.map((m) => ({ san: m.san }))]
    .map((m) => m.san).filter((s, i, a) => s !== right.san && a.indexOf(s) === i).slice(0, 3);
  const options = [right.san, ...others].sort(() => Math.random() - 0.5);
  el.hidden = false;
  el.innerHTML = `<p>Which move starts the plan “${esc(main.name)}”?</p>
    <div class="row">${options.map((s) => `<button type="button" class="ghost" data-a="${esc(s)}">${esc(s)}</button>`).join('')}</div><p class="wn-fb"></p>`;
  el.querySelectorAll('[data-a]').forEach((b) => {
    b.onclick = () => {
      const ok = b.dataset.a === right.san;
      el.querySelector('.wn-fb').innerHTML = ok
        ? `Right: ${esc(right.san)}${right.prepares ? `, preparing ${esc(right.prepares)}` : ''}. The engine's line: ${esc((right.pv || []).join(' '))}`
        : `Not quite. ${esc(b.dataset.a)} serves a different idea; the plan “${esc(main.name)}” starts with ${esc(right.san)}.`;
      el.querySelector('.wn-fb').className = 'wn-fb ' + (ok ? 'good' : 'bad');
    };
  });
}
