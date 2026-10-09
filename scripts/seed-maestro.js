/**
 * Script de inicialización para crear o restablecer el usuario maestro con hash scrypt.
 * Uso:
 *   node scripts/seed-maestro.js [email] [password] [--apply]
 * O mediante variables de entorno:
 *   ADMIN_EMAIL=admin@ejemplo.com ADMIN_PASSWORD=claveLargaSegura123! node scripts/seed-maestro.js [--apply]
 *
 * Si se pasa --apply y DATABASE_URL está configurada, se ejecuta en la base de datos Neon.
 * De lo contrario, imprime la sentencia SQL para ejecutar en la consola de Neon.
 */

import crypto from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1 };

function hashClave(clave) {
  const sal = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(clave), sal, 64, SCRYPT);
  return `s1$${sal.toString('base64')}$${h.toString('base64')}`;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const posArgs = args.filter(a => a !== '--apply');

  const email = (posArgs[0] || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = posArgs[1] || process.env.ADMIN_PASSWORD || '';

  if (!email || !email.includes('@')) {
    console.error('Error: Debe especificar un correo electrónico válido.');
    console.error('Uso: node scripts/seed-maestro.js <email> <password> [--apply]');
    process.exit(1);
  }

  if (!password || password.length < 12) {
    console.error('Error: La contraseña debe tener al menos 12 caracteres.');
    process.exit(1);
  }

  const hash = hashClave(password);

  const sqlStatement = `
INSERT INTO usuarios (email, nombre, hash, rol, activo, version, estado_acceso, debe_cambiar_clave)
VALUES ('${email.replace(/'/g, "''")}', 'Administrador Maestro', '${hash}', 'maestro', true, 1, 'activo', false)
ON CONFLICT (email) DO UPDATE SET
  hash = EXCLUDED.hash,
  rol = 'maestro',
  activo = true,
  estado_acceso = 'activo',
  version = usuarios.version + 1;
`.trim();

  console.log('=====================================================');
  console.log(' USUARIO MAESTRO GENERADO CON ÉXITO');
  console.log('=====================================================');
  console.log(`Correo:   ${email}`);
  console.log(`Hash:     ${hash}`);
  console.log('-----------------------------------------------------');
  console.log('Sentencia SQL generada (copiar y ejecutar en Neon SQL Console):');
  console.log(sqlStatement);
  console.log('=====================================================');

  if (apply) {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      console.error('Error: Se especificó --apply pero falta DATABASE_URL en el entorno.');
      process.exit(1);
    }
    try {
      const { neon } = await import('@neondatabase/serverless');
      const sql = neon(dbUrl);
      await sql`
        INSERT INTO usuarios (email, nombre, hash, rol, activo, version, estado_acceso, debe_cambiar_clave)
        VALUES (${email}, 'Administrador Maestro', ${hash}, 'maestro', true, 1, 'activo', false)
        ON CONFLICT (email) DO UPDATE SET
          hash = EXCLUDED.hash,
          rol = 'maestro',
          activo = true,
          estado_acceso = 'activo',
          version = usuarios.version + 1
      `;
      console.log('✔ Usuario maestro insertado/actualizado directamente en la base de datos.');
    } catch (err) {
      console.error('Error al aplicar a la base de datos:', err.message);
      process.exit(1);
    }
  }
}

main().catch(err => {
  console.error('Error inesperado:', err);
  process.exit(1);
});
