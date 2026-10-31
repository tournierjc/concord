/**
 * src/engine/timers.ts — horloge de temporisation INJECTÉE (Carillon)
 *
 * TÂCHE T17 / AD-17. Pourquoi ce fichier existe : SPEC-004 §3 interdit toute
 * minuterie ambiante ET toute lecture d'horloge murale dans `src/engine/**`
 * (garde-fou mécanique : `tests/engine-purity.test.ts`, qui refuse les trois
 * formes de minuterie globale et l'heure courante). Les deux
 * horloges du moteur sont pourtant réelles et nécessaires :
 *
 *   • `noFlow` : 5 s sans flux ⇒ état `noFlow`, cause `'timeout'` (SPEC-008 §1) ;
 *   • ramassage ICE : plafond de 1 s avant de figer le SDP (T17).
 *
 * La solution n'est pas de contourner le garde-fou (aucun accès indirect au global
 * qui réintroduirait la minuterie), c'est d'**injecter** l'horloge : le moteur
 * déclare le besoin (`Timers`), la
 * coquille fournit l'implémentation réelle (`src/renderer/browser-timers.ts`),
 * les tests fournissent une horloge manuelle déterministe. Le moteur reste pur :
 * mêmes entrées, mêmes sorties, aucune I/O implicite, aucun minuteur caché.
 *
 * Ce que `Timers` ne fait PAS : mesurer le temps. Une seule API, `once` +
 * `cancel` — pas de `now()` : les décisions du moteur ne dépendent jamais de
 * l'heure qu'il est, seulement de l'échéance qu'on lui a demandé d'armer.
 */

/**
 * Deux gestes, pas un de plus : armer une échéance, la désarmer.
 *
 * `handle` est volontairement `unknown` : le moteur n'a rien à savoir de la
 * nature du jeton rendu par l'implémentation (nombre en page Chromium, objet
 * `Timeout` sous Node). Il le range et le rend tel quel à `cancel`, c'est tout.
 */
export interface Timers {
  /** Arme `callback` une fois, dans `ms` millisecondes, et rend un jeton opaque. */
  once(ms: number, callback: () => void): unknown
  /** Désarme un jeton rendu par `once`. Idempotent : un jeton déjà échu est ignoré. */
  cancel(handle: unknown): void
}

/**
 * Horloge inerte : elle n'arme jamais rien.
 *
 * Elle existe pour que `Timers` reste un type total (un test peut vouloir
 * « aucune horloge ») et pour rendre visible, dans le code, qu'une horloge
 * absente n'arme pas de veille. Elle n'est **pas** le défaut de `createMesh` :
 * `MeshOptions.timers` est requis, précisément pour qu'on ne puisse pas oublier
 * l'horloge des 5 s et obtenir un `noFlow` muet.
 */
export const NO_TIMERS: Timers = {
  once: (): unknown => null,
  cancel: (): void => {},
}
