/**
 * ipc-contract.ts — contrat IPC entre le process principal et le renderer (SPEC-001 A15 / CA19).
 *
 * Module PUR, sans dépendance `electron` : il décrit les canaux, les charges utiles et leurs
 * gardes. Le process principal et le preload l'importent ; `node --test` l'exécute directement.
 *
 * Règle unique : **un canal inconnu est rejeté**, une charge utile non conforme est rejetée avec le
 * chemin fautif. Les gardes s'appliquent dans les deux sens : main → renderer avant `send()`,
 * renderer → main avant d'appeler un handler. Un renderer compromis ne peut donc pas inventer un
 * canal ni glisser un champ supplémentaire dans une charge utile.
 *
 * Note : `Settings` est importé en TYPE seulement (`import type`), donc effacé à l'exécution. C'est
 * ce qui permet à ce module d'être chargé par Node sans résoudre `./settings-schema`.
 */

import type { Settings, SettingsPatch } from './settings-schema';

import { AVATAR_REF_LENGTH, isAvatarRef, isCustomAvatarShape, isGalleryAvatarId, normalizeIncomingAvatarRef } from './avatar.ts';
import type { AvatarSetting, CustomAvatar } from './avatar.ts';

// --- Canaux ----------------------------------------------------------------------------------

export const IPC = {
  // renderer → main (invoke/handle)
  settingsGet: 'lan:settings:get',
  settingsSet: 'lan:settings:set',
  settingsOpen: 'lan:settings:open',
  // Vue structurée du pied de lobby : { port, method, health } — mesurés, jamais saisis.
  lobbyStatusGet: 'lan:lobby:status',
  // Porte d'entrée du panneau profil (pseudo + avatar). Ouverte par le lobby via le bouton
  // d'identité ; l'implémentation complète du panneau vit sur `feature/profile-lobby`.
  profileOpen: 'lan:profile:open',
  roomJoin: 'lan:room:join',
  roomLeave: 'lan:room:leave',
  roomsDiscover: 'lan:rooms:discover',
  controlSetMute: 'lan:control:set-mute',
  controlSetDeafen: 'lan:control:set-deafen',
  controlSetPushToTalk: 'lan:control:push-to-talk',
  controlSetGain: 'lan:control:set-gain',
  overlaySet: 'lan:overlay:set',
  // AD-19 D1 / AD-20 D1 — ensemble « qui parle » publié par le renderer qui mesure (transitions
  // seules, AD-20 D3). Le main le relaie, il ne le calcule pas.
  speakingSet: 'lan:speaking-set',
  // T16 / SPEC-007 §4.1 — signalisation : un tuyau vers les pairs (contrat figé).
  signalSend: 'lan:signal:send',
  // SPEC-002 (amendement 2026-10-31) — avatar local : choisir un fichier, et servir l'image
  // qu'un pair réclame. Deux canaux dédiés : l'image ne passe JAMAIS par `signalSend` (le fil de
  // signalisation est borné à des lignes JSON ; une image PNG de 256 px est binaire).
  avatarChoose: 'lan:avatar:choose',
  avatarGetImage: 'lan:avatar:get-image',
  // Ducking (2026-11-01) : le renderer sait QUI parle (pairs mesurés, soi jamais inclus ici) ;
  // le main applique la baisse/restauration du volume des AUTRES applications. Une seule forme :
  // l'intention `{ active: boolean }` horodatée par le producteur — le main ne décide rien.
  duckingApply: 'lan:ducking:apply',
  // Mises à jour (avenant SPEC-006b, 2026-11-01) : le renderer DEMANDE et AFFICHE, le main
  // vérifie, télécharge et installe (process principal seul, `node:https`, hôtes allowlistés).
  // Deux invoke à charge utile VIDE — le renderer ne choisit ni URL, ni version, ni chemin.
  updateCheckNow: 'lan:update:check-now',
  updateInstallNow: 'lan:update:install-now',
  // main → renderer (send/on)
  eventParticipants: 'lan:event:participants',
  // (AD-17 D1) `lan:event:speaking` retiré : le renderer mesure déjà le niveau, et le main n'a
  // aucun audio (`getUserMedia`/`AnalyserNode` vivent dans le plan média). Un canal sans
  // producteur ne peut porter qu'une affirmation de silence.
  eventRoomState: 'lan:event:room-state',
  eventRoomsDiscovered: 'lan:event:rooms-discovered',
  eventControlState: 'lan:event:control-state',
  eventSettingsChanged: 'lan:event:settings-changed',
  eventOverlayGeometry: 'lan:event:overlay-geometry',
  eventShortcutConflict: 'lan:event:shortcut-conflict',
  // Porte d'entrée du panneau profil : `lan:profile:open` (invoke) demande l'ouverture, cet
  // événement le confirme au renderer principal, qui est seul juge de l'affichage du panneau.
  eventProfileOpen: 'lan:event:profile-open',
  // Découverte : état de santé ('ok' | 'mdns-down' | 'offline') — remonte l'échec mDNS / l'absence
  // réseau que `discovery-bridge.ts` ne faisait que `console.warn`.
  eventDiscoveryStatus: 'lan:event:discovery-status',
  // T16 / SPEC-007 §4.1 — messages entrants + état du lien de signalisation.
  eventSignal: 'lan:event:signal',
  // AD-19 D1 / AD-20 D1 — l'ensemble « qui parle », relayé tel quel vers la fenêtre d'overlay.
  eventSpeakingSet: 'lan:event:speaking-set',
  // Mises à jour (avenant SPEC-006b, 2026-11-01) : l'état de la machine du main, publié à chaque
  // transition (checking/available/downloading NN %/downloaded/installing/up-to-date/disabled/failed).
  eventUpdateState: 'lan:event:update-state',
} as const;

export type IpcInvokeChannel = (typeof IPC)[
  | 'settingsGet'
  | 'settingsSet'
  | 'settingsOpen'
  | 'profileOpen'
  | 'lobbyStatusGet'
  | 'roomJoin'
  | 'roomLeave'
  | 'roomsDiscover'
  | 'controlSetMute'
  | 'controlSetDeafen'
  | 'controlSetPushToTalk'
  | 'controlSetGain'
  | 'overlaySet'
  | 'speakingSet'
  | 'signalSend'
  | 'avatarChoose'
  | 'avatarGetImage'
  | 'duckingApply'
  | 'updateCheckNow'
  | 'updateInstallNow'];

export type IpcEventChannel = (typeof IPC)[
  | 'eventParticipants'
  | 'eventRoomState'
  | 'eventRoomsDiscovered'
  | 'eventControlState'
  | 'eventSettingsChanged'
  | 'eventOverlayGeometry'
  | 'eventShortcutConflict'
  | 'eventProfileOpen'
  | 'eventDiscoveryStatus'
  | 'eventSignal'
  | 'eventSpeakingSet'
  | 'eventUpdateState'];

export const INVOKE_CHANNELS: readonly IpcInvokeChannel[] = [
  IPC.settingsGet,
  IPC.settingsSet,
  IPC.settingsOpen,
  IPC.profileOpen,
  IPC.lobbyStatusGet,
  IPC.roomJoin,
  IPC.roomLeave,
  IPC.roomsDiscover,
  IPC.controlSetMute,
  IPC.controlSetDeafen,
  IPC.controlSetPushToTalk,
  IPC.controlSetGain,
  IPC.overlaySet,
  IPC.speakingSet,
  IPC.signalSend,
  IPC.avatarChoose,
  IPC.avatarGetImage,
  IPC.duckingApply,
  IPC.updateCheckNow,
  IPC.updateInstallNow,
];

