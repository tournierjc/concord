/**
 * signaling-link.ts — le TUYAU de signalisation (T16b / SPEC-007 §4.3).
 *
 * Un serveur TCP (`node:net`) et son client, cadrés en **lignes JSON** : une ligne = un message du
 * protocole de `src/engine/net/local-signaling.ts`, dont la sémantique est réutilisée telle quelle
 * (`join` / `offer` / `answer` / `ice` / `leave`, plafond de pairs, refus explicites). Ce fichier
 * n'invente donc pas un second protocole : il ne fait que **porter** les octets.
 *
 * Règles non négociables, chacune falsifiable par un test :
 *  1. **Jamais d'écoute large.** L'adresse d'écoute passe `isAllowedListenHost` : `0.0.0.0`, `::`,
 *     `*`, `any` et toute adresse publique sont refusés AVANT `listen()` — on refuse de démarrer
 *     plutôt que d'écouter large. Repli de port uniquement 47821 → 47830, et un refus explicite si
 *     les dix sont occupés.
 *  2. **Bornes.** Une ligne de plus de 64 Ko ferme la connexion avec un refus explicite ; un JSON
 *     invalide est refusé de la même manière. Aucune de ces deux entrées ne fait tomber le process.
 *  3. **ICE filtré.** Tout candidat, à l'émission comme à la réception, passe
 *     `src/engine/rtc/ice-filter.ts` : un candidat hors LAN ne sort pas et n'entre pas.
 *  4. **Aucune exception qui fuit** : tout échec devient un message `link` (`refused`/`closed`) avec
 *     une raison lisible — c'est ce que l'écran affiche.
 *
 * L'identité attribuée par le serveur (`selfId`) est publiée dans `link.detail` : le renderer n'a
 * pas besoin d'un canal de plus, et il connaît déjà son identité locale (`localId`).
 */

import { connect, createServer, type Server, type Socket } from 'node:net';

import {
  createLocalSignaling,
  isAllowedListenHost,
  isRefuseCode,
  SIGNALING_BASE_PORT,
  SIGNALING_PORT_RANGE,
  type AvatarGetSuccess,
  type ClientMessage,
  type LocalSignaling,
  type ServerMessage,
  type SocketLike,
} from '../engine/net/local-signaling';
import { isLanCandidate } from '../engine/rtc/ice-filter';
import { isAvatarRef } from '../shell/avatar';
import { AVATAR_WIRE_BASE64_MAX_CHARS, encodeAvatarPngForWire, type AvatarStore } from './avatar-store';
import { systemTimers, type MainTimers } from './timers';
import { SIGNAL_MAX_LINE_BYTES, type SignalIn, type SignalOut } from '../shell/ipc-contract';

/** Longueur maximale d'une ligne JSON (SPEC-007 §4.3) : au-delà, la connexion est fermée. */
export const MAX_LINE_BYTES = SIGNAL_MAX_LINE_BYTES;

/** Délai de connexion du client avant refus explicite. */
export const CONNECT_TIMEOUT_MS = 5000;

export interface SignalingLinkOptions {
  /** `host` : écoute + rejoint son propre salon ; `client` : rejoint l'hôte indiqué. */
  role: 'host' | 'client';
  /** Identité locale (journal seulement : le fil ne transporte aucun identifiant persistant). */
  localId: string;
  /** Nom publié dans le salon (≤ 32 caractères, comme le protocole). */
  name: string;
  /** Adresse d'écoute (hôte) ou adresse de l'hôte (client) : LAN ou loopback, jamais large. */
  host: string;
  /** Client : port de l'hôte (défaut 47821). Hôte : premier port essayé. */
  port?: number;
  maxPeers?: number;
  /** Horloge injectée (l'engine interdit `Date.now`, le main la fournit). */
  now: () => number;
  onMessage: (message: SignalIn) => void;
  timeoutMs?: number;
  /** Empreinte d'avatar annoncée au `join` (SPEC-002, amendement 2026-10-31) ; absente = initiales. */
  avatarRef?: string;
  /** Le magasin d'images locales (hôte uniquement) : répond aux `avatar_get` des pairs. */
  avatarStore?: AvatarStore;
  /**
   * Demande `avatar_get` reçue d'un pair (hôte uniquement — c'est le serveur qui la reconnaît).
   * Le main répond via `avatarStore` et le lien écrit la réponse sur la connexion du demandeur.
   */
  onAvatarGet?: (request: { from: string; to: string; avatarRef: string }) => void;
  /** Minuteur injecté (SPEC-012 §4) : le délai de connexion passe par `src/main/timers.ts`. */
  timers?: MainTimers;
  /**
   * Appelé une fois, quand un port a réellement été écouté (rôle hôte uniquement).
   *
   * Le port DEMANDÉ n'est qu'une préférence : `SIGNALING_PORT_RANGE` ports sont essayés à la suite.
   * Un hôte doit donc annoncer celui qu'il écoute vraiment (SPEC-001 A5) — c'est ce que ce rappel
   * permet, sans scrutation ni délai arbitraire.
   */
  onListen?: (listen: { host: string; port: number }) => void;
}

