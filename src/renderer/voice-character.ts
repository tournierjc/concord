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
 * Le processeur est une CHAÎNE, pas un assemblage de `function.toString()`. Le bundle
 * Vite (esbuild, `keepNames`) renomme les liaisons (`function Xr`) tout en laissant la
 * classe appeler `createVoiceCharacterState` : `addModule` lève ReferenceError, le
 * `catch` ne faisait qu'un `console.warn`, et le pont entrée→sortie restait en place.
 * La recette timbre n'est alors qu'un passe-bas : femme, enfant et géant sonnent
 * comme la voix sèche. Une chaîne littérale n'est pas réécrite par le minificateur,
 * et elle est chargée par une URL `blob:` (un chemin dans l'asar, `file://` ou
 * `app://`, casse `addModule`). La CSP doit donc autoriser `blob:` sur `script-src`
 * ET `worklet-src` — `worker-src` ne couvre pas un AudioWorklet.
 *
 * Les tests hors ligne exécutent CETTE chaîne (`new Function` seulement ici, jamais
 * dans la page : la CSP interdit `unsafe-eval`). Le rendu rejoue des blocs de 128.
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
  /** Dernier saut de placement (période / ratio). La F0 de sortie en est l'inverse. */
  lastHop: number
  /** Raison du dernier repli de détection, vide si la corrélation a tenu. */
  periodNote: string
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

/**
 * Marqueur lu par `scripts/verify-build.mjs` dans `dist/renderer/assets/index.js`.
 * S'il disparaît, le processeur n'est plus dans le bundle (ou il est redevenu un
 * `toString()` évalué trop tard).
 */
export const VOICE_WORKLET_INLINE_MARK = 'concord-voice-character-inline'

/**
 * Source exécutée par l'AudioWorklet. Littérale : le minificateur n'entre pas
 * dans la chaîne, donc les noms appelés par la classe sont ceux qui sont déclarés.
 */
