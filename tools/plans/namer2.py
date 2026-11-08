"""Plans lab: the idea namer, version 2, trained on every expert-labelled source and checked on human comments.

Training data (trust = expert): the Strategic Test Suite (1,500 best moves, 15 themes) and the WGM-reviewed positional
puzzles (2,204 best moves, 13 categories), mapped onto one vocabulary. One yes/no model per idea, so a move can serve
several ideas at once.

Checks:
  1. cross-validation inside the expert data (every number from positions the model did not train on);
  2. an outside check on human-written comments it never trained on (the two books, Lichess studies, ChessGPT's annotated
     games): when a comment names an idea (say "outpost"), does the model rank that idea higher than it does for other moves?

    python tools/plans/namer2.py CORPUS.jsonl.gz BOOKS.jsonl --report lab/plans/out/namer2-check.md --model namer2.pkl
"""
import argparse
import collections
import gzip
import json
import os
import pickle
import sys

import chess
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from verify_sts import MOVE_NAMES, POS_NAMES, move_features, position_features  # noqa: E402

VAL = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}
MIN_POS = 40          # an idea needs at least this many expert examples to get its own model


def weak_pawns(board, color):
    out = set()
    pawns = list(board.pieces(chess.PAWN, color))
    for p in pawns:
        f = chess.square_file(p)
        if not any(abs(chess.square_file(q) - f) == 1 for q in pawns):
            out.add(p)
    return out


def opp_mobility(board):
    b = board.copy(stack=False)
    if b.is_check():
        return len(list(b.legal_moves))
    b.turn = not b.turn
    b.ep_square = None
    return len(list(b.legal_moves))


def defended_count(board, color):
    return sum(1 for sq, p in board.piece_map().items() if p.color == color and p.piece_type != chess.KING and board.attackers(color, sq))


def extra_features(board, mv):
    me = board.turn
    pt = board.piece_type_at(mv.from_square)
    after = board.copy(stack=False)
    after.push(mv)
    f = []
    back = 0 if me == chess.WHITE else 7
    f.append(1 if pt in (chess.KNIGHT, chess.BISHOP) and chess.square_rank(mv.from_square) == back else 0)   # develops a minor piece
    f.append(1 if board.is_castling(mv) else 0)
    # threats after the move: enemy pieces attacked by the moved piece that are undefended or worth more
    thr = 0
    for sq in after.attacks(mv.to_square):
        p = after.piece_at(sq)
        if p and p.color != me and p.piece_type != chess.KING and (not after.attackers(not me, sq) or VAL[p.piece_type] > VAL[pt]):
            thr += 1
    f.append(thr)
    # how much the move restricts the opponent: their moves now vs before (as if it were their turn)
    f.append(len(list(after.legal_moves)) - opp_mobility(board))
    f.append(defended_count(after, me) - defended_count(board, me))
    # fixing: a pawn move that stops right in front of an enemy pawn
    step = 8 if me == chess.WHITE else -8
    ahead = mv.to_square + step
    f.append(1 if pt == chess.PAWN and 0 <= ahead < 64 and after.piece_at(ahead) == chess.Piece(chess.PAWN, not me) else 0)
    # pressure on weak (isolated) enemy pawns from the moved piece
    wk = weak_pawns(after, not me)
    f.append(sum(1 for s in after.attacks(mv.to_square) if s in wk))
    # a pawn move in front of one's own castled king
    k = board.king(me)
    f.append(1 if pt == chess.PAWN and k is not None and abs(chess.square_file(mv.from_square) - chess.square_file(k)) <= 1 and chess.square_rank(k) == back else 0)
    # game phase: non-pawn material on the board
    f.append(sum(VAL[p.piece_type] for p in board.piece_map().values() if p.piece_type not in (chess.PAWN, chess.KING)))
    f.append(board.fullmove_number if board.fullmove_number > 1 else 0)
    return f


EXTRA_NAMES = ['develops_minor', 'castles', 'threats', 'opp_mobility_change', 'defended_change', 'fixes_pawn', 'hits_weak_pawn',
               'shield_pawn_move', 'non_pawn_material', 'move_number']


def features(fen, uci):
    try:
        b = chess.Board(fen)
        mv = chess.Move.from_uci(uci)
    except ValueError:
        return None
    if b.king(chess.WHITE) is None or b.king(chess.BLACK) is None or mv not in b.legal_moves:
        return None
    return position_features(b) + move_features(b, mv) + extra_features(b, mv)


