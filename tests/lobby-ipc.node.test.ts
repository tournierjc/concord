/**
 * tests/lobby-ipc.node.test.ts — le contrat du lobby permanent, vérifié sur le fil.
 *
 * Trois choses étaient absentes et sont désormais garanties par le contrat (SPEC-001 A15) :
 *   1. `lan:event:discovery-status` — la santé de la découverte (`ok` / `mdns-down` / `offline`)
 *      remonte du main : c'est le geste qui remplace le `console.warn` silencieux (S1.4/S1.10) ;
 *   2. `lan:lobby:status` — le pied de lobby répond en CHAMPS STRUCTURÉS (`{ port, method,
 *      health }`), pas en phrase : le port est une mesure entière ou `null`, jamais un texte ;
 *   3. `lan:profile:open` — la prise du panneau profil (`feature/profile-lobby`) existe dans les
 *      deux sens (invoke + confirmation), charge utile vide, refusée sinon.
 *
 * Lancer : cd /work/lan-voice && npx tsx --test tests/lobby-ipc.node.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { IPC, guardPayload } from '../src/shell/ipc-contract.ts';

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/* --------------------------------------------- 1. l'événement de santé ---- */

test('eventDiscoveryStatus : les trois états passent, rien d’autre', () => {
  for (const health of ['ok', 'mdns-down', 'offline'] as const) {
    assert.equal(guardPayload('event', IPC.eventDiscoveryStatus, { health }).ok, true, health);
  }
  assert.equal(guardPayload('event', IPC.eventDiscoveryStatus, { health: 'KO' }).ok, false);
  assert.equal(guardPayload('event', IPC.eventDiscoveryStatus, { health: null }).ok, false);
  assert.equal(guardPayload('event', IPC.eventDiscoveryStatus, {}).ok, false, 'health obligatoire');
  assert.equal(
    guardPayload('event', IPC.eventDiscoveryStatus, { health: 'ok', detail: 'texte libre' }).ok,
    false,
    'aucun champ inconnu : la santé est un champ structuré, pas une phrase',
  );
});

/* --------------------------------------- 2. le pied de lobby structuré ---- */

test('lobbyStatusGet : charge utile vide exigée (le main mesure, le renderer ne propose rien)', () => {
  assert.equal(guardPayload('invoke', IPC.lobbyStatusGet, undefined).ok, true);
  assert.equal(guardPayload('invoke', IPC.lobbyStatusGet, {}).ok, true);
  assert.equal(guardPayload('invoke', IPC.lobbyStatusGet, { port: 47821 }).ok, false);
});

/* ------------------------------------------ 3. la prise du panneau profil ---- */

test('profileOpen : invoke vide, confirmation event vide, tout le reste refusé', () => {
  assert.equal(guardPayload('invoke', IPC.profileOpen, undefined).ok, true);
  // Comme les autres canaux vides (settingsGet, roomLeave…) : une charge utile non-nulle est
  // refusée ; `undefined`/`null` passent, et rien ne peut être transmis avec.
  assert.equal(guardPayload('invoke', IPC.profileOpen, { avatar: 'x.png' }).ok, false);
  assert.equal(guardPayload('invoke', IPC.profileOpen, null).ok, true);
  assert.equal(guardPayload('event', IPC.eventProfileOpen, {}).ok, true);
  assert.equal(guardPayload('event', IPC.eventProfileOpen, { panel: 'profil' }).ok, false);
});

/* ------------------------- 4. câblage des deux côtés (texte source, pas d’Electron) ---- */

test('le main câble la santé, la vue du pied et la prise profil', () => {
  const main = code(readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8'));
  assert.match(main, /sendEvent\(IPC\.eventDiscoveryStatus/, 'la santé part par l’événement du canon');
  assert.match(main, /\[IPC\.lobbyStatusGet\]: \(\) => currentLobbyStatus\(\)/, 'la vue du pied est un handler');
  assert.match(main, /\[IPC\.profileOpen\]:/, 'la prise profil est enregistrée');
  // Le pied lit la MESURE du port, pas un réglage : le même chemin que `currentSignalingPort`.
  assert.match(main, /function currentLobbyStatus\(\)[\s\S]*?currentSignalingPort\(\)/, 'le port du pied vient de la mesure');
});

test('le bridge publie la santé aux deux moments qui comptent (échec et reprise)', () => {
  const bridge = code(readFileSync(new URL('../src/main/discovery-bridge.ts', import.meta.url), 'utf8'));
  assert.match(bridge, /setHealth\(hasNetwork\(\) \? 'mdns-down' : 'offline'\)/, 'échec du browse : l’état dépend du réseau');
  // Reprise : TOUT état de dégradation antérieur ('mdns-down' comme 'offline') est périmé quand
  // le browse réussit — le bandeau « hors-ligne » doit s'effacer sans redémarrage.
  assert.match(bridge, /if \(health !== 'ok'\) setHealth\(/, 'la reprise est annoncée sans intervention');
});

test('le preload expose les trois nouvelles prises', () => {
  const preload = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
  assert.match(preload, /IPC\.lobbyStatusGet/);
  assert.match(preload, /IPC\.profileOpen/);
  assert.match(preload, /IPC\.eventDiscoveryStatus/);
  assert.match(preload, /IPC\.eventProfileOpen/);
});

test('l’écran de lobby consomme la santé, le pied et la prise profil', () => {
  const app = code(readFileSync(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8'));
  assert.match(app, /onDiscoveryStatus/, 'la santé remontée pilote les bandeaux');
  assert.match(app, /getLobbyStatus/, 'le pied est lu, pas deviné');
  assert.match(app, /openProfile/, "l'identité passe par la prise profil");
  // Règle produit : plus AUCUNE création directe depuis le champ — elle passe par l'action résolue.
  assert.match(app, /resolveCreateRoomAction/, 'le clic « créer » est décidé par la règle pure');
  assert.doesNotMatch(
    app,
    /onClick=\{\(\) => onJoin\(draftName\.trim\(\), draftName\.trim\(\)\)\}/,
    'le bouton ne crée plus à l’aveugle, quel que soit le nom',
  );
});
