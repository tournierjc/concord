/**
 * tests/discovery-watchdog.node.test.ts — le bridge découverte se REMET seul (fix 0.4.2,
 * 2026-11-02, D1 + D2).
 *
 * Deux pannes mesurées sur la 0.4.2 installée, toutes deux silencieuses :
 *
 *  D1 — `discovery.start()` n'était appelé QU'UNE fois au boot (`index.ts`, après les
 *       fenêtres). Une machine sans IPv4 routable au démarrage (Wi-Fi pas encore关联)
 *       publiait `offline`… et ne le relisait JAMAIS : le commentaire « laisse le prochain
 *       start() relire le réseau » n'avait aucun appelant. Le lobby restait vide jusqu'au
 *       redémarrage de l'application.
 *       FIX : un watchdog `MainTimers.repeat` (~5 s) qui, tant que `health !== 'ok'`,
 *       relit `hasNetwork()` et rappelle `start()` (idempotent, déjà gardée).
 *
 *  D2 — le salon hébergé n'était re-annoncé QUE sur changement de population
 *       (`forwardBridgeEvent`). Le registre du LECTEUR pérempe une annonce après 12 s
 *       (`ROOM_DISCOVERY_TTL_MS`) : un salon calme disparaissait de la liste des voisins,
 *       silencieusement, jusqu'au premier arrivé.
 *       FIX : re-annonce périodique sous le TTL tant que l'annonce vit ; désarmée au
 *       `retract()` et au `close()`.
 *
 * Les deux tests jouent sur l'horloge INJECTÉE (`MainTimers` doublure) — aucun `sleep`,
 * aucune attente réelle.
 *
 * Lancer : npx tsx --test tests/discovery-watchdog.node.test.ts
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Service } from 'bonjour-service';

import {
  ROOM_DISCOVERY_TTL_MS,
} from '../src/engine/net/room-discovery.ts';
import {
  createDiscoveryBridge,
  type BrowserLike,
  type DiscoveryHealth,
  type MdnsPort,
  type PublishedServiceLike,
} from '../src/main/discovery-bridge.ts';
import type { RoomSummaryDto } from '../src/shell/ipc-contract.ts';

/* ------------------------------------------------------------------ doubles */

interface FakeTimer {
  dueAt: number;
  everyMs: number | null;
  callback: () => void;
  cancelled: boolean;
}

/** Doublure d'horloge du main : le temps s'avance à la demande, jamais en dormant. */
function fakeTimers(start: number = 0) {
  let nowMs = start;
  const timers: FakeTimer[] = [];
  return {
    now: () => nowMs,
    once(delayMs: number, callback: () => void): unknown {
      const timer: FakeTimer = { dueAt: nowMs + delayMs, everyMs: null, callback, cancelled: false };
      timers.push(timer);
      return timer;
    },
    repeat(everyMs: number, callback: () => void): unknown {
      const timer: FakeTimer = { dueAt: nowMs + everyMs, everyMs, callback, cancelled: false };
      timers.push(timer);
      return timer;
    },
    cancel(handle: unknown): void {
      if (typeof handle === 'object' && handle !== null) {
        (handle as FakeTimer).cancelled = true;
      }
    },
    /** Fait courir le temps : chaque échéance atteinte s'exécute dans l'ordre, les `repeat` se réarment. */
    advance(ms: number): void {
      const target = nowMs + ms;
      for (;;) {
        const due = timers
          .filter((timer) => !timer.cancelled && timer.dueAt <= target)
          .sort((a, b) => a.dueAt - b.dueAt)[0];
        if (due === undefined) break;
        nowMs = due.dueAt;
        if (due.everyMs === null) due.cancelled = true;
        else due.dueAt = nowMs + due.everyMs;
        due.callback();
      }
      nowMs = target;
    },
    pending(): number {
      return timers.filter((timer) => !timer.cancelled).length;
    },
  };
}

