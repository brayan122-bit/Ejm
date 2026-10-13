import { sql, asegurarEsquema, origenValido, leerCuerpo, auditar, ipDe, crearLimitador } from './_db.js';
import { exigir, esRolEmpresa } from './_auth.js';
import { handleUpload } from '@vercel/blob/client';
import { put, del } from '@vercel/blob';
import crypto from 'crypto';

// Roles explícitamente autorizados para operaciones de archivos (denegar por defecto)
const ROLES_PERMITIDOS_ARCHIVO = new Set(['maestro', 'validador', 'empresa_admin', 'empresa_usuario']);

// Límite de peticiones de subida por IP: máx 30 peticiones por minuto
const limitadorSubida = crearLimitador(30, 60 * 1000);

// Valida si el host pertenece a la configuración o al dominio vercel-storage
function hostEsValido(hostRecibido) {
  const h = (hostRecibido || '').toLowerCase();
  const hostConfig = (process.env.BLOB_HOST || '').trim().toLowerCase();
  if (hostConfig) {
    if (h === hostConfig) return true;
    if (h === hostConfig.replace('.public.', '.private.')) return true;
    if (h === hostConfig.replace('.private.', '.public.')) return true;
  }
  if (h.endsWith('.blob.vercel-storage.com') || h === 'blob.vercel-storage.com') {
    return true;
  }
  return false;
}

// Validación estricta por contenido real (Magic Bytes)
function detectarTipoContenido(buffer) {
  if (!buffer || buffer.length < 4) return null;
  // PDF: %PDF (0x25 0x50 0x44 0x46)
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return 'application/pdf';
  }
  // JPEG: FF D8 FF
  if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'image/jpeg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer.length >= 8 &&
      buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
      buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A) {
    return 'image/png';
  }
  return null;
}

