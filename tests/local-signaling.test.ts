/**
 * tests/local-signaling.test.ts — T6 : serveur de signalisation local
 *
 * Aucun vrai socket, aucun réseau : un faux socket enregistre les envois
 * (JSON) et rejoue les entrées via connection.receive(...).
 *
 * Lancer : cd /work/lan-voice && node --test tests/local-signaling.test.ts
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createLocalSignaling,
  isAllowedListenHost,
  parseClientMessage,
  pickPort,
  DEFAULT_MAX_PARTICIPANTS,
  SIGNALING_BASE_PORT,
  SIGNALING_HTTP_PATH,
  SIGNALING_PORT_RANGE
} from '../src/engine/net/local-signaling.ts'

import type {
  ServerMessage,
  SignalingConnection,
  SocketLike
} from '../src/engine/net/local-signaling.ts'

/* ------------------------------------------------------------------ */
/* Horloge injectée                                                    */
/* ------------------------------------------------------------------ */

/**
 * `now` est OBLIGATOIRE depuis SPEC-004 (aucune horloge système dans
 * `src/engine`). On injecte une horloge déterministe et STRICTEMENT
 * incrémentale : 1000, 1001, 1002, … — deux créations successives partent de la
 * même origine, donc les horodatages émis sont reproductibles et vérifiables.
 */
function makeClock(start = 1000, step = 1): () => number {
  let current = start - step
  return (): number => {
    current += step
    return current
  }
}

/* ------------------------------------------------------------------ */
/* Faux socket                                                         */
/* ------------------------------------------------------------------ */

interface FakeSocket extends SocketLike {
  raw: string[]
  sent: ServerMessage[]
  closed: boolean
}

function fakeSocket(): FakeSocket {
  const socket: FakeSocket = {
    raw: [],
    sent: [],
    closed: false,
    send(data: string): void {
      socket.raw.push(data)
      socket.sent.push(JSON.parse(data) as ServerMessage)
    },
    close(): void {
      socket.closed = true
    }
  }
  return socket
}

interface Harness {
  socket: FakeSocket
  connection: SignalingConnection
}

function connect(server: ReturnType<typeof createLocalSignaling>): Harness {
  const socket = fakeSocket()
  const connection = server.handleConnection(socket)
  return { socket, connection }
}

function connectAndJoin(
  server: ReturnType<typeof createLocalSignaling>,
  name: string
): Harness & { peerId: string } {
  const harness = connect(server)
  const result = harness.connection.receive({ type: 'join', name })
  assert.equal(result.ok, true, `join(${name}) doit réussir`)
  if (!result.ok) throw new Error('inatteignable')
  // `ReceiveAccepted` est l'union `JoinSuccess | RelaySuccess | LeaveSuccess` :
  // on discrimine le détail par présence du champ, jamais par cast. Un « join »
  // accepté doit porter `peerId` dans son retour, et ce `peerId` doit être
  // celui que la connexion a retenu.
  if (!('peerId' in result)) {
    throw new Error(`join(${name}) accepté mais le retour de receive() ne porte pas de peerId`)
  }
  const peerId = result.peerId
  assert.equal(harness.connection.peerId, peerId, 'le peerId rendu est celui de la connexion')
  return { ...harness, peerId }
}

const LAN_HOST_CANDIDATE =
  'candidate:1 1 udp 2122260223 192.168.1.20 51234 typ host generation 0'
const SRFLX_CANDIDATE =
  'candidate:2 1 udp 1686052607 203.0.113.7 51234 typ srflx raddr 192.168.1.20 rport 51234'
const PUBLIC_HOST_CANDIDATE =
  'candidate:3 1 udp 2122260223 8.8.8.8 51234 typ host generation 0'

/* ------------------------------------------------------------------ */
/* pickPort — fonction pure                                            */
/* ------------------------------------------------------------------ */

