"""Assemble dist/: exactly the files the app needs, nothing else, ready to upload to any static host.

    python tools/build_dist.py

Leaves out the tools, dev server, notes and working folders, then checks that every file the page and scripts refer to
is really in dist/.
"""
import os
import re
import shutil
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DIST = os.path.join(ROOT, 'dist')

FILES = ['index.html', 'style.css', 'manifest.webmanifest', 'CREDITS.md']
TREES = ['js', 'lib', 'pieces', 'sounds', 'data', 'book']
SKIP_SUFFIX = ('.log', '.map')


def copy_tree(rel):
    src = os.path.join(ROOT, rel)
    for base, _, names in os.walk(src):
        for n in names:
            if n.endswith(SKIP_SUFFIX):
                continue
            s = os.path.join(base, n)
            d = os.path.join(DIST, os.path.relpath(s, ROOT))
            os.makedirs(os.path.dirname(d), exist_ok=True)
            shutil.copy2(s, d)


def main():
    if os.path.isdir(DIST):
        shutil.rmtree(DIST)
    os.makedirs(DIST)
    for f in FILES:
        shutil.copy2(os.path.join(ROOT, f), os.path.join(DIST, f))
    for t in TREES:
        copy_tree(t)

    # every file named in the page, and the scripts must exist
    missing = []
    for rel in ['index.html', 'manifest.webmanifest'] + [os.path.join('js', n) for n in os.listdir(os.path.join(DIST, 'js'))]:
        body = open(os.path.join(DIST, rel), encoding='utf-8').read()
        for m in re.finditer(r"""['"`(]((?:js|lib|pieces|sounds|data|book)/[A-Za-z0-9_./-]+\.(?:json|js|wasm|svg|mp3|css|png)(?![A-Za-z0-9]))""", body):
            if not os.path.exists(os.path.join(DIST, m.group(1))):
                missing.append(f'{rel} -> {m.group(1)}')
    total = sum(os.path.getsize(os.path.join(b, n)) for b, _, ns in os.walk(DIST) for n in ns)
    count = sum(len(ns) for _, _, ns in os.walk(DIST))
    print(f'dist/: {count} files, {total / 1e6:.1f} MB')
    if missing:
        print('MISSING files referenced:')
        for m in sorted(set(missing)):
            print('  ', m)
        return 1
    print('every referenced file is present')
    return 0


if __name__ == '__main__':
    sys.exit(main())
