// Everything the trainer remembers about the user lives here (localStorage, one JSON blob).
// The big explorer cache lives separately in IndexedDB (see explorer.js).

const KEY = 'chessTrainer.v1';

export const DEFAULT_SETTINGS = {
  ratingMin: 1600,           // bracket is [ratingMin, ratingMax)
  ratingMax: 2000,
  botDelayMs: 180,
  sound: true,
  pieces: 'cburnett',        // Cburnett pieces, used under their BSD licence option (see pieces/cburnett/LICENSE.txt)
  boardTheme: 'green',
  animations: true,          // piece slides, panel fades
  knightArrows: 'L',         // 'L' = two along, one across; 'straight' = a direct line
  liveEval: false,           // show the eval bar and number while playing (no suggested moves)
  showEval: true,            // engine lines, eval column, eval bar and engine arrows
  // Mistake rule: weighted mix of three signals, each scored 0..1.
  weightEval: 0.5,
  weightRare: 0.2,
  weightScore: 0.3,
  mistakeThreshold: 0.4,     // weighted total at or above this is a mistake
  evalLowCp: 25,             // eval loss at or below this scores 0
  evalHighCp: 100,           // eval loss at or above this scores 1
  blunderCp: 200,            // eval loss at or above this is always a mistake (unless it passes in practice, below)
  earlyMoves: 3,             // moves up to this number are judged leniently...
  earlyLossCp: 150,          // ...and only flagged if the engine says they lose at least this much
  // Practical exception, for gambits: a move passes if people play it and score nearly as well with it.
  practicalMinShare: 2,      // % of games (a quarter of this for named openings like the King's Gambit)
  practicalMinGames: 100,
  practicalSlackPp: 3,       // may score up to this many points below the best common move (+1 for named openings)
  practicalMaxLossCp: 300,   // engine losses this big are still mistakes, however well they score
  rareLowPct: 0.5,           // played in <= this % of games scores 1
  rareHighPct: 5,            // played in >= this % of games scores 0
  scoreLowPp: 2,             // score deficit (percentage points) at or below this scores 0
  scoreHighPp: 8,            // ... at or above this scores 1
  engineDepth: 14,           // 14 keeps replies snappy and is plenty for opening-level mistakes
  minGamesForData: 15,       // below this a position counts as "database ran out"
  botSharpness: 0.85,        // 1 = the opponent plays moves exactly as often as real players do; lower = a little more variety
  varietyStrength: 0.3,
  varietyHalfLifeDays: 7,
  weakBoost: 1.5,
};

let state = null;
let timer = null;

function fresh() {
  return {
    settings: { ...DEFAULT_SETTINGS },
    pos: {},        // fenKey -> {n, bad, h, last}   decisions made by the user at that position
    weak: {},       // path "uci uci ..." -> {n, ok, last, fen, san}  lines leading to a mistake
    tree: { c: {} },// every line met so far: {s: san, c: {uci: node}}
    variety: {},    // "fenKey|uci" -> {c, t}   how often the bot showed a branch (decays)
    log: [],        // judged moves with their raw signals, for tuning: {t, fen, san, line, raw, label}
    history: [],    // finished lines
    prefs: {},      // last-used setup choices
  };
}

export function load() {
  state = fresh();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw) {
      state = { ...state, ...raw, settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) } };
    }
  } catch (e) { /* corrupt or unavailable storage: start fresh */ }
  if (state.settings.botDelayMs === 450 || state.settings.botDelayMs === 250) state.settings.botDelayMs = 180;   // older defaults; shorter feels better
  if (state.settings.engineDepth === 16) state.settings.engineDepth = 14;   // the previous default
  if (state.settings.varietyStrength === 0.6) state.settings.varietyStrength = 0.3;   // the previous default
  // The live Lichess explorer is gone: remove any token saved by an older version, and its cache.
  for (const k of ['token', 'explorerBase', 'dataSource', 'speeds']) delete state.settings[k];
  try { indexedDB.deleteDatabase('chess-trainer'); } catch (e) { /* ignore */ }
  return state;
}

export const S = () => state || load();
export const settings = () => S().settings;

