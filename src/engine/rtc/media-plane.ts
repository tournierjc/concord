/**
 * src/engine/rtc/media-plane.ts — plan média WebRTC du maillage LAN (Carillon)
 *
 * TÂCHE T14 / SPEC-005 §2. Contrat d'interface **gelé** (signatures identiques,
 * non renégociables) :
 *
 *   MediaPlaneOptions, PeerStats, MediaPlane, createMediaPlane()
 *
 * Ce que ce fichier garantit, et pourquoi il est falsifiable :
 *   • une `RTCPeerConnection` PAR PAIR, jamais réutilisée — maillage direct ;
 *   • `iceServers: []` TOUJOURS (cf. `lanOnlyConfiguration`) : sans STUN/TURN
 *     Chromium ne collecte que des candidats `host`, donc locaux ;
 *   • garde-fou de second rang : tout candidat non `host` ou d'adresse non
 *     privée/loopback est refusé explicitement, en réutilisant
 *     `isLanCandidate` de `ice-filter.ts` (importé, jamais dupliqué) ;
 *   • Opus 48 kHz mono 32 kbps : contraintes micro mono + munging SDP
 *     `maxaveragebitrate=32000;stereo=0;useinbandfec=1` + `setParameters`
 *     `encodings[].maxBitrate = 32000` ;
 *   • push-to-talk : si la chaîne vocale a un gain d'émission, la piste reste
 *     `enabled` et le silence est ce gain (couper `track.enabled` relance Opus
 *     et le tampon de gigue). Sans ce gain, repli historique : `track.enabled` ;
 *   • `onRemoteStream(peerId, stream)` : un flux entrant PORTE SON PAIR (AD-17 / D3).
 *     Le plan média est le seul à savoir de quelle `RTCPeerConnection` vient la
 *     piste (`ontrack` est par pair) : il transmet donc l'identité au lieu de
 *     laisser l'appelant deviner. Un flux sans pair connu est compté et tracé
 *     par le maillage (`unattributed: N`), jamais rattaché au premier venu ;
 *   • `level(peerId)` = RMS (0..1) via `AnalyserNode`, **un analyseur par pair**,
 *     `null` quand il n'y a pas de mesure pour ce pair (aucun flux, piste finie) —
 *     jamais `0`, qui affirmerait un silence mesuré (AD-17 / D4) ;
 *   • `level()` sans argument = maximum sur tous les analyseurs vivants : c'est le
 *     vumètre global, pas une source de parole ;
 *   • `stats(remoteId)` = 4 nombres, agrégés par `summarizeStats` (testé en Node).
 *
 * Ce fichier tourne dans une PAGE Chromium (renderer, cf. SPEC-005 §1.2) :
 * aucune API Node (aucun chargeur CommonJS, aucun module intégré de Node, aucun
 * tampon binaire de Node), types DOM uniquement. La signalisation, le mDNS et
 * l'IPC restent dans le main.
 *
 * Contraintes de code (C12-3 durci, vérifiées mécaniquement) : zéro cast `as`,
 * zéro assertion non-nulle, aucune directive de contournement de typage.
 */

import { isLanCandidate } from './ice-filter.ts'
import type { Timers } from '../timers.ts'
import {
  MIC_CONSTRAINTS,
  OPUS_MAX_BITRATE,
  OPUS_SAMPLE_RATE,
  applyLanReceiverLatency,
  captureProcessingMismatches,
  lanOnlyConfiguration,
  peerLatencyFromStats,
  summarizeStats,
  toMediaTrackConstraints,
  toProcessingConstraints,
  withOpusSdpParams,
} from './media-config.ts'
import type {
  CaptureSettingsSnapshot,
  LocalAudioClock,
  MediaLatencyReport,
  MicrophoneConstraints,
  PeerAudioDebug,
} from './media-config.ts'
import {
  createVoiceChainHost,
  type FilterAudioContextLike,
  type VoiceChainFactory,
  type VoiceChainHostHandle,
} from './voice-chain.ts'
import type { VoiceFilterId } from './voice-filters.ts'

/** Le connecteur d'un flux vers un analyseur, tel que la page le fait réellement. */
export type MeterSource = (
  context: AudioContext,
  stream: MediaStream,
) => { connect(node: unknown): void }

/** Le connecteur réel : `AudioContext.createMediaStreamSource`. */
const defaultMeterSource: MeterSource = (context, stream) =>
  context.createMediaStreamSource(stream)

