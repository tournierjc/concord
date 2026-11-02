/**
 * tests/room-auto-wiring.node.test.ts — le câblage du salon automatique à la reprise qui ne vit
 * PAS dans `room-recreate.ts` : la persistance de la mesure (`lastHosted`) dans le main, la garde
 * de l'UI, et la parité preload (2026-11-02).
 *
 * Le main réel (`index.ts`) n'est pas chargeable sous Node (import d'`electron`) : la chaîne
 * handler → mesure est vérifiée comme le fait déjà `tests/ducking-wiring.node.test.ts` — par
 * l'EXÉCUTION des pures impliquées (`parseSettings`/`applySettingsPatch` pour l'écriture et
 * l'effacement de la mesure, `shouldAutoRecreateOnStartup`/`autoRecreateCreateAction` pour la
 * décision) plus le CÂBLAGE lu à la source (les sites qui écrivent, effacent, arment et publient
 * sont nommés et localisés dans `src/main/index.ts`, la sonde de test du lobby
 * (`tests/main-lobby-probe.ts`) jouant déjà les handlers IPC réels).
 *
 * Exigence → assertion :
 *  - « écrit quand un salon est créé/hébergé avec succès » : le handler `roomJoin` appelle
 *    `persistLastHostedRoom({name, capacity})` SEULEMENT sous `signalingLink?.role === 'host'` —
 *    un client ne mesure rien ; la capacité mesurée est la constante du maillage ;
 *  - « effacé au départ VOLONTAIRE, conservé à la coupure » : seul le handler `roomLeave` appelle
 *    `persistLastHostedRoom(null)` ; `stopSignalingLink` (éjection, reconnexion, fermeture) n'y
 *    apparaît pas — la mesure survit à un départ subi ;
 *  - « l'écriture passe par le même magasin » : `persistLastHostedRoom` compose via `persist` ;
 *    `parseSettings` valide ce qui est écrit (mesure hors bornes ⇒ refusée) et
 *    `applySettingsPatch` refuse le patch du renderer qui nommerait la mesure ;
 *  - « armé une fois, au bon endroit » : `bootstrap` appelle `createRoomRecreator` puis `arm()`
 *    UNE fois, après `discovery.start()`, sur l'horloge injectée `systemTimers` ; `will-quit`
 *    désarme ;
 *  - « l'UI ne superpose rien » : la ligne du lobby est une région `aria-live` rendue par
 *    `RoomList` (montée sur l'écran des salons seul), avec les clés `room.auto.*`, jamais un modal ;
 *  - « parité preload » : les deux méthodes du pont existent et consomment les canaux du canon.
 *
 * Lancer : npx tsx --test tests/room-auto-wiring.node.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { IPC } from '../src/shell/ipc-contract';
import {
  MAX_ROOM_PARTICIPANTS,
  applySettingsPatch,
  defaultSettings,
  parseSettings,
  serializeSettings,
} from '../src/shell/settings-schema';
import {
  RECREATE_STARTUP_DELAY_MS,
  autoRecreateCreateAction,
  shouldAutoRecreateOnStartup,
} from '../src/main/room-recreate';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MAIN = readFileSync(join(ROOT, 'src/main/index.ts'), 'utf8');
const APP_TSX = readFileSync(join(ROOT, 'src/renderer/App.tsx'), 'utf8');
const SETTINGS_TSX = readFileSync(join(ROOT, 'src/renderer/Settings.tsx'), 'utf8');
const PRELOAD = readFileSync(join(ROOT, 'src/preload/index.ts'), 'utf8');

/** Le code sans ses commentaires : une mention dans un commentaire n'est pas un appel. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
const MAIN_CODE = code(MAIN);

/* ------------------------------------------------------------------ */
/* La mesure écrite/effacée par le main — forme validée par le magasin  */
/* ------------------------------------------------------------------ */

