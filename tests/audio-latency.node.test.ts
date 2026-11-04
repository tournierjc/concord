/**
 * tests/audio-latency.node.test.ts — retard constant Linux → Windows (2–3 s dès la première syllabe).
 *
 * Ce n'est pas une file qui grossit : le décalage est là tout de suite et ne bouge pas.
 * Les leviers mesurés ici :
 *   • la file du timbre reste bornée même si on pousse plus vite qu'on ne lit ;
 *   • le récepteur LAN reçoit une cible de gigue basse (40–60 ms) ;
 *   • le contexte est créé en `interactive` et calé sur la sortie ;
 *   • la voix neutre ne passe pas par un processeur à tampon ;
 *   • l'émission se coupe par un gain, la piste reste enabled.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  CAPTURE_LATENCY_IDEAL_SEC,
  LAN_JITTER_BUFFER_TARGET_MS,
  OPUS_SAMPLE_RATE,
  OPUS_SDP_TARGET,
  applyLanReceiverLatency,
  jitterBufferAverageMs,
  lanReceiverLatencyConfig,
  peerLatencyFromStats,
  withOpusSdpParams,
  type MediaLatencyReport,
} from '../src/engine/rtc/media-config.ts'
import { createMediaPlane } from '../src/engine/rtc/media-plane.ts'
import { voiceFilterCharacter } from '../src/engine/rtc/voice-filters.ts'
import { NO_TIMERS } from '../src/engine/timers.ts'
import { linuxAudioBufferFrames, pulseLatencyMsec, LINUX_AUDIO_BUFFER_FRAMES, PULSE_LATENCY_MSEC } from '../src/main/audio-capture.ts'
import { AUDIO_DEBUG_PERIOD_MS, formatAudioDebugLine } from '../src/renderer/audio-debug.ts'
import {
  NOISE_GATE_ATTACK_GAIN_SEC,
  createNoiseGateState,
  processNoiseGate,
} from '../src/renderer/noise-gate.ts'
import { createVoiceFilterChain } from '../src/renderer/voice-filter.ts'
import {
  VOICE_CHARACTER_MAX_QUEUE_FRAMES,
  claimVoiceCharacterQueue,
  createVoiceCharacterState,
  noteVoiceCharacterQueue,
  processVoiceCharacter,
  releaseVoiceCharacterQueue,
  voiceCharacterQueueFrames,
  voiceCharacterQueueFramesLive,
  voiceCharacterWorkletSource,
} from '../src/renderer/voice-character.ts'
import {
  FakeAudioContext,
  FakeMediaStream,
  FakeTrack,
  OFFER_SDP,
  installFakeDom,
} from './fake-rtc.ts'

function rms(samples: Float32Array): number {
  let energy = 0
  for (let i = 0; i < samples.length; i += 1) energy += (samples[i] ?? 0) * (samples[i] ?? 0)
  return Math.sqrt(energy / Math.max(1, samples.length))
}

function tone(length: number, offset: number): Float32Array {
  const frame = new Float32Array(length)
  for (let i = 0; i < length; i += 1) {
    frame[i] = 0.2 * Math.sin((2 * Math.PI * 180 * (offset + i)) / 48000)
  }
  return frame
}

describe('file du timbre — un écart de cadence ne s’accumule pas', () => {
  const spec = voiceFilterCharacter('woman')

  it('en cadence égale, la file reste celle du grain (bien sous le plafond)', () => {
    assert.ok(spec !== null)
    const state = createVoiceCharacterState(48000, spec)
    let peak = 0
    for (let block = 0; block < 120; block += 1) {
      const input = tone(128, block * 128)
      const output = new Float32Array(128)
      processVoiceCharacter(state, input, output)
      const frames = voiceCharacterQueueFrames(state)
      if (frames > peak) peak = frames
      assert.ok(frames <= VOICE_CHARACTER_MAX_QUEUE_FRAMES, `bloc ${block} : ${frames} trames`)
    }
    assert.ok(peak > 0, 'le grain a bien une file, elle n’est pas absente')
    assert.ok(peak <= 24, `en cadence égale la file ne doit pas coller au plafond (${peak})`)
  })

  it('entrée deux fois plus vite que la sortie : la file ne dépasse pas N trames', () => {
    assert.ok(spec !== null)
    const state = createVoiceCharacterState(48000, spec)
    let peak = 0
    for (let block = 0; block < 80; block += 1) {
      const input = tone(256, block * 256)
      const output = new Float32Array(128)
      processVoiceCharacter(state, input, output)
      const frames = voiceCharacterQueueFrames(state)
      if (frames > peak) peak = frames
      assert.ok(
        frames <= VOICE_CHARACTER_MAX_QUEUE_FRAMES,
        `bloc ${block} : ${frames} trames > ${VOICE_CHARACTER_MAX_QUEUE_FRAMES}`,
      )
    }
    assert.ok(peak >= VOICE_CHARACTER_MAX_QUEUE_FRAMES - 4, `la borne doit tenir la file (${peak})`)
  })
})

describe('récepteur LAN — cible de gigue basse', () => {
  it('la cible est entre 40 et 60 ms, et le hint de lecture est la même durée en secondes', () => {
    const config = lanReceiverLatencyConfig()
    assert.ok(config.jitterBufferTargetMs >= 40 && config.jitterBufferTargetMs <= 60)
    assert.equal(config.jitterBufferTargetMs, LAN_JITTER_BUFFER_TARGET_MS)
    assert.equal(config.playoutDelayHintSec, LAN_JITTER_BUFFER_TARGET_MS / 1000)
    const receiver: { jitterBufferTarget?: number; playoutDelayHint?: number } = {}
    applyLanReceiverLatency(receiver)
    assert.equal(receiver.jitterBufferTarget, LAN_JITTER_BUFFER_TARGET_MS)
    assert.equal(receiver.playoutDelayHint, LAN_JITTER_BUFFER_TARGET_MS / 1000)
  })

  it('le plan média pose cette cible dès l’arrivée de la piste', async () => {
    const dom = installFakeDom()
    try {
      const plane = createMediaPlane({ localId: 'linux', timers: NO_TIMERS })
      await plane.startMicrophone()
      await plane.attach('windows')
      const remote = new FakeTrack('distant')
      dom.fireTrack(dom.peerAt(0), new FakeMediaStream([remote]), remote)
      const receiver = dom.peerAt(0).lastReceiver
      assert.ok(receiver !== null, 'ontrack doit exposer un récepteur')
      assert.equal(receiver.jitterBufferTarget, LAN_JITTER_BUFFER_TARGET_MS)
      assert.equal(receiver.playoutDelayHint, LAN_JITTER_BUFFER_TARGET_MS / 1000)
      plane.close()
    } finally {
      dom.restore()
    }
  })
})

describe('émetteur — contexte interactif, pas le tampon long', () => {
  it('AudioContext : latencyHint interactive, 48 kHz, gain muet sur la sortie', async () => {
    const dom = installFakeDom()
    try {
      const plane = createMediaPlane({ localId: 'linux', timers: NO_TIMERS })
      await plane.startMicrophone()
      const context = FakeAudioContext.instances[0]
      assert.ok(context !== undefined, 'le micro ouvre un AudioContext')
      assert.equal(context.options.latencyHint, 'interactive')
      assert.equal(context.options.sampleRate, OPUS_SAMPLE_RATE)
      const pace = context.created.gains.find((gain) => gain.gain.value === 0)
      assert.ok(pace !== undefined, 'un gain muet cale l’horloge')
      assert.equal(pace.outgoing.includes(context.destination), true)
      plane.close()
    } finally {
      dom.restore()
    }
  })

  it('getUserMedia demande une latence de capture courte, en idéal', () => {
    assert.equal(CAPTURE_LATENCY_IDEAL_SEC, 0.01)
  })
})

describe('voix neutre — pas de processeur à tampon', () => {
  it('none, robot et radio ne déplacent pas le timbre (pas de file de grain)', () => {
    assert.equal(voiceFilterCharacter('none'), null)
    assert.equal(voiceFilterCharacter('robot'), null)
    assert.equal(voiceFilterCharacter('radio'), null)
    assert.ok(voiceFilterCharacter('woman') !== null)
  })

  it('none sans porte ne charge aucun AudioWorklet', () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'MediaStream')
    Object.defineProperty(globalThis, 'MediaStream', { value: FakeMediaStream, configurable: true, writable: true })
    try {
      const context = new FakeAudioContext()
      const chain = createVoiceFilterChain(context, new FakeMediaStream([new FakeTrack('micro')]), 'none')
      assert.equal(context.workletModuleLoads, 0, 'none ne charge ni timbre ni pitch')
      chain.setSendOpen(false)
      const destination = context.created.destinations[0]
      assert.ok(destination !== undefined)
      const bridge = context.created.gains.find((gain) => gain.outgoing.includes(destination))
      assert.ok(bridge !== undefined)
      assert.equal(bridge.gain.value, 0, 'le silence est le gain, pas une file')
      chain.setSendOpen(true)
      assert.equal(bridge.gain.value, 1)
      chain.applyFilter('robot')
      chain.setSendOpen(false)
      chain.applyFilter('none')
      assert.equal(bridge.gain.value, 0, 'changer de voix ne rouvre pas un micro coupé')
      chain.close()
    } finally {
      if (saved === undefined) Reflect.deleteProperty(globalThis, 'MediaStream')
      else Object.defineProperty(globalThis, 'MediaStream', saved)
    }
  })
})

describe('émission — la piste reste enabled, le gain ferme', () => {
  it('avec un gain d’émission, setTransmitting ne coupe pas track.enabled', async () => {
    const dom = installFakeDom()
    const dest = new FakeTrack('destination')
    const sends: boolean[] = []
    try {
      const plane = createMediaPlane({
        localId: 'linux',
        timers: NO_TIMERS,
        voiceChainFactory: () => ({
          current: 'none',
          track: dest as unknown as MediaStreamTrack,
          applyFilter() {
            return dest as unknown as MediaStreamTrack
          },
          setSendOpen(open: boolean) {
            sends.push(open)
          },
          close() {
            return undefined
          },
        }),
      })
      await plane.startMicrophone()
      assert.equal(dest.enabled, true, 'au repos la piste envoyée reste ouverte')
      assert.deepEqual(sends, [false], 'le repos ferme le gain')
      assert.equal(dom.micTrack().enabled, true, 'la capture reste ouverte')
      plane.setTransmitting(true)
      plane.setTransmitting(false)
      assert.equal(dest.enabled, true)
      assert.deepEqual(sends, [false, true, false])
      const writes = dest.enabledWrites
      assert.ok(writes.every((value) => value === true), `aucune fermeture de piste : ${writes.join(',')}`)
      plane.close()
    } finally {
      dom.restore()
    }
  })
})

describe('porte — attaque courte, pas de préremplissage', () => {
  it('les 20 premières millisecondes d’une voix forte sont déjà audibles', () => {
    assert.ok(NOISE_GATE_ATTACK_GAIN_SEC <= 0.005)
    const n = Math.round(48000 * 0.02)
    const input = tone(n, 0)
    const output = new Float32Array(n)
    processNoiseGate(createNoiseGateState(48000, -40), input, output)
    const level = rms(output)
    assert.ok(level > 0.05, `attaque trop longue, les 20 ms sortent à ${level}`)
  })
})

describe('Opus — pas de DTX, le flux ne s’endort pas entre deux mots', () => {
  it('le fmtp porte usedtx=0 sans retirer le FEC ni le débit', () => {
    assert.match(OPUS_SDP_TARGET, /usedtx=0/)
    assert.match(OPUS_SDP_TARGET, /useinbandfec=1/)
    const sdp = withOpusSdpParams(OFFER_SDP)
    assert.match(sdp, /usedtx=0/)
    assert.match(sdp, /maxaveragebitrate=32000;stereo=0;useinbandfec=1/)
  })
})

describe('Linux — tampon Pulse et tampon Chromium', () => {
  it('Linux sans variable reçoit 20 ms ; une valeur utilisateur et Windows ne sont pas écrasés', () => {
    assert.equal(pulseLatencyMsec('linux', undefined), PULSE_LATENCY_MSEC)
    assert.equal(pulseLatencyMsec('linux', ''), PULSE_LATENCY_MSEC)
    assert.equal(pulseLatencyMsec('linux', '40'), null)
    assert.equal(pulseLatencyMsec('win32', undefined), null)
    assert.equal(linuxAudioBufferFrames('linux'), LINUX_AUDIO_BUFFER_FRAMES)
    assert.equal(linuxAudioBufferFrames('win32'), null)
    assert.equal(LINUX_AUDIO_BUFFER_FRAMES, '960')
  })
})

describe('journal CONCORD_AUDIO_DEBUG', () => {
  it('la période est 2 s et la ligne porte les champs de latence des deux bouts', () => {
    assert.equal(AUDIO_DEBUG_PERIOD_MS, 2000)
    const reading = peerLatencyFromStats([
      {
        type: 'inbound-rtp',
        kind: 'audio',
        jitterBufferDelay: 1200,
        jitterBufferEmittedCount: 48000,
        packetsLost: 4,
      },
      { type: 'outbound-rtp', kind: 'audio', bytesSent: 800 },
      { type: 'media-source', kind: 'audio', totalAudioEnergy: 1.5, totalSamplesDuration: 2 },
      { type: 'remote-inbound-rtp', kind: 'audio', roundTripTime: 0.011, packetsLost: 1 },
      { type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 0.009 },
      { type: 'inbound-rtp', kind: 'video', jitterBufferDelay: 999, jitterBufferEmittedCount: 1, packetsLost: 50 },
    ])
    assert.equal(jitterBufferAverageMs(1200, 48000), 25)
    assert.equal(reading.inbound.jitterBufferMs, 25)
    assert.equal(reading.inbound.packetsLost, 4)
    assert.equal(reading.outbound.totalAudioEnergy, 1.5)
    assert.equal(reading.outbound.totalSamplesDuration, 2)
    assert.equal(reading.remoteInbound.roundTripTimeSec, 0.011)
    assert.equal(reading.candidateRttSec, 0.009)
    const report: MediaLatencyReport = {
      clock: {
        sampleRate: 48000,
        baseLatencySec: 0.008,
        outputLatencySec: 0.02,
        state: 'running',
        captureSampleRate: 48000,
        captureChannels: 1,
      },
      sendOpen: true,
      peers: [
        {
          peerId: 'windows',
          jitterBufferTargetMs: 50,
          playoutDelayHintSec: 0.05,
          latency: reading,
        },
      ],
    }
    const first = formatAudioDebugLine({
      nowMs: 1000,
      report,
      noiseGateFrames: 0,
      characterFrames: null,
      previous: null,
    })
    assert.ok(first.line.startsWith('[concord-audio] '))
    const parsed = JSON.parse(first.line.slice('[concord-audio] '.length)) as {
      clock: { baseLatencyMs: number; outputLatencyMs: number; captureSampleRate: number }
      worklet: { noiseGateFrames: number; characterFrames: number | null }
      peers: Array<{
        jitterBufferDelaySec: number
        jitterBufferEmittedCount: number
        jitterBufferMs: number
        packetsLost: number
        roundTripTimeSec: number
        totalAudioEnergy: number
        energyDelta: number | null
        samplesDelta: number | null
      }>
    }
    assert.equal(parsed.clock.baseLatencyMs, 8)
    assert.equal(parsed.clock.outputLatencyMs, 20)
    assert.equal(parsed.clock.captureSampleRate, 48000)
    assert.equal(parsed.worklet.noiseGateFrames, 0)
    assert.equal(parsed.worklet.characterFrames, null)
    const peer = parsed.peers[0]
    assert.ok(peer !== undefined)
    assert.equal(peer.jitterBufferDelaySec, 1200)
    assert.equal(peer.jitterBufferEmittedCount, 48000)
    assert.equal(peer.jitterBufferMs, 25)
    assert.equal(peer.packetsLost, 4)
    assert.equal(peer.roundTripTimeSec, 0.011)
    assert.equal(peer.totalAudioEnergy, 1.5)
    assert.equal(peer.energyDelta, null)
    const second = formatAudioDebugLine({
      nowMs: 3000,
      report: {
        ...report,
        peers: [
          {
            peerId: 'windows',
            jitterBufferTargetMs: 50,
            playoutDelayHintSec: 0.05,
            latency: {
              ...reading,
              outbound: { ...reading.outbound, totalAudioEnergy: 2.25, totalSamplesDuration: 4 },
            },
          },
        ],
      },
      noiseGateFrames: 0,
      characterFrames: 11,
      previous: first.memory,
    })
    const again = JSON.parse(second.line.slice('[concord-audio] '.length)) as {
      dtMs: number
      worklet: { characterFrames: number }
      peers: Array<{ energyDelta: number; samplesDelta: number }>
    }
    assert.equal(again.dtMs, 2000)
    assert.equal(again.worklet.characterFrames, 11)
    assert.equal(again.peers[0]?.energyDelta, 0.75)
    assert.equal(again.peers[0]?.samplesDelta, 2)
  })

  it('la file annoncée au journal suit le propriétaire du processeur, pas un message tardif', () => {
    const owner = {}
    assert.equal(voiceCharacterQueueFramesLive(), null)
    claimVoiceCharacterQueue(owner)
    noteVoiceCharacterQueue(owner, 12.2)
    assert.equal(voiceCharacterQueueFramesLive(), 12)
    noteVoiceCharacterQueue({}, 40)
    assert.equal(voiceCharacterQueueFramesLive(), 12)
    releaseVoiceCharacterQueue(owner)
    assert.equal(voiceCharacterQueueFramesLive(), null)
    noteVoiceCharacterQueue(owner, 9)
    assert.equal(voiceCharacterQueueFramesLive(), null)
  })

  it('le worklet poste sa profondeur, et le plan la relit avec l’horloge', async () => {
    const dom = installFakeDom()
    try {
      const plane = createMediaPlane({ localId: 'linux', timers: NO_TIMERS })
      await plane.startMicrophone()
      await plane.attach('windows')
      dom.peerAt(0).statEntries = [
        {
          type: 'inbound-rtp',
          kind: 'audio',
          jitterBufferDelay: 2400,
          jitterBufferEmittedCount: 48000,
          packetsLost: 0,
        },
        { type: 'media-source', kind: 'audio', totalAudioEnergy: 0.4, totalSamplesDuration: 2 },
        { type: 'remote-inbound-rtp', kind: 'audio', roundTripTime: 0.006 },
      ]
      const remote = new FakeTrack('distant')
      dom.fireTrack(dom.peerAt(0), new FakeMediaStream([remote]), remote)
      const report = await plane.audioDebugReport()
      assert.equal(report.clock.baseLatencySec, 0.008)
      assert.equal(report.clock.outputLatencySec, 0.02)
      assert.equal(report.clock.sampleRate, 48000)
      assert.equal(report.peers[0]?.jitterBufferTargetMs, LAN_JITTER_BUFFER_TARGET_MS)
      assert.equal(report.peers[0]?.latency.inbound.jitterBufferMs, 50)
      assert.equal(report.peers[0]?.latency.outbound.totalAudioEnergy, 0.4)
      assert.equal(report.peers[0]?.latency.remoteInbound.roundTripTimeSec, 0.006)
      const source = voiceCharacterWorkletSource()
      assert.match(source, /capVoiceCharacter/)
      assert.match(source, /type: 'queue'/)
      plane.close()
    } finally {
      dom.restore()
    }
  })
})
