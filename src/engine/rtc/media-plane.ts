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
 *   • push-to-talk : `setTransmitting(on)` = `track.enabled`, micro **coupé au
 *     repos** ;
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
  lanOnlyConfiguration,
  summarizeStats,
  withOpusSdpParams,
} from './media-config.ts'

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
  close(): void
}

/** État mutable d'un pair : sa connexion, son émetteur, ses candidats en attente. */
interface Peer {
  readonly pc: RTCPeerConnection
  sender: RTCRtpSender | null
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
 * Ouvre le micro avec les contraintes mono/EC/NS/AGC.
 * Enveloppé dans une fonction pour que l'erreur du navigateur soit traduite en
 * message lisible (et pour ne jamais manipuler une variable « peut-être non
 * affectée » après un try/catch).
 */
async function requestMicrophone(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS })
  } catch (error) {
    throw new Error(`getUserMedia audio a échoué : ${describeError(error)}`)
  }
}

/**
 * Construit le plan média d'un participant.
 *
 * Aucune connexion n'est créée ici : `attach` / `accept` créent la
 * `RTCPeerConnection` du pair, une par identifiant distant, et la gardent
 * jusqu'à `close()`.
 */
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
  let audioContext: AudioContext | null = null

  function warn(message: string): void {
    console.warn(`[media-plane ${o.localId}] ${message}`)
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
   * Ajoute un vumètre sur un flux (micro local ou flux distant), rattaché à une clé :
   * `LOCAL_METER_KEY` ou l'identifiant du pair. Un second flux pour la même clé
   * remplace le précédent — un pair n'a qu'une piste, et un analyseur orphelin
   * continuerait de mesurer un flux mort.
   */
  function addMeter(key: string, stream: MediaStream, label: string): void {
    try {
      if (audioContext === null) {
        audioContext = new AudioContext()
        audioContext.resume().catch((error: unknown) => {
          warn(`AudioContext.resume a échoué (${label}) : ${describeError(error)}`)
        })
      }
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = METER_FFT_SIZE
      analyser.smoothingTimeConstant = 0
      audioContext.createMediaStreamSource(stream).connect(analyser)
      meters.set(key, [{ analyser, buffer: new Float32Array(METER_FFT_SIZE), stream }])
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

  /** Branche la piste micro locale sur un pair (création ou remplacement). */
  async function attachLocalTrack(remoteId: string, peer: Peer): Promise<void> {
    const track = localTrack
    if (track === null) {
      warnDeafLink(remoteId)
      return
    }
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
    const peer: Peer = { pc, sender: null, pending: [], remoteDescriptionSet: false }

    pc.onicecandidate = (event) => {
      onIceCandidate(remoteId, event)
    }
    pc.onconnectionstatechange = () => {
      const notify = o.onStateChange
      if (notify !== undefined) notify({ connectionState: pc.connectionState })
    }
    pc.ontrack = (event) => {
      // Ici, et nulle part ailleurs, on sait de quel pair vient la piste :
      // `pc` a été construit POUR `remoteId`. Le vumètre est donc rattaché au pair
      // et le flux part avec son identité (AD-17 / D3 et D4).
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

  /** Vide la file des candidats distants reçus avant la description distante. */
  async function flushPending(peer: Peer): Promise<void> {
    if (peer.pending.length === 0) return
    const queued = peer.pending.splice(0, peer.pending.length)
    for (const candidate of queued) {
      try {
        await peer.pc.addIceCandidate(candidate)
      } catch (error) {
        warn(`addIceCandidate en attente rejeté : ${describeError(error)}`)
      }
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
    const stream = await requestMicrophone()
    const first = stream.getAudioTracks()[0]
    if (first === undefined) {
      stream.getTracks().forEach((track) => track.stop())
      throw new Error('le flux micro ne contient aucune piste audio')
    }
    localStream = stream
    localTrack = first
    // Push-to-talk : micro fermé au repos, ouvert par setTransmitting(true).
    localTrack.enabled = false
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
    await peer.pc.addIceCandidate(candidate)
  }

  function setTransmitting(on: boolean): void {
    const track = localTrack
    if (track === null) {
      warn('setTransmitting ignoré : micro non démarré')
      return
    }
    track.enabled = on
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
    if (localStream !== null) {
      for (const track of localStream.getTracks()) track.stop()
    }
    localStream = null
    localTrack = null
    const context = audioContext
    audioContext = null
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
    level,
    stats,
    close,
  }
}
