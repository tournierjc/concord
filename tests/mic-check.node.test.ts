/**
 * tests/mic-check.node.test.ts — la machine du « Tester le micro », en Node, sans micro
 *
 * CE QUI EST EN CAUSE : le bouton de test doit prouver la capture AVANT le salon. Les
 * garanties falsifiables ici, sans navigateur :
 *   • les contraintes de capture viennent du REGISTRE (device/NS/EC/gain via
 *     `buildMicrophoneConstraints`) — pas des valeurs non sauvées d'un widget ;
 *   • la chaîne de filtrage est celle de la session (mêmes arguments, `current` relu pour
 *     l'affichage « appliqué », jamais l'intention du réglage) ;
 *   • la piste filtrée est posée sur l'hôte d'audition, et RETIRÉE à l'arrêt ;
 *   • le RMS vient de l'analyseur branché sur le micro BRUT ; `null` quand le contexte ne sait
 *     pas mesurer (absence d'affirmation, jamais un 0 qui dirait « silence mesuré ») ;
 *   • un `getUserMedia` qui lève ⇒ statut `error` + message, AUCUNE piste restée ouverte ;
 *   • `stopMicCheck` est idempotent et libère TOUT (pistes stoppées, chaîne fermée, contexte
 *     fermé, cadence désarmée, HP rendus) ;
 *   • un second `start` pendant l'écoute arrête la précédente (pas deux `<audio>` qui
 *     superposent deux voix).
 *
 *   node --test tests/mic-check.node.test.ts
 */

import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  MIC_CHECK_SPEAKING_RMS,
  micCheckSnapshot,
  startMicCheck,
  stopMicCheck,
  subscribeMicCheck,
  type MicCheckPort,
  type MicCheckSpeakerHost,
} from '../src/renderer/mic-check.ts'
import {
  FakeAudioContext,
  FakeMediaStream,
  FakeTrack,
  resetFakeAnalyserLevels,
  setFakeAnalyserLevel,
} from './fake-rtc.ts'
import { defaultSettings } from '../src/shell/settings-schema.ts'
import type { VoiceFilterId } from '../src/engine/rtc/voice-filters.ts'
import { createVoiceFilterChain, type FilterStreamLike, type VoiceFilterChain } from '../src/renderer/voice-filter.ts'

const savedMediaStream = Object.getOwnPropertyDescriptor(globalThis, 'MediaStream')
before(() => {
  Object.defineProperty(globalThis, 'MediaStream', {
    value: FakeMediaStream,
    configurable: true,
    writable: true,
  })
})
after(() => {
  if (savedMediaStream === undefined) Reflect.deleteProperty(globalThis, 'MediaStream')
  else Object.defineProperty(globalThis, 'MediaStream', savedMediaStream)
})

/* ------------------------------------------------------------------ */
/* Doubles                                                              */
/* ------------------------------------------------------------------ */

class FakeChain implements VoiceFilterChain {
  public current: VoiceFilterId
  public readonly track: MediaStreamTrack
  public closeCalls = 0
  public applied: VoiceFilterId[] = []
  public constructor(id: VoiceFilterId, track: MediaStreamTrack) {
    this.current = id
    this.track = track
  }
  public sendOpen = true
  public applyFilter(id: VoiceFilterId): MediaStreamTrack {
    this.applied.push(id)
    this.current = id
    return this.track
  }
  public setSendOpen(open: boolean): void {
    this.sendOpen = open
  }
  public replaceInput(): void {
    // Le test du micro ne change pas de périphérique en cours d'écoute.
  }
  public close(): void {
    this.closeCalls += 1
  }
}

class FakeBeat {
  public readonly armed: Array<{ ms: number; callback: () => void }> = []
  public cancelled: unknown[] = []
  public repeat(ms: number, callback: (now: number) => void): unknown {
    const entry = { ms, callback: () => callback(0) }
    this.armed.push(entry)
    return entry
  }
  public cancel(handle: unknown): void {
    this.cancelled.push(handle)
  }
  public now(): number {
    return 0
  }
  /** Joue N tours de cadence. */
  public tick(times: number): void {
    for (const entry of this.armed) {
      for (let i = 0; i < times; i += 1) entry.callback()
    }
  }
}

