/**
 * settings-schema.ts — schéma, valeurs par défaut, validation et migration des réglages
 * (SPEC-001 A11 / A12 / A13 / CA12).
 *
 * Module PUR : aucune dépendance, aucun accès disque, aucun import de valeur. Testé par
 * `node --test tests/settings-schema.test.ts`.
 *
 * Politique de validation, volontairement stricte :
 *  - un champ inconnu est REFUSÉ (code `unknown-field`, chemin pointé), jamais ignoré : un fichier
 *    de réglages qui contient `overlay.opacty` signale une faute de frappe ou une écriture d'une
 *    version plus récente, pas une variation acceptable ;
 *  - un champ manquant en v1 est REFUSÉ aussi (`missing-field`). C'est l'appelant (magasin de
 *    réglages, côté process principal) qui retombe sur `defaultSettings()` et signale l'incident,
 *    au lieu de laisser un réglage à `undefined` se propager dans l'UI ;
 *  - une version future est refusée (`version-future`) : mieux vaut des réglages par défaut
 *    qu'écraser silencieusement la configuration d'une version plus récente.
 */

import {
  isAvatarFileName,
  isAvatarRef,
  isCustomAvatarShape,
  isGalleryAvatarId,
  type AvatarSetting,
  type CustomAvatar,
} from './avatar.ts';

/** Version courante du schéma. Toute évolution de forme incrémente ce nombre. */
export const SETTINGS_VERSION = 1;
/** Version historique (clés plates du prototype) : lue, migrée, jamais écrite. */
export const LEGACY_SETTINGS_VERSION = 0;

/** Plafond de participants par salon, figé par SPEC-001 A2 : le 9ᵉ est refusé. */
export const MAX_ROOM_PARTICIPANTS = 8;
/** Port de signalisation par défaut (SPEC-001 A9), incrémentable jusqu'à SIGNALING_PORT_MAX. */
export const SIGNALING_PORT_DEFAULT = 47821;
export const SIGNALING_PORT_MAX = 47830;
/** Port du beacon de découverte broadcast (SPEC-001 A6). */
export const BEACON_PORT = 47820;
/** Raccourci push-to-talk par défaut (SPEC-001 A13). */
export const DEFAULT_PTT_ACCELERATOR = 'Alt+Space';
/** Bornes d'opacité de l'overlay, recopiées de design/tokens.json (overlay.opacity). */
export const OVERLAY_OPACITY_MIN = 0.6;
export const OVERLAY_OPACITY_MAX = 1;
export const OVERLAY_OPACITY_STEP = 0.05;

export type Locale = 'fr' | 'en';
export type Theme = 'dark' | 'light' | 'system';
export type TalkMode = 'ptt' | 'vad';
export type DiscoveryMode = 'auto' | 'mdns' | 'broadcast';
/** Mêmes crans que la géométrie de l'overlay (test de cohérence croisé). */
export type OverlayScale = 'sm' | 'md' | 'lg';

export interface Point {
  x: number;
  y: number;
}

export interface AudioSettings {
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  /** Suppression de bruit (RNNoise côté moteur) — true par défaut. */
  noiseSuppression: boolean;
  /** Annulation d'écho — true par défaut ; l'état réel est relu dans l'UI (A12). */
  echoCancellation: boolean;
  /** Gain d'entrée, 0..2 (1 = neutre). */
  inputGain: number;
  /**
   * Ducking (2026-11-01) : pendant qu'un PAIR parle, les AUTRES applications du système sont
   * baissées (jamais Concord — la voix des pairs reste à volume plein). `true` par défaut :
   * zéro réglage requis pour un utilisateur non technique. Absent d'un fichier écrit avant ce
   * changement ⇒ `true` (rétro-compat, même profil que `avatar` en 2026-10-31).
   */
  duckOthers: boolean;
}

export interface TalkSettings {
  mode: TalkMode;
  pttAccelerator: string;
  /** Seuil de détection de voix, en dBFS, −80..−10. */
  vadThresholdDb: number;
}