export interface SignalingLinkStats {
  lines: number;
  filteredCandidates: number;
  refused: number;
  oversize: number;
  malformed: number;
}

export interface SignalingLink {
  readonly role: 'host' | 'client';
  /** Adresse réellement écoutée (hôte) ; `null` en client ou si le lien a refusé de démarrer. */
  readonly listen: { host: string; port: number } | null;
  /** Identité attribuée par le serveur, connue après le `hello`. */
  readonly selfId: string | null;
  readonly stats: SignalingLinkStats;
  send(message: SignalOut): void;
  /**
   * Réclame l'image d'une empreinte inconnue au pair qui l'a annoncée (SPEC-002, amendement
   * 2026-10-31). La réponse revient par `onMessage` sous `{ kind: 'avatar-data' }` — `data: null`
   * si le pair ne la connaît pas. Un lien fermé ne demande rien.
   */
  requestAvatar(to: string, avatarRef: string): void;
  /**
   * Réponse à un `avatar_get` reçu d'un pair (SPEC-002, amendement 2026-10-31). Le main fournit le
   * PNG déjà encodé, ou `null` (empreinte inconnue, fichier absent). L'acheminement — socket du
   * demandeur côté hôte, aller-retour par le serveur côté client — appartient au lien.
   */
  answerAvatarGet(request: { from: string; to: string; avatarRef: string }, pngBase64: string | null): void;
  close(detail?: string): void;
}

/* ------------------------------------------------------------------ */
/* Choix de l'adresse d'écoute — pur, testable sans réseau             */
/* ------------------------------------------------------------------ */

/** Forme minimale d'une entrée de `os.networkInterfaces()` (injectable en test). */
export interface InterfaceLike {
  address: string;
  family: string | number;
  internal: boolean;
}

/**
 * Rend l'adresse d'écoute du lien : la première adresse IPv4 privée (RFC1918) non interne, et le
 * loopback à défaut. Aucune autre valeur ne sort d'ici : `0.0.0.0`, `::` et les adresses publiques
 * ne sont jamais des candidats, donc le lien ne peut pas écouter large par accident.
 */
export function pickListenHost(interfaces: Record<string, InterfaceLike[] | undefined>): string {
  const sorted = Object.keys(interfaces).sort((a, b) => a.localeCompare(b));
  for (const name of sorted) {
    for (const entry of interfaces[name] ?? []) {
      const isV4 = entry.family === 'IPv4' || entry.family === 4;
      if (!isV4 || entry.internal) continue;
      if (!isAllowedListenHost(entry.address)) continue;
      // Une adresse de lien-local (169.254/16) n'est pas un réseau local utile : on l'ignore.
      if (entry.address.startsWith('169.254.')) continue;
      return entry.address;
    }
  }
  return '127.0.0.1';
}

/* ------------------------------------------------------------------ */
/* Encodage / décodage — purs, donc testables sans socket              */
/* ------------------------------------------------------------------ */

function asText(payload: unknown): string | null {
  if (typeof payload === 'string') return payload.length > 0 ? payload : null;
  return null;
}

