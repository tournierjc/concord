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

/* ------------------------------------------------------- 3. vue du LobbyFooter ---- */

const OK: LobbyStatusDto = { port: 47823, method: 'mdns', health: 'ok' };

test('nominal : le port mesuré et la méthode mDNS s’affichent en champs séparés', () => {
  const view = lobbyFooterView(OK);
  assert.equal(view.offline, false);
  if (view.offline) return;
  assert.equal(view.portKey, 'discovery.footer.port');
  assert.equal(view.port, 47823);
  assert.equal(view.methodKey, 'discovery.method.mdns');
});

test('hors salon : aucun port n’est revendiqué, la clé « aucun salon » prend le relais', () => {
  const view = lobbyFooterView({ ...OK, port: null });
  assert.equal(view.offline, false);
  if (view.offline) return;
  assert.equal(view.portKey, 'discovery.footer.port.none');
  assert.equal(view.port, null, 'null reste null : l’UI ne remplace jamais par 47821');
});

test('hors-ligne (S1.10) : port et méthode disparaissent, la clé dédiée les remplace', () => {
  const view = lobbyFooterView({ port: 47823, method: 'mdns', health: 'offline' });
  assert.deepEqual(view, { offline: true, offlineKey: 'discovery.footer.offline' });
});

test('mDNS en échec : le pied dit la méthode « aucune », pas le port des réglages', () => {
  const view = lobbyFooterView({ port: null, method: 'none', health: 'mdns-down' });
  assert.equal(view.offline, false);
  if (view.offline) return;
  assert.equal(view.methodKey, 'discovery.method.none');
});
