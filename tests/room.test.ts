/**
 * tests/room.test.ts — Carillon
 *
 * Machine d'état du salon : idle → joining → connected → reconnecting → left,
 * refus explicite des transitions illégales (jamais de throw), plafond de
 * maillage à 8 participants avec admission/refus, journal ordonné (arbitrage desk-lead).
 *
 *   node --test tests/room.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MAX_MESH_PARTICIPANTS,
  MESH_LINKS_MAX,
  canAdmit,
  canTransmit,
  createRoom,
  dispatch,
  dispatchAll,
  isFull,
  isLegalTransition,
  meshLinks,
  occupancy,
  participantIds,
  seatsLeft,
} from '../src/engine/room.ts'

/**
 * Premier élément d'une liste, avec garde explicite.
 * `noUncheckedIndexedAccess` type `effects[0]` en `T | undefined` : affirmer
 * l'élément au lieu de le vérifier transformerait un salon cassé en test vert.
 */
function first<T>(items: readonly T[], what: string): T {
  const value = items[0]
  if (value === undefined) {
    throw new Error(`${what} : liste vide alors qu’un élément est attendu`)
  }
  return value
}

/** Salon connecté avec soi-même comme unique participant. */
function connectedRoom() {
  const idle = createRoom({ roomId: 'salon-test', localId: 'me', displayName: 'Carillon' })
  const joining = dispatch(idle, { type: 'join' })
  assert.equal(joining.ok, true)
  const connected = dispatch(joining.room, { type: 'transport-connected' })
  assert.equal(connected.ok, true)
  return connected.room
}

