"""Plans lab, step 6: build the data the app's Plans tab shows (data/plans/kid.json).

For the biggest centre structures at move 12 it collects, from the 480,000 games and the engine sample:
  * a real, typical position (the most common one in that structure) and the moves that led to it,
  * for each side and each plan: how often it is played, how it scores against the rating prediction, how the engine's
    evaluation moved by move 25, and the pawn pushes real players make for that plan (drawn as arrows).

    python tools/plans/build_cards.py features.jsonl.gz games-*.jsonl.gz --evals evals-*.jsonl --out data/plans/kid.json
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
from plan_stats import Cell, describe_centre, expected_white, label_plan, score_white  # noqa: E402
from features import WING  # noqa: E402

AT, UNTIL, MIN_MOVES, TOP = 12, 25, 2, 6
PLAN_ORDER = ['attack on their king', 'play on the other wing', 'central play', 'quiet']
HUMAN = {
    'attack on their king': 'Storm the enemy king with pawns',
    'play on the other wing': 'Play on the other side of the board',
    'central play': 'Break open the centre',
    'quiet': 'No pawn plan: improve the pieces',
}

_info = {}


def _init(info):
    _info.update(info)


def replay(line):
    g = json.loads(line)
    t = _info.get(g['id'])
    if t is None:
        return None
    board = chess.Board()
    sans, pushes = [], {'w': collections.Counter(), 'b': collections.Counter()}
    fen = last = None
    try:
        for ply, san in enumerate(g['moves'].split()[:UNTIL * 2]):
            move = board.parse_san(san)
            side = 'w' if board.turn == chess.WHITE else 'b'
            no = ply // 2 + 1
            if AT < no <= UNTIL and board.piece_type_at(move.from_square) == chess.PAWN and not board.is_capture(move):
                pushes[side][move.uci()] += 1
            if no <= AT:
                sans.append(san)
            board.push(move)
            if ply == AT * 2 - 1:
                fen = board.fen()
                last = move.uci()
    except ValueError:
        return None
    return {'id': g['id'], 'fen': fen, 'last': last, 'sans': sans,
            'pushes': {s: list(c) for s, c in pushes.items()}, 'key': t['key'], 'plans': t['plans']}


def verdict(vs, ci):
    if ci is None or abs(vs) <= ci:
        return 'no clear difference from what the ratings predict'
    return f'scores {abs(vs) * 100:.1f} points {"better" if vs > 0 else "worse"} than the ratings predict'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('features')
    ap.add_argument('games', nargs='+')
    ap.add_argument('--evals', nargs='*', default=[])
    ap.add_argument('--out', required=True)
    a = ap.parse_args()

    # pass 1: plans and results for every game that reaches move 25
    rows, cnt = [], collections.Counter()
    for line in gzip.open(a.features, 'rt', encoding='utf-8'):
        g = json.loads(line)
        if g['plies'] < UNTIL * 2 or str(AT) not in g['snap']:
            continue
        castled = {k: (c[0] if c and c[1] <= AT else None) for k, c in g['castle'].items()}
        plans = {}
        for k in ('w', 'b'):
            counts = {w: sum(1 for m in g['pawn_moves'][k][w] if AT < m <= UNTIL) for w in 'QCK'}
            plans[k] = label_plan(counts, castled['b' if k == 'w' else 'w'], MIN_MOVES)
        key = g['snap'][str(AT)]['centre_key']
        cnt[key] += 1
        rows.append((g['id'], key, plans, g['res'], g['w'], g['b'], castled))
    n_total = len(rows)
    top = [k for k, _ in cnt.most_common(TOP)]
    print(f'{n_total:,} games reach move {UNTIL}; top structures: {[describe_centre(k) for k in top]}')

    ev = {}
    for p in a.evals:
        for line in open(p, encoding='utf-8'):
            r = json.loads(line)
            if 'e12' in r and 'e25' in r:
                ev[r['id']] = r['e25'] - r['e12']
    print(f'{len(ev):,} engine evaluations')

    stats = collections.defaultdict(Cell)            # (key, side, plan) -> results
    eng = collections.defaultdict(lambda: [0, 0.0, 0.0])   # (key, side, plan) -> n, sum, sumsq of the swing (that side's view)
    castle_eng = collections.defaultdict(lambda: [0, 0.0, 0.0])
    info = {}
    for gid, key, plans, res, w, b, castled in rows:
        s, e = score_white(res), expected_white(w, b)
        for side, (sc, ex) in (('w', (s, e)), ('b', (1 - s, 1 - e))):
            stats[(key, side, plans[side])].add(sc, ex)
            if gid in ev:
                swing = ev[gid] * (1 if side == 'w' else -1)
                for target, bucket in ((eng, (key, side, plans[side])),):
                    c = target[bucket]; c[0] += 1; c[1] += swing; c[2] += swing * swing
                same = 'same side' if castled['w'] and castled['w'] == castled['b'] else ('opposite sides' if castled['w'] and castled['b'] else 'not both castled')
                c = castle_eng[(plans[side], same)]; c[0] += 1; c[1] += swing; c[2] += swing * swing
        if key in top:
            info[gid] = {'key': key, 'plans': plans}

    # pass 2: positions and pawn pushes for the games in the top structures
    def lines():
        for p in a.games:
            for line in gzip.open(p, 'rt', encoding='utf-8'):
                yield line
    fens = collections.defaultdict(collections.Counter)
    example = {}
    pushes = collections.defaultdict(lambda: collections.Counter())    # (key, side, plan) -> uci -> games
    seen = collections.Counter()
    with cf.ProcessPoolExecutor(max(1, (os.cpu_count() or 2) - 1), initializer=_init, initargs=(info,)) as pool:
        for r in pool.map(replay, lines(), chunksize=300):
            if not r:
                continue
            f4 = ' '.join(r['fen'].split()[:4])
            fens[r['key']][f4] += 1
            example.setdefault((r['key'], f4), r)
            for side in ('w', 'b'):
                plan = r['plans'][side]
                seen[(r['key'], side, plan)] += 1
                for uci in r['pushes'][side]:
                    pushes[(r['key'], side, plan)][uci] += 1

    def ms(c):
        n, s, ss = c
        if n < 30:
            return None
        m = s / n
        sd = math.sqrt(max(0.0, ss / n - m * m))
        return {'n': n, 'cp': round(m), 'ci': round(1.96 * sd / math.sqrt(n))}

    structures = []
    for key in top:
        f4, _ = fens[key].most_common(1)[0]
        ex = example[(key, f4)]
        total = cnt[key]
        card = {'id': key, 'title': describe_centre(key), 'games': total, 'share': round(total / n_total, 3),
                'fen': ex['fen'], 'last': ex['last'], 'moves': ex['sans'], 'plans': {'w': [], 'b': []}}
        for side in ('w', 'b'):
            for plan in PLAN_ORDER:
                c = stats.get((key, side, plan))
                row = c.row() if c else None
                if not row or row['n'] < 100:
                    continue
                games_with = seen[(key, side, plan)] or 1
                # only pushes this very position allows: the pawn must be on its square and the target square empty
                shown = chess.Board(ex['fen'])
                own = chess.WHITE if side == 'w' else chess.BLACK
                def playable(u):
                    mv = chess.Move.from_uci(u)
                    return shown.piece_at(mv.from_square) == chess.Piece(chess.PAWN, own) and shown.piece_at(mv.to_square) is None
                arrows = [{'uci': u, 'share': round(k / games_with, 2)} for u, k in pushes[(key, side, plan)].most_common(12)
                          if plan != 'quiet' and k / games_with >= 0.1 and playable(u)][:3]
                e = ms(eng.get((key, side, plan), [0, 0, 0]))
                card['plans'][side].append({
                    'plan': plan, 'label': HUMAN[plan], 'n': row['n'], 'share': round(row['n'] / total, 3),
                    'score': row['score'], 'vs': row['vs_expected'], 'ci': row['ci'],
                    'verdict': verdict(row['vs_expected'], row['ci']), 'engine': e, 'arrows': arrows})
        structures.append(card)

    cm = {k: ms(v) for k, v in castle_eng.items()}
    out = {'name': "King's Indian", 'games': n_total, 'engine_games': len(ev), 'at_move': AT, 'until_move': UNTIL,
           'structures': structures,
           'castling_engine': {f'{p}|{s}': v for (p, s), v in cm.items() if v}}
    os.makedirs(os.path.dirname(a.out) or '.', exist_ok=True)
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print('wrote', a.out, os.path.getsize(a.out), 'bytes')


if __name__ == '__main__':
    sys.exit(main())
