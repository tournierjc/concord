/**
 * src/renderer/voice-character.ts — hauteur ET formants, séparément (femme, enfant, géant)
 *
 * Empiler des passe-bande sur la voix ne déplace pas les formants déjà là : un homme
 * reste un homme, un peu égalisé. Ici, chaque grain (un battement glottique) est
 * rééchantillonné pour DÉPLACER l'enveloppe (les formants), puis reposé à un intervalle
 * qui fixe la nouvelle fondamentale. Les deux facteurs sont indépendants.
 *
 * Latence : un grain d'au plus 30 ms (sous les 40 ms demandés). Pas de FFT : une
 * autocorrélation courte par grain, assez légère pour une voix mono.
 *
 * Le corps est autonome (`toString` dans l'AudioWorklet). Les tests hors ligne
 * rejouent la même fonction, par blocs de 128, comme la page.
 */

export interface VoiceCharacterSpec {
  readonly pitchRatio: number
  readonly formantScale: number
  readonly highpassHz: number
  readonly tilt: number
  readonly lowShelf: number
  readonly subharmonic: number
  readonly chorus: number
}

export interface VoiceCharacterState {
  sampleRate: number
  pitchRatio: number
  formantScale: number
  highpassHz: number
  tilt: number
  lowShelf: number
  subharmonic: number
  chorusMix: number
  grainCap: number
  ring: Float32Array
  received: number
  cursor: number
  pulled: number
  lastPeriod: number
  ola: Float32Array
  olaN: Float32Array
  hp1X: number
  hp1Y: number
  hp2X: number
  hp2Y: number
  tiltX: number
  tiltY: number
  shelfY: number
  subSign: number
  subLast: number
  chorusBuf: Float32Array
  chorusPos: number
}

