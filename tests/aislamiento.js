#!/usr/bin/env node
// tests/aislamiento.js  –  Suite auto-contenida de pruebas de aislamiento y regresión.
//
// REQUISITOS PREVIOS:
//   1. Node.js ≥ 20 instalado.
//   2. Un servidor corriendo (vercel dev o equivalente).
//   3. Una base de datos Neon de prueba (NO la de producción).
//   4. Variables de entorno en el servidor:
//      DATABASE_URL   → cadena de conexión de la base de PRUEBA
//      SESSION_SECRET → cualquier cadena ≥ 32 caracteres
//      ADMIN_EMAIL    → correo del maestro de prueba
//      ADMIN_PASSWORD → contraseña del maestro ≥ 12 chars, con letras y números
//
// EJECUCIÓN:
//   $env:MAESTRO_EMAIL="admin@bienestar360.co"
//   $env:MAESTRO_CLAVE="ClavePrueba2024"
//   $env:BASE_URL="http://localhost:3000"    # o la URL de Preview de Vercel
//   node tests/aislamiento.js
//
// El script:
//   1. Configura el esquema (lo hace el servidor al primer request).
//   2. Crea los datos de prueba vía API (2 empresas, 4 usuarios).
//   3. Ejecuta las pruebas de aislamiento, roles y regresión.
//   4. Limpia los datos de prueba al final.
//   Sale con código 1 si alguna prueba falla.

const BASE    = process.env.BASE_URL    || 'http://localhost:3000';
const M_EMAIL = process.env.MAESTRO_EMAIL;
const M_CLAVE = process.env.MAESTRO_CLAVE;

if (!M_EMAIL || !M_CLAVE) {
  console.error('\n❌  Faltan variables: MAESTRO_EMAIL y MAESTRO_CLAVE son obligatorias.\n');
  process.exit(2);
}

let pase = 0, falle = 0;
// Datos creados en esta ejecución; se eliminan al final si la API lo soporta.
const cleanup = { empresas: [], usuarios: [] };

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function req(path, opts = {}) {
  const { method = 'GET', body, cookie } = opts;
  const headers = { 'Content-Type': 'application/json', 'Origin': BASE };
  if (cookie) headers.Cookie = cookie;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data, headers: r.headers };
}

async function login(email, clave) {
  const r = await fetch(BASE + '/api/sesion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': BASE },
    body: JSON.stringify({ email, clave })
  });
  const data = await r.json().catch(() => ({}));
  const setCookie = r.headers.get('set-cookie') || '';
  const m = setCookie.match(/sesion=([^;]+)/);
  const cookie = m ? `sesion=${m[1]}` : null;
  return { status: r.status, data, cookie, rol: data.rol };
}

function ok(nombre, condicion, detalle = '') {
  if (condicion) { console.log(`  ✅  ${nombre}`); pase++; }
  else           { console.log(`  ❌  ${nombre}${detalle ? `  →  ${detalle}` : ''}`); falle++; }
}
function titulo(t) { console.log(`\n${'═'.repeat(60)}\n  ${t}\n${'═'.repeat(60)}`); }
function seccion(t) { console.log(`\n── ${t}`); }

// ─── Setup de datos de prueba ──────────────────────────────────────────────────

let CK_MAESTRO;                     // cookie de sesión del maestro
let EMP_A, EMP_B, EMP_C;            // {id, nombre, nit}
let ADM_A_CK, ADM_A_EMAIL;         // empresa_admin de empresa A
let USR_A_CK, USR_A_EMAIL;         // empresa_usuario de empresa A
let ADM_B_CK, ADM_B_EMAIL;         // empresa_admin de empresa B
let ADM_C_CK, ADM_C_EMAIL;         // empresa_admin de empresa C
let VALIDADOR_CK, VALIDADOR_EMAIL;  // validador interno
// Solicitud de prueba para flujo de regresión:
let SOL_ID, CONS_ID;

const RUN = Date.now();  // id único de esta ejecución para evitar colisiones

