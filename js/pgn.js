// PGN with variations and comments -> study chapters. Used for the built-in studies and for Lichess study imports.
import { Chess } from '../lib/chess.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Split a file into games and read each one's headers and move text. */
function splitGames(text) {
  const games = [];
  let cur = null;
  for (const line of text.replace(/\r/g, '').split('\n')) {
    if (line.startsWith('[')) {
      if (!cur || cur.body.trim()) { cur = { headers: {}, body: '' }; games.push(cur); }
      const m = /^\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]/.exec(line);
      if (m) cur.headers[m[1]] = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    } else if (cur) {
      cur.body += line + '\n';
    } else if (line.trim()) {
      cur = { headers: {}, body: line + '\n' };
      games.push(cur);
    }
  }
  return games.filter((g) => g.body.trim() || Object.keys(g.headers).length);
}

const RESULT = /^(1-0|0-1|1\/2-1\/2|\*)$/;

/** Walk the move text and build a tree of {san, uci, fen, comment, children}. */
function buildTree(body, startFen, warn) {
  const root = { san: null, uci: null, fen: startFen, comment: '', children: [] };
  let cur = root;           // the position moves are added to
  let before = null;        // the position before the last move (where a variation branches from)
  const stack = [];
  let i = 0;
  const n = body.length;
  while (i < n) {
    const c = body[i];
    if (c === '{') {                                  // comment, attached to the last move
      const end = body.indexOf('}', i);
      const text = body.slice(i + 1, end < 0 ? n : end).replace(/\[%[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
      if (text) cur.comment = cur.comment ? `${cur.comment} ${text}` : text;
      i = end < 0 ? n : end + 1;
    } else if (c === ';') {
      const end = body.indexOf('\n', i); i = end < 0 ? n : end + 1;
    } else if (c === '(') {
      if (!before) { warn('A variation came before any move; skipped.'); i += 1; stack.push(null); continue; }
      stack.push({ cur, before });
      cur = before; before = null;
      i += 1;
    } else if (c === ')') {
      const s = stack.pop();
      if (s) { cur = s.cur; before = s.before; }
      i += 1;
    } else if (/\s/.test(c)) {
      i += 1;
    } else {
      let j = i;
      while (j < n && !/[\s(){};]/.test(body[j])) j += 1;
      let tok = body.slice(i, j);
      i = j;
      if (tok[0] === '$' || RESULT.test(tok)) continue;       // NAGs and results
      tok = tok.replace(/^\d+\.+/, '');                          // "12.e4" or "12...e5"
      if (!tok || /^\.+$/.test(tok)) continue;
      tok = tok.replace(/[!?]+$/, '');
      if (!tok) continue;
      let g, mv;
      try { g = new Chess(cur.fen); mv = g.move(tok); } catch (e) { mv = null; }
      if (!mv) { warn(`Illegal or unreadable move "${tok}" after ${describe(root, cur)}; the rest of that line was skipped.`); skipLine(); continue; }
      let child = cur.children.find((k) => k.san === mv.san);
      if (!child) {
        child = { san: mv.san, uci: mv.from + mv.to + (mv.promotion || ''), fen: g.fen(), comment: '', children: [] };
        cur.children.push(child);
      }
      before = cur; cur = child;
    }
  }
  return root;

  // after a bad move, ignore everything up to the end of the current variation
  function skipLine() {
    let depth = 0;
    while (i < n) {
      const ch = body[i];
      if (ch === '{') { const e = body.indexOf('}', i); i = e < 0 ? n : e + 1; continue; }
      if (ch === '(') depth += 1;
      if (ch === ')') { if (depth === 0) return; depth -= 1; }
      i += 1;
    }
  }
}

function describe(root, node) {
  const sans = [];
  const find = (n, trail) => {
    if (n === node) { sans.push(...trail); return true; }
    return n.children.some((k) => find(k, [...trail, k.san]));
  };
  find(root, []);
  return sans.length ? sans.slice(-4).join(' ') : 'the start';
}

export function countLines(node) {
  return node.children.length ? node.children.reduce((a, k) => a + countLines(k), 0) : 1;
}

/**
 * Parse PGN text into chapters: { name, orientation: 'w'|'b', root, lines }.
 * Also returns the study's name and any warnings about moves that could not be read.
 */
export function parseStudy(text) {
  const warnings = [];
  const chapters = [];
  let studyName = '';
  for (const g of splitGames(text)) {
    const h = g.headers;
    const event = h.Event || '';
    const name = h.ChapterName || (event.includes(': ') ? event.split(': ').slice(1).join(': ') : event) || `Chapter ${chapters.length + 1}`;
    if (!studyName) studyName = h.StudyName || (event.includes(': ') ? event.split(': ')[0] : event);
    if (h.Variant && h.Variant !== 'Standard') { warnings.push(`"${name}" is a ${h.Variant} chapter; skipped.`); continue; }
    const fen = h.FEN && h.SetUp !== '0' ? h.FEN : START_FEN;
    try { new Chess(fen); } catch (e) { warnings.push(`"${name}" starts from an invalid position; skipped.`); continue; }
    const root = buildTree(g.body, fen, (w) => warnings.push(`${name}: ${w}`));
    if (!root.children.length) { warnings.push(`"${name}" has no moves; skipped.`); continue; }
    const orientation = (h.Orientation || '').toLowerCase() === 'black' ? 'b' : 'w';
    chapters.push({ name, orientation, root, lines: countLines(root) });
  }
  return { name: studyName, chapters, warnings };
}
