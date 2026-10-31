/**
 * overlay-controller.test.ts — l'overlay, mesuré par injection (T23 étape B / SPEC-017).
 *
 * Jusqu'ici `src/main/overlay-controller.ts` portait en tête « NON VÉRIFIÉ unitairement » : dans le
 * bac à sable `electron` ne démarre pas (exit 127, `libgobject-2.0.so.0` absent, aucun X), donc
 * aucune fenêtre n'a jamais été peinte et rien de ce fichier n'était chiffré. Ce test remplace
 * l'aveu par des nombres. Il n'importe NI `electron` qui tourne, NI un mockeur : les trois
 * dépendances (écran, fenêtre, horloge) sont des doubles écrits à la main, injectés par le
 * constructeur, et le fichier de production garde ses défauts réels (`electron.screen`,
 * `new BrowserWindow`, `systemTimers`).
 *
 * Ce qui est mesuré, et par quel chiffre (voir les `it` correspondants) :
 *   1. click-through  : nombre d'appels `setIgnoreMouseEvents` par franchissement de frontière
 *                       (8 franchissements ⇒ 8 appels ; 21 scrutations à 1 px ⇒ 1 appel) ;
 *   2. dédoublonnage  : 5 scrutations dans la même zone ⇒ 1 appel (`lastIgnore`) ;
 *   3. focus          : `showInactive` = 1, `show` = 0, `focusable:false`, `acceptFirstMouse:false` ;
 *   4. always-on-top  : 1 appel `('screen-saver')`, 1 appel `(visibleOnFullScreen)` — jamais 2 ;
 *   5. glisser        : `setBounds` borné par `computeOverlayGeometry`, x/y conservés au `apply()`
 *                       suivant pendant que la largeur passe de 128 à 200 DIP ;
 *   6. démontage      : `destroy()` puis 10 ticks ⇒ 0 `getCursorScreenPoint`, 0
 *                       `setIgnoreMouseEvents` de plus (idem fermeture système via `closed`) ;
 *   7. `enabled:false`: `hide()` = 1, géométrie `null`, 10 ticks ⇒ 0 scrutation.
 *
 * Ce qui reste NON MESURÉ, même après ce fichier : le pixel. Halo visible, transparence, always-on-
 * top réel du compositeur, non-vol de focus par le gestionnaire de fenêtres : aucun double ne les
 * prouve. La procédure sur poste réel est `VERIF/smoke-desktop.md` (colonne PASS/FAIL vide).
 *
 * Aucune dépendance : `node --test` via `npx tsx --test tests/overlay-controller.test.ts`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MOUSE_POLL_INTERVAL_MS,
  OverlayController,
  listDisplays,
  type OverlayWindow,
  type OverlayWindowOptions,
  type ScreenDisplay,
  type ScreenPort,
} from '../src/main/overlay-controller.ts';
import type { MainTimers } from '../src/main/timers.ts';
import type { OverlayGeometry, Point, Rect } from '../src/shell/overlay-geometry.ts';
import type { OverlaySettings } from '../src/shell/settings-schema.ts';

// ---------------------------------------------------------------------------------------------
// Fixtures : un écran 1920×1080 à l'échelle 1, une overlay de 3 participants ancrée en haut-droite.
// Valeurs lues sur `computeOverlayGeometry` (module pur, testé séparément) :
//   fenêtre {x:1792, y:0, width:128, height:44} ; avatars (relatifs) 6..38, 42..74, 78..110 ;
//   poignée (relative) 116..128. La bande relative 111..115 est DANS la fenêtre et HORS zones :
//   c'est le point « extérieur » du test de click-through.
// ---------------------------------------------------------------------------------------------

const DISPLAY: ScreenDisplay = {
  id: 'ecran-1',
  workArea: { x: 0, y: 0, width: 1920, height: 1080 },
  scaleFactor: 1,
};

const DISPLAY_SECONDARY: ScreenDisplay = {
  id: 'ecran-2',
  workArea: { x: 1920, y: 0, width: 1280, height: 1024 },
  scaleFactor: 1.5,
};

function settings(overrides: Partial<OverlaySettings> = {}): OverlaySettings {
  return {
    enabled: true,
    opacity: 0.85,
    scale: 'md',
    screenId: null,
    position: null,
    ...overrides,
  };
}

/** Point de l'écran correspondant à une position RELATIVE à la fenêtre (fenêtre à 1792,0). */
function screenPointAtWindowRelative(relX: number, relY: number): Point {
  return { x: 1792 + relX, y: 0 + relY };
}