export interface OverlaySettings {
  enabled: boolean;
  /** Opacité de la fenêtre overlay, 0.6..1 (tokens : min 0.6, max 1, pas 0.05). */
  opacity: number;
  scale: OverlayScale;
  /** Écran choisi ; null = écran principal. */
  screenId: string | null;
  /** Dernière position (DIP), null = ancrage par défaut. */
  position: Point | null;
}

export interface NetworkSettings {
  signalingPort: number;
  discovery: DiscoveryMode;
}

export interface Settings {
  version: number;
  locale: Locale;
  theme: Theme;
  nickname: string;
  /**
   * Avatar du profil (SPEC-002, amendement 2026-10-31) : un id de la galerie embarquée, ou une
   * image locale (`{ kind: 'custom', file, ref }`), ou `null` — l'affichage retombe alors sur les
   * initiales du pseudo. Le défaut n'est pas stocké ici : c'est l'appelant qui dérive un choix de
   * galerie stable depuis `instanceId` (voir `avatar.ts`), comme pour `nickname`.
   */
  avatar: AvatarSetting;
  audio: AudioSettings;
  talk: TalkSettings;
  overlay: OverlaySettings;
  network: NetworkSettings;
}

export function defaultSettings(): Settings {
  return {
    version: SETTINGS_VERSION,
    locale: 'fr',
    theme: 'system',
    nickname: '',
    // Pas de défaut stocké : l'appelant dérive un choix de galerie stable depuis `instanceId`
    // (`avatar.ts → defaultAvatarIdFor`). `null` ici veut dire « rien de choisi », initiales.
    avatar: null,
    audio: {
      inputDeviceId: null,
      outputDeviceId: null,
      noiseSuppression: true,
      echoCancellation: true,
      inputGain: 1,
      // Zéro réglage requis : le ducking est actif dès le premier lancement.
      duckOthers: true,
    },
    talk: {
      mode: 'ptt',
      pttAccelerator: DEFAULT_PTT_ACCELERATOR,
      vadThresholdDb: -40,
    },
    overlay: {
      enabled: true,
      opacity: 0.9,
      scale: 'md',
      screenId: null,
      position: null,
    },
    network: {
      signalingPort: SIGNALING_PORT_DEFAULT,
      discovery: 'auto',
    },
  };
}

/**
 * Nom d'affichage d'un participant, dérivé des réglages (SPEC-001 A6).
 *
 * A6 : « Pseudo choisi localement (défaut = prénom du compte OS, modifiable) ». Le schéma de
 * réglages garde `nickname` vide par défaut — un défaut lu sur la machine n'a rien à faire dans un
 * module pur —, donc c'est l'appelant (le main, qui connaît `os.userInfo()`) qui fournit le nom du
 * compte. Fonction pure : même entrée, même sortie, testable sans machine.
 *
 * Retourne toujours une chaîne non vide : un participant sans nom serait un trou dans la liste.
 */
export function resolveDisplayName(nickname: string, osUserName: string): string {
  const chosen = typeof nickname === 'string' ? nickname.trim() : '';
  if (chosen.length > 0) return truncateDisplayName(chosen);
  const fallback = typeof osUserName === 'string' ? osUserName.trim() : '';
  if (fallback.length > 0) return truncateDisplayName(fallback);
  return 'Concord';
}

/** 32 caractères, comme la validation du pseudo (`app.nickname.error.tooLong`). */
const MAX_DISPLAY_NAME_LENGTH = 32;

function truncateDisplayName(value: string): string {
  // `Array.from` : on coupe en points de code, jamais au milieu d'une paire de substitution.
  const points = Array.from(value);
  if (points.length <= MAX_DISPLAY_NAME_LENGTH) return value;
  return points.slice(0, MAX_DISPLAY_NAME_LENGTH).join('').trim();
}

// --- Résultats et erreurs --------------------------------------------------------------------

export type SettingsErrorCode =
  | 'not-an-object'
  | 'unknown-field'
  | 'forbidden-field'
  | 'missing-field'
  | 'type'
  | 'range'
  | 'enum'
  | 'format'
  | 'version-unsupported'
  | 'version-future'
  | 'legacy-unknown-field';

export interface SettingsError {
  /** Chemin pointé dans l'objet de réglages (`audio.inputGain`, `overlay.position.x`). */
  path: string;
  code: SettingsErrorCode;
  message: string;
}

