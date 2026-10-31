/**
 * tests/ipc-contract.test.ts — vérification de src/shell/ipc-contract.ts
 *
 * Exécutable SANS dépendance : `node --test tests/ipc-contract.test.ts`.
 * Couvre SPEC-001 A15 / CA19 : canaux nommés, canal inconnu rejeté, charges utiles validées dans
 * les deux sens, plafond de 8 participants côté événement.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  IPC,
  IPC_MAX_PARTICIPANTS,
  IpcContractError,
  assertPayload,
  guardPayload,
  isEventChannel,
  isInvokeChannel,
  isKnownChannel,
  type ParticipantDto,
} from '../src/shell/ipc-contract.ts';
import {
  MAX_ROOM_PARTICIPANTS,
  SETTINGS_VERSION,
  defaultSettings,
} from '../src/shell/settings-schema.ts';
import { AVATAR_SIZE_BY_SCALE } from '../src/shell/overlay-geometry.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function participant(overrides: Partial<ParticipantDto> = {}): ParticipantDto {
  return {
    id: 'p1',
    name: 'Ada',
    muted: false,
    deafened: false,
    gain: 1,
    connection: 'connected',
    ...overrides,
  };
}

function errorOf(result: ReturnType<typeof guardPayload>): { code: string; channel: string; message: string } {
  assert.equal(result.ok, false, 'la garde devait refuser');
  if (result.ok) throw new Error('inatteignable');
  return result.error;
}

test('canaux : noms uniques, préfixe commun, séparés invoke/event', () => {
  const all = Object.values(IPC);
  assert.equal(new Set(all).size, all.length, 'aucun doublon de canal');
  assert.equal(INVOKE_CHANNELS.length + EVENT_CHANNELS.length, all.length);
  for (const channel of all) {
    assert.ok(channel.startsWith('lan:'), `canal préfixé : ${channel}`);
  }
  for (const channel of INVOKE_CHANNELS) {
    assert.equal(isInvokeChannel(channel), true);
    assert.equal(isEventChannel(channel), false);
    assert.equal(isKnownChannel(channel), true);
  }
  for (const channel of EVENT_CHANNELS) {
    assert.equal(isEventChannel(channel), true);
    assert.equal(isInvokeChannel(channel), false);
  }
  assert.equal(isKnownChannel('lan:nope'), false);
  assert.equal(isInvokeChannel('lan:nope'), false);
});

test('canal inconnu rejeté dans les deux sens, y compris par assertPayload', () => {
  const unknown = errorOf(guardPayload('invoke', 'lan:evil', {}));
  assert.equal(unknown.code, 'unknown-channel');
  assert.equal(unknown.channel, 'lan:evil');
  assert.match(unknown.message, /lan:evil/);

  assert.equal(errorOf(guardPayload('event', 'lan:evil', {})).code, 'unknown-channel');

  assert.throws(
    () => assertPayload('invoke', 'lan:evil', {}),
    (error: unknown) => error instanceof IpcContractError && error.code === 'unknown-channel',
  );
});

test('roomJoin : charge utile stricte', () => {
  const ok = guardPayload('invoke', IPC.roomJoin, { roomId: 'salon-1', name: 'Ada' });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual(ok.value, { roomId: 'salon-1', name: 'Ada' });

  assert.match(errorOf(guardPayload('invoke', IPC.roomJoin, { roomId: 'salon-1' })).message, /name/);
  assert.match(
    errorOf(guardPayload('invoke', IPC.roomJoin, { roomId: '', name: 'Ada' })).message,
    /roomId/,
  );
  const extra = errorOf(
    guardPayload('invoke', IPC.roomJoin, { roomId: 'salon-1', name: 'Ada', admin: true }),
  );
  assert.equal(extra.code, 'invalid-payload');
  assert.match(extra.message, /payload\.admin: champ inconnu/);
  assert.equal(errorOf(guardPayload('invoke', IPC.roomJoin, 'salon-1')).code, 'invalid-payload');
});

test('contrôles : mute, push-to-talk, gain', () => {
  assert.equal(guardPayload('invoke', IPC.controlSetMute, { muted: true }).ok, true);
  assert.equal(errorOf(guardPayload('invoke', IPC.controlSetMute, { muted: 'true' })).code, 'invalid-payload');
  assert.equal(guardPayload('invoke', IPC.controlSetMute, { muted: true, force: 1 }).ok, false);

  assert.equal(guardPayload('invoke', IPC.controlSetPushToTalk, { active: false }).ok, true);
  assert.equal(guardPayload('invoke', IPC.controlSetPushToTalk, { active: null }).ok, false);

  const gain = guardPayload('invoke', IPC.controlSetGain, { participantId: 'p1', gain: 0.5 });
  assert.equal(gain.ok, true);
  assert.equal(errorOf(guardPayload('invoke', IPC.controlSetGain, { participantId: 'p1', gain: 3 })).message.includes('hors bornes'), true);
  assert.equal(guardPayload('invoke', IPC.controlSetGain, { participantId: '', gain: 1 }).ok, false);
});

test('overlaySet : champs optionnels, échelles conformes à la géométrie', () => {
  assert.equal(guardPayload('invoke', IPC.overlaySet, {}).ok, true);
  assert.equal(guardPayload('invoke', IPC.overlaySet, { visible: false }).ok, true);
  assert.equal(guardPayload('invoke', IPC.overlaySet, { opacity: 0.6 }).ok, true);
  assert.equal(guardPayload('invoke', IPC.overlaySet, { opacity: 0.3 }).ok, false, 'opacité sous 0.6');
  assert.equal(guardPayload('invoke', IPC.overlaySet, { position: null }).ok, true);
  assert.equal(guardPayload('invoke', IPC.overlaySet, { position: { x: 1, y: 2 } }).ok, true);
  assert.equal(
    guardPayload('invoke', IPC.overlaySet, { position: { x: 1, y: 2, z: 3 } }).ok,
    false,
    'champ inconnu dans position',
  );
  assert.equal(guardPayload('invoke', IPC.overlaySet, { scale: 'xl' }).ok, false);
  assert.equal(guardPayload('invoke', IPC.overlaySet, { rotation: 90 }).ok, false);

  for (const scale of Object.keys(AVATAR_SIZE_BY_SCALE)) {
    assert.equal(guardPayload('invoke', IPC.overlaySet, { scale }).ok, true, `échelle ${scale}`);
  }
});

test('settingsSet : objet non vide, sections connues seulement', () => {
  assert.equal(guardPayload('invoke', IPC.settingsSet, { locale: 'en' }).ok, true);
  assert.equal(guardPayload('invoke', IPC.settingsSet, {}).ok, false, 'patch vide refusé');
  assert.equal(guardPayload('invoke', IPC.settingsSet, { theme: 'dark', extra: 1 }).ok, false);
  assert.equal(guardPayload('invoke', IPC.settingsSet, ['locale']).ok, false);
});

test('canaux sans charge utile : {}, null ou undefined acceptés, le reste refusé', () => {
  for (const channel of [IPC.settingsGet, IPC.settingsOpen, IPC.roomLeave]) {
    assert.equal(guardPayload('invoke', channel, undefined).ok, true, `${channel} sans charge`);
    assert.equal(guardPayload('invoke', channel, null).ok, true);
    assert.equal(guardPayload('invoke', channel, {}).ok, true);
    assert.equal(guardPayload('invoke', channel, { force: true }).ok, false);
    assert.equal(guardPayload('invoke', channel, 12).ok, false);
  }
});

test('eventParticipants : plafond de 8 et champs stricts', () => {
  assert.equal(IPC_MAX_PARTICIPANTS, MAX_ROOM_PARTICIPANTS, 'plafond identique au schéma de réglages');

  const two = guardPayload('event', IPC.eventParticipants, [participant(), participant({ id: 'p2' })]);
  assert.equal(two.ok, true);
  if (two.ok) assert.equal((two.value as ParticipantDto[]).length, 2);

  const nine = Array.from({ length: 9 }, (_unused, index) => participant({ id: `p${index}` }));
  const nineError = errorOf(guardPayload('event', IPC.eventParticipants, nine));
  assert.equal(nineError.code, 'invalid-payload');
  assert.match(nineError.message, /plus de 8 participants/);

  assert.equal(
    guardPayload('event', IPC.eventParticipants, [participant({ gain: 5 })]).ok,
    false,
    'gain hors bornes',
  );
  assert.equal(
    guardPayload('event', IPC.eventParticipants, [{ ...participant(), extra: true }]).ok,
    false,
    'champ inconnu dans un participant',
  );
  assert.equal(
    guardPayload('event', IPC.eventParticipants, [participant({ connection: 'zombie' as never })]).ok,
    false,
  );
  assert.equal(guardPayload('event', IPC.eventParticipants, { length: 1 }).ok, false);
});

test('AD-17 D1 : le canal de parole distante n\'existe plus', () => {
  // Falsifiables : si `lan:event:speaking` revenait au contrat (ou au préload), ces deux
  // assertions tombent. Le canal n'a aucun producteur côté main — l'audio est dans le renderer.
  assert.equal('eventSpeaking' in IPC, false);
  assert.equal(
    guardPayload('event', 'lan:event:speaking' as never, { participantId: 'p1', speaking: true, level: 0.4 }).ok,
    false,
  );
});

test('AD-17 D2 : un participant qui affirme sa parole est refusé', () => {
  // L'annuaire ne porte pas la parole : le champ est inconnu, donc invalide, donc jamais relayé.
  const withSpeaking = guardPayload('event', IPC.eventParticipants, [participant({ speaking: true } as never)]);
  assert.equal(withSpeaking.ok, false);
  assert.equal(guardPayload('event', IPC.eventParticipants, [participant()]).ok, true);
});

test('eventRoomState : bornes respectées', () => {
  const state = {
    roomId: 'salon-1',
    roomName: 'Salon',
    phase: 'connected',
    participantCount: 3,
    selfId: 'p1',
    notice: null,
  };
  assert.equal(guardPayload('event', IPC.eventRoomState, state).ok, true);
  assert.equal(
    guardPayload('event', IPC.eventRoomState, { ...state, participantCount: 9 }).ok,
    false,
    'pas plus de 8 participants dans un salon',
  );
  assert.equal(guardPayload('event', IPC.eventRoomState, { ...state, phase: 'zombie' }).ok, false);
  assert.equal(guardPayload('event', IPC.eventRoomState, { ...state, extra: 1 }).ok, false);
});

test('eventSettingsChanged : version numérique exigée, réglages par défaut acceptés', () => {
  const payload = { settings: defaultSettings() };
  assert.equal(guardPayload('event', IPC.eventSettingsChanged, payload).ok, true);
  assert.equal(guardPayload('event', IPC.eventSettingsChanged, { settings: {} }).ok, false);
  assert.equal(
    guardPayload('event', IPC.eventSettingsChanged, { settings: { version: '1' } }).ok,
    false,
  );
  assert.equal(SETTINGS_VERSION, defaultSettings().version);
  assert.equal(guardPayload('event', IPC.eventSettingsChanged, defaultSettings()).ok, false);
});

test('eventOverlayGeometry et eventShortcutConflict', () => {
  const geometry = { x: 100, y: 20, width: 308, height: 44, scaleFactor: 2 };
  assert.equal(guardPayload('event', IPC.eventOverlayGeometry, geometry).ok, true);
  assert.equal(
    guardPayload('event', IPC.eventOverlayGeometry, { ...geometry, scaleFactor: 9 }).ok,
    false,
  );
  assert.equal(
    guardPayload('event', IPC.eventOverlayGeometry, { ...geometry, width: -1 }).ok,
    false,
  );

  const conflict = { accelerator: 'Alt+Space', registered: false, fallback: 'Ctrl+Alt+Space', reason: null };
  assert.equal(guardPayload('event', IPC.eventShortcutConflict, conflict).ok, true);
  const explicitNulls = guardPayload('event', IPC.eventShortcutConflict, {
    accelerator: 'Alt+Space',
    registered: true,
    fallback: null,
    reason: null,
  });
  assert.equal(explicitNulls.ok, true, 'null explicite accepté pour les champs optionnels');
  if (explicitNulls.ok) {
    assert.deepEqual(explicitNulls.value, {
      accelerator: 'Alt+Space',
      registered: true,
      fallback: null,
      reason: null,
    });
  }

  // Un émetteur qui oublie un champ est refusé : sur ces événements, l'absence est ambiguë
  // (pas de repli ≠ repli inconnu), donc on exige la présence explicite.
  const partial = guardPayload('event', IPC.eventShortcutConflict, {
    accelerator: 'Alt+Space',
    registered: false,
  });
  assert.equal(partial.ok, false);
  assert.match(errorOf(partial).message, /fallback/);
  assert.equal(
    guardPayload('event', IPC.eventShortcutConflict, { ...conflict, registered: 'no' }).ok,
    false,
  );
});

test('assertPayload retourne la valeur validée et lève avec le chemin fautif', () => {
  const value = assertPayload('invoke', IPC.controlSetGain, { participantId: 'p1', gain: 1.5 });
  assert.deepEqual(value, { participantId: 'p1', gain: 1.5 });

  assert.throws(
    () => assertPayload('invoke', IPC.controlSetGain, { participantId: 'p1', gain: 4 }),
    (error: unknown) =>
      error instanceof IpcContractError &&
      error.code === 'invalid-payload' &&
      error.path === 'payload' &&
      error.message.includes('gain'),
  );
});

/* ------------------------------------------------------------------ */
/* T16 / SPEC-007 §4.1 — signalisation : canaux, gardes, parité preload       */
/* ------------------------------------------------------------------ */

