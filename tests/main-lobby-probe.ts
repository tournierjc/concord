/**
 * tests/main-lobby-probe.ts — la sonde qui EXÉCUTE le main pour le test du lobby permanent.
 *
 * Pourquoi un fichier séparé : `src/main/index.ts` importe `electron` à l'exécution (illisible par
 * Node). Le hook `require` doit être en place AVANT l'import du main : ce module l'installe puis
 * importe `index.ts`. `tests/lobby-hosting.node.test.ts` importe CE module en premier — c'est le
 * seul endroit où le main est réellement joué, pas cité dans un regex.
 *
 * Ce que la sonde remplace (et rien d'autre) :
 *   - `electron` : noyau factice — `app` (verrou refusé : les fenêtres ne se créent pas),
 *     `ipcMain.handle` CAPTURÉ dans une map, `BrowserWindow`/`screen`/`session`/`globalShortcut`/
 *     `protocol` inertes. `bootstrap()` est rappelé À LA MAIN par la sonde.
 *   - `bonjour-service` : doublure en mémoire — `publish` enregistre le TXT réellement passé,
 *     `stop` enregistre les retraits.
 *   - `os.networkInterfaces` : deux adresses privées (le hors-ligne est déjà prouvé pur ailleurs).
 *   - `os.userInfo` : identité stable.
 *
 * Puis elle EXPOSE ce que le lobby traverse : `publishDiscoveryHealth` (le callback `onHealth` que
 * `index.ts` passe réellement à son bridge), `forwardBridgeEvent` (la boucle `reannounceHostedRoom`),
 * `currentLobbyStatus` appelé comme fonction, les handlers IPC enregistrés, et l'injection d'un lien
 * (double ou vraie socket).
 *
 * Lancer (via le test, jamais à la main) : npx tsx --test tests/lobby-hosting.node.test.ts
 */

import Module from 'node:module';
import os from 'node:os';

interface SentEvent {
  channel: string;
  payload: unknown;
}

interface PublishCall {
  name: string;
  type: string;
  protocol: string;
  port: number;
  txt: Record<string, string>;
}

interface LobbyStatus {
  port: number | null;
  method: string;
  health: string;
}

interface SignalingLinkLike {
  role: 'host' | 'client';
  listen: { host: string; port: number } | null;
  /** Le main appelle `close(detail)` en `stopSignalingLink` : le double sans `close` reçoit un
   no-op posé par la sonde (le vrai lien, lui, ferme réellement ses sockets). */
  close?(detail?: string): void;
}

export interface MainProbe {
  /** Fait tourner `bootstrap()` du main (idempotent) — à appeler avant tout scénario. */
  ready(): Promise<void>;
  events: SentEvent[];
  handlers: Map<string, (payload: unknown) => unknown>;
  publishes: PublishCall[];
  retracted: number[];
  lastTxt(): Record<string, string> | undefined;
  reset(): void;
  /** Le callback `onHealth` que le main a VRAIMENT passé à son bridge (`onHealth: publishDiscoveryHealth`). */
  bridgeHealthCallback(): (health: string) => void;
  forwardBridgeEvent(event: unknown): void;
  setSignalingLink(link: SignalingLinkLike | null): void;
  announceHostedRoom(room: { roomName: string; port: number; participants: number }): void;
  retractHostedRoom(): void;
  lobbyStatus(): LobbyStatus;
}

/* ----------------------------- Electron factice (exigé par `import 'electron'`) -------------- */

const sent: SentEvent[] = [];
const invokeHandlers = new Map<string, (payload: unknown) => unknown>();

const fakeWebContentsHandlers: Record<string, Array<(...args: unknown[]) => void>> = {};

