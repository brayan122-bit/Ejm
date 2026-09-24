// Catálogo, reglas de negocio y validaciones automáticas. Debe coincidir con CATALOGO de index.html.

export const CATALOGO = {
  doctor:       { corto: 'Doctor 360',       t: 'Asistencia Doctor 360', edadMax: true, planes: {
    Basico: { n: 'Básico' }, Light: { n: 'Light', fam: 1 }, Premium: { n: 'Premium', fam: 1 }, PremiumAdicionales: { n: 'Premium + adicionales', fam: 1, adic: 1 } } },
  odontologica: { corto: 'Odontológica 360', t: 'Asistencia Odontológica 360', edadMax: true, planes: {
    Basico: { n: 'Básico' }, Light: { n: 'Light' }, Premium: { n: 'Premium', fam: 1 }, PremiumAdicionales: { n: 'Premium + adicionales', fam: 1, adic: 1 } } },
  funeral:      { corto: 'Funeral 360',      t: 'Asistencia Funeral 360', edadMax: true, planes: {
    Basico: { n: 'Básico' }, Light: { n: 'Light', fam: 1 }, Premium: { n: 'Premium', fam: 1 }, PremiumAdicionales: { n: 'Premium + adicionales', fam: 1, adic: 1 } } },
  hogar:        { corto: 'Protección Hogar', t: 'Asistencia Protección Hogar y Mascotas', planes: {
    Plan1: { n: 'Protección Hogar Plan 1' }, Plan2: { n: 'Protección Hogar Plan 2' }, Plan3: { n: 'Protección Hogar Plan 3' },
    Mascotas: { n: 'Hogar Mascotas', mascota: 1 }, MascotasPlena: { n: 'Hogar Mascota Plena', mascota: 1 } } }
};

// Lista plana de productos: "doctor:Premium", etc.
export const PRODUCTOS = Object.entries(CATALOGO).flatMap(([g, gr]) =>
  Object.entries(gr.planes).map(([v, p]) => ({ clave: `${g}:${v}`, asistencia_id: g, plan_id: v, asistencia: gr.corto, plan: p.n })));
export const producto = (g, v) => PRODUCTOS.find(p => p.asistencia_id === g && p.plan_id === v) || null;

// Modelo 1: el colaborador paga por nómina. Modelo 2: la empresa paga todo o cofinancia (con descuento).
export const MODELOS = {
  1: { n: 'Modelo 1 · El colaborador paga por nómina', pagos: ['Nomina'] },
  2: { n: 'Modelo 2 · La empresa paga o cofinancia', pagos: ['Empresa', 'Cofinanciado'] }
};
export const PAGOS = { Nomina: 'El colaborador paga por nómina', Empresa: 'La empresa paga', Cofinanciado: 'Cofinanciado (parte por nómina)' };
export const DESCUENTO_MODELO_2 = Math.min(100, Math.max(0, Number(process.env.DESCUENTO_MODELO_2 ?? 5)));
export const EDAD = { titularMin: 18, titularMax: 74 };

// Cuenta a las personas que cubre una fila: titular + cónyuge + hijos + adicionales registrados.
export function personasDe(d) {
  let n = 1;
  if (d.conyuge_nombres || d.conyuge_num_doc) n++;
  for (let i = 1; i <= 4; i++) if (d[`hijo${i}_nombres`] || d[`hijo${i}_num_doc`]) n++;
  for (let i = 1; i <= 2; i++) if (d[`adicional${i}_nombres`] || d[`adicional${i}_num_doc`]) n++;
  return n;
}

function fecha(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s || ''); if (!m) return null;
  const d = new Date(+m[3], +m[2] - 1, +m[1]);
  if (d.getFullYear() !== +m[3] || d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[1] || d > new Date()) return null;
  return d;
}
function edad(d) {
  const r = new Date(); let a = r.getFullYear() - d.getFullYear();
  const mm = r.getMonth() - d.getMonth(); if (mm < 0 || (mm === 0 && r.getDate() < d.getDate())) a--; return a;
}

const CAMPOS_ALTA = {
  titular_nombres: 'nombres', titular_apellidos: 'apellidos', titular_num_doc: 'documento',
  titular_fecha_nac: 'fecha de nacimiento', titular_celular: 'celular', titular_direccion: 'dirección', asesor: 'asesor'
};
const PERSONAS_FAM = [['conyuge_', 'cónyuge'], ...[1, 2, 3, 4].map(i => [`hijo${i}_`, `hijo(a) ${i}`]), ...[1, 2].map(i => [`adicional${i}_`, `adicional ${i}`])];

/**
 * Validaciones automáticas. No bloquean: ayudan al validador a decidir.
 * @param solicitudes  filas del periodo a revisar (con .datos)
 * @param todas        todas las filas del mismo periodo y empresas (para detectar duplicados)
 * @param consolidado  filas del consolidado de esas empresas (activas y retiradas)
 * @param empresas     Map id -> { modelo, productos }
 * Devuelve Map id -> [ { codigo, texto } ]
 */
