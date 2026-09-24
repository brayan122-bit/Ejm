// Operaciones del equipo interno. Todas por POST con { accion, ... }.
//  validador y admin: solicitudes, validar, consolidado, importar, empresas (lectura)
//  solo admin:        empresa_guardar, usuarios, usuario_guardar, usuario_clave
import { sql, asegurarEsquema, leerCuerpo, origenValido, periodoActual, periodoValido, fechaHoy, texto, entero, registrarError } from './_db.js';
import { exigir, hashClave, claveTemporal } from './_auth.js';
import { alertasDe, PRODUCTOS, CATALOGO } from './_catalogo.js';

const SOLO_ADMIN = new Set(['empresa_guardar', 'usuarios', 'usuario_guardar', 'usuario_clave']);
const err = (res, n, msg) => res.status(n).json({ error: msg });

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return err(res, 405, 'Método no permitido'); }
  if (!origenValido(req)) return err(res, 403, 'Origen no permitido');
  try {
    const u = await exigir(req, res, ['admin', 'validador']); if (!u) return;
    const b = leerCuerpo(req) || {};
    const accion = String(b.accion || '');
    if (SOLO_ADMIN.has(accion) && u.rol !== 'admin') return err(res, 403, 'Solo un administrador puede hacer esto.');
    await asegurarEsquema();
    const fn = ACCIONES[accion];
    if (!fn) return err(res, 400, 'Acción desconocida.');
    return await fn(b, u, res);
  } catch (e) {
    if (e.publico) return err(res, 400, e.message);
    registrarError('Error en administración', e);
    return err(res, 500, 'Error del servidor. Intente de nuevo.');
  }
}

const empresaId = v => { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };
const publico = msg => Object.assign(new Error(msg), { publico: true });

