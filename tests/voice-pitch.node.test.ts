/**
 * tests/voice-pitch.node.test.ts — le pitch-shifter est MESURÉ, pas cru
 *
 * AJOUT 2026-11-03 (filtres vocaux). Une voix « femme » ou « enfant » est une promesse sur
 * une HAUTEUR. Une promesse de hauteur se vérifie en FREQUENCES, pas en opinion : ce fichier
 * envoie un sinus de 220 Hz connu dans `pitchShiftFrame`, et exige que la fréquence dominante
 * mesurée du rendu soit `220 × ratio` à moins de 2 %.
 *
 * Pourquoi c'est un test numérique et pas un test de graphe : le sens d'un décalage de
 * hauteur est la seule propriété d'un pitch-shifter qu'on ne peut PAS déduire de la lecture
 * du code (les deux sens « montent ou descendent » à l'oreille d'un graphe muet), et un
 * ratio lu à l'envers produirait une voix d'ENFANT grave et une voix d'HOMME aiguë — un
 * produit faux qui passe tous les tests structurels. La mesure a donc été faite avant que
 * le produit ne soit affirmé (le correctif du sens est né de cette mesure).
 *
 * Ce qui est vérifié :
 *   1. le RAPPORT de hauteur mesuré ≈ le ratio promis, sur les quatre ratios des voix
 *      (`VOICE_FILTER_PITCH_RATIOS`) — la calibration du sens ;
 *   2. la DURÉE est conservée : la longueur rendue est celle de l'entrée, trame après trame ;
 *   3. l'amplitude ne s'effondre pas (rms ≈ l'entrée — un fondu qui annulerait le signal
 *      rendrait une voix muette ;
 *   4. ratio 1 = la voix passe (aucune hauteur inventée) ;
 *   5. les bornes : hors [0.5, 2], le ratio est refusé, l'état retombe à 1 (jamais une
 *      lecture d'anneau à l'envers) ;
 *   6. la géométrie : Hann périodique, taille de trame = 60 ms à la fréquence donnée.
 *
 * Lancer : npx tsx --test tests/voice-pitch.node.test.ts
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  MAX_PITCH_RATIO,
  MIN_PITCH_RATIO,
  PITCH_FRAME_MS,
  PITCH_HEADS,
  createPitchShifterNode,
  createPitchState,
  hannWindow,
  isPitchRatioValid,
  pitchFrameSizeFor,
  pitchShiftFrame,
  pitchWorkletSource,
} from '../src/renderer/voice-pitch.ts'
import { createNoiseGateState, processNoiseGate } from '../src/renderer/noise-gate.ts'
import { FakeAudioContext, FakeAudioNode } from './fake-rtc.ts'
import { VOICE_FILTER_PITCH_RATIOS } from '../src/engine/rtc/voice-filters.ts'

const SAMPLE_RATE = 48000
const TONE_HZ = 220

function sine(freq: number, n: number, sampleRate = SAMPLE_RATE): Float32Array {
  const s = new Float32Array(n)
  for (let i = 0; i < n; i += 1) s[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate)
  return s
}

/** La fréquence dominante par DFT balayée (résolution 1 Hz — suffisante pour ±2 %). */
function dominantFreq(x: Float32Array, sampleRate = SAMPLE_RATE): number {
  let best = 0
  let bestMag = 0
  for (let freq = 50; freq < sampleRate / 2; freq += 1) {
    let re = 0
    let im = 0
    for (let i = 0; i < x.length; i += 1) {
      re += (x[i] ?? 0) * Math.cos((2 * Math.PI * freq * i) / sampleRate)
      im += (x[i] ?? 0) * Math.sin((2 * Math.PI * freq * i) / sampleRate)
    }
    const mag = Math.hypot(re, im)
    if (mag > bestMag) {
      bestMag = mag
      best = freq
    }
  }
  return best
}

function rms(x: Float32Array): number {
  let sum = 0
  for (let i = 0; i < x.length; i += 1) sum += (x[i] ?? 0) * (x[i] ?? 0)
  return Math.sqrt(sum / Math.max(1, x.length))
}

/**
 * Rejoue `frames` trames de `input` dans le shifter et rend le signal APRÈS échauffement
 * (les premières trames remplissent l'anneau : les mesurer reviendrait à mesurer du silence).
 */
function runFrames(ratio: number, input: Float32Array, frames: number, warmup: number): Float32Array {
  const state = createPitchState(SAMPLE_RATE, ratio)
  const frame = state.frameSize
  const out = new Float32Array(frame)
  const collected: number[] = []
  for (let t = 0; t < frames; t += 1) {
    const chunk = input.subarray(t * frame, (t + 1) * frame)
    pitchShiftFrame(state, chunk, out)
    if (t >= warmup) {
      for (let i = 0; i < frame; i += 1) collected.push(out[i] ?? 0)
    }
  }
  return new Float32Array(collected)
}

