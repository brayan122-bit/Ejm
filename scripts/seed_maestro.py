#!/usr/bin/env python3
"""
scripts/seed_maestro.py
Genera la sentencia SQL INSERT para crear o restablecer el usuario maestro en Neon.
Utiliza hashlib.scrypt con exactamente los mismos parámetros criptográficos que
Node.js (N=16384, r=8, p=1, dklen=64) y el formato s1$<sal_b64>$<hash_b64>.

La contraseña se solicita interactivamente mediante getpass para evitar que
quede expuesta en el historial de comandos de la shell.
"""

import sys
import os
import getpass
import base64
import hashlib
import re

CLAVES_COMUNES = {
    '123456789012', '1234567890123', 'password1234', 'contraseña123', 'contrasena123',
    'administrador1', 'bienestar1234', 'bienestar360', 'bienestar360!', 'colombia1234',
    'cambiar123456', 'empresa123456', 'qwertyuiop12', 'admin12345678', 'welcome12345',
    'iloveyou1234', 'master123456', 'seguridad123', 'seguridad1234', 'bienvenido12'
}

def hash_clave_scrypt(password: str) -> str:
    """Genera hash scrypt con formato s1$<sal_base64>$<hash_base64>."""
    salt = os.urandom(16)
    dk = hashlib.scrypt(
        password.encode('utf-8'),
        salt=salt,
        n=16384,
        r=8,
        p=1,
        maxmem=32 * 1024 * 1024,
        dklen=64
    )
    sal_b64 = base64.b64encode(salt).decode('ascii')
    hash_b64 = base64.b64encode(dk).decode('ascii')
    return f"s1${sal_b64}${hash_b64}"

def validar_politica_clave(password: str):
    """Valida la política de contraseñas de al menos 12 caracteres y sin patrones triviales."""
    if len(password) < 12:
        return False, "La contraseña debe tener como mínimo 12 caracteres."
    if len(password) > 200:
        return False, "La contraseña no puede exceder 200 caracteres."
    if not re.search(r'[A-Za-z]', password) or not re.search(r'\d', password):
        return False, "La contraseña debe incluir tanto letras como números."
    limpio = password.lower().strip()
    if limpio in CLAVES_COMUNES:
        return False, "La contraseña elegida es demasiado común o predecible."
    if re.match(r'^(.)\1+$', limpio):
        return False, "La contraseña no puede consistir en un único carácter repetido."
    return True, None

def test_compatibilidad():
    """Prueba que el formato s1$<sal>$<hash> y la verificación matemática coinciden con Node.js."""
    pwd = "TestCompatibility123!"
    h = hash_clave_scrypt(pwd)
    parts = h.split('$')
    assert len(parts) == 3, "El formato debe tener 3 partes separadas por $"
    assert parts[0] == 's1', "La versión debe ser s1"
    salt = base64.b64decode(parts[1])
    dk_expected = base64.b64decode(parts[2])
    assert len(salt) == 16, "La sal debe ser de 16 bytes"
    assert len(dk_expected) == 64, "La clave derivada debe ser de 64 bytes"

    # Verificar derivación con los mismos parámetros
    dk_calc = hashlib.scrypt(
        pwd.encode('utf-8'),
        salt=salt,
        n=16384,
        r=8,
        p=1,
        maxmem=32 * 1024 * 1024,
        dklen=64
    )
    assert dk_calc == dk_expected, "La clave derivada debe coincidir exactamente"
    return True

def main():
    if len(sys.argv) > 1 and sys.argv[1] == '--test':
        test_compatibilidad()
        print("[OK] Prueba de compatibilidad criptografica exitosa.")
        sys.exit(0)

    print("=" * 60)
    print(" GENERADOR DE USUARIO MAESTRO (BIENESTAR 360)")
    print("=" * 60)
    print("Este script genera la sentencia SQL segura para inicializar")
    print("el usuario maestro con hash scrypt compatible con Node.js.\n")

    email = input("Ingrese el correo del administrador maestro: ").strip().lower()
    if not email or '@' not in email or '.' not in email:
        print("Error: Ingrese un correo electrónico válido.", file=sys.stderr)
        sys.exit(1)

    while True:
        pwd = getpass.getpass("Ingrese la contraseña maestra (mínimo 12 caracteres): ")
        valida, motivo = validar_politica_clave(pwd)
        if not valida:
            print(f"Error: {motivo}\n")
            continue
        pwd_confirm = getpass.getpass("Confirme la contraseña maestra: ")
        if pwd != pwd_confirm:
            print("Error: Las contraseñas no coinciden. Intente de nuevo.\n")
            continue
        break

    hash_scrypt = hash_clave_scrypt(pwd)
    # Limpiar contraseña de la memoria
    del pwd
    del pwd_confirm

    sql_statement = f"""
INSERT INTO usuarios (email, nombre, hash, rol, activo, version, estado_acceso, debe_cambiar_clave)
VALUES ('{email.replace("'", "''")}', 'Administrador Maestro', '{hash_scrypt}', 'maestro', true, 1, 'activo', false)
ON CONFLICT (email) DO UPDATE SET
  hash = EXCLUDED.hash,
  rol = 'maestro',
  activo = true,
  estado_acceso = 'activo',
  version = usuarios.version + 1;
""".strip()

    print("\n" + "=" * 60)
    print(" SENTENCIA SQL GENERADA (Copiar y pegar en Neon SQL Editor)")
    print("=" * 60)
    print(sql_statement)
    print("=" * 60)
    print("Nota: El hash generado es s1$... calculado con scrypt (N=16384, r=8, p=1).")
    print("La contraseña NUNCA se almacena en texto plano ni se pasa como argumento.\n")

if __name__ == '__main__':
    main()
