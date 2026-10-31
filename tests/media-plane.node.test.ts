/**
 * tests/media-plane.node.test.ts — Carillon
 *
 * Mesure STRUCTURELLE du plan média (SPEC-005 §2) sans navigateur :
 * on remplace les globals DOM (`RTCPeerConnection`, `MediaStream`, `AudioContext`,
 * `navigator`) par des doublures instrumentées, puis on vérifie ce qui est
 * décidable hors Chromium :
 *   • une connexion PAR pair, et une configuration `iceServers: []` même si
 *     l'appelant fournit un serveur STUN ;
 *   • l'offre/réponse émise porte `maxaveragebitrate=32000;stereo=0;useinbandfec=1` ;
 *   • `setParameters` fixe `maxBitrate = 32000` ;
 *   • contraintes micro mono/EC/NS/AGC + micro coupé au repos (push-to-talk) ;
 *   • `level()` = RMS borné 0..1 ; `stats()` = 4 nombres ;
 *   • candidats ICE hors LAN refusés, candidats LAN mis en file puis ajoutés ;
 *   • `close()` ferme tout.
 *
 * Ce que ce test ne prouve PAS (et ne prétend pas prouver) : que la voix sort
 * réellement d'un navigateur. Chromium n'est pas dans ce process — c'est Banc
 * qui tranche, avec le bundle esbuild de ce même fichier.
 */

import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createMediaPlane } from '../src/engine/rtc/media-plane.ts'
// AD-18 / D3 : `timers` est REQUIS sur `MediaPlaneOptions`. Ce fichier mesure autre chose
// que le plafond de ramassage : il passe donc l'horloge inerte, explicitement, à chaque site.
import { NO_TIMERS } from '../src/engine/timers.ts'
import { manualTimers } from './manual-timers.ts'

/** Laisse tourner les microtâches : `attach()` enchaîne des promesses, sans timer. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

const OFFER_SDP = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'c=IN IP4 0.0.0.0',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=sendrecv',
  '',
].join('\r\n')

const ANSWER_SDP = OFFER_SDP.replace('a=sendrecv', 'a=recvonly')

const CANDIDATE_LAN = 'candidate:1 1 udp 2122260223 192.168.1.42 54321 typ host generation 0'
const CANDIDATE_MDNS = 'candidate:2 1 udp 2122260223 4f3a1b2c-9d8e-4f71-a6b5-3c2d1e0f9a8b.local 54321 typ host'
const CANDIDATE_SRFLX =
  'candidate:3 1 udp 1686052607 203.0.113.9 54321 typ srflx raddr 192.168.1.42 rport 54321'
const CANDIDATE_PUBLIC_HOST = 'candidate:4 1 udp 2122260223 203.0.113.9 54321 typ host'

/** Piste micro doublure : seule la propriété `enabled` compte pour le PTT. */
class FakeTrack {
  public enabled = true
  public stopped = false
  /** AD-17 / D4 : une piste qui n'est plus `'live'` rend la mesure PÉRIMÉE (`null`). */
  public readyState: MediaStreamTrackState = 'live'
  public stop(): void {
    this.stopped = true
    this.readyState = 'ended'
  }
  /** Fin de piste sans `stop()` : c'est ce que le navigateur émet quand la source se tarit. */
  public end(): void {
    this.readyState = 'ended'
  }
}

/** Flux doublure : ce que le plan média manipule (`getAudioTracks`, `getTracks`). */
class FakeMediaStream {
  public readonly tracks: FakeTrack[]
  public constructor(tracks: FakeTrack[] = []) {
    this.tracks = tracks
  }
  public getAudioTracks(): FakeTrack[] {
    return this.tracks
  }
  public getTracks(): FakeTrack[] {
    return this.tracks
  }
}

/** Émetteur doublure : enregistre `setParameters`. */
class FakeSender {
  public readonly parameters = { encodings: [{ maxBitrate: 0, active: true }] }
  public setParametersCalls = 0
  public getParameters(): unknown {
    return this.parameters
  }
  public async setParameters(next: unknown): Promise<void> {
    this.setParametersCalls += 1
    assert.ok(typeof next === 'object' && next !== null, 'setParameters doit recevoir un objet')
  }
  public async replaceTrack(): Promise<void> {
    return undefined
  }
}

