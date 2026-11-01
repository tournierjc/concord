/**
 * src/engine/net/local-signaling.ts — serveur de signalisation LOCAL embarqué (Carillon)
 *
 * TÂCHE T6. Le cœur de la signalisation du maillage WebRTC pair-à-pair sur le
 * LAN : aucun compte, aucun service tiers, aucun identifiant persistant.
 *
 * Contraintes figées :
 *   - écoute exclusivement sur 127.0.0.1 / loopback / adresses du réseau local ;
 *     JAMAIS 0.0.0.0 ni « :: » sans filtrage d'hôte (cf. isAllowedListenHost) ;
 *   - port 47821, puis 47822..47830 en repli : 10 tentatives, on s'arrête au
 *     premier libre (cf. pickPort, fonction PURE) ;
 *   - une seule route HTTP : /signal (SIGNALING_HTTP_PATH) ;
 *   - aucune émission hors LAN : seuls les candidats ICE « typ host » d'adresse
 *     locale sont relayés, via le contrat gelé de src/engine/rtc/ice-filter.ts
 *     (isLanCandidate / filterLanCandidates) ; un candidat srflx / prflx / relay
 *     ou d'adresse publique est refusé avec le code `off-lan` ;
 *   - aucun identifiant persistant : les identifiants de pair (`p1`, `p2`, …) et
 *     les noms affichés sont tirés à la session et disparaissent avec elle ;
 *   - plafond 8 pairs par défaut (plafond du salon, cf. room-machine) : le 9e
 *     reçoit un refus explicite `refuse` avec code `room-full` et sa raison.
 *
 * Le module est découplé du réseau réel : il ne connaît que des « socket like »
 * (un objet qui sait `send(texte)` et éventuellement `close()`). Le transport
 * (ws local) et les tests branché sur un faux socket partagent donc le même code.
 *
 * Aucun timer, aucun fetch, aucun état global mutable : tout l'état vit dans la
 * fermeture retournée par createLocalSignaling().
 */

import {
  filterLanCandidates,
  isLanCandidate
} from '../rtc/ice-filter.ts'

import { isAvatarRef, normalizeIncomingAvatarRef } from '../../shell/avatar.ts'

/** Premier port essayé. */
export const SIGNALING_BASE_PORT = 47821

/**
 * Plafond du base64 dans une réponse `avatar_data` : une ligne JSON est bornée à 64 Ko
 * (`MAX_LINE_BYTES` chez le client qui la lit), l'enveloppe JSON fait une centaine d'octets.
 * Une réponse plus lourde est refusée AVANT écriture — le demandeur garde ses initiales, le
 * lien survit.
 */
export const MAX_AVATAR_BASE64_CHARS = 63 * 1024
/** Nombre de tentatives (47821 → 47830 inclus). */
export const SIGNALING_PORT_RANGE = 10
/** Unique route HTTP exposée par le serveur local. */
export const SIGNALING_HTTP_PATH = '/signal'
/** Plafond du salon (voix maillée en full-mesh : 8 pairs = 28 liens). */
export const DEFAULT_MAX_PARTICIPANTS = 8
/** Longueur maximale d'un nom affiché éphémère. */
export const MAX_DISPLAY_NAME_LENGTH = 32

/* ------------------------------------------------------------------ */
/* Choix de port — fonction PURE, testable séparément                  */
/* ------------------------------------------------------------------ */

/**
 * Choisit le premier port libre de la plage 47821..47830.
 *
 * @param attempts `attempts[i] === true` ⇔ le port (47821 + i) est occupé.
 *                 Les entrées au-delà de SIGNALING_PORT_RANGE sont ignorées.
 * @returns le numéro de port libre, ou null si les 10 tentatives ont échoué.
 *
 * Pure : aucune lecture d'horloge, aucun accès réseau, aucune mutation.
 */
export function pickPort(attempts: boolean[]): number | null {
  if (!Array.isArray(attempts)) return null
  const limit = Math.min(attempts.length, SIGNALING_PORT_RANGE)
  for (let index = 0; index < limit; index += 1) {
    if (attempts[index] !== true) return SIGNALING_BASE_PORT + index
  }
  return null
}

