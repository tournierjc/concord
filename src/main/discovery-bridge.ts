/**
 * discovery-bridge.ts — découverte des salons du LAN par mDNS, côté process principal.
 *
 * RÔLE ET LIMITE : ce module est un adaptateur entre la pile mDNS (`bonjour-service`) et le
 * registre d'engine (`../engine/net/room-discovery`). Il fait les DEUX gestes de mDNS : il
 * **cherche** (`find`) les salons des autres, et il **annonce** (`publish`) le salon que cette
 * machine héberge — sans quoi la liste restait vide sur un vrai réseau et rejoindre un autre poste
 * était impossible (le salon n'était jamais publié nulle part). Il ne décide PAS de ce qui est « LAN », de ce
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

import { randomUUID } from 'node:crypto';

import { Bonjour, type Service } from 'bonjour-service';

import { IPC_MAX_ROOMS, type RoomSummaryDto } from '../shell/ipc-contract';
import { systemTimers, type MainTimers } from './timers';
import {
  MAX_ROOM_NAME_LENGTH,
  ROOM_DISCOVERY_MAX_ROOMS,
  createRoomRegistry,
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

/**
 * Service publié, réduit à ce que le bridge utilise (`stop`). `bonjour-service` en rend un objet
 * plus large : on ne déclare ici que la partie appelée, pour qu'un test puisse la doubler.
 */
export interface PublishedServiceLike {
  stop(callback?: () => void): void;
}

/**
 * Pile mDNS, réduite au strict nécessaire. Doublure possible en test (aucun socket, aucun port
 * 5353) sans toucher au reste du module.
 */
/** Browse ouvert : seul `on`/`stop` sont utilisés. */
export interface BrowserLike {
  on(event: 'up' | 'down', listener: (service: Service) => void): unknown;
  stop(): void;
}

/**
 * Port mDNS : chercher, publier, détruire. C'est ICI et nulle part ailleurs que `bonjour-service`
 * est adapté — un test fournit un port en mémoire (aucun socket, aucun port 5353) et exerce la
 * même logique que la production.
 */
export interface MdnsPort {
  find(onUp: (service: Service) => void): BrowserLike;
  publish(options: {
    name: string;
    type: string;
    protocol: 'udp';
    port: number;
    txt: Record<string, string>;
  }): PublishedServiceLike;
  destroy(): void;
}

/** Ce qu'un hôte annonce sur le LAN : le nom du salon, le port réellement écouté, la population. */
export interface AnnounceOptions {
  /** Nom d'affichage du salon (TXT `roomName`). */
  roomName: string;
  /** Port de signalisation RÉELLEMENT écouté (A5 : le port demandé peut avoir été occupé). */
  port: number;
  /** Nombre de participants annoncé (TXT `participants`, borné par le registre côté lecteur). */
  participants: number;
}

export interface DiscoveryBridgeOptions {
  /** Appelé à chaque évolution de la liste (main → `IPC.eventRoomsDiscovered`). */
  onRooms(rooms: RoomSummaryDto[]): void;
  /** Horloge du registre. Injectée par le main ; surchargeable en test. */
  now?(): number;
  /** Durée du scan initial, en millisecondes. */
  scanWindowMs?: number;
  /** Minuteur injecté (SPEC-012 §4) : la cadence de scrutation passe par `src/main/timers.ts`. */
  timers?: MainTimers;
  /** Fabrique le port mDNS. Défaut : `bonjour-service`. Doublure en mémoire en test. */
  createMdns?: () => MdnsPort;
  /**
   * Nom d'instance annoncé (`instanceId` aléatoire par session, SPEC-001 A4/A6). Injecté en test ;
   * c'est aussi lui qui permet au browse d'écarter notre PROPRE annonce.
   */
  instanceId?: string;
}

