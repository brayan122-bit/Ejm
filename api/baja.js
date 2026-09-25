// GET ?doc=: asistencias activas de una cédula en la empresa. POST: registra la baja de las elegidas.
import { sql, asegurarEsquema, ipDe, crearLimitador, leerCuerpo, origenValido, periodoActual, texto, registrarError } from './_db.js';
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
      const filas = await sql`SELECT c.id, c.titular_nombre, c.titular_num_doc, c.asistencia, c.plan, c.mascota, c.valor_mensual,
          to_char(c.fecha_alta, 'DD/MM/YYYY') AS fecha_alta, c.datos->>'titular_tipo_doc' AS tipo_doc,
          EXISTS (SELECT 1 FROM solicitudes s WHERE s.tipo = 'baja' AND s.consolidado_id = c.id AND s.estado = 'pendiente') AS baja_pendiente
        FROM consolidado c
        WHERE c.empresa_id = ${emp.id} AND c.titular_num_doc = ${doc} AND c.estado = 'activo'
        ORDER BY c.asistencia, c.plan`;
      const [pend] = await sql`SELECT count(*)::int AS n FROM solicitudes
        WHERE empresa_id = ${emp.id} AND titular_num_doc = ${doc} AND tipo = 'alta' AND estado = 'pendiente'`;
      return res.status(200).json({ asistencias: filas, altas_pendientes: pend.n });
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
    const ids = Array.isArray(b.consolidado_ids) ? [...new Set(b.consolidado_ids.map(Number).filter(Number.isInteger))].slice(0, 30) : [];
    if (!docValido(doc)) return res.status(400).json({ error: 'Documento inválido.' });
    if (asesor.length < 3) return res.status(400).json({ error: 'Escriba el nombre de quien reporta la baja.' });
    if (!ids.length) return res.status(400).json({ error: 'Seleccione al menos una asistencia.' });

    const filas = await sql`SELECT c.* FROM consolidado c
      WHERE c.id = ANY(${ids}) AND c.empresa_id = ${emp.id} AND c.titular_num_doc = ${doc} AND c.estado = 'activo'
        AND NOT EXISTS (SELECT 1 FROM solicitudes s WHERE s.tipo = 'baja' AND s.consolidado_id = c.id AND s.estado = 'pendiente')`;
    if (filas.length !== ids.length)
      return res.status(409).json({ error: 'Alguna asistencia ya no está activa o ya tiene una baja pendiente. Busque la cédula de nuevo.' });

    const periodo = periodoActual();
    const fecha = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
    const creadas = await sql.transaction(filas.map(c => {
      // Mismos campos que ya llegaban a la base de bajas.
      const d = { fecha, empresa: emp.nombre, nit: emp.nit, asesor, titular_nombre: c.titular_nombre,
        titular_tipo_doc: (c.datos && c.datos.titular_tipo_doc) || 'CC', titular_num_doc: c.titular_num_doc,
        asistencia: c.asistencia, plan: c.plan, mascota: c.mascota || '', valor_mensual: c.valor_mensual, motivo };
      return sql`INSERT INTO solicitudes (periodo, tipo, empresa_id, enviado_por, titular_num_doc, titular_nombre,
          asistencia_id, asistencia, plan_id, plan, mascota, pago, valor_mensual, valor_empresa, valor_colaborador, personas, consolidado_id, modelo_aplicado, datos)
        VALUES (${periodo}, 'baja', ${emp.id}, ${u.id}, ${c.titular_num_doc}, ${c.titular_nombre}, ${c.asistencia_id}, ${c.asistencia},
          ${c.plan_id}, ${c.plan}, ${c.mascota}, ${c.pago}, ${c.valor_mensual}, ${c.valor_empresa}, ${c.valor_colaborador}, ${c.personas},
          ${c.id}, ${c.modelo_aplicado}, ${JSON.stringify(d)}::jsonb)
        RETURNING id`;
    }));
    return res.status(200).json({ ok: true, registradas: filas.length, ids: creadas.map(r => r[0].id) });
  } catch (e) {
    registrarError('Error en bajas', e);
    return res.status(500).json({ error: 'No se pudo procesar la baja.' });
  }
}
