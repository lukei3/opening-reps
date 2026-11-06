"""Plans lab: do weak pawns (targets) make a plan, and what makes it work?

At move 12, for each side, finds the enemy's weak pawns (isolated, backward, doubled) and measures how many pieces attack and
defend the best target, whether the file is half-open for the attacker, and then looks at what happened:
  * the net pawns won by move 25 (enemy pawns lost minus own pawns lost),
  * the result against rating expectation,
  * the engine's evaluation change (where engine data exists),
  * "build-up": did the attackers on the target grow by move 20?

    python tools/plans/targets.py games-*.jsonl.gz --evals evals-*.jsonl --out lab/plans/out/kid-targets.md
"""
import argparse
import concurrent.futures as cf
import gzip
import json
import math
import os
import sys

import chess

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from features import advance  # noqa: E402
from plan_stats import expected_white, score_white  # noqa: E402


def weak_pawns(board, me):
    en = not me
    pawns = list(board.pieces(chess.PAWN, en))
    by_file = {}
    for sq in pawns:
        by_file.setdefault(chess.square_file(sq), []).append(sq)
    out = []
    for sq in pawns:
        f = chess.square_file(sq)
        adv = advance(sq, en)
        if adv < 1 or adv > 4:
            continue
        adj = [advance(p, en) for g in (f - 1, f + 1) for p in by_file.get(g, [])]
        kinds = []
        if not adj:
            kinds.append('isolated')
        else:
            stop = sq + (8 if en == chess.WHITE else -8)
            if all(a > adv for a in adj) and board.is_attacked_by(me, stop):
                kinds.append('backward')
        same = by_file[f]
        if len(same) > 1 and adv == min(advance(p, en) for p in same):
            kinds.append('doubled')
        if kinds:
            out.append({'sq': sq, 'kinds': kinds, 'att': len(board.attackers(me, sq)), 'def': len(board.attackers(en, sq)),
                        'half_open': not any(chess.square_file(p) == f for p in board.pieces(chess.PAWN, me))})
    return out


def process(line):
    g = json.loads(line)
    if g['plies'] < 50:
        return []
    board = chess.Board()
    snaps = {}
    try:
        for ply, san in enumerate(g['moves'].split()[:50]):
            board.push_san(san)
            if ply in (23, 39, 49):
                snaps[ply] = board.copy()
    except ValueError:
        return []
    b12, b20, b25 = snaps.get(23), snaps.get(39), snaps.get(49)
    if not (b12 and b20 and b25):
        return []
    s = score_white(g['res']); e = expected_white(g['w'], g['b'])
    rows = []
    for color in (chess.WHITE, chess.BLACK):
        me, en = ('w', 'b') if color == chess.WHITE else ('b', 'w')
        sc, ex = (s, e) if color == chess.WHITE else (1 - s, 1 - e)
        weak = weak_pawns(b12, color)
        best = max(weak, key=lambda w: (w['att'] - w['def'], w['att'])) if weak else None
        row = {'id': g['id'], 'side': me, 'adj': sc - ex,
               'gain': (len(b12.pieces(chess.PAWN, not color)) - len(b25.pieces(chess.PAWN, not color))) - (len(b12.pieces(chess.PAWN, color)) - len(b25.pieces(chess.PAWN, color))),
               'n_weak': len(weak), 'kinds': sorted({k for w in weak for k in w['kinds']}), 'best': None}
        if best:
            sq = best['sq']
            still = b20.piece_at(sq) == chess.Piece(chess.PAWN, not color)
            row['best'] = {'att': best['att'], 'def': best['def'], 'half_open': best['half_open'], 'kinds': best['kinds'],
                           'gone20': not still, 'built': (len(b20.attackers(color, sq)) - best['att']) if still else None}
        rows.append(row)
    return rows


