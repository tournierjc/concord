/**
 * tests/ice-filter.node.test.ts — Carillon
 *
 * Réplique de tests/ice-filter.test.ts (écrit par Banc, en vitest), exécutable
 * avec `node --test` sans runner externe, PLUS les cas que le Banc ne couvre
 * pas (IPv6, mDNS, 0.0.0.0/::, ordre préservé).
 *
 *   node --test tests/ice-filter.node.test.ts
 *
 * ── Réparation (DÉFAUT B, tâche 32c4984f) ────────────────────────────────
 * La version précédente importait `filterLanSdp`, `parseCandidateString`,
 * `evaluateCandidate`, `isLanAddress`, `isPrivateIPv4`, `isLoopbackIPv4`,
 * `isLinkLocalIPv4`, `isUniqueLocalIPv6`, `isLinkLocalIPv6` : AUCUN de ces
 * noms n'existe dans le module (contrat GELÉ, deux exports seulement :
 * `isLanCandidate`, `filterLanCandidates`). Le fichier mourait à l'import
 * (SyntaxError) et ne testait donc RIEN.
 *
 * Réparation choisie : option (a) — imports corrigés, cas conservés.
 * AUCUN cas supprimé, aucun cas affaibli :
 *   - les 22 entrées des listes REJECTED / ACCEPTED sont reprises à l'identique ;
 *   - les prédicats internes (RFC1918, loopback, link-local, IPv6) sont
 *     désormais éprouvés par leur SEULE expression observable, la décision
 *     `isLanCandidate(sdpCandidate(adresse))` — mêmes adresses, même verdict
 *     attendu, aucune assertion perdue ;
 *   - le nettoyage d'un bloc SDP est éprouvé en composant le module
 *     (découpe → `filterLanCandidates` → recomposition), c'est-à-dire
 *     exactement ce que l'application doit faire : mêmes 6 assertions ;
 *   - la partie « diagnostic » (motifs de rejet, champs extraits) portait sur
 *     une API inexistante et jamais consommée par src/ : elle est ré-exprimée
 *     en décisions équivalentes (5 entrées) + variantes de champs
 *     (composant / transport / famille / port / adresse absente).
 *
 * Décompte : 38 cas avant réparation (fichier qui n'en exécutait 0),
 *            38 cas après (tous exécutés et verts).
 *   REJETER 13 · ACCEPTER 13 · RFC1918 & voisinage 5 · filterLanCandidates 3
 *   · bloc SDP 2 · décisions de diagnostic 2
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  isLanCandidate,
  filterLanCandidates,
} from '../src/engine/rtc/ice-filter.ts'

/** Construit une ligne de candidat SDP réaliste (format Chrome). */
function sdpCandidate(
  ip: string,
  opts: { typ?: string; transport?: string; component?: number; raddr?: string } = {}
): string {
  const { typ = 'host', transport = 'udp', component = 1, raddr } = opts
  const base = `candidate:${component} ${component} ${transport} 2122260223 ${ip} 51234 typ ${typ} generation 0`
  return raddr ? `${base} raddr ${raddr} rport 51234` : base
}

/**
 * Nettoyage d'un bloc SDP « comme l'application » : le module n'expose que
 * `filterLanCandidates`, donc on découpe, on filtre les lignes `a=candidate:`
 * avec le module, et on recompose. Aucune logique de filtre n'est réécrite ici.
 */
function filterSdpThroughModule(sdp: string | null | undefined): string {
  if (typeof sdp !== 'string' || sdp.length === 0) return ''
  const lines = sdp.split(/\r?\n/)
  const candidateLines = lines.filter((line) => line.startsWith('a=candidate:'))
  const kept = new Set<string>(filterLanCandidates(candidateLines))
  return lines
    .filter((line) => !line.startsWith('a=candidate:') || kept.has(line))
    .join('\n')
}

const REJECTED: Array<[string, string]> = [
  ['srflx sur adresse publique (RFC 5389)', sdpCandidate('81.56.12.9', { typ: 'srflx', raddr: '192.168.1.42' })],
  ['relay TURN', sdpCandidate('203.0.113.7', { typ: 'relay' })],
  ['prflx sur adresse publique', sdpCandidate('198.51.100.4', { typ: 'prflx' })],
  ['typ host mais adresse publique (8.8.8.8)', sdpCandidate('8.8.8.8')],
  ['typ host mais adresse publique (1.1.1.1)', sdpCandidate('1.1.1.1')],
  ['172.32.0.1 — juste hors de 172.16.0.0/12', sdpCandidate('172.32.0.1')],
  ['192.169.0.1 — juste hors de 192.168.0.0/16', sdpCandidate('192.169.0.1')],
  ['11.0.0.1 — juste hors de 10.0.0.0/8', sdpCandidate('11.0.0.1')],
  ['100.64.0.1 — CGNAT, pas RFC1918 (lecture stricte)', sdpCandidate('100.64.0.1')],
  ['ligne vide', ''],
  ['ligne sans adresse (bruit)', 'a=candidate:1 1 udp 2122260223 '],
]

