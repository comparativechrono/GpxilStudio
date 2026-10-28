/* =====================================================================
   A gpxil reader for the page (no Python): the TIFF's directories and
   strips, read a piece at a time from a Blob (a file the browser keeps)
   or from the web (HTTP range requests), and inflated with the browser's
   DecompressionStream. The viewer and the Files tab use it, so a gpxil
   file of any size opens at once: only the strips shown are read.

   MG.gpxilRead.open(source) → a file: {meta, contigs, read(contig,
   plane, start, end) → typed array}. A source is {key, size, read(a, b)}
   (MG.gpxilRead.sourceOf(fs, path) makes one for a file of the page).
   ===================================================================== */
(function () {
  'use strict';
  const MG = window.MG;

  const TAG = { ImageWidth: 256, ImageLength: 257, BitsPerSample: 258, Compression: 259, ImageDescription: 270, StripOffsets: 273, SamplesPerPixel: 277, RowsPerStrip: 278, StripByteCounts: 279, PageName: 285, Predictor: 317, TileWidth: 322, SampleFormat: 339, Sidecar: 65400 };
  const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8, 17: 8, 18: 8 };
  const PROBE = 16384; // bytes read at a directory: its tags and, as tifffile lays files out, their arrays
  const COMPRESSION = { 1: 'none', 5: 'LZW', 7: 'JPEG', 8: 'deflate', 32946: 'deflate', 34925: 'LZMA', 50000: 'Zstandard', 32773: 'PackBits' };

  /* ---------------- sources ---------------- */
  function blobSource(blob, key) {
    return { key: key || 'blob:' + Math.random(), size: blob.size, read: async (a, b) => new Uint8Array(await blob.slice(a, b).arrayBuffer()) };
  }
  function urlSource(url, size) {
    return {
      key: url,
      size: size || 0,
      read: async (a, b) => {
        const r = await fetch(url, { headers: { Range: `bytes=${a}-${b - 1}` } });
        if (r.status === 206) return new Uint8Array(await r.arrayBuffer());
        if (r.status === 200) return new Uint8Array(await r.arrayBuffer()).slice(a, b); // a server without ranges
        throw new Error(`${url}: HTTP ${r.status}`);
      }
    };
  }
  /** a source for a file of the page's file system: a Blob it keeps, or a file on the web */
  function sourceOf(fs, path) {
    const e = fs.get(path);
    if (!e) throw new Error(`${path}: no such file`);
    if (e.kind === 'blob' && e.blob) return blobSource(e.blob, path + '@' + (e.mtime || 0));
    if (e.kind === 'url') return urlSource(new URL(e.url, location.href).href, e.size);
    if (e.kind === 'text') return blobSource(new Blob([e.text]), path + '@' + (e.mtime || 0));
    throw new Error(`${path} can't be read here`);
  }

  async function inflate(bytes) {
    const out = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer();
    return new Uint8Array(out);
  }

  /** decoded strips, shared by all files: 192 MB at most */
  const cache = new Map();
  let cached = 0;
  const CACHE_MAX = 192 * 1024 * 1024;
  function remember(key, data) {
    cache.set(key, data);
    cached += data.byteLength;
    while (cached > CACHE_MAX && cache.size > 1) {
      const [k, v] = cache.entries().next().value;
      cache.delete(k);
      cached -= v.byteLength;
    }
  }

  class View {
    constructor(bytes, base, little) {
      this.v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      this.base = base;
      this.little = little;
    }
    has(off, n) {
      return off >= this.base && off + n <= this.base + this.v.byteLength;
    }
    u8(off) {
      return this.v.getUint8(off - this.base);
    }
    u16(off) {
      return this.v.getUint16(off - this.base, this.little);
    }
    u32(off) {
      return this.v.getUint32(off - this.base, this.little);
    }
    u64(off) {
      return Number(this.v.getBigUint64(off - this.base, this.little));
    }
  }

  class GpxilFile {
    constructor(src) {
      this.src = src;
      this.offsets = []; // directory offsets, page by page, as far as walked
      this.pages = new Map();
    }
    async _header() {
      if (this.h) return this.h;
      const b = await this.src.read(0, 16);
      const little = b[0] === 0x49;
      if (!(little || b[0] === 0x4d) || b[0] !== b[1]) throw new Error('not a TIFF file');
      const r = new View(b, 0, little);
      const magic = r.u16(2);
      if (magic === 42) this.h = { little, big: false, first: r.u32(4) };
      else if (magic === 43) this.h = { little, big: true, first: r.u64(8) };
      else throw new Error('bad TIFF header');
      this.offsets = [this.h.first];
      return this.h;
    }
    /** the directory of page k, walking the chain of directories as far as it. One walk at a time: two at once would
        both add the directory after the last one known, and every page after it would be read as the one before */
    async _ifd(k) {
      await this._header();
      const walk = (this._walking || Promise.resolve()).then(async () => {
        while (this.offsets.length <= k) {
          const at = this.offsets[this.offsets.length - 1];
          if (!at) throw new Error(`there is no page ${k}`);
          const d = await this._dir(at);
          this.offsets.push(d.next);
        }
        return this.offsets[k];
      });
      this._walking = walk.catch(() => {});
      return walk;
    }
    async _dir(at) {
      const h = this.h;
      let bytes = await this.src.read(at, Math.min(this.src.size || at + PROBE, at + PROBE));
      let r = new View(bytes, at, h.little);
      const n = h.big ? r.u64(at) : r.u16(at);
      const size = h.big ? 20 : 12;
      const first = at + (h.big ? 8 : 2);
      const end = first + n * size + (h.big ? 8 : 4);
      if (!r.has(first, end - first)) {
        bytes = await this.src.read(at, end);
        r = new View(bytes, at, h.little);
      }
      const tags = new Map();
      for (let i = 0; i < n; i++) {
        const e = first + i * size;
        const tag = r.u16(e);
        const type = r.u16(e + 2);
        const count = h.big ? r.u64(e + 4) : r.u32(e + 4);
        const bytesOf = (TYPE_SIZE[type] || 1) * count;
        const inline = bytesOf <= (h.big ? 8 : 4);
        tags.set(tag, { type, count, at: inline ? e + (h.big ? 12 : 8) : h.big ? r.u64(e + 12) : r.u32(e + 8), bytes: bytesOf });
      }
      const next = h.big ? r.u64(first + n * size) : r.u32(first + n * size);
      return { r, tags, next };
    }
    async page(k) {
      if (this.pages.has(k)) return this.pages.get(k);
      const p = (async () => {
        const at = await this._ifd(k);
        const { r, tags } = await this._dir(at);
        const h = this.h;
        const values = async (tag) => {
          const t = tags.get(tag);
          if (!t) return null;
          let rr = r;
          if (!rr.has(t.at, t.bytes)) rr = new View(await this.src.read(t.at, t.at + t.bytes), t.at, h.little);
          const step = TYPE_SIZE[t.type] || 1;
          const out = new Array(t.count);
          for (let i = 0; i < t.count; i++) {
            const o = t.at + i * step;
            out[i] = t.type === 3 ? rr.u16(o) : t.type === 4 || t.type === 9 ? rr.u32(o) : t.type === 16 || t.type === 17 ? rr.u64(o) : rr.u8(o);
          }
          return out;
        };
        const one = async (tag, fallback) => {
          const v = await values(tag);
          return v ? v[0] : fallback;
        };
        if (tags.has(TAG.TileWidth)) throw new Error('tiled pages can’t be read here (gpxil files are in strips)');
        const page = {
          index: k,
          width: await one(TAG.ImageWidth),
          height: await one(TAG.ImageLength),
          bits: await one(TAG.BitsPerSample, 1),
          samples: await one(TAG.SamplesPerPixel, 1),
          format: await one(TAG.SampleFormat, 1),
          compression: await one(TAG.Compression, 1),
          predictor: await one(TAG.Predictor, 1),
          rowsPerStrip: await one(TAG.RowsPerStrip, 2 ** 32 - 1),
          offsets: await values(TAG.StripOffsets),
          counts: await values(TAG.StripByteCounts),
          description: async () => {
            const v = await values(TAG.ImageDescription);
            return v ? new TextDecoder().decode(Uint8Array.from(v.filter((x, i) => !(i === v.length - 1 && x === 0)))) : null;
          },
          /** the sidecar of a gt page (tag 65400, zlib-compressed text, spec section 7), as bytes, or null */
          sidecarBytes: async () => {
            const t = tags.get(TAG.Sidecar);
            if (!t) return null;
            return this.src.read(t.at, t.at + t.bytes);
          }
        };
        if (page.samples !== 1 || ![8, 16, 32].includes(page.bits)) throw new Error(`a page of ${page.bits}-bit × ${page.samples} samples can’t be read here`);
        if (![1, 8, 32946].includes(page.compression))
          throw new Error(`this file is compressed with ${COMPRESSION[page.compression] || 'compression ' + page.compression}, which the page can’t read (it reads deflate, the gpxil default). Python can: use gpxil render, or the notebook.`);
        if (page.predictor !== 1) throw new Error('pages with a predictor can’t be read here');
        page.rowsPerStrip = Math.min(page.rowsPerStrip, page.height);
        return page;
      })();
      p.catch(() => this.pages.delete(k));
      this.pages.set(k, p);
      return p;
    }
    async _strip(page, s) {
      const key = `${this.src.key}#${page.index}#${s}`;
      if (cache.has(key)) return cache.get(key);
      const raw = await this.src.read(page.offsets[s], page.offsets[s] + page.counts[s]);
      const data = page.compression === 1 ? raw : await inflate(raw);
      remember(key, data);
      return data;
    }
    /** values of positions [start, end) of a page whose rows are page.width wide */
    async readPage(page, start, end) {
      const W = page.width;
      const bytesPer = page.bits / 8;
      end = Math.min(end, W * page.height);
      const n = Math.max(0, end - start);
      const out = new Uint8Array(n * bytesPer);
      if (!n) return typed(page, out, this.h.little);
      const rps = page.rowsPerStrip;
      const s0 = Math.floor(Math.floor(start / W) / rps);
      const s1 = Math.floor(Math.floor((end - 1) / W) / rps);
      const strips = await Promise.all(Array.from({ length: s1 - s0 + 1 }, (_, i) => this._strip(page, s0 + i)));
      let pos = 0;
      for (let s = s0; s <= s1; s++) {
        const data = strips[s - s0];
        const first = s * rps * W;
        const a = Math.max(start, first) - first;
        const b = Math.min(end, first + data.length / bytesPer) - first;
        if (b > a) {
          out.set(data.subarray(a * bytesPer, b * bytesPer), pos * bytesPer);
          pos += b - a;
        }
      }
      return typed(page, out, this.h.little);
    }
  }
  function typed(page, bytes, little) {
    if (page.bits === 8) return bytes;
    // (TIFF data are in the file's byte order; typed arrays are in the machine's, which is little-endian everywhere)
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    if (!little) {
      const u = new Uint8Array(buf);
      const w = page.bits / 8;
      for (let i = 0; i < u.length; i += w) u.subarray(i, i + w).reverse();
    }
    if (page.bits === 16) return page.format === 2 ? new Int16Array(buf) : new Uint16Array(buf);
    return page.format === 3 ? new Float32Array(buf) : page.format === 2 ? new Int32Array(buf) : new Uint32Array(buf);
  }

  /** open a gpxil file: its metadata (the JSON in the first page's description) and contigs */
  async function open(src) {
    const f = new GpxilFile(src);
    const p0 = await f.page(0);
    const desc = await p0.description();
    let meta;
    try {
      meta = JSON.parse(desc);
    } catch (e) {
      throw new Error('it is a TIFF file, but not gpxil (its first page has no gpxil metadata)');
    }
    if (!meta || !meta.gpxil || !meta.contigs) throw new Error('it is a TIFF file, but not gpxil');
    const contigs = meta.contigs.map((c) => ({ name: c.name, length: Number(c.length), width: Number(c.width || meta.layout.width), pages: c.pages, aliases: c.aliases || [], entry: c }));
    const byName = new Map();
    for (const c of contigs) {
      byName.set(c.name.toLowerCase(), c);
      for (const a of c.aliases) if (!byName.has(a.toLowerCase())) byName.set(a.toLowerCase(), c);
    }
    return {
      meta,
      contigs,
      file: f,
      contig: (name) => byName.get(String(name).toLowerCase()) || byName.get('chr' + String(name).toLowerCase()) || byName.get(String(name).toLowerCase().replace(/^chr/, '')) || null,
      /** a plane's values over [start, end) of a contig (0-based, half-open) */
      async read(contig, plane, start, end) {
        const c = typeof contig === 'string' ? this.contig(contig) : contig;
        if (!c) throw new Error(`no contig ${contig}`);
        if (!(plane in c.pages)) throw new Error(`${c.name} has no ${plane} plane`);
        const page = await f.page(Number(c.pages[plane]));
        return f.readPage(page, Math.max(0, start), Math.min(c.length, end));
      },
      /** a contig's sidecar (spec section 7): [{offset, hap, kind, data}], sorted as stored; [] if it has none */
      async sidecar(contig) {
        const c = typeof contig === 'string' ? this.contig(contig) : contig;
        if (!c) throw new Error(`no contig ${contig}`);
        if (!('gt' in c.pages)) return [];
        if (!c._sidecar) {
          c._sidecar = (async () => {
            const page = await f.page(Number(c.pages.gt));
            const raw = await page.sidecarBytes();
            return raw ? parseSidecar(new TextDecoder().decode(await inflate(raw))) : [];
          })();
          c._sidecar.catch(() => (c._sidecar = null));
        }
        return c._sidecar;
      }
    };
  }
  function parseSidecar(text) {
    const out = [];
    for (const line of text.split('\n')) {
      if (!line || line[0] === '#' || line.startsWith('offset\t')) continue;
      const [off, hap, kind, ...rest] = line.split('\t');
      out.push({ offset: Number(off), hap: Number(hap), kind, data: rest.join('\t') });
    }
    return out;
  }

  // ---- what the codes mean (spec section 5) ----
  const IUPAC = '-ACMGRSVTWYHKDBN';
  const STATE = { 0: 'REF', 1: 'A', 2: 'C', 4: 'G', 8: 'T', 10: 'ABSENT', 12: 'COMPLEX', 13: 'DEL', 15: 'UNKNOWN' };
  const FLAGS = [[1, 'PHASED'], [2, 'INS1'], [4, 'INS2'], [8, 'FILTERED'], [16, 'VARIANT_SITE']];
  const base = (code) => {
    const ch = IUPAC[code & 15] || '?';
    return code & 16 ? ch.toLowerCase() : ch;
  };
  const state = (s) => STATE[s] || 'reserved ' + s;
  const flags = (f) => FLAGS.filter(([b]) => f & b).map(([, n]) => n);

  MG.gpxilRead = { open, sourceOf, blobSource, urlSource, base, state, flags, IUPAC, STATE };
})();
