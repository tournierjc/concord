/**
 * voice.ts — branchement de la voix dans la coquille (T15b, complété par T16b / SPEC-007 §4.3).
 *
 * Ce module est le SEUL consommateur de `../engine/rtc/media-plane.ts` : il crée le plan média
 * à l'entrée en salon, le détruit au départ, ouvre le micro, laisse le push-to-talk ouvrir/fermer
 * la piste pour de vrai (`setTransmitting`), et lit `level()` pour l'anneau « parle » des avatars.
 *
 * Trois règles tenues ici, chacune mesurable :
 *   1. **Le micro se demande, il ne se suppose pas.** Aucun état `live` avant que
 *      `startMicrophone()` ait rendu la main ; une erreur WebRTC devient `unavailable` avec sa
 *      raison réelle, affichée par l'écran.
 *   2. **Un seul plan média vivant** par page, clé `roomId|localId` : deux appels concurrents
 *      voient la même instance, un changement de clé ferme l'ancienne.
 *   3. **Aucun serveur ICE.** `createMediaPlane({ localId })` est appelé SANS `rtcConfig` :
 *      `lanOnlyConfiguration(undefined)` rend `iceServers: []`. Aucun réglage, aucun canal IPC,
 *      aucune préférence de la coquille ne peut injecter de STUN/TURN.
 *
 * Maillage (T16d / SPEC-009) — ce qui est branché ici, et ce qui ne l'est pas :
 *   • `src/renderer/voice-mesh.ts` porte la séquence et le routage : abonnement au tuyau posé tôt
 *     en mode tampon, `startMicrophone()` → `createMesh()` → tampon vidé dans l'ordre d'arrivée.
 *     Ce fichier ne fabrique ni offre ni réponse : le maillage (`src/engine/net/mesh.ts`) en est
 *     seul propriétaire, comme de l'ICE (SPEC-009 §1(b)) ;
 *   • `onRemoteStream` alimente un `<audio>` par pair (`audio-sink.ts`), `onStateChange` publie
 *     l'échec ICE réel, `onPeerState` du mesh publie le palier de lien par pair ;
 *   • `handleSignal` ci-dessous n'est plus qu'un bookkeeping d'interface, appelé pour CHAQUE
 *     message (tamponné ou routé) : un seul point d'entrée dans la page ;
 *   • `retrying` (reconnexion du transport) détruit la session : `mesh.close()` puis
 *     `plane.close()`, pairs passés à `failed`, aucun spinner ; le retour en `connected` en
 *     reconstruit une (nouveau plan, nouveau micro, nouveau mesh) — coupure audio assumée.
 *
 * DÉFAUT-D (canal de candidats ICE), corrigé par T17 / AD-16 côté maillage : `MeshOptions`
 * porte `onLocalCandidate(peerId, candidat)` et le plan média nomme le pair émetteur.
 * DÉFAUT-E (cause absente), corrigé par T17 : `onPeerState(peerId, palier, cause)`.
 * NOTE (T17) : ce commentaire annonçait « DÉFAUT-E » pour le défaut des candidats ICE ; c'est
 * DÉFAUT-D (VERIF-020 §3). DÉFAUT-E est celui des paliers et de la cause (VERIF-020 §4).
 * Constat d'origine, conservé tel quel : `media-plane.ts` était le seul à voir `onicecandidate`,
 * son callback ne portait pas l'identité du pair, et `mesh.ts` n'offrait aucun point d'entrée
 * pour les candidats locaux — router sans identité serait diffuser, deviner serait mentir.
 * T17 ferme les deux : le pair émetteur est porté de bout en bout, le maillage route.
 */

import { useEffect, useSyncExternalStore } from 'react';

import {
  createVoiceWiring,
  type MeshPeerState,
  type PeerStateCause,
  type VoiceWiring,
} from './voice-mesh.ts';
import type { RoomPhase, SignalIn, SignalOut } from '../shell/ipc-contract';
import { lanApi } from './api';
import { createAudioSinkRegistry, documentSinkHost, type AudioSinkRegistry } from './audio-sink';
import {
  SAMPLE_PERIOD_MS,
  createPeerSpeechTracker,
  type PeerSpeechTracker,
} from './peer-speech.ts';
import { PEER_LEVELS, peerSpeaking } from './participant-state.ts';
import { createSpeakingRelay, type SpeakingRelay } from './speaking-relay.ts';

