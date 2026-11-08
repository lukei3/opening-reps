// Ideas: for the common King's Indian positions, the engine's good moves grouped by the idea each one serves, and what real
// players chose. Data: data/plans/ideas.json (tools/plans/idea_namer.py). The idea namer was checked on 1,500 expert-labelled
// positions (Strategic Test Suite): it names the right idea about 80% of the time, so a label can be wrong.

import { Chess } from '../lib/chess.js';
import { Board } from './board.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const COLORS = ['#2f9e6b', '#d9822b', '#4f8ff7', '#c25bd6', '#d6c043', '#e0645c'];
const pawns = (cp) => `${cp >= 0 ? '+' : '−'}${Math.abs(cp / 100).toFixed(2)}`;

let data = null, board = null, loading = null, list = [], cur = 0, playTimer = null;

// Your verdicts on the idea labels, so the namer can be measured against you and retrained on your corrections.
const FB_KEY = 'opening-reps.idea-verdicts.v1';
const verdicts = (() => { try { return JSON.parse(localStorage.getItem(FB_KEY)) || {}; } catch (e) { return {}; } })();
const saveVerdicts = () => { try { localStorage.setItem(FB_KEY, JSON.stringify(verdicts)); } catch (e) { /* private mode */ } };
const vKey = (fen, uci) => fen.split(' ').slice(0, 4).join(' ') + '|' + uci;
function tally() {
  const v = Object.values(verdicts);
  const right = v.filter((x) => x.verdict === 'right').length;
  return { n: v.length, right };
}
const view = { side: 'b', sel: null };

async function load() {
  if (data) return data;
  if (!loading) loading = fetch('data/plans/ideas.json').then((r) => { if (!r.ok) throw new Error('missing'); return r.json(); }).then((d) => (data = d)).catch((e) => { loading = null; throw e; });
  return loading;
}