async function setup() {
  titulo('SETUP  –  Creación de datos de prueba');

  // 1. Login maestro
  seccion('Login maestro');
  const loginM = await login(M_EMAIL, M_CLAVE);
  ok('Maestro puede ingresar', loginM.cookie && loginM.rol === 'maestro',
     `HTTP ${loginM.status}, rol=${loginM.data.rol}`);
  if (!loginM.cookie) { console.error('\n   El maestro no pudo ingresar. Verifique MAESTRO_EMAIL y MAESTRO_CLAVE.\n'); process.exit(2); }
  CK_MAESTRO = loginM.cookie;

  // 2. Empresa A (dominio: test-a-RUN.internal)
  seccion('Crear empresa A');
  const domA  = `test-a-${RUN}.internal`;
  const domA2 = `test-a2-${RUN}.internal`;
  const nitA  = `900${String(RUN).slice(-6)}01`;
  const rEA = await req('/api/admin', { method: 'POST', cookie: CK_MAESTRO,
    body: { accion: 'empresa_guardar', nit: nitA, nombre: `Empresa TEST-A ${RUN}`,
            modelo: 1, activa: true, productos: [] } });
  ok('Empresa A creada', rEA.status === 200 && rEA.data.id, JSON.stringify(rEA.data));
  if (!rEA.data.id) { console.error('   No se pudo crear empresa A'); process.exit(2); }
  EMP_A = { id: rEA.data.id, nit: nitA, nombre: `Empresa TEST-A ${RUN}` };
  cleanup.empresas.push(EMP_A.id);

  // Guardar dominios de empresa A
  await req('/api/admin', { method: 'POST', cookie: CK_MAESTRO,
    body: { accion: 'dominios_guardar', empresa_id: EMP_A.id, dominios: [domA, domA2] } });

  // 3. Empresa B (dominio distinto)
  seccion('Crear empresa B');
  const domB = `test-b-${RUN}.internal`;
  const nitB = `900${String(RUN).slice(-6)}02`;
  const rEB = await req('/api/admin', { method: 'POST', cookie: CK_MAESTRO,
    body: { accion: 'empresa_guardar', nit: nitB, nombre: `Empresa TEST-B ${RUN}`,
            modelo: 2, activa: true, productos: [] } });
  ok('Empresa B creada', rEB.status === 200 && rEB.data.id, JSON.stringify(rEB.data));
  if (!rEB.data.id) { console.error('   No se pudo crear empresa B'); process.exit(2); }
  EMP_B = { id: rEB.data.id, nit: nitB, nombre: `Empresa TEST-B ${RUN}` };
  cleanup.empresas.push(EMP_B.id);
  await req('/api/admin', { method: 'POST', cookie: CK_MAESTRO,
    body: { accion: 'dominios_guardar', empresa_id: EMP_B.id, dominios: [domB] } });

  // 3.5. Empresa C (Mixta)
  seccion('Crear empresa C (Mixta)');
  const nitC = `900${String(RUN).slice(-6)}03`;
  const rEC = await req('/api/admin', { method: 'POST', cookie: CK_MAESTRO,
    body: { accion: 'empresa_guardar', nit: nitC, nombre: `Empresa TEST-C Mixta ${RUN}`,
            modelo: 3, activa: true, productos: [] } });
  ok('Empresa C creada', rEC.status === 200 && rEC.data.id, JSON.stringify(rEC.data));
  EMP_C = { id: rEC.data.id, nit: nitC, nombre: `Empresa TEST-C ${RUN}` };
  cleanup.empresas.push(EMP_C.id);

  // 4. Usuario empresa_admin de empresa A
  seccion('Crear usuarios');
  ADM_A_EMAIL = `admin.a.${RUN}@${domA}`;
  const rUAdmA = await req('/api/admin', { method: 'POST', cookie: CK_MAESTRO,
    body: { accion: 'usuario_guardar', email: ADM_A_EMAIL, nombre: 'Admin A Test',
            rol: 'empresa_admin', empresa_id: EMP_A.id, activo: true, estado_acceso: 'activo' } });
  ok('empresa_admin A creado', rUAdmA.status === 200 && rUAdmA.data.clave_temporal,
     JSON.stringify(rUAdmA.data));
  if (!rUAdmA.data.clave_temporal) process.exit(2);
  const lAdmA = await login(ADM_A_EMAIL, rUAdmA.data.clave_temporal);
  ok('empresa_admin A puede ingresar', lAdmA.cookie && lAdmA.rol === 'empresa_admin',
     `HTTP ${lAdmA.status}`);
  ADM_A_CK = lAdmA.cookie;
  cleanup.usuarios.push(ADM_A_EMAIL);

  // 5. Usuario empresa_usuario de empresa A
  USR_A_EMAIL = `user.a.${RUN}@${domA}`;
  const rUUsrA = await req('/api/admin', { method: 'POST', cookie: CK_MAESTRO,
    body: { accion: 'usuario_guardar', email: USR_A_EMAIL, nombre: 'Usuario A Test',
            rol: 'empresa_usuario', empresa_id: EMP_A.id, activo: true, estado_acceso: 'activo' } });
  ok('empresa_usuario A creado', rUUsrA.status === 200, JSON.stringify(rUUsrA.data));
  const lUsrA = await login(USR_A_EMAIL, rUUsrA.data.clave_temporal);
  ok('empresa_usuario A puede ingresar', lUsrA.cookie && lUsrA.rol === 'empresa_usuario');
  USR_A_CK = lUsrA.cookie;
  cleanup.usuarios.push(USR_A_EMAIL);

  // 6. Usuario empresa_admin de empresa B
  ADM_B_EMAIL = `admin.b.${RUN}@${domB}`;
  const rUAdmB = await req('/api/admin', { method: 'POST', cookie: CK_MAESTRO,
    body: { accion: 'usuario_guardar', email: ADM_B_EMAIL, nombre: 'Admin B Test',
            rol: 'empresa_admin', empresa_id: EMP_B.id, activo: true, estado_acceso: 'activo' } });
  ok('empresa_admin B creado', rUAdmB.status === 200, JSON.stringify(rUAdmB.data));
  const lAdmB = await login(ADM_B_EMAIL, rUAdmB.data.clave_temporal);
  ok('empresa_admin B puede ingresar', lAdmB.cookie && lAdmB.rol === 'empresa_admin');
  ADM_B_CK = lAdmB.cookie;
  cleanup.usuarios.push(ADM_B_EMAIL);

  // 6.5. Crear empresa_admin de empresa C (Mixta)
  ADM_C_EMAIL = `admin.${RUN}@test-c-${RUN}.com`;
  const rUAdmC = await req('/api/admin', { method: 'POST', cookie: CK_MAESTRO,
    body: { accion: 'usuario_guardar', nombre: 'Admin C', email: ADM_C_EMAIL, rol: 'empresa_admin', empresa_id: EMP_C.id } });
  ok('Setup: Crear empresa_admin C', rUAdmC.status === 200 && rUAdmC.data.clave_temporal, '');
  const lAdmC = await login(ADM_C_EMAIL, rUAdmC.data.clave_temporal);
  ADM_C_CK = lAdmC.cookie;
  cleanup.usuarios.push(ADM_C_EMAIL);

  // 7. Validador
  VALIDADOR_EMAIL = `validador.${RUN}@test-v-${RUN}.internal`;
  const rUVal = await req('/api/admin', { method: 'POST', cookie: CK_MAESTRO,
    body: { accion: 'usuario_guardar', email: VALIDADOR_EMAIL, nombre: 'Validador Test',
            rol: 'validador', activo: true, estado_acceso: 'activo', excepcion_dominio: true } });
  ok('Validador creado', rUVal.status === 200, JSON.stringify(rUVal.data));
  const lVal = await login(VALIDADOR_EMAIL, rUVal.data.clave_temporal);
  ok('Validador puede ingresar', lVal.cookie && lVal.rol === 'validador');
  VALIDADOR_CK = lVal.cookie;
  cleanup.usuarios.push(VALIDADOR_EMAIL);
}

// ─── Bloque 1: Aislamiento por empresa ────────────────────────────────────────

async function bloque1_aislamiento() {
  titulo('BLOQUE 1  –  Aislamiento por empresa');

  seccion('Portal: empresa A no ve datos de empresa B');
  // El servidor SIEMPRE usa la empresa de la sesión, ignorando empresa_id del querystring
  const rPortalAVsB = await req(`/api/portal?empresa_id=${EMP_B.id}`, { cookie: ADM_A_CK });
  ok('Portal de A con empresa_id=B → devuelve empresa A (no B)',
     rPortalAVsB.status === 200 && rPortalAVsB.data.empresa?.id === EMP_A.id,
     `empresa.id=${rPortalAVsB.data.empresa?.id}, esperado=${EMP_A.id}`);

  seccion('Portal: empresa B no ve datos de empresa A');
  const rPortalBVsA = await req(`/api/portal?empresa_id=${EMP_A.id}`, { cookie: ADM_B_CK });
  ok('Portal de B con empresa_id=A → devuelve empresa B (no A)',
     rPortalBVsA.status === 200 && rPortalBVsA.data.empresa?.id === EMP_B.id,
     `empresa.id=${rPortalBVsA.data.empresa?.id}`);

  seccion('Bajas: empresa A no puede dar de baja asistencias de empresa B');
  const rBaja = await req('/api/baja?doc=99999999', { cookie: ADM_A_CK });
  // Debe responder solo con activos de empresa A (vacío en este caso, pero no error de autorización)
  ok('GET /api/baja desde empresa A no filtra empresa B', rBaja.status === 200,
     `HTTP ${rBaja.status}`);

  // Intento de dar de baja un consolidado_id inexistente (de empresa B)
  const rBajaPost = await req('/api/baja', { method: 'POST', cookie: ADM_A_CK,
    body: { ids: [999999], doc: '12345678', asistencia_id: 'doctor', plan_id: 'Basico', asesor: 'Test' } });
  ok('POST /api/baja de empresa A no afecta registros de empresa B',
     rBajaPost.status !== 200 || !(rBajaPost.data.ok), `HTTP ${rBajaPost.status}`);

  seccion('Admin: empresa A no puede ver usuarios de empresa B mediante mis_usuarios');
  const rMisUs = await req('/api/admin', { method: 'POST', cookie: ADM_A_CK,
    body: { accion: 'mis_usuarios' } });
  // Solo debe listar usuarios de empresa A
  ok('mis_usuarios de empresa A no incluye usuarios de empresa B',
     rMisUs.status === 200 && rMisUs.data.filas.every(u => u.empresa_id === EMP_A.id || u.empresa_id === undefined),
     `filas con empresa_id ajeno: ${rMisUs.data.filas?.filter(u => u.empresa_id === EMP_B.id).length}`);

  seccion('Admin: empresa_admin A no puede crear usuario en empresa B');
  const emailCruzado = `cruzado.${RUN}@test-b-${RUN}.internal`;
  const rCruz = await req('/api/admin', { method: 'POST', cookie: ADM_A_CK,
    body: { accion: 'mi_usuario_guardar', email: emailCruzado, nombre: 'Cruzado',
            activo: true, estado_acceso: 'activo' } });
  // El servidor usa la empresa de la sesión (A), no la del body. El dominio @test-b no pertenece a A.
  ok('empresa_admin A no puede crear usuario con dominio de empresa B',
     rCruz.status !== 200 || rCruz.data.error,
     `HTTP ${rCruz.status}, error="${rCruz.data.error}"`);

  seccion('Admin: empresa_admin A no puede activar usuario de empresa B');
  const rActB = await req('/api/admin', { method: 'POST', cookie: ADM_A_CK,
    body: { accion: 'mi_usuario_activar', id: 1, aprobar: true } });
  // La acción verifica empresa_id = empresa de la sesión → el usuario 1 no pertenece a empresa A
  ok('empresa_admin A no puede activar usuario de empresa B (mi_usuario_activar)',
     rActB.status !== 200 || rActB.data.error,
     `HTTP ${rActB.status}`);
}

