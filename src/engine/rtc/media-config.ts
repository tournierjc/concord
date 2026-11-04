/**
 * src/engine/rtc/media-config.ts — décisions média PURES du plan média (Carillon)
 *
 * SPEC-005 T14. Ce module contient tout ce qui est **décidable sans navigateur**
 * et qui doit donc être falsifiable par un test unitaire en Node :
 *
 *   • configuration ICE LAN-only (`lanOnlyConfiguration`) — `iceServers: []`
 *     TOUJOURS, même si l'appelant en fournit : l'étanchéité hors LAN n'est pas
 *     un filtre posé après coup, c'est une absence de configuration (SPEC-005 §1.3) ;
 *   • contraintes micro (mono, EC/NS/AGC) ;
 *   • munging SDP Opus : `maxaveragebitrate=32000;stereo=0;useinbandfec=1;usedtx=0` ;
 *   • agrégation des `getStats()` en 4 nombres (octets émis/reçus, pertes, RTT).
 *
 * Contraintes (SPEC-004 §3, module pur — vérifié par tests/engine-purity.test.ts) :
 *   - aucun import (ni node:*, ni paquet npm, ni module relatif) ;
 *   - aucun timer, aucune horloge, aucun `fetch`, aucun état global mutable ;
 *   - syntaxe TypeScript effaçable uniquement (pas d'enum, pas de namespace).
 *
 * Le binding WebRTC (`RTCPeerConnection`, `getUserMedia`, `AnalyserNode`) est
 * dans `media-plane.ts`, qui consomme ce module.
 */

/**
 * Débit Opus visé, en bits/s. 32 kbps mono suffit à la parole et laisse de la
 * marge sur un LAN encombré ; c'est la valeur imposée par SPEC-005 §2.
 */
export const OPUS_MAX_BITRATE = 32000

/** Fréquence Opus (SDP `opus/48000`). L'`AudioContext` de la page est calé dessus. */
export const OPUS_SAMPLE_RATE = 48000

/**
 * Paramètres fmtp Opus imposés par SPEC-005 §2 :
 *   maxaveragebitrate=32000 → 32 kbps de moyenne ;
 *   stereo=0               → mono (le flux est mono de bout en bout) ;
 *   useinbandfec=1         → FEC dans la bande, seule protection contre la perte.
 *   usedtx=0               → pas de DTX. Le silence continue d'envoyer des trames :
 *                            un trou puis une rafale fait partir le tampon de gigue
 *                            du récepteur à froid (retard constant de plusieurs
 *                            secondes dès la première syllabe, qui ne redescend pas).
 */
export const OPUS_SDP_TARGET = 'maxaveragebitrate=32000;stereo=0;useinbandfec=1;usedtx=0'

/** Paires clé/valeur appliquées (dans cet ordre) au fmtp Opus. */
const OPUS_FMTP_OVERRIDES: ReadonlyArray<readonly [string, string]> = [
  ['maxaveragebitrate', '32000'],
  ['stereo', '0'],
  ['useinbandfec', '1'],
  ['usedtx', '0'],
]

/**
 * Latence de capture demandée à `getUserMedia`, en secondes. `ideal`, jamais
 * `exact` : un micro qui refuse 10 ms doit quand même s'ouvrir. Sur Linux,
 * combiné à `PULSE_LATENCY_MSEC`, ça évite le tampon Pulse par défaut (~2 s).
 */
export const CAPTURE_LATENCY_IDEAL_SEC = 0.01

/**
 * Cible du tampon de gigue sur le LAN, en millisecondes. 50 ms tient dans
 * 40–60 : assez pour le Wi-Fi, très en dessous des 2–3 s observés quand le
 * récepteur Windows choisit sa cible tout seul au premier paquet.
 * `jitterBufferTarget` est en millisecondes ; `playoutDelayHint` est en secondes.
 */
export const LAN_JITTER_BUFFER_TARGET_MS = 50

