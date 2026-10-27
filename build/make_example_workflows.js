/* The example workflows (data/examples/workflows/*.workflow.json), made with the workflow engine itself, so that each
   connection is one it allows, and the boxes are laid out as Tidy lays them out.

     node build/make_example_workflows.js
*/
const fs = require('fs');
const path = require('path');
const { load, MemFS, ROOT } = require('../tests/workflows/env.js');
const MG = load(new MemFS());
const E = MG.workflowEngine;
const EX = '/data/examples/';
const OUT = path.join(ROOT, 'data', 'examples', 'workflows');

function make(file, name, annotation, build) {
  const w = E.newWorkflow(name);
  w.annotation = annotation;
  build(w);
  E.autoLayout(w);
  w.created = w.updated = '2026-10-20T12:00:00.000Z';
  const probs = E.problems(w);
  if (probs.length) throw new Error(`${file}: ${probs.map((p) => p.text).join('; ')}`);
  fs.writeFileSync(path.join(OUT, file), E.serialise(w));
  console.log(`data/examples/workflows/${file}: ${w.steps.length} steps`);
}
const join = (w, a, out, b, key) => {
  const why = E.connect(w, a.id, out, b.id, key);
  if (why) throw new Error(why);
};

const TP53 = 'chr17:7661779-7687546';

make('vcf-to-gpxil.workflow.json', 'From a VCF to a gpxil file, checked and drawn',
  'A person’s variants around TP53 (Genome in a Bottle’s HG002) are encoded on chromosome 17 of GRCh38, read from the Gpxil browser, with the regions called with confidence. The new file is checked against the specification, TP53 is drawn by zygosity, and pictures are made of the person’s two versions of TP53’s protein.',
  (w) => {
    const vcf = E.addInput(w, ['vcf'], 'The person’s variants (VCF)');
    vcf.default = EX + 'HG002_TP53.vcf';
    const bed = E.addInput(w, ['bed'], 'Regions called with confidence (BED)');
    bed.default = EX + 'HG002_TP53.bed';
    bed.optional = true;
    const ref = E.addInput(w, ['fasta', 'gpxil'], 'The reference');
    ref.default = '/data/grch38/chr17.gpxil.tif';
    const gtf = E.addInput(w, ['gtf'], 'Genes (GTF)');
    gtf.default = EX + 'TP53.gtf';
    gtf.optional = true;
    const enc = E.addTool(w, 'encode');
    join(w, ref, 'file', enc, 'reference');
    join(w, vcf, 'file', enc, 'vcf');
    join(w, bed, 'file', enc, 'callable');
    const check = E.addTool(w, 'validate');
    check.params = { digests: false };
    join(w, enc, 'gpxil', check, 'input');
    const draw = E.addTool(w, 'render');
    draw.params = { region: TP53, mode: 'variants', width: '256', scale: '2' };
    join(w, enc, 'gpxil', draw, 'input');
    const genes = E.addTool(w, 'gpxil2pxil');
    genes.params = { genes: 'TP53', kinds: 'protein' };
    join(w, enc, 'gpxil', genes, 'input');
    join(w, gtf, 'file', genes, 'annotation');
  });

make('gene-pictures.workflow.json', 'A person’s own TP53: pictures and sequences',
  'The TP53 gene, its canonical transcript and protein are made from both of HG002’s haplotypes as pxil pictures, and their sequences written out as FASTA. Each protein’s picture says how it differs from the reference’s (P72R).',
  (w) => {
    const g = E.addInput(w, ['gpxil'], 'The gpxil file');
    g.default = EX + 'HG002_chr17.gpxil.tif';
    const gtf = E.addInput(w, ['gtf'], 'Genes (GTF)');
    gtf.default = EX + 'TP53.gtf';
    gtf.optional = true;
    const genes = E.addTool(w, 'gpxil2pxil');
    genes.params = { genes: 'TP53', haplotypes: 'all' };
    join(w, g, 'file', genes, 'input');
    join(w, gtf, 'file', genes, 'annotation');
    const fa = E.addTool(w, 'pxil-fasta');
    join(w, genes, 'pxil', fa, 'input');
  });

make('round-trip.workflow.json', 'Back to FASTA and VCF, and round again',
  'TP53’s two haplotypes are written as FASTA, and its variants as VCF. The VCF is then encoded again, with the gpxil file itself as the reference, and the new file checked: the same variants make the same planes.',
  (w) => {
    const g = E.addInput(w, ['gpxil'], 'The gpxil file');
    g.default = EX + 'HG002_chr17.gpxil.tif';
    const h1 = E.addTool(w, 'fasta');
    h1.params = { which: '1', region: TP53 };
    join(w, g, 'file', h1, 'input');
    const h2 = E.addTool(w, 'fasta');
    h2.params = { which: '2', region: TP53 };
    join(w, g, 'file', h2, 'input');
    const v = E.addTool(w, 'vcf');
    v.params = { region: TP53, nocall: false };
    join(w, g, 'file', v, 'input');
    const enc = E.addTool(w, 'encode');
    enc.params = { contigs: 'chr17' };
    join(w, g, 'file', enc, 'reference');
    join(w, v, 'vcf', enc, 'vcf');
    const check = E.addTool(w, 'validate');
    check.params = { digests: false };
    join(w, enc, 'gpxil', check, 'input');
  });

make('pictures-and-print.workflow.json', 'Pictures of a gene, and a proof to print',
  'TP53 is drawn three ways – the reference, the two haplotypes, and the variants on a Hilbert curve – and the first two pages of chromosome 17 are made into a PDF to print, in CMYK.',
  (w) => {
    const g = E.addInput(w, ['gpxil'], 'The gpxil file');
    g.default = EX + 'HG002_chr17.gpxil.tif';
    const a = E.addTool(w, 'render');
    a.params = { region: TP53, mode: 'reference', width: '256', scale: '2' };
    join(w, g, 'file', a, 'input');
    const b = E.addTool(w, 'render');
    b.params = { region: TP53, mode: 'haplotypes', width: '256', scale: '2' };
    join(w, g, 'file', b, 'input');
    const c = E.addTool(w, 'render');
    c.params = { region: TP53, mode: 'variants', layout: 'hilbert', scale: '2' };
    join(w, g, 'file', c, 'input');
    const book = E.addTool(w, 'book');
    // (the cover, the page on how to read it and chromosome 17's title page, then two pages of bases)
    book.params = { contigs: 'chr17', mode: 'genotype', maxPages: '5' };
    join(w, g, 'file', book, 'input');
  });