/**
 * Vrai si l'hôte d'écoute est acceptable : loopback ou adresse du réseau local.
 * Refuse explicitement 0.0.0.0, « :: », « * » et toute adresse publique.
 *
 * Réutilise le contrat gelé d'ice-filter en fabriquant une ligne de candidat
 * hôte : une seule source de vérité pour « qu'est-ce qu'une adresse LAN ».
 */
export function isAllowedListenHost(host: string): boolean {
  if (typeof host !== 'string') return false
  const value = host.trim().toLowerCase()
  if (value.length === 0) return false
  const bare = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value
  if (bare === 'localhost') return true
  if (bare === '0.0.0.0' || bare === '::' || bare === '*' || bare === 'any') return false
  return isLanCandidate(`candidate:1 1 udp 2122260223 ${bare} 9 typ host`)
}

/* ------------------------------------------------------------------ */
/* Types de messages — union discriminée stricte                       */
/* ------------------------------------------------------------------ */

/** Codes de refus explicites. */
export const REFUSE_CODES = [
  'room-full',
  'not-joined',
  'unknown-peer',
  'invalid-message',
  'off-lan',
  'closed'
] as const

export type RefuseCode = (typeof REFUSE_CODES)[number]

/** Vrai si la chaîne est un code de refus connu : le type seul disparaît au build. */
export function isRefuseCode(value: unknown): value is RefuseCode {
  return typeof value === 'string' && (REFUSE_CODES as readonly string[]).includes(value)
}

/** Les 8 types de messages du protocole. */
export const SIGNALING_MESSAGE_TYPES = [
  'hello',
  'join',
  'leave',
  'offer',
  'answer',
  'ice',
  'refuse',
  'bye'
] as const

export type SignalingMessageType = (typeof SIGNALING_MESSAGE_TYPES)[number]

/** Vue publique d'un pair (nom éphémère, aucun identifiant persistant). */
export interface PeerSummary {
  peerId: string
  name: string
  /**
   * Empreinte d'avatar (SPEC-002 amendement 2026-10-31) : un id de galerie (`"fox"`) ou les 16
   * hexadécimaux d'une image locale. JAMAIS l'image — elle est trop lourde pour une ligne JSON
   * bornée à 64 Ko ; un pair qui ne la connaît pas la réclame (`avatar_get`). Facultatif : une
   * ancienne version du pair n'en envoie pas, l'affichage retombe sur les initiales.
   */
  avatarRef?: string
}

/* --- Sens client → serveur ---------------------------------------- */

export interface JoinRequest {
  type: 'join'
  name: string
  /**
   * Empreinte d'avatar du nouvel arrivant (voir `PeerSummary.avatarRef`). Facultatif, et validé
   * à l'entrée : toute autre forme est traitée comme « rien d'annoncé », jamais stockée telle quelle.
   */
  avatarRef?: string
}

export interface LeaveRequest {
  type: 'leave'
  peerId?: string
}

export interface OfferRequest {
  type: 'offer'
  to: string
  sdp: string
}

export interface AnswerRequest {
  type: 'answer'
  to: string
  sdp: string
}

export interface IceRequest {
  type: 'ice'
  to: string
  candidate: string
}

/**
 * Demande d'image d'avatar (SPEC-002, amendement 2026-10-31) : un pair rencontre une empreinte
 * qu'il n'a jamais vue et réclame le binaire à qui l'a annoncée. La réponse (`avatar_data`) est
 * un serveur→client, émise par `answerAvatarGet` — ce type-ci n'est jamais accepté en entrée.
 */
export interface AvatarGetRequest {
  type: 'avatar_get'
  to: string
  avatarRef: string
}

/**
 * Réponse à `avatar_get` (SPEC-002, amendement 2026-10-31) : le binaire PNG d'un avatar stocké,
 * en base64 (le fil ne transporte que des lignes JSON bornées). Émise par l'appelant qui possède
 * l'image (le main, via `answerAvatarGet`) — jamais acceptée en entrée. `null` = l'empreinte est
 * inconnue ici : le demandeur retombe sur ses initiales, sans insister.
 */
