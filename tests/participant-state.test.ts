/**
 * tests/participant-state.test.ts — garde des règles d'honnêteté de l'affichage (T18, révisé T20).
 *
 * Ce que React ne pouvait pas falsifier ici (React non installable), et qui a donc un garde pur :
 *   — le halo d'un pair était figé à `data-speaking="false"` (Room.tsx) ou lu dans
 *     `participant.speaking` (Overlay.tsx), c'est-à-dire dans un annuaire qui ne mesure rien
 *     (AD-17 D2 : le main n'a pas d'audio, `speaking: false` y est une affirmation de silence) ;
 *   — « Muet » / « Sourdine » s'affichaient sur la ligne d'un pair alors que `room-bridge` n'écrit
 *     ces drapeaux que pour soi-même (`updateSelf`), la présence ne les transportant pas.
 *
 * La parole distante n'a donc qu'un chemin : la table d'échantillons du plan média, avec
 * péremption à 250 ms (AD-17 D6). Ces tests la falsifient sans plan média, sans DOM, sans React.
 *
 *   node --test tests/participant-state.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  joinStates,
  mutedAttr,
  peerSpeaking,
  PEER_LEVELS,
  selfFlagKnown,
  selfSpeakingAttr,
  SPEAKING_STALE_MS,
  type PeerSpeakingTable,
} from '../src/renderer/participant-state'
import type { ParticipantDto } from '../src/shell/ipc-contract'

function participant(patch: Partial<ParticipantDto> & { id: string }): ParticipantDto {
  return {
    name: patch.id,
    muted: false,
    deafened: false,
    gain: 1,
    connection: 'connected',
    ...patch,
  }
}

function table(entries: [string, 'true' | 'false' | 'unknown', number][]): PeerSpeakingTable {
  return new Map(entries.map(([id, speaks, at]) => [id, { speaks, at }]))
}

const SELF = participant({ id: 'self-1', name: 'Moi' })
const PEER = participant({ id: 'peer-1', name: 'Ada' })
const NOW = 10_000

test('parole d’un pair : aucun échantillon ⇒ `unknown`, jamais `false`', () => {
  // M1 — rendre `false` ici affirmerait un silence que personne n'a mesuré (écart E2).
  assert.equal(peerSpeaking('sig-42', table([]), NOW), 'unknown')
  assert.equal(peerSpeaking('peer-1', table([]), NOW), 'unknown')
  // Un id voisin ne parle pas pour l'autre : la table est indexée, pas interrogée « au plus près ».
  assert.equal(peerSpeaking('peer-2', table([['peer-1', 'true', NOW]]), NOW), 'unknown')
  // La table du jour est vide (AD-17 D3/D4 non livrés) : le rendu dit donc `unknown` partout.
  assert.equal(peerSpeaking('peer-1', PEER_LEVELS, NOW), 'unknown')
})

test('parole d’un pair : échantillon frais ⇒ le verdict de `speakingFromLevel`', () => {
  assert.equal(peerSpeaking('peer-1', table([['peer-1', 'true', NOW]]), NOW), 'true')
  assert.equal(peerSpeaking('peer-1', table([['peer-1', 'false', NOW]]), NOW), 'false')
  // `level()` a rendu `null` au dernier échantillon : on ne sait pas, on ne comble pas.
  assert.equal(peerSpeaking('peer-1', table([['peer-1', 'unknown', NOW]]), NOW), 'unknown')
})

test('péremption 250 ms : un pair muet ne reste pas « muet » sans mesure (D6)', () => {
  const stale = table([['peer-1', 'false', NOW - SPEAKING_STALE_MS - 1]])
  // M2 — sans péremption, un `false` vieux de plusieurs minutes s'affiche comme un silence mesuré.
  assert.equal(peerSpeaking('peer-1', stale, NOW), 'unknown')
  // Un `true` périmé ne fait pas non plus un halo : la mesure n'existe plus, dans les deux sens.
  assert.equal(peerSpeaking('peer-1', table([['peer-1', 'true', NOW - 1_000]]), NOW), 'unknown')
  // Borne exacte : 250 ms est encore frais (un `>=` ferait clignoter deux trames sur trois).
  assert.equal(peerSpeaking('peer-1', table([['peer-1', 'false', NOW - SPEAKING_STALE_MS]]), NOW), 'false')
})

test('horodatage incohérent (futur, NaN) ⇒ `unknown`, pas une parole éternelle', () => {
  assert.equal(peerSpeaking('peer-1', table([['peer-1', 'true', NOW + 1]]), NOW), 'unknown')
  assert.equal(peerSpeaking('peer-1', table([['peer-1', 'true', Number.NaN]]), NOW), 'unknown')
})

test('parole de soi-même : connue seulement si le plan média tourne', () => {
  assert.equal(selfSpeakingAttr(true, true), 'true')
  assert.equal(selfSpeakingAttr(true, false), 'false')
  // M3 — `false` ici affirmerait un silence alors qu'on n'a pas de micro ouvert du tout.
  assert.equal(selfSpeakingAttr(false, false), 'unknown')
  assert.equal(selfSpeakingAttr(false, true), 'unknown')
})

test('table vivante : ce que le plan média y écrit est ce que le rendu lit', () => {
  // Le rendu ne détient pas une copie : si `voice.ts` écrivait ailleurs, le halo resterait
  // mort sans aucune erreur — c'est exactement le genre de silence qu'on veut voir échouer ici.
  PEER_LEVELS.set('peer-live', { speaks: 'true', at: NOW - 10 })
  try {
    assert.equal(peerSpeaking('peer-live', PEER_LEVELS, NOW), 'true')
    PEER_LEVELS.set('peer-live', { speaks: 'true', at: NOW - SPEAKING_STALE_MS - 1 })
    assert.equal(peerSpeaking('peer-live', PEER_LEVELS, NOW), 'unknown')
  } finally {
    PEER_LEVELS.delete('peer-live')
  }
})

test('data-muted : valeur réelle pour soi-même, `unknown` pour un pair', () => {
  assert.equal(mutedAttr(participant({ id: 'self-1', muted: true }), 'self-1'), 'true')
  assert.equal(mutedAttr(participant({ id: 'self-1', muted: false }), 'self-1'), 'false')
  // M4 — un `muted: true` reçu sur la ligne d'un pair ne prouve rien : le drapeau n'est pas transporté.
  assert.equal(mutedAttr(participant({ id: 'peer-1', muted: true }), 'self-1'), 'unknown')
  // Sans soi-même identifié (salon en cours de jointure), on n'affirme rien.
  assert.equal(mutedAttr(participant({ id: 'self-1', muted: true }), null), 'unknown')
})

test('libellé « Muet » : seulement là où le drapeau est connu', () => {
  // M5 — sans cette garde, la liste des pairs affiche « Muet » sur la foi d'un faux.
  assert.equal(selfFlagKnown(SELF, 'self-1'), true)
  assert.equal(selfFlagKnown(participant({ id: 'peer-1', muted: true }), 'self-1'), false)
  assert.equal(selfFlagKnown(PEER, null), false)
})

test('joinStates : aucun séparateur orphelin, aucun état = chaîne vide', () => {
  assert.equal(joinStates([null, null]), '')
  // M6 — l'ancien rendu préfixait « · » à chaque état : « · Sourdine » quand « Muet » manquait.
  assert.equal(joinStates([null, 'Sourdine', 'Parle']), 'Sourdine · Parle')
  assert.equal(joinStates(['Muet', null, null, 'ICE']), 'Muet · ICE')
  assert.equal(
    joinStates(['Muet', 'Sourdine', 'Parle', 'ICE']),
    'Muet · Sourdine · Parle · ICE',
  )
})
