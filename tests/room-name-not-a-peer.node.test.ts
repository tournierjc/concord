/**
 * tests/room-name-not-a-peer.node.test.ts — le nom du salon ne nomme jamais un pair (2026-11-02).
 *
 * Capture JC (0.4.7, salon « gf », 2/8 participants) : sous la liste des participants de
 * signalisation (qui portent leurs vrais pseudos), la table des pairs média affiche une ligne
 * « gf » — le NOM DU SALON — au lieu du pseudo du pair (krillin). La règle verrouillée ici :
 * le nom d'un pair média vient EXCLUSIVEMENT du message `peer-joined` (transport `name`) ;
 * aucun chemin du main ne puise le nom du salon (`roomName`, `state.roomName`) pour baptiser
 * un pair. C'est ce que vérifient les gardes structurelles ci-dessous : `room-bridge.ts` ne
 * connaît que `selfName`, et l'unique source de `name` pour un pair est le fil de signalisation.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const ROOM_BRIDGE = readFileSync(new URL('../src/main/room-bridge.ts', import.meta.url), 'utf8');
const SIGNALING = readFileSync(new URL('../src/main/signaling-link.ts', import.meta.url), 'utf8');
const VOICE = readFileSync(new URL('../src/renderer/voice.ts', import.meta.url), 'utf8');

describe('garde structurelle — le nom du salon ne peut pas devenir un nom de pair', () => {
  it('room-bridge : les participants sont nommés par `selfName` (réglages), jamais par le nom du salon', () => {
    // Dans le bloc `join`, le nom du participant local vient de `selfName` ; `roomName` n'est
    // stocké QUE pour la tête du salon (`roomName` du DTO d'état), jamais comme nom de pair.
    assert.match(ROOM_BRIDGE, /name: selfName,/);
    assert.doesNotMatch(ROOM_BRIDGE, /name:\s*(this\.)?roomName/,
      'le nom du salon ne saurait alimenter un champ `name` de participant');
  });

  it('signaling : le `name` d’un pair vient du fil (message.peer.name), pas du salon', () => {
    // Les deux émissions de `peer-joined` tirent `name` du message reçu — aucune lecture de
    // l'état du salon (`roomName`) sur le chemin du nommage des pairs.
    assert.match(SIGNALING, /kind: 'peer-joined',[\s\S]{0,120}name: message\.peer\.name/);
    assert.match(SIGNALING, /kind: 'peer-joined',[\s\S]{0,120}name: peer\.name/);
    assert.doesNotMatch(SIGNALING, /roomName/,
      'le main de la signalisation ne lit jamais le nom du salon — il ne peut pas le prêter à un pair');
  });

  it('voice : l’unique source du nom d’un pair est `peer-joined.message.name`', () => {
    // `upsertPeer` re\u00e7oit `name` du message ; `handleSignal` ne l'invente pas. La fen\u00eatre est
    // \u00e9largie (1200) depuis la garde pair-boucle ajout\u00e9e dans le m\u00eame cas en 2026-11-02.
    assert.match(VOICE, /case 'peer-joined':[\s\S]{0,1200}name: message\.name/);
    // La table des pairs média n'a pas d'autre affectation de `name` que celui du message
    // (l'appelant du défaut — un pair inconnu — reste sans nom et s'affiche sous son id).
    const nameAssignments = VOICE.match(/upsertPeer\([^)]*name:/g) ?? [];
    assert.equal(nameAssignments.length, 1, `une seule source de nom pour les pairs : ${nameAssignments.join(' | ')}`);
  });
});
