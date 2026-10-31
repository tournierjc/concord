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


/* ------------------------------------------------------------------ */
/* Retrait : UN seul geste, et un DOM qui refuse ne bloque pas les autres */
/* ------------------------------------------------------------------ */

/**
 * Faux DOM qui se comporte comme Chromium : `element.remove()` détache le nœud, et un `removeChild`
 * sur un nœud déjà détaché lève `NotFoundError`. C'est exactement ce que le faux hôte ci-dessus ne
 * reproduisait pas — d'où un défaut passé inaperçu : deux retraits à la suite.
 */
function chromiumLikeHost(): {
  host: SinkHost;
  nodes: FakeNode[];
  body: Set<SinkElement>;
  hostRemovals: () => number;
} {
  const nodes: FakeNode[] = [];
  const body = new Set<SinkElement>();
  let hostRemovals = 0;
  const host: SinkHost = {
    createElement(tagName: string): FakeNode {
      assert.equal(tagName, 'audio');
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
        remove(): void {
          node.removed = true;
          body.delete(node);
        },
      };
      nodes.push(node);
      return node;
    },
    append(node: SinkElement): void {
      body.add(node);
    },
    remove(node: SinkElement): void {
      hostRemovals += 1;
      if (!body.has(node)) {
        // Comme Chromium : retirer un nœud qui n'est plus enfant du parent lève.
        throw new Error("NotFoundError: Failed to execute 'removeChild' on 'Node'");
      }
      body.delete(node);
    },
  };
  return { host, nodes, body, hostRemovals: () => hostRemovals };
}

test('remove ne retire le nœud QU’UNE fois (pas de removeChild après element.remove)', () => {
  const harness = chromiumLikeHost();
  const registry = createAudioSinkRegistry(harness.host);
  registry.attach('p2', { id: 'flux' });

  registry.remove('p2');

  assert.equal(harness.nodes[0]?.removed, true, 'l’élément quitte le document');
  assert.equal(harness.body.size, 0, 'plus aucun enfant du body');
  assert.equal(
    harness.hostRemovals(),
    0,
    'l’hôte ne doit PAS être sollicité après un element.remove() réussi',
  );
});

test('clear() détruit toutes les sorties, même quand le retrait passe par l’hôte', () => {
  const harness = chromiumLikeHost();
  // Éléments sans `remove()` : le retrait passe alors par `host.remove` (chemin de `documentSinkHost`).
  const host: SinkHost = {
    createElement: () => ({ srcObject: null, autoplay: false }),
    append: (node) => harness.body.add(node),
    remove: harness.host.remove,
  };
  const registry = createAudioSinkRegistry(host);
  registry.ensure('p2');
  registry.ensure('p3');
  assert.equal(harness.body.size, 2);

  registry.clear();

  assert.equal(registry.list().length, 0, 'le registre est vidé');
  assert.equal(harness.body.size, 0, 'aucun enfant ne reste accroché');
  assert.equal(harness.hostRemovals(), 2, 'un retrait par élément, pas deux');
});

test('un DOM qui refuse un retrait n’interrompt pas clear() (le micro passe avant le DOM)', () => {
  const removed: string[] = [];
  const host: SinkHost = {
    createElement(tagName: string): SinkElement {
      const node: SinkElement = { srcObject: null, autoplay: false };
      Object.defineProperty(node, 'peer', { value: tagName, enumerable: false });
      return node;
    },
    append(): void {
      /* sans objet ici */
    },
    remove(node: SinkElement): void {
      const label = String((node as { peer?: string }).peer ?? '');
      removed.push(label);
      if (removed.length === 1) throw new Error('NotFoundError: removeChild');
    },
  };
  const registry = createAudioSinkRegistry(host);
  registry.ensure('a');
  registry.ensure('b');
  registry.ensure('c');

  assert.doesNotThrow(() => registry.clear(), 'la sortie de salon ne peut pas être annulée par le DOM');
  assert.equal(removed.length, 3, 'les trois retraits sont tentés');
  assert.equal(registry.list().length, 0, 'le registre est vidé quoi qu’il arrive');
});
