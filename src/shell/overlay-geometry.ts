/**
 * overlay-geometry.ts — géométrie de la fenêtre overlay (SPEC-001 E4 / A4 / CA15).
 *
 * Module PUR : aucun import de valeur, aucune dépendance `electron`, aucun accès disque. Il est
 * exécutable tel quel par `node --test` (type-stripping Node 22) et utilisable par le process
 * principal, qui se contente de transmettre le résultat à `BrowserWindow.setBounds()`.
 *
 * Décisions de conception, toutes vérifiées par tests/overlay-geometry.test.ts :
 *  - Taille d'avatar 28 px, halo 2 px, animation 80 ms (valeurs figées par SPEC-001). Elles sont
 *    recopiées depuis design/tokens.json et le test compare les deux sources pour empêcher la
 *    dérive silencieuse.
 *  - Tout est calculé en DIP (device independent pixels), unité de `BrowserWindow.setBounds()`.
 *    `scaleFactor` (devicePixelRatio de l'écran) sert à deux choses : arrondir chaque coordonnée
 *    sur la grille de pixels physiques (sinon halo de 2 px flou) et exposer la taille réelle en
 *    pixels physiques (`windowDevicePixels`).
 *  - Le placement est ancré à un écran, jamais à une position absolue : si l'écran change de
 *    résolution ou si l'overlay est déplacé hors champ, le résultat est ramené dans la zone utile
 *    (`positionClamped`). Une position « custom » (overlay déplacé à la souris) est conservée mais
 *    bornée de la même façon.
 *  - La largeur est plafonnée (336 px) : au-delà, on passe à la ligne. La hauteur reste donc
 *    connue et petite, condition pour que l'overlay ne mange pas l'écran (CA15).
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type OverlayScale = 'sm' | 'md' | 'lg';

export type OverlayAnchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
  | 'custom';

/** Rangée ou colonne, une fois la fenêtre dimensionnée. */
export type OverlayFlow = 'row' | 'column';

/** Sens persisté : horizontal = rangée, vertical = colonne. */
export type OverlayOrientation = 'horizontal' | 'vertical';

export type OverlayEdgeAnchor = Exclude<OverlayAnchor, 'custom'>;

/** Un des 12 emplacements : sens × ancrage, pas le produit complet (un centre de bord n’a qu’un sens). */
export interface OverlayPlacement {
  readonly flow: OverlayOrientation;
  readonly anchor: OverlayEdgeAnchor;
}

export const DEFAULT_OVERLAY_PLACEMENT: OverlayPlacement = { flow: 'horizontal', anchor: 'top-right' };

const HORIZONTAL_ANCHORS: readonly OverlayEdgeAnchor[] = [
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];
const VERTICAL_ANCHORS: readonly OverlayEdgeAnchor[] = [
  'top-left',
  'center-left',
  'bottom-left',
  'top-right',
  'center-right',
  'bottom-right',
];

/** Les 12 boutons du sélecteur, dans l’ordre du bord haut, du bord bas, puis des côtés. */
export const OVERLAY_PICKER_SLOTS: readonly OverlayPlacement[] = [
  ...HORIZONTAL_ANCHORS.map((anchor) => ({ flow: 'horizontal' as const, anchor })),
  ...VERTICAL_ANCHORS.map((anchor) => ({ flow: 'vertical' as const, anchor })),
];

const LEGACY_PLACEMENT: Readonly<Record<string, OverlayPlacement>> = {
  'top-right': { flow: 'horizontal', anchor: 'top-right' },
  'top-left': { flow: 'horizontal', anchor: 'top-left' },
  'bottom-left': { flow: 'horizontal', anchor: 'bottom-left' },
  'bottom-right': { flow: 'horizontal', anchor: 'bottom-right' },
  // L’ancienne colonne était calée en haut du bord.
  left: { flow: 'vertical', anchor: 'top-left' },
  right: { flow: 'vertical', anchor: 'top-right' },
};

export function isValidOverlayPlacement(value: unknown): value is OverlayPlacement {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const flow = record['flow'];
  const anchor = record['anchor'];
  if (flow === 'horizontal') return (HORIZONTAL_ANCHORS as readonly string[]).includes(String(anchor));
  if (flow === 'vertical') return (VERTICAL_ANCHORS as readonly string[]).includes(String(anchor));
  return false;
}

/**
 * Ancien réglage (chaîne de la 0.4.32) ou objet déjà au format 12 emplacements.
 * `null` si la valeur n’est ni l’un ni l’autre : l’appelant retombe sur le défaut.
 */
