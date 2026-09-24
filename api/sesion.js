// GET: datos de la sesión actual. POST: ingresar. PUT: cambiar contraseña. DELETE: salir.
import { sql, asegurarEsquema, ipDe, crearLimitador, leerCuerpo, origenValido, registrarError } from './_db.js';
import { hashClave, verificarClave, igualSeguro, abrirSesion, cerrarSesion, exigir, claveAceptable } from './_auth.js';
import { CATALOGO, MODELOS, PAGOS, DESCUENTO_MODELO_2 } from './_catalogo.js';

const fallos = crearLimitador(8, 15 * 60 * 1000); // 8 intentos fallidos por IP cada 15 minutos
const espera = () => new Promise(r => setTimeout(r, 700));

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const u = await exigir(req, res); if (!u) return;
      const empresa = u.rol === 'empresa'
        ? { id: u.empresa_id, nombre: u.empresa_nombre, nit: u.empresa_nit, modelo: u.empresa_modelo, productos: u.empresa_productos || [] }
        : null;
      const empresas = u.rol === 'empresa' ? undefined
        : await sql`SELECT id, nombre, nit, modelo, productos FROM empresas WHERE activa ORDER BY nombre`;
      return res.status(200).json({
        usuario: { nombre: u.nombre, email: u.email, rol: u.rol }, empresa, empresas,
        reglas: { modelos: MODELOS, pagos: PAGOS, descuento_modelo_2: DESCUENTO_MODELO_2, catalogo: CATALOGO }
      });
    }

    if (!origenValido(req)) return res.status(403).json({ error: 'Origen no permitido' });

    if (req.method === 'POST') {
      const ip = ipDe(req);
      if (fallos.excedido(ip)) return res.status(429).json({ error: 'Demasiados intentos fallidos. Espere 15 minutos.' });
      const b = leerCuerpo(req) || {};
      const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
      const clave = String(b.clave || '').slice(0, 200);
      if (!email || !clave) return res.status(400).json({ error: 'Escriba su correo y contraseña.' });
      await asegurarEsquema();

      // Administrador principal: definido con ADMIN_EMAIL y ADMIN_PASSWORD en Vercel. Sirve también para recuperar el acceso.
      const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
      const adminClave = process.env.ADMIN_PASSWORD || '';
      if (adminEmail && adminClave.length >= 12 && email === adminEmail && igualSeguro(clave, adminClave)) {
        let [u] = await sql`SELECT id, version, activo, rol FROM usuarios WHERE email = ${email}`;
        if (!u) [u] = await sql`INSERT INTO usuarios (email, nombre, hash, rol) VALUES (${email}, 'Administrador', ${hashClave(clave)}, 'admin') RETURNING id, version, activo, rol`;
        else if (!u.activo || u.rol !== 'admin') [u] = await sql`UPDATE usuarios SET activo = true, rol = 'admin', empresa_id = NULL WHERE id = ${u.id} RETURNING id, version, activo, rol`;
        await sql`UPDATE usuarios SET ultimo_ingreso = now() WHERE id = ${u.id}`;
        abrirSesion(res, u);
        return res.status(200).json({ ok: true, rol: 'admin' });
      }

      const [u] = await sql`SELECT u.id, u.hash, u.rol, u.activo, u.version, e.activa AS empresa_activa
        FROM usuarios u LEFT JOIN empresas e ON e.id = u.empresa_id WHERE u.email = ${email}`;
      const ok = u && verificarClave(clave, u.hash) && u.activo && (u.rol !== 'empresa' || u.empresa_activa);
      if (!ok) { fallos.registrar(ip); await espera(); return res.status(401).json({ error: 'Correo o contraseña incorrectos.' }); }
      await sql`UPDATE usuarios SET ultimo_ingreso = now() WHERE id = ${u.id}`;
      abrirSesion(res, u);
      return res.status(200).json({ ok: true, rol: u.rol });
    }

    if (req.method === 'PUT') {
      const u = await exigir(req, res); if (!u) return;
      const b = leerCuerpo(req) || {};
      const [fila] = await sql`SELECT hash FROM usuarios WHERE id = ${u.id}`;
      if (!verificarClave(String(b.actual || ''), fila.hash)) { await espera(); return res.status(400).json({ error: 'La contraseña actual no es correcta.' }); }
      if (!claveAceptable(b.nueva)) return res.status(400).json({ error: 'La nueva contraseña debe tener mínimo 10 caracteres, con letras y números.' });
      const [n] = await sql`UPDATE usuarios SET hash = ${hashClave(b.nueva)}, version = version + 1 WHERE id = ${u.id} RETURNING id, version`;
      abrirSesion(res, n);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') { cerrarSesion(res); return res.status(200).json({ ok: true }); }

    res.setHeader('Allow', 'GET, POST, PUT, DELETE');
    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    if (e.publico) return res.status(500).json({ error: e.message });
    registrarError('Error de sesión', e);
    return res.status(500).json({ error: 'Error del servidor. Intente de nuevo.' });
  }
}
