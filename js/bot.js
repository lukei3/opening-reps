// The opponent. Picks from real game data in proportion to how often people actually play each move, then nudged by:
//  - sharpness : moves above 2% of games are very slightly compressed (exponent below 1) so the other relevant
//                moves turn up a little more often than their raw share; the tail below 2% stays at its true rate
//  - variety   : a light fade on branches you have just seen, so you meet the rest of the tree over time
//  - weak spots: branches leading to lines where the user has made mistakes are served more often
import { S, shownCount, weakWeight } from './store.js';

/**
 * @param {object} a
 *  a.data      explorer data
 *  a.fen       current position
 *  a.side      the bot's colour
 *  a.path      UCI moves played so far
 *  a.sans      SAN moves played so far
 *  a.restrict  optional (sans, candidateSan) => bool
 *  a.toUci     (san) => uci for this position
 *  a.rng       random function (injectable for tests)
 */
export function chooseBotMove({ data, fen, side, path, sans, restrict, toUci, rng = Math.random }) {
  const s = S().settings;
  if (!data || !data.moves.length || data.movesTotal < 2) return null;
  const weak = Object.entries(S().weak).map(([p, w]) => ({ p, u: weakWeight(w) })).filter((x) => x.u > 0);

  let cands = data.moves.filter((m) => m.games >= 2 && (100 * m.games) / data.movesTotal >= 0.15);
  if (restrict) {
    const r = cands.filter((m) => restrict(sans, m.san));
    if (r.length) cands = r;
  }
  if (!cands.length) return null;

  const scored = cands.map((m) => {
    const uci = toUci(m.san);
    const share = (100 * m.games) / data.movesTotal;
    const seen = shownCount(fen, uci);
    const variety = Math.max(0.4, 1 / (1 + seen * s.varietyStrength));
    // Real frequency, gently compressed above 2% (80% -> about 74%, 10% -> about 13%, with sharpness 0.85).
    const base = share >= 2 ? 2 * Math.pow(share / 2, s.botSharpness) : share;
    const prefix = path.concat(uci).join(' ');
    let u = 0;
    for (const w of weak) if (w.p === prefix || w.p.startsWith(prefix + ' ')) u += w.u;
    const weakBoost = 1 + s.weakBoost * Math.min(4, u);
    return { m, uci, weight: base * variety * weakBoost, share, variety, weakBoost };
  });

  const total = scored.reduce((a, x) => a + x.weight, 0);
  let r = rng() * total;
  let pick = scored[scored.length - 1];
  for (const x of scored) { r -= x.weight; if (r <= 0) { pick = x; break; } }
  return { san: pick.m.san, uci: pick.uci, candidates: scored };
}
