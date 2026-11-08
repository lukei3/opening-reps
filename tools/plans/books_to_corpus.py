"""Plans lab: turn two public-domain strategy books into (position, move, comment) rows.

Capablanca, Chess Fundamentals (1921) and Edward Lasker, Chess Strategy (1915), both from Project Gutenberg. They use the old
descriptive notation (P-K4, Kt-KB3, PxP). This reads the move columns, works out each move on a real board by matching the
description against the legal moves, and attaches the author's prose that follows a move to that move. Lasker's ASCII
diagrams are read into positions, so games and endgames that start from a diagram are kept too.

    python tools/plans/books_to_corpus.py BOOKS_DIR --out books.jsonl
"""
import argparse
import io
import json
import os
import re
import sys

import chess

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_corpus import text_labels  # noqa: E402

PIECE = {'P': chess.PAWN, 'KT': chess.KNIGHT, 'N': chess.KNIGHT, 'B': chess.BISHOP, 'R': chess.ROOK, 'Q': chess.QUEEN, 'K': chess.KING}
FILE_OF = {'QR': 0, 'QKT': 1, 'QN': 1, 'QB': 2, 'Q': 3, 'K': 4, 'KB': 5, 'KKT': 6, 'KN': 6, 'KR': 7}
FILES_FOR = {'R': (0, 7), 'KT': (1, 6), 'N': (1, 6), 'B': (2, 5), 'Q': (3,), 'K': (4,)}

MOVE_LINE = re.compile(r'^\s*\(?(\d+)\s*[.)]\s+(.*\S)\s*$')     # '1. P-K4  P-K4' or E. Lasker's '(3) Kt-QB3  P-QB4'
SQUARE = re.compile(r'^(K|Q)?(KT|N|B|R)?(SQ|[1-8])?$')


def files_of(side, piece_file):
    if side and piece_file:
        return (FILE_OF[side + piece_file],)
    if piece_file:
        return FILES_FOR[piece_file]
    if side:
        return (FILE_OF[side],)
    return tuple(range(8))


def parse_square(s):
    """'KB3' -> (files, rank) from the mover's side; None if not a square."""
    m = SQUARE.match(s)
    if not m:
        return None
    side, pf, rk = m.groups()
    if not side and not pf:
        return None
    return files_of(side, pf), (1 if rk in ('SQ', None) else int(rk))


def rel_rank(sq, color):
    r = chess.square_rank(sq) + 1
    return r if color == chess.WHITE else 9 - r


def piece_filter(desc):
    """'QKT' -> (KNIGHT, side 'Q'); 'KBP' -> (PAWN, files (5,)); 'P' -> (PAWN, None)."""
    d = desc
    if not d:
        return None, None, None
    if d.endswith('P') and len(d) > 1:              # a pawn named by its file: KP, QBP, KTP, RP
        f = d[:-1]
        if f in FILE_OF:
            return chess.PAWN, (FILE_OF[f],), None
        if f in FILES_FOR:
            return chess.PAWN, FILES_FOR[f], None
    if d in PIECE:
        return PIECE[d], None, None
    if d[0] in 'KQ' and d[1:] in PIECE and d[1:] != 'P':
        return PIECE[d[1:]], None, d[0]
    return None, None, None


def old_style(tok):
    """Staunton-era notation: 'K. Kt. to B. 3rd', 'Q. to her R's 8th', 'B. takes Kt. (ch.)' -> 'KKt-B3', 'Q-QR8', 'BxKt'."""
    t = tok
    if ' to ' not in t and ' takes ' not in t and 'Castles' not in t:
        return tok
    t = re.sub(r'\((best|good|bad|weak|strong|[a-z ,!?]{1,20})\)', '', t)
    t = re.sub(r'\(?\bch\.?\)?|\bcheck(ing)?\b|\bmate\b', '', t)
    t = re.sub(r'\bher\b', 'Q', t)
    t = re.sub(r'\bhis\b', 'K', t)
    t = t.replace("'s", '').replace('\u2019s', '')
    t = re.sub(r'(\d)(st|nd|rd|th|d)\b', r'\1', t)
    t = t.replace(' takes ', 'x').replace(' to ', '-')
    t = t.replace('.', '')
    return t


def clean(tok):
    t = old_style(tok).upper().replace('×', 'X').replace('–', '-').replace('—', '-').replace(':', 'X')
    t = re.sub(r'\(([A-Z]+)\)\s*$', r'=\1', t)          # promotion written as (Q)
    t = re.sub(r'\s+', '', t)
    t = re.sub(r'(DIS\.?)?(DBL\.?)?CH\.?|\+|MATE|E\.P\.|[!?]+|\([A-Z]\)$', '', t)
    t = t.replace('--', '-')
    return t.strip('.,;')


