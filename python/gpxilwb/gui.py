"""What the studio's Tools tab asks Python.

The tab runs its tools as command lines (``run``), so that what it does is
exactly what the terminal and the packages do. A few things need answers
rather than files, and those are here: what a file is (``inspect``), a check
against the gpxil specification (``validate``), the counts of ``gpxil stats``
(``stats``) and the palettes (``palettes``).

Every function takes and returns plain JSON-like values, because the page
calls them through the web worker that runs Python.
"""
from __future__ import annotations

import contextlib
import gzip
import io
import json
import os
import re
from typing import Any, Dict, List, Optional

from . import cli

# --------------------------------------------------------------------- running programs


def run(argv: List[str], cwd: Optional[str] = None) -> Dict[str, Any]:
    """Run a program (``argv[0]``) as the terminal would and return ``{"code", "stdout", "stderr"}``."""
    out, err = io.StringIO(), io.StringIO()
    old = os.getcwd()
    try:
        if cwd:
            os.chdir(os.path.expanduser(cwd))
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = cli.run([str(a) for a in argv])
    finally:
        os.chdir(old)
    return {"code": code, "stdout": out.getvalue(), "stderr": err.getvalue()}


def versions() -> Dict[str, str]:
    """The version of each package in the studio."""
    import importlib

    out = {}
    for mod, name in (("gpxiltools", "gpxiltools"), ("gpxil2pxil", "gpxil2pxil"), ("pxil", "pxil"), ("tifffile", "tifffile"),
                      ("numpy", "numpy"), ("PIL", "Pillow"), ("gpxilwb", "gpxilwb")):  # fmt: skip
        try:
            out[name] = getattr(importlib.import_module(mod), "__version__", "")
        except Exception:  # noqa: BLE001
            out[name] = ""
    return out


# --------------------------------------------------------------------- what a file is

_GPXIL = re.compile(r"\.(gpxil\.tiff?|gpxil)$", re.I)
_PXIL = re.compile(r"\.pxil(\.png)?$", re.I)
_VCF = re.compile(r"\.vcf(\.b?gz)?$", re.I)
_FASTA = re.compile(r"\.(fa|fasta|fna)(\.b?gz)?$", re.I)
_BED = re.compile(r"\.bed(\.gz)?$", re.I)
_GTF = re.compile(r"\.(gtf|gff3?)(\.gz)?$", re.I)


def _open_text(path: str):
    fh = open(path, "rb")
    if fh.read(2) == b"\x1f\x8b":
        fh.seek(0)
        return io.TextIOWrapper(gzip.GzipFile(fileobj=fh), encoding="utf-8", errors="replace")
    fh.seek(0)
    return io.TextIOWrapper(fh, encoding="utf-8", errors="replace")


def _gpxil_summary(path: str) -> Dict[str, Any]:
    from gpxiltools import GpxilFile

    with GpxilFile(path) as g:
        m = g.metadata
        contigs = []
        for c in g:
            e = c.entry
            contigs.append({"name": c.name, "length": c.length, "planes": c.planes, "records": (e.get("encoding") or {}).get("records"),
                            "sidecar": e.get("sidecar_entries", 0), "aliases": e.get("aliases", [])})  # fmt: skip
        s = m.get("sample") if isinstance(m.get("sample"), dict) else None
        return {
            "kind": "gpxil",
            "format": m.get("gpxil"),
            "generator": m.get("generator"),
            "created": m.get("created"),
            "reference": (m.get("reference") or {}),
            "sample": s,
            "width": (m.get("layout") or {}).get("width"),
            "palette": m.get("palette"),
            "contigs": contigs[:400],
            "n_contigs": len(contigs),
            "bases": sum(c["length"] for c in contigs),
            "has_ref": all("ref" in c["planes"] for c in contigs),
        }


def _pxil_summary(path: str) -> Dict[str, Any]:
    import pxil

    seq, meta = pxil.read(path)
    return {"kind": "pxil", "meta": meta, "head": seq[:120], "length": len(seq)}


def _vcf_summary(path: str) -> Dict[str, Any]:
    samples: List[str] = []
    contigs: Dict[str, int] = {}
    records = 0
    with _open_text(path) as fh:
        for line in fh:
            if line.startswith("##"):
                continue
            if line.startswith("#CHROM"):
                samples = line.rstrip("\n").split("\t")[9:]
                continue
            records += 1
            c = line.split("\t", 1)[0]
            contigs[c] = contigs.get(c, 0) + 1
            if records >= 2_000_000:
                break
    return {"kind": "vcf", "samples": samples, "records": records, "contigs": contigs, "partial": records >= 2_000_000}


