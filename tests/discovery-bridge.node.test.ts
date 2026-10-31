/**
 * tests/discovery-bridge.node.test.ts — le bridge de découverte annonce AUSSI le salon.
 *
 * Ce que ce fichier défend : un hôte doit publier son salon en mDNS (`_concord._udp`), sinon aucun
 * autre poste ne le voit — la liste des salons restait vide sur un vrai réseau et « rejoindre » un
 * salon distant était impossible. Le port publié est celui RÉELLEMENT écouté (A5), l'annonce est
 * retirée quand le salon se ferme, et notre propre annonce ne revient jamais dans la liste.
 *
 * Aucun socket, aucun port 5353 : la pile mDNS est un port injecté, en mémoire. C'est exactement le
 * même code de production qui est exercé — `defaultMdnsPort()` est la seule partie remplacée.
 *
 * Lancer : cd /work/lan-voice && npx tsx --test tests/discovery-bridge.node.test.ts
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Service } from 'bonjour-service';

import {
  DISCOVERY_SERVICE_TYPE,
  createDiscoveryBridge,
  type MdnsPort,
  type PublishedServiceLike,
} from '../src/main/discovery-bridge.ts';
import type { RoomSummaryDto } from '../src/shell/ipc-contract.ts';

/* ------------------------------------------------------------------ */
/* Doublure mDNS, en mémoire                                           */
/* ------------------------------------------------------------------ */

interface FakeService {
  name: string;
  host: string;
  port: number;
  txt?: Record<string, string>;
  addresses?: string[];
}

interface PublishCall {
  name: string;
  type: string;
  protocol: string;
  port: number;
  txt: Record<string, string>;
}

interface FakeMdns {
  port: MdnsPort;
  publishes: PublishCall[];
  /** Index (dans `publishes`) des annonces retirées, dans l'ordre. */
  retracted: number[];
  stopBrowseCount: number;
  destroyCount: number;
  /** Simule une annonce reçue du réseau (multicast). */
  emit(kind: 'up' | 'down', service: FakeService): void;
}

function createFakeMdns(): FakeMdns {
  const publishes: PublishCall[] = [];
  const retracted: number[] = [];
  const browsers: Array<{
    handlers: Record<string, Array<(service: Service) => void>>;
    stopped: boolean;
  }> = [];

  const mdns: FakeMdns = {
    publishes,
    retracted,
    stopBrowseCount: 0,
    destroyCount: 0,
    port: {
      find(onUp) {
        const entry = { handlers: {} as Record<string, Array<(service: Service) => void>>, stopped: false };
        // `find(opts, onUp)` enregistre déjà `onUp` sur 'up' : le bridge appelle AUSSI `on('up')`.
        // On reproduit fidèlement ce double enregistrement, la production le fait.
        entry.handlers.up = [onUp];
        browsers.push(entry);
        return {
          on(event, listener) {
            entry.handlers[event] = [...(entry.handlers[event] ?? []), listener];
            return undefined;
          },
          stop() {
            entry.stopped = true;
            mdns.stopBrowseCount += 1;
          },
        };
      },
      publish(options) {
        publishes.push({ ...options });
        const index = publishes.length - 1;
        const handle: PublishedServiceLike = {
          stop() {
            retracted.push(index);
          },
        };
        return handle;
      },
      destroy() {
        mdns.destroyCount += 1;
      },
    },
    emit(kind, service) {
      for (const browser of browsers) {
        if (browser.stopped) continue;
        for (const listener of browser.handlers[kind] ?? []) {
          listener(service as unknown as Service);
        }
      }
    },
  };
  return mdns;
}

/* ------------------------------------------------------------------ */
/* Harnais                                                             */
/* ------------------------------------------------------------------ */

const INSTANCE_ID = 'instance-de-test';

function makeBridge(
  mdns: FakeMdns,
  collected: RoomSummaryDto[][] = [],
): ReturnType<typeof createDiscoveryBridge> {
  const bridge = createDiscoveryBridge({
    onRooms: (rooms) => collected.push(rooms),
    now: () => Date.now(),
    scanWindowMs: 1_000,
    createMdns: () => mdns.port,
    instanceId: INSTANCE_ID,
  });
  bridge.start();
  return bridge;
}

function foreign(overrides: Partial<FakeService> = {}): FakeService {
  return { name: 'poste-de-marion', host: '192.168.1.30', port: 47821, ...overrides };
}

/* ------------------------------------------------------------------ */
/* 1. L'hôte annonce son salon                                         */
/* ------------------------------------------------------------------ */

test('announce publie _concord._udp avec le port réellement écouté et le TXT du salon', () => {
  const mdns = createFakeMdns();
  const collected: RoomSummaryDto[][] = [];
  const bridge = makeBridge(mdns, collected);

  bridge.announce({ roomName: 'Salon cuisine', port: 47823, participants: 3 });

  assert.equal(mdns.publishes.length, 1, 'une annonce, une seule');
  const published = mdns.publishes[0];
  assert.ok(published);
  assert.equal(published.type, DISCOVERY_SERVICE_TYPE);
  assert.equal(published.protocol, 'udp');
  // Le port DEMANDÉ n'est qu'une préférence : c'est celui écouté qui doit partir sur le réseau.
  assert.equal(published.port, 47823);
  assert.equal(published.txt.roomName, 'Salon cuisine');
  assert.equal(published.txt.participants, '3');
  assert.deepEqual(bridge.announced(), { name: INSTANCE_ID, port: 47823 });

  bridge.close();
});

