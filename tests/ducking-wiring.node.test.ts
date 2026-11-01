/**
 * tests/ducking-wiring.node.test.ts — les régressions du ducking qui ne vivent PAS dans
 * `ducking.ts` : la garde du main (« soi-même qui parle ⇒ AUCUN ducking »), le contrat IPC
 * `duckingApply`, le câblage preload, et l'option qui éteint toute exécution.
 *
 * Exigence → assertion :
 *  - « soi-même qui parle ⇒ AUCUN ducking » : `shouldDuckForPeers(['moi'], 'moi')` rend `false`
 *    (la décision du handler `lan:ducking:apply` passe par CETTE fonction pure, testée ici) ;
 *  - un pair qui parle ⇒ `true` ; un ensemble vide (fin de la tenue du relay) ⇒ `false`
 *    (c'est la restauration) ;
 *  - le contrat refuse une charge utile mal formée, un doublon, un id vide, un champ inconnu,
 *    un dépassement de plafond (la garde du preload applique la même) ;
 *  - l'option `audio.duckOthers` : absente du fichier ⇒ ON (rétro-compat — régression exigée),
 *    `false` ⇒ le main ne peut pas exécuter (le handler ne JOUE le contrôleur QUE si l'option
 *    est active, chemin vérifié par la table du handler + la garde, cf. ducking.ts) ;
 *  - le preload consomme `IPC.duckingApply` (parité contrat ↔ pont, même garde que les autres).
 *
 * Lancer : npx tsx --test tests/ducking-wiring.node.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  DUCKING_SPEAKING_MAX,
  INVOKE_CHANNELS,
  IPC,
  guardPayload,
  shouldDuckForPeers,
} from '../src/shell/ipc-contract.ts';
import { applySettingsPatch, defaultSettings, parseSettings } from '../src/shell/settings-schema.ts';

/* ------------------------------------------------------------------ */
/* La garde « jamais soi-même » — décision du handler du main           */
/* ------------------------------------------------------------------ */

describe('ducking — soi-même qui parle ne déclenche RIEN', () => {
  it('un ensemble qui ne porte que soi ⇒ pas de ducking', () => {
    assert.equal(shouldDuckForPeers(['moi-123'], 'moi-123'), false);
    assert.equal(shouldDuckForPeers([], 'moi-123'), false);
  });

  it('un pair (et seulement lui) déclenche ; le retour au vide éteint', () => {
    assert.equal(shouldDuckForPeers(['pair-a'], 'moi-123'), true);
    // L'extinction du relay (fin de la tenue de 600 ms) publie l'ensemble vide : restauration.
    assert.equal(shouldDuckForPeers([], 'moi-123'), false);
  });

  it('soi dans la liste ne l’annule pas si un pair parle vraiment (déclencheur légitime)', () => {
    assert.equal(shouldDuckForPeers(['moi-123', 'pair-a'], 'moi-123'), true);
  });

  it('hors salon (selfId inconnu) : aucun id n’est soi, la liste décide seule', () => {
    assert.equal(shouldDuckForPeers(['pair-a'], null), true);
    assert.equal(shouldDuckForPeers([], null), false);
  });

  it('ids vides ou non conformes ignorés, jamais un déclencheur inventé', () => {
    assert.equal(shouldDuckForPeers(['', '', '  '], 'moi'), false);
  });
});

/* ------------------------------------------------------------------ */
/* Le contrat `duckingApply`                                            */
/* ------------------------------------------------------------------ */

