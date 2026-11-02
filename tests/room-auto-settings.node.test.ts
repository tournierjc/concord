/**
 * tests/room-auto-settings.node.test.ts — les gardes réglages + IPC du salon automatique à la
 * reprise (2026-11-02).
 *
 * Quatre portes, toutes hors Electron :
 *  1. la RÉTRO-COMPAT : un `settings.json` écrit avant ce changement (groupe `room` absent) reste
 *     valide et rend `auto: true` + `lastHosted: null` — JC veut l'automatique, et rien n'est
 *     recréé sans mesure ; un groupe `room` mal formé reste REFUSÉ (une valeur inventée n'est pas
 *     une rétro-compat) ;
 *  2. la garde NON PATCHABLE : `room.lastHosted` est une MESURE du main — un patch du renderer qui
 *     la nomme (écrirait `null` inclus) est refusé, `forbidden-field`, exactement comme
 *     `update.checkedAt` (2026-11-01) ; l'interrupteur `room.auto` seul se patche ;
 *  3. le contrat : `roomRecreateStatusGet` n'accepte qu'une charge utile VIDE (le renderer ne
 *     pilote pas le recréage) ; `eventRoomRecreateState` valide son DTO champ par champ — phase
 *     dans la liste close, `roomName` borné 32, `reasonKey` parmi les trois clés connues ;
 *  4. la parité i18n bidirectionnelle des clés `room.auto.*` (catalogue ↔ code, style
 *     `tests/update-ipc-settings.node.test.ts`).
 *
 * Lancer : npx tsx --test tests/room-auto-settings.node.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  IPC,
  RECREATE_ROOM_NAME_MAX,
  guardPayload,
  type IpcEventChannel,
  type IpcInvokeChannel,
} from '../src/shell/ipc-contract';
import { applySettingsPatch, defaultSettings, parseSettings, serializeSettings } from '../src/shell/settings-schema';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function errorOf(result: ReturnType<typeof guardPayload>): { code: string; message: string } | null {
  return result.ok ? null : { code: result.error.code, message: result.error.message };
}

/* ------------------------------------------------------------------ */
/* 1. Réglages : rétro-compat et validation du groupe `room`            */
/* ------------------------------------------------------------------ */

/** Un fichier écrit AVANT le 2026-11-02 : aucun groupe `room` nulle part. */
function legacyJson(): Record<string, unknown> {
  const current = JSON.parse(serializeSettings(defaultSettings())) as Record<string, unknown>;
  delete current['room'];
  return current;
}

describe('reglages room — retro-compat', () => {
  it('fichier sans le groupe room : valide, auto=true, lastHosted=null', () => {
    const result = parseSettings(legacyJson());
    assert.equal(result.ok, true, 'un fichier ancien doit rester valide');
    if (result.ok) {
      assert.equal(result.value.room.auto, true, 'l’automatique est voulu par défaut (JC)');
      assert.equal(result.value.room.lastHosted, null, 'rien n’est recréé sans mesure');
    }
  });

  it('groupe room présent et bien formé : les mesures sont lues', () => {
    const source = legacyJson();
    source['room'] = { auto: true, lastHosted: { name: 'Cuisine', capacity: 8 } };
    const result = parseSettings(source);
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.value.room.lastHosted, { name: 'Cuisine', capacity: 8 });
  });

  it('auto faux lu, pas effacé en silence', () => {
    const source = legacyJson();
    source['room'] = { auto: false, lastHosted: null };
    const result = parseSettings(source);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.room.auto, false);
  });

  it('valeur hors forme refusée : auto non-booleen, lastHosted non-objet, capacite hors constante', () => {
    const badAuto = legacyJson();
    badAuto['room'] = { auto: 'oui', lastHosted: null };
    assert.equal(parseSettings(badAuto).ok, false, 'auto doit etre un booleen');

    const badLast = legacyJson();
    badLast['room'] = { auto: true, lastHosted: 'Cuisine' };
    assert.equal(parseSettings(badLast).ok, false, 'lastHosted doit etre un objet ou null');

    const badCapacity = legacyJson();
    badCapacity['room'] = { auto: true, lastHosted: { name: 'Cuisine', capacity: 4 } };
    assert.equal(parseSettings(badCapacity).ok, false, 'la capacite est la constante du maillage, pas un choix');

    const badName = legacyJson();
    badName['room'] = { auto: true, lastHosted: { name: 'x'.repeat(33), capacity: 8 } };
    assert.equal(parseSettings(badName).ok, false, 'le nom porte la meme borne que le join (32)');

    const unknown = legacyJson();
    unknown['room'] = { auto: true, lastHosted: null, secret: 'cle' };
    assert.equal(parseSettings(unknown).ok, false, 'aucune cle inconnue sous room');
  });

  it('aller-retour serialise/reparse conserve la mesure', () => {
    const withRoom = { ...defaultSettings(), room: { auto: true, lastHosted: { name: 'Atelier', capacity: 8 } } };
    const reparsed = parseSettings(JSON.parse(serializeSettings(withRoom)));
    assert.equal(reparsed.ok, true);
    if (reparsed.ok) assert.deepEqual(reparsed.value.room.lastHosted, { name: 'Atelier', capacity: 8 });
  });
});

