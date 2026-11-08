"""Plans lab: find recurring plans without labels.

Each measured engine line (engine_terms.py) is described by what it changes (Stockfish 11's evaluation parts, as z-scores
from the mover's side) and by what the mover does in it (which pieces move, to which wing, how far forward, pawn moves by
wing, captures, castling). Lines are grouped with k-means; each group is then described by its strongest changes, its typical
moves and, where people commented on the same moves, the words they used.

    python tools/plans/plan_clusters.py ENGINE_LABELS.jsonl.gz --corpus CORPUS.jsonl.gz BOOKS.jsonl --k 24 --out lab/plans/out/plan-clusters.md --json lab/plans/out/plan-clusters.json
"""
import argparse
import collections
import gzip
import json
import sys

import chess
import numpy as np

PARTS = ['Mobility', 'King safety:own', 'King safety:opp', 'Pawns', 'Passed', 'Space', 'Threats', 'Knights', 'Bishops', 'Rooks',
         'Material', 'Imbalance', 'Initiative']
WING = lambda f: 0 if f <= 2 else (1 if f <= 4 else 2)
PIECE = {chess.PAWN: 'P', chess.KNIGHT: 'N', chess.BISHOP: 'B', chess.ROOK: 'R', chess.QUEEN: 'Q', chess.KING: 'K'}


def line_features(fen, line):
    b = chess.Board(fen)
    me = b.turn
    f = np.zeros(6 + 3 + 3 + 4)
    words = []
    for k, u in enumerate(line[:8]):
        mv = chess.Move.from_uci(u)
        if mv not in b.legal_moves:
            break
        if b.turn == me:
            pt = b.piece_type_at(mv.from_square)
            f[pt - 1] += 1
            f[6 + WING(chess.square_file(mv.to_square))] += 1
            if pt == chess.PAWN:
                f[9 + WING(chess.square_file(mv.to_square))] += 1
            if b.is_capture(mv):
                f[12] += 1
            if b.is_castling(mv):
                f[13] += 1
            adv = chess.square_rank(mv.to_square) if me == chess.WHITE else 7 - chess.square_rank(mv.to_square)
            f[14] += adv / 7
            if k < 6:
                words.append(PIECE[pt] + chess.square_name(mv.to_square))
        else:
            if b.is_capture(mv):
                f[15] += 1
        b.push(mv)
    return f, words


def main():
    from sklearn.cluster import KMeans
    ap = argparse.ArgumentParser()
    ap.add_argument('labels')
    ap.add_argument('--corpus', nargs='+', default=[])
    ap.add_argument('--k', type=int, default=24)
    ap.add_argument('--out', required=True)
    ap.add_argument('--json', required=True)
    a = ap.parse_args()
    rows, X, moves = [], [], []
    for line in gzip.open(a.labels, 'rt', encoding='utf-8'):
        r = json.loads(line)
        if not r.get('line') or not r.get('z'):
            continue
        z = [max(-3, min(3, r['z'].get(p, 0.0))) for p in PARTS]
        try:
            lf, words = line_features(r['fen'], r['line'])
        except ValueError:
            continue
        rows.append(r); X.append(np.concatenate([np.array(z) * 0.6, lf])); moves.append(words)
    X = np.array(X)
    mu, sd = X.mean(0), X.std(0) + 1e-6
    X = (X - mu) / sd
    km = KMeans(a.k, n_init=4, random_state=0).fit(X)
    import pickle
    with open(a.json.replace('.json', '-model.pkl'), 'wb') as fh:
        pickle.dump({'mu': mu, 'sd': sd, 'centers': km.cluster_centers_, 'parts': PARTS}, fh)
    with gzip.open(a.json.replace('.json', '-assign.jsonl.gz'), 'wt', encoding='utf-8') as fh:
        for r, c in zip(rows, km.labels_):
            fh.write(json.dumps({'fen': r['fen'], 'uci': r['uci'], 'group': int(c)}) + '\n')
    human = {}
    for p in a.corpus:
        op = gzip.open if p.endswith('.gz') else open
        with op(p, 'rt', encoding='utf-8') as fh:
            for line in fh:
                h = json.loads(line)
                if h['labels']:
                    human[(' '.join(h['fen'].split()[:4]), h['uci'])] = h['labels']
    clusters = []
    for c in range(a.k):
        idx = np.where(km.labels_ == c)[0]
        zs = np.array([[max(-3, min(3, rows[i]['z'].get(p, 0.0))) for p in PARTS] for i in idx])
        mean_z = zs.mean(0)
        top = [PARTS[j] for j in np.argsort(-mean_z)[:3] if mean_z[j] > 0.2]
        low = [PARTS[j] for j in np.argsort(mean_z)[:2] if mean_z[j] < -0.2]
        mv = collections.Counter(w for i in idx for w in set(moves[i]))
        hl = collections.Counter(l for i in idx for l in human.get((' '.join(rows[i]['fen'].split()[:4]), rows[i]['uci']), []))
        ex = rows[idx[0]]
        clusters.append({'id': c, 'size': int(len(idx)), 'improves': top, 'gives_up': low,
                         'typical_moves': [w for w, _ in mv.most_common(8)],
                         'human_words': [w for w, _ in hl.most_common(5)], 'example': {'fen': ex['fen'], 'line': ex['line']}})
    clusters.sort(key=lambda c: -c['size'])
    md = ['# Recurring plans found without labels\n',
          f'{len(rows):,} engine lines grouped into {a.k} kinds by what they change (Stockfish 11 evaluation parts) and what the side does (which pieces move, where, pawn moves by wing, trades). "Improves" and "gives up" are the evaluation parts that rise or fall most in that group; "people called it" lists the human labels on moves in the group, where there are any.\n',
          '| Group | Lines | Improves | Gives up | Typical moves | People called it |', '|---|---|---|---|---|---|']
    for c in clusters:
        md.append(f"| {c['id']} | {c['size']:,} | {', '.join(c['improves']) or '-'} | {', '.join(c['gives_up']) or '-'} | {' '.join(c['typical_moves'][:6])} | {', '.join(c['human_words'][:4]) or '-'} |")
    with open(a.out, 'w', encoding='utf-8') as f:
        f.write('\n'.join(md) + '\n')
    with open(a.json, 'w', encoding='utf-8') as f:
        json.dump(clusters, f, separators=(',', ':'))
    print('\n'.join(md))


if __name__ == '__main__':
    sys.exit(main())