interface PublishCall {
  name: string;
  type: string;
  protocol: string;
  port: number;
  txt: Record<string, string>;
}

function workingMdns(publishes: PublishCall[], retracted: number[]): MdnsPort {
  return {
    find: (_onUp: (service: Service) => void): BrowserLike => ({
      on: () => undefined,
      stop: () => undefined,
    }),
    publish: (options): PublishedServiceLike => {
      publishes.push({ ...options });
      const index = publishes.length - 1;
      return { stop: () => retracted.push(index) };
    },
    destroy: () => undefined,
  };
}

function makeHarness(options: {
  hasNetwork: () => boolean;
  createMdns: () => MdnsPort;
}): {
  bridge: ReturnType<typeof createDiscoveryBridge>;
  timers: ReturnType<typeof fakeTimers>;
  health: DiscoveryHealth[];
  publishes: PublishCall[];
  retracted: number[];
} {
  const timers = fakeTimers();
  const health: DiscoveryHealth[] = [];
  const publishes: PublishCall[] = [];
  const retracted: number[] = [];
  const bridge = createDiscoveryBridge({
    onRooms: (_rooms: RoomSummaryDto[]) => undefined,
    onHealth: (state) => health.push(state),
    hasNetwork: options.hasNetwork,
    now: () => timers.now(),
    scanWindowMs: 1_000,
    timers,
    createMdns: options.createMdns,
    instanceId: 'instance-watchdog-test',
  });
  return { bridge, timers, health, publishes, retracted };
}

/* ------------------------------------------- D1 : le watchdog réseau ---- */

test('boot hors-ligne : le watchdog relit le réseau et arme le browse quand l’interface remonte', () => {
  let online = false;
  const publishes: PublishCall[] = [];
  const retracted: number[] = [];
  let findCalls = 0;
  const timers = fakeTimers();
  const health: DiscoveryHealth[] = [];
  const bridge = createDiscoveryBridge({
    onRooms: (_rooms: RoomSummaryDto[]) => undefined,
    onHealth: (state) => health.push(state),
    hasNetwork: () => online,
    now: () => timers.now(),
    scanWindowMs: 1_000,
    timers,
    createMdns: () => {
      const port = workingMdns(publishes, retracted);
      return {
        ...port,
        find: (onUp) => {
          findCalls += 1;
          return port.find(onUp);
        },
      };
    },
    instanceId: 'instance-watchdog-test',
  });

  // Boot sans interface : `offline` publié, AUCUN browse armé (le bridge ne réveille pas mDNS pour rien).
  bridge.start();
  assert.deepEqual(health, ['offline'], 'l’échec est publié, pas un console.warn muet');
  assert.equal(findCalls, 0, 'hors-ligne : la pile mDNS dort');

  // L'interface remonte (Wi-Fi associé). Aucun geste de l'utilisateur : le watchdog, seul,
  // relit le réseau à son prochain tick (~5 s) et rappelle start() — le « prochain start() »
  // que l'ancien commentaire promettait sans jamais l'appeler.
  online = true;
  timers.advance(5_000);
  assert.equal(findCalls, 1, 'le tick du watchdog a armé le browse');
  assert.deepEqual(health, ['offline', 'ok'], 'la santé revient à « ok » publiée');

  // Le browse est vivant : un tick de plus ne doit RIEN réarmer (idempotence de start()).
  timers.advance(5_000);
  assert.equal(findCalls, 1, 'santé « ok » : le watchdog ne réveille plus la pile');

  // Le watchdog est désarmé : plus aucune échéance cadencée ne tourne (seul le scan 1 s a vécu).
  bridge.close();
  assert.equal(timers.pending(), 0, 'close() désarme TOUTES les échéances, y compris le watchdog');
});

