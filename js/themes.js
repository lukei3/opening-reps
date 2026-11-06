// Themes: what each opening structure is about, from 480,000 real games. The numbers are mined (tools/plans/themes.py);
// the explanations are written by hand (tools/plans/build_themes.py) and are marked as such.

import { Chess } from '../lib/chess.js';
import { Board } from './board.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (x) => `${Math.round(x * 100)}%`;
const COLOR = { b: '#d9822b', w: '#2f9e6b' };
const KIND_TITLE = { man: 'Piece manoeuvres', push: 'Pawn pushes', exch: 'Exchanges', trade: 'Bishops traded' };

let data = null, board = null, loading = null;
const view = { s: 0, side: 'b', item: null };

async function load() {
  if (data) return data;
  if (!loading) loading = fetch('data/plans/themes.json').then((r) => { if (!r.ok) throw new Error('missing'); return r.json(); }).then((d) => (data = d)).catch((e) => { loading = null; throw e; });
  return loading;
}

const pieceMap = (fen) => {
  const m = {};
  new Chess(fen).board().forEach((row) => row.forEach((p) => { if (p) m[p.square] = p.color + p.type.toUpperCase(); }));
  return m;
};

function statLine(d) {
  const diff = d.diff * 100, ci = d.ci * 100, clear = Math.abs(diff) > ci;
  const cls = clear ? (diff > 0 ? 'good' : 'bad') : 'flat';
  const when = d.median_move ? `, usually around move ${d.median_move}` : '';
  return `<span class="th-stat"><b>${pct(d.share)}</b> of games${when} · <span class="th-diff ${cls}">${diff >= 0 ? '+' : '−'}${Math.abs(diff).toFixed(1)}</span> <span class="muted">± ${ci.toFixed(1)} vs games without</span></span>`;
}

// the squares an item talks about, for the board
function squaresOf(it) {
  if (it.kind === 'push') return [it.item];
  if (it.kind === 'exch') return [it.item.split(' on ')[1]];
  if (it.kind === 'man') return it.item.slice(2).split('-').slice(1);
  if (it.kind === 'trade') return [it.item.match(/from (\w\d)/)[1]];
  return [];
}
function showItem(it) {
  view.item = it ? it.item : null;
  const sqs = it ? squaresOf(it).filter((s) => /^[a-h][1-8]$/.test(s || '')) : [];
  board.setShapes({ arrows: [], circles: sqs.map((s, i) => ({ sq: s, color: i === sqs.length - 1 ? COLOR[view.side] : '#9aa1ad' })) });
  document.querySelectorAll('#thBody .th-item').forEach((n) => n.classList.toggle('on', n.dataset.item === view.item));
}

function itemCard(it, bucket, idx) {
  return `<div class="th-item" data-b="${bucket}" data-i="${idx}" data-item="${esc(it.item)}">
    <div class="th-title">${esc(it.title)} <span class="muted small">${esc(it.item)}</span></div>
    ${it.text ? `<p>${esc(it.text)}</p>` : ''}${statLine(it)}</div>`;
}

function render() {
  const s = data.structures[view.s], side = s.sides[view.side];
  $('thPicker').innerHTML = data.structures.map((x, i) => `<button type="button" class="chip${i === view.s ? ' on' : ''}" data-i="${i}">${esc(x.title)}<span class="pl-share">${pct(x.games / data.games)}</span></button>`).join('');
  $('thSide').innerHTML = ['b', 'w'].map((k) => `<button type="button" class="chip${view.side === k ? ' on' : ''}" data-side="${k}">${k === 'b' ? 'As Black (you)' : 'As White (your opponent)'}</button>`).join('');
  $('thTitle').textContent = s.title;
  $('thCount').textContent = `${s.games.toLocaleString()} real games reach this structure at move 12`;
  board.set({ pieces: s.fen ? pieceMap(s.fen) : {}, orientation: view.side, lastMove: null });
  board.setShapes({ arrows: [], circles: [] });
  let html = '';
  if (side.summary) html += `<p class="th-summary">${esc(side.summary)}</p>`;
  else html += '<p class="muted small th-summary">No written explanation for this structure yet. The numbers below are real, from the games.</p>';
  if (side.ideas.length) html += `<h3 class="ad-h">Key ideas</h3>${side.ideas.map((it, i) => itemCard(it, 'ideas', i)).join('')}`;
  if (side.watch.length) html += `<h3 class="ad-h">Watch out</h3>${side.watch.map((it, i) => itemCard(it, 'watch', i)).join('')}`;
  const pl = side.placement;
  html += `<h3 class="ad-h">Where the pieces stand at move 20</h3><ul class="th-place">${[['N', 'Knights'], ['B', 'Bishops'], ['R', 'Rooks'], ['Q', 'Queen'], ['K', 'King']].map(([k, n]) => `<li><b>${n}</b>: ${pl[k].map((d) => `${d.sq} ${pct(d.share)}`).join(', ')}</li>`).join('')}</ul>`;
  html += '<details class="th-more"><summary>More from the data</summary>' + ['man', 'push', 'exch', 'trade'].map((k) => {
    const rows = side.more[k];
    if (!rows || !rows.length) return '';
    return `<h4>${KIND_TITLE[k]}</h4>${rows.map((d) => `<div class="th-row"><span>${esc(d.item)}</span>${statLine(d)}</div>`).join('')}`;
  }).join('') + '</details>';
  html += `<p class="muted small th-note">${s.written ? 'Explanations written by Claude from the numbers and general chess knowledge, so tell me if one is wrong. ' : ''}Numbers: ${data.games.toLocaleString()} King's Indian games, 2023, both players rated 1400 to 2500. "vs games without" compares results after adjusting for the rating gap, so it shows what goes with an idea, not that the idea causes it.</p>`;
  $('thBody').innerHTML = html;
}

export async function showThemes() {
  try { await load(); } catch (e) { $('thBody').textContent = 'The themes data did not load. Check your connection and try again.'; return; }
  if (!board) {
    board = new Board($('thBoard'), { getTargets: () => [], onMove: () => {} });
    board.setEnabled(false);
    $('thPicker').addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) { view.s = +b.dataset.i; render(); } });
    $('thSide').addEventListener('click', (e) => { const b = e.target.closest('[data-side]'); if (b) { view.side = b.dataset.side; render(); } });
    $('thBody').addEventListener('click', (e) => {
      const el = e.target.closest('.th-item'); if (!el) return;
      const side = data.structures[view.s].sides[view.side];
      showItem(side[el.dataset.b][+el.dataset.i]);
    });
  }
  render();
}