export type SettingsResult =
  | { ok: true; value: Settings; migratedFrom: number | null }
  | { ok: false; errors: SettingsError[] };

type Dict = Record<string, unknown>;

interface Ctx {
  errors: SettingsError[];
}

function isPlainObject(value: unknown): value is Dict {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function fail(ctx: Ctx, path: string, code: SettingsErrorCode, message: string): void {
  ctx.errors.push({ path, code, message });
}

function checkUnknownKeys(
  ctx: Ctx,
  value: Dict,
  allowed: readonly string[],
  path: string,
  code: SettingsErrorCode = 'unknown-field',
): void {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue;
    fail(ctx, path ? `${path}.${key}` : key, code, `champ inconnu : ${path ? `${path}.` : ''}${key}`);
  }
}

function readString(
  ctx: Ctx,
  source: Dict,
  key: string,
  path: string,
  opts: { maxLength: number; allowEmpty?: boolean; trim?: boolean },
): string {
  const value = source[key];
  if (value === undefined) {
    fail(ctx, `${path}.${key}`, 'missing-field', `champ requis absent : ${path}.${key}`);
    return '';
  }
  if (typeof value !== 'string') {
    fail(ctx, `${path}.${key}`, 'type', `${path}.${key} doit être une chaîne`);
    return '';
  }
  const text = opts.trim === false ? value : value.trim();
  if (!opts.allowEmpty && text.length === 0) {
    fail(ctx, `${path}.${key}`, 'range', `${path}.${key} ne peut pas être vide`);
  }
  if (text.length > opts.maxLength) {
    fail(ctx, `${path}.${key}`, 'range', `${path}.${key} dépasse ${opts.maxLength} caractères`);
  }
  return text;
}

function readNullableString(
  ctx: Ctx,
  source: Dict,
  key: string,
  path: string,
  maxLength: number,
): string | null {
  const value = source[key];
  if (value === undefined) {
    fail(ctx, `${path}.${key}`, 'missing-field', `champ requis absent : ${path}.${key}`);
    return null;
  }
  if (value === null) return null;
  if (typeof value !== 'string') {
    fail(ctx, `${path}.${key}`, 'type', `${path}.${key} doit être une chaîne ou null`);
    return null;
  }
  if (value.length > maxLength) {
    fail(ctx, `${path}.${key}`, 'range', `${path}.${key} dépasse ${maxLength} caractères`);
  }
  return value;
}

function readBoolean(ctx: Ctx, source: Dict, key: string, path: string): boolean {
  const value = source[key];
  if (value === undefined) {
    fail(ctx, `${path}.${key}`, 'missing-field', `champ requis absent : ${path}.${key}`);
    return false;
  }
  if (typeof value !== 'boolean') {
    fail(ctx, `${path}.${key}`, 'type', `${path}.${key} doit être un booléen`);
    return false;
  }
  return value;
}

/**
 * Lit le booléen de ducking avec sa RÉTRO-COMPAT (2026-11-01) : absent du fichier (écrit avant
 * l'amendement, ou patch partiel `{...current.audio, ...patch}` sans la clé) ⇒ `true`. Le ducking
 * est un comportement par défaut voulu — un fichier ancien ne doit pas l'éteindre en silence ;
 * une valeur PRÉSENTE mais non booléenne est une erreur, jamais une réparation silencieuse
 * (même politique que `readAvatarOptional` pour `avatar`).
 */
function readBooleanWithDefault(
  ctx: Ctx,
  source: Dict,
  key: string,
  path: string,
  fallback: boolean,
): boolean {
  const value = source[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') {
    fail(ctx, `${path}.${key}`, 'type', `${path}.${key} doit être un booléen`);
    return fallback;
  }
  return value;
}

