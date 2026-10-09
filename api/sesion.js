// GET: datos de la sesión actual. POST: ingresar | solicitar_acceso | mfa. PUT: cambiar contraseña. DELETE: salir.
import { sql, asegurarEsquema, ipDe, crearLimitador, leerCuerpo, origenValido, registrarError,
         dominioDeEmail, DOMINIOS_PUBLICOS, verificarBloqueoLogin, registrarIntentoLogin, auditar } from './_db.js';
import { hashClave, verificarClave, igualSeguro, abrirSesion, cerrarSesion, exigir, sesionDe,
         claveAceptable, motivoClaveInvalida, esRolEmpresa, firmarTempMfa, leerTempMfa } from './_auth.js';
import { CATALOGO, MODELOS, PAGOS, DESCUENTO_MODELO_2 } from './_catalogo.js';
import { generarSecretoBase32, verificarTOTP, generarCodigosRecuperacion, hashCodigoRecuperacion,
         cifrarSecreto, descifrarSecreto, obtenerClaveCifradoMFA } from './_totp.js';

const fallos = crearLimitador(8, 15 * 60 * 1000); // 8 intentos fallidos en memoria por IP cada 15 minutos
const espera = () => new Promise(r => setTimeout(r, 700));
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
        usuario: {
          nombre: u.nombre,
          email: u.email,
          rol: u.rol,
          debe_cambiar_clave: Boolean(u.debe_cambiar_clave),
          mfa_activo: Boolean(u.mfa_activo)
        },
        empresa,
        empresas,
        reglas: { modelos: MODELOS, pagos: PAGOS, descuento_modelo_2: DESCUENTO_MODELO_2, catalogo: CATALOGO }
      });
    }

    if (!origenValido(req)) return res.status(403).json({ error: 'Origen no permitido' });

    // ── POST: ingresar | solicitar_acceso | mfa_* ──────────────────────────────
    if (req.method === 'POST') {
      const b = leerCuerpo(req) || {};
      const accion = String(b.accion || '');

      // 1. Solicitar acceso (auto-registro sin sesión)
      if (accion === 'solicitar_acceso') return await manejarSolicitudAcceso(b, req, res);

      // 2. Configurar MFA (requiere sesión previa)
      if (accion === 'mfa_configurar') return await manejarConfigurarMFA(req, res);

      // 3. Confirmar activación de MFA con código TOTP (requiere sesión previa)
      if (accion === 'mfa_confirmar') return await manejarConfirmarMFA(b, req, res);

      // 4. Desactivar MFA (requiere sesión previa y validar contraseña)
      if (accion === 'mfa_desactivar') return await manejarDesactivarMFA(b, req, res);

      // ── Login normal ────────────────────────────────────────────────────────
      const ip = ipDe(req);
      const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
      const clave = String(b.clave || '').slice(0, 200);

      // Rate limiting: primero memoria, luego base de datos si está activado
      if (fallos.excedido(ip)) {
        return res.status(429).json({ error: 'Demasiados intentos fallidos. Espere 15 minutos.' });
      }
      const bloqueoDb = await verificarBloqueoLogin(email, ip);
      if (bloqueoDb.bloqueado) {
        return res.status(429).json({ error: bloqueoDb.motivo });
      }

      if (!email || !clave) return res.status(400).json({ error: 'Escriba su correo y contraseña.' });
      await asegurarEsquema();

      // Consultar usuario en la base de datos (NO hay backdoor en texto plano)
      const [u] = await sql`
        SELECT u.id, u.hash, u.rol, u.activo, u.version,
               COALESCE(u.estado_acceso, 'activo') AS estado_acceso,
               COALESCE(u.debe_cambiar_clave, false) AS debe_cambiar_clave,
               COALESCE(u.mfa_activo, false) AS mfa_activo,
               u.mfa_secreto,
               COALESCE(u.mfa_recuperacion, '[]'::jsonb) AS mfa_recuperacion,
               e.activa AS empresa_activa,
               COALESCE(e.dominios, '[]'::jsonb) AS empresa_dominios
          FROM usuarios u LEFT JOIN empresas e ON e.id = u.empresa_id
         WHERE u.email = ${email}`;

      // Verificar contraseña (timing-safe vía scrypt)
      const claveOk = u && verificarClave(clave, u.hash);
      const estadoOk = claveOk && u.activo && u.estado_acceso === 'activo';

      if (!estadoOk) {
        fallos.registrar(ip);
        await registrarIntentoLogin(email, ip, false);
        await auditar(req, null, 'login_fallido', email, { motivo: 'credenciales_incorrectas' });
        await espera();
        return res.status(401).json({ error: ERR_LOGIN });
      }

      // Para roles de empresa, verificar que la empresa esté activa y que el dominio coincida
      if (esRolEmpresa(u.rol)) {
        if (!u.empresa_activa) {
          fallos.registrar(ip);
          await registrarIntentoLogin(email, ip, false);
          await auditar(req, null, 'login_fallido', email, { motivo: 'empresa_inactiva' });
          await espera();
          return res.status(401).json({ error: ERR_LOGIN });
        }
        const dominios = u.empresa_dominios || [];
        if (dominios.length > 0) {
          const dom = dominioDeEmail(email);
          if (!dominios.includes(dom)) {
            fallos.registrar(ip);
            await registrarIntentoLogin(email, ip, false);
            await auditar(req, null, 'login_fallido', email, { motivo: 'dominio_no_autorizado' });
            await espera();
            return res.status(401).json({ error: ERR_LOGIN });
          }
        }
      }

      // ── Flujo de MFA (TOTP y códigos de recuperación) ────────────────────────
      const mfaObligatorio = process.env.MFA_OBLIGATORIO === 'true';
      const requiereMfa = Boolean(u.mfa_activo || (mfaObligatorio && u.rol === 'maestro'));

      if (requiereMfa && u.mfa_activo) {
        const codigoTotp = String(b.totp || '').trim();
        const codigoRecuperacion = String(b.codigo_recuperacion || '').trim();

        if (!codigoTotp && !codigoRecuperacion) {
          // Validar que el servidor tiene configurada la clave antes de solicitar el código MFA
          obtenerClaveCifradoMFA();
          // Primer paso exitoso: devolver requerimiento de MFA con token temporal de 5 minutos
          return res.status(200).json({
            mfa_requerido: true,
            temp_token: firmarTempMfa(u.id)
          });
        }

        // Si se suministró TOTP
        let mfaVerificado = false;
        if (codigoTotp) {
          const secretoPlano = descifrarSecreto(u.mfa_secreto);
          mfaVerificado = verificarTOTP(secretoPlano, codigoTotp);
        } else if (codigoRecuperacion) {
          const hashBuscado = hashCodigoRecuperacion(codigoRecuperacion);
          const codigosGuardados = Array.isArray(u.mfa_recuperacion) ? u.mfa_recuperacion : [];
          if (codigosGuardados.includes(hashBuscado)) {
            mfaVerificado = true;
            // Eliminar código de recuperación utilizado
            const restantes = codigosGuardados.filter(h => h !== hashBuscado);
            await sql`UPDATE usuarios SET mfa_recuperacion = ${JSON.stringify(restantes)}::jsonb WHERE id = ${u.id}`;
            await auditar(req, u, 'mfa_codigo_recuperacion_usado', String(u.id));
          }
        }

        if (!mfaVerificado) {
          fallos.registrar(ip);
          await registrarIntentoLogin(email, ip, false);
          await auditar(req, u, 'login_fallido', email, { motivo: 'mfa_invalido' });
          await espera();
          return res.status(401).json({ error: 'Código de autenticación (MFA) inválido.' });
        }
      } else if (requiereMfa && !u.mfa_activo) {
        // Maestro con MFA obligatorio por flag pero que aún no lo ha inicializado
        return res.status(200).json({
          mfa_requerido: true,
          debe_configurar_mfa: true,
          temp_token: firmarTempMfa(u.id)
        });
      }

      // Login exitoso
      await registrarIntentoLogin(email, ip, true);
      await sql`UPDATE usuarios SET ultimo_ingreso = now() WHERE id = ${u.id}`;
      await auditar(req, u, 'login_ok', email);

      abrirSesion(res, u);
      return res.status(200).json({
        ok: true,
        rol: u.rol,
        debe_cambiar_clave: Boolean(u.debe_cambiar_clave)
      });
    }

    // ── PUT: cambiar contraseña ────────────────────────────────────────────────
    if (req.method === 'PUT') {
      const u = await exigir(req, res); if (!u) return;
      const b = leerCuerpo(req) || {};
      const actual = String(b.actual || '');
      const nueva = String(b.nueva || '');

      const [fila] = await sql`SELECT hash FROM usuarios WHERE id = ${u.id}`;
      if (!fila || !verificarClave(actual, fila.hash)) {
        await espera();
        return res.status(400).json({ error: 'La contraseña actual no es correcta.' });
      }

      const motivo = motivoClaveInvalida(nueva);
      if (motivo) return res.status(400).json({ error: motivo });

      // Invalida sesiones anteriores incrementando version, y desactiva debe_cambiar_clave
      const [n] = await sql`
        UPDATE usuarios
           SET hash = ${hashClave(nueva)},
               version = version + 1,
               debe_cambiar_clave = false
         WHERE id = ${u.id}
        RETURNING id, version`;

      await auditar(req, u, 'cambio_clave', String(u.id));
      abrirSesion(res, { ...u, version: n.version, debe_cambiar_clave: false });
      return res.status(200).json({ ok: true, mensaje: 'Contraseña actualizada correctamente.' });
    }

    // ── DELETE: cerrar sesión (invalidación en servidor) ──────────────────────
    if (req.method === 'DELETE') {
      const u = await sesionDe(req);
      if (u) {
        // Invalidación en servidor: al incrementar version, cualquier token previo queda revocado
        await sql`UPDATE usuarios SET version = version + 1 WHERE id = ${u.id}`;
        await auditar(req, u, 'logout', String(u.id));
      }
      cerrarSesion(res);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PUT, DELETE');
    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    if (e.publico) return res.status(500).json({ error: e.message });
    registrarError('Error de sesión', e);
    return res.status(500).json({ error: 'Error del servidor. Intente de nuevo.' });
  }
}