export const EVENT_CHANNELS: readonly IpcEventChannel[] = [
  IPC.eventParticipants,
  IPC.eventRoomState,
  IPC.eventRoomsDiscovered,
  IPC.eventControlState,
  IPC.eventSettingsChanged,
  IPC.eventOverlayGeometry,
  IPC.eventShortcutConflict,
  IPC.eventProfileOpen,
  IPC.eventDiscoveryStatus,
  IPC.eventSignal,
  IPC.eventSpeakingSet,
  IPC.eventUpdateState,
];

// --- DTO -------------------------------------------------------------------------------------

export type RoomPhase = 'idle' | 'discovering' | 'joining' | 'connected' | 'retrying' | 'failed';
export type TalkModeDto = 'ptt' | 'vad';
export type OverlayScaleDto = 'sm' | 'md' | 'lg';

export interface ParticipantDto {
  id: string;
  name: string;
  /**
   * Empreinte d'avatar du pair (SPEC-002 amendement 2026-10-31) : un id de la galerie embarquée
   * ou les 16 hexadécimaux d'une image locale. JAMAIS l'image elle-même — un pair qui ne connaît
   * pas l'empreinte la réclame par la signalisation (`avatar_get`) et retombe sur les initiales
   * si la réponse manque. Facultatif : une version plus ancienne du pair n'en envoie pas.
   */
  avatarRef?: string;
  muted: boolean;
  deafened: boolean;
  /**
   * (AD-17 D2) Ni `speaking`, ni `level` ici. L'annuaire est tenu par le main (id, nom, muted,
   * deafened, gain, connection) ; la parole est mesurée dans le renderer, seul endroit où il y a
   * un `AnalyserNode`. Faire porter `speaking: false` à ce DTO, c'est affirmer un silence sur un
   * pair dont le main ne sait rien.
   */
  /** Gain local appliqué à ce participant (0..2), 1 = neutre. */
  gain: number;
  connection: 'connecting' | 'connected' | 'retrying' | 'failed';
}

/**
 * Salon repéré sur le LAN par mDNS (`_concord._udp.local`), avant toute connexion.
 * `host` est une adresse du réseau local uniquement — le filtrage est fait par
 * `src/engine/rtc/ice-filter.ts` (isLanCandidate) côté process principal, jamais ici.
 */
export interface RoomSummaryDto {
  /** Identifiant stable dérivé de l'annonce mDNS (hôte + port), pas un identifiant serveur. */
  roomId: string;
  roomName: string;
  host: string;
  port: number;
  participantCount: number;
}

export interface RoomStateDto {
  roomId: string | null;
  roomName: string | null;
  phase: RoomPhase;
  participantCount: number;
  /** Identifiant du participant local dans la liste. */
  selfId: string | null;
  /**
   * Port de signalisation RÉELLEMENT utilisé pour ce salon : celui que ce poste écoute quand il
   * héberge, ou celui **lu** dans l'annonce du salon quand il est client ; `null` hors salon.
   *
   * Ce n'est PAS le port demandé dans les réglages : le moteur incrémente 47821→47830 quand le port
   * est pris (SPEC-001 A5), et l'interface ne montre jamais un port qu'elle n'a pas lu (SPEC-002 D1).
   */
  signalingPort: number | null;
  /** Message destiné à l'UI quand le salon est refusé (plafond de 8, port occupé…). */
  notice: string | null;
}

/**
 * État de salon **sans** le port de signalisation.
 *
 * Le pont de salon ne connaît pas ce port : il appartient à la coquille (`signalingLink.listen`) et
 * aux annonces lues (`discovery.list()`). Ce type dit exactement ce que le pont sait produire ; la
 * coquille l'enrichit en `RoomStateDto` avant publication. Sans cette séparation, le pont devrait
 * écrire `signalingPort: null` — c'est-à-dire affirmer « aucun port » sur un salon qui en a un.
 */
export type RoomStateCore = Omit<RoomStateDto, 'signalingPort'>;

/** Ce que la découverte sait de sa propre santé (SPEC-002 S1.4 / S1.5 / S1.10). */
export type DiscoveryHealthDto = 'ok' | 'mdns-down' | 'offline';

export interface DiscoveryStatusDto {
  health: DiscoveryHealthDto;
}

/**
 * Vue de bas de page du lobby (SPEC-002 `LobbyFooter { port, discoveryMethod, offline }`), en
 * champs STRUCTURÉS — jamais en texte libre. Le port est une mesure (A5/D1) : `null` hors salon,
 * jamais le port demandé dans les réglages.
 *
 * `method` porte la méthode RÉELLEMENT en service. `'broadcast'` et `'both'` sont réservés : ils
 * n'ont aucun émetteur honnête tant que le balayage broadcast n'existe pas dans le code — un
 * bouton « mDNS + balayage » afficherait une capacité que la machine n'a pas.
 */
export interface LobbyStatusDto {
  /** Port de signalisation RÉELLEMENT lu (socket écoutée ou beacon de l'hôte) ; `null` sinon. */
  port: number | null;
  /** Méthode de découverte réellement en service. */
  method: 'mdns' | 'broadcast' | 'both' | 'none';
  /** Santé de la découverte (la méthode « aucune » et l'état hors-ligne en découlent). */
  health: DiscoveryHealthDto;
}

export interface ControlStateDto {
  muted: boolean;
  deafened: boolean;
  pushToTalk: boolean;
  mode: TalkModeDto;
  micLevel: number;
}

export interface OverlayGeometryDto {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
}

export interface ShortcutConflictDto {
  accelerator: string;
  registered: boolean;
  /** Raccourci de repli effectivement enregistré, null si aucun. */
  fallback: string | null;
  /** Message prêt à afficher (clé i18n résolue côté renderer si null). */
  reason: string | null;
}

export interface SettingsChangedDto {
  settings: Settings;
}

export interface RoomJoinPayload {
  /**
   * Identifiant du salon. Salon repéré sur le LAN : `hôte:port` (dérivé de l'annonce mDNS, voir
   * `room-discovery`). Salon créé localement : le nom saisi par la personne qui le crée.
   */
  roomId: string;
  /**
   * Nom d'affichage du SALON (en-tête de l'écran de salon, liste des salons). Ce champ ne porte
   * jamais l'identité d'un participant : le nom du participant local vient des réglages côté main
   * (SPEC-001 A6, `resolveDisplayName`).
   */
  name: string;
}

export interface GainPayload {
  participantId: string;
  gain: number;
}

/**
 * AD-19 D1 / AD-20 D1 — l'ensemble des participants dont la parole est mesurée MAINTENANT.
 *
 * Il ne porte que des **ids de signalisation** : ceux de `speaking[]`, soi compris, dans le même
 * tableau et sans drapeau `self`. Aucun niveau, aucun `speaking: false` implicite : l'absence
 * d'un id est la seule façon de dire « pas de parole mesurée », et chaque message est un
 * remplacement complet de l'ensemble précédent. La cadence (transitions seules, garde-vie ≤ 1 Hz)
 * appartient au producteur (`src/renderer/speaking-relay.ts`), pas à ce contrat.
 */
export interface SpeakingSetPayload {
  speaking: readonly string[];
}

/** Plafond d'ids dans `speaking[]` : soi + le plafond du salon (8, cf. SPEC-015 C1). */
export const SPEAKING_SET_MAX = 9;

/**
 * Signal de ducking (2026-11-01) — le renderer publie l'ensemble des PAIRS mesurés en train de
 * parler, soi JAMAIS (l'auto-exclusion est une règle de la source, vérifiée à la garde du main
 * contre `signalingLink.selfId`). Charge utile bornée comme `speakingSet`.
 */
