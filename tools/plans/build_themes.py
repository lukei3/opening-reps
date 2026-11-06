"""Plans lab: build data/plans/themes.json for the Themes tab.

Joins the mined numbers (lab/plans/out/kid-themes.json) with explanations written by hand below, and with a typical real
position for each structure (data/plans/kid.json). The explanations are Claude's, written from general chess knowledge and the
numbers; every figure shown in the app comes from the data.

    python tools/plans/build_themes.py
"""
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
KINDS = {'man': 'manoeuvres', 'push': 'pushes', 'exch': 'exchanges', 'trade': 'traded'}

CUR = {
    'White d5 + e4; Black d6 + e5': {
        'name': 'Locked centre: d5 and e4 against d6 and e5',
        'summary': {
            'b': "The centre is locked, so the game is decided on the wings. Black's plan is a kingside pawn advance (…f5, …f4, …g5, …g4), helped by knights heading for f4 and h5. White's plan is on the queenside (c4–c5, b4). Each side is racing the other.",
            'w': "White wants to open the queenside with c4–c5 (and b4) before Black's kingside play arrives. Pushing your own kingside pawns (f4, g4, h4) is what the data punishes.",
        },
        'items': {
            'b': [('man', 'N f6-h5-f4', 'Knight to f4 via h5', "The standout manoeuvre. A knight on f4 eyes White's kingside (g2, h3, e2) and supports a later …g5-g4."),
                  ('push', 'f5', 'The …f5 break', "The standard start of Black's kingside play. On its own it is neutral in the data; what follows (…f4, …g5, …g4) is what decides."),
                  ('push', 'g4', 'The …g4 push', 'Reached in fewer games (13%) and later (around move 20), but those games did better. It probably marks a storm that has got going.')],
            'w': [('push', 'c5', 'The c4–c5 break', "White's main idea: c5 opens the queenside and hits d6."),
                  ('push', 'b4', 'b4', 'Usually prepares c5. Played in about a quarter of games.'),
                  ('exch', 'PxP on c6', 'Taking on c6', 'A White pawn capturing on c6 follows queenside opening and scored well.')],
        },
        'watch': {
            'b': [('exch', 'PxP on c5', 'Capturing on c5', "Usually Black accepting White's c4–c5 break. The worst result of anything listed for Black here."),
                  ('trade', 'bishop from c8 traded', 'Losing the c8 bishop', 'Traded in about half the games, and those games went worse.'),
                  ('push', 'b6', 'Queenside pawn moves (…b6, …b5)', 'Spending moves on the queenside scored worse than keeping to the kingside plan.')],
            'w': [('push', 'f4', 'Pushing the f-pawn', "Meets Black's …f5 plan head-on. Scored well below expectation."),
                  ('push', 'g4', 'Pushing the g-pawn', 'The same problem: it weakens White while Black is racing.'),
                  ('trade', 'bishop from c1 traded', 'Losing the c1 bishop', "White's dark-squared bishop. Games where it was traded went clearly worse.")],
        },
    },
    'White d5 + e4; Black d6 + e7': {
        'name': 'Benoni-style: d5 and e4 against d6, Black\'s e-pawn at home',
        'summary': {
            'b': "Black has not played …e5. The e5 square is guarded by the d6 pawn, so knights land there and go on to c4 or d3, and those manoeuvres score very well. Queenside pawn play (…b5, …b4, …c4) works. Opening the centre with …e6, …e5, …f5 or …f6 scores worse.",
            'w': "White's plan is the central break e4–e5, and trading Black's dark-squared bishop on g7. Both go with clearly better results.",
        },
        'items': {
            'b': [('man', 'N d7-e5-c4', 'Knight d7–e5–c4', 'A knight reaching e5 and then c4. The best manoeuvre in this structure.'),
                  ('man', 'N f6-d7-e5', 'Knight f6–d7–e5', 'The usual way to reach the e5 square.'),
                  ('push', 'b4', 'The …b4 push', 'Queenside expansion with a pawn that gains space and fixes White.')],
            'w': [('push', 'e5', 'The e4–e5 break', "White's central lever, played in 29% of games and scoring clearly above expectation."),
                  ('exch', 'BxB on g7', 'Trading on g7', "Removes Black's key defensive bishop."),
                  ('man', 'B e3-h6-g7', 'Bishop e3–h6–g7', "The bishop's route to challenge g7.")],
        },
        'watch': {
            'b': [('push', 'e6', 'Opening the centre (…e6)', 'Scored well below expectation.'),
                  ('push', 'f5', 'The …f5 push', 'Does worse here than in the locked centre.'),
                  ('exch', 'PxP on e5', 'Pawn exchanges on e5', 'The worst exchange for Black here.'),
                  ('trade', 'bishop from f8 traded', 'Losing the f8 bishop', "Black's dark-squared bishop. Games where it was traded went worse.")],
            'w': [('push', 'h4', 'The h4 push', 'Scored worse than the alternatives.'),
                  ('trade', 'bishop from f1 traded', 'Losing the f1 bishop', 'Games where it was traded went worse.')],
        },
    },
    'White d pawn gone + e4; Black d6 + e pawn gone': {
        'name': "Sicilian-style: White's d-pawn traded for Black's e-pawn",
        'summary': {
            'b': "White's d-pawn and Black's e-pawn have been exchanged, leaving e4 against d6 and an open d-file. Black's useful moves hit e4 and trade the dark-squared bishops on White's terms: …Nxe4 and …Bxc3 scored well. Recapturing on g7 with the king, and pawn pushes like …f5 or …g5, scored worse.",
            'w': "The d5 square is open for a White knight (it comes from c3 and takes on f6 or c7). Trading the dark-squared bishops on g7 and pushing e4–e5 both scored well.",
        },
        'items': {
            'b': [('exch', 'NxP on e4', 'Taking on e4 with the knight', 'Hits the centre pawn. The best exchange for Black here.'),
                  ('exch', 'BxN on c3', 'Trading on c3', 'Damages White\'s structure.')],
            'w': [('man', 'N c3-d5-f6', 'Knight to d5, then f6', 'The standout manoeuvre. With Black\'s e-pawn gone, d5 is hard for Black to cover.'),
                  ('exch', 'BxB on g7', 'Trading the dark-squared bishops', 'Played in 13% of games and scored clearly above expectation.'),
                  ('push', 'e5', 'The e4–e5 push', 'Opens lines when White is ready.')],
        },
        'watch': {
            'b': [('exch', 'KxB on g7', 'Recapturing with the king on g7', 'After White trades the bishops, the king on g7 scored badly.'),
                  ('push', 'g5', 'The …g5 push', 'Scored worse in this structure.'),
                  ('push', 'f5', 'The …f5 push', 'Scored worse in this structure.')],
            'w': [('push', 'h3', 'The h3 push', 'Scored worse than the alternatives.'),
                  ('trade', 'bishop from c1 traded', 'Losing the c1 bishop', 'Games where it was traded went worse.')],
        },
    },
}


