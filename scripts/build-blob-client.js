// scripts/build-blob-client.js
// Empaqueta la librería oficial @vercel/blob/client para su consumo directo en el navegador.
// Se ejecuta durante el build en Vercel ("npm run build").
import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const outDir = path.resolve('vendor');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

await esbuild.build({
  entryPoints: ['scripts/client-entry.js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  external: ['jose'],
  outfile: 'vendor/vercel-blob-client.js'
});

console.log('✅ vendor/vercel-blob-client.js empaquetado exitosamente');
