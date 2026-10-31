/**
 * tests/overlay-geometry.test.ts — vérification de src/shell/overlay-geometry.ts
 *
 * Exécutable SANS dépendance : `node --test tests/overlay-geometry.test.ts` (Node ≥ 22.6,
 * type-stripping). Couvre SPEC-001 E4 / A4 / CA15 : avatar 28 px, halo 2 px, animation 80 ms,
 * fenêtre 1..10 participants, bornée à l'écran, alignée sur les pixels physiques.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  AVATAR_GAP_PX,
  AVATAR_SIZE_BY_SCALE,
  AVATAR_SIZE_PX,
  HALO_ANIMATION_MS,
  HALO_WIDTH_PX,
  HANDLE_WIDTH_PX,
  MAX_OVERLAY_PARTICIPANTS,
  MAX_OVERLAY_WIDTH_PX,
  PADDING_PX,
  computeOverlayGeometry,
  hitTest,
  overlayCssVariables,
  resolveWorkArea,
  sanitizeScaleFactor,
  snapToDevicePixels,
  type DisplayInfo,
  type Rect,
} from '../src/shell/overlay-geometry.ts';

/** design/tokens.json, cherché depuis le répertoire courant puis vers le haut. */
function loadTokens(): Record<string, any> {
  let dir = resolve(process.cwd());
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(dir, 'design', 'tokens.json');
    if (existsSync(candidate)) return JSON.parse(readFileSync(candidate, 'utf8')) as Record<string, any>;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('design/tokens.json introuvable');
}

const SCREEN_1080: Rect = { x: 0, y: 0, width: 1920, height: 1080 };

