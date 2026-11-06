"""Plans lab: sample real positions for the Plans tab drill (data/plans/drill.json).

Takes whole King's Indian games, replays each to moves 12, 15 and 18 (after Black's move), and keeps the position as a FEN with
the Lichess game id so the drill can link to the real game.

    python tools/plans/build_drill.py games-2023-1*.jsonl.gz --out data/plans/drill.json --games 170
"""
import argparse
import gzip
import json
import random
import sys

import chess


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('games', nargs='+')
    ap.add_argument('--out', required=True)
    ap.add_argument('--games-count', '--games', dest='count', type=int, default=170)
    ap.add_argument('--seed', type=int, default=11)
    a = ap.parse_args()
    rnd = random.Random(a.seed)
    lines = []
    for p in a.games:
        for line in gzip.open(p, 'rt', encoding='utf-8'):
            lines.append(line)
    rnd.shuffle(lines)
    out = []
    for line in lines:
        if len(out) >= a.count * 3:
            break
        g = json.loads(line)
        if g['plies'] < 60 or min(g['w'], g['b']) < 1700:
            continue
        board = chess.Board()
        fens = {}
        try:
            for ply, san in enumerate(g['moves'].split()[:36]):
                board.push_san(san)
                if ply in (23, 29, 35):
                    fens[ply // 2 + 1] = board.fen()
        except ValueError:
            continue
        for move_no, fen in fens.items():
            out.append({'fen': fen, 'id': g['id'], 'move': move_no})
    rnd.shuffle(out)
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(out, f, separators=(',', ':'))
    print(f'{len(out)} positions -> {a.out}')


if __name__ == '__main__':
    sys.exit(main())
