/**
 * src/engine/vad.ts — Carillon
 *
 * Détection d'activité vocale **pure**, par trames de 20 ms (960 échantillons à
 * 48 kHz). Aucune horloge, aucun timer, aucun accès à `navigator.mediaDevices` :
 * on donne des `Float32Array`, on récupère un état. Le temps est compté en
 * trames, jamais en millisecondes réelles — c'est ce qui rend la décision
 * reproductible à l'identique sur deux machines et dans un test.
 *
 * Décision (constantes de T2, SPEC-003) :
 *   1. niveau : RMS de la trame → dBFS, plancher −100 (jamais `-Infinity`).
 *   2. taux de passage par zéro : garde-fou anti-bruit. Un souffle à −20 dBFS a
 *      un ZCR ≈ 0,5 et n'ouvre pas ; une voix voisée à 200–400 Hz est ≈ 0,01.
 *   3. hystérésis : ouverture à **−38 dBFS**, fermeture à **−45 dBFS**. Entre
 *      les deux la porte ne bouge pas (c'est ce qui évite le battement d'une
 *      porte à seuil unique sur une voix qui respire).
 *   4. tenue : **2 trames (40 ms)** au-dessus du seuil d'ouverture avant
 *      d'ouvrir, **6 trames (120 ms)** sous le seuil de fermeture avant de
 *      fermer (hangover). En dessous de 40 ms, un clic de souris ou une toux
 *      n'ouvre pas le micro ; 120 ms de hangover couvrent les occlusives (p, t,
 *      k) dont le silence interne dure 40 à 80 ms — sans hangover, la fin de
 *      chaque mot serait coupée, ce qui s'entend immédiatement.
 *
 * État rendu : `{ speaking, levelDb, changedAtFrame }` (contrat T2) plus les
 * compteurs nécessaires pour rester **pur** : une fonction sans état interne ne
 * peut pas compter 2 trames consécutives sans les porter dans l'état qu'on lui
 * repasse (`frame`, `aboveFrames`, `belowFrames`). Aucun de ces champs n'est une
 * horloge : ils n'avancent que d'un cran par appel à `stepVad`.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constantes (T2 / SPEC-003)
// ─────────────────────────────────────────────────────────────────────────────

/** Fréquence d'échantillonnage du moteur : Opus 48 kHz mono. */
export const SAMPLE_RATE = 48000
/** Durée d'une trame de décision. */
export const FRAME_MS = 20
/** 960 échantillons par trame — la taille qu'attend Opus en 20 ms. */
export const FRAME_SAMPLES = (SAMPLE_RATE * FRAME_MS) / 1000

/** Plancher du vumètre : silence numérique, jamais `-Infinity`. */
export const MIN_DBFS = -100
/** Seuil d'ouverture de la porte. */
export const OPEN_DBFS = -38
/** Seuil de fermeture (hystérésis de 7 dB sous l'ouverture). */
export const CLOSE_DBFS = -45
/** Attaque : 2 trames = 40 ms au-dessus du seuil avant d'ouvrir. */
export const ATTACK_FRAMES = 2
/** Relâche : 6 trames = 120 ms sous le seuil avant de fermer (hangover). */
export const RELEASE_FRAMES = 6
/** ZCR au-delà duquel une trame est jugée non voisée (bruit large bande). */
export const ZCR_MAX = 0.45
/** Valeur de `changedAtFrame` tant que la porte n'a jamais changé d'état. */
export const NO_CHANGE_FRAME = -1

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface VadConfig {
  readonly sampleRate: number
  readonly frameMs: number
  readonly openDbfs: number
  readonly closeDbfs: number
  readonly attackFrames: number
  readonly releaseFrames: number
  readonly zcrMax: number
  readonly minDbfs: number
}

export const DEFAULT_VAD_CONFIG: VadConfig = {
  sampleRate: SAMPLE_RATE,
  frameMs: FRAME_MS,
  openDbfs: OPEN_DBFS,
  closeDbfs: CLOSE_DBFS,
  attackFrames: ATTACK_FRAMES,
  releaseFrames: RELEASE_FRAMES,
  zcrMax: ZCR_MAX,
  minDbfs: MIN_DBFS,
}

