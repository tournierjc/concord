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
 *   • munging SDP Opus : `maxaveragebitrate=32000;stereo=0;useinbandfec=1` ;
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

/**
 * Paramètres fmtp Opus imposés par SPEC-005 §2 :
 *   maxaveragebitrate=32000 → 32 kbps de moyenne ;
 *   stereo=0               → mono (le flux est mono de bout en bout) ;
 *   useinbandfec=1         → FEC dans la bande, seule protection contre la perte.
 */
export const OPUS_SDP_TARGET = 'maxaveragebitrate=32000;stereo=0;useinbandfec=1'

/** Paires clé/valeur appliquées (dans cet ordre) au fmtp Opus. */
const OPUS_FMTP_OVERRIDES: ReadonlyArray<readonly [string, string]> = [
  ['maxaveragebitrate', '32000'],
  ['stereo', '0'],
  ['useinbandfec', '1'],
]

/** Valeur par défaut injectée dans un fmtp Opus absent (minptime = 10 ms gardé). */
const OPUS_DEFAULT_MINPTIME = 'minptime=10'

/** Contraintes micro : mono, annulation d'écho, réduction de bruit, gain auto. */
export const MIC_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
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
