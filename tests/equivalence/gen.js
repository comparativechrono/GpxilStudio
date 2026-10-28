// The Tools tab's tools (assets/js/tools.js), each with sample values: print the command each runs and its Python, as
// JSON lines, for run_equiv.py. tools.js is loaded with a small stand-in for the page.
//
//   node tests/equivalence/gen.js assets/js/tools.js > cases.jsonl
//
// The cases that read the GRCh38 reference (/data/grch38) are printed too; run_equiv.py runs them only when
// STUDIO_REFERENCE names a copy of it.
const path = require('path');
const HOME = '/home/user';
const MG = {
  h: () => ({}), esc: (s) => s, toast() {}, store: { get: (k, d) => d, set() {} }, bus: { on() {}, emit() {} },
  path: { dirname: (p) => p.replace(/\/[^/]*$/, '') || '/' },
  icon: () => '', kernels: {}, config: {},
  app: {
    HOME,
    kindNames: {},
    // (as page-wb.js tells kinds of file apart)
    fileKind: (p) => (/\.gpxil(\.tiff?)?$/i.test(p) ? 'gpxil' : /\.pxil(\.png)?$/i.test(p) ? 'pxil' : /\.(fa|fasta|fna)(\.b?gz)?$/i.test(p) ? 'fasta' : /\.vcf(\.b?gz)?$/i.test(p) ? 'vcf' : /\.bed(\.gz)?$/i.test(p) ? 'bed' : /\.(gtf|gff3?)(\.gz)?$/i.test(p) ? 'gtf' : /\.(png|tiff?)$/i.test(p) ? 'image' : /\.pdf$/i.test(p) ? 'pdf' : 'other')
  }
};
global.window = { MG, matchMedia: () => ({ matches: false }) };
require(path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'assets', 'js', 'tools.js')));
const TOOLS = Object.fromEntries(MG.gpxilTools.map((t) => [t.id, t]));
const EX = '/data/examples/';
const R = HOME + '/results/';
const HG = EX + 'HG002_chr17.gpxil.tif';
const TP53 = 'chr17:7661779-7687546';
const V5 = EX + 'HG002_chr17_v5.0q.noref.gpxil.tif';
const HG3 = EX + 'HG003_chr17.noref.gpxil.tif';
const HG4 = EX + 'HG004_chr17.noref.gpxil.tif';
// [tool, values, {fails: the command and the Python must both stop with an error; same: they print the same}]
const CASES = [
  ['info', { input: HG }],
  ['info', { input: EX + 'worked-example.gpxil.tif', json: true }, { same: true }],
  ['validate', { input: EX + 'worked-example.gpxil.tif' }],
  ['validate', { input: HG, digests: false }],
  ['palettes', {}],
  ['encode', { reference: EX + 'worked-example.fa', vcf: EX + 'worked-example.vcf', width: '4' }],
  ['encode', { reference: EX + 'worked-example.fa', vcf: EX + 'worked-example.vcf', width: '4', planes: '', noRef: true, palette: 'gpxi', compression: 'none', refName: 'worked example', out: '~/genomes/we-noref.gpxil.tif' }],
  ['encode', { reference: EX + 'worked-example.fa', out: '~/genomes/we-ref-only.gpxil.tif' }],
  ['render', { input: HG, region: TP53, mode: 'variants', width: '256', scale: '2' }],
  ['render', { input: HG, region: TP53, mode: 'haplotypes', width: '300', format: 'cmyk', dpi: '300', mark: true }],
  ['render', { input: HG, region: TP53, mode: 'genotype', palette: 'okabe-ito', layout: 'hilbert', format: 'tiff' }],
  ['render', { input: EX + 'worked-example.gpxil.tif', region: 'chrT', mode: 'reference', scale: '8', palette: 'process' }],
  ['book', { input: HG, contigs: 'chr17', mode: 'genotype', maxPages: '1', rgb: 'rgb', page: 'A5', dpi: '150', title: 'HG002, chromosome 17' }],
  ['fasta', { input: HG, which: '1', region: TP53 }],
  ['fasta', { input: HG, which: 'iupac', region: 'chr17:7676101-7676200' }],
  ['fasta', { input: EX + 'worked-example.gpxil.tif', which: 'ref', region: '' }],
  ['fasta', { input: EX + 'worked-example.gpxil.tif', which: '2', region: 'chrT' }],
  ['vcf', { input: HG, region: TP53, nocall: false }],
  ['vcf', { input: HG, region: 'chr17:7661779-7670000 chr17:7676000-7677000' }],
  ['vcf', { input: EX + 'worked-example.gpxil.tif', region: '' }],
  ['stats', { input: HG }],
  ['stats', { input: HG, regions: 'chr17:7661779-7670000 chr17:7,676,000-7,677,000' }],
  ['stats', { input: EX + 'worked-example.gpxil.tif', regions: '' }],
  ['subset', { input: HG, noRef: true }],
  ['subset', { input: HG, contigs: '17', planes: 'ref,gt,flags', compression: 'deflate', out: '~/genomes/hg002-three-planes.gpxil.tif' }],
  ['subset', { input: EX + 'worked-example.gpxil.tif', planes: 'ref', compression: 'none', out: '~/genomes/we-reference.gpxil.tif' }],
  // two benchmarks of HG002, the second without its reference plane: TP53, drawn; and two regions, with the calls
  // outside the confident regions and a smaller gap, without a picture
  ['compare', { a: HG, b: V5, regions: TP53, draw: TP53 }],
  ['compare', { a: HG, b: V5, regions: 'chr17:7661779-7670000 chr17:72,800,001-72,820,000', allCalls: true, gap: '10' }],
  // HG002 and his parents, who are without their reference planes, around the first Mendelian error, drawn as a TIFF
  ['trio', { child: HG, father: HG3, mother: HG4, regions: 'chr17:4,000,001-4,100,000', draw: 'chr17:4,047,904-4,047,964', scale: '8', out: '~/results/trio-error.tif' }],
  // all three without (HG002's working copy, made above), with GRCh38's chromosome 17 as their reference
  ['trio', { child: HOME + '/genomes/HG002_chr17.noref.gpxil.tif', father: HG3, mother: HG4, regions: 'chr17:58,300,001-58,400,000', draw: 'chr17:58,332,201-58,332,300', reference: '/data/grch38/chr17.gpxil.tif' }],
  // the VCF of TP53 encoded again, with the gpxil file itself as the reference
  ['encode', { reference: HG, vcf: R + 'HG002_chr17_chr17_7661779-7687546.vcf', contigs: 'chr17', out: '~/genomes/round-trip.gpxil.tif' }],
  // on GRCh38 from /data/grch38, without the reference plane; and drawn with the reference given
  ['encode', { reference: '/data/grch38/chr17.gpxil.tif', vcf: EX + 'HG002_TP53.vcf', callable: EX + 'HG002_TP53.bed', noRef: true }],
  ['render', { input: HOME + '/genomes/HG002_TP53.noref.gpxil.tif', region: TP53, mode: 'variants', width: '256', reference: '/data/grch38/chr17.gpxil.tif' }],
  ['gpxil2pxil', { input: HG, genes: 'TP53', annotation: EX + 'TP53.gtf', kinds: 'protein', haplotypes: 'all' }],
  ['gpxil2pxil', { input: HG, genes: 'TP53', annotation: EX + 'TP53.gtf', transcripts: 'mane', kinds: 'transcript,protein', haplotypes: '1', width: '64', outdir: '~/results/pxil/TP53-mane' }],
  ['gpxil2pxil', { input: HG, genes: 'TP53', annotation: EX + 'TP53.gtf', list: true }],
  ['gpxil2pxil', { input: '/data/grch38/chr17.gpxil.tif', genes: 'BRCA1', kinds: 'protein' }],
  ['pxil-fasta', { input: [R + 'pxil/TP53/TP53-201_ENSP00000269305.protein.pxil.png', R + 'pxil/TP53/TP53-201_ENSP00000269305_HG002-hap1.protein.pxil.png'] }],
  ['pxil-fasta', { input: [R + 'pxil/TP53/TP53-201_ENSP00000269305.protein.pxil.png'], info: true }],
  // a gene that isn't there: both stop
  ['gpxil2pxil', { input: HG, genes: 'NOSUCHGENE', annotation: EX + 'TP53.gtf' }, { fails: true }]
];
const expand = (p) => String(p).replace(/^~(?=\/|$)/, HOME);
for (const [id, given, how = {}] of CASES) {
  const t = TOOLS[id];
  const v = {};
  for (const f of t.fields) v[f.key] = given[f.key] != null ? given[f.key] : f.type === 'files' ? [] : f.type === 'file' ? '' : typeof f.def === 'function' ? undefined : f.def;
  for (const f of t.fields) if (v[f.key] === undefined) v[f.key] = f.def(v);
  for (const f of t.fields) {
    if (f.show && !f.show(v) && given[f.key] == null) v[f.key] = f.type === 'check' ? false : f.type === 'files' ? [] : '';
    if ((f.type === 'file' || f.type === 'folder' || f.type === 'path') && v[f.key]) v[f.key] = expand(v[f.key]);
    if (f.type === 'files') v[f.key] = v[f.key].map(expand);
  }
  let argv = t.argv(v);
  if (!Array.isArray(argv[0])) argv = [argv];
  // (the form's check must pass, as it does before the tool can run)
  const problem = t.check ? t.check(v) : '';
  if (problem && !how.fails) throw new Error(`${id}: the form would refuse ${JSON.stringify(given)}: ${problem}`);
  const reads = JSON.stringify(given);
  console.log(JSON.stringify({ id, argv, python: t.python ? t.python(v) : '', outputs: t.outputs ? t.outputs(v) : t.fields.filter((f) => f.type === 'folder').map((f) => v[f.key] + '/x'), fails: !!how.fails, same: !!how.same, reference: reads.includes('/data/grch38') }));
}
