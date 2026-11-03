/**
 * src/renderer/voice-filter.ts — la fabrique de voix (le graphe Web Audio des filtres vocaux)
 *
 * AJOUT 2026-11-03 (filtres vocaux, demande JC). Le moteur pur (`engine/rtc/voice-filters.ts`)
 * DÉCIDE : quelle voix, quels nœuds, dans quel ordre, à quelles valeurs. CE module FABRIQUE :
 * il lit une `VoiceFilterRecipe` et monte le graphe réel dans l'`AudioContext` de la page, puis
 * rend une `VoiceFilterChain` — la piste qui part aux pairs.
 *
 *   micro (MediaStreamTrack)
 *     → [pitch-shifter granulaire, si la voix décale la hauteur — voice-pitch.ts]
 *     → recette (gain / filtres / shaper / ring)          ← ce module, guidé par la recette
 *     → destination (MediaStreamAudioDestinationNode) → piste → RTCPeerConnection.replaceTrack
 *
 * Ce que ce module garantit, et pourquoi c'est falsifiable sans Chromium :
 *   • LA VOIX NEUTRE NE CRÉE AUCUN NŒUD. `nodes` vide ⇒ la source est branchée DIRECTEMENT
 *     sur la destination et le pitch est bypassé — le micro historique reste le micro
 *     historique, nœud pour nœud. C'est la non-régression du défaut, mesurée par test.
 *   • La fabrication obéit à la recette et RIEN d'autre : chaque kind de nœud a un
 *     constructeur, un maillon manquant est une ERREUR (jetée, jamais un nœud sauté en
 *     silence — un maillon manquant = une voix fausse prétendue vraie).
 *   • La destination est unique et réutilisée par la session ; changer de voix (`applyFilter`)
 *     détruit l'ANCIEN graphe (nœuds débranchés, oscillateur arrêté) et en monte un nouveau
 *     sur la MÊME destination — `replaceTrack` n'est jamais appelé ici (il appartient au plan
 *     média, seul à connaître les senders).
 *   • Un oscillateur est TOUJOURS arrêté : un oscillateur non arrêté continue de pomper la
 *     page après le changement de voix (fuite CPU invisible).
 *
 * Les types de nœuds sont des CONTRATS DE CONSOMMATEUR (`GainLike`, `FilterLike`, …) écrits du
 * point de vue de la fabrique, comme les ports du moteur (`MeterSource`, `Timers`) : le vrai
 * `AudioContext` du navigateur les satisfait (ses nœuds en sont un sur-ensemble), les doublures
 * de test aussi, et une doublure incomplète ne compile pas. Aucun `as`.
 */

import {
  voiceFilterPitchRatio,
  voiceFilterRecipeFor,
  voiceFilterShiftsPitch,
  type FilterNodeSpec,
  type VoiceFilterId,
} from '../engine/rtc/voice-filters.ts'
import { createPitchShifterNode, type PitchShifterNode } from './voice-pitch.ts'

/** Un nœud que la fabrique sait brancher (le `connect` du DOM accepte nœud OU paramètre). */
export interface FilterNodeLike {
  connect(destination: FilterNodeLike | FilterParamLike): void
  disconnect(): void
}

/** Un paramètre : la cible d'une modulation (le `gain` d'un gain, pour le ring). */
export interface FilterParamLike {
  value: number
  connect(source: FilterNodeLike): void
}

/**
 * Ce que la fabrique UTILISE réellement d'un AudioContext — pas le type DOM entier.
 *
 * Écrit du point de vue du CONSOMMATEUR, comme les ports du moteur : `FakeAudioContext`
 * satisfait ce contrat, le vrai `AudioContext` du navigateur aussi (ses méthodes en sont un
 * sur-ensemble), et une doublure incomplète ne compile pas. Un `as unknown as` aurait caché
 * la dérive — ce que C12-3 interdit.
 */
