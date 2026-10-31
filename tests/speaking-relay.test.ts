/**
 * tests/speaking-relay.test.ts — la cadence de publication de « qui parle » vers l'overlay
 * (AD-20 D1/D3, arbitrage de Régie : transitions seules, jamais 5 Hz).
 *
 * Ce que ces tests falsifient, dans l'ordre du risque :
 *   — AC20-2 : 10 s de silence complet ⇒ 0 message (l'ensemble vide ne bat pas).
 *   — AC20-3 : 10 s de parole avec 4 pauses de 400 ms ⇒ ≤ 12 messages ET zéro halo éteint.
 *   — D3 : transitions seules + garde-vie ≤ 1 Hz (donc 11 messages sur 10 s de parole continue).
 *   — R-U8 §2 : tenue de relâchement 600 ms de la parole LOCALE (mesure brute, sans mémoire).
 *   — D1/P1 : soi et les pairs dans le MÊME tableau, même domaine d'id, aucun drapeau `self`.
 *
 * La scène de bout en bout (`scene10s`) ne fabrique pas ses ids : elle fait passer de VRAIS
 * niveaux par `createPeerSpeechTracker` puis par la porte d'affichage `peerSpeaking()`, et ne
 * donne au relais que ce que l'écran afficherait. Un test qui doublerait la tenue mesurerait sa
 * propre copie au lieu du chemin réel.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  SPEAKING_KEEPALIVE_MS,
  createSpeakingRelay,
  type SpeakingInput,
} from '../src/renderer/speaking-relay.ts';
import { SAMPLE_PERIOD_MS, SPEAKING_HOLD_MS, createPeerSpeechTracker } from '../src/renderer/peer-speech.ts';
import { SPEAKING_STALE_MS, peerSpeaking } from '../src/renderer/participant-state.ts';
import {
  SPEAKING_RELAY_STALE_MS,
  createSpeakingSurface,
} from '../src/renderer/speaking-surface.ts';

const SELF = 'self-1';
const PEER = 'peer-1';

/** Ce que le relais reçoit en production : verdicts déjà tenus côté pairs, brut côté soi. */
function input(peers: readonly string[], self = false, selfId: string | null = SELF): SpeakingInput {
  return { selfId, self, peers };
}

interface Emission {
  at: number;
  speaking: readonly string[];
}

/** `noUncheckedIndexedAccess` : un test qui lit un message doit dire ce qu'il attend s'il manque. */
function nth(emissions: readonly Emission[], index: number): Emission {
  const found = emissions[index];
  if (found === undefined) throw new Error(`aucune émission à l’index ${index}`);
  return found;
}

function drive(
  relay: ReturnType<typeof createSpeakingRelay>,
  from: number,
  to: number,
  at: (now: number) => SpeakingInput,
): Emission[] {
  const emissions: Emission[] = [];
  for (let now = from; now <= to; now += SAMPLE_PERIOD_MS) {
    const speaking = relay.update(at(now), now);
    if (speaking !== null) emissions.push({ at: now, speaking });
  }
  return emissions;
}

test('AC20-2 — 10 s de silence complet ne produisent AUCUN message', () => {
  const relay = createSpeakingRelay();
  const emissions = drive(relay, 0, 10_000, () => input([]));
  assert.deepEqual(emissions, [], 'un ensemble vide ne se publie pas et ne bat pas');
});

test('AC20-3 — 10 s de parole, 4 pauses de 400 ms : ≤ 12 messages, aucune extinction', () => {
  // Scène réelle : niveaux → VAD/hystérésis → tenue 600 ms → porte d'affichage → relais.
  const table = new Map<string, { speaks: 'true' | 'false'; at: number }>();
  const tracker = createPeerSpeechTracker(table);
  const relay = createSpeakingRelay();
  const pauses = [
    [2000, 2400],
    [4000, 4400],
    [6000, 6400],
    [8000, 8400],
  ] as const;
  const isPause = (now: number): boolean => pauses.some(([from, to]) => now >= from && now < to);

  const emissions = drive(relay, 0, 10_000, (now) => {
    // 0,2 en parole (≈ −14 dBFS), 0,0005 en pause (≈ −66 dBFS) : silence franc.
    const probe = { peers: [PEER], level: () => (isPause(now) ? 0.0005 : 0.2) };
    tracker.sample(probe, now);
    const speaking = peerSpeaking(PEER, table, now) === 'true';
    return input(speaking ? [PEER] : [], false);
  });

  assert.ok(emissions.length <= 12, `budget dépassé : ${emissions.length} messages`);
  assert.equal(
    emissions.filter((emission) => emission.speaking.length === 0).length,
    0,
    'aucun halo éteint : les 4 pauses sont couvertes par la tenue de 600 ms',
  );
  for (const emission of emissions) assert.deepEqual(emission.speaking, [PEER]);
  assert.equal(nth(emissions, 0).at, 0, 'attaque au premier échantillon parlant, sans délai');
});

