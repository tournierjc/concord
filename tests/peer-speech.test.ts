/**
 * tests/peer-speech.test.ts — le producteur de la parole distante (T21 / AD-17 D4-D6, R-U8).
 *
 * Ce que ces tests falsifient, dans l'ordre du risque :
 *   — AC-U10 (SPEC-013 §2 R-U8) : attaque à 0 ms, pause de 400 ms qui laisse le halo allumé,
 *     rafale à 10 Hz sans clignotement, extinction 600 ms après la dernière syllabe.
 *   — R-U8 §1 : la période d'échantillonnage est franchement sous la péremption d'affichage,
 *     sinon un trou de battement éteindrait un pair qui parle.
 *   — Règle 1 (AD-17 D4) : `null` n'est pas du silence — aucune mesure, aucune écriture.
 *   — A6 / AD-19 D2 : une écriture pour un id hors maillage est IGNORÉE (pas de halo fantôme).
 *
 * Le module testé est pur : aucun DOM, aucun React, horloge injectée. Le halo n'est pas simulé
 * ici, il est LU : `peerSpeaking()` de `participant-state.ts` est la même fonction que Room.tsx
 * appelle au rendu, donc l'assertion porte sur ce que l'écran afficherait.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SAMPLE_PERIOD_MS,
  SPEAKING_HOLD_MS,
  createPeerSpeechTracker,
  heldSpeaks,
  recordPeerSpeaking,
  rmsToDbfs,
} from '../src/renderer/peer-speech.ts';
import {
  SPEAKING_STALE_MS,
  peerSpeaking,
  type PeerSpeakingSample,
} from '../src/renderer/participant-state.ts';

/** RMS d'une trame parlante : −14 dBFS, loin au-dessus du seuil d'ouverture (−38). */
const LOUD = 0.2;
/** RMS d'une trame silencieuse : −66 dBFS, loin sous le seuil de fermeture (−45). */
const QUIET = 0.0005;

const PEER = 'pair-a';

/** Banc d'essai : table réelle, horloge injectée, maillage mutable. */
function bench(ids: string[] = [PEER]) {
  const samples = new Map<string, PeerSpeakingSample>();
  const tracker = createPeerSpeechTracker(samples);
  const levels = new Map<string, number | null>();
  const mesh = [...ids];
  const tick = (now: number, next?: Record<string, number | null>): readonly string[] => {
    if (next) for (const [id, value] of Object.entries(next)) levels.set(id, value);
    return tracker.sample(
      { peers: mesh, level: (id) => (levels.has(id) ? (levels.get(id) as number | null) : null) },
      now,
    );
  };
  return { samples, tracker, tick, mesh, levels };
}