test('annoncer deux fois remplace l’annonce : l’ancienne est retirée du réseau', () => {
  const mdns = createFakeMdns();
  const bridge = makeBridge(mdns);

  bridge.announce({ roomName: 'Salon', port: 47821, participants: 1 });
  bridge.announce({ roomName: 'Salon', port: 47821, participants: 4 });

  assert.equal(mdns.publishes.length, 2);
  assert.deepEqual(mdns.retracted, [0], 'la première annonce doit être retirée');
  assert.equal(mdns.publishes[1]?.txt.participants, '4');

  bridge.close();
});

test('retract retire l’annonce et se tait ensuite (idempotent)', () => {
  const mdns = createFakeMdns();
  const bridge = makeBridge(mdns);

  bridge.retract();
  assert.equal(mdns.publishes.length, 0, 'aucune annonce à retirer : aucun effet');

  bridge.announce({ roomName: 'Salon', port: 47821, participants: 1 });
  bridge.retract();
  bridge.retract();
  assert.deepEqual(mdns.retracted, [0]);
  assert.equal(bridge.announced(), null);

  bridge.close();
});

/* ------------------------------------------------------------------ */
/* 2. Ce qui n'est jamais annoncé                                      */
/* ------------------------------------------------------------------ */

test('sans port réel, rien n’est publié : pas de salon injoignable sur le réseau', () => {
  const mdns = createFakeMdns();
  const bridge = makeBridge(mdns);

  for (const port of [0, -1, Number.NaN, 70_000, 12.5]) {
    bridge.announce({ roomName: 'Salon', port, participants: 1 });
  }
  assert.equal(mdns.publishes.length, 0);
  assert.equal(bridge.announced(), null);

  bridge.close();
});

test('pile mDNS indisponible : l’annonce est refusée, jamais inventée', () => {
  const mdns = createFakeMdns();
  const bridge = createDiscoveryBridge({
    onRooms: () => undefined,
    now: () => Date.now(),
    scanWindowMs: 1_000,
    createMdns: () => {
      throw new Error('port 5353 occupé');
    },
    instanceId: INSTANCE_ID,
  });
  bridge.start();
  bridge.announce({ roomName: 'Salon', port: 47821, participants: 1 });

  assert.equal(mdns.publishes.length, 0);
  assert.equal(bridge.announced(), null);
  bridge.close();
});

test('après close(), plus rien n’est annoncé', () => {
  const mdns = createFakeMdns();
  const bridge = makeBridge(mdns);
  bridge.announce({ roomName: 'Salon', port: 47821, participants: 1 });
  bridge.close();

  bridge.announce({ roomName: 'Salon', port: 47821, participants: 1 });
  assert.equal(mdns.publishes.length, 1);
  assert.deepEqual(mdns.retracted, [0], 'close() retire l’annonce vivante');
  assert.equal(mdns.destroyCount, 1, 'la pile mDNS est détruite');
  assert.equal(bridge.announced(), null);
});

/* ------------------------------------------------------------------ */
/* 3. Notre propre annonce ne revient pas dans la liste                */
/* ------------------------------------------------------------------ */

test('notre propre annonce, relue par le multicast, n’entre pas dans la liste', () => {
  const mdns = createFakeMdns();
  const collected: RoomSummaryDto[][] = [];
  const bridge = makeBridge(mdns, collected);
  collected.length = 0;

  bridge.announce({ roomName: 'Salon cuisine', port: 47821, participants: 1 });
  collected.length = 0;
  // Le multicast ramène notre service à nous : le proposer à l'utilisateur serait l'inviter à
  // rejoindre le salon qu'il héberge déjà, sur sa propre machine.
  mdns.emit('up', { name: INSTANCE_ID, host: '192.168.1.24', port: 47821, txt: { roomName: 'Salon cuisine' } });

  assert.deepEqual(bridge.list(), []);
  assert.equal(collected.length, 0, 'aucune liste publiée : rien n’a changé');
  bridge.close();
});

test('un salon voisin est listé avec son nom et sa population (TXT)', () => {
  const mdns = createFakeMdns();
  const collected: RoomSummaryDto[][] = [];
  const bridge = makeBridge(mdns, collected);
  collected.length = 0;

  mdns.emit('up', foreign({ txt: { roomName: 'Salon de Léo', participants: '5' } }));

  const rooms = bridge.list();
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0]?.roomName, 'Salon de Léo');
  assert.equal(rooms[0]?.host, '192.168.1.30');
  assert.equal(rooms[0]?.port, 47821);
  assert.equal(rooms[0]?.participantCount, 5);
  assert.equal(rooms[0]?.roomId, '192.168.1.30:47821');
  assert.equal(collected.length, 1, 'la liste est publiée vers le main');

  bridge.close();
});

test('notre annonce n’empêche pas de voir les autres, et disparaît de la liste au retrait', () => {
  const mdns = createFakeMdns();
  const bridge = makeBridge(mdns);

  bridge.announce({ roomName: 'Salon cuisine', port: 47822, participants: 1 });
  mdns.emit('up', foreign());
  assert.equal(bridge.list().length, 1, 'le salon voisin reste visible');

  bridge.retract();
  // Après retrait, une relecture de notre propre service est un service étranger comme un autre :
  // la liste ne doit pas rester figée sur une annonce morte d'une session précédente.
  mdns.emit('up', foreign({ name: INSTANCE_ID, host: '192.168.1.24', port: 47821 }));
  assert.equal(bridge.list().length, 2);

  bridge.close();
});
