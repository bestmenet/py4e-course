"""Run short Python snippets for the local py4e course site.

Every call gets its own throw-away working directory (``tempfile.mkdtemp``)
that holds symlinks to the book's sample data -- ``mbox.txt``, ``romeo.txt``,
``words.txt`` and the rest of ``static/code`` -- so that a book example such
as ``open('mbox.txt')`` works with no extra setup.  The snippet itself runs
in a child ``python3 -I`` process whose cwd is that directory.

Honest limitations -- this is a convenience sandbox for a single-user,
offline course site, NOT a security boundary:

* The child runs as the same user as the server, so it can read, write and
  delete anything that user can.  There is no chroot, container or seccomp.
* The network is deliberately left open: chapters 11-13 fetch real URLs with
  ``urllib`` and ``socket``, and a failed request is the student's result.
* Only wall-clock time is limited.  There is no memory, CPU, disk or
  file-descriptor quota, and nothing stops a fork bomb.
* ``-I`` (isolated mode) keeps the sandbox off ``sys.path``, so a planted
  ``json.py`` cannot shadow the standard library, but a snippet can still
  import anything installed on the machine.

Run snippets only for people you would trust with a shell on this machine.
"""

import json
import math
import os
import platform
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from typing import Dict, List, Optional, Tuple

__all__ = [
    "CODE_DIR",
    "MAX_OUTPUT",
    "RunResult",
    "run_python",
    "run_repl",
    "run_file",
    "sample_files",
    "sandbox_info",
]