def find_move(board, tok):
    t = clean(tok)
    if not t:
        return None
    me = board.turn
    if t in ('O-O', 'CASTLES', 'CASTLESKR', 'CASTLES(K)', 'OO', 'O-O-O', 'CASTLESQR', 'CASTLES(Q)', 'OOO'):
        long_ = t in ('O-O-O', 'CASTLESQR', 'CASTLES(Q)', 'OOO')
        for mv in board.legal_moves:
            if board.is_castling(mv) and (chess.square_file(mv.to_square) == 2) == long_:
                return mv
        if t == 'CASTLES':
            for mv in board.legal_moves:
                if board.is_castling(mv):
                    return mv
        return None
    promo = None
    m = re.search(r'=?(Q|R|B|KT|N)$', t) if re.search(r'[18]=?(Q|R|B|KT|N)$', t) else None
    if m:
        promo = PIECE[m.group(1)]
        t = t[:m.start()]
    frm = None
    fm = re.match(r'^([A-Z]+)\(([A-Z0-9]+)\)(.*)$', t)
    if fm:
        frm = parse_square(fm.group(2))
        t = fm.group(1) + fm.group(3)
    if '-' in t:
        who, tgt = t.split('-', 1)
        cap = None
    elif 'X' in t:
        who, tgt = t.split('X', 1)
        cap = tgt
    else:
        return None
    ptype, pfiles, pside = piece_filter(who)
    if ptype is None:
        return None
    cands = []
    for mv in board.legal_moves:
        if board.piece_type_at(mv.from_square) != ptype:
            continue
        if promo and mv.promotion != promo:
            continue
        if not promo and mv.promotion and mv.promotion != chess.QUEEN:
            continue
        if pfiles and chess.square_file(mv.from_square) not in pfiles:
            continue
        if frm and not (chess.square_file(mv.from_square) in frm[0] and rel_rank(mv.from_square, me) == frm[1]):
            continue
        if cap is None:
            sq = parse_square(tgt)
            if not sq or board.is_capture(mv):
                continue
            if chess.square_file(mv.to_square) in sq[0] and rel_rank(mv.to_square, me) == sq[1]:
                cands.append(mv)
        else:
            if not board.is_capture(mv):
                continue
            victim_sq = mv.to_square if not board.is_en_passant(mv) else chess.square(chess.square_file(mv.to_square), chess.square_rank(mv.from_square))
            victim = board.piece_type_at(victim_sq)
            sq = parse_square(cap) if re.search(r'\d|SQ$', cap) else None     # 'xKT' is a piece, 'xKB3' a square
            if sq:
                if chess.square_file(mv.to_square) in sq[0] and rel_rank(mv.to_square, me) == sq[1]:
                    cands.append(mv)
                continue
            vtype, vfiles, _ = piece_filter(cap)
            if vtype != victim or (vfiles and chess.square_file(victim_sq) not in vfiles):
                continue
            cands.append(mv)
    if len(cands) > 1 and pside:                     # QR, KKt, QB ...: prefer the piece on that side of the board
        side_files = range(0, 4) if pside == 'Q' else range(4, 8)
        narrowed = [mv for mv in cands if chess.square_file(mv.from_square) in side_files]
        if ptype == chess.BISHOP:
            # the queen's bishop starts on c1/c8, the king's bishop on f1/f8: tell them apart by square colour
            want = chess.square(2 if pside == 'Q' else 5, 0 if me == chess.WHITE else 7)
            colour = (chess.square_file(want) + chess.square_rank(want)) % 2
            narrowed = [mv for mv in cands if (chess.square_file(mv.from_square) + chess.square_rank(mv.from_square)) % 2 == colour]
        if narrowed:
            cands = narrowed
    return cands[0] if len(cands) == 1 else None


def read_diagram(lines, i):
    """Lasker's ASCII diagrams: 8 rows like ' 8 |    | ^K |  #R | ...'. ^ = White, # = Black. Returns (board, next line)."""
    rows = []
    j = i
    while j < len(lines) and len(rows) < 8:
        m = re.match(r'^\s*([1-8])\s*\|(.*)\|\s*$', lines[j])
        if m:
            cells = [c.strip() for c in m.group(2).split('|')]
            if len(cells) == 8:
                rows.append(cells)
        elif rows and not re.match(r'^\s*\|?-+\|?\s*$', lines[j].strip() or '-'):
            break
        j += 1
    if len(rows) != 8:
        return None, i + 1
    board = chess.Board(None)
    for r, cells in enumerate(rows):
        for f, c in enumerate(cells):
            m = re.match(r'^([\^#])(KT|K|Q|R|B|P|N)$', c.upper().replace(' ', ''))
            if m:
                board.set_piece_at(chess.square(f, 7 - r), chess.Piece(PIECE[m.group(2)], m.group(1) == '^'))
    if board.king(chess.WHITE) is None or board.king(chess.BLACK) is None:
        return None, j
    return board, j


