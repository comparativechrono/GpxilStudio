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

make('family.workflow.json', 'A family: two benchmarks, and a son with both parents',
  'HG002’s chromosome 17 in Genome in a Bottle’s two benchmarks, version 4.2.1 and version 5.0q, compared base by base, the newer taken as the truth: what is the same, what is only written differently, and what differs. Then HG002 is checked against his father and mother, HG003 and HG004: the Mendelian errors, the candidate new mutations, and where each of his variants came from. Both draw TP53.',
  (w) => {
    const son = E.addInput(w, ['gpxil'], 'The son, HG002');
    son.default = EX + 'HG002_chr17.gpxil.tif';
    const truth = E.addInput(w, ['gpxil'], 'The son, in the newer benchmark (the truth)');
    truth.default = EX + 'HG002_chr17_v5.0q.noref.gpxil.tif';
    const father = E.addInput(w, ['gpxil'], 'The father, HG003');
    father.default = EX + 'HG003_chr17.noref.gpxil.tif';
    const mother = E.addInput(w, ['gpxil'], 'The mother, HG004');
    mother.default = EX + 'HG004_chr17.noref.gpxil.tif';
    const pair = E.addTool(w, 'compare');
    pair.params = { draw: TP53, width: '256', scale: '2' };
    join(w, son, 'file', pair, 'a');
    join(w, truth, 'file', pair, 'b');
    const trio = E.addTool(w, 'trio');
    trio.params = { draw: TP53, width: '256', scale: '2' };
    join(w, son, 'file', trio, 'child');
    join(w, father, 'file', trio, 'father');
    join(w, mother, 'file', trio, 'mother');
  });

make('ga-sequences.workflow.json', 'Pure GA-sequences: found, stacked and counted',
  'Albrecht-Buehler’s pure GA-sequences – runs of more than 50 bases of nothing but A and G, on either strand – are found on HG002’s chromosome 17 and stacked, one a row with the 400 bases before each, sorted by the poly(A) each starts with: the stripes before the top rows are Alu elements, whose tails they began as. HG002’s substitutions in them are counted against what their contexts predict, leaving out those with another variant within 20 bases, with their insertions and deletions. And the genome is given RepeatMasker’s repeats as a plane of its own, to look at in the Viewer.',
  (w) => {
    const g = E.addInput(w, ['gpxil'], 'The genome, with its reference plane');
    g.default = EX + 'HG002_chr17.gpxil.tif';
    const rm = E.addInput(w, ['rmsk'], 'Its repeats (a RepeatMasker table)');
    rm.default = EX + 'rmsk_chr17.txt.gz';
    const runs = E.addTool(w, 'runs');
    join(w, g, 'file', runs, 'input');
    const st = E.addTool(w, 'stack');
    st.params = { sort: 'run' };
    join(w, g, 'file', st, 'input');
    join(w, runs, 'runs', st, 'features');
    const sp = E.addTool(w, 'spectrum');
    sp.params = { isolated: '20', centre: 'purine' };
    join(w, g, 'file', sp, 'input');
    join(w, runs, 'runs', sp, 'features');
    const an = E.addTool(w, 'annotate');
    join(w, g, 'file', an, 'input');
    join(w, rm, 'file', an, 'features');
  });
