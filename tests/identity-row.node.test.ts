/**
 * tests/identity-row.node.test.ts — le pseudo est saisissable, et la règle de S1.11 est respectée.
 *
 * Ce que ce fichier garde, dans l'ordre :
 *  1. la règle pure (`nicknameError`) : `empty`, `tooLong`, 32 exactement accepté ;
 *  2. la cohérence avec le schéma de réglages — les deux bornes de 32 caractères ne doivent pas
 *     diverger (`settings-schema.ts` n'importe rien, donc c'est un test qui tient la cohérence) ;
 *  3. le câblage dans `App.tsx` : le pseudo a quitté la barre de titre (S1.11 l'interdit), le champ
 *     porte le libellé, l'aide, le compteur `n/32`, `aria-invalid` et `aria-describedby`, et le
 *     minuteur du toast passe par `browser-timers` (seule porte autorisée côté renderer) ;
 *  4. les jetons CSS employés existent réellement (`--color-state-mute`, `--color-border-subtle`).
 *
 * Lancer : cd /work/lan-voice && npx tsx --test tests/identity-row.node.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  NICKNAME_MAX_LENGTH,
  nicknameError,
  nicknameErrorKey,
} from '../src/shell/nickname.ts';
import { defaultSettings, parseSettings } from '../src/shell/settings-schema.ts';

const APP = readFileSync(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
const FR = JSON.parse(
  readFileSync(new URL('../design/i18n/fr.json', import.meta.url), 'utf8'),
) as Record<string, string>;
const EN = JSON.parse(
  readFileSync(new URL('../design/i18n/en.json', import.meta.url), 'utf8'),
) as Record<string, string>;

/* ---------------------------------------------------------------- 1. la règle pure ---- */

test('un pseudo valide ne produit aucune erreur', () => {
  assert.equal(nicknameError('Régie'), null);
  assert.equal(nicknameError('a'), null);
  assert.equal(nicknameError('a'.repeat(NICKNAME_MAX_LENGTH)), null, '32 caractères passent');
});

test('32 caractères est la borne, 33 ne passe plus', () => {
  assert.equal(NICKNAME_MAX_LENGTH, 32);
  assert.equal(nicknameError('a'.repeat(33)), 'tooLong');
  assert.equal(nicknameError('a'.repeat(32)), null);
});

test('un champ vide — ou fait d’espaces — est « empty »', () => {
  assert.equal(nicknameError(''), 'empty');
  assert.equal(nicknameError('   '), 'empty', 'des blancs ne sont pas un nom affiché aux autres');
  assert.equal(nicknameError('\t\n'), 'empty');
});

test('l’ordre de vérification : un collage trop long reste « tooLong »', () => {
  assert.equal(nicknameError(' '.repeat(40)), 'tooLong', 'c’est ce que l’utilisateur vient de coller');
});

test('chaque erreur a sa clé de dictionnaire, présente dans les deux langues', () => {
  for (const error of ['empty', 'tooLong'] as const) {
    const key = nicknameErrorKey(error);
    assert.equal(key, `app.nickname.error.${error}`);
    assert.equal(typeof FR[key], 'string', `${key} manque en français`);
    assert.equal(typeof EN[key], 'string', `${key} manque en anglais`);
  }
});

/* ------------------------------------------------- 2. cohérence avec le schéma de réglages ---- */

test('le schéma refuse exactement ce que la règle d’affichage refuse', () => {
  const base = defaultSettings();

  const accepted = parseSettings({ ...base, nickname: 'a'.repeat(NICKNAME_MAX_LENGTH) });
  assert.equal(accepted.ok, true, '32 caractères doivent être acceptés par le schéma');

  const refused = parseSettings({ ...base, nickname: 'a'.repeat(NICKNAME_MAX_LENGTH + 1) });
  assert.equal(refused.ok, false, '33 caractères doivent être refusés par le schéma');
  if (refused.ok) throw new Error('inatteignable');
  assert.deepEqual(
    refused.errors.map((error) => `${error.path}:${error.code}`),
    ['.nickname:range'],
  );

  // Le schéma autorise un pseudo vide (c'est le cas « l'utilisateur n'a rien saisi ») : l'erreur
  // `empty` est une règle d'ÉCRAN (S1.11), pas une règle de stockage — d'où deux notions distinctes.
  assert.equal(parseSettings({ ...base, nickname: '' }).ok, true);
});

