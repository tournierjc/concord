/**
 * tests/browser-beat.node.test.ts — la SEULE porte de cadence du renderer bat, date, et se
 * désarme (fix 0.4.2, 2026-11-02, C3).
 *
 * `browser-beat.ts` est à la cadence ce que `browser-timers.ts` est à l'échéance : l'unique
 * endroit où le renderer touche `window.setInterval` et l'horloge monotone (gardes A3/A4/A9 de
 * `tests/main-timers.node.test.ts`, mesurées dans les sources). Ce fichier exerce la porte
 * ELLE-MÊME sur l'horloge réelle de Node — le battement de mesure des halos « qui parle » en
 * dépend entièrement : une porte qui ne battrait plus figerait les halos, exactement le
 * symptôme corrigé (rAF gelées quand la fenêtre est cachée dans la barre système).
 *
 * Lancer : npx tsx --test tests/browser-beat.node.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { browserBeat } from '../src/renderer/browser-beat.ts';

/**
 * La page, au sens strict : `window` EST le global (comme dans `fake-rtc.ts`), et
 * `window.setInterval` tombe sur l'horloge réelle de Node. Sans ce pose, la porte refuserait
 * de fonctionner — c'est voulu : elle n'existe QUE pour la page.
 */
function installPageWindow(): () => void {
  const saved = Reflect.getOwnPropertyDescriptor(globalThis, 'window');
  const page = {
    setInterval: (callback: () => void, ms: number): unknown => setInterval(callback, ms),
    clearInterval: (handle: unknown): void => {
      clearInterval(handle as ReturnType<typeof setInterval>);
    },
  };
  Object.defineProperty(globalThis, 'window', {
    value: page,
    configurable: true,
    writable: true,
  });
  return () => {
    if (saved === undefined) Reflect.deleteProperty(globalThis, 'window');
    else Object.defineProperty(globalThis, 'window', saved);
  };
}

/** Attend `ms` réels : ce test mesure une cadence, pas une simulation. */
function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

describe('browserBeat — la porte de cadence de la page', () => {
  it('bat périodiquement et date chaque tour de l’horloge monotone', async () => {
    // Le harnais Node rend `setInterval` global (objet `Timeout`) : la porte doit l'accepter
    // aussi, comme elle accepte le `number` de la page (document `cancel` des deux formes).
    const restorePage = installPageWindow();
    const beat = browserBeat();
    const stamps: number[] = [];
    const handle = beat.repeat(10, (now) => stamps.push(now));
    await sleep(80);
    beat.cancel(handle);
    restorePage();
    assert.ok(stamps.length >= 3, `au moins trois tours en 80 ms à 10 ms, reçu ${stamps.length}`);
    // Temps monotone : chaque tour est horodaté, et l'horodatage ne recule pas.
    for (let i = 1; i < stamps.length; i += 1) {
      const previous = stamps[i - 1];
      const current = stamps[i];
      assert.ok(previous !== undefined && current !== undefined && current >= previous,
        'l’horodatage du battement ne recule jamais');
    }
    // Après désarmement : plus aucun tour (un battement qui survivrait à son `cancel`
    // réveillerait la mesure d'une session morte).
    const before = stamps.length;
    await sleep(40);
    assert.equal(stamps.length, before, 'cancel() désarme la cadence');
  });

  it('cancel est idempotent et tolère un jeton étranger', () => {
    const restorePage = installPageWindow();
    const beat = browserBeat();
    const handle = beat.repeat(1_000, () => undefined);
    beat.cancel(handle);
    assert.doesNotThrow(() => beat.cancel(handle), 'un double cancel est un no-op');
    assert.doesNotThrow(() => beat.cancel('pas-un-jeton'), 'un jeton inconnu est ignoré');
    assert.doesNotThrow(() => beat.cancel(undefined), 'rien n’est armé par un jeton absent');
    beat.cancel(handle);
    restorePage();
  });

  it('now() rend un instant fini et croissant', () => {
    const beat = browserBeat();
    const a = beat.now();
    assert.ok(Number.isFinite(a) && a >= 0, 'un instant fini');
    // Deux lectures dans le même tour peuvent être égales (horloge à résolution grossière) ;
    // elles ne peuvent pas décroître.
    assert.ok(beat.now() >= a, 'l’horloge de la porte ne recule pas');
  });
});
