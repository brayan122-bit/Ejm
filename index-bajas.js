/* =====================================================================
   MÓDULO DE BAJAS — el titular se busca por cédula en el consolidado de la empresa
   ===================================================================== */
(() => {
  const el = id => document.getElementById(id);
  const vistasInscripcion = [document.querySelector('nav.rail'), document.querySelector('main.layout'), document.querySelector('div.actions')];
  let encontradas = [], docBuscado = '';

  function cambiarModulo(mod){
    const bajas = mod === 'bajas';
    vistasInscripcion.forEach(v => { if(v) v.hidden = bajas; });
    el('moduloBajas').hidden = !bajas;
    el('tabInscripcion').setAttribute('aria-pressed', !bajas);
    el('tabBajas').setAttribute('aria-pressed', bajas);
    el('titulo').textContent = (bajas ? 'Bajas' : 'Inscripción') + ' · Asistencias Bienestar 360';
    const u = new URL(location.href); u.searchParams.set('modulo', bajas ? 'bajas' : 'inscripcion'); u.searchParams.delete('doc');
    history.replaceState(null, '', u);
    window.scrollTo(0, 0);
  }
  el('tabInscripcion').addEventListener('click', () => cambiarModulo('inscripcion'));
  el('tabBajas').addEventListener('click', () => cambiarModulo('bajas'));

  const empresaBaja = () => SESION.empresa ? SESION.empresa.id : (+el('bajaEmpresa').value || null);
  function marcar(id, txt){ const f = el(id).closest('.f'); f.classList.add('err'); f.querySelector('.msg').textContent = txt; el(id).focus(); }
  function limpiarErrores(){ el('formBajas').querySelectorAll('.f.err').forEach(f => { f.classList.remove('err'); const m = f.querySelector('.msg'); if(m) m.textContent = ''; }); }

  // 1. Buscar las asistencias activas de la cédula
  async function buscar(){
    limpiarErrores(); el('bajaOk').hidden = true;
    const doc = el('bajaDocumento').value.trim();
    if(!SESION.empresa && !empresaBaja()) return marcar('bajaEmpresa', 'Elija la empresa.');
    if(!/^[0-9A-Za-z]{4,20}$/.test(doc)) return marcar('bajaDocumento', 'Escriba un número de documento válido, sin puntos.');
    const btn = el('btnBuscarBaja'); btn.disabled = true; btn.textContent = 'Buscando…';
    try{
      const q = new URLSearchParams({ doc }); if(!SESION.empresa) q.set('empresa_id', empresaBaja());
      const r = await fetch('/api/baja?' + q); const d = await r.json().catch(() => ({}));
      if(r.status === 401){ location.replace('/login?next=' + encodeURIComponent(location.pathname + location.search)); return; }
      if(!r.ok) throw new Error(d.error || 'No se pudo buscar.');
      encontradas = d.asistencias; docBuscado = doc;
      pintarResultados(d);
    } catch(x){ toast(x.message === 'Failed to fetch' ? 'Sin conexión. Intente de nuevo.' : x.message); }
    finally { btn.disabled = false; btn.textContent = 'Buscar'; }
  }

  // 2. Elegir cuáles cancelar
  function pintarResultados(d){
    const box = el('bajaResultados'); box.hidden = false;
    const empresa = SESION.empresa ? SESION.empresa.nombre : el('bajaEmpresa').selectedOptions[0].textContent;
    if(!encontradas.length){
      box.innerHTML = `<h3>2. Asistencias activas</h3><div class="notice warn" style="margin:0">No hay asistencias activas para el documento <strong>${esc(docBuscado)}</strong> en ${esc(empresa)}.
        ${d.altas_pendientes ? `Tiene ${d.altas_pendientes} alta(s) pendiente(s) de validación: solo se pueden dar de baja asistencias ya validadas.` : 'Verifique el número.'}</div>`;
      el('bajaDatos').hidden = true; return;
    }
    const t = encontradas[0];
    box.innerHTML = `<h3>2. Elija las asistencias a cancelar</h3>
      <p style="margin:0 0 12px"><strong>${esc(t.titular_nombre)}</strong> · ${esc(t.tipo_doc || 'CC')} ${esc(t.titular_num_doc)}</p>
      ${encontradas.map(a => `<label class="chk ${a.baja_pendiente ? 'off' : ''}">
        <input type="checkbox" value="${a.id}" ${a.baja_pendiente ? 'disabled' : ''}>
        <span><strong>${esc(a.asistencia)} · ${esc(a.plan)}</strong>${a.mascota ? ' — ' + esc(a.mascota) : ''}
          <small>${esc(pesos(a.valor_mensual) || '$0')} mensuales${a.fecha_alta ? ' · activa desde ' + esc(a.fecha_alta) : ''}${a.baja_pendiente ? ' · <b>ya tiene una baja pendiente</b>' : ''}</small></span></label>`).join('')}
      ${d.altas_pendientes ? `<div class="notice info" style="margin:8px 0 0">Además tiene ${d.altas_pendientes} alta(s) pendiente(s) de validación que no aparecen aquí.</div>` : ''}
      <div class="msg" id="bajaSelMsg"></div>`;
    const libres = encontradas.filter(a => !a.baja_pendiente).length;
    if(!libres) box.insertAdjacentHTML('beforeend', '<div class="notice info" style="margin:8px 0 0">Todas sus asistencias ya tienen una baja pendiente de validación. No hay nada más que enviar.</div>');
    el('bajaDatos').hidden = !libres; actualizarTotal();
  }
  function elegidas(){ return [...el('bajaResultados').querySelectorAll('input[type=checkbox]:checked')].map(i => +i.value); }
  function actualizarTotal(){
    const ids = elegidas(), v = encontradas.filter(a => ids.includes(a.id)).reduce((s, a) => s + (a.valor_mensual || 0), 0);
    el('bajaTotal').textContent = ids.length ? `${ids.length} asistencia${ids.length > 1 ? 's' : ''} · deja de pagar ${pesos(v) || '$0'} al mes` : 'Seleccione al menos una asistencia';
    el('bajaTotal').className = 'total ' + (ids.length ? 'ok' : '');
  }
  el('bajaResultados').addEventListener('change', () => { actualizarTotal(); const m = el('bajaSelMsg'); if(m) m.textContent = ''; });

  el('btnBuscarBaja').addEventListener('click', buscar);
  el('bajaDocumento').addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); buscar(); } });
  el('bajaDocumento').addEventListener('input', e => {
    e.target.value = e.target.value.replace(/[^0-9A-Za-z]/g, '');
    if(e.target.value !== docBuscado){ el('bajaResultados').hidden = true; el('bajaDatos').hidden = true; }
  });
  el('bajaEmpresa').addEventListener('change', () => { el('bajaResultados').hidden = true; el('bajaDatos').hidden = true; limpiarErrores(); });

  function limpiar(){
    el('bajaDocumento').value = ''; el('bajaMotivo').value = ''; encontradas = []; docBuscado = '';
    el('bajaResultados').hidden = true; el('bajaDatos').hidden = true; limpiarErrores();
  }
  el('btnLimpiarBaja').addEventListener('click', () => { limpiar(); el('bajaOk').hidden = true; el('bajaDocumento').focus(); });

  // 3. Enviar: llega a la base de solicitudes como "baja", pendiente de validación
  el('formBajas').addEventListener('submit', async e => {
    e.preventDefault(); limpiarErrores();
    const ids = elegidas();
    if(!ids.length){ el('bajaSelMsg').textContent = 'Seleccione al menos una asistencia.'; return; }
    if(el('bajaAsesor').value.trim().length < 3) return marcar('bajaAsesor', 'Escriba el nombre de quien reporta la baja.');
    const btn = el('btnEnviarBaja'); btn.disabled = true; btn.textContent = 'Registrando…';
    try{
      const r = await fetch('/api/baja', { method:'POST', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ empresa_id: empresaBaja(), titular_num_doc: docBuscado, consolidado_ids: ids,
          asesor: el('bajaAsesor').value.trim(), motivo: el('bajaMotivo').value.trim() }) });
      const d = await r.json().catch(() => ({}));
      if(r.status === 401) throw new Error('Su sesión terminó. Ingrese de nuevo.');
      if(!r.ok) throw new Error(d.error || 'No se pudo registrar la baja.');
      const nombres = encontradas.filter(a => ids.includes(a.id)).map(a => a.asistencia + ' ' + a.plan).join(', ');
      el('bajaOk').innerHTML = `<strong>Baja registrada y pendiente de validación.</strong> ${esc(encontradas[0].titular_nombre)} (${esc(docBuscado)}): ${esc(nombres)}.
        <a href="${['empresa_admin','empresa_usuario'].includes(SESION.usuario.rol) ? '/portal' : '/admin'}">Ver en el panel</a>`;
      el('bajaOk').hidden = false; limpiar(); toast('Solicitud de baja registrada.'); window.scrollTo(0, 0);
    } catch(x){ toast(x.message === 'Failed to fetch' ? 'Sin conexión. Intente de nuevo.' : x.message); }
    finally { btn.disabled = false; btn.textContent = 'Registrar baja'; }
  });

  // Arranque: cuando la sesión está lista
  document.addEventListener('sesion-lista', () => {
    if(!SESION.empresa){
      el('bajaEmpresaWrap').hidden = false;
      el('bajaEmpresa').innerHTML = '<option value="">Seleccione la empresa</option>' +
        (SESION.empresas || []).map(x => `<option value="${x.id}">${esc(x.nombre)} (NIT ${esc(x.nit)})</option>`).join('');
      const q = new URLSearchParams(location.search).get('empresa_id'); if(q) el('bajaEmpresa').value = q;
    }
    el('bajaAsesor').value = SESION.usuario.nombre;
    const q = new URLSearchParams(location.search);
    if(q.get('modulo') === 'bajas'){
      cambiarModulo('bajas');
      if(q.get('doc')){ el('bajaDocumento').value = q.get('doc').replace(/[^0-9A-Za-z]/g, ''); buscar(); }
    }
  });
})();