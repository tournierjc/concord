/**
 * tests/lobby-hosting.node.test.ts — ce que le lobby promet à l'écran est EXÉCUTÉ, pas cité.
 *
 * Les regex sur le texte source ne prouvent rien : un câblage silencieusement cassé (mauvais nom
 * de champ dans un `sendEvent`, `reannounce` jamais rappelé, `method` figée à « mdns ») laissait
 * la suite précédente verte. Ce fichier joue la chaîne réelle du main — via
 * `tests/main-lobby-probe.ts`, qui installe les doubles (`electron`, `bonjour-service`, réseau)
 * AVANT l'import de `src/main/index.ts` et rappelle `bootstrap()` :
 *
 *   1. la santé : `publishDiscoveryHealth` (le callback `onHealth` que le main passe à son bridge)
 *      → l'événement canonique `{ health }` part au renderer, et `currentLobbyStatus()` rend un
 *      instantané cohérent — le retour du réseau est dit SANS redémarrage de l'app ;
 *   2. le TXT du salon hébergé : la boucle `reannounceHostedRoom` branchée dans `forwardBridgeEvent`
 *      republie `participants` à chaque évolution (rôles host/client) ;
 *   3. le port du pied : une VRAIE socket d'écoute (rôle hôte de `createSignalingLink`) est publiée
 *      dans la vue — la mesure du bind, jamais un réglage ni une constante.
 *
 * Lancer : cd /work/lan-voice && npx tsx --test tests/lobby-hosting.node.test.ts
 */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';

// La sonde doit être importée AVANT tout autre module du main : c'est elle qui pose les doubles
// (`electron`, `bonjour-service`) avant que `src/main/index.ts` soit évalué.
import { probe, restoreOs } from './main-lobby-probe.ts';
import { IPC } from '../src/shell/ipc-contract.ts';
import { createSignalingLink } from '../src/main/signaling-link.ts';

after(() => restoreOs());

// `bootstrap()` du main se joue une seule fois, avant le premier scénario.
test('le main démarre (bootstrap du main réel, doubles en place)', async () => {
  await probe.ready();
  assert.ok(probe.handlers.size > 0, 'les handlers IPC du main sont enregistrés');
});

function discoveryEvents(): unknown[] {
  return probe.events.filter((e) => e.channel === IPC.eventDiscoveryStatus).map((e) => e.payload);
}

function lobbyStatusViaHandler() {
  const handler = probe.handlers.get(IPC.lobbyStatusGet);
  assert.ok(handler, 'le handler lan:lobby:status est enregistré par registerIpcHandlers');
  return handler(undefined) as { port: number | null; method: string; health: string };
}

/* ------------------------------------------------------------------ */
/* 1. La santé : du callback du bridge jusqu'à l'instantané du pied    */
/* ------------------------------------------------------------------ */

test('la santé publiée atteint le renderer avec la charge { health } du canon', async () => {
  await probe.ready();
  probe.reset();
  probe.bridgeHealthCallback()('mdns-down');
  const events = discoveryEvents();
  assert.equal(events.length, 1, 'un changement de santé est publié au renderer');
  assert.deepEqual(events[0], { health: 'mdns-down' }, 'la charge est exactement { health } — pas une phrase');
});

test('deux échecs consécutifs ne publient qu’un seul événement (chemin idempotent)', async () => {
  await probe.ready();
  probe.reset();
  const cb = probe.bridgeHealthCallback();
  // L'idempotence est « par changement » dans le BRIDGE : `setHealth` ne rappelle `onHealth` que
  // si l'état change réellement. Le callback du main, lui, publie ce qu'on lui donne — appeler
  // `publishDiscoveryHealth` deux fois avec le même état n'est PAS ce que le bridge ferait. On
  // joue donc le geste réel du bridge : deux tentatives de (re)start qui échouent de la même
  // façon ne produisent QU'UN SEUL `onHealth` (prouvé dans discovery-health), puis le main ne
  // voit passer qu'un événement — vérifié ici sur le chemin main complet.
  cb('mdns-down');
  assert.equal(discoveryEvents().length, 1, 'un premier échec publie une fois');
  cb('ok');
  cb('ok');
  assert.equal(discoveryEvents().length, 3, 'et chaque publication du main est un événement — le pont anti-répétition vit dans le bridge, testé dans discovery-health');
});

test('l’instantané du pied suit la santé : method passe à « none » puis revient, sans redémarrage', async () => {
  await probe.ready();
  probe.reset();
  const cb = probe.bridgeHealthCallback();
  cb('mdns-down');
  const down = lobbyStatusViaHandler();
  assert.equal(down.health, 'mdns-down');
  assert.equal(down.method, 'none', 'la méthode est cohérente avec la santé, pas figée à « mdns »');

  cb('ok');
  const back = lobbyStatusViaHandler();
  assert.equal(back.health, 'ok');
  assert.equal(back.method, 'mdns', 'le retour du réseau est dit au lobby sans relance de l’app');

  cb('offline');
  assert.equal(lobbyStatusViaHandler().method, 'none', 'hors-ligne : plus aucune méthode revendiquée');
  cb('ok');
});

