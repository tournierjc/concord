/**
 * i18n.ts — traduction FR/EN depuis `design/i18n.json` (297 clés, mesuré le 2026-10-31).
 *
 * Aucun libellé en dur dans les composants : ils appellent `t('room.list.title')`. Une clé absente
 * renvoie la clé elle-même (visible à l'écran, donc repérable) plutôt qu'une chaîne vide.
 *
 * NON VÉRIFIÉ ici : code navigateur (build Vite requis).
 */

import dictionary from '../../design/i18n.json';

export type Locale = 'fr' | 'en';

type Dictionary = Record<string, string>;

// Double cast assumé (C12-3) : `design/i18n.json` est un objet de traduction hétérogène importé
// sans générique ; `Record<string,string>` y est structurellement incompatible, il n'y a pas
// d'alternative sans annoter le JSON généré. D'où ce double cast, unique et local à cette ligne.
const DICTIONARIES = dictionary as unknown as Record<Locale, Dictionary>;
const FALLBACK: Locale = 'fr';

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_match, name: string) => {
    const value = vars[name];
    return value === undefined ? '' : String(value);
  });
}

export function translate(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  const primary = DICTIONARIES[locale] ?? DICTIONARIES[FALLBACK];
  const template = primary[key] ?? DICTIONARIES[FALLBACK]?.[key] ?? key;
  return interpolate(template, vars);
}

export function createTranslator(locale: Locale): Translate {
  return (key, vars) => translate(locale, key, vars);
}

/** Vérification de couverture, utilisée par l'écran de réglages en développement. */
export function missingKeys(locale: Locale): string[] {
  const reference = Object.keys(DICTIONARIES[FALLBACK] ?? {});
  const target = DICTIONARIES[locale] ?? {};
  return reference.filter((key) => !(key in target));
}

export function availableLocales(): Locale[] {
  return Object.keys(DICTIONARIES) as Locale[];
}
