import { loadPyodide } from '../vendor/pyodide/pyodide.mjs';

const base = new URL('../../', import.meta.url);
let python;
let sourceFiles;
try {
  python = await loadPyodide({ indexURL: new URL('../vendor/pyodide/', import.meta.url).href });
  const response = await fetch(new URL('data/python-files.json', base));
  if (!response.ok) throw new Error(`Course sample files: HTTP ${response.status}`);
  sourceFiles = await response.json();
  self.postMessage({ type: 'ready' });
} catch (err) {
  self.postMessage({ type: 'init-error', error: `Could not load browser Python: ${err.message}` });
}

const driver = `
import sys, io, json, traceback, code as console_code, os, shutil, ast, inspect
_payload = json.loads(_input_json)
_folder = '/home/pyodide/course-run'
os.chdir('/home/pyodide')
if os.path.exists(_folder):
    shutil.rmtree(_folder)
os.mkdir(_folder)
os.chdir(_folder)
for _name, _text in json.loads(_files_json).items():
    with open(_name, 'w', encoding='utf-8') as _f:
        _f.write(_text)
for _name, _text in (_payload.get('files') or {}).items():
    if not isinstance(_name, str) or '/' in _name or '\\\\' in _name or _name in ('.', '..'):
        raise ValueError('Use plain file names for extra files')
    with open(_name, 'w', encoding='utf-8') as _f:
        _f.write(str(_text))

class _CappedOutput(io.TextIOBase):
    def __init__(self):
        self.text = ''
        self.truncated = False
    def write(self, text):
        room = max(0, 65536 - len(self.text))
        self.text += text[:room]
        self.truncated |= len(text) > room
        return len(text)
    def flush(self):
        pass

_stdout, _stderr = _CappedOutput(), _CappedOutput()
_old_streams = sys.stdout, sys.stderr, sys.stdin
sys.stdout, sys.stderr = _stdout, _stderr
sys.stdin = io.StringIO(_payload.get('stdin') or '')
_exit = 0
_scope = {'__name__': '__main__', '__file__': '__main__.py'}
try:
    _source = _payload.get('code') or ''
    if _payload.get('mode') == 'repl':
        _console = console_code.InteractiveConsole(_scope)
        _has_prompts = any(line.startswith('>>>') for line in _source.splitlines())
        _more = False
        for _line in _source.splitlines():
            if _has_prompts:
                if _line.startswith(('>>>', '...')):
                    _line = _line[3:]
                    if _line.startswith(' '):
                        _line = _line[1:]
                else:
                    continue
            _more = _console.push(_line)
        if _more:
            _console.push('')
        if _stderr.text:
            _exit = 1
    else:
        _execution = eval(compile(_source, '__main__.py', 'exec', flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT), _scope)
        if inspect.isawaitable(_execution):
            await _execution
except SystemExit as _err:
    _exit = _err.code if isinstance(_err.code, int) else (1 if _err.code else 0)
    if _err.code and not isinstance(_err.code, int):
        print(_err.code, file=sys.stderr)
except BaseException:
    _exit = 1
    traceback.print_exc()
finally:
    sys.stdout, sys.stderr, sys.stdin = _old_streams
_result = json.dumps({'ok': _exit == 0, 'stdout': _stdout.text, 'stderr': _stderr.text,
                     'exit_code': _exit, 'truncated': _stdout.truncated or _stderr.truncated,
                     'timed_out': False})
`;

self.onmessage = async ({ data: { id, payload } }) => {
  if (!python) return;
  const started = performance.now();
  self.postMessage({ type: 'started', id });
  try {
    // sqlite3 is bundled in the core distribution. Browser networking still
    // follows browser CORS restrictions; raw sockets are unavailable.
    python.globals.set('_input_json', JSON.stringify(payload));
    python.globals.set('_files_json', JSON.stringify(sourceFiles));
    await python.runPythonAsync(driver);
    const result = JSON.parse(python.globals.get('_result'));
    result.duration_ms = Math.round(performance.now() - started);
    self.postMessage({ type: 'result', id, result });
  } catch (err) {
    self.postMessage({ type: 'result', id, result: {
      ok: false, stdout: '', stderr: err.message, exit_code: 1,
      duration_ms: Math.round(performance.now() - started), truncated: false, timed_out: false,
    } });
  }
};
