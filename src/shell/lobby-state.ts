/**
 * lobby-state.ts — l'état pur du lobby (E1) : regroupement des salons découverts, règle
 * « un nom déjà ouvert sur le réseau ⇒ l'action principale est REJOINDRE », et vue du pied
 * de page (`LobbyFooter { port, discoveryMethod, offline }`, SPEC-002 §3 / §3.1).
 *
 * POURQUOI CE MODULE EST LÀ, À PART DE `ipc-contract.ts`. Le contrat décrit les DTO qui passent
 * sur le fil ; lui décide de ce que le lobby EN FAIT : tri, regroupement, déduplication
 * hôte/port, et le choix de l'action principale quand une personne tape un nom que le réseau
 * connaît déjà. Cette décision est falsifiable par `node --test` — ce qui n'est pas le cas de
 * `App.tsx` (exécuté par Vite/Electron).
 *
 * Règle produit tranchée (31/10/2026) : JAMAIS un hôte doublon créé malgré soi. Si un salon
 * découvert porte le même nom (à la casse et aux blancs près), le premier geste est
 * `join` sur CE salon, avec le nom réellement affiché par le réseau — pas une création locale
 * qui laisserait deux salons du même nom côte à côte.
 *
 * Module PUR : aucune I/O, aucune horloge, aucun import d'Electron.
 */

import type { LobbyStatusDto, RoomSummaryDto } from './ipc-contract';
import { IPC_MAX_PARTICIPANTS } from './ipc-contract';

/** Un salon du réseau, tel que le lobby le montre. La vue vient de l'IPC, inchangée. */
export interface LobbyRoom extends RoomSummaryDto {
  /** Le salon est-il à la limite du maillage (bouton « Complet », jamais cliquable) ? */
  readonly full: boolean;
}

/** Clé de regroupement : même hôte ET même port = un seul et même salon (jamais deux lignes). */
export function roomDedupeKey(room: RoomSummaryDto): string {
  return `${room.host}:${room.port}`;
}

/** Normalisation de comparaison de noms : casse et blancs fondus (le réseau n'est pas cassant). */
export function normalizeRoomName(name: string): string {
  return name.trim().toLocaleLowerCase().replace(/\s+/gu, ' ');
}

/**
 * Regroupe les salons découverts pour l'affichage : les doublons `hôte:port` ne sont rendus
 * qu'une fois (le premier gagné — même annonce vue deux fois par la pile mDNS), les lignes sont
 * triées « ouverts d'abord » puis par nom, puis par `roomId` (ordre total déterministe, jamais
 * `localeCompare`, comme le registre), et la population réelle du salon LOCAL est substituée à
 * l'annonce quand ce poste héberge (l'annonce mDNS a jusqu'à 12 s de retard ; le pont, lui, sait).
 */
export function groupDiscoveredRooms(
  rooms: readonly RoomSummaryDto[],
  local: { roomId: string | null; participantCount: number } = { roomId: null, participantCount: 0 },
): LobbyRoom[] {
  const seen = new Set<string>();
  const grouped: LobbyRoom[] = [];
  for (const room of rooms) {
    const key = roomDedupeKey(room);
    if (seen.has(key)) continue;
    seen.add(key);
    const announced =
      local.roomId !== null && room.roomId === local.roomId ? local.participantCount : room.participantCount;
    // La population est bornée comme la garde IPC du sens distant ([0, IPC_MAX_PARTICIPANTS]) :
    // une source qui laisserait passer 12 afficherait un badge « 12/8 » et un salon jamais « plein ».
    const participantCount = Math.min(Math.max(announced, 0), IPC_MAX_PARTICIPANTS);
    grouped.push({ ...room, participantCount, full: participantCount >= IPC_MAX_PARTICIPANTS });
  }
  // Les complets passent en fin de liste (S1.3/S1.6), puis nom, puis roomId.
  grouped.sort((a, b) => {
    if (a.full !== b.full) return a.full ? 1 : -1;
    if (a.roomName !== b.roomName) return a.roomName < b.roomName ? -1 : 1;
    if (a.roomId !== b.roomId) return a.roomId < b.roomId ? -1 : 1;
    // Égalité totale sur les champs affichés : on départage par hôte puis port, pour que l'ordre
    // ne dépende jamais de l'ordre d'arrivée des paquets mDNS (deux postes peuvent publier des
    // noms d'annonce différents produisant le même triple roomName/roomId/full affiché).
    if (a.host !== b.host) return a.host < b.host ? -1 : 1;
    if (a.port !== b.port) return a.port < b.port ? -1 : 1;
    return 0;
  });
  return grouped;
}

