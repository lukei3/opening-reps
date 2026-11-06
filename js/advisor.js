// Plan advisor: reads the conditions in a position and lists which plans they support, with the reason.
// The rules come from lab/plans/GUIDE.md (480,000 real King's Indian games plus engine checks). Self-contained.

import { Chess } from '../lib/chess.js';
import { Board } from './board.js';
import { analyse } from './engine.js';

const FILES = 'abcdefgh';
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- board geometry (index = rank * 8 + file, rank 0 is the first rank) ----------
const sqName = (i) => FILES[i & 7] + ((i >> 3) + 1);
const fileOf = (i) => i & 7;
const rankOf = (i) => i >> 3;
const adv = (i, c) => (c === 'w' ? rankOf(i) - 1 : 6 - rankOf(i));        // squares a pawn of colour c on i has come up from its start rank
const wingOf = (f) => (f <= 2 ? 'Q' : f >= 5 ? 'K' : 'C');
const WING_NAME = { Q: 'queenside', K: 'kingside', C: 'centre' };
const KN = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]], ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function parse(fen) {
  const g = Array(64).fill(null);
  new Chess(fen).board().forEach((row, r) => row.forEach((p, f) => { if (p) g[(7 - r) * 8 + f] = { t: p.type, c: p.color }; }));
  return g;
}

function attacksFrom(g, i) {
  const p = g[i]; if (!p) return [];
  const r = rankOf(i), f = fileOf(i), out = [];
  const add = (rr, ff) => { if (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) out.push(rr * 8 + ff); };
  if (p.t === 'p') { const d = p.c === 'w' ? 1 : -1; add(r + d, f - 1); add(r + d, f + 1); }
  else if (p.t === 'n') for (const [a, b] of KN) add(r + a, f + b);
  else if (p.t === 'k') { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (a || b) add(r + a, f + b); }
  else {
    const dirs = p.t === 'b' ? DIAG : p.t === 'r' ? ORTH : DIAG.concat(ORTH);
    for (const [a, b] of dirs) {
      let rr = r + a, ff = f + b;
      while (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) { out.push(rr * 8 + ff); if (g[rr * 8 + ff]) break; rr += a; ff += b; }
    }
  }
  return out;
}
const attackerCount = (g, sq, c) => { let n = 0; for (let i = 0; i < 64; i++) if (g[i] && g[i].c === c && attacksFrom(g, i).includes(sq)) n++; return n; };
const pawnAttacked = (g, sq, c) => { for (let i = 0; i < 64; i++) if (g[i] && g[i].t === 'p' && g[i].c === c && attacksFrom(g, i).includes(sq)) return true; return false; };

function knightRoute(g, from, targets, me, en) {
  const tset = new Set(targets);
  if (tset.has(from)) return [from];
  const next = (s) => {
    const out = [];
    for (const [a, b] of KN) {
      const r = rankOf(s) + a, f = fileOf(s) + b;
      if (r < 0 || r > 7 || f < 0 || f > 7) continue;
      const t = r * 8 + f;
      if (g[t] && g[t].c === me) continue;
      if (pawnAttacked(g, t, en)) continue;
      out.push(t);
    }
    return out;
  };
  for (const a of next(from)) { if (tset.has(a)) return [from, a]; }
  for (const a of next(from)) for (const b of next(a)) { if (tset.has(b)) return [from, a, b]; }
  return null;
}

