"""Plans lab: one command to fold your verdicts into the idea namer and refresh everything the app shows.

    python tools/plans/retrain.py --verdicts "%USERPROFILE%/Downloads/idea-verdicts.json" --data DATA_DIR

DATA_DIR holds the training data built by build_corpus.py (corpus2.jsonl.gz, books.jsonl, engine-labels.jsonl.gz, brain/,
lines/, plan-clusters-assign.jsonl.gz, bookterms/). It runs, in order:
  1. namer2.py with your verdicts as trusted labels (and the Maia-2 / Stockfish features), tested on the books it never sees;
  2. build_ideas.py for the 300 King's Indian positions (data/plans/ideas.json);
  3. build_all_ideas.py for the common positions of every opening (data/plans/ideas/);
and prints how the new namer did against the last one, plus how often it now agrees with your verdicts.
"""
import argparse
import glob
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))


def run(args):
    print('>', ' '.join(os.path.basename(a) if os.path.isabs(a) else a for a in args[:3]), '...', flush=True)
    r = subprocess.run([sys.executable] + args, cwd=ROOT, capture_output=True, text=True)
    lines = [l for l in r.stdout.splitlines() if any(k in l for k in ('Top idea', 'Weighted', 'positions ->', 'verdicts added', '| book'))]
    print('\n'.join(lines))
    if r.returncode:
        print(r.stderr[-2000:]); raise SystemExit('step failed')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--verdicts', default='')
    ap.add_argument('--data', required=True)
    a = ap.parse_args()
    d = a.data
    brain = glob.glob(os.path.join(d, 'brain', '*', '*.npz'))
    model = os.path.join(d, 'namer-yours.pkl')
    args = [os.path.join(HERE, 'namer2.py'), os.path.join(d, 'corpus2.jsonl.gz'), os.path.join(d, 'books.jsonl'),
            '--report', os.path.join(ROOT, 'lab', 'plans', 'out', 'namer-check.md'), '--model', model, '--comments', '60000',
            '--weak', 'lichess-studies,chessgpt-annotated,wikibooks,lichess-practice', '--weak-weight', '0.3',
            '--terms', os.path.join(d, 'engine-labels.jsonl.gz'), '--brain'] + brain
    if a.verdicts:
        args += ['--verdicts', a.verdicts]
    run(args)
    lines = glob.glob(os.path.join(d, 'lines', '*', 'lines-*.jsonl'))
    run([os.path.join(HERE, 'build_ideas.py'), model, os.path.join(ROOT, 'lab', 'plans', 'data', 'kid-positions.json')] + lines +
        ['--out', os.path.join(ROOT, 'data', 'plans', 'ideas.json'), '--report', os.path.join(ROOT, 'lab', 'plans', 'out', 'kid-ideas.md'),
         '--plans', os.path.join(d, 'plan-clusters-assign.jsonl.gz'), '--engine-labels', os.path.join(d, 'engine-labels.jsonl.gz'), '--brain'] + brain)
    terms = glob.glob(os.path.join(d, 'bookterms', '*', 'terms-*.jsonl'))
    if terms:
        run([os.path.join(HERE, 'build_all_ideas.py'), model] + terms + ['--out', os.path.join(ROOT, 'data', 'plans', 'ideas'),
            '--engine-labels', os.path.join(d, 'engine-labels.jsonl.gz'), '--brain'] + brain)
    if a.verdicts:
        v = json.load(open(a.verdicts, encoding='utf-8'))
        judged = [x for x in v if x.get('verdict') in ('right', 'partly', 'wrong')]
        if judged:
            score = sum(1 if x['verdict'] == 'right' else 0.5 if x['verdict'] == 'partly' else 0 for x in judged) / len(judged)
            print(f'Your verdicts on the previous namer: {len(judged)} judged, score {100 * score:.0f}%. Judge again in the Ideas view to measure the new one.')
    print('Done. Refresh the app to see the new labels.')


if __name__ == '__main__':
    sys.exit(main())
