import esprima
import glob
import os

# If esprima is not installed, we can do lexical and scope analysis in Python
# Let's check with standard python
files = [
    'api/admin.js',
    'api/archivo.js',
    'api/baja.js',
    'api/inscripcion.js',
    'api/portal.js',
    'api/sesion.js',
    'api/_db.js',
    'api/cron-limpiar-archivos.js',
    'api/_auth.js',
    'api/_totp.js'
]

import re

for filepath in files:
    print(f"\n{'='*30}\nChecking {filepath}\n{'='*30}")
    content = open(filepath, 'r', encoding='utf-8').read()
    lines = content.splitlines()
    
    # Find all function declarations / methods
    # e.g. function foo(a, b) { or async foo(a, b) { or foo(a, b) {
    for idx, line in enumerate(lines, 1):
        # Check auditar(req, ...)
        if 'auditar(' in line:
            print(f"Line {idx}: {line.strip()}")
        # Check ipDe(req)
        if 'ipDe(' in line:
            print(f"Line {idx}: {line.strip()}")
