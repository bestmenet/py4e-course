#!/usr/bin/env python3
"""Build the offline course model from the scraped raw material.

Inputs : ../data/{lessons,chapters,slides,assets}.json
Outputs: ../data/course.json      - the whole curriculum in one document
         ../data/search.json      - compact search index
         ../data/content.json     - chapter bodies (kept separate: big)
"""
import html as htmllib
import json
import os
import re

from bs4 import BeautifulSoup, NavigableString

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "..", "data")

# Which lecture deck belongs to which lesson slug.  Lesson 1 ("install") has no
# lecture of its own — its content is the setup guides — so it is absent here
# and the deck for chapter 1 belongs to lesson 2 alone.
DECK_BY_LESSON = {
    "intro": "01-intro",
    "memory": "02-expressions",
    "logic": "03-conditional",
    "functions": "04-functions",
    "loops": "05-iterations",
    "strings": "06-strings",
    "files": "07-files",
    "lists": "08-lists",
    "dictionary": "09-dictionaries",
    "tuples": "10-tuples",
    "regex": "11-regex",
    "network": "12-http",
    "servces": "13-webservices",
    "Objects": "14-objects",
    "database": "15-databases",
    "dataviz": "16-data-viz",
}

# The one lesson taught from the installation guides instead of a lecture
GUIDED_LESSON = "install"


def slugify(text, used=None):
    s = re.sub(r"[^\w\s-]", "", text.lower()).strip()
    s = re.sub(r"[\s_]+", "-", s)
    s = re.sub(r"-{2,}", "-", s)
    if used is not None:
        base, n = s, 2
        while s in used:
            s = "%s-%d" % (base, n)
            n += 1
        used.add(s)
    return s


# ------------------------------------------------------------------ code

REPL_MARK = re.compile(r"^\s*(>>>|\.\.\.)")