export interface DuckingApplyPayload {
  speaking: readonly string[];
}

/** Plafond d'ids dans le signal de ducking : le plafond du salon (les pairs), soi est refusé. */
export const DUCKING_SPEAKING_MAX = 8;

export interface OverlayPatchPayload {
  visible?: boolean;
  opacity?: number;
  scale?: OverlayScaleDto;
  screenId?: string | null;
  position?: { x: number; y: number } | null;
}

// --- Mises à jour (avenant SPEC-006b, 2026-11-01) ------------------------------------------

/**
 * L'état de la machine à états du service de mise à jour (`src/main/update.ts`), tel qu'il
 * traverse l'IPC. Sérialisable champ par champ, validé dans les deux sens :
 *  - `version` : `null` ou une version `X.Y.Z` — un texte libre serait une promesse ;
 *  - `percent` : `null` ou un ENTIER 0..100 (un flottant n'a rien à afficher) ;
 *  - `reason`  : `null` ou une chaîne courte, lisible (raison d'échec, ou commande `deb-only`).
 */
export interface UpdateStateDto {
  state: UpdatePhaseDto;
  version: string | null;
  percent: number | null;
  reason: string | null;
}

export type UpdatePhaseDto =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'up-to-date'
  | 'disabled'
  | 'failed';

/** Longueur maximale d'une raison publiée (`failed`, commande `deb-only`). */
export const UPDATE_REASON_MAX = 240;

// --- Signalisation (T16 / SPEC-007 §4.1) ---------------------------------------------------

/**
 * Un message de signalisation ne transporte QUE trois choses : une offre SDP, une réponse SDP,
 * ou un candidat ICE. Aucun autre type ne passe (le maillage complet viendra en vague 2).
 */
export type SignalKind = 'offer' | 'answer' | 'ice';

/** Renderer → main : à destination d'un pair, ou départ du salon. */
export type SignalOut =
  | { kind: SignalKind; to: string; payload: unknown }
  | { kind: 'leave' };

/** Main → renderer : messages entrants, ou état du lien de transport. */
export type SignalIn =
  | { kind: 'peer-joined'; peerId: string; name: string; avatarRef?: string }
  | { kind: 'peer-left'; peerId: string }
  | { kind: SignalKind; from: string; payload: unknown }
  | {
      /**
       * Image d'avatar reçue d'un pair (SPEC-002, amendement 2026-10-31) — la réponse du main à un
       * `avatar_get` émis pour une empreinte inconnue. `data` est le PNG validé (empreinte revérifiée
       * + taille bornée) ; `null` = l'empreinte est inconnue du répondant ou son contenu est
       * corrompu, et l'affichage reste sur les initiales. Le renderer ne construit JAMAIS cet
       * événement lui-même : il ne fait que le consommer.
       */
      kind: 'avatar-data';
      from: string;
      avatarRef: string;
      data: string | null;
    }
  | {
      kind: 'link';
      state: 'connecting' | 'connected' | 'refused' | 'closed';
      /** Raison lisible (adresse refusée, salon plein, port occupé…) ; jamais un code seul. */
      detail: string | null;
    };

/** Longueur maximale d'une ligne JSON de signalisation (64 Ko) — refus au-delà. */
export const SIGNAL_MAX_LINE_BYTES = 64 * 1024;

/** Contrat exposé au renderer via contextBridge (`window.lanAPI`). */
export interface LanAPI {
  joinRoom(payload: RoomJoinPayload): Promise<RoomStateDto>;
  leaveRoom(): Promise<RoomStateDto>;
  /** Lance un scan mDNS borné (≤ 3 s) et rend les salons trouvés. */
  discoverRooms(): Promise<RoomSummaryDto[]>;
  setMute(muted: boolean): Promise<ControlStateDto>;
  setDeafen(deafened: boolean): Promise<ControlStateDto>;
  setPushToTalk(active: boolean): Promise<ControlStateDto>;
  setGain(payload: GainPayload): Promise<void>;
  openSettings(): Promise<void>;
  /** Ouvre le panneau profil (pseudo + avatar) — l'implémentation vient de `feature/profile-lobby`. */
  openProfile(): Promise<void>;
  getSettings(): Promise<Settings>;
  /**
   * Patch partiel des réglages. Le groupe `update` n'accepte QUE l'interrupteur `auto` — ses deux
   * mesures (`checkedAt`, `lastSeenVersion`) sont écrites par le service seul, jamais par l'UI.
   */
  setSettings(patch: SettingsPatch): Promise<Settings>;
  setOverlay(patch: OverlayPatchPayload): Promise<void>;
  /** Publie l'ensemble « qui parle » (ids de signalisation) vers la fenêtre d'overlay. */
  setSpeaking(speaking: readonly string[]): Promise<void>;
  /**
   * Ducking (2026-11-01) : publier l'ensemble des PAIRS mesurés en train de parler (soi JAMAIS
   * inclus ici — le main refuse d'ailleurs son propre id). Le main applique la baisse des autres
   * applications ; un ensemble vide demande la restauration. Refus silencieux hors salon.
   */
  setDucking(speaking: readonly string[]): Promise<void>;
  /** Envoie un message de signalisation à un pair (tuyau TCP porté par le process principal). */
  sendSignal(message: SignalOut): Promise<void>;
  /** Abonnement aux messages entrants et à l'état du lien ; rend la fonction de désabonnement. */
  onSignal(listener: (message: SignalIn) => void): () => void;
  onParticipants(listener: (participants: ParticipantDto[]) => void): () => void;
  onRoomState(listener: (state: RoomStateDto) => void): () => void;
  onRoomsDiscovered(listener: (rooms: RoomSummaryDto[]) => void): () => void;
  onControlState(listener: (state: ControlStateDto) => void): () => void;
  onSettingsChanged(listener: (payload: SettingsChangedDto) => void): () => void;
  onOverlayGeometry(listener: (geometry: OverlayGeometryDto) => void): () => void;
  onShortcutConflict(listener: (conflict: ShortcutConflictDto) => void): () => void;
  /** Le main confirme la demande d'ouverture du panneau profil (voir `openProfile`). */
  onProfileOpen(listener: () => void): () => void;
  /** État de santé de la découverte — pilote l'indicateur hors-ligne du lobby (S1.4/S1.5/S1.10). */
  onDiscoveryStatus(listener: (status: DiscoveryStatusDto) => void): () => void;
  /** Vue structurée du pied de lobby : port mesuré + méthode + santé (SPEC-002 LobbyFooter). */
  getLobbyStatus(): Promise<LobbyStatusDto>;
  /** Overlay : reçoit l'ensemble « qui parle » à chaque transition (et au plus 1×/s). */
  onSpeakingSet(listener: (payload: SpeakingSetPayload) => void): () => void;
  /**
   * Ouvre la boîte de dialogue de choix d'image (SPEC-002, amendement 2026-10-31). Le renderer ne
   * voit JAMAIS le chemin : le main valide (formats, taille, signature), redimensionne et rend
   * l'avatar persistable — ou le motif du refus, en clair.
   */
  chooseAvatar(): Promise<AvatarChooseResult>;
  /**
   * Le PNG d'un avatar local reçu d'un pair (empreinte déjà validée par le contrat). `null` si le
   * fichier est absent ou corrompu : l'affichage reste sur les initiales, jamais une image inventée.
   */
  getAvatarImage(avatarRef: string): Promise<string | null>;
  /**
   * Mises à jour (avenant SPEC-006b, 2026-11-01) : forcer une vérification depuis les publications
   * GitHub. Charge utile vide — le renderer ne choisit ni URL, ni version. Le résultat est rendu
   * par l'événement `onUpdateState`, pas par la réponse de cet invoke.
   */
  checkForUpdatesNow(): Promise<void>;
  /**
   * Installer l'artefact déjà téléchargé et vérifié (bouton [Installer maintenant]). Refusé en
   * salon actif, comme la chaîne automatique ; pour un `.deb`, rend la commande à exécuter.
   */
  installUpdateNow(): Promise<void>;
  /** L'état de la machine de mise à jour, publié par le main à chaque transition. */
  onUpdateState(listener: (state: UpdateStateDto) => void): () => void;
}