export function voiceCharacterWorkletSource(): string {
  return `
// ${VOICE_WORKLET_INLINE_MARK}
function detectVoicePeriod(samples, sampleRate, previous) {
  const sr = sampleRate > 0 ? sampleRate : 48000
  const minLag = Math.max(2, Math.round(sr / 400))
  const maxLag = Math.min(samples.length - 2, Math.round(sr / 70))
  if (maxLag <= minLag) {
    detectVoicePeriod.fallback = 'bande-f0-vide'
    return previous > 0 ? previous : Math.round(sr / 120)
  }
  let bestLag = previous > minLag && previous < maxLag ? previous : Math.round(sr / 120)
  let best = 0
  const usable = Math.min(samples.length - maxLag, Math.round(sr * 0.02))
  if (usable < 8) {
    detectVoicePeriod.fallback = 'fenetre-courte'
    return bestLag
  }
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
  if (best < 0.25 && previous > minLag) {
    detectVoicePeriod.fallback = 'correlation-faible'
    return previous
  }
  detectVoicePeriod.fallback = ''
  return bestLag
}

function ringAt(state, index) {
  if (index < 0 || index >= state.received) return 0
  const span = state.ring.length
  if (index < state.received - span) return 0
  return state.ring[index % span] ?? 0
}

function snapPulse(state, around, period) {
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

function placeGrain(state, readCenter, writeCenter, period) {
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

function shapeSample(state, x) {
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

function createVoiceCharacterState(sampleRate, spec) {
  const sr = sampleRate > 0 ? sampleRate : 48000
  const grainCap = Math.max(64, Math.round(sr * 0.03))
  const ring = new Float32Array(16384)
  const period = Math.round(sr / 120)
  return {
    sampleRate: sr,
    pitchRatio: spec.pitchRatio > 0 ? spec.pitchRatio : 1,
    formantScale: spec.formantScale > 0 ? spec.formantScale : 1,
    highpassHz: spec.highpassHz,
    tilt: spec.tilt,
    lowShelf: spec.lowShelf,
    subharmonic: spec.subharmonic,
    chorusMix: spec.chorus,
    grainCap: grainCap,
    ring: ring,
    received: 0,
    cursor: 0,
    pulled: 0,
    lastPeriod: period,
    lastHop: period,
    periodNote: '',
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

function snapshot(state, start, length) {
  const frame = new Float32Array(length)
  for (let i = 0; i < length; i += 1) frame[i] = ringAt(state, start + i)
  return frame
}

function processVoiceCharacter(state, input, output) {
  const span = state.ring.length
  for (let i = 0; i < input.length; i += 1) {
    state.ring[state.received % span] = input[i] ?? 0
    state.received += 1
  }
  while (state.cursor + Math.ceil(state.grainCap / 2) <= state.received) {
    const look = Math.min(state.grainCap, state.received - state.cursor)
    const frame = snapshot(state, state.cursor, look)
    const period = detectVoicePeriod(frame, state.sampleRate, state.lastPeriod)
    state.periodNote = typeof detectVoicePeriod.fallback === 'string' ? detectVoicePeriod.fallback : ''
    state.lastPeriod = period
    const pulse = snapPulse(state, state.cursor, period)
    placeGrain(state, pulse, state.cursor, period)
    const hop = Math.max(1, Math.round(period / (state.pitchRatio > 0.05 ? state.pitchRatio : 1)))
    state.lastHop = hop
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

class ConcordVoiceCharacter extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const o = (options && options.processorOptions) || {}
    this.trace = o.trace === true
    this.state = createVoiceCharacterState(sampleRate, {
      pitchRatio: typeof o.pitchRatio === 'number' ? o.pitchRatio : 1,
      formantScale: typeof o.formantScale === 'number' ? o.formantScale : 1,
      highpassHz: typeof o.highpassHz === 'number' ? o.highpassHz : 0,
      tilt: typeof o.tilt === 'number' ? o.tilt : 0,
      lowShelf: typeof o.lowShelf === 'number' ? o.lowShelf : 0,
      subharmonic: typeof o.subharmonic === 'number' ? o.subharmonic : 0,
      chorus: typeof o.chorus === 'number' ? o.chorus : 0,
    })
    this.seen = 0
    this.nextReport = Math.round(sampleRate * 3)
    if (this.trace) {
      this.port.postMessage({
        type: 'loaded',
        processor: 'concord-voice-character',
        sampleRate: sampleRate,
        pitchRatio: this.state.pitchRatio,
        formantScale: this.state.formantScale,
        highpassHz: this.state.highpassHz,
        tilt: this.state.tilt,
        lowShelf: this.state.lowShelf,
        subharmonic: this.state.subharmonic,
        chorus: this.state.chorusMix,
      })
    }
  }
  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0]
    const output = outputs[0] && outputs[0][0]
    if (!input || !output) return true
    processVoiceCharacter(this.state, input, output)
    if (!this.trace) return true
    this.seen += input.length
    if (this.seen < this.nextReport) return true
    this.nextReport += Math.round(sampleRate * 3)
    const period = this.state.lastPeriod > 0 ? this.state.lastPeriod : 1
    const hop = this.state.lastHop > 0 ? this.state.lastHop : period
    this.port.postMessage({
      type: 'f0',
      processor: 'concord-voice-character',
      inputHz: sampleRate / period,
      outputHz: sampleRate / hop,
      pitchRatio: this.state.pitchRatio,
      formantScale: this.state.formantScale,
      fallback: this.state.periodNote || '',
    })
    return true
  }
}
registerProcessor('concord-voice-character', ConcordVoiceCharacter)
`
}

interface VoiceCharacterKernel {
  detectVoicePeriod(samples: Float32Array, sampleRate: number, previous: number): number
  createVoiceCharacterState(sampleRate: number, spec: VoiceCharacterSpec): VoiceCharacterState
  processVoiceCharacter(state: VoiceCharacterState, input: Float32Array, output: Float32Array): void
}

let kernelCache: VoiceCharacterKernel | null = null

/** Exécute la chaîne du worklet. Réservé au rendu hors ligne (tests) : la page ne l'appelle pas. */
function voiceCharacterKernel(): VoiceCharacterKernel {
  if (kernelCache !== null) return kernelCache
  const source = voiceCharacterWorkletSource()
  const cut = source.indexOf('class ConcordVoiceCharacter')
  if (cut < 0) throw new Error('worklet de timbre sans classe ConcordVoiceCharacter')
  const factory = new Function(
    `${source.slice(0, cut)}\nreturn { detectVoicePeriod, createVoiceCharacterState, processVoiceCharacter };`,
  ) as () => VoiceCharacterKernel
  kernelCache = factory()
  return kernelCache
}

/** Période (échantillons) par autocorrélation normalisée, 70–400 Hz. */
export function detectVoicePeriod(samples: Float32Array, sampleRate: number, previous: number): number {
  return voiceCharacterKernel().detectVoicePeriod(samples, sampleRate, previous)
}

