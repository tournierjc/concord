/**
 * tests/media-plane.test.ts — critères A2→A6 de SPEC-006 §6, sans Chromium (Carillon, T15a)
 *
 * Ce fichier est la **falsification** du plan média : il remplace le binding
 * WebRTC (`RTCPeerConnection`, `MediaStream`, `AudioContext`, `navigator`) par
 * les doublures de `tests/fake-rtc.ts`, puis observe ce que
 * `src/engine/rtc/media-plane.ts` fait réellement.
 *
 * Pourquoi pas Chromium : dans cette image, `electron --version` sort EXIT=127
 * (26 `.so` absentes : libgtk-3, libglib, libX11, libasound…). Un faux
 * `RTCPeerConnection` en Node est donc le seul oracle disponible — et il suffit,
 * parce que les cinq critères portent sur des décisions **du code appelant**
 * (combien de connexions, quelle config, quels candidats, quel SDP), pas sur
 * l'encodage réel fait par le navigateur.
 *
 *   A2 push-to-talk : `setTransmitting(false)` ⇒ `track.enabled === false` sur TOUS les pairs
 *   A3 maillage     : N pairs ⇒ N constructions, aucune `RTCPeerConnection` réutilisée
 *   A4 étanchéité   : `iceServers` reçu par le constructeur === [] TOUJOURS, même avec STUN/TURN
 *   A5 filtre LAN   : srflx / relay / prflx / host public REFUSÉS explicitement et jamais ajoutés
 *   A6 Opus 32 kbps : SDP émis porte `maxaveragebitrate=32000`, `stereo=0`, `useinbandfec=1`
 *
 * Ce que ce fichier ne prouve PAS : que l'audio sort des haut-parleurs. Il
 * prouve que le plan média fait les cinq gestes que la SPEC exige ; le reste
 * (encodage Opus réel, ICE réel) n'est observable que dans un vrai runtime.
 */

import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createMediaPlane } from '../src/engine/rtc/media-plane.ts'
// AD-18 / D3 : `timers` est REQUIS sur `MediaPlaneOptions` ; ce fichier mesure le filtrage
// ICE, pas le plafond de ramassage — il passe donc l'horloge inerte, site par site.
import { NO_TIMERS } from '../src/engine/timers.ts'
import {
  CANDIDATE_HOST_LOOPBACK,
  CANDIDATE_HOST_MDNS,
  CANDIDATE_HOST_PUBLIC,
  CANDIDATE_HOST_RFC1918,
  CANDIDATE_HOST_ULA,
  CANDIDATE_PRFLX,
  CANDIDATE_RELAY,
  CANDIDATE_SRFLX,
  ANSWER_SDP,
  OFFER_SDP,
  FakeMediaStream,
  FakePeerConnection,
  FakeTrack,
  type FakeDom,
  installFakeDom,
} from './fake-rtc.ts'

let dom: FakeDom

beforeEach(() => {
  dom = installFakeDom()
})

afterEach(() => {
  dom.restore()
})

/* ------------------------------------------------------------------------- */
/* Le harnais lui-même : s'il est inerte, tout le reste serait un faux positif */
/* ------------------------------------------------------------------------- */

describe('harnais — les globals vus par media-plane.ts sont bien les doublures', () => {
  it('RTCPeerConnection / MediaStream / AudioContext / navigator sont remplacés', () => {
    assert.equal(Reflect.get(globalThis, 'RTCPeerConnection'), FakePeerConnection)
    assert.equal(Reflect.get(globalThis, 'MediaStream'), FakeMediaStream)
    assert.equal(typeof Reflect.get(globalThis, 'AudioContext'), 'function')
    const navigatorLike = Reflect.get(globalThis, 'navigator')
    assert.equal(typeof navigatorLike.mediaDevices.getUserMedia, 'function')
  })

  it('après restore(), les globals d’origine sont rendus', () => {
    dom.restore()
    assert.equal(Reflect.get(globalThis, 'RTCPeerConnection'), undefined)
    assert.equal(Reflect.get(globalThis, 'MediaStream'), undefined)
    // Le harnais ne doit pas laisser de faux DOM derrière lui : le before
    // réinstallera, mais un test qui oublie restore() doit être visible.
    dom = installFakeDom()
  })
})

