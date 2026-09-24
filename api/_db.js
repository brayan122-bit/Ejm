// Utilidades compartidas. Los archivos de /api que empiezan por "_" no se publican como rutas.
import { neon } from '@neondatabase/serverless';

export const sql = neon(process.env.DATABASE_URL);

// Crea las tablas la primera vez. Es idempotente: se puede ejecutar siempre.
let esquemaListo = false;
export async function asegurarEsquema() {
  if (esquemaListo) return;
  await sql`CREATE TABLE IF NOT EXISTS empresas (
    id         SERIAL PRIMARY KEY,
    nit        TEXT UNIQUE NOT NULL,
    nombre     TEXT NOT NULL,
    modelo     SMALLINT NOT NULL DEFAULT 1 CHECK (modelo IN (1, 2)),
    productos  JSONB NOT NULL DEFAULT '[]'::jsonb,
    activa     BOOLEAN NOT NULL DEFAULT true,
    creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS usuarios (
    id             SERIAL PRIMARY KEY,
    email          TEXT UNIQUE NOT NULL,
    nombre         TEXT NOT NULL,
    hash           TEXT NOT NULL,
    rol            TEXT NOT NULL CHECK (rol IN ('admin', 'validador', 'empresa')),
    empresa_id     INTEGER REFERENCES empresas(id),
    activo         BOOLEAN NOT NULL DEFAULT true,
    version        INTEGER NOT NULL DEFAULT 1,
    creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
    ultimo_ingreso TIMESTAMPTZ
  )`;
  // Cada fila es una asistencia enviada desde el formulario (alta) o una asistencia a retirar (baja).
  await sql`CREATE TABLE IF NOT EXISTS solicitudes (
    id              SERIAL PRIMARY KEY,
    recibido_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
    periodo         TEXT NOT NULL,
    tipo            TEXT NOT NULL CHECK (tipo IN ('alta', 'baja')),
    empresa_id      INTEGER NOT NULL REFERENCES empresas(id),
    enviado_por     INTEGER REFERENCES usuarios(id),
    id_inscripcion  TEXT,
    titular_num_doc TEXT,
    titular_nombre  TEXT,
    asistencia_id   TEXT,
    asistencia      TEXT,
    plan_id         TEXT,
    plan            TEXT,
    mascota         TEXT,
    pago            TEXT,
    valor_mensual   INTEGER NOT NULL DEFAULT 0,
    valor_empresa   INTEGER NOT NULL DEFAULT 0,
    valor_colaborador INTEGER NOT NULL DEFAULT 0,
    personas        INTEGER NOT NULL DEFAULT 1,
    consolidado_id  INTEGER,
    estado          TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'valida', 'invalida')),
    motivo          TEXT,
    validado_por    INTEGER REFERENCES usuarios(id),
    validado_en     TIMESTAMPTZ,
    datos           JSONB NOT NULL
  )`;
  await sql`CREATE INDEX IF NOT EXISTS solicitudes_periodo_idx ON solicitudes (periodo, empresa_id)`;
  await sql`CREATE INDEX IF NOT EXISTS solicitudes_doc_idx ON solicitudes (empresa_id, titular_num_doc)`;
  // Base de conciliación: quién tiene hoy cada asistencia en cada empresa.
  await sql`CREATE TABLE IF NOT EXISTS consolidado (
    id                SERIAL PRIMARY KEY,
    empresa_id        INTEGER NOT NULL REFERENCES empresas(id),
    titular_num_doc   TEXT NOT NULL,
    titular_nombre    TEXT,
    asistencia_id     TEXT,
    asistencia        TEXT,
    plan_id           TEXT,
    plan              TEXT,
    mascota           TEXT,
    pago              TEXT,
    valor_mensual     INTEGER NOT NULL DEFAULT 0,
    valor_empresa     INTEGER NOT NULL DEFAULT 0,
    valor_colaborador INTEGER NOT NULL DEFAULT 0,
    personas          INTEGER NOT NULL DEFAULT 1,
    estado            TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'retirado')),
    fecha_alta        DATE,
    fecha_baja        DATE,
    origen            TEXT NOT NULL DEFAULT 'formulario',
    alta_solicitud_id INTEGER,
    baja_solicitud_id INTEGER,
    datos             JSONB,
    actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS consolidado_empresa_idx ON consolidado (empresa_id, estado)`;
  await sql`CREATE INDEX IF NOT EXISTS consolidado_doc_idx ON consolidado (empresa_id, titular_num_doc)`;
  esquemaListo = true;
}

// Mes contable en hora de Colombia: "2026-09".
export function periodoActual(fecha = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit' }).format(fecha);
}
export function fechaHoy() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}
export const periodoValido = p => typeof p === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(p);

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

// Solo se aceptan cambios enviados desde este mismo sitio.
export function origenValido(req) {
  const origen = req.headers.origin;
  if (!origen) return true;
  try { return new URL(origen).host === req.headers.host; } catch { return false; }
}

export const texto = (v, max = 500) =>
  v === undefined || v === null ? '' : String(v).trim().replace(/\s+/g, ' ').slice(0, max);
export const entero = v => {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? '').replace(/\D/g, ''), 10);
  return Number.isFinite(n) && n >= 0 && n <= 100000000 ? Math.round(n) : 0;
};

export function registrarError(donde, e) {
  // Se registra solo el tipo de error, nunca los datos personales.
  console.error(donde + ':', e && e.message ? e.message.slice(0, 200) : 'desconocido');
}
