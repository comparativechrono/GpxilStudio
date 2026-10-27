#!/usr/bin/env python3
"""Open GpxilStudio in headless Chromium and use it as a first session would: the Viewer on an example (its modes,
pointing at a pixel, a region typed in), the Tools tab (draw a region, check a file, encode the worked example,
pictures of TP53's protein and their sequences), the Files tab on a gpxil file, the terminal, the starter notebook,
an example workflow, and the help's buttons; on a phone too. With a copy of the GRCh38 reference (STUDIO_REFERENCE,
the Gpxil browser's site/data/grch38), also a chromosome of GRCh38 in the Viewer, in the terminal and in Python, and
a VCF encoded on it. Then, on a desktop, a later visit (the page loaded again): what the first visit made is still
there.

It needs Playwright and its Chromium. It serves the site itself, with range requests (serve.py). Only Pyodide is
fetched from the web (cdn.jsdelivr.net, through Python, so that a proxy in the environment is used, and kept in a
cache folder); every other request leaving the site is refused.

    python3 tests/browser_smoke.py [--cache DIR] [--shots DIR] [--page dev.html]
"""
import argparse
import asyncio
import functools
import hashlib
import importlib.util
import json
import os
import sys
import tempfile
import threading
import urllib.request
from http.server import ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALLOW = ("cdn.jsdelivr.net",)