const INSIDE_AVATAR_1 = screenPointAtWindowRelative(22, 22); // centre de l'avatar 1 (6..38)
const INSIDE_HANDLE = screenPointAtWindowRelative(122, 22); // centre de la poignée (116..128)
const OUTSIDE_INSIDE_WINDOW = screenPointAtWindowRelative(113, 22); // bande vide 111..115
const OUTSIDE_WINDOW = { x: 10, y: 10 }; // à l'autre bout de l'écran

// ---------------------------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------------------------

interface IgnoreCall {
  readonly ignore: boolean;
  readonly options: { forward?: boolean } | undefined;
}

interface AlwaysOnTopCall {
  readonly flag: boolean;
  readonly level: string | undefined;
}

interface WorkspacesCall {
  readonly visible: boolean;
  readonly options: { visibleOnFullScreen?: boolean } | undefined;
}

/**
 * Double de fenêtre : il n'implémente QUE l'interface étroite, plus trois compteurs témoins qui ne
 * sont pas dans l'interface (`show`, `center`) pour prouver que le contrôleur ne peut pas les
 * appeler — l'absence de méthode est la garantie, le compteur est la mesure.
 */
class FakeWindow implements OverlayWindow {
  readonly options: OverlayWindowOptions;
  readonly boundsWrites: Rect[] = [];
  readonly opacityWrites: number[] = [];
  readonly ignoreWrites: IgnoreCall[] = [];
  readonly alwaysOnTopWrites: AlwaysOnTopCall[] = [];
  readonly workspacesWrites: WorkspacesCall[] = [];
  readonly loadUrls: string[] = [];
  showInactiveCalls = 0;
  hideCalls = 0;
  destroyCalls = 0;
  /** Témoins hors interface : doivent rester à 0 (le contrôleur n'a pas de méthode à appeler). */
  showCalls = 0;
  centerCalls = 0;

  private bounds: Rect;
  private visible = false;
  private destroyed = false;
  private readonly listeners = new Map<string, Array<() => void>>();
  private readonly onceListeners = new Map<string, Array<() => void>>();

  constructor(options: OverlayWindowOptions) {
    this.options = options;
    this.bounds = { x: 0, y: 0, width: options.width, height: options.height };
  }

  setBounds(bounds: Rect): void {
    this.boundsWrites.push({ ...bounds });
    this.bounds = { ...bounds };
  }

  setOpacity(opacity: number): void {
    this.opacityWrites.push(opacity);
  }

  setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): void {
    this.ignoreWrites.push({ ignore, options });
  }

  setAlwaysOnTop(flag: boolean, level?: string): void {
    this.alwaysOnTopWrites.push({ flag, level });
  }

  setVisibleOnAllWorkspaces(visible: boolean, options?: { visibleOnFullScreen?: boolean }): void {
    this.workspacesWrites.push({ visible, options });
  }

  showInactive(): void {
    this.showInactiveCalls += 1;
    this.visible = true;
  }

  hide(): void {
    this.hideCalls += 1;
    this.visible = false;
  }

  isVisible(): boolean {
    return this.visible;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  loadURL(url: string): unknown {
    this.loadUrls.push(url);
    return Promise.resolve();
  }

  once(event: string, listener: () => void): unknown {
    const list = this.onceListeners.get(event) ?? [];
    list.push(listener);
    this.onceListeners.set(event, list);
    return this;
  }

  on(event: string, listener: () => void): unknown {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
    return this;
  }

  getBounds(): Rect {
    return { ...this.bounds };
  }

  destroy(): void {
    this.destroyCalls += 1;
    this.destroyed = true;
    this.visible = false;
  }

  /** Hors interface : deux méthodes que le contrôleur pourrait appeler s'il en avait le droit. */
  show(): void {
    this.showCalls += 1;
    this.visible = true;
  }

  center(): void {
    this.centerCalls += 1;
  }

  /** Émet un évènement comme le ferait Electron (`ready-to-show`, `closed`). */
  emit(event: string): void {
    for (const listener of this.listeners.get(event) ?? []) listener();
    const once = this.onceListeners.get(event) ?? [];
    this.onceListeners.delete(event);
    for (const listener of once) listener();
  }
}

