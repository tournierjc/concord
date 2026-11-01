/**
 * index.ts — point d'entrée du process principal Electron.
 *
 * Ce fichier assemble, il ne calcule pas : la logique vérifiable vit dans `../shell` (géométrie de
 * l'overlay, schéma de réglages, contrat IPC) et dans `csp.ts` / `net-guard.ts`. Il ne reste ici que
 * le cycle de vie de l'application et le câblage des fenêtres.
 *
 * Sécurité appliquée à toutes les fenêtres (SPEC-001 A15 / CA19), sans exception :
 *   contextIsolation: true · nodeIntegration: false · sandbox: true · webSecurity: true
 *   CSP stricte posée par en-tête · `setWindowOpenHandler` → deny
 *   navigation limitée à app:// (ou au serveur de dev local) · webview refusée
 *   permissions limitées au micro · aucun `shell.openExternal` sur URL arbitraire
 *
 * NON VÉRIFIÉ ici : ce module ne peut pas être exécuté dans cet environnement (ni Electron ni
 * `node_modules`). Sa vérification future est `npm run build:main` puis un lancement réel.
 */

import { app, BrowserWindow, dialog, ipcMain, screen, session } from 'electron';
import { readFileSync } from 'node:fs';
import { networkInterfaces, userInfo } from 'node:os';
import { join } from 'node:path';

import {
  createAvatarStore,
  decodeAvatarPngFromWire,
  electronAvatarIo,
  encodeAvatarPngForWire,
  type AvatarStore,
} from './avatar-store';
import { customAvatarRef, isAvatarRef, isGalleryAvatarId } from '../shell/avatar';

import { securityHeaders } from './csp';
import { createDiscoveryBridge, type DiscoveryBridge, type DiscoveryHealth } from './discovery-bridge';
import { installNetworkGuard } from './net-guard';
import { hasRoutableNetwork } from './network-state';
import { APP_SCHEME, SCHEME_SEP } from './net-schemes';
import { OverlayController, listDisplays } from './overlay-controller';
import { registerPushToTalk, releasePushToTalk, type PttRegistration } from './ptt';
import { appUrl, registerAppProtocol, registerAppScheme } from './renderer-protocol';
import { isPermissionAllowed, isPermissionCheckAllowed } from './permissions';
import { RoomBridge, type BridgeEvent } from './room-bridge';
import { effectiveSignalingPort } from './signaling-port';
import { applySignalToRoster } from './roster-link';
import { createSettingsStore, type SettingsStore } from './settings-store';
import { systemTimers } from './timers';
import {
  createDuckingController,
  electronDuckExec,
  type DuckingController,
} from './ducking';
import {
  createUpdateService,
  electronUpdateIo,
  type UpdateService,
} from './update';
import { createRequire } from 'node:module';
import {
  createSignalingLink,
  pickListenHost,
  type SignalingLink,
} from './signaling-link';

import {
  IPC,
  IpcContractError,
  guardPayload,
  shouldDuckForPeers,
  type DiscoveryHealthDto,
  type GainPayload,
  type IpcEventChannel,
  type IpcInvokeChannel,
  type LobbyStatusDto,
  type OverlayPatchPayload,
  type RoomJoinPayload,
  type RoomSummaryDto,
  type SignalIn,
  type SignalOut,
  type SpeakingSetPayload,
  type UpdateStateDto,
} from '../shell/ipc-contract';
import {
  applySettingsPatch,
  defaultSettings,
  pushToTalkAcceleratorChanged,
  resolveDisplayName,
  type Settings,
} from '../shell/settings-schema';

/**
 * Serveur de développement Vite (boucle locale uniquement, port 5173). Jamais défini en production :
 * le bundle est alors servi par `app://`, sans socket.
 */
const DEV_SERVER = process.env['LAN_DEV_SERVER'] ?? null;

let mainWindow: BrowserWindow | null = null;
let settings: Settings = defaultSettings();
let store: SettingsStore;
let networkGuard: ReturnType<typeof installNetworkGuard> | null = null;
let ptt: PttRegistration | null = null;
/** Le tuyau de signalisation du salon courant (T16b). `null` hors salon. */
let signalingLink: SignalingLink | null = null;
/**
 * L'empreinte que le `join` emporte (SPEC-002, amendement 2026-10-31) : un avatar de galerie
 * voyage sous son propre id, un avatar personnalisé sous l'empreinte de son PNG. `undefined` si
 * le réglage n'est pas un avatar recevable — le pair affiche alors les initiales.
 */
function avatarRefForJoin(avatar: Settings['avatar']): string | undefined {
  if (typeof avatar === 'string') return isGalleryAvatarId(avatar) ? avatar : undefined;
  return customAvatarRef(avatar) ?? undefined;
}

/**
 * Le magasin d'images d'avatar locales (SPEC-002, amendement 2026-10-31). Créé au démarrage,
 * dès que `userData` est connu : l'image ne quitte JAMAIS la machine — seul son empreinte voyage
 * sur le LAN, et le binaire n'est demandé que par un pair du même réseau.
 */
let avatarStore: AvatarStore | null = null;
/**
 * Les images reçues des pairs, en mémoire seulement (SPEC-002, amendement 2026-10-31) : un pair
 * nous envoie son PNG par `avatar_data`, on l'affiche le temps de la session et on n'en garde
 * aucune trace sur le disque — seule MA propre image est stockée sous `userData/avatars/`.
 */
const sessionAvatars = new Map<string, string>();
const overlay = new OverlayController();
const bridge = new RoomBridge(forwardBridgeEvent);
// Santé courante de la découverte (mDNS) — mesurée par le bridge, lue par le pied de lobby.
let discoveryHealth: DiscoveryHealth = 'ok';
// Découverte mDNS des salons : `now` est injecté ici, dans le main (interdit dans `src/engine/`).
const discovery: DiscoveryBridge = createDiscoveryBridge({
  onRooms: publishRooms,
  // L'échec du browse n'était qu'un `console.warn` : il devient un événement que le lobby affiche
  // (« mDNS indisponible » / « Aucun réseau actif » — SPEC-002 S1.4 / S1.10).
  onHealth: publishDiscoveryHealth,
  // Lecture à CHAQUE appel : une interface qui remonte (Wi-Fi rebranché) doit pouvoir être vue
  // par le prochain `start()`, pas figée au boot.
  hasNetwork: () => hasRoutableNetwork(networkInterfaces()),
  now: () => systemTimers.now(),
});

