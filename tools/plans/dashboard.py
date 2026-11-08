"""Plans lab: one page with how every version of the idea namer did, so changes are judged by numbers.

Reads the reports each namer run writes (namer2.py --report) and collects, per version: top idea correct and top three on
the expert sets (cross-validated), the weighted agreement with human comments it never saw, and per idea on the book
comments (the cleanest outside test). Writes lab/plans/out/DASHBOARD.md.

    python tools/plans/dashboard.py "v2 (expert only)=A.md" "v2 + comments=B.md" ... --out lab/plans/out/DASHBOARD.md
"""
import argparse
import collections
import re
import sys


def parse(path):
    t = open(path, encoding='utf-8').read()
    top1 = re.search(r'Top idea correct: \*\*(\d+)%\*\*', t)
    top3 = re.search(r'top three: \*\*(\d+)%\*\*', t)
    w = re.search(r'Weighted average AUC across all checks: \*\*([\d.]+)\*\*', t)
    books = {}
    for m in re.finditer(r'^\| (book-[\w-]+) \| [\d,]+ \| (\w+) \| (\d+) \| ([\d.]+) \|', t, re.M):
        books[(m.group(1), m.group(2))] = (float(m.group(4)), int(m.group(3)))
    return {'top1': top1 and int(top1.group(1)), 'top3': top3 and int(top3.group(1)), 'weighted': w and float(w.group(1)), 'books': books}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('versions', nargs='+', help='label=report.md')
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    runs = []
    for v in a.versions:
        label, _, path = v.partition('=')
        try:
            runs.append((label, parse(path)))
        except OSError:
            print('missing', path)
    md = ['# Idea namer: every version side by side\n',
          'Expert columns are cross-validated on the Strategic Test Suite and the WGM-reviewed puzzles (positions the model did not train on). '
          '"Outside" is agreement with human comments it never saw (AUC: 0.5 is guessing, 1.0 perfect). The book table is the cleanest test: comments by Capablanca, Lasker, Staunton and others.\n',
          '| Version | Expert: top idea | Expert: top three | Outside (AUC) |', '|---|---|---|---|']
    for label, r in runs:
        md.append(f"| {label} | {r['top1']}% | {r['top3']}% | {r['weighted']} |")
    keys = sorted({k for _, r in runs for k in r['books']})
    if keys:
        md += ['', '## On the book comments, per idea (AUC, comments naming it)\n', '| Book | Idea | ' + ' | '.join(l for l, _ in runs) + ' |',
               '|---|---|' + '---|' * len(runs)]
        for k in keys:
            cells = [f"{r['books'][k][0]:.2f}" if k in r['books'] else '-' for _, r in runs]
            n = next((r['books'][k][1] for _, r in runs if k in r['books']), 0)
            md.append(f'| {k[0]} | {k[1]} ({n}) | ' + ' | '.join(cells) + ' |')
    with open(a.out, 'w', encoding='utf-8') as f:
        f.write('\n'.join(md) + '\n')
    print('\n'.join(md))


if __name__ == '__main__':
    sys.exit(main())