/** Ce que le choix d'une image rend au renderer — jamais un chemin, jamais un binaire. */
export type AvatarChooseResult =
  | { ok: true; avatar: CustomAvatar }
  | { ok: false; reason: 'cancelled' | 'wrong-format' | 'too-large' | 'unreadable' | 'not-an-image' };

/** Charge utile de `avatarGetImage` : la seule forme admise est une empreinte sous son nom exact. */
export interface AvatarImagePayload {
  avatarRef: string;
}

// --- Erreurs et gardes ------------------------------------------------------------------------

export type IpcErrorCode =
  | 'unknown-channel'
  | 'invalid-payload'
  | 'forbidden-payload';

export interface IpcError {
  code: IpcErrorCode;
  channel: string;
  /** Chemin pointé dans la charge utile (`payload.gain`). */
  path: string | null;
  message: string;
}

export type GuardResult<T> = { ok: true; value: T } | { ok: false; error: IpcError };

/** Erreur levée par `assertPayload`, côté process principal. */
export class IpcContractError extends Error {
  readonly code: IpcErrorCode;
  readonly channel: string;
  readonly path: string | null;

  constructor(error: IpcError) {
    super(`[${error.channel}] ${error.message}${error.path ? ` (${error.path})` : ''}`);
    this.name = 'IpcContractError';
    this.code = error.code;
    this.channel = error.channel;
    this.path = error.path;
  }
}

/** Miroir de MAX_ROOM_PARTICIPANTS (settings-schema) — égalité vérifiée par test. */
export const IPC_MAX_PARTICIPANTS = 8;

/** Plafond de salons rendus par un scan : borne le coût d'un rendu et d'une charge IPC. */
export const IPC_MAX_ROOMS = 16;

type Dict = Record<string, unknown>;

function isPlainObject(value: unknown): value is Dict {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

class Guard {
  readonly channel: string;
  readonly errors: string[] = [];

  constructor(channel: string) {
    this.channel = channel;
  }

  invalid(path: string, message: string): void {
    this.errors.push(`${path}: ${message}`);
  }

  /** Refuse tout champ non listé : même politique que le schéma de réglages. */
  object(value: unknown, path: string, allowed: readonly string[]): Dict | null {
    if (!isPlainObject(value)) {
      this.invalid(path, 'objet attendu');
      return null;
    }
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) this.invalid(`${path}.${key}`, 'champ inconnu');
    }
    return value;
  }

  string(source: Dict | null, key: string, path: string, min: number, max: number): string | null {
    if (!source) return null;
    const value = source[key];
    if (typeof value !== 'string') {
      this.invalid(`${path}.${key}`, 'chaîne attendue');
      return null;
    }
    if (value.length < min || value.length > max) {
      this.invalid(`${path}.${key}`, `longueur hors bornes [${min}, ${max}]`);
      return null;
    }
    return value;
  }

  nullableString(source: Dict | null, key: string, path: string, max: number): string | null | undefined {
    if (!source) return undefined;
    const value = source[key];
    if (value === null) return null;
    if (typeof value !== 'string') {
      this.invalid(`${path}.${key}`, 'chaîne ou null attendu');
      return undefined;
    }
    if (value.length > max) {
      this.invalid(`${path}.${key}`, `longueur > ${max}`);
      return undefined;
    }
    return value;
  }

  /**
   * Un PORT (ou `null`) : entier dans les bornes, sinon refusé. Un port est un entier — `47821.5`
   * n'existe pas, et laisser passer un flottant ne ferait que déplacer le mensonge plus loin.
   */
  nullablePort(
    source: Dict | null,
    key: string,
    path: string,
    min: number,
    max: number,
  ): number | null | undefined {
    if (!source) return undefined;
    const value = source[key];
    if (value === null) return null;
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      this.invalid(`${path}.${key}`, 'port entier ou null attendu');
      return undefined;
    }
    if (value < min || value > max) {
      this.invalid(`${path}.${key}`, `valeur hors bornes [${min}, ${max}]`);
      return undefined;
    }
    return value;
  }

  boolean(source: Dict | null, key: string, path: string): boolean | null {
    if (!source) return null;
    const value = source[key];
    if (typeof value !== 'boolean') {
      this.invalid(`${path}.${key}`, 'booléen attendu');
      return null;
    }
    return value;
  }

  number(source: Dict | null, key: string, path: string, min: number, max: number): number | null {
    if (!source) return null;
    const value = source[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.invalid(`${path}.${key}`, 'nombre fini attendu');
      return null;
    }
    if (value < min || value > max) {
      this.invalid(`${path}.${key}`, `valeur hors bornes [${min}, ${max}]`);
      return null;
    }
    return value;
  }

  /**
   * Liste d'ids : chaînes non vides, `max` entrées au plus, sans doublon. Un doublon est refusé
   * plutôt que fondu : c'est la signature d'un producteur qui empile au lieu de remplacer (AD-20).
   */
  idList(source: Dict | null, key: string, path: string, max: number, idMax: number): string[] | null {
    if (!source) return null;
    const value = source[key];
    if (!Array.isArray(value)) {
      this.invalid(`${path}.${key}`, 'tableau attendu');
      return null;
    }
    if (value.length > max) {
      this.invalid(`${path}.${key}`, `plus de ${max} entrées`);
      return null;
    }
    const seen = new Set<string>();
    for (const [index, entry] of value.entries()) {
      if (typeof entry !== 'string') {
        this.invalid(`${path}.${key}[${index}]`, 'chaîne attendue');
        return null;
      }
      if (entry.length === 0 || entry.length > idMax) {
        this.invalid(`${path}.${key}[${index}]`, `longueur hors bornes [1, ${idMax}]`);
        return null;
      }
      if (seen.has(entry)) {
        this.invalid(`${path}.${key}[${index}]`, 'doublon');
        return null;
      }
      seen.add(entry);
    }
    return [...seen];
  }

  oneOf<T extends string>(
    source: Dict | null,
    key: string,
    path: string,
    allowed: readonly T[],
  ): T | null {
    if (!source) return null;
    const value = source[key];
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
      this.invalid(`${path}.${key}`, `valeur attendue parmi ${allowed.join(' | ')}`);
      return null;
    }
    return value as T;
  }
}

function guardError(channel: string, guard: Guard, path = 'payload'): GuardResult<never> {
  return {
    ok: false,
    error: {
      code: 'invalid-payload',
      channel,
      path: guard.errors.length > 0 ? path : null,
      message: guard.errors.join('; ') || 'charge utile invalide',
    },
  };
}