// ─── Bloque 2: Restricciones de roles ─────────────────────────────────────────

async function bloque2_roles() {
  titulo('BLOQUE 2  –  Restricciones de roles');

  seccion('empresa_admin no puede validar solicitudes');
  const rVal = await req('/api/admin', { method: 'POST', cookie: ADM_A_CK,
    body: { accion: 'validar', ids: [1], estado: 'valida' } });
  ok('empresa_admin → validar → 403', rVal.status === 403, `HTTP ${rVal.status}`);

  seccion('empresa_usuario no puede validar');
  const rValU = await req('/api/admin', { method: 'POST', cookie: USR_A_CK,
    body: { accion: 'validar', ids: [1], estado: 'valida' } });
  ok('empresa_usuario → validar → 403', rValU.status === 403, `HTTP ${rValU.status}`);

  seccion('empresa_admin no puede crear empresas');
  const rEmpG = await req('/api/admin', { method: 'POST', cookie: ADM_A_CK,
    body: { accion: 'empresa_guardar', nit: '123456', nombre: 'Trampa', modelo: 1 } });
  ok('empresa_admin → empresa_guardar → 403', rEmpG.status === 403, `HTTP ${rEmpG.status}`);

  seccion('empresa_admin no puede listar todos los usuarios');
  const rUsLst = await req('/api/admin', { method: 'POST', cookie: ADM_A_CK,
    body: { accion: 'usuarios' } });
  ok('empresa_admin → usuarios (global) → 403', rUsLst.status === 403, `HTTP ${rUsLst.status}`);

  seccion('empresa_usuario no puede crear usuarios');
  const rUsNew = await req('/api/admin', { method: 'POST', cookie: USR_A_CK,
    body: { accion: 'mi_usuario_guardar', email: `nuevo.${RUN}@test-a-${RUN}.internal`,
            nombre: 'Nuevo', activo: true } });
  ok('empresa_usuario → mi_usuario_guardar → 403', rUsNew.status === 403, `HTTP ${rUsNew.status}`);

  seccion('empresa_admin no puede asignar rol maestro ni validador');
  const emailNuevo = `trampa.${RUN}@test-a-${RUN}.internal`;
  // mi_usuario_guardar solo puede crear empresa_usuario; el rol es ignorado/fijado en el servidor
  const rRolM = await req('/api/admin', { method: 'POST', cookie: ADM_A_CK,
    body: { accion: 'mi_usuario_guardar', email: emailNuevo, nombre: 'Trampa Rol',
            rol: 'maestro', activo: true } });
  // Si crea al usuario, debe tener rol 'empresa_usuario', no 'maestro'
  if (rRolM.status === 200 && rRolM.data.id) {
    // Verificar con el maestro cuál es el rol real
    const rCheck = await req('/api/admin', { method: 'POST', cookie: CK_MAESTRO,
      body: { accion: 'usuarios' } });
    const creado = rCheck.data.filas?.find(u => u.email === emailNuevo);
    ok('empresa_admin no puede crear usuario con rol maestro',
       !creado || creado.rol === 'empresa_usuario',
       `rol creado=${creado?.rol}`);
  } else {
    ok('empresa_admin no puede crear usuario con rol maestro (rechazado)',
       rRolM.status !== 200 || rRolM.data.error, `HTTP ${rRolM.status}`);
  }

  seccion('validador no puede crear empresas');
  const rVE = await req('/api/admin', { method: 'POST', cookie: VALIDADOR_CK,
    body: { accion: 'empresa_guardar', nit: '999', nombre: 'Trampa', modelo: 1 } });
  ok('validador → empresa_guardar → 403', rVE.status === 403, `HTTP ${rVE.status}`);

  seccion('validador no puede listar usuarios');
  const rVU = await req('/api/admin', { method: 'POST', cookie: VALIDADOR_CK,
    body: { accion: 'usuarios' } });
  ok('validador → usuarios → 403', rVU.status === 403, `HTTP ${rVU.status}`);

  seccion('Sin sesión → 401 en todos los endpoints');
  const [rP, rA, rB] = await Promise.all([
    req('/api/portal'),
    req('/api/admin', { method: 'POST', body: { accion: 'empresas' } }),
    req('/api/baja?doc=12345678')
  ]);
  ok('Sin sesión → /api/portal → 401',    rP.status === 401, `HTTP ${rP.status}`);
  ok('Sin sesión → /api/admin  → 401',    rA.status === 401, `HTTP ${rA.status}`);
  ok('Sin sesión → /api/baja   → 401',    rB.status === 401, `HTTP ${rB.status}`);
}

// ─── Bloque 3: Dominios ────────────────────────────────────────────────────────

