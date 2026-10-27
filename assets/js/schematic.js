/* =====================================================================
   The map: the file formats (boxes) and the tools that turn one into
   another (arrows). gpxil is in the middle: a person's variants (VCF)
   and a reference genome (FASTA) go in, and pictures, books, gene and
   protein pictures (pxil), and FASTA and VCF again come out. Point at an
   arrow to see what it does; click it to open that tool, or click a box
   to see what can be done with that kind of file.

     MG.formatMap(container, { onTool(id), onFormat(kind), onHover(name), layout })
       → { highlight(name) }   name: a tool id, a package name or a kind

   It has two layouts: a wide one, and a tall one for narrow places (the
   help, a phone), in which the writing stays large enough to read. The
   map picks the one that fits its width, and changes when the width does
   (layout: 'wide' or 'tall' fixes it).

   Used on the Tools tab's first page and in the help: a help page holds
   <div class="pw-map"></div>, which is drawn the first time the page is
   shown (workbench.js announces each page with the event 'help:page').
   ===================================================================== */
(function () {
  'use strict';
  const MG = window.MG;
  const NS = 'http://www.w3.org/2000/svg';
  const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // the formats: their titles, and where each layout puts them: x, y (centre), w (width)
  const FORMATS = {
    vcf: { title: 'A person’s variants', sub: 'VCF, with a BED file' },
    fasta: { title: 'Sequences', sub: 'FASTA: a genome, a gene' },
    gpxil: { title: 'gpxil file', sub: 'a genome as pictures', main: true },
    image: { title: 'Picture', sub: 'PNG, or TIFF for print' },
    pdf: { title: 'Book', sub: 'PDF, to print' },
    pxil: { title: 'Gene pictures', sub: 'pxil (.pxil.png)' }
  };
  const PLACES = {
    wide: { vcf: [120, 90, 200], fasta: [120, 300, 200], gpxil: [450, 195, 240], image: [780, 70, 190], pdf: [780, 195, 190], pxil: [780, 320, 190] },
    tall: { vcf: [130, 40, 220], fasta: [360, 40, 200], gpxil: [250, 210, 250], image: [88, 400, 160], pdf: [250, 400, 140], pxil: [412, 400, 160] }
  };
  const VIEWBOX = { wide: '0 0 900 440', tall: '0 0 500 440' };
  // the routes, the same in both layouts and in this order (ROUTE_ENDS below goes by it):
  // [tool id, package (for highlight), label, path, label x, y, anchor, arrow, dashed, both ends]
  // (a route without a label is not a button for the keyboard, but it can still be clicked)
  const WIDE = [
    ['encode', 'gpxiltools', 'gpxil encode', 'M222 98 C270 104 300 170 329 186', 262, 199, 'middle', true],
    ['encode', 'gpxiltools', '', 'M222 292 C270 286 300 220 329 204', 0, 0, 'middle', true],
    ['vcf', 'gpxiltools', 'gpxil vcf', 'M392 169 C380 100 300 66 222 72', 318, 60, 'middle', true],
    ['fasta', 'gpxiltools', 'gpxil fasta', 'M392 221 C380 290 300 324 222 318', 318, 344, 'middle', true],
    ['pxil-fasta', 'pxil', 'pxil', 'M700 346 C640 426 300 432 160 328', 430, 418, 'middle', true, true],
    ['render', 'gpxiltools', 'gpxil render', 'M570 182 C620 160 640 84 684 74', 612, 128, 'end', true],
    ['book', 'gpxiltools', 'gpxil book', 'M572 195 L684 195', 628, 186, 'middle', true],
    ['gpxil2pxil', 'gpxil2pxil', 'gpxil2pxil', 'M570 208 C620 230 640 306 684 316', 612, 276, 'end', true],
    ['info', 'gpxiltools', 'gpxil info · validate', 'M440 221 C430 285 540 285 530 221', 485, 300, 'middle', true]
  ];
  const TALL = [
    ['encode', 'gpxiltools', 'gpxil encode', 'M160 66 C175 110 200 150 210 183', 250, 128, 'middle', true],
    ['encode', 'gpxiltools', '', 'M330 66 C320 110 300 150 290 183', 0, 0, 'middle', true],
    ['vcf', 'gpxiltools', 'gpxil vcf', 'M150 184 C120 150 100 110 100 66', 92, 140, 'end', true],
    ['fasta', 'gpxiltools', 'gpxil fasta', 'M345 184 C365 150 380 110 382 66', 394, 132, 'start', true],
    ['pxil-fasta', 'pxil', 'pxil', 'M470 374 C500 300 500 140 452 66', 484, 250, 'end', true, true],
    ['render', 'gpxiltools', 'gpxil render', 'M170 236 C140 300 100 330 92 374', 36, 312, 'start', true],
    ['book', 'gpxiltools', 'gpxil book', 'M250 236 L250 374', 256, 300, 'start', true],
    ['gpxil2pxil', 'gpxil2pxil', 'gpxil2pxil', 'M330 236 C360 300 400 330 408 374', 472, 330, 'end', true],
    ['info', 'gpxiltools', 'gpxil info\nvalidate', 'M125 202 C88 198 88 222 125 218', 82, 206, 'end', true]
  ];
  const ROUTES = { wide: WIDE, tall: TALL };
  /** the layout for a width: tall below 720 pixels, where the wide one's writing would be too small */
  const layoutFor = (width) => (width && width < 720 ? 'tall' : 'wide');

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs || {}) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function text(parent, x, y, s, cls, anchor) {
    const t = el('text', { x, y, class: cls, 'text-anchor': anchor || 'middle' }, parent);
    const lines = String(s).split('\n');
    if (lines.length === 1) t.textContent = s;
    else lines.forEach((l, i) => (el('tspan', { x, dy: i ? '1.25em' : 0, class: i ? 'pm-more' : null }, t).textContent = l));
    return t;
  }

  function formatMap(container, opts = {}) {
    container.classList.add('pw-map');
    let current = null, api = null;
    const draw = () => {
      const want = opts.layout || layoutFor(container.clientWidth);
      if (want === current) return;
      current = want;
      container.dataset.layout = want;
      if (api) api.stop();
      api = drawMap(container, opts, want);
    };
    draw();
    if (!opts.layout && 'ResizeObserver' in window) new ResizeObserver(() => draw()).observe(container);
    return { highlight: (name) => api && api.highlight(name) };
  }

  function drawMap(container, opts, layout) {
    container.innerHTML = '';
    const NODES = Object.fromEntries(Object.entries(FORMATS).map(([k, f]) => [k, Object.assign({ x: PLACES[layout][k][0], y: PLACES[layout][k][1], w: PLACES[layout][k][2] }, f)]));
    const uid = 'pm' + Math.random().toString(36).slice(2, 8);
    const svg = el('svg', { viewBox: VIEWBOX[layout], role: 'img', 'aria-labelledby': uid + 't' }, container);
    const title = el('title', { id: uid + 't' }, svg);
    title.textContent =
      'A gpxil file is in the middle. gpxil encode makes one from a reference genome (FASTA) and a person’s variants (VCF). gpxil fasta and gpxil vcf write its sequences and variants out again; gpxil render draws a region as a picture, and gpxil book prints it as a PDF; gpxil2pxil makes pictures of genes, transcripts and proteins (pxil files), which pxil turns back into FASTA. gpxil info and validate look inside a gpxil file and check it.';
    const defs = el('defs', {}, svg);
    const mk = (id, cls) => {
      const m = el('marker', { id, viewBox: '0 0 10 10', refX: 8.5, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
      el('path', { d: 'M0 0 L10 5 L0 10 z', class: cls }, m);
    };
    mk(uid + 'a', 'pm-head');
    mk(uid + 'b', 'pm-head on');
    const routesG = el('g', { class: 'pm-routes' }, svg);
    const nodesG = el('g', { class: 'pm-nodes' }, svg);
    const routes = ROUTES[layout].map(([tool, pkg, label, d, lx, ly, anchor, arrow, dashed, both], i) => {
      const g = el('g', { class: 'pm-route' + (dashed ? ' dashed' : ''), tabindex: label ? '0' : null, role: label ? 'button' : null, 'aria-label': label ? `${label}: open the tool` : null }, routesG);
      el('path', { d, class: 'pm-hit' }, g);
      const path = el('path', { d, class: 'pm-edge', 'marker-end': arrow ? `url(#${uid}a)` : null, 'marker-start': both ? `url(#${uid}a)` : null }, g);
      if (label) text(g, lx, ly, label, 'pm-label', anchor);
      const dots = reduced() ? [] : [0, 0.5].map((o) => ({ o, c: el('circle', { r: 2.6, class: 'pm-dot' }, g) }));
      const r = { tool, pkg, g, path, dots, len: 0, both, ends: ROUTE_ENDS[i] || [] };
      const go = () => opts.onTool && opts.onTool(tool);
      g.addEventListener('click', go);
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          go();
        }
      });
      g.addEventListener('pointerenter', () => set(tool));
      g.addEventListener('pointerleave', () => set(null));
      g.addEventListener('focus', () => set(tool));
      g.addEventListener('blur', () => set(null));
      return r;
    });
    const nodes = Object.entries(NODES).map(([kind, n]) => {
      const g = el('g', { class: 'pm-node' + (n.main ? ' main' : ''), tabindex: '0', role: 'button', 'aria-label': `${n.title}: what you can do with it` }, nodesG);
      el('rect', { x: n.x - n.w / 2, y: n.y - 26, width: n.w, height: 52, rx: 12 }, g);
      text(g, n.x, n.y - 3, n.title, 'pm-title');
      text(g, n.x, n.y + 16, n.sub, 'pm-sub');
      const go = () => opts.onFormat && opts.onFormat(kind);
      g.addEventListener('click', go);
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          go();
        }
      });
      g.addEventListener('pointerenter', () => set(kind));
      g.addEventListener('pointerleave', () => set(null));
      return { kind, g };
    });
    // what a route is: the tool it opens and the package it belongs to; a box lights up its routes
    const touches = (r, name) => r.tool === name || r.pkg === name || r.ends.includes(name);
    let active = null;
    function set(name) {
      active = name;
      routes.forEach((r) => {
        const on = !!name && touches(r, name);
        r.g.classList.toggle('on', on);
        r.g.classList.toggle('off', !!name && !on);
        r.path.setAttribute('marker-end', r.path.getAttribute('marker-end') ? `url(#${uid}${on ? 'b' : 'a'})` : null);
        if (r.both) r.path.setAttribute('marker-start', `url(#${uid}${on ? 'b' : 'a'})`);
      });
      nodes.forEach((n) => n.g.classList.toggle('on', n.kind === name));
      if (opts.onHover) opts.onHover(name);
    }
    // moving dots along the routes, while the map is in view
    let t = 0, last = 0, raf = 0, visible = false;
    const frame = (now) => {
      raf = 0;
      if (!visible) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      t += dt;
      routes.forEach((r) => {
        if (!r.dots.length) return;
        if (!r.len) r.len = r.path.getTotalLength();
        const speed = 46 * (active && touches(r, active) ? 2.2 : 1);
        r.dots.forEach((d) => {
          const f = ((t * speed) / Math.max(80, r.len) + d.o) % 1;
          const pt = r.path.getPointAtLength(f * r.len);
          d.c.setAttribute('cx', pt.x.toFixed(1));
          d.c.setAttribute('cy', pt.y.toFixed(1));
        });
      });
      raf = requestAnimationFrame(frame);
    };
    let io = null;
    if (!reduced() && 'IntersectionObserver' in window) {
      io = new IntersectionObserver((es) => {
        visible = es.some((e) => e.isIntersecting);
        last = 0;
        if (visible && !raf) raf = requestAnimationFrame(frame);
      });
      io.observe(container);
    }
    // (when the map is drawn again in the other layout, this one stops)
    const stop = () => {
      visible = false;
      if (io) io.disconnect();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    return { highlight: set, stop };
  }
  // which formats each route joins (a box lights up the routes that start or end at it)
  const ROUTE_ENDS = [
    ['vcf', 'gpxil'],
    ['fasta', 'gpxil'],
    ['gpxil', 'vcf'],
    ['gpxil', 'fasta'],
    ['pxil', 'fasta'],
    ['gpxil', 'image'],
    ['gpxil', 'pdf'],
    ['gpxil', 'pxil'],
    ['gpxil']
  ];

  /** the maps in help pages (<div class="pw-map"></div>), drawn the first time their page is shown */
  formatMap.mountAll = (root) => {
    (root || document).querySelectorAll('div.pw-map:not([data-drawn])').forEach((d) => {
      d.dataset.drawn = '1';
      formatMap(d, {
        onTool: (id) => MG.app.useTool && MG.app.useTool(id),
        onFormat: (kind) => MG.app.useTool && MG.app.useTool('start', { kind })
      });
    });
  };
  MG.formatMap = formatMap;
  if (MG.bus) MG.bus.on('help:page', ({ id }) => formatMap.mountAll(document.getElementById(id)));
})();
