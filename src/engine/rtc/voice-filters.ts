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
 *   • robot — ring modulation BIPOLAIRE (le gain de la chaîne vaut 0, la porteuse ±1 le
 *     remplace : la voix sèche disparaît, il reste les bandes latérales) PUIS un filtre en
 *     peigne (retard + réinjection). Un gain qui reste positif n'est qu'un trémolo : la voix
 *     d'origine traverse, et Opus à 32 kbps la rend presque naturelle ;
 *   • radio — talkie étroit (passe-haut ~500 Hz, passe-bas ~2400 Hz, passe-bande Q élevé)
 *     PUIS un écrêtage fort (pré-gain × courbe `tanh` à drive élevé). Un drive ~2 sur une
 *     parole à −20 dBFS est presque linéaire : après Opus, on n'entend rien ;
 *   • deep / man / woman / child — hauteur ET timbre. La hauteur est un NOMBRE décidé ici
 *     (`voiceFilterPitchRatio`, plusieurs demi-tons, pas ±2 qui disparaissent dans Opus) et
 *     appliqué par le pitch-shifter granulaire de la page (`renderer/voice-pitch.ts`). Le
 *     timbre est trois résonateurs F1/F2/F3 EN PARALLÈLE, plus forts que le résidu sec :
 *     un mélange presque sec ne change pas la voix.
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
export const FILTER_NODE_KINDS = ['gain', 'bandpass', 'lowpass', 'highpass', 'shaper', 'oscillator', 'delay'] as const
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
  /** `delay` : retard du peigne, en secondes. */
  readonly delaySec?: number
  /** `delay` : réinjection du peigne, 0..0,92 (au-delà le peigne hurle). */
  readonly feedback?: number
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

/**
 * Poids des trois formants. Ils DOMINENT le résidu sec (`TIMBRE_DRY_GAIN`) : un mélange
 * à 30 % ne survit pas à Opus 32 kbps mono. Chaque bande est un passe-bande (gain de
 * crête 0 dB), donc ces poids SONT le niveau de la voyelle.
 */
export const FORMANT_WEIGHTS: FormantPair = { f1: 0.95, f2: 0.75, f3: 0.55 }

/** Résidu sec des voix timbrées. Très en dessous de la somme des formants. */
export const TIMBRE_DRY_GAIN = 0.18

/** Porteuse du robot (Hz). Dans la bande du vrombissement, assez basse pour qu'Opus garde les bandes latérales. */
export const ROBOT_CARRIER_HZ = 90
/** Retard du peigne robot (secondes) — résonance ~125 Hz, métallique et courte. */
export const ROBOT_COMB_DELAY_SEC = 0.008
/** Réinjection du peigne. Sous 1 : stable. Assez haut pour s'entendre après l'encodeur. */
export const ROBOT_COMB_FEEDBACK = 0.72
/** Profondeur de la porteuse (±1 = ring complet, le sec est nul). */
export const ROBOT_RING_DEPTH = 1

/** Bornes du talkie. Plus étroites qu'une simple bande téléphonique : Opus en fait déjà une. */
export const RADIO_HIGHPASS_HZ = 500
export const RADIO_LOWPASS_HZ = 2400
export const RADIO_BAND_HZ = 1500
export const RADIO_BAND_Q = 2.4
/** Pré-gain avant l'écrêteur : la parole usuelle (≪ 1) doit ENTRER dans la courbe. */
export const RADIO_PREGAIN = 6
/** Drive du `tanh`. 2 est presque linéaire sur la parole ; 8 sature franchement. */
export const RADIO_DRIVE = 8
/** Remise à niveau après l'écrêtage, pour ne pas saturer l'encodeur Opus. */
export const RADIO_MAKEUP = 0.4

/**
 * Ratio de hauteur appliqué par la page (pitch-shifter granulaire) par voix. Précalculés ici
 * pour que le test d'égalité soit exact — la page lit un nombre, elle ne recompte pas de
 * demi-tons. `1` = hauteur conservée (les voix qui ne jouent que sur le timbre ou l'effet).
 */
