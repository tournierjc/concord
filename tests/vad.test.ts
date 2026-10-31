/**
 * tests/vad.test.ts — Carillon
 *
 * VAD par trames de 20 ms : niveau dBFS, ZCR, hystérésis −38/−45 dBFS, attaque
 * 2 trames, relâche 6 trames, déterminisme. Aucune carte son : les trames sont
 * synthétisées, donc la décision est reproductible au bit près.
 *
 *   node --test tests/vad.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ATTACK_FRAMES,
  CLOSE_DBFS,
  DEFAULT_VAD_CONFIG,
  FRAME_MS,
  FRAME_SAMPLES,
  METER_WINDOW_FRAMES,
  MIN_DBFS,
  NO_CHANGE_FRAME,
  OPEN_DBFS,
  RELEASE_FRAMES,
  SAMPLE_RATE,
  ZCR_MAX,
  createLevelMeter,
  createVadState,
  frameDbfs,
  frameRms,
  frameSamples,
  gateOpen,
  meterMedianDb,
  pushLevel,
  speakingFromLevel,
  stepVad,
  stepVadDetailed,
  zeroCrossingRate,
} from '../src/engine/vad.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Outils : trames synthétiques
// ─────────────────────────────────────────────────────────────────────────────

const N = FRAME_SAMPLES

/** Amplitude d'une sinusoïde dont le RMS vaut `db` dBFS. */
function ampForDbfs(db: number): number {
  return Math.pow(10, db / 20)
}

/** Trame continue (ZCR = 0) dont le RMS vaut `db` dBFS. */
function dcAtDbfs(db: number): Float32Array {
  return new Float32Array(N).fill(ampForDbfs(db))
}

/** Sinusoïde voisée à 200 Hz (4 périodes par trame, ZCR ≈ 0,008). */
function toneAtDbfs(db: number, frequency = 200): Float32Array {
  const amp = ampForDbfs(db) * Math.SQRT2
  const out = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE)
  }
  return out
}

/** Bruit large bande déterministe : ±amplitude en alternance, ZCR = 1. */
function noiseAtDbfs(db: number): Float32Array {
  const amp = ampForDbfs(db)
  const out = new Float32Array(N)
  for (let i = 0; i < N; i++) out[i] = i % 2 === 0 ? amp : -amp
  return out
}

/** Enchaîne des trames et rend l'état final. */
function run(frames: ReadonlyArray<ArrayLike<number>>) {
  let state = createVadState()
  for (const frame of frames) state = stepVad(state, frame)
  return state
}