export interface AvatarDataMessage {
  type: 'avatar_data'
  from: string
  to: string
  avatarRef: string
  pngBase64: string | null
}

/** Messages qu'un client a le droit d'émettre. */
export type RelayableMessage = OfferRequest | AnswerRequest | IceRequest
export type ClientMessage = JoinRequest | LeaveRequest | RelayableMessage | AvatarGetRequest

/* --- Sens serveur → client --------------------------------------- */

/** Accusé d'entrée dans le salon (le « hello » du serveur). */
export interface HelloMessage {
  type: 'hello'
  peerId: string
  name: string
  maxParticipants: number
  peers: PeerSummary[]
}

/** Diffusion : un pair vient d'entrer. */
export interface PeerJoinedMessage {
  type: 'join'
  peer: PeerSummary
}

/** Diffusion : un pair est sorti. */
export interface PeerLeftMessage {
  type: 'leave'
  peerId: string
}

export interface RelayedOffer {
  type: 'offer'
  from: string
  to: string
  sdp: string
}

export interface RelayedAnswer {
  type: 'answer'
  from: string
  to: string
  sdp: string
}

export interface RelayedIce {
  type: 'ice'
  from: string
  to: string
  candidate: string
}

/** Refus explicite : toujours un code ET une raison lisible. */
export interface RefuseMessage {
  type: 'refuse'
  code: RefuseCode
  reason: string
}

export interface ByeMessage {
  type: 'bye'
  reason: string
}

export type ServerMessage =
  | HelloMessage
  | PeerJoinedMessage
  | PeerLeftMessage
  | RelayedOffer
  | RelayedAnswer
  | RelayedIce
  | AvatarDataMessage
  | RefuseMessage
  | ByeMessage

export type SignalingMessage = ClientMessage | ServerMessage

/* ------------------------------------------------------------------ */
/* Contrat d'API                                                       */
/* ------------------------------------------------------------------ */

/** Objet « socket » minimal : un envoi de texte, une fermeture optionnelle. */
export interface SocketLike {
  send(data: string): void
  close?(): void
  readyState?: number
}

export interface SignalingFailure {
  ok: false
  code: RefuseCode
  reason: string
}

export interface JoinSuccess {
  ok: true
  peerId: string
  name: string
}

export type JoinResult = JoinSuccess | SignalingFailure

export interface RelaySuccess {
  ok: true
  delivered: string[]
}

export type RelayResult = RelaySuccess | SignalingFailure

/** Issue d'un « leave » réussi : le pair a quitté le salon de lui-même. */
export interface LeaveSuccess {
  readonly ok: true
}

export type LeaveResult = LeaveSuccess | SignalingFailure

/**
 * Issue acceptée de `receive()` : l'union EXACTE des trois formes que
 * l'implémentation rend réellement, sans champ inventé ni champ effacé —
 *   - `JoinSuccess`  pour un message « join »  → `peerId`, `name` ;
 *   - `RelaySuccess` pour « offer »/« answer »/« ice » relayé → `delivered` ;
 *   - `LeaveSuccess` pour un message « leave » → `ok` seul.
 * Ce qui n'est pas dans l'union n'est pas rendu, et ce qui est rendu y est :
 * l'appelant discrimine par `result.ok` puis, pour le détail, par la présence
 * du champ (`'peerId' in result`, `'delivered' in result`) — sans cast.
 */
/** Issue d'un « avatar_get » accepté : la demande est remontée à l'appelant qui tient les images. */
export interface AvatarGetSuccess {
  readonly ok: true
  /** Le pair qui demande. */
  readonly from: string
  /** Le pair qui doit répondre (celui qui a annoncé cette empreinte). */
  readonly to: string
  readonly avatarRef: string
}

export type ReceiveAccepted = JoinSuccess | RelaySuccess | LeaveSuccess | AvatarGetSuccess

export type ReceiveResult = ReceiveAccepted | SignalingFailure

/** Une connexion ouverte, vue depuis l'extérieur. */
export interface SignalingConnection {
  readonly id: string
  readonly peerId: string | null
  readonly closed: boolean
  send(message: ServerMessage): void
  /** Rejoue une entrée (texte JSON ou objet) comme le ferait le transport. */
  receive(input: unknown): ReceiveResult
  close(reason?: string): void
}