def hist_has(hist, num, white):
    """Index of the move with this number and colour in the current game, if it was already played."""
    for idx, (n, w, _) in enumerate(hist):
        if n == num and w == white:
            return idx
    return None


def split_moves(body):
    parts = re.split(r'\s{2,}|\t+', body.strip())
    parts = [p for p in parts if p]
    if not parts:
        return None, None
    w = parts[0]
    b = parts[1] if len(parts) > 1 else None
    if b:
        b = re.sub(r'^\d+\s*\.\s*', '', b)       # Staunton numbers both columns: '1. P. to K's 4th.   1. P. to K's 4th.'
    return w, b


def convert(path, src, out):
    lines = open(path, encoding='utf-8', errors='replace').read().splitlines()
    stats = {'games': 0, 'moves': 0, 'comments': 0, 'diagrams': 0, 'stopped': 0}
    board = None
    hist = []                   # (move number, white?, position before the move) for rewinding to side lines
    pending = None              # a diagram waiting for its moves
    last = None                 # (fen before, uci) of the last move played
    buf = []

    def flush():
        nonlocal buf
        text = ' '.join(x.strip() for x in buf).strip()
        buf = []
        if last and len(text) > 25:
            fen, uci = last
            out.write(json.dumps({'src': src, 'trust': 'expert-comment', 'fen': fen, 'uci': uci, 'best': None,
                                  'labels': text_labels(text), 'text': text[:800], 'meta': {}}, ensure_ascii=False) + '\n')
            stats['comments'] += 1

    i = 0
    while i < len(lines):
        line = lines[i]
        if re.match(r'^\s*8\s*\|', line):
            flush()
            b, i = read_diagram(lines, i)
            if b:
                pending = b
                stats['diagrams'] += 1
            continue
        m = MOVE_LINE.match(line)
        if m and not re.search(r'[a-z]{4,}', m.group(2).replace('ch', '').replace('mate', '').replace('Castles', '').replace('wins', '')):
            num = int(m.group(1))
            w, b = split_moves(m.group(2))
            flush()
            white_dots = not w or w.strip('. ') == ''
            if num == 1 and not hist_has(hist, 1, not white_dots):
                if pending is not None:
                    board = pending.copy()
                    board.turn = chess.BLACK if white_dots else chess.WHITE
                    pending = None
                else:
                    board = chess.Board()
                last = None
                hist = []
                stats['games'] += 1
            else:
                # a side line: the move number goes back (or repeats). Rewind to the position before that move.
                at = hist_has(hist, num, not white_dots)
                if at is not None:
                    board = chess.Board(hist[at][2])
                    hist = hist[:at]
                    stats['variations'] = stats.get('variations', 0) + 1
            if board is None:
                i += 1
                continue
            for k, tok in enumerate((w, b)):
                if not tok or tok.strip('. ') == '':
                    continue
                mv = find_move(board, tok)
                if mv is None:
                    board = None
                    stats['stopped'] += 1
                    break
                hist.append((num, k == 0, board.fen()))
                last = (board.fen(), mv.uci())
                board.push(mv)
                stats['moves'] += 1
            i += 1
            continue
        if line.strip():
            buf.append(line)
        else:
            if buf and sum(len(x) for x in buf) > 600:
                flush()
        i += 1
    flush()
    return stats


# ---------- the "move stream" reader, for books printed one move per line or with damaged signs ----------
AMBIG = '\ufffd'
STREAM_MOVE = re.compile(
    r"(Castles(?:\s*\(?[KQ]\s*R?\)?)?|O\s*[-\u2013\u2014" + AMBIG + r"]\s*O(?:\s*[-\u2013\u2014" + AMBIG + r"]\s*O)?"
    r"|(?:[KQ]\s*)?(?:Kt|B|R|Q|K|P)(?:\s*\([^)]{1,6}\))?\s*[-\u2013\u2014x\u00d7:" + AMBIG + r"]\s*"
    r"(?:[KQ]\s*)?(?:Kt|B|R|Q|K|P)?\s*(?:\d|sq\.?)?(?:\s*P)?)")


