/* The workflow engine (assets/js/workflows.js) in Node: the example workflows have no problems; files connect only to
   inputs of their kinds, and never in a loop; where a run's files go; a run, step by step, with a stand-in for Python;
   its commands and notebook; a workflow made from the tools that were run; and then each example workflow run for
   real, its steps' commands run by the studio's Python packages (python/), as the Tools tab runs them.

     node tests/workflows/engine.js            (--quick: without the real runs)

   The example that encodes a VCF on GRCh38 reads /data/grch38/chr17.gpxil.tif: it runs for real only when
   $STUDIO_REFERENCE names a copy of the Gpxil browser's data/grch38 folder.
*/
const fs = require('fs');
const path = require('path');
const { load, MemFS, DiskFS, ROOT, HOME } = require('./env.js');

const out = [];
const check = (ok, what) => out.push((ok ? 'ok    ' : 'FAIL  ') + what);
const EXDIR = path.join(ROOT, 'data', 'examples', 'workflows');
const examples = fs.readdirSync(EXDIR).filter((f) => f.endsWith('.workflow.json')).sort();
const EX = '/data/examples/';
const TP53 = 'chr17:7661779-7687546';

async function units() {
  const files = new MemFS();
  const MG = load(files);
  const E = MG.workflowEngine;
  const K = MG.toolsKit;

  // every tool but the palettes (which reads and writes nothing) can be a step, and says what it writes with its defaults
  const usable = K.TOOLS.filter(E.usable).map((t) => t.id);
  check(usable.length === K.TOOLS.length - 1 && !usable.includes('palettes'), `every tool but the palettes can be a step (${usable.join(', ')})`);
  let quiet = true;
  for (const t of K.TOOLS.filter(E.usable)) {
    const w = E.newWorkflow('t');
    const s = E.addTool(w, t.id);
    try {
      E.stepOutputs(w, s);
      E.stepInputs(w, s);
    } catch (e) {
      quiet = false;
      check(false, `${t.id}: ${e.message}`);
    }
  }
  check(quiet, 'every tool says what it reads and writes, as a step with its defaults');

  // the examples: no problems, and they read back as they were written
  for (const f of examples) {
    const w = E.parse(fs.readFileSync(path.join(EXDIR, f), 'utf8'));
    const probs = E.problems(w);
    check(!probs.length && E.serialise(w) === fs.readFileSync(path.join(EXDIR, f), 'utf8'), `${f}: no problems (${probs.map((p) => p.text).join('; ')})`);
  }

  // connections: kinds, sets of files, loops
  const w = E.newWorkflow('Test of connections');
  const vcfIn = E.addInput(w, ['vcf'], 'The VCF');
  const refIn = E.addInput(w, ['fasta', 'gpxil'], 'The reference');
  const gIn = E.addInput(w, ['gpxil'], 'A gpxil file');
  const enc = E.addTool(w, 'encode');
  check(E.connect(w, vcfIn.id, 'file', enc.id, 'vcf') === '' && E.connect(w, refIn.id, 'file', enc.id, 'reference') === '', 'a VCF and a reference connect to Make a gpxil file');
  check(/reads a VCF file/.test(E.connect(w, gIn.id, 'file', enc.id, 'vcf')), `a gpxil file doesn’t connect to its VCF, and it says why (${E.connect(w, gIn.id, 'file', enc.id, 'vcf')})`);
  const genes = E.addTool(w, 'gpxil2pxil');
  check(E.connect(w, enc.id, 'gpxil', genes.id, 'input') === '', 'the gpxil file it writes connects to the pictures of genes');
  const draw = E.addTool(w, 'render');
  check(/reads a gpxil file/.test(E.connect(w, genes.id, 'pxil', draw.id, 'input')), 'pxil pictures don’t connect to Draw a region');
  const fa = E.addTool(w, 'pxil-fasta');
  check(E.connect(w, genes.id, 'pxil', fa.id, 'input') === '', '… but the set of them does to pxil → FASTA, which reads several');
  check(JSON.stringify(E.stepOutputs(w, genes)[0]) === JSON.stringify({ name: 'pxil', label: 'pxil files', many: true, kinds: ['pxil'] }), 'gpxil2pxil writes a set of pxil files');
  const back = E.addTool(w, 'vcf');
  E.connect(w, enc.id, 'gpxil', back.id, 'input');
  check(/loop/.test(E.connect(w, back.id, 'vcf', enc.id, 'vcf')), 'a loop is refused');
  const order = E.orderSteps(w).map((s) => s.id);
  check(order.indexOf(enc.id) < order.indexOf(genes.id) && order.indexOf(genes.id) < order.indexOf(fa.id) && order.indexOf(enc.id) < order.indexOf(back.id), 'the steps run in order, each after the steps it reads from');
  check(E.problems(w).some((p) => p.step === gIn.id && /no step reads it/.test(p.text)), 'an input that no step reads is a problem');
  check(E.problems(w).some((p) => p.step === draw.id && /isn’t connected/.test(p.text)), 'an input of a step that isn’t connected is a problem');
  E.removeStep(w, genes.id);
  check(!E.allConns(fa).length, 'removing a step takes away its connections');

  // settings: a choice changes what a step writes; the settings kept are those that aren't defaults
  {
    const w2 = E.newWorkflow('Settings');
    const g = E.addInput(w2, ['gpxil'], 'The gpxil file');
    const r = E.addTool(w2, 'render');
    E.connect(w2, g.id, 'file', r.id, 'input');
    const kinds = () => E.stepOutputs(w2, r).map((o) => o.kinds.join('')).join(',');
    check(kinds() === 'image', 'Draw a region writes a picture');
    const s2 = E.addTool(w2, 'gpxil2pxil');
    E.connect(w2, g.id, 'file', s2.id, 'input');
    check(E.stepOutputs(w2, s2).length === 1, 'gpxil2pxil writes pictures …');
    s2.params.list = true;
    check(E.stepOutputs(w2, s2).length === 0, '… and, set to list the transcripts, nothing');
    const R = K.TOOL.render;
    const v = E.valuesOf(R, { region: TP53, mode: 'haplotypes', format: 'cmyk' }, { input: EX + 'HG002_chr17.gpxil.tif' }, null);
    check(/\.tif$/.test(v.out) && R.argv(v).includes('--cmyk') && !R.argv(v).includes('--layout'), `a setting changes the command and the file (${v.out})`);
    check(JSON.stringify(E.paramsFrom(R, E.valuesOf(R, { region: TP53, mode: 'variants' }, { input: EX + 'HG002_chr17.gpxil.tif' }, null))) === JSON.stringify({ region: TP53, mode: 'variants' }), 'the settings of a tool run are those that aren’t defaults');
    check(!E.fromInputName(R, R.fields.find((f) => f.key === 'region')), 'a region comes from the file’s contigs, not its name');
  }

  // a run, with a stand-in for Python that writes what each tool says it writes
  for (const p of ['HG002_chr17.gpxil.tif', 'TP53.gtf']) files.writeText(EX + p, 'stand-in');
  const pics = E.parse(fs.readFileSync(path.join(EXDIR, 'gene-pictures.workflow.json'), 'utf8'));
  const ins = Object.fromEntries(pics.steps.filter((s) => s.type === 'input').map((s) => [s.id, s.default]));
  const folder = E.runFolder(files, pics, ins);
  check(folder === HOME + '/results/a-person-s-own-tp53-pictures-and-sequences/hg002-chr17', `a run’s folder is named after the workflow and its input (${folder})`);
  const ran = [];
  const fake = async (t, v) => {
    ran.push(t.id);
    const written = [];
    for (const o of E.outputsOf(t, v)) {
      const ps = o.path ? [o.path] : ['TP53_ENSG00000141510.gene', 'TP53-201_ENST00000269305.transcript', 'TP53-201_ENSP00000269305.protein'].map((n) => (v.outdir || folder) + '/' + n + '.pxil.png');
      ps.forEach((p) => files.writeText(p, 'made by ' + t.id));
      written.push(...ps);
    }
    return { ok: true, code: 0, stdout: t.id === 'gpxil2pxil' ? 'wrote …\n3 pxil files\n' : '', stderr: '', files: written, result: t.id === 'validate' ? { valid: true, errors: [], warnings: [], checked: ['chr17'], findings: [] } : undefined };
  };
  const rec = await new E.Run({ w: pics, source: EX + 'workflows/gene-pictures.workflow.json', inputs: ins, folder, fs: files, run: fake }).start();
  check(rec.state === 'ok' && rec.steps.every((e) => e.state === 'ok'), `the run finishes, every step done (${rec.steps.map((e) => e.state + (e.error ? ': ' + e.error : '')).join(', ')})`);
  check(ran.join(',') === 'gpxil2pxil,pxil-fasta', `its steps run in order (${ran.join(', ')})`);
  const [g2p, toFa] = rec.steps;
  check(g2p.values.outdir === folder + '/TP53' && g2p.values.annotation === EX + 'TP53.gtf' && g2p.values.haplotypes === 'all', `gpxil2pxil writes into a folder of the run’s, with the genes of the GTF (${g2p.values.outdir})`);
  check(Array.isArray(toFa.values.input) && toFa.values.input.length === 3 && toFa.values.out === folder + '/pxil-sequences.fa', `pxil → FASTA reads the set of pictures, and writes one FASTA file (${toFa.values.out})`);
  check(g2p.summary === '3 pxil files', `a step says what it did (${g2p.summary})`);
  const saved = JSON.parse(await files.readText(folder + '/workflow-run.json'));
  check(saved.gpxilstudio_workflow_run === 1 && saved.state === 'ok' && saved.steps.length === 2 && saved.workflow.name === pics.name, 'the record of the run is in its folder');
  const script = await files.readText(folder + '/commands.sh');
  check(/^#!\/bin\/bash/.test(script) && /\ngpxil2pxil \/data\/examples\/HG002_chr17\.gpxil\.tif TP53 --haplotypes all -a \/data\/examples\/TP53\.gtf -o ~\/results\/a-person-s-own-tp53-pictures-and-sequences\/hg002-chr17\/TP53\n/.test(script) && /\npxil (~\/results\/\S+\.pxil\.png ){3}-o ~\/results\/\S+\/pxil-sequences\.fa\n/.test(script), 'its commands are in commands.sh, for the terminal');
  const nb = E.notebookOf(saved);
  check(nb.cells.filter((c) => c.cell_type === 'code').length >= 2 && nb.cells.some((c) => /from gpxil2pxil import GTF, make/.test(c.source.join(''))) && nb.cells.some((c) => /import pxil/.test(c.source.join(''))), 'and its steps make a notebook of Python');

  // the same again: a folder of its own; a step whose file has the name of one before it: a folder of its own
  check(E.runFolder(files, pics, ins) === folder + '-2', 'the next run of it has a folder of its own');
  {
    const twice = E.newWorkflow('Twice');
    const g = E.addInput(twice, ['gpxil'], 'The gpxil file');
    const a = E.addTool(twice, 'fasta');
    const b = E.addTool(twice, 'fasta');
    a.params = b.params = { which: '1', region: TP53 };
    E.connect(twice, g.id, 'file', a.id, 'input');
    E.connect(twice, g.id, 'file', b.id, 'input');
    const rec2 = await new E.Run({ w: twice, inputs: { [g.id]: EX + 'HG002_chr17.gpxil.tif' }, folder: HOME + '/results/twice', fs: files, run: fake }).start();
    check(rec2.steps[0].values.out === HOME + '/results/twice/HG002_chr17_chr17_7661779-7687546_hap1.fa' && rec2.steps[1].values.out === HOME + '/results/twice/3-sequences-as-fasta/HG002_chr17_chr17_7661779-7687546_hap1.fa', `a step that would write a file of the same name as one before it writes into a folder of its own (${rec2.steps[1].values.out})`);
  }

  // a step that fails, and the steps after it; an input missing; stopping
  const failing = async (t, v) => (t.id === 'gpxil2pxil' ? { ok: false, code: 1, stdout: '', stderr: 'gpxil2pxil: error: no gene', files: [] } : fake(t, v));
  const rec3 = await new E.Run({ w: pics, inputs: ins, folder: HOME + '/results/broken', fs: files, run: failing }).start();
  check(rec3.state === 'failed' && rec3.steps[0].state === 'failed' && rec3.steps.slice(1).every((e) => e.state === 'skipped'), 'when a step fails, the steps that read its files don’t run');
  const rec4 = await new E.Run({ w: pics, inputs: { s1: EX + 'nothing.gpxil.tif', s2: EX + 'TP53.gtf' }, folder: HOME + '/results/missing', fs: files, run: fake }).start();
  check(rec4.steps[0].state === 'failed' && /isn’t there/.test(rec4.steps[0].error), `an input file that isn’t there is said (${rec4.steps[0].error})`);
  let r5;
  const slow = async (t, v) => {
    r5.stop();
    return fake(t, v);
  };
  r5 = new E.Run({ w: pics, inputs: ins, folder: HOME + '/results/stopped', fs: files, run: slow });
  const rec5 = await r5.start();
  check(rec5.state === 'stopped' && rec5.steps[0].state === 'ok' && rec5.steps.slice(1).every((e) => e.state === 'stopped'), 'a run that is stopped stops after the step it is on');

  // a workflow made from tools that were run, one reading what the one before it wrote
  {
    files.writeText(EX + 'HG002_TP53.vcf', 'stand-in');
    files.writeText(EX + 'HG002_TP53.bed', 'stand-in');
    const encV = E.valuesOf(K.TOOL.encode, { planes: 'gt,flags' }, { reference: '/data/grch38/chr17.gpxil.tif', vcf: EX + 'HG002_TP53.vcf', callable: EX + 'HG002_TP53.bed' }, null);
    const log = [
      { tool: 'encode', values: encV, files: [encV.out], ok: true, time: 1 },
      { tool: 'validate', values: E.valuesOf(K.TOOL.validate, { digests: false }, { input: encV.out }, null), files: [], ok: true, time: 2 },
      { tool: 'render', values: E.valuesOf(K.TOOL.render, { region: TP53, mode: 'variants' }, { input: encV.out }, null), files: [HOME + '/results/x.png'], ok: true, time: 3 }
    ];
    const made = E.fromRuns(log, 'From what I ran');
    const steps = E.orderSteps(made);
    const inputs = steps.filter((s) => s.type === 'input');
    const tools = steps.filter((s) => s.type === 'tool');
    check(inputs.length === 3 && inputs.some((s) => s.default === '/data/grch38/chr17.gpxil.tif') && inputs.find((s) => s.default === EX + 'HG002_TP53.bed').optional, 'a workflow made from tools run has their files as its inputs (the BED file optional)');
    check(tools.map((s) => s.tool).join(',') === 'encode,validate,render' && JSON.stringify(tools[1].params) === '{"digests":false}', 'the steps keep the settings that weren’t defaults');
    check(E.connsOf(tools[1], 'input')[0].step === tools[0].id && E.connsOf(tools[2], 'input')[0].output === 'gpxil', 'a file one wrote and the next read is a connection');
    check(!E.problems(made).length, `and it has no problems (${E.problems(made).map((p) => p.text).join('; ')})`);
  }

  // only the files a step wrote this time are its files
  files.writeText(HOME + '/results/stale.fa', '>x');
  const outs = [{ name: 'out', label: 'file', path: HOME + '/results/stale.fa' }];
  check(E.collect(outs, [], files).lost.length === 1 && E.collect(outs, [HOME + '/results/stale.fa'], files).got.out, 'a file there from an earlier run is no file of the step’s');

  // a run ends, whatever goes wrong: its folder is a file
  files.writeText(HOME + '/results/a-file', 'x');
  const r = await new E.Run({ w: pics, inputs: ins, folder: HOME + '/results/a-file', fs: files, run: fake }).start();
  check(r.state === 'failed' && r.steps[0].state === 'failed' && /couldn’t be made/.test(r.steps[0].error) && r.steps.slice(1).every((e) => e.state === 'skipped'), 'a run whose folder is a file ends, failed, and says why');

  // commands.sh: a name stays in its comment, and a file written first ends where it should
  {
    const { spawnSync } = require('child_process');
    const os = require('os');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-sh-'));
    const rec = {
      name: 'Mine\ntouch MADE-BY-THE-NAME',
      started: new Date().toISOString(),
      folder: HOME + '/results/x',
      steps: [{ n: 1, tool: 'fasta', title: 'Sequences as FASTA', state: 'ok', values: {}, argv: [['true']], prepared: [{ path: HOME + '/results/x/regions.txt', text: 'chr17\nEOF\ntouch MADE-BY-THE-TEXT\n' }] }]
    };
    fs.writeFileSync(path.join(tmp, 'commands.sh'), E.scriptOf(rec));
    const res = spawnSync('bash', ['commands.sh'], { cwd: tmp, env: { HOME: tmp, PATH: '/usr/bin:/bin' }, encoding: 'utf8' });
    const text = fs.existsSync(path.join(tmp, 'results/x/regions.txt')) ? fs.readFileSync(path.join(tmp, 'results/x/regions.txt'), 'utf8') : null;
    check(res.status === 0 && !fs.existsSync(path.join(tmp, 'MADE-BY-THE-NAME')) && !fs.existsSync(path.join(tmp, 'MADE-BY-THE-TEXT')) && text === 'chr17\nEOF\ntouch MADE-BY-THE-TEXT\n', 'commands.sh runs only the steps’ commands, whatever the workflow’s name and the files say');
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // the tools' commands: what each one runs, from a form's values
  {
    const T = K.TOOL;
    const v = (t, params, given) => E.valuesOf(T[t], params, given, null);
    const enc2 = v('encode', {}, { reference: EX + 'worked-example.fa', vcf: EX + 'worked-example.vcf' });
    check(JSON.stringify(T.encode.argv(enc2)) === JSON.stringify(['gpxil', 'encode', EX + 'worked-example.fa', '-v', EX + 'worked-example.vcf', '--planes', 'gt,flags', '-o', HOME + '/genomes/worked-example.gpxil.tif']), `encode: ${T.encode.argv(enc2).join(' ')}`);
    const noref = v('encode', { noRef: true, contigs: 'chr17' }, { reference: '/data/grch38/chr17.gpxil.tif', vcf: EX + 'HG002_TP53.vcf', callable: EX + 'HG002_TP53.bed' });
    check(T.encode.argv(noref).join(' ') === `gpxil encode /data/grch38/chr17.gpxil.tif -v ${EX}HG002_TP53.vcf --callable ${EX}HG002_TP53.bed --contigs chr17 --planes gt,flags --no-ref -o ${HOME}/genomes/HG002_TP53.noref.gpxil.tif`, `encode, without the reference: ${T.encode.argv(noref).join(' ')}`);
    const vc = v('vcf', { region: 'chr17:7,661,779-7,687,546 chr17:1-100', nocall: false }, { input: EX + 'HG002_chr17.gpxil.tif' });
    check(T.vcf.argv(vc).join(' ') === `gpxil vcf ${EX}HG002_chr17.gpxil.tif --region chr17:7661779-7687546 --region chr17:1-100 --no-nocall-blocks -o ${HOME}/results/HG002_chr17_chr17_7661779-7687546.vcf`, `vcf, two regions: ${T.vcf.argv(vc).join(' ')}`);
    const g2 = v('gpxil2pxil', { genes: 'TP53  BRCA1', kinds: 'protein' }, { input: EX + 'HG002_chr17.gpxil.tif' });
    check(T.gpxil2pxil.argv(g2).join(' ') === `gpxil2pxil ${EX}HG002_chr17.gpxil.tif TP53 BRCA1 -k protein -o ${HOME}/results/pxil/TP53`, `gpxil2pxil: ${T.gpxil2pxil.argv(g2).join(' ')}`);
    const bk = v('book', {}, { input: EX + 'HG002_chr17.gpxil.tif' });
    check(T.book.argv(bk).join(' ') === `gpxil book ${EX}HG002_chr17.gpxil.tif -o ${HOME}/results/HG002_chr17_book.pdf --mode reference --max-pages 5`, `book, a proof: ${T.book.argv(bk).join(' ')}`);
    check(/Give the region/.test(K.missing(T.render, v('render', {}, { input: EX + 'HG002_chr17.gpxil.tif' }))), 'Draw a region needs a region');
    check(/isn’t a region/.test(K.missing(T.render, v('render', { region: 'chr17:200-100' }, { input: EX + 'HG002_chr17.gpxil.tif' }))), '… a region that is one');
    check(/at most 25,000,000/.test(K.missing(T.render, v('render', { region: 'chr17:1-30000000' }, { input: EX + 'HG002_chr17.gpxil.tif' }))), '… and one small enough for the browser');
    check(K.parseRegion('chr17:7,661,779-7,687,546').start === 7661778 && K.parseRegion('chrM').end === null && K.parseRegion('chr1:5') === null, 'regions are read as gpxil reads them');
  }
}

async function examplesRun() {
  for (const f of examples) {
    const files = new DiskFS();
    const MG = load(files);
    const E = MG.workflowEngine;
    const w = E.parse(fs.readFileSync(path.join(EXDIR, f), 'utf8'));
    const ins = Object.fromEntries(w.steps.filter((s) => s.type === 'input').map((s) => [s.id, s.default]));
    if (Object.values(ins).some((p) => p && p.startsWith('/data/grch38/')) && !process.env.STUDIO_REFERENCE) {
      out.push(`skip  ${f}: it reads the GRCh38 reference (set STUDIO_REFERENCE to a copy of the Gpxil browser’s data/grch38)`);
      continue;
    }
    const folder = E.runFolder(files, w, ins);
    const t0 = Date.now();
    const rec = await new E.Run({ w, source: '/data/examples/workflows/' + f, inputs: ins, folder, fs: files, run: files.runner(MG) }).start();
    const bad = rec.steps.filter((e) => e.state !== 'ok');
    check(rec.state === 'ok', `${f}: every step runs, in Python (${((Date.now() - t0) / 1000).toFixed(1)} s)${bad.length ? ': ' + bad.map((e) => `${e.n}. ${e.title}: ${e.error || e.state} ${(e.stderr || '').trim().split('\n').pop()}`).join('; ') : ''}`);
    const wrote = rec.steps.flatMap((e) => Object.values(e.outputs || {}).flat());
    check(wrote.length && wrote.every((p) => files.exists(p) && p.startsWith(folder + '/')), `${f}: the files the steps say they write are in the run’s folder (${wrote.length})`);
    for (const e of rec.steps) if (e.tool === 'validate' && e.state === 'ok') check(/^Valid/.test(e.summary), `${f}: ${e.n}. ${e.title}: ${e.summary}`);
    if (f === 'gene-pictures.workflow.json') {
      const fa = rec.steps.find((e) => e.tool === 'pxil-fasta');
      const text = fa && fa.outputs && fs.readFileSync(files.real(fa.outputs.out), 'utf8');
      check(text && (text.match(/^>/gm) || []).length === 9 && /differs from the reference: P72R/.test(rec.steps[0].stdout), `${f}: HG002’s TP53 proteins differ from the reference’s by P72R, and their sequences come back from the pictures`);
    }
    if (f === 'round-trip.workflow.json') {
      const v = rec.steps.find((e) => e.tool === 'vcf');
      const text = v && v.outputs && fs.readFileSync(files.real(v.outputs.vcf), 'utf8');
      check(text && /\n?chr17\t7676154\t[^\n]*\tG\tC\t/.test(text), `${f}: the VCF of TP53 has P72R (chr17:7,676,154 G>C)`);
    }
    if (f === 'family.workflow.json') {
      const [pair, trio] = ['compare', 'trio'].map((id) => rec.steps.find((e) => e.tool === id));
      const pics = [pair, trio].map((e) => e && e.outputs && e.outputs.picture).filter((p) => p && files.exists(p));
      // (the summaries' shares are written with spaces that don't break)
      check(pair && /^> 99\.99 % of variant bases the same; substitutions: precision > 99\.99 %, recall > 99\.99 %/.test(pair.summary.replace(/\u00a0/g, ' ')) && trio && /^23 Mendelian errors, 23 of them candidate new mutations, in 106,558 variant bases of the child’s$/.test(trio.summary) && pics.length === 2, `${f}: HG002’s two benchmarks agree but for 8 variant bases, and he has 23 Mendelian errors; TP53 drawn twice (${pair && pair.summary} · ${trio && trio.summary})`);
    }
    fs.rmSync(files.tmp, { recursive: true, force: true });
  }
}

(async () => {
  try {
    await units();
    if (!process.argv.includes('--quick')) await examplesRun();
  } catch (e) {
    out.push('FAIL  ' + (e && e.stack ? e.stack : e));
  }
  console.log(out.join('\n'));
  const bad = out.filter((l) => l.startsWith('FAIL')).length;
  console.log(`\n${out.filter((l) => l.startsWith('ok')).length} passed, ${bad} failed`);
  process.exit(bad ? 1 : 0);
})();
