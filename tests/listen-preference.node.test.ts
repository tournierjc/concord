/**
 * tests/listen-preference.node.test.ts — l'adresse PRÉFÉRÉE du bind (2026-11-02).
 *
 * Retour JC (0.4.4, hôte AppImage Linux, client Windows) : « aucune réponse après 5000 ms ».
 * `pickListenHost` choisissait par tri ALPHABÉTIQUE des noms d'interfaces — sur une machine
 * multi-interfaces (docker0, eth0, virbr0, wlan0…), le gagnant alphabétique n'est pas toujours
 * l'interface que le LAN joint. L'adresse de la ROUTE PAR DÉFAUT (lue sans envoyer un paquet,
 * `primary-address.ts`) prime quand elle est candidate ; le tri historique reste le repli.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { pickListenHost, type InterfaceLike } from '../src/main/signaling-link.ts';

function iface(address: string, internal = false): InterfaceLike[] {
  return [{ address, family: 'IPv4', internal }];
}

describe('pickListenHost — la route par défaut prime sur le tri alphabétique', () => {
  it('sans préférence : comportement d’avant (tri par nom d’interface)', () => {
    const map = { wlan0: iface('192.168.1.70'), eth0: iface('10.0.0.5') };
    // « eth0 » < « wlan0 » : le tri alphabétique choisit 10.0.0.5, comme avant le fix.
    assert.equal(pickListenHost(map), '10.0.0.5');
  });

  it('avec la préférence du noyau : l’adresse de la route par défaut gagne', () => {
    const map = { eth0: iface('10.0.0.5'), wlan0: iface('192.168.1.70') };
    assert.equal(pickListenHost(map, '192.168.1.70'), '192.168.1.70');
  });

  it('une préférence hors candidates est ignorée (jamais une adresse inventée)', () => {
    const map = { eth0: iface('192.168.1.70') };
    assert.equal(pickListenHost(map, '10.9.9.9'), '192.168.1.70');
  });

  it('une préférence pont Docker reste filtrable si une candidate privée ordinaire existe', () => {
    const map = { docker0: iface('172.17.0.1'), eth0: iface('192.168.1.70') };
    // Le noyau ne préfère JAMAIS un pont de conteneur quand un réseau réel existe : la sonde
    // n'aurait de toute façon pas rendu 172.17.0.1 comme route par défaut. Garde de défense.
    assert.equal(pickListenHost(map, '172.17.0.1'), '172.17.0.1',
      'la préférence du noyau est la vérité — si le noyau dit le pont, c’est qu’il n’y a que lui');
  });
});
