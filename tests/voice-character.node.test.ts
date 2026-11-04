/**
 * tests/voice-character.node.test.ts — femme, enfant et géant déplacent F0 ET l'enveloppe
 *
 * Un train d'impulsions à 120 Hz passé dans des formants d'homme (550 / 950 / 2200 Hz)
 * est la voix synthétique. Le rendu est celui de la page (`renderVoiceCharacter`, blocs
 * de 128). On mesure la fondamentale et le centroïde spectral.
 *
 * Femme et enfant doivent MONTER les deux. Le géant doit DESCENDRE les deux.
 * La latence du grain reste sous 40 ms.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { voiceFilterCharacter } from '../src/engine/rtc/voice-filters.ts'
import {
  VOICE_WORKLET_INLINE_MARK,
  createVoiceCharacterNode,
  createVoiceCharacterState,
  renderVoiceCharacter,
  voiceCharacterWorkletSource,
  voiceProcessorPhase,
  type VoiceCharacterSpec,
} from '../src/renderer/voice-character.ts'
import { FakeAudioContext, FakeAudioNode } from './fake-rtc.ts'

const SAMPLE_RATE = 48000
const SOURCE_F0 = 120

function resonator(
  input: Float32Array<ArrayBuffer>,
  freq: number,
  bandwidth: number,
): Float32Array<ArrayBuffer> {
  const r = Math.exp((-Math.PI * bandwidth) / SAMPLE_RATE)
  const theta = (2 * Math.PI * freq) / SAMPLE_RATE
  const a1 = -2 * r * Math.cos(theta)
  const a2 = r * r
  const gain = (1 - r) * 0.5
  const out = new Float32Array(input.length)
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < input.length; i += 1) {
    const y = gain * (input[i] ?? 0) - a1 * y1 - a2 * y2
    y2 = y1
    y1 = y
    out[i] = y
  }
  return out
}

/** Voix d'homme synthétique : impulsions à 120 Hz, formants masculins. */
function maleVoice(seconds = 1): Float32Array {
  const n = Math.round(SAMPLE_RATE * seconds)
  const pulse = new Float32Array(n)
  const period = Math.round(SAMPLE_RATE / SOURCE_F0)
  for (let i = 0; i < n; i += period) pulse[i] = 1
  let shaped = pulse
  for (const freq of [550, 950, 2200]) shaped = resonator(shaped, freq, 80)
  let energy = 0
  for (let i = 0; i < shaped.length; i += 1) energy += (shaped[i] ?? 0) * (shaped[i] ?? 0)
  const rms = Math.sqrt(energy / shaped.length) || 1
  for (let i = 0; i < shaped.length; i += 1) shaped[i] = ((shaped[i] ?? 0) / rms) * 0.2
  return shaped
}

function fundamentalHz(samples: Float32Array, hintHz: number): number {
  const start = Math.round(SAMPLE_RATE * 0.25)
  const frame = samples.subarray(start, start + 4096)
  const minLag = Math.max(2, Math.round(SAMPLE_RATE / (hintHz * 1.35)))
  const maxLag = Math.min(frame.length - 2, Math.round(SAMPLE_RATE / (hintHz * 0.7)))
  let best = 0
  let bestLag = Math.round(SAMPLE_RATE / hintHz)
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let corr = 0
    let e0 = 0
    let e1 = 0
    for (let i = 0; i < frame.length - lag; i += 2) {
      const a = frame[i] ?? 0
      const b = frame[i + lag] ?? 0
      corr += a * b
      e0 += a * a
      e1 += b * b
    }
    const norm = corr / Math.sqrt(e0 * e1 + 1e-12)
    if (norm > best) {
      best = norm
      bestLag = lag
    }
  }
  return SAMPLE_RATE / bestLag
}

function spectralCentroid(samples: Float32Array): number {
  const start = Math.round(SAMPLE_RATE * 0.3)
  const length = 4096
  const windowed = new Float32Array(length)
  for (let i = 0; i < length; i += 1) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (length - 1))
    windowed[i] = (samples[start + i] ?? 0) * w
  }
  let weighted = 0
  let weight = 0
  for (let freq = 80; freq <= 4000; freq += 20) {
    let re = 0
    let im = 0
    const omega = (2 * Math.PI * freq) / SAMPLE_RATE
    for (let i = 0; i < length; i += 1) {
      const x = windowed[i] ?? 0
      re += x * Math.cos(omega * i)
      im -= x * Math.sin(omega * i)
    }
    const mag = Math.hypot(re, im)
    weighted += freq * mag
    weight += mag
  }
  return weight > 0 ? weighted / weight : 0
}

