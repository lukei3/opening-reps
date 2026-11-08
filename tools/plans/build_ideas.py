"""Plans lab: name the idea behind each good move in the common King's Indian positions (data/plans/ideas.json).

Uses the namer from namer2.py (one model per idea, trained on expert labels and human comments).

    python tools/plans/build_ideas.py namer2.pkl lab/plans/data/kid-positions.json lines-*.jsonl --report REPORT.md --out data/plans/ideas.json
"""
import argparse
import collections
import json
import os
import pickle
import sys

import chess
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from namer2 import features  # noqa: E402

NAMES = {
    'knight_outpost': 'Put a knight on a strong square', 'piece_activity': 'Activate a piece', 'open_file': 'Take an open file or diagonal',
    'seventh_rank': 'Rook or queen to the 7th rank', 'pawn_break': 'Pawn break: undermine their pawns', 'kingside_pawns': 'Push the kingside pawns',
    'queenside_pawns': 'Push the queenside pawns', 'centre_pawns': 'Pawn play in the centre', 'centre_control': 'Control the centre',
    'space': 'Gain space', 'king_safety': 'Look after the king', 'king_attack': 'Attack the king', 'king_activity': 'Activate the king',
    'exchange': 'Trade pieces', 'avoid_exchange': 'Avoid a pointless trade', 'bishop_vs_knight': 'Bishop for knight, or the reverse',
    'recapture': 'Recapture the right way', 'square_vacancy': 'Clear a square for another piece', 'prophylaxis': 'Prophylaxis: stop their idea first',
    'initiative': 'Keep the initiative', 'development': 'Develop a piece', 'coordination': 'Coordinate the pieces', 'weakness': 'Target a weakness',
    'restriction': 'Restrict their pieces', 'fix_structure': 'Fix their pawn structure', 'endgame_technique': 'Endgame technique',
    'material': 'Win material', 'sacrifice': 'Sacrifice', 'passed_pawn': 'Passed pawn', 'bishop_pair': 'Bishop pair', 'minority_attack': 'Minority attack',
}
GOOD_CP = 50
SURE = 0.30          # below this the namer says it has no clear idea instead of guessing


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('model')
    ap.add_argument('positions')
    ap.add_argument('lines', nargs='+')
    ap.add_argument('--out', required=True)
    ap.add_argument('--report', required=True)
    a = ap.parse_args()
    with open(a.model, 'rb') as f:
        m = pickle.load(f)
    ideas, models = m['ideas'], m['models']

    def name(rows):
        X = np.array(rows, dtype=float)
        P = np.column_stack([models[i].predict_proba(X)[:, 1] for i in ideas])
        out = []
        for p in P:
            order = np.argsort(-p)
            out.append([(ideas[k], float(p[k])) for k in order[:3]])
        return out

    positions = json.load(open(a.positions, encoding='utf-8'))
    lines = {}
    for p in a.lines:
        for raw in open(p, encoding='utf-8'):
            r = json.loads(raw)
            lines[r['fen']] = r['lines']
    out, use = [], collections.Counter()
    for pos in positions:
        eng = lines.get(pos['fen'])
        if not eng:
            continue
        board = chess.Board(pos['fen'])
        sign = 1 if board.turn == chess.WHITE else -1
        best = max(sign * l['cp'] for l in eng)
        good = [l for l in eng if best - sign * l['cp'] <= GOOD_CP]
        feats = [features(pos['fen'], l['uci']) for l in good]
        keep = [(l, x) for l, x in zip(good, feats) if x is not None]
        named = name([x for _, x in keep]) if keep else []
        groups = collections.OrderedDict()
        for (l, _), top in zip(keep, named):
            idea, p = top[0]
            if p < SURE:
                idea = 'unclear'
            pv_board = board.copy(); sans = []
            for u in l['pv'][:8]:
                mv = chess.Move.from_uci(u)
                if mv not in pv_board.legal_moves:
                    break
                sans.append(pv_board.san(mv)); pv_board.push(mv)
            g = groups.setdefault(idea, {'theme': idea, 'name': 'No clear idea (the namer is not sure)' if idea == 'unclear' else NAMES.get(idea, idea), 'moves': []})
            g['moves'].append({'san': sans[0] if sans else l['uci'], 'uci': l['uci'], 'cp': sign * l['cp'], 'conf': round(p, 2),
                               'also': [{'theme': t, 'name': NAMES.get(t, t), 'p': round(q, 2)} for t, q in top[1:] if q >= 0.35],
                               'pv': sans})
            use[idea] += 1
        legal = {board.san(mv): mv for mv in board.legal_moves}
        pm = [(d, legal[d['san']]) for d in pos['played'] if d['san'] in legal]
        pf = [(d, mv, features(pos['fen'], mv.uci())) for d, mv in pm]
        pf = [t for t in pf if t[2] is not None]
        played = []
        for (d, mv, _), top in zip(pf, name([x for *_, x in pf]) if pf else []):
            on = any(x['uci'] == mv.uci() for g in groups.values() for x in g['moves'])
            sure = top[0][1] >= SURE
            played.append({'san': d['san'], 'share': round(d['n'] / pos['games'], 3), 'adj': d['adj'], 'theme': top[0][0] if sure else 'unclear',
                           'name': NAMES.get(top[0][0], top[0][0]) if sure else 'no clear idea', 'conf': round(top[0][1], 2), 'engine_good': on})
        if 'unclear' in groups:
            groups.move_to_end('unclear')
        out.append({'fen': pos['fen'], 'games': pos['games'], 'line': pos['line'], 'side': 'w' if board.turn == chess.WHITE else 'b',
                    'best_cp': sign * best, 'ideas': list(groups.values()), 'played': played})
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump({'source': "King's Indian games (Lichess 2023) + Stockfish depth 18 + idea namer v2", 'positions': out}, f, ensure_ascii=False, separators=(',', ':'))
    md = ['# Ideas named in the 300 common King\'s Indian positions\n', '| Idea | Good moves given this idea |', '|---|---|']
    md += [f'| {NAMES.get(k, "No clear idea") } | {v} |' for k, v in use.most_common()]
    with open(a.report, 'w', encoding='utf-8') as f:
        f.write('\n'.join(md) + '\n')
    print(f'{len(out)} positions -> {a.out}'); print('\n'.join(md))


if __name__ == '__main__':
    sys.exit(main())
