/**
 * Verrou (bug « deux clics pour activer un filtre », rapporté par JC, signalé corrigé en 0.4.16
 * mais pas corrigé) : le premier clic sur un filtre vocal doit appliquer la voix, même quand il
 * tombe PENDANT l'ouverture du salon (le micro n'a pas encore rendu la main).
 *
 * La chaîne réelle : Settings.tsx -> voice.ts setVoiceFilter -> plane.setVoiceFilter ->
 * voiceHost.apply. Or `apply` rend `null` tant que la chaîne n'est pas OUVERTE (le micro est en
 * cours, `startMicrophone` est asynchrone) : le clic est perdu, `plane.voiceFilter()` rend
 * l'ancienne voix, l'UI affiche le refus — il faut re-cliquer. Le châssis doit MEMORISER la
 * demande et l'appliquer dès que la chaîne s'ouvre.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createVoiceChainHost } from '../src/engine/rtc/voice-chain.ts'
import { FakePeerConnection, FakeMediaStream, FakeAudioContext, FakeTrack } from './fake-rtc.ts'
import { createMediaPlane } from '../src/engine/rtc/media-plane.ts'

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

function timers() {
  return {
    once: (ms: number, cb: () => void) => setTimeout(cb, ms),
    cancel: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
  }
}
import type { VoiceFilterId } from '../src/engine/rtc/voice-filters.ts'

interface VoiceChainLike {
  readonly current: VoiceFilterId
  readonly track: MediaStreamTrack
  applyFilter(id: VoiceFilterId): MediaStreamTrack
  close(): void
}

class FakeChain implements VoiceChainLike {
  public current: VoiceFilterId = 'none'
  public readonly applied: VoiceFilterId[] = []
  public constructor(public readonly track: MediaStreamTrack) {}
  applyFilter(id: VoiceFilterId): MediaStreamTrack {
    this.applied.push(id)
    this.current = id
    return this.track
  }
  close(): void {}
}

function hostWith(chains: FakeChain[]) {
  const track = new FakeTrack() as unknown as MediaStreamTrack
  const stream = {} as MediaStream
  const warns: string[] = []
  const host = createVoiceChainHost({
    stream,
    track,
    context: {} as never,
    warn: (message: string) => { warns.push(message) },
    buildChain: (_context, _stream, id) => {
      const chain = new FakeChain(track)
      chain.current = id
      chains.push(chain)
      return chain
    },
  })
  return { host, track, warns }
}

test('apply PENDANT l’ouverture (chaîne pas encore ouverte) : la voix est mémorisée et appliquée dès l’ouverture — un seul clic suffit', () => {
  const chains: FakeChain[] = []
  const { host } = hostWith(chains)
  // Le clic tombe avant open() : le micro est en cours de démarrage (startMicrophone async).
  const before = host.apply('robot')
  assert.equal(before, null, 'rien n’est ouvert : pas de piste à rendre encore')
  // La fenêtre s’ouvre : la chaîne se construit. La voix demandée doit être la voix ACTIVE,
  // pas celle d’ouverture.
  host.open('none')
  const chain = chains[0]
  assert.ok(chain, 'la chaîne est ouverte')
  assert.equal(host.current(), 'robot', 'la voix demandée pendant l’ouverture est appliquée (premier clic)')
  assert.ok(chain !== null)
  // Soit le constructeur a reçu la voix mémorisée, soit applyFilter l'a appliquée — la preuve
  // est que la VOIX ACTIVE est robot sans second clic.
  assert.ok(chain.applied.length === 0 ? chain.current === 'robot' : chain.applied[0] === 'robot',
    'la demande mémorisée a bien atteint la chaîne (constructeur ou applyFilter)')
})


test('plan média : clic AVANT startMicrophone puis ouverture — la voix du premier clic est la voix active', async () => {
  const restore = installStubs()
  FakePeerConnection.instances = []
  try {
    const chains: FakeChain[] = []
    const track = new FakeTrack() as unknown as MediaStreamTrack
    const plane = createMediaPlane({
      localId: 'a',
      timers: timers(),
      onLocalCandidate: () => {},
      voiceFilter: 'none',
      voiceChainFactory: ((_ctx: unknown, _s: MediaStream, id: VoiceFilterId) => {
        const chain = new FakeChain(track)
        chain.current = id
        chains.push(chain)
        return chain
      }) as never,
    })
    // Clic pendant l'ouverture du micro (chaîne pas encore ouverte): jamais un succès prétendu
    // (null), jamais perdu non plus — le plan doit s'en souvenir.
    const before = plane.setVoiceFilter('robot')
    assert.equal(before, null, 'micro pas encore ouvert : pas de piste à rendre')
    await plane.startMicrophone()
    assert.equal(plane.voiceFilter(), 'robot', 'la voix du PREMIER clic est active à l’ouverture')
    assert.ok(chains.length >= 1, 'une chaîne a été ouverte')
    assert.equal(chains[chains.length - 1]?.current, 'robot')
  } finally {
    restore()
  }
})

test('plan média : un changement de voix en cours d’appel replaceTrack sur chaque pair, jamais le micro brut', async () => {
  const restore = installStubs()
  FakePeerConnection.reset()
  const mic = new FakeTrack('micro-brut')
  const filtered = new FakeTrack('filtre')
  const nav = globalThis.navigator.mediaDevices
  const original = nav.getUserMedia.bind(nav)
  nav.getUserMedia = async () => new FakeMediaStream([mic]) as unknown as MediaStream
  try {
    const plane = createMediaPlane({
      localId: 'a',
      timers: timers(),
      onLocalCandidate: () => {},
      voiceFilter: 'robot',
      voiceChainFactory: ((_ctx: unknown, _stream: MediaStream, id: VoiceFilterId) => {
        const chain = new FakeChain(filtered as unknown as MediaStreamTrack)
        chain.current = id
        return chain
      }) as never,
    })
    await plane.startMicrophone()
    assert.equal(mic.enabled, true, 'la capture reste ouverte (AEC / RNNoise)')
    assert.equal(filtered.enabled, false, 'le push-to-talk coupe la piste envoyée')
    await plane.attach('b')
    await plane.attach('c')
    const peers = FakePeerConnection.instances
    assert.equal(peers.length, 2)
    for (const peer of peers) {
      assert.equal(peer.senders[0]?.track, filtered, 'addTrack reçoit la piste filtrée')
      assert.notEqual(peer.senders[0]?.track, mic, 'le micro brut ne part pas')
    }
    plane.setVoiceFilter('radio')
    await new Promise((resolve) => setTimeout(resolve, 0))
    for (const peer of peers) {
      const sender = peer.senders[0]
      assert.ok(sender !== undefined)
      assert.ok(sender.replaceTrackCalls >= 1, 'chaque pair reçoit replaceTrack')
      assert.equal(sender.track, filtered, 'replaceTrack garde la destination filtrée')
      assert.notEqual(sender.track, mic)
    }
    assert.equal(mic.enabled, true, 'changer de voix ne coupe pas la capture')
    assert.equal(plane.voiceFilter(), 'radio')
    plane.close()
  } finally {
    nav.getUserMedia = original
    restore()
  }
})

test('apply après ouverture : comportement inchangé (applique immédiatement)', () => {
  const chains: FakeChain[] = []
  const { host } = hostWith(chains)
  host.open('none')
  const track = host.apply('deep')
  assert.ok(track, 'la piste des pairs est rendue')
  assert.equal(host.current(), 'deep')
  assert.deepEqual(chains[0]?.applied, ['deep'])
})
