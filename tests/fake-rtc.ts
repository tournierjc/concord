/**
 * tests/fake-rtc.ts — faux `RTCPeerConnection` + globals DOM minimaux (Carillon, T15a)
 *
 * But : rendre `src/engine/rtc/media-plane.ts` **falsifiable sans Chromium**.
 *
 * Ce que Régie a mesuré (SPEC-006 §4) : `electron --version` sort EXIT=127 dans
 * cette image (26 `.so` absentes : libgtk-3, libglib, libX11, libasound…), donc
 * aucun runtime navigateur n'existe ici. La seule voie de falsification est un
 * faux binding WebRTC en Node pur — c'est ce module.
 *
 * `media-plane.ts` lit les globals **au moment de l'appel** (`new RTCPeerConnection(...)`
 * dans `ensurePeer`, `navigator.mediaDevices` dans `requestMicrophone`,
 * `new AudioContext()` dans `addMeter`) : il suffit donc de poser les globals
 * avant d'appeler `createMediaPlane`, sans aucune retouche du module ni
 * injection de dépendance. `installFakeDom()` fait exactement ça, et rend une
 * fonction de restauration — aucun état ne fuit d'un test à l'autre.
 *
 * Doublures fournies (toutes instrumentées, aucune ne parle réseau) :
 *   • `FakePeerConnection` — enregistre la config reçue (A4), compte les
 *     constructions (A3), garde les candidats réellement ajoutés (A5), les
 *     descriptions locales/remotes et les émetteurs ;
 *   • `FakeTrack`        — `enabled` en écriture-lecture tracée (A2 : c'est
 *     l'unique levier du push-to-talk) ;
 *   • `FakeSender`       — `addTrack`/`replaceTrack`/`setParameters` tracés (A6) ;
 *   • `FakeMediaStream`, `FakeAnalyser`, `FakeAudioContext` — juste assez pour
 *     que `attachLocalTrack`, `ontrack` et le vumètre existent ;
 *   • `navigator.mediaDevices.getUserMedia` — rend une piste, note les contraintes ;
 *   • `console.warn` capturé — c'est la **trace** du refus explicite exigé en A5.
 *
 * Aucune dépendance hors `node:*` : le fichier tourne sous `npx tsx --test`.
 */

/* ------------------------------------------------------------------------- */
/* Fixtures SDP — formes réelles d'une offre/réponse Chromium                  */
/* ------------------------------------------------------------------------- */

/**
 * Offre Chromium-like : Opus en PT 111, annoncé `opus/48000/2` (stéréo) et
 * `useinbandfec=1` sans `maxaveragebitrate`. C'est l'offre que le munging doit
 * ramener à 32 kbps mono — si le munging ne fait rien, `stereo=0` et
 * `maxaveragebitrate=32000` seront absents et A6 échouera.
 */
export const OFFER_SDP = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'c=IN IP4 0.0.0.0',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=sendrecv',
  '',
].join('\r\n')

/** Réponse : même m-line, sens inversé. */
export const ANSWER_SDP = OFFER_SDP.replace('a=sendrecv', 'a=recvonly')

/* ------------------------------------------------------------------------- */
/* Fixtures candidats ICE — un exemplaire par verdict attendu (A5)            */
/* ------------------------------------------------------------------------- */

/** host RFC1918 → accepté. */
export const CANDIDATE_HOST_RFC1918 =
  'candidate:1 1 udp 2122260223 192.168.1.42 54321 typ host generation 0'
/** host mDNS « *.local » → accepté (découverte LAN, aucune IP publique). */
export const CANDIDATE_HOST_MDNS =
  'candidate:2 1 udp 2122260223 4f3a1b2c-9d8e-4f71-a6b5-3c2d1e0f9a8b.local 54321 typ host'