const EMPTY_PAYLOAD_KEYS: readonly string[] = [];
const JOIN_KEYS = ['roomId', 'name'] as const;
const MUTE_KEYS = ['muted'] as const;
const DEAFEN_KEYS = ['deafened'] as const;
const PTT_KEYS = ['active'] as const;
const GAIN_KEYS = ['participantId', 'gain'] as const;
const OVERLAY_KEYS = ['visible', 'opacity', 'scale', 'screenId', 'position'] as const;
// `readonly string[]` plutôt qu'un tuple littéral : la clé inspectée vient d'un `Object.keys`
// (donc `string`) et `includes` sur un tuple exige l'union littérale, ce qui forcerait un cast.
const POSITION_KEYS: readonly string[] = ['x', 'y'];

/** Extrait et valide la position {x, y} de l'overlay. */
function readPosition(guard: Guard, source: Dict | null, key: string): { x: number; y: number } | null | undefined {
  if (!source) return undefined;
  const value = source[key];
  if (value === null) return null;
  if (!isPlainObject(value)) {
    guard.invalid(`payload.${key}`, 'objet {x, y} ou null attendu');
    return undefined;
  }
  for (const extra of Object.keys(value)) {
    if (!POSITION_KEYS.includes(extra)) guard.invalid(`payload.${key}.${extra}`, 'champ inconnu');
  }
  const x = guard.number(value, 'x', `payload.${key}`, -100000, 100000);
  const y = guard.number(value, 'y', `payload.${key}`, -100000, 100000);
  return x === null || y === null ? undefined : { x, y };
}

function guardRoomSummary(guard: Guard, value: unknown, index: number): RoomSummaryDto | null {
  const path = `payload[${index}]`;
  if (!isPlainObject(value)) {
    guard.invalid(path, 'objet salon attendu');
    return null;
  }
  const allowed = ['roomId', 'roomName', 'host', 'port', 'participantCount'] as const;
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key as (typeof allowed)[number])) guard.invalid(`${path}.${key}`, 'champ inconnu');
  }
  const roomId = guard.string(value, 'roomId', path, 1, 64);
  const roomName = guard.string(value, 'roomName', path, 1, 64);
  const host = guard.string(value, 'host', path, 1, 64);
  if (host !== null && /[:/]/.test(host)) {
    guard.invalid(`${path}.host`, 'adresse locale attendue (sans schéma ni port)');
  }
  const port = guard.number(value, 'port', path, 1, 65535);
  const participantCount = guard.number(value, 'participantCount', path, 0, IPC_MAX_PARTICIPANTS);
  if (
    roomId === null || roomName === null || host === null ||
    port === null || participantCount === null
  ) {
    return null;
  }
  return { roomId, roomName, host, port, participantCount };
}

function guardInvoke(channel: string, raw: unknown): GuardResult<unknown> {
  const guard = new Guard(channel);
  switch (channel) {
    case IPC.settingsGet:
    case IPC.settingsOpen:
    case IPC.profileOpen:
    case IPC.lobbyStatusGet:
    case IPC.roomLeave:
    // Mises à jour (2026-11-01) : le renderer ne choisit NI l'URL, NI la version, NI le chemin —
    // le main seul décide. Une charge utile serait un essai de piloter le téléchargement depuis la page.
    case IPC.updateCheckNow:
    case IPC.updateInstallNow:
    case IPC.roomsDiscover: {
      if (raw !== undefined && raw !== null) {
        const payload = guard.object(raw, 'payload', EMPTY_PAYLOAD_KEYS);
        if (payload === null) return guardError(channel, guard);
      }
      return guard.errors.length === 0
        ? { ok: true, value: {} }
        : guardError(channel, guard);
    }
    case IPC.settingsSet: {
      const payload = guard.object(raw, 'payload', ['locale', 'theme', 'nickname', 'avatar', 'audio', 'talk', 'overlay', 'network']);
      if (payload === null) return guardError(channel, guard);
      // `avatar` (SPEC-002 amendement 2026-10-31) : le patch peut apporter null, un id de galerie,
      // ou un avatar local valide. `guard.object` ne connaît que les types de base — cette forme
      //-là se vérifie ici, avec LA règle du schéma (mêmes fonctions partagées, aucune dérive).
      if ('avatar' in payload) {
        const avatar = (payload as Record<string, unknown>)['avatar'];
        if (avatar !== null && typeof avatar === 'string' && !isGalleryAvatarId(avatar)) {
          guard.invalid('payload.avatar', 'id d’avatar hors galerie embarquée');
        } else if (avatar !== null && typeof avatar !== 'string') {
          if (!isCustomAvatarShape(avatar) || !isAvatarRef(avatar.ref) || avatar.file !== `${avatar.ref}.png`) {
            guard.invalid('payload.avatar', 'avatar local hors contrat ({kind:’custom’, file:’<empreinte>.png’})');
          }
        }
      }
      if (Object.keys(payload).length === 0) {
        guard.invalid('payload', 'modification vide');
        return guardError(channel, guard);
      }
      return guard.errors.length === 0 ? { ok: true, value: payload } : guardError(channel, guard);
    }
    case IPC.roomJoin: {
      const payload = guard.object(raw, 'payload', JOIN_KEYS);
      const roomId = guard.string(payload, 'roomId', 'payload', 1, 64);
      const name = guard.string(payload, 'name', 'payload', 1, 32);
      if (guard.errors.length > 0) return guardError(channel, guard);
      return { ok: true, value: { roomId, name } };
    }
    case IPC.controlSetMute: {
      const payload = guard.object(raw, 'payload', MUTE_KEYS);
      const muted = guard.boolean(payload, 'muted', 'payload');
      if (guard.errors.length > 0) return guardError(channel, guard);
      return { ok: true, value: { muted } };
    }
    case IPC.controlSetDeafen: {
      const payload = guard.object(raw, 'payload', DEAFEN_KEYS);
      const deafened = guard.boolean(payload, 'deafened', 'payload');
      if (guard.errors.length > 0) return guardError(channel, guard);
      return { ok: true, value: { deafened } };
    }
    case IPC.controlSetPushToTalk: {
      const payload = guard.object(raw, 'payload', PTT_KEYS);
      const active = guard.boolean(payload, 'active', 'payload');
      if (guard.errors.length > 0) return guardError(channel, guard);
      return { ok: true, value: { active } };
    }
    case IPC.controlSetGain: {
      const payload = guard.object(raw, 'payload', GAIN_KEYS);
      const participantId = guard.string(payload, 'participantId', 'payload', 1, 64);
      const gain = guard.number(payload, 'gain', 'payload', 0, 2);
      if (guard.errors.length > 0) return guardError(channel, guard);
      return { ok: true, value: { participantId, gain } };
    }
    case IPC.overlaySet: {
      const payload = guard.object(raw, 'payload', OVERLAY_KEYS);
      if (payload === null) return guardError(channel, guard);
      const value: OverlayPatchPayload = {};
      if ('visible' in payload) {
        const visible = guard.boolean(payload, 'visible', 'payload');
        if (visible !== null) value.visible = visible;
      }
      if ('opacity' in payload) {
        const opacity = guard.number(payload, 'opacity', 'payload', 0.6, 1);
        if (opacity !== null) value.opacity = opacity;
      }
      if ('scale' in payload) {
        const scale = guard.oneOf(payload, 'scale', 'payload', ['sm', 'md', 'lg'] as const);
        if (scale !== null) value.scale = scale;
      }
      if ('screenId' in payload) {
        const screenId = guard.nullableString(payload, 'screenId', 'payload', 64);
        if (screenId !== undefined) value.screenId = screenId;
      }
      if ('position' in payload) {
        const position = readPosition(guard, payload, 'position');
        if (position !== undefined) value.position = position;
      }
      if (guard.errors.length > 0) return guardError(channel, guard);
      return { ok: true, value };
    }
    case IPC.signalSend: {
      if (!isPlainObject(raw)) {
        guard.invalid('payload', 'objet de signalisation attendu');
        return guardError(channel, guard);
      }
      const kind = guard.oneOf(raw, 'kind', 'payload', SIGNAL_OUT_KINDS);
      if (kind === null) return guardError(channel, guard);
      if (kind === 'leave') {
        if (Object.keys(raw).length !== 1) guard.invalid('payload', 'champ inconnu apres « leave »');
        return guard.errors.length === 0 ? { ok: true, value: { kind } } : guardError(channel, guard);
      }
      for (const key of Object.keys(raw)) {
        if (!SIGNAL_OUT_KEYS.includes(key as (typeof SIGNAL_OUT_KEYS)[number])) {
          guard.invalid(`payload.${key}`, 'champ inconnu');
        }
      }
      const to = guard.string(raw, 'to', 'payload', 1, 64);
      if (!('payload' in raw)) guard.invalid('payload.payload', 'charge utile absente');
      if (guard.errors.length > 0) return guardError(channel, guard);
      return { ok: true, value: { kind, to, payload: raw['payload'] } };
    }
    case IPC.speakingSet: {
      const speaking = guardSpeakingSet(guard, raw);
      if (speaking === null || guard.errors.length > 0) return guardError(channel, guard);
      return { ok: true, value: { speaking } };
    }
    case IPC.duckingApply: {
      // Comme `speakingSet` : un tableau d'ids borné, sans doublon. L'EXCLUSION de soi-même est
      // vérifiée par le main (seul lui connaît son id de signalisation) ; ici, la forme.
      const payload = guard.object(raw, 'payload', ['speaking'] as const);
      const speaking = guard.idList(payload, 'speaking', 'payload', DUCKING_SPEAKING_MAX, SPEAKING_ID_MAX);
      if (speaking === null || guard.errors.length > 0) return guardError(channel, guard);
      return { ok: true, value: { speaking } };
    }
    case IPC.avatarChoose: {
      // Le renderer ne choisit AUCUN chemin : c'est le main qui ouvre la boîte de dialogue
      // Electron. Le payload est vide, comme `settingsGet` — une charge utile serait un essai
      // de forcer un chemin depuis la page.
      if (raw !== undefined && raw !== null) {
        const payload = guard.object(raw, 'payload', EMPTY_PAYLOAD_KEYS);
        if (payload === null || guard.errors.length > 0) return guardError(channel, guard);
      }
      return { ok: true, value: undefined };
    }
    case IPC.avatarGetImage: {
      // Le renderer demande le binaire d'un avatar QU'IL A DÉJÀ REÇU d'un pair (l'empreinte lui
      // est parvenue par `avatar-data`). Le main ne sert que `<empreinte>.png` dans
      // `userData/avatars/` : jamais un chemin, jamais une autre empreinte.
      const payload = guard.object(raw, 'payload', ['avatarRef'] as const);
      if (payload === null) return guardError(channel, guard);
      const avatarRef = guard.string(payload, 'avatarRef', 'payload', AVATAR_REF_LENGTH, AVATAR_REF_LENGTH);
      if (avatarRef === null || !isAvatarRef(avatarRef)) {
        guard.invalid('payload.avatarRef', 'empreinte d’avatar hors contrat');
        return guardError(channel, guard);
      }
      if (guard.errors.length > 0) return guardError(channel, guard);
      return { ok: true, value: { avatarRef } };
    }
    default:
      return {
        ok: false,
        error: { code: 'unknown-channel', channel, path: null, message: `canal inconnu : ${channel}` },
      };
  }
}