/* ------------------------------------------------------------------------- */
/* A2 — push-to-talk : micro coupé au repos, sur chaque pair                  */
/* ------------------------------------------------------------------------- */

describe('A2 — setTransmitting(on) pilote track.enabled sur TOUS les pairs', () => {
  it('A2 — micro coupé au repos dès startMicrophone()', async () => {
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    await plane.startMicrophone()
    const track = dom.micTrack()
    assert.equal(track.enabled, false, 'au repos le micro doit être fermé (PTT)')
    assert.deepEqual(track.enabledWrites, [false], 'une seule écriture : la fermeture initiale')
    plane.close()
  })

  it('A2 — 3 pairs : setTransmitting(false) coupe le micro sur chacun des 3 émetteurs', async () => {
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    // Un pair AVANT le micro (la piste lui est branchée pendant startMicrophone),
    // deux APRÈS (elle leur est branchée pendant attach) : les deux chemins de
    // attachLocalTrack sont donc exercés.
    await plane.attach('pair-1')
    await plane.startMicrophone()
    await plane.attach('pair-2')
    await plane.attach('pair-3')

    assert.equal(dom.peers.length, 3, 'trois pairs distants = trois connexions')
    assert.equal(dom.gumCalls.length, 1, 'un seul getUserMedia, partagé par les pairs')

    const mic = dom.micTrack()
    const senders = dom.peers.map((peer) => peer.senders[0])
    for (const [index, sender] of senders.entries()) {
      assert.ok(sender !== undefined, `le pair ${index} doit avoir un émetteur audio`)
      assert.equal(sender.track, mic, `le pair ${index} doit émettre LA piste micro (même objet)`)
    }

    plane.setTransmitting(true)
    for (const [index, peer] of dom.peers.entries()) {
      assert.equal(peer.senders[0]?.track?.enabled, true, `appui : pair ${index} doit être ouvert`)
    }

    plane.setTransmitting(false)
    for (const [index, peer] of dom.peers.entries()) {
      assert.equal(peer.senders[0]?.track?.enabled, false, `relâchement : pair ${index} doit être coupé`)
    }

    // La piste est un objet unique partagé : l'état ne peut pas diverger d'un
    // pair à l'autre, et la séquence d'écritures le montre.
    assert.deepEqual(mic.enabledWrites, [false, true, false], 'séquence PTT : coupé → ouvert → coupé')
    plane.close()
  })

  it('A2 — setTransmitting(true) n’ouvre QUE le micro, jamais un flux distant', async () => {
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    await plane.startMicrophone()
    await plane.attach('pair-1')
    const remote = new FakeTrack()
    dom.fireTrack(dom.peerAt(0), new FakeMediaStream([remote]), remote)
    plane.setTransmitting(true)
    assert.equal(dom.micTrack().enabled, true, 'micro ouvert par l’appui')
    assert.deepEqual(remote.enabledWrites, [], 'une piste distante ne doit jamais être touchée')
    plane.close()
  })

  it('A2 — setTransmitting avant startMicrophone : refus tracé, aucun plantage', () => {
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    plane.setTransmitting(true)
    assert.ok(
      dom.warnings.some((line) => line.includes('setTransmitting ignoré')),
      `un refus silencieux serait un bug : ${JSON.stringify(dom.warnings)}`
    )
    plane.close()
  })
})

/* ------------------------------------------------------------------------- */
/* A3 — une connexion par pair, jamais réutilisée                             */
/* ------------------------------------------------------------------------- */

