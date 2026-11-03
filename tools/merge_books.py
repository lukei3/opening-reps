"""Merge books built by build_book.py (one per month and time control) into the book the app loads.

    python tools/merge_books.py <output folder> <book folder> <book folder> ... [--min-position N] [--min-move N]

Parts for the same time control are added together; parts for different time controls fill different columns.
Each output row is  [san, cell, count, cell, count, ...]  listing only the non-zero cells, where
    cell = speedIndex * (groups * 3) + groupIndex * 3 + result      (result: 0 white wins, 1 draw, 2 black wins)
meta.json names the speeds and rating groups. The --min flags prune rare positions and moves after merging.
"""
import json
import os
import sys
import time

SPEED_NAMES = ['bullet', 'blitz', 'rapid', 'classical']


def main():
    args = sys.argv[1:]
    min_position = min_move = 0
    for flag in ('--min-position', '--min-move'):
        if flag in args:
            i = args.index(flag)
            value = int(args[i + 1])
            del args[i:i + 2]
            if flag == '--min-position':
                min_position = value
            else:
                min_move = value
    out, *srcs = args
    metas = []
    for s in srcs:
        with open(os.path.join(s, 'meta.json'), encoding='utf-8') as f:
            metas.append(json.load(f))
    shards = {m['shards'] for m in metas}
    buckets = {tuple(m['buckets']) for m in metas}
    assert len(shards) == 1 and len(buckets) == 1, 'books must share the same shard count and rating groups'
    n = shards.pop()
    nb = len(next(iter(buckets)))
    per_speed = nb * 3
    offsets = []
    for m in metas:
        assert len(m['speeds']) == 1 and m['speeds'][0] in SPEED_NAMES, 'each part must be built with --speed'
        offsets.append(SPEED_NAMES.index(m['speeds'][0]) * per_speed)
    total = len(SPEED_NAMES) * per_speed

    os.makedirs(out, exist_ok=True)
    positions = 0
    for i in range(n):
        merged = {}
        for s, off in zip(srcs, offsets):
            path = os.path.join(s, f's{i:02d}.json')
            if not os.path.exists(path):
                continue
            with open(path, encoding='utf-8') as f:
                for key, rows in json.load(f).items():
                    entry = merged.setdefault(key, {})
                    for row in rows:
                        cells = entry.get(row[0])
                        if cells is None:
                            cells = entry[row[0]] = [0] * total
                        for j, c in enumerate(row[1:]):
                            cells[off + j] += c
        shard = {}
        for key, entry in merged.items():
            entry = {san: c for san, c in entry.items() if sum(c) >= min_move}
            if sum(sum(c) for c in entry.values()) < min_position:
                continue
            rows = []
            for san, c in sorted(entry.items(), key=lambda kv: -sum(kv[1])):
                row = [san]
                for j, v in enumerate(c):
                    if v:
                        row += [j, v]
                rows.append(row)
            shard[key] = rows
        positions += len(shard)
        with open(os.path.join(out, f's{i:02d}.json'), 'w', encoding='utf-8') as f:
            json.dump(shard, f, separators=(',', ':'))

    months = sorted({src for m in metas for src in m['source'].split(', ')})
    meta = dict(metas[0])
    meta.update({
        'source': f'{len(months)} monthly Lichess dumps, {months[0]} to {months[-1]}',
        'games': sum(m['games'] for m in metas),
        'positions': positions,
        'maxPly': max(m['maxPly'] for m in metas),
        'speeds': SPEED_NAMES,
        'layout': 'sparse',
        'built': time.strftime('%Y-%m-%d'),
    })
    with open(os.path.join(out, 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=1)
    print(f"merged {len(srcs)} parts: {meta['games']:,} games, {positions:,} positions")


if __name__ == '__main__':
    sys.exit(main())