test('les deux canaux de signalisation existent, typés et enregistrés', () => {
  assert.equal(IPC.signalSend, 'lan:signal:send');
  assert.equal(IPC.eventSignal, 'lan:event:signal');
  assert.ok(INVOKE_CHANNELS.includes(IPC.signalSend), 'signalSend est un invoke');
  assert.ok(EVENT_CHANNELS.includes(IPC.eventSignal), 'eventSignal est un événement');
  assert.ok(!INVOKE_CHANNELS.includes(IPC.eventSignal as never));
});

test('signalSend accepte offer/answer/ice/leave et refuse le reste', () => {
  for (const kind of ['offer', 'answer', 'ice'] as const) {
    const result = guardPayload('invoke', IPC.signalSend, { kind, to: 'p2', payload: 'x' });
    assert.equal(result.ok, true, kind);
  }
  assert.equal(guardPayload('invoke', IPC.signalSend, { kind: 'leave' }).ok, true);
  assert.equal(guardPayload('invoke', IPC.signalSend, { kind: 'offer', to: 'p2' }).ok, false);
  assert.equal(guardPayload('invoke', IPC.signalSend, { kind: 'bluff', to: 'p2', payload: 1 }).ok, false);
  assert.equal(guardPayload('invoke', IPC.signalSend, { kind: 'offer', to: '', payload: 1 }).ok, false);
  assert.equal(
    guardPayload('invoke', IPC.signalSend, { kind: 'offer', to: 'p2', payload: 1, extra: true }).ok,
    false,
  );
  assert.equal(guardPayload('invoke', IPC.signalSend, { kind: 'leave', to: 'p2' }).ok, false);
});

