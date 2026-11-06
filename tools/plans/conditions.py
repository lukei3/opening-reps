"""Plans lab: under which conditions does a pawn storm against the king work?

For every side that has both kings castled at move 12, measures conditions from the research list (locked centre, attackers
against defenders around the king, the race against the other wing, pawn shield, enemy fianchetto bishop, queens on),
labels whether the side then stormed (as plan_stats.py), and compares:
  * how storming games score against rating expectation, per condition,
  * "benefit of storming": storming minus not storming, within the same condition,
  * the engine's evaluation change when engine data exists for the game.

    python tools/plans/conditions.py games-*.jsonl.gz --evals evals-*.jsonl --out lab/plans/out/kid-conditions.md
"""
import argparse
import collections
import concurrent.futures as cf
import gzip
import json
import math
import os
import sys

import chess

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from features import WING, snapshot, advance  # noqa: E402
from ml_plans import label, wing_of  # noqa: E402
from plan_stats import expected_white, score_white  # noqa: E402

AT = 12
WEIGHT = {chess.QUEEN: 4, chess.ROOK: 2, chess.BISHOP: 2, chess.KNIGHT: 2}


def centre_state(board):
    blocked = tension = 0
    for color in (chess.WHITE, chess.BLACK):
        step = 8 if color == chess.WHITE else -8
        for sq in board.pieces(chess.PAWN, color):
            if chess.square_file(sq) in (3, 4):
                ahead = sq + step
                if 0 <= ahead < 64 and board.piece_at(ahead) == chess.Piece(chess.PAWN, not color):
                    blocked += 1 if color == chess.WHITE else 0
            tension += len([t for t in board.attacks(sq) if board.piece_at(t) == chess.Piece(chess.PAWN, not color)])
    if blocked >= 2 and tension == 0:
        return 'locked'
    if tension >= 1:
        return 'tension'
    return 'semi-open' if blocked == 1 else 'open'


def conditions(board, snap, color, castle, target):
    me, en = ('w', 'b') if color == chess.WHITE else ('b', 'w')
    foe_king = board.king(not color)
    zone = set(board.attacks(foe_king)) | {foe_king}
    att = deff = 0
    for sq, piece in board.piece_map().items():
        if piece.piece_type in WEIGHT:
            if not (set(board.attacks(sq)) & zone):
                continue
            if piece.color == color:
                att += WEIGHT[piece.piece_type]
            else:
                deff += WEIGHT[piece.piece_type]
    own_side = castle[me][0] if castle[me] else None
    race = None
    if own_side:
        race = snap['pawns_' + me][target][1] - snap['pawns_' + en][own_side][1]
    queens_own = len(board.pieces(chess.QUEEN, color)) > 0
    queens_en = len(board.pieces(chess.QUEEN, not color)) > 0
    fian = [chess.G7, chess.B7] if color == chess.WHITE else [chess.G2, chess.B2]
    return {
        'centre': centre_state(board),
        'att_def': att - deff, 'att': att, 'def': deff,
        'race': race,
        'shield': snap['shield_' + en],
        'storm_progress': snap['pawns_' + me][target][1],
        'fianchetto': any(board.piece_at(s) == chess.Piece(chess.BISHOP, not color) for s in fian),
        'queens': 'both' if queens_own and queens_en else ('none' if not (queens_own or queens_en) else 'one side'),
        'same_side': own_side == target,
        'minors_en_dark': len([s for s in board.pieces(chess.BISHOP, not color)]),
    }


