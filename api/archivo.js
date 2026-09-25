import { sql, asegurarEsquema, origenValido, leerCuerpo } from './_db.js';
import { exigir, esRolEmpresa } from './_auth.js';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import crypto from 'crypto';

export default async function handler(req, res) {
  try {
    const u = await exigir(req, res);
    if (!u) return;
    
    const storeId = process.env.BLOB_READ_WRITE_TOKEN ? process.env.BLOB_READ_WRITE_TOKEN.split('_')[3].toLowerCase() : '';
    const validHost = storeId ? `${storeId}.public.blob.vercel-storage.com` : '';

    // Configurar proxy para descargar
    if (req.method === 'GET') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'Falta el ID del archivo' });
      
      const [archivo] = await sql`SELECT * FROM archivos WHERE id = ${id}`;
      if (!archivo) return res.status(404).json({ error: 'Archivo no encontrado' });
      
      if (esRolEmpresa(u.rol) && archivo.empresa_id !== u.empresa_id) {
        return res.status(403).json({ error: 'No tiene permiso para ver este archivo' });
      }
      
      let urlObj;
      try { urlObj = new URL(archivo.url); } catch(e) { return res.status(400).json({ error: 'URL inválida en la base de datos' }); }
      
      if (urlObj.protocol !== 'https:' || urlObj.host !== validHost) {
        return res.status(400).json({ error: 'URL de almacenamiento no permitida' });
      }
      
      const blobRes = await fetch(archivo.url);
      if (!blobRes.ok) return res.status(404).json({ error: 'Archivo no disponible en el almacenamiento' });
      
      const safeName = (archivo.id_inscripcion + '_' + archivo.tipo).replace(/[^a-zA-Z0-9_\-.]/g, '');
      const blobType = blobRes.headers.get('content-type') || '';
      const isWhiteListed = ['application/pdf', 'image/jpeg', 'image/png'].includes(blobType);
      const finalContentType = isWhiteListed ? blobType : 'application/octet-stream';
      const disposition = isWhiteListed ? 'inline' : 'attachment';

      res.setHeader('Content-Type', finalContentType);
      res.setHeader('Content-Disposition', `${disposition}; filename="${safeName}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.send(Buffer.from(await blobRes.arrayBuffer()));
    }
    
    if (!origenValido(req)) return res.status(403).json({ error: 'Origen no permitido' });
    
    if (req.method === 'POST') {
      const b = leerCuerpo(req) || {};
      const accion = String(b.accion || '');
      
      if (accion === 'token_subida') {
        const { tipo, id_inscripcion } = b;
        if (!['pdf_inscripcion', 'soporte_nomina'].includes(tipo)) return res.status(400).json({ error: 'Tipo de archivo inválido' });
        if (!id_inscripcion || !/^[A-Za-z0-9_-]{5,80}$/.test(id_inscripcion)) return res.status(400).json({ error: 'ID de inscripción inválido' });
        
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
          if (solExistente && solExistente.empresa_id !== u.empresa_id) return res.status(403).json({ error: 'No tiene permiso para adjuntar a esta solicitud' });
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
        
        const r = crypto.randomBytes(8).toString('hex');
        const pathname = `${targetEmpresaId}/${id_inscripcion}_${tipo}_${r}`;
        
        const clientToken = await generateClientTokenFromReadWriteToken({
          token: process.env.BLOB_READ_WRITE_TOKEN,
          pathname,
          maximumSizeInBytes,
          validContentTypes,
          clientPayload: JSON.stringify({ empresa_id: targetEmpresaId })
        });
        
        return res.status(200).json({ type: 'upload_token', clientToken });
      }
      
      if (accion === 'registrar') {
        const { id_inscripcion, tipo, url } = b;
        if (!id_inscripcion || !/^[A-Za-z0-9_-]{5,80}$/.test(id_inscripcion) || !tipo || !url) return res.status(400).json({ error: 'Faltan datos o ID inválido' });
        
        let urlObj;
        try { urlObj = new URL(url); } catch(e) { return res.status(400).json({ error: 'URL inválida' }); }
        
        if (urlObj.protocol !== 'https:' || urlObj.host !== validHost) return res.status(400).json({ error: 'URL no permitida' });
        
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
          if (solExistente && solExistente.empresa_id !== u.empresa_id) return res.status(403).json({ error: 'No tiene permiso para registrar archivos en esta solicitud' });
        }

        if (!urlObj.pathname.startsWith(`/${targetEmpresaId}/${id_inscripcion}_${tipo}_`)) {
          return res.status(403).json({ error: 'El archivo no corresponde a la empresa o el tipo no coincide' });
        }
        
        const id = crypto.randomUUID();
        await sql`INSERT INTO archivos (id, empresa_id, id_inscripcion, tipo, url)
                  VALUES (${id}, ${targetEmpresaId}, ${id_inscripcion}, ${tipo}, ${url})`;
        
        return res.status(200).json({ ok: true, id });
      }
      
      return res.status(400).json({ error: 'Acción no válida' });
    }
    
    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    if (e.publico) return res.status(400).json({ error: e.message });
    console.error('Error en /api/archivo:', e);
    return res.status(500).json({ error: 'Error procesando la solicitud del archivo' });
  }
}
