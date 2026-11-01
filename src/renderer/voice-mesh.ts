/**
 * voice-mesh.ts — la couture entre la coquille et le maillage (T16d / SPEC-009).
 *
 * Ce module ne connaît ni React, ni `window`, ni le DOM : il ne fait que SÉQUENCER et ROUTER.
 * `voice.ts` garde l'état d'interface ; lui garde la machine d'état du tuyau. Cette séparation
 * existe pour une raison mesurable : les six tests de SPEC-009 §3 doivent pouvoir rejouer la
 * séquence réelle (micro → mesh → tampon vidé) hors Chromium, avec un faux `getUserMedia`.
 *
 * Les cinq coutures de SPEC-009 §1, tenues ici et nulle part ailleurs :
 *
 *   (a) ORDRE — abonnement IPC posé TÔT mais en mode TAMPON, puis
 *       `startMicrophone()` → `createMesh()` → tampon vidé dans l'ordre d'arrivée.
 *       Aucun message n'est routé vers un mesh qui n'existe pas : il attend son tour.
 *   (b) ICE — le maillage est SEUL propriétaire. Depuis T17 / AD-16, `createMediaPlane` reçoit
 *       `onLocalCandidate(peerId, candidate)` : chaque candidat local part vers
 *       `mesh.onLocalCandidate(peerId, …)` — AVEC son pair émetteur, jamais en diffusion
 *       (un candidat sans destinataire est tracé et compté par le maillage, DÉFAUT-D). La
 *       coquille ne construit AUCUN message de signalisation : elle ne fait que transmettre.
 *       Les candidats hérités sans destinataire sont purgés, jamais rejoués (`purged: N`).
 *   (c) `handleSignal` (côté `voice.ts`) reste le bookkeeping d'interface : il est appelé pour
 *       CHAQUE message, tamponné ou non — `onMessage` ci-dessous. Un seul point d'entrée.
 *   (d) `close()` ferme le mesh AVANT le plan : le mesh ferme les `RTCPeerConnection` qu'il a
 *       ouvertes (`mesh.close()` appelle `plane.close()` — contrat gelé de `mesh.ts`), puis la
 *       coquille referme le plan (idempotent, cf. `media-plane.close()`).
 *   (e) `close()` est aussi le geste de reconnexion : le mesh ne survit pas à `retrying`, et
 *       `voice.ts` en reconstruit un (nouveau plan, nouveau micro) au retour en `connected`.
 *
 *   (f) FLUX — depuis AD-17 / D3, `createMediaPlane` reçoit `onRemoteStream(peerId, stream)` :
 *       le plan média est le seul à savoir de quelle `RTCPeerConnection` vient la piste, donc
 *       le seul à pouvoir la nommer. Le flux passe par `mesh.onRemoteStream(peerId, stream)`,
 *       qui refuse tout pair sans lien ouvert (compté et tracé : `unattributed: N`), puis
 *       arrive dans `voice.ts` DÉJÀ étiqueté. Un flux antérieur à `createMesh` est compté de
 *       la même façon : il n'existe plus de chemin qui rattache un flux au premier pair venu.
 *
 * Ce que ce module NE peut pas faire : deviner. Il n'ouvre aucune session, ne choisit aucun
 * pair et n'écrit aucun message de signalisation — les deux entrées (`onLocalCandidate`,
 * `onRemoteStream`) exigent un `peerId` que seul le plan média connaît, et le maillage
 * n'accepte que les pairs qu'il a lui-même ouverts.
 */

import { browserTimers } from './browser-timers.ts';
import { createMediaPlane, type MediaPlane } from '../engine/rtc/media-plane.ts';
import { createMesh, type Mesh, type SignalIn, type SignalOut } from '../engine/net/mesh.ts';
import type { MeshPeerState, PeerStateCause } from '../engine/net/mesh.ts';