/** host loopback → accepté (même machine, jamais hors LAN). */
export const CANDIDATE_HOST_LOOPBACK = 'candidate:3 1 udp 2122260223 127.0.0.1 54321 typ host'
/** host ULA IPv6 → accepté. */
export const CANDIDATE_HOST_ULA = 'candidate:4 1 udp 2122260223 fd12:3456:789a::1 54321 typ host'
/** host sur IP publique → REFUSÉ (le type est bon, l'adresse ne l'est pas). */
export const CANDIDATE_HOST_PUBLIC = 'candidate:5 1 udp 2122260223 203.0.113.9 54321 typ host'
/** srflx (réflexif serveur = sortie hors LAN) → REFUSÉ. */
export const CANDIDATE_SRFLX =
  'candidate:6 1 udp 1686052607 203.0.113.9 54321 typ srflx raddr 192.168.1.42 rport 54321'
/** relay (TURN) → REFUSÉ, même si l'adresse est privée. */
export const CANDIDATE_RELAY =
  'candidate:7 1 udp 41885695 192.168.1.42 3478 typ relay raddr 0.0.0.0 rport 0'
/** prflx (pair reflexif) → REFUSÉ. */
export const CANDIDATE_PRFLX = 'candidate:8 1 udp 1685987071 198.51.100.7 54321 typ prflx'

/* ------------------------------------------------------------------------- */
/* Doublures                                                                  */
/* ------------------------------------------------------------------------- */

/** Piste audio doublure : `enabled` est LE levier du push-to-talk (A2). */
export class FakeTrack {
  /** Identité de piste (le DOM l'exige — et `stop()`/`enabled` sont déjà là, cf. A2). */
  public readonly id: string = `piste-doublure-${Math.floor(Math.random() * 1e9)}`
  public readonly kind = 'audio'
  /** Étiquette du porteur de la mesure : c'est la CLÉ du RMS fixé par le test. */
  public readonly label: string
  public stopped = false
  /** Chaque écriture de `enabled`, dans l'ordre — preuve de la séquence PTT. */
  public readonly enabledWrites: boolean[] = []
  private open = true

  public constructor(label: string = 'micro-doublure') {
    this.label = label
  }

  public get enabled(): boolean {
    return this.open
  }

  public set enabled(value: boolean) {
    this.open = value
    this.enabledWrites.push(value)
  }

  /**
   * État de piste lu par le plan média pour juger une mesure PÉRIMÉE (AD-17 / D4) :
   * une piste `'ended'` ne produira plus d'échantillon, donc `level(peerId)` doit
   * rendre `null` et non `0`.
   */
  public readyState: MediaStreamTrackState = 'live'

  public stop(): void {
    this.stopped = true
  }

  /** Fin de piste réelle (le navigateur la déclare `'ended'`). */
  public end(): void {
    this.readyState = 'ended'
  }

  /*
   * Les facettes que le type `MediaStreamTrack` exige et qu'AUCUN test n'exerce : elles sont
   * portées pour que la doublure satisfasse le contrat de la fabrique de filtres (qui reçoit
   * une vraie piste du navigateur), jamais pour être lues. Un test qui en exerçait une devrait
   * la faire vivre ici, pas la contourner par un cast.
   */
  public readonly contentHint = ''
  public readonly muted = false
  public readonly onended: ((this: MediaStreamTrack, ev: Event) => unknown) | null = null
  public readonly onmute: ((this: MediaStreamTrack, ev: Event) => unknown) | null = null
  public readonly onunmute: ((this: MediaStreamTrack, ev: Event) => unknown) | null = null
  public isolated = false
  public readonly readonly = true
  public clone(): FakeTrack {
    return new FakeTrack(this.label)
  }
  public addEventListener(): void {
    // Aucune écoute n'est posée sur une piste par le produit.
  }
  public removeEventListener(): void {
    // Idem.
  }
  public dispatchEvent(): boolean {
    return false
  }
  public getCapabilities(): Record<string, unknown> {
    return {}
  }
  public getConstraints(): Record<string, unknown> {
    return {}
  }
  public getSettings(): Record<string, unknown> {
    return {}
  }
  public applyConstraints(): Promise<void> {
    return Promise.resolve()
  }
}

