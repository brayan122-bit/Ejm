// Recibe cada inscripción (alta) del formulario y la deja pendiente de validación en "solicitudes".
import { sql, asegurarEsquema, ipDe, crearLimitador, leerCuerpo, origenValido, periodoActual, texto, entero, registrarError } from './_db.js';
import { exigir, empresaObjetivo } from './_auth.js';
import { producto, personasDe, PAGOS } from './_catalogo.js';

const limitador = crearLimitador(40, 10 * 60 * 1000); // máx. 40 envíos por IP cada 10 minutos
const MAX_FILAS = 60, MAX_TEXTO = 500;
const CLAVE_VALIDA = /^[a-z0-9_]{1,60}$/i;

function filaValida(f) {
  if (!f || typeof f !== 'object' || Array.isArray(f)) return false;
  const claves = Object.keys(f);
  if (claves.length === 0 || claves.length > 220) return false;
  return claves.every(k => {
    const v = f[k];
    if (!CLAVE_VALIDA.test(k)) return false;
    if (v === null || typeof v === 'number' || typeof v === 'boolean') return true;
    return typeof v === 'string' && v.length <= MAX_TEXTO;
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Método no permitido' }); }
  if (!origenValido(req)) return res.status(403).json({ error: 'Origen no permitido' });
  try {
    const u = await exigir(req, res, ['empresa_admin', 'empresa_usuario', 'maestro', 'validador']); if (!u) return;
    const ip = ipDe(req);
    if (limitador.excedido(ip)) return res.status(429).json({ error: 'Demasiados envíos. Intente más tarde.' });
    limitador.registrar(ip);

    const cuerpo = leerCuerpo(req) || {};
    const filas = cuerpo.filas;
    if (!Array.isArray(filas) || filas.length === 0 || filas.length > MAX_FILAS || !filas.every(filaValida))
      return res.status(400).json({ error: 'Datos de inscripción inválidos' });
    if (!filas.every(f => producto(f.asistencia_id, f.plan_id)))
      return res.status(400).json({ error: 'La inscripción tiene una asistencia o un plan que no existe.' });
    if (!filas.every(f => PAGOS[f.pago_id])) return res.status(400).json({ error: 'Forma de pago inválida.' });
    const idIns = texto(filas[0].id_inscripcion, 80);
    if (!idIns || !filas.every(f => f.id_inscripcion === filas[0].id_inscripcion)) return res.status(400).json({ error: 'Identificador de inscripción inválido.' });

    const emp = await empresaObjetivo(u, cuerpo.empresa_id);
    if (!emp) return res.status(400).json({ error: 'Elija la empresa de la inscripción.' });

    await asegurarEsquema();
    const [ya] = await sql`SELECT 1 FROM solicitudes WHERE id_inscripcion = ${idIns} AND empresa_id = ${emp.id} LIMIT 1`;
    if (ya) return res.status(200).json({ ok: true, repetida: true }); // reintento del mismo envío

    const periodo = periodoActual();
    const filasOk = filas.map(f => ({ ...f, empresa: emp.nombre, nit: emp.nit })); // la empresa sale de la sesión, no del formulario
    const ids = await sql.transaction(filasOk.map(f => {
      const p = producto(f.asistencia_id, f.plan_id);
      const nombre = texto([f.titular_nombres, f.titular_apellidos].filter(Boolean).join(' '), 200);
      // modelo_aplicado: para empresa mixta (3), tomar el que envía el formulario (1 o 2);
      // para empresa no mixta, usar siempre el modelo de la empresa (ignorar lo que mande el browser).
      const modeloEmp = emp.modelo;
      const modeloAplicado = modeloEmp === 3
        ? ([1, 2].includes(Number(f.modelo_aplicado)) ? Number(f.modelo_aplicado) : null)
        : modeloEmp;
      if (modeloEmp === 3) {
        if (!modeloAplicado) throw Object.assign(new Error('La empresa mixta requiere enviar el modelo aplicado (1 o 2).'), { publico: true });
        const esM1 = f.pago_id === 'Nomina';
        const esM2 = ['Empresa', 'Cofinanciado'].includes(f.pago_id);
        if ((modeloAplicado === 1 && !esM1) || (modeloAplicado === 2 && !esM2)) {
          throw Object.assign(new Error(`El modelo aplicado (${modeloAplicado}) no coincide con la forma de pago elegida (${f.pago_id}).`), { publico: true });
        }
      }
      return sql`INSERT INTO solicitudes
        (periodo, tipo, empresa_id, enviado_por, id_inscripcion, titular_num_doc, titular_nombre, asistencia_id, asistencia,
         plan_id, plan, mascota, pago, valor_mensual, valor_empresa, valor_colaborador, personas, modelo_aplicado, datos)
        VALUES (${periodo}, 'alta', ${emp.id}, ${u.id}, ${idIns}, ${texto(f.titular_num_doc, 20)}, ${nombre},
          ${p.asistencia_id}, ${p.asistencia}, ${p.plan_id}, ${p.plan}, ${texto(f.mascota, 200) || null}, ${f.pago_id},
          ${entero(f.valor_mensual)}, ${entero(f.valor_empresa)}, ${entero(f.valor_colaborador)}, ${personasDe(f)},
          ${modeloAplicado}, ${JSON.stringify(f)}::jsonb)
        RETURNING id`;
    }));
    return res.status(200).json({ ok: true, guardadas: filas.length, ids: ids.map(r => r[0].id), periodo });
  } catch (e) {
    if (e.publico) return res.status(400).json({ error: e.message });
    registrarError('Error guardando inscripción', e);
    return res.status(500).json({ error: 'No se pudo guardar la inscripción.' });
  }
}