describe('A3 — N pairs ⇒ N constructions, aucune RTCPeerConnection réutilisée', () => {
  it('A3 — 4 pairs (3 attach + 1 accept) ⇒ 4 connexions distinctes', async () => {
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    await plane.attach('b')
    await plane.attach('c')
    await plane.attach('d')
    await plane.accept('e', { type: 'offer', sdp: OFFER_SDP })

    assert.equal(FakePeerConnection.instances.length, 4, 'une construction par pair distant')
    const unique = new Set(dom.peers)
    assert.equal(unique.size, 4, 'aucune instance partagée entre deux pairs')
    for (const peer of dom.peers) {
      assert.equal(peer.closed, false, 'aucune connexion fermée en cours de route')
      assert.equal(peer.createOfferCalls + peer.createAnswerCalls >= 1, true, 'chaque pair négocie')
    }
    plane.close()
  })

  it('A3 — ré-attacher le même pair ne crée pas de seconde connexion', async () => {
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    await plane.attach('b')
    await plane.attach('b')
    await plane.attach('b')
    assert.equal(FakePeerConnection.instances.length, 1, 'un pair = une connexion, même réattaché')
    assert.equal(dom.peerAt(0).createOfferCalls, 3, 'trois offres sur la même connexion')
    plane.close()
  })

  it('A3 — l’état d’un pair ne fuit pas vers un autre (candidats et stats séparés)', async () => {
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    await plane.attach('b')
    await plane.attach('c')
    await plane.acceptAnswer('b', { type: 'answer', sdp: ANSWER_SDP })
    await plane.acceptAnswer('c', { type: 'answer', sdp: ANSWER_SDP })
    await plane.addRemoteCandidate('b', { candidate: CANDIDATE_HOST_RFC1918, sdpMid: '0', sdpMLineIndex: 0 })
    assert.equal(dom.peers[0]?.addedCandidates.length, 1, 'le candidat de b va à b')
    assert.equal(dom.peers[1]?.addedCandidates.length, 0, 'le pair c ne doit rien recevoir')

    const statsB = await plane.stats('b')
    assert.deepEqual(statsB, { bytesSent: 1200, bytesReceived: 3400, packetsLost: 2, rttMs: 13 })
    plane.close()
  })

  it('A3 — close() ferme toutes les connexions construites', async () => {
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    await plane.attach('b')
    await plane.attach('c')
    plane.close()
    for (const [index, peer] of dom.peers.entries()) {
      assert.equal(peer.closed, true, `pair ${index} doit être fermé`)
      assert.equal(peer.onicecandidate, null, `pair ${index} ne doit plus émettre de candidat`)
    }
  })
})

/* ------------------------------------------------------------------------- */
/* A4 — iceServers === [] TOUJOURS                                            */
/* ------------------------------------------------------------------------- */

describe('A4 — iceServers reçu par le constructeur est === [] toujours', () => {
  it('A4 — sans rtcConfig : iceServers === [] sur chaque connexion', async () => {
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    await plane.attach('b')
    await plane.attach('c')
    for (const [index, peer] of dom.peers.entries()) {
      const servers = peer.config['iceServers']
      assert.equal(Array.isArray(servers), true, `pair ${index} : iceServers doit être un tableau`)
      assert.equal((servers as unknown[]).length, 0, `pair ${index} : iceServers doit être vide`)
    }
    plane.close()
  })

  it('A4 — appelant avec STUN + TURN : iceServers === [] quand même, aucun URI ne survit', async () => {
    const plane = createMediaPlane({
      localId: 'a',
      timers: NO_TIMERS,
      rtcConfig: {
        iceServers: [
          { urls: 'stun:stun.example.org:3478' },
          { urls: ['turn:turn.example.org:3478'], username: 'u', credential: 'p' },
          { urls: 'stuns:stuns.example.org' },
        ],
        iceTransportPolicy: 'relay',
        iceCandidatePoolSize: 4,
      },
    })
    await plane.attach('b')
    await plane.attach('c')

    for (const [index, peer] of dom.peers.entries()) {
      const servers = peer.config['iceServers']
      assert.equal(Array.isArray(servers), true, `pair ${index} : iceServers doit rester un tableau`)
      assert.equal(
        (servers as unknown[]).length,
        0,
        `pair ${index} : un serveur fourni par l'appelant a survécu (${JSON.stringify(servers)})`
      )
      // Une politique 'relay' imposée par l'appelant rouvrirait la porte au TURN : elle est ignorée.
      assert.equal(peer.config['iceTransportPolicy'], 'all', `pair ${index} : politique ICE non neutralisée`)
      const serialized = JSON.stringify(peer.config)
      for (const forbidden of ['stun:', 'stuns:', 'turn:', 'turns:']) {
        assert.equal(
          serialized.includes(forbidden),
          false,
          `pair ${index} : « ${forbidden} » présent dans la configuration`
        )
      }
    }
    plane.close()
  })

  it('A4 — la configuration est identique pour tous les pairs, et figée sur []', async () => {
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    await plane.attach('b')
    await plane.attach('c')
    const first = dom.peers[0]?.config['iceServers']
    const second = dom.peers[1]?.config['iceServers']
    assert.equal(Array.isArray(first) && Array.isArray(second), true)
    assert.equal((first as unknown[]).length, 0)
    assert.equal((second as unknown[]).length, 0)
    plane.close()
  })
})

