/**
 * src/main/primary-address.ts — l'adresse de sortie de CETTE machine (2026-11-02).
 *
 * Pourquoi : `pickListenHost` (signaling-link.ts) choisit l'adresse d'écoute par le TRI DES NOMS
 * d'interfaces — « eth0 » gagne par ordre alphabétique, pas par pertinence. Sur une machine
 * multi-interfaces (Ethernet + Wi-Fi + pont Docker + virbr0 libvirt + VPN), l'adresse choisie
 * peut être celle d'une interface que le LAN ne joint pas : le salon s'annonce, un client
 * frappe… et personne ne répond (« aucune réponse après 5000 ms », retour JC sur la 0.4.4,
 * hôte AppImage Linux, client Windows).
 *
 * L'adresse qui compte est celle que le NOYAU choisirait pour joindre un pair du LAN : c'est
 * la route par défaut. Elle se lit SANS envoyer un seul paquet — un socket UDP « connecté »
 * vers une adresse publique ne fait qu'inscrire la destination dans la table de routage du
 * socket ; le noyau en déduit l'interface de sortie et son adresse locale. Aucun octet ne
 * quitte la machine (un UDP `connect` est une résolution de route, pas un envoi).
 *
 * I/O seule ici : la DÉCISION (préférence, repli) reste dans `signaling-link.ts`, pure et
 * testée sans socket. L'horloge du délai est le port `MainTimers` (SPEC-012 : une seule porte
 * de minuteur par processus) — le module reçoit `systemTimers`, il n'appelle jamais `setTimeout`.
 */
import * as dgram from 'node:dgram';

import type { MainTimers } from './timers';

/** Délai maximum de la sonde de route : 300 ms (une résolution de route est immédiate ou morte). */
const PROBE_TIMEOUT_MS = 300;

/** Cible de la sonde : une adresse publique stable. Rien ne part — voir l'en-tête. */
const PROBE_TARGET = { address: '1.1.1.1', port: 80 };

/**
 * L'adresse locale que le noyau utiliserait pour joindre l'extérieur (route par défaut), ou
 * `null` si le noyau ne la rend pas (pas de route, socket refusé, délai dépassé). Jamais une
 * levée : une sonde qui échoue est une information (« pas de préférence »), pas une panne.
 */
export function probePrimaryAddress(timers: MainTimers): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const socket = dgram.createSocket('udp4');
    let settled = false;
    const settle = (address: string | null): void => {
      if (settled) return;
      settled = true;
      timers.cancel(timeout);
      socket.close();
      resolve(address);
    };
    const timeout = timers.once(PROBE_TIMEOUT_MS, () => settle(null));
    // Un socket UDP non connnecté ne rend pas d'adresse locale : le `connect` est le geste qui
    // fixe la route. Le rappel d'erreur couvre « pas de route » (machine hors ligne).
    socket.on('error', () => settle(null));
    socket.connect(PROBE_TARGET.port, PROBE_TARGET.address, () => {
      const local = socket.address();
      settle(typeof local.address === 'string' && local.address.length > 0 ? local.address : null);
    });
  });
}
