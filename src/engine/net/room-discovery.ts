/**
 * src/engine/net/room-discovery.ts — découverte des salons : parseur + registre (Carillon)
 *
 * CE QUE CE MODULE FAIT
 *   • il TRANSFORME une annonce mDNS déjà résolue (`MdnsRecordLike` : nom, hôte,
 *     port, TXT) en `RoomSummaryDto` — ou en `null` si l'annonce est inexploitable ;
 *   • il tient un REGISTRE en mémoire des salons vus : `upsert` / `remove` / `list`
 *     / `size`, avec péremption par horloge INJECTÉE et troncature à `maxRooms`.
 *
 * CE QUE CE MODULE NE FAIT PAS — délibérément, et c'est figé (SPEC-004 §3)
 *   • AUCUN réseau : pas de socket, pas d'UDP, pas de `dns-sd`, pas de `bonjour`,
 *     pas de balayage broadcast, pas de `fetch`. Il ne *découvre* rien : il reçoit
 *     des enregistrements déjà résolus. Le browse mDNS réel (bonjour-service, socket
 *     UDP 5353, interface réseau) vit dans le process principal, hors de `src/engine`.
 *   • AUCUNE horloge système, AUCUN minuteur. Le temps vient de `options.now`,
 *     injecté par l'appelant — la péremption est donc testable de façon
 *     déterministe, sans attente réelle.
 *   • AUCUN état global : tout l'état vit dans la fermeture retournée par
 *     `createRoomRegistry()`. Deux registres sont indépendants.
 *   • AUCUN identifiant persistant, aucun annuaire, aucun service tiers : le
 *     `roomId` est dérivé de l'annonce (`hôte:port`), pas d'un identifiant serveur.
 *
 * Règle « LAN uniquement » : une seule source de vérité, `isLanCandidate` de
 * `src/engine/rtc/ice-filter.ts`. On lui présente l'hôte de l'annonce sous la forme
 * d'une ligne de candidat ICE d'hôte (même procédé que `isAllowedListenHost` dans
 * local-signaling.ts) : aucune IP publique, aucun domaine public ne peut entrer.
 * Les ports acceptés sont, eux aussi, puisés à la source : `SIGNALING_BASE_PORT` /
 * `SIGNALING_PORT_RANGE` de local-signaling.ts, plus le port voix 47820.
 *
 * Toute validation qui échoue rend `null` : jamais de cast, jamais d'exception.
 *
 *   node --test tests/room-discovery.node.test.ts
 */

import { isLanCandidate } from '../rtc/ice-filter.ts'
import {
  DEFAULT_MAX_PARTICIPANTS,
  SIGNALING_BASE_PORT,
  SIGNALING_PORT_RANGE
} from './local-signaling.ts'

import type { RoomSummaryDto } from '../../shell/ipc-contract.ts'

/* ------------------------------------------------------------------ */
/* Constantes figées                                                   */
/* ------------------------------------------------------------------ */

/** Durée de validité d'une annonce dans le registre (12 s). */
export const ROOM_DISCOVERY_TTL_MS = 12_000
/** Nombre maximal de salons retenus simultanément. */
export const ROOM_DISCOVERY_MAX_ROOMS = 16
/** Port du service de voix annoncé en mDNS. */
export const ROOM_VOICE_PORT = 47_820
/** Nom de repli quand l'annonce n'en porte aucun. */
export const FALLBACK_ROOM_NAME = 'Salon LAN'
/** Longueur maximale d'un nom de salon. */
export const MAX_ROOM_NAME_LENGTH = 64
/** Longueur maximale du `roomId` (`hôte:port`). */
export const MAX_ROOM_ID_LENGTH = 64
/** Longueur maximale d'un nom d'hôte acceptable. */
const MAX_HOST_LENGTH = 253
/** Priorité factice de la ligne ICE servant à interroger `isLanCandidate`. */
const HOST_CANDIDATE_PROBE_PRIORITY = 2122260223
/** Dernier port de la plage de signalisation (47821 + 10 - 1 = 47830). */
const SIGNALING_LAST_PORT = SIGNALING_BASE_PORT + SIGNALING_PORT_RANGE - 1
/** Caractères interdits dans un hôte : espaces et contrôles (injection de jetons ICE). */
const FORBIDDEN_HOST_CHARS = /[\s\u0000-\u001f\u007f]/
/**
 * Mêmes caractères, plus les contrôles C1 (`\u0080-\u009f`, dont NEL \u0085 qui
 * coupe une ligne dans certains terminaux), ramenés à UNE espace : c'est la
 * classe des caractères interdits dans un LIBELLÉ (nom de salon).
 */
const FORBIDDEN_LABEL_CHARS = /[\s\u0000-\u001f\u007f-\u009f]+/g
/** Entier décimal signé, éventuellement entouré d'espaces. */
const INTEGER_TEXT = /^[+-]?\d+$/

/* ------------------------------------------------------------------ */
/* Types publics                                                       */
/* ------------------------------------------------------------------ */

/**
 * Forme minimale d'une annonce mDNS déjà résolue (structurellement compatible
 * avec ce que rend `bonjour-service`). Le module ne sait rien de plus.
 */