test('pickPort : la plage va de 47821 à 47830 sur 10 tentatives', () => {
  assert.equal(SIGNALING_BASE_PORT, 47821)
  assert.equal(SIGNALING_PORT_RANGE, 10)
  assert.equal(SIGNALING_HTTP_PATH, '/signal')
})

test('pickPort : plage libre → 47821, premier libre retenu', () => {
  const free = new Array<boolean>(SIGNALING_PORT_RANGE).fill(false)
  assert.equal(pickPort(free), 47821)
  assert.equal(pickPort([]), null, 'aucune tentative possible → null')
  assert.equal(pickPort([false, false, false]), 47821, 'on s’arrête au premier libre')
})

test('pickPort : port 47821 occupé → 47822', () => {
  const attempts = new Array<boolean>(SIGNALING_PORT_RANGE).fill(false)
  attempts[0] = true
  assert.equal(pickPort(attempts), 47822)
})

test('pickPort : 47821 et 47822 occupés → 47823 ; les 10 pris → null', () => {
  const attempts = new Array<boolean>(SIGNALING_PORT_RANGE).fill(false)
  attempts[0] = true
  attempts[1] = true
  assert.equal(pickPort(attempts), 47823)

  const allTaken = new Array<boolean>(SIGNALING_PORT_RANGE).fill(true)
  assert.equal(pickPort(allTaken), null, '10 tentatives épuisées → null')
  assert.equal(pickPort([...[true, true, true, true, true, true, true, true, true, true]]), null)
})

test('pickPort : pure (n’altère pas l’entrée) et ignore les entrées hors plage', () => {
  const attempts = new Array<boolean>(SIGNALING_PORT_RANGE).fill(true)
  const snapshot = [...attempts]
  pickPort(attempts)
  assert.deepEqual(attempts, snapshot)

  const tooLong = new Array<boolean>(SIGNALING_PORT_RANGE + 5).fill(true)
  tooLong[SIGNALING_PORT_RANGE] = false
  assert.equal(pickPort(tooLong), null, 'les tentatives au-delà de 10 sont ignorées')
})

test('createLocalSignaling : port imposé conservé, sinon repli sur 47821', () => {
  const imposed = createLocalSignaling({ port: 47822, now: makeClock() })
  assert.equal(imposed.port, 47822)
  imposed.close()

  const fallback = createLocalSignaling({ now: makeClock() })
  assert.equal(fallback.port, 47821)
  assert.equal(fallback.maxParticipants, DEFAULT_MAX_PARTICIPANTS)
  fallback.close()
})

/* ------------------------------------------------------------------ */
/* Écoute : jamais 0.0.0.0                                             */
/* ------------------------------------------------------------------ */

test('isAllowedListenHost : loopback et LAN acceptés, tout le reste refusé', () => {
  assert.equal(isAllowedListenHost('127.0.0.1'), true)
  assert.equal(isAllowedListenHost('::1'), true)
  assert.equal(isAllowedListenHost('localhost'), true)
  assert.equal(isAllowedListenHost('192.168.1.10'), true)
  assert.equal(isAllowedListenHost('10.4.0.7'), true)
  assert.equal(isAllowedListenHost('fe80::1'), true)
  assert.equal(isAllowedListenHost('atelier.local'), true)

  assert.equal(isAllowedListenHost('0.0.0.0'), false, 'jamais d’écoute sur toutes les interfaces')
  assert.equal(isAllowedListenHost('::'), false)
  assert.equal(isAllowedListenHost('*'), false)
  assert.equal(isAllowedListenHost('8.8.8.8'), false)
  assert.equal(isAllowedListenHost(''), false)
})

/* ------------------------------------------------------------------ */
/* Plafond 8 pairs : le 9e est refusé avec code et raison              */
/* ------------------------------------------------------------------ */