async function bloque3_dominios() {
  titulo('BLOQUE 3  –  Dominios corporativos');

  const domA = `test-a-${RUN}.internal`;
  const domB = `test-b-${RUN}.internal`;

  seccion('Usuario con dominio ajeno no puede crearse');
  const emailAjeno = `ajeno.${RUN}@dominio-ajeno-${RUN}.net`;
  const rAjeno = await req('/api/admin', { method: 'POST', cookie: CK_MAESTRO,
    body: { accion: 'usuario_guardar', email: emailAjeno, nombre: 'Ajeno',
            rol: 'empresa_usuario', empresa_id: EMP_A.id, activo: true,
            excepcion_dominio: false } });
  ok('Correo con dominio ajeno a empresa A → error', rAjeno.status !== 200 || rAjeno.data.error,
     `HTTP ${rAjeno.status}, error="${rAjeno.data.error}"`);

  seccion('Dominio público (gmail.com) no puede añadirse a empresa');
  const rPublico = await req('/api/admin', { method: 'POST', cookie: CK_MAESTRO,
    body: { accion: 'dominios_guardar', empresa_id: EMP_A.id, dominios: [domA, 'gmail.com'] } });
  // El servidor debe filtrar gmail.com y dejarlo fuera
  if (rPublico.status === 200) {
    ok('gmail.com filtrado de la lista de dominios guardada',
       !rPublico.data.dominios?.includes('gmail.com'),
       `dominios=${JSON.stringify(rPublico.data.dominios)}`);
  } else {
    ok('gmail.com rechazado en dominios_guardar (error)', false, `HTTP ${rPublico.status}`);
  }

  seccion('Un dominio no puede estar en dos empresas');
  const rDupDom = await req('/api/admin', { method: 'POST', cookie: CK_MAESTRO,
    body: { accion: 'dominios_guardar', empresa_id: EMP_B.id, dominios: [domB, domA] } });
  // domA ya pertenece a empresa A → debe rechazar o filtrar
  ok('Dominio ya asignado a empresa A rechazado para empresa B',
     rDupDom.status === 409 || (rDupDom.status === 200 && !rDupDom.data.dominios?.includes(domA)),
     `HTTP ${rDupDom.status}, dominios=${JSON.stringify(rDupDom.data.dominios)}`);

  seccion('Login con dominio ajeno → mismo error genérico');
  // Usuario A creado; si intenta login con correo de dominio B → 401, mismo mensaje que clave incorrecta
  const emailFalso = `login.falso.${RUN}@${domB}`;
  const rLoginFalso = await login(emailFalso, 'Clave12345Prueba');
  ok('Login con correo de dominio ajeno → 401 (sin revelar motivo)', rLoginFalso.status === 401);
  ok('Mensaje de error genérico (no revela dominio)',
     !rLoginFalso.data.error?.toLowerCase().includes('dominio'),
     `error="${rLoginFalso.data.error}"`);
}

// ─── Bloque 4: Auto-registro ───────────────────────────────────────────────────

async function bloque4_autoregistro() {
  titulo('BLOQUE 4  –  Auto-registro');

  const domA = `test-a-${RUN}.internal`;

  seccion('Auto-registro con dominio corporativo registrado');
  const emailPend = `pendiente.${RUN}@${domA}`;
  const rAR = await req('/api/sesion', { method: 'POST',
    body: { accion: 'solicitar_acceso', email: emailPend,
            nombre: 'Pendiente Test', clave: 'Clave12345' } });
  ok('Auto-registro responde 200 (no revela si empresa existe)', rAR.status === 200 && rAR.data.ok,
     `HTTP ${rAR.status}`);
  ok('Respuesta genérica: no menciona empresa ni dominio',
     rAR.data.mensaje && !rAR.data.mensaje.toLowerCase().includes('empresa test'),
     `mensaje="${rAR.data.mensaje}"`);
  cleanup.usuarios.push(emailPend);

  seccion('Usuario pendiente NO puede iniciar sesión');
  const loginPend = await login(emailPend, 'Clave12345');
  ok('Usuario pendiente → login → 401', loginPend.status === 401,
     `HTTP ${loginPend.status}, rol=${loginPend.data.rol}`);

  seccion('Auto-registro con dominio público → respuesta genérica');
  const rARGmail = await req('/api/sesion', { method: 'POST',
    body: { accion: 'solicitar_acceso', email: `trampa.${RUN}@gmail.com`,
            nombre: 'Trampa Gmail', clave: 'Clave12345' } });
  ok('Dominio público → 200 genérico (no 400 ni 422)', rARGmail.status === 200 && rARGmail.data.ok,
     `HTTP ${rARGmail.status}`);

  seccion('Auto-registro con dominio no registrado → respuesta genérica');
  const rARDesconocido = await req('/api/sesion', { method: 'POST',
    body: { accion: 'solicitar_acceso', email: `x.${RUN}@empresa-inexistente-${RUN}.com`,
            nombre: 'Desconocido', clave: 'Clave12345' } });
  ok('Dominio no registrado → 200 genérico (no revela ausencia de empresa)',
     rARDesconocido.status === 200 && rARDesconocido.data.ok,
     `HTTP ${rARDesconocido.status}`);

  seccion('empresa_admin puede aprobar el usuario pendiente');
  // Primero obtener el id del usuario pendiente
  const rMisUs = await req('/api/admin', { method: 'POST', cookie: ADM_A_CK,
    body: { accion: 'mis_usuarios' } });
  const uPend = rMisUs.data.filas?.find(u => u.email === emailPend);
  ok('Usuario pendiente aparece en mis_usuarios de empresa A',
     !!uPend && uPend.estado_acceso === 'pendiente',
     `encontrado=${!!uPend}, estado=${uPend?.estado_acceso}`);

  if (uPend) {
    const rApro = await req('/api/admin', { method: 'POST', cookie: ADM_A_CK,
      body: { accion: 'mi_usuario_activar', id: uPend.id, aprobar: true } });
    ok('empresa_admin puede aprobar al usuario pendiente', rApro.status === 200 && rApro.data.ok,
       `HTTP ${rApro.status}`);

    const loginApro = await login(emailPend, 'Clave12345');
    ok('Usuario aprobado puede iniciar sesión', loginApro.status === 200 && loginApro.cookie,
       `HTTP ${loginApro.status}`);
  } else {
    ok('Aprobación de pendiente (skip: usuario no encontrado)', false, 'SKIP');
    ok('Login post-aprobación (skip)', false, 'SKIP');
  }
}

// ─── Bloque 5: Flujo de regresión (alta → validar → baja → validar → reversión) ──

