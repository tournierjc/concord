/**
 * tests/voice-mesh.node.test.ts — la couture coquille ⇄ maillage, mesurée hors Chromium.
 *
 * TÂCHE T16d / SPEC-009 §3, tests T1..T6. Le harnais est celui de VERIF-017 : globals DOM
 * doublurés (`tests/fake-rtc.ts`), VRAI `media-plane.ts`, VRAI `mesh.ts`, faux `getUserMedia`
 * rendu contrôlable, `emitSignal` espionné par un tableau. Aucun socket, aucune dépendance
 * ajoutée : le renderer n'est pas importé, `voice-mesh.ts` est pur (ni React, ni `window`).
 *
 * Ce que ces six tests prouvent, et ce qu'ils ne prouvent PAS :
 *   • prouvé : l'ordre d'ouverture, le tampon vidé une seule fois dans l'ordre, l'absence de
 *     diffusion d'ICE, l'ordre de fermeture mesh → plan, la mort du mesh en reconnexion et le
 *     mesh unique au retour, la purge comptée des candidats sans destinataire ;
 *   • NON prouvé (cf. rapport T16d) : Chromium réel, l'oreille humaine, et la connectivité
 *     effective — aucun candidat ICE LOCAL ne sort (DÉFAUT-E, contrats gelés), donc deux pairs
 *     ne peuvent pas s'apparier. T3 mesure ce zéro au lieu de le taire.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';

import {
  CANDIDATE_HOST_RFC1918,
  FakeMediaStream,
  FakeTrack,
  OFFER_SDP,
  installFakeDom,
  type FakeDom,
} from './fake-rtc.ts';
import { createVoiceWiring, type VoiceWiring } from '../src/renderer/voice-mesh.ts';
import type { SignalIn, SignalKind, SignalOut } from '../src/engine/net/mesh.ts';

/* ------------------------------------------------------------------------- */
/* Harnais                                                                    */
/* ------------------------------------------------------------------------- */

interface Harness {
  readonly wire: VoiceWiring;
  readonly dom: FakeDom;
  /** Tout ce qui SORT : l'espion d'`emitSignal`. */
  readonly sent: SignalOut[];
  /** Les gestes, dans l'ordre : `gum`, `mesh:ouvert`, `fermeture:*`, `offer:<pair>`. */
  readonly steps: string[];
  /** Les lignes de diagnostic du câblage, dans l'ordre. */
  readonly diagnostics: string[];
  /** Les paliers de lien publiés par le mesh, dans l'ordre. */
  readonly peerStates: string[];
  /** Ce que le bookkeeping d'interface a reçu (ex-`handleSignal`), dans l'ordre. */
  readonly uiMessages: string[];
  /** Injecte un message comme le ferait `lan:event:signal`. */
  deliver(message: SignalIn): void;
  /** Rend la main au faux `getUserMedia` (T1/T2). */
  resolveMicrophone(): void;
  /** Compte des appels au faux `getUserMedia`. */
  readonly gumCalls: number;
}

let restore: (() => void) | null = null;

afterEach(() => {
  restore?.();
  restore = null;
});

/**
 * Monte une session câblée. `deferredMic` garde `getUserMedia` en attente : c'est la fenêtre
 * pendant laquelle le tuyau peut parler alors que le mesh n'existe pas encore (T1/T2).
 */
