"""Plans lab, step 3: count what happens next, and what each plan scores.

Reads the file written by features.py. For the position at one move (default 12) it groups games by structure, then
looks at the next stretch of the game (default moves 13 to 25) and labels what each side did with its pawns:

  attack on their king   at least 2 pawn moves on the wing where the enemy king castled, and more than on any other wing
  play on the other wing at least 2 pawn moves on the opposite wing, and more than on any other wing
  central play           at least 2 pawn moves in the centre (d and e files), and more than on any wing
  quiet                  none of the above

Results are compared with what the ratings predict (the Elo expected score), so a plan is not credited for simply being
chosen by stronger players. Writes a Markdown report and a JSON file. Nothing here is imported by the app.

    python tools/plans/plan_stats.py features.jsonl.gz --name kid --out-dir lab/plans/out
"""
import argparse
import collections
import gzip
import json
import math
import os
import sys


def score_white(res):
    return {'1-0': 1.0, '0-1': 0.0}.get(res, 0.5)


def expected_white(w, b):
    return 1 / (1 + 10 ** ((b - w) / 400))


def describe_centre(key):
    """'w:d3e2|b:d1e2' -> 'White d5 + e4, Black d6 + e5' (the numbers are squares advanced from the start rank)."""
    try:
        wpart, bpart = key.split('|')
        def side(part, colour):
            body = part[2:]
            out = []
            for f in 'de':
                i = body.index(f)
                j = body.index('e', i + 1) if f == 'd' else len(body)
                val = body[i + 1:j]
                if val == '-':
                    out.append(f + ' pawn gone')
                else:
                    rank = int(val) + 2 if colour == 'w' else 7 - int(val)
                    out.append(f'{f}{rank}')
            return ' + '.join(out)
        return f'White {side(wpart, "w")}; Black {side(bpart, "b")}'
    except Exception:
        return key


def label_plan(counts, enemy_side, min_moves):
    """counts: {'Q': n, 'C': n, 'K': n} pawn moves in the window; enemy_side: 'K', 'Q' or None (not castled yet)."""
    top = max(counts.values())
    if enemy_side and counts[enemy_side] >= min_moves and counts[enemy_side] == top and counts[enemy_side] > max(v for k, v in counts.items() if k != enemy_side):
        return 'attack on their king'
    other = 'Q' if enemy_side == 'K' else 'K'
    if enemy_side and counts[other] >= min_moves and counts[other] == top and counts[other] > max(v for k, v in counts.items() if k != other):
        return 'play on the other wing'
    if counts['C'] >= min_moves and counts['C'] == top and counts['C'] > max(counts['K'], counts['Q']):
        return 'central play'
    return 'quiet'


class Cell:
    """Results for one group: how many games, the score, and the score against what the ratings predict."""
    def __init__(self):
        self.n = 0; self.score = 0.0; self.exp = 0.0; self.sq = 0.0

    def add(self, score, exp):
        self.n += 1; self.score += score; self.exp += exp
        self.sq += (score - exp) ** 2

    def row(self):
        if not self.n:
            return None
        mean = self.score / self.n
        adj = (self.score - self.exp) / self.n
        sd = math.sqrt(max(0.0, self.sq / self.n - adj * adj))
        ci = 1.96 * sd / math.sqrt(self.n)
        return {'n': self.n, 'score': round(mean, 3), 'vs_expected': round(adj, 3), 'ci': round(ci, 3)}


