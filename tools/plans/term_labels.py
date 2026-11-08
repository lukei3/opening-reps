"""Plans lab: turn Stockfish 11's evaluation changes into idea labels, and check them against people.

For every measured line (engine_terms.py), each evaluation part is taken from the mover's side (positive = good for the
side that played the move), averaged over middlegame and endgame weights, and compared at the start and at the end of the
eight-ply line. Each change is turned into a z-score across all lines, so "a big change" means big compared with what moves
usually do. A move's engine ideas are the parts that improved most (z >= 1), mapped to the shared vocabulary.

Then, on rows where people labelled the move (the expert sets, the books, Wikibooks, study comments), it reports how often the
engine's ideas agree with the human label compared with chance.

    python tools/plans/term_labels.py terms-*.jsonl --input lab/plans/data/terms-input.jsonl.gz --corpus CORPUS.jsonl.gz BOOKS.jsonl WIKI.jsonl --out engine-labels.jsonl.gz --report lab/plans/out/engine-labels-check.md
"""
import argparse
import collections
import gzip
import json
import math
import sys

import chess

# evaluation part -> (whose part counts, ideas it stands for)
PARTS = {
    'Mobility': ('total', ['piece_activity', 'coordination', 'development']),
    'King safety:own': ('own', ['king_safety']),
    'King safety:opp': ('opp', ['king_attack']),
    'Pawns': ('total', ['weakness', 'fix_structure', 'pawn_break']),
    'Passed': ('total', ['passed_pawn']),
    'Space': ('total', ['space', 'centre_control']),
    'Threats': ('total', ['initiative']),
    'Knights': ('total', ['knight_outpost']),
    'Bishops': ('total', ['bishop_pair', 'bishop_vs_knight']),
    'Rooks': ('total', ['open_file', 'seventh_rank']),
    'Material': ('total', ['material']),
    'Imbalance': ('total', ['exchange', 'bishop_vs_knight']),
    'Initiative': ('total', ['initiative']),
}


def part_value(ev, part, mover_white):
    """The mover's view of one evaluation part (pawns), middlegame and endgame averaged."""
    name, _, whose = part.partition(':')
    row = ev.get(name)
    if not row:
        return None
    avg = lambda a, b: None if a is None or b is None else (a + b) / 2
    w, b, t = avg(row[0], row[1]), avg(row[2], row[3]), avg(row[4], row[5])
    if whose == 'own':
        v = w if mover_white else b
    elif whose == 'opp':
        v = -(b if mover_white else w)          # their king safety going down is good for the mover
    else:
        v = t if mover_white else (None if t is None else -t)
    return v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('terms', nargs='+')
    ap.add_argument('--input', required=True)
    ap.add_argument('--corpus', nargs='+', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--report', required=True)
    a = ap.parse_args()

    recs = []
    for p in a.terms:
        for line in open(p, encoding='utf-8'):
            r = json.loads(line)
            if not r.get('end') or not r.get('start'):
                continue
            white = chess.Board(r['fen']).turn == chess.WHITE
            d = {}
            for part in PARTS:
                s, e = part_value(r['start'], part, white), part_value(r['end'], part, white)
                if s is not None and e is not None:
                    d[part] = e - s
            r['delta'] = d
            recs.append(r)
    print(f'{len(recs):,} measured lines', flush=True)
    # z-scores per part
    stats = {}
    for part in PARTS:
        xs = [r['delta'][part] for r in recs if part in r['delta']]
        if len(xs) > 30:
            m = sum(xs) / len(xs)
            sd = math.sqrt(sum((x - m) ** 2 for x in xs) / len(xs)) or 1.0
            stats[part] = (m, sd)
    for r in recs:
        z = {p: (r['delta'][p] - stats[p][0]) / stats[p][1] for p in r['delta'] if p in stats}
        top = sorted(((v, p) for p, v in z.items() if v >= 1.0), reverse=True)[:2]
        r['engine_ideas'] = [i for _, p in top for i in PARTS[p][1]]
        r['engine_parts'] = [p for _, p in top]
        r['z'] = {p: round(v, 2) for p, v in z.items()}
    with gzip.open(a.out, 'wt', encoding='utf-8') as f:
        for r in recs:
            f.write(json.dumps({'id': r['id'], 'fen': r['fen'], 'uci': r['uci'], 'line': r['line'], 'parts': r['engine_parts'],
                                'ideas': r['engine_ideas'], 'z': r['z']}, separators=(',', ':')) + '\n')

    # check against human labels: join by (position, move)
    human = {}
    for p in a.corpus:
        op = gzip.open if p.endswith('.gz') else open
        with op(p, 'rt', encoding='utf-8') as fh:
            for line in fh:
                h = json.loads(line)
                if h['labels'] and h['trust'] in ('expert', 'expert-comment', 'comment'):
                    key = (' '.join(h['fen'].split()[:4]), h['uci'])
                    human.setdefault(key, (h['src'], set(h['labels'])))
    joined = collections.defaultdict(list)
    for r in recs:
        key = (' '.join(r['fen'].split()[:4]), r['uci'])
        if key in human:
            src, labels = human[key]
            joined[src].append((set(r['engine_ideas']), labels))
    md = ['# Engine-grounded idea labels: do they agree with people?\n',
          f'{len(recs):,} engine lines measured with Stockfish 11\'s evaluation parts. A move\'s engine ideas are the parts that improved most over its eight-ply line (at least one standard deviation more than moves usually manage).\n',
          '| Source | Labelled moves | Engine gave an idea | Agrees with the human label | Chance agreement |', '|---|---|---|---|---|']
    vocab_all = [i for v in PARTS.values() for i in v[1]]
    for src, items in sorted(joined.items()):
        named = [(e, h) for e, h in items if e]
        if not named:
            continue
        agree = sum(1 for e, h in named if e & h) / len(named)
        # chance: shuffle the human labels against the engine ideas
        hs = [h for _, h in named]
        es = [e for e, _ in named]
        chance = sum(1 for i, e in enumerate(es) for h in [hs[(i * 7919 + 13) % len(hs)]] if e & h) / len(named)
        md.append(f'| {src} | {len(items):,} | {100 * len(named) / len(items):.0f}% | **{100 * agree:.0f}%** | {100 * chance:.0f}% |')
    md += ['', '## How often each evaluation part is a move\'s main change\n', '| Part | Lines where it changed most |', '|---|---|']
    c = collections.Counter(r['engine_parts'][0] for r in recs if r['engine_parts'])
    md += [f'| {p} | {n:,} |' for p, n in c.most_common()]
    md += ['', 'Agreement means at least one of the engine\'s ideas matches at least one human label for the same move. Chance is the same check with the human labels shuffled between moves.', '']
    with open(a.report, 'w', encoding='utf-8') as f:
        f.write('\n'.join(md))
    print('\n'.join(md))


if __name__ == '__main__':
    sys.exit(main())