function inside(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

test('constantes d\'overlay conformes à SPEC-001 et à design/tokens.json', () => {
  const tokens = loadTokens();
  const overlay = tokens['overlay'];

  assert.equal(AVATAR_SIZE_PX, 28, 'avatar figé à 28 px par SPEC-001');
  assert.equal(overlay['avatarSize'], 28);
  assert.equal(AVATAR_SIZE_PX, overlay['avatarSize'], 'constante = design/tokens.json');

  assert.equal(HALO_WIDTH_PX, 2);
  assert.equal(HALO_WIDTH_PX, overlay['haloWidth']);

  assert.equal(HALO_ANIMATION_MS, 80);
  assert.equal(HALO_ANIMATION_MS, overlay['haloTransitionMs']);

  assert.equal(AVATAR_GAP_PX, overlay['avatarGap']);
  assert.equal(PADDING_PX, overlay['paddingX']);
  assert.equal(PADDING_PX, overlay['paddingY']);
  assert.equal(HANDLE_WIDTH_PX, overlay['handleWidth']);
  assert.equal(MAX_OVERLAY_WIDTH_PX, overlay['maxWidth']);
  assert.equal(AVATAR_SIZE_BY_SCALE['md'], AVATAR_SIZE_PX);
  assert.ok(
    MAX_OVERLAY_PARTICIPANTS >= overlay['maxParticipants'],
    'l\'overlay doit pouvoir représenter au moins les 8 participants du plafond',
  );
});

test('1 à 10 participants : géométrie complète, contenue dans l\'écran', () => {
  for (let count = 1; count <= 10; count += 1) {
    const geometry = computeOverlayGeometry({ participantCount: count, workArea: SCREEN_1080 });
    assert.equal(geometry.participantCount, count, `N=${count}`);
    assert.equal(geometry.avatars.length, count, `N=${count} : un avatar par participant`);
    assert.ok(
      geometry.columns * geometry.rows >= count,
      `N=${count} : la grille couvre tous les avatars`,
    );
    assert.equal(geometry.countClamped, false, `N=${count} n'est pas borné`);
    assert.ok(inside(SCREEN_1080, geometry.window), `N=${count} : fenêtre dans la zone utile`);

    for (const avatar of geometry.avatars) {
      assert.equal(avatar.rect.width, 28, 'avatar 28 px');
      assert.ok(
        inside({ x: 0, y: 0, width: geometry.window.width, height: geometry.window.height }, avatar.hitRect),
        `N=${count} avatar ${avatar.index} : zone interactive dans la fenêtre`,
      );
    }
  }
});

test('8 participants = une seule rangée de 308 px, sous le plafond de 336', () => {
  const geometry = computeOverlayGeometry({ participantCount: 8, workArea: SCREEN_1080 });
  assert.equal(geometry.columns, 8);
  assert.equal(geometry.rows, 1);
  // 8*28 + 7*8 + 2*8 + 12 = 224 + 56 + 16 + 12 = 308
  assert.equal(geometry.window.width, 308);
  assert.equal(geometry.window.height, 44, '28 + 2*8');
  assert.ok(geometry.window.width <= MAX_OVERLAY_WIDTH_PX);
});

test('10 participants : passage à la ligne au-delà du plafond de largeur', () => {
  const geometry = computeOverlayGeometry({ participantCount: 10, workArea: SCREEN_1080 });
  assert.equal(geometry.columns, 8, 'la 9e colonne ne tient pas dans 336 px');
  assert.equal(geometry.rows, 2);
  assert.equal(geometry.avatars.length, 10);
  assert.equal(geometry.window.width, 308);
  assert.equal(geometry.window.height, 28 * 2 + 8 + 16);
});

test('échelle sm/md/lg : seule la taille d\'avatar change', () => {
  const small = computeOverlayGeometry({ participantCount: 4, workArea: SCREEN_1080, scale: 'sm' });
  const medium = computeOverlayGeometry({ participantCount: 4, workArea: SCREEN_1080, scale: 'md' });
  const large = computeOverlayGeometry({ participantCount: 4, workArea: SCREEN_1080, scale: 'lg' });
  assert.equal(small.avatarSize, 24);
  assert.equal(medium.avatarSize, 28);
  assert.equal(large.avatarSize, 36);
  assert.equal(small.haloWidth, 2, 'le halo ne change pas avec l\'échelle');
  assert.ok(large.window.width > medium.window.width);
});

test('placement ancré sur un écran + marge, borné aux bords', () => {
  const topRight = computeOverlayGeometry({ participantCount: 8, workArea: SCREEN_1080 });
  assert.deepEqual(
    { x: topRight.window.x, y: topRight.window.y },
    { x: 1920 - 308, y: 0 },
    'ancrage top-right par défaut, sans marge',
  );

  const withMargin = computeOverlayGeometry({ participantCount: 8, workArea: SCREEN_1080, margin: 12 });
  assert.deepEqual({ x: withMargin.window.x, y: withMargin.window.y }, { x: 1600, y: 12 });

  const bottomLeft = computeOverlayGeometry({
    participantCount: 8,
    workArea: SCREEN_1080,
    anchor: 'bottom-left',
  });
  assert.deepEqual({ x: bottomLeft.window.x, y: bottomLeft.window.y }, { x: 0, y: 1080 - 44 });

  const secondary: Rect = { x: 1920, y: 0, width: 1280, height: 720 };
  const onSecondScreen = computeOverlayGeometry({ participantCount: 8, workArea: secondary });
  assert.equal(onSecondScreen.window.x, 1920 + 1280 - 308, 'coordonnées absolues du 2e écran');
  assert.ok(inside(secondary, onSecondScreen.window));
});

test('position mémorisée hors écran : ramenée dans la zone utile', () => {
  const geometry = computeOverlayGeometry({
    participantCount: 4,
    workArea: SCREEN_1080,
    anchor: 'custom',
    position: { x: 5000, y: -300 },
  });
  assert.equal(geometry.positionClamped, true);
  assert.ok(inside(SCREEN_1080, geometry.window));
  assert.equal(geometry.window.x, 1920 - geometry.window.width);
  assert.equal(geometry.window.y, 0);

  const inPlace = computeOverlayGeometry({
    participantCount: 4,
    workArea: SCREEN_1080,
    anchor: 'custom',
    position: { x: 300, y: 200 },
  });
  assert.equal(inPlace.positionClamped, false);
  assert.deepEqual({ x: inPlace.window.x, y: inPlace.window.y }, { x: 300, y: 200 });
});

test('écran minuscule : la fenêtre reste dans la zone utile et les avatars restent dedans', () => {
  const tiny: Rect = { x: 10, y: 20, width: 40, height: 40 };
  const geometry = computeOverlayGeometry({ participantCount: 6, workArea: tiny });
  assert.ok(geometry.window.width <= 40);
  assert.ok(geometry.window.height <= 40);
  assert.equal(geometry.columns, 1, 'une seule colonne possible');
  assert.equal(geometry.rows, 6);
  assert.ok(inside(tiny, geometry.window));
  for (const avatar of geometry.avatars) {
    assert.ok(
      inside({ x: 0, y: 0, width: geometry.window.width, height: geometry.window.height }, avatar.rect),
      `avatar ${avatar.index} reste dans la fenêtre`,
    );
  }
});

test('devicePixelRatio : alignement sur les pixels physiques et taille en pixels réels', () => {
  assert.equal(snapToDevicePixels(10.3, 1), 10);
  assert.equal(snapToDevicePixels(10.3, 2), 10.5);
  assert.equal(snapToDevicePixels(10.4, 3), 10.333333333333334);

  assert.equal(sanitizeScaleFactor(Number.NaN), 1);
  assert.equal(sanitizeScaleFactor(0), 1);
  assert.equal(sanitizeScaleFactor(99), 4, 'devicePixelRatio plafonné à 4');
  assert.equal(sanitizeScaleFactor(1.5), 1.5);

  const retina = computeOverlayGeometry({ participantCount: 8, workArea: SCREEN_1080, scaleFactor: 2 });
  assert.equal(retina.window.width, 308);
  assert.deepEqual(retina.windowDevicePixels, { width: 616, height: 88 });

  const odd = computeOverlayGeometry({
    participantCount: 8,
    workArea: { x: 0, y: 0, width: 1921, height: 1081 },
    scaleFactor: 2,
  });
  assert.equal(odd.window.x, 1613);
  assert.equal(odd.window.y, 0);
  // x reste sur la grille des demi-pixels : 1613 * 2 est entier.
  assert.equal(odd.window.x * 2, Math.round(odd.window.x * 2));
});

test('nombre de participants borné et refus des entrées non finies', () => {
  assert.equal(computeOverlayGeometry({ participantCount: 0, workArea: SCREEN_1080 }).participantCount, 1);
  const many = computeOverlayGeometry({ participantCount: 12, workArea: SCREEN_1080 });
  assert.equal(many.participantCount, MAX_OVERLAY_PARTICIPANTS);
  assert.equal(many.countClamped, true);
  assert.equal(many.requestedCount, 12);
  assert.throws(
    () => computeOverlayGeometry({ participantCount: Number.NaN, workArea: SCREEN_1080 }),
    TypeError,
  );
});

test('zone interactive : avatar et poignée captent les clics, le reste traverse', () => {
  const geometry = computeOverlayGeometry({ participantCount: 2, workArea: SCREEN_1080 });
  const first = geometry.avatars[0];
  assert.ok(first);
  assert.equal(hitTest(geometry, first.center), 'avatar');
  assert.equal(hitTest(geometry, { x: first.rect.x - 1, y: first.rect.y - 1 }), 'avatar', 'halo cliquable');

  const handleCenter = { x: geometry.handle.x + geometry.handle.width / 2, y: geometry.handle.height / 2 };
  assert.equal(hitTest(geometry, handleCenter), 'handle');

  assert.equal(hitTest(geometry, { x: geometry.window.width - 20, y: 2 }), 'none');
  assert.equal(hitTest(geometry, { x: -5, y: -5 }), 'none');
});

test('variables CSS dérivées de la géométrie (aucune constante dans le rendu)', () => {
  const geometry = computeOverlayGeometry({ participantCount: 3, workArea: SCREEN_1080 });
  const css = overlayCssVariables(geometry);
  assert.equal(css['--overlay-avatar-size'], '28px');
  assert.equal(css['--overlay-halo-width'], '2px');
  assert.equal(css['--overlay-halo-ms'], '80ms');
  assert.equal(css['--overlay-gap'], '8px');
  assert.equal(css['--overlay-padding'], '8px');
  assert.equal(css['--overlay-handle-width'], '12px');
  assert.equal(css['--overlay-width'], `${geometry.window.width}px`);
});

test('choix de l\'écran : écran demandé, repli sur le principal si absent', () => {
  const displays: DisplayInfo[] = [
    { id: '1', workArea: SCREEN_1080, scaleFactor: 1, primary: true },
    { id: '2', workArea: { x: 1920, y: 0, width: 2560, height: 1440 }, scaleFactor: 2, primary: false },
  ];
  const second = resolveWorkArea(displays, '2');
  assert.equal(second.displayId, '2');
  assert.equal(second.fallback, false);
  assert.equal(second.scaleFactor, 2);

  const unknown = resolveWorkArea(displays, '42');
  assert.equal(unknown.displayId, '1');
  assert.equal(unknown.fallback, true);

  const noPreference = resolveWorkArea(displays, null);
  assert.equal(noPreference.displayId, '1');
  assert.equal(noPreference.fallback, false);

  assert.throws(() => resolveWorkArea([], '1'));
});
