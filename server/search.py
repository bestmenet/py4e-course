"""Relevance-ranked full-text search over the offline course corpus.

The corpus is built by ``_scrape/build_content.py`` into ``data/search.json``:
one document per book section plus one per lesson index entry.  Ranking is a
small BM25 with two adjustments that matter for course material:

* a title hit counts ~3x a body hit, because section titles in this book are
  unusually descriptive ("Opening files", "Looping through a dictionary");
* coverage of the whole query beats raw term frequency, so a short section
  that contains every term outranks a long one that repeats a single term.

Snippets are HTML-escaped *before* ``<mark>`` tags go in, so a caller may
safely drop them straight into ``innerHTML``.
"""
import html
import json
import math
import os
import re
from typing import Dict, List, Optional, Tuple

MARK_OPEN = "<mark>"
MARK_CLOSE = "</mark>"

STOPWORDS = set("""
a about above after again against all am an and any are aren as at be because been before being
below between both but by can cannot could couldn did didn do does doesn doing don down during
each few for from further had hadn has hasn have haven having he her here hers herself him
himself his how i if in into is isn it its itself just let me more most mustn my myself no nor
not now of off on once only or other ought our ours ourselves out over own same shan she should
shouldn so some such than that the their theirs them themselves then there these they this those
through to too under until up very was wasn we were weren what when where which while who whom
why will with won would wouldn you your yours yourself yourselves
""".split())

SPLIT_RE = re.compile(r"[^0-9a-zA-Z_.]+")
TOKEN_RE = re.compile(r"^[a-z0-9][a-z0-9_.]*$")


def _stem(token: str) -> str:
    """Very light English suffix stripping, for prose tokens only.

    Without this, a search for ``dictionary`` never matches the section titled
    "Dictionaries".  Identifiers (anything with ``_`` or ``.``, or containing
    digits) are left alone so ``list.append`` and ``re.findall`` stay exact.
    """
    if len(token) < 5 or not token.isalpha():
        return token
    if token.endswith("ies") and len(token) > 5:
        return token[:-3] + "y"
    for suffix in ("ations", "ation", "ings", "ing", "edly", "ed", "es", "s"):
        if token.endswith(suffix) and len(token) - len(suffix) >= 4:
            stem = token[: -len(suffix)]
            if suffix == "s" and stem.endswith(("s", "u", "i")):
                continue  # "class", "status", "analysis"
            if suffix == "es" and not stem.endswith(("s", "x", "z", "ch", "sh")):
                continue  # "files" -> "file", not "fil"
            return stem
    return token

K1 = 1.2
B = 0.75
TITLE_WEIGHT = 3.0
PHRASE_TITLE_BONUS = 12.0
PHRASE_BODY_BONUS = 2.5
COVERAGE_PENALTY = 0.35     # score multiplier per missing query term
SHORT_DOC_BOOST = 0.15      # weight of the brevity tie-breaker


def _tokenize(text: str) -> List[str]:
    """Lowercase, split on non-identifier characters, drop stopwords, stem.

    Identifiers keep their ``_`` and ``.`` so ``open_file`` and
    ``urllib.request`` survive, and their parts are added as well so a query
    for ``findall`` still matches ``re.findall``.  Both the raw token and its
    stem are emitted, so exact spellings keep their weight while the stem
    supplies recall.
    """
    out = []
    for raw in SPLIT_RE.split(text.lower()):
        if not raw:
            continue
        if not TOKEN_RE.match(raw):
            continue
        if raw not in STOPWORDS:
            out.append(raw)
            stemmed = _stem(raw)
            if stemmed != raw:
                out.append(stemmed)
        if len(raw) > 3 and ("_" in raw or "." in raw):
            for part in re.split(r"[_.]", raw):
                if len(part) > 1 and part not in STOPWORDS:
                    out.append(part)
                    stemmed = _stem(part)
                    if stemmed != part:
                        out.append(stemmed)
    return out


def _stem_set(terms: List[str]) -> set:
    """Query terms plus their stems, as a membership set."""
    out = set()
    for t in terms:
        out.add(t)
        out.add(_stem(t))
    return out


class SearchHit:
    """One ranked result, ready to serialise for the front end."""

    __slots__ = ("title", "title_html", "chapter", "anchor", "is_lesson",
                 "guide", "score", "snippet")

    def __init__(self, title: str, title_html: str, chapter: Optional[str],
                 anchor: str, is_lesson: bool, score: float, snippet: str,
                 guide: Optional[str] = None):
        self.title = title
        self.title_html = title_html
        self.chapter = chapter
        self.anchor = anchor
        self.is_lesson = is_lesson
        self.guide = guide
        self.score = score
        self.snippet = snippet

    def to_dict(self) -> Dict[str, object]:
        return {
            "title": self.title,
            "title_html": self.title_html,
            "chapter": self.chapter,
            "anchor": self.anchor,
            "is_lesson": self.is_lesson,
            "guide": self.guide,
            "score": round(self.score, 3),
            "snippet": self.snippet,
        }

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return "<SearchHit %.2f %s>" % (self.score, self.title)


