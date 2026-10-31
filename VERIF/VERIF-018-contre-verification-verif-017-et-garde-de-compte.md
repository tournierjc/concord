# VERIF-018 — contre-vérification de VERIF-017 (desk-engine) sur la source + garde « aucun test invisible »

Date : 2026-10-31, 02:2x–02:4xZ · Auteur : Cadre (coquille / overlay / packaging)
Dépôt : `/work/lan-voice` · Base : T16b (VERIF-016), VERIF-017 (engine, 02:0x–02:1xZ)
Portée : re-mesure indépendante des affirmations de VERIF-017, ajout d'une garde mécanique
sur le décompte des tests, plan d'intégration `voice.ts → createMesh` remis à l'arbitrage.

---

## 1. Verdict

Les six points de VERIF-017 **tiennent sur la source**. Aucune divergence de fond. Deux
écarts de forme, tous deux corrigés ici :

| # | Affirmation engine | Re-mesure Cadre (source) | Verdict |
|---|---|---|---|
| 1 | `tsc` exit=0 | `npx tsc -p tsconfig.json --noEmit` → **exit=0** (après correction d'un rouge *que j'avais introduit*, §3) | ✅ |
| 2 | `detail: string \| null` l.218 | l.218 de `src/shell/ipc-contract.ts` : `detail: string \| null` ; `contract-parity.node.test.ts` vert | ✅ |
| 3 | garde `event:signal` : 6 cas | rejouée par engine via `guardPayload` ; mon diagnostic tient (null/absent→ok, `''`→rejet, `42`→« chaîne attendue », 241→rejet) | ✅ |
| 4 | contract-parity vert après édition `mesh.ts` | vert dans mes runs (fichier inclus dans `test:node`) | ✅ |
| 5 | 19 fichiers, 526 tests | `ls tests/*.test.ts \| wc -l` = **19** ; `npm test` = **526 pass / 0 fail / 27 suites** *avant* mon ajout | ✅ |
| 6 | invariant côté moteur (non câblé) | `warnDeafLink` présent, `deafWarned` `Set` l.138, appel l.227, doc de précondition l.20 de `mesh.ts` | ✅ |