test('D3 — parole continue 10 s : attaque + un garde-vie par seconde, et rien d’autre', () => {
  const relay = createSpeakingRelay();
  const emissions = drive(relay, 0, 10_000, () => input([PEER]));
  assert.equal(emissions.length, 11, '1 attaque + 10 garde-vies : 11 ≤ 12');
  assert.deepEqual(
    emissions.map((emission) => emission.at),
    [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10_000],
  );
  for (let index = 1; index < emissions.length; index += 1) {
    const gap = nth(emissions, index).at - nth(emissions, index - 1).at;
    assert.ok(gap <= SPEAKING_KEEPALIVE_MS, `garde-vie trop lente : ${gap} ms`);
  }
});

test('D3 — le silence qui suit la parole coûte UN message (l’extinction), puis plus rien', () => {
  const relay = createSpeakingRelay();
  drive(relay, 0, 1000, () => input([PEER]));
  const silence = drive(relay, 1050, 11_000, () => input([]));
  assert.equal(silence.length, 1, `silence de 10 s : ${silence.length} message(s)`);
  assert.deepEqual(nth(silence, 0).speaking, []);
});

test('R-U8 §2 — tenue de soi : extinction 600 ms après la dernière trame parlante', () => {
  const relay = createSpeakingRelay();
  const emissions = drive(relay, 0, 3000, (now) => input([], now < 1000));

  assert.deepEqual(nth(emissions, 0), { at: 0, speaking: [SELF] }, 'attaque immédiate (0 ms)');
  const last = nth(emissions, emissions.length - 1);
  assert.deepEqual(last.speaking, [], 'l’extinction finit bien par arriver');
  // Dernière trame MESURÉE parlante = 950 ms (la trame 1000 est déjà muette) : la tenue court
  // depuis la mesure, pas depuis une frontière ronde — même ancre que le producteur des pairs.
  const lastSpokenFrame = 950;
  assert.equal(last.at, lastSpokenFrame + SPEAKING_HOLD_MS, 'extinction = dernière syllabe + 600 ms');
  const extinctions = emissions.filter((emission) => emission.speaking.length === 0);
  assert.equal(extinctions.length, 1, 'une seule extinction, pas de battement de halo');
});

test('R-U8 §2 — rafale 10 Hz de soi : aucun clignotement (la tenue couvre les creux)', () => {
  const relay = createSpeakingRelay();
  // Une trame parlante sur deux, pendant 3 s : sans tenue, 30 extinctions.
  const emissions = drive(relay, 0, 3000, (now) => input([], Math.floor(now / SAMPLE_PERIOD_MS) % 2 === 0));
  for (const emission of emissions) {
    assert.deepEqual(emission.speaking, [SELF], `extinction parasite à ${emission.at} ms`);
  }
  assert.ok(emissions.length <= 4, `garde-vie trop bavarde : ${emissions.length}`);
});

test('D1/P1 — soi et les pairs dans le même tableau, aucun drapeau, ids triés', () => {
  const relay = createSpeakingRelay();
  assert.deepEqual(relay.update(input(['peer-2', 'peer-1'], true), 0), ['peer-1', 'peer-2', SELF]);
  // La charge utile publiée ne porte QUE des ids : ni niveau, ni booléen, ni champ `self`.
  const payload = { speaking: relay.speaking };
  assert.deepEqual(Object.keys(payload), ['speaking']);
  for (const id of payload.speaking) assert.equal(typeof id, 'string');
});

