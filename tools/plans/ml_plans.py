"""Plans lab, step 4: can a model predict the plan better than a simple rule?

Question: at move 12, one side (the "mover") has castled and so has the other. Will the mover push pawns against the
enemy king (the "attack on their king" label of plan_stats.py) at moves 13 to 25?

Stage 1 (build) replays every game to move 12, writes one row per side with a table of features, plus the label.
Stage 2 (eval) trains on the first months and tests on the last months, against two baselines:
  A. castling sides only (who castled where, same side or opposite),
  B. A plus what each side's pawns did in the last five moves (the "momentum" rule: you keep doing what you were doing),
  C. the full table (pawn structure by file, pieces by wing, king safety, fianchettos, bishops, ratings).
Tested overall and on lines built to be attacking (Mar del Plata, Samisch, Four Pawns ...).

    python tools/plans/ml_plans.py build kid-2023-*.jsonl.gz --out table.npz
    python tools/plans/ml_plans.py eval table.npz --out-dir lab/plans/out --name kid

Needs: python-chess, numpy, scikit-learn. Nothing here is imported by the app.
"""
import argparse
import concurrent.futures as cf
import gzip
import json
import os
import sys

import chess
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from features import WING, snapshot, advance  # noqa: E402

AT, UNTIL, MIN_MOVES = 12, 25, 2
WINGS = 'QCK'
SPEEDS = {'blitz': 0, 'rapid': 1, 'classical': 2}


def wing_of(sq):
    return WING[chess.square_file(sq)]


def piece_wing_counts(board, color):
    out = []
    for t in (chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN):
        c = dict.fromkeys(WINGS, 0)
        for sq in board.pieces(t, color):
            c[wing_of(sq)] += 1
        out += [c[w] for w in WINGS]
    return out


def bishops_by_colour(board, color):
    light = dark = 0
    for sq in board.pieces(chess.BISHOP, color):
        if (chess.square_file(sq) + chess.square_rank(sq)) % 2 == 1:
            light += 1
        else:
            dark += 1
    return [light, dark]


def fianchetto(board, color):
    sqs = (chess.G2, chess.B2) if color == chess.WHITE else (chess.G7, chess.B7)
    return [1 if board.piece_at(s) == chess.Piece(chess.BISHOP, color) else 0 for s in sqs]


def lead_pawns(board, color):
    best = [-1] * 8
    for sq in board.pieces(chess.PAWN, color):
        f = chess.square_file(sq)
        best[f] = max(best[f], advance(sq, color))
    return best


def names():
    n = []
    for who in ('own', 'enemy'):
        n += [f'{who}_castle_K', f'{who}_castle_Q', f'{who}_castle_none', f'{who}_castle_move']
    n += ['enemy_side_K', 'same_side']
    for who in ('own', 'enemy'):
        n += [f'{who}_lead_{f}' for f in 'abcdefgh']
    for who in ('own', 'enemy'):
        for w in WINGS:
            n += [f'{who}_pawns_{w}', f'{who}_adv_{w}']
    for who in ('own', 'enemy'):
        n += [f'{who}_men_{p}' for p in 'PNBRQ']
    n += ['own_shield', 'enemy_shield', 'own_zone_attacks', 'enemy_zone_attacks', 'own_adv_pieces', 'enemy_adv_pieces']
    n += ['open_on_target', 'half_open_own_on_target', 'half_open_enemy_on_own', 'open_files_total']
    for who in ('own', 'enemy'):
        for p in 'NBRQ':
            n += [f'{who}_{p}_{w}' for w in WINGS]
    for who in ('own', 'enemy'):
        n += [f'{who}_bishop_light', f'{who}_bishop_dark', f'{who}_fian_K', f'{who}_fian_Q']
    for when in ('recent', 'early'):
        for who in ('own', 'enemy'):
            n += [f'{who}_pm_{when}_{w}' for w in WINGS]
    n += ['own_pm_recent_target', 'own_pm_recent_other', 'own_rating', 'enemy_rating', 'rating_diff', 'speed', 'own_white']
    return n


NAMES = names()


