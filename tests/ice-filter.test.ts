/**
 * tests/ice-filter.test.ts — Banc / vérification
 *
 * Contrat vérifié : SPEC-001 CA7 / critère bloquant B3, et le module
 * src/engine/rtc/ice-filter.ts (Carillon, contrat gelé) :
 *
 *   export function isLanCandidate(
 *     candidate: string | IceCandidateLike | null | undefined
 *   ): boolean
 *   export function filterLanCandidates<T extends string | IceCandidateLike>(list: T[]): T[]
 *
 *   Lecture STRICTE appliquée ici (celle de la spec) :
 *     ACCEPTÉ : 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, 127.0.0.0/8
 *               — et seulement pour un candidat « typ host ».
 *     REJETÉ  : typ srflx / prflx / relay (quelle que soit l'adresse),
 *               toute adresse publique, et — lecture stricte RFC1918 —
 *               100.64.0.0/10 (CGNAT), 172.32.0.0/16, 192.169.0.0/16, 11.0.0.0/8.
 *
 * ── Réparation du 2026-10-31 (tâche 9c41d7e5, Banc) ───────────────────────
 * La version précédente de ce fichier était « présente et morte » :
 *   1. `await import('../src/engine/rtc/ice-filter')` en TOP-LEVEL AWAIT.
 *      Mesuré : `npx tsx --test tests/ice-filter.test.ts` →
 *      "Error: Transform failed with 1 error: tests/ice-filter.test.ts:40:9:
 *       ERROR: Top-level await is currently not supported with the "cjs" output
 *       format" (esbuild ; package.json n'a pas "type":"module"), exit=1,
 *       0 assertion exécutée.
 *   2. `import { describe, it, expect } from 'vitest'` alors qu'AUCUNE
 *      dépendance n'est installée (node_modules/.bin inexistant).
 * Correctif : import STATIQUE du module avec son extension explicite
 * (`../src/engine/rtc/ice-filter.ts`, résolution directe par tsx), et
 * node:test + node:assert/strict — les mêmes primitives que les 11 autres
 * fichiers `tests/*.test.ts` du dépôt. Aucune dépendance, aucun réseau.
 *
 *   npx tsx --test tests/ice-filter.test.ts
 *
 * Complémentarité avec tests/ice-filter.node.test.ts (Carillon, 38 cas) :
 * ce fichier-ci est le banc de CONTRAT (matrice de bornes RFC1918 calculée,
 * CGNAT, « typ prime sur l'adresse », robustesse d'entrée, typage de sortie
 * de filterLanCandidates). L'autre couvre en plus IPv6 (fe80/fc00/2001:db8),
 * mDNS, 0.0.0.0 et l'ordre préservé. Les deux tournent, aucun cas n'est
 * laissé sans exécution.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  isLanCandidate,
  filterLanCandidates
} from '../src/engine/rtc/ice-filter.ts'

/** Construit une ligne de candidat SDP réaliste (format Chrome/Firefox). */
function sdpCandidate(
  ip: string,
  opts: { typ?: string; transport?: string; component?: number; raddr?: string } = {}
): string {
  const { typ = 'host', transport = 'udp', component = 1, raddr } = opts
  const base = `candidate:${component} ${component} ${transport} 2122260223 ${ip} 51234 typ ${typ} generation 0`
  return raddr ? `${base} raddr ${raddr} rport 51234` : base
}

/** Candidats qui DOIVENT être rejetés (typ srflx/relay/prflx ou hors RFC1918). */
const REJECTED: Array<[string, string]> = [
  ['srflx sur adresse publique (RFC 5389)',
    sdpCandidate('81.56.12.9', { typ: 'srflx', raddr: '192.168.1.42' })],
  ['relay TURN', sdpCandidate('203.0.113.7', { typ: 'relay' })],
  ['prflx sur adresse publique', sdpCandidate('198.51.100.4', { typ: 'prflx' })],
  ['typ host mais adresse publique (8.8.8.8)', sdpCandidate('8.8.8.8')],
  ['typ host mais adresse publique (1.1.1.1)', sdpCandidate('1.1.1.1')],
  ['172.32.0.1 — juste hors de 172.16.0.0/12', sdpCandidate('172.32.0.1')],
  ['192.169.0.1 — juste hors de 192.168.0.0/16', sdpCandidate('192.169.0.1')],
  ['11.0.0.1 — juste hors de 10.0.0.0/8', sdpCandidate('11.0.0.1')],
  ['100.64.0.1 — CGNAT, pas RFC1918 (lecture stricte)', sdpCandidate('100.64.0.1')],
  ['ligne vide', ''],
  ['ligne tronquée sans adresse (bruit)', 'a=candidate:1 1 udp 2122260223 ']
]

