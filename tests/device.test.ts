/**
 * tests/device.test.ts — Carillon
 *
 * Sélection de périphérique : préféré présent, préféré absent (repli sur le
 * défaut avec raison explicite), liste vide sans exception, stabilité du choix,
 * nettoyage des listes douteuses. Aucun appel à `navigator.mediaDevices`.
 *
 *   node --test tests/device.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_DEVICE_IDS,
  chooseDevice,
  findDevice,
  isDefaultDeviceId,
  isUsableChoice,
  reconcileDevice,
  sanitizeDevices,
} from '../src/engine/device.ts'

const DEVICES = [
  { deviceId: 'default', label: 'Par défaut', kind: 'audioinput' as const },
  { deviceId: 'mic-usb', label: 'Casque USB', kind: 'audioinput' as const },
  { deviceId: 'mic-interne', label: 'Micro interne', kind: 'audioinput' as const },
]

// ─────────────────────────────────────────────────────────────────────────────
// 1. Périphérique préféré présent
// ─────────────────────────────────────────────────────────────────────────────

test('préféré présent : il gagne, la raison le nomme', () => {
  const choice = chooseDevice(DEVICES, { preferredId: 'mic-usb', fallback: 'default' })
  assert.equal(choice.deviceId, 'mic-usb')
  assert.equal(choice.label, 'Casque USB')
  assert.equal(choice.code, 'preferred')
  assert.equal(choice.requestedId, 'mic-usb')
  assert.equal(choice.candidates, 3)
  assert.match(choice.reason, /Casque USB/)
  assert.equal(isUsableChoice(choice), true)
})

test('préféré présent mais entouré d’espaces : on retombe sur l’identifiant réel', () => {
  const choice = chooseDevice(DEVICES, { preferredId: '  mic-usb  ' })
  assert.equal(choice.deviceId, 'mic-usb')
  assert.equal(choice.code, 'preferred')
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Préféré absent → repli sur le défaut, raison explicite
// ─────────────────────────────────────────────────────────────────────────────

test('préféré absent : repli sur « default », raison explicite', () => {
  const choice = chooseDevice(DEVICES, { preferredId: 'mic-bluetooth', fallback: 'default' })
  assert.equal(choice.deviceId, 'default')
  assert.equal(choice.code, 'preferred-missing')
  assert.equal(choice.requestedId, 'mic-bluetooth')
  assert.match(choice.reason, /mic-bluetooth/, 'la raison nomme le périphérique demandé')
  assert.match(choice.reason, /absent/)
  assert.match(choice.reason, /repli/)
  assert.equal(choice.candidates, 3)
})

test('sans préféré : le « default » du navigateur est retenu', () => {
  assert.deepEqual(DEFAULT_DEVICE_IDS, ['default', 'communications'])
  const choice = chooseDevice(DEVICES)
  assert.equal(choice.deviceId, 'default')
  assert.equal(choice.code, 'default-device')
  assert.equal(choice.requestedId, null)
  assert.equal(isDefaultDeviceId('default'), true)
  assert.equal(isDefaultDeviceId('communications'), true)
  assert.equal(isDefaultDeviceId('mic-usb'), false)
  assert.equal(isDefaultDeviceId(null), false)
})

test('ni préféré ni « default » : premier disponible, raison explicite', () => {
  const list = [
    { deviceId: 'mic-a', label: 'Micro A' },
    { deviceId: 'mic-b', label: 'Micro B' },
  ]
  const choice = chooseDevice(list, { preferredId: 'mic-z', fallback: 'default' })
  assert.equal(choice.deviceId, 'mic-a')
  assert.equal(choice.code, 'preferred-missing')
  assert.match(choice.reason, /mic-z/)
  assert.match(choice.reason, /premier disponible/)

  const noPreference = chooseDevice(list)
  assert.equal(noPreference.deviceId, 'mic-a')
  assert.equal(noPreference.code, 'fallback-first')
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Liste vide ou inexploitable : jamais d’exception
// ─────────────────────────────────────────────────────────────────────────────

test('liste vide : deviceId null et raison, sans lever', () => {
  const lists: Array<Array<{ deviceId: string; label: string }> | undefined | null> = [
    [],
    undefined,
    null,
  ]
  for (const list of lists) {
    const choice = chooseDevice(list, { preferredId: 'mic-usb' })
    assert.equal(choice.deviceId, null)
    assert.equal(choice.code, 'empty-list')
    assert.equal(choice.candidates, 0)
    assert.equal(choice.requestedId, 'mic-usb')
    assert.ok(choice.reason.length > 0, 'une raison est toujours fournie')
    assert.match(choice.reason, /aucun périphérique/)
    assert.equal(isUsableChoice(choice), false)
  }
})

test('entrées invalides : identifiants vides, doublons, kind filtré', () => {
  const messy = [
    { deviceId: '', label: 'vide' },
    { deviceId: '   ', label: 'blancs' },
    { deviceId: 'mic-usb', label: 'Casque USB', kind: 'audioinput' as const },
    { deviceId: 'mic-usb', label: 'Doublon', kind: 'audioinput' as const },
    { deviceId: 'cam', label: 'Caméra', kind: 'videoinput' as const },
    null as never,
  ]
  const cleaned = sanitizeDevices(messy)
  assert.deepEqual(
    cleaned.map((device) => device.deviceId),
    ['mic-usb'],
    'seul le micro valide survit, sans doublon',
  )

  const choice = chooseDevice(messy)
  assert.equal(choice.deviceId, 'mic-usb')
  assert.equal(choice.candidates, 1)
  assert.equal(choice.code, 'fallback-first')

  // Le filtre de kind est explicite : la caméra ne devient jamais un micro.
  assert.equal(sanitizeDevices(messy, 'videoinput').length, 1)
  assert.equal(sanitizeDevices(messy, 'audiooutput').length, 0)
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. Stabilité du choix
// ─────────────────────────────────────────────────────────────────────────────

test('stabilité : deux appels sur la même liste rendent la même décision', () => {
  const first = chooseDevice(DEVICES, { preferredId: 'mic-usb' })
  const second = chooseDevice(DEVICES, { preferredId: 'mic-usb' })
  assert.deepEqual(first, second)
  assert.equal(chooseDevice(DEVICES, { preferredId: 'mic-usb' }).deviceId, 'mic-usb')
})

test('reconcileDevice : conserve la sélection tant qu’elle est branchée', () => {
  const kept = reconcileDevice('mic-usb', DEVICES)
  assert.equal(kept.deviceId, 'mic-usb')
  assert.equal(kept.code, 'kept')
  assert.match(kept.reason, /conservée/)

  // Un nouveau « default » apparaît : la sélection ne saute pas pour autant.
  const withNewDefault = [...DEVICES, { deviceId: 'default-2', label: 'Nouveau défaut' }]
  assert.equal(reconcileDevice('mic-usb', withNewDefault).deviceId, 'mic-usb')
})

test('reconcileDevice : périphérique débranché → repli motivé', () => {
  const unplugged = DEVICES.filter((device) => device.deviceId !== 'mic-usb')
  const choice = reconcileDevice('mic-usb', unplugged, { preferredId: 'mic-usb' })
  assert.equal(choice.deviceId, 'default')
  assert.equal(choice.code, 'previous-missing')
  assert.match(choice.reason, /mic-usb/)
  assert.match(choice.reason, /débranché/)

  // Tout débranché : plus aucun candidat, mais toujours aucune exception.
  const empty = reconcileDevice('mic-usb', [])
  assert.equal(empty.deviceId, null)
  assert.equal(empty.code, 'empty-list')
})

test('findDevice : recherche par identifiant, sans doublon ni casse', () => {
  assert.equal(findDevice(DEVICES, 'mic-usb')?.label, 'Casque USB')
  assert.equal(findDevice(DEVICES, 'inconnu'), undefined)
  assert.equal(findDevice(DEVICES, null), undefined)
  assert.equal(findDevice(DEVICES, ''), undefined)
})