def fmt_row(label, r, total):
    if not r:
        return f'| {label} | 0 | | | |'
    flag = '' if r['n'] >= 100 else ' (few games)' if r['n'] >= 30 else ' (too few to trust)'
    return f"| {label} | {r['n']:,} ({100 * r['n'] / total:.0f}%) | {100 * r['score']:.1f}% | {100 * r['vs_expected']:+.1f} ± {100 * r['ci']:.1f}{flag} |"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('inputs', nargs='+')
    ap.add_argument('--name', default='kid')
    ap.add_argument('--out-dir', default='lab/plans/out')
    ap.add_argument('--at', type=int, default=12, help='the move whose position groups the games')
    ap.add_argument('--until', type=int, default=25, help='the last move of the stretch to label')
    ap.add_argument('--min-moves', type=int, default=2, help='pawn moves needed for a plan label (3 is stricter: far more games count as quiet)')
    a = ap.parse_args()
    at, until = str(a.at), a.until

    games = []
    for p in a.inputs:
        for line in gzip.open(p, 'rt', encoding='utf-8'):
            g = json.loads(line)
            if at in g['snap'] and g['plies'] >= 2 * until:
                games.append(g)
    n = len(games)
    if not n:
        print('no games reach that far'); return 1

    def window_counts(g, key):
        return {wing: sum(1 for m in g['pawn_moves'][key][wing] if a.at < m <= until) for wing in 'QCK'}

    def castled_by(g, key):
        c = g['castle'][key]
        return c[0] if c and c[1] <= a.at else None

    # --- overall ---
    rep = {'name': a.name, 'games': n, 'at_move': a.at, 'until_move': until}
    ratings = sorted((g['w'] + g['b']) // 2 for g in games)
    res = collections.Counter(g['res'] for g in games)
    md = []
    md.append(f"# Plans report: {a.name}\n")
    md.append(f"{n:,} whole games that reach move {until}. Typical rating {ratings[n // 2]}. Results: White wins {res['1-0']:,}, Black wins {res['0-1']:,}, draws {res['1/2-1/2']:,}.")
    md.append(f"Games are grouped by their position at move {a.at}; the pawn moves from move {a.at + 1} to {until} are labelled as plans. \"vs expected\" is the score minus what the rating gap predicts, in percentage points, with a 95% margin: positive means that choice beats what the ratings alone suggest.\n")

    # --- castling at the checkpoint ---
    combos = collections.defaultdict(Cell)
    for g in games:
        wc, bc = castled_by(g, 'w'), castled_by(g, 'b')
        combos[(wc or 'not yet', bc or 'not yet')].add(score_white(g['res']), expected_white(g['w'], g['b']))
    md.append(f"## Castling by move {a.at}\n")
    md.append('| White castled | Black castled | Games | White scores | vs expected |\n|---|---|---|---|---|')
    names = {'K': 'kingside', 'Q': 'queenside', 'not yet': 'not yet'}
    rep['castling'] = []
    for (wc, bc), c in sorted(combos.items(), key=lambda kv: -kv[1].n)[:6]:
        r = c.row(); rep['castling'].append({'white': wc, 'black': bc, **r})
        flag = '' if r['n'] >= 100 else ' (few games)'
        md.append(f"| {names[wc]} | {names[bc]} | {r['n']:,} ({100 * r['n'] / n:.0f}%) | {100 * r['score']:.1f}% | {100 * r['vs_expected']:+.1f} ± {100 * r['ci']:.1f}{flag} |")

    # --- what each side does next, overall ---
    side_cells = {'w': collections.defaultdict(Cell), 'b': collections.defaultdict(Cell)}
    pair_cells = collections.defaultdict(Cell)
    plan_of = {}
    for g in games:
        e = expected_white(g['w'], g['b']); s = score_white(g['res'])
        labels = {}
        for key, enemy in (('w', 'b'), ('b', 'w')):
            labels[key] = label_plan(window_counts(g, key), castled_by(g, enemy), a.min_moves)
        plan_of[g['id']] = labels
        side_cells['w'][labels['w']].add(s, e)
        side_cells['b'][labels['b']].add(1 - s, 1 - e)
        pair_cells[(g['snap'][at]['centre_key'], labels['w'], labels['b'])].add(s, e)
    for key, who in (('w', 'White'), ('b', 'Black')):
        md.append(f"\n## What {who} does with its pawns, moves {a.at + 1} to {until}, and what it scores\n")
        md.append('| Plan | Games | ' + who + ' scores | vs expected |\n|---|---|---|---|')
        rep['plans_' + key] = {}
        for lab in ('attack on their king', 'play on the other wing', 'central play', 'quiet'):
            c = side_cells[key].get(lab)
            if c:
                rep['plans_' + key][lab] = c.row()
            md.append(fmt_row(lab, c.row() if c else None, n))

    # --- the most common structures ---
    structs = collections.defaultdict(list)
    for g in games:
        structs[g['snap'][at]['centre_key']].append(g)
    md.append(f"\n## The most common centre structures at move {a.at}\n")
    md.append('| Centre | Games | White scores | vs expected |\n|---|---|---|---|')
    rep['structures'] = []
    top = sorted(structs.items(), key=lambda kv: -len(kv[1]))[:8]
    for key, gs in top:
        c = Cell()
        for g in gs:
            c.add(score_white(g['res']), expected_white(g['w'], g['b']))
        r = c.row(); rep['structures'].append({'centre_key': key, 'description': describe_centre(key), **r})
        md.append(f"| {describe_centre(key)} | {r['n']:,} ({100 * r['n'] / n:.0f}%) | {100 * r['score']:.1f}% | {100 * r['vs_expected']:+.1f} ± {100 * r['ci']:.1f} |")

    # --- plan cards for the biggest structures ---
    rep['cards'] = []
    for key, gs in top[:3]:
        if len(gs) < 30:
            continue
        md.append(f"\n## Plan card: {describe_centre(key)} ({len(gs):,} games)\n")
        cells = {'w': collections.defaultdict(Cell), 'b': collections.defaultdict(Cell)}
        for g in gs:
            e = expected_white(g['w'], g['b']); s = score_white(g['res'])
            lab = plan_of[g['id']]
            cells['w'][lab['w']].add(s, e); cells['b'][lab['b']].add(1 - s, 1 - e)
        card = {'centre_key': key, 'description': describe_centre(key), 'games': len(gs), 'white': {}, 'black': {}}
        for k, who in (('w', 'White'), ('b', 'Black')):
            md.append(f"**{who}'s plan in this structure**\n")
            md.append('| Plan | Games | ' + who + ' scores | vs expected |\n|---|---|---|---|')
            for lab in ('attack on their king', 'play on the other wing', 'central play', 'quiet'):
                c = cells[k].get(lab)
                if c:
                    card['white' if k == 'w' else 'black'][lab] = c.row()
                md.append(fmt_row(lab, c.row() if c else None, len(gs)))
            md.append('')
        rep['cards'].append(card)

    md.append('\n## Reading this honestly\n')
    md.append('- These are real players around the rating above, so the numbers describe what people do and what works for them, not what a grandmaster would play.')
    md.append('- A plan label is a rough rule about pawn moves, not a full understanding of the position. "Quiet" mixes genuinely quiet games with plans made of piece moves.')
    md.append('- Rows marked "few games" or "too few to trust" should not be believed; the margin shown is the guide.')
    md.append('- Stronger players tend to pick better plans; comparing with the rating-based expectation removes much, but not all, of that effect.')

    os.makedirs(a.out_dir, exist_ok=True)
    with open(os.path.join(a.out_dir, f'{a.name}-report.md'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(md) + '\n')
    with open(os.path.join(a.out_dir, f'{a.name}-report.json'), 'w', encoding='utf-8') as f:
        json.dump(rep, f, indent=1)
    print('\n'.join(md))


if __name__ == '__main__':
    sys.exit(main())
