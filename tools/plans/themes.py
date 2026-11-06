"""Plans lab: mine opening themes from whole games.

For the biggest structures at move 12 it finds what keeps recurring over the next 13 moves, per side:
  * piece manoeuvres (the same piece moving two or three times in a row, e.g. N f6-d7-c5),
  * pawn pushes (which square, how often, and when),
  * exchanges (what is traded where),
  * where each kind of piece stands at move 20,
and for each item how often it happens and how games that contain it score compared with those that do not.

    python tools/plans/themes.py features.jsonl.gz games-*.jsonl.gz --out lab/plans/out/kid-themes
"""
import argparse
import collections
import concurrent.futures as cf
import gzip
import json
import math
import os
import statistics
import sys

import chess

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from plan_stats import describe_centre, expected_white, score_white  # noqa: E402

TOP, START, END = 6, 13, 25
_info = {}


def _init(info):
    _info.update(info)


def sq_name(s):
    return chess.square_name(s)


def process(line):
    g = json.loads(line)
    key = _info.get(g['id'])
    if key is None or g['plies'] < END * 2:
        return None
    board = chess.Board()
    ids = {s: s for s in chess.SQUARES if board.piece_at(s)}          # square -> piece id (its starting square)
    kind = {s: board.piece_at(s) for s in ids}
    log = {True: collections.defaultdict(list), False: collections.defaultdict(list)}     # colour -> pid -> [(move_no, from, to)]
    pushes = {True: {}, False: {}}
    exch = {True: set(), False: set()}
    lost = {True: set(), False: set()}                                    # pids captured by move 25 (own colour)
    place20 = {True: [], False: []}
    try:
        for ply, san in enumerate(g['moves'].split()[:END * 2]):
            mv = board.parse_san(san)
            color = board.turn
            no = ply // 2 + 1
            piece = board.piece_at(mv.from_square)
            pid = ids.pop(mv.from_square)
            cap_sq = None
            if board.is_en_passant(mv):
                cap_sq = chess.square(chess.square_file(mv.to_square), chess.square_rank(mv.from_square))
            elif board.is_capture(mv):
                cap_sq = mv.to_square
            captured = board.piece_at(cap_sq) if cap_sq is not None else None
            if cap_sq is not None:
                cid = ids.pop(cap_sq)
                lost[not color].add(cid)
                if no >= START:
                    exch[color].add(f'{chess.piece_symbol(piece.piece_type).upper()}x{chess.piece_symbol(captured.piece_type).upper()} on {sq_name(mv.to_square)}')
            if board.is_castling(mv):
                r = chess.square_rank(mv.from_square)
                rf, rt = (chess.square(7, r), chess.square(5, r)) if chess.square_file(mv.to_square) == 6 else (chess.square(0, r), chess.square(3, r))
                ids[rt] = ids.pop(rf)
            ids[mv.to_square] = pid
            if no >= START:
                log[color][pid].append((no, mv.from_square, mv.to_square, piece.piece_type))
                if piece.piece_type == chess.PAWN and not captured:
                    pushes[color].setdefault(sq_name(mv.to_square), no)
            board.push(mv)
            if ply == 39:
                for sq, p in board.piece_map().items():
                    if p.piece_type in (chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN, chess.KING):
                        place20[p.color].append(f'{chess.piece_symbol(p.piece_type).upper()}{sq_name(sq)}')
    except (ValueError, KeyError):
        return None
    man = {True: set(), False: set()}
    for color in (True, False):
        for pid, steps in log[color].items():
            moves = [s for s in steps if s[3] != chess.PAWN]
            for i in range(len(moves) - 1):
                a, b = moves[i], moves[i + 1]
                letter = chess.piece_symbol(a[3]).upper()
                man[color].add(f'{letter} {sq_name(a[1])}-{sq_name(a[2])}-{sq_name(b[2])}' if a[2] == b[1] else None)
                if i + 2 < len(moves) and moves[i + 1][2] == moves[i + 2][1] and a[2] == b[1]:
                    c = moves[i + 2]
                    man[color].add(f'{letter} {sq_name(a[1])}-{sq_name(a[2])}-{sq_name(b[2])}-{sq_name(c[2])}')
            man[color].discard(None)
        # bishops that were traded (the original bishop squares)
    traded = {c: sorted(sq_name(p) for p in lost[c] if p in (chess.C1, chess.F1, chess.C8, chess.F8) and kind[p].piece_type == chess.BISHOP) for c in (True, False)}
    s = score_white(g['res']); e = expected_white(g['w'], g['b'])
    return {'key': key, 'adj_w': s - e,
            'w': {'man': sorted(man[True]), 'pushes': pushes[True], 'exch': sorted(exch[True]), 'place': place20[True], 'traded': traded[True]},
            'b': {'man': sorted(man[False]), 'pushes': pushes[False], 'exch': sorted(exch[False]), 'place': place20[False], 'traded': traded[False]}}