export function migrateOverlayPlacement(value: unknown): OverlayPlacement | null {
  if (typeof value === 'string' && Object.prototype.hasOwnProperty.call(LEGACY_PLACEMENT, value)) {
    return LEGACY_PLACEMENT[value] ?? null;
  }
  if (!isValidOverlayPlacement(value)) return null;
  return { flow: value.flow, anchor: value.anchor };
}

export function samePlacement(a: OverlayPlacement, b: OverlayPlacement): boolean {
  return a.flow === b.flow && a.anchor === b.anchor;
}

export function placementFlow(placement: OverlayPlacement): OverlayFlow {
  return placement.flow === 'vertical' ? 'column' : 'row';
}

export function placementAnchor(placement: OverlayPlacement): OverlayEdgeAnchor {
  return placement.anchor;
}

/** Clé i18n du bouton. Le composant l’écrit aussi en littéral pour la garde des clés mortes. */
export function placementLabelKey(placement: OverlayPlacement): string {
  const camel = placement.anchor.replace(/-([a-z])/gu, (_match, letter: string) => letter.toUpperCase());
  return `settings.overlay.placement.${placement.flow}.${camel}`;
}

/**
 * Barre miniature collée au bord qu’elle représente.
 * Les centres sont à 50 % du bord, les coins rentrés de 6 %.
 */
export function pickerBarStyle(placement: OverlayPlacement): Record<string, string> {
  const horizontal = placement.flow === 'horizontal';
  const anchor = placement.anchor;
  const style: Record<string, string> = {
    width: horizontal ? '22%' : '8%',
    height: horizontal ? '10%' : '26%',
  };
  if (horizontal) {
    if (anchor.startsWith('top')) style['top'] = '6%';
    if (anchor.startsWith('bottom')) style['bottom'] = '6%';
    if (anchor.endsWith('left')) style['left'] = '16%';
    if (anchor.endsWith('right')) style['right'] = '16%';
    if (anchor.endsWith('center')) {
      style['left'] = '50%';
      style['transform'] = 'translateX(-50%)';
    }
    return style;
  }
  if (anchor.endsWith('left')) style['left'] = '4%';
  if (anchor.endsWith('right')) style['right'] = '4%';
  if (anchor.startsWith('top')) style['top'] = '18%';
  if (anchor.startsWith('bottom')) style['bottom'] = '18%';
  if (anchor.startsWith('center')) {
    style['top'] = '50%';
    style['transform'] = 'translateY(-50%)';
  }
  return style;
}

/** Résultat d'un test de survol : la fenêtre overlay ne capture les clics que sur ces zones. */
export type OverlayHitZone = 'avatar' | 'handle' | 'none';

// --- Valeurs figées (SPEC-001) -------------------------------------------------------------

/** Taille d'avatar, en DIP. Figée à 28 px par SPEC-001 E4. */
export const AVATAR_SIZE_PX = 28;
/** Épaisseur du halo de parole, en DIP. Figée à 2 px. */
export const HALO_WIDTH_PX = 2;
/** Durée de l'animation du halo, en ms. Figée à 80 ms. */
export const HALO_ANIMATION_MS = 80;
/** Espacement entre avatars (design/tokens.json). */
export const AVATAR_GAP_PX = 8;
/** Marge intérieure de la fenêtre overlay (design/tokens.json). */
export const PADDING_PX = 8;
/** Largeur de la poignée de déplacement : seule zone « cliquable » en dehors des avatars. */
export const HANDLE_WIDTH_PX = 12;
/** Largeur maximale de la fenêtre overlay : au-delà, passage à la ligne (tokens). */
export const MAX_OVERLAY_WIDTH_PX = 336;
/** Nombre minimal d'avatars représentables. */
export const MIN_OVERLAY_PARTICIPANTS = 1;
/** Plafond de représentation de l'overlay : au-delà de 8 (SPEC A2), on masque les surnuméraires. */
export const MAX_OVERLAY_PARTICIPANTS = 10;
/** Arrondi maximal accepté pour un devicePixelRatio (4 = écran HiDPI extrême). */
export const MAX_SCALE_FACTOR = 4;

/** Taille d'avatar par cran d'échelle. `md` = valeur figée par la spec. */
export const AVATAR_SIZE_BY_SCALE: Readonly<Record<OverlayScale, number>> = {
  sm: 24,
  md: AVATAR_SIZE_PX,
  lg: 36,
};

