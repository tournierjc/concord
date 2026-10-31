/**
 * tests/audio-sink.test.ts — T16b : le HAUT-PARLEUR, un `<audio>` par pair distant.
 *
 * Aucun navigateur : le DOM est un faux document explicite (on compte les nœuds ajoutés, retirés,
 * les attributs posés). Ce qui est vérifié ici est exactement ce que l'écran promet :
 *   • l'élément existe AVANT le flux (`ensure` au `peer-joined`) ;
 *   • `srcObject` est branché à l'arrivée du flux, et remis à `null` au départ du pair ;
 *   • l'élément quitte le document quand le pair s'en va — pas de son fantôme.
 *
 * Lancer : cd /work/lan-voice && npx tsx --test tests/audio-sink.test.ts
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createAudioSinkRegistry,
  documentSinkHost,
  type SinkElement,
  type SinkHost,
} from '../src/renderer/audio-sink.ts';

interface FakeNode extends SinkElement {
  attrs: Record<string, string>;
  removed: boolean;
  plays: number;
  playRejects: boolean;
}

function fakeHost(): { host: SinkHost; nodes: FakeNode[]; created: () => FakeNode[] } {
  const nodes: FakeNode[] = [];
  const host: SinkHost = {
    createElement(tagName: string): FakeNode {
      assert.equal(tagName, 'audio', 'seul un <audio> est créé');
      const node: FakeNode = {
        srcObject: null,
        autoplay: false,
        attrs: {},
        removed: false,
        plays: 0,
        playRejects: false,
        setAttribute(name: string, value: string): void {
          node.attrs[name] = value;
        },
        play(): Promise<void> {
          node.plays += 1;
          return node.playRejects
            ? Promise.reject(new Error('autoplay bloqué'))
            : Promise.resolve();
        },
        remove(): void {
          node.removed = true;
        },
      };
      nodes.push(node);
      return node;
    },
    append(): void {
      /* le tableau `nodes` suffit : un élément ajouté est un élément suivi */
    },
    remove(): void {
      /* idem */
    },
  };
  return { host, nodes, created: () => nodes.filter((node) => !node.removed) };
}

test('ensure crée un <audio autoPlay> sans flux, avant tout événement', () => {
  const { host, nodes } = fakeHost();
  const registry = createAudioSinkRegistry(host);
  const sink = registry.ensure('p2');
  assert.equal(nodes.length, 1);
  assert.equal(sink.element.autoplay, true);
  assert.equal(sink.element.srcObject, null);
  assert.equal(sink.hasStream, false);
  assert.equal(nodes[0]?.attrs['data-audio-peer'], 'p2');
  assert.equal(nodes[0]?.attrs['aria-hidden'], 'true');
  assert.equal(nodes[0]?.plays, 0, 'aucune lecture n’est tentée sans flux');
});

test('ensure est idempotent : un seul élément par pair', () => {
  const { host, nodes } = fakeHost();
  const registry = createAudioSinkRegistry(host);
  const first = registry.ensure('p2');
  const second = registry.ensure('p2');
  assert.equal(nodes.length, 1);
  assert.equal(first.element, second.element);
});

test('attach branche srcObject et lance la lecture', () => {
  const { host, nodes } = fakeHost();
  const registry = createAudioSinkRegistry(host);
  registry.ensure('p2');
  const stream = { id: 'flux-distant' };
  const sink = registry.attach('p2', stream);
  assert.equal(sink.element.srcObject, stream);
  assert.equal(sink.hasStream, true);
  assert.equal(nodes[0]?.plays, 1);
  assert.equal(registry.list().length, 1);
});

test('attach sans ensure préalable crée l’élément (jamais de flux orphelin)', () => {
  const { host, nodes } = fakeHost();
  const registry = createAudioSinkRegistry(host);
  const sink = registry.attach('p3', { id: 'flux' });
  assert.equal(nodes.length, 1);
  assert.equal(sink.hasStream, true);
  assert.equal(registry.get('p3'), sink);
});

test('remove détache le flux et retire l’élément du document', () => {
  const { host, nodes } = fakeHost();
  const registry = createAudioSinkRegistry(host);
  registry.attach('p2', { id: 'flux' });
  const element = nodes[0];
  registry.remove('p2');
  assert.equal(element?.srcObject, null, 'aucun flux mort ne reste branché');
  assert.equal(element?.removed, true, 'l’élément quitte le document');
  assert.equal(registry.get('p2'), undefined);
  assert.equal(registry.list().length, 0);
});

test('clear détruit tous les éléments (départ du salon)', () => {
  const { host, nodes } = fakeHost();
  const registry = createAudioSinkRegistry(host);
  registry.ensure('p2');
  registry.attach('p3', { id: 'flux' });
  assert.equal(nodes.length, 2);
  registry.clear();
  assert.equal(registry.list().length, 0);
  assert.ok(nodes.every((node) => node.removed && node.srcObject === null));
});

test('une lecture refusée (autoplay) ne lève pas et garde le flux branché', () => {
  const { host, nodes } = fakeHost();
  nodes.push();
  const registry = createAudioSinkRegistry(host);
  const sink = registry.ensure('p4');
  const node = nodes[0];
  if (node !== undefined) node.playRejects = true;
  sink.attach({ id: 'flux' });
  assert.equal(sink.hasStream, true);
  assert.equal(sink.element.srcObject !== null, true);
});

test('documentSinkHost délègue création, ajout et retrait au document fourni', () => {
  const appended: unknown[] = [];
  const removedNodes: unknown[] = [];
  const doc = {
    createElement(tagName: string): SinkElement {
      assert.equal(tagName, 'audio');
      return { srcObject: null, autoplay: false };
    },
    body: {
      appendChild(node: never): unknown {
        appended.push(node);
        return node;
      },
      removeChild(node: never): unknown {
        removedNodes.push(node);
        return node;
      },
    },
  };
  const registry = createAudioSinkRegistry(documentSinkHost(doc));
  registry.ensure('p5');
  assert.equal(appended.length, 1);
  registry.remove('p5');
  assert.equal(removedNodes.length, 1);
});
