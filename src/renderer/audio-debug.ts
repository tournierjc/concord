/**
 * audio-debug.ts — journal de latence, une ligne toutes les 2 s.
 *
 * Armé seulement si `CONCORD_AUDIO_DEBUG=1` (le process principal pose
 * `__CONCORD_AUDIO_DEBUG__` avant l'entrée en salon). La ligne part en
 * `console.warn` : le process ne remonte que les niveaux warning et error,
 * donc elle apparaît sur stderr de l'AppImage et de l'exe Windows.
 *
 * À lire sur les DEUX machines. Un `baseLatencyMs` / `outputLatencyMs` de
 * l'ordre de la seconde sur le Linux est un tampon de capture ou de contexte.
 * Un `jitterBufferMs` de l'ordre de la seconde sur le Windows est le tampon
 * de gigue du récepteur. `characterFrames: null` veut dire que le preset
 * (none, robot, radio) ne passe pas par le processeur de timbre.
 */

import type { MediaLatencyReport } from '../engine/rtc/media-config.ts'

/** Période du journal. Le battement passe par `browser-beat.ts`, pas par un timer brut. */
export const AUDIO_DEBUG_PERIOD_MS = 2000

export function concordAudioDebugEnabled(): boolean {
  if (Reflect.get(globalThis, '__CONCORD_AUDIO_DEBUG__') === true) return true
  const proc = Reflect.get(globalThis, 'process')
  if (typeof proc !== 'object' || proc === null) return false
  const env = Reflect.get(proc, 'env')
  if (typeof env !== 'object' || env === null) return false
  return Reflect.get(env, 'CONCORD_AUDIO_DEBUG') === '1'
}

export interface AudioDebugPeerMemory {
  readonly energy: number | null
  readonly samples: number | null
}

export interface AudioDebugMemory {
  readonly atMs: number
  readonly peers: ReadonlyMap<string, AudioDebugPeerMemory>
}

export interface AudioDebugLineInput {
  readonly nowMs: number
  readonly report: MediaLatencyReport
  /** La porte est synchrone : 0. Le timbre poste sa file, `null` s'il n'est pas dans le graphe. */
  readonly noiseGateFrames: number
  readonly characterFrames: number | null
  readonly previous: AudioDebugMemory | null
}

function msFromSec(seconds: number | null): number | null {
  if (seconds === null || !Number.isFinite(seconds)) return null
  return Math.round(seconds * 10000) / 10
}

function delta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null
  const diff = current - previous
  if (!Number.isFinite(diff)) return null
  return Math.round(diff * 1000) / 1000
}

/**
 * Une ligne `[concord-audio] {…}`. `memory` est à repasser au tour suivant pour
 * les deltas d'énergie (le moment où le micro émet, pas seulement le niveau cumulé).
 */
export function formatAudioDebugLine(input: AudioDebugLineInput): { line: string; memory: AudioDebugMemory } {
  const previous = input.previous
  const peers = new Map<string, AudioDebugPeerMemory>()
  const peerRows = input.report.peers.map((peer) => {
    const energy = peer.latency.outbound.totalAudioEnergy
    const samples = peer.latency.outbound.totalSamplesDuration
    const before = previous === null ? undefined : previous.peers.get(peer.peerId)
    peers.set(peer.peerId, { energy, samples })
    return {
      id: peer.peerId,
      jitterBufferTargetMs: peer.jitterBufferTargetMs,
      playoutDelayHintSec: peer.playoutDelayHintSec,
      jitterBufferDelaySec: peer.latency.inbound.jitterBufferDelaySec,
      jitterBufferEmittedCount: peer.latency.inbound.jitterBufferEmittedCount,
      jitterBufferMs: peer.latency.inbound.jitterBufferMs,
      packetsLost: peer.latency.inbound.packetsLost,
      roundTripTimeSec: peer.latency.remoteInbound.roundTripTimeSec,
      candidateRttSec: peer.latency.candidateRttSec,
      totalAudioEnergy: energy,
      totalSamplesDuration: samples,
      energyDelta: delta(energy, before === undefined ? null : before.energy),
      samplesDelta: delta(samples, before === undefined ? null : before.samples),
    }
  })
  const clock = input.report.clock
  const body = {
    nowMs: Math.round(input.nowMs),
    dtMs: previous === null ? null : Math.round(input.nowMs - previous.atMs),
    sendOpen: input.report.sendOpen,
    clock: {
      sampleRate: clock.sampleRate,
      baseLatencyMs: msFromSec(clock.baseLatencySec),
      outputLatencyMs: msFromSec(clock.outputLatencySec),
      state: clock.state,
      captureSampleRate: clock.captureSampleRate,
      captureChannels: clock.captureChannels,
    },
    worklet: {
      noiseGateFrames: input.noiseGateFrames,
      characterFrames: input.characterFrames,
    },
    peers: peerRows,
  }
  return {
    line: `[concord-audio] ${JSON.stringify(body)}`,
    memory: { atMs: input.nowMs, peers },
  }
}
