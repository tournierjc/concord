/**
 * tests/preload-bundle.node.test.ts — le preload doit être UN fichier autonome.
 *
 * Contexte mesuré : la fenêtre principale et l'overlay imposent `sandbox: true`
 * (`src/main/index.ts`, `src/main/overlay-controller.ts`). Dans un renderer sandboxé, le
 * `require` du preload est un polyfill limité à `electron`, `events`, `timers`, `url` — la doc
 * Electron 30 (`docs/tutorial/sandbox.md`) le dit noir sur blanc : un preload découpé en
 * plusieurs fichiers CommonJS ne se charge pas, il faut un bundler. Tant que `tsc` émettait
 * `dist/preload/index.js` avec `require("../shell/ipc-contract")`, le preload échouait au
 * chargement, `window.lanAPI` restait absent et l'application affichait une fenêtre vide.
 *
 * Ce test EXÉCUTE le script de build réel (`scripts/build-preload.mjs`) vers un répertoire
 * temporaire, puis mesure l'artefact produit — pas une copie de sa configuration :
 *   1. le script sort en 0 et écrit le fichier ;
 *   2. `electron` est le SEUL module requis (aucun `require` relatif, aucun module Node) ;
 *   3. le contrat IPC est bien INLINÉ : chaque canal `lan:…` de `src/shell/ipc-contract.ts`
 *      apparaît dans la sortie, donc la garde `guardPayload` voyage avec le preload ;
 *   4. le pont est toujours exposé et gelé (`exposeInMainWorld`, `Object.freeze`).
 *
 * Ce que ce test NE prouve PAS : que le preload se charge dans un vrai renderer Electron (il
 * faudrait un binaire Electron et un serveur X — non disponibles sur l'hôte de recette). Il
 * prouve que la cause mesurée de l'échec de chargement a disparu de l'artefact.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'build-preload.mjs');
const CONTRACT = join(ROOT, 'src', 'shell', 'ipc-contract.ts');

const workDir = mkdtempSync(join(tmpdir(), 'concord-preload-'));
const outfile = join(workDir, 'preload.js');

after(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function buildOnce(): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [SCRIPT, '--outfile', outfile], {
    cwd: ROOT,
    encoding: 'utf8',
    // Le build ne doit rien demander au réseau : esbuild est une dépendance de développement.
    env: { ...process.env, NODE_ENV: 'production' },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** Tous les modules atteints par un `require("…")` littéral de la sortie, triés et dédoublonnés. */
function requiredModules(source: string): string[] {
  const found: string[] = [];
  const pattern = /require\(\s*(["'])([^"']+)\1\s*\)/g;
  let match = pattern.exec(source);
  while (match !== null) {
    const module = match[2];
    if (typeof module === 'string' && module.length > 0) found.push(module);
    match = pattern.exec(source);
  }
  return [...new Set(found)].sort();
}

/** Les valeurs de canaux `lan:…` du contrat, lues à la source (pas recopiées). */
function contractChannels(): string[] {
  const source = readFileSync(CONTRACT, 'utf8');
  const found: string[] = [];
  const pattern = /'(lan:[a-z-]+:[a-z-]+)'/g;
  let match = pattern.exec(source);
  while (match !== null) {
    const channel = match[1];
    if (typeof channel === 'string' && channel.length > 0) found.push(channel);
    match = pattern.exec(source);
  }
  return [...new Set(found)].sort();
}

describe('preload bundlé — un seul fichier, `electron` seul externe', () => {
  const build = buildOnce();

  it('le script de build sort en 0 et écrit l’artefact', () => {
    assert.equal(build.status, 0, `build-preload a échoué : ${build.stderr}`);
    assert.ok(existsSync(outfile), `aucun fichier écrit à ${outfile}`);
  });

  it('aucun `require` relatif ne subsiste (la cause mesurée de l’échec de chargement)', () => {
    const source = readFileSync(outfile, 'utf8');
    const modules = requiredModules(source);
    const relative = modules.filter((module) => module.startsWith('.'));
    assert.deepEqual(relative, [], `modules relatifs requis : ${relative.join(', ')}`);
    assert.deepEqual(modules, ['electron'], `modules requis : ${modules.join(', ')}`);
  });

  it('le contrat IPC est inliné — chaque canal `lan:…` est présent dans le bundle', () => {
    const source = readFileSync(outfile, 'utf8');
    const channels = contractChannels();
    assert.ok(channels.length >= 15, `canaux trouvés dans le contrat : ${channels.length}`);
    const missing = channels.filter((channel) => !source.includes(channel));
    assert.deepEqual(missing, [], `canaux absents du bundle : ${missing.join(', ')}`);
  });

  it('le pont reste exposé et gelé', () => {
    const source = readFileSync(outfile, 'utf8');
    assert.ok(source.includes('exposeInMainWorld'), 'exposeInMainWorld absent du bundle');
    assert.ok(source.includes("'lanAPI'") || source.includes('"lanAPI"'), 'nom lanAPI absent');
    assert.ok(source.includes('Object.freeze'), 'Object.freeze absent : le pont n’est plus gelé');
  });

  it('la sortie reste de taille raisonnable (pas d’embarquement accidentel)', () => {
    const size = statSync(outfile).size;
    assert.ok(size > 1000, `bundle suspect : ${size} o`);
    assert.ok(size < 200_000, `bundle trop gros (dépendance embarquée ?) : ${size} o`);
  });
});