/** Amène un pair à l'état « parle » : deux trames au-dessus du seuil (attaque du VAD = 40 ms). */
function open(b: ReturnType<typeof bench>, from = 0, step = SAMPLE_PERIOD_MS): number {
  b.tick(from, { [PEER]: LOUD });
  b.tick(from + step, { [PEER]: LOUD });
  return from + step;
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-U10 — la tenue de relâchement, telle que le halo la voit
// ─────────────────────────────────────────────────────────────────────────────

test('AC-U10.1 — attaque : une trame parlante allume le halo sans délai ajouté', () => {
  // L'attaque ne dépend pas de la tenue : c'est vrai même sans historique (tenue nulle).
  assert.equal(heldSpeaks(true, null, 0), true);
  assert.equal(heldSpeaks(true, 0, 10_000), true);

  const b = bench();
  b.tick(0, { [PEER]: QUIET });
  assert.equal(peerSpeaking(PEER, b.samples, 0), 'false'); // silence mesuré : halo éteint
  // Un échantillon parlant allume le halo à l'image suivante : 0 ms, la tenue n'ajoute rien à
  // l'attaque. Le VAD, lui, demanderait 2 trames ; on ne les attend pas, car ce signal a déjà
  // franchi la porte de l'émetteur (−14 dBFS mesurés ici ne sont pas un bruit de fond).
  b.tick(50, { [PEER]: LOUD });
  assert.equal(peerSpeaking(PEER, b.samples, 50), 'true');
  assert.deepEqual(b.samples.get(PEER), { speaks: 'true', at: 50 });
});

test('AC-U10.2 — une pause de 400 ms laisse le halo allumé', () => {
  const b = bench();
  const lastSpeech = open(b); // dernière trame parlante
  let now = lastSpeech;
  // 400 ms de silence mesuré, au rythme du battement.
  for (let elapsed = SAMPLE_PERIOD_MS; elapsed <= 400; elapsed += SAMPLE_PERIOD_MS) {
    now = lastSpeech + elapsed;
    b.tick(now, { [PEER]: QUIET });
    assert.equal(
      peerSpeaking(PEER, b.samples, now),
      'true',
      `halo éteint ${elapsed} ms après la dernière syllabe (pause inter-mot)`,
    );
  }
  // Et l'extinction attend bien la tenue, ni plus ni moins.
  b.tick(lastSpeech + SPEAKING_HOLD_MS - 1, { [PEER]: QUIET });
  assert.equal(peerSpeaking(PEER, b.samples, lastSpeech + SPEAKING_HOLD_MS - 1), 'true');
  b.tick(lastSpeech + SPEAKING_HOLD_MS, { [PEER]: QUIET });
  assert.equal(peerSpeaking(PEER, b.samples, lastSpeech + SPEAKING_HOLD_MS), 'false');
});

test('AC-U10.3 — une rafale à 10 Hz ne produit aucun clignotement', () => {
  const b = bench();
  const step = 100; // 10 Hz : alternance mot/silence, pire cas de la parole réelle
  let lit = false;
  const offs: number[] = [];
  for (let i = 0; i < 20; i += 1) {
    const now = i * step;
    b.tick(now, { [PEER]: i % 2 === 0 ? LOUD : QUIET });
    const shown = peerSpeaking(PEER, b.samples, now);
    assert.notEqual(shown, 'unknown', `péremption en pleine rafale à t=${now}`);
    if (shown === 'true') lit = true;
    else if (lit) offs.push(now);
  }
  assert.deepEqual(offs, [], 'le halo s\u2019est éteint pendant la rafale');
  assert.equal(lit, true, 'le halo ne s\u2019est jamais allumé');
});

test('AC-U10.4 — extinction : ~680 ms entre la dernière syllabe et le halo éteint', () => {
  const b = bench();
  const lastSpeech = open(b);
  const offAt = lastSpeech + SPEAKING_HOLD_MS;
  // Silence mesuré au rythme du battement : le VAD referme sa porte bien avant la tenue.
  for (let t = lastSpeech + SAMPLE_PERIOD_MS; t < offAt; t += SAMPLE_PERIOD_MS) {
    b.tick(t, { [PEER]: QUIET });
    assert.equal(peerSpeaking(PEER, b.samples, t), 'true', `halo éteint à t=${t - lastSpeech} ms`);
  }
  b.tick(offAt, { [PEER]: QUIET });
  assert.equal(peerSpeaking(PEER, b.samples, offAt), 'false');
  // 80 ms de transition CSS (SPEC-001) : à la fin de la transition, le halo est bien éteint.
  assert.equal(offAt - lastSpeech + 80, 680);
  // Puis plus aucun échantillon : la péremption reprend ses droits, l'état devient inconnu.
  assert.equal(peerSpeaking(PEER, b.samples, offAt + SPEAKING_STALE_MS + 1), 'unknown');
});

// ─────────────────────────────────────────────────────────────────────────────
// R-U8 §1 — le battement
// ─────────────────────────────────────────────────────────────────────────────

test('R-U8.1 — la période de battement est franchement sous la péremption', () => {
  assert.ok(
    SAMPLE_PERIOD_MS < SPEAKING_STALE_MS,
    `battement ${SAMPLE_PERIOD_MS} ms vs péremption ${SPEAKING_STALE_MS} ms`,
  );
  assert.ok(SAMPLE_PERIOD_MS <= SPEAKING_STALE_MS / 4, 'marge insuffisante : 4 battements par péremption');
  assert.ok(
    SPEAKING_HOLD_MS >= 500 && SPEAKING_HOLD_MS <= 700,
    `tenue ${SPEAKING_HOLD_MS} ms hors de la plage 500-700 ms de R-U8 §2`,
  );
});

test('R-U8.1 — pendant une longue phrase, chaque échantillon est réécrit (aucun trou)', () => {
  const b = bench();
  let now = open(b);
  const stamps: number[] = [now];
  for (let i = 0; i < 40; i += 1) {
    now += SAMPLE_PERIOD_MS;
    b.tick(now, { [PEER]: LOUD });
    stamps.push(b.samples.get(PEER)!.at);
    assert.equal(peerSpeaking(PEER, b.samples, now), 'true');
  }
  for (let i = 1; i < stamps.length; i += 1) {
    const previous = stamps[i - 1] as number;
    const current = stamps[i] as number;
    assert.equal(current - previous, SAMPLE_PERIOD_MS, 'battement irrégulier');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Règle 1 — l'absence de mesure n'est pas du silence
// ─────────────────────────────────────────────────────────────────────────────

test('règle 1 — `null` n\u2019écrit rien : la table reste vide, donc l\u2019affichage dit « inconnu »', () => {
  const b = bench();
  const measured = b.tick(1000, { [PEER]: null });
  assert.deepEqual(measured, []);
  assert.equal(b.samples.has(PEER), false);
  assert.equal(peerSpeaking(PEER, b.samples, 1000), 'unknown');
});

test('règle 1 — une mesure qui disparaît efface l\u2019entrée au lieu de la laisser périmer', () => {
  const b = bench();
  const now = open(b);
  assert.equal(peerSpeaking(PEER, b.samples, now), 'true');
  b.tick(now + SAMPLE_PERIOD_MS, { [PEER]: null });
  // Un `true` qui survit 600 ms après la perte du flux serait une affirmation sans mesure.
  assert.equal(b.samples.has(PEER), false);
  assert.equal(peerSpeaking(PEER, b.samples, now + SAMPLE_PERIOD_MS), 'unknown');
});

test('règle 1 — le silence mesuré s\u2019affiche « false », pas « inconnu »', () => {
  const b = bench();
  b.tick(0, { [PEER]: QUIET });
  assert.deepEqual(b.samples.get(PEER), { speaks: 'false', at: 0 });
  assert.equal(peerSpeaking(PEER, b.samples, 0), 'false');
  // Un pair qui n'a jamais parlé ne bénéficie d'aucune tenue.
  assert.equal(heldSpeaks(false, null, 0), false);
});

test('rmsToDbfs — borné, et monotone sur les niveaux audibles', () => {
  assert.equal(rmsToDbfs(0), -100);
  assert.equal(rmsToDbfs(Number.NaN), -100);
  assert.equal(rmsToDbfs(1e-9), -100);
  assert.ok(Math.abs(rmsToDbfs(0.2) - -13.98) < 0.01);
  assert.ok(rmsToDbfs(0.2) > rmsToDbfs(0.02));
});

// ─────────────────────────────────────────────────────────────────────────────
// A6 / AD-19 D2 — l'espace d'id de la table
// ─────────────────────────────────────────────────────────────────────────────

test('AD-19 D2 (A6) — une écriture pour un id hors maillage est ignorée', () => {
  const samples = new Map<string, PeerSpeakingSample>();
  const verdict = recordPeerSpeaking(samples, ['pair-a', 'pair-b'], 'intrus', { speaks: 'true', at: 7 });
  assert.equal(verdict, 'ignored');
  assert.equal(samples.size, 0, 'un id hors maillage a créé une entrée');
  assert.equal(recordPeerSpeaking(samples, ['pair-a'], 'pair-a', { speaks: 'false', at: 8 }), 'written');
  assert.deepEqual([...samples.keys()], ['pair-a']);
});

test('AD-19 D2 — le producteur n\u2019écrit que les ids du maillage, et oublie ceux qui en sortent', () => {
  const b = bench(['pair-a', 'pair-b']);
  b.tick(0, { 'pair-a': QUIET, 'pair-b': LOUD });
  b.tick(50, { 'pair-a': QUIET, 'pair-b': LOUD });
  assert.deepEqual([...b.samples.keys()].sort(), ['pair-a', 'pair-b']);

  // `pair-b` quitte le maillage : son entrée et son hystérésis partent avec lui.
  b.mesh.splice(b.mesh.indexOf('pair-b'), 1);
  b.tick(100, { 'pair-a': QUIET });
  assert.deepEqual([...b.samples.keys()], ['pair-a']);
  assert.equal(peerSpeaking('pair-b', b.samples, 100), 'unknown');
});

test('AD-19 D2 — une entrée sans émetteur dans le maillage est effacée au battement suivant', () => {
  const b = bench();
  b.tick(0, { [PEER]: QUIET });
  // Entrée écrite par quelqu'un d'autre (ou restée d'une session précédente).
  b.samples.set('fantome', { speaks: 'true', at: 0 });
  b.tick(SAMPLE_PERIOD_MS, { [PEER]: QUIET });
  assert.equal(b.samples.has('fantome'), false);
});

test('reset — la table et les hystérésis sont rendues vides', () => {
  const b = bench(['pair-a', 'pair-b']);
  b.tick(0, { 'pair-a': LOUD, 'pair-b': QUIET });
  b.tick(50, { 'pair-a': LOUD, 'pair-b': QUIET });
  b.samples.set('fantome', { speaks: 'true', at: 0 });
  b.tracker.reset();
  assert.equal(b.samples.size, 0);
  // Après reset, aucune mémoire cachée : le silence mesuré s'affiche « false » (un reste de
  // tenue afficherait « true »), et une trame parlante réalimente la table normalement.
  b.tick(100, { 'pair-a': QUIET, 'pair-b': null });
  assert.deepEqual(b.samples.get('pair-a'), { speaks: 'false', at: 100 });
  b.tick(150, { 'pair-a': LOUD });
  assert.equal(b.samples.get('pair-a')!.speaks, 'true');
});

// ─────────────────────────────────────────────────────────────────────────────
// Robustesse d'horloge
// ─────────────────────────────────────────────────────────────────────────────

test('horloge — un retour en arrière ne produit pas de halo éternel', () => {
  const b = bench();
  b.tick(1000, { [PEER]: LOUD });
  b.tick(1050, { [PEER]: LOUD }); // ancre de la tenue : 1050
  // Le VAD referme sa porte (6 trames sous le seuil) : la suite ne dépend plus que de la tenue.
  for (const t of [1100, 1200, 1300, 1400, 1500, 1550]) b.tick(t, { [PEER]: QUIET });
  assert.equal(peerSpeaking(PEER, b.samples, 1550), 'true'); // 500 ms après la syllabe
  // L'horloge de rendu recule : la tenue repart de « maintenant », elle ne court pas après elle.
  b.tick(1050, { [PEER]: QUIET });
  assert.equal(peerSpeaking(PEER, b.samples, 1050), 'true');
  b.tick(1649, { [PEER]: QUIET });
  assert.equal(peerSpeaking(PEER, b.samples, 1649), 'true');
  b.tick(1650, { [PEER]: QUIET });
  assert.equal(peerSpeaking(PEER, b.samples, 1650), 'false');
  // Et sans nouvel échantillon, la péremption reprend la main : jamais de halo éternel.
  assert.equal(peerSpeaking(PEER, b.samples, 1650 + SPEAKING_STALE_MS + 1), 'unknown');
});

test('horloge — un horodatage non fini n\u2019écrit rien et ne casse pas la table', () => {
  const b = bench();
  b.tick(0, { [PEER]: QUIET });
  const before = b.samples.get(PEER);
  assert.deepEqual(b.tick(Number.NaN, { [PEER]: LOUD }), []);
  assert.deepEqual(b.samples.get(PEER), before);
});

test('robustesse — un `level()` qui jette est traité comme une absence de mesure', () => {
  const samples = new Map<string, PeerSpeakingSample>();
  const tracker = createPeerSpeechTracker(samples);
  const measured = tracker.sample(
    {
      peers: [PEER],
      level: () => {
        throw new Error('analyseur détruit');
      },
    },
    0,
  );
  assert.deepEqual(measured, []);
  assert.equal(samples.has(PEER), false);
});
