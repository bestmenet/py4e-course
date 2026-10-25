#!/usr/bin/env python3
"""Download every py4e.com asset the offline course needs.

Writes into ../static/{slides,images,code} and records a manifest at
../data/assets.json so later build steps can rewrite links.
"""
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import requests

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "..", "data")
STATIC = os.path.join(ROOT, "..", "static")
BASE = "https://www.py4e.com"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) py4e-offline-course-builder"

session = requests.Session()
session.headers["User-Agent"] = UA


def get(url, tries=3, timeout=120):
    last = None
    for i in range(tries):
        try:
            r = session.get(url, timeout=timeout)
            if r.status_code == 200:
                return r.content
            last = "HTTP %s" % r.status_code
        except Exception as exc:  # noqa: BLE001
            last = str(exc)
        time.sleep(1.0 * (i + 1))
    raise RuntimeError("%s -> %s" % (url, last))


def save(rel_path, content):
    dest = os.path.join(STATIC, rel_path)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "wb") as fh:
        fh.write(content)
    return len(content)


def build_job_list():
    """Return [(url, static_relative_path, category), ...]"""
    jobs = []

    lessons = json.load(open(os.path.join(DATA, "lessons.json")))
    for lesson in lessons:
        for slide in lesson["slides"]:
            name = slide["url"].rsplit("/", 1)[-1]
            jobs.append((slide["url"], "slides/downloads/%s" % name, "slide-deck"))

    # chapter images + photos
    chapters = json.load(open(os.path.join(DATA, "chapters.json")))
    seen = set()
    for ch in chapters:
        for src in ch["images"]:
            # ../images/x.svg  -> /images/x.svg
            clean = re.sub(r"^(\.\./)+", "", src)
            if clean in seen:
                continue
            seen.add(clean)
            url = "%s/%s" % (BASE, clean)
            jobs.append((url, clean, "chapter-image"))

    # the code3 sample directory: every published file
    idx = open(os.path.join(ROOT, "raw", "code3-index.html"), encoding="utf-8", errors="replace").read()
    names = set()
    for m in re.finditer(r'href="([^"?][^"]*)"', idx):
        href = m.group(1)
        if href in ("..", "https://github.com/csev/htaccess-indexes"):
            continue
        if "/" in href:
            continue
        names.add(href)
    for name in sorted(names):
        jobs.append(("%s/code3/%s" % (BASE, name), "code/%s" % name, "code-sample"))

    # extras
    for extra in ["cover.jpg", "images/pda.svg"]:
        jobs.append(("%s/%s" % (BASE, extra), "images/%s" % extra.rsplit("/", 1)[-1], "extra"))

    return jobs


def run():
    jobs = build_job_list()
    print("jobs:", len(jobs))
    manifest = []
    lock = []

    def work(job):
        url, rel, cat = job
        dest = os.path.join(STATIC, rel)
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            manifest.append({"url": url, "path": rel, "category": cat,
                             "bytes": os.path.getsize(dest), "cached": True})
            return
        try:
            body = get(url)
            size = save(rel, body)
            manifest.append({"url": url, "path": rel, "category": cat, "bytes": size})
            print("  ok  %-46s %8d" % (rel, size))
        except Exception as exc:  # noqa: BLE001
            print("  FAIL %-45s %s" % (rel, exc), file=sys.stderr)
            manifest.append({"url": url, "path": rel, "category": cat, "error": str(exc)})

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(work, jobs))

    manifest.sort(key=lambda m: m["path"])
    with open(os.path.join(DATA, "assets.json"), "w") as fh:
        json.dump(manifest, fh, indent=1)
    ok = [m for m in manifest if "error" not in m]
    bad = [m for m in manifest if "error" in m]
    total = sum(m.get("bytes", 0) for m in ok)
    print("\ndownloaded %d/%d files, %.1f MB" % (len(ok), len(manifest), total / 1e6))
    for b in bad:
        print("  missing:", b["url"])


if __name__ == "__main__":
    run()