interface Rig {
  readonly tracks: FakeTrack[]
  readonly contexts: FakeAudioContext[]
  readonly chains: FakeChain[]
  readonly beats: FakeBeat[]
  readonly heard: MediaStreamTrack[]
  readonly silenced: number[]
  readonly port: MicCheckPort
  readonly getUserMediaCalls: MediaStreamConstraints[]
}

function rig(options: {
  failGum?: string
  withAnalyser?: boolean
} = {}): Rig {
  const tracks: FakeTrack[] = []
  const contexts: FakeAudioContext[] = []
  const chains: FakeChain[] = []
  const beats: FakeBeat[] = []
  const heard: MediaStreamTrack[] = []
  const silenced: number[] = []
  const getUserMediaCalls: MediaStreamConstraints[] = []
  const speakers: MicCheckSpeakerHost = {
    play: (track) => {
      heard.push(track)
    },
    silence: () => {
      silenced.push(1)
    },
  }
  const port: MicCheckPort = {
    getUserMedia: async (constraints) => {
      getUserMediaCalls.push(constraints)
      if (options.failGum !== undefined) throw new Error(options.failGum)
      const track = new FakeTrack('micro')
      tracks.push(track)
      const stream = new FakeMediaStream([track])
      return stream as unknown as MediaStream
    },
    createAudioContext: () => {
      const context = new FakeAudioContext()
      if (options.withAnalyser === false) {
        // Contexte sans facette de mesure : la loi AD-17 veut `null`, pas `0`. La facette est
        // OTEE à l'INSTANCE (elle vit sur le prototype — supprimer ne ferait que la masquer).
        Object.defineProperty(context, 'createAnalyser', { value: undefined, writable: true })
      }
      contexts.push(context)
      return context as unknown as import('../src/renderer/voice-filter.ts').FilterAudioContext
    },
    buildChain: (context, stream: FilterStreamLike, initial: VoiceFilterId) => {
      const chain = new FakeChain(initial, new FakeTrack('filtré') as unknown as MediaStreamTrack)
      chains.push(chain)
      void context
      void stream
      return chain
    },
    makeBeat: () => {
      const beat = new FakeBeat()
      beats.push(beat)
      return beat as unknown as import('../src/renderer/browser-beat.ts').RendererBeat
    },
    speakers,
  }
  return { tracks, contexts, chains, beats, heard, silenced, port, getUserMediaCalls }
}

function settingsLike(overrides: Partial<ReturnType<typeof defaultSettings>> = {}) {
  return { ...defaultSettings(), ...overrides }
}

/* ------------------------------------------------------------------ */