export function lanReceiverLatencyConfig(): {
  readonly jitterBufferTargetMs: number
  readonly playoutDelayHintSec: number
} {
  return {
    jitterBufferTargetMs: LAN_JITTER_BUFFER_TARGET_MS,
    playoutDelayHintSec: LAN_JITTER_BUFFER_TARGET_MS / 1000,
  }
}

/**
 * Pose la cible basse sur un récepteur, dès `ontrack` (avant la première
 * syllabe). Un setter absent ou un hors-plage n'empêche pas l'autre.
 */
export function applyLanReceiverLatency(receiver: object): void {
  const config = lanReceiverLatencyConfig()
  try {
    Reflect.set(receiver, 'jitterBufferTarget', config.jitterBufferTargetMs)
  } catch {
    // Chromium sans la propriété, ou valeur refusée.
  }
  try {
    Reflect.set(receiver, 'playoutDelayHint', config.playoutDelayHintSec)
  } catch {
    // Idem.
  }
}

/** Valeur par défaut injectée dans un fmtp Opus absent (minptime = 10 ms gardé). */
const OPUS_DEFAULT_MINPTIME = 'minptime=10'

/**
 * Contraintes micro : mono, annulation d'écho, réduction de bruit. Pas d'AGC navigateur.
 *
 * `noiseSuppression: true` : la NS de Chromium est RNNoise. Elle était éteinte (2026-11-02)
 * parce que le push-to-talk coupait la PISTE DE CAPTURE et que RNNoise se calait sur le
 * silence. Le push-to-talk coupe désormais la piste ENVOYÉE, pas la capture : RNNoise
 * continue d'entendre le micro. Le réglage `audio.noiseSuppression` peut encore l'éteindre.
 *
 * `autoGainControl: false` : le gain d'entrée est un `GainNode` dans le graphe. Un AGC
 * navigateur en plus pompe contre lui et aplatit les filtres vocaux.
 */
export const MIC_CONSTRAINTS: MicrophoneConstraints = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: false,
}

/**
 * Contraintes micro réglables (SPEC-019, avenant 2026-11-02, arbitrage JC).
 *
 * Ce que l'amendement autorise, et rien de plus : la COQUILLE peut traduire ses réglages en
 * contraintes de capture — quel périphérique parle, si le navigateur annule l'écho et réduit le
 * bruit, et de combien le signal est monté. Ces valeurs ne voyagent jamais sur le réseau : ni
 * ICE, ni Opus, ni la topologie du maillage ne sont touchés. Le contrat média gelé de SPEC-005 §2
 * reste intact ; seul le prétraitement du micro devient réglable.
 *
 * `autoGainControl` n'est PAS exposé et vaut `false` : le réglage `audio.inputGain` est le
 * seul gain, appliqué dans le graphe. Un AGC navigateur pomperait par-dessus.
 * Le gain est borné 0..2 par le schéma de réglages ; la borne est re-vérifiée ICI, côté moteur,
 * parce qu'un appelant qui propagerait une valeur aberrante couperait le micro sans explication.
 */
export interface MicrophoneSettingsLike {
  /** Identifiant du périphérique d'entrée (`null`/absent = défaut du système). */
  readonly inputDeviceId?: string | null
  /** Réduction de bruit (RNNoise côté navigateur). */
  readonly noiseSuppression?: boolean
  /** Annulation d'écho. */
  readonly echoCancellation?: boolean
  /**
   * Gain d'entrée, 0..2 (1 = neutre). Une valeur hors bornes est refusée, pas arrondie.
   * Nom explicite (`inputGain`) : `MediaTrackConstraints` ne définit pas de `gain`, le
   * champ additionnel doit donc être porté par `MicrophoneConstraints` lui-même.
   */
  readonly inputGain?: number
}

/** Contraintes prêtes pour `getUserMedia({ audio: … })` (deviceId est une contrainte idéale). */
export interface MicrophoneConstraints {
  /** Une facette OBLIGATOIREMENT chaîne : jamais le `ConstrainDOMString` du DOM (tableau/objet). */
  deviceId?: string
  channelCount?: number
  echoCancellation?: boolean
  noiseSuppression?: boolean
  autoGainControl?: boolean
  /** Gain appliqué au signal capturé, 0..2 (seule extension hors type DOM, cf. `MicrophoneSettingsLike`). */
  gain?: number
}

