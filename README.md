# GpxilStudio

A workbench in the browser for **gpxil** files – genomes stored as pictures,
one pixel per base – with the gpxil toolkit loaded and ready. Look at any
gpxil file plane by plane, make one from a VCF, draw a gene or a chromosome,
print a genome as a book, make pictures of a person's own version of a gene
and its protein, and get FASTA and VCF back out: by pointing and clicking, in
a terminal, or in Python notebooks. Nothing is installed and nothing is
uploaded: the files and Python stay on the computer of the person using it.

The help, on the left, walks through all of it – the format, its codes, the
tools and how to work with a whole genome without running out of memory –
with a button for every step.

**Open it:** <https://comparativechrono.github.io/GpxilStudio/>

## Contents

1. [What is in it](#what-is-in-it)
2. [Big files](#big-files)
3. [Put it on GitHub Pages](#put-it-on-github-pages)
4. [Try it on your own computer](#try-it-on-your-own-computer)
5. [How it is made](#how-it-is-made)
6. [Tests](#tests)
7. [The packages](#the-packages)
8. [Files](#files)
9. [Credits and licences](#credits-and-licences)

## What is in it

One page, `index.html`, with the help on the left and five tabs on the right:

| Tab | What it is for |
|---|---|
| **Viewer** | Any gpxil file – yours, an example, or a chromosome of GRCh38 – as pixels: the reference, the genotype, the two haplotypes, the variants by zygosity, and the flags, quality, depth and phase-set planes. Pointing at a pixel says what the file holds there. It reads only the strips it shows, so a whole genome opens at once, and it draws exactly what `gpxil render` draws, whose command it gives. |
| **Tools** | The packages behind forms: each tool runs one command, exactly as the terminal would, and shows that command, and the same work in Python. The first page is a map of the formats and the common tasks. **Workflows** chains the tools together, after the Galaxy-style workflows of the lab's other workbenches. |
| **Files** | Your files and the examples: look at them (a gpxil file's contigs and planes, read in the page), edit, upload and download. |
| **Notebook** | Python notebooks (`.ipynb`) with all the packages, starting with *gpxil in Python*, which works through a genome pixel by pixel. |
| **Terminal** | A bash-like shell with `gpxil`, `gpxil2pxil` and `pxil` as commands, text tools, `python` and `pip`. |

The tools:

| Group | Tools |
|---|---|
| Look inside and check | What's in a gpxil file (`gpxil info`) · Check a gpxil file (`gpxil validate`) |
| Make gpxil files | Make a gpxil file (`gpxil encode`): a reference (FASTA, or a gpxil file such as a chromosome of GRCh38) and one person's VCF, with the regions called with confidence |
| Pictures and print | Draw a region as a picture (`gpxil render`: PNG, or TIFF in RGB or CMYK) · Print it as a book (`gpxil book`) · The palettes |
| Back to FASTA and VCF | Sequences as FASTA (`gpxil fasta`: the reference, either haplotype, or the genotype in IUPAC codes) · Variants as VCF (`gpxil vcf`) |
| Genes as pictures | Genes, transcripts and proteins as pxil pictures (`gpxil2pxil`) · pxil pictures → FASTA (`pxil`) |

The examples (`data/examples`) are the gpxil specification's worked example;
chromosome 17 of HG002, the Genome in a Bottle benchmark genome, as a gpxil
file; HG002's variants around TP53 as a VCF with its callable regions; and
TP53's lines of the Ensembl GTF. Four example workflows run on them. The
GRCh38 reference is there too, as `/data/grch38`: one gpxil file per
chromosome, read from the [Gpxil browser](https://comparativechrono.github.io/Gpxil-browser/)
a strip at a time.

## Big files

A whole genome is 850 MB as gpxil, and a browser tab has a few gigabytes at
most, so nothing big is ever copied whole:

- **The Viewer and the Files tab** read gpxil files in the page
  (`assets/js/gpxil-read.js`): the TIFF's directories, then only the strips a
  view needs, from the browser's storage or with HTTP range requests, inflated
  with the browser's own `DecompressionStream`.
- **Python** (Pyodide, in a web worker) sees every file of 8 MB or more
  (`lazyFileMB` in `assets/js/config.js`) as a file that is read a piece at a
  time: your files from the browser's storage (Emscripten's WORKERFS, which
  reads a Blob without copying it), the examples and the reference from the
  web (lazy files, 1 MB at a time). A big file that Python writes becomes a
  Blob, kept by the browser outside the worker, and is read the same way.
  gpxiltools reads a region's strips only, so `gpxil info` on chromosome 1 of
  GRCh38 reads a few kilobytes, and a gene a few hundred.
- In the browser the tools draw at most 25 Mb at once and write at most 50 Mb
  of FASTA at once, and a book is a proof of five pages (the cover, the page
  on how to read it, the chromosome's title page and two pages of bases)
  unless the limit is cleared. On your own computer the same commands have no
  such limits.

`gpxiltools` 0.3.0 was made for this: it reads files on web servers with
range requests, takes a gpxil file as the reference (reading only the contigs
it needs), and runs without imagecodecs, which Pyodide doesn't have. The
experiments behind the design are in
[Gpxil-scratchpad](https://github.com/comparativechrono/Gpxil-scratchpad)
(`experiments/01-browser-python`): the 809 MB whole genome opened in 72 MB of
Python memory.

## Put it on GitHub Pages

Settings → Pages → *Deploy from a branch*: `main`, `/ (root)`. The site is
the repository itself; `.nojekyll` is there so that GitHub serves it as it is.
On `comparativechrono.github.io` the studio reads the GRCh38 reference from
the Gpxil browser on the same site (`/Gpxil-browser/data/grch38/`), so the
Gpxil browser must be published there too; elsewhere it reads it from
`https://comparativechrono.github.io/Gpxil-browser/data/grch38/`
(`referenceBase` in `assets/js/config.js`).

The page keeps each person's files in their browser (IndexedDB, under the
prefix `gpxilstudio`). Python itself comes from jsDelivr the first time it
starts (about 15 MB), and the browser keeps it.

## Try it on your own computer

```sh
python3 serve.py 8000                                   # then open http://localhost:8000/
python3 serve.py 8000 --reference ../Gpxil-browser/site/data/grch38   # the reference from a copy
```

`serve.py` answers range requests, as GitHub Pages does. Without
`--reference` it sends requests for the reference on to the Gpxil browser's
site.

## How it is made

Plain JavaScript, no build tools: the page is put together by a few scripts.

```sh
python3 python/build_bundle.py          # the Python packages → assets/py/gpxil-tools.zip (+ .json)
python3 build/make_reference.py         # the GRCh38 reference's files → build/reference.json
python3 build/make_starter.py           # the starter notebook → data/starter/
node build/make_example_workflows.js    # the example workflows → data/examples/workflows/
python3 build/make_page.py              # build/template.html + build/help/*.html → index.html
```

- `assets/js/` – the framework (from the lab's Bioinformatics and Pedigree
  workbenches: the help, the shell, the notebook, the editor, the file system
  and the Python worker), and the studio's own parts: `gpxil-read.js` and
  `viewer-tab.js` (the Viewer), `tools.js` (the tools), `workflows.js`,
  `schematic.js` (the map of the formats), `page-wb.js` (the files, the
  examples and the reference) and `py-worker.js` (Python, with the lazy files).
- `python/gpxilwb/` – the studio's own Python: it runs the programs by name for
  the terminal (`python -m gpxilwb gpxil info …`), and has the few functions
  the Tools tab calls (`inspect`, `validate`, `palettes`).
- `python/vendor/` – the wheels of gpxiltools, gpxil2pxil, pxil and tifffile
  that the bundle is made from; `SOURCES.json` says where each came from.
- `build/help/` – the help, one page per file (`make_page.py` describes the
  format), and `build/citations.json`, the references the pages cite.

## Tests

```sh
node tests/workflows/engine.js                           # the workflow engine, and the examples run for real
node tests/equivalence/gen.js > cases.jsonl && python3 tests/equivalence/run_equiv.py cases.jsonl
python3 tests/help_code.py                               # every code box of the help, and the starter notebook
python3 tests/browser_smoke.py                           # the page in Chromium (Playwright), desktop and phone
```

The Python tests need NumPy, Pillow and jsonschema. Set `STUDIO_REFERENCE` to
a copy of the Gpxil browser's `site/data/grch38` to include what reads the
GRCh38 reference; without it, those parts are skipped. No test uses the
network, except that the browser test fetches Pyodide from jsDelivr (once: it
keeps a copy).

- **engine.js** checks the workflow engine with every tool – connections,
  loops, where a run's files go, a run step by step, its commands and
  notebook – and then runs each example workflow with the studio's packages.
- **equivalence** runs each tool's command and its Python, as the Tools tab
  shows them, in two folders, and checks that they write the same files.
- **help_code.py** runs every terminal and Python box of the help, in order.
- **browser_smoke.py** opens the page and uses each tab, as a first session
  would.

## The packages

| Package | What it does | Source |
|---|---|---|
| [gpxiltools](https://github.com/comparativechrono/Gpxil-tools) | read, write, check, draw and print gpxil files; `gpxil` | PyPI (`pip install gpxiltools`) |
| [gpxil2pxil](https://github.com/comparativechrono/gpxil2pxil) | pictures of genes, transcripts and proteins from a gpxil genome; `gpxil2pxil` | PyPI (`pip install gpxil2pxil`) |
| [pxil](https://github.com/comparativechrono/pxil) | one sequence as a picture: read and write pxil files; `pxil` | PyPI (`pip install pxil`) |

The studio's copies are the wheels of those releases on PyPI, unchanged, in
`python/vendor`; `python/vendor/SOURCES.json` records each one's source and
checksum. Each package is published to PyPI from a GitHub release by its
repository's release workflow. To update one in the studio, replace its wheel
and its record, then run `python3 python/build_bundle.py` and
`python3 build/make_page.py`.

## Files

```
index.html              the page (made by build/make_page.py)
serve.py                a local server with range requests
assets/js, assets/css   the page's code and styles; assets/vendor: CodeMirror, marked, DOMPurify, JSZip
assets/py               gpxil-tools.zip, the packages for the browser's Python, and what is in it
python/                 gpxilwb, the wheels in vendor/, and build_bundle.py
build/                  template.html, help/, citations.json, reference.json and the scripts that make the page
data/examples           the example files and workflows; data/starter: the starter notebook
tests/                  the tests above
```

## Credits and licences

GpxilStudio's own code, help and examples are under the MIT licence
([LICENSE](LICENSE)); [THIRD_PARTY.md](THIRD_PARTY.md) lists what it includes
or loads from elsewhere, with their licences. The genome pixel image is
Guenter Albrecht-Buehler's idea
([PLoS ONE 4(3): e4701, 2009](https://doi.org/10.1371/journal.pone.0004701)).
The examples use data from the Genome in a Bottle Consortium (NIST) and
Ensembl.

Copyright © 2026 Chronomic Medicine Group, Department of Genomic Medicine,
University of Cambridge.