def load_rows(paths, trust=None, limit_per_src=0):
    per = collections.Counter()
    for p in paths:
        op = gzip.open if p.endswith('.gz') else open
        with op(p, 'rt', encoding='utf-8') as f:
            for line in f:
                r = json.loads(line)
                if trust and r['trust'] not in trust:
                    continue
                if limit_per_src and per[r['src']] >= limit_per_src:
                    continue
                per[r['src']] += 1
                yield r


def main():
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.metrics import roc_auc_score
    from sklearn.model_selection import StratifiedKFold, cross_val_predict

    ap = argparse.ArgumentParser()
    ap.add_argument('inputs', nargs='+')
    ap.add_argument('--report', required=True)
    ap.add_argument('--model', required=True)
    ap.add_argument('--comments', type=int, default=40000, help='comment rows per source to test on')
    ap.add_argument('--weak', default='', help='comment sources to ALSO train on (comma list); they are then left out of the outside check')
    ap.add_argument('--weak-weight', type=float, default=0.3)
    ap.add_argument('--verdicts', default='', help="idea-verdicts.json saved from the Ideas view: 'right' adds the idea as a label, 'wrong' rules it out")
    a = ap.parse_args()
    weak_src = {x for x in a.weak.split(',') if x}

    # expert training data: best moves with at least one label
    X, Y, src = [], [], []
    for r in load_rows(a.inputs, trust={'expert'}):
        if not r['labels'] or r['best'] is False:
            continue
        x = features(r['fen'], r['uci'])
        if x is None:
            continue
        X.append(x); Y.append(set(r['labels'])); src.append(r['src'])
    neg = [set() for _ in X]                 # ideas a person said do NOT fit this move
    if a.verdicts:
        for v in json.load(open(a.verdicts, encoding='utf-8')):
            x = features(v['fen'], v['uci'])
            if x is None or v.get('idea') in (None, 'unclear'):
                continue
            X.append(x); src.append('your-verdicts')
            if v['verdict'] == 'right':
                Y.append({v['idea']}); neg.append(set())
            else:
                Y.append(set()); neg.append({v['idea']})
        print(f"{sum(1 for s_ in src if s_ == 'your-verdicts')} of your verdicts added", flush=True)
    X = np.array(X, dtype=float)
    counts = collections.Counter(l for ys in Y for l in ys)
    ideas = sorted(l for l, c in counts.items() if c >= MIN_POS and l != 'other')
    print(f'{len(X):,} expert examples; ideas with a model: {len(ideas)}', flush=True)

    def model():
        return HistGradientBoostingClassifier(max_iter=250, learning_rate=0.06, max_leaf_nodes=15, random_state=0)

    # weak training data: moves with a human comment, labels read from the text
    Xw, Yw = [], []
    if weak_src:
        for r in load_rows(a.inputs, trust={'comment', 'expert-comment'}, limit_per_src=a.comments):
            if r['src'] not in weak_src:
                continue
            x = features(r['fen'], r['uci'])
            if x is not None:
                Xw.append(x); Yw.append(set(r['labels']))
    Xw = np.array(Xw, dtype=float) if Xw else np.zeros((0, X.shape[1]))
    print(f'{len(Xw):,} weak (comment) examples from {sorted(weak_src) or "none"}', flush=True)

    def fit(idea, Xe, Ye):
        ye = np.array([idea in ys for ys in Ye], dtype=int)
        if len(Xw):
            yw = np.array([idea in ys for ys in Yw], dtype=int)
            Xa = np.vstack([Xe, Xw]); ya = np.concatenate([ye, yw])
            wa = np.concatenate([np.ones(len(ye)), np.full(len(yw), a.weak_weight)])
            return model().fit(Xa, ya, sample_weight=wa)
        return model().fit(Xe, ye)

    # 1. cross-validated scores per idea (weak data, if any, is added to every training fold)
    P = np.zeros((len(X), len(ideas)))
    cv = StratifiedKFold(5, shuffle=True, random_state=0)
    strat = np.array([src[i] for i in range(len(X))])
    for tr, te in cv.split(X, strat):
        Ytr = [Y[i] for i in tr]
        for j, idea in enumerate(ideas):
            P[te, j] = fit(idea, X[tr], Ytr).predict_proba(X[te])[:, 1]
    rows_cv = []
    for j, idea in enumerate(ideas):
        y = np.array([idea in ys for ys in Y], dtype=int)
        rows_cv.append((idea, int(y.sum()), roc_auc_score(y, P[:, j])))
    top1 = np.mean([ideas[int(P[i].argmax())] in Y[i] for i in range(len(X))])
    top3 = np.mean([any(ideas[k] in Y[i] for k in np.argsort(-P[i])[:3]) for i in range(len(X))])
    by_src = {}
    for s in sorted(set(src)):
        idx = [i for i in range(len(X)) if src[i] == s]
        by_src[s] = (np.mean([ideas[int(P[i].argmax())] in Y[i] for i in idx]), np.mean([any(ideas[k] in Y[i] for k in np.argsort(-P[i])[:3]) for i in idx]))

    # final models on all expert data
    final = {idea: fit(idea, X, Y) for idea in ideas}
    with open(a.model, 'wb') as f:
        pickle.dump({'ideas': ideas, 'models': final, 'names': POS_NAMES + MOVE_NAMES + EXTRA_NAMES}, f)

    # 2. outside check on human comments
    test = collections.defaultdict(list)
    for r in load_rows(a.inputs, trust={'comment', 'expert-comment'}, limit_per_src=a.comments):
        if r['src'] in weak_src:
            continue
        x = features(r['fen'], r['uci'])
        if x is not None:
            test[r['src']].append((x, set(r['labels'])))
    md = ["# Idea namer v2: trained on expert labels, checked on human comments\n",
          f"Trained on {len(X):,} expert-labelled best moves: the Strategic Test Suite and the WGM-reviewed positional puzzles. "
          f"{len(ideas)} ideas have enough examples for their own model.\n",
          "## 1. Inside the expert data (5-fold cross-validation)\n",
          f"Top idea correct: **{100 * top1:.0f}%**. Right idea among the top three: **{100 * top3:.0f}%**.\n",
          '| Source | Top idea correct | In top three |', '|---|---|---|']
    md += [f'| {s} | {100 * t1:.0f}% | {100 * t3:.0f}% |' for s, (t1, t3) in by_src.items()]
    md += ['', '| Idea | Expert examples | AUC (1.0 perfect, 0.5 guessing) |', '|---|---|---|']
    md += [f'| {i} | {n} | {auc:.2f} |' for i, n, auc in sorted(rows_cv, key=lambda r: -r[2])]
    md += ['', "## 2. Outside check: human comments the model never saw\n",
           "For every comment that names an idea, the model scores the commented move. AUC compares those moves with all other commented moves from the same source: 0.5 means the model cannot tell them apart, 1.0 means it always ranks the named moves higher.\n",
           '| Source | Commented moves | Idea named in comment | Comments naming it | AUC |', '|---|---|---|---|---|']
    summary = []
    for s, items in sorted(test.items()):
        Xs = np.array([x for x, _ in items], dtype=float)
        for idea in ideas:
            y = np.array([idea in ls for _, ls in items], dtype=int)
            if y.sum() < 15 or y.sum() == len(y):
                continue
            p = final[idea].predict_proba(Xs)[:, 1]
            auc = roc_auc_score(y, p)
            summary.append((s, idea, auc, int(y.sum())))
            md.append(f'| {s} | {len(items):,} | {idea} | {int(y.sum())} | {auc:.2f} |')
    if summary:
        w = sum(n for *_, n in summary)
        md += ['', f"Weighted average AUC across all checks: **{sum(auc * n for _, _, auc, n in summary) / w:.2f}**.\n"]
    md += ['## Reading this honestly\n',
           '- Comment labels come from words in the text ("outpost", "open file", "pawn break"). A comment can mention an idea without the move serving it, so this check is noisy and the true agreement is higher than it shows, not lower.',
           '- Expert sets are small (3,700 moves). Ideas with few examples are the least reliable.',
           '- The namer is told the move. Finding a good move is the engine\'s job.', '']
    with open(a.report, 'w', encoding='utf-8') as f:
        f.write('\n'.join(md))
    print('\n'.join(md))


if __name__ == '__main__':
    sys.exit(main())
