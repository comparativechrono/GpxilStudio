/* =====================================================================
   The Viewer tab: a gpxil file's planes, as pixels.

   Pick a file (yours, an example, or a chromosome of the GRCh38
   reference, read from the web), a region and what to show: the
   reference's bases, the sample's genotype, its two haplotypes, its
   variants, or the flags, quality, depth and phase-set planes. Pointing
   at a pixel says what the file holds there. Only the strips shown are
   read (gpxil-read.js), so a whole genome opens at once. A window (a
   contig that holds a stretch of a chromosome, gpxil 0.3) is shown at
   the chromosome's positions, and what is in view can be saved as one.

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
     how far a soft-masked base is faded towards white. N is a colour unlike any base or mixture: near-black in the
     classic and Okabe–Ito colours, since their mixtures include greys (the mean of classic C and T is mid-grey) */
  const PALETTES = {
    classic: { label: 'classic: A red, C blue, G green, T yellow', A: [255, 0, 0], C: [0, 0, 255], G: [0, 255, 0], T: [255, 255, 0], N: [32, 32, 32], gap: [255, 255, 255], mix: 'mean', fade: 0.45 },
    'okabe-ito': { label: 'Okabe–Ito: safe for colour-blind readers', A: [0, 158, 115], C: [0, 114, 178], G: [230, 159, 0], T: [213, 94, 0], N: [32, 32, 32], gap: [255, 255, 255], mix: 'mean', fade: 0.45 },
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
  /** a view's planes: a built-in one's, or an annotation plane's (x:x-repeats: the plane x-repeats, gpxil annotate) */
  const modeOf = (m) => MODE[m] || (/^x:x-/.test(m) ? { label: 'Annotation ' + m.slice(2), planes: [m.slice(2)] } : MODE.reference);
  const isAnnotation = (m) => /^x:x-/.test(m || '');
  /** the planes said for a base: the standard ones, then the annotation planes */
  const planesOf = (contig) => ['ref', 'gt', 'flags', 'gq', 'dp', 'ps', ...Object.keys(contig.pages).filter((p) => /^x-/.test(p)).sort()];

  /* ---------------- annotation planes (gpxil annotate): what a value means, and its colour ---------------- */
  // (the categorical palette of the studio's charts; a repeat class keeps its hue, its families lighter or darker)
  const HUES = [[42, 120, 214], [235, 104, 52], [27, 175, 122], [237, 161, 0], [232, 123, 164], [0, 131, 0], [98, 80, 214], [227, 73, 72]];
  const CLASS_HUE = { SINE: 7, LINE: 0, LTR: 2, DNA: 3, Simple_repeat: 6, Low_complexity: 4, Satellite: 5 };
  // (the commonest families of the human genome in the class's own hue, or a shade of it given here; the rest a shade
  // of it chosen by their name)
  const FAMILY_SHADE = { 'SINE/Alu': 0, 'SINE/MIR': -0.35, 'LINE/L1': 0, 'LINE/L2': -0.35, 'LINE/CR1': 0.35, 'LTR/ERVL-MaLR': 0, 'LTR/ERV1': -0.35, 'LTR/ERVL': 0.35, 'LTR/ERVK': -0.55, 'DNA/hAT-Charlie': 0, 'DNA/TcMar-Tigger': -0.35, 'Satellite/centr': 0 };
  const SHADES = [0.2, -0.2, 0.45, -0.45, 0.3, -0.3, 0.55, -0.1];
  const shade = (c, t) => c.map((v) => Math.round(t >= 0 ? v + (255 - v) * t : v * (1 + t)));
  const hashOf = (s) => {
    let x = 2166136261;
    for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619) >>> 0;
    return x;
  };
  /** how to read and colour an annotation plane: {kind, describe(value) → text, colour(value) → [r, g, b] or null
      (no feature: paper), legend(values seen) → [[colour, text]]}; float planes are scaled to the values in view */
  function annotationOf(meta, plane, values) {
    const info = ((meta && meta.planes) || {})[plane] || {};
    const labels = info.labels || null;
    const float = values instanceof Float32Array || info.dtype === 'float32';
    const kind = info.kind || (labels ? 'category' : float ? 'value' : 'presence');
    if (float) {
      let lo = Infinity, hi = -Infinity;
      for (const x of values || []) if (Number.isFinite(x)) (lo = Math.min(lo, x)), (hi = Math.max(hi, x));
      const A = [205, 226, 251], B = [13, 54, 107];
      const colour = (x) => {
        if (!Number.isFinite(x)) return null;
        const t = hi > lo ? (x - lo) / (hi - lo) : 1;
        return A.map((a, i) => Math.round(a + (B[i] - a) * t));
      };
      const num = (x) => (Math.abs(x) >= 1000 ? Math.round(x).toLocaleString('en-GB') : String(Number(x.toPrecision(4))));
      return {
        kind,
        describe: (x) => (Number.isFinite(x) ? `${num(x)}${info.units ? ' ' + info.units : ''}` : 'none (NaN)'),
        colour,
        legend: () => (lo <= hi ? [[colour(lo), `${num(lo)} (the lowest in view)`], [colour((lo + hi) / 2), num((lo + hi) / 2)], [colour(hi), `${num(hi)} (the highest)`]] : [])
      };
    }
    // (categories: a colour for each label, by the class before its first /, so a repeat class keeps its hue)
    const cache = new Map();
    const labelOf = (x) => (x === 0 ? '' : labels ? labels[String(x)] || `value ${x}` : kind === 'presence' ? 'a feature' : `value ${x}`);
    const colour = (x) => {
      if (!x) return null;
      if (cache.has(x)) return cache.get(x);
      const label = labelOf(x);
      // (a repeat class, SINE, in its hue; its families, SINE/Alu, and names, SINE/Alu/AluY, lighter or darker)
      const cls = label.split('/')[0];
      const hue = HUES[CLASS_HUE[cls] != null ? CLASS_HUE[cls] : hashOf(cls) % HUES.length];
      const t = label === cls && CLASS_HUE[cls] != null ? 0 : FAMILY_SHADE[label] != null ? FAMILY_SHADE[label] : SHADES[hashOf(label) % SHADES.length];
      const c = kind === 'presence' ? HUES[0] : shade(hue, t);
      cache.set(x, c);
      return c;
    };
    return {
      kind,
      describe: (x) => (x ? labelOf(x) : 'none'),
      colour,
      legend: (seen) => {
        const items = [...seen.entries()].filter(([x]) => x).sort((a, b) => b[1] - a[1]);
        const out = items.slice(0, 14).map(([x, n]) => [colour(x), `${labelOf(x)} (${fmt(n)} base${n === 1 ? '' : 's'})`]);
        if (items.length > 14) out.push([null, `and ${items.length - 14} more`]);
        return out;
      }
    };
  }
  const fmt = (n) => Math.round(n).toLocaleString('en-GB');
  /** [s, e) of a contig as the region it is of its chromosome, as gpxil reads one: chr17:7661779-7687546 */
  const place = (c, s, e) => `${c.parent}:${c.start + s + 1}-${c.start + e}`;

  /** chr17:7,661,779-7,687,546 → {contig, start (0-based), end}; chr17:7,661,779 → one base; chr17 → whole contig
      (end null). The name ends at the last colon, so a window's name (chr17:7561779-7787546) is one too */
  function parseRegion(text) {
    const r = R().reader.parseRegion(text);
    if (!r) return null;
    return { contig: r.name, start: r.start === undefined ? 0 : r.start, end: r.end === undefined ? null : r.end };
  }

  /* the colour of each ref code (0–31) for a palette, as gpxiltools.palettes.ref_colours works it out: one base its
     colour; two or three (an IUPAC code such as R, A or G) the mix of theirs; N and the gap their own; a soft-masked
     base faded towards white, but not N or the gap */
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
      out[code | 16] = code && code !== 15 && pal.fade ? c.map((v) => pyRound(v + (255 - v) * pal.fade)) : c;
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
      this.countsEl = h('div.vw-counts', { 'aria-live': 'polite' });
      this.cmdEl = h('div.vw-cmd');
      this.emptyEl = h('div.vw-empty');
      R0.append(this.bar, this.infoEl, this.emptyEl, this.stage, this.hoverEl, this.legendEl, this.countsEl, this.cmdEl);

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
      // (the first time: HG002's chromosome 17 with all its planes, not the copies of his and his parents' without the
      // reference plane, which come first in the list)
      const want = (this.state.path && this.fs.exists(this.state.path) && this.state.path) || list.find((f) => f === '/data/examples/HG002_chr17.gpxil.tif') || list.find((f) => /HG002/.test(f)) || list[0];
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
      this.countsEl.innerHTML = '';
      this._countKey = null;
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
      for (const c of g.contigs.slice(0, 500))
        this.contigSel.appendChild(h('option', { value: c.name }, c.window ? `${c.parent} ${fmt(c.start + 1)}–${fmt(c.end)} (a window, ${fmt(c.length)} bp)` : `${c.name} (${fmt(c.length)} bp)`));
      const hasGt = g.contigs.some((c) => 'gt' in c.pages);
      const planes = new Set(g.contigs.flatMap((c) => Object.keys(c.pages)));
      this.modeSel.innerHTML = '';
      for (const [k, label, need] of MODES) {
        const ok = need.every((p) => planes.has(p) || (p === 'ref' && this.canBorrowRef()));
        if (ok) this.modeSel.appendChild(h('option', { value: k }, label));
      }
      // (annotation planes, x-…, as gpxil annotate makes them: each a view of its own)
      for (const p of [...planes].filter((x) => /^x-/.test(x)).sort()) {
        const info = ((g.meta && g.meta.planes) || {})[p] || {};
        const what = { category: 'labels', presence: 'where features are', score: 'scores', value: 'values' }[info.kind] || '';
        this.modeSel.appendChild(h('option', { value: 'x:' + p }, `Annotation: ${p}${what ? ` (${what})` : ''}`));
      }
      const asked = opts.plane && (/^x-/.test(opts.plane) ? 'x:' + opts.plane : { ref: 'reference', gt: 'genotype', flags: 'flags', gq: 'gq', dp: 'dp', ps: 'ps' }[opts.plane]);
      const mode = opts.mode || asked || (hasGt ? 'variants' : 'reference');
      this.state.mode = [...this.modeSel.options].some((o) => o.value === mode) ? mode : this.modeSel.options[0] && this.modeSel.options[0].value;
      this.modeSel.value = this.state.mode;
      let region = opts.region || null;
      if (!region) {
        // TP53 on chromosome 17, if the file holds it (the examples are about it), else the middle of the first contig
        let tp53 = null;
        try {
          tp53 = g.locate('chr17', 7661778, 7687546);
        } catch (e) {}
        const first = g.contigs[0];
        const mid = Math.floor(first.length / 2);
        region = tp53 ? { contig: tp53.contig.name, start: tp53.start, end: tp53.end } : { contig: first.name, start: Math.max(0, mid - 50000), end: Math.min(first.length, mid + 50000) };
      }
      await this.goto(region);
    }
    /** a file without its reference plane, on GRCh38: the reference is read from the Gpxil browser */
    canBorrowRef() {
      const ref = (this.file && this.file.meta.reference) || {};
      return /grch38/i.test(ref.name || '') && (MG.app.referenceFiles || []).length > 0;
    }
    /** the GRCh38 file with the reference of a contig (of a window, its parent's), checked against the digests the
        file gives; read where the contig's bases are (readRef) */
    async refFor(contig) {
      if (!this.canBorrowRef()) return null;
      const name = contig.parent;
      const f = (MG.app.referenceFiles || []).find((x) => (x.contigs || []).includes(name) || (x.contigs || []).includes('chr' + name));
      if (!f) return null;
      if (!this.refFile || this.refFile._url !== f.url) {
        this.refFile = await R().open(R().urlSource(f.url, f.size));
        this.refFile._url = f.url;
      }
      const rc = this.refFile.contig(name);
      const mine = contig.window || contig.entry || {};
      const theirs = (rc && rc.entry) || {};
      if (!rc || (rc.length !== (contig.parentLength || rc.length)) || (mine.md5 && theirs.md5 && mine.md5 !== theirs.md5))
        throw new Error(`${name} of GRCh38 isn’t the reference this file was made on`);
      this.refPath = f.path;
      return this.refFile;
    }
    /** the borrowed reference's bases over [start, end) of a contig (a window's at its parent's positions) */
    readRef(contig, start, end) {
      return this.refFile.read(contig.parent, 'ref', contig.start + start, contig.start + end);
    }

    /* ---------------- where ---------------- */
    /** where a region given as text is: a contig and its offsets. Positions are the chromosome's: on a window, its
        parent's, so chr17:7,661,779-7,687,546 is found in a window of chromosome 17 that holds it */
    where(text) {
      const g = this.file;
      const t = String(text || '').trim();
      const whole = g.contig(t);
      if (whole) return { contig: whole, start: 0, end: whole.length };
      const r = parseRegion(t);
      if (!r) throw new Error('Give a region as CONTIG or CONTIG:START-END, such as chr17:7,661,779-7,687,546');
      const c = g.contig(r.contig);
      if (c && !c.window) {
        // (a whole contig: a region past its end is cut at its end)
        const start = Math.max(0, Math.min(r.start, c.length - 1));
        return { contig: c, start, end: r.end == null ? c.length : Math.min(c.length, Math.max(start + 1, r.end)) };
      }
      try {
        const at = r.end == null && !r.start ? g.locate(r.contig) : g.locate(r.contig, r.start, r.end == null ? undefined : r.end);
        return { contig: at.contig, start: at.start, end: at.end };
      } catch (e) {
        if (e.code === 'contig') throw new Error(`${r.contig} isn’t in this file`);
        throw e;
      }
    }
    async goto(where) {
      if (!this.file) return;
      let r;
      try {
        r = typeof where === 'string' ? this.where(where) : { contig: this.file.contig(where.contig), start: where.start, end: where.end };
      } catch (e) {
        return toast(esc(e.message), 'warn');
      }
      const c = r.contig;
      if (!c) return toast(`${esc(where.contig)} isn’t in this file`, 'warn');
      let start = Math.max(0, Math.min(r.start || 0, c.length - 1));
      let end = Math.min(c.length, r.end == null ? c.length : Math.max(start + 1, r.end));
      if (end - start > MAX_BASES) {
        toast(`Showing ${fmt(MAX_BASES)} bases from ${fmt(c.start + start + 1)}: the viewer draws at most 4 Mb at a time (gpxil render draws any size)`, 'warn');
        end = start + MAX_BASES;
      }
      this.region = { contig: c, start, end };
      this.contigSel.value = c.name;
      this.regionIn.value = R().reader.regionText(c, start, end);
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
      const need = modeOf(mode).planes;
      this.infoEl.textContent = `Reading ${R().reader.regionText(contig, start, end)}…`;
      try {
        const planes = {};
        for (const p of need) {
          if (p in contig.pages) planes[p] = await this.file.read(contig, p, start, end);
          else if (p === 'ref') {
            const rf = await this.refFor(contig);
            if (!rf) throw new Error(`${contig.name} has no reference plane in this file`);
            planes.ref = await this.readRef(contig, start, end);
            planes._refFrom = 'the GRCh38 reference (Gpxil browser)';
          }
        }
        // the other planes there are, for pointing at pixels: read now for a region of up to a million bases, and for a
        // bigger one, a base at a time as it is pointed at (hover)
        if (end - start <= 1e6) for (const p of planesOf(contig)) if (!(p in planes) && p in contig.pages) planes[p] = await this.file.read(contig, p, start, end);
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
      this.state.region = place(d.contig, d.start, d.end);
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
      // (how many bases of each code are drawn, for the key: the reference's, the genotype's or the haplotypes' codes)
      const seen = new Uint32Array(256);
      // (an annotation plane: its values' colours, and how many bases of each, for its key)
      const ann = isAnnotation(d.mode) ? annotationOf(this.file.meta, d.mode.slice(2), P[d.mode.slice(2)]) : null;
      const annSeen = new Map();
      d.annotation = ann;
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
            seen[ref]++;
            break;
          case 'genotype': {
            // the IUPAC code of the bases on both haplotypes (A and G: R, their colours mixed); deleted from both: paper
            let code = hapBase(ref, h1) | hapBase(ref, h2) | soft;
            if (code === 16) code = 0;
            c = refRgb[code];
            seen[code]++;
            break;
          }
          case 'haplotypes':
            for (const [k, st] of [[0, h1], [1, h2]]) {
              const b = hapBase(ref, st);
              const code = (b !== 0 && b !== 15) || st === REF ? b | soft : b;
              put(x, y * 2 + k, refRgb[code]);
              seen[code]++;
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
            if (ann) {
              const val = P[d.mode.slice(2)][i];
              if (ann.kind !== 'value' && ann.kind !== 'score') annSeen.set(val, (annSeen.get(val) || 0) + 1);
              c = ann.colour(val) || [255, 255, 255];
            } else c = refRgb[ref];
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
      const win = d.contig.window ? ` · from the window ${esc(d.contig.name)}, which holds ${esc(R().reader.regionText(d.contig))}` : '';
      this.infoEl.innerHTML = `<b>${esc(R().reader.regionText(d.contig, d.start, d.end))}</b>${win} · ${fmt(n)} bases · ${fmt(W)} bases a row, ${rows > 1 ? fmt(rows) + ' rows' : 'one row'} · ${scale} pixel${scale > 1 ? 's' : ''} a base${two ? ' (two rows for each row of bases: haplotype 1 above, 2 below)' : ''}${P._refFrom ? ` · the bases come from ${esc(P._refFrom)}` : ''}`;
      this.drawLegend(pal, refRgb, seen, ann ? ann.legend(annSeen) : null);
      this.drawCommand();
      this.countView();
    }
    /* ---------------- the counts of the region in view: gpxil stats, made in the page (gpxil-stats.js) ---------------- */
    async countView() {
      const d = this.data;
      if (!d || !MG.gpxilStats) return;
      const key = `${this.state.path}|${d.contig.name}|${d.start}|${d.end}`;
      if (this._countKey === key) return; // (the same bases: only the colours or the layout changed)
      this._countKey = key;
      const token = (this._countToken = (this._countToken || 0) + 1);
      this.countsEl.innerHTML = '<p class="vw-note">Counting what this region holds…</p>';
      const c = d.contig, f = this.file, P = d.planes;
      try {
        const get = async (p) => (P[p] && P[p].length === d.end - d.start ? P[p] : p in c.pages ? f.read(c, p, d.start, d.end) : null);
        const gt = await get('gt');
        let ref = 'ref' in c.pages ? await get('ref') : null;
        let refPath = null;
        if (!ref && (await this.refFor(c))) {
          ref = P.ref && P._refFrom && P.ref.length === d.end - d.start ? P.ref : await this.readRef(c, d.start, d.end);
          refPath = this.refPath;
        }
        const [flags, gq, dp, ps] = await Promise.all(['flags', 'gq', 'dp', 'ps'].map(get));
        const sidecar = gt ? await f.sidecar(c) : [];
        const before = gt && d.start > 0 ? (await f.read(c, 'gt', d.start - 1, d.start))[0] : null;
        const counts = await MG.gpxilStats.count({ length: c.length, start: d.start, end: d.end, ref, gt, flags, gq, dp, ps, sidecar, before, readGt: (a, b) => f.read(c, 'gt', a, b) });
        if (token !== this._countToken) return;
        this.counts = counts;
        this.showCounts(counts, d, refPath);
      } catch (e) {
        if (token !== this._countToken) return;
        this._countKey = null;
        this.countsEl.innerHTML = '';
        this.countsEl.appendChild(h('p.vw-note', 'The counts couldn’t be made: ' + e.message));
      }
    }
    showCounts(counts, d, refPath) {
      const n = counts.bases;
      const pct = (x) => (n ? `${((100 * x) / n).toFixed(1)}\u00a0%` : '–'); // (a space that doesn't break)
      const parts = [];
      if (counts.calls) {
        const s = counts.substitutions, ins = counts.insertions, del = counts.deletions;
        const nIns = ins.heterozygous + ins.homozygous, nDel = del.heterozygous + del.homozygous;
        parts.push(`${pct(counts.calls.called)} called`);
        parts.push(`${fmt(s.heterozygous)} heterozygous and ${fmt(s.homozygous)} homozygous substitution${s.homozygous === 1 ? '' : 's'}${s.ti_tv ? ` (Ti/Tv ${s.ti_tv.toFixed(2)})` : ''}`);
        parts.push(`${fmt(nIns)} insertion${nIns === 1 ? '' : 's'}, ${fmt(nDel)} deletion${nDel === 1 ? '' : 's'}`);
        if (counts.phasing.phase_sets) parts.push(`${((100 * counts.phasing.heterozygous_substitutions_phased) / Math.max(1, s.heterozygous)).toFixed(0)}\u00a0% of heterozygous substitutions phased`);
      }
      const r = counts.reference;
      if (r) parts.push(`GC ${r.gc == null ? '–' : (100 * r.gc).toFixed(1) + '\u00a0%'}${r.N ? `, ${pct(r.N)} N` : ''}`);
      this.countsEl.innerHTML = '';
      const line = h('p.vw-countline', h('b', `In view, ${fmt(n)} bases: `), parts.join(' · '));
      const more = h('details.vw-countmore', h('summary', 'All the counts'));
      const t = h('table.tl-condtable.tl-stats');
      for (const [k, v] of MG.app.statsRows ? MG.app.statsRows(counts) : []) t.appendChild(h('tr', h('th', { scope: 'row' }, k), h('td', v)));
      more.appendChild(h('div.table-scroll', t));
      const q = (x) => (/^[\w~@%+=:,./-]+$/.test(x) ? x : "'" + String(x).replace(/'/g, "'\\''") + "'");
      const cmd = `gpxil stats ${q(this.fs.pretty(this.state.path))} ${place(d.contig, d.start, d.end)}${refPath ? ' --reference ' + q(this.fs.pretty(refPath)) : ''}`;
      const pre = h('pre.code', { 'data-run': 'term' }, h('code', cmd));
      more.append(h('p.vw-note', 'The same counts from the terminal (gpxil stats), or for any region or the whole file in the Tools tab:'), pre);
      this.countsEl.append(line, more);
      if (MG.app.decorateCode) MG.app.decorateCode(pre);
    }
    /** the key under the picture. For the reference, genotype and haplotypes views it lists the colours in view
        (seen: how many bases of each code were drawn): each base, each heterozygous pair present with how many bases
        have it, N and deleted bases. The other views have a fixed key of their classes. */
    drawLegend(pal, refRgb, seen, annotation) {
      const sw = (c, label) => `<span class="vw-sw"><i style="background:rgb(${c.join(',')})"></i>${esc(label)}</span>`;
      const note = (t) => `<span class="vw-note">${esc(t)}</span>`;
      const m = this.data.mode;
      let items = [];
      if (annotation) {
        items = annotation.map(([c, label]) => (c ? sw(c, label) : note(label)));
        items.push(sw([255, 255, 255], 'no feature'));
        const info = ((this.file.meta && this.file.meta.planes) || {})[m.slice(2)] || {};
        if (info.description) items.push(note(info.description));
        this.legendEl.innerHTML = items.join('');
        return;
      }
      if (m === 'reference' || m === 'genotype' || m === 'haplotypes') {
        const count = new Array(16).fill(0);
        let soft = 0;
        for (let k = 0; k < 32; k++) {
          if (!seen || !seen[k]) continue;
          count[k & 15] += seen[k];
          if (k & 16 && (k & 15) !== 0 && (k & 15) !== 15) soft += seen[k]; // (N and no base are never paler)
        }
        const NAME = { 1: 'A', 2: 'C', 4: 'G', 8: 'T' };
        const basesOf = (code) => [1, 2, 4, 8].filter((b) => code & b).map((b) => NAME[b]);
        const list = (xs, word) => (xs.length === 2 ? `${xs[0]} ${word} ${xs[1]}` : `${xs.slice(0, -1).join(', ')} ${word} ${xs[xs.length - 1]}`);
        const times = (k) => `${fmt(count[k])} base${count[k] === 1 ? '' : 's'}`;
        // (gpxil render's order: the bases, the pairs, the threes, N, then no base)
        for (const k of [1, 2, 4, 8, 3, 5, 9, 6, 10, 12, 7, 11, 13, 14, 15, 0]) {
          if (!count[k]) continue;
          const xs = basesOf(k);
          let label;
          if (k === 15) label = m === 'reference' ? 'N: not known (a gap in the assembly)' : 'N, or not known';
          else if (k === 0) label = m === 'genotype' ? 'deleted from both copies' : m === 'haplotypes' ? 'deleted (no base)' : 'no base';
          else if (xs.length === 1) label = xs[0];
          else if (m === 'genotype' && xs.length === 2) label = `${list(xs, 'and')}: heterozygous, the two colours mixed (${times(k)})`;
          else label = `${'-ACMGRSVTWYHKDBN'[k]}: ${list(xs, 'or')}, an ambiguity code of the reference (${times(k)})`;
          items.push(sw(refRgb[k], label));
        }
        if (soft && pal.fade) items.push(sw(refRgb[17], 'soft-masked (a repeat): paler'));
        if (m === 'genotype' && ![3, 5, 9, 6, 10, 12].some((k) => count[k])) items.push(note('no heterozygous bases in view: a heterozygous base would be drawn in its two bases’ colours, mixed'));
        if (m === 'haplotypes') items.push(note('haplotype 1 above haplotype 2, in each pair of rows'));
      }
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
      const c = d.contig;
      const where = place(c, d.start, d.end);
      const slug = `${c.parent}_${c.start + d.start + 1}-${c.start + d.end}`;
      this.cmdEl.innerHTML = '';
      let pre;
      if (mode) {
        const pal = this.state.palette && this.state.palette !== 'classic' ? ` --palette ${this.state.palette}` : '';
        const ref = this.data.planes._refFrom && this.refFile ? ` --reference ${q(this.fs.pretty(this.refPath || ''))}` : '';
        const cmd = `gpxil render ${q(rel)} ${where} -o ~/results/${name}_${slug}_${mode}.png --mode ${mode}${pal} --width ${d.W}${d.scale > 1 ? ' --scale ' + d.scale : ''}${ref}`;
        pre = h('pre.code', { 'data-run': 'term' }, h('code', cmd));
        this.cmdEl.append(h('p.vw-note', 'The same picture as a file, from the terminal (gpxil render):'), pre);
      } else {
        const path = this.state.path;
        const plane = isAnnotation(d.mode) ? d.mode.slice(2) : d.mode;
        const name = isAnnotation(d.mode) ? 'values' : d.mode;
        const labels = isAnnotation(d.mode) && ((this.file.meta.planes || {})[plane] || {}).labels ? `\nlabels = g.metadata["planes"][${JSON.stringify(plane)}]["labels"]   # value -> label` : '';
        // (located as gpxil finds a region: on a window, by the chromosome's positions, at the window's own offsets)
        const code = c.window
          ? `from gpxiltools import GpxilFile\n\nwith GpxilFile(${JSON.stringify(path)}) as g:\n    c, s, e = g.locate(${JSON.stringify(c.parent)}, ${c.start + d.start}, ${c.start + d.end})   # the window, and where in it\n    ${name} = c.read(${JSON.stringify(plane)}, s, e)${labels.replace('\n', '\n    ')}\nprint(${name}[:40])`
          : `from gpxiltools import GpxilFile\n\nwith GpxilFile(${JSON.stringify(path)}) as g:\n    ${name} = g[${JSON.stringify(c.name)}].read(${JSON.stringify(plane)}, ${d.start}, ${d.end})${labels.replace('\n', '\n    ')}\nprint(${name}[:40])`;
        pre = h('pre.code', { 'data-run': 'py' }, h('code', code));
        const dtype = (((this.file.meta || {}).planes || {})[plane] || {}).dtype;
        const bits = d.mode === 'ps' ? '32-bit' : dtype === 'float32' ? '32-bit floating-point' : dtype === 'uint16' ? '16-bit' : dtype === 'uint32' ? '32-bit' : '8-bit';
        this.cmdEl.append(h('p.vw-note', `These values in Python, as a NumPy array (${bits} numbers):`), pre);
      }
      const save = h('button.btn.small', { type: 'button', html: MG.icon('download') + '<span>Save the picture</span>', title: 'Save what is shown as a PNG in ~/results' });
      save.addEventListener('click', () => this.savePicture(name));
      const keep = h('button.btn.small.vw-keep', {
        type: 'button',
        html: MG.icon('grid') + '<span>Save this region as a gpxil file</span>',
        title: 'A window of the file: the bases in view, every plane, at the chromosome’s positions (gpxil subset)'
      });
      const kept = h('span.vw-kept', { 'aria-live': 'polite' });
      keep.addEventListener('click', () => this.saveWindow(name, keep, kept));
      this.cmdEl.append(h('p', save, ' ', keep, ' ', kept));
      if (MG.app.decorateCode) MG.app.decorateCode(pre);
    }
    /** what is in view as a gpxil file of its own: a window (gpxil 0.3), cut out by gpxil subset in Python, or the
        whole contig if all of it is in view; said in `kept`, with a button to view it */
    async saveWindow(name, btn, kept) {
      const d = this.data;
      if (!d || !MG.app.pyCall) return;
      const c = d.contig;
      const whole = d.start === 0 && d.end === c.length;
      const region = whole ? c.name : place(c, d.start, d.end);
      const stem = name.replace(/\.noref$/, '');
      // (HG002_chr17 → HG002_chr17_7661779-7687546; a file named otherwise gets the chromosome too)
      const of = stem.endsWith('_' + c.parent) ? '' : `${c.parent}_`;
      const own = c.name.replace(/[^\w.-]+/g, '_');
      const slug = whole ? (stem.endsWith('_' + own) ? 'copy' : own) : `${of}${c.start + d.start + 1}-${c.start + d.end}`;
      const dest = `${MG.app.HOME}/genomes/${stem}_${slug}${'ref' in c.pages ? '' : '.noref'}.gpxil.tif`;
      const argv = ['gpxil', 'subset', this.state.path, region, '-o', dest];
      btn.disabled = true;
      kept.textContent = `Saving ${R().reader.regionText(c, d.start, d.end)}… (gpxil subset, in Python)`;
      try {
        const r = await MG.app.pyCall('gpxilwb.gui.run', { argv });
        if (!r.ok || !r.result || r.result.code !== 0) throw new Error(((r.result && r.result.stderr) || r.error || 'gpxil subset failed').trim().split('\n').pop());
        this.lastSaved = dest;
        const view = h('button.btn.small', { type: 'button' }, 'View it');
        view.addEventListener('click', () => this.open(dest, { mode: this.state.mode }));
        kept.innerHTML = `Saved <b>${esc(this.fs.pretty(dest))}</b>${whole ? '' : `: a window of ${esc(c.parent)}, at its positions`}. `;
        kept.append(view);
        toast(`Saved <b>${esc(this.fs.pretty(dest))}</b>`, 'ok');
      } catch (e) {
        kept.textContent = '';
        toast(`The region couldn’t be saved: ${esc(e.message)}`, 'error');
      } finally {
        btn.disabled = false;
      }
    }
    savePicture(name) {
      const d = this.data;
      this.canvas.toBlob((blob) => {
        if (!blob) return;
        const c = d.contig;
        const dest = `${MG.app.HOME}/results/${name}_${c.parent}_${c.start + d.start + 1}-${c.start + d.end}_${d.mode}.png`;
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
      const all = planesOf(d.contig);
      for (const p of all) if (P[p]) got[p] = P[p][i];
      const missing = all.filter((p) => !(p in got) && p in d.contig.pages);
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
      const parts = [`<b>${esc(d.contig.parent)}:${fmt(d.contig.start + pos + 1)}</b>`];
      if (v.ref != null) parts.push(`reference <b>${esc(R().base(v.ref))}</b>${v.ref & 16 ? ' (soft-masked)' : ''}`);
      if (v.gt != null) parts.push(`haplotype 1 <b>${R().state(v.gt >> 4)}</b>, haplotype 2 <b>${R().state(v.gt & 15)}</b> <span class="muted">(gt ${v.gt})</span>`);
      if (v.flags != null) {
        const f = R().flags(v.flags);
        if (f.length) parts.push('flags ' + f.join(', '));
      }
      if (v.gq != null) parts.push('GQ ' + (v.gq === 255 ? 'missing' : v.gq));
      if (v.dp != null) parts.push('DP ' + (v.dp === 255 ? 'missing' : v.dp));
      if (v.ps) parts.push('phase set ' + v.ps);
      for (const p of Object.keys(v).filter((x) => /^x-/.test(x))) {
        const a = d.annotation && d.mode === 'x:' + p ? d.annotation : annotationOf(this.file.meta, p, null);
        parts.push(`${esc(p)} <b>${esc(a.describe(v[p]))}</b>`);
      }
      this.hoverEl.innerHTML = parts.join(' · ');
    }
  }

  MG.ViewerTab = ViewerTab;
  MG.parseRegion = parseRegion;
})();
