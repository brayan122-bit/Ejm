import { sql, asegurarEsquema, origenValido, leerCuerpo, auditar } from './_db.js';
import { exigir, esRolEmpresa } from './_auth.js';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import { del } from '@vercel/blob';
import crypto from 'crypto';

// Roles explícitamente autorizados para operaciones de archivos (denegar por defecto)
const ROLES_PERMITIDOS_ARCHIVO = new Set(['maestro', 'validador', 'empresa_admin', 'empresa_usuario']);

// Obtiene el host obligatorio y exacto del almacenamiento
function obtenerBlobHost() {
  const host = (process.env.BLOB_HOST || '').trim().toLowerCase();
  if (!host) {
    throw Object.assign(new Error('Configuración incompleta: falta la variable BLOB_HOST en el servidor.'), { publico: true });
  }
  return host;
}

// Validación estricta por contenido real (Magic Bytes)
function detectarTipoContenido(buffer) {
  if (!buffer || buffer.length < 8) return null;
  // PDF: %PDF (0x25 0x50 0x44 0x46)
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return 'application/pdf';
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'image/jpeg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
      buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A) {
    return 'image/png';
  }
  return null;
}

export default async function handler(req, res) {
  try {
    // 1. Autenticación y principio de "denegar por defecto"
    const u = await exigir(req, res);
    if (!u) return;

    if (!ROLES_PERMITIDOS_ARCHIVO.has(u.rol) || !u.activo) {
      return res.status(403).json({ error: 'Acceso denegado: rol no autorizado o usuario inactivo.' });
    }

    const hostAutorizado = obtenerBlobHost();

    // ── GET: Descarga protegida a través del proxy ─────────────────────────
    if (req.method === 'GET') {
      const { id } = req.query;
      if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Falta el ID del archivo' });
      
      await asegurarEsquema();
      const [archivo] = await sql`SELECT * FROM archivos WHERE id = ${id}`;
      
      // Ofuscación de seguridad: responde exactamente 404 tanto si no existe
      // como si pertenece a otra empresa, evitando enumeración de IDs.
      if (!archivo || (esRolEmpresa(u.rol) && archivo.empresa_id !== u.empresa_id)) {
        return res.status(404).json({ error: 'Archivo no encontrado' });
      }
      
      let urlObj;
      try { urlObj = new URL(archivo.url); } catch { return res.status(400).json({ error: 'URL inválida en la base de datos' }); }
      
      // Comparación exacta del host (nunca enviar Authorization a un host desconocido)
      if (urlObj.protocol !== 'https:' || urlObj.host.toLowerCase() !== hostAutorizado) {
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
      // Sanitización estricta de safeFilename (solo letras, números, guion, guion bajo y punto)
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
      const b = leerCuerpo(req) || {};
      const accion = String(b.accion || '');
      
      // ── Acción 1: Emitir token temporal de subida ─────────────────────────
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
        
        let validContentTypes;
        let maximumSizeInBytes;
        if (tipo === 'pdf_inscripcion') {
          validContentTypes = ['application/pdf'];
          maximumSizeInBytes = 3 * 1024 * 1024; // 3 MB
        } else {
          validContentTypes = ['image/jpeg', 'image/png', 'application/pdf'];
          maximumSizeInBytes = 4 * 1024 * 1024; // 4 MB
        }
        
        // Generar ruta única en el servidor
        const r = crypto.randomBytes(12).toString('hex');
        const pathname = `${targetEmpresaId}/${id_inscripcion}_${tipo}_${r}`;
        
        // Registrar la ruta emitida en BD con expiración de 15 minutos
        await sql`INSERT INTO archivos_pendientes (pathname, empresa_id, usuario_id, id_inscripcion, tipo, expira_en)
                  VALUES (${pathname}, ${targetEmpresaId}, ${u.id}, ${id_inscripcion}, ${tipo}, now() + interval '15 minutes')`;
        
        const clientToken = await generateClientTokenFromReadWriteToken({
          token: process.env.BLOB_READ_WRITE_TOKEN,
          pathname,
          maximumSizeInBytes,
          validContentTypes,
          clientPayload: JSON.stringify({ empresa_id: targetEmpresaId, tipo, id_inscripcion })
        });
        
        return res.status(200).json({ type: 'upload_token', clientToken, pathname });
      }
      
      // ── Acción 2: Confirmar y registrar archivo subido ─────────────────────
      if (accion === 'registrar') {
        const { id_inscripcion, tipo } = b;
        // La URL enviada por el cliente se IGNORA deliberadamente. Se construye exclusivamente en el servidor.
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

        // UPDATE atómico: marca usado = true en una única sentencia SQL
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

        // Construir la URL exclusivamente en el servidor a partir de BLOB_HOST y pendiente.pathname
        const urlServidor = `https://${hostAutorizado}/${pendiente.pathname}`;

        // Inspección y validación de Magic Bytes en el servidor usando urlServidor
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
          // Si falla la validación, borra el blob del almacenamiento
          try {
            await del(urlServidor, { token: process.env.BLOB_READ_WRITE_TOKEN });
          } catch (delErr) {
            console.error('Error eliminando blob inválido, marcado para reintento por cron:', delErr);
            // Si del() falla, marcar pendiente_borrar = true para reintento automático por el cron
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
    console.error('Error en /api/archivo:', e);
    return res.status(500).json({ error: 'Error procesando la solicitud del archivo' });
  }
}
