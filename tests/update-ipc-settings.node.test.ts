/**
 * tests/update-ipc-settings.node.test.ts — les gardes IPC et les réglages des mises à jour
 * (avenant SPEC-006b, arbitrage JC du 2026-11-01).
 *
 * Trois portes, toutes hors Electron :
 *  1. les DEUX nouveaux invokes (`updateCheckNow`, `updateInstallNow`) n'acceptent qu'une charge
 *     utile VIDE — `null`, `{}` passent, tout champ est refusé ;
 *  2. l'événement `eventUpdateState` valide son DTO champ par champ : phase dans la liste close,
 *     `version` sous forme `X.Y.Z` ou `null`, `percent` entier 0..100 ou `null`, `reason` chaîne
 *     bornée ou `null` — un float au pourcentage ou une version inventée sont refusés ;
 *  3. le réglage `update` : un `settings.json` écrit AVANT l'amendement (groupe absent) reste
 *     valide et devient `auto: true` (JC veut l'automatique par défaut), et la parité i18n
 *     bidirectionnelle des clés `update.*` est vérifiée dans les deux sens (style
 *     `tests/i18n-dead-keys.node.test.ts` : catalogue ↔ code, jamais l'un sans l'autre).
 *
 * Lancer : npx tsx --test tests/update-ipc-settings.node.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  EVENT_CHANNELS,
  IPC,
  INVOKE_CHANNELS,
  UPDATE_REASON_MAX,
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
/* 1. Les invokes à charge utile vide                                    */
/* ------------------------------------------------------------------ */

describe('invokes de mise à jour : charge utile vide stricte', () => {
  for (const channel of [IPC.updateCheckNow, IPC.updateInstallNow] as IpcInvokeChannel[]) {
    it(`${channel} : null et {} passent`, () => {
      assert.equal(guardPayload('invoke', channel, null).ok, true);
      assert.equal(guardPayload('invoke', channel, {}).ok, true);
    });
    it(`${channel} : tout champ est refuse`, () => {
      // Le renderer ne choisit NI l'URL, NI la version, NI un chemin — un champ = une tentative.
      assert.notEqual(errorOf(guardPayload('invoke', channel, { url: 'https://evil.example.com/x' })), null);
      assert.notEqual(errorOf(guardPayload('invoke', channel, { version: '9.9.9' })), null);
      assert.notEqual(errorOf(guardPayload('invoke', channel, { path: '/tmp/x.exe' })), null);
      assert.notEqual(errorOf(guardPayload('invoke', channel, 'check')), null);
      assert.notEqual(errorOf(guardPayload('invoke', channel, 42)), null);
      assert.notEqual(errorOf(guardPayload('invoke', channel, [])), null);
    });
  }
  it('les deux canaux sont des invokes enregistre, pas des evenements', () => {
    assert.ok(INVOKE_CHANNELS.includes(IPC.updateCheckNow));
    assert.ok(INVOKE_CHANNELS.includes(IPC.updateInstallNow));
    assert.ok(!EVENT_CHANNELS.includes(IPC.updateCheckNow as IpcEventChannel));
    assert.ok(!EVENT_CHANNELS.includes(IPC.updateInstallNow as IpcEventChannel));
  });
  it('eventUpdateState est un evenement enregistre', () => {
    assert.ok(EVENT_CHANNELS.includes(IPC.eventUpdateState));
  });
});

/* ------------------------------------------------------------------ */
/* 2. Le DTO eventUpdateState, champ par champ                           */
/* ------------------------------------------------------------------ */

describe('eventUpdateState : DTO valide', () => {
  const okStates: Array<Record<string, unknown>> = [
    { state: 'idle', version: null, percent: null, reason: null },
    { state: 'checking', version: null, percent: null, reason: null },
    { state: 'available', version: '0.10.0', percent: null, reason: null },
    { state: 'downloading', version: '0.10.0', percent: 0, reason: null },
    { state: 'downloading', version: '0.10.0', percent: 100, reason: null },
    { state: 'downloaded', version: '0.10.0', percent: null, reason: null },
    {
      state: 'downloaded',
      version: '0.10.0',
      percent: null,
      reason: 'sudo apt install /home/u/.config/concord/downloads/concord-0.10.0-linux-amd64.deb',
    },
    { state: 'installing', version: '0.10.0', percent: null, reason: null },
    { state: 'up-to-date', version: '0.4.0', percent: null, reason: null },
    { state: 'disabled', version: null, percent: null, reason: null },
    { state: 'failed', version: null, percent: null, reason: 'empreinte non concordante' },
  ];
  for (const payload of okStates) {
    it(`passe : ${payload.state} version=${payload.version ?? 'null'} percent=${payload.percent ?? 'null'}`, () => {
      assert.equal(guardPayload('event', IPC.eventUpdateState, payload).ok, true);
    });
  }
});

