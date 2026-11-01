/**
 * overlay-controller.ts — fenêtre overlay : géométrie, click-through, position.
 *
 * La géométrie vient EXCLUSIVEMENT de `../shell/overlay-geometry` (module testé). Ce fichier ne
 * fait que traduire le résultat en appels `BrowserWindow` :
 *   - `setBounds()` : toujours en DIP, jamais en pixels physiques ;
 *   - `setIgnoreMouseEvents(zone === 'none', { forward: true })` : les clics traversent partout
 *     sauf sur les avatars et la poignée ;
 *   - `showInactive()` : l'overlay apparaît sans voler le focus.
 *
 * Le suivi du curseur se fait par scrutation (120 ms) plutôt que par événements souris : tant que la
 * fenêtre ignore les clics, le renderer ne peut pas garantir de recevoir `mousemove`. Coût mesuré
 * négligeable (un appel système par tranche de 120 ms), et aucune dépendance native.
 *
 * Injection (T23 étape B, SPEC-017). Le fichier a longtemps porté « NON VÉRIFIÉ unitairement » :
 * dans le bac à sable, `electron` ne démarre pas (exit 127, `libgobject-2.0.so.0` absent, aucun X)
 * et aucune fenêtre n'a jamais été peinte. Ce n'est plus un aveu, c'est un chiffre — la classe
 * reçoit désormais ses trois dépendances par constructeur, et `tests/overlay-controller.test.ts`
 * la pilote avec des doubles écrits à la main (aucune dépendance de test, aucun mock de module) :
 *
 *   1. `screen`  : `ScreenPort` — `getCursorScreenPoint()`, `getPrimaryDisplay()`,
 *      `getAllDisplays()` (le rectangle de la fenêtre vient de `window.getBounds()`, sur le port
 *      fenêtre : c'est la paire {curseur, bounds} que la scrutation lit) ;
 *   2. `createWindow` : `(options) => W` où `W extends OverlayWindow`, interface ÉTROITE des
 *      quatorze méthodes réellement appelées (setBounds, setOpacity, setIgnoreMouseEvents,
 *      setAlwaysOnTop, setVisibleOnAllWorkspaces, showInactive, hide, isVisible, isDestroyed,
 *      loadURL, once, on, getBounds, destroy) ;
 *   3. `timers` : `MainTimers` (T21 / SPEC-012 §4), inchangé — la scrutation reste une échéance
 *      du port, jamais un `setInterval` local.
 *
 * Les valeurs par défaut sont les objets réels (`electron.screen`, `new BrowserWindow(options)`,
 * `systemTimers`) : `src/main/index.ts` continue d'écrire `new OverlayController()`. Comportement de
 * production inchangé, vérifié et non supposé : le JS compilé avant/après ne diffère que par
 * l'import, le constructeur et les trois points d'injection (`listDisplays(this.screenPort)`,
 * `this.createWindow(...)`, `this.screenPort.getCursorScreenPoint()`) — aucune arithmétique, aucun
 * appel de méthode de fenêtre n'a bougé. Le seul transtypage du fichier est
 * celui de la fabrique par défaut (le paramètre de type `W` y vaut `BrowserWindow`) ; il est
 * commenté sur place.
 *
 * Ce qui reste NON MESURÉ ici, et le restera sans machine de bureau : le rendu peint (halo,
 * transparence, always-on-top réel, non-vol de focus par le compositeur). La procédure exacte
 * que JC exécute sur un vrai poste est dans `VERIF/smoke-desktop.md`.
 */

// Import par défaut, jamais nommé : `electron` est un module CJS (`module.exports` vaut l'API dans
// le process principal, une chaîne de chemin ailleurs). Un import nommé ferait échouer
// `npx tsx --test` là où le paquet n'expose qu'un chemin — or ce fichier doit rester importable
// par un test node, c'est tout l'objet de l'étape B.
import electron from 'electron';

import {
  computeOverlayGeometry,
  hitTest,
  resolveWorkArea,
  type DisplayInfo,
  type OverlayGeometry,
  type Point,
  type Rect,
} from '../shell/overlay-geometry';
import type { OverlaySettings } from '../shell/settings-schema';
import { appUrl } from './renderer-protocol';
import { systemTimers, type MainTimers } from './timers';

/** Fréquence de test de survol, en ms. */
export const MOUSE_POLL_INTERVAL_MS = 120;

/**
 * Port écran : les trois lectures faites au process principal. `electron.screen` satisfait cette
 * interface telle quelle (aucun adaptateur), un double de test la satisfait en dix lignes.
 */
export interface ScreenPort {
  getCursorScreenPoint(): Point;
  getPrimaryDisplay(): ScreenDisplay;
  getAllDisplays(): ScreenDisplay[];
}