export function alertasDe(solicitudes, todas, consolidado, empresas) {
  const res = new Map();
  const consPorId = new Map(consolidado.map(c => [c.id, c]));
  const activos = consolidado.filter(c => c.estado === 'activo');
  const valorPorInscripcion = new Map();
  todas.forEach(s => { if (s.tipo === 'alta') valorPorInscripcion.set(s.id_inscripcion, (valorPorInscripcion.get(s.id_inscripcion) || 0) + (s.valor_mensual || 0)); });

  for (const s of solicitudes) {
    const a = []; const d = s.datos || {}; const emp = empresas.get(s.empresa_id) || {};
    const add = (codigo, texto) => a.push({ codigo, texto });
    if (s.tipo === 'alta') {
      const vacios = Object.entries(CAMPOS_ALTA).filter(([k]) => !String(d[k] ?? '').trim()).map(([, n]) => n);
      if (vacios.length) add('vacios', 'Campos vacíos: ' + vacios.join(', '));
      if (!valorPorInscripcion.get(s.id_inscripcion)) add('vacios', 'La inscripción no tiene valor mensual');

      const fn = fecha(d.titular_fecha_nac);
      if (d.titular_fecha_nac && !fn) add('fechas', 'Fecha de nacimiento del titular inválida');
      else if (fn) {
        const e = edad(fn);
        if (e < EDAD.titularMin) add('fechas', `Titular menor de edad (${e} años)`);
        else if (CATALOGO[s.asistencia_id]?.edadMax && e > EDAD.titularMax) add('fechas', `Titular supera la edad de ingreso (${e} años)`);
      }
      PERSONAS_FAM.forEach(([p, n]) => { if (d[p + 'fecha_nac'] && !fecha(d[p + 'fecha_nac'])) add('fechas', `Fecha de nacimiento inválida (${n})`); });

      if (!producto(s.asistencia_id, s.plan_id)) add('producto', 'Producto que no existe en el catálogo');
      else if (Array.isArray(emp.productos) && emp.productos.length && !emp.productos.includes(`${s.asistencia_id}:${s.plan_id}`))
        add('producto', 'Producto no habilitado para la empresa');

      const pagoId = d.pago_id;
      if (emp.modelo && pagoId && !MODELOS[emp.modelo].pagos.includes(pagoId)) add('modelo', `La forma de pago no corresponde al modelo ${emp.modelo}`);
      if ((pagoId === 'Nomina' || pagoId === 'Cofinanciado') && d.aut_descuento !== 'Si') add('autorizacion', 'Sin autorización de descuento por nómina');
      if (d.aut_datos !== 'Si') add('autorizacion', 'Sin autorización de tratamiento de datos');
      if (d.firma_modo === 'papel') add('autorizacion', 'Firma en papel: verificar el soporte firmado');

      const planInfo = CATALOGO[s.asistencia_id]?.planes[s.plan_id];
      const yaActiva = activos.find(c => c.empresa_id === s.empresa_id && c.titular_num_doc === s.titular_num_doc &&
        c.asistencia_id === s.asistencia_id && c.alta_solicitud_id !== s.id &&
        (planInfo?.mascota ? (c.plan_id === s.plan_id && (c.mascota || '').toLowerCase() === (s.mascota || '').toLowerCase()) : !CATALOGO[s.asistencia_id]?.planes[c.plan_id]?.mascota));
      if (yaActiva) add('activa', `Ya está activo en ${yaActiva.asistencia} ${yaActiva.plan}`);

      const dup = todas.find(o => o.id !== s.id && o.tipo === 'alta' && o.estado !== 'invalida' && o.empresa_id === s.empresa_id &&
        o.id_inscripcion !== s.id_inscripcion && o.titular_num_doc === s.titular_num_doc &&
        o.asistencia_id === s.asistencia_id && o.plan_id === s.plan_id && (o.mascota || '') === (s.mascota || ''));
      if (dup) add('duplicado', `Duplicado: enviado también en la solicitud #${dup.id}`);
    } else {
      if (!String(d.asesor ?? '').trim()) add('vacios', 'Campos vacíos: asesor');
      const c = consPorId.get(s.consolidado_id);
      if (!c || c.empresa_id !== s.empresa_id) add('activa', 'La asistencia no existe en el consolidado de la empresa');
      else if (c.estado !== 'activo' && c.baja_solicitud_id !== s.id) add('activa', 'La asistencia ya no está activa');
      const dup = todas.find(o => o.id !== s.id && o.tipo === 'baja' && o.estado !== 'invalida' && o.consolidado_id === s.consolidado_id);
      if (dup) add('duplicado', `Baja duplicada: también en la solicitud #${dup.id}`);
    }
    res.set(s.id, a);
  }
  return res;
}

// Resumen de conciliación de una empresa a partir de su consolidado activo.
export function resumenConciliacion(activos, modelo) {
  const porTitular = new Map();
  const porProducto = new Map();
  let total = 0, emp = 0, col = 0;
  for (const c of activos) {
    porTitular.set(c.titular_num_doc, Math.max(porTitular.get(c.titular_num_doc) || 0, c.personas || 1));
    const k = `${c.asistencia} · ${c.plan}`;
    const p = porProducto.get(k) || { asistencia: c.asistencia, plan: c.plan, cantidad: 0, valor: 0 };
    p.cantidad++; p.valor += c.valor_mensual || 0; porProducto.set(k, p);
    total += c.valor_mensual || 0; emp += c.valor_empresa || 0; col += c.valor_colaborador || 0;
  }
  const pct = modelo === 2 ? DESCUENTO_MODELO_2 : 0;
  const descuento = Math.round(total * pct / 100);
  return {
    titulares: porTitular.size,
    personas: [...porTitular.values()].reduce((a, b) => a + b, 0),
    asistencias: activos.length,
    por_producto: [...porProducto.values()].sort((a, b) => a.asistencia.localeCompare(b.asistencia) || a.plan.localeCompare(b.plan)),
    valor_total: total, valor_empresa: emp, valor_colaborador: col,
    descuento_pct: pct, descuento_valor: descuento, total_a_pagar: total - descuento
  };
}