export interface FilterAudioContext {
  readonly sampleRate: number
  /**
   * Le flux à filtrer, fourni par l'appelant (jamais construit par la fabrique — cf.
   * `FilterStreamLike`).
   */
  createMediaStreamSource(stream: FilterStreamLike): FilterNodeLike
  createMediaStreamDestination(): FilterDestinationLike
  createGain(): GainLike
  createBiquadFilter(): FilterLike
  createWaveShaper(): ShaperLike
  createOscillator(): OscillatorLike
  /**
   * Mesure (facultative, et facultative POURTANT obligatoire pour qui veut un VU-mètre) :
   * le test de micro (`mic-check.ts`) branche un analyseur sur le micro BRUT pour prouver la
   * capture. La fabrique de filtres, elle, ne mesure rien — ses recettes sont sourdes.
   */
  createAnalyser?(): AnalyserLike
  /** Reprise du contexte (un contexte SUSPENDU rend un RMS figé — le piège RMS du repo). */
  resume?(): Promise<void>
  /** Fermeture du contexte. Idempotente côté appelant (le second refus est ignoré). */
  close?(): Promise<void>
}

/** Un analyseur vu de la page : la seule facette de mesure dont `mic-check` a besoin. */
export interface AnalyserLike {
  fftSize: number
  smoothingTimeConstant: number
  getFloatTimeDomainData(destination: Float32Array<ArrayBuffer>): void
}

/** La destination dont la piste part aux pairs (le `stream` est ce que lit `replaceTrack`). */
export interface FilterDestinationLike extends FilterNodeLike {
  readonly stream: FilterStreamLike
}

/**
 * Un flux monopiste vu par la fabrique : ce qu'on lui passe (la piste du micro) et ce qu'elle
 * lit sur la destination. Les deux seuls accès requis : `getAudioTracks` (lire la piste des
 * pairs) et `addTrack` (poser la piste micro sur le flux qu'on lui confie). Le DOM les offre,
 * les doublures aussi — et surtout, la fabrique ne construit JAMAIS le flux elle-même : le
 * constructeur `MediaStream` est un global du navigateur, absent de Node, et une fabrique qui
 * l'appelle meurt en test alors que le graphe, lui, est juste.
 */
export interface FilterStreamLike {
  getAudioTracks(): MediaStreamTrack[]
  addTrack(track: MediaStreamTrack): void
}

/** Un gain : son paramètre `gain` est la cible de la modulation du ring. */
export interface GainLike extends FilterNodeLike {
  readonly gain: FilterParamLike
}

/** Un filtre : ses valeurs sont posées par la recette (type, coupure, Q). */
export interface FilterLike extends FilterNodeLike {
  type: string
  readonly frequency: FilterParamLike
  readonly Q: FilterParamLike
}

/** Un shaper : la courbe de saturation, et son suréchantillonnage. */
export interface ShaperLike extends FilterNodeLike {
  curve: Float32Array | null
  oversample: string
}

/** Une porteuse : à démarrer et à ARRÊTER (un oscillateur qui dure est une fuite). */
export interface OscillatorLike extends FilterNodeLike {
  type: string
  readonly frequency: FilterParamLike
  start(): void
  stop(): void
}

/** Ce que la fabrique rend à la session : de quoi brancher, changer de voix, et tout débrancher. */
export interface VoiceFilterChain {
  /**
   * La voix réellement appliquée (celle de la dernière `applyFilter`). Jamais une intention :
   * ce que le graphe EST.
   */
  readonly current: VoiceFilterId
  /**
   * La piste à envoyer aux pairs (celle de la destination). Stable sur toute la session :
   * changer de voix ne renégocie rien, seul le graphe change.
   */
  readonly track: MediaStreamTrack
  /**
   * Applique une voix : détruit l'ancien graphe, en monte un nouveau sur la même destination,
   * et rend la piste (la même que `track` — c'est la destination qui est stable, pas le graphe).
   */
  applyFilter(id: VoiceFilterId): MediaStreamTrack
  /** Débranche tout (oscillateurs arrêtés, nœuds coupés). Idempotent. */
  close(): void
}

/** Ce qu'un maillon de recette devient une fois monté. */
interface BuiltSpec {
  /** Le nœud qui PARLE à la chaîne (le poids d'un résonateur, pas son filtre). */
  readonly node: FilterNodeLike
  /** Le `gain` réglable du maillon, si son nœud d'entrée en a un (le multiplicateur du ring). */
  readonly gain: FilterParamLike | null
  /** Les oscillateurs du maillon (un seul pour un `oscillator`, aucun pour les autres). */
  readonly oscillators: OscillatorLike[]
  /** TOUS les nœuds créés par le maillon, poids de formant compris — ce qui est débranché. */
  readonly created: FilterNodeLike[]
}

