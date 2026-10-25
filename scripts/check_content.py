#!/usr/bin/env python3
"""Check bundled JSON, local content links and resources; external URLs are not fetched."""
import json
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]


class ContentLinks(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.refs, self.ids, self.tags = [], set(), set()
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag)
        attrs = dict(attrs)
        if 'id' in attrs:
            self.ids.add(attrs['id'])
        self.refs.extend(attrs[key] for key in ('href', 'src') if attrs.get(key))


def main():
    data = {p.relative_to(ROOT / 'data').as_posix(): json.loads(p.read_text())
            for p in (ROOT / 'data').rglob('*.json')}
    course = data['course.json']
    routes = {'/', '/syllabus', '/setup', '/read', '/book', '/videos', '/slides',
              '/library', '/playground', '/search', '/progress'}
    for route, key in [('lesson', 'lessons'), ('read', 'chapters'),
                       ('slides', 'decks'), ('setup', 'guides')]:
        routes.update(f'/{route}/{entry["slug"]}' for entry in course[key])
    for category, key in [('chapters', 'chapters'), ('decks', 'decks'), ('guides', 'guides')]:
        for entry in course[key]:
            assert f'{category}/{entry["slug"]}.json' in data, (category, entry['slug'])

    local_refs, external_refs, section_ids = 0, 0, {}
    for name, content in data.items():
        if not name.startswith(('chapters/', 'guides/')):
            continue
        links = ContentLinks(content['html'])
        assert 'h1' in links.tags, name
        assert not links.tags.intersection({'html', 'head', 'body', 'main', 'script', 'style'}), name
        assert 'main-content' not in links.ids, name
        section_ids[name] = links.ids
        for ref in links.refs:
            url = urlsplit(ref)
            if url.scheme or url.netloc:
                external_refs += 1
                continue
            local_refs += 1
            if not url.path:
                assert unquote(url.fragment) in links.ids, (name, ref)
            elif url.path.startswith('/static/'):
                assert (ROOT / unquote(url.path).lstrip('/')).is_file(), (name, ref)
            else:
                assert (url.path.rstrip('/') or '/') in routes, (name, ref)
    for entry in data['search.json']:
        if entry.get('lesson') or not entry.get('a'):
            continue
        category, slug = ('guides', entry['g']) if entry.get('g') else ('chapters', entry['c'])
        assert entry['a'] in section_ids[f'{category}/{slug}.json'], entry

    slides, downloads = 0, 0
    for name, deck in data.items():
        if not name.startswith('decks/'):
            continue
        assert len(deck['pages']) == deck['page_count'], name
        for page in deck['pages']:
            assert (ROOT / 'static' / page['image']).is_file(), (name, page['image'])
            slides += 1
        for key in ('pdf', 'pptx'):
            assert (ROOT / 'static' / deck[key]).is_file(), (name, deck[key])
            downloads += 1
    for name in course['code_files']:
        assert (ROOT / 'static/code' / name).is_file(), name
    print(f'PASS: {len(data)} JSON files, {len(routes)} routes, {local_refs} local HTML references, '
          f'{len(data["search.json"])} search targets, {slides} slide images, '
          f'{downloads} downloads, {len(course["code_files"])} sample files')
    print(f'External URL availability was not checked ({external_refs} references).')


if __name__ == '__main__':
    main()
