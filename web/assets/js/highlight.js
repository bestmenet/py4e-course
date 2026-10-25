/* highlight.js — a small, dependency-free source highlighter.
   Emits HTML with .tok-* spans. Input is always escaped, so the output is
   safe to put in innerHTML. Covers the languages this course actually shows:
   Python (with >>> REPL transcripts), SQL, HTML/XML, JSON and bash. */

const PY_KEYWORDS = new Set(('False None True and as assert async await break class continue def del ' +
  'elif else except finally for from global if import in is lambda nonlocal not or pass raise return ' +
  'try while with yield match case').split(' '));

const PY_BUILTINS = new Set(('abs all any ascii bin bool bytearray bytes callable chr classmethod compile ' +
  'complex delattr dict dir divmod enumerate eval exec filter float format frozenset getattr globals ' +
  'hasattr hash help hex id input int isinstance issubclass iter len list locals map max memoryview min ' +
  'next object oct open ord pow print property range repr reversed round set setattr slice sorted ' +
  'staticmethod str sum super tuple type vars zip __import__ self cls exception').split(' '));

const PY_EXCEPTIONS = new Set(('ArithmeticError AssertionError AttributeError BaseException BlockingIOError ' +
  'BrokenPipeError BufferError BytesWarning ChildProcessError ConnectionAbortedError ConnectionError ' +
  'ConnectionRefusedError ConnectionResetError DeprecationWarning EOFError EnvironmentError Exception ' +
  'FileExistsError FileNotFoundError FloatingPointError FutureWarning GeneratorExit IOError ImportError ' +
  'ImportWarning IndentationError IndexError InterruptedError IsADirectoryError KeyError KeyboardInterrupt ' +
  'LookupError MemoryError ModuleNotFoundError NameError NotADirectoryError NotImplementedError ' +
  'OSError OverflowError PendingDeprecationWarning PermissionError ProcessLookupError RecursionError ' +
  'ReferenceError ResourceWarning RuntimeError RuntimeWarning StopAsyncIteration StopIteration ' +
  'SyntaxError SyntaxWarning SystemError SystemExit TabError TimeoutError TypeError UnboundLocalError ' +
  'UnicodeDecodeError UnicodeEncodeError UnicodeError UnicodeTranslateError UnicodeWarning ' +
  'UserWarning ValueError Warning ZeroDivisionError').split(' '));

const SQL_KEYWORDS = new Set(('select from where insert into values update set delete create table drop ' +
  'alter add primary key foreign references not null unique default and or in like between order by ' +
  'group having join inner left right outer on as limit offset distinct count sum avg min max ' +
  'autoincrement integer text real blob varchar int char constraint cascade if exists begin commit ' +
  'rollback index union all case when then else end').split(' '));

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const span = (cls, text) => `<span class="${cls}">${esc(text)}</span>`;

/* --------------------------------------------------------------- python */

function highlightPython(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let atLineStart = true;
  let expectPrompt = false;
  let inContinuation = false;

  const wordChar = /[A-Za-z0-9_]/;

  while (i < n) {
    const ch = src[i];

    // REPL prompt at the start of a line
    if (atLineStart) {
      let j = i;
      while (j < n && (src[j] === ' ' || src[j] === '\t')) j += 1;
      if (src.startsWith('>>>', j) || src.startsWith('...', j)) {
        out += esc(src.slice(i, j));
        out += span('prompt', src.substr(j, 3));
        i = j + 3;
        atLineStart = false;
        expectPrompt = true;
        inContinuation = src.startsWith('...', j);
        continue;
      }
      atLineStart = false;
      expectPrompt = false;
    }

    // newline
    if (ch === '\n') {
      out += ch;
      i += 1;
      atLineStart = true;
      continue;
    }

    // whitespace
    if (ch === ' ' || ch === '\t') { out += ch; i += 1; continue; }

    // comment
    if (ch === '#') {
      let j = src.indexOf('\n', i);
      if (j < 0) j = n;
      out += span('tok-c', src.slice(i, j));
      i = j;
      continue;
    }

    // triple-quoted string
    if ((ch === '"' || ch === "'") && src.startsWith(ch + ch + ch, i)) {
      const quote = ch + ch + ch;
      let j = i + 3;
      while (j < n && !src.startsWith(quote, j)) {
        if (src[j] === '\\') j += 1;
        j += 1;
      }
      j = Math.min(n, j + 3);
      out += span('tok-s', src.slice(i, j));
      i = j;
      inContinuation = false;
      continue;
    }

    // single-quoted string (with optional prefix: f, r, b, u, and combinations)
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && src[j] !== ch && src[j] !== '\n') {
        if (src[j] === '\\') j += 1;
        j += 1;
      }
      j = Math.min(n, j + 1);
      out += span('tok-s', src.slice(i, j));
      i = j;
      continue;
    }

    // string prefix  (f"..." / rb'...')
    if (/[fFrRbBuU]/.test(ch) && (src[i + 1] === '"' || src[i + 1] === "'")) {
      const quote = src[i + 1];
      let j = i + 2;
      while (j < n && src[j] !== quote && src[j] !== '\n') {
        if (src[j] === '\\') j += 1;
        j += 1;
      }
      j = Math.min(n, j + 1);
      out += span('tok-s', src.slice(i, j));
      i = j;
      continue;
    }

    // number
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let j = i;
      while (j < n && /[0-9a-fA-FxXoObB._eE+-]/.test(src[j])) {
        // stop a trailing '+'/'-' that is really an operator
        if ((src[j] === '+' || src[j] === '-') && !/[eE]/.test(src[j - 1])) break;
        j += 1;
      }
      out += span('tok-n', src.slice(i, j));
      i = j;
      continue;
    }

    // decorator
    if (ch === '@' && /[A-Za-z_]/.test(src[i + 1] || '')) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_.]/.test(src[j])) j += 1;
      out += span('tok-b', src.slice(i, j));
      i = j;
      continue;
    }

    // identifier / keyword
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < n && wordChar.test(src[j])) j += 1;
      const word = src.slice(i, j);
      let k = j;
      while (k < n && (src[k] === ' ' || src[k] === '\t')) k += 1;
      const isCall = src[k] === '(';

      if (PY_KEYWORDS.has(word)) out += span('tok-k', word);
      else if (PY_EXCEPTIONS.has(word)) out += span('tok-b', word);
      else if (PY_BUILTINS.has(word)) out += span('tok-b', word);
      else if (isCall) out += span('tok-f', word);
      else out += esc(word);
      i = j;
      continue;
    }

    // operators & punctuation
    if (/[+\-*/%=<>!&|^~:,.()\[\]{}]/.test(ch)) {
      out += span('tok-o', ch);
      i += 1;
      continue;
    }

    out += esc(ch);
    i += 1;
  }
  return out;
}