/** Ajoute n pairs, en vérifiant qu'ils sont admis. */
function addPeers(room: ReturnType<typeof connectedRoom>, count: number, prefix = 'pair') {
  let current = room
  for (let i = 1; i <= count; i++) {
    const result = dispatch(current, { type: 'peer-joined', peerId: `${prefix}-${i}` })
    assert.equal(result.ok, true, `pair ${prefix}-${i} devrait être admis`)
    current = result.room
  }
  return current
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Cycle de vie nominal
// ─────────────────────────────────────────────────────────────────────────────

test('nominal : idle → joining → connected, journal ordonné', () => {
  const idle = createRoom({ roomId: 'salon-test', localId: 'me', displayName: 'Carillon' })
  assert.equal(idle.state, 'idle')
  assert.equal(idle.participants.length, 0)
  assert.equal(idle.journal.length, 0)

  const join = dispatch(idle, { type: 'join' })
  assert.equal(join.ok, true)
  assert.equal(join.code, 'accepted')
  assert.equal(join.room.state, 'joining')
  assert.deepEqual(
    join.effects.map((effect) => effect.type),
    ['join-transport'],
  )
  assert.deepEqual(participantIds(join.room), ['me'], 'soi-même entre au salon')
  assert.equal(first(join.room.participants, 'participants après join').self, true)
  assert.equal(canTransmit(join.room), false, 'pas de micro avant « connected »')

  const connected = dispatch(join.room, { type: 'transport-connected' })
  assert.equal(connected.ok, true)
  assert.equal(connected.room.state, 'connected')
  assert.equal(canTransmit(connected.room), true)

  // Journal totalement ordonné : seq 1, 2, 3…
  assert.deepEqual(
    connected.room.journal.map((entry) => entry.seq),
    [1, 2],
  )
  assert.deepEqual(
    connected.room.journal.map((entry) => [entry.from, entry.to]),
    [
      ['idle', 'joining'],
      ['joining', 'connected'],
    ],
  )
  assert.equal(connected.room.seq, 2)
})

test('sortie : n’importe quel état → left, participants vidés', () => {
  const room = connectedRoom()
  const left = dispatch(room, { type: 'leave' })
  assert.equal(left.ok, true)
  assert.equal(left.room.state, 'left')
  assert.deepEqual(left.room.participants, [])
  assert.deepEqual(
    left.effects.map((effect) => effect.type),
    ['leave-transport'],
  )
  assert.equal(canTransmit(left.room), false)

  // Quitter deux fois n'est pas une faute : c'est idempotent.
  const again = dispatch(left.room, { type: 'leave' })
  assert.equal(again.ok, true)
  assert.equal(again.room.state, 'left')
  assert.equal(again.effects.length, 0)
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Transitions illégales : refus explicite, jamais de throw
// ─────────────────────────────────────────────────────────────────────────────

test('transition illégale : refus motivé, état inchangé, refus journalisé', () => {
  const joining = dispatch(createRoom({ localId: 'me' }), { type: 'join' }).room
  const before = joining.journal.length

  const refused = dispatch(joining, { type: 'join' })
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'illegal-transition')
  assert.match(refused.reason, /interdite|joignant|joining/)
  assert.equal(refused.room.state, 'joining', 'l’état ne bouge pas')
  assert.equal(refused.room.journal.length, before + 1, 'le refus est journalisé')
  assert.equal(refused.entry.ok, false)
  assert.equal(refused.entry.from, 'joining')
  assert.equal(refused.entry.to, 'joining')

  // Idem pour un événement de transport arrivé trop tôt.
  const idle = createRoom({ localId: 'me' })
  const early = dispatch(idle, { type: 'transport-connected' })
  assert.equal(early.ok, false)
  assert.equal(early.code, 'illegal-transition')
  assert.equal(early.room.state, 'idle')

  assert.equal(isLegalTransition('idle', 'connected'), false)
  assert.equal(isLegalTransition('connected', 'reconnecting'), true)
  assert.equal(isLegalTransition('left', 'joining'), false, '« left » est terminal')
})

test('salon quitté : tout événement est refusé avec « room-left »', () => {
  const left = dispatch(connectedRoom(), { type: 'leave' }).room
  for (const type of ['join', 'transport-connected', 'peer-joined', 'peer-left', 'transport-lost'] as const) {
    const refused = dispatch(left, { type, peerId: 'pair-1' })
    assert.equal(refused.ok, false, `${type} doit être refusé`)
    assert.equal(refused.code, 'room-left')
    assert.equal(refused.room.state, 'left')
    assert.match(refused.reason, /déjà quitté/)
  }
})

test('événement inconnu ou malformé : refus, aucune exception', () => {
  const room = connectedRoom()
  const bogus = dispatch(room, { type: 'teleport' as never })
  assert.equal(bogus.ok, false)
  assert.equal(bogus.code, 'unknown-event')
  assert.equal(bogus.room.state, 'connected', 'état inchangé')
  assert.equal(bogus.room.participants.length, room.participants.length)

  // Même piège avec une entrée qui n'est pas un événement du tout.
  const nothing = dispatch(room, null as never)
  assert.equal(nothing.ok, false)
  assert.equal(nothing.code, 'unknown-event')
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Plafond de maillage : 8 participants
// ─────────────────────────────────────────────────────────────────────────────

test('plafond : le 8e participant est admis, le 9e est refusé explicitement', () => {
  assert.equal(MAX_MESH_PARTICIPANTS, 8)
  assert.equal(MESH_LINKS_MAX, 28, '8 × 7 / 2 liens à décoder')
  assert.equal(meshLinks(8), 28)
  assert.equal(meshLinks(10), 45)
  assert.equal(meshLinks(1), 0)

  const room = addPeers(connectedRoom(), MAX_MESH_PARTICIPANTS - 1)
  assert.equal(occupancy(room), 8, 'soi-même + 7 pairs')
  assert.equal(isFull(room), true)
  assert.equal(seatsLeft(room), 0)
  assert.equal(canAdmit(room).ok, false)
  assert.equal(canAdmit(room).code, 'room-full')

  const refused = dispatch(room, { type: 'peer-joined', peerId: 'pair-8' })
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'room-full')
  assert.match(refused.reason, /plafond de 8/)
  assert.equal(refused.room.participants.length, 8, 'le 9e n’entre pas')
  assert.equal(
    refused.room.participants.some((participant) => participant.peerId === 'pair-10'),
    false,
  )
  assert.deepEqual(
    refused.effects.map((effect) => effect.type),
    ['reject-peer', 'notify'],
    'le pair refusé reçoit une réponse, il n’attend pas indéfiniment',
  )
  const rejection = first(refused.effects, 'effets du refus')
  assert.equal(rejection.type === 'reject-peer' ? rejection.code : null, 'room-full')
})

test('plafond : une place libérée est immédiatement réutilisable', () => {
  const full = addPeers(connectedRoom(), MAX_MESH_PARTICIPANTS - 1)
  const refused = dispatch(full, { type: 'peer-joined', peerId: 'pair-8' })
  assert.equal(refused.code, 'room-full')

  const freed = dispatch(full, { type: 'peer-left', peerId: 'pair-1' })
  assert.equal(freed.ok, true)
  assert.equal(occupancy(freed.room), 7)
  assert.equal(canAdmit(freed.room).ok, true)
  assert.equal(canAdmit(freed.room).seatsLeft, 1)

  const late = dispatch(freed.room, { type: 'peer-joined', peerId: 'pair-8' })
  assert.equal(late.ok, true)
  assert.equal(occupancy(late.room), 8)
})

test('plafond : impossible d’admettre un pair avant « connected »', () => {
  const joining = dispatch(createRoom({ localId: 'me' }), { type: 'join' }).room
  const refused = dispatch(joining, { type: 'peer-joined', peerId: 'pair-1' })
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'illegal-transition')
  assert.match(refused.reason, /maillage/)
  assert.equal(occupancy(refused.room), 1, 'seul soi-même')
})

test('capacité : configurée, bornée à 8 et jamais sous 1', () => {
  assert.equal(createRoom().maxParticipants, MAX_MESH_PARTICIPANTS)
  assert.equal(createRoom({ maxParticipants: 50 }).maxParticipants, 8)
  assert.equal(createRoom({ maxParticipants: 0 }).maxParticipants, 1)
  assert.equal(createRoom({ maxParticipants: Number.NaN }).maxParticipants, 8)
  assert.equal(createRoom({ maxParticipants: 4 }).maxParticipants, 4)
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. Admissions douteuses
// ─────────────────────────────────────────────────────────────────────────────

test('admissions douteuses : soi-même, doublon, identifiant vide, inconnu', () => {
  const room = connectedRoom()
  assert.equal(dispatch(room, { type: 'peer-joined', peerId: 'me' }).code, 'self')
  assert.equal(dispatch(room, { type: 'peer-joined', peerId: '  ' }).code, 'invalid-peer')
  assert.equal(dispatch(room, { type: 'peer-joined' }).code, 'invalid-peer')

  const admitted = dispatch(room, { type: 'peer-joined', peerId: 'pair-1' })
  assert.equal(admitted.ok, true)
  assert.deepEqual(participantIds(admitted.room), ['me', 'pair-1'])
  assert.equal(
    dispatch(admitted.room, { type: 'peer-joined', peerId: 'pair-1' }).code,
    'duplicate-peer',
    'pas de double piste pour un même pair',
  )

  const unknown = dispatch(admitted.room, { type: 'peer-left', peerId: 'fantome' })
  assert.equal(unknown.ok, false)
  assert.equal(unknown.code, 'peer-not-found')
  assert.equal(occupancy(unknown.room), 2, 'le salon n’est pas modifié')
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. Reprise sur perte de transport
// ─────────────────────────────────────────────────────────────────────────────

test('reprise : connected → reconnecting → connected, tentatives comptées', () => {
  const room = connectedRoom()
  const lost = dispatch(room, { type: 'transport-lost' })
  assert.equal(lost.ok, true)
  assert.equal(lost.room.state, 'reconnecting')
  assert.equal(lost.room.reconnectAttempts, 1)
  assert.equal(first(lost.effects, 'effets de la perte de transport').type, 'retry-transport')
  assert.equal(canTransmit(lost.room), false, 'micro fermé pendant la reprise')

  const duplicateLoss = dispatch(lost.room, { type: 'transport-lost' })
  assert.equal(duplicateLoss.ok, false)
  assert.equal(duplicateLoss.code, 'illegal-transition')

  const restored = dispatch(lost.room, { type: 'transport-restored' })
  assert.equal(restored.ok, true)
  assert.equal(restored.room.state, 'connected')
  assert.equal(restored.room.reconnectAttempts, 0, 'compteur remis à zéro après reprise')
  assert.equal(canTransmit(restored.room), true)

  const twice = dispatch(restored.room, { type: 'transport-restored' })
  assert.equal(twice.ok, false, 'rien à restaurer quand tout va bien')
  assert.equal(twice.code, 'illegal-transition')
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. Pureté, déterminisme et journal
// ─────────────────────────────────────────────────────────────────────────────

test('pureté : l’état d’entrée n’est jamais muté, les résultats sont reproductibles', () => {
  const room = connectedRoom()
  const snapshot = { ...room, participants: [...room.participants], journal: [...room.journal] }

  const first = dispatch(room, { type: 'peer-joined', peerId: 'pair-1' })
  assert.deepEqual(room, snapshot, 'l’état d’entrée reste intact')
  assert.equal(room.participants.length, 1)
  assert.equal(first.room.participants.length, 2)

  const events = [
    { type: 'peer-joined', peerId: 'pair-2' },
    { type: 'peer-left', peerId: 'pair-1' },
    { type: 'peer-joined', peerId: 'me' },
    { type: 'transport-lost' },
  ] as const
  const a = dispatchAll(room, events)
  const b = dispatchAll(room, events)
  assert.deepEqual(a.room, b.room, 'deux exécutions identiques donnent le même salon')
  assert.deepEqual(a.room.journal, b.room.journal)
  assert.deepEqual(room, snapshot)
})

test('journal : une entrée par événement, seq strictement croissant', () => {
  const room = connectedRoom()
  const events = [
    { type: 'peer-joined', peerId: 'pair-1' },
    { type: 'peer-joined', peerId: 'pair-1' }, // refusé : doublon
    { type: 'peer-left', peerId: 'pair-1' },
    { type: 'transport-lost' },
    { type: 'transport-restored' },
  ] as const

  let current = room
  for (const event of events) current = dispatch(current, event).room

  assert.equal(current.journal.length, room.journal.length + events.length)
  const seqs = current.journal.map((entry) => entry.seq)
  for (let i = 1; i < seqs.length; i++) {
    const currentSeq = seqs[i]
    const previousSeq = seqs[i - 1]
    if (currentSeq === undefined || previousSeq === undefined) {
      throw new Error(`journal incohérent : entrée absente à l’index ${i}`)
    }
    assert.equal(currentSeq, previousSeq + 1, 'aucun trou, aucun doublon dans le journal')
  }
  assert.equal(current.seq, seqs[seqs.length - 1])
  assert.deepEqual(
    current.journal.slice(-5).map((entry) => [entry.type, entry.ok, entry.code]),
    [
      ['peer-joined', true, 'accepted'],
      ['peer-joined', false, 'duplicate-peer'],
      ['peer-left', true, 'accepted'],
      ['transport-lost', true, 'accepted'],
      ['transport-restored', true, 'accepted'],
    ],
  )
  assert.ok(
    current.journal.every((entry) => entry.reason.length > 0),
    'chaque entrée porte une raison lisible',
  )
})
