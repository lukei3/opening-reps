"""Plans lab: turn every source of labelled chess ideas into one format.

One JSON line per (position, move, labels):
  {"src", "trust", "fen", "uci", "best", "labels": [...], "text", "meta"}
where labels use one shared vocabulary (IDEAS below) and "trust" says where the label came from:
  expert       chosen and labelled by strong players (STS, the WGM-reviewed positional puzzles)
  comment      a human's written comment on the move (Lichess studies, ChessGPT's annotated games); labels found in the text
  rules        produced by the dataset authors' rules or templates (MATE strategy)
  crowd        Lichess puzzle themes (tactics, tagged by Lichess and players)

    python tools/plans/build_corpus.py RAW_DIR --out corpus.jsonl.gz [--puzzles 300000]
"""
import argparse
import collections
import csv
import glob
import gzip
import io
import json
import os
import random
import re
import sys

import chess
import chess.pgn
import logging
logging.getLogger("chess.pgn").setLevel(logging.CRITICAL)

IDEAS = ['knight_outpost', 'piece_activity', 'open_file', 'seventh_rank', 'pawn_break', 'kingside_pawns', 'queenside_pawns',
         'centre_pawns', 'centre_control', 'space', 'king_safety', 'king_attack', 'king_activity', 'exchange', 'avoid_exchange',
         'bishop_vs_knight', 'bishop_pair', 'recapture', 'square_vacancy', 'prophylaxis', 'initiative', 'development',
         'coordination', 'weakness', 'restriction', 'fix_structure', 'endgame_technique', 'sacrifice', 'material', 'passed_pawn',
         'minority_attack', 'other']

STS_MAP = {'Undermine': 'pawn_break', 'Open Files and Diagonals': 'open_file', 'Knight Outposts': 'knight_outpost',
           'Square Vacancy': 'square_vacancy', 'Bishop vs Knight': 'bishop_vs_knight', 'Recapturing': 'recapture',
           'Offer of Simplification': 'exchange', 'AKPC': 'kingside_pawns', 'Advancement of a/b/c pawns': 'queenside_pawns',
           'Simplification': 'exchange', 'King Activity': 'king_activity', 'Center Control': 'centre_control',
           'Pawn Play in the Center': 'centre_pawns', '7th Rank': 'seventh_rank', 'AT': 'avoid_exchange'}
NEIL_MAP = {'initiative': 'initiative', 'development': 'development', 'endgame': 'endgame_technique', 'space': 'space',
            'trading': 'exchange', 'prophylaxis': 'prophylaxis', 'coordination': 'coordination', 'exploitingweakness': 'weakness',
            'kingsafety': 'king_safety', 'restriction': 'restriction', 'fixingstructure': 'fix_structure',
            'centrecontrol': 'centre_control', 'other': 'other'}

# words people use in comments, mapped to ideas (checked on the comment text, lower case)
TEXT = [
    ('knight_outpost', r'\boutpost|strong square for (the|a|my|his|her) knight|knight (on|to) (d5|e5|c5|f5|d4|e4|c4|f4)\b'),
    ('open_file', r'open file|half[- ]open|semi[- ]open file|double (the )?rooks|doubling (the )?rooks|control (of )?the [a-h][- ]file'),
    ('seventh_rank', r'(7th|seventh|2nd|second) rank'),
    ('pawn_break', r'pawn break|\bbreak with|\blever\b|undermin|\bthe (\.\.\.)?[a-h][45] break'),
    ('minority_attack', r'minority attack'),
    ('kingside_pawns', r'pawn storm|storm(ing)? the king|kingside (pawn )?(expansion|advance|majority)|push(ing)? (the )?[fgh][- ]?pawn'),
    ('queenside_pawns', r'queenside (pawn )?(expansion|advance|majority)|queenside play'),
    ('king_attack', r'(attack|assault) (on|against) the king|kingside attack|mating attack|attack the king'),
    ('king_safety', r'king safety|weak(ened)? king|exposed king|safe(ty)? (for|of) the king|shelter|castl(e|ing) (to safety|early)'),
    ('weakness', r'weak (pawn|square|point|spot)|isolated pawn|isolani|backward pawn|doubled pawn|\bhole\b|weakness'),
    ('bishop_pair', r'bishop pair|pair of bishops|two bishops'),
    ('bishop_vs_knight', r'good bishop|bad bishop|knight (vs|versus|against) bishop|bishop (vs|versus|against) knight'),
    ('space', r'\bspace\b|gain(s|ing)? space|cramped'),
    ('centre_control', r'control (of )?the cent(er|re)|central control|occupy the cent(er|re)|strong cent(er|re)'),
    ('development', r'develop(ment|ing|s)?\b'),
    ('exchange', r'\b(trade[sd]?|trading|simplif\w*|exchang(e[sd]?|ing) (of )?(the )?(queens|rooks|pieces|knights|bishops|minor|dark|light))'),
    ('material', r'win(s|ning)? (the|a) (pawn|piece|exchange)|exchange sacrifice'),
    ('prophylaxis', r'prophyla'),
    ('initiative', r'initiative'),
    ('passed_pawn', r'passed pawn|passer'),
    ('endgame_technique', r'endgame|end game|opposition|zugzwang'),
    ('sacrifice', r'sacrific|\bsac\b'),
    ('restriction', r'restrict|bind\b|clamp|paralys|paralyz'),
    ('coordination', r'coordinat'),
    ('piece_activity', r'activ(e|ate|ity) (piece|rook|bishop|knight|queen)|improve (the|his|her|my) (worst|pieces?)|re-?route|regroup'),
]
TEXT = [(k, re.compile(rx)) for k, rx in TEXT]

