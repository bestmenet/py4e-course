#!/usr/bin/env python3
"""Export a complete static course, including deep-link entry points."""
import argparse
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='/py4e-course/')
    args = parser.parse_args()
    base = '/' + args.base.strip('/') + '/' if args.base.strip('/') else '/'
    out = ROOT / 'dist'
    if out.exists():
        shutil.rmtree(out)
    out.mkdir()
    shutil.copytree(ROOT / 'web/assets', out / 'assets')
    shutil.copytree(ROOT / 'data', out / 'data')
    shutil.copytree(ROOT / 'static', out / 'static')
    course = json.loads((ROOT / 'data/course.json').read_text())
    kinds = {'.py': 'python', '.txt': 'data', '.csv': 'data', '.json': 'data',
             '.html': 'html', '.xml': 'xml', '.sql': 'sql', '.db': 'database', '.zip': 'archive'}
    listing, python_files = [], {}
    for name in course['code_files']:
        path = ROOT / 'static/code' / name
        if not path.is_file():
            raise FileNotFoundError(path)
        listing.append({'name': name, 'bytes': path.stat().st_size,
                        'kind': kinds.get(path.suffix.lower(), 'other')})
        if path.suffix.lower() not in ('.db', '.zip', '.png', '.jpg', '.jpeg'):
            python_files[name] = path.read_text(encoding='utf-8', errors='replace')
    (out / 'data/code-index.json').write_text(json.dumps({'count': len(listing), 'files': listing}))
    (out / 'data/python-files.json').write_text(json.dumps(python_files))
    shell = (ROOT / 'web/index.html').read_text()
    shell = shell.replace('<head>', f'<head>\n  <base href="{base}">')
    shell = shell.replace('="/assets/', f'="{base}assets/')
    shell = shell.replace(' — offline course', ' — complete course')
    shell = shell.replace('assembled into one offline site', 'assembled into one complete course site')
    shell = shell.replace('Every asset it uses is served locally', 'The course runs in your browser')
    routes = ['', 'syllabus', 'setup', 'read', 'book', 'videos', 'slides', 'library',
              'playground', 'search', 'progress']
    routes += ['lesson/' + x['slug'] for x in course['lessons']]
    routes += ['read/' + x['slug'] for x in course['chapters']]
    routes += ['slides/' + x['slug'] for x in course['decks']]
    routes += ['setup/' + x['slug'] for x in course['guides']]
    for route in routes:
        folder = out / route
        folder.mkdir(parents=True, exist_ok=True)
        (folder / 'index.html').write_text(shell)
    (out / '404.html').write_text(shell)
    (out / '.nojekyll').touch()
    # Verify every published page has a shell and all bundled content exists.
    for category, key in [('chapters', 'chapters'), ('decks', 'decks'), ('guides', 'guides')]:
        for entry in course[key]:
            path = out / 'data' / category / (entry['slug'] + '.json')
            json.loads(path.read_text())
    print(f'Built {len(routes)} routes, {len(listing)} sample files at {base}')


if __name__ == '__main__':
    main()
