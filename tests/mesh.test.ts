/**
 * tests/mesh.test.ts — SPEC-007 §4.2 (A2) : le maillage, sans réseau ni navigateur (Carillon, T16a)
 *
 * Trois blocs, trois falsifications distinctes :
 *
 *   1. « mesh — §4.2 » : le pilote de maillage contre un **faux plan média**
 *      instantané (aucune attente réelle, aucun timer) et un **faux tuyau**
 *      (`send` qui empile). On y mesure ce qui est décidable : l'ordre des gestes,
 *      l'idempotence, la borne de pairs, la sortie de lien, la fermeture, et
 *      deux nœuds qui se donnent la réplique jusqu'à l'état établi.
 *
 *   2. « media-plane — DÉFAUT-2 » : `addRemoteCandidate(remoteId, null)` — le
 *      candidat de FIN DE RAMASSAGE que Chromium émet — doit être un no-op, pas
 *      une exception (VERIF-015). Mesuré sur le VRAI plan média + faux RTC.
 *
 *   3. « media-plane — DÉFAUT-1 » : remplacer une piste ne doit déclencher
 *      aucune renégociation (le code passe par `replaceTrack`, et le SDP conserve
 *      une seule m-line audio). Preuve plutôt qu'ajout de code.
 *
 * Ce que ce fichier ne prouve PAS : que l'audio sort des haut-parleurs, ni que
 * l'ICE converge réellement (aucun runtime Chromium dans cette image :
 * `electron --version` sort EXIT=127). Le contrat de signalisation, lui, est
 * entièrement décidable hors navigateur — c'est le point de T16a.
 */

import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  createMesh,
  type Mesh,
  type MeshPeerState,
  type PeerStateCause,
  type SignalIn,
  type SignalOut,
} from '../src/engine/net/mesh.ts'
import { createMediaPlane, type MediaPlane, type PeerStats } from '../src/engine/rtc/media-plane.ts'
// AD-18 / D3 : `timers` est REQUIS ; ces sites ne mesurent pas le plafond de ramassage.
import { NO_TIMERS } from '../src/engine/timers.ts'
import { manualTimers, type ManualTimers } from './manual-timers.ts'
import {
  CANDIDATE_HOST_MDNS,
  CANDIDATE_HOST_RFC1918,
  CANDIDATE_SRFLX,
  FakePeerConnection,
  type FakeDom,
  installFakeDom,
} from './fake-rtc.ts'

/* ------------------------------------------------------------------------- */
/* Outils de lecture                                                            */
/* ------------------------------------------------------------------------- */

/** Accès indexé sans `!` (règle C12-3) et sans `undefined` qui traîne. */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index]
  if (item === undefined) {
    throw new Error(`élément ${index} absent (taille réelle : ${items.length})`)
  }
  return item
}

/** Message sortant garanti non-`leave` (les tests qui en attendent un le vérifient). */
function outbound(sent: readonly SignalOut[], index: number): { kind: string; to: string; payload: unknown } {
  const msg = at(sent, index)
  if (msg.kind === 'leave') throw new Error(`message ${index} est un « leave », pas une charge utile`)
  return { kind: msg.kind, to: msg.to, payload: msg.payload }
}

/** `SignalOut` tel qu'un relais le remettrait au destinataire (`leave` ⇒ `peer-left`). */
function relay(from: string, msg: SignalOut): SignalIn {
  if (msg.kind === 'leave') return { kind: 'peer-left', peerId: from }
  return { kind: msg.kind, from, payload: msg.payload }
}

/** Compte les m-lines d'un SDP : une par flux négocié (une seule attendue ici). */
function mlineCount(sdp: string | undefined): number {
  if (sdp === undefined) return 0
  return sdp.split('\n').filter((line) => line.startsWith('m=')).length
}

/* ------------------------------------------------------------------------- */
/* Faux plan média : instantané, tracé, aucune horloge                          */
/* ------------------------------------------------------------------------- */

class FakePlane implements MediaPlane {
  /** Journal partagé avec le harnais : l'ordre plan média ↔ send y est lisible. */
  public readonly log: string[]
  public readonly attaches: string[] = []
  public readonly accepts: Array<{ peerId: string; sdp: string }> = []
  public readonly acceptAnswers: Array<{ peerId: string; sdp: string }> = []
  public readonly remoteCandidates: Array<{ peerId: string; candidate: RTCIceCandidateInit | null }> = []
  /** Pairs pour lesquels une connexion a été créée (attach OU accept) — le compteur de « pc ». */
  public readonly connections = new Set<string>()
  public closeCalls = 0
  public micOpen = false
  public transmitting = true
  /** Pair dont `attach()` doit échouer (chemin d'erreur). */
  public failAttachFor: string | null = null

  public constructor(log: string[]) {
    this.log = log
  }

  public async startMicrophone(): Promise<void> {
    this.micOpen = true
    this.log.push('startMicrophone')
  }

  public async attach(remoteId: string): Promise<RTCSessionDescriptionInit> {
    this.log.push(`attach:${remoteId}`)
    if (this.failAttachFor === remoteId) throw new Error('attach simulé en échec')
    this.attaches.push(remoteId)
    this.connections.add(remoteId)
    return { type: 'offer', sdp: `offer:${remoteId}` }
  }