/** Où en est la voix locale. `unavailable` est un état de première classe, pas une erreur muette. */
export type VoiceStatus = 'idle' | 'starting' | 'live' | 'unavailable';

/** Seuil RMS au-dessus duquel l'avatar du locuteur s'allume (0..1, même échelle que `level()`). */
export const SPEAKING_LEVEL = 0.02;

/**
 * État de l'audio d'un pair distant, tel que le maillage le rapporte (SPEC-008 §1).
 * `noFlow` : lien ouvert mais aucun flux dans les 5 s — le libellé et l'anneau restent
 * à l'interface (clé `voice.peer.*`), aucun mot n'est inventé ici.
 */
export type VoicePeerState = 'connecting' | 'connected' | 'noFlow' | 'failed';

/** Un pair distant : son identité de signalisation, son état, et la présence réelle d'un flux. */
export interface VoicePeer {
  readonly peerId: string;
  readonly name: string | null;
  readonly state: VoicePeerState;
  /** Cause du dernier changement d'état, telle que le maillage l'a donnée (T17). */
  readonly cause: PeerStateCause | null;
  /** `true` seulement si un `MediaStream` a été branché sur son `<audio>`. */
  readonly hasStream: boolean;
  /**
   * Empreinte d'avatar reçue au `join` (SPEC-002, amendement 2026-10-31). Id de galerie sous sa
   * forme brute, empreinte de 16 hex pour une image personnalisée. Jamais une image : l'affichage
   * retombe sur les initiales tant que le binaire n'est pas arrivé.
   */
  readonly avatarRef?: string;
}

/** État du tuyau de signalisation (miroir du `SignalIn` de type `link`). */
export interface VoiceLink {
  readonly state: 'connecting' | 'connected' | 'refused' | 'closed';
  readonly detail: string | null;
}

/** Ce que l'interface a le droit de montrer : aucune valeur déduite, aucune valeur inventée. */
export interface VoiceSnapshot {
  readonly status: VoiceStatus;
  readonly error: string | null;
  readonly level: number;
  readonly transmitting: boolean;
  readonly peers: readonly VoicePeer[];
  readonly link: VoiceLink | null;
}

const IDLE: VoiceSnapshot = {
  status: 'idle',
  error: null,
  level: 0,
  transmitting: false,
  peers: [],
  link: null,
};

/** État mutable de la liaison : pairs connus, sorties audio, état du lien. */
interface LinkState {
  readonly peers: Map<string, VoicePeer>;
  readonly sinks: AudioSinkRegistry;
  link: VoiceLink | null;
  /** Flux reçus sans identité de pair : comptés et tracés, jamais affichés (AD-17 / D3). */
  unattributed: number;
}

interface VoiceSession {
  readonly key: string;
  readonly wire: VoiceWiring;
  readonly link: LinkState;
  frame: number | null;
  live: boolean;
  want: boolean;
  /**
   * Producteur des échantillons de parole distante (AD-17 D4). Il vit et meurt avec la session :
   * son hystérésis par pair ne survit ni à un départ de salon ni à une reconnexion.
   */
  readonly speech: PeerSpeechTracker;
  /**
   * Identité de signalisation de CETTE page (AD-20 D1 : `speaking[]` porte aussi soi-même, sans
   * drapeau `self` ni second canal). C'est la clé que l'overlay compare à ses participants.
   */
  readonly selfId: string;
  /**
   * Publication de l'ensemble « qui parle » vers l'overlay (AD-20 D1/D3). Il vit avec la session :
   * sa tenue de 600 ms et son dernier ensemble publié ne survivent pas à un départ de salon.
   */
  readonly relay: SpeakingRelay;
}

let snapshot: VoiceSnapshot = IDLE;
const listeners = new Set<() => void>();

/** Singleton de module : au plus UNE session vivante dans la page. */
let session: VoiceSession | null = null;

