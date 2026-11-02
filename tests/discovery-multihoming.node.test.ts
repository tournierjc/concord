/**
 * tests/discovery-multihoming.node.test.ts — le multi-homing n’annonce plus une adresse
 * injoignable (fix 0.4.2, 2026-11-02, D3).
 *
 * Le défaut mesuré : `toRecord()` prenait `addresses[0]` BRUT — sur une machine qui fait
 * tourner Docker, la première adresse rendue par `bonjour-service` est très souvent le pont
 * `172.17.x.x` : privée au sens RFC 1918, acceptée par le registre LAN… et injoignable depuis
 * le LAN physique (le mur du conteneur). Côté écoute, `pickListenHost` triait par NOM
 * d'interface et acceptait pareillement `docker0` avant `wlan0` (`docker0` < `wlan0`).
 *
 * Règle unique, pure, des deux côtés : une adresse de pont d'orchestrateur (172.17/16,
 * 172.18/16 — les plages par défaut de Docker) ne passe DEVANT une candidate privée ordinaire
 * que si rien de meilleur n'existe. Aucune autre valeur n'est inventée : le registre reste
 * seul juge de l'acceptation LAN.
 *
 * Lancer : npx tsx --test tests/discovery-multihoming.node.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isOrchestratorAddress,
  rankAnnounceAddresses,
} from '../src/main/discovery-bridge.ts';
import { pickListenHost, type InterfaceLike } from '../src/main/signaling-link.ts';

/* -------------------------------------------- 1. le juge, pur ---- */

describe('isOrchestratorAddress — seules les plages de pont Docker', () => {
  it('172.17/172.18 sont des ponts ; le reste de RFC1918 ne lest pas', () => {
    assert.equal(isOrchestratorAddress('172.17.0.1'), true);
    assert.equal(isOrchestratorAddress('172.18.0.5'), true);
    // 172.16 et 172.19+ sont des plages privées ORDINAIRES (VPN, réseaux d’entreprise) :
    // les écarter serait inventer une règle que le LAN ne subit pas.
    assert.equal(isOrchestratorAddress('172.16.0.1'), false);
    assert.equal(isOrchestratorAddress('172.19.0.1'), false);
    assert.equal(isOrchestratorAddress('172.31.255.254'), false);
    assert.equal(isOrchestratorAddress('192.168.1.10'), false);
    assert.equal(isOrchestratorAddress('10.0.0.5'), false);
  });
});

describe('rankAnnounceAddresses — le classement des adresses annoncées', () => {
  it('pont Docker en tête : la candidate privée ordinaire passe avant', () => {
    assert.deepEqual(
      rankAnnounceAddresses(['172.17.0.1', '192.168.1.42']),
      ['192.168.1.42', '172.17.0.1'],
      'la table de l’audit : docker0 d’abord, LAN ensuite — le choix doit invertir',
    );
  });

  it('plusieurs ponts + plusieurs LAN : les LAN gardent leur ordre, les ponts suivent', () => {
    assert.deepEqual(
      rankAnnounceAddresses(['172.18.0.1', '10.1.2.3', '172.17.0.1', '192.168.0.7']),
      ['10.1.2.3', '192.168.0.7', '172.18.0.1', '172.17.0.1'],
    );
  });

  it('machine uniquement derrière Docker : les ponts restent, rien de mieux n’existe', () => {
    assert.deepEqual(rankAnnounceAddresses(['172.17.0.1', '172.18.0.1']), ['172.17.0.1', '172.18.0.1'],
      'écarter TOUTES les adresses serait annoncer « rien » — un voisin du même pont reste joignable');
  });

  it('liste vide ou non-chaînes : rien n’est inventé', () => {
    assert.deepEqual(rankAnnounceAddresses([]), []);
    // Des valeurs douteuses peuvent arriver d'un service mDNS douteux : elles sortent écartées,
    // les adresses valides survivent.
    const mixed = ['172.17.0.1', ''] as string[];
    assert.deepEqual(rankAnnounceAddresses(mixed), ['172.17.0.1'], 'la chaîne vide nest pas une adresse');
  });
});

/* ------------------------------ 2. le choix de l’adresse d’écoute ---- */

function entry(address: string, internal = false): InterfaceLike {
  return { address, family: 'IPv4', internal };
}

describe('pickListenHost — un pont Docker ne passe plus devant le LAN', () => {
  it('docker0 < wlan0 par le nom : c’est wlan0 qui gagne (la table de l’audit)', () => {
    const interfaces: Record<string, InterfaceLike[] | undefined> = {
      docker0: [entry('172.17.0.1')],
      wlan0: [entry('192.168.1.42')],
    };
    // L’ancien tri par nom rendait 172.17.0.1 (docker0 avant wlan0) : injoignable du LAN.
    assert.equal(pickListenHost(interfaces), '192.168.1.42');
  });

  it('une seule candidate, pont Docker : elle est retenue (rien de mieux)', () => {
    assert.equal(pickListenHost({ docker0: [entry('172.17.0.1')] }), '172.17.0.1');
  });

  it('aucune candidate : loopback, comme avant', () => {
    assert.equal(pickListenHost({}), '127.0.0.1');
    assert.equal(
      pickListenHost({ lo: [entry('127.0.0.1', true)], docker0: undefined }),
      '127.0.0.1',
      'les internes et les absentes ne comptent toujours pas',
    );
  });

  it('aucune adresse large ne sort jamais (non-régression de la règle fondatrice)', () => {
    // Une adresse publique est refusée par `isAllowedListenHost` AVANT le classement :
    // le multi-homing n’ouvre aucune porte.
    assert.equal(pickListenHost({ eth0: [entry('8.8.8.8')] }), '127.0.0.1');
    assert.equal(pickListenHost({ eth0: [entry('0.0.0.0')] }), '127.0.0.1');
    // Une candidate privée ordinaire ET un pont : le pont ne gagne jamais.
    assert.equal(
      pickListenHost({ eth0: [entry('172.17.0.1'), entry('10.0.0.9')] }),
      '10.0.0.9',
    );
  });

  it('169.254 (DHCP mort) toujours écarté, même seul', () => {
    assert.equal(pickListenHost({ wlan0: [entry('169.254.12.30')] }), '127.0.0.1');
  });
});
