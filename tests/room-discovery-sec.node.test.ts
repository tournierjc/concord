/**
 * tests/room-discovery-sec.node.test.ts — sonde d'injection de nom d'annonce (Banc, T7 2/2)
 *
 * Fichier NEUF et INDÉPENDANT du fichier de Carillon : aucune ligne de
 * `tests/room-discovery.node.test.ts` n'est modifiée. Objet : vérifier la
 * propriété annoncée « un nom de salon ne peut pas injecter de jetons dans la
 * ligne ICE factice présentée à `isLanCandidate` ».
 *
 * Trois noms hostiles sont passés au module :
 *   1. nom avec ESPACE ;
 *   2. nom avec CR/LF (le vecteur le plus intéressant, via `txt.roomName`
 *      qui a la PRIORITÉ sur le nom d'annonce) ;
 *   3. nom contenant `candidate:` et `typ relay`.
 *
 * Chaque test vérifie DEUX choses :
 *   a) la décision LAN et les champs `host` / `roomId` / `port` du DTO sont
 *      strictement ceux de l'hôte réel — le nom n'a aucune influence ;
 *   b) le contrôle négatif : un nom qui « se fait passer » pour une adresse LAN
 *      ne fait PAS entrer un hôte public.
 *
 * Aucune I/O, aucune horloge système, aucun réseau.
 *
 *   cd /work/lan-voice && npx tsx --test tests/room-discovery-sec.node.test.ts
 *
 * MODIFIÉ le 2026-10-31 par Carillon (propriétaire de src/engine), sur la seule
 * partie que DEF-1 rendait fausse : le cas 2 attend désormais un nom normalisé
 * en une ligne au lieu du nom verbatim, et le cas 4 (ex-`skip`, preuve de
 * DEF-1) est ACTIF et vert. Les cas 1 et 3 sont inchangés ; la propriété
 * « injection de jetons dans la ligne ICE » qu'ils établissent reste la même.
 *
 * MODIFIÉ le 2026-10-31 (Banc, T11) : plus aucune assertion non nulle (`!`) ni
 * `as` dans ce fichier — les `RoomSummaryDto | null` passent par `summary()`,
 * garde explicite qui échoue avec un message. Un `!` aurait affirmé que
 * l'annonce est acceptée au lieu de le vérifier.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ROOM_VOICE_PORT,
  roomSummaryFromRecord
} from '../src/engine/net/room-discovery.ts'

import type { MdnsRecordLike } from '../src/engine/net/room-discovery.ts'

/** DTO rendu par `roomSummaryFromRecord` quand l'annonce est exploitable. */
type RoomSummary = NonNullable<ReturnType<typeof roomSummaryFromRecord>>

/** Annonce mDNS minimale et valide ; chaque test surcharge ce qu'il attaque. */
function record(over: Partial<MdnsRecordLike> = {}): MdnsRecordLike {
  return {
    name: 'atelier',
    host: '192.168.1.24',
    port: ROOM_VOICE_PORT,
    ...over
  }
}

/**
 * Annonce analysée, avec garde explicite sur le `null`.
 * Échoue le test — au lieu de le laisser passer — si l'annonce est refusée.
 */
function summary(rec: MdnsRecordLike, what: string): RoomSummary {
  const value = roomSummaryFromRecord(rec)
  if (value === null) {
    throw new Error(`${what} : annonce refusée alors qu’elle devait être acceptée`)
  }
  return value
}

/* ------------------------------------------------------------------ */
/* 1. Nom avec ESPACE                                                 */
/* ------------------------------------------------------------------ */

test('nom avec espace : aucun jeton supplémentaire, le verdict LAN vient de l’hôte seul', () => {
  const hostileName = 'salon des amis 10.0.0.5 9 typ host'
  const hostile = summary(
    record({ name: hostileName, host: '10.0.0.5' }),
    'nom avec espace'
  )
  const temoin = summary(record({ name: 'salon', host: '10.0.0.5' }), 'témoin')

  // (a) l'annonce est acceptée, et SEULS roomName diffèrent du témoin.
  assert.equal(hostile.host, '10.0.0.5')
  assert.equal(hostile.port, ROOM_VOICE_PORT)
  assert.equal(hostile.roomId, '10.0.0.5:47820')
  assert.deepEqual(
    { ...hostile, roomName: null },
    { ...temoin, roomName: null }
  )

  // Aucun blanc dans l'hôte retenu : rien n'a été concaténé au jeton d'adresse.
  assert.equal(/\s/.test(hostile.host), false)
  // Le nom est conservé tel quel (c'est un libellé, pas une adresse) :
  assert.equal(hostile.roomName, hostileName)

  // (b) contrôle négatif : le nom ne peut pas « offrir » une adresse LAN à un
  // hôte public — 8.8.8.8 reste refusé même avec un nom qui ment.
  assert.equal(
    roomSummaryFromRecord(record({ name: '10.0.0.5:47820 candidate:1', host: '8.8.8.8' })),
    null
  )

  // (c) contexte : le filtre lexical existe bien, mais il porte sur `host`.
  // Un hôte qui contient des espaces (donc des jetons en plus) est refusé.
  assert.equal(roomSummaryFromRecord(record({ name: 'atelier', host: '10.0.0.5 9 typ host' })), null)
})