export interface VadState {
  /** Vrai quand la porte est ouverte : le micro émet. */
  readonly speaking: boolean
  /** Niveau de la dernière trame traitée, en dBFS (≥ `minDbfs`). */
  readonly levelDb: number
  /** Index de la trame où `speaking` a changé ; `NO_CHANGE_FRAME` au départ. */
  readonly changedAtFrame: number
  /** Index de la **prochaine** trame à traiter (0 au départ). */
  readonly frame: number
  /** Trames consécutives au-dessus du seuil d'ouverture (compteur d'attaque). */
  readonly aboveFrames: number
  /** Trames consécutives sous le seuil de fermeture (compteur de relâche). */
  readonly belowFrames: number
}

/** Résultat détaillé d'une trame — utile au diagnostic et aux tests. */
export interface VadStep {
  readonly state: VadState
  readonly levelDb: number
  readonly zcr: number
  readonly voiced: boolean
  /** `'open'` / `'close'` seulement sur la trame qui change l'état. */
  readonly transition: 'open' | 'close' | 'none'
}

// ─────────────────────────────────────────────────────────────────────────────
// Mesures de trame
// ─────────────────────────────────────────────────────────────────────────────

/** Nombre d'échantillons d'une trame pour la configuration donnée. */
export function frameSamples(config: VadConfig = DEFAULT_VAD_CONFIG): number {
  const n = Math.round((config.sampleRate * config.frameMs) / 1000)
  return Number.isFinite(n) && n > 0 ? n : FRAME_SAMPLES
}

/** Valeur RMS d'une trame (0 pour une trame vide). */
export function frameRms(frame: ArrayLike<number>): number {
  const n = frame.length
  if (n === 0) return 0
  let sum = 0
  for (let i = 0; i < n; i++) {
    const x = frame[i]
    if (x === undefined || !Number.isFinite(x)) continue
    sum += x * x
  }
  return Math.sqrt(sum / n)
}

/** RMS → dBFS borné à `config.minDbfs`. Une trame silencieuse vaut −100. */
export function frameDbfs(
  frame: ArrayLike<number>,
  config: VadConfig = DEFAULT_VAD_CONFIG,
): number {
  const rms = frameRms(frame)
  if (!Number.isFinite(rms) || rms <= 0) return config.minDbfs
  const db = 20 * Math.log10(rms)
  return db < config.minDbfs ? config.minDbfs : db
}

/** Taux de passage par zéro, normalisé 0–1 (0 si la trame a moins de 2 points). */
export function zeroCrossingRate(frame: ArrayLike<number>): number {
  const n = frame.length
  if (n < 2) return 0
  let crossings = 0
  // n ≥ 2 : l'indice 0 existe toujours ; le repli n'est là que pour le type.
  const first = frame[0] ?? 0
  let previous = first >= 0 ? 1 : -1
  for (let i = 1; i < n; i++) {
    const sample = frame[i]
    const sign = (sample ?? 0) >= 0 ? 1 : -1
    if (sign !== previous) crossings++
    previous = sign
  }
  return crossings / (n - 1)
}

// ─────────────────────────────────────────────────────────────────────────────
// État et pas de décision
// ─────────────────────────────────────────────────────────────────────────────

/** État initial : porte fermée, aucune trame traitée. */
export function createVadState(config: VadConfig = DEFAULT_VAD_CONFIG): VadState {
  return {
    speaking: false,
    levelDb: config.minDbfs,
    changedAtFrame: NO_CHANGE_FRAME,
    frame: 0,
    aboveFrames: 0,
    belowFrames: 0,
  }
}

/**
 * Traite une trame et rend le nouvel état. Fonction pure : l'état reçu n'est
 * jamais muté, deux appels identiques sur un même état donnent le même résultat,
 * et rien ne dépend de l'heure système.
 */
