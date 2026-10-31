/**
 * src/engine/device.ts — Carillon
 *
 * Sélection du périphérique audio, **pure** : on ne touche jamais à
 * `navigator.mediaDevices`, on décide sur une liste qu'on nous donne. C'est ce
 * qui permet de tester les cas qui font mal en vrai (micro débranché, casque USB
 * qui disparaît en pleine réunion) sans brancher quoi que ce soit.
 *
 * Règles (T2) :
 *   1. le périphérique **préféré** (`preferredId`) gagne s'il est présent ;
 *   2. sinon on se replie sur le périphérique `default` du navigateur, avec une
 *      **raison explicite** qui nomme l'identifiant manquant ;
 *   3. liste vide (ou inexploitable) ⇒ `{ deviceId: null, reason }`, **sans
 *      lever** : l'appelant décide d'afficher « aucun micro » et de garder la
 *      porte fermée ;
 *   4. le choix est **stable** : deux appels sur la même liste rendent la même
 *      réponse, et `reconcileDevice` conserve la sélection courante tant que le
 *      périphérique reste branché. Sans cette règle, un `devicechange` (casque
 *      qui se recharge, écran qui s'allume) ferait sauter la sélection à chaque
 *      événement du navigateur.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type MediaDeviceKind = 'audioinput' | 'audiooutput' | 'videoinput'

/** Sous-ensemble de `MediaDeviceInfo` : ce dont la décision a besoin. */
export interface AudioDevice {
  readonly deviceId: string
  readonly label?: string
  readonly kind?: MediaDeviceKind
  readonly groupId?: string
}

/** Stratégie de repli : `'default'` = le pseudo-périphérique du navigateur. */
export type DeviceFallback = 'default'

export interface DeviceChoiceOptions {
  readonly preferredId?: string | null
  readonly fallback?: DeviceFallback
  /** Filtre de kind ; `audioinput` par défaut (c'est le micro qu'on choisit). */
  readonly kind?: MediaDeviceKind
}

/** Code stable pour la logique et les tests (le texte, lui, est pour l'humain). */
export type DeviceReasonCode =
  | 'preferred'
  | 'preferred-missing'
  | 'default-device'
  | 'fallback-first'
  | 'kept'
  | 'previous-missing'
  | 'empty-list'

export interface DeviceChoice {
  /** Identifiant retenu, ou `null` si aucun périphérique exploitable. */
  readonly deviceId: string | null
  readonly label: string | null
  readonly code: DeviceReasonCode
  /** Phrase lisible, affichable telle quelle dans l'UI. */
  readonly reason: string
  /** Identifiant demandé (préféré ou précédent), pour le diagnostic. */
  readonly requestedId: string | null
  /** Nombre de périphériques exploitables après filtrage. */
  readonly candidates: number
}

/** Identifiants « par défaut » : Chrome/Safari exposent `default`, Firefox non. */
export const DEFAULT_DEVICE_IDS: ReadonlyArray<string> = ['default', 'communications']

/** Le micro est le périphérique par défaut de ce module. */
export const DEFAULT_KIND: MediaDeviceKind = 'audioinput'

// ─────────────────────────────────────────────────────────────────────────────
// Nettoyage de la liste
// ─────────────────────────────────────────────────────────────────────────────

function isUsableId(deviceId: unknown): deviceId is string {
  return typeof deviceId === 'string' && deviceId.trim().length > 0
}

function isAudioKind(device: AudioDevice, kind: MediaDeviceKind): boolean {
  return device.kind === undefined || device.kind === kind
}

/**
 * Filtre et déduplique une liste de périphériques : identifiants vides ou non
 * textuels écartés, doublons fusionnés (le premier gagne, l'ordre du navigateur
 * faisant foi), kind filtré. Ne lève jamais, même sur `undefined`.
 */
export function sanitizeDevices(
  list: ReadonlyArray<AudioDevice> | null | undefined,
  kind: MediaDeviceKind = DEFAULT_KIND,
): AudioDevice[] {
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const out: AudioDevice[] = []
  for (const device of list) {
    if (!device || typeof device !== 'object') continue
    if (!isUsableId(device.deviceId)) continue
    if (!isAudioKind(device, kind)) continue
    const id = device.deviceId.trim()
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      deviceId: id,
      label: typeof device.label === 'string' ? device.label : undefined,
      kind: device.kind,
      groupId: typeof device.groupId === 'string' ? device.groupId : undefined,
    })
  }
  return out
}

/** Cherche un périphérique par identifiant (après nettoyage). */
export function findDevice(
  list: ReadonlyArray<AudioDevice> | null | undefined,
  deviceId: string | null | undefined,
  kind: MediaDeviceKind = DEFAULT_KIND,
): AudioDevice | undefined {
  if (!isUsableId(deviceId)) return undefined
  return sanitizeDevices(list, kind).find((device) => device.deviceId === deviceId)
}

