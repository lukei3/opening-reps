// Opening data for a position, from the local book built from the Lichess open database (see tools/build_book.py).
import { getBookPosition } from './book.js';

export class ExplorerError extends Error {
  constructor(type, msg) { super(msg); this.type = type; }
}

/** Score for `side` ('w'|'b') of a move or position row, 0..1 (a draw counts half). */
export function scoreFor(row, side) {
  const g = row.games ?? row.total;
  if (!g) return 0.5;
  return ((side === 'w' ? row.w : row.b) + row.d / 2) / g;
}

/** Games from this position: {w, d, b, total, movesTotal, moves:[{san, w, d, b, games}]}. */
export async function getPosition(fen) {
  const data = await getBookPosition(fen);
  if (data) return data;
  throw new ExplorerError('nobook', 'The opening book is missing (book/meta.json). Rebuild it with tools/build_book.py.');
}
