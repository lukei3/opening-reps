"""Build opening-book parts from the Lichess open database (https://database.lichess.org, CC0).

Streams one or more monthly .pgn.zst dumps (never saves them), keeps rated bullet/blitz/rapid/classical games of any
rating, and counts results per move, per rating group and per time control, merged by position. A month is downloaded
and read ONCE for all the time controls you ask for.

    python tools/build_book.py --url <.pgn.zst url> --speeds bullet,blitz,rapid --caps 6000000,8000000,6000000

Memory-safe: games are processed in chunks, each chunk is folded into compact per-position counts and then freed.

Writes <out>/<speed>/meta.json and <out>/<speed>/sNN.json for each time control. tools/merge_books.py combines them
(and parts from other months) into the book the app loads.
Needs:  pip install zstandard chess
"""
import argparse
import bisect
import io
import json
import os
import re
import sys
import time
import urllib.request
from array import array

import chess
import zstandard

BUCKETS = [400, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500]   # Lichess's rating groups: 400 is "under 1000", 2500 is "2500 and up"
EDGES = BUCKETS[1:]
NB = len(BUCKETS)
W = NB * 3                           # counters per move: [w, d, b] for each rating group
SHARDS = 64
SPEED_NAMES = ('bullet', 'blitz', 'rapid', 'classical')   # UltraBullet counts as bullet; correspondence is left out
RESULT_IDX = {'1-0': 0, '1/2-1/2': 1, '0-1': 2}
COMMENT = re.compile(r'\{[^}]*\}')
MIN_PARENT = 3        # inside a chunk, a child node is made only once its parent has been seen this often
CHUNK_MIN_POSITION = 5
CHUNK_MIN_MOVE = 2
MIN_POSITION = 10     # final: positions with fewer games are dropped
MIN_MOVE = 3          # final: moves with fewer games are dropped


def shard_of(key):
    h = 5381
    for ch in key.encode('utf-8'):
        h = ((h * 33) ^ ch) & 0xFFFFFFFF
    return h % SHARDS


def speed_of(event):
    for name in ('Bullet', 'Blitz', 'Rapid', 'Classical'):   # "UltraBullet" contains "Bullet"
        if name in event:
            return name.lower()
    return None


def games(stream, max_games, max_ply, log, caps, deadline=None):
    """Yield (speed, bucket, result_idx, [san...]) for games that pass the filters.

    `caps` maps each wanted time control to how many games to keep (0 = no limit). Reading stops after max_games games
    are READ, once every wanted time control has reached its cap, or when the clock passes `deadline` (a time.time()
    value): what has been counted so far is kept, so a slow download costs the end of a month, not the whole month."""
    event = we = be = res = None
    seen = 0
    kept = {s: 0 for s in caps}
    t0 = time.time()
    for raw in stream:
        line = raw.strip()
        if not line:
            continue
        if line[0] == '[':
            if line.startswith('[Event '):
                event = line
            elif line.startswith('[WhiteElo '):
                we = line[11:-2]
            elif line.startswith('[BlackElo '):
                be = line[11:-2]
            elif line.startswith('[Result '):
                res = line[9:-2]
            continue
        if line[0] != '1':
            continue
        seen += 1
        if seen % 250000 == 0:
            log(f'  read {seen:,} games ({seen / (time.time() - t0):,.0f}/s); kept ' + ', '.join(f'{s} {n:,}' for s, n in kept.items()))
        if deadline and seen % 2000 == 0 and time.time() > deadline:
            log('  time limit reached: stopping here and keeping what has been counted')
            return
        sp = speed_of(event) if event else None
        if sp in caps and (not caps[sp] or kept[sp] < caps[sp]) and we and be and we.isdigit() and be.isdigit() and res in RESULT_IDX:
            avg = (int(we) + int(be)) // 2
            toks = COMMENT.sub('', line).split()
            sans = [t.rstrip('!?') for t in toks if t[0].isalpha() and t not in ('O',)][:max_ply]
            kept[sp] += 1
            yield sp, bisect.bisect_right(EDGES, avg), RESULT_IDX[res], sans
            if all(c and kept[s] >= c for s, c in caps.items()):
                return
        event = we = be = res = None
        if seen >= max_games:
            return


