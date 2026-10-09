let SES = null, D = null;
const params = new URLSearchParams(location.search);
const empresaParam = params.get('empresa_id'); // solo lo usa el equipo interno para ver el portal de una empresa

function ruta(base, extra = {}) {
  const q = new URLSearchParams(extra);
  if (empresaParam) q.set('empresa_id', empresaParam);
  const s = q.toString(); return s ? `${base}?${s}` : base;
}

async function cargar(periodo) {
  D = await api(ruta('/api/portal', periodo ? { periodo } : {}));
  pintar();
}

function pintar() {
  const e = D.empresa, r = D.resumen;
  $('#empresaNombre').textContent = e.nombre;
  $('#empresaNit').textContent = e.nit ? `NIT ${e.nit}` : '';

  $('#periodo').innerHTML = D.periodos.map(p => `<option value="${p}" ${p === D.periodo ? 'selected' : ''}>${esc(nombreMes(p))}${p === D.periodo_actual ? ' (actual)' : ''}</option>`).join('');

  const k = [
    ['Total personas activas', numero(r.personas_activas), 'En el consolidado', ''],
    ['Total asistencias', numero(r.asistencias), 'Planes asignados', ''],
    ['Valor mensual total', pesos(r.valor_total), 'Costo del mes', ''],
  ];
  if (r.valor_empresa > 0 || r.valor_colaborador > 0) {
    k.push(
      ['Aporte empresa', pesos(r.valor_empresa), 'Asume la empresa', ''],
      ['Aporte colaboradores', pesos(r.valor_colaborador), 'Descuento nómina', '']
    );
  }
  if (r.pendientes > 0) {
    k.push(['Pendientes de validar', numero(r.pendientes), 'En revisión por el equipo', 'warn']);
  }
  $('#kpis').innerHTML = k.map(([l, v, d, c]) => `<div class="kpi ${c || ''}"><div class="l">${esc(l)}</div><div class="v">${esc(v)}</div><div class="d">${esc(d)}</div></div>`).join('');

  $('#tbProductos').innerHTML = r.por_producto.map(p => `<tr><td>${esc(p.asistencia)}</td><td>${esc(p.plan)}</td>
    <td class="num">${numero(p.cantidad)}</td><td class="num">${pesos(p.valor)}</td></tr>`).join('');
  $('#tfProductos').innerHTML = r.por_producto.length ? `<tr><td colspan="2">Total</td><td class="num">${numero(r.asistencias)}</td><td class="num">${pesos(r.valor_total)}</td></tr>` : '';

  const pend = D.solicitudes.filter(s => s.estado === 'pendiente');
  if (pend.length) {
    $('#cardPend').innerHTML = `<h3>Novedades de ${esc(nombreMes(D.periodo))} pendientes de validación</h3>
      <p class="sub">Estas solicitudes fueron registradas pero aún no se reflejan en el consolidado porque están siendo verificadas.</p>
      <div class="grid3">${pend.slice(0, 6).map(s => `<div>
        <strong>${esc(s.titular_nombre)}</strong><br>
        <span class="muted">${esc(s.asistencia)} · ${esc(s.plan)}</span><br>
        <span class="tag warn">${s.tipo === 'alta' ? 'Alta' : 'Baja'} · Pendiente</span>
      </div>`).join('')}</div>
      ${pend.length > 6 ? `<p class="muted" style="margin:10px 0 0;font-size:12px">Y ${pend.length - 6} más. Mírelas todas en la pestaña «Solicitudes».</p>` : ''}`;
    $('#cardPend').hidden = false;
  } else { $('#cardPend').hidden = true; }

  const inv = D.solicitudes.filter(s => s.estado === 'invalida');
  $('#avisoInvalidos').innerHTML = inv.length ? `<div class="notice bad"><strong>Tiene ${inv.length} registro${inv.length > 1 ? 's' : ''} por corregir en ${esc(nombreMes(D.periodo))}.</strong>
    Revise la pestaña «Solicitudes» con el filtro «Inválida» para ver el motivo y volver a registrarlos.</div>` : '';

  pintarPersonas();
  pintarSolicitudes();
}

function pintarPersonas() {
  const q = ($('#qPersonas').value || '').toLowerCase().trim();
  const lista = D.consolidado.filter(c => !q ||
    (c.titular_nombre || '').toLowerCase().includes(q) ||
    (c.titular_num_doc || '').toLowerCase().includes(q) ||
    (c.asistencia || '').toLowerCase().includes(q) ||
    (c.plan || '').toLowerCase().includes(q)
  );
  $('#tbPersonas').innerHTML = lista.map(c => `<tr>
    <td><strong>${esc(c.titular_nombre)}</strong></td>
    <td class="nw">${esc(c.titular_num_doc)}</td>
    <td>${esc(c.asistencia)}</td>
    <td>${esc(c.plan)}</td>
    <td>${esc(c.mascota || '—')}</td>
    <td class="num">${c.personas}</td>
    <td class="num">${pesos(c.valor_mensual)}</td>
    <td class="nw">${c.fecha_alta || '—'}</td>
  </tr>`).join('');
  $('#vacioPersonas').textContent = D.consolidado.length ? 'No hay personas con ese filtro.' : 'No hay personas registradas en esta empresa.';
}