/**
 * Paliers et causes publiés par le maillage : RECOPIÉS depuis `mesh.ts`, jamais
 * redéclarés — une seule source de vocabulaire (T17). Depuis AD-16 le maillage nomme
 * aussi `noFlow` (horloge des 5 s, SPEC-008 §1) ; `speaking` reste à l'interface.
 */
export type { MeshPeerState, PeerStateCause } from '../engine/net/mesh.ts';

export interface VoiceWiringOptions {
  readonly localId: string;
  /** Tuyau sortant (IPC `sendSignal`) : le mesh n'écrit jamais ailleurs. */
  readonly send: (message: SignalOut) => void;
  /** Abonnement au tuyau entrant, posé à la construction. `null` = preload absent. */
  readonly subscribe: (handler: (message: SignalIn) => void) => (() => void) | null;
  /** Bookkeeping d'interface (ex-`handleSignal`) : appelé pour chaque message, même tamponné. */
  readonly onMessage: (message: SignalIn) => void;
  /**
   * Palier de lien par pair, décidé par le mesh, AVEC sa cause (T17) : `'ice'` pour une
   * négociation ou un échec de connexion, `'timeout'` pour l'horloge des 5 s. La cause
   * est obligatoire — c'est elle qui distingue « échec » de « délai dépassé » (DÉFAUT-E).
   */
  readonly onPeerState: (peerId: string, state: MeshPeerState, cause: PeerStateCause) => void;
  /**
   * Flux distant d'un pair CONNU, avec son identité (AD-17 / D3). Le pair vient du plan
   * média (seul témoin de la `RTCPeerConnection`) et le maillage refuse de transmettre un
   * flux dont il ne connaît pas le lien : l'appelant n'a donc plus rien à deviner.
   */
  readonly onRemoteStream: (peerId: string, stream: MediaStream) => void;
  /** `connectionState` brut de la `RTCPeerConnection` — la seule source d'échec ICE réel. */
  readonly onStateChange: (connectionState: string) => void;
  /**
   * État de connexion AVEC son pair (défaut (b), SPEC-008 §1) : le plan média est
   * seul à savoir de quelle `RTCPeerConnection` vient le changement. La coquille
   * ROUTE celui-là (`failed` ne touche que son pair, `connected` ne promeut que
   * son pair) ; `onStateChange` reste émis pour la fréquence globale, mais ne
   * doit plus décider de l'état d'un pair tout seul.
   */
  readonly onPeerConnectionState: (peerId: string, connectionState: string) => void;
  /** Micro ouvert ET mesh en place : l'interface peut dire « live ». */
  readonly onLive: (plane: MediaPlane) => void;
  readonly onError: (error: unknown) => void;
  /** Trace lisible (une ligne = un geste). Aucun texte d'interface n'en dépend. */
  readonly onDiagnostic?: (line: string) => void;
  /**
   * Candidats hérités de l'ancien chemin `onLocalCandidate` (SPEC-009 §1(b)).
   * La production n'en fournit AUCUN — la source a été supprimée. Le champ existe pour que la
   * purge soit mesurable (T6) et pour qu'une réintroduction accidentelle d'une source de
   * candidats sans destinataire soit comptée au lieu d'être diffusée.
   */
  readonly earlyCandidates?: readonly RTCIceCandidateInit[];
}