def side_row(board, snap, color, castle, pm, meta):
    me, en = ('w', 'b') if color == chess.WHITE else ('b', 'w')
    ec = castle[en]
    oc = castle[me]
    target = ec[0]
    v = []
    for c in (oc, ec):
        v += [1 if c and c[0] == 'K' else 0, 1 if c and c[0] == 'Q' else 0, 0 if c else 1, c[1] if c else 0]
    v += [1 if target == 'K' else 0, 1 if oc and oc[0] == target else 0]
    v += lead_pawns(board, color) + lead_pawns(board, not color)
    for k in (me, en):
        for w in WINGS:
            v += snap['pawns_' + k][w]
    for k in (me, en):
        v += [snap['men_' + k][p] for p in 'PNBRQ']
    v += [snap['shield_' + me], snap['shield_' + en], snap['king_zone_attacks_' + me], snap['king_zone_attacks_' + en],
          snap['advanced_pieces_' + me], snap['advanced_pieces_' + en]]
    files_of = lambda s: [ord(ch) - 97 for ch in s]
    on_target = lambda fs: sum(1 for f in fs if WING[f] == target)
    on_own = lambda fs: sum(1 for f in fs if WING[f] == oc[0]) if oc else 0
    v += [on_target(files_of(snap['open_files'])), on_target(files_of(snap['half_open_' + me])),
          on_own(files_of(snap['half_open_' + en])), len(snap['open_files'])]
    v += piece_wing_counts(board, color) + piece_wing_counts(board, not color)
    v += bishops_by_colour(board, color) + fianchetto(board, color) + bishops_by_colour(board, not color) + fianchetto(board, not color)
    for lo, hi in ((AT - 4, AT), (0, AT - 5)):
        for k in (me, en):
            v += [sum(1 for m in pm[k][w] if lo < m <= hi) for w in WINGS]
    recent = {w: sum(1 for m in pm[me][w] if AT - 4 < m <= AT) for w in WINGS}
    v += [recent[target], sum(recent[w] for w in WINGS if w != target)]
    own_r, en_r = (meta['w'], meta['b']) if color == chess.WHITE else (meta['b'], meta['w'])
    v += [own_r, en_r, own_r - en_r, SPEEDS.get(meta['speed'], 1), 1 if color == chess.WHITE else 0]
    return v


def label(pm, key, target):
    counts = {w: sum(1 for m in pm[key][w] if AT < m <= UNTIL) for w in WINGS}
    top = max(counts.values())
    return int(counts[target] >= MIN_MOVES and counts[target] == top and counts[target] > max(v for k, v in counts.items() if k != target))


def process(line):
    g = json.loads(line)
    if g['plies'] < UNTIL * 2:
        return []
    board = chess.Board()
    castle = {'w': None, 'b': None}
    pm = {'w': {w: [] for w in WINGS}, 'b': {w: [] for w in WINGS}}
    snap = fen = None
    try:
        for ply, san in enumerate(g['moves'].split()[:UNTIL * 2]):
            move = board.parse_san(san)
            key = 'w' if board.turn == chess.WHITE else 'b'
            no = ply // 2 + 1
            if board.is_castling(move):
                castle[key] = ['K' if chess.square_file(move.to_square) == 6 else 'Q', no]
            elif board.piece_type_at(move.from_square) == chess.PAWN:
                pm[key][wing_of(move.from_square)].append(no)
            board.push(move)
            if ply == AT * 2 - 1:
                snap, at_board = snapshot(board), board.copy()
                at_castle = {k: (c if c and c[1] <= AT else None) for k, c in castle.items()}
                pm_at = {k: {w: list(l) for w, l in d.items()} for k, d in pm.items()}
    except ValueError:
        return []
    if snap is None:
        return []
    rows = []
    for color in (chess.WHITE, chess.BLACK):
        en = 'b' if color == chess.WHITE else 'w'
        if at_castle[en] is None:
            continue
        me = 'w' if color == chess.WHITE else 'b'
        rows.append((side_row(at_board, snap, color, at_castle, pm_at, g), label(pm, me, at_castle[en][0]),
                     g['date'][:7], g['opening'], 1 if color == chess.WHITE else 0))
    return rows


def build(a):
    X, y, month, opening, white = [], [], [], [], []
    ops = {}
    done = 0
    with cf.ProcessPoolExecutor(max(1, (os.cpu_count() or 2) - 1)) as pool:
        def lines():
            for p in a.inputs:
                for line in gzip.open(p, 'rt', encoding='utf-8'):
                    yield line
        for rows in pool.map(process, lines(), chunksize=200):
            for vec, lab, m, op, wh in rows:
                X.append(vec); y.append(lab); month.append(m); white.append(wh)
                opening.append(ops.setdefault(op, len(ops)))
            done += 1
            if done % 50000 == 0:
                print(f'  {done:,} games', flush=True)
    months = sorted(set(month))
    np.savez_compressed(a.out, X=np.array(X, dtype=np.float32), y=np.array(y, dtype=np.int8),
                        month=np.array([months.index(m) for m in month], dtype=np.int8), months=np.array(months),
                        opening=np.array(opening, dtype=np.int32), openings=np.array(list(ops)), white=np.array(white, dtype=np.int8),
                        names=np.array(NAMES))
    print(f'rows {len(X):,}, features {len(NAMES)} -> {a.out}')


