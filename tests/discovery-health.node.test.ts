/**
 * tests/discovery-health.node.test.ts — l'échec de la découverte REMONTE, il ne se tait plus.
 *
 * Le défaut : `start()` attrapait l'exception du browse et publiait un `console.warn`. Le lobby
 * affichait alors une liste vide sans jamais dire pourquoi — une personne non technicienne ne
 * distingue pas « réseau éteint » de « personne n'a d' salon ». SPEC-002 S1.4/S1.5/S1.10 exige
 * un état explicite ; il passe par `onHealth` → `IPC.eventDiscoveryStatus`.
 *
 * Le test double du browse LEVE (pile mDNS absente, port 5353 occupé) et `hasNetwork` est un
 * bouton : les quatre combinaisons (réseau ±, browse ±) sont jouées. Le double `createMdns`
 * compte aussi ses appels — une sonde réseau appelée à la demande ne doit pas se déclencher
 * sans geste de (re)démarrage.
 *
 * Lancer : cd /work/lan-voice && npx tsx --test tests/discovery-health.node.test.ts
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Service } from 'bonjour-service';

import {
  createDiscoveryBridge,
  type BrowserLike,
  type DiscoveryHealth,
  type MdnsPort,
  type PublishedServiceLike,
} from '../src/main/discovery-bridge.ts';
import { hasRoutableNetwork, type NetworkInterfaceLike } from '../src/main/network-state.ts';
import type { RoomSummaryDto } from '../src/shell/ipc-contract.ts';

/* --------------------------------------------------------------- les doubles ---- */

const NOOP_BROWSER: BrowserLike = { on: () => undefined, stop: () => undefined };

function silentMdns(): MdnsPort {
  return {
    find: () => NOOP_BROWSER,
    publish: (): PublishedServiceLike => ({ stop: () => undefined }),
    destroy: () => undefined,
  };
}

function brokenMdns(): MdnsPort {
  return {
    find: () => {
      throw new Error('EADDRINUSE: port 5353 occupé');
    },
    publish: (): PublishedServiceLike => ({ stop: () => undefined }),
    destroy: () => undefined,
  };
}

interface Harness {
  health: DiscoveryHealth[];
  findCalls: number;
}

function makeBridge(options: {
  mdns: () => MdnsPort;
  hasNetwork?: () => boolean;
}): { bridge: ReturnType<typeof createDiscoveryBridge>; harness: Harness } {
  const harness: Harness = { health: [], findCalls: 0 };
  const counting: MdnsPort = {
    ...options.mdns(),
    find: (onUp) => {
      harness.findCalls += 1;
      return options.mdns().find(onUp);
    },
  };
  const bridge = createDiscoveryBridge({
    onRooms: (_rooms: RoomSummaryDto[]) => undefined,
    onHealth: (state) => harness.health.push(state),
    hasNetwork: options.hasNetwork ?? (() => true),
    now: () => 0,
    scanWindowMs: 1_000,
    timers: {
      once: () => null,
      repeat: () => null,
      cancel: () => undefined,
      now: () => 0,
    },
    createMdns: () => counting,
    instanceId: 'instance-de-test',
  });
  return { bridge, harness };
}

/* ------------------------------------------- 1. les quatre combinaisons ---- */

test('browse qui lève avec réseau actif : « mdns-down » remonté une fois', () => {
  const { bridge, harness } = makeBridge({ mdns: brokenMdns });
  bridge.start();
  assert.deepEqual(harness.health, ['mdns-down']);
  // Un second start() qui échoue pareil ne doit PAS empiler les bandeaux (S1.7 : pas de pile).
  bridge.start();
  assert.deepEqual(harness.health, ['mdns-down'], 'le même état n’est publié qu’une fois');
  bridge.close();
});

test('aucune interface réseau : « offline » remonté, même si le browse fonctionne', () => {
  const { bridge, harness } = makeBridge({
    mdns: silentMdns,
    hasNetwork: () => false,
  });
  bridge.start();
  assert.deepEqual(harness.health, ['offline']);
  bridge.close();
});

test('hors-ligne ET browse cassé : « offline » gagne (le motif utile, pas le symptôme)', () => {
  const { bridge, harness } = makeBridge({ mdns: brokenMdns, hasNetwork: () => false });
  bridge.start();
  assert.deepEqual(harness.health, ['offline']);
  bridge.close();
});

test('nominal : le bridge démarre sans rien publier (aucun faux état)', () => {
  const { bridge, harness } = makeBridge({ mdns: silentMdns });
  bridge.start();
  assert.deepEqual(harness.health, [], 'aucun changement : aucun événement');
  bridge.close();
});

test('un (re)start qui réussit après un échec publie le retour à « ok »', () => {
  let broken = true;
  const { bridge, harness } = makeBridge({
    mdns: () => (broken ? brokenMdns() : silentMdns()),
  });
  bridge.start();
  assert.deepEqual(harness.health, ['mdns-down']);
  broken = false;
  // Le `if (closed || browser !== null)` du bridge laisse repartir un browse absent.
  bridge.start();
  assert.deepEqual(harness.health, ['mdns-down', 'ok'], 'la reprise est dite, sans intervention');
  bridge.close();
});

test('la santé est relue à chaque start : la sonde réseau n’est pas figée au boot', () => {
  let online = false;
  const { bridge, harness } = makeBridge({ mdns: silentMdns, hasNetwork: () => online });
  bridge.start();
  assert.deepEqual(harness.health, ['offline']);
  online = true;
  bridge.start();
  // Sortie de hors-ligne : browse OK, plus aucune raison de se plaindre — et le bandeau doit
  // s'effacer SANS redémarrage. C'est le contrat documenté de `onHealth` (un changement, pas un
  // mensonge) : `offline` était un état d'échec, le browse qui réussit le rend périmé.
  assert.deepEqual(harness.health, ['offline', 'ok'], 'le retour du réseau est dit au lobby');
  bridge.close();
});

/* --------------------------------- 2. la décision réseau est pure et testée ---- */

function iface(address: string, overrides: Partial<NetworkInterfaceLike> = {}): NetworkInterfaceLike {
  return { address, family: 'IPv4', internal: false, ...overrides };
}

test('hasRoutableNetwork : une IPv4 privée suffit', () => {
  assert.equal(hasRoutableNetwork({ wlan0: [iface('192.168.1.12')] }), true);
});

test('hasRoutableNetwork : loopback seul ne compte pas — un poste connecté à lui-même n’est pas en réseau', () => {
  assert.equal(
    hasRoutableNetwork({ lo: [iface('127.0.0.1', { internal: true })] }),
    false,
  );
});

test('hasRoutableNetwork : 169.254/16 (DHCP mort) ne compte pas comme réseau actif', () => {
  assert.equal(hasRoutableNetwork({ wlan0: [iface('169.254.83.20')] }), false);
});

test('hasRoutableNetwork : interface absente ou vide = hors ligne, pas une exception', () => {
  assert.equal(hasRoutableNetwork({}), false);
  assert.equal(hasRoutableNetwork({ eth0: undefined }), false);
  assert.equal(hasRoutableNetwork({ eth0: [] }), false);
});