/** `RTCPeerConnection` doublure : garde trace de la configuration reçue. */
class FakePeerConnection {
  public static instances: FakePeerConnection[] = []
  /** Quand `true`, la prochaine connexion démarre son ramassage en cours (T17). */
  public static holdGathering = false
  public readonly config: Record<string, unknown>
  public readonly senders: FakeSender[] = []
  public readonly addedCandidates: Array<Record<string, unknown>> = []
  public connectionState = 'new'
  public closed = false
  public onicecandidate: ((event: unknown) => void) | null = null
  /** Ramassage déjà terminé par défaut : `attach()`/`accept()` ne patientent pas (T17). */
  public iceGatheringState: RTCIceGatheringState = FakePeerConnection.holdGathering
    ? 'gathering'
    : 'complete'
  private readonly gatheringListeners: Array<() => void> = []
  public ontrack: ((event: unknown) => void) | null = null
  public onconnectionstatechange: (() => void) | null = null
  public localDescription: Record<string, unknown> | null = null
  public remoteDescription: Record<string, unknown> | null = null

  public constructor(config: Record<string, unknown>) {
    this.config = config
    FakePeerConnection.instances.push(this)
  }

  public addEventListener(type: string, listener: () => void): void {
    if (type !== 'icegatheringstatechange') return
    this.gatheringListeners.push(listener)
  }
  public removeEventListener(type: string, listener: () => void): void {
    if (type !== 'icegatheringstatechange') return
    const index = this.gatheringListeners.indexOf(listener)
    if (index >= 0) this.gatheringListeners.splice(index, 1)
  }
  /** Termine le ramassage et réveille `waitForGathering` (événement + état). */
  public finishGathering(): void {
    this.iceGatheringState = 'complete'
    for (const listener of [...this.gatheringListeners]) listener()
  }
  public get gatheringListenerCount(): number {
    return this.gatheringListeners.length
  }

  public addTrack(): FakeSender {
    const sender = new FakeSender()
    this.senders.push(sender)
    return sender
  }
  public async createOffer(): Promise<Record<string, unknown>> {
    return { type: 'offer', sdp: OFFER_SDP }
  }
  public async createAnswer(): Promise<Record<string, unknown>> {
    return { type: 'answer', sdp: ANSWER_SDP }
  }
  public async setLocalDescription(description: Record<string, unknown>): Promise<void> {
    this.localDescription = description
  }
  public async setRemoteDescription(description: Record<string, unknown>): Promise<void> {
    this.remoteDescription = description
  }
  public async addIceCandidate(candidate: Record<string, unknown>): Promise<void> {
    this.addedCandidates.push(candidate)
  }
  public async getStats(): Promise<{ forEach: (visit: (entry: unknown) => void) => void }> {
    const entries: unknown[] = [
      { type: 'outbound-rtp', kind: 'audio', bytesSent: 1200 },
      { type: 'inbound-rtp', kind: 'audio', bytesReceived: 3400, packetsLost: 2 },
      { type: 'candidate-pair', state: 'in-progress', currentRoundTripTime: 0.5 },
      { type: 'candidate-pair', state: 'succeeded', currentRoundTripTime: 0.0125 },
    ]
    return {
      forEach: (visit: (entry: unknown) => void): void => {
        for (const entry of entries) visit(entry)
      },
    }
  }
  public close(): void {
    this.closed = true
  }
}

/** Analyseur doublure : rend une sinusoïde constante (RMS = 0.25). */
class FakeAnalyser {
  public fftSize = 2048
  public smoothingTimeConstant = 0.8
  public getFloatTimeDomainData(buffer: Float32Array): void {
    buffer.fill(0.25)
  }
}

/** `AudioContext` doublure : juste de quoi créer un vumètre. */
class FakeAudioContext {
  public createAnalyser(): FakeAnalyser {
    return new FakeAnalyser()
  }
  public createMediaStreamSource(): { connect: () => void } {
    return { connect: (): void => undefined }
  }
  public resume(): Promise<void> {
    return Promise.resolve()
  }
  public close(): Promise<void> {
    return Promise.resolve()
  }
}