/* ------------------------------------------------------------------ */
/* 2. Nom avec CR/LF (via txt.roomName, prioritaire sur le nom mDNS)  */
/* ------------------------------------------------------------------ */

test('nom avec CRLF : aucun candidat injecté ; le CRLF est normalisé en une espace (DEF-1 corrigé)', () => {
  const injected =
    'salon\r\ncandidate:1 1 udp 2122260223 10.9.9.9 5000 typ host'
  const hostile = summary(
    record({ name: 'atelier', host: '192.168.1.30', txt: { roomName: injected } }),
    'nom avec CRLF'
  )

  // (a) accepté, et l'hôte/port/roomId sont ceux de l'annonce réelle : les
  // jetons contenus dans le nom n'atteignent jamais la ligne ICE.
  assert.equal(hostile.host, '192.168.1.30')
  assert.equal(hostile.port, ROOM_VOICE_PORT)
  assert.equal(hostile.roomId, '192.168.1.30:47820')
  assert.equal(/\s/.test(hostile.host), false)

  // DEF-1 CORRIGÉ (Carillon, 2026-10-31) : le CR/LF ne survit plus, il est
  // ramené à UNE espace — le libellé tient sur une ligne et ne peut plus
  // injecter de ligne dans un journal. Le nom reste un libellé, pas une adresse.
  assert.equal(hostile.roomName.includes('\r'), false)
  assert.equal(hostile.roomName.includes('\n'), false)
  assert.equal(
    hostile.roomName,
    'salon candidate:1 1 udp 2122260223 10.9.9.9 5000 typ host'
  )

  // (b) contrôle négatif : un nom porteur de CRLF ne blanchit pas un hôte public.
  assert.equal(
    roomSummaryFromRecord(
      record({ name: injected, host: '93.184.216.34', txt: { roomName: injected } })
    ),
    null
  )

  // (c) un hôte porteur de CRLF est, lui, refusé par le filtre lexical.
  assert.equal(
    roomSummaryFromRecord(record({ name: 'atelier', host: '192.168.1.30\r\ncandidate:1 1 typ host' })),
    null
  )
})

/* ------------------------------------------------------------------ */
/* 3. Nom contenant `candidate:` et `typ relay`                       */
/* ------------------------------------------------------------------ */

test('nom « candidate: … typ relay » : la décision LAN reste celle de l’hôte, sans exception', () => {
  const hostileName = 'candidate:1 1 udp 2122260223 192.168.1.99 47820 typ relay'
  const lan = summary(
    record({ name: hostileName, host: '10.1.2.3' }),
    'nom « candidate: … typ relay »'
  )

  assert.equal(lan.host, '10.1.2.3')
  assert.equal(lan.roomId, '10.1.2.3:47820')
  assert.equal(lan.port, ROOM_VOICE_PORT)
  // Le nom reste un libellé : il ne devient ni hôte ni identifiant.
  assert.equal(lan.roomName, hostileName)
  assert.equal(lan.roomId.includes('192.168.1.99'), false)

  // (b) contrôle négatif : la même chaîne en guise de nom ne fait pas passer
  // un hôte public, et ne fait pas passer un port hors plage.
  assert.equal(
    roomSummaryFromRecord(record({ name: hostileName, host: '203.0.113.7' })),
    null
  )
  assert.equal(
    roomSummaryFromRecord(record({ name: hostileName, host: '10.1.2.3', port: 47899 })),
    null
  )

  // (c) la même chaîne en guise d'hôte est refusée (espaces → filtre lexical).
  assert.equal(roomSummaryFromRecord(record({ name: 'atelier', host: hostileName })), null)
})

/* ------------------------------------------------------------------ */
/* DEF-1 — régression : plus aucun caractère de contrôle dans le nom   */
/* ------------------------------------------------------------------ */

/*
 * Constat du banc (T7 2/2) : `FORBIDDEN_HOST_CHARS` n'était appliqué qu'à `host`,
 * `resolveRoomName` ne faisait que `trim()` + troncature, et `guard.string`
 * d'ipc-contract ne contrôle que la longueur → `roomName` traversait avec CR/LF
 * et contrôles, jusqu'à l'affichage et aux journaux.
 *
 * CORRIGÉ par Carillon le 2026-10-31 dans `src/engine/net/room-discovery.ts`
 * (`normalizeLabel` : toute suite de blancs/contrôles → une espace, avant
 * troncature). Ce cas était un `skip` rouge-si-dé-skippé ; il est désormais
 * ACTIF et vert : il garde la correction contre toute régression.
 */
test('DEF-1 (régression) : roomName ne contient aucun caractère de contrôle', () => {
  const hostile = summary(
    record({ name: 'atelier', host: '192.168.1.31', txt: { roomName: 'salon\r\nX' } }),
    'DEF-1 / régression'
  )
  assert.equal(/[\u0000-\u001f\u007f]/.test(hostile.roomName), false)
  assert.equal(hostile.roomName, 'salon X')
})