/* ------------------------------------------------------------------------- */
/* A5 — filtre LAN : refus explicite, jamais ajouté                           */
/* ------------------------------------------------------------------------- */

describe('A5 — candidats hors LAN refusés explicitement, jamais transmis ni ajoutés', () => {
  it('A5 — candidats LOCAUX : srflx / relay / prflx / host public refusés avec une trace', async () => {
    const sent: string[] = []
    const plane = createMediaPlane({
      localId: 'a',
      timers: NO_TIMERS,
      onLocalCandidate: (peerId, candidate) => {
        // T17 : le pair émetteur est porté par le callback ; `null` = fin de ramassage.
        sent.push(`${peerId}:${candidate?.candidate ?? 'FIN'}`)
      },
    })
    await plane.attach('b')
    const peer = dom.peerAt(0)

    for (const refused of [CANDIDATE_SRFLX, CANDIDATE_RELAY, CANDIDATE_PRFLX, CANDIDATE_HOST_PUBLIC]) {
      dom.fireIceCandidate(peer, refused)
      assert.equal(sent.length, 0, `candidat refusé mais transmis : ${refused}`)
    }
    const refusals = dom.warnings.filter((line) => line.includes('REFUSÉ'))
    assert.equal(refusals.length, 4, `un refus doit être tracé, un par candidat : ${JSON.stringify(dom.warnings)}`)
    for (const line of refusals) {
      assert.ok(line.includes('pour b'), `la trace doit nommer le pair concerné : ${line}`)
      assert.ok(line.includes('candidate:'), `la trace doit citer le candidat refusé : ${line}`)
    }
    plane.close()
  })

  it('A5 — candidats LOCAUX host privés / mDNS / loopback / ULA transmis tels quels', async () => {
    const sent: Array<{ candidate?: string; sdpMid?: string | null; sdpMLineIndex?: number | null }> = []
    const plane = createMediaPlane({
      localId: 'a',
      timers: NO_TIMERS,
      onLocalCandidate: (peerId, candidate) => {
        assert.equal(peerId, 'b', 'le candidat local doit nommer le pair émetteur (T17)')
        if (candidate !== null) sent.push(candidate)
      },
    })
    await plane.attach('b')
    const peer = dom.peerAt(0)
    const accepted = [CANDIDATE_HOST_RFC1918, CANDIDATE_HOST_MDNS, CANDIDATE_HOST_LOOPBACK, CANDIDATE_HOST_ULA]
    for (const candidate of accepted) dom.fireIceCandidate(peer, candidate)

    assert.deepEqual(
      sent.map((candidate) => candidate.candidate),
      accepted,
      'les quatre candidats LAN doivent être transmis dans l’ordre'
    )
    for (const candidate of sent) {
      assert.equal(candidate.sdpMid, '0', 'sdpMid doit être conservé')
      assert.equal(candidate.sdpMLineIndex, 0, 'sdpMLineIndex doit être conservé')
    }
    dom.fireIceCandidate(peer, null) // fin de collecte
    assert.equal(sent.length, 4, 'la fin de collecte (candidate null) n’est pas un candidat')
    assert.equal(
      dom.warnings.filter((line) => line.includes('REFUSÉ')).length,
      0,
      'aucun refus ne doit être tracé pour des candidats LAN'
    )
    plane.close()
  })

  it('A5 — candidats DISTANTS hors LAN : refusés, jamais ajoutés, jamais mis en file', async () => {
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    await plane.attach('b')
    const peer = dom.peerAt(0)

    for (const refused of [CANDIDATE_SRFLX, CANDIDATE_RELAY, CANDIDATE_PRFLX, CANDIDATE_HOST_PUBLIC]) {
      await plane.addRemoteCandidate('b', { candidate: refused, sdpMid: '0', sdpMLineIndex: 0 })
    }
    await plane.acceptAnswer('b', { type: 'answer', sdp: ANSWER_SDP })
    assert.equal(peer.addedCandidates.length, 0, 'aucun candidat hors LAN ne doit atteindre addIceCandidate')
    assert.equal(
      dom.warnings.filter((line) => line.includes('REFUSÉ')).length,
      4,
      `chaque refus distant doit être tracé : ${JSON.stringify(dom.warnings)}`
    )
    plane.close()
  })

  it('A5 — candidats DISTANTS LAN : mis en file puis ajoutés après la description distante', async () => {
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    await plane.attach('b')
    const peer = dom.peerAt(0)

    await plane.addRemoteCandidate('b', { candidate: CANDIDATE_HOST_RFC1918, sdpMid: '0', sdpMLineIndex: 0 })
    await plane.addRemoteCandidate('b', { candidate: CANDIDATE_SRFLX, sdpMid: '0', sdpMLineIndex: 0 })
    await plane.addRemoteCandidate('b', { candidate: CANDIDATE_HOST_MDNS, sdpMid: '0', sdpMLineIndex: 0 })
    assert.equal(peer.addedCandidates.length, 0, 'sans description distante, les candidats attendent en file')

    await plane.acceptAnswer('b', { type: 'answer', sdp: ANSWER_SDP })
    assert.deepEqual(
      peer.addedCandidates.map((candidate) => candidate['candidate']),
      [CANDIDATE_HOST_RFC1918, CANDIDATE_HOST_MDNS],
      'la file rend les seuls candidats LAN, dans l’ordre'
    )
    plane.close()
  })
})

