"""Plans lab: sample a monthly Lichess game file (CC0) for idea labelling, across every opening.

Streams one month (never saving the file) and, from rated blitz/rapid/classical games between 1500 and 2500:
  * positions: one random position per sampled game, between moves 10 and 25, for the Stockfish 11 evaluation-parts run;
  * swings: in games that carry Lichess's own engine evaluations ([%eval ...]), the moves where the mover's evaluation dropped
    by 1.5 pawns or more: real mistakes, with the evaluation before and after, to learn what not to do.

    python tools/plans/dump_sample.py --url URL --positions pos.jsonl.gz --swings swings.jsonl.gz --n 12000 --max-swings 30000
"""
import argparse
import gzip
import io
import json
import random
import re
import sys
import time
import urllib.request

import chess
import zstandard

HEADER = re.compile(r'\[(\w+) "(.*)"\]')
EVAL = re.compile(r'\[%eval (#?-?[\d.]+)\]')
TOKEN = re.compile(r'\{[^}]*\}|\d+\.(?:\.\.)?|\S+')


def cp_of(s):
    if s.startswith('#'):
        return 1000 if not s.startswith('#-') else -1000
    return max(-1000, min(1000, int(round(float(s) * 100))))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', required=True)
    ap.add_argument('--positions', required=True)
    ap.add_argument('--swings', required=True)
    ap.add_argument('--n', type=int, default=12000)
    ap.add_argument('--every', type=int, default=8, help='sample one game in this many')
    ap.add_argument('--max-swings', type=int, default=30000)
    ap.add_argument('--minutes', type=float, default=120)
    ap.add_argument('--seed', type=int, default=1)
    a = ap.parse_args()
    rnd = random.Random(a.seed)
    resp = urllib.request.urlopen(urllib.request.Request(a.url, headers={'User-Agent': 'opening-reps-plans-lab'}))
    text = io.TextIOWrapper(zstandard.ZstdDecompressor().stream_reader(resp), encoding='utf-8', errors='replace')
    t0 = time.time()
    h, seen, npos, nsw = {}, 0, 0, 0
    with gzip.open(a.positions, 'wt', encoding='utf-8') as fp, gzip.open(a.swings, 'wt', encoding='utf-8') as fs:
        for raw in text:
            line = raw.strip()
            if not line:
                continue
            if line[0] == '[':
                m = HEADER.match(line)
                if m:
                    h[m.group(1)] = m.group(2)
                continue
            if line[0] != '1':
                continue
            seen += 1
            hd, h = h, {}
            if time.time() - t0 > a.minutes * 60 or (npos >= a.n and nsw >= a.max_swings):
                break
            ev = hd.get('Event', '')
            if 'Rated' not in ev or not any(s in ev for s in ('Blitz', 'Rapid', 'Classical')):
                continue
            try:
                we, be = int(hd.get('WhiteElo', 0)), int(hd.get('BlackElo', 0))
            except ValueError:
                continue
            if not (1500 <= we <= 2500 and 1500 <= be <= 2500):
                continue
            has_eval = '[%eval' in line
            want_pos = npos < a.n and seen % a.every == 0
            want_sw = has_eval and nsw < a.max_swings
            if not (want_pos or want_sw):
                continue
            toks = TOKEN.findall(line)
            moves, evals = [], []
            for t in toks:
                if t.startswith('{'):
                    m = EVAL.search(t)
                    if m and moves:
                        while len(evals) < len(moves) - 1:
                            evals.append(None)
                        if len(evals) == len(moves) - 1:
                            evals.append(cp_of(m.group(1)))
                elif t[0].isdigit() or t in ('1-0', '0-1', '1/2-1/2', '*'):
                    continue
                else:
                    moves.append(t.rstrip('!?'))
            board = chess.Board()
            stop = rnd.randint(18, 50) if want_pos and len(moves) > 52 else -1
            prev = 20                           # the evaluation before move 1, roughly White's edge
            try:
                for ply, san in enumerate(moves[:120]):
                    if ply == stop:
                        fp.write(json.dumps({'id': f'dump:{seen}:{ply}', 'fen': board.fen(), 'uci': None}) + '\n')
                        npos += 1
                    mv = board.parse_san(san)
                    after = evals[ply] if ply < len(evals) else None
                    if want_sw and after is not None and prev is not None and nsw < a.max_swings and 16 <= ply <= 80:
                        sign = 1 if board.turn == chess.WHITE else -1
                        drop = sign * (prev - after)
                        if drop >= 150 and abs(prev) < 400:
                            fs.write(json.dumps({'fen': board.fen(), 'uci': mv.uci(), 'before': sign * prev, 'after': sign * after,
                                                 'elo': we if sign == 1 else be}) + '\n')
                            nsw += 1
                    board.push(mv)
                    prev = after if after is not None else prev
            except ValueError:
                continue
            if seen % 200000 == 0:
                print(f'  {seen:,} games read, {npos:,} positions, {nsw:,} swings, {time.time() - t0:.0f}s', flush=True)
    print(f'done: {seen:,} games read, {npos:,} positions, {nsw:,} swings')


if __name__ == '__main__':
    sys.exit(main())