describe('mesure lastHosted — ce que le main écrit est ce que le magasin valide', () => {
  it('la mesure dun salon hébergé (nom + capacité du maillage) survit au round-trip disque', () => {
    const written = {
      ...defaultSettings(),
      room: { auto: true, lastHosted: { name: 'Salon du soir', capacity: MAX_ROOM_PARTICIPANTS } },
    };
    const loaded = parseSettings(JSON.parse(serializeSettings(written)));
    assert.equal(loaded.ok, true);
    if (loaded.ok) {
      assert.deepEqual(loaded.value.room.lastHosted, { name: 'Salon du soir', capacity: 8 });
    }
  });

  it('effacer la mesure = `null`, et `null` est une valeur valide du magasin (pas une corruption)', () => {
    const cleared = { ...defaultSettings(), room: { auto: true, lastHosted: null } };
    const loaded = parseSettings(JSON.parse(serializeSettings(cleared)));
    assert.equal(loaded.ok, true);
    if (loaded.ok) assert.equal(loaded.value.room.lastHosted, null);
  });

  it('un nom hors borne écrit par un bug du main serait REFUSÉ au prochain chargement, pas arrondi', () => {
    const broken = { ...defaultSettings(), room: { auto: true, lastHosted: { name: 'x'.repeat(40), capacity: 8 } } };
    assert.equal(parseSettings(JSON.parse(serializeSettings(broken))).ok, false);
  });

  it('la mesure ne vient JAMAIS du renderer : le patch qui la nomme est refusé (rappel de garde)', () => {
    assert.equal(
      applySettingsPatch(defaultSettings(), { room: { auto: true, lastHosted: { name: 'Injecté', capacity: 8 } } }).ok,
      false,
    );
  });

  it('la décision de reprise relit la mesure telle que le magasin la rend', () => {
    // Mesure présente + option active ⇒ arme ; le geste est bloqué si un pair porte déjà le nom.
    assert.equal(shouldAutoRecreateOnStartup({ auto: true, lastHosted: { name: 'A', capacity: 8 } }), true);
    assert.equal(shouldAutoRecreateOnStartup({ auto: true, lastHosted: null }), false);
    assert.equal(autoRecreateCreateAction({ name: 'A' }, ['a']).kind, 'blocked');
  });
});

/* ------------------------------------------------------------------ */
/* Le câblage du main — où la mesure est écrite, effacée, armée         */
/* ------------------------------------------------------------------ */

