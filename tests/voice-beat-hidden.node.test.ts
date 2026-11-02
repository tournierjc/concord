/**
 * tests/voice-beat-hidden.node.test.ts — le battement de mesure n'est plus asservi à
 * `requestAnimationFrame` (fix 0.4.2, 2026-11-02, C3).
 *
 * Le défaut mesuré : la production des niveaux (`startMeter`) tournait sur les rAF. La
 * fenêtre principale se CACHE dans la barre système à la croix (0.4.2 : `on close` →
 * `window.hide`) — Chromium throttle puis gèle les rAF d'une page cachée. Les halos
 * « qui parle » restaient figés sur leur dernier état, silencieusement : la mesure
 * mourait avec la fenêtre, et l'overlay (le cas d'usage) ne disait plus rien.
 *
 * La chaîne mesurée ici, SANS AUCUN `requestAnimationFrame` défini (garde négative : si le
 * chemin production retombait sur la rAF, l'appel lèverait) :
 *   `openVoice(..., { makeBeat: pompe manuelle })` → flux distant branché → chaque
 *   `pump(now)` est un tour du battement → `PEER_LEVELS` se rafraîchit. Après l'équivalent
 *   du `hide` (plus de frames rendus), les niveaux CONTINUENT de s'actualiser ; le battement
 *   armé est le même port, jamais une rAF ; `resumeVoiceMeter()` (re-show) ne duplique
 *   jamais la cadence.
 *
 * Lancer : npx tsx --test tests/voice-beat-hidden.node.test.ts
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
import { PEER_LEVELS, peerSpeaking } from '../src/renderer/participant-state.ts';
import type { MeterBeatDriver } from '../src/renderer/peer-speech.ts';
import type { SignalIn } from '../src/engine/net/mesh.ts';

/* ------------------------------------------------------------------ doubles */

function installLanApi(): void {
  const listeners: Array<(message: SignalIn) => void> = [];
  const api = {
    sendSignal: async (_message: unknown): Promise<void> => undefined,
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
    setSpeaking: async (_ids: readonly string[]): Promise<void> => undefined,
  };
  Object.defineProperty(globalThis, 'window', {
    value: Object.assign(globalThis, { lanAPI: api }),
    configurable: true,
    writable: true,
  });
}

let deliverer: ((message: SignalIn) => void) | null = null;
function makeDeliverer(): (message: SignalIn) => void {
  return (message) => {
    if (deliverer !== null) deliverer(message);
  };
}

/**
 * Pompe manuelle du battement (le port `MeterBeatDriver`, SEULE cadence de la page en
 * production — `browser-beat.ts`, jamais la rAF). `armed` compte les battements vivants :
 * la garde anti-duplication du `resumeVoiceMeter` se mesure dessus.
 */
