/**
 * tests/ice-candidate-coordinates.node.test.ts — ICE entre deux machines du LAN.
 *
 * Symptôme (Linux AppImage en Ethernet ↔ Windows en Wi-Fi, même LAN, pare-feu
 * Windows coupé) : aucun flux audio, alors que le loopback et le banc e2e passent.
 *
 * Chromium refuse `addIceCandidate` avec
 * « Candidate missing values for both sdpMid and sdpMLineIndex » dès que les deux
 * coordonnées sont nulles. Le tuyau (`toWire`) ne gardait que la ligne SDP ; le
 * retour (`fromWire`) réemballait `{ candidate }`. Les candidats arrivés AVANT
 * `setRemoteDescription` peuvent être réparés au vidage de la file ; ceux arrivés
 * APRÈS — le cas réel dès que la signalisation traverse une machine — partaient
 * tels quels, et l'exception n'était pas rattrapée sur ce chemin.
 *
 * Ce fichier rejoue le fil réel (maillage → toWire → serveur local → parseServerLine
 * → fromWire → maillage → plan média) APRÈS `setRemoteDescription`, avec un
 * `addIceCandidate` qui rejette comme Chromium. Il est rouge sans le correctif.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createMesh, type Mesh } from '../src/engine/net/mesh.ts';
import {
  createLocalSignaling,
  type ReceiveResult,
  type SignalingConnection,
  type SocketLike,
} from '../src/engine/net/local-signaling.ts';
import { filterLanCandidates, isLanCandidate } from '../src/engine/rtc/ice-filter.ts';
import { createMediaPlane, type MediaPlane } from '../src/engine/rtc/media-plane.ts';
import { NO_TIMERS } from '../src/engine/timers.ts';
import { fromWire, parseServerLine, toWire } from '../src/main/signaling-link.ts';
import { installFakeDom, type FakeDom, type FakePeerConnection } from './fake-rtc.ts';

const LAN_LINE =
  'candidate:1844582201 1 udp 2122194687 192.168.1.42 51234 typ host generation 0 ufrag ab12';
const WAN_LINE = 'candidate:1844582201 1 udp 2122194687 8.8.8.8 51234 typ srflx generation 0 ufrag ab12';

/**
 * SDP distant dont le mid N'EST PAS « 0 ». Si le fil perd sdpMid et qu'on se
 * contente de réhydrater, le candidat ajouté portera « audio ». Un aller-retour
 * fidèle doit conserver le « 0 » émis par le pair.
 */
const REMOTE_SDP = [
  'v=0',
  'o=- 1 2 IN IP4 192.168.1.20',
  's=-',
  't=0 0',
  'a=group:BUNDLE audio',
  'a=ice-ufrag:remote',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'c=IN IP4 0.0.0.0',
  'a=mid:audio',
  'a=rtpmap:111 opus/48000/2',
  'a=recvonly',
  '',
].join('\r\n');

interface FakeSocket extends SocketLike {
  raw: string[];
}

function fakeSocket(): FakeSocket {
  const socket: FakeSocket = {
    raw: [],
    send(data: string): void {
      socket.raw.push(data);
    },
    close(): void {
      /* le serveur de test n'a rien à fermer au-delà de createLocalSignaling.close */
    },
  };
  return socket;
}

function joinedPeerId(result: ReceiveResult, who: string): string {
  if (!result.ok || !('peerId' in result)) {
    throw new Error(`join ${who} refusé : ${JSON.stringify(result)}`);
  }
  return result.peerId;
}

/**
 * Le chemin de sérialisation réel : émission du maillage, relais du serveur
 * (filtre LAN inclus), ligne relue par le parseur, charge utile rendue au pair.
 */