PUZZLE_KEEP = {'advancedPawn', 'attackingF2F7', 'kingsideAttack', 'queensideAttack', 'quietMove', 'defensiveMove', 'exposedKing',
               'trappedPiece', 'promotion', 'sacrifice', 'fork', 'pin', 'skewer', 'discoveredAttack', 'deflection', 'attraction',
               'interference', 'clearance', 'xRayAttack', 'zugzwang', 'intermezzo', 'hangingPiece', 'capturingDefender',
               'doubleCheck', 'backRankMate', 'endgame', 'middlegame', 'opening', 'rookEndgame', 'pawnEndgame', 'queenEndgame',
               'bishopEndgame', 'knightEndgame', 'equality', 'advantage', 'crushing', 'mate'}


SEEN = set()


def out_row(f, **kw):
    """Write one row, skipping exact repeats (same position, move and comment from the same kind of source)."""
    key = (' '.join(kw['fen'].split()[:4]), kw['uci'], kw['trust'], (kw.get('text') or '')[:80])
    if key in SEEN:
        return
    SEEN.add(key)
    f.write(json.dumps(kw, ensure_ascii=False, separators=(',', ':')) + '\n')


def text_labels(text):
    t = text.lower()
    return [k for k, rx in TEXT if rx.search(t)]


def do_sts(root, f, counts):
    path = os.path.join(root, '..', '..', '..', '..', 'lab', 'plans', 'data', 'sts', 'STS1-STS15_LAN_v3.epd')
    path = os.environ.get('STS_PATH', path)
    for line in open(path, encoding='utf-8'):
        if not line.strip():
            continue
        fen = ' '.join(line.split()[:4]) + ' 0 1'
        theme = re.sub(r'\.\d+$', '', re.sub(r'^STS\(v[\d.]+\) ', '', re.search(r'id "([^"]+)"', line).group(1)))
        theme = 'Knight Outposts' if theme.startswith('Knight Outposts') else theme
        ucis = re.search(r'c9 "([^"]+)"', line).group(1).split()
        sc = [int(x) for x in re.search(r'c8 "([^"]+)"', line).group(1).split()]
        for u, s in zip(ucis, sc):
            out_row(f, src='sts', trust='expert', fen=fen, uci=u, best=(s == max(sc)), labels=[STS_MAP[theme]] if s == max(sc) else [],
                    text='', meta={'theme': theme, 'score': s})
            counts['sts'] += 1


def do_neil(root, f, counts):
    with open(os.path.join(root, 'neilgd', 'chess-positions.csv'), encoding='utf-8') as fh:
        for r in csv.DictReader(fh):
            labels = [v for k, v in NEIL_MAP.items() if r.get(k) == '1']
            out_row(f, src='positional-puzzles', trust='expert', fen=r['fen'], uci=r['best_move'], best=True, labels=labels, text='',
                    meta={'difficulty': r['difficulty'], 'game': r['lichess_url']})
            counts['positional-puzzles'] += 1


MATE_RX = re.compile(r'Move([AB]):([a-h][1-8][a-h][1-8][qrbn]?) (.*?)(?= Move[AB]:|\s*$)')


def mate_labels(expl):
    t = expl.lower()
    if 'king' in t and any(w in t for w in ('sacrific', 'give up', 'lose a piece', 'offer a piece', 'surrender', 'give away', 'remove a piece', 'exchange a piece to open')):
        return ['sacrifice', 'king_attack']
    if 'value' in t or 'minor piece for a major' in t or 'lesser piece' in t or 'smaller piece' in t:
        return ['material', 'exchange']
    if 'pawn' in t and any(w in t for w in ('captur', 'takes', 'taken', 'removes another', 'eliminates', 'seizes', 'overtakes')):
        return ['pawn_break']
    if 'pawn' in t and 'kingside' in t:
        return ['kingside_pawns', 'space']
    if 'pawn' in t and 'queenside' in t:
        return ['queenside_pawns', 'space']
    if 'pawn' in t and 'center' in t:
        return ['centre_pawns', 'space']
    if 'king' in t and any(w in t for w in ('safe', 'shelter', 'protect', 'secure')):
        return ['king_safety']
    return ['piece_activity']


