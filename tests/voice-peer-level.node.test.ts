/**
 * tests/voice-peer-level.node.test.ts — défaut (a) : le halo « pair qui parle » est
 * bien ALIMENTÉ, de bout en bout, sur doubles.
 *
 * La chaîne mesurée ici, sans Chromium ni React :
 *   `openVoice()` → `createVoiceWiring` (VRAI câblage) → VRAI `mesh.ts` → VRAI
 *   `media-plane.ts` → `ontrack` (branché par le test sur la `RTCPeerConnection`
 *   doublure) → `addMeter(peerId, stream)` → `plane.level(peerId)` → boucle de
 *   mesure de `voice.ts` (battement 50 ms rejoué à la main) → `peer-speech.ts`
 *   → table `PEER_LEVELS` → `peerSpeaking()`.
 *
 * Les quatre assertions du lot, toutes issues de l'audit (a) :
 *   1. pair mesuré au-dessus du seuil ⇒ `PEER_LEVELS` porte `'true'` AVEC horodatage ;
 *   2. pair jamais mesuré ⇒ `'unknown'` — JAMAIS `'false'` (absence ≠ silence mesuré) ;
 *   3. perte de mesure (piste `'ended'`) ⇒ l'entrée est RETIRÉE de la table ;
 *   4. sortie de salon (`closeVoice()`) et plan média absent ⇒ rien n'affirme
 *      un faux `'true'` — la table est vidée, `peerSpeaking` retombé à `'unknown'`.
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
import { PEER_LEVELS, peerSpeaking, SPEAKING_STALE_MS } from '../src/renderer/participant-state.ts';
import type { SignalIn } from '../src/engine/net/mesh.ts';

/**
 * Faux `window.lanAPI` minimal : la voix n'utilise que `sendSignal`, `onSignal` et
 * `setSpeaking`. Les promesses sont résolues — `void ...catch()` y survit.
 */
function installLanApi(sent: unknown[]): { setSpeakingCalls: string[][] } {
  const setSpeakingCalls: string[][] = [];
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
    setSpeaking: async (ids: readonly string[]): Promise<void> => {
      setSpeakingCalls.push([...ids]);
    },
  };
  Object.defineProperty(globalThis, 'window', {
    value: Object.assign(globalThis, { lanAPI: api }),
    configurable: true,
    writable: true,
  });
  return { setSpeakingCalls };
}

/** Le battement de `startMeter` est privé : on rejoue SA logique (50 ms) depuis le test. */
function installFrameClock(): { ticks: Array<(now: number) => void>; pump: (now: number) => void } {
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
    ticks,
    pump(now: number): void {
      // Une pastille par tour : `tick` se re-planifie lui-même, comme dans la page.
      const pending = [...ticks];
      ticks.length = 0;
      for (const tick of pending) tick(now);
    },
  };
}

/** RMS linéaire franchement au-dessus du seuil d'ouverture VAD (−38 dBFS ≈ 0,0126). */
const LOUD = 0.3;

