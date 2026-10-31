/**
 * src/engine/gain.ts — Carillon
 *
 * Gain par participant, **pur** : aucun `GainNode`, aucun `AudioContext`, aucun
 * timer. On calcule la cible en dB, on l'atteint par une rampe `smoothstep`, on
 * rend l'amplitude linéaire à appliquer échantillon par échantillon.
 *
 * Trois modes (contrat T2) :
 *   • `auto`   — normalisation vers −18 dBFS : le gain compense l'écart entre le
 *                niveau mesuré et la cible, donc un ami au casque et un ami au
 *                micro de casque sortent au même volume. Sous le plancher de
 *                bruit estimé on **n'amplifie pas** (sinon on pompe le souffle).
 *   • `manual` — le curseur 0–200 % de l'UI, exprimé ici en dB.
 *   • `muted`  — cible exactement 0 d'amplitude (pas « −60 dB ») : un mute doit
 *                être un vrai zéro, sinon un résidu de −60 dB reste audible en
 *                sommation avec les autres pistes.
 *
 * Rampe : attaque **20 ms**, relâche **120 ms**. Une attaque courte rend la
 * parole immédiatement présente ; une relâche longue évite le « souffle de
 * pompe » quand on baisse quelqu'un. Profil `smoothstep` (dérivée nulle aux deux
 * bouts) : une rampe linéaire produit un clic audible à chaque raccord.
 *
 * Bornes : gain cible clampé dans **[-60 dB, +12 dB]**. +12 dB est le maximum
 * qu'on s'autorise à amplifier un micro lointain sans faire remonter le bruit de
 * quantification ; en dessous de −60 dB on est déjà inaudible, autant couper.
 *
 * Tout est calculé **par trame de 20 ms**, avec un état de rampe explicite
 * (`fromDb`, `targetDb`, `elapsedFrames`, `rampFrames`) : le graphe audio n'a
 * donc qu'à lire une courbe, et le calcul se teste sans carte son.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constantes (T2 / SPEC-003)
// ─────────────────────────────────────────────────────────────────────────────

/** Bornes du gain cible, en dB. */
export const MIN_GAIN_DB = -60
export const MAX_GAIN_DB = 12
/** Référence : 0 dB = amplitude 1,0. */
export const UNITY_GAIN_DB = 0
/** Attaque : 20 ms — soit une trame pleine à 20 ms/trame. */
export const ATTACK_MS = 20
/** Relâche : 120 ms — six trames, le temps qu'une baisse ne s'entende pas. */
export const RELEASE_MS = 120
/** Durée d'une trame de gain. */
export const GAIN_FRAME_MS = 20
/** Fréquence d'échantillonnage du graphe. */
export const GAIN_SAMPLE_RATE = 48000
/** Niveau visé par le mode `auto`. */
export const AUTO_TARGET_DBFS = -18
/** Sous ce niveau, le mode `auto` ne compense plus (bruit de fond, pas parole). */
export const AUTO_NOISE_FLOOR_DBFS = -60

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type GainMode = 'auto' | 'manual' | 'muted'

export interface GainConfig {
  readonly minDb: number
  readonly maxDb: number
  readonly attackMs: number
  readonly releaseMs: number
  readonly frameMs: number
  readonly sampleRate: number
  readonly autoTargetDbfs: number
  readonly autoNoiseFloorDbfs: number
}

export const DEFAULT_GAIN_CONFIG: GainConfig = {
  minDb: MIN_GAIN_DB,
  maxDb: MAX_GAIN_DB,
  attackMs: ATTACK_MS,
  releaseMs: RELEASE_MS,
  frameMs: GAIN_FRAME_MS,
  sampleRate: GAIN_SAMPLE_RATE,
  autoTargetDbfs: AUTO_TARGET_DBFS,
  autoNoiseFloorDbfs: AUTO_NOISE_FLOOR_DBFS,
}

/** Entrée d'un pas de gain : le mode et, selon le mode, la mesure. */
export interface GainTargetInput {
  readonly mode: GainMode
  /** Mode `manual` : gain demandé par l'UI, en dB (clampé ensuite). */
  readonly manualDb?: number
  /** Mode `auto` : niveau mesuré de la source, en dBFS. */
  readonly levelDb?: number
  /** Mode `auto` : plancher de bruit estimé (défaut : config). */
  readonly noiseFloorDb?: number
}