function readNumber(
  ctx: Ctx,
  source: Dict,
  key: string,
  path: string,
  opts: { min: number; max: number; integer?: boolean },
): number {
  const value = source[key];
  if (value === undefined) {
    fail(ctx, `${path}.${key}`, 'missing-field', `champ requis absent : ${path}.${key}`);
    return opts.min;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(ctx, `${path}.${key}`, 'type', `${path}.${key} doit être un nombre fini`);
    return opts.min;
  }
  if (opts.integer && !Number.isInteger(value)) {
    fail(ctx, `${path}.${key}`, 'type', `${path}.${key} doit être un entier`);
    return opts.min;
  }
  if (value < opts.min || value > opts.max) {
    fail(ctx, `${path}.${key}`, 'range', `${path}.${key} hors bornes [${opts.min}, ${opts.max}] : ${value}`);
  }
  return value;
}

function readEnum<T extends string>(
  ctx: Ctx,
  source: Dict,
  key: string,
  path: string,
  allowed: readonly T[],
): T {
  const value = source[key];
  if (value === undefined) {
    fail(ctx, `${path}.${key}`, 'missing-field', `champ requis absent : ${path}.${key}`);
    return allowed[0] as T;
  }
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail(ctx, `${path}.${key}`, 'enum', `${path}.${key} doit valoir ${allowed.join(' | ')}`);
    return allowed[0] as T;
  }
  return value as T;
}

// --- Raccourci push-to-talk ------------------------------------------------------------------

const MODIFIER_ALIASES: Readonly<Record<string, string>> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  altgr: 'AltGr',
  shift: 'Shift',
  super: 'Super',
  meta: 'Super',
  cmd: 'Super',
  command: 'Super',
  commandorcontrol: 'CommandOrControl',
  cmdorctrl: 'CommandOrControl',
};

const KEY_ALIASES: Readonly<Record<string, string>> = {
  space: 'Space',
  espace: 'Space',
  tab: 'Tab',
  enter: 'Enter',
  return: 'Enter',
  escape: 'Escape',
  esc: 'Escape',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  backspace: 'Backspace',
  delete: 'Delete',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  plus: 'Plus',
};

/**
 * Normalise un accélérateur Electron (`alt+space` → `Alt+Space`).
 * Lève une erreur si le raccourci est inutilisable : au moins un modificateur et une touche
 * finale non-modificatrice sont exigés (sinon `F5` ou `A` deviendraient des PTT accidentels).
 */
export function normalizeAccelerator(input: string): string {
  if (typeof input !== 'string') throw new TypeError('accélérateur : chaîne attendue');
  const tokens = input
    .split('+')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length < 2) throw new Error('accélérateur : au moins un modificateur et une touche');

  const modifiers: string[] = [];
  let key: string | null = null;
  for (const token of tokens) {
    const lower = token.toLowerCase();
    const modifier = MODIFIER_ALIASES[lower];
    if (modifier) {
      if (modifiers.includes(modifier)) throw new Error(`accélérateur : modificateur répété ${modifier}`);
      modifiers.push(modifier);
      continue;
    }
    if (key !== null) throw new Error('accélérateur : une seule touche finale est autorisée');
    key = KEY_ALIASES[lower] ?? (token.length === 1 ? token.toUpperCase() : `${token[0]?.toUpperCase() ?? ''}${token.slice(1)}`);
  }
  if (modifiers.length === 0) throw new Error('accélérateur : au moins un modificateur');
  if (key === null) throw new Error('accélérateur : touche finale manquante');
  return [...modifiers, key].join('+');
}

export function isValidAccelerator(input: string): boolean {
  try {
    normalizeAccelerator(input);
    return true;
  } catch {
    return false;
  }
}

/** Ports de signalisation essayables, dans l'ordre (SPEC-001 A9 : 47821 → 47830). */
export function signalingPortCandidates(): number[] {
  const ports: number[] = [];
  for (let port = SIGNALING_PORT_DEFAULT; port <= SIGNALING_PORT_MAX; port += 1) ports.push(port);
  return ports;
}

// --- Validation v1 ---------------------------------------------------------------------------

