#!/usr/bin/env python3
"""Development server: http.server + gzip (matches CloudFront compression in prod).

Usage: python3 serve.py [port]   (default 3000)

Dev-only — NOT part of the deploy allowlist. Binds 127.0.0.1 because the repo
root contains files that must never be exposed off-box (see Makefile deploy
notes about voter PII).
"""

import gzip
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# Types worth compressing (GeoJSON is the big win — county boundary files).
COMPRESSIBLE = {
    "text/html",
    "text/css",
    "text/plain",
    "text/csv",
    "text/javascript",
    "application/javascript",
    "application/json",
    "image/svg+xml",
}


class GzipRequestHandler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    # http.server leaves .geojson/.csv/.mjs unmapped -> application/octet-stream
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".geojson": "application/json",
        ".json": "application/json",
        ".csv": "text/csv",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
    }

    def end_headers(self):
        # Always revalidate in dev so edits show up on reload.
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        path = self.translate_path(self.path.split("?", 1)[0].split("#", 1)[0])
        ctype = self.guess_type(path)
        accepts_gzip = "gzip" in self.headers.get("Accept-Encoding", "")
        if not (accepts_gzip and ctype in COMPRESSIBLE and os.path.isfile(path)):
            return super().do_GET()
        try:
            with open(path, "rb") as fh:
                raw = fh.read()
        except OSError:
            self.send_error(404, "File not found")
            return
        body = gzip.compress(raw, compresslevel=6)
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):  # quiet: only errors are interesting in dev
        if args and str(args[1] if len(args) > 1 else "").startswith(("4", "5")):
            super().log_message(fmt, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = ThreadingHTTPServer(("127.0.0.1", port), GzipRequestHandler)
    print(f"Serving {os.getcwd()} at http://localhost:{port} (gzip on, Ctrl-C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
