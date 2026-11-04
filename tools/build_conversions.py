"""Find real endgame positions to practise converting, in Lichess games (https://database.lichess.org, CC0).

For each decisive game with clock times, this looks for the first moment in the endgame when the eventual winner is clearly
ahead in material, and records the position, who is to move, both clocks, the time control, and how the game was won.

    python tools/build_conversions.py --url <.pgn.zst url> --games 3000000 --out candidates.jsonl

These are only candidates: the browser trainer's data step then checks each one with Stockfish and keeps the ones that
really are winning. Needs:  pip install zstandard chess
"""
import argparse
import json
import os
import re
import sys
import time

import chess

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_book import stream_url   # noqa: E402  (same folder)

VALUE = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}
LETTER = {chess.PAWN: 'P', chess.KNIGHT: 'N', chess.BISHOP: 'B', chess.ROOK: 'R', chess.QUEEN: 'Q'}
TOKEN = re.compile(r'(?:\d+\.(?:\.\.)?\s*)?([A-Za-z][A-Za-z0-9=+#\-]*)[!?]*\s*(?:\{([^}]*)\})?')
CLK = re.compile(r'\[%clk (\d+):(\d+):(\d+(?:\.\d+)?)\]')

MAX_PIECES = 8        # pieces other than kings, at the moment the position is recorded
MIN_ADVANTAGE = 3     # winner's material minus loser's (a pawn is 1)
MIN_PLY = 30
MIN_PLIES_LEFT = 12   # the game must run on at least this long, so it is a real conversion and not a mate in one


def material(board, colour):
    return sum(VALUE[p.piece_type] for p in board.piece_map().values() if p.color == colour and p.piece_type in VALUE)


def signature(board, winner):
    def side(colour):
        pieces = sorted((p.piece_type for p in board.piece_map().values() if p.color == colour and p.piece_type != chess.KING),
                        key=lambda t: -VALUE[t])
        return 'K' + ''.join(LETTER[t] for t in pieces)
    return f'{side(winner)}v{side(not winner)}'


def categories(sig):
    win, lose = sig.split('v')
    wp = [c for c in win[1:] if c != 'P']      # the pieces other than pawns
    lp = [c for c in lose[1:] if c != 'P']
    tags = []
    if 'P' in win or 'P' in lose:
        tags.append('pawns')
    if wp == ['R', 'R'] and not lp:
        tags.append('ladder')                  # two rooks against a bare king (or only pawns): the ladder mate
    if 'Q' in wp and 'Q' not in lp:
        tags.append('queen')
    if wp and set(wp) == {'R'} and set(lp) <= {'R'}:
        tags.append('rook')
    if not tags:
        tags.append('mixed')
    return tags


def seconds(clk):
    m = CLK.search(clk or '')
    return float(int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))) if m else None


def find_position(movetext, winner_white):
    """Replay a game; return a candidate dict or None."""
    moves = []
    for m in TOKEN.finditer(movetext):
        san = m.group(1)
        if san in ('1-0', '0-1', '1/2-1/2'):
            break
        moves.append((san, seconds(m.group(2))))
    if len(moves) < MIN_PLY + MIN_PLIES_LEFT:
        return None
    board = chess.Board()
    clocks = {chess.WHITE: None, chess.BLACK: None}
    winner = chess.WHITE if winner_white else chess.BLACK
    for ply, (san, clk) in enumerate(moves):
        mover = board.turn
        try:
            board.push_san(san)
        except ValueError:
            return None
        if clk is not None:
            clocks[mover] = clk
        if ply + 1 < MIN_PLY or len(moves) - (ply + 1) < MIN_PLIES_LEFT:
            continue
        pieces = len(board.piece_map()) - 2
        if pieces > MAX_PIECES:
            continue
        if material(board, winner) - material(board, not winner) >= MIN_ADVANTAGE and clocks[winner] is not None and clocks[not winner] is not None:
            if board.is_game_over():
                return None
            sig = signature(board, winner)
            return {
                'fen': board.fen(en_passant='legal'), 'winner': 'w' if winner_white else 'b', 'stm': 'w' if board.turn else 'b',
                'wc': clocks[winner], 'lc': clocks[not winner], 'sig': sig, 'cat': categories(sig),
                'plyLeft': len(moves) - (ply + 1),
            }
    return None


def games(stream, max_games, log, max_minutes):
    headers, body, seen = {}, [], 0
    t0 = time.time()
    deadline = t0 + 60 * max_minutes if max_minutes else None
    for raw in stream:
        line = raw.rstrip('\n')
        if line.startswith('['):
            if body:                       # a new game starts: the previous one is complete
                yield headers, ' '.join(body)
                headers, body = {}, []
                seen += 1
                if seen % 100000 == 0:
                    log(f'  read {seen:,} games ({seen / (time.time() - t0):,.0f}/s)')
                if seen >= max_games or (deadline and seen % 2000 == 0 and time.time() > deadline):
                    return
            m = re.match(r'\[(\w+) "(.*)"\]', line)
            if m:
                headers[m.group(1)] = m.group(2)
        elif line.strip():
            body.append(line.strip())
    if body:
        yield headers, ' '.join(body)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', required=True)
    ap.add_argument('--games', type=int, default=3_000_000, help='games to read from the start of the file')
    ap.add_argument('--max-minutes', type=float, default=0)
    ap.add_argument('--out', default='candidates.jsonl')
    ap.add_argument('--min-rating', type=int, default=1200)
    ap.add_argument('--max-per-sig', type=int, default=400, help='keep at most this many candidates per material signature')
    a = ap.parse_args()
    log = lambda m: print(m, flush=True)
    resp, text = stream_url(a.url)
    kept, per_sig = 0, {}
    with open(a.out, 'w', encoding='utf-8') as out:
        for h, body in games(text, a.games, log, a.max_minutes):
            res = h.get('Result')
            if res not in ('1-0', '0-1') or '%clk' not in body:
                continue
            we, be = h.get('WhiteElo', ''), h.get('BlackElo', '')
            if not (we.isdigit() and be.isdigit()) or min(int(we), int(be)) < a.min_rating:
                continue
            ev = h.get('Event', '')
            if 'Correspondence' in ev:
                continue
            pos = find_position(body, res == '1-0')
            if not pos or per_sig.get(pos['sig'], 0) >= a.max_per_sig:
                continue
            per_sig[pos['sig']] = per_sig.get(pos['sig'], 0) + 1
            pos.update({'tc': h.get('TimeControl', ''), 'ev': ev.replace('Rated ', '').replace(' game', ''),
                        'elo': (int(we) + int(be)) // 2, 'site': (h.get('Site') or '').rsplit('/', 1)[-1],
                        'termination': h.get('Termination', '')})
            out.write(json.dumps(pos, separators=(',', ':')) + '\n')
            kept += 1
    top = sorted(per_sig.items(), key=lambda kv: -kv[1])[:12]
    log(f'Done: {kept:,} candidates. Most common: ' + ', '.join(f'{s} {n}' for s, n in top))


if __name__ == '__main__':
    sys.exit(main())
