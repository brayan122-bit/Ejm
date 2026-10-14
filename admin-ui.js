let SES = null, EMPRESAS = [], PRODUCTOS = [], SOL = null, CONS = [], USUARIOS = [];
const sel = new Set();
const esMaestro  = () => SES.usuario.rol === 'maestro';
const esInterno  = () => ['maestro', 'validador'].includes(SES.usuario.rol);
const PAGO_TXT = { Nomina: 'Nómina', Empresa: 'Empresa', Cofinanciado: 'Cofinanciado' };
const ROLES_LABEL = { maestro: 'Maestro', validador: 'Validador', empresa_admin: 'Empresa admin', empresa_usuario: 'Empresa usuario' };

function abrirTab(t) {
  $$('[data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
  $$('[data-panel]').forEach(p => p.hidden = p.dataset.panel !== t);
  if (t === 'consolidado') cargarConsolidado().catch(x => toast(x.message));
  if (t === 'empresas') cargarEmpresas().catch(x => toast(x.message));
  if (t === 'usuarios') cargarUsuarios().catch(x => toast(x.message));
}
$$('[data-tab]').forEach(b => b.addEventListener('click', () => abrirTab(b.dataset.tab)));

function pintarSelectEmpresas() {
  const ops = EMPRESAS.map(e => `<option value="${e.id}">${esc(e.nombre)}${e.activa === false ? ' (inactiva)' : ''}</option>`).join('');
  $$('.selEmpresas').forEach(s => { const v = s.value; s.innerHTML = '<option value="">Todas las empresas</option>' + ops; s.value = v; });
  $$('.selEmpresasObl').forEach(s => { const v = s.value; s.innerHTML = '<option value="">Seleccione…</option>' + ops; s.value = v; });
}

/* ==================== SOLICITUDES ==================== */
async function cargarSolicitudes() {
  SOL = await api('/api/admin', { method: 'POST', body: { accion: 'solicitudes', periodo: $('#sPeriodo').value || undefined } });
  $('#sPeriodo').innerHTML = SOL.periodos.map(p => `<option value="${p}" ${p === SOL.periodo ? 'selected' : ''}>${esc(nombreMes(p))}${p === SOL.periodo_actual ? ' (actual)' : ''}</option>`).join('');
  const vivos = new Set(SOL.filas.map(f => f.id)); [...sel].forEach(id => { if (!vivos.has(id)) sel.delete(id); });
  pintarSolicitudes();
}
function filtradas() {
  const e = $('#sEmpresa').value, t = $('#sTipo').value, st = $('#sEstado').value, al = $('#sAlertas').checked, q = $('#sQ').value.trim().toLowerCase();
  return SOL.filas.filter(s => (!e || String(s.empresa_id) === e) && (!t || s.tipo === t) && (!st || s.estado === st) &&
    (!al || s.alertas.length) && (!q || [s.titular_num_doc, s.titular_nombre, s.empresa_nombre, s.empresa_nit].some(v => String(v || '').toLowerCase().includes(q))));
}
function pintarSolicitudes() {
  const lista = filtradas();
  const base = SOL.filas.filter(s => !$('#sEmpresa').value || String(s.empresa_id) === $('#sEmpresa').value);
  const cnt = st => base.filter(s => s.estado === st).length;
  const pend = SOL.filas.filter(s => s.estado === 'pendiente').length;
  if ($('#cntPend')) { $('#cntPend').textContent = pend; $('#cntPend').hidden = !pend; }
  if ($('#sKpis')) {
    $('#sKpis').innerHTML = [
      ['Recibidas en el mes', base.length, `${base.filter(s => s.tipo === 'alta').length} altas · ${base.filter(s => s.tipo === 'baja').length} bajas`],
      ['Pendientes', cnt('pendiente'), `${base.filter(s => s.estado === 'pendiente' && s.alertas.length).length} con alertas`],
      ['Válidas', cnt('valida'), 'Ya aplicadas al consolidado', 'ok'],
      ['Inválidas', cnt('invalida'), 'Visibles para la empresa']
    ].map(([l, v, d, c]) => `<div class="kpi ${c || ''}"><div class="l">${l}</div><div class="v">${numero(v)}</div><div class="d">${esc(d)}</div></div>`).join('');
  }
  if ($('#sTb')) {
    $('#sTb').innerHTML = lista.map(s => `<tr class="click ${sel.has(s.id) ? 'sel' : ''}" data-id="${s.id}">
      <td><input type="checkbox" data-sel="${s.id}" ${sel.has(s.id) ? 'checked' : ''} aria-label="Seleccionar ${s.id}"></td>
      <td class="nw">${s.id}</td><td class="nw">${esc(fechaHora(s.recibido_en))}</td>
      <td>${esc(s.empresa_nombre)}<small class="muted">NIT ${esc(s.empresa_nit)}</small></td>
      <td><span class="tag ${s.tipo}">${s.tipo === 'alta' ? 'Alta' : 'Baja'}</span></td>
      <td>${esc(s.titular_nombre)}<small class="muted">${esc(s.titular_num_doc)}</small></td>
      <td>${esc(s.asistencia)} · ${esc(s.plan)}${s.mascota ? `<small class="muted">${esc(s.mascota)}</small>` : ''}</td>
      <td class="num">${s.valor_mensual ? pesos(s.valor_mensual) : ''}<small class="muted" style="display:block">Mod. ${s.modelo_aplicado || 1}</small></td>
      <td>${s.alertas.length ? s.alertas.map(a => `<span class="al">${esc(a.texto)}</span>`).join('') : '<span class="muted" style="font-size:12.5px">Sin alertas</span>'}</td>
      <td><span class="tag ${s.estado}">${ESTADOS[s.estado]}</span>${s.estado === 'invalida' && s.motivo ? `<span class="motivo">${esc(s.motivo)}</span>` : ''}
        ${s.validado_por_nombre ? `<small class="muted">${esc(s.validado_por_nombre)}</small>` : ''}</td></tr>`).join('');
  }
  const elVac = $('#sVacio');
  if (elVac) {
    elVac.hidden = lista.length > 0;
    elVac.textContent = SOL.filas.length ? 'No hay solicitudes con esos filtros.' : `No llegaron solicitudes en ${nombreMes(SOL.periodo)}.`;
  }
  if ($('#sTodos')) $('#sTodos').checked = lista.length > 0 && lista.every(s => sel.has(s.id));
  pintarSeleccion();
}
function pintarSeleccion() {
  if ($('#sSel')) $('#sSel').textContent = `${sel.size} seleccionada${sel.size === 1 ? '' : 's'}`;
  ['#sValida', '#sInvalida', '#sPendiente'].forEach(b => { const el = $(b); if (el) el.disabled = !sel.size; });
}
$('#sTb').addEventListener('click', e => {
  const cb = e.target.closest('[data-sel]');
  if (cb) { const id = +cb.dataset.sel; cb.checked ? sel.add(id) : sel.delete(id); cb.closest('tr').classList.toggle('sel', cb.checked); pintarSeleccion(); return; }
  const tr = e.target.closest('tr[data-id]'); if (tr) verDetalle(+tr.dataset.id);
});
$('#sTodos').addEventListener('change', e => { filtradas().forEach(s => e.target.checked ? sel.add(s.id) : sel.delete(s.id)); pintarSolicitudes(); });
$('#sLimpias').addEventListener('click', () => { sel.clear(); filtradas().filter(s => s.estado === 'pendiente' && !s.alertas.length).forEach(s => sel.add(s.id)); pintarSolicitudes(); toast(`${sel.size} seleccionadas.`); });
['#sEmpresa', '#sTipo', '#sEstado', '#sAlertas'].forEach(i => $(i).addEventListener('change', () => { sel.clear(); pintarSolicitudes(); }));
$('#sQ').addEventListener('input', pintarSolicitudes);
$('#sPeriodo').addEventListener('change', () => { sel.clear(); cargarSolicitudes().catch(x => toast(x.message)); });
$('#sRecargar').addEventListener('click', () => cargarSolicitudes().then(() => toast('Actualizado.')).catch(x => toast(x.message)));

const ETIQ = { fecha: 'Fecha', empresa: 'Empresa', nit: 'NIT', asesor: 'Asesor', motivo: 'Motivo de la baja', modalidad: 'Modalidad', pago: 'Forma de pago',
  cubre_a: 'Cubre a', valor_mensual: 'Valor mensual', valor_empresa: 'Paga la empresa', valor_colaborador: 'Paga el colaborador',
  aut_datos: 'Autoriza tratamiento de datos', aut_descuento: 'Autoriza descuento por nómina', firma_modo: 'Firma', mascota: 'Mascota' };
const OCULTAR = new Set(['id_inscripcion', 'asistencia_id', 'plan_id', 'pago_id']);
function verDetalle(id) {
  const s = SOL.filas.find(x => x.id === id); if (!s) return;
  if ($('#dDetT')) $('#dDetT').textContent = `Solicitud #${s.id} · ${s.tipo === 'alta' ? 'Alta' : 'Baja'}`;
  const campos = Object.entries(s.datos || {}).filter(([k, v]) => !OCULTAR.has(k) && String(v ?? '').trim() !== '');
  if ($('#dDetB')) {
    $('#dDetB').innerHTML = `
      ${s.alertas.length ? `<div class="notice warn"><strong>Validaciones automáticas</strong><ul>${s.alertas.map(a => `<li>${esc(a.texto)}</li>`).join('')}</ul></div>` : '<div class="notice ok">Sin alertas automáticas.</div>'}
      ${s.estado === 'invalida' ? `<div class="notice bad"><strong>Inválida:</strong> ${esc(s.motivo)}</div>` : ''}
      <div style="margin-bottom:12px;display:flex;gap:8px;">
        ${s.archivo_pdf_id ? `<a href="/api/archivo?id=${s.archivo_pdf_id}" target="_blank" class="btn sec sm" style="text-decoration:none">📄 Descargar PDF</a>` : ''}
        ${s.archivo_soporte_id ? `<a href="/api/archivo?id=${s.archivo_soporte_id}" target="_blank" class="btn sec sm" style="text-decoration:none">📎 Ver soporte</a>` : ''}
      </div>
      <dl class="det">
        <dt>Empresa</dt><dd>${esc(s.empresa_nombre)} · NIT ${esc(s.empresa_nit)}</dd>
        <dt>Asistencia</dt><dd>${esc(s.asistencia)} · ${esc(s.plan)}</dd>
        <dt>Estado</dt><dd><span class="tag ${s.estado}">${ESTADOS[s.estado]}</span> ${s.validado_por_nombre ? esc('por ' + s.validado_por_nombre + ' · ' + fechaHora(s.validado_en)) : ''}</dd>
        ${campos.map(([k, v]) => `<dt>${esc(ETIQ[k] || k.replace(/_/g, ' '))}</dt><dd>${esc(/^valor/.test(k) ? pesos(v) : v)}</dd>`).join('')}
      </dl>`;
  }
  if ($('#dDet')) $('#dDet').showModal();
}

async function validar(estado, motivo) {
  const ids = [...sel];
  const r = await api('/api/admin', { method: 'POST', body: { accion: 'validar', ids, estado, motivo } });
  sel.clear(); await cargarSolicitudes();
  toast(`${ids.length} registro${ids.length === 1 ? '' : 's'} en estado «${ESTADOS[estado]}».`);
  if (r.avisos && r.avisos.length) alert(r.avisos.join('\n'));
}
$('#sValida').addEventListener('click', () => {

  const conAl = [...sel].map(id => SOL.filas.find(s => s.id === id)).filter(s => s && s.alertas.length).length;
  if (conAl && !confirm(`${conAl} de los registros seleccionados tienen alertas automáticas. ¿Marcarlos como válidos de todas formas?`)) return;
  validar('valida').catch(x => toast(x.message));
});
$('#sPendiente').addEventListener('click', () => validar('pendiente').catch(x => toast(x.message)));
$('#sInvalida').addEventListener('click', () => {

  const textos = new Set(['Faltan datos obligatorios. Complete el formulario y envíelo de nuevo.', 'La persona ya tiene esta asistencia activa.',
    'Registro duplicado en el mes.', 'Falta la autorización de descuento por nómina firmada.']);
  [...sel].forEach(id => (SOL.filas.find(s => s.id === id)?.alertas || []).forEach(a => textos.add(a.texto)));
  if ($('#iRapidos')) $('#iRapidos').innerHTML = [...textos].slice(0, 10).map(t => `<button type="button" class="btn sec sm" data-m="${esc(t)}">${esc(t)}</button>`).join('');
  if ($('#iMotivo')) { $('#iMotivo').value = ''; }
  if ($('#iErr')) $('#iErr').hidden = true;
  if ($('#dInv')) { $('#dInv').showModal(); if ($('#iMotivo')) $('#iMotivo').focus(); }
});
$('#iRapidos').addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (!b) return; const m = $('#iMotivo'); if (m) m.value = (m.value.trim() ? m.value.trim() + ' ' : '') + b.dataset.m; });
$('#iOk').addEventListener('click', async () => {

  try {
    const mot = $('#iMotivo') ? $('#iMotivo').value.trim() : '';
    await validar('invalida', mot);
    if ($('#dInv')) $('#dInv').close();
  }
  catch (x) { if ($('#iErr')) { $('#iErr').textContent = x.message; $('#iErr').hidden = false; } }
});
$('#sCsv').addEventListener('click', () => {

  const lista = filtradas(); if (!lista.length) return toast('No hay registros para descargar.');
  const claves = new Set(); lista.forEach(s => Object.keys(s.datos || {}).forEach(k => claves.add(k)));
  const cols = [['id', 'solicitud'], [s => fechaHora(s.recibido_en), 'recibida'], ['tipo', 'tipo'], [s => ESTADOS[s.estado], 'estado'], ['motivo', 'motivo_invalidez'],
    [s => s.alertas.map(a => a.texto).join(' | '), 'alertas'], ['empresa_nombre', 'empresa'], ['empresa_nit', 'nit_empresa'],
    ['titular_num_doc', 'documento'], ['titular_nombre', 'titular'], ['asistencia', 'asistencia'], ['plan', 'plan'], ['valor_mensual', 'valor'], ['modelo_aplicado', 'modelo_aplicado'],
    [s => s.archivo_pdf_id ? 'Sí' : 'No', 'tiene_pdf'], [s => s.archivo_soporte_id ? 'Sí' : 'No', 'tiene_soporte'],
    ...[...claves].filter(k => !['empresa', 'nit'].includes(k)).map(k => [s => (s.datos || {})[k], k])];
  descargarCSV(`Novedades_${SOL.periodo}_${new Date().toISOString().slice(0, 10)}.csv`, cols, lista);
});