def _mark(text: str, terms: List[str], escape: bool = True) -> str:
    """Escape ``text`` then wrap occurrences of ``terms`` in <mark>."""
    body = html.escape(text) if escape else text
    if not terms:
        return body
    # longest first so "dictionary" wins over "dict"
    pattern = "|".join(re.escape(t) for t in sorted(set(terms), key=len, reverse=True))
    return re.sub("(%s)" % pattern, MARK_OPEN + r"\1" + MARK_CLOSE, body, flags=re.I)


class SearchIndex:
    """Inverted index + BM25 scorer over the course corpus."""

    def __init__(self, docs: List[dict]):
        self.docs: List[dict] = [d for d in docs if isinstance(d, dict)]
        self.n = len(self.docs)
        self.doc_tokens: List[List[str]] = []
        self.doc_len: List[int] = []
        self.title_tokens: List[List[str]] = []
        self.postings: Dict[str, Dict[int, int]] = {}
        self.title_postings: Dict[str, Dict[int, int]] = {}
        self.freq: Dict[str, int] = {}
        self.lower_body: List[str] = []
        self.lower_title: List[str] = []

        for i, doc in enumerate(self.docs):
            title = str(doc.get("t") or "")
            body = str(doc.get("x") or "")
            t_tok = _tokenize(title)
            b_tok = _tokenize(body)
            self.title_tokens.append(t_tok)
            self.doc_tokens.append(b_tok)
            self.doc_len.append(max(len(b_tok), 1))
            self.lower_body.append(body.lower())
            self.lower_title.append(title.lower())
            for tok in t_tok:
                self.title_postings.setdefault(tok, {})[i] = \
                    self.title_postings.setdefault(tok, {}).get(i, 0) + 1
            for tok in b_tok:
                self.postings.setdefault(tok, {})[i] = \
                    self.postings.setdefault(tok, {}).get(i, 0) + 1
                self.freq[tok] = self.freq.get(tok, 0) + 1

        self.avg_len = (sum(self.doc_len) / self.n) if self.n else 1.0

    @classmethod
    def from_file(cls, path: str) -> "SearchIndex":
        with open(path, "r", encoding="utf-8") as fh:
            return cls(json.load(fh))

    def __len__(self) -> int:
        return self.n

    # -------------------------------------------------------------- scoring

    def _bm25(self, term: str, doc: int, postings: Dict[str, Dict[int, int]],
              length: int) -> float:
        docs_with = postings.get(term)
        if not docs_with:
            return 0.0
        tf = docs_with.get(doc, 0)
        if not tf:
            return 0.0
        df = len(docs_with)
        idf = math.log(1.0 + (self.n - df + 0.5) / (df + 0.5))
        norm = tf * (K1 + 1) / (tf + K1 * (1 - B + B * length / self.avg_len))
        return idf * norm

    def _score(self, doc: int, terms: List[str], phrase: str) -> float:
        score = 0.0
        for term in terms:
            score += self._bm25(term, doc, self.postings, self.doc_len[doc])
            score += TITLE_WEIGHT * self._bm25(term, doc, self.title_postings,
                                               max(len(self.title_tokens[doc]), 1))
        if not score:
            return 0.0
        if phrase:
            if phrase in self.lower_title[doc]:
                score += PHRASE_TITLE_BONUS * max(1.0, len(terms))
            elif phrase in self.lower_body[doc]:
                score += PHRASE_BODY_BONUS * max(1.0, len(terms))
        # How much of the *heading* the query explains.  A section actually
        # called "Dictionaries" should beat "Dictionary as a set of counters"
        # for the query "dictionary", and this is what decides that.
        title_tokens = set(self.title_tokens[doc])
        if title_tokens:
            matched = sum(1 for t in title_tokens if t in _stem_set(terms))
            title_cov = matched / float(len(title_tokens))
            score *= 0.85 + 0.9 * title_cov
        # brevity tie-break: a precise section should edge out a long blurb
        score *= 1.0 + SHORT_DOC_BOOST * (1.0 - min(self.doc_len[doc] / self.avg_len, 1.0))
        return score

    # --------------------------------------------------------------- public

    def search(self, query: str, limit: int = 25,
               chapters: Optional[List[str]] = None,
               lessons_only: bool = False) -> List[SearchHit]:
        """Rank documents for ``query``.

        ``chapters`` restricts results to those chapter slugs; because a
        non-empty chapter filter means "search inside these chapters", lesson
        documents (which have no chapter) are excluded whenever it is given.
        ``lessons_only`` keeps only lesson index entries and wins over
        ``chapters``.
        """
        query = (query or "").strip()
        if len(query) < 2:
            return []

        terms = _tokenize(query)
        if not terms:
            return []
        # de-duplicate but keep order, and remember the rarest terms
        seen = set()
        uniq = []
        for t in terms:
            if t not in seen:
                seen.add(t)
                uniq.append(t)
        phrase = " ".join(query.lower().split())

        candidates: Optional[set] = None
        title_candidates: set = set()
        for term in uniq:
            posting = set(self.postings.get(term, ()))
            title_candidates |= set(self.title_postings.get(term, ()))
            if candidates is None:
                candidates = posting
            else:
                candidates |= posting
        if not candidates:
            return []
        candidates |= title_candidates

        allowed: Optional[set] = None
        if lessons_only:
            allowed = {i for i, d in enumerate(self.docs) if d.get("lesson")}
        elif chapters:
            wanted = set(chapters)
            allowed = {i for i, d in enumerate(self.docs)
                       if d.get("c") in wanted and not d.get("lesson")}

        scored: List[Tuple[float, int]] = []
        for doc in candidates:
            if allowed is not None and doc not in allowed:
                continue
            score = self._score(doc, uniq, phrase)
            if score <= 0:
                continue
            # coverage: fraction of query terms actually in the document
            found = 0
            for term in uniq:
                if doc in self.postings.get(term, {}) or doc in self.title_postings.get(term, {}):
                    found += 1
            if found < len(uniq):
                score *= COVERAGE_PENALTY ** (len(uniq) - found)
            elif len(uniq) > 1:
                score *= 1.25
            scored.append((score, doc))

        scored.sort(key=lambda pair: (-pair[0], self.doc_len[pair[1]]))

        hits = []
        for score, doc in scored[:limit]:
            d = self.docs[doc]
            body = str(d.get("x") or "")
            hits.append(SearchHit(
                title=str(d.get("t") or ""),
                title_html=_mark(str(d.get("t") or ""), uniq),
                chapter=d.get("c"),
                anchor=str(d.get("a") or ""),
                is_lesson=bool(d.get("lesson")),
                score=score,
                snippet=_snippet(body, uniq, phrase),
                guide=d.get("g") or d.get("guide"),
            ))
        return hits

    def suggest(self, prefix: str, limit: int = 8) -> List[str]:
        """Vocabulary completions, most common in the corpus first."""
        prefix = (prefix or "").strip().lower()
        if len(prefix) < 2:
            return []
        matches = [t for t in self.freq if t.startswith(prefix)]
        matches.sort(key=lambda t: (-self.freq[t], t))
        return matches[:limit]