/* ------------------------------------------------------------------------- */
/* A6 — Opus 32 kbps mono + FEC dans le SDP émis                              */
/* ------------------------------------------------------------------------- */

/** Les trois paramètres fmtp exigés par SPEC-005 §2. */
const OPUS_TOKENS = ['maxaveragebitrate=32000', 'stereo=0', 'useinbandfec=1'] as const

function assertOpusSdp(label: string, sdp: string | undefined): void {
  assert.ok(sdp !== undefined && sdp.length > 0, `${label} : SDP absent`)
  for (const token of OPUS_TOKENS) {
    assert.ok(sdp.includes(token), `${label} : « ${token} » absent du SDP\n${sdp}`)
  }
  assert.equal(sdp.includes('stereo=1'), false, `${label} : stéréo encore annoncée`)
  assert.ok(sdp.includes('a=rtpmap:111 opus/48000/2'), `${label} : le rtpmap Opus doit être conservé`)
}

describe('A6 — SDP émis : maxaveragebitrate=32000, stereo=0, useinbandfec=1', () => {
  it('A6 — l’offre porte les trois paramètres', async () => {
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    const offer = await plane.attach('b')
    assert.equal(offer.type, 'offer')
    assertOpusSdp('offre', offer.sdp)
    plane.close()
  })

  it('A6 — le SDP mungé est bien celui posé en description locale (pas un SDP jumeau)', async () => {
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    const offer = await plane.attach('b')
    const local = dom.peerAt(0).localDescription
    assert.ok(local !== null, 'setLocalDescription doit avoir été appelé')
    assert.equal(local['sdp'], offer.sdp, 'la description locale doit être exactement le SDP mungé')
    assert.equal(local['type'], 'offer')
    plane.close()
  })

  it('A6 — la réponse porte les trois paramètres, et garde les paramètres d’origine', async () => {
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    const answer = await plane.accept('b', { type: 'offer', sdp: OFFER_SDP })
    assert.equal(answer.type, 'answer')
    assertOpusSdp('réponse', answer.sdp)
    const sdp = answer.sdp ?? ''
    assert.ok(sdp.includes('minptime=10'), 'les paramètres fmtp non imposés doivent survivre')
    assert.equal((sdp.match(/maxaveragebitrate=/g) ?? []).length, 1, 'un seul maxaveragebitrate (idempotence)')
    plane.close()
  })

  it('A6 — corollaire émetteur : setParameters fixe maxBitrate = 32000 sur l’encodage', async () => {
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    await plane.startMicrophone()
    await plane.attach('b')
    const sender = dom.peerAt(0).senders[0]
    assert.ok(sender !== undefined, 'un émetteur doit être créé')
    assert.equal(sender.setParametersCalls, 1, 'setParameters doit être appliqué une fois')
    assert.equal(sender.parameters.encodings[0]?.maxBitrate, 32000)
    assert.ok(sender.lastParameters !== null, 'setParameters doit recevoir les paramètres complets')
    plane.close()
  })
})