/** Double d'écran : le curseur est une variable, chaque lecture est comptée. */
class FakeScreen implements ScreenPort {
  cursor: Point = { x: 0, y: 0 };
  cursorReads = 0;
  private readonly displays: ScreenDisplay[];

  constructor(displays: ScreenDisplay[]) {
    this.displays = displays;
  }

  getCursorScreenPoint(): Point {
    this.cursorReads += 1;
    return { ...this.cursor };
  }

  getPrimaryDisplay(): ScreenDisplay {
    const [primary] = this.displays;
    if (!primary) throw new Error('doublé d’écran sans écran primaire');
    return primary;
  }

  getAllDisplays(): ScreenDisplay[] {
    return this.displays.map((display) => ({ ...display }));
  }

  /** Déplace le curseur sans rien lire (l'écriture n'est pas une scrutation). */
  moveCursorTo(point: Point): void {
    this.cursor = { ...point };
  }
}

/** Double d'horloge : rien ne part tout seul, `tick(n)` avance de n échéances. */
class FakeTimers implements MainTimers {
  readonly armed: Array<{ ms: number; repeating: boolean }> = [];
  readonly cancelled: number[] = [];
  private readonly handles = new Map<number, { ms: number; fn: () => void; repeating: boolean }>();
  private nextId = 1;

  now(): number {
    return 1_000_000;
  }

  once(ms: number, callback: () => void): unknown {
    const id = this.nextId++;
    this.handles.set(id, { ms, fn: callback, repeating: false });
    this.armed.push({ ms, repeating: false });
    return { id };
  }

  repeat(ms: number, callback: () => void): unknown {
    const id = this.nextId++;
    this.handles.set(id, { ms, fn: callback, repeating: true });
    this.armed.push({ ms, repeating: true });
    return { id };
  }

  cancel(handle: unknown): void {
    const id = (handle as { id: number }).id;
    if (!this.handles.delete(id)) return;
    this.cancelled.push(id);
  }

  /** Avance l'horloge factice de `ticks` échéances (tous les repeat armés tirent à chaque fois). */
  tick(ticks = 1): void {
    for (let i = 0; i < ticks; i += 1) {
      for (const [id, handle] of [...this.handles]) {
        handle.fn();
        if (!handle.repeating) this.handles.delete(id);
      }
    }
  }

  get armedRepeats(): Array<{ ms: number; repeating: boolean }> {
    return this.armed.filter((entry) => entry.repeating);
  }
}

interface Harness {
  readonly controller: OverlayController<FakeWindow>;
  readonly timers: FakeTimers;
  readonly screen: FakeScreen;
  readonly options: OverlayWindowOptions;
  readonly window: FakeWindow;
  readonly geometry: OverlayGeometry;
}

/** Monte un contrôleur complet sur doubles, avec la fenêtre créée et la géométrie 3 participants. */
function harness(overrides: { displays?: ScreenDisplay[]; settings?: OverlaySettings } = {}): Harness {
  const timers = new FakeTimers();
  const screenDouble = new FakeScreen(overrides.displays ?? [DISPLAY]);
  let captured: OverlayWindowOptions | null = null;
  let created: FakeWindow | null = null;

  const controller = new OverlayController<FakeWindow>({
    timers,
    screen: screenDouble,
    createWindow: (options) => {
      captured = options;
      const window = new FakeWindow(options);
      created = window;
      return window;
    },
  });

  controller.create('/tmp/preload.js');
  const geometry = controller.apply(overrides.settings ?? settings(), 3);
  if (!captured || !created || !geometry) throw new Error('harnais incomplet : fenêtre ou géométrie absente');

  return {
    controller,
    timers,
    screen: screenDouble,
    options: captured as OverlayWindowOptions,
    window: created as FakeWindow,
    geometry,
  };
}

/** Compte les écritures `setIgnoreMouseEvents` depuis un point de référence. */
function ignoreCallsSince(window: FakeWindow, from: number): IgnoreCall[] {
  return window.ignoreWrites.slice(from);
}