function pintarSolicitudes() {
  const q = ($('#qSol').value || '').toLowerCase().trim();
  const est = $('#fEstado').value;
  const lista = D.solicitudes.filter(s => {
    if (est && s.estado !== est) return false;
    if (!q) return true;
    return (s.titular_nombre || '').toLowerCase().includes(q) ||
           (s.titular_num_doc || '').toLowerCase().includes(q) ||
           (s.asistencia || '').toLowerCase().includes(q) ||
           (s.plan || '').toLowerCase().includes(q);
  });
  $('#tbSol').innerHTML = lista.map(s => {
    const estadoClass = s.estado === 'valida' ? 'ok' : (s.estado === 'invalida' ? 'bad' : 'warn');
    const motivo = s.estado === 'invalida' && s.motivo ? `<div style="font-size:12px;color:var(--bad)">${esc(s.motivo)}</div>` : '';
    const adjunto = s.archivo_url ? `<a href="${encodeURI(s.archivo_url)}" target="_blank" class="lnk" rel="noopener noreferrer">Ver PDF</a>` : '—';
    return `<tr>
      <td class="nw">${fechaHora(s.recibido_en)}</td>
      <td><span class="tag">${s.tipo === 'alta' ? 'Alta' : 'Baja'}</span></td>
      <td><strong>${esc(s.titular_nombre)}</strong><br><span class="muted">${esc(s.titular_num_doc)}</span></td>
      <td>${esc(s.asistencia)}</td>
      <td>${esc(s.plan)}</td>
      <td class="num">${pesos(s.valor_mensual)}</td>
      <td><span class="tag ${estadoClass}">${ESTADOS[s.estado] || s.estado}</span>${motivo}</td>
      <td>${adjunto}</td>
    </tr>`;
  }).join('');
  $('#vacioSol').textContent = D.solicitudes.length ? 'No hay solicitudes con ese filtro.' : `No hay solicitudes en ${nombreMes(D.periodo)}.`;
}

function abrirTab(t) {
  $$('[data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
  $$('[data-panel]').forEach(p => p.hidden = p.dataset.panel !== t);
}

$$('[data-tab]').forEach(b => b.addEventListener('click', () => abrirTab(b.dataset.tab)));
$('#qPersonas').addEventListener('input', pintarPersonas);
$('#qSol').addEventListener('input', pintarSolicitudes);
$('#fEstado').addEventListener('change', pintarSolicitudes);
$('#periodo').addEventListener('change', () => cargar($('#periodo').value).catch(x => toast(x.message)));
$('#csvPersonas').addEventListener('click', () => descargarCSV(
  `Personas_activas_${D.empresa.nombre.replace(/[^\w]+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`,
  [['titular_nombre', 'Titular'], ['tipo_doc', 'Tipo doc'], ['titular_num_doc', 'Documento'], ['asistencia', 'Asistencia'], ['plan', 'Plan'],
   ['mascota', 'Mascota'], ['personas', 'Personas cubiertas'], ['valor_mensual', 'Valor mensual'], ['fecha_alta', 'Desde']], D.consolidado));

let mFilas = [];
let mLoteId = '';
$('#sMasivaBtn').addEventListener('click', () => {
  $('#mArchivo').value = ''; $('#mSoporte').value = ''; $('#mInfo').innerHTML = ''; mFilas = []; $('#mOk').disabled = true; $('#dMasiva').showModal();
});

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
  $('#mOk').disabled = true;
  let soporte_id = null;
  const fSoporte = $('#mSoporte').files[0];
  if (fSoporte) {
    try {
      const { put } = await import('/vendor/vercel-blob-client.js');
      const rT = await api('/api/archivo', { method:'POST', body: { accion:'token_subida', tipo:'soporte_nomina', id_inscripcion: mLoteId } });
      const bRes = await put(rT.pathname || `${mLoteId}_soporte`, fSoporte, { access: 'public', token: rT.clientToken });
      const rReg = await api('/api/archivo', { method:'POST', body: { accion:'registrar', id_inscripcion: mLoteId, tipo:'soporte_nomina', pathname: rT.pathname } });
      soporte_id = rReg.id;
    } catch(ex) { toast('Falló la subida del soporte: ' + ex.message); $('#mOk').disabled = false; return; }
  }
  
  const lotes = [];
  for (let i = 0; i < mFilas.length; i += 200) lotes.push(mFilas.slice(i, i + 200));
  let cargadas = 0, omitidas = 0, errores = 0;
  try {
    for (const lote of lotes) {
      const r = await api('/api/admin', { method: 'POST', body: { accion: 'altas_masivas', empresa_id: D.empresa.id, id_lote: mLoteId, filas: lote, archivo_soporte_id: soporte_id } });
      cargadas += r.cargadas || 0;
      omitidas += r.omitidas || 0;
      errores += (r.errores || []).length;
    }
    toast(`${cargadas} cargadas, ${omitidas} repetidas omitidas, ${errores} con error.`);
    $('#dMasiva').close();
    cargar($('#periodo').value);
  } catch(x) {
    $('#mInfo').innerHTML = `<div class="notice bad"><strong>${esc(x.message)}</strong>${x.datos && x.datos.errores ? `<ul>${x.datos.errores.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}</div>`;
    $('#mOk').disabled = false;
  }
});

(async () => {
  try {
    SES = await api('/api/sesion');
    // empresa_admin y empresa_usuario ven el portal
    if (!['empresa_admin', 'empresa_usuario'].includes(SES.usuario.rol)) {
      // Roles internos pueden ver el portal de una empresa por empresa_id en la URL
      if (!empresaParam) { location.replace('/admin'); return; }
    }
    if (SES.usuario.rol === 'empresa_admin') $('#sMasivaBtn').hidden = false;
    
    const volver = !['empresa_admin', 'empresa_usuario'].includes(SES.usuario.rol)
      ? '<a class="link-w" href="/admin">← Administración</a>' : '';
    pintarUsuario(SES, volver);
    await cargar();
    $('#cargando').hidden = true; $('#app').hidden = false;
  } catch (x) {
    $('#cargando').hidden = true; $('#errorCarga').textContent = x.message; $('#errorCarga').hidden = false;
  }
})();
