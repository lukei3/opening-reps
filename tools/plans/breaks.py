"""Plans lab: pawn breaks. When does playing one work?

A break (lever) here is a pawn push that lands next to an enemy pawn so that it attacks it. At move 12 the script lists each
side's available breaks and how well supported each is (my attackers minus their attackers on the landing square). Then it
checks whether the side played a break between moves 13 and 25, which one, and when, and how the game went.

    python tools/plans/breaks.py games-*.jsonl.gz --evals evals-*.jsonl --out lab/plans/out/kid-breaks.md
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
from conditions import centre_state  # noqa: E402
from plan_stats import expected_white, score_white  # noqa: E402


def lands_next_to_pawn(board_after, dest, me):
    return any(board_after.piece_at(t) == chess.Piece(chess.PAWN, not me) for t in board_after.attacks(dest))


def available_breaks(board, me):
    """Breaks the side `me` could play now, whoever's turn it is."""
    b = board.copy()
    b.turn = me
    b.ep_square = None
    out = []
    for mv in b.pseudo_legal_moves:
        if b.piece_type_at(mv.from_square) != chess.PAWN or b.is_capture(mv):
            continue
        if chess.square_rank(mv.to_square) in (0, 7):
            continue
        after = b.copy(stack=False)
        after.push(mv)
        if lands_next_to_pawn(after, mv.to_square, me):
            margin = len(after.attackers(me, mv.to_square)) - len(after.attackers(not me, mv.to_square))
            out.append({'file': chess.FILE_NAMES[chess.square_file(mv.to_square)], 'margin': margin})
    return out


