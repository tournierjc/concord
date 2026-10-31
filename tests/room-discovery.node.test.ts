/**
 * tests/room-discovery.node.test.ts — Carillon
 *
 * Parseur d'annonces mDNS + registre de salons. AUCUNE I/O : que des faux
 * enregistrements, une horloge manuelle et des assertions. Le browse mDNS réel
 * vit dans le process principal ; ce module ne fait que lire ce qu'on lui donne.
 *
 *   cd /work/lan-voice && node --test tests/room-discovery.node.test.ts
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createRoomRegistry,
  roomSummaryFromRecord,
  FALLBACK_ROOM_NAME,
  MAX_ROOM_ID_LENGTH,
  MAX_ROOM_NAME_LENGTH,
  ROOM_DISCOVERY_MAX_ROOMS,
  ROOM_DISCOVERY_TTL_MS
} from '../src/engine/net/room-discovery.ts'

import type { MdnsRecordLike } from '../src/engine/net/room-discovery.ts'

/* ------------------------------------------------------------------ */
/* Outils de test                                                      */
/* ------------------------------------------------------------------ */

/** Enregistrement mDNS plausible, surchargeable champ par champ. */
function record(over: Partial<MdnsRecordLike> = {}): MdnsRecordLike {
  return {
    name: 'atelier._concord._udp.local',
    host: '192.168.1.24',
    port: 47820,
    ...over
  }
}

/**
 * Horloge MANUELLE : `now()` ne bouge que si le test avance le temps.
 * Aucun `setTimeout`, aucune attente réelle : l'expiration se prouve en une
 * instruction.
 */
function manualClock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let current = start
  return {
    now: (): number => current,
    advance: (ms: number): void => {
      current += ms
    }
  }
}

/* ------------------------------------------------------------------ */
/* roomSummaryFromRecord — cas nominal                                 */
/* ------------------------------------------------------------------ */

test('entrée valide → RoomSummaryDto complet', () => {
  const summary = roomSummaryFromRecord(
    record({
      name: 'atelier._concord._udp.local',
      host: '192.168.1.24',
      port: 47820,
      txt: { roomName: 'Atelier', participants: '3' }
    })
  )
  assert.deepEqual(summary, {
    roomId: '192.168.1.24:47820',
    roomName: 'Atelier',
    host: '192.168.1.24',
    port: 47820,
    participantCount: 3
  })
})

test('roomId = hôte:port, et le nom d’annonce n’est jamais un identifiant serveur', () => {
  const summary = roomSummaryFromRecord(record({ host: '10.0.0.7', port: 47821 }))
  assert.ok(summary)
  assert.equal(summary.roomId, '10.0.0.7:47821')
  assert.ok(
    !summary.roomId.includes('_concord'),
    'le roomId ne doit dépendre que de l’annonce réseau'
  )
  assert.ok(summary.roomId.length <= MAX_ROOM_ID_LENGTH)
})

/* ------------------------------------------------------------------ */
/* Validation de l’hôte — règle LAN unique (isLanCandidate)             */
/* ------------------------------------------------------------------ */

test('host public refusé (93.184.216.34) → null', () => {
  assert.equal(roomSummaryFromRecord(record({ host: '93.184.216.34' })), null)
  assert.equal(roomSummaryFromRecord(record({ host: '8.8.8.8' })), null)
  assert.equal(roomSummaryFromRecord(record({ host: '172.32.0.1' })), null, 'hors 172.16/12')
  assert.equal(roomSummaryFromRecord(record({ host: '10.0.0.7.example.com' })), null)
})

test('host mDNS .local accepté', () => {
  const summary = roomSummaryFromRecord(record({ host: 'atelier-3f2a.local', port: 47821 }))
  assert.ok(summary, '.local doit être accepté')
  assert.equal(summary.host, 'atelier-3f2a.local')
  assert.equal(summary.roomId, 'atelier-3f2a.local:47821')
})

test('hosts LAN acceptés : RFC1918, link-local, loopback, IPv6 ULA/link-local', () => {
  for (const host of ['10.1.2.3', '172.16.4.9', '192.168.0.42', '169.254.10.10', '127.0.0.1']) {
    assert.ok(roomSummaryFromRecord(record({ host })), `devrait accepter ${host}`)
  }
  assert.ok(roomSummaryFromRecord(record({ host: 'fe80::1' })), 'IPv6 link-local')
  assert.ok(roomSummaryFromRecord(record({ host: 'fd00::abcd' })), 'IPv6 ULA')
})