test('remplacement complet — chaque message porte l’ensemble entier', () => {
  const relay = createSpeakingRelay();
  assert.deepEqual(relay.update(input(['peer-1']), 0), ['peer-1']);
  assert.deepEqual(relay.update(input(['peer-1', 'peer-2']), 50), ['peer-1', 'peer-2']);
  assert.deepEqual(relay.update(input(['peer-2']), 100), ['peer-2'], 'départ de peer-1 = remplacement');
});

test('forme canonique — doublons fondus, ids vides ignorés, ordre stable', () => {
  const relay = createSpeakingRelay();
  assert.deepEqual(relay.update(input(['peer-2', 'peer-2', '', 'peer-1']), 0), ['peer-1', 'peer-2']);
  assert.equal(relay.update(input(['peer-1', 'peer-2']), 50), null, 'même ensemble = aucun message');
});

test('soi sans id de signalisation — pas d’entrée inventée', () => {
  const relay = createSpeakingRelay();
  assert.equal(relay.update(input([], true, null), 0), null);
});

test('horloge non finie — rien n’est publié, la tenue ne se juge pas sur une horloge absente', () => {
  const relay = createSpeakingRelay();
  assert.equal(relay.update(input([PEER]), Number.NaN), null);
  assert.deepEqual(relay.speaking, []);
});

test('reset — le prochain ensemble est republié, même vide à l’origine', () => {
  const relay = createSpeakingRelay();
  relay.update(input([PEER]), 0);
  relay.reset();
  assert.deepEqual(relay.speaking, []);
  assert.deepEqual(relay.update(input([PEER]), 10), [PEER], 'après reset, l’ensemble repart de zéro');
  assert.equal(relay.update(input([PEER]), 20), null);
});

/* ========================================================================== */
/* AD-25 §6 — la surface RELAYÉE : échéancier armé à l'arrivée, 2000 ms        */
/* ========================================================================== */

/**
 * Banc d'essai de la surface : horloge virtuelle PARTAGÉE avec le port de minuterie, de sorte que
 * « l'âge » et « l'échéance » se jugent sur le même temps (sinon on testerait deux horloges et le
 * test passerait pour de mauvaises raisons).
 */
function surfaceHarness() {
  let now = 0;
  const pending = new Set<{ due: number; fire: () => void }>();
  const counts = { armed: 0, cancelled: 0 };
  const changes: (readonly string[])[] = [];

  const surface = createSpeakingSurface({
    clock: () => now,
    timers: {
      once: (ms: number, callback: () => void): unknown => {
        counts.armed += 1;
        const handle = { due: now + ms, fire: callback };
        pending.add(handle);
        return handle;
      },
      cancel: (handle: unknown): void => {
        counts.cancelled += 1;
        pending.delete(handle as { due: number; fire: () => void });
      },
    },
    onChange: (ids) => changes.push(ids),
  });

  /** Avance le temps et exécute les échéances dues, comme le ferait la boucle d'événements. */
  function advance(ms: number): void {
    now += ms;
    for (const handle of [...pending].sort((a, b) => a.due - b.due)) {
      if (handle.due <= now) {
        pending.delete(handle);
        handle.fire();
      }
    }
  }

  return { surface, changes, counts, advance, pending, now: () => now };
}

/** Les lignes de CODE : un commentaire qui NOMME une constante ne la consomme pas (cf. A3). */
function codeOf(source: string): string {
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith('//') &&
        !line.startsWith('*') &&
        !line.startsWith('/*'),
    )
    .join('\n');
}

test('AD-25 §6.1 — le seuil de la surface relayée vaut 2000 ms, et c’est un seuil, pas une cadence', () => {
  // Budget ACo-9 : 2000 + 1 trame. 2500 (AD-23 D4.2) le dépasserait ; 250 est un AUTRE rôle
  // (table producteur) et ne doit jamais servir ici (AC20-8r).
  assert.equal(SPEAKING_RELAY_STALE_MS, 2000);
  assert.notEqual(SPEAKING_RELAY_STALE_MS, SPEAKING_STALE_MS);
});

