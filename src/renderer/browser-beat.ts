/**
 * src/renderer/browser-beat.ts — la CADENCE et son temps, comme porte (fix 0.4.2, 2026-11-02)
 *
 * Le battement de mesure de la voix échantillonnait `plane.level()` au rythme de
 * `requestAnimationFrame`. Or la fenêtre principale se CACHE dans la barre système à la
 * croix (0.4.2, `src/main/index.ts` on close → `window.hide`) : une page cachée voit ses
 * rAF throttlées puis gelées par Chromium. Résultat mesuré : les halos « qui parle »
 * restaient figés sur leur dernier état, silencieusement, dès que l'utilisateur
 * Minimisait — exactement le cas d'usage de l'overlay.
 *
 * La règle est la même que pour `setTimeout` (SPEC-012 §4, porte unique par processus) :
 * le renderer ne pose AUCUN `setInterval` ambiant et ne lit AUCUNE horloge ambiante — les
 * gardes de `tests/main-timers.node.test.ts` (A3/A4/A9) le vérifient mécaniquement dans les
 * sources. Ce fichier est la SEULE porte de cadence côté page (comme `browser-timers.ts`
 * est la seule porte d'échéance) et le SEUL lecteur de `performance.now()` : la cadence ET
 * l'instant du battement vivent ici, un test qui injecte son port injecte son temps avec.
 *
 * Pourquoi `window.setInterval` et non le global : en page, la forme qualifiée rend un
 * `number` (l'identifiant du minuteur), là où le `setInterval` global hérité de Node rend
 * un objet. `cancel` accepte les deux, comme dans `browser-timers.ts`.
 */

/** Port de cadence : armer un battement périodique, le désarmer, lire l'instant du tour. */
export interface RendererBeat {
  /** Arme `callback` toutes les `ms` millisecondes ; rend un jeton opaque à `cancel`. */
  repeat(ms: number, callback: (now: number) => void): unknown;
  /** Désarmer un jeton rendu par `repeat`. Idempotent : un jeton inconnu est ignoré. */
  cancel(handle: unknown): void;
  /** L'instant monotone du tour (`performance.now()`), lu par la porte seule. */
  now(): number;
}

/** Vrai pour tout ce que `setInterval` de Node rend (objet `Timeout`). */
function isHandle(handle: unknown): handle is NodeJS.Timeout {
  return typeof handle === 'object' && handle !== null;
}

/** L'instant monotone de la page. SEULE lecture de l'horloge ambiante du renderer (A9). */
function pageNow(): number {
  return performance.now();
}

/** La cadence de la page : `window.setInterval` / `window.clearInterval`, sans état. */
export function browserBeat(): RendererBeat {
  return {
    repeat: (ms: number, callback: (now: number) => void): unknown =>
      window.setInterval(() => callback(pageNow()), ms),
    cancel: (handle: unknown): void => {
      // Un jeton rendu par la page est un `number`, un jeton rendu par Node est un objet :
      // les deux se désarment, sans conversion — `clearInterval` tolère l'étranger.
      if (typeof handle === 'number') {
        window.clearInterval(handle);
        return;
      }
      if (isHandle(handle)) window.clearInterval(handle);
    },
    now: pageNow,
  };
}
