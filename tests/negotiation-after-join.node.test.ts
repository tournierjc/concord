/**
 * tests/negotiation-after-join.node.test.ts — après un join, une offre part.
 *
 * Production : les deux postes ouvrent le maillage avec localId `'self'` (id d'UI,
 * identique des deux côtés). Les ids du serveur sont `p1`/`p2`. `'self' > 'pN'`, donc
 * les deux se déclaraient answerer : le salon voyait hello + join, puis plus aucun
 * offer/answer/ice. L'id `pair=` du lien (ou posé quand le renderer l'apprend) désigne
 * le plus petit id comme seul offreur.
 *
 * Le second test rejoue deux postes sur un VRAI hôte TCP, les deux en `'self'`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createMesh, type Mesh, type SignalIn, type SignalOut } from '../src/engine/net/mesh.ts';
import { createMediaPlane } from '../src/engine/rtc/media-plane.ts';
import { NO_TIMERS } from '../src/engine/timers.ts';
import { createSignalingLink, type SignalingLink } from '../src/main/signaling-link.ts';
import {
  FakeMediaStream,
  FakePeerConnection,
  FakeTrack,
  installFakeDom,
} from './fake-rtc.ts';

const OFFER_SDP = 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
const LAN = 'candidate:1 1 udp 2122260223 192.168.1.70 54321 typ host generation 0';

interface Plane {
  attach(id: string): Promise<RTCSessionDescriptionInit>;
  accept(id: string, offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit>;
  acceptAnswer(id: string, answer: RTCSessionDescriptionInit): Promise<void>;
  addRemoteCandidate(id: string, c: RTCIceCandidateInit | null): Promise<void>;
  close(): void;
}

function plane(): Plane {
  return {
    async attach() {
      return { type: 'offer', sdp: OFFER_SDP };
    },
    async accept() {
      return { type: 'answer', sdp: OFFER_SDP };
    },
    async acceptAnswer() {},
    async addRemoteCandidate() {},
    close() {},
  };
}

test('localId self, pair-joined avant le lien : p1 rattrape l’offre, p2 reste answerer', async () => {
  const sentHost: SignalOut[] = [];
  const host = createMesh({
    localId: 'self',
    plane: plane() as never,
    timers: NO_TIMERS,
    send: (message) => sentHost.push(message),
  });
  await host.onSignal({ kind: 'peer-joined', peerId: 'p2', name: 'krillin' });
  assert.equal(sentHost.filter((message) => message.kind === 'offer').length, 0, 'sans id serveur, self n’offre pas encore');
  await host.onSignal({ kind: 'link', state: 'connected', detail: 'pair=p1 port=47821' });
  assert.equal(sentHost.filter((message) => message.kind === 'offer').length, 1, 'p1 < p2 : l’hôte offre');

  const sentClient: SignalOut[] = [];
  const client = createMesh({
    localId: 'self',
    plane: plane() as never,
    timers: NO_TIMERS,
    send: (message) => sentClient.push(message),
  });
  await client.onSignal({ kind: 'peer-joined', peerId: 'p1', name: 'jeanjean' });
  await client.onSignal({ kind: 'link', state: 'connected', detail: 'pair=p2 port=47821' });
  assert.equal(sentClient.filter((message) => message.kind === 'offer').length, 0, 'p2 > p1 : le client n’offre pas');
  const offer = sentHost.find((message) => message.kind === 'offer');
  assert.ok(offer !== undefined && offer.kind === 'offer');
  await client.onSignal({ kind: 'offer', from: 'p1', payload: offer.payload });
  assert.equal(sentClient.filter((message) => message.kind === 'answer').length, 1);
  host.close();
  client.close();
});

async function eventually(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition jamais atteinte');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('deux postes localId self sur un vrai hôte : offer, answer, ice, puis connected', async () => {
  const dom = installFakeDom();
  const links: SignalingLink[] = [];
  const meshes: Mesh[] = [];
  try {
    const base = 52000 + Math.floor(Math.random() * 4000);
    let clock = 1;
    const now = (): number => {
      clock += 1;
      return clock;
    };
    const hostStates: string[] = [];
    const clientStates: string[] = [];
    const hostSent: SignalOut[] = [];
    const clientSent: SignalOut[] = [];
    let hostMesh: Mesh | null = null;
    let clientMesh: Mesh | null = null;
    const hostQueued: SignalIn[] = [];
    const clientQueued: SignalIn[] = [];

    const hostLink = createSignalingLink({
      role: 'host',
      localId: 'self',
      name: 'jeanjean',
      host: '127.0.0.1',
      port: base,
      now,
      onMessage: (message) => {
        if (hostMesh === null) hostQueued.push(message);
        else void hostMesh.onSignal(message);
      },
    });
    links.push(hostLink);
    await eventually(() => hostLink.listen !== null && hostLink.selfId !== null);
    const port = hostLink.listen?.port ?? 0;

    const hostPlane = createMediaPlane({
      localId: 'self',
      timers: NO_TIMERS,
      onLocalCandidate: (peerId, candidate) => hostMesh?.onLocalCandidate(peerId, candidate),
      onRemoteStream: (peerId, stream) => hostMesh?.onRemoteStream(peerId, stream),
    });
    await hostPlane.startMicrophone();
    hostMesh = createMesh({
      localId: 'self',
      plane: hostPlane,
      timers: NO_TIMERS,
      send: (message) => {
        hostSent.push(message);
        hostLink.send(message);
      },
      onPeerState: (_peerId, state) => hostStates.push(state),
    });
    meshes.push(hostMesh);
    for (const message of hostQueued.splice(0)) await hostMesh.onSignal(message);

    const clientLink = createSignalingLink({
      role: 'client',
      localId: 'self',
      name: 'krillin',
      host: '127.0.0.1',
      port,
      now,
      onMessage: (message) => {
        if (clientMesh === null) clientQueued.push(message);
        else void clientMesh.onSignal(message);
      },
    });
    links.push(clientLink);
    await eventually(() => clientLink.selfId !== null);

    const clientPlane = createMediaPlane({
      localId: 'self',
      timers: NO_TIMERS,
      onLocalCandidate: (peerId, candidate) => clientMesh?.onLocalCandidate(peerId, candidate),
      onRemoteStream: (peerId, stream) => clientMesh?.onRemoteStream(peerId, stream),
    });
    await clientPlane.startMicrophone();
    clientMesh = createMesh({
      localId: 'self',
      plane: clientPlane,
      timers: NO_TIMERS,
      send: (message) => {
        clientSent.push(message);
        clientLink.send(message);
      },
      onPeerState: (_peerId, state) => clientStates.push(state),
    });
    meshes.push(clientMesh);
    for (const message of clientQueued.splice(0)) await clientMesh.onSignal(message);

    await eventually(
      () => hostSent.some((message) => message.kind === 'offer') && clientSent.some((message) => message.kind === 'answer'),
    );
    await eventually(() => FakePeerConnection.instances.length >= 2);
    for (const peer of FakePeerConnection.instances) {
      dom.fireIceCandidate(peer, LAN);
      const track = new FakeTrack('distant');
      dom.fireTrack(peer, new FakeMediaStream([track]), track);
    }
    await eventually(
      () =>
        hostSent.some((message) => message.kind === 'ice') &&
        clientSent.some((message) => message.kind === 'ice') &&
        hostStates.includes('connected') &&
        clientStates.includes('connected'),
    );
  } finally {
    for (const mesh of meshes) mesh.close();
    for (const link of links) link.close('fin');
    dom.restore();
  }
});
