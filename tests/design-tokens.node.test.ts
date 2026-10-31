/**
 * tests/design-tokens.node.test.ts — toute variable CSS employée existe vraiment.
 *
 * LE DÉFAUT : `src/renderer/styles.css` emploie six fois des variables qu'aucun jeton ne définit —
 * `--color-state-warning` (×2), `--color-state-danger` (×2), `--color-state-success`,
 * `--color-state-danger-subtle`. Les jetons de `design/tokens.json` s'appellent `state.warn`,
 * `state.mute` (« micro coupé, erreur »), `state.ok`, `state.muteSubtle` (« fond de bandeau
 * d'erreur »), `state.warnSubtle` (« fond de bandeau d'avertissement »). Une variable inconnue ne
 * casse rien : `color: var(--x)` retombe simplement sur la couleur héritée. Le message d'erreur
 * n'était donc pas rouge, le bandeau d'avertissement pas ambré — et rien ne le disait.
 *
 * Le fichier de style pose la règle (« aucune couleur en dur : tout passe par les variables générées
 * depuis design/tokens.json »). Cette garde vérifie la règle là où elle se casse : entre le nom
 * employé dans la feuille et le nom produit par `theme.ts`.
 *
 * Les variables définies ne sont PAS recopiées ici : elles sont lues de `tokensStyleSheet()` (le
 * générateur réel) et de `overlayCssVariables` (les variables de géométrie de l'overlay). Une liste
 * recopiée divergerait — c'est exactement le défaut qu'on répare.
 *
 * Lancer : cd /work/lan-voice && npx tsx --test tests/design-tokens.node.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { tokensStyleSheet } from '../src/renderer/theme.ts';

const STYLES_PATH = new URL('../src/renderer/styles.css', import.meta.url);
const STYLES = readFileSync(STYLES_PATH, 'utf8');
const OVERLAY_SOURCE = readFileSync(
  new URL('../src/shell/overlay-geometry.ts', import.meta.url),
  'utf8',
);

/** Ramasse le premier groupe capturé de chaque correspondance (jamais un `!`). */
function capture(source: string, pattern: RegExp): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(pattern)) {
    const value = match[1];
    if (value !== undefined) out.push(value);
  }
  return out;
}

/** Noms des variables qu'une feuille de style EMPLOIE (`var(--x)`). */
function usedVariables(css: string): Set<string> {
  return new Set(capture(css, /var\(\s*--([a-z0-9-]+)\s*[,)]/g));
}