// --- Utilitaires ----------------------------------------------------------------------------

export function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Ramène un devicePixelRatio dans la plage exploitable (1..4, 1 si non fini). */
export function sanitizeScaleFactor(scaleFactor: number | undefined): number {
  if (typeof scaleFactor !== 'number' || !Number.isFinite(scaleFactor)) return 1;
  return clamp(scaleFactor, 1, MAX_SCALE_FACTOR);
}

/**
 * Aligne une coordonnée sur la grille des pixels physiques.
 * À l'échelle 1, c'est l'entier le plus proche ; à l'échelle 2, le demi-DIP le plus proche.
 */
export function snapToDevicePixels(value: number, scaleFactor: number | undefined): number {
  const sf = sanitizeScaleFactor(scaleFactor);
  return Math.round(value * sf) / sf;
}

/** Écran tel que le process principal le connaît (`screen.getAllDisplays()`). */
export interface DisplayInfo {
  id: string;
  workArea: Rect;
  scaleFactor: number;
  primary: boolean;
}

export interface DisplaySelection {
  displayId: string;
  workArea: Rect;
  scaleFactor: number;
  /** Vrai si l'écran demandé n'existe plus (débranché) : on est retombé sur l'écran principal. */
  fallback: boolean;
}

/**
 * Choisit l'écran de l'overlay. Un identifiant inconnu (écran débranché, configuration changée)
 * retombe sur l'écran principal : l'overlay ne disparaît jamais dans le vide.
 */
export function resolveWorkArea(
  displays: readonly DisplayInfo[],
  screenId: string | null | undefined,
): DisplaySelection {
  if (displays.length === 0) throw new Error('aucun écran disponible');
  if (screenId) {
    const match = displays.find((display) => display.id === screenId);
    if (match) {
      return {
        displayId: match.id,
        workArea: match.workArea,
        scaleFactor: sanitizeScaleFactor(match.scaleFactor),
        fallback: false,
      };
    }
  }
  const primary = displays.find((display) => display.primary) ?? displays[0];
  if (!primary) throw new Error('aucun écran disponible');
  return {
    displayId: primary.id,
    workArea: primary.workArea,
    scaleFactor: sanitizeScaleFactor(primary.scaleFactor),
    fallback: Boolean(screenId),
  };
}

// --- Calcul principal -----------------------------------------------------------------------

export interface OverlayGeometryInput {
  /** Nombre de participants à afficher (borné à 1..10). */
  participantCount: number;
  /** Zone utile de l'écran cible, en DIP. */
  workArea: Rect;
  /** devicePixelRatio de l'écran cible ; 1 par défaut. */
  scaleFactor?: number;
  /** Cran d'échelle choisi dans les réglages ; `md` par défaut. */
  scale?: OverlayScale;
  /** Ancrage ; `top-right` par défaut. */
  anchor?: OverlayAnchor;
  /** `column` empile les pastilles. `row` par défaut (rangée, retour à la ligne). */
  flow?: OverlayFlow;
  /** Position mémorisée, utilisée seulement si `anchor === 'custom'`. */
  position?: Point | null;
  /** Marge par rapport aux bords de la zone utile, en DIP (0 par défaut). */
  margin?: number;
  /** Plafond de largeur ; `MAX_OVERLAY_WIDTH_PX` par défaut. */
  maxWidth?: number;
}

export interface OverlayAvatarBox {
  /** Indice du participant, 0-based. */
  index: number;
  /** Boîte de l'avatar, relative à la fenêtre overlay (DIP). */
  rect: Rect;
  /** Centre, relatif à la fenêtre (DIP) — utile pour les jauges. */
  center: Point;
  /** Zone qui capte les clics : avatar + halo (DIP, relative à la fenêtre). */
  hitRect: Rect;
}

export interface OverlayGeometry {
  /** Nombre effectivement représenté (1..10). */
  participantCount: number;
  requestedCount: number;
  /** Vrai si `participantCount` a été ramené dans les bornes. */
  countClamped: boolean;
  columns: number;
  rows: number;
  avatarSize: number;
  gap: number;
  padding: number;
  haloWidth: number;
  haloAnimationMs: number;
  handleWidth: number;
  scaleFactor: number;
  scale: OverlayScale;
  anchor: OverlayAnchor;
  flow: OverlayFlow;
  /** Bornes de la fenêtre, en DIP, position écran incluse : à passer tel quel à setBounds(). */
  window: Rect;
  /** Taille réelle en pixels physiques (window × scaleFactor). */
  windowDevicePixels: Size;
  /** Poignée de déplacement (relative à la fenêtre). */
  handle: Rect;
  avatars: OverlayAvatarBox[];
  /** Vrai si la position demandée a été ramenée dans la zone utile. */
  positionClamped: boolean;
}

