import re

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

# We will search each file for function scopes
for fp in files:
    with open(fp, 'r', encoding='utf-8') as f:
        code = f.read()
    
    lines = code.splitlines()
    print(f"\n==================== {fp} ====================")
    
    # Check if 'auditar(' is called and what first arg is
    for idx, l in enumerate(lines, 1):
        if 'auditar(' in l:
            print(f"L{idx}: {l.strip()}")
            
    # Check if 'req' is used
    # Look for functions
    # Let's see if any line references req when req is not in scope