function asCandidate(payload: unknown): string | null {
  if (typeof payload === 'string') return payload.length > 0 ? payload : null;
  if (payload !== null && typeof payload === 'object') {
    const inner = (payload as { candidate?: unknown }).candidate;
    return typeof inner === 'string' && inner.length > 0 ? inner : null;
  }
  return null;
}

/**
 * Traduit un `SignalOut` du contrat en message de protocole.
 *
 * Rend `null` quand rien ne doit sortir : charge utile inexploitable, ou candidat ICE hors LAN.
 * Le second cas n'est pas une erreur — c'est le filtre LAN qui fait son travail.
 */
export function toWire(message: SignalOut): ClientMessage | null {
  if (message.kind === 'leave') return { type: 'leave' };
  const to = typeof message.to === 'string' ? message.to : '';
  if (to.length === 0) return null;
  if (message.kind === 'offer' || message.kind === 'answer') {
    const sdp = asText(message.payload);
    if (sdp === null) return null;
    return { type: message.kind, to, sdp };
  }
  const candidate = asCandidate(message.payload);
  if (candidate === null) return null;
  // Filtre LAN AVANT l'émission : un srflx/relay/d'adresse publique ne sort jamais.
  if (!isLanCandidate(candidate)) return null;
  return { type: 'ice', to, candidate };
}

/** Rend la charge utile d'un candidat relayé : la chaîne, ou l'objet JSON si elle en est un. */
export function decodeCandidatePayload(candidate: string): unknown {
  const trimmed = candidate.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed !== null && typeof parsed === 'object') return parsed;
    } catch {
      // Pas du JSON : la chaîne de candidat repart telle quelle.
    }
  }
  return candidate;
}

/**
 * Texte de candidat réellement filtrable : la ligne SDP, y compris quand elle voyage emballée
 * dans un JSON (`{ candidate, sdpMid, sdpMLineIndex }`) — sinon `isLanCandidate` verrait un
 * objet sérialisé et refuserait TOUT candidat emballé.
 */
export function candidateText(candidate: string): string {
  const trimmed = candidate.trim();
  if (!trimmed.startsWith('{')) return candidate;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed !== null && typeof parsed === 'object') {
      const inner = (parsed as { candidate?: unknown }).candidate;
      if (typeof inner === 'string') return inner;
    }
  } catch {
    // JSON invalide : la chaîne brute est filtrée telle quelle.
  }
  return candidate;
}

/** Traduit un message serveur en `SignalIn` ; `null` si le message est hors contrat. */
export function fromWire(message: ServerMessage): SignalIn | null {
  switch (message.type) {
    case 'offer':
    case 'answer': {
      if (typeof message.from !== 'string' || typeof message.sdp !== 'string') return null;
      return { kind: message.type, from: message.from, payload: message.sdp };
    }
    case 'ice': {
      if (typeof message.from !== 'string' || typeof message.candidate !== 'string') return null;
      // Filtre LAN à l'ENTRÉE : un pair mal configuré ne fait pas entrer un candidat hors LAN.
      if (!isLanCandidate(candidateText(message.candidate))) return null;
      return { kind: 'ice', from: message.from, payload: decodeCandidatePayload(message.candidate) };
    }
    case 'avatar_data': {
      // Réponse à notre `avatar_get` : le PNG validé par l'empreinte remonte au renderer, qui
      // l'affiche. Un `null` (empreinte inconnue du répondant) est une réponse HONNÊTE : le
      // renderer garde les initiales — mais ce n'est pas une faute de contrat, ça se relaie.
      if (typeof message.from !== 'string' || message.from.length === 0) return null;
      if (!isAvatarRef(message.avatarRef)) return null;
      if (message.pngBase64 !== null && typeof message.pngBase64 !== 'string') return null;
      return { kind: 'avatar-data', from: message.from, avatarRef: message.avatarRef, data: message.pngBase64 };
    }

    case 'join':
      if (message.peer === undefined) return null;
      return {
        kind: 'peer-joined',
        peerId: message.peer.peerId,
        name: message.peer.name,
        ...(message.peer.avatarRef !== undefined ? { avatarRef: message.peer.avatarRef } : {}),
      };
    case 'leave':
      if (typeof message.peerId !== 'string') return null;
      return { kind: 'peer-left', peerId: message.peerId };
    default:
      return null;
  }
}

