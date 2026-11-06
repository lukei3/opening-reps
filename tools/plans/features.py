"""Plans lab, step 2: turn each whole game into numbers.

Reads the games written by extract_games.py and replays each one. For every game it records
  * the moves that matter for plans: when each side castled, and when each side's pawns moved (by wing), and
  * a snapshot of the position after moves 10, 12, 15, 20, 25 and 30: pawn structure, open files, king safety, pieces
    aimed at the enemy king, material.

    python tools/plans/features.py games1.jsonl.gz games2.jsonl.gz --out features.jsonl.gz

Wings: a, b, c files = "Q" (queenside), d, e files = "C" (centre), f, g, h files = "K" (kingside).
Nothing here is imported by the app.
"""
import argparse
import concurrent.futures as cf
import gzip
import json
import os
import sys

import chess

WING = {0: 'Q', 1: 'Q', 2: 'Q', 3: 'C', 4: 'C', 5: 'K', 6: 'K', 7: 'K'}
CHECKPOINTS = (10, 12, 15, 20, 25, 30)          # full moves: the position after Black's move number N
PIECE_LETTER = {chess.PAWN: 'P', chess.KNIGHT: 'N', chess.BISHOP: 'B', chess.ROOK: 'R', chess.QUEEN: 'Q'}
COLOUR_KEY = {chess.WHITE: 'w', chess.BLACK: 'b'}


def advance(square, color):
    """How many squares a pawn on `square` has come up from its starting rank (0 to 5)."""
    rank = chess.square_rank(square)
    return rank - 1 if color == chess.WHITE else 6 - rank


def snapshot(board):
    """Numbers describing the position for plan research."""
    snap = {}
    pawn_files = {chess.WHITE: {}, chess.BLACK: {}}
    for color in (chess.WHITE, chess.BLACK):
        k = COLOUR_KEY[color]
        wings = {'Q': [0, 0], 'C': [0, 0], 'K': [0, 0]}          # [pawns left, squares advanced]
        for sq in board.pieces(chess.PAWN, color):
            f = chess.square_file(sq)
            w = wings[WING[f]]
            w[0] += 1
            w[1] += advance(sq, color)
            best = pawn_files[color].get(f)
            if best is None or advance(sq, color) > advance(best, color):
                pawn_files[color][f] = sq
        snap['pawns_' + k] = {w: v for w, v in wings.items()}
        counts = {PIECE_LETTER[t]: len(board.pieces(t, color)) for t in PIECE_LETTER}
        snap['men_' + k] = counts
        king = board.king(color)
        snap['king_' + k] = chess.square_name(king) if king is not None else None
        # pawn shield: friendly pawns on the three files around the king, on the two ranks in front of it
        shield = 0
        if king is not None:
            kf, kr = chess.square_file(king), chess.square_rank(king)
            step = 1 if color == chess.WHITE else -1
            for df in (-1, 0, 1):
                for dr in (1, 2):
                    f, r = kf + df, kr + step * dr
                    if 0 <= f < 8 and 0 <= r < 8 and board.piece_at(chess.square(f, r)) == chess.Piece(chess.PAWN, color):
                        shield += 1
        snap['shield_' + k] = shield
    # the centre: how far the d and e pawns have advanced (0 = still home, None = gone)
    def adv(color, f):
        sq = pawn_files[color].get(f)
        return None if sq is None else advance(sq, color)
    snap['centre'] = {'w': [adv(chess.WHITE, 3), adv(chess.WHITE, 4)], 'b': [adv(chess.BLACK, 3), adv(chess.BLACK, 4)]}
    snap['centre_key'] = 'w:d{}e{}|b:d{}e{}'.format(*[('-' if x is None else x) for x in snap['centre']['w'] + snap['centre']['b']])
    # files with no pawns at all, and files open for one side only
    open_files = [f for f in range(8) if f not in pawn_files[chess.WHITE] and f not in pawn_files[chess.BLACK]]
    snap['open_files'] = ''.join(chess.FILE_NAMES[f] for f in open_files)
    snap['half_open_w'] = ''.join(chess.FILE_NAMES[f] for f in range(8) if f not in pawn_files[chess.WHITE] and f in pawn_files[chess.BLACK])
    snap['half_open_b'] = ''.join(chess.FILE_NAMES[f] for f in range(8) if f not in pawn_files[chess.BLACK] and f in pawn_files[chess.WHITE])
    # pieces aimed at the enemy king: attacks on the squares around it
    for color in (chess.WHITE, chess.BLACK):
        enemy_king = board.king(not color)
        attacks = 0
        if enemy_king is not None:
            for sq in board.attacks(enemy_king) | chess.SquareSet([enemy_king]):
                attacks += len([a for a in board.attackers(color, sq) if board.piece_type_at(a) != chess.PAWN])
        snap['king_zone_attacks_' + COLOUR_KEY[color]] = attacks
        # pieces in the enemy half of the board
        snap['advanced_pieces_' + COLOUR_KEY[color]] = sum(
            1 for sq in board.piece_map() if board.color_at(sq) == color and board.piece_type_at(sq) in (chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN)
            and (chess.square_rank(sq) >= 4 if color == chess.WHITE else chess.square_rank(sq) <= 3))
    return snap


def process(line):
    g = json.loads(line)
    board = chess.Board()
    castle = {'w': None, 'b': None}
    pawn_moves = {'w': {'Q': [], 'C': [], 'K': []}, 'b': {'Q': [], 'C': [], 'K': []}}
    snaps = {}
    try:
        for ply, san in enumerate(g['moves'].split()):
            move = board.parse_san(san)
            color = board.turn
            key = COLOUR_KEY[color]
            move_no = ply // 2 + 1
            if board.is_castling(move):
                castle[key] = ['K' if chess.square_file(move.to_square) == 6 else 'Q', move_no]
            elif board.piece_type_at(move.from_square) == chess.PAWN:
                pawn_moves[key][WING[chess.square_file(move.from_square)]].append(move_no)
            board.push(move)
            if ply % 2 == 1 and move_no in CHECKPOINTS:
                snaps[str(move_no)] = snapshot(board)
    except ValueError:
        return None
    return {
        'id': g['id'], 'res': g['res'], 'w': g['w'], 'b': g['b'], 'speed': g['speed'], 'eco': g['eco'], 'plies': g['plies'],
        'castle': castle, 'pawn_moves': pawn_moves, 'snap': snaps,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('inputs', nargs='+')
    ap.add_argument('--out', required=True)
    ap.add_argument('--workers', type=int, default=max(1, (os.cpu_count() or 2) - 1))
    ap.add_argument('--limit', type=int, default=0, help='only the first N games (for a quick test)')
    a = ap.parse_args()

    def lines():
        n = 0
        for path in a.inputs:
            for line in gzip.open(path, 'rt', encoding='utf-8'):
                yield line
                n += 1
                if a.limit and n >= a.limit:
                    return

    done = skipped = 0
    with gzip.open(a.out, 'wt', encoding='utf-8') as out, cf.ProcessPoolExecutor(a.workers) as pool:
        for row in pool.map(process, lines(), chunksize=200):
            if row is None:
                skipped += 1
                continue
            out.write(json.dumps(row, separators=(',', ':')) + '\n')
            done += 1
            if done % 20000 == 0:
                print(f'  {done:,} games done', flush=True)
    print(f'Done: {done:,} games, {skipped:,} skipped -> {a.out}')


if __name__ == '__main__':
    sys.exit(main())
