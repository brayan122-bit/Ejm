// Tablero de la empresa: conciliación (consolidado activo), solicitudes del mes y registros inválidos.
// Un usuario de empresa SOLO recibe datos de su propia empresa: el filtro se aplica aquí, en el servidor.
import { sql, asegurarEsquema, periodoActual, periodoValido, registrarError } from './_db.js';
import { exigir, empresaObjetivo } from './_auth.js';
import { resumenConciliacion, MODELOS } from './_catalogo.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Método no permitido' }); }
  try {
    const u = await exigir(req, res, ['empresa', 'admin', 'validador']); if (!u) return;
    await asegurarEsquema();
    const emp = await empresaObjetivo(u, req.query.empresa_id);
    if (!emp) return res.status(400).json({ error: 'Elija una empresa.' });
    const periodo = periodoValido(req.query.periodo) ? req.query.periodo : periodoActual();

    const [activos, solicitudes, periodos] = await Promise.all([
      sql`SELECT id, titular_num_doc, titular_nombre, asistencia, plan, mascota, pago, valor_mensual, valor_empresa,
            valor_colaborador, personas, to_char(fecha_alta, 'DD/MM/YYYY') AS fecha_alta, datos->>'titular_tipo_doc' AS tipo_doc
          FROM consolidado WHERE empresa_id = ${emp.id} AND estado = 'activo' ORDER BY titular_nombre, asistencia`,
      sql`SELECT id, recibido_en, tipo, id_inscripcion, titular_num_doc, titular_nombre, asistencia_id, asistencia, plan_id, plan,
            mascota, valor_mensual, estado, motivo, validado_en
          FROM solicitudes WHERE empresa_id = ${emp.id} AND periodo = ${periodo} ORDER BY id DESC`,
      sql`SELECT DISTINCT periodo FROM solicitudes WHERE empresa_id = ${emp.id} ORDER BY periodo DESC LIMIT 24`
    ]);

    // Un inválido queda "corregido" cuando después se envió otra solicitud del mismo titular y producto.
    solicitudes.forEach(s => {
      if (s.estado !== 'invalida') return;
      s.corregida = solicitudes.some(o => o.id > s.id && o.estado !== 'invalida' && o.tipo === s.tipo &&
        o.titular_num_doc === s.titular_num_doc && o.asistencia_id === s.asistencia_id && o.plan_id === s.plan_id);
    });
    const pend = solicitudes.filter(s => s.estado === 'pendiente');
    const suma = arr => arr.reduce((a, s) => a + (s.valor_mensual || 0), 0);
    const altasP = pend.filter(s => s.tipo === 'alta'), bajasP = pend.filter(s => s.tipo === 'baja');

    return res.status(200).json({
      empresa: { id: emp.id, nombre: emp.nombre, nit: emp.nit, modelo: emp.modelo, modelo_nombre: MODELOS[emp.modelo].n },
      periodo, periodo_actual: periodoActual(),
      periodos: [...new Set([periodoActual(), ...periodos.map(p => p.periodo)])],
      resumen: resumenConciliacion(activos, emp.modelo),
      pendientes: { altas: altasP.length, altas_valor: suma(altasP), bajas: bajasP.length, bajas_valor: suma(bajasP) },
      consolidado: activos,
      solicitudes
    });
  } catch (e) {
    registrarError('Error en portal', e);
    return res.status(500).json({ error: 'No se pudo cargar la información.' });
  }
}
