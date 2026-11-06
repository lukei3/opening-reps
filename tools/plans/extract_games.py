"""Plans lab, step 1: pull WHOLE games of one opening family out of a monthly Lichess dump (https://database.lichess.org, CC0).

The opening book keeps only frequent positions, so it runs dry around move 8. Plan research needs complete games, so this
streams a month's file (never saving it), keeps games whose ECO code falls in a range, and writes each one as a line of
JSON: who, ratings, speed, result, ECO/opening name and the moves (up to a limit).

    python tools/plans/extract_games.py --url <.pgn.zst url> --eco E60-E99 --cap 40000 --out kid-2023-01.jsonl.gz

Needs:  pip install zstandard
Nothing here is imported by the app.
"""
import argparse
import gzip
import io
import json
import re
import sys
import time
import urllib.request

import zstandard

COMMENT = re.compile(r'\{[^}]*\}')
HEADER = re.compile(r'\[(\w+) "(.*)"\]')
SPEEDS = ('Blitz', 'Rapid', 'Classical')


def stream_url(url):
    resp = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'opening-reps-plans-lab'}))
    reader = zstandard.ZstdDecompressor().stream_reader(resp)
    return resp, io.TextIOWrapper(reader, encoding='utf-8', errors='replace')


def eco_in_range(eco, lo, hi):
    return bool(eco) and eco[0] == lo[0] and lo <= eco <= hi


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', required=True)
    ap.add_argument('--eco', required=True, help="range of ECO codes, e.g. E60-E99 (the King's Indian family)")
    ap.add_argument('--cap', type=int, default=40000, help='stop after keeping this many games')
    ap.add_argument('--max-read', type=int, default=0, help='stop after reading this many games (0 = no limit)')
    ap.add_argument('--max-minutes', type=float, default=0)
    ap.add_argument('--min-rating', type=int, default=1400, help='both players at least this')
    ap.add_argument('--max-rating', type=int, default=2500, help='both players at most this')
    ap.add_argument('--min-plies', type=int, default=30, help='skip games shorter than this: there is no middlegame to study')
    ap.add_argument('--keep-plies', type=int, default=90, help='moves kept per game')
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    lo, hi = a.eco.split('-')
    deadline = time.time() + 60 * a.max_minutes if a.max_minutes else None
    log = lambda m: print(m, flush=True)

    resp, text = stream_url(a.url)
    h, seen, kept, t0 = {}, 0, 0, time.time()
    with gzip.open(a.out, 'wt', encoding='utf-8') as out:
        for raw in text:
            line = raw.strip()
            if not line:
                continue
            if line[0] == '[':
                m = HEADER.match(line)
                if m:
                    h[m.group(1)] = m.group(2)
                continue
            if line[0] != '1':
                continue
            seen += 1
            if seen % 250000 == 0:
                log(f'  read {seen:,} games, kept {kept:,} ({seen / (time.time() - t0):,.0f}/s)')
                if deadline and time.time() > deadline:
                    break
            if a.max_read and seen >= a.max_read:
                break
            eco = h.get('ECO', '')
            if eco_in_range(eco, lo, hi) and any(s in h.get('Event', '') for s in SPEEDS) and 'Correspondence' not in h.get('Event', ''):
                we, be = h.get('WhiteElo', ''), h.get('BlackElo', '')
                if we.isdigit() and be.isdigit() and a.min_rating <= int(we) <= a.max_rating and a.min_rating <= int(be) <= a.max_rating \
                        and h.get('Result') in ('1-0', '0-1', '1/2-1/2'):
                    toks = COMMENT.sub('', line).split()
                    moves = [t.rstrip('!?') for t in toks if t[0].isalpha()]
                    if len(moves) >= a.min_plies:
                        speed = next(s for s in SPEEDS if s in h['Event']).lower()
                        out.write(json.dumps({
                            'id': (h.get('Site') or '').rsplit('/', 1)[-1], 'date': h.get('UTCDate', ''), 'w': int(we), 'b': int(be),
                            'speed': speed, 'tc': h.get('TimeControl', ''), 'res': h['Result'], 'eco': eco, 'opening': h.get('Opening', ''),
                            'plies': len(moves), 'moves': ' '.join(moves[:a.keep_plies]),
                        }, separators=(',', ':')) + '\n')
                        kept += 1
                        if kept >= a.cap:
                            break
            h = {}
    log(f'Done: read {seen:,} games, kept {kept:,} in {time.time() - t0:,.0f}s -> {a.out}')


if __name__ == '__main__':
    sys.exit(main())
