// GET ?doc=: asistencias activas de una cédula en la empresa. POST: registra la baja de las elegidas.
import { sql, asegurarEsquema, ipDe, crearLimitador, leerCuerpo, origenValido, periodoActual, texto, registrarError, auditar, obtenerModoConsolidado } from './_db.js';
import { exigir, empresaObjetivo } from './_auth.js';

const limitador = crearLimitador(60, 10 * 60 * 1000);
const docValido = d => /^[0-9A-Za-z]{4,20}$/.test(d);

export default async function handler(req, res) {
  try {
    const u = await exigir(req, res, ['empresa_admin', 'empresa_usuario', 'maestro', 'validador']); if (!u) return;
    await asegurarEsquema();

    if (req.method === 'GET') {
      const doc = String(req.query.doc || '').trim();
      if (!docValido(doc)) return res.status(400).json({ error: 'Escriba un número de documento válido.' });
      const emp = await empresaObjetivo(u, req.query.empresa_id);
      if (!emp) return res.status(400).json({ error: 'Elija la empresa.' });

      const modo = await obtenerModoConsolidado();
      const esTest = modo !== 'prod';
      const cleanDoc = doc.replace(/[^0-9A-Za-z]/g, '');
      const cleanEmpNit = (emp.nit || '').split('-')[0].replace(/[^0-9A-Za-z]/g, '');

      let filas = [];
      if (esTest) {
        filas = await sql`
          SELECT c.id::text AS id,
                 COALESCE(c.asociado, c.titular, '—') AS titular_nombre,
                 COALESCE(c.doc_asociado, c.numero_identificacion, ${doc}) AS titular_num_doc,
                 c.asistencia,
                 COALESCE(c.plan, 'Plan Único') AS plan,
                 '' AS mascota,
                 COALESCE(c.valor_con_iva, 0)::numeric AS valor_mensual,
                 to_char(c.fecha_cargue, 'DD/MM/YYYY') AS fecha_alta,
                 COALESCE(c.tipo_doc, 'CC') AS tipo_doc,
                 EXISTS (
                   SELECT 1 FROM solicitudes s
                   WHERE s.tipo = 'baja'
                     AND (s.consolidado_id = c.id::text OR (s.titular_num_doc = c.doc_asociado AND s.asistencia = c.asistencia))
                     AND s.estado = 'pendiente'
                 ) AS baja_pendiente
          FROM consolidado_conciliacion_test c
          WHERE (c.empresa_id = ${emp.id}
                 OR (regexp_replace(split_part(coalesce(c.nit, ''), '-', 1), '[^0-9A-Za-z]', '', 'g') = ${cleanEmpNit} AND coalesce(c.nit, '') <> ''))
            AND (regexp_replace(coalesce(c.doc_asociado, ''), '[^0-9A-Za-z]', '', 'g') = ${cleanDoc}
                 OR regexp_replace(coalesce(c.numero_identificacion, ''), '[^0-9A-Za-z]', '', 'g') = ${cleanDoc})
            AND UPPER(BTRIM(c.estado)) = 'ACTIVO'
          ORDER BY c.asistencia, c.plan
        `;
      } else {
        filas = await sql`
          SELECT c.id::text AS id,
                 COALESCE(c.asociado, c.titular, '—') AS titular_nombre,
                 COALESCE(c.doc_asociado, c.numero_identificacion, ${doc}) AS titular_num_doc,
                 c.asistencia,
                 COALESCE(c.plan, 'Plan Único') AS plan,
                 '' AS mascota,
                 COALESCE(c.valor_con_iva, 0)::numeric AS valor_mensual,
                 to_char(c.fecha_cargue, 'DD/MM/YYYY') AS fecha_alta,
                 COALESCE(c.tipo_doc, 'CC') AS tipo_doc,
                 EXISTS (
                   SELECT 1 FROM solicitudes s
                   WHERE s.tipo = 'baja'
                     AND (s.consolidado_id = c.id::text OR (s.titular_num_doc = c.doc_asociado AND s.asistencia = c.asistencia))
                     AND s.estado = 'pendiente'
                 ) AS baja_pendiente
          FROM consolidado_conciliacion c
          WHERE (c.empresa_id = ${emp.id}
                 OR (regexp_replace(split_part(coalesce(c.nit, ''), '-', 1), '[^0-9A-Za-z]', '', 'g') = ${cleanEmpNit} AND coalesce(c.nit, '') <> ''))
            AND (regexp_replace(coalesce(c.doc_asociado, ''), '[^0-9A-Za-z]', '', 'g') = ${cleanDoc}
                 OR regexp_replace(coalesce(c.numero_identificacion, ''), '[^0-9A-Za-z]', '', 'g') = ${cleanDoc})
            AND UPPER(BTRIM(c.estado)) = 'ACTIVO'
          ORDER BY c.asistencia, c.plan
        `;
      }

      // Si no se encontraron en la tabla activa, buscar en la tabla histórica legacy consolidado
      if (!filas.length) {
        filas = await sql`
          SELECT c.id::text AS id, c.titular_nombre, c.titular_num_doc, c.asistencia, c.plan, c.mascota, c.valor_mensual,
            to_char(c.fecha_alta, 'DD/MM/YYYY') AS fecha_alta, c.datos->>'titular_tipo_doc' AS tipo_doc,
            EXISTS (SELECT 1 FROM solicitudes s WHERE s.tipo = 'baja' AND s.consolidado_id = c.id::text AND s.estado = 'pendiente') AS baja_pendiente
          FROM consolidado c
          WHERE c.empresa_id = ${emp.id}
            AND regexp_replace(coalesce(c.titular_num_doc, ''), '[^0-9A-Za-z]', '', 'g') = ${cleanDoc}
            AND UPPER(BTRIM(c.estado)) = 'ACTIVO'
          ORDER BY c.asistencia, c.plan
        `;
      }

      const [pend] = await sql`
        SELECT count(*)::int AS n FROM solicitudes
        WHERE empresa_id = ${emp.id}
          AND regexp_replace(coalesce(titular_num_doc, ''), '[^0-9A-Za-z]', '', 'g') = ${cleanDoc}
          AND tipo = 'alta' AND estado = 'pendiente'
      `;
      return res.status(200).json({ asistencias: filas, altas_pendientes: pend?.n || 0 });
    }

    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Método no permitido' }); }
    if (!origenValido(req)) return res.status(403).json({ error: 'Origen no permitido' });
    const ip = ipDe(req);
    if (limitador.excedido(ip)) return res.status(429).json({ error: 'Demasiados envíos. Intente más tarde.' });
    limitador.registrar(ip);

    const b = leerCuerpo(req) || {};
    const emp = await empresaObjetivo(u, b.empresa_id);
    if (!emp) return res.status(400).json({ error: 'Elija la empresa.' });
    const doc = texto(b.titular_num_doc, 20), asesor = texto(b.asesor, 150), motivo = texto(b.motivo, 500);
    const ids = Array.isArray(b.consolidado_ids) ? [...new Set(b.consolidado_ids.map(x => String(x).trim()).filter(Boolean))].slice(0, 30) : [];
    if (!docValido(doc)) return res.status(400).json({ error: 'Documento inválido.' });
    if (asesor.length < 3) return res.status(400).json({ error: 'Escriba el nombre de quien reporta la baja.' });
    if (!ids.length) return res.status(400).json({ error: 'Seleccione al menos una asistencia.' });

    const modo = await obtenerModoConsolidado();
    const esTest = modo !== 'prod';
    const cleanEmpNit = (emp.nit || '').split('-')[0].replace(/[^0-9A-Za-z]/g, '');

    let filas = [];
    if (esTest) {
      filas = await sql`
        SELECT c.id::text AS id, c.empresa_id, c.nit,
          COALESCE(c.asociado, c.titular) AS titular_nombre,
          COALESCE(c.doc_asociado, c.numero_identificacion) AS titular_num_doc,
          c.tipo_doc, c.asistencia, c.asistencia_id, c.plan, c.plan_id,
          COALESCE(c.valor_con_iva, 0)::numeric AS valor_mensual,
          c.direccion_predio, c.celular, c.correo
        FROM consolidado_conciliacion_test c
        WHERE c.id::text = ANY(${ids})
          AND (c.empresa_id = ${emp.id}
               OR (regexp_replace(split_part(coalesce(c.nit, ''), '-', 1), '[^0-9A-Za-z]', '', 'g') = ${cleanEmpNit} AND coalesce(c.nit, '') <> ''))
          AND UPPER(BTRIM(c.estado)) = 'ACTIVO'
          AND NOT EXISTS (SELECT 1 FROM solicitudes s WHERE s.tipo = 'baja' AND s.consolidado_id = c.id::text AND s.estado = 'pendiente')
      `;
    } else {
      filas = await sql`
        SELECT c.id::text AS id, c.empresa_id, c.nit,
          COALESCE(c.asociado, c.titular) AS titular_nombre,
          COALESCE(c.doc_asociado, c.numero_identificacion) AS titular_num_doc,
          c.tipo_doc, c.asistencia, c.asistencia_id, c.plan, c.plan_id,
          COALESCE(c.valor_con_iva, 0)::numeric AS valor_mensual,
          c.direccion_predio, c.celular, c.correo
        FROM consolidado_conciliacion c
        WHERE c.id::text = ANY(${ids})
          AND (c.empresa_id = ${emp.id}
               OR (regexp_replace(split_part(coalesce(c.nit, ''), '-', 1), '[^0-9A-Za-z]', '', 'g') = ${cleanEmpNit} AND coalesce(c.nit, '') <> ''))
          AND UPPER(BTRIM(c.estado)) = 'ACTIVO'
          AND NOT EXISTS (SELECT 1 FROM solicitudes s WHERE s.tipo = 'baja' AND s.consolidado_id = c.id::text AND s.estado = 'pendiente')
      `;
    }

    // Si algunas vienen de la tabla legacy consolidado
    if (filas.length < ids.length) {
      const faltantes = ids.filter(id => !filas.some(f => f.id === id));
      const intIds = faltantes.map(Number).filter(Number.isInteger);
      if (intIds.length) {
        const legacy = await sql`
          SELECT c.id::text AS id, c.empresa_id, ${emp.nit} AS nit,
            c.titular_nombre, c.titular_num_doc,
            c.datos->>'titular_tipo_doc' AS tipo_doc,
            c.asistencia, c.asistencia_id, c.plan, c.plan_id,
            c.valor_mensual, c.mascota, c.pago, c.valor_empresa, c.valor_colaborador, c.personas, c.modelo_aplicado
          FROM consolidado c
          WHERE c.id = ANY(${intIds}) AND c.empresa_id = ${emp.id}
            AND UPPER(BTRIM(c.estado)) = 'ACTIVO'
            AND NOT EXISTS (SELECT 1 FROM solicitudes s WHERE s.tipo = 'baja' AND s.consolidado_id = c.id::text AND s.estado = 'pendiente')
        `;
        filas = [...filas, ...legacy];
      }
    }

    if (filas.length !== ids.length)
      return res.status(409).json({ error: 'Alguna asistencia ya no está activa o ya tiene una baja pendiente. Busque la cédula de nuevo.' });

    const periodo = periodoActual();
    const fecha = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
    const creadas = await sql.transaction(filas.map(c => {
      const d = { fecha, empresa: emp.nombre, nit: emp.nit, asesor, titular_nombre: c.titular_nombre,
        titular_tipo_doc: c.tipo_doc || 'CC', titular_num_doc: c.titular_num_doc,
        asistencia: c.asistencia, plan: c.plan || '', mascota: c.mascota || '',
        valor_mensual: c.valor_mensual || 0, motivo, consolidado_id: c.id };
      return sql`INSERT INTO solicitudes (periodo, tipo, empresa_id, enviado_por, titular_num_doc, titular_nombre,
          asistencia_id, asistencia, plan_id, plan, mascota, pago, valor_mensual, valor_empresa, valor_colaborador, personas, consolidado_id, modelo_aplicado, datos)
        VALUES (${periodo}, 'baja', ${emp.id}, ${u.id}, ${c.titular_num_doc}, ${c.titular_nombre},
          ${c.asistencia_id || null}, ${c.asistencia}, ${c.plan_id || null}, ${c.plan || ''}, ${c.mascota || ''},
          ${c.pago || 'Nomina'}, ${Math.round(c.valor_mensual || 0)}, ${Math.round(c.valor_empresa || 0)}, ${Math.round(c.valor_colaborador || 0)},
          ${c.personas || 1}, ${c.id}, ${c.modelo_aplicado || emp.modelo || 1}, ${JSON.stringify(d)}::jsonb)
        RETURNING id`;
    }));
    await auditar(req, u, 'baja', doc, { cantidad: creadas.length, empresa_id: emp.id, motivo });
    return res.status(200).json({ ok: true, registradas: filas.length, ids: creadas.map(r => r[0].id) });
  } catch (e) {
    registrarError('Error en bajas', e);
    return res.status(500).json({ error: 'No se pudo procesar la baja.' });
  }
}
