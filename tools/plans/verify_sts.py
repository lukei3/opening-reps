"""Plans lab: check our idea-recognition against an outside, expert-labelled set.

The Strategic Test Suite (STS, Corbit and Natarajan, maintained by F. Mosca, MIT licence; lab/plans/data/sts) has 1,500
positions in 15 strategic themes, each with the best move and scored alternatives. Here we ask: given the position and the
best move, can the theme be recognised?
  A. hand-written rules (the kind the advisor uses),
  B. machine learning on position features only,
  C. machine learning on move features only,
  D. machine learning on both,
with 5-fold cross-validation, so every number is on positions the model did not train on.

    python tools/plans/verify_sts.py --out lab/plans/out/sts-check.md
"""
import argparse
import collections
import os
import re
import sys

import chess
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
VAL = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}


def load():
    rows = []
    with open(os.path.join(ROOT, 'lab', 'plans', 'data', 'sts', 'STS1-STS15_LAN_v3.epd'), encoding='utf-8') as f:
        for line in f:
            if not line.strip():
                continue
            fen = ' '.join(line.split()[:4]) + ' 0 1'
            theme = re.search(r'id "([^"]+)"', line).group(1)
            theme = re.sub(r'^STS\(v[\d.]+\) ', '', theme)
            theme = re.sub(r'\.\d+$', '', theme)
            theme = 'Knight Outposts' if theme.startswith('Knight Outposts') else theme
            ucis = re.search(r'c9 "([^"]+)"', line).group(1).split()
            sc = [int(x) for x in re.search(r'c8 "([^"]+)"', line).group(1).split()]
            rows.append((fen, theme, ucis[sc.index(max(sc))]))
    return rows


def wing(f):
    return 0 if f <= 2 else (1 if f <= 4 else 2)


def adv(sq, color):
    r = chess.square_rank(sq)
    return r if color == chess.WHITE else 7 - r


def outpost(board, sq, me):
    if adv(sq, me) < 3:
        return False
    if not any(board.piece_type_at(a) == chess.PAWN for a in board.attackers(me, sq)):
        return False
    f = chess.square_file(sq)
    for p in board.pieces(chess.PAWN, not me):
        if abs(chess.square_file(p) - f) == 1 and adv(p, not me) < adv(sq, not me):
            return False
    return True


def file_state(board, f, me):
    mine = any(chess.square_file(p) == f for p in board.pieces(chess.PAWN, me))
    theirs = any(chess.square_file(p) == f for p in board.pieces(chess.PAWN, not me))
    return 2 if not mine and not theirs else (1 if not mine else 0)


def material(board, c):
    return sum(VAL[p.piece_type] for p in board.piece_map().values() if p.color == c)


def position_features(board):
    me = board.turn
    f = []
    for c in (me, not me):
        pw = [0, 0, 0]
        for p in board.pieces(chess.PAWN, c):
            pw[wing(chess.square_file(p))] += 1
        f += pw
        f += [len(board.pieces(t, c)) for t in (chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN)]
        k = board.king(c)
        f += [abs(3.5 - chess.square_file(k)) + abs(3.5 - chess.square_rank(k))]
    f += [material(board, me) - material(board, not me), material(board, me) + material(board, not me)]
    f += [sum(1 for x in range(8) if file_state(board, x, me) == 2)]
    f += [len(list(board.legal_moves))]
    return f


POS_NAMES = [f'{w}_{n}' for w in ('own', 'opp') for n in ('pawnsQ', 'pawnsC', 'pawnsK', 'N', 'B', 'R', 'Q', 'king_off_centre')] + ['material_diff', 'material_total', 'open_files', 'legal_moves']


def move_features(board, mv):
    me = board.turn
    pt = board.piece_type_at(mv.from_square)
    cap = board.piece_at(mv.to_square) if board.is_capture(mv) else None
    before_att = len(board.attacks(mv.from_square))
    centre_before = abs(3.5 - chess.square_file(mv.from_square)) + abs(3.5 - chess.square_rank(mv.from_square))
    after = board.copy(stack=False)
    after.push(mv)
    to = mv.to_square
    f = [1 if pt == t else 0 for t in (chess.PAWN, chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN, chess.KING)]
    f += [1 if cap else 0, VAL[cap.piece_type] if cap else 0, 1 if board.gives_check(mv) else 0, 1 if board.is_castling(mv) else 0]
    f += [wing(chess.square_file(to)), adv(to, me), adv(to, me) - adv(mv.from_square, me), chess.square_distance(mv.from_square, to)]
    # pawn lever: after the move the pawn attacks an enemy pawn
    f += [1 if pt == chess.PAWN and any(after.piece_at(s) == chess.Piece(chess.PAWN, not me) for s in after.attacks(to)) else 0]
    f += [1 if outpost(after, to, me) else 0]
    f += [file_state(board, chess.square_file(to), me) if pt in (chess.ROOK, chess.QUEEN) else -1]
    f += [1 if pt in (chess.ROOK, chess.QUEEN) and adv(to, me) == 6 else 0]
    f += [len(after.attacks(to)) - before_att]
    centre_after = abs(3.5 - chess.square_file(to)) + abs(3.5 - chess.square_rank(to))
    f += [centre_before - centre_after]
    # offering an exchange: an enemy piece of the same or similar value attacks the destination
    att = [after.piece_type_at(a) for a in after.attackers(not me, to)]
    f += [1 if any(VAL[a] == VAL[pt] for a in att if a) else 0, len(att), len(after.attackers(me, to))]
    # square vacancy: how many of my other pieces could now use the square that was left
    f += [sum(1 for s in after.attackers(me, mv.from_square) if s != to)]
    # recapture: did I start down material (a capture just happened) and does this move take back
    f += [1 if cap and material(board, me) < material(board, not me) else 0]
    f += [1 if pt == chess.KING else 0, centre_before - centre_after if pt == chess.KING else 0]
    # bishop or knight for the other
    f += [1 if cap and {pt, cap.piece_type} == {chess.BISHOP, chess.KNIGHT} else 0]
    return f


