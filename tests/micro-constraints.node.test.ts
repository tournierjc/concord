/**
 * tests/micro-constraints.node.test.ts — les réglages micro ont ENFIN des consommateurs
 * (fix 0.4.2, 2026-11-02, C1).
 *
 * Le défaut mesuré : `audio.inputDeviceId`, `audio.noiseSuppression`, `audio.echoCancellation`
 * et `audio.inputGain` étaient persistés par le schéma, édités par Réglages — et lus par
 * PERSONNE hors le panneau. Le micro était capturé NS+EC forcés, périphérique système imposé.
 *
 * La chaîne mesurée ici, sans Chromium :
 *   réglages → `buildMicrophoneConstraints` (pure) → `createMediaPlane({ microConstraints })`
 *   → `startMicrophone()` → faux `getUserMedia` qui ENREGISTRE les contraintes → assertions.
 *
 * Et l'autre bout, côté affichage : `talk.vadThresholdDb` (−80..−10, lui aussi sans
 * consommateur) pilote bien le seuil RMS local « soi qui parle »
 * (`speakingRmsFromThresholdDb`, même conversion `rmsToDbfs` que le chemin distant).
 *
 * Lancer : npx tsx --test tests/micro-constraints.node.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MIC_CONSTRAINTS,
  buildMicrophoneConstraints,
  captureProcessingMismatches,
  toMediaTrackConstraints,
  type MicrophoneSettingsLike,
} from '../src/engine/rtc/media-config.ts';
import { createMediaPlane } from '../src/engine/rtc/media-plane.ts';
import { speakingRmsFromThresholdDb } from '../src/renderer/voice.ts';
import { installFakeDom, type FakeDom } from './fake-rtc.ts';

/* ---------------------------------------------------- 1. la fabrique pure ---- */

describe('buildMicrophoneConstraints — réglages → facettes de capture (SPEC-019 avenant 2026-11-02)', () => {
  it('réglages absents : défauts du moteur (mono, EC et NS demandés, AGC coupé)', () => {
    assert.deepEqual(buildMicrophoneConstraints(undefined), {
      channelCount: 1,
      echoCancellation: true,
      // NS allumée : le PTT ne coupe plus la capture, RNNoise ne se cale plus sur le silence.
      noiseSuppression: true,
      // Un seul gain, celui du graphe. L'AGC navigateur pomperait contre lui.
      autoGainControl: false,
    });
  });

  it('périphérique réglé : la facette deviceId porte la chaîne, jamais le réglage vide', () => {
    const settings: MicrophoneSettingsLike = { inputDeviceId: 'mic-abc-123' };
    assert.equal(buildMicrophoneConstraints(settings).deviceId, 'mic-abc-123');
    // Réglage vide = « micro du système » : AUCUNE facette posée, pas une facette à ''.
    assert.equal(buildMicrophoneConstraints({ inputDeviceId: '' }).deviceId, undefined);
  });

  it('NS/EC réglés à false : ils SORTENT éteints (c’était le réglage mort, pas une préférence)', () => {
    const constraints = buildMicrophoneConstraints({ noiseSuppression: false, echoCancellation: false });
    assert.equal(constraints.noiseSuppression, false);
    assert.equal(constraints.echoCancellation, false);
  });

  it('gain numérique dans 0..2 : porté ; hors bornes ou non numérique : ignoré, jamais arrondi', () => {
    assert.equal(buildMicrophoneConstraints({ inputGain: 1.5 }).gain, 1.5);
    assert.equal(buildMicrophoneConstraints({ inputGain: 3 }).gain, undefined);
    assert.equal(buildMicrophoneConstraints({ inputGain: Number.NaN }).gain, undefined);
    // `0` est une valeur LÉGITIME (micro coupé), pas une absence.
    assert.equal(buildMicrophoneConstraints({ inputGain: 0 }).gain, 0);
  });

  it('getSettings contraire à la demande est un écart ; un champ absent n’en est pas un', () => {
    const requested = buildMicrophoneConstraints(undefined);
    assert.deepEqual(
      captureProcessingMismatches(requested, { echoCancellation: false, noiseSuppression: true, autoGainControl: false }),
      ['echoCancellation demandé=true obtenu=false'],
    );
    assert.deepEqual(captureProcessingMismatches(requested, {}), []);
  });
});

/* ------------------------------- 2. le plan média reçoit les facettes ---- */

