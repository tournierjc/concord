/**
 * peer-speech.ts — ACQUISITION de la parole distante (T21 / AD-17 D4-D6, AD-19 D2, R-U8).
 *
 * `participant-state.ts` répond à « qu'a-t-on le droit d'afficher ». Ce module-ci répond à
 * « qu'a-t-on réellement mesuré » : c'est le producteur de la table. Les séparer est ce qui
 * empêche de rejouer DÉFAUT-C une troisième fois — un canal ou une table sans producteur finit
 * toujours par affirmer un silence.
 *
 * Quatre règles, toutes falsifiables (`tests/peer-speech.test.ts`) :
 *
 *   1. `plane.level(peerId)` rend un RMS par pair ou `null`. `null` n'écrit RIEN : aucune entrée
 *      vaut `'unknown'` à l'affichage, jamais `'false'`. Une absence de mesure n'est pas une
 *      mesure de silence.
 *   2. Le verdict n'est pas un second seuil : c'est le même que celui de l'émetteur.
 *      `speakingFromLevel` (`src/engine/vad.ts`, hystérésis −38/−45) décide de la PORTE, le niveau
 *      mesuré contre ce même seuil d'ouverture décide de l'ANCRE de la tenue. Le rendu, lui, n'a
 *      aucun seuil à lui.
 *   3. La TENUE (`SPEAKING_HOLD_MS`) est appliquée ici, pas dans le rendu : une pause inter-mot de
 *      400 ms ne doit pas éteindre le halo, et l'extinction doit arriver 600 ms après la dernière
 *      syllabe, ni plus tôt ni plus tard (R-U8 §2). La valeur écrite reste un booléen : `'true'`
 *      pendant la tenue, puis `'false'` — le rendu ne tient aucun compte.
 *   3 bis. L'ANCRE est la dernière trame MESURÉE au-dessus du seuil d'ouverture, pas la dernière
 *      trame où `vad.speaking` est vrai : le relâchement du VAD (6 trames × 50 ms = 300 ms)
 *      s'ajouterait sinon à la tenue et l'extinction tomberait à 900 ms (mesuré, puis corrigé).
 *      Conséquence assumée : l'attaque n'attend pas les deux trames d'hystérésis du VAD — le
 *      signal distant a déjà franchi la porte de l'émetteur — ce que demande AC-U10.1, « à
 *      l'image suivante ».
 *   4. L'ESPACE D'ID est celui du maillage (AD-19 D2). Écrire pour un id absent du maillage est
 *      ignoré (`recordPeerSpeaking` → `'ignored'`), et les entrées orphelines sont effacées au
 *      battement suivant : pas de halo fantôme, et ça se voit dans un test.
 *
 * La péremption d'affichage (`SPEAKING_STALE_MS`, 250 ms) reste l'affaire de `participant-state` :
 * le producteur horodate, il n'expire pas. Aucun DOM, aucun React, horloge injectée.
 */

import {
  DEFAULT_VAD_CONFIG,
  MIN_DBFS,
  createVadState,
  speakingFromLevel,
  type VadConfig,
  type VadState,
} from '../engine/vad.ts';
import { PEER_LEVELS, type PeerSpeakingSample } from './participant-state.ts';

/**
 * Période d'échantillonnage (~20 Hz). Très en dessous de `SPEAKING_STALE_MS` (250 ms) : à
 * 50 ms, quatre battements séparent deux péremptions, donc un pair qui parle ne peut pas
 * s'éteindre entre deux mesures. C'est la contrainte R-U8 §1, et elle est testée.
 */
export const SAMPLE_PERIOD_MS = 50;

/**
 * Tenue de l'état « parle » après la dernière trame parlante (R-U8 §2). 600 ms couvre les pauses
 * inter-mots (400 ms dans le pire cas mesuré) sans traîner : avec la transition CSS de 80 ms, le
 * halo s'éteint 680 ms après la dernière syllabe.
 */
export const SPEAKING_HOLD_MS = 600;

/** Ce que le producteur a besoin de demander au plan média, et rien de plus. */
export interface PeerSpeechProbe {
  /** Pairs connus du maillage (`Mesh.peers()`) : même espace d'ids que la signalisation. */
  readonly peers: readonly string[];
  /** `plane.level(peerId)` : `null` = aucune mesure — jamais `0`, qui dirait « silence mesuré ». */
  level(peerId: string): number | null;
}

export interface PeerSpeechTracker {
  /** Échantillonne tous les pairs ; retourne ceux qui ont réellement été mesurés. */
  sample(probe: PeerSpeechProbe, now: number): readonly string[];
  /** Oublie hystérésis, tenues et échantillons (départ de salon, reconnexion, plan média fermé). */
  reset(): void;
}

