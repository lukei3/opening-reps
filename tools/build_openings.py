"""Build data/openings.json: position -> [ECO code, opening name].

Source: https://github.com/lichess-org/chess-openings (a.tsv ... e.tsv), CC0 / public domain.

    python tools/build_openings.py <folder holding a.tsv ... e.tsv>

Keys are the first four fields of the FEN (pieces, side to move, castling, en passant), so a name is found
however the position was reached. Needs:  pip install chess
"""
import csv
import io
import json
import os
import sys

import chess
import chess.pgn


def key(board):
    return ' '.join(board.fen(en_passant='legal').split(' ')[:4])


def main():
    src = sys.argv[1]
    out = {}
    longest = {}
    for letter in 'abcde':
        with open(os.path.join(src, f'{letter}.tsv'), encoding='utf-8') as f:
            for row in csv.DictReader(f, delimiter='\t'):
                game = chess.pgn.read_game(io.StringIO(row['pgn']))
                board = game.board()
                for mv in game.mainline_moves():
                    board.push(mv)
                k = key(board)
                n = len(row['pgn'])
                # if two named lines reach one position, keep the one with the longer move text (the more specific name)
                if k not in out or n > longest[k]:
                    out[k] = [row['eco'], row['name']]
                    longest[k] = n
    dest = os.path.join(os.path.dirname(__file__), '..', 'data')
    os.makedirs(dest, exist_ok=True)
    with open(os.path.join(dest, 'openings.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(out)} named positions written')


if __name__ == '__main__':
    main()
