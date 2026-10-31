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

import { app, BrowserWindow, ipcMain, screen, session } from 'electron';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';

import { buildCsp } from './csp';
import { createDiscoveryBridge, type DiscoveryBridge } from './discovery-bridge';
import { installNetworkGuard } from './net-guard';
import { APP_SCHEME, SCHEME_SEP } from './net-schemes';
import { OverlayController, listDisplays } from './overlay-controller';
import { registerPushToTalk, releasePushToTalk, type PttRegistration } from './ptt';
import { appUrl, registerAppProtocol, registerAppScheme } from './renderer-protocol';
import { RoomBridge, type BridgeEvent } from './room-bridge';
import { applySignalToRoster } from './roster-link';
import { createSettingsStore, type SettingsStore } from './settings-store';
import { systemTimers } from './timers';
import {
  createSignalingLink,
  pickListenHost,
  type SignalingLink,
} from './signaling-link';

import {
  IPC,
  IpcContractError,
  guardPayload,
  type GainPayload,
  type IpcEventChannel,
  type IpcInvokeChannel,
  type OverlayPatchPayload,
  type RoomJoinPayload,
  type RoomSummaryDto,
  type SignalIn,
  type SignalOut,
  type SpeakingSetPayload,
} from '../shell/ipc-contract';
import { applySettingsPatch, defaultSettings, type Settings } from '../shell/settings-schema';

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
const overlay = new OverlayController();
const bridge = new RoomBridge(forwardBridgeEvent);
// Découverte mDNS des salons : `now` est injecté ici, dans le main (interdit dans `src/engine/`).
const discovery: DiscoveryBridge = createDiscoveryBridge({
  onRooms: publishRooms,
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
  registerPushToTalkShortcut();
  // Après les fenêtres : le premier `onRooms` doit trouver un renderer à qui parler.
  discovery.start();

  // Branchement/débranchement d'écran : l'overlay se replace au lieu de rester hors champ, et la
  // nouvelle géométrie est republiée (`overlay.refresh()` calculait mais ne la poussait pas).
  // `screen.on` est surchargé par nom d'événement : une boucle sur une union de littéraux ne
  // satisfait aucune surcharge (TS2769). Trois abonnements explicites, même geste, sans cast.
  const onDisplayChange = (): void => syncOverlayGeometry();
  screen.on('display-added', onDisplayChange);
  screen.on('display-removed', onDisplayChange);
  screen.on('display-metrics-changed', onDisplayChange);

  // Conflit de raccourci : l'UI doit le dire, pas le masquer.
  if (ptt?.conflict) sendEvent(IPC.eventShortcutConflict, ptt.conflict);
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
  const csp = buildCsp({ devServerOrigin: DEV_SERVER });

  // CSP posée sur CHAQUE réponse : un document chargé sans en-tête serait sans défense.
  ses.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
        'X-Content-Type-Options': ['nosniff'],
        'Referrer-Policy': ['no-referrer'],
      },
    });
  });

  // Uniquement le micro ; tout le reste (géolocalisation, notifications, presse-papiers, USB…) est
  // refusé sans même consulter l'utilisateur.
  ses.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === 'media');
  });
  ses.setPermissionCheckHandler((_contents, permission) => permission === 'media');

  networkGuard = installNetworkGuard(ses, { devServerOrigin: DEV_SERVER, lanHosts: [] });

  if (!DEV_SERVER) registerAppProtocol(join(__dirname, '..', 'renderer'));
}

function registerPushToTalkShortcut(): void {
  ptt = registerPushToTalk(settings.talk.pttAccelerator, (active) => {
    bridge.setPushToTalk(active);
  });
}

// --- IPC -------------------------------------------------------------------------------------

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

/**
 * Liste des salons repérée sur le LAN. L'overlay ne consomme pas cet événement (il ne montre que
 * les participants d'un salon déjà rejoint) : on ne cible que la fenêtre principale.
 */