/**
 * Nombre maximal de pairs acceptés dans un `hello`. Notre propre hôte en annonce au plus
 * `maxParticipants - 1` (7 par défaut) : cette borne est large, et surtout *finie* — un hôte hostile
 * ne fait pas allouer une liste de plusieurs centaines de milliers d'entrées.
 */
export const MAX_PEERS_PER_HELLO = 64;

/** Ligne JSON décodée : un objet (ni `null`, ni tableau). */
function isMessageObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Résumé de pair d'un `hello`/`join`, ou `null` si le champ n'en est pas un. */
function asPeerSummary(value: unknown): { peerId: string; name: string; avatarRef?: string } | null {
  if (!isMessageObject(value)) return null;
  const peerId = value.peerId;
  if (typeof peerId !== 'string' || peerId.length === 0) return null;
  const name = value.name;
  if (name !== undefined && typeof name !== 'string') return null;
  // Empreinte d'avatar (SPEC-002 amendement 2026-10-31) : soit absente, soit sous sa forme exacte.
  // Une chaîne arbitraire est une ligne HORS CONTRAT, pas une empreinte : la ligne entière tombe.
  const rawRef = value.avatarRef;
  if (rawRef !== undefined && !isAvatarRef(rawRef)) return null;
  return {
    peerId,
    name: typeof name === 'string' ? name : '',
    ...(typeof rawRef === 'string' ? { avatarRef: rawRef } : {}),
  };
}

/**
 * Parse une ligne serveur sans jamais lever : `null` = ligne hors contrat.
 *
 * VALIDATION STRICTE, CHAMP PAR CHAMP. Ne vérifier que `type` laissait passer tout le reste :
 * `{"type":"hello","peers":[null]}` traversait le parseur, puis `peer.peerId` levait un `TypeError`
 * DANS le gestionnaire `data` de la socket — hors de tout `try` — et tuait le process principal.
 * Un hôte hostile (ou simplement bogué) suffisait donc à faire tomber l'application d'en face, sur
 * le chemin de connexion. Ici, une ligne non conforme est comptée (`stats.malformed`) et ignorée :
 * la liaison reste utilisable pour les lignes saines qui suivent.
 */
