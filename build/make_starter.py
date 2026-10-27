#!/usr/bin/env python3
"""Write the notebook a new user finds in ~/notebooks: data/starter/gpxil-in-python.ipynb.

It walks through a gpxil file in Python, on the examples: its contigs and planes, a region as NumPy arrays, the codes,
the variants, a person's two sequences, a picture, a whole chromosome a piece at a time, the GRCh38 reference from
the web, and pictures of a gene and its protein (gpxil2pxil and pxil). Every code cell is run by
tests/help_code.py (with the paths changed to temporary folders), so the notebook stays correct. Someone who visited
the studio before a notebook was added is given it on their next visit (page-wb.js).

Run:  python3 build/make_starter.py   (then python3 build/make_page.py)
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(os.path.dirname(HERE), "data", "starter")

CELLS = [
    ("md", """# gpxil in Python

A gpxil file is a genome as pictures: one pixel for each base, one page for each chromosome and *plane*. The `ref`
plane holds the reference's bases; the `gt` plane holds what a person has at each base, one half of the pixel for each
of their two copies (haplotypes); `flags`, `gq`, `dp` and `ps` hold the rest of what their VCF said. Everything is a
number – a code – so a region of a plane is simply a NumPy array.

This notebook works through the example `HG002_chr17.gpxil.tif`: chromosome 17 of HG002, the Genome in a Bottle
benchmark genome, with the GRCh38 reference. Run the cells in order from the top: click a cell and press
**Shift+Enter**. The first code cell starts Python in your browser, which takes a few seconds.

The examples are in `/data/examples` and can't be changed; what you make goes into your own folder, `~`
(`/home/user`). On your own computer the same code works once the packages are installed
(`pip install gpxiltools gpxil2pxil pxil`)."""),
    ("md", """## Open a file

`GpxilFile` reads the file's metadata – the JSON in the first page's description – and nothing else. Its contigs are
the chromosomes it holds, each with its length and planes."""),
    ("code", """from gpxiltools import GpxilFile

g = GpxilFile("/data/examples/HG002_chr17.gpxil.tif")
print(g.metadata["reference"]["name"], "·", g.sample_id)
for c in g:
    print(c.name, f"{c.length:,} bases", c.planes)"""),
    ("md", """## A region of a plane is a NumPy array

`read(plane, start, end)` reads the bases from `start` up to, but not including, `end`, counting from 0 – as Python
slices do. So TP53, which a genome browser shows as chr17:7,661,779-7,687,546, is `7_661_778` to `7_687_546`. Only
the strips of the page that hold those bases are read and unpacked: a few hundred kilobytes, not the whole
chromosome."""),
    ("code", """c = g["chr17"]
