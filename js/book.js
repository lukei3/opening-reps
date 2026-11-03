// Local opening book built from the Lichess open database (see tools/build_book.py).
// Works with no account and no connection.
import { settings } from './store.js';

let metaP = null;
const shards = new Map();

export function bookMeta() {
  if (!metaP) {
    metaP = fetch('book/meta.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  }
  return metaP;
}

function shardOf(key, n) {
  let h = 5381;
  for (const ch of new TextEncoder().encode(key)) h = (Math.imul(h, 33) ^ ch) >>> 0;
  return h % n;
}

async function loadShard(i) {
  if (!shards.has(i)) {
    const name = `book/s${String(i).padStart(2, '0')}.json`;
    shards.set(i, fetch(name).then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
  }
  return shards.get(i);
}

/** Position data from the book for the current rating bracket, or null if the book is missing. */
export async function getBookPosition(fen) {
  const meta = await bookMeta();
  if (!meta) return null;
  const key = fen.split(' ').slice(0, 4).join(' ');
  const shard = await loadShard(shardOf(key, meta.shards));
  const rows = shard[key] || [];
  const { ratings, speeds } = settings();
  const useGroup = meta.buckets.map((b) => !ratings.length || ratings.includes(b));
  const moves = [];
  if (meta.layout === 'sparse') {
    // rows are [san, cell, count, cell, count, ...]; cell = speed * (groups * 3) + group * 3 + result
    const perSpeed = meta.buckets.length * 3;
    const useSpeed = meta.speeds.map((s) => !speeds.length || speeds.includes(s));
    for (const row of rows) {
      const t = [0, 0, 0];
      for (let k = 1; k < row.length; k += 2) {
        const cell = row[k], within = cell % perSpeed;
        if (useSpeed[(cell / perSpeed) | 0] && useGroup[(within / 3) | 0]) t[within % 3] += row[k + 1];
      }
      const games = t[0] + t[1] + t[2];
      if (games > 0) moves.push({ san: row[0], uci: null, w: t[0], d: t[1], b: t[2], games, avg: 0 });
    }
  } else {
    // older dense books: [san, w, d, b] for each rating group in turn, one time-control mix
    for (const row of rows) {
      let w = 0, d = 0, b = 0;
      useGroup.forEach((on, i) => { if (on) { w += row[1 + i * 3]; d += row[2 + i * 3]; b += row[3 + i * 3]; } });
      const games = w + d + b;
      if (games > 0) moves.push({ san: row[0], uci: null, w, d, b, games, avg: 0 });
    }
  }
  moves.sort((x, y) => y.games - x.games);
  const w = moves.reduce((a, m) => a + m.w, 0), d = moves.reduce((a, m) => a + m.d, 0), b = moves.reduce((a, m) => a + m.b, 0);
  const movesTotal = w + d + b;
  return { w, d, b, total: movesTotal, movesTotal, moves, fromBook: true };
}
