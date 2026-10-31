/**
 * participant-state.ts — d'où vient l'état affiché sur un participant (T18, révisé T20 / AD-17).
 *
 * Module pur (aucun React, aucun DOM) pour être exécutable en `node --test` : c'est la seule
 * façon de falsifier ici les règles d'honnêteté de l'affichage, faute de React installable.
 *
 * Règle 1 — parole d'un pair : elle ne vient NI de l'annuaire NI de la signalisation.
 * `ParticipantDto` n'a pas à porter `speaking` (AD-17 D2) : le main n'a aucun audio, il ne peut
 * qu'écrire `speaking: false`, c'est-à-dire affirmer un silence qu'il ne mesure pas. La seule
 * source est le plan média du renderer (`level(peerId)`, AD-17 D4). On ne lit donc que la table
 * d'échantillons par pair, avec deux gardes :
 *   — aucun échantillon pour cet id ⇒ `unknown` (jamais « silencieux ») ;
 *   — dernier échantillon plus vieux que `SPEAKING_STALE_MS` (250 ms, AD-17 D6) ⇒ `unknown`.
 * Le verdict `true`/`false` n'est PAS recalculé ici : il vient de `speakingFromLevel`
 * (`src/engine/vad.ts`, AD-17 D5), seule définition de « parle ». Un second seuil serait une
 * deuxième opinion sur le même son — l'émetteur et le halo pourraient se contredire.
 *
 * Règle 2 — mute/déafen : `room-bridge` ne les écrit que pour soi-même (`updateSelf`), la présence
 * ne les transporte pas d'un pair. Sur la ligne d'un pair : `unknown`, et pas de libellé « Muet ».
 */

import type { ParticipantDto } from '../shell/ipc-contract';

/** Attribut ternaire : on n'écrit jamais un `false` qui affirmerait ce qu'on ne mesure pas. */
export type Tri = 'true' | 'false' | 'unknown';

/**
 * Péremption d'un état de parole distant (AD-17 D6). 250 ms ≈ deux trames de relâche + marge :
 * en dessous on clignote, au-delà on affirme un silence qu'on ne mesure plus.
 */
export const SPEAKING_STALE_MS = 250;

/** Un échantillon de parole distante, tel que le plan média l'a rendu. */
export interface PeerSpeakingSample {
  /** Verdict de `speakingFromLevel` ; `'unknown'` quand `level(peerId)` a rendu `null`. */
  readonly speaks: Tri;
  /** Horodatage de la mesure, sur l'horloge du renderer (`performance.now()`). */
  readonly at: number;
}

/** Table des échantillons par `peerId`. Aucune entrée ⇒ personne n'est mesuré. */
export type PeerSpeakingTable = ReadonlyMap<string, PeerSpeakingSample>;

/**
 * Table VIVANTE des mesures par pair — une seule, lue directement par le rendu.
 *
 * Elle est vide aujourd'hui, et vide est la vérité mesurée, pas un bouchon :
 * `media-plane.level()` (media-plane.ts:354) fait un RMS maximum sur TOUS les analyseurs
 * confondus et `onRemoteStream(stream)` ne porte pas de `peerId` — aucun niveau n'est attribuable
 * à un pair avant AD-17 D3/D4 (Carillon). Tant que c'est le cas, `peerSpeaking` rend `unknown`.
 *
 * Le jour où `level(peerId)` existe, `voice.ts` écrit ici à chaque échantillon : le rendu
 * (Room.tsx, Overlay.tsx) n'a pas une ligne à changer, la péremption de 250 ms fait retomber à
 * `unknown` tout pair dont l'audio s'arrête.
 */
export const PEER_LEVELS: Map<string, PeerSpeakingSample> = new Map();

/**
 * Parole affichée pour un pair (`voice.peers`, et chaque avatar d'overlay).
 *
 * @param peerId id du pair (id de signalisation ou id de participant : c'est le même espace).
 * @param samples table des mesures du plan média.
 * @param now horloge de rendu, même origine que `PeerSpeakingSample.at`.
 */
export function peerSpeaking(peerId: string, samples: PeerSpeakingTable, now: number): Tri {
  const sample = samples.get(peerId);
  if (sample === undefined) return 'unknown';
  const age = now - sample.at;
  // Horodatage dans le futur (horloge incohérente) : on ne sait pas, on ne devine pas.
  if (!Number.isFinite(age) || age < 0 || age > SPEAKING_STALE_MS) return 'unknown';
  return sample.speaks;
}

/**
 * Parole de soi-même : mesurée dans CE renderer (`level()` local), donc connue seulement quand le
 * plan média tourne réellement. Un plan média absent n'est pas un silence : c'est `unknown`.
 */
export function selfSpeakingAttr(live: boolean, speaks: boolean): Tri {
  if (!live) return 'unknown';
  return speaks ? 'true' : 'false';
}

/**
 * `data-muted` d'une ligne de participant : `unknown` pour un pair, valeur réelle pour soi-même.
 * À lever le jour où la présence transporte `muted` : il suffira alors de rendre
 * `participant.muted ? 'true' : 'false'` pour tout le monde.
 */
export function mutedAttr(participant: ParticipantDto, selfId: string | null): Tri {
  if (participant.id !== selfId) return 'unknown';
  return participant.muted ? 'true' : 'false';
}

/**
 * Vrai si le libellé « Muet » / « Sourdine » peut être affiché sur cette ligne : seulement pour
 * soi-même, seul cas où le drapeau est réellement connu.
 */
export function selfFlagKnown(participant: ParticipantDto, selfId: string | null): boolean {
  return participant.id === selfId;
}

/** Assemble « Muet · Sourdine · Parle · ICE… » sans laisser un séparateur orphelin. */
export function joinStates(parts: readonly (string | null)[]): string {
  return parts.filter((part): part is string => part !== null).join(' · ');
}
