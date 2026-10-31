/**
 * discovery-bridge.ts — découverte des salons du LAN par mDNS, côté process principal.
 *
 * RÔLE ET LIMITE : ce module est un adaptateur entre un browse mDNS (`bonjour-service`) et le
 * registre d'engine (`../engine/net/room-discovery`). Il ne décide PAS de ce qui est « LAN », de ce
 * qu'est un salon valide, ni de la forme d'un `RoomSummaryDto` : tout cela appartient au registre
 * (`isLanCandidate` + plage de ports y sont appliqués, la vue publique y est construite). Ici on
 * ne fait que : traduire un service mDNS en `MdnsRecordLike`, alimenter le registre, publier la
 * liste qu'il rend, et tout arrêter proprement.
 *
 * PORTÉE RÉSEAU : mDNS = multicast lien-local (224.0.0.251 / ff02::fb, port 5353). Aucune requête
 * sortante vers l'Internet, aucun CDN, aucune télémétrie, aucune URL de schéma web, aucun serveur
 * de traversal STUN ou TURN, aucun socket WSS. Le browse est le seul accès réseau de ce fichier.
 *
 * HORLOGE : `now` est injecté par le main et prend sa valeur dans le port `./timers` (`timers.now()`),
 * jamais lu par l'engine — l'horloge système est interdite dans `src/engine/`.
 */

import { Bonjour, type Browser, type Service } from 'bonjour-service';

import { IPC_MAX_ROOMS, type RoomSummaryDto } from '../shell/ipc-contract';
import { systemTimers, type MainTimers } from './timers';
import {
  createRoomRegistry,
  ROOM_DISCOVERY_MAX_ROOMS,
  type MdnsRecordLike,
} from '../engine/net/room-discovery';

/** Type de service annoncé par un salon : `_concord._udp.local`. */
export const DISCOVERY_SERVICE_TYPE = 'concord';

/**
 * Fenêtre du scan initial, bornée à 3 s : à son terme la liste courante est publiée une dernière
 * fois et le timer est libéré. Le browse reste ensuite actif pour les `up` / `down` — sans quoi un
 * salon fermé ne serait signalé qu'à la péremption du registre (12 s), sans notification.
 */
export const DISCOVERY_SCAN_WINDOW_MS = 3000;

/** Champ `txt` d'un service mDNS : bonjour-service le rend en chaîne ou en octets. */
type TxtDict = Record<string, unknown>;

export interface DiscoveryBridgeOptions {
  /** Appelé à chaque évolution de la liste (main → `IPC.eventRoomsDiscovered`). */
  onRooms(rooms: RoomSummaryDto[]): void;
  /** Horloge du registre. Injectée par le main ; surchargeable en test. */
  now?(): number;
  /** Durée du scan initial, en millisecondes. */
  scanWindowMs?: number;
  /** Minuteur injecté (SPEC-012 §4) : la cadence de scrutation passe par `src/main/timers.ts`. */
  timers?: MainTimers;
}

export interface DiscoveryBridge {
  /** Liste courante, telle que la voit le registre (déjà filtrée LAN, triée, bornée). */
  list(): RoomSummaryDto[];
  /** Démarre le browse. Idempotent. */
  start(): void;
  /** Arrête le browse et libère le timer. Idempotent. */
  close(): void;
}

/** Objet nu, ou `null` : évite tout `as` non justifié sur une donnée venue du réseau. */
function asDict(value: unknown): TxtDict | null {
  if (typeof value !== 'object' || value === null) return null;
  return value as TxtDict;
}

/**
 * TXT mDNS → paires chaîne → chaîne.
 *
 * Nécessaire : le registre ne retient que les entrées TEXTUELLES d'un TXT, et la pile mDNS rend
 * parfois des octets. Une valeur illisible est écartée plutôt que convertie en « [object Object] ».
 */
function normaliseTxt(txt: unknown): Readonly<Record<string, string>> | null {
  const dict = asDict(txt);
  if (!dict) return null;
  const out: Record<string, string> = {};
  let kept = 0;
  for (const [key, value] of Object.entries(dict)) {
    if (typeof value === 'string') {
      out[key] = value;
      kept += 1;
    } else if (value instanceof Uint8Array) {
      out[key] = new TextDecoder().decode(value);
      kept += 1;
    }
  }
  return kept > 0 ? out : null;
}