/** Flux doublure : `getAudioTracks` / `getTracks` sont les seules méthodes lues. */
export class FakeMediaStream {
  /**
   * Le `id` du DOM est requis par le type `MediaStream` : une doublure qui ne le porte pas
   * ne peut pas être passée là où le contrat du produit dit `MediaStream` (la fabrique de
   * filtres, notamment) — c'est la doublure qui s'adapte au contrat, jamais l'inverse.
   */
  public readonly id = 'flux-doublure'
  public readonly tracks: FakeTrack[]
  public constructor(tracks: FakeTrack[] = []) {
    this.tracks = tracks
  }
  public getAudioTracks(): FakeTrack[] {
    return this.tracks
  }
  public getTracks(): FakeTrack[] {
    return this.tracks
  }
  /**
   * Poser une piste, comme le DOM. C'est le chemin de la fabrique de filtres : elle reçoit le
   * flux micro et y ÉCRIT la piste qu'elle filtre (jamais `new MediaStream(...)`, un global
   * de navigateur absent de Node). Le registre est la preuve pour les tests.
   */
  public readonly addedTracks: FakeTrack[] = []
  public addTrack(track: MediaStreamTrack | FakeTrack): void {
    const fake = track as FakeTrack
    this.addedTracks.push(fake)
    if (!this.tracks.includes(fake)) this.tracks.push(fake)
  }
  public removeTrack(track: MediaStreamTrack | FakeTrack): void {
    const fake = track as FakeTrack
    const index = this.tracks.indexOf(fake)
    if (index >= 0) this.tracks.splice(index, 1)
  }
}

/** Émetteur doublure : trace la piste liée et les appels `setParameters` (A6). */
export class FakeSender {
  public track: FakeTrack | null = null
  public setParametersCalls = 0
  public replaceTrackCalls = 0
  public lastParameters: unknown = null
  public readonly parameters = { encodings: [{ maxBitrate: 0, active: true, scaleResolutionDownBy: 1 }] }

  public getParameters(): unknown {
    return this.parameters
  }

  public async setParameters(next: unknown): Promise<void> {
    this.setParametersCalls += 1
    this.lastParameters = next
  }

  public async replaceTrack(track: FakeTrack | null): Promise<void> {
    this.replaceTrackCalls += 1
    this.track = track
  }
}

/**
 * `RTCPeerConnection` doublure.
 *
 * Tout ce qui compte pour A3/A4/A5/A6 est enregistré et consultable :
 * `FakePeerConnection.instances` (une entrée par construction = A3),
 * `config` reçue du constructeur (A4), `addedCandidates` (A5),
 * `senders` + `localDescription` (A2/A6).
 */
export class FakePeerConnection {
  /** Registre global des constructions : le compteur de A3. */
  public static instances: FakePeerConnection[] = []

  public static reset(): void {
    FakePeerConnection.instances = []
  }

  /** Configuration telle que reçue : référence vivante, non copiée (A4). */
  public readonly config: Record<string, unknown>
  public readonly senders: FakeSender[] = []
  public readonly addedCandidates: Array<Record<string, unknown>> = []
  public readonly tracks: FakeTrack[] = []
  public localDescription: Record<string, unknown> | null = null
  public remoteDescription: Record<string, unknown> | null = null
  public connectionState = 'new'
  public closed = false
  public createOfferCalls = 0
  public createAnswerCalls = 0
  public setLocalDescriptionCalls = 0
  public setRemoteDescriptionCalls = 0
  public onicecandidate: ((event: unknown) => void) | null = null
  /**
   * État de ramassage ICE. `'complete'` par défaut : les tests existants n'attendent pas
   * une seconde de plafond (T17). Un test qui veut observer l'attente appelle
   * `holdGathering()` puis `finishGathering()`.
   */
  public iceGatheringState: RTCIceGatheringState = 'complete'
  private readonly gatheringListeners: Array<() => void> = []
  public ontrack: ((event: unknown) => void) | null = null
  public onconnectionstatechange: (() => void) | null = null
  /** Récepteur posé par `fireTrack`, après application de la cible de gigue. */
  public lastReceiver: FakeRtpReceiver | null = null
  /** Entrées rendues par `getStats` (journal de latence). */
  public statEntries: unknown[] = []

  public constructor(config: Record<string, unknown>) {
    this.config = config
    FakePeerConnection.instances.push(this)
  }

  /** Écouteur d'événement DOM minimal : seul `icegatheringstatechange` est câblé. */
  public addEventListener(type: string, listener: () => void): void {
    if (type !== 'icegatheringstatechange') return
    this.gatheringListeners.push(listener)
  }