export function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* quota or private mode */ }
  }, 250);
}

export function resetProgress() {
  const s = S();
  s.pos = {}; s.weak = {}; s.tree = { c: {} }; s.variety = {}; s.history = []; s.log = []; s.accepted = {};
  save();
}

export function exportJson() { return JSON.stringify(S(), null, 1); }

export function importJson(text) {
  const raw = JSON.parse(text);
  state = { ...fresh(), ...raw, settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) } };
  save();
}

// ---- progress helpers ----

export const fenKey = (fen) => fen.split(' ').slice(0, 4).join(' ');

export function addToTree(ucis, sans) {
  let node = S().tree;
  ucis.forEach((u, i) => {
    node.c = node.c || {};
    node.c[u] = node.c[u] || { s: sans[i], c: {} };
    node = node.c[u];
  });
}

export function recordDecision(fen, pathUcis, sans, good, uci, side) {
  const s = S();
  const k = fenKey(fen);
  const p = s.pos[k] || (s.pos[k] = { n: 0, bad: 0, h: '', last: 0 });
  p.n++; if (!good) p.bad++;
  p.h = (p.h + (good ? 'o' : 'x')).slice(-6);
  p.last = Date.now();
  const wk = pathUcis.join(' ');
  const w = s.weak[wk];
  if (!good) {
    if (w) { w.n++; w.last = Date.now(); w.bad = [...new Set([...(w.bad || []), uci])]; }
    else s.weak[wk] = { n: 1, ok: 0, last: Date.now(), fen, san: sans.join(' '), bad: [uci], side };
  } else if (w) { w.ok++; w.last = Date.now(); }
  save();
}

// Moves the user has said are fine in a given position: never flagged again there.
export const isAccepted = (fen, san) => ((S().accepted || {})[fenKey(fen)] || []).includes(san);

/** Accept a flagged move: remember it and undo the mistake it just recorded. */
export function acceptMove(fen, pathUcis, uci, san, wasRecorded = true) {
  const s = S();
  s.accepted = s.accepted || {};
  const k = fenKey(fen);
  s.accepted[k] = [...new Set([...(s.accepted[k] || []), san])];
  if (!wasRecorded) { save(); return; }
  const p = s.pos[k];
  if (p) { p.bad = Math.max(0, p.bad - 1); if (p.h.endsWith('x')) p.h = p.h.slice(0, -1) + 'o'; }
  const wk = pathUcis.join(' ');
  const w = s.weak[wk];
  if (w) {
    w.n--; w.bad = (w.bad || []).filter((u) => u !== uci);
    if (w.n <= 0) delete s.weak[wk];
  }
  save();
}

export function logMove(entry) {
  const s = S();
  s.log = s.log || [];
  s.log.push({ ...entry, label: null });
  if (s.log.length > 300) s.log.splice(0, s.log.length - 300);
  save();
}

export function setLabel(t, label) {
  const e = (S().log || []).find((x) => x.t === t);
  if (e) { e.label = e.label === label ? null : label; save(); }
}

export const weakWeight = (w) => Math.max(0, w.n - 0.5 * w.ok);

export function noteShown(fen, uci) {
  const s = S();
  const k = fenKey(fen) + '|' + uci;
  const now = Date.now();
  s.variety[k] = { c: shownCount(fen, uci) + 1, t: now };
}

export function shownCount(fen, uci) {
  const s = S();
  const e = s.variety[fenKey(fen) + '|' + uci];
  if (!e) return 0;
  const days = (Date.now() - e.t) / 86400000;
  return e.c * Math.pow(0.5, days / s.settings.varietyHalfLifeDays);
}

// "ooox" style history -> solid / shaky / weak / unmet
export function status(fen) {
  const p = S().pos[fenKey(fen)];
  if (!p || !p.n) return 'unmet';
  const last2 = p.h.slice(-2);
  if (last2.includes('x') && p.h.slice(-1) === 'x') return 'weak';
  if (p.h.includes('x') && p.h.slice(-3).includes('x')) return 'shaky';
  if (p.n >= 3 && !p.h.slice(-4).includes('x')) return 'solid';
  return 'shaky';
}