/**
 * Une seule forme pour les deux sens du canal (AD-19 D1) : `{ speaking: string[] }`. Le main
 * relaie la charge utile telle quelle — s'il la recomposait, il deviendrait un second avis sur
 * qui parle, exactement ce que AD-17 D1 avait supprimé.
 */
const SPEAKING_KEYS = ['speaking'] as const;
const SPEAKING_ID_MAX = 64;

function guardSpeakingSet(guard: Guard, raw: unknown): string[] | null {
  const payload = guard.object(raw, 'payload', SPEAKING_KEYS);
  return guard.idList(payload, 'speaking', 'payload', SPEAKING_SET_MAX, SPEAKING_ID_MAX);
}

const ROOM_PHASES: readonly RoomPhase[] = ['idle', 'discovering', 'joining', 'connected', 'retrying', 'failed'];

/** Phases admises sur `eventUpdateState` (miroir exact de `UpdatePhaseDto`). */
const UPDATE_PHASES: readonly UpdatePhaseDto[] = [
  'idle',
  'checking',
  'available',
  'downloading',
  'downloaded',
  'installing',
  'up-to-date',
  'disabled',
  'failed',
];

/**
 * Un `number | null` ENTIER dans [min, max] : la garde `nullablePort` porte le même contrôle pour
 * un port ; celui-ci le porte pour un pourcentage. Un flottant est refusé, pas arrondi — un
 * `percent: 42.5` viendrait d'un producteur qui n'a pas décidé ce qu'il affiche.
 */
function guardNullableInteger(
  guard: Guard,
  source: Dict | null,
  key: string,
  path: string,
  min: number,
  max: number,
): number | null | undefined {
  if (!source) return undefined;
  const value = source[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    guard.invalid(`${path}.${key}`, 'entier ou null attendu' );
    return undefined;
  }
  if (value < min || value > max) {
    guard.invalid(`${path}.${key}`, `valeur hors bornes [${min}, ${max}]`);
    return undefined;
  }
  return value;
}

/** Une chaîne `null` ou `X.Y.Z` exactement — même règle que `update.lastSeenVersion` des réglages. */
function guardNullableSemver(
  guard: Guard,
  source: Dict | null,
  key: string,
  path: string,
): string | null | undefined {
  if (!source) return undefined;
  const value = source[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value)) {
    guard.invalid(`${path}.${key}`, 'version « X.Y.Z » ou null attendue');
    return undefined;
  }
  return value;
}

/** Formes admises sur les deux canaux de signalisation (SPEC-007 §4.1). */
const SIGNAL_KINDS = ['offer', 'answer', 'ice'] as const;
const SIGNAL_OUT_KINDS = ['offer', 'answer', 'ice', 'leave'] as const;
const SIGNAL_OUT_KEYS = ['kind', 'to', 'payload'] as const;
const SIGNAL_IN_KINDS = ['peer-joined', 'peer-left', 'offer', 'answer', 'ice', 'avatar-data', 'link'] as const;
const LINK_STATES = ['connecting', 'connected', 'refused', 'closed'] as const;

function guardParticipant(guard: Guard, value: unknown, index: number): ParticipantDto | null {
  const path = `payload[${index}]`;
  if (!isPlainObject(value)) {
    guard.invalid(path, 'objet participant attendu');
    return null;
  }
  // (AD-17 D2) `speaking` n'est plus un champ connu : un annuaire qui en porterait un se fait
  // refuser au lieu de transmettre un silence supposé.
  const allowed = ['id', 'name', 'avatarRef', 'muted', 'deafened', 'gain', 'connection'] as const;
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key as (typeof allowed)[number])) guard.invalid(`${path}.${key}`, 'champ inconnu');
  }
  const id = guard.string(value, 'id', path, 1, 64);
  const name = guard.string(value, 'name', path, 1, 32);
  // Empreinte d'avatar : facultative, sous sa forme exacte uniquement (voir `ParticipantDto`).
  const rawAvatarRef = (value as Record<string, unknown>)['avatarRef'];
  const avatarRef =
    rawAvatarRef === undefined || rawAvatarRef === null
      ? null
      : typeof rawAvatarRef === 'string' && normalizeIncomingAvatarRef(rawAvatarRef) !== null
        ? rawAvatarRef
        : undefined;
  if (avatarRef === undefined) guard.invalid(`${path}.avatarRef`, 'empreinte d’avatar hors contrat');
  const muted = guard.boolean(value, 'muted', path);
  const deafened = guard.boolean(value, 'deafened', path);
  const gain = guard.number(value, 'gain', path, 0, 2);
  const connection = guard.oneOf(value, 'connection', path, ['connecting', 'connected', 'retrying', 'failed'] as const);
  if (id === null || name === null || muted === null || deafened === null || gain === null || connection === null) {
    return null;
  }
  return avatarRef === null
    ? { id, name, muted, deafened, gain, connection }
    : { id, name, avatarRef, muted, deafened, gain, connection };
}

