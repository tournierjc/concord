/**
 * src/engine/rtc/voice-filters.ts — décisions PURES des filtres vocaux (voix modifiées)
 *
 * AJOUT 2026-11-03 (demande JC : « voix robotique, adulte homme/femme, enfant, etc. »). Ce
 * module contient tout ce qui est décidable SANS navigateur sur la chaîne de filtrage de la
 * voix ÉMISE (le filtre s'applique avant l'envoi : tous les pairs entendent la voix modifiée),
 * et qui doit donc être falsifiable par un test unitaire en Node :
 *
 *   • le vocabulaire fermé des voix (`VOICE_FILTER_IDS`) — le schéma de réglages, le guard
 *     IPC et l'UI consomment CETTE liste, jamais une copie ;
 *   • la recette de câblage de chaque voix (`voiceFilterRecipeFor`) : quels nœuds, dans quel
 *     ordre, avec quelles valeurs. Le constructeur de la page (`renderer/voice-filter.ts`)
 *     ne fait qu'obéir à la recette ;
 *   • la résolution défensive d'une valeur lue (`resolveVoiceFilterId`) : une valeur inconnue
 *     ne se répare pas en silence — elle devient `none` ET le dit (`fellBack`) ;
 *   • la recette neutre (`none`) : `nodes` VIDE. Le constructeur branche alors la source
 *     DIRECTEMENT sur la destination. Le chemin du micro sans filtre reste le chemin d'avant,
 *     nœud pour nœud (non-régression mesurable par test).
 *
 * Ce que chaque voix EST réellement, une fois câblée — une recette par effet, jamais un nom
 * qui promet plus que le graphe :
 *
 *   • robot — ring modulation : porteuse 120 Hz MULTIPLIÉE au signal (un `GainNode` dont la
 *     commande `gain` est pilotée par un `OscillatorNode` via un gain de modulation), puis
 *     lissage passe-bas. C'est LA voix synthétique classique, 100 % Web Audio natif ;
 *   • radio — talkie : passe-haut 300 Hz + passe-bas 3000 Hz + passe-bande + saturation douce
 *     (`WaveShaperNode`, courbe `tanh` précalculée par `softClipCurve` ici) + remise à niveau ;
 *   • deep / man / woman / child — timbre ET hauteur. La hauteur est un NOMBRE décidé ici
 *     (`voiceFilterPitchRatio`, ratios de demi-tons précalculés) et appliqué par le
 *     pitch-shifter granulaire de la page (`renderer/voice-pitch.ts`, une trame à la fois,
 *     50 % recouvrement, fenêtres de Hann — pas un `playbackRate`, qui accélérerait aussi la
 *     durée et la voix des pairs). Le timbre est fait par trois résonateurs passe-bande
 *     (formants F1/F2/F3) alimentés EN PARALLÈLE et sommés dans la chaîne, ce qui distingue
 *     une voix d'adulte féminine d'une voix de chipmunk.
 *
 * Contraintes (SPEC-004 §3, module pur — vérifié par tests/engine-purity.test.ts) :
 *   - aucun import (ni node:*, ni paquet npm, ni module relatif) ;
 *   - aucun timer, aucune horloge, aucun `fetch`, aucun état global mutable ;
 *   - syntaxe TypeScript effaçable uniquement (pas d'enum, pas de namespace).
 *
 * Ce que ce fichier NE fait PAS : toucher une API de page. La fabrication des nœuds
 * (`createGain`, `createBiquadFilter`, `createWaveShaper`, `createOscillator`) et le
 * `MediaStreamAudioDestinationNode` vivent dans `src/renderer/voice-filter.ts`, comme
 * `RTCPeerConnection` vit dans `media-plane.ts`.
 */

/**
 * Les voix disponibles, en ordre d'affichage. `none` est la première : c'est le défaut,
 * et l'UI rend la liste dans cet ordre (jamais un tri qui ferait apparaître « robot » avant
 * « aucune voix »).
 */
export const VOICE_FILTER_IDS = ['none', 'robot', 'radio', 'deep', 'man', 'woman', 'child'] as const
export type VoiceFilterId = (typeof VOICE_FILTER_IDS)[number]

