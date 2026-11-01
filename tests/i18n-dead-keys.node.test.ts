/**
 * tests/i18n-dead-keys.node.test.ts — garde « aucune clé morte » (coquille i18n, T-i18n).
 *
 * LE DÉFAUT. `design/check-i18n.mjs` contrôle la parité FR/EN, les moustaches, la typographie —
 * jamais que chaque clé du catalogue est EMPLOYÉE. 157 clés s'étaient donc accumulées sans qu'aucun
 * port ne les référence : des libellés payés, écrits, traduits, et jamais rendus. Le catalogue
 * mentait sur ce que l'écran sait dire. La loi du repo est l'inverse : pas de mesure ⇒ pas
 * d'affichage ⇒ pas de clé.
 *
 * LA GARDE, dans les deux sens :
 *   1. chaque clé de `design/i18n/fr.json` est référencée par une source de l'application
 *      (`src/**` : libellé rendu, ou clé de message produite par un module testé — notice du main,
 *      clés de footer/vue du lobby, clés d'erreur du pseudo), OU figure dans une liste explicite
 *      d'exceptions justifiées (clé consommée par un test, ou par `design/check-i18n.mjs`) ;
 *   2. la liste d'exceptions ne peut pas servir de refuge : chaque exception doit être un motif
 *      identifiable (chemin du consommateur), et le compte total d'exceptions est borné — ajouter
 *      une clé morte « en exception » demande d'éditer la liste, donc de passer en revue.
 *
 * Une clé supprimée doit l'être des TROIS fichiers (fr, en, bundle) — c'est `check-i18n.mjs`
 * (contrôle 7) qui le garantit ; ce fichier-ci garantit l'autre moitié : plus de clé vivante
 * inutile, et plus de clé supprimée dont le code attendrait encore le libellé.
 *
 * Lancer : cd /work/lan-voice && npx tsx --test tests/i18n-dead-keys.node.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function readSources(dir: string): Array<{ path: string; text: string }> {
  const sources: Array<{ path: string; text: string }> = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const absolute = join(ROOT, dir, entry);
    if (statSync(absolute).isDirectory()) {
      sources.push(...readSources(join(dir, entry)));
      continue;
    }
    if (!/\.(ts|tsx|mjs)$/.test(entry)) continue;
    sources.push({ path: relative(ROOT, absolute), text: readFileSync(absolute, 'utf8') });
  }
  return sources;
}

/** Les sources de l'application + les garde-fous qui consomment des clés (tests, check-i18n). */
const APP_SOURCES = [
  ...readSources('src'),
  ...readSources('design'),
  ...readSources('tests'),
];

/**
 * Exceptions JUSTIFIÉES : clés que l'application ne rend pas elle-même, chaque exception citant
 * son consommateur réel. Cette liste est bornée (assertion 3) — une clé morte de plus exige
 * d'abord une justification, jamais un ajout silencieux.
 */
const JUSTIFIED_EXCEPTIONS: Readonly<Record<string, string>> = {
  // Construites par un module, jamais citées en littéral : `nicknameErrorKey(...)` les produit,
  // `IdentityRow` les rend — la famille `app.nickname.error.*` est nommée dans `src/shell/nickname.ts`.
  'app.nickname.error.empty': 'src/shell/nickname.ts (nicknameErrorKey)',
  'app.nickname.error.tooLong': 'src/shell/nickname.ts (nicknameErrorKey)',
  // Consommées par design/check-i18n.mjs (liste BUTTON_KEYS, contrôle des largeurs de bouton) :
  // ces libellés sont rendus par le code sous un AUTRE libellé contextuel ; le contrôle de
  // largeur, lui, les nomme et les lit. Ils ne sont donc pas morts : ils sont mesurés.
  'settings.vad.calibrate': 'design/check-i18n.mjs (BUTTON_KEYS)',
  'settings.vad.calibrateApply': 'design/check-i18n.mjs (BUTTON_KEYS)',
  'settings.audio.permissionRetry': 'design/check-i18n.mjs (BUTTON_KEYS)',
  // Même cas, côté tests : `tests/i18n-interpolation.node.test.ts` joue ses contre-exemples sur
  // des EXTRAITS FABRIQUÉS (un dictionnaire de démonstration qui nomme ces clés). Sans cette
  // ligne, retirer un de ces libellés du catalogue rougirait un test qui ne prouve que la forme
  // du détecteur — la clé y est consommée par le test, tolérée explicitement, comme le permet la
  // règle « une clé utilisée uniquement par un test est listée, pas ignorée ».
  'room.empty.body': 'tests/i18n-interpolation.node.test.ts (dictionnaire fabriqué)',
  'control.ptt.hold': 'tests/i18n-interpolation.node.test.ts (dictionnaire fabriqué)',
};

const MAX_EXCEPTIONS = 12;

function catalogKeys(): string[] {
  const fr = JSON.parse(readFileSync(join(ROOT, 'design/i18n/fr.json'), 'utf8')) as Record<string, string>;
  return Object.keys(fr);
}

describe('i18n-dead-keys — aucune clé morte dans design/i18n/fr.json', () => {
  it('chaque clé FR est référencée par une source de l’application (src/, design/, tests/)', () => {
    const keys = catalogKeys();
    const dead: string[] = [];
    for (const key of keys) {
      if (key in JUSTIFIED_EXCEPTIONS) continue;
      const needle = `'${key}'`;
      const referenced = APP_SOURCES.some((source) => source.text.includes(needle));
      if (!referenced) dead.push(key);
    }
    // Une clé construite par un module (pas citée en littéral) passe par la liste d'exceptions.
    const detail = dead.map((k) => `  - ${k}`).join('\n');
    assert.deepEqual(dead, [], `${dead.length} clé(s) morte(s) — référencée par aucune source :\n${detail}`);
  });

  it('les clés référencées le sont aussi dans les deux sens du bundle (ni clé FR sans code, ni code sans clé)', () => {
    // Une clé citée par le code mais ABSENTE du catalogue rend la clé elle-même à l'écran
    // (`i18n.ts` : repli visible). Le contrôle est unilatéral : toute clé citée dans src/ comme
    // argument littéral de t('…') DOIT exister en FR.
    const fr = JSON.parse(readFileSync(join(ROOT, 'design/i18n/fr.json'), 'utf8')) as Record<string, string>;
    const pattern = /\bt\(\s*'([a-z0-9._-]+)'/gi;
    const unknown = new Set<string>();
    for (const source of readSources('src')) {
      for (const match of source.text.matchAll(pattern)) {
        const key = match[1];
        if (key !== undefined && !(key in fr)) unknown.add(`${key} (${source.path})`);
      }
    }
    assert.deepEqual([...unknown], [], `clés citées par le code et absentes du catalogue FR :\n  ${[...unknown].join('\n  ')}`);
  });

  it('la liste d’exceptions reste courte et ses consommateurs existent', () => {
    const entries = Object.entries(JUSTIFIED_EXCEPTIONS);
    assert.ok(entries.length <= MAX_EXCEPTIONS, `liste d’exceptions trop longue (${entries.length} > ${MAX_EXCEPTIONS}) : une clé morte de plus doit être supprimée, pas exceptionnalisée`);
    for (const [key, consumer] of entries) {
      const file = consumer.split(' ')[0] ?? '';
      if (file.startsWith('design/') || file.startsWith('src/') || file.startsWith('tests/')) {
        statSync(join(ROOT, file)); // le fichier consommateur doit exister
      }
      assert.ok(consumer.length > 0, `${key} : exception sans consommateur`);
    }
  });
});
