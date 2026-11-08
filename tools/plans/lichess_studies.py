"""Plans lab: collect public Lichess studies for training (kept on this computer only; studies belong to their authors).

Finds study ids on the public topic pages and the "all studies, most popular" pages, then downloads each study's PGN with
comments through the official export endpoint. Follows Lichess's API rules: one request at a time, and a full minute's wait
after any 429 reply.

    python tools/plans/lichess_studies.py OUT_DIR --pages 40 --max 2500
"""
import argparse
import os
import re
import sys
import time
import urllib.parse
import urllib.request

UA = 'opening-reps-plans-lab (personal research; one request at a time)'
TOPICS = ['Strategy', 'Middlegame', 'Positional play', 'Positional', 'Endgame', 'Endgames', 'Endgame Studies', 'Game Collection',
          'Game Study', 'Games', 'Annotated Games', 'Interactive Lessons', 'Opening Theory', 'Openings', 'Opening',
          "King's Indian Defense", "King's Indian", 'Pawn Structure', 'Pawn Structures', 'Plans', 'Chess']


def get(url, binary=False):
    while True:
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=60) as r:
                data = r.read()
            return data if binary else data.decode('utf-8', 'replace')
        except urllib.error.HTTPError as e:
            if e.code == 429:
                print('  429: waiting a minute', flush=True); time.sleep(61); continue
            if e.code in (404, 403):
                return None
            time.sleep(10)
        except Exception:
            time.sleep(10)


def ids_from(url):
    html = get(url) or ''
    return list(dict.fromkeys(re.findall(r'href="/study/([A-Za-z0-9]{8})"', html)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out')
    ap.add_argument('--pages', type=int, default=40)
    ap.add_argument('--max', type=int, default=2500)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    found = []
    seen = set()

    def add(ids):
        new = [i for i in ids if i not in seen]
        for i in new:
            seen.add(i); found.append(i)
        return len(new)

    sources = [f'https://lichess.org/study/all/popular?page={{}}'] + [f'https://lichess.org/study/topic/{urllib.parse.quote(t)}/popular?page={{}}' for t in TOPICS]
    for src in sources:
        empty = 0
        for page in range(1, a.pages + 1):
            n = add(ids_from(src.format(page)))
            time.sleep(1.2)
            empty = empty + 1 if n == 0 else 0
            if empty >= 2:
                break
        print(f'{src.split("?")[0]}: {len(found):,} ids so far', flush=True)
    with open(os.path.join(a.out, 'ids.txt'), 'w') as f:
        f.write('\n'.join(found))
    got = 0
    for sid in found[:a.max]:
        path = os.path.join(a.out, f'{sid}.pgn')
        if os.path.exists(path) and os.path.getsize(path) > 0:
            continue
        pgn = get(f'https://lichess.org/api/study/{sid}.pgn?comments=true&variations=true&clocks=false&shapes=true')
        if pgn:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(pgn)
            got += 1
        if got % 100 == 0 and got:
            print(f'  {got:,} studies downloaded', flush=True)
        time.sleep(2.0)
    print(f'done: {got:,} new studies, {len(found):,} ids found')


if __name__ == '__main__':
    sys.exit(main())
