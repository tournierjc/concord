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
 * L'AudioWorklet rejoue CE corps (`toString()`), pas une copie qui dérive.
 */

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
 * Nom réellement déclaré par `toString()` après minification. `keepNames` préserve
 * `.name`, pas le texte : la classe doit appeler la liaison (`function Xr`), sinon
 * `addModule` lève ReferenceError et la porte reste un pont silencieux.
 */
function workletBinding(fn: Function): string {
  const match = /^function\s+([A-Za-z0-9_$]+)/.exec(fn.toString())
  if (match?.[1] === undefined) throw new Error('AudioWorklet: fonction sans déclaration')
  return match[1]
}

/** Source du worklet : les deux fonctions pures, puis le processeur qui les appelle. */
export function noiseGateWorkletSource(): string {
  const create = workletBinding(createNoiseGateState)
  const process = workletBinding(processNoiseGate)
  return `
${createNoiseGateState.toString()}
${processNoiseGate.toString()}
class ConcordNoiseGate extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const opts = (options && options.processorOptions) || {}
    const db = typeof opts.thresholdDb === 'number' ? opts.thresholdDb : -40
    this.state = ${create}(sampleRate, db)
  }
  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0]
    const output = outputs[0] && outputs[0][0]
    if (!input || !output) return true
    ${process}(this.state, input, output)
    return true
  }
}
registerProcessor('concord-noise-gate', ConcordNoiseGate)
`
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
  input.connect(output)
  try {
    const url = URL.createObjectURL(new Blob([noiseGateWorkletSource()], { type: 'application/javascript' }))
    void worklet
      .addModule(url)
      .then(() => {
        if (closed) return
        const node = makeNode(context, 'concord-noise-gate', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 1,
          channelCountMode: 'explicit',
          processorOptions: { thresholdDb },
        })
        try {
          input.disconnect()
        } catch {
          // Pont déjà coupé.
        }
        input.connect(node)
        node.connect(output)
        processor = node
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error)
        console.error(`[noise-gate] AudioWorklet refusé — porte inactive, voix brute conservée (${detail})`)
      })
      .finally(() => {
        URL.revokeObjectURL(url)
      })
  } catch {
    return passthrough()
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