export interface MdnsRecordLike {
  name: string
  host: string
  port: number
  txt?: Readonly<Record<string, string>>
}

/** Dépendances injectées : l'horloge est OBLIGATOIRE, aucune horloge système. */
export interface RoomDiscoveryOptions {
  now: () => number
  maxRooms?: number
  ttlMs?: number
}

/** Registre de salons : API figée, consommée par le process principal. */
export interface RoomRegistry {
  upsert(record: MdnsRecordLike): RoomSummaryDto | null
  remove(name: string): boolean
  list(): RoomSummaryDto[]
  size(): number
}

/* ------------------------------------------------------------------ */
/* Aides internes — pures                                              */
/* ------------------------------------------------------------------ */

/** Chaîne si la valeur en est une, `null` sinon (aucun cast). */
function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * Filtre LEXICAL de l'hôte, avant la règle LAN : non vide, pas trop long, sans
 * espace ni caractère de contrôle. Il porte sur `host` UNIQUEMENT : c'est l'hôte
 * qui est concaténé dans la ligne ICE présentée à `isLanCandidate`, donc c'est
 * l'hôte seul qui pourrait y ajouter des jetons. Le nom d'annonce et le
 * `roomName` n'entrent jamais dans cette ligne ; ils sont traités à part, par
 * `normalizeLabel` (libellé d'une seule ligne), pas par ce prédicat.
 * Ce filtre ne dit RIEN de la nature LAN de l'adresse : c'est `isLanCandidate`
 * qui tranche, et lui seul.
 */
function isWellFormedHost(host: string): boolean {
  if (host.length === 0 || host.length > MAX_HOST_LENGTH) return false
  return !FORBIDDEN_HOST_CHARS.test(host)
}

/** Vrai si l'hôte est une adresse LAN ou un nom mDNS `.local` (contrat ice-filter). */
function isLanHost(host: string): boolean {
  return isLanCandidate(`candidate:1 1 udp ${HOST_CANDIDATE_PROBE_PRIORITY} ${host} 9 typ host`)
}

/** Vrai si le port est celui d'un salon : voix 47820, ou signalisation 47821..47830. */
function isDiscoveryPort(port: number): boolean {
  if (!Number.isInteger(port)) return false
  if (port === ROOM_VOICE_PORT) return true
  return port >= SIGNALING_BASE_PORT && port <= SIGNALING_LAST_PORT
}

/** Copie les seules entrées TEXTUELLES d'un TXT mDNS (aucun cast, aucun throw). */
function readTxt(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return out
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') out[key] = entry
  }
  return out
}

/** Tronque sur des points de code (jamais au milieu d'une paire de substitution). */
function truncate(text: string, max: number): string {
  const points = Array.from(text)
  return points.length <= max ? text : points.slice(0, max).join('')
}

/**
 * Ramène un libellé à UNE ligne : toute suite de blancs ou de caractères de
 * contrôle (`\r`, `\n`, `\t`, `\u0000`, `\u0085`…) devient une espace unique.
 *
 * Pourquoi : `roomName` traverse l'IPC puis s'affiche (App.tsx, Room.tsx) et se
 * retrouve dans tout journal qui concatène le nom. Un CR/LF interne y casse un
 * libellé et injecte une ligne ; ce n'est pas une adresse, donc le prédicat de
 * l'hôte (`FORBIDDEN_HOST_CHARS`) ne s'y applique pas tel quel — on normalise
 * au lieu de rejeter, un nom d'annonce hostile ne devant pas faire disparaître
 * un salon légitime.
 */
function normalizeLabel(text: string): string {
  return text.replace(FORBIDDEN_LABEL_CHARS, ' ')
}

/**
 * `txt.roomName` sinon nom d'annonce ; vide → « Salon LAN » ; normalisé en une
 * seule ligne, puis borné à 64 points de code.
 */
function resolveRoomName(txt: Record<string, string>, recordName: string): string {
  const fromTxt = txt['roomName']
  const candidate =
    typeof fromTxt === 'string' && fromTxt.trim().length > 0 ? fromTxt : recordName
  const normalized = normalizeLabel(candidate).trim()
  if (normalized.length === 0) return FALLBACK_ROOM_NAME
  return truncate(normalized, MAX_ROOM_NAME_LENGTH).trim()
}

/** Entier de `txt.participants`, borné 0..8 (plafond figé du maillage), défaut 0. */
function resolveParticipantCount(txt: Record<string, string>): number {
  const raw = txt['participants']
  if (typeof raw !== 'string') return 0
  const value = raw.trim()
  if (!INTEGER_TEXT.test(value)) return 0
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  if (parsed >= DEFAULT_MAX_PARTICIPANTS) return DEFAULT_MAX_PARTICIPANTS
  return parsed
}

interface ParsedAnnouncement {
  /** Clé du registre : nom d'annonce normalisé (c'est lui que `remove` cible). */
  key: string
  summary: RoomSummaryDto
}

/**
 * Valide une annonce et en tire sa vue publique.
 * Chaque règle qui échoue rend `null` — jamais d'exception, jamais de valeur devinée.
 */
