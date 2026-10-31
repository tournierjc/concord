/**
 * tests/signaling-link.node.test.ts — T16b : le TUYAU de signalisation (SPEC-007 §4.3).
 *
 * Ce fichier n'utilise AUCUNE doublure de socket pour les échanges : deux nœuds réels parlent sur
 * de vraies sockets TCP loopback (`node:net`). Les cas d'erreur (ligne trop longue, JSON invalide)
 * sont eux aussi joués sur une vraie socket, côté client brut, pour vérifier le cadrage tel qu'il
 * est — pas tel qu'on l'imagine.
 *
 * Lancer : cd /work/lan-voice && npx tsx --test tests/signaling-link.node.test.ts
 */

import assert from 'node:assert/strict';
import { connect, type Socket } from 'node:net';
import { test } from 'node:test';

import {
  createSignalingLink,
  decodeCandidatePayload,
  fromWire,
  pickListenHost,
  toWire,
  type SignalingLink,
} from '../src/main/signaling-link.ts';
import type { SignalIn } from '../src/shell/ipc-contract.ts';

/* ------------------------------------------------------------------ */
/* Utilitaires                                                         */
/* ------------------------------------------------------------------ */

/** Ports de test hors de la plage de production (47821-47830), pour ne pas la squatter. */
function testBasePort(): number {
  return 51000 + Math.floor(Math.random() * 6000);
}

async function eventually(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition jamais atteinte');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function makeLink(
  options: {
    role: 'host' | 'client';
    host: string;
    port?: number;
    name?: string;
    maxPeers?: number;
  },
  onMessage: (message: SignalIn) => void,
): SignalingLink {
  return createSignalingLink({
    role: options.role,
    localId: 'local-test',
    name: options.name ?? 'Banc',
    host: options.host,
    ...(options.port === undefined ? {} : { port: options.port }),
    ...(options.maxPeers === undefined ? {} : { maxPeers: options.maxPeers }),
    now: () => Date.now(),
    onMessage,
  });
}

/** Ouvre un socket brut : c'est le client « méchant » des tests de cadrage. */
function rawConnect(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

function readAll(socket: Socket): { lines: string[]; ended: Promise<void> } {
  const lines: string[] = [];
  let buffer = '';
  const ended = new Promise<void>((resolve) => {
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let index = buffer.indexOf('\n');
      while (index !== -1) {
        lines.push(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf('\n');
      }
    });
    socket.on('close', () => resolve());
    socket.on('error', () => resolve());
  });
  return { lines, ended };
}

/* ------------------------------------------------------------------ */
/* 1-2. Deux nœuds réels : join / offer / answer / ice / leave         */
/* ------------------------------------------------------------------ */