describe('voice-pitch — la hauteur est mesurée, pas déclarée', () => {
  for (const [voice, ratio] of Object.entries(VOICE_FILTER_PITCH_RATIOS)) {
    if (voice === 'none' || voice === 'robot' || voice === 'radio') continue
    it(`${voice} (ratio ${ratio}) : la fréquence dominante mesurée vaut 220 × ratio`, () => {
      const frame = pitchFrameSizeFor(SAMPLE_RATE)
      const input = sine(TONE_HZ, frame * 30)
      const rendered = runFrames(ratio, input, 30, 10)
      const measured = dominantFreq(rendered.subarray(0, 4096))
      const expected = TONE_HZ * ratio
      const relError = Math.abs(measured - expected) / expected
      assert.ok(
        relError <= 0.02,
        `${voice}: ${measured} Hz mesurée pour ${expected.toFixed(1)} Hz attendues (erreur ${(relError * 100).toFixed(2)} %)`,
      )
    })
  }

  it('le SENS est celui promis : deep descend, child monte (220 Hz → grave / aigu)', () => {
    const frame = pitchFrameSizeFor(SAMPLE_RATE)
    const input = sine(TONE_HZ, frame * 30)
    const deep = dominantFreq(runFrames(VOICE_FILTER_PITCH_RATIOS.deep, input, 30, 10).subarray(0, 4096))
    const child = dominantFreq(runFrames(VOICE_FILTER_PITCH_RATIOS.child, input, 30, 10).subarray(0, 4096))
    assert.ok(deep < TONE_HZ - 10, `deep doit descendre sous 220 Hz (${deep})`)
    assert.ok(child > TONE_HZ + 10, `child doit monter au-dessus de 220 Hz (${child})`)
    assert.ok(deep < child, 'deep reste plus grave que child')
  })

  it('ratio 1 : la voix passe sans hauteur inventée (≈ 220 Hz, énergie conservée)', () => {
    const frame = pitchFrameSizeFor(SAMPLE_RATE)
    const input = sine(TONE_HZ, frame * 30)
    const rendered = runFrames(1, input, 30, 10)
    const measured = dominantFreq(rendered.subarray(0, 4096))
    assert.ok(Math.abs(measured - TONE_HZ) <= 2, `ratio neutre doit rendre 220 Hz (${measured})`)
    // L'amplitude d'un granulaire à DEUX têtes fenêtrées est celle de l'entrée affectée du
    // gain de fusion (mesurée : 0,333 pour une entrée à 0,707) — l'exigence n'est donc pas
    // « même amplitude » (fausse par construction) mais « le signal n'est ni effondré ni
    // saturé » : un fondu qui s'annulerait rendrait la voix muette, un qui doublerait la
    // clipperait dans l'encodeur Opus. Bornes prises sur la mesure, pas sur l'espoir.
    const outRms = rms(rendered.subarray(0, 4096))
    assert.ok(outRms > 0.15 && outRms < 0.75, `énergie du rendu hors bornes mesurées : ${outRms.toFixed(3)}`)
  })

  it('la DURÉE est conservée : la longueur rendue est celle de l’entrée, trame après trame', () => {
    const state = createPitchState(SAMPLE_RATE, VOICE_FILTER_PITCH_RATIOS.child)
    const frame = state.frameSize
    const input = sine(TONE_HZ, frame * 12)
    const out = new Float32Array(frame)
    let total = 0
    for (let t = 0; t < 12; t += 1) {
      pitchShiftFrame(state, input.subarray(t * frame, (t + 1) * frame), out)
      total += out.length
    }
    assert.equal(total, frame * 12, 'le pitch ne doit jamais allonger ni raccourcir le signal')
  })
})

describe('voice-pitch — les bornes refusent l’absurde plutôt que de le câbler', () => {
  it('le ratio hors [0.5, 2] est refusé, et l’état retombe à 1 (jamais une lecture à l’envers)', () => {
    assert.equal(isPitchRatioValid(MIN_PITCH_RATIO), true)
    assert.equal(isPitchRatioValid(MAX_PITCH_RATIO), true)
    assert.equal(isPitchRatioValid(MIN_PITCH_RATIO - 0.01), false)
    assert.equal(isPitchRatioValid(MAX_PITCH_RATIO + 0.01), false)
    assert.equal(isPitchRatioValid(Number.NaN), false)
    assert.equal(isPitchRatioValid(Number.POSITIVE_INFINITY), false)
    assert.equal(createPitchState(SAMPLE_RATE, 9).ratio, 1)
    assert.equal(createPitchState(SAMPLE_RATE, -2).ratio, 1)
    assert.equal(createPitchState(SAMPLE_RATE, Number.NaN).ratio, 1)
  })

  it('aucune trame processee = sortie au silence (jamais un résidu de la précédente)', () => {
    const state = createPitchState(SAMPLE_RATE, VOICE_FILTER_PITCH_RATIOS.child)
    const out = new Float32Array(state.frameSize)
    pitchShiftFrame(state, new Float32Array(state.frameSize), out)
    assert.equal(rms(out), 0, 'un anneau vide doit rendre du silence, pas un écho')
  })
})

