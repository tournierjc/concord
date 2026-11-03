/**
 * tests/ice-candidate-wire.node.test.ts — le candidat ICE natif du maillage survit au fil
 * (2026-11-02, trouvé par l'e2e deux-postes).
 *
 * Le mesh émet `{ kind: 'ice', payload: { candidate: 'candidate:… typ host …' } }` (un
 * RTCIceCandidateInit). Le tuyau (signaling-link) ne transporte QUE des chaînes : à l'émission
 * `toWire` emballe l'objet en JSON, et à la réception `decodeCandidatePayload` doit le RENDRE
 * sous forme d'OBJET — sinon `parseCandidate` (mesh) refuse « charge utile non objet », aucun
 * candidat n'entre, l'ICE ne se connecte jamais : c'était le vrai « pas de flux audio » du LAN,
 * distinct de l'obfuscation mDNS corrigée en 0.4.8.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  candidateText,
  decodeCandidatePayload,
  toWire,
} from '../src/main/signaling-link.ts';

const LAN_LINE = 'candidate:1844582201 1 udp 2122194687 192.168.1.42 51234 typ host generation 0 ufrag ab12';
const WAN_LINE = 'candidate:1844582201 1 udp 2122194687 8.8.8.8 51234 typ srflx generation 0 ufrag ab12';

test('un candidat LAN natif du maillage fait l’aller-retour du fil en objet exploitable', () => {
  const wire = toWire({ kind: 'ice', to: 'p2', payload: { candidate: LAN_LINE } });
  assert.ok(wire !== null && wire.type === 'ice', 'le candidat LAN sort sur le fil');
  const back = decodeCandidatePayload(wire.candidate) as { candidate?: string } | string;
  assert.equal(typeof back, 'object', 'il revient en objet, jamais en cha\u00eene nue');
  assert.equal((back as { candidate?: string }).candidate, LAN_LINE);
});

test('le filtre LAN refuse le candidat avant émission, dans les deux formes', () => {
  assert.equal(toWire({ kind: 'ice', to: 'p2', payload: { candidate: WAN_LINE } }), null);
  assert.equal(toWire({ kind: 'ice', to: 'p2', payload: WAN_LINE }), null);
});

test('candidateText lit la ligne SDP même emballée (le filtre ne voit jamais un objet sérialisé)', () => {
  assert.equal(candidateText(LAN_LINE), LAN_LINE);
  assert.equal(candidateText(JSON.stringify({ candidate: LAN_LINE })), LAN_LINE);
});

test('le marqueur de fin de ramassage (payload null) ne sort pas en candidat invalide', () => {
  // Le fil ne porte que des chaînes : `toWire` doit refuser une charge utile sans ligne,
  // jamais expédier un objet vide que le pair refuserait en cascade.
  assert.equal(toWire({ kind: 'ice', to: 'p2', payload: null }), null);
  assert.equal(toWire({ kind: 'ice', to: 'p2', payload: {} }), null);
});