/**
 * Fabrique les contraintes de capture depuis les réglages. PURE, aucune horloge, aucun I/O.
 *
 * Les valeurs absentes ou non valides retombent sur les défauts de `MIC_CONSTRAINTS` (mono,
 * EC et NS demandés, AGC coupé) : un réglage manquant ne peut pas éteindre l'annulation
 * d'écho par accident, pas plus qu'un `inputGain` non numérique ne peut passer — il est
 * ignoré, le gain reste neutre.
 */
export function buildMicrophoneConstraints(
  settings: MicrophoneSettingsLike | undefined,
): MicrophoneConstraints {
  const constraints: MicrophoneConstraints = {
    channelCount: 1,
    echoCancellation:
      typeof settings?.echoCancellation === 'boolean'
        ? settings.echoCancellation
        : MIC_CONSTRAINTS.echoCancellation === true,
    noiseSuppression:
      typeof settings?.noiseSuppression === 'boolean'
        ? settings.noiseSuppression
        : MIC_CONSTRAINTS.noiseSuppression === true,
    autoGainControl: MIC_CONSTRAINTS.autoGainControl === true,
  }
  const deviceId = settings?.inputDeviceId
  if (typeof deviceId === 'string' && deviceId.length > 0) constraints.deviceId = deviceId
  const gain = settings?.inputGain
  if (typeof gain === 'number' && Number.isFinite(gain) && gain >= 0 && gain <= 2) {
    constraints.gain = gain
  }
  return constraints
}

/**
 * Contrainte booléenne demandée en `ideal` : Chromium l'applique quand le périphérique
 * le peut, et `getUserMedia` ne meurt pas si le micro refuse un `exact`.
 */
export interface IdealBoolean {
  readonly ideal: boolean
}

/** Ce qui part vraiment à `getUserMedia({ audio })`. */
export interface MediaTrackRequest {
  readonly channelCount: { readonly ideal: number }
  readonly echoCancellation: IdealBoolean
  readonly noiseSuppression: IdealBoolean
  readonly autoGainControl: IdealBoolean
  /** Secondes. Idéal : un micro qui ne sait pas faire 10 ms s'ouvre quand même. */
  readonly latency: { readonly ideal: number }
  readonly deviceId?: string
}

/**
 * Traduit les facettes du moteur en contraintes DOM. EC / NS / AGC sont des `{ ideal }`
 * (un booléen nu est traité en `exact` par la spec et fait échouer des micros). Le
 * `deviceId` reste une chaîne : c'est le périphérique choisi, pas une préférence molle.
 */
export function toMediaTrackConstraints(constraints: MicrophoneConstraints): MediaTrackRequest {
  const request: MediaTrackRequest = {
    channelCount: { ideal: constraints.channelCount ?? 1 },
    echoCancellation: { ideal: constraints.echoCancellation === true },
    noiseSuppression: { ideal: constraints.noiseSuppression === true },
    autoGainControl: { ideal: constraints.autoGainControl === true },
    latency: { ideal: CAPTURE_LATENCY_IDEAL_SEC },
  }
  if (typeof constraints.deviceId === 'string' && constraints.deviceId.length > 0) {
    return { ...request, deviceId: constraints.deviceId }
  }
  return request
}

/**
 * EC / NS / AGC seuls, pour `track.applyConstraints` en vol (changer de périphérique
 * exige un nouveau `getUserMedia`, pas un `applyConstraints`).
 */
export function toProcessingConstraints(constraints: MicrophoneConstraints): {
  echoCancellation: IdealBoolean
  noiseSuppression: IdealBoolean
  autoGainControl: IdealBoolean
} {
  return {
    echoCancellation: { ideal: constraints.echoCancellation === true },
    noiseSuppression: { ideal: constraints.noiseSuppression === true },
    autoGainControl: { ideal: constraints.autoGainControl === true },
  }
}