/** Noms des variables qu'une feuille de style DÉFINIT elle-même. */
function declaredVariables(css: string): Set<string> {
  return new Set(capture(css, /(?:^|[\s;{])--([a-z0-9-]+)\s*:/gm));
}

/** Ensemble des variables que l'application injecte au démarrage. */
function injectedVariables(): Set<string> {
  const names = new Set(capture(tokensStyleSheet(), /--([a-z0-9-]+)\s*:/g));
  // Géométrie de l'overlay : les clés sont produites par `overlayCssVariables` (objet littéral).
  for (const key of capture(OVERLAY_SOURCE, /'(--[a-z0-9-]+)':/g)) names.add(key.slice(2));
  return names;
}

/** Variables employées sans définition connue — c'est ce que la garde doit rendre vide. */
function undefinedVariables(css: string, defined: Set<string>): string[] {
  const declared = declaredVariables(css);
  return [...usedVariables(css)].filter((name) => !defined.has(name) && !declared.has(name)).sort();
}

function defined(): Set<string> {
  return injectedVariables();
}

/* ------------------------------------------------------------------ */
/* 1. La garde                                                         */
/* ------------------------------------------------------------------ */

test('toute variable employée par styles.css est définie par un jeton (ou par la feuille)', () => {
  assert.deepEqual(
    undefinedVariables(STYLES, defined()),
    [],
    'une variable inconnue laisse la couleur héritée : le style ne dit plus rien',
  );
});

test('la garde SAIT échouer (contrôle négatif)', () => {
  const bogus = '.x { color: var(--color-state-nope); border: 1px solid var(--space-99); }';
  assert.deepEqual(undefinedVariables(bogus, defined()), ['color-state-nope', 'space-99']);
});

test('les quatre noms de jetons inexistants ne reviennent pas', () => {
  for (const ghost of [
    'color-state-warning',
    'color-state-danger',
    'color-state-danger-subtle',
    'color-state-success',
  ]) {
    assert.equal(
      STYLES.includes(`var(--${ghost})`),
      false,
      `--${ghost} n'existe dans aucun jeton : c'est le défaut corrigé`,
    );
  }
});

/* ------------------------------------------------------------------ */
/* 2. Les rôles nommés par la spec                                     */
/* ------------------------------------------------------------------ */

/** Extrait le bloc de règles dont le sélecteur commence par `selector`. */
function rule(selector: string): string {
  const index = STYLES.indexOf(selector);
  assert.notEqual(index, -1, `règle absente : ${selector}`);
  return STYLES.slice(index, STYLES.indexOf('}', index));
}

test('erreur = state.mute (« micro coupé, erreur ») et son fond muteSubtle', () => {
  assert.match(rule('.field__error'), /var\(--color-state-mute\)/);
  const banner = rule('.banner--error');
  assert.match(banner, /background: var\(--color-state-mute-subtle\)/);
  assert.match(banner, /solid var\(--color-state-mute\)/);
});

test('avertissement = state.warn, fond warnSubtle (bandeau teinté, pas une carte)', () => {
  const banner = rule('.banner--warning');
  assert.match(banner, /background: var\(--color-state-warn-subtle\)/);
  assert.match(banner, /solid var\(--color-state-warn\)/);
});

test('état de la voix : live = state.ok, unavailable = state.warn', () => {
  assert.match(rule(".controls__voice[data-voice-status='live']"), /var\(--color-state-ok\)/);
  assert.match(rule(".controls__voice[data-voice-status='unavailable']"), /var\(--color-state-warn\)/);
});

test('les jetons de bandeau nommés par la spec sont réellement employés', () => {
  // « fond de bandeau d'erreur » / « fond de bandeau d'avertissement » : les deux jetons existaient
  // sans être employés nulle part.
  assert.match(STYLES, /var\(--color-state-mute-subtle\)/);
  assert.match(STYLES, /var\(--color-state-warn-subtle\)/);
});

/* ------------------------------------------------------------------ */
/* 3. Les échelles de longueur portent leur unité                     */
/* ------------------------------------------------------------------ */

/** Groupes dont chaque valeur est une LONGUEUR : sans `px`, la déclaration est invalide au calcul. */
const LENGTH_PREFIXES = ['space', 'radius', 'text', 'layout', 'component'];

/** Déclarations du bloc `:root` (les échelles), sous forme `nom: valeur`. */
function rootDeclarations(): { name: string; value: string }[] {
  const sheet = tokensStyleSheet();
  const start = sheet.indexOf(':root {');
  const end = sheet.indexOf('}', start);
  const out: { name: string; value: string }[] = [];
  for (const match of sheet.slice(start, end).matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    const name = match[1];
    const value = match[2];
    if (name !== undefined && value !== undefined) out.push({ name, value: value.trim() });
  }
  return out;
}

/** Longueurs sans unité : `border: var(--x) solid` devient invalide, la propriété retombe à zéro. */
function unitlessLengths(declarations: { name: string; value: string }[]): string[] {
  return declarations
    .filter((declaration) => LENGTH_PREFIXES.some((prefix) => declaration.name.startsWith(`${prefix}-`)))
    .filter((declaration) => !/^-?[\d.]+px$/.test(declaration.value))
    .map((declaration) => `${declaration.name}: ${declaration.value}`)
    .sort();
}

test('les échelles de longueur sont en px (une valeur sans unité est une longueur invalide)', () => {
  const declarations = rootDeclarations();
  assert.ok(declarations.length > 30, `échelles lues : ${declarations.length}`);
  assert.deepEqual(
    unitlessLengths(declarations),
    [],
    'sans unité, `border`/`padding`/`height` avec var() sont invalides au calcul',
  );
});

test('la garde d’unité SAIT échouer (contrôle négatif)', () => {
  assert.deepEqual(
    unitlessLengths([
      { name: 'component-hairline', value: '1' },
      { name: 'space-3', value: '12px' },
      { name: 'layout-row-avatar-size', value: '32' },
      { name: 'motion-hover', value: '120ms' },
    ]),
    ['component-hairline: 1', 'layout-row-avatar-size: 32'],
  );
});

test('les jetons d’échelle réellement employés existent avec leur unité', () => {
  for (const name of ['component-hairline', 'component-button-padding-x', 'component-button-height']) {
    const found = rootDeclarations().find((declaration) => declaration.name === name);
    assert.notEqual(found, undefined, `${name} doit être injectée`);
    assert.match(found?.value ?? '', /px$/, `${name} doit porter son unité`);
  }
});
