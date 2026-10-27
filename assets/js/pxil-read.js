/* =====================================================================
   A pxil reader for the page (no Python): a pxil file is an 8-bit
   palette (or grey) PNG of one sequence, one pixel a residue, whose
   metadata – the alphabet, the length, the width, what the sequence is –
   is JSON in an iTXt chunk with the keyword "pxil" (the pxil
   specification, https://github.com/comparativechrono/pxil). The
   pixels are the indices into the alphabet, so the sequence comes back
   exactly from the picture.

   MG.pxilRead.read(blob) → {meta, sequence, width, height, palette}
   ===================================================================== */
(function () {
  'use strict';
  const MG = window.MG;

  async function inflate(bytes) {
    const out = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer();
    return new Uint8Array(out);
  }
  const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

  /** a PNG's chunks: [{type, data}] */
  function chunks(b) {
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    if (sig.some((v, i) => b[i] !== v)) throw new Error('not a PNG file');
    const out = [];
    for (let o = 8; o + 8 <= b.length; ) {
      const n = u32(b, o);
      const type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
      out.push({ type, data: b.subarray(o + 8, o + 8 + n) });
      o += 12 + n;
      if (type === 'IEND') break;
    }
    return out;
  }

  /** the text of an iTXt chunk with this keyword, or null */
  async function itxt(list, keyword) {
    const dec = new TextDecoder();
    for (const c of list) {
      if (c.type !== 'iTXt') continue;
      const d = c.data;
      const k = d.indexOf(0);
      if (dec.decode(d.subarray(0, k)) !== keyword) continue;
      const compressed = d[k + 1];
      let o = k + 3;
      o = d.indexOf(0, o) + 1; // the language tag
      o = d.indexOf(0, o) + 1; // the translated keyword
      const text = d.subarray(o);
      return dec.decode(compressed ? await inflate(text) : text);
    }
    return null;
  }

  /** the rows of an 8-bit, one-sample, non-interlaced PNG, unfiltered: width × height bytes */
  function unfilter(raw, width, height) {
    const out = new Uint8Array(width * height);
    let prev = new Uint8Array(width);
    for (let y = 0, o = 0; y < height; y++) {
      const f = raw[o++];
      const row = out.subarray(y * width, (y + 1) * width);
      for (let x = 0; x < width; x++) {
        const a = x ? row[x - 1] : 0, b = prev[x], c = x ? prev[x - 1] : 0;
        let v = raw[o++];
        if (f === 1) v += a;
        else if (f === 2) v += b;
        else if (f === 3) v += (a + b) >> 1;
        else if (f === 4) {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        row[x] = v & 255;
      }
      prev = row;
    }
    return out;
  }

  async function read(blob) {
    const b = new Uint8Array(await blob.arrayBuffer());
    const list = chunks(b);
    const ihdr = list.find((c) => c.type === 'IHDR');
    if (!ihdr) throw new Error('a PNG without its header');
    const width = u32(ihdr.data, 0), height = u32(ihdr.data, 4);
    const depth = ihdr.data[8], colour = ihdr.data[9], interlace = ihdr.data[12];
    const text = await itxt(list, 'pxil');
    if (text == null) throw new Error('a PNG, but not pxil: it has no pxil metadata');
    const meta = JSON.parse(text);
    if (depth !== 8 || (colour !== 3 && colour !== 0) || interlace) throw new Error('its pixels are not 8-bit palette indices');
    const idat = list.filter((c) => c.type === 'IDAT');
    const all = new Uint8Array(idat.reduce((n, c) => n + c.data.length, 0));
    idat.reduce((o, c) => (all.set(c.data, o), o + c.data.length), 0);
    const pixels = unfilter(await inflate(all), width, height);
    const alphabet = String(meta.alphabet || '');
    const n = Math.min(Number(meta.length) || 0, pixels.length);
    const chars = Array.from(alphabet);
    let sequence = '';
    for (let i = 0; i < n; i++) {
      const ch = chars[pixels[i]];
      if (ch == null) throw new Error(`pixel ${i + 1} is ${pixels[i]}, outside the alphabet`);
      sequence += ch;
    }
    const plte = list.find((c) => c.type === 'PLTE');
    const palette = [];
    if (plte) for (let i = 0; i + 2 < plte.data.length; i += 3) palette.push([plte.data[i], plte.data[i + 1], plte.data[i + 2]]);
    return { meta, sequence, width, height, palette };
  }

  MG.pxilRead = { read };
})();
