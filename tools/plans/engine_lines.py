"""Plans lab: Stockfish's best few moves (with their lines) for each position in a list.

    python tools/plans/engine_lines.py lab/plans/data/kid-positions.json --out lines-0.jsonl --shard 0 --shards 6 --depth 18 --multipv 6

Writes one line per position: {"fen", "lines": [{"uci", "cp", "pv"}]}, cp from White's side (mate clipped to +-1000).
Needs a stockfish binary (apt install stockfish gives /usr/games/stockfish) and python-chess. Nothing here is used by the app.
"""
import argparse
import json
import sys
import time

import chess
import chess.engine


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('positions')
    ap.add_argument('--out', required=True)
    ap.add_argument('--shard', type=int, default=0)
    ap.add_argument('--shards', type=int, default=1)
    ap.add_argument('--depth', type=int, default=18)
    ap.add_argument('--multipv', type=int, default=6)
    ap.add_argument('--engine', default='/usr/games/stockfish')
    a = ap.parse_args()
    with open(a.positions, encoding='utf-8') as f:
        positions = json.load(f)
    if isinstance(positions, dict):
        positions = positions.get('positions', [])
    engine = chess.engine.SimpleEngine.popen_uci(a.engine)
    engine.configure({'Threads': 2, 'Hash': 256})
    t0 = time.time()
    with open(a.out, 'w', encoding='utf-8') as out:
        for i, p in enumerate(positions):
            if i % a.shards != a.shard:
                continue
            board = chess.Board(p['fen'])
            infos = engine.analyse(board, chess.engine.Limit(depth=a.depth), multipv=a.multipv)
            lines = []
            for info in infos:
                if 'pv' not in info or not info['pv']:
                    continue
                s = info['score'].white()
                cp = (1000 if s.mate() > 0 else -1000) if s.is_mate() else max(-1000, min(1000, s.score()))
                lines.append({'uci': info['pv'][0].uci(), 'cp': cp, 'pv': [m.uci() for m in info['pv'][:12]]})
            out.write(json.dumps({'fen': p['fen'], 'lines': lines}) + '\n')
            out.flush()
            print(f'  {i} done, {time.time() - t0:.0f}s', flush=True)
    engine.quit()


if __name__ == '__main__':
    sys.exit(main())