function harness(
  dom: FakeDom,
  options: { deferredMic?: boolean; earlyCandidates?: RTCIceCandidateInit[] } = {},
): Harness {
  const sent: SignalOut[] = [];
  const steps: string[] = [];
  const diagnostics: string[] = [];
  const peerStates: string[] = [];
  const uiMessages: string[] = [];
  let gumCalls = 0;

  // Faux `getUserMedia` : contrôlable quand T1/T2 en ont besoin, immédiat sinon.
  let release: (() => void) | null = null;
  const mediaDevices = (globalThis as unknown as {
    navigator: { mediaDevices: { getUserMedia: unknown } };
  }).navigator.mediaDevices;

  mediaDevices.getUserMedia = (): Promise<FakeMediaStream> => {
    gumCalls += 1;
    steps.push('gum');
    const stream = new FakeMediaStream([new FakeTrack()]);
    if (options.deferredMic !== true) return Promise.resolve(stream);
    return new Promise<FakeMediaStream>((resolveGum) => {
      release = () => {
        resolveGum(stream);
      };
    });
  };

  let handler: ((message: SignalIn) => void) | null = null;

  const wire = createVoiceWiring({
    localId: 'a',
    send: (message) => {
      sent.push(message);
      if (message.kind !== 'leave') steps.push(`${message.kind}:${message.to}`);
    },
    subscribe: (next) => {
      handler = next;
      return () => {
        handler = null;
      };
    },
    onMessage: (message) => {
      uiMessages.push(message.kind);
    },
    onPeerState: (peerId, state) => {
      peerStates.push(`${peerId}:${state}`);
    },
    onRemoteStream: () => {
      // Aucun puits audio ici : DÉFAUT-C est hors de ce lot (cf. rapport T16d).
    },
    onStateChange: () => {
      // L'échec ICE nominatif est publié par `voice.ts` via `onPeerConnectionState` ;
      // hors périmètre de ces six tests (mesuré dans tests/voice-peer-state.node.test.ts).
    },
    onPeerConnectionState: () => {
      // Idem : la route par pair est mesurée ailleurs, pas dans T1..T7.
    },
    onLive: () => {
      steps.push('live');
    },
    onError: () => {
      steps.push('erreur');
    },
    onDiagnostic: (line) => {
      diagnostics.push(line);
      if (line.startsWith('mesh:ouvert')) steps.push('mesh:ouvert');
      if (line.startsWith('fermeture:')) steps.push(line);
    },
    earlyCandidates: options.earlyCandidates ?? [],
  });

  return {
    wire,
    dom,
    sent,
    steps,
    diagnostics,
    peerStates,
    uiMessages,
    deliver(message): void {
      if (handler === null) throw new Error('aucun abonnement au tuyau : le câblage ne reçoit rien');
      handler(message);
    },
    resolveMicrophone(): void {
      if (release === null) throw new Error('le micro n’était pas en attente : rien à résoudre');
      release();
    },
    get gumCalls(): number {
      return gumCalls;
    },
  };
}

function freshDom(): FakeDom {
  const dom = installFakeDom();
  restore = () => {
    dom.restore();
  };
  return dom;
}

function join(peerId: string): SignalIn {
  return { kind: 'peer-joined', peerId, name: peerId.toUpperCase() };
}

function offers(steps: readonly string[]): string[] {
  return steps.filter((step) => step.startsWith('offer:'));
}

/**
 * Laisse le maillage finir ses `await` (`Mesh.onSignal` est asynchrone : offre, `send`, notify).
 * Sans cette attente, on mesurerait l'état d'avant le geste, pas son effet.
 */
async function flush(rounds = 4): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

/* ========================================================================== */
/* T1 — ordre d'ouverture : le tuyau parle avant le micro                      */
/* ========================================================================== */

describe('T16d / SPEC-009 §3 — T1 : message reçu avant la résolution du micro', () => {
  it('rien ne sort, rien n’est instancié, puis tout est délivré après : micro < mesh < onSignal', async () => {
    const dom = freshDom();
    const h = harness(dom, { deferredMic: true });

    const starting = h.wire.start();
    assert.equal(h.gumCalls, 1, 'le micro est demandé');

    // Le tuyau parle AVANT que le micro n'ait répondu : le message doit attendre.
    h.deliver(join('b'));

    assert.deepEqual(h.sent, [], 'aucun candidat, aucune offre : rien ne sort avant le micro');
    assert.equal(h.wire.meshAlive, false, 'aucun mesh avant la fin de startMicrophone');
    assert.equal(h.wire.buffered, 1, 'le message est tamponné, pas perdu');
    assert.equal(dom.peers.length, 0, 'aucune RTCPeerConnection construite avant le mesh');
    assert.deepEqual(h.uiMessages, ['peer-joined'], 'l’interface est servie tout de suite');

    h.resolveMicrophone();
    assert.equal(await starting, true, 'start() rend la main sur un câblage vivant');

    assert.equal(h.wire.meshAlive, true);
    assert.equal(h.wire.buffered, 0, 'tampon vidé');
    assert.equal(dom.peers.length, 1, 'le mesh ouvre une connexion pour le pair tamponné');

    // Ordre exigé par SPEC-009 §1(a) : startMicrophone < createMesh < premier onSignal.
    const order = h.steps.filter((step) => step === 'gum' || step === 'mesh:ouvert' || step === 'offer:b');
    assert.deepEqual(order, ['gum', 'mesh:ouvert', 'offer:b'], `ordre observé : ${h.steps.join(' → ')}`);
    assert.deepEqual(offers(h.steps), ['offer:b'], 'une seule offre, celle du message tamponné');
    assert.deepEqual(h.peerStates, ['b:connecting'], 'le palier de lien vient du mesh, pas d’une devinette');
  });
});

