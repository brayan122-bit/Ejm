// GET: datos de la sesión actual. POST: ingresar | solicitar_acceso. PUT: cambiar contraseña. DELETE: salir.
import { sql, asegurarEsquema, ipDe, crearLimitador, leerCuerpo, origenValido, registrarError,
         dominioDeEmail, DOMINIOS_PUBLICOS } from './_db.js';
import { hashClave, verificarClave, igualSeguro, abrirSesion, cerrarSesion, exigir,
         claveAceptable, esRolEmpresa } from './_auth.js';
import { CATALOGO, MODELOS, PAGOS, DESCUENTO_MODELO_2 } from './_catalogo.js';

const fallos = crearLimitador(8, 15 * 60 * 1000); // 8 intentos fallidos por IP cada 15 minutos
const espera = () => new Promise(r => setTimeout(r, 700));
// Mismo mensaje para contraseña incorrecta, dominio inválido o usuario inactivo.
// No se revela el motivo exacto del rechazo.
const ERR_LOGIN = 'Correo o contraseña incorrectos.';

export default async function handler(req, res) {
  try {
    // ── GET: datos de sesión ───────────────────────────────────────────────────
    if (req.method === 'GET') {
      const u = await exigir(req, res); if (!u) return;
      const esInterno = !esRolEmpresa(u.rol);
      const empresa = esRolEmpresa(u.rol)
        ? { id: u.empresa_id, nombre: u.empresa_nombre, nit: u.empresa_nit,
            modelo: u.empresa_modelo, productos: u.empresa_productos || [] }
        : null;
      const empresas = esInterno
        ? await sql`SELECT id, nombre, nit, modelo, productos FROM empresas WHERE activa ORDER BY nombre`
        : undefined;
      return res.status(200).json({
        usuario: { nombre: u.nombre, email: u.email, rol: u.rol }, empresa, empresas,
        // El catálogo se sirve desde aquí para tenerlo en un solo lugar.
        reglas: { modelos: MODELOS, pagos: PAGOS, descuento_modelo_2: DESCUENTO_MODELO_2, catalogo: CATALOGO }
      });
    }

    if (!origenValido(req)) return res.status(403).json({ error: 'Origen no permitido' });

    if (req.method === 'POST') {
      const b = leerCuerpo(req) || {};
      const accion = String(b.accion || '');

      // ── Solicitar acceso (auto-registro sin sesión) ────────────────────────
      if (accion === 'solicitar_acceso') return await manejarSolicitudAcceso(b, req, res);

      // ── Login normal ──────────────────────────────────────────────────────
      const ip = ipDe(req);
      if (fallos.excedido(ip)) return res.status(429).json({ error: 'Demasiados intentos fallidos. Espere 15 minutos.' });
      const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
      const clave = String(b.clave || '').slice(0, 200);
      if (!email || !clave) return res.status(400).json({ error: 'Escriba su correo y contraseña.' });
      await asegurarEsquema();

      // Maestro principal: definido con ADMIN_EMAIL y ADMIN_PASSWORD en Vercel.
      // Sirve también para recuperar el acceso si se pierde el usuario maestro.
      const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
      const adminClave = process.env.ADMIN_PASSWORD || '';
      if (adminEmail && adminClave.length >= 12 && email === adminEmail && igualSeguro(clave, adminClave)) {
        let [u] = await sql`SELECT id, version, activo, rol FROM usuarios WHERE email = ${email}`;
        if (!u) {
          [u] = await sql`INSERT INTO usuarios (email, nombre, hash, rol, estado_acceso)
            VALUES (${email}, 'Administrador', ${hashClave(clave)}, 'maestro', 'activo')
            RETURNING id, version, activo, rol`;
        } else if (!u.activo || u.rol !== 'maestro') {
          [u] = await sql`UPDATE usuarios SET activo = true, rol = 'maestro', empresa_id = NULL, estado_acceso = 'activo'
            WHERE id = ${u.id} RETURNING id, version, activo, rol`;
        }
        await sql`UPDATE usuarios SET ultimo_ingreso = now() WHERE id = ${u.id}`;
        abrirSesion(res, u);
        return res.status(200).json({ ok: true, rol: 'maestro' });
      }

      const [u] = await sql`
        SELECT u.id, u.hash, u.rol, u.activo, u.version,
               COALESCE(u.estado_acceso, 'activo') AS estado_acceso,
               e.activa AS empresa_activa,
               COALESCE(e.dominios, '[]'::jsonb) AS empresa_dominios
          FROM usuarios u LEFT JOIN empresas e ON e.id = u.empresa_id
         WHERE u.email = ${email}`;

      // Verificar contraseña primero (timing-safe)
      const claveOk = u && verificarClave(clave, u.hash);
      // Verificar estado del usuario
      const estadoOk = claveOk && u.activo && u.estado_acceso === 'activo';
      if (!estadoOk) {
        fallos.registrar(ip); await espera();
        return res.status(401).json({ error: ERR_LOGIN });
      }
      // Para roles de empresa, verificar dominio (mismo mensaje de error para no revelar el motivo)
      if (esRolEmpresa(u.rol)) {
        if (!u.empresa_activa) { fallos.registrar(ip); await espera(); return res.status(401).json({ error: ERR_LOGIN }); }
        const dominios = u.empresa_dominios || [];
        if (dominios.length > 0) {
          const dom = dominioDeEmail(email);
          if (!dominios.includes(dom)) { fallos.registrar(ip); await espera(); return res.status(401).json({ error: ERR_LOGIN }); }
        }
      }
      await sql`UPDATE usuarios SET ultimo_ingreso = now() WHERE id = ${u.id}`;
      abrirSesion(res, u);
      return res.status(200).json({ ok: true, rol: u.rol });
    }

    // ── PUT: cambiar contraseña ────────────────────────────────────────────────
    if (req.method === 'PUT') {
      const u = await exigir(req, res); if (!u) return;
      const b = leerCuerpo(req) || {};
      const [fila] = await sql`SELECT hash FROM usuarios WHERE id = ${u.id}`;
      if (!verificarClave(String(b.actual || ''), fila.hash)) {
        await espera(); return res.status(400).json({ error: 'La contraseña actual no es correcta.' });
      }
      if (!claveAceptable(b.nueva)) return res.status(400).json({ error: 'La nueva contraseña debe tener mínimo 10 caracteres, con letras y números.' });
      const [n] = await sql`UPDATE usuarios SET hash = ${hashClave(b.nueva)}, version = version + 1
        WHERE id = ${u.id} RETURNING id, version`;
      abrirSesion(res, n);
      return res.status(200).json({ ok: true });
    }

    // ── DELETE: cerrar sesión ─────────────────────────────────────────────────
    if (req.method === 'DELETE') { cerrarSesion(res); return res.status(200).json({ ok: true }); }

    res.setHeader('Allow', 'GET, POST, PUT, DELETE');
    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    if (e.publico) return res.status(500).json({ error: e.message });
    registrarError('Error de sesión', e);
    return res.status(500).json({ error: 'Error del servidor. Intente de nuevo.' });
  }
}