function publish(patch: Partial<VoiceSnapshot>): void {
  const next: VoiceSnapshot = { ...snapshot, ...patch };
  if (
    next.status === snapshot.status &&
    next.error === snapshot.error &&
    next.level === snapshot.level &&
    next.transmitting === snapshot.transmitting &&
    next.link === snapshot.link &&
    next.peers === snapshot.peers
  ) {
    return;
  }
  snapshot = next;
  for (const listener of listeners) listener();
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message;
  const text = String(error);
  return text === '' ? 'cause inconnue' : text;
}

/* ------------------------------------------------------------------ */
/* Haut-parleur : un <audio> par pair                                  */
/* ------------------------------------------------------------------ */

function createSinks(): AudioSinkRegistry {
  const doc = typeof document === 'undefined' ? null : document;
  if (doc === null || doc.body === null || doc.body === undefined) {
    // Aucun DOM (test de fumée, document détaché) : registre inerte, jamais une exception.
    return createAudioSinkRegistry({
      createElement: () => ({ srcObject: null, autoplay: true }),
      append: () => undefined,
      remove: () => undefined,
    });
  }
  return createAudioSinkRegistry(documentSinkHost(doc));
}

function publishPeers(state: LinkState): void {
  publish({ peers: [...state.peers.values()], link: state.link });
}

function upsertPeer(
  state: LinkState,
  peerId: string,
  patch: {
    name?: string | null;
    state?: VoicePeerState;
    cause?: PeerStateCause | null;
    hasStream?: boolean;
    avatarRef?: string | null;
  },
): VoicePeer {
  const previous = state.peers.get(peerId);
  const next: VoicePeer = {
    peerId,
    name: patch.name ?? previous?.name ?? null,
    state: patch.state ?? previous?.state ?? 'connecting',
    cause: patch.cause ?? previous?.cause ?? null,
    hasStream: patch.hasStream ?? previous?.hasStream ?? false,
    ...(patch.avatarRef !== undefined && patch.avatarRef !== null
      ? { avatarRef: patch.avatarRef }
      : previous?.avatarRef !== undefined
        ? { avatarRef: previous.avatarRef }
        : {}),
  };
  state.peers.set(peerId, next);
  return next;
}

/** Envoie un message au tuyau ; hors application (pas de preload) ou hors salon, on ne fait rien. */
function emitSignal(message: SignalOut): void {
  try {
    void lanApi().sendSignal(message);
  } catch {
    // Pas de preload : la voix locale continue, la liaison distante reste absente et l'écran le dit.
  }
}

/**
 * Paliers de lien publiés par le maillage (SPEC-009 §1 / SPEC-008 §1 / AD-16).
 *
 * Le mesh fournit quatre paliers — `connecting`, `connected`, `noFlow`, `failed` — et, depuis
 * T17, la cause qui les accompagne (`'ice'`, `'timeout'`, `'sink'`). `speaking` reste décidé par
 * l'interface. L'écran n'affirme jamais une cause qu'il n'a pas reçue : `cause` est recopiée
 * telle quelle (`data-peer-cause`), et un palier sans libellé connu retombe sur `failed`, pas
 * sur le silence.
 */
function applyPeerState(
  state: LinkState,
  peerId: string,
  next: MeshPeerState,
  cause: PeerStateCause,
): void {
  // Le palier vient du maillage, donc d'une preuve (lien établi, échec mesuré, ou
  // horloge des 5 s) : c'est LUI qui décide. `hasStream` est une preuve INDÉPENDANTE
  // (le flux branché par `attachRemoteStream`) : `upsertPeer` la conserve, mais
  // aucun palier du maillage n'est effacé par elle — `attachRemoteStream` ne
  // promeut plus `connected` tout seul (défaut (c), SPEC-008 §1).
  state.sinks.ensure(peerId);
  upsertPeer(state, peerId, { state: next, cause });
  publishPeers(state);
}

/**
 * AD-17 / D3 — le flux arrive AVEC son pair, ou n'arrive pas.
 *
 * Il n'y a plus d'heuristique ici : le plan média transmet `peerId` (seul témoin de la
 * `RTCPeerConnection` d'origine) et le maillage ne relaie que les pairs qu'il a ouverts. Si
 * l'identité manque, on ne devine pas : le flux est ignoré et tracé. L'écran ne peut donc
 * plus afficher un participant `distant-<n>` (DÉFAUT-C) ni éclairer le mauvais avatar.
 */