export function parseServerLine(line: string): ServerMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isMessageObject(parsed)) return null;

  const type = parsed.type;
  if (typeof type !== 'string') return null;

  switch (type) {
    case 'hello': {
      if (typeof parsed.peerId !== 'string' || parsed.peerId.length === 0) return null;
      const rawPeers = parsed.peers;
      if (rawPeers !== undefined && !Array.isArray(rawPeers)) return null;
      const peers: Array<{ peerId: string; name: string; avatarRef?: string }> = [];
      for (const entry of rawPeers ?? []) {
        // Au-delà de la borne : la ligne entière est refusée, on n'en garde pas une moitié.
        if (peers.length >= MAX_PEERS_PER_HELLO) return null;
        const peer = asPeerSummary(entry);
        if (peer === null) return null;
        peers.push(peer);
      }
      const maxParticipants = parsed.maxParticipants;
      if (typeof maxParticipants !== 'number' || !Number.isFinite(maxParticipants)) return null;
      return {
        type: 'hello',
        peerId: parsed.peerId,
        name: typeof parsed.name === 'string' ? parsed.name : '',
        maxParticipants: Math.trunc(maxParticipants),
        peers,
      };
    }
    case 'join': {
      const peer = asPeerSummary(parsed.peer);
      if (peer === null) return null;
      return { type: 'join', peer };
    }
    case 'leave': {
      if (typeof parsed.peerId !== 'string' || parsed.peerId.length === 0) return null;
      return { type: 'leave', peerId: parsed.peerId };
    }
    case 'offer':
    case 'answer': {
      if (typeof parsed.from !== 'string' || typeof parsed.sdp !== 'string') return null;
      if (typeof parsed.to !== 'string') return null;
      return type === 'offer'
        ? { type: 'offer', from: parsed.from, to: parsed.to, sdp: parsed.sdp }
        : { type: 'answer', from: parsed.from, to: parsed.to, sdp: parsed.sdp };
    }
    case 'ice': {
      if (typeof parsed.from !== 'string' || typeof parsed.candidate !== 'string') return null;
      if (typeof parsed.to !== 'string') return null;
      return { type: 'ice', from: parsed.from, to: parsed.to, candidate: parsed.candidate };
    }
    case 'avatar_data': {
      // La réponse à notre `avatar_get` (SPEC-002, amendement 2026-10-31). Bornes : empreinte sous
      // sa forme exacte ; base64 borné pour que la ligne reste sous les 64 Ko du protocole ; et
      // signature PNG revérifiée APRÈS décodage — un contenu qui ne serait pas le PNG annoncé est
      // une ligne hors contrat (comptée `malformed`), jamais une image.
      if (typeof parsed.from !== 'string' || parsed.from.length === 0) return null;
      if (typeof parsed.to !== 'string') return null;
      if (!isAvatarRef(parsed.avatarRef)) return null;
      const pngBase64 = parsed.pngBase64;
      if (pngBase64 === null) return { type: 'avatar_data', from: parsed.from, to: parsed.to, avatarRef: parsed.avatarRef, pngBase64: null };
      if (typeof pngBase64 !== 'string' || pngBase64.length === 0 || pngBase64.length > AVATAR_WIRE_BASE64_MAX_CHARS) return null;
      let png: Buffer;
      try {
        png = Buffer.from(pngBase64, 'base64');
      } catch {
        return null;
      }
      if (png.byteLength < 8 || png[0] !== 0x89 || png[1] !== 0x50 || png[2] !== 0x4e || png[3] !== 0x47) return null;
      return { type: 'avatar_data', from: parsed.from, to: parsed.to, avatarRef: parsed.avatarRef, pngBase64 };
    }
    case 'refuse': {
      const code = parsed.code;
      if (!isRefuseCode(code)) return null;
      if (typeof parsed.reason !== 'string') return null;
      return { type: 'refuse', code, reason: parsed.reason };
    }
    case 'bye': {
      if (typeof parsed.reason !== 'string') return null;
      return { type: 'bye', reason: parsed.reason };
    }
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Lecture ligne par ligne, bornée                                     */
/* ------------------------------------------------------------------ */

interface LineReader {
  push(chunk: string): void;
}

function readLines(
  socket: Socket,
  onLine: (line: string) => void,
  onOverflow: (bytes: number) => void,
): LineReader {
  let buffer = '';
  let closed = false;
  return {
    push(chunk: string): void {
      if (closed) return;
      buffer += chunk;
      for (;;) {
        const index = buffer.indexOf('\n');
        if (index === -1) break;
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        if (line.length > 0) onLine(line);
      }
      if (Buffer.byteLength(buffer, 'utf8') > MAX_LINE_BYTES) {
        closed = true;
        buffer = '';
        onOverflow(MAX_LINE_BYTES);
      }
    },
  };
}

function refuseLine(detail: string): string {
  return JSON.stringify({ type: 'refuse', code: 'invalid-message', reason: detail });
}

/* ------------------------------------------------------------------ */
/* Le lien                                                            */
/* ------------------------------------------------------------------ */

export function createSignalingLink(options: SignalingLinkOptions): SignalingLink {
  const role = options.role;
  const name = options.name.slice(0, 32);
  // Empreinte validée AVANT d'être annoncée : une forme douteuse compte comme « pas d'avatar ».
  const avatarRef = typeof options.avatarRef === 'string' && isAvatarRef(options.avatarRef) ? options.avatarRef : undefined;
  const maxPeers = options.maxPeers;
  const timeoutMs = options.timeoutMs ?? CONNECT_TIMEOUT_MS;
  const timers = options.timers ?? systemTimers;
  const basePort = options.port ?? SIGNALING_BASE_PORT;
  const stats: SignalingLinkStats = {
    lines: 0,
    filteredCandidates: 0,
    refused: 0,
    oversize: 0,
    malformed: 0,
  };

  let server: Server | null = null;
  let signaling: LocalSignaling | null = null;
  let outbound: Socket | null = null;
  let listen: { host: string; port: number } | null = null;
  let selfId: string | null = null;
  let closed = false;
  let connected = false;

  function emit(message: SignalIn): void {
    try {
      options.onMessage(message);
    } catch {
      // Un consommateur qui lève ne doit pas casser le transport.
    }
  }

  function emitLink(state: 'connecting' | 'connected' | 'refused' | 'closed', detail: string | null = null): void {
    // `detail` est TOUJOURS présent (null si aucune raison) : le renderer n'a pas à distinguer
    // « champ absent » de « pas de raison », conformément à SPEC-007 §4.1 (contrat figé).
    emit({ kind: 'link', state, detail });
  }

  function refuse(detail: string): void {
    if (closed) return;
    stats.refused += 1;
    closed = true;
    emitLink('refused', detail);
  }

  function joinRequest(): string {
    return JSON.stringify(
      avatarRef === undefined
        ? ({ type: 'join', name } satisfies ClientMessage)
        : ({ type: 'join', name, avatarRef } satisfies ClientMessage),
    );
  }

  function handleServerRefuse(message: { code: string; reason: string }): void {
    if (message.code === 'room-full' || message.code === 'closed' || message.code === 'not-joined') {
      refuse(`lien refusé par l'hôte (${message.code}) : ${message.reason}`);
      outbound?.destroy();
      return;
    }
    if (message.code === 'off-lan') {
      // Un candidat hors LAN a été bloqué côté serveur : il ne compte pas comme un refus de lien.
      stats.filteredCandidates += 1;
      return;
    }
    stats.malformed += 1;
  }

  function handleServerMessage(raw: string): void {
    stats.lines += 1;
    const message = parseServerLine(raw);
    if (message === null) {
      stats.malformed += 1;
      return;
    }
    if (message.type === 'hello') {
      selfId = message.peerId;
      connected = true;
      emitLink('connected', `pair=${message.peerId} port=${listen?.port ?? basePort}`);
      for (const peer of message.peers ?? []) {
        emit({
          kind: 'peer-joined',
          peerId: peer.peerId,
          name: peer.name,
          ...(peer.avatarRef !== undefined ? { avatarRef: peer.avatarRef } : {}),
        });
      }
      return;
    }
    if (message.type === 'refuse') {
      handleServerRefuse({ code: message.code, reason: message.reason });
      return;
    }
    if (message.type === 'bye') {
      closed = true;
      emitLink('closed', `l'hôte a fermé le salon : ${message.reason}`);
      return;
    }
    if (message.type === 'ice' && !isLanCandidate(candidateText(message.candidate))) {
      stats.filteredCandidates += 1;
      return;
    }
    const incoming = fromWire(message);
    if (incoming === null) {
      stats.malformed += 1;
      return;
    }
    emit(incoming);
  }

  /** Ouvre le socket sortant (le nôtre) vers `host:port` et s'annonce. */
  function dial(host: string, port: number): void {
    const socket = connect({ host, port });
    outbound = socket;
    // `timers.once` arme l'`unref` lui-même : une tentative de lien ne retient pas le processus.
    const timer = timers.once(timeoutMs, () => {
      if (connected) return;
      refuse(`lien refusé : aucun hôte sur ${host}:${port} après ${timeoutMs} ms`);
      socket.destroy();
    });

    socket.setEncoding('utf8');
    const reader = readLines(
      socket,
      (line) => {
        handleServerMessage(line);
      },
      () => {
        stats.oversize += 1;
        refuse(`lien rompu : ligne de plus de ${Math.round(MAX_LINE_BYTES / 1024)} Ko reçue de l'hôte`);
        socket.destroy();
      },
    );
    socket.on('data', (chunk: string) => {
      try {
        reader.push(chunk);
      } catch (error) {
        // Filet SOUS le parseur : un message entrant ne doit jamais tuer le process principal.
        // On compte, on refuse, on rompt ce lien-là — l'application reste debout.
        stats.malformed += 1;
        console.warn('[signalisation] message entrant refusé', error);
        refuse('lien rompu : message entrant refusé');
        socket.destroy();
      }
    });
    socket.on('connect', () => {
      timers.cancel(timer);
      socket.write(`${joinRequest()}\n`);
    });
    socket.on('error', () => {
      timers.cancel(timer);
      if (!connected) {
        refuse(`lien refusé : connexion impossible vers ${host}:${port}`);
      }
    });
    socket.on('close', () => {
      timers.cancel(timer);
      if (closed) return;
      closed = true;
      emitLink('closed', 'lien fermé');
    });
  }

  function startHost(host: string): void {
    const ports: number[] = [];
    for (let index = 0; index < SIGNALING_PORT_RANGE; index += 1) ports.push(basePort + index);
    let attempt = 0;

    const tryNext = (lastDetail: string): void => {
      if (closed) return;
      const port = ports[attempt];
      attempt += 1;
      if (port === undefined) {
        refuse(
          `lien refusé : aucune des ${SIGNALING_PORT_RANGE} adresses de port ${basePort}-${basePort + SIGNALING_PORT_RANGE - 1} n'a pu être écoutée sur ${host} (${lastDetail})`,
        );
        return;
      }
      const candidateServer = createServer();
      candidateServer.once('error', (error: NodeJS.ErrnoException) => {
        candidateServer.close();
        const detail = error.code === 'EADDRINUSE' ? 'port occupé' : error.message;
        tryNext(detail);
      });
      candidateServer.listen({ host, port }, () => {
        server = candidateServer;
        listen = { host, port };
        // Vient après le bind, jamais avant : on ne peut annoncer qu'un port réellement écouté.
        options.onListen?.(listen);
        signaling = createLocalSignaling({
          port,
          now: options.now,
          ...(maxPeers === undefined ? {} : { maxParticipants: maxPeers }),
          // Un pair demande une image : le serveur ne la tient pas — c'est le magasin du lien
          // (`avatarStore`), rempli par le main, qui la lit ; la réponse part par
          // `answerAvatarGet`. Une empreinte que le magasin ne connaît pas reçoit un `null`
          // honnête : le demandeur garde ses initiales. Si aucun magasin n'est injecté (tests,
          // fenêtre sans profil), `onAvatarGet` laisse la main au main — sans lien vivant, la
          // demande expirera côté demandeur, ce qui vaut aussi « initiales ».
          ...(options.avatarStore === undefined && options.onAvatarGet === undefined
            ? {}
            : {
                onEvent: (event) => {
                  if (event.kind !== 'avatar-get' || event.avatarGet === undefined) return;
                  const request = event.avatarGet;
                  const store = options.avatarStore;
                  if (store !== undefined) {
                    try {
                      const loaded = store.load(request.avatarRef);
                      const pngBase64 = loaded.ok ? encodeAvatarPngForWire(loaded.data) : null;
                      signaling?.answerAvatarGet(
                        { from: request.from, to: selfId ?? '', avatarRef: request.avatarRef },
                        pngBase64,
                      );
                    } catch {
                      // Un répondant qui lève ne doit pas casser le serveur : pas de réponse vaut
                      // « initiales » côté demandeur.
                    }
                    return;
                  }
                  try {
                    options.onAvatarGet?.({ from: request.from, to: selfId ?? '', avatarRef: request.avatarRef });
                  } catch {
                    // Même règle : une exception remonte du callback ne doit jamais fermer le salon.
                  }
                },
              }),
        });
        candidateServer.on('connection', (socket: Socket) => acceptIncoming(socket));
        candidateServer.on('error', (error: Error) => {
          refuse(`lien rompu : ${error.message}`);
        });
        // L'hôte est aussi un pair : il rejoint son propre salon par le même chemin que les autres.
        dial(host === 'localhost' ? '127.0.0.1' : host, port);
      });
    };

    tryNext('');
  }

  function acceptIncoming(socket: Socket): void {
    const local = signaling;
    if (local === null || closed) {
      socket.destroy();
      return;
    }
    socket.setEncoding('utf8');
    const adapter: SocketLike = {
      send(data: string): void {
        if (socket.destroyed) return;
        socket.write(`${data}\n`);
      },
      close(): void {
        socket.end();
      },
    };
    const connection = local.handleConnection(adapter);

    const reader = readLines(
      socket,
      (line) => {
        stats.lines += 1;
        try {
          JSON.parse(line);
        } catch {
          stats.malformed += 1;
          adapter.send(refuseLine(`ligne JSON invalide (${line.length} octets) : connexion fermée`));
          socket.end();
          return;
        }
        connection.receive(line);
      },
      () => {
        stats.oversize += 1;
        adapter.send(
          refuseLine(
            `ligne de plus de ${Math.round(MAX_LINE_BYTES / 1024)} Ko : connexion fermée sans traitement`,
          ),
        );
        socket.end();
      },
    );

    socket.on('data', (chunk: string) => reader.push(chunk));
    socket.on('error', () => {
      connection.close('socket en erreur');
    });
    socket.on('close', () => {
      connection.close('socket fermé');
    });
  }

  // --- Démarrage -------------------------------------------------------------------------

  if (!isAllowedListenHost(options.host)) {
    // Refus AVANT tout `listen()` : aucune socket n'est ouverte sur une adresse large.
    refuse(
      `adresse refusée « ${options.host} » : le lien n'écoute que sur une adresse du réseau local ou le loopback`,
    );
  } else if (role === 'host') {
    emitLink('connecting', `écoute sur ${options.host}`);
    startHost(options.host);
  } else {
    emitLink('connecting', `connexion à ${options.host}:${basePort}`);
    dial(options.host, basePort);
  }

  return {
    role,
    get listen() {
      return listen;
    },
    get selfId() {
      return selfId;
    },
    stats,
    send(message: SignalOut): void {
      if (closed || outbound === null || outbound.destroyed) return;
      const wire = toWire(message);
      if (wire === null) {
        // Candidat hors LAN, ou charge utile inexploitable : rien ne sort, et c'est voulu.
        if (message.kind === 'ice') stats.filteredCandidates += 1;
        return;
      }
      outbound.write(`${JSON.stringify(wire)}\n`);
      if (message.kind === 'leave') {
        closed = true;
        outbound.end();
        emitLink('closed', 'départ du salon');
      }
    },
    requestAvatar(to: string, avatarRef: string): void {
      // La demande d'image (SPEC-002, amendement 2026-10-31) part par le môme tuyau que le SDP,
      // sous la même borne de 64 Ko. Un lien fermé ne demande rien ; une empreinte douteuse non
      // plus (le demandeur garderait ses initiales, sans traffic inutile).
      if (closed || outbound === null || outbound.destroyed) return;
      if (!isAvatarRef(avatarRef)) return;
      const wire = { type: 'avatar_get', to, avatarRef } satisfies ClientMessage;
      outbound.write(`${JSON.stringify(wire)}\n`);
    },
    answerAvatarGet(request: { from: string; to: string; avatarRef: string }, pngBase64: string | null): void {
      // Réponse à un `avatar_get` (SPEC-002, amendement 2026-10-31). Côté CLIENT, la demande est
      // tombée du serveur intermédiaire : la réponse repart par le socket sortant et le serveur
      // l'écrira sur la connexion du demandeur. Côté HÔTE, c'est le serveur du lien qui tient la
      // vérité du salon et écrit directement sur la connexion du demandeur. Un lien fermé ne
      // répond pas : le demandeur retombe sur ses initiales, comme pour une absence de réponse.
      if (closed) return;
      if (!isAvatarRef(request.avatarRef)) return;
      if (pngBase64 !== null && pngBase64.length > AVATAR_WIRE_BASE64_MAX_CHARS) return;
      if (role === 'host') {
        signaling?.answerAvatarGet(request, pngBase64);
        return;
      }
      if (outbound === null || outbound.destroyed) return;
      const wire = {
        type: 'avatar_data',
        from: request.to,
        to: request.from,
        avatarRef: request.avatarRef,
        pngBase64,
      } satisfies ServerMessage;
      outbound.write(`${JSON.stringify(wire)}\n`);
    },
    close(detail?: string): void {
      if (closed) return;
      closed = true;
      try {
        outbound?.write(`${JSON.stringify({ type: 'leave' } satisfies ClientMessage)}\n`);
        outbound?.end();
      } catch {
        outbound?.destroy();
      }
      outbound = null;
      signaling?.close();
      signaling = null;
      server?.close();
      server = null;
      emitLink('closed', detail ?? 'lien fermé');
    },
  };
}