test('deux nœuds sur sockets TCP loopback échangent join, offer, answer et ice', async () => {
  const base = testBasePort();
  const hostMessages: SignalIn[] = [];
  const clientMessages: SignalIn[] = [];

  const host = makeLink({ role: 'host', host: '127.0.0.1', port: base, name: 'Hôte' }, (m) =>
    hostMessages.push(m),
  );
  await eventually(() => host.listen !== null);
  await eventually(() => hostMessages.some((m) => m.kind === 'link' && m.state === 'connected'));

  const port = host.listen?.port ?? 0;
  assert.ok(port > 0, 'le port d’écoute doit être connu');

  const client = makeLink({ role: 'client', host: '127.0.0.1', port, name: 'Invité' }, (m) =>
    clientMessages.push(m),
  );

  // join : l'hôte voit arriver le nouveau pair, le client reçoit son identité.
  await eventually(() =>
    hostMessages.some((m) => m.kind === 'peer-joined' && m.name === 'Invité'),
  );
  await eventually(() => clientMessages.some((m) => m.kind === 'link' && m.state === 'connected'));
  const hostId = host.selfId;
  const clientId = client.selfId;
  assert.ok(hostId !== null && clientId !== null, 'les deux nœuds doivent connaître leur identité');

  // offer : client → hôte, SDP intact.
  client.send({ kind: 'offer', to: String(hostId), payload: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n' });
  await eventually(() => hostMessages.some((m) => m.kind === 'offer'));
  const offer = hostMessages.find((m) => m.kind === 'offer');
  assert.equal(offer?.kind, 'offer');
  if (offer?.kind === 'offer') {
    assert.equal(offer.from, clientId);
    assert.equal(offer.payload, 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n');
  }

  // answer : hôte → client.
  host.send({
    kind: 'answer',
    to: String(clientId),
    payload: 'v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\n',
  });
  await eventually(() => clientMessages.some((m) => m.kind === 'answer'));
  const answer = clientMessages.find((m) => m.kind === 'answer');
  assert.equal(answer?.kind, 'answer');
  if (answer?.kind === 'answer') assert.equal(answer.from, hostId);

  // ice : candidat hôte LAN, relayé tel quel.
  const candidate = 'candidate:1 1 UDP 2122260223 192.168.1.20 54321 typ host';
  client.send({ kind: 'ice', to: String(hostId), payload: candidate });
  await eventually(() => hostMessages.some((m) => m.kind === 'ice'));
  const ice = hostMessages.find((m) => m.kind === 'ice');
  assert.equal(ice?.kind, 'ice');
  if (ice?.kind === 'ice') assert.equal(ice.payload, candidate);

  // leave : l'hôte voit le départ.
  client.send({ kind: 'leave' });
  await eventually(() => hostMessages.some((m) => m.kind === 'peer-left' && m.peerId === clientId));

  client.close('fin de test');
  host.close('fin de test');
});

test('un candidat ICE hors LAN n’est jamais relayé (filtre à l’émission)', async () => {
  const base = testBasePort();
  const hostMessages: SignalIn[] = [];
  const host = makeLink({ role: 'host', host: '127.0.0.1', port: base }, (m) => hostMessages.push(m));
  await eventually(() => host.listen !== null && host.selfId !== null);
  await eventually(() => hostMessages.some((m) => m.kind === 'link' && m.state === 'connected'));

  const client = makeLink(
    { role: 'client', host: '127.0.0.1', port: host.listen?.port ?? 0 },
    () => undefined,
  );
  await eventually(() => client.selfId !== null);
  await eventually(() => hostMessages.some((m) => m.kind === 'peer-joined'));

  const before = hostMessages.filter((m) => m.kind === 'ice').length;
  client.send({
    kind: 'ice',
    to: String(host.selfId),
    payload: 'candidate:2 1 UDP 1686052607 203.0.113.9 54321 typ srflx raddr 0.0.0.0 rport 0',
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(hostMessages.filter((m) => m.kind === 'ice').length, before);
  assert.ok(client.stats.filteredCandidates >= 1, 'le filtre doit être compté');

  client.close('fin');
  host.close('fin');
});

test('un pair au-delà du plafond est refusé explicitement (salon plein)', async () => {
  const base = testBasePort();
  const host = makeLink({ role: 'host', host: '127.0.0.1', port: base, maxPeers: 2 }, () => undefined);
  await eventually(() => host.listen !== null && host.selfId !== null);

  const first = makeLink(
    { role: 'client', host: '127.0.0.1', port: host.listen?.port ?? 0 },
    () => undefined,
  );
  await eventually(() => first.selfId !== null);

  const secondMessages: SignalIn[] = [];
  const second = makeLink(
    { role: 'client', host: '127.0.0.1', port: host.listen?.port ?? 0 },
    (m) => secondMessages.push(m),
  );
  await eventually(() => secondMessages.some((m) => m.kind === 'link' && m.state === 'refused'));
  const refusal = secondMessages.find((m) => m.kind === 'link' && m.state === 'refused');
  assert.equal(refusal?.kind, 'link');
  if (refusal?.kind === 'link') {
    assert.match(String(refusal.detail), /room-full|plein/i);
  }

  first.close('fin');
  second.close('fin');
  host.close('fin');
});

/* ------------------------------------------------------------------ */
/* 3-4. Bornes : adresse large refusée, ligne trop longue, JSON faux   */
/* ------------------------------------------------------------------ */

test('0.0.0.0 est refusé AVANT toute écoute : aucun port n’est ouvert', () => {
  const messages: SignalIn[] = [];
  const link = makeLink({ role: 'host', host: '0.0.0.0' }, (m) => messages.push(m));
  assert.equal(link.listen, null, 'aucune socket ne doit être liée');
  const refusal = messages.find((m) => m.kind === 'link' && m.state === 'refused');
  assert.ok(refusal !== undefined, 'un refus explicite doit être émis');
  if (refusal?.kind === 'link') assert.match(String(refusal.detail), /0\.0\.0\.0/);
  link.close('fin');
});

test('« :: » et une adresse publique sont refusés de la même façon', () => {
  for (const host of ['::', '203.0.113.9']) {
    const messages: SignalIn[] = [];
    const link = makeLink({ role: 'host', host }, (m) => messages.push(m));
    assert.equal(link.listen, null);
    assert.ok(
      messages.some((m) => m.kind === 'link' && m.state === 'refused'),
      `refus attendu pour ${host}`,
    );
    link.close('fin');
  }
});

test('une ligne de plus de 64 Ko ferme la connexion avec un refus explicite', async () => {
  const base = testBasePort();
  const host = makeLink({ role: 'host', host: '127.0.0.1', port: base }, () => undefined);
  await eventually(() => host.listen !== null && host.selfId !== null);

  const socket = await rawConnect(host.listen?.port ?? 0);
  const { lines, ended } = readAll(socket);
  socket.write('x'.repeat(70 * 1024));
  await ended;
  assert.ok(lines.length >= 1, 'au moins une ligne de refus doit être écrite');
  const refusal = JSON.parse(lines[0] ?? '{}') as { type?: string; reason?: string };
  assert.equal(refusal.type, 'refuse');
  assert.match(String(refusal.reason), /64 Ko/);
  assert.equal(host.stats.oversize, 1);
  host.close('fin');
});

test('un JSON invalide est refusé, la connexion fermée, le serveur survit', async () => {
  const base = testBasePort();
  const host = makeLink({ role: 'host', host: '127.0.0.1', port: base }, () => undefined);
  await eventually(() => host.listen !== null && host.selfId !== null);

  const bad = await rawConnect(host.listen?.port ?? 0);
  const badReader = readAll(bad);
  bad.write('{"type":"join"\n'); // objet non fermé : JSON invalide
  await badReader.ended;
  const refusal = JSON.parse(badReader.lines[0] ?? '{}') as { type?: string; reason?: string };
  assert.equal(refusal.type, 'refuse');
  assert.match(String(refusal.reason), /JSON invalide/);
  assert.equal(host.stats.malformed, 1);

  // Le serveur est toujours vivant : un vrai client joint encore.
  const good = makeLink(
    { role: 'client', host: '127.0.0.1', port: host.listen?.port ?? 0 },
    () => undefined,
  );
  await eventually(() => good.selfId !== null);
  assert.ok(good.selfId !== null);
  good.close('fin');
  host.close('fin');
});

/* ------------------------------------------------------------------ */
/* 5. Fonctions pures : encodage, filtre, choix d'adresse              */
/* ------------------------------------------------------------------ */

test('toWire refuse tout candidat hors LAN et laisse passer un hôte LAN', () => {
  assert.equal(
    toWire({ kind: 'ice', to: 'p1', payload: 'candidate:1 1 UDP 2122260223 10.0.0.5 5000 typ host' })
      ?.type,
    'ice',
  );
  assert.equal(
    toWire({ kind: 'ice', to: 'p1', payload: 'candidate:2 1 UDP 1 198.51.100.7 5000 typ srflx' }),
    null,
  );
  assert.equal(toWire({ kind: 'ice', to: 'p1', payload: 'n’importe quoi' }), null);
  assert.deepEqual(toWire({ kind: 'leave' }), { type: 'leave' });
  assert.equal(toWire({ kind: 'offer', to: 'p1', payload: 42 }), null);
});

test('fromWire filtre aussi à l’entrée et préserve un candidat JSON', () => {
  assert.equal(
    fromWire({ type: 'ice', from: 'p1', to: 'p2', candidate: 'candidate:1 1 UDP 1 203.0.113.9 1 typ srflx' }),
    null,
  );
  const payload = { candidate: 'candidate:1 1 UDP 1 192.168.0.9 4000 typ host', sdpMid: 'audio' };
  const decoded = fromWire({ type: 'ice', from: 'p1', to: 'p2', candidate: JSON.stringify(payload) });
  assert.deepEqual(decoded, { kind: 'ice', from: 'p1', payload });
  assert.equal(
    decodeCandidatePayload('candidate:1 1 UDP 1 192.168.0.9 4000 typ host'),
    'candidate:1 1 UDP 1 192.168.0.9 4000 typ host',
  );
  assert.equal(fromWire({ type: 'hello', peerId: 'p1', name: 'Ada', maxParticipants: 8, peers: [] }), null);
});

test('pickListenHost ne rend jamais une adresse large', () => {
  assert.equal(
    pickListenHost({
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      eth0: [{ address: '192.168.1.42', family: 'IPv4', internal: false }],
    }),
    '192.168.1.42',
  );
  assert.equal(
    pickListenHost({
      eth0: [
        { address: '0.0.0.0', family: 'IPv4', internal: false },
        { address: '169.254.3.3', family: 'IPv4', internal: false },
        { address: '203.0.113.9', family: 'IPv4', internal: false },
      ],
    }),
    '127.0.0.1',
  );
  assert.equal(pickListenHost({ eth0: [{ address: '::', family: 'IPv6', internal: false }] }), '127.0.0.1');
});

test('la plage de ports de production reste 47821-47830 (repli de 10)', async () => {
  const link = makeLink({ role: 'host', host: '127.0.0.1' }, () => undefined);
  try {
    await eventually(() => link.listen !== null, 5000);
    const port = link.listen?.port ?? 0;
    assert.ok(port >= 47821 && port <= 47830, `port hors plage : ${port}`);
  } finally {
    link.close('fin');
  }
});

test('close() est idempotent et n’émet qu’un seul état « closed »', async () => {
  const messages: SignalIn[] = [];
  const link = makeLink({ role: 'host', host: '127.0.0.1', port: testBasePort() }, (m) =>
    messages.push(m),
  );
  await eventually(() => link.listen !== null);
  link.close('test');
  link.close('test');
  assert.equal(messages.filter((m) => m.kind === 'link' && m.state === 'closed').length, 1);
});