export interface VoiceWiring {
  /** Le plan média de la session : `setTransmitting`, `level`, `stats`. */
  readonly plane: MediaPlane;
  /** Micro puis mesh puis vidage du tampon. `false` = micro refusé (rien n'est prétendu vivant). */
  start(): Promise<boolean>;
  /** Point d'entrée unique du tuyau : bookkeeping, puis tampon ou routage. */
  onSignal(message: SignalIn): void;
  /** Ferme mesh puis plan. Idempotent. */
  close(): void;
  /** Vrai tant qu'un mesh vit : la coquille peut le constater sans le toucher. */
  readonly meshAlive: boolean;
  /**
   * Ids des pairs du maillage, triés, sans doublon — même espace d'ids que la signalisation.
   * C'est la liste que la mesure de parole distante doit parcourir (AD-17 D4) : elle vient du
   * maillage, qui sait qui est là, pas de l'annuaire, qui ne sait que ce qu'on lui a dit.
   */
  peers(): readonly string[];
  /**
   * Preuve de flux par le niveau mesuré (défaut (c), SPEC-008 §1) : la coquille
   * appelle ici quand `plane.level(peerId)` a rendu un NOMBRE (jamais `null`).
   * Le maillage désarme alors l'horloge des 5 s et dit `connected` — l'échange de
   * SDP seul ne suffisait plus.
   */
  reportFlow(peerId: string): void;
  /** Messages tamponnés en attente d'un mesh (0 hors fenêtre d'ouverture du micro). */
  readonly buffered: number;
}

