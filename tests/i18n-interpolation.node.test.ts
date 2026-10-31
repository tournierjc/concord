/**
 * tests/i18n-interpolation.node.test.ts — les libellés à moustaches reçoivent VRAIMENT leurs
 * variables.
 *
 * Le trou que ce fichier ferme : `design/check-i18n.mjs` vérifie la parité FR/EN **du catalogue**
 * (mêmes clés, mêmes moustaches des deux côtés, typographie), mais jamais que le CODE fournit ces
 * variables. `interpolate()` (`src/renderer/i18n.ts`) remplace les `{{nom}}` par `''` quand la
 * variable manque, et rend la chaîne BRUTE quand aucun objet de variables n'est passé : cinq
 * libellés s'affichaient donc littéralement « Salon de {{name}} », « Volume de {{name}} — Léo »,
 * « Plus personne n'est connecté à « {{name}} » », « Rétablir {{shortcut}} » et «  dBFS » (une
 * valeur vide, pas même la moustache) — invisibles en test, visibles à l'écran.
 *
 * Module pur, aucune dépendance : lit les sources et le catalogue, et rend la liste des manques.
 * Les cas d'échec sont d'abord joués sur des extraits FABRIQUÉS (sinon le contrôle ne prouverait
 * que le dépôt est propre aujourd'hui, pas qu'il saurait voir un manque demain).
 *
 * Lancer : cd /work/lan-voice && npx tsx --test tests/i18n-interpolation.node.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';

import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

interface Dictionary {
  fr: Record<string, string>;
  en: Record<string, string>;
}

/** Moustaches `{{nom}}` d'un libellé, dans l'ordre d'apparition, dédoublonnées. */
export function placeholders(value: string): string[] {
  const found = [...value.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)].map((match) => match[1] ?? '');
  return [...new Set(found.filter((name) => name.length > 0))];
}

/**
 * Variables réellement fournies par l'objet d'arguments d'un `t('cle', {…})`.
 *
 * Minimal mais honnête : suit la profondeur des accolades ET des parenthèses, et l'état « dans une
 * chaîne », pour ne pas prendre un `{` d'expression ou une virgule interne pour un séparateur.
 * Reconnaît la forme abrégée (`{ shortcut }`), la forme `{ db: valeur }`, et ignore tout ce qui
 * n'est pas au premier niveau.
 */
export function providedVars(args: string): Set<string> {
  const names = new Set<string>();
  let depth = 0;
  let parens = 0;
  let quote: string | null = null;
  let token = '';
  const flush = (kind: 'pair' | 'shorthand'): void => {
    const name = token.trim().replace(/^[^A-Za-z0-9_$]+/, '');
    if (kind === 'shorthand' && /^[A-Za-z0-9_$]+$/.test(name)) names.add(name);
    token = '';
  };
  for (let index = 0; index < args.length; index += 1) {
    const char = args[index] ?? '';
    if (quote !== null) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[') parens += 1;
    else if (char === ')' || char === ']') parens -= 1;
    else if (char === '{') {
      depth += 1;
      token = '';
      continue;
    } else if (char === '}') {
      if (depth === 1) {
        const label = /([A-Za-z0-9_$]+)\s*:/.exec(token);
        if (label) names.add(label[1] ?? '');
        else flush('shorthand');
      }
      depth -= 1;
      continue;
    } else if (char === ':' && depth === 1 && parens === 0) {
      const label = /([A-Za-z0-9_$]+)\s*$/.exec(token);
      if (label) names.add(label[1] ?? '');
      token = '';
      continue;
    } else if (char === ',' && depth === 1 && parens === 0) {
      flush('shorthand');
      continue;
    }
    if (depth === 1) token += char;
  }
  return names;
}

export interface MissingInterpolation {
  path: string;
  line: number;
  key: string;
  missing: string[];
  value: string;
}

/** Appels `t('cle')` / `t('cle', {…})` d'un texte source. */
function callSites(text: string): Array<{ key: string; args: string | null; line: number }> {
  const found: Array<{ key: string; args: string | null; line: number }> = [];
  const pattern = /\bt\(\s*'([^']+)'\s*(?:,\s*(\{[\s\S]*?\}))?\s*\)/g;
  for (const match of text.matchAll(pattern)) {
    found.push({
      key: match[1] ?? '',
      args: match[2] ?? null,
      line: text.slice(0, match.index ?? 0).split('\n').length,
    });
  }
  return found;
}