const TOP_KEYS = ['version', 'locale', 'theme', 'nickname', 'avatar', 'audio', 'talk', 'overlay', 'network'] as const;
const AUDIO_KEYS = [
  'inputDeviceId',
  'outputDeviceId',
  'noiseSuppression',
  'echoCancellation',
  'inputGain',
  'duckOthers',
] as const;
const TALK_KEYS = ['mode', 'pttAccelerator', 'vadThresholdDb'] as const;
const OVERLAY_KEYS = ['enabled', 'opacity', 'scale', 'screenId', 'position'] as const;
const NETWORK_KEYS = ['signalingPort', 'discovery'] as const;
const POSITION_KEYS = ['x', 'y'] as const;
const LOCALES: readonly Locale[] = ['fr', 'en'];
const THEMES: readonly Theme[] = ['dark', 'light', 'system'];
const TALK_MODES: readonly TalkMode[] = ['ptt', 'vad'];
const DISCOVERY_MODES: readonly DiscoveryMode[] = ['auto', 'mdns', 'broadcast'];
const OVERLAY_SCALES: readonly OverlayScale[] = ['sm', 'md', 'lg'];

function section(ctx: Ctx, source: Dict, key: string): Dict {
  const value = source[key];
  if (value === undefined) {
    fail(ctx, key, 'missing-field', `section requise absente : ${key}`);
    return {};
  }
  if (!isPlainObject(value)) {
    fail(ctx, key, 'type', `section ${key} doit être un objet`);
    return {};
  }
  return value;
}

/**
 * Lit le réglage `avatar` (SPEC-002, amendement 2026-10-31). Les trois formes acceptées :
 *  - `null` — pas d'avatar choisi, l'affichage retombera sur les initiales ;
 *  - une chaîne — un id de la galerie embarquée (`isGalleryAvatarId`), rien d'autre : un id
 *    inventé n'a pas de rendu, ce serait un trou noir visuel ;
 *  - un objet `{ kind: 'custom', file, ref }` — une image locale, dont le NOM et l'EMPREINTE
 *    doivent être valides ET coïncider (`<ref>.png`). Un nom qui ment est refusé, pas corrigé :
 *    le fichier servi serait celui d'un autre avatar.
 * Une valeur ABSENTE est de la rétro-compat (les fichiers écrits avant l'amendement n'ont pas la
 * clé) et devient `null` = initiales ; une valeur PRÉSENTE mais hors forme est une erreur, jamais
 * une réparation silencieuse.
 */
function readAvatar(ctx: Ctx, source: Dict, key: string, path: string): AvatarSetting {
  const value = source[key];
  const at = path.length > 0 ? `${path}.${key}` : key;
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    if (!isGalleryAvatarId(value)) {
      fail(ctx, at, 'enum', `${at} doit être un id de la galerie embarquée, un objet custom, ou null`);
      return null;
    }
    return value;
  }
  if (!isCustomAvatarShape(value)) {
    fail(ctx, at, 'type', `${at} doit être une chaîne, un objet {kind:'custom',file,ref}, ou null`);
    return null;
  }
  const custom: CustomAvatar = value;
  if (!isAvatarFileName(custom.file)) {
    fail(ctx, `${at}.file`, 'format', `${at}.file doit être 16 hexadécimaux suivis de « .png »`);
    return null;
  }
  if (!isAvatarRef(custom.ref)) {
    fail(ctx, `${at}.ref`, 'format', `${at}.ref doit être 16 hexadécimaux minuscules`);
    return null;
  }
  if (custom.file !== `${custom.ref}.png`) {
    fail(ctx, `${at}.file`, 'format', `${at}.file doit être l'empreinte suivie de « .png » (nom ≠ empreinte)`);
    return null;
  }
  return custom;
}

/**
 * Lit le réglage `avatar` (SPEC-002, amendement 2026-10-31). Les trois formes admises :
 * `null` (rien de choisi → initiales), un id de galerie embarquée, ou `{kind:'custom',
 * file:'<ref>.png'}`. Une valeur ABSENTE devient `null` (rétro-compat : les fichiers écrits avant
 * l'amendement n'ont pas la clé, et le patch partiel `{...current.value, ...patch}` doit pouvoir
 * écrire un objet sans la clé) ; une valeur hors forme est une erreur, jamais une réparation
 * silencieuse — l'avatar est choisi par la personne, pas déviné.
 */
