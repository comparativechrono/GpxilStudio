#!/usr/bin/env python3
"""Run every code box of the help (index.html), as a reader would: the terminal boxes with bash, the Python boxes
with Python, in a fresh home folder with the examples beside it; and then the code cells of the notebooks a new user
is given (data/starter), each notebook's cells in order, as one program.

The boxes are run in the order of the pages, so a box may use what an earlier box of its page wrote. Paths are
those of the studio: /data/examples and /home/user (~) are replaced by folders made for the run, and gpxil,
gpxil2pxil and pxil are small scripts that run the studio's own packages (python/). `viewer`, `download` and
`export-session` do nothing here.

The GRCh38 reference (/data/grch38) and the Gpxil browser's gene files come from the web in the studio. Here they
come from a copy, if STUDIO_REFERENCE names one (the Gpxil browser's site/data/grch38 folder); without it, the
boxes that need them are skipped, and the count says so. The tests never use the network.

The Python that runs this needs NumPy, Pillow and jsonschema (gpxiltools' own needs).

Run:  python3 tests/help_code.py            (after python3 build/make_page.py)
"""
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROGRAMS = ["gpxil", "gpxil2pxil", "pxil"]
NOTHING = ["viewer", "download", "export-session"]


def boxes():
    page = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    for art in re.finditer(r'<article class="help-page" id="(h-[\w-]+)".*?</article>', page, re.S):
        for m in re.finditer(r'<pre class="code" data-run="(term|py)"><code>(.*?)</code></pre>', art.group(0), re.S):
            yield art.group(1), m.group(1), html.unescape(m.group(2))
    # the notebooks a new user is given (data/starter): each one's code cells, in order, as one Python program
    starter = os.path.join(ROOT, "data", "starter")
    for name in sorted(os.listdir(starter)) if os.path.isdir(starter) else []:
        if name.endswith(".ipynb"):
            nb = json.load(open(os.path.join(starter, name), encoding="utf-8"))
            cells = ["".join(c["source"]) for c in nb["cells"] if c["cell_type"] == "code"]
            yield "notebook " + name, "py", "\n".join(cells)


def needs_web(code, kind="term"):
    """a box that reads the GRCh38 reference or the Gpxil browser's genes, which come from the web in the studio"""
    if "/data/grch38" in code or "comparativechrono.github.io" in code or "BrowserData(" in code:
        return True
    # the command gpxil2pxil without a GTF of its own uses the Gpxil browser's genes: in a terminal box, or on a ! line
    # of a Python box (in Python itself, `from gpxil2pxil import …` needs no web; BrowserData() does, above)
    for line in code.split("\n"):
        if kind == "py" and not line.lstrip().startswith("!"):
            continue
        if re.search(r"(^|[\s!;|&(])gpxil2pxil\s", line) and not re.search(r"\s(-a|--annotation)[\s=]", line) and "--help" not in line:
            return True
    return False


def main():
    reference = os.environ.get("STUDIO_REFERENCE", "")
    have_ref = bool(reference) and os.path.isdir(os.path.join(reference, "gpxil"))
    tmp = tempfile.mkdtemp(prefix="help-code-")
    home, ex, bin_ = os.path.join(tmp, "home"), os.path.join(tmp, "examples"), os.path.join(tmp, "bin")
    for d in (home, bin_):
        os.makedirs(d)
    for d in ("genomes", "results", "notebooks"):
        os.makedirs(os.path.join(home, d))
    shutil.copytree(os.path.join(ROOT, "data", "examples"), ex)
    py = os.path.join(ROOT, "python")
    vendor = os.path.join(py, "vendor")
    wheels = [os.path.join(vendor, f) for f in sorted(os.listdir(vendor)) if f.endswith(".whl")]
    path = [py] + wheels
    for name in PROGRAMS:
        with open(os.path.join(bin_, name), "w") as fh:
            fh.write('#!/bin/sh\nexec "%s" -I -c "import sys; sys.path[:0] = %r; from gpxilwb.cli import run; '
                     'sys.exit(run(sys.argv[1:]))" %s "$@"\n' % (sys.executable, path, name))
    for name in NOTHING:
        with open(os.path.join(bin_, name), "w") as fh:
            fh.write("#!/bin/sh\nexit 0\n")
    with open(os.path.join(bin_, "python"), "w") as fh:
        fh.write('#!/bin/sh\nPYTHONPATH=%r exec "%s" "$@"\n' % (os.pathsep.join(path), sys.executable))
    for f in os.listdir(bin_):
        os.chmod(os.path.join(bin_, f), 0o755)
    env = dict(os.environ, HOME=home, PATH=bin_ + os.pathsep + os.environ.get("PATH", ""), PYTHONPATH=os.pathsep.join(path))
    # (no network: a request that would leave this computer fails at once)
    env.update(HTTPS_PROXY="http://127.0.0.1:9", HTTP_PROXY="http://127.0.0.1:9", https_proxy="http://127.0.0.1:9", http_proxy="http://127.0.0.1:9")
    if have_ref:
        env["GPXIL_BROWSER_DATA"] = reference

    def paths(text):
        text = text.replace("/data/examples", ex).replace("/home/user", home)
        if have_ref:
            text = text.replace("/data/grch38", os.path.join(reference, "gpxil"))
            text = text.replace("https://comparativechrono.github.io/Gpxil-browser/data/grch38", reference)
        return text

    failed, ran, skipped = [], 0, 0
    for page, kind, code in boxes():
        if needs_web(code, kind) and not have_ref:
            skipped += 1
            continue
        code = paths(code)
        if kind == "term":
            r = subprocess.run(["bash", "-e", "-o", "pipefail", "-c", code], cwd=home, env=env,
                               capture_output=True, text=True, timeout=900)
        else:
            # a notebook cell: ! lines are commands; the rest is Python
            lines = []
            for line in code.split("\n"):
                if line.startswith("!"):
                    lines.append("__import__('subprocess').run(%r, shell=True, check=True, executable='bash')" % line[1:])
                else:
                    lines.append(line)
            r = subprocess.run([sys.executable, "-I", "-c", "import sys; sys.path[:0] = %r\n" % path + "\n".join(lines)],
                               cwd=home, env=env, capture_output=True, text=True, timeout=900)
        ran += 1
        # (validate ends with 1 when a file is invalid, as it should in some boxes)
        if r.returncode != 0 and not (kind == "term" and expected_failure(code, r)):
            failed.append((page, kind, code, r.stdout[-1500:], r.stderr[-1500:]))
    for page, kind, code, out, err in failed:
        print("=" * 70, "\nFAILED", page, kind, "\n" + code, "\n--- stdout\n" + out, "\n--- stderr\n" + err)
    print("%d boxes run, %d skipped, %d failed" % (ran, skipped, len(failed)) +
          ("" if have_ref else " (skipped: the boxes that read /data/grch38 or the Gpxil browser's genes; set STUDIO_REFERENCE)"))
    shutil.rmtree(tmp, ignore_errors=True)
    return 1 if failed else 0


def expected_failure(code, r):
    """the boxes that show an invalid file end with exit status 1 on purpose"""
    last = [line for line in code.strip().split("\n") if line.strip()][-1]
    return r.returncode == 1 and re.match(r"\s*gpxil validate", last) is not None


if __name__ == "__main__":
    sys.exit(main())