// ---------------------------------------------------------------------------------------------
// 1. Click-through : quelle zone, combien d'appels
// ---------------------------------------------------------------------------------------------

describe('overlay-controller — click-through (positions et nombre d’appels)', () => {
  it('avatar ⇒ setIgnoreMouseEvents(false, {forward:true}) ; extérieur ⇒ true', () => {
    const h = harness();
    assert.equal(h.window.ignoreWrites.length, 1, 'create() doit poser exactement 1 état initial');
    assert.deepEqual(h.window.ignoreWrites[0], { ignore: true, options: { forward: true } });

    const base = h.window.ignoreWrites.length;

    h.screen.moveCursorTo(INSIDE_AVATAR_1);
    h.timers.tick();
    h.screen.moveCursorTo(OUTSIDE_INSIDE_WINDOW);
    h.timers.tick();
    h.screen.moveCursorTo(INSIDE_HANDLE);
    h.timers.tick();
    h.screen.moveCursorTo(OUTSIDE_WINDOW);
    h.timers.tick();

    const calls = ignoreCallsSince(h.window, base);
    assert.equal(calls.length, 4, '4 zones distinctes ⇒ 4 écritures');
    assert.deepEqual(calls, [
      { ignore: false, options: { forward: true } },
      { ignore: true, options: { forward: true } },
      { ignore: false, options: { forward: true } },
      { ignore: true, options: { forward: true } },
    ]);
  });

  it('la poignée est interactive : 1 scrutation dans 116..128 ⇒ 1 appel ignore=false', () => {
    const h = harness();
    h.screen.moveCursorTo(screenPointAtWindowRelative(118, 2));
    const base = h.window.ignoreWrites.length;
    h.timers.tick();
    assert.deepEqual(ignoreCallsSince(h.window, base), [{ ignore: false, options: { forward: true } }]);
  });

  it('balayage traversant la frontière 8 fois ⇒ exactement 8 appels', () => {
    const h = harness();
    // Amorçage : une scrutation dehors fixe `lastIgnore = true` (le create() laisse lastIgnore null).
    h.screen.moveCursorTo(OUTSIDE_INSIDE_WINDOW);
    h.timers.tick();
    const base = h.window.ignoreWrites.length;

    // 9 points alternés dehors/dedans sur la frontière gauche de l'avatar 1 (relative x = 6).
    const path = [4, 8, 4, 8, 4, 8, 4, 8, 4].map((relX) => screenPointAtWindowRelative(relX, 22));
    for (const point of path) {
      h.screen.moveCursorTo(point);
      h.timers.tick();
    }

    const calls = ignoreCallsSince(h.window, base);
    assert.equal(calls.length, 8, '9 points alternés = 8 franchissements = 8 appels');
    assert.equal(calls.filter((call) => call.ignore === false).length, 4);
    assert.equal(calls.filter((call) => call.ignore === true).length, 4);
  });

  it('balayage au pixel (21 scrutations de x=0 à x=20) ⇒ 1 seul appel', () => {
    const h = harness();
    h.screen.moveCursorTo(screenPointAtWindowRelative(0, 22));
    h.timers.tick();
    const base = h.window.ignoreWrites.length;

    for (let relX = 0; relX <= 20; relX += 1) {
      h.screen.moveCursorTo(screenPointAtWindowRelative(relX, 22));
      h.timers.tick();
    }

    const calls = ignoreCallsSince(h.window, base);
    assert.equal(h.screen.cursorReads, 22, '1 amorçage + 21 points = 22 lectures du curseur');
    assert.equal(calls.length, 1, '21 points pour 1 franchissement (x=6) ⇒ 1 appel');
    assert.equal(calls[0]?.ignore, false);
  });

  it('dédoublonnage lastIgnore : 5 scrutations dans la même zone ⇒ 1 appel', () => {
    const h = harness();
    h.screen.moveCursorTo(INSIDE_AVATAR_1);
    h.timers.tick(); // premier passage : lastIgnore null → 1 écriture
    const base = h.window.ignoreWrites.length;
    for (let i = 0; i < 4; i += 1) h.timers.tick();
    assert.equal(ignoreCallsSince(h.window, base).length, 0, '4 scrutations supplémentaires ⇒ 0 appel');
    assert.equal(h.screen.cursorReads, 5, 'le curseur est bien lu 5 fois : le dédoublonnage est APRÈS la lecture');
  });
});

