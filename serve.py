#!/usr/bin/env python3
"""Serve GpxilStudio on http://localhost:PORT, as GitHub Pages would.

Open the page from a server rather than from the file itself: browsers do not
let a page opened as a file (file://...) start the web worker that runs Python.

The server answers range requests (a piece of a file), which is how the studio
reads big gpxil files a strip at a time. On GitHub Pages the studio reads the
GRCh38 reference from the Gpxil browser on the same site. Here, the reference
comes from a copy on your computer if you give one (--reference: a folder with
gpxil/chr1.gpxil.tif …, as the Gpxil browser's site/data/grch38 holds it), or
from the Gpxil browser on the web.

usage:  python3 serve.py [PORT] [--reference DIR]      (then open http://localhost:PORT/)
"""
import argparse
import http.server
import os
import re
import socketserver
from http import HTTPStatus

LIVE = "https://comparativechrono.github.io"
REFERENCE = "/Gpxil-browser/data/grch38/"  # where the page looks for the reference when it is served from here
_RANGE = re.compile(r"bytes=(\d*)-(\d*)$")


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map,
                          **{".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
                             ".wasm": "application/wasm", ".ipynb": "application/json", ".tif": "image/tiff",
                             ".vcf": "text/plain", ".fa": "text/plain", ".bed": "text/plain", ".gtf": "text/plain"})  # fmt: skip
    reference = None  # a local copy of the reference, or None (redirect to the web)

    def translate_path(self, path):
        clean = path.split("?", 1)[0].split("#", 1)[0]
        if self.reference and clean.startswith(REFERENCE):
            rel = clean[len(REFERENCE):]
            return os.path.join(self.reference, *[p for p in rel.split("/") if p not in ("", ".", "..")])
        return super().translate_path(path)

    def end_headers(self):
        # (while you change the files, the browser fetches them anew each time)
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def send_head(self):
        clean = self.path.split("?", 1)[0]
        if clean.startswith(REFERENCE) and not self.reference:
            self.send_response(HTTPStatus.FOUND)
            self.send_header("Location", LIVE + self.path)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None
        rng = self.headers.get("Range")
        path = self.translate_path(self.path)
        if not rng or not os.path.isfile(path):
            return super().send_head()
        m = _RANGE.match(rng.strip())
        size = os.path.getsize(path)
        if not m or m.groups() == ("", ""):
            return super().send_head()  # (a range we don't serve: the whole file, as the standard allows)
        a, b = m.groups()
        start, end = (max(0, size - int(b)), size - 1) if a == "" else (int(a), min(size - 1, int(b) if b else size - 1))
        if start >= size or start > end:
            self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None
        fh = open(path, "rb")
        fh.seek(start)
        self.send_response(HTTPStatus.PARTIAL_CONTENT)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        self._remaining = end - start + 1
        return fh

    def copyfile(self, source, outputfile):
        left = getattr(self, "_remaining", None)
        if left is None:
            return super().copyfile(source, outputfile)
        while left > 0:
            buf = source.read(min(left, 1 << 16))
            if not buf:
                break
            outputfile.write(buf)
            left -= len(buf)
        self._remaining = None

    def log_message(self, fmt, *args):
        if os.environ.get("SERVE_LOG"):
            super().log_message(fmt, *args)


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Serve GpxilStudio on this computer.")
    ap.add_argument("port", nargs="?", type=int, default=8000)
    ap.add_argument("--reference", metavar="DIR", help="a local copy of the Gpxil browser's data/grch38 folder")
    a = ap.parse_args()
    if a.reference:
        if not os.path.isdir(os.path.join(a.reference, "gpxil")):
            ap.error(f"{a.reference} has no gpxil folder: give the Gpxil browser's site/data/grch38")
        Handler.reference = os.path.abspath(a.reference)
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    where = Handler.reference or LIVE + REFERENCE
    print(f"Serving on http://localhost:{a.port}  (the GRCh38 reference: {where})  (Ctrl+C to stop)", flush=True)
    Server(("127.0.0.1", a.port), Handler).serve_forever()