function guardEvent(channel: string, raw: unknown): GuardResult<unknown> {
  const guard = new Guard(channel);
  switch (channel) {
    // AD-19 D1 : même forme que le canal sortant, relayée sans réécriture par le main.
    case IPC.eventSpeakingSet: {
      const speaking = guardSpeakingSet(guard, raw);
      if (speaking === null || guard.errors.length > 0) return guardError(channel, guard);
      return { ok: true, value: { speaking } };
    }
    case IPC.eventParticipants: {
      if (!Array.isArray(raw)) {
        guard.invalid('payload', 'tableau de participants attendu');
        return guardError(channel, guard);
      }
      if (raw.length > IPC_MAX_PARTICIPANTS) {
        guard.invalid('payload', `plus de ${IPC_MAX_PARTICIPANTS} participants`);
      }
      const participants: ParticipantDto[] = [];
      for (let index = 0; index < raw.length; index += 1) {
        const participant = guardParticipant(guard, raw[index], index);
        if (participant) participants.push(participant);
      }
      if (guard.errors.length > 0) return guardError(channel, guard);
      return { ok: true, value: participants };
    }
    case IPC.eventRoomsDiscovered: {
      if (!Array.isArray(raw)) {
        guard.invalid('payload', 'tableau de salons attendu');
        return guardError(channel, guard);
      }
      if (raw.length > IPC_MAX_ROOMS) {
        guard.invalid('payload', `plus de ${IPC_MAX_ROOMS} salons annoncés`);
      }
      const rooms: RoomSummaryDto[] = [];
      for (let index = 0; index < raw.length; index += 1) {
        const room = guardRoomSummary(guard, raw[index], index);
        if (room) rooms.push(room);
      }
      if (guard.errors.length > 0) return guardError(channel, guard);
      return { ok: true, value: rooms };
    }
    case IPC.eventRoomState: {
      const allowed = [
        'roomId',
        'roomName',
        'phase',
        'participantCount',
        'selfId',
        'signalingPort',
        'notice',
      ] as const;
      const payload = guard.object(raw, 'payload', allowed);
      if (payload === null) return guardError(channel, guard);
      const roomId = guard.nullableString(payload, 'roomId', 'payload', 64);
      const roomName = guard.nullableString(payload, 'roomName', 'payload', 64);
      const phase = guard.oneOf(payload, 'phase', 'payload', ROOM_PHASES);
      const participantCount = guard.number(payload, 'participantCount', 'payload', 0, IPC_MAX_PARTICIPANTS);
      const selfId = guard.nullableString(payload, 'selfId', 'payload', 64);
      const signalingPort = guard.nullablePort(payload, 'signalingPort', 'payload', 1, 65535);
      const notice = guard.nullableString(payload, 'notice', 'payload', 240);
      if (guard.errors.length > 0) return guardError(channel, guard);
      return {
        ok: true,
        value: { roomId, roomName, phase, participantCount, selfId, signalingPort, notice },
      };
    }
    case IPC.eventControlState: {
      const allowed = ['muted', 'deafened', 'pushToTalk', 'mode', 'micLevel'] as const;
      const payload = guard.object(raw, 'payload', allowed);
      const muted = guard.boolean(payload, 'muted', 'payload');
      const deafened = guard.boolean(payload, 'deafened', 'payload');
      const pushToTalk = guard.boolean(payload, 'pushToTalk', 'payload');
      const mode = guard.oneOf(payload, 'mode', 'payload', ['ptt', 'vad'] as const);
      const micLevel = guard.number(payload, 'micLevel', 'payload', 0, 1);
      if (guard.errors.length > 0) return guardError(channel, guard);
      return { ok: true, value: { muted, deafened, pushToTalk, mode, micLevel } };
    }
    case IPC.eventSettingsChanged: {
      const payload = guard.object(raw, 'payload', ['settings'] as const);
      if (payload === null) return guardError(channel, guard);
      const settings = payload['settings'];
      if (!isPlainObject(settings)) {
        guard.invalid('payload.settings', 'objet de réglages attendu');
        return guardError(channel, guard);
      }
      // La validation fine des réglages appartient à settings-schema ; ici on refuse seulement
      // une version absente ou non numérique, qui trahirait un émetteur qui n'a rien validé.
      if (typeof settings['version'] !== 'number') {
        guard.invalid('payload.settings.version', 'version numérique attendue');
        return guardError(channel, guard);
      }
      return { ok: true, value: { settings } };
    }
    case IPC.eventSignal: {
      if (!isPlainObject(raw)) {
        guard.invalid('payload', 'objet de signalisation attendu');
        return guardError(channel, guard);
      }
      const kind = guard.oneOf(raw, 'kind', 'payload', SIGNAL_IN_KINDS);
      if (kind === null) return guardError(channel, guard);
      switch (kind) {
        case 'peer-joined': {
          const allowed = ['kind', 'peerId', 'name', 'avatarRef'] as const;
          const payload = guard.object(raw, 'payload', allowed);
          const peerId = guard.string(payload, 'peerId', 'payload', 1, 64);
          const name = guard.string(payload, 'name', 'payload', 1, 32);
          // Empreinte d'avatar (SPEC-002 amendement 2026-10-31) : facultative, et sous sa forme
          // exacte (id de galerie ou 16 hexadécimaux). Le renderer ne reçoit jamais une chaîne
          // arbitraire qu'il devrait deviner sûre.
          const rawAvatarRef = (raw as Record<string, unknown>)['avatarRef'];
          const avatarRef =
            rawAvatarRef === undefined || rawAvatarRef === null
              ? null
              : typeof rawAvatarRef === 'string' && normalizeIncomingAvatarRef(rawAvatarRef) !== null
                ? rawAvatarRef
                : undefined;
          if (avatarRef === undefined) {
            guard.invalid('payload.avatarRef', 'empreinte d’avatar hors contrat');
            return guardError(channel, guard);
          }
          if (guard.errors.length > 0) return guardError(channel, guard);
          return { ok: true, value: avatarRef === null ? { kind, peerId, name } : { kind, peerId, name, avatarRef } };
        }
        case 'peer-left': {
          const allowed = ['kind', 'peerId'] as const;
          const payload = guard.object(raw, 'payload', allowed);
          const peerId = guard.string(payload, 'peerId', 'payload', 1, 64);
          if (guard.errors.length > 0) return guardError(channel, guard);
          return { ok: true, value: { kind, peerId } };
        }
        case 'link': {
          const allowed = ['kind', 'state', 'detail'] as const;
          const payload = guard.object(raw, 'payload', allowed);
          const state = guard.oneOf(payload, 'state', 'payload', LINK_STATES);
          // `detail` est `string | null` (SPEC-007 §4.1) : absent ou `null` explicite = pas de
          // raison à afficher, jamais une chaîne vide. Un `null` explicite DOIT passer : c'est la
          // valeur par défaut de `emitLink()` côté lien, et le refuser ferait jeter l'événement
          // « connecting »/« closed » par `sendEvent` sans que personne ne s'en aperçoive.
          const hasDetail = payload !== null && 'detail' in payload;
          const rawDetail = hasDetail && payload !== null ? payload['detail'] : null;
          const detail =
            rawDetail === null ? null : guard.string(payload, 'detail', 'payload', 1, 240);
          if (guard.errors.length > 0) return guardError(channel, guard);
          return { ok: true, value: { kind, state, detail } };
        }
        default: {
          // offer / answer / ice : le type est déjà restreint par SIGNAL_KINDS.
          const allowed = ['kind', 'from', 'payload'] as const;
          const payload = guard.object(raw, 'payload', allowed);
          const from = guard.string(payload, 'from', 'payload', 1, 64);
          if (payload !== null && !('payload' in payload)) {
            guard.invalid('payload.payload', 'charge utile absente');
          }
          if (guard.errors.length > 0) return guardError(channel, guard);
          return { ok: true, value: { kind, from, payload: payload?.['payload'] } };
        }
      }
    }
    case IPC.eventDiscoveryStatus: {
      const allowed = ['health'] as const;
      const payload = guard.object(raw, 'payload', allowed);
      if (payload === null) return guardError(channel, guard);
      const health = guard.oneOf(payload, 'health', 'payload', ['ok', 'mdns-down', 'offline'] as const);
      if (health === null || guard.errors.length > 0) return guardError(channel, guard);
      return { ok: true, value: { health } };
    }
    case IPC.eventUpdateState: {
      // Mises à jour (2026-11-01) : DTO validé champ par champ. Un `percent` flottant, une
      // `version` qui n'est pas `X.Y.Z` ou un `state` inventé sont refusés — l'écran n'affiche
      // jamais ce que le contrat n'a pas pu nommer.
      const allowed = ['state', 'version', 'percent', 'reason'] as const;
      const payload = guard.object(raw, 'payload', allowed);
      if (payload === null) return guardError(channel, guard);
      const state = guard.oneOf(payload, 'state', 'payload', UPDATE_PHASES);
      const version = guardNullableSemver(guard, payload, 'version', 'payload');
      const percent = guardNullableInteger(guard, payload, 'percent', 'payload', 0, 100);
      const reason = guard.nullableString(payload, 'reason', 'payload', UPDATE_REASON_MAX);
      if (guard.errors.length > 0) return guardError(channel, guard);
      return { ok: true, value: { state, version, percent, reason } };
    }
    case IPC.eventProfileOpen: {
      // Notification vide : la décision d'afficher le panneau appartient au renderer seul.
      if (raw !== undefined && raw !== null) {
        const payload = guard.object(raw, 'payload', []);
        if (payload === null) return guardError(channel, guard);
        if (Object.keys(payload).length !== 0) {
          guard.invalid('payload', 'notification vide attendue');
        }
      }
      return guard.errors.length === 0 ? { ok: true, value: {} } : guardError(channel, guard);
    }
    case IPC.eventOverlayGeometry: {
      const allowed = ['x', 'y', 'width', 'height', 'scaleFactor'] as const;
      const payload = guard.object(raw, 'payload', allowed);
      const x = guard.number(payload, 'x', 'payload', -100000, 100000);
      const y = guard.number(payload, 'y', 'payload', -100000, 100000);
      const width = guard.number(payload, 'width', 'payload', 0, 20000);
      const height = guard.number(payload, 'height', 'payload', 0, 20000);
      const scaleFactor = guard.number(payload, 'scaleFactor', 'payload', 1, 4);
      if (guard.errors.length > 0) return guardError(channel, guard);
      return { ok: true, value: { x, y, width, height, scaleFactor } };
    }
    case IPC.eventShortcutConflict: {
      const allowed = ['accelerator', 'registered', 'fallback', 'reason'] as const;
      const payload = guard.object(raw, 'payload', allowed);
      if (payload === null) return guardError(channel, guard);
      const accelerator = guard.string(payload, 'accelerator', 'payload', 1, 64);
      const registered = guard.boolean(payload, 'registered', 'payload');
      const fallback = guard.nullableString(payload, 'fallback', 'payload', 64);
      const reason = guard.nullableString(payload, 'reason', 'payload', 240);
      if (guard.errors.length > 0) return guardError(channel, guard);
      return { ok: true, value: { accelerator, registered, fallback: fallback ?? null, reason: reason ?? null } };
    }
    default:
      return {
        ok: false,
        error: { code: 'unknown-channel', channel, path: null, message: `canal inconnu : ${channel}` },
      };
  }
}