describe('défaut (a) — la table PEER_LEVELS est alimentée par le plan média, par pair', () => {
  let dom: FakeDom;
  let restore: (() => void) | null = null;

  afterEach(() => {
    // Ordre d'hygiène : la voix d'abord (elle retient le plan), les doublures ensuite.
    resetFakeAnalyserLevels();
    restore?.();
    restore = null;
    PEER_LEVELS.clear();
    Reflect.deleteProperty(globalThis, 'lanAPI');
  });

  it('pair mesuré au-dessus du seuil ⇒ la table porte « true » avec horodatage ; pair jamais mesuré ⇒ « unknown »', async () => {
    dom = installFakeDom();
    restore = dom.restore;
    const sent: unknown[] = [];
    const lan = installLanApi(sent);
    const clock = installFrameClock();
    const voice = await import('../src/renderer/voice.ts');
    voice.closeVoice();
    PEER_LEVELS.clear();

    // Niveau contrôlé : `b` est LOUD, `c` n'est JAMAIS mesuré (aucun flux).
    setFakeAnalyserLevel('pair-b', LOUD);

    voice.openVoice('salon|a', 'a');
    // L'abonnement du câblage : `installLanApi` n'a pas de porte publique de delivery,
    // on la prend par un second écouteur que le faux lanAPI n'a pas — à la place, on
    // utilise la VRAIE porte : `openVoice` s'abonne via `lanApi().onSignal`. Le faux
    // enregistre l'écouteur ; on le rejoue en le récupérant par la même interface.
    const deliver = makeDeliverer();
    await flush();
    deliver({ kind: 'peer-joined', peerId: 'b', name: 'Bob' });
    await flush();

    // Le pair `b` a une connexion (le mesh a offert) ; on lui branche un flux vivant.
    assert.ok(dom.peers.length >= 1, 'le maillage a bien créé une connexion pour b');
    const trackB = new FakeTrack('pair-b');
    const streamB = new FakeMediaStream([trackB]);
    dom.fireTrack(dom.peerAt(0), streamB, trackB);

    // Deux battements au-delà de la période (50 ms) : la mesure tombe dans la table.
    clock.pump(100);
    clock.pump(150);

    const sampleB = PEER_LEVELS.get('b');
    assert.notEqual(sampleB, undefined, 'b mesuré ⇒ une entrée dans PEER_LEVELS');
    assert.equal(sampleB?.speaks, 'true', 'b au-dessus du seuil ⇒ « true »');
    assert.equal(sampleB?.at, 150, 'l’entrée est horodatée de la mesure');
    assert.equal(peerSpeaking('b', PEER_LEVELS, 150), 'true', 'le halo lit « true »');

    // `c` n'a jamais été mesuré : AUCUNE entrée, donc « unknown » — jamais « false ».
    assert.equal(PEER_LEVELS.get('c'), undefined, 'c jamais mesuré ⇒ aucune entrée');
    assert.equal(peerSpeaking('c', PEER_LEVELS, 150), 'unknown', 'jamais mesuré ⇒ unknown, pas false');

    // L'overlay a reçu la transition (relais → setSpeaking).
    assert.ok(
      lan.setSpeakingCalls.some((ids) => ids.includes('b')),
      `setSpeaking doit avoir publié b : ${JSON.stringify(lan.setSpeakingCalls)}`,
    );
    voice.closeVoice();
  });

  it('perte de mesure (piste finie) ⇒ l’entrée est retirée, pas figée à « true »', async () => {
    dom = installFakeDom();
    restore = dom.restore;
    const sent: unknown[] = [];
    installLanApi(sent);
    const clock = installFrameClock();
    const voice = await import('../src/renderer/voice.ts');
    voice.closeVoice();
    PEER_LEVELS.clear();

    setFakeAnalyserLevel('pair-b', LOUD);
    voice.openVoice('salon|a', 'a');
    const deliver = makeDeliverer();
    await flush();
    deliver({ kind: 'peer-joined', peerId: 'b', name: 'Bob' });
    await flush();

    const trackB = new FakeTrack('pair-b');
    const streamB = new FakeMediaStream([trackB]);
    dom.fireTrack(dom.peerAt(0), streamB, trackB);
    clock.pump(100);
    assert.equal(PEER_LEVELS.get('b')?.speaks, 'true', 'd’abord mesuré parlant');

    // La piste se tarit (l'onglet pair meurt) : `level('b')` retombe à `null`.
    trackB.end();
    clock.pump(150);
    assert.equal(PEER_LEVELS.get('b'), undefined, 'perte de mesure ⇒ entrée RETIRÉE');
    assert.equal(peerSpeaking('b', PEER_LEVELS, 150), 'unknown', 'et l’affichage retombe à unknown');
    voice.closeVoice();
  });

  it('closeVoice() (sortie de salon) ⇒ table vidée : plus jamais de faux « true »', async () => {
    dom = installFakeDom();
    restore = dom.restore;
    const sent: unknown[] = [];
    installLanApi(sent);
    const clock = installFrameClock();
    const voice = await import('../src/renderer/voice.ts');
    voice.closeVoice();
    PEER_LEVELS.clear();

    setFakeAnalyserLevel('pair-b', LOUD);
    voice.openVoice('salon|a', 'a');
    const deliver = makeDeliverer();
    await flush();
    deliver({ kind: 'peer-joined', peerId: 'b', name: 'Bob' });
    await flush();

    const trackB = new FakeTrack('pair-b');
    const streamB = new FakeMediaStream([trackB]);
    dom.fireTrack(dom.peerAt(0), streamB, trackB);
    clock.pump(100);
    assert.equal(PEER_LEVELS.get('b')?.speaks, 'true', 'précondition : b est « true »');

    voice.closeVoice();
    clock.pump(150);
    assert.equal(PEER_LEVELS.size, 0, 'sortie de salon ⇒ table vidée');
    assert.equal(peerSpeaking('b', PEER_LEVELS, 150), 'unknown', 'rien n’affirme un halo après départ');
  });

  it('plan média absent (micro refusé) ⇒ rien n’affirme « true »', async () => {
    dom = installFakeDom();
    restore = dom.restore;
    const sent: unknown[] = [];
    installLanApi(sent);
    const clock = installFrameClock();
    // Micro refusé : le câblage passe par `onError`, la session ne devient jamais `live`.
    const mediaDevices = (globalThis as unknown as {
      navigator: { mediaDevices: { getUserMedia: unknown } };
    }).navigator.mediaDevices;
    mediaDevices.getUserMedia = (): Promise<never> =>
      Promise.reject(new Error('micro refusé par l’utilisateur'));

    const voice = await import('../src/renderer/voice.ts');
    voice.closeVoice();
    PEER_LEVELS.clear();
    voice.openVoice('salon|a', 'a');
    const deliver = makeDeliverer();
    await flush();
    deliver({ kind: 'peer-joined', peerId: 'b', name: 'Bob' });
    await flush();
    clock.pump(100);
    clock.pump(150);

    assert.equal(PEER_LEVELS.size, 0, 'plan média absent ⇒ aucune entrée, aucun « true »');
    assert.equal(peerSpeaking('b', PEER_LEVELS, 150), 'unknown');
    voice.closeVoice();
  });
});

/* ------------------------------------------------------------------------- */
/* Outils                                                                     */
/* ------------------------------------------------------------------------- */

/** Laisse tourner les microtâches (mesh et câblage enchaînent des promesses). */
async function flush(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

/**
 * Porte de distribution des messages entrants : `openVoice` s'abonne via
 * `lanApi().onSignal` ; le faux lanAPI garde l'écouteur dans un module-fermé,
 * on le retrouve par cette porte posée à chaque `installLanApi`.
 */
let deliverer: ((message: SignalIn) => void) | null = null;

function makeDeliverer(): (message: SignalIn) => void {
  if (deliverer === null) throw new Error('lanAPI non installé (installLanApi manquant)');
  return deliverer;
}
