/**
 * src/renderer/browser-timers.ts — l'horloge réelle, côté coquille (Carillon)
 *
 * AD-17 / T17. Le moteur (`src/engine/**`) n'a pas le droit d'appeler `setTimeout`
 * (SPEC-004 §3, gardé par `tests/engine-purity.test.ts`) : il déclare un besoin
 * (`Timers`, `src/engine/timers.ts`) et c'est ici qu'on l'assouvit, dans la page
 * Chromium, avec l'horloge du navigateur.
 *
 * Pourquoi `window.setTimeout` et non `setTimeout` : en page, la forme qualifiée
 * rend un `number` (l'identifiant du minuteur), alors que le `setTimeout` global
 * hérité de Node rend un objet `Timeout`. Le contrat `Timers` transporte un jeton
 * opaque ; on reste sur la forme navigateur pour que `cancel` reçoive bien un
 * `number` et que `clearTimeout` n'ait rien à convertir.
 */

import type { Timers } from '../engine/timers.ts'

/**
 * L'horloge de la page. Une instance par application suffit : elle ne tient aucun
 * état, elle ne fait que prêter `setTimeout`/`clearTimeout` au moteur.
 *
 * Elle n'est PAS un minuteur par pair : le maillage range lui-même un jeton par
 * lien et appelle `cancel` quand le lien se ferme ou que le flux arrive.
 */
export function browserTimers(): Timers {
  return {
    once: (ms: number, callback: () => void): unknown => window.setTimeout(callback, ms),
    cancel: (handle: unknown): void => {
      // Un jeton échu reste un `number` : `clearTimeout` sur un identifiant déjà
      // consommé est un no-op spécifié, donc pas besoin de le distinguer ici.
      if (typeof handle === 'number') window.clearTimeout(handle)
    },
  }
}
