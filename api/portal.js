// Tablero de la empresa: conciliación, personas activas, solicitudes.
// Un usuario de empresa SOLO recibe datos de su propia empresa; el filtro es en el servidor.
// empresa_admin ve solicitudes de todos los periodos; empresa_usuario solo del actual.
import { sql, asegurarEsquema, periodoActual, periodoValido, registrarError, auditar, obtenerModoConsolidado } from './_db.js';
import { exigir, empresaObjetivo, esRolEmpresa } from './_auth.js';
import { resumenConciliacion, MODELOS, precioCatalogo, parsearDinero, normalizarNombreAsistencia } from './_catalogo.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Método no permitido' }); }
  try {
    const u = await exigir(req, res, ['empresa_admin', 'empresa_usuario', 'maestro', 'validador']); if (!u) return;
    await asegurarEsquema();
    const emp = await empresaObjetivo(u, req.query.empresa_id);
    if (!emp) return res.status(400).json({ error: 'Elija una empresa.' });
    const periodo = periodoValido(req.query.periodo) ? req.query.periodo : periodoActual();

    // empresa_admin ve todas las solicitudes de todos los periodos (con filtro de periodo en el front)
    // empresa_usuario y roles internos ven solo el periodo seleccionado
    const esAdmin = u.rol === 'empresa_admin' || !esRolEmpresa(u.rol);
    const modo = await obtenerModoConsolidado();
    const esTest = modo !== 'prod';
    const cleanEmpNit = (emp.nit || '').split('-')[0].replace(/[^0-9A-Za-z]/g, '');

    const consultaActivos = esTest
      ? sql`SELECT c.id::text AS id,
                   COALESCE(c.doc_asociado, c.numero_identificacion, '') AS titular_num_doc,
                   COALESCE(c.asociado, c.titular, '—') AS titular_nombre,
                   c.asistencia,
                   COALESCE(c.plan, 'Plan Único') AS plan,
                   '' AS mascota,
                   'Nomina' AS pago,
                   c.valor_con_iva,
                   (
                     SELECT m.valor
                     FROM consolidado_meses_test m
                     WHERE m.registro_id = c.id AND m.valor > 0
                     ORDER BY m.periodo DESC
                     LIMIT 1
                   ) AS ultimo_valor_mes,
                   1 AS personas,
                   to_char(c.fecha_cargue, 'DD/MM/YYYY') AS fecha_alta,
                   COALESCE(c.tipo_doc, 'CC') AS tipo_doc,
                   ${emp.modelo <= 2 ? emp.modelo : 1} AS modelo_aplicado
            FROM consolidado_conciliacion_test c
            WHERE (c.empresa_id = ${emp.id}
                   OR (regexp_replace(split_part(coalesce(c.nit, ''), '-', 1), '[^0-9A-Za-z]', '', 'g') = ${cleanEmpNit} AND coalesce(c.nit, '') <> ''))
              AND UPPER(BTRIM(c.estado)) = 'ACTIVO'
            ORDER BY titular_nombre, c.asistencia`
      : sql`SELECT c.id::text AS id,
                   COALESCE(c.doc_asociado, c.numero_identificacion, '') AS titular_num_doc,
                   COALESCE(c.asociado, c.titular, '—') AS titular_nombre,
                   c.asistencia,
                   COALESCE(c.plan, 'Plan Único') AS plan,
                   '' AS mascota,
                   'Nomina' AS pago,
                   c.valor_con_iva,
                   (
                     SELECT m.valor
                     FROM consolidado_meses m
                     WHERE m.registro_id = c.id AND m.valor > 0
                     ORDER BY m.periodo DESC
                     LIMIT 1
                   ) AS ultimo_valor_mes,
                   1 AS personas,
                   to_char(c.fecha_cargue, 'DD/MM/YYYY') AS fecha_alta,
                   COALESCE(c.tipo_doc, 'CC') AS tipo_doc,
                   ${emp.modelo <= 2 ? emp.modelo : 1} AS modelo_aplicado
            FROM consolidado_conciliacion c
            WHERE (c.empresa_id = ${emp.id}
                   OR (regexp_replace(split_part(coalesce(c.nit, ''), '-', 1), '[^0-9A-Za-z]', '', 'g') = ${cleanEmpNit} AND coalesce(c.nit, '') <> ''))
              AND UPPER(BTRIM(c.estado)) = 'ACTIVO'
            ORDER BY titular_nombre, c.asistencia`;

    let [activos, solicitudes, periodos] = await Promise.all([
      consultaActivos,

      esAdmin
        ? sql`SELECT id, recibido_en, tipo, id_inscripcion, titular_num_doc, titular_nombre,
                asistencia_id, asistencia, plan_id, plan, mascota, valor_mensual,
                estado, motivo, validado_en, periodo,
                COALESCE(origen_tipo, 'formulario') AS origen_tipo,
                (SELECT a.id FROM archivos a WHERE a.id_inscripcion = solicitudes.id_inscripcion AND a.tipo = 'pdf_inscripcion' LIMIT 1) AS archivo_pdf_id,
                (SELECT a.id FROM archivos a WHERE (a.id_inscripcion = solicitudes.id_inscripcion OR a.id_inscripcion = solicitudes.datos->>'id_lote') AND a.tipo = 'soporte_nomina' LIMIT 1) AS archivo_soporte_id
              FROM solicitudes WHERE empresa_id = ${emp.id} ORDER BY id DESC LIMIT 5000`
        : sql`SELECT id, recibido_en, tipo, id_inscripcion, titular_num_doc, titular_nombre,
                asistencia_id, asistencia, plan_id, plan, mascota, valor_mensual,
                estado, motivo, validado_en, periodo,
                COALESCE(origen_tipo, 'formulario') AS origen_tipo,
                (SELECT a.id FROM archivos a WHERE a.id_inscripcion = solicitudes.id_inscripcion AND a.tipo = 'pdf_inscripcion' LIMIT 1) AS archivo_pdf_id,
                (SELECT a.id FROM archivos a WHERE (a.id_inscripcion = solicitudes.id_inscripcion OR a.id_inscripcion = solicitudes.datos->>'id_lote') AND a.tipo = 'soporte_nomina' LIMIT 1) AS archivo_soporte_id
              FROM solicitudes WHERE empresa_id = ${emp.id} AND periodo = ${periodo} ORDER BY id DESC`,

      sql`SELECT DISTINCT periodo FROM solicitudes WHERE empresa_id = ${emp.id} ORDER BY periodo DESC LIMIT 48`
    ]);

    if (!activos.length) {
      activos = await sql`
        SELECT id::text AS id, titular_num_doc, titular_nombre, asistencia, plan, mascota, pago, valor_mensual, valor_empresa,
              valor_colaborador, personas, to_char(fecha_alta, 'DD/MM/YYYY') AS fecha_alta,
              datos->>'titular_tipo_doc' AS tipo_doc,
              COALESCE(modelo_aplicado, ${emp.modelo <= 2 ? emp.modelo : 1}) AS modelo_aplicado
        FROM consolidado WHERE empresa_id = ${emp.id} AND UPPER(BTRIM(estado)) = 'ACTIVO' ORDER BY titular_nombre, asistencia
      `;
    }

    function buscarPrecioEmpresa(empresa, asistencia, plan) {
      if (!empresa || !empresa.productos) return 0;
      const asisNorm = normalizarNombreAsistencia(asistencia);
      const planNorm = normalizarNombreAsistencia(plan);
      if (Array.isArray(empresa.productos)) {
        for (const prod of empresa.productos) {
          if (typeof prod === 'object' && prod !== null) {
            const prodAsis = normalizarNombreAsistencia(prod.asistencia || prod.nombre || prod.asistencia_id);
            const prodPlan = normalizarNombreAsistencia(prod.plan || prod.plan_id);
            if (prodAsis && asisNorm.includes(prodAsis) && (!prodPlan || planNorm.includes(prodPlan))) {
              const precio = parsearDinero(prod.precio || prod.valor || prod.valor_mensual);
              if (precio > 0) return precio;
            }
          }
        }
      }
      return 0;
    }

    for (const c of activos) {
      let val = parsearDinero(c.valor_con_iva != null ? c.valor_con_iva : c.valor_mensual);
      if (!val && c.ultimo_valor_mes != null) {
        val = parsearDinero(c.ultimo_valor_mes);
      }
      if (!val) {
        val = buscarPrecioEmpresa(emp, c.asistencia, c.plan);
      }
      if (!val) {
        val = precioCatalogo(c.asistencia, c.plan);
      }
      c.valor_mensual = val;

      let ve = parsearDinero(c.valor_empresa);
      let vc = parsearDinero(c.valor_colaborador);
      if (ve === 0 && vc === 0 && val > 0) {
        const pctSubsidio = emp.porcentaje_subsidio != null ? Number(emp.porcentaje_subsidio) : null;
        const modeloEmp = Number(emp.modelo) || 1;
        const modeloFila = Number(c.modelo_aplicado) || (modeloEmp <= 2 ? modeloEmp : 1);

        if (pctSubsidio != null && pctSubsidio > 0 && pctSubsidio <= 100) {
          ve = Math.round(val * pctSubsidio / 100);
          vc = val - ve;
        } else if (modeloFila === 2) {
          ve = val;
          vc = 0;
        } else {
          ve = 0;
          vc = val;
        }
      }
      c.valor_empresa = ve;
      c.valor_colaborador = vc;
    }

    // Usuarios pendientes de aprobación (solo para empresa_admin)
    let pendientesAprobacion = 0;
    if (u.rol === 'empresa_admin') {
      const [p] = await sql`SELECT count(*)::int AS n FROM usuarios
        WHERE empresa_id = ${emp.id} AND estado_acceso = 'pendiente'`;
      pendientesAprobacion = p?.n || 0;
    }

    // Un inválido queda "corregido" cuando después se envió otra solicitud del mismo titular y producto.
    solicitudes.forEach(s => {
      if (s.estado !== 'invalida') return;
      s.corregida = solicitudes.some(o => o.id > s.id && o.estado !== 'invalida' && o.tipo === s.tipo &&
        o.titular_num_doc === s.titular_num_doc && o.asistencia_id === s.asistencia_id && o.plan_id === s.plan_id);
    });

    // Solicitudes del periodo seleccionado (para KPIs de pendientes)
    const solicitudesPeriodo = esAdmin
      ? solicitudes.filter(s => s.periodo === periodo)
      : solicitudes;
    const pend = solicitudesPeriodo.filter(s => s.estado === 'pendiente');
    const suma = arr => arr.reduce((a, s) => a + (s.valor_mensual || 0), 0);
    const altasP = pend.filter(s => s.tipo === 'alta'), bajasP = pend.filter(s => s.tipo === 'baja');

    await auditar(req, u, 'ver_tablero', String(emp.id), { periodo });
    return res.status(200).json({
      empresa: {
        id: emp.id, nombre: emp.nombre, nit: emp.nit, modelo: emp.modelo,
        modelo_nombre: MODELOS[emp.modelo]?.n || `Modelo ${emp.modelo}`,
        porcentaje_subsidio: Number(emp.porcentaje_subsidio) || 0
      },
      periodo, periodo_actual: periodoActual(),
      periodos: [...new Set([periodoActual(), ...periodos.map(p => p.periodo)])],
      resumen: resumenConciliacion(activos, emp.modelo),
      pendientes: { altas: altasP.length, altas_valor: suma(altasP), bajas: bajasP.length, bajas_valor: suma(bajasP) },
      consolidado: activos,
      // solicitudes: para empresa_admin incluye todos los periodos; para empresa_usuario solo el actual
      solicitudes,
      solicitudes_periodo: solicitudesPeriodo,
      pendientes_aprobacion: pendientesAprobacion,
      es_empresa_admin: u.rol === 'empresa_admin'
    });
  } catch (e) {
    registrarError('Error en portal', e);
    return res.status(500).json({ error: 'No se pudo cargar la información.' });
  }
}