/** Options de construction du plan média. */
export interface MediaPlaneOptions {
  localId: string
  rtcConfig?: RTCConfiguration
  /**
   * Candidat local ramassé, AVEC l'identité du pair émetteur (AD-16 / T17, DÉFAUT-D).
   * Sans ce `peerId`, l'appelant ne peut pas router : il ne savait que « un candidat
   * existe », ce qui avait produit une diffusion à tous puis plus rien. `null` = fin
   * de ramassage pour ce pair (transmise telle quelle, no-op côté pair).
   */
  onLocalCandidate?: (peerId: string, c: RTCIceCandidateInit | null) => void
  /**
   * Flux distant reçu, AVEC l'identité du pair émetteur (AD-17 / D3).
   *
   * Ce n'est pas un confort : `ontrack` est un événement *par `RTCPeerConnection`*,
   * donc le plan média est le seul endroit du code qui sait, sans deviner, de quel
   * pair vient le flux. La signature d'avant (`onRemoteStream(stream)`) a produit
   * DÉFAUT-C : l'appelant servait « le premier pair sans flux » et nommait les
   * autres `distant-<n>` à l'écran. Un flux dont le `peerId` n'est pas connu de
   * l'appelant doit être ignoré ET compté, pas attribué au hasard.
   */
  onRemoteStream?: (peerId: string, s: MediaStream) => void
  onStateChange?: (s: { connectionState: RTCPeerConnectionState }) => void
  /**
   * État de connexion AVEC l'identité du pair (défaut (b), SPEC-008 §1).
   *
   * `onStateChange` est un contrat GELÉ : son objet ne porte aucun `peerId`, et
   * l'appelant qui ne voit qu'un `{ connectionState }` nu ne peut que l'appliquer à
   * tous les pairs « connecting » — un pair qui échoue à l'ICE en faisait tomber
   * d'autres en `failed`, et un pair `connected` masquait un pair mort. Ce champ
   * ADDITIONNEL (l'existant n'est pas cassé : les deux sont émis sur le même
   * événement) porte le `remoteId` de la `RTCPeerConnection` qui a changé d'état.
   * C'est lui que la coquille doit router ; `onStateChange` reste émis pour les
   * appelants qui n'attendent que la fréquence globale des changements.
   */
  onPeerConnectionState?: (peerId: string, state: RTCPeerConnectionState) => void
  /**
   * Connecteur de source du vumètre (défaut (a), injection de test).
   *
   * `undefined` = `AudioContext.createMediaStreamSource` — le chemin réel de la
   * page. Un test fournit un connecteur à RMS contrôlable pour falsifier la chaîne
   * complète `ontrack → analyseur → level(peerId)` sans Chromium. Ce n'est PAS un
   * réglage de la coquille : la production ne le fournit jamais.
   */
  meterSource?: MeterSource
  /**
   * Horloge INJECTÉE qui arme le plafond d'1 s du ramassage ICE (T17 / AD-18).
   *
   * Le moteur ne possède pas d'horloge (SPEC-004 §3) : il déclare le besoin, la
   * coquille fournit l'implémentation (`src/renderer/browser-timers.ts`), les tests
   * fournissent une horloge manuelle (`tests/manual-timers.ts`) ou l'horloge inerte
   * `NO_TIMERS` (`src/engine/timers.ts`).
   *
   * **Champ REQUIS (AD-18 / D3, arbitrage SPEC-012)** : il n'existe pas de variante
   * « sans horloge » qui rendrait la main sans attendre. Une horloge oubliée ne se
   * dégrade pas en silence, elle ne compile pas — `npx tsc --noEmit` est l'arbitre.
   */
  timers: Timers
  /**
   * Contraintes de capture du micro (SPEC-019, avenant 2026-11-02, arbitrage JC).
   *
   * `undefined` = `MIC_CONSTRAINTS` — les défauts exacts d'avant 0.4.2 (mono, EC/NS/AGC).
   * La coquille fournit `buildMicrophoneConstraints(reglages.audio)` pour brancher le
   * périphérique, la réduction de bruit, l'annulation d'écho et le gain réglés par
   * l'utilisateur. Le moteur ne lit AUCUN réglage : il reçoit des contraintes prêtes.
   * Ce champ ne touche pas le contrat média (ni ICE, ni Opus, ni la topologie).
   */
  microConstraints?: MicrophoneConstraints
  /**
   * Piste micro OUVERTE à l'ouverture du micro (mode VAD, SPEC-019 avenant 2026-11-02).
   *
   * `undefined`/`false` = push-to-talk historique : piste fermée au repos, ouverte par
   * `setTransmitting(true)`. `true` = détection de voix — la piste reste `enabled`, c'est
   * la mesure (battement + seuil) qui décide de qui parle. La coquille le dérive de
   * `talk.mode` ; le moteur, lui, ne connaît aucun réglage.
   */
  microOpenOnStart?: boolean
  /**
   * Voix appliquée au micro local (filtres vocaux, 2026-11-03, demande JC).
   *
   * `undefined`/`'none'` = la voix historique : AUCUN nœud de filtre, la piste brute part
   * aux pairs (non-régression vérifiée par test). Les autres valeurs demandent au plan média
   * d'insérer la chaîne de filtrage (`renderer/voice-filter.ts`) ENTRE le micro et les pairs.
   * Le constructeur de chaîne est INJECTÉ (`voiceChainFactory`) : le plan ne sait pas, et ne
   * doit pas savoir, construire des nœuds Web Audio — même convention que `meterSource`.
   * La coquille dérive ce champ de `reglages.audio.voiceFilter` ; le moteur ne lit aucun
   * réglage. Un filtre qui lève envoie la voix BRUTE et se trace : une voix refusée n'est pas
   * une session muette.
   */
  voiceFilter?: VoiceFilterId
  /**
   * Le constructeur de la chaîne de filtres (la production : `createVoiceFilterChain` du
   * renderer, liée à son contexte). `undefined` = pas de filtrage possible (le moteur rend
   * la piste brute, même si `voiceFilter` est demandé — tracé). Test : une chaîne doublure
   * éprouve le cycle de vie sans Web Audio.
   */
  voiceChainFactory?: VoiceChainFactory
}

/** Compteurs d'un pair distant. Tous les champs sont des nombres (jamais undefined). */
export interface PeerStats {
  bytesSent: number
  bytesReceived: number
  packetsLost: number
  rttMs: number
}

/** Plan média d'un participant : un objet, N pairs. */
export interface MediaPlane {
  startMicrophone(): Promise<void>
  attach(remoteId: string): Promise<RTCSessionDescriptionInit>
  accept(remoteId: string, offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit>
  acceptAnswer(remoteId: string, answer: RTCSessionDescriptionInit): Promise<void>
  // `null` = candidat de FIN DE RAMASSAGE (DÉFAUT-2 / VERIF-015) : accepté par le
  // contrat parce qu'un `onicecandidate` de Chromium émet `event.candidate === null`
  // en fin de collecte, et qu'un relais peut le transmettre tel quel.
  addRemoteCandidate(remoteId: string, c: RTCIceCandidateInit | null): Promise<void>
  setTransmitting(on: boolean): void
  /**
   * Change la VOIX du micro local en vol (filtres vocaux, 2026-11-03, demande JC) : le graphe
   * de filtrage est remplacé sur la MÊME destination — les pairs ne voient jamais la piste
   * changer d'identité, donc AUCUNE renégociation WebRTC.
   *
   * Rend la piste réellement envoyée après le changement, ou `null` si le micro n'est pas
   * démarré (le réglage est alors une intention que `startMicrophone()` appliquera — jamais un
   * silence prétendu). Une voix que la page ne sait pas fabriquer (page sans `AudioWorklet`
   * qui demande un timbre) envoie la voix BRUTE et se trace : un réglage qui n'a pas pris,
   * pas une panne.
   */
  setVoiceFilter(id: VoiceFilterId): MediaStreamTrack | null
  /** La voix réellement appliquée (`null` = micro non démarré), pas l'intention du réglage. */
  voiceFilter(): VoiceFilterId | null
  /**
   * Réapplique EC / NS / AGC sur la piste de CAPTURE déjà ouverte (`applyConstraints`)
   * et journalise `getSettings()`. Le périphérique, lui, passe par `replaceMicrophone`.
   */
  applyCaptureConstraints(constraints: MicrophoneConstraints): Promise<void>
  /**
   * Nouveau `getUserMedia` (changement de micro). La destination filtrée ne change
   * pas d'identité quand la chaîne sait remplacer son entrée ; l'intention d'émission
   * est réécrite sur le gain courant. Sans chaîne, la piste brute neuve est posée
   * sur chaque pair (`replaceTrack`).
   */
  replaceMicrophone(constraints: MicrophoneConstraints): Promise<void>
  /**
   * Niveau RMS (0..1) d'un pair : **un analyseur par pair** (AD-17 / D4).
   *
   *   • `level('b')` → mesure du pair `b`, ou `null` s'il n'existe aucune mesure
   *     pour lui (aucun flux reçu, piste terminée, analyseur retiré). `null` dit
   *     « je ne mesure pas », `0` dirait « j'ai mesuré le silence » : deux
   *     affirmations différentes, seule la première est vraie quand on n'a rien.
   *   • `level()` (sans argument) → maximum sur les analyseurs vivants : c'est le
   *     vumètre global de l'écran. Ce n'est PAS une source de parole par pair :
   *     il ne dit pas QUI parle.
   */
  level(peerId?: string): number | null
  stats(remoteId: string): Promise<PeerStats>
  /**
   * Horloge locale, cible de gigue et champs `getStats` de latence. Le journal
   * `CONCORD_AUDIO_DEBUG` (toutes les 2 s) est le seul appelant.
   */
  audioDebugReport(): Promise<MediaLatencyReport>
  close(): void
}

/** État mutable d'un pair : sa connexion, son émetteur, ses candidats en attente. */
interface Peer {
  readonly pc: RTCPeerConnection
  sender: RTCRtpSender | null
  /** Récepteur de la piste distante, dès `ontrack` (cible de gigue LAN). */
  receiver: RTCRtpReceiver | null
  readonly pending: RTCIceCandidateInit[]
  remoteDescriptionSet: boolean
}

/** Un vumètre : l'analyseur, son tampon d'échantillons temporels, et sa source. */
interface Meter {
  readonly analyser: AnalyserNode
  readonly buffer: Float32Array<ArrayBuffer>
  /** Le flux mesuré : sert à constater la fin de piste (mesure devenue périmée). */
  readonly stream: MediaStream
}

/** Clé du vumètre du micro local : un pair distant ne peut pas prendre cette clé. */
const LOCAL_METER_KEY = 'local'

/** Garde-fou anti-croissance : au-delà, le plus ancien candidat en attente est jeté. */
const MAX_PENDING_CANDIDATES = 256

/** Taille FFT du vumètre : 512 échantillons ≈ 10,7 ms à 48 kHz. */
const METER_FFT_SIZE = 512

/** Plafond d'attente du ramassage ICE avant de figer le SDP (T17, fait 1 de VERIF-020 §3). */
const ICE_GATHERING_CAP_MS = 1_000

/**
 * Abandon d'une attente de ramassage : désarme son échéance, retire son écouteur
 * et rend `false` à l'appelant. C'est l'entrée rangée dans le registre du plan.
 */
type AbandonGathering = () => void

/**
 * Attend `iceGatheringState === 'complete'`, jamais plus de `ICE_GATHERING_CAP_MS`.
 *
 * Rend `true` si le ramassage est terminé, `false` si le plafond a été atteint (ou
 * si le plan a été fermé pendant l'attente). Dans les deux cas la description locale
 * contient les candidats ramassés jusque-là : on ne perd rien, on cesse seulement
 * d'attendre. Aucun cast : l'état est lu sur l'objet `RTCPeerConnection`, l'événement
 * est écouté puis retiré, et l'échéance armée est **toujours** désarmée (AD-18 / D5) :
 * à l'arrivée du flux, à l'expiration du plafond, et à la fermeture du plan.
 *
 * `timers` n'est jamais optionnel (AD-18 / D3) : pas de branche « pas d'horloge, donc
 * pas d'attente » — une horloge oubliée ne doit pas se dégrader en silence.
 */
async function waitForGathering(
  pc: RTCPeerConnection,
  timers: Timers,
  abandoned: Set<AbandonGathering>,
): Promise<boolean> {
  if (pc.iceGatheringState === 'complete') return true
  // Doublure sans surface DOM (`addEventListener` absent) : rien à écouter, on rend la
  // main immédiatement plutôt que d'attendre un plafond pour un événement qui n'existe pas.
  if (typeof pc.addEventListener !== 'function' || typeof pc.removeEventListener !== 'function') {
    return false
  }
  return await new Promise<boolean>((resolve) => {
    let timer: unknown = null
    let settled = false
    function onChange(): void {
      if (pc.iceGatheringState === 'complete') finish(true)
    }
    function finish(complete: boolean): void {
      if (settled) return
      settled = true
      timers.cancel(timer)
      pc.removeEventListener('icegatheringstatechange', onChange)
      abandoned.delete(abandon)
      resolve(complete)
    }
    function abandon(): void {
      finish(false)
    }
    abandoned.add(abandon)
    pc.addEventListener('icegatheringstatechange', onChange)
    timer = timers.once(ICE_GATHERING_CAP_MS, () => {
      finish(false)
    })
    // L'état a pu changer entre la lecture initiale et la pose de l'écouteur.
    if (pc.iceGatheringState === 'complete') finish(true)
  })
}

/** Message d'erreur d'un `unknown` attrapé, sans cast. */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** RMS d'un bloc d'échantillons flottants (-1..1), borné à 0..1. */
function rootMeanSquare(samples: Float32Array<ArrayBuffer>): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (const sample of samples) sum += sample * sample
  const rms = Math.sqrt(sum / samples.length)
  if (rms < 0) return 0
  if (rms > 1) return 1
  return rms
}

