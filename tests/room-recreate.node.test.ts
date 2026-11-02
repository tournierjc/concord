/**
 * tests/room-recreate.node.test.ts — la machine de recréage automatique du dernier salon hébergé
 * (2026-11-02, « add auto recreate room on startup »).
 *
 * Aucun Electron, aucun réseau, aucune socket : `createRoomRecreator` ne touche le monde qu'à
 * travers son seam (`host`) et ses minuteries via `Timers` (horloge manuelle, ticks déterministes
 * — SPEC-012 §4 ; aucun `sleep`, aucune attente murale ici).
 *
 * Exigence → assertion :
 *  - « jamais sans mesure » : `arm()` rend `false` et ne publie RIEN si `lastHosted` est `null`
 *    ou si l'option est éteinte — la lecture des réglages ne compte pas comme action ;
 *  - « délai via horloge injectée » : rien ne part avant l'échéance (`pending` seul), le geste
 *    part à `RECREATE_STARTUP_DELAY_MS` exactement, avec le NOM MESURÉ comme argument ;
 *  - « une seule tentative, pas de boucle » : un échec publie `failed` une fois, et un second
 *    `arm()` après un geste ne re-déclenche rien ;
 *  - « anti-doublon » : un nom déjà porté par un pair vu par la découverte ⇒ `failed` avec la clé
 *    `room.auto.failed.hosting`, et `host` n'est JAMAIS appelé ;
 *  - « éteint pendant le délai ⇒ rien de neuf » : l'option est relue À L'ÉCHÉANCE, l'état retombe
 *    `idle` et `host` n'est pas appelé ;
 *  - « un geste qui lève est un échec comme les autres » : `failed`, pas d'exception qui remonte.
 *
 * Lancer : npx tsx --test tests/room-recreate.node.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  IDLE_RECREATE_STATE,
  RECREATE_STARTUP_DELAY_MS,
  autoRecreateCreateAction,
  createRoomRecreator,
  shouldAutoRecreateOnStartup,
  type RecreateState,
} from '../src/main/room-recreate';
import type { Timers } from '../src/engine/timers';

/* ------------------------------------------------------------------ */
/* Double de Timers — horloge artificielle, ticks déterministes         */
/* ------------------------------------------------------------------ */

interface FakeTimer {
  dueAt: number;
  callback: () => void;
  cancelled: boolean;
}

function fakeTimers(start: number = 1_000) {
  let nowMs = start;
  const timers: FakeTimer[] = [];
  const api: Timers & { now(): number; advance(ms: number): void; pending(): number } = {
    once(delayMs: number, callback: () => void): unknown {
      const timer: FakeTimer = { dueAt: nowMs + delayMs, callback, cancelled: false };
      timers.push(timer);
      return timer;
    },
    cancel(handle: unknown): void {
      const timer = handle as FakeTimer | null;
      if (timer !== null) timer.cancelled = true;
    },
    now: () => nowMs,
    async advance(ms: number): Promise<void> {
      const target = nowMs + ms;
      for (;;) {
        const due = timers
          .filter((t) => !t.cancelled && t.dueAt <= target)
          .sort((a, b) => a.dueAt - b.dueAt)[0];
        if (due === undefined) break;
        nowMs = due.dueAt;
        due.cancelled = true;
        due.callback();
        // Les callbacks déclenchent un `await` (le seam `host`) : on laisse la microtask tourner.
        await Promise.resolve();
      }
      nowMs = target;
    },
    pending(): number {
      return timers.filter((t) => !t.cancelled).length;
    },
  };
  return api;
}

/* ------------------------------------------------------------------ */
/* Fabrique de scénario — seam faux, états observés                     */
/* ------------------------------------------------------------------ */

interface Scenario {
  auto?: boolean;
  lastHosted?: { name: string; capacity: number } | null;
  /** Ce que rend le geste réel (défaut : succès). `true` = appelé au moins une fois. */
  hostResult?: boolean | 'throws';
  /** Les noms des salons vus sur le réseau au moment du geste. */
  discovered?: readonly string[];
  /** Une mise à jour est prête à installer (lue à l'échéance). */
  updatePendingInstall?: boolean;
}

function scenario(options: Scenario = {}) {
  const hostCalls: string[] = [];
  const states: RecreateState[] = [];
  const timers = fakeTimers();
  let auto = options.auto ?? true;
  let lastHosted = options.lastHosted === undefined ? { name: 'Cuisine', capacity: 8 } : options.lastHosted;
  let updatePendingInstall = options.updatePendingInstall ?? false;
  const discovered = options.discovered ?? [];
  const recreator = createRoomRecreator({
    host: (name) => {
      hostCalls.push(name);
      if (options.hostResult === 'throws') throw new Error('réseau coupé');
      return options.hostResult ?? true;
    },
    settings: () => ({ auto, lastHosted, updatePendingInstall }),
    discoveredNames: () => discovered,
    timers,
    onStateChange: (state) => states.push(state),
  });
  return {
    recreator,
    timers,
    hostCalls,
    states,
    /** Éteindre l'option en cours de partie (relue à l'échéance, pas à l'armement). */
    setAuto(value: boolean): void {
      auto = value;
    },
    setLastHosted(value: { name: string; capacity: number } | null): void {
      lastHosted = value;
    },
    setUpdatePendingInstall(value: boolean): void {
      updatePendingInstall = value;
    },
    lastState(): RecreateState {
      return states[states.length - 1] ?? IDLE_RECREATE_STATE;
    },
  };
}

