/**
 * tests/room-bridge.node.test.ts — l'annuaire de salon du main (`src/main/room-bridge.ts`).
 *
 * Ce module n'avait AUCUN test jusqu'ici, alors que c'est lui qui tient l'état que l'interface
 * affiche (nom du salon, liste des participants, mute/deafen/PTT, gain local) et qui émet les
 * événements IPC. Trois choses y étaient cassées sans que rien ne rougisse :
 *   1. `payload.name` servait à la fois de nom de salon et de nom de participant — l'en-tête du
 *      salon affichait donc le pseudo de la personne qui venait de le rejoindre ;
 *   2. `addParticipant` n'avait aucun appelant (câblage, traité ailleurs) ;
 *   3. un événement émis avec le NOM de clé au lieu de la VALEUR du canon (`'eventRoomState'` au
 *      lieu de `'lan:event:room-state'`) était refusé par `guardPayload` et n'arrivait jamais au
 *      renderer — sans erreur visible. Les tests ci-dessous figent les trois.
 *
 * Module pur (aucun import d'`electron`) : lançable par `node --test`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { IPC, IPC_MAX_PARTICIPANTS, type ParticipantDto } from '../src/shell/ipc-contract.ts';
import { RoomBridge, type BridgeEvent } from '../src/main/room-bridge.ts';

function createHarness(): { bridge: RoomBridge; events: BridgeEvent[] } {
  const events: BridgeEvent[] = [];
  const bridge = new RoomBridge((event) => {
    events.push(event);
  });
  return { bridge, events };
}

function remote(id: string, name = id): ParticipantDto {
  return { id, name, muted: false, deafened: false, gain: 1, connection: 'connected' };
}

describe('room-bridge — identité du salon et du participant', () => {
  it('le nom du salon vient de `payload.name`, pas du pseudo', () => {
    const { bridge } = createHarness();
    const state = bridge.join({ roomId: '192.168.1.24:47821', name: 'Salon cuisine' }, 'Marion');
    assert.equal(state.roomName, 'Salon cuisine');
    assert.equal(state.roomId, '192.168.1.24:47821');

    const self = bridge.getParticipants().find((participant) => participant.id === state.selfId);
    assert.ok(self);
    assert.equal(self.name, 'Marion');
  });

  it('un nom de salon vide retombe sur l’identifiant du salon (jamais un en-tête vide)', () => {
    const { bridge } = createHarness();
    const state = bridge.join({ roomId: 'bureau', name: '   ' }, 'Marion');
    assert.equal(state.roomName, 'bureau');
  });

  it('les blancs du nom de salon sont rognés', () => {
    const { bridge } = createHarness();
    const state = bridge.join({ roomId: 'salle', name: '  Salle  ' }, 'Marion');
    assert.equal(state.roomName, 'Salle');
  });
});

describe('room-bridge — événements : la VALEUR du canon, jamais le nom de clé', () => {
  it('join émet room-state, participants et control-state sur les canaux `lan:event:*`', () => {
    const { bridge, events } = createHarness();
    bridge.join({ roomId: 'r1', name: 'Salon' }, 'Marion');

    const channels = events.map((event) => event.channel);
    assert.ok(channels.includes(IPC.eventRoomState), `canaux : ${channels.join(', ')}`);
    assert.ok(channels.includes(IPC.eventParticipants));
    assert.ok(channels.includes(IPC.eventControlState));
    // Le bug historique : littéral 'eventRoomState' au lieu de 'lan:event:room-state'.
    for (const channel of channels) {
      assert.match(channel, /^lan:event:/, `canal hors canon : ${channel}`);
    }
  });

  it('leave émet un room-state qui rend le salon inactif', () => {
    const { bridge, events } = createHarness();
    bridge.join({ roomId: 'r1', name: 'Salon' }, 'Marion');
    events.length = 0;
    const state = bridge.leave();
    assert.equal(state.roomId, null);
    assert.equal(state.roomName, null);
    assert.equal(state.phase, 'idle');
    assert.equal(events.filter((event) => event.channel === IPC.eventRoomState).length, 1);
    assert.deepEqual(bridge.getParticipants(), []);
  });
});

describe('room-bridge — annuaire des participants', () => {
  it('addParticipant ajoute une fois et dédoublonne par identifiant', () => {
    const { bridge } = createHarness();
    bridge.join({ roomId: 'r1', name: 'Salon' }, 'Marion');
    bridge.addParticipant(remote('p2', 'Léo'));
    bridge.addParticipant(remote('p2', 'Léo'));
    const ids = bridge.getParticipants().map((participant) => participant.id);
    assert.deepEqual(ids, ['self', 'p2']);
  });

  it('le plafond de 8 participants est appliqué par le pont, pas seulement par l’UI', () => {
    const { bridge } = createHarness();
    bridge.join({ roomId: 'r1', name: 'Salon' }, 'Marion');
    for (let index = 2; index <= IPC_MAX_PARTICIPANTS; index += 1) {
      bridge.addParticipant(remote(`p${index}`));
    }
    assert.equal(bridge.getParticipants().length, IPC_MAX_PARTICIPANTS);
    bridge.addParticipant(remote('p9'));
    assert.equal(bridge.getParticipants().length, IPC_MAX_PARTICIPANTS);
    assert.equal(bridge.getRoomState().participantCount, IPC_MAX_PARTICIPANTS);
  });

  it('rejoindre un salon déjà plein est refusé avec une clé de message', () => {
    const { bridge } = createHarness();
    bridge.join({ roomId: 'r1', name: 'Salon' }, 'Marion');
    for (let index = 2; index <= IPC_MAX_PARTICIPANTS; index += 1) {
      bridge.addParticipant(remote(`p${index}`));
    }
    const state = bridge.join({ roomId: 'r2', name: 'Autre' }, 'Marion');
    assert.equal(state.notice, 'room.row.fullReason');
    // Le salon courant n'a pas été remplacé.
    assert.equal(state.roomId, 'r1');
    assert.equal(bridge.getParticipants().length, IPC_MAX_PARTICIPANTS);
  });
});

describe('room-bridge — contrôles locaux', () => {
  it('setGain modifie le gain du participant visé et ignore un identifiant inconnu', () => {
    const { bridge } = createHarness();
    bridge.join({ roomId: 'r1', name: 'Salon' }, 'Marion');
    bridge.addParticipant(remote('p2'));
    bridge.setGain('p2', 0.5);
    bridge.setGain('absent', 2);
    const gained = bridge.getParticipants().find((participant) => participant.id === 'p2');
    assert.ok(gained);
    assert.equal(gained.gain, 0.5);
    const self = bridge.getParticipants().find((participant) => participant.id === 'self');
    assert.ok(self);
    assert.equal(self.gain, 1, 'un identifiant inconnu ne doit rien modifier');
  });

  it('setMute, setDeafened et setPushToTalk se reflètent sur l’état du participant local', () => {
    const { bridge } = createHarness();
    bridge.join({ roomId: 'r1', name: 'Salon' }, 'Marion');
    bridge.setMute(true);
    assert.equal(bridge.getControlState().muted, true);
    bridge.setDeafened(true);
    assert.equal(bridge.getControlState().deafened, true);
    // Parler en PTT lève le mute local : c'est le sens même du push-to-talk.
    bridge.setPushToTalk(true);
    assert.equal(bridge.getControlState().muted, false);
    assert.equal(bridge.getControlState().pushToTalk, true);
    const self = bridge.getParticipants().find((participant) => participant.id === 'self');
    assert.ok(self);
    assert.equal(self.muted, false);
    assert.equal(self.deafened, true);
  });
});