test('AD-25 §6.5a — producteur tué, plus AUCUN message : halo éteint à 2000 ms, sans message', () => {
  const h = surfaceHarness();
  h.surface.receive([PEER]);
  assert.equal(h.surface.speakingOf(PEER), 'true');

  const before = h.changes.length; // l'arrivée a notifié une fois
  h.advance(SPEAKING_RELAY_STALE_MS); // 2000 ms + la trame de l'échéance, zéro message reçu

  assert.equal(h.surface.speakingOf(PEER), 'unknown', 'le halo est éteint sans aucune trame');
  assert.equal(h.changes.length, before + 1, 'une seule notification d’extinction');
  assert.deepEqual(h.changes.at(-1), [], 'l’extinction rend l’ensemble vide');
  assert.equal(h.now(), SPEAKING_RELAY_STALE_MS, 'budget ACo-9 : 2000 ms + 1 trame, jamais 4000 (balayage)');
});

test('AD-25 §6.5b — encore vrai à t0+1999, plus à t0+2001', () => {
  const h = surfaceHarness();
  h.surface.receive([PEER, 'peer-2']);

  h.advance(1999);
  assert.equal(h.surface.speakingOf(PEER), 'true', 'à t0+1999 le halo tient encore');
  assert.deepEqual(h.surface.ids(), ['peer-1', 'peer-2']);

  h.advance(2); // t0+2001 : l'échéance de 2000 est due
  assert.equal(h.surface.speakingOf(PEER), 'unknown', 'à t0+2001 il n’y a plus rien à affirmer');
  assert.equal(h.surface.speakingOf('peer-2'), 'unknown');
});

test('AD-25 §6.5c — aucun minuteur survivant au démontage de l’overlay', () => {
  const h = surfaceHarness();
  h.surface.receive([PEER]);
  assert.equal(h.counts.armed, 1);
  assert.equal(h.pending.size, 1);

  const before = h.changes.length;
  h.surface.dispose();

  assert.equal(h.pending.size, 0, 'l’échéancier est désarmé au démontage (`cancel` atteint)');
  assert.equal(h.counts.cancelled, 1);
  h.advance(10_000); // plus rien ne doit se déclencher
  assert.equal(h.changes.length, before, 'aucune notification après démontage');
  assert.equal(h.surface.speakingOf(PEER), 'unknown');
});

test('AD-25 D2 — un seul créneau : chaque arrivée annule puis réarme, jamais d’empilement', () => {
  const h = surfaceHarness();
  // Garde-vie à 1 Hz pendant 4 s : 4 arrivées identiques.
  for (let i = 0; i < 4; i += 1) {
    h.surface.receive([PEER]);
    h.advance(1000);
  }
  assert.ok(h.pending.size <= 1, 'jamais plus d’un échéancier armé');
  assert.equal(h.counts.armed, 4, 'un armement par arrivée');
  assert.equal(h.counts.cancelled, 3, 'chaque réarmement a annulé le précédent');
  assert.equal(h.surface.speakingOf(PEER), 'true', 'le halo reste allumé tant que le producteur parle');
});

test('AD-25 D2 — l’échéance VÉRIFIE l’âge : une échéance en avance n’éteint pas un halo frais', () => {
  const h = surfaceHarness();
  h.surface.receive([PEER]);
  const [early] = [...h.pending];
  if (!early) throw new Error('aucune échéance armée : le test ne prouverait rien');
  h.advance(1500); // l'âge (1500 ms) est encore sous le seuil
  h.pending.delete(early); // l'échéance est consommée, comme le ferait la boucle d'événements
  early.fire();
  assert.equal(h.surface.speakingOf(PEER), 'true', 'éteindre sans vérifier l’âge éteindrait un halo frais');
  assert.equal(h.pending.size, 1, 'l’échéance s’est réarmée pour le restant');
});

test('ACo-16 — la garde-vie à 1 Hz ne change rien : ZÉRO notification, donc zéro rendu', () => {
  const h = surfaceHarness();
  // L'ensemble vide se publie UNE fois (AC20-2) : rien n'était affiché, rien ne change ⇒ zéro rendu.
  h.surface.receive([]);
  assert.equal(h.changes.length, 0, 'une trame vide sur une surface vide ne notifie pas');
  h.surface.receive([PEER]);
  assert.equal(h.changes.length, 1, 'l’allumage notifie une fois');
  // 10 s de garde-vie à 1 Hz, ensemble identique.
  for (let i = 0; i < 10; i += 1) {
    h.advance(1000);
    if (i < 9) h.surface.receive([PEER]);
  }
  assert.equal(h.changes.length, 1, 'aucune notification d’un ensemble inchangé');
  assert.ok(h.changes.length <= 2, 'ACo-16 : ≤2 rendus sur 10 s, tenu par construction');
});