// ---------------------------------------------------------------------------------------------
// 2. Focus : showInactive, jamais show
// ---------------------------------------------------------------------------------------------

describe('overlay-controller — focus', () => {
  it('les options de fenêtre portent focusable:false et acceptFirstMouse:false', () => {
    const h = harness();
    assert.equal(h.options.focusable, false);
    assert.equal(h.options.acceptFirstMouse, false);
    assert.equal(h.options.show, false, 'la fenêtre naît cachée : c’est showInactive qui l’affiche');
    assert.equal(h.options.frame, false);
    assert.equal(h.options.transparent, true);
    assert.equal(h.options.skipTaskbar, true);
    assert.equal(h.options.alwaysOnTop, true);
    assert.deepEqual(h.options.webPreferences, {
      preload: '/tmp/preload.js',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: false,
    });
  });

  it('load() + ready-to-show ⇒ showInactive = 1, show = 0', () => {
    const h = harness();
    h.controller.load();
    assert.equal(h.window.loadUrls.length, 1, 'un seul loadURL');
    assert.equal(h.window.loadUrls[0]?.endsWith('/overlay.html'), true, 'le document chargé est bien overlay.html');
    const shownBefore = h.window.showInactiveCalls;
    assert.equal(shownBefore, 1, 'seul l’apply() du harnais a affiché la fenêtre, pas load()');
    h.window.emit('ready-to-show');
    assert.equal(h.window.showInactiveCalls, shownBefore + 1);
    assert.equal(h.window.showCalls, 0, 'show() n’existe pas dans l’interface : 0 appel possible');
    assert.equal(h.window.centerCalls, 0);
  });

  it('apply() sur fenêtre cachée ⇒ showInactive, jamais show', () => {
    const h = harness();
    h.window.hide(); // le WM a caché la fenêtre
    const before = h.window.showInactiveCalls;
    h.controller.apply(settings(), 4);
    assert.equal(h.window.showInactiveCalls, before + 1);
    assert.equal(h.window.showCalls, 0);
  });
});

// ---------------------------------------------------------------------------------------------
// 3. Always-on-top : une fois, au bon niveau
// ---------------------------------------------------------------------------------------------

describe('overlay-controller — always-on-top et espaces', () => {
  it('1 seul setAlwaysOnTop(true,\'screen-saver\') et 1 seul setVisibleOnAllWorkspaces', () => {
    const h = harness();
    assert.equal(h.window.alwaysOnTopWrites.length, 1);
    assert.deepEqual(h.window.alwaysOnTopWrites[0], { flag: true, level: 'screen-saver' });
    assert.equal(h.window.workspacesWrites.length, 1);
    assert.deepEqual(h.window.workspacesWrites[0], { visible: true, options: { visibleOnFullScreen: true } });
  });

  it('apply() et refresh() ne réarment pas le niveau (toujours 1 chacun)', () => {
    const h = harness();
    h.controller.apply(settings({ opacity: 0.7 }), 5);
    h.controller.refresh();
    assert.equal(h.window.alwaysOnTopWrites.length, 1);
    assert.equal(h.window.workspacesWrites.length, 1);
    assert.equal(h.window.opacityWrites.length, 3, 'seule l’opacité suit les réglages (0.85, 0.7, 0.7)');
  });
});

// ---------------------------------------------------------------------------------------------
// 4. Glisser : géométrie bornée, position conservée
// ---------------------------------------------------------------------------------------------