class Acc:
    def __init__(self):
        self.n = 0; self.s = 0.0; self.ss = 0.0

    def add(self, x):
        self.n += 1; self.s += x; self.ss += x * x


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('features')
    ap.add_argument('games', nargs='+')
    ap.add_argument('--out', required=True)
    a = ap.parse_args()

    cnt = collections.Counter(); keyof = {}
    for line in gzip.open(a.features, 'rt', encoding='utf-8'):
        g = json.loads(line)
        if g['plies'] < END * 2 or '12' not in g['snap']:
            continue
        k = g['snap']['12']['centre_key']
        cnt[k] += 1; keyof[g['id']] = k
    top = [k for k, _ in cnt.most_common(TOP)]
    info = {i: k for i, k in keyof.items() if k in top}
    print('structures:', [describe_centre(k) for k in top], flush=True)

    def lines():
        for p in a.games:
            for line in gzip.open(p, 'rt', encoding='utf-8'):
                yield line
    rows = collections.defaultdict(list)
    with cf.ProcessPoolExecutor(max(1, (os.cpu_count() or 2) - 1), initializer=_init, initargs=(info,)) as pool:
        for r in pool.map(process, lines(), chunksize=300):
            if r:
                rows[r['key']].append(r)

    out = {'games': sum(cnt.values()), 'structures': []}
    md = ["# Opening themes mined from King's Indian games\n",
          f'Over moves {START} to {END}, from the {TOP} biggest centre structures at move 12. Share = how many of the structure\'s games contain it. '
          '"vs without" = score of games that contain it minus games that do not, in points against the rating prediction (95% margin).\n']

    def mean_ci(acc):
        m = acc.s / acc.n
        v = max(0.0, acc.ss / acc.n - m * m) / acc.n
        return m, v

    for key in top:
        rs = rows[key]
        if len(rs) < 500:
            continue
        sc = {side: [r['adj_w'] * (1 if side == 'w' else -1) for r in rs] for side in 'wb'}
        card = {'key': key, 'title': describe_centre(key), 'games': len(rs), 'sides': {}}
        md.append(f'## {describe_centre(key)} ({len(rs):,} games)\n')
        for side in ('b', 'w'):
            n = len(rs)
            tot = Acc()
            for x in sc[side]:
                tot.add(x)

            def stats(select, min_share=0.03, top_n=10):
                present = collections.defaultdict(Acc)
                for r, x in zip(rs, sc[side]):
                    for item in select(r[side]):
                        present[item].add(x)
                res = []
                for item, acc in present.items():
                    if acc.n / n < min_share or acc.n < 200:
                        continue
                    m1, v1 = mean_ci(acc)
                    absent_n = tot.n - acc.n
                    if absent_n < 100:
                        continue
                    s0, ss0 = tot.s - acc.s, tot.ss - acc.ss
                    m0 = s0 / absent_n; v0 = max(0.0, ss0 / absent_n - m0 * m0) / absent_n
                    res.append({'item': item, 'share': round(acc.n / n, 3), 'diff': round(m1 - m0, 4), 'ci': round(1.96 * math.sqrt(v1 + v0), 4), 'n': acc.n})
                res.sort(key=lambda d: -d['share'])
                return res[:top_n]

            man = stats(lambda s: s['man'], 0.012, 16)
            pushes = stats(lambda s: s['pushes'].keys(), 0.08, 10)
            when = {}
            for r in rs:
                for sq, no in r[side]['pushes'].items():
                    when.setdefault(sq, []).append(no)
            for p in pushes:
                p['median_move'] = statistics.median(when[p['item']])
            exch = stats(lambda s: s['exch'], 0.06, 10)
            traded = stats(lambda s: [f'bishop from {x} traded' for x in s['traded']], 0.05, 4)
            place = {}
            for ptype in 'NBRQK':
                counter = collections.Counter()
                for r in rs:
                    for p in r[side]['place']:
                        if p[0] == ptype:
                            counter[p[1:]] += 1
                place[ptype] = [{'sq': sq, 'share': round(c / (len(rs) * (2 if ptype in 'NBR' else 1)), 3)} for sq, c in counter.most_common(4)]
            card['sides'][side] = {'manoeuvres': man, 'pushes': pushes, 'exchanges': exch, 'traded': traded, 'placement': place}
            md.append(f"### {'Black' if side == 'b' else 'White'}\n")
            for title, rows_ in (('Piece manoeuvres', man), ('Pawn pushes (first push to that square)', pushes), ('Exchanges', exch), ('Bishops traded', traded)):
                if not rows_:
                    continue
                md += [f'**{title}**\n', '| Item | Share of games | vs without |' + (' Median move |' if title.startswith('Pawn') else ''), '|---|---|---|' + ('---|' if title.startswith('Pawn') else '')]
                for d in rows_:
                    md.append(f"| {d['item']} | {d['share'] * 100:.0f}% | {d['diff'] * 100:+.1f} ± {d['ci'] * 100:.1f} |" + (f" {d['median_move']:.0f} |" if 'median_move' in d else ''))
                md.append('')
            md.append('**Where the pieces stand at move 20** (share of games, most common squares)\n')
            for ptype, name in (('N', 'Knights'), ('B', 'Bishops'), ('R', 'Rooks'), ('Q', 'Queen'), ('K', 'King')):
                md.append(f"- {name}: " + ', '.join(f"{d['sq']} {d['share'] * 100:.0f}%" for d in place[ptype]))
            md.append('')
        out['structures'].append(card)
    with open(a.out + '.md', 'w', encoding='utf-8') as f:
        f.write('\n'.join(md))
    with open(a.out + '.json', 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print('\n'.join(md[:140]))


if __name__ == '__main__':
    sys.exit(main())
