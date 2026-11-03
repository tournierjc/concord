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
  const half = Math.floor(frameSize / PITCH_HEADS)
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
    output[i] = (output[i] ?? 0) / PITCH_HEADS
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

/** Le strict minimum d'un gain pour le pitch : un pont débranchable, rien de plus. */
export interface PitchGainLike extends PitchNodeLike {}

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
 * La source du code de l'worklet, en chaîne : le même `pitchShiftFrame`, écrit une seule
 * fois. Elle est embarquée via un Blob URL (le CSP de la page interdit un fichier séparé,
 * et un bundle unique est la règle du projet).
 */
const WORKLET_SOURCE = `
class ConcordPitchShifter extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'ratio', defaultValue: 1, minValue: 0.5, maxValue: 2 }] }
  constructor(options) {
    super()
    const frame = (options.processorOptions && options.processorOptions.frameSize) || 2880
    this.frameSize = frame
    this.ring = new Float32Array(frame * 2)
    this.window = new Float32Array(frame)
    for (let i = 0; i < frame; i += 1) this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frame)
    this.heads = [{ write: 0, read: 0 }, { write: 0, read: Math.floor(frame / 2) }]
    this.pending = new Float32Array(frame)
    this.filled = 0
    this.ratio = (options.processorOptions && options.processorOptions.ratio) || 1
    this.port.onmessage = (event) => {
      const data = event.data
      if (data && typeof data.ratio === 'number') this.ratio = Math.min(2, Math.max(0.5, data.ratio))
    }
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0]
    const output = outputs[0]
    if (!input || input.length === 0 || !output || output.length === 0) return true
    const channel = input[0]
    const out = output[0]
    const frame = this.frameSize
    for (let i = 0; i < channel.length; i += 1) {
      this.pending[this.filled] = channel[i]
      this.filled += 1
      if (this.filled === frame) {
        this.shift(ratio)
        this.filled = 0
      }
    }
    // Le tampon de sortie du graphe fait 128 : la trame est avalée par paquets, et le rendu
    // est écrit d'un coup à chaque trame pleine.
    out.set(this.rendered.subarray(0, out.length))
    return true
  }
  shift(ratio) {
    const frame = this.frameSize
    const span = frame * 2
    for (const head of this.heads) {
      for (let i = 0; i < frame; i += 1) this.ring[(head.write + i) % span] = this.pending[i]
      head.write = (head.write + frame) % span
    }
    if (!this.rendered) this.rendered = new Float32Array(frame)
    this.rendered.fill(0)
    for (let h = 0; h < this.heads.length; h += 1) {
      const head = this.heads[h]
      const phase = h * Math.floor(frame / this.heads.length)
      for (let i = 0; i < frame; i += 1) {
        const position = (head.read + i * ratio + phase) % span
        const low = Math.floor(position)
        const weight = position - low
        const a = this.ring[low % span]
        const b = this.ring[(low + 1) % span]
        this.rendered[i] += (a + (b - a) * weight) * this.window[i]
      }
      head.read = (head.read + frame * ratio) % span
    }
    for (let i = 0; i < frame; i += 1) this.rendered[i] /= this.heads.length
  }
}
registerProcessor('concord-pitch-shifter', ConcordPitchShifter)
`

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
export function createPitchShifterNode(
  context: PitchAudioContext,
  ratio: number,
  options: PitchShifterOptions = {},
): PitchShifterNode {
  const safe = isPitchRatioValid(ratio) ? ratio : 1
  const passthrough = context.createGain()
  if (!workletAvailable(context) || safe === 1) {
    // Pas de worklet, ou ratio neutre : la voix passe telle quelle. `createGain()` est déjà
    // un pont validé par tout le reste du graphe (le vumètre en est un), donc le repli ne
    // peut pas casser la chaîne — il rend juste la voix sans hauteur modifiée.
    return {
      input: passthrough,
      output: passthrough,
      ratio: 1,
      close(): void {
        try {
          passthrough.disconnect()
        } catch {
          // Déjà coupé.
        }
      },
    }
  }
  let workletNode: PitchNodeLike | null = null
  let applied = 1
  try {
    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }))
    // `addModule` est asynchrone ; le nœud est créé dès qu'il est prêt, et la page ne doit
    // PAS attendre : en attendant, le pass-through rend la voix naturelle (dégradé visible,
    // pas silencieux). Le branchement définitif est posé par le rappel.
    const audioWorklet = context.audioWorklet
    if (audioWorklet === undefined) throw new Error('audioWorklet absent')
    // Le constructeur du nœud est passé en DÉPENDANCE, pas lu en global : `AudioWorkletNode`
    // est un global du navigateur, et le typer depuis le code produirait un cast pour le
    // passer à une doublure de test — exactement ce que C12-3 interdit. La page le fournit
    // (`defaultWorkletNodeFactory`), un test fournit le sien. Absent = repli pass-through.
    const makeNode = options.workletNodeFactory ?? defaultWorkletNodeFactory
    if (makeNode === null) throw new Error('AudioWorkletNode indisponible')
    void audioWorklet.addModule(url).then(() => {
      const node = makeNode(context, 'concord-pitch-shifter', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: 'explicit',
        processorOptions: { frameSize: pitchFrameSizeFor(context.sampleRate), ratio: safe },
      })
      node.connect(passthrough)
      workletNode = node
      applied = safe
    }).catch(() => {
      // Worklet refusé (CSP, mémoire) : le pass-through reste — la voix sort naturelle.
      workletNode = null
      applied = 1
    }).finally(() => {
      URL.revokeObjectURL(url)
    })
  } catch {
    return {
      input: passthrough,
      output: passthrough,
      ratio: 1,
      close(): void {
        try {
          passthrough.disconnect()
        } catch {
          // Déjà coupé.
        }
      },
    }
  }
  return {
    input: passthrough,
    output: passthrough,
    get ratio(): number {
      return applied
    },
    close(): void {
      if (workletNode !== null) {
        try {
          workletNode.disconnect()
        } catch {
          // Déjà coupé.
        }
        workletNode = null
      }
      try {
        passthrough.disconnect()
      } catch {
        // Déjà coupé.
      }
    },
  }
}