/** État de rampe, porté d'une trame à l'autre. */
export interface GainState {
  /** Gain courant, en dB (dans les bornes). */
  readonly db: number
  /** Gain au début de la rampe en cours. */
  readonly fromDb: number
  /** Gain visé. */
  readonly targetDb: number
  /** Trames écoulées dans la rampe en cours. */
  readonly elapsedFrames: number
  /** Durée totale de la rampe, en trames (0 = changement instantané). */
  readonly rampFrames: number
  /** Index de la **prochaine** trame (compteur pur, aucune horloge). */
  readonly frame: number
  /** Mode appliqué lors du dernier pas. */
  readonly mode: GainMode
  /** Vrai quand la cible est le silence (mode `muted`). */
  readonly mutedTarget: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversions
// ─────────────────────────────────────────────────────────────────────────────

function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  if (value === Number.POSITIVE_INFINITY) return max
  if (value === Number.NEGATIVE_INFINITY) return min
  if (value < min) return min
  if (value > max) return max
  return value
}

/** Ramène un gain en dB dans [-60, +12]. NaN et -Infinity tombent au plancher. */
export function clampGainDb(db: number, config: GainConfig = DEFAULT_GAIN_CONFIG): number {
  return clampNumber(db, config.minDb, config.maxDb)
}