/* ------------------------------------------------------------------ */
/* 2. La garde non patchable — `lastHosted` est une mesure du main      */
/* ------------------------------------------------------------------ */

describe('reglages room — garde non patchable (patron update.checkedAt)', () => {
  it('l’interrupteur auto seul se patche', () => {
    const result = applySettingsPatch(defaultSettings(), { room: { auto: false } });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.room.auto, false);
  });

  it('le patch ne perd pas la mesure quand il ne la nomme pas (droit du patch partiel)', () => {
    const withRoom = { ...defaultSettings(), room: { auto: true, lastHosted: { name: 'Cuisine', capacity: 8 } } };
    const result = applySettingsPatch(withRoom, { room: { auto: false } });
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.value.room.lastHosted, { name: 'Cuisine', capacity: 8 });
  });

  it('un patch qui NOMME lastHosted est refuse, meme a null (effacer est une ecriture)', () => {
    const write = applySettingsPatch(defaultSettings(), {
      room: { auto: true, lastHosted: { name: 'Faux salon', capacity: 8 } },
    });
    assert.equal(write.ok, false, 'le renderer ne decreete pas qu’un salon l’attend');
    if (!write.ok) {
      assert.ok(
        write.errors.some((e) => e.path === 'room.lastHosted' && e.code === 'forbidden-field'),
        `forbidden-field attendu, recu : ${JSON.stringify(write.errors)}`,
      );
    }
    const erase = applySettingsPatch(defaultSettings(), { room: { auto: true, lastHosted: null } });
    assert.equal(erase.ok, false, 'le renderer n’efface pas la reprise — null est une ECRITURE');
  });

  it('un groupe room non-objet est refuse', () => {
    assert.equal(applySettingsPatch(defaultSettings(), { room: true }).ok, false);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Le contrat : invoke vide, événement DTO                           */
/* ------------------------------------------------------------------ */

describe('contrat salon automatique', () => {
  it('roomRecreateStatusGet est un invoke, pas un evenement', () => {
    assert.ok(INVOKE_CHANNELS.includes(IPC.roomRecreateStatusGet));
    assert.ok(!EVENT_CHANNELS.includes(IPC.roomRecreateStatusGet as IpcEventChannel));
    assert.ok(EVENT_CHANNELS.includes(IPC.eventRoomRecreateState));
  });

  it('invoke : null et {} passent, tout champ est refuse (le renderer ne pilote pas le recreate)', () => {
    const channel = IPC.roomRecreateStatusGet as IpcInvokeChannel;
    assert.equal(guardPayload('invoke', channel, undefined).ok, true);
    assert.equal(guardPayload('invoke', channel, null).ok, true);
    assert.equal(guardPayload('invoke', channel, {}).ok, true);
    assert.notEqual(errorOf(guardPayload('invoke', channel, { name: 'Cuisine' })), null);
    assert.notEqual(errorOf(guardPayload('invoke', channel, { arm: true })), null);
    assert.notEqual(errorOf(guardPayload('invoke', channel, 'recreate')), null);
  });

  it('evenement : les cinq phases passent, rien d’autre', () => {
    for (const phase of ['idle', 'pending', 'recreating', 'recreated', 'failed'] as const) {
      assert.equal(guardPayload('event', IPC.eventRoomRecreateState, { phase, roomName: null, reasonKey: null }).ok, true, phase);
    }
    assert.equal(guardPayload('event', IPC.eventRoomRecreateState, { phase: 'retrying', roomName: null, reasonKey: null }).ok, false);
    assert.equal(guardPayload('event', IPC.eventRoomRecreateState, { phase: null, roomName: null, reasonKey: null }).ok, false);
    assert.equal(guardPayload('event', IPC.eventRoomRecreateState, { roomName: null, reasonKey: null }).ok, false, 'phase obligatoire');
  });

  it('evenement : roomName borne a 32 (la meme que le join), reasonKey parmi les trois cles', () => {
    assert.equal(
      guardPayload('event', IPC.eventRoomRecreateState, { phase: 'pending', roomName: 'x'.repeat(RECREATE_ROOM_NAME_MAX), reasonKey: null }).ok,
      true,
    );
    assert.equal(
      guardPayload('event', IPC.eventRoomRecreateState, { phase: 'pending', roomName: 'x'.repeat(RECREATE_ROOM_NAME_MAX + 1), reasonKey: null }).ok,
      false,
    );
    for (const reasonKey of ['room.auto.failed.hosting', 'room.auto.failed.network', 'room.auto.failed.create'] as const) {
      assert.equal(guardPayload('event', IPC.eventRoomRecreateState, { phase: 'failed', roomName: 'Cuisine', reasonKey }).ok, true, reasonKey);
    }
    // Une raison qui n'est pas une clé du catalogue est refusée : le lobby n'affiche jamais un
    // libellé que le contrat n'a pas pu nommer (pas de phrase brute venue du main).
    assert.equal(
      guardPayload('event', IPC.eventRoomRecreateState, { phase: 'failed', roomName: 'Cuisine', reasonKey: 'todo: reessayer' }).ok,
      false,
    );
    // Un champ inconnu est refusé (object strict comme les autres evenements).
    assert.equal(
      guardPayload('event', IPC.eventRoomRecreateState, { phase: 'failed', roomName: null, reasonKey: null, retryIn: 5000 }).ok,
      false,
      'aucun champ inconnu — la machine n’annonce pas de nouvelle tentative',
    );
  });
});

/* ------------------------------------------------------------------ */
/* 4. Parité i18n bidirectionnelle des clés `room.auto.*`               */
/* ------------------------------------------------------------------ */

const FR = JSON.parse(readFileSync(join(ROOT, 'design/i18n/fr.json'), 'utf8')) as Record<string, string>;
const EN = JSON.parse(readFileSync(join(ROOT, 'design/i18n/en.json'), 'utf8')) as Record<string, string>;

describe('i18n room.auto.* — parité bidirectionnelle', () => {
  const frKeys = Object.keys(FR).filter((key) => key.startsWith('room.auto.'));
  const enKeys = Object.keys(EN).filter((key) => key.startsWith('room.auto.'));

  it('mêmes clés room.auto.* en FR et en EN', () => {
    assert.deepEqual(frKeys.slice().sort(), enKeys.slice().sort());
    assert.ok(frKeys.length >= 7, `au moins les 7 clés attendues, lu : ${frKeys.length}`);
  });

  it('toute clé room.auto.* du catalogue est référencée par une source (garde clé morte, famille ciblée)', () => {
    const sources = [
      readFileSync(join(ROOT, 'src/renderer/App.tsx'), 'utf8'),
      readFileSync(join(ROOT, 'src/renderer/Settings.tsx'), 'utf8'),
      readFileSync(join(ROOT, 'src/main/room-recreate.ts'), 'utf8'),
      readFileSync(join(ROOT, 'src/shell/ipc-contract.ts'), 'utf8'),
    ].join('\n');
    for (const key of frKeys) {
      // Les trois clés d'échec sont citées en littéral par la machine ET le contrat ; les autres
      // par le renderer. Une clé sans référence est morte — refusée, pas excusée.
      assert.ok(sources.includes(`'${key}'`), `clé morte : ${key}`);
    }
  });

  it('toute clé room.auto.* nommée par la machine du main est au catalogue FR et EN', () => {
    const machine = readFileSync(join(ROOT, 'src/main/room-recreate.ts'), 'utf8');
    for (const match of machine.matchAll(/'room\.auto\.[a-z.]+'/g)) {
      const key = match[0].replaceAll("'", '');
      assert.ok(key in FR, `${key} absente du catalogue FR`);
      assert.ok(key in EN, `${key} absente du catalogue EN`);
    }
  });

  it('les trois clés d’échec publiables sont cataloguées et ont la moustache {{name}}', () => {
    for (const key of ['room.auto.failed.hosting', 'room.auto.failed.network', 'room.auto.failed.create'] as const) {
      assert.ok(FR[key]?.includes('{{name}}'), `${key} FR doit nommer le salon`);
      assert.ok(EN[key]?.includes('{{name}}'), `${key} EN doit nommer le salon`);
    }
    assert.ok(FR['room.auto.recreating']?.includes('{{name}}'));
    assert.ok(EN['room.auto.recreating']?.includes('{{name}}'));
  });
});
