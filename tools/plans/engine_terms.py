"""Plans lab: what a move changes, measured by Stockfish 11's evaluation broken into parts.

Stockfish 11 is the last version whose "eval" command prints the classical evaluation term by term: material, imbalance,
initiative, pawns, knights, bishops, rooks, queens, mobility, king safety, threats, passed pawns, space. For each input row:
  * if a move is given, play it and let the engine continue the line (depth 12) to eight plies;
  * if not, take the engine's three best moves and do the same for each;
and record the evaluation parts at the start, after the move and the reply, and at the end of the line.

    python tools/plans/engine_terms.py INPUT.jsonl.gz --out terms-0.jsonl --shard 0 --shards 8 --engine ./stockfish
"""
import argparse
import gzip
import json
import re
import subprocess
import sys
import time

import chess

TERMS = ['Material', 'Imbalance', 'Initiative', 'Pawns', 'Knights', 'Bishops', 'Rooks', 'Queens', 'Mobility', 'King safety',
         'Threats', 'Passed', 'Space', 'Total']
NUM = r'(-?\d+\.\d+|-{3,})'           # Stockfish 11 prints '----' for parts it does not split by colour
ROW = re.compile(r'^\s*([A-Za-z ]+?)\s*\|\s*' + NUM + r'\s+' + NUM + r'\s*\|\s*' + NUM + r'\s+' + NUM + r'\s*\|\s*' + NUM + r'\s+' + NUM)


class SF:
    def __init__(self, path):
        self.p = subprocess.Popen([path], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
        self.send('uci'); self.wait('uciok')
        self.send('setoption name Hash value 64'); self.send('isready'); self.wait('readyok')

    def send(self, s):
        self.p.stdin.write(s + '\n'); self.p.stdin.flush()

    def wait(self, token):
        lines = []
        while True:
            line = self.p.stdout.readline()
            if not line:
                raise RuntimeError('engine died')
            lines.append(line.rstrip('\n'))
            if line.startswith(token):
                return lines

    def search(self, fen, depth, multipv=1):
        self.send(f'setoption name MultiPV value {multipv}')
        self.send(f'position fen {fen}'); self.send(f'go depth {depth}')
        best = {}
        for line in self.wait('bestmove'):
            if not line.startswith('info') or ' pv ' not in line or ' depth ' not in line:
                continue
            k = int((re.search(r' multipv (\d+)', line) or [0, 1])[1])
            sc = re.search(r' score (cp|mate) (-?\d+)', line)
            if not sc:
                continue
            cp = int(sc.group(2)) if sc.group(1) == 'cp' else (1000 if int(sc.group(2)) > 0 else -1000)
            best[k] = {'cp': cp, 'pv': line.split(' pv ')[1].split()}
        return [best[k] for k in sorted(best)]

    def evaluate(self, fen):
        self.send(f'position fen {fen}'); self.send('eval')
        out = {}
        for line in self.wait('Total evaluation'):
            m = ROW.match(line)
            if m and m.group(1).strip() in TERMS:
                vals = [None if v.startswith('--') else float(v) for v in m.groups()[1:]]
                out[m.group(1).strip()] = vals            # [white mg, white eg, black mg, black eg, total mg, total eg]
        return out


def run_line(sf, board, first, depth):
    """Play `first`, continue with the engine to 8 plies; return the line and the positions to evaluate."""
    b = board.copy()
    line = [first]
    b.push(chess.Move.from_uci(first))
    after2 = None
    while len(line) < 8 and not b.is_game_over():
        res = sf.search(b.fen(), depth, 1)
        if not res or not res[0]['pv']:
            break
        mv = chess.Move.from_uci(res[0]['pv'][0])
        if mv not in b.legal_moves:
            break
        b.push(mv); line.append(mv.uci())
        if len(line) == 2:
            after2 = b.fen()
    return line, after2, b.fen()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('input')
    ap.add_argument('--out', required=True)
    ap.add_argument('--shard', type=int, default=0)
    ap.add_argument('--shards', type=int, default=1)
    ap.add_argument('--engine', default='./stockfish')
    ap.add_argument('--depth', type=int, default=12)
    ap.add_argument('--multipv', type=int, default=3)
    ap.add_argument('--minutes', type=float, default=330)
    a = ap.parse_args()
    sf = SF(a.engine)
    t0, n = time.time(), 0
    op = gzip.open if a.input.endswith('.gz') else open
    with op(a.input, 'rt', encoding='utf-8') as src, open(a.out, 'w', encoding='utf-8') as out:
        for i, raw in enumerate(src):
            if i % a.shards != a.shard:
                continue
            if time.time() - t0 > a.minutes * 60:
                break
            r = json.loads(raw)
            try:
                board = chess.Board(r['fen'])
            except ValueError:
                continue
            if not board.is_valid() or board.is_game_over():
                continue                       # composed or broken positions crash Stockfish 11
            try:
                start = sf.evaluate(board.fen())
                if r.get('uci'):
                    if chess.Move.from_uci(r['uci']) not in board.legal_moves:
                        continue
                    firsts = [(r['uci'], None)]
                else:
                    firsts = [(x['pv'][0], x['cp']) for x in sf.search(board.fen(), a.depth, a.multipv) if x['pv']]
            except RuntimeError:
                sf = SF(a.engine)              # the engine died on this position: restart it and move on
                continue
            for uci, cp in firsts:
                try:
                    line, after2, end = run_line(sf, board, uci, a.depth)
                    rec = {'id': r.get('id'), 'fen': r['fen'], 'uci': uci, 'cp': cp, 'line': line, 'start': start,
                           'after2': sf.evaluate(after2) if after2 else None, 'end': sf.evaluate(end)}
                except RuntimeError:
                    sf = SF(a.engine)
                    continue
                out.write(json.dumps(rec, separators=(',', ':')) + '\n')
            n += 1
            if n % 200 == 0:
                out.flush(); print(f'  {n:,} positions, {time.time() - t0:.0f}s', flush=True)
    sf.send('quit')
    print(f'done: {n:,} positions')


if __name__ == '__main__':
    sys.exit(main())
