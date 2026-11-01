/**
 * roster-link.ts — de la présence de signalisation à l'annuaire du salon.
 *
 * POURQUOI CE MODULE EXISTE. Le main recevait déjà tout ce qu'il faut pour peupler la liste des
 * participants : le tuyau de signalisation émet `peer-joined {peerId, name}` et `peer-left {peerId}`
 * (`signaling-link.ts:215-218`, `:355`), et l'interface affiche `ParticipantDto[]` venue du main
 * (`App.tsx` → `api.onParticipants`). Entre les deux, il n'y avait **rien** :
 * `RoomBridge.addParticipant` n'avait aucun appelant, aucune méthode ne retirait un participant, et
 * le compteur restait figé à 1/8 — d'où une liste toujours vide au-delà de soi-même, une garde
 * « salon plein » inatteignable, et un overlay sans personne à afficher.
 *
 * Module pur (aucun `electron`, aucun `node:net`) : la règle est falsifiable par `node --test`, et
 * c'est la raison d'être de la séparation — `index.ts` n'est pas importable en test.
 */

import type { ParticipantDto, SignalIn } from '../shell/ipc-contract';

/** Ce que ce module a besoin de l'annuaire : ajouter, retirer. Rendu : « la liste a changé ». */
export interface RosterPort {
  addParticipant(participant: Omit<ParticipantDto, 'gain'> & { gain?: number }): boolean;
  removeParticipant(peerId: string): boolean;
}

/**
 * Applique un message de signalisation entrant à l'annuaire du salon.
 *
 * Rend `true` si l'annuaire a changé (l'appelant peut alors rafraîchir ce qu'il publie sur le LAN).
 *
 * Ce qui est volontairement ABSENT :
 *   — `muted` / `deafened` d'un pair : `ParticipantDto` les porte, mais le fil de signalisation ne
 *     les transporte pas (`participant-state.ts` Règle 2 les rend `unknown` à l'affichage). On écrit
 *     `false`, c'est-à-dire « rien de connu », et surtout on n'invente pas un état de mute ;
 *   — `connection` au-delà de la présence : un pair qui apparaît est dans le salon (`connected`).
 *     L'état ICE d'un pair n'est pas connu du main (il vit dans le plan média du renderer), et il
 *     n'existe aucun canal IPC pour le remonter ici — voir la limite nommée de la VERIF.
 *
 * `selfSignalingId` est l'identifiant que le serveur de signalisation a attribué à NOTRE connexion.
 * L'hôte se connecte à son propre salon comme n'importe qui : sans ce filtre, il s'ajouterait
 * lui-même en double à côté de sa ligne locale (`SELF_ID`).
 */
export function applySignalToRoster(
  roster: RosterPort,
  message: SignalIn,
  selfSignalingId: string | null,
): boolean {
  if (message.kind === 'peer-joined') {
    if (selfSignalingId !== null && message.peerId === selfSignalingId) return false;
    const name = typeof message.name === 'string' ? message.name.trim() : '';
    const avatarRef = typeof message.avatarRef === 'string' && message.avatarRef.length > 0 ? message.avatarRef : undefined;
    return roster.addParticipant({
      id: message.peerId,
      // Un pair sans nom occupe une ligne : mieux vaut son identifiant qu'une ligne vide.
      name: name.length > 0 ? name : message.peerId,
      // Empreinte d'avatar relayée telle quelle (déjà validée par le contrat) ; son absence est
      // normale (ancienne version du pair) et l'affichage retombe sur les initiales.
      ...(avatarRef !== undefined ? { avatarRef } : {}),
      muted: false,
      deafened: false,
      gain: 1,
      connection: 'connected',
    });
  }
  if (message.kind === 'peer-left') {
    return roster.removeParticipant(message.peerId);
  }
  return false;
}