function lineText(line) {
  const start = Math.max(0, line.length - 6);
  let s = start > 0 ? '… ' : '';
  for (let i = start; i < line.length; i++) s += (i % 2 === 0 ? `${i / 2 + 1}.` : (i === start ? `${(i + 1) / 2}...` : '')) + line[i] + ' ';
  return s.trim();
}
function fullLine(line) { return line.map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}.` : '') + m).join(' '); }

function pieces(fen) {
  const m = {};
  new Chess(fen).board().forEach((row) => row.forEach((p) => { if (p) m[p.square] = p.color + p.type.toUpperCase(); }));
  return m;
}

function filtered() { return data.positions.filter((p) => p.side === view.side); }

function drawArrows(p, only) {
  const arrows = [];
  p.ideas.forEach((g, k) => g.moves.forEach((m) => {
    if (only && only !== m.uci) return;
    arrows.push({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), color: COLORS[k % COLORS.length], opacity: only ? 0.9 : 0.75, width: 0.15 });
  }));
  board.setShapes({ arrows, circles: [] });
}

function stopPlay() { if (playTimer) { clearInterval(playTimer); playTimer = null; } }

function playLine(p, move) {
  stopPlay();
  const g = new Chess(p.fen);
  const sans = move.pv;          // the engine's line from this move, replayed one ply per 700 ms
  let i = 0;
  board.setShapes({ arrows: [], circles: [] });
  playTimer = setInterval(() => {
    if (i >= sans.length) { stopPlay(); return; }
    const mv = g.move(sans[i]);
    if (!mv) { stopPlay(); return; }
    const pcs = pieces(g.fen());
    board.set({ pieces: pcs, orientation: view.side, lastMove: [mv.from, mv.to] });
    i++;
  }, 700);
}

function render() {
  stopPlay();
  list = filtered();
  if (!list.length) { $('idBody').innerHTML = '<p class="muted">No positions.</p>'; return; }
  cur = Math.min(cur, list.length - 1);
  const p = list[cur];
  $('idSide').innerHTML = ['b', 'w'].map((k) => `<button type="button" class="chip${view.side === k ? ' on' : ''}" data-side="${k}">${k === 'b' ? 'Black to move' : 'White to move'}</button>`).join('');
  $('idPick').innerHTML = list.map((x, i) => `<option value="${i}"${i === cur ? ' selected' : ''}>${esc(lineText(x.line))} (${x.games.toLocaleString()} games)</option>`).join('');
  $('idLine').textContent = fullLine(p.line);
  board.set({ pieces: pieces(p.fen), orientation: view.side, lastMove: null });
  drawArrows(p, null);
  const ideas = p.ideas.map((g, k) => `<div class="id-idea">
      <div class="id-head"><span class="id-dot" style="background:${COLORS[k % COLORS.length]}"></span><b>${esc(g.name)}</b> <span class="muted small">${g.moves.length} good move${g.moves.length > 1 ? 's' : ''}</span></div>
      ${g.moves.map((m) => {
        const v = verdicts[vKey(p.fen, m.uci)];
        const also = (m.also || []).map((x) => esc(x.name)).join(', ');
        return `<div class="id-move" data-uci="${m.uci}"><b>${esc(m.san)}</b> <span class="muted">${pawns(m.cp)}</span>${m.conf < 0.45 ? ' <span class="id-unsure" title="The idea namer is not sure about this label">label unsure</span>' : ''}
        ${also ? `<span class="muted small"> · also: ${also}</span>` : ''}
        <span class="id-pv muted small">${esc(m.pv.join(' '))}</span>
        <span class="id-judge"><button type="button" class="ghost id-play" data-uci="${m.uci}">Play the line</button>
          <span class="muted small">Is “${esc(g.name)}” right for ${esc(m.san)}?</span>
          <button type="button" class="ghost id-v${v && v.verdict === 'right' ? ' on' : ''}" data-v="right" data-uci="${m.uci}" data-idea="${g.theme}">Right</button>
          <button type="button" class="ghost id-v${v && v.verdict === 'wrong' ? ' on' : ''}" data-v="wrong" data-uci="${m.uci}" data-idea="${g.theme}">Wrong</button></span></div>`;
      }).join('')}
    </div>`).join('');
  const played = p.played.map((m) => `<tr><td><b>${esc(m.san)}</b></td><td>${Math.round(m.share * 100)}%</td><td class="${m.adj > 0.01 ? 'good' : m.adj < -0.01 ? 'bad' : ''}">${m.adj >= 0 ? '+' : '−'}${Math.abs(m.adj * 100).toFixed(1)}</td><td>${esc(m.name)}${m.conf < 0.45 ? ' <span class="id-unsure">unsure</span>' : ''}</td><td>${m.engine_good ? '✓' : '<span class="muted">not in the engine\'s top moves</span>'}</td></tr>`).join('');
  const t = tally();
  $('idBody').innerHTML = `
    <div class="id-tally">Your verdicts so far: <b>${t.n}</b>${t.n ? `, the namer was right on <b>${Math.round(100 * t.right / t.n)}%</b>` : ''}. <button type="button" class="ghost" id="idExport"${t.n ? '' : ' disabled'}>Save my verdicts as a file</button></div>
    <p class="muted small">Engine evaluation of the best move: ${pawns(p.best_cp)} for the side to move. ${p.games.toLocaleString()} real games reached this position.</p>
    <h3 class="ad-h">The engine's good moves, grouped by idea</h3>${ideas}
    <h3 class="ad-h">What real players chose</h3>
    <div class="tablewrap"><table class="id-table"><thead><tr><th>Move</th><th>Chosen</th><th>Result vs rating</th><th>Idea</th><th>Engine</th></tr></thead><tbody>${played}</tbody></table></div>
    <p class="muted small th-note">Good moves are those within half a pawn of the engine's best (Stockfish, depth 18). Each move's idea is named by a model trained on 1,500 expert-labelled positions (the Strategic Test Suite); on positions it had not seen, it named the right idea about 80% of the time, so a label can be wrong. "Result vs rating" is how games with that move scored against what the ratings predicted, in points.</p>`;
}

export async function showIdeas() {
  try { await load(); } catch (e) { $('idBody').textContent = 'The ideas data did not load.'; return; }
  if (!board) {
    board = new Board($('idBoard'), { getTargets: () => [], onMove: () => {} });
    board.setEnabled(false);
    $('idSide').addEventListener('click', (e) => { const b = e.target.closest('[data-side]'); if (b) { view.side = b.dataset.side; cur = 0; render(); } });
    $('idPick').addEventListener('change', () => { cur = +$('idPick').value; render(); });
    $('idRandom').addEventListener('click', () => { cur = Math.floor(Math.random() * list.length); render(); });
    $('idBody').addEventListener('click', (e) => {
      const p = list[cur];
      if (e.target.id === 'idExport') {
        const blob = new Blob([JSON.stringify(Object.values(verdicts), null, 1)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'idea-verdicts.json'; a.click();
        return;
      }
      const vb = e.target.closest('.id-v');
      if (vb) {
        verdicts[vKey(p.fen, vb.dataset.uci)] = { fen: p.fen, uci: vb.dataset.uci, idea: vb.dataset.idea, verdict: vb.dataset.v, at: new Date().toISOString() };
        saveVerdicts(); render(); return;
      }
      const play = e.target.closest('.id-play');
      if (play) { const m = p.ideas.flatMap((g) => g.moves).find((x) => x.uci === play.dataset.uci); if (m) playLine(p, m); return; }
      const mv = e.target.closest('.id-move');
      if (mv) { stopPlay(); board.set({ pieces: pieces(p.fen), orientation: view.side, lastMove: null }); drawArrows(p, mv.dataset.uci); }
    });
  }
  render();
}