  public async accept(
    remoteId: string,
    offer: RTCSessionDescriptionInit
  ): Promise<RTCSessionDescriptionInit> {
    this.log.push(`accept:${remoteId}:${offer.sdp ?? ''}`)
    this.accepts.push({ peerId: remoteId, sdp: offer.sdp ?? '' })
    this.connections.add(remoteId)
    return { type: 'answer', sdp: `answer:${remoteId}` }
  }

  public async acceptAnswer(remoteId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    this.log.push(`acceptAnswer:${remoteId}:${answer.sdp ?? ''}`)
    this.acceptAnswers.push({ peerId: remoteId, sdp: answer.sdp ?? '' })
  }

  public async addRemoteCandidate(
    remoteId: string,
    candidate: RTCIceCandidateInit | null
  ): Promise<void> {
    this.log.push(`candidate:${remoteId}:${candidate === null ? 'null' : candidate.candidate ?? ''}`)
    this.remoteCandidates.push({ peerId: remoteId, candidate })
  }

  public setTransmitting(on: boolean): void {
    this.transmitting = on
  }

  /**
   * Doublure d'`ontrack` : le plan média réel appelle `onRemoteStream(peerId, stream)`
   * (D3). Ici c'est le test qui décide quel pair émet — et c'est ce qui permet de
   * falsifier le cas « flux sans pair connu ».
   */
  public sink: ((peerId: string, s: MediaStream) => void) | null = null

  public emitStream(peerId: string, stream: MediaStream): void {
    this.sink?.(peerId, stream)
  }

  /** AD-17 / D4 : pas d'analyseur dans cette doublure ⇒ `null` par pair, `0` en global. */
  public level(peerId?: string): number | null {
    return peerId === undefined ? 0 : null
  }

  public unusedLevelPlaceholder(): number {
    return 0
  }

  public async stats(remoteId: string): Promise<PeerStats> {
    return { bytesSent: 0, bytesReceived: 0, packetsLost: 0, rttMs: 0 }
  }

  public close(): void {
    this.closeCalls += 1
    this.log.push('close')
  }
}

interface Recorded {
  readonly peerId: string
  readonly state: MeshPeerState
  /** Cause obligatoire depuis T17 : `'ice'` (négociation) ou `'timeout'` (horloge 5 s). */
  readonly cause: PeerStateCause
}

interface Harness {
  readonly mesh: Mesh
  readonly plane: FakePlane
  readonly sent: SignalOut[]
  readonly states: Recorded[]
  /** Flux transmis à l'appelant, avec le pair : AD-17 / D3. */
  readonly streams: Array<{ peerId: string; stream: unknown }>
  /** Horloge manuelle injectée : `noFlow` se déclenche sur `fire()`, jamais tout seul. */
  readonly timers: ManualTimers
  readonly log: string[]
}

function harness(
  localId: string,
  extra: { maxPeers?: number; plane?: FakePlane; timers?: ManualTimers } = {}
): Harness {
  const log: string[] = []
  const plane = extra.plane ?? new FakePlane(log)
  const sent: SignalOut[] = []
  const states: Recorded[] = []
  const streams: Array<{ peerId: string; stream: unknown }> = []
  const timers = extra.timers ?? manualTimers()
  const mesh = createMesh({
    localId,
    plane,
    timers,
    send: (msg: SignalOut): void => {
      sent.push(msg)
      log.push(msg.kind === 'leave' ? 'send:leave' : `send:${msg.kind}:${msg.to}`)
    },
    maxPeers: extra.maxPeers,
    onPeerState: (
      peerId: string,
      state: MeshPeerState,
      cause: PeerStateCause,
    ): void => {
      states.push({ peerId, state, cause })
      log.push(`state:${state}:${peerId}:${cause}`)
    },
    onRemoteStream: (peerId: string, stream: MediaStream): void => {
      streams.push({ peerId, stream })
      log.push(`stream:${peerId}`)
    },
  })
  // Câblage identique à la coquille (`voice-mesh.ts`) : le flux du plan média entre
  // dans le maillage AVEC son pair, c'est le maillage qui décide de le transmettre.
  plane.sink = (peerId: string, stream: MediaStream): void => {
    mesh.onRemoteStream(peerId, stream)
  }
  return { mesh, plane, sent, states, streams, timers, log }
}

/* ------------------------------------------------------------------------- */
/* Capture des `console.warn` du mesh : un refus doit être TRACÉ, pas silencieux */
/* ------------------------------------------------------------------------- */

let meshWarnings: string[] = []
const realWarn = console.warn

beforeEach(() => {
  meshWarnings = []
  console.warn = (...args: unknown[]): void => {
    meshWarnings.push(args.map((arg) => String(arg)).join(' '))
  }
})

afterEach(() => {
  console.warn = realWarn
})

/* ========================================================================== */
/* 1. Le pilote de maillage                                                    */
/* ========================================================================== */

