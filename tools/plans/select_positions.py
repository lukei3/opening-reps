"""Plans lab: the King's Indian positions worth explaining.

Counts every position reached at moves 8 to 14 in the whole games, keeps the most common ones (they are the ends of the lines
people actually reach), and records what real players played next and how it scored.

    python tools/plans/select_positions.py games-*.jsonl.gz --out lab/plans/data/kid-positions.json --top 300
"""
import argparse
import collections
import gzip
import json
import sys

import chess

sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from plan_stats import expected_white, score_white  # noqa: E402

LO, HI = 16, 28        # plies: after White's 8th move ... after Black's 14th


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('games', nargs='+')
    ap.add_argument('--out', required=True)
    ap.add_argument('--top', type=int, default=300)
    a = ap.parse_args()
    count = collections.Counter()
    line_of = {}
    nxt = collections.defaultdict(lambda: collections.defaultdict(lambda: [0, 0.0]))   # key -> san -> [n, sum of score minus expectation, mover's view]
    for p in a.games:
        for raw in gzip.open(p, 'rt', encoding='utf-8'):
            g = json.loads(raw)
            moves = g['moves'].split()
            if len(moves) < HI + 2:
                continue
            s = score_white(g['res']) - expected_white(g['w'], g['b'])
            board = chess.Board()
            for ply, san in enumerate(moves[:HI + 1]):
                if LO <= ply <= HI:
                    key = ' '.join(board.fen().split()[:4])
                    count[key] += 1
                    line_of.setdefault(key, moves[:ply])
                    cell = nxt[key][san]
                    cell[0] += 1
                    cell[1] += s if board.turn == chess.WHITE else -s
                try:
                    board.push_san(san)
                except ValueError:
                    break
    top = [k for k, _ in count.most_common(a.top * 3)]
    out = []
    for k in top:
        if len(out) >= a.top:
            break
        moves = sorted(nxt[k].items(), key=lambda kv: -kv[1][0])[:6]
        out.append({'fen': k + ' 0 1', 'games': count[k], 'line': line_of[k],
                    'played': [{'san': m, 'n': v[0], 'adj': round(v[1] / v[0], 4)} for m, v in moves]})
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(out, f, separators=(',', ':'))
    print(f'{len(out)} positions -> {a.out}; most common has {out[0]["games"]:,} games, least {out[-1]["games"]:,}')


if __name__ == '__main__':
    sys.exit(main())