function crossedWire(payload: unknown): unknown {
  const wire = toWire({ kind: 'ice', to: 'peer', payload });
  assert.ok(wire !== null && wire.type === 'ice', 'le candidat LAN doit sortir sur le fil');
  const server = createLocalSignaling({ now: () => 1000 });
  try {
    const aliceSock = fakeSocket();
    const alice: SignalingConnection = server.handleConnection(aliceSock);
    const bobSock = fakeSocket();
    const bob: SignalingConnection = server.handleConnection(bobSock);
    const bobId = joinedPeerId(bob.receive({ type: 'join', name: 'Bob' }), 'Bob');
    joinedPeerId(alice.receive({ type: 'join', name: 'Alice' }), 'Alice');
    const relayed = alice.receive({ type: 'ice', to: bobId, candidate: wire.candidate });
    assert.equal(
      relayed.ok,
      true,
      `le serveur doit relayer le candidat LAN (enveloppe comprise), pas le classer hors LAN : ${JSON.stringify(relayed)}`,
    );
    const raw = bobSock.raw.find((line) => line.includes('"type":"ice"'));
    assert.ok(raw !== undefined, 'le pair doit recevoir une ligne ice');
    const message = parseServerLine(raw);
    assert.ok(message !== null && message.type === 'ice');
    const back = fromWire(message);
    assert.ok(back !== null && back.kind === 'ice');
    return back.payload;
  } finally {
    server.close();
  }
}

/** Même rejet que Chromium : les deux coordonnées absentes lèvent, le candidat n'est pas ajouté. */
function rejectBareCandidates(peer: FakePeerConnection): void {
  const original = peer.addIceCandidate.bind(peer);
  peer.addIceCandidate = async (candidate: Record<string, unknown>): Promise<void> => {
    const mid = candidate['sdpMid'];
    const index = candidate['sdpMLineIndex'];
    const hasMid = typeof mid === 'string' && mid.length > 0;
    const hasIndex = typeof index === 'number' && Number.isFinite(index);
    if (!hasMid && !hasIndex) {
      throw new Error('Candidate missing values for both sdpMid and sdpMLineIndex');
    }
    await original(candidate);
  };
}

interface Session {
  dom: FakeDom;
  plane: MediaPlane;
  mesh: Mesh;
  close(): void;
}

async function openSession(): Promise<Session> {
  const dom = installFakeDom();
  const plane = createMediaPlane({ localId: 'p1', timers: NO_TIMERS });
  await plane.startMicrophone();
  const mesh = createMesh({
    localId: 'p1',
    plane,
    timers: NO_TIMERS,
    send: () => undefined,
  });
  await mesh.onSignal({ kind: 'peer-joined', peerId: 'p2', name: 'Bob' });
  return {
    dom,
    plane,
    mesh,
    close(): void {
      mesh.close();
      dom.restore();
    },
  };
}

test('le plan média émet usernameFragment avec les coordonnées du candidat local', async () => {
  const dom = installFakeDom();
  try {
    const sent: Array<RTCIceCandidateInit | null> = [];
    const plane = createMediaPlane({
      localId: 'p1',
      timers: NO_TIMERS,
      onLocalCandidate: (_peerId, candidate) => {
        sent.push(candidate);
      },
    });
    await plane.attach('p2');
    const handler = dom.peerAt(0).onicecandidate;
    assert.ok(handler !== null);
    handler({
      candidate: {
        candidate: LAN_LINE,
        sdpMid: '0',
        sdpMLineIndex: 0,
        usernameFragment: 'ab12',
      },
    });
    assert.equal(sent.length, 1);
    const got = sent[0];
    assert.ok(got !== null && got !== undefined);
    assert.equal(got.candidate, LAN_LINE);
    assert.equal(got.sdpMid, '0');
    assert.equal(got.sdpMLineIndex, 0);
    assert.equal(got.usernameFragment, 'ab12');
    plane.close();
  } finally {
    dom.restore();
  }
});

test('isLanCandidate accepte une enveloppe JSON LAN et refuse une enveloppe publique', () => {
  const lan = JSON.stringify({
    candidate: LAN_LINE,
    sdpMid: '0',
    sdpMLineIndex: 0,
    usernameFragment: 'ab12',
  });
  const wan = JSON.stringify({ candidate: WAN_LINE, sdpMid: '0', sdpMLineIndex: 0 });
  assert.equal(isLanCandidate(lan), true, 'le serveur doit voir l’adresse LAN sous le JSON');
  assert.equal(isLanCandidate(wan), false, 'un srflx emballé reste hors LAN');
  assert.deepEqual(filterLanCandidates([lan, wan]), [lan], 'le relais doit garder l’enveloppe intacte');
});

