/**
 * src/engine/rtc/ice-filter.ts — filtre « ICE LAN uniquement » (Carillon)
 *
 * SPEC-001 CA7 / critère bloquant B3 :
 *   seuls les candidats ICE d'hôte (typ host) portant une adresse du réseau
 *   local (RFC1918, link-local, loopback, ULA IPv6, nom mDNS *.local) sont
 *   conservés ; tout candidat srflx / prflx / relay, ou d'adresse publique,
 *   est rejeté.
 *
 * Contraintes (SPEC-004 §3) : module pur.
 *   - aucun import (ni electron, ni ws, ni node:*, ni rien) ;
 *   - aucun timer, aucun fetch, aucun état global mutable ;
 *   - syntaxe TypeScript effaçable uniquement (pas d'enum, pas de namespace).
 *
 * Exports (contrat gelé) :
 *   isLanCandidate(candidate)      → boolean
 *   filterLanCandidates(candidates) → T[]
 */

/**
 * Forme minimale d'un candidat ICE : les champs de `RTCIceCandidateInit` qu'un
 * appelant peut présenter. Déclarée localement et NON exportée : le module
 * n'expose que les deux fonctions du contrat.
 *
 * `sdpMid` et `sdpMLineIndex` sont déclarés pour que le type soit réellement
 * structurellement compatible avec `RTCIceCandidateInit` (un objet littéral
 * portant ces champs doit être accepté), mais la décision LAN ne lit QUE
 * `candidate` : le rattachement à une m-line ne dit rien de l'adresse ni du
 * type de candidat. Ces deux champs sont donc ignorés, volontairement.
 */
interface IceCandidateLike {
  candidate?: string
  readonly sdpMid?: string | null
  readonly sdpMLineIndex?: number | null
}

/** Suffixe des noms d'hôtes mDNS (« 3f2a-…-9c.local »). */
const MDNS_SUFFIX = '.local'

/** Découpe une ligne SDP en jetons (espaces/tabulations multiples tolérés). */
function tokenize(line: string): string[] {
  return line.split(/[ \t\r\n\v\f]+/).filter((token) => token.length > 0)
}

/** Retire un éventuel préfixe SDP « a= ». */
function stripSdpPrefix(line: string): string {
  return line.startsWith('a=') ? line.slice(2) : line
}

/**
 * Octets d'une IPv4 pointée, ou null si ce n'est pas une IPv4 valide.
 * Rend un quadruplet (et non `number[]`) : les quatre octets sont garantis par
 * le test `parts.length !== 4`, ce que `noUncheckedIndexedAccess` ne peut pas
 * déduire d'un tableau.
 */
function parseIpv4(address: string): [number, number, number, number] | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  const octets: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const value = Number(part)
    if (value > 255) return null
    octets.push(value)
  }
  const [a, b, c, d] = octets
  if (a === undefined || b === undefined || c === undefined || d === undefined) {
    return null
  }
  return [a, b, c, d]
}

/**
 * IPv4 « LAN » au sens strict de la SPEC-001 :
 * 10/8, 172.16/12 (172.16.0.0 → 172.31.255.255), 192.168/16,
 * 169.254/16 (link-local), 127/8 (loopback).
 * 100.64/10 (CGNAT), 172.32/16, 192.169/16, 11/8 → rejetés.
 */
function isLanIpv4(address: string): boolean {
  const octets = parseIpv4(address)
  if (octets === null) return false
  const [a, b] = octets
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  if (a === 127) return true
  return false
}

/** Premier hextet non vide d'une IPv6 (zone « %eth0 » ignorée). */
function firstHextet(address: string): number | null {
  // `split` rend toujours au moins un élément : le repli n'est là que pour le type.
  const bare = address.split('%')[0] ?? address
  for (const segment of bare.split(':')) {
    if (segment.length === 0) continue
    if (!/^[0-9a-f]{1,4}$/.test(segment)) return null
    return parseInt(segment, 16)
  }
  return 0
}

/**
 * IPv6 « LAN » : loopback ::1, link-local fe80::/10, ULA fc00::/7.
 * Toute adresse globale (2001:db8::1, 2606:…) → rejetée.
 */
function isLanIpv6(address: string): boolean {
  let bare = address.toLowerCase()
  if (bare.startsWith('[') && bare.endsWith(']')) bare = bare.slice(1, -1)
  if (bare.length === 0) return false
  if (!bare.includes(':')) return false
  const withoutZone = bare.split('%')[0] ?? bare
  if (withoutZone === '::1') return true
  if (/^0{1,4}(:0{1,4}){6}:0{0,4}1?$/.test(withoutZone)) return true
  const hextet = firstHextet(withoutZone)
  if (hextet === null) return false
  if ((hextet & 0xffc0) === 0xfe80) return true // link-local fe80::/10
  if ((hextet & 0xfe00) === 0xfc00) return true // ULA fc00::/7
  return false
}

/**
 * Adresse acceptée pour un candidat host :
 * IP du réseau local, ou nom d'hôte mDNS « *.local » (découverte LAN,
 * aucune fuite : c'est un nom, pas une IP — donc pas de parsing IP dessus).
 */
function isLanAddress(address: string): boolean {
  const value = address.trim()
  if (value.length === 0) return false
  const lower = value.toLowerCase()
  if (lower.endsWith(MDNS_SUFFIX)) return lower.length > MDNS_SUFFIX.length
  if (value.includes(':')) return isLanIpv6(value)
  return isLanIpv4(value)
}

/**
 * Extrait adresse et type d'une ligne de candidat ICE :
 *   candidate:<foundation> <component> <transport> <priority> <ip> <port>
 *     typ <type> [raddr <ip> rport <port>] [ext…]
 * Retourne null si la ligne est vide / invalide / sans adresse.
 */
function parseCandidate(line: string): { address: string; type: string } | null {
  const tokens = tokenize(stripSdpPrefix(line))
  // candidat + composant + transport + priorité + adresse + port = 6 minimum
  if (tokens.length < 6) return null
  const first = tokens[0]
  if (first === undefined || !first.startsWith('candidate:')) return null
  const typeIndex = tokens.indexOf('typ')
  if (typeIndex < 0 || typeIndex + 1 >= tokens.length) return null
  const address = tokens[4]
  const type = tokens[typeIndex + 1]
  if (address === undefined || type === undefined) return null
  return { address, type: type.toLowerCase() }
}

/**
 * Vrai si le candidat est un hôte sur le réseau local.
 * Tolérant sur la forme (ligne SDP « candidate:… », ligne préfixée « a= »,
 * objet RTCIceCandidateInit, chaîne vide, null, undefined) : tout ce qui
 * n'est pas un hôte LAN exploitable vaut false.
 */
export function isLanCandidate(
  candidate: string | IceCandidateLike | null | undefined
): boolean {
  if (candidate === null || candidate === undefined) return false

  let line: string
  if (typeof candidate === 'string') {
    line = candidate
  } else if (typeof candidate === 'object') {
    const inner = candidate.candidate
    if (typeof inner !== 'string') return false
    line = inner
  } else {
    return false
  }

  const parsed = parseCandidate(line)
  if (parsed === null) return false
  // Seul « host » est retenu : srflx, prflx, relay (TURN) = aller hors LAN.
  if (parsed.type !== 'host') return false
  return isLanAddress(parsed.address)
}

/** Ne conserve que les candidats LAN d'une liste, dans l'ordre d'origine. */
export function filterLanCandidates<T extends string | IceCandidateLike>(
  candidates: T[]
): T[] {
  if (!Array.isArray(candidates)) return []
  return candidates.filter((candidate) => isLanCandidate(candidate))
}