test('host malformé ou vide refusé, sans exception', () => {
  assert.equal(roomSummaryFromRecord(record({ host: '' })), null)
  assert.equal(roomSummaryFromRecord(record({ host: '   ' })), null)
  // Un hôte qui tenterait d’injecter des jetons dans la ligne ICE est refusé.
  assert.equal(roomSummaryFromRecord(record({ host: '192.168.1.24 9 typ host' })), null)
  assert.equal(roomSummaryFromRecord(record({ host: 'atelier\t.local' })), null)
})

/* ------------------------------------------------------------------ */
/* Validation du port                                                  */
/* ------------------------------------------------------------------ */

test('port 9999 refusé → null', () => {
  assert.equal(roomSummaryFromRecord(record({ port: 9999 })), null)
  assert.equal(roomSummaryFromRecord(record({ port: 0 })), null)
  assert.equal(roomSummaryFromRecord(record({ port: 47819 })), null)
  assert.equal(roomSummaryFromRecord(record({ port: 47831 })), null)
  assert.equal(roomSummaryFromRecord(record({ port: 47_820.5 })), null, 'entier exigé')
})

test('port 47821 accepté (premier port de signalisation)', () => {
  const summary = roomSummaryFromRecord(record({ port: 47821 }))
  assert.ok(summary)
  assert.equal(summary.port, 47821)
})

test('plage de signalisation 47821..47830 et port voix 47820 acceptés', () => {
  for (let port = 47820; port <= 47830; port += 1) {
    assert.ok(roomSummaryFromRecord(record({ port })), `port ${port} devrait passer`)
  }
})

/* ------------------------------------------------------------------ */
/* roomName                                                            */
/* ------------------------------------------------------------------ */

test('txt absent → roomName = nom d’annonce, participants 0', () => {
  const summary = roomSummaryFromRecord(record({ name: 'salon-cuisine._concord._udp.local' }))
  assert.ok(summary)
  assert.equal(summary.roomName, 'salon-cuisine._concord._udp.local')
  assert.equal(summary.participantCount, 0)
})

test('nom vide → « Salon LAN »', () => {
  const summary = roomSummaryFromRecord(record({ name: '', txt: undefined }))
  assert.ok(summary, 'une annonce sans nom reste exploitable')
  assert.equal(summary.roomName, FALLBACK_ROOM_NAME)
  assert.equal(summary.participantCount, 0)

  const blanks = roomSummaryFromRecord(record({ name: '   ', txt: { roomName: '  ' } }))
  assert.ok(blanks)
  assert.equal(blanks.roomName, FALLBACK_ROOM_NAME)
})

test('txt.roomName prime sur le nom d’annonce, et le nom est borné à 64', () => {
  const named = roomSummaryFromRecord(record({ txt: { roomName: '  Bureau  ' } }))
  assert.ok(named)
  assert.equal(named.roomName, 'Bureau')

  const long = 'x'.repeat(200)
  const bounded = roomSummaryFromRecord(record({ name: long }))
  assert.ok(bounded)
  assert.equal(bounded.roomName.length, MAX_ROOM_NAME_LENGTH)
  assert.equal(bounded.roomName, 'x'.repeat(MAX_ROOM_NAME_LENGTH))
})