describe('câblage main — les sites d’écriture de la mesure', () => {
  it('laide décriture des mesures existe et passe par `persist` (même magasin que les réglages)', () => {
    assert.match(MAIN_CODE, /function persistLastHostedRoom\(/);
    const helper = MAIN_CODE.slice(MAIN_CODE.indexOf('function persistLastHostedRoom('));
    assert.match(helper.slice(0, 500), /persist\(\s*\{\s*\.\.\.settings,\s*room:/);
  });

  it('le handler roomJoin écrit la mesure SOUS la garde hôte, avec la capacité du maillage', () => {
    assert.match(
      MAIN_CODE,
      /if \(signalingLink\?\.role === 'host'\) \{\s*persistLastHostedRoom\(\{ name: join\.name\.trim\(\), capacity: MAX_ROOM_PARTICIPANTS \}\);/,
      'la mesure est prise seulement quand CE poste est l’hôte du salon qui naît',
    );
  });

  it('le handler roomLeave efface la mesure (quitter = intention de ne pas reprendre)', () => {
    const leave = MAIN_CODE.slice(MAIN_CODE.indexOf(`[IPC.roomLeave]:`));
    assert.match(leave.slice(0, 900), /persistLastHostedRoom\(null\);/);
  });

  it('stopSignalingLink (départ SUBI : éjection, reconnexion, fermeture) efface TOUT SAUF la mesure', () => {
    const stop = MAIN_CODE.slice(MAIN_CODE.indexOf('function stopSignalingLink('));
    const body = stop.slice(0, stop.indexOf('\n}\n') + 3);
    assert.doesNotMatch(body, /persistLastHostedRoom/, 'un départ subi ne touche pas la reprise');
  });

  it('le geste automatique passe par le pont et le tuyau, pas une voie bis', () => {
    const gesture = MAIN_CODE.slice(MAIN_CODE.indexOf('async function hostRoomFromSettings('));
    const body = gesture.slice(0, gesture.indexOf('\n}\n') + 3);
    assert.match(body, /bridge\.join\(/, 'le même join que le flux manuel');
    assert.match(body, /startSignalingLink\(/, 'le même tuyau que le flux manuel');
    assert.match(body, /if \(roomActiveForUpdate\(\)\) return false;/, 'jamais pendant un salon');
    assert.match(body, /discovery\.list\(\)/, 'anti-doublon relu au geste');
  });

  it('bootstrap arme UNE fois, après la découverte, sur l’horloge injectée', () => {
    assert.equal(MAIN_CODE.match(/roomRecreator = createRoomRecreator\(/g)?.length, 1);
    assert.equal(MAIN_CODE.match(/roomRecreator\.arm\(\);/g)?.length, 1);
    assert.ok(
      MAIN_CODE.indexOf('discovery.start();') < MAIN_CODE.indexOf('roomRecreator = createRoomRecreator('),
      'la machine naît APRÈS le démarrage de la découverte (le registre doit être vivant à l’échéance)',
    );
    assert.match(MAIN_CODE, /roomRecreator = createRoomRecreator\(\{[\s\S]{0,800}?timers: systemTimers,/);
  });

  it('will-quit désarme la minuterie des 2 s', () => {
    assert.match(MAIN_CODE, /roomRecreator\?\.stop\(\);/);
  });

  it('la publication vise la fenêtre principale seule, comme les mises à jour', () => {
    const publish = MAIN_CODE.slice(MAIN_CODE.indexOf('function publishRecreateState('));
    assert.match(publish.slice(0, 300), /sendEvent\(IPC\.eventRoomRecreateState, state, 'main'\)/);
  });

  it('le handler de relecture rend linstantané de la machine (jamais un état inventé)', () => {
    assert.match(MAIN_CODE, /\[IPC\.roomRecreateStatusGet\]: \(\) =>/);
  });

  it('le délai est la constante documentée (2 s, MainTimers)', () => {
    assert.equal(RECREATE_STARTUP_DELAY_MS, 2000);
  });
});

/* ------------------------------------------------------------------ */
/* L'UI — une ligne sobre, jamais un modal, jamais pendant un salon     */
/* ------------------------------------------------------------------ */

describe('câblage lobby — la ligne sobre', () => {
  it('RoomList reçoit létat de la machine et le rend en région aria-live', () => {
    assert.match(APP_TSX, /recreate=\{recreateState\}/);
    assert.match(APP_TSX, /role='status' aria-live='polite'/);
  });

  it('la ligne nomme les clés room.auto.* (recreating + les raisons publiables)', () => {
    assert.match(APP_TSX, /t\('room\.auto\.recreating'/);
    assert.match(APP_TSX, /recreate\.reasonKey \?\? 'room\.auto\.failed\.create'/);
  });

  it('pas de modal ni de dialogue : aucune fenêtre au-dessus pour le recréage', () => {
    // La ligne vit dans `RoomList` (composant de l'écran des salons seul) — pas de `dialog`,
    // pas de `sheet` (le panneau réglages est la seule feuille de l'app).
    const roomList = APP_TSX.slice(APP_TSX.indexOf('export function RoomList('));
    assert.doesNotMatch(roomList.slice(0, 4000), /dialog|sheet/);
  });

  it('linterrupteur des réglages ne patche QUE l’option (jamais la mesure)', () => {
    assert.match(SETTINGS_TSX, /checked=\{settings\.room\.auto\}/);
    assert.match(SETTINGS_TSX, /onChange\(\{ room: \{ auto: event\.target\.checked \} \}\)/);
    assert.doesNotMatch(SETTINGS_TSX, /room: \{[^}]*lastHosted/, 'le renderer nécrit jamais lastHosted');
    assert.match(SETTINGS_TSX, /t\('room\.auto\.settings'\)/);
  });
});

/* ------------------------------------------------------------------ */
/* La parité du pont — les deux méthodes consomment les canaux du canon */
/* ------------------------------------------------------------------ */

describe('câblage preload — salon automatique', () => {
  it('le preload invoque le canal de relecture et sabonne à l’événement', () => {
    assert.ok(PRELOAD.includes(`IPC.${keyOf(IPC.roomRecreateStatusGet)}`));
    assert.ok(PRELOAD.includes(`IPC.${keyOf(IPC.eventRoomRecreateState)}`));
  });

  it('le renderer consomme les deux méthodes du pont', () => {
    // L'appel est chaîné sur `api` (`void api\n  .getRoomRecreateStatus()`) — la vérification
    // porte sur le nom de la méthode, la liaison `api.` est à distance d'un saut de ligne.
    assert.match(APP_TSX, /api\s*\n?\s*\.getRoomRecreateStatus\(\)/);
    assert.match(APP_TSX, /api\.onRoomRecreateState\(/);
  });
});

function keyOf(channel: string): string {
  const entry = Object.entries(IPC).find(([, value]) => value === channel);
  assert.notEqual(entry, undefined, `canal inconnu : ${channel}`);
  return entry?.[0] ?? '';
}
