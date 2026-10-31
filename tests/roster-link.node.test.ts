/**
 * tests/roster-link.node.test.ts — la liste des participants suit enfin la signalisation.
 *
 * Ce que ce fichier défend : ce que l'hôte reçoit du tuyau (`peer-joined`, `peer-left`) arrive dans
 * l'annuaire que l'interface affiche. Avant, `RoomBridge.addParticipant` n'était appelé par
 * personne : la liste ne contenait jamais que soi-même, la garde « salon plein » (8) était
 * inatteignable et l'overlay n'avait personne à dessiner.
 *
 * Les tests passent par un VRAI `RoomBridge` (pas une doublure) : c'est la chaîne complète
 * message → annuaire → événements `lan:event:*` qui est vérifiée, pas une maquette.
 *
 * Lancer : cd /work/lan-voice && npx tsx --test tests/roster-link.node.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { IPC, IPC_MAX_PARTICIPANTS, type SignalIn } from '../src/shell/ipc-contract.ts';
import { RoomBridge, type BridgeEvent } from '../src/main/room-bridge.ts';
import { applySignalToRoster } from '../src/main/roster-link.ts';

const SELF_SIGNALING_ID = '7';

function createHarness(): { bridge: RoomBridge; events: BridgeEvent[] } {
  const events: BridgeEvent[] = [];
  const bridge = new RoomBridge((event) => {
    events.push(event);
  });
  return { bridge, events };
}

function joined(peerId: string, name: string): SignalIn {
  return { kind: 'peer-joined', peerId, name };
}

function apply(
  bridge: RoomBridge,
  message: SignalIn,
  selfId: string | null = SELF_SIGNALING_ID,
): boolean {
  return applySignalToRoster(bridge, message, selfId);
}

describe('roster-link — un pair qui arrive entre dans la liste', () => {
  it('peer-joined ajoute le participant, avec son nom', () => {
    const { bridge, events } = createHarness();
    bridge.join({ roomId: 'r1', name: 'Salon' }, 'Marion');
    events.length = 0;

    assert.equal(apply(bridge, joined('12', 'Léo')), true);

    const participants = bridge.getParticipants();
    const peer = participants.find((participant) => participant.id === '12');
    assert.ok(peer, 'le pair doit être dans la liste');
    assert.equal(peer.name, 'Léo');
    assert.equal(peer.gain, 1);
    // Présence = dans le salon. On n'affirme ni mute ni déafen : le fil ne les transporte pas.
    assert.equal(peer.muted, false);
    assert.equal(peer.deafened, false);
    assert.equal(peer.connection, 'connected');
    // Le compte du salon suit : c'est lui qui débloque la garde « 8 participants ».
    assert.equal(bridge.getRoomState().participantCount, 2);
    assert.ok(events.some((event) => event.channel === IPC.eventParticipants));
  });

  it('un peer-joined rejoué ne change rien (le fil peut répéter un hello)', () => {
    const { bridge, events } = createHarness();
    bridge.join({ roomId: 'r1', name: 'Salon' }, 'Marion');

    assert.equal(apply(bridge, joined('12', 'Léo')), true);
    events.length = 0;
    assert.equal(apply(bridge, joined('12', 'Léo')), false, 'aucun changement');
    assert.equal(bridge.getParticipants().length, 2);
    assert.deepEqual(events, [], 'aucun événement pour une liste inchangée');
  });

  it('un pair sans nom occupe une ligne avec son identifiant (jamais une ligne vide)', () => {
    const { bridge } = createHarness();
    bridge.join({ roomId: 'r1', name: 'Salon' }, 'Marion');

    apply(bridge, joined('12', '   '));
    const peer = bridge.getParticipants().find((participant) => participant.id === '12');
    assert.ok(peer);
    assert.equal(peer.name, '12');
  });

  it('notre propre connexion (hôte qui rejoint son salon) n’est pas ajoutée en double', () => {
    const { bridge } = createHarness();
    bridge.join({ roomId: 'r1', name: 'Salon' }, 'Marion');

    // L'hôte se connecte à son propre salon : le serveur lui attribue un identifiant, et un
    // `peer-joined` peut désigner sa propre connexion. Sans filtre : deux lignes pour une personne.
    assert.equal(apply(bridge, joined(SELF_SIGNALING_ID, 'Marion')), false);
    assert.equal(bridge.getParticipants().length, 1);
    assert.equal(bridge.getRoomState().participantCount, 1);
  });

  it('sans identifiant local connu, aucun filtre : le pair est ajouté', () => {
    const { bridge } = createHarness();
    bridge.join({ roomId: 'r1', name: 'Salon' }, 'Marion');

    assert.equal(apply(bridge, joined(SELF_SIGNALING_ID, 'Marion'), null), true);
    assert.equal(bridge.getParticipants().length, 2);
  });
});

describe('roster-link — un pair qui part quitte la liste', () => {
  it('peer-left retire le participant et décrémente le compte', () => {
    const { bridge, events } = createHarness();
    bridge.join({ roomId: 'r1', name: 'Salon' }, 'Marion');
    apply(bridge, joined('12', 'Léo'));
    apply(bridge, joined('13', 'Sacha'));
    assert.equal(bridge.getParticipants().length, 3);
    events.length = 0;

    assert.equal(apply(bridge, { kind: 'peer-left', peerId: '12' }), true);
    assert.deepEqual(
      bridge.getParticipants().map((participant) => participant.id),
      ['self', '13'],
    );
    assert.equal(bridge.getRoomState().participantCount, 2);
    assert.ok(events.some((event) => event.channel === IPC.eventParticipants));
  });

  it('un départ inconnu ne change rien et ne retire pas le participant local', () => {
    const { bridge } = createHarness();
    bridge.join({ roomId: 'r1', name: 'Salon' }, 'Marion');

    assert.equal(apply(bridge, { kind: 'peer-left', peerId: 'inconnu' }), false);
    assert.equal(apply(bridge, { kind: 'peer-left', peerId: 'self' }), false);
    assert.equal(bridge.getParticipants().length, 1, 'on ne se retire pas de son propre salon');
  });

  it('après un départ, le pair peut revenir et reprendre sa place', () => {
    const { bridge } = createHarness();
    bridge.join({ roomId: 'r1', name: 'Salon' }, 'Marion');
    apply(bridge, joined('12', 'Léo'));
    apply(bridge, { kind: 'peer-left', peerId: '12' });
    assert.equal(bridge.getParticipants().length, 1);

    assert.equal(apply(bridge, joined('12', 'Léo')), true);
    assert.equal(bridge.getParticipants().length, 2);
  });

  it('le plafond de 8 est enfin atteignable : le 9ᵉ n’entre pas', () => {
    const { bridge } = createHarness();
    bridge.join({ roomId: 'r1', name: 'Salon' }, 'Marion');
    for (let index = 2; index <= IPC_MAX_PARTICIPANTS; index += 1) {
      assert.equal(apply(bridge, joined(`p${index}`, `Pair ${index}`)), true);
    }
    assert.equal(bridge.getRoomState().participantCount, IPC_MAX_PARTICIPANTS);

    // Avant ce câblage, `participantCount` restait à 1 : la garde « salon plein » d'un hôte était
    // inatteignable, donc le 9ᵉ participant était accepté par la signalisation.
    assert.equal(apply(bridge, joined('p9', 'Pair 9')), false);
    assert.equal(bridge.getParticipants().length, IPC_MAX_PARTICIPANTS);
  });
});

describe('roster-link — les autres messages ne touchent pas l’annuaire', () => {
  it('offer, answer, ice et link ne changent pas la liste', () => {
    const { bridge, events } = createHarness();
    bridge.join({ roomId: 'r1', name: 'Salon' }, 'Marion');
    events.length = 0;

    const others: SignalIn[] = [
      { kind: 'offer', from: '12', payload: { sdp: 'v=0' } },
      { kind: 'answer', from: '12', payload: { sdp: 'v=0' } },
      { kind: 'ice', from: '12', payload: { candidate: 'candidate:1 1 UDP 1 192.168.1.9 5000 typ host' } },
      { kind: 'link', state: 'connected', detail: null },
    ];
    for (const message of others) {
      assert.equal(apply(bridge, message), false, `${message.kind} ne touche pas l’annuaire`);
    }
    assert.equal(bridge.getParticipants().length, 1);
    assert.deepEqual(events, []);
  });
});