  public removeEventListener(type: string, listener: () => void): void {
    if (type !== 'icegatheringstatechange') return
    const index = this.gatheringListeners.indexOf(listener)
    if (index >= 0) this.gatheringListeners.splice(index, 1)
  }

  /** Ramassage « en cours » : l'appelant doit ensuite appeler `finishGathering()`. */
  public holdGathering(): void {
    this.iceGatheringState = 'gathering'
  }

  /** Fin de ramassage observée par `waitForGathering` (événement + état). */
  public finishGathering(): void {
    this.iceGatheringState = 'complete'
    for (const listener of [...this.gatheringListeners]) listener()
  }

  /** Nombre d'écouteurs de ramassage encore posés (fuite = test rouge). */
  public get gatheringListenerCount(): number {
    return this.gatheringListeners.length
  }

  /** `addTrack` de Chromium prend (piste, flux) et rend l'émetteur. */
  public addTrack(track: FakeTrack): FakeSender {
    const sender = new FakeSender()
    sender.track = track
    this.senders.push(sender)
    this.tracks.push(track)
    return sender
  }

  public async createOffer(): Promise<Record<string, unknown>> {
    this.createOfferCalls += 1
    return { type: 'offer', sdp: OFFER_SDP }
  }

  public async createAnswer(): Promise<Record<string, unknown>> {
    this.createAnswerCalls += 1
    return { type: 'answer', sdp: ANSWER_SDP }
  }

  public async setLocalDescription(description: Record<string, unknown>): Promise<void> {
    this.setLocalDescriptionCalls += 1
    this.localDescription = description
  }

  public async setRemoteDescription(description: Record<string, unknown>): Promise<void> {
    this.setRemoteDescriptionCalls += 1
    this.remoteDescription = description
  }

  public async addIceCandidate(candidate: Record<string, unknown>): Promise<void> {
    this.addedCandidates.push(candidate)
  }

  /** Rapport de stats figé : mêmes formes que Chromium, valeurs choisies (RTT 12,5 ms → 13). */
  public async getStats(): Promise<{ forEach: (visit: (entry: unknown) => void) => void }> {
    const entries: unknown[] = this.statEntries.length > 0
      ? this.statEntries
      : [
      { type: 'outbound-rtp', kind: 'audio', bytesSent: 1200 },
      { type: 'inbound-rtp', kind: 'audio', bytesReceived: 3400, packetsLost: 2 },
      { type: 'candidate-pair', state: 'in-progress', currentRoundTripTime: 0.5 },
      { type: 'candidate-pair', state: 'succeeded', currentRoundTripTime: 0.0125 },
    ]
    return {
      forEach: (visit: (entry: unknown) => void): void => {
        for (const entry of entries) visit(entry)
      },
    }
  }

  public close(): void {
    this.closed = true
    this.connectionState = 'closed'
  }

  /**
   * Défaut (b) : fait évoluer `connectionState` et prévient `onconnectionstatechange`,
   * comme Chromium. C'est par là qu'un test dit « la connexion de CE pair est passée
   * à failed/connected » — et vérifie que l'événement porte son pair.
   */
  public fireConnectionState(state: string): void {
    this.connectionState = state
    this.onconnectionstatechange?.()
  }
}

/** Analyseur doublure : échantillons constants ⇒ RMS = 0,25 par défaut (vumètre non muet). */
export class FakeAnalyser {
  public fftSize = 2048
  public smoothingTimeConstant = 0.8
  /** RMS lu par `getFloatTimeDomainData` — posable par la source (défaut (a)). */
  public sample = 0.25

  public getFloatTimeDomainData(buffer: Float32Array): void {
    buffer.fill(this.sample)
  }
}

/**
 * RMS figé par flux (défaut (a)) : la clé est `stream.label` — le label de la
 * première piste, posée par les tests (`fakeTrack('b', 0.3)`). Un flux inconnu
 * garde le RMS par défaut de `FakeAnalyser` (0,25) : les tests existants ne
 * bougent pas. Une clé présente mais à `null` rend 0 (silence MESURÉ, distinct de
 * l'absence de mesure qui est `null` côté `level()`).
 */