/* DEF-1 (banc T7 2/2) : le nom est un LIBELLÉ, il doit tenir sur une ligne.   */
test('caractères de contrôle dans le nom → ramenés à une espace, une seule ligne', () => {
  const hostile = 'salon\r\ncandidate:1 1 udp 2122260223 10.9.9.9 5000 typ host'
  const summary = roomSummaryFromRecord(record({ txt: { roomName: hostile } }))
  assert.ok(summary)
  assert.equal(summary.roomName, 'salon candidate:1 1 udp 2122260223 10.9.9.9 5000 typ host')
  assert.equal(/[\u0000-\u001f\u007f]/.test(summary.roomName), false)

  // Toute la famille y passe : CR, LF, TAB, NUL, VT/FF, DEL, NEL, U+2028/2029.
  for (const raw of ['a\rb', 'a\nb', 'a\tb', 'a\u0000b', 'a\u000bb', 'a\fb', 'a\u007fb',
                     'a\u0085b', 'a\u2028b', 'a\u2029b', 'a\r\n\t b']) {
    const s = roomSummaryFromRecord(record({ name: raw }))
    assert.ok(s, `nom ${JSON.stringify(raw)} reste exploitable`)
    assert.equal(
      /[\s\u0000-\u001f\u007f-\u009f]/.test(s.roomName.replace(/ /g, '')),
      false,
      `aucun contrôle résiduel pour ${JSON.stringify(raw)}`
    )
    assert.equal(s.roomName, 'a b', `normalisation de ${JSON.stringify(raw)}`)
  }
})

test('nom fait uniquement de contrôles/blancs → « Salon LAN »', () => {
  for (const raw of ['\r\n', '\u0000\u0000', ' \t \n ', '\u2028']) {
    const summary = roomSummaryFromRecord(record({ name: raw, txt: { roomName: raw } }))
    assert.ok(summary)
    assert.equal(summary.roomName, FALLBACK_ROOM_NAME, `nom ${JSON.stringify(raw)}`)
  }
})

test('normalisation AVANT troncature : 64 max, sans espace final', () => {
  // 63 « a » + 2 blancs : la troncature à 64 couperait sur l'espace ajoutée.
  const summary = roomSummaryFromRecord(record({ name: `${'a'.repeat(63)}  tail` }))
  assert.ok(summary)
  assert.equal(summary.roomName, 'a'.repeat(63))
  assert.equal(summary.roomName.endsWith(' '), false)
  assert.ok(summary.roomName.length <= MAX_ROOM_NAME_LENGTH)
})

/* ------------------------------------------------------------------ */
/* participantCount                                                    */
/* ------------------------------------------------------------------ */

test('participants « 12 » borné à 8 (plafond figé du maillage)', () => {
  for (const raw of ['12', '8', '99', '999999999999999999999']) {
    const summary = roomSummaryFromRecord(record({ txt: { participants: raw } }))
    assert.ok(summary)
    assert.equal(summary.participantCount, 8, `participants « ${raw} » → 8`)
  }
})

test('participants non numérique → 0', () => {
  for (const raw of ['beaucoup', '', '   ', '3.5', '3,0', '8 personnes', 'NaN', '0x2']) {
    const summary = roomSummaryFromRecord(record({ txt: { participants: raw } }))
    assert.ok(summary)
    assert.equal(summary.participantCount, 0, `participants « ${raw} » → 0`)
  }
  const negative = roomSummaryFromRecord(record({ txt: { participants: '-3' } }))
  assert.ok(negative)
  assert.equal(negative.participantCount, 0)
})

test('participants valides conservés, espaces tolérés', () => {
  const cases: Array<[string, number]> = [
    ['0', 0],
    ['1', 1],
    ['7', 7],
    [' 4 ', 4]
  ]
  for (const [raw, expected] of cases) {
    const summary = roomSummaryFromRecord(record({ txt: { participants: raw } }))
    assert.ok(summary)
    assert.equal(summary.participantCount, expected, `participants « ${raw} »`)
  }
})

/* ------------------------------------------------------------------ */
/* Robustesse : jamais de cast, jamais d’exception                      */
/* ------------------------------------------------------------------ */

test('annonces inexploitables → null, aucune exception', () => {
  const junk: unknown[] = [
    null,
    undefined,
    {},
    { name: 42, host: '192.168.1.24', port: 47820 },
    { name: 'a.udp.local', host: 42, port: 47820 },
    { name: 'a.udp.local', host: '192.168.1.24', port: '47820' },
    { name: 'a.udp.local', host: '192.168.1.24' },
    record({ host: `${'a'.repeat(70)}.local` }), // roomId > 64 caractères
    record({ host: 'fd00::' + 'f'.repeat(60) }), // idem en IPv6
    'pas un enregistrement',
    7
  ]
  for (const candidate of junk) {
    assert.doesNotThrow(() => roomSummaryFromRecord(candidate as MdnsRecordLike))
    assert.equal(roomSummaryFromRecord(candidate as MdnsRecordLike), null)
  }
})

