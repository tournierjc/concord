/**
 * tests/vad-transmit.node.test.ts — la détection de voix émet sans basculer de mode.
 *
 * Défaut (0.4.28, toujours là après le pont de 0.4.26) : le vumètre bouge et
 * l'indicateur s'allume, mais le gain d'émission reste fermé jusqu'à
 * « Détection de voix → Appuyer pour parler → Détection de voix ».
 *
 * La chaîne exercée ici est la VRAIE (`createVoiceFilterChain` → pont →
 * destination), pas une doublure qui se contente d'enregistrer `setSendOpen`.
 * Aucun test ne rappelle `setVoiceTalkMode` : le son doit partir du premier join.
 */

import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { createMediaPlane, type MediaPlane } from '../src/engine/rtc/media-plane.ts'
import type { VoiceFilterId } from '../src/engine/rtc/voice-filters.ts'
import { NO_TIMERS } from '../src/engine/timers.ts'
import { createVoiceFilterChain, type FilterAudioContext } from '../src/renderer/voice-filter.ts'
import { defaultSettings } from '../src/shell/settings-schema.ts'
import type { SignalIn } from '../src/engine/net/mesh.ts'
import type { MeterBeatDriver } from '../src/renderer/peer-speech.ts'
import {
  FakeAudioContext,
  FakeAudioNode,
  FakeGain,
  installFakeDom,
  type FakeDom,
  type FakeMediaStreamSourceNode,
} from './fake-rtc.ts'

function reaches(from: FakeAudioNode, target: FakeAudioNode, seen = new Set<FakeAudioNode>()): boolean {
  if (from === target) return true
  if (seen.has(from)) return false
  seen.add(from)
  return from.outgoing.some((next) => next instanceof FakeAudioNode && reaches(next, target, seen))
}

function contextOf(): FakeAudioContext {
  const context = FakeAudioContext.instances[0]
  assert.ok(context !== undefined, 'le micro ouvre un AudioContext')
  return context
}

/** Le gain branché sur la destination des pairs — le seul levier d'émission. */
function sendBridge(context: FakeAudioContext): FakeGain {
  const destination = context.created.destinations[0]
  assert.ok(destination !== undefined, 'une destination MediaStream')
  const bridges = context.created.gains.filter((gain) => gain.outgoing.includes(destination))
  assert.equal(bridges.length, 1, 'un seul pont vers la destination')
  const bridge = bridges[0]
  assert.ok(bridge !== undefined)
  return bridge
}

function feedingSource(context: FakeAudioContext, bridge: FakeGain): FakeMediaStreamSourceNode {
  const source = context.created.sources.find((node) => reaches(node, bridge))
  assert.ok(source !== undefined, 'le micro alimente le pont')
  return source
}

/** Fabrique réelle : le plan ne voit pas un espion de gain. */
function realChain(context: unknown, stream: MediaStream, id: VoiceFilterId) {
  return createVoiceFilterChain(context as FilterAudioContext, stream, id, {
    inputGain: 1,
    noiseGate: true,
    noiseGateThresholdDb: -40,
  })
}

async function flush(): Promise<void> {
  for (let i = 0; i < 16; i += 1) await Promise.resolve()
}

function silentBeat(): MeterBeatDriver {
  return {
    now: () => 0,
    start() {
      return () => undefined
    },
  }
}

describe('VAD — le gain courant laisse passer la parole, sans basculer de mode', () => {
  let dom: FakeDom

  afterEach(() => {
    dom.restore()
  })

  async function vadPlane(): Promise<MediaPlane> {
    dom = installFakeDom()
    const plane = createMediaPlane({
      localId: 'a',
      timers: NO_TIMERS,
      microOpenOnStart: true,
      voiceFilter: 'none',
      voiceChainFactory: realChain,
    })
    // Relâchement arrivé AVANT le graphe (bouton, contrôle encore en PTT).
    // La VAD est déjà ouverte : elle ne renverra pas de front.
    plane.setTransmitting(false)
    await plane.startMicrophone()
    return plane
  }

  it('join en VAD : la parole traverse le pont et le pair reçoit la piste', async () => {
    const plane = await vadPlane()
    await plane.attach('b')
    const context = contextOf()
    const bridge = sendBridge(context)
    const destination = context.created.destinations[0]
    assert.ok(destination !== undefined)
    const sent = destination.stream.getAudioTracks()[0]
    assert.equal(bridge.gain.value, 1, 'le gain d’émission est ouvert')
    assert.equal(reaches(feedingSource(context, bridge), bridge), true)
    assert.equal(dom.peerAt(0).senders[0]?.track, sent, 'le pair a la piste de la destination')
    assert.equal(sent?.enabled, true, 'la piste reste enabled (le silence serait le gain)')
    plane.close()
  })

  it('changer de filtre ne referme pas le gain et garde la même piste', async () => {
    const plane = await vadPlane()
    await plane.attach('b')
    const before = contextOf()
    const destination = before.created.destinations[0]
    assert.ok(destination !== undefined)
    const sent = destination.stream.getAudioTracks()[0]
    plane.setVoiceFilter('woman')
    plane.setVoiceFilter('none')
    const bridge = sendBridge(contextOf())
    assert.equal(bridge.gain.value, 1, 'après le filtre, la VAD ouverte émet encore')
    assert.equal(contextOf().created.destinations.length, 1)
    assert.equal(destination.stream.getAudioTracks()[0], sent)
    assert.equal(dom.peerAt(0).senders[0]?.track, sent)
    assert.equal(reaches(feedingSource(contextOf(), bridge), bridge), true)
    plane.close()
  })

  it('changer de micro réécrit l’intention sur le gain courant, le pair garde la piste', async () => {
    const plane = await vadPlane()
    await plane.attach('b')
    const firstMic = dom.micTracks[0]
    await plane.replaceMicrophone({
      channelCount: 1,
      deviceId: 'casque-2',
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
    })
    const context = contextOf()
    const bridge = sendBridge(context)
    const destination = context.created.destinations[0]
    assert.ok(destination !== undefined)
    const sent = destination.stream.getAudioTracks()[0]
    const source = feedingSource(context, bridge)
    const fed = source.stream.getAudioTracks()[0]
    assert.notEqual(fed, firstMic, 'la source lit le nouveau micro')
    assert.equal(fed, dom.micTracks[1])
    assert.equal(bridge.gain.value, 1, 'la VAD ouverte émet sur le nouveau micro')
    assert.equal(dom.peerAt(0).senders[0]?.track, sent, 'pas de renégociation : même piste')
    const audio = dom.gumCalls[1]?.['audio']
    assert.equal(
      typeof audio === 'object' && audio !== null && 'deviceId' in audio && audio.deviceId,
      'casque-2',
    )
    plane.close()
  })

  it('un pair qui arrive après reçoit la piste, gain ouvert, sans nouveau front de mode', async () => {
    const plane = await vadPlane()
    await plane.attach('b')
    await plane.attach('c')
    const context = contextOf()
    const bridge = sendBridge(context)
    const destination = context.created.destinations[0]
    assert.ok(destination !== undefined)
    const sent = destination.stream.getAudioTracks()[0]
    assert.equal(bridge.gain.value, 1)
    assert.equal(dom.peerAt(0).senders[0]?.track, sent)
    assert.equal(dom.peerAt(1).senders[0]?.track, sent, 'le second pair reçoit la même piste ouverte')
    plane.close()
  })
})