// ---------- the conditions the research found to matter ----------
export function conditions(fen, me) {
  const g = parse(fen), en = me === 'w' ? 'b' : 'w';
  const king = (c) => g.findIndex((p) => p && p.t === 'k' && p.c === c);
  const mk = king(me), ek = king(en);
  const pw = (c) => g.map((p, i) => (p && p.t === 'p' && p.c === c ? i : -1)).filter((i) => i >= 0);
  const mine = pw(me), theirs = pw(en);
  const advIn = (c, wing) => pw(c).filter((i) => wingOf(fileOf(i)) === wing).reduce((s, i) => s + adv(i, c), 0);
  const myWing = wingOf(fileOf(mk)), target = wingOf(fileOf(ek));
  const c = { g, me, en, myWing, target, myKing: mk, enKing: ek };
  c.race = (target !== 'C' && myWing !== 'C') ? advIn(me, target) - advIn(en, myWing) : null;
  c.progress = advIn(me, target);
  // centre
  let blocked = 0, tension = 0;
  for (const col of ['w', 'b']) for (const i of pw(col)) {
    if ((fileOf(i) === 3 || fileOf(i) === 4) && col === 'w') { const a = g[i + 8]; if (a && a.t === 'p' && a.c === 'b') blocked++; }
    for (const a of attacksFrom(g, i)) if (g[a] && g[a].t === 'p' && g[a].c !== col) tension++;
  }
  c.centre = blocked >= 2 && tension === 0 ? 'locked' : tension >= 1 ? 'tension' : blocked === 1 ? 'semi-open' : 'open';
  // enemy fianchetto bishop
  const fi = en === 'b' ? [6 * 8 + 6, 6 * 8 + 1] : [1 * 8 + 6, 1 * 8 + 1];
  c.fianchetto = fi.some((s) => g[s] && g[s].t === 'b' && g[s].c === en);
  // weak enemy pawns
  c.weak = [];
  for (const i of theirs) {
    const a = adv(i, en); if (a < 1 || a > 4) continue;
    const f = fileOf(i), adj = theirs.filter((j) => Math.abs(fileOf(j) - f) === 1).map((j) => adv(j, en));
    const kinds = [];
    if (!adj.length) kinds.push('isolated');
    else if (adj.every((x) => x > a) && pawnAttacked(g, i + (en === 'w' ? 8 : -8), me)) kinds.push('backward');
    const same = theirs.filter((j) => fileOf(j) === f);
    if (same.length > 1 && a === Math.min(...same.map((j) => adv(j, en)))) kinds.push('doubled');
    if (kinds.length) c.weak.push({ sq: i, kinds, att: attackerCount(g, i, me), def: attackerCount(g, i, en) });
  }
  c.weak.sort((x, y) => (y.att - y.def) - (x.att - x.def) || y.att - x.att);
  // outposts
  c.outposts = [];
  for (let s = 0; s < 64; s++) {
    const a = adv(s, me); if (a < 3 || a > 5) continue;
    if (g[s] && g[s].t === 'p') continue;          // a square a pawn stands on cannot be an outpost for a knight
    if (!mine.some((p) => attacksFrom(g, p).includes(s))) continue;
    const ea = adv(s, en), f = fileOf(s);
    if (theirs.some((j) => Math.abs(fileOf(j) - f) === 1 && adv(j, en) <= ea - 1)) continue;
    c.outposts.push(s);
  }
  const knights = g.map((p, i) => (p && p.t === 'n' && p.c === me ? i : -1)).filter((i) => i >= 0);
  c.knightOn = knights.filter((k) => c.outposts.includes(k));
  c.routes = [];
  for (const k of knights) {
    if (c.outposts.includes(k)) continue;
    const r = knightRoute(g, k, c.outposts, me, en);
    if (r) c.routes.push(r);
  }
  c.routes.sort((x, y) => x.length - y.length);
  // mobility and bishops
  const mob = (col) => {
    const own = (i) => g[i] && g[i].c === col, ecol = col === 'w' ? 'b' : 'w';
    let n = 0;
    for (let i = 0; i < 64; i++) {
      const p = g[i]; if (!p || p.c !== col || p.t === 'p' || p.t === 'k') continue;
      n += attacksFrom(g, i).filter((s) => !own(s) && !pawnAttacked(g, s, ecol)).length;
    }
    return n;
  };
  c.mobility = mob(me) - mob(en);
  const bishops = (col) => g.filter((p) => p && p.t === 'b' && p.c === col).length;
  c.bishopPair = (bishops(me) >= 2 ? 1 : 0) - (bishops(en) >= 2 ? 1 : 0);
  // rooks and files
  c.openFiles = [];
  for (let f = 0; f < 8; f++) {
    if (mine.some((p) => fileOf(p) === f)) continue;
    c.openFiles.push({ f, full: !theirs.some((p) => fileOf(p) === f) });
  }
  c.rooks = g.map((p, i) => (p && p.t === 'r' && p.c === me ? i : -1)).filter((i) => i >= 0);
  c.rooksOnOpen = c.rooks.filter((r) => c.openFiles.some((o) => o.f === fileOf(r)));
  // breaks: pushes that land next to an enemy pawn
  c.breaks = [];
  for (const p of mine) {
    const d = me === 'w' ? 8 : -8, tos = [];
    if (!g[p + d]) { tos.push(p + d); if (adv(p, me) === 0 && !g[p + 2 * d]) tos.push(p + 2 * d); }
    for (const to of tos) {
      if (rankOf(to) === 0 || rankOf(to) === 7) continue;
      const g2 = g.slice(); g2[to] = g2[p]; g2[p] = null;
      if (!attacksFrom(g2, to).some((s) => g2[s] && g2[s].t === 'p' && g2[s].c === en)) continue;
      c.breaks.push({ from: p, to, file: FILES[fileOf(to)], margin: attackerCount(g2, to, me) - attackerCount(g2, to, en) });
    }
  }
  c.breaks.sort((x, y) => y.margin - x.margin);
  return c;
}

