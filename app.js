// Utilidades compartidas por el portal de empresa y la administración.
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pesos = v => '$' + (Number(v) || 0).toLocaleString('es-CO');
const numero = v => (Number(v) || 0).toLocaleString('es-CO');
const fechaHora = iso => iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '';
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombreMes = p => { const [a, m] = String(p).split('-'); return `${MESES[+m - 1] || ''} ${a}`; };
const ESTADOS = { pendiente: 'Pendiente', valida: 'Válida', invalida: 'Inválida' };

function toast(msg) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3800);
}

// Llamada a la API. Si la sesión terminó, lleva al ingreso.
async function api(ruta, { method = 'GET', body } = {}) {
  const r = await fetch(ruta, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) { location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search); throw new Error('Sesión terminada'); }
  if (!r.ok) { const e = new Error(d.error || 'Error del servidor'); e.datos = d; throw e; }
  return d;
}

function descargarCSV(nombre, columnas, filas) {
  const cel = v => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = '\uFEFF' + [columnas.map(c => c[1]).join(';'), ...filas.map(f => columnas.map(c => cel(typeof c[0] === 'function' ? c[0](f) : f[c[0]])).join(';'))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Encabezado con usuario, cambio de contraseña y salida.
function pintarUsuario(ses, extra = '') {
  $('#who').innerHTML = `${extra}<span>${esc(ses.usuario.nombre)}</span>
    <button type="button" class="link-w" id="btnClave">Cambiar contraseña</button>
    <button type="button" class="link-w" id="btnSalir">Salir</button>`;
  $('#btnSalir').onclick = async () => { await fetch('/api/sesion', { method: 'DELETE' }); location.href = '/login'; };
  $('#btnClave').onclick = abrirCambioClave;
}
function abrirCambioClave() {
  let d = $('#dlgClave');
  if (!d) {
    d = document.createElement('dialog'); d.id = 'dlgClave';
    d.innerHTML = `<form method="dialog" id="fClave">
      <div class="dlg-h"><h3>Cambiar contraseña</h3><button class="x" value="x" aria-label="Cerrar">×</button></div>
      <div class="dlg-b"><div class="grid2">
        <div class="full"><label for="cActual">Contraseña actual</label><input type="password" id="cActual" autocomplete="current-password"></div>
        <div><label for="cNueva">Nueva contraseña</label><input type="password" id="cNueva" autocomplete="new-password"></div>
        <div><label for="cNueva2">Repita la nueva</label><input type="password" id="cNueva2" autocomplete="new-password"></div>
        <p class="full muted" style="margin:0;font-size:12.5px">Mínimo 10 caracteres, con letras y números.</p>
        <div class="full notice bad" id="cErr" hidden></div></div></div>
      <div class="dlg-f"><button class="btn sec" value="x">Cancelar</button><button class="btn" type="button" id="cOk">Guardar</button></div></form>`;
    document.body.appendChild(d);
    $('#cOk').onclick = async () => {
      const e = $('#cErr'); e.hidden = true;
      if ($('#cNueva').value !== $('#cNueva2').value) { e.textContent = 'Las contraseñas nuevas no coinciden.'; e.hidden = false; return; }
      try { await api('/api/sesion', { method: 'PUT', body: { actual: $('#cActual').value, nueva: $('#cNueva').value } }); d.close(); toast('Contraseña actualizada.'); }
      catch (x) { e.textContent = x.message; e.hidden = false; }
    };
  }
  d.querySelectorAll('input').forEach(i => i.value = ''); $('#cErr').hidden = true; d.showModal();
}

// Lee un CSV (separado por ; o ,) con encabezados. Devuelve arreglo de objetos.
function leerCSV(texto) {
  texto = texto.replace(/^\uFEFF/, '');
  const sep = (texto.split(/\r?\n/)[0].match(/;/g) || []).length >= (texto.split(/\r?\n/)[0].match(/,/g) || []).length ? ';' : ',';
  const filas = []; let fila = [], cel = '', q = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (q) { if (c === '"') { if (texto[i + 1] === '"') { cel += '"'; i++; } else q = false; } else cel += c; }
    else if (c === '"') q = true;
    else if (c === sep) { fila.push(cel); cel = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && texto[i + 1] === '\n') i++; fila.push(cel); filas.push(fila); fila = []; cel = ''; }
    else cel += c;
  }
  if (cel !== '' || fila.length) { fila.push(cel); filas.push(fila); }
  const limpias = filas.filter(f => f.some(x => String(x).trim() !== ''));
  if (!limpias.length) return [];
  const norm = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_');
  const cab = limpias[0].map(norm);
  return limpias.slice(1).map(f => Object.fromEntries(cab.map((k, i) => [k, (f[i] ?? '').trim()])));
}