describe('eventUpdateState : DTO refuse', () => {
  it('phase hors liste close', () => {
    assert.notEqual(
      errorOf(guardPayload('event', IPC.eventUpdateState, { state: 'rebooting', version: null, percent: null, reason: null })),
      null,
    );
    assert.notEqual(
      errorOf(guardPayload('event', IPC.eventUpdateState, { state: null, version: null, percent: null, reason: null })),
      null,
    );
  });
  it('version non-X.Y.Z refusee (jamais un tag brut, jamais un flottant)', () => {
    for (const version of ['v0.10.0', '0.10', '0.10.0-beta', '10.0', 'x.y.z', '']) {
      assert.notEqual(
        errorOf(guardPayload('event', IPC.eventUpdateState, { state: 'available', version, percent: null, reason: null })),
        null,
        `version refusee : ${version}`,
      );
    }
  });
  it('percent flottant, <0, >100, chaine : refuses', () => {
    for (const percent of [12.5, -1, 101, '50', NaN, Infinity]) {
      assert.notEqual(
        errorOf(guardPayload('event', IPC.eventUpdateState, { state: 'downloading', version: '0.10.0', percent, reason: null })),
        null,
        `percent refuse : ${String(percent)}`,
      );
    }
  });
  it('reason non-chaîne ou trop longue : refusée', () => {
    assert.notEqual(
      errorOf(guardPayload('event', IPC.eventUpdateState, { state: 'failed', version: null, percent: null, reason: 42 })),
      null,
    );
    assert.notEqual(
      errorOf(
        guardPayload('event', IPC.eventUpdateState, {
          state: 'failed',
          version: null,
          percent: null,
          reason: 'x'.repeat(UPDATE_REASON_MAX + 1),
        }),
      ),
      null,
    );
    // La longueur limite passe (mesure de la borne, pas de la générosité).
    assert.equal(
      guardPayload('event', IPC.eventUpdateState, {
        state: 'failed',
        version: null,
        percent: null,
        reason: 'x'.repeat(UPDATE_REASON_MAX),
      }).ok,
      true,
    );
  });
  it('champ inconnu et champ manquant sont refuses', () => {
    assert.notEqual(
      errorOf(guardPayload('event', IPC.eventUpdateState, { state: 'idle', version: null, percent: null, reason: null, extra: true })),
      null,
    );
    assert.notEqual(errorOf(guardPayload('event', IPC.eventUpdateState, { state: 'idle' })), null);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Réglages : rétro-compat et mesures                                 */
/* ------------------------------------------------------------------ */

describe('reglage update : retro-compat', () => {
  /** Un settings.json écrit AVANT l'amendement : le groupe `update` n'existe pas. */
  function legacyJson(): Record<string, unknown> {
    const current = defaultSettings() as unknown as Record<string, unknown>;
    const legacy: Record<string, unknown> = {};
    for (const key of Object.keys(current)) {
      if (key !== 'update') legacy[key] = current[key];
    }
    return legacy;
  }

  it('groupe absent : fichier valide, auto=true (JC veut l\'automatique par defaut)', () => {
    const result = parseSettings(legacyJson());
    assert.equal(result.ok, true, 'un fichier ancien sans le groupe update reste valide');
    if (!result.ok) return;
    assert.deepEqual(result.value.update, { auto: true, checkedAt: null, lastSeenVersion: null });
  });
  it('groupe present et valide : les mesures sont lues telles quelles', () => {
    const source = legacyJson();
    source['update'] = { auto: false, checkedAt: 1_730_000_000_000, lastSeenVersion: '0.9.9' };
    const result = parseSettings(source);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value.update, { auto: false, checkedAt: 1_730_000_000_000, lastSeenVersion: '0.9.9' });
  });
  it('auto non-booleen, checkedAt non-numerique, version hors X.Y.Z : refuses, jamais repares', () => {
    const badAuto = legacyJson();
    badAuto['update'] = { auto: 'oui' };
    assert.equal(parseSettings(badAuto).ok, false, 'auto doit etre un booleen');

    const badChecked = legacyJson();
    badChecked['update'] = { checkedAt: 'hier' };
    assert.equal(parseSettings(badChecked).ok, false, 'checkedAt doit etre un nombre ou null');

    const badVersion = legacyJson();
    badVersion['update'] = { lastSeenVersion: 'v0.10' };
    assert.equal(parseSettings(badVersion).ok, false, 'lastSeenVersion doit etre X.Y.Z ou null');
  });
  it('champ inconnu dans le groupe : refuse comme partout ailleurs', () => {
    const source = legacyJson();
    source['update'] = { auto: true, channel: 'beta' };
    assert.equal(parseSettings(source).ok, false);
  });
  it('patch du renderer : auto acceptee, mesures refusees', () => {
    const base = defaultSettings();
    // L'interrupteur est un reglage : le renderer peut l'ecrire, en patch partiel comme partiel-complete.
    const ok = applySettingsPatch(base, { update: { auto: false } });
    assert.equal(ok.ok, true);
    // Le patch COMPLETE n'est pas le langage du renderer : il propagerait les mesures absentes par
    // simple copie (les mesures n'ont rien demandé) et serait refuse — c'est le contrat, pas un bug.
    const fullPropagation = applySettingsPatch(base, { update: { ...base.update, auto: false } });
    assert.equal(fullPropagation.ok, false, 'propager une mesure par copie est une ecriture refusee');
    // Les mesures sont des faits observes par le service : un patch qui les porte est refuse.
    // Le patch partiel du renderer ne passe JAMAIS par `{...settings.update, ...}` : il nomme la
    // cle modifiee ({ auto }) et laisse les mesures absentes — les propager serait une ecriture.
    const forged = applySettingsPatch(base, { update: { auto: true, checkedAt: 0 } });
    assert.equal(forged.ok, false, 'checkedAt est une mesure, pas un reglage');
    const forgedNull = applySettingsPatch(base, { update: { auto: true, checkedAt: null } });
    assert.equal(forgedNull.ok, false, 'meme effacer une mesure est un ecrit du renderer');
    const forgedSeen = applySettingsPatch(base, { update: { auto: true, lastSeenVersion: '9.9.9' } });
    assert.equal(forgedSeen.ok, false, 'lastSeenVersion est une mesure, pas un reglage');
  });
  it('round-trip serialisation → analyse : identique', () => {
    const settings = defaultSettings();
    const reparsed = parseSettings(JSON.parse(serializeSettings(settings)));
    assert.equal(reparsed.ok, true);
    if (!reparsed.ok) return;
    assert.deepEqual(reparsed.value.update, settings.update);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Parite i18n des cles update.* dans les deux sens                   */
/* ------------------------------------------------------------------ */

describe('cles update.* : parite catalogue ↔ code', () => {
  const fr = JSON.parse(readFileSync(join(ROOT, 'design/i18n/fr.json'), 'utf8')) as Record<string, string>;
  const en = JSON.parse(readFileSync(join(ROOT, 'design/i18n/en.json'), 'utf8')) as Record<string, string>;

  const frUpdateKeys = Object.keys(fr).filter((k) => k.startsWith('update.'));
  const enUpdateKeys = Object.keys(en).filter((k) => k.startsWith('update.'));

  it('FR et EN portent exactement les memes cles update.*', () => {
    assert.deepEqual(frUpdateKeys.slice().sort(), enUpdateKeys.slice().sort());
    assert.ok(frUpdateKeys.length >= 12, `au moins 12 cles attendues, trouvees : ${frUpdateKeys.length}`);
  });

  it('chaque cle update.* du catalogue est referencee dans le code (pas de cle morte)', () => {
    // Le garde global `i18n-dead-keys` fait ce travail pour TOUTES les clés ; le refaire ici, en
    // borné aux clés `update.*`, rend la régression locale immédiate quand une clé de la feature
    // est renommée sans être recâblée.
    const codeDirs = ['src', 'design', 'tests'];
    const texts: string[] = [];
    function walk(dirAbs: string): void {
      const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
      for (const entry of readdirSync(dirAbs)) {
        const abs = join(dirAbs, entry);
        if (statSync(abs).isDirectory()) walk(abs);
        else if (/\.(ts|tsx|mjs)$/.test(entry)) texts.push(readFileSync(abs, 'utf8'));
      }
    }
    for (const dir of codeDirs) walk(resolve(ROOT, dir));
    const joined = texts.join('\n');
    for (const key of frUpdateKeys) {
      assert.ok(joined.includes(`'${key}'`) || joined.includes(`"${key}"`), `cle morte : ${key}`);
    }
  });

  it('les placeholders des paires FR/EN concordent ({{version}}, {{percent}}, {{reason}}, {{date}})', () => {
    const placeholder = (value: string): string[] => (value.match(/\{\{([a-zA-Z]+)\}\}/g) ?? []).slice().sort();
    for (const key of frUpdateKeys) {
      assert.deepEqual(placeholder(fr[key] ?? ''), placeholder(en[key] ?? ''), `placeholders divergents : ${key}`);
    }
  });

  it('typographie FR : les apostrophes droites sont proscrites dans les libellés update.*', () => {
    // La loi typo du repo (`design/check-i18n.mjs`, contrôle 6) : guillemets « » en FR. Le garde
    // global la vérifie pour tout le catalogue ; ici, elle protège la feature contre un retour.
    for (const key of frUpdateKeys) {
      const value = fr[key] ?? '';
      assert.ok(!/[\u0022]/.test(value), `guillemets droits ASCII en FR : ${key}`);
    }
  });
});