const ANALYSER_LEVELS = new Map<string, number | null>()

/** Fixe (ou retire, via `null`) le RMS lu pour les analyseurs d'un flux donné. */
export function setFakeAnalyserLevel(label: string, level: number | null): void {
  if (level === null) ANALYSER_LEVELS.delete(label)
  else ANALYSER_LEVELS.set(label, level)
}

/** Oublie tous les niveaux fixés (à appeler entre deux tests). */
export function resetFakeAnalyserLevels(): void {
  ANALYSER_LEVELS.clear()
}

/** Le RMS qu'un analyseur de CE flux rendra : défaut 0,25, clé posée ⇒ sa valeur. */
function analyserSampleFor(stream: FakeMediaStream | MediaStream): number {
  const first = stream.getAudioTracks()[0] as FakeTrack | MediaStreamTrack | undefined
  if (first === undefined) return 0.25
  // `label` est porté par la doublure (le porteur de la mesure, cf. `FakeTrack`) et par la
  // vraie piste du navigateur ; une piste sans label lit le RMS par défaut.
  const label = 'label' in first ? first.label : 'audio'
  if (ANALYSER_LEVELS.has(label)) {
    const level = ANALYSER_LEVELS.get(label)
    return level === null || level === undefined ? 0 : level
  }
  return 0.25
}

/**
 * Nœud doublure : il ENREGISTRE ses connexions sortantes. Sans registre, un graphe de
 * filtres se câblerait à l'envers (un formant en série au lieu de parallèle, un oscillateur
 * laissé dans la chaîne) sans qu'aucun test ne puisse le voir — l'auditeur est un humain.
 * `connect(node|param)` est surchargé comme le DOM : la cible est un nœud OU un `AudioParam`
 * (c'est exactement ainsi que le ring module une voix : oscillateur → gain → `gain` d'un gain).
 */
/** Ce qu'un `connect` de doublure accepte : nœud, paramètre, ou l'analyseur du vumètre. */
export type FakeConnectTarget = FakeAudioNode | FakeAudioParam | FakeAnalyser

export class FakeAudioNode {
  public readonly outgoing: FakeConnectTarget[] = []
  public disconnectCalls = 0
  public connect(target: FakeConnectTarget | unknown): void {
    // Les deux contrats du produit (nœud ET paramètre) tombent ici ; l'analyseur du vumètre
    // est aussi une cible licite (le chemin `meterSource` historique). Une cible hors doublure
    // est IGNOREE : c'est un oubli de harnais, pas un câblage du produit.
    if (target instanceof FakeAudioNode || target instanceof FakeAudioParam || target instanceof FakeAnalyser) {
      this.outgoing.push(target)
    }
  }
  public disconnect(): void {
    this.disconnectCalls += 1
    this.outgoing.length = 0
  }
}

/** `AudioParam` doublure : un récepteur de modulation, et une valeur posable/lisible. */
export class FakeAudioParam {
  public value = 1
  public readonly incoming: FakeAudioNode[] = []
  /** Un `AudioParam` se branche par `connect` : la doublure le note, comme le DOM. */
  public connect(source: FakeAudioNode): void {
    this.incoming.push(source)
  }
}

/** Oscillateur doublure : `start`/`stop` comptés (un oscillateur non arrêté est une fuite). */
export class FakeOscillator extends FakeAudioNode {
  public type = 'sine'
  public readonly frequency = new FakeAudioParam()
  public startCalls = 0
  public stopCalls = 0
  public start(): void {
    this.startCalls += 1
  }
  public stop(): void {
    this.stopCalls += 1
  }
}

/** Biquad doublure : son type, sa fréquence et son Q (les valeurs que la recette promet). */
export class FakeBiquadFilter extends FakeAudioNode {
  public type = 'lowpass'
  public readonly frequency = new FakeAudioParam()
  public readonly Q = new FakeAudioParam()
  /**
   * Le poids du résonateur, retenu quand la fabrique pose le `gain` d'un `bandpass` de formant.
   * Le vrai `BiquadFilterNode` n'a PAS de `gain` pour un bandpass — seul le `peaking` en a un —
   * donc la fabrique ne peut pas l'écrire sur le filtre : elle le porte sur un gain dédié
   * (cf. `buildNode`). Cette facette est le témoin pour les tests, rien de plus.
   */
  public weight: number | null = null
}

