/**
 * src/engine/rtc/voice-chain.ts — la chaîne de voix (le filtre inséré dans le chemin micro)
 *
 * AJOUT 2026-11-03 (filtres vocaux, demande JC). `voice-filters.ts` décide (recettes pures),
 * `renderer/voice-filter.ts` fabrique (nœuds Web Audio), et CE module est le CHÂSSIS : il
 * possède le cycle de vie du filtre branché sur la piste micro, et n'adresse aux pairs QUE la
 * piste de la destination filtrée.
 *
 *   getUserMedia ──► voice chain (voice-filter.ts) ──► destination ──► localTrack ──► replaceTrack
 *
 * Le châssis garantit trois choses, toutes falsifiables sans Chromium :
 *   1. UNE destination à la fois. Ouvrir le micro deux fois ne superpose pas deux graphes :
 *      l'ancienne chaîne est FERMÉE avant que la nouvelle ne vive.
 *   2. La panne du filtre ne tue pas la session. Si la fabrication du graphe lève (page sans
 *      `AudioWorklet` + voix à hauteur, contexte capricieux), la piste MICRO BRUTE est rendue
 *      et l'échec est TRACÉ. Une voix refusée est un réglage qui n'a pas pris ; une session
 *      muette est une panne.
 *   3. `apply(id)` rend TOUJOURS une piste licite : la chaîne est recreée sur la MÊME
 *      destination (la piste des pairs ne change jamais d'identité — `replaceTrack` n'est
 *      appelé qu'à l'ouverture du micro, jamais au changement de voix).
 *
 * Aucun import navigateur ici : le constructeur de chaîne est INJECTÉ (la même convention que
 * `meterSource` de `media-plane.ts` — la production passe `createVoiceFilterChain` du renderer,
 * les tests passent une chaîne doublure). C'est ce qui garde ce fichier dans le périmètre pur
 * du garde-fou `engine-purity`.
 */

import type { VoiceFilterId } from './voice-filters.ts'

/**
 * Ce que le châssis attend d'une chaîne de filtres (la forme rendue par
 * `renderer/voice-filter.ts`, réduite au strict nécessaire du cycle de vie).
 */
export interface VoiceChainLike {
  /** La piste à envoyer aux pairs (celle de la destination filtrée). */
  readonly track: MediaStreamTrack
  /** La voix réellement appliquée (celle du graphe qui vit, pas une intention). */
  readonly current: VoiceFilterId
  /** Applique une voix (détruit l'ancien graphe, monte le nouveau). Rend la piste des pairs. */
  applyFilter(id: VoiceFilterId): MediaStreamTrack
  /**
   * Ouvre ou ferme l'émission par un GAIN, sans toucher `track.enabled`.
   * Absent = la chaîne ne sait pas (repli : le plan coupe la piste).
   */
  setSendOpen?(open: boolean): void
  /** Débranche tout. Idempotent. */
  close(): void
}

/**
 * Le contexte audio porté au constructeur — un OPAQUE pour le châssis. Le châssis ne fabrique
 * aucun nœud : il ne fait que transmettre l'horloge de la page (le `AudioContext` du plan média,
 * créé et reprise par lui) à qui sait fabriquer le graphe. C'est un `unknown` NOMMÉ : nommer
 * ses méthodes dupliquerait le contrat de `renderer/voice-filter.ts` dans le moteur, et le
 * rendre structurel (une facette) créerait un type que le vrai `AudioContext` ne satisfait pas.
 * Le constructeur du renderer est le seul à le reconstruire en `FilterAudioContext` — la
 * fabrication est son métier, pas celui du châssis.
 */
export type FilterAudioContextLike = unknown

/**
 * Le constructeur injecté : « construis une chaîne pour CE contexte, CE flux, CETTE voix ».
 * `undefined` (la production l'omet quand la page ne sait pas filtrer — ou un test qui veut
 * éprouver le repli) = pas de filtrage du tout : la piste brute est rendue telle quelle.
 */
export type VoiceChainFactory = (
  context: FilterAudioContextLike,
  stream: MediaStream,
  id: VoiceFilterId,
) => VoiceChainLike

/** Les pièces que le châssis reçoit du plan média (le flux capté, sa piste, le traceur). */
export interface VoiceChainHost {
  readonly stream: MediaStream
  readonly track: MediaStreamTrack
  /** Traceur du plan média (le châssis n'a pas de console à lui). */
  warn(message: string): void
  /**
   * L'horloge de la page portée au constructeur (le `AudioContext` du plan média). Optionnelle
   * parce que `buildChain` l'est : sans constructeur, aucun contexte n'est transmis (la voie
   * historique du test et de la page sans filtrage passe les DEUX absents).
   */
  readonly context?: FilterAudioContextLike
  /** Le constructeur de chaîne (la production : `createVoiceFilterChain` du renderer). */
  readonly buildChain?: VoiceChainFactory
}

