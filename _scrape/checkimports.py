"""Verify that every named import in the frontend resolves to an export."""
import os, re, sys

JS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'web', 'assets', 'js')
import_re = re.compile(r"import\s*\{([^}]*)\}\s*from\s*'([^']+)'", re.S)
problems = []

cache = {}
def exports_of(path):
    if path in cache: return cache[path]
    src = open(path, encoding='utf-8').read()
    names = set(re.findall(r'export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)', src))
    names |= set(re.findall(r'export\s*\{([^}]*)\}', src) and
                 sum([[n.strip().split(' as ')[-1].strip() for n in m.split(',') if n.strip()]
                      for m in re.findall(r'export\s*\{([^}]*)\}', src)], []))
    if re.search(r'export\s+default', src): names.add('default')
    cache[path] = names
    return names

for root, _, files in os.walk(JS):
    for f in files:
        if not f.endswith('.js'): continue
        path = os.path.join(root, f)
        src = open(path, encoding='utf-8').read()
        for names, target in import_re.findall(src):
            resolved = os.path.normpath(os.path.join(os.path.dirname(path), target))
            if not os.path.exists(resolved):
                problems.append(f"{path}: missing module {target}")
                continue
            available = exports_of(resolved)
            for raw in names.split(','):
                name = raw.strip()
                if not name: continue
                local = name.split(' as ')[0].strip()
                if local not in available:
                    problems.append(f"{os.path.relpath(path, JS)}: imports `{local}` from {target}, which does not export it")

print('\n'.join(problems) if problems else 'all imports resolve')
sys.exit(1 if problems else 0)
