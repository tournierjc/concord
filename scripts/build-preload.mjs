#!/usr/bin/env node
/**
 * build-preload.mjs — assemble `src/preload/index.ts` en UN SEUL fichier
 * `dist/preload/index.js`.
 *
 * POURQUOI UN BUNDLE ET PAS LA SORTIE DE `tsc` — le preload ne se chargeait pas.
 * La fenêtre principale impose `sandbox: true` (`src/main/index.ts`, `secureWebPreferences`) et
 * l'overlay aussi (`src/main/overlay-controller.ts`). Dans un renderer sandboxé, le `require` du
 * preload est un polyfill limité à `electron`, `events`, `timers` et `url` ; la doc Electron 30
 * (`docs/tutorial/sandbox.md`) est explicite : « Because the `require` function is a polyfill with
 * limited functionality, you will not be able to use CommonJS modules to separate your preload
 * script into multiple files. If you need to split your preload code, use a bundler such as
 * webpack or Parcel. » `tsc` émettait `require("../shell/ipc-contract")` : résolution impossible,
 * message « Unable to load preload script », `window.lanAPI` absent, et un renderer vide (le
 * `throw` de `src/renderer/api.ts` tombe au premier rendu, devTools désactivés en paquet).
 *
 * Ce que le bundle garantit, et que `tests/preload-bundle.node.test.ts` mesure :
 *   - le contrat IPC et ses gardes (`guardPayload`) sont INLINÉS dans le fichier ;
 *   - `electron` est le SEUL module laissé externe (fourni par le runtime) ;
 *   - aucun `require` relatif ne subsiste dans la sortie.
 *
 * Usage : `node scripts/build-preload.mjs [--outfile <chemin>]`
 * Le défaut est `dist/preload/index.js`, c'est-à-dire exactement le chemin que résout
 * `preloadPath()` du process principal (`join(__dirname, '..', 'preload', 'index.js')`).
 */

import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = join(ROOT, 'src', 'preload', 'index.ts');
const DEFAULT_OUTFILE = join(ROOT, 'dist', 'preload', 'index.js');

/** Lit `--outfile <chemin>` (ou `--outfile=<chemin>`) ; `null` si l'option est absente. */
function readOutfileArg(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--outfile') {
      const value = argv[index + 1];
      return typeof value === 'string' && value.length > 0 ? resolve(value) : null;
    }
    if (arg.startsWith('--outfile=')) {
      const value = arg.slice('--outfile='.length);
      return value.length > 0 ? resolve(value) : null;
    }
  }
  return null;
}

const outfile = readOutfileArg(process.argv.slice(2)) ?? DEFAULT_OUTFILE;
mkdirSync(dirname(outfile), { recursive: true });

await build({
  entryPoints: [ENTRY],
  outfile,
  bundle: true,
  // CommonJS : c'est le format qu'attend `preload` d'Electron.
  format: 'cjs',
  // Cible du runtime embarqué (Chromium/Node d'Electron 30), pas la machine de build.
  platform: 'node',
  target: 'node20',
  // `electron` est le seul module que le polyfill de preload sandboxé sait rendre.
  external: ['electron'],
  // Pas de sourcemap dans le paquet (electron-builder exclut `**/*.map`, mais autant ne pas
  // produire un fichier que personne ne livre).
  sourcemap: false,
  minify: false,
  // Les commentaires de licence restent ; le reste du bruit disparaît.
  legalComments: 'inline',
  logLevel: 'warning',
});

console.log(`[preload] bundle écrit : ${outfile}`);