export type SignalingEventKind =
  | 'port-selected'
  | 'connected'
  | 'joined'
  | 'left'
  | 'relayed'
  | 'refused'
  | 'closed'
  /**
   * Un pair a demandé une image d'avatar (SPEC-002, amendement 2026-10-31). La demande est
   * remontée à l'appelant — c'est lui qui tient les images, jamais le serveur — et celui-ci
   * répond lui-même sur la connexion du demandeur.
   */
  | 'avatar-get'

export interface SignalingEvent {
  kind: SignalingEventKind
  at: number
  peerId?: string
  peerName?: string
  detail?: string
  /** Présent sur `avatar-get` uniquement : la demande validée par le parseur. */
  avatarGet?: AvatarGetSuccess
}

export interface CreateLocalSignalingOptions {
  /** Port imposé ; sinon 47821 puis repli (pickPort). */
  port?: number
  /** Plafond de pairs ; défaut DEFAULT_MAX_PARTICIPANTS (8). */
  maxParticipants?: number
  /**
   * Horloge injectable, OBLIGATOIRE. SPEC-004 interdit toute lecture d'horloge
   * système dans `src/engine` : aucun repli n'est fourni, c'est l'appelant qui
   * décide de l'horloge. Les tests injectent une horloge déterministe et
   * incrémentale (1000, 1001, …).
   */
  now: () => number
  /** Observabilité : aucun effet sur la décision. */
  onEvent?: (event: SignalingEvent) => void
}

export interface JoinPeer {
  connection: SignalingConnection
  name?: string
  /** Empreinte d'avatar de l'arrivant (voir `PeerSummary.avatarRef`). `null`/absent = rien d'annoncé. */
  avatarRef?: string | null
}

export interface LocalSignaling {
  readonly port: number
  readonly maxParticipants: number
  handleConnection(socket: SocketLike): SignalingConnection
  join(peer: JoinPeer): JoinResult
  leave(peerId: string): void
  relay(from: string, message: ClientMessage): RelayResult
  /**
   * Répond à une demande `avatar_get` (SPEC-002, amendement 2026-10-31). L'appelant (le main) a
   * lu l'image ; le serveur l'écrit sur la connexion du demandeur. `pngBase64 === null` est la
   * réponse honnête « je ne connais pas cette empreinte ». Écriture bornée : si la ligne dépassait
   * 64 Ko, rien ne sort et la demande est refusée (`invalid-message`) — jamais le lien ne crève.
   */
  answerAvatarGet(request: { from: string; to: string; avatarRef: string }, pngBase64: string | null): RelayResult
  participants(): PeerSummary[]
  close(): void
}

/* ------------------------------------------------------------------ */
/* Analyse stricte des messages entrants                               */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Analyse et valide un message client. Retourne null si le message n'est pas
 * strictement conforme (type inconnu, champ manquant, mauvais type).
 */
