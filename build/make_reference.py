#!/usr/bin/env python3
"""Write build/reference.json: the GRCh38 reference's files on the Gpxil browser, for the studio's /data/grch38.

    python3 build/make_reference.py [MANIFEST]

MANIFEST is the Gpxil browser's data/grch38/manifest.json (a path or URL; by default the browser's own). The
studio shows these files under /data/grch38 and Python reads them over the web, a strip at a time.
"""
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = 'https://comparativechrono.github.io/Gpxil-browser/data/grch38/'


def order(f):
    """chr1 … chr22, chrX, chrY, chrM, then the rest"""
    name = f['p'].split('.')[0].removeprefix('chr')
    if name.isdigit():
        return (0, int(name), '')
    return (1, {'X': 0, 'Y': 1, 'M': 2}.get(name, 3), name)


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else BASE + 'manifest.json'
    if src.startswith(('http://', 'https://')):
        with urllib.request.urlopen(src, timeout=60) as r:
            m = json.load(r)
    else:
        m = json.load(open(src, encoding='utf-8'))
    files = {}
    for c in m['sequence']['contigs']:
        f = files.setdefault(c['file'], {'p': os.path.basename(c['file']), 'u': c['file'], 's': c.get('bytes', 0), 'contigs': []})
        f['contigs'].append(c['name'])
        f['s'] = max(f['s'], c.get('bytes', 0))
    genes = m.get('genes', {})
    out = {
        'assembly': m.get('assembly', 'GRCh38'),
        'source': m.get('sources', {}).get('sequence', ''),
        'genes_source': m.get('sources', {}).get('genes', ''),
        'base': BASE,
        'files': sorted(files.values(), key=order),
        'genes': {'index': genes.get('index', 'genes/index.json.gz'), 'count': genes.get('count'), 'transcripts': genes.get('transcripts')},
    }
    with open(os.path.join(HERE, 'reference.json'), 'w', encoding='utf-8') as fh:
        json.dump(out, fh, indent=1)
        fh.write('\n')
    print(f"build/reference.json: {len(out['files'])} files, {sum(f['s'] for f in out['files']) / 1e6:.0f} MB")


if __name__ == '__main__':
    main()