test('txt malformé : toléré, l’annonce reste valide (seules les entrées texte sont lues)', () => {
  const typed = roomSummaryFromRecord(
    record({ txt: { roomName: 'Studio', participants: 5 } as unknown as Readonly<Record<string, string>> })
  )
  assert.ok(typed)
  assert.equal(typed.roomName, 'Studio')
  assert.equal(typed.participantCount, 0)

  const arrayTxt = roomSummaryFromRecord(
    record({ txt: ['roomName', 'x'] as unknown as Readonly<Record<string, string>> })
  )
  assert.ok(arrayTxt, 'un TXT non-objet n’invalide pas le salon')
  assert.equal(arrayTxt.roomName, 'atelier._concord._udp.local')

  const numericName = roomSummaryFromRecord(
    record({ txt: { roomName: 7 } as unknown as Readonly<Record<string, string>> })
  )
  assert.ok(numericName)
  assert.equal(numericName.roomName, 'atelier._concord._udp.local', 'repli sur le nom d’annonce')
})

/* ------------------------------------------------------------------ */
/* Registre : upsert / remove / list / size                            */
/* ------------------------------------------------------------------ */

test('upsert idempotent : la même annonce ne crée pas de doublon', () => {
  const clock = manualClock()
  const registry = createRoomRegistry({ now: clock.now })

  const first = registry.upsert(record({ txt: { roomName: 'Atelier', participants: '2' } }))
  const second = registry.upsert(record({ txt: { roomName: 'Atelier', participants: '3' } }))

  assert.deepEqual(first, second && { ...second, participantCount: 2 })
  assert.equal(registry.size(), 1)
  assert.equal(registry.list().length, 1)
  // La vue est rafraîchie en place, pas dupliquée.
  assert.equal(registry.list()[0]?.participantCount, 3)
})

test('upsert rend null pour une annonce invalide et ne touche pas au registre', () => {
  const clock = manualClock()
  const registry = createRoomRegistry({ now: clock.now })

  assert.ok(registry.upsert(record({ host: '192.168.1.24' })))
  assert.equal(registry.upsert(record({ host: '93.184.216.34' })), null)
  assert.equal(registry.upsert(record({ port: 9999 })), null)
  assert.equal(registry.upsert({} as MdnsRecordLike), null)
  assert.equal(registry.size(), 1)
})

test('deux hôtes distincts = deux entrées', () => {
  const clock = manualClock()
  const registry = createRoomRegistry({ now: clock.now })

  registry.upsert(record({ name: 'a._concord._udp.local', host: '192.168.1.24' }))
  registry.upsert(record({ name: 'b._concord._udp.local', host: '192.168.1.25' }))

  const rooms = registry.list()
  assert.equal(registry.size(), 2)
  assert.deepEqual(
    rooms.map((room) => room.roomId),
    ['192.168.1.24:47820', '192.168.1.25:47820']
  )
})

test('remove par nom d’annonce : true puis false', () => {
  const clock = manualClock()
  const registry = createRoomRegistry({ now: clock.now })

  registry.upsert(record({ name: 'atelier._concord._udp.local' }))
  registry.upsert(record({ name: 'bureau._concord._udp.local', host: '192.168.1.25' }))

  assert.equal(registry.remove('atelier._concord._udp.local'), true)
  assert.equal(registry.remove('atelier._concord._udp.local'), false)
  assert.equal(registry.remove('inconnu._concord._udp.local'), false)
  assert.equal(registry.remove(42 as unknown as string), false)
  assert.deepEqual(
    registry.list().map((room) => room.roomName),
    ['bureau._concord._udp.local']
  )
  assert.equal(registry.size(), 1)
})

test('expiration par horloge injectée, sans setTimeout', () => {
  const clock = manualClock(1_000)
  const registry = createRoomRegistry({ now: clock.now, ttlMs: ROOM_DISCOVERY_TTL_MS })

  registry.upsert(record({ name: 'atelier._concord._udp.local' }))
  assert.equal(registry.list().length, 1)

  clock.advance(ROOM_DISCOVERY_TTL_MS)
  assert.equal(registry.list().length, 1, 'au seuil exact, l’annonce est encore valide')

  clock.advance(1)
  assert.equal(registry.list().length, 0, 'au-delà du TTL, l’annonce est purgée')
  assert.equal(registry.size(), 0)
})

