// Utilidades compartidas. Los archivos de /api que empiezan por "_" no se publican como rutas.
import { neon } from '@neondatabase/serverless';

export const sql = neon(process.env.DATABASE_URL);

// ============================================================
// MIGRACIONES: cada una se aplica una sola vez, en una
// transacción atómica. El ID en schema_migraciones garantiza
// que no se repita aunque el proceso arranque varias veces.
// queries() devuelve arreglos frescos de PendingQuery en
// cada llamada, lo que es necesario para sql.transaction.
// ============================================================
const MIGRACIONES = [
  {
    id: '001_empresas_dominios_modelo3',
    queries: () => [
      // Columna de dominios corporativos permitidos por empresa
      sql`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS dominios JSONB NOT NULL DEFAULT '[]'::jsonb`,
      // Ampliar modelo para aceptar 3 = Mixto
      sql`ALTER TABLE empresas DROP CONSTRAINT IF EXISTS empresas_modelo_check`,
      sql`ALTER TABLE empresas ADD CONSTRAINT empresas_modelo_check CHECK (modelo IN (1, 2, 3))`,
    ]
  },
  {
    id: '002_usuarios_estado_acceso',
    queries: () => [
      // Para auto-registro: el usuario queda pendiente hasta que empresa_admin lo active
      sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS estado_acceso TEXT NOT NULL DEFAULT 'activo'`,
      sql`ALTER TABLE usuarios ADD CONSTRAINT usuarios_estado_check
            CHECK (estado_acceso IN ('activo', 'pendiente', 'rechazado'))`,
    ]
  },
  {
    id: '003_usuarios_roles_nuevos',
    queries: () => [
      // Eliminar constraint viejo para poder actualizar los datos primero
      sql`ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check`,
      // Migrar roles viejos: admin → maestro, empresa → empresa_admin
      sql`UPDATE usuarios SET rol = 'maestro' WHERE rol = 'admin'`,
      sql`UPDATE usuarios SET rol = 'empresa_admin' WHERE rol = 'empresa'`,
      // Constraint definitivo: SOLO los nuevos roles son válidos
      sql`ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check
            CHECK (rol IN ('maestro', 'validador', 'empresa_admin', 'empresa_usuario'))`,
    ]
  },
  {
    id: '004_solicitudes_consolidado_campos',
    queries: () => [
      sql`ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS modelo_aplicado SMALLINT`,
      sql`ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS origen_tipo TEXT NOT NULL DEFAULT 'formulario'`,
      sql`ALTER TABLE consolidado ADD COLUMN IF NOT EXISTS modelo_aplicado SMALLINT`,
    ]
  },
  {
    id: '005_consolidado_modelo_aplicado_fill',
    queries: () => [
      // Filas existentes de empresas no mixtas (modelo 1 o 2): heredar el modelo de la empresa
      sql`UPDATE consolidado c SET modelo_aplicado = e.modelo
          FROM empresas e WHERE c.empresa_id = e.id AND c.modelo_aplicado IS NULL AND e.modelo IN (1, 2)`,
      // Filas restantes (empresa mixta o sin modelo): deducir por forma de pago
      sql`UPDATE consolidado SET modelo_aplicado = CASE WHEN pago = 'Nomina' THEN 1 ELSE 2 END
          WHERE modelo_aplicado IS NULL`,
      // Lo mismo para solicitudes de tipo alta
      sql`UPDATE solicitudes s SET modelo_aplicado = e.modelo
          FROM empresas e WHERE s.empresa_id = e.id AND s.modelo_aplicado IS NULL
          AND e.modelo IN (1, 2) AND s.tipo = 'alta'`,
      sql`UPDATE solicitudes SET modelo_aplicado = CASE WHEN pago = 'Nomina' THEN 1 ELSE 2 END
          WHERE modelo_aplicado IS NULL AND tipo = 'alta'`,
    ]
  }
];

// Crea las tablas base la primera vez (sin los CHECK que manejan las migraciones)
// y luego aplica las migraciones pendientes en orden.
let esquemaListo = false;
export async function asegurarEsquema() {
  if (esquemaListo) return;

  // Tablas base: CREATE TABLE IF NOT EXISTS sin CHECK de modelo ni de rol.
  // Las migraciones añaden/modifican esos constraints de forma segura.
  await sql`CREATE TABLE IF NOT EXISTS empresas (
    id         SERIAL PRIMARY KEY,
    nit        TEXT UNIQUE NOT NULL,
    nombre     TEXT NOT NULL,
    modelo     SMALLINT NOT NULL DEFAULT 1,
    productos  JSONB NOT NULL DEFAULT '[]'::jsonb,
    activa     BOOLEAN NOT NULL DEFAULT true,
    creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS usuarios (
    id             SERIAL PRIMARY KEY,
    email          TEXT UNIQUE NOT NULL,
    nombre         TEXT NOT NULL,
    hash           TEXT NOT NULL,
    rol            TEXT NOT NULL,
    empresa_id     INTEGER REFERENCES empresas(id),
    activo         BOOLEAN NOT NULL DEFAULT true,
    version        INTEGER NOT NULL DEFAULT 1,
    creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
    ultimo_ingreso TIMESTAMPTZ
  )`;
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

  await sql`CREATE TABLE IF NOT EXISTS archivos (
    id             TEXT PRIMARY KEY,
    empresa_id     INTEGER NOT NULL REFERENCES empresas(id),
    id_inscripcion TEXT NOT NULL,
    tipo           TEXT NOT NULL,
    url            TEXT NOT NULL,
    creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS archivos_inscripcion_idx ON archivos (id_inscripcion)`;

  // Sistema de migraciones
  await sql`CREATE TABLE IF NOT EXISTS schema_migraciones (
    id          TEXT PRIMARY KEY,
    aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  const aplicadas = await sql`SELECT id FROM schema_migraciones`;
  const idAplicadas = new Set(aplicadas.map(r => r.id));

  for (const m of MIGRACIONES) {
    if (idAplicadas.has(m.id)) continue;
    try {
      // Incluir el registro de la migración dentro de la misma transacción:
      // si alguna query falla, el ID no queda guardado y se reintenta en el próximo arranque.
      const qs = [...m.queries(), sql`INSERT INTO schema_migraciones (id) VALUES (${m.id})`];
      await sql.transaction(qs);
    } catch (e) {
      // No bloquear el arranque; el error queda en los logs de Vercel.
      console.error(`[schema] Migración ${m.id} falló:`, e?.message?.slice(0, 300));
    }
  }

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

// Dominios públicos que NO se permiten como dominio corporativo de empresa.
export const DOMINIOS_PUBLICOS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.es', 'outlook.com', 'outlook.es',
  'yahoo.com', 'yahoo.es', 'live.com', 'live.es', 'icloud.com', 'me.com', 'mac.com',
  'msn.com', 'protonmail.com', 'proton.me', 'tutanota.com', 'zoho.com',
  'aol.com', 'ymail.com', 'mail.com', 'inbox.com', 'gmx.com', 'gmx.net'
]);

// Extrae el dominio de un correo: "juan@acme.com.co" → "acme.com.co"
export function dominioDeEmail(email) {
  const at = String(email || '').lastIndexOf('@');
  return at >= 0 ? String(email).slice(at + 1).toLowerCase() : '';
}
