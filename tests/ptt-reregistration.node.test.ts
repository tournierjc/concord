/**
 * tests/ptt-reregistration.node.test.ts — changer le raccourci push-to-talk l'enregistre vraiment.
 *
 * LE DÉFAUT : `persist()` (`src/main/index.ts`) écrivait les réglages et prévenait le renderer, mais
 * ne touchait jamais au raccourci. Or le raccourci n'est pas un réglage mou : il est réservé auprès
 * du SYSTÈME par `globalShortcut` (`src/main/ptt.ts`). Changer l'accélérateur dans les réglages
 * laissait donc l'ANCIEN réservé et le nouveau muet **jusqu'au redémarrage** — l'UI affichait la
 * nouvelle valeur, le clavier continuait de répondre à l'autre. Rien ne le ré-enregistrait non plus
 * ailleurs : `registerPushToTalkShortcut()` n'était appelé qu'une fois, au démarrage.
 *
 * Ce fichier fige :
 *   1. la décision « faut-il ré-enregistrer ? » (`pushToTalkAcceleratorChanged`, pure) : oui quand
 *      l'accélérateur change, NON pour tout autre réglage ;
 *   2. l'ordre des gestes dans `src/main/index.ts` : libérer l'ancien avant de réserver le nouveau
 *      (`globalShortcut.register` refuse un accélérateur déjà tenu, y compris par nous-mêmes) ;
 *   3. l'unicité de la publication du conflit (le second envoi, en fin de `bootstrap`, faisait doublon).
 *
 * Le geste lui-même (`globalShortcut.register`) n'est pas mesurable ici : `electron` n'est pas
 * chargeable hors application. Ce qui est prouvé est la décision et le câblage, pas l'effet clavier.
 *
 * Lancer : cd /work/lan-voice && npx tsx --test tests/ptt-reregistration.node.test.ts
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, it } from 'node:test';

import { defaultSettings, pushToTalkAcceleratorChanged } from '../src/shell/settings-schema.ts';

const MAIN_SOURCE = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const PTT_SOURCE = readFileSync(new URL('../src/main/ptt.ts', import.meta.url), 'utf8');

function withPttAccelerator(accelerator: string) {
  const base = defaultSettings();
  return { ...base, talk: { ...base.talk, pttAccelerator: accelerator } };
}

describe('pushToTalkAcceleratorChanged — ré-enregistrer seulement si le raccourci a changé', () => {
  it('dit oui quand l’accélérateur change', () => {
    const before = withPttAccelerator('Alt+Space');
    const after = withPttAccelerator('Control+Shift+M');
    assert.equal(pushToTalkAcceleratorChanged(before, after), true);
    assert.equal(pushToTalkAcceleratorChanged(after, before), true);
  });

  it('dit non quand les deux réglages portent le même accélérateur', () => {
    assert.equal(
      pushToTalkAcceleratorChanged(withPttAccelerator('Alt+Space'), withPttAccelerator('Alt+Space')),
      false,
    );
  });

  it('dit non pour un changement qui n’est PAS le raccourci (aucun geste système inutile)', () => {
    const base = defaultSettings();
    assert.equal(pushToTalkAcceleratorChanged(base, base), false);

    const louder = { ...base, talk: { ...base.talk, vadThresholdDb: base.talk.vadThresholdDb - 6 } };
    assert.equal(pushToTalkAcceleratorChanged(base, louder), false);

    const bigger = { ...base, overlay: { ...base.overlay, scale: 'lg' as const } };
    assert.equal(pushToTalkAcceleratorChanged(base, bigger), false);
  });

  it('ne regarde QUE le raccourci push-to-talk (pas le niveau de bruit, pas le mode)', () => {
    const base = defaultSettings();
    const other = {
      ...base,
      talk: { ...base.talk, vadThresholdDb: -60, inputDeviceId: 'usb-mic', vadEnabled: true },
    };
    assert.equal(pushToTalkAcceleratorChanged(base, other), false);
  });
});

describe('câblage — libérer avant de réserver, publier une seule fois', () => {
  it('persist() ré-enregistre quand l’accélérateur a changé', () => {
    const persist = MAIN_SOURCE.slice(MAIN_SOURCE.indexOf('function persist('));
    const body = persist.slice(0, persist.indexOf('\n}\n'));
    assert.match(body, /pushToTalkAcceleratorChanged\(previousSettings, next\)/);
    assert.match(body, /registerPushToTalkShortcut\(\)/);
    // Le défaut : `persist` ne touchait jamais au raccourci.
    assert.ok(
      body.indexOf('pushToTalkAcceleratorChanged') < body.indexOf('registerPushToTalkShortcut()'),
      'la décision précède le ré-enregistrement',
    );
  });

  it('registerPushToTalkShortcut libère l’ancien accélérateur AVANT de réserver le nouveau', () => {
    const fn = MAIN_SOURCE.slice(MAIN_SOURCE.indexOf('function registerPushToTalkShortcut'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    const release = body.indexOf('releasePushToTalk()');
    const register = body.indexOf('registerPushToTalk(');
    assert.ok(release >= 0, 'releasePushToTalk() doit être appelé');
    assert.ok(register >= 0, 'registerPushToTalk doit être appelé');
    assert.ok(release < register, 'la libération précède la réservation');
  });

  it('le conflit de raccourci est publié une seule fois, dans registerPushToTalkShortcut', () => {
    const occurrences = MAIN_SOURCE.split('IPC.eventShortcutConflict').length - 1;
    assert.equal(occurrences, 1, 'un seul envoi (le doublon de bootstrap a été retiré)');
    const fn = MAIN_SOURCE.slice(MAIN_SOURCE.indexOf('function registerPushToTalkShortcut'));
    assert.match(fn.slice(0, fn.indexOf('\n}\n')), /IPC\.eventShortcutConflict/);
  });

  it('au démarrage, le raccourci est enregistré une seule fois (pas de double enregistrement)', () => {
    const calls = MAIN_SOURCE.split('registerPushToTalkShortcut();').length - 1;
    // 1 appel dans bootstrap + 1 dans persist() = 2 occurrences du texte ; l'appel nu (`;` en fin de
    // ligne, sans condition) ne doit exister qu'une fois.
    const bare = MAIN_SOURCE.split('\n  registerPushToTalkShortcut();').length - 1;
    assert.equal(bare, 1, `un seul appel inconditionnel (trouvé ${bare})`);
    assert.equal(calls, 2, `bootstrap + persist attendus (trouvé ${calls})`);
  });

  it('`releasePushToTalk` = unregisterAll est sûr : ptt.ts est le SEUL à IMPORTER globalShortcut', () => {
    // On ne cherche pas le mot (il vit aussi dans la prose des commentaires) mais l'IMPORT réel.
    const IMPORT_GLOBAL_SHORTCUT = /import\s*\{[^}]*globalShortcut[^}]*\}\s*from\s*'electron'/;
    const importers: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = `${dir}/${entry}`;
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith('.ts') && !path.endsWith('ptt.ts')) {
          if (IMPORT_GLOBAL_SHORTCUT.test(readFileSync(path, 'utf8'))) importers.push(path);
        }
      }
    };
    walk(new URL('../src', import.meta.url).pathname);
    assert.deepEqual(importers, [], 'aucun autre module ne réserve de raccourci global');
    assert.match(PTT_SOURCE, IMPORT_GLOBAL_SHORTCUT);
    assert.match(PTT_SOURCE, /globalShortcut\.unregisterAll\(\)/);
  });
});