/** WaveShaper doublure : la courbe posée, et l'échantillonnage retenu (`oversample`). */
export class FakeWaveShaper extends FakeAudioNode {
  public curve: Float32Array | null = null
  public oversample = 'none'
}

/** Gain doublure : son `gain` est un paramètre (le point d'injection du ring). */
export class FakeGain extends FakeAudioNode {
  public readonly gain = new FakeAudioParam()
}

/** Retard doublure : le peigne du robot (`delayTime` en secondes). */
export class FakeDelay extends FakeAudioNode {
  public readonly delayTime = new FakeAudioParam()
}

/**
 * Source doublure : le flux mesuré est RETENU (un test doit pouvoir exiger « la fabrique a
 * bien branché LA piste micro, pas une autre »), et le RMS du flux est appliqué à l'analyseur
 * qu'on lui branche (défaut (a) historique du vumètre).
 */
export class FakeMediaStreamSourceNode extends FakeAudioNode {
  public readonly stream: FakeMediaStream | MediaStream
  public constructor(stream: FakeMediaStream | MediaStream, private readonly sample: number) {
    super()
    this.stream = stream
  }
  public override connect(target: FakeConnectTarget | unknown): void {
    if (target instanceof FakeAnalyser) target.sample = this.sample
    super.connect(target)
  }
}

/**
 * Destination doublure : elle porte un flux, comme le DOM. C'est LUI qui rend la piste aux
 * pairs — donc c'est lui qu'un test doit pouvoir inspecter (`stream.getAudioTracks()[0]`).
 */
export class FakeMediaStreamDestination extends FakeAudioNode {
  public readonly stream: FakeMediaStream & MediaStream
  public constructor() {
    super()
    this.stream = new FakeMediaStream([new FakeTrack('filtre vocal')]) as FakeMediaStream & MediaStream
  }
}

/**
 * `AudioContext` doublure : de quoi créer un vumètre ET un graphe de filtres. Les fabriques
 * de nœuds sont RÉELLES (des doubles complets, pas des espions vides) : un test peut donc
 * exiger « la recette robot a bien monté un oscillateur hors chaîne, branché sur le gain de
 * modulation, qui pilote le `gain` d'un gain de la chaîne ».
 */
export class FakeRtpReceiver {
  public jitterBufferTarget: number | null = null
  public playoutDelayHint: number | null = null
}

export class FakeAudioContext {
  public static instances: FakeAudioContext[] = []

  public static reset(): void {
    FakeAudioContext.instances = []
  }

  /** Options reçues par `new AudioContext(...)` (latencyHint, sampleRate). */
  public readonly options: { readonly latencyHint?: unknown; readonly sampleRate?: unknown }
  /** Sortie matérielle : le gain muet s'y branche pour caler l'horloge. */
  public readonly destination = new FakeAudioNode()
  /** Valeurs lues par le journal de latence. */
  public baseLatency = 0.008
  public outputLatency = 0.02
  public readonly created: {
    gains: FakeGain[]
    biquads: FakeBiquadFilter[]
    shapers: FakeWaveShaper[]
    oscillators: FakeOscillator[]
    destinations: FakeMediaStreamDestination[]
    sources: FakeMediaStreamSourceNode[]
    delays: FakeDelay[]
  } = { gains: [], biquads: [], shapers: [], oscillators: [], destinations: [], sources: [], delays: [] }
  /** État du contexte : `running` pour que le plan média ne croie pas le graphe suspendu. */
  public state = 'running'
  /** Vrai si `resume()` a été appelé (le contrat du vumètre : une source sans horloge ment). */
  public resumeCalls = 0
  /** Fréquence de la page (la géométrie du pitch s'y cale). */
  public readonly sampleRate = 48000
  /**
   * `AudioWorklet` doublure : `addModule` résout (le chemin worklet est testable), et le
   * NOEUD est fabriqué par la fabrique du test — jamais par un global du navigateur absent ici.
   */
  public readonly audioWorklet = {
    addModule: async (_url: string): Promise<void> => {
      this.workletModuleLoads += 1
    },
  }
  public workletModuleLoads = 0

