/**
 * tests/settings-schema.test.ts — vérification de src/shell/settings-schema.ts
 *
 * Exécutable SANS dépendance : `node --test tests/settings-schema.test.ts`.
 * Couvre SPEC-001 A11 / A12 / A13 / CA12 : valeurs par défaut, validation stricte, refus explicite
 * des champs inconnus, migration v0 → v1, raccourci push-to-talk `Alt+Space` par défaut.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  BEACON_PORT,
  DEFAULT_PTT_ACCELERATOR,
  MAX_ROOM_PARTICIPANTS,
  OVERLAY_OPACITY_MAX,
  OVERLAY_OPACITY_MIN,
  SETTINGS_VERSION,
  SIGNALING_PORT_DEFAULT,
  SIGNALING_PORT_MAX,
  applySettingsPatch,
  defaultSettings,
  isValidAccelerator,
  normalizeAccelerator,
  parseSettings,
  serializeSettings,
  signalingPortCandidates,
  type Settings,
  type SettingsError,
} from '../src/shell/settings-schema.ts';
import { AVATAR_SIZE_BY_SCALE } from '../src/shell/overlay-geometry.ts';

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

function codes(errors: SettingsError[]): string[] {
  return errors.map((error) => `${error.path}:${error.code}`);
}

function expectFailure(result: ReturnType<typeof parseSettings>): SettingsError[] {
  assert.equal(result.ok, false, 'la validation devait échouer');
  if (result.ok) throw new Error('inatteignable');
  return result.errors;
}

test('valeurs par défaut conformes aux nombres figés par SPEC-001', () => {
  const settings = defaultSettings();
  assert.equal(settings.version, SETTINGS_VERSION);
  assert.equal(settings.talk.pttAccelerator, 'Alt+Space', 'PTT par défaut : Alt+Space');
  assert.equal(DEFAULT_PTT_ACCELERATOR, 'Alt+Space');
  assert.equal(settings.talk.mode, 'ptt');
  assert.equal(settings.network.signalingPort, 47821);
  assert.equal(SIGNALING_PORT_DEFAULT, 47821);
  assert.equal(SIGNALING_PORT_MAX, 47830);
  assert.equal(BEACON_PORT, 47820);
  assert.equal(MAX_ROOM_PARTICIPANTS, 8);
  assert.equal(settings.overlay.opacity, 0.9);

  const tokens = loadTokens();
  assert.equal(settings.overlay.opacity, tokens['overlay']['opacity']['default']);
  assert.equal(OVERLAY_OPACITY_MIN, tokens['overlay']['opacity']['min']);
  assert.equal(OVERLAY_OPACITY_MAX, tokens['overlay']['opacity']['max']);
  assert.equal(MAX_ROOM_PARTICIPANTS, tokens['overlay']['maxParticipants']);

  const parsed = parseSettings(settings);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.migratedFrom, null, 'des réglages v1 ne sont pas migrés');
  assert.deepEqual(parsed.value, settings);
});

test('ports de signalisation : 47821 → 47830 inclus, dans l\'ordre', () => {
  const ports = signalingPortCandidates();
  assert.equal(ports.length, 10);
  assert.equal(ports[0], 47821);
  assert.equal(ports[ports.length - 1], 47830);
  assert.deepEqual(ports, [47821, 47822, 47823, 47824, 47825, 47826, 47827, 47828, 47829, 47830]);
});

test('échelles d\'overlay cohérentes avec la géométrie', () => {
  const settings = defaultSettings();
  for (const scale of Object.keys(AVATAR_SIZE_BY_SCALE)) {
    const patched = applySettingsPatch(settings, { overlay: { scale } });
    assert.equal(patched.ok, true, `échelle ${scale} acceptée`);
  }
  assert.deepEqual(Object.keys(AVATAR_SIZE_BY_SCALE).sort(), ['lg', 'md', 'sm']);
});

test('round-trip sérialisation → analyse : identique', () => {
  const settings = defaultSettings();
  const text = serializeSettings(settings);
  assert.ok(text.endsWith('\n'), 'fichier terminé par un saut de ligne');
  const reparsed = parseSettings(JSON.parse(text));
  assert.equal(reparsed.ok, true);
  if (!reparsed.ok) return;
  assert.deepEqual(reparsed.value, settings);
});

test('champ inconnu refusé (racine et imbriqué), jamais ignoré', () => {
  const settings = defaultSettings() as unknown as Record<string, any>;
  settings['overlayX'] = true;
  const topLevel = expectFailure(parseSettings(settings));
  assert.deepEqual(codes(topLevel), ['overlayX:unknown-field']);

  const nested = defaultSettings() as unknown as Record<string, any>;
  nested['audio']['inputGainDb'] = 3;
  const nestedErrors = expectFailure(parseSettings(nested));
  assert.equal(nestedErrors.length, 1);
  assert.equal(nestedErrors[0]?.path, 'audio.inputGainDb');
  assert.equal(nestedErrors[0]?.code, 'unknown-field');

  const position = defaultSettings() as unknown as Record<string, any>;
  position['overlay']['position'] = { x: 1, y: 2, z: 3 };
  const positionErrors = expectFailure(parseSettings(position));
  assert.deepEqual(codes(positionErrors), ['overlay.position.z:unknown-field']);
});

test('types, bornes et énumérations : refus avec chemin pointé', () => {
  const wrongType = defaultSettings() as unknown as Record<string, any>;
  wrongType['audio']['inputGain'] = '1';
  assert.deepEqual(codes(expectFailure(parseSettings(wrongType))), ['audio.inputGain:type']);

  const outOfRange = defaultSettings() as unknown as Record<string, any>;
  outOfRange['overlay']['opacity'] = 1.2;
  assert.deepEqual(codes(expectFailure(parseSettings(outOfRange))), ['overlay.opacity:range']);

  const badEnum = defaultSettings() as unknown as Record<string, any>;
  badEnum['overlay']['scale'] = 'xl';
  assert.deepEqual(codes(expectFailure(parseSettings(badEnum))), ['overlay.scale:enum']);

  const badPort = defaultSettings() as unknown as Record<string, any>;
  badPort['network']['signalingPort'] = 47831;
  assert.deepEqual(codes(expectFailure(parseSettings(badPort))), ['network.signalingPort:range']);

  const missing = defaultSettings() as unknown as Record<string, any>;
  delete missing['talk']['vadThresholdDb'];
  assert.deepEqual(codes(expectFailure(parseSettings(missing))), ['talk.vadThresholdDb:missing-field']);

  const notAnObject = expectFailure(parseSettings(null));
  assert.equal(notAnObject[0]?.code, 'not-an-object');

  const sectionMissing = defaultSettings() as unknown as Record<string, any>;
  delete sectionMissing['network'];
  const sectionErrors = expectFailure(parseSettings(sectionMissing));
  assert.ok(codes(sectionErrors).includes('network:missing-field'));
});

test('versions : future refusée, illisible refusée', () => {
  const future = { ...defaultSettings(), version: SETTINGS_VERSION + 1 };
  const futureErrors = expectFailure(parseSettings(future));
  assert.equal(futureErrors[0]?.path, 'version');
  assert.equal(futureErrors[0]?.code, 'version-future');

  const nonsense = { ...defaultSettings(), version: '1' };
  assert.deepEqual(codes(expectFailure(parseSettings(nonsense))), ['version:version-unsupported']);

  const negative = { ...defaultSettings(), version: -1 };
  assert.deepEqual(codes(expectFailure(parseSettings(negative))), ['version:version-unsupported']);
});

test('migration v0 (clés plates) → v1, valeurs conservées', () => {
  const legacy = {
    mic: 'usb-mic',
    speaker: 'casque',
    gain: 1.4,
    vadDb: -33,
    vadMode: 'vad',
    shortcut: 'ctrl+shift+m',
    overlayOn: false,
    scale: 'lg',
    opacity: 0.75,
    nickname: 'Jean-Claude',
    locale: 'en',
    theme: 'dark',
    // champ retiré en v1 : toléré puis abandonné
    muteOnStart: true,
  };
  const result = parseSettings(legacy);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.migratedFrom, 0);
  assert.equal(result.value.version, SETTINGS_VERSION);
  assert.equal(result.value.audio.inputDeviceId, 'usb-mic');
  assert.equal(result.value.audio.outputDeviceId, 'casque');
  assert.equal(result.value.audio.inputGain, 1.4);
  assert.equal(result.value.talk.vadThresholdDb, -33);
  assert.equal(result.value.talk.mode, 'vad');
  assert.equal(result.value.talk.pttAccelerator, 'Ctrl+Shift+M', 'raccourci normalisé');
  assert.equal(result.value.overlay.enabled, false);
  assert.equal(result.value.overlay.scale, 'lg');
  assert.equal(result.value.overlay.opacity, 0.75);
  assert.equal(result.value.nickname, 'Jean-Claude');
  assert.equal(result.value.locale, 'en');
  assert.equal(result.value.theme, 'dark');
  assert.equal(result.value.network.signalingPort, SIGNALING_PORT_DEFAULT, 'défaut appliqué');
  assert.equal('muteOnStart' in (result.value as unknown as Record<string, unknown>), false);

  const versionZero = parseSettings({ ...legacy, version: 0 });
  assert.equal(versionZero.ok, true);
  if (versionZero.ok) assert.equal(versionZero.migratedFrom, 0);

  const legacyUnknown = parseSettings({ ...legacy, wat: 1 });
  const errors = expectFailure(legacyUnknown);
  assert.equal(errors[0]?.path, 'wat');
  assert.equal(errors[0]?.code, 'legacy-unknown-field');
});

test('accélérateurs : normalisation et refus des raccourcis dangereux', () => {
  assert.equal(normalizeAccelerator('alt+space'), 'Alt+Space');
  assert.equal(normalizeAccelerator('ALT + SPACE'), 'Alt+Space');
  assert.equal(normalizeAccelerator('ctrl+alt+e'), 'Ctrl+Alt+E');
  assert.equal(normalizeAccelerator('CommandOrControl+Shift+Space'), 'CommandOrControl+Shift+Space');
  assert.equal(normalizeAccelerator('super+1'), 'Super+1');

  assert.equal(isValidAccelerator('Alt+Space'), true);
  assert.equal(isValidAccelerator('F5'), false, 'une touche seule est refusée');
  assert.equal(isValidAccelerator('Alt'), false, 'un modificateur seul est refusé');
  assert.equal(isValidAccelerator('Alt+Alt+Space'), false, 'modificateur répété');
  assert.equal(isValidAccelerator('Alt+Space+K'), false, 'deux touches finales');

  const badAccelerator = defaultSettings() as unknown as Record<string, any>;
  badAccelerator['talk']['pttAccelerator'] = 'Space';
  const errors = expectFailure(parseSettings(badAccelerator));
  assert.deepEqual(codes(errors), ['talk.pttAccelerator:format']);
});

test('patch partiel : fusion, refus de version et des champs inconnus', () => {
  const settings = defaultSettings();

  const patched = applySettingsPatch(settings, { talk: { mode: 'vad' } });
  assert.equal(patched.ok, true);
  if (!patched.ok) return;
  assert.equal(patched.value.talk.mode, 'vad');
  assert.equal(patched.value.talk.pttAccelerator, 'Alt+Space', 'le reste de la section est conservé');
  assert.equal(patched.value.audio.inputGain, settings.audio.inputGain);

  const overlayPatch = applySettingsPatch(settings, {
    overlay: { opacity: 0.7, position: { x: 120, y: 40 } },
  });
  assert.equal(overlayPatch.ok, true);
  if (!overlayPatch.ok) return;
  assert.equal(overlayPatch.value.overlay.opacity, 0.7);
  assert.deepEqual(overlayPatch.value.overlay.position, { x: 120, y: 40 });
  assert.equal(overlayPatch.value.overlay.scale, settings.overlay.scale);

  const versionPatch = expectFailure(applySettingsPatch(settings, { version: 2 } as unknown));
  assert.deepEqual(codes(versionPatch), ['version:forbidden-field']);

  const unknownPatch = expectFailure(applySettingsPatch(settings, { inconnu: 1 }));
  assert.deepEqual(codes(unknownPatch), ['inconnu:unknown-field']);

  const unknownNested = expectFailure(applySettingsPatch(settings, { talk: { foo: 1 } }));
  assert.deepEqual(codes(unknownNested), ['talk.foo:unknown-field']);

  const badMode = expectFailure(applySettingsPatch(settings, { talk: { mode: 'auto' } }));
  assert.deepEqual(codes(badMode), ['talk.mode:enum']);

  const empty = expectFailure(applySettingsPatch(settings, null));
  assert.equal(empty[0]?.code, 'not-an-object');

  // Le patch ne modifie pas l'objet d'origine (pas d'effet de bord).
  assert.deepEqual(settings, defaultSettings());
});

test('les réglages validés sont sérialisables et re-lisibles à l\'identique', () => {
  const patched = applySettingsPatch(defaultSettings(), {
    locale: 'en',
    nickname: 'Regie',
    audio: { inputDeviceId: 'dev-1', inputGain: 0.8 },
    talk: { mode: 'ptt', pttAccelerator: 'Alt+Space', vadThresholdDb: -35 },
    overlay: { enabled: true, opacity: 0.95, scale: 'sm', screenId: '2', position: { x: 10, y: 20 } },
    network: { signalingPort: 47825, discovery: 'broadcast' },
  });
  assert.equal(patched.ok, true);
  if (!patched.ok) return;
  const value: Settings = patched.value;
  const again = parseSettings(JSON.parse(serializeSettings(value)));
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.deepEqual(again.value, value);
});