// --- Ducking (2026-11-01) ------------------------------------------------------------------

/**
 * Vrai si au moins un PAIR (jamais soi) est mesuré en train de parler. Le signal vient du
 * renderer qui mesure (`voice.ts` — table des pairs tenus) et l'id de l'appelant est passé en
 * dur par le contrat : `selfId` est ici le `signalingLink.selfId` que le main connaît seul.
 * Un id identique à celui de soi est refusé, pas fondu : un producteur qui glisse soi-même
 * dans l'ensemble trahirait la sémantique (« les AUTRES applications », jamais Concord).
 *
 * Fonction PURE, exécutée sous `node --test` (tests/ducking-gate.node.test.ts) : c'est la
 * seule façon de prouver que « soi-même qui parle ⇒ AUCUN ducking » tient à la garde du main.
 */
export function shouldDuckForPeers(speaking: readonly string[], selfId: string | null): boolean {
  for (const id of speaking) {
    if (typeof id !== 'string' || id.trim().length === 0) continue;
    if (selfId !== null && id === selfId) {
      // L'ensemble porte soi : le ducking ne se déclenche pas là-dessus. On continue d'examiner
      // les autres ids — un pair qui parle vraiment reste un déclencheur légitime.
      continue;
    }
    return true;
  }
  return false;
}

// --- API publique -----------------------------------------------------------------------------

export function isKnownChannel(channel: string): boolean {
  return (INVOKE_CHANNELS as readonly string[]).includes(channel) || (EVENT_CHANNELS as readonly string[]).includes(channel);
}

export function isInvokeChannel(channel: string): channel is IpcInvokeChannel {
  return (INVOKE_CHANNELS as readonly string[]).includes(channel);
}

export function isEventChannel(channel: string): channel is IpcEventChannel {
  return (EVENT_CHANNELS as readonly string[]).includes(channel);
}

/** Garde générique : oriente selon la direction (renderer → main ou main → renderer). */
export function guardPayload(
  direction: 'invoke' | 'event',
  channel: string,
  payload: unknown,
): GuardResult<unknown> {
  return direction === 'invoke' ? guardInvoke(channel, payload) : guardEvent(channel, payload);
}

/** Variante levant une exception, pour le process principal : lève `IpcContractError`. */
export function assertPayload(direction: 'invoke' | 'event', channel: string, payload: unknown): unknown {
  const result = guardPayload(direction, channel, payload);
  if (!result.ok) throw new IpcContractError(result.error);
  return result.value;
}

/**
 * Noms de canaux à enregistrer par `ipcMain.handle`, dans l'ordre du contrat.
 * Le process principal itère sur cette liste : ajouter un canal au contrat sans l'implémenter
 * laisse un `undefined` visible, plutôt qu'un canal silencieusement absent.
 */
export function invokeHandlers(): readonly IpcInvokeChannel[] {
  return INVOKE_CHANNELS;
}