/* ========================================================================== */
/* T2 — tampon : 3 messages, ordre d'arrivée, une seule délivrance             */
/* ========================================================================== */

describe('T16d / SPEC-009 §3 — T2 : trois messages reçus avant l’existence du mesh', () => {
  it('3 délivrés, dans l’ordre d’arrivée, exactement une fois chacun', async () => {
    const dom = freshDom();
    const h = harness(dom, { deferredMic: true });

    const starting = h.wire.start();
    h.deliver(join('b'));
    h.deliver(join('c'));
    h.deliver(join('d'));

    assert.deepEqual(h.sent, [], 'aucune offre tant que le mesh n’existe pas');
    assert.equal(h.wire.buffered, 3);

    h.resolveMicrophone();
    await starting;

    assert.equal(h.wire.buffered, 0, 'le tampon est vidé une seule fois');
    assert.deepEqual(offers(h.steps), ['offer:b', 'offer:c', 'offer:d'], 'ordre d’arrivée respecté');
    assert.equal(offers(h.steps).length, 3, 'compteur de sortie = 3');
    assert.deepEqual(h.uiMessages, ['peer-joined', 'peer-joined', 'peer-joined'], 'compteur d’entrée = 3');
    assert.equal(new Set(offers(h.steps)).size, 3, 'chaque pair reçoit une offre, une seule');
    assert.equal(dom.peers.length, 3, 'trois pairs, trois connexions — aucune duplication');

    // Un message supplémentaire APRÈS le vidage part directement : le tampon ne rejoue rien.
    h.deliver(join('c'));
    assert.deepEqual(offers(h.steps), ['offer:b', 'offer:c', 'offer:d'], 'peer-joined rejoué = no-op du mesh');
    assert.equal(h.wire.buffered, 0);
  });
});

/* ========================================================================== */
/* T3 — ICE : un seul propriétaire, et il ne diffuse pas                       */
/* ========================================================================== */