SCENARIO = r"""
async (opts) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const wait = async (fn, ms = 120000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch (e) {} await sleep(100); } throw new Error('timed out: ' + fn.toString().slice(0, 100)); };
  const out = [];
  const check = (ok, what) => out.push((ok ? 'ok    ' : 'FAIL  ') + what);
  const fits = () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1;
  const val = (k) => { const row = document.querySelector(`.tl-field[data-key="${k}"]`); const i = row && row.querySelector('select, input, textarea'); return row && row.hidden ? null : i ? (i.type === 'checkbox' ? i.checked : i.value) : undefined; };
  const runTool = async (ms = 600000) => { await sleep(300); document.querySelector('.tl-run').click(); await wait(() => document.querySelector('.tl-done'), ms); return document.querySelector('.tl-result').innerText; };
  try {
    // the Viewer: the first tab, on HG002's TP53
    const V = await wait(() => MG.app.viewer);
    await V.ready;
    await wait(() => document.querySelector('.vw-canvas').width > 0, 30000);
    check(MG.app.currentBench === 'viewer' && /chr17:7,661,779-7,687,546/.test(document.querySelector('.vw-info').innerText), 'Viewer: the first tab, on TP53 in HG002’s chromosome 17');
    const c = document.querySelector('.vw-canvas'), r = c.getBoundingClientRect();
    c.dispatchEvent(new MouseEvent('mousemove', { clientX: r.left + 5, clientY: r.top + 5, bubbles: true }));
    check(/chr17:7,66\d,\d{3} · reference [ACGTNacgtn]/.test(document.querySelector('.vw-hover').innerText), 'Viewer: pointing at a pixel says what is there');
    for (const m of ['reference', 'genotype', 'haplotypes', 'flags', 'gq', 'dp', 'ps']) {
      V.modeSel.value = m;
      V.modeSel.dispatchEvent(new Event('change'));
      await wait(() => V.data && V.data.mode === m, 20000);
    }
    check(V.data.mode === 'ps' && document.querySelector('.vw-legend').innerText.length > 0, 'Viewer: every mode draws, with its key');
    V.regionIn.value = 'chr17:7,676,101-7,676,300';
    V.regionIn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await wait(() => V.data && V.data.start === 7676100 && V.data.end === 7676300, 20000);
    check(V.data.scale > 4 && fits(), `Viewer: a region typed in, 200 bases, drawn large (${V.data.scale} pixels a base)`);
    await MG.app.viewerOpen('/data/examples/worked-example.gpxil.tif');
    check(V.data && V.data.contig.name === 'chrT' && V.data.end === 10, 'Viewer: the worked example opens, all of it');
    if (opts.reference) {
      await MG.app.viewerOpen('/data/grch38/chr1.gpxil.tif', { region: 'chr1:100,000,001-100,050,000' });
      check(V.data && V.data.contig.name === 'chr1' && V.data.planes.ref && V.data.planes.ref.length === 50000, 'Viewer: a region of GRCh38 chromosome 1, read from the web');
    }

    // the Tools tab
    await MG.app.useTool('render', { input: '/data/examples/HG002_chr17.gpxil.tif' });
    await wait(() => val('region'), 20000);
    check(val('region') === 'chr17:7661779-7687546' && val('mode') === 'variants' && val('width') === '256', 'Tools: Draw a region suggests TP53, the variants and narrow rows for HG002');
    let res = await runTool();
    check(document.querySelector('.tl-done.ok') && MG.app.fs.exists('/home/user/results/HG002_chr17_chr17_7661779-7687546_variants.png') && !/DeprecationWarning/.test(res), 'Tools: Draw a region writes the picture');
    await MG.app.useTool('validate', { input: '/data/examples/HG002_chr17.gpxil.tif' });
    await runTool();
    check(document.querySelector('.tl-verdict.ok'), 'Tools: HG002’s file is valid, checksums and all');
    // (the examples go together: Make a gpxil file works out the reference from the VCF, and the other way round)
    await MG.app.useTool('encode', {});
    await sleep(300);
    check(val('reference') === '/data/examples/worked-example.fa' && val('vcf') === '/data/examples/worked-example.vcf', 'Tools: Make a gpxil file starts with the worked example');
    await MG.app.useTool('encode', { vcf: '/data/examples/HG002_TP53.vcf' });
    await sleep(300);
    check(val('reference') === '/data/grch38/chr17.gpxil.tif' && val('callable') === '/data/examples/HG002_TP53.bed', 'Tools: … with HG002’s VCF, chromosome 17 of GRCh38 and the regions called with confidence');
    MG.app.fs.copy('/data/examples/HG002_TP53.vcf', '/home/user/genomes/mine.vcf');
    await MG.app.useTool('encode', { vcf: '/home/user/genomes/mine.vcf' });
    await sleep(300);
    check(val('reference') === '' && /Choose the reference genome/.test(document.querySelector('.tl-check').textContent) && document.querySelector('.tl-run').disabled, 'Tools: … and with a VCF of one’s own, asks for its reference');
    MG.app.showHelp('h-walk-encode');
    document.querySelector('#h-walk-encode [data-no-ref]').click();
    await wait(() => MG.app.currentBench === 'tools' && val('noRef') === true, 20000).catch(() => null);
    check(val('noRef') === true && val('out') === '~/genomes/HG002_TP53.noref.gpxil.tif', 'Help: a button can tick a tool’s options (data-no-ref)');
    await MG.app.useTool('encode', { reference: '/data/examples/worked-example.fa', vcf: '/data/examples/worked-example.vcf' });
    await sleep(300);
    check(val('out') === '~/genomes/worked-example.gpxil.tif' && val('planes') === 'gt,flags', 'Tools: Make a gpxil file fills in its form');
    await runTool();
    check(document.querySelector('.tl-done.ok') && MG.app.fs.exists('/home/user/genomes/worked-example.gpxil.tif'), 'Tools: the worked example encoded');
    await MG.app.useTool('gpxil2pxil', { input: '/data/examples/HG002_chr17.gpxil.tif', annotation: '/data/examples/TP53.gtf', kinds: 'protein', haplotypes: 'all' });
    res = await runTool();
    check(/P72R/.test(res) && /3 pxil files/.test(res), 'Tools: TP53’s protein from the reference and both haplotypes, P72R and all');
    document.querySelectorAll('.tl-next button')[1].click();
    await wait(() => document.querySelector('.tl-toolhead') && /FASTA/.test(document.querySelector('.tl-toolhead').innerText), 20000);
    res = await runTool();
    const fa = await MG.app.fs.readText('/home/user/results/pxil-sequences.fa');
    const names = (fa.match(/^>\S+/gm) || []).sort();
    check(names.length === 3 && /MEEPQSDPSV/.test(fa), 'Tools: their sequences, back out of the pictures');
    check(JSON.stringify(names) === JSON.stringify(['>ENSP00000269305', '>ENSP00000269305_HG002-hap1', '>ENSP00000269305_HG002-hap2']), `Tools: … each with a name of its own (${names.join(' ')})`);
    MG.app.tools.go({ page: 'start' });
    await wait(() => document.querySelector('.pw-map svg'));
    check(document.querySelectorAll('.tl-task').length === 6 && fits(), 'Tools: the map and the common tasks');

    // the Files tab: a gpxil file's contigs and planes, read in the page
    await MG.app.editFile('/data/examples/HG002_chr17.gpxil.tif');
    await wait(() => /83,257,441/.test(document.querySelector('#edRoot').innerText), 20000).catch(() => null);
    check(/83,257,441/.test(document.querySelector('#edRoot').innerText) && /ref, gt, flags, gq, dp, ps/.test(document.querySelector('#edRoot').innerText), 'Files: what is in a gpxil file');
    // … and a pxil picture: whose sequence it is, and how it differs
    await MG.app.editFile('/home/user/results/pxil/TP53/TP53-201_ENSP00000269305_HG002-hap1.protein.pxil.png');
    await wait(() => /HG002, haplotype 1/.test(document.querySelector('#edRoot').innerText), 20000).catch(() => null);
    check(/HG002, haplotype 1/.test(document.querySelector('#edRoot').innerText) && /P72R/.test(document.querySelector('#edRoot').innerText), 'Files: a pxil picture of a haplotype’s protein says whose it is, and P72R');

    // the terminal
    await MG.app.showWorkbench('terminal');
    const T = MG.app.term;
    const run = async (cmd) => { const n0 = T.outEl.children.length; await T.type(cmd, true); await sleep(150); await wait(() => !T.busy, 300000); return Array.from(T.outEl.children).slice(n0).map((e) => e.textContent).join('\n'); };
    check(/106,992/.test(await run('gpxil info /data/examples/HG002_chr17.gpxil.tif')), 'Terminal: gpxil info');
    check(/^>chr17:7676101-7676160_hap1\n/m.test(await run('gpxil fasta /data/examples/HG002_chr17.gpxil.tif --which 1 --region chr17:7676101-7676160')), 'Terminal: gpxil fasta, a haplotype');
    check(/7676154\t\.\tG\tC/.test(await run('gpxil vcf /data/examples/HG002_chr17.gpxil.tif --region chr17:7676101-7676200 --no-nocall-blocks | grep -v "^#"')), 'Terminal: gpxil vcf, piped to grep: P72R');
    check(/\* TP53-201 +ENST00000269305/.test(await run("gpxil2pxil /data/examples/HG002_chr17.gpxil.tif TP53 -a /data/examples/TP53.gtf --list | grep -F '*'")), 'Terminal: gpxil2pxil --list, the canonical transcript marked');
    await run('viewer /data/examples/HG002_chr17.gpxil.tif chr17:7,676,101-7,676,200 --mode=haplotypes');
    await wait(() => MG.app.viewer.data && MG.app.viewer.data.mode === 'haplotypes' && MG.app.viewer.data.start === 7676100, 20000).catch(() => null);
    check(MG.app.currentBench === 'viewer' && MG.app.viewer.data.mode === 'haplotypes' && MG.app.viewer.data.start === 7676100, 'Terminal: viewer FILE REGION --mode=haplotypes');
    await MG.app.showWorkbench('terminal');
    if (opts.reference) {
      check(/248,956,422/.test(await run('gpxil info /data/grch38/chr1.gpxil.tif')), 'Terminal: GRCh38 chromosome 1, read from the web');
      check(/BRCA1-203/.test(await run('gpxil2pxil /data/grch38/chr17.gpxil.tif BRCA1 -k protein -o ~/results/brca1')), 'Terminal: gpxil2pxil with the Gpxil browser’s genes, on GRCh38');
    }

    // the starter notebook, every cell
    await MG.app.showWorkbench('notebook');
    await wait(() => MG.app.nbApp, 20000);
    await MG.app.nbApp.open('/home/user/notebooks/gpxil-in-python.ipynb');
    await sleep(500);
    const view = MG.app.nbApp.view;
    await view.runAll();
    const cells = view.cells.filter((x) => x.type === 'code');
    const errs = cells.map((x) => x.el.innerText).filter((t) => /Traceback|Error:/.test(t));
    if (opts.reference) check(!errs.length && cells.some((x) => x.el.querySelector('img')), `Notebook: gpxil in Python, every cell, with its picture${errs.length ? ': ' + errs[0].slice(0, 300) : ''}`);
    else check(errs.length <= 1, 'Notebook: gpxil in Python runs (the cell that reads GRCh38 from the web aside)');

    // a workflow
    await MG.app.workflowOpen('/data/examples/workflows/gene-pictures.workflow.json', 'run');
    await sleep(800);
    const go = Array.from(document.querySelectorAll('.tl-main button')).find((b) => b.textContent.trim() === 'Run');
    go.click();
    await wait(() => /Done: 2 steps/.test(document.querySelector('.tl-main').innerText), 300000);
    check(MG.app.fs.exists('/home/user/results/a-person-s-own-tp53-pictures-and-sequences/hg002-chr17/pxil-sequences.fa'), 'Workflows: gene pictures, run, its files in a folder of their own');

    // the help's buttons
    const help = document.querySelector('#helpBody');
    const b1 = document.querySelector('.help-page [data-viewer]');
    if (b1) {
      MG.app.showHelp(b1.closest('.help-page').id);
      b1.click();
      await wait(() => MG.app.currentBench === 'viewer', 20000);
      check(true, 'Help: a button opens the Viewer');
    }
    check(!!help && document.querySelectorAll('.help-page').length > 10, 'Help: the pages are there');
    if (opts.reference) {
      await MG.app.useTool('encode', { vcf: '/data/examples/HG002_TP53.vcf', reference: '/data/grch38/chr17.gpxil.tif' });
      await sleep(500);
      const ok = val('callable') === '/data/examples/HG002_TP53.bed';
      await runTool(900000);
      check(ok && document.querySelector('.tl-done.ok') && MG.app.fs.exists('/home/user/genomes/HG002_TP53.gpxil.tif'), 'Tools: HG002’s TP53 variants encoded on GRCh38 chromosome 17 from the web, with their callable regions');
    }
    check(fits(), 'the page fits the width of the screen');
  } catch (e) {
    out.push('FAIL  ' + (e && e.stack || e));
  }
  return out;
}
"""

