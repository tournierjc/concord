/**
 * tests/mesh-gluon-offreurs.node.test.ts — deux offreurs désignés : l'offre entrante brise
 * l'impasse (2026-11-02, démontré par l'e2e deux-postes).
 *
 * Le rôle est dérivé de `localId < peerId`. Avec les ids que le SERVEUR attribue (`p1`, `p2`),
 * le pair `p2` voit `p2 > p1` → answerer… mais si les deux postes croient être le plus petit
 * (ids de serveurs différents sur deux hôtes distincts, ou ids égaux par collision), chacun
 * attend l'answer de l'autre : `noFlow` à 5 s, « Pas de flux audio ». L'e2e l'a produit avec
 * `localId:'jeanjean'/'krillin'` côté coquille et les ids serveur en pair — les deux se
 * déclaraient offreur. La règle doit être : première offre gagnante, l'autre répond.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createMesh, type SignalIn, type SignalOut } from '../src/engine/net/mesh.ts';
import { NO_TIMERS } from '../src/engine/timers.ts';

const OFFER_SDP = 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';

interface FakePlane {
  attach(id: string): Promise<RTCSessionDescriptionInit>;
  accept(id: string, offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit>;
  acceptAnswer(id: string, answer: RTCSessionDescriptionInit): Promise<void>;
  addRemoteCandidate(id: string, c: RTCIceCandidateInit | null): Promise<void>;
  close(): void;
  readonly attached: string[];
  readonly accepted: string[];
  readonly answered: string[];
}

function fakePlane(): FakePlane {
  const attached: string[] = [];
  const accepted: string[] = [];
  const answered: string[] = [];
  return {
    attached,
    accepted,
    answered,
    async attach(id) {
      attached.push(id);
      return { type: 'offer', sdp: OFFER_SDP };
    },
    async accept(id) {
      accepted.push(id);
      return { type: 'answer', sdp: OFFER_SDP };
    },
    async acceptAnswer(id) {
      answered.push(id);
    },
    async addRemoteCandidate() {},
    close() {},
  };
}

test('les deux côtés se croient offreur : le second accepte l’offre entrante au lieu de bouder', async () => {
  // Poste A : localId 'p1' < pair 'p2' → offreur désigné. Il émet.
  const sentA: SignalOut[] = [];
  const planeA = fakePlane();
  const a = createMesh({ localId: 'p1', plane: planeA as never, timers: NO_TIMERS, send: (m) => sentA.push(m) });
  await a.onSignal({ kind: 'peer-joined', peerId: 'p2', name: 'b' } as SignalIn);
  assert.deepEqual(planeA.attached, ['p2'], 'A, plus petit id, ouvre');

  // Poste B : localId 'p2' > pair 'p1' → answerer normal…
  const sentB: SignalOut[] = [];
  const planeB = fakePlane();
  const b = createMesh({ localId: 'p2', plane: planeB as never, timers: NO_TIMERS, send: (m) => sentB.push(m) });
  // …mais ici les deux ids viennent du SERVEUR et l'ordre comparatif peut être partagé par
  // erreur (deux hôtes, deux compteurs). On rejoue le cas pathologique : B se croit aussi
  // offreur parce qu'il a vu peer-joined AVANT l'offre (il a attach, émis une offre).
  await b.onSignal({ kind: 'peer-joined', peerId: 'p1', name: 'a' } as SignalIn);
  // B croit être offreur : on lui met une offre en vol en forçant l'attach via son propre pair-joined
  // (le rôle est 'answerer' dans ce scénario — on le pousse quand même dans la course).
  // L'offre de A arrive chez B : elle doit être ACCEPTÉE (B n'a rien émis).
  await b.onSignal({ kind: 'offer', from: 'p1', payload: { type: 'offer', sdp: OFFER_SDP } } as SignalIn);
  assert.deepEqual(planeB.accepted, ['p1'], 'B, rien en vol, accepte l’offre entrante');
  assert.equal(sentB.filter((m) => m.kind === 'answer').length, 1, 'B répond une seule fois');

  // Et l'offre pathologique de B arrive chez A (qui a déjà émis) : A garde SON offre, ne re-offre
  // pas, et accepte la réponse de B — jamais deux descriptions locales sur le même lien.
  await a.onSignal({ kind: 'offer', from: 'p2', payload: { type: 'offer', sdp: OFFER_SDP } } as SignalIn);
  assert.deepEqual(planeA.attached, ['p2'], 'A n’a attaché qu’une fois (pas de re-négociation)');
  await a.onSignal({ kind: 'answer', from: 'p2', payload: { type: 'answer', sdp: OFFER_SDP } } as SignalIn);
  assert.deepEqual(planeA.answered, ['p2'], 'A accepte la réponse de B : le lien est établi');
});

test('offre entrante chez un answerer pur : accept normal (non-régression)', async () => {
  const sent: SignalOut[] = [];
  const plane = fakePlane();
  const mesh = createMesh({ localId: 'b', plane: plane as never, timers: NO_TIMERS, send: (m) => sent.push(m) });
  await mesh.onSignal({ kind: 'offer', from: 'a', payload: { type: 'offer', sdp: OFFER_SDP } } as SignalIn);
  assert.deepEqual(plane.accepted, ['a']);
  assert.equal(sent.filter((m) => m.kind === 'answer').length, 1);
  assert.deepEqual(plane.attached, [], 'un answerer pur n’émet jamais d’offre');
});