export const VOICE_FILTER_PITCH_RATIOS: Record<VoiceFilterId, number> = {
  none: 1,
  robot: 1,
  radio: 1,
  deep: 2 ** (-8 / 12), // −8 demi-tons — un géant, pas un léger assombrissement
  man: 2 ** (-5 / 12), // −5 demi-tons
  woman: 2 ** (5 / 12), // +5 demi-tons
  child: 2 ** (8 / 12), // +8 demi-tons — enfant, encore dans [0,5, 2]
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
/** Un échantillon de la saturation talkie. Même formule que `softClipCurve`. */
export function softClipSample(x: number, drive: number): number {
  const k = drive < 1 ? 1 : drive
  const norm = Math.tanh(k)
  if (norm === 0) return x
  return Math.tanh(k * x) / norm
}

export function softClipCurve(drive: number): readonly ShaperCurve[] {
  const N = 1024
  const curve: ShaperCurve[] = []
  for (let i = 0; i < N; i += 1) {
    const x = (i / (N - 1)) * 2 - 1
    curve.push({ input: x, output: softClipSample(x, drive) })
  }
  return curve
}

/**
 * Modulation d'anneau : `voix × sin(2π f t)`. C'est le graphe du robot quand le gain
 * de chaîne vaut 0 et que la porteuse va de −1 à +1. Un gain qui reste positif
 * (trémolo) laisse passer la voix sèche — ce n'est PAS cette fonction.
 */
export function ringModulate(input: Float32Array, carrierHz: number, sampleRate: number): Float32Array {
  const out = new Float32Array(input.length)
  const step = (2 * Math.PI * carrierHz) / (sampleRate > 0 ? sampleRate : 1)
  for (let i = 0; i < input.length; i += 1) {
    out[i] = (input[i] ?? 0) * Math.sin(step * i)
  }
  return out
}

/**
 * Filtre en peigne : `y[n] = x[n] + feedback · y[n − retard]`. Même coefficients que
 * le nœud `delay` de la recette robot (retard en échantillons, réinjection < 1).
 */
export function combFilter(input: Float32Array, delaySamples: number, feedback: number): Float32Array {
  const delay = delaySamples < 1 ? 1 : Math.floor(delaySamples)
  const g = feedback < 0 ? 0 : feedback > 0.95 ? 0.95 : feedback
  const out = new Float32Array(input.length)
  for (let i = 0; i < input.length; i += 1) {
    const delayed = i >= delay ? (out[i - delay] ?? 0) : 0
    out[i] = (input[i] ?? 0) + g * delayed
  }
  return out
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
  const ceilingHz = id === 'child' ? 6400 : id === 'woman' ? 5600 : id === 'deep' ? 2800 : 3600
  const floorHz = id === 'deep' ? 70 : 120
  return {
    id,
    parallel: true,
    nodes: [
      // [0..3] résidu sec (léger), [4..6] les voyelles — branchées sur la TÊTE, pas sur le sec.
      { kind: 'gain', gain: TIMBRE_DRY_GAIN },
      { kind: 'highpass', cutoffHz: floorHz },
      { kind: 'lowpass', cutoffHz: ceilingHz },
      { kind: 'gain', gain: 1 },
      { kind: 'bandpass', cutoffHz: formants.f1, q: 4, gain: FORMANT_WEIGHTS.f1 },
      { kind: 'bandpass', cutoffHz: formants.f2, q: 5, gain: FORMANT_WEIGHTS.f2 },
      { kind: 'bandpass', cutoffHz: formants.f3, q: 6, gain: FORMANT_WEIGHTS.f3 },
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
    // Ring BIPOLAIRE : le gain [0] vaut 0, la porteuse (± ROBOT_RING_DEPTH) le remplace.
    // Puis peigne, bande parole, lissage, remise à niveau. L'oscillateur reste HORS chaîne.
    return {
      id,
      nodes: [
        { kind: 'gain', gain: 0 },
        { kind: 'delay', delaySec: ROBOT_COMB_DELAY_SEC, feedback: ROBOT_COMB_FEEDBACK },
        { kind: 'bandpass', cutoffHz: 1600, q: 0.7 },
        { kind: 'lowpass', cutoffHz: 3400 },
        { kind: 'gain', gain: 1.8 },
        { kind: 'oscillator', frequency: ROBOT_CARRIER_HZ, modulation: true },
        { kind: 'gain', gain: ROBOT_RING_DEPTH, modulation: true },
      ],
      chain: [0, 1, 2, 3, 4],
      ring: { oscillatorIndex: 5, modGainIndex: 6, targetIndex: 0 },
    }
  }
  if (id === 'radio') {
    // Talkie étroit + distorsion forte. Le pré-gain pousse la parole DANS la courbe.
    return {
      id,
      nodes: [
        { kind: 'highpass', cutoffHz: RADIO_HIGHPASS_HZ },
        { kind: 'lowpass', cutoffHz: RADIO_LOWPASS_HZ },
        { kind: 'bandpass', cutoffHz: RADIO_BAND_HZ, q: RADIO_BAND_Q },
        { kind: 'gain', gain: RADIO_PREGAIN },
        { kind: 'shaper', curve: softClipCurve(RADIO_DRIVE) },
        { kind: 'lowpass', cutoffHz: 2800 },
        { kind: 'gain', gain: RADIO_MAKEUP },
      ],
      chain: [0, 1, 2, 3, 4, 5, 6],
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
