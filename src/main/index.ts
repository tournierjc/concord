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

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, screen, session, Tray } from 'electron';
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
import {
  createRoomRecreator,
  type RecreateState,
  type RoomRecreator,
} from './room-recreate';
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
import { probePrimaryAddress } from './primary-address';
import {
  createSignalingLink,
  listListenHosts,
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
  type TalkModeDto,
  type UpdateStateDto,
} from '../shell/ipc-contract';
import {
  applySettingsPatch,
  defaultSettings,
  pushToTalkAcceleratorChanged,
  resolveDisplayName,
  MAX_ROOM_PARTICIPANTS,
  type Settings,
} from '../shell/settings-schema';
import { trayLabels } from '../shell/tray-labels';

/**
 * Serveur de développement Vite (boucle locale uniquement, port 5173). Jamais défini en production :
 * le bundle est alors servi par `app://`, sans socket.
 */
const DEV_SERVER = process.env['LAN_DEV_SERVER'] ?? null;

let mainWindow: BrowserWindow | null = null;
let settings: Settings = defaultSettings();
/** Icône de la barre des tâches/système. `null` tant que l'app n'a pas démarré (ou sans icône). */
let tray: Tray | null = null;
/**
 * Vrai UNIQUEMENT pendant une fermeture voulue (`app.quit()` : menu de l'icône, mise à jour
 * installée). Fermer la fenêtre autrement la cache dans la zone de notification au lieu de
 * quitter — la sortie réelle passe par le menu de l'icône, jamais par un process invisible.
 */
let quitting = false;
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
    // A relaunch must always end with a visible window: returning early when the main window was
    // gone swallowed every launch from the Start menu shortcut while the first process lived on.
    // Same contract when the first instance sits hidden in the notification area (0.4.2): the
    // second launch brings the existing window back on screen instead of doing nothing.
    showMainWindow();
  });
  // Doit être appelé avant `app.whenReady()`.
  registerAppScheme();
  // ICE sous Chromium (2026-11-02, retour JC : « Pas de flux audio » Linux ↔ Windows) : sans
  // STUN, Chromium ne collecte que des candidats `host`, et depuis Chrome 109 il les publie en
  // noms mDNS (`xxxx.local`) par confidentialité — un pair qui ne résout pas le mDNS de l'autre
  // (pare-feu, réseau, pile mDNS absente) n'a AUCUN candidat à tester et le lien meurt en
  // `noFlow`. Le correctif est la LEVÉE de ce masquage (`WebRtcHideLocalIpsWithMdns` désactivé) :
  // les candidats `host` partent en adresses littérales, que tout pair LAN peut tester. Aucune
  // exposition ajoutée : `iceServers: []` interdit srflx/relay et la porte `isLanCandidate`
  // refuse hors LAN avant émission — seuls des candidats déjà LAN-partageables circulent.
  // (Un appel ultérieur de même clé gagne : le réglage reste unique, jamais fusionné.)
  app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
  void app.whenReady().then(bootstrap);
}