/* ------------------------------------------------------------------ */
/* La décision pure — armable ou non, sans horloge ni effet de bord     */
/* ------------------------------------------------------------------ */

describe('room-recreate — la décision pure', () => {
  it('mesure présente + option active ⇒ on arme', () => {
    assert.equal(shouldAutoRecreateOnStartup({ auto: true, lastHosted: { name: 'A', capacity: 8 } }), true);
  });
  it('pas de mesure ⇒ on n’arme RIEN (jamais un salon inventé)', () => {
    assert.equal(shouldAutoRecreateOnStartup({ auto: true, lastHosted: null }), false);
  });
  it('option éteinte ⇒ on n’arme RIEN, même avec une mesure', () => {
    assert.equal(shouldAutoRecreateOnStartup({ auto: false, lastHosted: { name: 'A', capacity: 8 } }), false);
  });

  it('anti-doublon : un nom déjà porté ⇒ bloqué, clé `hosting`', () => {
    const blocked = autoRecreateCreateAction({ name: 'Cuisine' }, ['cuisine']);
    assert.equal(blocked.kind, 'blocked');
    if (blocked.kind === 'blocked') assert.equal(blocked.reasonKey, 'room.auto.failed.hosting');
  });
  it('anti-doublon : casse ignorée, blancs de bord ignorés (même famille de règle que le lobby)', () => {
    assert.equal(autoRecreateCreateAction({ name: 'Cuisine' }, ['  cuisine  ']).kind, 'blocked');
    assert.equal(autoRecreateCreateAction({ name: '  CUISINE ' }, ['Cuisine']).kind, 'blocked');
    assert.equal(autoRecreateCreateAction({ name: 'Cuisine' }, ['Salon Bureau']).kind, 'create');
  });
  it('pas de mesure ou nom vide ⇒ bloqué, clé `create`, jamais un join vide', () => {
    assert.equal(autoRecreateCreateAction(null, []).kind, 'blocked');
    assert.equal(autoRecreateCreateAction({ name: '   ' }, []).kind, 'blocked');
  });
});

/* ------------------------------------------------------------------ */
/* L'armement — rien sans mesure, rien sans option                       */
/* ------------------------------------------------------------------ */

describe('room-recreate — armement sous garde', () => {
  it('sans mesure : arm() rend false, RIEN n’est publié, aucune minuterie', () => {
    const s = scenario({ lastHosted: null });
    assert.equal(s.recreator.arm(), false);
    assert.deepEqual(s.states, [], 'aucune publication — la lecture des réglages n’est pas une action');
    assert.equal(s.timers.pending(), 0);
    assert.deepEqual(s.hostCalls, []);
  });

  it('option éteinte : arm() rend false, RIEN n’est écrit ni publié', () => {
    const s = scenario({ auto: false });
    assert.equal(s.recreator.arm(), false);
    assert.deepEqual(s.states, []);
    assert.equal(s.timers.pending(), 0);
    assert.deepEqual(s.hostCalls, []);
  });

  it('l’instantané initial est `idle` (rien n’est affirmé avant la machine)', () => {
    const s = scenario({ lastHosted: null });
    assert.deepEqual(s.recreator.getState(), IDLE_RECREATE_STATE);
  });
});

/* ------------------------------------------------------------------ */
/* Le cycle — délai, geste, succès, échec, jamais de boucle             */
/* ------------------------------------------------------------------ */

