#!/usr/bin/env python3
"""Pack the Python packages for the web page: assets/py/gpxil-tools.zip.

The studio's Python (Pyodide, in the browser) unpacks the archive when it
starts and puts it on sys.path, so the packages import as they would after
``pip install``: gpxiltools, gpxil2pxil, pxil and tifffile, taken from their
wheels in python/vendor (python/vendor/SOURCES.json says where each wheel
came from), and the studio's own runner, gpxilwb. NumPy, Pillow and
jsonschema are Pyodide's own packages, loaded when Python starts.

assets/py/gpxil-tools.json records what is in the archive and a checksum,
which the page adds to the archive's address so that a browser never keeps an
old copy.

Run after changing anything under python/:   python3 python/build_bundle.py
"""
import hashlib
import io
import json
import os
import re
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "assets", "py")
ARCHIVE = "gpxil-tools.zip"
OWN = ["gpxilwb"]  # packages kept here, in python/
SOURCES = os.path.join(HERE, "vendor", "SOURCES.json")


def version_of(pkg):
    init = os.path.join(HERE, pkg, "__init__.py")
    m = re.search(r'^__version__\s*=\s*["\']([^"\']+)', open(init, encoding="utf-8").read(), re.M)
    return m.group(1) if m else ""


def own_entries():
    for pkg in OWN:
        base = os.path.join(HERE, pkg)
        for dp, dn, fn in os.walk(base):
            dn[:] = sorted(d for d in dn if d != "__pycache__" and not d.startswith("."))
            for f in sorted(fn):
                if f.endswith((".pyc", ".pyo")) or f.startswith("."):
                    continue
                full = os.path.join(dp, f)
                with open(full, "rb") as fh:
                    yield fh.read(), os.path.relpath(full, HERE).replace(os.sep, "/")


def wheel_entries(record):
    """a wheel's modules and packages (without tests), and its licence"""
    tops = record["modules"]
    with zipfile.ZipFile(os.path.join(HERE, "vendor", record["wheel"])) as z:
        for name in sorted(z.namelist()):
            if name.endswith("/"):
                continue
            first = name.split("/", 1)[0]
            if first in tops or (first.endswith(".py") and first[:-3] in tops):
                parts = name.split("/")
                if "tests" in parts[1:-1] or parts[-1] == "conftest.py":
                    continue
                yield z.read(name), name
            elif re.match(r"[^/]+\.dist-info/(licenses/)?LICEN[CS]E[^/]*$", name):
                yield z.read(name), f"licences/{record['project']}-{os.path.basename(name)}"


def write_archive(name, entries):
    """entries: (data, name in the archive) -> (bytes, sha256); the same entries always give the same archive"""
    buf = io.BytesIO()
    count = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        seen = set()
        for data, rel in entries:
            if rel in seen:
                continue
            seen.add(rel)
            info = zipfile.ZipInfo(rel, date_time=(2026, 1, 1, 0, 0, 0))  # a fixed date: the checksum follows the contents
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, data)
            count += 1
    data = buf.getvalue()
    digest = hashlib.sha256(data).hexdigest()
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name), "wb") as fh:
        fh.write(data)
    print(f"assets/py/{name}: {count} files, {len(data) / 1024:.0f} KB, sha256 {digest[:12]}")
    return {"archive": name, "sha256": digest, "bytes": len(data)}


def main():
    sources = json.load(open(SOURCES, encoding="utf-8"))
    entries = list(own_entries())
    packages = {}
    for record in sources["wheels"]:
        entries.extend(wheel_entries(record))
        packages[record["project"]] = record["version"]
    for pkg in OWN:
        packages[pkg] = version_of(pkg)
    meta = write_archive(ARCHIVE, entries)
    meta["packages"] = packages
    meta["pyodide_packages"] = ["numpy", "pillow", "jsonschema"]
    with open(os.path.join(OUT, "gpxil-tools.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=1)
        fh.write("\n")
    print("packages: " + ", ".join(f"{k} {v}" for k, v in packages.items()))


if __name__ == "__main__":
    main()
