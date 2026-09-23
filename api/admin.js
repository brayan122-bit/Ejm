// Entrega las inscripciones y las bajas a la página /admin, solo con la contraseña correcta.
import crypto from 'node:crypto';
import { sql, sqlBajas, asegurarTabla, asegurarTablaBajas, ipDe, crearLimitador } from './_db.js';

const fallos = crearLimitador(8, 15 * 60 * 1000); // 8 intentos fallidos por IP cada 15 minutos

function igual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }
  const clave = process.env.ADMIN_PASSWORD || '';
  if (clave.length < 12) {
    return res.status(500).json({ error: 'Falta configurar ADMIN_PASSWORD en Vercel (mínimo 12 caracteres).' });
  }

  const ip = ipDe(req);
  if (fallos.excedido(ip)) return res.status(429).json({ error: 'Demasiados intentos fallidos. Espere 15 minutos.' });

  const enviada = req.headers['x-admin-password'] || '';
  if (!igual(enviada, clave)) {
    fallos.registrar(ip);
    await new Promise(r => setTimeout(r, 800));
    return res.status(401).json({ error: 'Contraseña incorrecta.' });
  }

  try {
    await Promise.all([asegurarTabla(), asegurarTablaBajas()]);
    const [filas, bajas] = await Promise.all([
      sql`SELECT id, recibido_en, datos FROM inscripciones ORDER BY id DESC LIMIT 20000`,
      sqlBajas`SELECT id, recibido_en, datos FROM bajas ORDER BY id DESC LIMIT 20000`
    ]);
    return res.status(200).json({ filas, bajas });
  } catch (e) {
    console.error('Error leyendo datos:', e && e.message ? e.message.slice(0, 200) : 'desconocido');
    return res.status(500).json({ error: 'No se pudieron leer los registros.' });
  }
}