def process(line):
    g = json.loads(line)
    if g['plies'] < 50:
        return []
    board = chess.Board()
    b12 = None
    played = {chess.WHITE: [], chess.BLACK: []}          # (move number, file) of breaks played from move 13 on
    pawns12 = None
    try:
        for ply, san in enumerate(g['moves'].split()[:50]):
            mv = board.parse_san(san)
            color = board.turn
            is_pawn = board.piece_type_at(mv.from_square) == chess.PAWN
            cap = board.is_capture(mv)
            board.push(mv)
            if ply >= 24 and is_pawn and not cap and lands_next_to_pawn(board, mv.to_square, color):
                played[color].append((ply // 2 + 1, chess.FILE_NAMES[chess.square_file(mv.to_square)]))
            if ply == 23:
                b12 = board.copy()
                pawns12 = {c: len(board.pieces(chess.PAWN, c)) for c in (chess.WHITE, chess.BLACK)}
        pawns25 = {c: len(board.pieces(chess.PAWN, c)) for c in (chess.WHITE, chess.BLACK)}
    except ValueError:
        return []
    if b12 is None:
        return []
    s = score_white(g['res']); e = expected_white(g['w'], g['b'])
    centre = centre_state(b12)
    rows = []
    for color in (chess.WHITE, chess.BLACK):
        me = 'w' if color == chess.WHITE else 'b'
        sc, ex = (s, e) if color == chess.WHITE else (1 - s, 1 - e)
        avail = available_breaks(b12, color)
        gain = (pawns12[not color] - pawns25[not color]) - (pawns12[color] - pawns25[color])
        rows.append({'id': g['id'], 'side': me, 'adj': sc - ex, 'gain': gain, 'centre': centre,
                     'avail': len(avail), 'supported': len([x for x in avail if x['margin'] >= 0]),
                     'best': max((x['margin'] for x in avail), default=None),
                     'played': played[color][0] if played[color] else None, 'n_played': len(played[color])})
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
    ev, e12 = {}, {}
    for p in a.evals:
        for line in open(p, encoding='utf-8'):
            r = json.loads(line)
            if 'e12' in r and 'e25' in r:
                ev[r['id']] = r['e25'] - r['e12']
                e12[r['id']] = r['e12']
    rows = []
    def lines():
        for p in a.games:
            for line in gzip.open(p, 'rt', encoding='utf-8'):
                yield line
    with cf.ProcessPoolExecutor(max(1, (os.cpu_count() or 2) - 1)) as pool:
        for r in pool.map(process, lines(), chunksize=300):
            rows.extend(r)
    print(f'{len(rows):,} side-positions')

    def stats(sel):
        res, win, eng = Acc(), Acc(), Acc()
        for r in rows:
            if sel(r):
                res.add(r['adj']); win.add(1.0 if r['gain'] >= 1 else 0.0)
                if r['id'] in ev:
                    eng.add(ev[r['id']] * (1 if r['side'] == 'w' else -1) / 100)
        return res, win, eng

    def line(label, st, ref=None, min_n=300):
        res, win, eng = st
        if res.n < min_n:
            return
        diff = f'{100 * (res.mean() - ref[0].mean()):+.1f} ± {196 * math.sqrt(res.vm() + ref[0].vm()):.1f}' if ref else ''
        e = f'{eng.mean():+.2f} ± {1.96 * math.sqrt(eng.vm()):.2f} ({eng.n:,})' if eng.n >= 100 else 'too few'
        md.append(f'| {label} | {res.n:,} | {100 * res.mean():+.1f} ± {196 * math.sqrt(res.vm()):.1f} | {diff} | {100 * win.mean():.0f}% | {e} |')

    HEAD = ['| Group | Positions | Result | vs reference | Wins a pawn | Engine |', '|---|---|---|---|---|---|']
    md = ["# Pawn breaks (King's Indian)\n",
          f'{len(rows):,} side-positions (each game that reaches move 25, both sides). A **break** is a pawn push that lands next to an enemy pawn so it attacks it. **Available** breaks are those the side could play at move 12; **supported** means my attackers on the landing square at least equal theirs. **Played** means a break was played between moves 13 and 25.\n',
          'Columns: **Result** = score against what the rating gap predicts, in points (95% margin); **vs reference** = difference from the reference group named in each section; **Wins a pawn** = net pawns won by move 25; **Engine** = Stockfish evaluation change, in pawns.\n']
    have = lambda r: r['avail'] >= 1
    md += ['## A. With a break available, is playing one better than waiting?\n'] + HEAD
    ref = stats(lambda r: have(r) and r['played'] is None)
    line('break available, none played (reference)', ref)
    line('break available, one played', stats(lambda r: have(r) and r['played'] is not None), ref)
    line('no break available', stats(lambda r: not have(r)), ref)
    md += ['', '## B. Does support matter? (best available break at move 12)\n'] + HEAD
    for label, sel in (('unsupported best break (margin below 0)', lambda r: r['best'] is not None and r['best'] < 0),
                       ('level (0)', lambda r: r['best'] == 0), ('well supported (1 or more)', lambda r: r['best'] is not None and r['best'] >= 1)):
        base = stats(lambda r, sel=sel: sel(r) and r['played'] is None)
        md.append(f'| **{label}** | | | | | |')
        line('  not played (reference)', base)
        line('  played', stats(lambda r, sel=sel: sel(r) and r['played'] is not None), base)
    md += ['', '## C. Which break? (the first one played, by landing file; reference: break available but none played)\n'] + HEAD
    for side, name in (('b', 'Black'), ('w', 'White')):
        md.append(f'| **{name}** | | | | | |')
        for f in 'abcdefgh':
            line(f'  {f}-file break first', stats(lambda r, f=f, side=side: r['side'] == side and r['played'] and r['played'][1] == f), ref)
    md += ['', '## D. Timing of the first break (reference: none played)\n'] + HEAD
    for lo, hi, label in ((13, 14, 'immediately (moves 13 to 14)'), (15, 17, 'moves 15 to 17'), (18, 21, 'moves 18 to 21'), (22, 25, 'late (moves 22 to 25)')):
        line(label, stats(lambda r, lo=lo, hi=hi: r['played'] and lo <= r['played'][0] <= hi), ref)
    md += ['', '## E. By centre at move 12 (benefit of playing a break, with a break available)\n'] + HEAD
    for c in ('locked', 'tension', 'semi-open', 'open'):
        base = stats(lambda r, c=c: have(r) and r['centre'] == c and r['played'] is None)
        md.append(f'| **{c} centre** | | | | | |')
        line('  none played (reference)', base)
        line('  played', stats(lambda r, c=c: have(r) and r['centre'] == c and r['played'] is not None), base)
    md += ['', '## F. How many supported breaks were available at move 12? (reference: none available)\n'] + HEAD
    base = stats(lambda r: r['supported'] == 0)
    line('none supported (reference)', base)
    for k in (1, 2):
        line(f'{k} supported', stats(lambda r, k=k: r['supported'] == k), base)
    line('3 or more supported', stats(lambda r: r['supported'] >= 3), base)
    # The confound: a side that is worse at move 12 has to break, a side that is better can wait. Compare within the same engine eval.
    def own_eval(r):
        v = e12.get(r['id'])
        return None if v is None else v * (1 if r['side'] == 'w' else -1)
    md += ['', '## G. Same starting position quality: break available at move 12, split by the engine\'s evaluation then (engine sample only)\n'] + HEAD
    for label, lo, hi in (('clearly worse (engine -50 or lower)', -10000, -50), ('about equal (-49 to +49)', -49, 49), ('clearly better (+50 or higher)', 50, 10000)):
        inband = lambda r, lo=lo, hi=hi: have(r) and own_eval(r) is not None and lo <= own_eval(r) <= hi
        base = stats(lambda r, ib=inband: ib(r) and r['played'] is None)
        md.append(f'| **{label}** | | | | | |')
        line('  none played (reference)', base, None, 60)
        line('  played', stats(lambda r, ib=inband: ib(r) and r['played'] is not None), base, 60)
    md += ['', '## Reading this honestly\n',
           '- Whether a side plays a break is a choice made over the next 13 moves; players who find a good one may simply be better.',
           '- "Support" counts all attackers and defenders on the landing square at move 12; it does not see what the pieces will do next.',
           '- A break pushed by a pawn that is later recaptured still counts as a break played.', '']
    with open(a.out, 'w', encoding='utf-8') as f:
        f.write('\n'.join(md))
    print('\n'.join(md))


if __name__ == '__main__':
    sys.exit(main())
