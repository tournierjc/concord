/**
 * Verrou (bogue B, 2026-11-04) : les candidats distants arrivés AVANT `setRemoteDescription`
 * sont mis en file puis déversés par `flushPending`. Quand la ligne SDP nue est remballée sans
 * `sdpMid`/`sdpMLineIndex` (voie câble textuel : `parseCandidate` string → `{ candidate }`),
 * Chromium rejette chaque ajout — « Candidate missing values for both sdpMid and
 * sdpMLineIndex » — et les 4 candidats host initiaux sont perdus (le lien ne tient plus que
 * par les prflx). Le vidage de la file REBÂTIT donc les deux champs depuis la description
 * distante : `sdpMLineIndex` = index de la media-section `m=audio`, `sdpMid` = son `a=mid:`
 * s'il existe, sinon `undefined` (Chromium accepte l'index seul). Sans description distante,
 * la file attend — rien n'est envoyé sans coordonnées.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  FakePeerConnection,
  FakeMediaStream,
  FakeAudioContext,
} from './fake-rtc.ts'
import { createMediaPlane } from '../src/engine/rtc/media-plane.ts'

const SDP_TWO_MEDIAS = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'm=video 9 UDP/TLS/RTP/SAVPF 96',
  'c=IN IP4 0.0.0.0',
  'a=mid:video0',
  'a=rtpmap:96 VP8/90000',
  'a=sendrecv',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'c=IN IP4 0.0.0.0',
  'a=mid:1',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=sendrecv',
  '',
].join('\r\n')

const SDP_ONE_MEDIA_NO_MID = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'c=IN IP4 0.0.0.0',
  'a=rtpmap:111 opus/48000/2',
  'a=sendrecv',
  '',
].join('\r\n')

const CAND_A = 'candidate:1 1 udp 2122260223 192.168.1.42 54321 typ host generation 0'
const CAND_B = 'candidate:2 1 udp 2122260223 192.168.1.43 54321 typ host generation 0'

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
  define('navigator', { mediaDevices: { getUserMedia: async () => new FakeMediaStream([]) } })
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

test('file de candidats sans sdpMid/sdpMLineIndex : le flush les rebâtit depuis le SDP distant (m=audio à l’index 1, a=mid repris)', async () => {
  const restore = installStubs()
  FakePeerConnection.instances = []
  try {
    const plane = createMediaPlane({ localId: 'A', timers: timers(), onLocalCandidate: () => {} })
    const pendingOffer = plane.attach('b')
    peerAt(0).finishGathering()
    await pendingOffer
    await plane.addRemoteCandidate('b', { candidate: CAND_A })
    await plane.addRemoteCandidate('b', { candidate: CAND_B })
    assert.equal(peerAt(0).addedCandidates.length, 0, 'rien ne part avant la description distante')
    await plane.accept('b', { type: 'offer', sdp: SDP_TWO_MEDIAS })
    const added = peerAt(0).addedCandidates
    assert.equal(added.length, 2, 'les deux candidats en file doivent être déversés')
    for (const c of added) {
      assert.equal(c['sdpMLineIndex'], 1, 'sdpMLineIndex rebâti = index de la section m=audio')
      assert.equal(c['sdpMid'], '1', 'sdpMid rebâti = a=mid: de la section m=audio')
    }
  } finally {
    restore()
  }
})

test('file de candidats, SDP distant sans a=mid : sdpMLineIndex rebâti, sdpMid laissé absent (jamais une chaîne inventée)', async () => {
  const restore = installStubs()
  FakePeerConnection.instances = []
  try {
    const plane = createMediaPlane({ localId: 'A', timers: timers(), onLocalCandidate: () => {} })
    const pendingOffer = plane.attach('b')
    peerAt(0).finishGathering()
    await pendingOffer
    await plane.addRemoteCandidate('b', { candidate: CAND_A })
    await plane.accept('b', { type: 'offer', sdp: SDP_ONE_MEDIA_NO_MID })
    const added = peerAt(0).addedCandidates
    assert.equal(added.length, 1)
    assert.equal(added[0]?.['sdpMLineIndex'], 0)
    const mid = added[0]?.['sdpMid']
    assert.ok(mid === undefined || mid === null, 'pas de mid inventé quand le SDP n’en porte aucun')
  } finally {
    restore()
  }
})
