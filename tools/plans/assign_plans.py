"""Plans lab: give new engine lines a plan from the 24 groups found by plan_clusters.py (nearest group centre).

    python tools/plans/assign_plans.py ENGINE_LABELS.jsonl.gz --model lab/plans/out/plan-clusters-model.pkl --out assign.jsonl.gz
"""
import argparse
import gzip
import json
import os
import pickle
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from plan_clusters import PARTS, line_features  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('labels', nargs='+')
    ap.add_argument('--model', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    m = pickle.load(open(a.model, 'rb'))
    mu, sd, centers = m['mu'], m['sd'], m['centers']
    n = 0
    with gzip.open(a.out, 'wt', encoding='utf-8') as out:
        for path in a.labels:
            for line in gzip.open(path, 'rt', encoding='utf-8'):
                r = json.loads(line)
                if not r.get('line') or not r.get('z'):
                    continue
                try:
                    lf, _ = line_features(r['fen'], r['line'])
                except ValueError:
                    continue
                z = [max(-3, min(3, r['z'].get(p, 0.0))) for p in PARTS]
                x = (np.concatenate([np.array(z) * 0.6, lf]) - mu) / sd
                g = int(np.argmin(((centers - x) ** 2).sum(1)))
                out.write(json.dumps({'fen': r['fen'], 'uci': r['uci'], 'group': g}) + '\n')
                n += 1
    print(f'{n:,} lines given a plan -> {a.out}')


if __name__ == '__main__':
    sys.exit(main())