export function createVoiceCharacterState(sampleRate: number, spec: VoiceCharacterSpec): VoiceCharacterState {
  return voiceCharacterKernel().createVoiceCharacterState(sampleRate, spec)
}

export function processVoiceCharacter(
  state: VoiceCharacterState,
  input: Float32Array,
  output: Float32Array,
): void {
  voiceCharacterKernel().processVoiceCharacter(state, input, output)
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

export type VoiceProcessorPhaseName = 'idle' | 'live' | 'fallback'

export interface VoiceProcessorPhase {
  readonly phase: VoiceProcessorPhaseName
  readonly detail: string
}

const IDLE_PHASE: VoiceProcessorPhase = { phase: 'idle', detail: '' }
let processorPhase: VoiceProcessorPhase = IDLE_PHASE
const phaseListeners = new Set<() => void>()

function publishPhase(next: VoiceProcessorPhase): void {
  processorPhase = next
  for (const listener of phaseListeners) listener()
}

/** État du dernier chargement du processeur de timbre (lu par le sélecteur de filtre). */
export function voiceProcessorPhase(): VoiceProcessorPhase {
  return processorPhase
}

export function subscribeVoiceProcessor(listener: () => void): () => void {
  phaseListeners.add(listener)
  return () => {
    phaseListeners.delete(listener)
  }
}

function audioDebugEnabled(): boolean {
  const flags = globalThis as { __CONCORD_AUDIO_DEBUG__?: boolean; __CONCORD_DEBUG__?: boolean }
  return flags.__CONCORD_AUDIO_DEBUG__ === true || flags.__CONCORD_DEBUG__ === true
}

function failureDetail(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const clean = raw.replace(/\s+/g, ' ').trim()
  return clean.length > 180 ? `${clean.slice(0, 177)}…` : clean
}

const workletReady = new WeakMap<object, Promise<void>>()

function loadCharacterWorklet(
  context: object,
  worklet: { addModule(url: string): Promise<void> },
): Promise<void> {
  const cached = workletReady.get(context)
  if (cached !== undefined) return cached
  const url = URL.createObjectURL(new Blob([voiceCharacterWorkletSource()], { type: 'application/javascript' }))
  const pending = worklet.addModule(url).then(
    () => undefined,
    (error: unknown) => {
      workletReady.delete(context)
      throw error
    },
  )
  workletReady.set(context, pending)
  // `finally` rejette comme `pending`. Sans ce catch, le rejet (CSP, module
  // invalide) remonte en promesse non gérée en plus du `console.error` du nœud.
  void pending.finally(() => {
    URL.revokeObjectURL(url)
  }).catch(() => undefined)
  return pending
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
  // Sans AudioWorkletNode (tests Node, ou page sans worklet) le pont laisse passer
  // la voix. Le refus RÉEL — addModule qui rejette — est journalisé plus bas.
  if (worklet === undefined || typeof worklet.addModule !== 'function') return passthrough()
  if (typeof AudioWorkletNode !== 'function') return passthrough()
  let processor: VoiceCharacterNodeLike | null = null
  let closed = false
  input.connect(output)
  const trace = audioDebugEnabled()
  try {
    void loadCharacterWorklet(context, worklet).then(
      () => {
        if (closed) return
        const node = defaultWorkletFactory(context, 'concord-voice-character', {
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
            trace,
          },
        })
        const port = (node as { port?: { onmessage: ((event: MessageEvent) => void) | null } }).port
        if (port !== undefined) {
          port.onmessage = (event: MessageEvent) => {
            if (!audioDebugEnabled()) return
            console.error(`[voice-character] ${JSON.stringify(event.data)}`)
          }
        }
        try {
          input.disconnect()
        } catch {
          // Pont déjà coupé.
        }
        input.connect(node)
        node.connect(output)
        processor = node
        publishPhase({ phase: 'live', detail: '' })
        if (trace) {
          console.error(
            `[voice-character] processeur concord-voice-character chargé pitch=${spec.pitchRatio} formant=${spec.formantScale} sr=${context.sampleRate}`,
          )
        }
      },
      (error: unknown) => {
        const detail = failureDetail(error)
        console.error(`[voice-character] AudioWorklet refusé — timbre inchangé (${detail})`)
        if (!closed) publishPhase({ phase: 'fallback', detail })
      },
    )
  } catch (error) {
    const detail = failureDetail(error)
    console.error(`[voice-character] AudioWorklet refusé — timbre inchangé (${detail})`)
    publishPhase({ phase: 'fallback', detail })
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