test('candidat trickle APRÈS setRemoteDescription : sdpMid, sdpMLineIndex et usernameFragment survivent au fil', async () => {
  const session = await openSession();
  try {
    rejectBareCandidates(session.dom.peerAt(0));
    await session.mesh.onSignal({
      kind: 'answer',
      from: 'p2',
      payload: { type: 'answer', sdp: REMOTE_SDP },
    });
    const payload = crossedWire({
      candidate: LAN_LINE,
      sdpMid: '0',
      sdpMLineIndex: 0,
      usernameFragment: 'ab12',
    });
    await session.mesh.onSignal({ kind: 'ice', from: 'p2', payload });

    const added = session.dom.peerAt(0).addedCandidates;
    assert.equal(added.length, 1, 'le candidat doit atteindre addIceCandidate');
    const got = added[0];
    assert.ok(got !== undefined);
    assert.equal(got['candidate'], LAN_LINE);
    assert.equal(got['sdpMid'], '0', 'sdpMid émis, pas le mid du SDP distant');
    assert.equal(got['sdpMLineIndex'], 0);
    assert.equal(got['usernameFragment'], 'ab12');
    assert.equal(
      session.dom.warnings.some((line) => line.includes('addIceCandidate') && line.includes('rejeté')),
      false,
      `aucun rejet Chromium attendu : ${session.dom.warnings.join(' | ')}`,
    );
  } finally {
    session.close();
  }
});

test('pair ancien (ligne SDP nue) APRÈS setRemoteDescription : les coordonnées sont réhydratées depuis le SDP', async () => {
  const session = await openSession();
  try {
    rejectBareCandidates(session.dom.peerAt(0));
    await session.mesh.onSignal({
      kind: 'answer',
      from: 'p2',
      payload: { type: 'answer', sdp: REMOTE_SDP },
    });
    // Forme d'avant le correctif : toWire ne connaissait que la chaîne.
    const payload = crossedWire(LAN_LINE);
    await session.mesh.onSignal({ kind: 'ice', from: 'p2', payload });

    const added = session.dom.peerAt(0).addedCandidates;
    assert.equal(added.length, 1, 'un candidat legacy doit quand même être ajouté');
    const got = added[0];
    assert.ok(got !== undefined);
    assert.equal(got['candidate'], LAN_LINE);
    assert.equal(got['sdpMid'], 'audio', 'le mid vient du a=mid du SDP distant');
    assert.equal(got['sdpMLineIndex'], 0);
  } finally {
    session.close();
  }
});

test('pair ancien en file AVANT setRemoteDescription : le vidage réhydrate avant addIceCandidate', async () => {
  const session = await openSession();
  try {
    rejectBareCandidates(session.dom.peerAt(0));
    const payload = crossedWire(LAN_LINE);
    await session.mesh.onSignal({ kind: 'ice', from: 'p2', payload });
    assert.equal(session.dom.peerAt(0).addedCandidates.length, 0, 'sans description distante, on n’ajoute pas');
    await session.mesh.onSignal({
      kind: 'answer',
      from: 'p2',
      payload: { type: 'answer', sdp: REMOTE_SDP },
    });

    const added = session.dom.peerAt(0).addedCandidates;
    assert.equal(added.length, 1, 'la file doit ajouter le candidat réhydraté');
    const got = added[0];
    assert.ok(got !== undefined);
    assert.equal(got['sdpMid'], 'audio');
    assert.equal(got['sdpMLineIndex'], 0);
  } finally {
    session.close();
  }
});

test('addIceCandidate qui rejette sur le chemin direct est journalisé et n’échappe pas', async () => {
  const session = await openSession();
  try {
    await session.mesh.onSignal({
      kind: 'answer',
      from: 'p2',
      payload: { type: 'answer', sdp: REMOTE_SDP },
    });
    const peer = session.dom.peerAt(0);
    peer.addIceCandidate = async (): Promise<void> => {
      throw new Error('Candidate missing values for both sdpMid and sdpMLineIndex');
    };
    await session.plane.addRemoteCandidate('p2', {
      candidate: LAN_LINE,
      sdpMid: '0',
      sdpMLineIndex: 0,
    });
    assert.ok(
      session.dom.warnings.some(
        (line) => line.includes('addIceCandidate') && line.includes('sdpMLineIndex'),
      ),
      `le rejet doit être tracé par le plan média : ${session.dom.warnings.join(' | ')}`,
    );
  } finally {
    session.close();
  }
});
