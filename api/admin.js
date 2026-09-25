// Operaciones del equipo interno y de empresa_admin.
//  maestro + validador: solicitudes, validar, consolidado, importar, empresas (lectura)
//  solo maestro:        empresa_guardar, dominios_guardar, usuarios, usuario_guardar,
//                       usuario_clave, usuario_activar
//  empresa_admin:       mis_usuarios, mi_usuario_guardar, mi_usuario_clave, mi_usuario_activar
import { sql, asegurarEsquema, leerCuerpo, origenValido, periodoActual, periodoValido,
         fechaHoy, texto, entero, registrarError, dominioDeEmail, DOMINIOS_PUBLICOS } from './_db.js';
import { exigir, hashClave, claveTemporal, puedeValidar } from './_auth.js';
import { alertasDe, PRODUCTOS, CATALOGO } from './_catalogo.js';

// Acciones que requieren exactamente rol 'maestro'
const SOLO_MAESTRO = new Set(['empresa_guardar', 'dominios_guardar', 'usuarios', 'usuario_guardar', 'usuario_clave', 'usuario_activar']);
// Acciones disponibles solo para empresa_admin (gestionan su propia empresa)
const EMPRESA_ADMIN_OK = new Set(['mis_usuarios', 'mi_usuario_guardar', 'mi_usuario_clave', 'mi_usuario_activar']);
// Acciones disponibles para maestro + validador
const INTERNOS_OK = new Set(['solicitudes', 'validar', 'consolidado', 'importar', 'empresas']);