/** Ce qu'on lit d'un écran : identifiant, zone utile (DIP) et facteur d'échelle. */
export interface ScreenDisplay {
  id: number | string;
  workArea: Rect;
  scaleFactor: number;
}

/**
 * Interface ÉTROITE de la fenêtre : exactement les méthodes que ce fichier appelle. Volontairement
 * plus petite que `BrowserWindow` — un double n'a rien d'autre à écrire, et l'absence de `show()`
 * rend le vol de focus impossible par construction (il n'y a pas de méthode à appeler).
 */
export interface OverlayWindow {
  setBounds(bounds: Rect): void;
  setOpacity(opacity: number): void;
  setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): void;
  setAlwaysOnTop(flag: boolean, level?: string): void;
  setVisibleOnAllWorkspaces(visible: boolean, options?: { visibleOnFullScreen?: boolean }): void;
  showInactive(): void;
  hide(): void;
  isVisible(): boolean;
  isDestroyed(): boolean;
  loadURL(url: string): unknown;
  once(event: string, listener: () => void): unknown;
  on(event: string, listener: () => void): unknown;
  getBounds(): Rect;
  destroy(): void;
}

/**
 * Options passées à la fabrique de fenêtre. Recopiées ici (plutôt que
 * `BrowserWindowConstructorOptions`) pour que les tests puissent les capturer et les affirmer :
 * c'est cet objet qui porte `focusable: false` / `acceptFirstMouse: false`, donc la preuve
 * statique du non-vol de focus.
 */
export interface OverlayWindowOptions {
  width: number;
  height: number;
  show: boolean;
  frame: boolean;
  transparent: boolean;
  backgroundColor: string;
  hasShadow: boolean;
  resizable: boolean;
  movable: boolean;
  minimizable: boolean;
  maximizable: boolean;
  fullscreenable: boolean;
  skipTaskbar: boolean;
  alwaysOnTop: boolean;
  focusable: boolean;
  acceptFirstMouse: boolean;
  webPreferences: {
    preload: string;
    contextIsolation: boolean;
    nodeIntegration: boolean;
    sandbox: boolean;
    webSecurity: boolean;
    spellcheck: boolean;
    devTools: boolean;
  };
}

/** Fabrique de fenêtre : le seul point par lequel une fenêtre entre dans ce fichier. */
export type WindowFactory<W extends OverlayWindow> = (options: OverlayWindowOptions) => W;

/** Dépendances injectables. Toutes ont une valeur par défaut réelle (`electron`, `systemTimers`). */
export interface OverlayControllerDeps<W extends OverlayWindow = electron.BrowserWindow> {
  readonly timers?: MainTimers;
  readonly screen?: ScreenPort;
  readonly createWindow?: WindowFactory<W>;
}

/** `electron.screen` EST le port par défaut : pas d'adaptateur, donc pas de dérive silencieuse. */
const systemScreen: ScreenPort = electron.screen;

/**
 * Fabrique par défaut = `new BrowserWindow(options)`, inchangée. Le transtypage est le prix du
 * paramètre de type `W` : à l'instanciation par défaut (`new OverlayController()`, seul usage de
 * `src/main/index.ts`) `W` vaut `BrowserWindow`, et les tests injectent leur propre fabrique.
 */
function defaultWindowFactory<W extends OverlayWindow>(options: OverlayWindowOptions): W {
  return new electron.BrowserWindow(options) as unknown as W;
}

/** Écrans visibles du port, avec l'écran primaire marqué (comme `electron.screen`). */
export function listDisplays(screenPort: ScreenPort = systemScreen): DisplayInfo[] {
  const primaryId = String(screenPort.getPrimaryDisplay().id);
  return screenPort.getAllDisplays().map((display) => ({
    id: String(display.id),
    workArea: display.workArea,
    scaleFactor: display.scaleFactor,
    primary: String(display.id) === primaryId,
  }));
}

export class OverlayController<W extends OverlayWindow = electron.BrowserWindow> {
  private window: W | null = null;
  private geometry: OverlayGeometry | null = null;
  private participantCount = 0;
  private overlaySettings: OverlaySettings | null = null;
  private pollTimer: unknown = null;
  private lastIgnore: boolean | null = null;
  private readonly timers: MainTimers;
  private readonly screenPort: ScreenPort;
  private readonly createWindow: WindowFactory<W>;

  constructor(deps: OverlayControllerDeps<W> = {}) {
    this.timers = deps.timers ?? systemTimers;
    this.screenPort = deps.screen ?? systemScreen;
    this.createWindow = deps.createWindow ?? defaultWindowFactory<W>;
  }