/* ==================== CONSOLIDADO DE CONCILIACIÓN ==================== */
let CONSOLIDADO_STATE = { filas: [], periodos: [], kpis: {}, modo: 'test', pagina: 1, total_paginas: 1, total: 0 };
let CONSOLIDADO_PAGINA = 1;
const CONSOLIDADO_POR_PAGINA = 50;
let IMP_FILAS_NORMALIZADAS = [];
let IMP_METRICAS = null;

const COLUMNAS_BASE_CONSOLIDADO = [
  'NIT', 'CONVENIO / EMPRESA', 'XC_SUBSCRIPTIONNAME__C', 'ESTADO', 'CANAL DE ATENCIÓN',
  'FECHA DE CARGUE', 'FECHA DE CORTE', 'ASOCIADO', 'DOC. ASOCIADO', 'FECHA DE RETIRO',
  'ASISTENCIA', 'VALOR CON IVA', 'VALOR SIN IVA',
  // Meses dinámicos van aquí en la tabla y en descargas
  'TITULAR', 'TIPO DOC.', 'NUMERO DE IDENTIFICACIÓN', 'FECHA DE NACIMIENTO', 'CELULAR',
  'CORREO', 'CIUDAD O MUNICIPIO', 'DIRECCIÓN PREDIO', 'EDAD',
  'NOMBRE BENEFICIARIO 1', 'TIPO DE DOC. BENEFICIARIO 1', 'DOCUMENTO NÚMERO BENEFICIARIO', 'PARENTESCO', '%',
  'NOMBRE BENEFICIARIO 2', 'TIPO DE DOC. BENEFICIARIO 2', 'DOCUMENTO NÚMERO BENEFICIARIO 2', 'PARENTESCO2', '%2',
  'NOMBRE BENEFICIARIO 3', 'TIPO DE DOC. BENEFICIARIO 3', 'DOCUMENTO NÚMERO BENEFICIARIO 3', 'PARENTESCO4', '%3'
];

function clientClavePeriodo(p) {
  if (p == null) return '';
  if (typeof p === 'object') return p.periodo || p.mes || p.key || '';
  return String(p).trim();
}