#: Directory holding the book's downloadable samples.  ``PY4E_CODE_DIR``
#: overrides it (read again on every call by ``_code_dir`` so a server process
#: can point it elsewhere after import).
CODE_DIR = os.environ.get("PY4E_CODE_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "code"))

#: Output is cut at this many characters per stream.
MAX_OUTPUT = 64 * 1024

#: Files the runner itself creates inside a sandbox; callers may not shadow them.
_REPL_INPUT_FILE = "__py4e_repl__.json"
_RESERVED_NAMES = frozenset({"__main__.py", _REPL_INPUT_FILE})

#: Upper bound on a caller-supplied timeout (seconds).
_MAX_TIMEOUT = 600.0

_ENV_KEEP = ("PATH", "HOME", "LANG", "LC_ALL", "TMPDIR")
_ENV_PROXY = ("no_proxy", "http_proxy", "https_proxy", "NO_PROXY", "HTTP_PROXY", "HTTPS_PROXY")


class RunResult:
    """Outcome of a single snippet execution."""

    def __init__(
        self,
        ok: bool,
        stdout: str = "",
        stderr: str = "",
        duration_ms: int = 0,
        timed_out: bool = False,
        truncated: bool = False,
        exit_code: Optional[int] = None,
    ) -> None:
        self.ok = ok
        self.stdout = stdout
        self.stderr = stderr
        self.duration_ms = duration_ms
        self.timed_out = timed_out
        self.truncated = truncated
        self.exit_code = exit_code

    def to_dict(self) -> Dict[str, object]:
        return {
            "ok": self.ok,
            "stdout": self.stdout,
            "stderr": self.stderr,
            "duration_ms": self.duration_ms,
            "timed_out": self.timed_out,
            "truncated": self.truncated,
            "exit_code": self.exit_code,
        }

    def __repr__(self) -> str:
        return "RunResult(ok={!r}, exit_code={!r}, duration_ms={!r}, timed_out={!r}, truncated={!r})".format(
            self.ok, self.exit_code, self.duration_ms, self.timed_out, self.truncated
        )


# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------


def _code_dir() -> str:
    """Current sample-data directory (honours ``PY4E_CODE_DIR``)."""
    return os.environ.get("PY4E_CODE_DIR", CODE_DIR)


def _as_text(value: object) -> str:
    """Coerce anything to text without raising (binary junk included)."""
    if isinstance(value, str):
        return value
    if isinstance(value, (bytes, bytearray)):
        return bytes(value).decode("utf-8", "replace")
    return str(value)


def _coerce_timeout(value: object, default: float) -> float:
    try:
        seconds = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default
    if not math.isfinite(seconds) or seconds <= 0:
        return default
    return min(seconds, _MAX_TIMEOUT)


def _child_env() -> Dict[str, str]:
    """A modest environment for the child -- never the parent's whole environ."""
    env = {name: os.environ[name] for name in _ENV_KEEP if name in os.environ}
    env.setdefault("PATH", "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin")
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env["PYTHONUNBUFFERED"] = "1"
    # Note: "-I" implies "-E", so the child ignores every PYTHON* variable
    # above; they are kept for clarity and in case -I is ever dropped.  The
    # "-u" flag in _execute is what really keeps output from being lost when
    # a runaway snippet is killed.
    for name in _ENV_PROXY:
        if name in os.environ:
            env[name] = os.environ[name]
    return env


def _make_sandbox() -> str:
    return tempfile.mkdtemp(prefix="py4e-run-")


def _cleanup(sandbox: str) -> None:
    shutil.rmtree(sandbox, ignore_errors=True)


def _cap(text: str) -> Tuple[str, bool]:
    if len(text) <= MAX_OUTPUT:
        return text, False
    return text[:MAX_OUTPUT] + "\n[output truncated]", True


def _error_result(message: str) -> RunResult:
    return RunResult(ok=False, stdout="", stderr=message, exit_code=None)


def _empty_ok() -> RunResult:
    return RunResult(ok=True, stdout="", stderr="", exit_code=0)


# ---------------------------------------------------------------------------
# sandbox contents
# ---------------------------------------------------------------------------


def _populate_sandbox(sandbox: str) -> None:
    """Link every sample file into ``sandbox`` (copy only if linking fails).

    Symlinks are effectively free for 134 entries; copying the 6 MB of sample
    data on every run would not be.
    """
    source = _code_dir()
    try:
        names = sorted(os.listdir(source))
    except OSError:
        # No sample directory (misconfigured install): the snippet still runs,
        # it just cannot open mbox.txt and friends.
        return

    for name in names:
        src = os.path.join(source, name)
        dst = os.path.join(sandbox, name)
        try:
            os.symlink(src, dst)
        except OSError:
            # Filesystems mounted without symlink support (or a name that is
            # already taken) fall back to a real copy.
            try:
                if os.path.isdir(src):
                    shutil.copytree(src, dst)
                else:
                    shutil.copy2(src, dst)
            except OSError:
                pass


def _write_extra_files(sandbox: str, files: Optional[Dict[str, str]]) -> None:
    """Write caller-supplied scratch files into the sandbox before running."""
    if not isinstance(files, dict):
        return
    for name, content in files.items():
        base = os.path.basename(_as_text(name))
        if not base or base in _RESERVED_NAMES or base.startswith("__py4e_"):
            continue
        target = os.path.join(sandbox, base)
        try:
            if os.path.lexists(target):
                # The target is usually a symlink to a real sample file;
                # unlink first so we never write through it into CODE_DIR.
                os.unlink(target)
            with open(target, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(_as_text(content))
        except OSError:
            pass


# ---------------------------------------------------------------------------
# subprocess execution
# ---------------------------------------------------------------------------


def _kill_process_group(proc: subprocess.Popen) -> None:
    # The child was started with start_new_session=True, so it leads its own
    # process group.  Signalling the group also takes down anything the
    # snippet spawned (subprocess.run("sleep 1000") and so on) instead of
    # leaving orphans behind; fall back to killing just the child if the
    # group is already gone.
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except OSError:
        try:
            proc.kill()
        except OSError:
            pass


def _execute(argv: List[str], sandbox: str, stdin: str, timeout: float) -> RunResult:
    started = time.monotonic()
    try:
        proc = subprocess.Popen(
            argv,
            cwd=sandbox,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=_child_env(),
            start_new_session=True,
        )
    except OSError as exc:
        return RunResult(
            ok=False,
            stderr="could not start Python: {}".format(exc),
            duration_ms=int((time.monotonic() - started) * 1000),
        )

    timed_out = False
    stdout = ""
    stderr = ""
    try:
        stdout, stderr = proc.communicate(input=stdin, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        timed_out = True
        stdout = _as_text(exc.output or "")
        stderr = _as_text(exc.stderr or "")
        _kill_process_group(proc)
        try:
            # Reap the child and collect whatever it managed to write before
            # it died (with -u that is everything it printed).
            stdout, stderr = proc.communicate(timeout=5.0)
        except subprocess.TimeoutExpired:
            # A grandchild that escaped the process group is still holding the
            # pipes open; keep the partial output we already have and move on.
            try:
                proc.kill()
            except OSError:
                pass

    duration_ms = int((time.monotonic() - started) * 1000)
    stdout = stdout or ""
    stderr = stderr or ""

    stdout, stdout_cut = _cap(stdout)
    stderr, stderr_cut = _cap(stderr)
    if timed_out:
        # Appended after capping so the explanation is never truncated away.
        note = "[stopped after {:.1f}s — possible infinite loop]".format(timeout)
        stderr = (stderr.rstrip("\n") + "\n" if stderr.strip() else "") + note

    exit_code = proc.returncode
    ok = (not timed_out) and exit_code == 0
    return RunResult(
        ok=ok,
        stdout=stdout,
        stderr=stderr,
        duration_ms=duration_ms,
        timed_out=timed_out,
        truncated=stdout_cut or stderr_cut,
        exit_code=exit_code,
    )


# ---------------------------------------------------------------------------
# transcript handling (the >>> / ... text used throughout the book)
# ---------------------------------------------------------------------------


def _strip_prompt(line: str) -> Tuple[str, Optional[str]]:
    """Split one physical line into (body, prompt) where prompt is >>> or ... ."""
    for token in (">>>", "..."):
        if line.startswith(token):
            rest = line[len(token):]
            # A prompt is followed by exactly one space; everything after it
            # is the student's code, including its own indentation.
            if rest.startswith(" "):
                rest = rest[1:]
            return rest, token
    return line, None


def _bracket_depth(text: str) -> int:
    """Bracket nesting at the end of ``text``, ignoring strings and comments."""
    depth = 0
    quote = ""
    triple = False
    escaped = False
    index = 0
    length = len(text)
    while index < length:
        char = text[index]
        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif triple and text.startswith(quote * 3, index):
                index += 3
                quote = ""
                triple = False
                continue
            elif not triple and char == quote:
                quote = ""
            index += 1
            continue
        if char == "#":
            newline = text.find("\n", index)
            if newline < 0:
                break
            index = newline
            continue
        if char in ("'", '"'):
            if text.startswith(char * 3, index):
                quote = char
                triple = True
                index += 3
                continue
            quote = char
            index += 1
            continue
        if char in "([{":
            depth += 1
        elif char in ")]}":
            depth = max(0, depth - 1)
        index += 1
    return depth


def _split_transcript(text: str) -> List[str]:
    """Split REPL text into complete statements.

    A statement continues while the accumulated source leaves a bracket open,
    while the previous line ends with ``:`` (a block header), while the next
    physical line is indented deeper than the statement started, or when the
    next line carries an explicit ``...`` prompt.  A bare ``...`` line is the
    blank line that closes a block.
    """
    statements: List[str] = []
    current: List[str] = []
    depth = 0
    last_prompt: Optional[str] = None

    def flush() -> None:
        nonlocal current, depth
        if current:
            statements.append("\n".join(current))
        current = []
        depth = 0

    for raw in text.splitlines():
        body, prompt = _strip_prompt(raw)

        if prompt == ">>>":
            flush()
            if body.strip():
                current = [body]
                depth = _bracket_depth(body)
            last_prompt = ">>>"
            continue

        if prompt == "...":
            if body.strip():
                current.append(body)
                depth = _bracket_depth("\n".join(current))
                last_prompt = "..."
            else:
                flush()
                last_prompt = "..."
            continue

        # Unprompted line: part of the current statement, or a new one?
        first_indent = len(current[0]) - len(current[0].lstrip()) if current else 0
        this_indent = len(body) - len(body.lstrip())
        continues = bool(current) and (
            depth > 0
            or last_prompt == "..."
            or current[-1].rstrip().endswith(":")
            or this_indent > first_indent
        )
        if continues:
            current.append(body)
            depth = _bracket_depth("\n".join(current))
        else:
            flush()
            if body.strip():
                current = [body]
                depth = _bracket_depth(body)
        last_prompt = None

    flush()
    return statements


#: Driver that turns a list of statements into one interpreter session.  It is
#: written into the sandbox and started with ``-I``; because -I keeps the
#: sandbox off sys.path, the imports below always come from the stdlib.
_REPL_DRIVER = r'''"""REPL driver generated by py4e-course/server/runner.py."""
import code
import json


def main():
    with open("__py4e_repl__.json", "r", encoding="utf-8") as handle:
        statements = json.load(handle)

    interpreter = code.InteractiveInterpreter({"__name__": "__main__"})
    for statement in statements:
        # "single" is the mode the real >>> prompt uses: expression values are
        # echoed through sys.displayhook, and tracebacks look like a session.
        if not interpreter.runsource(statement, "<stdin>", "single"):
            continue
        # A block is only complete once the blank line that ends it arrives.
        # Book transcripts usually keep that line, but not always.
        if not interpreter.runsource(statement + "\n", "<stdin>", "single"):
            continue
        # Still incomplete ("if x:" with no body, "x = ("): compile once more
        # so the student sees a genuine SyntaxError instead of silence.
        try:
            compile(statement + "\n", "<stdin>", "exec")
        except (SyntaxError, ValueError, OverflowError):
            interpreter.showsyntaxerror("<stdin>")


if __name__ == "__main__":
    main()
'''


# ---------------------------------------------------------------------------
# public API
# ---------------------------------------------------------------------------


def _guard(action, *args, **kwargs) -> RunResult:
    """Last line of defence: never let an exception escape the public API."""
    try:
        return action(*args, **kwargs)
    except Exception as exc:  # noqa: BLE001 - by contract this must not raise
        return _error_result("runner error: {}: {}".format(type(exc).__name__, exc))


def run_python(
    code: str,
    stdin: str = "",
    files: Optional[Dict[str, str]] = None,
    timeout: float = 8.0,
    mode: str = "script",
) -> RunResult:
    """Execute ``code`` in a fresh sandbox and report what happened."""
    return _guard(_run_python_impl, code, stdin, files, timeout, mode)


def _run_python_impl(code, stdin, files, timeout, mode) -> RunResult:
    if code is None:
        return _empty_ok()
    text = _as_text(code)
    if not text.strip():
        return _empty_ok()
    stdin_text = "" if stdin is None else _as_text(stdin)
    limit = _coerce_timeout(timeout, 8.0)
    if _as_text(mode).strip().lower() == "repl":
        return _run_repl_text(text, stdin_text, files, limit)
    return _run_script_text(text, stdin_text, files, limit)


def _run_script_text(code: str, stdin: str, files: Optional[Dict[str, str]], timeout: float) -> RunResult:
    sandbox = _make_sandbox()
    try:
        _populate_sandbox(sandbox)
        _write_extra_files(sandbox, files)
        path = os.path.join(sandbox, "__main__.py")
        with open(path, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(code)
            if not code.endswith("\n"):
                handle.write("\n")
        return _execute([sys.executable, "-I", "-u", path], sandbox, stdin, timeout)
    finally:
        _cleanup(sandbox)


def _run_repl_text(text: str, stdin: str, files: Optional[Dict[str, str]], timeout: float) -> RunResult:
    statements = _split_transcript(text)
    if not statements:
        return _empty_ok()
    sandbox = _make_sandbox()
    try:
        _populate_sandbox(sandbox)
        _write_extra_files(sandbox, files)
        with open(os.path.join(sandbox, _REPL_INPUT_FILE), "w", encoding="utf-8") as handle:
            json.dump(statements, handle, ensure_ascii=False)
        path = os.path.join(sandbox, "__main__.py")
        with open(path, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(_REPL_DRIVER)
        return _execute([sys.executable, "-I", "-u", path], sandbox, stdin, timeout)
    finally:
        _cleanup(sandbox)


def run_repl(
    transcript: str,
    stdin: str = "",
    files: Optional[Dict[str, str]] = None,
    timeout: float = 8.0,
) -> RunResult:
    """Run book-style REPL text (``>>>`` / ``...`` prompts) as one session."""
    return _guard(_run_repl_impl, transcript, stdin, files, timeout)


def _run_repl_impl(transcript, stdin, files, timeout) -> RunResult:
    if transcript is None:
        return _empty_ok()
    text = _as_text(transcript)
    if not text.strip():
        return _empty_ok()
    stdin_text = "" if stdin is None else _as_text(stdin)
    return _run_repl_text(text, stdin_text, files, _coerce_timeout(timeout, 8.0))


def run_file(
    name: str,
    args=None,
    stdin: str = "",
    timeout: float = 10.0,
) -> RunResult:
    """Run one ``.py`` file taken from the course sample directory."""
    return _guard(_run_file_impl, name, args, stdin, timeout)


def _run_file_impl(name, args, stdin, timeout) -> RunResult:
    text = "" if name is None else _as_text(name).strip()
    if not text:
        return _error_result("no file name given")
    if os.path.basename(text) != text or text in (".", ".."):
        return _error_result(
            "invalid file name: {!r} -- only a file directly inside the sample directory can be run".format(text)
        )
    if not text.endswith(".py"):
        return _error_result("{!r} is not a Python file (.py)".format(text))

    source_dir = _code_dir()
    source = os.path.join(source_dir, text)
    try:
        found = os.path.isfile(source)
    except OSError:
        found = False
    if not found:
        return _error_result("{!r} was not found in {!r}".format(text, source_dir))

    if isinstance(args, str):
        args = [args]
    script_args = [_as_text(item) for item in (args or [])]
    stdin_text = "" if stdin is None else _as_text(stdin)

    sandbox = _make_sandbox()
    try:
        _populate_sandbox(sandbox)
        target = os.path.join(sandbox, text)
        if not os.path.exists(target):
            return _error_result("could not place {!r} in the sandbox".format(text))
        argv = [sys.executable, "-I", "-u", target] + script_args
        return _execute(argv, sandbox, stdin_text, _coerce_timeout(timeout, 10.0))
    finally:
        _cleanup(sandbox)


def sample_files() -> List[str]:
    """Sorted names of the sample files every sandbox gets."""
    try:
        return sorted(os.listdir(_code_dir()))
    except OSError:
        return []


def sandbox_info() -> Dict[str, object]:
    """Describe what each sandbox is built from."""
    return {
        "python": platform.python_version(),
        # The directory whose entries are linked into every throw-away sandbox.
        "sandbox_dir": _code_dir(),
        "file_count": len(sample_files()),
    }
