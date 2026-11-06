"""Private demo server for the Plans quiz. Local only (127.0.0.1), port 8790, never part of the published site.

    python lab/plans/demo/serve_demo.py      then open http://localhost:8790/lab/plans/demo/

Serves the project folder (so the quiz can reuse the app's board) and saves your verdicts to lab/plans/demo/labels.jsonl.
"""
import http.server
import json
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
LABELS = os.path.join(os.path.dirname(__file__), 'labels.jsonl')


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_POST(self):
        if self.path != '/api/label':
            self.send_error(404); return
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        try:
            row = json.loads(body)
        except ValueError:
            self.send_error(400); return
        with open(LABELS, 'a', encoding='utf-8') as f:
            f.write(json.dumps(row) + '\n')
        self.send_response(204); self.end_headers()


if __name__ == '__main__':
    print('Plans quiz: http://localhost:8790/lab/plans/demo/')
    http.server.ThreadingHTTPServer(('127.0.0.1', 8790), H).serve_forever()