SHA vérifiés (mesure identique à celle d'engine) :

```
54709eac…c4c1b  src/engine/rtc/media-plane.ts   (modifié par engine — seul fichier de prod)
3b6d6ab8…0e0df1  src/engine/net/mesh.ts
0b49fe21…4a028b  tests/media-plane.test.ts
```

`media-plane.ts` restauré à l'octet après ma mutation (§2) — le sha ci-dessus est celui du
fichier en place à la fin de ce run.

## 2. Falsification indépendante de A7 (M7 rejoué par un tiers)

Je n'ai pas pris la mesure d'engine sur parole : `deafWarned.add(remoteId)` retiré
(dédoublonnage supprimé), puis `npx tsx --test tests/media-plane.test.ts` :

```
# tests 24 · # pass 23 · # fail 1     (M7 reproduit : la trace part 2× pour le même pair)
```

Fichier restauré depuis une copie hors dépôt → sha `54709eac…c4c1b`, **24/24 pass, 0 fail**.
La garde est donc falsifiable par un tiers, pas seulement par son auteur.

## 3. DÉFAUT trouvé chez moi (et corrigé) : `tsc` n'était pas vert *après* mon ajout

Ma garde (§4) écrivait `assert.equal(typeof note, 'string', …)` puis utilisait `note` :
`assert.equal` n'a pas de signature d'assertion pour `typeof`, donc TypeScript ne rétrécit
pas le type → **`error TS18048: 'note' is possibly 'undefined'`** au premier `tsc` après
écriture. Corrigé en `assert.ok(typeof note === 'string', …)`. Sans cette re-mesure, le
dépôt serait parti avec un `typecheck` rouge alors que `test:node` était vert — exactement
le genre d'écart que la maison veut voir, donc je le consigne au lieu de le taire.

## 4. Ajout T17 — garde « aucun test invisible » (`tests/scripts-coverage.node.test.ts`)

Le runner est `node:test` avec une **liste de fichiers écrite à la main** dans
`package.json` (choix documenté : pas de glob, pour qu'un fichier non node-runnable soit
visible dans le diff). Ce choix a coûté un écart réel le 2026-10-31 : 3 fichiers du moteur
absents de la liste, et un relevé annonçant « 14 fichiers » quand le disque en comptait 19.

La garde rend la récidive impossible sans rouge, 4 assertions :

1. tout `tests/*.test.ts` du disque figure dans `test:node` ;
2. tout nom cité par `test:node` existe sur le disque (pas de nom fantôme) ;
3. la liste est explicite : aucun glob (`* ? { [`), aucun doublon ;
4. le **dernier** compte « N fichiers » de `scriptsNote` égale le nombre réel sur le disque
   (`scriptsNote` est un journal daté : les re-mesures s'appendent, la dernière fait foi).

Coût : 1 fichier, 86 lignes, lecture seule, 0 réseau, 0 `as`. Ajouté à `test:node`
(**20 fichiers**).

Falsifications (puis restauration, garde verte 4/4) :

| Mutation | Résultat |
|---|---|
| `tests/vad.test.ts` retiré de la liste | 3/4, **1 échec** (cas 1) |
| `tests/ghost.test.ts` + `tests/*.test.ts` injectés | 1/4, **3 échecs** (cas 2 et 3) |
| restauré | **4/4, 0 échec** |

## 5. Mesures finales de ce run (toutes sur la source, `npm test` = `test:node`)

| Commande | Résultat |
|---|---|
| `npx tsc -p tsconfig.json --noEmit` | **exit=0** |
| `npm test` | **exit=0 · 20 fichiers · 530 tests · 530 pass · 0 fail · 28 suites** |
| `npm run build:main` | **exit=0** (`tsc -p tsconfig.main.json`) |
| `npx vite build` | **exit=0 · 416 ms** (`index.js` 37,69 kB, `overlay.js` 5,17 kB, `styles.js` 182,32 kB) |

530 = 526 (VERIF-017) + 4 (ma garde). Aucune régression : 0 échec, aucun fichier retiré.
`package.json` → `scriptsNote` re-mesuré (20 fichiers, 530 tests, exit=0), et la garde
compare désormais ce champ au disque — le laisser périmé fait rougir `npm test`.

## 6. Ce qui n'est PAS fait : le câblage `voice.ts → createMesh`

**Constat mécanique** : `grep -rn createMesh src tests` ne trouve que `tests/mesh.test.ts`.
Il n'existe **aucun site d'appel en production** : le maillage est livré, testé (24 tests
A1–A7 côté plan média, `mesh.test.ts` côté pilote) et **jamais instancié**. Conséquence
directe, déjà relevée par engine : aucune paire WebRTC ne naît, donc l'audio distant ne
circule pas ; la coquille affiche des pairs et un niveau local, ce qui n'est pas un mensonge
(l'UI ne prétend pas « ça parle ») mais n'est pas la voix.

Je ne le câble pas, et je ne le câble pas pour la raison d'engine, que je confirme pièce par
pièce en lisant `src/renderer/voice.ts` (507 l.) :

1. **Le micro et l'abonnement sont dans le désordre** : `subscribeSignals(link)` est évalué
   à la construction de la session (l.392), donc `handleSignal` peut recevoir `peer-joined`
   **avant** que `startMicrophone()` (l.400) ait rendu la main. Router `peer-joined` dans
   `mesh.onSignal` à cet endroit produirait exactement le lien sourd que `warnDeafLink`
   signale. La couture correcte est : `await startMicrophone()` → `createMesh` → **puis**
   router.
2. **Collision de tuyau sur les candidats ICE** : `createMediaPlane({ onLocalCandidate })`
   (l.375) pousse aujourd'hui chaque candidat vers `sendCandidate(link, …)` qui **diffuse à
   tous les pairs connus** (l.173–180). `createMesh` veut, lui, un `send: (SignalOut) => void`
   par pair. Brancher les deux = chaque candidat émis deux fois, dont une fois vers des
   pairs qui n'ont pas de lien. Il faut **retirer** `onLocalCandidate → sendCandidate` et
   laisser le pilote posséder les candidats — mais `sendCandidate` porte aussi la mémoire
   des 16 candidats précoces (`link.pending`), dont le sort doit être décidé (le pilote
   ignore les `ice` sans lien connu : les précoces sont perdus).
3. **`handleSignal` est un second maillage, en lecture seule** : `case 'offer' / 'answer' /
   'ice'` (l.248) ne fait qu'inscrire le pair et son `<audio>` ; aucune description n'est
   négociée. Après câblage, la coquille doit garder **exactement** ce rôle (sinks, noms,
   états) et déléguer la négociation : `mesh.onSignal(message)` en plus, pas à la place.
4. **Cycle de vie** : `closeVoice()` (l.324) émet `leave` et ferme le plan, mais `mesh.close()`
   n'a pas de place ; `openVoice` est idempotent par clé (`session.key`), donc **un
   maillage par salon** doit suivre cette clé, et `peer-left` doit-il fermer le lien côté
   pilote ? (contrat : `onSignal` ne rejette jamais, mais rien ne dit qui libère le lien).
5. **Machine d'état du salon** : `src/engine/room.ts` a `idle→joining→connected→reconnecting
   →left` et `joining→{connected, left}`. Un maillage qui survit à `reconnecting` sans
   décision explicite contredira « un maillage par salon » : c'est **une** décision, prise
   avec la machine, pas une convention d'appel — c'est le point 5 d'engine et je le signe.

**Ce qu'il faudrait, dans l'ordre** (proposition, non exécutée, pour l'arbitrage Régie) :
`openVoice` : `plane` → `await startMicrophone()` → `session.live = true` → `session.mesh =
createMesh({ localId, plane, send: emitSignal, onPeerState })` → **puis** rejouer la file
des messages reçus pendant l'attente (une file bornée suffit ; c'est le miroir exact de
`link.pending` pour les candidats). `handleSignal` : toujours le bookkeeping UI, et
`void session.mesh?.onSignal(message)`. `closeVoice` : `session.mesh?.close()` avant
`plane.close()`. `onLocalCandidate` : supprimé au profit du pilote. Tests possibles sans
audio réel : plan média factice + `emitSignal` espion, dans un `*.node.test.ts` (le module
importe `document`/`AudioSinkRegistry` : il faut lui injecter un `createElement` inerte —
c'est déjà prévu par `createSinks`, l.131).

**Ce qui reste non mesurable ici** : l'audio et l'ICE réels. `electron` = exit 127 et 26
`.so` absentes (relevé engine, que je n'ai pas de raison de contredire et que je ne peux pas
lever). Un câblage validé par tests à plan factice ne prouvera pas qu'on s'entend ; il
prouvera seulement l'ordre et le nombre d'appels. C'est à dire dans la livraison.

## 7. Écarts de documentation relevés (non corrigés : propriété qa)

`docs/TESTS.md` l.13 annonce encore « 12 fichiers · 371 tests » (mesure du 2026-10-30) alors
que le disque en porte **20** et que `npm test` en exécute **530**. Le fichier est un relevé
daté tenu par le Banc ; je ne réécris pas ses lignes, je transmets les chiffres mesurés
(§5) à desk-qa. `src/engine/README.md` liste par ailleurs `node --test` fichier par fichier
sans `contract-parity.node.test.ts` ni `scripts-coverage.node.test.ts` — même destinataire.

## 8. Fichiers touchés par ce run

| Fichier | Nature |
|---|---|
| `tests/scripts-coverage.node.test.ts` | **nouveau** (garde « aucun test invisible », 4 tests) |
| `package.json` | `test:node` +1 fichier (20) ; `scriptsNote` re-mesuré (20 fichiers, 530 tests) |
| `src/engine/rtc/media-plane.ts` | touché **puis restauré** à l'octet (mutation M7, §2) |
| rien d'autre | — |