describe('mic-check — la capture porte les réglages du registre', () => {
  it('les contraintes viennent de settings.audio (device, NS, EC)', async () => {
    stopMicCheck()
    const r = rig()
    const settings = settingsLike()
    settings.audio.inputDeviceId = 'mic-42'
    settings.audio.noiseSuppression = true
    settings.audio.echoCancellation = false
    await startMicCheck(settings, r.port)
    const audio = r.getUserMediaCalls[0]?.audio
    assert.equal(typeof audio === 'object' && audio !== null ? Reflect.get(audio, 'deviceId') : undefined, 'mic-42')
    const noise = typeof audio === 'object' && audio !== null ? Reflect.get(audio, 'noiseSuppression') : undefined
    const echo = typeof audio === 'object' && audio !== null ? Reflect.get(audio, 'echoCancellation') : undefined
    assert.deepEqual(noise, { ideal: true })
    assert.deepEqual(echo, { ideal: false })
    stopMicCheck()
  })

  it('la chaîne de la session est construite avec la voix du réglage, et `applied` la RELIT', async () => {
    stopMicCheck()
    const r = rig()
    const settings = settingsLike()
    settings.audio.voiceFilter = 'radio'
    await startMicCheck(settings, r.port)
    assert.equal(r.chains.length, 1)
    const snapshot = micCheckSnapshot()
    assert.equal(snapshot.status, 'listening')
    assert.equal(snapshot.applied?.voiceFilter, 'radio', 'la voix affichée est celle du graphe')
    assert.equal(snapshot.applied?.gain, 1)
    stopMicCheck()
  })

  it('la voix RELUE du plan média prime sur le registre (voix refusée en page ⇒ le test rejoue la voix brute)', async () => {
    // Le cas réel : `setVoiceFilter` a rendu `false` (page sans capability). Le registre prétend
    // 'robot' ; les pairs entendent la voix BRUTE. Le test doit dire et jouer la vérité mesurée.
    stopMicCheck()
    const r = rig()
    const settings = settingsLike()
    settings.audio.voiceFilter = 'robot'
    await startMicCheck(settings, r.port, 'none')
    assert.equal(micCheckSnapshot().applied?.voiceFilter, 'none', 'la voix testée est celle du fil, pas celle du registre')
    stopMicCheck()
  })

  it('sans voix relue, le registre fait foi (hors session : c est l intention que openVoice appliquera)', async () => {
    stopMicCheck()
    const r = rig()
    const settings = settingsLike()
    settings.audio.voiceFilter = 'child'
    await startMicCheck(settings, r.port, undefined)
    assert.equal(micCheckSnapshot().applied?.voiceFilter, 'child')
    stopMicCheck()
  })
})

describe('mic-check — audition et mesure', () => {
  it('la piste filtrée est posée sur les HP, et rendue à l’arrêt', async () => {
    stopMicCheck()
    const r = rig()
    await startMicCheck(settingsLike(), r.port)
    assert.equal(r.heard.length, 1, 'la piste de la destination part à l’audition')
    assert.equal(r.chains[0]?.track, r.heard[0])
    stopMicCheck()
    assert.ok(r.silenced.length >= 1, 'les HP sont rendus à l’arrêt')
  })

  it('le RMS vient de l’analyseur ; un contexte sans mesure rend null, jamais 0', async () => {
    stopMicCheck()
    resetFakeAnalyserLevels()
    setFakeAnalyserLevel('micro', 0.4)
    const withMeter = rig()
    await startMicCheck(settingsLike(), withMeter.port)
    withMeter.beats[0]?.tick(1)
    const level = micCheckSnapshot().level
    // `Float32Array` : 0.4 n'y est pas exact — la comparaison tolère l'arrondi du type du DOM.
    assert.ok(level !== null && Math.abs(level - 0.4) < 1e-6, 'la barre lit le RMS POSÉ sur la piste micro (chaîne analyseur entière)')
    stopMicCheck()
    resetFakeAnalyserLevels()

    const blind = rig({ withAnalyser: false })
    await startMicCheck(settingsLike(), blind.port)
    blind.beats[0]?.tick(1)
    assert.equal(micCheckSnapshot().level, null, 'aucune mesure est une absence d’affirmation')
    stopMicCheck()
  })

  it('le seuil « capte » est dans (0..1) et sert à la barre', () => {
    assert.ok(MIC_CHECK_SPEAKING_RMS > 0 && MIC_CHECK_SPEAKING_RMS < 1)
  })
})

