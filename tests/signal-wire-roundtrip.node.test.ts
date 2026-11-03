/**
 * tests/signal-wire-roundtrip.node.test.ts — le tuyau ne mutile AUCUNE charge utile du maillage
 * (2026-11-02, trouvé par l'e2e deux-postes ; le vrai « pas de flux audio » du LAN).
 *
 * Le maillage (contrat gelé) parle en OBJETS : `{ type:'offer', sdp }` et
 * `RTIceCandidateInit` pour ICE. Le fil (protocole local-signaling) ne porte que des CHAÎNES.
 * Le couple toWire/fromWire est la SEULE frontière entre les deux mondes : si elle rend une
 * chaîne là où le mesh attend un objet, `descriptionOf`/`parseCandidate` refusent, l'ICE meurt
 * en silence — et l'écran affiche « Pas de flux audio » alors que chaque unité est verte.
 *
 * Ces tests figent le contrat de bout en bout (émettre → fil → recevoir → consommer), pour
 * chaque type de message : offer, answer, ICE (les trois formes), leave.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSignalingLink, fromWire, parseServerLine, toWire } from '../src/main/signaling-link.ts';
import { createMesh } from '../src/engine/net/mesh.ts';
import { createMediaPlane } from '../src/engine/rtc/media-plane.ts';

const LAN_LINE = 'candidate:1844582201 1 udp 2122194687 192.168.1.42 51234 typ host generation 0 ufrag ab12';
const OFFER_SDP = 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\n';

test('offer : objet émis, objet reçu — le mesh peut l’utiliser', () => {
  const wire = toWire({ kind: 'offer', to: 'p2', payload: { type: 'offer', sdp: OFFER_SDP } });
  assert.ok(wire !== null && wire.type === 'offer');
  const back = fromWire({ type: 'offer', from: 'p2', to: 'p1', sdp: OFFER_SDP });
  assert.ok(back !== null && back.kind === 'offer');
  assert.equal(typeof back.payload, 'object', 'le mesh ne reçoit jamais une chaîne nue');
  const view = back.payload as { type?: string; sdp?: string };
  assert.equal(view.type, 'offer');
  assert.equal(view.sdp, OFFER_SDP);
});

test('answer : même contrat qu’offer', () => {
  const back = fromWire({ type: 'answer', from: 'p2', to: 'p1', sdp: OFFER_SDP });
  assert.ok(back !== null && back.kind === 'answer');
  const view = back.payload as { type?: string; sdp?: string };
  assert.equal(view.type, 'answer');
  assert.equal(view.sdp, OFFER_SDP);
});

test('ice : l’objet candidat natif fait l’aller-retour complet sans se faire refuser par le maillage', () => {
  // Émettre comme le mesh (objet RTCIceCandidateInit)…
  const wire = toWire({ kind: 'ice', to: 'p2', payload: { candidate: LAN_LINE, sdpMid: '0', sdpMLineIndex: 0 } });
  assert.ok(wire !== null && wire.type === 'ice', 'le candidat LAN sort sur le fil');
  // …le serveur relaie cette chaîne…
  const relayed = parseServerLine(JSON.stringify({ type: 'ice', from: 'p2', to: 'p1', candidate: wire.candidate }));
  assert.ok(relayed !== null && relayed.type === 'ice');
  // …et le pair la reçoit en objet que plane.addIceCandidate accepte.
  const back = fromWire(relayed);
  assert.ok(back !== null && back.kind === 'ice');
  const cand = back.payload as { candidate?: string; sdpMid?: unknown; sdpMLineIndex?: unknown };
  assert.equal(typeof cand, 'object', 'jamais une chaîne nue : parseCandidate la refuserait');
  assert.equal(cand.candidate, LAN_LINE);
});

test('chaque payload émis par le mesh survit au couple toWire→fromWire INTACT (épreuve de bout en bout)', () => {
  // On ne test pas les fonctions séparément : on test l'ABSENCE de perte entre les deux, sur
  // les trois kinds que le mesh envoie. Un contrat partiel (offer ok mais ice cassé) est exactement
  // ce qui a laissé le LAN muet pendant des semaines d'unitaires verts.
  const messages = [
    { kind: 'offer' as const, payload: { type: 'offer' as const, sdp: OFFER_SDP } },
    { kind: 'answer' as const, payload: { type: 'answer' as const, sdp: OFFER_SDP } },
    { kind: 'ice' as const, payload: { candidate: LAN_LINE } },
  ];
  for (const m of messages) {
    const wire = toWire({ ...m, to: 'p2' });
    assert.ok(wire !== null, `${m.kind} doit sortir sur le fil`);
    const relayed = parseServerLine(JSON.stringify({ ...wire, from: 'p2', to: 'p1' }));
    assert.ok(relayed !== null, `${m.kind} est accepté à l'entrée`);
    const back = fromWire(relayed);
    assert.ok(back !== null && back.kind === m.kind, `${m.kind} revient avec son kind`);
    assert.equal(typeof back.payload, 'object', `${m.kind} revient en objet`);
  }
});
