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
  $('#cntPend').textContent = pend; $('#cntPend').hidden = !pend;
  $('#sKpis').innerHTML = [
    ['Recibidas en el mes', base.length, `${base.filter(s => s.tipo === 'alta').length} altas · ${base.filter(s => s.tipo === 'baja').length} bajas`],
    ['Pendientes', cnt('pendiente'), `${base.filter(s => s.estado === 'pendiente' && s.alertas.length).length} con alertas`],
    ['Válidas', cnt('valida'), 'Ya aplicadas al consolidado', 'ok'],
    ['Inválidas', cnt('invalida'), 'Visibles para la empresa']
  ].map(([l, v, d, c]) => `<div class="kpi ${c || ''}"><div class="l">${l}</div><div class="v">${numero(v)}</div><div class="d">${esc(d)}</div></div>`).join('');
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
  $('#sVacio').hidden = lista.length > 0;
  $('#sVacio').textContent = SOL.filas.length ? 'No hay solicitudes con esos filtros.' : `No llegaron solicitudes en ${nombreMes(SOL.periodo)}.`;
  $('#sTodos').checked = lista.length > 0 && lista.every(s => sel.has(s.id));
  pintarSeleccion();
}
function pintarSeleccion() {
  $('#sSel').textContent = `${sel.size} seleccionada${sel.size === 1 ? '' : 's'}`;
  ['#sValida', '#sInvalida', '#sPendiente'].forEach(b => $(b).disabled = !sel.size);
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
  $('#dDetT').textContent = `Solicitud #${s.id} · ${s.tipo === 'alta' ? 'Alta' : 'Baja'}`;
  const campos = Object.entries(s.datos || {}).filter(([k, v]) => !OCULTAR.has(k) && String(v ?? '').trim() !== '');
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
  $('#dDet').showModal();
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
  $('#iRapidos').innerHTML = [...textos].slice(0, 10).map(t => `<button type="button" class="btn sec sm" data-m="${esc(t)}">${esc(t)}</button>`).join('');
  $('#iMotivo').value = ''; $('#iErr').hidden = true; $('#dInv').showModal(); $('#iMotivo').focus();
});
$('#iRapidos').addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (!b) return; const m = $('#iMotivo'); m.value = (m.value.trim() ? m.value.trim() + ' ' : '') + b.dataset.m; });
$('#iOk').addEventListener('click', async () => {

  try { await validar('invalida', $('#iMotivo').value.trim()); $('#dInv').close(); }
  catch (x) { $('#iErr').textContent = x.message; $('#iErr').hidden = false; }
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

/* ==================== CONSOLIDADO ==================== */
async function cargarConsolidado() {
  const eid = $('#cEmpresa').value;
  const [d, portal] = await Promise.all([
    api('/api/admin', { method: 'POST', body: { accion: 'consolidado', empresa_id: eid || undefined } }),
    eid ? api('/api/portal?empresa_id=' + eid) : null
  ]);
  CONS = d.filas;
  $('#cPortal').hidden = !eid; $('#cPortal').href = '/portal?empresa_id=' + eid;
  const activas = CONS.filter(c => c.estado === 'activo');
  const tot = activas.reduce((a, c) => a + c.valor_mensual, 0);
  const k = portal ? portal.resumen : null;
  $('#cKpis').innerHTML = (k ? [
    ['Titulares', numero(k.titulares)], ['Personas cubiertas', numero(k.personas)], ['Asistencias', numero(k.asistencias)],
    ['Valor mensual', pesos(k.valor_total)], ...(portal.empresa.modelo === 2 ? [[`Total a pagar (−${k.descuento_pct} %)`, pesos(k.total_a_pagar)]] : [])
  ] : [['Empresas activas', numero(new Set(activas.map(c => c.empresa_id)).size)], ['Titulares', numero(new Set(activas.map(c => c.empresa_id + ':' + c.titular_num_doc)).size)],
    ['Asistencias', numero(activas.length)], ['Valor mensual (sin descuentos)', pesos(tot)]])
    .map(([l, v]) => `<div class="kpi"><div class="l">${esc(l)}</div><div class="v">${esc(v)}</div></div>`).join('');
  pintarConsolidado();
}
function pintarConsolidado() {
  const q = $('#cQ').value.trim().toLowerCase();
  const lista = CONS.filter(c => !q || [c.titular_num_doc, c.titular_nombre].some(v => String(v || '').toLowerCase().includes(q)));
  const max = 1500;
  $('#cTb').innerHTML = lista.slice(0, max).map(c => {
    const act = c.estado === 'activo';
    return `<tr style="${act ? '' : 'opacity:0.5;background:#f9f9f9'}">
      <td>${esc(c.empresa_nombre)} ${act ? '' : '<span class="badge" style="background:#e0e0e0;color:#666;font-size:10px;padding:2px 4px;border-radius:4px">Retirado</span>'}</td>
      <td>${esc(c.titular_nombre)}</td>
      <td class="nw">${esc(c.titular_num_doc)}</td><td>${esc(c.asistencia)}</td><td>${esc(c.plan)}${c.mascota ? `<small class="muted">${esc(c.mascota)}</small>` : ''}</td>
      <td>${esc(PAGO_TXT[c.pago] || '')}<small class="muted" style="display:block">Mod. ${c.modelo_aplicado || 1}</small></td><td class="num">${numero(c.personas)}</td><td class="num">${pesos(c.valor_mensual)}</td>
      <td class="nw">${esc(c.fecha_alta_txt || '')}</td><td>${c.origen === 'importado' ? 'Carga inicial' : 'Formulario'}</td></tr>`;
  }).join('');
  $('#cVacio').hidden = lista.length > 0;
  const numActivas = lista.filter(c => c.estado === 'activo').length;
  $('#cCuenta').textContent = `${lista.length} registros en total (${numActivas} activos)${lista.length > max ? ` (se muestran ${max}; use la búsqueda o descargue el CSV)` : ''}`;
}
$('#cEmpresa').addEventListener('change', () => cargarConsolidado().catch(x => toast(x.message)));
$('#cQ').addEventListener('input', pintarConsolidado);
$('#cCsv').addEventListener('click', () => {

  if (!CONS.length) return toast('No hay datos para descargar.');
  const MESES = ['MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE', 'ene-26', 'feb-26', 'mar-26', 'abr-26', 'may-26', 'jun-26', 'jul-26', 'ago-26', 'sep-26'];
  const cols = [
    ['empresa_nit', 'NIT'],
    ['empresa_nombre', 'CONVENIO / EMPRESA'],
    [c => `${c.asistencia} - ${c.plan}`, 'XC_SUBSCRIPTIONNAME__C'],
    [c => c.estado === 'activo' ? 'Activo' : 'Retirado', 'ESTADO'],
    [c => c.origen === 'formulario' ? 'Venta Directa' : 'Carga', 'CANAL DE ATENCIÓN'],
    ['fecha_alta_txt', 'FECHA DE CARGUE'],
    [() => '', 'FECHA DE CORTE'],
    [() => '', 'ASOCIADO'],
    [() => '', 'DOC. ASOCIADO'],
    ['fecha_baja', 'FECHA DE RETIRO'],
    ['asistencia', 'ASISTENCIA'],
    ['valor_mensual', 'VALOR CON IVA'],
    [c => Math.round(c.valor_mensual / 1.19), 'VALOR SIN IVA'],
    ...MESES.map(m => [() => '', m]),
    ['titular_nombre', 'TITULAR'],
    [c => (c.datos || {}).titular_tipo_doc || '', 'TIPO DOC.'],
    ['titular_num_doc', 'NUMERO DE IDENTIFICACIÓN'],
    [c => (c.datos || {}).titular_fecha_nac || '', 'FECHA DE NACIMIENTO'],
    [c => (c.datos || {}).titular_celular || '', 'CELULAR'],
    [c => (c.datos || {}).titular_correo || '', 'CORREO'],
    [c => (c.datos || {}).titular_ciudad || '', 'CIUDAD O MUNICIPIO'],
    [c => (c.datos || {}).titular_direccion || '', 'DIRECCIÓN PREDIO'],
    [c => {
      const f = (c.datos || {}).titular_fecha_nac;
      if (!f) return '';
      const parts = f.split('/');
      if (parts.length === 3) {
        const fn = new Date(parts[2], parts[1]-1, parts[0]);
        if (isNaN(fn)) return '';
        const ageDifMs = Date.now() - fn.getTime();
        const ageDate = new Date(ageDifMs);
        return Math.abs(ageDate.getUTCFullYear() - 1970);
      }
      return '';
    }, 'EDAD'],
    [c => (c.datos || {}).beneficiario1_nombre || '', 'NOMBRE BENEFICIARIO 1'],
    [c => (c.datos || {}).beneficiario1_tipo_doc || '', 'TIPO DE DOC. BENEFICIARIO 1'],
    [c => (c.datos || {}).beneficiario1_num_doc || '', 'DOCUMENTO NÚMERO BENEFICIARIO'],
    [c => (c.datos || {}).beneficiario1_parentesco || '', 'PARENTESCO'],
    [c => (c.datos || {}).beneficiario1_porcentaje || '', '%'],
    [c => (c.datos || {}).beneficiario2_nombre || '', 'NOMBRE BENEFICIARIO 2'],
    [c => (c.datos || {}).beneficiario2_tipo_doc || '', 'TIPO DE DOC. BENEFICIARIO 2'],
    [c => (c.datos || {}).beneficiario2_num_doc || '', 'DOCUMENTO NÚMERO BENEFICIARIO 2'],
    [c => (c.datos || {}).beneficiario2_parentesco || '', 'PARENTESCO2'],
    [c => (c.datos || {}).beneficiario2_porcentaje || '', '%2'],
    [c => (c.datos || {}).beneficiario3_nombre || '', 'NOMBRE BENEFICIARIO 3'],
    [c => (c.datos || {}).beneficiario3_tipo_doc || '', 'TIPO DE DOC. BENEFICIARIO 3'],
    [c => (c.datos || {}).beneficiario3_num_doc || '', 'DOCUMENTO NÚMERO BENEFICIARIO 3'],
    [c => (c.datos || {}).beneficiario3_parentesco || '', 'PARENTESCO4'],
    [c => (c.datos || {}).beneficiario3_porcentaje || '', '%3']
  ];
  const emp = $('#cEmpresa').value ? EMPRESAS.find(e => String(e.id) === $('#cEmpresa').value).nombre.replace(/[^\w]+/g, '_') : 'Todas';
  descargarCSV(`Conciliacion_${emp}_${new Date().toISOString().slice(0, 10)}.csv`, cols, CONS);
});

// Importación del consolidado inicial
let IMP = [];
$('#cImportar').addEventListener('click', () => { $('#impEmpresa').value = $('#cEmpresa').value; $('#impArchivo').value = ''; $('#impInfo').innerHTML = ''; IMP = []; $('#impOk').disabled = true; $('#dImp').showModal(); });
$('#impPlantilla').addEventListener('click', () => {

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet([
    { titular_num_doc: '1020304050', titular_nombre: 'Nombre Apellido', titular_tipo_doc: 'CC', asistencia: 'Doctor 360', plan: 'Light', valor_mensual: '25000', personas: '3', pago: 'Nomina', mascota: '', modelo: '1' },
    { titular_num_doc: '1020304050', titular_nombre: 'Nombre Apellido', titular_tipo_doc: 'CC', asistencia: 'Protección Hogar', plan: 'Hogar Mascotas', valor_mensual: '12000', personas: '1', pago: 'Nomina', mascota: 'Luna (perro)', modelo: '1' }
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Datos");
  const wsInst = XLSX.utils.aoa_to_sheet([
    ["Instrucciones para el consolidado"],
    ["1. Llene los datos requeridos. NO cambie los nombres de las columnas."],
    ["2. Datos opcionales: titular_tipo_doc, personas, pago (Nomina, Empresa, Cofinanciado), mascota, modelo."]
  ]);
  XLSX.utils.book_append_sheet(wb, wsInst, "Instrucciones");
  XLSX.writeFile(wb, "Plantilla_consolidado.xlsx");
});
$('#impArchivo').addEventListener('change', async e => {

  const f = e.target.files[0]; IMP = []; $('#impOk').disabled = true; if (!f) return;
  let filas = [];
  if (f.name.endsWith('.csv')) {
    const txt = await f.text(); filas = leerCSV(txt);
  } else {
    const data = await f.arrayBuffer();
    const wb = XLSX.read(data);
    filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  }
  const alias = { documento: 'titular_num_doc', cedula: 'titular_num_doc', num_doc: 'titular_num_doc', nombre: 'titular_nombre', titular: 'titular_nombre',
    tipo_doc: 'titular_tipo_doc', valor: 'valor_mensual', personas_cubiertas: 'personas' };
  IMP = filas.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [alias[k] || k, v])));
  const faltan = ['titular_num_doc', 'titular_nombre', 'asistencia', 'plan'].filter(k => IMP.length && !(k in IMP[0]));
  $('#impInfo').innerHTML = !IMP.length ? '<div class="notice bad">El archivo está vacío.</div>'
    : faltan.length ? `<div class="notice bad">Faltan columnas: ${faltan.join(', ')}</div>`
    : `<div class="notice info">${IMP.length} filas listas para cargar.</div>`;
  $('#impOk').disabled = !IMP.length || faltan.length > 0;
});
$('#impOk').addEventListener('click', async () => {

  if (!$('#impEmpresa').value) return toast('Elija la empresa.');
  $('#impOk').disabled = true;
  try {
    const r = await api('/api/admin', { method: 'POST', body: { accion: 'importar', empresa_id: $('#impEmpresa').value, filas: IMP } });
    $('#dImp').close(); toast(`Cargadas ${r.cargadas}. Omitidas por estar ya activas: ${r.omitidas}.`);
    $('#cEmpresa').value = $('#impEmpresa').value; cargarConsolidado();
  } catch (x) {
    $('#impInfo').innerHTML = `<div class="notice bad"><strong>${esc(x.message)}</strong>${x.datos && x.datos.errores ? `<ul>${x.datos.errores.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}</div>`;
    $('#impOk').disabled = false;
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
  $('#dEmpT').textContent = e ? 'Editar empresa' : 'Nueva empresa';
  $('#eNombre').value = e ? e.nombre : ''; $('#eNit').value = e ? e.nit : '';
  $('#eModelo').value = e ? e.modelo : 1; $('#eActiva').checked = e ? e.activa : true;
  // Cargar dominios en el textarea
  const doms = (e && Array.isArray(e.dominios)) ? e.dominios : [];
  $('#eDominios').value = doms.join('\n');
  const on = e && e.productos.length ? new Set(e.productos) : new Set(PRODUCTOS.map(p => p.clave));
  let grupo = '';
  $('#eProds').innerHTML = PRODUCTOS.map(p => { const h = p.asistencia !== grupo ? `<h4>${esc(p.asistencia)}</h4>` : ''; grupo = p.asistencia;
    return `${h}<label><input type="checkbox" value="${p.clave}" ${on.has(p.clave) ? 'checked' : ''}> ${esc(p.plan)}</label>`; }).join('');
  $('#eErr').hidden = true; $('#dEmp').showModal();
}
$('#eNueva').addEventListener('click', () => abrirEmpresa());
$('#eTb').addEventListener('click', e => { const b = e.target.closest('[data-edit]'); if (b) abrirEmpresa(EMPRESAS.find(x => x.id === +b.dataset.edit)); });
$('#eTodos').addEventListener('click', () => $$('#eProds input').forEach(i => i.checked = true));
$('#eNinguno').addEventListener('click', () => $$('#eProds input').forEach(i => i.checked = false));
$('#eOk').addEventListener('click', async () => {

  const productos = $$('#eProds input:checked').map(i => i.value);
  if (!productos.length) { $('#eErr').textContent = 'Habilite al menos un producto.'; $('#eErr').hidden = false; return; }
  try {
    await api('/api/admin', { method: 'POST', body: { accion: 'empresa_guardar', id: empEdit && empEdit.id,
      nombre: $('#eNombre').value, nit: $('#eNit').value,
      modelo: +$('#eModelo').value, activa: $('#eActiva').checked,
      productos: productos.length === PRODUCTOS.length ? [] : productos } });
    // Guardar dominios si se especificaron
    const domTexto = $('#eDominios').value.trim();
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
    $('#dEmp').close(); toast('Empresa guardada.'); cargarEmpresas();
  } catch (x) { $('#eErr').textContent = x.message; $('#eErr').hidden = false; }
});

/* ==================== USUARIOS ==================== */
const ROLES = { maestro: 'Maestro', validador: 'Validador', empresa_admin: 'Empresa admin', empresa_usuario: 'Empresa usuario' };
async function cargarUsuarios() {
  if (!EMPRESAS.length) await cargarEmpresas();
  USUARIOS = (await api('/api/admin', { method: 'POST', body: { accion: 'usuarios' } })).filas;
  $('#uTb').innerHTML = USUARIOS.map(u => `<tr><td>${esc(u.nombre)}</td><td>${esc(u.email)}</td><td>${ROLES[u.rol]}</td><td>${esc(u.empresa_nombre || '—')}</td>
    <td class="nw">${u.ultimo_ingreso ? esc(fechaHora(u.ultimo_ingreso)) : '<span class="muted">Nunca</span>'}</td>
    <td>${u.activo ? '<span class="tag valida">Activo</span>' : '<span class="tag invalida">Inactivo</span>'}</td>
    <td class="nw"><button type="button" class="lnk" data-uedit="${u.id}">Editar</button> · <button type="button" class="lnk" data-uclave="${u.id}">Nueva contraseña</button></td></tr>`).join('');
}
let usuEdit = null;
function abrirUsuario(u) {
  usuEdit = u || null;
  $('#dUsuT').textContent = u ? 'Editar usuario' : 'Nuevo usuario';
  $('#uNombre').value = u ? u.nombre : ''; $('#uEmail').value = u ? u.email : '';
  $('#uRol').value = u ? u.rol : 'empresa_usuario';
  $('#uEmpresa').value = u && u.empresa_id ? u.empresa_id : ''; $('#uActivo').checked = u ? u.activo : true;
  $('#uExcepcionDominio').checked = false;
  const esDeEmpresa = ['empresa_admin', 'empresa_usuario'].includes($('#uRol').value);
  $('#uEmpWrap').hidden = !esDeEmpresa; $('#uErr').hidden = true; $('#dUsu').showModal();
}
function mostrarClave(txt, clave) { $('#ctTxt').textContent = txt; $('#ctClave').textContent = clave; $('#dClaveT').showModal(); }
$('#ctCopiar').addEventListener('click', () => navigator.clipboard.writeText($('#ctClave').textContent).then(() => toast('Copiada.')));
$('#uRol').addEventListener('change', () => { const esEmp = ['empresa_admin', 'empresa_usuario'].includes($('#uRol').value); $('#uEmpWrap').hidden = !esEmp; });
$('#uNuevo').addEventListener('click', () => abrirUsuario());
$('#uTb').addEventListener('click', async e => {

  const ed = e.target.closest('[data-uedit]'); if (ed) return abrirUsuario(USUARIOS.find(u => u.id === +ed.dataset.uedit));
  const cl = e.target.closest('[data-uclave]'); if (!cl) return;
  const u = USUARIOS.find(x => x.id === +cl.dataset.uclave);
  if (!confirm(`¿Generar una contraseña nueva para ${u.nombre}? La actual deja de funcionar y se cierran sus sesiones.`)) return;
  try { const r = await api('/api/admin', { method: 'POST', body: { accion: 'usuario_clave', id: u.id } }); mostrarClave(`Nueva contraseña de ${u.nombre} (${u.email}):`, r.clave_temporal); }
  catch (x) { toast(x.message); }
});
$('#uOk').addEventListener('click', async () => {

  try {
    const r = await api('/api/admin', { method: 'POST', body: { accion: 'usuario_guardar', id: usuEdit && usuEdit.id,
      nombre: $('#uNombre').value, email: $('#uEmail').value,
      rol: $('#uRol').value, empresa_id: $('#uEmpresa').value || undefined,
      activo: $('#uActivo').checked, excepcion_dominio: $('#uExcepcionDominio').checked } });
    $('#dUsu').close(); cargarUsuarios();
    if (r.clave_temporal) mostrarClave(`Usuario creado: ${$('#uEmail').value}. Contraseña temporal:`, r.clave_temporal); else toast('Usuario guardado.');
  } catch (x) { $('#uErr').textContent = x.message; $('#uErr').hidden = false; }
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
    $('#cargando').hidden = true; $('#app').hidden = false;
    if (esMaestro() && !EMPRESAS.length) { abrirTab('empresas'); toast('Empiece creando la primera empresa.'); }
  } catch (x) { $('#cargando').hidden = true; $('#errorCarga').textContent = x.message; $('#errorCarga').hidden = false; }
})();