/* ------------------------------------------------------------------ sql */

function highlightSql(src) {
  const parts = src.split(/(--[^\n]*|'(?:[^']|'')*'|"[^"]*"|\b\d+(?:\.\d+)?\b)/);
  return parts.map((part) => {
    if (!part) return '';
    if (part.startsWith('--')) return span('tok-c', part);
    if (part.startsWith("'") || part.startsWith('"')) return span('tok-s', part);
    if (/^\d/.test(part)) return span('tok-n', part);
    return esc(part).replace(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g, (m, word) => (
      SQL_KEYWORDS.has(word.toLowerCase()) ? `<span class="tok-k">${word}</span>` : esc(word)
    ));
  }).join('');
}

/* -------------------------------------------------------------- html / xml */

function highlightMarkup(src) {
  const parts = src.split(/(&lt;|<\/?[A-Za-z!?][^>]*>)/);
  return src.replace(/(<!--[\s\S]*?-->)|(<\/?)([A-Za-z!?][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*)(\/?>)/g,
    (m, comment, open, name, attrs, close) => {
      if (comment) return span('tok-c', comment);
      const attrHtml = esc(attrs).replace(/([\w:.-]+)(\s*=\s*)("[^"]*"|'[^']*')?/g,
        (mm, key, eq, val) => `<span class="tok-b">${key}</span>${eq}${val ? span('tok-s', val) : ''}`);
      return span('tok-o', open) + span('tok-k', name) + attrHtml + span('tok-o', close);
    });
}

/* ----------------------------------------------------------------- json */

function highlightJson(src) {
  return esc(src).replace(/("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (m, key, str, lit, num) => {
      if (key) return `<span class="tok-f">${key}</span>`;
      if (str) return `<span class="tok-s">${str}</span>`;
      if (lit) return `<span class="tok-k">${lit}</span>`;
      if (num) return `<span class="tok-n">${num}</span>`;
      return m;
    });
}

/* ----------------------------------------------------------------- bash */

function highlightBash(src) {
  return src.split('\n').map((line) => {
    if (/^\s*#/.test(line)) return span('tok-c', line);
    return esc(line)
      .replace(/^(\s*\$)(\s)/, `<span class="prompt">$1</span>$2`)
      .replace(/(^|\s)(--?[\w-]+)/g, (m, pre, flag) => `${pre}<span class="tok-b">${flag}</span>`);
  }).join('\n');
}

/* --------------------------------------------------------------- dispatch */

export function highlight(code, lang = 'text') {
  const language = String(lang || 'text').toLowerCase().split(/\s+/)[0];
  try {
    switch (language) {
      case 'python': case 'py': case 'python3': return highlightPython(code);
      case 'sql': case 'sqlite': return highlightSql(code);
      case 'html': case 'xml': case 'svg': return highlightMarkup(code);
      case 'json': return highlightJson(code);
      case 'bash': case 'sh': case 'shell': case 'console': return highlightBash(code);
      default: return esc(code);
    }
  } catch {
    return esc(code);
  }
}

/** Highlight into an existing <code> element. */
export function highlightInto(codeEl, lang) {
  const raw = codeEl.textContent;
  codeEl.innerHTML = highlight(raw, lang);
  return codeEl;
}
