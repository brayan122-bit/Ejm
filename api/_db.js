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
  },
  {
    id: '006_archivos_pendientes',
    queries: () => [
      sql`CREATE TABLE IF NOT EXISTS archivos_pendientes (
        id SERIAL PRIMARY KEY,
        pathname TEXT UNIQUE NOT NULL,
        empresa_id INTEGER NOT NULL REFERENCES empresas(id),
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
        id_inscripcion TEXT NOT NULL,
        tipo TEXT NOT NULL,
        expira_en TIMESTAMPTZ NOT NULL,
        usado BOOLEAN NOT NULL DEFAULT false,
        pendiente_borrar BOOLEAN NOT NULL DEFAULT false,
        creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      sql`ALTER TABLE archivos_pendientes ADD COLUMN IF NOT EXISTS pendiente_borrar BOOLEAN NOT NULL DEFAULT false`,
      sql`CREATE INDEX IF NOT EXISTS archivos_pend_pathname_idx ON archivos_pendientes (pathname)`,
      sql`CREATE INDEX IF NOT EXISTS archivos_pend_limpieza_idx ON archivos_pendientes (usado, creado_en, pendiente_borrar)`
    ]
  },
  {
    id: '007_seguridad_auth',
    queries: () => [
      // 1. Intentos de inicio de sesión para rate limiting persistente en BD
      sql`CREATE TABLE IF NOT EXISTS intentos_login (
        id BIGSERIAL PRIMARY KEY,
        email TEXT,
        ip TEXT NOT NULL,
        exitoso BOOLEAN NOT NULL DEFAULT false,
        creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      sql`CREATE INDEX IF NOT EXISTS intentos_login_ip_idx ON intentos_login (ip, creado_en)`,
      sql`CREATE INDEX IF NOT EXISTS intentos_login_email_idx ON intentos_login (email, creado_en)`,

      // 2. Control de cambio obligatorio de clave temporal
      sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS debe_cambiar_clave BOOLEAN NOT NULL DEFAULT false`,

      // 3. MFA TOTP y códigos de recuperación
      sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS mfa_secreto TEXT`,
      sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS mfa_activo BOOLEAN NOT NULL DEFAULT false`,
      sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS mfa_recuperacion JSONB NOT NULL DEFAULT '[]'::jsonb`
    ]
  },
  {
    id: '008_auditoria',
    queries: () => [
      // Tabla de auditoría append-only
      sql`CREATE TABLE IF NOT EXISTS auditoria (
        id BIGSERIAL PRIMARY KEY,
        usuario_id INTEGER,
        rol TEXT,
        empresa_id INTEGER,
        accion TEXT NOT NULL,
        registro_afectado TEXT,
        detalle JSONB NOT NULL DEFAULT '{}'::jsonb,
        ip TEXT,
        fecha TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      sql`CREATE INDEX IF NOT EXISTS auditoria_fecha_idx ON auditoria (fecha DESC)`,
      sql`CREATE INDEX IF NOT EXISTS auditoria_usuario_idx ON auditoria (usuario_id, fecha DESC)`,
      sql`CREATE INDEX IF NOT EXISTS auditoria_empresa_idx ON auditoria (empresa_id, fecha DESC)`,
      sql`CREATE INDEX IF NOT EXISTS auditoria_accion_idx ON auditoria (accion, fecha DESC)`,
      sql`CREATE OR REPLACE FUNCTION impedir_modificar_auditoria()
          RETURNS TRIGGER AS $$
          BEGIN
            RAISE EXCEPTION 'La tabla auditoria es inmutable: no se permite UPDATE ni DELETE';
          END;
          $$ LANGUAGE plpgsql`,
      sql`DROP TRIGGER IF EXISTS trg_auditoria_inmutable ON auditoria`,
      sql`CREATE TRIGGER trg_auditoria_inmutable
          BEFORE UPDATE OR DELETE ON auditoria
          FOR EACH ROW EXECUTE FUNCTION impedir_modificar_auditoria()`
    ]
  },
  {
    id: '009_consolidado_conciliacion',
    queries: () => [
      // 1. Configuración de modo prueba / producción
      sql`CREATE TABLE IF NOT EXISTS configuracion_sistema (
        clave TEXT PRIMARY KEY,
        valor TEXT NOT NULL,
        actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      sql`INSERT INTO configuracion_sistema (clave, valor)
          VALUES ('consolidado_modo', 'test')
          ON CONFLICT (clave) DO NOTHING`,

      // 2. Tabla consolidado de conciliación (Producción)
      sql`CREATE TABLE IF NOT EXISTS consolidado_conciliacion (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id INTEGER REFERENCES empresas(id),
        nit TEXT,
        convenio_empresa TEXT,
        xc_subscriptionname__c TEXT,
        estado TEXT NOT NULL DEFAULT 'Activo',
        canal_atencion TEXT,
        fecha_cargue DATE,
        fecha_corte DATE,
        asociado TEXT,
        doc_asociado TEXT,
        fecha_retiro DATE,
        asistencia TEXT,
        asistencia_id TEXT,
        plan TEXT,
        plan_id TEXT,
        valor_con_iva NUMERIC(12,2) NOT NULL DEFAULT 0,
        valor_sin_iva NUMERIC(12,2),
        titular TEXT,
        tipo_doc TEXT,
        numero_identificacion TEXT,
        fecha_nacimiento DATE,
        celular TEXT,
        correo TEXT,
        ciudad_municipio TEXT,
        direccion_predio TEXT,
        edad INTEGER,
        nombre_beneficiario_1 TEXT,
        tipo_doc_beneficiario_1 TEXT,
        documento_numero_beneficiario_1 TEXT,
        parentesco_1 TEXT,
        porcentaje_1 NUMERIC(5,2),
        nombre_beneficiario_2 TEXT,
        tipo_doc_beneficiario_2 TEXT,
        documento_numero_beneficiario_2 TEXT,
        parentesco_2 TEXT,
        porcentaje_2 NUMERIC(5,2),
        nombre_beneficiario_3 TEXT,
        tipo_doc_beneficiario_3 TEXT,
        documento_numero_beneficiario_3 TEXT,
        parentesco_3 TEXT,
        porcentaje_3 NUMERIC(5,2),
        origen TEXT NOT NULL DEFAULT 'formulario',
        solicitud_id INTEGER REFERENCES solicitudes(id),
        aprobado_por INTEGER REFERENCES usuarios(id),
        aprobado_en TIMESTAMPTZ,
        creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
        actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
        datos_adicionales JSONB NOT NULL DEFAULT '{}'::jsonb
      )`,
      sql`CREATE UNIQUE INDEX IF NOT EXISTS consolidado_conc_xc_idx ON consolidado_conciliacion (xc_subscriptionname__c) WHERE xc_subscriptionname__c IS NOT NULL`,
      sql`CREATE INDEX IF NOT EXISTS consolidado_conc_empresa_idx ON consolidado_conciliacion (empresa_id, estado)`,
      sql`CREATE INDEX IF NOT EXISTS consolidado_conc_doc_idx ON consolidado_conciliacion (doc_asociado, asistencia)`,
      sql`CREATE INDEX IF NOT EXISTS consolidado_conc_nit_idx ON consolidado_conciliacion (nit, doc_asociado)`,

      // 3. Tabla de meses del consolidado (Producción)
      sql`CREATE TABLE IF NOT EXISTS consolidado_meses (
        id BIGSERIAL PRIMARY KEY,
        registro_id UUID NOT NULL REFERENCES consolidado_conciliacion(id) ON DELETE CASCADE,
        periodo VARCHAR(7) NOT NULL,
        valor NUMERIC(12,2) NOT NULL DEFAULT 0,
        creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
        actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (registro_id, periodo)
      )`,
      sql`CREATE INDEX IF NOT EXISTS consolidado_meses_per_idx ON consolidado_meses (periodo)`,

      // 4. Tabla consolidado de conciliación (Modo Prueba)
      sql`CREATE TABLE IF NOT EXISTS consolidado_conciliacion_test (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id INTEGER REFERENCES empresas(id),
        nit TEXT,
        convenio_empresa TEXT,
        xc_subscriptionname__c TEXT,
        estado TEXT NOT NULL DEFAULT 'Activo',
        canal_atencion TEXT,
        fecha_cargue DATE,
        fecha_corte DATE,
        asociado TEXT,
        doc_asociado TEXT,
        fecha_retiro DATE,
        asistencia TEXT,
        asistencia_id TEXT,
        plan TEXT,
        plan_id TEXT,
        valor_con_iva NUMERIC(12,2) NOT NULL DEFAULT 0,
        valor_sin_iva NUMERIC(12,2),
        titular TEXT,
        tipo_doc TEXT,
        numero_identificacion TEXT,
        fecha_nacimiento DATE,
        celular TEXT,
        correo TEXT,
        ciudad_municipio TEXT,
        direccion_predio TEXT,
        edad INTEGER,
        nombre_beneficiario_1 TEXT,
        tipo_doc_beneficiario_1 TEXT,
        documento_numero_beneficiario_1 TEXT,
        parentesco_1 TEXT,
        porcentaje_1 NUMERIC(5,2),
        nombre_beneficiario_2 TEXT,
        tipo_doc_beneficiario_2 TEXT,
        documento_numero_beneficiario_2 TEXT,
        parentesco_2 TEXT,
        porcentaje_2 NUMERIC(5,2),
        nombre_beneficiario_3 TEXT,
        tipo_doc_beneficiario_3 TEXT,
        documento_numero_beneficiario_3 TEXT,
        parentesco_3 TEXT,
        porcentaje_3 NUMERIC(5,2),
        origen TEXT NOT NULL DEFAULT 'formulario',
        solicitud_id INTEGER REFERENCES solicitudes(id),
        aprobado_por INTEGER REFERENCES usuarios(id),
        aprobado_en TIMESTAMPTZ,
        creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
        actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
        datos_adicionales JSONB NOT NULL DEFAULT '{}'::jsonb
      )`,
      sql`CREATE UNIQUE INDEX IF NOT EXISTS consolidado_test_xc_idx ON consolidado_conciliacion_test (xc_subscriptionname__c) WHERE xc_subscriptionname__c IS NOT NULL`,
      sql`CREATE INDEX IF NOT EXISTS consolidado_test_empresa_idx ON consolidado_conciliacion_test (empresa_id, estado)`,
      sql`CREATE INDEX IF NOT EXISTS consolidado_test_doc_idx ON consolidado_conciliacion_test (doc_asociado, asistencia)`,
      sql`CREATE INDEX IF NOT EXISTS consolidado_test_nit_idx ON consolidado_conciliacion_test (nit, doc_asociado)`,

      // 5. Tabla de meses del consolidado (Modo Prueba)
      sql`CREATE TABLE IF NOT EXISTS consolidado_meses_test (
        id BIGSERIAL PRIMARY KEY,
        registro_id UUID NOT NULL REFERENCES consolidado_conciliacion_test(id) ON DELETE CASCADE,
        periodo VARCHAR(7) NOT NULL,
        valor NUMERIC(12,2) NOT NULL DEFAULT 0,
        creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
        actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (registro_id, periodo)
      )`,
      sql`CREATE INDEX IF NOT EXISTS consolidado_meses_test_per_idx ON consolidado_meses_test (periodo)`
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

// Mes contable en hora de Colombia: si es mayor al día 20, pasa al mes siguiente.
export function periodoActual(fecha = new Date()) {
  const fStr = fecha.toLocaleString('en-US', { timeZone: 'America/Bogota' });
  const d = new Date(fStr);
  if (d.getDate() > 20) d.setMonth(d.getMonth() + 1);
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  return `${yr}-${mo}`;
}
export function fechaHoy() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}
export const periodoValido = p => typeof p === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(p);

export function ipDe(req) {
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real.trim()) return real.trim();
  const vxf = req.headers['x-vercel-forwarded-for'];
  if (typeof vxf === 'string' && vxf.trim()) return vxf.split(',')[0].trim();
  const xf = req.headers['x-forwarded-for'];
  return (Array.isArray(xf) ? xf[0] : (xf || '')).split(',')[0].trim() || 'desconocida';
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
  // Se registra solo el tipo de error sanitizado, nunca contraseñas, tokens ni datos personales.
  const msg = (e && e.message ? String(e.message) : 'desconocido')
    .replace(/Bearer\s+[a-zA-Z0-9_\-\.]+/gi, 'Bearer [REDACTADO]')
    .replace(/(password|clave|token|hash|secret|authorization)=[^&\s]+/gi, '$1=[REDACTADO]')
    .slice(0, 200);
  console.error(donde + ':', msg);
}

// ── Rate Limiting compartido en base de datos (desactivado por defecto) ─────
export async function verificarBloqueoLogin(email, ip) {
  if (process.env.BLOQUEO_INTENTOS_BD !== 'true') return { bloqueado: false };
  try {
    const [porIp] = await sql`
      SELECT count(*)::int AS n FROM intentos_login
      WHERE ip = ${ip} AND exitoso = false AND creado_en > now() - interval '15 minutes'
    `;
    if (porIp && porIp.n >= 8) {
      return { bloqueado: true, motivo: 'Demasiados intentos fallidos desde su dirección IP. Espere 15 minutos.' };
    }
    if (email) {
      const [porEmail] = await sql`
        SELECT count(*)::int AS n FROM intentos_login
        WHERE email = ${email} AND exitoso = false AND creado_en > now() - interval '15 minutes'
      `;
      if (porEmail && porEmail.n >= 5) {
        return { bloqueado: true, motivo: 'Demasiados intentos fallidos para este correo. Espere 15 minutos.' };
      }
    }
    return { bloqueado: false };
  } catch (err) {
    // Si la tabla no está creada aún, no bloquear para no interrumpir el servicio
    return { bloqueado: false };
  }
}

export async function registrarIntentoLogin(email, ip, exitoso) {
  if (process.env.BLOQUEO_INTENTOS_BD !== 'true') return;
  try {
    await sql`
      INSERT INTO intentos_login (email, ip, exitoso)
      VALUES (${email || null}, ${ip}, ${Boolean(exitoso)})
    `;
  } catch (err) {
    // Falla silenciosa si la migración aún no se ejecuta
  }
}

// Lista exacta de nombres de campo sensibles que NUNCA deben persistirse en auditoria
export const CAMPOS_SENSIBLES_AUDITORIA = new Set([
  // Credenciales y secretos
  'clave', 'password', 'token', 'hash', 'secreto', 'temp_token', 'mfa_secreto', 'codigo_recuperacion', 'codigos',
  // Números de documento, cédula e identificación
  'doc', 'num_doc', 'num_documento', 'numero_documento', 'documento', 'cedula', 'cedula_ciudadania',
  'cedula_titular', 'titular_num_doc', 'titular_doc', 'titular_tipo_doc', 'beneficiario_num_doc',
  'beneficiario_doc', 'beneficiario_tipo_doc', 'tipo_doc', 'nit', 'rut', 'identificacion',
  // Cuentas bancarias y datos financieros
  'cuenta', 'cuenta_bancaria', 'num_cuenta', 'numero_cuenta', 'banco', 'tipo_cuenta',
  'salario', 'sueldo', 'ingreso', 'ingresos', 'tarjeta', 'cvv',
  // Teléfonos y móviles
  'telefono', 'tel', 'celular', 'cel', 'movil', 'phone',
  // Correos de terceros y datos de contacto
  'correo', 'email', 'correo_tercero', 'email_tercero', 'correo_electronico', 'titular_correo', 'beneficiario_correo',
  // Archivos y contenido binario
  'archivo', 'contenido', 'buffer', 'adjunto', 'blob'
]);

// ── Registro de auditoría append-only ──────────────────────────────────────
export async function auditar(req, u, accion, registroAfectado = null, detalle = {}) {
  try {
    const ip = req ? ipDe(req) : null;
    const usuarioId = u?.id || null;
    const rol = u?.rol || (accion.includes('login') ? 'anonimo' : null);
    const empresaId = u?.empresa_id || null;

    // Sanitizar datos del detalle: NUNCA registrar claves, cédulas, cuentas, teléfonos, correos ni archivos.
    // Filtrado estricto por lista exacta de nombres de campo (sin coincidencia por subcadena).
    const detalleLimpio = {};
    if (detalle && typeof detalle === 'object') {
      for (const [k, v] of Object.entries(detalle)) {
        const kNorm = k.toLowerCase().trim();
        if (!CAMPOS_SENSIBLES_AUDITORIA.has(kNorm)) {
          detalleLimpio[k] = v;
        }
      }
    }

    await sql`
      INSERT INTO auditoria (usuario_id, rol, empresa_id, accion, registro_afectado, detalle, ip)
      VALUES (${usuarioId}, ${rol}, ${empresaId}, ${accion},
              ${registroAfectado ? String(registroAfectado).slice(0, 200) : null},
              ${JSON.stringify(detalleLimpio)}::jsonb, ${ip})
    `;
  } catch (err) {
    // La auditoría no interrumpe el flujo principal, pero se reporta en logs sin exponer datos sensibles
    console.error('Error al registrar auditoría:', err && err.message ? err.message : String(err));
  }
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

// ── Consolidado de Conciliación: Gestión de Modo Prueba / Producción ────────
export async function obtenerModoConsolidado() {
  if (process.env.CONSOLIDADO_MODO === 'prod') return 'prod';
  if (process.env.CONSOLIDADO_MODO === 'test') return 'test';
  try {
    const [cfg] = await sql`SELECT valor FROM configuracion_sistema WHERE clave = 'consolidado_modo' LIMIT 1`;
    return cfg && cfg.valor === 'prod' ? 'prod' : 'test';
  } catch {
    return 'test';
  }
}

export async function establecerModoConsolidado(modo) {
  const m = modo === 'prod' ? 'prod' : 'test';
  await sql`
    INSERT INTO configuracion_sistema (clave, valor, actualizado_en)
    VALUES ('consolidado_modo', ${m}, now())
    ON CONFLICT (clave) DO UPDATE SET valor = ${m}, actualizado_en = now()
  `;
  return m;
}

export function tablasConsolidado(modo = 'test') {
  const esTest = modo !== 'prod';
  return {
    esTest,
    tablaReg: esTest ? 'consolidado_conciliacion_test' : 'consolidado_conciliacion',
    tablaMes: esTest ? 'consolidado_meses_test' : 'consolidado_meses'
  };
}

export function calcularEdad(fnac) {
  if (!fnac) return null;
  let d;
  if (fnac instanceof Date) {
    d = fnac;
  } else if (typeof fnac === 'string') {
    const s = fnac.trim();
    if (s.includes('/')) {
      const p = s.split('/');
      if (p.length === 3) d = new Date(Number(p[2]), Number(p[1]) - 1, Number(p[0]));
    } else if (s.includes('-')) {
      const p = s.split('-');
      if (p.length === 3) d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    } else {
      d = new Date(s);
    }
  }
  if (!d || isNaN(d.getTime())) return null;
  const dif = Date.now() - d.getTime();
  const ageDate = new Date(dif);
  const edad = Math.abs(ageDate.getUTCFullYear() - 1970);
  return Number.isFinite(edad) && edad >= 0 && edad <= 120 ? edad : null;
}

const NOMBRES_MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const NOMBRES_MESES_COMPLETOS = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

export function etiquetaPeriodo(periodo) {
  if (!periodo || typeof periodo !== 'string' || !/^\d{4}-\d{2}$/.test(periodo)) return periodo || '';
  const [aStr, mStr] = periodo.split('-');
  const anio = parseInt(aStr, 10);
  const mesIdx = parseInt(mStr, 10) - 1;
  if (mesIdx < 0 || mesIdx > 11) return periodo;
  if (anio === 2025) {
    return NOMBRES_MESES_COMPLETOS[mesIdx];
  }
  const anioCorto = String(anio).slice(-2);
  return `${NOMBRES_MESES[mesIdx]}-${anioCorto}`;
}

export function periodoDeEtiqueta(etiqueta) {
  if (!etiqueta) return null;
  const s = String(etiqueta).trim().toUpperCase();
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  const idx2025 = NOMBRES_MESES_COMPLETOS.indexOf(s);
  if (idx2025 !== -1) {
    return `2025-${String(idx2025 + 1).padStart(2, '0')}`;
  }
  const match = s.match(/^([A-Z]{3})[-_ ]?(\d{2})$/);
  if (match) {
    const mesNom = match[1].toLowerCase();
    const anio = 2000 + parseInt(match[2], 10);
    const mIdx = NOMBRES_MESES.indexOf(mesNom);
    if (mIdx !== -1) {
      return `${anio}-${String(mIdx + 1).padStart(2, '0')}`;
    }
  }
  return null;
}

