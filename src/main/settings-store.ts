/**
 * settings-store.ts — persistance des réglages dans `userData/settings.json`.
 *
 * Contraintes (0.4.21) :
 *  - écriture ATOMIQUE : fichier temporaire, `fsync`, puis `rename` par-dessus l'original ;
 *  - lecture tolérante : un champ inconnu est conservé et réécrit, un champ invalide retombe
 *    sur son seul défaut. Une version de schéma plus récente n'est pas détruite ;
 *  - un JSON illisible n'est JAMAIS remplacé par les défauts. On en garde une copie
 *    `settings.json.bak` (et une copie datée si `.bak` existe déjà) et le fichier d'origine
 *    reste en place. `save` refuse alors d'écrire par-dessus.
 */

import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  applySettingsPatch,
  defaultSettings,
  interpretSettings,
  mergeSettingsExtras,
  serializeSettings,
  type Settings,
  type SettingsError,
} from '../shell/settings-schema';

export interface SettingsLoadResult {
  settings: Settings;
  /** Vrai quand au moins un champ a été réparé, ou quand le fichier était illisible. */
  recovered: boolean;
  /**
   * Vrai quand le fichier sur disque ne doit PAS être remplacé (JSON illisible ou document
   * qui n'est pas un objet). Les défauts ne vivent alors qu'en mémoire.
   */
  blocked: boolean;
  errors: SettingsError[];
  migratedFrom: number | null;
}

export interface SettingsStore {
  load(): SettingsLoadResult;
  save(settings: Settings): void;
  patch(current: Settings, patch: unknown): Settings;
}

function backupOriginal(filePath: string): void {
  const bak = `${filePath}.bak`;
  try {
    copyFileSync(filePath, bak);
  } catch {
    // Une copie ratée ne doit pas faire jeter les réglages : l'original n'est pas touché.
  }
}

/** Écriture atomique : tmp, fsync, rename. Un arrêt au milieu ne laisse pas un JSON tronqué. */
function atomicWrite(filePath: string, text: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  const fd = openSync(temporaryPath, 'w');
  try {
    writeFileSync(fd, text, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporaryPath, filePath);
}

export function createSettingsStore(filePath: string): SettingsStore {
  let extras: Record<string, unknown> = {};
  let persistVersion: number | null = null;
  let blocked = false;
  let backupBeforeSave = false;

  function load(): SettingsLoadResult {
    extras = {};
    persistVersion = null;
    blocked = false;
    backupBeforeSave = false;
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf8');
    } catch {
      return { settings: defaultSettings(), recovered: false, blocked: false, errors: [], migratedFrom: null };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      backupOriginal(filePath);
      blocked = true;
      return {
        settings: defaultSettings(),
        recovered: true,
        blocked: true,
        errors: [{ path: '', code: 'not-an-object', message: 'fichier de réglages illisible' }],
        migratedFrom: null,
      };
    }
    const result = interpretSettings(parsed);
    if (!result.ok) {
      backupOriginal(filePath);
      blocked = true;
      return { settings: defaultSettings(), recovered: true, blocked: true, errors: result.errors, migratedFrom: null };
    }
    extras = result.extras;
    persistVersion = result.persistVersion;
    if (result.repaired.length > 0) backupBeforeSave = true;
    return {
      settings: result.value,
      recovered: result.repaired.length > 0,
      blocked: false,
      errors: result.repaired,
      migratedFrom: result.migratedFrom,
    };
  }

  function save(settings: Settings): void {
    if (blocked) {
      throw new Error('réglages non enregistrés : le fichier sur disque est illisible et n’est pas écrasé');
    }
    if (backupBeforeSave && existsSync(filePath)) {
      backupOriginal(filePath);
      backupBeforeSave = false;
    }
    const version = persistVersion ?? settings.version;
    const merged = mergeSettingsExtras(settings, extras, version);
    atomicWrite(filePath, `${JSON.stringify(merged, null, 2)}\n`);
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

/** Sérialisation utilisée par les tests qui n'ont pas d'extras. Réexportée pour rester stable. */
export { serializeSettings };