class Trie:
    """A compact trie: counters in one flat array, children in one int-keyed dict."""

    def __init__(self):
        self.cnt = array('I', [0] * (W + 1))     # node 0 is the root
        self.kids = {}
        self.sans = []
        self.san_id = {}

    def san(self, s):
        i = self.san_id.get(s)
        if i is None:
            i = len(self.sans)
            self.san_id[s] = i
            self.sans.append(s)
        return i

    def add(self, b, r, sans):
        cnt, kids = self.cnt, self.kids
        cnt[W] += 1
        node = 0
        for s in sans:
            sid = self.san(s)
            key = (node << 14) | sid
            child = kids.get(key)
            if child is None:
                if cnt[node * (W + 1) + W] < MIN_PARENT:
                    break
                child = len(cnt) // (W + 1)
                cnt.extend([0] * (W + 1))
                kids[key] = child
            base = child * (W + 1)
            cnt[base + b * 3 + r] += 1
            cnt[base + W] += 1
            node = child


def fold(trie, merged):
    """Walk the trie with a real board so transpositions merge, and add this chunk's counts into `merged`."""
    items = sorted(trie.kids.items())
    start = {}
    for i, (key, _) in enumerate(items):
        start.setdefault(key >> 14, i)
    cnt = trie.cnt
    stack = [(0, chess.Board())]
    while stack:
        node, board = stack.pop()
        i = start.get(node)
        if i is None:
            continue
        key = ' '.join(board.fen(en_passant='legal').split(' ')[:4])
        entry = None
        while i < len(items) and (items[i][0] >> 14) == node:
            k, child = items[i]
            i += 1
            base = child * (cnt_w := W + 1)
            total = cnt[base + W]
            if total < CHUNK_MIN_MOVE:
                continue
            san = trie.sans[k & 0x3FFF]
            if entry is None:
                entry = merged.setdefault(key, {})
            row = entry.get(san)
            if row is None:
                row = entry[san] = array('I', [0] * W)
            for j in range(W):
                row[j] += cnt[base + j]
            if total >= CHUNK_MIN_POSITION:
                try:
                    b2 = board.copy(stack=False)
                    b2.push_san(san)
                except ValueError:
                    continue
                stack.append((child, b2))


def stream_url(url):
    resp = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'opening-reps-book-builder'}))
    reader = zstandard.ZstdDecompressor().stream_reader(resp)
    return resp, io.TextIOWrapper(reader, encoding='utf-8', errors='replace')