// ---------- the plan menu ----------
const ARROW = '#2f9e6b', ALT = '#e6a100';
const arrow = (a, b, color = ARROW) => ({ from: sqName(a), to: sqName(b), color, opacity: 0.85, width: 0.16 });
const ring = (s, color = ALT) => ({ sq: sqName(s), color });
const KIND = { isolated: 'isolated', backward: 'backward', doubled: 'doubled' };

export function plans(c) {
  const out = [], { me, en } = c;
  const side = me === 'w' ? 'White' : 'Black';
  const add = (p) => out.push(p);

  // 1. weak pawn
  if (c.weak.length) {
    const w = c.weak[0], d = w.att - w.def, kinds = w.kinds.map((k) => KIND[k]).join(' and ');
    const base = `The ${kinds} pawn on ${sqName(w.sq)}: ${w.att} of your pieces and pawns attack it, ${w.def} defend it.`;
    const shapes = { arrows: [], circles: [ring(w.sq)] };
    if (d >= 1) add({ id: 'weak', status: 'good', title: 'Build up on a weak pawn', why: [base, 'Pressure like this scored +2.5 points above expectation in real games. Keep adding attackers: sides that built up by move 20 scored +2.3, those that sat still −0.4.'], shapes });
    else if (d >= -1) add({ id: 'weak', status: 'maybe', title: 'Build up on a weak pawn', why: [base, 'You are not ahead on it yet. Adding one more attacker is the plan; sides that built up scored +2.3 against −0.4 for those that did not.'], shapes });
    else add({ id: 'weak', status: 'avoid', title: 'Build up on a weak pawn', why: [base, 'It is well defended. Positions like this scored no better than ones with no weak pawn at all (−0.5). Look elsewhere.'], shapes });
  } else add({ id: 'weak', status: 'na', title: 'Build up on a weak pawn', why: ['The enemy has no isolated, backward or doubled pawn to aim at right now.'], shapes: null });

  // 2. outposts
  if (c.knightOn.length) {
    add({ id: 'outpost', status: 'good', title: 'Knight on an outpost', why: [`Your knight on ${c.knightOn.map(sqName).join(', ')} already sits on an outpost: guarded by a pawn and safe from enemy pawns. Keep it there; knights on outposts scored +2.3 at move 12.`], shapes: { arrows: [], circles: c.knightOn.map((s) => ring(s, ARROW)) } });
  } else if (c.outposts.length && c.routes.length) {
    const r = c.routes[0], via = r.length === 3 ? ` via ${sqName(r[1])}` : '';
    const arrows = []; for (let i = 0; i + 1 < r.length; i++) arrows.push(arrow(r[i], r[i + 1]));
    add({ id: 'outpost', status: 'good', title: 'Route a knight to an outpost', why: [`${c.outposts.map(sqName).join(', ')} ${c.outposts.length > 1 ? 'are outposts' : 'is an outpost'} for you. Your knight on ${sqName(r[0])} can get to ${sqName(r[r.length - 1])}${via}.`, 'Knights that reached an outpost by move 20 scored +5.2 points better than those that did not, and the engine agrees (+0.55 pawns). An outpost nobody uses is worth nothing.'], shapes: { arrows, circles: c.outposts.map((s) => ring(s)) } });
  } else if (c.outposts.length) {
    add({ id: 'outpost', status: 'maybe', title: 'Outpost without a knight to use it', why: [`${c.outposts.map(sqName).join(', ')} ${c.outposts.length > 1 ? 'are outposts' : 'is an outpost'} for you, but no knight can reach it within two moves.`, 'Only the arrival counts in the data, so regroup a knight towards it first.'], shapes: { arrows: [], circles: c.outposts.map((s) => ring(s)) } });
  } else add({ id: 'outpost', status: 'na', title: 'Knight outpost', why: ['There is no square in the enemy half that your pawns guard and their pawns can never attack.'], shapes: null });

  // 3. rooks
  if (c.rooksOnOpen.length) {
    add({ id: 'rook', status: 'good', title: 'Rook on an open file', why: [`A rook already stands on the ${c.rooksOnOpen.map((r) => FILES[fileOf(r)]).join(', ')}-file. Keep it active.`], shapes: { arrows: [], circles: c.rooksOnOpen.map((s) => ring(s, ARROW)) } });
  } else if (c.openFiles.length && c.rooks.length) {
    const f = c.openFiles.find((o) => o.full) || c.openFiles[0];
    const r = c.rooks[0];
    add({ id: 'rook', status: 'maybe', title: 'Rook to an open file', why: [`The ${FILES[f.f]}-file has no pawn of yours${f.full ? ' or theirs' : ''}, and no rook of yours is on it.`, 'Rooks that reached an open or half-open file by move 20 scored +1.6 better. Having the file but leaving it empty is worth nothing.'], shapes: { arrows: [arrow(r, rankOf(r) * 8 + f.f)], circles: [] } });
  } else add({ id: 'rook', status: 'na', title: 'Rook to an open file', why: ['None of your files is free of your own pawns yet.'], shapes: null });

  // 4. storm
  if (c.target === 'C' || c.myWing === 'C') {
    add({ id: 'storm', status: 'na', title: `Pawn storm against the ${en === 'w' ? 'White' : 'Black'} king`, why: ['One of the kings has not castled, so the storm plan is not defined yet.'], shapes: null });
  } else {
    const race = c.race, tname = WING_NAME[c.target];
    const why = [`Race: your pawns are ${c.progress} square${c.progress === 1 ? '' : 's'} up on the ${tname}${race === null ? '' : `, ${race >= 0 ? '+' : ''}${race} against their advance on your side`}. Centre: ${c.centre}.`];
    let status = 'maybe';
    if (race >= 3 || c.progress >= 4) { status = 'good'; why.push('Ahead in the race or well under way: storms like this scored +2.7 to +2.9 better than the alternatives (engine +0.37 pawns).'); }
    else if (race <= -3) { status = 'avoid'; why.push('You are behind in the race. Storms started from behind scored −4.2 and the engine agrees (−0.53 pawns). Defend or counter on the other wing first.'); }
    else if (c.progress === 0) { status = 'avoid'; why.push('Nothing has moved on that wing yet. Starting a storm from scratch scored −3.6 on average.'); }
    else why.push('On average a storm scores 1.6 points worse than not storming; it pays only once you lead the race.');
    if (c.fianchetto) { why.push('Their fianchetto bishop covers the king: storms cost 2.3 points against it, versus 0.5 without.'); if (status === 'good' && race < 3) status = 'maybe'; }
    why.push(c.centre === 'locked' ? 'The centre is locked, the setting where a wing plan costs least (−1.0 against −2.9 when open).' : c.centre === 'open' ? 'The centre is open, where nearly every wing plan does worse.' : '');
    add({ id: 'storm', status, title: `Pawn storm on the ${tname}`, why: why.filter(Boolean), shapes: null });
  }

  // 5. breaks
  if (c.breaks.length) {
    const top = c.breaks.slice(0, 3);
    const arrows = top.map((b) => arrow(b.from, b.to, ALT));
    const wBreak = me === 'w' && c.breaks.some((b) => 'cde'.includes(b.file));
    if (wBreak) add({ id: 'break', status: 'maybe', title: 'Central or c-file break (White)', why: [`Available: ${top.map((b) => `${FILES[fileOf(b.from)]}${rankOf(b.from) + 1}-${sqName(b.to)}`).join(', ')}.`, 'White\'s c, d and e breaks beat waiting by +1.7 to +2.0 points, and earlier is better. The f and g pushes did worse (−1.6, −2.0).'], shapes: { arrows, circles: [] } });
    else add({ id: 'break', status: 'maybe', title: 'Pawn break: usually wait', why: [`Available: ${top.map((b) => `${FILES[fileOf(b.from)]}${rankOf(b.from) + 1}-${sqName(b.to)}`).join(', ')}.`, 'Playing an available break scored 1.2 points worse than waiting, whether the position was better, equal or worse. Break only with a concrete reason, and better support did not rescue it.'], shapes: { arrows, circles: [] } });
  } else add({ id: 'break', status: 'na', title: 'Pawn break', why: ['No push lands next to an enemy pawn right now.'], shapes: null });

  // 6. bishops and mobility
  if (c.bishopPair === 1) add({ id: 'bishops', status: 'good', title: 'Keep the bishop pair', why: ['You have both bishops and they do not. That was worth +2.3 points; open the position for them.'], shapes: null });
  else if (c.bishopPair === -1) add({ id: 'bishops', status: 'maybe', title: 'Neutralise their bishop pair', why: ['They have both bishops and you do not (−2.3 for you). Trade one of their bishops or keep the position closed.'], shapes: null });
  const mobStatus = c.mobility >= 5 ? 'good' : c.mobility <= -5 ? 'maybe' : 'na';
  if (mobStatus !== 'na') add({ id: 'mobility', status: mobStatus, title: mobStatus === 'good' ? 'Keep your pieces active' : 'Free your pieces', why: [mobStatus === 'good' ? `Your pieces have ${c.mobility} more safe squares than theirs. The most mobile quarter scored +3.5 above the least mobile; keep lines open.` : `Their pieces have ${-c.mobility} more safe squares than yours. Improve your worst-placed piece before anything committal; mobility was the strongest single factor in the data (+1.4 per standard deviation).`], shapes: null });

  // 7. race lost: counterplay
  if (c.race !== null && c.race <= -3) add({ id: 'counter', status: 'good', title: 'Counterplay on the other wing or in the centre', why: ['They lead the race against your king. Respond on the wing where you can start your own play, or in the centre; central play was the plan the engine liked best in the data (+0.38 pawns on average), yet it is rarely tried.'], shapes: null });

  const rank = { good: 0, maybe: 1, avoid: 2, na: 3 };
  out.sort((a, b) => rank[a.status] - rank[b.status]);
  return out;
}