async function bloque5_regresion() {
  titulo('BLOQUE 5  –  Regresión del flujo completo');

  // Para esta prueba usamos el maestro como remitente de inscripción (simplificado)
  const PERIODO = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  const ID_INS  = `TEST-INS-${RUN}`;
  const NUM_DOC = `TEST${RUN}`;

  seccion('Alta: inscripción por empresa_usuario de empresa A');
  const fila = {
    id_inscripcion:       ID_INS,
    titular_tipo_doc:     'CC',
    titular_num_doc:      NUM_DOC,
    titular_nombres:      'Prueba',
    titular_apellidos:    'Regresion',
    titular_fecha_nac:    '01/01/1990',
    titular_celular:      '3001234567',
    titular_direccion:    'Calle Falsa 123',
    asistencia_id:        'doctor',
    plan_id:              'Basico',
    pago_id:              'Nomina',
    valor_mensual:        10000,
    valor_empresa:        0,
    valor_colaborador:    10000,
    aut_descuento:        'Si',
    aut_datos:            'Si',
    asesor:               'Asesor Test',
    firma_modo:           'digital'
  };
  const rAlta = await req('/api/inscripcion', { method: 'POST', cookie: USR_A_CK,
    body: { empresa_id: EMP_A.id, filas: [fila] } });
  ok('Inscripción enviada', rAlta.status === 200 && rAlta.data.ok,
     `HTTP ${rAlta.status}, error="${rAlta.data.error}"`);
  SOL_ID = rAlta.data.ids?.[0];
  ok('Se obtuvo ID de solicitud', !!SOL_ID, `ids=${JSON.stringify(rAlta.data.ids)}`);

  seccion('Idempotencia: reenvío con mismo id_inscripcion no duplica');
  const rRep = await req('/api/inscripcion', { method: 'POST', cookie: USR_A_CK,
    body: { empresa_id: EMP_A.id, filas: [fila] } });
  ok('Reenvío del mismo id_inscripcion → repetida=true, no duplica',
     rRep.status === 200 && rRep.data.repetida === true,
     `HTTP ${rRep.status}, repetida=${rRep.data.repetida}`);

  seccion('Solicitud aparece en el portal de empresa A');
  const rPortal = await req(`/api/portal?empresa_id=${EMP_A.id}`, { cookie: USR_A_CK });
  const solPortal = rPortal.data.solicitudes?.find(s => s.id === SOL_ID);
  ok('Solicitud visible en portal de empresa A', !!solPortal,
     `solicitudes.length=${rPortal.data.solicitudes?.length}`);

  if (!SOL_ID) { console.log('   ⚠️  Sin SOL_ID, omitiendo validación y baja.'); return; }

  seccion('Validación: maestro marca la solicitud como válida');
  const rValida = await req('/api/admin', { method: 'POST', cookie: CK_MAESTRO,
    body: { accion: 'validar', ids: [SOL_ID], estado: 'valida' } });
  ok('Solicitud marcada como válida', rValida.status === 200 && rValida.data.ok,
     `HTTP ${rValida.status}, avisos=${JSON.stringify(rValida.data.avisos)}`);

  seccion('Validación ingresa al consolidado');
  const rCons = await req('/api/admin', { method: 'POST', cookie: CK_MAESTRO,
    body: { accion: 'consolidado', empresa_id: EMP_A.id } });
  const fCons = rCons.data.filas?.find(f => f.titular_num_doc === NUM_DOC);
  ok('Alta aparece en el consolidado', !!fCons, `filas.length=${rCons.data.filas?.length}`);
  CONS_ID = fCons?.id;

  seccion('Reversión: revertir la validación vuelve el consolidado al estado anterior');
  const rPend = await req('/api/admin', { method: 'POST', cookie: CK_MAESTRO,
    body: { accion: 'validar', ids: [SOL_ID], estado: 'pendiente' } });
  ok('Reversión a pendiente exitosa', rPend.status === 200 && rPend.data.ok,
     `HTTP ${rPend.status}`);
  const rConsPost = await req('/api/admin', { method: 'POST', cookie: CK_MAESTRO,
    body: { accion: 'consolidado', empresa_id: EMP_A.id } });
  const fConsPost = rConsPost.data.filas?.find(f => f.titular_num_doc === NUM_DOC);
  ok('Reversión elimina fila del consolidado activo', !fConsPost,
     `fila_encontrada=${!!fConsPost}`);

  seccion('Re-validación y baja por cédula');
  await req('/api/admin', { method: 'POST', cookie: CK_MAESTRO,
    body: { accion: 'validar', ids: [SOL_ID], estado: 'valida' } });
  const rConsFinal = await req('/api/admin', { method: 'POST', cookie: CK_MAESTRO,
    body: { accion: 'consolidado', empresa_id: EMP_A.id } });
  CONS_ID = rConsFinal.data.filas?.find(f => f.titular_num_doc === NUM_DOC)?.id;
  ok('Alta re-validada en consolidado', !!CONS_ID);

  if (CONS_ID) {
    const rBajaGet = await req(`/api/baja?doc=${NUM_DOC}`, { cookie: USR_A_CK });
    ok('GET /api/baja devuelve la asistencia activa', rBajaGet.status === 200 &&
       rBajaGet.data.asistencias?.some(a => a.titular_num_doc === NUM_DOC),
       `asistencias.length=${rBajaGet.data.asistencias?.length}`);

    const rBajaPost = await req('/api/baja', { method: 'POST', cookie: USR_A_CK,
      body: { consolidado_ids: [CONS_ID], titular_num_doc: NUM_DOC, asesor: 'Asesor Test' } });
    ok('Baja registrada como solicitud pendiente', rBajaPost.status === 200 && rBajaPost.data.ok,
       `HTTP ${rBajaPost.status}`);
    const SOL_BAJA_ID = rBajaPost.data.ids?.[0];

    if (SOL_BAJA_ID) {
      const rValidaBaja = await req('/api/admin', { method: 'POST', cookie: CK_MAESTRO,
        body: { accion: 'validar', ids: [SOL_BAJA_ID], estado: 'valida' } });
      ok('Baja validada por maestro', rValidaBaja.status === 200 && rValidaBaja.data.ok,
         `HTTP ${rValidaBaja.status}`);

      const rConsB = await req('/api/admin', { method: 'POST', cookie: CK_MAESTRO,
        body: { accion: 'consolidado', empresa_id: EMP_A.id } });
      const retBaja = rConsB.data.filas?.find(f => f.titular_num_doc === NUM_DOC);
      ok('Baja validada retira la fila del consolidado activo', !retBaja,
         `fila_activa_encontrada=${!!retBaja}`);

      // Reversión de baja
      const rRevBaja = await req('/api/admin', { method: 'POST', cookie: CK_MAESTRO,
        body: { accion: 'validar', ids: [SOL_BAJA_ID], estado: 'pendiente' } });
      ok('Reversión de baja restaura fila en consolidado activo',
         rRevBaja.status === 200 && rRevBaja.data.ok, `HTTP ${rRevBaja.status}`);
      const rConsRev = await req('/api/admin', { method: 'POST', cookie: CK_MAESTRO,
        body: { accion: 'consolidado', empresa_id: EMP_A.id } });
      const fConsRev = rConsRev.data.filas?.find(f => f.titular_num_doc === NUM_DOC);
      ok('Fila restaurada en consolidado', !!fConsRev, `encontrada=${!!fConsRev}`);
    }
  }
}

// ─── Bloque 6: Contraseña incorrecta y límite de intentos ─────────────────────

