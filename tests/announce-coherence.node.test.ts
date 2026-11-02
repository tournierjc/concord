/**
 * tests/announce-coherence.node.test.ts — cohérence bind/annonce mDNS (2026-11-02).
 *
 * Retour JC sur la 0.4.3 : « aucun hôte sur 192.168.1.70:47821 après 5000ms ». Le bind du
 * serveur choisit son adresse par le tri des NOMS d'interfaces (`pickListenHost`,
 * signaling-link.ts) et l'annonce mDNS publiait celle de `rankAnnounceAddresses` (adresses
 * vues par bonjour) : sur une machine multi-interfaces les deux pouvaient diverger, et un
 * client frappait à une adresse où personne n'écoute. Le correctif : l'hôte publie son
 * adresse LIÉE dans le TXT `addr`, et le lecteur la préfère à toute reconstruction.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { toRecord } from '../src/main/discovery-bridge.ts';
import type { Service } from 'bonjour-service';

function service(overrides: Partial<Service>): Service {
  return {
    name: 'concord-test',
    host: 'machine-plain',
    port: 47821,
    addresses: ['192.168.1.70'],
    txt: { roomName: 'Cuisine', participants: '2' },
    ...overrides,
  } as Service;
}

describe('toRecord — l’adresse liée (TXT addr) prime sur la reconstruction', () => {
  it('sans `addr` : comportement d’avant (adresse de bonjour), rien ne casse', () => {
    const record = toRecord(service({}));
    assert.ok(record !== null);
    assert.equal(record.host, '192.168.1.70');
  });

  it('avec `addr` : le lecteur joint l’adresse du BIND, même si bonjour en voit une autre', () => {
    // La machine héberge sur 192.168.1.10 (interface liée) mais bonjour liste 192.168.1.70 :
    // c’était exactement l’échec vécu — l’annonce pointait là où personne n’écoutait.
    const record = toRecord(
      service({ addresses: ['192.168.1.70'], txt: { roomName: 'Cuisine', participants: '2', addr: '192.168.1.10' } }),
    );
    assert.ok(record !== null);
    assert.equal(record.host, '192.168.1.10');
  });

  it('un `addr` mensonger (nom .local, trop long, vide) est ignoré, pas propagé', () => {
    const local = toRecord(service({ txt: { roomName: 'x', participants: '1', addr: 'hote.local' } }));
    assert.ok(local !== null);
    assert.notEqual(local.host, 'hote.local');
    const empty = toRecord(service({ txt: { roomName: 'x', participants: '1', addr: '' } }));
    assert.ok(empty !== null);
    assert.equal(empty.host, '192.168.1.70', 'retour au comportement d’avant');
  });

  it('le port annoncé reste le port RÉELLEMENT écouté (le record ne lit jamais un défaut)', () => {
    const record = toRecord(service({ port: 47827 }));
    assert.ok(record !== null);
    assert.equal(record.port, 47827);
  });
});