/* ----------------------------------------------------------------- 3. câblage de l’écran ---- */

test('le pseudo a quitté la barre de titre (S1.11)', () => {
  assert.doesNotMatch(APP, /titlebar__identity/, 'la barre de titre ne porte plus le pseudo');
  assert.doesNotMatch(CSS, /\.titlebar__identity\s*\{/, 'sa règle CSS est retirée avec lui');
});

test('IdentityRow porte libellé, aide, compteur, aria et borne de saisie', () => {
  assert.match(APP, /function IdentityRow\(/);
  assert.match(APP, /t\('app\.nickname\.label'\)/);
  assert.match(APP, /t\('app\.nickname\.placeholder'\)/);
  assert.match(APP, /t\('app\.nickname\.help'\)/);
  assert.match(APP, /t\('common\.counter', \{ value: draft\.length, max: NICKNAME_MAX_LENGTH \}\)/);
  assert.match(APP, /maxLength=\{NICKNAME_MAX_LENGTH\}/);
  assert.match(APP, /aria-invalid=\{error !== null\}/);
  assert.match(APP, /aria-describedby=/);
  assert.match(APP, /className="field__error" id=\{errorId\}/);
  // La validation ne bloque rien : rien ne désactive le bouton de création pendant la frappe.
  assert.doesNotMatch(APP, /disabled=\{error/, 'aucune saisie invalide ne doit désactiver un bouton');
});

test('la valeur en vigueur ne suit que les saisies valides', () => {
  // `onChange` n'est appelé que si la règle ne trouve pas d'erreur : le pseudo précédent gouverne.
  assert.match(APP, /if \(found === null\) \{\s*setError\(null\);\s*onChange\(next\);/);
  // Les deux déclencheurs de S1.11 restent distincts : `tooLong` à la frappe, `empty` au blur.
  assert.match(APP, /if \(found === 'tooLong'\) setError\('tooLong'\)/);
  // `setError(found)` reste légitime à la SORTIE de champ, mais pas dans la frappe (`accept`).
  const acceptBody = APP.slice(APP.indexOf('const accept'), APP.indexOf('  return (', APP.indexOf('const accept')));
  assert.ok(acceptBody.length > 0, 'la frappe doit être lisible');
  assert.doesNotMatch(acceptBody, /setError\(found\)/, 'une frappe vide n’accuse pas en pleine saisie');
  assert.match(APP, /onBlur=\{[\s\S]{0,240}setError\(found\)/, 'la sortie de champ, elle, constate');
  assert.match(APP, /const \[draft, setDraft\] = useState<string>\(value\)/);
});

test('le toast est annoncé poliment et son minuteur vient de browser-timers', () => {
  assert.match(APP, /aria-live="polite"/);
  assert.match(APP, /t\('app\.nickname\.saved'\)/);
  assert.match(APP, /browserTimers\(\)\.once|const timers = browserTimers\(\)/);
  assert.doesNotMatch(APP, /window\.setTimeout|setTimeout\(/, 'aucun minuteur nu dans le renderer');
});

test('les clés du compteur et du toast existent dans les deux langues, dans le même ordre', () => {
  assert.equal(typeof FR['common.counter'], 'string');
  assert.equal(typeof EN['common.counter'], 'string');
  assert.match(FR['common.counter'] ?? '', /\{\{value\}\}\/\{\{max\}\}/);
  assert.deepEqual(Object.keys(FR), Object.keys(EN), 'les deux dictionnaires restent parallèles');
});

/* ------------------------------------------------------------------------- 4. jetons CSS ---- */

test('les jetons employés par la nouvelle feuille existent', () => {
  for (const rule of ['.identity {', '.identity__counter {', '.input--invalid {', '.toast-region {', '.toast {']) {
    assert.ok(CSS.includes(rule), `${rule} doit exister`);
  }
  assert.match(CSS, /\.input--invalid \{\s*border-color: var\(--color-state-mute\);/);
  const used = [...CSS.slice(CSS.indexOf('/* --- Identité')).matchAll(/var\((--[a-z0-9-]+)\)/g)].map(
    (match) => match[1],
  );
  assert.ok(used.length > 0, 'la section identité doit employer des jetons');
  for (const token of used) {
    assert.doesNotMatch(token ?? '', /state-(danger|warning|success)/, `${token} n'existe pas`);
  }
});