const fakeWebContents = {
  send(channel: string, payload: unknown): void {
    // Electron (`webContents.send`) est appelé avec DEUX arguments par `sendEvent` : le canal du
    // canon et la charge utile déjà gardée. `rest[1]` était donc `undefined` — le double lit
    // désormais les arguments exacts du vrai appelant.
    sent.push({ channel: String(channel), payload });
  },
  // Les canaux WebView/DevTools utilisés par le durcissement : présents, espionnés.
  on(event: string, listener: (...args: unknown[]) => void): void {
    (fakeWebContentsHandlers[event] ??= []).push(listener);
  },
  once(event: string, listener: (...args: unknown[]) => void): void {
    (fakeWebContentsHandlers[event] ??= []).push(listener);
  },
  setWindowOpenHandler: (): void => undefined,
  sendInputEvent: (): void => undefined,
};

// Le main envoie ses événements lobby à LA fenêtre principale (`sendEvent(…, 'main')`). Comme le
// verrou est refusé, `createMainWindow` n'est jamais appelé par le cycle de vie : la sonde ouvre
// elle-même la fenêtre factice après `bootstrap()`, pour que le destinataire existe.
const liveWindows = new Set<unknown>();

class FakeBrowserWindow {
  webContents = fakeWebContents;
  constructor() {
    liveWindows.add(this);
  }
  static getAllWindows(): unknown[] {
    return [...liveWindows];
  }
  once(): void {}
  on(): void {}
  show(): void {}
  focus(): void {}
  hide(): void {}
  isDestroyed(): boolean {
    return false;
  }
  isMinimized(): boolean {
    return false;
  }
  isVisible(): boolean {
    return true;
  }
  restore(): void {}
  loadURL(): Promise<void> {
    return Promise.resolve();
  }
  loadFile(): Promise<void> {
    return Promise.resolve();
  }
  close(): void {
    liveWindows.delete(this);
  }
  destroy(): void {
    liveWindows.delete(this);
  }
  setIgnoreMouseEvents(): void {}
  setVisibleOnAllWorkspaces(): void {}
  setAlwaysOnTop(): void {}
  setPosition(): void {}
  setBounds(): void {}
  setResizable(): void {}
  setContentBounds(): void {}
  setMenuBarVisibility(): void {}
  setAutoHideMenuBar(): void {}
  // Utilisés par l'icône de la zone de notification (0.4.2) : `Tray` est doublé par cette même
  // classe, les deux méthodes doivent donc exister.
  setToolTip(): void {}
  setContextMenu(): void {}
  setKiosk(): void {}
  setSkipTaskbar(): void {}
  setBackgroundColor(): void {}
  setTitle(): void {}
  setOpacity(): void {}
}

interface FakedElectron {
  app: Record<string, unknown>;
  ipcMain: Record<string, unknown>;
  [key: string]: unknown;
}

function fakeDisplay(): Record<string, unknown> {
  return {
    id: 1,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    scaleFactor: 1,
  };
}

