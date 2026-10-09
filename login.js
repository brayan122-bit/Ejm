const $ = s => document.querySelector(s);

// Solo se permite volver a una ruta de este mismo sitio.
function destino(rol) {
  const n = new URLSearchParams(location.search).get('next') || '';
  if (/^\/(?!\/)[\w\-./?=&%]*$/.test(n) && !n.startsWith('/login')) return n;
  // Roles de empresa van al portal; roles internos van al panel de administración
  return ['empresa_admin', 'empresa_usuario'].includes(rol) ? '/portal' : '/admin';
}

fetch('/api/sesion').then(r => r.ok ? r.json() : null).then(d => { if (d && d.usuario) location.replace(destino(d.usuario.rol)); }).catch(() => {});

$('#form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#btn'), err = $('#err');
  err.hidden = true; btn.disabled = true; btn.textContent = 'Verificando…';
  try {
    const payload = { email: $('#email').value.trim(), clave: $('#clave').value };
    const mfaVal = $('#mfaCodigo') ? $('#mfaCodigo').value.trim() : '';
    if (mfaVal) {
      if (/^\d{6}$/.test(mfaVal)) payload.totp = mfaVal;
      else payload.codigo_recuperacion = mfaVal;
    }
    const r = await fetch('/api/sesion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'No se pudo ingresar.');

    if (d.mfa_requerido) {
      $('#fMfa').hidden = false;
      $('#mfaCodigo').focus();
      btn.disabled = false;
      btn.textContent = 'Verificar código';
      return;
    }

    location.replace(destino(d.rol));
  } catch (x) {
    err.textContent = x.message === 'Failed to fetch' ? 'Sin conexión. Intente de nuevo.' : x.message;
    err.hidden = false;
    btn.disabled = false;
    btn.textContent = $('#fMfa') && !$('#fMfa').hidden ? 'Verificar código' : 'Ingresar';
    if ($('#fMfa') && !$('#fMfa').hidden) $('#mfaCodigo').select();
    else $('#clave').select();
  }
});

// Alternar entre login y solicitar acceso
$('#btnSolicitar').addEventListener('click', () => {
  $('#form').hidden = true;
  $('#formSolicitar').hidden = false;
  $('#sEmail').focus();
});

$('#btnVolver').addEventListener('click', () => {
  $('#formSolicitar').hidden = true;
  $('#form').hidden = false;
});

// Envío de solicitud de acceso
$('#formSolicitar').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#sBtnEnviar'), sErr = $('#sErr'), sOk = $('#sOk');
  sErr.hidden = true;
  sOk.hidden = true;
  btn.disabled = true;
  btn.textContent = 'Enviando…';
  try {
    const r = await fetch('/api/sesion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accion: 'solicitar_acceso',
        email: $('#sEmail').value.trim(),
        nombre: $('#sNombre').value.trim(),
        clave: $('#sClave').value
      })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'No se pudo enviar la solicitud.');
    sOk.textContent = d.mensaje || 'Solicitud enviada.';
    sOk.hidden = false;
    btn.textContent = 'Enviado';
  } catch (x) {
    sErr.textContent = x.message === 'Failed to fetch' ? 'Sin conexión. Intente de nuevo.' : x.message;
    sErr.hidden = false;
    btn.disabled = false;
    btn.textContent = 'Enviar solicitud';
  }
});
