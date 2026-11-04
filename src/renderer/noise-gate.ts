/**
 * src/renderer/noise-gate.ts — porte de bruit avant le filtre vocal
 *
 * Le RNNoise de Chromium vit sur la piste de capture (`noiseSuppression`). Cette porte
 * est le second étage, DANS notre graphe, donc APRÈS l'annulation d'écho du navigateur
 * et AVANT le filtre vocal : elle coupe le fond sous le seuil, y compris pendant qu'on
 * tient le push-to-talk (la piste envoyée est ouverte, le bruit de la pièce partait
 * avec la voix).
 *
 * La décision est une fonction pure (`processNoiseGate`), testée hors navigateur.
 * L'AudioWorklet rejoue une chaîne autonome : `toString()` du bundle appelait
 * `noiseGateLinear` et `NOISE_GATE_HYSTERESIS_DB`, absents du worklet. Le
 * constructeur jetait, le nœud mort remplaçait le pont, et toute la voix
 * (porte allumée par défaut) sortait silence.
 */

import { noteVoiceBypass } from './voice-character.ts'

/** Écart d'hystérésis sous le seuil d'ouverture, en dB. */
export const NOISE_GATE_HYSTERESIS_DB = 8

export interface NoiseGateState {
  envelope: number
  gain: number
  /** Amplitude linéaire d'ouverture. */
  open: number
  /** Amplitude linéaire de fermeture (hystérésis). */
  close: number
  speaking: boolean
  attackEnv: number
  releaseEnv: number
  attackGain: number
  releaseGain: number
}

/** dB → amplitude linéaire. Un seuil non fini retombe sur −40 dBFS. */
export function noiseGateLinear(thresholdDb: number): number {
  const db = Number.isFinite(thresholdDb) ? thresholdDb : -40
  return 10 ** (db / 20)
}

export function createNoiseGateState(sampleRate: number, thresholdDb: number): NoiseGateState {
  const rate = sampleRate > 0 ? sampleRate : 48000
  const open = noiseGateLinear(thresholdDb)
  const close = noiseGateLinear(thresholdDb - NOISE_GATE_HYSTERESIS_DB)
  return {
    envelope: 0,
    gain: 0,
    open,
    close,
    speaking: false,
    // Constantes DANS l'état : `processNoiseGate` ne referme rien du module
    // (le worklet n'aurait pas ces liaisons).
    attackEnv: Math.exp(-1 / (rate * 0.005)),
    releaseEnv: Math.exp(-1 / (rate * 0.06)),
    attackGain: Math.exp(-1 / (rate * 0.008)),
    releaseGain: Math.exp(-1 / (rate * 0.12)),
  }
}

/**
 * Une trame de porte. L'enveloppe suit la puissance, l'hystérésis évite le
 * cliquetis au seuil, le gain est lissé (attaque courte, relâche ~120 ms)
 * pour ne pas couper la fin des mots.
 */
export function processNoiseGate(state: NoiseGateState, input: Float32Array, output: Float32Array): void {
  const n = input.length < output.length ? input.length : output.length
  for (let i = 0; i < n; i += 1) {
    const x = input[i] ?? 0
    const power = x * x
    const envCoeff = power > state.envelope ? state.attackEnv : state.releaseEnv
    state.envelope = envCoeff * state.envelope + (1 - envCoeff) * power
    const level = Math.sqrt(state.envelope)
    if (level >= state.open) state.speaking = true
    else if (level <= state.close) state.speaking = false
    const target = state.speaking ? 1 : 0
    const gCoeff = target > state.gain ? state.attackGain : state.releaseGain
    state.gain = gCoeff * state.gain + (1 - gCoeff) * target
    output[i] = x * state.gain
  }
  for (let i = n; i < output.length; i += 1) output[i] = 0
}

export interface NoiseGateAudioContext {
  readonly sampleRate: number
  createGain(): NoiseGateGain
  audioWorklet?: { addModule(url: string): Promise<void> }
}

export interface NoiseGateNodeLike {
  connect(destination: NoiseGateNodeLike): void
  disconnect(): void
  gain?: { value: number }
}

export interface NoiseGateGain extends NoiseGateNodeLike {}

export interface NoiseGateNode {
  readonly input: NoiseGateNodeLike
  readonly output: NoiseGateNodeLike
  close(): void
}

export type NoiseGateWorkletFactory = (
  context: NoiseGateAudioContext,
  name: string,
  options: AudioWorkletNodeOptions,
) => NoiseGateNodeLike

