"""Plans lab demo (private, never published): build the quiz cases.

Takes real games from months the model never trained on, asks the model (trained on January to September) whether each
side will push pawns at the enemy king over moves 13 to 25, and keeps what really happened so you can check it.

    python lab/plans/demo/build_cases.py table.npz kid-2023-10.jsonl.gz kid-2023-11.jsonl.gz kid-2023-12.jsonl.gz --out lab/plans/demo/cases.json
"""
import argparse
import gzip
import json
import os
import random
import sys

import chess
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', '..', 'tools', 'plans'))
import features  # noqa: E402
import ml_plans  # noqa: E402
from plan_stats import label_plan  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('table')
    ap.add_argument('games', nargs='+')
    ap.add_argument('--out', required=True)
    ap.add_argument('--cases', type=int, default=160)
    ap.add_argument('--seed', type=int, default=7)
    a = ap.parse_args()
    rnd = random.Random(a.seed)

    from sklearn.ensemble import HistGradientBoostingClassifier
    d = np.load(a.table, allow_pickle=False)
    train = d['month'] < 9
    print(f'training on {train.sum():,} rows ...', flush=True)
    model = HistGradientBoostingClassifier(max_iter=250, learning_rate=0.08, max_leaf_nodes=31, early_stopping=True, random_state=0)
    model.fit(d['X'][train], d['y'][train])

    lines = []
    for p in a.games:
        for line in gzip.open(p, 'rt', encoding='utf-8'):
            lines.append(line)
    rnd.shuffle(lines)
    pool = {0: [], 1: []}
    for line in lines:
        g = json.loads(line)
        if g['plies'] < 50:
            continue
        rows = ml_plans.process(line)
        if not rows:
            continue
        f = features.process(line)
        if not f:
            continue
        for vec, lab, month, opening, white in rows:
            if len(pool[lab]) >= a.cases * 2:
                continue
            side = 'w' if white else 'b'
            enemy = 'b' if white else 'w'
            castled = {k: (c[0] if c and c[1] <= 12 else None) for k, c in f['castle'].items()}
            counts = {w: sum(1 for m in f['pawn_moves'][side][w] if 12 < m <= 25) for w in 'QCK'}
            plan = label_plan(counts, castled[enemy], 2)
            board = chess.Board()
            for san in g['moves'].split()[:24]:
                board.push_san(san)
            pool[lab].append({'vec': vec, 'case': {
                'id': g['id'], 'side': side, 'fen': board.fen(), 'moves': g['moves'].split()[:50],
                'white': g['w'], 'black': g['b'], 'speed': g['speed'], 'opening': g['opening'],
                'target': castled[enemy], 'own_castle': castled[side], 'actual': lab, 'plan': plan, 'counts': counts}})
        if all(len(v) >= a.cases * 2 for v in pool.values()):
            break
    half = a.cases // 2
    picked = pool[1][:half] + pool[0][:half]
    probs = model.predict_proba(np.array([p['vec'] for p in picked], dtype=np.float32))[:, 1]
    cases = []
    for p, pr in zip(picked, probs):
        c = p['case']; c['model'] = round(float(pr), 3)
        cases.append(c)
    rnd.shuffle(cases)
    acc = np.mean([(c['model'] >= 0.5) == bool(c['actual']) for c in cases])
    print(f'{len(cases)} cases, half attack. The model gets {acc * 100:.0f}% of them right at a 50% threshold.')
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(cases, f, separators=(',', ':'))


if __name__ == '__main__':
    sys.exit(main())