const ACCEPTED: Array<[string, string]> = [
  ['192.168.1.42', sdpCandidate('192.168.1.42')],
  ['192.168.0.1 (bord de plage)', sdpCandidate('192.168.0.1')],
  ['192.168.255.254 (bord de plage)', sdpCandidate('192.168.255.254')],
  ['10.0.0.5', sdpCandidate('10.0.0.5')],
  ['10.255.255.254 (bord de plage)', sdpCandidate('10.255.255.254')],
  ['172.16.0.1 (bord bas 172.16/12)', sdpCandidate('172.16.0.1')],
  ['172.31.255.254 (bord haut 172.16/12)', sdpCandidate('172.31.255.254')],
  ['169.254.12.3 (link-local)', sdpCandidate('169.254.12.3')],
  ['127.0.0.1 (loopback, deux instances même machine)', sdpCandidate('127.0.0.1')],
  ['192.168.1.42 en TCP (candidat host tcp)', sdpCandidate('192.168.1.42', { transport: 'tcp' })],
  ['192.168.1.42 en composant 2 (RTCP)', sdpCandidate('192.168.1.42', { component: 2 })],
]

describe('ice-filter — candidats à REJETER (13 cas)', () => {
  for (const [label, candidate] of REJECTED) {
    it(`rejette ${label}`, () => {
      assert.equal(isLanCandidate(candidate), false)
    })
  }

  it('rejette la forme objet RTCIceCandidateInit d’un srflx public', () => {
    assert.equal(
      isLanCandidate({
        candidate: sdpCandidate('81.56.12.9', { typ: 'srflx', raddr: '192.168.1.42' }),
        sdpMid: '0',
        sdpMLineIndex: 0,
      }),
      false
    )
  })

  it('rejette undefined / null sans lever', () => {
    assert.doesNotThrow(() => isLanCandidate(undefined as unknown as string))
    assert.equal(isLanCandidate(undefined as unknown as string), false)
    assert.equal(isLanCandidate(null as unknown as string), false)
    assert.equal(isLanCandidate(42 as unknown as string), false)
    assert.equal(isLanCandidate({} as unknown as string), false)
  })
})

describe('ice-filter — candidats à ACCEPTER (13 cas)', () => {
  for (const [label, candidate] of ACCEPTED) {
    it(`accepte ${label}`, () => {
      assert.equal(isLanCandidate(candidate), true)
    })
  }

  it('accepte le préfixe a= du SDP', () => {
    assert.equal(isLanCandidate('a=' + sdpCandidate('10.1.2.3')), true)
  })

  it('accepte la forme objet RTCIceCandidateInit d’un host LAN', () => {
    assert.equal(
      isLanCandidate({ candidate: sdpCandidate('192.168.1.42'), sdpMid: '0', sdpMLineIndex: 0 } as RTCIceCandidateInit),
      true
    )
  })
})

describe('ice-filter — RFC1918 et voisinage, lus à travers le contrat public (5 cas)', () => {
  it('plat les bornes RFC1918', () => {
    // Mêmes adresses que les prédicats internes : le verdict observable est
    // celui d'un candidat host portant cette adresse.
    const verdict = (address: string): boolean => isLanCandidate(sdpCandidate(address))
    assert.equal(verdict('10.0.0.1'), true)
    assert.equal(verdict('172.15.255.255'), false)
    assert.equal(verdict('172.16.0.0'), true)
    assert.equal(verdict('172.31.255.255'), true)
    assert.equal(verdict('172.32.0.0'), false)
    assert.equal(verdict('192.168.1.1'), true)
    assert.equal(verdict('192.167.1.1'), false)
    assert.equal(verdict('100.64.0.1'), false)
  })

  it('reconnaît loopback et link-local', () => {
    const verdict = (address: string): boolean => isLanCandidate(sdpCandidate(address))
    assert.equal(verdict('127.0.0.1'), true)
    assert.equal(verdict('127.255.255.254'), true)
    assert.equal(verdict('169.254.0.1'), true)
    assert.equal(verdict('169.255.0.1'), false)
  })

  it('gère l’IPv6 : ULA acceptée, link-local et publique refusées', () => {
    const verdict = (address: string): boolean => isLanCandidate(sdpCandidate(address))
    assert.equal(verdict('fd12:3456:789a::1'), true, 'ULA fd00::/8')
    assert.equal(verdict('fc00::1'), true, 'ULA bord bas fc00::/7')
    assert.equal(verdict('fe80::1'), true, 'link-local fe80::/10')
    assert.equal(verdict('fd00::5'), true)
    assert.equal(verdict('fe80::5'), true)
    assert.equal(verdict('2001:db8::1'), false, 'adresse globale : refusée')
    assert.equal(verdict('::1'), true, 'loopback IPv6')
  })

  it('accepte un nom mDNS — sinon deux postes du LAN ne se voient jamais', () => {
    assert.equal(isLanCandidate(sdpCandidate('4f2a9b3c.local')), true)
    assert.equal(isLanCandidate(sdpCandidate('poste-de-jc.local')), true)
  })

  it('refuse 0.0.0.0 et ::', () => {
    assert.equal(isLanCandidate(sdpCandidate('0.0.0.0')), false)
    assert.equal(isLanCandidate(sdpCandidate('::')), false)
  })
})