test('9e pair : refus explicite (code room-full + raison), salon figé à 8', () => {
  // Horloge incrémentale : on vérifie du même coup les horodatages émis.
  const stamps: number[] = []
  const server = createLocalSignaling({
    now: makeClock(),
    onEvent: (event): void => {
      stamps.push(event.at)
    }
  })
  const members: Harness[] = []
  for (let index = 1; index <= 8; index += 1) {
    members.push(connectAndJoin(server, `Pair ${index}`))
  }
  assert.equal(server.participants().length, 8)

  const ninth = connect(server)
  const refusal = ninth.connection.receive({ type: 'join', name: 'Neuvième' })

  assert.equal(refusal.ok, false, 'le 9e pair doit être refusé')
  if (refusal.ok) throw new Error('inatteignable')
  assert.equal(refusal.code, 'room-full')
  assert.ok(refusal.reason.length > 0, 'la raison doit être renseignée')
  assert.match(refusal.reason, /8/)

  const wire = ninth.socket.sent.find((message) => message.type === 'refuse')
  assert.ok(wire !== undefined, 'le refus doit aussi être émis sur le socket')
  if (wire !== undefined && wire.type === 'refuse') {
    assert.equal(wire.code, 'room-full')
    assert.match(wire.reason, /plafond de 8/)
  }

  // Le refusé n'a jamais reçu de hello, et le salon reste à 8.
  assert.equal(server.participants().length, 8)
  assert.equal(ninth.socket.sent.some((message) => message.type === 'hello'), false)
  assert.equal(ninth.connection.peerId, null)

  // Horodatages : horloge injectée, déterministe, exactement un tick par événement.
  assert.ok(stamps.length > 0, 'des événements doivent être émis')
  assert.equal(
    stamps[0],
    1000,
    'le premier événement (port-selected) porte l’horodatage de l’horloge injectée'
  )
  assert.deepEqual(
    stamps,
    stamps.map((_value, index) => 1000 + index),
    'les horodatages sont strictement croissants : 1000, 1001, 1002, …'
  )

  server.close()
})

test('join() explicite respecte le même plafond', () => {
  const server = createLocalSignaling({ maxParticipants: 2, now: makeClock() })
  const first = connect(server)
  const second = connect(server)
  const third = connect(server)

  assert.equal(server.join({ connection: first.connection, name: 'A' }).ok, true)
  assert.equal(server.join({ connection: second.connection, name: 'B' }).ok, true)
  const refused = server.join({ connection: third.connection, name: 'C' })
  assert.equal(refused.ok, false)
  if (!refused.ok) assert.equal(refused.code, 'room-full')

  server.close()
})

/* ------------------------------------------------------------------ */
/* Aucun message relayé hors des pairs du salon                        */
/* ------------------------------------------------------------------ */

test('relais : seul le destinataire du salon reçoit, jamais le reste', () => {
  const server = createLocalSignaling({ now: makeClock() })
  const alice = connectAndJoin(server, 'Alice')
  const bob = connectAndJoin(server, 'Bob')
  const outsider = connect(server) // connecté mais PAS dans le salon

  const delivered = server.relay(alice.peerId, {
    type: 'offer',
    to: bob.peerId,
    sdp: 'v=0\r\no=- 1 1 IN IP4 192.168.1.20\r\n'
  })
  assert.equal(delivered.ok, true)
  if (delivered.ok) assert.deepEqual(delivered.delivered, [bob.peerId])

  const offerAtBob = bob.socket.sent.filter((message) => message.type === 'offer')
  assert.equal(offerAtBob.length, 1)
  const relayed = offerAtBob[0]
  if (relayed === undefined) throw new Error('aucune offre relayée à Bob')
  // Refus explicite plutôt qu'un `if` qui sauterait silencieusement les
  // assertions : Bob doit recevoir une offre, pas autre chose.
  if (relayed.type !== 'offer') throw new Error(`Bob a reçu « ${relayed.type} » au lieu d’une offre`)
  assert.equal(relayed.from, alice.peerId)
  assert.equal(relayed.to, bob.peerId)

  // Personne d'autre : ni l'émetteur, ni le hors-salon.
  assert.equal(alice.socket.sent.some((message) => message.type === 'offer'), false)
  assert.equal(outsider.socket.sent.length, 0, 'un non-membre ne reçoit rien')

  server.close()
})