def write_part(merged, folder, speed, used, urls, max_ply, log):
    shards = [{} for _ in range(SHARDS)]
    kept = 0
    for key, moves in merged.items():
        moves = {san: v for san, v in moves.items() if sum(v) >= MIN_MOVE}
        if sum(sum(v) for v in moves.values()) < MIN_POSITION:
            continue
        rows = [[san] + list(v) for san, v in sorted(moves.items(), key=lambda kv: -sum(kv[1]))]
        shards[shard_of(key)][key] = rows
        kept += 1
    os.makedirs(folder, exist_ok=True)
    for i, s in enumerate(shards):
        with open(os.path.join(folder, f's{i:02d}.json'), 'w', encoding='utf-8') as f:
            json.dump(s, f, separators=(',', ':'))
    meta = {
        'source': ', '.join(u.rsplit('/', 1)[-1] for u in urls), 'games': used, 'positions': kept, 'buckets': BUCKETS,
        'shards': SHARDS, 'maxPly': max_ply, 'speeds': [speed], 'built': time.strftime('%Y-%m-%d'),
        'note': 'Lichess open database (CC0). Counts are per rating group (average of both players) as [w,d,b] triples.',
    }
    with open(os.path.join(folder, 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=1)
    log(f'{speed}: {used:,} games, {kept:,} positions in {SHARDS} shards -> {folder}')


def main():
    global SHARDS, MIN_POSITION, MIN_MOVE, MIN_PARENT, CHUNK_MIN_POSITION, CHUNK_MIN_MOVE
    ap = argparse.ArgumentParser()
    ap.add_argument('--speeds', default=','.join(SPEED_NAMES), help='time controls to keep, comma separated (bullet,blitz,rapid,classical)')
    ap.add_argument('--caps', default='', help='games to keep per time control, in the same order (0 = no limit); default no limit')
    ap.add_argument('--chunk-min-position', type=int, default=CHUNK_MIN_POSITION, help='inside a chunk, expand a line only once seen this often (lower = deeper, more memory)')
    ap.add_argument('--chunk-min-move', type=int, default=CHUNK_MIN_MOVE, help='inside a chunk, keep a move only once seen this often')
    ap.add_argument('--min-parent', type=int, default=MIN_PARENT, help='inside a chunk, create a child only once its parent was seen this often')
    ap.add_argument('--url', action='append', required=True, help='a monthly .pgn.zst URL (repeat for several months)')
    ap.add_argument('--games-per-url', type=int, default=10**10, help='games to READ from the start of each file')
    ap.add_argument('--max-minutes', type=float, default=0, help='stop reading after this long and keep what has been counted (0 = no limit)')
    ap.add_argument('--chunk', type=int, default=400_000, help='qualifying games per in-memory chunk')
    ap.add_argument('--max-ply', type=int, default=30)
    ap.add_argument('--shards', type=int, default=SHARDS, help='more shards = smaller files, each fetched on demand')
    ap.add_argument('--min-position', type=int, default=MIN_POSITION, help='drop positions seen fewer times than this')
    ap.add_argument('--min-move', type=int, default=MIN_MOVE, help='drop moves seen fewer times than this')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'book'))
    a = ap.parse_args()
    SHARDS, MIN_POSITION, MIN_MOVE = a.shards, a.min_position, a.min_move
    MIN_PARENT, CHUNK_MIN_POSITION, CHUNK_MIN_MOVE = a.min_parent, a.chunk_min_position, a.chunk_min_move
    log = lambda m: print(m, flush=True)

    speeds = [s.strip() for s in a.speeds.split(',') if s.strip()]
    for s in speeds:
        assert s in SPEED_NAMES, f'unknown time control {s!r}'
    caps_list = [int(c) for c in a.caps.split(',') if c.strip()] if a.caps else [0] * len(speeds)
    assert len(caps_list) == len(speeds), '--caps needs one number per time control'
    caps = dict(zip(speeds, caps_list))

    merged = {s: {} for s in speeds}
    used = {s: 0 for s in speeds}
    deadline = time.time() + 60 * a.max_minutes if a.max_minutes else None
    for url in a.url:
        log(f'Streaming {url}')
        resp, text = stream_url(url)
        gen = games(text, a.games_per_url, a.max_ply, log, caps, deadline)   # the caps apply to each month's file
        done = False
        while not done:
            tries = {s: Trie() for s in speeds}
            counts = {s: 0 for s in speeds}
            n = 0
            for sp, b, r, sans in gen:
                tries[sp].add(b, r, sans)
                counts[sp] += 1
                n += 1
                if n >= a.chunk:
                    break
            else:
                done = True
            if n:
                for s in speeds:
                    if counts[s]:
                        fold(tries[s], merged[s])
                        used[s] += counts[s]
                log(f'  folded a chunk of {n:,} games; ' + ', '.join(f'{s} {used[s]:,} ({len(merged[s]):,} positions)' for s in speeds))
            del tries
        resp.close()

    for s in speeds:
        write_part(merged[s], os.path.join(a.out, s), s, used[s], a.url, a.max_ply, log)
    log('Done.')


if __name__ == '__main__':
    sys.exit(main())
