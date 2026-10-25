#!/usr/bin/env python3
"""Inventory scraper for py4e.com -> local data model.

Fetches the 17 lesson pages and 16 book chapters, extracts structured
metadata (slides, videos, references, exercises) and writes JSON into
../data/.  Downloaded HTML is kept under raw/ for re-parsing without
hitting the network again.
"""
import json
import os
import re
import sys
import time
import urllib.parse

import requests
from bs4 import BeautifulSoup

ROOT = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(ROOT, "raw")
DATA = os.path.join(ROOT, "..", "data")
BASE = "https://www.py4e.com"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) py4e-offline-course-builder"

LESSON_SLUGS = [
    "install", "intro", "memory", "logic", "functions", "loops", "strings",
    "files", "lists", "dictionary", "tuples", "regex", "network", "servces",
    "Objects", "database", "dataviz",
]

CHAPTER_SLUGS = [
    "01-intro", "02-variables", "03-conditional", "04-functions", "05-iterations",
    "06-strings", "07-files", "08-lists", "09-dictionaries", "10-tuples",
    "11-regex", "12-network", "13-web", "14-objects", "15-database", "16-viz",
]

os.makedirs(RAW, exist_ok=True)
os.makedirs(DATA, exist_ok=True)

session = requests.Session()
session.headers["User-Agent"] = UA


def fetch(url, cache_name, force=False):
    """Fetch url, caching the body under raw/cache_name."""
    path = os.path.join(RAW, cache_name)
    if os.path.exists(path) and not force and os.path.getsize(path) > 0:
        with open(path, "rb") as fh:
            return fh.read()
    for attempt in range(3):
        try:
            r = session.get(url, timeout=45)
            r.raise_for_status()
            with open(path, "wb") as fh:
                fh.write(r.content)
            return r.content
        except Exception as exc:  # noqa: BLE001
            if attempt == 2:
                print("  !! failed %s: %s" % (url, exc), file=sys.stderr)
                return b""
            time.sleep(1.5 * (attempt + 1))
    return b""


def clean_text(node):
    return " ".join(node.get_text(" ", strip=True).split())


# ---------------------------------------------------------------- lessons

def parse_lesson(slug, html):
    soup = BeautifulSoup(html, "lxml")
    main = soup.find("main") or soup
    h1 = main.find("h1")
    title = clean_text(h1) if h1 else slug

    desc_el = main.find(attrs={"property": "oer:description"})
    if desc_el is None:
        desc_el = main.find("p")
    description = clean_text(desc_el) if desc_el else ""

    # Pager gives neighbours + the "N / 17" position
    order = None
    pager = main.find("ul", class_="pager")
    if pager:
        for a in pager.find_all("a"):
            m = re.search(r"\((\d+)\s*/\s*(\d+)\)", a.get_text())
            if m:
                order = int(m.group(1))

    lesson = {
        "slug": slug,
        "title": title,
        "number": None,
        "name": re.sub(r"^\d+:\s*", "", title),
        "description": description,
        "slides": [],
        "videos": [],
        "references": [],
        "discussions": [],
        "tools": [],
        "other": [],
    }
    m = re.match(r"(\d+):\s*(.*)", title)
    if m:
        lesson["number"] = int(m.group(1))
        lesson["name"] = m.group(2)
    elif order:
        lesson["number"] = order

    section = None
    for el in main.find_all(["h2", "li"]):
        if el.name == "h2":
            section = clean_text(el).lower()
            continue
        a = el.find("a", href=True)
        if not a:
            continue
        text = clean_text(a)
        href = a["href"]
        entry = {"title": text, "url": href, "login_required": "Login Required" in text}
        if section == "slides":
            if href.lower().endswith(".pptx"):
                entry["kind"] = "pptx"
            elif href.lower().endswith(".pdf"):
                entry["kind"] = "pdf"
            else:
                entry["kind"] = "slide"
            lesson["slides"].append(entry)
        elif section == "videos":
            vid = None
            m = re.search(r"[?&]v=([\w-]{6,})", href)
            if m:
                vid = m.group(1)
            entry["kind"] = "youtube"
            entry["video_id"] = vid
            dm = re.match(r"^(.*?)\s*\((\d+:\d+(?::\d+)?)\)\s*$", text)
            if dm:
                entry["title"] = dm.group(1).strip()
                entry["duration"] = dm.group(2)
            lesson["videos"].append(entry)
        elif section == "references":
            entry["kind"] = "reference"
            lesson["references"].append(entry)
        elif section == "discussions":
            entry["kind"] = "discussion"
            lesson["discussions"].append(entry)
        elif section == "tools":
            entry["kind"] = "tool"
            lesson["tools"].append(entry)
        elif section:
            entry["kind"] = "other"
            entry["section"] = section
            lesson["other"].append(entry)

    return lesson


