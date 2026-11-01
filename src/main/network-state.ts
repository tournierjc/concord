/**
 * network-state.ts — y a-t-il UNE interface réseau sur laquelle compter ?
 *
 * POURQUOI CE MODULE EXISTE. La découverte mDNS échoue silencieusement hors ligne : `start()`
 * attrapait l'exception du browse et se bornait à un `console.warn` — invisible pour une personne
 * non technicienne, qui voyait une liste vide sans savoir si le réseau était mort ou simply calme.
 * SPEC-002 S1.10 exige un état « Aucun réseau actif » explicite. La décision vit ici, pas dans
 * `index.ts` : `os.networkInterfaces()` arrive en paramètre, la règle est pure et donc testable.
 *
 * La règle : une interface compte si elle est NON interne, en IPv4, ni loopback, ni plage
 * lien-local auto-attribuée (169.254/16 — DHCP mort). Le loopback seul ne compte pas : un poste
 * « connecté à lui-même » n'est pas en réseau.
 *
 * Module PUR : aucune I/O, aucune horloge, aucun import d'Electron.
 */

import { isAllowedListenHost } from '../engine/net/local-signaling.ts';

/** Forme minimale d'une entrée de `os.networkInterfaces()` (injectable en test). */
export interface NetworkInterfaceLike {
  address: string;
  family: string | number;
  internal: boolean;
}

/**
 * Vrai si au moins une interface est un réseau local exploitable (cf. règle ci-dessus).
 * `undefined` (clé absente de `networkInterfaces()`) compte comme interface absente, pas comme erreur.
 */
export function hasRoutableNetwork(
  interfaces: Record<string, NetworkInterfaceLike[] | undefined>,
): boolean {
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue;
      const isV4 = entry.family === 'IPv4' || entry.family === 4;
      if (!isV4) continue;
      // Un seul juge pour « adresse locale exploitable » (boucle refusée par `isAllowedListenHost`).
      if (!isAllowedListenHost(entry.address)) continue;
      // 169.254/16 = adresse auto-attribuée quand le DHCP a échoué : physiquement « up »,
      // réseau mort. La publier comme active ferait espérer des salons qui ne viendront jamais.
      if (entry.address.startsWith('169.254.')) continue;
      return true;
    }
  }
  return false;
}