describe('createMediaPlane — les facettes réglées arrivent à getUserMedia', () => {
  function gumConstraintsOf(dom: FakeDom): Record<string, unknown> | undefined {
    // Le faux `navigator.mediaDevices.getUserMedia` note les contraintes reçues.
    const calls = dom.gumCalls;
    return calls[0] === undefined ? undefined : { ...calls[0] };
  }

  it('sans facettes injectées : les défauts MIC_CONSTRAINTS sortent tels quels (non-régression)', async () => {
    const dom = installFakeDom();
    try {
      const plane = createMediaPlane({
        localId: 'a',
        timers: { once: () => null, cancel: () => undefined },
      });
      await plane.startMicrophone();
      const constraints = gumConstraintsOf(dom);
      assert.ok(constraints !== undefined, 'getUserMedia a été appelé');
      const audio = constraints?.['audio'];
      assert.deepEqual(audio, toMediaTrackConstraints({
        channelCount: MIC_CONSTRAINTS.channelCount,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
      }));
      plane.close();
    } finally {
      dom.restore();
    }
  });

  it('facettes réglées injectées : device/NS/EC portés à la capture, AGC défensif à true', async () => {
    const dom = installFakeDom();
    try {
      const plane = createMediaPlane({
        localId: 'a',
        timers: { once: () => null, cancel: () => undefined },
        microConstraints: {
          channelCount: 1,
          deviceId: 'périphérique-casque',
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
        },
      });
      await plane.startMicrophone();
      const audio = gumConstraintsOf(dom)?.['audio'];
      assert.deepEqual(audio, {
        channelCount: { ideal: 1 },
        echoCancellation: { ideal: false },
        noiseSuppression: { ideal: false },
        autoGainControl: { ideal: true },
        deviceId: 'périphérique-casque',
      });
      plane.close();
    } finally {
      dom.restore();
    }
  });

  it('deviceId vide : AUCUNE facette deviceId ne sort (micro système, pas une facette à „”)', async () => {
    const dom = installFakeDom();
    try {
      const plane = createMediaPlane({
        localId: 'a',
        timers: { once: () => null, cancel: () => undefined },
        microConstraints: { channelCount: 1, deviceId: '' },
      });
      await plane.startMicrophone();
      const audio = gumConstraintsOf(dom)?.['audio'];
      assert.equal(typeof audio === 'object' && audio !== null && 'deviceId' in audio, false,
        'aucune facette deviceId sur un réglage vide');
      plane.close();
    } finally {
      dom.restore();
    }
  });

  it('mode VAD (microOpenOnStart) : la piste micro reste enabled après startMicrophone (C2)', async () => {
    const dom = installFakeDom();
    try {
      const plane = createMediaPlane({
        localId: 'a',
        timers: { once: () => null, cancel: () => undefined },
        microOpenOnStart: true,
      });
      await plane.startMicrophone();
      const track = dom.micTracks[0];
      assert.ok(track !== undefined, 'la piste micro a été ouverte');
      assert.equal(track.enabled, true, 'en VAD, la piste est OUVERTE — c’est la mesure qui décide');
      plane.close();
    } finally {
      dom.restore();
    }
  });

  it('défaut push-to-talk : la piste micro est fermée au repos (comportement historique)', async () => {
    const dom = installFakeDom();
    try {
      const plane = createMediaPlane({
        localId: 'a',
        timers: { once: () => null, cancel: () => undefined },
      });
      await plane.startMicrophone();
      const track = dom.micTracks[0];
      assert.ok(track !== undefined);
      assert.equal(track.enabled, false, 'sans VAD, le repos coupe le micro (push-to-talk)');
      plane.close();
    } finally {
      dom.restore();
    }
  });
});

/* ------------------------- 3. le seuil « soi qui parle » suit le réglage ---- */

describe('speakingRmsFromThresholdDb — talk.vadThresholdDb pilote le halo local (C1)', () => {
  it('réglage absent : le défaut SPEAKING_LEVEL (RMS 0,02) est conservé', () => {
    assert.equal(speakingRmsFromThresholdDb(undefined), 0.02);
  });

  it('réglage −50 dBFS : RMS = 10^(−50/20) ≈ 0,00316 (conversion rmsToDbfs inverse)', () => {
    const rms = speakingRmsFromThresholdDb(-50);
    assert.ok(Math.abs(rms - 10 ** (-50 / 20)) < 1e-9, `RMS attendu ≈ 0,00316, reçu ${rms}`);
  });

  it('réglage hors bornes ou non numérique : retombe sur le défaut, jamais sur un seuil inventé', () => {
    assert.equal(speakingRmsFromThresholdDb(-5), 0.02, 'au-dessus d’OPEN_DBFS : refusé');
    assert.equal(speakingRmsFromThresholdDb(-120), 0.02, 'sous MIN_DBFS : refusé');
    assert.equal(speakingRmsFromThresholdDb(Number.NaN), 0.02);
  });

  it('sonde de l’audit : RMS 0,001 sous un seuil −38 réglé ⇒ le halo dit « false » (mesure honnête)', () => {
    // Le seuil réglé à −38 dBFS ≈ RMS 0,0126 : un signal à 0,001 reste SOUS le seuil.
    const threshold = speakingRmsFromThresholdDb(-38);
    assert.ok(0.001 < threshold, 'la sonde de l’audit : 0,001 est bien sous le seuil −38');
  });
});