describe('overlay-controller — glisser la poignée', () => {
  it('géométrie initiale ancrée en haut-droite : {1792,0,128,44}', () => {
    const h = harness();
    assert.deepEqual(h.window.boundsWrites[0], { x: 1792, y: 0, width: 128, height: 44 });
    assert.equal(h.geometry.anchor, 'top-right');
    assert.equal(h.geometry.positionClamped, false);
  });

  it('setPosition(300,200) ⇒ setBounds {300,200} (même géométrie que computeOverlayGeometry)', () => {
    const h = harness();
    const geometry = h.controller.setPosition(300, 200);
    assert.deepEqual(h.window.boundsWrites.at(-1), { x: 300, y: 200, width: 128, height: 44 });
    assert.deepEqual(geometry?.window, { x: 300, y: 200, width: 128, height: 44 });
    assert.equal(geometry?.anchor, 'custom');
  });

  it('la position survit à un apply() ultérieur (3 → 5 participants, x/y identiques)', () => {
    const h = harness();
    h.controller.setPosition(300, 200);
    const dragged = { ...(h.window.boundsWrites.at(-1) as Rect) };

    // Production : la page persiste overlay.position, syncOverlayGeometry relit le magasin.
    const geometry = h.controller.apply(settings({ position: { x: 300, y: 200 } }), 5);

    assert.equal(geometry?.window.x, dragged.x, 'x conservé : 300');
    assert.equal(geometry?.window.y, dragged.y, 'y conservé : 200');
    assert.deepEqual(h.window.boundsWrites.at(-1), { x: 300, y: 200, width: 200, height: 44 });
    assert.equal(geometry?.columns, 5, 'la largeur suit le nombre de participants (128 → 200 DIP)');
  });

  it('position hors écran ⇒ bornée à {1792,1036} par computeOverlayGeometry', () => {
    const h = harness();
    const geometry = h.controller.setPosition(5000, 5000);
    assert.deepEqual(geometry?.window, { x: 1792, y: 1036, width: 128, height: 44 });
    assert.equal(geometry?.positionClamped, true);
    assert.deepEqual(h.window.boundsWrites.at(-1), { x: 1792, y: 1036, width: 128, height: 44 });
  });

  it('position:null ⇒ retour à l’ancrage (le contrôleur ne garde aucune mémoire privée)', () => {
    const h = harness();
    h.controller.setPosition(300, 200);
    const geometry = h.controller.apply(settings({ position: null }), 5);
    assert.deepEqual(geometry?.window, { x: 1720, y: 0, width: 200, height: 44 });
    assert.equal(geometry?.anchor, 'top-right');
  });

  it('setPosition avant create() ⇒ null, aucune écriture de bounds', () => {
    const timers = new FakeTimers();
    const screenDouble = new FakeScreen([DISPLAY]);
    const controller = new OverlayController<FakeWindow>({
      timers,
      screen: screenDouble,
      createWindow: (options) => new FakeWindow(options),
    });
    assert.equal(controller.setPosition(10, 10), null);
    assert.equal(timers.armed.length, 0, 'aucune scrutation armée sans fenêtre');
  });
});

// ---------------------------------------------------------------------------------------------
// 5. Démontage : plus une seule scrutation orpheline
// ---------------------------------------------------------------------------------------------

describe('overlay-controller — démontage', () => {
  it('destroy() puis 10 ticks ⇒ 0 lecture de curseur et 0 setIgnoreMouseEvents de plus', () => {
    const h = harness();
    h.screen.moveCursorTo(INSIDE_AVATAR_1);
    h.timers.tick(3); // la scrutation travaille
    const readsBefore = h.screen.cursorReads;
    const writesBefore = h.window.ignoreWrites.length;

    h.controller.destroy();

    h.timers.tick(10);
    assert.equal(h.screen.cursorReads, readsBefore, '0 lecture de curseur après destroy()');
    assert.equal(h.window.ignoreWrites.length, writesBefore, '0 écriture ignore après destroy()');
    assert.equal(h.window.destroyCalls, 1);
    assert.deepEqual(h.timers.cancelled, [1], 'l’échéance répétée est bien désarmée une fois');
    assert.equal(h.controller.getWindow(), null);
    assert.equal(h.controller.getGeometry(), null);
  });

  it('fermeture par le gestionnaire de fenêtres (closed) ⇒ 10 ticks, 0 scrutation', () => {
    const h = harness();
    h.screen.moveCursorTo(INSIDE_AVATAR_1);
    h.timers.tick(2);
    const readsBefore = h.screen.cursorReads;
    const writesBefore = h.window.ignoreWrites.length;

    h.window.emit('closed');

    h.timers.tick(10);
    assert.equal(h.screen.cursorReads, readsBefore, 'aucune scrutation orpheline après closed');
    assert.equal(h.window.ignoreWrites.length, writesBefore);
    assert.deepEqual(h.timers.cancelled, [1]);
  });

  it('la scrutation est armée une seule fois, à 120 ms, par le port', () => {
    const h = harness();
    h.controller.create('/tmp/preload.js'); // deuxième create : fenêtre existante, rien de plus
    assert.deepEqual(h.timers.armedRepeats, [{ ms: MOUSE_POLL_INTERVAL_MS, repeating: true }]);
    assert.equal(MOUSE_POLL_INTERVAL_MS, 120);
  });
});