def process(line):
    g = json.loads(line)
    if g['plies'] < 50:
        return []
    board = chess.Board()
    castle = {'w': None, 'b': None}
    pm = {'w': {w: [] for w in 'QCK'}, 'b': {w: [] for w in 'QCK'}}
    at = None
    try:
        for ply, san in enumerate(g['moves'].split()[:50]):
            move = board.parse_san(san)
            key = 'w' if board.turn == chess.WHITE else 'b'
            no = ply // 2 + 1
            if board.is_castling(move):
                castle[key] = ['K' if chess.square_file(move.to_square) == 6 else 'Q', no]
            elif board.piece_type_at(move.from_square) == chess.PAWN:
                pm[key][wing_of(move.from_square)].append(no)
            board.push(move)
            if ply == AT * 2 - 1:
                at = (board.copy(), snapshot(board), {k: (c if c and c[1] <= AT else None) for k, c in castle.items()})
    except ValueError:
        return []
    if at is None:
        return []
    b12, snap, c12 = at
    out = []
    for color in (chess.WHITE, chess.BLACK):
        me, en = ('w', 'b') if color == chess.WHITE else ('b', 'w')
        if c12[en] is None:
            continue
        target = c12[en][0]
        s = score_white(g['res']); e = expected_white(g['w'], g['b'])
        sc, ex = (s, e) if color == chess.WHITE else (1 - s, 1 - e)
        out.append({'id': g['id'], 'side': me, 'storm': label(pm, me, target), 'adj': sc - ex, **conditions(b12, snap, color, c12, target)})
    return out


class Acc:
    def __init__(self):
        self.n = 0; self.s = 0.0; self.ss = 0.0

    def add(self, x):
        self.n += 1; self.s += x; self.ss += x * x

    def mean(self):
        return self.s / self.n if self.n else 0.0

    def var_of_mean(self):
        if self.n < 2:
            return 1.0
        m = self.mean()
        return max(0.0, self.ss / self.n - m * m) / self.n


def bin_of(name, r):
    if name == 'centre':
        return r['centre']
    if name == 'att_def':
        d = r['att_def']
        return '≤ -3' if d <= -3 else ('-2 to 0' if d <= 0 else ('1 to 2' if d <= 2 else ('3 to 5' if d <= 5 else '6 or more')))
    if name == 'race':
        d = r['race']
        if d is None:
            return None
        return 'behind by 3+' if d <= -3 else ('level (-2 to 2)' if d <= 2 else 'ahead by 3+')
    if name == 'shield':
        return f"enemy shield {min(r['shield'], 4)}" if r['shield'] < 4 else 'enemy shield 4+'
    if name == 'storm_progress':
        v = r['storm_progress']
        return 'not started (0)' if v == 0 else ('1 to 3 squares' if v <= 3 else '4+ squares')
    if name == 'fianchetto':
        return 'enemy fianchetto bishop' if r['fianchetto'] else 'no enemy fianchetto'
    if name == 'queens':
        return r['queens']
    if name == 'same_side':
        return 'kings on the same side' if r['same_side'] else 'kings on opposite sides'
    return None


