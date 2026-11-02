/**
 * tests/peer-id-collision.node.test.ts — les pairs média ne sont pas nommés par le salon (2026-11-02).
 *
 * Capture JC (0.4.7) : dans le salon, la ligne d'un pair média affiche « gf » — le NOM DU
 * SALON — au lieu du pseudo de la personne. Deux lignes de participants coexistent (roster de
 * signalisation, puis table des pairs média) ; le nom affiché pour un pair média vient
 * exclusivement de `peer-joined` (transport `name`), JAMAIS d'un rapprochement sur le nom du
 * salon — et un pair dont le nom n'est jamais arrivé s'affiche sous son `peerId`, pas sous un
 * nom emprunté. Ces tests verrouillent la règle avec des id en collision nominative : même
 * nom que le salon, même nom entre pairs — les lignes ne se confondent pas.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createMesh, type Mesh, type MeshPeerState } from '../src/engine/net/mesh.ts';
import { createMediaPlane } from '../src/engine/rtc/media-plane.ts';
import { installFakeDom } from './fake-rtc.ts';
import type { Timers } from '../src/engine/timers.ts';

const LOCAL_ID = 'gf';
const ROOM_NAME = 'gf';
const PEER_ID = 'krillin-1';

function silentTimers(): Timers {
  return { once: () => null, cancel: () => undefined };
}

/** Le maillage seul (sans page) : on observe les paliers et les messages émis. */
function meshAlone(): { mesh: Mesh; sent: unknown[]; states: { peerId: string; state: MeshPeerState }[] } {
  const sent: unknown[] = [];
  const states: { peerId: string; state: MeshPeerState }[] = [];
  const dom = installFakeDom();
  const plane = createMediaPlane({ localId: LOCAL_ID, timers: silentTimers() });
  const mesh = createMesh({
    localId: LOCAL_ID,
    plane,
    timers: silentTimers(),
    send: (message) => {
      sent.push(message);
    },
    onPeerState: (peerId, state) => {
      states.push({ peerId, state });
    },
  });
  // restore() est différé : Node:test nettoie l'objet global par test ; la fermeture explicite
  // du plan suffit (aucune écoute ambiante ne survit à `mesh.close()`/`plane.close()`).
  return { mesh, sent, states };
}

describe('id en collision nominative — le nom du salon ne nomme jamais un pair', () => {
  it('un pair dont l’id EST le nom du salon reste suivi sous SON id (et soi n’est jamais son propre pair)', async () => {
    const { mesh, states } = meshAlone();
    // LE cas de la capture : salon « gf ». Deux règles distinctes s’y tiennent :
    // 1) un pair nommé « gf » (nom du salon) EST suivi — le maillage ne connaît pas le salon ;
    await mesh.onSignal({ kind: 'peer-joined', peerId: 'peer-gf', name: ROOM_NAME } as never);
    assert.ok(states.some((entry) => entry.peerId === 'peer-gf'), 'le pair est suivi sous SON id');
    // 2) un message dont l’id est CELUI de soi est un message de soi : ignoré, jamais un pair.
    //    (Si la capture montre une ligne au nom du salon, ce n’est PAS cet id — c’est le nom
    //    d’un pair qui porte le même jeton que le salon, traité par la règle 1.)
    await mesh.onSignal({ kind: 'peer-joined', peerId: LOCAL_ID, name: ROOM_NAME } as never);
    assert.equal(states.some((entry) => entry.peerId === LOCAL_ID), false,
      'le maillage ne crée jamais un lien avec soi-même');
    mesh.close();
  });

  it('deux pairs homonymes restent DEUX lignes distinctes (clé = id, jamais le nom)', async () => {
    const { mesh, states } = meshAlone();
    await mesh.onSignal({ kind: 'peer-joined', peerId: 'p-1', name: 'krillin' } as never);
    await mesh.onSignal({ kind: 'peer-joined', peerId: 'p-2', name: 'krillin' } as never);
    const seen = new Set(states.map((entry) => entry.peerId));
    assert.ok(seen.has('p-1') && seen.has('p-2'), 'les deux id sont suivis séparément');
    assert.equal(mesh.peers().length, 2, 'deux liens, pas un seul écrasé par le nom partagé');
    mesh.close();
  });

  it('le nom du pair vient du message, pas du salon : un `name` absent ne devient jamais le nom du salon', async () => {
    const { mesh, sent } = meshAlone();
    // Le maillage ne réécrit JAMAIS un nom : il ne connaît même pas le nom du salon.
    await mesh.onSignal({ kind: 'peer-joined', peerId: PEER_ID, name: '' } as never);
    for (const message of sent) {
      assert.doesNotMatch(JSON.stringify(message), new RegExp(ROOM_NAME),
        'le nom du salon ne saurait voyager dans un message média (le maillage l’ignore)');
    }
    mesh.close();
  });
});