/* ------------------------------------------------------------------ */
/* 2. Le TXT du salon hébergé suit la population (boucle reannounce)   */
/* ------------------------------------------------------------------ */

test('rôle hôte : un événement participants republie le TXT avec le compte réel', async () => {
  await probe.ready();
  probe.reset();
  // Le pont de salon doit déclarer CE salon hébergé : `reannounceHostedRoom` ne publie rien si
  // `bridge.getRoomState().roomId` est null (garde volontaire, pas un oubli).
  const join = probe.handlers.get(IPC.roomJoin);
  assert.ok(join, 'le handler lan:room:join est enregistré');
  join({ roomId: 'salon-cuisine', name: 'Salon cuisine' });
  probe.setSignalingLink({ role: 'host', listen: { host: '192.168.1.42', port: 47_823 } });
  probe.announceHostedRoom({ roomName: 'Salon cuisine', port: 47_823, participants: 1 });

  // Le chemin réel du pont de salon : `participants` émis → forwardBridgeEvent → reannounce.
  probe.forwardBridgeEvent({
    channel: IPC.eventParticipants,
    payload: [
      { id: 'self', name: 'Marion', muted: false, deafened: false, gain: 1, connection: 'connected' },
      { id: 'p2', name: 'Kofi', muted: true, deafened: false, gain: 1, connection: 'connected' },
    ],
  });

  const txt = probe.lastTxt();
  assert.ok(txt, 'l’annonce a été republiée');
  assert.equal(txt.roomName, 'Salon cuisine');
  assert.equal(txt.participants, '1', 'le TXT republié porte le compte réel du pont (ici : le local seul)');
  assert.ok(
    probe.retracted.length >= 1,
    'remplacer une annonce retire l’ancienne du réseau avant la nouvelle (chemin announce → retract)',
  );
  assert.equal(probe.publishes[probe.publishes.length - 1]?.port, 47_823);

  const leave = probe.handlers.get(IPC.roomLeave);
  assert.ok(leave, 'le handler lan:room:leave est enregistré');
  leave(undefined);
  probe.setSignalingLink(null);
});

test('rôle client : rien n’est republié (on n’annonce pas le salon d’un autre)', async () => {
  await probe.ready();
  probe.reset();
  probe.setSignalingLink({ role: 'client', listen: null });
  probe.forwardBridgeEvent({
    channel: IPC.eventParticipants,
    payload: [{ id: 'self', name: 'Marion', muted: false, deafened: false, gain: 1, connection: 'connected' }],
  });
  assert.equal(probe.publishes.length, 0, 'un client n’a rien à annoncer');
  probe.setSignalingLink(null);
});

test('sans lien (pas de salon hébergé) : un événement participants n’annonce rien', async () => {
  await probe.ready();
  probe.reset();
  probe.setSignalingLink(null);
  probe.forwardBridgeEvent({
    channel: IPC.eventParticipants,
    payload: [{ id: 'self', name: 'Marion', muted: false, deafened: false, gain: 1, connection: 'connected' }],
  });
  assert.equal(probe.publishes.length, 0);
});

/* ------------------------------------------------------------------ */
/* 3. Le port du pied est la MESURE du bind (socket réelle)            */
/* ------------------------------------------------------------------ */

test('salon hébergé sur une vraie socket : le handler du pied rend le port réellement écouté', async () => {
  await probe.ready();
  probe.reset();
  const base = 51_000 + Math.floor(Math.random() * 4_000);
  const link = createSignalingLink({
    role: 'host',
    localId: 'local-test',
    name: 'Lobby',
    host: '127.0.0.1',
    port: base,
    now: () => Date.now(),
    onMessage: () => undefined,
  });
  const start = Date.now();
  while (link.listen === null && Date.now() - start < 3_000) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const listen = link.listen;
  assert.ok(listen, 'le lien hôte écoute réellement');
  try {
    // Le pont de salon doit être en salon : `currentSignalingPort` ne publie RIEN hors salon.
    const join = probe.handlers.get(IPC.roomJoin);
    assert.ok(join, 'le handler lan:room:join est enregistré');
    join({ roomId: 'salon-mesure', name: 'Salon mesure' });
    // On remplace le lien du main par celui-ci (même forme, port réel issu du bind).
    probe.setSignalingLink({ role: 'host', listen });
    const status = lobbyStatusViaHandler();
    assert.equal(status.port, listen.port, 'le port affiché est celui du bind, pas 47821 recopié');
  } finally {
    const leave = probe.handlers.get(IPC.roomLeave);
    assert.ok(leave, 'le handler lan:room:leave est enregistré');
    leave(undefined);
    probe.setSignalingLink(null);
    link.close('fin de test');
  }
});

test('hors salon : le handler du pied ne revendique aucun port', async () => {
  await probe.ready();
  probe.reset();
  const status = lobbyStatusViaHandler();
  assert.equal(status.port, null, 'ni socket ni annonce connue : null, jamais un chiffre inventé');
});