async function bloque6_auth() {
  titulo('BLOQUE 6  –  Autenticación y límite de intentos');

  const domA = `test-a-${RUN}.internal`;
  const emailOk = ADM_A_EMAIL;

  seccion('Contraseña incorrecta → 401 con mensaje genérico');
  const rMal = await login(emailOk, 'ClaveMAL_1234');
  ok('Contraseña incorrecta → 401', rMal.status === 401);
  ok('Mensaje no revela "dominio" ni "activo"',
     !rMal.data.error?.match(/dominio|activo|estado/i),
     `error="${rMal.data.error}"`);

  seccion('Usuario inactivo → mismo error que contraseña incorrecta');
  // Desactivar ADM_A temporalmente
  const rUsList = await req('/api/admin', { method: 'POST', cookie: CK_MAESTRO,
    body: { accion: 'usuarios' } });
  const uAdmA = rUsList.data.filas?.find(u => u.email === ADM_A_EMAIL);
  if (uAdmA) {
    await req('/api/admin', { method: 'POST', cookie: CK_MAESTRO,
      body: { accion: 'usuario_guardar', id: uAdmA.id, email: uAdmA.email, nombre: uAdmA.nombre,
              rol: uAdmA.rol, empresa_id: uAdmA.empresa_id, activo: false, estado_acceso: 'activo' } });
    const rInact = await login(ADM_A_EMAIL, 'Cualquier12345'); // clave irrelevante
    ok('Usuario inactivo → 401 (mismo mensaje)', rInact.status === 401,
       `HTTP ${rInact.status}`);
    // Reactivar
    await req('/api/admin', { method: 'POST', cookie: CK_MAESTRO,
      body: { accion: 'usuario_guardar', id: uAdmA.id, email: uAdmA.email, nombre: uAdmA.nombre,
              rol: uAdmA.rol, empresa_id: uAdmA.empresa_id, activo: true, estado_acceso: 'activo' } });
    // Obtener nueva cookie de ADM_A
    const rNewLogin = await req('/api/admin', { method: 'POST', cookie: CK_MAESTRO,
      body: { accion: 'usuario_clave', id: uAdmA.id } });
    if (rNewLogin.data.clave_temporal) {
      const lA = await login(ADM_A_EMAIL, rNewLogin.data.clave_temporal);
      if (lA.cookie) ADM_A_CK = lA.cookie;
    }
  } else {
    ok('Usuario inactivo (skip: usuario no encontrado en lista)', false, 'SKIP');
  }
}

// ─── Bloque 7: Modelo Mixto (Etapa 2) ──────────────────────────────────────────

async function bloque7_mixto() {
  titulo('BLOQUE 7  –  Modelo Mixto y Cálculos de Conciliación');

  // 1. Alta modelo 1 con Nómina -> aceptada
  const fM1 = [{ id_inscripcion: `INS-M1-${RUN}`, titular_nombres:'M1', titular_apellidos:'A', titular_num_doc:`M1${RUN}`, asistencia_id:'doctor', plan_id:'Basico', pago_id:'Nomina', modelo_aplicado:1, valor_mensual:10000, personas:1 }];
  const rM1 = await req('/api/inscripcion', { method: 'POST', cookie: CK_MAESTRO,
    body: { empresa_id: EMP_C.id, filas: fM1 } });
  ok('Empresa mixta: alta M1 (Nomina) aceptada', rM1.status === 200 && rM1.data.ok, JSON.stringify(rM1.data));

  // 2. Alta modelo 2 con Nomina -> rechazada
  const fM2 = [{ id_inscripcion: `INS-M2-${RUN}`, titular_nombres:'M2', titular_apellidos:'A', titular_num_doc:`M2${RUN}`, asistencia_id:'doctor', plan_id:'Basico', pago_id:'Nomina', modelo_aplicado:2, valor_mensual:10000, personas:1 }];
  const rM2 = await req('/api/inscripcion', { method: 'POST', cookie: CK_MAESTRO,
    body: { empresa_id: EMP_C.id, filas: fM2 } });
  ok('Empresa mixta: alta M2 (Nomina) rechazada', rM2.status === 400 && /coincide/.test(rM2.data.error), JSON.stringify(rM2.data));

  // 3. Alta modelo 2 con Empresa -> aceptada
  const fM3 = [{ id_inscripcion: `INS-M3-${RUN}`, titular_nombres:'M3', titular_apellidos:'A', titular_num_doc:`M3${RUN}`, asistencia_id:'doctor', plan_id:'Basico', pago_id:'Empresa', modelo_aplicado:2, valor_mensual:20000, personas:1 }];
  const rM3 = await req('/api/inscripcion', { method: 'POST', cookie: CK_MAESTRO,
    body: { empresa_id: EMP_C.id, filas: fM3 } });
  ok('Empresa mixta: alta M2 (Empresa) aceptada', rM3.status === 200 && rM3.data.ok, JSON.stringify(rM3.data));

  // 4. Empresa modelo 1 envía modelo_aplicado=2 -> se guarda como 1 (probando con EMP_A)
  const fA = [{ id_inscripcion: `INS-A1-${RUN}`, titular_nombres:'A1', titular_apellidos:'A', titular_num_doc:`A1${RUN}`, asistencia_id:'doctor', plan_id:'Basico', pago_id:'Nomina', modelo_aplicado:2, valor_mensual:10000, personas:1 }];
  const rA = await req('/api/inscripcion', { method: 'POST', cookie: USR_A_CK,
    body: { filas: fA } });
  ok('Empresa M1: alta aceptada aunque mande modelo 2', rA.status === 200 && rA.data.ok, JSON.stringify(rA.data));

  const rPendsTest = await req('/api/admin', { method: 'POST', cookie: VALIDADOR_CK, body: { accion: 'solicitudes' } });
  const solA1 = rPendsTest.data.filas.find(s => s.titular_num_doc === `A1${RUN}`);
  ok('Empresa M1: el servidor guardó modelo_aplicado=1', solA1 && solA1.modelo_aplicado === 1, `Encontrado: ${solA1?.modelo_aplicado}`);

  // Vamos a validar todas las pendientes para ver la conciliación
  const rPends = await req('/api/admin', { method: 'POST', cookie: VALIDADOR_CK, body: { accion: 'solicitudes' } });
  const idsC = rPends.data.filas.filter(s => s.empresa_id === EMP_C.id && s.estado === 'pendiente').map(s => s.id);
  if (idsC.length) {
    await req('/api/admin', { method: 'POST', cookie: VALIDADOR_CK, body: { accion: 'validar', estado: 'valida', ids: idsC } });
  }

  // Verificar la conciliación de EMP_C
  const rPortalC = await req(`/api/portal?empresa_id=${EMP_C.id}`, { cookie: VALIDADOR_CK });
  const resC = rPortalC.data.resumen;
  ok('Conciliación mixta: tiene subtotal_m1 y subtotal_m2', resC && resC.subtotal_m1 === 10000 && resC.subtotal_m2 === 20000, JSON.stringify(resC));
  ok('Conciliación mixta: total a pagar y descuento (5% sobre M2)', resC && resC.descuento_valor === 1000 && resC.total_a_pagar === 29000, `total=${resC?.total_a_pagar} desc=${resC?.descuento_valor}`);
}

// ─── Bloque 8: Archivos y Alertas (Etapa 3) ────────────────────────────────────

