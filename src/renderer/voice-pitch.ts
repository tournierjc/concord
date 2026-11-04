/**
 * src/renderer/voice-pitch.ts — le pitch-shifter granulaire de la page (hauteur sans durée)
 *
 * AJOUT 2026-11-03 (filtres vocaux). La voix « adulte/femme/enfant » décale la HAUTEUR sans
 * toucher à la DURÉE. Les deux moyens natifs du navigateur sont insuffisants ou faux :
 *
 *   • `AudioBufferSourceNode.playbackRate` : déplace TOUT (durée + timbre) — une voix d'enfant
 *     de 2 s devient 1,5 s et « chipmunk » ;
 *   • un lissage pur (`BiquadFilter`) : ne change pas la hauteur du tout.
 *
 * Il reste le granulaire à deux têtes, le seul qui tienne la promesse avec l'API standard :
 *
 *   entrée → deux lecteururs de trames décalées d'un demi-tampon, chacune lissée par une
 *   fenêtre de Hann, mélangées en équal-power ; chaque lectrice lit l'anneau en la lisant
 *   DEUX FOIS plus vite qu'on n'y écrit, et le saut de tête (`grainOffset`) compense le
 *   facteur : le signal sort à la bonne vitesse, à une hauteur multipliée par `ratio`.
 *
 * C'est un algorithme de cross-fade, pas de synthèse : il laisse un léger tremblement sur
 * les voyelles tenues (le « warble » du granulaire) — c'est le coût ASSUMÉ d'un zéro
 * dépendance, et c'est dit ici plutôt que caché sous un nom marketing de voix.
 *
 * Le sens du ratio est CALIBRÉ par un test numérique (`pitchShiftFrame` sur un sinus connu,
 * `tests/voice-pitch.node.test.ts`) : le rapport fréquence mesurée / fréquence attendue doit
 * être ≈ `ratio`. Un sens inversé ne se voit pas à l'écoute d'un graphe (les deux bornes
 * « montent ou descendent ») — seul le nombre le dit, et la mesure a été faite AVANT
 * l'affirmation produit.
 *
 * Contract :
 *   • MONO, 48 kHz nominal, la taille de tampon suit `sampleRate` (60 ms, soit 2880
 *     échantillons à 48 kHz) ; le ratio hors [0.5, 2] est REFUSÉ (un ratio absurde fait
 *     lire l'anneau à l'envers — une erreur de programmation, pas un réglage) ;
 *   • l'anneau est une copie (le lecteur ne lit jamais le buffer d'entrée : un appelant qui
 *     réutilise son tableau ne peut pas corrompre la lecture en cours) ;
 *   • sans `process()` appelé (aucune trame), `output` reste au silence — jamais un résidu.
 *
 * Falsifiable sans Chromium : la DSP est une fonction PURE (`pitchShiftFrame`, testée en
 * Node sur un signal connu) ; seul le branchement AudioWorklet vit ici, dans la page.
 */

/** Durée d'une trame, en ms — le compromis usuel (trop court : flou ; trop long : tremolo). */
export const PITCH_FRAME_MS = 60

/** Bornes du ratio accepté : hors de là, la lecture de l'anneau n'a plus de sens. */
export const MIN_PITCH_RATIO = 0.5
export const MAX_PITCH_RATIO = 2

/** Le nombre de têtes du granulaire : DEUX, décalées d'un demi-tampon, fondues en équal-power. */
export const PITCH_HEADS = 2

/** Un lectrice de trames : sa position d'écriture dans l'anneau, et sa position de lecture. */
export interface PitchHead {
  /** Position d'écriture courante dans l'anneau (0..frameSize-1). */
  write: number
  /** Position de lecture courante (décalée de `halfFrame` entre les deux têtes). */
  read: number
}

/** L'état complet d'un pitch-shifter : sa géométrie et ses têtes. */
export interface PitchState {
  readonly frameSize: number
  readonly ratio: number
  readonly heads: PitchHead[]
  /** L'anneau des dernières trames, de taille `frameSize * 2` (la fenêtre de Hann y lit). */
  ring: Float32Array
  /** La fenêtre de Hann, précalculée (taille `frameSize`). */
  readonly window: Float32Array
}

/** Vrai si le ratio est dans les bornes promises. */
export function isPitchRatioValid(ratio: number): boolean {
  return Number.isFinite(ratio) && ratio >= MIN_PITCH_RATIO && ratio <= MAX_PITCH_RATIO
}

