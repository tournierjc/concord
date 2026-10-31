/**
 * tests/contract-parity.node.test.ts — SPEC-007 §4.1 : le contrat sous trois copies, tenues ensemble
 *
 * Le contrat de signalisation vit en TROIS endroits : la SPEC (`SPECS/SPEC-007-...md` §4.1), le
 * contrat de la coquille (`src/shell/ipc-contract.ts`) et la copie du moteur
 * (`src/engine/net/mesh.ts` §4.1, recopiée parce que l'import engine → shell est refusé par la
 * stratification). Une seule dérive suffit à faire diverger ce que le main valide et ce que le
 * maillage suppose — c'est exactement ce qui a laissé passer `detail?: string` contre
 * `detail: string | null` (relevé par Carillon en T16a, corrigé en T16b).
 *
 * Trois gardes, de la plus forte à la plus faible :
 *
 *   1. TYPE À TYPE (compile-time) : `Shell.SignalIn` ≡ `Engine.SignalIn`, idem `SignalKind` et
 *      `SignalOut`. Si l'un des deux camps bouge d'un caractère, `tsc` rougit sur CE fichier.
 *      C'est la garde qui manquait : un test de comportement ne voit pas un type qui s'élargit.
 *   2. SPEC → CODE (texte normalisé) : chaque déclaration du bloc `ts` de §4.1 doit apparaître
 *      telle quelle (commentaires, `;` et espaces retirés) dans le contrat ET dans le mesh.
 *      Elle attrape la dérive « la SPEC dit une chose, le code une autre » dans les deux sens.
 *   3. CANAUX : §4.1 nomme deux canaux et leurs valeurs ; on vérifie que `IPC` les porte à
 *      l'identique.
 *
 * Ce que ce fichier ne prouve PAS : que le `null` de `detail` traverse réellement l'IPC (c'est
 * `tests/ipc-contract.test.ts`), ni qu'un pair reçoit quoi que ce soit (aucun réseau ici).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { IPC as SHELL_IPC } from '../src/shell/ipc-contract.ts';
import type * as Shell from '../src/shell/ipc-contract.ts';
import type * as Engine from '../src/engine/net/mesh.ts';

/* ------------------------------------------------------------------ */
/* 1. Type à type — échoue à la compilation, pas à l'exécution         */
/* ------------------------------------------------------------------ */

/** Égalité structurelle stricte (la forme « fonction » distingue `string` de `string | null`). */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
type Assert<T extends true> = T;

type LinkDetail = Extract<Shell.SignalIn, { kind: 'link' }>['detail'];

// Chacune de ces lignes est une assertion de compilation : la retirer, c'est retirer la garde.
type _Kind = Assert<Equals<Shell.SignalKind, Engine.SignalKind>>;
type _Out = Assert<Equals<Shell.SignalOut, Engine.SignalOut>>;
type _In = Assert<Equals<Shell.SignalIn, Engine.SignalIn>>;
// Le point exact de la dérive T16a : `detail` est `string | null`, jamais `string | undefined`.
type _Detail = Assert<Equals<LinkDetail, string | null>>;
// Et il est obligatoire : un message `link` sans `detail` n'est pas un message du contrat.
type _DetailRequired = Assert<Equals<keyof Extract<Shell.SignalIn, { kind: 'link' }>, 'kind' | 'state' | 'detail'>>;

test('§4.1 — SignalIn/SignalOut/SignalKind identiques entre coquille et moteur', () => {
  // Les assertions ci-dessus sont statiques ; ce test existe pour que la garde apparaisse dans le
  // rapport d'exécution et pour poser les témoins runtime qui suivent.
  const samples: Shell.SignalIn[] = [
    { kind: 'peer-joined', peerId: 'p2', name: 'Ada' },
    { kind: 'peer-left', peerId: 'p2' },
    { kind: 'offer', from: 'p2', payload: 'v=0' },
    { kind: 'link', state: 'connecting', detail: null },
    { kind: 'link', state: 'refused', detail: 'salon plein' },
  ];
  // Chaque témoin doit être aussi un message du moteur : le compilateur le vérifie ici.
  const asEngine: Engine.SignalIn[] = samples;
  assert.equal(asEngine.length, 5);
  assert.equal(asEngine[3]?.kind, 'link');
});

