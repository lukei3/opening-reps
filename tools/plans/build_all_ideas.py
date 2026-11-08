"""Plans lab: ideas for the common positions of every opening (data/plans/ideas/sNNN.json).

Takes the engine lines measured for the 1.5-billion-game book's opening-to-middlegame positions (engine_terms.py output),
keeps the moves within half a pawn of the best, names each move's idea with the namer, checks the label fits the move or a
later move in the line (build_ideas.place_idea), and writes the result split into 256 files by the same position hash as the
opening book, so the app only loads the small file it needs.

    python tools/plans/build_all_ideas.py MODEL.pkl terms-*.jsonl --out data/plans/ideas
"""
import argparse
import collections
import json
import os
import pickle
import sys

import chess
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import namer2  # noqa: E402
from build_ideas import NAMES, SURE, place_idea  # noqa: E402

SHARDS = 256
GOOD_CP = 50


def shard_of(key, n=SHARDS):
    h = 5381
    for ch in key.encode('utf-8'):
        h = ((h * 33) ^ ch) & 0xFFFFFFFF
    return h % n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('model')
    ap.add_argument('terms', nargs='+')
    ap.add_argument('--out', required=True)
    ap.add_argument('--brain', nargs='*', default=[])
    ap.add_argument('--engine-labels', default='')
    a = ap.parse_args()
    m = pickle.load(open(a.model, 'rb'))
    if m.get('learned'):
        namer2.load_learned(a.brain, a.engine_labels)
    ideas, models = m['ideas'], m['models']
    lines = collections.defaultdict(list)
    for p in a.terms:
        for raw in open(p, encoding='utf-8'):
            r = json.loads(raw)
            if r.get('cp') is None or not r.get('line'):
                continue
            lines[r['fen']].append(r)
    shards = collections.defaultdict(dict)
    use = collections.Counter()
    for fen, ls in lines.items():
        board = chess.Board(fen)
        best = max(l['cp'] for l in ls)                     # scores here are from the side to move
        good = [l for l in ls if best - l['cp'] <= GOOD_CP]
        feats = [(l, namer2.features(fen, l['uci'])) for l in good]
        feats = [(l, x) for l, x in feats if x is not None]
        if not feats:
            continue
        X = np.array([x for _, x in feats], dtype=float)
        P = np.column_stack([models[i].predict_proba(X)[:, 1] for i in ideas])
        groups = collections.OrderedDict()
        sign = 1 if board.turn == chess.WHITE else -1
        for (l, _), prow in zip(feats, P):
            order = np.argsort(-prow)
            idea, p = ideas[order[0]], float(prow[order[0]])
            prepares = None
            if p < SURE:
                idea = 'unclear'
            else:
                idea, prepares = place_idea(board, l['line'], idea)
            b = board.copy(); sans = []
            for u in l['line'][:8]:
                mv = chess.Move.from_uci(u)
                if mv not in b.legal_moves:
                    break
                sans.append(b.san(mv)); b.push(mv)
            g = groups.setdefault(idea, {'theme': idea, 'name': 'No clear idea (the namer is not sure)' if idea == 'unclear' else NAMES.get(idea, idea), 'moves': []})
            g['moves'].append({'san': sans[0] if sans else l['uci'], 'uci': l['uci'], 'cp': sign * l['cp'], 'conf': round(p, 2), 'pv': sans, 'prepares': prepares})
            use[idea] += 1
        if 'unclear' in groups:
            groups.move_to_end('unclear')
        key = ' '.join(fen.split()[:4])
        shards[shard_of(key)][key] = {'fen': fen, 'side': 'w' if board.turn == chess.WHITE else 'b', 'best_cp': sign * best,
                                      'games': 0, 'ideas': list(groups.values()), 'played': []}
    os.makedirs(a.out, exist_ok=True)
    for s, d in shards.items():
        with open(os.path.join(a.out, f's{s:03d}.json'), 'w', encoding='utf-8') as f:
            json.dump(d, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{sum(len(d) for d in shards.values()):,} positions in {len(shards)} files -> {a.out}')
    print(dict(use.most_common()))


if __name__ == '__main__':
    sys.exit(main())