function placeOnWorkArea(
  anchor: OverlayAnchor,
  workArea: Rect,
  width: number,
  height: number,
  margin: number,
  position: Point | null | undefined,
): Point {
  const innerX = workArea.x + margin;
  const innerY = workArea.y + margin;
  const innerW = Math.max(0, workArea.width - 2 * margin);
  const innerH = Math.max(0, workArea.height - 2 * margin);
  const centerX = innerX + (innerW - width) / 2;
  const centerY = innerY + (innerH - height) / 2;
  const rightX = innerX + innerW - width;
  const bottomY = innerY + innerH - height;
  switch (anchor) {
    case 'top-left':
      return { x: innerX, y: innerY };
    case 'top-center':
      return { x: centerX, y: innerY };
    case 'center-left':
      return { x: innerX, y: centerY };
    case 'center-right':
      return { x: rightX, y: centerY };
    case 'bottom-left':
      return { x: innerX, y: bottomY };
    case 'bottom-center':
      return { x: centerX, y: bottomY };
    case 'bottom-right':
      return { x: rightX, y: bottomY };
    case 'custom':
      return position ? { x: position.x, y: position.y } : { x: rightX, y: innerY };
    case 'top-right':
    default:
      return { x: rightX, y: innerY };
  }
}

/** Calcule la géométrie complète de l'overlay pour N participants sur un écran donné. */
export function computeOverlayGeometry(input: OverlayGeometryInput): OverlayGeometry {
  if (typeof input.participantCount !== 'number' || !Number.isFinite(input.participantCount)) {
    throw new TypeError('participantCount doit être un nombre fini');
  }

  const requestedCount = Math.round(input.participantCount);
  const participantCount = clamp(requestedCount, MIN_OVERLAY_PARTICIPANTS, MAX_OVERLAY_PARTICIPANTS);
  const countClamped = participantCount !== requestedCount;

  const scale: OverlayScale = input.scale ?? 'md';
  const avatarSize = AVATAR_SIZE_BY_SCALE[scale];
  const gap = AVATAR_GAP_PX;
  const padding = PADDING_PX;
  const scaleFactor = sanitizeScaleFactor(input.scaleFactor);
  const anchor: OverlayAnchor = input.anchor ?? 'top-right';
  const flow: OverlayFlow = input.flow ?? 'row';
  const margin = Math.max(0, Math.round(input.margin ?? 0));

  const workArea: Rect = {
    x: Math.round(input.workArea.x),
    y: Math.round(input.workArea.y),
    width: Math.max(0, Math.round(input.workArea.width)),
    height: Math.max(0, Math.round(input.workArea.height)),
  };

  // Rangée : on réserve la poignée à droite. Colonne : une seule file, poignée en bas.
  const maxWidth = Math.max(avatarSize + 2 * padding, Math.round(input.maxWidth ?? MAX_OVERLAY_WIDTH_PX));
  let columns: number;
  let rows: number;
  let contentWidth: number;
  let contentHeight: number;
  if (flow === 'column') {
    columns = 1;
    rows = participantCount;
    contentWidth = avatarSize + 2 * padding;
    contentHeight = rows * avatarSize + (rows - 1) * gap + 2 * padding + HANDLE_WIDTH_PX;
  } else {
    const usableWidth = Math.min(maxWidth, workArea.width === 0 ? maxWidth : workArea.width) - HANDLE_WIDTH_PX;
    const columnsThatFit = Math.floor((usableWidth - 2 * padding + gap) / (avatarSize + gap));
    columns = Math.max(1, Math.min(participantCount, Number.isFinite(columnsThatFit) ? columnsThatFit : 1));
    rows = Math.ceil(participantCount / columns);
    contentWidth = columns * avatarSize + (columns - 1) * gap + 2 * padding + HANDLE_WIDTH_PX;
    contentHeight = rows * avatarSize + (rows - 1) * gap + 2 * padding;
  }
  const width = workArea.width === 0 ? contentWidth : Math.min(contentWidth, workArea.width);
  const height = workArea.height === 0 ? contentHeight : Math.min(contentHeight, workArea.height);

  // Marge rentrée des deux côtés, puis ancrage. Un centre est le milieu du bord
  // utile (barre des tâches déjà hors de workArea), pas le milieu de l’écran brut.
  const placed = placeOnWorkArea(anchor, workArea, width, height, margin, input.position);
  let x = placed.x;
  let y = placed.y;

  const maxX = workArea.x + Math.max(0, workArea.width - width);
  const maxY = workArea.y + Math.max(0, workArea.height - height);
  const clampedX = clamp(x, workArea.x, maxX);
  const clampedY = clamp(y, workArea.y, maxY);
  const positionClamped = clampedX !== x || clampedY !== y;
  x = clamp(snapToDevicePixels(clampedX, scaleFactor), workArea.x, maxX);
  y = clamp(snapToDevicePixels(clampedY, scaleFactor), workArea.y, maxY);

  const avatars: OverlayAvatarBox[] = [];
  const avatarMaxX = flow === 'column' ? Math.max(0, width - avatarSize) : Math.max(0, width - HANDLE_WIDTH_PX - avatarSize);
  const avatarMaxY = flow === 'column' ? Math.max(0, height - HANDLE_WIDTH_PX - avatarSize) : Math.max(0, height - avatarSize);
  for (let index = 0; index < participantCount; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const rawX = padding + column * (avatarSize + gap);
    const rawY = padding + row * (avatarSize + gap);
    const ax = Math.min(rawX, avatarMaxX);
    const ay = Math.min(rawY, avatarMaxY);
    avatars.push({
      index,
      rect: { x: ax, y: ay, width: avatarSize, height: avatarSize },
      center: { x: ax + avatarSize / 2, y: ay + avatarSize / 2 },
      hitRect: {
        x: ax - HALO_WIDTH_PX,
        y: ay - HALO_WIDTH_PX,
        width: avatarSize + 2 * HALO_WIDTH_PX,
        height: avatarSize + 2 * HALO_WIDTH_PX,
      },
    });
  }

  const handle: Rect =
    flow === 'column'
      ? {
          x: 0,
          y: Math.max(0, height - HANDLE_WIDTH_PX),
          width,
          height: Math.min(HANDLE_WIDTH_PX, height),
        }
      : {
          x: Math.max(0, width - HANDLE_WIDTH_PX),
          y: 0,
          width: Math.min(HANDLE_WIDTH_PX, width),
          height,
        };

  return {
    participantCount,
    requestedCount,
    countClamped,
    columns,
    rows,
    avatarSize,
    gap,
    padding,
    haloWidth: HALO_WIDTH_PX,
    haloAnimationMs: HALO_ANIMATION_MS,
    handleWidth: HANDLE_WIDTH_PX,
    scaleFactor,
    scale,
    anchor,
    flow,
    window: { x, y, width, height },
    windowDevicePixels: {
      width: Math.round(width * scaleFactor),
      height: Math.round(height * scaleFactor),
    },
    handle,
    avatars,
    positionClamped,
  };
}