// ---------- the engine's lines, grouped by idea ----------
const VAL = { p: 100, n: 300, b: 300, r: 500, q: 900, k: 0 };
const material = (c, col) => { let s = 0; for (const r of c.board()) for (const p of r) if (p && p.color === col) s += VAL[p.type]; return s; };

function describeLine(fen, pv, me) {
  const c = new Chess(fen), foe = me === 'w' ? 'b' : 'w';
  let fk = null; for (const r of c.board()) for (const p of r) if (p && p.type === 'k' && p.color === foe) fk = p.square;
  const kWing = wingOf(fk.charCodeAt(0) - 97);
  const m0 = material(c, me) - material(c, foe);
  const d = { pawnKW: 0, other: {}, centre: 0, near: 0, caps: 0, pieces: [], sans: [] };
  const n = pv.length % 2 === 0 ? pv.length : Math.max(1, pv.length - 1);
  for (const u of pv.slice(0, Math.min(12, n))) {
    const mv = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    if (!mv) break;
    d.sans.push(mv.san); if (mv.captured) d.caps++;
    if (mv.color !== me) continue;
    if (mv.piece === 'p') {
      const w = wingOf(mv.to.charCodeAt(0) - 97);
      if (w === 'C') d.centre++; else if (w === kWing) d.pawnKW++; else d.other[w] = (d.other[w] || 0) + 1;
    } else if (mv.piece !== 'k') {
      d.pieces.push(mv.piece.toUpperCase() + mv.to);
      if (Math.max(Math.abs(mv.to.charCodeAt(0) - fk.charCodeAt(0)), Math.abs(+mv.to[1] - +fk[1])) <= 2) d.near++;
    }
  }
  d.gain = (material(c, me) - material(c, foe)) - m0;
  return d;
}
function ideaOf(d) {
  if (d.gain >= 100) return 'Win material or a tactic';
  if (d.pawnKW >= 2 || d.near >= 2) return 'Attack the enemy king';
  const o = Object.entries(d.other).sort((a, b) => b[1] - a[1])[0];
  if (o && o[1] >= 2) return `Expand on the ${WING_NAME[o[0]]}`;
  if (d.centre >= 2) return 'Open or strengthen the centre';
  if (d.caps >= 3) return 'Trade pieces and simplify';
  return 'Improve the pieces';
}

