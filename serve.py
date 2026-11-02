"""Tiny static server that tells the browser not to cache, so edits always show up.

It serves several connections at once (browsers open idle spare connections; a one-at-a-time server would hang on them).
"""
import http.server

PORT = 8765


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


http.server.ThreadingHTTPServer.allow_reuse_address = True
with http.server.ThreadingHTTPServer(('', PORT), Handler) as httpd:
    print(f'Opening Trainer: http://localhost:{PORT}')
    httpd.serve_forever()