describe('mesh — §4.2 : offreur déterministe, idempotence, borne, fermeture', () => {
  it('offreur (localId < remoteId) : attach() AVANT send(), une offre bien formée', async () => {
    const h = harness('a')
    await h.mesh.onSignal({ kind: 'peer-joined', peerId: 'b', name: 'Bob' })

    assert.deepEqual(h.log, ['state:connecting:b:ice', 'attach:b', 'send:offer:b'])
    assert.deepEqual(h.plane.attaches, ['b'], 'une seule offre émise')
    const offer = outbound(h.sent, 0)
    assert.equal(offer.kind, 'offer')
    assert.equal(offer.to, 'b')
    assert.deepEqual(offer.payload, { type: 'offer', sdp: 'offer:b' })
    assert.deepEqual(h.mesh.peers(), ['b'])
    assert.deepEqual(h.states, [{ peerId: 'b', state: 'connecting', cause: 'ice' }])
  })

  it('répondeur (localId > remoteId) : aucun attach, aucun send — il attend l’offre', async () => {
    const h = harness('b')
    await h.mesh.onSignal({ kind: 'peer-joined', peerId: 'a', name: 'Alice' })

    assert.deepEqual(h.plane.attaches, [])
    assert.deepEqual(h.sent, [], 'le répondeur ne parle pas le premier')
    assert.deepEqual(h.mesh.peers(), ['a'], 'le pair est connu avant toute description')
  })

  it('peer-joined rejoué : ni second attach, ni seconde offre', async () => {
    const h = harness('a')
    await h.mesh.onSignal({ kind: 'peer-joined', peerId: 'b', name: 'Bob' })
    await h.mesh.onSignal({ kind: 'peer-joined', peerId: 'b', name: 'Bob' })
    await h.mesh.onSignal({ kind: 'peer-joined', peerId: 'b', name: 'Bob' })

    assert.deepEqual(h.plane.attaches, ['b'])
    assert.equal(h.sent.length, 1)
  })

  it('offre rejouée à l’identique : un seul accept, une seule réponse', async () => {
    const h = harness('b')
    const offer: SignalIn = {
      kind: 'offer',
      from: 'a',
      payload: { type: 'offer', sdp: 'offer:a' },
    }
    await h.mesh.onSignal(offer)
    await h.mesh.onSignal(offer)
    await h.mesh.onSignal({ kind: 'offer', from: 'a', payload: { type: 'offer', sdp: 'offer:a' } })

    assert.equal(h.plane.accepts.length, 1, 'un seul accept() : pas de 2e pc, pas de 2e SDP')
    assert.equal(h.sent.length, 1, 'une seule réponse émise')
    // Réécrit (défaut (c), SPEC-008 §1) : l'ancien test assertait
    // `['connecting','connected']` dès l'échange de SDP. C'est FAUX : `connected`
    // exige une preuve de flux (piste reçue ou niveau mesuré), pas une négociation
    // terminée. Sans preuve, le pair reste `connecting` sous la garde des 5 s.
    assert.deepEqual(h.states, [{ peerId: 'a', state: 'connecting', cause: 'ice' }])
  })

  it('offre reçue avant tout peer-joined : le lien se crée paresseusement', async () => {
    const h = harness('b')
    await h.mesh.onSignal({ kind: 'offer', from: 'a', payload: { type: 'offer', sdp: 'offer:a' } })

    assert.deepEqual(h.plane.accepts, [{ peerId: 'a', sdp: 'offer:a' }])
    assert.deepEqual(outbound(h.sent, 0), {
      kind: 'answer',
      to: 'a',
      payload: { type: 'answer', sdp: 'answer:a' },
    })
    assert.deepEqual(h.mesh.peers(), ['a'])
  })

  it('ICE avant la description distante : transmis au plan média (mis en file), jamais perdu', async () => {
    const h = harness('b')
    await h.mesh.onSignal({ kind: 'peer-joined', peerId: 'a', name: 'Alice' })
    await h.mesh.onSignal({
      kind: 'ice',
      from: 'a',
      payload: { candidate: CANDIDATE_HOST_RFC1918, sdpMid: '0', sdpMLineIndex: 0 },
    })
    await h.mesh.onSignal({ kind: 'offer', from: 'a', payload: { type: 'offer', sdp: 'offer:a' } })

    assert.equal(h.plane.remoteCandidates.length, 1)
    assert.equal(at(h.plane.remoteCandidates, 0).candidate?.candidate, CANDIDATE_HOST_RFC1918)
    assert.deepEqual(
      h.plane.log.filter((line) => !line.startsWith('state:')),
      [`candidate:a:${CANDIDATE_HOST_RFC1918}`, 'accept:a:offer:a', 'send:answer:a'],
      'le candidat arrive AVANT l’accept : c’est la file `pending` du plan média qui le tient'
    )
  })

  it('ICE de fin de ramassage (payload null) : transmis tel quel, no-op côté plan média', async () => {
    const h = harness('b')
    await h.mesh.onSignal({ kind: 'peer-joined', peerId: 'a', name: 'Alice' })
    await h.mesh.onSignal({ kind: 'ice', from: 'a', payload: null })

    assert.equal(h.plane.remoteCandidates.length, 1)
    assert.equal(at(h.plane.remoteCandidates, 0).candidate, null, 'null passe par le contrat, sans exception')
    assert.deepEqual(meshWarnings, [], 'aucune anomalie tracée pour une fin de ramassage')
  })

  it('ICE malformé : refus explicite tracé, aucun appel au plan média, aucune exception', async () => {
    const h = harness('b')
    await h.mesh.onSignal({ kind: 'peer-joined', peerId: 'a', name: 'Alice' })
    await h.mesh.onSignal({ kind: 'ice', from: 'a', payload: { sdpMid: '0' } })
    await h.mesh.onSignal({ kind: 'ice', from: 'a', payload: 'n’importe quoi' })
    await h.mesh.onSignal({
      kind: 'ice',
      from: 'a',
      payload: { candidate: CANDIDATE_SRFLX, sdpMLineIndex: 'zéro' },
    })

    assert.deepEqual(h.plane.remoteCandidates, [], 'rien n’est passé au plan média')
    assert.equal(meshWarnings.length, 3, 'trois refus, trois traces')
    assert.ok(meshWarnings.every((line) => line.includes('ice de a refusé')), meshWarnings.join(' | '))
  })

  it('borne de pairs : le 9e pair est refusé — aucun pc, aucun send, refus tracé', async () => {
    const h = harness('a', { maxPeers: 8 })
    for (let index = 1; index <= 9; index += 1) {
      await h.mesh.onSignal({ kind: 'peer-joined', peerId: `p${index}`, name: `Pair ${index}` })
    }

    assert.equal(h.plane.attaches.length, 8, 'huit connexions, pas neuf')
    assert.equal(h.sent.length, 8, 'huit offres, pas neuf')
    assert.equal(h.plane.connections.size, 8)
    assert.equal(h.mesh.peers().length, 8)
    assert.equal(h.mesh.peers().includes('p9'), false, 'le 9e reste hors maillage')
    assert.equal(meshWarnings.length, 1)
    assert.ok(at(meshWarnings, 0).includes('borne de 8 pairs'), at(meshWarnings, 0))
  })

  it('peer-left : le pair sort du maillage, plus rien ne lui est adressé', async () => {
    const h = harness('a')
    await h.mesh.onSignal({ kind: 'peer-joined', peerId: 'b', name: 'Bob' })
    await h.mesh.onSignal({ kind: 'peer-left', peerId: 'b' })
    await h.mesh.onSignal({
      kind: 'ice',
      from: 'b',
      payload: { candidate: CANDIDATE_HOST_RFC1918, sdpMid: '0', sdpMLineIndex: 0 },
    })

    assert.deepEqual(h.mesh.peers(), [])
    assert.equal(h.sent.length, 1, 'seule l’offre initiale a été émise')
    assert.deepEqual(h.plane.remoteCandidates, [], 'un candidat d’un pair parti est ignoré')
    assert.ok(meshWarnings.some((line) => line.includes('aucun lien ouvert')), meshWarnings.join(' | '))
  })

  it('close() : ferme le plan média, vide l’état, et n’agit plus ensuite', async () => {
    const h = harness('a')
    await h.mesh.onSignal({ kind: 'peer-joined', peerId: 'b', name: 'Bob' })
    const sentBefore = h.sent.length
    h.mesh.close()

    assert.equal(h.plane.closeCalls, 1)
    assert.deepEqual(h.mesh.peers(), [])
    assert.equal(h.sent.length, sentBefore, 'close() n’émet rien : le « leave » est la charge du relais')

    h.mesh.close() // idempotent
    assert.equal(h.plane.closeCalls, 1)

    await h.mesh.onSignal({ kind: 'peer-joined', peerId: 'c', name: 'Carol' })
    await h.mesh.onSignal({ kind: 'offer', from: 'c', payload: { type: 'offer', sdp: 'offer:c' } })
    assert.equal(h.plane.attaches.length, 1, 'plus aucun geste après fermeture')
    assert.equal(h.plane.accepts.length, 0)
    assert.equal(h.sent.length, sentBefore)
  })

  it('answer rejouée : un seul acceptAnswer (l’offreur ne rejoue pas sa négociation)', async () => {
    const h = harness('a')
    await h.mesh.onSignal({ kind: 'peer-joined', peerId: 'b', name: 'Bob' })
    const answer: SignalIn = {
      kind: 'answer',
      from: 'b',
      payload: { type: 'answer', sdp: 'answer:a' },
    }
    await h.mesh.onSignal(answer)
    await h.mesh.onSignal(answer)

    assert.deepEqual(h.plane.acceptAnswers, [{ peerId: 'b', sdp: 'answer:a' }])
    // Réécrit (défaut (c), SPEC-008 §1) : la réponse SDP reçue n'est PLUS un
    // `connected` — l'ancienne assertion `['connecting','connected']` validait le
    // bug (un pair muet était dit connecté dès la fin du SDP, chien de garde
    // désarmé). La preuve de flux (`onRemoteStream`/`reportFlow`) amènera le
    // `connected`, et elle seule.
    assert.deepEqual(h.states, [{ peerId: 'b', state: 'connecting', cause: 'ice' }])
  })

  it('answer sans offre en vol : ignorée, tracée, sans exception', async () => {
    const h = harness('a')
    await h.mesh.onSignal({ kind: 'answer', from: 'b', payload: { type: 'answer', sdp: 'answer:a' } })
    assert.deepEqual(h.plane.acceptAnswers, [])
    assert.equal(meshWarnings.length, 1)
    assert.deepEqual(h.mesh.peers(), [], 'aucun lien créé par une answer orpheline')
  })

  it('deux offreurs simultanés : mon offre gagne, l’offre entrante n’est pas acceptée', async () => {
    const h = harness('a')
    await h.mesh.onSignal({ kind: 'peer-joined', peerId: 'b', name: 'Bob' })
    await h.mesh.onSignal({ kind: 'offer', from: 'b', payload: { type: 'offer', sdp: 'offre-concurrente' } })

    assert.deepEqual(h.plane.accepts, [], 'jamais deux SDP pour un même lien')
    assert.equal(h.plane.attaches.length, 1, 'et pas de seconde offre de ma part non plus')
    assert.equal(h.sent.length, 1)
    assert.ok(meshWarnings.some((line) => line.includes('offreur désigné')), meshWarnings.join(' | '))
  })

  it('offre malformée : refus tracé, aucun accept, aucun pair fantôme', async () => {
    const h = harness('b')
    await h.mesh.onSignal({ kind: 'offer', from: 'a', payload: { type: 'answer', sdp: 'x' } })
    await h.mesh.onSignal({ kind: 'offer', from: 'a', payload: { type: 'offer', sdp: '' } })
    await h.mesh.onSignal({ kind: 'offer', from: 'a', payload: null })

    assert.deepEqual(h.plane.accepts, [])
    assert.equal(meshWarnings.length, 3)
    assert.deepEqual(h.mesh.peers(), [])
  })

  it('échec du plan média : le lien passe à « failed », il est retiré, rien ne fuit', async () => {
    const h = harness('a')
    h.plane.failAttachFor = 'b'
    await h.mesh.onSignal({ kind: 'peer-joined', peerId: 'b', name: 'Bob' })

    assert.deepEqual(h.states, [
      { peerId: 'b', state: 'connecting', cause: 'ice' },
      { peerId: 'b', state: 'failed', cause: 'ice' },
    ])
    assert.deepEqual(h.mesh.peers(), [], 'un lien en échec ne reste pas annoncé')
    assert.equal(h.sent.length, 0, 'aucune offre n’est émise si attach() échoue')
    assert.ok(meshWarnings.some((line) => line.includes('attach simulé en échec')), meshWarnings.join(' | '))
  })

  it('peers() reste trié et sans doublon quel que soit l’ordre d’arrivée', async () => {
    const h = harness('m', { maxPeers: 8 })
    for (const peerId of ['z', 'a', 'k']) {
      await h.mesh.onSignal({ kind: 'peer-joined', peerId, name: peerId })
    }
    assert.deepEqual(h.mesh.peers(), ['a', 'k', 'z'], 'ordre lexicographique stable, sans doublon')
    assert.equal(new Set(h.mesh.peers()).size, 3)
  })

  it('A↔B : les deux nœuds se donnent la réplique jusqu’à l’état établi, un SDP par sens', async () => {
    const log: string[] = []
    const planeA = new FakePlane(log)
    const planeB = new FakePlane(log)
    const sentA: SignalOut[] = []
    const sentB: SignalOut[] = []
    const inboxA: SignalIn[] = []
    const inboxB: SignalIn[] = []
    const statesA: string[] = []
    const statesB: string[] = []

    const meshA = createMesh({
      localId: 'a',
      plane: planeA,
      timers: manualTimers(),
      send: (msg: SignalOut): void => {
        sentA.push(msg)
        inboxB.push(relay('a', msg))
      },
      onPeerState: (peerId: string, state: string, _cause: string): void => {
        statesA.push(`${peerId}:${state}`)
      },
    })
    const meshB = createMesh({
      localId: 'b',
      plane: planeB,
      timers: manualTimers(),
      send: (msg: SignalOut): void => {
        sentB.push(msg)
        inboxA.push(relay('b', msg))
      },
      onPeerState: (peerId: string, state: string, _cause: string): void => {
        statesB.push(`${peerId}:${state}`)
      },
    })

    // Entrée dans le salon : les deux reçoivent la présence de l'autre.
    await meshA.onSignal({ kind: 'peer-joined', peerId: 'b', name: 'Bob' })
    await meshB.onSignal({ kind: 'peer-joined', peerId: 'a', name: 'Alice' })

    // Relais : on vide les files jusqu'à stabilité (aucune attente, aucun timer).
    let guard = 0
    while ((inboxA.length > 0 || inboxB.length > 0) && guard < 50) {
      guard += 1
      const nextA = inboxA.shift()
      if (nextA !== undefined) await meshA.onSignal(nextA)
      const nextB = inboxB.shift()
      if (nextB !== undefined) await meshB.onSignal(nextB)
    }

    assert.equal(inboxA.length + inboxB.length, 0, 'la réplique se termine')
    assert.ok(guard < 50, 'elle se termine en trois tours, pas par épuisement du garde-fou')

    // Un seul SDP par sens, et pas une connexion de plus.
    assert.deepEqual(sentA.map((m) => m.kind), ['offer'])
    assert.deepEqual(sentB.map((m) => m.kind), ['answer'])
    assert.deepEqual(planeA.attaches, ['b'])
    assert.deepEqual(planeA.accepts, [])
    assert.deepEqual(planeA.acceptAnswers, [{ peerId: 'b', sdp: 'answer:a' }])
    assert.deepEqual(planeB.accepts, [{ peerId: 'a', sdp: 'offer:b' }])
    assert.deepEqual(planeB.attaches, [])
    assert.deepEqual([...planeA.connections], ['b'])
    assert.deepEqual([...planeB.connections], ['a'])

    // Réécrit (défaut (c), SPEC-008 §1) : l'ancien test assertait
    // `connected` de part et d'autre à la fin de la réplique SDP. C'était le bug :
    // les FakePlane de ce test n'émettent AUCUN flux (`level(peerId)` = null,
    // `emitStream` jamais appelé) — donc la réplique SDP seule ne prouve aucune
    // voix et ne doit promettre aucun `connected`. Les deux nœuds restent
    // `connecting`, leurs horloges de 5 s restent armées ; la preuve de flux
    // (mesurée dans le lot AD-17 ci-dessous) amènera `connected`.
    assert.deepEqual(statesA, ['b:connecting'])
    assert.deepEqual(statesB, ['a:connecting'])
    assert.deepEqual(meshA.peers(), ['b'])
    assert.deepEqual(meshB.peers(), ['a'])

    // Rejeu de l'offre après établissement : aucune seconde négociation.
    await meshB.onSignal({ kind: 'offer', from: 'a', payload: { type: 'offer', sdp: 'offer:b' } })
    assert.equal(planeB.accepts.length, 1, 'offre rejouée : toujours un seul accept')
    assert.deepEqual(sentB.map((m) => m.kind), ['answer'])
  })
})

