/* =====================================================================
   The Tools tab: the gpxil packages, point and click.

   Each tool is a form for one command of one package (gpxiltools,
   gpxil2pxil, pxil). Running it runs that command in the studio's
   Python, exactly as the terminal would (gpxilwb.gui.run), so the tab
   also shows the same command for the terminal and the same thing in
   Python, to copy or to run there.

   The tools are described in TOOLS below: a tool's fields, the command
   they make (argv), what it writes (outputs, and wf for workflows) and
   its Python (python). The first page is a map of the formats and the
   tools between them, with the tasks most people come for; a file's
   page (forFile) says what is in the file and what can be done with it.

   A gpxil file's contigs, planes and sample are read in the page (by
   gpxil-read.js, a strip at a time) as soon as it is chosen, so that the
   forms can suggest a region, a mode and a reference that fit it.
   ===================================================================== */
(function () {
  'use strict';
  const MG = window.MG;
  const { h, esc, toast, store, bus } = MG;
  MG.app = MG.app || {};

  /* ------------------------------------------------------------------ small helpers */
  const HOME = () => MG.app.HOME;
  const expand = (p) => String(p || '').replace(/^~(?=\/|$)/, HOME());
  const tilde = (p) => (p === HOME() ? '~' : String(p).startsWith(HOME() + '/') ? '~' + String(p).slice(HOME().length) : String(p));
  const shq = (s) => (/^[\w@%+=:,./~-]+$/.test(s) ? s : "'" + String(s).replace(/'/g, "'\\''") + "'");
  /** a path or word for the terminal: ~/my genome.gpxil.tif → ~/'my genome.gpxil.tif' (a ~ in quotes isn't the home folder) */
  const shArg = (s) => {
    const t = tilde(s);
    return /^~\//.test(t) && shq(t) !== t ? '~/' + shq(t.slice(2)) : shq(t);
  };
  const pyq = (s) => JSON.stringify(String(s));
  const base = (p) => String(p || '').split('/').pop();
  const dirOf = (p) => MG.path.dirname(p);
  /** the name of a file without its kind's ending: HG002_chr17.gpxil.tif → HG002_chr17 */
  const stemOf = (p) =>
    base(p).replace(/\.(gpxil\.tiff?|gpxil|pxil\.png|tiff?|png|pdf|vcf(\.b?gz)?|(fa|fasta|fna)(\.b?gz)?|bed(\.gz)?|gtf(\.gz)?|gff3?(\.gz)?|json|txt)$/i, '') || 'genome';
  const joinPath = (dir, name) => expand(dir).replace(/\/+$/, '') + '/' + name;
  const KIND = () => MG.app.kindNames || {};
  const kindOf = (p) => MG.app.fileKind(p || '');
  const icon = (n) => MG.icon(n);
  const optArgs = (cond, ...a) => (cond ? a : []);
  const fmt = (n) => Number(n).toLocaleString('en-GB');
  /** a whole number from a field ('' if it isn't one) */
  const int = (x) => (/^\s*\d+\s*$/.test(String(x == null ? '' : x)) ? String(Number(x)) : '');

  /* ------------------------------------------------------------------ Python */
  const kernel = () => MG.kernels.get();
  /** a function of the packages, by name → {ok, result, error, stdout, stderr, files: the paths it wrote}.
      onStatus(text): what Python is doing, as it starts */
  async function pyCall(fn, args, onStatus) {
    const r = await kernel().call(fn, args, onStatus ? { handlers: { onStatus } } : {});
    const files = ((r.changes && r.changes.files) || []).map((f) => f.path);
    return Object.assign({}, r, { files });
  }
  /** a command line, as the terminal runs it → {ok, code, stdout, stderr, files, error} */
  async function runArgv(argv, onStatus) {
    const r = await pyCall('gpxilwb.gui.run', { argv }, onStatus);
    if (!r.ok && r.kind === 'LoadError') throw new Error(r.error);
    if (!r.ok) return { ok: false, code: 1, stdout: r.stdout || '', stderr: (r.stderr || '') + (r.error || ''), files: r.files, error: r.error, traceback: r.traceback };
    return { ok: r.result.code === 0, code: r.result.code, stdout: r.result.stdout, stderr: r.result.stderr, files: r.files };
  }
  MG.app.pyCall = pyCall;

  /* ------------------------------------------------------------------ what a gpxil file holds (read in the page) */
  /* path → {meta, contigs: [{name, length, planes}], sample, hasRef, noRef, reference} once read; a form asks for it
     when a file is chosen (wantInfo), and is refreshed when it comes */
  const INFO = new Map();
  const infoKey = (p) => {
    const e = MG.app.fs && MG.app.fs.get(p);
    return e ? p + '@' + (e.mtime || 0) + '@' + (e.size || 0) : null;
  };
  /** what is known of a gpxil file now: its info, {error}, or null (not read yet) */
  function infoOf(p) {
    if (!p || kindOf(p) !== 'gpxil') return null;
    const k = infoKey(p);
    const got = k && INFO.get(k);
    return got && !got.then ? got : null;
  }
  /** read a gpxil file's metadata (once) → a promise of its info */
  function wantInfo(p) {
    if (!p || kindOf(p) !== 'gpxil' || !MG.gpxilRead) return Promise.resolve(null);
    const k = infoKey(p);
    if (!k) return Promise.resolve(null);
    if (INFO.has(k)) return Promise.resolve(INFO.get(k));
    const pr = MG.gpxilRead
      .open(MG.gpxilRead.sourceOf(MG.app.fs, p))
      .then((g) => {
        const contigs = g.contigs.map((c) => ({ name: c.name, length: c.length, planes: Object.keys(c.pages), aliases: c.aliases }));
        const meta = g.meta;
        const s = meta.sample && typeof meta.sample === 'object' ? meta.sample : null;
        return {
          meta,
          contigs,
          sample: s ? s.id || 'the sample' : '',
          hasRef: contigs.every((c) => c.planes.includes('ref')),
          noRef: contigs.length > 0 && contigs.every((c) => !c.planes.includes('ref')),
          hasGt: contigs.some((c) => c.planes.includes('gt')),
          reference: (meta.reference && meta.reference.name) || '',
          width: (meta.layout && meta.layout.width) || 8192
        };
      })
      .catch((e) => ({ error: e.message || String(e) }))
      .then((info) => {
        INFO.set(k, info);
        return info;
      });
    INFO.set(k, pr);
    return pr;
  }
  MG.app.gpxilInfo = wantInfo;

  /* ------------------------------------------------------------------ regions */
  const TP53 = { contig: 'chr17', start: 7661778, end: 7687546 }; // the TP53 gene on GRCh38 (Ensembl 116), 0-based
  /** CONTIG or CONTIG:START-END (1-based, both ends included; commas allowed), as gpxil reads it → {contig, start
      (0-based), end} (end null: the whole contig), or null */
  function parseRegion(text) {
    const m = String(text || '').trim().match(/^([^:\s]+)(?::([\d,]+)-([\d,]+))?$/);
    if (!m) return null;
    if (m[2] == null) return { contig: m[1], start: 0, end: null };
    const s = Number(m[2].replace(/,/g, '')), e = Number(m[3].replace(/,/g, ''));
    if (!(s >= 1) || !(e >= s)) return null;
    return { contig: m[1], start: s - 1, end: e };
  }
  const regionText = (c, s, e) => `${c}:${s + 1}-${e}`;
  /** a contig of a gpxil file by name (or alias, or with or without chr) */
  function contigOf(info, name) {
    if (!info || !info.contigs) return null;
    const n = String(name || '').toLowerCase();
    return info.contigs.find((c) => c.name.toLowerCase() === n || (c.aliases || []).some((a) => a.toLowerCase() === n) || c.name.toLowerCase() === 'chr' + n || 'chr' + c.name.toLowerCase() === n) || null;
  }
  /** a region to start from: TP53 if the file has chromosome 17, else a contig (all of a small one, or its first Mb) */
  function defaultRegion(p, max = 1e6) {
    const info = infoOf(p);
    if (!info || !info.contigs || !info.contigs.length) return '';
    const c17 = contigOf(info, 'chr17');
    if (c17 && c17.length >= TP53.end) return regionText(c17.name, TP53.start, TP53.end);
    const c = info.contigs[0];
    return c.length <= max ? c.name : regionText(c.name, 0, max);
  }
  /** a region given as text, as part of a file name: chr17:7661779-7687546 → chr17_7661779-7687546 */
  const regionSlug = (r) => String(r || '').trim().replace(/,/g, '').replace(/[:\s]+/g, '_').replace(/[^\w.-]+/g, '-') || 'all';
  /** the number of bases of a region of a file, if it can be told (null if not) */
  function regionBases(p, text) {
    const r = parseRegion(text);
    if (!r) return null;
    if (r.end != null) return r.end - r.start;
    const c = contigOf(infoOf(p), r.contig);
    return c ? c.length : null;
  }
  /** what is wrong with a region of a file ('' if nothing, or if the file isn't read yet) */
  function checkRegion(p, text, what, max) {
    const t = String(text || '').trim();
    if (!t) return `Give the ${what}: a contig, or CONTIG:START-END, such as chr17:7,661,779-7,687,546.`;
    const r = parseRegion(t);
    if (!r) return `“${t}” isn’t a region: give a contig, or CONTIG:START-END counting from 1, such as chr17:7,661,779-7,687,546.`;
    const info = infoOf(p);
    if (info && info.contigs) {
      const c = contigOf(info, r.contig);
      if (!c) return `${base(p)} has no contig called ${r.contig}: it has ${info.contigs.slice(0, 6).map((x) => x.name).join(', ')}${info.contigs.length > 6 ? ' …' : ''}.`;
      if (r.end != null && r.end > c.length) return `${c.name} is ${fmt(c.length)} bases long, so the region must end by ${fmt(c.length)}.`;
    }
    const n = regionBases(p, t);
    if (max && n != null && n > max) return `That is ${fmt(n)} bases. In the browser, ${what === 'region' ? 'draw' : 'take'} at most ${fmt(max)} at a time (on your own computer, gpxil has no such limit).`;
    return '';
  }

  /* ------------------------------------------------------------------ choices the tools share */
  const PALETTES = [
    ['classic', 'classic: A red, C blue, G green, T yellow'],
    ['okabe-ito', 'Okabe–Ito: safe for colour-blind readers'],
    ['gpxi', 'GPxI greys (Albrecht-Buehler’s original)'],
    ['process', 'process inks: cyan, magenta, yellow, black']
  ];
  const MODES = [
    ['reference', 'the reference’s bases'],
    ['genotype', 'the genotype: both haplotypes, mixed'],
    ['haplotypes', 'the two haplotypes, in two rows'],
    ['variants', 'the variants, by zygosity']
  ];
  const hasSample = (p) => !!(infoOf(p) && infoOf(p).hasGt);
  /** a gpxil file written without its reference plane (--no-ref), which needs the reference to show bases */
  const needsRef = (p) => !!(infoOf(p) && infoOf(p).noRef);
  /** the GRCh38 chromosome of /data/grch38 that a no-reference file's first contig is on, for its reference */
  function grch38For(p) {
    const info = infoOf(p);
    if (!info || !info.noRef || !/grch38|hg38/i.test(info.reference || '')) return '';
    const names = info.contigs.map((c) => c.name);
    const f = (MG.app.referenceFiles || []).find((x) => names.every((n) => (x.contigs || []).includes(n) || (x.contigs || []).includes('chr' + n)));
    return f ? f.path : '';
  }
  /** the field for the reference of a file written without one: shown only for such a file */
  const REF_FIELD = { key: 'reference', type: 'file', label: 'Its reference (it was written without one)', kinds: ['fasta', 'gpxil'], optional: true, none: 'none', def: (v) => grch38For(v.input), show: (v) => needsRef(v.input), help: 'This file names its reference by its checksums but doesn’t hold its bases. Give the same reference: a FASTA file, or a gpxil file with its reference plane, such as a chromosome of GRCh38 from /data/grch38. gpxil checks that it is the same.' };
  const refArgs = (v) => optArgs(v.reference, '--reference', v.reference);
  const refPy = (v) => (v.reference ? `, reference=${pyq(v.reference)}` : '');
  const checkNeedsRef = (v) => (needsRef(v.input) && !v.reference ? `${base(v.input)} was written without its reference: choose the reference to read its bases with.` : '');
  const RENDER_MAX = 25e6; // bases a picture may have in the browser
  const TEXT_MAX = 50e6; // bases of FASTA or VCF in one go

  /* ------------------------------------------------------------------ the tools */
  const GROUPS = [
    ['start', 'Start', 'route'],
    ['look', 'Look inside and check', 'eye'],
    ['make', 'Make gpxil files', 'genome'],
    ['picture', 'Pictures and print', 'image'],
    ['export', 'Back to FASTA and VCF', 'convert'],
    ['genes', 'Genes as pictures (pxil)', 'pixels']
  ];

  const TOOLS = [
    /* ---------------- Look inside and check ---------------- */
    {
      id: 'info',
      group: 'look',
      title: 'What’s in a gpxil file',
      pkg: 'gpxiltools',
      what: 'The reference, the sample and the contigs of a gpxil file, with the planes each one has: gpxil info.',
      about:
        'A gpxil file is a TIFF picture of many pages: one page per contig (a chromosome, say) and plane. The <b>ref</b> plane holds the reference’s bases, <b>gt</b> the sample’s genotype at each base, <b>flags</b> whether it is phased or filtered and where insertions are, and <b>gq</b>, <b>dp</b> and <b>ps</b> its genotype quality, read depth and phase set. The first page’s description holds the metadata in JSON: where the reference and the sample came from, and each contig’s length, checksums and pages. Tick “All of its metadata” to see all of it.',
      help: 'h-tool-info',
      fields: [
        { key: 'input', type: 'file', label: 'The gpxil file', kinds: ['gpxil'] },
        { key: 'json', type: 'check', label: 'All of its metadata, as JSON', def: false }
      ],
      argv: (v) => ['gpxil', 'info', v.input, ...optArgs(v.json, '--json')],
      stdoutIsResult: true,
      wf: { outputs: () => [], summary: (res) => ((res.stdout || '').split('\n').find((l) => /^reference:/.test(l)) || '').trim() },
      python: (v) =>
        v.json
          ? ['import json', 'from gpxiltools import GpxilFile', '', `with GpxilFile(${pyq(v.input)}) as g:`, '    print(json.dumps(g.metadata, indent=2))'].join('\n')
          : ['from gpxiltools import GpxilFile', '', `with GpxilFile(${pyq(v.input)}) as g:`, '    print(g.metadata["reference"]["name"], g.sample_id)', '    for c in g:   # each contig: its name, length and planes', '        print(c.name, c.length, c.planes)'].join('\n'),
      next: (res, v) => [['grid', 'Look at it in the Viewer', () => MG.app.viewerOpen(v.input)]]
    },
    {
      id: 'validate',
      group: 'look',
      title: 'Check a gpxil file',
      pkg: 'gpxiltools',
      what: 'Check a file against the gpxil specification: its metadata, its pages and planes, its codes and, if you like, its sequences’ checksums.',
      about:
        'It checks the metadata against the specification’s JSON schema, that every contig has the pages the metadata gives it, of the right size and type, that every value of every plane is a code the specification allows, that phase sets and insertions are where the flags say, and that the sidecar of complex variants and insertions reads back. With the checksums, it also reads every base of the reference plane and compares its MD5 and refget digests with those in the metadata, which proves the reference is the one named.',
      help: 'h-tool-validate',
      fields: [
        { key: 'input', type: 'file', label: 'The gpxil file', kinds: ['gpxil'] },
        { key: 'digests', type: 'check', label: 'Recompute the sequences’ checksums (MD5 and refget)', def: true, help: 'This reads every base of the reference plane: a few seconds for a chromosome kept here, and longer for one read from the web (chromosome 1 is 67 MB).' }
      ],
      argv: (v) => ['gpxil', 'validate', v.input, ...optArgs(!v.digests, '--no-digests')],
      call: { fn: 'gpxilwb.gui.validate', args: (v) => ({ path: v.input, digests: !!v.digests }) },
      wf: { outputs: () => [], summary: (res) => res.result && (res.result.valid ? `Valid (${res.result.checked.length} contig${res.result.checked.length === 1 ? '' : 's'} checked)` : `Not valid: ${res.result.errors.length} error${res.result.errors.length === 1 ? '' : 's'}`) },
      python: (v) => ['from gpxiltools.validate import validate', '', `report = validate(${pyq(v.input)}, check_digests=${v.digests ? 'True' : 'False'})`, 'print("valid" if report.ok else "not valid")', 'for e in report.errors:', '    print("error:", e)', 'for w in report.warnings:', '    print("warning:", w)'].join('\n'),
      render: (r, v, out) => renderFindings(r.result, v, out)
    },

    /* ---------------- Make gpxil files ---------------- */
    {
      id: 'encode',
      group: 'make',
      title: 'Make a gpxil file (encode)',
      pkg: 'gpxiltools',
      what: 'Turn a reference genome, and one person’s variants in a VCF, into a gpxil file: gpxil encode.',
      about:
        'The reference’s bases become the <b>ref</b> plane, one pixel a base, with lower case (soft-masked repeats) kept. Each variant in the VCF is written base by base into the <b>gt</b> plane, one half of each pixel for each haplotype: a substitution as the new base, a deletion as DEL, an insertion as a flag on the base before it, with its bases in the sidecar. With a BED file of the regions called with confidence, bases outside them are UNKNOWN rather than the reference. The reference can be a FASTA file, or a gpxil file with its reference plane, such as a chromosome of GRCh38 from /data/grch38: then only the contigs you encode are read.',
      help: 'h-tool-encode',
      fields: [
        // (the examples go together: the worked example's reference and VCF, and HG002's variants around TP53 with
        // chromosome 17 of GRCh38. A VCF of your own needs its reference chosen: for GRCh38, its chromosome's file in /data/grch38)
        { key: 'reference', type: 'file', label: 'The reference genome', kinds: ['fasta', 'gpxil'], def: (v) => (!v.vcf || /(^|\/)worked-example\.vcf$/.test(v.vcf) ? '/data/examples/worked-example.fa' : /(^|\/)HG002_TP53\.vcf$/.test(v.vcf) ? '/data/grch38/chr17.gpxil.tif' : ''), choose: 'choose the reference the VCF was called against', help: 'The reference the VCF was called against: a FASTA file, or a gpxil file with its reference plane. For a VCF on GRCh38, choose its chromosome in /data/grch38, which is read from the Gpxil browser a strip at a time.' },
        { key: 'vcf', type: 'file', label: 'The person’s variants (VCF)', kinds: ['vcf'], optional: true, none: 'none: the reference only', def: (v) => (/(^|\/)worked-example\.fa$/.test(v.reference || '') ? '/data/examples/worked-example.vcf' : '') },
        { key: 'sample', type: 'text', label: 'Sample (optional)', def: '', placeholder: 'the VCF’s first sample', show: (v) => !!v.vcf, help: 'For a VCF of several people, the name of the column to encode.' },
        { key: 'callable', type: 'file', label: 'Regions called with confidence (BED, optional)', kinds: ['bed'], optional: true, none: 'none: a base not in the VCF is the reference', pair: 'vcf', show: (v) => !!v.vcf, help: 'Bases outside these regions become UNKNOWN: not called, rather than the same as the reference. Benchmark VCFs such as Genome in a Bottle’s come with one.' },
        { key: 'contigs', type: 'text', label: 'Only these contigs (optional)', def: '', placeholder: 'all of the reference’s; or e.g. chr17, or chr1,chr2', help: 'Contigs of the reference, separated by commas. A VCF of one chromosome needs only that chromosome.' },
        { key: 'planes', type: 'select', label: 'Planes from the VCF', def: 'gt,flags', options: [['gt,flags', 'genotype and flags (gt, flags): enough for sequences, pictures and VCF'], ['', 'all the VCF has: also quality, depth and phase sets (gq, dp, ps)']], show: (v) => !!v.vcf, help: 'gq, dp and ps take as much memory again as gt and flags, which matters for a whole chromosome in the browser.' },
        { key: 'noRef', type: 'check', label: 'Leave out the reference plane (a much smaller file)', def: false, help: 'The file then names its reference by its checksums, and anything that reads its bases needs the reference too (each tool has a field for it).' },
        { key: 'sex', type: 'select', label: 'Sex chromosomes', def: '', options: [['', 'two copies of each contig'], ['XY', 'XY: one copy of chrX and chrY outside the pseudo-autosomal regions'], ['XX', 'XX']], show: (v) => !!v.vcf },
        { key: 'refName', type: 'text', label: 'The reference’s name (optional)', def: (v) => (/grch38|hg38/i.test(v.reference || '') ? 'GRCh38' : ''), placeholder: 'e.g. GRCh38', show: (v) => kindOf(v.reference) !== 'gpxil', help: 'A gpxil file as the reference gives its own name.' },
        { key: 'width', type: 'number', label: 'Bases per row of each page', def: '8192', min: 16, max: 65536, step: 1, help: 'Only the layout of the pages: 8,192 (the default) keeps strips small, so a region reads quickly.' },
        { key: 'compression', type: 'select', label: 'Compression', def: 'deflate', options: [['deflate', 'deflate (the default; everything reads it)'], ['none', 'none (large files)']], help: 'On your own computer gpxil can also use Zstandard, LZW, LZMA or PackBits, with the imagecodecs package; the browser has deflate only.' },
        { key: 'palette', type: 'select', label: 'Colours stored for image viewers', def: 'classic', options: PALETTES },
        { key: 'out', type: 'path', label: 'Save as', def: (v) => `~/genomes/${stemOf(v.vcf || v.reference)}${v.noRef ? '.noref' : ''}.gpxil.tif` }
      ],
      check: (v) => {
        const info = infoOf(v.reference);
        if (info && info.error) return `${base(v.reference)} couldn’t be read: ${info.error}`;
        if (info && !info.hasRef) return `${base(v.reference)} has no reference plane, so it can’t be the reference. Choose a FASTA file, or a gpxil file written with its reference.`;
        if (info && v.contigs) {
          const missingC = v.contigs.split(',').map((x) => x.trim()).filter((x) => x && !contigOf(info, x));
          if (missingC.length) return `${base(v.reference)} has no contig ${missingC.join(', ')}.`;
        }
        if (!int(v.width) || Number(v.width) < 1) return 'Give the bases per row as a whole number, such as 8192.';
        if (!/\.gpxil\.tiff?$/i.test(v.out || '')) return 'Save it with a name ending in .gpxil.tif.';
        return '';
      },
      argv: (v) => [
        'gpxil', 'encode', v.reference,
        ...optArgs(v.vcf, '-v', v.vcf),
        ...optArgs(v.vcf && v.sample, '-s', v.sample),
        ...optArgs(v.vcf && v.callable, '--callable', v.callable),
        ...optArgs(v.contigs, '--contigs', String(v.contigs).replace(/\s+/g, '')),
        ...optArgs(v.vcf && v.planes, '--planes', v.planes),
        ...optArgs(v.noRef, '--no-ref'),
        ...optArgs(v.vcf && v.sex, '--sex', v.sex),
        ...optArgs(v.refName && kindOf(v.reference) !== 'gpxil', '--reference-name', v.refName),
        ...optArgs(int(v.width) && int(v.width) !== '8192', '--width', int(v.width)),
        ...optArgs(v.compression && v.compression !== 'deflate', '--compression', v.compression),
        ...optArgs(v.palette && v.palette !== 'classic', '--palette', v.palette),
        '-o', v.out
      ],
      outputs: (v) => [v.out],
      wf: { outputs: (v) => [{ name: 'gpxil', label: 'gpxil file', kinds: ['gpxil'], path: v.out }], summary: (res) => ((res.stderr || '').match(/wrote [^:]+: ([^\n]+)/) || [])[1] || '' },
      python: (v) =>
        [
          'from gpxiltools.encode import encode',
          '',
          `summary = encode(${pyq(v.reference)}, ${pyq(v.out)},`,
          `                 vcf=${v.vcf ? pyq(v.vcf) : 'None'},${v.vcf && v.sample ? ` sample=${pyq(v.sample)},` : ''}${v.vcf && v.callable ? ` callable_bed=${pyq(v.callable)},` : ''}`,
          `                 contigs=${v.contigs ? JSON.stringify(String(v.contigs).split(',').map((x) => x.trim()).filter(Boolean)) : 'None'}, include_ref=${v.noRef ? 'False' : 'True'},${v.vcf && v.planes ? ` planes=${JSON.stringify(v.planes.split(','))},` : ''}${v.vcf && v.sex ? ` sex=${pyq(v.sex)},` : ''}`,
          `                 width=${int(v.width) || 8192}, compression=${pyq(v.compression || 'deflate')}, palette=${pyq(v.palette || 'classic')}${v.refName && kindOf(v.reference) !== 'gpxil' ? `, reference_name=${pyq(v.refName)}` : ''})`,
          'print(summary)'
        ].join('\n'),
      next: (res, v) => [
        ['grid', 'Look at it in the Viewer', () => MG.app.viewerOpen(v.out)],
        ['badgeCheck', 'Check it', () => MG.app.useTool('validate', { input: v.out })],
        ['pixels', 'Pictures of its genes', () => MG.app.useTool('gpxil2pxil', { input: v.out })]
      ]
    },

    /* ---------------- Pictures and print ---------------- */
    {
      id: 'render',
      group: 'picture',
      title: 'Draw a region as a picture',
      pkg: 'gpxiltools',
      what: 'Draw a region, a gene or a whole contig of a gpxil file as a PNG for the screen, or a TIFF (RGB or CMYK) for print: gpxil render.',
      about:
        'One base is one pixel (or a square of pixels, with Pixels per base), in rows of the width you choose, read from left to right and top to bottom. <b>reference</b> colours each base of the reference; <b>genotype</b> each base as the person has it, a heterozygous base the mix of its two colours; <b>haplotypes</b> draws the two haplotypes in two rows, the first above the second; <b>variants</b> fades the reference and shows the variants by zygosity, which makes them easy to find. A Hilbert-curve layout keeps neighbouring bases together in a square, so a gene is a blob rather than a band.',
      help: 'h-tool-render',
      fields: [
        { key: 'input', type: 'file', label: 'The gpxil file', kinds: ['gpxil'] },
        { key: 'region', type: 'text', label: 'Region', def: (v) => defaultRegion(v.input), placeholder: 'chr17:7,661,779-7,687,546', help: 'A contig, or CONTIG:START-END counting from 1 and including both ends.' },
        { key: 'mode', type: 'select', label: 'Show', def: (v) => (hasSample(v.input) ? 'variants' : 'reference'), options: MODES },
        { key: 'palette', type: 'select', label: 'Colours', def: 'classic', options: PALETTES },
        { key: 'width', type: 'number', label: 'Bases per row (optional)', def: (v) => (regionBases(v.input, v.region) != null && regionBases(v.input, v.region) <= 200000 ? '256' : ''), min: 1, max: 100000, step: 1, placeholder: 'the file’s width (8,192)', help: 'Narrower rows make a region taller and easier to see: a gene of 25,000 bases at 256 a row is a picture 256 pixels wide and 101 high.' },
        { key: 'scale', type: 'number', label: 'Pixels per base, each way', def: (v) => (regionBases(v.input, v.region) != null && regionBases(v.input, v.region) <= 50000 ? '4' : '1'), min: 1, max: 32, step: 1 },
        { key: 'layout', type: 'select', label: 'Layout', def: 'raster', options: [['raster', 'rows, left to right (raster)'], ['hilbert', 'a Hilbert curve (neighbouring bases stay together)']], show: (v) => v.mode !== 'haplotypes' },
        { key: 'format', type: 'select', label: 'Picture', def: 'png', options: [['png', 'PNG, for the screen'], ['tiff', 'TIFF in RGB'], ['cmyk', 'TIFF in CMYK, for print']] },
        { key: 'dpi', type: 'number', label: 'Dots per inch to record (optional)', def: '', min: 1, max: 4800, step: 1, placeholder: 'none' },
        { key: 'mark', type: 'check', label: 'Mark where insertions are', def: false, show: (v) => v.mode === 'haplotypes' },
        REF_FIELD,
        { key: 'out', type: 'path', label: 'Save as', def: (v) => `~/results/${stemOf(v.input)}_${regionSlug(v.region)}_${v.mode}${v.layout === 'hilbert' && v.mode !== 'haplotypes' ? '_hilbert' : ''}.${v.format === 'png' ? 'png' : 'tif'}` }
      ],
      check: (v) => {
        const r = checkRegion(v.input, v.region, 'region', RENDER_MAX);
        if (r) return r;
        if (v.mode !== 'reference' && infoOf(v.input) && !hasSample(v.input)) return `${base(v.input)} has no sample, so it can only show the reference.`;
        const n = regionBases(v.input, v.region), s = Number(int(v.scale) || 1);
        if (n != null && n * s * s > 64e6) return `At ${s} pixels a base that is a picture of ${fmt(n * s * s)} pixels: too big for the browser. Use fewer pixels per base, or a smaller region.`;
        if (v.format === 'png' && !/\.png$/i.test(v.out || '')) return 'Save a PNG with a name ending in .png.';
        if (v.format !== 'png' && !/\.tiff?$/i.test(v.out || '')) return 'Save a TIFF with a name ending in .tif.';
        return checkNeedsRef(v);
      },
      argv: (v) => [
        'gpxil', 'render', v.input, String(v.region).trim().replace(/,/g, ''), '-o', v.out, '--mode', v.mode,
        ...optArgs(v.palette && v.palette !== 'classic', '--palette', v.palette),
        ...optArgs(int(v.width), '--width', int(v.width)),
        ...optArgs(int(v.scale) && int(v.scale) !== '1', '--scale', int(v.scale)),
        ...optArgs(v.layout === 'hilbert' && v.mode !== 'haplotypes', '--layout', 'hilbert'),
        ...optArgs(v.format === 'cmyk', '--cmyk'),
        ...optArgs(int(v.dpi), '--dpi', int(v.dpi)),
        ...optArgs(v.mark && v.mode === 'haplotypes', '--mark-insertions'),
        ...refArgs(v)
      ],
      outputs: (v) => [v.out],
      wf: { outputs: (v) => [{ name: 'picture', label: 'picture', kinds: ['image'], path: v.out }], summary: (res) => ((res.stderr || '').match(/wrote [^:]+: ([^\n,]+)/) || [])[1] || '' },
      python: (v) => {
        const r = parseRegion(v.region) || { contig: '', start: 0, end: null };
        const hilbert = v.layout === 'hilbert' && v.mode !== 'haplotypes';
        return [
          'from gpxiltools import GpxilFile',
          'from gpxiltools.render import render',
          ...(hilbert ? ['from gpxiltools.layout import hilbert_image'] : []),
          '',
          `with GpxilFile(${pyq(v.input)}${refPy(v)}) as g:`,
          `    c = g[${pyq(r.contig)}]`,
          `    start, end = ${r.start}, ${r.end == null ? 'c.length' : r.end}`,
          `    picture = render(c, mode=${pyq(v.mode)}, palette=${pyq(v.palette || 'classic')}, start=start, end=end${int(v.width) ? `, bases_per_row=${int(v.width)}` : ''}${v.mark && v.mode === 'haplotypes' ? ', mark_insertions=True' : ''})`,
          ...(hilbert ? ['    # (the bases along a Hilbert curve, in a square, rather than in rows)', '    picture.index, _ = hilbert_image(picture.index.reshape(-1)[: end - start])'] : []),
          `    picture = picture.scaled(${int(v.scale) || 1})`,
          v.format === 'png' ? `    picture.save_png(${pyq(v.out)}${int(v.dpi) ? `, dpi=${int(v.dpi)}` : ''})` : `    picture.save_tiff(${pyq(v.out)}, colorspace=${pyq(v.format === 'cmyk' ? 'cmyk' : 'rgb')}${int(v.dpi) ? `, dpi=${int(v.dpi)}` : ''})`,
          'print(picture.shape, picture.title)'
        ].join('\n');
      },
      next: (res, v) => [['image', 'Look at the picture', () => MG.app.openFile(v.out)]]
    },
    {
      id: 'book',
      group: 'picture',
      title: 'Print it as a book (PDF)',
      pkg: 'gpxiltools',
      what: 'A PDF to print, with one dot per base: a chromosome, or a genome, page after page, with each page’s coordinates: gpxil book.',
      about:
        'Each page holds as many bases as its paper and dots per inch allow (about 6.3 million on A4 at 300 dots per inch), in rows, with a header saying which contig and bases it shows and a key to the colours. For print, the colours are CMYK, in the palette’s own ink values; for the screen, RGB. A whole human genome is several hundred pages, so the studio makes a proof of the first few pages unless you clear “At most”.',
      help: 'h-tool-book',
      fields: [
        { key: 'input', type: 'file', label: 'The gpxil file', kinds: ['gpxil'] },
        { key: 'contigs', type: 'text', label: 'Only these contigs (optional)', def: '', placeholder: 'all of them; or e.g. chr17' },
        { key: 'mode', type: 'select', label: 'Show', def: (v) => (hasSample(v.input) ? 'genotype' : 'reference'), options: MODES },
        { key: 'palette', type: 'select', label: 'Colours', def: 'classic', options: PALETTES },
        { key: 'rgb', type: 'select', label: 'For', def: 'cmyk', options: [['cmyk', 'print: CMYK ink colours'], ['rgb', 'the screen: RGB colours']] },
        { key: 'page', type: 'select', label: 'Paper', def: 'A4', options: [['A4', 'A4'], ['A3', 'A3'], ['A5', 'A5'], ['letter', 'US letter']] },
        { key: 'dpi', type: 'number', label: 'Dots per inch (one base a dot)', def: '300', min: 30, max: 2400, step: 1 },
        { key: 'scale', type: 'number', label: 'Dots per base, each way', def: '1', min: 1, max: 16, step: 1 },
        { key: 'margin', type: 'number', label: 'Margin (mm)', def: '15', min: 0, max: 60, step: 'any' },
        { key: 'title', type: 'text', label: 'Title (optional)', def: '', placeholder: 'the file’s sample or reference' },
        { key: 'maxPages', type: 'number', label: 'At most this many pages (a proof)', def: '5', min: 1, max: 100000, step: 1, placeholder: 'all of them', help: 'The cover, the page on how to read the book and each contig’s title page count too, so 5 gives two pages of bases. Clear it for every page. In the browser, a few hundred pages take a while and a lot of memory.' },
        REF_FIELD,
        { key: 'out', type: 'path', label: 'Save as', def: (v) => `~/results/${stemOf(v.input)}${v.contigs ? '_' + String(v.contigs).replace(/[\s,]+/g, '-') : ''}_book.pdf` }
      ],
      check: (v) => {
        if (v.mode !== 'reference' && infoOf(v.input) && !hasSample(v.input)) return `${base(v.input)} has no sample, so it can only show the reference.`;
        if (!int(v.dpi)) return 'Give the dots per inch as a whole number, such as 300.';
        if (v.maxPages !== '' && v.maxPages != null && !int(v.maxPages)) return 'Give the most pages as a whole number, or clear it.';
        if (!/\.pdf$/i.test(v.out || '')) return 'Save it with a name ending in .pdf.';
        return checkNeedsRef(v);
      },
      argv: (v) => [
        'gpxil', 'book', v.input, '-o', v.out,
        ...optArgs(v.contigs, '--contigs', String(v.contigs).replace(/\s+/g, '')),
        ...optArgs(v.mode !== 'genotype', '--mode', v.mode),
        ...optArgs(v.palette && v.palette !== 'classic', '--palette', v.palette),
        ...optArgs(v.rgb === 'rgb', '--rgb'),
        ...optArgs(v.page && v.page !== 'A4', '--page', v.page),
        ...optArgs(int(v.dpi) && int(v.dpi) !== '300', '--dpi', int(v.dpi)),
        ...optArgs(int(v.scale) && int(v.scale) !== '1', '--scale', int(v.scale)),
        ...optArgs(String(v.margin).trim() !== '' && Number(v.margin) !== 15, '--margin', String(Number(v.margin))),
        ...optArgs(String(v.title || '').trim(), '--title', String(v.title || '').trim()),
        ...optArgs(int(v.maxPages), '--max-pages', int(v.maxPages)),
        ...refArgs(v)
      ],
      outputs: (v) => [v.out],
      wf: { outputs: (v) => [{ name: 'pdf', label: 'PDF', kinds: ['pdf'], path: v.out }], summary: (res) => ((res.stderr || '').match(/wrote [^:]+: (\d+ pages?)/) || [])[1] || '' },
      python: (v) =>
        [
          'from gpxiltools import GpxilFile',
          'from gpxiltools.book import BookLayout, make_book',
          '',
          `layout = BookLayout(page=${pyq(v.page || 'A4')}, dpi=${int(v.dpi) || 300}, margin_mm=${String(v.margin).trim() === '' ? 15 : Number(v.margin)}, scale=${int(v.scale) || 1})`,
          `with GpxilFile(${pyq(v.input)}${refPy(v)}) as g:`,
          `    info = make_book(g, ${pyq(v.out)}, contigs=${v.contigs ? JSON.stringify(String(v.contigs).split(',').map((x) => x.trim()).filter(Boolean)) : 'None'}, mode=${pyq(v.mode)}, palette=${pyq(v.palette || 'classic')},`,
          `                     colorspace=${pyq(v.rgb === 'rgb' ? 'rgb' : 'cmyk')}, layout=layout${String(v.title || '').trim() ? `, title=${pyq(v.title.trim())}` : ''}${int(v.maxPages) ? `, max_pages=${int(v.maxPages)}` : ''})`,
          'print(info)'
        ].join('\n'),
      next: (res, v) => [['eye', 'Look at the PDF', () => MG.app.openFile(v.out)]]
    },
    {
      id: 'palettes',
      group: 'picture',
      title: 'The palettes',
      pkg: 'gpxiltools',
      what: 'The colours of A, C, G and T in each of gpxil’s palettes, for the screen (sRGB) and for print (CMYK): gpxil palettes.',
      about: 'Every tool that draws takes a palette. <b>classic</b> is the usual red, blue, green and yellow; <b>okabe-ito</b> uses colours that people with colour-blindness can tell apart; <b>gpxi</b> is the four greys of Albrecht-Buehler’s genomic pixel images, the idea gpxil is named after; <b>process</b> uses the pure process inks, which print most faithfully.',
      help: 'h-tool-palettes',
      fields: [],
      argv: () => ['gpxil', 'palettes'],
      call: { fn: 'gpxilwb.gui.palettes', args: () => ({}) },
      python: () => ['from gpxiltools.palettes import describe', '', 'for p in describe():', '    print(p["name"], p["srgb"], p["cmyk_percent"])'].join('\n'),
      render: (r, v, out) => renderPalettes(r.result, out)
    },

    /* ---------------- Back to FASTA and VCF ---------------- */
    {
      id: 'fasta',
      group: 'export',
      title: 'Sequences as FASTA',
      pkg: 'gpxiltools',
      what: 'The reference’s sequence, or either of the person’s haplotypes, or their genotype in IUPAC codes, as a FASTA file: gpxil fasta.',
      about:
        'A haplotype’s sequence is the reference with the person’s variants applied: substitutions replace bases, deletions remove them, insertions are put after their anchor base, and bases whose state isn’t known become N. So a haplotype can be shorter or longer than the region. The IUPAC genotype keeps the reference’s length, writing a heterozygous base as the IUPAC code of its two bases (R for A and G, Y for C and T, and so on). Lower case (soft-masked repeats) is kept.',
      help: 'h-tool-fasta',
      fields: [
        { key: 'input', type: 'file', label: 'The gpxil file', kinds: ['gpxil'] },
        { key: 'which', type: 'select', label: 'Sequence', def: (v) => (hasSample(v.input) ? '1' : 'ref'), options: [['ref', 'the reference'], ['1', 'haplotype 1'], ['2', 'haplotype 2'], ['iupac', 'the genotype, in IUPAC codes']] },
        { key: 'region', type: 'text', label: 'Region (optional)', def: (v) => defaultRegion(v.input), placeholder: 'every contig, whole', help: 'A contig, or CONTIG:START-END counting from 1. Leave it empty for every contig.' },
        REF_FIELD,
        { key: 'out', type: 'path', label: 'Save as', def: (v) => `~/results/${stemOf(v.input)}${String(v.region || '').trim() ? '_' + regionSlug(v.region) : ''}_${v.which === 'ref' ? 'ref' : v.which === 'iupac' ? 'iupac' : 'hap' + v.which}.fa` }
      ],
      check: (v) => {
        if (v.which !== 'ref' && infoOf(v.input) && !hasSample(v.input)) return `${base(v.input)} has no sample, so only the reference can be written.`;
        if (String(v.region || '').trim()) {
          const r = checkRegion(v.input, v.region, 'region', TEXT_MAX);
          if (r) return r;
        } else {
          const info = infoOf(v.input);
          const n = info && info.contigs ? info.contigs.reduce((a, c) => a + c.length, 0) : null;
          if (n != null && n > TEXT_MAX) return `That is all ${fmt(n)} bases of the file. In the browser, write at most ${fmt(TEXT_MAX)} at a time: give a region.`;
        }
        return checkNeedsRef(v);
      },
      argv: (v) => ['gpxil', 'fasta', v.input, ...optArgs(v.which !== 'ref', '--which', v.which), ...optArgs(String(v.region || '').trim(), '--region', String(v.region || '').trim().replace(/,/g, '')), ...refArgs(v), '-o', v.out],
      outputs: (v) => [v.out],
      wf: { outputs: (v) => [{ name: 'fasta', label: 'FASTA file', kinds: ['fasta'], path: v.out }] },
      python: (v) => {
        const r = String(v.region || '').trim() ? parseRegion(v.region) : null;
        const fn = v.which === 'ref' ? 'iter_reference(c, start, end)' : v.which === 'iupac' ? 'iter_genotype_iupac(c, start, end)' : `iter_haplotype(c, ${v.which}, start, end)`;
        const suffix = v.which === 'ref' ? '' : v.which === 'iupac' ? '_iupac' : '_hap' + v.which;
        // (each sequence is named as gpxil fasta names it: the contig, or CONTIG:START-END for part of one, and which)
        const name = `c.name if (start, end) == (0, c.length) else f"{c.name}:{start + 1}-{end}"`;
        const body = r
          ? [`    c = g[${pyq(r.contig)}]`, `    start, end = ${r.start}, ${r.end == null ? 'c.length' : r.end}`, `    name = ${name}`, `    write_fasta_stream(out, name + ${pyq(suffix)}, ${fn})`]
          : ['    for c in g:', ...(v.which === 'ref' ? [] : ['        if not c.has("gt"):   # (a contig without calls has no haplotypes)', '            continue']), '        start, end = 0, c.length', `        write_fasta_stream(out, c.name + ${pyq(suffix)}, ${fn})`];
        return [
          `from gpxiltools import GpxilFile`,
          `from gpxiltools.export import ${v.which === 'ref' ? 'iter_reference' : v.which === 'iupac' ? 'iter_genotype_iupac' : 'iter_haplotype'}, write_fasta_stream`,
          '',
          `with GpxilFile(${pyq(v.input)}${refPy(v)}) as g, open(${pyq(v.out)}, "wb") as out:`,
          ...body
        ].join('\n');
      },
      next: (res, v) => [['eye', 'Look at the FASTA file', () => MG.app.editFile(v.out)]]
    },
    {
      id: 'vcf',
      group: 'export',
      title: 'Variants as VCF',
      pkg: 'gpxiltools',
      what: 'The person’s genotypes as a VCF file again, for any other genomics tool: gpxil vcf.',
      about:
        'Each run of bases where either haplotype differs from the reference becomes a VCF record, with its genotype phased (|) where the flags say so, and with GQ, DP and PS where the file has those planes. Bases that weren’t called (UNKNOWN) become no-call blocks, with ALT &lt;*&gt; and genotype ./., unless you leave them out. The VCF of a region holds exactly the records of the whole contig’s VCF that overlap it, so a deletion that starts before the region is written whole.',
      help: 'h-tool-vcf',
      fields: [
        { key: 'input', type: 'file', label: 'The gpxil file', kinds: ['gpxil'] },
        { key: 'region', type: 'text', label: 'Regions (optional)', def: (v) => defaultRegion(v.input), placeholder: 'every contig', help: 'One or more regions, separated by spaces: a contig, or CONTIG:START-END counting from 1. Leave it empty for every contig.' },
        { key: 'nocall', type: 'check', label: 'Write no-call blocks for the bases not called', def: true },
        REF_FIELD,
        { key: 'out', type: 'path', label: 'Save as', def: (v) => `~/results/${stemOf(v.input)}${String(v.region || '').trim() ? '_' + regionSlug(String(v.region).trim().split(/\s+/)[0]) : ''}.vcf` }
      ],
      check: (v) => {
        if (infoOf(v.input) && !hasSample(v.input)) return `${base(v.input)} has no sample, so it has no variants to write.`;
        for (const r of String(v.region || '').trim().split(/\s+/).filter(Boolean)) {
          const bad = checkRegion(v.input, r, 'region', 0);
          if (bad) return bad;
        }
        return checkNeedsRef(v);
      },
      argv: (v) => ['gpxil', 'vcf', v.input, ...String(v.region || '').trim().split(/\s+/).filter(Boolean).flatMap((r) => ['--region', r.replace(/,/g, '')]), ...optArgs(!v.nocall, '--no-nocall-blocks'), ...refArgs(v), '-o', v.out],
      outputs: (v) => [v.out],
      wf: { outputs: (v) => [{ name: 'vcf', label: 'VCF file', kinds: ['vcf'], path: v.out }], summary: (res) => ((res.stderr || '').match(/wrote ([\d,]+ records)/) || [])[1] || '' },
      python: (v) => {
        const regs = String(v.region || '').trim().split(/\s+/).filter(Boolean).map(parseRegion).filter(Boolean);
        return [
          'from gpxiltools import GpxilFile',
          'from gpxiltools.export import write_vcf',
          '',
          `with GpxilFile(${pyq(v.input)}${refPy(v)}) as g, open(${pyq(v.out)}, "w") as out:`,
          `    n = write_vcf(g, out, nocall_blocks=${v.nocall ? 'True' : 'False'}${regs.length ? `, regions=[${regs.map((r) => `(${pyq(r.contig)}, ${r.start}, ${r.end == null ? 'None' : r.end})`).join(', ')}]` : ''})`,
          'print(n, "records")'
        ].join('\n');
      },
      next: (res, v) => [['eye', 'Look at the VCF', () => MG.app.editFile(v.out)], ['genome', 'Encode it again', () => MG.app.useTool('encode', { vcf: v.out })]]
    },

    /* ---------------- Genes as pictures ---------------- */
    {
      id: 'gpxil2pxil',
      group: 'genes',
      title: 'Genes, transcripts and proteins as pxil pictures',
      pkg: 'gpxil2pxil',
      what: 'Pictures of a gene, its spliced transcripts and its proteins, one pixel a base or amino acid, from the reference or from either of a person’s haplotypes: gpxil2pxil.',
      about:
        'The genes and their transcripts come from the Gpxil browser’s gene files (every transcript of Ensembl release 116, on GRCh38, read from the web a gene at a time) or from a GTF file you give. For each transcript it writes the gene’s sequence, the spliced transcript and the protein, as pxil files: PNG pictures whose palette is the alphabet, with the sequence’s coordinates, exons and source in their metadata. Made from a haplotype, a protein says how it differs from the reference’s (P72R, say). The files are named with the Ensembl IDs, and with the sample and haplotype when they come from one.',
      help: 'h-tool-gpxil2pxil',
      fields: [
        { key: 'input', type: 'file', label: 'The gpxil file', kinds: ['gpxil'] },
        { key: 'genes', type: 'text', label: 'Genes', def: 'TP53', placeholder: 'TP53 BRCA1, or ENSG00000141510', help: 'Symbols or Ensembl gene IDs, separated by spaces.' },
        { key: 'transcripts', type: 'select', label: 'Transcripts', def: 'canonical', options: [['canonical', 'the canonical transcript (Ensembl’s choice)'], ['mane', 'the MANE Select and MANE Plus Clinical transcripts'], ['coding', 'every protein-coding transcript'], ['all', 'every transcript']] },
        { key: 'kinds', type: 'select', label: 'Pictures of', def: 'gene,transcript,protein', options: [['gene,transcript,protein', 'the gene, its transcripts and their proteins'], ['protein', 'the proteins only'], ['transcript,protein', 'the transcripts and proteins'], ['transcript', 'the transcripts only'], ['gene', 'the gene only']] },
        { key: 'haplotypes', type: 'select', label: 'From', def: 'auto', options: [['auto', 'both haplotypes, if the file has a sample; else the reference'], ['all', 'the reference and both haplotypes'], ['ref', 'the reference'], ['both', 'both haplotypes'], ['1', 'haplotype 1'], ['2', 'haplotype 2']] },
        { key: 'annotation', type: 'file', label: 'Genes from (optional)', kinds: ['gtf'], optional: true, none: 'the Gpxil browser’s genes (Ensembl 116, GRCh38), read from the web' },
        { key: 'width', type: 'number', label: 'Residues per row (optional)', def: '', min: 1, max: 100000, step: 1, placeholder: 'about square' },
        REF_FIELD,
        { key: 'list', type: 'check', label: 'Only list each gene’s transcripts (no pictures)', def: false },
        { key: 'outdir', type: 'folder', label: 'Save in', def: (v) => `~/results/pxil/${String(v.genes || '').trim().split(/[\s,]+/)[0] || 'genes'}` }
      ],
      check: (v) => {
        if (!String(v.genes || '').trim()) return 'Give a gene, such as TP53.';
        if (['all', 'both', '1', '2'].includes(v.haplotypes) && infoOf(v.input) && !hasSample(v.input)) return `${base(v.input)} has no sample, so it has no haplotypes: choose the reference.`;
        return checkNeedsRef(v);
      },
      argv: (v) => [
        'gpxil2pxil', v.input, ...String(v.genes || '').trim().split(/[\s,]+/).filter(Boolean),
        ...optArgs(v.transcripts && v.transcripts !== 'canonical', '-t', v.transcripts),
        ...optArgs(v.kinds && v.kinds !== 'gene,transcript,protein', '-k', v.kinds),
        ...optArgs(v.haplotypes && v.haplotypes !== 'auto', '--haplotypes', v.haplotypes),
        ...optArgs(v.annotation, '-a', v.annotation),
        ...optArgs(int(v.width), '--width', int(v.width)),
        ...refArgs(v),
        ...(v.list ? ['--list'] : ['-o', v.outdir])
      ],
      stdoutIsResult: true,
      wf: { outputs: (v) => (v.list ? [] : [{ name: 'pxil', label: 'pxil files', kinds: ['pxil'], find: /\.pxil\.png$/i, many: true }]), summary: (res) => ((res.stdout || '').match(/(\d+ pxil files?)\s*$/) || [])[1] || '' },
      python: (v) =>
        [
          'from gpxiltools import GpxilFile',
          `from gpxil2pxil import ${v.annotation ? 'GTF' : 'BrowserData'}, make`,
          '',
          `genes = ${v.annotation ? `GTF(${pyq(v.annotation)})` : 'BrowserData()'}   # where genes and transcripts come from`,
          `with GpxilFile(${pyq(v.input)}${refPy(v)}) as g:`,
          `    haplotypes = ${{ auto: '(1, 2) if g.sample_id else (None,)', all: '(None, 1, 2)', ref: '(None,)', both: '(1, 2)', 1: '(1,)', 2: '(2,)' }[v.haplotypes || 'auto']}   # None: the reference`,
          `    for name in ${JSON.stringify(String(v.genes || '').trim().split(/[\s,]+/).filter(Boolean))}:`,
          '        gene = genes.find(name)',
          ...(v.list
            ? ['        for t in gene.transcripts:', '            print(t.name, t.id, t.biotype, t.protein or "")']
            : [`        for f in make(g, gene, transcripts=${pyq(v.transcripts || 'canonical')}, kinds=${JSON.stringify((v.kinds || 'gene,transcript,protein').split(','))}, haplotypes=haplotypes, out_dir=${pyq(v.outdir)}${int(v.width) ? `, width=${int(v.width)}` : ''}):`, '            print(f.path, f.notes)'])
        ].join('\n'),
      next: (res, v) => (v.list ? [] : [['folder', 'Show them in Files', () => MG.app.revealFile(v.outdir)], ['text', 'Their sequences as FASTA', () => MG.app.useTool('pxil-fasta', { input: (res.files || []).filter((p) => /\.pxil\.png$/i.test(p)) })]])
    },
    {
      id: 'pxil-fasta',
      group: 'genes',
      title: 'pxil pictures → FASTA',
      pkg: 'pxil',
      what: 'The sequences of pxil files as FASTA, or their metadata as JSON: pxil.',
      about:
        'A pxil file is an ordinary PNG picture of one sequence, one pixel a residue, whose palette is the alphabet: pixel value 1 is A, 2 is C, and so on. Its metadata, in a text chunk of the PNG, says what the sequence is: its kind (gene, transcript, protein), IDs, coordinates, exons and source. So the sequence comes back exactly from the picture, with nothing but a PNG reader.',
      help: 'h-tool-pxil-fasta',
      fields: [
        { key: 'input', type: 'files', label: 'The pxil files', kinds: ['pxil'] },
        { key: 'info', type: 'check', label: 'Their metadata (JSON) instead of their sequences', def: false },
        { key: 'out', type: 'path', label: 'Save as', def: (v) => `~/results/${(v.input || []).length === 1 ? stemOf(v.input[0]) : 'pxil-sequences'}${v.info ? '.json' : '.fa'}` }
      ],
      argv: (v) => ['pxil', ...(v.input || []), ...optArgs(v.info, '--info'), '-o', v.out],
      outputs: (v) => [v.out],
      wf: { outputs: (v) => [{ name: 'out', label: v.info ? 'metadata (JSON)' : 'FASTA file', kinds: [v.info ? 'json' : 'fasta'], path: v.out }] },
      python: (v) =>
        [
          ...(v.info ? ['import json'] : []),
          'import pxil',
          '',
          `with open(${pyq(v.out)}, "w", encoding="utf-8") as out:`,
          `    for path in ${JSON.stringify(v.input || [])}:`,
          '        sequence, meta = pxil.read(path)',
          ...(v.info
            ? ['        out.write(json.dumps(meta, indent=2, ensure_ascii=False) + "\\n")']
            : ['        out.write(">" + pxil.fasta_name(meta, path) + "\\n")   # its id (with the person and haplotype), name and kind', '        for i in range(0, len(sequence), 60):', '            out.write(sequence[i : i + 60] + "\\n")'])
        ].join('\n'),
      next: (res, v) => [['eye', 'Look at it', () => MG.app.editFile(v.out)]]
    }
  ];
  const TOOL = Object.fromEntries(TOOLS.map((t) => [t.id, t]));
  MG.gpxilTools = TOOLS;

  /* the common tasks, on the first page: [icon, what you want, [tool ids in order], a walkthrough] */
  const TASKS = [
    ['eye', 'Look inside a gpxil file, and check it', ['info', 'validate'], 'h-walk-look'],
    ['genome', 'Turn someone’s VCF into a gpxil file', ['encode', 'validate'], 'h-walk-encode'],
    ['image', 'Draw a gene, a region or a chromosome', ['render', 'palettes'], 'h-walk-render'],
    ['pixels', 'See a person’s own version of a protein', ['gpxil2pxil', 'pxil-fasta'], 'h-walk-genes'],
    ['convert', 'Get sequences and variants back out', ['fasta', 'vcf'], 'h-walk-export'],
    ['print', 'Print a chromosome as a book', ['book'], 'h-walk-book']
  ];

  /* ------------------------------------------------------------------ files for the pickers */
  /** the files of some kinds: {mine: in ~ (newest first), ex: the examples, ref: the GRCh38 reference's chromosomes} */
  function filesOfKinds(kinds) {
    const fs = MG.app.fs;
    const REF = (MG.app.REF_DIR || '/data/grch38') + '/';
    const mine = [], ex = [], ref = [];
    for (const [p, e] of fs.entries) {
      if (e.kind === 'dir') continue;
      const inHome = p.startsWith(HOME() + '/'), inEx = p.startsWith('/data/examples/'), inRef = p.startsWith(REF);
      if (!inHome && !inEx && !inRef) continue;
      if (/\/\.[^/]*$/.test(p) || p.includes('/.cache/')) continue;
      const k = kindOf(p);
      if (!kinds.includes(k)) continue;
      (inHome ? mine : inEx ? ex : ref).push({ path: p, kind: k, mtime: e.mtime || 0 });
    }
    mine.sort((a, b) => b.mtime - a.mtime);
    ex.sort((a, b) => (a.path < b.path ? -1 : 1));
    const order = (p) => (MG.app.referenceFiles || []).findIndex((f) => f.path === p);
    ref.sort((a, b) => order(a.path) - order(b.path));
    return { mine, ex, ref };
  }
  /** the file of some kinds that goes with path: the same name in the same folder with another ending, as a VCF and the
      BED file of its callable regions (HG002_TP53.vcf and HG002_TP53.bed) – or '' */
  const pairStem = (p) => String(p || '').replace(/\.(vcf|vcf\.b?gz|bed|bed\.gz)$/i, '');
  function pairOf(path, kinds) {
    if (!path) return '';
    const stem = pairStem(path);
    const { mine, ex } = filesOfKinds(kinds);
    const hit = mine.concat(ex).find((x) => x.path !== path && pairStem(x.path) === stem);
    return hit ? hit.path : '';
  }
  /** where an upload of a kind goes */
  const uploadDir = (kinds) => HOME() + '/' + (kinds.includes('image') && kinds.length === 1 ? 'results' : 'genomes');

  /* ------------------------------------------------------------------ the tab */
  class ToolsTab {
    constructor(root, opts) {
      this.root = root;
      this.fs = opts.fs;
      this.values = {}; // tool id → the values last used
      this._build();
      this.go(store.get('toolsPage', null) || { page: 'start' });
      bus.on('kernel:state', () => this._pyPill());
      bus.on('kernel:status', () => this._pyPill());
      this._pyPill();
      // file lists follow the files (debounced)
      this.fs.onChange(() => {
        clearTimeout(this._ft);
        this._ft = setTimeout(() => this._refreshPickers(), 300);
      });
    }
    _build() {
      this.nav = h('nav.tl-nav', { 'aria-label': 'Tools' });
      this.main = h('div.tl-main', { tabindex: '-1' });
      this.pill = h('button.tl-py', { type: 'button', title: 'The Python that runs the tools' });
      this.pill.addEventListener('click', () => this._pyMenu());
      this.navBtn = h('button.tbtn.tl-navbtn', { type: 'button', html: icon('list') + '<span>All tools</span>', 'aria-expanded': 'false' });
      this.navBtn.addEventListener('click', () => this._toggleNav());
      // (workflows: tools chained together, run in one go – workflows.js)
      this.wfBtn = h('button.tbtn.tl-wfbtn', { type: 'button', title: 'Chain tools together into a workflow, and run it in one go', html: icon('workflow') + '<span>Workflows</span>' });
      this.wfBtn.addEventListener('click', () => this.go({ page: 'workflows' }));
      const head = h('div.tl-head', this.navBtn, this.wfBtn, h('span.tl-crumb'), h('span.grow'), this.pill);
      this.crumb = head.querySelector('.tl-crumb');
      this.root.append(h('div.tl-wrap', head, h('div.tl-body', this.nav, this.main)));
      for (const [g, label, ic] of GROUPS) {
        const sec = h('div.tl-group', h('div.tl-gh', { html: icon(ic) + `<span>${esc(label)}</span>` }));
        if (g === 'start') {
          const b = h('button.tl-item', { type: 'button', dataset: { page: 'start' } }, h('span', 'The map, and where to begin'));
          b.addEventListener('click', () => this.go({ page: 'start' }));
          const wb = h('button.tl-item', { type: 'button', dataset: { page: 'workflows' } }, h('span', 'Workflows'), h('small', 'tools chained together'));
          wb.addEventListener('click', () => this.go({ page: 'workflows' }));
          sec.append(b, wb);
        }
        for (const t of TOOLS.filter((x) => x.group === g)) {
          const b = h('button.tl-item', { type: 'button', dataset: { tool: t.id } }, h('span', t.title), h('small', t.pkg));
          b.addEventListener('click', () => this.choose(t.id));
          sec.appendChild(b);
        }
        this.nav.appendChild(sec);
      }
    }
    _toggleNav(open) {
      const on = open == null ? !this.root.classList.contains('nav-open') : open;
      this.root.classList.toggle('nav-open', on);
      this.navBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
    }
    shown() {
      this._refreshPickers();
      // (the workflow editor's wires are drawn where its boxes are now)
      if (this.wf && this.where && this.where.page === 'workflows') this.wf.shown();
    }
    _mark(sel) {
      this.nav.querySelectorAll('.tl-item').forEach((b) => b.classList.toggle('on', b.matches(sel)));
    }
    /** show a page: {page: 'start'} | {page: 'tool', id, values} | {page: 'file', path} |
        {page: 'workflows', view: 'list' | 'edit' | 'run' | 'record' | 'extract', path} (workflows.js) */
    go(where) {
      this._toggleNav(false);
      this.where = where;
      store.set('toolsPage', where.page === 'tool' ? { page: 'tool', id: where.id } : where.page === 'file' ? where : where.page === 'workflows' ? { page: 'workflows', view: where.view || 'list', path: where.path || null } : { page: 'start' });
      if (this.wf) this.wf.leave();
      this.root.classList.remove('wf-wide');
      this.wfBtn.classList.toggle('on', where.page === 'workflows');
      this.main.innerHTML = '';
      this.main.scrollTop = 0;
      this.pickers = [];
      if (where.page === 'workflows' && MG.WorkflowsUI) {
        this._mark('[data-page="workflows"]');
        this.wf = this.wf || new MG.WorkflowsUI(this);
        return this.wf.show(where);
      }
      if (where.page === 'tool' && TOOL[where.id]) return this._toolPage(TOOL[where.id], where.values || {});
      if (where.page === 'file' && where.path && this.fs.exists(where.path)) return this._filePage(where.path);
      return this._startPage(where.kind);
    }
    /** a tool, with its fields filled in from values ({input: path, …}) */
    choose(id, values = {}) {
      if (id === 'start') return this.go({ page: 'start', kind: values.kind });
      if (!TOOL[id]) return;
      this.go({ page: 'tool', id, values });
    }
    forFile(path) {
      this.go({ page: 'file', path });
    }

    /* ---------------- Python's state, at the top right ---------------- */
    _pyPill() {
      const K = MG.kernels.peek();
      let state = 'off', text = 'Python starts when you run a tool';
      if (K) {
        if (K.state === 'ready') {
          state = 'ok';
          text = `Python ${(K.versions && K.versions.python) || ''} ready`;
        } else if (K.state === 'loading') {
          state = 'busy';
          text = K.statusText || 'Starting Python…';
        } else if (K.state === 'failed') {
          state = 'bad';
          text = 'Python couldn’t start';
        }
      }
      this.pill.innerHTML = `<span class="kdot ${state === 'ok' ? 'ok' : state === 'busy' ? 'busy' : state === 'bad' ? 'bad' : 'off'}"></span><span>${esc(text)}</span>`;
    }
    _pyMenu() {
      const K = MG.kernels.get();
      const v = (K.versions && K.versions.packages) || (window.WB_BUNDLE && window.WB_BUNDLE.packages) || {};
      const later = (window.WB_BUNDLE && window.WB_BUNDLE.analysis && window.WB_BUNDLE.analysis.packages) || {};
      const rows = Object.entries(v)
        .filter(([n]) => n !== 'gpxilwb' && n !== 'error')
        .map(([n, ver]) => `<tr><td><code>${esc(n)}</code></td><td>${esc(ver || '')}</td></tr>`)
        .concat(Object.entries(later).map(([n, ver]) => `<tr><td><code>${esc(n)}</code> <small class="muted">loaded when first used</small></td><td>${esc(ver || '')}</td></tr>`))
        .join('');
      const m = MG.modal(
        'Python for the tools',
        `<p>The tools run in Python ${esc((K.versions && K.versions.python) || '')} (Pyodide${K.versions && K.versions.pyodide ? ' ' + esc(K.versions.pyodide) : ''}) here in your browser. Your files are never sent anywhere: Python reads them where the browser keeps them. What comes from the web is the GRCh38 reference (/data/grch38) and the Gpxil browser’s gene files, a piece at a time, from the Gpxil browser’s site. The Notebook and Terminal tabs use the same Python.</p>
         <table class="table small"><tr><th>Package</th><th>Version</th></tr>${rows}</table>
         <p class="muted small">On your own computer, <code>pip install gpxiltools gpxil2pxil pxil</code> gives you the same programs and the same Python (see the help: Reference → Versions, and how to cite).</p>
         <div class="prompt-actions"><button class="btn" data-x="start" type="button">${K.state === 'ready' ? 'Restart Python' : 'Start Python now'}</button></div>`
      );
      m.box.querySelector('[data-x="start"]').addEventListener('click', () => {
        m.close();
        if (K.state === 'ready') K.restart();
        else K.ensure().catch(() => {});
      });
    }

    /* ---------------- the first page: the map, and the common tasks ---------------- */
    _startPage(kind) {
      this._mark('[data-page="start"]');
      this.crumb.textContent = 'Tools';
      const M = this.main;
      M.appendChild(h('h2.tl-title', 'What would you like to do?'));
      M.appendChild(h('p.tl-lead', 'Each tool runs a command of gpxiltools, gpxil2pxil or pxil on one of your files, an example, or the GRCh38 reference. It also shows you that command, and the same job in Python, so you can do it again in the terminal or a notebook. Click an arrow on the map to open the tool for that step, or click a box to see what you can do with that kind of file.'));
      const mapBox = h('div.tl-mapbox');
      M.appendChild(mapBox);
      const hint = h('p.tl-maphint', ' ');
      M.appendChild(hint);
      this.map = MG.formatMap(mapBox, {
        onTool: (id) => this.choose(id),
        onFormat: (k) => this._kindPanel(k, panel),
        onHover: (name) => {
          const t = TOOL[name];
          hint.textContent = t ? `${t.title} – ${t.what}` : name && KIND()[name] ? `${KIND()[name]}: click to see what you can do with it` : ' ';
        }
      });
      const panel = h('div.tl-kindpanel');
      M.appendChild(panel);
      if (kind) this._kindPanel(kind, panel);
      M.appendChild(h('h3.tl-sub', 'Common tasks'));
      const grid = h('div.tl-tasks');
      for (const [ic, what, ids, walk] of TASKS) {
        const card = h('div.tl-task', h('div.tl-task-h', { html: icon(ic) + `<b>${esc(what)}</b>` }));
        const steps = h('ol.tl-steps');
        ids.forEach((id) => {
          const b = h('button.linkbtn', { type: 'button' }, TOOL[id].title);
          b.addEventListener('click', () => this.choose(id));
          steps.appendChild(h('li', b));
        });
        card.appendChild(steps);
        if (walk) {
          const w = h('button.linkbtn.tl-walk', { type: 'button', html: icon('book') + '<span>Walkthrough</span>' });
          w.addEventListener('click', () => MG.app.showHelp(walk));
          card.appendChild(w);
        }
        grid.appendChild(card);
      }
      M.appendChild(grid);
      // (the same steps in one go: workflows.js)
      const wfOpen = h('button.btn', { type: 'button', html: icon('workflow') + '<span>Workflows</span>' });
      wfOpen.addEventListener('click', () => this.go({ page: 'workflows' }));
      M.appendChild(h('div.tl-wfnote',
        h('div.tl-task-h', { html: icon('workflow') + '<b>Doing the same steps again and again?</b>' }),
        h('p', 'Chain the tools together into a workflow, so that the files one tool writes go straight into the next. You choose the files once and press Run, and every step runs in turn, with its results in a folder of their own. Start from one of the examples, or make one from the tools you’ve just run.'),
        wfOpen));
      M.appendChild(h('p.tl-foot.muted', 'Python starts in your browser the first time you run a tool on each visit. The very first time, it downloads about 15 MB, which your browser then keeps. Big files are never copied into Python whole: it reads them a piece at a time, from your browser’s storage or from the web. Your files never leave this computer.'));
    }
    /** under the map: what can be done with a kind of file */
    _kindPanel(kind, panel) {
      panel.innerHTML = '';
      const kinds = [kind];
      const tools = TOOLS.filter((t) => (t.fields || []).some((f) => (f.type === 'file' || f.type === 'files') && f.key !== 'reference' && f.kinds.some((k) => kinds.includes(k))) || (kind === 'fasta' && t.id === 'encode'));
      panel.appendChild(h('h3.tl-sub', `With ${/^[aeiou]/i.test(KIND()[kind] || kind) ? 'an' : 'a'} ${KIND()[kind] || kind}`));
      const list = h('div.tl-chooser');
      tools.forEach((t) => {
        const b = h('button.tl-choice', { type: 'button' }, h('b', t.title), h('small', t.what));
        b.addEventListener('click', () => this.choose(t.id));
        list.appendChild(b);
      });
      if (kind === 'gpxil') {
        const b = h('button.tl-choice', { type: 'button' }, h('b', 'Look at it in the Viewer'), h('small', 'Its planes as pixels: the reference, the genotype, the variants, and quality and depth, one pixel a base.'));
        b.addEventListener('click', () => MG.app.showWorkbench('viewer'));
        list.prepend(b);
      }
      if (!tools.length) list.appendChild(h('p.muted', 'None of the tools reads this kind of file; the Files tab shows what is in it.'));
      panel.appendChild(list);
      panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    /* ---------------- a file's page: what it is, and what can be done with it ---------------- */
    async _filePage(path) {
      this._mark('.none');
      this.crumb.textContent = 'Tools › ' + base(path);
      const M = this.main;
      const kind = kindOf(path);
      M.appendChild(h('h2.tl-title', { html: icon(KIND_ICON[kind] || 'file') + `<span>${esc(base(path))}</span>` }));
      M.appendChild(h('p.tl-lead', h('code', tilde(path)), ' · ', KIND()[kind] || 'file'));
      const info = h('div.tl-info', h('span.spinner.small'), ' Reading the file…');
      M.appendChild(info);
      const panel = h('div.tl-kindpanel');
      M.appendChild(panel);
      // the tools that read it: as their main file (the reference of encode, for a FASTA file)
      const mainField = (t) => (t.fields || []).find((f) => (f.key === 'input' || (t.id === 'encode' && (f.key === 'reference' || f.key === 'vcf'))) && f.kinds.includes(kind));
      const tools = TOOLS.filter((t) => mainField(t) && !(t.id === 'encode' && kind === 'gpxil' && infoOf(path) && !infoOf(path).hasRef));
      panel.appendChild(h('h3.tl-sub', 'What you can do with it'));
      const list = h('div.tl-chooser');
      if (kind === 'gpxil') {
        const b = h('button.tl-choice', { type: 'button' }, h('b', 'Look at it in the Viewer'), h('small', 'Its planes as pixels, one pixel a base: point at one to see what the file holds there.'));
        b.addEventListener('click', () => MG.app.viewerOpen(path));
        list.appendChild(b);
      }
      tools.forEach((t) => {
        const f = mainField(t);
        const b = h('button.tl-choice', { type: 'button' }, h('b', t.title + (t.id === 'encode' && kind === 'gpxil' ? ' (as the reference)' : '')), h('small', t.what));
        b.addEventListener('click', () => this.choose(t.id, { [f.key]: f.type === 'files' ? [path] : path }));
        list.appendChild(b);
      });
      if (!tools.length) list.appendChild(h('p.muted', 'None of the tools reads this kind of file, but you can open it in the Files tab to look at it.'));
      panel.appendChild(list);
      // what is in it: a picture's size, from the browser; a gpxil file's metadata, read here; anything else, from Python
      if (kind === 'image') {
        const size = await pictureSize(this.fs, path).catch(() => null);
        info.innerHTML = '';
        info.appendChild(fileSummary({ kind, name: KIND().image || 'picture', size }));
        return;
      }
      if (kind === 'gpxil') {
        const g = await wantInfo(path);
        info.innerHTML = '';
        info.appendChild(g && !g.error ? gpxilSummary(path, g) : h('p.muted', 'Couldn’t read this file: ' + ((g && g.error) || 'it isn’t a gpxil file')));
        return;
      }
      try {
        const r = await pyCall('gpxilwb.gui.inspect', { path });
        if (!r.ok) throw new Error(r.error);
        info.innerHTML = '';
        info.appendChild(fileSummary(r.result));
      } catch (e) {
        info.innerHTML = '';
        info.appendChild(h('p.muted', 'Couldn’t read this file: ' + (e.message || e)));
      }
    }

    /* ---------------- a tool's page ---------------- */
    _toolPage(tool, given) {
      this._mark(`[data-tool="${tool.id}"]`);
      this.crumb.textContent = 'Tools › ' + tool.title;
      const M = this.main;
      M.appendChild(h('div.tl-toolhead', h('h2.tl-title', tool.title), h('span.tl-pkg', { title: 'The Python package that does this' }, tool.pkg)));
      M.appendChild(h('p.tl-lead', tool.what));
      if (tool.about) {
        const more = h('details.tl-about', h('summary', 'More about this tool'), h('p', { html: tool.about }));
        if (tool.help) {
          const hb = h('button.linkbtn', { type: 'button', html: icon('book') + '<span>Help and a walkthrough</span>' });
          hb.addEventListener('click', () => MG.app.showHelp(tool.help));
          more.appendChild(h('p', hb));
        }
        M.appendChild(more);
      }
      // the values: those given, else those last used, else the defaults
      const last = this.values[tool.id] || {};
      const v = {};
      const touched = new Set(Object.keys(given));
      const form = h('form.tl-form', { autocomplete: 'off' });
      const rows = {};
      const defOf = (f) => (typeof f.def === 'function' ? f.def(v) : f.def);
      const refreshDerived = (except) => {
        for (const f of tool.fields) {
          if (f.key === except || touched.has(f.key)) continue;
          // (a file that goes with the one just chosen: the variants of a PED file)
          if (f.type === 'file' && f.pair && f.pair === except) {
            const paired = pairOf(v[except], f.kinds);
            if (paired && rows[f.key] && rows[f.key].set) {
              v[f.key] = paired;
              rows[f.key].set(paired);
            }
            continue;
          }
          if (typeof f.def !== 'function') continue;
          v[f.key] = defOf(f);
          if (rows[f.key] && rows[f.key].set) rows[f.key].set(v[f.key]);
        }
        for (const f of tool.fields) if (rows[f.key]) rows[f.key].row.hidden = !!(f.show && !f.show(v));
        update();
      };
      for (const f of tool.fields) {
        // (a file given for a field of several files: a list of one)
        if (given[f.key] != null) v[f.key] = f.type === 'files' && !Array.isArray(given[f.key]) ? [given[f.key]] : given[f.key];
        else if (last[f.key] != null && f.type !== 'file' && f.type !== 'files' && typeof f.def !== 'function') v[f.key] = last[f.key];
        else v[f.key] = f.type === 'files' ? [] : f.type === 'file' ? '' : defOf(f);
      }
      // a file not given: the last one used, if it is still there; else the first that fits – and for a tool that takes
      // two files that go together (a PED file and its variants), the first that has its pair, and then that pair
      const fieldOf = (key) => tool.fields.find((x) => x.key === key);
      for (const f of tool.fields.filter((x) => x.type === 'file')) {
        if (v[f.key]) continue;
        const paired = f.pair && v[f.pair] ? pairOf(v[f.pair], f.kinds) : '';
        if (paired) v[f.key] = paired;
        else if (last[f.key] && this.fs.exists(last[f.key])) {
          v[f.key] = last[f.key];
          // (the file last used stays, rather than one worked out from the other fields)
          if (typeof f.def === 'function') touched.add(f.key);
        }
        else if (typeof f.def === 'string' && f.def && this.fs.exists(expand(f.def))) v[f.key] = expand(f.def);
        else if (!f.optional) {
          const { mine, ex } = filesOfKinds(f.kinds);
          const all = mine.concat(ex);
          v[f.key] = ((f.pair && all.find((x) => pairOf(x.path, fieldOf(f.pair).kinds))) || all[0] || {}).path || '';
        }
      }
      /* a gpxil file chosen: its contigs, planes and sample are read (in the page, a strip at a time), and then the
         settings that depend on them – a region on its contigs, a mode for its sample – are worked out again */
      this.form = form;
      const learn = (key) => {
        const f = fieldOf(key);
        const p = f && f.type === 'file' ? expand(v[key]) : '';
        if (!p || kindOf(p) !== 'gpxil' || infoOf(p)) return;
        wantInfo(p).then(() => {
          if (this.form === form && expand(v[key]) === p) refreshDerived(key);
        });
      };
      const onChange = (key, val) => {
        v[key] = val;
        touched.add(key);
        refreshDerived(key);
        learn(key);
      };
      for (const f of tool.fields) {
        const r = fieldRow(this, f, v, onChange);
        rows[f.key] = r;
        form.appendChild(r.row);
      }
      const run = h('button.btn.primary.tl-run', { type: 'submit', html: icon('play') + '<span>Run</span>' });
      const msg = h('span.tl-check', { role: 'status' });
      form.appendChild(h('div.tl-actions', run, msg));
      M.appendChild(form);
      const result = h('div.tl-result', { 'aria-live': 'polite' });
      M.appendChild(result);
      // the same command for the terminal and for Python
      const same = h('div.tl-same');
      M.appendChild(same);
      const full = () => {
        const x = Object.assign({}, v);
        for (const f of tool.fields) {
          if ((f.type === 'file' || f.type === 'folder' || f.type === 'path') && x[f.key]) x[f.key] = expand(x[f.key]);
          if (f.type === 'files') x[f.key] = (x[f.key] || []).map(expand);
          if (f.show && !f.show(v)) x[f.key] = f.type === 'check' ? false : f.type === 'files' ? [] : '';
        }
        return x;
      };
      const update = () => {
        const x = full();
        const problem = missing(tool, x);
        msg.textContent = problem;
        run.disabled = !!problem;
        same.innerHTML = '';
        if (!problem) renderSame(same, tool, x);
      };
      refreshDerived(null);
      tool.fields.forEach((f) => learn(f.key));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const x = full();
        if (missing(tool, x)) return;
        this.values[tool.id] = Object.assign({}, v);
        await this._run(tool, x, result, run);
      });
    }
    async _run(tool, x, result, runBtn) {
      // files it would replace
      const outs = tool.outputs ? tool.outputs(x).filter((p) => p && this.fs.exists(p)) : [];
      if (outs.length && !(await MG.confirmBox('Replace these files?', `<p>Running the tool will replace:</p><ul>${outs.map((p) => `<li><code>${esc(tilde(p))}</code></li>`).join('')}</ul>`, 'Replace them'))) return;
      // the folders it writes into
      for (const f of tool.fields) {
        if (f.type === 'folder' && x[f.key]) this.fs.mkdirp(x[f.key]);
        if (f.type === 'path' && x[f.key]) this.fs.mkdirp(dirOf(x[f.key]));
      }
      if (tool.prepare) tool.prepare(x, this.fs);
      runBtn.disabled = true;
      runBtn.classList.add('running');
      result.innerHTML = '';
      const K = kernel();
      const status = h('div.tl-status', h('span.spinner.small'), h('span', K.state === 'ready' ? (K.cellRunning ? 'Waiting for Python, which is busy with a notebook cell…' : 'Running…') : 'Starting Python in your browser (about 15 MB to download the first time)…'));
      result.appendChild(status);
      // (as Python starts, it says what it is loading)
      const onStatus = (text) => (status.lastChild.textContent = text || 'Running…');
      const t0 = performance.now();
      try {
        const res = await runTool(tool, x, onStatus);
        const secs = (performance.now() - t0) / 1000;
        status.remove();
        logRun(tool, x, res);
        await this._result(tool, x, res, result, secs);
      } catch (e) {
        status.remove();
        result.appendChild(h('div.tl-fail', h('b', 'The tool couldn’t run: '), String((e && e.message) || e)));
      } finally {
        runBtn.disabled = false;
        runBtn.classList.remove('running');
      }
    }
    async _result(tool, x, res, out, secs) {
      const ok = res.ok;
      out.appendChild(h('div.tl-done.' + (ok ? 'ok' : 'bad'), { html: icon(ok ? 'check' : 'warning') + `<span>${ok ? 'Done' : `It stopped with an error${res.code ? ` (exit status ${res.code})` : ''}`}${secs > 0.5 ? ` · ${secs.toFixed(1)} s` : ''}</span>` }));
      if (tool.render && res.result) tool.render(res, x, out);
      else {
        const text = (res.stdout || '').replace(/\s+$/, '');
        if (text) out.appendChild(h(tool.stdoutIsResult ? 'pre.tl-pre.tl-main-out' : 'pre.tl-pre', text));
      }
      // what the program said as it went (gpxil writes "wrote …" and its progress to stderr): plain; warnings and
      // errors, in yellow
      const err = (res.stderr || '').replace(/\s+$/, '');
      if (err) {
        const lines = err.split('\n');
        const bad = (l) => /warn|error|traceback|exception|cannot|can['’]t|couldn['’]t|failed|not found/i.test(l);
        const said = lines.filter((l) => !bad(l)).join('\n').trim();
        const worse = lines.filter(bad).join('\n').trim();
        if (said) out.appendChild(h('pre.tl-pre.said', said));
        if (worse) out.appendChild(h('pre.tl-pre.err', worse));
      }
      if (res.traceback && !ok) {
        const d = h('details.tl-tb', h('summary', 'Python’s traceback (for reporting a fault)'), h('pre.tl-pre', res.traceback));
        out.appendChild(d);
      }
      // the files it wrote
      const files = Array.from(new Set(res.files || [])).filter((p) => !/\/\.[^/]*$/.test(p) && this.fs.exists(p));
      if (files.length) {
        out.appendChild(h('h4.tl-h4', files.length === 1 ? 'The file it wrote' : `The ${files.length} files it wrote`));
        const list = h('div.tl-files');
        files.forEach((p) => list.appendChild(fileChip(p)));
        out.appendChild(list);
      }
      if (tool.after && ok) await tool.after(res, x, out);
      const next = ok && tool.next ? tool.next(res, x) : [];
      if (next.length) {
        const row = h('div.tl-next');
        next.forEach(([ic, label, fn]) => {
          const b = h('button.btn', { type: 'button', html: icon(ic) + `<span>${esc(label)}</span>` });
          b.addEventListener('click', fn);
          row.appendChild(b);
        });
        out.appendChild(row);
      }
      out.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      bus.emit('tools:run', { tool: tool.id, ok, files });
    }
    _refreshPickers() {
      (this.pickers || []).forEach((p) => p.refresh && p.refresh());
    }
  }

  /** run a tool with its values (as a form gives them, paths in full) → {ok, code, stdout, stderr, files, result, error,
      traceback}, as the Tools tab and a workflow run it. onStatus(text): what Python is loading for it, if anything */
  async function runTool(tool, x, onStatus) {
    if (tool.call) {
      const r = await pyCall(tool.call.fn, tool.call.args(x), onStatus);
      if (!r.ok && r.kind === 'LoadError') throw new Error(r.error);
      return { ok: r.ok, code: r.ok ? 0 : 1, stdout: r.stdout || '', stderr: r.stderr || '', files: r.files, result: r.result, error: r.error, traceback: r.traceback };
    }
    const list = Array.isArray(tool.argv(x)[0]) ? tool.argv(x) : [tool.argv(x)];
    const res = { ok: true, code: 0, stdout: '', stderr: '', files: [] };
    for (const argv of list) {
      const r = await runArgv(argv, onStatus);
      res.stdout += r.stdout;
      res.stderr += r.stderr;
      res.files = res.files.concat(r.files || []);
      res.code = Math.max(res.code, r.code);
      if (r.error) res.error = r.error;
      if (r.traceback) res.traceback = r.traceback;
    }
    res.ok = (tool.okCodes || [0]).includes(res.code) && !res.error;
    return res;
  }
  /** the tools run here, newest last, for a workflow made from them (Workflows → Make one from the tools you've run) */
  const LOG_KEY = 'toolsLog';
  function logRun(tool, x, res) {
    if (!tool.wf) return;
    const log = store.get(LOG_KEY, []);
    log.push({ tool: tool.id, values: x, files: Array.from(new Set(res.files || [])), ok: !!res.ok, time: Date.now() });
    store.set(LOG_KEY, log.slice(-40));
  }

  /* ------------------------------------------------------------------ a field of a form */
  function fieldRow(tab, f, v, onChange) {
    const id = 'tf-' + f.key + '-' + Math.random().toString(36).slice(2, 6);
    const row = h('div.tl-field', { dataset: { key: f.key } });
    const label = h('label.tl-label', { for: id }, f.label);
    let set = null;
    if (f.type === 'file') {
      const pk = filePicker(tab, f, v[f.key], (val) => onChange(f.key, val), id);
      row.append(label, pk.el);
      set = pk.set;
      tab.pickers.push(pk);
    } else if (f.type === 'files') {
      const pk = filesPicker(tab, f, v[f.key] || [], (val) => onChange(f.key, val), id);
      row.append(label, pk.el);
      tab.pickers.push(pk);
    } else if (f.type === 'select') {
      const s = h('select.tl-input', { id });
      f.options.forEach(([val, lab]) => s.appendChild(h('option', { value: val }, lab)));
      s.value = v[f.key];
      s.addEventListener('change', () => onChange(f.key, s.value));
      row.append(label, s);
      set = (val) => (s.value = val);
    } else if (f.type === 'check') {
      const c = h('input', { type: 'checkbox', id });
      c.checked = !!v[f.key];
      c.addEventListener('change', () => onChange(f.key, c.checked));
      row.classList.add('check');
      row.append(h('label.tl-checkline', { for: id }, c, h('span', f.label)));
      set = (val) => (c.checked = !!val);
    } else if (f.type === 'textarea') {
      const t = h('textarea.tl-input', { id, rows: 3, placeholder: f.placeholder || '', spellcheck: 'false' });
      t.value = v[f.key] || '';
      t.addEventListener('input', () => onChange(f.key, t.value));
      row.append(label, t);
      set = (val) => (t.value = val);
    } else if (f.type === 'colour') {
      const c = h('input.tl-colour', { type: 'color', id, value: v[f.key] || '#1a2332' });
      c.addEventListener('input', () => onChange(f.key, c.value));
      row.append(label, c);
      set = (val) => (c.value = val);
    } else {
      // text, number, folder, path
      const t = h('input.tl-input' + (f.type === 'folder' || f.type === 'path' ? '.mono' : ''), { id, type: f.type === 'number' ? 'number' : 'text', placeholder: f.placeholder || '', spellcheck: 'false', autocapitalize: 'off' });
      if (f.type === 'number') Object.assign(t, { min: f.min, max: f.max, step: f.step });
      t.value = v[f.key] == null ? '' : String(v[f.key]);
      t.addEventListener('input', () => onChange(f.key, f.type === 'number' ? t.value : t.value));
      row.append(label, t);
      set = (val) => (t.value = val == null ? '' : String(val));
    }
    if (f.help) row.appendChild(h('div.tl-help', f.help));
    if (f.show && !f.show(v)) row.hidden = true;
    return { row, set };
  }

  /** a file of some kinds: from your files, the examples or the GRCh38 reference, or uploaded */
  function filePicker(tab, f, value, onChange, id) {
    const sel = h('select.tl-input.tl-file', { id });
    const el = h('div.tl-picker', sel);
    const btns = h('div.tl-pickbtns');
    const up = h('button.linkbtn', { type: 'button', html: icon('upload') + '<span>From my computer…</span>' });
    up.addEventListener('click', async () => {
      const paths = await MG.app.pickFiles(uploadDir(f.kinds), false);
      if (paths && paths[0]) {
        refresh(paths[0]);
        onChange(paths[0]);
      }
    });
    btns.appendChild(up);
    const open = h('button.linkbtn', { type: 'button', html: icon('eye') + '<span>Look at it</span>' });
    open.addEventListener('click', () => sel.value && MG.app.openFile(sel.value));
    btns.appendChild(open);
    el.appendChild(btns);
    let current = value || '';
    function refresh(want) {
      if (want != null) current = want;
      const { mine, ex, ref } = filesOfKinds(f.kinds);
      sel.innerHTML = '';
      if (f.optional) sel.appendChild(h('option', { value: '' }, f.none || 'none'));
      else if (!mine.length && !ex.length && !ref.length) sel.appendChild(h('option', { value: '' }, 'none of your files is of this kind – add one from your computer'));
      // (a file that has to be chosen, and that couldn't be worked out from the others)
      else if (!current) sel.appendChild(h('option', { value: '' }, f.choose || 'choose one'));
      const add = (label, list) => {
        if (!list.length) return;
        const g = h('optgroup', { label });
        list.forEach((x) => g.appendChild(h('option', { value: x.path }, tilde(x.path) + (f.kinds.length > 1 && KIND()[x.kind] ? `  (${KIND()[x.kind]})` : ''))));
        sel.appendChild(g);
      };
      // (a file chosen that is not of the kinds – given by another tab – is offered as it is)
      if (current && ![...mine, ...ex, ...ref].some((x) => x.path === current) && MG.app.fs.exists(current)) mine.unshift({ path: current, kind: kindOf(current) });
      add('Your files', mine);
      add('Examples (read-only)', ex);
      add('GRCh38, read from the web (read-only)', ref);
      sel.value = current;
      if (sel.value !== current) {
        current = sel.value;
        if (current !== value) onChange(current);
      }
      open.hidden = !sel.value;
    }
    sel.addEventListener('change', () => {
      current = sel.value;
      open.hidden = !current;
      onChange(current);
    });
    refresh();
    return { el, refresh: () => refresh(), set: (p) => refresh(p) };
  }

  /** several files (merge): a list, with Add and remove */
  function filesPicker(tab, f, value, onChange, id) {
    const el = h('div.tl-multi');
    const list = h('ul.tl-multilist', { id });
    const sel = h('select.tl-input');
    const add = h('button.btn.small', { type: 'button' }, 'Add');
    let items = value.slice();
    const render = () => {
      list.innerHTML = '';
      items.forEach((p, i) => {
        const x = h('button.icon-btn', { type: 'button', 'aria-label': 'Take ' + base(p) + ' out', html: icon('x') });
        x.addEventListener('click', () => {
          items.splice(i, 1);
          render();
          onChange(items.slice());
        });
        list.appendChild(h('li', h('code', tilde(p)), x));
      });
      if (!items.length) list.appendChild(h('li.muted', 'No files chosen yet. Add them one by one below.'));
    };
    const refresh = () => {
      const { mine, ex } = filesOfKinds(f.kinds);
      sel.innerHTML = '';
      const g1 = h('optgroup', { label: 'Your files' }), g2 = h('optgroup', { label: 'Examples (read-only)' });
      mine.forEach((x) => g1.appendChild(h('option', { value: x.path }, tilde(x.path))));
      ex.forEach((x) => g2.appendChild(h('option', { value: x.path }, tilde(x.path))));
      if (mine.length) sel.appendChild(g1);
      if (ex.length) sel.appendChild(g2);
    };
    add.addEventListener('click', () => {
      if (sel.value && !items.includes(sel.value)) {
        items.push(sel.value);
        render();
        onChange(items.slice());
      }
    });
    el.append(list, h('div.tl-multiadd', sel, add));
    refresh();
    render();
    return { el, refresh };
  }

  /** what the form still needs, in words ('' when it can run) */
  function missing(tool, x) {
    for (const f of tool.fields) {
      if (f.show && !f.show(x)) continue;
      if ((f.type === 'file' && !f.optional && !x[f.key]) || (f.type === 'files' && !(x[f.key] || []).length)) return `Choose ${f.label.replace(/^The /, 'the ')}.`;
      if ((f.type === 'folder' || f.type === 'path') && !f.optional && !x[f.key]) return `Fill in “${f.label}”.`;
      if ((f.type === 'folder' || f.type === 'path') && x[f.key] && !(x[f.key] === HOME() || x[f.key].startsWith(HOME() + '/'))) return 'Results can only be saved in your home folder (~).';
      if (f.type === 'files' && f.key === 'inputs' && tool.id.endsWith('merge') && (x[f.key] || []).length < 2) return 'Choose at least two files.';
    }
    if (tool.id === 'diff' && x.input && x.input === x.input2) return 'Choose two different files.';
    return tool.check ? tool.check(x) : '';
  }

  /** the same command for the terminal, and the same in Python */
  function renderSame(box, tool, x) {
    let argvs = tool.argv(x);
    if (!Array.isArray(argvs[0])) argvs = [argvs];
    const cmd = argvs.map((a) => a.map(shArg).join(' ')).join('\n');
    const code = tool.python ? tool.python(x) : '';
    const details = h('details.tl-samebox', { open: store.get('toolsSameOpen', false) ? '' : null });
    details.addEventListener('toggle', () => store.set('toolsSameOpen', details.open));
    details.appendChild(h('summary', { html: icon('code') + '<span>The same in the terminal, and in Python</span>' }));
    const block = (title, text, kind) => {
      const pre = h('pre.code', { dataset: { run: kind } }, h('code', text));
      const wrap = h('div.tl-code', h('div.tl-code-t', title), pre);
      details.appendChild(wrap);
      MG.app.decorateCode(pre);
    };
    block('Terminal', cmd, 'term');
    if (code) block('Python (a notebook cell)', code, 'py');
    box.appendChild(details);
  }

  /** the icon of each kind of file */
  const KIND_ICON = { gpxil: 'grid', pxil: 'pixels', image: 'image', vcf: 'dna', fasta: 'text', bed: 'table', gtf: 'table', pdf: 'file', notebook: 'notebook', workflow: 'workflow', workflowrun: 'workflow', json: 'code' };

  /** a file the tool wrote: its name, and buttons to open it where it belongs */
  function fileChip(p) {
    const kind = kindOf(p);
    const chip = h('div.tl-filechip', h('span.tl-fname', { html: icon(KIND_ICON[kind] || 'file') + `<code>${esc(tilde(p))}</code>` }), h('span.tl-fkind', KIND()[kind] || ''));
    const acts = h('span.tl-facts');
    const add = (ic, label, fn) => {
      const b = h('button.linkbtn', { type: 'button', html: icon(ic) + `<span>${esc(label)}</span>` });
      b.addEventListener('click', fn);
      acts.appendChild(b);
    };
    if (kind === 'gpxil') {
      add('grid', 'View', () => MG.app.viewerOpen(p));
      add('badgeCheck', 'Check', () => MG.app.useTool('validate', { input: p }));
    }
    add('eye', 'Look at it', () => MG.app.editFile(p));
    if (kind === 'pxil') add('text', 'As FASTA', () => MG.app.useTool('pxil-fasta', { input: [p] }));
    if (['gpxil', 'vcf', 'fasta', 'pxil'].includes(kind)) add('convert', 'More…', () => MG.app.toolsFor(p));
    add('download', 'Download', () => downloadFile(p));
    chip.appendChild(acts);
    return chip;
  }
  async function downloadFile(p) {
    const blob = await MG.app.fs.toBlob(p);
    MG.downloadBlob(blob, base(p));
  }

  /** what is in a gpxil file (wantInfo), as a few lines and a table of its contigs */
  function gpxilSummary(path, g) {
    const box = h('div');
    const dl = h('dl.tl-summary');
    const row = (k, val) => val != null && val !== '' && dl.append(h('dt', k), h('dd', val));
    const m = g.meta || {};
    const ref = m.reference || {};
    const s = m.sample && typeof m.sample === 'object' ? m.sample : null;
    row('Format', `gpxil ${m.gpxil || ''}${m.generator ? ', written by ' + m.generator : ''}`);
    row('Reference', `${ref.name || 'not named'}${ref.source ? ' (' + ref.source + ')' : ''}${g.noRef ? ' – its bases are not in this file' : ''}`);
    row('Sample', s ? `${s.id || ''}${s.source ? ' from ' + s.source : ''}` : 'none: the reference only');
    if (s && s.callable_regions) row('Called with confidence', s.callable_regions);
    const total = g.contigs.reduce((a, c) => a + c.length, 0);
    row('Contigs', `${fmt(g.contigs.length)}, ${fmt(total)} bases in all`);
    row('Layout', `${fmt(g.width)} bases a row; palette ${m.palette || 'classic'}`);
    box.appendChild(dl);
    const t = h('table.tl-condtable', h('tr', h('th', 'Contig'), h('th', 'Length'), h('th', 'Planes')));
    g.contigs.slice(0, 60).forEach((c) => t.appendChild(h('tr', h('td', h('code', c.name)), h('td', fmt(c.length)), h('td', c.planes.join(', ')))));
    if (g.contigs.length > 60) t.appendChild(h('tr', h('td', { colspan: 3 }, `… and ${fmt(g.contigs.length - 60)} more`)));
    box.appendChild(h('div.table-scroll', t));
    return box;
  }

  /** what gpxilwb.gui.inspect said of a file, as a few lines */
  function fileSummary(info) {
    const box = h('dl.tl-summary');
    const row = (k, val) => val != null && val !== '' && box.append(h('dt', k), h('dd', val));
    const contigList = (o) => Object.entries(o || {}).slice(0, 12).map(([c, n]) => `${c} (${fmt(n)})`).join(', ') + (Object.keys(o || {}).length > 12 ? ' …' : '');
    row('Kind', info.name || KIND()[info.kind] || info.kind);
    if (info.error) row('Problem', info.error);
    if (info.kind === 'vcf') {
      row('Samples', (info.samples || []).join(', ') || 'none (sites only)');
      row('Records', fmt(info.records) + (info.partial ? ' or more (counted up to here)' : ''));
      row('By contig', contigList(info.contigs));
    } else if (info.kind === 'fasta') {
      row('Sequences', fmt(info.n));
      row('Bases', fmt(info.bases));
      row('The first', (info.sequences || []).slice(0, 8).map(([n, l]) => `${n} (${fmt(l)})`).join(', ') + (info.n > 8 ? ' …' : ''));
    } else if (info.kind === 'bed') {
      row('Intervals', fmt(info.intervals));
      row('Bases covered', fmt(info.bases));
      row('By contig', contigList(info.contigs));
    } else if (info.kind === 'pxil') {
      const m = info.meta || {};
      row('Sequence', `${m.kind || ''} ${m.name || ''} ${m.id || ''}`.trim());
      row('Length', `${fmt(info.length)} ${m.kind === 'protein' ? 'amino acids' : 'bases'}`);
      if (m.source) row('From', typeof m.source === 'string' ? m.source : JSON.stringify(m.source));
      if (m.notes && m.notes.length) row('Notes', m.notes.join('; '));
      row('It begins', info.head + (info.length > (info.head || '').length ? '…' : ''));
    } else if (info.kind === 'image') {
      row('Size', info.size ? `${fmt(info.size.width)} × ${fmt(info.size.height)} pixels` : 'not known: your browser can’t show this picture (a TIFF, say)');
    }
    return box;
  }

  /** the findings of gpxil validate, as a verdict and a table */
  function renderFindings(res, x, out) {
    if (!res) return;
    const n = (k, one) => `${res[k].length} ${one}${res[k].length === 1 ? '' : 's'}`;
    out.appendChild(h('div.tl-verdict.' + (res.valid ? 'ok' : 'bad'), h('b', res.valid ? 'Valid: it follows the gpxil specification.' : `Not valid: ${n('errors', 'error')}.`), ` ${res.checked.length} contig${res.checked.length === 1 ? '' : 's'} checked${res.warnings.length ? `; ${n('warnings', 'warning')}` : ''}.`));
    if (!res.findings.length) return;
    const t = h('table.tl-findings', h('tr', h('th', ''), h('th', 'What it found')));
    const SEV = { error: ['warning', 'Error'], warning: ['info', 'Warning'] };
    res.findings.forEach((f) => {
      // (findings can come from a file – a workflow's record of a run – so their words are text, not HTML)
      const known = Object.prototype.hasOwnProperty.call(SEV, f.severity);
      const [ic, word] = known ? SEV[f.severity] : ['info', String(f.severity || '')];
      t.appendChild(h('tr.' + (known ? f.severity : 'info'), h('td', { html: icon(ic) + `<span class="sr-only">${esc(word)}</span>`, title: word }), h('td', String(f.message || ''))));
    });
    out.appendChild(h('div.table-scroll', t));
  }

  /** gpxil's palettes, as swatches */
  function renderPalettes(list, out) {
    const t = h('table.tl-condtable.tl-palettes', h('tr', h('th', 'Palette'), ...['A', 'C', 'G', 'T'].map((b) => h('th', b)), h('th', '')));
    (list || []).forEach((p) => {
      const sw = (b) => {
        const rgb = p.srgb[b] || [0, 0, 0];
        const cmyk = (p.cmyk_percent && p.cmyk_percent[b]) || [];
        return h('td', h('span.vw-sw', h('i', { style: { background: `rgb(${rgb.join(',')})` } }), h('small', `rgb ${rgb.join(' ')}${cmyk.length ? ' · cmyk ' + cmyk.join(' ') : ''}`)));
      };
      t.appendChild(h('tr', h('td', h('code', p.name)), ...['A', 'C', 'G', 'T'].map(sw), h('td', h('small', p.description || ''))));
    });
    out.appendChild(h('div.table-scroll', t));
  }

  MG.ToolsTab = ToolsTab;
  /* what workflows.js shares with the Tools tab: the tools, their forms, and running them */
  MG.toolsKit = {
    TOOLS, TOOL, GROUPS, LOG_KEY, KIND, HOME, infoOf, wantInfo, parseRegion, defaultRegion,
    fieldRow, filePicker, missing, fileChip, runTool, filesOfKinds, uploadDir, downloadFile,
    expand, tilde, joinPath, stemOf, base, dirOf, shArg, pyq, icon, kernel
  };
})();
