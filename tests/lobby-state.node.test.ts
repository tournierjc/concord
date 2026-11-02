/**
 * tests/lobby-state.node.test.ts — la règle du lobby, prouvée hors écran.
 *
 * Le défaut que ce fichier ferme : taper le même nom de salon des deux côtés fabriquait DEUX
 * hôtes — l'écran de création ne consultait jamais la liste découverte. La règle produit tranchée
 * (31/10/2026) tient ici, en pur : si un salon du réseau porte déjà ce nom (à la casse et aux
 * blancs près), l'action principale est REJOINDRE, avec le nom que le réseau affiche. S'y
 * ajoutent le regroupement `hôte:port` (jamais deux lignes pour un même salon), l'état
 * Libre/Complet, et la vue du `LobbyFooter` (S1.10 : hors-ligne efface port et méthode).
 *
 * Lancer : cd /work/lan-voice && npx tsx --test tests/lobby-state.node.test.ts
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  groupDiscoveredRooms,
  lobbyFooterView,
  normalizeRoomName,
  resolveCreateRoomAction,
  roomDedupeKey,
} from '../src/shell/lobby-state.ts';
import type { LobbyStatusDto, RoomSummaryDto } from '../src/shell/ipc-contract.ts';

function room(overrides: Partial<RoomSummaryDto> = {}): RoomSummaryDto {
  return {
    roomId: '192.168.1.30:47821',
    roomName: 'Salon cuisine',
    host: '192.168.1.30',
    port: 47821,
    participantCount: 2,
    ...overrides,
  };
}

/* ------------------------------------------------- 1. regroupement des découverts ---- */

test('deux annonces du même hôte:port ne font qu’une ligne', () => {
  const grouped = groupDiscoveredRooms([
    room(),
    room({ roomName: 'Salon cuisine (dupliquée par la pile mDNS)' }),
  ]);
  assert.equal(grouped.length, 1, 'un seul salon rendu');
  assert.equal(grouped[0]?.roomName, 'Salon cuisine', 'le premier gagné garde son nom');
});

test('la clé de regroupement est hôte + port, jamais le nom', () => {
  assert.equal(roomDedupeKey(room()), '192.168.1.30:47821');
  const sameNameOtherHost = groupDiscoveredRooms([
    room(),
    room({ roomId: '192.168.1.31:47821', host: '192.168.1.31' }),
  ]);
  assert.equal(sameNameOtherHost.length, 2, 'deux hôtes, deux salons — même nom compris');
});

test('les salons complets passent en fin de liste, les libres triés par nom', () => {
  const grouped = groupDiscoveredRooms([
    room({ roomId: 'a:47821', host: '10.0.0.1', roomName: 'Zoulou', participantCount: 8 }),
    room({ roomId: 'b:47822', host: '10.0.0.2', roomName: 'Alpha', participantCount: 1 }),
    room({ roomId: 'c:47823', host: '10.0.0.3', roomName: 'Bravo', participantCount: 8 }),
  ]);
  assert.deepEqual(
    grouped.map((entry) => [entry.roomName, entry.full]),
    [
      ['Alpha', false],
      ['Bravo', true],
      ['Zoulou', true],
    ],
  );
});

test('la population réelle du salon local remplace l’annonce (jusqu’à 12 s de retard)', () => {
  const grouped = groupDiscoveredRooms([room()], {
    roomId: '192.168.1.30:47821',
    participantCount: 7,
  });
  assert.equal(grouped[0]?.participantCount, 7);
  assert.equal(grouped[0]?.full, false, '7 sur 8 reste libre');
});

/* --------------------------------------- 2. « taper le même nom » ⇒ Rejoindre ---- */

test('le nom saisi correspond à un salon découvert : l’action est JOIN, pas create', () => {
  const rooms = groupDiscoveredRooms([room()]);
  const action = resolveCreateRoomAction({ draft: 'Salon cuisine', alreadyHosting: false }, rooms);
  assert.equal(action.kind, 'join');
  if (action.kind !== 'join') return;
  assert.equal(action.room.roomId, '192.168.1.30:47821', 'on rejoint CE salon, pas un jumeau local');
  assert.equal(action.messageKey, 'discovery.join.matching');
});

test('la comparaison ignore la casse et les blancs superflus', () => {
  assert.equal(normalizeRoomName('  Salon  CUISINE  '), 'salon cuisine');
  const rooms = groupDiscoveredRooms([room()]);
  const action = resolveCreateRoomAction({ draft: '  SALON  cuisine ', alreadyHosting: false }, rooms);
  assert.equal(action.kind, 'join');
});

test('le nom rejoint est celui du RÉSEAU, pas la faute de frappe de l’utilisateur', () => {
  const rooms = groupDiscoveredRooms([room({ roomName: 'Salon de Marie' })]);
  const action = resolveCreateRoomAction({ draft: 'salon de marie', alreadyHosting: false }, rooms);
  assert.equal(action.kind, 'join');
  if (action.kind !== 'join') return;
  assert.equal(action.room.roomName, 'Salon de Marie', 'l’identité visible reste celle de l’hôte');
});

test('un nom inédit crée, un champ vide bloque avec la clé qui va bien', () => {
  const rooms = groupDiscoveredRooms([room()]);
  const created = resolveCreateRoomAction({ draft: 'Salon garage', alreadyHosting: false }, rooms);
  assert.deepEqual(created, { kind: 'create', name: 'Salon garage' });

  const empty = resolveCreateRoomAction({ draft: '   ', alreadyHosting: false }, rooms);
  assert.deepEqual(empty, { kind: 'blocked', messageKey: 'room.create.error.empty' });
});

