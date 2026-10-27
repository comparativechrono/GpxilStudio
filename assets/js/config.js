/* =====================================================================
   Settings for GpxilStudio.
   Edit and re-upload this file; nothing else needs to change.
   ===================================================================== */
window.MG_CONFIG = {
  courseTitle: 'GpxilStudio',
  courseSubtitle: 'Genome pixel images: look inside, convert, cut out and picture gpxil files – in your browser',

  /* The prefix of what the page keeps in the browser (files, notebooks, settings). Every site
     of ours on the same address (comparativechrono.github.io/…) shares one browser storage, so
     each needs its own prefix: change it only if two copies of the studio on one web site
     must not share their saved work. */
  storePrefix: 'gpxilstudio',
  hostname: 'studio',

  /* Python in the browser (Pyodide). To host it with the site instead of the CDN, download the
     Pyodide release and put its folder here, e.g. 'assets/vendor/pyodide/'. */
  pyodideBase: 'https://cdn.jsdelivr.net/pyodide/v0.29.5/full/',
  /* Pyodide packages loaded when Python starts: gpxiltools needs NumPy, Pillow and jsonschema.
     Any other Pyodide package (pandas, matplotlib …) loads when a notebook cell imports it. */
  pythonPreload: ['numpy', 'pillow', 'jsonschema'],
  pythonBackground: ['matplotlib'],

  /* The GRCh38 reference, as the Gpxil browser serves it: one gpxil file per chromosome, and its
     gene files. Python reads them over the web a strip at a time, so nothing is downloaded whole.
     On the Gpxil browser's own site, and from serve.py on your computer, they are read from the
     same server (serve.py --reference DIR serves a copy you have; without it, it sends the page
     on to the web). */
  referenceBase: (/^(comparativechrono\.github\.io|localhost|127\.0\.0\.1)$/.test(location.hostname) ? '' : 'https://comparativechrono.github.io') + '/Gpxil-browser/data/grch38/',

  /* Files at least this big (megabytes) are never copied into Python's memory: Python reads them
     from the browser's storage, a piece at a time, as it needs them. */
  lazyFileMB: 8,

  /* How much the studio may keep in this browser before it warns (megabytes). gpxil files are
     big: a whole genome is 850 MB. */
  storageWarnMB: 2000
};