def _snippet(body: str, terms: List[str], phrase: str, width: int = 240) -> str:
    """Best window of ``body`` around the densest cluster of query terms."""
    if not body:
        return ""
    low = body.lower()
    positions = []
    for term in terms:
        start = 0
        while True:
            idx = low.find(term, start)
            if idx < 0:
                break
            positions.append(idx)
            start = idx + len(term)
            if len(positions) > 200:
                break
    if phrase and len(phrase) > 3:
        idx = low.find(phrase)
        if idx >= 0:
            positions.extend([idx] * 3)  # a phrase hit anchors the window hard

    if not positions:
        text = body[:width].strip()
        return html.escape(text) + ("…" if len(body) > width else "")

    positions.sort()
    # find the densest window of `width`
    best_start, best_count = positions[0], 0
    left = 0
    for right in range(len(positions)):
        while positions[right] - positions[left] > width:
            left += 1
        if right - left + 1 > best_count:
            best_count = right - left + 1
            best_start = positions[left]

    start = max(0, best_start - width // 4)
    end = min(len(body), start + width)
    # expand to word boundaries
    while start > 0 and body[start - 1] not in " \n\t":
        start -= 1
    while end < len(body) and body[end] not in " \n\t":
        end += 1
    text = body[start:end].strip()
    marked = _mark(text, terms)
    if start > 0:
        marked = "…" + marked
    if end < len(body):
        marked = marked + "…"
    return marked


_DEFAULT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             "..", "data", "search.json")
_CACHE: Optional[SearchIndex] = None


def load_default() -> SearchIndex:
    """Load (and memoise) the shipped corpus."""
    global _CACHE
    if _CACHE is None:
        _CACHE = SearchIndex.from_file(os.path.normpath(_DEFAULT_PATH))
    return _CACHE
