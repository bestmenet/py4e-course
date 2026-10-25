"""Per-learner progress store.

A single local learner, so this is one JSON document in ``var/progress.json``
rather than a database.  Writes are atomic (temp file + rename) and guarded by
a lock so two browser tabs cannot interleave into a corrupt file.

Shape::

    {
      "lessons":   {"07-files": {"videos": ["abc"], "read": true, "slides": [12, 13],
                                 "updated": 1700000000.0}},
      "exercises": {"07-files:3": {"passed": true, "code": "...", "updated": ...}},
      "bookmarks": [{"chapter": "07-files", "anchor": "opening-files",
                     "title": "Opening files", "at": 1700000000.0}],
      "notes":     {"07-files": "line I want to remember"},
      "streak":    {"days": ["2026-10-24"], "last": "2026-10-24"}
    }
"""
import json
import os
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
VAR_DIR = os.path.join(ROOT, "var")
STORE = os.path.join(VAR_DIR, "progress.json")

_LOCK = threading.RLock()

EMPTY = {
    "lessons": {},
    "exercises": {},
    "bookmarks": [],
    "notes": {},
    "streak": {"days": [], "last": None},
}


def _blank():
    return json.loads(json.dumps(EMPTY))


def load():
    """Return the whole progress document, repaired if damaged."""
    with _LOCK:
        if not os.path.exists(STORE):
            return _blank()
        try:
            with open(STORE, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except (ValueError, OSError):
            return _blank()
        if not isinstance(data, dict):
            return _blank()
        for key, default in EMPTY.items():
            if key not in data or not isinstance(data[key], type(default)):
                data[key] = json.loads(json.dumps(default))
        return data


def save(data):
    with _LOCK:
        os.makedirs(VAR_DIR, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=VAR_DIR, prefix=".progress-", suffix=".json")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(data, fh, ensure_ascii=False)
            os.replace(tmp, STORE)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
    return data


def _touch_streak(data):
    today = time.strftime("%Y-%m-%d")
    streak = data.setdefault("streak", {"days": [], "last": None})
    days = streak.setdefault("days", [])
    if today not in days:
        days.append(today)
        days.sort()
        del days[:-400]          # keep the file small
    streak["last"] = today


def update(patch):
    """Merge a client patch into the store and return the new document.

    Accepted keys (anything else is ignored):

    ``lesson``    ``{"slug": str, "videos": [id, ...], "read": bool,
                    "slides": [int, ...], "guides": [slug, ...], "done": bool}``
                    — merged field-wise.  ``guides`` tracks the lesson-1
                    installation guides, which are the only content lesson 1
                    has.
    ``exercise``  ``{"id": str, "passed": bool, "code": str}``
    ``note``      ``{"chapter": str, "text": str}``
    ``bookmark``  ``{"chapter": str, "anchor": str, "title": str}`` —
                    toggles: posting the same anchor twice removes it.
    ``reset``     truthy → wipe everything back to the empty document.
    """
    with _LOCK:
        data = load()

        if patch.get("reset"):
            return save(_blank())

        lesson = patch.get("lesson")
        if isinstance(lesson, dict) and isinstance(lesson.get("slug"), str):
            slug = lesson["slug"]
            entry = data["lessons"].setdefault(
                slug, {"videos": [], "read": False, "slides": [], "guides": [], "done": False})
            videos = entry.setdefault("videos", [])
            for vid in lesson.get("videos") or []:
                if isinstance(vid, str) and vid not in videos:
                    videos.append(vid)
            slides = entry.setdefault("slides", [])
            for page in lesson.get("slides") or []:
                if isinstance(page, int) and page not in slides:
                    slides.append(page)
            guides = entry.setdefault("guides", [])
            for slug_name in lesson.get("guides") or []:
                if isinstance(slug_name, str) and slug_name not in guides:
                    guides.append(slug_name)
            for flag in ("read", "done"):
                if flag in lesson:
                    entry[flag] = bool(lesson[flag])
            entry["updated"] = time.time()
            _touch_streak(data)

        exercise = patch.get("exercise")
        if isinstance(exercise, dict) and isinstance(exercise.get("id"), str):
            key = exercise["id"]
            entry = data["exercises"].setdefault(key, {})
            if "passed" in exercise:
                entry["passed"] = bool(exercise["passed"])
            if isinstance(exercise.get("code"), str):
                entry["code"] = exercise["code"][:20000]
            entry["updated"] = time.time()
            _touch_streak(data)

        note = patch.get("note")
        if isinstance(note, dict) and isinstance(note.get("chapter"), str):
            data["notes"][note["chapter"]] = str(note.get("text") or "")[:20000]
            _touch_streak(data)

        bookmark = patch.get("bookmark")
        if isinstance(bookmark, dict) and isinstance(bookmark.get("chapter"), str):
            anchor = str(bookmark.get("anchor") or "")
            existing = [b for b in data["bookmarks"]
                        if b.get("chapter") == bookmark["chapter"]
                        and b.get("anchor") == anchor]
            if existing:
                data["bookmarks"] = [b for b in data["bookmarks"] if b not in existing]
            else:
                data["bookmarks"].insert(0, {
                    "chapter": bookmark["chapter"],
                    "anchor": anchor,
                    "title": str(bookmark.get("title") or "")[:200],
                    "at": time.time(),
                })
                del data["bookmarks"][200:]
            _touch_streak(data)

        return save(data)


def summary():
    """Compact completion numbers for the dashboard."""
    data = load()
    lessons = data.get("lessons", {})
    finished = sum(1 for v in lessons.values() if v.get("done"))
    exercises = data.get("exercises", {})
    return {
        "lessons_done": finished,
        "lessons_touched": len(lessons),
        "exercises_passed": sum(1 for v in exercises.values() if v.get("passed")),
        "exercises_attempted": len(exercises),
        "bookmarks": len(data.get("bookmarks", [])),
        "streak_days": len(data.get("streak", {}).get("days", [])),
    }