const gumCalls: Array<Record<string, unknown>> = []
let lastTrack: FakeTrack | null = null

const fakeMediaDevices = {
  getUserMedia: async (constraints: Record<string, unknown>): Promise<FakeMediaStream> => {
    gumCalls.push(constraints)
    const track = new FakeTrack()
    lastTrack = track
    return new FakeMediaStream([track])
  },
}

/** Pose les doublures sur les globals, et rend la fonction de restauration. */
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
  define('navigator', { mediaDevices: fakeMediaDevices })
  return (): void => {
    for (const name of names) {
      const descriptor = saved.get(name)
      if (descriptor === undefined) {
        Reflect.deleteProperty(globalThis, name)
      } else {
        Object.defineProperty(globalThis, name, descriptor)
      }
    }
  }
}

function peerAt(index: number): FakePeerConnection {
  const peer = FakePeerConnection.instances[index]
  if (peer === undefined) throw new Error(`aucune RTCPeerConnection en position ${index}`)
  return peer
}

function fireIce(peer: FakePeerConnection, candidate: string | null): void {
  const handler = peer.onicecandidate
  if (handler === null) return
  handler({
    candidate: candidate === null ? null : { candidate, sdpMid: '0', sdpMLineIndex: 0, toJSON: () => ({ candidate }) },
  })
}

/** `ontrack` d'une connexion donnée : c'est le SEUL endroit où le pair est connu (D3). */
function fireTrack(peer: FakePeerConnection, stream: FakeMediaStream): void {
  const handler = peer.ontrack
  if (handler === null) throw new Error('ontrack non câblé')
  const track = stream.getAudioTracks()[0]
  handler({ track, streams: [stream] })
}