// --- Cycle de vie ----------------------------------------------------------------------------

// Un seul process par machine : deux instances se disputeraient le port de signalisation et le
// raccourci global push-to-talk.
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  // Doit être appelé avant `app.whenReady()`.
  registerAppScheme();
  void app.whenReady().then(bootstrap);
}

app.on('window-all-closed', () => {
  // L'overlay est une fenêtre outil : sa fermeture ne doit pas laisser le process tourner.
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

app.on('will-quit', () => {
  releasePushToTalk();
  // Le ducking ne survit pas à la fermeture : si une baisse était en cours, elle est annulée.
  resetDucking();
  // Les minuteries du service de mise à jour ne survivent pas à la fermeture (un téléchargement
  // en vol est abandonné — un `.part` orphelin est repris ou nettoyé au prochain cycle).
  updateService?.stop();
  // Le tuyau de signalisation ne survit pas à la fermeture (leave émis, sockets fermées).
  stopSignalingLink('fermeture de l’application');
  // Browse mDNS + timer de scan : rien ne doit survivre à la fermeture.
  discovery.close();
  networkGuard?.dispose();
  overlay.destroy();
});

// --- Démarrage -------------------------------------------------------------------------------

async function bootstrap(): Promise<void> {
  store = createSettingsStore(join(app.getPath('userData'), 'settings.json'));
  // Le magasin d'avatars vit à côté des réglages, sous `userData` : un dossier que l'application
  // possède, que le renderer ne voit pas (sandbox), et que le réseau ne voit pas (LAN only).
  avatarStore = createAvatarStore(join(app.getPath('userData'), 'avatars'), electronAvatarIo());
  // Le ducking est créé dès le démarrage : son seam (`execFile`) n'est appelé QUE si un pair est
  // mesuré parlant ET que l'option `audio.duckOthers` est active — jamais avant, jamais à vide.
  duckingController = createDuckingController({ exec: electronDuckExec(), timers: systemTimers });
  const loaded = store.load();
  settings = loaded.settings;
  if (loaded.recovered) {
    // Réglages corrompus ou d'une version future : on repart des défauts, sans bloquer le démarrage.
    console.warn('[réglages] fichier inutilisable, valeurs par défaut appliquées', loaded.errors);
  }

  applySecurityPolicies();
  createMainWindow();
  createOverlay();

  registerIpcHandlers();
  // Enregistre le raccourci push-to-talk auprès du système ET publie un éventuel conflit : l'UI doit le dire,
  // pas le masquer (le second envoi qui vivait en fin de `bootstrap` faisait doublon).
  registerPushToTalkShortcut();
  // Après les fenêtres : le premier `onRooms` doit trouver un renderer à qui parler.
  discovery.start();

  // Mises à jour (avenant SPEC-006b, 2026-11-01) : créé APRÈS les fenêtres et les handlers IPC —
  // le premier état publié doit trouver un renderer à qui parler, comme la découverte. La cadence
  // (30 s puis 24 h) est armée par `start()` ; la CONDITION `auto` est relue à chaque réveil par
  // le service lui-même via `isAutoEnabled`.
  updateService = createUpdateService({
    seam: electronUpdateIo({
      downloadsDir: join(app.getPath('userData'), 'downloads'),
      appVersion: readAppVersion(),
      env: process.env,
      timers: systemTimers,
    }),
    timers: systemTimers,
    quitApp: () => {
      app.quit();
    },
    roomActive: roomActiveForUpdate,
    isAutoEnabled: () => settings.update.auto,
    onStateChange: (state) => {
      // Publication immédiate (l'UI suit la machine en direct), puis enregistrement des MESURES
      // (checkedAt, lastSeenVersion) — des faits observés, jamais des réglages saisis.
      publishUpdateState(state);
      persistUpdateMeasures(state);
    },
  });
  updateService.start();

  // Branchement/débranchement d'écran : l'overlay se replace au lieu de rester hors champ, et la
  // nouvelle géométrie est republiée (`overlay.refresh()` calculait mais ne la poussait pas).
  // `screen.on` est surchargé par nom d'événement : une boucle sur une union de littéraux ne
  // satisfait aucune surcharge (TS2769). Trois abonnements explicites, même geste, sans cast.
  const onDisplayChange = (): void => syncOverlayGeometry();
  screen.on('display-added', onDisplayChange);
  screen.on('display-removed', onDisplayChange);
  screen.on('display-metrics-changed', onDisplayChange);

}

// --- Fenêtres --------------------------------------------------------------------------------

function preloadPath(): string {
  // dist/main/index.js → dist/preload/index.js
  return join(__dirname, '..', 'preload', 'index.js');
}

function secureWebPreferences(extra: { devTools: boolean }) {
  return {
    preload: preloadPath(),
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    spellcheck: false,
    devTools: extra.devTools,
  };
}

function harden(contents: Electron.WebContents): void {
  // Aucune fenêtre enfant, aucun onglet : une seule origine connue.
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // `domEvent` et non `event` : dans ce fichier, `event` est réservé aux événements IPC du pont
  // (`BridgeEvent`), dont le discriminant est un canal. Mélanger les deux noms invite au contresens.
  contents.on('will-navigate', (domEvent, targetUrl) => {
    const allowed = DEV_SERVER
      ? targetUrl.startsWith(DEV_SERVER)
      : targetUrl.startsWith(`${APP_SCHEME}${SCHEME_SEP}`);
    if (!allowed) domEvent.preventDefault();
  });
  contents.on('will-attach-webview', (domEvent) => domEvent.preventDefault());
}

/**
 * Icône de la fenêtre principale.
 *
 * En paquet, sous Linux, l'icône de fenêtre vient du `.desktop` (StartupWMClass) et `build/`
 * n'est pas embarqué dans l'asar : on ne passe donc rien. En dev (`npm start`) il n'y a ni
 * `.desktop` ni StartupWMClass, la fenêtre garde l'icône Electron par défaut — d'où ce chemin
 * explicite vers le PNG versionné, construit depuis `app.getAppPath()` (absolu, jamais relatif
 * au cwd : `npm start` peut être lancé depuis n'importe quel répertoire).
 */
function devWindowIcon(): string | undefined {
  if (app.isPackaged) return undefined;
  return join(app.getAppPath(), 'build', 'icon.png');
}

function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;

  const window = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    show: false,
    icon: devWindowIcon(),
    backgroundColor: '#0E1116',
    title: 'Concord',
    webPreferences: secureWebPreferences({ devTools: !app.isPackaged }),
  });

  harden(window.webContents);
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    mainWindow = null;
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('[fenêtre principale] renderer arrêté :', details.reason);
  });

  if (DEV_SERVER) void window.loadURL(DEV_SERVER);
  else void window.loadURL(appUrl('index.html'));

  mainWindow = window;
  return window;
}