// Lee el buffer de la petición soportando streams no leídos y buffers preprocesados
async function leerBufferRequest(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  const chunks = [];
  try {
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
  } catch (err) {
    console.error('Error leyendo chunks del stream HTTP:', err);
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : null;
}

// Parsea la solicitud soportando multipart/form-data, application/json y binario directo
async function parsearSolicitud(req) {
  const cType = (req.headers['content-type'] || '').toLowerCase();

  if (cType.includes('multipart/form-data')) {
    const rawBuffer = await leerBufferRequest(req);
    if (!rawBuffer || rawBuffer.length === 0) {
      return { accion: 'subir', fileBuffer: null };
    }
    const dummyRes = new Response(rawBuffer, {
      headers: { 'content-type': req.headers['content-type'] }
    });
    const formData = await dummyRes.formData();
    const accion = String(formData.get('accion') || 'subir');
    const tipo = String(formData.get('tipo') || '');
    const id_inscripcion = String(formData.get('id_inscripcion') || '');
    const empresa_id = formData.get('empresa_id') ? Number(formData.get('empresa_id')) : null;
    const fileEntry = formData.get('archivo') || formData.get('file');
    let fileBuffer = null;
    let fileName = '';
    if (fileEntry && typeof fileEntry.arrayBuffer === 'function') {
      fileBuffer = Buffer.from(await fileEntry.arrayBuffer());
      fileName = fileEntry.name || '';
    }
    return {
      accion,
      tipo,
      id_inscripcion,
      empresa_id,
      fileBuffer,
      fileName,
      esMultipart: true
    };
  }

  if (cType.includes('application/json')) {
    let b = leerCuerpo(req);
    if (!b) {
      const rawBuffer = await leerBufferRequest(req);
      if (rawBuffer) {
        try { b = JSON.parse(rawBuffer.toString('utf8')); } catch {}
      }
    }
    b = b || {};
    let fileBuffer = null;
    if (b.contenido_base64 && typeof b.contenido_base64 === 'string') {
      fileBuffer = Buffer.from(b.contenido_base64, 'base64');
    }
    return {
      accion: String(b.accion || ''),
      tipo: String(b.tipo || ''),
      id_inscripcion: String(b.id_inscripcion || ''),
      empresa_id: b.empresa_id ? Number(b.empresa_id) : null,
      pathname: b.pathname,
      bodyJson: b,
      fileBuffer,
      esJson: true
    };
  }

  // Flujo binario directo (application/octet-stream o application/pdf)
  const fileBuffer = await leerBufferRequest(req);
  const q = req.query || {};
  return {
    accion: String(q.accion || 'subir'),
    tipo: String(q.tipo || req.headers['x-tipo'] || ''),
    id_inscripcion: String(q.id_inscripcion || req.headers['x-id-inscripcion'] || ''),
    empresa_id: q.empresa_id ? Number(q.empresa_id) : (req.headers['x-empresa-id'] ? Number(req.headers['x-empresa-id']) : null),
    fileBuffer,
    esBinario: true
  };
}

export default async function handler(req, res) {
  try {
    // 1. Autenticación y principio de "denegar por defecto"
    const u = await exigir(req, res);
    if (!u) return;

    if (!ROLES_PERMITIDOS_ARCHIVO.has(u.rol) || !u.activo) {
      return res.status(403).json({ error: 'Acceso denegado: rol no autorizado o usuario inactivo.' });
    }

    // ── GET: Descarga protegida a través del proxy autenticado ──────────────
    if (req.method === 'GET') {
      const { id } = req.query;
      if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Falta el ID del archivo' });
      
      await asegurarEsquema();
      const [archivo] = await sql`SELECT * FROM archivos WHERE id = ${id}`;
      
      if (!archivo) {
        return res.status(404).json({ error: 'Archivo no encontrado' });
      }
      if (esRolEmpresa(u.rol) && archivo.empresa_id !== u.empresa_id) {
        return res.status(403).json({ error: 'Acceso denegado: el archivo no pertenece a su empresa.' });
      }
      
      let urlObj;
      try { urlObj = new URL(archivo.url); } catch { return res.status(400).json({ error: 'URL inválida en la base de datos' }); }
      
      // Verificación estricta del host
      if (urlObj.protocol !== 'https:' || !hostEsValido(urlObj.host)) {
        return res.status(400).json({ error: 'Host de almacenamiento no autorizado' });
      }
      
      const headersFetch = process.env.BLOB_READ_WRITE_TOKEN
        ? { 'Authorization': `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` }
        : {};
      const blobRes = await fetch(archivo.url, { headers: headersFetch });
      if (!blobRes.ok) return res.status(404).json({ error: 'Archivo no encontrado' });
      
      const blobBuf = Buffer.from(await blobRes.arrayBuffer());
      const mimeDetectado = detectarTipoContenido(blobBuf);
      if (!mimeDetectado) {
        return res.status(400).json({ error: 'El archivo descargado contiene un formato no permitido o corrupto' });
      }

      const ext = mimeDetectado === 'application/pdf' ? 'pdf' : (mimeDetectado === 'image/jpeg' ? 'jpg' : 'png');
      const rawFilename = `${archivo.tipo}_${archivo.id_inscripcion}_${archivo.id.slice(0, 8)}.${ext}`;
      const safeFilename = rawFilename.replace(/[^a-zA-Z0-9_\-\.]/g, '_');

      // Cabeceras estrictas de descarga segura
      res.setHeader('Content-Type', mimeDetectado);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
      res.setHeader('Content-Security-Policy', 'sandbox');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      await auditar(req, u, 'descargar', String(archivo.id), { id_inscripcion: archivo.id_inscripcion, tipo: archivo.tipo });
      return res.send(blobBuf);
    }
    
    // ── Métodos de modificación (POST): validación de origen ────────────────
    if (!origenValido(req)) return res.status(403).json({ error: 'Origen no permitido' });
    
    if (req.method === 'POST') {
      const sol = await parsearSolicitud(req);
      const b = sol.bodyJson || {};
      const accion = sol.accion;
      
      // ── Subida cliente directa con handleUpload (@vercel/blob/client) ─────
      if (b.type === 'blob.generate-client-token' || b.type === 'blob.upload-completed') {
        const jsonResponse = await handleUpload({
          body: b,
          request: req,
          onBeforeGenerateToken: async (pathname, clientPayload) => {
            let pData = {};
            try { pData = JSON.parse(clientPayload || '{}'); } catch {}
            const tipo = pData.tipo || (pathname.includes('pdf_inscripcion') ? 'pdf_inscripcion' : 'soporte_nomina');
            const id_inscripcion = pData.id_inscripcion || (pathname.split('/')[1] ? pathname.split('/')[1].split('_')[0] : 'N/A');

            await asegurarEsquema();
            let targetEmpresaId = u.empresa_id;
            if (!esRolEmpresa(u.rol)) {
              if (pData.empresa_id) {
                const [emp] = await sql`SELECT id FROM empresas WHERE id = ${pData.empresa_id}`;
                if (emp) targetEmpresaId = emp.id;
              }
            }

            let allowedContentTypes;
            let maximumSizeInBytes;
            if (tipo === 'pdf_inscripcion') {
              allowedContentTypes = ['application/pdf'];
              maximumSizeInBytes = 3 * 1024 * 1024;
            } else {
              const tiposSoporte = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
              if (pData.contentType && !tiposSoporte.includes(pData.contentType)) {
                tiposSoporte.push(pData.contentType);
              }
              allowedContentTypes = tiposSoporte;
              maximumSizeInBytes = 4 * 1024 * 1024;
            }

            const validUntil = Date.now() + 30 * 60 * 1000;
            const cleanPathname = pathname.replace(/^\//, '').trim();
            await sql`INSERT INTO archivos_pendientes (pathname, empresa_id, usuario_id, id_inscripcion, tipo, expira_en)
                      VALUES (${cleanPathname}, ${targetEmpresaId}, ${u.id}, ${id_inscripcion}, ${tipo}, now() + interval '30 minutes')
                      ON CONFLICT (pathname) DO NOTHING`;

            const tokenPayload = JSON.stringify({ empresa_id: targetEmpresaId, tipo, id_inscripcion });
            return {
              allowedContentTypes,
              maximumSizeInBytes,
              validUntil,
              tokenPayload
            };
          }
        });
        return res.status(200).json(jsonResponse);
      }

      // ── Acción nueva: Subida directa en el servidor con put() de @vercel/blob ──
      if (accion === 'subir') {
        const ip = ipDe(req);
        if (limitadorSubida.excedido(ip)) {
          return res.status(429).json({ error: 'Demasiadas solicitudes de subida desde esta IP. Intente más tarde.' });
        }
        limitadorSubida.registrar(ip);

        const { tipo, id_inscripcion, fileBuffer } = sol;

        if (!['pdf_inscripcion', 'soporte_nomina'].includes(tipo)) {
          return res.status(400).json({ error: 'Tipo de archivo inválido. Solo se permite pdf_inscripcion o soporte_nomina.' });
        }

        if (!id_inscripcion || !/^[A-Za-z0-9_-]{5,80}$/.test(id_inscripcion)) {
          return res.status(400).json({ error: 'ID de inscripción inválido o no suministrado.' });
        }

        // Validación de tamaño máximo (4 MB)
        const MAX_BYTES = 4 * 1024 * 1024;
        if (!fileBuffer || fileBuffer.length === 0) {
          return res.status(400).json({ error: 'No se recibió ningún archivo o el archivo está vacío.' });
        }
        if (fileBuffer.length > MAX_BYTES) {
          return res.status(400).json({ error: 'El archivo excede el tamaño máximo permitido de 4 MB.' });
        }

        // Validación de tipo real de archivo (Magic Bytes)
        const mimeReal = detectarTipoContenido(fileBuffer);
        if (tipo === 'pdf_inscripcion') {
          // Para PDF, debe empezar exactamente por %PDF (0x25 0x50 0x44 0x46)
          const esPdf = fileBuffer.length >= 4 &&
            fileBuffer[0] === 0x25 && fileBuffer[1] === 0x50 &&
            fileBuffer[2] === 0x44 && fileBuffer[3] === 0x46;
          if (!esPdf || mimeReal !== 'application/pdf') {
            return res.status(400).json({ error: 'El archivo de inscripción debe ser un documento PDF válido que empiece por %PDF.' });
          }
        } else {
          // Soporte de nómina: PDF, JPEG o PNG
          if (!mimeReal || !['application/pdf', 'image/jpeg', 'image/png'].includes(mimeReal)) {
            return res.status(400).json({ error: 'El soporte debe ser un archivo válido en formato PDF, JPG o PNG.' });
          }
        }

        // Validación en servidor: que la inscripción exista y corresponda a quien sube (empresa, id_inscripcion)
        await asegurarEsquema();
        const [solicitud] = await sql`SELECT empresa_id FROM solicitudes WHERE id_inscripcion = ${id_inscripcion} LIMIT 1`;
        if (!solicitud) {
          return res.status(404).json({ error: 'La inscripción indicada no existe en el sistema.' });
        }

        let targetEmpresaId = solicitud.empresa_id;
        if (esRolEmpresa(u.rol)) {
          if (solicitud.empresa_id !== u.empresa_id) {
            return res.status(403).json({ error: 'Acceso denegado: la inscripción no pertenece a su empresa.' });
          }
          targetEmpresaId = u.empresa_id;
        }

        // Pathname con una parte aleatoria larga y sin datos personales (nada de la cédula)
        const ext = mimeReal === 'application/pdf' ? 'pdf' : (mimeReal === 'image/jpeg' ? 'jpg' : 'png');
        const aleatorioLargo = crypto.randomBytes(24).toString('hex'); // 48 caracteres aleatorios seguros
        const pathname = `${targetEmpresaId}/${tipo}_${aleatorioLargo}.${ext}`;

        let blobResult;
        try {
          blobResult = await put(pathname, fileBuffer, {
            access: 'private',
            addRandomSuffix: true,
            contentType: mimeReal,
            token: process.env.BLOB_READ_WRITE_TOKEN
          });
        } catch (putErr) {
          console.error('Error completo en put() de @vercel/blob:', putErr);
          return res.status(500).json({
            error: `Error al almacenar archivo en Vercel Blob: ${putErr?.message || 'Error desconocido'}`
          });
        }

        // Si ya existía un archivo previo para esta inscripción y tipo (reintento), reemplazar
        const [previo] = await sql`SELECT id, url FROM archivos WHERE id_inscripcion = ${id_inscripcion} AND tipo = ${tipo} LIMIT 1`;
        if (previo) {
          try {
            await del(previo.url, { token: process.env.BLOB_READ_WRITE_TOKEN });
          } catch (delPrevErr) {
            console.error('Advertencia eliminando archivo previo reemplazado:', delPrevErr?.message);
          }
          await sql`DELETE FROM archivos WHERE id = ${previo.id}`;
        }

        const id = crypto.randomUUID();
        await sql`INSERT INTO archivos (id, empresa_id, id_inscripcion, tipo, url)
                  VALUES (${id}, ${targetEmpresaId}, ${id_inscripcion}, ${tipo}, ${blobResult.url})`;

        await auditar(req, u, 'subir', String(id), { id_inscripcion, tipo });

        return res.status(200).json({ ok: true, id, url: blobResult.url });
      }

      // ── Acción 1: Emitir token temporal de subida (compatibilidad) ────────
      if (accion === 'token_subida') {
        const { tipo, id_inscripcion } = b;
        if (!['pdf_inscripcion', 'soporte_nomina'].includes(tipo)) {
          return res.status(400).json({ error: 'Tipo de archivo inválido' });
        }
        if (!id_inscripcion || !/^[A-Za-z0-9_-]{5,80}$/.test(id_inscripcion)) {
          return res.status(400).json({ error: 'ID de inscripción inválido' });
        }
        
        await asegurarEsquema();
        const [solExistente] = await sql`SELECT empresa_id FROM solicitudes WHERE id_inscripcion = ${id_inscripcion} LIMIT 1`;
        
        let targetEmpresaId = u.empresa_id;
        if (!esRolEmpresa(u.rol)) {
          if (solExistente) targetEmpresaId = solExistente.empresa_id;
          else if (b.empresa_id) {
            const [emp] = await sql`SELECT id FROM empresas WHERE id = ${b.empresa_id}`;
            if (emp) targetEmpresaId = emp.id;
            else return res.status(400).json({ error: 'Empresa no encontrada' });
          } else return res.status(400).json({ error: 'Falta empresa_id para roles internos' });
        } else {
          if (solExistente && solExistente.empresa_id !== u.empresa_id) {
            return res.status(403).json({ error: 'No tiene permiso para adjuntar a esta solicitud' });
          }
        }
        
        let allowedContentTypes;
        let maximumSizeInBytes;
        const ext = tipo === 'pdf_inscripcion' ? 'pdf' : 'pdf';
        if (tipo === 'pdf_inscripcion') {
          allowedContentTypes = ['application/pdf'];
          maximumSizeInBytes = 3 * 1024 * 1024;
        } else {
          allowedContentTypes = ['application/pdf', 'image/jpeg', 'image/png'];
          maximumSizeInBytes = 4 * 1024 * 1024;
        }
        
        const r = crypto.randomBytes(12).toString('hex');
        const pathname = `${targetEmpresaId}/${id_inscripcion}_${tipo}_${r}.${ext}`;
        
        await sql`INSERT INTO archivos_pendientes (pathname, empresa_id, usuario_id, id_inscripcion, tipo, expira_en)
                  VALUES (${pathname}, ${targetEmpresaId}, ${u.id}, ${id_inscripcion}, ${tipo}, now() + interval '30 minutes')
                  ON CONFLICT (pathname) DO NOTHING`;
        
        const validUntil = Date.now() + 30 * 60 * 1000;
        const tokenPayload = JSON.stringify({ empresa_id: targetEmpresaId, tipo, id_inscripcion });

        const jsonResponse = await handleUpload({
          body: {
            type: 'blob.generate-client-token',
            payload: {
              pathname,
              clientPayload: tokenPayload,
              multipart: false
            }
          },
          request: req,
          onBeforeGenerateToken: async () => ({
            allowedContentTypes,
            maximumSizeInBytes,
            validUntil,
            tokenPayload
          })
        });
        
        return res.status(200).json({ type: 'upload_token', clientToken: jsonResponse.clientToken, pathname });
      }
      
      // ── Acción 2: Confirmar y registrar archivo subido (compatibilidad) ────
      if (accion === 'registrar') {
        const { id_inscripcion, tipo } = b;
        const pathnameCliente = typeof b.pathname === 'string' ? b.pathname.replace(/^\//, '').trim() : '';

        if (!id_inscripcion || !/^[A-Za-z0-9_-]{5,80}$/.test(id_inscripcion) || !tipo || !pathnameCliente) {
          return res.status(400).json({ error: 'Faltan datos o parámetros requeridos (id_inscripcion, tipo, pathname)' });
        }
        
        await asegurarEsquema();

        let targetEmpresaId = u.empresa_id;
        if (!esRolEmpresa(u.rol)) {
          if (b.empresa_id) {
            const [emp] = await sql`SELECT id FROM empresas WHERE id = ${b.empresa_id}`;
            if (emp) targetEmpresaId = emp.id;
          }
        }

        const [pendiente] = await sql`
          UPDATE archivos_pendientes
             SET usado = true
           WHERE pathname = ${pathnameCliente}
             AND usado = false
             AND expira_en > now()
             AND usuario_id = ${u.id}
             AND id_inscripcion = ${id_inscripcion}
             AND tipo = ${tipo}
             AND empresa_id = ${targetEmpresaId}
          RETURNING *`;
        
        if (!pendiente) {
          return res.status(400).json({ error: 'Ruta de subida no emitida, expirada o ya utilizada' });
        }

        const hostAutorizado = (process.env.BLOB_HOST || '').trim().toLowerCase() || 'blob.vercel-storage.com';
        const urlServidor = `https://${hostAutorizado}/${pendiente.pathname}`;

        const headersFetch = process.env.BLOB_READ_WRITE_TOKEN
          ? { 'Authorization': `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` }
          : {};
        const respBlob = await fetch(urlServidor, { headers: headersFetch });
        if (!respBlob.ok) {
          return res.status(400).json({ error: 'El archivo subido no se encuentra disponible en almacenamiento' });
        }

        const buffer = Buffer.from(await respBlob.arrayBuffer());
        const tipoDetectado = detectarTipoContenido(buffer);
        
        const limBytes = tipo === 'pdf_inscripcion' ? 3 * 1024 * 1024 : 4 * 1024 * 1024;
        let esValido = false;

        if (buffer.length <= limBytes) {
          if (tipo === 'pdf_inscripcion' && tipoDetectado === 'application/pdf') esValido = true;
          if (tipo === 'soporte_nomina' && ['application/pdf', 'image/jpeg', 'image/png'].includes(tipoDetectado)) esValido = true;
        }

        if (!esValido) {
          try {
            await del(urlServidor, { token: process.env.BLOB_READ_WRITE_TOKEN });
          } catch (delErr) {
            console.error('Error eliminando blob inválido, marcado para reintento por cron:', delErr);
            await sql`UPDATE archivos_pendientes SET pendiente_borrar = true WHERE id = ${pendiente.id}`;
          }
          return res.status(400).json({ error: 'El contenido del archivo no coincide con el formato permitido o excede el límite de tamaño' });
        }
        
        const id = crypto.randomUUID();
        await sql`INSERT INTO archivos (id, empresa_id, id_inscripcion, tipo, url)
                  VALUES (${id}, ${pendiente.empresa_id}, ${id_inscripcion}, ${tipo}, ${urlServidor})`;
        
        await auditar(req, u, 'subir', String(id), { id_inscripcion, tipo });
        return res.status(200).json({ ok: true, id });
      }
      
      return res.status(400).json({ error: 'Acción no válida' });
    }
    
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    if (e.publico) return res.status(e.status || 400).json({ error: e.message });
    if (e.name === 'BlobError') {
      console.error('BlobError en /api/archivo:', e.message);
      return res.status(400).json({ error: e.message });
    }
    console.error('Error en /api/archivo:', e);
    return res.status(500).json({ error: e.message || 'Error procesando la solicitud del archivo' });
  }
}