function attachRemoteStream(state: LinkState, peerId: string, stream: unknown): void {
  if (typeof peerId !== 'string' || peerId.length === 0) {
    // Jamais de pair inventé : on compte, on trace, on n'affiche rien.
    state.unattributed += 1;
    console.warn(`[voice] flux sans pair — ignoré (unattributed: ${state.unattributed})`);
    return;
  }
  if (stream === null || stream === undefined) return;
  // Défaut (c), SPEC-008 §1 : la piste branchée est la preuve de flux — le maillage
  // l'a déjà comptée telle (il publie `connected` depuis `onRemoteStream`). Ici,
  // plus aucun `connected` auto-proclamé : on branche le `<audio>`, on note la
  // preuve (`hasStream`), et le palier reste celui du maillage. Un flux branché ne
  // fait pas non plus tomber un `failed` que le maillage vient de mesurer.
  state.sinks.ensure(peerId);
  state.sinks.attach(peerId, stream);
  upsertPeer(state, peerId, { hasStream: true });
  publishPeers(state);
}

/**
 * Défaut (b) — l'état de connexion ICE arrive ENFIN AVEC SON PAIR.
 *
 * L'ancienne signature (`{ connectionState }` nu, contrat gelé de `MediaPlaneOptions`)
 * n'a pas d'identité : l'appelant appliquait donc l'état à TOUS les pairs
 * « connecting » — un pair qui échoue à l'ICE en faisait tomber d'autres en
 * `failed`, et un pair `connected` masquait un pair mort. Cette fonction route
 * l'événement nominatif ; la garde « preuve » est double, SPEC-008 §1 :
 *   • `'failed'`/`'disconnected'`/`'closed'` ne touchent QUE leur pair ;
 *   • `'connected'`/`'completed'` ne promeuvent QUE leur pair, et seulement si ce
 *     pair a une preuve — un flux branché (`hasStream`) ou un lien mesh établi
 *     (`state === 'connected'`, publié par le maillage sur preuve de flux).
 *     Un `connected` de `RTCPeerConnection` sans preuve ne réinvente rien : il
 *     laisse le pair où il est, l'horloge des 5 s du maillage répondra.
 * Les paliers `failed`/`noFlow` publiés par le maillage sont la vérité du lien :
 * un événement ICE tardif ne les dédit pas.
 */
function applyPeerConnectionState(
  state: LinkState,
  peerId: string,
  connectionState: string,
): void {
  const previous = state.peers.get(peerId);
  if (previous === undefined) return // pas de pair connu : rien à nommer, rien à écrire
  if (previous.state === 'failed' || previous.state === 'noFlow') return

  const failed =
    connectionState === 'failed' ||
    connectionState === 'disconnected' ||
    connectionState === 'closed';
  const connected = connectionState === 'connected' || connectionState === 'completed';

  if (failed) {
    upsertPeer(state, peerId, { state: 'failed' });
    publishPeers(state);
    return;
  }
  if (connected) {
    // Promotion UNIQUEMENT sur preuve : flux branché, ou lien déjà établi par le
    // maillage. Sans preuve, l'ICE dit « connectée » pour rien — on ne le croit pas.
    if (previous.hasStream || previous.state === 'connected') {
      upsertPeer(state, peerId, { state: 'connected' });
      publishPeers(state);
    }
    return;
  }
  // `new` / `connecting` : l'état d'attente du maillage (`connecting`) est déjà le
  // bon. Rien à écrire, rien à publier.
}