  public constructor(options?: { latencyHint?: unknown; sampleRate?: unknown }) {
    this.options = options ?? {}
    FakeAudioContext.instances.push(this)
  }

  /**
   * Sans mesure : le test du micro doit rendre `null` (absence d'affirmation, AD-17), et la
   * SEULE façon de falsifier ce chemin est un contexte dépourvu de la facette. La suppression
   * en cours de test ne suffit pas : `createAnalyser` vit sur le PROTOTYPE de la doublure.
   */
  public createAnalyser(): FakeAnalyser {
    return new FakeAnalyser()
  }
  public createGain(): FakeGain {
    const node = new FakeGain()
    this.created.gains.push(node)
    return node
  }
  public createBiquadFilter(): FakeBiquadFilter {
    const node = new FakeBiquadFilter()
    this.created.biquads.push(node)
    return node
  }
  public createWaveShaper(): FakeWaveShaper {
    const node = new FakeWaveShaper()
    this.created.shapers.push(node)
    return node
  }
  public createOscillator(): FakeOscillator {
    const node = new FakeOscillator()
    this.created.oscillators.push(node)
    return node
  }
  public createDelay(_maxDelayTime?: number): FakeDelay {
    const node = new FakeDelay()
    this.created.delays.push(node)
    return node
  }
  public createMediaStreamDestination(): FakeMediaStreamDestination {
    const node = new FakeMediaStreamDestination()
    this.created.destinations.push(node)
    return node
  }
  /**
   * Défaut (a) : la source porte sa clé de RMS. `createMediaStreamSource` reçoit le
   * flux mesuré — l'analyseur qu'on lui branche lit donc le RMS FIXÉ pour ce flux
   * (défaut 0,25, posé par `setFakeAnalyserLevel`), ce qui rend la chaîne
   * `ontrack → analyseur → level(peerId)` mesurable sans Chromium.
   */
  public createMediaStreamSource(stream: MediaStream | FakeMediaStream): FakeMediaStreamSourceNode {
    // Chromium : le paramètre doit être un vrai MediaStream. Quand le global de test est
    // posé (`MediaStream === FakeMediaStream`), un objet maison est refusé comme dans la page.
    if (typeof MediaStream === 'function' && !(stream instanceof MediaStream)) {
      throw new TypeError(
        "Failed to execute 'createMediaStreamSource' on 'AudioContext': parameter 1 is not of type 'MediaStream'.",
      )
    }
    const sample = analyserSampleFor(stream)
    const node = new FakeMediaStreamSourceNode(stream, sample)
    this.created.sources.push(node)
    return node
  }
  public resume(): Promise<void> {
    this.resumeCalls += 1
    return Promise.resolve()
  }
  public close(): Promise<void> {
    return Promise.resolve()
  }
}

/* ------------------------------------------------------------------------- */
/* Installation des globals                                                   */
/* ------------------------------------------------------------------------- */

/** Ce que le test peut inspecter pendant qu'un faux DOM est en place. */
export interface FakeDom {
  /** Messages passés à `console.warn` par le plan média (trace du refus A5). */
  readonly warnings: string[]
  /** Contraintes reçues par `getUserMedia`, dans l'ordre. */
  readonly gumCalls: Array<Record<string, unknown>>
  /** Registre des constructions (raccourci de `FakePeerConnection.instances`). */
  readonly peers: FakePeerConnection[]
  /** Pistes ouvertes par `getUserMedia` (une seule piste micro attendue). */
  readonly micTracks: FakeTrack[]
  /** Rend la piste micro (échoue franchement si `startMicrophone` n'a pas tourné). */
  micTrack(): FakeTrack
  /** Pair construit en position `index` (échoue si le plan média n'en a pas créé). */
  peerAt(index: number): FakePeerConnection
  /** Déclenche `onicecandidate` comme Chromium le fait (fin de collecte = null). */
  fireIceCandidate(peer: FakePeerConnection, candidate: string | null): void
  /** Déclenche `ontrack` (piste distante arrivante) comme Chromium le fait. */
  fireTrack(peer: FakePeerConnection, stream: FakeMediaStream, track: FakeTrack): void
  /** Remet les globals dans l'état d'avant : à appeler en `afterEach`. */
  restore(): void
}

