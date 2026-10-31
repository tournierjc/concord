/**
 * tests/gain.test.ts — Carillon
 *
 * Gain : bornes [-60, +12] dB, conversions dB ↔ amplitude, `smoothstep`, rampe
 * attaque 20 ms / relâche 120 ms, modes auto / manual / muted, mute = zéro exact,
 * courbe par trame. Aucun `GainNode` : on ne teste que des nombres.
 *
 *   node --test tests/gain.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ATTACK_MS,
  AUTO_NOISE_FLOOR_DBFS,
  AUTO_TARGET_DBFS,
  GAIN_FRAME_MS,
  MAX_GAIN_DB,
  MIN_GAIN_DB,
  RELEASE_MS,
  applyFrameGain,
  clampGainDb,
  createGainState,
  dbToGain,
  duckedPercent,
  frameGains,
  framesForMs,
  gainDbToPercent,
  gainFrameSamples,
  gainOf,
  gainToDb,
  percentToGainDb,
  resolveTargetDb,
  smoothstep,
  stepAllGain,
  stepGain,
  targetGain,
} from '../src/engine/gain.ts'

const close = (actual: number, expected: number, tolerance = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `attendu ${expected} ±${tolerance}, obtenu ${actual}`,
  )

/**
 * Échantillon d'une courbe, avec garde explicite.
 * `noUncheckedIndexedAccess` type `curve[i]` en `number | undefined` : sans
 * cette garde, un test comparerait `undefined` et le résultat dépendrait de la
 * tolérance au lieu de dépendre de la valeur produite.
 */
function sampleAt(curve: Float32Array, index: number): number {
  const value = curve[index]
  if (value === undefined) {
    throw new Error(`échantillon ${index} absent de la courbe (${curve.length} valeurs)`)
  }
  return value
}