/** Candidats qui DOIVENT être acceptés (host LAN). */
const ACCEPTED: Array<[string, string]> = [
  ['192.168.1.42', sdpCandidate('192.168.1.42')],
  ['192.168.0.1 (bord bas 192.168/16)', sdpCandidate('192.168.0.1')],
  ['192.168.255.254 (bord haut 192.168/16)', sdpCandidate('192.168.255.254')],
  ['10.0.0.5', sdpCandidate('10.0.0.5')],
  ['10.255.255.254 (bord haut 10/8)', sdpCandidate('10.255.255.254')],
  ['172.16.0.1 (bord bas 172.16/12)', sdpCandidate('172.16.0.1')],
  ['172.31.255.254 (bord haut 172.16/12)', sdpCandidate('172.31.255.254')],
  ['169.254.12.3 (link-local)', sdpCandidate('169.254.12.3')],
  ['127.0.0.1 (loopback, deux instances même machine)', sdpCandidate('127.0.0.1')],
  ['192.168.1.42 en TCP (candidat host tcp)',
    sdpCandidate('192.168.1.42', { transport: 'tcp' })],
  ['192.168.1.42 en composant 2 (RTCP)',
    sdpCandidate('192.168.1.42', { component: 2 })]
]

describe('ice-filter — surface du module (contrat gelé)', () => {
  it('exporte isLanCandidate comme fonction', () => {
    assert.equal(typeof isLanCandidate, 'function')
  })

  it('exporte filterLanCandidates comme fonction', () => {
    assert.equal(typeof filterLanCandidates, 'function')
  })
})

describe('ice-filter — candidats à REJETER', () => {
  for (const [label, candidate] of REJECTED) {
    it(`rejette ${label}`, () => {
      assert.equal(isLanCandidate(candidate), false)
    })
  }

  it('rejette la forme objet RTCIceCandidateInit d’un srflx public', () => {
    // Variable intermédiaire : le module ne déclare que { candidate?: string },
    // les propriétés supplémentaires d'un RTCIceCandidateInit réel restent
    // donc licites sans élargir le contrat (pas de TS2353 au typecheck).
    const init = {
      candidate: sdpCandidate('81.56.12.9', { typ: 'srflx', raddr: '192.168.1.42' }),
      sdpMid: '0',
      sdpMLineIndex: 0
    }
    assert.equal(isLanCandidate(init), false)
  })

  it('rejette undefined et null sans lever', () => {
    assert.equal(isLanCandidate(undefined), false)
    assert.equal(isLanCandidate(null), false)
  })

  it('rejette les entrées qui ne sont pas des candidats SDP, sans lever', () => {
    assert.equal(isLanCandidate(42 as unknown as string), false)
    assert.equal(isLanCandidate({} as unknown as string), false)
    assert.equal(isLanCandidate([] as unknown as string), false)
    assert.equal(isLanCandidate('typ host'), false)
    assert.equal(isLanCandidate('typ'), false)
  })
})

describe('ice-filter — candidats à ACCEPTER', () => {
  for (const [label, candidate] of ACCEPTED) {
    it(`accepte ${label}`, () => {
      assert.equal(isLanCandidate(candidate), true)
    })
  }

  it('accepte la forme objet RTCIceCandidateInit d’un host LAN', () => {
    const init = {
      candidate: sdpCandidate('192.168.1.42'),
      sdpMid: '0',
      sdpMLineIndex: 0
    }
    assert.equal(isLanCandidate(init), true)
  })

  it('accepte une ligne SDP complète préfixée « a= »', () => {
    assert.equal(isLanCandidate('a=' + sdpCandidate('10.1.2.3')), true)
  })
})

