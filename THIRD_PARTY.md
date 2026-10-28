# Third-party software, data and provenance

GpxilStudio's own code, help and examples are under the MIT licence
([LICENSE](LICENSE)). What it includes from elsewhere, and what it loads at run
time, keeps its own licence. Keep each component's notices and licence files
when copying or redistributing its files.

## Included in the site

| Component | Version | Licence | Where | Origin |
|---|---|---|---|---|
| gpxiltools (Chronomic Medicine Group) | 0.6.0 | MIT | its wheel in `python/vendor`, packed into `assets/py/gpxil-tools.zip` with its licence | [PyPI](https://pypi.org/project/gpxiltools/0.6.0/), unchanged; released from [comparativechrono/Gpxil-tools](https://github.com/comparativechrono/Gpxil-tools) |
| gpxil2pxil (Chronomic Medicine Group) | 0.1.0 | MIT | the same | [PyPI](https://pypi.org/project/gpxil2pxil/0.1.0/), unchanged; released from [comparativechrono/gpxil2pxil](https://github.com/comparativechrono/gpxil2pxil) |
| pxil (Chronomic Medicine Group) | 0.1.1 | MIT | the same | [PyPI](https://pypi.org/project/pxil/0.1.1/), unchanged; released from [comparativechrono/pxil](https://github.com/comparativechrono/pxil) |
| tifffile (Christoph Gohlke) | 2026.10.15 | BSD 3-clause | the same, with its licence | [PyPI](https://pypi.org/project/tifffile/2026.10.15/), unchanged |
| gpxilwb | 1.0.0 | MIT | `python/gpxilwb`, packed into the same archive | written for the studio |
| gpxil-read.js, gpxiltools' JavaScript reader (Chronomic Medicine Group) | 0.6.0 | MIT | `assets/vendor/gpxil-read/`, with `gpxil-read.source.json` | copied unchanged from [comparativechrono/Gpxil-tools](https://github.com/comparativechrono/Gpxil-tools) `js/gpxil-read.js`, at the commit the record names |
| CodeMirror | 5.65.18 | MIT | `assets/vendor/codemirror/` (with its `LICENSE`) | [codemirror/codemirror5](https://github.com/codemirror/codemirror5) |
| marked | 18.0.13 | MIT | `assets/vendor/marked/` (with its `LICENSE`) | [markedjs/marked](https://github.com/markedjs/marked) |
| DOMPurify | 3.4.16 | Apache License 2.0 or Mozilla Public License 2.0 | `assets/vendor/dompurify/` (with its `LICENSE`) | [cure53/DOMPurify](https://github.com/cure53/DOMPurify) |
| JSZip | 3.10.1 | MIT or GNU GPL 3 (used under MIT) | `assets/vendor/jszip/` (with its `LICENSE.markdown`) | [Stuk/jszip](https://github.com/Stuk/jszip) |

The studio's framework – the page, help, shell, notebook and editor in
`assets/js` and `assets/css` – comes from the Hearn lab's Bioinformatics and
Pedigree workbenches.

## Loaded when the page runs

| Component | Version | Licence | From |
|---|---|---|---|
| Pyodide (CPython for the browser), with micropip | 0.29.5 | Mozilla Public License 2.0 (CPython: PSF licence) | cdn.jsdelivr.net, when Python first starts |
| NumPy, Pillow and jsonschema (with attrs, referencing, rpds-py and jsonschema-specifications), as Pyodide builds them | 2.2.5, 11.3.0, 4.23.0 | NumPy: BSD 3-clause; Pillow: MIT-CMU; jsonschema and its helpers: MIT | cdn.jsdelivr.net, when Python starts |
| matplotlib, as Pyodide builds it | 3.8.4 | the matplotlib licence (PSF-based) | cdn.jsdelivr.net, in the background once Python has started, for plots in notebooks |
| The GRCh38 reference as gpxil files, and the Gpxil browser's gene files (Ensembl release 116) | GRCh38, Ensembl 116 | Ensembl's data are freely available without restriction; the reference is the Genome Reference Consortium's | the [Gpxil browser](https://comparativechrono.github.io/Gpxil-browser/), a piece at a time, when they are read |

## Example data

| File | What it is | Source |
|---|---|---|
| `worked-example.fa`, `.vcf`, `.gpxil.tif` | the gpxil specification's worked example: ten made-up bases and four variants | [comparativechrono/Gpxil-tools](https://github.com/comparativechrono/Gpxil-tools) `tests/data` (MIT) |
| `HG002_chr17.gpxil.tif` | chromosome 17 of HG002, encoded on 28 October 2026 with gpxiltools 0.6.0 (gpxil 0.2) from the Genome in a Bottle benchmark v4.2.1 (GRCh38), with its callable regions (`…_noinconsistent.bed`), on GRCh38 from Ensembl 116 | Genome in a Bottle Consortium, NIST: `HG002_GRCh38_1_22_v4.2.1_benchmark.vcf.gz` and `.bed`, released for public use; cite Zook et al. 2016 and Wagner et al. 2022 (see the help: Versions, and how to cite) |
| `HG002_TP53.vcf`, `HG002_TP53.bed` | the same benchmark's records and callable regions in chr17:7,600,001-7,750,000, around TP53 (206 records, 52 intervals), with the VCF's header | the same |
| `HG003_chr17.noref.gpxil.tif`, `HG004_chr17.noref.gpxil.tif` | chromosome 17 of HG003 and HG004, HG002's father and mother, encoded on 28 October 2026 with gpxiltools 0.6.0 (gpxil 0.2) from their Genome in a Bottle benchmarks v4.2.1 (GRCh38), with their callable regions (`…_noinconsistent.bed`), on GRCh38 from Ensembl 116, then copied without the reference plane (`gpxil subset --no-ref`) | Genome in a Bottle Consortium, NIST: `HG003_GRCh38_1_22_v4.2.1_benchmark.vcf.gz` and `HG004_GRCh38_1_22_v4.2.1_benchmark.vcf.gz`, with their `.bed` files, released for public use; cite Zook et al. 2016 and Wagner et al. 2022 |
| `HG002_chr17_v5.0q.noref.gpxil.tif` | chromosome 17 of HG002 from the newer Genome in a Bottle benchmark, v5.0q (GRCh38, small variants), made from the T2T HG002 Q100 assembly of his genome, with its benchmark regions, encoded on 28 October 2026 with gpxiltools 0.6.0 (gpxil 0.2) without the reference plane (`--no-ref`), on GRCh38 from Ensembl 116 | Genome in a Bottle Consortium, NIST: `HG002_GRCh38_v5.0q_smvar.vcf.gz` and `HG002_GRCh38_v5.0q_smvar.benchmark.bed`, released for public use; cite Hansen et al. 2026 (Cell 189: 4857–4875) |
| `TP53.gtf` | TP53's 951 lines of Ensembl's GTF, release 116 | [Ensembl](https://www.ensembl.org), `Homo_sapiens.GRCh38.116.gtf.gz`; Ensembl's data are freely available without restriction |
| `workflows/*.workflow.json` | the example workflows | made by `build/make_example_workflows.js` |