const ACCIONES = {
  // ---------- Solicitudes del mes con validaciones automáticas ----------
  async solicitudes(b, u, res) {
    const periodo = periodoValido(b.periodo) ? b.periodo : periodoActual();
    const eid = empresaId(b.empresa_id);
    const todas = eid
      ? await sql`SELECT s.*, e.nombre AS empresa_nombre, e.nit AS empresa_nit FROM solicitudes s JOIN empresas e ON e.id = s.empresa_id
                  WHERE s.periodo = ${periodo} AND s.empresa_id = ${eid} ORDER BY s.id DESC LIMIT 20000`
      : await sql`SELECT s.*, e.nombre AS empresa_nombre, e.nit AS empresa_nit FROM solicitudes s JOIN empresas e ON e.id = s.empresa_id
                  WHERE s.periodo = ${periodo} ORDER BY s.id DESC LIMIT 20000`;
    const empIds = [...new Set(todas.map(s => s.empresa_id))];
    const docs = [...new Set(todas.map(s => s.titular_num_doc))];
    const [cons, emps] = empIds.length ? await Promise.all([
      sql`SELECT id, empresa_id, titular_num_doc, asistencia_id, asistencia, plan_id, plan, mascota, estado, alta_solicitud_id, baja_solicitud_id
          FROM consolidado WHERE empresa_id = ANY(${empIds}) AND titular_num_doc = ANY(${docs})`,
      sql`SELECT id, modelo, productos FROM empresas WHERE id = ANY(${empIds})`
    ]) : [[], []];
    const alertas = alertasDe(todas, todas, cons, new Map(emps.map(e => [e.id, e])));
    const validadores = await sql`SELECT id, nombre FROM usuarios WHERE rol IN ('admin','validador')`;
    const nombreVal = new Map(validadores.map(v => [v.id, v.nombre]));
    const filas = todas.map(s => ({ ...s, alertas: alertas.get(s.id) || [], validado_por_nombre: nombreVal.get(s.validado_por) || '' }));
    const periodos = await sql`SELECT DISTINCT periodo FROM solicitudes ORDER BY periodo DESC LIMIT 24`;
    return res.status(200).json({ periodo, periodo_actual: periodoActual(),
      periodos: [...new Set([periodoActual(), ...periodos.map(p => p.periodo)])], filas });
  },

  // ---------- Marcar solicitudes como válidas / inválidas / pendientes ----------
  // Válida: el alta entra al consolidado; la baja retira la asistencia del consolidado.
  // Si se revierte una válida, el consolidado vuelve a como estaba.
  async validar(b, u, res) {
    const estado = b.estado;
    if (!['valida', 'invalida', 'pendiente'].includes(estado)) return err(res, 400, 'Estado inválido.');
    const motivo = texto(b.motivo, 500);
    if (estado === 'invalida' && motivo.length < 5) return err(res, 400, 'Escriba el motivo para que la empresa sepa qué corregir.');
    const ids = Array.isArray(b.ids) ? [...new Set(b.ids.map(Number).filter(Number.isInteger))].slice(0, 500) : [];
    if (!ids.length) return err(res, 400, 'Seleccione al menos un registro.');

    const sols = await sql`SELECT * FROM solicitudes WHERE id = ANY(${ids})`;
    const consIds = sols.map(s => s.consolidado_id).filter(Boolean);
    const cons = await sql`SELECT id, estado, baja_solicitud_id, alta_solicitud_id FROM consolidado
      WHERE id = ANY(${consIds}) OR alta_solicitud_id = ANY(${ids})`;
    const hoy = fechaHoy();
    const q = []; const avisos = [];
    for (const s of sols) {
      if (s.estado === estado) continue;
      if (s.estado === 'valida') { // revertir efecto
        if (s.tipo === 'alta') {
          const c = cons.find(c => c.alta_solicitud_id === s.id);
          if (c && c.estado === 'retirado') { avisos.push(`#${s.id}: ya tiene una baja validada; no se puede revertir.`); continue; }
          q.push(sql`DELETE FROM consolidado WHERE alta_solicitud_id = ${s.id} AND estado = 'activo'`);
        } else {
          q.push(sql`UPDATE consolidado SET estado = 'activo', fecha_baja = NULL, baja_solicitud_id = NULL, actualizado_en = now()
                     WHERE id = ${s.consolidado_id} AND baja_solicitud_id = ${s.id}`);
        }
      }
      if (estado === 'valida') { // aplicar efecto
        if (s.tipo === 'alta') {
          q.push(sql`INSERT INTO consolidado (empresa_id, titular_num_doc, titular_nombre, asistencia_id, asistencia, plan_id, plan, mascota,
                       pago, valor_mensual, valor_empresa, valor_colaborador, personas, fecha_alta, origen, alta_solicitud_id, datos)
                     SELECT ${s.empresa_id}, ${s.titular_num_doc}, ${s.titular_nombre}, ${s.asistencia_id}, ${s.asistencia}, ${s.plan_id}, ${s.plan},
                       ${s.mascota}, ${s.pago}, ${s.valor_mensual}, ${s.valor_empresa}, ${s.valor_colaborador}, ${s.personas}, ${hoy}::date,
                       'formulario', ${s.id}, ${JSON.stringify(s.datos)}::jsonb
                     WHERE NOT EXISTS (SELECT 1 FROM consolidado WHERE alta_solicitud_id = ${s.id})`);
        } else {
          const c = cons.find(c => c.id === s.consolidado_id);
          if (!c || c.estado !== 'activo') { avisos.push(`#${s.id}: la asistencia ya no está activa; se marca válida sin cambios en el consolidado.`); }
          q.push(sql`UPDATE consolidado SET estado = 'retirado', fecha_baja = ${hoy}::date, baja_solicitud_id = ${s.id}, actualizado_en = now()
                     WHERE id = ${s.consolidado_id} AND estado = 'activo'`);
        }
      }
      q.push(sql`UPDATE solicitudes SET estado = ${estado}, motivo = ${estado === 'invalida' ? motivo : null},
                   validado_por = ${estado === 'pendiente' ? null : u.id}, validado_en = ${estado === 'pendiente' ? null : new Date().toISOString()}
                 WHERE id = ${s.id}`);
    }
    if (q.length) await sql.transaction(q);
    return res.status(200).json({ ok: true, avisos });
  },

  // ---------- Consolidado (base de conciliación / CRM) ----------
  async consolidado(b, u, res) {
    const eid = empresaId(b.empresa_id);
    const filas = eid
      ? await sql`SELECT c.*, to_char(c.fecha_alta,'DD/MM/YYYY') AS fecha_alta_txt, e.nombre AS empresa_nombre, e.nit AS empresa_nit
                  FROM consolidado c JOIN empresas e ON e.id = c.empresa_id WHERE c.estado = 'activo' AND c.empresa_id = ${eid}
                  ORDER BY e.nombre, c.titular_nombre LIMIT 50000`
      : await sql`SELECT c.*, to_char(c.fecha_alta,'DD/MM/YYYY') AS fecha_alta_txt, e.nombre AS empresa_nombre, e.nit AS empresa_nit
                  FROM consolidado c JOIN empresas e ON e.id = c.empresa_id WHERE c.estado = 'activo'
                  ORDER BY e.nombre, c.titular_nombre LIMIT 50000`;
    return res.status(200).json({ filas });
  },

  // Carga inicial del consolidado desde un CSV (personas que ya tienen la asistencia).
  async importar(b, u, res) {
    const eid = empresaId(b.empresa_id);
    const [emp] = eid ? await sql`SELECT id FROM empresas WHERE id = ${eid}` : [];
    if (!emp) return err(res, 400, 'Elija la empresa a la que pertenece el archivo.');
    const filas = Array.isArray(b.filas) ? b.filas : [];
    if (!filas.length || filas.length > 3000) return err(res, 400, 'El archivo debe tener entre 1 y 3.000 filas (divídalo si es más grande).');
    const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const buscar = (asis, plan) => {
      const a = norm(asis), p = norm(plan);
      return PRODUCTOS.find(x => [norm(x.asistencia), norm(x.asistencia_id), norm(CATALOGO[x.asistencia_id].t)].includes(a) &&
                                 [norm(x.plan), norm(x.plan_id)].includes(p)) || null;
    };
    const errores = []; const validas = [];
    filas.forEach((f, i) => {
      const doc = texto(f.titular_num_doc, 20), nombre = texto(f.titular_nombre, 200), prod = buscar(f.asistencia, f.plan);
      const pago = ['Nomina', 'Empresa', 'Cofinanciado'].find(p => norm(p) === norm(f.pago)) || null;
      const fila = i + 2;
      if (!/^[0-9A-Za-z]{4,20}$/.test(doc)) errores.push(`Fila ${fila}: documento inválido`);
      else if (!nombre) errores.push(`Fila ${fila}: falta el nombre`);
      else if (!prod) errores.push(`Fila ${fila}: asistencia/plan no reconocidos ("${texto(f.asistencia, 40)}" / "${texto(f.plan, 40)}")`);
      else validas.push({ doc, nombre, prod, pago, valor: entero(f.valor_mensual), personas: Math.max(1, Math.min(20, entero(f.personas) || 1)),
        mascota: texto(f.mascota, 200) || null, tipo_doc: texto(f.titular_tipo_doc, 5) || 'CC' });
    });
    if (errores.length) return res.status(400).json({ error: `El archivo tiene ${errores.length} fila(s) con errores. No se cargó nada.`, errores: errores.slice(0, 50) });
    const hoy = fechaHoy();
    const r = await sql.transaction(validas.map(v => sql`INSERT INTO consolidado (empresa_id, titular_num_doc, titular_nombre, asistencia_id, asistencia,
        plan_id, plan, mascota, pago, valor_mensual, valor_empresa, valor_colaborador, personas, fecha_alta, origen, datos)
      SELECT ${emp.id}, ${v.doc}, ${v.nombre}, ${v.prod.asistencia_id}, ${v.prod.asistencia}, ${v.prod.plan_id}, ${v.prod.plan}, ${v.mascota},
        ${v.pago}, ${v.valor}, ${v.pago === 'Empresa' ? v.valor : 0}, ${v.pago === 'Nomina' ? v.valor : 0}, ${v.personas}, ${hoy}::date, 'importado',
        ${JSON.stringify({ titular_tipo_doc: v.tipo_doc })}::jsonb
      WHERE NOT EXISTS (SELECT 1 FROM consolidado WHERE empresa_id = ${emp.id} AND estado = 'activo' AND titular_num_doc = ${v.doc}
        AND asistencia_id = ${v.prod.asistencia_id} AND plan_id = ${v.prod.plan_id} AND coalesce(mascota,'') = ${v.mascota || ''})
      RETURNING id`));
    const cargadas = r.filter(x => x.length).length;
    return res.status(200).json({ ok: true, cargadas, omitidas: validas.length - cargadas });
  },

  // ---------- Empresas ----------
  async empresas(b, u, res) {
    const filas = await sql`SELECT e.id, e.nit, e.nombre, e.modelo, e.productos, e.activa,
        (SELECT count(*)::int FROM consolidado c WHERE c.empresa_id = e.id AND c.estado = 'activo') AS activos,
        (SELECT count(*)::int FROM usuarios x WHERE x.empresa_id = e.id AND x.activo) AS usuarios
      FROM empresas e ORDER BY e.nombre`;
    return res.status(200).json({ filas, productos: PRODUCTOS });
  },
  async empresa_guardar(b, u, res) {
    const nit = texto(b.nit, 20).replace(/[^0-9-]/g, ''), nombre = texto(b.nombre, 150);
    const modelo = Number(b.modelo) === 2 ? 2 : 1;
    const productos = Array.isArray(b.productos) ? [...new Set(b.productos.filter(k => PRODUCTOS.some(p => p.clave === k)))] : [];
    const activa = b.activa !== false;
    if (!/^[0-9]{5,12}(-[0-9])?$/.test(nit)) return err(res, 400, 'Escriba un NIT válido (solo números, con o sin dígito de verificación).');
    if (nombre.length < 2) return err(res, 400, 'Escriba el nombre de la empresa.');
    const id = empresaId(b.id);
    try {
      const [e] = id
        ? await sql`UPDATE empresas SET nit = ${nit}, nombre = ${nombre}, modelo = ${modelo}, productos = ${JSON.stringify(productos)}::jsonb, activa = ${activa}
                    WHERE id = ${id} RETURNING id`
        : await sql`INSERT INTO empresas (nit, nombre, modelo, productos, activa) VALUES (${nit}, ${nombre}, ${modelo}, ${JSON.stringify(productos)}::jsonb, ${activa}) RETURNING id`;
      if (!e) return err(res, 404, 'Empresa no encontrada.');
      return res.status(200).json({ ok: true, id: e.id });
    } catch (x) {
      if (String(x.message).includes('duplicate') || x.code === '23505') return err(res, 409, 'Ya existe una empresa con ese NIT.');
      throw x;
    }
  },

  // ---------- Usuarios ----------
  async usuarios(b, u, res) {
    const filas = await sql`SELECT x.id, x.email, x.nombre, x.rol, x.empresa_id, x.activo, x.ultimo_ingreso, e.nombre AS empresa_nombre
      FROM usuarios x LEFT JOIN empresas e ON e.id = x.empresa_id ORDER BY x.rol, e.nombre NULLS FIRST, x.nombre`;
    return res.status(200).json({ filas });
  },
  async usuario_guardar(b, u, res) {
    const email = texto(b.email, 200).toLowerCase(), nombre = texto(b.nombre, 150);
    const rol = ['admin', 'validador', 'empresa'].includes(b.rol) ? b.rol : null;
    const eid = rol === 'empresa' ? empresaId(b.empresa_id) : null;
    const activo = b.activo !== false;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err(res, 400, 'Escriba un correo válido.');
    if (nombre.length < 3) return err(res, 400, 'Escriba el nombre del usuario.');
    if (!rol) return err(res, 400, 'Elija el rol.');
    if (rol === 'empresa' && !eid) return err(res, 400, 'Elija la empresa del usuario.');
    const id = empresaId(b.id);
    if (id === u.id && (!activo || rol !== 'admin')) return err(res, 400, 'No puede quitarse a sí mismo el rol de administrador ni desactivarse.');
    try {
      if (id) {
        // Cambiar rol, empresa o desactivar cierra las sesiones abiertas del usuario.
        const [x] = await sql`UPDATE usuarios SET email = ${email}, nombre = ${nombre}, rol = ${rol}, empresa_id = ${eid}, activo = ${activo},
            version = version + CASE WHEN rol <> ${rol} OR empresa_id IS DISTINCT FROM ${eid} OR activo <> ${activo} THEN 1 ELSE 0 END
          WHERE id = ${id} RETURNING id`;
        if (!x) return err(res, 404, 'Usuario no encontrado.');
        return res.status(200).json({ ok: true, id: x.id });
      }
      const clave = claveTemporal();
      const [x] = await sql`INSERT INTO usuarios (email, nombre, hash, rol, empresa_id, activo)
        VALUES (${email}, ${nombre}, ${hashClave(clave)}, ${rol}, ${eid}, ${activo}) RETURNING id`;
      return res.status(200).json({ ok: true, id: x.id, clave_temporal: clave });
    } catch (x) {
      if (String(x.message).includes('duplicate') || x.code === '23505') return err(res, 409, 'Ya existe un usuario con ese correo.');
      throw x;
    }
  },
  async usuario_clave(b, u, res) {
    const id = empresaId(b.id);
    const clave = claveTemporal();
    const [x] = id ? await sql`UPDATE usuarios SET hash = ${hashClave(clave)}, version = version + 1 WHERE id = ${id} RETURNING id` : [];
    if (!x) return err(res, 404, 'Usuario no encontrado.');
    return res.status(200).json({ ok: true, clave_temporal: clave });
  }
};
