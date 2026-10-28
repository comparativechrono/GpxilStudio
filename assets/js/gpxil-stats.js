/* =====================================================================
   The counts of `gpxil stats` in the page, for the Viewer: what a region
   holds (the reference's bases, the calls, substitutions with Ti/Tv,
   insertions and deletions, phasing, quality and depth), counted from
   the planes the Viewer reads, so that they follow it as it moves.

   The definitions are gpxiltools' (gpxiltools/stats.py, region_tally and
   Tally.as_dict), line for line, and the result has the same keys, so
   that the numbers are the same as the command's: browser_smoke.py
   checks them against gpxil stats on several regions.

   MG.gpxilStats.count({length, start, end, ref, gt, flags, gq, dp, ps,
   sidecar, before, readGt}) → a promise of the counts (as_dict's keys).
   ===================================================================== */
(function () {
  'use strict';
  const MG = window.MG;

  const VALID = new Uint8Array(16);
  [0, 1, 2, 4, 8, 10, 12, 13, 15].forEach((s) => (VALID[s] = 1));
  const SUB = new Uint8Array(16);
  [1, 2, 4, 8].forEach((s) => (SUB[s] = 1));
  const ABSENT = 10, DEL = 13, UNKNOWN = 15;
  const PHASED = 1, INS1 = 2, INS2 = 4, FILTERED = 8;
  const QUAL_MISSING = 255;
  /** reserved haplotype states read as UNKNOWN (spec section 10) */
  const norm = (s) => (VALID[s] ? s : UNKNOWN);

  /** Python's round(x, n): the nearest, and at an exact half the even one (as round() does with the exact value) */
  function pyRound(x, n) {
    const r = Number(x.toFixed(n)); // (the nearest; at a half, the one away from zero)
    const s = Math.abs(x).toFixed(Math.min(100, n + 40));
    const rest = s.slice(s.indexOf('.') + 1 + n);
    if (rest[0] === '5' && /^0*$/.test(rest.slice(1))) {
      const f = 10 ** n;
      if (Math.round(Math.abs(r) * f) % 2 === 1) return Number((Math.sign(x) * (Math.abs(r) - 1 / f)).toFixed(n));
    }
    return r;
  }

  function distribution(hist) {
    if (!hist) return null;
    let n = 0, sum = 0, min = null, max = null;
    hist.forEach((c, v) => {
      if (!c) return;
      n += c;
      sum += c * v;
      if (min === null) min = v;
      max = v;
    });
    if (!n) return { bases: 0, mean: null, min: null, q1: null, median: null, q3: null, max: null };
    // (the smallest value with at least this share of the bases at or below it, as numpy's searchsorted)
    const quantile = (f) => {
      let cum = 0;
      for (let v = 0; v < hist.length; v++) {
        cum += hist[v];
        if (cum >= f * n) return v;
      }
      return hist.length;
    };
    return { bases: n, mean: pyRound(sum / n, 2), min, q1: quantile(0.25), median: quantile(0.5), q3: quantile(0.75), max };
  }

  /** count one region [start, end) of a contig of `length` bases; the planes are arrays over the region (ref, flags,
      gq, dp and ps may be null if the file has none), sidecar the contig's entries, before the gt value at start - 1
      (null at the contig's start), and readGt(a, b) reads gt further on, to follow a deletion past the region's end */
  async function count({ length, start, end, ref, gt, flags, gq, dp, ps, sidecar, before, readGt }) {
    const n = end - start;
    const refCodes = new Array(32).fill(0);
    if (ref) for (let i = 0; i < n; i++) if (ref[i] < 32) refCodes[ref[i]]++;
    const t = {
      bases: n, hasRef: !!ref, hasGt: !!gt, refCodes,
      called: 0, notCalled: 0, partlyCalled: 0, oneCopy: 0, filtered: 0,
      snvHet: 0, snvHom: 0, snvHetPhased: 0, transitions: 0, transversions: 0,
      insHet: 0, insHom: 0, insBases: 0, delHet: 0, delHom: 0, delBases: 0, complexHet: 0, complexHom: 0,
      phaseSpans: [], gq: gq ? new Array(255).fill(0) : null, dp: dp ? new Array(255).fill(0) : null
    };
    if (!gt) return asDict(t);
    // deletion runs, per haplotype: open[k] is the start of a run not yet ended (-1: it began before the region)
    const open = [null, null], oneCopy = [false, false], runs = [[], []];
    if (before != null) {
      if (norm(before >> 4) === DEL) open[0] = -1;
      if (norm(before & 15) === DEL) open[1] = -1;
    }
    const insOneCopy = new Map();
    const blocks = new Map();
    for (let i = 0; i < n; i++) {
      const g = gt[i];
      const h1 = norm(g >> 4), h2 = norm(g & 15);
      const f = flags ? flags[i] : 0;
      const a1 = h1 === ABSENT, a2 = h2 === ABSENT, u1 = h1 === UNKNOWN, u2 = h2 === UNKNOWN;
      const noneKnown = u1 && (u2 || a2);
      const someUnknown = u1 || u2;
      if (noneKnown) t.notCalled++;
      else if (someUnknown) t.partlyCalled++;
      else t.called++;
      if (a2) t.oneCopy++;
      if (f & FILTERED) t.filtered++;
      const s1 = SUB[h1] === 1, s2 = SUB[h2] === 1;
      if ((s1 || s2) && !someUnknown) {
        const hom = (s1 && s2 && h1 === h2) || (s1 && a2) || (s2 && a1);
        if (hom) t.snvHom++;
        else {
          t.snvHet++;
          if (f & PHASED) t.snvHetPhased++;
        }
        if (ref && SUB[ref[i] & 15]) {
          const r4 = ref[i] & 15;
          if (s1) {
            const m = r4 | h1;
            if (m === 5 || m === 10) t.transitions++; // A|G, C|T
            else t.transversions++;
          }
          if (s2 && !(s1 && h1 === h2)) {
            const m = r4 | h2;
            if (m === 5 || m === 10) t.transitions++;
            else t.transversions++;
          }
        }
      }
      for (let k = 0; k < 2; k++) {
        if ((k ? h2 : h1) === DEL) {
          if (open[k] === null) {
            open[k] = start + i;
            oneCopy[k] = a2;
          }
        } else if (open[k] !== null) {
          if (open[k] >= 0) runs[k].push([open[k], start + i, oneCopy[k]]);
          open[k] = null;
        }
      }
      if (f & (INS1 | INS2)) insOneCopy.set(start + i, a2);
      if (gq && gq[i] !== QUAL_MISSING) t.gq[gq[i]]++;
      if (dp && dp[i] !== QUAL_MISSING) t.dp[dp[i]]++;
      if (f & PHASED) {
        const id = ps ? ps[i] : 0;
        const pos = start + i;
        const b = blocks.get(id);
        if (!b) blocks.set(id, [pos, pos]);
        else {
          if (pos < b[0]) b[0] = pos;
          if (pos > b[1]) b[1] = pos;
        }
      }
    }
    // deletions that begin in the region and go on past it: followed to their ends
    let pos = end;
    const following = () => [0, 1].some((k) => open[k] !== null && open[k] >= 0);
    while (following()) {
      if (pos >= length) {
        for (let k = 0; k < 2; k++) if (open[k] !== null && open[k] >= 0) runs[k].push([open[k], length, oneCopy[k]]);
        break;
      }
      const b = Math.min(length, pos + 65536);
      const more = await readGt(pos, b);
      for (let k = 0; k < 2; k++) {
        if (open[k] === null || open[k] < 0) continue;
        let j = 0;
        while (j < more.length && norm(k ? more[j] & 15 : more[j] >> 4) === DEL) j++;
        if (j < more.length) {
          runs[k].push([open[k], pos + j, oneCopy[k]]);
          open[k] = null;
        } else if (b >= length) {
          runs[k].push([open[k], length, oneCopy[k]]);
          open[k] = null;
        }
      }
      pos = b;
    }
    // deletions: homozygous when both haplotypes have the same run, or there is one copy
    const key = (r) => r[0] + ':' + r[1];
    const second = new Set(runs[1].map(key));
    const same = new Set(runs[0].map(key).filter((k) => second.has(k)));
    runs.forEach((rs, k) =>
      rs.forEach(([a, b, one]) => {
        const both = same.has(a + ':' + b);
        if (both && k === 1) return; // (counted with haplotype 1)
        if (both || one) t.delHom++;
        else t.delHet++;
        t.delBases += b - a;
      })
    );
    // insertions and COMPLEX alleles, from the sidecar
    const events = new Map();
    for (const e of sidecar || []) {
      if (e.offset < start || e.offset >= end || (e.kind !== 'INS' && e.kind !== 'COMPLEX')) continue;
      const k = e.kind + ':' + e.offset;
      if (!events.has(k)) events.set(k, { kind: e.kind, off: e.offset, haps: new Map() });
      events.get(k).haps.set(e.hap, e.data);
    }
    for (const { kind, off, haps } of events.values()) {
      const sameBoth = haps.size === 2 && haps.get(1) === haps.get(2);
      if (kind === 'INS') {
        if (sameBoth) {
          t.insHom++;
          t.insBases += haps.get(1).length;
          continue;
        }
        for (const data of haps.values()) {
          if (insOneCopy.get(off)) t.insHom++;
          else t.insHet++;
          t.insBases += data.length;
        }
      } else if (sameBoth || (haps.size === 1 && haps.has(1) && (gt[off - start] & 15) === ABSENT)) t.complexHom++;
      else t.complexHet += haps.size;
    }
    t.phaseSpans = [...blocks.values()].map(([lo, hi]) => hi - lo + 1);
    return asDict(t);
  }

  /** gpxiltools.stats.Tally.as_dict, with the same keys */
  function asDict(t) {
    const rc = t.refCodes;
    const d = { bases: t.bases };
    if (t.hasRef) {
      const acgt = [1, 2, 4, 8].map((b) => rc[b] + rc[b | 16]);
      const N = rc[15] + rc[31];
      const gaps = rc[0] + rc[16];
      const known = acgt.reduce((a, b) => a + b, 0);
      const total = rc.reduce((a, b) => a + b, 0);
      d.reference = {
        A: acgt[0], C: acgt[1], G: acgt[2], T: acgt[3], N, gaps,
        ambiguous: total - known - N - gaps,
        soft_masked: rc.slice(17).reduce((a, b) => a + b, 0),
        gc: known ? pyRound((acgt[1] + acgt[2]) / known, 4) : null
      };
    } else d.reference = null;
    if (!t.hasGt) {
      for (const k of ['calls', 'substitutions', 'insertions', 'deletions', 'complex', 'phasing', 'gq', 'dp']) d[k] = null;
      return d;
    }
    d.calls = { called: t.called, not_called: t.notCalled, partly_called: t.partlyCalled, one_copy: t.oneCopy, filtered: t.filtered };
    const ts = t.transitions, tv = t.transversions;
    d.substitutions = { heterozygous: t.snvHet, homozygous: t.snvHom, transitions: t.hasRef ? ts : null, transversions: t.hasRef ? tv : null, ti_tv: t.hasRef && tv ? pyRound(ts / tv, 3) : null };
    d.insertions = { heterozygous: t.insHet, homozygous: t.insHom, bases: t.insBases };
    d.deletions = { heterozygous: t.delHet, homozygous: t.delHom, bases: t.delBases };
    d.complex = { heterozygous: t.complexHet, homozygous: t.complexHom };
    const spans = t.phaseSpans.slice().sort((a, b) => b - a);
    const total = spans.reduce((a, b) => a + b, 0);
    let n50 = null, run = 0;
    for (const s of spans) {
      run += s;
      if (2 * run >= total) {
        n50 = s;
        break;
      }
    }
    d.phasing = { heterozygous_substitutions_phased: t.snvHetPhased, fraction: t.snvHet ? pyRound(t.snvHetPhased / t.snvHet, 4) : null, phase_sets: spans.length, n50, largest: spans.length ? spans[0] : null };
    d.gq = distribution(t.gq);
    d.dp = distribution(t.dp);
    return d;
  }

  MG.gpxilStats = { count, pyRound };
})();