export function parseClientMessage(input: unknown): ClientMessage | null {
  if (typeof input === 'string') {
    let decoded: unknown
    try {
      decoded = JSON.parse(input)
    } catch {
      return null
    }
    return parseClientMessage(decoded)
  }
  if (!isRecord(input)) return null

  const type = input.type
  if (typeof type !== 'string') return null

  if (type === 'join') {
    const name = input.name
    if (name !== undefined && typeof name !== 'string') return null
    // L'empreinte d'avatar est conservée telle quelle ICI (le parseur ne juge pas le contenu) ;
    // c'est `joinFor` qui la normalise avant tout stockage. Une forme non-contractuelle reste un
    // `join` valide — elle devient simplement « rien d'annoncé ».
    const rawAvatarRef = input.avatarRef
    if (rawAvatarRef !== undefined && typeof rawAvatarRef !== 'string') return null
    const parsed = { type: 'join' as const, name: typeof name === 'string' ? name : '' }
    const avatarRef = typeof rawAvatarRef === 'string' ? rawAvatarRef : undefined
    return avatarRef === undefined ? parsed : { ...parsed, avatarRef }
  }

  if (type === 'leave') {
    const peerId = input.peerId
    if (peerId !== undefined && typeof peerId !== 'string') return null
    return peerId === undefined ? { type: 'leave' } : { type: 'leave', peerId }
  }

  if (type === 'avatar_get') {
    // Un pair réclame une image d'avatar. Forme stricte : destinataire non vide + empreinte sous
    // sa forme exacte. `avatar_data` n'est PAS ici : c'est une réponse serveur→client, un client
    // qui l'émettrait est hors contrat (et serait refusé comme type inconnu).
    if (!isNonEmptyString(input.to)) return null
    if (!isAvatarRef(input.avatarRef)) return null
    return { type: 'avatar_get', to: input.to.trim(), avatarRef: input.avatarRef }
  }

  if (type === 'offer' || type === 'answer') {
    if (!isNonEmptyString(input.to)) return null
    if (typeof input.sdp !== 'string' || input.sdp.length === 0) return null
    const to = input.to.trim()
    const sdp = input.sdp
    return type === 'offer' ? { type: 'offer', to, sdp } : { type: 'answer', to, sdp }
  }

  if (type === 'ice') {
    if (!isNonEmptyString(input.to)) return null
    if (!isNonEmptyString(input.candidate)) return null
    return { type: 'ice', to: input.to.trim(), candidate: input.candidate }
  }

  return null
}

/* ------------------------------------------------------------------ */
/* Fabrique du serveur local                                           */
/* ------------------------------------------------------------------ */

interface PeerState {
  peerId: string
  name: string
  /** Empreinte d'avatar reçue au `join` (voir `PeerSummary.avatarRef`). `null` = rien d'annoncé. */
  avatarRef: string | null
  connectionId: string
}

interface ConnectionState {
  id: string
  socket: SocketLike
  peerId: string | null
  closed: boolean
}

function normalizeName(rawName: string | undefined, index: number): string {
  const trimmed = typeof rawName === 'string' ? rawName.trim() : ''
  const base = trimmed.length > 0 ? trimmed : `Invité ${index}`
  return base.slice(0, MAX_DISPLAY_NAME_LENGTH)
}

function resolvePort(port: number | undefined): number {
  if (port === undefined) {
    const selected = pickPort(new Array<boolean>(SIGNALING_PORT_RANGE).fill(false))
    // La plage entièrement libre retourne toujours 47821 ; null est impossible.
    return selected === null ? SIGNALING_BASE_PORT : selected
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RangeError(`createLocalSignaling: port invalide (${String(port)})`)
  }
  return port
}

function resolveMaxParticipants(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_PARTICIPANTS
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`createLocalSignaling: maxParticipants invalide (${String(value)})`)
  }
  return value
}

/**
 * Crée le serveur de signalisation local. Aucun écouteur réseau n'est ouvert
 * ici : le transport appelle handleConnection() avec son socket.
 */
