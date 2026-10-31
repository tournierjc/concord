/**
 * settings-store.ts — persistance des réglages dans `userData/settings.json`.
 *
 * Contraintes :
 *  - écriture atomique (fichier temporaire + `rename`), pour ne jamais laisser un JSON tronqué
 *    derrière un arrêt brutal ;
 *  - lecture tolérante : un fichier absent, illisible, corrompu ou écrit par une version plus
 *    récente ne bloque pas le démarrage — on repart des valeurs par défaut et on remonte
 *    l'incident à l'appelant (`recovered: true`), qui peut l'afficher ;
 *  - la validation appartient à `../shell/settings-schema` : ce module ne décide d'aucune borne.
 *
 * Ce fichier n'est pas couvert par `node --test` (il touche au disque et à `app.getPath`), il est
 * donc déclaré NON VÉRIFIÉ unitairement.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  applySettingsPatch,
  defaultSettings,
  parseSettings,
  serializeSettings,
  type Settings,
  type SettingsError,
} from '../shell/settings-schema';

export interface SettingsLoadResult {
  settings: Settings;
  /** Vrai quand le fichier n'a pas pu être utilisé et que les défauts ont pris le relais. */
  recovered: boolean;
  errors: SettingsError[];
  migratedFrom: number | null;
}

export interface SettingsStore {
  load(): SettingsLoadResult;
  save(settings: Settings): void;
  patch(current: Settings, patch: unknown): Settings;
}

export function createSettingsStore(filePath: string): SettingsStore {
  function load(): SettingsLoadResult {
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf8');
    } catch {
      // Premier lancement : rien à signaler, les défauts sont la réponse normale.
      return { settings: defaultSettings(), recovered: false, errors: [], migratedFrom: null };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        settings: defaultSettings(),
        recovered: true,
        errors: [{ path: '', code: 'not-an-object', message: 'fichier de réglages illisible' }],
        migratedFrom: null,
      };
    }
    const result = parseSettings(parsed);
    if (!result.ok) {
      return { settings: defaultSettings(), recovered: true, errors: result.errors, migratedFrom: null };
    }
    return {
      settings: result.value,
      recovered: false,
      errors: [],
      migratedFrom: result.migratedFrom,
    };
  }

  function save(settings: Settings): void {
    const validated = parseSettings(settings);
    if (!validated.ok) {
      throw new Error(
        `réglages non enregistrés (invalides) : ${validated.errors.map((error) => `${error.path}:${error.code}`).join(', ')}`,
      );
    }
    mkdirSync(dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.tmp`;
    writeFileSync(temporaryPath, serializeSettings(validated.value), 'utf8');
    renameSync(temporaryPath, filePath);
  }

  function patch(current: Settings, update: unknown): Settings {
    const result = applySettingsPatch(current, update);
    if (!result.ok) {
      throw new Error(
        `modification refusée : ${result.errors.map((error) => `${error.path}:${error.code}`).join(', ')}`,
      );
    }
    return result.value;
  }

  return { load, save, patch };
}