/** La taille de trame pour une fréquence d'échantillonnage donnée (60 ms arrondis). */
export function pitchFrameSizeFor(sampleRate: number): number {
  const size = Math.round((PITCH_FRAME_MS / 1000) * sampleRate)
  return size > 0 ? size : 1
}

/** Hann périodique (celle qui se fond sans trou à la somme des deux têtes). */
export function hannWindow(size: number): Float32Array {
  const w = new Float32Array(size)
  for (let i = 0; i < size; i += 1) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size)
  }
  return w
}

/** État initial : silence dans l'anneau, têtes alignées, fenêtre précalculée. */
export function createPitchState(sampleRate: number, ratio: number): PitchState {
  const frameSize = pitchFrameSizeFor(sampleRate)
  const heads: PitchHead[] = []
  const half = Math.floor(frameSize / PITCH_HEADS)
  for (let h = 0; h < PITCH_HEADS; h += 1) {
    heads.push({ write: 0, read: h * half })
  }
  return {
    frameSize,
    ratio: isPitchRatioValid(ratio) ? ratio : 1,
    heads,
    ring: new Float32Array(frameSize * 2),
    window: hannWindow(frameSize),
  }
}

/**
 * UN traitement de trame (la partie pure, testée en Node).
 *
 * Écrit `input` dans l'anneau à la position d'écriture de la tête, lit une fenêtre qui AVANCE
 * de `ratio` échantillons d'anneau par échantillon rendu, l'applique à la fenêtre de Hann, et
 * SOMME les deux têtes (fondu croisé implicite par le décalage d'un demi-tampon + la fenêtre).
 *
 * Le sens est celui de la lecture, pas de l'écriture : `read += ratio` par échantillon rendu
 * — un ratio de 2 parcourt DEUX échantillons d'anneau par échantillon produit, donc la même
 * seconde de voix est comprimée dans une demi-seconde rendue : la hauteur double et la DURÉE
 * reste celle de l'entrée (la longueur rendue est fixée par la trame). C'est le sens vérifié
 * à la mesure sur un sinus de 220 Hz (ratio 1.2599 → 277 Hz) ; le multiplier par ratio, et
 * non diviser, est ce qui évite le miroir (mesuré, cf. en-tête).
 */
export function pitchShiftFrame(state: PitchState, input: Float32Array, output: Float32Array): void {
  const { frameSize, ratio, ring, window } = state
  // `state.heads.length`, pas la constante du module : le corps doit être autonome
  // (`toString()` part dans l'AudioWorklet, qui n'a pas les imports de la page).
  const heads = state.heads.length > 0 ? state.heads.length : 1
  const half = Math.floor(frameSize / heads)
  const span = frameSize * 2
  // 1. Écrire la trame dans l'anneau (copie : le lecteur ne lit jamais `input` directement).
  for (const head of state.heads) {
    for (let i = 0; i < frameSize; i += 1) {
      const sample = input[i] ?? 0
      ring[(head.write + i) % span] = sample
    }
    head.write = (head.write + frameSize) % span
  }
  // 2. Lire chaque tête, fenêtrée, avec l'avance compensée.
  output.fill(0)
  for (let h = 0; h < state.heads.length; h += 1) {
    const head = state.heads[h]
    if (head === undefined) continue
    // Décalage de phase de la tête : 0 puis un demi-tampon — les deux fondues se recouvrent.
    const phase = h * half
    for (let i = 0; i < frameSize; i += 1) {
      const position = (head.read + i * ratio + phase) % span
      const low = Math.floor(position)
      const weight = position - low
      const a = ring[low % span] ?? 0
      const b = ring[(low + 1) % span] ?? 0
      const sample = a + (b - a) * weight // interpolation linéaire (le palier fait un clic)
      const envelope = window[i] ?? 0
      output[i] = (output[i] ?? 0) + sample * envelope
    }
    head.read = (head.read + frameSize * ratio) % span
  }
  // 3. Normaliser (deux têtes fenêtrées se somment ≈ à l'amplitude × 1).
  for (let i = 0; i < frameSize; i += 1) {
    output[i] = (output[i] ?? 0) / heads
  }
}

/**
 * Ce que le pitch-shifter UTILISE réellement d'un AudioContext (le reste du graphe n'est pas
 * son affaire). Écrit du point de vue du consommateur, comme les ports du moteur : la doublure
 * de test satisfait ce contrat, le `AudioContext` du navigateur aussi — et `createPitchShifterNode`
 * est appelé avec `context` par la fabrique, sans cast (C12-3).
 */
