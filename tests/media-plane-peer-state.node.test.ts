/**
 * tests/media-plane-peer-state.node.test.ts — défaut (b) : l'état de connexion ICE
 * porte ENFIN son pair.
 *
 * Le contrat gelé `onStateChange({ connectionState })` ne dit PAS de quel pair vient
 * le changement — c'est le bug : l'appelant appliquait l'état à tous les pairs
 * « connecting ». La réparation est le champ ADDITIONNEL `onPeerConnectionState
 * (peerId, state)` de `MediaPlaneOptions`, émis depuis `ensurePeer().pc
 * .onconnectionstatechange` avec le `remoteId` pour lequel la connexion a été créée.
 *
 * Ce fichier mesure que :
 *   • l'événement nominatif arrive avec le BON pair, même état, même moment ;
 *   • l'ancien `onStateChange` continue d'être émis (contrat gelé — pas de régression) ;
 *   • un pair échoué n'émet RIEN pour les autres : seule la connexion qui change parle.
 */

import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createMediaPlane } from '../src/engine/rtc/media-plane.ts'
import { NO_TIMERS } from '../src/engine/timers.ts'
import {
  FakePeerConnection,
  installFakeDom,
  type FakeDom,
} from './fake-rtc.ts'

/** Laisse tourner les microtâches (pas de timer ici : ramassage `complete` par défaut). */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

describe('défaut (b) — onPeerConnectionState porte l’identité du pair', () => {
  let dom: FakeDom
  let restore: (() => void) | null = null

  beforeEach(() => {
    dom = installFakeDom()
    restore = dom.restore
  })

  afterEach(() => {
    restore?.()
    restore = null
  })

  it('deux pairs, un seul échec : l’événement nominatif ne nomme QUE le pair qui tombe', async () => {
    const named: Array<{ peerId: string; state: string }> = []
    const globalStates: string[] = []
    const plane = createMediaPlane({
      localId: 'a',
      timers: NO_TIMERS,
      onStateChange: ({ connectionState }) => {
        globalStates.push(String(connectionState))
      },
      onPeerConnectionState: (peerId, state) => {
        named.push({ peerId, state: String(state) })
      },
    })
    await plane.attach('b')
    await plane.attach('c')
    await flushMicrotasks()

    assert.equal(FakePeerConnection.instances.length, 2, 'une RTCPeerConnection par pair')
    const peerB = dom.peerAt(0)
    const peerC = dom.peerAt(1)

    peerB.fireConnectionState('connecting')
    peerB.fireConnectionState('connected')
    peerC.fireConnectionState('failed')

    assert.deepEqual(
      named,
      [
        { peerId: 'b', state: 'connecting' },
        { peerId: 'b', state: 'connected' },
        { peerId: 'c', state: 'failed' },
      ],
      'chaque événement porte le pair de la connexion qui a changé — pas le premier, pas tous',
    )
    // Contrat GELÉ : `onStateChange` continue d'être émis, sans identité, à chaque
    // changement — la réparation est additive, elle ne remplace rien.
    assert.deepEqual(
      globalStates,
      ['connecting', 'connected', 'failed'],
      'onStateChange nu est toujours émis (contrat gelé, non cassé)',
    )
    // `failed` de c n'a émis AUCUN événement pour b : un pair qui échoue ne fait
    // plus tomber personne d'autre.
    assert.equal(
      named.filter((entry) => entry.peerId === 'c').length,
      1,
      'le pair c n’a émis que SON échec',
    )
    plane.close()
  })

  it('sans le nouveau champ, le plan tourne toujours (option ADDITIONNELLE, optionnelle)', async () => {
    // Le contrat est ADDITIF : un appelant qui n'a pas encore migré (sœur de merge)
    // ne doit pas casser. `onPeerConnectionState` absent ⇒ aucun appel, aucun crash.
    const globalStates: string[] = []
    const plane = createMediaPlane({
      localId: 'a',
      timers: NO_TIMERS,
      onStateChange: ({ connectionState }) => {
        globalStates.push(String(connectionState))
      },
    })
    await plane.attach('b')
    await flushMicrotasks()
    dom.peerAt(0).fireConnectionState('disconnected')
    assert.deepEqual(globalStates, ['disconnected'], 'l’ancien chemin vit toujours')
    plane.close()
  })
})