/** Ce que `track.getSettings()` a réellement accordé (les absents ne sont pas des refus). */
export interface CaptureSettingsSnapshot {
  readonly echoCancellation?: boolean
  readonly noiseSuppression?: boolean
  readonly autoGainControl?: boolean
  readonly sampleRate?: number
  readonly channelCount?: number
}

/**
 * Écarts entre la demande et `getSettings()`. Un champ absent du cliché n'est pas un
 * écart (la doublure de test ne sait pas) : seul un booléen présent et contraire l'est.
 */
export function captureProcessingMismatches(
  requested: MicrophoneConstraints,
  applied: CaptureSettingsSnapshot,
): readonly string[] {
  const lines: string[] = []
  const wantEcho = requested.echoCancellation === true
  const wantNs = requested.noiseSuppression === true
  const wantAgc = requested.autoGainControl === true
  if (typeof applied.echoCancellation === 'boolean' && applied.echoCancellation !== wantEcho) {
    lines.push(
      `echoCancellation demandé=${String(wantEcho)} obtenu=${String(applied.echoCancellation)}`,
    )
  }
  if (typeof applied.noiseSuppression === 'boolean' && applied.noiseSuppression !== wantNs) {
    lines.push(
      `noiseSuppression demandé=${String(wantNs)} obtenu=${String(applied.noiseSuppression)}`,
    )
  }
  if (typeof applied.autoGainControl === 'boolean' && applied.autoGainControl !== wantAgc) {
    lines.push(
      `autoGainControl demandé=${String(wantAgc)} obtenu=${String(applied.autoGainControl)}`,
    )
  }
  return lines
}

/** Résumé numérique d'un `RTCStatsReport` (forme identique à `PeerStats`). */
export interface MediaStatsSummary {
  bytesSent: number
  bytesReceived: number
  packetsLost: number
  rttMs: number
}

const OPUS_RTPMAP = /^a=rtpmap:(\d+)\s+opus\/48000\/(?:1|2)\s*$/i
const FMTP_LINE = /^a=fmtp:(\d+)\s*(.*)$/

/** Retire un éventuel CR de fin de ligne (SDP WebRTC = CRLF). */
function stripCr(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

/** Type de charge (payload type) de la ligne `a=rtpmap:… opus/48000/x`, ou null. */
function findOpusPayloadType(lines: readonly string[]): string | null {
  for (const line of lines) {
    const match = OPUS_RTPMAP.exec(stripCr(line).trim())
    if (match !== null) {
      const payloadType = match[1]
      if (payloadType !== undefined) return payloadType
    }
  }
  return null
}

/**
 * Réécrit une liste de paramètres fmtp : conserve l'ordre et les paramètres
 * inconnus, retire les trois clés imposées, puis les ré-applique en fin de liste.
 * Idempotent.
 */
function rewriteFmtpParams(existing: string): string {
  const kept: string[] = []
  for (const token of existing.split(';')) {
    const trimmed = token.trim()
    if (trimmed.length === 0) continue
    const equals = trimmed.indexOf('=')
    const key = equals < 0 ? trimmed : trimmed.slice(0, equals)
    const lower = key.toLowerCase()
    const overridden = OPUS_FMTP_OVERRIDES.some(([name]) => name === lower)
    if (!overridden) kept.push(trimmed)
  }
  for (const [name, value] of OPUS_FMTP_OVERRIDES) {
    kept.push(`${name}=${value}`)
  }
  return kept.join(';')
}

/**
 * Force les paramètres Opus imposés dans un SDP (offre comme réponse).
 *
 * Ne touche à rien d'autre : si aucun `a=rtpmap:… opus/48000/x` n'est présent
 * (offre qui ne propose pas Opus), le SDP est rendu inchangé — un SDP réécrit à
 * l'aveugle casserait la négociation sans rien garantir sur le débit.
 */
export function withOpusSdpParams(sdp: string): string {
  if (typeof sdp !== 'string' || sdp.length === 0) return sdp
  const lines = sdp.split('\n')
  const payloadType = findOpusPayloadType(lines)
  if (payloadType === null) return sdp
  const eol = sdp.includes('\r\n') ? '\r' : ''

  let fmtpIndex = -1
  let rtpmapIndex = -1
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === undefined) continue
    const body = stripCr(line)
    const fmtp = FMTP_LINE.exec(body)
    if (fmtp !== null && fmtp[1] === payloadType) {
      fmtpIndex = index
      continue
    }
    if (rtpmapIndex < 0) {
      const rtpmap = OPUS_RTPMAP.exec(body.trim())
      if (rtpmap !== null && rtpmap[1] === payloadType) rtpmapIndex = index
    }
  }

  if (fmtpIndex >= 0) {
    const line = lines[fmtpIndex]
    if (line === undefined) return sdp
    const match = FMTP_LINE.exec(stripCr(line))
    if (match === null) return sdp
    const params = match[2]
    const rewritten = rewriteFmtpParams(params === undefined ? '' : params)
    lines[fmtpIndex] = `a=fmtp:${payloadType} ${rewritten}${eol}`
    return lines.join('\n')
  }

  if (rtpmapIndex < 0) return sdp
  lines.splice(rtpmapIndex + 1, 0, `a=fmtp:${payloadType} ${OPUS_DEFAULT_MINPTIME};${rewriteFmtpParams('')}${eol}`)
  return lines.join('\n')
}