/** dB → amplitude linéaire. 0 dB = 1, −60 dB ≈ 0,001, -Infinity = 0. */
export function dbToGain(db: number): number {
  if (Number.isNaN(db)) return 0
  if (db === Number.NEGATIVE_INFINITY) return 0
  if (db === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY
  return Math.pow(10, db / 20)
}

/** Amplitude linéaire → dB. 0 (et NaN) donne -Infinity : silence exact. */
export function gainToDb(gain: number): number {
  if (!Number.isFinite(gain) || gain <= 0) return Number.NEGATIVE_INFINITY
  return 20 * Math.log10(gain)
}

/** `smoothstep` borné à [0,1] : dérivée nulle en 0 et en 1, donc sans clic. */
export function smoothstep(t: number): number {
  const x = clampNumber(t, 0, 1)
  return x * x * (3 - 2 * x)
}

/** Nombre de trames pour couvrir une durée (arrondi au supérieur, 0 si nulle). */
export function framesForMs(ms: number, frameMs: number = GAIN_FRAME_MS): number {
  if (!Number.isFinite(ms) || !Number.isFinite(frameMs)) return 0
  if (ms <= 0 || frameMs <= 0) return 0
  return Math.max(1, Math.ceil(ms / frameMs))
}

/** Nombre d'échantillons dans une trame de gain (960 par défaut). */
export function gainFrameSamples(config: GainConfig = DEFAULT_GAIN_CONFIG): number {
  const n = Math.round((config.sampleRate * config.frameMs) / 1000)
  return Number.isFinite(n) && n > 0 ? n : 960
}

/**
 * Volume d'UI 0–200 % → gain en dB. 100 % = 0 dB, 200 % = +6,02 dB, 0 % = plancher
 * (−60 dB, inaudible). C'est le seul endroit où le pourcentage de l'interface
 * devient un gain : le reste du moteur ne raisonne qu'en dB.
 */
export function percentToGainDb(
  percent: number,
  config: GainConfig = DEFAULT_GAIN_CONFIG,
): number {
  const value = clampNumber(percent, 0, 200)
  if (value <= 0) return config.minDb
  return clampGainDb(20 * Math.log10(value / 100), config)
}

/** Inverse de `percentToGainDb`, borné à [0, 200] : pour afficher un curseur. */
export function gainDbToPercent(db: number, config: GainConfig = DEFAULT_GAIN_CONFIG): number {
  const value = clampGainDb(db, config)
  return clampNumber(Math.pow(10, value / 20) * 100, 0, 200)
}

// ─────────────────────────────────────────────────────────────────────────────
// Cible
// ─────────────────────────────────────────────────────────────────────────────

/** Gain cible (dB, clampé) pour un mode et une mesure. */
export function resolveTargetDb(
  input: GainTargetInput,
  config: GainConfig = DEFAULT_GAIN_CONFIG,
): number {
  if (input.mode === 'muted') return config.minDb
  if (input.mode === 'manual') return clampGainDb(input.manualDb ?? UNITY_GAIN_DB, config)

  const levelDb = input.levelDb
  if (typeof levelDb !== 'number' || !Number.isFinite(levelDb)) return UNITY_GAIN_DB
  const floor =
    typeof input.noiseFloorDb === 'number' && Number.isFinite(input.noiseFloorDb)
      ? input.noiseFloorDb
      : config.autoNoiseFloorDbfs
  // Sous le plancher de bruit, on ne compense pas : amplifier le souffle d'une
  // pièce vide rendrait le salon insupportable entre deux phrases.
  if (levelDb <= floor) return UNITY_GAIN_DB
  return clampGainDb(config.autoTargetDbfs - levelDb, config)
}

/** Amplitude linéaire visée, immédiatement : `muted` vaut exactement 0. */
export function targetGain(input: GainTargetInput, config: GainConfig = DEFAULT_GAIN_CONFIG): number {
  if (input.mode === 'muted') return 0
  return dbToGain(resolveTargetDb(input, config))
}

// ─────────────────────────────────────────────────────────────────────────────
// Rampe
// ─────────────────────────────────────────────────────────────────────────────

/** État initial : 0 dB (unité), rampe terminée. */
export function createGainState(): GainState {
  return {
    db: UNITY_GAIN_DB,
    fromDb: UNITY_GAIN_DB,
    targetDb: UNITY_GAIN_DB,
    elapsedFrames: 0,
    rampFrames: 0,
    frame: 0,
    mode: 'manual',
    mutedTarget: false,
  }
}

/**
 * Avance d'une trame vers la cible. Pure : l'état reçu n'est pas muté, aucun
 * timer n'est créé, le temps avance d'exactement une trame par appel.
 */
export function stepGain(
  state: GainState,
  input: GainTargetInput,
  config: GainConfig = DEFAULT_GAIN_CONFIG,
): GainState {
  const targetDb = resolveTargetDb(input, config)
  const mutedTarget = input.mode === 'muted'
  const newTarget = targetDb !== state.targetDb || mutedTarget !== state.mutedTarget

  const fromDb = newTarget ? state.db : state.fromDb
  const rampFrames = newTarget
    ? framesForMs(
        targetDb >= fromDb ? config.attackMs : config.releaseMs,
        config.frameMs,
      )
    : state.rampFrames
  const elapsedFrames = (newTarget ? 0 : state.elapsedFrames) + 1

  let db: number
  if (rampFrames <= 0) {
    db = targetDb
  } else if (elapsedFrames >= rampFrames) {
    // Fin de rampe : on pose la cible exactement, sans résidu d'arrondi.
    db = targetDb
  } else {
    const progress = smoothstep(elapsedFrames / rampFrames)
    db = fromDb + (targetDb - fromDb) * progress
  }

  return {
    db,
    fromDb,
    targetDb,
    elapsedFrames,
    rampFrames,
    frame: state.frame + 1,
    mode: input.mode,
    mutedTarget,
  }
}

/** Rejoue une suite d'entrées (une par trame) et rend l'état final. */
export function stepAllGain(
  state: GainState,
  inputs: ReadonlyArray<GainTargetInput>,
  config: GainConfig = DEFAULT_GAIN_CONFIG,
): GainState {
  let current = state
  for (const input of inputs) current = stepGain(current, input, config)
  return current
}

/**
 * Amplitude à appliquer maintenant. En mode `muted`, une fois la rampe de
 * relâche terminée, la valeur est **exactement 0** (pas 10^(−60/20)).
 */
export function gainOf(state: GainState): number {
  if (state.mutedTarget && state.elapsedFrames >= state.rampFrames) return 0
  return dbToGain(state.db)
}

/**
 * Courbe d'une trame : passage de `fromDb` à `db` en `smoothstep`, en dB puis en
 * amplitude. Le premier échantillon vaut le gain précédent, le dernier le gain
 * courant : le raccord entre deux trames est continu, donc sans clic.
 */
export function frameGains(
  state: GainState,
  config: GainConfig = DEFAULT_GAIN_CONFIG,
): Float32Array {
  const n = gainFrameSamples(config)
  const out = new Float32Array(n)
  if (state.mutedTarget && state.elapsedFrames >= state.rampFrames) return out

  const from = state.fromDb
  const to = state.db
  if (n === 1) {
    out[0] = dbToGain(to)
    return out
  }
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    const db = from + (to - from) * smoothstep(t)
    out[i] = dbToGain(db)
  }
  return out
}

/** Applique une courbe de gain à une trame d'échantillons (rend un nouveau buffer). */
export function applyFrameGain(
  frame: ArrayLike<number>,
  gains: ArrayLike<number>,
): Float32Array {
  const n = Math.min(frame.length, gains.length)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const sample = frame[i]
    const gain = gains[i]
    // i < n ≤ longueur des deux sources : le garde n'existe que pour le type.
    if (sample === undefined || gain === undefined) continue
    out[i] = sample * gain
  }
  return out
}

/**
 * Atténuation des autres participants quand quelqu'un parle (ducking).
 * `duckPercent` est le pourcentage du volume de base **conservé** (100 = pas
 * d'atténuation, 35 = il ne reste que 35 %). Rend un volume 0–200, jamais hors
 * bornes : c'est un volume d'UI, pas un dB.
 */
export function duckedPercent(basePercent: number, duckPercent: number): number {
  const base = clampNumber(basePercent, 0, 200)
  const duck = clampNumber(duckPercent, 0, 100)
  return clampNumber((base * duck) / 100, 0, 200)
}