describe('VAD — la session (join réel) ne se ferme pas au relâchement du bouton', () => {
  let dom: FakeDom
  let restoreVoice: (() => void) | null = null

  afterEach(async () => {
    if (restoreVoice !== null) {
      const close = restoreVoice
      restoreVoice = null
      await close()
    }
    dom?.restore()
    Reflect.deleteProperty(globalThis, 'lanAPI')
  })

  it('ouvre en VAD, un pair rejoint, le bouton relâché : le gain reste ouvert', async () => {
    dom = installFakeDom()
    const sent: unknown[] = []
    const listeners: Array<(message: SignalIn) => void> = []
    const api = {
      sendSignal: async (message: unknown): Promise<void> => {
        sent.push(message)
      },
      onSignal: (listener: (message: SignalIn) => void): (() => void) => {
        listeners.push(listener)
        return () => {
          const index = listeners.indexOf(listener)
          if (index >= 0) listeners.splice(index, 1)
        }
      },
      setSpeaking: async (): Promise<void> => undefined,
      setDucking: async (): Promise<void> => undefined,
    }
    Object.defineProperty(globalThis, 'window', {
      value: Object.assign(globalThis, { lanAPI: api }),
      configurable: true,
      writable: true,
    })

    const voice = await import('../src/renderer/voice.ts')
    voice.closeVoice()
    const base = defaultSettings()
    voice.openVoice(
      'salon|a',
      'a',
      {
        audio: { ...base.audio, voiceFilter: 'none', noiseGate: true },
        talk: { ...base.talk, mode: 'vad' },
      },
      { makeBeat: silentBeat },
    )
    restoreVoice = async () => {
      voice.closeVoice()
    }
    await flush()
    assert.equal(voice.voiceSnapshot().status, 'live')
    for (const listener of [...listeners]) {
      listener({ kind: 'peer-joined', peerId: 'b', name: 'Bob' })
    }
    await flush()

    const context = contextOf()
    const bridge = sendBridge(context)
    const destination = context.created.destinations[0]
    assert.ok(destination !== undefined)
    const sentTrack = destination.stream.getAudioTracks()[0]
    assert.equal(bridge.gain.value, 1, 'le join en VAD ouvre le gain, sans bascule de mode')
    assert.equal(reaches(feedingSource(context, bridge), bridge), true)
    assert.ok(dom.peers.length >= 1, 'le pair a une connexion')
    assert.equal(dom.peerAt(0).senders[0]?.track, sentTrack, 'il reçoit la piste filtrée')

    // Le bouton « parler » relâche toujours setTransmitting(false), même en VAD.
    voice.setTransmitting(false)
    assert.equal(sendBridge(contextOf()).gain.value, 1, 'le relâchement ne coupe pas la détection de voix')
    assert.equal(voice.voiceSnapshot().transmitting, true)

    voice.setVoiceFilter('radio')
    assert.equal(sendBridge(contextOf()).gain.value, 1, 'changer de filtre ne demande pas de rebasculer le mode')
    assert.equal(dom.peerAt(0).senders[0]?.track, sentTrack)

    await voice.replaceVoiceInput({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
      inputGain: 1,
      inputDeviceId: 'micro-bureau',
    })
    const after = contextOf()
    const bridgeAfter = sendBridge(after)
    assert.equal(bridgeAfter.gain.value, 1, 'le nouveau micro émet encore')
    assert.equal(feedingSource(after, bridgeAfter).stream.getAudioTracks()[0], dom.micTracks.at(-1))
    assert.equal(dom.peerAt(0).senders[0]?.track, sentTrack)
  })
})
