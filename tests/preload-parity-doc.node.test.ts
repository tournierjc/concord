/**
 * tests/preload-parity-doc.node.test.ts — la parité contrat ↔ preload est DÉCRITE, donc vérifiée.
 *
 * `src/preload/PARITE.md` annonçait « 17 canaux (10 invoke + 7 events) » et quatre écarts
 * (« canon non câblé : 4 events sur 7 », `eventSpeaking` mort, trois littéraux au lieu de `IPC.*`).
 * Ces écarts sont corrigés depuis (`room-bridge.ts` type son discriminant sur la VALEUR du canon,
 * `forwardBridgeEvent` compare les valeurs sans caster, `eventSpeaking` a été retiré du contrat au
 * profit de `eventSpeakingSet`), mais le fichier continuait de les présenter comme l'état courant :
 * un lecteur — humain ou agent — y lit des défauts qui n'existent plus.
 *
 * Une documentation de parité n'a de valeur que si elle est mesurée. Ce fichier fait le lien :
 * les comptes annoncés dans le document doivent être ceux du contrat, et chaque canal cité doit
 * exister. Un contrat qui bouge sans que le document suive casse ce test — c'est voulu.
 *
 * Lancer : cd /work/lan-voice && npx tsx --test tests/preload-parity-doc.node.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { EVENT_CHANNELS, INVOKE_CHANNELS, IPC } from '../src/shell/ipc-contract.ts';

const DOC = readFileSync(new URL('../src/preload/PARITE.md', import.meta.url), 'utf8');
const PRELOAD = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');

/** Le document est coupé en deux : l'état mesuré, puis l'historique du constat T8. */
function currentSection(): string {
  const start = DOC.indexOf('## État mesuré');
  const end = DOC.indexOf('## Historique');
  assert.notEqual(start, -1, 'la section « État mesuré » doit exister');
  assert.notEqual(end, -1, 'la section « Historique » doit exister');
  assert.ok(start < end, 'l’état mesuré précède l’historique');
  return DOC.slice(start, end);
}

test('les comptes annoncés sont ceux du contrat', () => {
  const section = currentSection();
  const total = INVOKE_CHANNELS.length + EVENT_CHANNELS.length;
  assert.equal(total, 28, `canaux du contrat : ${total}`);
  assert.equal(INVOKE_CHANNELS.length, 17);
  assert.equal(EVENT_CHANNELS.length, 11);
  assert.match(section, new RegExp(`${total} canaux`));
  assert.match(section, new RegExp(`${INVOKE_CHANNELS.length} invoke`));
  assert.match(section, new RegExp(`${EVENT_CHANNELS.length} événements`));
});

test('chaque canal cité par l’état mesuré existe dans le contrat', () => {
  const section = currentSection();
  const cited: string[] = [];
  for (const match of section.matchAll(/`([a-z][A-Za-z]+)`/g)) {
    const name = match[1];
    if (name !== undefined && name in IPC) cited.push(name);
  }
  assert.ok(cited.length >= 20, `canaux cités : ${cited.length}`);
  for (const name of cited) {
    assert.equal(typeof IPC[name as keyof typeof IPC], 'string', `${name} doit être un canal du canon`);
  }
});

test('le preload s’abonne à TOUS les événements du contrat', () => {
  const subscribed = EVENT_CHANNELS.filter((channel) => PRELOAD.includes(`IPC.${keyOf(channel)}`));
  assert.equal(
    subscribed.length,
    EVENT_CHANNELS.length,
    'chaque événement du canon doit être consommé par le preload',
  );
});

function keyOf(channel: string): string {
  const entry = Object.entries(IPC).find(([, value]) => value === channel);
  assert.notEqual(entry, undefined, `canal inconnu : ${channel}`);
  return entry?.[0] ?? '';
}

test('les écarts corrigés ne sont plus présentés comme l’état courant', () => {
  const section = currentSection();
  // Les formulations du constat d'alors ne doivent pas décrire l'état d'aujourd'hui.
  assert.doesNotMatch(section, /ABSENT/);
  assert.doesNotMatch(section, /canon non câblé/i);
  assert.doesNotMatch(section, /17 canaux/);
  // Le fichier dit explicitement ce qui est corrigé, et conserve l'ancien constat en historique.
  assert.match(section, /corrigés/i);
  assert.match(DOC.slice(DOC.indexOf('## Historique')), /constat T8/);
});