/**
 * Ouvre le micro avec les contraintes reçues (défaut : mono/EC/NS/AGC, SPEC-019 avenant
 * 2026-11-02). Enveloppé dans une fonction pour que l'erreur du navigateur soit traduite en
 * message lisible (et pour ne jamais manipuler une variable « peut-être non affectée »
 * après un try/catch).
 */
async function requestMicrophone(constraints: MicrophoneConstraints): Promise<MediaStream> {
  try {
    // `{ ideal }` et non un booléen nu : la spec lit un booléen comme `exact`, et un
    // micro qui ne peut pas garantir l'exact ferme toute la capture. `gain` n'est pas
    // une contrainte DOM — il est appliqué par le graphe (voice-filter).
    const audio: MediaTrackConstraints = toMediaTrackConstraints(constraints)
    return await navigator.mediaDevices.getUserMedia({ audio })
  } catch (error) {
    throw new Error(`getUserMedia audio a échoué : ${describeError(error)}`)
  }
}

/** Lit `getSettings()` sans supposer que la doublure de test l'implémente. */
function readCaptureSettings(track: MediaStreamTrack): CaptureSettingsSnapshot {
  if (typeof track.getSettings !== 'function') return {}
  const settings = track.getSettings()
  const echo = settings.echoCancellation
  const noise = settings.noiseSuppression
  const agc = settings.autoGainControl
  const rate = settings.sampleRate
  const channels = settings.channelCount
  const snapshot: CaptureSettingsSnapshot = {}
  return {
    ...(typeof echo === 'boolean' ? { echoCancellation: echo } : snapshot),
    ...(typeof noise === 'boolean' ? { noiseSuppression: noise } : snapshot),
    ...(typeof agc === 'boolean' ? { autoGainControl: agc } : snapshot),
    ...(typeof rate === 'number' ? { sampleRate: rate } : snapshot),
    ...(typeof channels === 'number' ? { channelCount: channels } : snapshot),
  }
}

/**
 * Le nœud de mesure d'un flux : source → analyseur.
 *
 * Le connecteur de source est un PARAMÈTRE et non une lecture directe d'
 * `AudioContext.createMediaStreamSource` : c'est la seule façon de mesurer un flux
 * dans une page dont l'AudioContext est SUSPENDU sans le lire (Chromium). Un
 * analyseur branché sur une source que rien n'horodate rend un RMS figé — un faux
 * « pair qui parle » permanent, ou un faux silence permanent. `meterOptions.source`
 * est fourni par les tests ; `sourceNodeFor` ci-dessous reste le chemin réel de la
 * page, et bascule l'AudioContext en « lecture » (`resume()`) avant chaque source
 * distante, puis le rend au micro local.
 */
function attachAnalyser(
  context: AudioContext,
  stream: MediaStream,
  source: (context: AudioContext, stream: MediaStream) => { connect(node: unknown): void },
): { analyser: AnalyserNode; buffer: Float32Array<ArrayBuffer> } {
  const analyser = context.createAnalyser()
  analyser.fftSize = METER_FFT_SIZE
  analyser.smoothingTimeConstant = 0
  source(context, stream).connect(analyser)
  return { analyser, buffer: new Float32Array(METER_FFT_SIZE) }
}

/**
 * Construit le plan média d'un participant.
 *
 * Aucune connexion n'est créée ici : `attach` / `accept` créent la
 * `RTCPeerConnection` du pair, une par identifiant distant, et la gardent
 * jusqu'à `close()`.
 */
function debugMedia(): boolean {
  // Traces de diagnostic du banc deux postes — désactivées par défaut. Activer via
  // `globalThis.__CONCORD_DEBUG__ = true` (page) ou `CONCORD_E2E_DEBUG=1` (node).
  if (Reflect.get(globalThis, '__CONCORD_DEBUG__') === true) return true
  const proc = Reflect.get(globalThis, 'process')
  if (typeof proc !== 'object' || proc === null) return false
  const env = Reflect.get(proc, 'env')
  if (typeof env !== 'object' || env === null) return false
  return Reflect.get(env, 'CONCORD_E2E_DEBUG') === '1'
}

