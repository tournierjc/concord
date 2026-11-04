/**
 * overlay-activation.ts — quand l'overlay doit être visible, et comment le poser.
 *
 * Pur (aucun Electron) : les tests mesurent la règle, le contrôleur ne fait que l'appliquer.
 *
 * Bureau : l'overlay est visible dès qu'il est activé ET qu'un salon est rejoint, que la
 * fenêtre principale soit au premier plan, minimisée ou rangée dans la zone de notification.
 * Il n'attend pas un jeu plein écran.
 *
 * Windows : le niveau `screen-saver` ne se compose qu'avec le plein écran exclusif. Sur le
 * bureau il reste invisible. `floating` reste au-dessus des fenêtres normales ET du bureau.
 * `visibleOnFullScreen` couvre les applications plein écran fenêtrées.
 *
 * Linux / Wayland : GTK ignore le niveau, et un `screen-saver` explicite peut empêcher
 * `_NET_WM_STATE_ABOVE`. On appelle `setAlwaysOnTop(true)` sans niveau. Le compositeur
 * Wayland natif ne garantit ni le dessus, ni la position, ni le click-through d'une fenêtre
 * transparente. Le défaut, si personne n'a choisi `--ozone-platform` ni
 * `ELECTRON_OZONE_PLATFORM_HINT`, est XWayland (`--ozone-platform=x11`) : above, position
 * et click-through fonctionnent. Un utilisateur qui force Wayland garde ce choix.
 */

export type OverlayPlatform = 'linux' | 'win32' | 'darwin';

export interface OverlayPresentation {
  /** `undefined` : `setAlwaysOnTop(true)` sans niveau (Linux). */
  readonly alwaysOnTopLevel: string | undefined;
  readonly visibleOnFullScreen: boolean;
}

export function overlayPresentation(platform: string): OverlayPresentation {
  if (platform === 'linux') {
    return { alwaysOnTopLevel: undefined, visibleOnFullScreen: true };
  }
  return { alwaysOnTopLevel: 'floating', visibleOnFullScreen: true };
}

export interface OverlayActivation {
  readonly enabled: boolean;
  readonly inRoom: boolean;
  /** La fenêtre principale existe encore (y compris minimisée ou cachée dans le bac). */
  readonly appWindowAlive: boolean;
}

/** Vrai sur le bureau, en plein écran, minimisée ou dans le bac — tant que le salon est ouvert. */
export function shouldShowOverlay(input: OverlayActivation): boolean {
  return input.enabled && input.inRoom && input.appWindowAlive;
}

/**
 * Vrai s'il faut forcer XWayland avant `app.ready`. Un choix explicite (argument ou
 * `ELECTRON_OZONE_PLATFORM_HINT` autre que `auto`) n'est jamais écrasé.
 */
export function preferX11Ozone(
  platform: string,
  sessionType: string | undefined,
  ozoneHint: string | undefined,
  argv: readonly string[] = [],
): boolean {
  if (platform !== 'linux') return false;
  if (argv.some((arg) => arg === '--ozone-platform' || arg.startsWith('--ozone-platform='))) return false;
  const hint = (ozoneHint ?? '').trim().toLowerCase();
  if (hint !== '' && hint !== 'auto') return false;
  return (sessionType ?? '').trim().toLowerCase() === 'wayland';
}