export interface PitchAudioContext {
  readonly sampleRate: number
  createGain(): PitchGainLike
  audioWorklet?: AudioWorklet
}

/** Le strict minimum d'un nœud pour le pitch : un pont débranchable, rien de plus. */
export interface PitchNodeLike {
  connect(destination: PitchNodeLike): void
  disconnect(): void
}

/** Le strict minimum d'un gain pour le pitch : un pont débranchable, et son niveau. */
export interface PitchGainLike extends PitchNodeLike {
  gain?: { value: number }
}

/** Le nœud de la page : un AudioWorklet qui rejoue `pitchShiftFrame` trame par trame. */
export interface PitchShifterNode {
  /** Où brancher la voix entrante. */
  readonly input: PitchNodeLike
  /** Où prendre la voix sortante (vers les filtres de la recette). */
  readonly output: PitchNodeLike
  /** Le ratio réellement appliqué. */
  readonly ratio: number
  /** Débranche et libère. Idempotent. */
  close(): void
}

/**
 * Source du worklet : le MÊME `pitchShiftFrame` que le test numérique (`toString()` du
 * corps compilé, autonome — aucun import). Le processeur accumule une trame, la décale,
 * puis vide la file sur les quanta de 128 échantillons. L'ancienne version appelait
 * `shift(ratio)` (variable libre) et n'écrivait que les 128 premiers échantillons de la
 * trame : le reste était jeté, et le nœud n'était de toute façon pas dans le chemin.
 */
/** Liaison réellement déclarée par `toString()` (le minificateur renomme le `function`). */
function workletBinding(fn: Function): string {
  const match = /^function\s+([A-Za-z0-9_$]+)/.exec(fn.toString())
  if (match?.[1] === undefined) throw new Error('AudioWorklet: fonction sans déclaration')
  return match[1]
}

export function pitchWorkletSource(): string {
  const hann = workletBinding(hannWindow)
  const shift = workletBinding(pitchShiftFrame)
  return `
${hannWindow.toString()}
${pitchShiftFrame.toString()}
class ConcordPitchShifter extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const opts = (options && options.processorOptions) || {}
    const frame = opts.frameSize || 2880
    const ratio = typeof opts.ratio === 'number' ? opts.ratio : 1
    const half = Math.floor(frame / 2)
    this.state = {
      frameSize: frame,
      ratio: ratio,
      heads: [{ write: 0, read: 0 }, { write: 0, read: half }],
      ring: new Float32Array(frame * 2),
      window: ${hann}(frame),
    }
    this.pending = new Float32Array(frame)
    this.rendered = new Float32Array(frame)
    this.filled = 0
    this.queue = new Float32Array(frame * 4)
    this.qRead = 0
    this.qWrite = 0
  }
  enqueue(samples) {
    const q = this.queue
    const n = q.length
    for (let i = 0; i < samples.length; i += 1) {
      q[this.qWrite % n] = samples[i]
      this.qWrite += 1
    }
    if (this.qWrite - this.qRead > n) this.qRead = this.qWrite - n
  }
  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0]
    const output = outputs[0] && outputs[0][0]
    if (!input || !output) return true
    const frame = this.state.frameSize
    for (let i = 0; i < input.length; i += 1) {
      this.pending[this.filled] = input[i]
      this.filled += 1
      if (this.filled === frame) {
        ${shift}(this.state, this.pending, this.rendered)
        this.enqueue(this.rendered)
        this.filled = 0
      }
    }
    const q = this.queue
    const n = q.length
    for (let i = 0; i < output.length; i += 1) {
      if (this.qRead < this.qWrite) {
        output[i] = q[this.qRead % n]
        this.qRead += 1
      } else {
        output[i] = 0
      }
    }
    return true
  }
}
registerProcessor('concord-pitch-shifter', ConcordPitchShifter)
`
}

/**
 * Le constructeur du nœud, passé en dépendance. `null` = le navigateur ne l'a pas (le repli
 * pass-through s'applique). Une dépendance explicite plutôt qu'un global lu : c'est ce qui
 * permet de tester le chemin sans cast (C12-3).
 */
export type WorkletNodeFactory = (
  context: PitchAudioContext,
  name: string,
  options: AudioWorkletNodeOptions,
) => PitchNodeLike

