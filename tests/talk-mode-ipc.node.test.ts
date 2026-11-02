/**
 * tests/talk-mode-ipc.node.test.ts — le sélecteur PTT/VAD a un chemin (fix 0.4.2, 2026-11-02, C2).
 *
 * Le défaut mesuré : `talk.mode` valait `'ptt'` par défaut, le sélecteur de Réglages écrivait
 * les réglages… et `RoomBridge.setMode` n'avait AUCUN appelant : aucun canal IPC `talk.*`
 * n'existait. Un poste installé ne pouvait jamais passer en VAD — le halo « qui parle » était
 * mort par construction, pas par réglage.
 *
 * Ce fichier garde trois étages, sans Electron :
 *   1. LA GARDE du contrat : `guardPayload('invoke', talkSetMode, …)` refuse tout ce qui n'est
 *      pas `{ mode: 'ptt' | 'vad' }` (tiers inventé, clé en trop, chaîne vide, non-objet) ;
 *      `talkGetMode` est un canal à charge utile vide ;
 *   2. LES COMPTES : `talkSetMode`/`talkGetMode` sont bien en QUEUE de `INVOKE_CHANNELS`
 *      (aucun réordonnancement des canaux existants — le contrat est un accord, pas une liste) ;
 *   3. LE PONT : `RoomBridge.setMode('vad')` publie l'état de contrôle avec `mode: 'vad'`
 *      (le renderer lit, il ne déduit pas) ; la chaîne plane est couverte côté VAD par
 *      `micro-constraints.node.test.ts` (track.enabled === true).
 *
 * Lancer : npx tsx --test tests/talk-mode-ipc.node.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  INVOKE_CHANNELS,
  IPC,
  guardPayload,
  type TalkModeDto,
} from '../src/shell/ipc-contract.ts';
import { RoomBridge } from '../src/main/room-bridge.ts';

/* -------------------------------------------------------- 1. la garde ---- */

describe('garde talkSetMode — une clé, deux valeurs, rien d’autre', () => {
  it('les deux modes du contrat passent, et la valeur est rendue typée', () => {
    for (const mode of ['ptt', 'vad'] as const) {
      const guarded = guardPayload('invoke', IPC.talkSetMode, { mode });
      assert.equal(guarded.ok, true, `mode ${mode} accepté`);
      if (guarded.ok) {
        assert.deepEqual(guarded.value, { mode });
      }
    }
  });

  it('un troisième mode inventé est refusé', () => {
    const guarded = guardPayload('invoke', IPC.talkSetMode, { mode: 'squawk' });
    assert.equal(guarded.ok, false);
  });

  it('une clé en trop, une clé manquante, un mode non chaîne : refusés', () => {
    assert.equal(guardPayload('invoke', IPC.talkSetMode, { mode: 'vad', host: 'evil' }).ok, false);
    assert.equal(guardPayload('invoke', IPC.talkSetMode, {}).ok, false);
    assert.equal(guardPayload('invoke', IPC.talkSetMode, { mode: 42 }).ok, false);
    assert.equal(guardPayload('invoke', IPC.talkSetMode, { mode: '' }).ok, false);
    assert.equal(guardPayload('invoke', IPC.talkSetMode, 'vad').ok, false);
    assert.equal(guardPayload('invoke', IPC.talkSetMode, null).ok, false);
  });
});

describe('garde talkGetMode — charge utile vide (le renderer ne choisit rien)', () => {
  it('undefined passe (comme lobbyStatusGet)', () => {
    const guarded = guardPayload('invoke', IPC.talkGetMode, undefined);
    assert.equal(guarded.ok, true);
  });

  it('une charge utile non vide est refusée : la lecture ne se pilote pas depuis la page', () => {
    assert.equal(guardPayload('invoke', IPC.talkGetMode, { mode: 'vad' }).ok, false);
  });
});

/* -------------------------------------------------------- 2. les comptes ---- */

describe('INVOKE_CHANNELS — talkSetMode/talkGetMode en queue, jamais triés', () => {
  it('les deux canaux existent et ferment la liste', () => {
    assert.equal(INVOKE_CHANNELS[INVOKE_CHANNELS.length - 2], IPC.talkSetMode);
    assert.equal(INVOKE_CHANNELS[INVOKE_CHANNELS.length - 1], IPC.talkGetMode);
  });

  it('aucun canal existant n’a changé de position (préfixe stable)', () => {
    // Les 20 canaux d'avant la correction, dans l'ordre d'origine.
    const prefix = [
      IPC.settingsGet, IPC.settingsSet, IPC.settingsOpen, IPC.profileOpen,
      IPC.lobbyStatusGet, IPC.roomJoin, IPC.roomLeave, IPC.roomsDiscover,
      IPC.controlSetMute, IPC.controlSetDeafen, IPC.controlSetPushToTalk, IPC.controlSetGain,
      IPC.overlaySet, IPC.speakingSet, IPC.signalSend,
      IPC.avatarChoose, IPC.avatarGetImage, IPC.duckingApply,
      IPC.updateCheckNow, IPC.updateInstallNow,
    ];
    assert.deepEqual(INVOKE_CHANNELS.slice(0, prefix.length), prefix);
  });
});

/* -------------------------------------------------------- 3. le pont ---- */

describe('RoomBridge.setMode — le mode publié vient du pont, pas du renderer', () => {
  function bridge(): RoomBridge {
    return new RoomBridge(() => undefined);
  }

  it('setMode(« vad ») rend et publie l’état de contrôle avec mode: « vad »', () => {
    const events: unknown[] = [];
    const roomBridge = new RoomBridge((event) => events.push(event));
    const state = roomBridge.setMode('vad');
    assert.equal(state.mode, 'vad');
    // L'état de contrôle part bien par l'événement canon (le renderer l'écoute, ne le déduit pas).
    const controlEvent = events.find(
      (event) => typeof event === 'object' && event !== null
        && 'channel' in event && event.channel === IPC.eventControlState,
    );
    assert.ok(controlEvent !== undefined, 'un événement control-state a été publié');
  });

  it('setMode est idempotent côté valeur : redire le même mode ne corrompt rien', () => {
    const roomBridge = bridge();
    const first = roomBridge.setMode('ptt');
    const second = roomBridge.setMode('ptt');
    assert.deepEqual(first, second);
    assert.equal(second.mode satisfies TalkModeDto, 'ptt');
  });
});
