"""Plans lab: name the idea behind a move, and build the app's ideas data.

The namer is trained on the 1,500 expert-labelled STS positions (see verify_sts.py: 80% right on positions it never saw).
It is then applied to the engine's best moves and to the moves real players chose in the common King's Indian positions,
and moves that serve the same idea are grouped.

    python tools/plans/idea_namer.py lab/plans/data/kid-positions.json lines-*.jsonl --out data/plans/ideas.json
"""
import argparse
import collections
import json
import os
import sys

import chess
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from verify_sts import load, move_features, position_features  # noqa: E402

NAMES = {
    'Undermine': 'Undermine their pawns (a pawn break)',
    'Open Files and Diagonals': 'Open a file or diagonal for a long-range piece',
    'Knight Outposts': 'Put a knight on a strong square',
    'Square Vacancy': 'Clear a square for another piece',
    'Bishop vs Knight': 'Trade a bishop for a knight, or the reverse',
    'Recapturing': 'Recapture the right way',
    'Offer of Simplification': 'Offer a trade',
    'AKPC': 'Push the kingside pawns',
    'Advancement of a/b/c pawns': 'Push the queenside pawns',
    'Simplification': 'Simplify by trading',
    'King Activity': 'Activate the king',
    'Center Control': 'Control the centre',
    'Pawn Play in the Center': 'Pawn play in the centre',
    '7th Rank': 'Rook or queen to the 7th rank',
    'AT': 'Avoid a pointless trade',
}
GOOD_CP = 50          # moves within half a pawn of the engine's best count as good


def train():
    from sklearn.ensemble import HistGradientBoostingClassifier
    data = load()
    themes = sorted({t for _, t, _ in data})
    X, y = [], []
    for fen, theme, uci in data:
        b = chess.Board(fen)
        X.append(position_features(b) + move_features(b, chess.Move.from_uci(uci)))
        y.append(themes.index(theme))
    m = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.06, max_leaf_nodes=15, random_state=0)
    m.fit(np.array(X, dtype=float), np.array(y))
    return m, themes


def name_moves(model, themes, board, moves):
    if not moves:
        return []
    X = np.array([position_features(board) + move_features(board, mv) for mv in moves], dtype=float)
    P = model.predict_proba(X)
    out = []
    for row in P:
        k = int(row.argmax())
        out.append((themes[k], float(row[k])))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('positions')
    ap.add_argument('lines', nargs='+')
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    model, themes = train()
    with open(a.positions, encoding='utf-8') as f:
        positions = json.load(f)
    lines = {}
    for p in a.lines:
        for raw in open(p, encoding='utf-8'):
            r = json.loads(raw)
            lines[r['fen']] = r['lines']
    out = []
    counts = collections.Counter()
    for pos in positions:
        eng = lines.get(pos['fen'])
        if not eng:
            continue
        board = chess.Board(pos['fen'])
        me = board.turn
        sign = 1 if me == chess.WHITE else -1
        best = max(sign * l['cp'] for l in eng)
        good = [l for l in eng if best - sign * l['cp'] <= GOOD_CP]
        mvs = [chess.Move.from_uci(l['uci']) for l in good]
        named = name_moves(model, themes, board, mvs)
        groups = collections.OrderedDict()
        for l, mv, (theme, prob) in zip(good, mvs, named):
            pv_board = board.copy()
            sans = []
            for u in l['pv'][:8]:
                m = chess.Move.from_uci(u)
                if m not in pv_board.legal_moves:
                    break
                sans.append(pv_board.san(m)); pv_board.push(m)
            g = groups.setdefault(theme, {'theme': theme, 'name': NAMES[theme], 'moves': []})
            g['moves'].append({'san': board.san(mv), 'uci': l['uci'], 'cp': sign * l['cp'], 'conf': round(prob, 2), 'pv': sans})
            counts[theme] += 1
        # what real players chose, and which idea it serves
        played = []
        legal = {board.san(m): m for m in board.legal_moves}
        pm = [(d, legal[d['san']]) for d in pos['played'] if d['san'] in legal]
        for (d, mv), (theme, prob) in zip(pm, name_moves(model, themes, board, [m for _, m in pm])):
            on = any(m['uci'] == mv.uci() for g in groups.values() for m in g['moves'])
            played.append({'san': d['san'], 'share': round(d['n'] / pos['games'], 3), 'adj': d['adj'], 'theme': theme, 'name': NAMES[theme],
                           'conf': round(prob, 2), 'engine_good': on})
        out.append({'fen': pos['fen'], 'games': pos['games'], 'line': pos['line'], 'side': 'w' if me == chess.WHITE else 'b',
                    'best_cp': sign * best, 'ideas': list(groups.values()), 'played': played})
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump({'source': "King's Indian games (Lichess 2023) + Stockfish + an idea namer trained on the Strategic Test Suite",
                   'positions': out}, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(out)} positions -> {a.out}; ideas used: {counts.most_common()}')


if __name__ == '__main__':
    sys.exit(main())
