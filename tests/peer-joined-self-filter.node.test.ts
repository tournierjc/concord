/**
 * tests/peer-joined-self-filter.node.test.ts — le renderer ne se maille jamais avec soi-même (2026-11-02, retour JC).
 *
 * Capture JC (0.4.10, salon « ok », 2/8) : DEUX lignes média « krillin ». Deux identités de la
 * MÊME personne vivent en parallèle :
 *   — `RoomBridge` nomme le local `SELF_ID` (la ligne de l'annuaire, avec (Vous)) ;
 *   — le tuyau lui attribue un id serveur (`p1` pour un client, `p2` pour l'hôte qui se connecte
 *     à son propre serveur), et le serveur du lien s'auto-annonce dans les `hello`/`join` avec
 *     CET id.
 * Le renderer (`handleSignal`) créait un pair média à chaque `peer-joined`, Y COMPRIS quand le
 * `peerId` reçu est l'id que le serveur a attribué À NOTRE PROPRE connexion : le maillage refuse
 * déjà `peerId === localId`, mais ici l'id n'est pas `localId` — c'est le NÔTRE côté serveur.
 * Règle verrouillée ici : `handleSignal` ignore un `peer-joined` porteur de `state.selfId` (lu du
 * lien, transmis par le hook `useVoicePlane`) ; l'id d'un pair média est celui que le maillage
 * connaît, jamais une identité de tuyau. Test par le code RÉEL de `voice.ts` + le contrat du hook.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const VOICE = readFileSync(new URL('../src/renderer/voice.ts', import.meta.url), 'utf8');
const ROOM = readFileSync(new URL('../src/renderer/Room.tsx', import.meta.url), 'utf8');

describe('handleSignal — un pair dont l’id est le nôtre est ignoré (jamais de pair-boucle)', () => {
  const handleBlock = (() => {
    const start = VOICE.indexOf("function handleSignal(");
    assert.notEqual(start, -1, 'handleSignal existe');
    // Le bloc de `case 'peer-joined':` jusqu'à `case 'peer-left':` (la portée qui nomme un pair).
    const joined = VOICE.indexOf("case 'peer-joined':", start);
    assert.notEqual(joined, -1, 'le cas peer-joined existe');
    const left = VOICE.indexOf("case 'peer-left':", joined);
    assert.notEqual(left, -1, 'le cas est délimité par peer-left');
    return VOICE.slice(joined, left);
  })();

  it('le cas peer-joined consulte l’id de soi avant de nommer un pair', () => {
    // Deux écritures acceptables : un filtre explicite (`selfId`) OU le passage par un helper
    // nommé qui porte la règle (`isSelfPeer`). L'essentiel : une ligne de garde LIT selfId.
    const guard =
      /isSelfPeer\(/.test(handleBlock) ||
      /state\.selfId/.test(handleBlock) ||
      /selfId\s*===\s*message\.peerId/.test(handleBlock);
    assert.ok(guard, 'peer-joined doit comparer le peerId reçu à l’id de SOI avant de créer une ligne média');
  });

  it('LinkState porte les identités de soi (transmises par le hook quand le lien live)', () => {
    // La table des pairs média ne peut pas filtrer sans connaître ses ids : `LinkState` porte un
    // `selfIds`, posé par `openVoice` depuis l'appelant (`useVoicePlane` → `options.selfIds`).
    assert.match(VOICE, /interface LinkState\s*\{[\s\S]{0,900}selfIds\s*:\s*Set<string>/, 'LinkState porte selfIds');
    // `openVoice` les reçoit (jamais une devinette interne) et les écrit dans l'état.
    assert.match(VOICE, /selfIds\s*:\s*new Set/);
    // L'appelant React les fournit depuis le DTO de salon (l'id serveur du tuyau).
    assert.match(ROOM, /selfIds:/, 'Room.tsx passe les identit\u00e9s de soi au hook de voix');
  });

  it('useVoicePlane passe l’id réel du lien (SELF_ID du pont + selfId du tuyau)', () => {
    // Le hook re\u00e7oit le selfId du pont (`room.selfId`, la ligne locale) — c'est d\u00e9j\u00e0 le cas ;
    // et l'id que le lien de signalisation a attribu\u00e9 doit suivre (filtre pair-boucle).
    assert.match(ROOM, /localId: room\.selfId \?\? ''/, 'la ligne locale garde son id de pont');
    assert.match(ROOM, /selfIds: room\.selfSignalingId === null \? \[\] : \[room\.selfSignalingId\]/,
      'l’id serveur suit dans la m\u00eame passe');
    // La session de voix est ouverte avec les DEUX identités (pont et tuyau) : la règle ne vit
    // pas dans un composant qui devine, elle est donnée au module.
    assert.match(
      VOICE,
      /openVoice\(\s*`\$\{roomId\}\|\$\{localId\}`, localId/,
      'la clé de session porte l’id ; le filtre pair-boucle est exercé par handleSignal',
    );
  });
});
