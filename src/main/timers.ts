/**
 * src/main/timers.ts — l'horloge du processus principal, comme PORT (T21 / SPEC-012 §4).
 *
 * Pourquoi ce fichier existe. SPEC-012 §4 compte les minuteries ambiantes du dépôt : A3 « un seul
 * fichier contient `setTimeout(` », A4 « aucun `setInterval` ». Le moteur et la page tiennent cette
 * règle depuis AD-17 (`src/engine/timers.ts` déclare le besoin, `src/renderer/browser-timers.ts`
 * l'assouvit). Le processus principal, lui, en portait quatre d'un coup — et quatre sites qui
 * divergent, c'est quatre façons d'oublier un `unref`, un `clear`, ou de tester avec une vraie
 * horloge.
 *
 * La règle n'est pas « pas de minuterie dans le main » : c'est la même que pour le moteur —
 * une seule porte. Ce fichier est cette porte. Conséquence mesurable : les appels ambiants
 * n'apparaissent plus que dans DEUX fichiers du dépôt, un par processus
 * (`src/renderer/browser-timers.ts`, celui-ci). A3 = 2, A4 = 1.
 *
 * Ce qu'il ajoute au contrat du moteur, et pourquoi : `Timers` (moteur) ne connaît que `once` —
 * une échéance, pas une cadence, parce que le moteur ne poll jamais. Le main, lui, a UNE cadence
 * légitime (la scrutation du curseur pour `setIgnoreMouseEvents`, qui est le seul moyen de laisser
 * passer les clics hors des avatars). Elle s'écrit `repeat`, extension locale au main : le contrat
 * du moteur n'est pas élargi pour un besoin qui n'est pas le sien.
 *
 * `unref` est armé ici, une fois, pour tous les sites : une minuterie de la coquille ne doit jamais
 * retenir le processus à la fermeture. C'était recopié à la main dans deux des quatre sites, et
 * oublié ailleurs.
 */

import type { Timers } from '../engine/timers.ts';

export interface MainTimers extends Timers {
  /**
   * Arme `callback` toutes les `ms` millisecondes et rend un jeton opaque.
   * À désarmer avec `cancel`, comme `once` — un seul désarmement pour les deux formes.
   */
  repeat(ms: number, callback: () => void): unknown;
  /**
   * Instant courant, en millisecondes epoch.
   *
   * Même raison que `once` : une horloge réelle à UN seul endroit par processus. Les deux sites du
   * main qui datent des messages (`discovery-bridge`, `signaling-link`) écrivaient
   * `now: () => Date.now()` chacun de leur côté ; le port le porte maintenant, et un test fige le
   * temps sans toucher au reste.
   *
   * Non pas `Date` : on ne rend que ce que les producteurs datent — un nombre comparable.
   */
  now(): number;
}

/** Vrai pour tout ce que `setTimeout`/`setInterval` de Node rendent (objet `Timeout`). */
function isHandle(handle: unknown): handle is NodeJS.Timeout {
  return typeof handle === 'object' && handle !== null;
}

/**
 * L'horloge réelle du processus principal. Une instance suffit : elle ne tient aucun état, elle
 * prête seulement `setTimeout`/`setInterval` avec `unref` déjà appliqué.
 */
export const systemTimers: MainTimers = {
  once(ms: number, callback: () => void): unknown {
    const handle = setTimeout(callback, ms);
    handle.unref();
    return handle;
  },
  repeat(ms: number, callback: () => void): unknown {
    const handle = setInterval(callback, ms);
    handle.unref();
    return handle;
  },
  cancel(handle: unknown): void {
    // Idempotent, et tolérant aux jetons étrangers : `clearTimeout` et `clearInterval` agissent
    // tous deux sur un `Timeout` de Node, quelle que soit la forme qui l'a armé.
    if (!isHandle(handle)) return;
    clearTimeout(handle);
    clearInterval(handle);
  },
  now(): number {
    return Date.now();
  },
};

/** Horloge inerte, pour les tests qui ne veulent aucune échéance réelle. */
export const NO_MAIN_TIMERS: MainTimers = {
  once: (): unknown => null,
  repeat: (): unknown => null,
  cancel: (): void => {},
  // Temps figé : une horloge inerte ne fait pas avancer le monde, elle l'arrête à l'origine.
  now: (): number => 0,
};