/** Période (échantillons) par autocorrélation normalisée, 70–400 Hz. */
export function detectVoicePeriod(samples: Float32Array, sampleRate: number, previous: number): number {
  const sr = sampleRate > 0 ? sampleRate : 48000
  const minLag = Math.max(2, Math.round(sr / 400))
  const maxLag = Math.min(samples.length - 2, Math.round(sr / 70))
  if (maxLag <= minLag) return previous > 0 ? previous : Math.round(sr / 120)
  let bestLag = previous > minLag && previous < maxLag ? previous : Math.round(sr / 120)
  let best = 0
  const usable = Math.min(samples.length - maxLag, Math.round(sr * 0.02))
  if (usable < 8) return bestLag
  for (let lag = minLag; lag <= maxLag; lag += 2) {
    let corr = 0
    let e0 = 0
    let e1 = 0
    for (let i = 0; i < usable; i += 2) {
      const a = samples[i] ?? 0
      const b = samples[i + lag] ?? 0
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
  if (best < 0.25 && previous > minLag) return previous
  return bestLag
}

function ringAt(state: VoiceCharacterState, index: number): number {
  if (index < 0 || index >= state.received) return 0
  const span = state.ring.length
  if (index < state.received - span) return 0
  return state.ring[index % span] ?? 0
}

function snapPulse(state: VoiceCharacterState, around: number, period: number): number {
  const half = Math.max(1, Math.floor(period / 2))
  let best = around
  let bestV = -1
  for (let i = around - half; i <= around + half; i += 1) {
    const v = Math.abs(ringAt(state, i))
    if (v > bestV) {
      bestV = v
      best = i
    }
  }
  return best
}

function placeGrain(state: VoiceCharacterState, readCenter: number, writeCenter: number, period: number): void {
  const scale = state.formantScale > 0.4 ? state.formantScale : 1
  const hop = Math.max(1, Math.round(period / (state.pitchRatio > 0.05 ? state.pitchRatio : 1)))
  const srcLen = Math.min(state.grainCap, Math.max(period * 2, hop))
  const dstLen = Math.max(8, Math.round(srcLen / scale))
  const midIn = (srcLen - 1) / 2
  const midOut = (dstLen - 1) / 2
  const srcStart = Math.round(readCenter - midIn)
  const dstStart = Math.round(writeCenter - midOut)
  const olaSpan = state.ola.length
  for (let i = 0; i < dstLen; i += 1) {
    const srcPos = midIn + (i - midOut) * scale
    const i0 = Math.floor(srcPos)
    const frac = srcPos - i0
    const a = ringAt(state, srcStart + i0)
    const b = ringAt(state, srcStart + i0 + 1)
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (dstLen - 1))
    const sample = (a + (b - a) * frac) * w
    const at = dstStart + i
    if (at < 0) continue
    const slot = at % olaSpan
    state.ola[slot] = (state.ola[slot] ?? 0) + sample
    state.olaN[slot] = (state.olaN[slot] ?? 0) + w
  }
}

function shapeSample(state: VoiceCharacterState, x: number): number {
  const sr = state.sampleRate
  let y = x
  if (state.highpassHz > 20) {
    const a = Math.exp((-2 * Math.PI * state.highpassHz) / sr)
    const hp1 = a * (state.hp1Y + y - state.hp1X)
    state.hp1X = y
    state.hp1Y = hp1
    const hp2 = a * (state.hp2Y + hp1 - state.hp2X)
    state.hp2X = hp1
    state.hp2Y = hp2
    y = hp2
  }
  if (state.tilt !== 0) {
    const at = Math.exp((-2 * Math.PI * 1400) / sr)
    const high = at * (state.tiltY + y - state.tiltX)
    state.tiltX = y
    state.tiltY = high
    y += state.tilt * high
  }
  if (state.lowShelf > 0) {
    const as = Math.exp((-2 * Math.PI * 280) / sr)
    state.shelfY = (1 - as) * y + as * state.shelfY
    y += state.lowShelf * state.shelfY
  }
  if (state.subharmonic > 0) {
    if (state.subLast <= 0 && y > 0) state.subSign = -state.subSign
    state.subLast = y
    y += state.subharmonic * state.subSign * Math.abs(y)
  }
  if (state.chorusMix > 0 && state.chorusBuf.length > 2) {
    const delayed = state.chorusBuf[state.chorusPos] ?? 0
    state.chorusBuf[state.chorusPos] = y
    state.chorusPos = (state.chorusPos + 1) % state.chorusBuf.length
    y += state.chorusMix * delayed
  }
  if (y > 1) y = 1
  if (y < -1) y = -1
  return y
}

export function createVoiceCharacterState(sampleRate: number, spec: VoiceCharacterSpec): VoiceCharacterState {
  const sr = sampleRate > 0 ? sampleRate : 48000
  const grainCap = Math.max(64, Math.round(sr * 0.03))
  const ring = new Float32Array(16384)
  return {
    sampleRate: sr,
    pitchRatio: spec.pitchRatio > 0 ? spec.pitchRatio : 1,
    formantScale: spec.formantScale > 0 ? spec.formantScale : 1,
    highpassHz: spec.highpassHz,
    tilt: spec.tilt,
    lowShelf: spec.lowShelf,
    subharmonic: spec.subharmonic,
    chorusMix: spec.chorus,
    grainCap,
    ring,
    received: 0,
    cursor: 0,
    pulled: 0,
    lastPeriod: Math.round(sr / 120),
    ola: new Float32Array(ring.length),
    olaN: new Float32Array(ring.length),
    hp1X: 0,
    hp1Y: 0,
    hp2X: 0,
    hp2Y: 0,
    tiltX: 0,
    tiltY: 0,
    shelfY: 0,
    subSign: 1,
    subLast: 0,
    chorusBuf: new Float32Array(Math.max(8, Math.round(sr * 0.015))),
    chorusPos: 0,
  }
}

function snapshot(state: VoiceCharacterState, start: number, length: number): Float32Array {
  const frame = new Float32Array(length)
  for (let i = 0; i < length; i += 1) frame[i] = ringAt(state, start + i)
  return frame
}

export function processVoiceCharacter(
  state: VoiceCharacterState,
  input: Float32Array,
  output: Float32Array,
): void {
  const span = state.ring.length
  for (let i = 0; i < input.length; i += 1) {
    state.ring[state.received % span] = input[i] ?? 0
    state.received += 1
  }
  while (state.cursor + Math.ceil(state.grainCap / 2) <= state.received) {
    const look = Math.min(state.grainCap, state.received - state.cursor)
    const frame = snapshot(state, state.cursor, look)
    const period = detectVoicePeriod(frame, state.sampleRate, state.lastPeriod)
    state.lastPeriod = period
    const pulse = snapPulse(state, state.cursor, period)
    placeGrain(state, pulse, state.cursor, period)
    const hop = Math.max(1, Math.round(period / state.pitchRatio))
    state.cursor += hop
  }
  const safe = state.cursor - Math.ceil(state.grainCap / 2)
  for (let i = 0; i < output.length; i += 1) {
    if (state.pulled < safe) {
      const slot = state.pulled % state.ola.length
      const n = state.olaN[slot] ?? 0
      const raw = n > 1e-5 ? (state.ola[slot] ?? 0) / n : 0
      state.ola[slot] = 0
      state.olaN[slot] = 0
      state.pulled += 1
      output[i] = shapeSample(state, raw)
    } else {
      output[i] = 0
    }
  }
}

/**
 * Rendu hors ligne, par blocs de 128 — le même découpage que l'AudioWorklet.
 * Les premières dizaines de millisecondes sont la latence du grain (silence).
 */
export function renderVoiceCharacter(
  input: Float32Array,
  sampleRate: number,
  spec: VoiceCharacterSpec,
): Float32Array {
  const state = createVoiceCharacterState(sampleRate, spec)
  const out = new Float32Array(input.length)
  const block = 128
  for (let i = 0; i < input.length; i += block) {
    const n = Math.min(block, input.length - i)
    const sliceIn = input.subarray(i, i + n)
    const sliceOut = out.subarray(i, i + n)
    const tmpIn = new Float32Array(n)
    const tmpOut = new Float32Array(n)
    tmpIn.set(sliceIn)
    processVoiceCharacter(state, tmpIn, tmpOut)
    sliceOut.set(tmpOut)
  }
  return out
}

export interface VoiceCharacterNodeLike {
  connect(destination: VoiceCharacterNodeLike): void
  disconnect(): void
  gain?: { value: number }
}

export interface VoiceCharacterAudioContext {
  readonly sampleRate: number
  createGain(): VoiceCharacterNodeLike
  audioWorklet?: { addModule(url: string): Promise<void> }
}

export interface VoiceCharacterNode {
  readonly input: VoiceCharacterNodeLike
  readonly output: VoiceCharacterNodeLike
  close(): void
}

export type VoiceCharacterWorkletFactory = (
  context: VoiceCharacterAudioContext,
  name: string,
  options: AudioWorkletNodeOptions,
) => VoiceCharacterNodeLike

const defaultWorkletFactory: VoiceCharacterWorkletFactory = (context, name, options) => {
  if (typeof AudioWorkletNode !== 'function') throw new Error('AudioWorkletNode indisponible')
  return new AudioWorkletNode(context as BaseAudioContext, name, options)
}

export function voiceCharacterWorkletSource(): string {
  return `
${detectVoicePeriod.toString()}
${ringAt.toString()}
${snapPulse.toString()}
${placeGrain.toString()}
${shapeSample.toString()}
${snapshot.toString()}
${createVoiceCharacterState.toString()}
${processVoiceCharacter.toString()}
class ConcordVoiceCharacter extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const o = (options && options.processorOptions) || {}
    this.state = createVoiceCharacterState(sampleRate, {
      pitchRatio: typeof o.pitchRatio === 'number' ? o.pitchRatio : 1,
      formantScale: typeof o.formantScale === 'number' ? o.formantScale : 1,
      highpassHz: typeof o.highpassHz === 'number' ? o.highpassHz : 0,
      tilt: typeof o.tilt === 'number' ? o.tilt : 0,
      lowShelf: typeof o.lowShelf === 'number' ? o.lowShelf : 0,
      subharmonic: typeof o.subharmonic === 'number' ? o.subharmonic : 0,
      chorus: typeof o.chorus === 'number' ? o.chorus : 0,
    })
  }
  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0]
    const output = outputs[0] && outputs[0][0]
    if (!input || !output) return true
    processVoiceCharacter(this.state, input, output)
    return true
  }
}
registerProcessor('concord-voice-character', ConcordVoiceCharacter)
`
}

export function createVoiceCharacterNode(
  context: VoiceCharacterAudioContext,
  spec: VoiceCharacterSpec,
): VoiceCharacterNode {
  const input = context.createGain()
  const output = context.createGain()
  if (input.gain !== undefined) input.gain.value = 1
  if (output.gain !== undefined) output.gain.value = 1
  const passthrough = (): VoiceCharacterNode => {
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
  const makeNode = defaultWorkletFactory
  if (typeof AudioWorkletNode !== 'function') return passthrough()
  let processor: VoiceCharacterNodeLike | null = null
  let closed = false
  input.connect(output)
  try {
    const url = URL.createObjectURL(new Blob([voiceCharacterWorkletSource()], { type: 'application/javascript' }))
    void worklet
      .addModule(url)
      .then(() => {
        if (closed) return
        const node = makeNode(context, 'concord-voice-character', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 1,
          channelCountMode: 'explicit',
          processorOptions: {
            pitchRatio: spec.pitchRatio,
            formantScale: spec.formantScale,
            highpassHz: spec.highpassHz,
            tilt: spec.tilt,
            lowShelf: spec.lowShelf,
            subharmonic: spec.subharmonic,
            chorus: spec.chorus,
          },
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
      .catch(() => {
        console.warn('[voice-character] AudioWorklet refusé — timbre inchangé')
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