def stream_token(tok):
    """Decide what the damaged sign means: a square after it is a move ('to'), a piece is a capture ('takes')."""
    t = tok.replace('\u2013', '-').replace('\u2014', '-')
    if AMBIG in t:
        left, _, right = t.partition(AMBIG)
        r = right.strip()
        if re.search(r'\d|sq', r) or re.fullmatch(r'(K|Q)?\s*(Kt|B|R)?', r) and not re.fullmatch(r'(Kt|B|R|Q)', r):
            t = left + '-' + right
        else:
            t = left + 'x' + right
    return t


def stream_convert(path, src, out):
    text = open(path, encoding='utf-8', errors='replace').read()
    stats = {'games': 0, 'moves': 0, 'comments': 0, 'stopped': 0}
    board, hist, last, buf = None, [], None, []
    pending = None

    def flush():
        nonlocal buf
        txt = ' '.join(buf).strip()
        buf = []
        if last and len(txt) > 30:
            fen, uci = last
            out.write(json.dumps({'src': src, 'trust': 'expert-comment', 'fen': fen, 'uci': uci, 'best': None,
                                  'labels': text_labels(txt), 'text': txt[:800], 'meta': {'reader': 'stream'}}, ensure_ascii=False) + '\n')
            stats['comments'] += 1

    for raw in text.splitlines():
        line = raw.strip().replace('\xa0', ' ')
        if not line:
            continue
        words = re.findall(r'\b[a-z]{3,}\b', line)
        if len(words) >= 4:
            buf.append(line)
            continue
        num = re.match(r'^(\d{1,3})\s*\.?\s*(.*)$', line)
        if num and int(num.group(1)) <= 120 and not num.group(2):
            pending = int(num.group(1))            # the number stands alone; the move comes on the next line
            continue
        if not num and pending is not None and STREAM_MOVE.search(line):
            num = re.match(r'^()(.*)$', line)
            n_forced = pending
        else:
            n_forced = None
        pending = None
        if num and (n_forced is not None or int(num.group(1)) <= 120):
            n = n_forced if n_forced is not None else int(num.group(1))
            rest = num.group(2)
            if n == 1:
                trial = chess.Board()
                first = STREAM_MOVE.search(rest)
                if first and find_move(trial, stream_token(first.group(0))):
                    flush()
                    board, hist, last = chess.Board(), [], None
                    stats['games'] += 1
            elif board is not None or hist:
                want_white = not rest.startswith('.')
                at = hist_has(hist, n, want_white)
                if at is not None:
                    flush()
                    board = chess.Board(hist[at][2]); hist = hist[:at]
            line = rest
        if board is None:
            continue
        found = STREAM_MOVE.findall(line)
        if not found:
            continue
        flush()
        for tok in found:
            mv = find_move(board, stream_token(tok))
            if mv is None:
                board = None
                stats['stopped'] += 1
                break
            hist.append((board.fullmove_number, board.turn == chess.WHITE, board.fen()))
            last = (board.fen(), mv.uci())
            board.push(mv)
            stats['moves'] += 1
    flush()
    return stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('books')
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    with open(a.out, 'w', encoding='utf-8') as out:
        for name, src in (('capablanca-chess-fundamentals.txt', 'book-capablanca'), ('lasker-chess-strategy.txt', 'book-lasker'),
                          ('pg16377.txt', 'book-staunton'), ('pg4913.txt', 'book-lasker-checkers'), ('pg34180.txt', 'book-morphy'),
                          ('pg4902.txt', 'book-bird'), ('pg55278.txt', 'book-young'), ('pg78804.txt', 'book-philidor'),
                          ('ia-middlegameinches00znos.txt', 'book-znosko-middle-game'), ('ia-commonsenseinche00laskrich.txt', 'book-lasker-common-sense'),
                          ('ia-principlesofches00masoiala.txt', 'book-mason-principles'), ('ia-artofchess00maso.txt', 'book-mason-art'),
                          ('ia-modernchessinstr00steirich.txt', 'book-steinitz-instructor'),
                          ('ws-my-chess-career.txt', 'book-capablanca-career'), ('ws-my-system.txt', 'book-nimzowitsch-my-system'),
                          ('ws-morphys-games.txt', 'book-morphy-games')):
            path = os.path.join(a.books, name)
            if not os.path.exists(path):
                continue
            # try both readers and keep whichever recovers more of the author's comments
            col, stm = io.StringIO(), io.StringIO()
            s1 = convert(path, src, col)
            s2 = stream_convert(path, src, stm)
            best, s = (stm, s2) if s2['comments'] > s1['comments'] else (col, s1)
            out.write(best.getvalue())
            print(src, 'stream' if best is stm else 'columns', s)


if __name__ == '__main__':
    sys.exit(main())
