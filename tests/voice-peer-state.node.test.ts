/**
 * tests/voice-peer-state.node.test.ts — défaut (b) dans la COQUILLE : l'état ICE
 * nominatif ne touche que SON pair, et un `connected` sans preuve ne promeut rien.
 *
 * Le harnais est celui de `voice-peer-level.node.test.ts` (faux `window.lanAPI`,
 * battement rejoué, VRAIS `voice-mesh.ts`/`mesh.ts`/`media-plane.ts`, doublures
 * `fake-rtc.ts`). Ce qui est mesuré, exactement :
 *
 *   1. `failed` d'UN pair ⇒ seul ce pair passe à `failed` — l'autre `connecting`
 *      reste `connecting` (avant la réparation, `applyConnectionState` écrasait
 *      TOUS les « connecting ») ;
 *   2. `connected` d'un pair SANS preuve (aucun flux, aucun palier mesh) ⇒ le pair
 *      N'EST PAS promu (SPEC-008 §1 : pas de `connected` réinventé) ;
 *   3. `connected` d'un pair AVEC preuve (piste reçue ⇒ le mesh l'a dit `connected`)
 *      ⇒ promotion, et elle seule ;
 *   4. `failed` d'un pair qui a un flux ne masque pas l'échec (le flux branché ne
 *      dédit pas un échec ICE mesuré).
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  FakeMediaStream,
  FakeTrack,
  installFakeDom,
  resetFakeAnalyserLevels,
  setFakeAnalyserLevel,
  type FakeDom,
} from './fake-rtc.ts';
import { PEER_LEVELS } from '../src/renderer/participant-state.ts';
import type { SignalIn } from '../src/engine/net/mesh.ts';

let deliverer: ((message: SignalIn) => void) | null = null;

function installLanApi(sent: unknown[]): void {
  const listeners: Array<(message: SignalIn) => void> = [];
  const api = {
    sendSignal: async (message: unknown): Promise<void> => {
      sent.push(message);
    },
    onSignal: (listener: (message: SignalIn) => void): (() => void) => {
      listeners.push(listener);
      deliverer = (message: SignalIn): void => {
        for (const entry of listeners) entry(message);
      };
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
    setSpeaking: async (): Promise<void> => undefined,
  };
  Object.defineProperty(globalThis, 'window', {
    value: Object.assign(globalThis, { lanAPI: api }),
    configurable: true,
    writable: true,
  });
}

function installFrameClock(): { pump: (now: number) => void } {
  const ticks: Array<(now: number) => void> = [];
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    value: (callback: (now: number) => void): number => {
      ticks.push(callback);
      return ticks.length;
    },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    value: (): void => undefined,
    configurable: true,
    writable: true,
  });
  return {
    pump(now: number): void {
      const pending = [...ticks];
      ticks.length = 0;
      for (const tick of pending) tick(now);
    },
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

describe('défaut (b) — la coquille route l’état ICE pair par pair, sur preuve', () => {
  let dom: FakeDom;
  let restore: (() => void) | null = null;

  afterEach(() => {
    resetFakeAnalyserLevels();
    restore?.();
    restore = null;
    PEER_LEVELS.clear();
    Reflect.deleteProperty(globalThis, 'lanAPI');
  });

  /** Ouvre une session live avec deux pairs connectés au niveau du maillage. */
  async function liveTwoPeers(): Promise<{
    voice: typeof import('../src/renderer/voice.ts');
    clock: { pump: (now: number) => void };
  }> {
    const sent: unknown[] = [];
    installLanApi(sent);
    const clock = installFrameClock();
    const voice = await import('../src/renderer/voice.ts');
    voice.closeVoice();
    PEER_LEVELS.clear();
    voice.openVoice('salon|a', 'a');
    await flush();
    const deliver = deliverer;
    if (deliver === null) throw new Error('lanAPI non installé');
    deliver({ kind: 'peer-joined', peerId: 'b', name: 'Bob' });
    deliver({ kind: 'peer-joined', peerId: 'c', name: 'Carol' });
    await flush();
    clock.pump(100);
    return { voice, clock };
  }

  it('failed d’UN seul pair : l’autre pair connecting ne tombe pas avec lui', async () => {
    dom = installFakeDom();
    restore = dom.restore;
    const { voice } = await liveTwoPeers();

    assert.equal(dom.peers.length, 2, 'une connexion par pair');
    dom.peerAt(1).fireConnectionState('failed'); // la connexion de `c` échoue

    const peers = voice.voiceSnapshot().peers;
    const b = peers.find((peer) => peer.peerId === 'b');
    const c = peers.find((peer) => peer.peerId === 'c');
    assert.equal(c?.state, 'failed', 'c a échoué à l’ICE ⇒ failed, cause ice');
    assert.equal(b?.state, 'connecting', 'b n’a RIEN à voir avec l’échec de c — il reste connecting');
    voice.closeVoice();
  });

  it('connected ICE sans preuve (aucun flux) ne promeut PAS le pair — SPEC-008 §1', async () => {
    dom = installFakeDom();
    restore = dom.restore;
    const { voice } = await liveTwoPeers();

    dom.peerAt(0).fireConnectionState('connected'); // ICE dit « connectée »… sans voix

    const b = voice.voiceSnapshot().peers.find((peer) => peer.peerId === 'b');
    assert.equal(b?.state, 'connecting', 'un ICE `connected` sans preuve de flux ne réinvente rien');
    voice.closeVoice();
  });

  it('preuve de flux (piste reçue) ⇒ le pair est connected ; l’ICE de l’autre pair ne le promeut pas', async () => {
    dom = installFakeDom();
    restore = dom.restore;
    const { voice, clock } = await liveTwoPeers();

    // `b` reçoit une piste : le mesh tient la preuve et publie `connected` (défaut (c)).
    setFakeAnalyserLevel('pair-b', 0.3);
    const trackB = new FakeTrack('pair-b');
    const streamB = new FakeMediaStream([trackB]);
    dom.fireTrack(dom.peerAt(0), streamB, trackB);
    clock.pump(150);

    const peers = voice.voiceSnapshot().peers;
    const b = peers.find((peer) => peer.peerId === 'b');
    const c = peers.find((peer) => peer.peerId === 'c');
    assert.equal(b?.state, 'connected', 'b a une preuve de flux ⇒ connected');
    assert.equal(c?.state, 'connecting', 'c n’a aucune preuve ⇒ il n’est PAS promu par ricochet');

    // Et l'ICE nominatif `completed` de c sans preuve ne change toujours rien.
    dom.peerAt(1).fireConnectionState('completed');
    assert.equal(
      voice.voiceSnapshot().peers.find((peer) => peer.peerId === 'c')?.state,
      'connecting',
      'ICE `completed` sans preuve ne promeut pas',
    );
    voice.closeVoice();
  });

  it('failed sur un pair QUI a un flux : l’échec ICE est la vérité, le flux ne le dédit pas', async () => {
    dom = installFakeDom();
    restore = dom.restore;
    const { voice, clock } = await liveTwoPeers();

    setFakeAnalyserLevel('pair-b', 0.3);
    const trackB = new FakeTrack('pair-b');
    const streamB = new FakeMediaStream([trackB]);
    dom.fireTrack(dom.peerAt(0), streamB, trackB);
    clock.pump(150);
    assert.equal(voice.voiceSnapshot().peers.find((peer) => peer.peerId === 'b')?.state, 'connected');

    dom.peerAt(0).fireConnectionState('failed');
    assert.equal(
      voice.voiceSnapshot().peers.find((peer) => peer.peerId === 'b')?.state,
      'failed',
      'un pair connecté puis tombé à l’ICE repasse failed — le flux branché ne masque pas l’échec',
    );
    voice.closeVoice();
  });
});