/** Ce que l'utilisateur a visé dans le champ « créer un salon ». */
export interface CreateRoomIntent {
  /** Nom saisi, déjà coupé (`trim`). */
  readonly draft: string;
  /** Un salon est déjà ouvert sur CETTE machine : `[Créer]` est hors-jeu (S1.8, `room.create.error.exists`). */
  readonly alreadyHosting: boolean;
}

/** L'action principale du bouton de création — décidée, pas devinée par l'écran. */
export type CreateRoomAction =
  /** Rejoindre le salon découvert qui porte déjà ce nom (le cas « hôte doublon malgré soi »). */
  | { kind: 'join'; room: LobbyRoom; messageKey: 'discovery.join.matching' }
  /** Créer le salon demandé (aucun salon du réseau ne porte ce nom). */
  | { kind: 'create'; name: string }
  /** Rien à faire : saisie vide, ou un salon local est déjà ouvert. */
  | { kind: 'blocked'; messageKey: 'room.create.error.empty' | 'room.create.error.exists' };

/**
 * Décide ce que le bouton principal de la zone « créer » doit faire, AVANT tout clic.
 *
 * Un nom saisi qui correspond à un salon découvert (normalisation : casse + blancs) ne crée RIEN :
 * il rejoint CE salon, avec le nom que le réseau affiche. C'est la garantie produit : taper le
 * même nom des deux côtés ne fabrique plus jamais deux hôtes du même salon.
 */
export function resolveCreateRoomAction(
  intent: CreateRoomIntent,
  rooms: readonly LobbyRoom[],
): CreateRoomAction {
  const draft = intent.draft.trim();
  if (draft.length === 0) return { kind: 'blocked', messageKey: 'room.create.error.empty' };
  if (intent.alreadyHosting) return { kind: 'blocked', messageKey: 'room.create.error.exists' };
  const wanted = normalizeRoomName(draft);
  const match = rooms.find((room) => normalizeRoomName(room.roomName) === wanted);
  if (match !== undefined) {
    return { kind: 'join', room: match, messageKey: 'discovery.join.matching' };
  }
  return { kind: 'create', name: draft };
}

/**
 * Ce que le pied de lobby sait, en champs séparés (jamais une phrase reconstruite à la main).
 * Le mécanisme de découverte (mDNS, broadcast, port d'annonce) n'est PAS affiché : c'est un détail
 * technique, pas une information dont l'utilisateur a besoin — le pied dit CE QUI SE PASSE
 * (« recherche en cours »), jamais COMMENT (retour utilisateur 0.4.2).
 */
export type LobbyFooterView =
  /** Hors-ligne : `discovery.footer.offline` remplace port + recherche (S1.10 — pas de socket). */
  | { offline: true; offlineKey: 'discovery.footer.offline' }
  | {
      offline: false;
      /** Clé du libellé de port (`discovery.footer.port` si port lu, `.none` sinon). */
      portKey: 'discovery.footer.port' | 'discovery.footer.port.none';
      /** Le port lu, ou `null` — jamais le port des réglages. */
      port: number | null;
    };

/**
 * Vue du `LobbyFooter` (SPEC-002 : 32 px, bordure haute, `bg.surface`). La règle S1.10 est ici :
 * `health === 'offline'` efface le port et la recherche — afficher un port sans socket serait un
 * mensonge, et une « recherche » alors que rien ne tourne aussi. En service, le pied annonce une
 * recherche de salons, sans exposer la méthode ni le port d'annonce.
 */
export function lobbyFooterView(status: LobbyStatusDto): LobbyFooterView {
  if (status.health === 'offline') return { offline: true, offlineKey: 'discovery.footer.offline' };
  return {
    offline: false,
    portKey: status.port === null ? 'discovery.footer.port.none' : 'discovery.footer.port',
    port: status.port,
  };
}