/**
 * Le châssis de filtre d'un plan média : `open` au démarrage du micro, `apply` au changement
 * de réglage, `close` à la fermeture. Un seul exemplaire par plan média.
 */
export interface VoiceChainHostHandle {
  /**
   * Ouvre la chaîne sur le flux capté et rend la piste à envoyer aux pairs : la piste filtrée
   * quand la chaîne vit, la piste BRUTE quand elle est absente ou a levé (tracé, jamais muet).
   */
  open(id: VoiceFilterId): MediaStreamTrack
  /** Change de voix en vol ; rend la piste des pairs (stable), ou `null` si rien n'est ouvert. */
  apply(id: VoiceFilterId): MediaStreamTrack | null
  /** La voix réellement appliquée (`null` = aucune chaîne ouverte). */
  current(): VoiceFilterId | null
  /**
   * Demande au gain d'émission d'ouvrir ou de fermer. `false` = la chaîne n'a
   * pas de gain (le plan doit couper `track.enabled`, repli historique).
   */
  setSendOpen(open: boolean): boolean
  /** Ferme la chaîne (aucune piste n'est arrêtée : le flux appartient au plan média). */
  close(): void
}

/**
 * Construit le châssis de voix d'un plan média.
 *
 * @param host le flux capté, sa piste, et le constructeur de chaîne injecté
 */
export function createVoiceChainHost(host: VoiceChainHost): VoiceChainHostHandle {
  let chain: VoiceChainLike | null = null
  // Bug « deux clics pour activer un filtre » (rapporte par JC, 2026-11-04) : un clic qui tombe
  // AVANT l'ouverture de la chaine (le micro est en cours — `startMicrophone` est asynchrone,
  // le clic arrive pendant l'entree en salon) etait PERDU : `apply` rendait `null`, la chaine
  // s'ouvrait ensuite avec la voix d'ouverture, et il fallait re-cliquer. La demande est
  // MEMORISEE et appliquee a l'ouverture.
  let pending: VoiceFilterId | null = null

  function open(id: VoiceFilterId): MediaStreamTrack {
    // Clic avant ouverture : la demande memorisee primer sur la voix d'ouverture (le geste le
    // plus recent gagne). La reinitialiser ici (et pas seulement dans le try) garantit qu'une
    // PANNE de filtre ne rejoue pas la demande sur la piste brute au prochain open().
    const wanted: VoiceFilterId = pending ?? id
    pending = null
    // Une chaîne ouverte est FERMÉE avant la suivante : deux graphes sur le même flux
    // superposeraient deux voix aux pairs (le défaut jumeau du double analyseur).
    if (chain !== null) {
      try {
        chain.close()
      } catch (error) {
        host.warn(`ancienne chaîne vocale non refermée proprement : ${String(error)}`)
      }
      chain = null
    }
    if (host.buildChain === undefined) {
      // Pas de constructeur (page sans chaîne de filtres) : la voix historique, piste brute.
      return host.track
    }
    try {
      const built = host.buildChain(host.context, host.stream, wanted)
      chain = built
      // Si le constructeur a rendu une autre voix que la demande (garde interne), on applique
      // la demande explicite pour rester fidele au clic.
      if (built.current !== wanted) built.applyFilter(wanted)
      return built.track
    } catch (error) {
      // La panne du FILTRE n'éteint pas la session : micro brut + trace explicite.
      chain = null
      host.warn(
        `filtre vocal « ${id} » indisponible (${String(error)}) — voix brute envoyée aux pairs`,
      )
      return host.track
    }
  }

  return {
    open,
    apply(id: VoiceFilterId): MediaStreamTrack | null {
      if (chain === null) {
        // Chaine pas encore ouverte (micro en cours) : la demande est memorisee, pas perdue —
        // `open()` l'appliquera. Un seul clic suffit, dans tous les cas.
        pending = id
        return null
      }
      pending = null
      try {
        return chain.applyFilter(id)
      } catch (error) {
        // Même garantie qu'à l'ouverture : une voix refusée reste une voix brute, pas un silence.
        host.warn(
          `filtre vocal « ${id} » refusé en vol (${String(error)}) — voix brute envoyée aux pairs`,
        )
        return host.track
      }
    },
    current(): VoiceFilterId | null {
      return chain === null ? null : chain.current
    },
    setSendOpen(open: boolean): boolean {
      if (chain === null || typeof chain.setSendOpen !== 'function') return false
      chain.setSendOpen(open)
      return true
    },
    close(): void {
      if (chain === null) return
      try {
        chain.close()
      } catch (error) {
        host.warn(`chaîne vocale non refermée proprement : ${String(error)}`)
      }
      chain = null
    },
  }
}