test('eventSignal accepte les cinq formes du contrat et refuse les autres', () => {
  assert.equal(
    guardPayload('event', IPC.eventSignal, { kind: 'peer-joined', peerId: 'p2', name: 'Ada' }).ok,
    true,
  );
  assert.equal(guardPayload('event', IPC.eventSignal, { kind: 'peer-left', peerId: 'p2' }).ok, true);
  assert.equal(
    guardPayload('event', IPC.eventSignal, { kind: 'offer', from: 'p2', payload: 'v=0' }).ok,
    true,
  );
  assert.equal(
    guardPayload('event', IPC.eventSignal, { kind: 'link', state: 'refused', detail: 'salon plein' }).ok,
    true,
  );
  assert.equal(guardPayload('event', IPC.eventSignal, { kind: 'link', state: 'refused' }).ok, true);
  // `detail` est `string | null` (SPEC-007 §4.1) : le `null` explicite est la valeur par défaut
  // d'`emitLink()` côté lien — il doit passer, sinon l'événement est jeté par `sendEvent`.
  assert.equal(
    guardPayload('event', IPC.eventSignal, { kind: 'link', state: 'connecting', detail: null }).ok,
    true,
  );
  assert.deepEqual(
    guardPayload('event', IPC.eventSignal, { kind: 'link', state: 'connecting', detail: null }),
    { ok: true, value: { kind: 'link', state: 'connecting', detail: null } },
  );
  // Chaîne vide = « pas de raison » mal encodée, et un non-texte n'est pas une raison.
  assert.equal(guardPayload('event', IPC.eventSignal, { kind: 'link', state: 'closed', detail: '' }).ok, false);
  assert.equal(guardPayload('event', IPC.eventSignal, { kind: 'link', state: 'closed', detail: 42 }).ok, false);
  assert.equal(
    guardPayload('event', IPC.eventSignal, { kind: 'link', state: 'closed', detail: 'x'.repeat(241) }).ok,
    false,
  );
  assert.equal(guardPayload('event', IPC.eventSignal, { kind: 'link', state: 'perdu' }).ok, false);
  assert.equal(guardPayload('event', IPC.eventSignal, { kind: 'peer-left' }).ok, false);
  assert.equal(guardPayload('event', IPC.eventSignal, { kind: 'offer', from: 'p2' }).ok, false);
  assert.equal(guardPayload('event', IPC.eventSignal, { kind: 'inconnu' }).ok, false);
});

test('parité contrat ↔ preload : aucun canal ne vit d’un seul côté', () => {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const preload = readFileSync(`${here}../src/preload/index.ts`, 'utf8');

  // Tous les canaux du contrat, avec leur nom de propriété dans `IPC`.
  const contractKeys = Object.keys(IPC) as Array<keyof typeof IPC>;
  const usedInPreload = new Set(
    [...preload.matchAll(/IPC\.([A-Za-z0-9_]+)/gu)].map((match) => match[1] as string),
  );

  const missingInPreload = contractKeys.filter((key) => !usedInPreload.has(key));
  assert.deepEqual(
    missingInPreload,
    [],
    `canaux du contrat absents du preload : ${missingInPreload.join(', ')}`,
  );

  const phantomInPreload = [...usedInPreload].filter(
    (key) => !(key in IPC),
  );
  assert.deepEqual(phantomInPreload, [], `canaux cités par le preload mais absents du contrat : ${phantomInPreload.join(', ')}`);

  // Chaque canal doit être atteignable des deux côtés : invoke pour l'aller, event pour le retour.
  for (const key of contractKeys) {
    const channel = IPC[key];
    assert.ok(
      isKnownChannel(channel),
      `canal inconnu du garde : ${channel}`,
    );
  }
});