function repeat(frame: ArrayLike<number>, times: number): Array<ArrayLike<number>> {
  const out: Array<ArrayLike<number>> = []
  for (let i = 0; i < times; i++) out.push(frame)
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Géométrie des trames
// ─────────────────────────────────────────────────────────────────────────────

test('trame de 20 ms = 960 échantillons à 48 kHz', () => {
  assert.equal(SAMPLE_RATE, 48000)
  assert.equal(FRAME_MS, 20)
  assert.equal(FRAME_SAMPLES, 960)
  assert.equal(frameSamples(), 960)
  assert.equal(frameSamples(DEFAULT_VAD_CONFIG), 960)
  // 16 kHz (téléphone) : 20 ms = 320 échantillons, même durée.
  assert.equal(frameSamples({ ...DEFAULT_VAD_CONFIG, sampleRate: 16000 }), 320)
  // Configuration absurde : on retombe sur la référence, jamais NaN.
  assert.equal(frameSamples({ ...DEFAULT_VAD_CONFIG, sampleRate: 0 }), 960)
})

test('niveau dBFS : RMS, plancher −100, aucune valeur non finie', () => {
  assert.ok(Math.abs(frameDbfs(dcAtDbfs(0)) - 0) < 1e-9)
  assert.ok(Math.abs(frameDbfs(dcAtDbfs(-6)) + 6) < 1e-6)
  assert.ok(Math.abs(frameDbfs(toneAtDbfs(-20)) + 20) < 1e-6)
  // Silence exact → plancher, jamais -Infinity (le vumètre doit rester fini).
  assert.equal(frameDbfs(new Float32Array(N)), MIN_DBFS)
  assert.equal(frameDbfs(new Float32Array(0)), MIN_DBFS)
  assert.equal(frameDbfs(new Float32Array([NaN, NaN, NaN])), MIN_DBFS)
  assert.ok(Math.abs(frameRms(new Float32Array([NaN, 1, 1])) - Math.sqrt(2 / 3)) < 1e-12)
  assert.equal(frameRms(new Float32Array(0)), 0)
})

test('taux de passage par zéro : continu, alterné, voisé', () => {
  assert.equal(zeroCrossingRate(dcAtDbfs(-20)), 0)
  assert.equal(zeroCrossingRate(noiseAtDbfs(-20)), 1)
  assert.ok(zeroCrossingRate(toneAtDbfs(-20, 200)) < 0.05)
  assert.ok(zeroCrossingRate(toneAtDbfs(-20, 200)) <= ZCR_MAX)
  assert.ok(zeroCrossingRate(noiseAtDbfs(-20)) > ZCR_MAX)
  assert.equal(zeroCrossingRate(new Float32Array([1])), 0)
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Attaque
// ─────────────────────────────────────────────────────────────────────────────

test('attaque : une seule trame forte n’ouvre pas, la deuxième oui', () => {
  assert.equal(ATTACK_FRAMES, 2)
  const loud = toneAtDbfs(-26)

  const first = stepVad(createVadState(), loud)
  assert.equal(first.speaking, false, 'une trame ne suffit pas')
  assert.equal(first.aboveFrames, 1)
  assert.equal(first.changedAtFrame, NO_CHANGE_FRAME)
  assert.equal(first.frame, 1)
  assert.ok(Math.abs(first.levelDb + 26) < 1e-6)

  const second = stepVad(first, loud)
  assert.equal(second.speaking, true, 'deuxième trame consécutive : ouverture')
  assert.equal(second.changedAtFrame, 1, 'index de la trame qui a décidé (0-based)')
  assert.equal(second.aboveFrames, 0, 'compteur remis à zéro après ouverture')

  const third = stepVad(second, loud)
  assert.equal(third.speaking, true)
  assert.equal(third.changedAtFrame, 1, 'changedAtFrame ne bouge plus')
})

test('attaque : une trame forte isolée entre deux silences n’ouvre jamais', () => {
  const state = run([
    new Float32Array(N),
    toneAtDbfs(-20),
    new Float32Array(N),
    toneAtDbfs(-20),
  ])
  assert.equal(state.speaking, false)
  assert.equal(state.aboveFrames, 1)
  assert.equal(state.changedAtFrame, NO_CHANGE_FRAME)
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Hystérésis et bornes
// ─────────────────────────────────────────────────────────────────────────────

test('hystérésis : la zone −45…−38 dBFS ne referme pas la porte', () => {
  assert.equal(OPEN_DBFS, -38)
  assert.equal(CLOSE_DBFS, -45)
  const opened = run([toneAtDbfs(-20), toneAtDbfs(-20)])
  assert.equal(opened.speaking, true)

  const state = run([
    toneAtDbfs(-20),
    toneAtDbfs(-20),
    ...repeat(toneAtDbfs(-41), 30),
  ])
  assert.equal(state.speaking, true, 'la zone d’hystérésis maintient la porte ouverte')
  assert.equal(state.belowFrames, 0, 'pas sous le seuil de fermeture → compteur à zéro')
  assert.equal(state.changedAtFrame, 1)
})

test('bornes : −38 dBFS ouvre, −45 dBFS ferme (tolérance flottante 1e-6 dB)', () => {
  const justAbove = run([toneAtDbfs(OPEN_DBFS + 1e-6), toneAtDbfs(OPEN_DBFS + 1e-6)])
  assert.equal(justAbove.speaking, true, 'juste au-dessus de −38 dBFS : ouverture')

  const justBelow = run([toneAtDbfs(OPEN_DBFS - 1e-3), toneAtDbfs(OPEN_DBFS - 1e-3)])
  assert.equal(justBelow.speaking, false, 'juste en dessous de −38 dBFS : pas d’ouverture')

  const holding = run([
    ...repeat(toneAtDbfs(-20), 2),
    ...repeat(toneAtDbfs(CLOSE_DBFS + 1e-3), RELEASE_FRAMES),
  ])
  assert.equal(holding.speaking, true, 'juste au-dessus de −45 dBFS : la porte tient')

  const closed = run([
    ...repeat(toneAtDbfs(-20), 2),
    ...repeat(toneAtDbfs(CLOSE_DBFS - 1e-6), RELEASE_FRAMES),
  ])
  assert.equal(closed.speaking, false, 'juste sous −45 dBFS : fermeture')
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. Relâche (hangover)
// ─────────────────────────────────────────────────────────────────────────────

test('relâche : ferme à la 6e trame de silence, pas avant', () => {
  assert.equal(RELEASE_FRAMES, 6)
  const open = run([toneAtDbfs(-20), toneAtDbfs(-20)])
  assert.equal(open.speaking, true)
  assert.equal(open.changedAtFrame, 1)

  let state = open
  for (let i = 1; i <= RELEASE_FRAMES - 1; i++) {
    state = stepVad(state, new Float32Array(N))
    assert.equal(state.speaking, true, `trame de silence ${i} : encore ouvert (hangover)`)
    assert.equal(state.belowFrames, i)
    assert.equal(state.changedAtFrame, 1)
  }

  state = stepVad(state, new Float32Array(N))
  assert.equal(state.speaking, false, `trame de silence ${RELEASE_FRAMES} : fermeture`)
  assert.equal(state.changedAtFrame, 1 + RELEASE_FRAMES, 'changée à la 6e trame de silence')
  assert.equal(state.levelDb, MIN_DBFS)
  assert.equal(state.belowFrames, 0, 'compteur remis à zéro après fermeture')
})

test('relâche : un pic dans le hangover remet le compteur à zéro', () => {
  let state = run([toneAtDbfs(-20), toneAtDbfs(-20)])
  for (let i = 0; i < 5; i++) state = stepVad(state, new Float32Array(N))
  assert.equal(state.belowFrames, 5)
  // Une trame à −30 dBFS (au-dessus de la fermeture) relance le hangover.
  state = stepVad(state, toneAtDbfs(-30))
  assert.equal(state.speaking, true)
  assert.equal(state.belowFrames, 0)
  for (let i = 0; i < 5; i++) state = stepVad(state, new Float32Array(N))
  assert.equal(state.speaking, true, 'il faut de nouveau 6 trames pleines')
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. Cas limites et déterminisme
// ─────────────────────────────────────────────────────────────────────────────

test('garde-fou ZCR : un bruit fort n’ouvre pas la porte', () => {
  const state = run(repeat(noiseAtDbfs(-10), 10))
  assert.equal(state.speaking, false, '−10 dBFS mais ZCR = 1 : ce n’est pas de la voix')
  assert.equal(state.changedAtFrame, NO_CHANGE_FRAME)
  assert.ok(state.levelDb > OPEN_DBFS, 'le niveau, lui, est bien au-dessus du seuil')
})

test('configuration : attaque 0 ouvre tout de suite, relâche 1 ferme tout de suite', () => {
  const instant = { ...DEFAULT_VAD_CONFIG, attackFrames: 0, releaseFrames: 1, zcrMax: 1 }
  let state = stepVad(createVadState(instant), toneAtDbfs(-20), instant)
  assert.equal(state.speaking, true)
  assert.equal(state.changedAtFrame, 0)
  state = stepVad(state, new Float32Array(N), instant)
  assert.equal(state.speaking, false)
  assert.equal(state.changedAtFrame, 1)
})

test('déterminisme : même état + même trame ⇒ même résultat, état non muté', () => {
  const base = run([toneAtDbfs(-20)])
  const snapshot = { ...base }
  const frame = toneAtDbfs(-25)

  const a = stepVadDetailed(base, frame)
  const b = stepVadDetailed(base, frame)
  assert.deepEqual(a.state, b.state)
  assert.deepEqual(base, snapshot, 'l’état d’entrée n’est jamais modifié')

  const frames = [toneAtDbfs(-20), toneAtDbfs(-20), new Float32Array(N), new Float32Array(N)]
  assert.deepEqual(run(frames), run(frames))
})

test('état initial : porte fermée, aucune trame, aucun changement', () => {
  const state = createVadState()
  assert.equal(state.speaking, false)
  assert.equal(state.levelDb, MIN_DBFS)
  assert.equal(state.changedAtFrame, NO_CHANGE_FRAME)
  assert.equal(state.frame, 0)
  assert.equal(state.aboveFrames, 0)
  assert.equal(state.belowFrames, 0)
})

test('push-to-talk : micro coupé au repos, ouvert pendant l’appui', () => {
  // En PTT, la VAD ne commande pas : la porte suit l'appui, sans attaque ni hangover.
  assert.equal(gateOpen('ptt', true, false), false, 'au repos, micro coupé même si la VAD parle')
  assert.equal(gateOpen('ptt', false, true), true, 'appui maintenu : ouverture immédiate')
  assert.equal(gateOpen('ptt', false, false), false)
  // En VAD, c'est la décision de la porte qui fait foi, l'appui est ignoré.
  assert.equal(gateOpen('vad', true, false), true)
  assert.equal(gateOpen('vad', false, true), false)
})

test('vumètre : fenêtre de 3 s, médiane du plancher de bruit', () => {
  assert.equal(METER_WINDOW_FRAMES, 150)
  let meter = createLevelMeter()
  assert.equal(meter.values.length, METER_WINDOW_FRAMES)
  assert.equal(meterMedianDb(meter), null, 'vumètre vide : aucune estimation')

  meter = pushLevel(meter, -70)
  meter = pushLevel(meter, -66)
  meter = pushLevel(meter, -68)
  assert.equal(meterMedianDb(meter), -68)
  assert.equal(meter.filled, 3)

  meter = pushLevel(meter, NaN)
  assert.equal(meterMedianDb(meter), -68, 'une entrée non finie ne pollue pas la médiane')

  for (let i = 0; i < 200; i++) meter = pushLevel(meter, -50)
  assert.equal(meter.filled, METER_WINDOW_FRAMES, 'la fenêtre est bornée à 150 trames')
  assert.equal(meterMedianDb(meter), -50)
})

// ─────────────────────────────────────────────────────────────────────────────
// AD-17 / D5 — `speakingFromLevel` : la MÊME définition de « parle », côté distant
// ─────────────────────────────────────────────────────────────────────────────

test('AD-17 / D5 — une seule définition : les constantes de la porte, pas un second seuil', () => {
  // Ce test ne lit pas le code : il mesure que la porte distante obéit EXACTEMENT
  // aux constantes publiées. Si quelqu'un ajoutait un seuil distant (-40, -35…),
  // ces mesures le trahiraient.
  let state = createVadState()
  const justAbove = OPEN_DBFS + 0.5
  const justBelow = CLOSE_DBFS - 0.5

  state = speakingFromLevel(state, justAbove)
  assert.equal(state.speaking, false, 'une trame au-dessus de -38 dBFS ne suffit pas')
  state = speakingFromLevel(state, justAbove)
  assert.equal(state.speaking, true, 'deux trames (40 ms) : la parole est ouverte')

  // Zone d'hystérésis : entre -45 et -38, on ne ferme pas.
  for (let i = 0; i < RELEASE_FRAMES * 2; i++) state = speakingFromLevel(state, -42)
  assert.equal(state.speaking, true, 'l’hystérésis tient la porte ouverte entre -45 et -38')

  for (let i = 0; i < RELEASE_FRAMES - 1; i++) state = speakingFromLevel(state, justBelow)
  assert.equal(state.speaking, true, `${RELEASE_FRAMES - 1} trames sous -45 ne relâchent pas`)
  state = speakingFromLevel(state, justBelow)
  assert.equal(state.speaking, false, `${RELEASE_FRAMES} trames (120 ms) relâchent`)
})

test('AD-17 / D5 — l’émetteur et le pair distant rendent le MÊME verdict sur le même son', () => {
  // Trame voisée (ZCR faible) à -20 dBFS : le micro local juge « voisé && fort ».
  // Le pair distant ne reçoit que le niveau, et doit conclure pareil, trame pour trame.
  const loud = toneAtDbfs(-20)
  let local = createVadState()
  let remote = createVadState()
  const verdicts: Array<{ local: boolean; remote: boolean }> = []
  for (let i = 0; i < 10; i++) {
    local = stepVad(local, loud)
    remote = speakingFromLevel(remote, frameDbfs(loud))
    verdicts.push({ local: local.speaking, remote: remote.speaking })
  }
  assert.deepEqual(
    verdicts.map((v) => v.local),
    verdicts.map((v) => v.remote),
    'aucune divergence possible : une seule machine, une seule paire de seuils',
  )
  assert.equal(local.changedAtFrame, remote.changedAtFrame, 'et la même trame de bascule')
})

test('AD-17 / D5 — niveau inconnu (NaN, ±∞) : la porte ne s’ouvre pas sur une non-mesure', () => {
  let state = createVadState()
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 0, Number.NaN]) {
    state = speakingFromLevel(state, value)
    // Une valeur non finie est bornée au plancher, donc jamais « forte ».
    assert.equal(state.speaking, false, `aucune parole déduite de ${String(value)}`)
  }
  assert.equal(state.levelDb, MIN_DBFS, 'le niveau retenu est le plancher, pas 0 dBFS')
})

test('AD-17 / D5 — pureté : `prev` n’est jamais muté, deux appels identiques donnent le même état', () => {
  const prev = createVadState()
  const snapshot = { ...prev }
  const a = speakingFromLevel(prev, -30)
  const b = speakingFromLevel(prev, -30)
  assert.deepEqual(prev, snapshot, 'l’état reçu reste intact')
  assert.deepEqual(a, b, 'même entrée, même sortie : aucune horloge, aucun aléa')
  assert.equal(a.frame, 1, 'le temps se compte en trames de 20 ms')
})