/**
 * Les nœuds qu'une recette peut demander. Le constructeur de la page ne sait construire
 * QUE ceux-là : une recette qui en invente un est une erreur de programme visible au
 * typage, pas un nœud ignoré en silence.
 */
export const FILTER_NODE_KINDS = ['gain', 'bandpass', 'lowpass', 'highpass', 'shaper', 'oscillator'] as const
export type FilterNodeKind = (typeof FILTER_NODE_KINDS)[number]

/** La courbe d'un WaveShaper, échantillonnée de −1 à +1 (l'axe du `curve` du DOM). */
export interface ShaperCurve {
  readonly input: number
  readonly output: number
}

/**
 * Un nœud de la recette : son type et SES seules valeurs utiles. Le constructeur lit la
 * facette correspondant à son kind ; les facettes hors kind n'existent pas par construction.
 */
export interface FilterNodeSpec {
  readonly kind: FilterNodeKind
  /** `gain` : amplitude (1 = neutre) ; `bandpass` de formant : POIDS du formant en sortie. */
  readonly gain?: number
  /** `oscillator` : fréquence en Hz (le vrombissement de la porteuse du robot). */
  readonly frequency?: number
  /** `bandpass`/`lowpass`/`highpass` : fréquence de coupure en Hz. */
  readonly cutoffHz?: number
  /** `bandpass` : sélectivité du résonateur. */
  readonly q?: number
  /** `shaper` : la courbe de distorsion (saturation talkie). */
  readonly curve?: readonly ShaperCurve[]
  /**
   * Vrai pour un nœud de MODULATION (oscillateur du ring + son gain de sommation) : il
   * n'est PAS dans la chaîne écoutée — sa sortie commande le `gain` d'un nœud de la chaîne.
   * Un oscillateur laissé dans la chaîne serait une note pure permanente ; ce drapeau est
   * ce qui distingue la modulation du chemin direct.
   */
  readonly modulation?: true
}

/** Une modulation ring : porteuse → gain de modulation → commande `gain` d'un nœud écouté. */
export interface RingModulationSpec {
  readonly oscillatorIndex: number
  readonly modGainIndex: number
  readonly targetIndex: number
}

/** Un résonateur de formant : bande alimentée en parallèle, sommée après un nœud de chaîne. */
export interface FormantBranchSpec {
  readonly resonatorIndex: number
  readonly afterChainIndex: number
}

/** Ce qu'une recette dit construire, et dans quel ordre la chaîne directe passe. */
export interface VoiceFilterRecipe {
  readonly id: VoiceFilterId
  /**
   * Les nœuds à créer, dans l'ordre de création. Un tableau VIDE = voix neutre : le
   * constructeur branche alors la source DIRECTEMENT sur la destination, sans aucun nœud.
   */
  readonly nodes: readonly FilterNodeSpec[]
  /**
   * Les nœuds de la chaîne directe, dans l'ordre source → destination, désignés par leur
   * index dans `nodes`. C'est l'itinéraire écouté ; les nœuds `modulation: true` restent
   * hors de ce chemin.
   */
  readonly chain: readonly number[]
  /** La modulation ring (robot). `undefined` = aucune modulation. */
  readonly ring?: RingModulationSpec
  /**
   * Les résonateurs de formants (voix timbrées) : chaque `resonatorIndex` (bandpass de la
   * recette) est alimenté EN PARALLÈLE par l'entrée de la chaîne et se SOMME après
   * `afterChainIndex` — son propre `gain` porte son poids. C'est ce qui fait un TIMBRE :
   * trois bandes F1/F2/F3 additionnées à la voix, pas trois filtres en série.
   */
  readonly formants?: readonly FormantBranchSpec[]
  /**
   * Vrai si l'entrée de la chaîne nourrit la chaîne ET chaque résonateur (une fourche).
   * Absent = un tuyau linéaire (robot, radio).
   */
  readonly parallel?: true
}

/**
 * Les fréquences de formants par cible (F1/F2/F3), en Hz. Décaler le TIMBRE avec ces bandes
 * en même temps que la hauteur, c'est ce qui distingue une « voix de femme » d'une voix de
 * chipmunk (le simple pitch-up). Ces valeurs sont des constantes de recette, pas des réglages :
 * l'utilisateur choisit une VOIX, jamais un Hz.
 */
export interface FormantPair {
  readonly f1: number
  readonly f2: number
  readonly f3: number
}