function parseAnnouncement(record: MdnsRecordLike): ParsedAnnouncement | null {
  if (typeof record !== 'object' || record === null) return null

  const rawName = readString(record.name)
  if (rawName === null) return null

  const rawHost = readString(record.host)
  if (rawHost === null) return null
  const host = rawHost.trim()
  if (!isWellFormedHost(host)) return null
  if (!isLanHost(host)) return null

  const port = record.port
  if (typeof port !== 'number' || !isDiscoveryPort(port)) return null

  // Identifiant stable, dérivé de l'annonce — surtout pas un identifiant serveur.
  const roomId = `${host}:${port}`
  if (roomId.length > MAX_ROOM_ID_LENGTH) return null

  const txt = readTxt(record.txt)
  const summary: RoomSummaryDto = {
    roomId,
    roomName: resolveRoomName(txt, rawName),
    host,
    port,
    participantCount: resolveParticipantCount(txt)
  }
  return { key: rawName.trim(), summary }
}

/* ------------------------------------------------------------------ */
/* API publique — parseur                                              */
/* ------------------------------------------------------------------ */

/**
 * Vue publique d'une annonce mDNS, ou `null` si l'annonce est inexploitable :
 *   • hôte qui n'est pas une adresse LAN / un nom `.local`, ou hôte malformé ;
 *   • port hors 47820 et 47821..47830 ;
 *   • `roomId` (`hôte:port`) plus long que 64 caractères.
 *
 * Pure : aucune horloge, aucun réseau, aucune mutation.
 */
export function roomSummaryFromRecord(record: MdnsRecordLike): RoomSummaryDto | null {
  const parsed = parseAnnouncement(record)
  return parsed === null ? null : parsed.summary
}

/* ------------------------------------------------------------------ */
/* API publique — registre                                             */
/* ------------------------------------------------------------------ */

function resolveTtl(value: number | undefined): number {
  if (value === undefined) return ROOM_DISCOVERY_TTL_MS
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`createRoomRegistry: ttlMs invalide (${String(value)})`)
  }
  return value
}

function resolveMaxRooms(value: number | undefined): number {
  if (value === undefined) return ROOM_DISCOVERY_MAX_ROOMS
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`createRoomRegistry: maxRooms invalide (${String(value)})`)
  }
  return Math.floor(value)
}

interface RegistryEntry {
  summary: RoomSummaryDto
  /** Instant (horloge injectée) de la dernière annonce vue. */
  seenAt: number
}

/** Ordre total déterministe : roomName, puis roomId (jamais `localeCompare`). */
function compareRooms(a: RoomSummaryDto, b: RoomSummaryDto): number {
  if (a.roomName !== b.roomName) return a.roomName < b.roomName ? -1 : 1
  if (a.roomId !== b.roomId) return a.roomId < b.roomId ? -1 : 1
  return 0
}

/**
 * Crée un registre de salons découverts.
 *
 * `options.now` est OBLIGATOIRE : le module n'a pas d'horloge à lui. Une annonce
 * est périmée dès que `now() - vuLe > ttlMs` (défaut `ROOM_DISCOVERY_TTL_MS`) ;
 * le seuil exact reste valide, il n'expire qu'au-delà.
 *
 * `list()` et `size()` purgent d'abord les annonces périmées, puis `list()` trie
 * (roomName, roomId) et tronque à `maxRooms` (défaut `ROOM_DISCOVERY_MAX_ROOMS`).
 * Une même annonce (même nom) mise à jour ne crée jamais de doublon : son
 * horodatage et sa vue sont rafraîchis en place.
 */
export function createRoomRegistry(options: RoomDiscoveryOptions): RoomRegistry {
  if (typeof options !== 'object' || options === null || typeof options.now !== 'function') {
    throw new TypeError('createRoomRegistry: options.now est obligatoire (aucune horloge système)')
  }
  const now = options.now
  const ttlMs = resolveTtl(options.ttlMs)
  const maxRooms = resolveMaxRooms(options.maxRooms)
  const entries = new Map<string, RegistryEntry>()

  /** Retire les annonces dont l'âge dépasse le TTL. Une seule lecture d'horloge. */
  function purge(): void {
    const current = now()
    for (const [key, entry] of entries) {
      if (current - entry.seenAt > ttlMs) entries.delete(key)
    }
  }

  function upsert(record: MdnsRecordLike): RoomSummaryDto | null {
    const parsed = parseAnnouncement(record)
    if (parsed === null) return null
    entries.set(parsed.key, { summary: parsed.summary, seenAt: now() })
    return parsed.summary
  }

  function remove(name: string): boolean {
    if (typeof name !== 'string') return false
    return entries.delete(name.trim())
  }

  function list(): RoomSummaryDto[] {
    purge()
    const rooms: RoomSummaryDto[] = []
    for (const entry of entries.values()) rooms.push(entry.summary)
    rooms.sort(compareRooms)
    return rooms.slice(0, maxRooms)
  }

  function size(): number {
    purge()
    return entries.size
  }

  return { upsert, remove, list, size }
}
