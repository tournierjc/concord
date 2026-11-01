/**
 * avatar.ts — la règle de l'avatar, seule et testable (SPEC-002, amendement 2026-10-31).
 *
 * SPEC-002 écrivait « la seule identité est un pseudo local ». L'amendement du 31/10/2026 autorise
 * pseudo + avatar, à deux conditions non négociables : l'avatar vient d'une GALERIE EMBARQUÉE
 * (emojis prédéfinis, choix au clic, rien à taper) ou d'une IMAGE CHOISIE LOCALEMENT (dialogue de
 * fichiers, redimensionnée puis copiée dans `userData/avatars/`). Pas de compte, pas d'e-mail, pas
 * de téléversement : l'identité reste 100 % locale et LAN.
 *
 * Ce qui voyage sur le fil (SPEC-007 §4, même amendement) n'est JAMAIS l'image — trop lourde pour
 * une ligne JSON bornée à 64 Ko — mais un `avatarRef` : soit un id de galerie (`"fox"`), soit
 * l'empreinte SHA-256 (16 hexadécimaux) du PNG stocké. Un pair qui rencontre une empreinte
 * inconnue demande l'image par la signalisation existante (`avatar_get` / `avatar_data`, bornées
 * elles aussi) ; si la réponse manque ou est corrompue, il retombe sur ses initiales.
 *
 * Deux noms, deux mondes : `avatar` est le nom du RÉGLAGE persisté, `avatarRef` est le nom du
 * champ SUR LE FIL. Ne les confondez pas.
 *
 * Comme `nickname.ts`, ce module n'importe rien : les bornes vérifiées ici sont les mêmes que
 * celles du schéma de réglages et des gardes IPC, et c'est un test qui tient la cohérence.
 */

/** Un choix de la galerie embarquée : identifiant court + emoji rendu tel quel. */
export interface GalleryAvatar {
  readonly id: string;
  readonly emoji: string;
}

/**
 * La galerie embarquée — 16 visages et formes, lisibles à 28 px et distincts entre eux. Emojis
 * seuls : rien à télécharger, rien à stocker, rendu par le système. L'ORDRE est figé (il fait
 * office de table de rendu) et le COMPTE est vérifié par un test.
 */
export const AVATAR_GALLERY: readonly GalleryAvatar[] = Object.freeze([
  { id: 'fox', emoji: '🦊' },
  { id: 'owl', emoji: '🦉' },
  { id: 'cat', emoji: '🐱' },
  { id: 'panda', emoji: '🐼' },
  { id: 'whale', emoji: '🐋' },
  { id: 'bee', emoji: '🐝' },
  { id: 'turtle', emoji: '🐢' },
  { id: 'robot', emoji: '🤖' },
  { id: 'alien', emoji: '👽' },
  { id: 'ghost', emoji: '👻' },
  { id: 'star', emoji: '⭐' },
  { id: 'moon', emoji: '🌙' },
  { id: 'sun', emoji: '🌞' },
  { id: 'rainbow', emoji: '🌈' },
  { id: 'heart', emoji: '💛' },
  { id: 'bolt', emoji: '⚡' },
] as const);

/** Vrai si la chaîne est l'id d'un choix de la galerie. */
export function isGalleryAvatarId(value: unknown): value is string {
  return typeof value === 'string' && AVATAR_GALLERY.some((entry) => entry.id === value);
}

/** Rend l'emoji d'un id de galerie, ou `null` si l'id n'est pas dans la galerie. */
export function avatarEmojiFor(id: string | null | undefined): string | null {
  if (typeof id !== 'string') return null;
  for (const entry of AVATAR_GALLERY) {
    if (entry.id === id) return entry.emoji;
  }
  return null;
}

/* --- Avatar local (image choisie par la personne) ------------------------------------------- */

/** Extensions acceptées par le dialogue d'ouverture (png / jpg / webp, les trois formats promis). */
export const AVATAR_IMAGE_EXTENSIONS: readonly string[] = Object.freeze(['.png', '.jpg', '.jpeg', '.webp']);