/** Vrai si l'identifiant correspond au pseudo-périphérique « default ». */
export function isDefaultDeviceId(deviceId: string | null | undefined): boolean {
  return isUsableId(deviceId) && DEFAULT_DEVICE_IDS.indexOf(deviceId.trim()) >= 0
}

function labelOf(device: AudioDevice): string {
  const label = typeof device.label === 'string' ? device.label.trim() : ''
  return label.length > 0 ? label : device.deviceId
}

function describe(device: AudioDevice): string {
  return `« ${labelOf(device)} » (${device.deviceId})`
}

function emptyChoice(requestedId: string | null): DeviceChoice {
  return {
    deviceId: null,
    label: null,
    code: 'empty-list',
    reason:
      'aucun périphérique audio exploitable : le micro reste fermé (push-to-talk indisponible)',
    requestedId,
    candidates: 0,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Décision
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Choisit un périphérique. Déterministe : à liste et options égales, la réponse
 * est identique — c'est la garantie de stabilité demandée par T2.
 */
export function chooseDevice(
  list: ReadonlyArray<AudioDevice> | null | undefined,
  options: DeviceChoiceOptions = {},
): DeviceChoice {
  const kind = options.kind ?? DEFAULT_KIND
  const preferredId =
    typeof options.preferredId === 'string' && options.preferredId.trim().length > 0
      ? options.preferredId.trim()
      : null
  const devices = sanitizeDevices(list, kind)
  if (devices.length === 0) return emptyChoice(preferredId)

  if (preferredId) {
    const preferred = devices.find((device) => device.deviceId === preferredId)
    if (preferred) {
      return {
        deviceId: preferred.deviceId,
        label: preferred.label ?? null,
        code: 'preferred',
        reason: `périphérique préféré ${describe(preferred)} disponible`,
        requestedId: preferredId,
        candidates: devices.length,
      }
    }
  }

  const fallback = options.fallback ?? 'default'
  if (fallback === 'default') {
    const byDefault = devices.find((device) => isDefaultDeviceId(device.deviceId))
    if (byDefault) {
      const reason = preferredId
        ? `périphérique préféré « ${preferredId} » absent (${devices.length} disponible(s)) — repli sur le périphérique par défaut ${describe(byDefault)}`
        : `aucun périphérique préféré demandé — périphérique par défaut ${describe(byDefault)}`
      return {
        deviceId: byDefault.deviceId,
        label: byDefault.label ?? null,
        code: preferredId ? 'preferred-missing' : 'default-device',
        reason,
        requestedId: preferredId,
        candidates: devices.length,
      }
    }
  }

  const first = devices[0]
  // `devices.length > 0` est garanti plus haut : le garde n'existe que pour le type.
  if (first === undefined) return emptyChoice(preferredId)
  const reason = preferredId
    ? `périphérique préféré « ${preferredId} » absent et aucun périphérique « default » — repli sur le premier disponible ${describe(first)}`
    : `aucun périphérique préféré demandé et aucun « default » — premier disponible ${describe(first)}`
  return {
    deviceId: first.deviceId,
    label: first.label ?? null,
    code: preferredId ? 'preferred-missing' : 'fallback-first',
    reason,
    requestedId: preferredId,
    candidates: devices.length,
  }
}

/**
 * Maintient un choix existant à travers un `devicechange` : si `currentId` est
 * toujours là, on le garde (code `kept`) ; sinon on repart sur la stratégie
 * normale et la raison dit que le périphérique a disparu.
 */
export function reconcileDevice(
  currentId: string | null | undefined,
  list: ReadonlyArray<AudioDevice> | null | undefined,
  options: DeviceChoiceOptions = {},
): DeviceChoice {
  const kind = options.kind ?? DEFAULT_KIND
  if (isUsableId(currentId)) {
    const current = findDevice(list, currentId, kind)
    if (current) {
      return {
        deviceId: current.deviceId,
        label: current.label ?? null,
        code: 'kept',
        reason: `sélection conservée : ${describe(current)} toujours disponible`,
        requestedId: currentId.trim(),
        candidates: sanitizeDevices(list, kind).length,
      }
    }
    const fallbackChoice = chooseDevice(list, options)
    return {
      ...fallbackChoice,
      code: fallbackChoice.candidates === 0 ? 'empty-list' : 'previous-missing',
      reason: `périphérique « ${currentId} » débranché — ${fallbackChoice.reason}`,
      requestedId: currentId.trim(),
    }
  }
  return chooseDevice(list, options)
}

/** Vrai si le choix est utilisable : un identifiant ET un périphérique réel. */
export function isUsableChoice(choice: DeviceChoice): boolean {
  return choice.deviceId !== null
}
