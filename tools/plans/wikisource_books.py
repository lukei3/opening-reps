"""Plans lab: download public-domain chess books from Wikisource as plain text (hand-checked transcriptions).

Each book is a main page plus chapter subpages; their text is often transcluded from scanned pages, so the rendered HTML is
fetched (action=parse) and turned into plain text, keeping table cells apart with two spaces so move columns stay readable.

    python tools/plans/wikisource_books.py OUT_DIR
"""
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

API = 'https://en.wikisource.org/w/api.php'
UA = 'OpeningRepsResearch/0.1 (personal chess-training project; one request at a time)'
BOOKS = {
    'ws-my-system': 'My System',
    'ws-lasker-manual': "Lasker's Manual of Chess",
    'ws-my-chess-career': 'My Chess Career',
    'ws-steinitz-instructor': 'The Modern Chess Instructor',
    'ws-mason-principles': 'The Principles of Chess in Theory & Practice',
    'ws-young-strategics': 'Chess Strategics Illustrated',
    'ws-morphys-games': "Morphy's Games",
}


def api(params):
    params = {**params, 'format': 'json', 'formatversion': '2', 'maxlag': '5'}
    data = urllib.parse.urlencode(params).encode()
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(API, data=data, headers={'User-Agent': UA}), timeout=60) as r:
                return json.load(r)
        except Exception:
            time.sleep(5 * (attempt + 1))
    return {}


def to_text(h):
    h = re.sub(r'<(script|style)[^>]*>.*?</\1>', '', h, flags=re.S)
    h = re.sub(r'</t[dh]>', '  ', h)
    h = re.sub(r'<br\s*/?>|</p>|</tr>|</li>|</h\d>|</div>', '\n', h)
    h = re.sub(r'<[^>]+>', '', h)
    h = html.unescape(h)
    return re.sub(r'[ \t]*\n[ \t]*\n+', '\n\n', h)


def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    for slug, title in BOOKS.items():
        pages = [title]
        cont = {}
        while True:
            j = api({'action': 'query', 'list': 'allpages', 'apprefix': title + '/', 'aplimit': '500', **cont})
            pages += [p['title'] for p in j.get('query', {}).get('allpages', [])]
            if 'continue' not in j:
                break
            cont = {'apcontinue': j['continue']['apcontinue']}
        text = []
        for t in pages:
            j = api({'action': 'parse', 'page': t, 'prop': 'text', 'disablelimitreport': '1'})
            h = j.get('parse', {}).get('text', '')
            if h:
                text.append(f'\n\n==== {t} ====\n\n' + to_text(h))
            time.sleep(0.6)
        body = ''.join(text)
        with open(os.path.join(out, slug + '.txt'), 'w', encoding='utf-8') as f:
            f.write(body)
        print(f'{slug}: {len(pages)} pages, {len(body):,} characters', flush=True)


if __name__ == '__main__':
    sys.exit(main())
