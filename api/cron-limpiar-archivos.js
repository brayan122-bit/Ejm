import { sql, asegurarEsquema } from './_db.js';
import { del } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }

  // 1. Verificación obligatoria de CRON_SECRET
  const cronSecret = (process.env.CRON_SECRET || '').trim();
  if (!cronSecret) {
    return res.status(500).json({ error: 'Configuración incompleta: falta CRON_SECRET en el servidor' });
  }
  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'No autorizado para ejecutar esta tarea programada' });
  }

  const blobHost = (process.env.BLOB_HOST || '').trim().toLowerCase();
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobHost || !token) {
    return res.status(500).json({ error: 'Configuración incompleta: se requiere BLOB_HOST y BLOB_READ_WRITE_TOKEN' });
  }

  try {
    await asegurarEsquema();

    // 2. Limpieza de intentos de login con más de 30 días
    let intentosLimpiados = 0;
    try {
      const borradosLogin = await sql`
        DELETE FROM intentos_login
         WHERE creado_en < now() - interval '30 days'
        RETURNING id`;
      intentosLimpiados = borradosLogin.length;
    } catch (eLogin) {
      console.warn('[cron] No se pudo limpiar intentos_login:', eLogin?.message);
    }

    // 3. Buscar archivos abandonados (no registrados de más de 1 hora) O marcados como pendiente_borrar
    const abandonados = await sql`
      SELECT id, pathname
        FROM archivos_pendientes
       WHERE (usado = false AND creado_en < now() - interval '1 hour')
          OR pendiente_borrar = true
       LIMIT 100`;

    if (!abandonados.length) {
      return res.status(200).json({ ok: true, eliminados: 0, intentos_login_eliminados: intentosLimpiados, mensaje: 'No hay archivos huérfanos pendientes' });
    }

    let eliminados = 0;
    for (const item of abandonados) {
      const url = `https://${blobHost}/${item.pathname}`;
      try {
        // Borrar primero el blob en almacenamiento
        await del(url, { token });
        // SOLO eliminar el registro de archivos_pendientes si del() tuvo éxito (garantiza reintento de fallidos)
        await sql`DELETE FROM archivos_pendientes WHERE id = ${item.id}`;
        eliminados++;
      } catch (e) {
        console.warn(`[cron] Falló borrado de ${item.pathname}, se reintentará en la próxima ejecución:`, e?.message);
      }
    }

    return res.status(200).json({ ok: true, eliminados });
  } catch (err) {
    console.error('[cron] Error en limpieza de archivos:', err);
    return res.status(500).json({ error: 'Error durante la limpieza de archivos' });
  }
}