test('browse qui lève (5353 occupé) : le watchdog retente et la santé revient quand la pile répond', () => {
  let mdnsBroken = true;
  const h = makeHarness({
    hasNetwork: () => true,
    createMdns: () => {
      if (mdnsBroken) throw new Error('EADDRINUSE: address already in use 0.0.0.0:5353');
      return workingMdns(h.publishes, h.retracted);
    },
  });

  h.bridge.start();
  assert.deepEqual(h.health, ['mdns-down']);

  // Le port 5353 se libère (l'autre poste a fermé). Personne ne redémarre l'app : le watchdog
  // retente seul au tick suivant.
  mdnsBroken = false;
  h.timers.advance(5_000);
  assert.deepEqual(h.health, ['mdns-down', 'ok'], 'le retry du watchdog a relancé le browse');

  h.bridge.close();
});

/* ------------------------------ D2 : la re-annonce sous le TTL ---- */

test('salon hébergé calme : le battement re-annonce sous le TTL du registre', () => {
  const h = makeHarness({ hasNetwork: () => true, createMdns: () => workingMdns(h.publishes, h.retracted) });
  h.bridge.start();

  h.bridge.announce({ roomName: 'Salon calme', port: 47821, participants: 1 });
  assert.equal(h.publishes.length, 1, 'l’annonce initiale part');

  // Le TTL du registre est 12 s : sans battement, la vue du voisin meurt à 12 s. Le battement
  // est à TTL/2 (6 s) : à 6 s, une re-annonce est partie ; à 12 s, deux.
  h.timers.advance(ROOM_DISCOVERY_TTL_MS / 2);
  assert.equal(h.publishes.length, 2, 'à TTL/2, la re-annonce périodique a rafraîchi l’annonce');

  h.timers.advance(ROOM_DISCOVERY_TTL_MS / 2);
  assert.equal(h.publishes.length, 3, 'à TTL, une deuxième re-annonce — le salon reste visible sans population changeante');

  // La re-annonce porte TOUJOURS le bon TXT (population courante du geste en attente).
  assert.equal(h.publishes[2]?.txt['roomName'], 'Salon calme');
  assert.equal(h.publishes[2]?.txt['participants'], '1');

  // Le retrait de l'annonce désarme le battement : un salon fermé ne continue pas de s'annoncer.
  h.bridge.retract();
  const afterRetract = h.publishes.length;
  h.timers.advance(ROOM_DISCOVERY_TTL_MS * 2);
  assert.equal(h.publishes.length, afterRetract, 'retract() arrête la cadence — rien ne s’annonce après la fermeture');

  h.bridge.close();
  assert.equal(h.timers.pending(), 0, 'close() désarme le battement de re-annonce');
});

test('re-annonce qui échoue (pile qui meurt) : le salon tombe mais le battement ne fait pas tomber l’app', () => {
  let publishBroken = false;
  const h = makeHarness({
    hasNetwork: () => true,
    createMdns: () => ({
      find: (): BrowserLike => ({ on: () => undefined, stop: () => undefined }),
      publish: (options): PublishedServiceLike => {
        if (publishBroken) throw new Error('pile mDNS morte');
        h.publishes.push({ ...options });
        return { stop: () => undefined };
      },
      destroy: () => undefined,
    }),
  });
  h.bridge.start();
  h.bridge.announce({ roomName: 'Salon', port: 47821, participants: 2 });
  assert.equal(h.publishes.length, 1);

  // La pile meurt entre deux battements : le tick qui lève ne doit PAS remonter à l'appelant
  // (aucune exception qui fuit — la règle du module), et le tick suivant retente.
  publishBroken = true;
  h.timers.advance(ROOM_DISCOVERY_TTL_MS / 2);
  assert.equal(h.bridge.announced(), null, 'annonce perçue comme morte : announced() rend honnêtement null');
  publishBroken = false;
  // Le battement ne republie plus lui-même (l'annonce est morte) : c'est `announce()` du main
  // (population, re-bind) qui reprend la main — ici on vérifie juste qu'AUCUNE exception n'a
  // fait tomber le bridge : `list()` répond, `close()` se passe bien.
  h.bridge.list();
  h.bridge.close();
});
