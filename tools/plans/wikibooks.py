"""Plans lab: Wikibooks "Chess Opening Theory" (CC BY-SA) as (position, move, explanation) rows.

fetch: lists every page under Chess_Opening_Theory/ and downloads its wikitext through the MediaWiki API, one request at a
       time with maxlag, as Wikimedia asks.
convert: each page title is a move sequence (1. d4/1...Nf6/2. c4 ...). The page text explains the last move; paragraphs that
       start with a link to a child page ([[/5. Nf3|...]]) explain that next move. Both become rows.

    python tools/plans/wikibooks.py fetch --out wikibooks-raw.jsonl
    python tools/plans/wikibooks.py convert wikibooks-raw.jsonl --out wikibooks.jsonl

Text is CC BY-SA 4.0 (Wikibooks contributors); kept locally for training, credited in lab/plans/data/CORPUS.md.
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

import chess

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_corpus import text_labels  # noqa: E402

API = 'https://en.wikibooks.org/w/api.php'
UA = 'OpeningRepsResearch/0.1 (personal chess-training project; one request at a time)'
PREFIX = 'Chess_Opening_Theory/'


def get(params):
    params = {**params, 'format': 'json', 'formatversion': '2', 'maxlag': '5'}
    url = API
    body = urllib.parse.urlencode(params).encode()          # POST: long title lists do not fit in a URL
    for attempt in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=body, headers={'User-Agent': UA}), timeout=60) as r:
                j = json.load(r)
            if 'error' in j and j['error'].get('code') == 'maxlag':
                time.sleep(6); continue
            return j
        except Exception:
            time.sleep(5 * (attempt + 1))
    raise SystemExit('Wikibooks API keeps failing: ' + url)


def fetch(out_path):
    titles, cont = [], {}
    while True:
        j = get({'action': 'query', 'list': 'allpages', 'apprefix': PREFIX, 'aplimit': '500', **cont})
        titles += [p['title'] for p in j['query']['allpages']]
        if 'continue' not in j:
            break
        cont = {'apcontinue': j['continue']['apcontinue']}
        time.sleep(0.5)
    print(f'{len(titles):,} pages', flush=True)
    have = set()
    if os.path.exists(out_path):
        have = {json.loads(l)['title'] for l in open(out_path, encoding='utf-8')}
    titles = [t for t in titles if t not in have]
    print(f'{len(have):,} already fetched, {len(titles):,} to go', flush=True)
    with open(out_path, 'a', encoding='utf-8') as out:
        for i in range(0, len(titles), 50):
            j = get({'action': 'query', 'prop': 'revisions', 'rvprop': 'content', 'rvslots': 'main', 'titles': '|'.join(titles[i:i + 50])})
            for p in j['query']['pages']:
                if p.get('revisions'):
                    out.write(json.dumps({'title': p['title'], 'text': p['revisions'][0]['slots']['main']['content']}, ensure_ascii=False) + '\n')
            if i % 1000 == 0:
                print(f'  {i:,} fetched', flush=True)
            time.sleep(0.5)


MOVE_TOKEN = re.compile(r'(\d+)\s*\.(\.\.)?\s*([^\s/]+)')


def title_moves(title):
    path = title.split('/', 1)[1] if '/' in title else ''
    moves = []
    for part in path.split('/'):
        part = part.replace('_', ' ').strip()
        toks = re.findall(r'(?:\d+\.(?:\.\.)?)?\s*([KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|O-O-O|O-O|0-0-0|0-0)', part)
        moves += [t.replace('0', 'O') for t in toks]
    return moves


def clean_wikitext(t):
    t = re.sub(r'\{\{[^{}]*\}\}', '', t)
    t = re.sub(r'\{\{[^{}]*\}\}', '', t)
    t = re.sub(r'<table.*?</table>', '', t, flags=re.S)
    t = re.sub(r'<ref.*?</ref>|<[^>]+>', '', t, flags=re.S)
    t = re.sub(r'\[\[[^\]|]*\|([^\]]*)\]\]', r'\1', t)
    t = re.sub(r'\[\[([^\]]*)\]\]', r'\1', t)
    t = re.sub(r"'{2,}", '', t)
    t = re.sub(r'==+[^=]+==+', '\n', t)
    return re.sub(r'[ \t]+', ' ', t).strip()


def convert(raw, out_path):
    n_pages = n_rows = 0
    with open(out_path, 'w', encoding='utf-8') as out:
        for line in open(raw, encoding='utf-8'):
            p = json.loads(line)
            moves = title_moves(p['title'])
            board = chess.Board()
            try:
                for m in moves[:-1]:
                    board.push_san(m)
                last = board.parse_san(moves[-1]) if moves else None
            except ValueError:
                continue
            n_pages += 1
            text = p['text']
            body = clean_wikitext(text.split('==Theory table==')[0].split('== Theory table ==')[0])
            if last and len(body) > 60:
                out.write(json.dumps({'src': 'wikibooks', 'trust': 'comment', 'fen': board.fen(), 'uci': last.uci(), 'best': None,
                                      'labels': text_labels(body), 'text': body[:900], 'meta': {'title': p['title']}}, ensure_ascii=False) + '\n')
                n_rows += 1
            # paragraphs that discuss a child move: [[/5. Nf3|...]] ...
            after = board.copy()
            if last:
                after.push(last)
            for para in text.split('\n'):
                m = re.match(r"\s*\[\[/([^|\]]+)\|", para)
                if not m:
                    continue
                child = title_moves('x/' + m.group(1))
                if not child:
                    continue
                try:
                    mv = after.parse_san(child[-1])
                except ValueError:
                    continue
                txt = clean_wikitext(para)
                if len(txt) > 60:
                    out.write(json.dumps({'src': 'wikibooks', 'trust': 'comment', 'fen': after.fen(), 'uci': mv.uci(), 'best': None,
                                          'labels': text_labels(txt), 'text': txt[:900], 'meta': {'title': p['title'], 'child': m.group(1)}}, ensure_ascii=False) + '\n')
                    n_rows += 1
    print(f'{n_pages:,} pages read, {n_rows:,} rows -> {out_path}')


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    f = sub.add_parser('fetch'); f.add_argument('--out', required=True)
    c = sub.add_parser('convert'); c.add_argument('raw'); c.add_argument('--out', required=True)
    a = ap.parse_args()
    fetch(a.out) if a.cmd == 'fetch' else convert(a.raw, a.out)


if __name__ == '__main__':
    sys.exit(main())