describe('mic-check — la panne ne laisse rien ouvert', () => {
  it('getUserMedia qui lève ⇒ error + message, aucune piste, aucun HP', async () => {
    stopMicCheck()
    const r = rig({ failGum: 'Permission refusée' })
    await startMicCheck(settingsLike(), r.port)
    const snapshot = micCheckSnapshot()
    assert.equal(snapshot.status, 'error')
    assert.equal(snapshot.error, 'Permission refusée')
    assert.equal(snapshot.applied, null)
    assert.equal(r.heard.length, 0)
    assert.equal(r.tracks.length, 0, 'aucune piste n’a survécu à l’échec')
  })

  it('stopMicCheck est idempotent et libère pistes, chaîne, contexte, cadence', async () => {
    stopMicCheck()
    const r = rig()
    await startMicCheck(settingsLike(), r.port)
    stopMicCheck()
    stopMicCheck()
    assert.equal(micCheckSnapshot().status, 'idle')
    assert.equal(r.tracks[0]?.stopped, true, 'la piste micro est STOPPÉE (le micro se libère)')
    assert.equal(r.chains[0]?.closeCalls, 1, 'la chaîne est fermée une fois')
    assert.equal(r.beats[0]?.cancelled.length, 1, 'la cadence est désarmée une fois')
  })

  it('un second start pendant l’écoute arrête le premier (jamais deux voix superposées)', async () => {
    stopMicCheck()
    const r = rig()
    const settings = settingsLike()
    await startMicCheck(settings, r.port)
    settings.audio.voiceFilter = 'robot'
    await startMicCheck(settings, r.port)
    assert.equal(r.chains.length, 2)
    assert.equal(r.chains[0]?.closeCalls, 1, 'la première écoute est démontée')
    assert.equal(micCheckSnapshot().applied?.voiceFilter, 'robot', 'la seconde voix est celle affichée')
    stopMicCheck()
  })
})

describe('mic-check — createMediaStreamSource exige un MediaStream natif', () => {
  it('le test du micro et la chaîne passent un flux neuf, un objet maison est refusé', async () => {
    stopMicCheck()
    const context = new FakeAudioContext()
    assert.throws(
      () =>
        context.createMediaStreamSource({
          getAudioTracks: () => [],
          addTrack: () => undefined,
        } as unknown as MediaStream),
      /not of type 'MediaStream'/,
    )
    const track = new FakeTrack('micro')
    const captured = new FakeMediaStream([track])
    let addTrackCalls = 0
    const original = captured.addTrack.bind(captured)
    captured.addTrack = (next: FakeTrack) => {
      addTrackCalls += 1
      original(next)
    }
    const port: MicCheckPort = {
      getUserMedia: async () => captured as unknown as MediaStream,
      createAudioContext: () => context as unknown as import('../src/renderer/voice-filter.ts').FilterAudioContext,
      buildChain: createVoiceFilterChain,
      speakers: { play: () => undefined, silence: () => undefined },
      makeBeat: () =>
        ({
          repeat: () => 0,
          cancel: () => undefined,
          now: () => 0,
        }) as unknown as import('../src/renderer/browser-beat.ts').RendererBeat,
    }
    await startMicCheck(settingsLike(), port)
    assert.ok(context.created.sources.length >= 2, 'chaîne d’appel et barre RMS créent chacune une source')
    for (const source of context.created.sources) {
      assert.ok(source.stream instanceof MediaStream, 'chaque source reçoit un MediaStream')
      assert.notEqual(source.stream, captured, 'le flux passé au contexte est neuf')
      assert.equal(source.stream.getAudioTracks().length, 1)
      assert.equal(source.stream.getAudioTracks()[0], track)
    }
    assert.equal(addTrackCalls, 0, 'le flux capté n’est pas écrit')
    assert.equal(micCheckSnapshot().status, 'listening')
    stopMicCheck()
  })
})

describe('mic-check — le store', () => {
  it('subscribe puis unsubscribe : plus de rappel après désabonnement', async () => {
    stopMicCheck()
    let calls = 0
    const unsubscribe = subscribeMicCheck(() => {
      calls += 1
    })
    const r = rig()
    await startMicCheck(settingsLike(), r.port)
    const before = calls
    assert.ok(before > 0, 'les publications du cycle atteignent l’abonné')
    unsubscribe()
    await startMicCheck(settingsLike(), r.port)
    assert.equal(calls, before, 'désabonné = silencieux')
    stopMicCheck()
  })
})