FEATURES = [('same_side', 'Kings on the same side or opposite'), ('centre', 'Centre at move 12'),
            ('att_def', 'Attackers minus defenders around the enemy king (weighted: Q4, R2, B2, N2)'),
            ('race', 'The race: own pawn advance on the target wing minus their advance on my king\'s wing'),
            ('shield', 'Enemy king\'s pawn shield (pawns in front of the king)'), ('storm_progress', 'How far my pawns have already advanced on the target wing'),
            ('fianchetto', 'Enemy fianchetto bishop'), ('queens', 'Queens on the board')]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('games', nargs='+')
    ap.add_argument('--evals', nargs='*', default=[])
    ap.add_argument('--out', required=True)
    ap.add_argument('--min', type=int, default=400, help='fewest storming games a row needs to be shown')
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
    print(f'{len(rows):,} side-positions (both castled by move {AT}, game reaches move 25)')
    storm_rate = sum(r['storm'] for r in rows) / len(rows)

    md = ['# When does a pawn storm work? (King\'s Indian, both kings castled by move 12)\n',
          f'{len(rows):,} side-positions from real games. The side "stormed" if, from move 13 to 25, it made more pawn moves on the wing where the enemy king castled than anywhere else, and at least two. Overall {storm_rate * 100:.0f}% did.\n',
          'For each condition the table gives, for the side in question:\n',
          '- **Storm result**: how storming games score compared with what the rating gap predicts (percentage points, 95% margin).',
          '- **No-storm result**: the same for games in the same condition that did not storm.',
          '- **Benefit of storming**: storm minus no-storm, in the same condition. Positive means storming beat the alternatives here.',
          '- **Engine**: change in Stockfish\'s evaluation from move 12 to 25 for storming games where we have engine data (pawns, ± 95% margin).\n']
    for name, title in FEATURES:
        buckets = collections.defaultdict(lambda: {'s': Acc(), 'n': Acc(), 'e': Acc()})
        for r in rows:
            b = bin_of(name, r)
            if b is None:
                continue
            buckets[b]['s' if r['storm'] else 'n'].add(r['adj'])
            if r['storm'] and r['id'] in ev:
                buckets[b]['e'].add((ev[r['id']] * (1 if r['side'] == 'w' else -1)) / 100)
        md += [f'## {title}\n', '| Condition | Games | Storm rate | Storm result | No-storm result | Benefit of storming | Engine (storming) |', '|---|---|---|---|---|---|---|']
        for b, v in sorted(buckets.items()):
            s, n, e = v['s'], v['n'], v['e']
            if s.n < a.min or n.n < a.min:
                continue
            diff = s.mean() - n.mean()
            ci = 1.96 * math.sqrt(s.var_of_mean() + n.var_of_mean())
            sc = 1.96 * math.sqrt(s.var_of_mean())
            nc = 1.96 * math.sqrt(n.var_of_mean())
            eng = f'{e.mean():+.2f} ± {1.96 * math.sqrt(e.var_of_mean()):.2f} ({e.n:,})' if e.n >= 100 else 'too few'
            md.append(f'| {b} | {s.n + n.n:,} | {100 * s.n / (s.n + n.n):.0f}% | {100 * s.mean():+.1f} ± {100 * sc:.1f} | {100 * n.mean():+.1f} ± {100 * nc:.1f} | **{100 * diff:+.1f} ± {100 * ci:.1f}** | {eng} |')
        md.append('')
    # the combination the teaching says matters most
    md += ['## The textbook recipe together\n', 'Same side castling, locked centre, attackers at least level with defenders, and not behind in the race.\n',
           '| Group | Games | Storm rate | Benefit of storming |', '|---|---|---|---|']
    def recipe(r):
        return r['same_side'] and r['centre'] == 'locked' and r['att_def'] >= 0 and (r['race'] is None or r['race'] >= -2)
    for title, cond in (('recipe holds', recipe), ('recipe does not hold', lambda r: not recipe(r))):
        s, n = Acc(), Acc()
        for r in rows:
            if cond(r):
                (s if r['storm'] else n).add(r['adj'])
        if s.n >= 50 and n.n >= 50:
            diff = s.mean() - n.mean(); ci = 1.96 * math.sqrt(s.var_of_mean() + n.var_of_mean())
            md.append(f'| {title} | {s.n + n.n:,} | {100 * s.n / (s.n + n.n):.0f}% | **{100 * diff:+.1f} ± {100 * ci:.1f}** |')
    md += ['', '## Reading this honestly\n',
           '- Conditions are measured at move 12, but the storm is chosen over the next 13 moves, so "benefit" mixes the plan with the player who chose it. Stronger players pick plans better, which the rating adjustment only partly removes.',
           '- "Attackers" count pieces that attack a square next to the king right now, not pieces that could get there in two moves.',
           '- Margins are 95%. A benefit smaller than its margin is not a finding.', '']
    with open(a.out, 'w', encoding='utf-8') as f:
        f.write('\n'.join(md))
    print('\n'.join(md))


if __name__ == '__main__':
    sys.exit(main())