def do_mate(root, f, counts, limit):
    files = sorted(glob.glob(os.path.join(root, 'mate', 'strategy', '**', '*.jsonl'), recursive=True))
    n = 0
    for p in files:
        for line in open(p, encoding='utf-8'):
            j = json.loads(line)
            m = re.search(r'FEN of the given chess board is "([^"]+)"', j['input'])
            if not m:
                continue
            better = re.search(r'Move([AB]):', j['output'])
            for side, uci, expl in MATE_RX.findall(j['input']):
                out_row(f, src='mate-strategy', trust='rules', fen=m.group(1), uci=uci, best=bool(better and better.group(1) == side),
                        labels=mate_labels(expl), text=expl.strip(), meta={})
                counts['mate-strategy'] += 1
            n += 1
            if limit and n >= limit:
                return


def pgn_comments(pgn_text, src, trust, f, counts, meta_extra=None):
    """Every comment on a move, from the main line and all variations."""
    # some studies put an opening name in the Variant header, which the parser takes for an unknown chess variant
    pgn_text = re.sub(r'\[Variant "(?!Standard|From Position|Chess960)[^"]*"\]\s*', '', pgn_text)
    stream = io.StringIO(pgn_text)
    while True:
        try:
            game = chess.pgn.read_game(stream)
        except Exception:
            continue
        if game is None:
            break
        site = game.headers.get('Site', '')
        stack = list(game.variations)
        while stack:
            node = stack.pop()
            stack.extend(node.variations)
            text = (node.comment or '').strip()
            text = re.sub(r'\[%[^\]]*\]', '', text).strip()
            if len(text) < 12:
                continue
            board = node.parent.board()
            out_row(f, src=src, trust=trust, fen=board.fen(), uci=node.move.uci(), best=None, labels=text_labels(text),
                    text=text[:600], meta={'site': site, **(meta_extra or {})})
            counts[src] += 1


def do_studies(root, f, counts):
    for p in sorted(glob.glob(os.path.join(root, 'studies', '*.pgn'))):
        pgn_comments(open(p, encoding='utf-8', errors='replace').read(), 'lichess-studies', 'comment', f, counts)


def do_practice(root, f, counts):
    for p in sorted(glob.glob(os.path.join(root, 'practice', '*.pgn'))):
        pgn_comments(open(p, encoding='utf-8', errors='replace').read(), 'lichess-practice', 'comment', f, counts)


def do_jsonl(path, f, counts):
    """Rows already in the shared format (Wikibooks, the books)."""
    if not os.path.exists(path):
        return
    for line in open(path, encoding='utf-8'):
        r = json.loads(line)
        out_row(f, **r)
        counts[r['src']] += 1


def do_chessgpt(root, f, counts, limit):
    n = 0
    for p in sorted(glob.glob(os.path.join(root, 'chessgpt', 'annotated_pgn-data.jsonl-*'))):
        for line in open(p, encoding='utf-8'):
            j = json.loads(line)
            pgn_comments(j['text'], 'chessgpt-annotated', 'comment', f, counts)
            n += 1
            if limit and n >= limit:
                return


def do_puzzles(root, f, counts, limit):
    import pyarrow.parquet as pq
    rnd = random.Random(1)
    for p in sorted(glob.glob(os.path.join(root, 'puzzles', '*.parquet'))):
        t = pq.read_table(p, columns=['FEN', 'Moves', 'Themes', 'Rating', 'PuzzleId']).to_pylist()
        rnd.shuffle(t)
        for r in t[:limit]:
            board = chess.Board(r['FEN'])
            mv = r['Moves'].split()
            board.push_uci(mv[0])              # the puzzle starts after the opponent's move
            labels = ['puzzle_' + x for x in r['Themes'] if x in PUZZLE_KEEP]
            out_row(f, src='lichess-puzzles', trust='crowd', fen=board.fen(), uci=mv[1], best=True, labels=labels, text='',
                    meta={'rating': r['Rating'], 'id': r['PuzzleId']})
            counts['lichess-puzzles'] += 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('raw')
    ap.add_argument('--out', required=True)
    ap.add_argument('--puzzles', type=int, default=300000)
    ap.add_argument('--mate', type=int, default=0, help='MATE records to keep (0 = all)')
    ap.add_argument('--chessgpt', type=int, default=0, help='annotated games to keep (0 = all)')
    a = ap.parse_args()
    counts = collections.Counter()
    with gzip.open(a.out, 'wt', encoding='utf-8') as f:
        for name, fn in (('sts', lambda: do_sts(a.raw, f, counts)), ('positional puzzles', lambda: do_neil(a.raw, f, counts)),
                         ('lichess studies', lambda: do_studies(a.raw, f, counts)), ('lichess practice', lambda: do_practice(a.raw, f, counts)),
                         ('wikibooks', lambda: do_jsonl(os.path.join(a.raw, '..', 'wikibooks.jsonl'), f, counts)), ('chessgpt', lambda: do_chessgpt(a.raw, f, counts, a.chessgpt)),
                         ('mate', lambda: do_mate(a.raw, f, counts, a.mate)), ('puzzles', lambda: do_puzzles(a.raw, f, counts, a.puzzles))):
            before = sum(counts.values())
            fn()
            print(f'{name}: {sum(counts.values()) - before:,} rows', flush=True)
    print('total', sum(counts.values()), dict(counts))


if __name__ == '__main__':
    sys.exit(main())