test('un salon déjà ouvert sur cette machine bloque la création — jamais rejoindre', () => {
  const rooms = groupDiscoveredRooms([room()]);
  const blocked = resolveCreateRoomAction({ draft: 'Salon cuisine', alreadyHosting: true }, rooms);
  assert.deepEqual(blocked, { kind: 'blocked', messageKey: 'room.create.error.exists' });
});

test('la population locale est bornée comme la garde IPC : jamais de badge « 12/8 »', () => {
  // Une source aberrante (bug amont, annonce folle) ne doit pas rendre un salon « 12/8 »
  // NI le laisser « libre » : la borne [0, 8] du contrat s'applique aussi à la substitution.
  const inflated = groupDiscoveredRooms([room({ participantCount: 1 })], {
    roomId: '192.168.1.30:47821',
    participantCount: 12,
  });
  assert.equal(inflated[0]?.participantCount, 8);
  assert.equal(inflated[0]?.full, true, '12 participants annoncés = salon plein, pas libre');

  const negative = groupDiscoveredRooms([room({ participantCount: 1 })], {
    roomId: '192.168.1.30:47821',
    participantCount: -3,
  });
  assert.equal(negative[0]?.participantCount, 0, 'jamais de compte négatif affiché');
});

test('deux salons différents (hôte:port distincts) restent deux lignes', () => {
  const grouped = groupDiscoveredRooms([
    room({ roomId: '10.0.0.1:47821', host: '10.0.0.1', port: 47821 }),
    room({ roomId: '10.0.0.2:47822', host: '10.0.0.2', port: 47822 }),
  ]);
  assert.equal(grouped.length, 2);
});

test('égalité totale sur les champs affichés : l’ordre est déterministe, pas la chance du multicast', () => {
  // Même roomName, même roomId, même population, hôtes différents (noms d'annonce distincts) :
  // sans départage hôte/port, l'ordre suit l'ordre d'arrivée des paquets — visible entre deux
  // rafraîchissements. Ici, l'ordre rendu ne dépend plus de l'ordre reçu.
  const a = room({ roomId: 'x:47821', host: '10.0.0.9', port: 47821, participantCount: 3 });
  const b = room({ roomId: 'x:47821', host: '10.0.0.8', port: 47821, participantCount: 3 });
  const one = groupDiscoveredRooms([a, b]).map((r) => r.host);
  const two = groupDiscoveredRooms([b, a]).map((r) => r.host);
  assert.deepEqual(one, two, 'le même jeu rend le même ordre');
  assert.deepEqual(one, ['10.0.0.8', '10.0.0.9']);
});

test('localRoom sans correspondance : aucune substitution, l’annonce garde la main', () => {
  const grouped = groupDiscoveredRooms([room({ participantCount: 2 })], {
    roomId: '10.9.9.9:47829',
    participantCount: 5,
  });
  assert.equal(grouped[0]?.participantCount, 2, 'le compte d’un autre poste ne nous concerne pas');
});


test('même nom porté par DEUX hôtes distincts : rejoindre le premier de la liste triée, de façon déterministe', () => {
  // Deux postes publient « Salon cuisine » (hôtes distincts = deux lignes, jamais fusionnées).
  // La liste triée est ce que l’utilisateur VOIT en premier ; le bouton doit rejoindre CE salon-là,
  // pas un choix caché. C’est le contrat : la décision suit l’ordre affiché.
  const grouped = groupDiscoveredRooms([
    room({ roomId: '10.0.0.2:47822', host: '10.0.0.2', port: 47822, roomName: 'Salon cuisine' }),
    room({ roomId: '10.0.0.1:47821', host: '10.0.0.1', port: 47821, roomName: 'Salon cuisine' }),
  ]);
  const action = resolveCreateRoomAction({ draft: 'salon cuisine', alreadyHosting: false }, grouped);
  assert.equal(action.kind, 'join');
  if (action.kind !== 'join') return;
  assert.equal(action.room.roomId, grouped[0]?.roomId, 'le joint est le premier affiché');
  assert.equal(action.room.roomId, '10.0.0.1:47821', 'tri par hôte : 10.0.0.1 passe avant 10.0.0.2');
});

/* ------------------------------------------------------- 3. vue du LobbyFooter ---- */

const OK: LobbyStatusDto = { port: 47823, method: 'mdns', health: 'ok' };

test('nominal : le port mesuré s’affiche, la recherche est annoncée sans détail technique', () => {
  const view = lobbyFooterView(OK);
  assert.equal(view.offline, false);
  if (view.offline) return;
  assert.equal(view.portKey, 'discovery.footer.port');
  assert.equal(view.port, 47823);
  assert.equal('methodKey' in view, false, 'la méthode de découverte n’est plus affichée (0.4.2)');
});

test('hors salon : aucun port n’est revendiqué, la clé « aucun salon » prend le relais', () => {
  const view = lobbyFooterView({ ...OK, port: null });
  assert.equal(view.offline, false);
  if (view.offline) return;
  assert.equal(view.portKey, 'discovery.footer.port.none');
  assert.equal(view.port, null, 'null reste null : l’UI ne remplace jamais par 47821');
});

test('hors-ligne (S1.10) : port et recherche disparaissent, la clé dédiée les remplace', () => {
  const view = lobbyFooterView({ port: 47823, method: 'mdns', health: 'offline' });
  assert.deepEqual(view, { offline: true, offlineKey: 'discovery.footer.offline' });
});

test('mDNS en échec : le pied reste en « recherche », jamais le port des réglages', () => {
  const view = lobbyFooterView({ port: null, method: 'none', health: 'mdns-down' });
  assert.equal(view.offline, false);
  if (view.offline) return;
  assert.equal(view.portKey, 'discovery.footer.port.none');
  assert.equal('methodKey' in view, false, 'l’état dégradé ne réintroduit pas le jargon technique');
});