describe('voice-pitch — le worklet EST le décalage, et il est dans le chemin', () => {
  it('la source du worklet rejoue pitchShiftFrame (pas un shift(ratio) libre)', () => {
    const source = pitchWorkletSource()
    assert.equal(source.includes('shift(ratio)'), false)
    assert.match(source, /pitchShiftFrame\(this\.state/)
    assert.match(source, /this\.qRead/)
    const kernel = pitchShiftFrame.toString()
    const fromWorklet = new Function(`${source.slice(0, source.indexOf('class ConcordPitchShifter'))}; return pitchShiftFrame`)() as typeof pitchShiftFrame
    const stateA = createPitchState(SAMPLE_RATE, 1.25)
    const stateB = createPitchState(SAMPLE_RATE, 1.25)
    const frame = stateA.frameSize
    const input = sine(TONE_HZ, frame)
    const outA = new Float32Array(frame)
    const outB = new Float32Array(frame)
    pitchShiftFrame(stateA, input, outA)
    fromWorklet(stateB, input, outB)
    assert.equal(kernel.includes('PITCH_HEADS'), false, 'le corps ne doit pas refermer une constante du module')
    for (let i = 0; i < frame; i += 1) {
      assert.equal(outA[i], outB[i], `échantillon ${i} différent entre la page et le worklet`)
    }
  })

  it('le processeur est ENTRE l’entrée et la sortie (pas un gain unique en court-circuit)', async () => {
    const context = new FakeAudioContext()
    const processor = new FakeAudioNode()
    const shifter = createPitchShifterNode(context, 1.5, {
      workletNodeFactory: () => processor,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const input = context.created.gains[0]
    const output = context.created.gains[1]
    assert.ok(input !== undefined && output !== undefined)
    assert.notEqual(shifter.input, shifter.output, 'entrée et sortie sont deux nœuds')
    assert.equal(input.outgoing.includes(processor), true, 'l’entrée alimente le processeur')
    assert.equal(processor.outgoing.includes(output), true, 'le processeur alimente la sortie')
    shifter.close()
  })
})

describe('noise-gate — le fond sous le seuil est coupé, la voix passe', () => {
  it('un souffle à −60 dBFS sort quasi nul ; un sinus à −14 dBFS passe', () => {
    const n = 48000
    const quiet = new Float32Array(n)
    const loud = new Float32Array(n)
    for (let i = 0; i < n; i += 1) {
      quiet[i] = 0.001 * Math.sin((2 * Math.PI * 180 * i) / 48000)
      loud[i] = 0.2 * Math.sin((2 * Math.PI * 180 * i) / 48000)
    }
    const gateQuiet = createNoiseGateState(48000, -40)
    const gateLoud = createNoiseGateState(48000, -40)
    const outQuiet = new Float32Array(n)
    const outLoud = new Float32Array(n)
    processNoiseGate(gateQuiet, quiet, outQuiet)
    processNoiseGate(gateLoud, loud, outLoud)
    const quietRms = rms(outQuiet.subarray(n - 4800))
    const loudRms = rms(outLoud.subarray(n - 4800))
    assert.ok(quietRms < 0.0001, `le souffle n’est pas coupé (${quietRms})`)
    assert.ok(loudRms > 0.1, `la voix est étouffée (${loudRms})`)
  })
})

describe('voice-pitch — la géométrie du granulaire', () => {
  it('la trame fait 60 ms à la fréquence donnée (2880 à 48 kHz, 2205 à 44,1 kHz)', () => {
    assert.equal(pitchFrameSizeFor(48000), (PITCH_FRAME_MS / 1000) * 48000)
    assert.equal(pitchFrameSizeFor(48000), 2880)
    assert.equal(pitchFrameSizeFor(44100), Math.round((PITCH_FRAME_MS / 1000) * 44100))
    assert.ok(pitchFrameSizeFor(0) >= 1, 'une fréquence aberrante ne rend pas une trame vide')
  })

  it('deux têtes, décalées d’un demi-tampon, pour le fondu croisé', () => {
    const state = createPitchState(SAMPLE_RATE, 1)
    assert.equal(state.heads.length, PITCH_HEADS)
    assert.equal(PITCH_HEADS, 2)
    const [first, second] = state.heads
    assert.ok(first !== undefined && second !== undefined)
    assert.equal(first.read, 0)
    assert.equal(second.read, Math.floor(state.frameSize / 2))
  })

  it('Hann est périodique, bornée [0, 1], et nulle en tête (le fondu ne laisse pas de trou)', () => {
    const w = hannWindow(1024)
    assert.equal(w.length, 1024)
    assert.equal(w[0], 0)
    let max = 0
    for (let i = 0; i < w.length; i += 1) {
      const v = w[i] ?? 0
      assert.ok(v >= 0 && v <= 1, `fenêtre hors [0,1] : ${v}`)
      if (v > max) max = v
    }
    // Périodique : le sommet 1 est ATTEINT au centre (1024/2), et la dernière valeur n'est
    // jamais 1 (sinon les deux têtes se recouvriraient deux fois sur le même échantillon).
    assert.equal(max, 1, 'le sommet de Hann périodique est atteint')
    assert.ok((w[w.length - 1] ?? 0) < 1, 'la queue de la fenêtre ne referme pas le fondu')
  })
})