export const ADULT_MAN_FORMANTS: FormantPair = { f1: 550, f2: 950, f3: 2200 }
export const DEEP_FORMANTS: FormantPair = { f1: 450, f2: 800, f3: 1900 }
export const WOMAN_FORMANTS: FormantPair = { f1: 880, f2: 1750, f3: 2900 }
export const CHILD_FORMANTS: FormantPair = { f1: 950, f2: 2100, f3: 3300 }

/** Poids (gains) des trois formants : la fondamentale reste la voix, les bandes s'ajoutent. */
export const FORMANT_WEIGHTS: FormantPair = { f1: 0.3, f2: 0.22, f3: 0.12 }

/**
 * Ratio de hauteur appliqué par la page (pitch-shifter granulaire) par voix. Précalculés ici
 * pour que le test d'égalité soit exact — la page lit un nombre, elle ne recompte pas de
 * demi-tons. `1` = hauteur conservée (les voix qui ne jouent que sur le timbre ou l'effet).
 */
export const VOICE_FILTER_PITCH_RATIOS: Record<VoiceFilterId, number> = {
  none: 1,
  robot: 1,
  radio: 1,
  deep: 0.7937,  // −4 demi-tons
  man: 0.8909,   // −2 demi-tons
  woman: 1.1225, // +2 demi-tons
  child: 1.2599, // +4 demi-tons
}

/** Le ratio de hauteur d'une voix (`none`/`robot`/`radio` = 1 : la hauteur est conservée). */
export function voiceFilterPitchRatio(id: VoiceFilterId): number {
  return VOICE_FILTER_PITCH_RATIOS[id]
}

/** Les formants d'une voix (`null` quand la voix ne décale pas le timbre). */
export function voiceFilterFormants(id: VoiceFilterId): FormantPair | null {
  if (id === 'deep') return DEEP_FORMANTS
  if (id === 'man') return ADULT_MAN_FORMANTS
  if (id === 'woman') return WOMAN_FORMANTS
  if (id === 'child') return CHILD_FORMANTS
  return null
}

/** Vrai si la voix modifie la hauteur (et que la page doit donc poser un pitchRatio ≠ 1). */
export function voiceFilterShiftsPitch(id: VoiceFilterId): boolean {
  return voiceFilterPitchRatio(id) !== 1
}

/**
 * Courbe de saturation douce (talkie) : un `tanh` échantillonné sur 1024 points, normalisé
 * à ±1 en butée. Pure : mêmes entrées, même tableau. Un `drive` < 1 est ramené à 1 (en
 * dessous, la courbe est linéaire et le shaper ne sert à rien).
 */
export function softClipCurve(drive: number): readonly ShaperCurve[] {
  const k = drive < 1 ? 1 : drive
  const N = 1024
  const curve: ShaperCurve[] = []
  for (let i = 0; i < N; i += 1) {
    const x = (i / (N - 1)) * 2 - 1
    curve.push({ input: x, output: Math.tanh(k * x) / Math.tanh(k) })
  }
  return curve
}

/** Les quatre ids qui sont un timbre pitché (garde de typage de `timbreRecipe`). */
const TIMBRE_IDS: readonly ('deep' | 'man' | 'woman' | 'child')[] = ['deep', 'man', 'woman', 'child']

/** Vrai si l'id est une voix timbrée pitchée (deep/man/woman/child). */
function isTimbreId(id: VoiceFilterId): id is 'deep' | 'man' | 'woman' | 'child' {
  return (TIMBRE_IDS as readonly string[]).includes(id)
}

/**
 * La recette d'une voix timbrée (deep/man/woman/child) : chaîne directe (fondamentale
 * pondérée, formant de base, lissage, sortie) + trois résonateurs F1/F2/F3 en parallèle,
 * sommés après le lissage. Le ratio de hauteur est porté par `VOICE_FILTER_PITCH_RATIOS`.
 */
