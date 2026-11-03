/**
 * Verrou (bogue A revendiqué, 2026-11-04) : la piste distante livrée par `pc.ontrack` DOIT
 * traverser le plan média jusqu'au maillage et publier `connected` PENDANT le flux.
 *
 * Le banc deux postes montrait l'état du pair figé à `connecting(ice)` puis `noFlow(timeout)`
 * alors que l'audio coulait (RTP en hausse continue). La cause observée : la preuve de piste
 * (`'track'`) n'atteignait pas le maillage — l'état ne peut donc plus jamais dire « connecté »
 * pendant que le son passe. Ce test scelle la chaîne complète sans réseau :
 *
 *   pc.ontrack  →  plane.o.onRemoteStream(peerId, stream)  →  mesh.onRemoteStream  →
 *   proveFlow('track')  →  notify('connected', 'ice')
 *
 * avec le PEER QUI PORTE LA PISTE : un flux reçu par la pc du pair `b` ne doit jamais nommer
 * `c` (la leçon AD-17/D3, verrouillée ici côté propagation).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  FakePeerConnection,
  FakeMediaStream,
  FakeAudioContext,
  FakeTrack,
} from './fake-rtc.ts'

import { createMediaPlane } from '../src/engine/rtc/media-plane.ts'
import { createMesh } from '../src/engine/net/mesh.ts'

function timers() {
  return {
    once: (ms: number, cb: () => void) => setTimeout(cb, ms),
    cancel: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
  }
}

function installStubs(): () => void {
  const names = ['RTCPeerConnection', 'MediaStream', 'AudioContext', 'navigator']
  const saved = new Map<string, PropertyDescriptor | undefined>()
  for (const name of names) saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  const define = (name: string, value: unknown): void => {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
  }
  define('RTCPeerConnection', FakePeerConnection)
  define('MediaStream', FakeMediaStream)
  define('AudioContext', FakeAudioContext)
  define('navigator', { mediaDevices: { getUserMedia: async () => new FakeMediaStream([new FakeTrack()]) } })
  return (): void => {
    for (const name of names) {
      const descriptor = saved.get(name)
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, name)
      else Object.defineProperty(globalThis, name, descriptor)
    }
  }
}

function peerAt(index: number): FakePeerConnection {
  const peer = FakePeerConnection.instances[index]
  if (peer === undefined) throw new Error(`aucune RTCPeerConnection en position ${String(index)}`)
  return peer
}

test('pc.ontrack du pair b : la piste traverse le plan jusqu’au maillage et publie connected PENDANT le flux', async () => {
  const restore = installStubs()
  FakePeerConnection.instances = []
  try {
    const states: Array<{ peerId: string; state: string; cause: string }> = []
    let mesh: ReturnType<typeof createMesh> | null = null
    const plane = createMediaPlane({
      localId: 'a',
      timers: timers(),
      onLocalCandidate: () => {},
      // Cablage identique a voice-mesh.ts (l'app) : le plan relaie la piste AU maillage.
      onRemoteStream: (peerId, stream) => { mesh?.onRemoteStream(peerId, stream) },
    })
    const created = createMesh({
      localId: 'a',
      plane,
      timers: timers(),
      send: () => {},
      onPeerState: (peerId, state, cause) => { states.push({ peerId, state, cause }) },
    })
    mesh = created
    await mesh.onSignal({ kind: 'peer-joined', peerId: 'b', name: 'b' })
    const pcB = peerAt(0)
    pcB.finishGathering()
    // L'état est encore connecting: ni SDP fini, ni piste = pas de preuve.
    assert.deepEqual(
      states.filter((s) => s.state === 'connected'),
      [],
      'avant toute preuve, jamais connected',
    )
    // La piste distante ARRIVE par la pc de b — c'est l'événement pc.ontrack du vrai Chromium.
    const stream = new FakeMediaStream([new FakeTrack()])
    if (pcB.ontrack === null) throw new Error('le plan na pas branche pc.ontrack — la piste ne peut jamais etre livree')
    pcB.ontrack({ streams: [stream], track: { kind: 'audio', readyState: 'live' } })
    assert.deepEqual(
      states.filter((s) => s.state === 'connected'),
      [{ peerId: 'b', state: 'connected', cause: 'ice' }],
      'la piste recue par la pc de b publie connected (cause ice) pour b',
    )
  } finally {
    restore()
  }
})