def eval_(a):
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.inspection import permutation_importance
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import log_loss, roc_auc_score
    from sklearn.preprocessing import StandardScaler
    from sklearn.pipeline import make_pipeline

    d = np.load(a.table, allow_pickle=False)
    X, y, month, white = d['X'], d['y'], d['month'], d['white']
    ops = d['openings']
    op_of = ops[d['opening']]
    nm = list(d['names'])
    train, test = month < 9, month >= 9
    print(f'train rows {train.sum():,}, test rows {test.sum():,}; label rate train {y[train].mean():.3f}, test {y[test].mean():.3f}')

    def cols(prefixes):
        return [i for i, n in enumerate(nm) if any(n.startswith(p) for p in prefixes)]
    sets = {
        'A castling only': cols(['own_castle', 'enemy_castle', 'enemy_side', 'same_side', 'own_white']),
        'B castling + recent pawn moves': cols(['own_castle', 'enemy_castle', 'enemy_side', 'same_side', 'own_white', 'own_pm_recent', 'enemy_pm_recent', 'own_pm_early']),
        'C full table': list(range(len(nm))),
    }
    models, res = {}, []

    def fit(name, idx):
        if name.startswith('C'):
            m = HistGradientBoostingClassifier(max_iter=250, learning_rate=0.08, max_leaf_nodes=31, early_stopping=True, random_state=0)
        else:
            m = make_pipeline(StandardScaler(), LogisticRegression(max_iter=500))
        m.fit(X[train][:, idx], y[train])
        models[name] = (m, idx)

    for name, idx in sets.items():
        fit(name, idx)
    # prior-only baseline: always the training rate
    rate = y[train].mean()

    def score(mask, name):
        m, idx = models[name]
        p = m.predict_proba(X[mask][:, idx])[:, 1]
        return roc_auc_score(y[mask], p), log_loss(y[mask], p)

    def block(mask, title):
        rows = [f'| {name} | ' + ' | '.join(f'{v:.3f}' for v in score(mask, name)) + ' |' for name in sets]
        base_ll = log_loss(y[mask], np.full(mask.sum(), rate))
        return [f'**{title}**: {mask.sum():,} rows, {y[mask].mean() * 100:.0f}% attack. Always guessing the average gives log loss {base_ll:.3f}.\n',
                '| Model | AUC (1.0 perfect, 0.5 guessing) | Log loss (lower is better) |', '|---|---|---|'] + rows + ['']

    md = [f'# Can a model predict the plan? ({a.name})\n',
          f'Question: with both sides castled by move 12, will the side push pawns against the enemy king over moves 13 to 25? '
          f'Trained on the first nine months of 2023, tested on October to December.\n']
    md += block(test, 'All test games')
    md += block(test & (white == 1), 'White to plan')
    md += block(test & (white == 0), 'Black to plan')
    # lines built to be attacking, and the plain "both castled the same side" case
    md.append('## Lines built to attack (test months)\n')
    for key in ('Mar del Plata', 'Samisch', 'Four Pawns', 'Averbakh', 'Fianchetto', 'Classical'):
        mask = test & np.array([key.lower() in str(o).lower().replace('ä', 'a') for o in op_of])
        if mask.sum() > 800 and 0 < y[mask].mean() < 1:
            md += block(mask, key)
    # opposite castling is where attacks are real
    opp = test & (X[:, nm.index('same_side')] == 0)
    md += ['## Opposite-side castling only\n'] + block(opp, 'Opposite sides')
    # what drives the full model
    sub = np.random.RandomState(0).choice(np.where(test)[0], size=min(20000, test.sum()), replace=False)
    m, idx = models['C full table']
    imp = permutation_importance(m, X[sub][:, idx], y[sub], scoring='roc_auc', n_repeats=3, random_state=0)
    order = np.argsort(-imp.importances_mean)[:15]
    md += ['## What the full model leans on\n', 'Drop in AUC when that feature is scrambled.\n', '| Feature | AUC lost |', '|---|---|']
    md += [f'| {nm[idx[i]]} | {imp.importances_mean[i]:.4f} |' for i in order]
    md += ['', '## Reading this honestly\n',
           '- "Plan" here is the pawn-move label from plan_stats.py, a rough rule. Predicting it is not the same as understanding a position.',
           '- A model that beats B only a little means most of the signal is momentum (what each side was already doing).',
           '- Test games come from later months than training games but the same pool of players.', '']
    os.makedirs(a.out_dir, exist_ok=True)
    path = os.path.join(a.out_dir, f'{a.name}-model.md')
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(md))
    print('\n'.join(md))
    print('->', path)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    b = sub.add_parser('build'); b.add_argument('inputs', nargs='+'); b.add_argument('--out', required=True)
    e = sub.add_parser('eval'); e.add_argument('table'); e.add_argument('--out-dir', default='lab/plans/out'); e.add_argument('--name', default='kid')
    a = ap.parse_args()
    build(a) if a.cmd == 'build' else eval_(a)


if __name__ == '__main__':
    sys.exit(main())