describe('ice-filter — lecture stricte des bornes RFC1918', () => {
  it('10.0.0.0/8 : bornes exactes, voisines immédiates rejetées', () => {
    assert.equal(isLanCandidate(sdpCandidate('9.255.255.255')), false)
    assert.equal(isLanCandidate(sdpCandidate('10.0.0.0')), true)
    assert.equal(isLanCandidate(sdpCandidate('10.255.255.255')), true)
    assert.equal(isLanCandidate(sdpCandidate('11.0.0.0')), false)
  })

  it('172.16.0.0/12 : bornes exactes, voisines immédiates rejetées', () => {
    assert.equal(isLanCandidate(sdpCandidate('172.15.255.255')), false)
    assert.equal(isLanCandidate(sdpCandidate('172.16.0.0')), true)
    assert.equal(isLanCandidate(sdpCandidate('172.31.255.255')), true)
    assert.equal(isLanCandidate(sdpCandidate('172.32.0.0')), false)
  })

  it('192.168.0.0/16 : bornes exactes, voisines immédiates rejetées', () => {
    assert.equal(isLanCandidate(sdpCandidate('192.167.255.255')), false)
    assert.equal(isLanCandidate(sdpCandidate('192.168.0.0')), true)
    assert.equal(isLanCandidate(sdpCandidate('192.168.255.255')), true)
    assert.equal(isLanCandidate(sdpCandidate('192.169.0.0')), false)
  })

  it('169.254.0.0/16 (link-local) : bornes exactes, voisines immédiates rejetées', () => {
    assert.equal(isLanCandidate(sdpCandidate('169.253.255.255')), false)
    assert.equal(isLanCandidate(sdpCandidate('169.254.0.0')), true)
    assert.equal(isLanCandidate(sdpCandidate('169.254.255.255')), true)
    assert.equal(isLanCandidate(sdpCandidate('169.255.0.0')), false)
  })

  it('127.0.0.0/8 (loopback) : bornes, et 126.x rejeté', () => {
    assert.equal(isLanCandidate(sdpCandidate('126.255.255.255')), false)
    assert.equal(isLanCandidate(sdpCandidate('127.0.0.1')), true)
    assert.equal(isLanCandidate(sdpCandidate('127.255.255.255')), true)
  })
})

describe('ice-filter — CGNAT 100.64.0.0/10 rejeté (lecture stricte)', () => {
  it('rejette les quatre bords du bloc 100.64/10 et ses voisins publics', () => {
    for (const ip of ['100.63.255.255', '100.64.0.0', '100.100.100.100', '100.127.255.255', '100.128.0.0']) {
      assert.equal(isLanCandidate(sdpCandidate(ip)), false, `${ip} doit être rejeté`)
    }
  })

  it('rejette un 100.64/10 même annoncé typ host (pas de CGNAT en LAN only)', () => {
    assert.equal(
      isLanCandidate('a=' + sdpCandidate('100.72.8.1', { typ: 'host', transport: 'tcp' })),
      false
    )
  })
})

describe('ice-filter — le type de candidat prime sur l’adresse', () => {
  it('rejette srflx même si son adresse est LAN', () => {
    assert.equal(isLanCandidate(sdpCandidate('192.168.1.42', { typ: 'srflx' })), false)
  })

  it('rejette relay même si son adresse est LAN', () => {
    assert.equal(isLanCandidate(sdpCandidate('10.0.0.5', { typ: 'relay' })), false)
  })

  it('rejette prflx même si son adresse est LAN', () => {
    assert.equal(isLanCandidate(sdpCandidate('172.16.0.1', { typ: 'prflx' })), false)
  })

  it('rejette un type inconnu (typ native) même sur adresse LAN', () => {
    assert.equal(isLanCandidate(sdpCandidate('192.168.1.42', { typ: 'native' })), false)
  })
})

describe('ice-filter — filterLanCandidates', () => {
  it('ne garde que les candidats LAN, dans l’ordre d’origine', () => {
    const lan1 = sdpCandidate('192.168.1.42')
    const pub = sdpCandidate('81.56.12.9', { typ: 'srflx', raddr: '192.168.1.42' })
    const lan2 = sdpCandidate('10.0.0.5')
    const relay = sdpCandidate('203.0.113.7', { typ: 'relay' })
    const out = filterLanCandidates([lan1, pub, lan2, relay])
    assert.deepEqual(out, [lan1, lan2])
  })

  it('conserve le type des éléments (objets RTCIceCandidateInit)', () => {
    const lan = { candidate: sdpCandidate('192.168.1.42'), sdpMid: '0' }
    const pub = { candidate: sdpCandidate('8.8.8.8'), sdpMid: '0' }
    const out = filterLanCandidates([lan, pub])
    assert.equal(out.length, 1)
    assert.equal(out[0], lan)
    assert.equal(out[0].sdpMid, '0')
  })

  it('retourne un tableau vide pour une entrée qui n’est pas un tableau', () => {
    assert.deepEqual(filterLanCandidates(undefined as unknown as string[]), [])
    assert.deepEqual(filterLanCandidates(null as unknown as string[]), [])
  })

  it('retourne un tableau vide quand aucun candidat n’est LAN', () => {
    assert.deepEqual(
      filterLanCandidates([sdpCandidate('8.8.8.8'), sdpCandidate('203.0.113.7', { typ: 'relay' })]),
      []
    )
  })
})