MOVE_NAMES = ['P', 'N', 'B', 'R', 'Q', 'K', 'capture', 'captured_value', 'check', 'castle', 'to_wing', 'to_rank', 'advance', 'distance',
              'pawn_lever', 'to_outpost', 'file_state', 'to_7th', 'mobility_gain', 'centralises', 'exchange_offer', 'enemy_attackers',
              'own_defenders', 'vacates_for', 'recapture', 'king_move', 'king_centralises', 'b_for_n']


def rule_guess(board, mv):
    """What simple hand rules would call this move."""
    x = dict(zip(MOVE_NAMES, move_features(board, mv)))
    if x['recapture']:
        return 'Recapturing'
    if x['K']:
        return 'King Activity'
    if x['to_7th']:
        return '7th Rank'
    if x['b_for_n']:
        return 'Bishop vs Knight'
    if x['P'] and x['pawn_lever']:
        return 'Undermine'
    if x['P'] and x['to_wing'] == 2:
        return 'AKPC'
    if x['P'] and x['to_wing'] == 0:
        return 'Advancement of a/b/c pawns'
    if x['P']:
        return 'Pawn Play in the Center'
    if x['N'] and (x['to_outpost'] or x['centralises'] > 0):
        return 'Knight Outposts'
    if x['exchange_offer']:
        return 'Offer of Simplification'
    if x['capture']:
        return 'Simplification'
    if (x['R'] or x['Q']) and x['file_state'] >= 1:
        return 'Open Files and Diagonals'
    if x['vacates_for'] >= 1:
        return 'Square Vacancy'
    return 'Center Control'


def main():
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.metrics import accuracy_score, confusion_matrix
    from sklearn.model_selection import StratifiedKFold, cross_val_predict

    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    data = load()
    themes = sorted({t for _, t, _ in data})
    y = np.array([themes.index(t) for _, t, _ in data])
    P, M, rules = [], [], []
    for fen, theme, uci in data:
        b = chess.Board(fen)
        mv = chess.Move.from_uci(uci)
        P.append(position_features(b)); M.append(move_features(b, mv)); rules.append(rule_guess(b, mv))
    P, M = np.array(P, dtype=float), np.array(M, dtype=float)
    cv = StratifiedKFold(5, shuffle=True, random_state=0)

    def run(X):
        m = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.06, max_leaf_nodes=15, random_state=0)
        return cross_val_predict(m, X, y, cv=cv)

    pred = {'B. position only (ML)': run(P), 'C. best move only (ML)': run(M), 'D. position + best move (ML)': run(np.hstack([P, M]))}
    rule_pred = np.array([themes.index(r) for r in rules])
    res = [('Chance (15 themes, 100 each)', 1 / len(themes)), ('A. hand rules', accuracy_score(y, rule_pred))]
    res += [(k, accuracy_score(y, v)) for k, v in pred.items()]
    best = pred['D. position + best move (ML)']
    md = ['# Checking idea recognition against the Strategic Test Suite\n',
          f'{len(data):,} positions chosen by strong players to show 15 strategic themes (100 each), each with its best move. Source: [STS-Rating](https://github.com/fsmosca/STS-Rating), MIT licence. Every ML number is 5-fold cross-validated: each position is judged by a model that never saw it.\n',
          '## Can the theme be recognised from the position and the best move?\n', '| Method | Accuracy |', '|---|---|']
    md += [f'| {k} | {100 * v:.0f}% |' for k, v in res]
    md += ['', '## Per theme (position + best move, ML) and the hand rules\n', '| Theme | ML recall | Rules recall | ML most often confuses it with |', '|---|---|---|---|']
    cm = confusion_matrix(y, best, labels=range(len(themes)))
    for i, t in enumerate(themes):
        row = cm[i].copy(); row[i] = -1
        j = int(row.argmax())
        rr = np.mean(rule_pred[y == i] == i)
        md.append(f'| {t} | {100 * cm[i, i] / cm[i].sum():.0f}% | {100 * rr:.0f}% | {themes[j]} ({cm[i, j]}) |')
    md += ['', '## Reading this honestly\n',
           '- The model is told the best move. Finding the best move is the harder part, which the engine does; this only checks whether we can name the idea behind it.',
           '- STS positions are mostly middlegames and endgames from many openings, not King\'s Indian positions.',
           '- 100 positions per theme is small; a few points either way is noise.', '']
    with open(a.out, 'w', encoding='utf-8') as f:
        f.write('\n'.join(md))
    print('\n'.join(md))


if __name__ == '__main__':
    sys.exit(main())