function timbreRecipe(id: 'deep' | 'man' | 'woman' | 'child'): VoiceFilterRecipe {
  // Non-nul par construction : `isTimbreId` n'admet que les quatre ids qui ont une table.
  const formants = voiceFilterFormants(id) ?? ADULT_MAN_FORMANTS
  const ceilingHz = id === 'child' ? 5200 : id === 'woman' ? 4800 : 4200
  const outputGain = id === 'deep' || id === 'man' ? 1.1 : 0.95
  return {
    id,
    parallel: true,
    nodes: [
      // [0..3] la chaîne directe (itinéraire écouté), [4..6] les résonateurs parallèles.
      { kind: 'gain', gain: 0.6 },
      { kind: 'bandpass', cutoffHz: formants.f1, q: 5 },
      { kind: 'lowpass', cutoffHz: ceilingHz },
      { kind: 'gain', gain: outputGain },
      { kind: 'bandpass', cutoffHz: formants.f1, q: 6, gain: FORMANT_WEIGHTS.f1 },
      { kind: 'bandpass', cutoffHz: formants.f2, q: 8, gain: FORMANT_WEIGHTS.f2 },
      { kind: 'bandpass', cutoffHz: formants.f3, q: 10, gain: FORMANT_WEIGHTS.f3 },
    ],
    chain: [0, 1, 2, 3],
    formants: [
      { resonatorIndex: 4, afterChainIndex: 2 },
      { resonatorIndex: 5, afterChainIndex: 2 },
      { resonatorIndex: 6, afterChainIndex: 2 },
    ],
  }
}

/**
 * La recette de câblage d'une voix : quels nœuds, dans quel ordre, avec quelles valeurs.
 * Le constructeur de la page ne sait lire QUE ce format (typé, fermé) : c'est le contrat
 * entre la décision pure et la fabrication DOM, falsifiable sans Chromium.
 */
export function voiceFilterRecipeFor(id: VoiceFilterId): VoiceFilterRecipe {
  if (id === 'none') {
    // Voix neutre : AUCUN nœud — la source va DIRECTEMENT à la destination (non-régression).
    return { id, nodes: [], chain: [] }
  }
  if (id === 'robot') {
    // Ring modulation : [0] gain d'entrée dont la commande `gain` est alimentée par
    // [2] oscillateur 120 Hz via [3] gain de modulation (tous deux hors chaîne), puis
    // [1] lissage passe-bas. C'est le multiplieur « porteuse × voix » classique.
    return {
      id,
      nodes: [
        { kind: 'gain', gain: 0.9 },
        { kind: 'lowpass', cutoffHz: 3800 },
        { kind: 'oscillator', frequency: 120, modulation: true },
        { kind: 'gain', gain: 1, modulation: true },
      ],
      chain: [0, 1],
      ring: { oscillatorIndex: 2, modGainIndex: 3, targetIndex: 0 },
    }
  }
  if (id === 'radio') {
    // Talkie : bande 300–3000 Hz + saturation douce + remise à niveau.
    return {
      id,
      nodes: [
        { kind: 'highpass', cutoffHz: 300 },
        { kind: 'lowpass', cutoffHz: 3000 },
        { kind: 'bandpass', cutoffHz: 1600, q: 0.9 },
        { kind: 'shaper', curve: softClipCurve(2.2) },
        { kind: 'gain', gain: 0.9 },
      ],
      chain: [0, 1, 2, 3, 4],
    }
  }
  if (isTimbreId(id)) return timbreRecipe(id)
  // Inatteignable : `VOICE_FILTER_IDS` est épuisé par les branches ci-dessus. La recette
  // neutre est rendue plutôt qu'un `!` ou un cast traversant le typage (C12-3).
  return { id, nodes: [], chain: [] }
}

/**
 * Résout la valeur lue d'un réglage : une voix CONNUE passe telle quelle, une valeur
 * inconnue (ou absente) devient `none` ET le dit (`fellBack`). Le schéma refuse déjà
 * l'inconnu à la lecture du fichier ; cette résolution est le second cordon — défensif,
 * jamais silencieux.
 */
export function resolveVoiceFilterId(value: unknown): { id: VoiceFilterId; fellBack: boolean } {
  if (isVoiceFilterId(value)) return { id: value, fellBack: false }
  return { id: 'none', fellBack: true }
}

/** Vrai si la valeur est une voix du vocabulaire fermé (garde du schéma et du guard IPC). */
export function isVoiceFilterId(value: unknown): value is VoiceFilterId {
  return typeof value === 'string' && (VOICE_FILTER_IDS as readonly string[]).includes(value)
}
