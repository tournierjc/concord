/**
 * tests/join-peer-name.node.test.ts — le tuyau de signalisation porte le pseudo, pas le nom du salon (2026-11-02).
 *
 * Capture JC (0.4.7/0.4.8, salon « oki ») : la table des pairs média affiche une ligne portant le
 * NOM DU SALON avec « Pas de flux audio », à côté de la vraie liste des participants (« jeanjean
 * (Vous) »). Cause mesurée : le handler `roomJoin` passait `join.name` (le nom du SALON, champ du
 * contrat `RoomJoinPayload`) comme nom de pair à `startSignalingLink`, alors que le participant
 * local est nommé par `resolveDisplayName(nickname, osUserName())` — deux sources, un seul doit
 * alimenter le tuyau. Ce test lit le HANDLER RÉEL sur le disque et verrouille la règle ; il échouait
 * sur la 0.4.8 (`name` = `join.name`), il passe depuis le correctif (`name` = `displayName`).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const INDEX = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');

describe('roomJoin — le tuyau reçoit le nom du PARTICIPANT, jamais celui du salon', () => {
  const joinBlock = (() => {
    // Le bloc du handler, découpé sur ses bornes réelles (jamais un fichier entier « matché » au large).
    const start = INDEX.indexOf('[IPC.roomJoin]');
    assert.notEqual(start, -1, 'le handler roomJoin existe');
    const end = INDEX.indexOf('[IPC.roomLeave]', start);
    assert.notEqual(end, -1, 'le handler est délimité par roomLeave');
    return INDEX.slice(start, end);
  })();

  it('startSignalingLink est appelé avec displayName, pas avec le nom du salon', () => {
    assert.match(
      joinBlock,
      /startSignalingLink\(\s*state\.roomId,\s*displayName,/,
      'le nom du tuyau est le pseudo résolu (même source que la ligne locale du pont)',
    );
    assert.doesNotMatch(
      joinBlock,
      /startSignalingLink\(\s*state\.roomId,\s*join\.name/,
      'join.name décrit le SALON (contrat RoomJoinPayload) : il ne saurait nommer un pair',
    );
  });

  it('le pont reçoit le MÊME displayName pour la ligne locale : une seule identité, deux listes', () => {
    // `bridge.join(join, displayName)` et `startSignalingLink(..., displayName, ...)` : la ligne
    // de la table média et celle de l\'annuaire du pont portent le même pseudo, pas deux jetons.
    assert.match(joinBlock, /bridge\.join\(\s*join,\s*displayName\s*\)/);
    const nameUses = joinBlock.match(/displayName/g) ?? [];
    assert.ok(nameUses.length >= 3, 'résolu UNE fois, consommé aux deux places (pont + tuyau)');
  });
});