/* ------------------------------------------------------------------ */
/* 2. SPEC → CODE — comparaison de texte normalisé                     */
/* ------------------------------------------------------------------ */

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SPEC = readFileSync(`${HERE}../SPECS/SPEC-007-signalisation-transport-T16.md`, 'utf8');
const CONTRACT = readFileSync(`${HERE}../src/shell/ipc-contract.ts`, 'utf8');
const MESH = readFileSync(`${HERE}../src/engine/net/mesh.ts`, 'utf8');

/** Retire commentaires, `;` et espaces : ne garde que la forme du type. */
function normalize(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, ' ') // commentaires de bloc
    .replace(/\/\/[^\n]*/gu, ' ') // commentaires de ligne
    .replace(/;/gu, '') // séparateurs facultatifs
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Le bloc ```ts de la SPEC qui contient `needle` (un seul doit le contenir). */
function specFence(needle: string): string {
  const fences = [...SPEC.matchAll(/```[a-z]*\n([\s\S]*?)```/gu)].map((match) => match[1] ?? '');
  const found = fences.filter((fence) => fence.includes(needle));
  assert.equal(found.length, 1, `bloc §4.1 introuvable ou ambigu pour « ${needle} »`);
  return found[0] as string;
}

/** Découpe un bloc en déclarations `export type X = …`. */
function declarations(block: string): string[] {
  const start = block.indexOf('export type ');
  assert.notEqual(start, -1, 'aucune déclaration `export type` dans le bloc');
  return block
    .slice(start)
    .split(/(?=export type )/u)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith('export type '));
}

test('§4.1 — chaque type de la SPEC existe à l’identique dans le contrat', () => {
  const decls = declarations(specFence('export type SignalIn'));
  assert.deepEqual(
    decls.map((decl) => /^export type (\w+)/u.exec(decl)?.[1]),
    ['SignalKind', 'SignalOut', 'SignalIn'],
    'la SPEC §4.1 doit déclarer SignalKind, SignalOut puis SignalIn',
  );

  const contract = normalize(CONTRACT);
  for (const decl of decls) {
    assert.ok(
      contract.includes(normalize(decl)),
      `src/shell/ipc-contract.ts ne reproduit pas à l'identique :\n${decl}`,
    );
  }
});

test('§4.1 — la copie du moteur (mesh.ts) reste identique à la SPEC', () => {
  const decls = declarations(specFence('export type SignalIn'));
  const mesh = normalize(MESH);
  for (const decl of decls) {
    assert.ok(
      mesh.includes(normalize(decl)),
      `src/engine/net/mesh.ts ne reproduit pas à l'identique :\n${decl}`,
    );
  }
});

test('§4.1 — `detail` est `string | null` dans les trois copies, jamais facultatif', () => {
  const signalIn = declarations(specFence('export type SignalIn')).find((decl) =>
    decl.startsWith('export type SignalIn'),
  );
  assert.ok(signalIn, 'SignalIn absent de la SPEC');
  assert.match(normalize(signalIn), /kind: 'link' state: 'connecting' \| 'connected' \| 'refused' \| 'closed' detail: string \| null/u);

  for (const [name, source] of [['contrat', CONTRACT], ['mesh', MESH]] as const) {
    assert.doesNotMatch(source, /detail\?:/u, `${name} : \`detail\` doit être obligatoire`);
    assert.doesNotMatch(
      source,
      /detail: string(?! \| null)/u,
      `${name} : \`detail\` doit accepter \`null\` (SPEC §4.1)`,
    );
  }
});

/* ------------------------------------------------------------------ */
/* 3. Canaux nommés par §4.1                                           */
/* ------------------------------------------------------------------ */

test('§4.1 — les deux canaux de signalisation portent les noms de la SPEC', () => {
  const fence = specFence('signalSend:');
  const named = new Map(
    [...fence.matchAll(/^\s*(\w+): '([^']+)'/gmu)].map((m) => [m[1] as string, m[2] as string]),
  );
  assert.equal(named.get('signalSend'), 'lan:signal:send');
  assert.equal(named.get('eventSignal'), 'lan:event:signal');
  assert.equal(SHELL_IPC.signalSend, named.get('signalSend'));
  assert.equal(SHELL_IPC.eventSignal, named.get('eventSignal'));
});
