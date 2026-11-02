"""Merge several books built by build_book.py into one (counts are simply added), so builds from different months
can run in parallel and be combined afterwards.

    python tools/merge_books.py <output folder> <book folder> <book folder> ... [--min-position N] [--min-move N]

The --min flags prune rare positions and moves after merging, which keeps a very large book to a sensible size.
"""
import json
import os
import sys
import time


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
    assert len(shards) == 1 and len(buckets) == 1, 'books must share the same shard count and rating buckets'
    n = shards.pop()

    os.makedirs(out, exist_ok=True)
    positions = 0
    for i in range(n):
        merged = {}
        for s in srcs:
            path = os.path.join(s, f's{i:02d}.json')
            if not os.path.exists(path):
                continue
            with open(path, encoding='utf-8') as f:
                for key, rows in json.load(f).items():
                    bucket = merged.setdefault(key, {})
                    for row in rows:
                        san, counts = row[0], row[1:]
                        have = bucket.get(san)
                        bucket[san] = counts if have is None else [a + b for a, b in zip(have, counts)]
        shard = {}
        for key, b in merged.items():
            b = {san: c for san, c in b.items() if sum(c) >= min_move}
            if sum(sum(c) for c in b.values()) < min_position:
                continue
            shard[key] = [[san] + c for san, c in sorted(b.items(), key=lambda kv: -sum(kv[1]))]
        positions += len(shard)
        with open(os.path.join(out, f's{i:02d}.json'), 'w', encoding='utf-8') as f:
            json.dump(shard, f, separators=(',', ':'))

    meta = dict(metas[0])
    meta.update({
        'source': ', '.join(m['source'] for m in metas),
        'games': sum(m['games'] for m in metas),
        'positions': positions,
        'maxPly': max(m['maxPly'] for m in metas),
        'built': time.strftime('%Y-%m-%d'),
    })
    with open(os.path.join(out, 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=1)
    print(f"merged {len(srcs)} books: {meta['games']:,} games, {positions:,} positions")


if __name__ == '__main__':
    sys.exit(main())