export function stepVad(
  state: VadState,
  frame: ArrayLike<number>,
  config: VadConfig = DEFAULT_VAD_CONFIG,
): VadState {
  return stepVadDetailed(state, frame, config).state
}

/**
 * La SEULE machine « niveau → parle » du projet (AD-17 / D5).
 *
 * Elle prend deux booléens déjà calculés (`loud`, `quiet`) et applique les
 * constantes existantes : `attackFrames` (2 trames / 40 ms) pour ouvrir,
 * `releaseFrames` (6 trames / 120 ms) pour fermer, avec la zone d'hystérésis
 * `closeDbfs < niveau < openDbfs` où rien ne bouge. Deux appelants, un seul code :
 *   • `stepVadDetailed` — micro local, `loud = voisé && niveau ≥ openDbfs` ;
 *   • `speakingFromLevel` — pair distant, `loud = niveau ≥ openDbfs` (sans ZCR).
 * Aucun second seuil n'existe : un pair distant et l'émetteur partagent -38 / -45.
 */
function hysteresisStep(
  state: VadState,
  loud: boolean,
  quiet: boolean,
  config: VadConfig,
): {
  speaking: boolean
  changedAtFrame: number
  aboveFrames: number
  belowFrames: number
  transition: 'open' | 'close' | 'none'
} {
  const attack = Math.max(0, Math.floor(config.attackFrames))
  const release = Math.max(0, Math.floor(config.releaseFrames))
  const index = state.frame

  let speaking = state.speaking
  let changedAtFrame = state.changedAtFrame
  let aboveFrames = 0
  let belowFrames = 0
  let transition: 'open' | 'close' | 'none' = 'none'

  if (!speaking) {
    aboveFrames = loud ? state.aboveFrames + 1 : 0
    if (aboveFrames >= attack) {
      speaking = true
      changedAtFrame = index
      aboveFrames = 0
      transition = 'open'
    }
  } else {
    // Zone d'hystérésis (−45 à −38 dBFS) : ni ouverture ni fermeture, la porte
    // reste ouverte et le compteur de relâche est remis à zéro.
    belowFrames = quiet ? state.belowFrames + 1 : 0
    if (belowFrames >= release) {
      speaking = false
      changedAtFrame = index
      belowFrames = 0
      transition = 'close'
    }
  }

  return { speaking, changedAtFrame, aboveFrames, belowFrames, transition }
}

/** Comme `stepVad`, en exposant aussi le niveau, le ZCR et la transition. */
export function stepVadDetailed(
  state: VadState,
  frame: ArrayLike<number>,
  config: VadConfig = DEFAULT_VAD_CONFIG,
): VadStep {
  const levelDb = frameDbfs(frame, config)
  const zcr = zeroCrossingRate(frame)
  const voiced = zcr <= config.zcrMax
  const loud = voiced && levelDb >= config.openDbfs
  const quiet = levelDb <= config.closeDbfs

  const step = hysteresisStep(state, loud, quiet, config)

  return {
    state: {
      speaking: step.speaking,
      levelDb,
      changedAtFrame: step.changedAtFrame,
      frame: state.frame + 1,
      aboveFrames: step.aboveFrames,
      belowFrames: step.belowFrames,
    },
    levelDb,
    zcr,
    voiced,
    transition: step.transition,
  }
}

/**
 * AD-17 / D5 — « parle » pour un pair DISTANT, à partir de son niveau mesuré.
 *
 * Le signal reçu a déjà franchi la porte de l'émetteur et RNNoise : re-juger la
 * voisement (ZCR) ajouterait une deuxième opinion sur la même trame, d'où
 * l'absence de `voiced` ici. Tout le reste est identique au micro local — mêmes
 * constantes, même machine (`hysteresisStep`), donc l'indicateur de l'émetteur et
 * le halo du pair ne peuvent pas se contredire sur le même son.
 *
 * Pureté : `prev` n'est jamais muté, aucun accès à l'heure — le temps se compte
 * en trames de 20 ms, exactement comme pour le micro local.
 */
