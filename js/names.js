// Opening names and ECO codes, from the Lichess chess-openings dataset (CC0). Keyed by position, so a name is found
// however the position was reached; a position with no name of its own shows the most recent named one before it.
let dbPromise = null;

export function openingsDb() {
  if (!dbPromise) dbPromise = fetch('data/openings.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return dbPromise;
}

export const posKey = (fen) => fen.split(' ').slice(0, 4).join(' ');

/** Deepest named position among the given FENs (start position first). Returns {eco, name, index} or null. */
export function nameFromFens(db, fens) {
  for (let i = fens.length - 1; i >= 0; i--) {
    const hit = db[posKey(fens[i])];
    if (hit) return { eco: hit[0], name: hit[1], index: i };
  }
  return null;
}