/**
 * Auto-registro: la persona escribe correo, nombre y contraseña.
 * El servidor deduce la empresa por el dominio del correo.
 * Si el dominio no existe o es público → respuesta genérica (sin revelar si la empresa existe).
 */
async function manejarSolicitudAcceso(b, req, res) {
  const ip = ipDe(req);
  if (fallos.excedido(ip)) return res.status(429).json({ error: 'Demasiados intentos. Espere 15 minutos.' });

  const email  = String(b.email  || '').trim().toLowerCase().slice(0, 200);
  const nombre = String(b.nombre || '').trim().slice(0, 150);
  const clave  = String(b.clave  || '').slice(0, 200);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Escriba un correo válido.' });
  if (nombre.length < 3) return res.status(400).json({ error: 'Escriba su nombre completo.' });
  if (!claveAceptable(clave)) return res.status(400).json({ error: 'La contraseña debe tener mínimo 10 caracteres, con letras y números.' });

  // Respuesta genérica: no revela si la empresa existe ni si el dominio es público o privado.
  const MSG = 'Si su empresa está registrada, su solicitud quedará pendiente de aprobación. ' +
              'El administrador de su empresa le notificará cuando pueda ingresar.';

  await asegurarEsquema();
  const dom = dominioDeEmail(email);

  // Dominio público → rechazar silenciosamente con mensaje genérico
  if (DOMINIOS_PUBLICOS.has(dom)) {
    fallos.registrar(ip);
    return res.status(200).json({ ok: true, mensaje: MSG });
  }

  // Buscar empresa que tenga ese dominio registrado (operador @> sobre JSONB)
  const [emp] = await sql`
    SELECT id FROM empresas WHERE dominios @> ${JSON.stringify([dom])}::jsonb AND activa LIMIT 1`;
  if (!emp) {
    fallos.registrar(ip);
    return res.status(200).json({ ok: true, mensaje: MSG });
  }

  // Si el correo ya existe → respuesta genérica (no revelar duplicado)
  const [yaExiste] = await sql`SELECT id FROM usuarios WHERE email = ${email} LIMIT 1`;
  if (yaExiste) return res.status(200).json({ ok: true, mensaje: MSG });

  // Crear usuario pendiente de aprobación (activo=false, estado_acceso='pendiente')
  await sql`INSERT INTO usuarios (email, nombre, hash, rol, empresa_id, activo, estado_acceso)
    VALUES (${email}, ${nombre}, ${hashClave(clave)}, 'empresa_usuario', ${emp.id}, false, 'pendiente')`;

  return res.status(200).json({ ok: true, mensaje: MSG });
}