function readAvatarOptional(ctx: Ctx, source: Dict, key: string, path: string): AvatarSetting {
  const value = source[key];
  const at = path.length === 0 ? key : `${path}.${key}`;
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    if (!isGalleryAvatarId(value)) {
      fail(ctx, at, 'range', `${at} doit être un identifiant d'avatar de la galerie embarquée`);
      return null;
    }
    return value;
  }
  if (isCustomAvatarShape(value)) {
    // La paire (file, ref) est vérifiée ensemble : un fichier dont le nom ne correspond pas à
    // son contenu est une incohérence, pas une variante.
    if (!isAvatarFileName(value.file) || !isAvatarRef(value.ref) || value.file !== `${value.ref}.png`) {
      fail(ctx, at, 'range', `${at} doit décrire un avatar local : {kind:'custom', file:'<empreinte>.png'}`);
      return null;
    }
    return { kind: 'custom', file: value.file, ref: value.ref };
  }
  fail(ctx, at, 'type', `${at} doit être null, un identifiant de galerie ou un avatar local`);
  return null;
}

function readPosition(ctx: Ctx, source: Dict, key: string, path: string): Point | null {
  const value = source[key];
  if (value === undefined) {
    fail(ctx, `${path}.${key}`, 'missing-field', `champ requis absent : ${path}.${key}`);
    return null;
  }
  if (value === null) return null;
  if (!isPlainObject(value)) {
    fail(ctx, `${path}.${key}`, 'type', `${path}.${key} doit être un objet {x, y} ou null`);
    return null;
  }
  checkUnknownKeys(ctx, value, POSITION_KEYS, `${path}.${key}`);
  return {
    x: readNumber(ctx, value, 'x', `${path}.${key}`, { min: -100000, max: 100000 }),
    y: readNumber(ctx, value, 'y', `${path}.${key}`, { min: -100000, max: 100000 }),
  };
}

function validateV1(source: Dict): SettingsResult {
  const ctx: Ctx = { errors: [] };
  checkUnknownKeys(ctx, source, TOP_KEYS, '');

  const version = readNumber(ctx, source, 'version', '', { min: 0, max: 1000, integer: true });
  const locale = readEnum(ctx, source, 'locale', '', LOCALES);
  const theme = readEnum(ctx, source, 'theme', '', THEMES);
  const nickname = readString(ctx, source, 'nickname', '', { maxLength: 32, allowEmpty: true });
  const avatar = readAvatar(ctx, source, 'avatar', '');

  const audioSource = section(ctx, source, 'audio');
  checkUnknownKeys(ctx, audioSource, AUDIO_KEYS, 'audio');
  const audio: AudioSettings = {
    inputDeviceId: readNullableString(ctx, audioSource, 'inputDeviceId', 'audio', 128),
    outputDeviceId: readNullableString(ctx, audioSource, 'outputDeviceId', 'audio', 128),
    noiseSuppression: readBoolean(ctx, audioSource, 'noiseSuppression', 'audio'),
    echoCancellation: readBoolean(ctx, audioSource, 'echoCancellation', 'audio'),
    inputGain: readNumber(ctx, audioSource, 'inputGain', 'audio', { min: 0, max: 2 }),
    // Rétro-compat assumée : absent ⇒ ON (le ducking est le comportement par défaut voulu).
    duckOthers: readBooleanWithDefault(ctx, audioSource, 'duckOthers', 'audio', true),
  };

  const talkSource = section(ctx, source, 'talk');
  checkUnknownKeys(ctx, talkSource, TALK_KEYS, 'talk');
  const acceleratorRaw = readString(ctx, talkSource, 'pttAccelerator', 'talk', { maxLength: 64 });
  let pttAccelerator = acceleratorRaw;
  if (acceleratorRaw.length > 0) {
    try {
      pttAccelerator = normalizeAccelerator(acceleratorRaw);
    } catch (error) {
      fail(
        ctx,
        'talk.pttAccelerator',
        'format',
        `raccourci push-to-talk invalide : ${(error as Error).message}`,
      );
    }
  }
  const talk: TalkSettings = {
    mode: readEnum(ctx, talkSource, 'mode', 'talk', TALK_MODES),
    pttAccelerator,
    vadThresholdDb: readNumber(ctx, talkSource, 'vadThresholdDb', 'talk', { min: -80, max: -10 }),
  };

  const overlaySource = section(ctx, source, 'overlay');
  checkUnknownKeys(ctx, overlaySource, OVERLAY_KEYS, 'overlay');
  const overlay: OverlaySettings = {
    enabled: readBoolean(ctx, overlaySource, 'enabled', 'overlay'),
    opacity: readNumber(ctx, overlaySource, 'opacity', 'overlay', {
      min: OVERLAY_OPACITY_MIN,
      max: OVERLAY_OPACITY_MAX,
    }),
    scale: readEnum(ctx, overlaySource, 'scale', 'overlay', OVERLAY_SCALES),
    screenId: readNullableString(ctx, overlaySource, 'screenId', 'overlay', 64),
    position: readPosition(ctx, overlaySource, 'position', 'overlay'),
  };

  const networkSource = section(ctx, source, 'network');
  checkUnknownKeys(ctx, networkSource, NETWORK_KEYS, 'network');
  const network: NetworkSettings = {
    signalingPort: readNumber(ctx, networkSource, 'signalingPort', 'network', {
      min: SIGNALING_PORT_DEFAULT,
      max: SIGNALING_PORT_MAX,
      integer: true,
    }),
    discovery: readEnum(ctx, networkSource, 'discovery', 'network', DISCOVERY_MODES),
  };

  if (ctx.errors.length > 0) return { ok: false, errors: ctx.errors };
  return {
    ok: true,
    migratedFrom: null,
    value: { version, locale, theme, nickname, avatar, audio, talk, overlay, network },
  };
}