  getWindow(): W | null {
    return this.window && !this.window.isDestroyed() ? this.window : null;
  }

  getGeometry(): OverlayGeometry | null {
    return this.geometry;
  }

  create(preloadPath: string): W {
    const existing = this.getWindow();
    if (existing) return existing;

    const window = this.createWindow({
      width: 1,
      height: 1,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      // Jamais focusable : l'overlay ne doit pas interrompre la frappe dans le jeu ou l'éditeur.
      focusable: false,
      acceptFirstMouse: false,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
        devTools: false,
      },
    });

    // Niveau « screen-saver » : au-dessus des fenêtres plein écran sans les capturer.
    window.setAlwaysOnTop(true, 'screen-saver');
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.setIgnoreMouseEvents(true, { forward: true });

    window.on('closed', () => {
      this.window = null;
      this.geometry = null;
      this.stopPolling();
    });

    this.window = window;
    this.startPolling();
    return window;
  }

  /** Charge le document overlay puis affiche sans prendre le focus. */
  load(url: string = appUrl('overlay.html')): void {
    const window = this.getWindow();
    if (!window) return;
    void window.loadURL(url);
    // `apply()` may have hidden the overlay (disabled, or no room) before the document loaded.
    window.once('ready-to-show', () => {
      if (this.geometry !== null) window.showInactive();
    });
  }

  /**
   * Applique réglages + nombre de participants : recalcule la géométrie et repositionne.
   * Retourne la géométrie retenue (null si la fenêtre n'existe pas).
   */
  apply(settings: OverlaySettings, participantCount: number): OverlayGeometry | null {
    const window = this.getWindow();
    if (!window) return null;
    this.overlaySettings = settings;
    this.participantCount = participantCount;

    if (!settings.enabled) {
      if (window.isVisible()) window.hide();
      this.geometry = null;
      return null;
    }

    const selection = resolveWorkArea(listDisplays(this.screenPort), settings.screenId);
    const geometry = computeOverlayGeometry({
      participantCount,
      workArea: selection.workArea,
      scaleFactor: selection.scaleFactor,
      scale: settings.scale,
      anchor: settings.position ? 'custom' : 'top-right',
      position: settings.position,
    });
    this.geometry = geometry;

    window.setBounds({
      x: geometry.window.x,
      y: geometry.window.y,
      width: geometry.window.width,
      height: geometry.window.height,
    });
    window.setOpacity(settings.opacity);
    if (!window.isVisible()) window.showInactive();
    return geometry;
  }

  /** Recalcule après un changement d'écran (branchement, changement de résolution). */
  refresh(): OverlayGeometry | null {
    if (!this.overlaySettings) return null;
    return this.apply(this.overlaySettings, this.participantCount);
  }

  /**
   * Position choisie par l'utilisateur (glisser la poignée) : renvoyée au magasin de réglages,
   * bornée par `computeOverlayGeometry` au prochain `apply()`.
   *
   * La position ne survit à un `apply()` ultérieur que si les réglages la portent (c'est le cas
   * en production : la page écrit `overlay.position` par IPC, `syncOverlayGeometry` relit le
   * magasin). Le contrôleur n'a AUCUNE mémoire privée de position : `position: null` reste un
   * retour à l'ancrage, et `tests/overlay-controller.test.ts` mesure les deux branches.
   */
  setPosition(x: number, y: number): OverlayGeometry | null {
    if (!this.overlaySettings) return null;
    return this.apply({ ...this.overlaySettings, position: { x: Math.round(x), y: Math.round(y) } }, this.participantCount);
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    // (SPEC-012 §4) La cadence passe par le port, qui arme `unref` : la scrutation ne retient pas
    // le processus à la fermeture.
    this.pollTimer = this.timers.repeat(MOUSE_POLL_INTERVAL_MS, () => this.updateMouseIgnore());
  }

  private stopPolling(): void {
    if (!this.pollTimer) return;
    this.timers.cancel(this.pollTimer);
    this.pollTimer = null;
    this.lastIgnore = null;
  }

  private updateMouseIgnore(): void {
    const window = this.getWindow();
    const geometry = this.geometry;
    if (!window || !geometry || !window.isVisible()) return;

    const cursor = this.screenPort.getCursorScreenPoint();
    const bounds = window.getBounds();
    const zone = hitTest(geometry, { x: cursor.x - bounds.x, y: cursor.y - bounds.y });
    const ignore = zone === 'none';
    if (ignore === this.lastIgnore) return;
    this.lastIgnore = ignore;
    window.setIgnoreMouseEvents(ignore, { forward: true });
  }

  destroy(): void {
    this.stopPolling();
    const window = this.getWindow();
    if (window) window.destroy();
    this.window = null;
    this.geometry = null;
  }
}
