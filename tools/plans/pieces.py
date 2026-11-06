"""Plans lab: piece placement. Outposts, the bishop pair, rooks on files, mobility, space.

At move 12 it measures, for each side, what the research list calls piece features, and what happened afterwards. The
outposts question is also asked as "did the side get a knight onto an outpost by move 20?" like the weak-pawn build-up test.

    python tools/plans/pieces.py games-*.jsonl.gz --evals evals-*.jsonl --out lab/plans/out/kid-pieces.md
"""
import argparse
import concurrent.futures as cf
import gzip
import json
import math
import os
import sys

import chess
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from features import advance  # noqa: E402
from plan_stats import expected_white, score_white  # noqa: E402


def outpost_squares(board, me):
    """Squares in the enemy half that one of my pawns guards and no enemy pawn can ever attack."""
    en = not me
    enemy_pawns = [(chess.square_file(s), advance(s, en)) for s in board.pieces(chess.PAWN, en)]
    out = []
    for sq in chess.SQUARES:
        if advance(sq, me) < 3 or advance(sq, me) > 5:      # my ranks 4 to 6
            continue
        if not any(board.piece_at(a) == chess.Piece(chess.PAWN, me) for a in board.attackers(me, sq)):
            continue
        f = chess.square_file(sq)
        eadv = advance(sq, en) if 0 <= chess.square_rank(sq) <= 7 else 0
        if any(abs(pf - f) == 1 and pa <= eadv - 1 for pf, pa in enemy_pawns):
            continue
        out.append(sq)
    return out


def rook_files(board, me):
    """Rooks on a fully open file, and on a half-open file (no pawn of mine, an enemy pawn on it)."""
    full = half = 0
    for sq in board.pieces(chess.ROOK, me):
        f = chess.square_file(sq)
        mine = any(chess.square_file(p) == f for p in board.pieces(chess.PAWN, me))
        theirs = any(chess.square_file(p) == f for p in board.pieces(chess.PAWN, not me))
        if not mine and not theirs:
            full += 1
        elif not mine:
            half += 1
    return full, half


def mobility(board, me):
    """Squares knights, bishops, rooks and the queen can go to that are not occupied by own pieces or attacked by an enemy pawn."""
    en = not me
    pawn_att = chess.SquareSet()
    for p in board.pieces(chess.PAWN, en):
        pawn_att |= board.attacks(p)
    own = board.occupied_co[me]
    n = 0
    for t in (chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN):
        for sq in board.pieces(t, me):
            n += len([x for x in board.attacks(sq) if not (own >> x) & 1 and x not in pawn_att])
    return n


def space(board, me):
    return sum(advance(s, me) for s in board.pieces(chess.PAWN, me))


def bad_bishop(board, me):
    """Own pawns standing on the colour of the bishop, summed over my bishops (4 or more on one is a bad bishop)."""
    worst = 0
    for b in board.pieces(chess.BISHOP, me):
        col = (chess.square_file(b) + chess.square_rank(b)) % 2
        worst = max(worst, len([p for p in board.pieces(chess.PAWN, me) if (chess.square_file(p) + chess.square_rank(p)) % 2 == col]))
    return worst


def knights_on(board, me, squares):
    s = set(squares)
    return len([k for k in board.pieces(chess.KNIGHT, me) if k in s])


