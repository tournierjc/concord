/**
 * permissions.ts — quelles permissions Electron sont accordées, et à quoi.
 *
 * POURQUOI CE MODULE EXISTE. La coquille répondait `permission === 'media'` sans jamais lire ce qui
 * était demandé (`src/main/index.ts:258-261`) : une page du renderer (ou un script injecté dedans)
 * obtenait donc la **caméra** aussi facilement que le micro, alors que l'application ne s'en sert
 * nulle part — elle fait de la voix, pas de la visée. `Permissions-Policy` (dans `securityHeaders`)
 * dit `camera=()`, la décision doit dire la même chose : sans quoi l'en-tête est un vœu et le
 * gestionnaire de permission une porte ouverte.
 *
 * Module PUR (aucun import d'`electron`) : la règle est falsifiable par `node --test` — `index.ts`,
 * lui, n'est pas importable en test.
 *
 * Ce qui est accordé, exhaustivement :
 *   — `media` avec des types de média tous `audio` (le micro) ;
 *   — `media` **sans** type de média annoncé : traité comme une demande de micro, seul média que
 *     cette application demande jamais (aucun appel `getUserMedia` du dépôt ne demande `video`).
 * Tout le reste — `geolocation`, `notifications`, `clipboard-*`, `usb`, `serial`, `hid`,
 * `display-capture`, `midi`, `fullscreen`, `openExternal`, `mediaKeySystem`, `speaker-selection`,
 * `window-management`, `idle-detection`, `storage-access`, `keyboardLock`, `pointerLock`,
 * `fileSystem`, `unknown` — est refusé sans consulter personne.
 */

/** Types de média que cette application utilise : le micro, jamais la caméra. */
export const ALLOWED_MEDIA_TYPES = ['audio'] as const;

export type AllowedMediaType = (typeof ALLOWED_MEDIA_TYPES)[number];

/** Vrai si TOUS les types demandés sont dans la liste autorisée (liste vide = demande générique). */
function allMediaTypesAllowed(mediaTypes: readonly string[] | undefined): boolean {
  if (mediaTypes === undefined || mediaTypes.length === 0) return true;
  return mediaTypes.every((type) => (ALLOWED_MEDIA_TYPES as readonly string[]).includes(type));
}

/**
 * Décision pour `setPermissionRequestHandler`.
 *
 * `mediaTypes` vient de `MediaAccessPermissionRequest.mediaTypes` (Electron ≥ 22) : c'est ce que la
 * page demande vraiment (`['video']`, `['audio']`, `['audio','video']`).
 */
export function isPermissionAllowed(
  permission: string,
  mediaTypes?: readonly string[],
): boolean {
  if (permission !== 'media') return false;
  return allMediaTypesAllowed(mediaTypes);
}

/**
 * Décision pour `setPermissionCheckHandler`, qui annonce un type UNIQUE (`mediaType`, singulier) —
 * `video`, `audio`, ou `unknown` quand le moteur ne sait pas encore.
 *
 * Seul `video` est refusé ici. Ce gestionnaire ne fait que **prévenir** : c'est
 * `setPermissionRequestHandler` qui accorde, et lui refuse la vidéo. Refuser `unknown` risquerait de
 * faire échouer le micro d'un moteur qui demande son avis avant de connaître le type — un défaut
 * impossible à mesurer ici (aucun binaire Electron exécutable), donc on ne le prend pas.
 */
export function isPermissionCheckAllowed(permission: string, mediaType?: string): boolean {
  if (permission !== 'media') return false;
  return mediaType !== 'video';
}