/** Noms de globals remplacés, et donc à restaurer. */
/**
 * `window` fait partie de la liste : la page en a un, la coquille s'en sert
 * (`src/renderer/browser-timers.ts` lit `window.setTimeout`). Sans lui, la doublure
 * n'était pas fidèle : le maillage échouait sur `ReferenceError: window is not defined`
 * au premier appui sur l'horloge injectée, et six tests de T16d rougissaient pour une
 * raison de harnais, pas de produit.
 */
const STUBBED_GLOBALS = [
  'RTCPeerConnection',
  'MediaStream',
  'AudioContext',
  'navigator',
  'window',
] as const

/**
 * Pose les globals DOM minimaux sur `globalThis` et rend leurs inspecteurs.
 * Remet à zéro le registre des `RTCPeerConnection` : chaque test part de 0.
 */
export function installFakeDom(): FakeDom {
  FakePeerConnection.reset()
  FakeAudioContext.reset()

  const warnings: string[] = []
  const gumCalls: Array<Record<string, unknown>> = []
  const micTracks: FakeTrack[] = []

  const saved = new Map<string, PropertyDescriptor | undefined>()
  for (const name of STUBBED_GLOBALS) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  }

  const define = (name: string, value: unknown): void => {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
  }

  const fakeMediaDevices = {
    getUserMedia: async (constraints: Record<string, unknown>): Promise<FakeMediaStream> => {
      gumCalls.push(constraints)
      const track = new FakeTrack()
      micTracks.push(track)
      return new FakeMediaStream([track])
    },
  }

  define('RTCPeerConnection', FakePeerConnection)
  define('MediaStream', FakeMediaStream)
  define('AudioContext', FakeAudioContext)
  define('navigator', { mediaDevices: fakeMediaDevices })
  // La page : `window` EST le global. On le pose au lieu de le simuler autrement, pour que
  // `window.setTimeout` et `window.clearTimeout` tombent sur l'horloge réelle de Node —
  // c'est exactement ce que la coquille fait dans Chromium.
  define('window', globalThis)

  const originalWarn = console.warn
  console.warn = (...args: unknown[]): void => {
    warnings.push(args.map((arg) => String(arg)).join(' '))
  }

  const peers = FakePeerConnection.instances

  return {
    warnings,
    gumCalls,
    peers,
    micTracks,
    micTrack(): FakeTrack {
      const track = micTracks[0]
      if (track === undefined) throw new Error('aucune piste micro ouverte (startMicrophone non appelé)')
      return track
    },
    peerAt(index: number): FakePeerConnection {
      const peer = peers[index]
      if (peer === undefined) throw new Error(`aucune RTCPeerConnection construite en position ${index}`)
      return peer
    },
    fireIceCandidate(peer: FakePeerConnection, candidate: string | null): void {
      const handler = peer.onicecandidate
      if (handler === null) throw new Error('onicecandidate n’est pas câblé sur cette connexion')
      handler({
        candidate:
          candidate === null
            ? null
            : {
                candidate,
                sdpMid: '0',
                sdpMLineIndex: 0,
                toJSON: (): Record<string, unknown> => ({ candidate }),
              },
      })
    },
    fireTrack(peer: FakePeerConnection, stream: FakeMediaStream, track: FakeTrack): void {
      const handler = peer.ontrack
      if (handler === null) throw new Error('ontrack n’est pas câblé sur cette connexion')
      const receiver = new FakeRtpReceiver()
      peer.lastReceiver = receiver
      handler({ track, streams: [stream], receiver })
    },
    restore(): void {
      console.warn = originalWarn
      for (const name of STUBBED_GLOBALS) {
        const descriptor = saved.get(name)
        if (descriptor === undefined) {
          Reflect.deleteProperty(globalThis, name)
        } else {
          Object.defineProperty(globalThis, name, descriptor)
        }
      }
      FakePeerConnection.reset()
    },
  }
}
