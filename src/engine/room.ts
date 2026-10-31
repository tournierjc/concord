/**
 * src/engine/room.ts — Carillon
 *
 * Machine d'état du salon, **pure** : on lui donne un état et un événement, elle
 * rend un nouvel état, les effets à exécuter par la couche réseau et un journal
 * ordonné. Pas de socket, pas de timer, pas de DOM.
 *
 * Cycle de vie (contrat T2) :
 *
 *     idle ──join──▶ joining ──transport-connected──▶ connected
 *                       │                                │  ▲
 *                       │                       transport-lost│transport-restored
 *                       │                                ▼  │
 *                       │                          reconnecting
 *                       └──────────── leave ────────────────▶ left
 *
 * Toute transition non listée est **refusée** : `{ ok: false, reason }`, l'état
 * reste inchangé, et le refus est **journalisé** — un refus silencieux est un
 * bug qu'on ne peut pas diagnostiquer sur le terrain. Aucune fonction de ce
 * module ne lève : les entrées les plus absurdes (événement inconnu, identifiant
 * vide, tableau de participants vide) rendent un refus motivé.
 *
 * Plafond de maillage : **8 participants** (arbitrage desk-lead, SPEC-001 A2).
 * Un maillage complet ouvre n·(n−1)/2 liens, soit 28 paires à 8 et 7 pistes Opus
 * simultanées à décoder par poste : au-delà, un portable du LAN sature en CPU
 * avant le réseau. Le 9ᵉ n'est pas ignoré : il reçoit un refus explicite
 * (`room-full`) et un effet `reject-peer`, sinon il attendrait une réponse qui
 * n'arrive jamais.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constantes (T2 / SPEC-003)
// ─────────────────────────────────────────────────────────────────────────────

/** Plafond du maillage, soi-même compris (arbitrage desk-lead : 8, SPEC-001 A2). */
export const MAX_MESH_PARTICIPANTS = 8
/** Liens d'un maillage complet à 8 : 8 × 7 / 2. */
export const MESH_LINKS_MAX = (MAX_MESH_PARTICIPANTS * (MAX_MESH_PARTICIPANTS - 1)) / 2

export type RoomState = 'idle' | 'joining' | 'connected' | 'reconnecting' | 'left'

export type RoomEventType =
  | 'join'
  | 'transport-connected'
  | 'transport-lost'
  | 'transport-restored'
  | 'peer-joined'
  | 'peer-left'
  | 'leave'

export const ROOM_EVENT_TYPES: ReadonlyArray<RoomEventType> = [
  'join',
  'transport-connected',
  'transport-lost',
  'transport-restored',
  'peer-joined',
  'peer-left',
  'leave',
]

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RoomEvent {
  readonly type: RoomEventType
  readonly peerId?: string
  readonly displayName?: string
}

export type RoomResultCode =
  | 'accepted'
  | 'illegal-transition'
  | 'room-full'
  | 'room-left'
  | 'unknown-event'
  | 'duplicate-peer'
  | 'self'
  | 'invalid-peer'
  | 'peer-not-found'

export interface Participant {
  readonly peerId: string
  readonly displayName: string
  readonly self: boolean
  /** `seq` du journal au moment de l'admission : sert d'ordre d'affichage. */
  readonly admittedAtSeq: number
}

export interface JournalEntry {
  /** Numéro d'ordre strictement croissant : le journal est totalement ordonné. */
  readonly seq: number
  readonly type: RoomEventType | 'unknown'
  readonly peerId: string | null
  readonly from: RoomState
  readonly to: RoomState
  readonly ok: boolean
  readonly code: RoomResultCode
  /** Raison en clair, toujours renseignée (utile même quand `ok`). */
  readonly reason: string
}

export type RoomEffect =
  | { readonly type: 'join-transport'; readonly roomId: string }
  | { readonly type: 'leave-transport'; readonly roomId: string }
  | { readonly type: 'retry-transport'; readonly roomId: string; readonly attempt: number }
  | { readonly type: 'open-peer'; readonly peerId: string }
  | { readonly type: 'close-peer'; readonly peerId: string }
  | {
      readonly type: 'reject-peer'
      readonly peerId: string
      readonly code: RoomResultCode
    }
  | {
      readonly type: 'notify'
      readonly level: 'info' | 'warn'
      readonly message: string
    }

export interface RoomConfig {
  readonly roomId: string
  readonly localId: string
  readonly displayName: string
  readonly maxParticipants: number
}

export interface Room {
  readonly roomId: string
  readonly localId: string
  readonly displayName: string
  readonly state: RoomState
  readonly participants: ReadonlyArray<Participant>
  readonly journal: ReadonlyArray<JournalEntry>
  readonly seq: number
  readonly maxParticipants: number
  readonly reconnectAttempts: number
}