describe('voice-character — F0 et centroïde sur une voix d’homme synthétique', () => {
  const source = maleVoice()
  const sourceF0 = fundamentalHz(source, SOURCE_F0)
  const sourceCentroid = spectralCentroid(source)

  it('la fixture est bien une fondamentale à 120 Hz', () => {
    assert.ok(Math.abs(sourceF0 - SOURCE_F0) <= 2, `F0 source ${sourceF0}`)
  })

  it('le grain ajoute moins de 40 ms', () => {
    const spec = voiceFilterCharacter('woman')
    assert.ok(spec !== null)
    const state = createVoiceCharacterState(SAMPLE_RATE, spec)
    assert.ok(state.grainCap / SAMPLE_RATE <= 0.04, `latence ${state.grainCap / SAMPLE_RATE}s`)
  })

  for (const id of ['woman', 'child', 'deep'] as const) {
    it(`${id} : la fondamentale et le centroïde suivent la cible`, () => {
      const spec = voiceFilterCharacter(id)
      assert.ok(spec !== null)
      const rendered = renderVoiceCharacter(source, SAMPLE_RATE, spec as VoiceCharacterSpec)
      const targetF0 = SOURCE_F0 * spec.pitchRatio
      const measuredF0 = fundamentalHz(rendered, targetF0)
      const f0Error = Math.abs(measuredF0 - targetF0) / targetF0
      assert.ok(
        f0Error <= 0.05,
        `${id}: F0 ${measuredF0.toFixed(1)} Hz pour ${targetF0.toFixed(1)} Hz (erreur ${(f0Error * 100).toFixed(1)} %)`,
      )
      const centroid = spectralCentroid(rendered)
      const ratio = centroid / sourceCentroid
      if (id === 'woman') {
        assert.ok(measuredF0 >= 200, `${id}: F0 ${measuredF0.toFixed(1)} Hz, plancher 200`)
        assert.ok(ratio >= 1.15, `${id}: centroïde ×${ratio.toFixed(2)} (attendu ≥ 1,15)`)
      } else if (id === 'child') {
        assert.ok(measuredF0 >= 250, `${id}: F0 ${measuredF0.toFixed(1)} Hz, plancher 250`)
        assert.ok(ratio >= 1.3, `${id}: centroïde ×${ratio.toFixed(2)} (attendu ≥ 1,30)`)
      } else {
        assert.ok(ratio <= 0.85, `${id}: centroïde ×${ratio.toFixed(2)} (attendu ≤ 0,85)`)
      }
    })
  }

  it('enfant plus aigu et plus brillant que femme, géant plus grave et plus sombre que la source', () => {
    const woman = voiceFilterCharacter('woman')
    const child = voiceFilterCharacter('child')
    const giant = voiceFilterCharacter('deep')
    assert.ok(woman !== null && child !== null && giant !== null)
    const womanOut = renderVoiceCharacter(source, SAMPLE_RATE, woman)
    const childOut = renderVoiceCharacter(source, SAMPLE_RATE, child)
    const giantOut = renderVoiceCharacter(source, SAMPLE_RATE, giant)
    const womanF0 = fundamentalHz(womanOut, SOURCE_F0 * woman.pitchRatio)
    const childF0 = fundamentalHz(childOut, SOURCE_F0 * child.pitchRatio)
    const giantF0 = fundamentalHz(giantOut, SOURCE_F0 * giant.pitchRatio)
    assert.ok(childF0 > womanF0)
    assert.ok(womanF0 > sourceF0)
    assert.ok(giantF0 < sourceF0)
    const womanC = spectralCentroid(womanOut)
    const childC = spectralCentroid(childOut)
    const giantC = spectralCentroid(giantOut)
    assert.ok(childC > womanC)
    assert.ok(womanC > sourceCentroid)
    assert.ok(giantC < sourceCentroid)
  })
})

/** Voix un peu réelle : F0 qui tremble (±3 %) et amplitude qui scintille (±8 %). */
function jitteredMale(): Float32Array {
  const n = SAMPLE_RATE
  const pulse = new Float32Array(n)
  let i = 0
  while (i < n) {
    const wobble = 1 + 0.03 * Math.sin((2 * Math.PI * 4.5 * i) / SAMPLE_RATE)
    const period = Math.max(1, Math.round((SAMPLE_RATE / SOURCE_F0) * wobble))
    const shimmer = 0.92 + 0.08 * Math.sin((2 * Math.PI * 7 * i) / SAMPLE_RATE)
    pulse[i] = shimmer
    i += period
  }
  let shaped = pulse
  for (const freq of [550, 950, 2200]) shaped = resonator(shaped, freq, 90)
  let energy = 0
  for (let k = 0; k < shaped.length; k += 1) energy += (shaped[k] ?? 0) * (shaped[k] ?? 0)
  const rms = Math.sqrt(energy / shaped.length) || 1
  for (let k = 0; k < shaped.length; k += 1) shaped[k] = ((shaped[k] ?? 0) / rms) * 0.2
  return shaped
}

describe('voice-character — une voyelle instable ne retombe pas sur la période d’origine', () => {
  const source = jitteredMale()

  for (const id of ['woman', 'child', 'deep'] as const) {
    it(`${id} garde la cible de F0 malgré jitter et shimmer`, () => {
      const spec = voiceFilterCharacter(id)
      assert.ok(spec !== null)
      const rendered = renderVoiceCharacter(source, SAMPLE_RATE, spec)
      const targetF0 = SOURCE_F0 * spec.pitchRatio
      const measuredF0 = fundamentalHz(rendered, targetF0)
      const f0Error = Math.abs(measuredF0 - targetF0) / targetF0
      assert.ok(
        f0Error <= 0.08,
        `${id}: F0 ${measuredF0.toFixed(1)} Hz pour ${targetF0.toFixed(1)} Hz (erreur ${(f0Error * 100).toFixed(1)} %)`,
      )
      if (id === 'woman') assert.ok(measuredF0 >= 200)
      if (id === 'child') assert.ok(measuredF0 >= 250)
      if (id === 'deep') assert.ok(measuredF0 <= 80)
    })
  }
})