start, end = 7_661_778, 7_687_546      # TP53, counting from 0, the end not included
ref = c.read("ref", start, end)
gt = c.read("gt", start, end)
flags = c.read("flags", start, end)
print(ref.dtype, ref.shape, gt.dtype, flags.dtype)
print(ref[:12])
print(c.sequence(start, start + 60))   # the same bases as letters (lower case: soft-masked repeats)"""),
    ("md", """## Codes, not colours

In the `ref` plane, A is 1, C is 2, G is 4 and T is 8, and the other IUPAC codes are their sums (R, A or G, is 5; N is
15); 16 is added for a soft-masked base. In the `gt` plane, the high four bits are haplotype 1 and the low four bits
haplotype 2: 0 means *the reference base*, 1, 2, 4 or 8 another base, 13 (0xD) a deleted base, 10 (0xA) a copy that
isn't there (one X in a man), 12 (0xC) something too complex for a pixel, and 15 (0xF) *not known*.
`gpxiltools.codes` has these numbers by name, and helpers that split and translate them."""),
    ("code", """import numpy as np
from gpxiltools import codes

h1, h2 = codes.hap1(gt), codes.hap2(gt)
called = (h1 != codes.HAP_UNKNOWN) & (h2 != codes.HAP_UNKNOWN)
alt1 = ~np.isin(h1, [codes.HAP_REF, codes.HAP_UNKNOWN, codes.HAP_ABSENT])
alt2 = ~np.isin(h2, [codes.HAP_REF, codes.HAP_UNKNOWN, codes.HAP_ABSENT])
print(f"{called.mean():.1%} of TP53's bases were called with confidence")
print("heterozygous bases:", int((alt1 ^ alt2).sum()), "· homozygous:", int((alt1 & alt2).sum()))"""),
    ("md", """## Each variant base, as the file holds it

`describe_gt_byte` turns a `gt` value into words (`REF|G`: haplotype 1 has the reference base, haplotype 2 a G), and
the `flags` plane says whether the genotype was phased and whether a VCF record covered the base."""),
    ("code", """where = np.flatnonzero(alt1 | alt2)
for i in where[:12]:
    pos = start + i + 1                # back to counting from 1, as a VCF does
    said = [name for bit, name in codes.FLAG_NAMES.items() if flags[i] & bit]
    print(f"chr17:{pos:,}", chr(codes.REF_TO_ASCII[ref[i]]), codes.describe_gt_byte(int(gt[i])), ",".join(said))"""),
    ("md", """## P72R

The best-known variant of TP53 is P72R (rs1042522): a G to C change at chr17:7,676,154 that turns codon 72 of the
protein from proline to arginine. HG002 has it on both copies."""),
    ("code", """i = 7_676_154 - 1 - start
print("reference", c.sequence(start + i, start + i + 1), "· HG002", codes.describe_gt_byte(int(gt[i])))"""),
    ("md", """## A person's two sequences

A haplotype's sequence is the reference with that copy's variants applied: substituted bases replaced, deleted bases
removed, inserted bases (kept beside the picture, in the file's *sidecar*) put in, and bases not called written as N.
The genotype in IUPAC codes keeps the reference's length instead, with a heterozygous base as the code of its two
bases (R for A and G, Y for C and T …); a base deleted from one copy shows the other copy's base."""),
    ("code", """from gpxiltools.export import haplotype_sequence

s1 = haplotype_sequence(c, 1, start, end).decode()
s2 = haplotype_sequence(c, 2, start, end).decode()
print(len(s1), "and", len(s2), "bases; the reference has", end - start)
iupac = codes.genotype_iupac(ref, gt)
het = np.flatnonzero(alt1 ^ alt2)
print("the heterozygous bases:", "".join(chr(codes.REF_TO_ASCII[x]) for x in iupac[het]))"""),
    ("md", """## A picture

`render` draws a region as an indexed picture with the colours of a palette: here the variants, by zygosity, 256
bases to a row, each base two pixels square. The last line of a cell is shown, so the picture appears below it."""),
    ("code", """import os
from PIL import Image
from gpxiltools.render import render

pic = render(c, mode="variants", start=start, end=end, bases_per_row=256).scaled(2)
os.makedirs("/home/user/results", exist_ok=True)
pic.save_png("/home/user/results/TP53_variants.png")
print(pic.shape, pic.title)
Image.fromarray(pic.to_rgb())"""),
    ("md", """## A whole chromosome, a piece at a time

A plane of chromosome 17 is 83 million bytes. Read it in pieces and keep only what you need from each, and the
memory used stays small. Here, the bases a VCF record covered (the `VARIANT_SITE` flag) in each 5 Mb of the
chromosome."""),
    ("code", """step = 5_000_000
for a in range(0, c.length, step):
    f = c.read("flags", a, min(a + step, c.length))
    n = int(np.count_nonzero(f & codes.FLAG_VARIANT_SITE))
    print(f"{a / 1e6:4.0f} Mb {n:6,} " + "#" * (n // 400))"""),
    ("md", """## The reference, from the web

`/data/grch38` holds GRCh38, one gpxil file per chromosome, as the Gpxil browser serves it. The files are read from
the browser's web site a strip at a time, so a region costs a few hundred kilobytes of download, not the 23 MB of
chromosome 17."""),
    ("code", """with GpxilFile("/data/grch38/chr17.gpxil.tif") as r:
    web = r["chr17"].sequence(start, start + 60)
print(web)
print("the same as HG002's file:", web == c.sequence(start, start + 60))"""),
    ("md", """## Genes as pictures: gpxil2pxil and pxil

gpxil2pxil makes *pxil* files – PNG pictures of one sequence, one pixel a base or amino acid – of a gene, its
transcripts and its proteins, from the reference or from either haplotype. Genes come from a GTF file (here, TP53's
lines from Ensembl), or by default from the Gpxil browser's gene files on the web. `pxil.read` gives the sequence and
its metadata back."""),
    ("code", """import pxil
from gpxil2pxil import GTF, make

gene = GTF("/data/examples/TP53.gtf").find("TP53")
made = make(g, gene, kinds=["protein"], haplotypes=(None, 1), out_dir="/home/user/results/pxil")
for f in made:
    print(os.path.basename(f.path), f.notes)
protein, meta = pxil.read(made[-1].path)
print(meta["name"], len(protein), "amino acids:", protein[:20], "…")"""),
    ("md", """## The programs, from a notebook

A line that starts with `!` runs a command, as in the Terminal tab: `gpxil`, `gpxil2pxil` and `pxil` are all here."""),
    ("code", """!gpxil info /data/examples/worked-example.gpxil.tif"""),
    ("md", """## And then

Close the file when you've finished with it. The help (on the left) has more: **Work with a gpxil file pixel by
pixel**, **The codes**, **gpxil in Python**, and **A whole genome without running out of memory**."""),
    ("code", """g.close()"""),
]

NOTEBOOKS = {"gpxil-in-python.ipynb": CELLS}


def write(name, cell_list):
    cells = []
    for kind, src in cell_list:
        lines = src.split("\n")
        source = [line + "\n" for line in lines[:-1]] + [lines[-1]]
        if kind == "md":
            cells.append({"cell_type": "markdown", "id": "c%02d" % len(cells), "metadata": {}, "source": source})
        else:
            cells.append({"cell_type": "code", "id": "c%02d" % len(cells), "metadata": {}, "source": source,
                          "execution_count": None, "outputs": []})
    nb = {
        "cells": cells,
        "metadata": {
            "kernelspec": {"name": "python3", "display_name": "Python 3 (ipykernel)", "language": "python"},
            "language_info": {"name": "python", "file_extension": ".py", "mimetype": "text/x-python"},
            "workbench": {"made_with": "GpxilStudio (in the browser)"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, name), "w", encoding="utf-8") as fh:
        json.dump(nb, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    print("data/starter/{}: {} cells".format(name, len(cells)))


def main():
    for name, cell_list in NOTEBOOKS.items():
        write(name, cell_list)


if __name__ == "__main__":
    main()