export function speakingFromLevel(
  prev: VadState,
  levelDb: number,
  config: VadConfig = DEFAULT_VAD_CONFIG,
): VadState {
  const bounded = Number.isFinite(levelDb)
    ? Math.max(levelDb, config.minDbfs)
    : config.minDbfs
  const step = hysteresisStep(
    prev,
    bounded >= config.openDbfs,
    bounded <= config.closeDbfs,
    config,
  )
  return {
    speaking: step.speaking,
    levelDb: bounded,
    changedAtFrame: step.changedAtFrame,
    frame: prev.frame + 1,
    aboveFrames: step.aboveFrames,
    belowFrames: step.belowFrames,
  }
}

/** Rejoue une suite de trames et rend l'état final (pratique pour les tests). */
export function stepAll(
  state: VadState,
  frames: ReadonlyArray<ArrayLike<number>>,
  config: VadConfig = DEFAULT_VAD_CONFIG,
): VadState {
  let current = state
  for (const frame of frames) current = stepVad(current, frame, config)
  return current
}

// ─────────────────────────────────────────────────────────────────────────────
// Push-to-talk
// ─────────────────────────────────────────────────────────────────────────────

/** Deux modes de prise de parole : porte automatique (VAD) ou touche maintenue. */
export type MicMode = 'vad' | 'ptt'

/**
 * Décide si le micro émet. En `ptt`, la porte suit **exactement** l'appui : le
 * micro est coupé au repos, ouvert pendant l'appui, sans attendre les 2 trames
 * d'attaque ni le hangover de 6 trames (en PTT le locuteur sait quand il parle,
 * lui imposer 40 ms de latence serait une faute d'ergonomie). En `vad`, c'est la
 * décision de la porte qui fait foi et `pttHeld` est ignoré.
 */
export function gateOpen(mode: MicMode, vadSpeaking: boolean, pttHeld: boolean): boolean {
  return mode === 'ptt' ? pttHeld === true : vadSpeaking === true
}

// ─────────────────────────────────────────────────────────────────────────────
// Vumètre (médiane glissante) — estimateur du plancher de bruit
// ─────────────────────────────────────────────────────────────────────────────

/** 150 trames = 3 s : assez long pour ignorer une phrase, assez court pour suivre
 *  un bruit de fond de pièce qui change. */
export const METER_WINDOW_FRAMES = 150

export interface LevelMeter {
  /** Fenêtre circulaire des niveaux (les cases non remplies valent `null`). */
  readonly values: ReadonlyArray<number | null>
  /** Index de la prochaine case à écrire. */
  readonly cursor: number
  readonly filled: number
}

export function createLevelMeter(window: number = METER_WINDOW_FRAMES): LevelMeter {
  const size =
    Number.isFinite(window) && window > 0 ? Math.floor(window) : METER_WINDOW_FRAMES
  return { values: new Array<number | null>(size).fill(null), cursor: 0, filled: 0 }
}

/** Ajoute un niveau (dBFS) au vumètre ; rend un nouveau vumètre. */
export function pushLevel(meter: LevelMeter, levelDb: number): LevelMeter {
  const values = meter.values.slice()
  values[meter.cursor] = Number.isFinite(levelDb) ? levelDb : null
  return {
    values,
    cursor: (meter.cursor + 1) % meter.values.length,
    filled: Math.min(meter.values.length, meter.filled + 1),
  }
}

/** Médiane des niveaux mesurés (plancher de bruit) ; `null` si le vumètre est vide. */
export function meterMedianDb(meter: LevelMeter): number | null {
  const measured: number[] = []
  for (const value of meter.values) {
    if (typeof value === 'number') measured.push(value)
  }
  if (measured.length === 0) return null
  measured.sort((a, b) => a - b)
  const mid = Math.floor(measured.length / 2)
  const hi = measured[mid]
  // mid < measured.length par construction ; le garde n'existe que pour le type.
  if (hi === undefined) return null
  if (measured.length % 2 === 1) return hi
  const lo = measured[mid - 1] ?? hi
  return (lo + hi) / 2
}