/**
 * Service mDNS → `MdnsRecordLike`.
 *
 * Choix de l'hôte, et pourquoi ce n'est PAS un filtre : on préfère le nom mDNS (`*.local`) quand il
 * est annoncé, sinon la première adresse fournie. Le registre reste seul juge de l'acceptation
 * (`isLanCandidate`) ; la règle LAN n'est pas réimplémentée ici.
 */
function toRecord(service: Service): MdnsRecordLike | null {
  const name = typeof service.name === 'string' ? service.name.trim() : '';
  const port = service.port;
  if (name.length === 0 || !Number.isInteger(port)) return null;

  const mdnsHost = typeof service.host === 'string' ? service.host.trim() : '';
  const addresses = Array.isArray(service.addresses) ? service.addresses : [];
  const host = mdnsHost.toLowerCase().endsWith('.local')
    ? mdnsHost
    : (addresses.find((address) => typeof address === 'string') ?? mdnsHost);
  if (typeof host !== 'string' || host.length === 0) return null;

  const txt = normaliseTxt(service.txt);
  return txt ? { name, host, port, txt } : { name, host, port };
}

/**
 * Construit le bridge. Aucune I/O avant `start()` : la création est sûre au boot, même hors ligne.
 */
export function createDiscoveryBridge(options: DiscoveryBridgeOptions): DiscoveryBridge {
  const timers = options.timers ?? systemTimers;
  // L'horloge par défaut vient du PORT, pas d'une lecture ambiante : c'est ce qui permet de figer
  // le temps d'un test d'expiration sans monkey-patching global.
  const now = options.now ?? (() => timers.now());
  const scanWindowMs = options.scanWindowMs ?? DISCOVERY_SCAN_WINDOW_MS;
  // Le registre et le contrat bornent tous deux la liste : on prend le plus contraignant.
  const maxRooms = Math.min(ROOM_DISCOVERY_MAX_ROOMS, IPC_MAX_ROOMS);

  const registry = createRoomRegistry({ now, maxRooms });

  let bonjour: Bonjour | null = null;
  let browser: Browser | null = null;
  let scanTimer: unknown = null;
  let lastPublished = '';
  let closed = false;

  function clearScanTimer(): void {
    if (scanTimer !== null) {
      timers.cancel(scanTimer);
      scanTimer = null;
    }
  }

  function list(): RoomSummaryDto[] {
    return registry.list().slice(0, IPC_MAX_ROOMS);
  }

  /**
   * Publie la liste, sauf si elle est identique à la précédente. Deux raisons : `bonjour-service`
   * peut signaler un même service à la fois par le callback de `find` et par l'événement `up`
   * (double notification pour un seul salon), et un renouvellement de TXT sans changement ne doit
   * pas réveiller le renderer.
   */
  function publish(): void {
    if (closed) return;
    const rooms = list();
    const fingerprint = JSON.stringify(rooms);
    if (fingerprint === lastPublished) return;
    lastPublished = fingerprint;
    options.onRooms(rooms);
  }

  function onUp(service: Service): void {
    if (closed) return;
    const record = toRecord(service);
    if (!record) return;
    // `upsert` rend `null` quand l'annonce est refusée (hôte hors LAN, port hors plage) : c'est le
    // registre qui tranche, on ne double pas sa décision.
    registry.upsert(record);
    publish();
  }

  function onDown(service: Service): void {
    if (closed) return;
    const name = typeof service.name === 'string' ? service.name.trim() : '';
    if (name.length === 0) return;
    registry.remove(name);
    publish();
  }

  function start(): void {
    if (closed || browser !== null) return;
    try {
      bonjour = new Bonjour();
      browser = bonjour.find({ type: DISCOVERY_SERVICE_TYPE, protocol: 'udp' }, onUp);
      browser.on('up', onUp);
      browser.on('down', onDown);
    } catch (error) {
      // mDNS indisponible (port 5353 occupé, interface absente) : on dégrade, on ne plante pas.
      console.warn('[discovery] browse mDNS indisponible', error);
      browser = null;
      bonjour = null;
    }
    clearScanTimer();
    scanTimer = timers.once(scanWindowMs, () => {
      scanTimer = null;
      publish();
    });
  }

  function close(): void {
    closed = true;
    clearScanTimer();
    const activeBrowser = browser;
    const activeBonjour = bonjour;
    browser = null;
    bonjour = null;
    try {
      activeBrowser?.stop();
    } catch {
      // déjà arrêté : rien à faire
    }
    try {
      activeBonjour?.destroy();
    } catch {
      // idem
    }
  }

  return { list, start, close };
}
