"""Plans lab: which ideas go wrong most often in real games?

Names the idea behind 30,000 real mistakes (moves where Lichess's own engine evaluation dropped by 1.5 pawns or more) and
behind 30,000 good engine moves from the same games' positions, then compares: an idea that is twice as common among
mistakes as among good moves is a risky one, worth a warning when it is suggested.

    python tools/plans/risky_ideas.py MODEL.pkl --swings swings-*.jsonl.gz --terms terms-*.jsonl --out lab/plans/out/risky-ideas
"""
import argparse
import collections
import gzip
import json
import math
import os
import pickle
import random
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import namer2  # noqa: E402
from build_ideas import NAMES, SURE  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('model')
    ap.add_argument('--swings', nargs='+', required=True)
    ap.add_argument('--terms', nargs='+', required=True)
    ap.add_argument('--n', type=int, default=30000)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    rnd = random.Random(3)
    m = pickle.load(open(a.model, 'rb'))
    ideas, models, thr = m['ideas'], m['models'], m.get('thresholds', {})
    bad = [json.loads(l) for p in a.swings for l in gzip.open(p, 'rt')]
    rnd.shuffle(bad)
    good = []
    for p in a.terms:
        by = collections.defaultdict(list)
        for l in open(p, encoding='utf-8'):
            r = json.loads(l)
            if r.get('cp') is not None:
                by[r['fen']].append(r)
        for fen, ls in by.items():
            best = max(x['cp'] for x in ls)
            good += [{'fen': fen, 'uci': x['uci']} for x in ls if best - x['cp'] <= 50]
    rnd.shuffle(good)

    def name_all(rows):
        feats = [(r, namer2.features(r['fen'], r['uci'])) for r in rows]
        feats = [(r, x) for r, x in feats if x is not None][:a.n]
        X = np.array([x for _, x in feats], dtype=float)
        P = np.column_stack([models[i].predict_proba(X)[:, 1] for i in ideas])
        c = collections.Counter()
        for row in P:
            k = int(row.argmax())
            c[ideas[k] if row[k] >= thr.get(ideas[k], SURE) else 'unclear'] += 1
        return c, len(X)

    cb, nb = name_all(bad[:a.n * 2])
    cg, ng = name_all(good[:a.n * 2])
    rows = []
    for idea in sorted(set(cb) | set(cg)):
        pb, pg = cb[idea] / nb, cg[idea] / ng
        if cb[idea] + cg[idea] < 60 or idea == 'unclear':
            continue
        ratio = (pb + 1e-6) / (pg + 1e-6)
        se = math.sqrt(1 / max(cb[idea], 1) + 1 / max(cg[idea], 1))
        rows.append({'idea': idea, 'name': NAMES.get(idea, idea), 'mistakes': cb[idea], 'good': cg[idea], 'ratio': round(ratio, 2),
                     'low': round(ratio * math.exp(-1.96 * se), 2), 'high': round(ratio * math.exp(1.96 * se), 2)})
    rows.sort(key=lambda r: -r['ratio'])
    md = ['# Which ideas go wrong most often?\n',
          f'{nb:,} real mistakes (Lichess engine evaluation dropped 1.5 pawns or more; players 1500 to 2500, every opening, 2024) and {ng:,} good engine moves from the same months, each named by the idea namer. "Risk" is how much more common the idea is among mistakes than among good moves (1.0 = no difference), with a 95% range.\n',
          '| Idea | Among mistakes | Among good moves | Risk | 95% range |', '|---|---|---|---|---|']
    md += [f"| {r['name']} | {r['mistakes']:,} | {r['good']:,} | **{r['ratio']}x** | {r['low']} to {r['high']} |" for r in rows]
    md += ['', 'The namer labels what a move tries to do; it does not know the move failed. A high risk means players who try that idea go badly wrong more often than players who try other ideas, so the app shows a warning next to it.', '']
    open(a.out + '.md', 'w', encoding='utf-8').write('\n'.join(md))
    json.dump({r['idea']: r for r in rows}, open(a.out + '.json', 'w', encoding='utf-8'), separators=(',', ':'))
    print('\n'.join(md))


if __name__ == '__main__':
    sys.exit(main())