# --------------------------------------------------------------- chapters

DROP_TAGS = ["script", "style", "nav", "select", "link", "meta", "iframe", "form", "button"]


def parse_chapter(slug, html):
    soup = BeautifulSoup(html, "lxml")
    main = soup.find("main") or soup
    for tag in main.find_all(DROP_TAGS):
        tag.decompose()
    # the chapter <select> jumper is wrapped in a float:right div with no id
    for div in main.find_all("div"):
        if div.find("select"):
            div.decompose()
    title = slug
    h1s = main.find_all("h1")
    body_title = None
    for h in h1s:
        t = clean_text(h)
        if t and t != "Python for Everybody":
            body_title = t
            break
    if h1s:
        title = clean_text(h1s[0])
    # section headings: h1 (after the book title block) and h2
    headings = []
    for h in main.find_all(["h1", "h2", "h3"]):
        t = clean_text(h)
        if t and t not in ("Python for Everybody",):
            headings.append({"level": int(h.name[1]), "text": t, "id": h.get("id", "")})

    images = []
    for img in main.find_all("img", src=True):
        images.append(img["src"])

    return {
        "slug": slug,
        "book_title": title,
        "section_title": body_title,
        "headings": headings,
        "images": images,
        "html": main.decode_contents(),
    }


def collect_links(html, slug):
    soup = BeautifulSoup(html, "lxml")
    main = soup.find("main") or soup
    out = []
    for a in main.find_all("a", href=True):
        href = a["href"]
        if href.startswith(("http://", "https://", "mailto:", "#")):
            continue
        out.append({"href": href, "text": clean_text(a)})
    return out


def main():
    lessons = []
    for slug in LESSON_SLUGS:
        print("lesson", slug)
        html = fetch("%s/lessons/%s" % (BASE, slug), "lesson-%s.html" % slug)
        if not html:
            continue
        lessons.append(parse_lesson(slug, html))

    # attach data-file links that each lesson's reference chapter may mention
    chapters = []
    for slug in CHAPTER_SLUGS:
        print("chapter", slug)
        html = fetch("%s/html3/%s" % (BASE, slug), "book-%s.html" % slug)
        if not html:
            continue
        ch = parse_chapter(slug, html)
        ch["links"] = collect_links(html, slug)
        chapters.append(ch)

    # merge: which chapters does each lesson reference
    by_slug = {c["slug"]: c for c in chapters}
    for lesson in lessons:
        lesson["chapter_slugs"] = []
        for ref in lesson["references"]:
            m = re.search(r"/html3/(.+?)(?:/)?(?:#.*)?$", ref["url"])
            if m:
                ref["chapter_slug"] = m.group(1)
                if m.group(1) in by_slug:
                    lesson["chapter_slugs"].append(m.group(1))
            elif "/book" in ref["url"]:
                ref["chapter_slug"] = None

    with open(os.path.join(DATA, "lessons.json"), "w") as fh:
        json.dump(lessons, fh, indent=1)
    with open(os.path.join(DATA, "chapters.json"), "w") as fh:
        json.dump(chapters, fh, indent=1)

    print("\nlessons:", len(lessons), "chapters:", len(chapters))
    print("videos:", sum(len(l["videos"]) for l in lessons))
    print("slides:", sum(len(l["slides"]) for l in lessons))


if __name__ == "__main__":
    main()
