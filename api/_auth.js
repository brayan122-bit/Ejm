// Sesiones con cookie firmada (HttpOnly) y contraseñas con scrypt. Sin dependencias externas.
import crypto from 'node:crypto';
import { sql, asegurarEsquema } from './_db.js';

const COOKIE = 'sesion';
const DURACION_S = 8 * 60 * 60; // 8 horas
const SCRYPT = { N: 16384, r: 8, p: 1 };

function secreto() {
  const s = process.env.SESSION_SECRET || '';
  if (s.length < 32) throw Object.assign(new Error('Falta configurar SESSION_SECRET en Vercel (mínimo 32 caracteres).'), { publico: true });
  return s;
}

export function hashClave(clave) {
  const sal = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(clave), sal, 64, SCRYPT);
  return `s1$${sal.toString('base64')}$${h.toString('base64')}`;
}
export function verificarClave(clave, guardado) {
  const [v, s, h] = String(guardado || '').split('$');
  if (v !== 's1' || !s || !h) return false;
  const calc = crypto.scryptSync(String(clave), Buffer.from(s, 'base64'), 64, SCRYPT);
  const esperado = Buffer.from(h, 'base64');
  return esperado.length === calc.length && crypto.timingSafeEqual(esperado, calc);
}
export function igualSeguro(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
// Contraseña temporal legible: 12 caracteres sin letras ambiguas.
export function claveTemporal() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const b = crypto.randomBytes(12);
  return Array.from(b, x => abc[x % abc.length]).join('');
}
export function claveAceptable(c) {
  return typeof c === 'string' && c.length >= 10 && c.length <= 200 && /[A-Za-z]/.test(c) && /\d/.test(c);
}

function firmar(datos) {
  const cuerpo = Buffer.from(JSON.stringify(datos)).toString('base64url');
  const firma = crypto.createHmac('sha256', secreto()).update(cuerpo).digest('base64url');
  return `${cuerpo}.${firma}`;
}
function leerToken(token) {
  const [cuerpo, firma] = String(token || '').split('.');
  if (!cuerpo || !firma) return null;
  const esperada = crypto.createHmac('sha256', secreto()).update(cuerpo).digest('base64url');
  if (!igualSeguro(firma, esperada)) return null;
  try {
    const d = JSON.parse(Buffer.from(cuerpo, 'base64url').toString());
    return d && d.exp > Date.now() ? d : null;
  } catch { return null; }
}
function leerCookie(req) {
  const c = req.headers.cookie || '';
  const m = c.split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE + '='));
  return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : '';
}

export function abrirSesion(res, usuario) {
  const token = firmar({ u: usuario.id, v: usuario.version, exp: Date.now() + DURACION_S * 1000 });
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${DURACION_S}`);
}
export function cerrarSesion(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
}

// Devuelve el usuario de la sesión (con su empresa) o null. Revisa en la base que siga activo:
// desactivar un usuario o cambiarle la contraseña cierra sus sesiones abiertas.
export async function sesionDe(req) {
  const t = leerToken(leerCookie(req));
  if (!t) return null;
  await asegurarEsquema();
  const [u] = await sql`SELECT u.id, u.email, u.nombre, u.rol, u.empresa_id, u.activo, u.version,
      e.nombre AS empresa_nombre, e.nit AS empresa_nit, e.modelo AS empresa_modelo,
      e.productos AS empresa_productos, e.activa AS empresa_activa
    FROM usuarios u LEFT JOIN empresas e ON e.id = u.empresa_id WHERE u.id = ${t.u}`;
  if (!u || !u.activo || u.version !== t.v) return null;
  if (u.rol === 'empresa' && (!u.empresa_id || !u.empresa_activa)) return null;
  return u;
}

// Exige sesión con uno de los roles indicados. Si no la hay, responde y devuelve null.
export async function exigir(req, res, roles) {
  let u;
  try { u = await sesionDe(req); }
  catch (e) {
    if (e.publico) { res.status(500).json({ error: e.message }); return null; }
    throw e;
  }
  if (!u) { res.status(401).json({ error: 'Su sesión terminó. Ingrese de nuevo.' }); return null; }
  if (roles && !roles.includes(u.rol)) { res.status(403).json({ error: 'No tiene permiso para esta acción.' }); return null; }
  return u;
}

// Empresa sobre la que actúa la petición: la del usuario de empresa, o la elegida por el equipo interno.
export async function empresaObjetivo(u, empresaId) {
  if (u.rol === 'empresa') {
    return { id: u.empresa_id, nombre: u.empresa_nombre, nit: u.empresa_nit, modelo: u.empresa_modelo, productos: u.empresa_productos || [] };
  }
  const id = parseInt(empresaId, 10);
  if (!id) return null;
  const [e] = await sql`SELECT id, nombre, nit, modelo, productos FROM empresas WHERE id = ${id}`;
  return e || null;
}
