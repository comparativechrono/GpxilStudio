/* =====================================================================
   The Viewer tab: a gpxil file's planes, as pixels.

   Pick a file (yours, an example, or a chromosome of the GRCh38
   reference, read from the web), a region and what to show: the
   reference's bases, the sample's genotype, its two haplotypes, its
   variants, or the flags, quality, depth and phase-set planes. Pointing
   at a pixel says what the file holds there. Only the strips shown are
   read (gpxil-read.js), so a whole genome opens at once.

   MG.ViewerTab(root, {fs}) → .ready, .shown(opts), .open(path, opts).
   ===================================================================== */
(function () {
  'use strict';
  const MG = window.MG;
  const { h, esc, toast, store } = MG;
  const R = () => MG.gpxilRead;

  const MAX_BASES = 4000000; // the most bases drawn at once (4 Mb: about 2,000 × 2,000 pixels)
  /* gpxiltools' palettes (gpxiltools/palettes.py), so that the viewer shows what gpxil render draws: the four bases'
     sRGB colours, N and the gap (no base); how two bases mix ('mean', or 'overprint': inks laid one on another); and
     how far a soft-masked base is faded towards white */
  const PALETTES = {
    classic: { label: 'classic: A red, C blue, G green, T yellow', A: [255, 0, 0], C: [0, 0, 255], G: [0, 255, 0], T: [255, 255, 0], N: [128, 128, 128], gap: [255, 255, 255], mix: 'mean', fade: 0.45 },
    'okabe-ito': { label: 'Okabe–Ito: safe for colour-blind readers', A: [0, 158, 115], C: [0, 114, 178], G: [230, 159, 0], T: [213, 94, 0], N: [153, 153, 153], gap: [255, 255, 255], mix: 'mean', fade: 0.45 },
    gpxi: { label: 'GPxI greys (Albrecht-Buehler’s original)', A: [0, 0, 0], C: [85, 85, 85], G: [255, 255, 255], T: [170, 170, 170], N: [170, 200, 235], gap: [255, 250, 230], mix: 'mean', fade: 0 },
    process: { label: 'process inks: cyan, magenta, yellow, black', A: [0, 174, 239], C: [236, 0, 140], G: [255, 242, 0], T: [35, 31, 32], N: [160, 160, 160], gap: [255, 255, 255], mix: 'overprint', fade: 0.45 }
  };
  const MODES = [
    ['reference', 'Reference bases', ['ref']],
    ['genotype', 'Genotype (both haplotypes, mixed)', ['ref', 'gt']],
    ['haplotypes', 'Haplotypes (two rows per row)', ['ref', 'gt']],
    ['variants', 'Variants (by zygosity)', ['ref', 'gt']],
    ['flags', 'Flags plane', ['flags']],
    ['gq', 'Genotype quality (gq)', ['gq']],
    ['dp', 'Read depth (dp)', ['dp']],
    ['ps', 'Phase sets (ps)', ['ps']]
  ];
  const MODE = Object.fromEntries(MODES.map(([k, label, planes]) => [k, { label, planes }]));
  const fmt = (n) => Math.round(n).toLocaleString('en-GB');

  /** chr17:7,661,779-7,687,546 → {contig, start (0-based), end}; chr17 → whole contig */
  function parseRegion(text) {
    const m = String(text || '').trim().replace(/[\s,]/g, '').match(/^([^:]+)(?::(\d+)(?:-(\d+))?)?$/);
    if (!m) return null;
    const start = m[2] ? Math.max(0, Number(m[2]) - 1) : 0;
    const end = m[3] ? Number(m[3]) : m[2] ? start + 1 : null;
    return { contig: m[1], start, end };
  }

  /* the colour of each ref code (0–31) for a palette, as gpxiltools.palettes.ref_colours works it out: one base its
     colour; two or three (an IUPAC code such as R, A or G) the mix of theirs; N and the gap their own; a soft-masked
     base faded towards white */
  /** Python's round(): halves to the even number (158.5 → 158), so that the colours are gpxiltools' to the unit */
  const pyRound = (x) => {
    const r = Math.round(x);
    return Math.abs(x - Math.trunc(x)) === 0.5 && r % 2 !== 0 ? r - 1 : r;
  };
  function refColours(pal) {
    const out = new Array(256).fill(pal.gap);
    for (let code = 0; code < 16; code++) {
      let c;
      if (code === 0) c = pal.gap;
      else if (code === 15) c = pal.N;
      else {
        const parts = ['A', 'C', 'G', 'T'].filter((b, i) => code & (1 << i)).map((b) => pal[b]);
        c = [0, 1, 2].map((i) => pyRound(pal.mix === 'overprint' ? parts.reduce((t, p) => t * (p[i] / 255), 1) * 255 : parts.reduce((t, p) => t + p[i], 0) / parts.length));
      }
      out[code] = c;
      out[code | 16] = code && pal.fade ? c.map((v) => pyRound(v + (255 - v) * pal.fade)) : c;
    }
    return out;
  }
  // the gt plane's states (spec section 5.2) and the flags' bits (5.3)
  const REF = 0, ABSENT = 10, COMPLEX = 12, DEL = 13, UNKNOWN = 15;
  const isSub = (st) => st === 1 || st === 2 || st === 4 || st === 8;
  /** the base (IUPAC 4-bit) one haplotype has, as gpxiltools.codes.haplotype_bases: 0 deleted or absent, 15 unknown */
  function hapBase(ref, st) {
    if (isSub(st)) return st;
    if (st === DEL || st === ABSENT) return 0;
    if (st === UNKNOWN || st === COMPLEX || (st !== REF && !isSub(st))) return 15;
    return ref & 15;
  }
  // the variants mode's classes (gpxiltools.render._VAR_CLASSES), over the reference faded 80% towards white
  const VAR = { het: [255, 140, 0], hom: [200, 0, 0], del: [20, 20, 20], ins: [0, 160, 80], nocall: [160, 160, 160], complex: [140, 60, 170] };
  const INSERTION_MARK = [255, 0, 255];
  // the flags plane, as gpxil files colour it for ordinary image viewers (gpxiltools.palettes.flags_view_colours)
  function flagsColour(f) {
    if (f & 8) return [220, 30, 30];
    if (f & 6) return [0, 160, 80];
    if (f & 16) return f & 1 ? [60, 110, 220] : [120, 150, 200];
    if (f & 1) return [200, 210, 235];
    return [250, 250, 250];
  }
  const MISSING = [255, 205, 210];

  class ViewerTab {
    constructor(root, opts) {
      this.root = root;
      this.fs = opts.fs;
      this.state = Object.assign({ path: null, region: null, mode: null, palette: 'classic', scale: 0, width: 0 }, store.get('viewerState', {}));
      this.file = null; // the open gpxil file (MG.gpxilRead)
      this.refFile = null; // the GRCh38 reference, for a file without its ref plane
      this.data = null; // what is drawn: {contig, start, end, W, scale, planes: {name: array}}
      this.build();
      this.ready = this.start();
      // (the list of files follows the files: a gpxil file made by a tool or uploaded appears in it)
      if (this.fs.onChange) {
        this.fs.onChange(() => {
          clearTimeout(this._ft);
          this._ft = setTimeout(() => this.refreshFiles(), 400);
        });
      }
    }

    build() {
      const R0 = this.root;
      R0.innerHTML = '';
      this.fileSel = h('select.vw-file', { 'aria-label': 'The gpxil file' });
      const upload = h('button.btn.small', { type: 'button', title: 'Add a gpxil file from your computer to ~/genomes (it stays in this browser)', html: MG.icon('upload') + '<span>Add a file…</span>' });
      this.contigSel = h('select.vw-contig', { 'aria-label': 'Contig' });
      this.regionIn = h('input.vw-region', { type: 'text', spellcheck: 'false', 'aria-label': 'Region', placeholder: 'chr17:7,661,779-7,687,546' });
      const go = h('button.btn.small', { type: 'button' }, 'Go');
      this.modeSel = h('select.vw-mode', { 'aria-label': 'What to show' });
      this.palSel = h('select.vw-pal', { 'aria-label': 'Colours' });
      for (const [k, p] of Object.entries(PALETTES)) this.palSel.appendChild(h('option', { value: k }, p.label));
      const nav = (icon, title, fn) => {
        const b = h('button.icon-btn', { type: 'button', title, html: MG.icon(icon) });
        b.addEventListener('click', fn);
        return b;
      };
      this.bar = h(
        'div.vw-bar',
        h('label.vw-field', h('span', 'File'), this.fileSel, upload),
        h('label.vw-field', h('span', 'Region'), this.contigSel, this.regionIn, go),
        h(
          'div.vw-field.vw-nav',
          nav('arrowL', 'Move left by half the view', () => this.pan(-0.5)),
          nav('zoom', 'Zoom in (half the bases)', () => this.zoom(0.5)),
          nav('minus', 'Zoom out (twice the bases)', () => this.zoom(2)),
          nav('arrowR', 'Move right by half the view', () => this.pan(0.5))
        ),
        h('label.vw-field', h('span', 'Show'), this.modeSel),
        h('label.vw-field', h('span', 'Colours'), this.palSel)
      );
      this.infoEl = h('div.vw-info');
      this.canvas = h('canvas.vw-canvas', { tabindex: '0', 'aria-label': 'The region, one pixel (or square) per base' });
      this.stage = h('div.vw-stage', this.canvas);
      this.hoverEl = h('div.vw-hover', { 'aria-live': 'polite' }, 'Point at a pixel to see what the file holds there.');
      this.legendEl = h('div.vw-legend');
      this.cmdEl = h('div.vw-cmd');
      this.emptyEl = h('div.vw-empty');
      R0.append(this.bar, this.infoEl, this.emptyEl, this.stage, this.hoverEl, this.legendEl, this.cmdEl);

      const picker = h('input', { type: 'file', accept: '.tif,.tiff,.gpxil', hidden: true });
      R0.appendChild(picker);
      upload.addEventListener('click', () => picker.click());
      picker.addEventListener('change', async () => {
        const f = picker.files && picker.files[0];
        picker.value = '';
        if (f) await this.addFile(f);
      });
      this.fileSel.addEventListener('change', () => this.open(this.fileSel.value, {}));
      this.contigSel.addEventListener('change', () => this.goto(this.contigSel.value));
      go.addEventListener('click', () => this.goto(this.regionIn.value));
      this.regionIn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.goto(this.regionIn.value);
      });
      this.modeSel.addEventListener('change', () => {
        this.state.mode = this.modeSel.value;
        this.load();
      });
      this.palSel.addEventListener('change', () => {
        this.state.palette = this.palSel.value;
        this.draw();
      });
      this.canvas.addEventListener('mousemove', (e) => this.hover(e));
      this.canvas.addEventListener('mouseleave', () => (this.hoverEl.textContent = 'Point at a pixel to see what the file holds there.'));
      this.canvas.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') this.pan(-0.25);
        else if (e.key === 'ArrowRight') this.pan(0.25);
        else if (e.key === '+' || e.key === '=') this.zoom(0.5);
        else if (e.key === '-') this.zoom(2);
        else return;
        e.preventDefault();
      });
      this.canvas.addEventListener('dblclick', (e) => {
        const p = this.posAt(e);
        if (p != null) this.zoom(0.5, p);
      });
      // (the pane changes size: the same bases, laid out again to fit it)
      if (typeof ResizeObserver === 'function') {
        let last = '';
        new ResizeObserver(() => {
          const size = Math.round(this.root.clientWidth / 24) + 'x' + Math.round(this.root.clientHeight / 24);
          if (size === last || !this.root.clientWidth) return;
          last = size;
          clearTimeout(this._rt);
          this._rt = setTimeout(() => this.relayout(), 150);
        }).observe(this.root);
      }
    }

    async start() {
      this.refreshFiles();
      this.palSel.value = PALETTES[this.state.palette] ? this.state.palette : 'classic';
      const list = this.files();
      const want = (this.state.path && this.fs.exists(this.state.path) && this.state.path) || (list.find((f) => /HG002/.test(f)) || list[0]);
      if (want) await this.open(want, { region: this.state.path === want ? this.state.region : null, mode: this.state.path === want ? this.state.mode : null }).catch(() => {});
      else this.showEmpty();
    }
    shown(opts) {
      if (this.data) this.relayout();
    }
    relayout() {
      const d = this.data;
      if (!d || !this.root.clientWidth) return;
      const L = this.layout(d.end - d.start, d.mode);
      if (L.W === d.W && L.scale === d.scale) return;
      Object.assign(d, L);
      this.draw();
    }

    /* ---------------- files ---------------- */
    files() {
      const out = [];
      for (const [p, e] of this.fs.entries) if (e.kind !== 'dir' && MG.app.fileKind(p) === 'gpxil') out.push(p);
      const home = MG.app.HOME + '/';
      const rank = (p) => (p.startsWith(home) ? 0 : p.startsWith('/data/examples/') ? 1 : 2);
      return out.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'en', { numeric: true }));
    }
    refreshFiles() {
      const cur = this.state.path;
      const list = this.files();
      const groups = [['Your files', (p) => p.startsWith(MG.app.HOME + '/')], ['Examples', (p) => p.startsWith('/data/examples/')], ['GRCh38 reference (read from the Gpxil browser)', (p) => p.startsWith('/data/grch38/')]];
      this.fileSel.innerHTML = '';
      for (const [label, test] of groups) {
        const ps = list.filter(test);
        if (!ps.length) continue;
        const g = h('optgroup', { label });
        for (const p of ps) g.appendChild(h('option', { value: p }, this.fs.pretty(p)));
        this.fileSel.appendChild(g);
      }
      if (cur && list.includes(cur)) this.fileSel.value = cur;
    }
    async addFile(f) {
      const dest = MG.app.HOME + '/genomes/' + f.name.replace(/[\/\\]/g, '_');
      this.fs.mkdirp(MG.app.HOME + '/genomes');
      this.fs.put(dest, { kind: 'blob', blob: f, size: f.size, mtime: Date.now(), fresh: true });
      toast(`Added <b>${esc(this.fs.pretty(dest))}</b> (${MG.humanSize(f.size)}). It stays in this browser; Python reads it a piece at a time.`, 'ok');
      this.refreshFiles();
      await this.open(dest, {});
    }
    showEmpty(msg) {
      this.stage.hidden = true;
      this.legendEl.innerHTML = '';
      this.cmdEl.innerHTML = '';
      this.infoEl.textContent = '';
      this.emptyEl.hidden = false;
      this.emptyEl.innerHTML = `<div class="ex-empty">${MG.icon('grid')}<h3>No gpxil file open</h3><p>${msg ? esc(msg) : 'Choose a file above: one of yours, an example, or a chromosome of the GRCh38 reference.'}</p></div>`;
    }

    /** open a gpxil file of the page (opts: region, mode, plane) */
    async open(path, opts = {}) {
      this.state.path = path;
      this.refreshFiles();
      this.fileSel.value = path;
      this.emptyEl.hidden = true;
      this.infoEl.textContent = 'Reading ' + this.fs.pretty(path) + '…';
      try {
        this.file = await R().open(R().sourceOf(this.fs, path));
      } catch (e) {
        this.file = null;
        this.showEmpty(`${this.fs.pretty(path)} couldn’t be read: ${e.message}`);
        throw e;
      }
      this.refFile = null;
      const g = this.file;
      this.contigSel.innerHTML = '';
      for (const c of g.contigs.slice(0, 500)) this.contigSel.appendChild(h('option', { value: c.name }, `${c.name} (${fmt(c.length)} bp)`));
      const hasGt = g.contigs.some((c) => 'gt' in c.pages);
      const planes = new Set(g.contigs.flatMap((c) => Object.keys(c.pages)));
      this.modeSel.innerHTML = '';
      for (const [k, label, need] of MODES) {
        const ok = need.every((p) => planes.has(p) || (p === 'ref' && this.canBorrowRef()));
        if (ok) this.modeSel.appendChild(h('option', { value: k }, label));
      }
      const mode = opts.mode || (opts.plane && { ref: 'reference', gt: 'genotype', flags: 'flags', gq: 'gq', dp: 'dp', ps: 'ps' }[opts.plane]) || (hasGt ? 'variants' : 'reference');
      this.state.mode = [...this.modeSel.options].some((o) => o.value === mode) ? mode : this.modeSel.options[0] && this.modeSel.options[0].value;
      this.modeSel.value = this.state.mode;
      let region = opts.region ? parseRegion(opts.region) : null;
      if (!region) {
        const first = g.contigs.find((c) => /^chr17$/.test(c.name)) || g.contigs[0];
        // TP53 on chromosome 17 (the examples are about it), else the middle of the first contig
        region = first.name === 'chr17' && first.length > 7687546 ? { contig: 'chr17', start: 7661778, end: 7687546 } : { contig: first.name, start: Math.max(0, Math.floor(first.length / 2) - 50000), end: Math.min(first.length, Math.floor(first.length / 2) + 50000) };
      }
      await this.goto(region);
    }
    /** a file without its reference plane, on GRCh38: the reference is read from the Gpxil browser */
    canBorrowRef() {
      const ref = (this.file && this.file.meta.reference) || {};
      return /grch38/i.test(ref.name || '') && (MG.app.referenceFiles || []).length > 0;
    }
    async refFor(contig) {
      if (!this.canBorrowRef()) return null;
      const f = (MG.app.referenceFiles || []).find((x) => (x.contigs || []).includes(contig.name) || (x.contigs || []).includes('chr' + contig.name));
      if (!f) return null;
      if (!this.refFile || this.refFile._url !== f.url) {
        this.refFile = await R().open(R().urlSource(f.url, f.size));
        this.refFile._url = f.url;
      }
      this.refPath = f.path;
      return this.refFile;
    }

    /* ---------------- where ---------------- */
    async goto(where) {
      if (!this.file) return;
      const r = typeof where === 'string' ? parseRegion(where) : where;
      if (!r) return toast('Give a region as CONTIG or CONTIG:START-END, such as chr17:7,661,779-7,687,546', 'warn');
      const c = this.file.contig(r.contig);
      if (!c) return toast(`${esc(r.contig)} isn’t in this file`, 'warn');
      let start = Math.max(0, Math.min(r.start || 0, c.length - 1));
      let end = Math.min(c.length, r.end == null ? c.length : Math.max(start + 1, r.end));
      if (end - start > MAX_BASES) {
        toast(`Showing ${fmt(MAX_BASES)} bases from ${fmt(start + 1)}: the viewer draws at most 4 Mb at a time (gpxil render draws any size)`, 'warn');
        end = start + MAX_BASES;
      }
      this.region = { contig: c, start, end };
      this.contigSel.value = c.name;
      this.regionIn.value = `${c.name}:${fmt(start + 1)}-${fmt(end)}`;
      await this.load();
    }
    zoom(f, centre) {
      if (!this.region) return;
      const { contig, start, end } = this.region;
      const mid = centre != null ? centre : (start + end) / 2;
      const n = Math.max(20, Math.round((end - start) * f));
      const a = Math.max(0, Math.round(mid - n / 2));
      this.goto({ contig: contig.name, start: a, end: Math.min(contig.length, a + n) });
    }
    pan(f) {
      if (!this.region) return;
      const { contig, start, end } = this.region;
      const n = end - start;
      const a = Math.max(0, Math.min(contig.length - n, Math.round(start + f * n)));
      this.goto({ contig: contig.name, start: a, end: a + n });
    }

    /* ---------------- reading and drawing ---------------- */
    /** bases per row and pixels per base for n bases: the biggest squares with which the picture fits the pane's
        width and, if it can, its height (else one pixel a base, in rows as wide as the pane, scrolled down) */
    layout(n, mode) {
      const availW = Math.max(160, (this.root.clientWidth || 800) - 30);
      const availH = Math.max(240, (this.root.clientHeight || 600) - 240);
      const rowH = mode === 'haplotypes' ? 2 : 1;
      for (let s = 24; s >= 1; s--) {
        const W = Math.max(1, Math.min(n, Math.floor(availW / s)));
        if (Math.ceil(n / W) * rowH * s <= availH || s === 1) return { W, scale: s };
      }
      return { W: Math.min(n, availW), scale: 1 };
    }
    async load() {
      if (!this.file || !this.region) return;
      const token = (this._token = (this._token || 0) + 1);
      const { contig, start, end } = this.region;
      const mode = this.state.mode;
      const need = MODE[mode].planes;
      this.infoEl.textContent = `Reading ${contig.name}:${fmt(start + 1)}-${fmt(end)}…`;
      try {
        const planes = {};
        for (const p of need) {
          if (p in contig.pages) planes[p] = await this.file.read(contig, p, start, end);
          else if (p === 'ref') {
            const rf = await this.refFor(contig);
            if (!rf) throw new Error(`${contig.name} has no reference plane in this file`);
            planes.ref = await rf.read(contig.name, 'ref', start, end);
            planes._refFrom = 'the GRCh38 reference (Gpxil browser)';
          }
        }
        // the other planes there are, for pointing at pixels: read now for a region of up to a million bases, and for a
        // bigger one, a base at a time as it is pointed at (hover)
        if (end - start <= 1e6) for (const p of ['ref', 'gt', 'flags', 'gq', 'dp', 'ps']) if (!(p in planes) && p in contig.pages) planes[p] = await this.file.read(contig, p, start, end);
        if (token !== this._token) return;
        this.data = Object.assign({ contig, start, end, mode, planes }, this.layout(end - start, mode));
        this.draw();
        this.saveState();
      } catch (e) {
        if (token !== this._token) return;
        this.infoEl.textContent = '';
        this.showEmpty(`This region couldn’t be read: ${e.message}`);
      }
    }
    saveState() {
      const d = this.data;
      if (!d) return;
      this.state.region = `${d.contig.name}:${d.start + 1}-${d.end}`;
      store.set('viewerState', { path: this.state.path, region: this.state.region, mode: this.state.mode, palette: this.state.palette });
    }
    draw() {
      const d = this.data;
      if (!d) return;
      this.emptyEl.hidden = true;
      this.stage.hidden = false;
      const pal = PALETTES[this.state.palette] || PALETTES.classic;
      const refRgb = refColours(pal);
      const n = d.end - d.start;
      const { W, scale } = d;
      const rows = Math.ceil(n / W);
      const two = d.mode === 'haplotypes';
      const rowH = two ? 2 : 1;
      const cw = W * scale;
      const img = new ImageData(W, rows * rowH);
      const px = img.data;
      // (the colours of gpxil render: gpxiltools/render.py, mode by mode; the variants' reference faded 80% to white)
      const faded = refRgb.map((c) => c.map((v) => Math.floor(v + (255 - v) * 0.8)));
      // (the end of the last row, past the region: no base, as gpxil render leaves it)
      const pad = d.mode === 'variants' ? faded[0] : refRgb[0];
      for (let o = 0; o < px.length; o += 4) {
        px[o] = pad[0];
        px[o + 1] = pad[1];
        px[o + 2] = pad[2];
        px[o + 3] = 255;
      }
      const put = (x, y, c) => {
        const o = (y * W + x) * 4;
        px[o] = c[0];
        px[o + 1] = c[1];
        px[o + 2] = c[2];
        px[o + 3] = 255;
      };
      const P = d.planes;
      for (let i = 0; i < n; i++) {
        const x = i % W, y = Math.floor(i / W);
        const ref = P.ref ? P.ref[i] : 15;
        const soft = ref & 16;
        const gt = P.gt ? P.gt[i] : 0;
        const h1 = gt >> 4, h2 = gt & 15;
        let c;
        switch (d.mode) {
          case 'reference':
            c = refRgb[ref];
            break;
          case 'genotype': {
            // the IUPAC code of the bases on both haplotypes (A and G: R, their colours mixed); deleted from both: paper
            let code = hapBase(ref, h1) | hapBase(ref, h2) | soft;
            if (code === 16) code = 0;
            c = refRgb[code];
            break;
          }
          case 'haplotypes':
            for (const [k, st] of [[0, h1], [1, h2]]) {
              const b = hapBase(ref, st);
              put(x, y * 2 + k, refRgb[(b !== 0 && b !== 15) || st === REF ? b | soft : b]);
            }
            continue;
          case 'variants': {
            const s1 = isSub(h1), s2 = isSub(h2);
            let k = '';
            if ((s1 && h2 === REF) || (s2 && h1 === REF) || (s1 && s2 && h1 !== h2)) k = 'het';
            if ((s1 && s2 && h1 === h2) || (s1 && h2 === ABSENT) || (s2 && h1 === ABSENT)) k = 'hom';
            if (h1 === DEL || h2 === DEL) k = 'del';
            if (P.flags && P.flags[i] & 6) k = 'ins';
            if (!k && (h1 === UNKNOWN || h2 === UNKNOWN)) k = 'nocall';
            if (h1 === COMPLEX || h2 === COMPLEX) k = 'complex';
            c = k ? VAR[k] : faded[ref];
            break;
          }
          case 'flags':
            c = flagsColour(P.flags[i]);
            break;
          case 'gq':
          case 'dp': {
            const v = P[d.mode][i];
            const t = Math.min(1, v / (d.mode === 'gq' ? 99 : 60));
            c = v === 255 ? MISSING : [Math.round(255 - 215 * t), Math.round(255 - 160 * t), Math.round(255 - 40 * t)];
            break;
          }
          case 'ps': {
            const v = P.ps[i];
            c = v === 0 ? [255, 255, 255] : [((v * 97) % 200) + 40, ((v * 57) % 200) + 40, ((v * 151) % 200) + 40];
            break;
          }
          default:
            c = refRgb[ref];
        }
        put(x, y, c);
      }
      // draw at 1 pixel a base, then scale up without smoothing
      const small = document.createElement('canvas');
      small.width = W;
      small.height = rows * rowH;
      small.getContext('2d').putImageData(img, 0, 0);
      const C = this.canvas;
      C.width = cw;
      C.height = rows * rowH * scale;
      const g = C.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(small, 0, 0, C.width, C.height);
      this.infoEl.innerHTML = `<b>${esc(d.contig.name)}:${fmt(d.start + 1)}-${fmt(d.end)}</b> · ${fmt(n)} bases · ${fmt(W)} bases a row, ${rows > 1 ? fmt(rows) + ' rows' : 'one row'} · ${scale} pixel${scale > 1 ? 's' : ''} a base${two ? ' (two rows for each row of bases: haplotype 1 above, 2 below)' : ''}${P._refFrom ? ` · the bases come from ${esc(P._refFrom)}` : ''}`;
      this.drawLegend(pal, refRgb);
      this.drawCommand();
    }
    drawLegend(pal, refRgb) {
      const sw = (c, label) => `<span class="vw-sw"><i style="background:rgb(${c.join(',')})"></i>${esc(label)}</span>`;
      const note = (t) => `<span class="vw-note">${esc(t)}</span>`;
      const m = this.data.mode;
      const bases = [sw(pal.A, 'A'), sw(pal.C, 'C'), sw(pal.G, 'G'), sw(pal.T, 'T'), sw(pal.N, 'N, or not known')];
      if (pal.fade) bases.push(sw(refRgb[17], 'soft-masked (a repeat): paler'));
      let items = [];
      if (m === 'reference') items = bases.concat(sw(refRgb[5], 'R, A or G (two bases mixed)'));
      if (m === 'genotype') items = bases.concat(sw(refRgb[5], 'A and G: heterozygous, mixed'), sw(pal.gap, 'deleted from both copies'));
      if (m === 'haplotypes') items = bases.concat(sw(pal.gap, 'deleted (no base)'), note('haplotype 1 above haplotype 2, in each pair of rows'));
      if (m === 'variants') items = [sw(VAR.het, 'heterozygous'), sw(VAR.hom, 'homozygous'), sw(VAR.del, 'deletion'), sw(VAR.ins, 'insertion after the base'), sw(VAR.nocall, 'no call'), sw(VAR.complex, 'complex'), sw(refRgb.map((c) => c.map((v) => Math.floor(v + (255 - v) * 0.8)))[1], 'the reference, faded')];
      if (m === 'flags') items = [sw([200, 210, 235], 'phased'), sw([120, 150, 200], 'a VCF record (variant site)'), sw([60, 110, 220], 'a phased variant site'), sw([0, 160, 80], 'an insertion follows'), sw([220, 30, 30], 'filtered (not PASS)'), sw([250, 250, 250], 'nothing')];
      if (m === 'gq' || m === 'dp') items = [sw([255, 255, 255], '0'), sw([40, 95, 215], m === 'gq' ? '99 or more' : '60 or more'), sw(MISSING, 'missing (255)')];
      if (m === 'ps') items = [sw([255, 255, 255], 'no phase set'), note('each phase set has a colour of its own')];
      this.legendEl.innerHTML = items.join('');
    }
    drawCommand() {
      const d = this.data;
      const rel = this.fs.pretty(this.state.path);
      const q = (s) => (/^[\w~@%+=:,./-]+$/.test(s) ? s : "'" + String(s).replace(/'/g, "'\\''") + "'");
      const mode = { reference: 'reference', genotype: 'genotype', haplotypes: 'haplotypes', variants: 'variants' }[d.mode];
      const name = rel.split('/').pop().replace(/\.gpxil(\.tiff?)?$/i, '');
      this.cmdEl.innerHTML = '';
      let pre;
      if (mode) {
        const pal = this.state.palette && this.state.palette !== 'classic' ? ` --palette ${this.state.palette}` : '';
        const ref = this.data.planes._refFrom && this.refFile ? ` --reference ${q(this.fs.pretty(this.refPath || ''))}` : '';
        const cmd = `gpxil render ${q(rel)} ${d.contig.name}:${d.start + 1}-${d.end} -o ~/results/${name}_${d.contig.name}_${d.start + 1}-${d.end}_${mode}.png --mode ${mode}${pal} --width ${d.W}${d.scale > 1 ? ' --scale ' + d.scale : ''}${ref}`;
        pre = h('pre.code', { 'data-run': 'term' }, h('code', cmd));
        this.cmdEl.append(h('p.vw-note', 'The same picture as a file, from the terminal (gpxil render):'), pre);
      } else {
        const path = this.state.path;
        const code = `from gpxiltools import GpxilFile\n\nwith GpxilFile(${JSON.stringify(path)}) as g:\n    ${d.mode} = g[${JSON.stringify(d.contig.name)}].read(${JSON.stringify(d.mode)}, ${d.start}, ${d.end})\nprint(${d.mode}[:40])`;
        pre = h('pre.code', { 'data-run': 'py' }, h('code', code));
        this.cmdEl.append(h('p.vw-note', `These values in Python, as a NumPy array (${d.mode === 'ps' ? '32-bit' : '8-bit'} numbers):`), pre);
      }
      const save = h('button.btn.small', { type: 'button', html: MG.icon('download') + '<span>Save the picture</span>', title: 'Save what is shown as a PNG in ~/results' });
      save.addEventListener('click', () => this.savePicture(name));
      this.cmdEl.append(h('p', save));
      if (MG.app.decorateCode) MG.app.decorateCode(pre);
    }
    savePicture(name) {
      const d = this.data;
      this.canvas.toBlob((blob) => {
        if (!blob) return;
        const dest = `${MG.app.HOME}/results/${name}_${d.contig.name}_${d.start + 1}-${d.end}_${d.mode}.png`;
        this.fs.mkdirp(MG.app.HOME + '/results');
        this.fs.put(dest, { kind: 'blob', blob, size: blob.size, mtime: Date.now(), fresh: true });
        toast(`Saved <b>${esc(this.fs.pretty(dest))}</b>`, 'ok');
      }, 'image/png');
    }
    posAt(e) {
      const d = this.data;
      if (!d) return null;
      const r = this.canvas.getBoundingClientRect();
      const sx = this.canvas.width / r.width, sy = this.canvas.height / r.height;
      const x = Math.floor(((e.clientX - r.left) * sx) / d.scale);
      const rowH = d.mode === 'haplotypes' ? 2 : 1;
      const yy = Math.floor(((e.clientY - r.top) * sy) / d.scale);
      const y = Math.floor(yy / rowH);
      if (x < 0 || x >= d.W) return null;
      const i = y * d.W + x;
      return i >= 0 && i < d.end - d.start ? d.start + i : null;
    }
    hover(e) {
      const pos = this.posAt(e);
      const d = this.data;
      if (pos == null || !d) return;
      const i = pos - d.start;
      const P = d.planes;
      const got = {};
      for (const p of ['ref', 'gt', 'flags', 'gq', 'dp', 'ps']) if (P[p]) got[p] = P[p][i];
      const missing = ['ref', 'gt', 'flags', 'gq', 'dp', 'ps'].filter((p) => !(p in got) && p in d.contig.pages);
      this.say(d, pos, got);
      if (!missing.length) return;
      // (a big region: the planes not drawn are read for this base alone, and said when they come)
      const token = (this._hover = (this._hover || 0) + 1);
      Promise.all(missing.map((p) => this.file.read(d.contig, p, pos, pos + 1).then((v) => (got[p] = v[0]))))
        .then(() => token === this._hover && this.data === d && this.say(d, pos, got))
        .catch(() => {});
    }
    /** what the file holds at a base: {plane: value} */
    say(d, pos, v) {
      const parts = [`<b>${esc(d.contig.name)}:${fmt(pos + 1)}</b>`];
      if (v.ref != null) parts.push(`reference <b>${esc(R().base(v.ref))}</b>${v.ref & 16 ? ' (soft-masked)' : ''}`);
      if (v.gt != null) parts.push(`haplotype 1 <b>${R().state(v.gt >> 4)}</b>, haplotype 2 <b>${R().state(v.gt & 15)}</b> <span class="muted">(gt ${v.gt})</span>`);
      if (v.flags != null) {
        const f = R().flags(v.flags);
        if (f.length) parts.push('flags ' + f.join(', '));
      }
      if (v.gq != null) parts.push('GQ ' + (v.gq === 255 ? 'missing' : v.gq));
      if (v.dp != null) parts.push('DP ' + (v.dp === 255 ? 'missing' : v.dp));
      if (v.ps) parts.push('phase set ' + v.ps);
      this.hoverEl.innerHTML = parts.join(' · ');
    }
  }

  MG.ViewerTab = ViewerTab;
  MG.parseRegion = parseRegion;
})();
