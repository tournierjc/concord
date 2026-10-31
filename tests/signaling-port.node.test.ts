/**
 * tests/signaling-port.node.test.ts — le port de signalisation est une MESURE, pas un réglage.
 *
 * LE DÉFAUT : l'onglet Réseau affichait `settings.network.signalingPort`, la valeur demandée dans le
 * fichier de réglages. Le moteur ne la lit pas — et ne le peut pas : SPEC-001 **A5** dit que le port
 * part de 47821 et **incrémente jusqu'à 47830 si le port est pris**, puis que « le port réel est
 * publié dans le beacon mDNS ». SPEC-002 **D1** en tire la règle : « l'interface n'affiche jamais un
 * port qu'elle n'a pas lu du beacon », et **S3.15** prévoit `settings.network.portBumped` quand le
 * port n'est plus celui par défaut. L'UI montrait donc un chiffre que personne n'utilisait, et la clé
 * `portBumped` — prévue par la spec — n'était affichée nulle part.
 *
 * Ce fichier fige :
 *   1. la mesure `effectiveSignalingPort` (pure) : écoute > annonce > rien ;
 *   2. le contrat `RoomStateDto.signalingPort` : nombre ou `null`, borné, refusé sinon ;
 *   3. les gardes de source : le main publie la mesure, l'UI ne lit plus les réglages pour ça, et le
 *      panneau affiche `portBumped` quand le port a été incrémenté.
 *
 * Lancer : cd /work/lan-voice && npx tsx --test tests/signaling-port.node.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { IPC, guardPayload } from '../src/shell/ipc-contract.ts';
import { SIGNALING_PORT_DEFAULT } from '../src/shell/settings-schema.ts';
import { effectiveSignalingPort } from '../src/main/signaling-port.ts';

/**
 * Les gardes de source regardent le CODE, pas les commentaires : le mot `settings.network.signalingPort`
 * apparaît légitimement dans un commentaire qui explique qu'il ne faut PAS s'en servir. Sans ce
 * nettoyage, la garde serait un piège à rédaction (elle a déjà échoué ainsi).
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const INDEX_SOURCE = code(readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8'));
const SETTINGS_SOURCE = code(
  readFileSync(new URL('../src/renderer/Settings.tsx', import.meta.url), 'utf8'),
);
const APP_SOURCE = code(readFileSync(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8'));

const ROOM = { roomId: 'salon-a', port: 47823 };

/* ------------------------------------------------------------------ */
/* 1. La mesure                                                        */
/* ------------------------------------------------------------------ */

test('hôte : le port publié est celui de la socket écoutée', () => {
  assert.equal(
    effectiveSignalingPort({ listen: { host: '192.168.1.20', port: 47821 }, roomId: 'salon-a', rooms: [] }),
    47821,
  );
});

test('hôte : un port INCRÉMENTÉ (47821 pris → 47822) est publié tel quel', () => {
  // C'est exactement le cas S3.15 : le port effectif n'est pas le port par défaut.
  const port = effectiveSignalingPort({
    listen: { host: '192.168.1.20', port: 47822 },
    roomId: 'salon-a',
    rooms: [ROOM],
  });
  assert.equal(port, 47822);
  assert.notEqual(port, SIGNALING_PORT_DEFAULT);
});

test('hôte : l’écoute l’emporte sur une annonce qui traînerait', () => {
  // Le beacon d'un autre poste ne doit jamais écraser ce que NOTRE socket écoute.
  assert.equal(
    effectiveSignalingPort({
      listen: { host: '127.0.0.1', port: 47830 },
      roomId: 'salon-a',
      rooms: [{ roomId: 'salon-a', port: 47821 }],
    }),
    47830,
  );
});

test('client : le port est celui LU dans l’annonce de l’hôte', () => {
  assert.equal(effectiveSignalingPort({ listen: null, roomId: 'salon-a', rooms: [ROOM] }), 47823);
});

test('client : une annonce d’un AUTRE salon ne compte pas', () => {
  assert.equal(
    effectiveSignalingPort({ listen: null, roomId: 'salon-a', rooms: [{ roomId: 'salon-b', port: 47829 }] }),
    null,
  );
});

test('hors salon : aucun chiffre (l’UI dira « aucun » plutôt que d’inventer)', () => {
  assert.equal(effectiveSignalingPort({ listen: null, roomId: null, rooms: [ROOM] }), null);
  assert.equal(effectiveSignalingPort({ listen: null, roomId: 'salon-a', rooms: [] }), null);
});