/** RMS linéaire (0..1) → dBFS borné à `MIN_DBFS`. Seule conversion du chemin distant. */
export function rmsToDbfs(rms: number, config: VadConfig = DEFAULT_VAD_CONFIG): number {
  if (!Number.isFinite(rms) || rms <= 0) return MIN_DBFS;
  const db = 20 * Math.log10(rms);
  return db < MIN_DBFS ? MIN_DBFS : db;
}

/**
 * L'état affiché, tenue comprise : `speaks` est le dernier verdict brut, `lastSpeakingAt` l'instant
 * de la dernière trame où le pair parlait vraiment.
 *
 * Un pair qui n'a JAMAIS parlé (`lastSpeakingAt === null`) ne bénéficie d'aucune tenue : `'false'`
 * est une mesure, pas un sursis.
 */
export function heldSpeaks(
  speaks: boolean,
  lastSpeakingAt: number | null,
  now: number,
): boolean {
  if (speaks) return true;
  if (lastSpeakingAt === null || !Number.isFinite(now)) return false;
  // Horloge qui recule : la tenue court depuis « maintenant », elle ne court pas après l'horloge.
  if (now < lastSpeakingAt) return true;
  return now - lastSpeakingAt < SPEAKING_HOLD_MS;
}

/**
 * La SEULE porte d'écriture de la table (AD-19 D2 / A6) : un id absent du maillage est ignoré,
 * sans créer de ligne. Une écriture orpheline ne se devine pas, elle se refuse.
 */
export function recordPeerSpeaking(
  samples: Map<string, PeerSpeakingSample>,
  peers: readonly string[],
  peerId: string,
  sample: PeerSpeakingSample,
): 'written' | 'ignored' {
  if (!peers.includes(peerId)) return 'ignored';
  samples.set(peerId, sample);
  return 'written';
}

export function createPeerSpeechTracker(
  samples: Map<string, PeerSpeakingSample> = PEER_LEVELS,
  config: VadConfig = DEFAULT_VAD_CONFIG,
): PeerSpeechTracker {
  /** Un état VAD par pair : l'hystérésis est une mémoire, elle ne se partage pas. */
  const states = new Map<string, VadState>();
  /** Instant de la dernière trame réellement parlante, par pair (base de la tenue). */
  const lastSpeakingAt = new Map<string, number>();

  function forget(peerId: string): void {
    states.delete(peerId);
    lastSpeakingAt.delete(peerId);
    samples.delete(peerId);
  }

  /** Lecture défensive : un analyseur détruit est une absence de mesure, pas une erreur remontée. */
  function readLevel(probe: PeerSpeechProbe, peerId: string): number | null {
    try {
      const value = probe.level(peerId);
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  }

  return {
    sample(probe, now): readonly string[] {
      // Un horodatage non fini n'écrit rien : on ne date pas un échantillon « quelque part ».
      if (!Number.isFinite(now)) return [];
      const measured: string[] = [];

      for (const peerId of probe.peers) {
        const raw = readLevel(probe, peerId);
        if (raw === null) {
          // Perte de mesure : l'entrée part tout de suite. Un `'true'` qui survivrait 600 ms
          // après la perte du flux serait une affirmation sans mesure.
          forget(peerId);
          continue;
        }

        const prev = states.get(peerId) ?? createVadState(config);
        const next = speakingFromLevel(prev, rmsToDbfs(raw, config), config);
        states.set(peerId, next);

        let last = lastSpeakingAt.get(peerId) ?? null;
        if (last !== null && now < last) last = now; // horloge qui recule
        // Ancre de la tenue = dernière trame MESURÉE au-dessus du seuil d'ouverture, pas la
        // dernière trame où `next.speaking` est vrai. Sinon la tenue s'ajoute au relâchement du
        // VAD (`releaseFrames` × 50 ms d'échantillonnage = 300 ms) : extinction mesurée à 900 ms
        // au lieu de 600. Corollaire voulu : l'attaque n'attend pas les 2 trames du VAD, le
        // signal distant a déjà franchi la porte de l'émetteur (R-U8 §2, AC-U10.1).
        if (next.levelDb >= config.openDbfs) last = now;

        const speaks = next.speaking || heldSpeaks(false, last, now);
        if (last === null) lastSpeakingAt.delete(peerId);
        else lastSpeakingAt.set(peerId, last);

        if (recordPeerSpeaking(samples, probe.peers, peerId, { speaks: speaks ? 'true' : 'false', at: now }) === 'written') {
          measured.push(peerId);
        }
      }

      // Ids sortis du maillage — quelle que soit leur origine (nous, une session précédente,
      // un autre écrivain) : la table ne garde que ce que le maillage peut expliquer.
      for (const peerId of new Set([...states.keys(), ...samples.keys()])) {
        if (!probe.peers.includes(peerId)) forget(peerId);
      }
      return measured;
    },
    reset(): void {
      states.clear();
      lastSpeakingAt.clear();
      samples.clear();
    },
  };
}
