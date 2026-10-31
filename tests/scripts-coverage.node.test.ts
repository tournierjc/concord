/**
 * scripts-coverage.node.test.ts — garde « aucun test invisible » (coquille, T17).
 *
 * Le runner de la maison est `node:test` lancé par `npm run test:node`, dont la liste de
 * fichiers est ÉCRITE À LA MAIN dans `package.json` (pas de glob : voir docs/TESTS.md,
 * « un fichier non node-runnable doit être visible dans le diff, pas silencieusement
 * embarqué »). Ce choix a un coût mesuré : le 2026-10-31, trois fichiers ajoutés par le
 * moteur n'apparaissaient pas dans la liste, et un relevé annonçait « 14 fichiers » quand
 * `ls tests/*.test.ts` en comptait 19 — des tests verts que personne ne lançait.
 *
 * Cette garde rend l'écart impossible à réintroduire sans rouge :
 *   1. tout `tests/*.test.ts` présent sur le disque est dans `test:node` ;
 *   2. tout fichier de `test:node` existe sur le disque (pas de nom fantôme) ;
 *   3. la liste ne contient aucun glob (`*`, `?`, `{`) : l'explicite reste explicite ;
 *   4. `scriptsNote` porte EXACTEMENT un marqueur `compte courant : N fichiers`, et N égale
 *      le compte réel. (Réserve C5 de VERIF-019 : compter la « dernière mention N fichiers »
 *      faisait rougir une remarque historique ajoutée en fin de note. Le marqueur rend la
 *      revendication courante unique et explicite ; le journal daté garde ses vieux chiffres.)
 *
 * Aucune sortie réseau, aucun `as`, lecture seule du dépôt.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TESTS_DIR = resolve(ROOT, 'tests');

interface PackageManifest {
  readonly scripts?: Record<string, string>;
  readonly scriptsNote?: string;
}

const manifest: PackageManifest = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

/** Les arguments `tests/…` de la commande `test:node`, dans l'ordre écrit. */
function testNodeArgs(): string[] {
  const script = manifest.scripts?.['test:node'];
  assert.equal(typeof script, 'string', 'package.json doit déclarer scripts["test:node"]');
  assert.ok(script !== undefined);
  return script
    .split(/\s+/)
    .filter((arg) => arg.startsWith('tests/'))
    .map((arg) => arg.replace(/^tests\//, ''));
}

/** Les fichiers `*.test.ts` réellement présents dans `tests/`. */
function filesOnDisk(): string[] {
  return readdirSync(TESTS_DIR)
    .filter((name) => name.endsWith('.test.ts'))
    .sort();
}

describe('scripts-coverage — la liste de test:node couvre exactement tests/*.test.ts', () => {
  it('tout fichier *.test.ts du disque est lancé par `npm test`', () => {
    const listed = new Set(testNodeArgs());
    const missing = filesOnDisk().filter((name) => !listed.has(name));
    assert.deepEqual(missing, [], `tests non lancés par npm test : ${missing.join(', ')}`);
  });

  it('la liste ne cite aucun fichier absent du disque', () => {
    const onDisk = new Set(filesOnDisk());
    const ghosts = testNodeArgs().filter((name) => !onDisk.has(name));
    assert.deepEqual(ghosts, [], `fichiers cités mais absents : ${ghosts.join(', ')}`);
  });

  it('la liste est explicite : aucun glob, aucun doublon', () => {
    const args = testNodeArgs();
    for (const arg of args) {
      assert.ok(!/[*?{[\]]/.test(arg), `glob interdit dans test:node : ${arg}`);
    }
    assert.equal(new Set(args).size, args.length, 'test:node contient un doublon');
  });

  it('le compte marqué « compte courant : N fichiers » égale le nombre de fichiers du disque', () => {
    const note = manifest.scriptsNote;
    assert.ok(typeof note === 'string', 'scriptsNote doit rester présent (il porte la mesure datée)');
    // `scriptsNote` est un journal daté : chaque re-mesure APPEND sa ligne, et les vieux
    // chiffres restent (datés). Un marqueur explicite, unique, désigne donc la seule
    // revendication courante — une remarque historique ajoutée en fin de note ne peut plus
    // ni la masquer ni la contredire en silence. Deux marqueurs = ambiguïté = rouge.
    const marks = [...note.matchAll(/compte courant\s*:\s*(\d+)\s*fichiers?\b/gi)].map((m) => Number(m[1]));
    assert.ok(
      marks.length === 1,
      `scriptsNote doit porter exactement un marqueur « compte courant : N fichiers » (trouvé ${marks.length})`,
    );
    const announced = marks[0];
    assert.ok(announced !== undefined, 'marqueur illisible');
    assert.equal(announced, filesOnDisk().length, `scriptsNote annonce ${announced} fichiers`);
  });
});