function createOverlay(): void {
  overlay.create(preloadPath());
  // Même durcissement que la fenêtre principale : sans cela, la seule différence entre les deux
  // webContents était... l'absence de garde. `setWindowOpenHandler`/`will-navigate` refusent toute
  // ouverture et toute navigation hors de `app://` (ou du serveur de dev).
  const overlayWindow = overlay.getWindow();
  if (overlayWindow) harden(overlayWindow.webContents);
  overlay.load();
  // AD-20 D1 : une overlay qui (re)charge ne peut pas attendre la prochaine transition — une parole
  // déjà en cours resterait éteinte. On rejoue le dernier ensemble connu, tel quel.
  overlay.getWindow()?.webContents.once('did-finish-load', () => {
    publishSpeaking(speakingNow);
  });
  syncOverlayGeometry();
}

// --- Politiques de sécurité ------------------------------------------------------------------

function applySecurityPolicies(): void {
  const ses = session.defaultSession;

  // En-têtes posés sur CHAQUE réponse : un document chargé sans en-tête serait sans défense.
  // Ils viennent TOUS de `securityHeaders` (une seule définition) : la version précédente
  // recomposait la liste à la main et laissait tomber `Cross-Origin-Opener-Policy`,
  // `Cross-Origin-Resource-Policy` et `Permissions-Policy` — qui n'étaient donc nulle part.
  const headers = securityHeaders({ devServerOrigin: DEV_SERVER });
  ses.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders: Record<string, string[]> = { ...details.responseHeaders };
    for (const [name, value] of Object.entries(headers)) responseHeaders[name] = [value];
    callback({ responseHeaders });
  });

  // Uniquement le micro ; tout le reste (géolocalisation, notifications, presse-papiers, USB…) est
  // refusé sans même consulter l'utilisateur. La décision est dans `permissions.ts` (pure, testée) :
  // répondre « media » sans lire `mediaTypes` accordait aussi la CAMÉRA, alors que l'application n'en
  // fait aucun usage et que `Permissions-Policy` annonce `camera=()`.
  ses.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined;
    callback(isPermissionAllowed(permission, mediaTypes));
  });
  ses.setPermissionCheckHandler((_contents, permission, _origin, details) =>
    isPermissionCheckAllowed(permission, details.mediaType),
  );

  networkGuard = installNetworkGuard(ses, { devServerOrigin: DEV_SERVER, lanHosts: [] });

  if (!DEV_SERVER) registerAppProtocol(join(__dirname, '..', 'renderer'));
}

/**
 * (Re)enregistre le raccourci push-to-talk auprès du système, et publie le conflit s'il y en a un.
 *
 * `releasePushToTalk()` d'abord : `globalShortcut.register` refuse un accélérateur encore tenu — le
 * plus souvent par nous-mêmes, quand on change de raccourci en cours de session. Sans cette
 * libération, un changement de raccourci échouait sur son propre ancien enregistrement.
 */
function registerPushToTalkShortcut(): void {
  releasePushToTalk();
  ptt = registerPushToTalk(settings.talk.pttAccelerator, (active) => {
    bridge.setPushToTalk(active);
  });
  if (ptt.conflict) sendEvent(IPC.eventShortcutConflict, ptt.conflict);
}

/* ------------------------------------------------------------------ */
/* Mises à jour (avenant SPEC-006b, 2026-11-01)                        */
/* ------------------------------------------------------------------ */

/**
 * La version de l'application, LUE dans le `package.json` du paquet (jamais une constante
 * recopiée qui dériverait du build). Repli honnête `0.0.0` si la lecture échoue — avec cette
 * valeur, toute publication est considérée plus récente et le cycle suit ses gardes (empreinte,
 * salon) avant d'installer quoi que ce soit.
 */
