/**
 * e2e 2026-11-03 (banc poste isolé) : le pair d'en face peut livrer un candidat ICE en
 * ligne SDP NUE (un câble textuel qui désemballe le RTCIceCandidateInit). Avant ce correctif,
 * parseCandidate refusait « charge utile non objet » → zéro candidat au plan média → noFlow
 * après 5 s. Le maillage remballe la ligne au lieu de la refuser ; les vraies ordures restent
 * refusées (SPEC-007 A6 : refus tracé, aucune exception).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMesh } from '../src/engine/net/mesh.ts'
import type { SignalIn } from '../src/shell/ipc-contract.ts'

const OFFER_SDP = 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n'
const NO_TIMERS = { once: () => 0 as never, cancel: () => {} }

interface PlaneCall {
  peerId: string
  candidate: unknown
}

function harness() {
  const calls: PlaneCall[] = []
  const plane = {
    async attach() {
      return { type: 'offer', sdp: OFFER_SDP }
    },
    async accept() {
      return { type: 'answer', sdp: OFFER_SDP }
    },
    async acceptAnswer() {},
    async addRemoteCandidate(peerId: string, candidate: unknown) {
      calls.push({ peerId, candidate })
    },
    close() {},
    resetPeer() {},
  }
  const mesh = createMesh({
    localId: 'p2',
    plane: plane as never,
    timers: NO_TIMERS as never,
    send: () => {},
  })
  return { mesh, calls }
}

async function openLink(mesh: ReturnType<typeof createMesh>): Promise<void> {
  // localId 'p2' > pair 'p1' : on est answerer, on attend l'offre entrante.
  await mesh.onSignal({ kind: 'peer-joined', peerId: 'p1', name: 'a' } as SignalIn)
  await mesh.onSignal({ kind: 'offer', from: 'p1', payload: { type: 'offer', sdp: OFFER_SDP } } as SignalIn)
}

const LINE = 'candidate:1 1 UDP 2122260223 192.168.1.20 54321 typ host'

test('un candidat ICE en ligne SDP nue est remballé et remis au plan média', async () => {
  const { mesh, calls } = harness()
  await openLink(mesh)
  await mesh.onSignal({ kind: 'ice', from: 'p1', payload: LINE } as unknown as SignalIn)
  assert.equal(calls.length, 1, 'la ligne nue doit arriver au plan média (remballée)')
  assert.deepEqual(calls[0], { peerId: 'p1', candidate: { candidate: LINE } })
})

test('une ligne vide compte pour la fin de ramassage (null), pas pour une ordure', async () => {
  const { mesh, calls } = harness()
  await openLink(mesh)
  await mesh.onSignal({ kind: 'ice', from: 'p1', payload: '   ' } as unknown as SignalIn)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.candidate, null)
})

test('une chaîne qui n\u2019est pas une ligne candidate reste REFUSÉE (contrat A6)', async () => {
  const { mesh, calls } = harness()
  await openLink(mesh)
  await mesh.onSignal({ kind: 'ice', from: 'p1', payload: 'n\u2019importe quoi' } as unknown as SignalIn)
  await mesh.onSignal({ kind: 'ice', from: 'p1', payload: 42 } as unknown as SignalIn)
  assert.equal(calls.length, 0, 'aucune ordure ne doit atteindre le plan média')
})