test('un upsert rafraîchit l’horodatage vu (le TTL repart)', () => {
  const clock = manualClock()
  const registry = createRoomRegistry({ now: clock.now, ttlMs: 10_000 })

  registry.upsert(record({ name: 'atelier._concord._udp.local' }))
  clock.advance(9_000)
  registry.upsert(record({ name: 'atelier._concord._udp.local', txt: { participants: '4' } }))
  clock.advance(9_000)

  const rooms = registry.list()
  assert.equal(rooms.length, 1, 'le rafraîchissement a repoussé la péremption')
  assert.equal(rooms[0]?.participantCount, 4)

  clock.advance(1_001)
  assert.equal(registry.list().length, 0)
})

test('troncature à maxRooms', () => {
  const clock = manualClock()
  const registry = createRoomRegistry({ now: clock.now, maxRooms: 3 })

  for (const name of ['e', 'd', 'c', 'b', 'a']) {
    registry.upsert(record({ name: `${name}._concord._udp.local`, host: '192.168.1.24' }))
  }
  assert.equal(registry.size(), 5, 'le registre garde tout, la vue est tronquée')

  const rooms = registry.list()
  assert.equal(rooms.length, 3)
  assert.deepEqual(
    rooms.map((room) => room.roomName),
    [
      'a._concord._udp.local',
      'b._concord._udp.local',
      'c._concord._udp.local'
    ],
    'les 3 premiers du tri, pas les 3 premiers arrivés'
  )
})

test('maxRooms par défaut = ROOM_DISCOVERY_MAX_ROOMS (16)', () => {
  const clock = manualClock()
  const registry = createRoomRegistry({ now: clock.now })

  for (let index = 0; index < 20; index += 1) {
    registry.upsert(
      record({
        name: `salon-${String(index).padStart(2, '0')}._concord._udp.local`,
        host: `192.168.1.${index + 1}`
      })
    )
  }
  assert.equal(ROOM_DISCOVERY_MAX_ROOMS, 16)
  assert.equal(registry.list().length, 16)
  assert.equal(registry.list()[0]?.roomName, 'salon-00._concord._udp.local')
  assert.equal(registry.list()[15]?.roomName, 'salon-15._concord._udp.local')
})

test('tri stable : par roomName puis par roomId', () => {
  const clock = manualClock()
  const registry = createRoomRegistry({ now: clock.now })

  registry.upsert(record({ name: 'z._concord._udp.local', host: '192.168.1.50', txt: { roomName: 'Bureau' } }))
  registry.upsert(record({ name: 'y._concord._udp.local', host: '192.168.1.10', txt: { roomName: 'Bureau' } }))
  registry.upsert(record({ name: 'x._concord._udp.local', host: '192.168.1.90', txt: { roomName: 'Atelier' } }))

  assert.deepEqual(
    registry.list().map((room) => `${room.roomName}|${room.roomId}`),
    ['Atelier|192.168.1.90:47820', 'Bureau|192.168.1.10:47820', 'Bureau|192.168.1.50:47820']
  )

  // Deux listes successives rendent exactement le même ordre.
  assert.deepEqual(registry.list(), registry.list())
})

test('registres indépendants : aucun état global', () => {
  const clockA = manualClock()
  const clockB = manualClock()
  const registryA = createRoomRegistry({ now: clockA.now })
  const registryB = createRoomRegistry({ now: clockB.now })

  registryA.upsert(record({ name: 'atelier._concord._udp.local' }))
  assert.equal(registryA.size(), 1)
  assert.equal(registryB.size(), 0)
})

test('options invalides : l’horloge est obligatoire (aucune horloge système)', () => {
  assert.throws(
    () => createRoomRegistry({} as unknown as { now: () => number }),
    TypeError,
    'now manquant'
  )
  assert.throws(
    () => createRoomRegistry({ now: 42 as unknown as () => number }),
    TypeError,
    'now non fonction'
  )
  assert.throws(() => createRoomRegistry({ now: manualClock().now, ttlMs: -1 }), RangeError)
  assert.throws(() => createRoomRegistry({ now: manualClock().now, maxRooms: -2 }), RangeError)
})