const defaultWorkletFactory: NoiseGateWorkletFactory = (context, name, options) => {
  if (typeof AudioWorkletNode !== 'function') throw new Error('AudioWorkletNode indisponible')
  return new AudioWorkletNode(context as BaseAudioContext, name, options)
}

/**
 * Source du worklet. Chaîne littérale : le minificateur n'y entre pas, et aucune
 * liaison du module (`noiseGateLinear`, la constante d'hystérésis) n'est requise.
 */
export function noiseGateWorkletSource(): string {
  return `
function noiseGateLinear(thresholdDb) {
  const db = Number.isFinite(thresholdDb) ? thresholdDb : -40
  return 10 ** (db / 20)
}
function createNoiseGateState(sampleRate, thresholdDb) {
  const rate = sampleRate > 0 ? sampleRate : 48000
  const open = noiseGateLinear(thresholdDb)
  const close = noiseGateLinear(thresholdDb - 8)
  return {
    envelope: 0,
    gain: 0,
    open: open,
    close: close,
    speaking: false,
    attackEnv: Math.exp(-1 / (rate * 0.005)),
    releaseEnv: Math.exp(-1 / (rate * 0.06)),
    attackGain: Math.exp(-1 / (rate * 0.008)),
    releaseGain: Math.exp(-1 / (rate * 0.12)),
  }
}
function processNoiseGate(state, input, output) {
  const n = input.length < output.length ? input.length : output.length
  for (let i = 0; i < n; i += 1) {
    const x = input[i] ?? 0
    const power = x * x
    const envCoeff = power > state.envelope ? state.attackEnv : state.releaseEnv
    state.envelope = envCoeff * state.envelope + (1 - envCoeff) * power
    const level = Math.sqrt(state.envelope)
    if (level >= state.open) state.speaking = true
    else if (level <= state.close) state.speaking = false
    const target = state.speaking ? 1 : 0
    const gCoeff = target > state.gain ? state.attackGain : state.releaseGain
    state.gain = gCoeff * state.gain + (1 - gCoeff) * target
    output[i] = x * state.gain
  }
  for (let i = n; i < output.length; i += 1) output[i] = 0
}
class ConcordNoiseGate extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const o = (options && options.processorOptions) || {}
    const db = typeof o.thresholdDb === 'number' ? o.thresholdDb : -40
    this.state = createNoiseGateState(sampleRate, db)
    this.bad = 0
    this.tripped = false
    this.readyPosted = false
    this.seen = 0
    this.forceSilence = o.forceSilence === true
  }
  keepDry(input, output) {
    const n = input.length < output.length ? input.length : output.length
    if (this.tripped) {
      for (let i = 0; i < n; i += 1) {
        const x = input[i]
        output[i] = x === x ? x : 0
      }
      for (let i = n; i < output.length; i += 1) output[i] = 0
      return
    }
    let inE = 0
    let outE = 0
    let nan = false
    for (let i = 0; i < n; i += 1) {
      const x = input[i]
      const xx = x === x ? x : 0
      let y = output[i]
      if (y !== y) {
        nan = true
        y = 0
        output[i] = 0
      }
      inE += xx * xx
      outE += y * y
    }
    if (inE > n * 0.0001 && (nan || outE < n * 0.000001)) this.bad += n
    else this.bad = 0
    if (this.bad < sampleRate * 0.5) return
    this.tripped = true
    for (let i = 0; i < n; i += 1) {
      const x = input[i]
      output[i] = x === x ? x : 0
    }
    this.port.postMessage({ type: 'fallback', reason: 'silence', processor: 'concord-noise-gate' })
  }
  process(inputs, outputs) {
    const inputChannels = inputs[0] || []
    const outputChannels = outputs[0] || []
    const input = inputChannels[0]
    const output = outputChannels[0]
    if (!input || !output) return true
    if (this.tripped) this.keepDry(input, output)
    else if (this.forceSilence) {
      for (let i = 0; i < output.length; i += 1) output[i] = 0
      this.keepDry(input, output)
    } else {
      processNoiseGate(this.state, input, output)
      this.keepDry(input, output)
    }
    for (let c = 1; c < outputChannels.length; c += 1) {
      const channel = outputChannels[c]
      if (channel && channel.set) channel.set(output)
    }
    this.seen += input.length
    if (!this.tripped && !this.readyPosted && this.seen >= sampleRate * 0.04) {
      this.readyPosted = true
      this.port.postMessage({ type: 'ready', processor: 'concord-noise-gate' })
    }
    return true
  }
}
registerProcessor('concord-noise-gate', ConcordNoiseGate)
`
}

