// Recibe cada solicitud de baja que envía el formulario (pestaña "Bajas" de index.html)
// y la guarda en la tabla "bajas", separada de las inscripciones.
import { sqlBajas, asegurarTablaBajas, ipDe, crearLimitador, leerCuerpo, origenValido } from './_db.js';

const limitador = crearLimitador(30, 10 * 60 * 1000); // máx. 30 bajas por IP cada 10 minutos

// Mismo catálogo del formulario: solo se aceptan asistencias y planes que existen.
const CATALOGO = {
  doctor:       { corto: 'Doctor 360',       planes: { Basico: 'Básico', Light: 'Light', Premium: 'Premium', PremiumAdicionales: 'Premium + adicionales' } },
  odontologica: { corto: 'Odontológica 360', planes: { Basico: 'Básico', Light: 'Light', Premium: 'Premium', PremiumAdicionales: 'Premium + adicionales' } },
  funeral:      { corto: 'Funeral 360',      planes: { Basico: 'Básico', Light: 'Light', Premium: 'Premium', PremiumAdicionales: 'Premium + adicionales' } },
  hogar:        { corto: 'Protección Hogar', planes: { Plan1: 'Protección Hogar Plan 1', Plan2: 'Protección Hogar Plan 2', Plan3: 'Protección Hogar Plan 3',
                                                       Mascotas: 'Hogar Mascotas', MascotasPlena: 'Hogar Mascota Plena' } }
};
const TIPOS_DOC = ['CC', 'CE', 'PA', 'PPT', 'TI'];

const texto = (v, max) => typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }
  if (!origenValido(req)) return res.status(403).json({ error: 'Origen no permitido' });

  const ip = ipDe(req);
  if (limitador.excedido(ip)) return res.status(429).json({ error: 'Demasiados envíos. Intente más tarde.' });
  limitador.registrar(ip);

  const b = leerCuerpo(req);
  if (!b || typeof b !== 'object' || Array.isArray(b)) return res.status(400).json({ error: 'Datos de baja inválidos' });

  const asis = CATALOGO[b.asistencia_id];
  const plan = asis && asis.planes[b.plan_id];
  const d = {
    fecha: texto(b.fecha, 10),
    empresa: texto(b.empresa, 150),
    asesor: texto(b.asesor, 150),
    titular_nombre: texto(b.titular_nombre, 150),
    titular_tipo_doc: TIPOS_DOC.includes(b.titular_tipo_doc) ? b.titular_tipo_doc : 'CC',
    titular_num_doc: texto(b.titular_num_doc, 20),
    asistencia: asis ? asis.corto : '',
    plan: plan || '',
    valor_mensual: Number.isSafeInteger(b.valor_mensual) ? b.valor_mensual : 0,
    motivo: texto(b.motivo, 500)
  };

  const errores = [];
  if (d.empresa.length < 2) errores.push('empresa');
  if (d.asesor.length < 3) errores.push('asesor');
  if (d.titular_nombre.length < 3) errores.push('titular');
  if (!/^[0-9A-Za-z]{4,20}$/.test(d.titular_num_doc)) errores.push('documento');
  if (!asis || !plan) errores.push('asistencia o plan');
  if (d.valor_mensual <= 0 || d.valor_mensual > 100000000) errores.push('valor mensual');
  if (errores.length) return res.status(400).json({ error: 'Revise: ' + errores.join(', ') + '.' });

  try {
    await asegurarTablaBajas();
    await sqlBajas`INSERT INTO bajas
      (empresa, asesor, titular_nombre, titular_tipo_doc, titular_num_doc, asistencia, plan, valor_mensual, motivo, datos)
      VALUES (${d.empresa}, ${d.asesor}, ${d.titular_nombre}, ${d.titular_tipo_doc}, ${d.titular_num_doc},
              ${d.asistencia}, ${d.plan}, ${d.valor_mensual}, ${d.motivo || null}, ${JSON.stringify(d)}::jsonb)`;
    return res.status(200).json({ ok: true });
  } catch (e) {
    // Se registra solo el tipo de error, nunca los datos personales.
    console.error('Error guardando baja:', e && e.message ? e.message.slice(0, 200) : 'desconocido');
    return res.status(500).json({ error: 'No se pudo guardar la baja.' });
  }
}
