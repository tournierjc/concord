/**
 * tests/host-self-row-dedup.node.test.ts — la ligne média de soi compte une seule fois (2026-11-02, retour JC).
 *
 * Capture JC (0.4.10, salon « ok », 2/8) : la table des pairs média affiche DEUX lignes
 * « krillin » — le même pair vu deux fois. Cause mesurée : deux identités de signalisation
 * coexistent pour la MÊME personne. Côté pont (`RoomBridge`), le local est `SELF_ID` ; côté
 * tuyau (`local-signaling`), l'hôte qui se connecte à son propre salon reçoit un `p<n>` du
 * serveur, et l'hôte s'auto-annonce dans les `hello`/`join` des autres : ce double arrive au
 * renderer comme pair média et s'affiche en plus de la ligne du pont. La garde `applySignalToRoster`
 * (`selfSignalingId`) ne suffisait pas : elle ne filtre que l'id du NOUESTE, et le double
 * provenait du self-hello avec son propre id. Règle verrouillée ici, par la lecture du code
 * réel sur disque : tout message `peer-joined` dont l'id est celui ATTRIBUÉ À NOTRE connexion
 * (`link.selfId`, lu après le `hello`) doit être écarté par le pont — la ligne média de soi est
 * unique, toujours.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const INDEX = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const ROSTER = readFileSync(new URL('../src/main/roster-link.ts', import.meta.url), 'utf8');

describe('double de pair média — la ligne de soi est unique', () => {
  it('le filtre du pont compare au selfId du lien (double : self-hello avec son propre id)', () => {
    // `roster-link` reçoit `selfSignalingId` et l'utilise : un `peer-joined` porteur de NOTRE id
    // est un écho de nous-même — jamais une ligne de plus.
    assert.match(ROSTER, /selfSignalingId\s*!==\s*null\s*&&\s*message\.peerId\s*===\s*selfSignalingId/);
    // L'appelant principal lui passe le selfId du lien RÉEL (après `hello`), pas un id figé.
    assert.match(
      INDEX,
      /applySignalToRoster\(\s*bridge,\s*message,\s*signalingLink\?\.selfId\s*\?\?\s*null\s*\)/,
      "le pont filtre avec l'id que le serveur de signalisation nous a attribué",
    );
  });

  it('le flux auto-reprise passe aussi le pseudo, jamais le nom du salon (parité avec roomJoin)', () => {
    // Même règle que le handler `roomJoin` (test join-peer-name) : le chemin du recréage
    // automatique ne doit pas réintroduire le nom du salon comme nom de pair.
    const start = INDEX.indexOf('async function hostRoomFromSettings');
    assert.notEqual(start, -1, 'la machine de recréage existe');
    const body = INDEX.slice(start, INDEX.indexOf('\n}', start));
    assert.match(
      body,
      /startSignalingLink\(\s*state\.roomId,\s*resolveDisplayName\(/,
      'l’auto-reprise nomme le participant (réglages), pas le salon',
    );
    assert.doesNotMatch(
      body,
      /startSignalingLink\(\s*state\.roomId,\s*name\b/,
      'le paramètre `name` décrit le SALON dans ce chemin : il ne part pas dans le tuyau',
    );
  });
});