// --- Migration v0 → v1 -----------------------------------------------------------------------

/** Clés plates écrites par le prototype (v0). */
const LEGACY_KEYS = [
  'mic',
  'speaker',
  'shortcut',
  'vadDb',
  'vadMode',
  'overlayOn',
  'scale',
  'opacity',
  'gain',
  'nickname',
  'locale',
  'theme',
  // champ retiré en v1 : accepté pour ne pas bloquer une machine de dev, puis abandonné.
  'muteOnStart',
] as const;

function migrateLegacy(source: Dict): SettingsResult {
  const ctx: Ctx = { errors: [] };
  checkUnknownKeys(ctx, source, LEGACY_KEYS, '', 'legacy-unknown-field');

  const base = defaultSettings();
  const nickname = readString(ctx, source, 'nickname', '', { maxLength: 32, allowEmpty: true });
  const locale = readEnum(ctx, source, 'locale', '', LOCALES);
  const theme = readEnum(ctx, source, 'theme', '', THEMES);

  const mic = readNullableString(ctx, source, 'mic', '', 128);
  const speaker = readNullableString(ctx, source, 'speaker', '', 128);
  const gain = readNumber(ctx, source, 'gain', '', { min: 0, max: 2 });
  const vadDb = readNumber(ctx, source, 'vadDb', '', { min: -80, max: -10 });
  const vadMode = readEnum(ctx, source, 'vadMode', '', TALK_MODES);
  const shortcutRaw = readString(ctx, source, 'shortcut', '', { maxLength: 64 });
  let shortcut = base.talk.pttAccelerator;
  try {
    shortcut = normalizeAccelerator(shortcutRaw);
  } catch (error) {
    fail(ctx, 'shortcut', 'format', `raccourci push-to-talk invalide : ${(error as Error).message}`);
  }
  const overlayOn = readBoolean(ctx, source, 'overlayOn', '');
  const scale = readEnum(ctx, source, 'scale', '', OVERLAY_SCALES);
  const opacity = readNumber(ctx, source, 'opacity', '', {
    min: OVERLAY_OPACITY_MIN,
    max: OVERLAY_OPACITY_MAX,
  });

  if (ctx.errors.length > 0) return { ok: false, errors: ctx.errors };

  return {
    ok: true,
    migratedFrom: LEGACY_SETTINGS_VERSION,
    value: {
      ...base,
      version: SETTINGS_VERSION,
      locale,
      theme,
      nickname,
      audio: { ...base.audio, inputDeviceId: mic, outputDeviceId: speaker, inputGain: gain },
      talk: { ...base.talk, mode: vadMode, pttAccelerator: shortcut, vadThresholdDb: vadDb },
      overlay: { ...base.overlay, enabled: overlayOn, scale, opacity },
    },
  };
}