/** Les fabriques de nœuds, par kind — fermées : une recette hors vocabulaire ne compile pas. */
function buildSpec(context: FilterAudioContext, spec: FilterNodeSpec): BuiltSpec {
  if (spec.kind === 'gain') {
    const node = context.createGain()
    // La valeur de BASE n'est posée que si la recette la porte : le gain de modulation, lui,
    // reçoit sa valeur À LA CÂBLURE du ring (`modGain.gain.value = 0.9` plus bas). Une valeur
    // de recette écrasée à la création rendrait le ring muet et invisible en test.
    if (typeof spec.gain === 'number' && spec.modulation !== true) node.gain.value = spec.gain
    return { node, gain: node.gain, oscillators: [], created: [node] }
  }
  if (spec.kind === 'oscillator') {
    const node = context.createOscillator()
    node.type = 'sine'
    if (typeof spec.frequency === 'number') node.frequency.value = spec.frequency
    return { node, gain: null, oscillators: [node], created: [node] }
  }
  if (spec.kind === 'shaper') {
    const node = context.createWaveShaper()
    if (spec.curve !== undefined) {
      const curve = new Float32Array(spec.curve.length)
      for (let i = 0; i < spec.curve.length; i += 1) {
        const point = spec.curve[i]
        if (point !== undefined) curve[i] = point.output
      }
      node.curve = curve
      // Suréchantillonnage : la saturation crée des harmoniques au-delà de Nyquist sans lui
      // (aliasing = un sifflement métallique, pas de la saturation).
      node.oversample = '2x'
    }
    return { node, gain: null, oscillators: [], created: [node] }
  }
  // Les filtres bidimensionnels sont des BiquadFilter avec leur type — la seule différence
  // est le `type` posé, d'où une branche commune. Un `bandpass` AVEC poids passe par
  // `buildResonator` (le poids ne peut pas vivre sur un biquad bandpass, cf. son commentaire).
  if (spec.kind === 'bandpass' && typeof spec.gain === 'number') {
    const filter = context.createBiquadFilter()
    filter.type = spec.kind
    if (typeof spec.cutoffHz === 'number') filter.frequency.value = spec.cutoffHz
    if (typeof spec.q === 'number') filter.Q.value = spec.q
    const weight = context.createGain()
    weight.gain.value = spec.gain
    filter.connect(weight)
    // Le nœud EXPOSÉ du maillon est le poids (c'est lui qui parle à la chaîne) ; le filtre est
    // créé AVANT lui dans `created`, donc débranché APRÈS lui (débranchement à l'envers).
    return { node: weight, gain: null, oscillators: [], created: [weight, filter] }
  }
  const node = context.createBiquadFilter()
  node.type = spec.kind
  if (typeof spec.cutoffHz === 'number') node.frequency.value = spec.cutoffHz
  if (typeof spec.q === 'number') node.Q.value = spec.q
  return { node, gain: null, oscillators: [], created: [node] }
}

/**
 * Le flux MONOPISTE présenté à `createMediaStreamSource` : un objet lecture-seule dont la seule
 * méthode est `getAudioTracks` (la facette `FilterStreamLike`). La fabrique ne construit jamais
 * `new MediaStream(...)` (global navigateur, absent de Node) et n'écrit jamais dans le flux
 * capté (cf. le commentaire de `headOf` — le bug du double clic).
 */
function wrapTrackAsStream(track: MediaStreamTrack): FilterStreamLike {
  return {
    getAudioTracks: () => [track],
    // Le flux présenté à la source n'est JAMAIS un réceptacle : `addTrack` n'y va pas (la
    // fabrique ne l'appelle plus), et un appel qui reviendrait par accident lèverait au lieu
    // de stocker en silence un doublon que les doubles ne verraient pas.
    addTrack: () => {
      throw new Error('[voice-filter] addTrack sur le flux de la source : la fabrique ne doit pas écrire dans le flux (bug du double clic, 2026-11-03)')
    },
  }
}