describe('T16d / SPEC-009 §3 — T3 : l’ICE entrant va au bon pair, le sortant aussi (et à lui seul)', () => {
  // Titre remis sur le contrat (AD-18 / D9) : depuis AD-16 / T17 le candidat local SORT, une
  // fois. L'ancien titre disait « JAMAIS diffusé (0 émission) » alors que le corps exige 1
  // émission — un titre faux se lit comme une garantie et vaut un test qui ne teste rien.
  it('candidat entrant routé au pair nommé, candidat local émis UNE fois vers son seul pair', async () => {
    const dom = freshDom();
    const h = harness(dom);
    await h.wire.start();

    // Deux pairs nous offrent une session : nous sommes le répondeur, donc la description
    // distante existe et un candidat entrant a un destinataire mesurable.
    const offer = { type: 'offer', sdp: OFFER_SDP };
    h.deliver({ kind: 'offer', from: 'A', payload: offer });
    h.deliver({ kind: 'offer', from: 'B', payload: offer });
    await flush();
    assert.equal(dom.peers.length, 2, 'une connexion par pair');
    assert.deepEqual(h.sent.map((message) => message.kind), ['answer', 'answer'], 'deux réponses, aucun ICE');

    const ice: SignalIn = {
      kind: 'ice',
      from: 'A',
      payload: { candidate: CANDIDATE_HOST_RFC1918, sdpMid: '0', sdpMLineIndex: 0 },
    };
    h.deliver(ice);
    await flush();

    const toA = dom.peers[0];
    const toB = dom.peers[1];
    assert.ok(toA !== undefined && toB !== undefined);
    assert.equal(toA.addedCandidates.length, 1, 'le candidat de A entre dans la connexion de A');
    assert.equal(toB.addedCandidates.length, 0, 'et dans AUCUNE autre : pas de diffusion');
    assert.equal(h.sent.filter((message) => message.kind === 'ice').length, 0, 'aucun candidat ne sort');

    // Un candidat LOCAL collecté par le plan média : depuis T17 (AD-16) il SORT, adressé au
    // pair émetteur et à lui seul. C'était DÉFAUT-D : l'ancien chemin diffusait à tous, le
    // chemin intermédiaire n'envoyait plus rien (0 émis, mesuré par VERIF-020 §3).
    dom.fireIceCandidate(toA, CANDIDATE_HOST_RFC1918);
    await flush();
    const out = h.sent.filter(
      (message): message is { kind: SignalKind; to: string; payload: unknown } =>
        message.kind === 'ice',
    );
    assert.equal(out.length, 1, 'le candidat local sort maintenant — une fois, et une seule');
    assert.equal(out[0]?.to, 'A', 'adressé au pair émetteur du candidat, jamais à B');
    assert.deepEqual(
      out[0]?.payload,
      { candidate: CANDIDATE_HOST_RFC1918, sdpMid: '0', sdpMLineIndex: 0 },
      'la charge utile est le candidat ramassé, tel quel',
    );

    // Garde statique : le chemin diffusant ne doit pas revenir par une porte dérobée, et le
    // branchement doit rester dans le câblage (un seul émetteur, celui du maillage).
    // On cherche un USAGE (déclaration ou propriété d'options), pas le mot cité en commentaire.
    const voice = readFileSync(new URL('../src/renderer/voice.ts', import.meta.url), 'utf8');
    const wiring = readFileSync(new URL('../src/renderer/voice-mesh.ts', import.meta.url), 'utf8');
    assert.equal(/sendCandidate\s*\(/.test(voice), false, 'aucun sendCandidate actif dans le renderer');
    assert.equal(/function\s+sendCandidate/.test(voice), false);
    assert.equal(/onLocalCandidate\s*:/.test(voice), false, 'voice.ts ne construit pas le plan : le câblage s’en charge');
    assert.equal(/onLocalCandidate\s*:/.test(wiring), true, 'le câblage branche onLocalCandidate (T17)');
    assert.equal(
      /current\.onLocalCandidate\(peerId, candidate\)/.test(wiring),
      true,
      'et le passe au maillage avec le pair émetteur, jamais directement à `send`',
    );
  });
});

/* ========================================================================== */
/* T4 — fermeture : le mesh AVANT le plan                                      */
/* ========================================================================== */

describe('T16d / SPEC-009 §3 — T4 : closeVoice ferme mesh puis plan', () => {
  it('mesh.close() avant plane.close(), une seule fois, et les PC sont réellement fermées', async () => {
    const dom = freshDom();
    const h = harness(dom);
    await h.wire.start();
    h.deliver(join('b'));
    await flush();

    const peer = dom.peerAt(0);
    assert.equal(peer.closed, false, 'la connexion vit avant la fermeture');

    h.wire.close();

    const meshIndex = h.diagnostics.findIndex((line) => line.startsWith('fermeture:mesh'));
    const planeIndex = h.diagnostics.findIndex((line) => line.startsWith('fermeture:plan'));
    assert.ok(meshIndex >= 0, 'le mesh est fermé');
    assert.ok(planeIndex >= 0, 'le plan est fermé');
    assert.ok(
      meshIndex < planeIndex,
      `le mesh doit tomber avant le plan : ${h.diagnostics.join(' | ')}`,
    );
    assert.equal(peer.closed, true, 'la RTCPeerConnection est réellement fermée (effet, pas narration)');
    assert.equal(h.wire.meshAlive, false);

    // Idempotence : un second close() ne rouvre rien et ne referme rien deux fois.
    const before = h.diagnostics.length;
    h.wire.close();
    assert.equal(h.diagnostics.length, before, 'second close() = aucun geste supplémentaire');
    assert.equal(
      h.diagnostics.filter((line) => line.startsWith('fermeture:mesh')).length,
      1,
      'mesh.close() appelé exactement une fois',
    );

    // Garde de source — trou MESURÉ (falsification M4) : sauter `current.close()` et laisser
    // `plane.close()` fermer les PC derrière le dos du mesh survivait à tout ce qui précède,
    // parce que le faux `RTCPeerConnection` n'émet pas `connectionstatechange` en se fermant.
    // En Chromium réel c'est pourtant la différence entre un mesh mort et un mesh orphelin :
    // les liens resteraient dans `links`, et leur état « closed » sortirait après la fermeture
    // en `onPeerState('failed')` — « connexion perdue » affiché après un départ volontaire.
    const source = readFileSync(new URL('../src/renderer/voice-mesh.ts', import.meta.url), 'utf8');
    const meshTrace = source.indexOf("trace('fermeture:mesh')");
    assert.ok(meshTrace >= 0, 'close() trace la fermeture du mesh');
    const meshCloseAt = source.indexOf('current.close()', meshTrace);
    const planeCloseAt = source.indexOf('plane.close()', meshTrace);
    assert.ok(meshCloseAt > meshTrace, 'close() appelle current.close() (le mesh se ferme lui-même)');
    assert.ok(
      planeCloseAt > meshCloseAt,
      'current.close() précède plane.close() dans le texte de close()',
    );
  });
});

/* ========================================================================== */
/* T5 — reconnexion : le mesh ne survit pas, et il en naît UN seul             */
/* ========================================================================== */

describe('T16d / SPEC-009 §3 — T5 : retrying tue le mesh, joined en recrée un seul', () => {
  it('retrying : 0 PC vivante ; re-joined : une seule PC vivante, un seul mesh', async () => {
    const dom = freshDom();
    const first = harness(dom);
    await first.wire.start();
    first.deliver(join('b'));
    await flush();
    assert.equal(dom.peers.filter((peer) => !peer.closed).length, 1);

    // `voice.ts` → `suspendVoice()` fait exactement ceci au passage en `retrying`.
    first.wire.close();

    assert.equal(first.wire.meshAlive, false, 'le mesh ne survit pas à la reconnexion');
    assert.equal(
      dom.peers.filter((peer) => !peer.closed).length,
      0,
      'plus aucune RTCPeerConnection ouverte',
    );
    assert.equal(
      first.diagnostics.filter((line) => line.startsWith('fermeture:mesh')).length,
      1,
      'mesh.close() une seule fois sur la reconnexion',
    );

    // Retour en `joined` : `voice.ts` reconstruit la session (nouveau plan, nouveau micro, mesh).
    const second = harness(dom);
    await second.wire.start();
    second.deliver(join('b'));
    await flush();

    assert.equal(
      dom.peers.filter((peer) => !peer.closed).length,
      1,
      'un seul mesh vivant au retour : pas de maillage fantôme',
    );
    assert.deepEqual(offers(second.steps), ['offer:b'], 'une seule offre sur la nouvelle session');
    assert.equal(second.gumCalls, 1, 'le micro est rouvert une fois');

    // `joined` reçu DEUX fois sur la même connexion vivante : `openVoice` ne fait rien, et
    // `start()` non plus — au plus un mesh par salon (SPEC-009 §1(d)/(e)).
    assert.equal(await second.wire.start(), true, 'second start() = no-op qui rend la main');
    assert.equal(
      second.diagnostics.filter((line) => line.startsWith('mesh:ouvert')).length,
      1,
      'un seul createMesh pour une session',
    );
    assert.equal(dom.peers.filter((peer) => !peer.closed).length, 1);

    // Garde de câblage : le hook `useVoicePlane` n'est pas montable hors React, donc la phrase
    // « retrying tue le mesh, connected en recrée un » est épinglée sur la source. Sans elle,
    // T5 resterait vert sur la couture pendant que l'application ne fermerait plus rien à la
    // reconnexion — c'est précisément l'arbitrage que SPEC-009 §1(e) demande de ne pas rouvrir.
    const voiceSource = readFileSync(new URL('../src/renderer/voice.ts', import.meta.url), 'utf8');
    assert.match(
      voiceSource,
      /if \(phase === 'retrying' \|\| phase === 'failed'\) \{\s*suspendVoice\(\);/,
      'voice.ts : retrying/failed → suspendVoice()',
    );
    assert.match(
      voiceSource,
      /if \(phase === 'connected'\) openVoice\(/,
      'voice.ts : connected → openVoice() (un seul mesh reconstruit)',
    );
  });
});

/* ========================================================================== */
/* T6 — candidats précoces : purgés, jamais rejoués, comptés                   */
/* ========================================================================== */

describe('T16d / SPEC-009 §3 — T6 : seize candidats sans destinataire', () => {
  it('16 purgés, 0 rejoué, 0 diffusé, une seule ligne de diagnostic avec le compte', async () => {
    const early = Array.from({ length: 16 }, (_, index) => ({
      candidate: `candidate:${index + 1} 1 udp 2122260223 192.168.1.${index + 10} 54321 typ host`,
      sdpMid: '0',
      sdpMLineIndex: 0,
    }));

    const dom = freshDom();
    const h = harness(dom, { earlyCandidates: early });
    await h.wire.start();

    const purgeLines = h.diagnostics.filter((line) => line.includes('purged:'));
    assert.equal(purgeLines.length, 1, 'une seule ligne de diagnostic pour la purge');
    assert.ok(
      purgeLines[0]?.includes('purged: 16'),
      `le compte doit être écrit : ${String(purgeLines[0])}`,
    );
    // `length` plutôt que `deepEqual(…, [])` : ce dernier rétrécit le type du tableau à `never[]`
    // et casse la lecture suivante (défaut TS déjà rencontré en VERIF-018).
    assert.equal(h.sent.length, 0, 'aucun candidat n’est rejoué ni diffusé à l’ouverture');

    // Même quand un pair arrive, les candidats purgés ne sont PAS rejoués sur lui.
    h.deliver(join('b'));
    await flush();
    assert.deepEqual(offers(h.steps), ['offer:b']);
    assert.equal(dom.peerAt(0).addedCandidates.length, 0, 'aucun candidat précoce offert au premier venu');
    assert.equal(h.sent.filter((message) => message.kind === 'ice').length, 0, 'zéro diffusion');
  });
});

/* ========================================================================== */
/* T7 — la coquille consomme les candidats et n'émet aucun signal elle-même    */
/* ========================================================================== */

describe('T17 / AD-16 — T7 : un seul émetteur dans la coquille, et c’est le maillage', () => {
  const renderer = new URL('../src/renderer/', import.meta.url);
  const sources = readdirSync(renderer)
    .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
    .map((name) => ({ name, text: readFileSync(new URL(name, renderer), 'utf8') }));

  it('aucun canal IPC en dur : `lan:signal` = 0 occurrence dans src/renderer', () => {
    const hits = sources.filter((source) => source.text.includes('lan:signal')).map((s) => s.name);
    assert.equal(hits.length, 0, `canal nommé dans le renderer : ${hits.join(', ')}`);
  });

  it('aucun message de signalisation fabriqué : `kind: \'ice\'` = 0 dans src/renderer', () => {
    const hits = sources.filter((source) => source.text.includes("kind: 'ice'")).map((s) => s.name);
    assert.equal(hits.length, 0, `le renderer construit un signal ICE : ${hits.join(', ')}`);
  });

  it('aucun `addCandidate` appelé par la coquille : le maillage décide seul du routage', () => {
    const hits = sources.filter((source) => source.text.includes('addCandidate')).map((s) => s.name);
    assert.equal(hits.length, 0, `appel direct au maillage : ${hits.join(', ')}`);
  });

  it('DÉFAUT-C reste fermé-en-source : `<audio` = 5 occurrences mesurées dans src/renderer', () => {
    const total = sources.reduce(
      (count, source) => count + source.text.split('<audio').length - 1,
      0,
    );
    assert.equal(total, 5, 'un <audio> par pair distant : 3 dans voice.ts, 2 dans audio-sink.ts');
  });

  it('une seule porte de sortie : `options.send(` une fois dans le câblage', () => {
    const wiring = sources.find((source) => source.name === 'voice-mesh.ts');
    assert.ok(wiring !== undefined);
    const doors = wiring.text.split('options.send(').length - 1;
    assert.equal(doors, 1, 'le câblage relaie, il ne choisit pas de pair');
  });
});
