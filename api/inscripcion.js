// Recibe cada inscripción que envía el formulario (index.html) y la guarda en Neon.
import { sql, asegurarTabla, ipDe, crearLimitador, leerCuerpo } from './_db.js';

const limitador = crearLimitador(30, 10 * 60 * 1000); // máx. 30 envíos por IP cada 10 minutos
const MAX_FILAS = 60;
const MAX_TEXTO = 500;
const CLAVE_VALIDA = /^[a-z0-9_]{1,60}$/i;

function filaValida(f) {
  if (!f || typeof f !== 'object' || Array.isArray(f)) return false;
  const claves = Object.keys(f);
  if (claves.length === 0 || claves.length > 200) return false;
  return claves.every(k => {
    const v = f[k];
    if (!CLAVE_VALIDA.test(k)) return false;
    if (v === null || typeof v === 'number' || typeof v === 'boolean') return true;
    return typeof v === 'string' && v.length <= MAX_TEXTO;
  });
}

const txt = v => (v === undefined || v === null || v === '') ? null : String(v).slice(0, MAX_TEXTO);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }

  // Solo se aceptan envíos desde este mismo sitio.
  const origen = req.headers.origin;
  if (origen) {
    try { if (new URL(origen).host !== req.headers.host) return res.status(403).json({ error: 'Origen no permitido' }); }
    catch { return res.status(403).json({ error: 'Origen no permitido' }); }
  }

  const ip = ipDe(req);
  if (limitador.excedido(ip)) return res.status(429).json({ error: 'Demasiados envíos. Intente más tarde.' });
  limitador.registrar(ip);

  const cuerpo = leerCuerpo(req);
  const filas = cuerpo && cuerpo.filas;
  const convenio = cuerpo && cuerpo.convenio && typeof cuerpo.convenio === 'object' ? cuerpo.convenio : null;
  if (!Array.isArray(filas) || filas.length === 0 || filas.length > MAX_FILAS || !filas.every(filaValida)) {
    return res.status(400).json({ error: 'Datos de inscripción inválidos' });
  }
  const convenioJson = convenio ? JSON.stringify(convenio) : null;
  if (convenioJson && convenioJson.length > 20000) return res.status(400).json({ error: 'Datos de convenio inválidos' });

  try {
    await asegurarTabla();
    await sql.transaction(filas.map(f => {
      const nombre = [f.titular_nombres, f.titular_apellidos].filter(Boolean).join(' ');
      return sql`INSERT INTO inscripciones
        (id_inscripcion, empresa, nit, asesor, titular_num_doc, titular_nombre, asistencia, plan, datos, convenio)
        VALUES (${txt(f.id_inscripcion)}, ${txt(f.empresa)}, ${txt(f.nit)}, ${txt(f.asesor)},
                ${txt(f.titular_num_doc)}, ${txt(nombre)}, ${txt(f.asistencia)}, ${txt(f.plan)},
                ${JSON.stringify(f)}::jsonb, ${convenioJson}::jsonb)`;
    }));
    return res.status(200).json({ ok: true, guardadas: filas.length });
  } catch (e) {
    // Se registra solo el tipo de error, nunca los datos personales.
    console.error('Error guardando inscripción:', e && e.message ? e.message.slice(0, 200) : 'desconocido');
    return res.status(500).json({ error: 'No se pudo guardar la inscripción' });
  }
}