// --- API publique ----------------------------------------------------------------------------

/**
 * Lit des réglages depuis une source non fiable (fichier disque, IPC), migre si nécessaire et
 * valide strictement. Retourne `migratedFrom` quand une migration a eu lieu.
 */
export function parseSettings(input: unknown): SettingsResult {
  if (!isPlainObject(input)) {
    return { ok: false, errors: [{ path: '', code: 'not-an-object', message: 'objet de réglages attendu' }] };
  }
  const rawVersion = input['version'];
  if (rawVersion === undefined) return migrateLegacy(input);
  if (typeof rawVersion !== 'number' || !Number.isInteger(rawVersion) || rawVersion < 0) {
    return {
      ok: false,
      errors: [{ path: 'version', code: 'version-unsupported', message: 'version de schéma illisible' }],
    };
  }
  if (rawVersion > SETTINGS_VERSION) {
    return {
      ok: false,
      errors: [
        {
          path: 'version',
          code: 'version-future',
          message: `réglages écrits par une version plus récente (${rawVersion} > ${SETTINGS_VERSION}) : refusés`,
        },
      ],
    };
  }
  if (rawVersion === LEGACY_SETTINGS_VERSION) {
    // v0 explicite : on retire la clé avant de migrer les clés plates.
    const { version: _discarded, ...rest } = input;
    return migrateLegacy(rest);
  }
  return validateV1(input);
}

const PATCHABLE_TOP_KEYS = ['locale', 'theme', 'nickname', 'avatar', 'audio', 'talk', 'overlay', 'network'] as const;

/**
 * Applique une modification partielle (`setSettings` côté IPC), puis revalide l'objet complet.
 * `version` n'est pas modifiable par patch : elle appartient au magasin, pas à l'UI.
 */
export function applySettingsPatch(current: Settings, patch: unknown): SettingsResult {
  if (!isPlainObject(patch)) {
    return {
      ok: false,
      errors: [{ path: '', code: 'not-an-object', message: 'objet de modification attendu' }],
    };
  }
  const ctx: Ctx = { errors: [] };
  // `version` est listée ici pour n'être signalée qu'une fois, avec le code exact
  // `forbidden-field` (elle est connue, mais non modifiable par l'UI).
  checkUnknownKeys(ctx, patch, [...PATCHABLE_TOP_KEYS, 'version'], '');
  if ('version' in patch) {
    fail(ctx, 'version', 'forbidden-field', 'version non modifiable par patch');
  }

  const merged = JSON.parse(JSON.stringify(current)) as Dict;
  for (const key of PATCHABLE_TOP_KEYS) {
    if (!(key in patch)) continue;
    const incoming = patch[key];
    if (key === 'audio' || key === 'talk' || key === 'overlay' || key === 'network') {
      if (!isPlainObject(incoming)) {
        fail(ctx, key, 'type', `section ${key} doit être un objet`);
        continue;
      }
      const existing = isPlainObject(merged[key]) ? (merged[key] as Dict) : {};
      merged[key] = { ...existing, ...incoming };
    } else {
      merged[key] = incoming;
    }
  }
  if (ctx.errors.length > 0) return { ok: false, errors: ctx.errors };
  return parseSettings(merged);
}

/**
 * Vrai si deux réglages diffèrent par le raccourci push-to-talk.
 *
 * Le raccourci n'est pas un réglage mou : il est réservé auprès du SYSTÈME (`globalShortcut`). Écrire
 * la nouvelle valeur dans les réglages ne suffit donc pas — l'ancien accélérateur restait réservé et
 * le nouveau ne répondait pas jusqu'au redémarrage. Cette fonction dit quand il faut réellement
 * ré-enregistrer, et laisse tous les autres réglages (overlay, audio, seuil de bruit…) tranquilles.
 */
export function pushToTalkAcceleratorChanged(previous: Settings, next: Settings): boolean {
  return previous.talk.pttAccelerator !== next.talk.pttAccelerator;
}

/** Sérialise des réglages validés (utile pour l'écriture disque, tests de round-trip). */
export function serializeSettings(settings: Settings): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}