/* ------------------------------------------------------------------ */
/* 2. Le contrat                                                       */
/* ------------------------------------------------------------------ */

function roomState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    roomId: 'salon-a',
    roomName: 'Salon A',
    phase: 'connected',
    participantCount: 1,
    selfId: 'self',
    signalingPort: 47821,
    notice: null,
    ...overrides,
  };
}

test('le canon accepte un port effectif, et accepte aussi `null`', () => {
  const withPort = guardPayload('event', IPC.eventRoomState, roomState());
  assert.equal(withPort.ok, true, JSON.stringify(withPort));
  const withoutPort = guardPayload('event', IPC.eventRoomState, roomState({ signalingPort: null }));
  assert.equal(withoutPort.ok, true, JSON.stringify(withoutPort));
  const effective = guardPayload('event', IPC.eventRoomState, roomState({ signalingPort: 47822 }));
  assert.equal(effective.ok, true, JSON.stringify(effective));
});

test('le canon refuse un port qui n’en est pas un (texte, hors bornes, absent)', () => {
  assert.equal(guardPayload('event', IPC.eventRoomState, roomState({ signalingPort: '47821' })).ok, false);
  assert.equal(guardPayload('event', IPC.eventRoomState, roomState({ signalingPort: 0 })).ok, false);
  assert.equal(guardPayload('event', IPC.eventRoomState, roomState({ signalingPort: 70000 })).ok, false);
  assert.equal(
    guardPayload('event', IPC.eventRoomState, roomState({ signalingPort: 47821.5 })).ok,
    false,
    'un port est un entier',
  );
  const missing = roomState();
  delete missing['signalingPort'];
  assert.equal(guardPayload('event', IPC.eventRoomState, missing).ok, false, 'champ absent refusé');
});

/* ------------------------------------------------------------------ */
/* 3. Le câblage                                                       */
/* ------------------------------------------------------------------ */

test('le main publie la mesure : écoute + annonces lues, jamais les réglages', () => {
  const fn = INDEX_SOURCE.slice(INDEX_SOURCE.indexOf('function currentSignalingPort'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /effectiveSignalingPort\(/);
  assert.match(body, /signalingLink\?\.listen \?\? null/);
  assert.match(body, /roomId: bridge\.getRoomState\(\)\.roomId/);
  assert.match(body, /rooms: discovery\.list\(\)/);
  assert.doesNotMatch(body, /settings\./, 'les réglages ne doivent pas décider du port affiché');
});

test('l’état de salon part enrichi du port effectif (et les autres événements restent intacts)', () => {
  const fn = INDEX_SOURCE.slice(INDEX_SOURCE.indexOf('function forwardBridgeEvent'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /event\.channel === IPC\.eventRoomState/);
  assert.match(body, /signalingPort: currentSignalingPort\(\)/);
  assert.match(body, /sendEvent\(event\.channel, event\.payload\)/, 'les autres canaux ne sont pas touchés');
});

test('le pont de salon ne prétend pas connaître le port (RoomStateCore)', () => {
  const bridge = readFileSync(new URL('../src/main/room-bridge.ts', import.meta.url), 'utf8');
  assert.match(bridge, /getRoomState\(\): RoomStateCore/);
  assert.doesNotMatch(bridge, /signalingPort/, 'le pont n’a aucune raison d’en parler');
});

test('le panneau affiche le port MESURÉ, la ligne incrémentée de S3.15, et l’identité éphémère', () => {
  assert.match(SETTINGS_SOURCE, /session\.signalingPort === null/, 'port lu de la session');
  assert.match(SETTINGS_SOURCE, /settings\.network\.portBumped/, 'clé prévue par SPEC-002 S3.15');
  assert.match(SETTINGS_SOURCE, /session\.signalingPort !== SIGNALING_PORT_DEFAULT/);
  assert.match(SETTINGS_SOURCE, /session\.selfId/, 'identité de session = identifiant éphémère');
  assert.match(SETTINGS_SOURCE, /settings\.network\.identityHelp/);
  // Le défaut : la valeur affichée venait des réglages, et la ligne d'identité mélangeait des constantes.
  assert.doesNotMatch(SETTINGS_SOURCE, /settings\.network\.signalingPort/);
  assert.doesNotMatch(SETTINGS_SOURCE, /MAX_ROOM_PARTICIPANTS/);
});

test('l’application passe l’état de salon au panneau (source unique du port et de l’identité)', () => {
  assert.match(APP_SOURCE, /session=\{room\}/);
  assert.match(APP_SOURCE, /signalingPort: null/, 'EMPTY_ROOM déclare l’absence de mesure');
});
