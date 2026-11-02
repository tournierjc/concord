/**
 * tests/lobby-merge.node.test.ts — la fusion anti-clignotement du lobby (2026-11-02).
 *
 * Retour JC sur la 0.4.3 : « pas la peine de supprimer tous les salons avant le refresh,
 * il faut supprimer ceux qui ont disparu après le refresh sinon ça clignotte ». La cause
 * réelle est la péremption du registre mDNS (TTL 12 s, purgé à chaque lecture de `list()`)
 * alors que la pile bonjour ne réémet pas les services qu'elle connaît déjà : la liste
 * publiée se vide puis se remplit, l'écran suit. Le correctif est la fusion — `merge()`
 * conserve un salon absent jusqu'à l'expiration de la grâce, jamais un remplacement sec.
 *
 * Horloge injectée (ticks déterministes, aucun sleep), module pur `src/shell/lobby-state.ts`.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createRoomMerger, LOBBY_ROOM_GRACE_MS } from '../src/shell/lobby-state.ts';
import type { RoomSummaryDto } from '../src/shell/ipc-contract.ts';

function room(roomId: string, name: string): RoomSummaryDto {
  return { roomId, roomName: name, host: '192.168.1.10', port: 47821, participantCount: 1 };
}

describe('createRoomMerger — fusion anti-clignotement', () => {
  it('une liste vide juste après des salons visibles ne vide PAS l’écran', () => {
    let now = 1_000;
    const merger = createRoomMerger({ now: () => now });
    merger.merge([room('a', 'Cuisine'), room('b', 'Salon')]);
    now += 1_000; // purge TTL publiée : la liste devient vide
    assert.equal(merger.merge([]).length, 2, 'le vide intermédiaire est neutralisé');
  });

  it('un salon absent sort après la grâce, pas avant', () => {
    let now = 1_000;
    const merger = createRoomMerger({ now: () => now, graceMs: 10_000 });
    merger.merge([room('a', 'Cuisine')]);
    now += 9_999;
    assert.equal(merger.merge([]).length, 1, 'encore dans la grâce');
    now += 2;
    assert.deepEqual(merger.merge([]), [], 'grâce expirée : le salon sort');
  });

  it('un salon qui réapparaît repart de maintenant (pas de sortie précoce)', () => {
    let now = 1_000;
    const merger = createRoomMerger({ now: () => now, graceMs: 10_000 });
    merger.merge([room('a', 'Cuisine')]);
    now += 9_000;
    assert.equal(merger.merge([]).length, 1);
    now += 9_000; // absent de ce cycle aussi, mais vu à t=10_000 : fraîcheur remise
    assert.equal(merger.merge([room('a', 'Cuisine')]).length, 1);
    now += 9_000;
    assert.equal(merger.merge([]).length, 1, 'la grâce court depuis la DERNIÈRE apparition');
    now += 1_001;
    assert.equal(merger.merge([]).length, 0);
  });

  it('deux rafales successives (up A,B puis up B,C) : [A,B] -> [B,C], aucun vide entre les deux', () => {
    let now = 1_000;
    const merger = createRoomMerger({ now: () => now, graceMs: LOBBY_ROOM_GRACE_MS });
    const first = merger.merge([room('a', 'Cuisine'), room('b', 'Salon')]);
    assert.deepEqual(first.map((r) => r.roomId).sort(), ['a', 'b']);
    now += 500;
    const second = merger.merge([room('b', 'Salon'), room('c', 'Bureau')]);
    // B et C présents, A entre en grâce (encore visible) — l'écran ne clignote pas.
    assert.equal(second.some((r) => r.roomId === 'a'), true, 'A en grâce');
    assert.equal(second.some((r) => r.roomId === 'c'), true, 'C apparaît immédiatement');
  });

  it('un refresh manuel qui annonce la liste complète met les salons frais (pas de fantôme)', () => {
    let now = 1_000;
    const merger = createRoomMerger({ now: () => now, graceMs: 10_000 });
    merger.merge([room('a', 'Cuisine')]);
    now += 5_000;
    // Le scan complet ne voit plus A : il entre en grâce MAIS A reste jusqu'à expiration.
    assert.equal(merger.merge([]).length, 1);
    now += 10_001;
    assert.equal(merger.merge([]).length, 0, 'A sort à l’expiration de la grâce, pas au refresh');
  });

  it('la grâce par défaut est celle documentée (30 s, calibrée sur le TTL mDNS 12 s)', () => {
    assert.equal(LOBBY_ROOM_GRACE_MS, 30_000);
  });

  it('l’ordre rendu est déterministe (roomId) et une entrée mise à jour porte le nouveau contenu', () => {
    let now = 1_000;
    const merger = createRoomMerger({ now: () => now, graceMs: 10_000 });
    merger.merge([room('b', 'Salon'), room('a', 'Cuisine')]);
    const listed = merger.merge([room('a', 'Cuisine'), room('b', 'Salon')]);
    assert.deepEqual(listed.map((r) => r.roomId), ['a', 'b'], 'ordre stable par roomId');
    const updated = room('a', 'Cuisine');
    const withUpdate = merger.merge([{ ...updated, participantCount: 3 }]);
    assert.equal(withUpdate.find((r) => r.roomId === 'a')?.participantCount, 3, 'le contenu suit la liste fraîche');
  });
});