def _fasta_summary(path: str) -> Dict[str, Any]:
    seqs: List[List[Any]] = []
    with _open_text(path) as fh:
        for line in fh:
            if line.startswith(">"):
                seqs.append([line[1:].split()[0] if line[1:].strip() else "", 0])
            elif seqs:
                seqs[-1][1] += len(line.strip())
    return {"kind": "fasta", "sequences": seqs[:500], "n": len(seqs), "bases": sum(n for _, n in seqs)}


def _bed_summary(path: str) -> Dict[str, Any]:
    n, bases, contigs = 0, 0, {}
    with _open_text(path) as fh:
        for line in fh:
            if not line.strip() or line.startswith(("#", "track", "browser")):
                continue
            f = line.split("\t")
            if len(f) < 3:
                continue
            n += 1
            bases += int(f[2]) - int(f[1])
            contigs[f[0]] = contigs.get(f[0], 0) + 1
    return {"kind": "bed", "intervals": n, "bases": bases, "contigs": contigs}


def inspect(path: str) -> Dict[str, Any]:
    """What a file holds, in a few lines: for gpxil files their metadata and contigs."""
    name = os.path.basename(path)
    try:
        with open(path, "rb") as fh:
            magic = fh.read(4)
        if _GPXIL.search(name) or magic in (b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+"):
            try:
                return {"path": path, **_gpxil_summary(path)}
            except Exception as exc:  # noqa: BLE001 - a TIFF that is not gpxil
                if _GPXIL.search(name):
                    return {"path": path, "kind": "error", "error": f"{type(exc).__name__}: {exc}"}
                return {"path": path, "kind": "image", "error": str(exc)}
        if _PXIL.search(name) and magic == b"\x89PNG":
            return {"path": path, **_pxil_summary(path)}
        if _VCF.search(name):
            return {"path": path, **_vcf_summary(path)}
        if _FASTA.search(name):
            return {"path": path, **_fasta_summary(path)}
        if _BED.search(name):
            return {"path": path, **_bed_summary(path)}
        if _GTF.search(name):
            return {"path": path, "kind": "gtf"}
        return {"path": path, "kind": "other"}
    except Exception as exc:  # noqa: BLE001
        return {"path": path, "kind": "error", "error": f"{type(exc).__name__}: {exc}"}


# --------------------------------------------------------------------- checking a file


def validate(path: str, digests: bool = True) -> Dict[str, Any]:
    """Check a gpxil file against the specification, as ``gpxil validate`` does, and return what it found."""
    from gpxiltools.validate import validate as check

    rep = check(path, check_digests=digests)
    return {
        "valid": rep.ok,
        "errors": list(rep.errors),
        "warnings": list(rep.warnings),
        "checked": list(rep.checked),
        "findings": [{"severity": "error", "message": e} for e in rep.errors] + [{"severity": "warning", "message": w} for w in rep.warnings],
    }


def region(path: str, contig: str, start: int, end: int, planes: Optional[List[str]] = None) -> Dict[str, Any]:
    """A small region's values, plane by plane (for the viewer's details and the help): at most 10,000 bases."""
    from gpxiltools import GpxilFile

    end = min(end, start + 10_000)
    with GpxilFile(path) as g:
        c = g[contig]
        out = {"contig": c.name, "start": start, "end": end, "planes": {}}
        for p in planes or c.planes:
            if c.has(p):
                out["planes"][p] = c.read(p, start, end).tolist()
        return out


def stats(path: str, regions: Optional[List[str]] = None, reference: Optional[str] = None) -> Dict[str, Any]:
    """What a gpxil file holds, counted, as ``gpxil stats --json`` gives it: for every contig, or for regions given as
    the command takes them (``chr17`` or ``chr17:7,661,779-7,687,546``, 1-based)."""
    from gpxiltools.container import GpxilFile
    from gpxiltools.stats import stats as count

    parsed = [cli_region(r) for r in (regions or []) if str(r).strip()]
    with GpxilFile(path, reference=reference or None) as g:
        return count(g, parsed or None)


def cli_region(text: str):
    """A region as ``gpxil`` reads it: (contig, start (0-based), end or None)."""
    from gpxiltools.cli import _region

    return _region(str(text))


def palettes() -> List[Dict[str, Any]]:
    """gpxil's palettes: their names, descriptions, and the sRGB and CMYK colours of A, C, G, T and N."""
    from gpxiltools.palettes import describe

    return [{"name": p["name"], "description": p.get("description", ""),
             "srgb": {b: [int(x) for x in p["srgb"][b]] for b in "ACGTN"},
             "cmyk_percent": {b: [int(round(float(x))) for x in p["cmyk_percent"][b]] for b in "ACGTN"}}
            for p in describe()]  # fmt: skip


def to_json(obj: Any) -> str:
    return json.dumps(obj)