function fakeElectronModule(): FakedElectron {
  // Double fidèle : chaque enregistreur CONSERVE ses callbacks (comme la vraie session) — les
  // `webRequest.*` sont lus par les tests de garde, ils ne peuvent pas être des puits.
  const registered: Record<string, unknown[]> = {};
  const keep = (name: string) => (): void => {
    (registered[name] ??= []).push(name);
  };
  const noopSession = {
    webRequest: {
      onHeadersReceived: keep('onHeadersReceived'),
      onBeforeRequest: keep('onBeforeRequest'),
    },
    setPermissionRequestHandler: keep('setPermissionRequestHandler'),
    setPermissionCheckHandler: keep('setPermissionCheckHandler'),
    protocol: { handle: (): Promise<void> => Promise.resolve() },
    registered,
  };
  const faked: FakedElectron = {
    app: {
      // Verrou refusé : le `else` de `index.ts` (fenêtres, whenReady→bootstrap) ne s'exécute pas ;
      // `bootstrap()` est rappelé à la main par la sonde.
      requestSingleInstanceLock: (): boolean => false,
      on: (): void => undefined,
      whenReady: (): Promise<void> => Promise.resolve(),
      quit: (): void => undefined,
      getPath: (): string => '/tmp/concord-lobby-probe',
      getAppPath: (): string => '/tmp/concord-lobby-probe',
      isPackaged: false,
      setName: (): void => undefined,
      setAppUserModelId: (): void => undefined,
      dock: { setMenu: (): void => undefined },
    },
    BrowserWindow: FakeBrowserWindow,
    ipcMain: {
      handle(channel: string, handler: (event: unknown, payload: unknown) => unknown): void {
        invokeHandlers.set(String(channel), (payload) =>
          handler({ senderFrame: { url: 'app://concord/index.html' } }, payload),
        );
      },
      on: (): void => undefined,
      removeHandler: (): void => undefined,
    },
    screen: {
      getAllDisplays: (): unknown[] => [fakeDisplay()],
      getPrimaryDisplay: (): unknown => fakeDisplay(),
      on: (): void => undefined,
    },
    session: { defaultSession: noopSession },
    globalShortcut: {
      register: (): boolean => true,
      unregister: (): void => undefined,
      unregisterAll: (): void => undefined,
      isRegistered: (): boolean => false,
    },
    protocol: {
      registerScheme: (): boolean => true,
      registerFileProtocol: (): void => undefined,
      handle: (): Promise<void> => Promise.resolve(),
    },
    Menu: { setApplicationMenu: (): void => undefined, buildFromTemplate: (): unknown => ({}) },
    shell: { openExternal: (): Promise<void> => Promise.resolve() },
    dialog: { showMessageBox: (): Promise<{ response: number }> => Promise.resolve({ response: 0 }) },
    powerMonitor: { on: (): void => undefined },
    nativeTheme: { shouldUseDarkColors: true, on: (): void => undefined },
    // L'icône de la zone de notification (0.4.2) : image lisible, pour que le chemin réel
    // (création de l'icône + menu) s'exécute dans la sonde plutôt que d'être court-circuité.
    nativeImage: {
      createFromPath: (): { isEmpty: () => boolean } => ({ isEmpty: (): boolean => false }),
    },
    ipcRenderer: {
      sendSync: (): null => null,
      on: (): void => undefined,
      invoke: (): Promise<null> => Promise.resolve(null),
    },
    contextBridge: { exposeInMainWorld: (): void => undefined },
    net: {},
    Tray: FakeBrowserWindow,
    Notification: FakeBrowserWindow,
  };
  faked.default = faked;
  return faked;
}

/* ------------------------------- bonjour-service factice ------------------------------------- */

const publishes: PublishCall[] = [];
const retracted: number[] = [];

function fakeBonjourModule(): Record<string, unknown> {
  class FakeBonjour {
    find(_opts: unknown, _onUp?: unknown): unknown {
      return { on: (): void => undefined, stop: (): void => undefined };
    }
    publish(options: PublishCall): unknown {
      publishes.push({ ...options, txt: { ...options.txt } });
      const index = publishes.length - 1;
      return {
        stop: (): void => {
          retracted.push(index);
        },
      };
    }
    destroy(): void {}
  }
  const faked: Record<string, unknown> = { Bonjour: FakeBonjour };
  faked.default = FakeBonjour;
  return faked;
}

/* -------------------------------- installation des hooks ------------------------------------- */

const fakedElectron = fakeElectronModule();
const fakedBonjour = fakeBonjourModule();

// Réseau : le main lit `os.networkInterfaces()` À CHAQUE appel (`hasNetwork`, index.ts) — un
// remplacement GLOBAL rendrait le test fou pour tout le reste de la suite. On le rend CONDITIONNEL :
// la sonde pilote un drapeau, et le double ne ment que tant que le test le lui demande.
let probeOnline = true;
const realNetworkInterfaces = os.networkInterfaces.bind(os);
const osAny = os as unknown as Record<string, unknown>;
osAny.networkInterfaces = (): Record<string, unknown[]> =>
  probeOnline
    ? {
        wlan0: [{ address: '192.168.1.42', family: 'IPv4', internal: false, netmask: '255.255.255.0' }],
        lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true, netmask: '255.0.0.0' }],
      }
    : {};
osAny.userInfo = (): { username: string } => ({ username: 'lobby-probe' });

/** Rend son vrai `networkInterfaces` au module `os` (propreté pour la suite). */
export function restoreOs(): void {
  osAny.networkInterfaces = realNetworkInterfaces;
}

