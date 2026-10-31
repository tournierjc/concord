import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { wsOrigin } from './src/main/net-schemes';

/**
 * Configuration Vite du renderer (React 18 + TS).
 *
 * Points contraints par SPEC-001 :
 *  - `base: './'`            : les assets sont référencés en relatif, donc servis aussi bien par le
 *                              protocole `app://` (production, voir src/main/renderer-protocol.ts)
 *                              que par le serveur de dev sur la boucle locale (port 5173).
 *  - `outDir: dist/renderer`: cohérent avec electron-builder (files: dist/**) et avec le protocole
 *                              `app://` qui sert ce dossier.
 *  - aucun plugin réseau, aucun CDN, aucune police distante : tout est local (CA20 / A15).
 *  - L'en-tête CSP du serveur de dev est posé ici ; en production il est posé par
 *    src/main/csp.ts sur les réponses du protocole `app://` (une meta CSP figée dans index.html
 *    s'intersecterait avec lui et bloquerait les WebSockets LAN autorisées dynamiquement).
 */
const DEV_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "media-src 'self' blob: mediastream:",
  // HMR Vite : uniquement la boucle locale. Aucun wss:/https: autorisé.
  `connect-src 'self' ${wsOrigin('127.0.0.1:*')} ${wsOrigin('localhost:*')} ${wsOrigin('[::1]:*')}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export default defineConfig({
  base: './',
  root: __dirname,
  clearScreen: false,
  plugins: [react()],
  // `keepNames` : le bundle garde le NOM des fonctions exportées (`createMediaPlane`,
  // `lanOnlyConfiguration`…) au lieu de les renommer en une lettre. Ce n'est pas cosmétique :
  // le critère A1 de SPEC-006 se mesure par `grep -c createMediaPlane dist/renderer/assets/index.js`
  // — sans cette option, le nom disparaît à la minification et le critère devient inmesurable.
  esbuild: {
    keepNames: true,
  },
  server: {
    // 127.0.0.1 et jamais 0.0.0.0 : le serveur de dev ne doit pas être joignable depuis le LAN.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    headers: {
      'Content-Security-Policy': DEV_CSP,
      'X-Content-Type-Options': 'nosniff',
    },
  },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    target: 'chrome120',
    sourcemap: false,
    assetsInlineLimit: 0,
    reportCompressedSize: false,
    rollupOptions: {
      input: {
        // Fenêtre principale (salons, réglages) et fenêtre overlay : deux documents distincts,
        // deux BrowserWindow distinctes (l'overlay ne doit jamais hériter du DOM de la principale).
        index: resolve(__dirname, 'index.html'),
        overlay: resolve(__dirname, 'overlay.html'),
      },
      output: {
        // Pas de hash dans les noms de chunks : facilite l'inspection du contenu packagé (CA19/CA20).
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