describe('media-plane — maillage, Opus 32 kbps, push-to-talk, filtre LAN', () => {
  let restore: () => void

  beforeEach(() => {
    FakePeerConnection.instances = []
    gumCalls.length = 0
    lastTrack = null
    restore = installStubs()
  })

  afterEach(() => {
    restore()
  })

  it('crée UNE RTCPeerConnection par pair, jamais partagée', async () => {
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    await plane.attach('b')
    await plane.attach('c')
    await plane.attach('b')
    assert.equal(FakePeerConnection.instances.length, 2, 'deux pairs distants = deux connexions')
    assert.notEqual(peerAt(0), peerAt(1))
    plane.close()
  })

  it('impose iceServers: [] même si l’appelant fournit un serveur STUN', async () => {
    const plane = createMediaPlane({
      localId: 'a',
      timers: NO_TIMERS,
      rtcConfig: {
        iceServers: [{ urls: 'stun:stun.example.org' }, { urls: 'turn:turn.example.org', username: 'u' }],
      },
    })
    await plane.attach('b')
    const peer = peerAt(0)
    assert.deepEqual(peer.config['iceServers'], [], 'aucun STUN/TURN ne doit survivre')
    assert.equal(peer.config['iceTransportPolicy'], 'all')
    assert.equal(JSON.stringify(peer.config).includes('stun:'), false)
    assert.equal(JSON.stringify(peer.config).includes('turn:'), false)
    plane.close()
  })

  it('offre Opus 32 kbps mono avec FEC, et la description locale est bien la mungée', async () => {
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    const offer = await plane.attach('b')
    const sdp = offer.sdp
    assert.ok(sdp !== undefined, 'l’offre doit porter un SDP')
    assert.match(sdp, /a=fmtp:111 minptime=10;maxaveragebitrate=32000;stereo=0;useinbandfec=1/)
    assert.equal(offer.type, 'offer')
    assert.equal(peerAt(0).localDescription?.['sdp'], sdp, 'setLocalDescription doit recevoir le SDP mungé')
    plane.close()
  })

  it('la réponse est mungée de la même façon', async () => {
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    const answer = await plane.accept('b', { type: 'offer', sdp: OFFER_SDP })
    const sdp = answer.sdp
    assert.ok(sdp !== undefined, 'la réponse doit porter un SDP')
    assert.match(sdp, /maxaveragebitrate=32000;stereo=0;useinbandfec=1/)
    assert.equal(answer.type, 'answer')
    plane.close()
  })

  it('setParameters fixe maxBitrate = 32000 sur l’émetteur', async () => {
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    await plane.startMicrophone()
    await plane.attach('b')
    const sender = peerAt(0).senders[0]
    assert.ok(sender !== undefined, 'un émetteur doit être créé')
    assert.equal(sender.setParametersCalls, 1, 'setParameters doit être appelé une fois')
    assert.equal(sender.parameters.encodings[0]?.maxBitrate, 32000)
    plane.close()
  })

  it('micro : mono, EC/NS/AGC, et coupé au repos (push-to-talk)', async () => {
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    await plane.startMicrophone()
    const constraints = gumCalls[0]
    assert.deepEqual(constraints?.['audio'], {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    })
    assert.ok(lastTrack !== null, 'une piste doit avoir été ouverte')
    assert.equal(lastTrack?.enabled, false, 'au repos le micro est coupé')
    plane.setTransmitting(true)
    assert.equal(lastTrack?.enabled, true, 'appui = micro ouvert')
    plane.setTransmitting(false)
    assert.equal(lastTrack?.enabled, false, 'relâchement = micro coupé')
    plane.close()
  })

  it('level() = RMS du vumètre, borné 0..1', async () => {
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    assert.equal(plane.level(), 0, 'sans flux, le vumètre est muet')
    await plane.startMicrophone()
    const level = plane.level()
    assert.notEqual(level, null, 'un micro vivant est mesuré')
    assert.ok(level !== null && level > 0.001, `niveau attendu > 0.001, obtenu ${level}`)
    assert.ok(level !== null && level <= 1, `niveau attendu <= 1, obtenu ${level}`)
    plane.close()
  })

  it('AD-17 / D3 — un flux distant PORTE son pair : onRemoteStream(peerId, stream)', async () => {
    const seen: Array<{ peerId: string; stream: unknown }> = []
    const plane = createMediaPlane({
      localId: 'a',
      timers: NO_TIMERS,
      onRemoteStream: (peerId, stream) => {
        seen.push({ peerId, stream })
      },
    })
    await plane.attach('b')
    await plane.attach('c')

    const streamB = new FakeMediaStream([new FakeTrack()])
    const streamC = new FakeMediaStream([new FakeTrack()])
    fireTrack(peerAt(0), streamB)
    fireTrack(peerAt(1), streamC)

    assert.deepEqual(
      seen.map((s) => s.peerId),
      ['b', 'c'],
      'chaque flux arrive avec le pair de SA connexion, dans l’ordre',
    )
    assert.equal(seen[0]?.stream, streamB, 'le flux de b est bien celui de b')
    assert.equal(seen[1]?.stream, streamC, 'le flux de c est bien celui de c')
    plane.close()
  })

  it('AD-17 / D4 — level(peerId) : un analyseur par pair, `null` quand rien n’est mesuré', async () => {
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    assert.equal(plane.level('b'), null, 'pair inconnu ⇒ null, jamais 0')
    await plane.attach('b')
    assert.equal(plane.level('b'), null, 'pair attaché sans flux ⇒ toujours null')
    assert.equal(plane.level(), 0, 'le vumètre GLOBAL, lui, vaut 0 : il y a zéro source')

    const trackB = new FakeTrack()
    const trackC = new FakeTrack()
    fireTrack(peerAt(0), new FakeMediaStream([trackB]))
    const levelB = plane.level('b')
    assert.notEqual(levelB, null, 'flux vivant ⇒ mesure')
    assert.ok(levelB !== null && levelB > 0.001, `niveau de b attendu > 0.001, obtenu ${levelB}`)
    assert.equal(plane.level('c'), null, 'un autre pair ne mesure pas : pas d’analyseur partagé')
    assert.equal(plane.level('z'), null, 'un identifiant inconnu ne rend jamais la mesure d’un autre')

    // Piste finie ⇒ mesure PÉRIMÉE ⇒ null (et non 0 : rien n’a été mesuré).
    trackB.end()
    assert.equal(plane.level('b'), null, 'piste terminée ⇒ null, jamais 0')
    assert.equal(plane.level(), 0, 'plus aucune source vivante ⇒ le global retombe à 0')

    // Un second flux pour le même pair REMPLACE l’analyseur (une piste par pair).
    fireTrack(peerAt(0), new FakeMediaStream([trackC]))
    const levelB2 = plane.level('b')
    assert.notEqual(levelB2, null, 'nouvelle piste ⇒ mesure à nouveau')
    plane.close()
  })

  it('stats() rend les 4 nombres du rapport getStats', async () => {
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    await plane.attach('b')
    const stats = await plane.stats('b')
    assert.deepEqual(stats, { bytesSent: 1200, bytesReceived: 3400, packetsLost: 2, rttMs: 13 })
    plane.close()
  })

  it('refuse un candidat local hors LAN et transmet les candidats LAN', async () => {
    const sent: unknown[] = []
    const emitters: string[] = []
    const plane = createMediaPlane({
      localId: 'a',
      timers: NO_TIMERS,
      onLocalCandidate: (peerId, candidate) => {
        // T17 : le pair émetteur est le premier argument, et `null` (fin de collecte) est
        // désormais SIGNALÉ (il ne compte pas comme un candidat) au lieu d'être avalé.
        emitters.push(peerId)
        if (candidate !== null) sent.push(candidate)
      },
    })
    await plane.attach('b')
    const peer = peerAt(0)
    fireIce(peer, CANDIDATE_SRFLX)
    fireIce(peer, CANDIDATE_PUBLIC_HOST)
    assert.equal(sent.length, 0, 'srflx et host public doivent être refusés')
    fireIce(peer, CANDIDATE_LAN)
    fireIce(peer, CANDIDATE_MDNS)
    assert.equal(sent.length, 2, 'host RFC1918 et mDNS .local doivent passer')
    fireIce(peer, null)
    assert.equal(sent.length, 2, 'la fin de collecte (candidate null) n’est pas un candidat')
    assert.equal(
      emitters.length,
      3,
      'les 2 candidats LAN transmis ET la fin de collecte nomment le pair émetteur',
    )
    assert.ok(
      emitters.every((id) => id === 'b'),
      `le pair émetteur doit être « b » partout : ${JSON.stringify(emitters)}`,
    )
    plane.close()
  })

  it('addRemoteCandidate : hors LAN refusé, LAN mis en file puis ajouté', async () => {
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    await plane.attach('b')
    const peer = peerAt(0)
    await plane.addRemoteCandidate('b', { candidate: CANDIDATE_SRFLX, sdpMid: '0', sdpMLineIndex: 0 })
    await plane.addRemoteCandidate('b', { candidate: CANDIDATE_PUBLIC_HOST, sdpMid: '0', sdpMLineIndex: 0 })
    assert.equal(peer.addedCandidates.length, 0, 'aucun candidat hors LAN ne doit être ajouté')
    await plane.addRemoteCandidate('b', { candidate: CANDIDATE_LAN, sdpMid: '0', sdpMLineIndex: 0 })
    assert.equal(peer.addedCandidates.length, 0, 'sans description distante, le candidat attend')
    await plane.acceptAnswer('b', { type: 'answer', sdp: ANSWER_SDP })
    assert.equal(peer.addedCandidates.length, 1, 'la file doit être vidée après setRemoteDescription')
    assert.equal(peer.addedCandidates[0]?.['candidate'], CANDIDATE_LAN)
    plane.close()
  })

  it('pair inconnu = erreur explicite, jamais un silence', async () => {
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    await assert.rejects(() => plane.stats('inconnu'), /pair inconnu/)
    await assert.rejects(() => plane.acceptAnswer('inconnu', { type: 'answer', sdp: ANSWER_SDP }), /pair inconnu/)
    plane.close()
  })

  it('close() ferme les connexions et stoppe le micro', async () => {
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    await plane.startMicrophone()
    await plane.attach('b')
    const peer = peerAt(0)
    plane.close()
    assert.equal(peer.closed, true)
    assert.equal(lastTrack?.stopped, true)
  })

  it('T17 — attend `iceGatheringState === \'complete\'` avant de figer le SDP', async () => {
    FakePeerConnection.holdGathering = true
    try {
      const timers = manualTimers()
      const plane = createMediaPlane({ localId: 'a', timers })
      let resolved = false
      const pending = plane.attach('b').then((description) => {
        resolved = true
        return description
      })
      // Le ramassage est en cours : `attach()` ne doit PAS avoir rendu la main.
      await flushMicrotasks()
      assert.equal(resolved, false, 'attach() patiente pendant le ramassage')
      assert.deepEqual([...timers.armed], [1000], 'le plafond est armé à 1 000 ms, pas à autre chose')
      const peer = peerAt(0)
      assert.equal(peer.gatheringListenerCount, 1, 'un écouteur de ramassage est posé')
      // Le SDP figé porte le candidat ramassé (seul chemin possible sans STUN).
      peer.finishGathering()
      peer.localDescription = { type: 'offer', sdp: `${OFFER_SDP}a=candidate:1 1 udp 2122260223 192.168.1.20 50000 typ host\r\n` }
      const description = await pending
      assert.equal(resolved, true)
      assert.match(description.sdp ?? '', /a=candidate:1 1 udp .* 192\.168\.1\.20 50000 typ host/,
        'le SDP rendu est celui d’APRÈS le ramassage')
      assert.equal(peer.gatheringListenerCount, 0, 'l’écouteur est retiré : pas de fuite')
      assert.equal(timers.live, 0, 'l’échéance est désarmée : rien ne reste armé')
      plane.close()
    } finally {
      FakePeerConnection.holdGathering = false
    }
  })

  it('T17 — plafond de 1 s : un ramassage qui ne finit jamais ne bloque pas la voix', async () => {
    FakePeerConnection.holdGathering = true
    try {
      const timers = manualTimers()
      const plane = createMediaPlane({ localId: 'a', timers })
      let resolved = false
      const pending = plane.attach('b').then((description) => {
        resolved = true
        return description
      })
      await flushMicrotasks()
      assert.deepEqual([...timers.armed], [1000], 'plafond armé à 1 000 ms')
      assert.equal(timers.fire(999), 0, 'à 999 ms le plafond n’a pas encore sonné')
      await flushMicrotasks()
      assert.equal(resolved, false, 'attach() patiente toujours à 999 ms')
      assert.equal(timers.fire(1000), 1, 'à 1 000 ms le plafond sonne')
      const description = await pending
      assert.equal(resolved, true, 'attach() rend la main au plafond, sans attendre une seconde réelle')
      assert.equal(peerAt(0).gatheringListenerCount, 0, 'l’écouteur est retiré même au plafond')
      assert.match(description.sdp ?? '', /v=0/, 'le SDP est rendu quand même : on ne perd rien')
      assert.equal(timers.fire(1001), 0, 'à 1 001 ms plus rien ne sonne : le plafond ne se réarme pas')
      assert.equal(timers.live, 0, 'en sonnant, le plafond a désarmé son échéance (AD-18 / D5)')
      plane.close()
    } finally {
      FakePeerConnection.holdGathering = false
    }
  })

  it('D5 — échéance orpheline : close() pendant l’attente désarme l’échéance et rend la main', async () => {
    FakePeerConnection.holdGathering = true
    try {
      const timers = manualTimers()
      const plane = createMediaPlane({ localId: 'a', timers })
      let resolved = false
      const pending = plane.attach('b').then((description) => {
        resolved = true
        return description
      })
      await flushMicrotasks()
      assert.deepEqual([...timers.armed], [1000], 'une échéance est armée pendant l’attente')
      assert.equal(timers.live, 1, 'et elle est vivante avant close()')
      plane.close()
      await flushMicrotasks()
      assert.equal(timers.live, 0, 'close() désarme l’échéance : aucune ne survit au plan')
      assert.equal(timers.cancelled, 1, 'le désarmement passe par `cancel`, pas par le GC')
      assert.equal(timers.fire(1000), 0, 'l’échéance désarmée ne sonne pas après close()')
      assert.equal(resolved, true, 'l’attente est abandonnée, pas laissée pendante')
      assert.match((await pending).sdp ?? '', /v=0/, 'le SDP est rendu quand même')
    } finally {
      FakePeerConnection.holdGathering = false
    }
  })
})