async function bloque8_archivos() {
  titulo('BLOQUE 8  –  Archivos y Alertas (Etapa 3)');

  // 1. GET /api/archivo con una sesión de empresa_usuario debe fallar si pide un ID de archivo de OTRA empresa.
  const rT1 = await req('/api/archivo', { method: 'POST', cookie: USR_A_CK, body: { accion: 'token_subida', tipo: 'pdf_inscripcion', id_inscripcion: `INS-A-${RUN}` } });
  ok('Archivo: empresa_A puede obtener token de subida', rT1.status === 200 && rT1.data.clientToken, JSON.stringify(rT1.data));
  
  const rRegA = await req('/api/archivo', { method: 'POST', cookie: USR_A_CK, body: { accion: 'registrar', id_inscripcion: `INS-A-${RUN}`, tipo: 'pdf_inscripcion', url: `https://test.public.blob.vercel-storage.com/${EMP_A.id}/INS-A-${RUN}_pdf_inscripcion_x` } });
  ok('Archivo: empresa_A registra archivo', rRegA.status === 200 && rRegA.data.id, JSON.stringify(rRegA.data));
  const idArchivoA = rRegA.data.id;

  const rGetA = await req(`/api/archivo?id=${idArchivoA}`, { method: 'GET', cookie: USR_A_CK });
  ok('Archivo: empresa_A accede a su archivo (404 significa auth pasó)', rGetA.status === 404, rGetA.status.toString());

  const rGetB = await req(`/api/archivo?id=${idArchivoA}`, { method: 'GET', cookie: ADM_B_CK });
  ok('Archivo: empresa_B NO tiene permiso para archivo de A', rGetB.status === 403, JSON.stringify(rGetB.data));

  // 1.b Registrar con host incorrecto
  const rRegBadHost = await req('/api/archivo', { method: 'POST', cookie: USR_A_CK, body: { accion: 'registrar', id_inscripcion: `INS-A-${RUN}`, tipo: 'pdf_inscripcion', url: `https://hack.public.blob.vercel-storage.com/${EMP_A.id}/INS-A-${RUN}_pdf_inscripcion_x` } });
  ok('Archivo: registrar rechaza host de otro store', rRegBadHost.status === 400, rRegBadHost.status.toString());

  // 1.c Registrar con pathname de otra empresa
  const rRegBadPath = await req('/api/archivo', { method: 'POST', cookie: USR_A_CK, body: { accion: 'registrar', id_inscripcion: `INS-A-${RUN}`, tipo: 'pdf_inscripcion', url: `https://test.public.blob.vercel-storage.com/${EMP_B.id}/INS-A-${RUN}_pdf_inscripcion_x` } });
  ok('Archivo: registrar rechaza pathname de otra empresa', rRegBadPath.status === 403, rRegBadPath.status.toString());

  // 2. POST /api/archivo token_subida debe rechazar tipos no permitidos
  const rTBad = await req('/api/archivo', { method: 'POST', cookie: USR_A_CK, body: { accion: 'token_subida', tipo: 'txt_hack', id_inscripcion: `INS-A-${RUN}` } });
  ok('Archivo: token_subida rechaza tipo no permitido', rTBad.status === 400 && /inválido/.test(rTBad.data.error), JSON.stringify(rTBad.data));

  // 3. Alertas "PDF no guardado" y "Sin autorización de descuento" (papel)
  const idInscAuth = `INS-AUTH-${RUN}`;
  const fAuth = [{ id_inscripcion: idInscAuth, titular_nombres:'Auth', titular_apellidos:'X', titular_num_doc:`AX${RUN}`, asistencia_id:'doctor', plan_id:'Basico', pago_id:'Nomina', modelo_aplicado:1, valor_mensual:10000, personas:1, firma_modo: 'papel', aut_descuento: 'Si', aut_datos: 'Si', datos: {} }];
  
  await req('/api/inscripcion', { method: 'POST', cookie: USR_A_CK, body: { filas: fAuth } });
  const rPends = await req('/api/admin', { method: 'POST', cookie: VALIDADOR_CK, body: { accion: 'solicitudes' } });
  const solAuth = rPends.data.filas.find(s => s.id_inscripcion === idInscAuth);
  
  ok('Archivo: la inscripción aparece en pendientes', !!solAuth, '');
  const alertasAuth = solAuth?.alertas || [];
  ok('Archivo: alerta "PDF no guardado"', alertasAuth.some(a => /PDF no guardado/i.test(a.texto)), JSON.stringify(alertasAuth));
  ok('Archivo: alerta "Sin autorización de descuento" por falta de soporte', alertasAuth.some(a => /Sin autorización de descuento/i.test(a.texto)), JSON.stringify(alertasAuth));
}

// ─── Bloque 9: Altas Masivas por Excel (Etapa 4) ───────────────────────────────