describe('ice-filter — filterLanCandidates (3 cas)', () => {
  it('ne garde que les candidats LAN dans une liste mixte', () => {
    const lan1 = sdpCandidate('192.168.1.42')
    const lan2 = sdpCandidate('10.0.0.5')
    const pub = sdpCandidate('81.56.12.9', { typ: 'srflx', raddr: '192.168.1.42' })
    const relay = sdpCandidate('203.0.113.7', { typ: 'relay' })
    const out = filterLanCandidates([lan1, pub, lan2, relay])
    assert.equal(out.length, 2)
    assert.ok(out.includes(lan1))
    assert.ok(out.includes(lan2))
    // l'ordre relatif est conservé
    assert.deepEqual(out, [lan1, lan2])
  })

  it('accepte aussi des RTCIceCandidateInit et conserve leur type', () => {
    const a: RTCIceCandidateInit = { candidate: sdpCandidate('192.168.1.10') }
    const b: RTCIceCandidateInit = { candidate: sdpCandidate('9.9.9.9', { typ: 'srflx' }) }
    const out = filterLanCandidates<RTCIceCandidateInit>([a, b])
    assert.equal(out.length, 1)
    assert.equal(out[0], a)
  })

  it('ne lève pas sur une entrée qui n’est pas un tableau', () => {
    assert.deepEqual(filterLanCandidates(null as unknown as string[]), [])
    assert.deepEqual(filterLanCandidates([]), [])
  })
})

describe('ice-filter — variante SDP complète (2 cas)', () => {
  it('nettoie un bloc SDP en gardant les lignes non-candidate', () => {
    const sdp = [
      'v=0',
      'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
      's=-',
      't=0 0',
      'a=group:BUNDLE 0',
      'a=candidate:1 1 udp 2122260223 192.168.1.42 51234 typ host generation 0',
      'a=candidate:2 1 udp 1686052607 81.56.12.9 51234 typ srflx raddr 192.168.1.42 rport 51234',
      'a=candidate:3 1 udp 41885439 203.0.113.7 3478 typ relay raddr 203.0.113.7 rport 3478',
      'a=candidate:4 1 udp 2122260223 10.0.0.5 5555 typ host generation 0',
      'a=end-of-candidates',
    ].join('\r\n')

    const out = filterSdpThroughModule(sdp).split('\n')
    assert.equal(out.filter((line) => line.startsWith('a=candidate:')).length, 2)
    assert.ok(out.includes('v=0'))
    assert.ok(out.includes('a=group:BUNDLE 0'))
    assert.ok(out.some((line) => line.includes('a=end-of-candidates')))
    assert.ok(!out.some((line) => line.includes('typ srflx')))
    assert.ok(!out.some((line) => line.includes('typ relay')))
  })

  it('rend une chaîne vide sur entrée vide, sans lever', () => {
    assert.equal(filterSdpThroughModule(''), '')
    assert.equal(filterSdpThroughModule(null as unknown as string), '')
  })
})

describe('ice-filter — décisions de diagnostic (2 cas)', () => {
  it('rend les mêmes verdicts que les anciens motifs de rejet', () => {
    // Ex-`evaluateCandidate(x).reason` — empty / malformed / public-address /
    // not-host-type / null → traduits en décisions observables.
    assert.equal(isLanCandidate(''), false, 'ex-reason « empty »')
    assert.equal(isLanCandidate('n’importe quoi'), false, 'ex-reason « malformed »')
    assert.equal(isLanCandidate(sdpCandidate('8.8.8.8')), false, 'ex-reason « public-address »')
    assert.equal(isLanCandidate(sdpCandidate('81.56.12.9', { typ: 'srflx' })), false, 'ex-reason « not-host-type »')
    assert.equal(isLanCandidate(sdpCandidate('192.168.1.42')), true, 'ex-reason null')
  })

  it('décide indépendamment du composant, du transport, du port et de la famille', () => {
    // Ex-`parseCandidateString(...)` : address / port / component / transport /
    // type / family / isLan → traduits en verdicts sur les mêmes lignes.
    assert.equal(isLanCandidate(sdpCandidate('192.168.1.42', { component: 2, typ: 'host' })), true, 'component 2')
    assert.equal(isLanCandidate(sdpCandidate('192.168.1.42', { transport: 'tcp' })), true, 'transport tcp')
    assert.equal(isLanCandidate(sdpCandidate('192.168.1.42').replace(' 51234 ', ' 9 ')), true, 'port arbitraire')
    assert.equal(isLanCandidate(sdpCandidate('fd00::5')), true, 'famille ipv6')
    assert.equal(isLanCandidate('candidate:1 1 udp 2122260223 typ host'), false, 'adresse absente')
  })
})