function handleSignal(state: LinkState, message: SignalIn): void {
  switch (message.kind) {
    case 'link': {
      state.link = { state: message.state, detail: message.detail ?? null };
      if (message.state === 'refused' || message.state === 'closed') {
        // Plus aucun flux ne peut aboutir : les pairs en attente passent à `failed`, sans mentir
        // sur ceux qui sont déjà branchés.
        for (const peer of [...state.peers.values()]) {
          if (peer.state === 'connecting') upsertPeer(state, peer.peerId, { state: 'failed' });
        }
      }
      publishPeers(state);
      return;
    }
    case 'peer-joined': {
      // L'élément audio existe AVANT le flux : aucune arrivée de flux ne peut le précéder.
      // Aucun candidat n'est rejoué ici : l'ICE appartient au maillage (SPEC-009 §1(b)).
      state.sinks.ensure(message.peerId);
      upsertPeer(state, message.peerId, {
        name: message.name,
        state: 'connecting',
        // SPEC-002 (amendement 2026-10-31) : l'empreinte arrive avec le pseudo, l'image suivra.
        ...(message.avatarRef !== undefined ? { avatarRef: message.avatarRef } : {}),
      });
      publishPeers(state);
      return;
    }
    case 'peer-left': {
      state.sinks.remove(message.peerId);
      state.peers.delete(message.peerId);
      publishPeers(state);
      return;
    }
    default: {
      // offer / answer / ice : premier contact d'un pair, même sans `peer-joined` (hôte direct).
      if (!state.peers.has(message.from)) {
        state.sinks.ensure(message.from);
        upsertPeer(state, message.from, { state: 'connecting' });
        publishPeers(state);
      }
      return;
    }
  }
}