function contains(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/**
 * Test de survol, en coordonnées RELATIVES à la fenêtre overlay (DIP).
 * Le process principal s'en sert pour `setIgnoreMouseEvents()` : hors avatar et hors poignée,
 * l'overlay est transparent aux clics (CA15 : on clique « à travers » l'overlay).
 */
export function hitTest(geometry: OverlayGeometry, point: Point): OverlayHitZone {
  if (contains(geometry.handle, point)) return 'handle';
  for (const avatar of geometry.avatars) {
    if (contains(avatar.hitRect, point)) return 'avatar';
  }
  return 'none';
}

/**
 * Variables CSS de l'overlay, dérivées de la géométrie : le rendu ne réécrit aucune constante.
 * Les clés sont des propriétés personnalisées, acceptées telles quelles par un `style` React.
 */
export function overlayCssVariables(geometry: OverlayGeometry): Record<string, string> {
  return {
    '--overlay-width': `${geometry.window.width}px`,
    '--overlay-height': `${geometry.window.height}px`,
    '--overlay-avatar-size': `${geometry.avatarSize}px`,
    '--overlay-gap': `${geometry.gap}px`,
    '--overlay-padding': `${geometry.padding}px`,
    '--overlay-halo-width': `${geometry.haloWidth}px`,
    '--overlay-halo-ms': `${geometry.haloAnimationMs}ms`,
    '--overlay-handle-width': `${geometry.handleWidth}px`,
  };
}