/* ========================================================================== */
/* 2. DÉFAUT-2 (VERIF-015) — `null` est un marqueur, pas un candidat            */
/* ========================================================================== */

describe('media-plane — DÉFAUT-2 : addRemoteCandidate(remoteId, null) est un no-op', () => {
  let dom: FakeDom

  beforeEach(() => {
    dom = installFakeDom()
  })

  afterEach(() => {
    dom.restore()
  })

  it('null sur un pair établi : aucune exception, aucun candidat ajouté, aucun refus tracé', async () => {
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    await plane.startMicrophone()
    await plane.attach('b')
    const peer = dom.peerAt(0)
    const before = peer.addedCandidates.length

    await plane.addRemoteCandidate('b', null)

    assert.equal(peer.addedCandidates.length, before, 'la fin de ramassage n’est pas un candidat')
    assert.deepEqual(dom.warnings, [], 'aucun « off-lan » : un null n’est pas une anomalie réseau')
    assert.equal(FakePeerConnection.instances.length, 1, 'aucune connexion créée par un null')
  })

  it('null sur un pair inconnu : aucun pc n’est construit (le no-op ne crée rien)', async () => {
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    await plane.startMicrophone()

    await plane.addRemoteCandidate('fantôme', null)

    assert.equal(FakePeerConnection.instances.length, 0, 'un marqueur de fin ne matérialise pas un pair')
    assert.deepEqual(dom.warnings, [])
  })

  it('null intercalé entre deux vrais candidats LAN : les vrais passent, le null est ignoré', async () => {
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    await plane.startMicrophone()
    await plane.accept('b', { type: 'offer', sdp: 'v=0\r\n' })
    const peer = dom.peerAt(0)

    await plane.addRemoteCandidate('b', { candidate: CANDIDATE_HOST_RFC1918, sdpMid: '0', sdpMLineIndex: 0 })
    await plane.addRemoteCandidate('b', null)
    await plane.addRemoteCandidate('b', { candidate: CANDIDATE_HOST_MDNS, sdpMid: '0', sdpMLineIndex: 0 })

    assert.equal(peer.addedCandidates.length, 2, 'deux candidats LAN, pas trois')
    assert.equal(
      peer.addedCandidates.filter((c) => c['candidate'] === undefined).length,
      0,
      'aucun candidat « vide » n’a été poussé dans la connexion'
    )
    assert.deepEqual(dom.warnings, [])
  })
})

