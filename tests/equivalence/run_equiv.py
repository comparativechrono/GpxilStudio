"""The Tools tab shows, under each tool, the same work as a command and as Python. For each case that gen.js prints,
run the command (as the Tools tab and the terminal do) in one home folder and the Python in another, and compare the
files they write: they must hold the same, apart from the time they were made. Both must succeed (the command with
exit status 0), unless the case says that both must fail. For the cases marked so, the two must print the same.

    node tests/equivalence/gen.js assets/js/tools.js > cases.jsonl
    python3 tests/equivalence/run_equiv.py cases.jsonl

The cases that read the GRCh38 reference run when STUDIO_REFERENCE names a copy of the Gpxil browser's data/grch38
(gpxil2pxil's genes come from it too); without it they are skipped. Nothing is fetched from the web.
"""
import contextlib
import io
import json
import os
import re
import shutil
import sys
import tempfile
import traceback

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path[:0] = [REPO + "/python"] + [os.path.join(REPO, "python", "vendor", f) for f in sorted(os.listdir(REPO + "/python/vendor")) if f.endswith(".whl")]
for k in ("HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"):
    os.environ[k] = "http://127.0.0.1:9"  # (no network: a request that would leave this computer fails at once)
REFERENCE = os.environ.get("STUDIO_REFERENCE", "")
if REFERENCE:
    os.environ["GPXIL_BROWSER_DATA"] = REFERENCE

import numpy as np  # noqa: E402
import pxil  # noqa: E402
import tifffile  # noqa: E402
from gpxiltools import GpxilFile  # noqa: E402
from gpxilwb import cli  # noqa: E402
from PIL import Image  # noqa: E402

CASES = sys.argv[1] if len(sys.argv) > 1 else "cases.jsonl"
TMP = tempfile.mkdtemp(prefix="equiv-")
HA, HB = os.path.join(TMP, "homeA"), os.path.join(TMP, "homeB")
for d in (HA, HB):
    for s in ("results", "genomes", "notebooks"):
        os.makedirs(os.path.join(d, s))
EX = REPO + "/data/examples"


def sub(s, home):
    s = s.replace("/home/user", home).replace("/data/examples", EX)
    if REFERENCE:
        s = s.replace("/data/grch38", os.path.join(REFERENCE, "gpxil"))
    return s


def snapshot(home):
    out = {}
    for dp, dn, fn in os.walk(home):
        for f in fn:
            p = os.path.join(dp, f)
            out[os.path.relpath(p, home)] = open(p, "rb").read()
    return out


def without(d, *keys):
    if isinstance(d, dict):
        return {k: without(v, *keys) for k, v in d.items() if k not in keys}
    if isinstance(d, list):
        return [without(v, *keys) for v in d]
    return d


def contents(path):
    """what a file holds, apart from when it was made: a gpxil file's metadata and planes, a picture's pixels, a pxil
    file's sequence and metadata, a PDF without its date, text as it is"""
    name = path.lower()
    if name.endswith((".gpxil.tif", ".gpxil.tiff")):
        with GpxilFile(path) as g:
            planes = {c.name: {p: c.read(p).tobytes() for p in c.planes} for c in g}
            side = {c.name: [e.to_tsv() for e in c.sidecar()] for c in g}
            return json.dumps(without(g.metadata, "created"), sort_keys=True), planes, side
    if name.endswith(".pxil.png"):
        seq, meta = pxil.read(path)
        return seq, json.dumps(without(meta, "created"), sort_keys=True)
    if name.endswith(".png"):
        im = Image.open(path)
        return im.mode, im.size, im.tobytes(), im.getpalette(), im.info.get("dpi")
    if name.endswith((".tif", ".tiff")):
        with tifffile.TiffFile(path) as t:
            p = t.pages[0]
            return p.photometric, p.shape, p.asarray().tobytes(), str(p.tags.get("XResolution").value if "XResolution" in p.tags else None)
    data = open(path, "rb").read()
    if name.endswith(".json"):  # (one JSON document or several, one after another: pxil --info)
        text, docs, dec, i = data.decode(), [], json.JSONDecoder(), 0
        while i < len(text):
            if text[i].isspace():
                i += 1
                continue
            doc, i = dec.raw_decode(text, i)
            docs.append(without(doc, "created"))
        return json.dumps(docs, sort_keys=True)
    if name.endswith(".pdf"):
        return re.sub(rb"/CreationDate \([^)]*\)", b"", data)
    return data


ok = bad = skipped = 0
for line in open(CASES):
    c = json.loads(line)
    if c.get("reference") and not REFERENCE:
        skipped += 1
        print(f"skip {c['id']:14} (it reads the GRCh38 reference: set STUDIO_REFERENCE)")
        continue
    before = {h: snapshot(h) for h in (HA, HB)}
    for o in c["outputs"]:
        for h in (HA, HB):
            os.makedirs(os.path.dirname(sub(o, h)), exist_ok=True)
    # the command
    codes = []
    out_a, err_a = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out_a), contextlib.redirect_stderr(err_a):
        for argv in c["argv"]:
            codes.append(cli.run([sub(a, HA) for a in argv]))
    # the Python
    err_b = ""
    out_b = io.StringIO()
    try:
        with contextlib.redirect_stdout(out_b), contextlib.redirect_stderr(io.StringIO()):
            exec(compile(sub(c["python"], HB), "<py>", "exec"), {"__name__": "__main__"})
    except BaseException:  # noqa: BLE001 - SystemExit too: a tool that stops
        err_b = traceback.format_exc()
    after = {h: snapshot(h) for h in (HA, HB)}
    new_a = {k for k, v in after[HA].items() if before[HA].get(k) != v}
    new_b = {k for k, v in after[HB].items() if before[HB].get(k) != v}
    same_names = new_a == new_b
    diffs = [k for k in sorted(new_a & new_b) if contents(os.path.join(HA, k)) != contents(os.path.join(HB, k))]
    printed = not c.get("same") or out_a.getvalue().replace(HA, "~") == out_b.getvalue().replace(HB, "~")
    if c.get("fails"):
        good = any(x != 0 for x in codes) and bool(err_b) and not new_a and not new_b
    else:
        good = same_names and not diffs and not err_b and all(x == 0 for x in codes) and printed
    status = "ok" if good else "DIFF"
    ok += good
    bad += not good
    print(f"{status:4} {c['id']:14} codes={codes} files A={sorted(new_a)} B={'=' if same_names else sorted(new_b)} {('diffs=' + str(diffs)) if diffs else ''}")
    if not printed:
        print("   printed differently:\n   command: %r\n   Python:  %r" % (out_a.getvalue()[:300], out_b.getvalue()[:300]))
    if err_b and (status != "ok" or not c.get("fails")):
        print("   python error:", err_b.strip().splitlines()[-1])
    if c.get("fails") and status == "ok":
        print("   (both stopped, as they should:", err_b.strip().splitlines()[-1][:120] + ")")
    if not c.get("fails") and any(x != 0 for x in codes):
        print("   command stderr:", err_a.getvalue().strip()[-400:])
print(f"\n{ok} the same, {bad} different, {skipped} skipped")
shutil.rmtree(TMP, ignore_errors=True)
sys.exit(1 if bad else 0)