/**
 * Construit la chaîne de filtrage d'une session.
 *
 * @param context l'AudioContext de la session (celui du plan média — une page, une horloge)
 * @param stream  le flux micro à filtrer (déjà capté, contraintes déjà appliquées) ; la fabrique
 *                en pose la piste sur un flux monopiste interne et n'en construit aucun
 * @param initial la voix appliquée immédiatement (le réglage lu par la coquille)
 */
export function createVoiceFilterChain(
  context: FilterAudioContext,
  stream: FilterStreamLike,
  initial: VoiceFilterId,
): VoiceFilterChain {
  const destination = context.createMediaStreamDestination()
  /**
   * La piste micro, lue UNE fois sur le flux entrant : c'est elle qui entre dans le graphe,
   * et c'est elle que le repli rend si la destination est vide (contexte fermé).
   */
  const source = stream.getAudioTracks()[0]
  /** La source micro, créée UNE fois (le changement de voix ne recrée pas l'entrée). */
  let sourceNode: FilterNodeLike | null = null
  /** Le graphe de l'application courante, à débrancher avant la suivante. */
  let parts: FilterNodeLike[] = []
  let oscillators: OscillatorLike[] = []
  let pitch: PitchShifterNode | null = null
  let applied: VoiceFilterId = 'none'

  /** Débranche le graphe courant : oscillateurs d'abord (un oscillateur non arrêté dure). */
  function unplug(): void {
    for (const osc of oscillators) {
      try {
        osc.stop()
      } catch {
        // Un oscillateur jamais démarré refuse `stop()` : il ne sortira pas du graphe de plus.
      }
      try {
        osc.disconnect()
      } catch {
        // Déjà débranché par le nœud parent : rien de plus à faire.
      }
    }
    for (const node of parts) {
      try {
        node.disconnect()
      } catch {
        // Un nœud déjà coupé ne peut pas en recouper un autre : le débranchement est idempotent.
      }
    }
    if (pitch !== null) {
      pitch.close()
      pitch = null
    }
    parts = []
    oscillators = []
  }

  /**
   * La tête de la chaîne : la source, ou le pitch-shifter si la voix décale la hauteur.
   * Le pitch est en AMONT des filtres : on décale la voix, PUIS on la modèle (l'inverse
   * modulerait une porteuse déjà décalée — un robot dont le vrombissement monterait avec la
   * voix, ce que la recette ne promet pas).
   *
   * La source est créée sur un flux mono-piste en lecture seule (`wrapTrackAsStream`) : jamais
   * sur un flux qu'elle construirait (`new MediaStream` = global navigateur, absent de Node),
   * et jamais en écrivant dans le flux capté (le bug du double clic, cf. `headOf`).
   */
  function headOf(id: VoiceFilterId): FilterNodeLike {
    let entry = sourceNode
    if (entry === null) {
      if (source === undefined) {
        throw new Error('[voice-filter] flux micro sans piste audio : rien à filtrer (bug de flux, pas un réglage)')
      }
      // Le flux capté appartient au plan média : la fabrique le LIT, n'y écrit JAMAIS.
      // (Le bug du double clic, retour JC 2026-11-03 : la fabrique posait la piste micro SUR
      // son propre flux d'entrée avant de créer la source — `stream.addTrack(source)`. Dans le
      // navigateur, la source d'un flux dont la piste a été re-posée en double ses entrées ;
      // au premier clic sur une voix, les deux copies traversaient le filtre en parallèle et
      // se neutralisaient — la voix ne changeait qu'au SECOND clic (débranchage/remontage).
      // Les doubles le laient passer : `FakeMediaStream.addTrack` stocke en liste, le doublon
      // était invisible. La facette ne demande que `getAudioTracks` : c'est un flux FAUX que la
      // fabrique présente à `createMediaStreamSource`, construit par le port injecté.)
      entry = context.createMediaStreamSource(wrapTrackAsStream(source))
      sourceNode = entry
    }
    if (!voiceFilterShiftsPitch(id)) return entry
    pitch = createPitchShifterNode(context, voiceFilterPitchRatio(id))
    entry.connect(pitch.input)
    return pitch.output
  }

  /** La piste de la destination (celle des pairs), avec son repli tracé par l'appelant. */
  function trackOf(): MediaStreamTrack {
    const first = destination.stream.getAudioTracks()[0]
    // Une destination sans piste est une anomalie du contexte (fermé) : la source micro est
    // rendue plutôt qu'un `undefined` qui éteindrait la session sans le dire.
    return first ?? (source as MediaStreamTrack)
  }

  function apply(id: VoiceFilterId): MediaStreamTrack {
    unplug()
    const recipe = voiceFilterRecipeFor(id)
    const head = headOf(id)

    if (recipe.nodes.length === 0) {
      // Voix neutre : AUCUN nœud de recette. La tête va directement à la destination.
      head.connect(destination)
      applied = id
      return trackOf()
    }

    const built: BuiltSpec[] = recipe.nodes.map((spec) => buildSpec(context, spec))
    // Débranchement À L'ENVERS : un poids de formant est créé APRÈS son filtre, donc coupé
    // AVANT lui — couper le filtre d'abord laisserait son poids alimenter le vide.
    // Les nœuds sont RENVERSÉS à l'enregistrement et la boucle de débranchement consomme
    // `parts` en ordre INVERSE — double renversement : le débranchement réel suit l'ordre de
    // CRÉATION (filtre avant son poids, source avant ses descendants), pas l'ordre des maillons.
    parts = built.flatMap((entry) => entry.created)
    oscillators = built.flatMap((entry) => entry.oscillators)
    for (const osc of oscillators) osc.start()

    // La chaîne écoutée, maillon par maillon.
    for (let i = 0; i < recipe.chain.length; i += 1) {
      const index = recipe.chain[i] as number
      const builtNode = built[index]
      const previous = i === 0 ? head : built[recipe.chain[i - 1] as number]?.node
      if (builtNode === undefined || previous === undefined) {
        throw new Error(
          `[voice-filter] recette « ${id} » mal formée : maillon ${index} sur ${built.length} nœuds (bug de recette, pas un réglage)`,
        )
      }
      previous.connect(builtNode.node)
    }

    // La modulation du ring : l'oscillateur commande un gain, dont la sortie se SOMME dans
    // la commande `gain` du nœud cible. C'est le multiplieur porteuse × voix.
    if (recipe.ring !== undefined) {
      const modulator = built[recipe.ring.oscillatorIndex]
      const modGain = built[recipe.ring.modGainIndex]
      const target = built[recipe.ring.targetIndex]
      if (
        modulator === undefined ||
        modGain === undefined ||
        target === undefined ||
        target.gain === null ||
        modGain.gain === null
      ) {
        throw new Error(`[voice-filter] recette « ${id} » : ring sans oscillateur/gain/cible à gain`)
      }
      modulator.node.connect(modGain.node)
      modGain.node.connect(target.gain)
      // La modulation s'ajoute à la valeur de base du gain cible (0,9) : la voix oscille entre
      // silence et double — le battement caractéristique du robot.
      modGain.gain.value = 0.9
    }

    // Les résonateurs de formants : chacun est alimenté par la TÊTE (parallèle, donc) et se
    // somme APRÈS son maillon de chaîne, avec son poids porté par son propre `gain`.
    if (recipe.formants !== undefined) {
      for (const branch of recipe.formants) {
        const resonator = built[branch.resonatorIndex]
        const after = built[branch.afterChainIndex]
        if (resonator === undefined || after === undefined) {
          throw new Error(`[voice-filter] recette « ${id} » : formant ${branch.resonatorIndex} hors tableau`)
        }
        head.connect(resonator.node)
        resonator.node.connect(after.node)
      }
    }

    const tailIndex = recipe.chain[recipe.chain.length - 1] as number
    const tail = built[tailIndex]
    if (tail === undefined) throw new Error(`[voice-filter] recette « ${id} » : chaîne vide`)
    tail.node.connect(destination)
    applied = id
    return trackOf()
  }

  apply(initial)

  return {
    get current(): VoiceFilterId {
      return applied
    },
    get track(): MediaStreamTrack {
      return trackOf()
    },
    applyFilter(id: VoiceFilterId): MediaStreamTrack {
      return apply(id)
    },
    close(): void {
      unplug()
      if (sourceNode !== null) {
        try {
          sourceNode.disconnect()
        } catch {
          // Déjà coupée.
        }
        sourceNode = null
      }
    },
  }
}