/**
 * Configuration `RTCPeerConnection` réduite au LAN.
 *
 * `iceServers` est **toujours** vide, y compris si l'appelant en a fourni :
 * sans serveur STUN/TURN, Chromium ne collecte que des candidats `host`, qui
 * sont déjà locaux. `iceTransportPolicy` est forcé à `all` pour qu'aucun appel
 * ne puisse restreindre puis réintroduire du relay. Seuls les réglages sans
 * effet sur la portée réseau (bundle, mux RTCP, pool) sont transmis.
 */
export function lanOnlyConfiguration(input: RTCConfiguration | undefined): RTCConfiguration {
  const configuration: RTCConfiguration = {
    iceServers: [],
    iceTransportPolicy: 'all',
    iceCandidatePoolSize: 0,
  }
  if (input === undefined) return configuration
  if (input.bundlePolicy !== undefined) configuration.bundlePolicy = input.bundlePolicy
  if (input.rtcpMuxPolicy !== undefined) configuration.rtcpMuxPolicy = input.rtcpMuxPolicy
  const pool = input.iceCandidatePoolSize
  if (typeof pool === 'number' && Number.isFinite(pool) && pool > 0) {
    configuration.iceCandidatePoolSize = Math.floor(pool)
  }
  return configuration
}

/** Lit un nombre fini dans une entrée de stats opaque, sinon null. */
function readNumber(entry: unknown, key: string): number | null {
  if (typeof entry !== 'object' || entry === null) return null
  for (const [name, value] of Object.entries(entry)) {
    if (name === key && typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

/** Lit une chaîne dans une entrée de stats opaque, sinon null. */
function readString(entry: unknown, key: string): string | null {
  if (typeof entry !== 'object' || entry === null) return null
  for (const [name, value] of Object.entries(entry)) {
    if (name === key && typeof value === 'string') return value
  }
  return null
}

/**
 * Agrège les entrées d'un `RTCStatsReport` (déjà aplati en tableau) en 4 nombres.
 *
 *   bytesSent      ← somme des `outbound-rtp.bytesSent`
 *   bytesReceived  ← somme des `inbound-rtp.bytesReceived`
 *   packetsLost    ← somme des `inbound-rtp.packetsLost`
 *   rttMs          ← `candidate-pair` à l'état `succeeded` (`currentRoundTripTime`,
 *                    en secondes → ms arrondies), à défaut `remote-inbound-rtp.roundTripTime`
 *
 * Tout champ absent vaut 0 : le contrat refuse `undefined` pour que le renderer
 * n'ait jamais à décider quoi afficher.
 */
export function summarizeStats(entries: readonly unknown[]): MediaStatsSummary {
  let bytesSent = 0
  let bytesReceived = 0
  let packetsLost = 0
  let rttMs = 0
  for (const entry of entries) {
    const type = readString(entry, 'type')
    if (type === 'outbound-rtp') {
      const sent = readNumber(entry, 'bytesSent')
      if (sent !== null && sent > 0) bytesSent += sent
      continue
    }
    if (type === 'inbound-rtp') {
      const received = readNumber(entry, 'bytesReceived')
      if (received !== null && received > 0) bytesReceived += received
      const lost = readNumber(entry, 'packetsLost')
      if (lost !== null && lost > 0) packetsLost += lost
      continue
    }
    if (type === 'candidate-pair') {
      if (readString(entry, 'state') !== 'succeeded') continue
      const rtt = readNumber(entry, 'currentRoundTripTime')
      if (rtt !== null && rtt >= 0) rttMs = Math.round(rtt * 1000)
      continue
    }
    if (type === 'remote-inbound-rtp' && rttMs === 0) {
      const rtt = readNumber(entry, 'roundTripTime')
      if (rtt !== null && rtt >= 0) rttMs = Math.round(rtt * 1000)
    }
  }
  return { bytesSent, bytesReceived, packetsLost, rttMs }
}

/** Un côté RTP (entrant, sortant, ou retour distant) réduit aux champs de latence. */
export interface LatencySide {
  readonly jitterBufferDelaySec: number | null
  readonly jitterBufferEmittedCount: number | null
  readonly jitterBufferMs: number | null
  readonly packetsLost: number | null
  readonly roundTripTimeSec: number | null
  readonly totalAudioEnergy: number | null
  readonly totalSamplesDuration: number | null
  readonly bytesSent: number | null
  readonly bytesReceived: number | null
  readonly jitterSec: number | null
}

export interface PeerLatencyReading {
  readonly inbound: LatencySide
  readonly outbound: LatencySide
  readonly remoteInbound: LatencySide
  /** `candidate-pair` sélectionnée, `currentRoundTripTime`, en secondes. */
  readonly candidateRttSec: number | null
}

export interface LocalAudioClock {
  readonly sampleRate: number | null
  readonly baseLatencySec: number | null
  readonly outputLatencySec: number | null
  readonly state: string | null
  readonly captureSampleRate: number | null
  readonly captureChannels: number | null
}

export interface PeerAudioDebug {
  readonly peerId: string
  readonly jitterBufferTargetMs: number | null
  readonly playoutDelayHintSec: number | null
  readonly latency: PeerLatencyReading
}

export interface MediaLatencyReport {
  readonly clock: LocalAudioClock
  readonly sendOpen: boolean
  readonly peers: readonly PeerAudioDebug[]
}

/**
 * Délai moyen du tampon de gigue, en millisecondes.
 * La spec somme des secondes (`jitterBufferDelay`) sur des échantillons
 * (`jitterBufferEmittedCount`) : moyenne = delay / count.
 */
export function jitterBufferAverageMs(delaySec: number | null, emitted: number | null): number | null {
  if (delaySec === null || emitted === null || !(emitted > 0)) return null
  if (!Number.isFinite(delaySec) || delaySec < 0) return null
  const ms = (delaySec / emitted) * 1000
  if (!Number.isFinite(ms) || ms < 0) return null
  return Math.round(ms * 10) / 10
}

function emptyLatencySide(): LatencySide {
  return {
    jitterBufferDelaySec: null,
    jitterBufferEmittedCount: null,
    jitterBufferMs: null,
    packetsLost: null,
    roundTripTimeSec: null,
    totalAudioEnergy: null,
    totalSamplesDuration: null,
    bytesSent: null,
    bytesReceived: null,
    jitterSec: null,
  }
}

function isAudioStat(entry: unknown): boolean {
  const kind = readString(entry, 'kind')
  const mediaType = readString(entry, 'mediaType')
  if (kind === 'video' || mediaType === 'video') return false
  return true
}

function keepNumber(current: number | null, entry: unknown, key: string): number | null {
  if (current !== null) return current
  return readNumber(entry, key)
}

function readFlag(entry: unknown, key: string): boolean | null {
  if (typeof entry !== 'object' || entry === null) return null
  for (const [name, value] of Object.entries(entry)) {
    if (name === key && typeof value === 'boolean') return value
  }
  return null
}

/**
 * Champs de latence d'un `getStats()`, audio seulement. Le premier nombre
 * rencontré gagne : l'énergie sortante vient de `outbound-rtp` s'il la porte,
 * sinon de `media-source` (c'est là que Chromium la met le plus souvent).
 */
export function peerLatencyFromStats(entries: readonly unknown[]): PeerLatencyReading {
  let inbound = emptyLatencySide()
  let outbound = emptyLatencySide()
  let remoteInbound = emptyLatencySide()
  let candidateRttSec: number | null = null
  for (const entry of entries) {
    if (!isAudioStat(entry)) continue
    const type = readString(entry, 'type')
    if (type === 'inbound-rtp') {
      const delay = keepNumber(inbound.jitterBufferDelaySec, entry, 'jitterBufferDelay')
      const emitted = keepNumber(inbound.jitterBufferEmittedCount, entry, 'jitterBufferEmittedCount')
      inbound = {
        jitterBufferDelaySec: delay,
        jitterBufferEmittedCount: emitted,
        jitterBufferMs: jitterBufferAverageMs(delay, emitted),
        packetsLost: keepNumber(inbound.packetsLost, entry, 'packetsLost'),
        roundTripTimeSec: inbound.roundTripTimeSec,
        totalAudioEnergy: keepNumber(inbound.totalAudioEnergy, entry, 'totalAudioEnergy'),
        totalSamplesDuration: keepNumber(inbound.totalSamplesDuration, entry, 'totalSamplesDuration'),
        bytesSent: inbound.bytesSent,
        bytesReceived: keepNumber(inbound.bytesReceived, entry, 'bytesReceived'),
        jitterSec: keepNumber(inbound.jitterSec, entry, 'jitter'),
      }
      continue
    }
    if (type === 'outbound-rtp' || type === 'media-source') {
      outbound = {
        jitterBufferDelaySec: outbound.jitterBufferDelaySec,
        jitterBufferEmittedCount: outbound.jitterBufferEmittedCount,
        jitterBufferMs: outbound.jitterBufferMs,
        packetsLost: keepNumber(outbound.packetsLost, entry, 'packetsLost'),
        roundTripTimeSec: outbound.roundTripTimeSec,
        totalAudioEnergy: keepNumber(outbound.totalAudioEnergy, entry, 'totalAudioEnergy'),
        totalSamplesDuration: keepNumber(outbound.totalSamplesDuration, entry, 'totalSamplesDuration'),
        bytesSent: keepNumber(outbound.bytesSent, entry, 'bytesSent'),
        bytesReceived: outbound.bytesReceived,
        jitterSec: outbound.jitterSec,
      }
      continue
    }
    if (type === 'remote-inbound-rtp') {
      remoteInbound = {
        jitterBufferDelaySec: remoteInbound.jitterBufferDelaySec,
        jitterBufferEmittedCount: remoteInbound.jitterBufferEmittedCount,
        jitterBufferMs: remoteInbound.jitterBufferMs,
        packetsLost: keepNumber(remoteInbound.packetsLost, entry, 'packetsLost'),
        roundTripTimeSec: keepNumber(remoteInbound.roundTripTimeSec, entry, 'roundTripTime'),
        totalAudioEnergy: keepNumber(remoteInbound.totalAudioEnergy, entry, 'totalAudioEnergy'),
        totalSamplesDuration: remoteInbound.totalSamplesDuration,
        bytesSent: remoteInbound.bytesSent,
        bytesReceived: remoteInbound.bytesReceived,
        jitterSec: keepNumber(remoteInbound.jitterSec, entry, 'jitter'),
      }
      continue
    }
    if (type === 'candidate-pair') {
      if (readString(entry, 'state') !== 'succeeded') continue
      if (readFlag(entry, 'nominated') === false) continue
      const rtt = readNumber(entry, 'currentRoundTripTime')
      if (rtt !== null && rtt >= 0) candidateRttSec = rtt
    }
  }
  return { inbound, outbound, remoteInbound, candidateRttSec }
}