test('AD-17 D1 — la surface relayée ne dit jamais `false`, et un âge négatif vaut `unknown`', () => {
  const h = surfaceHarness();
  h.surface.receive([PEER]);
  assert.equal(h.surface.speakingOf('peer-inconnu'), 'unknown', 'absent ≠ muet');
  assert.equal(h.surface.speakingOf(PEER), 'true');

  // Horloge qui recule (fenêtres distinctes, trame « du futur ») : âge négatif ⇒ unknown, jamais false.
  const back = surfaceHarness();
  back.surface.receive([PEER]);
  back.advance(-5);
  assert.equal(back.surface.speakingOf(PEER), 'unknown');
});

test('AD-25 §6.1 — AC20-8r : aucun nom réciproque entre la table producteur et la surface', () => {
  // La surface relayée ne lit jamais 250 ; la table producteur (Room.tsx / PEER_LEVELS) ne lit
  // jamais 2000. Vérifié sur le texte des sources (React/Vite non installables ici).
  const surface = readFileSync(new URL('../src/renderer/speaking-surface.ts', import.meta.url), 'utf8');
  assert.ok(surface.includes('SPEAKING_RELAY_STALE_MS'), 'le seuil est nommé dans la surface');
  assert.equal(
    /SPEAKING_STALE_MS/.test(codeOf(surface)),
    false,
    'la surface ne nomme jamais le seuil de 250 ms',
  );

  for (const rel of ['Overlay.tsx', 'overlay-entry.tsx']) {
    const text = codeOf(readFileSync(new URL(`../src/renderer/${rel}`, import.meta.url), 'utf8'));
    assert.equal(
      /SPEAKING_STALE_MS|PEER_LEVELS|peerSpeaking/.test(text),
      false,
      `${rel} ne lit pas la table 250 ms`,
    );
  }

  for (const prod of ['Room.tsx', 'participant-state.ts', 'speaking-relay.ts']) {
    const text = codeOf(readFileSync(new URL(`../src/renderer/${prod}`, import.meta.url), 'utf8'));
    assert.equal(/SPEAKING_RELAY_STALE_MS/.test(text), false, `${prod} ne lit jamais le seuil de la surface`);
  }

  // Câblage de l'entrée overlay : la clé existante est consommée, l'échéancier passe par le port
  // de minuterie de la page (A3 : deux fichiers, pas trois) et le démontage désarme.
  const entry = codeOf(readFileSync(new URL('../src/renderer/overlay-entry.tsx', import.meta.url), 'utf8'));
  assert.ok(entry.includes('api.onSpeakingSet('), 'l’overlay consomme `lan:event:speaking-set`');
  assert.ok(entry.includes('surface.receive('), 'la trame reçue alimente la surface');
  assert.ok(entry.includes('browserTimers()'), 'l’échéancier passe par le port de minuterie du renderer');
  assert.ok(entry.includes('surface.dispose()'), 'le démontage désarme l’échéancier');
  assert.equal(
    /set(Timeout|Interval)\s*\(/.test(entry),
    false,
    'aucune minuterie ambiante dans l’overlay (A3 resterait à 2 fichiers)',
  );

  // Sens unique : le main recopie vers l'overlay, l'overlay n'écrit jamais sur le canal.
  const main = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  assert.ok(main.includes('IPC.eventSpeakingSet'), 'le main recopie vers l’overlay');
  for (const rel of ['Overlay.tsx', 'overlay-entry.tsx', 'speaking-surface.ts']) {
    const text = codeOf(readFileSync(new URL(`../src/renderer/${rel}`, import.meta.url), 'utf8'));
    assert.equal(/setSpeaking\s*\(/.test(text), false, `${rel} n’écrit jamais sur le canal`);
  }
});