export function createMediaPlane(o: MediaPlaneOptions): MediaPlane {
  const configuration = lanOnlyConfiguration(o.rtcConfig)
  const peers = new Map<string, Peer>()
  /**
   * Attentes de ramassage en cours, par plan média (AD-18 / D5).
   *
   * Chaque entrée abandonne son attente : elle désarme l'échéance d'1 s, retire son
   * écouteur et rend `false`. `close()` les vide toutes — aucune échéance armée ne
   * survit à la fermeture du plan, donc aucun `attach()` abandonné ne tient la boucle.
   */
  const abandonedGatherings = new Set<AbandonGathering>()
  /** Pairs déjà tracés comme attachés sans piste locale : une trace, pas une par appel. */
  const deafWarned = new Set<string>()
  // Un analyseur PAR PAIR (AD-17 / D4), plus un pour le micro local.
  const meters = new Map<string, Meter[]>()
  let localStream: MediaStream | null = null
  let localTrack: MediaStreamTrack | null = null
  /** Piste de CAPTURE (getUserMedia). Le push-to-talk ne la coupe pas : AEC et RNNoise
   * se calibreraient sur le silence. `localTrack` est la piste ENVOYÉE. */
  let captureTrack: MediaStreamTrack | null = null
  // Voix demandée alors que le micro n'est pas encore ouvert (le châssis n'existe pas encore) :
  // appliquée à l'ouverture plutôt que perdue (bug « deux clics », 2026-11-04).
  let pendingVoiceFilter: VoiceFilterId | null = null
  let audioContext: AudioContext | null = null
  /**
   * Le châssis des filtres vocaux (2026-11-03) : ouvert par `startMicrophone`, consulté par
   * `setVoiceFilter`, fermé par `close`. `null` = micro non démarré (le réglage est alors une
   * intention pour la prochaine ouverture, jamais un silence prétendu).
   */
  let voiceHost: VoiceChainHostHandle | null = null
  /**
   * Intention d'émission, UNE seule (VAD ouvert ou PTT enfoncé).
   *
   * `applyTransmitState` est le SEUL écrivain du gain d'émission. Il relit la
   * chaîne courante à chaque appel : un auditeur VAD ne retient pas le nœud
   * du graphe précédent. On l'appelle après chaque construction de graphe,
   * chaque remplacement de piste, chaque changement de mode et chaque join.
   * Sans cela, une intention déjà ouverte (VAD au démarrage) n'a plus de
   * front à émettre, et le gain neuf reste à sa valeur initiale — le vumètre
   * brut, lui, continue de bouger.
   */
  let wantSend = false
  let wantSendKnown = false
  /**
   * Gain muet branché sur `context.destination`. Sans lui, le contexte n'a
   * comme tirage que la `MediaStreamDestination` et Chromium peut prendre le
   * tampon Pulse par défaut (environ 2 s, constant dès la première syllabe).
   * Gain 0 : rien n'est audible, l'horloge reste celle de la sortie.
   */
  let clockPace: GainNode | null = null

  function warn(message: string): void {
    console.warn(`[media-plane ${o.localId}] ${message}`)
  }

  function finiteProp(target: object, key: string): number | null {
    const value = Reflect.get(target, key)
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }

  /** Cale le rendu sur la sortie, quantum « interactive », sans s'entendre. */
  function paceAudioContext(context: AudioContext): void {
    if (clockPace !== null) return
    try {
      const silent = context.createGain()
      silent.gain.value = 0
      silent.connect(context.destination)
      clockPace = silent
    } catch (error) {
      warn(`horloge AudioContext non calée sur la sortie : ${describeError(error)}`)
    }
  }

  /**
   * Contexte à 48 kHz (Opus), latence interactive. Un matériel qui refuse
   * retombe sur sa fréquence, et c'est dit. `interactive` + le gain muet
   * évitent le tampon de lecture long qui décale toute la voix d'un bloc.
   */
  function openAudioContext(label: string): AudioContext {
    let context: AudioContext
    try {
      context = new AudioContext({ sampleRate: OPUS_SAMPLE_RATE, latencyHint: 'interactive' })
    } catch (error) {
      warn(`AudioContext ${OPUS_SAMPLE_RATE} Hz interactif refusé (${label}) : ${describeError(error)}`)
      try {
        context = new AudioContext({ latencyHint: 'interactive' })
      } catch (fallback) {
        warn(`AudioContext interactif refusé (${label}) : ${describeError(fallback)}`)
        context = new AudioContext()
      }
    }
    paceAudioContext(context)
    const rate = context.sampleRate
    const state = context.state
    const base = finiteProp(context, 'baseLatency')
    const output = finiteProp(context, 'outputLatency')
    console.info(
      `[media-plane ${o.localId}] AudioContext state=${typeof state === 'string' ? state : 'inconnu'} sampleRate=${typeof rate === 'number' ? String(rate) : 'inconnu'} latencyHint=interactive baseLatency=${base === null ? 'inconnu' : String(base)} outputLatency=${output === null ? 'inconnu' : String(output)}`,
    )
    if (typeof rate === 'number' && rate !== OPUS_SAMPLE_RATE) {
      warn(`AudioContext ${rate} Hz ≠ Opus ${OPUS_SAMPLE_RATE} Hz (${label})`)
    }
    // Reprise réelle (suspended → running) : le gain courant reprend l'intention.
    // Un contexte qui était suspendu peut avoir figé la piste de destination.
    // On n'écrit PAS dans le `then` de la première `resume` : elle se résout
    // souvent avant que le graphe existe, ou une seconde fois après l'écriture
    // déjà faite par `startMicrophone`, et le push-to-talk compterait un front de trop.
    if ('addEventListener' in context && typeof context.addEventListener === 'function') {
      context.addEventListener('statechange', () => {
        if (context.state === 'running') applyTransmitState()
      })
    }
    void context.resume().then(() => {
      const running = context.state
      if (typeof running === 'string' && running !== 'running') {
        warn(`AudioContext état « ${running} » (${label}) : le graphe vocal ne tourne pas`)
      }
    }).catch((error: unknown) => {
      warn(`AudioContext.resume a échoué (${label}) : ${describeError(error)}`)
    })
    return context
  }

  function logCapture(track: MediaStreamTrack, requested: MicrophoneConstraints): void {
    const applied = readCaptureSettings(track)
    console.info(
      `[media-plane ${o.localId}] capture getSettings echoCancellation=${String(applied.echoCancellation)} noiseSuppression=${String(applied.noiseSuppression)} autoGainControl=${String(applied.autoGainControl)} sampleRate=${String(applied.sampleRate)} channelCount=${String(applied.channelCount)} (demandé EC=${String(requested.echoCancellation === true)} NS=${String(requested.noiseSuppression === true)} AGC=${String(requested.autoGainControl === true)})`,
    )
    for (const line of captureProcessingMismatches(requested, applied)) {
      warn(`capture : ${line}`)
    }
  }

  /** Refus explicite et traçable d'un candidat hors LAN (jamais silencieux). */
  function refuseCandidate(direction: string, remoteId: string, candidate: string): void {
    warn(`candidat ICE ${direction} REFUSÉ (non host/LAN) pour ${remoteId} : ${candidate}`)
  }

  function peerFor(remoteId: string): Peer {
    const peer = peers.get(remoteId)
    if (peer === undefined) {
      throw new Error(`[media-plane] pair inconnu : ${remoteId} (aucun attach/accept)` )
    }
    return peer
  }

  /**
   * Le connecteur de source réel de la page. Les tests le remplacent (défaut (a))
   * pour injecter un RMS contrôlable et prouver qu'un flux distant est MESURABLE
   * dès qu'il arrive, que le micro local soit ouvert ou non, que l'AudioContext
   * soit suspendu ou non.
   */
  const meterSource = o.meterSource ?? defaultMeterSource

  /** Vrai si la piste distante peut encore produire des échantillons. */
  function streamHasLiveTrack(stream: MediaStream): boolean {
    return stream.getAudioTracks().some((track) => track.readyState !== 'ended')
  }

  /**
   * Ajoute un vumètre sur un flux (micro local ou flux distant), rattaché à une clé :
   * `LOCAL_METER_KEY` ou l'identifiant du pair. Un second flux pour la même clé
   * remplace le précédent — un pair n'a qu'une piste, et un analyseur orphelin
   * continuerait de mesurer un flux mort.
   *
   * DÉFAUT (a) : un flux distant dont la piste est déjà FINIE ne reçoit PAS
   * d'analyseur. Avant cette garde, `addMeter` branchait l'analyseur d'abord et ne
   * consultait `readyState` qu'à la lecture — une piste `'ended'` renvoyait alors le
   * dernier tampon de l'AnalyserNode, c'est-à-dire un RMS FIGÉ non nul : un faux
   * « pair qui parle » permanent, branché dès `ontrack` même si personne ne
   * l'attendait (le micro local était-il ouvert ou non, l'analyseur vivait).
   * Refuser l'analyseur ici, c'est rendre `level(peerId)` à `null` — l'absence
   * d'affirmation, pas une affirmation de silence.
   */
  function addMeter(key: string, stream: MediaStream, label: string): void {
    if (key !== LOCAL_METER_KEY && !streamHasLiveTrack(stream)) {
      meters.delete(key)
      warn(`vumètre refusé (${label}) : le flux ne porte aucune piste vivante — level() rendra null`)
      return
    }
    try {
      if (audioContext === null) {
        audioContext = openAudioContext(label)
      }
      const context = audioContext
      const meter = attachAnalyser(context, stream, meterSource)
      meters.set(key, [{ ...meter, stream }])
    } catch (error) {
      warn(`vumètre indisponible (${label}) : ${describeError(error)}`)
    }
  }

  /** Vrai si le flux mesuré peut encore produire des échantillons. */
  function meterIsLive(meter: Meter): boolean {
    return meter.stream.getAudioTracks().some((track) => track.readyState !== 'ended')
  }

  /**
   * Analyseurs encore vivants d'une clé. Une piste finie rend la mesure PÉRIMÉE :
   * on retire l'analyseur et on rend `null` — jamais `0` (AD-17 / D4).
   */
  function liveMeters(key: string): readonly Meter[] | null {
    const list = meters.get(key)
    if (list === undefined) return null
    const live = list.filter(meterIsLive)
    if (live.length === 0) {
      meters.delete(key)
      return null
    }
    return live
  }

  /** Mesure une liste d'analyseurs : RMS lue, maximum retenu. */
  function peakOf(list: readonly Meter[]): number {
    let peak = 0
    for (const meter of list) {
      meter.analyser.getFloatTimeDomainData(meter.buffer)
      const rms = rootMeanSquare(meter.buffer)
      if (rms > peak) peak = rms
    }
    return peak
  }

  /**
   * Applique le débit Opus sur l'émetteur.
   *
   * Chromium refuse un tableau `encodings` partiel (`InvalidModificationError`) :
   * on relit donc les paramètres courants, on fixe `maxBitrate` = 32 kbps sur
   * l'encodage existant, puis on renvoie l'objet complet à `setParameters`.
   * Équivalent exact de `setParameters({ encodings: [{ maxBitrate: 32000 }] })`
   * là où Chromium l'accepte.
   */
  async function tuneSender(sender: RTCRtpSender): Promise<void> {
    try {
      const parameters = sender.getParameters()
      if (parameters.encodings.length === 0) return
      for (const encoding of parameters.encodings) {
        encoding.maxBitrate = OPUS_MAX_BITRATE
      }
      await sender.setParameters(parameters)
    } catch (error) {
      warn(`setParameters(Opus 32 kbps) refusé : ${describeError(error)}`)
    }
  }

  /**
   * Trace l'ordre d'appel fautif `attach/accept` AVANT `startMicrophone()`.
   *
   * Ce n'est pas une erreur de type : `attach()` et `accept()` négocient la
   * description LOCALE au moment de l'appel. Sans piste locale, elle part sans
   * ligne audio négociée, et le pair distant la reçoit déjà ; le branchement
   * fait plus tard par `startMicrophone()` tombe donc après
   * `setLocalDescription` — et comme ce plan média n'ouvre jamais de
   * renégociation, le lien est né SOURD, définitivement. Le cas est légitime
   * (une piste peut arriver après le pair) mais il ne doit pas être muet : on
   * le trace une fois par pair, avec la cause et le remède.
   */
  function warnDeafLink(remoteId: string): void {
    if (deafWarned.has(remoteId)) return
    deafWarned.add(remoteId)
    warn(
      `pair ${remoteId} attaché SANS piste locale : description locale négociée sans audio ` +
        '(startMicrophone() doit précéder attach/accept) — ce lien ne portera aucune voix'
    )
  }

  /**
   * Écrit `wantSend` sur le gain d'émission de la chaîne COURANTE, ou à défaut
   * sur `track.enabled`. Seul point d'écriture : filtre, périphérique, pair,
   * reprise du contexte et `setTransmitting` passent tous par ici.
   */
  function applyTransmitState(): void {
    const track = localTrack
    if (track === null) return
    const gated = voiceHost !== null && voiceHost.setSendOpen(wantSend)
    if (gated) {
      // La piste reste ouverte. `enabled = false` coupe le flux Opus : au
      // réveil, le tampon de gigue du pair repart à froid et peut poser
      // d'un coup 2 à 3 s qu'il ne rend pas. Le silence est le gain d'émission.
      track.enabled = true
      if (captureTrack !== null && captureTrack !== track) captureTrack.enabled = true
      return
    }
    track.enabled = wantSend
    if (captureTrack !== null && captureTrack !== track) captureTrack.enabled = true
  }

  async function attachLocalTrack(remoteId: string, peer: Peer): Promise<void> {
    const track = localTrack
    if (track === null) {
      warnDeafLink(remoteId)
      return
    }
    applyTransmitState()
    if (peer.sender === null) {
      const stream = localStream === null ? new MediaStream([track]) : localStream
      peer.sender = peer.pc.addTrack(track, stream)
    } else {
      await peer.sender.replaceTrack(track)
    }
    await tuneSender(peer.sender)
  }

  function onIceCandidate(remoteId: string, event: RTCPeerConnectionIceEvent): void {
    const notify = o.onLocalCandidate
    const candidate = event.candidate
    if (candidate === null) {
      // Fin de ramassage : signalée elle aussi, avec le pair émetteur (no-op chez lui,
      // mais le maillage doit pouvoir la router et la tracer plutôt que de la perdre).
      if (notify !== undefined) notify(remoteId, null)
      return
    }
    const init: RTCIceCandidateInit = {
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid,
      sdpMLineIndex: candidate.sdpMLineIndex,
    }
    // `usernameFragment` identifie la génération ICE. On ne le pose que s'il
    // existe : `null` (fin de ramassage, ou candidat sans ufrag) n'a rien à dire.
    const ufrag = candidate.usernameFragment
    if (typeof ufrag === 'string' && ufrag.length > 0) init.usernameFragment = ufrag
    if (!isLanCandidate(init)) {
      refuseCandidate('local', remoteId, candidate.candidate)
      return
    }
    if (notify !== undefined) notify(remoteId, init)
  }

  /** Crée (ou rend) la connexion du pair, et son câblage d'événements. */
  function ensurePeer(remoteId: string): Peer {
    const existing = peers.get(remoteId)
    if (existing !== undefined) return existing
    const pc = new RTCPeerConnection(configuration)
    const peer: Peer = { pc, sender: null, receiver: null, pending: [], remoteDescriptionSet: false }

    pc.onicecandidate = (event) => {
      onIceCandidate(remoteId, event)
    }
    pc.onconnectionstatechange = () => {
      const notify = o.onStateChange
      if (notify !== undefined) notify({ connectionState: pc.connectionState })
      // Défaut (b) : le MÊME événement, portés par l'identité du pair. `pc` a été
      // construit POUR `remoteId` — c'est le seul endroit qui le sait sans deviner.
      const notifyPeer = o.onPeerConnectionState
      if (notifyPeer !== undefined) notifyPeer(remoteId, pc.connectionState)
    }
    pc.ontrack = (event) => {
      // Ici, et nulle part ailleurs, on sait de quel pair vient la piste :
      // `pc` a été construit POUR `remoteId`. Le vumètre est donc rattaché au pair
      // et le flux part avec son identité (AD-17 / D3 et D4).
      // Cible de gigue AVANT la première syllabe : un récepteur Windows qui
      // choisit seul peut verrouiller 2 à 3 s dès le premier paquet.
      const receiver = event.receiver
      if (receiver !== undefined && receiver !== null) {
        peer.receiver = receiver
        applyLanReceiverLatency(receiver)
      }
      const first = event.streams[0]
      const stream = first === undefined ? new MediaStream([event.track]) : first
      addMeter(remoteId, stream, `distant ${remoteId}`)
      const notify = o.onRemoteStream
      if (notify === undefined) return
      notify(remoteId, stream)
    }

    peers.set(remoteId, peer)
    return peer
  }

  /**
   * Rebâtit `sdpMid`/`sdpMLineIndex` d'un candidat sans coordonnées depuis la
   * description distante.
   *
   * Bogue 2026-11-04 (0.4.17) : la voie câble textuel remballe `{ candidate }`
   * sans coordonnées ; Chromium rejette alors l'ajout — « Candidate missing
   * values for both sdpMid and sdpMLineIndex ». La coordonnée canonique est
   * l'index de la media-section `m=audio`, avec son `a=mid:` s'il en porte un ;
   * jamais un mid inventé, et aucun index si le SDP n'a pas d'audio. Une
   * coordonnée déjà présente n'est pas réécrite. `usernameFragment`, quand le
   * fil le porte, est conservé.
   *
   * Les deux chemins passent ici : la file (avant `setRemoteDescription`) et
   * l'arrivée directe (après).
   */
  function rehydrateCandidate(candidate: RTCIceCandidateInit, remoteSdp: string | null | undefined): RTCIceCandidateInit {
    if (candidate.sdpMid != null || candidate.sdpMLineIndex != null) return candidate
    if (typeof remoteSdp !== 'string' || remoteSdp.length === 0) return candidate
    const sections = remoteSdp.split(/\r?\n/)
    let index = -1
    let audioIndex = -1
    let audioMid: string | undefined
    for (const line of sections) {
      if (line.startsWith('m=')) {
        index += 1
        if (line.startsWith('m=audio') && audioIndex === -1) {
          audioIndex = index
          audioMid = undefined
        }
        continue
      }
      if (index === audioIndex && audioMid === undefined && line.startsWith('a=mid:')) {
        audioMid = line.slice('a=mid:'.length).trim()
      }
    }
    if (audioIndex < 0) return candidate
    const rehydrated: RTCIceCandidateInit = { candidate: candidate.candidate, sdpMLineIndex: audioIndex }
    if (audioMid !== undefined && audioMid.length > 0) rehydrated.sdpMid = audioMid
    const ufrag = candidate.usernameFragment
    if (typeof ufrag === 'string' && ufrag.length > 0) rehydrated.usernameFragment = ufrag
    return rehydrated
  }

  /**
   * Ajoute un candidat déjà filtré LAN. La file et le chemin direct (après
   * `setRemoteDescription`) partagent ce geste : mêmes coordonnées, même
   * journal si Chromium refuse. L'exception ne sort pas.
   */
  async function applyRemoteCandidate(
    peer: Peer,
    candidate: RTCIceCandidateInit,
    queued: boolean,
  ): Promise<void> {
    const ready = rehydrateCandidate(candidate, peer.pc.remoteDescription?.sdp)
    try {
      await peer.pc.addIceCandidate(ready)
    } catch (error) {
      const where = queued ? 'en attente ' : ''
      warn(`addIceCandidate ${where}rejeté : ${describeError(error)}`)
    }
  }

  /** Vide la file des candidats distants reçus avant la description distante. */
  async function flushPending(peer: Peer): Promise<void> {
    if (peer.pending.length === 0) return
    const queued = peer.pending.splice(0, peer.pending.length)
    if (debugMedia()) console.warn(`[media-plane] FLUSH ${String(queued.length)} candidats (local=${String(peer.pc.localDescription?.type)}, remote=${String(peer.pc.remoteDescription?.type)})`)
    for (const candidate of queued) {
      await applyRemoteCandidate(peer, candidate, true)
    }
  }

  /** SDP mungé → description locale, sans cast. */
  function toDescription(type: RTCSdpType, sdp: string | undefined): RTCSessionDescriptionInit {
    const description: RTCSessionDescriptionInit = { type }
    const munged = withOpusSdpParams(sdp === undefined ? '' : sdp)
    if (munged.length > 0) description.sdp = munged
    return description
  }

  /**
   * AD-17 / D4 — un analyseur par pair.
   *
   * Sans argument : maximum des analyseurs vivants (vumètre global, `0` si rien
   * n'est mesuré). Avec un `peerId` : la mesure de CE pair, ou `null` s'il n'y en
   * a pas — `null` n'est pas `0` (voir le contrat ci-dessus).
   */
  function level(peerId?: string): number | null {
    if (peerId !== undefined) {
      const list = liveMeters(peerId)
      if (list === null) return null
      return peakOf(list)
    }
    let peak = 0
    for (const key of [...meters.keys()]) {
      const list = liveMeters(key)
      if (list === null) continue
      const value = peakOf(list)
      if (value > peak) peak = value
    }
    return peak
  }

  async function startMicrophone(): Promise<void> {
    if (localTrack !== null) return
    // Facettes de capture normalisées une par une (jamais un spread du type DOM) : la facette
    // du réglage est une CHAÎNE ou rien, un booléen est un booléen ou rien — une valeur que
    // le schéma ne produit jamais retombe sur le défaut (micro système, EC/NS/AGC actifs).
    const requested = o.microConstraints ?? MIC_CONSTRAINTS
    const constraints: MicrophoneConstraints = {
      channelCount: 1,
      echoCancellation: requested.echoCancellation === true,
      noiseSuppression: requested.noiseSuppression === true,
      autoGainControl: requested.autoGainControl === true,
    }
    if (typeof requested.deviceId === 'string' && requested.deviceId !== '') {
      constraints.deviceId = requested.deviceId
    }
    if (typeof requested.gain === 'number' && Number.isFinite(requested.gain)) {
      constraints.gain = requested.gain
    }
    const stream = await requestMicrophone(constraints)
    const first = stream.getAudioTracks()[0]
    if (first === undefined) {
      stream.getTracks().forEach((track) => track.stop())
      throw new Error('le flux micro ne contient aucune piste audio')
    }
    localStream = stream
    captureTrack = first
    logCapture(first, constraints)
    // Filtres vocaux (2026-11-03, demande JC) : la chaîne est ouverte AVANT que la piste
    // locale soit retenue — `localTrack` devient la piste des pairs (filtrée, ou brute si la
    // chaîne est absente/a levé, tracé dans les deux cas). `setTransmitting` et `attachLocalTrack`
    // agissent donc sur la piste filtrée, jamais sur la piste micro : c'est le point unique
    // d'insertion, et le micro local n'est jamais envoyé brut quand une voix est demandée.
    // Le châssis appelle le constructeur MÊME pour « none » (une chaîne saine ne pose aucun
    // nœud — vérifié en test — et un échec de fabrication reste tracé). Le contexte audio de la
    // page est créé ICI et partagé avec les vumètres : une horloge par page (le double
    // `AudioContext` est le piège RMS du repo), et `resume()` est posé avant fabrication.
    // Le geste le plus récent prime : une demande mémorisée avant ouverture passe avant le
    // réglage d'ouverture (bug « deux clics », 2026-11-04).
    const initialVoice = pendingVoiceFilter ?? o.voiceFilter ?? 'none'
    pendingVoiceFilter = null
    let buildChain: VoiceChainFactory | undefined
    let chainContext: FilterAudioContextLike | undefined
    if (o.voiceChainFactory !== undefined) {
      const factory = o.voiceChainFactory
      if (audioContext === null) {
        audioContext = openAudioContext('filtre vocal')
      }
      const filterContext = audioContext
      try {
        await filterContext.resume()
      } catch (error) {
        warn(`AudioContext.resume a échoué (filtre vocal) : ${describeError(error)}`)
      }
      const running = filterContext.state
      if (typeof running === 'string' && running !== 'running') {
        warn(`AudioContext état « ${running} » au montage du filtre : le graphe ne tourne pas`)
      }
      const rate = filterContext.sampleRate
      if (typeof rate === 'number' && rate !== OPUS_SAMPLE_RATE) {
        warn(`AudioContext ${rate} Hz au montage du filtre ≠ Opus ${OPUS_SAMPLE_RATE} Hz`)
      }
      buildChain = factory
      chainContext = filterContext
    }
    const chainContextForHost = chainContext
    voiceHost = createVoiceChainHost({
      stream,
      track: first,
      warn,
      ...(chainContextForHost === undefined ? {} : { context: chainContextForHost }),
      ...(buildChain === undefined ? {} : { buildChain }),
    })
    const outgoing = voiceHost.open(initialVoice)
    localTrack = outgoing
    // Push-to-talk : micro fermé au repos, ouvert par setTransmitting(true) — SAUF si
    // l'appelant a demandé l'inverse à la construction (mode VAD, SPEC-019 avenant
    // 2026-11-02) : en détection de voix le micro doit rester ouvert, c'est la mesure qui
    // décide de qui parle. Le défaut (`undefined`) garde le comportement d'avant.
    //
    // La VAD de construction GAGNE sur un `setTransmitting(false)` arrivé avant le
    // graphe (relâchement du bouton, contrôle encore en push-to-talk). Ce faux front
    // a posé `wantSendKnown` : sans cet écrasement, `microOpenOnStart` était ignoré,
    // le gain naissait fermé, et la VAD déjà ouverte n'avait plus de transition à
    // émettre. Basculer le mode recréait ce front — d'où le contournement.
    if (o.microOpenOnStart === true) {
      wantSend = true
      wantSendKnown = true
    } else if (!wantSendKnown) {
      wantSend = false
      wantSendKnown = true
    }
    // Le levier est la piste ENVOYÉE aux pairs (filtrée quand une voix vit, brute sinon) —
    // jamais la piste micro, qui continuerait d'alimenter le graphe de filtrage en silence.
    applyTransmitState()
    // Le vumètre local mesure le MICRO BRUT (la piste `first`), pas la piste filtrée : le
    // push-to-talk et le battement VAD décident sur la voix réelle, pas sur sa version robot —
    // un robot dont la modulation d'anneau ferait osciller le détecteur n'est pas un VAD.
    addMeter(LOCAL_METER_KEY, stream, 'micro local')
    for (const [remoteId, peer] of peers) {
      await attachLocalTrack(remoteId, peer)
    }
  }

  /**
   * Fige la description locale APRÈS le ramassage : sur un LAN sans STUN
   * (`iceServers: []`), les `a=candidate` en ligne sont le seul chemin qui
   * existe si le canal de candidats est indisponible (fait 1 de VERIF-020 §3).
   */
  function frozenDescription(pc: RTCPeerConnection, fallback: RTCSessionDescriptionInit): RTCSessionDescriptionInit {
    const local = pc.localDescription
    if (local === null) return fallback
    return toDescription(fallback.type, local.sdp)
  }

  async function attach(remoteId: string): Promise<RTCSessionDescriptionInit> {
    const peer = ensurePeer(remoteId)
    await attachLocalTrack(remoteId, peer)
    const offer = await peer.pc.createOffer()
    const description = toDescription(offer.type, offer.sdp)
    await peer.pc.setLocalDescription(description)
    await waitForGathering(peer.pc, o.timers, abandonedGatherings)
    return frozenDescription(peer.pc, description)
  }

  async function accept(remoteId: string, offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    const peer = ensurePeer(remoteId)
    await attachLocalTrack(remoteId, peer)
    await peer.pc.setRemoteDescription(offer)
    peer.remoteDescriptionSet = true
    await flushPending(peer)
    const answer = await peer.pc.createAnswer()
    const description = toDescription(answer.type, answer.sdp)
    await peer.pc.setLocalDescription(description)
    await waitForGathering(peer.pc, o.timers, abandonedGatherings)
    return frozenDescription(peer.pc, description)
  }

  async function acceptAnswer(remoteId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    const peer = peerFor(remoteId)
    await peer.pc.setRemoteDescription(answer)
    peer.remoteDescriptionSet = true
    await flushPending(peer)
  }

  async function addRemoteCandidate(
    remoteId: string,
    candidate: RTCIceCandidateInit | null
  ): Promise<void> {
    // DÉFAUT-2 (VERIF-015) : `null` n'est PAS un candidat, c'est le marqueur de
    // fin de ramassage. No-op DOCUMENTÉ : pas d'exception (l'appelant relaye un
    // signal légitime), pas de refus `off-lan` (il tracerait une fausse anomalie
    // sur chaque lien établi), et surtout aucune lecture de propriété sur `null`.
    if (candidate === null) return
    if (!isLanCandidate(candidate)) {
      refuseCandidate('distant', remoteId, candidate.candidate === undefined ? '' : candidate.candidate)
      return
    }
    const peer = peerFor(remoteId)
    if (!peer.remoteDescriptionSet) {
      if (peer.pending.length >= MAX_PENDING_CANDIDATES) peer.pending.shift()
      peer.pending.push(candidate)
      return
    }
    await applyRemoteCandidate(peer, candidate, false)
  }

  function setTransmitting(on: boolean): void {
    wantSend = on
    wantSendKnown = true
    const track = localTrack
    if (track === null) {
      warn('setTransmitting ignoré : micro non démarré')
      return
    }
    applyTransmitState()
  }

  function setVoiceFilter(id: VoiceFilterId): MediaStreamTrack | null {
    if (voiceHost === null) {
      // Micro non démarré : le réglage est une intention (o.voiceFilter est lu à l'ouverture),
      // jamais un succès prétendu. La coquille n'a rien à renégocier.
      // Bug « deux clics » (2026-11-04) : l'intention est MEMORISEE — un clic qui tombe pendant
      // l'entrée en salon (getUserMedia en cours) était perdu et exigeait un second clic.
      pendingVoiceFilter = id
      return null
    }
    const next = voiceHost.apply(id)
    if (next === null) return null
    // Le graphe change sur la même destination la plupart du temps, mais un repli
    // (panne) ou une destination neuve change l'identité de la piste. Chaque pair
    // doit recevoir CETTE piste — sinon l'émetteur garde le micro brut.
    // L'intention d'émission est réappliquée ICI : une piste neuve naît souvent
    // coupée, et le VAD déjà ouvert n'a pas de nouvelle transition à émettre.
    localTrack = next
    applyTransmitState()
    for (const [remoteId, peer] of peers) {
      void attachLocalTrack(remoteId, peer).catch((error: unknown) => {
        warn(`replaceTrack voix « ${id} » refusé pour ${remoteId} : ${describeError(error)}`)
      })
    }
    return next
  }

  async function applyCaptureConstraints(next: MicrophoneConstraints): Promise<void> {
    const track = captureTrack
    if (track === null) return
    if (typeof track.applyConstraints !== 'function') {
      warn('applyConstraints indisponible : EC/NS/AGC inchangés jusqu’à la prochaine ouverture')
      return
    }
    try {
      await track.applyConstraints(toProcessingConstraints(next))
    } catch (error) {
      warn(`applyConstraints (EC/NS/AGC) refusé : ${describeError(error)}`)
    }
    logCapture(track, next)
  }

  async function replaceMicrophone(constraints: MicrophoneConstraints): Promise<void> {
    if (captureTrack === null) return
    const stream = await requestMicrophone(constraints)
    const first = stream.getAudioTracks()[0]
    if (first === undefined) {
      stream.getTracks().forEach((track) => track.stop())
      throw new Error('le flux micro ne contient aucune piste audio')
    }
    const previousStream = localStream
    localStream = stream
    captureTrack = first
    logCapture(first, constraints)
    let kept = false
    if (voiceHost !== null) {
      try {
        kept = voiceHost.replaceInput(stream)
      } catch (error) {
        warn(`remplacement du micro dans la chaîne refusé : ${describeError(error)}`)
        kept = false
      }
    }
    if (previousStream !== null) {
      for (const track of previousStream.getTracks()) track.stop()
    }
    if (!kept) {
      localTrack = first
      for (const [remoteId, peer] of peers) {
        await attachLocalTrack(remoteId, peer)
      }
    }
    addMeter(LOCAL_METER_KEY, stream, 'micro local')
    // Le graphe (ou la piste brute) est neuf : l'intention VAD déjà ouverte
    // n'émet pas de nouveau front. On la réécrit sur le gain courant.
    applyTransmitState()
  }

  function voiceFilter(): VoiceFilterId | null {
    return voiceHost === null ? null : voiceHost.current()
  }

  function readClock(): LocalAudioClock {
    const context = audioContext
    const capture = captureTrack === null ? null : readCaptureSettings(captureTrack)
    return {
      sampleRate: context === null ? null : finiteProp(context, 'sampleRate'),
      baseLatencySec: context === null ? null : finiteProp(context, 'baseLatency'),
      outputLatencySec: context === null ? null : finiteProp(context, 'outputLatency'),
      state: context === null || typeof context.state !== 'string' ? null : context.state,
      captureSampleRate: capture === null || typeof capture.sampleRate !== 'number' ? null : capture.sampleRate,
      captureChannels: capture === null || typeof capture.channelCount !== 'number' ? null : capture.channelCount,
    }
  }

  async function audioDebugReport(): Promise<MediaLatencyReport> {
    const rows: PeerAudioDebug[] = []
    for (const [peerId, peer] of peers) {
      const entries: unknown[] = []
      try {
        const report = await peer.pc.getStats()
        report.forEach((entry) => {
          entries.push(entry)
        })
      } catch (error) {
        warn(`getStats debug refusé pour ${peerId} : ${describeError(error)}`)
      }
      const receiver = peer.receiver
      rows.push({
        peerId,
        jitterBufferTargetMs: receiver === null ? null : finiteProp(receiver, 'jitterBufferTarget'),
        playoutDelayHintSec: receiver === null ? null : finiteProp(receiver, 'playoutDelayHint'),
        latency: peerLatencyFromStats(entries),
      })
    }
    return { clock: readClock(), sendOpen: wantSend, peers: rows }
  }

  async function stats(remoteId: string): Promise<PeerStats> {
    const peer = peerFor(remoteId)
    const report = await peer.pc.getStats()
    const entries: unknown[] = []
    report.forEach((entry) => {
      entries.push(entry)
    })
    const summary = summarizeStats(entries)
    return {
      bytesSent: summary.bytesSent,
      bytesReceived: summary.bytesReceived,
      packetsLost: summary.packetsLost,
      rttMs: summary.rttMs,
    }
  }

  function close(): void {
    // AD-18 / D5 : toute échéance armée est désarmée ici. Une attente de ramassage
    // encore ouverte est abandonnée (`false`) plutôt que laissée pendante : son
    // échéance d'1 s ne sonnera jamais après la fermeture.
    for (const abandon of [...abandonedGatherings]) abandon()
    abandonedGatherings.clear()
    for (const peer of peers.values()) {
      peer.pc.onicecandidate = null
      peer.pc.ontrack = null
      peer.pc.onconnectionstatechange = null
      peer.pc.close()
    }
    peers.clear()
    meters.clear()
    if (voiceHost !== null) {
      voiceHost.close()
      voiceHost = null
    }
    if (localStream !== null) {
      for (const track of localStream.getTracks()) track.stop()
    }
    localStream = null
    localTrack = null
    captureTrack = null
    const context = audioContext
    audioContext = null
    const pace = clockPace
    clockPace = null
    if (pace !== null) {
      try {
        pace.disconnect()
      } catch {
        // Déjà coupé avec le contexte.
      }
    }
    if (context !== null) {
      context.close().catch((error: unknown) => {
        warn(`AudioContext.close a échoué : ${describeError(error)}`)
      })
    }
  }

  return {
    startMicrophone,
    attach,
    accept,
    acceptAnswer,
    addRemoteCandidate,
    setTransmitting,
    setVoiceFilter,
    voiceFilter,
    applyCaptureConstraints,
    replaceMicrophone,
    level,
    stats,
    audioDebugReport,
    close,
  }
}
