/**
 * tests/lobby-stale-room.node.test.ts — un salon fantôme ne survit pas à sa grâce (2026-11-02, retour JC).
 *
 * Scénario vécu par JC (0.4.9) : A crée X, B le rejoint, A quitte → B reste sur X ; B quitte X et
 * le voit encore dans sa liste. Étage 1 (déjà en place) : le registre mDNS pérempe l'annonce au
 * TTL (12 s, purgé à la lecture) et `stopSignalingLink` retire l'annonce au `leave` propre. Étage 2,
 * le `createRoomMerger` du lobby, vérifié ici :
 *   1) un salon absent des scrutées SORT à l'expiration de la grâce (jamais avant, jamais après) ;
 *   2) un salon retiré par LE POSTE LUI-MÊME (il vient de le quitter/fermer) sort IMMÉDIATEMENT —
 *      le retrait local est une preuve de mort, pas une absence de scrutation : le maintenir en
 *      grâce 30 s de plus, c'est exactement le « je vois toujours X » du retour.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createRoomMerger } from '../src/shell/lobby-state.ts';
import type { RoomSummaryDto } from '../src/shell/ipc-contract.ts';

function room(roomId: string, overrides?: Partial<RoomSummaryDto>): RoomSummaryDto {
  return { roomId, roomName: roomId, host: '192.168.1.50', port: 47821, participantCount: 1, ...overrides };
}

describe('createRoomMerger — le scénario A crée / A quitte / B voit encore X', () => {
  it('X disparaît des scrutées : il reste pendant la grâce, puis SORT — et ne revient que revu', () => {
    let now = 0;
    const merger = createRoomMerger({ now: () => now, graceMs: 30_000 });
    assert.equal(merger.merge([room('X')]).length, 1);
    now += 1_000;
    assert.equal(merger.merge([]).length, 1, 'pendant la grâce, X reste (pas de mensonge sur un hôte parti)');
    now += 30_000; // dernière vue à t0 : 31 s d'absence ⇒ grâce expirée
    assert.equal(merger.merge([]).length, 0, 'grâce expirée : X est sorti — il ne peut plus rester « toujours là »');
    assert.equal(merger.merge([room('X')]).length, 1, 'réapparu (vrai hôte rouvert) : il revient sous une nouvelle vie');
  });

  it('un salon retiré par le poste lui-même sort SANS grâce (preuve locale de mort, pas une absence)', () => {
    let now = 0;
    const merger = createRoomMerger({ now: () => now, graceMs: 30_000 });
    merger.merge([room('X'), room('Y')]);
    // B vient de quitter X : le poste le sait — ce n'est pas un trou de scrutation.
    merger.removeLocal('X');
    assert.deepEqual(merger.merge([]).map((r) => r.roomId), ['Y'], 'X est sorti immédiatement ; Y, vu vivant, reste en grâce');
    // Et il ne peut pas ressurgir d'un merge suivant sans avoir été RE-VU.
    assert.deepEqual(merger.merge([room('Y')]).map((r) => r.roomId), ['Y']);
  });

  it('un removeLocal sur un salon inconnu est un no-op qui ne cache rien', () => {
    let now = 0;
    const merger = createRoomMerger({ now: () => now, graceMs: 30_000 });
    merger.merge([room('Y')]);
    merger.removeLocal('X');
    assert.deepEqual(merger.merge([room('Y')]).map((r) => r.roomId), ['Y'], 'Y vit, X n’a jamais existé : rien à retirer');
  });
});