LATER = r"""
async () => {
  const out = [];
  const check = (ok, what) => out.push((ok ? 'ok    ' : 'FAIL  ') + what);
  const fs = MG.app.fs;
  check(fs.exists('/home/user/genomes/worked-example.gpxil.tif') && fs.exists('/home/user/results/pxil-sequences.fa'), 'a later visit: the files made on the first are still there');
  const V = MG.app.viewer;
  if (V) await V.ready;
  check(!V || (V.data && V.data.contig), 'a later visit: the Viewer opens where it was');
  return out;
}
"""


def load_serve():
    spec = importlib.util.spec_from_file_location("studio_serve", os.path.join(ROOT, "serve.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def serve(reference):
    mod = load_serve()
    handler = type("H", (mod.Handler,), {"reference": reference or None, "log_message": lambda *a: None})
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(handler, directory=ROOT))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=os.path.join(tempfile.gettempdir(), "gpxilstudio-netcache"))
    ap.add_argument("--shots", default=None)
    ap.add_argument("--page", default="", help="another page of the site to open (default: index.html)")
    a = ap.parse_args()
    os.makedirs(a.cache, exist_ok=True)
    reference = os.environ.get("STUDIO_REFERENCE", "")
    if reference and not os.path.isdir(os.path.join(reference, "gpxil")):
        sys.exit(f"STUDIO_REFERENCE={reference} has no gpxil folder")
    from playwright.async_api import async_playwright

    refused = []

    async def external(route):
        url = route.request.url
        host = url.split("/")[2]
        if not any(host.endswith(h) for h in ALLOW):
            refused.append(url)
            await route.abort()
            return
        key = os.path.join(a.cache, hashlib.sha1(url.encode()).hexdigest())
        if not os.path.exists(key):
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (gpxilstudio tests)"})
            with urllib.request.urlopen(req, timeout=120) as r:
                body, ct = r.read(), r.headers.get("Content-Type", "application/octet-stream")
            with open(key, "wb") as fh:
                fh.write(body)
            with open(key + ".json", "w") as fh:
                json.dump({"ct": ct}, fh)
        with open(key, "rb") as fh:
            body = fh.read()
        with open(key + ".json") as fh:
            ct = json.load(fh)["ct"]
        await route.fulfill(status=200, body=body, headers={"Content-Type": ct, "Access-Control-Allow-Origin": "*"})

    httpd = serve(reference)
    url = "http://127.0.0.1:%d/" % httpd.server_address[1]
    failed = 0
    async with async_playwright() as p:
        for name, kw in (("desktop", dict(viewport={"width": 1440, "height": 900})),
                         ("phone", dict(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True))):
            browser = await p.chromium.launch()
            ctx = await browser.new_context(**kw)
            await ctx.route(lambda u: not u.startswith(url), external)
            page = await ctx.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            await page.goto(url + a.page)
            await page.wait_for_function("window.MG && MG.app && MG.app.isReady && MG.app.isReady()", timeout=60000)
            results = await asyncio.wait_for(page.evaluate(SCENARIO, {"reference": bool(reference)}), timeout=1800)
            if name == "desktop":
                await page.reload()
                await page.wait_for_function("window.MG && MG.app && MG.app.isReady && MG.app.isReady()", timeout=60000)
                results += await asyncio.wait_for(page.evaluate(LATER), timeout=300)
            print("--", name)
            for line in results:
                print(line)
            for e in errors:
                print("FAIL  page error:", e[:300])
            failed += sum(1 for line in results if line.startswith("FAIL")) + len(errors)
            if a.shots:
                os.makedirs(a.shots, exist_ok=True)
                await page.screenshot(path=os.path.join(a.shots, name + ".png"))
            await browser.close()
    httpd.shutdown()
    if refused:
        print("refused (never sent):", *sorted(set(u.split("?")[0] for u in refused))[:10], sep="\n  ")
    print("%d failed" % failed)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