describe('voice-character — le worklet chargé est le corps inliné, et l’échec est visible', () => {
  it('la chaîne déclare les noms que la classe appelle (pas un toString minifié)', () => {
    const source = voiceCharacterWorkletSource()
    assert.ok(source.includes(VOICE_WORKLET_INLINE_MARK))
    assert.equal(source.includes('.toString()'), false)
    assert.match(source, /function createVoiceCharacterState\(/)
    assert.match(source, /function processVoiceCharacter\(/)
    assert.match(source, /registerProcessor\('concord-voice-character', ConcordVoiceCharacter\)/)
    const grain = new Function(
      `${source.slice(0, source.indexOf('class ConcordVoiceCharacter'))}; return createVoiceCharacterState(48000, { pitchRatio: 1.2, formantScale: 1, highpassHz: 0, tilt: 0, lowShelf: 0, subharmonic: 0, chorus: 0 }).grainCap`,
    )() as number
    assert.equal(grain, Math.round(48000 * 0.03))
  })

  it('le test du micro et l’appel construisent le même processeur', () => {
    const mic = readFileSync(new URL('../src/renderer/mic-check.ts', import.meta.url), 'utf8')
    const filter = readFileSync(new URL('../src/renderer/voice-filter.ts', import.meta.url), 'utf8')
    assert.match(mic, /buildChain: createVoiceFilterChain/)
    assert.match(filter, /createVoiceCharacterNode\(/)
  })

  it('addModule qui résout branche le processeur avec les paramètres ; un rejet laisse le pont et le dit', async () => {
    class RecordingWorklet extends FakeAudioNode {
      readonly name: string
      readonly options: AudioWorkletNodeOptions
      readonly port = { onmessage: null as ((event: MessageEvent) => void) | null }
      constructor(_context: unknown, name: string, options: AudioWorkletNodeOptions) {
        super()
        this.name = name
        this.options = options
      }
    }
    const previousNode = globalThis.AudioWorkletNode
    const previousCreate = URL.createObjectURL
    const previousRevoke = URL.revokeObjectURL
    const previousError = console.error
    const errors: string[] = []
    globalThis.AudioWorkletNode = RecordingWorklet as unknown as typeof AudioWorkletNode
    URL.createObjectURL = () => 'blob:concord-test'
    URL.revokeObjectURL = () => undefined
    console.error = (...args: unknown[]) => {
      errors.push(args.map((part) => String(part)).join(' '))
    }
    const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
    try {
      const spec = voiceFilterCharacter('woman')
      assert.ok(spec !== null)
      const live = new FakeAudioContext()
      let loads = 0
      live.audioWorklet.addModule = async () => {
        loads += 1
      }
      const node = createVoiceCharacterNode(live, spec)
      await flush()
      assert.equal(loads, 1)
      assert.equal(voiceProcessorPhase().phase, 'live')
      const processor = node.input instanceof FakeAudioNode ? node.input.outgoing[0] : undefined
      assert.ok(processor instanceof RecordingWorklet, 'le processeur est entre l’entrée et la sortie')
      assert.equal(processor.name, 'concord-voice-character')
      const options = processor.options.processorOptions as { pitchRatio: number; formantScale: number }
      assert.equal(options.pitchRatio, spec.pitchRatio)
      assert.equal(options.formantScale, spec.formantScale)
      assert.ok(processor.outgoing.includes(node.output as FakeAudioNode))
      createVoiceCharacterNode(live, spec)
      await flush()
      assert.equal(loads, 1, 'le module n’est enregistré qu’une fois par contexte')
      node.close()

      const dead = new FakeAudioContext()
      dead.audioWorklet.addModule = async () => {
        throw new Error('Refused to load the script because it violates the CSP')
      }
      const bridge = createVoiceCharacterNode(dead, spec)
      await flush()
      assert.equal(voiceProcessorPhase().phase, 'fallback')
      assert.match(voiceProcessorPhase().detail, /CSP/)
      assert.ok(errors.some((line) => line.includes('AudioWorklet refusé') && line.includes('CSP')))
      assert.ok(bridge.input instanceof FakeAudioNode)
      assert.equal(bridge.input.disconnectCalls, 0, 'le pont entrée→sortie reste : seul l’égaliseur est entendu')
      assert.ok(bridge.input.outgoing.includes(bridge.output as FakeAudioNode))
      bridge.close()
    } finally {
      globalThis.AudioWorkletNode = previousNode
      URL.createObjectURL = previousCreate
      URL.revokeObjectURL = previousRevoke
      console.error = previousError
    }
  })
})