export interface DiscoveryBridge {
  /** Liste courante, telle que la voit le registre (déjà filtrée LAN, triée, bornée). */
  list(): RoomSummaryDto[];
  /** Démarre le browse. Idempotent. */
  start(): void;
  /** Arrête le browse, retire l'annonce et libère le timer. Idempotent. */
  close(): void;
  /**
   * Annonce le salon hébergé sur le LAN (`_concord._udp`). Idempotent : une nouvelle annonce
   * remplace la précédente (le TXT `participants` suit la population du salon).
   * Sans browse démarré ou sans port réel, l'appel est sans effet — jamais une annonce inventée.
   */
  announce(options: AnnounceOptions): void;
  /** Retire l'annonce. Sans annonce vivante : sans effet. Idempotent. */
  retract(): void;
  /** Ce que NOUS annonçons (`null` sinon) — permet de vérifier et de diagnostiquer. */
  announced(): { name: string; port: number } | null;
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
 * Port mDNS de production : la seule adaptation de `bonjour-service` du module. `Service.stop` est
 * typé `CallableFunction` dans la bibliothèque : on l'enveloppe dans une flèche pour que le port
 * n'expose qu'une signature honnête.
 */
function defaultMdnsPort(): MdnsPort {
  const bonjour = new Bonjour();
  return {
    find(onUp) {
      return bonjour.find({ type: DISCOVERY_SERVICE_TYPE, protocol: 'udp' }, onUp);
    },
    publish(options) {
      const service = bonjour.publish({ ...options });
      return {
        stop: () => {
          service.stop();
        },
      };
    },
    destroy() {
      bonjour.destroy();
    },
  };
}

export /**
 * Construit le bridge. Aucune I/O avant `start()` : la création est sûre au boot, même hors ligne.
 */
function createDiscoveryBridge(options: DiscoveryBridgeOptions): DiscoveryBridge {
  const timers = options.timers ?? systemTimers;
  // L'horloge par défaut vient du PORT, pas d'une lecture ambiante : c'est ce qui permet de figer
  // le temps d'un test d'expiration sans monkey-patching global.
  const now = options.now ?? (() => timers.now());
  const scanWindowMs = options.scanWindowMs ?? DISCOVERY_SCAN_WINDOW_MS;
  // Le registre et le contrat bornent tous deux la liste : on prend le plus contraignant.
  const maxRooms = Math.min(ROOM_DISCOVERY_MAX_ROOMS, IPC_MAX_ROOMS);
  const createMdns = options.createMdns ?? defaultMdnsPort;
  // Identité d'annonce : aléatoire par session (SPEC-001 A4 « instanceId aléatoire par session »).
  // Aucun identifiant persistant ne part donc sur le réseau.
  const instanceId = options.instanceId ?? randomUUID();
  let announcedService: PublishedServiceLike | null = null;
  let announcedPort: number | null = null;

  const registry = createRoomRegistry({ now, maxRooms });

  let mdns: MdnsPort | null = null;
  let browser: BrowserLike | null = null;
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
    // Notre propre annonce revient par le multicast : la compter reviendrait à proposer à
    // l'utilisateur de rejoindre le salon qu'il héberge déjà, sur sa propre machine.
    if (announcedService !== null && service.name === instanceId) return;
    const record = toRecord(service);
    if (!record) return;
    // `upsert` rend `null` quand l'annonce est refusée (hôte hors LAN, port hors plage) : c'est le
    // registre qui tranche, on ne double pas sa décision.
    registry.upsert(record);
    publish();
  }

  function onDown(service: Service): void {
    if (closed) return;
    if (announcedService !== null && service.name === instanceId) return;
    const name = typeof service.name === 'string' ? service.name.trim() : '';
    if (name.length === 0) return;
    registry.remove(name);
    publish();
  }

  function start(): void {
    if (closed || browser !== null) return;
    try {
      mdns = createMdns();
      browser = mdns.find(onUp);
      browser.on('up', onUp);
      browser.on('down', onDown);
    } catch (error) {
      // mDNS indisponible (port 5353 occupé, interface absente) : on dégrade, on ne plante pas.
      console.warn('[discovery] browse mDNS indisponible', error);
      browser = null;
      mdns = null;
    }
    clearScanTimer();
    scanTimer = timers.once(scanWindowMs, () => {
      scanTimer = null;
      publish();
    });
  }

  function announce(room: AnnounceOptions): void {
    if (closed) return;
    const port = room.port;
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      // Pas de port réel, pas d'annonce : mieux vaut une liste vide qu'un salon injoignable. Un
      // port non entier est refusé, pas arrondi : annoncer 12 pour 12,5 serait un mensonge.
      console.warn('[discovery] annonce ignorée : port invalide', room.port);
      return;
    }
    if (mdns === null) {
      // Browse indisponible : annoncer sans écouter ne servirait à rien, et rien ne viendrait
      // retirer l'annonce quand le salon se ferme.
      console.warn('[discovery] annonce ignorée : pile mDNS indisponible');
      return;
    }
    retract();
    const roomName = room.roomName.trim();
    try {
      announcedService = mdns.publish({
        name: instanceId,
        type: DISCOVERY_SERVICE_TYPE,
        protocol: 'udp',
        port,
        txt: {
          roomName: roomName.slice(0, MAX_ROOM_NAME_LENGTH),
          participants: String(Number.isFinite(room.participants) ? Math.max(0, Math.trunc(room.participants)) : 0),
        },
      });
      announcedPort = port;
    } catch (error) {
      announcedService = null;
      announcedPort = null;
      console.warn('[discovery] annonce mDNS refusée', error);
      return;
    }
    // Une entrée de nous-mêmes laissée par un passage précédent ne doit pas rester dans la liste.
    registry.remove(instanceId);
    publish();
  }

  function retract(): void {
    const service = announcedService;
    announcedService = null;
    announcedPort = null;
    if (service === null) return;
    try {
      service.stop();
    } catch {
      // déjà retirée : rien à faire
    }
  }

  function announced(): { name: string; port: number } | null {
    if (announcedService === null || announcedPort === null) return null;
    return { name: instanceId, port: announcedPort };
  }

  function close(): void {
    closed = true;
    clearScanTimer();
    retract();
    const activeBrowser = browser;
    const activeMdns = mdns;
    browser = null;
    mdns = null;
    try {
      activeBrowser?.stop();
    } catch {
      // déjà arrêté : rien à faire
    }
    try {
      activeMdns?.destroy();
    } catch {
      // idem
    }
  }

  return { list, start, close, announce, retract, announced };
}