/** Abonnement au tuyau. `null` si le preload n'est pas là (document hors application). */
function subscribeSignals(handler: (message: SignalIn) => void): (() => void) | null {
  try {
    return lanApi().onSignal(handler);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Métrage et transmission                                             */
/* ------------------------------------------------------------------ */

/**
 * Échantillonne `level()` à `SAMPLE_PERIOD_MS` (50 ms) : assez pour l'anneau et pour que la tenue
 * de relâchement ne soit jamais interrompue, assez léger pour un overlay (SPEC-013 §2 R-U8 §1).
 */
function startMeter(current: VoiceSession): void {
  if (typeof requestAnimationFrame !== 'function') return;
  let last = 0;
  const tick = (now: number): void => {
    if (session !== current) return;
    if (now - last >= SAMPLE_PERIOD_MS) {
      last = now;
      const level = readLevel(current);
      publish({ level });
      // Parole distante : une mesure par pair et par trame, écrite dans la table que lit le
      // rendu. C'est le SEUL producteur (`peer-speech.ts`) — un pair non mesuré n'est pas écrit.
      current.speech.sample(
        { peers: peerIds(current), level: (peerId) => readPeerLevel(current, peerId) },
        now,
      );
      // Parole locale et distante, dans le MÊME ensemble (AD-20 D1) : la mesure locale est
      // certaine (`level()` du plan média), elle n'a donc pas besoin d'échantillon daté.
      publishSpeaking(current, level, now);
    }
    current.frame = requestAnimationFrame(tick);
  };
  current.frame = requestAnimationFrame(tick);
}

/**
 * Publie l'ensemble « qui parle » vers l'overlay (AD-19 D1 / AD-20 D1, cadence D3).
 *
 * Ce fichier ne décide QUE de qui : soi (`level()` local, seuil `SPEAKING_LEVEL`) et les pairs
 * mesurés au-dessus du seuil de la table. `speaking-relay.ts` décide QUAND — transitions seules
 * plus tenue de 600 ms — et c'est la seule chose qui empêche un budget de 50 messages/10 s.
 *
 * `peerSpeaking` (et non la table brute) : un échantillon périmé n'est pas « parle ». L'id publié
 * est l'id de SIGNALISATION, celui que l'overlay connaît déjà par `room-info`.
 */
function publishSpeaking(current: VoiceSession, selfLevel: number, now: number): void {
  const peers: string[] = [];
  for (const peerId of peerIds(current)) {
    if (peerSpeaking(peerId, PEER_LEVELS, now) === 'true') peers.push(peerId);
  }
  const ids = current.relay.update(
    { selfId: current.selfId, self: selfLevel >= SPEAKING_LEVEL, peers },
    now,
  );
  if (ids === null) return;
  // Publication « au mieux » : hors application Electron (tests, page seule) il n'y a pas de main
  // pour répondre. La mesure locale ne doit pas s'arrêter pour autant — le relais garde son état et
  // republiera à la transition suivante.
  try {
    void lanApi().setSpeaking(ids).catch(() => {});
  } catch {
    /* pas de pont : la mesure continue, l'overlay ne verra simplement rien */
  }
}

/** `level()` réel du plan média ; une erreur de lecture vaut silence, jamais une valeur inventée. */
function readLevel(current: VoiceSession): number {
  if (!current.live) return 0;
  try {
    const value = current.wire.plane.level();
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
  } catch {
    return 0;
  }
}

/** Ids mesurables : ceux du maillage, jamais ceux de l'annuaire (AD-17 D2). */
function peerIds(current: VoiceSession): readonly string[] {
  if (!current.live) return [];
  try {
    return current.wire.peers();
  } catch {
    return [];
  }
}

/**
 * `level(peerId)` ; `null` reste `null` — une mesure absente n'est pas un zéro mesuré.
 *
 * Défaut (c), SPEC-008 §1 : un NOMBRE rendu pour ce pair est un paquet reçu — c'est
 * la preuve de flux que le maillage attend pour désarmer l'horloge des 5 s et dire
 * `connected`. C'est ici, et nulle part ailleurs, que la mesure devient preuve :
 * `null` (analyseur absent ou piste finie) ne prouve rien, le maillage garde son
 * chien de garde armé. Le maillage est idempotent — ce battement tourne à ~20 Hz.
 */
function readPeerLevel(current: VoiceSession, peerId: string): number | null {
  if (!current.live) return null;
  try {
    const value = current.wire.plane.level(peerId);
    if (typeof value === 'number' && Number.isFinite(value)) {
      current.wire.reportFlow(peerId);
      return value;
    }
    return null;
  } catch {
    return null;
  }
}

function stopMeter(current: VoiceSession): void {
  if (current.frame !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(current.frame);
  }
  current.frame = null;
  // Plus de métrage ⇒ plus d'échantillon : sans ce vidage, la table garderait des `'true'`
  // jusqu'à ce que la péremption les éteigne, sur une session qui n'existe plus.
  current.speech.reset();
}

/** Applique l'intention de transmission au plan média. Retourne l'état réellement atteint. */
function applyTransmit(current: VoiceSession, active: boolean): boolean {
  if (!current.live) {
    current.want = active;
    return false;
  }
  try {
    current.wire.plane.setTransmitting(active);
    current.want = active;
    return true;
  } catch (error) {
    publish({ status: 'unavailable', error: describeError(error), transmitting: false, level: 0 });
    return false;
  }
}

/** Ferme la session vivante, s'il y en a une. Idempotent. */
export function closeVoice(): void {
  const current = session;
  if (current === null) {
    publish({ status: 'idle', error: null, level: 0, transmitting: false, peers: [], link: null });
    return;
  }
  session = null;
  stopMeter(current);
  // Le relais meurt avec la session : sans ce `reset`, la session suivante croirait avoir déjà
  // publié un ensemble, et une extinction pourrait être sautée (halo allumé dans le vide).
  current.relay.reset();
  // Départ propre du tuyau : `leave` émis, abonnement coupé, sorties audio détruites.
  emitSignal({ kind: 'leave' });
  // Chaque étape est ISOLÉE : aucune ne doit pouvoir empêcher la fermeture du micro et des
  // RTCPeerConnection. Avant, `sinks.clear()` pouvait lever (`NotFoundError` de double retrait sur
  // un vrai DOM) et la sortie de salon s'arrêtait là — micro ouvert et connexions vivantes.
  try {
    current.link.sinks.clear();
    current.link.peers.clear();
  } catch (error) {
    console.warn('[voix] sorties audio non détruites', error);
  }
  try {
    current.wire.plane.setTransmitting(false);
  } catch {
    // Un plan déjà fermé n'a rien à couper : la fermeture ci-dessous reste la seule vérité.
  }
  // SPEC-009 §1(d) : le mesh d'abord, le plan ensuite — `wire.close()` applique cet ordre.
  try {
    current.wire.close();
  } catch (error) {
    // Le micro et les PC sont la partie qui compte : on ne peut pas la simuler, on la dit.
    console.error('[voix] fermeture du plan média impossible', error);
  }
  publish({ status: 'idle', error: null, level: 0, transmitting: false, peers: [], link: null });
}

/**
 * Reconnexion du transport (SPEC-009 §1(e)). Le mesh NE SURVIT PAS : `wire.close()` ferme le
 * maillage puis le plan (donc toutes les `RTCPeerConnection` et le micro). Aucun `leave` n'est
 * émis — on n'a pas quitté le salon — et les pairs ne restent pas en attente : ce qui n'était
 * pas établi tombe à `failed`, sans spinner. La coupure audio dure le temps de la reconnexion,
 * et c'est affiché comme tel : c'est un coût assumé, pas une dégradation cachée.
 */
export function suspendVoice(): void {
  const current = session;
  if (current === null) return;
  session = null;
  stopMeter(current);
  // Même isolement qu'à la sortie de salon : un retrait refusé par le DOM ne doit pas laisser la
  // reprise de connexion bloquée sur un nettoyage à moitié fait.
  try {
    current.link.sinks.clear();
  } catch (error) {
    console.warn('[voix] sorties audio non détruites (reconnexion)', error);
  }
  for (const peer of [...current.link.peers.values()]) {
    if (peer.state !== 'failed') upsertPeer(current.link, peer.peerId, { state: 'failed' });
  }
  // La liaison n'est plus : l'écran le dit (`voice.link.closed`), la bannière de salon porte la
  // reconnexion. Rien n'est promis sur une reprise qui n'a pas encore eu lieu.
  current.link.link = { state: 'closed', detail: 'reconnexion' };
  try {
    current.wire.plane.setTransmitting(false);
  } catch {
    // Plan déjà fermé : rien à couper.
  }
  current.wire.close();
  publish({ status: 'idle', error: null, level: 0, transmitting: false });
  publishPeers(current.link);
}

/**
 * Ouvre le plan média pour `key`. Une instance par clé : un second appel identique ne fait rien,
 * un appel avec une autre clé ferme d'abord l'ancienne.
 */
export function openVoice(key: string, localId: string): void {
  if (session !== null && session.key === key) return;
  if (session !== null) closeVoice();

  publish({ status: 'starting', error: null, level: 0, transmitting: false, peers: [], link: null });

  const link: LinkState = {
    peers: new Map<string, VoicePeer>(),
    sinks: createSinks(),
    link: null,
    unattributed: 0,
  };

  let current: VoiceSession | null = null;
  let wire: VoiceWiring;
  try {
    // Le câblage porte la séquence et le routage (SPEC-009) : abonnement posé tôt en tampon,
    // `startMicrophone()` → `createMesh()` → tampon vidé dans l'ordre d'arrivée. Le plan est créé
    // Sans `rtcConfig` (`iceServers: []`) ; l'ICE appartient au maillage, qui reçoit donc
    // les candidats locaux avec leur pair émetteur (T17) et les achemine lui-même.
    wire = createVoiceWiring({
      localId,
      send: (message) => {
        emitSignal(message);
      },
      subscribe: (handler) => subscribeSignals(handler),
      // (c) Un seul point d'entrée : le bookkeeping d'interface, pour chaque message reçu.
      onMessage: (message) => {
        handleSignal(link, message);
      },
      onPeerState: (peerId, state, cause) => {
        applyPeerState(link, peerId, state, cause);
      },
      onRemoteStream: (peerId, stream) => {
        attachRemoteStream(link, peerId, stream);
      },
      // Défaut (b) : la fréquence globale reste émise (contrat gelé), mais ne
      // publie plus rien — c'est l'événement nominatif ci-dessous qui décide.
      onStateChange: () => {
        // Volontairement vide : `onStateChange` ne porte aucune identité de pair
        // et ne doit plus jamais écrire un palier sur TOUS les pairs « connecting ».
      },
      onPeerConnectionState: (peerId, connectionState) => {
        applyPeerConnectionState(link, peerId, connectionState);
      },
      onLive: () => {
        if (current === null || session !== current) return;
        current.live = true;
        publish({ status: 'live', error: null });
        if (current.want) applyTransmit(current, true);
        startMeter(current);
      },
      onError: (error: unknown) => {
        const failed = current;
        if (failed !== null) {
          failed.live = false;
          if (session === failed) session = null;
          stopMeter(failed);
          failed.link.sinks.clear();
          failed.wire.close();
        }
        publish({
          status: 'unavailable',
          error: describeError(error),
          level: 0,
          transmitting: false,
          peers: [],
        });
      },
      onDiagnostic: (line) => {
        // Trace locale seulement : aucun envoi réseau (règle « aucune sortie hors LAN »).
        console.debug(`[voice-mesh] ${line}`);
      },
    });
  } catch (error) {
    link.sinks.clear();
    publish({ status: 'unavailable', error: describeError(error), level: 0, transmitting: false });
    return;
  }

  const created: VoiceSession = {
    key,
    wire,
    link,
    frame: null,
    live: false,
    want: false,
    speech: createPeerSpeechTracker(),
    selfId: localId,
    relay: createSpeakingRelay(),
  };
  current = created;
  // Enregistré AVANT l'attente du micro : deux appels concurrents voient la même instance, et un
  // second `openVoice` sur la même clé ne crée pas un second maillage (SPEC-009 §1(d)).
  session = created;

  // Micro refusé : `onError` a déjà publié `unavailable` et fermé le câblage. Rien à ajouter ici.
  void wire.start();
}

/** Push-to-talk réel : ouvre/ferme la piste. Sans plan média, rien n'est prétendu. */
export function setTransmitting(active: boolean): void {
  const current = session;
  if (current === null) {
    publish({ transmitting: false });
    return;
  }
  const applied = applyTransmit(current, active);
  publish({ transmitting: applied ? active : snapshot.transmitting });
}

/** Lecture directe, hors React (diagnostic, tests de fumée). */
export function voiceSnapshot(): VoiceSnapshot {
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): VoiceSnapshot {
  return snapshot;
}

export interface UseVoicePlaneOptions {
  /** Faux hors salon : aucune instance n'est créée dans le hall d'accueil. */
  readonly enabled: boolean;
  /** Identité locale (SPEC-001) : nomme la piste et la clé d'instance. */
  readonly localId: string;
  /** Salon courant ; `null` hors salon. */
  readonly roomId: string | null;
  /** Intention de transmission issue de l'état de contrôle partagé (PTT local ou raccourci global). */
  readonly wantTransmit: boolean;
  /**
   * Phase du salon (`RoomPhase`, SPEC-001). Sert à UNE chose, SPEC-009 §1(e) : `retrying`
   * détruit la session (le mesh ne survit pas à la reconnexion), le retour en `connected` en
   * reconstruit une. Absente ⇒ la session suit seulement la clé, comme avant T16d.
   */
  readonly phase?: RoomPhase;
}

/**
 * Hook React : crée le plan média à l'entrée en salon, le détruit au départ, suit `level()` et
 * applique l'intention de transmission. Le rendu ne dépend que de `VoiceSnapshot`.
 */
export function useVoicePlane(options: UseVoicePlaneOptions): VoiceSnapshot {
  const { enabled, localId, roomId, wantTransmit, phase } = options;
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // (1) La SESSION suit la clé, pas la phase : une reconnexion ne doit pas fermer/rouvrir en
  // boucle, et `openVoice` est idempotent par clé (au plus un maillage par salon).
  useEffect(() => {
    if (!enabled || roomId === null) return;
    openVoice(`${roomId}|${localId}`, localId);
    return () => {
      closeVoice();
    };
  }, [enabled, roomId, localId]);

  // (2) SPEC-009 §1(e) : `retrying` tue le mesh (et le plan) ; le retour en `connected` en
  // reconstruit un seul. Hors de ces deux phases, cet effet ne touche à rien.
  useEffect(() => {
    if (!enabled || roomId === null) return;
    if (phase === 'retrying' || phase === 'failed') {
      suspendVoice();
      return;
    }
    if (phase === 'connected') openVoice(`${roomId}|${localId}`, localId);
  }, [enabled, roomId, localId, phase]);

  useEffect(() => {
    if (!enabled || roomId === null) return;
    setTransmitting(wantTransmit);
  }, [enabled, roomId, wantTransmit]);

  return current;
}

/** Résumé lisible d'un instantané, pour l'interface et les journaux de diagnostic. */
export function describeVoice(snap: VoiceSnapshot): string {
  switch (snap.status) {
    case 'live':
      return snap.transmitting ? 'micro ouvert (PTT)' : 'micro fermé';
    case 'starting':
      return 'ouverture du micro…';
    case 'unavailable':
      return `voix indisponible : ${snap.error ?? 'cause inconnue'}`;
    case 'idle':
      return 'hors salon';
    default:
      return 'état inconnu';
  }
}