const err = (res, n, msg) => res.status(n).json({ error: msg });

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return err(res, 405, 'Método no permitido'); }
  if (!origenValido(req)) return err(res, 403, 'Origen no permitido');
  try {
    // Aceptar: maestro, validador y empresa_admin (con sus propias restricciones por acción)
    const u = await exigir(req, res, ['maestro', 'validador', 'empresa_admin']); if (!u) return;
    const b = leerCuerpo(req) || {};
    const accion = String(b.accion || '');
    await asegurarEsquema();

    // Verificar permisos por acción
    if (accion === 'altas_masivas') {
      if (!['maestro', 'empresa_admin'].includes(u.rol)) return err(res, 403, 'No tiene permiso para esta acción.');
    } else if (EMPRESA_ADMIN_OK.has(accion)) {
      if (u.rol !== 'empresa_admin') return err(res, 403, 'No tiene permiso para esta acción.');
    } else if (SOLO_MAESTRO.has(accion)) {
      if (u.rol !== 'maestro') return err(res, 403, 'Solo el maestro puede hacer esto.');
    } else if (INTERNOS_OK.has(accion)) {
      if (u.rol !== 'maestro' && u.rol !== 'validador') return err(res, 403, 'No tiene permiso para esta acción.');
    } else {
      return err(res, 400, 'Acción desconocida.');
    }

    const fn = ACCIONES[accion];
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
  // ── Solicitudes del mes con validaciones automáticas ──────────────────────
  async solicitudes(b, u, res) {
    const periodo = periodoValido(b.periodo) ? b.periodo : periodoActual();
    const eid = empresaId(b.empresa_id);
    const todas = eid
      ? await sql`SELECT s.*, e.nombre AS empresa_nombre, e.nit AS empresa_nit,
                    COALESCE(s.modelo_aplicado, e.modelo) AS modelo_aplicado,
                    COALESCE(s.origen_tipo, 'formulario') AS origen_tipo,
                    (SELECT a.id FROM archivos a WHERE a.id_inscripcion = s.id_inscripcion AND a.tipo = 'pdf_inscripcion' LIMIT 1) AS archivo_pdf_id,
                    (SELECT a.id FROM archivos a WHERE (a.id_inscripcion = s.id_inscripcion OR a.id_inscripcion = s.datos->>'id_lote') AND a.tipo = 'soporte_nomina' LIMIT 1) AS archivo_soporte_id
                  FROM solicitudes s JOIN empresas e ON e.id = s.empresa_id
                  WHERE s.periodo = ${periodo} AND s.empresa_id = ${eid} ORDER BY s.id DESC LIMIT 20000`
      : await sql`SELECT s.*, e.nombre AS empresa_nombre, e.nit AS empresa_nit,
                    COALESCE(s.modelo_aplicado, e.modelo) AS modelo_aplicado,
                    COALESCE(s.origen_tipo, 'formulario') AS origen_tipo,
                    (SELECT a.id FROM archivos a WHERE a.id_inscripcion = s.id_inscripcion AND a.tipo = 'pdf_inscripcion' LIMIT 1) AS archivo_pdf_id,
                    (SELECT a.id FROM archivos a WHERE (a.id_inscripcion = s.id_inscripcion OR a.id_inscripcion = s.datos->>'id_lote') AND a.tipo = 'soporte_nomina' LIMIT 1) AS archivo_soporte_id
                  FROM solicitudes s JOIN empresas e ON e.id = s.empresa_id
                  WHERE s.periodo = ${periodo} ORDER BY s.id DESC LIMIT 20000`;
    const empIds = [...new Set(todas.map(s => s.empresa_id))];
    const docs   = [...new Set(todas.map(s => s.titular_num_doc))];
    const [cons, emps] = empIds.length ? await Promise.all([
      sql`SELECT id, empresa_id, titular_num_doc, asistencia_id, asistencia, plan_id, plan, mascota, estado, alta_solicitud_id, baja_solicitud_id
          FROM consolidado WHERE empresa_id = ANY(${empIds}) AND titular_num_doc = ANY(${docs})`,
      sql`SELECT id, modelo, productos FROM empresas WHERE id = ANY(${empIds})`
    ]) : [[], []];
    const alertas = alertasDe(todas, todas, cons, new Map(emps.map(e => [e.id, e])));
    const validadores = await sql`SELECT id, nombre FROM usuarios WHERE rol IN ('maestro','validador')`;
    const nombreVal = new Map(validadores.map(v => [v.id, v.nombre]));
    const filas = todas.map(s => ({ ...s, alertas: alertas.get(s.id) || [], validado_por_nombre: nombreVal.get(s.validado_por) || '' }));
    const periodos = await sql`SELECT DISTINCT periodo FROM solicitudes ORDER BY periodo DESC LIMIT 24`;
    return res.status(200).json({ periodo, periodo_actual: periodoActual(),
      periodos: [...new Set([periodoActual(), ...periodos.map(p => p.periodo)])], filas });
  },

  // ── Marcar solicitudes como válidas / inválidas / pendientes ──────────────
  // Solo maestro y validador pueden validar (verificado arriba en el handler).
  async validar(b, u, res) {
    if (!puedeValidar(u.rol)) return err(res, 403, 'Solo el maestro o validador pueden validar solicitudes.');
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
          q.push(sql`INSERT INTO consolidado (empresa_id, titular_num_doc, titular_nombre, asistencia_id, asistencia, plan_id, plan,
                       mascota, pago, valor_mensual, valor_empresa, valor_colaborador, personas, fecha_alta, origen, alta_solicitud_id,
                       modelo_aplicado, datos)
                     SELECT ${s.empresa_id}, ${s.titular_num_doc}, ${s.titular_nombre}, ${s.asistencia_id}, ${s.asistencia},
                       ${s.plan_id}, ${s.plan}, ${s.mascota}, ${s.pago}, ${s.valor_mensual}, ${s.valor_empresa},
                       ${s.valor_colaborador}, ${s.personas}, ${hoy}::date, 'formulario', ${s.id},
                       ${s.modelo_aplicado}, ${JSON.stringify(s.datos)}::jsonb
                     WHERE NOT EXISTS (SELECT 1 FROM consolidado WHERE alta_solicitud_id = ${s.id})`);
        } else {
          const c = cons.find(c => c.id === s.consolidado_id);
          if (!c || c.estado !== 'activo') { avisos.push(`#${s.id}: la asistencia ya no está activa; se marca válida sin cambios en el consolidado.`); }
          q.push(sql`UPDATE consolidado SET estado = 'retirado', fecha_baja = ${hoy}::date, baja_solicitud_id = ${s.id}, actualizado_en = now()
                     WHERE id = ${s.consolidado_id} AND estado = 'activo'`);
        }
      }
      q.push(sql`UPDATE solicitudes SET estado = ${estado},
                   motivo = ${estado === 'invalida' ? motivo : null},
                   validado_por = ${estado === 'pendiente' ? null : u.id},
                   validado_en  = ${estado === 'pendiente' ? null : new Date().toISOString()}
                 WHERE id = ${s.id}`);
    }
    if (q.length) await sql.transaction(q);
    return res.status(200).json({ ok: true, avisos });
  },

  // ── Consolidado ───────────────────────────────────────────────────────────
  async consolidado(b, u, res) {
    const eid = empresaId(b.empresa_id);
    const filas = eid
      ? await sql`SELECT c.*, to_char(c.fecha_alta,'DD/MM/YYYY') AS fecha_alta_txt,
                    e.nombre AS empresa_nombre, e.nit AS empresa_nit,
                    COALESCE(c.modelo_aplicado, e.modelo) AS modelo_aplicado
                  FROM consolidado c JOIN empresas e ON e.id = c.empresa_id
                  WHERE c.estado = 'activo' AND c.empresa_id = ${eid}
                  ORDER BY e.nombre, c.titular_nombre LIMIT 50000`
      : await sql`SELECT c.*, to_char(c.fecha_alta,'DD/MM/YYYY') AS fecha_alta_txt,
                    e.nombre AS empresa_nombre, e.nit AS empresa_nit,
                    COALESCE(c.modelo_aplicado, e.modelo) AS modelo_aplicado
                  FROM consolidado c JOIN empresas e ON e.id = c.empresa_id
                  WHERE c.estado = 'activo'
                  ORDER BY e.nombre, c.titular_nombre LIMIT 50000`;
    return res.status(200).json({ filas });
  },

  // ── Importar consolidado inicial desde CSV/Excel ──────────────────────────
  async importar(b, u, res) {
    const eid = empresaId(b.empresa_id);
    const [emp] = eid ? await sql`SELECT id, modelo FROM empresas WHERE id = ${eid}` : [];
    if (!emp) return err(res, 400, 'Elija la empresa a la que pertenece el archivo.');
    const filas = Array.isArray(b.filas) ? b.filas : [];
    if (!filas.length || filas.length > 3000) return err(res, 400, 'El archivo debe tener entre 1 y 3.000 filas.');
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
      else {
        let modeloAplicado = emp.modelo <= 2 ? emp.modelo : null;
        if (emp.modelo === 3) {
          const modStr = Number(f.modelo || f.modelo_aplicado);
          if ([1, 2].includes(modStr)) modeloAplicado = modStr;
          else if (pago === 'Nomina') modeloAplicado = 1;
          else if (['Empresa', 'Cofinanciado'].includes(pago)) modeloAplicado = 2;
          else { errores.push(`Fila ${fila}: empresa mixta requiere columna "modelo" (1 o 2) o "pago" válido`); return; }
        }
        validas.push({
          doc, nombre, prod, pago,
          valor: entero(f.valor_mensual),
          personas: Math.max(1, Math.min(20, entero(f.personas) || 1)),
          mascota: texto(f.mascota, 200) || null,
          tipo_doc: texto(f.titular_tipo_doc, 5) || 'CC',
          modelo_aplicado: modeloAplicado
        });
      }
    });
    if (errores.length) return res.status(400).json({ error: `El archivo tiene ${errores.length} fila(s) con errores. No se cargó nada.`, errores: errores.slice(0, 50) });
    const hoy = fechaHoy();
    const r = await sql.transaction(validas.map(v =>
      sql`INSERT INTO consolidado (empresa_id, titular_num_doc, titular_nombre, asistencia_id, asistencia,
          plan_id, plan, mascota, pago, valor_mensual, valor_empresa, valor_colaborador, personas,
          fecha_alta, origen, modelo_aplicado, datos)
        SELECT ${emp.id}, ${v.doc}, ${v.nombre}, ${v.prod.asistencia_id}, ${v.prod.asistencia},
          ${v.prod.plan_id}, ${v.prod.plan}, ${v.mascota}, ${v.pago}, ${v.valor},
          ${v.pago === 'Empresa' ? v.valor : 0}, ${v.pago === 'Nomina' ? v.valor : 0},
          ${v.personas}, ${hoy}::date, 'importado', ${v.modelo_aplicado},
          ${JSON.stringify({ titular_tipo_doc: v.tipo_doc })}::jsonb
        WHERE NOT EXISTS (
          SELECT 1 FROM consolidado WHERE empresa_id = ${emp.id} AND estado = 'activo'
          AND titular_num_doc = ${v.doc} AND asistencia_id = ${v.prod.asistencia_id}
          AND plan_id = ${v.prod.plan_id} AND coalesce(mascota,'') = ${v.mascota || ''}
        )
        RETURNING id`));
    const cargadas = r.filter(x => x.length).length;
    return res.status(200).json({ ok: true, cargadas, omitidas: validas.length - cargadas });
  },

  // ── Altas Masivas ───────────────────────────────────────────────────────────
  async altas_masivas(b, u, res) {
    if (!['maestro', 'empresa_admin'].includes(u.rol)) return res.status(403).json({ error: 'No autorizado' });
    const empId = u.rol === 'empresa_admin' ? u.empresa_id : parseInt(b.empresa_id);
    if (!empId) return res.status(400).json({ error: 'Falta empresa_id' });
    const [emp] = await sql`SELECT * FROM empresas WHERE id = ${empId}`;
    if (!emp || !emp.activa) return res.status(400).json({ error: 'Empresa inactiva o no existe' });

    if (!b.id_lote || !Array.isArray(b.filas) || !b.filas.length) return res.status(400).json({ error: 'Faltan filas o id_lote' });
    if (b.filas.length > 3000) return res.status(400).json({ error: 'Máximo 3000 filas por lote' });

    const ids = b.filas.map((_, i) => `${b.id_lote}-F${i+2}`);
    const existentesQuery = await sql`SELECT id_inscripcion FROM solicitudes WHERE empresa_id = ${empId} AND id_inscripcion = ANY(${ids})`;
    const existentes = new Set(existentesQuery.map(x => x.id_inscripcion));

    const errores = [];
    const validas = [];
    let omitidas_repetidas = 0;
    const norm = s => String(s || '').trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    
    const parseExcelDate = v => {
      if (!v) return null;
      if (typeof v === 'number') {
        const d = new Date(Math.round((v - 25569) * 86400 * 1000));
        return `${d.getUTCDate().toString().padStart(2, '0')}/${(d.getUTCMonth()+1).toString().padStart(2, '0')}/${d.getUTCFullYear()}`;
      }
      const txt = String(v).trim();
      return /^(\d{2})\/(\d{2})\/(\d{4})$/.test(txt) ? txt : null;
    };

    b.filas.forEach((f, i) => {
      const fila = i + 2;
      const id_inscripcion = `${b.id_lote}-F${fila}`;
      if (existentes.has(id_inscripcion)) {
        omitidas_repetidas++;
        return;
      }

      let rawDoc = f.num_doc || f.titular_num_doc || '';
      if (typeof rawDoc === 'number') {
         if (rawDoc.toString().includes('e') || rawDoc.toString().includes('E')) {
            errores.push(`Fila ${fila}: La cédula está en notación científica; formatee la columna como Texto en Excel`);
            return;
         }
         rawDoc = Math.floor(rawDoc).toString();
      }
      const doc = String(rawDoc).trim();
      
      const nombres = String(f.nombres || '').trim();
      const apellidos = String(f.apellidos || '').trim();
      const a = norm(f.asistencia);
      const p = norm(f.plan);
      const prod = PRODUCTOS.find(x => norm(x.asistencia) === a && norm(x.plan) === p || norm(x.asistencia_id) === a && norm(x.plan_id) === p);
      const pago = ['Nomina', 'Empresa', 'Cofinanciado'].find(x => norm(x) === norm(f.forma_pago || f.pago)) || null;

      const fecha_nac = parseExcelDate(f.fecha_nac);

      if (!/^[0-9A-Za-z]{4,20}$/.test(doc)) errores.push(`Fila ${fila}: documento inválido (${doc})`);
      else if (!nombres || !apellidos) errores.push(`Fila ${fila}: falta nombres o apellidos`);
      else if (!prod) errores.push(`Fila ${fila}: asistencia/plan no reconocidos`);
      else if (emp.productos && emp.productos.length && !emp.productos.includes(`${prod.asistencia_id}:${prod.plan_id}`)) errores.push(`Fila ${fila}: producto no habilitado`);
      else if (!fecha_nac) errores.push(`Fila ${fila}: fecha de nacimiento inválida o vacía`);
      else {
        let modeloAplicado = emp.modelo <= 2 ? emp.modelo : null;
        if (emp.modelo === 3) {
          const modStr = Number(f.modelo);
          if ([1, 2].includes(modStr)) modeloAplicado = modStr;
          else if (pago === 'Nomina') modeloAplicado = 1;
          else if (['Empresa', 'Cofinanciado'].includes(pago)) modeloAplicado = 2;
          else { errores.push(`Fila ${fila}: empresa mixta requiere columna "modelo" (1 o 2) o "forma_pago" válida`); return; }
        }
        
        const vm = Number(f.valor_mensual) || prod.valor;
        validas.push({
          empresa_id: emp.id,
          tipo: 'alta',
          origen_tipo: 'excel',
          estado: 'pendiente',
          id_inscripcion,
          titular_num_doc: doc,
          titular_nombre: `${nombres} ${apellidos}`.trim(),
          asistencia_id: prod.asistencia_id,
          asistencia: prod.asistencia,
          plan_id: prod.plan_id,
          plan: prod.plan,
          personas: 1,
          pago: pago,
          valor_mensual: vm,
          modelo_aplicado: modeloAplicado,
          datos: {
            id_lote: b.id_lote,
            titular_num_doc: doc,
            titular_nombres: nombres,
            titular_apellidos: apellidos,
            titular_tipo_doc: String(f.tipo_doc || 'CC').trim(),
            titular_fecha_nac: fecha_nac,
            titular_genero: String(f.genero || ''),
            titular_celular: String(f.celular || ''),
            titular_correo: String(f.correo || ''),
            titular_ciudad: String(f.ciudad || ''),
            titular_direccion: String(f.direccion || ''),
            asesor: u.nombre,
            pago_id: pago,
            modelo_aplicado: modeloAplicado,
            valor_mensual: vm,
            valor_empresa: pago === 'Empresa' ? vm : 0,
            valor_colaborador: pago === 'Nomina' ? vm : 0,
            aut_descuento: b.archivo_soporte_id ? 'Si' : '',
            aut_datos: 'Si'
          }
        });
      }
    });

    if (validas.length > 0) {
      await sql.transaction(validas.map(v => 
        sql`INSERT INTO solicitudes (empresa_id, id_inscripcion, tipo, origen_tipo, titular_num_doc, titular_nombre, asistencia_id, asistencia, plan_id, plan, personas, pago, valor_mensual, modelo_aplicado, datos, estado, recibido_en, periodo)
            VALUES (${v.empresa_id}, ${v.id_inscripcion}, ${v.tipo}, ${v.origen_tipo}, ${v.titular_num_doc}, ${v.titular_nombre}, ${v.asistencia_id}, ${v.asistencia}, ${v.plan_id}, ${v.plan}, ${v.personas}, ${v.pago}, ${v.valor_mensual}, ${v.modelo_aplicado}, ${JSON.stringify(v.datos)}::jsonb, ${v.estado}, now(), ${periodoActual()})`
      ));
    }
    
    return res.status(200).json({ ok: true, cargadas: validas.length, omitidas: omitidas_repetidas, errores });
  },

  // ── Empresas ──────────────────────────────────────────────────────────────
  async empresas(b, u, res) {
    const filas = await sql`SELECT e.id, e.nit, e.nombre, e.modelo,
        COALESCE(e.dominios, '[]'::jsonb) AS dominios,
        e.productos, e.activa,
        (SELECT count(*)::int FROM consolidado c WHERE c.empresa_id = e.id AND c.estado = 'activo') AS activos,
        (SELECT count(*)::int FROM usuarios x WHERE x.empresa_id = e.id AND x.activo) AS usuarios
      FROM empresas e ORDER BY e.nombre`;
    return res.status(200).json({ filas, productos: PRODUCTOS });
  },

  async empresa_guardar(b, u, res) {
    const nit    = texto(b.nit, 20).replace(/[^0-9-]/g, '');
    const nombre = texto(b.nombre, 150);
    const modelo = [1, 2, 3].includes(Number(b.modelo)) ? Number(b.modelo) : 1;
    const productos = Array.isArray(b.productos)
      ? [...new Set(b.productos.filter(k => PRODUCTOS.some(p => p.clave === k)))] : [];
    const activa = b.activa !== false;
    if (!/^[0-9]{5,12}(-[0-9])?$/.test(nit)) return err(res, 400, 'Escriba un NIT válido (solo números, con o sin dígito de verificación).');
    if (nombre.length < 2) return err(res, 400, 'Escriba el nombre de la empresa.');
    const id = empresaId(b.id);
    try {
      const [e] = id
        ? await sql`UPDATE empresas SET nit = ${nit}, nombre = ${nombre}, modelo = ${modelo},
                      productos = ${JSON.stringify(productos)}::jsonb, activa = ${activa}
                    WHERE id = ${id} RETURNING id`
        : await sql`INSERT INTO empresas (nit, nombre, modelo, productos, activa)
                    VALUES (${nit}, ${nombre}, ${modelo}, ${JSON.stringify(productos)}::jsonb, ${activa})
                    RETURNING id`;
      if (!e) return err(res, 404, 'Empresa no encontrada.');
      return res.status(200).json({ ok: true, id: e.id });
    } catch (x) {
      if (String(x.message).includes('duplicate') || x.code === '23505') return err(res, 409, 'Ya existe una empresa con ese NIT.');
      throw x;
    }
  },

  // ── Dominios corporativos de una empresa ─────────────────────────────────
  async dominios_guardar(b, u, res) {
    const id = empresaId(b.empresa_id);
    if (!id) return err(res, 400, 'Elija la empresa.');
    const rawDominios = Array.isArray(b.dominios) ? b.dominios : [];
    // Normalizar y filtrar: lowercase, sin espacios, sin públicos
    const dominios = [...new Set(rawDominios
      .map(d => String(d).trim().toLowerCase())
      .filter(d => d && /^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/.test(d) && !DOMINIOS_PUBLICOS.has(d))
    )];
    // Verificar que ningún dominio esté en otra empresa activa
    if (dominios.length) {
      const conflictos = await sql`
        SELECT id, nombre FROM empresas
        WHERE dominios ?| ${dominios}::text[] AND id <> ${id} AND activa`;
      if (conflictos.length) {
        const usados = conflictos.map(c => c.nombre).join(', ');
        return err(res, 409, `Uno o más dominios ya están asignados a: ${usados}`);
      }
    }
    await sql`UPDATE empresas SET dominios = ${JSON.stringify(dominios)}::jsonb WHERE id = ${id}`;
    return res.status(200).json({ ok: true, dominios });
  },

  // ── Usuarios (gestión global, solo maestro) ───────────────────────────────
  async usuarios(b, u, res) {
    const filas = await sql`SELECT x.id, x.email, x.nombre, x.rol, x.empresa_id, x.activo,
        x.ultimo_ingreso, COALESCE(x.estado_acceso, 'activo') AS estado_acceso,
        e.nombre AS empresa_nombre
      FROM usuarios x LEFT JOIN empresas e ON e.id = x.empresa_id
      ORDER BY x.rol, e.nombre NULLS FIRST, x.nombre`;
    return res.status(200).json({ filas });
  },

  async usuario_guardar(b, u, res) {
    const email  = texto(b.email, 200).toLowerCase();
    const nombre = texto(b.nombre, 150);
    const ROLES_VALIDOS = ['maestro', 'validador', 'empresa_admin', 'empresa_usuario'];
    const rol = ROLES_VALIDOS.includes(b.rol) ? b.rol : null;
    const esDeEmpresa = ['empresa_admin', 'empresa_usuario'].includes(rol);
    const eid = esDeEmpresa ? empresaId(b.empresa_id) : null;
    const activo = b.activo !== false;
    const estadoAcceso = ['activo', 'pendiente', 'rechazado'].includes(b.estado_acceso) ? b.estado_acceso : 'activo';

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err(res, 400, 'Escriba un correo válido.');
    if (nombre.length < 3) return err(res, 400, 'Escriba el nombre del usuario.');
    if (!rol) return err(res, 400, 'Elija el rol.');
    if (esDeEmpresa && !eid) return err(res, 400, 'Elija la empresa del usuario.');

    // Si la empresa tiene dominios registrados, el correo debe corresponder
    // (excepción: el maestro puede forzar con excepcion_dominio=true)
    if (esDeEmpresa && !b.excepcion_dominio) {
      const [emp] = await sql`SELECT COALESCE(dominios, '[]'::jsonb) AS dominios FROM empresas WHERE id = ${eid}`;
      if (emp && Array.isArray(emp.dominios) && emp.dominios.length > 0) {
        const dom = dominioDeEmail(email);
        if (!emp.dominios.includes(dom))
          return err(res, 400, `El dominio del correo (${dom}) no está en la lista de dominios de esta empresa. Active "excepción de dominio" para continuar.`);
      }
    }

    const id = empresaId(b.id);
    if (id && id === u.id && (!activo || rol !== 'maestro')) return err(res, 400, 'No puede quitarse a sí mismo el rol de maestro ni desactivarse.');
    try {
      if (id) {
        const [x] = await sql`UPDATE usuarios SET email = ${email}, nombre = ${nombre}, rol = ${rol},
            empresa_id = ${eid}, activo = ${activo}, estado_acceso = ${estadoAcceso},
            version = version + CASE WHEN rol <> ${rol} OR empresa_id IS DISTINCT FROM ${eid}
              OR activo <> ${activo} OR estado_acceso <> ${estadoAcceso} THEN 1 ELSE 0 END
          WHERE id = ${id} RETURNING id`;
        if (!x) return err(res, 404, 'Usuario no encontrado.');
        return res.status(200).json({ ok: true, id: x.id });
      }
      const clave = claveTemporal();
      const [x] = await sql`INSERT INTO usuarios (email, nombre, hash, rol, empresa_id, activo, estado_acceso)
        VALUES (${email}, ${nombre}, ${hashClave(clave)}, ${rol}, ${eid}, ${activo}, ${estadoAcceso})
        RETURNING id`;
      return res.status(200).json({ ok: true, id: x.id, clave_temporal: clave });
    } catch (x) {
      if (String(x.message).includes('duplicate') || x.code === '23505') return err(res, 409, 'Ya existe un usuario con ese correo.');
      throw x;
    }
  },

  async usuario_clave(b, u, res) {
    const id = empresaId(b.id);
    const clave = claveTemporal();
    const [x] = id ? await sql`UPDATE usuarios SET hash = ${hashClave(clave)}, version = version + 1
      WHERE id = ${id} RETURNING id` : [];
    if (!x) return err(res, 404, 'Usuario no encontrado.');
    return res.status(200).json({ ok: true, clave_temporal: clave });
  },

  // Activar / rechazar un usuario pendiente de aprobación (global, maestro)
  async usuario_activar(b, u, res) {
    const id = empresaId(b.id);
    const accionActivar = b.aprobar !== false; // true = aprobar, false = rechazar
    if (!id) return err(res, 400, 'ID de usuario requerido.');
    const [x] = await sql`UPDATE usuarios
        SET activo = ${accionActivar}, estado_acceso = ${accionActivar ? 'activo' : 'rechazado'},
            version = version + 1
        WHERE id = ${id} AND estado_acceso = 'pendiente'
        RETURNING id`;
    if (!x) return err(res, 404, 'Usuario no encontrado o no está pendiente.');
    return res.status(200).json({ ok: true });
  },

  // ── Acciones de empresa_admin (solo su propia empresa) ────────────────────
  async mis_usuarios(b, u, res) {
    // Siempre filtra por la empresa de la sesión (no acepta empresa_id del body)
    const filas = await sql`SELECT id, email, nombre, rol, activo,
        COALESCE(estado_acceso, 'activo') AS estado_acceso, ultimo_ingreso
      FROM usuarios WHERE empresa_id = ${u.empresa_id} ORDER BY nombre`;
    return res.status(200).json({ filas });
  },

  async mi_usuario_guardar(b, u, res) {
    const email  = texto(b.email, 200).toLowerCase();
    const nombre = texto(b.nombre, 150);
    // empresa_admin solo puede crear/editar empresa_usuario
    const rol = 'empresa_usuario';
    const activo = b.activo !== false;
    const estadoAcceso = ['activo', 'pendiente', 'rechazado'].includes(b.estado_acceso) ? b.estado_acceso : 'activo';

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err(res, 400, 'Escriba un correo válido.');
    if (nombre.length < 3) return err(res, 400, 'Escriba el nombre del usuario.');

    // Verificar dominio (igual que en usuario_guardar, a menos que haya excepción)
    if (!b.excepcion_dominio) {
      const [emp] = await sql`SELECT COALESCE(dominios, '[]'::jsonb) AS dominios FROM empresas WHERE id = ${u.empresa_id}`;
      if (emp && Array.isArray(emp.dominios) && emp.dominios.length > 0) {
        const dom = dominioDeEmail(email);
        if (!emp.dominios.includes(dom))
          return err(res, 400, `El dominio del correo (${dom}) no está registrado para su empresa.`);
      }
    }

    const id = empresaId(b.id);
    try {
      if (id) {
        // Verificar que el usuario a editar pertenezca a su empresa
        const [x] = await sql`UPDATE usuarios SET email = ${email}, nombre = ${nombre},
            activo = ${activo}, estado_acceso = ${estadoAcceso},
            version = version + 1
          WHERE id = ${id} AND empresa_id = ${u.empresa_id} RETURNING id`;
        if (!x) return err(res, 404, 'Usuario no encontrado en su empresa.');
        return res.status(200).json({ ok: true, id: x.id });
      }
      const clave = claveTemporal();
      const [x] = await sql`INSERT INTO usuarios (email, nombre, hash, rol, empresa_id, activo, estado_acceso)
        VALUES (${email}, ${nombre}, ${hashClave(clave)}, ${rol}, ${u.empresa_id}, ${activo}, ${estadoAcceso})
        RETURNING id`;
      return res.status(200).json({ ok: true, id: x.id, clave_temporal: clave });
    } catch (x) {
      if (String(x.message).includes('duplicate') || x.code === '23505') return err(res, 409, 'Ya existe un usuario con ese correo.');
      throw x;
    }
  },

  async mi_usuario_clave(b, u, res) {
    const id = empresaId(b.id);
    // Verificar que pertenezca a su empresa
    const clave = claveTemporal();
    const [x] = id ? await sql`UPDATE usuarios SET hash = ${hashClave(clave)}, version = version + 1
      WHERE id = ${id} AND empresa_id = ${u.empresa_id} RETURNING id` : [];
    if (!x) return err(res, 404, 'Usuario no encontrado en su empresa.');
    return res.status(200).json({ ok: true, clave_temporal: clave });
  },

  // empresa_admin activa o rechaza solicitudes de acceso de su propia empresa
  async mi_usuario_activar(b, u, res) {
    const id = empresaId(b.id);
    const aprobar = b.aprobar !== false;
    if (!id) return err(res, 400, 'ID de usuario requerido.');
    const [x] = await sql`UPDATE usuarios
        SET activo = ${aprobar}, estado_acceso = ${aprobar ? 'activo' : 'rechazado'},
            version = version + 1
        WHERE id = ${id} AND empresa_id = ${u.empresa_id} AND estado_acceso = 'pendiente'
        RETURNING id`;
    if (!x) return err(res, 404, 'Usuario no encontrado o no está pendiente en su empresa.');
    return res.status(200).json({ ok: true });
  }
};
