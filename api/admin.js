// Operaciones del equipo interno y de empresa_admin.
//  maestro + validador: solicitudes, validar, consolidado, importar, empresas (lectura)
//  solo maestro:        empresa_guardar, dominios_guardar, usuarios, usuario_guardar,
//                       usuario_clave, usuario_activar
//  empresa_admin:       mis_usuarios, mi_usuario_guardar, mi_usuario_clave, mi_usuario_activar
import {
  sql, asegurarEsquema, leerCuerpo, origenValido, periodoActual, periodoValido, auditar,
  fechaHoy, texto, entero, registrarError, dominioDeEmail, DOMINIOS_PUBLICOS,
  obtenerModoConsolidado, establecerModoConsolidado, tablasConsolidado,
  calcularEdad, etiquetaPeriodo, periodoDeEtiqueta
} from './_db.js';
import { exigir, hashClave, claveTemporal, puedeValidar } from './_auth.js';
import { alertasDe, PRODUCTOS, CATALOGO, precioCatalogo, parsearDinero, normalizarNombreAsistencia } from './_catalogo.js';
import crypto from 'crypto';

// Acciones que requieren exactamente rol 'maestro'
const SOLO_MAESTRO = new Set(['empresa_guardar', 'dominios_guardar', 'usuarios', 'usuario_guardar', 'usuario_clave', 'usuario_activar', 'importar']);
// Acciones disponibles solo para empresa_admin (gestionan su propia empresa)
const EMPRESA_ADMIN_OK = new Set(['mis_usuarios', 'mi_usuario_guardar', 'mi_usuario_clave', 'mi_usuario_activar']);
// Acciones disponibles para maestro + validador (solo lectura y validación operativa)
const INTERNOS_OK = new Set([
  'solicitudes', 'validar', 'consolidado', 'empresas',
  'consolidado_conciliacion_modo',
  'consolidado_conciliacion_listar',
  'consolidado_conciliacion_preview',
  'consolidado_conciliacion_importar',
  'consolidado_conciliacion_cierre_mensual',
  'consolidado_conciliacion_completar_xc',
  'consolidado_conciliacion_reset_test',
  'consolidado_conciliacion_sembrar_ejemplo',
  'consolidado_conciliacion_exportar'
]);

const err = (res, n, msg) => res.status(n).json({ error: msg });

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return err(res, 405, 'Método no permitido'); }
  if (!origenValido(req)) return err(res, 403, 'Origen no permitido');
  try {
    // Aceptar: maestro, validador y empresa_admin (con sus propias restricciones por acción)
    const u = await exigir(req, res, ['maestro', 'validador', 'empresa_admin']); if (!u) return;
    const b = leerCuerpo(req) || {};
    const accion = String(b.accion || '');
    await asegurarEsquema();

    // Verificar permisos por acción
    if (accion === 'altas_masivas') {
      if (!['maestro', 'empresa_admin'].includes(u.rol)) return err(res, 403, 'No tiene permiso para esta acción.');
    } else if (EMPRESA_ADMIN_OK.has(accion)) {
      if (u.rol !== 'empresa_admin') return err(res, 403, 'No tiene permiso para esta acción.');
    } else if (SOLO_MAESTRO.has(accion)) {
      if (u.rol !== 'maestro') return err(res, 403, 'Solo el maestro puede hacer esto.');
    } else if (INTERNOS_OK.has(accion)) {
      if (u.rol !== 'maestro' && u.rol !== 'validador') return err(res, 403, 'No tiene permiso para esta acción.');
      if (accion === 'consolidado_conciliacion_modo' && b.nuevo_modo && u.rol !== 'maestro') {
        return err(res, 403, 'Solo el usuario maestro puede cambiar el modo del consolidado.');
      }
      if (accion === 'consolidado_conciliacion_reset_test' && u.rol !== 'maestro') {
        return err(res, 403, 'Solo el usuario maestro puede reiniciar los datos de prueba.');
      }
      if (accion === 'consolidado_conciliacion_sembrar_ejemplo' && u.rol !== 'maestro') {
        return err(res, 403, 'Solo el usuario maestro puede cargar los datos de ejemplo.');
      }
    } else {
      return err(res, 400, 'Acción desconocida.');
    }

    const fn = ACCIONES[accion];
    return await fn(b, u, res, req);
  } catch (e) {
    if (e.publico) return err(res, 400, e.message);
    console.error('Error en administración (stack):', e && e.stack ? e.stack : e);
    registrarError('Error en administración', e);
    return err(res, 500, 'Error del servidor. Intente de nuevo.');
  }
}

const empresaId = v => { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };
const publico = msg => Object.assign(new Error(msg), { publico: true });