export function createLocalSignaling(options: CreateLocalSignalingOptions): LocalSignaling {
  const now = options.now
  const onEvent = options.onEvent
  const maxParticipants = resolveMaxParticipants(options.maxParticipants)
  const port = resolvePort(options.port)

  const peers = new Map<string, PeerState>()
  const connections = new Map<string, ConnectionState>()
  let peerCounter = 0
  let connectionCounter = 0
  let closed = false

  function emit(event: SignalingEvent): void {
    if (onEvent === undefined) return
    try {
      onEvent(event)
    } catch {
      // L'observabilité ne doit jamais casser la signalisation.
    }
  }

  /** Écrit sur le socket ; nudit l'état de la connexion uniquement. */
  function writeMessage(state: ConnectionState, message: ServerMessage): boolean {
    if (state.closed) return false
    try {
      state.socket.send(JSON.stringify(message))
      return true
    } catch {
      return false
    }
  }

  function connectionOf(peerId: string): ConnectionState | null {
    const peer = peers.get(peerId)
    if (peer === undefined) return null
    const state = connections.get(peer.connectionId)
    if (state === undefined || state.closed) return null
    return state
  }

  function summariesExcept(peerId: string | null): PeerSummary[] {
    const list: PeerSummary[] = []
    for (const peer of peers.values()) {
      if (peer.peerId === peerId) continue
      // `avatarRef` n'apparaît que s'il existe : un pair sans avatar rend exactement
      // `{ peerId, name }`, pas une clé à `undefined` (le contrat du fil est une forme exacte).
      list.push(
        peer.avatarRef === null || peer.avatarRef === undefined
          ? { peerId: peer.peerId, name: peer.name }
          : { peerId: peer.peerId, name: peer.name, avatarRef: peer.avatarRef }
      )
    }
    return list
  }

  /** Refus : renvoyé à l'appelant ET poussé sur le socket du fautif s'il existe. */
  function fail(
    state: ConnectionState | null,
    code: RefuseCode,
    reason: string
  ): SignalingFailure {
    if (state !== null) {
      writeMessage(state, { type: 'refuse', code, reason })
      emit({
        kind: 'refused',
        at: now(),
        peerId: state.peerId ?? undefined,
        detail: `${code}: ${reason}`
      })
    }
    return { ok: false, code, reason }
  }

  function joinFor(
    state: ConnectionState,
    rawName: string | undefined,
    rawAvatarRef?: string | null,
  ): JoinResult {
    if (closed) return fail(state, 'closed', 'serveur de signalisation local fermé')
    if (state.closed) return fail(state, 'closed', 'connexion fermée')

    // Déjà membre : idempotent, pas de doublon.
    if (state.peerId !== null) {
      const existing = peers.get(state.peerId)
      return { ok: true, peerId: state.peerId, name: existing === undefined ? '' : existing.name }
    }

    if (peers.size >= maxParticipants) {
      return fail(
        state,
        'room-full',
        `salon complet : ${peers.size}/${maxParticipants} pairs — le plafond de ${maxParticipants} pairs est atteint`
      )
    }

    peerCounter += 1
    // Identifiant éphémère : tiré à la session, jamais persisté.
    const peerId = `p${peerCounter}`
    const name = normalizeName(rawName, peerCounter)
    // L'empreinte est validée, jamais stockée telle quelle : une forme inconnue devient
    // « rien d'annoncé » (le pair affichera les initiales) plutôt qu'une chaîne arbitraire.
    const avatarRef = normalizeIncomingAvatarRef(rawAvatarRef)
    state.peerId = peerId
    peers.set(peerId, { peerId, name, avatarRef, connectionId: state.id })

    writeMessage(state, {
      type: 'hello',
      peerId,
      name,
      maxParticipants,
      peers: summariesExcept(peerId)
    })

    const announcement: PeerJoinedMessage = { type: 'join', peer: { peerId, name, avatarRef: avatarRef ?? undefined } }
    for (const other of peers.values()) {
      if (other.peerId === peerId) continue
      const target = connections.get(other.connectionId)
      if (target === undefined) continue
      writeMessage(target, announcement)
    }

    emit({ kind: 'joined', at: now(), peerId, peerName: name })
    return { ok: true, peerId, name }
  }

  function leave(peerId: string): void {
    const peer = peers.get(peerId)
    if (peer === undefined) return
    peers.delete(peerId)

    const state = connections.get(peer.connectionId)
    if (state !== undefined) state.peerId = null

    const departure: PeerLeftMessage = { type: 'leave', peerId }
    for (const other of peers.values()) {
      const target = connections.get(other.connectionId)
      if (target === undefined) continue
      writeMessage(target, departure)
    }

    emit({ kind: 'left', at: now(), peerId, peerName: peer.name })
  }

  function relay(from: string, message: ClientMessage): RelayResult {
    if (closed) return { ok: false, code: 'closed', reason: 'serveur de signalisation local fermé' }

    const sender = peers.get(from)
    if (sender === undefined) {
      return {
        ok: false,
        code: 'not-joined',
        reason: `pair ${from} absent du salon : rien n'est relayé`
      }
    }
    const senderState = connections.get(sender.connectionId) ?? null

    if (!isRecord(message)) {
      return fail(senderState, 'invalid-message', 'message de signalisation illisible')
    }
    if (message.type !== 'offer' && message.type !== 'answer' && message.type !== 'ice') {
      return fail(
        senderState,
        'invalid-message',
        `type ${String(message.type)} non relayable : seuls offer, answer et ice le sont`
      )
    }
    const kind = message.type
    if (!isNonEmptyString(message.to)) {
      return fail(senderState, 'invalid-message', 'destinataire (champ « to ») manquant')
    }

    const to = message.to.trim()
    if (to === from) {
      return fail(senderState, 'invalid-message', 'un pair ne peut pas se relayer un message à lui-même')
    }
    if (!peers.has(to)) {
      // Aucun destinataire dans le salon : rien ne sort, rien n'est diffusé.
      return fail(senderState, 'unknown-peer', `destinataire ${to} absent du salon`)
    }

    let relayed: RelayedOffer | RelayedAnswer | RelayedIce
    if (kind === 'ice') {
      if (!isNonEmptyString(message.candidate)) {
        return fail(senderState, 'invalid-message', 'candidat ICE vide')
      }
      // Contrat gelé : seuls les hôtes du LAN sortent du serveur.
      const lan = filterLanCandidates([message.candidate])
      const candidate = lan[0]
      if (candidate === undefined) {
        return fail(
          senderState,
          'off-lan',
          'candidat ICE refusé : seuls les hôtes (typ host) du réseau local sont relayés'
        )
      }
      relayed = { type: 'ice', from, to, candidate }
    } else if (kind === 'offer') {
      if (typeof message.sdp !== 'string' || message.sdp.length === 0) {
        return fail(senderState, 'invalid-message', 'offre SDP vide')
      }
      relayed = { type: 'offer', from, to, sdp: message.sdp }
    } else {
      if (typeof message.sdp !== 'string' || message.sdp.length === 0) {
        return fail(senderState, 'invalid-message', 'réponse SDP vide')
      }
      relayed = { type: 'answer', from, to, sdp: message.sdp }
    }

    const target = connectionOf(to)
    if (target === null) {
      return fail(senderState, 'closed', `le pair ${to} n'a plus de connexion ouverte`)
    }
    if (!writeMessage(target, relayed)) {
      return fail(senderState, 'closed', `écriture impossible vers ${to}`)
    }

    emit({ kind: 'relayed', at: now(), peerId: from, detail: `${kind} → ${to}` })
    return { ok: true, delivered: [to] }
  }

  function receive(state: ConnectionState, input: unknown): ReceiveResult {
    if (closed) return fail(state, 'closed', 'serveur de signalisation local fermé')
    if (state.closed) return fail(state, 'closed', 'connexion fermée')

    const message = parseClientMessage(input)
    if (message === null) {
      return fail(state, 'invalid-message', 'message de signalisation invalide ou non conforme')
    }

    if (message.type === 'join') return joinFor(state, message.name, message.avatarRef)

    if (state.peerId === null) {
      return fail(state, 'not-joined', 'entrez d’abord dans le salon avec un message « join »')
    }

    if (message.type === 'leave') {
      const target = message.peerId ?? state.peerId
      if (target !== state.peerId) {
        return fail(state, 'invalid-message', 'un pair ne peut que se retirer lui-même')
      }
      leave(target)
      return { ok: true }
    }

    if (message.type === 'avatar_get') {
      // Le serveur ne tient AUCUNE image : il valide la forme, vérifie que le demandeur est bien
      // dans le salon, et remonte la demande à l'appelant (le main), qui répondra lui-même.
      if (message.to === state.peerId) {
        return fail(state, 'invalid-message', 'un pair ne peut pas se demander son propre avatar')
      }
      if (!peers.has(message.to)) {
        return fail(state, 'unknown-peer', `destinataire ${message.to} absent du salon`)
      }
      const success: AvatarGetSuccess = { ok: true, from: state.peerId, to: message.to, avatarRef: message.avatarRef }
      emit({ kind: 'avatar-get', at: now(), peerId: state.peerId, avatarGet: success })
      return success
    }

    return relay(state.peerId, message)
  }

  function answerAvatarGet(
    request: { from: string; to: string; avatarRef: string },
    pngBase64: string | null
  ): RelayResult {
    // La réponse ne suit PAS le chemin `relay` : elle part du SERVEUR (qui tient la vérité du
    // salon) vers le demandeur, et elle est la seule charge utile binaire du protocole.
    if (closed) return { ok: false, code: 'closed', reason: 'serveur de signalisation local fermé' }
    if (!isAvatarRef(request.avatarRef)) {
      return { ok: false, code: 'invalid-message', reason: 'empreinte d’avatar hors contrat' }
    }
    const target = connectionOf(request.from)
    if (target === null) {
      return { ok: false, code: 'closed', reason: `le demandeur ${request.from} n'a plus de connexion ouverte` }
    }
    // `from` est LE pair qui répond (nous, côté main) ; il doit être dans le salon, sinon la
    // réponse n'a pas de sens. `to` est la demande d'origine — vérifiée à la réception.
    if (!peers.has(request.to)) {
      return { ok: false, code: 'unknown-peer', reason: `destinataire ${request.to} absent du salon` }
    }
    if (pngBase64 !== null && pngBase64.length > MAX_AVATAR_BASE64_CHARS) {
      return fail(target, 'invalid-message', 'image d’avatar trop lourde pour une ligne de signalisation')
    }
    const message: AvatarDataMessage = {
      type: 'avatar_data',
      from: request.to,
      to: request.from,
      avatarRef: request.avatarRef,
      pngBase64
    }
    if (!writeMessage(target, message)) {
      return fail(target, 'closed', 'écriture impossible vers le demandeur')
    }
    emit({ kind: 'relayed', at: now(), peerId: request.to, detail: `avatar_data → ${request.from}` })
    return { ok: true, delivered: [request.from] }
  }

  function closeConnection(state: ConnectionState, reason: string): void {
    if (state.closed) return
    writeMessage(state, { type: 'bye', reason })
    if (state.peerId !== null) leave(state.peerId)
    state.closed = true
    connections.delete(state.id)
    try {
      if (typeof state.socket.close === 'function') state.socket.close()
    } catch {
      // Fermeture best-effort : l'état serveur est déjà propre.
    }
  }

  function handleConnection(socket: SocketLike): SignalingConnection {
    if (socket === null || socket === undefined || typeof socket.send !== 'function') {
      throw new TypeError('handleConnection: socketLike avec send() requis')
    }

    connectionCounter += 1
    const state: ConnectionState = {
      id: `c${connectionCounter}`,
      socket,
      peerId: null,
      closed: closed
    }
    connections.set(state.id, state)
    emit({ kind: 'connected', at: now(), detail: state.id })

    const connection: SignalingConnection = {
      id: state.id,
      get peerId(): string | null {
        return state.peerId
      },
      get closed(): boolean {
        return state.closed || closed
      },
      send(message: ServerMessage): void {
        writeMessage(state, message)
      },
      receive(input: unknown): ReceiveResult {
        return receive(state, input)
      },
      close(reason?: string): void {
        closeConnection(state, reason ?? 'connexion fermée')
      }
    }

    return connection
  }

  function join(peer: JoinPeer): JoinResult {
    const state = peer === null || peer === undefined ? undefined : connections.get(peer.connection.id)
    if (state === undefined) {
      return {
        ok: false,
        code: 'invalid-message',
        reason: 'connexion inconnue de ce serveur (utilisez handleConnection)'
      }
    }
    return joinFor(state, peer.name, peer.avatarRef)
  }

  function close(): void {
    if (closed) return
    closed = true
    const members = Array.from(peers.values())
    for (const peer of members) {
      const state = connections.get(peer.connectionId)
      if (state === undefined) continue
      writeMessage(state, { type: 'bye', reason: 'serveur de signalisation local fermé' })
      state.peerId = null
      state.closed = true
      try {
        if (typeof state.socket.close === 'function') state.socket.close()
      } catch {
        // best-effort
      }
    }
    for (const state of connections.values()) state.closed = true
    peers.clear()
    connections.clear()
    emit({ kind: 'closed', at: now(), detail: `port ${port}` })
  }

  emit({ kind: 'port-selected', at: now(), detail: `port ${port}` })

  return {
    port,
    maxParticipants,
    handleConnection,
    join,
    leave,
    relay,
    answerAvatarGet,
    participants(): PeerSummary[] {
      return summariesExcept(null)
    },
    close
  }
}