const moduleInternals = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = moduleInternals._load;
moduleInternals._load = function (request: string, parent: unknown, isMain: boolean): unknown {
  if (request === 'electron') return fakedElectron;
  if (request === 'bonjour-service') return fakedBonjour;
  return originalLoad.call(this, request, parent, isMain);
};

// Import du main : le hook est déjà en place, `electron` est le double.
const mainModule = originalLoad.call(moduleInternals, '../src/main/index.ts', module, true) as Record<
  string,
  unknown
>;

interface MainForTests {
  bootstrap: () => Promise<void>;
  publishDiscoveryHealth: (health: string) => void;
  forwardBridgeEvent: (event: unknown) => void;
  currentLobbyStatus: () => LobbyStatus;
  setSignalingLink: (link: SignalingLinkLike | null) => void;
  announceHostedRoom: (room: { roomName: string; port: number; participants: number }) => void;
  retractHostedRoom: () => void;
}

const forTests = mainModule.__mainForTests as MainForTests;

// Verrou refusé ⇒ `bootstrap()` n'a jamais tourné. Il est ASYNCHRONE mais n'attend rien
// d'attendu (toutes ses API sont synchrones dans le double) : on le joue maintenant, au
// premier `await` d'un test, via `ready` — jamais par un top-level await (tsx émet en CJS ici).
let bootstrapped = false;
async function ready(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;
  // store défaut (chemin /tmp du double), handlers IPC enregistrés, discovery.start sur le
  // faux bonjour — tout est synchrone dans le double, `await` ne fait que passer la main.
  await forTests.bootstrap();
  // Le verrou refusé n'appelle jamais `createMainWindow` : la sonde ouvre la fenêtre factice
  // ELLE-MÊME — `sendEvent(…, 'main')` du lobby a alors un destinataire, et c'est exactement
  // le chemin de production (même constructeur, mêmes webContents doubles).
  const BrowserWindowCtor = fakedElectron.BrowserWindow as new () => unknown;
  new BrowserWindowCtor();
}

export const probe: MainProbe = {
  ready,
  events: sent,
  handlers: invokeHandlers,
  publishes,
  retracted,
  lastTxt(): Record<string, string> | undefined {
    return publishes[publishes.length - 1]?.txt;
  },
  reset(): void {
    sent.length = 0;
    publishes.length = 0;
    retracted.length = 0;
    // Repart d'un monde connu : hors salon, sans lien. La santé, elle, EST laissée telle que
    // le test précédent l'a laissée — le pont de santé est idempotent par changement, et un test
    // qui veut partir d'un état précis publie lui-même l'état contraire d'abord.
    forTests.setSignalingLink(null);
  },
  bridgeHealthCallback(): (health: string) => void {
    // `index.ts` passe `onHealth: publishDiscoveryHealth` à son bridge (constante `discovery`,
    // l.84-93). Rejouer `publishDiscoveryHealth`, c'est rejouer CE callback — le lien bridge →
    // callback est lui vérifié par le test du bridge (`setHealth` appelle `options.onHealth` à
    // chaque changement) et la charge par la garde de contrat (test lobby-ipc).
    return (health: string) => forTests.publishDiscoveryHealth(health);
  },
  forwardBridgeEvent(event: unknown): void {
    forTests.forwardBridgeEvent(event);
  },
  setSignalingLink(link: SignalingLinkLike | null): void {
    // Un double sans `close` reçoit un no-op typé : `stopSignalingLink` appelle `close(detail)`
    // et attrape déjà l'exception — mais un test lisible ne doit pas polluer la sortie avec un
    // « fermeture impossible » qui n'a rien à voir avec ce qu'il vérifie.
    const sealed: SignalingLinkLike =
      link !== null && typeof link.close !== 'function' ? { ...link, close: () => undefined } : (link as SignalingLinkLike);
    forTests.setSignalingLink(sealed);
  },
  announceHostedRoom(room): void {
    forTests.announceHostedRoom(room);
  },
  retractHostedRoom(): void {
    forTests.retractHostedRoom();
  },
  lobbyStatus(): LobbyStatus {
    return forTests.currentLobbyStatus();
  },
};
