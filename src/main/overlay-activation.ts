/**
 * overlay-activation.ts — quand l'overlay doit être visible, et comment le poser.
 *
 * Pur (aucun Electron) : les tests mesurent la règle, le contrôleur ne fait que l'appliquer.
 *
 * L'overlay n'est visible QUE au-dessus d'un jeu ou d'une application plein écran, jamais
 * sur le bureau. Il faut qu'il soit activé, qu'un salon soit ouvert, et qu'une sonde
 * annonce un plein écran (pas le bureau, pas Concord).
 *
 * Windows : le niveau `screen-saver` se compose avec le plein écran exclusif. On ne
 * l'applique qu'au moment de l'affichage, après `showInactive` : un bit topmost posé
 * pendant que la fenêtre est cachée ne tient pas.
 *
 * Linux : GTK ignore le niveau, et un `screen-saver` explicite peut empêcher
 * `_NET_WM_STATE_ABOVE`. On appelle `setAlwaysOnTop(true)` sans niveau, avec
 * `visibleOnFullScreen`.
 *
 * Wayland natif : la sonde ne peut pas voir le plein écran. L'overlay reste caché,
 * sauf `showWithoutDetection`. Le défaut de Concord sous Wayland est XWayland
 * (`preferX11Ozone`) : `xprop` y voit les jeux X11. Un jeu uniquement Wayland peut
 * échapper à la sonde.
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
  // Windows : au-dessus du plein écran exclusif. La fenêtre est cachée sur le bureau.
  return { alwaysOnTopLevel: 'screen-saver', visibleOnFullScreen: true };
}

export interface OverlayActivation {
  readonly enabled: boolean;
  readonly inRoom: boolean;
  /** La fenêtre principale existe encore (y compris minimisée ou cachée dans le bac). */
  readonly appWindowAlive: boolean;
  /** Un jeu ou une application plein écran est au premier plan. */
  readonly fullscreenApp: boolean;
  /** La sonde ne peut pas répondre (Wayland natif, outil absent). */
  readonly detectionUnavailable: boolean;
  /** Réglage : afficher malgré une sonde muette. */
  readonly showWithoutDetection: boolean;
}

/** Vrai seulement au-dessus d'un plein écran, ou si la sonde est muette et que l'utilisateur force. */
export function shouldShowOverlay(input: OverlayActivation): boolean {
  if (!input.enabled || !input.inRoom || !input.appWindowAlive) return false;
  if (input.fullscreenApp) return true;
  return input.detectionUnavailable && input.showWithoutDetection;
}

/**
 * La fenêtre overlay est créée (cachée) tant que le salon est ouvert et l'overlay activé.
 * La sonde décide ensuite de l'afficher.
 */
export function shouldKeepOverlay(input: {
  enabled: boolean;
  inRoom: boolean;
  appWindowAlive: boolean;
}): boolean {
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