function readAppVersion(): string {
  try {
    const loader = createRequire(__filename);
    const manifest = loader(join(app.getAppPath(), 'package.json')) as { version?: unknown };
    const version = manifest.version;
    return typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version) ? version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Le service de mise à jour, créé au démarrage dès que `userData` est connu. `null` avant le
 * démarrage : hors bootstrap, aucun geste. Tout I/O passe par son seam (`electronUpdateIo`) ;
 * `node:https` seul dans le process principal — `net-guard.ts` et `csp.ts` ne bougent pas (ils
 * gardent le renderer, pas le main ; l'avenant SPEC-006b ne les modifie pas).
 */
let updateService: UpdateService | null = null;

/**
 * La garde « jamais pendant un salon » (condition 6 de l'avenant) : les phases `joining`,
 * `connected`, `retrying` sont lues dans l'état du pont — le service ne connaît pas Electron,
 * c'est ici qu'on les lui rend. Relue à CHAQUE tentative, automatique comme manuelle.
 */
function roomActiveForUpdate(): boolean {
  const phase = bridge.getRoomState().phase;
  return phase === 'joining' || phase === 'connected' || phase === 'retrying';
}

/** Publie l'état de la machine à états vers la fenêtre principale seule (l'overlay n'a rien à dire). */
function publishUpdateState(state: UpdateStateDto): void {
  sendEvent(IPC.eventUpdateState, state, 'main');
}

/**
 * Enregistre les MESURES du service dans les réglages (`update.checkedAt`, `update.lastSeenVersion`)
 * sans déclencher de cycle : la date de dernière vérification et la dernière version vue sont des
 * faits observés, pas des réglages saisis. Écriture silencieuse en cas d'échec (un réglage de
 * mesure ne doit jamais casser un cycle de mise à jour).
 */
function persistUpdateMeasures(state: UpdateStateDto): void {
  if (state.state === 'checking') {
    try {
      persist({ ...settings, update: { ...settings.update, checkedAt: systemTimers.now() } });
    } catch (error) {
      console.error('[réglages] mesure checkedAt non enregistrée', error);
    }
    return;
  }
  if (state.version !== null && (state.state === 'up-to-date' || state.state === 'available' || state.state === 'downloading' || state.state === 'downloaded' || state.state === 'installing')) {
    try {
      persist({ ...settings, update: { ...settings.update, lastSeenVersion: state.version } });
    } catch (error) {
      console.error('[réglages] mesure lastSeenVersion non enregistrée', error);
    }
  }
}

// --- IPC -------------------------------------------------------------------------------------

/** Nom du compte OS, dernière ressource de A6 avant le défaut fixe. `userInfo()` peut lever. */
function osUserName(): string {
  try {
    return userInfo().username;
  } catch {
    return '';
  }
}

function isTrustedSender(url: string | undefined): boolean {
  if (!url) return false;
  if (DEV_SERVER) return url.startsWith(DEV_SERVER);
  return url.startsWith(`${APP_SCHEME}${SCHEME_SEP}`);
}

function sendEvent(
  channel: IpcEventChannel,
  payload: unknown,
  target: 'all' | 'main' | 'overlay' = 'all',
): void {
  // Le contrat est vérifié AVANT l'envoi : un événement mal formé ne doit jamais atteindre le
  // renderer, sinon les gardes du preload signaleraient une faute du process principal.
  const guarded = guardPayload('event', channel, payload);
  if (!guarded.ok) {
    console.error('[ipc] événement refusé', guarded.error);
    return;
  }
  const windows =
    target === 'main'
      ? [mainWindow]
      : target === 'overlay'
        ? [overlay.getWindow()]
        : [mainWindow, overlay.getWindow()];
  for (const window of windows) {
    if (window && !window.isDestroyed()) window.webContents.send(channel, guarded.value);
  }
}

/**
 * Dernier ensemble « qui parle » publié par le renderer qui mesure (AD-19 D1 / AD-20 D1).
 *
 * Le main le GARDE pour le rejouer à une fenêtre d'overlay qui vient de (re)charger — sans quoi
 * l'overlay resterait muet jusqu'à la prochaine transition, et une parole déjà en cours resterait
 * éteinte. Il ne le calcule ni ne le complète jamais : il recopie ce que le producteur a mesuré.
 */
let speakingNow: readonly string[] = [];

/** Relaie l'ensemble tel quel vers l'overlay seul (la fenêtre principale a sa propre table). */
function publishSpeaking(speaking: readonly string[]): void {
  speakingNow = speaking;
  sendEvent(IPC.eventSpeakingSet, { speaking }, 'overlay');
}

/* ------------------------------------------------------------------ */
/* Ducking (2026-11-01)                                                */
/* ------------------------------------------------------------------ */

/**
 * L'exécuteur système du ducking, créé au démarrage (`bootstrap`) avec le seam Electron
 * (`execFile`, timeout 2 s, kill). `null` avant le démarrage : hors bootstrap, aucun geste.
 */
let duckingController: DuckingController | null = null;
/** Dernière intention appliquée (idempotence par changement, comme la santé de découverte). */
let duckingActive = false;

/**
 * Le renderer qui MESURE (voice.ts) publie ici l'ensemble des pairs parlants — jamais soi.
 * La décision vient de la garde `shouldDuckForPeers` (pure, testée) avec l'id LOCAL que seul
 * le main connaît (`signalingLink.selfId`) : un producteur qui glisserait soi-même dans la
 * liste ne déclenche rien. L'option `audio.duckOthers` éteinte ⇒ AUCUN exec, aucune commande.
 */
function applyDuckingSignal(speaking: readonly string[]): void {
  const controller = duckingController;
  if (controller === null) return;
  if (!settings.audio.duckOthers) {
    // Option désactivée : le système n'est pas touché, même si un pair parle. Si le ducking
    // tournait encore (option coupée en cours de parole), on restaure une fois, puis silence.
    if (duckingActive) {
      duckingActive = false;
      controller.stop({ active: false, at: systemTimers.now() });
    }
    return;
  }
  const active = shouldDuckForPeers(speaking, signalingLink?.selfId ?? null);
  if (active === duckingActive) return;
  duckingActive = active;
  controller.apply({ active, at: systemTimers.now() });
}

/** Départ de salon / fermeture : le ducking ne survit jamais à la session qui l'a déclenché. */
function resetDucking(): void {
  duckingActive = false;
  duckingController?.stop({ active: false, at: systemTimers.now() });
}

/**
 * Liste des salons repérée sur le LAN. L'overlay ne consomme pas cet événement (il ne montre que
 * les participants d'un salon déjà rejoint) : on ne cible que la fenêtre principale.
 */
function publishRooms(rooms: RoomSummaryDto[]): void {
  sendEvent(IPC.eventRoomsDiscovered, rooms, 'main');
}

/**
 * État de santé de la découverte (mDNS) — uniquement pour la fenêtre principale : l'overlay n'a
 * rien à dire sur le réseau. Le renderer en tire le bandeau « mDNS indisponible » /
 * « Aucun réseau actif » et le pied de lobby.
 */
function publishDiscoveryHealth(health: DiscoveryHealth): void {
  discoveryHealth = health;
  sendEvent(IPC.eventDiscoveryStatus, { health }, 'main');
}

/**
 * Republie la géométrie de l'overlay. `overlay.apply` est le seul endroit qui connaît la règle de
 * taille (dépend du nombre de participants) ; ici on ne fait que republier son résultat pour que le
 * renderer de l'overlay suive. Sans cet appel, la pastille reste figée sur sa taille initiale.
 */
function syncOverlayGeometry(): void {
  const geometry = overlay.apply(settings.overlay, bridge.getRoomState().participantCount);
  if (!geometry) return;
  sendEvent(IPC.eventOverlayGeometry, {
    x: geometry.window.x,
    y: geometry.window.y,
    width: geometry.window.width,
    height: geometry.window.height,
    scaleFactor: geometry.scaleFactor,
  });
}

/**
 * Port de signalisation RÉELLEMENT utilisé (SPEC-001 A5, SPEC-002 D1) — lu, jamais supposé.
 *
 * L'onglet Réseau affichait `settings.network.signalingPort`, la valeur demandée dans les réglages :
 * le moteur ne la lit pas (il part de 47821 et incrémente si le port est pris), et SPEC-002 D1
 * interdit d'afficher un port qu'on n'a pas lu. On publie donc la mesure : la socket écoutée quand ce
 * poste héberge, le port annoncé par l'hôte quand il est client, rien hors salon.
 */
function currentSignalingPort(): number | null {
  return effectiveSignalingPort({
    listen: signalingLink?.listen ?? null,
    roomId: bridge.getRoomState().roomId,
    rooms: discovery.list(),
  });
}

/**
 * Vue structurée du pied de lobby (SPEC-002 `LobbyFooter { port, discoveryMethod, offline }`).
 *
 * Trois MESURES, jamais des réglages ni du texte libre : le port lu par `currentSignalingPort`,
 * la méthode réellement en service (mDNS seulement — le balayage broadcast n'existe pas dans ce
 * code et `'broadcast'`/`'both'` restent éteints tant qu'aucun émetteur honnête ne les porte),
 * et la santé remontée par le bridge.
 */
function currentLobbyStatus(): LobbyStatusDto {
  return {
    port: currentSignalingPort(),
    method: discoveryHealth === 'ok' ? 'mdns' : 'none',
    health: discoveryHealth,
  };
}

function forwardBridgeEvent(event: BridgeEvent): void {
  // `BridgeEvent.channel` porte les VALEURS du canon (`lan:event:participants`, …), pas les noms
  // de clés : on ne transmet donc aucune conversion, et le discriminant reste vérifié par le type.
  // L'état de salon part enrichi du port effectif : il n'existe que dans le main (socket d'écoute,
  // annonces lues), et l'UI n'a pas le droit de l'inventer.
  if (event.channel === IPC.eventRoomState) {
    sendEvent(event.channel, { ...event.payload, signalingPort: currentSignalingPort() });
  } else {
    sendEvent(event.channel, event.payload);
  }
  // Comparaison contre les VALEURS du canon (`IPC.*`). Un littéral repris du nom de clé est toujours
  // différent de la valeur `'lan:event:…'` correspondante : il rendrait ce branchement mort.
  // C'est le bug corrigé ici : `overlay.apply` n'était plus jamais rappelé, la pastille overlay
  // restait figée sur la taille du premier rendu.
  if (event.channel === IPC.eventParticipants || event.channel === IPC.eventRoomState) {
    syncOverlayGeometry();
    // La population vient de bouger (ou le salon de phase) : le TXT `participants` publié doit
    // suivre, sinon un salon plein reste affiché « libre » chez les voisins.
    reannounceHostedRoom();
  }
}

function persist(next: Settings): void {
  const previousSettings = settings;
  settings = next;
  try {
    store.save(next);
  } catch (error) {
    console.error('[réglages] écriture impossible', error);
  }
  // Le raccourci push-to-talk est enregistré AUPRÈS DU SYSTÈME : écrire la nouvelle valeur dans les
  // réglages ne suffit pas (l'ancien accélérateur restait réservé, le nouveau ne répondait pas
  // jusqu'au redémarrage). On ne ré-enregistre que s'il a changé.
  if (pushToTalkAcceleratorChanged(previousSettings, next)) registerPushToTalkShortcut();
  sendEvent(IPC.eventSettingsChanged, { settings });
  // Un réglage d'overlay (taille, échelle, écran) change la géométrie : il faut la republier, sinon
  // le renderer de l'overlay garde l'ancienne. `syncOverlayGeometry` fait l'apply + la publication.
  syncOverlayGeometry();
}

function overlayPatchToSettings(patch: OverlayPatchPayload): unknown {
  const overlayUpdate: Record<string, unknown> = {};
  if (patch.visible !== undefined) overlayUpdate['enabled'] = patch.visible;
  if (patch.opacity !== undefined) overlayUpdate['opacity'] = patch.opacity;
  if (patch.scale !== undefined) overlayUpdate['scale'] = patch.scale;
  if (patch.screenId !== undefined) overlayUpdate['screenId'] = patch.screenId;
  if (patch.position !== undefined) overlayUpdate['position'] = patch.position;
  return { overlay: overlayUpdate };
}

/**
 * Rétrécissement des charges utiles d'invoke.
 *
 * `guardPayload('invoke', …)` a DÉJÀ validé la forme à l'exécution, mais rend `unknown` : c'est sa
 * signature publique, identique pour les onze canaux. Un handler doit pourtant déclarer en types la
 * forme qu'il consomme. On le fait par prédicats de type — jamais par un cast, un `!` ou une
 * directive de suppression de type : si un prédicat échoue ici, c'est que le contrat et le handler
 * ont divergé, et on lève alors une `IpcContractError` (faute de contrat visible côté renderer)
 * au lieu de laisser passer un `undefined`.
 */
function expectPayload<T>(channel: IpcInvokeChannel, value: unknown, is: (raw: unknown) => raw is T): T {
  if (is(value)) return value;
  throw new IpcContractError({
    code: 'invalid-payload',
    channel,
    path: 'payload',
    message: `forme de charge utile inattendue après validation du contrat (${channel})`,
  });
}

function isAvatarImagePayload(raw: unknown): raw is { avatarRef: string } {
  return isRecord(raw) && typeof raw['avatarRef'] === 'string';
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

// `switch` de correction : chaque prédicat reprend les champs que `guardInvoke` exige pour son canal.
function isRoomJoinPayload(raw: unknown): raw is RoomJoinPayload {
  return isRecord(raw) && typeof raw['roomId'] === 'string' && typeof raw['name'] === 'string';
}

function isMutePayload(raw: unknown): raw is { muted: boolean } {
  return isRecord(raw) && typeof raw['muted'] === 'boolean';
}

function isDeafenPayload(raw: unknown): raw is { deafened: boolean } {
  return isRecord(raw) && typeof raw['deafened'] === 'boolean';
}

function isPushToTalkPayload(raw: unknown): raw is { active: boolean } {
  return isRecord(raw) && typeof raw['active'] === 'boolean';
}

function isGainPayload(raw: unknown): raw is GainPayload {
  return isRecord(raw) && typeof raw['participantId'] === 'string' && typeof raw['gain'] === 'number';
}

function isSpeakingSetPayload(raw: unknown): raw is SpeakingSetPayload {
  if (!isRecord(raw)) return false;
  const speaking = raw['speaking'];
  return Array.isArray(speaking) && speaking.every((id: unknown) => typeof id === 'string');
}

// Ducking (2026-11-01) : même forme que `isSpeakingSetPayload` — le contrat a déjà borné la
// liste, ce prédicat ne fait que la rendre typée au handler (jamais un cast).
function isDuckingApplyPayload(raw: unknown): raw is { speaking: string[] } {
  if (!isRecord(raw)) return false;
  const speaking = raw['speaking'];
  return Array.isArray(speaking) && speaking.every((id: unknown) => typeof id === 'string');
}

function isOverlayPatchPayload(raw: unknown): raw is OverlayPatchPayload {
  if (!isRecord(raw)) return false;
  const visible = raw['visible'];
  const opacity = raw['opacity'];
  const scale = raw['scale'];
  const screenId = raw['screenId'];
  const position = raw['position'];
  if (visible !== undefined && typeof visible !== 'boolean') return false;
  if (opacity !== undefined && typeof opacity !== 'number') return false;
  if (scale !== undefined && scale !== 'sm' && scale !== 'md' && scale !== 'lg') return false;
  if (screenId !== undefined && screenId !== null && typeof screenId !== 'string') return false;
  if (position !== undefined && position !== null) {
    if (!isRecord(position)) return false;
    if (typeof position['x'] !== 'number' || typeof position['y'] !== 'number') return false;
  }
  return true;
}

/**
 * Ouvre le tuyau de signalisation du salon (T16b / SPEC-007 §4.3).
 *
 * Hôte : on écoute sur UNE adresse du LAN (jamais 0.0.0.0 : `pickListenHost` ne rend qu'une
 * adresse privée ou le loopback, et `createSignalingLink` refuse toute autre valeur).
 * Client : un salon découvert par mDNS porte son hôte et son port, on s'y connecte.
 */
function startSignalingLink(roomId: string, name: string, selfId: string, avatarRef: string | undefined): void {
  stopSignalingLink('changement de salon');
  const remote = discovery.list().find((room) => room.roomId === roomId);
  const listenHost = pickListenHost(networkInterfaces());
  const role: 'host' | 'client' = remote ? 'client' : 'host';
  signalingLink = createSignalingLink({
    role,
    localId: selfId,
    name,
    // Le join transporte l'EMPREINTE de l'avatar, jamais l'image : le nom d'une galerie voyage
    // tel quel, un avatar personnalisé voyage sous son empreinte (le binaire ne suit que si un
    // pair du LAN le demande explicitement, par `avatar_get`).
    ...(avatarRef !== undefined ? { avatarRef } : {}),
    // Le lien répond aux `avatar_get` en lisant le magasin (revalidation à la lecture). Le callback
    // est fourni en plus : sans magasin injecté, la demande remonte au main plutôt que expirer.
    ...(avatarStore === null ? {} : { avatarStore }),
    onAvatarGet: (request) => {
      if (!avatarStore) {
        signalingLink?.answerAvatarGet(request, null);
        return;
      }
      try {
        const loaded = avatarStore.load(request.avatarRef);
        signalingLink?.answerAvatarGet(request, loaded.ok ? encodeAvatarPngForWire(loaded.data) : null);
      } catch {
        signalingLink?.answerAvatarGet(request, null);
      }
    },
    host: role === 'client' && remote ? remote.host : listenHost,
    ...(role === 'client' && remote ? { port: remote.port } : {}),
    now: () => systemTimers.now(),
    onMessage: (message) => {
      // L'annuaire suit la présence de signalisation AVANT d'envoyer le message au renderer :
      // `peer-joined`/`peer-left` étaient jusqu'ici transmis sans que personne ne tienne la liste.
      if (message.kind === 'avatar-data') {
        // Le PNG d'un pair arrive par la signalisation (le beacon/join ne portent que
        // l'empreinte). On le décode et le valide ICI — le renderer ne touche jamais un binaire
        // suspect : si le contenu ne passe pas les bornes, il ne le verra pas et restera aux
        // initiales. En mémoire seule : l'image d'autrui n'est jamais écrite sur notre disque.
        const png = message.data === null ? null : decodeAvatarPngFromWire(message.data);
        if (png !== null) {
          const encoded = encodeAvatarPngForWire(png);
          if (encoded !== null) sessionAvatars.set(message.avatarRef, encoded);
        }
      } else if (message.kind === 'peer-joined' && message.avatarRef !== undefined) {
        // Un pair annonce une empreinte que nous ne connaissons pas : la demande d'image part
        // immédiatement (le lien la borne et la ferme lui-même ; une galerie n'est jamais
        // demandée, ses emoji sont embarqués des deux côtés).
        const ref = message.avatarRef;
        if (!isAvatarRef(ref) && !isGalleryAvatarId(ref)) {
          // `guardParticipant` a déjà filtré, mais le main ne fait pas confiance en aval : rien.
        } else if (isAvatarRef(ref) && !sessionAvatars.has(ref)) {
          signalingLink?.requestAvatar(message.peerId, ref);
        }
      }
      applyRoster(message);
      sendEvent(IPC.eventSignal, message);
    },
    onListen: (listen) => {
      // Annonce mDNS (SPEC-001 A5) : le salon que CETTE machine héberge devient rejoignable. Sans
      // elle, aucun autre poste ne voyait de salon — la liste restait vide et « rejoindre » un
      // salon distant était impossible sur un vrai réseau.
      if (role !== 'host') return;
      // Un lien remplacé (ou fermé) entre le bind et ce rappel ne doit pas annoncer un port mort.
      if (signalingLink === null) return;
      const state = bridge.getRoomState();
      discovery.announce({
        roomName: state.roomName ?? roomId,
        port: listen.port,
        participants: state.participantCount,
      });
    },
  });
}

/**
 * Republie l'annonce mDNS du salon hébergé avec la population ACTUELLE.
 *
 * Sans ce geste, le TXT `participants` publié au bind restait figé : un salon plein se lisait
 * « libre » chez tous les voisins, qui cliquaient sur un « Rejoindre » voué au refus. Appelé à
 * chaque évolution du salon (`forwardBridgeEvent`), et seulement quand CE poste héberge — un
 * client n'a rien à annoncer.
 */
function reannounceHostedRoom(): void {
  const link = signalingLink;
  if (link === null || link.role !== 'host') return;
  const listen = link.listen;
  if (listen === null) return;
  const state = bridge.getRoomState();
  // Le salon est parti (`leave` a vidé l'état) : le lien part avec lui par un autre chemin,
  // et `stopSignalingLink` retire l'annonce. Rien à publier entre-temps.
  if (state.roomId === null) return;
  discovery.announce({
    roomName: state.roomName ?? state.roomId,
    port: listen.port,
    participants: state.participantCount,
  });
}

/** Ferme le tuyau (« leave » émis, sockets fermées) — idempotent. */
/**
 * Reporte un message de signalisation sur l'annuaire du salon (`roster-link`).
 *
 * L'état du salon part déjà vers le renderer depuis `RoomBridge` (`lan:event:participants` /
 * `lan:event:room-state`) : rien d'autre à publier ici.
 */
function applyRoster(message: SignalIn): void {
  applySignalToRoster(bridge, message, signalingLink?.selfId ?? null);
}

function stopSignalingLink(detail: string): void {
  const link = signalingLink;
  signalingLink = null;
  // Le salon n'est plus hébergé ici : l'annonce mDNS doit disparaître en même temps que le lien,
  // sinon les autres postes continuent de proposer un salon injoignable.
  discovery.retract();
  if (link === null) return;
  try {
    link.close(detail);
  } catch (error) {
    console.error('[signalisation] fermeture impossible', error);
  }
}

function registerIpcHandlers(): void {
  // Charges utiles reçues en `unknown` (forme rendue par le contrat) et rétrécies dans chaque
  // handler par `expectPayload` : la table n'a donc plus besoin d'être contrainte en `never`.
  // `avatarChoose` est géré à part : sa boîte de dialogue est asynchrone (`await dialog`).
  const handlers: Record<Exclude<IpcInvokeChannel, (typeof IPC)['avatarChoose']>, (payload: unknown) => unknown> = {
    [IPC.settingsGet]: () => settings,
    [IPC.settingsSet]: (payload: unknown) => {
      const result = applySettingsPatch(settings, payload);
      if (!result.ok) {
        const detail = result.errors.map((error) => `${error.path}:${error.code}`).join(', ');
        throw new Error(`réglages refusés (${detail})`);
      }
      persist(result.value);
      // `persist` a déjà publié l'événement `settings-changed` — l'annuaire local est aligné APRÈS,
      // et la publication de l'annuaire suit : le renderer reçoit l'événement réglages, puis un
      // annuaire cohérent avec lui. Les pairs déjà connectés apprendront le nouvel avatar au
      // prochain `join` — un `join` est l'annonce de l'identité, pas un flux continu.
      bridge.setSelfAvatar(avatarRefForJoin(settings.avatar) ?? null);
      return settings;
    },
    [IPC.settingsOpen]: () => {
      const window = mainWindow ?? createMainWindow();
      window.show();
      window.focus();
    },
    // Porte d'entrée du panneau profil (pseudo + avatar). Le MAIN ne fait que sortir la fenêtre :
    // c'est le renderer qui ouvre le panneau, sur cet événement. L'implémentation complète du
    // panneau (galerie, avatar) vit sur `feature/profile-lobby` — ce canal est sa prise, pas son corps.
    [IPC.profileOpen]: () => {
      const window = mainWindow ?? createMainWindow();
      window.show();
      window.focus();
      sendEvent(IPC.eventProfileOpen, {}, 'main');
    },
    // Le pied de lobby demande la vue structurée : trois mesures du main, rien d'inventé ici.
    [IPC.lobbyStatusGet]: () => currentLobbyStatus(),
    // Charge utile VIDE (contrat) : le scan est déjà lancé au démarrage, on rend l'état du registre.
    [IPC.roomsDiscover]: () => discovery.list(),
    [IPC.roomJoin]: (payload: unknown) => {
      const join = expectPayload(IPC.roomJoin, payload, isRoomJoinPayload);
      // `join.name` est le nom du SALON ; le nom du participant local vient des réglages (A6),
      // jamais du champ qui décrit le salon.
      const state = bridge.join(join, resolveDisplayName(settings.nickname, osUserName()));
      // Salon refusé (plafond atteint) : aucun tuyau à ouvrir.
      if (state.roomId !== null && state.selfId !== null) {
        bridge.setSelfAvatar(avatarRefForJoin(settings.avatar) ?? null);
        startSignalingLink(state.roomId, join.name, state.selfId, avatarRefForJoin(settings.avatar));
      }
      return state;
    },
    [IPC.roomLeave]: () => {
      stopSignalingLink('départ du salon');
      // Le salon n'est plus : plus personne n'est mesuré, la baisse des autres applications
      // s'arrête immédiatement (restaurée par le contrôleur).
      resetDucking();
      return bridge.leave();
    },
    // La charge utile a déjà été validée par `guardPayload(IPC.signalSend, …)` : ici on ne
    // fait que la passer au tuyau, qui applique en plus le filtre ICE LAN.
    [IPC.signalSend]: (payload: unknown) => {
      const message = payload as SignalOut;
      if (signalingLink === null) return;
      signalingLink.send(message);
    },
    [IPC.controlSetMute]: (payload: unknown) =>
      bridge.setMute(expectPayload(IPC.controlSetMute, payload, isMutePayload).muted),
    [IPC.controlSetDeafen]: (payload: unknown) =>
      bridge.setDeafened(expectPayload(IPC.controlSetDeafen, payload, isDeafenPayload).deafened),
    [IPC.controlSetPushToTalk]: (payload: unknown) =>
      bridge.setPushToTalk(expectPayload(IPC.controlSetPushToTalk, payload, isPushToTalkPayload).active),
    [IPC.controlSetGain]: (payload: unknown) => {
      const gain = expectPayload(IPC.controlSetGain, payload, isGainPayload);
      bridge.setGain(gain.participantId, gain.gain);
    },
    // AD-20 D1 : le main RECOPIE l'ensemble `speaking[]` tel quel — il ne le recombine pas, donc il
    // n'en devient pas un second avis (AD-17 D1). Le garder en mémoire permet de le rejouer à une
    // fenêtre d'overlay qui (re)charge sans attendre la transition suivante.
    [IPC.speakingSet]: (payload: unknown) =>
      publishSpeaking(expectPayload(IPC.speakingSet, payload, isSpeakingSetPayload).speaking),
    [IPC.avatarGetImage]: (payload: unknown) => {
      // Le renderer ne demande que des empreintes déjà reçues d'un pair ; le contrat a validé la
      // forme, `load()` revalide l'empreinte ET les octets (signature PNG + taille). Fichier
      // absent ou corrompu → `null` : l'affichage reste sur les initiales.
      const ref = expectPayload(IPC.avatarGetImage, payload, isAvatarImagePayload).avatarRef;
      // Deux sources, dans l'ordre : l'image reçue d'un pair pendant la session (mémoire seule),
      // puis MES propres images stockées (un pair peut arborer mon propre avatar, renvoyé par
      // `avatar_data` — il doit s'afficher aussi). Empreinte invalidée ou fichier corrompu →
      // `null` : l'affichage reste sur les initiales, jamais une image inventée.
      const cached = sessionAvatars.get(ref);
      if (cached !== undefined) return cached;
      if (!avatarStore) return null;
      const loaded = avatarStore.load(ref);
      return loaded.ok ? encodeAvatarPngForWire(loaded.data) : null;
    },
    [IPC.overlaySet]: (payload: unknown) => {
      const patch = expectPayload(IPC.overlaySet, payload, isOverlayPatchPayload);
      const result = applySettingsPatch(settings, overlayPatchToSettings(patch));
      if (!result.ok) {
        const detail = result.errors.map((error) => `${error.path}:${error.code}`).join(', ');
        throw new Error(`overlay refusé (${detail})`);
      }
      persist(result.value);
    },
    // Ducking (2026-11-01) : le renderer qui mesure publie les pairs parlants ; le main garde
    // la décision (garde pure `shouldDuckForPeers`, option, horodatage) et l'exécution (seam).
    [IPC.duckingApply]: (payload: unknown) => {
      const speaking = expectPayload(IPC.duckingApply, payload, isDuckingApplyPayload).speaking;
      applyDuckingSignal(speaking);
    },
    // Mises à jour (2026-11-01) : le renderer DEMANDE, le service décide. Charge utile déjà
    // réduite à `{}` par le contrat — rien à lire ici, tout est dans le service.
    [IPC.updateCheckNow]: () => {
      const service = updateService;
      if (service === null) return;
      void service.checkNow();
    },
    [IPC.updateInstallNow]: () => {
      const service = updateService;
      if (service === null) return;
      void service.installUpdateNow();
    },
  };

  for (const channel of Object.keys(handlers) as IpcInvokeChannel[]) {
    ipcMain.handle(channel, (event, rawPayload: unknown) => {
      if (!isTrustedSender(event.senderFrame?.url)) {
        throw new Error(`émetteur IPC non autorisé pour ${channel}`);
      }
      const guarded = guardPayload('invoke', channel, rawPayload);
      // Rejet typé : le renderer (et `assertPayload` côté preload) distingue une faute de contrat
      // d'une erreur métier grâce à `IpcContractError` (code / channel / path).
      if (!guarded.ok) throw new IpcContractError(guarded.error);
      const handler = handlers[channel as Exclude<IpcInvokeChannel, (typeof IPC)['avatarChoose']>];
      // Plus aucun forçage : `guarded.value` est `unknown` et `handler` accepte `unknown`, le
      // rétrécissement se fait dans le handler via `expectPayload`.
      return handler(guarded.value);
    });
  }

  // Le choix d'image est asynchrone (boîte de dialogue), donc hors de la table `handlers` —
  // même émetteur autorisé, même garde de contrat sur la réponse, mais un `await` légitime.
  ipcMain.handle(IPC.avatarChoose, async (event, rawPayload: unknown) => {
    if (!isTrustedSender(event.senderFrame?.url)) {
      throw new Error(`émetteur IPC non autorisé pour ${IPC.avatarChoose}`);
    }
    const guarded = guardPayload('invoke', IPC.avatarChoose, rawPayload);
    if (!guarded.ok) throw new IpcContractError(guarded.error);
    if (!avatarStore) return { ok: false, reason: 'unreadable' } as const;
    const picked = await dialog.showOpenDialog({
      title: 'Concord',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (picked.canceled || picked.filePaths.length !== 1) {
      return { ok: false, reason: 'cancelled' } as const;
    }
    const path = picked.filePaths[0];
    if (path === undefined) return { ok: false, reason: 'unreadable' } as const;
    return avatarStore.importFromPath(path);
  });

  // Aucun autre canal n'est écouté : `ipcMain.handle` sur une liste fermée, pas de wildcard.
  console.info('[ipc] canaux enregistrés :', Object.keys(handlers).length + 1, '· écrans :', listDisplays().length);
}

/* ---------------------------------------------------------------------------
 * Sonde de test (EXÉCUTION, pas regex).
 *
 * `tests/main-lobby-probe.ts` installe un hook `require` pour `electron` et
 * `bonjour-service`, importe ce module, et joue les scénarios du lobby permanent :
 * santé → événement + instantané du pied, TXT republié à chaque évolution de population,
 * port du pied = mesure réelle du bind. Ces expositions sont le strict minimum pour
 * EXÉCUTER la chaîne main → écran ; elles ne changent AUCUN comportement de production
 * (aucun appelant en production, élaguées du bundle par aucune référence — le preload et
 * le renderer ignorent ce bloc).
 * ------------------------------------------------------------------------- */
export const __mainForTests = {
  bootstrap,
  publishDiscoveryHealth,
  forwardBridgeEvent,
  currentLobbyStatus,
  /** Injecte un lien (double ou réel) comme si `startSignalingLink` venait de le créer. */
  setSignalingLink(link: SignalingLink | null): void {
    signalingLink = link;
  },
  /** Publie l'annonce d'un salon hébergé (même chemin que le rappel `onListen`). */
  announceHostedRoom(room: { roomName: string; port: number; participants: number }): void {
    discovery.announce(room);
  },
  /** Retire l'annonce (même chemin que `stopSignalingLink`). */
  retractHostedRoom(): void {
    discovery.retract();
  },
} as const;
