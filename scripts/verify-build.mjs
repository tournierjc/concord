#!/usr/bin/env node
/**
 * verify-build.mjs — refuse a build (or a packaged app) whose pieces don't belong together.
 *
 * v0.4.0 shipped a `dist/preload/index.js` built from older sources: the renderer called
 * `lanAPI.onDiscoveryStatus`, the preload didn't expose it, React unmounted on the first render
 * and every platform showed an empty window. This script checks the artefact itself, not the
 * build scripts:
 *   - `package.json#main`, the preload, and both HTML documents exist;
 *   - every asset referenced by the HTML documents exists;
 *   - the preload exposes EVERY method of `LanAPI` (read from `src/shell/ipc-contract.ts`).
 *
 * Usage:
 *   node scripts/verify-build.mjs                 # checks ./dist
 *   node scripts/verify-build.mjs --asar <file>   # checks a packaged app.asar
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT = join(ROOT, 'src', 'shell', 'ipc-contract.ts');

/** Method names declared by `export interface LanAPI { … }`. */
export function lanApiMethods(contractSource = readFileSync(CONTRACT, 'utf8')) {
  const start = contractSource.indexOf('export interface LanAPI {');
  if (start < 0) throw new Error('interface LanAPI introuvable dans ipc-contract.ts');
  const end = contractSource.indexOf('\n}', start);
  const body = contractSource.slice(start, end);
  const names = new Set();
  for (const match of body.matchAll(/^ {2}([A-Za-z][A-Za-z0-9]*)\(/gm)) names.add(match[1]);
  return [...names].sort();
}

/** `LanAPI` methods that a preload bundle does not expose. */
export function missingPreloadMethods(preloadSource, methods = lanApiMethods()) {
  return methods.filter((name) => !new RegExp(`\\b${name}\\s*:`).test(preloadSource));
}

/** A file reader over either a directory (`dist/..`) or a packaged `app.asar`. */
function createReader(asarPath) {
  if (asarPath === null) {
    return {
      label: ROOT,
      exists: (rel) => existsSync(join(ROOT, rel)),
      read: (rel) => readFileSync(join(ROOT, rel), 'utf8'),
    };
  }
  const require = createRequire(import.meta.url);
  const asar = require('@electron/asar');
  const files = new Set(asar.listPackage(asarPath).map((entry) => entry.replace(/\\/g, '/').replace(/^\//, '')));
  return {
    label: asarPath,
    exists: (rel) => files.has(rel),
    read: (rel) => asar.extractFile(asarPath, rel).toString('utf8'),
  };
}

export function verify({ asarPath = null } = {}) {
  const reader = createReader(asarPath);
  const problems = [];
  const need = (rel) => {
    if (!reader.exists(rel)) problems.push(`fichier manquant : ${rel}`);
    return reader.exists(rel);
  };

  if (need('package.json')) {
    const manifest = JSON.parse(reader.read('package.json'));
    if (typeof manifest.main !== 'string') problems.push('package.json#main absent');
    else need(posix.normalize(manifest.main));
  }

  for (const doc of ['dist/renderer/index.html', 'dist/renderer/overlay.html']) {
    if (!need(doc)) continue;
    const html = reader.read(doc);
    for (const match of html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)) {
      need(posix.join('dist/renderer', match[1]));
    }
    if (html.includes('/src/renderer/')) problems.push(`${doc} référence encore les sources (build Vite absent ?)`);
  }

  const preload = 'dist/preload/index.js';
  if (need(preload)) {
    const source = reader.read(preload);
    if (/require\(\s*["']\.{1,2}\//.test(source)) problems.push('le preload contient un require relatif (non chargeable en sandbox)');
    const missing = missingPreloadMethods(source);
    if (missing.length > 0) {
      problems.push(`preload périmé : méthodes LanAPI absentes (${missing.join(', ')})`);
    }
  }

  return { target: reader.label, problems };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--asar');
  const asarPath = index >= 0 ? resolve(process.argv[index + 1] ?? '') : null;
  const { target, problems } = verify({ asarPath });
  if (problems.length > 0) {
    console.error(`[verify-build] ÉCHEC (${target})`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`[verify-build] OK (${target}) — ${lanApiMethods().length} méthodes LanAPI exposées par le preload`);
}
