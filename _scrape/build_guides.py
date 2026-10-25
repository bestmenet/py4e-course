#!/usr/bin/env python3
"""Fetch the course's setup/installation guides and make them local pages.

Lesson 1 of PY4E is nothing but external links to these guides, so without
them the first lesson is an empty shell.  Output -> ../data/guides.json
"""
import json
import os
import re
import sys
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup, NavigableString

ROOT = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(ROOT, "raw")
DATA = os.path.join(ROOT, "..", "data")
BASE = "https://www.py4e.com"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) py4e-offline-course-builder"

GUIDES = [
    {"slug": "replit", "source": "software-replit.php", "label": "Replit (nothing to install)",
     "blurb": "Write and run Python entirely in a browser — no installation at all."},
    {"slug": "windows", "source": "software-win.php", "label": "Windows",
     "blurb": "Install Python and a text editor on Windows 11."},
    {"slug": "mac", "source": "software-mac.php", "label": "macOS",
     "blurb": "Check or install Python 3, add an editor and learn the Terminal."},
    {"slug": "editors", "source": "editors.php", "label": "Choosing a text editor",
     "blurb": "Why a plain-text editor matters, and which ones to avoid."},
    {"slug": "assignment", "source": "install.php", "label": "The first assignment",
     "blurb": "What the course expects you to hand in for lesson 1."},
]

VIDEO_RE = re.compile(r"(?:youtube\.com/watch\?v=|youtu\.be/)([\w-]{6,})")


def fetch(url, cache_name):
    path = os.path.join(RAW, cache_name)
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return open(path, "rb").read()
    r = requests.get(url, headers={"User-Agent": UA}, timeout=45)
    r.raise_for_status()
    os.makedirs(RAW, exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(r.content)
    return r.content


def youtube_ids(node):
    out = []
    for a in node.find_all("a", href=True):
        m = VIDEO_RE.search(a["href"])
        if m and m.group(1) not in out:
            out.append(m.group(1))
    return out


def convert(slug, html):
    soup = BeautifulSoup(html, "lxml")
    main = soup.find("main") or soup.body or soup
    for tag in main.find_all(["script", "style", "nav", "select", "link", "meta",
                              "iframe", "form", "button", "header", "footer"]):
        tag.decompose()
    for div in list(main.find_all("div")):
        if div.find("select") or (div.get("style", "").startswith("float:right")
                                  and not div.get_text(strip=True)):
            div.decompose()

    # the guides use bare <b>/<p> as headings; promote the obvious ones
    for b in main.find_all("b"):
        text = b.get_text(" ", strip=True)
        if not text:
            continue
        parent_text = b.parent.get_text(" ", strip=True) if b.parent else ""
        # a <b> that is the whole of its paragraph and is short reads as a heading
        if b.parent and b.parent.name == "p" and len(parent_text) <= len(text) + 2 and len(text) < 70:
            b.parent.name = "h2"
            b.parent.string = text
            continue
        b.name = "strong"

    # strip the "udhcp-macvpn-624:~ csev$" style hostnames down to the command
    for pre in main.find_all("pre"):
        text = pre.get_text()
        text = re.sub(r"^\s*[\w.-]+:(?:[~\w/.-]*)\s+[\w-]+\$\s?", "", text, flags=re.M)
        text = re.sub(r"^(\s*)\$\s", r"\1", text, flags=re.M)
        code = soup.new_tag("code")
        code.string = text
        pre.clear()
        pre.append(code)
        pre["class"] = ["bash"]

    # Every embedded guide needs a page title even when the source starts at h2.
    if not main.find("h1"):
        first_heading = main.find("h2")
        if first_heading:
            first_heading.name = "h1"

    # headings -> ids + toc
    toc, used = [], set()
    for h in main.find_all(["h1", "h2", "h3"]):
        text = " ".join(h.get_text(" ", strip=True).split())
        if not text:
            h.decompose()
            continue
        base = re.sub(r"[^\w\s-]", "", text.lower()).strip()
        base = re.sub(r"[\s_]+", "-", base) or "section"
        hid, n = base, 2
        while hid in used:
            hid = "%s-%d" % (base, n)
            n += 1
        used.add(hid)
        h["id"] = hid
        toc.append({"level": int(h.name[1]), "text": text, "id": hid})

    # Keep known guides local; resolve other relative links against their source.
    local_guides = {guide["source"]: "/setup/" + guide["slug"] for guide in GUIDES}
    for a in main.find_all("a", href=True):
        href = a["href"]
        if not href.startswith("#"):
            a["href"] = local_guides.get(href, urljoin(BASE + "/", href))
        if a["href"].startswith("http"):
            a["target"] = "_blank"
            a["rel"] = "noopener"

    for figure in main.find_all("figure"):
        figure["class"] = list(figure.get("class", [])) + ["book-figure"]

    title = toc[0]["text"] if toc else slug.replace("-", " ").title()
    # The app already owns its main landmark and #main-content skip target.
    # Embed the guide's content rather than copying the source page shell.
    body = main.decode_contents()
    return {
        "slug": slug,
        "title": title,
        "toc": toc,
        "videos": youtube_ids(BeautifulSoup(body, "lxml")),
        "html": body,
        "words": len(main.get_text(" ", strip=True).split()),
    }


def main():
    out = []
    for guide in GUIDES:
        url = "%s/%s" % (BASE, guide["source"])
        print("guide", guide["slug"], url)
        raw = fetch(url, guide["source"] + ".html")
        page = convert(guide["slug"], raw)
        page.update({k: guide[k] for k in ("label", "blurb", "source")})
        out.append(page)
        print("   %-11s %-46s %4d words  %d headings  %d videos"
              % (page["slug"], page["title"][:46], page["words"], len(page["toc"]),
                 len(page["videos"])))

    with open(os.path.join(DATA, "guides.json"), "w") as fh:
        json.dump(out, fh, indent=1)
    print("\nguides:", len(out))


if __name__ == "__main__":
    main()
