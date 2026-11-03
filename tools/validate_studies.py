"""Check the study files in data/studies/: every move must be legal, and (optionally) it is compared with how often
real players choose it in the opening book, so a line nobody plays stands out.

    python tools/validate_studies.py [book folder]

Works with the old dense book layout and the newer sparse one (all counts are simply added up).
"""
import glob
import io
import json
import os
import sys

import chess
import chess.pgn

HERE = os.path.dirname(os.path.abspath(__file__))
STUDIES = os.path.join(HERE, '..', 'data', 'studies')


def shard_of(key, n):
    h = 5381
    for b in key.encode():
        h = ((h * 33) & 0xFFFFFFFF) ^ b
    return h % n


class Book:
    def __init__(self, folder):
        self.folder = folder
        self.meta = json.load(open(os.path.join(folder, 'meta.json'), encoding='utf-8'))
        self.cache = {}
        self.sparse = self.meta.get('layout') == 'sparse'

    def rows(self, board):
        key = ' '.join(board.fen(en_passant='legal').split(' ')[:4])
        i = shard_of(key, self.meta['shards'])
        if i not in self.cache:
            self.cache[i] = json.load(open(os.path.join(self.folder, f's{i:02d}.json'), encoding='utf-8'))
        out = {}
        for row in self.cache[i].get(key, []):
            out[row[0]] = sum(row[2::2]) if self.sparse else sum(row[1:])
        return out


def walk(node, board, book, path, problems, stats):
    for child in node.variations:
        san = board.san(child.move)
        here = path + [san]
        if book:
            rows = book.rows(board)
            total = sum(rows.values())
            n = rows.get(san, 0)
            share = 100 * n / total if total else None
            stats['moves'] += 1
            if total >= 2000 and share is not None and share < 1.0:
                top = ', '.join(f'{s} {100 * g / total:.0f}%' for s, g in sorted(rows.items(), key=lambda kv: -kv[1])[:3])
                problems.append(f'  rare ({share:.2f}%): {" ".join(here)}   | usual: {top}')
        board.push(child.move)
        walk(child, board, book, here, problems, stats)
        board.pop()


def main():
    book = Book(sys.argv[1]) if len(sys.argv) > 1 else None
    bad = 0
    for path in sorted(glob.glob(os.path.join(STUDIES, '*.pgn'))):
        text = open(path, encoding='utf-8').read()
        stream = io.StringIO(text)
        print(os.path.basename(path))
        while True:
            game = chess.pgn.read_game(stream)
            if game is None:
                break
            name = game.headers.get('ChapterName', '?')
            errors = [str(e) for e in game.errors]
            problems, stats = [], {'moves': 0}
            walk(game, game.board(), book, [], problems, stats)
            leaves = sum(1 for _ in _leaves(game))
            print(f'  {name}: {leaves} lines, {stats["moves"]} moves checked' + (' - ILLEGAL: ' + '; '.join(errors) if errors else ''))
            for p in problems:
                print(p)
            bad += len(errors)
    return 1 if bad else 0


def _leaves(node):
    if not node.variations:
        yield node
    for c in node.variations:
        yield from _leaves(c)


if __name__ == '__main__':
    sys.exit(main())
