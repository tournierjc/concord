/**
 * tests/settings-store.node.test.ts — le fichier de réglages n'est plus jeté.
 *
 * Un binaire plus ancien refusait `audio.voiceFilter` (champ inconnu) ou une version de
 * schéma plus grande, retombait sur les défauts, puis réécrivait le fichier. Ici : les
 * champs inconnus survivent, un champ invalide ne réinitialise que lui, un JSON illisible
 * est copié en `.bak` et le fichier d'origine n'est pas écrasé.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createSettingsStore } from '../src/main/settings-store.ts';
import { defaultSettings, interpretSettings, SETTINGS_VERSION } from '../src/shell/settings-schema.ts';

function dir(): string {
  return mkdtempSync(join(tmpdir(), 'concord-settings-'));
}

test('un champ inconnu est conservé au tour complet', () => {
  const file = join(dir(), 'settings.json');
  const original = {
    ...defaultSettings(),
    nickname: 'jeanjean',
    audio: { ...defaultSettings().audio, voiceFilter: 'robot', futureKnob: 7 },
    extraTop: { keep: true },
  };
  writeFileSync(file, `${JSON.stringify(original, null, 2)}\n`);
  const store = createSettingsStore(file);
  const loaded = store.load();
  assert.equal(loaded.blocked, false);
  assert.equal(loaded.settings.nickname, 'jeanjean');
  assert.equal(loaded.settings.audio.voiceFilter, 'robot');
  loaded.settings.talk.mode = 'vad';
  store.save(loaded.settings);
  const written = JSON.parse(readFileSync(file, 'utf8')) as {
    nickname: string;
    talk: { mode: string };
    audio: { voiceFilter: string; futureKnob?: number };
    extraTop?: { keep?: boolean };
  };
  assert.equal(written.nickname, 'jeanjean');
  assert.equal(written.talk.mode, 'vad');
  assert.equal(written.audio.voiceFilter, 'robot');
  assert.equal(written.audio.futureKnob, 7);
  assert.equal(written.extraTop?.keep, true);
});

test('un seul champ invalide ne réinitialise pas les autres', () => {
  const base = defaultSettings();
  const parsed = interpretSettings({
    ...base,
    nickname: 'krillin',
    locale: 'en',
    audio: { ...base.audio, inputGain: 'fort', voiceFilter: 'robot' },
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.nickname, 'krillin');
  assert.equal(parsed.value.locale, 'en');
  assert.equal(parsed.value.audio.voiceFilter, 'robot');
  assert.equal(parsed.value.audio.inputGain, base.audio.inputGain);
  assert.ok(parsed.repaired.some((error) => error.path === 'audio.inputGain'));
});

test('une version future est relue et réécrite, pas remplacée par les défauts', () => {
  const file = join(dir(), 'settings.json');
  const original = {
    ...defaultSettings(),
    version: SETTINGS_VERSION + 3,
    nickname: 'futur',
    audio: { ...defaultSettings().audio, notYet: 'oui' },
  };
  writeFileSync(file, JSON.stringify(original));
  const store = createSettingsStore(file);
  const loaded = store.load();
  assert.equal(loaded.blocked, false);
  assert.equal(loaded.settings.nickname, 'futur');
  store.save(loaded.settings);
  const written = JSON.parse(readFileSync(file, 'utf8')) as { version: number; nickname: string; audio: { notYet?: string } };
  assert.equal(written.version, SETTINGS_VERSION + 3);
  assert.equal(written.nickname, 'futur');
  assert.equal(written.audio.notYet, 'oui');
});

test('un JSON illisible est copié en .bak et le fichier n’est pas écrasé', () => {
  const file = join(dir(), 'settings.json');
  const corrupt = '{ ce n’est pas du json';
  writeFileSync(file, corrupt);
  const store = createSettingsStore(file);
  const loaded = store.load();
  assert.equal(loaded.blocked, true);
  assert.equal(loaded.settings.nickname, '');
  assert.equal(readFileSync(file, 'utf8'), corrupt);
  assert.equal(readFileSync(`${file}.bak`, 'utf8'), corrupt);
  assert.throws(() => store.save(defaultSettings()));
  assert.equal(readFileSync(file, 'utf8'), corrupt);
});
