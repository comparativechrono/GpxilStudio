/* =====================================================================
   GpxilStudio's set-up: the file system (your files, kept in the
   browser; the read-only examples; the GRCh38 reference, read from the
   Gpxil browser over the web), the terminal, the notebooks, and the
   other tabs – each built the first time it is shown.
   Also: what kind of file a file is (MG.app.fileKind), opening a file in
   the right tab, and the buttons the Files tab shows for each kind
   (MG.app.fileActions).
   ===================================================================== */
(function () {
  'use strict';
  const MG = window.MG;
  const { h, esc, toast, store } = MG;
  const CFG = MG.config;
  MG.app = MG.app || {};
  MG.page = MG.page || {};
  MG.actions = MG.actions || {};

  const HOME = '/home/user';
  MG.app.HOME = HOME;
  MG.app.PROJECT = HOME;
  const abs = (u) => new URL(u, location.href).href;
  const EX_TIME = Date.parse('2026-10-27T09:00:00Z');

  /* the example data: the list is written into the page by build/make_page.py (window.WB_EXAMPLES) */
  const EXAMPLES = (window.WB_EXAMPLES || []).map((f) => ({ path: '/data/examples/' + f.p, url: abs('data/examples/' + f.p), size: f.s, mtime: EX_TIME }));
  MG.app.exampleFiles = EXAMPLES;
  /* the GRCh38 reference, one gpxil file per chromosome, on the Gpxil browser (window.WB_REFERENCE): Python and the
     viewer read them over the web, a strip at a time */
  const REF = window.WB_REFERENCE || { files: [] };
  const REF_BASE = new URL(CFG.referenceBase || REF.base || './', typeof location === 'object' && location.href ? location.href : 'https://comparativechrono.github.io/GpxilStudio/').href;
  const REF_DIR = '/data/grch38';
  const REFERENCE = (REF.files || []).map((f) => ({ path: REF_DIR + '/' + f.p, url: new URL(f.u, REF_BASE).href, size: f.s, contigs: f.contigs, mtime: EX_TIME }));
  MG.app.referenceFiles = REFERENCE;
  MG.app.referenceBase = REF_BASE;
  MG.app.REF_DIR = REF_DIR;
  /* the notebooks a new user finds in ~/notebooks (data/starter/*.ipynb) */
  const STARTERS = window.WB_STARTERS || [];
  /* the folders of a new user's home */
  const FOLDERS = ['genomes', 'results', 'notebooks'];

  /** a notebook to start from (data/starter) → ~/notebooks; false if it couldn't be fetched (offline, or a
      connection that stalls, which mustn't hold up the page for long) */
  async function addStarter(fs, rel) {
    const stop = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = stop && setTimeout(() => stop.abort(), 15000);
    try {
      const r = await fetch(abs('data/starter/' + rel.split('/').pop()), stop ? { signal: stop.signal } : {});
      if (!r.ok) return false;
      const text = await r.text();
      fs.mkdirp(MG.path.dirname(HOME + '/' + rel));
      fs.writeText(HOME + '/' + rel, text);
      return true;
    } catch (e) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async function setupFs() {
    const fs = new MG.VFS(HOME);
    fs.mkdirp('/data/examples');
    for (const f of EXAMPLES) {
      fs.mkdirp(MG.path.dirname(f.path));
      fs.put(f.path, { kind: 'url', url: f.url, size: f.size, protected: true, readonly: true, mtime: f.mtime });
    }
    if (REFERENCE.length) {
      fs.mkdirp(REF_DIR);
      for (const f of REFERENCE) fs.put(f.path, { kind: 'url', url: f.url, size: f.size, protected: true, readonly: true, remote: true, mtime: f.mtime });
    }
    for (const [p, e] of fs.entries) if (e.kind === 'dir' && (p === '/data' || p.startsWith('/data/'))) e.protected = true;
    await MG.project.restore(fs, [HOME]);
    fs.cwd = HOME;
    // keep every change from here on, the first visit's folders and notebooks among them
    MG.project.watch(fs);
    // the first visit: folders, and notebooks to start from (a file that is there already is left alone). A notebook
    // added to the studio since someone's last visit is given to them once; one they have had before is never put
    // back, in case they deleted it.
    const first = !store.get('seeded', false);
    const given = store.get('starters', []);
    if (first) FOLDERS.forEach((d) => fs.mkdirp(HOME + '/' + d));
    for (const s of STARTERS) {
      if (given.includes(s.p)) continue;
      if (!fs.exists(HOME + '/' + s.p) && !(await addStarter(fs, s.p))) continue;
      given.push(s.p);
    }
    store.set('starters', given);
    store.set('seeded', true);
    return fs;
  }

  MG.page.firstBench = 'viewer';
  MG.page.init = async function () {
    const fs = (MG.app.fs = await setupFs());
    MG.app.term = new MG.TerminalUI(document.getElementById('termRoot'), {
      fs,
      hostname: CFG.hostname || 'studio',
      env: {},
      welcome:
        `A Linux terminal (bash) in your browser, with gpxil (encode, info, validate, render, book, fasta, vcf), gpxil2pxil and pxil. Your files are in ~ (${HOME}), the examples in /data/examples, and the GRCh38 reference, a gpxil file for each chromosome read from the web as needed, in ${REF_DIR}. Try  gpxil info ${REF_DIR}/chr17.gpxil.tif . Type  help  to see what’s here, or  man NAME  to read about a command.` +
        (MG.user.name() === MG.user.DEFAULT ? ' To see your name in place of user, click “user” at the top of the page.' : '')
    });
    MG.app.nbApp = new MG.NotebookApp(document.getElementById('nbRoot'), { fs, dir: HOME + '/notebooks' });
    MG.project.persist();
  };

  /* ------------------------------------------------------------------
     the tabs that are built when first shown
     ------------------------------------------------------------------ */
  let nbOpened = false;
  async function openFirstNotebook() {
    if (nbOpened) return;
    nbOpened = true;
    const fs = MG.app.fs, app = MG.app.nbApp;
    const last = store.get('nbOpen', null);
    const welcome = HOME + '/notebooks/gpxil-in-python.ipynb';
    const start = (last && fs.exists(last) && last) || (fs.exists(welcome) && welcome) || (app.list()[0] || {}).path;
    if (start) await app.open(start);
    else await app.newNotebook('python');
  }
  MG.page.lazy = {
    viewer: (pane) => {
      MG.app.viewer = new MG.ViewerTab(pane.querySelector('#viewerRoot'), { fs: MG.app.fs });
      return MG.app.viewer.ready;
    },
    tools: (pane) => {
      MG.app.tools = new MG.ToolsTab(pane.querySelector('#toolsRoot'), { fs: MG.app.fs });
    },
    terminal: () => {},
    notebook: () => openFirstNotebook(),
    editor: (pane) => {
      MG.app.editor = new MG.Editor(pane.querySelector('#edRoot'), { fs: MG.app.fs });
    }
  };
  /* each time a tab is shown */
  MG.page.shown = {
    viewer: (pane, opts) => MG.app.viewer && MG.app.viewer.shown(opts),
    tools: (pane, opts) => MG.app.tools && MG.app.tools.shown(opts),
    notebook: () => MG.app.nbApp && MG.app.nbApp.shown(),
    terminal: (pane, opts) => {
      if (MG.app.term && !(opts && opts.resize) && !window.matchMedia('(max-width: 900px)').matches) MG.app.term.focus();
    },
    editor: () => MG.app.editor && MG.app.editor.shown && MG.app.editor.shown()
  };

  async function waitFor(get, ms = 4000) {
    for (let t = 0; t < ms && !get(); t += 50) await new Promise((r) => setTimeout(r, 50));
    return get();
  }
  MG.app.waitFor = waitFor;

  /* ------------------------------------------------------------------
     what kind of file a file is, by its name
     ------------------------------------------------------------------ */
  const KIND_NAMES = {
    gpxil: 'gpxil file',
    pxil: 'pxil picture',
    fasta: 'FASTA file',
    vcf: 'VCF file',
    bed: 'BED file',
    gtf: 'GTF or GFF file',
    image: 'picture',
    pdf: 'PDF',
    notebook: 'notebook',
    workflow: 'workflow',
    workflowrun: 'record of a workflow’s run',
    json: 'JSON file',
    text: 'text file',
    other: 'file'
  };
  MG.app.kindNames = KIND_NAMES;
  /** → gpxil | pxil | fasta | vcf | bed | gtf | image | pdf | notebook | workflow | workflowrun | json | text | other */
  MG.app.fileKind = (path) => {
    const n = String(path).toLowerCase();
    if (n.endsWith('.ipynb')) return 'notebook';
    if (n.endsWith('.workflow.json')) return 'workflow';
    if (/(^|\/)workflow-run\.json$/.test(n)) return 'workflowrun';
    if (/\.gpxil(\.tiff?)?$/.test(n)) return 'gpxil';
    if (/\.pxil(\.png)?$/.test(n)) return 'pxil';
    if (/\.(fa|fasta|fna|fas)(\.b?gz)?$/.test(n)) return 'fasta';
    if (/\.vcf(\.b?gz)?$/.test(n)) return 'vcf';
    if (/\.bed(\.gz)?$/.test(n)) return 'bed';
    if (/\.(gtf|gff3?)(\.gz)?$/.test(n)) return 'gtf';
    if (/\.(png|jpe?g|gif|bmp|tiff?|webp|svg)$/.test(n)) return 'image';
    if (n.endsWith('.pdf')) return 'pdf';
    if (n.endsWith('.json')) return 'json';
    if (/\.(txt|tsv|csv|md|sh|py|log)$/.test(n)) return 'text';
    return 'other';
  };
  // (the tools and workflows of the pedigree workbench, which these were adapted from, call it pedKind)
  MG.app.pedKind = MG.app.fileKind;

  /** the buttons the Files tab shows for a file: [icon, label, title, fn] */
  MG.app.fileActions = (path) => {
    const k = MG.app.fileKind(path);
    const tool = (id, extra) => () => MG.app.useTool(id, Object.assign({ input: path }, extra || {}));
    const out = [];
    if (k === 'gpxil') {
      out.push(['grid', 'View', 'Look at this file’s planes as pixels (Viewer tab)', () => MG.app.viewerOpen(path)]);
      out.push(['info', 'What’s in it', 'Its contigs, planes and sample (gpxil info)', tool('info')]);
      out.push(['chart', 'Count', 'Count what it holds: calls, variants, phasing, quality (gpxil stats)', tool('stats', { regions: '' })]);
      out.push(['badgeCheck', 'Check', 'Check it against the gpxil specification (gpxil validate)', tool('validate')]);
      out.push(['protein', 'Genes as pictures', 'Pictures of genes, transcripts and proteins from it (gpxil2pxil)', tool('gpxil2pxil')]);
      out.push(['wrench', 'More…', 'Everything the Tools tab can do with this file', () => MG.app.toolsFor(path)]);
    } else if (k === 'pxil') {
      out.push(['dna', 'As FASTA', 'The sequence in this picture, as FASTA (pxil)', tool('pxil-fasta')]);
    } else if (k === 'vcf') {
      out.push(['grid', 'Encode as gpxil', 'Make a gpxil file of this sample (gpxil encode)', () => MG.app.useTool('encode', { vcf: path })]);
    } else if (k === 'fasta') {
      out.push(['grid', 'Encode as gpxil', 'Make a gpxil file of this reference (gpxil encode)', () => MG.app.useTool('encode', { reference: path })]);
    } else if (k === 'workflow') {
      out.push(['play', 'Run', 'Run this workflow (Tools tab)', () => MG.app.workflowOpen(path, 'run')]);
      out.push(['workflow', path.startsWith(HOME + '/') ? 'Edit' : 'Edit a copy', 'Open this workflow in the editor (Tools tab)', () => MG.app.workflowOpen(path, 'edit')]);
    } else if (k === 'workflowrun') {
      out.push(['workflow', 'View the run', 'What this run of a workflow did, step by step (Tools tab)', () => MG.app.workflowOpen(path, 'record')]);
    }
    return out;
  };

  /* ------------------------------------------------------------------
     opening files: the right tab for each kind
     ------------------------------------------------------------------ */
  /** edit or look at a file in the Files tab */
  MG.app.editFile = async (path, opts = {}) => {
    await MG.app.showWorkbench('editor');
    const ed = await waitFor(() => MG.app.editor);
    if (ed) await ed.openFile(path, opts);
  };
  /** open a file where it belongs: a notebook in Notebook, a gpxil file in the Viewer, the rest in Files */
  MG.app.openFile = async (path, opts = {}) => {
    const p = MG.app.fs.resolve(path);
    if (!opts.edit && /\.ipynb$/i.test(p)) {
      await MG.app.showWorkbench('notebook');
      return MG.app.nbApp.open(p);
    }
    const k = MG.app.fileKind(p);
    if (!opts.edit && k === 'gpxil') return MG.app.viewerOpen(p);
    if (!opts.edit && k === 'workflow') return MG.app.workflowOpen(p, p.startsWith(HOME + '/') ? 'edit' : 'run');
    if (!opts.edit && k === 'workflowrun') return MG.app.workflowOpen(p, 'record');
    return MG.app.editFile(p, opts);
  };
  /** show a folder or file in the Files tab */
  MG.app.revealFile = async (path) => {
    await MG.app.showWorkbench('editor');
    const ed = await waitFor(() => MG.app.editor);
    if (ed && ed.reveal) ed.reveal(MG.app.fs.resolve(path));
  };
  /** a gpxil file → the Viewer tab (opts: {region: 'chr17:7,661,779-7,687,546', plane: 'gt'}) */
  MG.app.viewerOpen = async (path, opts = {}) => {
    await MG.app.showWorkbench('viewer');
    const V = await waitFor(() => MG.app.viewer, 8000);
    if (!V) throw new Error('The viewer couldn’t start.');
    await V.ready;
    return V.open(MG.app.fs.resolve(path), opts);
  };
  /** the Tools tab with a tool chosen (and its fields filled in: {input: path, …}) */
  MG.app.useTool = async (id, values) => {
    await MG.app.showWorkbench('tools');
    const T = await waitFor(() => MG.app.tools, 8000);
    if (T) T.choose(id, values || {});
  };
  /** a workflow in the Tools tab: view 'run', 'edit' (an example: a copy of it) or 'record' (a run's record), or the
      Workflows page itself (view 'list', or 'extract': a workflow from the tools run). extra.input: a file to run it
      on (its first input that takes a file of that kind) */
  MG.app.workflowOpen = async (path, view = 'edit', extra = {}) => {
    await MG.app.showWorkbench('tools');
    const T = await waitFor(() => MG.app.tools, 8000);
    if (T) T.go(Object.assign({ page: 'workflows', view, path: path ? MG.app.fs.resolve(path) : null }, extra.input ? { input: MG.app.fs.resolve(extra.input) } : {}));
  };
  /** the Tools tab, showing what can be done with a file */
  MG.app.toolsFor = async (path) => {
    await MG.app.showWorkbench('tools');
    const T = await waitFor(() => MG.app.tools, 8000);
    if (T) T.forFile(MG.app.fs.resolve(path));
  };

  /* Files edited in the Files tab are saved with Save / Ctrl+S: before the page is left or reloaded with unsaved
     edits, the browser asks (it shows its own message). */
  window.addEventListener('beforeunload', (e) => {
    const ed = MG.app.editor;
    if (ed && ed.dirtyPaths && ed.dirtyPaths().length) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  /* ------------------------------------------------------------------
     ▶ buttons of the help pages
     data-example="HG002_chr17.gpxil.tif"   copy an example into ~/examples
     data-viewer="/data/examples/x.gpxil.tif"   open a file in the Viewer (data-region="chr17:…", data-mode="variants"
                                            (reference, genotype, haplotypes, variants, flags, gq, dp, ps) or
                                            data-plane="gt")
     data-tool="encode"                     open a tool; data-input, data-vcf, data-reference, data-genes,
                                            data-region fill in its fields
     data-new-nb / data-open-nb             a new notebook / open a notebook
     ------------------------------------------------------------------ */
  const home = (p) => p.replace(/^~(?=\/|$)/, HOME);
  MG.actions.example = async (rel) => {
    const fs = MG.app.fs;
    const src = '/data/examples/' + rel.replace(/^\/+/, '');
    if (!fs.exists(src)) throw new Error('There is no example ' + rel);
    const dest = HOME + '/examples/' + rel.replace(/^\/+/, '');
    if (fs.isDir(src)) {
      for (const [p, e] of Array.from(fs.entries)) if (p.startsWith(src + '/') && e.kind !== 'dir') fs.copy(p, dest + p.slice(src.length));
    } else fs.copy(src, dest);
    toast(`Copied to <b>${esc(fs.pretty(dest))}</b>. This copy is yours to change.`, 'ok');
  };
  /* a file in the Files tab */
  MG.actions.edit = async (path) => MG.app.editFile(home(path));
  MG.actions.viewer = async (path, btn) => {
    const ds = (btn && btn.dataset) || {};
    return MG.app.viewerOpen(home(path), { region: ds.region || null, mode: ds.mode || null, plane: ds.plane || null, width: ds.width ? Number(ds.width) : null });
  };
  /* every field of the tool can be set by an attribute of the button, its key written with dashes: data-no-ref,
     data-max-pages="5", data-width="4". A tick box is ticked by the attribute alone (data-no-ref) or "true", and
     cleared by "false"; a field of several files takes them separated by spaces */
  MG.actions.tool = async (id, btn) => {
    const ds = (btn && btn.dataset) || {};
    const tool = (MG.gpxilTools || []).find((t) => t.id === id);
    const values = {};
    for (const f of (tool && tool.fields) || []) {
      const raw = ds[f.key];
      if (raw == null || f.key === 'tool') continue;
      if (f.type === 'check') values[f.key] = raw === '' || raw === 'true' || raw === f.key;
      else if (f.type === 'files') values[f.key] = raw.split(/\s+/).filter(Boolean).map(home);
      else if (['file', 'path', 'folder'].includes(f.type)) values[f.key] = raw ? home(raw) : raw;
      else values[f.key] = raw;
    }
    return MG.app.useTool(id, values);
  };
  /* data-workflow="~/workflows/x.workflow.json" (data-view="edit" or "run", the default; data-input="…" a file to run
     it on); data-workflows="list" or "extract": the Workflows page */
  MG.actions.workflow = async (path, btn) => {
    const ds = (btn && btn.dataset) || {};
    return MG.app.workflowOpen(home(path), ds.view || 'run', { input: ds.input ? home(ds.input) : null });
  };
  MG.actions.workflows = async (view) => MG.app.workflowOpen(null, view || 'list');
  MG.actions.newNb = async () => {
    await MG.app.showWorkbench('notebook');
    await MG.app.nbApp.newNotebook('python');
  };
  MG.actions.openNb = async (path) => {
    await MG.app.showWorkbench('notebook');
    const p = path.startsWith('~/') ? HOME + path.slice(1) : path;
    // (a notebook to start from that isn't there, deleted or never given: a fresh copy)
    const starter = STARTERS.find((s) => HOME + '/' + s.p === p);
    if (!MG.app.fs.exists(p) && starter) await addStarter(MG.app.fs, starter.p);
    if (!MG.app.fs.exists(p)) throw new Error(`There is no notebook ${path} (was it renamed or deleted?)`);
    await MG.app.nbApp.open(p);
  };

  /* Start afresh: forget the open notebooks and what the viewer showed */
  MG.page.beforeReset = async () => {
    store.remove('nbOpen');
    store.remove('seeded');
    store.remove('starters');
    store.remove('termHistory');
    store.remove('viewerState');
  };
  // (h is used by the tabs built here)
  void h;
})();
