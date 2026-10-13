// scripts/build-blob-client.js
// Empaqueta la librería oficial @vercel/blob/client para su consumo directo en el navegador.
import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const outDir = path.resolve('vendor');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Plugin para sustituir módulos de servidor (jose, @vercel/oidc)
// por stubs ligeros que evitan llamadas a require() en el navegador.
const browserShimsPlugin = {
  name: 'browser-shims',
  setup(build) {
    build.onResolve({ filter: /^(jose(\/.*)?|@vercel\/oidc)$/ }, (args) => ({
      path: args.path,
      namespace: 'browser-shim-ns'
    }));

    build.onLoad({ filter: /.*/, namespace: 'browser-shim-ns' }, (args) => {
      if (args.path.startsWith('jose')) {
        return {
          contents: `
            export const jwtVerify = async () => ({ payload: {} });
            export const createRemoteJWKSet = () => () => ({});
            export default {};
          `,
          loader: 'js'
        };
      }
      return {
        contents: `
          export const getVercelOidcToken = async () => '';
          export const getVercelOidcTokenSync = () => '';
          export const verifyVercelOidcToken = async () => ({});
          export const getVercelToken = async () => '';
          export class AccessTokenMissingError extends Error {}
          export class RefreshAccessTokenFailedError extends Error {}
          export const getContext = () => ({});
          export default {};
        `,
        loader: 'js'
      };
    });
  }
};

await esbuild.build({
  entryPoints: ['scripts/client-entry.js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  conditions: ['browser'],
  target: ['es2020'],
  minify: true,
  plugins: [browserShimsPlugin],
  outfile: 'vendor/vercel-blob-client.js'
});

console.log('✅ vendor/vercel-blob-client.js empaquetado exitosamente');