const gateReady = new WeakMap<object, Promise<void>>()

function loadNoiseGateWorklet(
  context: object,
  worklet: { addModule(url: string): Promise<void> },
): Promise<void> {
  const cached = gateReady.get(context)
  if (cached !== undefined) return cached
  const url = URL.createObjectURL(new Blob([noiseGateWorkletSource()], { type: 'application/javascript' }))
  const pending = worklet.addModule(url).then(
    () => undefined,
    (error: unknown) => {
      gateReady.delete(context)
      throw error
    },
  )
  gateReady.set(context, pending)
  void pending.finally(() => {
    URL.revokeObjectURL(url)
  }).catch(() => undefined)
  return pending
}

export interface NoiseGateOptions {
  readonly workletNodeFactory?: NoiseGateWorkletFactory | null
}

/**
 * Porte insérée dans le graphe. Sans worklet, le pont laisse passer la voix
 * (mieux qu'un micro coupé). Avec worklet, l'entrée et la sortie sont deux gains
 * distincts et le processeur est ENTRE les deux.
 */
export function createNoiseGateNode(
  context: NoiseGateAudioContext,
  thresholdDb: number,
  options: NoiseGateOptions = {},
): NoiseGateNode {
  const input = context.createGain()
  const output = context.createGain()
  if (input.gain !== undefined) input.gain.value = 1
  if (output.gain !== undefined) output.gain.value = 1
  const passthrough = (): NoiseGateNode => {
    input.connect(output)
    return {
      input,
      output,
      close(): void {
        try {
          input.disconnect()
        } catch {
          // Déjà coupé.
        }
        try {
          output.disconnect()
        } catch {
          // Déjà coupé.
        }
      },
    }
  }
  const worklet = context.audioWorklet
  if (worklet === undefined || typeof worklet.addModule !== 'function') return passthrough()
  const makeNode = options.workletNodeFactory ?? defaultWorkletFactory
  if (makeNode === defaultWorkletFactory && typeof AudioWorkletNode !== 'function') return passthrough()
  let processor: NoiseGateNodeLike | null = null
  let closed = false
  let tripped = false
  const dry = context.createGain()
  const wet = context.createGain()
  const setGain = (node: NoiseGateNodeLike, value: number): void => {
    if (node.gain !== undefined) node.gain.value = value
  }
  setGain(dry, 1)
  setGain(wet, 0)
  input.connect(dry)
  dry.connect(output)
  wet.connect(output)
  const goWet = (): void => {
    if (tripped || closed) return
    setGain(wet, 1)
    setGain(dry, 0)
  }
  const goDry = (): void => {
    tripped = true
    setGain(dry, 1)
    setGain(wet, 0)
    console.warn('[noise-gate] sortie muette — voix sèche rétablie')
    noteVoiceBypass('silence')
  }
  try {
    void loadNoiseGateWorklet(context, worklet).then(
      () => {
        if (closed || tripped) return
        try {
          const node = makeNode(context, 'concord-noise-gate', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1],
            channelCount: 1,
            channelCountMode: 'explicit',
            processorOptions: { thresholdDb },
          })
          const port = (node as { port?: { onmessage: ((event: MessageEvent) => void) | null } }).port
          if (port !== undefined) {
            port.onmessage = (event: MessageEvent) => {
              const data = event.data as { type?: string } | null
              if (data?.type === 'ready') goWet()
              else if (data?.type === 'fallback') goDry()
            }
          }
          input.connect(node)
          node.connect(wet)
          processor = node
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error)
          console.error(`[noise-gate] AudioWorklet refusé — porte inactive, voix brute conservée (${detail})`)
        }
      },
      (error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error)
        console.error(`[noise-gate] AudioWorklet refusé — porte inactive, voix brute conservée (${detail})`)
      },
    )
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error(`[noise-gate] AudioWorklet refusé — porte inactive, voix brute conservée (${detail})`)
  }
  return {
    input,
    output,
    close(): void {
      closed = true
      if (processor !== null) {
        try {
          processor.disconnect()
        } catch {
          // Déjà coupé.
        }
        processor = null
      }
      for (const node of [input, output, dry, wet]) {
        try {
          node.disconnect()
        } catch {
          // Déjà coupé.
        }
      }
    },
  }
}