function publishRooms(rooms: RoomSummaryDto[]): void {
  sendEvent(IPC.eventRoomsDiscovered, rooms, 'main');
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

function forwardBridgeEvent(event: BridgeEvent): void {
  // `BridgeEvent.channel` porte les VALEURS du canon (`lan:event:participants`, …), pas les noms
  // de clés : on ne transmet donc aucune conversion, et le discriminant reste vérifié par le type.
  sendEvent(event.channel, event.payload);
  // Comparaison contre les VALEURS du canon (`IPC.*`). Un littéral repris du nom de clé est toujours
  // différent de la valeur `'lan:event:…'` correspondante : il rendrait ce branchement mort.
  // C'est le bug corrigé ici : `overlay.apply` n'était plus jamais rappelé, la pastille overlay
  // restait figée sur la taille du premier rendu.
  if (event.channel === IPC.eventParticipants || event.channel === IPC.eventRoomState) {
    syncOverlayGeometry();
  }
}

function persist(next: Settings): void {
  settings = next;
  try {
    store.save(next);
  } catch (error) {
    console.error('[réglages] écriture impossible', error);
  }
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
function startSignalingLink(roomId: string, name: string, selfId: string): void {
  stopSignalingLink('changement de salon');
  const remote = discovery.list().find((room) => room.roomId === roomId);
  const listenHost = pickListenHost(networkInterfaces());
  const role: 'host' | 'client' = remote ? 'client' : 'host';
  signalingLink = createSignalingLink({
    role,
    localId: selfId,
    name,
    host: role === 'client' && remote ? remote.host : listenHost,
    ...(role === 'client' && remote ? { port: remote.port } : {}),
    now: () => systemTimers.now(),
    onMessage: (message) => {
      // L'annuaire suit la présence de signalisation AVANT d'envoyer le message au renderer :
      // `peer-joined`/`peer-left` étaient jusqu'ici transmis sans que personne ne tienne la liste.
      applyRoster(message);
      sendEvent(IPC.eventSignal, message);
    },
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
  const handlers: Record<IpcInvokeChannel, (payload: unknown) => unknown> = {
    [IPC.settingsGet]: () => settings,
    [IPC.settingsSet]: (payload: unknown) => {
      const result = applySettingsPatch(settings, payload);
      if (!result.ok) {
        const detail = result.errors.map((error) => `${error.path}:${error.code}`).join(', ');
        throw new Error(`réglages refusés (${detail})`);
      }
      persist(result.value);
      return settings;
    },
    [IPC.settingsOpen]: () => {
      const window = mainWindow ?? createMainWindow();
      window.show();
      window.focus();
    },
    // Charge utile VIDE (contrat) : le scan est déjà lancé au démarrage, on rend l'état du registre.
    [IPC.roomsDiscover]: () => discovery.list(),
    [IPC.roomJoin]: (payload: unknown) => {
      const join = expectPayload(IPC.roomJoin, payload, isRoomJoinPayload);
      const state = bridge.join(join);
      // Salon refusé (plafond atteint) : aucun tuyau à ouvrir.
      if (state.roomId !== null && state.selfId !== null) {
        startSignalingLink(state.roomId, join.name, state.selfId);
      }
      return state;
    },
    [IPC.roomLeave]: () => {
      stopSignalingLink('départ du salon');
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
    [IPC.overlaySet]: (payload: unknown) => {
      const patch = expectPayload(IPC.overlaySet, payload, isOverlayPatchPayload);
      const result = applySettingsPatch(settings, overlayPatchToSettings(patch));
      if (!result.ok) {
        const detail = result.errors.map((error) => `${error.path}:${error.code}`).join(', ');
        throw new Error(`overlay refusé (${detail})`);
      }
      persist(result.value);
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
      const handler = handlers[channel];
      // Plus aucun forçage : `guarded.value` est `unknown` et `handler` accepte `unknown`, le
      // rétrécissement se fait dans le handler via `expectPayload`.
      return handler(guarded.value);
    });
  }

  // Aucun autre canal n'est écouté : `ipcMain.handle` sur une liste fermée, pas de wildcard.
  console.info('[ipc] canaux enregistrés :', Object.keys(handlers).length, '· écrans :', listDisplays().length);
}
