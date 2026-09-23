// Utilidades compartidas. Los archivos de /api que empiezan por "_" no se publican como rutas.
import { neon } from '@neondatabase/serverless';

export const sql = neon(process.env.DATABASE_URL);

// Las bajas van a su propia tabla. Si se define BAJAS_DATABASE_URL en Vercel,
// se guardan además en otra base de datos distinta; si no, usan la misma conexión.
export const sqlBajas = process.env.BAJAS_DATABASE_URL ? neon(process.env.BAJAS_DATABASE_URL) : sql;

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

let tablaBajasLista = false;
export async function asegurarTablaBajas() {
  if (tablaBajasLista) return;
  await sqlBajas`CREATE TABLE IF NOT EXISTS bajas (
    id               BIGSERIAL PRIMARY KEY,
    recibido_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
    empresa          TEXT NOT NULL,
    asesor           TEXT NOT NULL,
    titular_nombre   TEXT NOT NULL,
    titular_tipo_doc TEXT,
    titular_num_doc  TEXT NOT NULL,
    asistencia       TEXT NOT NULL,
    plan             TEXT NOT NULL,
    valor_mensual    BIGINT NOT NULL,
    motivo           TEXT,
    datos            JSONB NOT NULL
  )`;
  await sqlBajas`CREATE INDEX IF NOT EXISTS bajas_doc_idx ON bajas (titular_num_doc)`;
  await sqlBajas`CREATE INDEX IF NOT EXISTS bajas_empresa_idx ON bajas (empresa)`;
  tablaBajasLista = true;
}

// Solo se aceptan envíos desde este mismo sitio.
export function origenValido(req) {
  const origen = req.headers.origin;
  if (!origen) return true;
  try { return new URL(origen).host === req.headers.host; } catch { return false; }
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
