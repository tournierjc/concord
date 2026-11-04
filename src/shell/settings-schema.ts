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
import { OVERLAY_PLACEMENTS, type OverlayPlacement } from './overlay-geometry.ts';

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
export type { OverlayPlacement };

export interface Point {
  x: number;
  y: number;
}

export interface AudioSettings {
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  /** Suppression de bruit (RNNoise côté Chromium) — false par défaut : calibrée sur le
   * silence pendant le push-to-talk, elle tue la détection de voix à la réactivation. */
  noiseSuppression: boolean;
  /** Annulation d'écho — true par défaut. La demande part en `{ ideal }` ; `getSettings()` est journalisé. */
  echoCancellation: boolean;
  /**
   * Porte de bruit dans le graphe, AVANT le filtre vocal (2026-11-04). `true` par défaut.
   * Absente d'un fichier antérieur ⇒ `true` : le fond sous `talk.vadThresholdDb` ne part pas.
   * Distinct de `noiseSuppression` (RNNoise du navigateur, sur la capture).
   */
  noiseGate: boolean;
  /** Gain d'entrée, 0..2 (1 = neutre). */
  inputGain: number;
  /**
   * Filtre vocal (2026-11-03, demande JC) : une voix appliquée au MICRO LOCAL avant l'envoi
   * aux pairs (robot, talkie, timbres homme/femme/enfant…). `'none'` par défaut : la voix
   * historique, aucun nœud dans le graphe (non-régression mesurée par test). Les valeurs sont
   * le vocabulaire de `VOICE_FILTER_IDS` (`engine/rtc/voice-filters.ts`) — le schéma les
   * énumère ici SANS importer le moteur (le shell est un contrat, pas un consommateur).
   * Absent d'un fichier écrit avant ce changement ⇒ `'none'` (rétro-compat, même patron que
   * `duckOthers`).
   */
  voiceFilter: 'none' | 'robot' | 'radio' | 'deep' | 'man' | 'woman' | 'child';
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
  /** Coin (rangée) ou côté (colonne). Défaut `top-right`. */
  placement: OverlayPlacement;
  /**
   * Afficher l'overlay quand le plein écran ne peut pas être détecté (Wayland natif).
   * `false` par défaut : sans détection, l'overlay reste caché.
   */
  showWithoutDetection: boolean;
}

export interface NetworkSettings {
  signalingPort: number;
  discovery: DiscoveryMode;
}

/**
 * Mises à jour (avenant SPEC-006b, 2026-11-01).
 *
 * `auto` : la dérogation « hors LAN » est-elle ACTIVE ? `false` ⇒ plus AUCUN cycle automatique
 * (retour CA20 intégral) ; la demande manuelle (bouton « Vérifier maintenant ») reste autorisée —
 * c'est une commande explicite, pas une initiative de l'app. `true` par défaut : JC veut
 * l'automatique par défaut, et un fichier écrit avant ce changement ne doit rien éteindre en
 * silence (même rétro-compat que `duckOthers`).
 *
 * `checkedAt` et `lastSeenVersion` sont des MESURES du service (jamais saisies par l'UI) : la
 * date de la dernière vérification et la dernière version vue. Les deux sont optionnels à la
 * LECTURE (absents d'un fichier ancien) et ne portent aucune promesse d'affichage sans mesure.
 */
export interface UpdateSettings {
  auto: boolean;
  checkedAt: number | null;
  lastSeenVersion: string | null;
}

/** Un patch du groupe `update` : l'interrupteur seul. Les MESURES du service ne se patchent pas. */
export type UpdateSettingsPatch = { auto: boolean };

/**
 * Salon automatique à la reprise (2026-11-02, « recréer mon salon au démarrage »).
 *
 * `auto` : à l'ÉTEINT, aucun recréage n'est armé au démarrage et AUCUNE mesure n'est écrite — la
 * lecture des réglages ne compte pas comme action (même profil que `update.auto`). `true` par
 * défaut : JC veut l'automatique, et un fichier écrit avant ce changement ne doit rien éteindre en
 * silence (même rétro-compat que `duckOthers`).
 *
 * `lastHosted` est une MESURE du main : la dernière session où CETTE machine a réellement hébergé
 * un salon (nom, capacité), ou `null` quand l'utilisateur a quitté son salon VOLONTAIREMENT
 * (quitter = intention de ne pas reprendre ; éjection ou coupure = la mesure reste en place).
 * Une reprise de session ne recrée donc jamais un salon que la personne a fermé elle-même. Les
 * capacités sont une CONSTANTe du maillage (`MAX_ROOM_PARTICIPANTS`), pas un réglage : seul le nom
 * est mesuré. Jamais un port (il est mesuré au bind), jamais un avatar (réglage du profil), jamais
 * un identifiant secret.
 */
export interface RoomSettings {
  auto: boolean;
  lastHosted: RoomLastHosted | null;
}

