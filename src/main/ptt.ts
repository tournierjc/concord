/**
 * ptt.ts — raccourci push-to-talk GLOBAL (SPEC-001 A13 / CA16).
 *
 * `globalShortcut` fonctionne même quand l'application n'a pas le focus : condition explicite de
 * CA16 (parler en étant dans un autre logiciel). Un raccourci déjà pris par une autre application
 * n'est PAS une erreur fatale : on essaie une courte liste de replis, et on remonte l'état réel à
 * l'UI (`shortcut-conflict`), qui l'affiche. On ne laisse jamais croire que le PTT est actif quand
 * il ne l'est pas.
 *
 * NON VÉRIFIÉ unitairement : dépend de `electron.globalShortcut`, indisponible hors application.
 */

import { globalShortcut } from 'electron';

import { DEFAULT_PTT_ACCELERATOR, isValidAccelerator, normalizeAccelerator } from '../shell/settings-schema';
import type { ShortcutConflictDto } from '../shell/ipc-contract';
import type { Timers } from '../engine/timers.ts';
import { systemTimers } from './timers';

/**
 * Anti-rebond du relâchement : `globalShortcut` peut livrer deux « up » pour un « down » (relâche
 * du modificateur puis de la touche). 250 ms couvre les deux sans jamais couper une phrase.
 */
const PTT_RELEASE_DELAY_MS = 250;

/** Raccourcis essayés dans l'ordre si le raccourci demandé est refusé par le système. */
export const PTT_FALLBACKS: readonly string[] = [
  'CommandOrControl+Shift+Space',
  'CommandOrControl+Alt+Space',
];

export interface PttRegistration {
  /** Raccourci effectivement enregistré ; null si aucun n'a pu l'être. */
  accelerator: string | null;
  registered: boolean;
  /** Raccourci demandé mais refusé (conflit système), null si le demandé a fonctionné. */
  conflict: ShortcutConflictDto | null;
}

/**
 * Enregistre le push-to-talk. `onChange(true)` à l'appui, `onChange(false)` au relâchement.
 * Renvoie l'état réel, à répercuter dans l'UI.
 */
export function registerPushToTalk(
  requested: string,
  onChange: (active: boolean) => void,
  // (SPEC-012 §4) Aucune minuterie ambiante dans le main hors de `src/main/timers.ts` : le
  // relâchement différé passe par le port, qui arme aussi l'`unref`.
  timers: Timers = systemTimers,
): PttRegistration {
  const candidates: string[] = [];
  const normalizedRequested = (() => {
    try {
      return normalizeAccelerator(requested);
    } catch {
      return DEFAULT_PTT_ACCELERATOR;
    }
  })();
  candidates.push(normalizedRequested);
  for (const fallback of PTT_FALLBACKS) {
    if (!candidates.includes(fallback) && isValidAccelerator(fallback)) candidates.push(fallback);
  }

  for (const candidate of candidates) {
    let registered = false;
    try {
      registered = globalShortcut.register(candidate, () => {
        onChange(true);
        // `globalShortcut` n'expose pas de relâchement : on considère l'appui comme une impulsion
        // courte, puis on relâche après un délai court, comme le fait un PTT « à bascule ».
        timers.once(PTT_RELEASE_DELAY_MS, () => onChange(false));
      });
    } catch {
      registered = false;
    }
    if (registered) {
      const conflict: ShortcutConflictDto | null =
        candidate === normalizedRequested
          ? null
          : {
              accelerator: normalizedRequested,
              registered: false,
              fallback: candidate,
              reason: 'conflit',
            };
      return { accelerator: candidate, registered: true, conflict };
    }
  }

  return {
    accelerator: null,
    registered: false,
    conflict: {
      accelerator: normalizedRequested,
      registered: false,
      fallback: null,
      reason: 'indisponible',
    },
  };
}

/** À appeler sur `will-quit` : sans ça, le raccourci reste réservé après la fermeture. */
export function releasePushToTalk(): void {
  globalShortcut.unregisterAll();
}
