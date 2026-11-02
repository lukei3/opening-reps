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
  const { ratingMin, ratingMax } = settings();
  const use = meta.buckets.map((b, i) => (b >= ratingMin && b < ratingMax ? i : -1)).filter((i) => i >= 0);
  const useAll = use.length ? use : meta.buckets.map((_, i) => i);
  const moves = [];
  for (const row of rows) {
    let w = 0, d = 0, b = 0;
    for (const i of useAll) { w += row[1 + i * 3]; d += row[2 + i * 3]; b += row[3 + i * 3]; }
    const games = w + d + b;
    if (games > 0) moves.push({ san: row[0], uci: null, w, d, b, games, avg: 0 });
  }
  moves.sort((x, y) => y.games - x.games);
  const w = moves.reduce((a, m) => a + m.w, 0), d = moves.reduce((a, m) => a + m.d, 0), b = moves.reduce((a, m) => a + m.b, 0);
  const movesTotal = w + d + b;
  return { w, d, b, total: movesTotal, movesTotal, moves, fromBook: true };
}
