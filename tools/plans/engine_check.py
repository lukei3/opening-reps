"""Plans lab, step 5 (part 1): ask Stockfish how each game stood at move 12 and at move 25.

The results tables compare plans by how often they WON, which mixes in blunders, clocks and rating. The engine does not
care who was tired. If a plan really helps, the evaluation should improve between move 12 and move 25 more often when
it is chosen. Writes one line per game: {"id", "e12", "e25"}, centipawns from White's side, mate scores clipped to +-1000.

    python tools/plans/engine_check.py games.jsonl.gz --out evals-0.jsonl --shard 0 --shards 8 --depth 12

Needs a stockfish binary (apt install stockfish gives /usr/games/stockfish) and python-chess.
Nothing here is imported by the app.
"""
import argparse
import gzip
import json
import sys
import time

import chess
import chess.engine

CLIP = 1000


def evaluate(engine, board, depth):
    info = engine.analyse(board, chess.engine.Limit(depth=depth))
    s = info['score'].white()
    if s.is_mate():
        return CLIP if s.mate() > 0 else -CLIP
    return max(-CLIP, min(CLIP, s.score()))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('games')
    ap.add_argument('--out', required=True)
    ap.add_argument('--shard', type=int, default=0)
    ap.add_argument('--shards', type=int, default=1)
    ap.add_argument('--depth', type=int, default=12)
    ap.add_argument('--engine', default='/usr/games/stockfish')
    ap.add_argument('--limit', type=int, default=0)
    a = ap.parse_args()

    engine = chess.engine.SimpleEngine.popen_uci(a.engine)
    engine.configure({'Threads': 1, 'Hash': 128})
    t0, done = time.time(), 0
    with gzip.open(a.games, 'rt', encoding='utf-8') as src, open(a.out, 'w', encoding='utf-8') as out:
        for i, line in enumerate(src):
            if i % a.shards != a.shard:
                continue
            g = json.loads(line)
            moves = g['moves'].split()
            if len(moves) < 50:
                continue
            board = chess.Board()
            row = {'id': g['id']}
            try:
                for ply, san in enumerate(moves[:50]):
                    board.push_san(san)
                    if ply == 23:
                        row['e12'] = evaluate(engine, board, a.depth)
                    if ply == 49:
                        row['e25'] = evaluate(engine, board, a.depth)
            except ValueError:
                continue
            out.write(json.dumps(row) + '\n')
            done += 1
            if done % 200 == 0:
                print(f'  {done} games, {time.time() - t0:.0f}s', flush=True)
            if a.limit and done >= a.limit:
                break
    engine.quit()
    print(f'Done: {done} games in {time.time() - t0:.0f}s -> {a.out}')


if __name__ == '__main__':
    sys.exit(main())