/* ------------------------------------------------------------------------- */
/* A7 — ORDRE micro → attach : le lien né sourd doit être TRACÉ, jamais muet */
/* ------------------------------------------------------------------------- */

describe('A7 — attach/accept avant startMicrophone() : négocié sans audio, et tracé', () => {
  it('A7 — attach() sans piste locale : une seule trace par pair, nommée, avec le remède', async () => {
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    await plane.attach('pair-1')
    await plane.attach('pair-1') // même pair : une trace, pas deux
    const traces = dom.warnings.filter((line) => line.includes('SANS piste locale'))
    assert.equal(traces.length, 1, `une trace par pair, pas par appel : ${JSON.stringify(dom.warnings)}`)
    assert.ok(traces[0]?.includes('pair-1'), 'la trace doit nommer le pair fautif')
    assert.ok(traces[0]?.includes('startMicrophone()'), 'la trace doit nommer l’ordre attendu')
    assert.ok(traces[0]?.includes('aucune voix'), 'la trace doit nommer la conséquence')
    plane.close()
  })

  it('A7 — le fait mécanique : la description négociée sans piste ne porte AUCUN émetteur', async () => {
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    await plane.attach('pair-1')
    // setLocalDescription a déjà eu lieu : la description est partie sans audio.
    assert.ok(dom.peerAt(0).localDescription !== null, 'la description locale est déjà posée')
    assert.equal(dom.peerAt(0).senders.length, 0, 'aucun émetteur : le pair distant n’entendra rien')
    // Le micro arrive après : la piste est branchée, mais sur un lien déjà négocié.
    await plane.startMicrophone()
    assert.equal(dom.peerAt(0).senders.length, 1, 'la piste est branchée tardivement, après la négociation')
    plane.close()
  })

  it('A7 — accept() avant le micro trace aussi ; l’ordre correct (micro d’abord) ne trace RIEN', async () => {
    const plane = createMediaPlane({ localId: 'a', timers: NO_TIMERS })
    await plane.accept('pair-x', { type: 'offer', sdp: OFFER_SDP })
    const traces = dom.warnings.filter((line) => line.includes('SANS piste locale'))
    assert.equal(traces.length, 1, `accept() doit tracer comme attach() : ${JSON.stringify(dom.warnings)}`)
    assert.ok(traces[0]?.includes('pair-x'))

    const clean = dom.warnings.length
    await plane.startMicrophone()
    await plane.attach('pair-y')
    await plane.attach('pair-y')
    assert.equal(
      dom.warnings.filter((line) => line.includes('SANS piste locale')).length,
      1,
      `l’ordre correct ne doit rien tracer : ${JSON.stringify(dom.warnings.slice(clean))}`
    )
    plane.close()
  })
})
