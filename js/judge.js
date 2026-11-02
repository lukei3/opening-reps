// Decides whether the user's move was a real mistake, by mixing three signals:
//   rare  : the move is rarely played at this rating level
//   eval  : Stockfish says the position got noticeably worse for the user
//   score : the move scores worse for the user than the common alternatives
// Every threshold and weight lives in settings so it can be tuned by testing.
import { scoreFor } from './data.js';

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const ramp = (x, lo, hi) => clamp01((x - lo) / (hi - lo));
const cp = (v) => Math.max(-1000, Math.min(1000, v));

/** Collect the raw numbers behind a verdict. Kept so old moves can be re-scored when settings change. */
export function rawSignals({ data, san, uci, side, before, after, moveNo, s }) {
  const sign = side === 'w' ? 1 : -1;
  const raw = { loss: null, share: null, games: 0, mine: null, ref: null, opening: null, moveNo: moveNo || null };
  if (before && after) {
    raw.loss = sign * (cp(before.cp) - cp(after.cp));
    if (before.best && before.best === uci) raw.loss = Math.min(raw.loss, 0); // the engine's own choice is never "bad"
  }
  if (data && data.movesTotal >= s.minGamesForData) {
    const row = data.moves.find((m) => m.san === san);
    raw.games = row ? row.games : 0;
    raw.share = (100 * raw.games) / data.movesTotal;
    const common = data.moves.filter((m) => (100 * m.games) / data.movesTotal >= s.rareHighPct && m.games >= 20);
    if (common.length) raw.ref = Math.max(...common.map((m) => scoreFor(m, side)));
    if (row && row.games >= 30 && raw.ref !== null) raw.mine = scoreFor(row, side); // small samples are too noisy
    if (row && row.opening) raw.opening = row.opening;
  }
  return raw;
}

/** Turn raw signals into a verdict using the current settings. */
export function verdictFromRaw(raw, s) {
  const reasons = [];
  const evalPts = raw.loss === null ? 0 : ramp(raw.loss, s.evalLowCp, s.evalHighCp);
  const rarePts = raw.share === null ? 0 : 1 - ramp(raw.share, s.rareLowPct, s.rareHighPct);
  const scorePts = raw.mine === null ? 0 : ramp(100 * (raw.ref - raw.mine), s.scoreLowPp, s.scoreHighPp);
  const parts = { eval: { loss: raw.loss, pts: evalPts }, rare: { share: raw.share, games: raw.games, pts: rarePts },
    score: { mine: raw.mine, ref: raw.ref, pts: scorePts } };
  const total = s.weightEval * evalPts + s.weightRare * rarePts + s.weightScore * scorePts;
  const blunder = raw.loss !== null && raw.loss >= s.blunderCp;
  let flagged = blunder || total >= s.mistakeThreshold;

  // Early moves are mostly a matter of taste (1.f3, 2.Qh5 and friends): only stop for ones that really lose material.
  const early = raw.moveNo !== null && raw.moveNo <= s.earlyMoves;
  let earlyPass = false;
  if (early && flagged) {
    flagged = raw.loss !== null && raw.loss >= s.earlyLossCp;
    earlyPass = !flagged;
  }

  // Practical exception: gambits and other lines the engine frowns on still pass if real players at this
  // level play them and score about as well as with the best common move. Named openings need less popularity.
  // Only a really large engine loss overrides this.
  const named = !!raw.opening;
  const minShare = named ? s.practicalMinShare / 4 : s.practicalMinShare;
  const slack = (named ? s.practicalSlackPp + 1 : s.practicalSlackPp) / 100;
  const practical = raw.mine !== null && raw.share !== null && raw.games >= s.practicalMinGames
    && raw.share >= minShare && raw.ref - raw.mine <= slack
    && (raw.loss === null || raw.loss < s.practicalMaxLossCp);
  const mistake = flagged && !practical;
  const savedByPractice = flagged && practical;

  if (raw.loss !== null && raw.loss >= s.evalLowCp) reasons.push(`Engine: your position got worse by ${(raw.loss / 100).toFixed(1)} pawns.`);
  if (raw.share !== null && raw.share < s.rareHighPct) {
    reasons.push(raw.games === 0 ? 'Not played in any games at this rating.' : `Rarely played: ${raw.share.toFixed(1)}% of games.`);
  }
  if (raw.mine !== null && raw.ref - raw.mine > s.scoreLowPp / 100) {
    reasons.push(`Scores ${(raw.mine * 100).toFixed(0)}% for you, against ${(raw.ref * 100).toFixed(0)}% for the best common move.`);
  }
  if (!reasons.length) reasons.push('Combination of small drawbacks.');
  return { mistake, total, blunder, parts, reasons, savedByPractice, earlyPass, opening: raw.opening };
}

export function judge(a) {
  const raw = rawSignals(a);
  return { ...verdictFromRaw(raw, a.s), raw };
}

/** Moves worth showing on the mistake screen: sensible frequency, results not far below the best. */
export function goodMoves(data, side, s, bestUci, toUci) {
  if (!data || !data.moves.length) return [];
  const common = data.moves.filter((m) => (100 * m.games) / data.movesTotal >= s.rareHighPct && m.games >= 20);
  const ref = common.length ? Math.max(...common.map((m) => scoreFor(m, side))) : null;
  return data.moves
    .map((m) => ({
      ...m,
      share: (100 * m.games) / data.movesTotal,
      score: scoreFor(m, side),
      engineBest: !!bestUci && toUci(m.san) === bestUci,
    }))
    .filter((m) => m.share >= 2 || m.engineBest)
    .filter((m) => ref === null || m.games < 10 || ref - m.score <= s.scoreHighPp / 100 || m.engineBest)
    .sort((a, b) => b.games - a.games)
    .slice(0, 6);
}