export interface DispatchResult {
  readonly ok: boolean
  readonly code: RoomResultCode
  readonly reason: string
  /** Nouvel état du salon (identique à l'ancien si la transition est refusée). */
  readonly room: Room
  readonly effects: ReadonlyArray<RoomEffect>
  /** Entrée ajoutée au journal, acceptation comme refus. */
  readonly entry: JournalEntry
}

// ─────────────────────────────────────────────────────────────────────────────
// Construction
// ─────────────────────────────────────────────────────────────────────────────

function clampCapacity(value: number): number {
  if (!Number.isFinite(value)) return MAX_MESH_PARTICIPANTS
  const n = Math.floor(value)
  if (n < 1) return 1
  if (n > MAX_MESH_PARTICIPANTS) return MAX_MESH_PARTICIPANTS
  return n
}

export function createRoom(config: Partial<RoomConfig> = {}): Room {
  return {
    roomId: typeof config.roomId === 'string' && config.roomId.length > 0 ? config.roomId : 'lan',
    localId: typeof config.localId === 'string' && config.localId.length > 0 ? config.localId : 'me',
    displayName: typeof config.displayName === 'string' ? config.displayName : '',
    state: 'idle',
    participants: [],
    journal: [],
    seq: 0,
    maxParticipants: clampCapacity(
      typeof config.maxParticipants === 'number'
        ? config.maxParticipants
        : MAX_MESH_PARTICIPANTS,
    ),
    reconnectAttempts: 0,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lecture
// ─────────────────────────────────────────────────────────────────────────────

export function occupancy(room: Room): number {
  return room.participants.length
}

export function isFull(room: Room): boolean {
  return room.participants.length >= room.maxParticipants
}

export function seatsLeft(room: Room): number {
  return Math.max(0, room.maxParticipants - room.participants.length)
}

export function findParticipant(room: Room, peerId: string): Participant | undefined {
  return room.participants.find((participant) => participant.peerId === peerId)
}

export function participantIds(room: Room): string[] {
  return room.participants.map((participant) => participant.peerId)
}

/** Nombre de liens d'un maillage complet pour n participants. */
export function meshLinks(participants: number): number {
  if (!Number.isFinite(participants) || participants < 1) return 0
  const n = Math.floor(participants)
  return (n * (n - 1)) / 2
}

/** Le micro ne peut émettre que dans un salon connecté. */
export function canTransmit(room: Room): boolean {
  return room.state === 'connected'
}

/** Peut-on admettre un pair de plus ? Refus explicite quand c'est plein. */
export function canAdmit(room: Room): {
  readonly ok: boolean
  readonly code: RoomResultCode
  readonly reason: string
  readonly seatsLeft: number
} {
  if (room.state !== 'connected') {
    return {
      ok: false,
      code: 'illegal-transition',
      reason: `salon en état « ${room.state} » : aucun pair ne peut être admis avant « connected »`,
      seatsLeft: seatsLeft(room),
    }
  }
  if (isFull(room)) {
    return {
      ok: false,
      code: 'room-full',
      reason: `plafond de ${room.maxParticipants} participants atteint (maillage complet) — pair refusé`,
      seatsLeft: 0,
    }
  }
  return {
    ok: true,
    code: 'accepted',
    reason: `${seatsLeft(room)} place(s) libre(s) sur ${room.maxParticipants}`,
    seatsLeft: seatsLeft(room),
  }
}

/** Table des transitions de la machine d'état (hors admission de pairs). */
const TRANSITIONS: Readonly<Record<RoomState, ReadonlyArray<RoomState>>> = {
  idle: ['joining'],
  joining: ['connected', 'left'],
  connected: ['reconnecting', 'left'],
  reconnecting: ['connected', 'left'],
  left: [],
}

export function isLegalTransition(from: RoomState, to: RoomState): boolean {
  const allowed = TRANSITIONS[from]
  return allowed !== undefined && allowed.indexOf(to) >= 0
}

/** Cible d'état d'un événement de transport (indépendant des participants). */
function targetState(event: RoomEventType, from: RoomState): RoomState {
  switch (event) {
    case 'join':
      return 'joining'
    case 'transport-connected':
    case 'transport-restored':
      return 'connected'
    case 'transport-lost':
      return 'reconnecting'
    default:
      return from
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Journal
// ─────────────────────────────────────────────────────────────────────────────

function journal(
  room: Room,
  type: RoomEventType | 'unknown',
  peerId: string | null,
  to: RoomState,
  ok: boolean,
  code: RoomResultCode,
  reason: string,
): JournalEntry {
  return {
    seq: room.seq + 1,
    type,
    peerId,
    from: room.state,
    to: ok ? to : room.state,
    ok,
    code,
    reason,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Applique un événement. Ne lève jamais : toute entrée invalide ou transition
 * interdite rend `{ ok: false, code, reason }` avec l'état inchangé, et laisse
 * une trace dans le journal.
 */
export function dispatch(room: Room, event: RoomEvent): DispatchResult {
  const type: unknown = event === null || event === undefined ? undefined : event.type
  const known =
    typeof type === 'string' && ROOM_EVENT_TYPES.indexOf(type as RoomEventType) >= 0
  const peerIdRaw = event === null || event === undefined ? undefined : event.peerId
  const peerId = typeof peerIdRaw === 'string' && peerIdRaw.trim().length > 0 ? peerIdRaw.trim() : null

  if (!known) {
    const entry = journal(
      room,
      'unknown',
      peerId,
      room.state,
      false,
      'unknown-event',
      `événement inconnu « ${String(type)} » — ignoré, état inchangé`,
    )
    return refuse(room, entry, [])
  }

  const eventType = type as RoomEventType

  // ── Sortie : idempotente depuis « left », sinon transition autorisée ───────
  if (eventType === 'leave') {
    if (room.state === 'left') {
      const entry = journal(
        room,
        eventType,
        peerId,
        room.state,
        true,
        'accepted',
        'déjà sorti du salon — aucune action',
      )
      return accept(room, room, entry, [])
    }
    const next: Room = {
      ...room,
      state: 'left',
      participants: [],
      seq: room.seq + 1,
    }
    const entry = journal(
      room,
      eventType,
      peerId,
      'left',
      true,
      'accepted',
      `sortie du salon « ${room.roomId} »`,
    )
    return accept(room, { ...next }, entry, [
      { type: 'leave-transport', roomId: room.roomId },
    ])
  }

  // ── Terminal ───────────────────────────────────────────────────────────────
  if (room.state === 'left') {
    const entry = journal(
      room,
      eventType,
      peerId,
      room.state,
      false,
      'room-left',
      `salon déjà quitté : « ${eventType} » sans effet`,
    )
    return refuse(room, entry, [])
  }

  // ── Admission de pairs : seulement quand le transport est up ──────────────
  if (eventType === 'peer-joined') {
    if (room.state !== 'connected') {
      const entry = journal(
        room,
        eventType,
        peerId,
        room.state,
        false,
        'illegal-transition',
        `pair refusé : salon en état « ${room.state} », le maillage n'est pas établi`,
      )
      return refuse(room, entry, peerId ? [{ type: 'reject-peer', peerId, code: entry.code }] : [])
    }
    if (peerId === null) {
      const entry = journal(
        room,
        eventType,
        null,
        room.state,
        false,
        'invalid-peer',
        'pair refusé : identifiant absent ou vide',
      )
      return refuse(room, entry, [])
    }
    if (peerId === room.localId) {
      const entry = journal(
        room,
        eventType,
        peerId,
        room.state,
        false,
        'self',
        'pair refusé : identifiant identique au nôtre',
      )
      return refuse(room, entry, [])
    }
    if (findParticipant(room, peerId) !== undefined) {
      const entry = journal(
        room,
        eventType,
        peerId,
        room.state,
        false,
        'duplicate-peer',
        `pair refusé : ${peerId} est déjà dans le salon`,
      )
      return refuse(room, entry, [])
    }
    const admission = canAdmit(room)
    if (!admission.ok) {
      const entry = journal(room, eventType, peerId, room.state, false, admission.code, admission.reason)
      return refuse(room, entry, [
        { type: 'reject-peer', peerId, code: admission.code },
        { type: 'notify', level: 'warn', message: admission.reason },
      ])
    }
    const participant: Participant = {
      peerId,
      displayName:
        typeof event.displayName === 'string' && event.displayName.length > 0
          ? event.displayName
          : peerId,
      self: false,
      admittedAtSeq: room.seq + 1,
    }
    const next: Room = {
      ...room,
      participants: [...room.participants, participant],
      seq: room.seq + 1,
    }
    const entry = journal(
      room,
      eventType,
      peerId,
      room.state,
      true,
      'accepted',
      `pair ${peerId} admis (${next.participants.length}/${room.maxParticipants})`,
    )
    return accept(room, { ...next }, entry, [
      { type: 'open-peer', peerId },
    ])
  }

  if (eventType === 'peer-left') {
    if (room.state !== 'connected') {
      const entry = journal(
        room,
        eventType,
        peerId,
        room.state,
        false,
        'illegal-transition',
        `départ de pair ignoré : salon en état « ${room.state} »`,
      )
      return refuse(room, entry, [])
    }
    if (peerId === null || findParticipant(room, peerId) === undefined) {
      const entry = journal(
        room,
        eventType,
        peerId,
        room.state,
        false,
        peerId === null ? 'invalid-peer' : 'peer-not-found',
        peerId === null
          ? 'départ de pair ignoré : identifiant absent'
          : `départ de pair ignoré : ${peerId} n'est pas dans le salon`,
      )
      return refuse(room, entry, [])
    }
    const remaining = room.participants.filter((participant) => participant.peerId !== peerId)
    const next: Room = { ...room, participants: remaining, seq: room.seq + 1 }
    const entry = journal(
      room,
      eventType,
      peerId,
      room.state,
      true,
      'accepted',
      `pair ${peerId} parti (${remaining.length}/${room.maxParticipants})`,
    )
    return accept(room, { ...next }, entry, [
      { type: 'close-peer', peerId },
    ])
  }

  // ── Événements de transport ────────────────────────────────────────────────
  const to = targetState(eventType, room.state)
  if (to === room.state || !isLegalTransition(room.state, to)) {
    const entry = journal(
      room,
      eventType,
      peerId,
      room.state,
      false,
      'illegal-transition',
      `transition « ${room.state} » → « ${to} » interdite pour « ${eventType} » — état inchangé`,
    )
    return refuse(room, entry, [])
  }

  // Cas particuliers : entrée au salon, perte et reprise du transport.
  if (eventType === 'join') {
    const self: Participant = {
      peerId: room.localId,
      displayName: room.displayName.length > 0 ? room.displayName : room.localId,
      self: true,
      admittedAtSeq: room.seq + 1,
    }
    const next: Room = {
      ...room,
      state: 'joining',
      participants: [self],
      seq: room.seq + 1,
    }
    const entry = journal(
      room,
      eventType,
      peerId,
      'joining',
      true,
      'accepted',
      `rejoint « ${room.roomId} » : signalisation en cours`,
    )
    return accept(room, { ...next }, entry, [
      { type: 'join-transport', roomId: room.roomId },
    ])
  }

  if (eventType === 'transport-lost') {
    const attempts = room.reconnectAttempts + 1
    const next: Room = { ...room, state: 'reconnecting', seq: room.seq + 1, reconnectAttempts: attempts }
    const entry = journal(
      room,
      eventType,
      peerId,
      'reconnecting',
      true,
      'accepted',
      `transport perdu — reprise ${attempts} sur ${room.maxParticipants} plafond inchangé`,
    )
    return accept(room, { ...next }, entry, [
      { type: 'retry-transport', roomId: room.roomId, attempt: attempts },
    ])
  }

  // transport-connected / transport-restored
  const next: Room = {
    ...room,
    state: 'connected',
    seq: room.seq + 1,
    reconnectAttempts: 0,
  }
  const entry = journal(
    room,
    eventType,
    peerId,
    'connected',
    true,
    'accepted',
    eventType === 'transport-restored'
      ? 'transport rétabli — maillage de nouveau opérationnel'
      : 'transport établi — maillage opérationnel',
  )
  return accept(room, { ...next }, entry, [
    { type: 'notify', level: 'info', message: 'connecté au salon' },
  ])
}

function append(room: Room, entry: JournalEntry): ReadonlyArray<JournalEntry> {
  return [...room.journal, entry]
}

function accept(
  previous: Room,
  next: Room,
  entry: JournalEntry,
  effects: ReadonlyArray<RoomEffect>,
): DispatchResult {
  return {
    ok: true,
    code: 'accepted',
    reason: entry.reason,
    // Le journal n'est écrit qu'ici : une seule entrée par événement, `seq`
    // strictement croissant (les refus le font avancer aussi, cf. `refuse`).
    room: { ...next, journal: append(previous, entry), seq: entry.seq },
    effects,
    entry,
  }
}

function refuse(
  room: Room,
  entry: JournalEntry,
  effects: ReadonlyArray<RoomEffect>,
): DispatchResult {
  return {
    ok: false,
    code: entry.code,
    reason: entry.reason,
    // État métier inchangé, mais `seq` avance : le journal reste totalement
    // ordonné même quand on n'accepte rien.
    room: { ...room, journal: append(room, entry), seq: entry.seq },
    effects,
    entry,
  }
}

/** Applique une suite d'événements et rend le dernier résultat (journal cumulé). */
export function dispatchAll(room: Room, events: ReadonlyArray<RoomEvent>): DispatchResult {
  let result: DispatchResult = {
    ok: true,
    code: 'accepted',
    reason: 'aucun événement',
    room,
    effects: [],
    entry: {
      seq: room.seq,
      type: 'unknown',
      peerId: null,
      from: room.state,
      to: room.state,
      ok: true,
      code: 'accepted',
      reason: 'aucun événement',
    },
  }
  for (const event of events) result = dispatch(result.room, event)
  return result
}
