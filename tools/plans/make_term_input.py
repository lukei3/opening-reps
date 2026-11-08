"""Plans lab: the positions (and moves) to measure with Stockfish 11's evaluation parts.

Two kinds of row, positions and moves only (no comment text, so the file can live in the repo):
  * labelled moves from the expert sets, the books, Wikibooks and a sample of commented moves, so the engine's view can be
    compared with what people said;
  * King's Indian positions from real games (moves 8 to 25) with no move given, for which the engine's three best moves are
    measured; these give the volume.

    python tools/plans/make_term_input.py CORPUS.jsonl.gz BOOKS.jsonl WIKIBOOKS.jsonl GAMES... --kid 40000 --out lab/plans/data/terms-input.jsonl.gz
"""
import argparse
import collections
import gzip
import json
import random
import sys

import chess


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('corpus')
    ap.add_argument('books')
    ap.add_argument('wikibooks')
    ap.add_argument('games', nargs='+')
    ap.add_argument('--kid', type=int, default=40000)
    ap.add_argument('--per-comment-source', type=int, default=8000)
    ap.add_argument('--positions', default='lab/plans/data/kid-positions.json')
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    rnd = random.Random(4)
    rows, per = [], collections.Counter()

    def add(src, fen, uci):
        rows.append({'id': f'{src}:{len(rows)}', 'fen': fen, 'uci': uci})

    for line in gzip.open(a.corpus, 'rt', encoding='utf-8'):
        r = json.loads(line)
        if r['trust'] == 'expert' and r['labels'] and r['best'] is not False:
            add(r['src'], r['fen'], r['uci'])
        elif r['trust'] == 'comment' and r['labels'] and per[r['src']] < a.per_comment_source and rnd.random() < 0.5:
            per[r['src']] += 1
            add(r['src'], r['fen'], r['uci'])
    for path in (a.books, a.wikibooks):
        for line in open(path, encoding='utf-8'):
            r = json.loads(line)
            add(r['src'], r['fen'], r['uci'])
    for p in json.load(open(a.positions, encoding='utf-8')):
        add('kid-app', p['fen'], None)
    games = []
    for p in a.games:
        for line in gzip.open(p, 'rt', encoding='utf-8'):
            games.append(line)
    rnd.shuffle(games)
    n = 0
    for line in games:
        if n >= a.kid:
            break
        g = json.loads(line)
        mv = g['moves'].split()
        if len(mv) < 52:
            continue
        stop = rnd.randint(16, 50)
        b = chess.Board()
        try:
            for san in mv[:stop]:
                b.push_san(san)
        except ValueError:
            continue
        add('kid-games', b.fen(), None)
        n += 1
    rnd.shuffle(rows)
    with gzip.open(a.out, 'wt', encoding='utf-8') as f:
        for r in rows:
            f.write(json.dumps(r, separators=(',', ':')) + '\n')
    c = collections.Counter(r['id'].split(':')[0] for r in rows)
    print(f'{len(rows):,} rows -> {a.out}: {dict(c)}')


if __name__ == '__main__':
    sys.exit(main())