export function createVoiceWiring(options: VoiceWiringOptions): VoiceWiring {
  const trace = (line: string): void => {
    options.onDiagnostic?.(line);
  };

  // Aucun `rtcConfig` : `iceServers: []` est imposé par `lanOnlyConfiguration(undefined)`.
  // T17 / AD-16 : le maillage est seul propriétaire de l'ICE, et c'est donc lui qui reçoit
  // les candidats locaux — AVEC le pair émetteur, que le plan média porte désormais.
  // Sans destinataire identifié, le maillage trace et compte, il ne diffuse jamais (DÉFAUT-D).
  // AD-17 / T17 : les deux horloges du moteur (plafond ICE 1 s, noFlow 5 s) sont INJECTÉES.
  // SPEC-004 §3 interdit les timers dans `src/engine/**` ; c'est ici, dans la page, qu'elles
  // existent vraiment. Une seule instance, deux consommateurs : une horloge par moteur.
  const timers = browserTimers();
  const plane: MediaPlane = createMediaPlane({
    localId: options.localId,
    timers,
    onLocalCandidate: (peerId, candidate) => {
      const current = mesh;
      if (current === null) {
        trace(`candidat local pour ${peerId} avant mesh — ignoré (aucun émetteur ouvert)`);
        return;
      }
      current.onLocalCandidate(peerId, candidate);
    },
    onRemoteStream: (peerId, stream) => {
      // (f) même chemin que ICE : le plan média nomme le pair, le maillage décide. Avant
      // `createMesh` il n'y a aucun lien à confronter : le flux est compté, pas attribué.
      const current = mesh;
      if (current === null) {
        unattributedEarly += 1;
        trace(`flux de ${peerId} avant mesh — ignoré (unattributed: ${unattributedEarly})`);
        return;
      }
      current.onRemoteStream(peerId, stream);
    },
    onStateChange: ({ connectionState }) => {
      options.onStateChange(String(connectionState));
    },
    // Défaut (b) : le même événement, porté par l'identité du pair. C'est par ici
    // que la coquille route — plus jamais « l'état s'applique à tous les connecting ».
    onPeerConnectionState: (peerId, state) => {
      options.onPeerConnectionState(peerId, String(state));
    },
  });

  const earlyCandidates: RTCIceCandidateInit[] = [...(options.earlyCandidates ?? [])];
  const queue: SignalIn[] = [];

  let mesh: Mesh | null = null;
  /** Flux arrivés avant `createMesh` : comptés et tracés, jamais rattachés au premier pair. */
  let unattributedEarly = 0;
  let unsubscribe: (() => void) | null = null;
  let started = false;
  let closed = false;

  function route(message: SignalIn, current: Mesh): void {
    // `Mesh.onSignal` ne rejette jamais (contrat) ; la garde couvre une promesse non gérée.
    void current.onSignal(message).catch((error: unknown) => {
      trace(`signal:échec ${message.kind} — ${String(error)}`);
    });
  }

  function receive(message: SignalIn): void {
    // (c) bookkeeping d'interface AVANT tout routage : l'écran ne dépend pas de l'état du mesh.
    options.onMessage(message);
    if (closed) return;
    if (mesh === null) {
      // (a) pas de mesh ⇒ pas de route : le message attend son tour, il n'est jamais perdu.
      queue.push(message);
      return;
    }
    route(message, mesh);
  }

  async function start(): Promise<boolean> {
    if (started || closed) return started && !closed;
    started = true;

    try {
      await plane.startMicrophone();
    } catch (error) {
      trace('micro:échec');
      options.onError(error);
      return false;
    }
    if (closed) return false;

    // (b) Purge assumée des candidats précoces : un candidat sans destinataire est inroutable.
    // Il n'est PAS rejoué sur le premier pair venu (ce serait offrir un candidat à un inconnu).
    const purged = earlyCandidates.length;
    earlyCandidates.length = 0;
    trace(`ice sans destinataire — purged: ${purged}`);

    const created = createMesh({
      localId: options.localId,
      plane,
      // Sans ce champ, `tsc` refuse : l'horloge des 5 s (noFlow) ne peut pas s'oublier.
      timers,
      send: (message) => {
        options.send(message);
      },
      onPeerState: (peerId, state, cause) => {
        options.onPeerState(peerId, state, cause);
      },
      onRemoteStream: (peerId, stream) => {
        options.onRemoteStream(peerId, stream);
      },
    });
    mesh = created;
    trace('mesh:ouvert');
    options.onLive(plane);

    // (a) Le tampon est vidé JUSTE APRÈS `createMesh`, dans l'ordre d'arrivée, une seule fois,
    // séquentiellement : le mesh voit les messages dans l'ordre où le tuyau les a donnés.
    const pending = queue.splice(0, queue.length);
    for (const message of pending) {
      if (closed || mesh !== created) break;
      try {
        await created.onSignal(message);
      } catch (error) {
        trace(`tampon:échec ${message.kind} — ${String(error)}`);
      }
    }
    trace(`tampon:vidé ${pending.length}`);
    return true;
  }

  function close(): void {
    if (closed) return;
    closed = true;

    const stop = unsubscribe;
    unsubscribe = null;
    if (stop !== null) {
      try {
        stop();
      } catch {
        // Un désabonnement qui échoue ne doit pas empêcher la fermeture du maillage.
      }
    }
    queue.length = 0;

    const current = mesh;
    mesh = null;
    if (current !== null) {
      // (d) Le mesh d'abord : c'est lui qui possède et ferme les `RTCPeerConnection`.
      trace('fermeture:mesh');
      try {
        current.close();
      } catch {
        // `mesh.close()` ne rejette pas ; une exception ici ne doit pas laisser le plan ouvert.
      }
    }
    trace('fermeture:plan');
    try {
      plane.close();
    } catch {
      // Fermeture best-effort : l'état publié par l'appelant ne prétendra rien de vivant.
    }
  }

  // (a) Abonnement POSÉ TÔT — le tuyau peut parler avant que le micro ne soit ouvert — mais en
  // mode tampon tant que le mesh n'existe pas.
  try {
    unsubscribe = options.subscribe(receive);
  } catch {
    unsubscribe = null;
  }

  return {
    plane,
    start,
    onSignal: receive,
    close,
    get meshAlive(): boolean {
      return mesh !== null && !closed;
    },
    peers(): readonly string[] {
      // Hors mesh (avant `start()`, après `close()`), personne n'est mesuré : liste vide, pas
      // une liste d'ids supposés.
      if (mesh === null || closed) return [];
      return mesh.peers();
    },
    reportFlow(peerId: string): void {
      // Hors mesh, aucune preuve n'a de destinataire : le maillage est seul à tenir
      // l'horloge des 5 s, donc seul à pouvoir la désarmer.
      const current = mesh;
      if (current === null || closed) return;
      current.reportFlow(peerId);
    },
    get buffered(): number {
      return queue.length;
    },
  };
}