function manualBeat(): {
  makeBeat: () => MeterBeatDriver;
  pump: (now: number) => void;
  armed(): number;
  /** Nombre de tours réellement exécutés (la preuve que la cadence tourne, hide ou pas). */
  turns: number;
} {
  const ticks: Array<{ tick: (now: number) => void; stopped: boolean }> = [];
  let time = 0;
  const state = {
    makeBeat: () => ({
      now: () => time,
      start(tick: (now: number) => void): () => void {
        const entry = { tick, stopped: false };
        ticks.push(entry);
        return () => {
          entry.stopped = true;
        };
      },
    }),
    pump(now: number): void {
      time = now;
      for (const entry of [...ticks]) {
        if (!entry.stopped) {
          state.turns += 1;
          entry.tick(now);
        }
      }
    },
    armed(): number {
      return ticks.filter((entry) => !entry.stopped).length;
    },
    turns: 0,
  };
  return state;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

/* ------------------------------------------------------------------ tests */

describe('battement hors-RAF — la mesure continue quand la fenêtre est cachée (C3)', () => {
  let dom: FakeDom;
  let restore: (() => void) | null = null;

  afterEach(() => {
    resetFakeAnalyserLevels();
    restore?.();
    restore = null;
    PEER_LEVELS.clear();
    deliverer = null;
    Reflect.deleteProperty(globalThis, 'lanAPI');
  });

  it('AUCUNE rAF n’existe dans l’environnement : le battement vient du port injecté', async () => {
    // Garde négative : si `startMeter` retombait un jour sur `requestAnimationFrame`, ce
    // test lèverait (`requestAnimationFrame is not defined`) au lieu de passer en silence.
    assert.equal(
      Reflect.has(globalThis, 'requestAnimationFrame'),
      false,
      'le harnais ne définit JAMAIS requestAnimationFrame — la rAF doit être morte dans ce chemin',
    );
    assert.equal(Reflect.has(globalThis, 'cancelAnimationFrame'), false);

    dom = installFakeDom();
    restore = dom.restore;
    installLanApi();
    const beat = manualBeat();
    const voice = await import('../src/renderer/voice.ts');
    voice.closeVoice();
    PEER_LEVELS.clear();

    setFakeAnalyserLevel('pair-b', 0.3);
    voice.openVoice('salon|a', 'a', undefined, { makeBeat: beat.makeBeat });
    const deliver = makeDeliverer();
    await flush();
    deliver({ kind: 'peer-joined', peerId: 'b', name: 'Bob' });
    await flush();

    const trackB = new FakeTrack('pair-b');
    dom.fireTrack(dom.peerAt(0), new FakeMediaStream([trackB]), trackB);
    beat.pump(100);
    assert.equal(PEER_LEVELS.get('b')?.speaks, 'true', 'un tour de battement mesure b');

    // Équivalent du « hide » : plus AUCUN rendu n'a lieu (la page est cachée — en production,
    // c'est précisément là que la rAF mourait). Le battement est un `setInterval` de la page :
    // ses tours continuent, la mesure avec.
    beat.pump(150);
    beat.pump(200);
    const sample = PEER_LEVELS.get('b');
    assert.equal(sample?.speaks, 'true', 'cachée, la table continue de porter « true »');
    assert.equal(sample?.at, 200, 'l’horodatage suit les tours — la mesure ne s’est pas figée');
    assert.equal(peerSpeaking('b', PEER_LEVELS, 200), 'true', 'le halo lit un état VIVANT, pas un reliquat');

    // Le niveau passe sous le seuil : le faux analyseur fige son échantillon à la connexion
    // du flux, et un second `ontrack` sur la même connexion ne remplace PAS le vumètre (le
    // plan média empile, le pic gagne). On éteint donc la SOURCE du flux mesuré — la piste
    // du stream branché se tarit (`ended`), `liveMeters` retire l'analyseur, `level('b')`
    // retombe à `null` : la perte de mesure est IMMÉDIATE par contrat (« un 'true' qui
    // survivrait 600 ms après la perte du flux serait une affirmation sans mesure »). Un
    // battement gelé, lui, aurait laissé l'entrée « true » en place pour toujours — c'était
    // le symptôme. L'horodatage des tours prouve que la cadence a continué pendant le hide.
    const turnsBeforeLoss = beat.turns;
    trackB.end();
    beat.pump(500);
    assert.ok(beat.turns > turnsBeforeLoss, 'au moins un tour de battement a tourné depuis la perte');
    assert.equal(PEER_LEVELS.get('b'), undefined, 'mesure perdue ⇒ entrée RETIRÉE (pas figée à « true »)');
    assert.equal(peerSpeaking('b', PEER_LEVELS, 500), 'unknown', 'le halo suit la mesure, jamais figé');
    beat.pump(800);
    assert.equal(peerSpeaking('b', PEER_LEVELS, 800), 'unknown', 'et le reste après la tenue : rien n’affirme sans mesure');

    voice.closeVoice();
  });

  it('resumeVoiceMeter (re-show) ne duplique JAMAIS la cadence : un seul battement vivant', async () => {
    dom = installFakeDom();
    restore = dom.restore;
    installLanApi();
    const beat = manualBeat();
    const voice = await import('../src/renderer/voice.ts');
    voice.closeVoice();
    PEER_LEVELS.clear();

    setFakeAnalyserLevel('pair-b', 0.3);
    voice.openVoice('salon|b2', 'a', undefined, { makeBeat: beat.makeBeat });
    const deliver = makeDeliverer();
    await flush();
    deliver({ kind: 'peer-joined', peerId: 'b', name: 'Bob' });
    await flush();
    const trackB = new FakeTrack('pair-b');
    dom.fireTrack(dom.peerAt(0), new FakeMediaStream([trackB]), trackB);
    beat.pump(100);
    assert.equal(beat.armed(), 1, 'une session live = UN battement armé');

    // Deux « show » consécutifs : chacun relance le battement, jamais les deux ne courent.
    voice.resumeVoiceMeter();
    voice.resumeVoiceMeter();
    assert.equal(beat.armed(), 1, 'redémarrer désarme l’ancien avant d’armer le nouveau');

    // Un seul tour mesuré = un seul horodatage : si deux cadences couraient, `at` avancerait
    // deux fois et des tours duplicata partiraient.
    beat.pump(300);
    assert.equal(PEER_LEVELS.get('b')?.at, 300);

    voice.closeVoice();
    assert.equal(beat.armed(), 0, 'closeVoice désarme le battement — rien ne survit à la session');
  });
});