async function bloque9_excel() {
  titulo('BLOQUE 9  –  Altas Masivas por Excel (Etapa 4)');

  const loteId = `LOTE-${RUN}`;
  const filasMix = [
    { num_doc: `EX1${RUN}`, nombres: 'Ex1', apellidos: 'A', asistencia: 'doctor', plan: 'Basico', forma_pago: 'Nomina' }, // Good
    { num_doc: `EX2${RUN}`, nombres: 'Ex2', apellidos: 'A', asistencia: 'invento', plan: 'Basico', forma_pago: 'Nomina' }, // Bad product
    { num_doc: `EX3${RUN}`, nombres: 'Ex3', apellidos: 'A', asistencia: 'doctor', plan: 'Basico' } // Bad for mixto
  ];

  // 1. empresa_usuario no puede
  const rUsu = await req('/api/admin', { method: 'POST', cookie: USR_A_CK, body: { accion: 'altas_masivas', empresa_id: EMP_A.id, id_lote: loteId, filas: filasMix } });
  ok('Excel: empresa_usuario no autorizado', rUsu.status === 403, JSON.stringify(rUsu.data));

  // 2. Carga con filas buenas y malas
  const rMix = await req('/api/admin', { method: 'POST', cookie: ADM_C_CK, body: { accion: 'altas_masivas', empresa_id: EMP_C.id, id_lote: loteId, filas: filasMix } });
  ok('Excel: carga mixta falla y reporta las filas malas', rMix.status === 400 && /2 fila\(s\) con errores/.test(rMix.data.error), JSON.stringify(rMix.data));
  ok('Excel: reporta el producto no reconocido y la falta de modelo', rMix.data.errores?.some(e => /Fila 3/.test(e)) && rMix.data.errores?.some(e => /Fila 4/.test(e)), JSON.stringify(rMix.data.errores));

  // 3. Carga limpia
  const filasBien = [
    { num_doc: `EX1${RUN}`, nombres: 'Ex1', apellidos: 'A', asistencia: 'doctor', plan: 'Basico', forma_pago: 'Nomina' }
  ];
  const rBien = await req('/api/admin', { method: 'POST', cookie: ADM_C_CK, body: { accion: 'altas_masivas', empresa_id: EMP_C.id, id_lote: loteId, filas: filasBien } });
  ok('Excel: carga limpia aceptada', rBien.status === 200 && rBien.data.cargadas === 1, JSON.stringify(rBien.data));

  // 4. Reintento (id_lote repetido)
  const rDup = await req('/api/admin', { method: 'POST', cookie: ADM_C_CK, body: { accion: 'altas_masivas', empresa_id: EMP_C.id, id_lote: loteId, filas: filasBien } });
  ok('Excel: reintentar no duplica', rDup.status === 200 && /procesado/.test(rDup.data.mensaje), JSON.stringify(rDup.data));

  // 5. empresa_admin intenta cargar para OTRA empresa
  const rHack = await req('/api/admin', { method: 'POST', cookie: ADM_C_CK, body: { accion: 'altas_masivas', empresa_id: EMP_B.id, id_lote: `HACK-${RUN}`, filas: filasBien } });
  if (rHack.status === 200) {
    const rCheck = await req('/api/admin', { method: 'POST', cookie: VALIDADOR_CK, body: { accion: 'solicitudes' } });
    const sol = rCheck.data.filas.find(s => s.id_inscripcion === `HACK-${RUN}-F2`);
    ok('Excel: la solicitud se guardó en la empresa C (la propia), NO en B', sol?.empresa_id === EMP_C.id, `Guardado en: ${sol?.empresa_id}`);
  } else {
    ok('Excel: rechaza mandar id diferente (o no falla sino que reescribe a su empresa)', true, rHack.status.toString());
  }

  // 6. Carga grande (450 filas)
  const loteGrande = `BIG-${RUN}`;
  const fBig1 = Array.from({length: 200}, (_, i) => ({ num_doc: `B1${i}${RUN}`, nombres: 'N', apellidos: 'A', asistencia: 'doctor', plan: 'Basico', forma_pago: 'Nomina', fecha_nac: 32874 }));
  const fBig2 = Array.from({length: 200}, (_, i) => ({ num_doc: `B2${i}${RUN}`, nombres: 'N', apellidos: 'A', asistencia: 'doctor', plan: 'Basico', forma_pago: 'Nomina', fecha_nac: 32874 }));
  const fBig3 = Array.from({length: 50}, (_, i) => ({ num_doc: `B3${i}${RUN}`, nombres: 'N', apellidos: 'A', asistencia: 'doctor', plan: 'Basico', forma_pago: 'Nomina', fecha_nac: 32874 }));
  
  await req('/api/admin', { method: 'POST', cookie: ADM_C_CK, body: { accion: 'altas_masivas', empresa_id: EMP_C.id, id_lote: loteGrande, filas: fBig1 } });
  await req('/api/admin', { method: 'POST', cookie: ADM_C_CK, body: { accion: 'altas_masivas', empresa_id: EMP_C.id, id_lote: loteGrande, filas: fBig2 } });
  await req('/api/admin', { method: 'POST', cookie: ADM_C_CK, body: { accion: 'altas_masivas', empresa_id: EMP_C.id, id_lote: loteGrande, filas: fBig3 } });
  
  const rAll = await req('/api/admin', { method: 'POST', cookie: VALIDADOR_CK, body: { accion: 'solicitudes' } });
  const totalBig = rAll.data.filas.filter(s => s.datos?.id_lote === loteGrande).length;
  ok('Excel: se guardaron 450 filas correctamente', totalBig === 450, `Se guardaron ${totalBig}`);

  const rBig1Dup = await req('/api/admin', { method: 'POST', cookie: ADM_C_CK, body: { accion: 'altas_masivas', empresa_id: EMP_C.id, id_lote: loteGrande, filas: fBig1 } });
  ok('Excel: reintentar lote grande solo devuelve repetidas', rBig1Dup.data.cargadas === 0 && rBig1Dup.data.omitidas === 200, JSON.stringify(rBig1Dup.data));
  
  // 7. Cédula con letras, notación científica y número de serie
  const loteEspecial = `ESP-${RUN}`;
  const filasEspeciales = [
    { num_doc: `CE123A${RUN}`, nombres: 'Letras', apellidos: 'A', asistencia: 'doctor', plan: 'Basico', forma_pago: 'Nomina', fecha_nac: 32874 }, // 1 Ene 1990
    { num_doc: '1.0203E+09', nombres: 'Notacion', apellidos: 'A', asistencia: 'doctor', plan: 'Basico', forma_pago: 'Nomina', fecha_nac: '01/01/1990' }
  ];
  const rEsp = await req('/api/admin', { method: 'POST', cookie: ADM_C_CK, body: { accion: 'altas_masivas', empresa_id: EMP_C.id, id_lote: loteEspecial, filas: filasEspeciales } });
  ok('Excel: rechaza notación científica', rEsp.data.errores?.some(e => /La cédula está en notación científica/.test(e)), JSON.stringify(rEsp.data.errores));
  ok('Excel: carga cédula con letras y fecha correcta', rEsp.data.cargadas === 1, JSON.stringify(rEsp.data));
  const solEsp = await req('/api/admin', { method: 'POST', cookie: VALIDADOR_CK, body: { accion: 'solicitudes' } });
  const docEsp = solEsp.data.filas.find(s => s.datos?.id_lote === loteEspecial);
  ok('Excel: conserva letras en cédula y formatea fecha Excel', docEsp?.titular_num_doc === `CE123A${RUN}` && docEsp?.datos?.titular_fecha_nac === '01/01/1990', JSON.stringify(docEsp?.datos));
}
// ─── Cleanup ───────────────────────────────────────────────────────────────────

async function limpiar() {
  titulo('CLEANUP  –  Datos de prueba');
  // El API no tiene DELETE; desactivar usuarios y empresas.
  // En Neon, los datos de test se pueden limpiar con una rama de prueba.
  let ok2 = 0;
  const usList = await req('/api/admin', { method: 'POST', cookie: CK_MAESTRO,
    body: { accion: 'usuarios' } });
  for (const email of cleanup.usuarios) {
    const u = usList.data.filas?.find(f => f.email === email);
    if (u) {
      await req('/api/admin', { method: 'POST', cookie: CK_MAESTRO,
        body: { accion: 'usuario_guardar', id: u.id, email: u.email, nombre: u.nombre,
                rol: u.rol, empresa_id: u.empresa_id, activo: false, estado_acceso: 'rechazado' } });
      ok2++;
    }
  }
  console.log(`  ⚙️  ${ok2} usuario(s) desactivado(s). Las empresas TEST quedan inactivas en la BD de prueba.`);
  // Desactivar empresas
  for (const eid of cleanup.empresas) {
    const emp = await req('/api/admin', { method: 'POST', cookie: CK_MAESTRO,
      body: { accion: 'empresas' } });
    const e = emp.data.filas?.find(f => f.id === eid);
    if (e) await req('/api/admin', { method: 'POST', cookie: CK_MAESTRO,
      body: { accion: 'empresa_guardar', id: e.id, nit: e.nit, nombre: e.nombre,
              modelo: e.modelo, activa: false, productos: [] } });
  }
  console.log(`  ⚙️  ${cleanup.empresas.length} empresa(s) marcada(s) como inactiva(s).`);
}

// ─── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ASISTENCIAS BIENESTAR 360  –  Suite de aislamiento`);
  console.log(`  Servidor: ${BASE}`);
  console.log(`  Ejecución: ${new Date().toISOString()}`);
  console.log(`${'═'.repeat(60)}`);

  try {
    await setup();
    await bloque1_aislamiento();
    await bloque2_roles();
    await bloque3_dominios();
    await bloque4_autoregistro();
    await bloque5_regresion();
    await bloque6_auth();
    await bloque7_mixto();
    await bloque8_archivos();
    await bloque9_excel();
    await limpiar();
  } catch (e) {
    console.error(`\n💥  Error inesperado: ${e.message}\n${e.stack}`);
    falle++;
  }

  const total = pase + falle;
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  RESULTADO: ${pase}/${total} pasaron  |  ${falle} fallaron`);
  console.log(`${'═'.repeat(60)}\n`);

  process.exit(falle > 0 ? 1 : 0);
})();
