import os, re

files = [
    'api/admin.js',
    'api/archivo.js',
    'api/baja.js',
    'api/inscripcion.js',
    'api/portal.js',
    'api/sesion.js',
    'api/_db.js',
    'api/cron-limpiar-archivos.js',
]

for fp in files:
    with open(fp, 'r', encoding='utf-8') as f:
        text = f.read()
    lines = text.splitlines()
    print(f"\n================ {fp} ================")
    # Find all function signatures
    func_pattern = re.compile(r'(?:async\s+)?(?:function\s+([a-zA-Z0-9_]+)?\s*\(([^)]*)\)|([a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*\{)')
    for idx, line in enumerate(lines, 1):
        m = func_pattern.search(line)
        if m:
            name = m.group(1) or m.group(3) or 'anonymous'
            params = m.group(2) if m.group(1) or not m.group(3) else m.group(4)
            print(f"L{idx}: function {name}({params})")