const ACCIONES = {
  // ── Solicitudes del mes con validaciones automáticas ──────────────────────
  async solicitudes(b, u, res, req) {
    const periodo = periodoValido(b.periodo) ? b.periodo : periodoActual();
    const eid = empresaId(b.empresa_id);
    const todas = eid
      ? await sql`SELECT s.*, e.nombre AS empresa_nombre, e.nit AS empresa_nit,
                    COALESCE(s.modelo_aplicado, e.modelo) AS modelo_aplicado,
                    COALESCE(s.origen_tipo, 'formulario') AS origen_tipo,
                    (SELECT a.id FROM archivos a WHERE a.id_inscripcion = s.id_inscripcion AND a.tipo = 'pdf_inscripcion' LIMIT 1) AS archivo_pdf_id,
                    (SELECT a.id FROM archivos a WHERE (a.id_inscripcion = s.id_inscripcion OR a.id_inscripcion = s.datos->>'id_lote') AND a.tipo = 'soporte_nomina' LIMIT 1) AS archivo_soporte_id
                  FROM solicitudes s JOIN empresas e ON e.id = s.empresa_id
                  WHERE s.periodo = ${periodo} AND s.empresa_id = ${eid} ORDER BY s.id DESC LIMIT 20000`
      : await sql`SELECT s.*, e.nombre AS empresa_nombre, e.nit AS empresa_nit,
                    COALESCE(s.modelo_aplicado, e.modelo) AS modelo_aplicado,
                    COALESCE(s.origen_tipo, 'formulario') AS origen_tipo,
                    (SELECT a.id FROM archivos a WHERE a.id_inscripcion = s.id_inscripcion AND a.tipo = 'pdf_inscripcion' LIMIT 1) AS archivo_pdf_id,
                    (SELECT a.id FROM archivos a WHERE (a.id_inscripcion = s.id_inscripcion OR a.id_inscripcion = s.datos->>'id_lote') AND a.tipo = 'soporte_nomina' LIMIT 1) AS archivo_soporte_id
                  FROM solicitudes s JOIN empresas e ON e.id = s.empresa_id
                  WHERE s.periodo = ${periodo} ORDER BY s.id DESC LIMIT 20000`;
    const empIds = [...new Set(todas.map(s => s.empresa_id))];
    const docs = [...new Set(todas.map(s => s.titular_num_doc))];
    const modo = await obtenerModoConsolidado();
    const esTest = modo !== 'prod';
    const cleanDocs = docs.map(d => String(d).replace(/[^0-9A-Za-z]/g, '')).filter(Boolean);
    const [consLegacy, emps] = empIds.length ? await Promise.all([
      sql`SELECT id, empresa_id, titular_num_doc, asistencia_id, asistencia, plan_id, plan, mascota, estado, alta_solicitud_id, baja_solicitud_id
          FROM consolidado WHERE empresa_id = ANY(${empIds}) AND titular_num_doc = ANY(${docs})`,
      sql`SELECT id, modelo, productos FROM empresas WHERE id = ANY(${empIds})`
    ]) : [[], []];

    let consolidadoActivo = [];
    if (empIds.length) {
      if (esTest) {
        consolidadoActivo = await sql`
          SELECT c.id::text AS id, c.empresa_id,
                 COALESCE(c.doc_asociado, c.numero_identificacion) AS titular_num_doc,
                 c.asistencia_id, c.asistencia, c.plan_id, c.plan, '' AS mascota,
                 CASE WHEN UPPER(BTRIM(c.estado)) = 'ACTIVO' THEN 'activo' ELSE 'retirado' END AS estado,
                 c.solicitud_id AS alta_solicitud_id, NULL::int AS baja_solicitud_id
          FROM consolidado_conciliacion_test c
          WHERE (c.empresa_id = ANY(${empIds})
                 OR regexp_replace(coalesce(c.doc_asociado, ''), '[^0-9A-Za-z]', '', 'g') = ANY(${cleanDocs})
                 OR regexp_replace(coalesce(c.numero_identificacion, ''), '[^0-9A-Za-z]', '', 'g') = ANY(${cleanDocs}))
        `;
      } else {
        consolidadoActivo = await sql`
          SELECT c.id::text AS id, c.empresa_id,
                 COALESCE(c.doc_asociado, c.numero_identificacion) AS titular_num_doc,
                 c.asistencia_id, c.asistencia, c.plan_id, c.plan, '' AS mascota,
                 CASE WHEN UPPER(BTRIM(c.estado)) = 'ACTIVO' THEN 'activo' ELSE 'retirado' END AS estado,
                 c.solicitud_id AS alta_solicitud_id, NULL::int AS baja_solicitud_id
          FROM consolidado_conciliacion c
          WHERE (c.empresa_id = ANY(${empIds})
                 OR regexp_replace(coalesce(c.doc_asociado, ''), '[^0-9A-Za-z]', '', 'g') = ANY(${cleanDocs})
                 OR regexp_replace(coalesce(c.numero_identificacion, ''), '[^0-9A-Za-z]', '', 'g') = ANY(${cleanDocs}))
        `;
      }
    }

    const consTotal = [...consLegacy.map(c => ({ ...c, id: String(c.id) })), ...consolidadoActivo];
    const alertas = alertasDe(todas, todas, consTotal, new Map(emps.map(e => [e.id, e])));
    const validadores = await sql`SELECT id, nombre FROM usuarios WHERE rol IN ('maestro','validador')`;
    const nombreVal = new Map(validadores.map(v => [v.id, v.nombre]));
    const filas = todas.map(s => ({ ...s, alertas: alertas.get(s.id) || [], validado_por_nombre: nombreVal.get(s.validado_por) || '' }));
    const periodos = await sql`SELECT DISTINCT periodo FROM solicitudes ORDER BY periodo DESC LIMIT 24`;
    return res.status(200).json({
      periodo, periodo_actual: periodoActual(),
      periodos: [...new Set([periodoActual(), ...periodos.map(p => p.periodo)])], filas
    });
  },

  // ── Marcar solicitudes como válidas / inválidas / pendientes ──────────────
  // Solo maestro y validador pueden validar (verificado arriba en el handler).
  async validar(b, u, res, req) {
    if (!puedeValidar(u.rol)) return err(res, 403, 'Solo el maestro o validador pueden validar solicitudes.');
    const estado = b.estado;
    if (!['valida', 'invalida', 'pendiente'].includes(estado)) return err(res, 400, 'Estado inválido.');
    const motivo = texto(b.motivo, 500);
    if (estado === 'invalida' && motivo.length < 5) return err(res, 400, 'Escriba el motivo para que la empresa sepa qué corregir.');
    const ids = Array.isArray(b.ids) ? [...new Set(b.ids.map(Number).filter(Number.isInteger))].slice(0, 500) : [];
    if (!ids.length) return err(res, 400, 'Seleccione al menos un registro.');

    const sols = await sql`SELECT * FROM solicitudes WHERE id = ANY(${ids})`;
    const consIds = sols.map(s => s.consolidado_id).filter(Boolean);
    const intConsIds = consIds.map(Number).filter(Number.isInteger);
    const cons = (intConsIds.length || ids.length) ? await sql`SELECT id, estado, baja_solicitud_id, alta_solicitud_id FROM consolidado
      WHERE (id = ANY(${intConsIds.length ? intConsIds : [-1]})) OR alta_solicitud_id = ANY(${ids})` : [];

    const empIds = [...new Set(sols.map(s => s.empresa_id))];
    const emps = empIds.length ? await sql`SELECT id, nit, nombre FROM empresas WHERE id = ANY(${empIds})` : [];
    const empMap = new Map(emps.map(e => [e.id, e]));

    const modoActivo = await obtenerModoConsolidado();
    const esTest = modoActivo !== 'prod';
    const hoy = fechaHoy();
    const q = []; const avisos = [];

    for (const s of sols) {
      if (s.estado === estado) continue;
      // Segregación de funciones: un validador o maestro no puede aprobar solicitudes enviadas por él mismo
      if (estado === 'valida' && s.enviado_por && s.enviado_por === u.id) {
        avisos.push(`Solicitud #${s.id}: segregación de funciones: no puede aprobar una solicitud enviada por usted mismo.`);
        continue;
      }
      const emp = empMap.get(s.empresa_id) || { nit: s.datos?.nit || '', nombre: s.datos?.empresa || '' };

      if (s.estado === 'valida') { // Revertir efecto
        if (s.tipo === 'alta') {
          const c = cons.find(c => c.alta_solicitud_id === s.id);
          if (c && c.estado === 'retirado') { avisos.push(`#${s.id}: ya tiene una baja validada; no se puede revertir.`); continue; }
          q.push(sql`DELETE FROM consolidado WHERE alta_solicitud_id = ${s.id} AND estado = 'activo'`);

          // Revertir en consolidado_conciliacion
          if (esTest) {
            q.push(sql`DELETE FROM consolidado_conciliacion_test WHERE solicitud_id = ${s.id}`);
          } else {
            q.push(sql`DELETE FROM consolidado_conciliacion WHERE solicitud_id = ${s.id}`);
          }
        } else {
          const c = cons.find(c => String(c.id) === String(s.consolidado_id));
          if (c) {
            q.push(sql`UPDATE consolidado SET estado = 'activo', fecha_baja = NULL, baja_solicitud_id = NULL, actualizado_en = now()
                       WHERE id = ${c.id} AND baja_solicitud_id = ${s.id}`);
          }

          // Revertir baja en consolidado_conciliacion
          const cleanDocRev = String(s.titular_num_doc || '').replace(/[^0-9A-Za-z]/g, '');
          if (esTest) {
            q.push(sql`UPDATE consolidado_conciliacion_test SET estado = 'Activo', fecha_retiro = NULL, actualizado_en = now()
                       WHERE id::text = ${String(s.consolidado_id)}
                          OR solicitud_id = ${s.id}
                          OR ((regexp_replace(coalesce(doc_asociado, ''), '[^0-9A-Za-z]', '', 'g') = ${cleanDocRev}
                               OR regexp_replace(coalesce(numero_identificacion, ''), '[^0-9A-Za-z]', '', 'g') = ${cleanDocRev})
                              AND asistencia = ${s.asistencia} AND UPPER(BTRIM(estado)) = 'INACTIVO' AND fecha_retiro = ${hoy}::date)`);
          } else {
            q.push(sql`UPDATE consolidado_conciliacion SET estado = 'Activo', fecha_retiro = NULL, actualizado_en = now()
                       WHERE id::text = ${String(s.consolidado_id)}
                          OR solicitud_id = ${s.id}
                          OR ((regexp_replace(coalesce(doc_asociado, ''), '[^0-9A-Za-z]', '', 'g') = ${cleanDocRev}
                               OR regexp_replace(coalesce(numero_identificacion, ''), '[^0-9A-Za-z]', '', 'g') = ${cleanDocRev})
                              AND asistencia = ${s.asistencia} AND UPPER(BTRIM(estado)) = 'INACTIVO' AND fecha_retiro = ${hoy}::date)`);
          }
        }
      }

      if (estado === 'valida') { // Aplicar efecto
        if (s.tipo === 'alta') {
          // 1. Legacy consolidado
          q.push(sql`INSERT INTO consolidado (empresa_id, titular_num_doc, titular_nombre, asistencia_id, asistencia, plan_id, plan,
                       mascota, pago, valor_mensual, valor_empresa, valor_colaborador, personas, fecha_alta, origen, alta_solicitud_id,
                       modelo_aplicado, datos)
                     SELECT ${s.empresa_id}, ${s.titular_num_doc}, ${s.titular_nombre}, ${s.asistencia_id}, ${s.asistencia},
                       ${s.plan_id}, ${s.plan}, ${s.mascota}, ${s.pago}, ${s.valor_mensual}, ${s.valor_empresa},
                       ${s.valor_colaborador}, ${s.personas}, ${hoy}::date, 'formulario', ${s.id},
                       ${s.modelo_aplicado}, ${JSON.stringify(s.datos)}::jsonb
                     WHERE NOT EXISTS (SELECT 1 FROM consolidado WHERE alta_solicitud_id = ${s.id})`);

          // 2. Consolidado de conciliación: verificar duplicado activo (NIT + DOC. ASOCIADO + ASISTENCIA)
          let activaConc;
          if (esTest) {
            [activaConc] = await sql`
              SELECT id FROM consolidado_conciliacion_test
              WHERE nit = ${emp.nit} AND doc_asociado = ${s.titular_num_doc} AND asistencia = ${s.asistencia} AND estado = 'Activo' LIMIT 1
            `;
          } else {
            [activaConc] = await sql`
              SELECT id FROM consolidado_conciliacion
              WHERE nit = ${emp.nit} AND doc_asociado = ${s.titular_num_doc} AND asistencia = ${s.asistencia} AND estado = 'Activo' LIMIT 1
            `;
          }

          if (activaConc) {
            avisos.push(`Solicitud #${s.id}: ya existe una suscripción activa para ${s.titular_num_doc} con la asistencia "${s.asistencia}". No se crea duplicado.`);
          } else {
            const nuevoUuid = crypto.randomUUID();
            const fnac = s.datos?.titular_fecha_nac || null;
            const edadCalc = calcularEdad(fnac);
            const ben1 = {
              nom: s.datos?.beneficiario1_nombre || null,
              tdoc: s.datos?.beneficiario1_tipo_doc || null,
              ndoc: s.datos?.beneficiario1_num_doc || null,
              par: s.datos?.beneficiario1_parentesco || null,
              pct: s.datos?.beneficiario1_porcentaje ? Number(s.datos.beneficiario1_porcentaje) : null
            };
            const ben2 = {
              nom: s.datos?.beneficiario2_nombre || null,
              tdoc: s.datos?.beneficiario2_tipo_doc || null,
              ndoc: s.datos?.beneficiario2_num_doc || null,
              par: s.datos?.beneficiario2_parentesco || null,
              pct: s.datos?.beneficiario2_porcentaje ? Number(s.datos.beneficiario2_porcentaje) : null
            };
            const ben3 = {
              nom: s.datos?.beneficiario3_nombre || null,
              tdoc: s.datos?.beneficiario3_tipo_doc || null,
              ndoc: s.datos?.beneficiario3_num_doc || null,
              par: s.datos?.beneficiario3_parentesco || null,
              pct: s.datos?.beneficiario3_porcentaje ? Number(s.datos.beneficiario3_porcentaje) : null
            };

            if (esTest) {
              q.push(sql`
                INSERT INTO consolidado_conciliacion_test (
                  id, empresa_id, nit, convenio_empresa, xc_subscriptionname__c, estado, canal_atencion,
                  fecha_cargue, fecha_corte, asociado, doc_asociado, fecha_retiro,
                  asistencia, asistencia_id, plan, plan_id, valor_con_iva, valor_sin_iva,
                  titular, tipo_doc, numero_identificacion, fecha_nacimiento, celular, correo,
                  ciudad_municipio, direccion_predio, edad,
                  nombre_beneficiario_1, tipo_doc_beneficiario_1, documento_numero_beneficiario_1, parentesco_1, porcentaje_1,
                  nombre_beneficiario_2, tipo_doc_beneficiario_2, documento_numero_beneficiario_2, parentesco_2, porcentaje_2,
                  nombre_beneficiario_3, tipo_doc_beneficiario_3, documento_numero_beneficiario_3, parentesco_3, porcentaje_3,
                  origen, solicitud_id, aprobado_por, aprobado_en
                ) VALUES (
                  ${nuevoUuid}, ${s.empresa_id}, ${emp.nit}, ${emp.nombre}, NULL, 'Activo', 'Venta Directa',
                  ${hoy}::date, NULL, ${s.titular_nombre}, ${s.titular_num_doc}, NULL,
                  ${s.asistencia}, ${s.asistencia_id}, ${s.plan}, ${s.plan_id}, ${s.valor_mensual}, NULL,
                  ${s.titular_nombre}, ${s.datos?.titular_tipo_doc || 'CC'}, ${s.titular_num_doc},
                  ${fnac ? sql`to_date(${fnac}, 'DD/MM/YYYY')` : null}, ${s.datos?.titular_celular || null}, ${s.datos?.titular_correo || null},
                  ${s.datos?.titular_ciudad || null}, ${s.datos?.titular_direccion || null}, ${edadCalc},
                  ${ben1.nom}, ${ben1.tdoc}, ${ben1.ndoc}, ${ben1.par}, ${ben1.pct},
                  ${ben2.nom}, ${ben2.tdoc}, ${ben2.ndoc}, ${ben2.par}, ${ben2.pct},
                  ${ben3.nom}, ${ben3.tdoc}, ${ben3.ndoc}, ${ben3.par}, ${ben3.pct},
                  'alta por formulario', ${s.id}, ${u.id}, now()
                )
              `);
              q.push(sql`
                INSERT INTO consolidado_meses_test (registro_id, periodo, valor)
                VALUES (${nuevoUuid}, ${periodoActual()}, ${s.valor_mensual})
                ON CONFLICT (registro_id, periodo) DO NOTHING
              `);
            } else {
              q.push(sql`
                INSERT INTO consolidado_conciliacion (
                  id, empresa_id, nit, convenio_empresa, xc_subscriptionname__c, estado, canal_atencion,
                  fecha_cargue, fecha_corte, asociado, doc_asociado, fecha_retiro,
                  asistencia, asistencia_id, plan, plan_id, valor_con_iva, valor_sin_iva,
                  titular, tipo_doc, numero_identificacion, fecha_nacimiento, celular, correo,
                  ciudad_municipio, direccion_predio, edad,
                  nombre_beneficiario_1, tipo_doc_beneficiario_1, documento_numero_beneficiario_1, parentesco_1, porcentaje_1,
                  nombre_beneficiario_2, tipo_doc_beneficiario_2, documento_numero_beneficiario_2, parentesco_2, porcentaje_2,
                  nombre_beneficiario_3, tipo_doc_beneficiario_3, documento_numero_beneficiario_3, parentesco_3, porcentaje_3,
                  origen, solicitud_id, aprobado_por, aprobado_en
                ) VALUES (
                  ${nuevoUuid}, ${s.empresa_id}, ${emp.nit}, ${emp.nombre}, NULL, 'Activo', 'Venta Directa',
                  ${hoy}::date, NULL, ${s.titular_nombre}, ${s.titular_num_doc}, NULL,
                  ${s.asistencia}, ${s.asistencia_id}, ${s.plan}, ${s.plan_id}, ${s.valor_mensual}, NULL,
                  ${s.titular_nombre}, ${s.datos?.titular_tipo_doc || 'CC'}, ${s.titular_num_doc},
                  ${fnac ? sql`to_date(${fnac}, 'DD/MM/YYYY')` : null}, ${s.datos?.titular_celular || null}, ${s.datos?.titular_correo || null},
                  ${s.datos?.titular_ciudad || null}, ${s.datos?.titular_direccion || null}, ${edadCalc},
                  ${ben1.nom}, ${ben1.tdoc}, ${ben1.ndoc}, ${ben1.par}, ${ben1.pct},
                  ${ben2.nom}, ${ben2.tdoc}, ${ben2.ndoc}, ${ben2.par}, ${ben2.pct},
                  ${ben3.nom}, ${ben3.tdoc}, ${ben3.ndoc}, ${ben3.par}, ${ben3.pct},
                  'alta por formulario', ${s.id}, ${u.id}, now()
                )
              `);
              q.push(sql`
                INSERT INTO consolidado_meses (registro_id, periodo, valor)
                VALUES (${nuevoUuid}, ${periodoActual()}, ${s.valor_mensual})
                ON CONFLICT (registro_id, periodo) DO NOTHING
              `);
            }
          }
        } else {
          // Baja
          // 1. Legacy consolidado
          const c = cons.find(c => String(c.id) === String(s.consolidado_id));
          if (!c || c.estado !== 'activo') { avisos.push(`#${s.id}: la asistencia ya no está activa; se marca válida sin cambios en el consolidado.`); }
          if (c) {
            q.push(sql`UPDATE consolidado SET estado = 'retirado', fecha_baja = ${hoy}::date, baja_solicitud_id = ${s.id}, actualizado_en = now()
                       WHERE id = ${c.id} AND estado = 'activo'`);
          }

          // 2. Consolidado de conciliación: buscar coincidencia activa
          const cleanDoc = String(s.titular_num_doc || '').replace(/[^0-9A-Za-z]/g, '');
          const cleanEmpNit = (emp.nit || '').split('-')[0].replace(/[^0-9A-Za-z]/g, '');

          let candidatas = [];
          // Primero por ID directo si la solicitud trae consolidado_id
          if (s.consolidado_id) {
            if (esTest) {
              candidatas = await sql`
                SELECT id, direccion_predio FROM consolidado_conciliacion_test
                WHERE id::text = ${String(s.consolidado_id)} AND UPPER(BTRIM(estado)) = 'ACTIVO'
              `;
            } else {
              candidatas = await sql`
                SELECT id, direccion_predio FROM consolidado_conciliacion
                WHERE id::text = ${String(s.consolidado_id)} AND UPPER(BTRIM(estado)) = 'ACTIVO'
              `;
            }
          }

          // Si no se encontró por ID, buscar de forma tolerante por documento, NIT y asistencia
          if (!candidatas.length) {
            if (esTest) {
              candidatas = await sql`
                SELECT id, direccion_predio FROM consolidado_conciliacion_test
                WHERE (empresa_id = ${emp.id}
                       OR (regexp_replace(split_part(coalesce(nit, ''), '-', 1), '[^0-9A-Za-z]', '', 'g') = ${cleanEmpNit} AND coalesce(nit, '') <> ''))
                  AND (regexp_replace(coalesce(doc_asociado, ''), '[^0-9A-Za-z]', '', 'g') = ${cleanDoc}
                       OR regexp_replace(coalesce(numero_identificacion, ''), '[^0-9A-Za-z]', '', 'g') = ${cleanDoc})
                  AND asistencia = ${s.asistencia} AND UPPER(BTRIM(estado)) = 'ACTIVO'
              `;
            } else {
              candidatas = await sql`
                SELECT id, direccion_predio FROM consolidado_conciliacion
                WHERE (empresa_id = ${emp.id}
                       OR (regexp_replace(split_part(coalesce(nit, ''), '-', 1), '[^0-9A-Za-z]', '', 'g') = ${cleanEmpNit} AND coalesce(nit, '') <> ''))
                  AND (regexp_replace(coalesce(doc_asociado, ''), '[^0-9A-Za-z]', '', 'g') = ${cleanDoc}
                       OR regexp_replace(coalesce(numero_identificacion, ''), '[^0-9A-Za-z]', '', 'g') = ${cleanDoc})
                  AND asistencia = ${s.asistencia} AND UPPER(BTRIM(estado)) = 'ACTIVO'
              `;
            }
          }

          let regBaja = null;
          if (candidatas.length === 0) {
            avisos.push(`Solicitud #${s.id}: no se encontró suscripción activa en conciliación para ${s.titular_num_doc} con asistencia "${s.asistencia}".`);
          } else if (candidatas.length === 1) {
            regBaja = candidatas[0];
          } else {
            const dirSol = (s.datos?.titular_direccion || '').trim().toLowerCase();
            if (dirSol) {
              const coinc = candidatas.filter(cd => (cd.direccion_predio || '').trim().toLowerCase() === dirSol);
              if (coinc.length === 1) regBaja = coinc[0];
            }
            if (!regBaja) regBaja = candidatas[0];
          }

          if (regBaja) {
            if (esTest) {
              q.push(sql`
                UPDATE consolidado_conciliacion_test
                SET estado = 'Inactivo', fecha_retiro = ${hoy}::date, aprobado_por = ${u.id}, aprobado_en = now(), actualizado_en = now()
                WHERE id = ${regBaja.id}
              `);
            } else {
              q.push(sql`
                UPDATE consolidado_conciliacion
                SET estado = 'Inactivo', fecha_retiro = ${hoy}::date, aprobado_por = ${u.id}, aprobado_en = now(), actualizado_en = now()
                WHERE id = ${regBaja.id}
              `);
            }
          }

          // Notificar si el titular conserva otras asistencias activas
          let otras;
          if (esTest) {
            [otras] = await sql`
              SELECT count(*)::int AS n FROM consolidado_conciliacion_test
              WHERE (regexp_replace(coalesce(doc_asociado, ''), '[^0-9A-Za-z]', '', 'g') = ${cleanDoc}
                     OR regexp_replace(coalesce(numero_identificacion, ''), '[^0-9A-Za-z]', '', 'g') = ${cleanDoc})
                AND UPPER(BTRIM(estado)) = 'ACTIVO'
                ${regBaja ? sql`AND id != ${regBaja.id}` : sql``}
            `;
          } else {
            [otras] = await sql`
              SELECT count(*)::int AS n FROM consolidado_conciliacion
              WHERE (regexp_replace(coalesce(doc_asociado, ''), '[^0-9A-Za-z]', '', 'g') = ${cleanDoc}
                     OR regexp_replace(coalesce(numero_identificacion, ''), '[^0-9A-Za-z]', '', 'g') = ${cleanDoc})
                AND UPPER(BTRIM(estado)) = 'ACTIVO'
                ${regBaja ? sql`AND id != ${regBaja.id}` : sql``}
            `;
          }
          if (otras && otras.n > 0) {
            avisos.push(`Aviso: el titular ${s.titular_num_doc} conserva ${otras.n} otra(s) suscripción(es) activa(s) en el consolidado.`);
          }
        }
      }

      q.push(sql`UPDATE solicitudes SET estado = ${estado},
                   motivo = ${estado === 'invalida' ? motivo : null},
                   validado_por = ${estado === 'pendiente' ? null : u.id},
                   validado_en  = ${estado === 'pendiente' ? null : new Date().toISOString()}
                 WHERE id = ${s.id}`);
    }
    if (q.length) await sql.transaction(q);
    for (const s of sols) {
      if (s.estado === estado) continue;
      if (estado === 'valida' && s.enviado_por && s.enviado_por === u.id) continue;
      await auditar(req, u, estado === 'valida' ? 'aprobar' : (estado === 'invalida' ? 'rechazar' : 'pendiente'), String(s.id), {
        empresa_id: s.empresa_id, tipo: s.tipo, motivo: estado === 'invalida' ? motivo : null
      });
    }
    if (!q.length && avisos.length) {
      return res.status(403).json({ error: 'Segregación de funciones: no puede aprobar solicitudes enviadas por usted mismo.', avisos });
    }
    return res.status(200).json({ ok: true, avisos });
  },

  // ── Consolidado ───────────────────────────────────────────────────────────
  async consolidado(b, u, res, req) {
    const eid = empresaId(b.empresa_id);
    const filas = eid
      ? await sql`SELECT c.*, to_char(c.fecha_alta,'DD/MM/YYYY') AS fecha_alta_txt,
                    e.nombre AS empresa_nombre, e.nit AS empresa_nit,
                    COALESCE(c.modelo_aplicado, e.modelo) AS modelo_aplicado
                  FROM consolidado c JOIN empresas e ON e.id = c.empresa_id
                  WHERE c.empresa_id = ${eid}
                  ORDER BY e.nombre, c.titular_nombre LIMIT 50000`
      : await sql`SELECT c.*, to_char(c.fecha_alta,'DD/MM/YYYY') AS fecha_alta_txt,
                    e.nombre AS empresa_nombre, e.nit AS empresa_nit,
                    COALESCE(c.modelo_aplicado, e.modelo) AS modelo_aplicado
                  FROM consolidado c JOIN empresas e ON e.id = c.empresa_id
                  ORDER BY e.nombre, c.titular_nombre LIMIT 50000`;
    return res.status(200).json({ filas });
  },

  // ── Consolidado de Conciliación: Modo Prueba / Producción ───────────────────
  async consolidado_conciliacion_modo(b, u, res, req) {
    const modoActual = await obtenerModoConsolidado();
    if (b.nuevo_modo) {
      if (u.rol !== 'maestro') return err(res, 403, 'Solo el usuario maestro puede cambiar el modo del consolidado.');
      if (!['test', 'prod'].includes(b.nuevo_modo)) return err(res, 400, 'Modo inválido. Use "test" o "prod".');
      const modoSet = await establecerModoConsolidado(b.nuevo_modo);
      await auditar(req, u, 'cambiar_modo_consolidado', b.nuevo_modo, { modo_anterior: modoActual });
      return res.status(200).json({ ok: true, modo: modoSet, esTest: modoSet === 'test' });
    }
    return res.status(200).json({ ok: true, modo: modoActual, esTest: modoActual === 'test' });
  },

  // ── Consolidado de Conciliación: Listado con Paginación y Filtros ───────────
  async consolidado_conciliacion_listar(b, u, res, req) {
    const modoActivo = await obtenerModoConsolidado();
    const esTest = modoActivo !== 'prod';
    const eid = u.rol === 'empresa_admin' ? u.empresa_id : (b.empresa_id ? Number(b.empresa_id) : null);
    const estado = ['Activo', 'Inactivo'].includes(b.estado) ? b.estado : null;
    const soloSinXc = b.solo_sin_xc === true;
    const qTerm = b.q ? String(b.q).trim().toLowerCase() : '';
    const pagina = Math.max(1, Number(b.pagina) || 1);
    const limite = Math.min(200, Math.max(10, Number(b.limite) || 50));
    const offset = (pagina - 1) * limite;

    const periodosRows = esTest
      ? await sql`SELECT DISTINCT periodo FROM consolidado_meses_test ORDER BY periodo ASC`
      : await sql`SELECT DISTINCT periodo FROM consolidado_meses ORDER BY periodo ASC`;
    const periodos = periodosRows.map(r => r.periodo);

    const whereSql = esTest ? sql`
      WHERE (${eid}::int IS NULL OR empresa_id = ${eid})
        AND (${estado}::text IS NULL OR estado = ${estado})
        AND (${soloSinXc}::boolean = false OR (xc_subscriptionname__c IS NULL OR xc_subscriptionname__c = ''))
        AND (${qTerm} = '' OR (
          coalesce(numero_identificacion,'') ILIKE ${'%' + qTerm + '%'} OR
          coalesce(doc_asociado,'') ILIKE ${'%' + qTerm + '%'} OR
          coalesce(titular,'') ILIKE ${'%' + qTerm + '%'} OR
          coalesce(xc_subscriptionname__c,'') ILIKE ${'%' + qTerm + '%'} OR
          coalesce(asistencia,'') ILIKE ${'%' + qTerm + '%'} OR
          coalesce(convenio_empresa,'') ILIKE ${'%' + qTerm + '%'}
        ))
    ` : sql`
      WHERE (${eid}::int IS NULL OR empresa_id = ${eid})
        AND (${estado}::text IS NULL OR estado = ${estado})
        AND (${soloSinXc}::boolean = false OR (xc_subscriptionname__c IS NULL OR xc_subscriptionname__c = ''))
        AND (${qTerm} = '' OR (
          coalesce(numero_identificacion,'') ILIKE ${'%' + qTerm + '%'} OR
          coalesce(doc_asociado,'') ILIKE ${'%' + qTerm + '%'} OR
          coalesce(titular,'') ILIKE ${'%' + qTerm + '%'} OR
          coalesce(xc_subscriptionname__c,'') ILIKE ${'%' + qTerm + '%'} OR
          coalesce(asistencia,'') ILIKE ${'%' + qTerm + '%'} OR
          coalesce(convenio_empresa,'') ILIKE ${'%' + qTerm + '%'}
        ))
    `;

    const [conteo] = esTest
      ? await sql`SELECT count(*)::int AS total FROM consolidado_conciliacion_test ${whereSql}`
      : await sql`SELECT count(*)::int AS total FROM consolidado_conciliacion ${whereSql}`;
    const total = conteo ? conteo.total : 0;

    const filas = esTest
      ? await sql`
        SELECT *, to_char(fecha_cargue, 'YYYY-MM-DD') AS fecha_cargue_txt,
                  to_char(fecha_retiro, 'YYYY-MM-DD') AS fecha_retiro_txt,
                  to_char(fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento_txt
        FROM consolidado_conciliacion_test ${whereSql}
        ORDER BY convenio_empresa, titular, asistencia
        LIMIT ${limite} OFFSET ${offset}
      `
      : await sql`
        SELECT *, to_char(fecha_cargue, 'YYYY-MM-DD') AS fecha_cargue_txt,
                  to_char(fecha_retiro, 'YYYY-MM-DD') AS fecha_retiro_txt,
                  to_char(fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento_txt
        FROM consolidado_conciliacion ${whereSql}
        ORDER BY convenio_empresa, titular, asistencia
        LIMIT ${limite} OFFSET ${offset}
      `;

    const regIds = filas.map(f => f.id);
    const mesesMap = new Map();
    if (regIds.length) {
      const mesesRows = esTest
        ? await sql`SELECT registro_id, periodo, valor FROM consolidado_meses_test WHERE registro_id = ANY(${regIds})`
        : await sql`SELECT registro_id, periodo, valor FROM consolidado_meses WHERE registro_id = ANY(${regIds})`;
      for (const m of mesesRows) {
        if (!mesesMap.has(m.registro_id)) mesesMap.set(m.registro_id, {});
        mesesMap.get(m.registro_id)[m.periodo] = Number(m.valor) || 0;
      }
    }

    const filasConMeses = filas.map(f => ({
      ...f,
      edad: f.edad != null ? f.edad : calcularEdad(f.fecha_nacimiento_txt || f.fecha_nacimiento),
      meses: mesesMap.get(f.id) || {}
    }));

    // Cálculo preciso de KPIs y resumen "Qué tienen contratado"
    const todasSuscripciones = esTest
      ? await sql`
        SELECT c.id, c.empresa_id, c.estado, c.xc_subscriptionname__c,
               c.asistencia, c.plan, c.valor_con_iva,
               COALESCE(c.doc_asociado, c.numero_identificacion) AS doc,
               (
                 SELECT m.valor
                 FROM consolidado_meses_test m
                 WHERE m.registro_id = c.id AND m.valor > 0
                 ORDER BY m.periodo DESC
                 LIMIT 1
               ) AS ultimo_valor_mes
        FROM consolidado_conciliacion_test c
        WHERE (${eid}::int IS NULL OR c.empresa_id = ${eid})
      `
      : await sql`
        SELECT c.id, c.empresa_id, c.estado, c.xc_subscriptionname__c,
               c.asistencia, c.plan, c.valor_con_iva,
               COALESCE(c.doc_asociado, c.numero_identificacion) AS doc,
               (
                 SELECT m.valor
                 FROM consolidado_meses m
                 WHERE m.registro_id = c.id AND m.valor > 0
                 ORDER BY m.periodo DESC
                 LIMIT 1
               ) AS ultimo_valor_mes
        FROM consolidado_conciliacion c
        WHERE (${eid}::int IS NULL OR c.empresa_id = ${eid})
      `;

    const porDoc = new Map();
    let activasCount = 0, inactivasCount = 0, sinXcCount = 0;
    const mapaProductos = new Map();
    let totalValorActivo = 0;

    for (const s of todasSuscripciones) {
      const docClean = String(s.doc || '').trim();
      if (docClean) {
        porDoc.set(docClean, (porDoc.get(docClean) || 0) + 1);
      }
      const st = String(s.estado || '').trim().toUpperCase();
      const esActivo = st === 'ACTIVO';
      if (esActivo) activasCount++;
      else inactivasCount++;

      if (!s.xc_subscriptionname__c || !String(s.xc_subscriptionname__c).trim()) {
        sinXcCount++;
      }

      if (esActivo) {
        let planNombre = s.plan && String(s.plan).trim() ? String(s.plan).trim() : '';
        if (!planNombre || planNombre.toLowerCase() === 'plan único' || planNombre.toLowerCase() === 'plan unico') {
          const asisNorm = normalizarNombreAsistencia(s.asistencia);
          if (asisNorm.includes('MASCOTA')) planNombre = 'Hogar Mascotas';
          else if (asisNorm.includes('PROTECCION HOGAR') || asisNorm.includes('HOGAR')) planNombre = 'Plan 1';
          else planNombre = 'Plan Único';
        }

        let val = parsearDinero(s.valor_con_iva);
        if (!val && s.ultimo_valor_mes != null) {
          val = parsearDinero(s.ultimo_valor_mes);
        }
        if (!val) {
          val = precioCatalogo(s.asistencia, planNombre);
        }

        totalValorActivo += val;

        const kProd = `${s.asistencia || 'Sin Asistencia'} · ${planNombre}`;
        const prod = mapaProductos.get(kProd) || {
          asistencia: s.asistencia || 'Sin Asistencia',
          plan: planNombre,
          cantidad: 0,
          valor: 0
        };
        prod.cantidad++;
        prod.valor += val;
        mapaProductos.set(kProd, prod);
      }
    }

    let personasMulti = 0;
    for (const count of porDoc.values()) {
      if (count > 1) personasMulti++;
    }

    const productosContratados = [...mapaProductos.values()].sort((a, b) =>
      a.asistencia.localeCompare(b.asistencia) || a.plan.localeCompare(b.plan)
    );

    const kpisData = {
      total: todasSuscripciones.length,
      total_suscripciones: todasSuscripciones.length,
      personas_unicas: porDoc.size,
      activas: activasCount,
      inactivas: inactivasCount,
      pendientes_xc: sinXcCount,
      sin_xc: sinXcCount,
      personas_multi_asistencia: personasMulti,
      valor_total_activo: totalValorActivo,
      valor_mensual_total: totalValorActivo
    };

    return res.status(200).json({
      ok: true,
      modo: modoActivo,
      esTest,
      total,
      pagina,
      limite,
      periodos: periodos.map(p => ({ periodo: p, etiqueta: etiquetaPeriodo(p) })),
      filas: filasConMeses,
      kpis: kpisData,
      resumen_contratado: {
        por_producto: productosContratados,
        total_asistencias: activasCount,
        total_valor: totalValorActivo
      }
    });
  },

  // ── Consolidado de Conciliación: Vista Previa Obligatoria ───────────────────
  async consolidado_conciliacion_preview(b, u, res, req) {
    const filas = Array.isArray(b.filas) ? b.filas : [];
    if (!filas.length) return err(res, 400, 'El archivo no contiene filas de datos.');
    if (filas.length > 10000) return err(res, 400, 'El archivo excede el límite máximo de 10.000 filas.');

    const errores = [];
    const xcSet = new Set();
    const xcDuplicados = new Set();
    let sinXcCount = 0;
    const personaMap = new Map();
    const columnasDetectadas = new Set(Object.keys(filas[0] || {}));
    const mapeoMeses = [];

    for (const col of columnasDetectadas) {
      const per = periodoDeEtiqueta(col);
      if (per) {
        mapeoMeses.push({ columna: col, periodo: per, etiqueta: etiquetaPeriodo(per) });
      }
    }
    mapeoMeses.sort((a, b) => a.periodo.localeCompare(b.periodo));

    filas.forEach((f, idx) => {
      const numFila = idx + 2;
      const doc = String(f['DOC. ASOCIADO'] || f.doc_asociado || f['NUMERO DE IDENTIFICACIÓN'] || f.numero_identificacion || '').trim();
      const titular = String(f['TITULAR'] || f.titular || f['ASOCIADO'] || f.asociado || '').trim();
      const asistencia = String(f['ASISTENCIA'] || f.asistencia || '').trim();
      const nit = String(f['NIT'] || f.nit || '').trim();
      const xc = String(f['XC_SUBSCRIPTIONNAME__C'] || f.xc_subscriptionname__c || '').trim();

      if (!doc) errores.push(`Fila ${numFila}: falta documento del asociado / titular.`);
      if (!titular) errores.push(`Fila ${numFila}: falta nombre del titular / asociado.`);
      if (!asistencia) errores.push(`Fila ${numFila}: falta nombre de la asistencia.`);

      if (xc) {
        if (xcSet.has(xc)) xcDuplicados.add(xc);
        else xcSet.add(xc);
      } else {
        sinXcCount++;
      }

      const pKey = `${nit}__${doc}`;
      personaMap.set(pKey, (personaMap.get(pKey) || 0) + 1);
    });

    let personasMultiplesCount = 0;
    for (const [, cant] of personaMap.entries()) {
      if (cant > 1) personasMultiplesCount++;
    }

    const primeras20 = filas.slice(0, 20);

    return res.status(200).json({
      ok: true,
      preview: {
        total: filas.length,
        duplicados_xc_cant: xcDuplicados.size,
        duplicados_xc_lista: [...xcDuplicados].slice(0, 50),
        sin_xc_cant: sinXcCount,
        personas_multiples_cant: personasMultiplesCount,
        errores_cant: errores.length,
        errores: errores.slice(0, 50),
        mapeo_meses: mapeoMeses,
        columnas_detectadas: [...columnasDetectadas],
        primeras_20: primeras20
      }
    });
  },

  // ── Consolidado de Conciliación: Importación por Lotes ──────────────────────
  async consolidado_conciliacion_importar(b, u, res, req) {
    const modoActivo = await obtenerModoConsolidado();
    const esTest = modoActivo !== 'prod';
    const filas = Array.isArray(b.filas) ? b.filas : [];
    if (!filas.length) return err(res, 400, 'No hay filas para importar.');
    if (filas.length > 500) return err(res, 400, 'Lote máximo de 500 filas por llamada.');

    const accionDuplicados = b.accion_duplicados === 'actualizar' ? 'actualizar' : 'omitir';
    let insertadas = 0;
    let actualizadas = 0;
    let omitidas = 0;

    const emps = await sql`SELECT id, nit, nombre FROM empresas`;
    const empByNit = new Map(emps.map(e => [e.nit.replace(/\D/g, ''), e]));
    const empByNom = new Map(emps.map(e => [e.nombre.toLowerCase().trim(), e]));

    const parseFechaStr = v => {
      if (!v) return null;
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      const s = String(v).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      if (s.includes('/')) {
        const p = s.split('/');
        if (p.length === 3) return `${p[2].padStart(4, '20')}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
      }
      return null;
    };

    for (const f of filas) {
      const nit = String(f['NIT'] || f.nit || '').trim();
      const nitLimpio = nit.replace(/\D/g, '');
      const convenio = String(f['CONVENIO / EMPRESA'] || f.convenio_empresa || '').trim();
      let emp = empByNit.get(nitLimpio) || empByNom.get(convenio.toLowerCase()) || null;
      const empId = emp ? emp.id : null;

      const xc = String(f['XC_SUBSCRIPTIONNAME__C'] || f.xc_subscriptionname__c || '').trim() || null;
      const estado = String(f['ESTADO'] || f.estado || 'Activo').trim().toLowerCase().startsWith('inact') || String(f['ESTADO'] || '').toLowerCase().startsWith('retir') ? 'Inactivo' : 'Activo';
      const canal = String(f['CANAL DE ATENCIÓN'] || f.canal_atencion || 'Carga').trim();
      const fCargue = parseFechaStr(f['FECHA DE CARGUE'] || f.fecha_cargue) || fechaHoy();
      const fCorte = parseFechaStr(f['FECHA DE CORTE'] || f.fecha_corte);
      const fRetiro = parseFechaStr(f['FECHA DE RETIRO'] || f.fecha_retiro);
      const asociado = String(f['ASOCIADO'] || f.asociado || f['TITULAR'] || f.titular || '').trim();
      const docAsociado = String(f['DOC. ASOCIADO'] || f.doc_asociado || f['NUMERO DE IDENTIFICACIÓN'] || f.numero_identificacion || '').trim();
      const asistencia = String(f['ASISTENCIA'] || f.asistencia || '').trim();
      const plan = String(f['PLAN'] || f.plan || 'Plan Único').trim();
      let vIva = parsearDinero(f['VALOR CON IVA'] || f.valor_con_iva);
      if (!vIva) {
        // Fallback al último periodo registrado en las columnas de meses con valor > 0
        for (const [col, val] of Object.entries(f)) {
          const per = periodoDeEtiqueta(col);
          if (per) {
            const vm = parsearDinero(val);
            if (vm > 0) vIva = vm;
          }
        }
      }
      if (!vIva) {
        vIva = precioCatalogo(asistencia, plan);
      }
      const vSinIva = parsearDinero(f['VALOR SIN IVA'] || f.valor_sin_iva) || null;

      const titular = String(f['TITULAR'] || f.titular || asociado).trim();
      const tipoDoc = String(f['TIPO DOC.'] || f.tipo_doc || 'CC').trim().toUpperCase();
      const numDoc = String(f['NUMERO DE IDENTIFICACIÓN'] || f.numero_identificacion || docAsociado).trim();
      const fNac = parseFechaStr(f['FECHA DE NACIMIENTO'] || f.fecha_nacimiento);
      const celular = String(f['CELULAR'] || f.celular || '').trim() || null;
      const correo = String(f['CORREO'] || f.correo || '').trim() || null;
      const ciudad = String(f['CIUDAD O MUNICIPIO'] || f.ciudad_municipio || '').trim() || null;
      const direccion = String(f['DIRECCIÓN PREDIO'] || f.direccion_predio || '').trim() || null;
      const edadCalc = calcularEdad(fNac) || (Number(f['EDAD'] || f.edad) || null);

      const ben1 = {
        nom: String(f['NOMBRE BENEFICIARIO 1'] || f.nombre_beneficiario_1 || '').trim() || null,
        tdoc: String(f['TIPO DE DOC. BENEFICIARIO 1'] || f.tipo_doc_beneficiario_1 || '').trim() || null,
        ndoc: String(f['DOCUMENTO NÚMERO BENEFICIARIO'] || f.documento_numero_beneficiario_1 || '').trim() || null,
        par: String(f['PARENTESCO'] || f.parentesco_1 || '').trim() || null,
        pct: Number(f['%'] || f.porcentaje_1) || null
      };
      const ben2 = {
        nom: String(f['NOMBRE BENEFICIARIO 2'] || f.nombre_beneficiario_2 || '').trim() || null,
        tdoc: String(f['TIPO DE DOC. BENEFICIARIO 2'] || f.tipo_doc_beneficiario_2 || '').trim() || null,
        ndoc: String(f['DOCUMENTO NÚMERO BENEFICIARIO 2'] || f.documento_numero_beneficiario_2 || '').trim() || null,
        par: String(f['PARENTESCO2'] || f.parentesco_2 || '').trim() || null,
        pct: Number(f['%2'] || f.porcentaje_2) || null
      };
      const ben3 = {
        nom: String(f['NOMBRE BENEFICIARIO 3'] || f.nombre_beneficiario_3 || '').trim() || null,
        tdoc: String(f['TIPO DE DOC. BENEFICIARIO 3'] || f.tipo_doc_beneficiario_3 || '').trim() || null,
        ndoc: String(f['DOCUMENTO NÚMERO BENEFICIARIO 3'] || f.documento_numero_beneficiario_3 || '').trim() || null,
        par: String(f['PARENTESCO4'] || f.parentesco_3 || '').trim() || null,
        pct: Number(f['%3'] || f.porcentaje_3) || null
      };

      let existente;
      if (xc) {
        [existente] = esTest
          ? await sql`SELECT id FROM consolidado_conciliacion_test WHERE xc_subscriptionname__c = ${xc} LIMIT 1`
          : await sql`SELECT id FROM consolidado_conciliacion WHERE xc_subscriptionname__c = ${xc} LIMIT 1`;
      } else {
        [existente] = esTest
          ? await sql`SELECT id FROM consolidado_conciliacion_test WHERE nit = ${nit} AND doc_asociado = ${docAsociado} AND asistencia = ${asistencia} LIMIT 1`
          : await sql`SELECT id FROM consolidado_conciliacion WHERE nit = ${nit} AND doc_asociado = ${docAsociado} AND asistencia = ${asistencia} LIMIT 1`;
      }

      let regId;
      if (existente) {
        if (accionDuplicados === 'omitir') {
          omitidas++;
          continue;
        }
        regId = existente.id;
        if (esTest) {
          await sql`
            UPDATE consolidado_conciliacion_test SET
              empresa_id = coalesce(${empId}, empresa_id),
              nit = ${nit}, convenio_empresa = ${convenio}, estado = ${estado}, canal_atencion = ${canal},
              fecha_cargue = ${fCargue}::date, fecha_corte = ${fCorte}::date, fecha_retiro = ${fRetiro}::date,
              asociado = ${asociado}, doc_asociado = ${docAsociado}, asistencia = ${asistencia}, plan = coalesce(${plan}, plan),
              valor_con_iva = ${vIva}, valor_sin_iva = ${vSinIva}, titular = ${titular},
              tipo_doc = ${tipoDoc}, numero_identificacion = ${numDoc}, fecha_nacimiento = ${fNac}::date,
              celular = ${celular}, correo = ${correo}, ciudad_municipio = ${ciudad}, direccion_predio = ${direccion}, edad = ${edadCalc},
              nombre_beneficiario_1 = ${ben1.nom}, tipo_doc_beneficiario_1 = ${ben1.tdoc}, documento_numero_beneficiario_1 = ${ben1.ndoc}, parentesco_1 = ${ben1.par}, porcentaje_1 = ${ben1.pct},
              nombre_beneficiario_2 = ${ben2.nom}, tipo_doc_beneficiario_2 = ${ben2.tdoc}, documento_numero_beneficiario_2 = ${ben2.ndoc}, parentesco_2 = ${ben2.par}, porcentaje_2 = ${ben2.pct},
              nombre_beneficiario_3 = ${ben3.nom}, tipo_doc_beneficiario_3 = ${ben3.tdoc}, documento_numero_beneficiario_3 = ${ben3.ndoc}, parentesco_3 = ${ben3.par}, porcentaje_3 = ${ben3.pct},
              actualizado_en = now()
            WHERE id = ${regId}
          `;
        } else {
          await sql`
            UPDATE consolidado_conciliacion SET
              empresa_id = coalesce(${empId}, empresa_id),
              nit = ${nit}, convenio_empresa = ${convenio}, estado = ${estado}, canal_atencion = ${canal},
              fecha_cargue = ${fCargue}::date, fecha_corte = ${fCorte}::date, fecha_retiro = ${fRetiro}::date,
              asociado = ${asociado}, doc_asociado = ${docAsociado}, asistencia = ${asistencia}, plan = coalesce(${plan}, plan),
              valor_con_iva = ${vIva}, valor_sin_iva = ${vSinIva}, titular = ${titular},
              tipo_doc = ${tipoDoc}, numero_identificacion = ${numDoc}, fecha_nacimiento = ${fNac}::date,
              celular = ${celular}, correo = ${correo}, ciudad_municipio = ${ciudad}, direccion_predio = ${direccion}, edad = ${edadCalc},
              nombre_beneficiario_1 = ${ben1.nom}, tipo_doc_beneficiario_1 = ${ben1.tdoc}, documento_numero_beneficiario_1 = ${ben1.ndoc}, parentesco_1 = ${ben1.par}, porcentaje_1 = ${ben1.pct},
              nombre_beneficiario_2 = ${ben2.nom}, tipo_doc_beneficiario_2 = ${ben2.tdoc}, documento_numero_beneficiario_2 = ${ben2.ndoc}, parentesco_2 = ${ben2.par}, porcentaje_2 = ${ben2.pct},
              nombre_beneficiario_3 = ${ben3.nom}, tipo_doc_beneficiario_3 = ${ben3.tdoc}, documento_numero_beneficiario_3 = ${ben3.ndoc}, parentesco_3 = ${ben3.par}, porcentaje_3 = ${ben3.pct},
              actualizado_en = now()
            WHERE id = ${regId}
          `;
        }
        actualizadas++;
      } else {
        regId = crypto.randomUUID();
        if (esTest) {
          await sql`
            INSERT INTO consolidado_conciliacion_test (
              id, empresa_id, nit, convenio_empresa, xc_subscriptionname__c, estado, canal_atencion,
              fecha_cargue, fecha_corte, asociado, doc_asociado, fecha_retiro,
              asistencia, asistencia_id, plan, plan_id, valor_con_iva, valor_sin_iva,
              titular, tipo_doc, numero_identificacion, fecha_nacimiento, celular, correo,
              ciudad_municipio, direccion_predio, edad,
              nombre_beneficiario_1, tipo_doc_beneficiario_1, documento_numero_beneficiario_1, parentesco_1, porcentaje_1,
              nombre_beneficiario_2, tipo_doc_beneficiario_2, documento_numero_beneficiario_2, parentesco_2, porcentaje_2,
              nombre_beneficiario_3, tipo_doc_beneficiario_3, documento_numero_beneficiario_3, parentesco_3, porcentaje_3,
              origen, solicitud_id, aprobado_por, aprobado_en
            ) VALUES (
              ${regId}, ${empId}, ${nit}, ${convenio}, ${xc}, ${estado}, ${canal},
              ${fCargue}::date, ${fCorte}::date, ${asociado}, ${docAsociado}, ${fRetiro}::date,
              ${asistencia}, NULL, ${plan}, NULL, ${vIva}, ${vSinIva},
              ${titular}, ${tipoDoc}, ${numDoc}, ${fNac}::date, ${celular}, ${correo},
              ${ciudad}, ${direccion}, ${edadCalc},
              ${ben1.nom}, ${ben1.tdoc}, ${ben1.ndoc}, ${ben1.par}, ${ben1.pct},
              ${ben2.nom}, ${ben2.tdoc}, ${ben2.ndoc}, ${ben2.par}, ${ben2.pct},
              ${ben3.nom}, ${ben3.tdoc}, ${ben3.ndoc}, ${ben3.par}, ${ben3.pct},
              'importado', NULL, ${u.id}, now()
            )
          `;
        } else {
          await sql`
            INSERT INTO consolidado_conciliacion (
              id, empresa_id, nit, convenio_empresa, xc_subscriptionname__c, estado, canal_atencion,
              fecha_cargue, fecha_corte, asociado, doc_asociado, fecha_retiro,
              asistencia, asistencia_id, plan, plan_id, valor_con_iva, valor_sin_iva,
              titular, tipo_doc, numero_identificacion, fecha_nacimiento, celular, correo,
              ciudad_municipio, direccion_predio, edad,
              nombre_beneficiario_1, tipo_doc_beneficiario_1, documento_numero_beneficiario_1, parentesco_1, porcentaje_1,
              nombre_beneficiario_2, tipo_doc_beneficiario_2, documento_numero_beneficiario_2, parentesco_2, porcentaje_2,
              nombre_beneficiario_3, tipo_doc_beneficiario_3, documento_numero_beneficiario_3, parentesco_3, porcentaje_3,
              origen, solicitud_id, aprobado_por, aprobado_en
            ) VALUES (
              ${regId}, ${empId}, ${nit}, ${convenio}, ${xc}, ${estado}, ${canal},
              ${fCargue}::date, ${fCorte}::date, ${asociado}, ${docAsociado}, ${fRetiro}::date,
              ${asistencia}, NULL, ${plan}, NULL, ${vIva}, ${vSinIva},
              ${titular}, ${tipoDoc}, ${numDoc}, ${fNac}::date, ${celular}, ${correo},
              ${ciudad}, ${direccion}, ${edadCalc},
              ${ben1.nom}, ${ben1.tdoc}, ${ben1.ndoc}, ${ben1.par}, ${ben1.pct},
              ${ben2.nom}, ${ben2.tdoc}, ${ben2.ndoc}, ${ben2.par}, ${ben2.pct},
              ${ben3.nom}, ${ben3.tdoc}, ${ben3.ndoc}, ${ben3.par}, ${ben3.pct},
              'importado', NULL, ${u.id}, now()
            )
          `;
        }
        insertadas++;
      }

      for (const [col, val] of Object.entries(f)) {
        const per = periodoDeEtiqueta(col);
        const vMes = entero(val);
        if (per && vMes > 0) {
          if (esTest) {
            await sql`
              INSERT INTO consolidado_meses_test (registro_id, periodo, valor)
              VALUES (${regId}, ${per}, ${vMes})
              ON CONFLICT (registro_id, periodo) DO UPDATE SET valor = ${vMes}, actualizado_en = now()
            `;
          } else {
            await sql`
              INSERT INTO consolidado_meses (registro_id, periodo, valor)
              VALUES (${regId}, ${per}, ${vMes})
              ON CONFLICT (registro_id, periodo) DO UPDATE SET valor = ${vMes}, actualizado_en = now()
            `;
          }
        }
      }
    }

    await auditar(req, u, 'importar_consolidado_conciliacion', modoActivo, {
      insertadas, actualizadas, omitidas, total: filas.length
    });

    return res.status(200).json({ ok: true, insertadas, actualizadas, omitidas });
  },

  // ── Consolidado de Conciliación: Completar código XC ────────────────────────
  async consolidado_conciliacion_completar_xc(b, u, res, req) {
    const modoActivo = await obtenerModoConsolidado();
    const esTest = modoActivo !== 'prod';

    if (b.id && b.xc_subscriptionname__c !== undefined) {
      const xc = String(b.xc_subscriptionname__c || '').trim() || null;
      if (xc) {
        const [existe] = esTest
          ? await sql`SELECT id FROM consolidado_conciliacion_test WHERE xc_subscriptionname__c = ${xc} AND id != ${b.id} LIMIT 1`
          : await sql`SELECT id FROM consolidado_conciliacion WHERE xc_subscriptionname__c = ${xc} AND id != ${b.id} LIMIT 1`;
        if (existe) return err(res, 400, `El código XC "${xc}" ya está asignado a otra suscripción.`);
      }
      if (esTest) {
        await sql`UPDATE consolidado_conciliacion_test SET xc_subscriptionname__c = ${xc}, actualizado_en = now() WHERE id = ${b.id}`;
      } else {
        await sql`UPDATE consolidado_conciliacion SET xc_subscriptionname__c = ${xc}, actualizado_en = now() WHERE id = ${b.id}`;
      }
      await auditar(req, u, 'completar_xc_individual', String(b.id), { xc });
      return res.status(200).json({ ok: true, id: b.id, xc });
    }

    const filas = Array.isArray(b.filas) ? b.filas : [];
    if (!filas.length) return err(res, 400, 'Envíe "id" para edición individual o "filas" para carga masiva.');
    let actualizadas = 0;
    const errores = [];

    for (const item of filas) {
      const doc = String(item.doc || item.documento || item.numero_identificacion || '').trim();
      const asis = String(item.asistencia || '').trim();
      const xc = String(item.xc || item.xc_subscriptionname__c || '').trim();
      if (!doc || !xc) continue;

      let candidatas;
      if (asis) {
        candidatas = esTest
          ? await sql`SELECT id FROM consolidado_conciliacion_test WHERE doc_asociado = ${doc} AND asistencia ILIKE ${asis} LIMIT 2`
          : await sql`SELECT id FROM consolidado_conciliacion WHERE doc_asociado = ${doc} AND asistencia ILIKE ${asis} LIMIT 2`;
      } else {
        candidatas = esTest
          ? await sql`SELECT id FROM consolidado_conciliacion_test WHERE doc_asociado = ${doc} LIMIT 2`
          : await sql`SELECT id FROM consolidado_conciliacion WHERE doc_asociado = ${doc} LIMIT 2`;
      }

      if (candidatas.length === 1) {
        const regId = candidatas[0].id;
        try {
          if (esTest) {
            await sql`UPDATE consolidado_conciliacion_test SET xc_subscriptionname__c = ${xc}, actualizado_en = now() WHERE id = ${regId}`;
          } else {
            await sql`UPDATE consolidado_conciliacion SET xc_subscriptionname__c = ${xc}, actualizado_en = now() WHERE id = ${regId}`;
          }
          actualizadas++;
        } catch (xcErr) {
          errores.push(`Doc ${doc}: no se pudo asignar XC "${xc}" (${xcErr.message}).`);
        }
      } else if (candidatas.length > 1) {
        errores.push(`Doc ${doc}: tiene varias asistencias; especifique la asistencia exacta.`);
      }
    }

    await auditar(req, u, 'completar_xc_masivo', modoActivo, { actualizadas, errores: errores.length });
    return res.status(200).json({ ok: true, actualizadas, errores });
  },

  // ── Consolidado de Conciliación: Cierre Mensual ─────────────────────────────
  async consolidado_conciliacion_cierre_mensual(b, u, res, req) {
    const modoActivo = await obtenerModoConsolidado();
    const esTest = modoActivo !== 'prod';
    const periodo = String(b.periodo || '').trim();
    if (!/^\d{4}-\d{2}$/.test(periodo)) {
      return err(res, 400, 'Periodo inválido. Debe tener formato AAAA-MM (ej. 2026-10).');
    }

    const activas = esTest
      ? await sql`
        SELECT id, valor_con_iva FROM consolidado_conciliacion_test
        WHERE estado = 'Activo'
          AND (fecha_retiro IS NULL OR to_char(fecha_retiro, 'YYYY-MM') >= ${periodo})
      `
      : await sql`
        SELECT id, valor_con_iva FROM consolidado_conciliacion
        WHERE estado = 'Activo'
          AND (fecha_retiro IS NULL OR to_char(fecha_retiro, 'YYYY-MM') >= ${periodo})
      `;

    let liquidadas = 0;
    for (const r of activas) {
      const v = Number(r.valor_con_iva) || 0;
      if (esTest) {
        await sql`
          INSERT INTO consolidado_meses_test (registro_id, periodo, valor)
          VALUES (${r.id}, ${periodo}, ${v})
          ON CONFLICT (registro_id, periodo) DO UPDATE SET valor = ${v}, actualizado_en = now()
        `;
      } else {
        await sql`
          INSERT INTO consolidado_meses (registro_id, periodo, valor)
          VALUES (${r.id}, ${periodo}, ${v})
          ON CONFLICT (registro_id, periodo) DO UPDATE SET valor = ${v}, actualizado_en = now()
        `;
      }
      liquidadas++;
    }

    await auditar(req, u, 'cierre_mensual', periodo, { liquidadas, modo: modoActivo });
    return res.status(200).json({ ok: true, periodo, liquidadas });
  },

  // ── Consolidado de Conciliación: Reiniciar Datos de Prueba ──────────────────
  async consolidado_conciliacion_reset_test(b, u, res, req) {
    const modoActivo = await obtenerModoConsolidado();
    if (modoActivo !== 'test') {
      return err(res, 400, 'El reinicio solo está permitido cuando el sistema está en Modo Prueba.');
    }
    await sql`TRUNCATE TABLE consolidado_meses_test CASCADE`;
    await sql`TRUNCATE TABLE consolidado_conciliacion_test CASCADE`;
    await auditar(req, u, 'reiniciar_datos_prueba_consolidado', 'test', {});
    return res.status(200).json({ ok: true, mensaje: 'Datos de prueba limpiados exitosamente.' });
  },

  // ── Consolidado de Conciliación: Sembrar Datos de Ejemplo ───────────────────
  async consolidado_conciliacion_sembrar_ejemplo(b, u, res, req) {
    const modoActivo = await obtenerModoConsolidado();
    if (modoActivo !== 'test') {
      return err(res, 400, 'La carga de datos de ejemplo solo está permitida en Modo Prueba.');
    }

    await sql`TRUNCATE TABLE consolidado_meses_test CASCADE`;
    await sql`TRUNCATE TABLE consolidado_conciliacion_test CASCADE`;

    const targetEmpId = b.empresa_id ? Number(b.empresa_id) : (u.empresa_id ? Number(u.empresa_id) : null);
    let emp = null;
    if (targetEmpId) {
      [emp] = await sql`SELECT id, nit, nombre FROM empresas WHERE id = ${targetEmpId}`;
    }
    if (!emp) {
      [emp] = await sql`SELECT id, nit, nombre FROM empresas ORDER BY id ASC LIMIT 1`;
    }
    const nitDef = emp ? emp.nit : '900.123.456-1';
    const nomDef = emp ? emp.nombre : 'Alianza del Norte S.A.S.';
    const empIdDef = emp ? emp.id : null;

    const periodosHist = [
      '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09',
      '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04',
      '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'
    ];

    const ejemplos = [
      {
        xc: 'XC-2025-00101', doc: '1020304050', titular: 'Carlos Andrés Rodríguez Pardo',
        asistencia: 'Doctor 360', plan: 'Plan Único', valor: 28000, estado: 'Activo', fCargue: '2025-03-01', fRetiro: null,
        fnac: '1988-05-14', cel: '3101234567', mail: 'carlos.rodriguez@ejemplo.com',
        ciudad: 'Bogotá D.C.', dir: 'Calle 100 # 15-20 Apt 301',
        b1Nom: 'María Fernanda Rodríguez', b1Tdoc: 'TI', b1Doc: '1098765432', b1Par: 'Hijo(a)', b1Pct: 100
      },
      {
        xc: 'XC-2025-00102', doc: '1020304050', titular: 'Carlos Andrés Rodríguez Pardo',
        asistencia: 'Protección Hogar', plan: 'Plan 1', valor: 19500, estado: 'Activo', fCargue: '2025-03-01', fRetiro: null,
        fnac: '1988-05-14', cel: '3101234567', mail: 'carlos.rodriguez@ejemplo.com',
        ciudad: 'Bogotá D.C.', dir: 'Calle 100 # 15-20 Apt 301',
        b1Nom: null, b1Tdoc: null, b1Doc: null, b1Par: null, b1Pct: null
      },
      {
        xc: 'XC-2025-00103', doc: '52431678', titular: 'Gloria Esperanza Gómez Vargas',
        asistencia: 'Bienestar Integral', plan: 'Plan Único', valor: 45000, estado: 'Activo', fCargue: '2025-03-15', fRetiro: null,
        fnac: '1975-11-20', cel: '3209876543', mail: 'gloria.gomez@ejemplo.com',
        ciudad: 'Medellín', dir: 'Carrera 43A # 1 Sur-50',
        b1Nom: 'Jorge Iván Gómez', b1Tdoc: 'CC', b1Doc: '71234567', b1Par: 'Cónyuge', b1Pct: 50,
        b2Nom: 'Valeria Gómez', b2Tdoc: 'RC', b2Doc: '11223344', b2Par: 'Hijo(a)', b2Pct: 50
      },
      {
        xc: 'XC-2025-00104', doc: '80123456', titular: 'Fernando José Martínez Silva',
        asistencia: 'Asistencia Mascotas', plan: 'Hogar Mascotas', valor: 15000, estado: 'Inactivo', fCargue: '2025-04-01', fRetiro: '2026-05-15',
        fnac: '1982-08-30', cel: '3001122334', mail: 'fernando.martinez@ejemplo.com',
        ciudad: 'Cali', dir: 'Avenida 6N # 22-10',
        b1Nom: null, b1Tdoc: null, b1Doc: null, b1Par: null, b1Pct: null
      },
      {
        xc: null, doc: '1032456789', titular: 'Laura Cristina Morales Díaz',
        asistencia: 'Doctor 360', plan: 'Plan Único', valor: 28000, estado: 'Activo', fCargue: '2026-08-10', fRetiro: null,
        fnac: '1995-02-18', cel: '3158765432', mail: 'laura.morales@ejemplo.com',
        ciudad: 'Barranquilla', dir: 'Calle 72 # 54-30',
        b1Nom: 'Santiago Morales', b1Tdoc: 'TI', b1Doc: '1055443322', b1Par: 'Hermano(a)', b1Pct: 100
      },
      {
        xc: null, doc: '1018765432', titular: 'Felipe Arturo Castro Rincón',
        asistencia: 'Protección Hogar', plan: 'Plan 2', valor: 21000, estado: 'Activo', fCargue: '2026-09-01', fRetiro: null,
        fnac: '1991-09-09', cel: '3187654321', mail: 'felipe.castro@ejemplo.com',
        ciudad: 'Bucaramanga', dir: 'Carrera 27 # 36-14',
        b1Nom: null, b1Tdoc: null, b1Doc: null, b1Par: null, b1Pct: null
      },
      {
        xc: 'XC-2025-00107', doc: '1072345678', titular: 'Diana Patricia Salazar Torres',
        asistencia: 'Doctor 360', plan: 'Plan Único', valor: 28000, estado: 'Activo', fCargue: '2025-05-10', fRetiro: null,
        fnac: '1984-12-05', cel: '3124567890', mail: 'diana.salazar@ejemplo.com',
        ciudad: 'Pereira', dir: 'Carrera 7 # 19-28',
        b1Nom: 'Esteban Salazar', b1Tdoc: 'RC', b1Doc: '11998877', b1Par: 'Hijo(a)', b1Pct: 100
      },
      {
        xc: 'XC-2025-00108', doc: '79876543', titular: 'Héctor Fabio Ramírez López',
        asistencia: 'Bienestar Integral', plan: 'Plan Único', valor: 45000, estado: 'Activo', fCargue: '2025-06-01', fRetiro: null,
        fnac: '1979-04-22', cel: '3145678901', mail: 'hector.ramirez@ejemplo.com',
        ciudad: 'Manizales', dir: 'Calle 23 # 21-45',
        b1Nom: null, b1Tdoc: null, b1Doc: null, b1Par: null, b1Pct: null
      },
      {
        xc: 'XC-2025-00109', doc: '1098761234', titular: 'Camila Andrea Ospina Mejía',
        asistencia: 'Asistencia Mascotas', plan: 'Hogar Mascotas', valor: 15000, estado: 'Activo', fCargue: '2025-07-20', fRetiro: null,
        fnac: '1998-07-11', cel: '3167890123', mail: 'camila.ospina@ejemplo.com',
        ciudad: 'Armenia', dir: 'Avenida Bolívar # 14N-55',
        b1Nom: null, b1Tdoc: null, b1Doc: null, b1Par: null, b1Pct: null
      },
      {
        xc: 'XC-2025-00110', doc: '1030987654', titular: 'Juan Guillermo Herrera Flórez',
        asistencia: 'Protección Hogar', plan: 'Plan 1', valor: 19500, estado: 'Inactivo', fCargue: '2025-03-01', fRetiro: '2026-03-31',
        fnac: '1987-03-17', cel: '3178901234', mail: 'juan.herrera@ejemplo.com',
        ciudad: 'Cartagena', dir: 'Bocagrande Carrera 3 # 6-40',
        b1Nom: null, b1Tdoc: null, b1Doc: null, b1Par: null, b1Pct: null
      }
    ];

    let totalMeses = 0;
    for (const ej of ejemplos) {
      const uId = crypto.randomUUID();
      const edad = calcularEdad(ej.fnac);

      await sql`
        INSERT INTO consolidado_conciliacion_test (
          id, empresa_id, nit, convenio_empresa, xc_subscriptionname__c, estado, canal_atencion,
          fecha_cargue, fecha_corte, asociado, doc_asociado, fecha_retiro,
          asistencia, asistencia_id, plan, plan_id, valor_con_iva, valor_sin_iva,
          titular, tipo_doc, numero_identificacion, fecha_nacimiento, celular, correo,
          ciudad_municipio, direccion_predio, edad,
          nombre_beneficiario_1, tipo_doc_beneficiario_1, documento_numero_beneficiario_1, parentesco_1, porcentaje_1,
          nombre_beneficiario_2, tipo_doc_beneficiario_2, documento_numero_beneficiario_2, parentesco_2, porcentaje_2,
          nombre_beneficiario_3, tipo_doc_beneficiario_3, documento_numero_beneficiario_3, parentesco_3, porcentaje_3,
          origen, solicitud_id, aprobado_por, aprobado_en
        ) VALUES (
          ${uId}, ${empIdDef}, ${nitDef}, ${nomDef}, ${ej.xc}, ${ej.estado}, 'Venta Directa',
          ${ej.fCargue}::date, NULL, ${ej.titular}, ${ej.doc}, ${ej.fRetiro}::date,
          ${ej.asistencia}, NULL, ${ej.plan || 'Plan Único'}, NULL, ${ej.valor}, NULL,
          ${ej.titular}, 'CC', ${ej.doc}, ${ej.fnac}::date, ${ej.cel}, ${ej.mail},
          ${ej.ciudad}, ${ej.dir}, ${edad},
          ${ej.b1Nom || null}, ${ej.b1Tdoc || null}, ${ej.b1Doc || null}, ${ej.b1Par || null}, ${ej.b1Pct || null},
          ${ej.b2Nom || null}, ${ej.b2Tdoc || null}, ${ej.b2Doc || null}, ${ej.b2Par || null}, ${ej.b2Pct || null},
          NULL, NULL, NULL, NULL, NULL,
          'formulario', NULL, ${u.id}, now()
        )
      `;

      for (const p of periodosHist) {
        if (p < ej.fCargue.slice(0, 7)) continue;
        if (ej.fRetiro && p > ej.fRetiro.slice(0, 7)) continue;
        await sql`
          INSERT INTO consolidado_meses_test (registro_id, periodo, valor)
          VALUES (${uId}, ${p}, ${ej.valor})
        `;
        totalMeses++;
      }
    }

    await auditar(req, u, 'sembrar_ejemplo_consolidado', '10_registros', {});
    return res.status(200).json({ ok: true, insertados: ejemplos.length, meses: totalMeses, cargadas: ejemplos.length });
  },

  // ── Consolidado de Conciliación: Exportación Completa ───────────────────────
  async consolidado_conciliacion_exportar(b, u, res, req) {
    const modoActivo = await obtenerModoConsolidado();
    const esTest = modoActivo !== 'prod';
    const eid = u.rol === 'empresa_admin' ? u.empresa_id : (b.empresa_id ? Number(b.empresa_id) : null);
    const estado = ['Activo', 'Inactivo'].includes(b.estado) ? b.estado : null;
    const soloSinXc = b.solo_sin_xc === true;
    const qTerm = b.q ? String(b.q).trim().toLowerCase() : '';

    const periodosRows = esTest
      ? await sql`SELECT DISTINCT periodo FROM consolidado_meses_test ORDER BY periodo ASC`
      : await sql`SELECT DISTINCT periodo FROM consolidado_meses ORDER BY periodo ASC`;
    const periodos = periodosRows.map(r => r.periodo);

    const whereSql = esTest ? sql`
      WHERE (${eid}::int IS NULL OR empresa_id = ${eid})
        AND (${estado}::text IS NULL OR estado = ${estado})
        AND (${soloSinXc}::boolean = false OR (xc_subscriptionname__c IS NULL OR xc_subscriptionname__c = ''))
        AND (${qTerm} = '' OR (
          coalesce(numero_identificacion,'') ILIKE ${'%' + qTerm + '%'} OR
          coalesce(doc_asociado,'') ILIKE ${'%' + qTerm + '%'} OR
          coalesce(titular,'') ILIKE ${'%' + qTerm + '%'} OR
          coalesce(xc_subscriptionname__c,'') ILIKE ${'%' + qTerm + '%'} OR
          coalesce(asistencia,'') ILIKE ${'%' + qTerm + '%'} OR
          coalesce(convenio_empresa,'') ILIKE ${'%' + qTerm + '%'}
        ))
    ` : sql`
      WHERE (${eid}::int IS NULL OR empresa_id = ${eid})
        AND (${estado}::text IS NULL OR estado = ${estado})
        AND (${soloSinXc}::boolean = false OR (xc_subscriptionname__c IS NULL OR xc_subscriptionname__c = ''))
        AND (${qTerm} = '' OR (
          coalesce(numero_identificacion,'') ILIKE ${'%' + qTerm + '%'} OR
          coalesce(doc_asociado,'') ILIKE ${'%' + qTerm + '%'} OR
          coalesce(titular,'') ILIKE ${'%' + qTerm + '%'} OR
          coalesce(xc_subscriptionname__c,'') ILIKE ${'%' + qTerm + '%'} OR
          coalesce(asistencia,'') ILIKE ${'%' + qTerm + '%'} OR
          coalesce(convenio_empresa,'') ILIKE ${'%' + qTerm + '%'}
        ))
    `;

    const filas = esTest
      ? await sql`
        SELECT *, to_char(fecha_cargue, 'YYYY-MM-DD') AS fecha_cargue_txt,
                  to_char(fecha_retiro, 'YYYY-MM-DD') AS fecha_retiro_txt,
                  to_char(fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento_txt
        FROM consolidado_conciliacion_test ${whereSql}
        ORDER BY convenio_empresa, titular, asistencia
      `
      : await sql`
        SELECT *, to_char(fecha_cargue, 'YYYY-MM-DD') AS fecha_cargue_txt,
                  to_char(fecha_retiro, 'YYYY-MM-DD') AS fecha_retiro_txt,
                  to_char(fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento_txt
        FROM consolidado_conciliacion ${whereSql}
        ORDER BY convenio_empresa, titular, asistencia
      `;

    const regIds = filas.map(f => f.id);
    const mesesMap = new Map();
    if (regIds.length) {
      const mesesRows = esTest
        ? await sql`SELECT registro_id, periodo, valor FROM consolidado_meses_test WHERE registro_id = ANY(${regIds})`
        : await sql`SELECT registro_id, periodo, valor FROM consolidado_meses WHERE registro_id = ANY(${regIds})`;
      for (const m of mesesRows) {
        if (!mesesMap.has(m.registro_id)) mesesMap.set(m.registro_id, {});
        mesesMap.get(m.registro_id)[m.periodo] = Number(m.valor) || 0;
      }
    }

    const filasExport = filas.map(f => ({
      ...f,
      edad: f.edad != null ? f.edad : calcularEdad(f.fecha_nacimiento_txt || f.fecha_nacimiento),
      meses: mesesMap.get(f.id) || {}
    }));

    await auditar(req, u, 'descargar_consolidado_conciliacion', modoActivo, {
      total: filas.length, modo: modoActivo
    });

    return res.status(200).json({
      ok: true,
      modo: modoActivo,
      esTest,
      periodos: periodos.map(p => ({ periodo: p, etiqueta: etiquetaPeriodo(p) })),
      filas: filasExport
    });
  },

  // ── Importar consolidado inicial desde CSV/Excel ──────────────────────────
  async importar(b, u, res, req) {
    const eid = empresaId(b.empresa_id);
    const [emp] = eid ? await sql`SELECT id, modelo FROM empresas WHERE id = ${eid}` : [];
    if (!emp) return err(res, 400, 'Elija la empresa a la que pertenece el archivo.');
    const filas = Array.isArray(b.filas) ? b.filas : [];
    if (!filas.length || filas.length > 3000) return err(res, 400, 'El archivo debe tener entre 1 y 3.000 filas.');
    const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const buscar = (asis, plan) => {
      const a = norm(asis), p = norm(plan);
      return PRODUCTOS.find(x => [norm(x.asistencia), norm(x.asistencia_id), norm(CATALOGO[x.asistencia_id].t)].includes(a) &&
        [norm(x.plan), norm(x.plan_id)].includes(p)) || null;
    };
    const errores = []; const validas = [];
    filas.forEach((f, i) => {
      const doc = texto(f.titular_num_doc, 20), nombre = texto(f.titular_nombre, 200), prod = buscar(f.asistencia, f.plan);
      const pago = ['Nomina', 'Empresa', 'Cofinanciado'].find(p => norm(p) === norm(f.pago)) || null;
      const fila = i + 2;
      if (!/^[0-9A-Za-z]{4,20}$/.test(doc)) errores.push(`Fila ${fila}: documento inválido`);
      else if (!nombre) errores.push(`Fila ${fila}: falta el nombre`);
      else if (!prod) errores.push(`Fila ${fila}: asistencia/plan no reconocidos ("${texto(f.asistencia, 40)}" / "${texto(f.plan, 40)}")`);
      else {
        let modeloAplicado = emp.modelo <= 2 ? emp.modelo : null;
        if (emp.modelo === 3) {
          const modStr = Number(f.modelo || f.modelo_aplicado);
          if ([1, 2].includes(modStr)) modeloAplicado = modStr;
          else if (pago === 'Nomina') modeloAplicado = 1;
          else if (['Empresa', 'Cofinanciado'].includes(pago)) modeloAplicado = 2;
          else { errores.push(`Fila ${fila}: empresa mixta requiere columna "modelo" (1 o 2) o "pago" válido`); return; }
        }
        validas.push({
          doc, nombre, prod, pago,
          valor: entero(f.valor_mensual),
          personas: Math.max(1, Math.min(20, entero(f.personas) || 1)),
          mascota: texto(f.mascota, 200) || null,
          tipo_doc: texto(f.titular_tipo_doc, 5) || 'CC',
          modelo_aplicado: modeloAplicado
        });
      }
    });
    if (errores.length) return res.status(400).json({ error: `El archivo tiene ${errores.length} fila(s) con errores. No se cargó nada.`, errores: errores.slice(0, 50) });
    const hoy = fechaHoy();
    const r = await sql.transaction(validas.map(v =>
      sql`INSERT INTO consolidado (empresa_id, titular_num_doc, titular_nombre, asistencia_id, asistencia,
          plan_id, plan, mascota, pago, valor_mensual, valor_empresa, valor_colaborador, personas,
          fecha_alta, origen, modelo_aplicado, datos)
        SELECT ${emp.id}, ${v.doc}, ${v.nombre}, ${v.prod.asistencia_id}, ${v.prod.asistencia},
          ${v.prod.plan_id}, ${v.prod.plan}, ${v.mascota}, ${v.pago}, ${v.valor},
          ${v.pago === 'Empresa' ? v.valor : 0}, ${v.pago === 'Nomina' ? v.valor : 0},
          ${v.personas}, ${hoy}::date, 'importado', ${v.modelo_aplicado},
          ${JSON.stringify({ titular_tipo_doc: v.tipo_doc })}::jsonb
        WHERE NOT EXISTS (
          SELECT 1 FROM consolidado WHERE empresa_id = ${emp.id} AND estado = 'activo'
          AND titular_num_doc = ${v.doc} AND asistencia_id = ${v.prod.asistencia_id}
          AND plan_id = ${v.prod.plan_id} AND coalesce(mascota,'') = ${v.mascota || ''}
        )
        RETURNING id`));
    const cargadas = r.filter(x => x.length).length;
    await auditar(req, u, 'importar', String(emp.id), { cargadas, total: validas.length });
    return res.status(200).json({ ok: true, cargadas, omitidas: validas.length - cargadas });
  },

  // ── Altas Masivas ───────────────────────────────────────────────────────────
  async altas_masivas(b, u, res, req) {
    if (!['maestro', 'empresa_admin'].includes(u.rol)) return res.status(403).json({ error: 'No autorizado' });
    const empId = u.rol === 'empresa_admin' ? u.empresa_id : parseInt(b.empresa_id);
    if (!empId) return res.status(400).json({ error: 'Falta empresa_id' });
    const [emp] = await sql`SELECT * FROM empresas WHERE id = ${empId}`;
    if (!emp || !emp.activa) return res.status(400).json({ error: 'Empresa inactiva o no existe' });

    if (!b.id_lote || !Array.isArray(b.filas) || !b.filas.length) return res.status(400).json({ error: 'Faltan filas o id_lote' });
    if (b.filas.length > 3000) return res.status(400).json({ error: 'Máximo 3000 filas por lote' });

    const ids = b.filas.map((_, i) => `${b.id_lote}-F${i + 2}`);
    const existentesQuery = await sql`SELECT id_inscripcion FROM solicitudes WHERE empresa_id = ${empId} AND id_inscripcion = ANY(${ids})`;
    const existentes = new Set(existentesQuery.map(x => x.id_inscripcion));

    const errores = [];
    const validas = [];
    let omitidas_repetidas = 0;
    const norm = s => String(s || '').trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

    const parseExcelDate = v => {
      if (!v) return null;
      if (typeof v === 'number') {
        const d = new Date(Math.round((v - 25569) * 86400 * 1000));
        return `${d.getUTCDate().toString().padStart(2, '0')}/${(d.getUTCMonth() + 1).toString().padStart(2, '0')}/${d.getUTCFullYear()}`;
      }
      const txt = String(v).trim();
      return /^(\d{2})\/(\d{2})\/(\d{4})$/.test(txt) ? txt : null;
    };

    b.filas.forEach((f, i) => {
      const fila = i + 2;
      const id_inscripcion = `${b.id_lote}-F${fila}`;
      if (existentes.has(id_inscripcion)) {
        omitidas_repetidas++;
        return;
      }

      let rawDoc = f.num_doc || f.titular_num_doc || '';
      if (typeof rawDoc === 'number') {
        if (rawDoc.toString().includes('e') || rawDoc.toString().includes('E')) {
          errores.push(`Fila ${fila}: La cédula está en notación científica; formatee la columna como Texto en Excel`);
          return;
        }
        rawDoc = Math.floor(rawDoc).toString();
      }
      const doc = String(rawDoc).trim();

      const nombres = String(f.nombres || '').trim();
      const apellidos = String(f.apellidos || '').trim();
      const a = norm(f.asistencia);
      const p = norm(f.plan);
      const prod = PRODUCTOS.find(x => norm(x.asistencia) === a && norm(x.plan) === p || norm(x.asistencia_id) === a && norm(x.plan_id) === p);
      const pago = ['Nomina', 'Empresa', 'Cofinanciado'].find(x => norm(x) === norm(f.forma_pago || f.pago)) || null;

      const fecha_nac = parseExcelDate(f.fecha_nac);

      if (!/^[0-9A-Za-z]{4,20}$/.test(doc)) errores.push(`Fila ${fila}: documento inválido (${doc})`);
      else if (!nombres || !apellidos) errores.push(`Fila ${fila}: falta nombres o apellidos`);
      else if (!prod) errores.push(`Fila ${fila}: asistencia/plan no reconocidos`);
      else if (emp.productos && emp.productos.length && !emp.productos.includes(`${prod.asistencia_id}:${prod.plan_id}`)) errores.push(`Fila ${fila}: producto no habilitado`);
      else if (!fecha_nac) errores.push(`Fila ${fila}: fecha de nacimiento inválida o vacía`);
      else {
        let modeloAplicado = emp.modelo <= 2 ? emp.modelo : null;
        if (emp.modelo === 3) {
          const modStr = Number(f.modelo);
          if ([1, 2].includes(modStr)) modeloAplicado = modStr;
          else if (pago === 'Nomina') modeloAplicado = 1;
          else if (['Empresa', 'Cofinanciado'].includes(pago)) modeloAplicado = 2;
          else { errores.push(`Fila ${fila}: empresa mixta requiere columna "modelo" (1 o 2) o "forma_pago" válida`); return; }
        }

        const vm = Number(f.valor_mensual) || prod.valor;
        validas.push({
          empresa_id: emp.id,
          tipo: 'alta',
          origen_tipo: 'excel',
          estado: 'pendiente',
          id_inscripcion,
          titular_num_doc: doc,
          titular_nombre: `${nombres} ${apellidos}`.trim(),
          asistencia_id: prod.asistencia_id,
          asistencia: prod.asistencia,
          plan_id: prod.plan_id,
          plan: prod.plan,
          personas: 1,
          pago: pago,
          valor_mensual: vm,
          modelo_aplicado: modeloAplicado,
          datos: {
            id_lote: b.id_lote,
            titular_num_doc: doc,
            titular_nombres: nombres,
            titular_apellidos: apellidos,
            titular_tipo_doc: String(f.tipo_doc || 'CC').trim(),
            titular_fecha_nac: fecha_nac,
            titular_genero: String(f.genero || ''),
            titular_celular: String(f.celular || ''),
            titular_correo: String(f.correo || ''),
            titular_ciudad: String(f.ciudad || ''),
            titular_direccion: String(f.direccion || ''),
            asesor: u.nombre,
            pago_id: pago,
            modelo_aplicado: modeloAplicado,
            valor_mensual: vm,
            valor_empresa: pago === 'Empresa' ? vm : 0,
            valor_colaborador: pago === 'Nomina' ? vm : 0,
            aut_descuento: b.archivo_soporte_id ? 'Si' : '',
            aut_datos: 'Si'
          }
        });
      }
    });

    if (validas.length > 0) {
      await sql.transaction(validas.map(v =>
        sql`INSERT INTO solicitudes (empresa_id, id_inscripcion, tipo, origen_tipo, enviado_por, titular_num_doc, titular_nombre, asistencia_id, asistencia, plan_id, plan, personas, pago, valor_mensual, modelo_aplicado, datos, estado, recibido_en, periodo)
            VALUES (${v.empresa_id}, ${v.id_inscripcion}, ${v.tipo}, ${v.origen_tipo}, ${u.id}, ${v.titular_num_doc}, ${v.titular_nombre}, ${v.asistencia_id}, ${v.asistencia}, ${v.plan_id}, ${v.plan}, ${v.personas}, ${v.pago}, ${v.valor_mensual}, ${v.modelo_aplicado}, ${JSON.stringify(v.datos)}::jsonb, ${v.estado}, now(), ${periodoActual()})`
      ));
    }

    await auditar(req, u, 'importar', String(emp.id), { id_lote: b.id_lote, cargadas: validas.length, omitidas: omitidas_repetidas });
    return res.status(200).json({ ok: true, cargadas: validas.length, omitidas: omitidas_repetidas, errores });
  },

  // ── Empresas ──────────────────────────────────────────────────────────────
  async empresas(b, u, res, req) {
    const filas = await sql`SELECT e.id, e.nit, e.nombre, e.modelo,
        COALESCE(e.dominios, '[]'::jsonb) AS dominios,
        e.productos, e.activa,
        (SELECT count(*)::int FROM consolidado c WHERE c.empresa_id = e.id AND c.estado = 'activo') AS activos,
        (SELECT count(*)::int FROM usuarios x WHERE x.empresa_id = e.id AND x.activo) AS usuarios
      FROM empresas e ORDER BY e.nombre`;
    return res.status(200).json({ filas, productos: PRODUCTOS });
  },

  async empresa_guardar(b, u, res, req) {
    const nit = texto(b.nit, 20).replace(/[^0-9-]/g, '');
    const nombre = texto(b.nombre, 150);
    const modelo = [1, 2, 3].includes(Number(b.modelo)) ? Number(b.modelo) : 1;
    const productos = Array.isArray(b.productos)
      ? [...new Set(b.productos.filter(k => PRODUCTOS.some(p => p.clave === k)))] : [];
    const activa = b.activa !== false;
    if (!/^[0-9]{5,12}(-[0-9])?$/.test(nit)) return err(res, 400, 'Escriba un NIT válido (solo números, con o sin dígito de verificación).');
    if (nombre.length < 2) return err(res, 400, 'Escriba el nombre de la empresa.');
    const id = empresaId(b.id);
    try {
      const [e] = id
        ? await sql`UPDATE empresas SET nit = ${nit}, nombre = ${nombre}, modelo = ${modelo},
                      productos = ${JSON.stringify(productos)}::jsonb, activa = ${activa}
                    WHERE id = ${id} RETURNING id`
        : await sql`INSERT INTO empresas (nit, nombre, modelo, productos, activa)
                    VALUES (${nit}, ${nombre}, ${modelo}, ${JSON.stringify(productos)}::jsonb, ${activa})
                    RETURNING id`;
      if (!e) return err(res, 404, 'Empresa no encontrada.');
      await auditar(req, u, id ? 'editar_empresa' : 'crear_empresa', String(e.id), { nit, nombre });
      return res.status(200).json({ ok: true, id: e.id });
    } catch (x) {
      if (String(x.message).includes('duplicate') || x.code === '23505') return err(res, 409, 'Ya existe una empresa con ese NIT.');
      throw x;
    }
  },

  // ── Dominios corporativos de una empresa ─────────────────────────────────
  async dominios_guardar(b, u, res, req) {
    const id = empresaId(b.empresa_id);
    if (!id) return err(res, 400, 'Elija la empresa.');
    const rawDominios = Array.isArray(b.dominios) ? b.dominios : [];
    // Normalizar y filtrar: lowercase, sin espacios, sin públicos
    const dominios = [...new Set(rawDominios
      .map(d => String(d).trim().toLowerCase())
      .filter(d => d && /^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/.test(d) && !DOMINIOS_PUBLICOS.has(d))
    )];
    // Verificar que ningún dominio esté en otra empresa activa
    if (dominios.length) {
      const conflictos = await sql`
        SELECT id, nombre FROM empresas
        WHERE dominios ?| ${dominios}::text[] AND id <> ${id} AND activa`;
      if (conflictos.length) {
        const usados = conflictos.map(c => c.nombre).join(', ');
        return err(res, 409, `Uno o más dominios ya están asignados a: ${usados}`);
      }
    }
    await sql`UPDATE empresas SET dominios = ${JSON.stringify(dominios)}::jsonb WHERE id = ${id}`;
    await auditar(req, u, 'editar_empresa', String(id), { dominios });
    return res.status(200).json({ ok: true, dominios });
  },

  // ── Usuarios (gestión global, solo maestro) ───────────────────────────────
  async usuarios(b, u, res, req) {
    const filas = await sql`SELECT x.id, x.email, x.nombre, x.rol, x.empresa_id, x.activo,
        x.ultimo_ingreso, COALESCE(x.estado_acceso, 'activo') AS estado_acceso,
        e.nombre AS empresa_nombre
      FROM usuarios x LEFT JOIN empresas e ON e.id = x.empresa_id
      ORDER BY x.rol, e.nombre NULLS FIRST, x.nombre`;
    return res.status(200).json({ filas });
  },

  async usuario_guardar(b, u, res, req) {
    const email = texto(b.email, 200).toLowerCase();
    const nombre = texto(b.nombre, 150);
    const ROLES_VALIDOS = ['maestro', 'validador', 'empresa_admin', 'empresa_usuario'];
    const rol = ROLES_VALIDOS.includes(b.rol) ? b.rol : null;
    const esDeEmpresa = ['empresa_admin', 'empresa_usuario'].includes(rol);
    const eid = esDeEmpresa ? empresaId(b.empresa_id) : null;
    const activo = b.activo !== false;
    const estadoAcceso = ['activo', 'pendiente', 'rechazado'].includes(b.estado_acceso) ? b.estado_acceso : 'activo';

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err(res, 400, 'Escriba un correo válido.');
    if (nombre.length < 3) return err(res, 400, 'Escriba el nombre del usuario.');
    if (!rol) return err(res, 400, 'Elija el rol.');
    if (esDeEmpresa && !eid) return err(res, 400, 'Elija la empresa del usuario.');

    // Si la empresa tiene dominios registrados, el correo debe corresponder
    // (excepción: el maestro puede forzar con excepcion_dominio=true)
    if (esDeEmpresa && !b.excepcion_dominio) {
      const [emp] = await sql`SELECT COALESCE(dominios, '[]'::jsonb) AS dominios FROM empresas WHERE id = ${eid}`;
      if (emp && Array.isArray(emp.dominios) && emp.dominios.length > 0) {
        const dom = dominioDeEmail(email);
        if (!emp.dominios.includes(dom))
          return err(res, 400, `El dominio del correo (${dom}) no está en la lista de dominios de esta empresa. Active "excepción de dominio" para continuar.`);
      }
    }

    const id = empresaId(b.id);
    if (id && id === u.id && (!activo || rol !== 'maestro')) return err(res, 400, 'No puede quitarse a sí mismo el rol de maestro ni desactivarse.');
    try {
      if (id) {
        const [x] = await sql`UPDATE usuarios SET email = ${email}, nombre = ${nombre}, rol = ${rol},
            empresa_id = ${eid}, activo = ${activo}, estado_acceso = ${estadoAcceso},
            version = version + CASE WHEN rol <> ${rol} OR empresa_id IS DISTINCT FROM ${eid}
              OR activo <> ${activo} OR estado_acceso <> ${estadoAcceso} THEN 1 ELSE 0 END
          WHERE id = ${id} RETURNING id`;
        if (!x) return err(res, 404, 'Usuario no encontrado.');
        await auditar(req, u, 'editar_usuario', email, { rol, empresa_id: eid });
        return res.status(200).json({ ok: true, id: x.id });
      }
      const clave = claveTemporal();
      const [x] = await sql`INSERT INTO usuarios (email, nombre, hash, rol, empresa_id, activo, estado_acceso, debe_cambiar_clave)
        VALUES (${email}, ${nombre}, ${hashClave(clave)}, ${rol}, ${eid}, ${activo}, ${estadoAcceso}, true)
        RETURNING id`;
      await auditar(req, u, 'crear_usuario', email, { rol, empresa_id: eid });
      return res.status(200).json({ ok: true, id: x.id, clave_temporal: clave });
    } catch (x) {
      if (String(x.message).includes('duplicate') || x.code === '23505') return err(res, 409, 'Ya existe un usuario con ese correo.');
      throw x;
    }
  },

  async usuario_clave(b, u, res, req) {
    const id = empresaId(b.id);
    const clave = claveTemporal();
    const [x] = id ? await sql`UPDATE usuarios SET hash = ${hashClave(clave)}, debe_cambiar_clave = true, version = version + 1
      WHERE id = ${id} RETURNING id` : [];
    if (!x) return err(res, 404, 'Usuario no encontrado.');
    await auditar(req, u, 'editar_usuario', String(id), { accion: 'resetear_clave' });
    return res.status(200).json({ ok: true, clave_temporal: clave });
  },

  // Activar / rechazar un usuario pendiente de aprobación (global, maestro)
  async usuario_activar(b, u, res, req) {
    const id = empresaId(b.id);
    const accionActivar = b.aprobar !== false; // true = aprobar, false = rechazar
    if (!id) return err(res, 400, 'ID de usuario requerido.');
    const [x] = await sql`UPDATE usuarios
        SET activo = ${accionActivar}, estado_acceso = ${accionActivar ? 'activo' : 'rechazado'},
            version = version + 1
        WHERE id = ${id} AND estado_acceso = 'pendiente'
        RETURNING id`;
    if (!x) return err(res, 404, 'Usuario no encontrado o no está pendiente.');
    await auditar(req, u, 'editar_usuario', String(id), { estado_acceso: accionActivar ? 'activo' : 'rechazado' });
    return res.status(200).json({ ok: true });
  },

  // ── Acciones de empresa_admin (solo su propia empresa) ────────────────────
  async mis_usuarios(b, u, res, req) {
    // Siempre filtra por la empresa de la sesión (no acepta empresa_id del body)
    const filas = await sql`SELECT id, email, nombre, rol, activo,
        COALESCE(estado_acceso, 'activo') AS estado_acceso, ultimo_ingreso
      FROM usuarios WHERE empresa_id = ${u.empresa_id} ORDER BY nombre`;
    return res.status(200).json({ filas });
  },

  async mi_usuario_guardar(b, u, res, req) {
    const email = texto(b.email, 200).toLowerCase();
    const nombre = texto(b.nombre, 150);
    // Lista explícita y cerrada de roles que empresa_admin puede gestionar
    const ROLES_ASIGNABLES_EMPRESA = new Set(['empresa_usuario']);
    const rolSolicitado = b.rol ? String(b.rol) : 'empresa_usuario';

    if (!ROLES_ASIGNABLES_EMPRESA.has(rolSolicitado)) {
      return err(res, 403, 'No tiene permiso para asignar ese rol. Solo puede gestionar usuarios con rol empresa_usuario.');
    }
    const rol = 'empresa_usuario';
    const activo = b.activo !== false;
    const estadoAcceso = ['activo', 'pendiente', 'rechazado'].includes(b.estado_acceso) ? b.estado_acceso : 'activo';

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err(res, 400, 'Escriba un correo válido.');
    if (nombre.length < 3) return err(res, 400, 'Escriba el nombre del usuario.');

    // Verificar dominio corporativo
    if (!b.excepcion_dominio) {
      const [emp] = await sql`SELECT COALESCE(dominios, '[]'::jsonb) AS dominios FROM empresas WHERE id = ${u.empresa_id}`;
      if (emp && Array.isArray(emp.dominios) && emp.dominios.length > 0) {
        const dom = dominioDeEmail(email);
        if (!emp.dominios.includes(dom))
          return err(res, 400, `El dominio del correo (${dom}) no está registrado para su empresa.`);
      }
    }

    const id = empresaId(b.id);
    // Un empresa_admin no puede auto-modificarse desde este panel ni alterar su propio rol
    if (id && id === u.id) {
      return err(res, 400, 'No puede modificar su propia cuenta de administrador desde este panel.');
    }

    try {
      if (id) {
        // Verificar que el usuario exista, pertenezca a su empresa y sea estrictamente empresa_usuario
        const [targetUser] = await sql`
          SELECT id, rol, empresa_id FROM usuarios
           WHERE id = ${id} AND empresa_id = ${u.empresa_id} LIMIT 1`;
        if (!targetUser) return err(res, 404, 'Usuario no encontrado en su empresa.');
        if (targetUser.rol !== 'empresa_usuario') {
          return err(res, 403, 'No tiene permiso para modificar usuarios con roles superiores o distintos a empresa_usuario.');
        }

        // El empresa_id NUNCA cambia: se mantiene forzado a u.empresa_id
        const [x] = await sql`UPDATE usuarios SET email = ${email}, nombre = ${nombre},
            activo = ${activo}, estado_acceso = ${estadoAcceso},
            version = version + 1
          WHERE id = ${id} AND empresa_id = ${u.empresa_id} RETURNING id`;
        await auditar(req, u, 'editar_usuario', email, { rol: 'empresa_usuario', empresa_id: u.empresa_id });
        return res.status(200).json({ ok: true, id: x.id });
      }

      // Creación de nuevo usuario: rol fijado a 'empresa_usuario' literal y empresa_id forzado a u.empresa_id de la sesión
      const clave = claveTemporal();
      const [x] = await sql`INSERT INTO usuarios (email, nombre, hash, rol, empresa_id, activo, estado_acceso, debe_cambiar_clave)
        VALUES (${email}, ${nombre}, ${hashClave(clave)}, 'empresa_usuario', ${u.empresa_id}, ${activo}, ${estadoAcceso}, true)
        RETURNING id`;
      await auditar(req, u, 'crear_usuario', email, { rol: 'empresa_usuario', empresa_id: u.empresa_id });
      return res.status(200).json({ ok: true, id: x.id, clave_temporal: clave });
    } catch (x) {
      if (String(x.message).includes('duplicate') || x.code === '23505') return err(res, 409, 'Ya existe un usuario con ese correo.');
      throw x;
    }
  },

  async mi_usuario_clave(b, u, res, req) {
    const id = empresaId(b.id);
    if (!id) return err(res, 400, 'ID de usuario requerido.');
    if (id === u.id) {
      return err(res, 400, 'Para cambiar su propia contraseña utilice la opción "Cambiar contraseña" en la barra superior.');
    }

    // Verificar que pertenezca a su empresa y que sea un empresa_usuario
    const [targetUser] = await sql`
      SELECT id, rol FROM usuarios WHERE id = ${id} AND empresa_id = ${u.empresa_id} LIMIT 1`;
    if (!targetUser) return err(res, 404, 'Usuario no encontrado en su empresa.');
    if (targetUser.rol !== 'empresa_usuario') {
      return err(res, 403, 'Solo puede restablecer contraseñas de usuarios con rol empresa_usuario.');
    }

    const clave = claveTemporal();
    await sql`UPDATE usuarios SET hash = ${hashClave(clave)}, debe_cambiar_clave = true, version = version + 1
      WHERE id = ${id} AND empresa_id = ${u.empresa_id}`;
    await auditar(req, u, 'editar_usuario', String(id), { accion: 'resetear_clave' });
    return res.status(200).json({ ok: true, clave_temporal: clave });
  },

  // empresa_admin activa o rechaza solicitudes de acceso de su propia empresa
  async mi_usuario_activar(b, u, res, req) {
    const id = empresaId(b.id);
    const aprobar = b.aprobar !== false;
    if (!id) return err(res, 400, 'ID de usuario requerido.');
    if (id === u.id) return err(res, 400, 'No puede modificar su propio estado de acceso.');

    // Verificar que pertenezca a su empresa y esté pendiente
    const [targetUser] = await sql`
      SELECT id, rol FROM usuarios
       WHERE id = ${id} AND empresa_id = ${u.empresa_id} AND estado_acceso = 'pendiente' LIMIT 1`;
    if (!targetUser) return err(res, 404, 'Usuario no encontrado o no está pendiente en su empresa.');
    if (targetUser.rol !== 'empresa_usuario') {
      return err(res, 403, 'No tiene permiso para activar usuarios con rol diferente a empresa_usuario.');
    }

    await sql`UPDATE usuarios
        SET activo = ${aprobar}, estado_acceso = ${aprobar ? 'activo' : 'rechazado'},
            version = version + 1
        WHERE id = ${id} AND empresa_id = ${u.empresa_id}`;
    await auditar(req, u, 'editar_usuario', String(id), { estado_acceso: aprobar ? 'activo' : 'rechazado' });
    return res.status(200).json({ ok: true });
  }
};