/** Amène l'état à `db` dB par une rampe de relâche complète. */
function stateAtDb(db: number) {
  let state = createGainState()
  for (let i = 0; i < framesForMs(RELEASE_MS); i++) {
    state = stepGain(state, { mode: 'manual', manualDb: db })
  }
  return state
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Bornes et conversions
// ─────────────────────────────────────────────────────────────────────────────

test('bornes : gain cible clampé dans [-60, +12] dB, jamais NaN', () => {
  assert.equal(MIN_GAIN_DB, -60)
  assert.equal(MAX_GAIN_DB, 12)
  assert.equal(clampGainDb(-200), -60)
  assert.equal(clampGainDb(40), 12)
  assert.equal(clampGainDb(0), 0)
  assert.equal(clampGainDb(Number.NEGATIVE_INFINITY), -60)
  assert.equal(clampGainDb(Number.POSITIVE_INFINITY), 12)
  assert.equal(clampGainDb(Number.NaN), -60, 'NaN tombe au plancher, pas en exception')
})

test('conversions dB ↔ amplitude', () => {
  assert.equal(dbToGain(0), 1)
  close(dbToGain(-60), 0.001)
  close(dbToGain(12), 3.9810717055349722)
  assert.equal(dbToGain(Number.NEGATIVE_INFINITY), 0, 'silence exact')
  assert.equal(dbToGain(Number.NaN), 0)
  assert.equal(gainToDb(0), Number.NEGATIVE_INFINITY)
  assert.equal(gainToDb(-1), Number.NEGATIVE_INFINITY)
  assert.equal(gainToDb(1), 0)
  close(gainToDb(dbToGain(-12)), -12, 1e-12)
})

test('smoothstep : 0 → 0, 0,5 → 0,5, 1 → 1, monotone et borné', () => {
  assert.equal(smoothstep(0), 0)
  assert.equal(smoothstep(0.5), 0.5)
  assert.equal(smoothstep(1), 1)
  assert.equal(smoothstep(-3), 0, 'entrée négative bornée')
  assert.equal(smoothstep(4), 1, 'entrée > 1 bornée')
  assert.ok(smoothstep(0.25) < 0.25, 'départ lent : dérivée nulle en 0')
  assert.ok(smoothstep(0.75) > 0.75, 'arrivée freinée : dérivée nulle en 1')
  let previous = -1
  for (let i = 0; i <= 20; i++) {
    const value = smoothstep(i / 20)
    assert.ok(value >= previous, 'courbe monotone')
    previous = value
  }
})

test('durées : 20 ms = 1 trame, 120 ms = 6 trames, 0 ms = 0 trame', () => {
  assert.equal(GAIN_FRAME_MS, 20)
  assert.equal(framesForMs(ATTACK_MS), 1)
  assert.equal(framesForMs(RELEASE_MS), 6)
  assert.equal(framesForMs(0), 0)
  assert.equal(framesForMs(-40), 0)
  assert.equal(framesForMs(30), 2, 'toujours arrondi au supérieur')
  assert.equal(gainFrameSamples(), 960, '20 ms à 48 kHz')
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Cible selon le mode
// ─────────────────────────────────────────────────────────────────────────────

test('mode manual : la valeur demandée, clampée', () => {
  assert.equal(resolveTargetDb({ mode: 'manual' }), 0, 'sans valeur : unité')
  assert.equal(resolveTargetDb({ mode: 'manual', manualDb: -6 }), -6)
  assert.equal(resolveTargetDb({ mode: 'manual', manualDb: 30 }), MAX_GAIN_DB)
  assert.equal(resolveTargetDb({ mode: 'manual', manualDb: -200 }), MIN_GAIN_DB)
  assert.equal(resolveTargetDb({ mode: 'manual', manualDb: Number.NaN }), MIN_GAIN_DB)
})

test('mode auto : normalise vers −18 dBFS, sans amplifier le plancher de bruit', () => {
  assert.equal(AUTO_TARGET_DBFS, -18)
  assert.equal(AUTO_NOISE_FLOOR_DBFS, -60)
  assert.equal(resolveTargetDb({ mode: 'auto', levelDb: -3 }), -15)
  assert.equal(resolveTargetDb({ mode: 'auto', levelDb: -18 }), 0)
  assert.equal(resolveTargetDb({ mode: 'auto', levelDb: -40 }), 12, 'compensation bornée à +12')
  assert.equal(resolveTargetDb({ mode: 'auto', levelDb: -80 }), 0, 'sous le plancher : pas de boost')
  assert.equal(resolveTargetDb({ mode: 'auto' }), 0, 'sans mesure : unité')
  assert.equal(resolveTargetDb({ mode: 'auto', levelDb: Number.NaN }), 0)
  // Plancher de bruit fourni par le vumètre : la décision suit la mesure.
  assert.equal(resolveTargetDb({ mode: 'auto', levelDb: -20, noiseFloorDb: -10 }), 0)
})

test('mode muted : cible au plancher, et amplitude cible exactement 0', () => {
  assert.equal(resolveTargetDb({ mode: 'muted' }), MIN_GAIN_DB)
  assert.equal(targetGain({ mode: 'muted' }), 0, 'un mute est un vrai zéro')
  close(targetGain({ mode: 'manual', manualDb: 0 }), 1)
  close(targetGain({ mode: 'manual', manualDb: -6 }), 0.5011872336272722)
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Rampe
// ─────────────────────────────────────────────────────────────────────────────

test('attaque : 20 ms = une trame, la cible est atteinte exactement', () => {
  const low = stateAtDb(-12)
  assert.equal(low.db, -12)

  const up = stepGain(low, { mode: 'manual', manualDb: 0 })
  assert.equal(up.rampFrames, 1, '20 ms à 20 ms/trame')
  assert.equal(up.elapsedFrames, 1)
  assert.equal(up.db, 0, 'cible posée exactement, sans résidu d’arrondi')
  assert.equal(up.fromDb, -12)
  assert.equal(up.frame, low.frame + 1, 'le temps avance d’une trame par appel')
})

test('relâche : 6 trames pour descendre, pas une de moins', () => {
  assert.equal(framesForMs(RELEASE_MS), 6)
  let state = createGainState()
  state = stepGain(state, { mode: 'manual', manualDb: -12 })
  assert.equal(state.rampFrames, 6)
  assert.equal(state.fromDb, 0)
  close(state.db, -0.8888888888888888) // 0 + (-12) × smoothstep(1/6)
  assert.ok(state.db > -12 && state.db < 0)

  for (let i = 1; i < 6; i++) {
    const previous = state.db
    state = stepGain(state, { mode: 'manual', manualDb: -12 })
    if (i < 5) {
      assert.ok(state.db < previous, 'la rampe descend de façon monotone')
      assert.ok(state.db > -12, `trame ${i + 1} : pas encore la cible`)
    }
  }
  assert.equal(state.elapsedFrames, 6)
  assert.equal(state.db, -12, 'la 6e trame pose la cible exactement')

  // Rester sur la même cible ne relance pas la rampe.
  const steady = stepGain(state, { mode: 'manual', manualDb: -12 })
  assert.equal(steady.db, -12)
  assert.equal(steady.rampFrames, 6)
  assert.equal(steady.elapsedFrames, 7)
})

test('changement de cible en cours de rampe : on repart du gain courant', () => {
  let state = stateAtDb(-12)
  for (let i = 0; i < 3; i++) state = stepGain(state, { mode: 'manual', manualDb: -24 })
  assert.ok(state.db < -12 && state.db > -24, 'rampe en cours vers −24 dB')

  const before = state.db
  const up = stepGain(state, { mode: 'manual', manualDb: -6 })
  assert.equal(up.fromDb, before, 'la nouvelle rampe part du gain courant, pas de 0')
  assert.equal(up.rampFrames, 1, 'remontée = attaque 20 ms')
  assert.equal(up.db, -6)
})

test('mute : rampe de relâche puis zéro exact, pas −60 dB', () => {
  let state = createGainState()
  state = stepGain(state, { mode: 'muted' })
  assert.equal(state.mutedTarget, true)
  assert.equal(state.targetDb, MIN_GAIN_DB)
  assert.equal(state.rampFrames, 6)
  assert.ok(gainOf(state) > 0, 'pendant la rampe, le son descend au lieu de couper net')
  assert.ok(gainOf(state) < 1)

  for (let i = 1; i < 6; i++) state = stepGain(state, { mode: 'muted' })
  assert.equal(state.elapsedFrames, 6)
  assert.equal(gainOf(state), 0, 'mute = amplitude 0 exactement')
  assert.equal(dbToGain(state.db), 0.001, 'le dB reste au plancher, l’amplitude est nulle')

  const curve = frameGains(state)
  assert.equal(curve.length, 960)
  assert.ok(
    curve.every((value) => value === 0),
    'la courbe d’une trame muette est entièrement nulle',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. Courbe par trame
// ─────────────────────────────────────────────────────────────────────────────

test('frameGains : 960 échantillons, continu entre deux trames', () => {
  let state = createGainState()
  state = stepGain(state, { mode: 'manual', manualDb: -12 })
  const curve = frameGains(state)
  assert.equal(curve.length, gainFrameSamples())
  close(sampleAt(curve, 0), dbToGain(state.fromDb), 1e-6)
  close(sampleAt(curve, curve.length - 1), dbToGain(state.db), 1e-6)
  for (let i = 1; i < curve.length; i++) {
    const current = sampleAt(curve, i)
    const previous = sampleAt(curve, i - 1)
    assert.ok(current <= previous + 1e-9, 'courbe décroissante, sans rebond')
  }

  // La courbe s'applique échantillon par échantillon, sans muter l'entrée.
  const input = new Float32Array(960).fill(0.5)
  const output = applyFrameGain(input, curve)
  assert.equal(output.length, 960)
  close(sampleAt(output, 0), 0.5 * sampleAt(curve, 0), 1e-9)
  assert.equal(input[0], 0.5, 'le buffer d’entrée n’est pas modifié')
})

test('pureté : état non muté, résultats reproductibles', () => {
  const state = createGainState()
  const snapshot = { ...state }
  const input = { mode: 'manual', manualDb: -9 } as const

  const a = stepGain(state, input)
  const b = stepGain(state, input)
  assert.deepEqual(a, b)
  assert.deepEqual(state, snapshot, 'l’état d’entrée n’est jamais modifié')
  assert.equal(a.frame, 1)

  const chain = [
    { mode: 'manual', manualDb: -9 },
    { mode: 'muted' },
    { mode: 'auto', levelDb: -30 },
    { mode: 'manual', manualDb: 3 },
  ] as const
  assert.deepEqual(stepAllGain(state, chain), stepAllGain(state, chain))
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. Ducking
// ─────────────────────────────────────────────────────────────────────────────

test('volume d’UI 0–200 % ↔ dB', () => {
  assert.equal(percentToGainDb(100), 0, '100 % = unité')
  close(percentToGainDb(200), 6.020599913279624, 1e-9) // 200 % = +6,02 dB
  assert.equal(percentToGainDb(0), MIN_GAIN_DB, '0 % = plancher, pas -Infinity')
  assert.equal(percentToGainDb(-50), MIN_GAIN_DB)
  close(percentToGainDb(500), percentToGainDb(200), 1e-12) // au-delà de 200 %, on borne
  assert.equal(percentToGainDb(500) < MAX_GAIN_DB, true, 'la borne de 200 % précède celle de +12 dB')
  close(gainDbToPercent(0), 100)
  close(gainDbToPercent(percentToGainDb(50)), 50, 1e-9)
  close(gainDbToPercent(MIN_GAIN_DB), 0.1, 1e-12) // −60 dB = 0,1 % : l’UI arrondit à 0
})

test('ducking : pourcentage du volume de base, borné à [0, 200]', () => {
  assert.equal(duckedPercent(100, 100), 100, '100 % = pas d’atténuation')
  assert.equal(duckedPercent(100, 35), 35)
  assert.equal(duckedPercent(150, 0), 0)
  assert.equal(duckedPercent(-20, 50), 0, 'volume de base négatif → 0')
  assert.equal(duckedPercent(300, 50), 100, 'volume de base borné à 200 % avant calcul')
})
