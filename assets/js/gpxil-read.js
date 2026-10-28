/* =====================================================================
   gpxil files in the page (no Python): gpxiltools' JavaScript reader
   (assets/vendor/gpxil-read/gpxil-read.js, a copy of Gpxil-tools'
   js/gpxil-read.js; gpxil-read.source.json beside it says from which
   commit), with what the page adds to it: a source for a file of the
   page's file system, and errors in the page's words. The Viewer and the
   Files tab use it, so a gpxil file of any size opens at once: only the
   strips shown are read, from a Blob the browser keeps or from the web.

   MG.gpxilRead.open(source) → a file: {meta, version, contigs,
   contig(name), read(contig, plane, start, end) → typed array,
   sidecar(contig)}. MG.gpxilRead.sourceOf(fs, path) makes a source for a
   file of the page. The Gpxil browser reads its files with the same reader.
   ===================================================================== */
(function () {
  'use strict';
  const MG = window.MG;
  const R = window.GpxilRead;

  /** a source for a file of the page's file system: a Blob it keeps, or a file on the web */
  function sourceOf(fs, path) {
    const e = fs.get(path);
    if (!e) throw new Error(`${path}: no such file`);
    if (e.kind === 'blob' && e.blob) return R.fromBlob(e.blob, path + '@' + (e.mtime || 0));
    if (e.kind === 'url') return urlSource(new URL(e.url, location.href).href, e.size);
    if (e.kind === 'text') return R.fromBlob(new Blob([e.text]), path + '@' + (e.mtime || 0));
    throw new Error(`${path} can’t be read here`);
  }
  const urlSource = (url, size) => R.fromUrl(url, { size: size || 0 });

  /** what went wrong, in the page's words: a file compressed as the page can't read, or in strips too large to
      read at once, is one Python can read */
  function words(e) {
    if (e && e.code === 'compression')
      e.message = `this file is compressed with ${e.compression}, which the page can’t read (it reads Deflate, the gpxil default). Python can: use gpxil render, or the notebook.`;
    else if (e && e.code === 'limit')
      e.message = `${e.message}: the page reads only so much of a file at once. Python can read it: use gpxil render, or the notebook.`;
    return e;
  }
  async function open(source) {
    let g;
    try {
      g = await R.open(source);
    } catch (e) {
      throw words(e);
    }
    const read = g.read.bind(g);
    const sidecar = g.sidecar.bind(g);
    g.read = (...args) => read(...args).catch((e) => Promise.reject(words(e)));
    g.sidecar = (...args) => sidecar(...args).catch((e) => Promise.reject(words(e)));
    return g;
  }

  MG.gpxilRead = { open, sourceOf, blobSource: R.fromBlob, urlSource, base: R.base, state: R.state, flags: R.flags, IUPAC: R.IUPAC, STATE: R.STATE, SPEC: R.SPEC, reader: R };
})();
