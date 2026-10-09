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

// Encabezado con usuario, cambio de contraseña, MFA y salida.
function pintarUsuario(ses, extra = '') {
  const mfaTxt = ses && ses.usuario && ses.usuario.mfa_activo ? '2FA: Activo' : 'Activar 2FA';
  $('#who').innerHTML = `${extra}<span>${esc(ses.usuario.nombre)}</span>
    <button type="button" class="link-w" id="btnClave">Cambiar contraseña</button>
    <button type="button" class="link-w" id="btnMfa">${mfaTxt}</button>
    <button type="button" class="link-w" id="btnSalir">Salir</button>`;
  $('#btnSalir').addEventListener('click', async () => { await fetch('/api/sesion', { method: 'DELETE' }); location.href = '/login'; });
  $('#btnClave').addEventListener('click', abrirCambioClave);
  $('#btnMfa').addEventListener('click', () => abrirMfa(ses));
  if (ses && ses.usuario && ses.usuario.debe_cambiar_clave) {
    setTimeout(() => {
      toast('Debe cambiar su contraseña temporal para continuar.');
      abrirCambioClave();
    }, 500);
  }
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
        <p class="full muted" style="margin:0;font-size:12.5px">Mínimo 12 caracteres, con letras y números.</p>
        <div class="full notice bad" id="cErr" hidden></div></div></div>
      <div class="dlg-f"><button class="btn sec" data-close value="x">Cancelar</button><button class="btn" type="button" id="cOk">Guardar</button></div></form>`;
    document.body.appendChild(d);
    $('#cOk').addEventListener('click', async () => {
      const e = $('#cErr'); e.hidden = true;
      if ($('#cNueva').value !== $('#cNueva2').value) { e.textContent = 'Las contraseñas nuevas no coinciden.'; e.hidden = false; return; }
      try { await api('/api/sesion', { method: 'PUT', body: { actual: $('#cActual').value, nueva: $('#cNueva').value } }); d.close(); toast('Contraseña actualizada.'); }
      catch (x) { e.textContent = x.message; e.hidden = false; }
    });
  }
  d.querySelectorAll('input').forEach(i => i.value = ''); $('#cErr').hidden = true; d.showModal();
}

async function asegurarQRCode() {
  if (window.QRCode) return window.QRCode;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/qrcode.min.js';
    s.onload = () => resolve(window.QRCode);
    s.onerror = () => reject(new Error('No se pudo cargar la librería QR local.'));
    document.head.appendChild(s);
  });
}

function abrirMfa(ses) {
  let d = $('#dlgMfa');
  if (!d) {
    d = document.createElement('dialog');
    d.id = 'dlgMfa';
    d.innerHTML = `<form method="dialog" id="fMfaConfig">
      <div class="dlg-h"><h3>Autenticación en dos pasos (2FA)</h3><button class="x" value="x" aria-label="Cerrar">×</button></div>
      <div class="dlg-b" id="mfaBody"></div>
      <div class="dlg-f" id="mfaFooter"></div></form>`;
    document.body.appendChild(d);
  }
  const body = $('#mfaBody');
  const foot = $('#mfaFooter');

  if (ses && ses.usuario && ses.usuario.mfa_activo) {
    body.innerHTML = `
      <div class="notice ok" style="margin-bottom:12px">2FA está actualmente <strong>activado</strong> en su cuenta.</div>
      <p class="muted" style="font-size:13px">Si desea desactivarlo, confirme su contraseña actual:</p>
      <div><label for="mfaClaveDesactivar">Contraseña actual</label><input type="password" id="mfaClaveDesactivar" autocomplete="current-password"></div>
      <div class="notice bad" id="mfaErr" hidden style="margin-top:10px"></div>
    `;
    foot.innerHTML = `
      <button class="btn sec" data-close value="x">Cerrar</button>
      <button class="btn" type="button" id="mfaBtnDesactivar" style="background:var(--red)">Desactivar 2FA</button>
    `;
    $('#mfaBtnDesactivar').onclick = async () => {
      const err = $('#mfaErr'); err.hidden = true;
      const clave = $('#mfaClaveDesactivar').value;
      if (!clave) { err.textContent = 'Ingrese su contraseña.'; err.hidden = false; return; }
      try {
        await api('/api/sesion', { method: 'POST', body: { accion: 'mfa_desactivar', clave } });
        ses.usuario.mfa_activo = false;
        d.close();
        toast('Autenticación en dos pasos desactivada.');
        pintarUsuario(ses);
      } catch (x) {
        err.textContent = x.message; err.hidden = false;
      }
    };
    d.showModal();
    return;
  }

  body.innerHTML = `<p class="muted" style="margin:20px 0;text-align:center">Iniciando configuración de 2FA…</p>`;
  foot.innerHTML = `<button class="btn sec" data-close value="x">Cancelar</button>`;
  d.showModal();

  api('/api/sesion', { method: 'POST', body: { accion: 'mfa_configurar' } })
    .then(async data => {
      try { await asegurarQRCode(); } catch (_) {}
      body.innerHTML = `
        <div class="grid2">
          <div class="full">
            <p style="margin:0 0 10px;font-size:13px">1. Escanee este código QR con Google Authenticator, Microsoft Authenticator o 1Password:</p>
            <div id="mfaQr" style="display:flex;justify-content:center;background:#fff;padding:12px;border-radius:6px;width:fit-content;margin:0 auto 12px;border:1px solid var(--line)"></div>
          </div>
          <div class="full">
            <label for="mfaSecretoTxt">O ingrese esta clave secreta manualmente:</label>
            <div style="display:flex;gap:6px">
              <input type="text" id="mfaSecretoTxt" readonly value="${esc(data.secreto)}" style="font-family:monospace;letter-spacing:1px;font-size:13px">
              <button class="btn sec" type="button" id="mfaCopiarSecreto" style="white-space:nowrap">Copiar</button>
            </div>
          </div>
          <div class="full" style="margin-top:8px">
            <label for="mfaCodConf">2. Ingrese el código de 6 dígitos que muestra su aplicación:</label>
            <input type="text" id="mfaCodConf" maxlength="6" placeholder="000000" inputmode="numeric" autocomplete="one-time-code" style="font-size:16px;letter-spacing:4px;text-align:center;font-weight:600">
          </div>
          <div class="full" style="margin-top:6px">
            <label>3. Códigos de recuperación (guárdelos en un lugar seguro):</label>
            <div style="background:var(--surface);padding:8px 10px;border-radius:6px;font-family:monospace;font-size:12px;line-height:1.6;user-select:all;border:1px solid var(--line)" id="mfaCodigosBox">
              ${esc((data.codigos || []).join('   '))}
            </div>
          </div>
          <div class="full notice bad" id="mfaErr" hidden style="margin-top:8px"></div>
        </div>
      `;
      if (window.QRCode && $('#mfaQr')) {
        new window.QRCode($('#mfaQr'), { text: data.uri, width: 160, height: 160 });
      }
      $('#mfaCopiarSecreto').onclick = () => {
        navigator.clipboard.writeText(data.secreto).then(() => toast('Clave copiada')).catch(() => {});
      };
      foot.innerHTML = `
        <button class="btn sec" data-close value="x">Cancelar</button>
        <button class="btn" type="button" id="mfaBtnConfirmar">Activar 2FA</button>
      `;
      $('#mfaBtnConfirmar').onclick = async () => {
        const err = $('#mfaErr'); err.hidden = true;
        const codigo = $('#mfaCodConf').value.trim();
        if (!/^\d{6}$/.test(codigo)) {
          err.textContent = 'Ingrese el código numérico de 6 dígitos.'; err.hidden = false; return;
        }
        try {
          await api('/api/sesion', {
            method: 'POST',
            body: {
              accion: 'mfa_confirmar',
              secreto: data.secreto,
              codigo,
              codigos: data.codigos
            }
          });
          ses.usuario.mfa_activo = true;
          d.close();
          toast('Autenticación en dos pasos activada.');
          pintarUsuario(ses);
        } catch (x) {
          err.textContent = x.message; err.hidden = false;
        }
      };
    })
    .catch(x => {
      body.innerHTML = `<div class="notice bad">${esc(x.message || 'No se pudo iniciar configuración de 2FA.')}</div>`;
    });
}

// Delegación global para cerrar diálogos (solo data-close y button.x)
document.addEventListener('click', e => {
  const btn = e.target.closest('dialog button.x, dialog [data-close]');
  if (btn) {
    const dlg = btn.closest('dialog');
    if (dlg) dlg.close();
  }
});

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