test('relais : destinataire inconnu ou émetteur absent → refus, zéro émission', () => {
  const server = createLocalSignaling({ now: makeClock() })
  const alice = connectAndJoin(server, 'Alice')
  const bob = connectAndJoin(server, 'Bob')
  const outsider = connect(server)
  const before = bob.socket.sent.length

  const unknown = server.relay(alice.peerId, {
    type: 'answer',
    to: 'p99',
    sdp: 'v=0\r\n'
  })
  assert.equal(unknown.ok, false)
  if (!unknown.ok) assert.equal(unknown.code, 'unknown-peer')
  assert.equal(bob.socket.sent.length, before, 'aucune émission vers un hors-salon')
  assert.equal(outsider.socket.sent.length, 0)

  const ghost = server.relay('p99', { type: 'ice', to: bob.peerId, candidate: LAN_HOST_CANDIDATE })
  assert.equal(ghost.ok, false)
  if (!ghost.ok) assert.equal(ghost.code, 'not-joined')
  assert.equal(bob.socket.sent.length, before)

  const self = server.relay(alice.peerId, { type: 'offer', to: alice.peerId, sdp: 'v=0\r\n' })
  assert.equal(self.ok, false)
  if (!self.ok) assert.equal(self.code, 'invalid-message')
  assert.equal(alice.socket.sent.some((message) => message.type === 'offer'), false)

  server.close()
})

test('relais : une connexion non membre est refusée (not-joined)', () => {
  const server = createLocalSignaling({ now: makeClock() })
  const member = connectAndJoin(server, 'Alice')
  const outsider = connect(server)

  const result = outsider.connection.receive({ type: 'offer', to: member.peerId, sdp: 'v=0\r\n' })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.code, 'not-joined')
  assert.equal(member.socket.sent.some((message) => message.type === 'offer'), false)

  server.close()
})

test('relais ICE : hôte LAN relayé, srflx / public refusés off-lan', () => {
  const server = createLocalSignaling({ now: makeClock() })
  const alice = connectAndJoin(server, 'Alice')
  const bob = connectAndJoin(server, 'Bob')

  const ok = alice.connection.receive({ type: 'ice', to: bob.peerId, candidate: LAN_HOST_CANDIDATE })
  assert.equal(ok.ok, true)
  const iceAtBob = bob.socket.sent.filter((message) => message.type === 'ice')
  assert.equal(iceAtBob.length, 1)

  const srflx = alice.connection.receive({ type: 'ice', to: bob.peerId, candidate: SRFLX_CANDIDATE })
  assert.equal(srflx.ok, false)
  if (!srflx.ok) assert.equal(srflx.code, 'off-lan')

  const publicHost = alice.connection.receive({
    type: 'ice',
    to: bob.peerId,
    candidate: PUBLIC_HOST_CANDIDATE
  })
  assert.equal(publicHost.ok, false)
  if (!publicHost.ok) assert.equal(publicHost.code, 'off-lan')

  assert.equal(
    bob.socket.sent.filter((message) => message.type === 'ice').length,
    1,
    'seul le candidat LAN a traversé le serveur'
  )

  server.close()
})

/* ------------------------------------------------------------------ */
/* close() libère                                                      */
/* ------------------------------------------------------------------ */

