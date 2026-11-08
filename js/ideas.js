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
const CHOICES = [['right', 'Right', '1'], ['partly', 'Partly', '2'], ['wrong', 'Wrong', '3'], ['skip', "Can't tell", '4']];
function tally() {
  const v = Object.values(verdicts).filter((x) => x.verdict !== 'skip' && x.verdict !== 'unsure');
  const right = v.filter((x) => x.verdict === 'right').length, partly = v.filter((x) => x.verdict === 'partly').length;
  return { n: v.length, all: Object.keys(verdicts).length, right, partly, score: v.length ? (right + 0.5 * partly) / v.length : 0 };
}
let focus = null;           // the move the quick keys apply to: the first one not judged yet
const view = { side: 'b', sel: null, source: 'kid' };
// "Any opening": positions from the 1.5-billion-game book's ideas files, picked from your Train board, at random, or pasted
const anyList = [];
const shardCache = new Map();
function shardOf(key, n = 256) {
  let h = 5381;
  for (const ch of new TextEncoder().encode(key)) h = (Math.imul(h, 33) ^ ch) >>> 0;
  return h % n;
}
function shard(s) {
  if (!shardCache.has(s)) shardCache.set(s, fetch(`data/plans/ideas/s${String(s).padStart(3, '0')}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
  return shardCache.get(s);
}
async function anyPosition(fen) {
  const key = fen.split(' ').slice(0, 4).join(' ');
  const kid = data.positions.find((p) => p.fen.split(' ').slice(0, 4).join(' ') === key);
  return kid || (await shard(shardOf(key)))[key] || null;
}
async function addAny(p, note) {
  if (!p) { $('idMsg').textContent = note || 'No ideas for that position yet: it is not one of the common positions.'; return; }
  $('idMsg').textContent = '';
  anyList.unshift({ ...p, line: p.line || [] });
  if (anyList.length > 30) anyList.pop();
  cur = 0; render();
}

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

function filtered() { return view.source === 'any' ? anyList : data.positions.filter((p) => p.side === view.side); }

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
  const sans = move.pv || [move.san];   // the engine's line from this move, replayed one ply per 700 ms
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
  $('idSource').innerHTML = [['kid', "King's Indian (300 positions)"], ['any', 'Any opening (39,000 positions)']].map(([k, t]) => `<button type="button" class="chip${view.source === k ? ' on' : ''}" data-src="${k}">${t}</button>`).join('');
  $('idAnyCtl').hidden = view.source !== 'any';
  $('idSide').hidden = view.source === 'any';
  $('idSide').innerHTML = ['b', 'w'].map((k) => `<button type="button" class="chip${view.side === k ? ' on' : ''}" data-side="${k}">${k === 'b' ? 'Black to move' : 'White to move'}</button>`).join('');
  $('idPick').innerHTML = list.map((x, i) => `<option value="${i}"${i === cur ? ' selected' : ''}>${x.line && x.line.length ? esc(lineText(x.line)) : (x.side === 'w' ? 'White' : 'Black') + ' to move: ' + esc(x.fen.split(' ')[0].slice(0, 28)) + '…'}${x.games ? ` (${x.games.toLocaleString()} games)` : ''}</option>`).join('');
  $('idLine').textContent = p.line && p.line.length ? fullLine(p.line) : 'A common position from the opening book.';
  board.set({ pieces: pieces(p.fen), orientation: view.side, lastMove: null });
  const firstOpen = p.ideas.flatMap((g) => g.moves).find((m) => !done(p, m));
  focus = firstOpen ? firstOpen.uci : null;
  drawArrows(p, focus);
  const ideas = p.ideas.map((g, k) => `<div class="id-idea">
      <div class="id-head"><span class="id-dot" style="background:${COLORS[k % COLORS.length]}"></span><b>${esc(g.name)}</b> <span class="muted small">${g.moves.length} good move${g.moves.length > 1 ? 's' : ''}</span></div>
      ${g.moves.map((m) => {
        const v = verdicts[vKey(p.fen, m.uci)];
        const also = (m.also || []).map((x) => esc(x.name)).join(', ');
        const prep = m.prepares ? ` <span class="id-prep">preparing ${esc(m.prepares)}</span>` : '';
        const plan = m.plan ? ` <span class="id-plan" title="The plan this whole engine line belongs to, from grouping 109,000 engine lines">plan: ${esc(m.plan)}</span>` : '';
        return `<div class="id-move${focus === m.uci ? ' focus' : ''}" data-uci="${m.uci}"><b>${esc(m.san)}</b>${prep}${plan} <span class="muted">${pawns(m.cp)}</span>${m.conf < 0.45 ? ' <span class="id-unsure" title="The idea namer is not sure about this label">label unsure</span>' : ''}
        ${also ? `<span class="muted small"> · also: ${also}</span>` : ''}
        <span class="id-pv muted small">${esc((m.pv || []).join(' '))}</span>
        <span class="id-judge"><button type="button" class="ghost id-play" data-uci="${m.uci}">Play the line</button>
          ${g.theme === 'unclear' || (v && v.verdict === 'wrong') ? pickRow(p, m, g, v) : `<span class="muted small">“${esc(g.name)}” for ${esc(m.san)}${m.prepares ? ' (via ' + esc(m.prepares) + ')' : ''}?</span>
          ${CHOICES.map(([k, label, key]) => `<button type="button" class="ghost id-v${v && v.verdict === k ? ' on' : ''}" data-v="${k}" data-uci="${m.uci}" data-idea="${g.theme}" title="Key ${key}">${label} <span class="id-key">${key}</span></button>`).join('')}`}</span></div>`;
      }).join('')}
    </div>`).join('');
  const played = p.played.map((m) => `<tr><td><b>${esc(m.san)}</b></td><td>${Math.round(m.share * 100)}%</td><td class="${m.adj > 0.01 ? 'good' : m.adj < -0.01 ? 'bad' : ''}">${m.adj >= 0 ? '+' : '−'}${Math.abs(m.adj * 100).toFixed(1)}</td><td>${esc(m.name)}${m.conf < 0.45 ? ' <span class="id-unsure">unsure</span>' : ''}</td><td>${m.engine_good ? '✓' : '<span class="muted">not in the engine\'s top moves</span>'}</td></tr>`).join('');
  const t = tally();
  $('idBody').innerHTML = `
    <div class="id-tally">Your verdicts: <b>${t.all}</b>${t.n ? ` · namer score <b>${Math.round(100 * t.score)}%</b> (right ${t.right}, partly ${t.partly}, wrong ${t.n - t.right - t.partly})` : ''}.
      <span class="muted small">Quick keys: 1 right, 2 partly, 3 wrong, 4 can't tell. On an unsure move (or after Wrong), 1 to 3 pick the idea and 4 is none of these. The highlighted move is next, and it moves on by itself.</span>
      <button type="button" class="ghost" id="idExport"${t.all ? '' : ' disabled'}>Save my verdicts as a file</button></div>
    <p class="muted small">Engine evaluation of the best move: ${pawns(p.best_cp)} for the side to move. ${p.games.toLocaleString()} real games reached this position.</p>
    <h3 class="ad-h">The engine's good moves, grouped by idea</h3>${ideas}
    <h3 class="ad-h">What real players chose</h3>
    <div class="tablewrap"><table class="id-table"><thead><tr><th>Move</th><th>Chosen</th><th>Result vs rating</th><th>Idea</th><th>Engine</th></tr></thead><tbody>${played}</tbody></table></div>
    <p class="muted small th-note">Good moves are those within half a pawn of the engine's best (Stockfish, depth 18). Each move's idea is named by a model trained on 1,500 expert-labelled positions (the Strategic Test Suite); on positions it had not seen, it named the right idea about 80% of the time, so a label can be wrong. "Result vs rating" is how games with that move scored against what the ratings predicted, in points.</p>`;
}

// "Pick the idea": the namer's best guesses that fit this move or its line, plus "none of these" and a short note.
function pickRow(p, m, g, v) {
  const cands = (m.cands || []).slice(0, 3);
  const chosen = v && v.pick;
  const wrongNote = v && v.verdict === 'wrong' ? '<span class="muted small">Not that. What is it for?</span>' : `<span class="muted small">What is ${esc(m.san)} for?</span>`;
  return `${wrongNote}
    ${cands.map((c, i) => `<button type="button" class="ghost id-pick${chosen === c.theme ? ' on' : ''}" data-pick="${c.theme}" data-uci="${m.uci}" data-idea="${g.theme}" title="Key ${i + 1}">${esc(c.name)} <span class="id-key">${i + 1}</span></button>`).join('')}
    <button type="button" class="ghost id-pick${chosen === 'none' ? ' on' : ''}" data-pick="none" data-uci="${m.uci}" data-idea="${g.theme}" title="Key 4">None of these / can't tell <span class="id-key">4</span></button>
    <input class="id-note" data-uci="${m.uci}" type="text" placeholder="optional note, e.g. prepares f5" value="${esc((v && v.note) || '')}">`;
}

function nextOpenPosition() {
  for (let k = 1; k <= list.length; k++) {
    const i = (cur + k) % list.length, p = list[i];
    if (p.ideas.some((g) => g.moves.some((m) => !done(p, m)))) return i;
  }
  return cur;
}

function done(p, m) {
  const v = verdicts[vKey(p.fen, m.uci)];
  return !!v && (v.verdict !== 'wrong' || !!v.pick) && !(v.verdict === 'unsure' && !v.pick);
}

function record(uci, idea, verdict, pick) {
  const p = list[cur];
  const key = vKey(p.fen, uci);
  const old = verdicts[key] || {};
  verdicts[key] = { fen: p.fen, uci, idea, verdict, pick: pick || (verdict === old.verdict ? old.pick : undefined), note: old.note, at: new Date().toISOString() };
  saveVerdicts();
  const left = p.ideas.some((g) => g.moves.some((m) => !done(p, m)));
  if (!left) cur = nextOpenPosition();
  render();
  const el = document.querySelector('.id-move.focus');
  if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

export async function showIdeas() {
  try { await load(); } catch (e) { $('idBody').textContent = 'The ideas data did not load.'; return; }
  if (!board) {
    board = new Board($('idBoard'), { getTargets: () => [], onMove: () => {} });
    board.setEnabled(false);
    $('idSide').addEventListener('click', (e) => { const b = e.target.closest('[data-side]'); if (b) { view.side = b.dataset.side; cur = 0; render(); } });
    $('idPick').addEventListener('change', () => { cur = +$('idPick').value; render(); });
    $('idSource').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-src]'); if (!b) return;
      view.source = b.dataset.src; cur = 0;
      if (view.source === 'any' && !anyList.length) await randomAny(); else render();
    });
    const randomAny = async () => {
      for (let tries = 0; tries < 6; tries++) {
        const keys = Object.keys(await shard(Math.floor(Math.random() * 256)));
        if (keys.length) { const s = await shard(shardOf(keys[0])); return addAny(s[keys[Math.floor(Math.random() * keys.length)]]); }
      }
      return addAny(null, 'The ideas for other openings are not on this computer yet.');
    };
    $('idAnyRandom').addEventListener('click', randomAny);
    $('idAnyTrain').addEventListener('click', async () => {
      const g = window.__trainer && window.__trainer.G;
      if (!g || !g.chess) return addAny(null, 'Start a line in Train first.');
      addAny(await anyPosition(g.chess.fen()));
    });
    $('idAnyFenGo').addEventListener('click', async () => {
      const fen = $('idAnyFen').value.trim();
      if (fen.split(' ').length < 4) return addAny(null, 'Paste a full position (FEN).');
      addAny(await anyPosition(fen));
    });
    $('idRandom').addEventListener('click', () => { if (view.source === 'any') return randomAny(); cur = Math.floor(Math.random() * list.length); render(); });
    // Active learning: your verdicts teach the namer most where it is least sure, so offer those positions first.
    $('idUnsure').addEventListener('click', () => {
      const score = (p) => {
        const moves = p.ideas.flatMap((g) => g.moves.map((m) => ({ m, g })));
        const open = moves.filter(({ m }) => !verdicts[vKey(p.fen, m.uci)]);
        if (!open.length) return Infinity;
        return Math.min(...open.map(({ m, g }) => (g.theme === 'unclear' ? 0.5 : Math.abs(m.conf - 0.5))));
      };
      let best = 0, bestS = Infinity;
      list.forEach((p, i) => { const s2 = score(p); if (s2 < bestS) { bestS = s2; best = i; } });
      cur = best; render();
    });
    // quick keys 1-4 judge the highlighted move, only while the Ideas view is on screen and you are not typing
    document.addEventListener('keydown', (e) => {
      if ($('plIdeasPane').hidden || $('tab-plans').hidden || !focus || e.ctrlKey || e.metaKey || e.altKey) return;
      if (/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) return;
      const p = list[cur];
      const g = p.ideas.find((x) => x.moves.some((m) => m.uci === focus));
      if (!g) return;
      const m = g.moves.find((x) => x.uci === focus);
      const v = verdicts[vKey(p.fen, focus)];
      if (g.theme === 'unclear' || (v && v.verdict === 'wrong')) {
        const n = +e.key;
        if (!(n >= 1 && n <= 4)) return;
        const cands = (m.cands || []).slice(0, 3);
        const pick = n === 4 ? 'none' : (cands[n - 1] || {}).theme;
        if (!pick) return;
        e.preventDefault();
        record(focus, g.theme, g.theme === 'unclear' ? 'unsure' : 'wrong', pick);
        return;
      }
      const c = CHOICES.find(([, , key]) => key === e.key);
      if (c) { e.preventDefault(); record(focus, g.theme, c[0]); }
    });
    $('idBody').addEventListener('change', (e) => {
      const inp = e.target.closest('.id-note'); if (!inp) return;
      const p = list[cur], key = vKey(p.fen, inp.dataset.uci);
      verdicts[key] = { ...(verdicts[key] || { fen: p.fen, uci: inp.dataset.uci, verdict: 'unsure' }), note: inp.value.trim(), at: new Date().toISOString() };
      saveVerdicts();
    });
    $('idBody').addEventListener('click', (e) => {
      const p = list[cur];
      if (e.target.id === 'idExport') {
        const blob = new Blob([JSON.stringify(Object.values(verdicts), null, 1)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'idea-verdicts.json'; a.click();
        return;
      }
      const vb = e.target.closest('.id-v');
      if (vb) { record(vb.dataset.uci, vb.dataset.idea, vb.dataset.v); return; }
      const pb = e.target.closest('.id-pick');
      if (pb) { record(pb.dataset.uci, pb.dataset.idea, pb.dataset.idea === 'unclear' ? 'unsure' : 'wrong', pb.dataset.pick); return; }
      const play = e.target.closest('.id-play');
      if (play) { const m = p.ideas.flatMap((g) => g.moves).find((x) => x.uci === play.dataset.uci); if (m) playLine(p, m); return; }
      const mv = e.target.closest('.id-move');
      if (mv) { stopPlay(); board.set({ pieces: pieces(p.fen), orientation: view.side, lastMove: null }); drawArrows(p, mv.dataset.uci); }
    });
  }
  render();
}