/** La forme persistée du dernier salon hébergé : le nom affiché + la capacité promise au `join`. */
export interface RoomLastHosted {
  /** Nom du salon tel qu'il s'affiche (rogné, non vide, ≤ 32 caractères). */
  name: string;
  /** Capacité promise (le plafond du maillage, 8) — recopiée telle quelle au `join` automatique. */
  capacity: number;
}

/**
 * Un patch du groupe `room` : l'interrupteur seul. `lastHosted` est une MESURE du main (écrite à
 * l'hébergement, effacée au départ volontaire), jamais saisie par l'UI — même patron que
 * `update.checkedAt` (2026-11-01).
 */
export type RoomSettingsPatch = { auto: boolean };

/**
 * Un patch partiel des réglages : même forme que `Partial<Settings>`, sauf le groupe `update`
 * (l'UI n'écrit que l'interrupteur `auto`, jamais les mesures du service) et le groupe `room`
 * (l'UI n'écrit que l'interrupteur `auto`, jamais `lastHosted`).
 */
export type SettingsPatch = Partial<Omit<Settings, 'update' | 'room'>> & {
  update?: UpdateSettingsPatch;
  room?: RoomSettingsPatch;
};

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
  /** Mises à jour (avenant SPEC-006b, 2026-11-01) — la dérogation et ses mesures, voir `UpdateSettings`. */
  update: UpdateSettings;
  /** Salon automatique à la reprise (2026-11-02) — l'interrupteur et la mesure, voir `RoomSettings`. */
  room: RoomSettings;
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
      noiseGate: true,
      inputGain: 1,
      // Voix historique : AUCUN filtre, AUCUN nœud dans le graphe micro (non-régression).
      voiceFilter: 'none',
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
      placement: 'top-right',
      showWithoutDetection: false,
    },
    network: {
      signalingPort: SIGNALING_PORT_DEFAULT,
      discovery: 'auto',
    },
    update: {
      // La dérogation est ACTIVE par défaut (JC veut l'automatique) ; les mesures sont vides
      // tant qu'aucun cycle n'a eu lieu — rien n'est affirmé sans mesure (SPEC-002 D1).
      auto: true,
      checkedAt: null,
      lastSeenVersion: null,
    },
    room: {
      // Même profil que `update.auto` : l'automatique est voulu par défaut, et aucune reprise
      // n'est promise tant qu'aucun salon n'a été réellement hébergé (`lastHosted: null`).
      auto: true,
      lastHosted: null,
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

/**
 * Comme `readEnum`, mais ABSENT est licite et vaut le repli (rétro-compat des fichiers écrits
 * avant l'arrivée du champ — même patron que `readBooleanWithDefault` pour `duckOthers`).
 * Une valeur PRÉSENTE et hors vocabulaire reste une faute (jamais un silencieux repli).
 */
function readEnumWithDefault<T extends string>(
  ctx: Ctx,
  source: Dict,
  key: string,
  path: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = source[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail(ctx, `${path}.${key}`, 'enum', `${path}.${key} doit valoir ${allowed.join(' | ')}`);
    return fallback;
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

const TOP_KEYS = ['version', 'locale', 'theme', 'nickname', 'avatar', 'audio', 'talk', 'overlay', 'network', 'update', 'room'] as const;
const AUDIO_KEYS = [
  'inputDeviceId',
  'outputDeviceId',
  'noiseSuppression',
  'echoCancellation',
  'noiseGate',
  'inputGain',
  'voiceFilter',
  'duckOthers',
] as const;
/**
 * Le vocabulaire des filtres vocaux (2026-11-03). Copie ASSUMÉE de `VOICE_FILTER_IDS`
 * (`engine/rtc/voice-filters.ts`) : le shell est un contrat sérialisé, il n'importe pas le
 * moteur. `tests/contract-parity.node.test.ts` est le garde-fou qui casse si les deux listes
 * dérivent — la duplication est surveillée, pas silencieuse.
 */
const VOICE_FILTER_VALUES = ['none', 'robot', 'radio', 'deep', 'man', 'woman', 'child'] as const;
const TALK_KEYS = ['mode', 'pttAccelerator', 'vadThresholdDb'] as const;
const OVERLAY_KEYS = ['enabled', 'opacity', 'scale', 'screenId', 'position', 'placement', 'showWithoutDetection'] as const;
const NETWORK_KEYS = ['signalingPort', 'discovery'] as const;
const UPDATE_KEYS = ['auto', 'checkedAt', 'lastSeenVersion'] as const;
/** Les cles de mesure du service : le renderer n'a aucun droit d'ecriture dessus (2026-11-01). */
const UPDATE_MEASURE_KEYS: readonly string[] = ['checkedAt', 'lastSeenVersion'];
const ROOM_KEYS = ['auto', 'lastHosted'] as const;
/** La mesure du main (dernier salon hébergé) : le renderer n'a aucun droit d'écriture dessus (2026-11-02). */
const ROOM_MEASURE_KEYS: readonly string[] = ['lastHosted'];
const LAST_HOSTED_KEYS = ['name', 'capacity'] as const;
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

/**
 * Lit le groupe `update` (avenant SPEC-006b, 2026-11-01) avec sa RÉTRO-COMPAT : le groupe ENTIER
 * peut être absent d'un fichier écrit avant l'amendement ⇒ défauts (`auto: true`, mesures vides) ;
 * un groupe PRÉSENT doit être un objet, et `auto` PRÉSENT doit être un booléen — une valeur hors
 * forme est une erreur, jamais une réparation silencieuse. `checkedAt` (millisecondes epoch) et
 * `lastSeenVersion` (`X.Y.Z` ou `null`) sont des mesures du service : absentes ⇒ `null`, jamais un
 * zéro ou une version inventée.
 */
function readUpdateSection(ctx: Ctx, source: Dict): UpdateSettings {
  const value = source['update'];
  if (value === undefined) return defaultSettings().update;
  if (!isPlainObject(value)) {
    fail(ctx, 'update', 'type', 'section update doit être un objet');
    return defaultSettings().update;
  }
  checkUnknownKeys(ctx, value, UPDATE_KEYS, 'update');
  const auto = readBooleanWithDefault(ctx, value, 'auto', 'update', true);
  const rawCheckedAt = value['checkedAt'];
  let checkedAt: number | null = null;
  if (rawCheckedAt !== undefined && rawCheckedAt !== null) {
    if (typeof rawCheckedAt !== 'number' || !Number.isFinite(rawCheckedAt) || rawCheckedAt < 0) {
      fail(ctx, 'update.checkedAt', 'type', 'update.checkedAt doit être un nombre (millisecondes epoch) ou null');
    } else {
      checkedAt = rawCheckedAt;
    }
  }
  const rawLastSeen = value['lastSeenVersion'];
  let lastSeenVersion: string | null = null;
  if (rawLastSeen !== undefined && rawLastSeen !== null) {
    if (typeof rawLastSeen !== 'string' || !/^\d+\.\d+\.\d+$/.test(rawLastSeen)) {
      fail(ctx, 'update.lastSeenVersion', 'format', 'update.lastSeenVersion doit être « X.Y.Z » ou null');
    } else {
      lastSeenVersion = rawLastSeen;
    }
  }
  return { auto, checkedAt, lastSeenVersion };
}

/**
 * Lit le groupe `room` (2026-11-02, recréation automatique du salon) avec sa RÉTRO-COMPAT : le
 * groupe ENTIER peut être absent d'un fichier écrit avant ce changement ⇒ défauts (`auto: true`,
 * `lastHosted: null`) ; un groupe PRÉSENT doit être un objet, `auto` PRÉSENT doit être un booléen,
 * et `lastHosted` PRÉSENT doit être `{ name, capacity }` sous les bornes du maillage — une valeur
 * hors forme est une erreur, jamais une réparation silencieuse (même politique que
 * `readUpdateSection`). `name` est rogné et borné à 32 caractères (même borne que le nom de salon
 * du contrat) ; `capacity` est l'entier du plafond du maillage, rien d'autre.
 */
function readRoomSection(ctx: Ctx, source: Dict): RoomSettings {
  const value = source['room'];
  if (value === undefined) return defaultSettings().room;
  if (!isPlainObject(value)) {
    fail(ctx, 'room', 'type', 'section room doit être un objet');
    return defaultSettings().room;
  }
  checkUnknownKeys(ctx, value, ROOM_KEYS, 'room');
  const auto = readBooleanWithDefault(ctx, value, 'auto', 'room', true);
  const rawLastHosted = value['lastHosted'];
  let lastHosted: RoomLastHosted | null = null;
  if (rawLastHosted !== undefined && rawLastHosted !== null) {
    if (!isPlainObject(rawLastHosted)) {
      fail(ctx, 'room.lastHosted', 'type', 'room.lastHosted doit être un objet {name, capacity} ou null');
    } else {
      checkUnknownKeys(ctx, rawLastHosted, LAST_HOSTED_KEYS, 'room.lastHosted');
      const name = readString(ctx, rawLastHosted, 'name', 'room.lastHosted', { maxLength: 32 });
      // La capacité n'est pas un réglage libre : c'est la constante du maillage, recopiée au `join`.
      const capacity = readNumber(ctx, rawLastHosted, 'capacity', 'room.lastHosted', {
        min: MAX_ROOM_PARTICIPANTS,
        max: MAX_ROOM_PARTICIPANTS,
        integer: true,
      });
      if (name.length > 0) lastHosted = { name, capacity };
    }
  }
  return { auto, lastHosted };
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
    // Rétro-compat : absent ⇒ porte active (le fond ne part pas avec la voix).
    noiseGate: readBooleanWithDefault(ctx, audioSource, 'noiseGate', 'audio', true),
    inputGain: readNumber(ctx, audioSource, 'inputGain', 'audio', { min: 0, max: 2 }),
    // Rétro-compat assumée : absent ⇒ 'none' (la voix historique, avant 2026-11-03).
    voiceFilter: readEnumWithDefault(ctx, audioSource, 'voiceFilter', 'audio', VOICE_FILTER_VALUES, 'none'),
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
    placement: readEnum(ctx, overlaySource, 'placement', 'overlay', OVERLAY_PLACEMENTS),
    showWithoutDetection: readBoolean(ctx, overlaySource, 'showWithoutDetection', 'overlay'),
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

  // Le groupe `update` est OPTIONNEL à la lecture (rétro-compat 2026-11-01) : absent ⇒ défauts
  // (`auto: true`). `section()` n'est pas utilisé ici — l'absence EST une valeur, pas une erreur.
  const update = readUpdateSection(ctx, source);

  // Même rétro-compat pour `room` (2026-11-02) : absent ⇒ (`auto: true`, `lastHosted: null`).
  const room = readRoomSection(ctx, source);

  if (ctx.errors.length > 0) return { ok: false, errors: ctx.errors };
  return {
    ok: true,
    migratedFrom: null,
    value: { version, locale, theme, nickname, avatar, audio, talk, overlay, network, update, room },
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

const PATCHABLE_TOP_KEYS = ['locale', 'theme', 'nickname', 'avatar', 'audio', 'talk', 'overlay', 'network', 'update', 'room'] as const;

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
    if (key === 'audio' || key === 'talk' || key === 'overlay' || key === 'network' || key === 'update' || key === 'room') {
      if (!isPlainObject(incoming)) {
        fail(ctx, key, 'type', `section ${key} doit être un objet`);
        continue;
      }
      const existing = isPlainObject(merged[key]) ? (merged[key] as Dict) : {};
      // Mises à jour (2026-11-01) : `update.checkedAt` et `update.lastSeenVersion` sont des MESURES
      // du service (le main les écrit après chaque cycle), pas des réglages saisis. Un patch du
      // renderer qui les porte est refusé — la date de dernière vérification ne se décrète pas.
      if (key === 'update') {
        // `undefined` = la cle est ABSENTE du patch (le droit du patch partiel : « ne pas y
        // toucher ») ; `null` est une ECRIRE (effacer une mesure) et reste refuse.
        for (const measure of UPDATE_MEASURE_KEYS) {
          if (measure in incoming && incoming[measure] !== undefined) {
            fail(ctx, `${key}.${measure}`, 'forbidden-field', `${key}.${measure} est une mesure du service, non modifiable par patch`);
          }
        }
      }
      // Salon automatique (2026-11-02) : `room.lastHosted` est une MESURE du main (écrite quand ce
      // poste héberge un salon, effacée quand l'utilisateur le quitte volontairement). Le renderer
      // n'a pas le droit de décréter qu'un salon l'attend, ni d'effacer la reprise — même patron
      // exact que les mesures de `update` ci-dessus.
      if (key === 'room') {
        for (const measure of ROOM_MEASURE_KEYS) {
          if (measure in incoming && incoming[measure] !== undefined) {
            fail(ctx, `${key}.${measure}`, 'forbidden-field', `${key}.${measure} est une mesure du main, non modifiable par patch`);
          }
        }
      }
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

/**
 * Lecture TOLÉRANTE d'un fichier de réglages (0.4.21).
 *
 * Un champ inconnu (écrit par une version plus récente, par exemple `audio.voiceFilter`
 * lu par un binaire qui ne le connaît pas encore) est CONSERVÉ et ressort à l'écriture.
 * Un champ invalide retombe sur SON défaut, les autres restent. Une version de schéma
 * plus grande que la nôtre n'est pas refusée : on la réécrit telle quelle, avec les
 * champs inconnus. Seul un document qui n'est pas un objet est illisible — et dans ce
 * cas l'appelant ne doit PAS remplacer le fichier par les défauts.
 */
export interface InterpretedSettings {
  readonly ok: true;
  readonly value: Settings;
  /** Clés inconnues, imbriquées comme dans le fichier, à fusionner à l'écriture. */
  readonly extras: Dict;
  /** Version à réécrire. Supérieure à `SETTINGS_VERSION` si le fichier vient d'un binaire plus récent. */
  readonly persistVersion: number;
  readonly repaired: SettingsError[];
  readonly migratedFrom: number | null;
}

export type InterpretResult = InterpretedSettings | { ok: false; errors: SettingsError[] };

function peelUnknown(source: Dict, allowed: readonly string[]): { known: Dict; extra: Dict } {
  const known: Dict = {};
  const extra: Dict = {};
  for (const [key, value] of Object.entries(source)) {
    if (allowed.includes(key)) known[key] = value;
    else extra[key] = value;
  }
  return { known, extra };
}

function noteRepair(repaired: SettingsError[], path: string, code: SettingsErrorCode, message: string): void {
  repaired.push({ path, code, message });
}

function takeBoolean(value: unknown, fallback: boolean, path: string, repaired: SettingsError[]): boolean {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  noteRepair(repaired, path, 'type', `${path} invalide, défaut rétabli`);
  return fallback;
}

function takeString(value: unknown, fallback: string, path: string, repaired: SettingsError[], maxLength: number, allowEmpty: boolean): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') {
    noteRepair(repaired, path, 'type', `${path} invalide, défaut rétabli`);
    return fallback;
  }
  const text = value.trim();
  if ((!allowEmpty && text.length === 0) || text.length > maxLength) {
    noteRepair(repaired, path, 'range', `${path} hors borne, défaut rétabli`);
    return fallback;
  }
  return text;
}

function takeNullableString(value: unknown, fallback: string | null, path: string, repaired: SettingsError[], maxLength: number): string | null {
  if (value === undefined) return fallback;
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > maxLength) {
    noteRepair(repaired, path, 'type', `${path} invalide, défaut rétabli`);
    return fallback;
  }
  return value;
}

function takeNumber(value: unknown, fallback: number, path: string, repaired: SettingsError[], min: number, max: number, integer: boolean): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < min || value > max) {
    noteRepair(repaired, path, 'range', `${path} invalide, défaut rétabli`);
    return fallback;
  }
  return value;
}

function takeEnum<T extends string>(value: unknown, fallback: T, path: string, repaired: SettingsError[], allowed: readonly T[]): T {
  if (value === undefined) return fallback;
  if (typeof value === 'string' && allowed.includes(value as T)) return value as T;
  noteRepair(repaired, path, 'enum', `${path} invalide, défaut rétabli`);
  return fallback;
}

function takeAvatar(value: unknown, fallback: AvatarSetting, path: string, repaired: SettingsError[]): AvatarSetting {
  if (value === undefined) return fallback;
  if (value === null) return null;
  if (typeof value === 'string') {
    if (isGalleryAvatarId(value)) return value;
    noteRepair(repaired, path, 'range', `${path} invalide, défaut rétabli`);
    return fallback;
  }
  if (isCustomAvatarShape(value) && isAvatarFileName(value.file) && isAvatarRef(value.ref) && value.file === `${value.ref}.png`) {
    return { kind: 'custom', file: value.file, ref: value.ref };
  }
  noteRepair(repaired, path, 'type', `${path} invalide, défaut rétabli`);
  return fallback;
}

/** Fusionne les clés inconnues dans un objet déjà sérialisé. Les clés connues gagnent. */
export function mergeSettingsExtras(settings: Settings, extras: Dict, persistVersion: number): Dict {
  const base = JSON.parse(serializeSettings(settings)) as Dict;
  const merged = mergeUnknown(base, extras);
  if (persistVersion !== settings.version) merged['version'] = persistVersion;
  return merged;
}

function mergeUnknown(base: Dict, extras: Dict): Dict {
  const out: Dict = { ...base };
  for (const [key, value] of Object.entries(extras)) {
    const current = out[key];
    if (isPlainObject(current) && isPlainObject(value)) out[key] = mergeUnknown(current, value);
    else if (!(key in base)) out[key] = value;
  }
  return out;
}

function interpretCurrent(source: Dict, defaults: Settings, repaired: SettingsError[]): { value: Settings; extras: Dict } {
  const { known, extra } = peelUnknown(source, TOP_KEYS);
  const audioIn = isPlainObject(known['audio']) ? known['audio'] : {};
  const audioExtra = isPlainObject(known['audio']) ? peelUnknown(audioIn, AUDIO_KEYS).extra : {};
  if (known['audio'] !== undefined && !isPlainObject(known['audio'])) {
    noteRepair(repaired, 'audio', 'type', 'section audio invalide, défauts rétablis');
  }
  const audioKnown = isPlainObject(known['audio']) ? peelUnknown(audioIn, AUDIO_KEYS).known : {};
  const talkIn = isPlainObject(known['talk']) ? known['talk'] : {};
  const talkExtra = isPlainObject(known['talk']) ? peelUnknown(talkIn, TALK_KEYS).extra : {};
  if (known['talk'] !== undefined && !isPlainObject(known['talk'])) noteRepair(repaired, 'talk', 'type', 'section talk invalide, défauts rétablis');
  const talkKnown = isPlainObject(known['talk']) ? peelUnknown(talkIn, TALK_KEYS).known : {};
  const overlayIn = isPlainObject(known['overlay']) ? known['overlay'] : {};
  const overlayPeeled = isPlainObject(known['overlay']) ? peelUnknown(overlayIn, OVERLAY_KEYS) : { known: {}, extra: {} };
  if (known['overlay'] !== undefined && !isPlainObject(known['overlay'])) noteRepair(repaired, 'overlay', 'type', 'section overlay invalide, défauts rétablis');
  const networkIn = isPlainObject(known['network']) ? known['network'] : {};
  const networkExtra = isPlainObject(known['network']) ? peelUnknown(networkIn, NETWORK_KEYS).extra : {};
  if (known['network'] !== undefined && !isPlainObject(known['network'])) noteRepair(repaired, 'network', 'type', 'section network invalide, défauts rétablis');
  const networkKnown = isPlainObject(known['network']) ? peelUnknown(networkIn, NETWORK_KEYS).known : {};
  const updateIn = isPlainObject(known['update']) ? known['update'] : {};
  const updateExtra = isPlainObject(known['update']) ? peelUnknown(updateIn, UPDATE_KEYS).extra : {};
  if (known['update'] !== undefined && !isPlainObject(known['update'])) noteRepair(repaired, 'update', 'type', 'section update invalide, défauts rétablis');
  const updateKnown = isPlainObject(known['update']) ? peelUnknown(updateIn, UPDATE_KEYS).known : {};
  const roomIn = isPlainObject(known['room']) ? known['room'] : {};
  const roomPeeled = isPlainObject(known['room']) ? peelUnknown(roomIn, ROOM_KEYS) : { known: {} as Dict, extra: {} as Dict };
  if (known['room'] !== undefined && !isPlainObject(known['room'])) noteRepair(repaired, 'room', 'type', 'section room invalide, défauts rétablis');

  let position: Point | null = defaults.overlay.position;
  const positionExtra: Dict = {};
  const rawPosition = overlayPeeled.known['position'];
  if (rawPosition === undefined) position = defaults.overlay.position;
  else if (rawPosition === null) position = null;
  else if (isPlainObject(rawPosition)) {
    const peeled = peelUnknown(rawPosition, POSITION_KEYS);
    Object.assign(positionExtra, peeled.extra);
    if (peeled.known['x'] === undefined && peeled.known['y'] === undefined) {
      position = defaults.overlay.position;
    } else {
      const x = takeNumber(peeled.known['x'], 0, 'overlay.position.x', repaired, -100000, 100000, false);
      const y = takeNumber(peeled.known['y'], 0, 'overlay.position.y', repaired, -100000, 100000, false);
      position = { x, y };
    }
  } else {
    noteRepair(repaired, 'overlay.position', 'type', 'overlay.position invalide, défaut rétabli');
  }

  let accelerator = defaults.talk.pttAccelerator;
  if (talkKnown['pttAccelerator'] !== undefined) {
    if (typeof talkKnown['pttAccelerator'] !== 'string') {
      noteRepair(repaired, 'talk.pttAccelerator', 'type', 'raccourci invalide, défaut rétabli');
    } else {
      try {
        accelerator = normalizeAccelerator(talkKnown['pttAccelerator']);
      } catch {
        noteRepair(repaired, 'talk.pttAccelerator', 'format', 'raccourci invalide, défaut rétabli');
      }
    }
  }

  let lastHosted: RoomLastHosted | null = defaults.room.lastHosted;
  const lastExtra: Dict = {};
  const rawHosted = roomPeeled.known['lastHosted'];
  if (rawHosted === undefined) lastHosted = defaults.room.lastHosted;
  else if (rawHosted === null) lastHosted = null;
  else if (isPlainObject(rawHosted)) {
    const peeled = peelUnknown(rawHosted, LAST_HOSTED_KEYS);
    Object.assign(lastExtra, peeled.extra);
    const name = takeString(peeled.known['name'], '', 'room.lastHosted.name', repaired, 32, false);
    const capacity = takeNumber(peeled.known['capacity'], MAX_ROOM_PARTICIPANTS, 'room.lastHosted.capacity', repaired, MAX_ROOM_PARTICIPANTS, MAX_ROOM_PARTICIPANTS, true);
    lastHosted = name.length > 0 ? { name, capacity } : null;
    if (name.length === 0 && peeled.known['name'] !== undefined) {
      noteRepair(repaired, 'room.lastHosted.name', 'range', 'nom de salon vide, mesure oubliée');
    }
  } else {
    noteRepair(repaired, 'room.lastHosted', 'type', 'room.lastHosted invalide, défaut rétabli');
  }

  const extras: Dict = { ...extra };
  if (Object.keys(audioExtra).length > 0) extras['audio'] = { ...(isPlainObject(extras['audio']) ? extras['audio'] : {}), ...audioExtra };
  if (Object.keys(talkExtra).length > 0) extras['talk'] = { ...(isPlainObject(extras['talk']) ? extras['talk'] : {}), ...talkExtra };
  if (Object.keys(overlayPeeled.extra).length > 0 || Object.keys(positionExtra).length > 0) {
    const overlayExtras: Dict = { ...overlayPeeled.extra };
    if (Object.keys(positionExtra).length > 0) overlayExtras['position'] = positionExtra;
    extras['overlay'] = overlayExtras;
  }
  if (Object.keys(networkExtra).length > 0) extras['network'] = networkExtra;
  if (Object.keys(updateExtra).length > 0) extras['update'] = updateExtra;
  if (Object.keys(roomPeeled.extra).length > 0 || Object.keys(lastExtra).length > 0) {
    const roomExtras: Dict = { ...roomPeeled.extra };
    if (Object.keys(lastExtra).length > 0) roomExtras['lastHosted'] = lastExtra;
    extras['room'] = roomExtras;
  }

  const checkedAt = updateKnown['checkedAt'];
  let checked: number | null = defaults.update.checkedAt;
  if (checkedAt === undefined || checkedAt === null) checked = checkedAt === null ? null : defaults.update.checkedAt;
  else if (typeof checkedAt === 'number' && Number.isFinite(checkedAt) && checkedAt >= 0) checked = checkedAt;
  else noteRepair(repaired, 'update.checkedAt', 'type', 'update.checkedAt invalide, défaut rétabli');

  const seen = updateKnown['lastSeenVersion'];
  let lastSeen: string | null = defaults.update.lastSeenVersion;
  if (seen === undefined || seen === null) lastSeen = seen === null ? null : defaults.update.lastSeenVersion;
  else if (typeof seen === 'string' && /^\d+\.\d+\.\d+$/.test(seen)) lastSeen = seen;
  else noteRepair(repaired, 'update.lastSeenVersion', 'format', 'update.lastSeenVersion invalide, défaut rétabli');

  const value: Settings = {
    version: SETTINGS_VERSION,
    locale: takeEnum(known['locale'], defaults.locale, 'locale', repaired, LOCALES),
    theme: takeEnum(known['theme'], defaults.theme, 'theme', repaired, THEMES),
    nickname: takeString(known['nickname'], defaults.nickname, 'nickname', repaired, 32, true),
    avatar: takeAvatar(known['avatar'], defaults.avatar, 'avatar', repaired),
    audio: {
      inputDeviceId: takeNullableString(audioKnown['inputDeviceId'], defaults.audio.inputDeviceId, 'audio.inputDeviceId', repaired, 128),
      outputDeviceId: takeNullableString(audioKnown['outputDeviceId'], defaults.audio.outputDeviceId, 'audio.outputDeviceId', repaired, 128),
      noiseSuppression: takeBoolean(audioKnown['noiseSuppression'], defaults.audio.noiseSuppression, 'audio.noiseSuppression', repaired),
      echoCancellation: takeBoolean(audioKnown['echoCancellation'], defaults.audio.echoCancellation, 'audio.echoCancellation', repaired),
      noiseGate: takeBoolean(audioKnown['noiseGate'], defaults.audio.noiseGate, 'audio.noiseGate', repaired),
      inputGain: takeNumber(audioKnown['inputGain'], defaults.audio.inputGain, 'audio.inputGain', repaired, 0, 2, false),
      voiceFilter: takeEnum(audioKnown['voiceFilter'], defaults.audio.voiceFilter, 'audio.voiceFilter', repaired, VOICE_FILTER_VALUES),
      duckOthers: takeBoolean(audioKnown['duckOthers'], defaults.audio.duckOthers, 'audio.duckOthers', repaired),
    },
    talk: {
      mode: takeEnum(talkKnown['mode'], defaults.talk.mode, 'talk.mode', repaired, TALK_MODES),
      pttAccelerator: accelerator,
      vadThresholdDb: takeNumber(talkKnown['vadThresholdDb'], defaults.talk.vadThresholdDb, 'talk.vadThresholdDb', repaired, -80, -10, false),
    },
    overlay: {
      enabled: takeBoolean(overlayPeeled.known['enabled'], defaults.overlay.enabled, 'overlay.enabled', repaired),
      opacity: takeNumber(overlayPeeled.known['opacity'], defaults.overlay.opacity, 'overlay.opacity', repaired, OVERLAY_OPACITY_MIN, OVERLAY_OPACITY_MAX, false),
      scale: takeEnum(overlayPeeled.known['scale'], defaults.overlay.scale, 'overlay.scale', repaired, OVERLAY_SCALES),
      screenId: takeNullableString(overlayPeeled.known['screenId'], defaults.overlay.screenId, 'overlay.screenId', repaired, 64),
      position,
      placement: takeEnum(overlayPeeled.known['placement'], defaults.overlay.placement, 'overlay.placement', repaired, OVERLAY_PLACEMENTS),
      showWithoutDetection: takeBoolean(
        overlayPeeled.known['showWithoutDetection'],
        defaults.overlay.showWithoutDetection,
        'overlay.showWithoutDetection',
        repaired,
      ),
    },
    network: {
      signalingPort: takeNumber(networkKnown['signalingPort'], defaults.network.signalingPort, 'network.signalingPort', repaired, SIGNALING_PORT_DEFAULT, SIGNALING_PORT_MAX, true),
      discovery: takeEnum(networkKnown['discovery'], defaults.network.discovery, 'network.discovery', repaired, DISCOVERY_MODES),
    },
    update: {
      auto: takeBoolean(updateKnown['auto'], defaults.update.auto, 'update.auto', repaired),
      checkedAt: checked,
      lastSeenVersion: lastSeen,
    },
    room: {
      auto: takeBoolean(roomPeeled.known['auto'], defaults.room.auto, 'room.auto', repaired),
      lastHosted,
    },
  };
  return { value, extras };
}

export function interpretSettings(input: unknown): InterpretResult {
  if (!isPlainObject(input)) {
    return { ok: false, errors: [{ path: '', code: 'not-an-object', message: 'objet de réglages attendu' }] };
  }
  const rawVersion = input['version'];
  const defaults = defaultSettings();
  const repaired: SettingsError[] = [];
  if (rawVersion === undefined || rawVersion === LEGACY_SETTINGS_VERSION) {
    const allowed = rawVersion === undefined ? LEGACY_KEYS : [...LEGACY_KEYS, 'version'];
    const { known, extra } = peelUnknown(input, allowed);
    const legacy = known;
    const base = defaultSettings();
    if (typeof legacy['nickname'] === 'string') base.nickname = takeString(legacy['nickname'], base.nickname, 'nickname', repaired, 32, true);
    if (legacy['locale'] !== undefined) base.locale = takeEnum(legacy['locale'], base.locale, 'locale', repaired, LOCALES);
    if (legacy['theme'] !== undefined) base.theme = takeEnum(legacy['theme'], base.theme, 'theme', repaired, THEMES);
    if (legacy['mic'] !== undefined) base.audio = { ...base.audio, inputDeviceId: takeNullableString(legacy['mic'], null, 'mic', repaired, 128) };
    if (legacy['speaker'] !== undefined) base.audio = { ...base.audio, outputDeviceId: takeNullableString(legacy['speaker'], null, 'speaker', repaired, 128) };
    if (legacy['gain'] !== undefined) base.audio = { ...base.audio, inputGain: takeNumber(legacy['gain'], base.audio.inputGain, 'gain', repaired, 0, 2, false) };
    if (legacy['vadDb'] !== undefined) base.talk = { ...base.talk, vadThresholdDb: takeNumber(legacy['vadDb'], base.talk.vadThresholdDb, 'vadDb', repaired, -80, -10, false) };
    if (legacy['vadMode'] !== undefined) base.talk = { ...base.talk, mode: takeEnum(legacy['vadMode'], base.talk.mode, 'vadMode', repaired, TALK_MODES) };
    if (typeof legacy['shortcut'] === 'string') {
      try {
        base.talk = { ...base.talk, pttAccelerator: normalizeAccelerator(legacy['shortcut']) };
      } catch {
        noteRepair(repaired, 'shortcut', 'format', 'raccourci invalide, défaut rétabli');
      }
    }
    if (typeof legacy['overlayOn'] === 'boolean') base.overlay = { ...base.overlay, enabled: legacy['overlayOn'] };
    if (legacy['scale'] !== undefined) base.overlay = { ...base.overlay, scale: takeEnum(legacy['scale'], base.overlay.scale, 'scale', repaired, OVERLAY_SCALES) };
    if (legacy['opacity'] !== undefined) {
      base.overlay = {
        ...base.overlay,
        opacity: takeNumber(legacy['opacity'], base.overlay.opacity, 'opacity', repaired, OVERLAY_OPACITY_MIN, OVERLAY_OPACITY_MAX, false),
      };
    }
    return { ok: true, value: base, extras: extra, persistVersion: SETTINGS_VERSION, repaired, migratedFrom: LEGACY_SETTINGS_VERSION };
  }
  if (typeof rawVersion !== 'number' || !Number.isInteger(rawVersion) || rawVersion < 0) {
    noteRepair(repaired, 'version', 'version-unsupported', 'version de schéma illisible, version courante rétablie');
    const { value, extras } = interpretCurrent({ ...input, version: SETTINGS_VERSION }, defaults, repaired);
    return { ok: true, value, extras, persistVersion: SETTINGS_VERSION, repaired, migratedFrom: null };
  }
  const { value, extras } = interpretCurrent(input, defaults, repaired);
  return {
    ok: true,
    value,
    extras,
    persistVersion: rawVersion > SETTINGS_VERSION ? rawVersion : SETTINGS_VERSION,
    repaired,
    migratedFrom: null,
  };
}
