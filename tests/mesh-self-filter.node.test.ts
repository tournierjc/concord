/**
 * tests/mesh-self-filter.node.test.ts — le maillage ne se maille jamais avec soi-même (2026-11-02, retour JC).
 *
 * Capture JC (0.4.10, salon « ok », 2/8) : la table des pairs média affiche DEUX lignes « krillin ».
 * Deux identités coexistent pour la MÊME personne : le pont (`RoomBridge`, ligne locale) et le
 * tuyau — l'hôte se connecte à son propre serveur et reçoit un id (`p<n>`) ; de l'autre côté, le
 * serveur du lien s'auto-annonce dans les `hello`/`join` avec SON propre id. Le renderer reçoit
 * donc un `peer-joined { peerId: <notre id de signalisation> }` et créerait un lien ICE… vers
 * lui-même. `openLink` refuse déjà l'id égal à `localId` ; ce test verrouille le GESTE COMPLET
 * (aucune offre, aucun lien, aucun état publié, aucun plan média ouvert) — si l'id du pair est
 * le nôtre, le message est ignoré comme une boucle, pas traité comme une arrivée.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createMesh, type Mesh, type MeshPeerState, type SignalIn, type SignalOut } from '../src/engine/net/mesh.ts';
import type { Timers } from '../src/engine/timers.ts';

function silentTimers(): Timers {
  return { once: () => null, cancel: () => undefined };
}

/** Double minimal du plan média : on compte ce que le maillage lui demande. */
function countingPlane() {
  const calls: string[] = [];
  return {
    calls,
    attach: async (peerId: string) => { calls.push(`attach:${peerId}`); },
    accept: async (peerId: string) => { calls.push(`accept:${peerId}`); },
    close: () => { calls.push('close'); },
  };
}

function meshAlone(localId: string) {
  const plane = countingPlane();
  const sent: SignalOut[] = [];
  const states: { peerId: string; state: MeshPeerState }[] = [];
  const mesh: Mesh = createMesh({
    localId,
    // Le contrat du maillage attend l'interface `MediaPlane` ; le double ne livre que les trois
    // méthodes réellement exercées par ces scénarios (aucune négociation aboutie n'est simulée).
    plane: plane as never,
    timers: silentTimers(),
    send: (message) => { sent.push(message); },
    onPeerState: (peerId, state) => { states.push({ peerId, state }); },
  });
  return { plane, sent, states, mesh };
}

describe('maillage — un pair dont l’id est le nôtre est ignoré (jamais d’auto-appel)', () => {
  const LOCAL = 'p1';

  it('peer-joined de soi : aucun lien, aucune offre, aucun état publié', async () => {
    const { plane, sent, states, mesh } = meshAlone(LOCAL);
    const self: SignalIn = { kind: 'peer-joined', peerId: LOCAL, name: 'krillin' };
    await mesh.onSignal(self);
    assert.equal(mesh.peers().length, 0, 'le maillage ne crée pas de lien avec soi-même');
    assert.equal(states.length, 0, 'aucun palier publié pour un pair qui est soi');
    assert.equal(sent.length, 0, 'aucune offre SDP ne part vers nous-mêmes');
    assert.deepEqual(plane.calls, [], 'aucune négociation engagée sur un pair-boucle');
    mesh.close();
  });

  it('offre de soi : aucune réponse, aucun accept — un pair-boucle ne se négocie pas', async () => {
    const { plane, sent, mesh } = meshAlone(LOCAL);
    const selfOffer: SignalIn = {
      kind: 'offer',
      from: LOCAL,
      payload: { type: 'offer', sdp: 'v=0\r\n' },
    };
    await mesh.onSignal(selfOffer);
    assert.equal(mesh.peers().length, 0, 'une offre de soi ne crée pas de lien');
    assert.equal(sent.length, 0, 'aucune réponse SDP envoyée à soi-même');
    assert.equal(plane.calls.filter((c) => c.startsWith('accept')).length, 0, 'aucun accept engagé');
    mesh.close();
  });

  it('un pair RÉEL (id différent du nôtre) ouvre bien son lien — le filtre ne mange pas les vrais', async () => {
    const { states, mesh } = meshAlone(LOCAL);
    await mesh.onSignal({ kind: 'peer-joined', peerId: 'p2', name: 'jeanjean' });
    assert.equal(mesh.peers().length, 1, 'le vrai pair est maillé');
    assert.ok(states.some((entry) => entry.peerId === 'p2'), 'son état est publié');
    mesh.close();
  });
});