class Acc:
    def __init__(self):
        self.n = 0; self.s = 0.0; self.ss = 0.0

    def add(self, x):
        self.n += 1; self.s += x; self.ss += x * x

    def mean(self):
        return self.s / self.n if self.n else 0.0

    def vm(self):
        if self.n < 2:
            return 1.0
        m = self.mean()
        return max(0.0, self.ss / self.n - m * m) / self.n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('games', nargs='+')
    ap.add_argument('--evals', nargs='*', default=[])
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    ev = {}
    for p in a.evals:
        for line in open(p, encoding='utf-8'):
            r = json.loads(line)
            if 'e12' in r and 'e25' in r:
                ev[r['id']] = r['e25'] - r['e12']
    rows = []
    def lines():
        for p in a.games:
            for line in gzip.open(p, 'rt', encoding='utf-8'):
                yield line
    with cf.ProcessPoolExecutor(max(1, (os.cpu_count() or 2) - 1)) as pool:
        for r in pool.map(process, lines(), chunksize=300):
            rows.extend(r)
    N = len(rows)
    print(f'{N:,} side-positions')

    def stats(sel):
        res, win, lose, eng = Acc(), Acc(), Acc(), Acc()
        for r in rows:
            if sel(r):
                res.add(r['adj']); win.add(1.0 if r['gain'] >= 1 else 0.0); lose.add(1.0 if r['gain'] <= -1 else 0.0)
                if r['id'] in ev:
                    eng.add(ev[r['id']] * (1 if r['side'] == 'w' else -1) / 100)
        return res, win, lose, eng

    base = stats(lambda r: r['n_weak'] == 0)
    md = ["# Weak pawns as targets (King's Indian)\n",
          f'{N:,} side-positions (every game that reaches move 25, both sides). A "target" is an enemy pawn at move 12 that is isolated, backward (cannot advance because a pawn controls the square ahead) or the rear pawn of a doubled pair.\n',
          'Columns: **Result** = score against what the rating gap predicts, in points (95% margin). **vs none** = difference from positions where the enemy has no weak pawn. **Wins a pawn** = the side won more pawns than it lost between move 12 and 25. **Loses a pawn** = the reverse. **Engine** = Stockfish evaluation change, in pawns.\n',
          '| Group | Positions | Result | vs none | Wins a pawn | Loses a pawn | Engine |', '|---|---|---|---|---|---|---|']

    def row(label, st, show_diff=True, min_n=300):
        res, win, lose, eng = st
        if res.n < min_n:
            return
        diff = f'{100 * (res.mean() - base[0].mean()):+.1f} ± {196 * math.sqrt(res.vm() + base[0].vm()):.1f}' if show_diff else ''
        e = f'{eng.mean():+.2f} ± {1.96 * math.sqrt(eng.vm()):.2f} ({eng.n:,})' if eng.n >= 100 else 'too few'
        md.append(f'| {label} | {res.n:,} | {100 * res.mean():+.1f} ± {196 * math.sqrt(res.vm()):.1f} | {diff} | {100 * win.mean():.0f}% | {100 * lose.mean():.0f}% | {e} |')

    md.append('| **A. Does the enemy have a weak pawn?** | | | | | | |')
    row('no weak pawn', base, False)
    row('1 weak pawn', stats(lambda r: r['n_weak'] == 1))
    row('2 or more weak pawns', stats(lambda r: r['n_weak'] >= 2))
    md.append('| **B. Which kind** | | | | | | |')
    for k in ('isolated', 'backward', 'doubled'):
        row(f'{k} pawn present', stats(lambda r, k=k: k in r['kinds']))
    md.append('| **C. How much pressure on the best target at move 12** (my attackers minus their defenders) | | | | | | |')
    row('well defended (-2 or worse)', stats(lambda r: r['best'] and r['best']['att'] - r['best']['def'] <= -2))
    row('slightly defended (-1 to 0)', stats(lambda r: r['best'] and -1 <= r['best']['att'] - r['best']['def'] <= 0))
    row('under pressure (+1 or more)', stats(lambda r: r['best'] and r['best']['att'] - r['best']['def'] >= 1))
    md.append('| **D. File access** | | | | | | |')
    row('target on a file open to my rooks (no pawn of mine on it)', stats(lambda r: r['best'] and r['best']['half_open']))
    row('target on a file blocked by my own pawn', stats(lambda r: r['best'] and not r['best']['half_open']))
    md.append('| **E. Did the side build up on the target by move 20?** (target still there; my attackers then minus at move 12) | | | | | | |')
    row('built up (+1 attacker or more)', stats(lambda r: r['best'] and r['best']['built'] is not None and r['best']['built'] >= 1))
    row('no build-up (0 or fewer)', stats(lambda r: r['best'] and r['best']['built'] is not None and r['best']['built'] <= 0))
    row('target already gone by move 20 (moved, traded or captured)', stats(lambda r: r['best'] and r['best']['gone20']))
    md.append('| **F. Textbook: isolated or backward target, file open, already under pressure** | | | | | | |')
    row('all three', stats(lambda r: r['best'] and r['best']['half_open'] and r['best']['att'] - r['best']['def'] >= 1))
    md += ['', '## Reading this honestly\n',
           '- Having a target at move 12 is not a choice. Compare with the "none" row, but stronger players also reach better structures.',
           '- "Wins a pawn" counts net pawns, so a pawn won back and a trade of pawns cancel.',
           '- Build-up is measured at move 20, after the plan has been underway for eight moves. Players who build up may be those who are already better.',
           '- Attackers are all pieces and pawns that can capture on the square, not only pieces.', '']
    with open(a.out, 'w', encoding='utf-8') as f:
        f.write('\n'.join(md))
    print('\n'.join(md))


if __name__ == '__main__':
    sys.exit(main())