app.on('window-all-closed', () => {
  // L'overlay est une fenêtre outil : sa fermeture ne doit pas laisser le process tourner.
  // La fenêtre principale ne ferme plus : elle se cache dans la zone de notification (0.4.2) —
  // cet évènement ne se déclenche donc plus que sur une sortie réelle (`app.quit()`).
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  // La fermeture de fenêtre qui suit `app.quit()` doit PASSER : c'est une sortie voulue, pas un
  // rangement dans la zone de notification.
  quitting = true;
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

app.on('will-quit', () => {
  releasePushToTalk();
  // L'icône de la zone de notification ne survit pas au process : sans destruction explicite, elle
  // resterait affichée après la sortie (icône fantôme jusqu'au survol).
  tray?.destroy();
  tray = null;
  // Le ducking ne survit pas à la fermeture : si une baisse était en cours, elle est annulée.
  resetDucking();
  // Les minuteries du service de mise à jour ne survivent pas à la fermeture (un téléchargement
  // en vol est abandonné — un `.part` orphelin est repris ou nettoyé au prochain cycle).
  updateService?.stop();
  // Salon automatique (2026-11-02) : la minuterie des 2 s ne survit pas à la fermeture — un
  // recréage qui partirait pendant que l'app se ferme créerait un salon que personne ne verra.
  roomRecreator?.stop();
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
  createTray();
  // No overlay at boot: `syncOverlayGeometry` creates it when a room is joined and destroys it on
  // leave (one renderer process fewer, ~90 MB, while idle in the lobby).

  registerIpcHandlers();
  // Enregistre le raccourci push-to-talk auprès du système ET publie un éventuel conflit : l'UI doit le dire,
  // pas le masquer (le second envoi qui vivait en fin de `bootstrap` faisait doublon).
  registerPushToTalkShortcut();
  // Après les fenêtres : le premier `onRooms` doit trouver un renderer à qui parler.
  discovery.start();

  // Adresse de sortie (2026-11-02, fix « aucune réponse » du join) : première sonde tout de
  // suite, puis relecture toutes les 30 s. Le join lit le cache (jamais d'attente réseau).
  refreshPrimaryAddress();
  systemTimers.repeat(PRIMARY_ADDRESS_REFRESH_MS, refreshPrimaryAddress);

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
    // L'exécutable courant : la relance post-installeur attend ce fichier puis le redémarre
    // (NSIS assisté silencieux ne relance jamais lui-même — fix 2026-11-02).
    installedExePath: () => process.execPath,
    onStateChange: (state) => {
      // Publication immédiate (l'UI suit la machine en direct), puis enregistrement des MESURES
      // (checkedAt, lastSeenVersion) — des faits observés, jamais des réglages saisis.
      publishUpdateState(state);
      persistUpdateMeasures(state);
    },
  });
  updateService.start();

  // Salon automatique à la reprise (2026-11-02) : créé APRÈS les fenêtres, les handlers et la
  // découverte — le premier état publié doit trouver un renderer à qui parler, et la minuterie de
  // 2 s (`RECREATE_STARTUP_DELAY_MS`, portée par `systemTimers`, SPEC-012 §4) laisse le browse
  // mDNS et les liaisons réseau s'établir avant tout geste. `arm()` est une décision pure : option
  // éteinte ou pas de mesure ⇒ RIEN n'est écrit, RIEN n'est publié (la lecture des réglages ne
  // compte pas comme action). Le geste passe par `hostRoomFromSettings` — le même chemin que le
  // « Créer et rejoindre » manuel du lobby, jamais une voie bis.
  roomRecreator = createRoomRecreator({
    host: hostRoomFromSettings,
    // `updatePendingInstall` lu À L'ÉCHÉANCE : une mise à jour prête verrouille le recréage —
    // entrer en salon empêcherait l'installation pour toute la session (règle « jamais en salon »).
    settings: () => ({
      auto: settings.room.auto,
      lastHosted: settings.room.lastHosted,
      updatePendingInstall: updateService?.getState().state === 'downloaded',
    }),
    discoveredNames: () => discovery.list().map((room) => room.roomName),
    timers: systemTimers,
    onStateChange: publishRecreateState,
  });
  roomRecreator.arm();

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

/**
 * Upper bound on the wait for `ready-to-show`. That event never fires when the GPU process fails
 * to start (seen with some Windows drivers and remote sessions): the app was running, but with
 * `show: false` the user saw nothing at all.
 */
const SHOW_FALLBACK_MS = 3000;

/** Matches `--color-bg-canvas` of each theme, so the first frame isn't a flash of the other one. */
function windowBackground(): string {
  const theme = settings.theme;
  const dark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors);
  return dark ? '#0E1116' : '#F4F6F9';
}

/**
 * Ramène la fenêtre principale à l'écran : relance existante (`second-instance`), clic sur
 * l'icône de la zone de notification, entrée « Ouvrir » de son menu. Une fenêtre cachée dans la
 * zone de notification doit revenir EXACTEMENT comme une fenêtre minimisée : montrée, ramenée de
 * la barre des tâches si besoin, et focalisée.
 */
function showMainWindow(): void {
  const window = mainWindow ?? createMainWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

/**
 * L'icône de la zone de notification, lue dans les ressources de l'app (embarquée dans l'asar
 * comme le reste du paquet — `nativeImage` sait lire un chemin d'asar). En développement, c'est
 * le `buildResources` du dépôt. `isEmpty()` fait foi : sans image lisible, pas d'icône — et
 * surtout pas de rangement dans une zone de notification qui n'existerait nulle part.
 */
function trayIconPath(): string {
  return join(app.getAppPath(), 'build', 'icon.png');
}

/**
 * L'icône de la zone de notification (0.4.2) : le seul endroit où l'app se rend visible quand sa
 * fenêtre est cachée, et le seul geste de sortie réel (« Quitter »). Créée au démarrage, détruite
 * à la fermeture ; sans icône lisible, elle n'est pas créée du tout et la fermeture de fenêtre
 * reste une vraie fermeture (pas de process sans visage).
 */
function createTray(): void {
  if (tray || process.platform === 'darwin') return;
  const image = nativeImage.createFromPath(trayIconPath());
  if (image.isEmpty()) {
    console.error('[zone de notification] icône illisible :', trayIconPath(), '— fermer la fenêtre quittera l’app');
    return;
  }
  const labels = trayLabels(settings.locale);
  tray = new Tray(image);
  tray.setToolTip('Concord');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: labels.show, click: () => showMainWindow() },
      { type: 'separator' },
      {
        label: labels.quit,
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  // Clic gauche (Windows) / clic simple (la plupart des bureaux Linux) : la fenêtre revient.
  tray.on('click', () => showMainWindow());
}

function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;

  const icon = devWindowIcon();
  const window = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    show: false,
    ...(icon === undefined ? {} : { icon }),
    backgroundColor: windowBackground(),
    autoHideMenuBar: true,
    title: 'Concord',
    webPreferences: secureWebPreferences({ devTools: !app.isPackaged }),
  });

  harden(window.webContents);
  // CONCORD_SIGNAL_DEBUG : le journal du process ne voyait que les lignes `<=` du
  // tuyau. Les erreurs du renderer (micro refusé, rôle du maillage) y remontent,
  // et la page active les traces `[mesh]` déjà gardées par `__CONCORD_DEBUG__`.
  if (process.env.CONCORD_SIGNAL_DEBUG) {
    window.webContents.on('console-message', (_event, level, message) => {
      if (level < 2) return;
      console.error(`[renderer] ${message}`);
    });
    window.webContents.on('dom-ready', () => {
      if (window.isDestroyed()) return;
      void window.webContents.executeJavaScript('globalThis.__CONCORD_DEBUG__ = true').catch(() => undefined);
    });
  }
  const reveal = (): void => {
    if (!window.isDestroyed() && !window.isVisible()) window.show();
  };
  window.once('ready-to-show', reveal);
  systemTimers.once(SHOW_FALLBACK_MS, reveal);
  window.on('close', (event) => {
    // Fermer la fenêtre la range dans la zone de notification (0.4.2) : le process reste
    // joignable (salon en cours, raccourci PTT global, relance qui ramène la fenêtre). La sortie
    // réelle passe par le menu de l'icône (`Quitter`) — ou par `app.quit()` (mise à jour), qui
    // bascule `quitting` AVANT que cet évènement ne se déclenche. macOS garde son comportement
    // standard (fermer la fenêtre, l'app vit dans le dock).
    if (quitting || process.platform === 'darwin') return;
    event.preventDefault();
    window.hide();
  });
  window.on('closed', () => {
    mainWindow = null;
    // The overlay is a satellite of the main window. Left open, it kept `window-all-closed` from
    // firing: the process lived on invisibly and held the single-instance lock.
    overlay.destroy();
  });
  window.webContents.on('preload-error', (_event, preloadFile, error) => {
    console.error('[fenêtre principale] preload non chargé :', preloadFile, error);
  });
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error('[fenêtre principale] chargement échoué :', code, description, url);
  });
  let reloads = 0;
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('[fenêtre principale] renderer arrêté :', details.reason);
    if (details.reason !== 'clean-exit' && reloads < 1 && !window.isDestroyed()) {
      reloads += 1;
      window.webContents.reload();
    }
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
  overlay.load(DEV_SERVER ? new URL('overlay.html', DEV_SERVER).toString() : undefined);
  // AD-20 D1 : une overlay qui (re)charge ne peut pas attendre la prochaine transition — une parole
  // déjà en cours resterait éteinte. On rejoue le dernier ensemble connu, tel quel.
  overlay.getWindow()?.webContents.once('did-finish-load', () => {
    // Created mid-session: the room events it subscribes to have already been sent.
    sendEvent(IPC.eventRoomState, {
      ...bridge.getRoomState(),
      signalingPort: currentSignalingPort(),
      selfSignalingId: signalingLink?.selfId ?? null,
    }, 'overlay');
    sendEvent(IPC.eventParticipants, bridge.getParticipants(), 'overlay');
    publishSpeaking(speakingNow);
    syncOverlayGeometry();
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
 * Adresse de sortie de la machine (route par défaut), lue par la sonde `probePrimaryAddress`
 * (2026-11-02, fix « aucune réponse » du join). Cache TENU par le main : une sonde au démarrage,
 * puis toutes les 30 s — une adresse de sortie change rarement en séance, et un join ne doit
 * JAMAIS attendre une I/O réseau pour choisir son adresse d'écoute. `undefined` : sonde sans
 * réponse (pas de route) — `pickListenHost` retombe alors sur son tri historique.
 */
let primaryAddressCache: string | undefined;

/** Cadence de relecture de l'adresse de sortie (au-dessus, pour l'argument). */
const PRIMARY_ADDRESS_REFRESH_MS = 30_000;

function refreshPrimaryAddress(): void {
  void probePrimaryAddress(systemTimers).then((address) => {
    if (address !== null) primaryAddressCache = address;
    // Une carte apparue après le bind (second câble, retour de lien) doit écouter
    // aussi : le salon ne reste pas prisonnier de l'adresse choisie au démarrage.
    const link = signalingLink;
    if (link !== null && link.role === 'host') {
      link.reconcileHosts(listListenHosts(networkInterfaces(), primaryAddressCache));
    }
  });
}

/**
 * Salon automatique à la reprise (2026-11-02) : la machine de recréage du dernier salon hébergé.
 * Créée dans `bootstrap` APRÈS les fenêtres et les handlers — le premier état publié doit trouver
 * un renderer à qui parler, comme la découverte et les mises à jour. `null` avant (ou sous la
 * sonde de test sans démarrage), et le handler de relecture rend alors l'état `idle` : une ligne
 * d'UI ne s'invente pas sans machine derrière elle.
 */
let roomRecreator: RoomRecreator | null = null;
/** Dernière publication de la machine — instantané rendu au lobby au montage (`roomRecreateStatusGet`). */
let recreateState: RecreateState = { phase: 'idle', roomName: null, reasonKey: null };

/** Publie l'état de la machine de recréage vers la fenêtre principale seule (l'overlay n'a rien à dire). */
function publishRecreateState(state: RecreateState): void {
  recreateState = state;
  sendEvent(IPC.eventRoomRecreateState, state, 'main');
}

/**
 * Mesure du dernier salon hébergé (2026-11-02) : écrite quand CE poste crée un salon avec succès,
 * effacée quand l'utilisateur le quitte VOLONTAIREMENT (quitter = intention de ne pas reprendre ;
 * éjection ou coupure = la mesure reste en place, c'est le `stopSignalingLink` d'un départ subi qui
 * ne touche RIEN ici). Écriture silencieuse en cas d'échec, comme les mesures de `update` : un
 * réglage de mesure ne doit jamais casser le geste qui vient de réussir.
 */
function persistLastHostedRoom(next: Settings['room']['lastHosted']): void {
  try {
    persist({ ...settings, room: { ...settings.room, lastHosted: next } });
  } catch (error) {
    console.error('[réglages] mesure lastHosted non enregistrée', error);
  }
}

/**
 * Le geste réel du recréage : le MÊME chemin que le flux manuel « Créer et rejoindre » du lobby —
 * le `join` du pont, puis le tuyau de signalisation que le main ouvre derrière (rôles, écoute,
 * annonce mDNS). Aucune voie bis : si le flux manuel ne peut pas créer ce salon, l'automatisme
 * non plus, et il le dit (`false`) au lieu d'inventer un second chemin qui lui, réussirait.
 *
 * Les champs du `join` sont exactement ceux que passe le lobby : `roomId` = le nom (un salon créé
 * localement s'identifie par son nom — contrat `RoomJoinPayload`), `name` = le nom affiché. La
 * capacité n'est pas un paramètre du `join` : c'est la constante du maillage, que le pont applique
 * lui-même (`IPC_MAX_PARTICIPANTS`) — elle n'est persistée que comme témoin de ce qui était promis.
 *
 * `false` = le salon n'est pas là : refus du pont (`notice`) ou salon déjà porté par un pair que
 * la découverte a vu entre-temps. `true` = l'état du pont est bien celui du salon visé.
 */
async function hostRoomFromSettings(name: string): Promise<boolean> {
  // Jamais pendant un salon : la personne a ouvert/join un salon pendant les 2 s du délai — son
  // geste premier passe avant l'automatisme, qui se retire sans rien écrire.
  if (roomActiveForUpdate()) return false;
  const wanted = name.trim().toLocaleLowerCase();
  // Anti-doublon relu AU GESTE (l'état du registre a pu bouger depuis la décision de la minuterie) :
  // créer un SECOND salon du même nom trahirait la règle anti-hôte-doublon du lobby (31/10/2026).
  const taken = discovery.list().some((room) => room.roomName.trim().toLocaleLowerCase() === wanted);
  if (taken) return false;
  const state = bridge.join({ roomId: name, name }, resolveDisplayName(settings.nickname, osUserName()));
  if (state.roomId === null || state.selfId === null) {
    // Refus du pont (`notice`) : rien à publier, la machine comptera l'échec.
    return false;
  }
  bridge.setSelfAvatar(avatarRefForJoin(settings.avatar) ?? null);
  // Le tuyau porte le NOM DU PARTICIPANT (réglages), jamais le nom du salon : le `join` du pont
  // décrit le SALON (`name` ici), et le passer tel quel faisait apparaître le nom du salon comme
  // ligne de pair média (capture JC « gf », 02/11/2026 — le flux média n'était pas nommé).
  startSignalingLink(state.roomId, resolveDisplayName(settings.nickname, osUserName()), state.selfId, avatarRefForJoin(settings.avatar));
  return true;
}

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
  const room = bridge.getRoomState();
  // The overlay floats above every other app: outside a room it has nothing to show, so it stays
  // hidden instead of printing "nobody here yet" over the user's desktop.
  const enabled = settings.overlay.enabled && room.roomId !== null && mainWindow !== null;
  if (!enabled) {
    overlay.destroy();
    return;
  }
  if (overlay.getWindow() === null) {
    createOverlay();
    return;
  }
  const geometry = overlay.apply({ ...settings.overlay, enabled }, room.participantCount);
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
    sendEvent(event.channel, {
      ...event.payload,
      signalingPort: currentSignalingPort(),
      selfSignalingId: signalingLink?.selfId ?? null,
    });
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

// Mode de prise de parole (fix 0.4.2, 2026-11-02) : le contrat a déjà borné la valeur à
// 'ptt' | 'vad', ce prédicat ne fait que la rendre typée au handler (jamais un cast).
function isTalkModePayload(raw: unknown): raw is { mode: TalkModeDto } {
  if (!isRecord(raw)) return false;
  const mode = raw['mode'];
  return mode === 'ptt' || mode === 'vad';
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
  // Adresse PRÉFÉRÉE (2026-11-02) : la sonde de route par défaut (`primary-address.ts`) est
  // asynchrone — ses résultats sont mis en cache par la cadence de `bootstrap` (une sonde au
  // démarrage, puis toutes les 30 s : une adresse de sortie change rarement en séance) et le
  // join lit le DERNIER résultat connu, sans attendre. `undefined` = repli trié d'avant.
  const listenHosts = listListenHosts(networkInterfaces(), primaryAddressCache);
  const listenHost = listenHosts[0] ?? pickListenHost(networkInterfaces(), primaryAddressCache);
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
    ...(role === 'host' ? { hosts: listenHosts } : {}),
    ...(role === 'client' && remote ? { port: remote.port } : {}),
    now: () => systemTimers.now(),
    // Bind refusé (fix 0.4.2, 2026-11-02, D2) : les 10 ports sont occupés — `onListen` ne
    // viendra jamais, donc aucune annonce ne partira. Le dire au lobby vaut mieux qu'un salon
    // « créé » muet : même événement de santé que les échecs mDNS, motif « port indisponible ».
    onBindRefused: (detail) => {
      console.warn(`[signalisation] bind refusé sur ${listenHost} : ${detail}`);
      publishDiscoveryHealth('mdns-down');
    },
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
        // Cohérence bind/annonce (2026-11-02) : le lecteur joint l'adresse que CE poste a
        // réellement liée, jamais une reconstruction de bonjour (machine multi-interfaces).
        host: listen.host,
        hosts: signalingLink.listens?.map((entry) => entry.host) ?? [],
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
    // Cohérence bind/annonce (2026-11-02) : même règle que le bind initial.
    host: listen.host,
    hosts: link.listens?.map((entry) => entry.host) ?? [],
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
      const displayName = resolveDisplayName(settings.nickname, osUserName());
      const state = bridge.join(join, displayName);
      // Salon refusé (plafond atteint) : aucun tuyau à ouvrir.
      if (state.roomId !== null && state.selfId !== null) {
        bridge.setSelfAvatar(avatarRefForJoin(settings.avatar) ?? null);
        // Le tuyau porte le NOM DU PARTICIPANT (réglages), jamais le nom du salon : le `join`
        // du pont décrit le SALON (`join.name`), et passer les deux au même endroit faisait
        // apparaître le nom du salon comme ligne de pair média (capture JC « gf », 02/11/2026).
        startSignalingLink(state.roomId, displayName, state.selfId, avatarRefForJoin(settings.avatar));
        // Salon automatique (2026-11-02) : si CE poste est l'HÔTE du salon qui vient de naître,
        // la mesure est prise (nom + capacité promise du maillage) — c'est elle qui autorisera la
        // reprise au prochain démarrage. Un CLIENT ne mesure rien : il ne peut pas recréer le salon
        // d'un autre ; un salon refusé (`notice`) ne mesure pas davantage.
        if (signalingLink?.role === 'host') {
          persistLastHostedRoom({ name: join.name.trim(), capacity: MAX_ROOM_PARTICIPANTS });
        }
      }
      // La coquille enrichit le DTO de ce que le pont ignore (port lu, id serveur du tuyau).
      return { ...state, signalingPort: currentSignalingPort(), selfSignalingId: signalingLink?.selfId ?? null };
    },
    [IPC.roomLeave]: () => {
      stopSignalingLink('départ du salon');
      // Le salon n'est plus : plus personne n'est mesuré, la baisse des autres applications
      // s'arrête immédiatement (restaurée par le contrôleur).
      resetDucking();
      // Salon automatique (2026-11-02) : quitter VOLONTAIREMENT = intention de ne pas reprendre —
      // la mesure est effacée. Se faire éjecter ou perdre le réseau passe par `stopSignalingLink`
      // seul (reconnexion, fermeture de l'app) et ne touche RIEN ici : la mesure survit, et le
      // prochain démarrage retrouvera le salon.
      persistLastHostedRoom(null);
      return { ...bridge.leave(), signalingPort: null, selfSignalingId: null };
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
    // Mode de prise de parole (fix 0.4.2, 2026-11-02) : UNE écriture, deux effets cohérents.
    // Le pont (`RoomBridge.setMode`) publie l'état de contrôle que l'UI lit — et le réglage
    // `talk.mode` est persisté par le même geste : le renderer ne peut pas écrire l'un sans
    // l'autre (c'était le défaut : le sélecteur écrivait les réglages, personne ne les lisait).
    // La persistance suit le même chemin que `settingsSet` (`applySettingsPatch` + `persist`).
    [IPC.talkSetMode]: (payload: unknown) => {
      const mode = expectPayload(IPC.talkSetMode, payload, isTalkModePayload).mode;
      const result = applySettingsPatch(settings, { talk: { ...settings.talk, mode } });
      // `applySettingsPatch` peut refuser (schéma invalide) : le pont ne prend alors QUE la
      // valeur du contrat validé — un refus de persistance ne laisse jamais l'UI croire au
      // nouveau mode sans que le réglage le porte. On persiste ce qui est accepté, sinon on
      // refuse net (le renderer voit l'erreur, pas un mode affiché à tort).
      if (!result.ok) {
        const detail = result.errors.map((error) => `${error.path}:${error.code}`).join(', ');
        throw new Error(`mode de prise de parole refusé (${detail})`);
      }
      persist(result.value);
      return bridge.setMode(mode);
    },
    [IPC.talkGetMode]: () => bridge.getControlState(),
    // Salon automatique à la reprise (2026-11-02) : simple relecture — le lobby affiche la ligne
    // sobre au montage. Machine absente (avant bootstrap) ⇒ l'état `idle` initial : rien d'inventé.
    [IPC.roomRecreateStatusGet]: () => (roomRecreator === null ? recreateState : roomRecreator.getState()),
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
