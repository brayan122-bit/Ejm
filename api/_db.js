// Utilidades compartidas. Los archivos de /api que empiezan por "_" no se publican como rutas.
import { neon } from '@neondatabase/serverless';

export const sql = neon(process.env.DATABASE_URL);

let tablaLista = false;
export async function asegurarTabla() {
  if (tablaLista) return;
  await sql`CREATE TABLE IF NOT EXISTS inscripciones (
    id              BIGSERIAL PRIMARY KEY,
    recibido_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
    id_inscripcion  TEXT,
    empresa         TEXT,
    nit             TEXT,
    asesor          TEXT,
    titular_num_doc TEXT,
    titular_nombre  TEXT,
    asistencia      TEXT,
    plan            TEXT,
    datos           JSONB NOT NULL,
    convenio        JSONB
  )`;
  await sql`CREATE INDEX IF NOT EXISTS inscripciones_doc_idx ON inscripciones (titular_num_doc)`;
  await sql`CREATE INDEX IF NOT EXISTS inscripciones_empresa_idx ON inscripciones (empresa)`;
  tablaLista = true;
}

export function ipDe(req) {
  const xf = req.headers['x-forwarded-for'];
  return (Array.isArray(xf) ? xf[0] : (xf || '')).split(',')[0].trim() || req.headers['x-real-ip'] || 'desconocida';
}

// Límite sencillo por IP (en memoria de cada instancia): frena abusos básicos.
export function crearLimitador(max, ventanaMs) {
  const mapa = new Map();
  return {
    excedido(ip) {
      const ahora = Date.now();
      const lista = (mapa.get(ip) || []).filter(t => ahora - t < ventanaMs);
      mapa.set(ip, lista);
      if (mapa.size > 5000) mapa.clear();
      return lista.length >= max;
    },
    registrar(ip) {
      const lista = mapa.get(ip) || [];
      lista.push(Date.now());
      mapa.set(ip, lista);
    }
  };
}

export function leerCuerpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return null; } }
  return null;
}