/**
 * Iniciar configuración de MFA: genera secreto Base32 y códigos de recuperación.
 */
async function manejarConfigurarMFA(req, res) {
  const u = await exigir(req, res); if (!u) return;
  // Requiere obligatoriamente MFA_CLAVE_CIFRADO en el servidor
  obtenerClaveCifradoMFA();
  const secretoB32 = generarSecretoBase32();
  const codigos = generarCodigosRecuperacion();
  const uri = `otpauth://totp/Bienestar%20360:${encodeURIComponent(u.email)}?secret=${secretoB32}&issuer=Bienestar%20360`;

  return res.status(200).json({
    ok: true,
    secreto: secretoB32,
    uri,
    codigos
  });
}

/**
 * Confirmar y activar MFA validando el primer código TOTP generado.
 */
async function manejarConfirmarMFA(b, req, res) {
  const u = await exigir(req, res); if (!u) return;
  const secreto = String(b.secreto || '').trim();
  const codigo = String(b.codigo || '').trim();
  const codigos = Array.isArray(b.codigos) ? b.codigos : [];

  if (!secreto || !codigo) {
    return res.status(400).json({ error: 'Faltan parámetros de verificación MFA.' });
  }

  if (!verificarTOTP(secreto, codigo)) {
    return res.status(400).json({ error: 'El código TOTP es inválido o ha expirado. Verifique la hora de su dispositivo.' });
  }

  const secretoCifrado = cifrarSecreto(secreto);
  const hashesRecuperacion = codigos.map(hashCodigoRecuperacion);
  await sql`
    UPDATE usuarios
       SET mfa_secreto = ${secretoCifrado},
           mfa_activo = true,
           mfa_recuperacion = ${JSON.stringify(hashesRecuperacion)}::jsonb
     WHERE id = ${u.id}
  `;

  await auditar(req, u, 'mfa_activado', String(u.id));
  return res.status(200).json({ ok: true, mensaje: 'Autenticación en dos pasos (MFA) activada correctamente.' });
}