/* ========================================================================== */
/* 3. DÉFAUT-1 — remplacer une piste ne renégocie pas                          */
/* ========================================================================== */

describe('media-plane — DÉFAUT-1 : remplacer la piste ne déclenche aucune renégociation', () => {
  let dom: FakeDom

  beforeEach(() => {
    dom = installFakeDom()
  })

  afterEach(() => {
    dom.restore()
  })

  it('second attach() sur le même pair : une connexion, un émetteur, et replaceTrack (donc pas de 2e m-line)', async () => {
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    await plane.startMicrophone()

    await plane.attach('b')
    const peer = dom.peerAt(0)
    const sendersAfterFirst = peer.senders.length

    // Séquence d'un changement de périphérique : la piste locale est re-posée sur
    // le pair DÉJÀ négocié (c'est `attachLocalTrack` qui la porte).
    await plane.attach('b')

    assert.equal(FakePeerConnection.instances.length, 1, 'jamais une seconde RTCPeerConnection')
    assert.equal(sendersAfterFirst, 1, 'un émetteur après la première offre')
    assert.equal(peer.senders.length, 1, 'toujours un seul émetteur après remplacement')
    assert.equal(peer.tracks.length, 1, '`addTrack` une seule fois dans la vie du pair')
    assert.equal(at(peer.senders, 0).replaceTrackCalls, 1, 'la piste passe par replaceTrack')
    assert.notEqual(at(peer.senders, 0).track, null, 'la piste reste liée à l’émetteur')
    // Un SDP porte une m-line par ÉMETTEUR : un seul émetteur ⇒ une seule m-line
    // audio, donc la description déjà échangée couvre la nouvelle piste et
    // `replaceTrack` suffit — aucune renégociation n'est à déclencher.
  })

  it('attach() AVANT startMicrophone() : le addTrack tombe après la description locale — la renégociation serait requise', async () => {
    // Mesure d'un trou latent de DÉFAUT-1, PAS une garantie : si un pair est attaché
    // avant que le micro soit ouvert, `addTrack` arrive APRÈS `setLocalDescription`,
    // donc le SDP déjà parti ne porte aucun émetteur audio et personne ne re-négocie.
    // ⇒ ordre imposé à l'intégration (T16b) : `startMicrophone()` AVANT tout
    // `peer-joined` reçu par le maillage. Mesuré ici pour que l'ordre ne se devine pas.
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    const offer = await plane.attach('b')
    const peer = dom.peerAt(0)

    assert.equal(peer.senders.length, 0, 'aucun émetteur : le micro est encore fermé')
    assert.equal(peer.setLocalDescriptionCalls, 1, 'l’offre est déjà partie avec ce SDP')
    assert.equal(mlineCount(offer.sdp), 1, 'le SDP d’offre existe (doublure figée), mais sans émetteur')

    await plane.startMicrophone()

    assert.equal(peer.senders.length, 1, 'la piste arrive APRÈS la négociation')
    assert.equal(peer.createOfferCalls, 1, 'et aucune nouvelle offre n’est émise')
    assert.equal(peer.setLocalDescriptionCalls, 1, 'aucune renégociation déclenchée par le plan média')
  })
})

