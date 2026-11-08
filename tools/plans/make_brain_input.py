"""Plans lab: the (position, move) pairs to run through Maia-2 and Leela. Positions and moves only, no comment text.

Every labelled move we train or test on (expert sets, books, Wikibooks, a capped sample of commented moves) plus every move
shown in the app's Ideas view. The id is "position|move", so the features can be joined back to any source.

    python tools/plans/make_brain_input.py CORPUS.jsonl.gz BOOKS.jsonl WIKIBOOKS.jsonl --ideas data/plans/ideas.json --out lab/plans/data/brain-input.jsonl.gz
"""
import argparse
import collections
import gzip
import json
import random
import sys


def key(fen, uci):
    return ' '.join(fen.split()[:4]) + '|' + uci


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('corpus')
    ap.add_argument('books')
    ap.add_argument('wikibooks')
    ap.add_argument('--ideas', default='data/plans/ideas.json')
    ap.add_argument('--per-comment-source', type=int, default=40000)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    seen, rows, per = set(), [], collections.Counter()

    def add(fen, uci, src):
        k = key(fen, uci)
        if k in seen:
            return
        seen.add(k)
        rows.append({'id': k, 'fen': fen, 'uci': uci})
        per[src] += 1

    for line in gzip.open(a.corpus, 'rt', encoding='utf-8'):
        r = json.loads(line)
        if r['trust'] == 'expert' and r['labels'] and r['best'] is not False:
            add(r['fen'], r['uci'], r['src'])
        elif r['trust'] == 'comment' and r['labels'] and per[r['src']] < a.per_comment_source:
            add(r['fen'], r['uci'], r['src'])
    for path in (a.books, a.wikibooks):
        for line in open(path, encoding='utf-8'):
            r = json.loads(line)
            add(r['fen'], r['uci'], r['src'])
    for p in json.load(open(a.ideas, encoding='utf-8'))['positions']:
        for g in p['ideas']:
            for m in g['moves']:
                add(p['fen'], m['uci'], 'ideas-view')
    random.Random(6).shuffle(rows)
    with gzip.open(a.out, 'wt', encoding='utf-8') as f:
        for r in rows:
            f.write(json.dumps(r, separators=(',', ':')) + '\n')
    print(f'{len(rows):,} moves -> {a.out}: {dict(per)}')


if __name__ == '__main__':
    sys.exit(main())