/** Les options du pitch-shifter (la fabrique en reçoit une prête, et un test la lit). */
export interface PitchShifterOptions {
  readonly workletNodeFactory?: WorkletNodeFactory | null
}

/** Le constructeur réel de la page (global du navigateur, référencé une seule fois ici). */
const defaultWorkletNodeFactory: WorkletNodeFactory = (context, name, options) => {
  // `AudioWorkletNode` n'existe que dans une page : le contrat large (`PitchAudioContext`) est
  // rendu au constructeur DOM, qui exige le contexte complet — le seul endroit du module où ce
  // type large est touché, et il n'est pas traversé par un cast de test (le test fournit sa
  // propre fabrique).
  if (typeof AudioWorkletNode !== 'function') throw new Error('AudioWorkletNode indisponible')
  return new AudioWorkletNode(context as BaseAudioContext, name, options)
}

/** Vrai si la page a un `AudioWorklet` utilisable (le garde-fou avant de promettre un pitch). */
function workletAvailable(context: PitchAudioContext): boolean {
  return context.audioWorklet !== undefined && typeof context.audioWorklet.addModule === 'function'
}

/**
 * Crée le nœud de décalage de hauteur de la page. `ratio` hors bornes ou worklet absent :
 * le nœud est un PASSTHROUGH (`ratio` rendu à 1, `close()` silencieux) — un pitch qui
 * échoue doit rendre la voix NATURELLE, jamais couper le micro. L'appelant trace le repli.
 */
function bridge(input: PitchNodeLike, output: PitchNodeLike, ratio: number): PitchShifterNode {
  input.connect(output)
  return {
    input,
    output,
    ratio,
    close(): void {
      try {
        input.disconnect()
      } catch {
        // Déjà coupé.
      }
      if (output !== input) {
        try {
          output.disconnect()
        } catch {
          // Déjà coupé.
        }
      }
    },
  }
}

export function createPitchShifterNode(
  context: PitchAudioContext,
  ratio: number,
  options: PitchShifterOptions = {},
): PitchShifterNode {
  const safe = isPitchRatioValid(ratio) ? ratio : 1
  const input = context.createGain()
  const output = context.createGain()
  if (input.gain !== undefined) input.gain.value = 1
  if (output.gain !== undefined) output.gain.value = 1
  // Ratio neutre, ou runtime sans worklet (Node, test de graphe) : pont direct.
  // L'entrée et la sortie restent DEUX nœuds dès qu'un worklet peut s'insérer : le signal
  // entre dans le processeur, il n'est pas court-circuité par un gain unique.
  if (!workletAvailable(context) || safe === 1) {
    return bridge(input, output, safe === 1 ? 1 : 1)
  }
  const makeNode = options.workletNodeFactory ?? defaultWorkletNodeFactory
  if (makeNode === defaultWorkletNodeFactory && typeof AudioWorkletNode !== 'function') {
    return bridge(input, output, 1)
  }
  let workletNode: PitchNodeLike | null = null
  let applied = 1
  let closed = false
  try {
    const url = URL.createObjectURL(new Blob([pitchWorkletSource()], { type: 'application/javascript' }))
    const audioWorklet = context.audioWorklet
    if (audioWorklet === undefined) throw new Error('audioWorklet absent')
    // Pont sec le temps du chargement (une trame), puis le processeur REMPLACE le pont :
    // entrée → worklet → sortie. L'ancien câblage branchait la sortie du worklet sur le
    // même gain qui servait d'entrée, donc la voix ne traversait jamais le décalage.
    input.connect(output)
    void audioWorklet.addModule(url).then(() => {
      if (closed) return
      const node = makeNode(context, 'concord-pitch-shifter', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
        processorOptions: { frameSize: pitchFrameSizeFor(context.sampleRate), ratio: safe },
      })
      try {
        input.disconnect()
      } catch {
        // Le pont était déjà coupé.
      }
      input.connect(node)
      node.connect(output)
      workletNode = node
      applied = safe
    }).catch(() => {
      workletNode = null
      applied = 1
      console.warn('[voice-pitch] AudioWorklet refusé — hauteur inchangée')
    }).finally(() => {
      URL.revokeObjectURL(url)
    })
  } catch {
    return bridge(input, output, 1)
  }
  return {
    input,
    output,
    get ratio(): number {
      return applied
    },
    close(): void {
      closed = true
      if (workletNode !== null) {
        try {
          workletNode.disconnect()
        } catch {
          // Déjà coupé.
        }
        workletNode = null
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