/* ========================================================================== */
/* 4. AD-17 / T17 — le flux porte son pair (D3), et l'horloge noFlow (DÉFAUT-E) */
/* ========================================================================== */

describe('AD-17 / T17 — flux étiqueté, unattributed compté, horloge injectée', () => {
  /** Un `MediaStream` de doublure : le maillage ne le lit pas, il l'achemine. */
  const stream = (): MediaStream => ({ id: 'stream-doublure' }) as unknown as MediaStream

  it('D3 — un flux pour un pair lié arrive ÉTIQUETÉ : onRemoteStream(peerId, stream)', async () => {
    const h = harness('a')
    await h.mesh.onSignal({ kind: 'peer-joined', peerId: 'b', name: 'b' })
    h.plane.emitStream('b', stream())
    assert.deepEqual(
      h.streams.map((entry) => entry.peerId),
      ['b'],
      'le flux est transmis avec SON pair',
    )
    assert.deepEqual(meshWarnings, [], 'aucune anomalie pour un flux attribuable')
  })

  it('D3 — un flux sans pair connu est COMPTÉ et TRACÉ, jamais rattaché au premier venu', async () => {
    const h = harness('a')
    h.plane.emitStream('inconnu', stream())
    h.plane.emitStream('autre-inconnu', stream())
    assert.deepEqual(h.streams, [], 'aucun flux transmis : un propriétaire ne se devine pas')
    assert.equal(meshWarnings.length, 2, 'deux flux orphelins, deux traces')
    assert.match(meshWarnings[0] ?? '', /unattributed: 1/, 'le compteur part de 1')
    assert.match(meshWarnings[1] ?? '', /unattributed: 2/, 'et il monte : il ne se réinitialise pas')
    assert.match(meshWarnings[0] ?? '', /inconnu/, 'le pair fautif est nommé dans la trace')
  })

  it('D3 — un flux reçu APRÈS close() est compté aussi, jamais livré', async () => {
    const h = harness('a')
    await h.mesh.onSignal({ kind: 'peer-joined', peerId: 'b', name: 'b' })
    h.mesh.close()
    h.plane.emitStream('b', stream())
    assert.deepEqual(h.streams, [])
    assert.match(meshWarnings.join(' | '), /unattributed: 1/)
  })

  /**
   * Les événements `noFlow` seulement : `peer-joined` émet légitimement `connecting`,
   * une réponse `connected`. Filtrer laisse l'assertion porter sur l'horloge, et rien
   * d'autre — sinon elle serait vraie pour la mauvaise raison.
   */
  const noFlowStates = (h: Harness) => h.states.filter((s) => s.state === 'noFlow')

  it('DÉFAUT-E — l’horloge noFlow est armée à 5 000 ms et sonne à 5 000, pas à 4 999', async () => {
    const h = harness('a')
    await h.mesh.onSignal({ kind: 'peer-joined', peerId: 'b', name: 'b' })
    assert.deepEqual([...h.timers.armed], [5000], 'un seul minuteur, et à 5 000 ms — pas 3 000')
    h.timers.fire(4999)
    assert.deepEqual(noFlowStates(h), [], 'à 4 999 ms, rien : la borne est exacte')
    h.timers.fire(5000)
    assert.deepEqual(
      noFlowStates(h),
      [{ peerId: 'b', state: 'noFlow', cause: 'timeout' }],
      'noFlow + cause timeout, une seule fois',
    )
    assert.equal(h.timers.fire(5001), 0, 'à 5 001 ms rien de plus : le noFlow ne se réarme pas')
    assert.equal(h.timers.live, 0, 'l’échéance a été désarmée en sonnant')
  })

  it('DÉFAUT-E — la réponse SDP NE désarme PLUS l’horloge : sans preuve de flux, noFlow sonne', async () => {
    // Réécrit (défaut (c), SPEC-008 §1) : l'ancien test affirmait « l’échéance est
    // désarmée à la réponse ». C'ÉTAIT LE BUG : `onAnswer()` faisait `clearClock()`
    // + `notify('connected')` à la fin du SDP, donc un pair qui ne jamais émet un
    // paquet audio restait dit « connecté » éternellement. SPEC-008 §1 : `connected`
    // exige lien établi ET flux reçu ; `noFlow` sonne exactement à 5 s sans flux.
    const h = harness('a')
    await h.mesh.onSignal({ kind: 'peer-joined', peerId: 'b', name: 'b' })
    await h.mesh.onSignal({
      kind: 'answer',
      from: 'b',
      payload: { type: 'answer', sdp: 'answer:b' },
    })
    assert.equal(h.timers.live, 1, 'la réponse SDP laisse le chien de garde ARMÉ')
    assert.deepEqual(noFlowStates(h), [], 'à 0 ms, rien : la borne est les 5 000 ms')
    // Un seul `fire()` : l'horloge manuelle est UNE Horloge virtuelle et ne se
    // rejoue pas deux fois (un `fire(4999)` viderait la file avant la borne).
    h.timers.fire(4999)
    assert.deepEqual(noFlowStates(h), [], 'à 4 999 ms, rien : la borne est exacte')
    h.timers.fire(5000)
    assert.deepEqual(
      noFlowStates(h),
      [{ peerId: 'b', state: 'noFlow', cause: 'timeout' }],
      'à 5 000 ms sans preuve de flux : noFlow + timeout',
    )
    // Le lien n'est PAS détruit : `peers()` le garde, et une preuve tardive le rétablit.
    assert.deepEqual(h.mesh.peers(), ['b'], 'noFlow ne détruit pas le lien')
    h.plane.emitStream('b', stream())
    assert.deepEqual(
      h.states.filter((s) => s.state === 'connected'),
      [{ peerId: 'b', state: 'connected', cause: 'ice' }],
      'preuve tardive (piste reçue) : le pair revient `connected`',
    )
  })

  it('DÉFAUT-E — peer-left désarme aussi l’horloge (pas d’échéance orpheline)', async () => {
    const h = harness('a')
    await h.mesh.onSignal({ kind: 'peer-joined', peerId: 'b', name: 'b' })
    await h.mesh.onSignal({ kind: 'peer-left', peerId: 'b' })
    assert.equal(h.timers.live, 0)
    h.timers.fire()
    assert.deepEqual(noFlowStates(h), [])
  })

  it('SURFACE — les sept clés du maillage sont gelées, et leur arité avec elles', () => {
    // Forme lue sur le CONTRAT (`MeshOptions`/`Mesh`, SPEC-007 §4.2 + AD-17 D3), pas sur
    // l'objet rendu : une clé ajoutée (m8 de VERIF-021 : `debug`) ou retirée doit rougir ici.
    //
    // `reportFlow` est le SEPTIÈME membre, ajouté par le défaut (c) de SPEC-008 §1 : la
    // preuve de flux par le niveau mesuré (`plane.level(peerId)` non-null) doit pouvoir
    // rejoindre le maillage sans transiter par `onRemoteStream`. Les six anciens restent
    // intacts — la surface est additive, jamais substituée.
    const h = harness('a')
    assert.deepEqual(Object.keys(h.mesh).sort(), [
      'addCandidate',
      'close',
      'onLocalCandidate',
      'onRemoteStream',
      'onSignal',
      'peers',
      'reportFlow',
    ], 'surface du maillage : exactement sept clés, nommées')
    assert.deepEqual(
      {
        onSignal: h.mesh.onSignal.length,
        onLocalCandidate: h.mesh.onLocalCandidate.length,
        addCandidate: h.mesh.addCandidate.length,
        onRemoteStream: h.mesh.onRemoteStream.length,
        close: h.mesh.close.length,
        reportFlow: h.mesh.reportFlow.length,
      },
      { onSignal: 1, onLocalCandidate: 2, addCandidate: 2, onRemoteStream: 2, close: 0, reportFlow: 1 },
      'l’arité est celle du contrat : (pair, flux) pour un flux, (pair, candidat) pour ICE, (pair) pour la preuve de niveau',
    )
  })
})