test('close() : bye aux membres, sockets fermés, salon vidé, plus aucun join', () => {
  const server = createLocalSignaling({ now: makeClock() })
  const alice = connectAndJoin(server, 'Alice')
  const bob = connectAndJoin(server, 'Bob')
  assert.equal(server.participants().length, 2)

  server.close()

  assert.deepEqual(server.participants(), [], 'le salon est vidé')
  assert.equal(alice.socket.closed, true, 'socket Alice fermé')
  assert.equal(bob.socket.closed, true, 'socket Bob fermé')
  const bye = alice.socket.sent.filter((message) => message.type === 'bye')
  assert.equal(bye.length, 1, 'un bye est émis avant fermeture')
  assert.equal(alice.connection.closed, true)
  assert.equal(alice.connection.peerId, null)

  // Le serveur fermé refuse toute nouvelle entrée, avec un code explicite.
  const late = connect(server)
  const refusal = late.connection.receive({ type: 'join', name: 'Tardif' })
  assert.equal(refusal.ok, false)
  if (!refusal.ok) {
    assert.equal(refusal.code, 'closed')
    assert.ok(refusal.reason.length > 0)
  }
  assert.deepEqual(server.participants(), [])

  // close() est idempotent.
  server.close()
  assert.deepEqual(server.participants(), [])
})

test('leave() et connection.close() retirent le pair et préviennent les autres', () => {
  const server = createLocalSignaling({ now: makeClock() })
  const alice = connectAndJoin(server, 'Alice')
  const bob = connectAndJoin(server, 'Bob')

  server.leave(alice.peerId)
  assert.deepEqual(server.participants(), [{ peerId: bob.peerId, name: 'Bob' }])
  assert.equal(bob.socket.sent.some((message) => message.type === 'leave'), true)

  bob.connection.close('au revoir')
  assert.deepEqual(server.participants(), [])
  assert.equal(bob.socket.closed, true)
  assert.equal(bob.socket.sent.some((message) => message.type === 'bye'), true)
})

/* ------------------------------------------------------------------ */
/* Analyse stricte                                                     */
/* ------------------------------------------------------------------ */

test('parseClientMessage : strict sur le type et les champs requis', () => {
  assert.deepEqual(parseClientMessage('{"type":"join","name":"Zoé"}'), {
    type: 'join',
    name: 'Zoé'
  })
  assert.deepEqual(parseClientMessage('{"type":"join"}'), { type: 'join', name: '' })
  assert.equal(parseClientMessage('pas du json'), null)
  assert.equal(parseClientMessage({ type: 'inconnu' }), null)
  assert.equal(parseClientMessage({ type: 'offer', to: 'p1' }), null, 'sdp requis')
  assert.equal(parseClientMessage({ type: 'ice', to: 'p1', candidate: '' }), null)
  assert.equal(parseClientMessage({ type: 'join', name: 42 }), null)
  assert.equal(parseClientMessage(null), null)

  const server = createLocalSignaling({ now: makeClock() })
  const client = connect(server)
  const bad = client.connection.receive('pas du json')
  assert.equal(bad.ok, false)
  if (!bad.ok) assert.equal(bad.code, 'invalid-message')
  assert.equal(client.socket.sent.some((message) => message.type === 'refuse'), true)
  server.close()
})

test('hello : noms éphémères, pair listé chez les autres, aucun identifiant persistant', () => {
  const server = createLocalSignaling({ now: makeClock() })
  const alice = connectAndJoin(server, '  Alice  ')
  const bob = connectAndJoin(server, 'Bob')

  const helloAlice = alice.socket.sent.find((message) => message.type === 'hello')
  assert.ok(helloAlice !== undefined)
  if (helloAlice !== undefined && helloAlice.type === 'hello') {
    assert.equal(helloAlice.peerId, alice.peerId)
    assert.equal(helloAlice.name, 'Alice', 'nom rogné')
    assert.equal(helloAlice.maxParticipants, 8)
    assert.deepEqual(helloAlice.peers, [])
  }

  const helloBob = bob.socket.sent.find((message) => message.type === 'hello')
  if (helloBob !== undefined && helloBob.type === 'hello') {
    assert.deepEqual(helloBob.peers, [{ peerId: alice.peerId, name: 'Alice' }])
  }
  assert.equal(
    alice.socket.sent.some((message) => message.type === 'join'),
    true,
    'Alice reçoit l’annonce de Bob'
  )
  assert.match(alice.peerId, /^p\d+$/, 'identifiant de session, pas d’UUID persistant')

  server.close()
})
