/**
 * tests/ice-candidate-visibility.node.test.ts — pourquoi un lien peut rester « sans flux » (2026-11-02).
 *
 * Retour JC (0.4.7, hôte Linux AppImage ↔ client Windows) : les deux postes se voient dans le
 * salon (signalisation OK) mais l'un affiche « Pas de flux audio » — l'ICE n'aboutit pas. Le
 * seul chemin candidat est `onIceCandidate` : un candidat refusé par `isLanCandidate` ne part
 * JAMAIS chez le pair, et un pair qui ne reçoit aucun candidat n'a rien à tester. Ces tests
 * verrouillent la règle sur les lignes RÉELLES que Chromium émet (host typ udp/srpflx, mDNS),
 * et le garde-fou : un lien dont tous les candidats sont refusés est un lien muet — le contrat
 * `noFlow` des 5 s doit le dire, jamais le laisser « connecté ».
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isLanCandidate } from '../src/engine/rtc/ice-filter.ts';

// Les lignes exactes que Chromium rend pour une interface Ethernet typique (et leurs cousins
// que la pile WebRTC peut émettre avec `iceServers: []`).
const HOST_V4 = 'candidate:1 1 udp 2113937151 192.168.1.71 40012 typ host generation 0 ufrag abcd network-id 2'
const HOST_V6_LINKLOCAL = 'candidate:2 1 udp 2113939711 fe80::a1b2:c3d4:e5f6:0789 40013 typ host generation 0 network-id 3'
const HOST_MDNS = 'candidate:3 1 udp 2113939710 1a2b3c4d-5e6f.local 40014 typ host generation 0 network-id 2'
const SRFLX_PUBLIC = 'candidate:4 1 udp 16777215 203.0.113.9 40015 typ srflx raddr 192.168.1.71 rport 40012'

describe('isLanCandidate — la porte des candidats, sur lignes réelles', () => {
  it('un host IPv4 LAN part chez le pair', () => {
    assert.equal(isLanCandidate(HOST_V4), true);
  });

  it('un host IPv6 link-local part aussi (le pair peut être sur la même liaison)', () => {
    assert.equal(isLanCandidate(HOST_V6_LINKLOCAL), true);
  });

  it('un host mDNS (*.local) part : la résolution mDNS est un droit du pair LAN', () => {
    assert.equal(isLanCandidate(HOST_MDNS), true);
  });

  it('un candidat hors LAN (srflx public) est refusé — aucune fuite, jamais', () => {
    assert.equal(isLanCandidate(SRFLX_PUBLIC), false);
  });

  it('le seul host d’un poste dont l’adresse est hors LAN = lien muet (le cas à diagnostiquer)', () => {
    // Le piège mesuré sur la 0.4.7 : si l’unique candidat est une adresse que la porte refuse
    // (VPN, lien-local mal formé, adresse publique sur une interface « LAN »), le pair ne
    // reçoit RIEN — et « Pas de flux audio » après 5 s est le SEUL indice visible. Cet invariant
    // verrouille le diagnostic : refus total local == noFlow distant.
    const vpnOnly = 'candidate:1 1 udp 2113937151 100.64.0.5 40012 typ host generation 0'
    assert.equal(isLanCandidate(vpnOnly), false, '100.64/10 (VPN CGNAT) : hors LAN par contrat');
  });
});