/** Vrai si le chemin porte une extension acceptée (comparaison insensible à la casse). */
export function isAllowedAvatarImagePath(path: unknown): path is string {
  if (typeof path !== 'string') return false;
  const lower = path.toLowerCase();
  return AVATAR_IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * Taille maximale du FICHIER SOURCE lu sur le disque (2 Mo). C'est une borne d'entrée : l'image
 * réellement stockée est un carré PNG de 256 px, toujours bien plus petit.
 */
export const AVATAR_MAX_SOURCE_BYTES = 2 * 1024 * 1024;

/** Côté du carré stocké (256 px) : largement suffisant pour un avatar affiché à 28 px. */
export const AVATAR_STORED_SIZE_PX = 256;

/** Plafond du PNG stocké, vérifié à l'écriture ET à la lecture (défense en profondeur). */
export const AVATAR_MAX_STORED_BYTES = 256 * 1024;

/** Longueur d'une empreinte : les 16 premiers hexadécimaux du SHA-256 du PNG stocké. */
export const AVATAR_REF_LENGTH = 16;

const REF_PATTERN = /^[0-9a-f]{16}$/u;
const FILENAME_PATTERN = /^[0-9a-f]{16}\.png$/u;

/** Vrai si la chaîne a la forme d'une empreinte d'avatar (16 hexadécimaux minuscules). */
export function isAvatarRef(value: unknown): value is string {
  return typeof value === 'string' && REF_PATTERN.test(value);
}

/** Vrai si le nom de fichier est celui d'un avatar stocké (`<empreinte>.png`) — jamais un chemin. */
export function isAvatarFileName(value: unknown): value is string {
  return typeof value === 'string' && FILENAME_PATTERN.test(value);
}

/**
 * Un avatar local tel qu'il est persisté : `file` n'est JAMAIS un chemin, c'est
 * `<empreinte>.png` dans `userData/avatars/`. L'empreinte est stockée à côté pour être
 * revérifiée : un fichier dont le nom ment est rejeté, pas servi.
 */
export interface CustomAvatar {
  readonly kind: 'custom';
  readonly file: string;
  readonly ref: string;
}

/** Le réglage `avatar` : un id de galerie, une image locale, ou absent (`null` = initiales). */
export type AvatarSetting = string | CustomAvatar | null;

/** Les deux noms d'un avatar custom validé (garde de `ipc-contract`, importée par le schéma). */
export const CUSTOM_AVATAR_KEYS = ['kind', 'file', 'ref'] as const;

/**
 * Vrai si l'objet a la forme EXACTE d'un avatar custom : `{ kind: 'custom', file, ref }`, pas un
 * champ de plus, pas un champ de moins. La coïncidence `file === `${ref}.png` est vérifiée par
 * `customAvatarRef` — ici on ne valide que la forme, comme le fait `guardParticipant` pour les
 * autres DTO : le schéma et la garde IPC partagent CETTE fonction, une seule règle.
 */
export function isCustomAvatarShape(value: unknown): value is CustomAvatar {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 3) return false;
  for (const key of keys) {
    if (!(CUSTOM_AVATAR_KEYS as readonly string[]).includes(key)) return false;
  }
  return record['kind'] === 'custom' && typeof record['file'] === 'string' && typeof record['ref'] === 'string';
}

/** Construit l'avatar custom persisté depuis une empreinte ; `null` si l'empreinte est hors contrat. */
export function makeCustomAvatar(ref: string): CustomAvatar | null {
  if (!isAvatarRef(ref)) return null;
  return { kind: 'custom', file: `${ref}.png`, ref };
}

/** L'empreinte d'un avatar custom, ou `null` s'il est mal formé (nom et empreinte doivent coïncider). */
export function customAvatarRef(avatar: AvatarSetting | null | undefined): string | null {
  if (avatar === null || avatar === undefined || typeof avatar === 'string') return null;
  if (avatar.kind !== 'custom') return null;
  if (!isAvatarFileName(avatar.file) || !isAvatarRef(avatar.ref)) return null;
  if (avatar.file !== `${avatar.ref}.png`) return null;
  return avatar.ref;
}

/**
 * L'empreinte qui voyage sur le fil : l'id de galerie tel quel, l'empreinte pour une image
 * locale, `null` (champ absent) pour un avatar absent ou mal formé — le pair affichera alors ses
 * initiales, jamais une image inventée.
 */
export function avatarRefFor(avatar: AvatarSetting | null | undefined): string | null {
  if (typeof avatar === 'string') return isGalleryAvatarId(avatar) ? avatar : null;
  return customAvatarRef(avatar);
}

/* --- Défaut déterministe --------------------------------------------------------------------- */

/**
 * Hachage FNV-1a 32 bits (non cryptographique — un défaut stable suffit). `src/shell` n'a pas
 * accès à `node:crypto` (module pur, aucun import) : le choix du visage par défaut ne dépend donc
 * d'aucune bibliothèque, et un test l'exécute sans rien installer.
 */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index) & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Le visage par défaut d'une installation : un choix de galerie DÉTERMINISTÉ par l'empreinte locale
 * (`instanceId`). Deux relances sur la même machine donnent le même visage ; rien d'aléatoire,
 * rien à saisir — transparent pour une personne non technique.
 */
export function defaultAvatarIdFor(
  instanceId: string,
  hash: (text: string) => number = fnv1a32,
): string {
  const fingerprint = typeof instanceId === 'string' && instanceId.length > 0 ? instanceId : 'concord';
  const index = hash(fingerprint) % AVATAR_GALLERY.length;
  return AVATAR_GALLERY[index]?.id ?? AVATAR_GALLERY[0]?.id ?? 'fox';
}

/**
 * Valide un `avatarRef` reçu du fil : un id de galerie ou une empreinte, sinon `null`. Le
 * récepteur ne fait confiance à AUCUNE autre valeur — elle deviendrait une image arbitraire.
 */
export function normalizeIncomingAvatarRef(value: unknown): string | null {
  if (typeof value === 'string' && isGalleryAvatarId(value)) return value;
  if (isAvatarRef(value)) return value;
  return null;
}

/**
 * Les initiales de repli — la réponse honnête quand aucun avatar n'est connu. Même règle que
 * `Room.tsx` / `Overlay.tsx` (deux premières lettres, en capitales) : le repli ne doit pas changer
 * de figure selon l'endroit où il s'affiche.
 */
export function avatarInitials(name: string | null | undefined): string {
  const parts = (typeof name === 'string' ? name : '').trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || '?';
}