def main():
    with open(os.path.join(ROOT, 'lab', 'plans', 'out', 'kid-themes.json'), encoding='utf-8') as f:
        mined = json.load(f)
    with open(os.path.join(ROOT, 'data', 'plans', 'kid.json'), encoding='utf-8') as f:
        kid = json.load(f)
    fens = {s['title']: s for s in kid['structures']}
    out = {'name': "King's Indian", 'games': mined['games'], 'structures': []}
    for card in mined['structures']:
        cur = CUR.get(card['title'])
        pos = fens.get(card['title'], {})
        entry = {'title': cur['name'] if cur else card['title'], 'raw': card['title'], 'games': card['games'], 'fen': pos.get('fen'),
                 'written': bool(cur), 'sides': {}}
        for side in ('b', 'w'):
            data = card['sides'][side]

            def find(kind, item):
                for d in data[KINDS[kind]]:
                    if d['item'] == item:
                        return d
                raise SystemExit(f"missing in the data: {card['title']} / {side} / {kind} / {item}")

            def pack(rows):
                res = []
                for kind, item, title, text in rows:
                    d = find(kind, item)
                    res.append({'kind': kind, 'item': item, 'title': title, 'text': text, 'share': d['share'], 'diff': d['diff'], 'ci': d['ci'],
                                'median_move': d.get('median_move')})
                return res
            s = {'summary': cur['summary'][side] if cur else None,
                 'ideas': pack(cur['items'][side]) if cur else [], 'watch': pack(cur['watch'][side]) if cur else [],
                 'more': {k: [x for x in data[KINDS[k]][:8]] for k in ('man', 'push', 'exch', 'trade')},
                 'placement': data['placement']}
            entry['sides'][side] = s
        out['structures'].append(entry)
    path = os.path.join(ROOT, 'data', 'plans', 'themes.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print('wrote', path, os.path.getsize(path), 'bytes;', sum(1 for s in out['structures'] if s['written']), 'written cards')


if __name__ == '__main__':
    sys.exit(main())