def process(line):
    g = json.loads(line)
    if g['plies'] < 50:
        return []
    board = chess.Board()
    snaps = {}
    try:
        for ply, san in enumerate(g['moves'].split()[:50]):
            board.push_san(san)
            if ply in (23, 39):
                snaps[ply] = board.copy()
    except ValueError:
        return []
    b12, b20 = snaps.get(23), snaps.get(39)
    if not (b12 and b20):
        return []
    s = score_white(g['res']); e = expected_white(g['w'], g['b'])
    rows = []
    for color in (chess.WHITE, chess.BLACK):
        me, en = ('w' if color == chess.WHITE else 'b'), not color
        sc, ex = (s, e) if color == chess.WHITE else (1 - s, 1 - e)
        out12 = outpost_squares(b12, color)
        out20 = outpost_squares(b20, color)
        ro_me, rh_me = rook_files(b12, color); ro_en, rh_en = rook_files(b12, en)
        ro20, rh20 = rook_files(b20, color)
        nb_me, nb_en = len(b12.pieces(chess.BISHOP, color)), len(b12.pieces(chess.BISHOP, en))
        rows.append({
            'id': g['id'], 'side': me, 'adj': sc - ex,
            'out_n': len(out12), 'on_out': knights_on(b12, color, out12), 'on_out20': knights_on(b20, color, out20),
            'bishop_pair': (nb_me >= 2) - (nb_en >= 2), 'mob': mobility(b12, color) - mobility(b12, en),
            'space': space(b12, color) - space(b12, en), 'bad_b': bad_bishop(b12, color), 'bad_b_en': bad_bishop(b12, en),
            'rook_open': (ro_me + rh_me) - (ro_en + rh_en), 'rook_open20': ro20 + rh20, 'rook_open12': ro_me + rh_me,
            'open_file_exists': any(not any(chess.square_file(p) == f for p in b12.pieces(chess.PAWN, color)) for f in range(8)),
            'knights': len(b12.pieces(chess.KNIGHT, color)) - len(b12.pieces(chess.KNIGHT, en)), 'bishops': nb_me - nb_en,
        })
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
    print(f'{len(rows):,} side-positions')

    def stats(sel):
        res, eng = Acc(), Acc()
        for r in rows:
            if sel(r):
                res.add(r['adj'])
                if r['id'] in ev:
                    eng.add(ev[r['id']] * (1 if r['side'] == 'w' else -1) / 100)
        return res, eng

    HEAD = ['| Group | Positions | Result | vs reference | Engine |', '|---|---|---|---|---|']
    md = ["# Pieces and outposts (King's Indian)\n",
          f'{len(rows):,} side-positions, each game that reaches move 25, both sides. Measured at move 12 unless stated. **Result** = score against the rating prediction, in points (95% margin). **vs reference** = difference from the group marked as reference. **Engine** = Stockfish evaluation change from move 12 to 25, in pawns.\n',
          'An **outpost** is a square in the enemy half (ranks 4 to 6 from the side\'s view) guarded by one of its pawns that no enemy pawn can ever attack.\n']

    def line(label, st, ref=None, min_n=300):
        res, eng = st
        if res.n < min_n:
            return
        diff = f'{100 * (res.mean() - ref[0].mean()):+.1f} ± {196 * math.sqrt(res.vm() + ref[0].vm()):.1f}' if ref else ''
        e = f'{eng.mean():+.2f} ± {1.96 * math.sqrt(eng.vm()):.2f} ({eng.n:,})' if eng.n >= 100 else 'too few'
        md.append(f'| {label} | {res.n:,} | {100 * res.mean():+.1f} ± {196 * math.sqrt(res.vm()):.1f} | {diff} | {e} |')

    md += ['## A. Outposts available at move 12\n'] + HEAD
    ref = stats(lambda r: r['out_n'] == 0)
    line('no outpost (reference)', ref)
    line('1 outpost square', stats(lambda r: r['out_n'] == 1), ref)
    line('2 outpost squares', stats(lambda r: r['out_n'] == 2), ref)
    line('3 or more', stats(lambda r: r['out_n'] >= 3), ref)
    md += ['', '## B. A knight already on an outpost at move 12\n'] + HEAD
    ref = stats(lambda r: r['out_n'] >= 1 and r['on_out'] == 0)
    line('outposts exist, no knight on one (reference)', ref)
    line('knight on an outpost', stats(lambda r: r['on_out'] >= 1), ref)
    md += ['', '## C. Getting a knight there: outposts exist at move 12 but no knight on one yet; where is it by move 20?\n'] + HEAD
    pool = lambda r: r['out_n'] >= 1 and r['on_out'] == 0
    ref = stats(lambda r: pool(r) and r['on_out20'] == 0)
    line('no knight on an outpost at move 20 (reference)', ref)
    line('knight on an outpost at move 20', stats(lambda r: pool(r) and r['on_out20'] >= 1), ref)
    md += ['', '## D. Bishop pair\n'] + HEAD
    ref = stats(lambda r: r['bishop_pair'] == 0)
    line('equal bishops (reference)', ref)
    line('I have the pair, they do not', stats(lambda r: r['bishop_pair'] == 1), ref)
    line('they have the pair, I do not', stats(lambda r: r['bishop_pair'] == -1), ref)
    md += ['', '## E. Rooks on open or half-open files\n'] + HEAD
    ref = stats(lambda r: r['rook_open'] == 0)
    line('level (reference)', ref)
    line('I have more rooks on open files than they', stats(lambda r: r['rook_open'] >= 1), ref)
    line('they have more', stats(lambda r: r['rook_open'] <= -1), ref)
    md += ['', 'Getting a rook there: I have a file that is open for me at move 12 but no rook on it yet.\n'] + HEAD
    pool = lambda r: r['open_file_exists'] and r['rook_open12'] == 0
    ref = stats(lambda r: pool(r) and r['rook_open20'] == 0)
    line('still no rook on an open file at move 20 (reference)', ref)
    line('rook on an open or half-open file by move 20', stats(lambda r: pool(r) and r['rook_open20'] >= 1), ref)
    md += ['', '## F. Piece mobility (safe squares for knights, bishops, rooks, queen) minus the enemy\'s, in four equal groups\n'] + HEAD
    vals = sorted(r['mob'] for r in rows)
    q = [vals[len(vals) * k // 4] for k in (1, 2, 3)]
    groups = [('1 least mobile (≤ %d)' % q[0], lambda r: r['mob'] <= q[0]), ('2 (≤ %d)' % q[1], lambda r: q[0] < r['mob'] <= q[1]),
              ('3 (≤ %d)' % q[2], lambda r: q[1] < r['mob'] <= q[2]), ('4 most mobile (> %d)' % q[2], lambda r: r['mob'] > q[2])]
    ref = stats(groups[0][1])
    for i, (label, sel) in enumerate(groups):
        line(label + (' (reference)' if i == 0 else ''), stats(sel), None if i == 0 else ref)
    md += ['', '## G. Space (total pawn advance) minus the enemy\'s, in four equal groups\n'] + HEAD
    vals = sorted(r['space'] for r in rows)
    q = [vals[len(vals) * k // 4] for k in (1, 2, 3)]
    groups = [('1 least space (≤ %d)' % q[0], lambda r: r['space'] <= q[0]), ('2 (≤ %d)' % q[1], lambda r: q[0] < r['space'] <= q[1]),
              ('3 (≤ %d)' % q[2], lambda r: q[1] < r['space'] <= q[2]), ('4 most space (> %d)' % q[2], lambda r: r['space'] > q[2])]
    ref = stats(groups[0][1])
    for i, (label, sel) in enumerate(groups):
        line(label + (' (reference)' if i == 0 else ''), stats(sel), None if i == 0 else ref)
    md += ['', '## H. A bad bishop (own pawns on its colour; worst bishop)\n'] + HEAD
    ref = stats(lambda r: r['bad_b'] <= 3)
    line('good bishops, 3 or fewer pawns on its colour (reference)', ref)
    line('bad bishop, 4 or 5', stats(lambda r: 4 <= r['bad_b'] <= 5), ref)
    line('very bad bishop, 6 or more', stats(lambda r: r['bad_b'] >= 6), ref)

    # all features at once
    names = ['outposts available', 'knight on outpost', 'bishop pair (me minus them)', 'mobility diff', 'space diff', 'rooks on open files diff', 'my bad bishop', 'their bad bishop']
    keys = ['out_n', 'on_out', 'bishop_pair', 'mob', 'space', 'rook_open', 'bad_b', 'bad_b_en']
    X = np.array([[r[k] for k in keys] for r in rows], dtype=float)
    y = np.array([r['adj'] for r in rows])
    mu, sd = X.mean(0), X.std(0)
    Z = (X - mu) / sd
    A = np.column_stack([np.ones(len(Z)), Z])
    coef, *_ = np.linalg.lstsq(A, y, rcond=None)
    resid = y - A @ coef
    cov = (resid @ resid / (len(y) - A.shape[1])) * np.linalg.inv(A.T @ A)
    se = np.sqrt(np.diag(cov))
    md += ['', '## I. All together: what matters once the others are held fixed?\n',
           'A linear fit of the result (against rating expectation) on all eight features, each scaled to one standard deviation. The number is how many points of result one standard deviation of that feature is worth.\n',
           '| Feature | Points per 1 SD | ± 95% |', '|---|---|---|']
    for i in np.argsort(-np.abs(coef[1:])):
        md.append(f'| {names[i]} | {100 * coef[i + 1]:+.2f} | {196 * se[i + 1]:.2f} |')
    md += ['', '## Reading this honestly\n',
           '- These are positions at move 12, a point where many outposts and files do not exist yet. Most positions have no outpost at all.',
           '- Mobility and space are crude counts. They tend to move together with who is better.',
           '- The "getting there" tests look at move 20, so players who got there may have been better already.', '']
    with open(a.out, 'w', encoding='utf-8') as f:
        f.write('\n'.join(md))
    print('\n'.join(md))


if __name__ == '__main__':
    sys.exit(main())