/** Manques d'interpolation d'un lot de sources, contre un catalogue FR. */
export function findMissingInterpolations(
  sources: Array<{ path: string; text: string }>,
  dictionary: Record<string, string>,
): MissingInterpolation[] {
  const missing: MissingInterpolation[] = [];
  for (const source of sources) {
    for (const call of callSites(source.text)) {
      const value = dictionary[call.key];
      if (value === undefined) continue; // clé inconnue : jugée ailleurs (parité du catalogue)
      const needed = placeholders(value);
      if (needed.length === 0) continue;
      const provided = call.args === null ? new Set<string>() : providedVars(call.args);
      const absent = needed.filter((name) => !provided.has(name));
      if (absent.length === 0) continue;
      missing.push({
        path: source.path,
        line: call.line,
        key: call.key,
        missing: absent,
        value,
      });
    }
  }
  return missing;
}

function readDictionary(): Dictionary {
  return JSON.parse(readFileSync(join(ROOT, 'design/i18n.json'), 'utf8')) as Dictionary;
}

function readSources(dir: string): Array<{ path: string; text: string }> {
  const sources: Array<{ path: string; text: string }> = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const absolute = join(ROOT, dir, entry);
    if (statSync(absolute).isDirectory()) {
      sources.push(...readSources(join(dir, entry)));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    sources.push({ path: relative(ROOT, absolute), text: readFileSync(absolute, 'utf8') });
  }
  return sources;
}

describe('i18n — le détecteur voit les manques (extraits fabriqués)', () => {
  const dictionary = {
    'room.empty.body': 'Plus personne n’est connecté à « {{name}} ».',
    'settings.vad.thresholdValue': '{{db}} dBFS',
    'control.ptt.hold': 'Maintenez {{shortcut}} pour parler',
    'room.row.members': '{{count}} participants sur {{max}}',
  };

  it('signale un libellé appelé SANS variables (moustache affichée brute)', () => {
    const found = findMissingInterpolations(
      [{ path: 'x.tsx', text: "const a = t('room.empty.body');" }],
      dictionary,
    );
    assert.equal(found.length, 1);
    assert.deepEqual(found[0]?.missing, ['name']);
    assert.equal(found[0]?.line, 1);
  });

  it('signale une variable au mauvais nom (trou vide à l’écran)', () => {
    const found = findMissingInterpolations(
      [{ path: 'x.tsx', text: "t('settings.vad.thresholdValue', { value: seuil })" }],
      dictionary,
    );
    assert.deepEqual(found[0]?.missing, ['db']);
  });

  it('signale un libellé à deux moustaches dont une seule est fournie', () => {
    const found = findMissingInterpolations(
      [{ path: 'x.tsx', text: "t('room.row.members', { count: 3 })" }],
      dictionary,
    );
    assert.deepEqual(found[0]?.missing, ['max']);
  });

  it('accepte la forme abrégée, la forme complète, et n’invente pas de manque', () => {
    const text = [
      "t('control.ptt.hold', { shortcut })",
      "t('control.ptt.hold', { shortcut: accel })",
      "t('room.row.members', { count: liste.length, max: MAX })",
      "t('settings.vad.thresholdValue', { db: Math.round(seuil, 1) })",
    ].join('\n');
    assert.deepEqual(findMissingInterpolations([{ path: 'x.tsx', text }], dictionary), []);
  });

  it('ignore les appels sans moustache et les clés inconnues (jugées ailleurs)', () => {
    const text = ["t('settings.vad.threshold')", "t('cle.inconnue', { x: 1 })", 't(dynamique)'].join('\n');
    assert.deepEqual(findMissingInterpolations([{ path: 'x.tsx', text }], dictionary), []);
  });
});

describe('i18n — le dépôt réel ne présente aucun manque', () => {
  const dictionary = readDictionary();
  const sources = [...readSources('src'), ...readSources('design')];

  it('chaque libellé à moustaches appelé dans src/ reçoit ses variables', () => {
    const missing = findMissingInterpolations(sources, dictionary.fr);
    const detail = missing
      .map((entry) => `${entry.path}:${entry.line} t('${entry.key}') manque ${entry.missing.join(', ')} — « ${entry.value} »`)
      .join('\n');
    assert.deepEqual(missing, [], detail);
  });

  it('le catalogue EN fournit les mêmes moustaches que le FR (les deux locales interpolent pareil)', () => {
    const divergences: string[] = [];
    for (const [key, value] of Object.entries(dictionary.fr)) {
      const english = dictionary.en[key];
      if (english === undefined) continue; // parité des clés : contrôlée par design/check-i18n.mjs
      const fr = placeholders(value).sort().join(',');
      const en = placeholders(english).sort().join(',');
      if (fr !== en) divergences.push(`${key} : fr={${fr}} en={${en}}`);
    }
    assert.deepEqual(divergences, [], divergences.join('\n'));
  });

  it('le scan a bien analysé des dizaines d’appels (le test ne passe pas parce qu’il ne lit rien)', () => {
    let calls = 0;
    for (const source of sources) calls += callSites(source.text).length;
    assert.ok(calls > 100, `appels t('…') analysés : ${calls}`);
    assert.ok(sources.length > 20, `fichiers analysés : ${sources.length}`);
  });
});