// ---------------------------------------------------------------------------------------------
// 6. enabled:false : caché, géométrie nulle, scrutation muette
// ---------------------------------------------------------------------------------------------

describe('overlay-controller — overlay désactivée', () => {
  it('enabled:false ⇒ hide() = 1, géométrie null, apply() rend null', () => {
    const h = harness();
    const hiddenBefore = h.window.hideCalls;
    assert.equal(h.controller.apply(settings({ enabled: false }), 3), null);
    assert.equal(h.window.hideCalls, hiddenBefore + 1);
    assert.equal(h.controller.getGeometry(), null);
    assert.equal(h.window.isVisible(), false);
  });

  it('enabled:false puis 10 ticks ⇒ 0 lecture de curseur, 0 écriture ignore', () => {
    const h = harness();
    h.controller.apply(settings({ enabled: false }), 3);
    const readsBefore = h.screen.cursorReads;
    const writesBefore = h.window.ignoreWrites.length;
    h.timers.tick(10);
    assert.equal(h.screen.cursorReads, readsBefore);
    assert.equal(h.window.ignoreWrites.length, writesBefore);
  });

  it('réactivation ⇒ la fenêtre revient en showInactive avec la géométrie recalculée', () => {
    const h = harness();
    h.controller.apply(settings({ enabled: false }), 3);
    const shownBefore = h.window.showInactiveCalls;
    const geometry = h.controller.apply(settings(), 3);
    assert.deepEqual(geometry?.window, { x: 1792, y: 0, width: 128, height: 44 });
    assert.equal(h.window.showInactiveCalls, shownBefore + 1);
    assert.deepEqual(h.window.boundsWrites.at(-1), { x: 1792, y: 0, width: 128, height: 44 });
  });
});

// ---------------------------------------------------------------------------------------------
// 7. Port écran : ce que la scrutation lit vraiment
// ---------------------------------------------------------------------------------------------

describe('overlay-controller — port écran', () => {
  it('le suivi de zone utilise le curseur ABSOLU moins les bounds de la fenêtre', () => {
    const h = harness();
    // Un seul point absolu, deux positions de fenêtre : la zone change, donc la soustraction a lieu.
    const cursor = { x: 413, y: 222 };
    h.screen.moveCursorTo(cursor);

    h.controller.setPosition(300, 200); // relatif (113, 22) → bande vide 111..115 → extérieur
    const base = h.window.ignoreWrites.length;
    h.timers.tick();
    assert.deepEqual(ignoreCallsSince(h.window, base), [{ ignore: true, options: { forward: true } }]);

    h.controller.setPosition(393, 200); // relatif (20, 22) → avatar 1 (6..38) → interactif
    const base2 = h.window.ignoreWrites.length;
    h.timers.tick();
    assert.deepEqual(ignoreCallsSince(h.window, base2), [{ ignore: false, options: { forward: true } }]);
  });

  it('listDisplays(port) : 2 écrans, identifiants en chaîne, primaire marqué, aucun curseur lu', () => {
    const screenDouble = new FakeScreen([DISPLAY, DISPLAY_SECONDARY]);
    const displays = listDisplays(screenDouble);
    assert.deepEqual(displays, [
      { id: 'ecran-1', workArea: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1, primary: true },
      { id: 'ecran-2', workArea: { x: 1920, y: 0, width: 1280, height: 1024 }, scaleFactor: 1.5, primary: false },
    ]);
    assert.equal(screenDouble.cursorReads, 0);
  });

  it('screenId choisit l’écran secondaire : géométrie calée sur sa zone utile', () => {
    const h = harness({ displays: [DISPLAY, DISPLAY_SECONDARY] });
    const geometry = h.controller.apply(settings({ screenId: 'ecran-2' }), 3);
    assert.deepEqual(geometry?.window, { x: 1920 + 1280 - 128, y: 0, width: 128, height: 44 });
    assert.equal(geometry?.scaleFactor, 1.5);
  });
});