// ---------- the page ----------
let board = null, ready = false, current = null, structures = [], runId = 0;
const BADGE = { good: 'Worth doing', maybe: 'Possible', avoid: 'Not now', na: 'Not available' };

function showShapes(p) {
  board.setShapes(p && p.shapes ? { arrows: p.shapes.arrows || [], circles: p.shapes.circles || [] } : { arrows: [], circles: [] });
}

function renderMenu(list) {
  $('adMenu').innerHTML = list.map((p, i) => `<div class="ad-plan ${p.status}" data-i="${i}">
    <div class="ad-top"><b>${esc(p.title)}</b><span class="ad-badge ${p.status}">${BADGE[p.status]}</span></div>
    ${p.why.map((w) => `<p>${esc(w)}</p>`).join('')}</div>`).join('');
}

function drawBoard(fen, me) {
  const pieces = {}; new Chess(fen).board().forEach((row) => row.forEach((p) => { if (p) pieces[p.square] = p.color + p.type.toUpperCase(); }));
  board.set({ pieces, orientation: me, lastMove: null });
}

async function analysePosition(fen, me) {
  const id = ++runId;
  let c;
  try { new Chess(fen); } catch (e) { $('adStatus').textContent = 'That position is not valid.'; return; }
  const parts = fen.split(' ');
  if (parts[1] !== me) { parts[1] = me; parts[3] = '-'; }
  fen = parts.join(' ');
  try { c = conditions(fen, me); } catch (e) { $('adStatus').textContent = 'Could not read that position.'; return; }
  current = { fen, me, list: plans(c) };
  drawBoard(fen, me);
  renderMenu(current.list);
  showShapes(current.list.find((p) => p.shapes && p.status !== 'na'));
  $('adStatus').textContent = 'Tap a plan to see it on the board.';
  $('adIdeas').innerHTML = '<p class="muted small">The engine is looking at the six best moves ...</p>';
  const res = await analyse(fen, 16, 6, 1);
  if (id !== runId) return;
  const sign = me === 'w' ? 1 : -1, groups = new Map();
  for (const l of res.lines) {
    if (!l || !l.pv.length) continue;
    const d = describeLine(fen, l.pv, me), name = ideaOf(d);
    const g = groups.get(name) || []; g.push({ first: d.sans[0], cp: sign * l.cp, sans: d.sans.slice(0, 8).join(' ') }); groups.set(name, g);
  }
  const fmt = (cp) => `${cp >= 0 ? '+' : '−'}${Math.abs(cp / 100).toFixed(2)}`;
  $('adIdeas').innerHTML = [...groups.entries()].map(([name, ls]) => `<div class="ad-idea"><b>${esc(name)}</b> <span class="muted small">${ls.length} of ${res.lines.filter(Boolean).length} best lines</span>
    ${ls.map((l) => `<div class="small"><b>${esc(l.first)}</b> <span class="muted">${fmt(l.cp)}</span> <span class="muted">${esc(l.sans)}</span></div>`).join('')}</div>`).join('');
}

export async function showAdvisor() {
  if (!ready) {
    ready = true;
    board = new Board($('adBoard'), { getTargets: () => [], onMove: () => {} });
    board.setEnabled(false);
    try { structures = (await fetch('data/plans/kid.json').then((r) => r.json())).structures; } catch (e) { structures = []; }
    $('adPos').innerHTML = structures.map((s, i) => `<option value="${i}">${esc(s.title)}</option>`).join('') + '<option value="fen">Paste a FEN</option>';
    const run = () => {
      const v = $('adPos').value;
      $('adFenRow').hidden = v !== 'fen';
      const fen = v === 'fen' ? $('adFen').value.trim() : (structures[+v] || {}).fen;
      if (fen) analysePosition(fen, $('adMe').value);
    };
    $('adPos').onchange = run; $('adMe').onchange = run; $('adGo').onclick = run;
    $('adMenu').addEventListener('click', (e) => { const el = e.target.closest('.ad-plan'); if (el && current) { document.querySelectorAll('.ad-plan').forEach((n) => n.classList.toggle('on', n === el)); showShapes(current.list[+el.dataset.i]); } });
    run();
  }
}