function clientEtiquetaPeriodo(p) {
  if (p == null) return '';
  if (typeof p === 'object') {
    if (p.etiqueta) return p.etiqueta;
    p = p.periodo || p.mes || p.key || '';
  }
  const s = String(p).trim();
  if (!s || !/^\d{4}-\d{2}$/.test(s)) return s;
  const [y, m] = s.split('-');
  const n = parseInt(m, 10);
  const meses2025 = ['', 'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
  const mesesAbrev = ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  if (y === '2025') return meses2025[n] || s;
  return `${mesesAbrev[n] || m}-${y.slice(2)}`;
}

function clientPeriodoDeEtiqueta(et) {
  if (!et) return null;
  const s = String(et).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const m25 = { enero:'2025-01', febrero:'2025-02', marzo:'2025-03', abril:'2025-04', mayo:'2025-05', junio:'2025-06',
    julio:'2025-07', agosto:'2025-08', septiembre:'2025-09', octubre:'2025-10', noviembre:'2025-11', diciembre:'2025-12' };
  if (m25[s]) return m25[s];
  const m = s.match(/^([a-z]{3})[-_/]?(\d{2,4})$/);
  if (m) {
    const meses = { ene:'01', feb:'02', mar:'03', abr:'04', may:'05', jun:'06', jul:'07', ago:'08', sep:'09', oct:'10', nov:'11', dic:'12' };
    const numMes = meses[m[1]];
    let anio = m[2];
    if (anio.length === 2) anio = '20' + anio;
    if (numMes) return `${anio}-${numMes}`;
  }
  const iso = s.match(/^(\d{4})[-/.](\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  return null;
}

function normalizarHeader(h) {
  return String(h || '')
    .trim()
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

async function cargarConsolidado(pagina = 1) {
  CONSOLIDADO_PAGINA = pagina;
  const eid = $('#cEmpresa').value || undefined;
  const estado = $('#cEstado').value || undefined;
  const solo_sin_xc = $('#cSoloSinXc').checked || undefined;
  const q = $('#cQ').value.trim() || undefined;

  const [d, portal] = await Promise.all([
    api('/api/admin', {
      method: 'POST',
      body: {
        accion: 'consolidado_conciliacion_listar',
        empresa_id: eid,
        estado,
        solo_sin_xc,
        q,
        pagina: CONSOLIDADO_PAGINA,
        por_pagina: CONSOLIDADO_POR_PAGINA
      }
    }),
    eid ? api('/api/portal?empresa_id=' + eid).catch(() => null) : null
  ]);

  CONSOLIDADO_STATE = d;
  CONS = d.filas; // Para compatibilidad con otras funciones

  if ($('#cPortal')) {
    $('#cPortal').hidden = !eid;
    if (eid) $('#cPortal').href = '/portal?empresa_id=' + eid;
  }

  // Actualizar Banner de Modo Prueba / Producción
  const esPrueba = d.modo === 'test';
  const banner = $('#cModoBanner');
  if (banner) {
    if (esPrueba) {
      banner.className = 'notice warn';
      banner.style.borderLeft = '4px solid var(--orange)';
      if ($('#cModoTag')) $('#cModoTag').textContent = 'MODO PRUEBA ACTIVO';
      if ($('#cModoDesc')) $('#cModoDesc').innerHTML = 'Operando sobre tablas aisladas de prueba (<code>consolidado_conciliacion_test</code>). Los datos de producción NO se tocan.';
      if ($('#cToggleModo')) {
        $('#cToggleModo').textContent = 'Cambiar a Producción';
        $('#cToggleModo').style.background = '#173A8C';
        $('#cToggleModo').style.borderColor = '#173A8C';
      }
      if ($('#cSembrar')) $('#cSembrar').hidden = false;
      if ($('#cResetTest')) $('#cResetTest').hidden = false;
    } else {
      banner.className = 'notice bad';
      banner.style.borderLeft = '4px solid var(--red)';
      if ($('#cModoTag')) $('#cModoTag').textContent = 'MODO PRODUCCIÓN ACTIVO';
      if ($('#cModoDesc')) $('#cModoDesc').innerHTML = '<strong>ATENCIÓN:</strong> Operando sobre tablas oficiales de producción (<code>consolidado_conciliacion</code>).';
      if ($('#cToggleModo')) {
        $('#cToggleModo').textContent = 'Cambiar a Modo Prueba';
        $('#cToggleModo').style.background = 'var(--muted)';
        $('#cToggleModo').style.borderColor = 'var(--muted)';
      }
      if ($('#cSembrar')) $('#cSembrar').hidden = true;
      if ($('#cResetTest')) $('#cResetTest').hidden = true;
    }
  }

  // KPIs
  const k = d.kpis || {};
  if ($('#cKpis')) {
    $('#cKpis').innerHTML = [
      ['Suscripciones totales', numero(k.total || k.total_suscripciones || 0), `${numero(k.personas_unicas || 0)} personas`],
      ['Activas', numero(k.activas || 0), 'Cobran en el mes', 'ok'],
      ['Inactivas', numero(k.inactivas || 0), 'Retiradas'],
      ['Pendientes de XC', numero(k.pendientes_xc != null ? k.pendientes_xc : (k.sin_xc || 0)), (k.pendientes_xc || k.sin_xc) ? 'Requieren código XC' : 'Al día', (k.pendientes_xc || k.sin_xc) ? 'hl' : ''],
      ['Personas con >1 asistencia', numero(k.personas_multi_asistencia || 0), 'Suscripciones múltiples'],
      ['Valor mensual activo', pesos(k.valor_total_activo != null ? k.valor_total_activo : (k.valor_mensual_total || 0)), 'Con IVA']
    ].map(([l, v, d2, c]) => `<div class="kpi ${c || ''}"><div class="l">${esc(l)}</div><div class="v">${esc(v)}</div><div class="d">${esc(d2)}</div></div>`).join('');
  }

  pintarCuadroContratado(d.resumen_contratado);
  pintarConsolidado();
}

function pintarCuadroContratado(resumen) {
  const tb = $('#cTbProductos');
  const tf = $('#cTfProductos');
  const vacio = $('#cVacioProductos');
  const tit = $('#cTitContratado');

  const selEmp = $('#cEmpresa');
  const nombreEmp = (selEmp && selEmp.value && selEmp.selectedOptions?.[0])
    ? selEmp.selectedOptions[0].textContent
    : 'Todas las empresas';

  if (tit) {
    tit.textContent = `Qué tienen contratado (${nombreEmp})`;
  }

  const prods = resumen?.por_producto || [];
  const totCant = resumen?.total_asistencias ?? prods.reduce((a, b) => a + (Number(b.cantidad) || 0), 0);
  const totVal = resumen?.total_valor ?? prods.reduce((a, b) => a + (Number(b.valor) || 0), 0);

  if (tb) {
    if (!prods.length) {
      tb.innerHTML = '';
    } else {
      tb.innerHTML = prods.map(p => `<tr>
        <td>${esc(p.asistencia)}</td>
        <td>${esc(p.plan)}</td>
        <td class="num">${numero(p.cantidad)}</td>
        <td class="num">${pesos(p.valor)}</td>
      </tr>`).join('');
    }
  }

  if (tf) {
    if (prods.length) {
      tf.innerHTML = `<tr style="font-weight:bold;background:#fafafa">
        <td colspan="2"><strong>Total</strong></td>
        <td class="num"><strong>${numero(totCant)}</strong></td>
        <td class="num"><strong>${pesos(totVal)}</strong></td>
      </tr>`;
    } else {
      tf.innerHTML = '';
    }
  }

  if (vacio) {
    vacio.hidden = prods.length > 0;
  }
}

function pintarConsolidado() {
  const d = CONSOLIDADO_STATE;
  const filas = d.filas || [];
  const periodos = d.periodos || [];

  // Paginación
  const hayPags = d.total_paginas > 1;
  if ($('#cPaginacion')) $('#cPaginacion').hidden = !hayPags;
  if (hayPags) {
    if ($('#cPagTxt')) $('#cPagTxt').textContent = `Pág. ${d.pagina} de ${d.total_paginas} (${numero(d.total)} suscripciones)`;
    if ($('#cPagAnt')) $('#cPagAnt').disabled = d.pagina <= 1;
    if ($('#cPagSig')) $('#cPagSig').disabled = d.pagina >= d.total_paginas;
  }
  if ($('#cCuenta')) $('#cCuenta').textContent = `${numero(d.total)} suscripciones en total (${numero(d.kpis?.activas || 0)} activas)${hayPags ? ` · Página ${d.pagina} de ${d.total_paginas}` : ''}`;

  // Encabezados dinámicos
  let ths = `
    <th>NIT</th>
    <th>CONVENIO / EMPRESA</th>
    <th>XC_SUBSCRIPTIONNAME__C</th>
    <th>ESTADO</th>
    <th>CANAL</th>
    <th>CARGUE</th>
    <th>CORTE</th>
    <th>ASOCIADO</th>
    <th>DOC. ASOCIADO</th>
    <th>RETIRO</th>
    <th>ASISTENCIA</th>
    <th class="num">VALOR C/IVA</th>
    <th class="num">VALOR S/IVA</th>
  `;

  periodos.forEach(p => {
    ths += `<th class="num" style="background:#eef3ff;color:#173A8C">${esc(clientEtiquetaPeriodo(p))}</th>`;
  });

  ths += `
    <th>TITULAR</th>
    <th>TIPO DOC.</th>
    <th>NÚMERO DOC.</th>
    <th>FECHA NAC.</th>
    <th>CELULAR</th>
    <th>CORREO</th>
    <th>CIUDAD</th>
    <th>DIRECCIÓN</th>
    <th>EDAD</th>
    <th>BENEFICIARIO 1</th>
    <th>DOC. BENEF. 1</th>
    <th>PARENTESCO 1</th>
    <th>% 1</th>
    <th>BENEFICIARIO 2</th>
    <th>DOC. BENEF. 2</th>
    <th>PARENTESCO 2</th>
    <th>% 2</th>
    <th>BENEFICIARIO 3</th>
    <th>DOC. BENEF. 3</th>
    <th>PARENTESCO 3</th>
    <th>% 3</th>
  `;

  $('#cThead').innerHTML = `<tr>${ths}</tr>`;

  // Cuerpo de la tabla
  if (!filas.length) {
    $('#cTb').innerHTML = '';
    $('#cVacio').hidden = false;
    return;
  }
  $('#cVacio').hidden = true;

  $('#cTb').innerHTML = filas.map(r => {
    const act = r.estado === 'Activo';
    const sinXc = !r.xc_subscriptionname__c;
    const xcHtml = sinXc
      ? `<button type="button" class="tag invalida" style="border:0;cursor:pointer" onclick="abrirEdicionXc('${r.id}', '${esc(r.titular || r.asociado || '')}', '${esc(r.doc_asociado || '')}', '${esc(r.asistencia || '')}')">Pendiente XC ✎</button>`
      : `<span style="font-family:monospace;font-size:12px">${esc(r.xc_subscriptionname__c)}</span>`;

    let tds = `
      <td class="nw">${esc(r.nit || '')}</td>
      <td>${esc(r.convenio_empresa || '')}</td>
      <td class="nw">${xcHtml}</td>
      <td><span class="tag ${act ? 'alta' : 'invalida'}">${esc(r.estado)}</span></td>
      <td>${esc(r.canal_atencion || '')}</td>
      <td class="nw">${esc(r.fecha_cargue || '')}</td>
      <td class="nw">${esc(r.fecha_corte || '')}</td>
      <td>${esc(r.asociado || '')}</td>
      <td class="nw"><strong>${esc(r.doc_asociado || '')}</strong></td>
      <td class="nw">${esc(r.fecha_retiro || '')}</td>
      <td><strong>${esc(r.asistencia || '')}</strong></td>
      <td class="num">${r.valor_con_iva != null ? pesos(r.valor_con_iva) : ''}</td>
      <td class="num muted">${r.valor_sin_iva != null ? pesos(r.valor_sin_iva) : '—'}</td>
    `;

    periodos.forEach(p => {
      const clave = clientClavePeriodo(p);
      const v = r.meses ? r.meses[clave] : null;
      tds += `<td class="num" style="background:${v != null ? '#fafcff' : '#fcfcfc'}">${v != null ? pesos(v) : '<span class="muted">—</span>'}</td>`;
    });

    tds += `
      <td>${esc(r.titular || '')}</td>
      <td>${esc(r.tipo_doc || '')}</td>
      <td class="nw">${esc(r.numero_identificacion || '')}</td>
      <td class="nw">${esc(r.fecha_nacimiento || '')}</td>
      <td class="nw">${esc(r.celular || '')}</td>
      <td>${esc(r.correo || '')}</td>
      <td>${esc(r.ciudad_municipio || '')}</td>
      <td>${esc(r.direccion_predio || '')}</td>
      <td class="num">${r.edad != null ? r.edad : ''}</td>
      <td>${esc(r.nombre_beneficiario_1 || '')}</td>
      <td class="nw">${esc(r.documento_numero_beneficiario || '')}</td>
      <td>${esc(r.parentesco || '')}</td>
      <td class="num">${r.porcentaje || ''}</td>
      <td>${esc(r.nombre_beneficiario_2 || '')}</td>
      <td class="nw">${esc(r.documento_numero_beneficiario_2 || '')}</td>
      <td>${esc(r.parentesco2 || '')}</td>
      <td class="num">${r.porcentaje2 || ''}</td>
      <td>${esc(r.nombre_beneficiario_3 || '')}</td>
      <td class="nw">${esc(r.documento_numero_beneficiario_3 || '')}</td>
      <td>${esc(r.parentesco4 || '')}</td>
      <td class="num">${r.porcentaje3 || ''}</td>
    `;

    return `<tr style="${act ? '' : 'opacity:0.6;background:#fbfbfb'}">${tds}</tr>`;
  }).join('');
}

// Filtros y búsqueda
$('#cEmpresa').addEventListener('change', () => cargarConsolidado(1).catch(x => toast(x.message)));
$('#cEstado').addEventListener('change', () => cargarConsolidado(1).catch(x => toast(x.message)));
$('#cSoloSinXc').addEventListener('change', () => cargarConsolidado(1).catch(x => toast(x.message)));
let searchTimer = null;
$('#cQ').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => cargarConsolidado(1).catch(x => toast(x.message)), 280);
});

// Paginación
$('#cPagAnt').addEventListener('click', () => {
  if (CONSOLIDADO_PAGINA > 1) cargarConsolidado(CONSOLIDADO_PAGINA - 1);
});
$('#cPagSig').addEventListener('click', () => {
  if (CONSOLIDADO_PAGINA < CONSOLIDADO_STATE.total_paginas) cargarConsolidado(CONSOLIDADO_PAGINA + 1);
});

// Interruptor Modo Prueba / Modo Producción
$('#cToggleModo').addEventListener('click', async () => {
  const actual = CONSOLIDADO_STATE.modo;
  const nuevo = actual === 'test' ? 'prod' : 'test';
  const msg = nuevo === 'prod'
    ? '¿Está seguro de activar el MODO PRODUCCIÓN?\n\nTodas las consultas, aprobaciones de altas/bajas e importaciones operarán sobre las tablas definitivas de producción (consolidado_conciliacion).'
    : '¿Desea volver al MODO PRUEBA?\n\nOperará sobre las tablas de prueba (consolidado_conciliacion_test) sin tocar datos reales.';
  if (!confirm(msg)) return;

  try {
    const r = await api('/api/admin', { method: 'POST', body: { accion: 'consolidado_conciliacion_modo', modo: nuevo } });
    toast(r.mensaje);
    await cargarConsolidado(1);
  } catch (x) {
    toast('Error cambiando de modo: ' + x.message);
  }
});

// Sembrar datos de ejemplo ficticios
$('#cSembrar').addEventListener('click', async () => {
  if (!confirm('¿Cargar registros ficticios de ejemplo en las tablas de prueba para validar la visualización y conciliación?')) return;
  try {
    const empId = $('#cEmpresa') ? $('#cEmpresa').value : undefined;
    const r = await api('/api/admin', { method: 'POST', body: { accion: 'consolidado_conciliacion_sembrar_ejemplo', empresa_id: empId || undefined } });
    toast(`Datos de prueba cargados: ${r.insertados} registros y ${r.meses} valores mensuales.`);
    await cargarConsolidado(1);
  } catch (x) {
    toast('Error cargando ejemplo: ' + x.message);
  }
});

// Reiniciar tablas de prueba
$('#cResetTest').addEventListener('click', async () => {
  if (!confirm('¿CONFIRMA reiniciar y vaciar las tablas de prueba (consolidado_conciliacion_test y consolidado_meses_test)?\n\nLos datos de producción no se tocarán.')) return;
  try {
    const r = await api('/api/admin', { method: 'POST', body: { accion: 'consolidado_conciliacion_reset_test' } });
    toast(r.mensaje);
    await cargarConsolidado(1);
  } catch (x) {
    toast('Error reiniciando prueba: ' + x.message);
  }
});

// Descargar plantilla vacía
function generarPlantillaVacia() {
  const wb = XLSX.utils.book_new();
  const mesesHistoricos = ['MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE',
    'ene-26', 'feb-26', 'mar-26', 'abr-26', 'may-26', 'jun-26', 'jul-26', 'ago-26', 'sep-26'];

  const headers = [
    'NIT', 'CONVENIO / EMPRESA', 'XC_SUBSCRIPTIONNAME__C', 'ESTADO', 'CANAL DE ATENCIÓN',
    'FECHA DE CARGUE', 'FECHA DE CORTE', 'ASOCIADO', 'DOC. ASOCIADO', 'FECHA DE RETIRO',
    'ASISTENCIA', 'VALOR CON IVA', 'VALOR SIN IVA',
    ...mesesHistoricos,
    'TITULAR', 'TIPO DOC.', 'NUMERO DE IDENTIFICACIÓN', 'FECHA DE NACIMIENTO', 'CELULAR',
    'CORREO', 'CIUDAD O MUNICIPIO', 'DIRECCIÓN PREDIO', 'EDAD',
    'NOMBRE BENEFICIARIO 1', 'TIPO DE DOC. BENEFICIARIO 1', 'DOCUMENTO NÚMERO BENEFICIARIO', 'PARENTESCO', '%',
    'NOMBRE BENEFICIARIO 2', 'TIPO DE DOC. BENEFICIARIO 2', 'DOCUMENTO NÚMERO BENEFICIARIO 2', 'PARENTESCO2', '%2',
    'NOMBRE BENEFICIARIO 3', 'TIPO DE DOC. BENEFICIARIO 3', 'DOCUMENTO NÚMERO BENEFICIARIO 3', 'PARENTESCO4', '%3'
  ];

  const filaEjemplo = {
    'NIT': '900123456',
    'CONVENIO / EMPRESA': 'ACME S.A.S.',
    'XC_SUBSCRIPTIONNAME__C': 'XC-EJEMPLO-001',
    'ESTADO': 'Activo',
    'CANAL DE ATENCIÓN': 'Venta Directa',
    'FECHA DE CARGUE': '2025-03-01',
    'FECHA DE CORTE': '',
    'ASOCIADO': 'Juan Carlos Pérez Gómez',
    'DOC. ASOCIADO': '1020304050',
    'FECHA DE RETIRO': '',
    'ASISTENCIA': 'Doctor 360',
    'VALOR CON IVA': 25000,
    'VALOR SIN IVA': '',
    'MARZO': 25000,
    'ABRIL': 25000,
    'MAYO': 25000,
    'JUNIO': 25000,
    'JULIO': 25000,
    'AGOSTO': 25000,
    'SEPTIEMBRE': 25000,
    'OCTUBRE': 25000,
    'NOVIEMBRE': 25000,
    'DICIEMBRE': 25000,
    'ene-26': 25000,
    'feb-26': 25000,
    'mar-26': 25000,
    'abr-26': 25000,
    'may-26': 25000,
    'jun-26': 25000,
    'jul-26': 25000,
    'ago-26': 25000,
    'sep-26': 25000,
    'TITULAR': 'Juan Carlos Pérez Gómez',
    'TIPO DOC.': 'CC',
    'NUMERO DE IDENTIFICACIÓN': '1020304050',
    'FECHA DE NACIMIENTO': '1985-05-15',
    'CELULAR': '3001234567',
    'CORREO': 'juan.perez@ejemplo.com',
    'CIUDAD O MUNICIPIO': 'Bogotá D.C.',
    'DIRECCIÓN PREDIO': 'Calle 100 # 15-20',
    'EDAD': 40,
    'NOMBRE BENEFICIARIO 1': 'María Gómez',
    'TIPO DE DOC. BENEFICIARIO 1': 'CC',
    'DOCUMENTO NÚMERO BENEFICIARIO': '1098765432',
    'PARENTESCO': 'Cónyuge',
    '%': '100',
    'NOMBRE BENEFICIARIO 2': '',
    'TIPO DE DOC. BENEFICIARIO 2': '',
    'DOCUMENTO NÚMERO BENEFICIARIO 2': '',
    'PARENTESCO2': '',
    '%2': '',
    'NOMBRE BENEFICIARIO 3': '',
    'TIPO DE DOC. BENEFICIARIO 3': '',
    'DOCUMENTO NÚMERO BENEFICIARIO 3': '',
    'PARENTESCO4': '',
    '%3': ''
  };

  const ws = XLSX.utils.json_to_sheet([filaEjemplo], { header: headers });
  XLSX.utils.book_append_sheet(wb, ws, "Consolidado");

  const wsInst = XLSX.utils.aoa_to_sheet([
    ["Instrucciones para el Consolidado de Conciliación"],
    ["1. Mantenga exactamente los nombres y el orden de las columnas."],
    ["2. La unidad de registro es la SUSCRIPCIÓN (persona + asistencia). Una persona puede tener más de una asistencia."],
    ["3. XC_SUBSCRIPTIONNAME__C es el identificador único de la suscripción (opcional en altas nuevas)."],
    ["4. VALOR SIN IVA se deja en blanco si no está definido."],
    ["5. Los meses nuevos (oct-26 en adelante) se generan automáticamente mediante cierres mensuales."]
  ]);
  XLSX.utils.book_append_sheet(wb, wsInst, "Instrucciones");

  XLSX.writeFile(wb, "Plantilla_Consolidado_Conciliacion.xlsx");
}
$('#cPlantilla').addEventListener('click', generarPlantillaVacia);
$('#impPlantilla').addEventListener('click', generarPlantillaVacia);

// Descargar consolidado actual completo
async function descargarConsolidadoActual(nombreArchivo = null) {
  try {
    toast('Generando descarga del consolidado...');
    const eid = $('#cEmpresa').value || undefined;
    const estado = $('#cEstado').value || undefined;
    const r = await api('/api/admin', {
      method: 'POST',
      body: { accion: 'consolidado_conciliacion_exportar', empresa_id: eid, estado }
    });

    if (!r.filas || !r.filas.length) {
      return toast('No hay registros para descargar.');
    }

    const periodos = r.periodos || [];
    const headers = [
      'NIT', 'CONVENIO / EMPRESA', 'XC_SUBSCRIPTIONNAME__C', 'ESTADO', 'CANAL DE ATENCIÓN',
      'FECHA DE CARGUE', 'FECHA DE CORTE', 'ASOCIADO', 'DOC. ASOCIADO', 'FECHA DE RETIRO',
      'ASISTENCIA', 'VALOR CON IVA', 'VALOR SIN IVA',
      ...periodos.map(clientEtiquetaPeriodo),
      'TITULAR', 'TIPO DOC.', 'NUMERO DE IDENTIFICACIÓN', 'FECHA DE NACIMIENTO', 'CELULAR',
      'CORREO', 'CIUDAD O MUNICIPIO', 'DIRECCIÓN PREDIO', 'EDAD',
      'NOMBRE BENEFICIARIO 1', 'TIPO DE DOC. BENEFICIARIO 1', 'DOCUMENTO NÚMERO BENEFICIARIO', 'PARENTESCO', '%',
      'NOMBRE BENEFICIARIO 2', 'TIPO DE DOC. BENEFICIARIO 2', 'DOCUMENTO NÚMERO BENEFICIARIO 2', 'PARENTESCO2', '%2',
      'NOMBRE BENEFICIARIO 3', 'TIPO DE DOC. BENEFICIARIO 3', 'DOCUMENTO NÚMERO BENEFICIARIO 3', 'PARENTESCO4', '%3'
    ];

    const dataRows = r.filas.map(f => {
      const obj = {
        'NIT': f.nit || '',
        'CONVENIO / EMPRESA': f.convenio_empresa || '',
        'XC_SUBSCRIPTIONNAME__C': f.xc_subscriptionname__c || '',
        'ESTADO': f.estado || '',
        'CANAL DE ATENCIÓN': f.canal_atencion || '',
        'FECHA DE CARGUE': f.fecha_cargue || '',
        'FECHA DE CORTE': f.fecha_corte || '',
        'ASOCIADO': f.asociado || '',
        'DOC. ASOCIADO': f.doc_asociado || '',
        'FECHA DE RETIRO': f.fecha_retiro || '',
        'ASISTENCIA': f.asistencia || '',
        'VALOR CON IVA': f.valor_con_iva != null ? f.valor_con_iva : '',
        'VALOR SIN IVA': f.valor_sin_iva != null ? f.valor_sin_iva : ''
      };

      periodos.forEach(p => {
        const clave = clientClavePeriodo(p);
        const et = clientEtiquetaPeriodo(p);
        obj[et] = (f.meses && f.meses[clave] != null) ? f.meses[clave] : '';
      });

      obj['TITULAR'] = f.titular || '';
      obj['TIPO DOC.'] = f.tipo_doc || '';
      obj['NUMERO DE IDENTIFICACIÓN'] = f.numero_identificacion || '';
      obj['FECHA DE NACIMIENTO'] = f.fecha_nacimiento || '';
      obj['CELULAR'] = f.celular || '';
      obj['CORREO'] = f.correo || '';
      obj['CIUDAD O MUNICIPIO'] = f.ciudad_municipio || '';
      obj['DIRECCIÓN PREDIO'] = f.direccion_predio || '';
      obj['EDAD'] = f.edad != null ? f.edad : '';
      obj['NOMBRE BENEFICIARIO 1'] = f.nombre_beneficiario_1 || '';
      obj['TIPO DE DOC. BENEFICIARIO 1'] = f.tipo_de_doc_beneficiario_1 || '';
      obj['DOCUMENTO NÚMERO BENEFICIARIO'] = f.documento_numero_beneficiario || '';
      obj['PARENTESCO'] = f.parentesco || '';
      obj['%'] = f.porcentaje || '';
      obj['NOMBRE BENEFICIARIO 2'] = f.nombre_beneficiario_2 || '';
      obj['TIPO DE DOC. BENEFICIARIO 2'] = f.tipo_de_doc_beneficiario_2 || '';
      obj['DOCUMENTO NÚMERO BENEFICIARIO 2'] = f.documento_numero_beneficiario_2 || '';
      obj['PARENTESCO2'] = f.parentesco2 || '';
      obj['%2'] = f.porcentaje2 || '';
      obj['NOMBRE BENEFICIARIO 3'] = f.nombre_beneficiario_3 || '';
      obj['TIPO DE DOC. BENEFICIARIO 3'] = f.tipo_de_doc_beneficiario_3 || '';
      obj['DOCUMENTO NÚMERO BENEFICIARIO 3'] = f.documento_numero_beneficiario_3 || '';
      obj['PARENTESCO4'] = f.parentesco4 || '';
      obj['%3'] = f.porcentaje3 || '';

      return obj;
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(dataRows, { header: headers });
    XLSX.utils.book_append_sheet(wb, ws, "Consolidado");

    const fname = nombreArchivo || `Consolidado_Conciliacion_${r.modo}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fname);
    toast('Descarga generada con éxito.');
  } catch (x) {
    toast('Error generando descarga: ' + x.message);
  }
}
$('#cCsv').addEventListener('click', () => descargarConsolidadoActual());
$('#impBackupBtn').addEventListener('click', () => descargarConsolidadoActual(`Backup_Consolidado_${CONSOLIDADO_STATE.modo}_${Date.now()}.xlsx`));

// Apertura del modal de importación histórica
$('#cImportar').addEventListener('click', () => {
  $('#impEmpresa').value = $('#cEmpresa').value || '';
  $('#impArchivo').value = '';
  $('#impPreviewArea').hidden = true;
  $('#impInfo').innerHTML = '';
  $('#impProgreso').hidden = true;
  $('#impOk').disabled = true;
  IMP_FILAS_NORMALIZADAS = [];
  IMP_METRICAS = null;
  $('#dImp').showModal();
});

// Lectura de Excel en navegador y generación de VISTA PREVIA OBLIGATORIA
$('#impArchivo').addEventListener('change', async e => {
  const f = e.target.files[0];
  $('#impPreviewArea').hidden = true;
  $('#impInfo').innerHTML = '';
  $('#impOk').disabled = true;
  IMP_FILAS_NORMALIZADAS = [];
  IMP_METRICAS = null;
  if (!f) return;

  try {
    $('#impInfo').innerHTML = '<div class="notice info">Leyendo y validando archivo en el navegador…</div>';
    let rawRows = [];
    if (f.name.endsWith('.csv')) {
      const txt = await f.text();
      rawRows = leerCSV(txt);
    } else {
      const data = await f.arrayBuffer();
      const wb = XLSX.read(data, { cellDates: true });
      const firstSheet = wb.Sheets[wb.SheetNames[0]];
      rawRows = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
    }

    if (!rawRows.length) {
      $('#impInfo').innerHTML = '<div class="notice bad">El archivo no contiene filas de datos.</div>';
      return;
    }

    // Análisis de columnas y meses
    const sampleKeys = Object.keys(rawRows[0]);
    const normalizedKeyMap = {};
    const mesesDetectados = []; // { colOriginal, periodo, etiqueta }

    sampleKeys.forEach(k => {
      const norm = normalizarHeader(k);
      normalizedKeyMap[k] = norm;
      const p = clientPeriodoDeEtiqueta(norm);
      if (p) {
        mesesDetectados.push({ colOriginal: k, periodo: p, etiqueta: clientEtiquetaPeriodo(p) });
      }
    });

    // Mapeo canónico de columnas de registro
    const mapaCampos = {
      'NIT': 'nit',
      'CONVENIO / EMPRESA': 'convenio_empresa',
      'CONVENIO': 'convenio_empresa',
      'EMPRESA': 'convenio_empresa',
      'XC_SUBSCRIPTIONNAME__C': 'xc_subscriptionname__c',
      'XC_SUBSCRIPTIONNAME': 'xc_subscriptionname__c',
      'ESTADO': 'estado',
      'CANAL DE ATENCION': 'canal_atencion',
      'FECHA DE CARGUE': 'fecha_cargue',
      'FECHA DE CORTE': 'fecha_corte',
      'ASOCIADO': 'asociado',
      'DOC. ASOCIADO': 'doc_asociado',
      'DOC ASOCIADO': 'doc_asociado',
      'FECHA DE RETIRO': 'fecha_retiro',
      'ASISTENCIA': 'asistencia',
      'VALOR CON IVA': 'valor_con_iva',
      'VALOR SIN IVA': 'valor_sin_iva',
      'TITULAR': 'titular',
      'TIPO DOC.': 'tipo_doc',
      'TIPO DOC': 'tipo_doc',
      'NUMERO DE IDENTIFICACION': 'numero_identificacion',
      'FECHA DE NACIMIENTO': 'fecha_nacimiento',
      'CELULAR': 'celular',
      'CORREO': 'correo',
      'CIUDAD O MUNICIPIO': 'ciudad_municipio',
      'DIRECCION PREDIO': 'direccion_predio',
      'EDAD': 'edad',
      'NOMBRE BENEFICIARIO 1': 'nombre_beneficiario_1',
      'TIPO DE DOC. BENEFICIARIO 1': 'tipo_de_doc_beneficiario_1',
      'DOCUMENTO NUMERO BENEFICIARIO': 'documento_numero_beneficiario',
      'PARENTESCO': 'parentesco',
      '%': 'porcentaje',
      'NOMBRE BENEFICIARIO 2': 'nombre_beneficiario_2',
      'TIPO DE DOC. BENEFICIARIO 2': 'tipo_de_doc_beneficiario_2',
      'DOCUMENTO NUMERO BENEFICIARIO 2': 'documento_numero_beneficiario_2',
      'PARENTESCO2': 'parentesco2',
      '%2': 'porcentaje2',
      'NOMBRE BENEFICIARIO 3': 'nombre_beneficiario_3',
      'TIPO DE DOC. BENEFICIARIO 3': 'tipo_de_doc_beneficiario_3',
      'DOCUMENTO NUMERO BENEFICIARIO 3': 'documento_numero_beneficiario_3',
      'PARENTESCO4': 'parentesco4',
      '%3': 'porcentaje3'
    };

    // Procesar y normalizar cada fila
    const xcsVistos = new Map();
    let duplicadosXc = 0;
    let sinXc = 0;
    let conError = 0;
    const personasAsistencias = new Map(); // key = nit:doc -> Set(asistencias)
    const columnasConDatos = new Set();

    IMP_FILAS_NORMALIZADAS = rawRows.map((raw, idx) => {
      const normal = { meses: {} };
      Object.entries(raw).forEach(([k, val]) => {
        const normK = normalizedKeyMap[k];
        const valStr = val != null ? String(val).trim() : '';
        if (valStr !== '') columnasConDatos.add(normK);

        const per = clientPeriodoDeEtiqueta(normK);
        if (per) {
          const numVal = parseFloat(valStr.replace(/[^0-9.-]/g, ''));
          if (!isNaN(numVal)) normal.meses[per] = numVal;
          return;
        }

        const campoDb = mapaCampos[normK];
        if (campoDb) {
          if (['valor_con_iva', 'valor_sin_iva', 'edad'].includes(campoDb)) {
            const numVal = parseFloat(valStr.replace(/[^0-9.-]/g, ''));
            normal[campoDb] = !isNaN(numVal) ? numVal : null;
          } else {
            normal[campoDb] = valStr;
          }
        }
      });

      // Validaciones métricas
      const xc = normal.xc_subscriptionname__c;
      if (xc) {
        if (xcsVistos.has(xc)) duplicadosXc++;
        else xcsVistos.set(xc, idx);
      } else {
        sinXc++;
      }

      const doc = normal.doc_asociado || normal.numero_identificacion;
      const asis = normal.asistencia;
      if (!doc || !asis) {
        conError++;
      } else {
        const pKey = (normal.nit || '') + ':' + doc;
        if (!personasAsistencias.has(pKey)) personasAsistencias.set(pKey, new Set());
        personasAsistencias.get(pKey).add(asis);
      }

      return normal;
    });

    let personasMultiAsistencia = 0;
    personasAsistencias.forEach(asists => {
      if (asists.size > 1) personasMultiAsistencia++;
    });

    // Columnas vacías
    const columnasEsperadas = Object.keys(mapaCampos);
    const columnasVacias = columnasEsperadas.filter(c => !columnasConDatos.has(c));

    // Renderizar Vista Previa Obligatoria
    $('#impKpis').innerHTML = [
      ['Total de filas', numero(IMP_FILAS_NORMALIZADAS.length)],
      ['Duplicados por XC', numero(duplicadosXc), duplicadosXc ? 'Se omitirán o avisarán' : 'Ninguno', duplicadosXc ? 'hl' : ''],
      ['Sin código XC', numero(sinXc), sinXc ? 'Quedarán pendientes' : 'Todos tienen XC'],
      ['Filas con error', numero(conError), conError ? 'Falta doc o asistencia' : 'Estructura válida', conError ? 'hl' : 'ok'],
      ['Personas con >1 asistencia', numero(personasMultiAsistencia), 'Suscripciones múltiples (normal)']
    ].map(([l, v, d2, c]) => `<div class="kpi ${c || ''}"><div class="l">${esc(l)}</div><div class="v">${esc(v)}</div><div class="d">${esc(d2)}</div></div>`).join('');

    // Detalle de meses detectados
    if (mesesDetectados.length) {
      const mesesTxt = mesesDetectados.map(m => `<code>${esc(m.colOriginal)}</code> → <strong>${m.periodo}</strong> (${m.etiqueta})`).join(', ');
      $('#impMesesMapeados').innerHTML = `<strong>Mapeo de meses históricos detectados (${mesesDetectados.length}):</strong><br>${mesesTxt}`;
      $('#impMesesMapeados').hidden = false;
    } else {
      $('#impMesesMapeados').hidden = true;
    }

    // Detalle de columnas vacías
    if (columnasVacias.length) {
      $('#impColumnasVacias').innerHTML = `<strong>Columnas que vienen vacías o no existen en el archivo (${columnasVacias.length}):</strong> ${columnasVacias.map(c => `<code>${esc(c)}</code>`).join(', ')}`;
      $('#impColumnasVacias').hidden = false;
    } else {
      $('#impColumnasVacias').hidden = true;
    }

    // Tabla de las primeras 20 filas
    const prevRows = IMP_FILAS_NORMALIZADAS.slice(0, 20);
    $('#impThead').innerHTML = `<tr>
      <th>#</th><th>NIT</th><th>EMPRESA</th><th>XC_SUBSCRIPTION</th><th>ESTADO</th><th>DOC. ASOCIADO</th><th>ASISTENCIA</th><th>VALOR C/IVA</th><th>TITULAR</th><th>BENEFICIARIOS</th>
    </tr>`;
    $('#impTbody').innerHTML = prevRows.map((r, i) => `<tr>
      <td>${i + 1}</td>
      <td>${esc(r.nit || '')}</td>
      <td>${esc(r.convenio_empresa || '')}</td>
      <td>${r.xc_subscriptionname__c ? `<code>${esc(r.xc_subscriptionname__c)}</code>` : '<span class="tag invalida">Sin XC</span>'}</td>
      <td><span class="tag ${r.estado === 'Activo' ? 'alta' : 'invalida'}">${esc(r.estado || 'Activo')}</span></td>
      <td><strong>${esc(r.doc_asociado || r.numero_identificacion || '')}</strong></td>
      <td>${esc(r.asistencia || '')}</td>
      <td>${r.valor_con_iva != null ? pesos(r.valor_con_iva) : ''}</td>
      <td>${esc(r.titular || r.asociado || '')}</td>
      <td>${esc(r.nombre_beneficiario_1 || '')}${r.nombre_beneficiario_2 ? `, ${esc(r.nombre_beneficiario_2)}` : ''}</td>
    </tr>`).join('');

    $('#impInfo').innerHTML = '';
    $('#impPreviewArea').hidden = false;
    $('#impOk').disabled = false;
  } catch (err) {
    $('#impInfo').innerHTML = `<div class="notice bad">Error al procesar el archivo: ${esc(err.message)}</div>`;
  }
});

// Confirmación y envío por lotes (< 4.5 MB Vercel limit)
$('#impOk').addEventListener('click', async () => {
  if (!IMP_FILAS_NORMALIZADAS.length) return toast('No hay filas cargadas.');
  const total = IMP_FILAS_NORMALIZADAS.length;
  const modoActual = CONSOLIDADO_STATE.modo || 'test';

  if (!confirm(`¿Confirma la importación de ${numero(total)} filas al consolidado en MODO ${modoActual.toUpperCase()}?\n\nLa unidad de importación es la suscripción (persona + asistencia).`)) {
    return;
  }

  $('#impOk').disabled = true;
  const progreso = $('#impProgreso');
  progreso.hidden = false;

  const BATCH_SIZE = 200;
  let insertadosTot = 0;
  let actualizadosTot = 0;
  let mesesTot = 0;
  const eid = $('#impEmpresa').value || undefined;

  try {
    for (let i = 0; i < total; i += BATCH_SIZE) {
      const lote = IMP_FILAS_NORMALIZADAS.slice(i, i + BATCH_SIZE);
      const loteNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalLotes = Math.ceil(total / BATCH_SIZE);
      progreso.innerHTML = `Importando lote <strong>${loteNum} de ${totalLotes}</strong> (${Math.min(i + BATCH_SIZE, total)} de ${total} registros)…`;

      const r = await api('/api/admin', {
        method: 'POST',
        body: {
          accion: 'consolidado_conciliacion_importar',
          filas: lote,
          empresa_id: eid
        }
      });

      insertadosTot += (r.insertados || 0);
      actualizadosTot += (r.actualizados || 0);
      mesesTot += (r.meses_insertados || 0);
    }

    progreso.innerHTML = `<strong>¡Importación completada con éxito!</strong><br>Suscripciones insertadas: ${numero(insertadosTot)}, actualizadas: ${numero(actualizadosTot)}, valores de meses guardados: ${numero(mesesTot)}.`;
    toast(`Importación finalizada: ${numero(insertadosTot)} suscripciones y ${numero(mesesTot)} meses.`);
    setTimeout(() => {
      $('#dImp').close();
      cargarConsolidado(1);
    }, 1200);
  } catch (x) {
    progreso.className = 'notice bad';
    progreso.innerHTML = `<strong>Error durante la importación:</strong> ${esc(x.message)}`;
    $('#impOk').disabled = false;
  }
});

// Cierre mensual
$('#cCierre').addEventListener('click', () => {
  const hoy = new Date();
  const perDefault = hoy.toISOString().slice(0, 7);
  $('#cierrePeriodo').value = perDefault;
  $('#cierreErr').hidden = true;
  $('#dCierre').showModal();
});

$('#cierreOk').addEventListener('click', async () => {
  const per = $('#cierrePeriodo') ? $('#cierrePeriodo').value : '';
  if (!per || !/^\d{4}-\d{2}$/.test(per)) {
    if ($('#cierreErr')) { $('#cierreErr').textContent = 'Seleccione un periodo válido en formato AAAA-MM.'; $('#cierreErr').hidden = false; }
    return;
  }

  if (!confirm(`¿Ejecutar el cierre mensual para el periodo ${per} (${clientEtiquetaPeriodo(per)})?\n\nSe generará el valor cobrado para todas las suscripciones activas.`)) return;

  try {
    if ($('#cierreOk')) $('#cierreOk').disabled = true;
    const r = await api('/api/admin', {
      method: 'POST',
      body: { accion: 'consolidado_conciliacion_cierre_mensual', periodo: per }
    });
    toast(r.mensaje);
    if ($('#dCierre')) $('#dCierre').close();
    await cargarConsolidado(1);
  } catch (x) {
    if ($('#cierreErr')) { $('#cierreErr').textContent = x.message; $('#cierreErr').hidden = false; }
  } finally {
    if ($('#cierreOk')) $('#cierreOk').disabled = false;
  }
});

// Modal de edición rápida de código XC individual
let EDIT_XC_RECORD_ID = null;
window.abrirEdicionXc = function(id, nombre, doc, asistencia) {
  EDIT_XC_RECORD_ID = id;
  if ($('#editXcDetalle')) $('#editXcDetalle').innerHTML = `Titular: <strong>${esc(nombre)}</strong><br>Documento: <strong>${esc(doc)}</strong> · Asistencia: <strong>${esc(asistencia)}</strong>`;
  if ($('#editXcInput')) $('#editXcInput').value = '';
  if ($('#editXcErr')) $('#editXcErr').hidden = true;
  if ($('#dEditXcModal')) $('#dEditXcModal').showModal();
};

$('#editXcOk').addEventListener('click', async () => {
  const codigo = $('#editXcInput') ? $('#editXcInput').value.trim() : '';
  if (!codigo) {
    if ($('#editXcErr')) { $('#editXcErr').textContent = 'Ingrese el código XC_SUBSCRIPTIONNAME__C.'; $('#editXcErr').hidden = false; }
    return;
  }

  try {
    if ($('#editXcOk')) $('#editXcOk').disabled = true;
    await api('/api/admin', {
      method: 'POST',
      body: {
        accion: 'consolidado_conciliacion_completar_xc',
        id: EDIT_XC_RECORD_ID,
        xc_subscriptionname__c: codigo
      }
    });
    toast('Código XC asignado con éxito.');
    if ($('#dEditXcModal')) $('#dEditXcModal').close();
    await cargarConsolidado(CONSOLIDADO_PAGINA);
  } catch (x) {
    if ($('#editXcErr')) { $('#editXcErr').textContent = x.message; $('#editXcErr').hidden = false; }
  } finally {
    if ($('#editXcOk')) $('#editXcOk').disabled = false;
  }
});

// Modal general para completar XC (manual o masivo)
$('#cCompletarXc').addEventListener('click', () => {
  $('#xcArchivo').value = '';
  $('#xcInfo').innerHTML = '';
  $('#xcDocManual').value = '';
  $('#xcCodManual').value = '';
  $('#xcErr').hidden = true;
  $('#dXc').showModal();
});

let XC_MASIVO_FILAS = [];
$('#xcArchivo').addEventListener('change', async e => {
  const f = e.target.files[0];
  XC_MASIVO_FILAS = [];
  if (!f) return;

  try {
    let rows = [];
    if (f.name.endsWith('.csv')) {
      const txt = await f.text();
      rows = leerCSV(txt);
    } else {
      const data = await f.arrayBuffer();
      const wb = XLSX.read(data);
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
    }

    XC_MASIVO_FILAS = rows.map(r => {
      const norm = {};
      Object.entries(r).forEach(([k, v]) => norm[normalizarHeader(k)] = String(v || '').trim());
      return {
        doc_asociado: norm['DOC. ASOCIADO'] || norm['DOCUMENTO'] || norm['NUMERO DE IDENTIFICACION'] || norm['DOC_ASOCIADO'] || norm['CEDULA'],
        xc_subscriptionname__c: norm['XC_SUBSCRIPTIONNAME__C'] || norm['XC_SUBSCRIPTIONNAME'] || norm['CODIGO XC'] || norm['XC'],
        asistencia: norm['ASISTENCIA']
      };
    }).filter(r => r.doc_asociado && r.xc_subscriptionname__c);

    $('#xcInfo').innerHTML = `<div class="notice info">Se leyeron <strong>${numero(XC_MASIVO_FILAS.length)}</strong> registros listos para cruzar por documento.</div>`;
  } catch (err) {
    $('#xcInfo').innerHTML = `<div class="notice bad">Error leyendo archivo: ${esc(err.message)}</div>`;
  }
});

$('#xcOk').addEventListener('click', async () => {
  $('#xcErr').hidden = true;

  // Si hay archivo masivo
  if (XC_MASIVO_FILAS.length) {
    try {
      if ($('#xcOk')) $('#xcOk').disabled = true;
      const r = await api('/api/admin', {
        method: 'POST',
        body: {
          accion: 'consolidado_conciliacion_completar_xc',
          cruce_masivo: XC_MASIVO_FILAS
        }
      });
      toast(`Cruce completado: ${r.actualizados} registros actualizados con su código XC.`);
      if ($('#dXc')) $('#dXc').close();
      await cargarConsolidado(CONSOLIDADO_PAGINA);
    } catch (x) {
      if ($('#xcErr')) { $('#xcErr').textContent = x.message; $('#xcErr').hidden = false; }
    } finally {
      if ($('#xcOk')) $('#xcOk').disabled = false;
    }
    return;
  }

  // O edición manual
  const doc = $('#xcDocManual') ? $('#xcDocManual').value.trim() : '';
  const cod = $('#xcCodManual') ? $('#xcCodManual').value.trim() : '';
  if (doc && cod) {
    try {
      if ($('#xcOk')) $('#xcOk').disabled = true;
      const r = await api('/api/admin', {
        method: 'POST',
        body: {
          accion: 'consolidado_conciliacion_completar_xc',
          doc_asociado: doc,
          xc_subscriptionname__c: cod
        }
      });
      toast(`Actualizado: ${r.actualizados} registro(s) asignados con el código XC.`);
      if ($('#dXc')) $('#dXc').close();
      await cargarConsolidado(CONSOLIDADO_PAGINA);
    } catch (x) {
      if ($('#xcErr')) { $('#xcErr').textContent = x.message; $('#xcErr').hidden = false; }
    } finally {
      if ($('#xcOk')) $('#xcOk').disabled = false;
    }
    return;
  }

  if ($('#xcErr')) {
    $('#xcErr').textContent = 'Suba un archivo con cruce o complete el documento y código manual.';
    $('#xcErr').hidden = false;
  }
});

/* ==================== ALTAS MASIVAS ==================== */
let mFilas = [];
let mLoteId = '';
$('#sMasivaBtn').addEventListener('click', () => { $('#mEmpresa').value = $('#sEmpresa').value || ''; $('#mArchivo').value = ''; $('#mSoporte').value = ''; $('#mInfo').innerHTML = ''; mFilas = []; $('#mOk').disabled = true; $('#dMasiva').showModal(); });
$('#mPlantilla').addEventListener('click', () => {

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet([{ tipo_doc: 'CC', num_doc: '12345678', nombres: 'Juan', apellidos: 'Pérez', fecha_nac: '01/01/1990', genero: 'M', celular: '3000000000', correo: 'juan@ejemplo.com', ciudad: 'Bogotá', direccion: 'Calle 1', asistencia: 'Doctor 360', plan: 'Light', modelo: '1', forma_pago: 'Nomina', valor_mensual: 25000 }]);
  XLSX.utils.book_append_sheet(wb, ws, "Datos");
  const wsInst = XLSX.utils.aoa_to_sheet([["Instrucciones para altas masivas"], ["No modifique las columnas."], ["Las fechas deben ser dd/mm/aaaa."]]);
  XLSX.utils.book_append_sheet(wb, wsInst, "Instrucciones");
  XLSX.writeFile(wb, "Plantilla_CargaMasiva.xlsx");
});
$('#mArchivo').addEventListener('change', async e => {

  const f = e.target.files[0]; mFilas = []; $('#mOk').disabled = true; if (!f) return;
  const data = await f.arrayBuffer();
  const wb = XLSX.read(data);
  mFilas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  if (!mFilas.length) return $('#mInfo').innerHTML = '<div class="notice bad">Archivo vacío</div>';
  mLoteId = 'MAS-' + Date.now().toString(36);
  let html = `<div class="notice info">${mFilas.length} fila(s) leídas.</div>`;
  let bloq = 0;
  mFilas.forEach((r, i) => {
    let errs = [];
    if (!r.num_doc) errs.push('Falta documento');
    if (!r.nombres || !r.apellidos) errs.push('Falta nombre/apellido');
    if (!r.asistencia || !r.plan) errs.push('Falta asistencia/plan');
    if (errs.length) { bloq++; html += `<div style="color:red;font-size:12px">Fila ${i+2}: ${errs.join(', ')}</div>`; }
  });
  if (bloq > 0) html += `<div>${bloq} fila(s) tienen errores bloqueantes. Se ignorarán.</div>`;
  $('#mInfo').innerHTML = html;
  $('#mOk').disabled = mFilas.length === 0;
});
$('#mOk').addEventListener('click', async () => {

  if (!$('#mEmpresa').value) return toast('Elija la empresa.');
  $('#mOk').disabled = true;
  let soporte_id = null;
  const fSoporte = $('#mSoporte').files[0];
  if (fSoporte) {
    try {
      const { put } = await import('/vendor/vercel-blob-client.js');
      const empId = $('#mEmpresa').value;
      const rT = await api('/api/archivo', { method:'POST', body: { accion:'token_subida', tipo:'soporte_nomina', id_inscripcion: mLoteId, empresa_id: empId } });
      const bRes = await put(rT.pathname || `${mLoteId}_soporte`, fSoporte, { access: 'public', token: rT.clientToken });
      const rReg = await api('/api/archivo', { method:'POST', body: { accion:'registrar', id_inscripcion: mLoteId, tipo:'soporte_nomina', empresa_id: empId, pathname: rT.pathname } });
      soporte_id = rReg.id;
    } catch(ex) { toast('Falló la subida del soporte: ' + ex.message); $('#mOk').disabled = false; return; }
  }
  
  const lotes = [];
  for (let i = 0; i < mFilas.length; i += 200) lotes.push(mFilas.slice(i, i + 200));
  let cargadas = 0, omitidas = 0, errores = 0;
  try {
    for (const lote of lotes) {
      const r = await api('/api/admin', { method: 'POST', body: { accion: 'altas_masivas', empresa_id: $('#mEmpresa').value, id_lote: mLoteId, filas: lote, archivo_soporte_id: soporte_id } });
      cargadas += r.cargadas || 0;
      omitidas += r.omitidas || 0;
      errores += (r.errores || []).length;
    }
    toast(`${cargadas} cargadas, ${omitidas} repetidas omitidas, ${errores} con error.`);
    $('#dMasiva').close();
    cargarSolicitudes();
  } catch(x) {
    $('#mInfo').innerHTML = `<div class="notice bad"><strong>${esc(x.message)}</strong>${x.datos && x.datos.errores ? `<ul>${x.datos.errores.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}</div>`;
    $('#mOk').disabled = false;
  }
});

/* ==================== EMPRESAS ==================== */
async function cargarEmpresas() {
  const d = await api('/api/admin', { method: 'POST', body: { accion: 'empresas' } });
  EMPRESAS = d.filas; PRODUCTOS = d.productos; pintarSelectEmpresas();
  $('#eTb').innerHTML = EMPRESAS.map(e => `<tr><td><strong>${esc(e.nombre)}</strong></td><td class="nw">${esc(e.nit)}</td>
    <td>${e.modelo === 3 ? 'Mixto' : 'Modelo ' + e.modelo}<small class="muted">${e.modelo === 1 ? 'Nómina' : e.modelo === 2 ? 'Empresa / cofinanciado' : 'Nómina / Empresa'}</small></td>
    <td>${!e.productos.length ? 'Todos' : `${e.productos.length} de ${PRODUCTOS.length}`}</td>
    <td class="num">${numero(e.activos)}</td><td class="num">${numero(e.usuarios)}</td>
    <td>${e.activa ? '<span class="tag valida">Activa</span>' : '<span class="tag invalida">Inactiva</span>'}</td>
    <td class="nw"><button type="button" class="lnk" data-edit="${e.id}">Editar</button> · <a class="lnk" href="/portal?empresa_id=${e.id}">Ver portal</a></td></tr>`).join('');
  $('#eVacio').hidden = EMPRESAS.length > 0;
}
let empEdit = null;
function abrirEmpresa(e) {
  empEdit = e || null;
  if ($('#dEmpT')) $('#dEmpT').textContent = e ? 'Editar empresa' : 'Nueva empresa';
  if ($('#eNombre')) $('#eNombre').value = e ? e.nombre : '';
  if ($('#eNit')) $('#eNit').value = e ? e.nit : '';
  if ($('#eModelo')) $('#eModelo').value = e ? e.modelo : 1;
  if ($('#eActiva')) $('#eActiva').checked = e ? e.activa : true;
  // Cargar dominios en el textarea
  const doms = (e && Array.isArray(e.dominios)) ? e.dominios : [];
  if ($('#eDominios')) $('#eDominios').value = doms.join('\n');
  const on = e && e.productos.length ? new Set(e.productos) : new Set(PRODUCTOS.map(p => p.clave));
  let grupo = '';
  if ($('#eProds')) {
    $('#eProds').innerHTML = PRODUCTOS.map(p => { const h = p.asistencia !== grupo ? `<h4>${esc(p.asistencia)}</h4>` : ''; grupo = p.asistencia;
      return `${h}<label><input type="checkbox" value="${p.clave}" ${on.has(p.clave) ? 'checked' : ''}> ${esc(p.plan)}</label>`; }).join('');
  }
  if ($('#eErr')) $('#eErr').hidden = true;
  if ($('#dEmp')) $('#dEmp').showModal();
}
$('#eNueva').addEventListener('click', () => abrirEmpresa());
$('#eTb').addEventListener('click', e => { const b = e.target.closest('[data-edit]'); if (b) abrirEmpresa(EMPRESAS.find(x => x.id === +b.dataset.edit)); });
$('#eTodos').addEventListener('click', () => $$('#eProds input').forEach(i => i.checked = true));
$('#eNinguno').addEventListener('click', () => $$('#eProds input').forEach(i => i.checked = false));
$('#eOk').addEventListener('click', async () => {

  const productos = $$('#eProds input:checked').map(i => i.value);
  if (!productos.length) {
    if ($('#eErr')) { $('#eErr').textContent = 'Habilite al menos un producto.'; $('#eErr').hidden = false; }
    return;
  }
  try {
    await api('/api/admin', { method: 'POST', body: { accion: 'empresa_guardar', id: empEdit && empEdit.id,
      nombre: $('#eNombre').value, nit: $('#eNit').value,
      modelo: +$('#eModelo').value, activa: $('#eActiva').checked,
      productos: productos.length === PRODUCTOS.length ? [] : productos } });
    // Guardar dominios si se especificaron
    const domTexto = $('#eDominios') ? $('#eDominios').value.trim() : '';
    const domList = domTexto ? domTexto.split('\n').map(d => d.trim()).filter(Boolean) : [];
    if (empEdit || domList.length) {
      // Obtener el ID de la empresa recién creada o editada
      const emps = (await api('/api/admin', { method: 'POST', body: { accion: 'empresas' } })).filas;
      const empGuardada = emps.find(e => e.nit === $('#eNit').value.replace(/[^0-9-]/g, ''));
      if (empGuardada && domList.length) {
        try { await api('/api/admin', { method: 'POST', body: { accion: 'dominios_guardar', empresa_id: empGuardada.id, dominios: domList } }); }
        catch (dx) { toast('Empresa guardada, pero error en dominios: ' + dx.message); }
      }
    }
    if ($('#dEmp')) $('#dEmp').close();
    toast('Empresa guardada.');
    cargarEmpresas();
  } catch (x) {
    if ($('#eErr')) { $('#eErr').textContent = x.message; $('#eErr').hidden = false; }
  }
});

/* ==================== USUARIOS ==================== */
const ROLES = { maestro: 'Maestro', validador: 'Validador', empresa_admin: 'Empresa admin', empresa_usuario: 'Empresa usuario' };
async function cargarUsuarios() {
  if (!EMPRESAS.length) await cargarEmpresas();
  USUARIOS = (await api('/api/admin', { method: 'POST', body: { accion: 'usuarios' } })).filas;
  if ($('#uTb')) {
    $('#uTb').innerHTML = USUARIOS.map(u => `<tr><td>${esc(u.nombre)}</td><td>${esc(u.email)}</td><td>${ROLES[u.rol]}</td><td>${esc(u.empresa_nombre || '—')}</td>
      <td class="nw">${u.ultimo_ingreso ? esc(fechaHora(u.ultimo_ingreso)) : '<span class="muted">Nunca</span>'}</td>
      <td>${u.activo ? '<span class="tag valida">Activo</span>' : '<span class="tag invalida">Inactivo</span>'}</td>
      <td class="nw"><button type="button" class="lnk" data-uedit="${u.id}">Editar</button> · <button type="button" class="lnk" data-uclave="${u.id}">Nueva contraseña</button></td></tr>`).join('');
  }
}
let usuEdit = null;
function abrirUsuario(u) {
  usuEdit = u || null;
  if ($('#dUsuT')) $('#dUsuT').textContent = u ? 'Editar usuario' : 'Nuevo usuario';
  if ($('#uNombre')) $('#uNombre').value = u ? u.nombre : '';
  if ($('#uEmail')) $('#uEmail').value = u ? u.email : '';
  if ($('#uRol')) $('#uRol').value = u ? u.rol : 'empresa_usuario';
  if ($('#uEmpresa')) $('#uEmpresa').value = u && u.empresa_id ? u.empresa_id : '';
  if ($('#uActivo')) $('#uActivo').checked = u ? u.activo : true;
  if ($('#uExcepcionDominio')) $('#uExcepcionDominio').checked = false;
  const esDeEmpresa = ['empresa_admin', 'empresa_usuario'].includes($('#uRol') ? $('#uRol').value : '');
  if ($('#uEmpWrap')) $('#uEmpWrap').hidden = !esDeEmpresa;
  if ($('#uErr')) $('#uErr').hidden = true;
  if ($('#dUsu')) $('#dUsu').showModal();
}
function mostrarClave(txt, clave) {
  if ($('#ctTxt')) $('#ctTxt').textContent = txt;
  if ($('#ctClave')) $('#ctClave').textContent = clave;
  if ($('#dClaveT')) $('#dClaveT').showModal();
}
if ($('#ctCopiar')) $('#ctCopiar').addEventListener('click', () => navigator.clipboard.writeText($('#ctClave') ? $('#ctClave').textContent : '').then(() => toast('Copiada.')));
if ($('#uRol')) $('#uRol').addEventListener('change', () => { const esEmp = ['empresa_admin', 'empresa_usuario'].includes($('#uRol').value); if ($('#uEmpWrap')) $('#uEmpWrap').hidden = !esEmp; });
if ($('#uNuevo')) $('#uNuevo').addEventListener('click', () => abrirUsuario());
if ($('#uTb')) $('#uTb').addEventListener('click', async e => {

  const ed = e.target.closest('[data-uedit]'); if (ed) return abrirUsuario(USUARIOS.find(u => u.id === +ed.dataset.uedit));
  const cl = e.target.closest('[data-uclave]'); if (!cl) return;
  const u = USUARIOS.find(x => x.id === +cl.dataset.uclave);
  if (!confirm(`¿Generar una contraseña nueva para ${u.nombre}? La actual deja de funcionar y se cierran sus sesiones.`)) return;
  try { const r = await api('/api/admin', { method: 'POST', body: { accion: 'usuario_clave', id: u.id } }); mostrarClave(`Nueva contraseña de ${u.nombre} (${u.email}):`, r.clave_temporal); }
  catch (x) { toast(x.message); }
});
if ($('#uOk')) $('#uOk').addEventListener('click', async () => {

  try {
    const r = await api('/api/admin', { method: 'POST', body: { accion: 'usuario_guardar', id: usuEdit && usuEdit.id,
      nombre: $('#uNombre').value, email: $('#uEmail').value,
      rol: $('#uRol').value, empresa_id: $('#uEmpresa').value || undefined,
      activo: $('#uActivo').checked, excepcion_dominio: $('#uExcepcionDominio').checked } });
    if ($('#dUsu')) $('#dUsu').close();
    cargarUsuarios();
    if (r.clave_temporal) mostrarClave(`Usuario creado: ${$('#uEmail').value}. Contraseña temporal:`, r.clave_temporal); else toast('Usuario guardado.');
  } catch (x) {
    if ($('#uErr')) { $('#uErr').textContent = x.message; $('#uErr').hidden = false; }
  }
});

/* ==================== INICIO ==================== */
(async () => {
  try {
    SES = await api('/api/sesion');
    if (['empresa_admin', 'empresa_usuario'].includes(SES.usuario.rol)) { location.replace('/portal'); return; }
    pintarUsuario(SES, `<a class="link-w" href="/">Diligenciar formulario</a>`);
    EMPRESAS = SES.empresas ? SES.empresas.map(e => ({ ...e, activa: true })) : [];
    if (!esMaestro()) $$('[data-admin]').forEach(b => b.hidden = true);
    else await cargarEmpresas();
    pintarSelectEmpresas();
    await cargarSolicitudes();
    if ($('#cargando')) $('#cargando').hidden = true;
    if ($('#app')) $('#app').hidden = false;
    if (esMaestro() && !EMPRESAS.length) { abrirTab('empresas'); toast('Empiece creando la primera empresa.'); }
  } catch (x) {
    if ($('#cargando')) $('#cargando').hidden = true;
    if ($('#errorCarga')) {
      $('#errorCarga').textContent = x.message;
      $('#errorCarga').hidden = false;
    }
  }
})();