describe('room-recreate — le cycle sur horloge injectée', () => {
  it('armé : `pending` publié, RIEN ne part avant l’échéance', async () => {
    const s = scenario();
    assert.equal(s.recreator.arm(), true);
    assert.deepEqual(s.states, [{ phase: 'pending', roomName: 'Cuisine', reasonKey: null }]);
    assert.deepEqual(s.hostCalls, [], 'le geste n’a pas encore eu lieu');
    // Juste avant l'échéance : toujours rien.
    await s.timers.advance(RECREATE_STARTUP_DELAY_MS - 1);
    assert.deepEqual(s.hostCalls, []);
  });

  it('à l’échéance : le geste part UNE fois, avec le nom mesuré', async () => {
    const s = scenario();
    s.recreator.arm();
    await s.timers.advance(RECREATE_STARTUP_DELAY_MS);
    assert.deepEqual(s.hostCalls, ['Cuisine'], 'un seul appel, le nom de la mesure');
    assert.equal(s.lastState().phase, 'recreated');
  });

  it('succès : pending → recreating → recreated, dans cet ordre', async () => {
    const s = scenario();
    s.recreator.arm();
    await s.timers.advance(RECREATE_STARTUP_DELAY_MS + 50);
    assert.deepEqual(
      s.states.map((state) => state.phase),
      ['pending', 'recreating', 'recreated'],
    );
  });

  it('échec : failed UNE fois, la clé de raison est une clé du contrat, pas de boucle', async () => {
    const s = scenario({ hostResult: false });
    s.recreator.arm();
    await s.timers.advance(RECREATE_STARTUP_DELAY_MS + 50);
    assert.deepEqual(s.hostCalls, ['Cuisine'], 'une seule tentative, jamais une seconde');
    assert.deepEqual(
      s.states.map((state) => state.phase),
      ['pending', 'recreating', 'failed'],
    );
    assert.equal(s.lastState().reasonKey, 'room.auto.failed.create');
    // Un second arm() après la tentative ne relance rien (tentative unique par session).
    assert.equal(s.recreator.arm(), false);
    await s.timers.advance(RECREATE_STARTUP_DELAY_MS * 3);
    assert.deepEqual(s.hostCalls, ['Cuisine'], 'toujours un seul appel après le second armement');
  });

  it('un geste qui lève est un échec comme les autres : failed, aucune exception qui remonte', async () => {
    const s = scenario({ hostResult: 'throws' });
    s.recreator.arm();
    await s.timers.advance(RECREATE_STARTUP_DELAY_MS + 50);
    assert.equal(s.lastState().phase, 'failed');
    assert.equal(s.lastState().reasonKey, 'room.auto.failed.create');
  });

  it('anti-doublon à l’échéance : le nom est porté ⇒ failed/hosting et host JAMAIS appelé', async () => {
    const s = scenario({ discovered: ['cuisine'] });
    s.recreator.arm();
    await s.timers.advance(RECREATE_STARTUP_DELAY_MS + 50);
    assert.deepEqual(s.hostCalls, [], 'jamais un second salon du même nom');
    assert.equal(s.lastState().phase, 'failed');
    assert.equal(s.lastState().reasonKey, 'room.auto.failed.hosting');
  });

  it('mise à jour PRÊTE à l’échéance : failed/update et host JAMAIS appelé (le salon n’verrouille pas l’installation)', async () => {
    const s = scenario({ updatePendingInstall: true });
    s.recreator.arm();
    await s.timers.advance(RECREATE_STARTUP_DELAY_MS + 50);
    assert.deepEqual(s.hostCalls, [], 'aucun salon quand une mise à jour attend');
    assert.equal(s.lastState().phase, 'failed');
    assert.equal(s.lastState().reasonKey, 'room.auto.failed.update');
  });

  it('mise à jour prête à l’ARMEMENT mais installée PENDANT le délai : le geste part', async () => {
    // La valeur est relue À L'ÉCHÉANCE : si l'installation a eu lieu pendant les 2 s
    // (redémarrage de la session suivante, en pratique), le recréage retrouve son droit.
    const s = scenario({ updatePendingInstall: true });
    s.recreator.arm();
    s.setUpdatePendingInstall(false);
    await s.timers.advance(RECREATE_STARTUP_DELAY_MS + 50);
    assert.deepEqual(s.hostCalls, ['Cuisine']);
    assert.equal(s.lastState().phase, 'recreated');
  });

  it('éteint PENDANT le délai : l’option est relue à l’échéance, rien ne part, l’état retombe idle', async () => {
    const s = scenario();
    s.recreator.arm();
    s.setAuto(false);
    await s.timers.advance(RECREATE_STARTUP_DELAY_MS + 50);
    assert.deepEqual(s.hostCalls, [], 'éteint ⇒ aucun geste neuf au démarrage');
    assert.equal(s.lastState().phase, 'idle');
  });

  it('mesure effacée PENDANT le délai (la personne a ouvert/fermé un salon) : rien ne part', async () => {
    const s = scenario();
    s.recreator.arm();
    s.setLastHosted(null);
    await s.timers.advance(RECREATE_STARTUP_DELAY_MS + 50);
    assert.deepEqual(s.hostCalls, []);
    assert.equal(s.lastState().phase, 'idle');
  });

  it('stop() avant l’échéance : la minuterie est désarmée, le geste n’a jamais lieu', async () => {
    const s = scenario();
    s.recreator.arm();
    s.recreator.stop();
    await s.timers.advance(RECREATE_STARTUP_DELAY_MS * 3);
    assert.deepEqual(s.hostCalls, []);
  });
});