def classify_code(text):
    """A book <pre> is either a REPL transcript, a program listing or output."""
    lines = [l for l in text.split("\n") if l.strip()]
    if not lines:
        return "empty"
    if sum(1 for l in lines if REPL_MARK.match(l)) >= max(1, len(lines) // 3):
        return "repl"
    if re.search(r"^\s*(#|\"\"\"|'''|import |from |def |class |if |for |while |print\()", text, re.M):
        return "program"
    return "output"


def program_name(text):
    """Guess the script name a listing belongs to (from a shebang-free header)."""
    m = re.search(r"^\s*#\s*([\w./-]+\.py)\s*$", text, re.M)
    if m:
        return m.group(1)
    return None


# --------------------------------------------------------------- rewrite

EMAIL_GUARD = re.compile(r"^\[email&#160;protected\]$|^\[email protected\]$")


def transform_chapter(chapter, known_code, images_present):
    soup = BeautifulSoup(chapter["html"], "lxml")
    used_ids = set()

    # 1. strip the cloudflare email-obfuscation anchors (we keep the plain text)
    for a in soup.find_all("a", class_="__cf_email__"):
        a.replace_with(NavigableString("csev@umich.edu"))

    # 2. localise images
    for img in soup.find_all("img"):
        src = img.get("src", "")
        clean = re.sub(r"^(\.\./)+", "", src)
        if clean.startswith(("images/", "photos/")):
            local = clean.split("/", 1)[1] if clean.startswith("photos/") else clean.split("/", 1)[1]
            bucket = "photos" if clean.startswith("photos/") else "images"
            img["src"] = "/static/%s/%s" % (bucket, local)
            img["loading"] = "lazy"
            img["decoding"] = "async"
            if "style" in img.attrs:
                img["style"] = re.sub(r"height:\s*[\d.]+in;?", "", img["style"])
                if not img["style"].strip(" ;"):
                    del img["style"]
        else:
            img["src"] = src

    # 3. point py4e.com/code3 links at our local copy
    for a in soup.find_all("a", href=True):
        href = a["href"]
        m = re.match(r"https?://www\.py4e\.com/code3/(.+)$", href)
        if m:
            target = m.group(1)
            a["href"] = "/static/code/%s" % target
            a["class"] = list(a.get("class", [])) + ["code-download"]
            a["data-code"] = target
            a["download"] = ""
            a["data-local"] = "1"
            a["title"] = "Download %s — a local copy, no internet needed" % target
            # the book labels these links with the remote URL; now that the
            # file is local, the bare filename is the honest label
            if re.match(r"(https?://|www\.)", a.get_text(" ", strip=True)):
                a.string = target
            continue
        m = re.match(r"https?://www\.py4e\.com/code3/?$", href)
        if m:
            a["href"] = "/library"  # our own code library page
            continue
        if href.startswith("https://www.py4e.com/html3/"):
            a["href"] = "/read/" + href.rsplit("/", 1)[-1]
            a["data-internal"] = "1"
        elif href.startswith("https://www.py4e.com/book"):
            a["href"] = "/book"
            a["data-internal"] = "1"
        elif re.match(r"https?://(www\.)?py4e\.com/?$", href):
            a["href"] = "/"
            a["data-internal"] = "1"

    # 4. annotate code blocks, assign stable ids, make listings runnable
    blocks = []
    for i, pre in enumerate(soup.find_all("pre"), start=1):
        code_el = pre.find("code")
        text = code_el.get_text() if code_el else pre.get_text()
        kind = classify_code(text)
        lang = " ".join(pre.get("class") or []) or "text"
        lang = lang.split()[0]
        bid = "%s-code-%d" % (chapter["slug"], i)
        pre["id"] = bid
        pre["data-lang"] = lang
        pre["data-kind"] = kind
        pre["data-block"] = bid
        if kind in ("repl", "program"):
            pre["data-runnable"] = "1"
        name = program_name(text) if kind == "program" else None
        if name and name in known_code:
            pre["data-script"] = name
        blocks.append({"id": bid, "lang": lang, "kind": kind, "lines": len(text.splitlines()),
                       "script": name})

    # 5. headings -> anchors + toc
    toc = []
    for h in soup.find_all(["h1", "h2", "h3"]):
        text = " ".join(h.get_text(" ", strip=True).split())
        if not text or text == "Python for Everybody":
            if h.name == "h1":
                h["class"] = list(h.get("class", [])) + ["book-title"]
            continue
        hid = h.get("id") or slugify(text, used_ids)
        h["id"] = hid
        if not h.get("id") in used_ids:
            used_ids.add(hid)
        level = int(h.name[1])
        toc.append({"level": level, "text": text, "id": hid,
                    "kind": "section" if level <= 2 else "sub"})

    # 6. mark figure captions for styling
    for fig in soup.find_all("figure"):
        fig["class"] = list(fig.get("class", [])) + ["book-figure"]

    for dl in soup.find_all("dl"):
        dl["class"] = list(dl.get("class", [])) + ["book-dl"]
    for section in soup.find_all("section"):
        section["class"] = list(section.get("class", [])) + ["book-section"]

    # 7. drop the leftover empty float divs
    for div in soup.find_all("div"):
        if div.get("style", "").startswith("float:right") and not div.get_text(strip=True):
            div.decompose()

    return soup, toc, blocks


# ------------------------------------------------------------- search idx

STOP = set("""a an the and or of to in is are was were be been for on with as at by from that this
it its if then else when we you they he she i not no do does did can will would should could
have has had there their them these those what which who whom how why so such than too very
about into over under out up down more most other some any all each every both few own same
s t don now here also因为""".split())


def index_text(soup):
    for bad in soup.find_all(["script", "style"]):
        bad.decompose()
    return " ".join(soup.get_text(" ", strip=True).split())


# ------------------------------------------------------------------ main

def main():
    lessons = json.load(open(os.path.join(DATA, "lessons.json")))
    chapters_raw = json.load(open(os.path.join(DATA, "chapters.json")))
    decks = json.load(open(os.path.join(DATA, "slides.json")))
    assets = json.load(open(os.path.join(DATA, "assets.json")))

    code_files = sorted(m["path"].split("/", 1)[1] for m in assets
                        if m["category"] == "code-sample" and "error" not in m
                        and "/" not in m["path"].split("/", 1)[1])
    code_set = set(code_files)
    images_present = {m["path"] for m in assets if "error" not in m}

    deck_by_slug = {d["slug"]: d for d in decks}

    # is there a standalone program that matches each code listing?
    program_stems = {}
    for f in code_files:
        if f.endswith(".py"):
            program_stems[f] = open(os.path.join(ROOT, "..", "static", "code", f),
                                    encoding="utf-8", errors="replace").read()

    # ---- setup guides (lesson 1 is only links to these) -------------------
    guides = []
    guide_path = os.path.join(DATA, "guides.json")
    if os.path.exists(guide_path):
        guides = json.load(open(guide_path))
    guide_dir = os.path.join(DATA, "guides")
    os.makedirs(guide_dir, exist_ok=True)
    for g in guides:
        with open(os.path.join(guide_dir, "%s.json" % g["slug"]), "w") as fh:
            json.dump(g, fh, separators=(",", ":"))

    chapters = {}
    search_docs = []
    for raw in chapters_raw:
        soup, toc, blocks = transform_chapter(raw, code_set, images_present)
        body = soup.decode()
        chapters[raw["slug"]] = {
            "slug": raw["slug"],
            "title": raw["section_title"] or raw["book_title"],
            "book_title": raw["book_title"],
            "headings": raw["headings"],
            "toc": toc,
            "blocks": blocks,
            "html": body,
            "words": len(index_text(BeautifulSoup(body, "lxml")).split()),
            "images": raw["images"],
        }
        # search: one document per chapter section (split on h2)
        full = BeautifulSoup(body, "lxml")
        current = {"title": chapters[raw["slug"]]["title"], "parts": []}
        for el in full.find_all(["h1", "h2", "h3", "p", "pre", "li"]):
            if el.name in ("h1", "h2", "h3"):
                if current["parts"]:
                    search_docs.append(current)
                current = {"title": el.get_text(" ", strip=True),
                           "anchor": el.get("id", ""), "parts": []}
            else:
                current["parts"].append(el.get_text(" ", strip=True))
        if current["parts"]:
            search_docs.append(current)

    for i, doc in enumerate(search_docs):
        doc["chapter"] = None
    # attach chapter slug back
    for raw in chapters_raw:
        pass

    # rebuild with slug attached (simpler: re-walk)
    search_docs = []
    for raw in chapters_raw:
        ch = chapters[raw["slug"]]
        full = BeautifulSoup(ch["html"], "lxml")
        cur = {"title": ch["title"], "anchor": "", "chapter": ch["slug"], "parts": []}
        for el in full.find_all(["h1", "h2", "h3", "p", "pre", "li"]):
            if el.name in ("h1", "h2", "h3"):
                if cur["parts"]:
                    search_docs.append(cur)
                cur = {"title": el.get_text(" ", strip=True), "anchor": el.get("id", ""),
                       "chapter": ch["slug"], "parts": []}
            else:
                cur["parts"].append(el.get_text(" ", strip=True))
        if cur["parts"]:
            search_docs.append(cur)

    search = []
    for doc in search_docs:
        text = " ".join(doc["parts"])
        text = " ".join(text.split())
        if len(text) < 20:
            continue
        search.append({
            "t": doc["title"][:160],
            "c": doc["chapter"],
            "a": doc["anchor"],
            "x": text[:1400],
            "g": doc.get("guide"),
        })

    # lessons
    for lesson in lessons:
        deck_slug = DECK_BY_LESSON.get(lesson["slug"])
        deck = deck_by_slug.get(deck_slug) if deck_slug else None
        lesson["deck"] = deck["slug"] if deck else None
        lesson["deck_page_count"] = deck["page_count"] if deck else 0
        lesson["video_count"] = len(lesson["videos"])
        lesson["duration_seconds"] = 0
        for v in lesson["videos"]:
            d = v.get("duration")
            if d:
                bits = [int(x) for x in d.split(":")]
                secs = 0
                for b in bits:
                    secs = secs * 60 + b
                v["seconds"] = secs
                lesson["duration_seconds"] += secs
        lesson["chapter"] = lesson["chapter_slugs"][0] if lesson["chapter_slugs"] else None
        # lesson 1's content is the installation guides, not a lecture
        lesson["guide_count"] = len(guides) if lesson["slug"] == GUIDED_LESSON else 0
        search.append({
            "t": lesson["title"],
            "c": None,
            "a": lesson["slug"],
            "x": lesson["description"] + " " + " ".join(v["title"] for v in lesson["videos"]),
            "lesson": True,
        })

    course = {
        "title": "Python for Everybody",
        "subtitle": "Exploring Data Using Python 3",
        "author": "Dr. Charles R. Severance",
        "source": "https://www.py4e.com",
        "lessons": lessons,
        "chapters": [
            {"slug": c["slug"], "title": c["title"], "toc": c["toc"], "words": c["words"],
             "blocks": c["blocks"], "html": c["html"], "images": c["images"],
             "lesson": next((l["slug"] for l in lessons if l["slug"] in DECK_BY_LESSON
                             and DECK_BY_LESSON[l["slug"]] == c["slug"]), None)}
            for c in [chapters[r["slug"]] for r in chapters_raw]
        ],
        "decks": [{"slug": d["slug"], "stem": d["stem"], "page_count": d["page_count"],
                   "pdf": d["pdf"], "pptx": d["pptx"],
                   "pages": [{"n": p["n"], "image": p["image"].replace(".png", ".webp"),
                              "title": p.get("title"), "bullets": p.get("bullets", []),
                              "notes": p.get("notes", ""), "pdf_text": p.get("pdf_text", "")}
                             for p in d["pages"]]}
                  for d in decks],
        "code_files": code_files,
        "stats": {
            "lessons": len(lessons),
            "chapters": len(chapters),
            "videos": sum(len(l["videos"]) for l in lessons),
            "slides": sum(d["page_count"] for d in decks),
            "code_files": len(code_files),
            "words": sum(c["words"] for c in chapters.values()),
            "seconds": sum(l["duration_seconds"] for l in lessons),
        },
        "guides": [{"slug": g["slug"], "title": g["title"], "label": g["label"],
                    "blurb": g["blurb"], "words": g["words"], "toc": g["toc"],
                    "videos": g.get("videos", [])}
                   for g in guides],
    }
    # the setup guides are lesson 1's real content, so they count too
    course["stats"]["guides"] = len(guides)
    course["stats"]["words"] += sum(g["words"] for g in guides)

    # guides also belong in the search index
    for g in guides:
        soup = BeautifulSoup(g["html"], "lxml")
        current = {"title": g["title"], "anchor": "", "parts": []}
        sections = []
        for el in soup.find_all(["h1", "h2", "h3", "p", "pre", "li"]):
            if el.name in ("h1", "h2", "h3"):
                if current["parts"]:
                    sections.append(current)
                current = {"title": el.get_text(" ", strip=True), "anchor": el.get("id", ""),
                           "parts": []}
            else:
                current["parts"].append(el.get_text(" ", strip=True))
        if current["parts"]:
            sections.append(current)
        for section in sections:
            text = " ".join(" ".join(section["parts"]).split())
            if len(text) < 20:
                continue
            search.append({
                "t": section["title"][:160],
                "c": None,
                "a": section["anchor"],
                "g": g["slug"],
                "x": text[:1400],
            })

    # every document carries the same keys so the front end can branch on them
    for doc in search:
        doc.setdefault("g", None)
        doc.setdefault("lesson", False if "lesson" not in doc else doc["lesson"])
        doc.pop("guide", None)

    with open(os.path.join(DATA, "course.json"), "w") as fh:
        json.dump(course, fh, separators=(",", ":"))
    with open(os.path.join(DATA, "search.json"), "w") as fh:
        json.dump(search, fh, separators=(",", ":"))

    # per-chapter files so the reader only fetches what it shows
    chap_dir = os.path.join(DATA, "chapters")
    os.makedirs(chap_dir, exist_ok=True)
    for c in course["chapters"]:
        with open(os.path.join(chap_dir, "%s.json" % c["slug"]), "w") as fh:
            json.dump(c, fh, separators=(",", ":"))
    # deck files, same idea (decks carry a lot of text)
    deck_dir = os.path.join(DATA, "decks")
    os.makedirs(deck_dir, exist_ok=True)
    for d in course["decks"]:
        with open(os.path.join(deck_dir, "%s.json" % d["slug"]), "w") as fh:
            json.dump(d, fh, separators=(",", ":"))
    # slim the main course payload: chapters/decks become references
    slim = dict(course)
    slim["chapters"] = [{k: v for k, v in c.items() if k not in ("html", "images")}
                        for c in course["chapters"]]
    slim["decks"] = [{k: v for k, v in d.items() if k != "pages"} for d in course["decks"]]
    with open(os.path.join(DATA, "course.json"), "w") as fh:
        json.dump(slim, fh, separators=(",", ":"))

    s = course["stats"]
    print("lessons %(lessons)d chapters %(chapters)d videos %(videos)d slides %(slides)d "
          "code %(code_files)d words %(words)d watch %(seconds)d" % s)
    print("search docs:", len(search))
    print("course.json %.1f KB  search.json %.1f KB" % (
        os.path.getsize(os.path.join(DATA, "course.json")) / 1e3,
        os.path.getsize(os.path.join(DATA, "search.json")) / 1e3))


if __name__ == "__main__":
    main()
