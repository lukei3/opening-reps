"""Plans lab, step 5 (part 2): did the plan improve the engine's evaluation?

Joins the engine evaluations (engine_check.py) with the per-game features (features.py), labels each side's plan as in
plan_stats.py, and reports how the evaluation moved between move 12 and move 25 from that side's point of view.

    python tools/plans/engine_analyze.py features.jsonl.gz evals-*.jsonl --out lab/plans/out/kid-engine.md
"""
import argparse
import collections
import gzip
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from plan_stats import label_plan  # noqa: E402

AT, UNTIL, MIN_MOVES = 12, 25, 2


class Cell:
    def __init__(self):
        self.n = 0; self.s = 0.0; self.ss = 0.0; self.lost = 0; self.won = 0

    def add(self, x):
        self.n += 1; self.s += x; self.ss += x * x
        self.lost += x < -100; self.won += x > 100

    def row(self):
        m = self.s / self.n
        sd = math.sqrt(max(0.0, self.ss / self.n - m * m))
        return m, 1.96 * sd / math.sqrt(self.n), self.lost / self.n, self.won / self.n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('features')
    ap.add_argument('evals', nargs='+')
    ap.add_argument('--out', required=True)
    a = ap.parse_args()

    ev = {}
    for p in a.evals:
        for line in open(p, encoding='utf-8'):
            r = json.loads(line)
            if 'e12' in r and 'e25' in r:
                ev[r['id']] = r
    by_plan = {'w': collections.defaultdict(Cell), 'b': collections.defaultdict(Cell)}
    by_combo = collections.defaultdict(Cell)           # (own plan, same/opposite) for either side
    both = collections.defaultdict(Cell)               # structure of plans for White: (white plan, black plan)
    n = 0
    for line in gzip.open(a.features, 'rt', encoding='utf-8'):
        g = json.loads(line)
        r = ev.get(g['id'])
        if not r or g['plies'] < UNTIL * 2:
            continue
        castled = {k: (c[0] if c and c[1] <= AT else None) for k, c in g['castle'].items()}
        plans = {}
        for k in ('w', 'b'):
            counts = {w: sum(1 for m in g['pawn_moves'][k][w] if AT < m <= UNTIL) for w in 'QCK'}
            plans[k] = label_plan(counts, castled['b' if k == 'w' else 'w'], MIN_MOVES)
        n += 1
        for k, sign in (('w', 1), ('b', -1)):
            swing = sign * (r['e25'] - r['e12'])
            by_plan[k][plans[k]].add(swing)
            same = 'same side' if castled['w'] and castled['w'] == castled['b'] else ('opposite sides' if castled['w'] and castled['b'] else 'not both castled')
            by_combo[(plans[k], same)].add(swing)
        both[(plans['w'], plans['b'])].add(r['e25'] - r['e12'])

    md = ['# Engine check: did the plan help? (King\'s Indian sample)\n',
          f'{n:,} games from the sample reach move 25 and have evaluations (Stockfish, depth 12, centipawns, 100 = about a pawn). '
          'Each row is how much the evaluation moved between move 12 and move 25, from that side\'s point of view. '
          'Positive means the side improved its position while carrying out that plan. The margin is 95%.\n',
          'Win-rate and engine verdicts differ because humans blunder: this table asks whether a plan is sound, not whether it scores.\n']
    for k, name in (('w', 'White'), ('b', 'Black')):
        md += [f'## {name}\n', '| Plan | Games | Eval change (cp) | Lost over a pawn | Gained over a pawn |', '|---|---|---|---|---|']
        for plan, c in sorted(by_plan[k].items(), key=lambda kv: -kv[1].n):
            m, ci, lost, won = c.row()
            md.append(f'| {plan} | {c.n:,} | {m:+.0f} ± {ci:.0f} | {lost * 100:.0f}% | {won * 100:.0f}% |')
        md.append('')
    md += ['## Either side, by castling', '| Plan | Castling | Games | Eval change (cp) |', '|---|---|---|---|']
    for (plan, same), c in sorted(by_combo.items(), key=lambda kv: (kv[0][1], -kv[1].n)):
        if c.n >= 300:
            m, ci, *_ = c.row()
            md.append(f'| {plan} | {same} | {c.n:,} | {m:+.0f} ± {ci:.0f} |')
    md += ['', '## Plan against plan (change from White\'s side)', '| White plan | Black plan | Games | Eval change (cp) |', '|---|---|---|---|']
    for (wp, bp), c in sorted(both.items(), key=lambda kv: -kv[1].n)[:10]:
        m, ci, *_ = c.row()
        md.append(f'| {wp} | {bp} | {c.n:,} | {m:+.0f} ± {ci:.0f} |')
    md += ['', '## Reading this honestly', '',
           '- Depth 12 is a quick look. It is fine for "does the evaluation drift" and not for single positions.',
           '- Evaluation at move 25 includes the players\' mistakes, so this measures what the plan led to in practice.',
           '- The plan label is a rough pawn-move rule. Piece play is not captured.', '']
    with open(a.out, 'w', encoding='utf-8') as f:
        f.write('\n'.join(md))
    print('\n'.join(md))


if __name__ == '__main__':
    sys.exit(main())