describe('ducking — contrat lan:ducking:apply', () => {
  it('le canal est un invoke du canon', () => {
    assert.ok(INVOKE_CHANNELS.includes(IPC.duckingApply), 'duckingApply est un invoke');
  });

  it('liste de pairs acceptée', () => {
    const ok = guardPayload('invoke', IPC.duckingApply, { speaking: ['pair-a', 'pair-b'] });
    assert.equal(ok.ok, true);
  });

  it('charge utile hors forme refusée : absent, non-tableau, doublon, id vide, champ inconnu', () => {
    const errorOf = (result: ReturnType<typeof guardPayload>) => {
      if (result.ok) throw new Error('la garde devait refuser');
      return result.error;
    };
    assert.equal(errorOf(guardPayload('invoke', IPC.duckingApply, {})).code, 'invalid-payload');
    assert.equal(errorOf(guardPayload('invoke', IPC.duckingApply, { speaking: 'pair-a' })).code, 'invalid-payload');
    assert.equal(
      errorOf(guardPayload('invoke', IPC.duckingApply, { speaking: ['a', 'a'] })).message.includes('doublon'),
      true,
    );
    // La liste VIDE est ACCEPTÉE : c'est exactement « aucun pair ne parle » — le signal de
    // restauration du relay. `idList` borne la longueur et les ids, pas la présence du signal.
    assert.equal(guardPayload('invoke', IPC.duckingApply, { speaking: [] }).ok, true);
    assert.equal(errorOf(guardPayload('invoke', IPC.duckingApply, { speaking: [''] })).code, 'invalid-payload');
    // (Le `{}` sans `speaking` est déjà refusé plus haut — « tableau attendu ».)
    assert.equal(
      errorOf(guardPayload('invoke', IPC.duckingApply, { speaking: ['a'], force: true })).message.includes('inconnu'),
      true,
    );
  });

  it('plafond du salon : plus de pairs que la salle, c’est refusé', () => {
    const tooMany = Array.from({ length: DUCKING_SPEAKING_MAX + 1 }, (_u, i) => `pair-${i}`);
    assert.equal(guardPayload('invoke', IPC.duckingApply, { speaking: tooMany }).ok, false);
  });
});

/* ------------------------------------------------------------------ */
/* L'option — régressions du schéma                                     */
/* ------------------------------------------------------------------ */

describe('ducking — réglage audio.duckOthers', () => {
  it('défaut : activé (zéro réglage requis)', () => {
    assert.equal(defaultSettings().audio.duckOthers, true);
  });

  it('rétro-compat : un fichier SANS la clé (écrit avant l’amendement) ⇒ ducking ON', () => {
    const fichierSansCle = {
      version: 1,
      locale: 'fr',
      theme: 'system',
      nickname: 'Ada',
      audio: {
        inputDeviceId: null,
        outputDeviceId: null,
        noiseSuppression: true,
        echoCancellation: true,
        inputGain: 1,
        // Pas de `duckOthers` : le fichier vient d'avant l'amendement.
      },
      talk: { mode: 'ptt', pttAccelerator: 'Alt+Space', vadThresholdDb: -40 },
      overlay: { enabled: true, opacity: 0.9, scale: 'md', screenId: null, position: null },
      network: { signalingPort: 47821, discovery: 'auto' },
    };
    const result = parseSettings(fichierSansCle);
    assert.equal(result.ok, true, 'un fichier ancien doit rester valide');
    if (!result.ok) return;
    assert.equal(result.value.audio.duckOthers, true, 'absent ⇒ ON, jamais éteint en silence');
  });

  it('désactivé : la valeur false est conservée, un patch partiel ne l’écrase pas', () => {
    const off = applySettingsPatch(defaultSettings(), { audio: { duckOthers: false } });
    assert.equal(off.ok, true);
    if (!off.ok) return;
    assert.equal(off.value.audio.duckOthers, false);
    // Un patch audio qui ne mentionne PAS la clé (le patch du renderer recopie l'objet entier,
    // mais un patch partiel est légal côté contrat) ne doit pas la réinitialiser.
    const repatched = applySettingsPatch(off.value, { audio: { inputGain: 0.5 } });
    assert.equal(repatched.ok, true);
    if (!repatched.ok) return;
    assert.equal(repatched.value.audio.duckOthers, false, 'false reste false');
  });

  it('une valeur présente mais non booléenne est refusée, jamais corrigée en silence', () => {
    const broken = defaultSettings() as unknown as { audio: Record<string, unknown> };
    broken.audio['duckOthers'] = 'oui';
    const result = parseSettings(broken);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual(
      result.errors.map((error) => `${error.path}:${error.code}`),
      ['audio.duckOthers:type'],
    );
  });
});

/* ------------------------------------------------------------------ */
/* Le preload consomme le canal (parité, même règle que les autres)     */
/* ------------------------------------------------------------------ */

describe('ducking — le preload câble le canal', () => {
  it('`IPC.duckingApply` est invoqué par le pont, via setDucking', () => {
    const here = fileURLToPath(new URL('.', import.meta.url));
    const preload = readFileSync(`${here}../src/preload/index.ts`, 'utf8');
    assert.match(preload, /IPC\.duckingApply/, 'le preload passe par le canon, pas un littéral');
    assert.match(preload, /setDucking/, 'la méthode LanAPI est exposée');
  });
});