/**
 * Desactivar MFA confirmando la contraseña actual.
 */
async function manejarDesactivarMFA(b, req, res) {
  const u = await exigir(req, res); if (!u) return;
  const clave = String(b.clave || '');

  const [fila] = await sql`SELECT hash FROM usuarios WHERE id = ${u.id}`;
  if (!fila || !verificarClave(clave, fila.hash)) {
    return res.status(400).json({ error: 'Contraseña incorrecta.' });
  }

  const mfaObligatorio = process.env.MFA_OBLIGATORIO === 'true';
  if (mfaObligatorio && u.rol === 'maestro') {
    return res.status(403).json({ error: 'MFA es obligatorio para el usuario maestro y no puede desactivarse.' });
  }

  await sql`
    UPDATE usuarios
       SET mfa_secreto = NULL,
           mfa_activo = false,
           mfa_recuperacion = '[]'::jsonb
     WHERE id = ${u.id}
  `;

  await auditar(req, u, 'mfa_desactivado', String(u.id));
  return res.status(200).json({ ok: true, mensaje: 'MFA desactivado correctamente.' });
}

/**
 * Auto-registro: la persona escribe correo, nombre y contraseña.
 * El servidor deduce la empresa por el dominio del correo.
 */
async function manejarSolicitudAcceso(b, req, res) {
  const ip = ipDe(req);
  if (fallos.excedido(ip)) return res.status(429).json({ error: 'Demasiados intentos. Espere 15 minutos.' });

  const email  = String(b.email  || '').trim().toLowerCase().slice(0, 200);
  const nombre = String(b.nombre || '').trim().slice(0, 150);
  const clave  = String(b.clave  || '').slice(0, 200);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Escriba un correo válido.' });
  if (nombre.length < 3) return res.status(400).json({ error: 'Escriba su nombre completo.' });
  
  const motivo = motivoClaveInvalida(clave);
  if (motivo) return res.status(400).json({ error: motivo });

  const MSG = 'Si su empresa está registrada, su solicitud quedará pendiente de aprobación. ' +
              'El administrador de su empresa le notificará cuando pueda ingresar.';

  await asegurarEsquema();
  const dom = dominioDeEmail(email);

  if (DOMINIOS_PUBLICOS.has(dom)) {
    fallos.registrar(ip);
    return res.status(200).json({ ok: true, mensaje: MSG });
  }

  const [emp] = await sql`
    SELECT id FROM empresas WHERE dominios @> ${JSON.stringify([dom])}::jsonb AND activa LIMIT 1`;
  if (!emp) {
    fallos.registrar(ip);
    return res.status(200).json({ ok: true, mensaje: MSG });
  }

  const [yaExiste] = await sql`SELECT id FROM usuarios WHERE email = ${email} LIMIT 1`;
  if (yaExiste) return res.status(200).json({ ok: true, mensaje: MSG });

  await sql`INSERT INTO usuarios (email, nombre, hash, rol, empresa_id, activo, estado_acceso, debe_cambiar_clave)
    VALUES (${email}, ${nombre}, ${hashClave(clave)}, 'empresa_usuario', ${emp.id}, false, 'pendiente', false)`;

  await auditar(req, null, 'solicitud_acceso', email, { empresa_id: emp.id });
  return res.status(200).json({ ok: true, mensaje: MSG });
}
