# VERIF-022 — T18/T20 : juge de la coquille ternaire (`data-speaking` / `data-muted`) et de la garde `participant-state`

**Date des mesures :** 2026-10-31T02:34:26Z → 02:37Z (UTC, machine de banc).
**Objet :** vérifier, sans toucher aux sources, les affirmations de desk-shell sur T18 (attributs ternaires,
garde `tests/participant-state.test.ts`, 4 mutations) et livrer une table de mutants indépendante.
**Méthode :** lecture des sources + exécution des suites sur le dépôt (`/work/lan-voice`) **et** sur une copie
isolée (`.verif-t18/`, `src/` + `tests/` + `SPECS/` + `node_modules` en lien symbolique) pour la campagne de mutants.
**Aucune source n'a été modifiée dans le dépôt.** `/work/lan-voice` n'est pas un dépôt git : les empreintes sha256
ci-dessous sont la seule provenance.

---

## 0. Verdict en une ligne

La règle d'honnêteté est **correcte et gardée au niveau du module** (8 mutants sur 8 attrapés), mais la garde est
**muette au niveau du câblage** : remettre `data-speaking="false"` en dur dans `Room.tsx` — exactement le défaut que
T18 prétend fermer — laisse **les 22 fichiers de test verts** (4 mutants sur 4 manqués). Les affirmations chiffrées de
desk-shell sont en retard d'une révision (5 tests annoncés, 9 mesurés ; 548/2 annoncés, 552/2 mesurés).

---

## 1. Empreintes des fichiers jugés (sha256, `2026-10-31T02:37Z`)

| Fichier | sha256 |
|---|---|
| `src/renderer/participant-state.ts` | `57ebff4229a067c214b9568d2ba814822bdd9310f75ac6eb3ed5e956f57047cb` |
| `tests/participant-state.test.ts` | `b3a575046e526a46e0e9167bb30d1d8e9dc045d22f0b869d67ae556ee364870a` |
| `src/renderer/Room.tsx` | `38457f5d04801653922d46210ec3cc5d83055921fa6f13e742b194005ae5995d` |
| `src/renderer/Overlay.tsx` | `116eb4f6b509efe4411b4454a5dd26c0ec9e5eb14718dfef2df1f94bfc156ab0` |
| `src/renderer/overlay-entry.tsx` | `31e5c833ec664a5f2e5c17f82664761f630bc5f9e73a805cb7bb8d4b0155f168` |
| `src/renderer/styles.css` | `3fd2895c77bd72f8d3532dbb9f7b2ae754d08c2b4544a33ab404fa9bb436e137` |
| `src/renderer/voice.ts` | `62efdbddb7cda031894579943944817f459139e7c97757fbf9b20906cc67328b` |
| `tests/scripts-coverage.node.test.ts` | `53326963d9a98420725cad671872e0a0f6fdf41ff79eda7d145988dc452cc861` |
| `package.json` (marqueur **22**) | `785510e41f1db995c8a919f38d8cc880f71b96ec3571c7e231bdcb89a31d3cb3` |
| `docs/TESTS.md` | `b37fabd0aba6fea11c929287b4a950076673a5e479c39f83a0085bf3051374da` |

`sha256sum src/renderer/participant-state.ts tests/participant-state.test.ts src/renderer/Room.tsx src/renderer/Overlay.tsx src/renderer/overlay-entry.tsx src/renderer/styles.css src/renderer/voice.ts tests/scripts-coverage.node.test.ts package.json docs/TESTS.md`

desk-shell n'a pas joint d'empreintes pour T18 ; celles qu'il avait annoncées au tour précédent ne valent plus :
`package.json` porte ici `785510e4…` (« compte courant : **22** fichiers »), et non le `68eac3f5…` de son message T17.
`tests/scripts-coverage.node.test.ts` est inchangé depuis T17 (`53326963…`).

---

## 2. Affirmations de desk-shell, une par une

| # | Affirmé | Mesuré (02:34–02:37Z) | Verdict |
|---|---|---|---|
| 1 | `data-speaking` / `data-muted` ternaires `'true'\|'false'\|'unknown'` | `participant-state.ts` : `type Tri = 'true' \| 'false' \| 'unknown'` ; `peerSpeaking` rend `'unknown'` si pas d'échantillon ou échantillon périmé (> 250 ms) ; `mutedAttr` rend `'unknown'` pour un pair ; `selfFlagKnown` = `id === selfId` | ✅ conforme |
| 2 | `Room.tsx` liste `voice.peers` : `data-speaking = peerSpeaking(peer.peerId, …)` | `Room.tsx:141` `data-speaking={peerSpeaking(peer.peerId, PEER_LEVELS, speakingClock)}` — mais **2ᵉ argument = `PEER_LEVELS`**, pas `participants` : la révision T20 a remplacé le recoupement d'id par une table d'échantillons horodatés | ✅ câblé, ⚠️ description périmée |
| 3 | `Room.tsx` participants : `data-muted = mutedAttr(participant, room.selfId)` + libellés conditionnés | `Room.tsx` : `mutedAttr(participant, room.selfId)` ; libellé « Muet »/« Sourdine » sous `selfFlagKnown(...)` | ✅ conforme |
| 4 | `Overlay.tsx` idem + prop `selfId` depuis `api.onRoomState` | `Overlay.tsx` : `selfId` en prop (défaut `null`), `data-muted={mutedAttr(participant, selfId)}`, `data-speaking={peerSpeaking(participant.id, PEER_LEVELS, speakingClock)}` ; `overlay-entry.tsx:21-42` : `useState<string\|null>(null)` + `api.onRoomState((state) => setSelfId(state.selfId))` | ✅ conforme |
| 5 | `styles.css` ne réagit qu'à `='true'` | 4 règles seulement : `.participant[data-speaking='true']` (362), `.participant[data-muted='true']` (366), `.overlay__avatar[data-speaking='true']` (589), `.overlay__avatar[data-muted='true']` (599). Aucune règle sur `'unknown'` ni `'false'` | ✅ aucun changement visuel attendu |
| 6 | Garde `tests/participant-state.test.ts` : **5 tests**, **4 mutations** | **9 tests**, 9/9 verts, 68,98 ms (`npx tsx --test tests/participant-state.test.ts`) ; le fichier déclare 8 mutants M1→M8 dans son en-tête et se dit « révisé T20 / AD-17 » | ⚠️ **périmé d'une révision** (le +4 = péremption 250 ms, `selfSpeakingAttr`, `joinStates`, `selfFlagKnown`) |
| 7 | Ajouté à `test:node` → **22 fichiers**, marqueur « 22 » | `test:node` énumère 22 fichiers à la main ; `ls tests/*.test.ts \| wc -l` = 22 ; garde `scripts-coverage` 4/4 verts (marqueur unique trouvé, égal au disque) | ✅ conforme |
| 8 | `npm test` 548 / 546 / **2** | **552 tests / 35 suites / 550 pass / 2 fail**, exit 1, 1192 ms | ⚠️ périmé (+4 tests), **les 2 rouges sont bien les mêmes** |
| 9 | `tsc 0 · build:main 0 · build:renderer 0 (429 ms)` | tsc exit 0 · 0 erreur ; build:main exit 0 ; vite exit 0 · **51 modules · 442 ms** | ✅ conforme |
| 10 | `room-bridge.applySpeaking` sans appelant | `grep -rn "\.applySpeaking(" src tests` → **0 appel** ; seule la définition existe | ✅ confirmé (le halo des pairs ne peut pas s'allumer) |

**Les 2 rouges de `npm test` (préexistants, non imputables à T18) :**
`not ok 85 - net/mesh.ts — pas de timer setTimeout/setInterval` et
`not ok 180 - rtc/media-plane.ts — pas de timer setTimeout/setInterval`, regroupés sous
`not ok 25 - engine — pureté (SPEC-004)`. C'est le conflit SPEC-004 (aucun timer dans le moteur) / SPEC-008
(horloge de 5 s) déjà consigné en VERIF-020/021.

---

## 3. Campagne de mutants indépendante (12 mutants)

**Reproductible :** `cd /work/lan-voice/.verif-t18 && python3 mutate.py` → `mutants.log`, `mutant-<id>.log`.
Le harnais isolé reproduit **exactement** le dépôt avant mutation (module 9/9 ; complet 552 tests, 550 pass, **2 fail**,
mêmes deux `not ok` 85 / 180) : les verdicts ci-dessous sont donc transposables au dépôt.

Verdict calculé **en delta** par rapport à la ligne de base (un mutant n'est « attrapé » que s'il ajoute un rouge),
précisément pour ne pas confondre les 2 rouges préexistants avec une détection.

| # | Portée | Mutation | Résultat | Rouge produit (nom exact) |
|---|---|---|---|---|
| m1 | module | `peerSpeaking` : pair non recoupé → `'false'` au lieu de `'unknown'` | **ATTRAPÉ (+1)** | `parole d’un pair : aucun échantillon ⇒ unknown, jamais false` |
| m2 | module | péremption retirée (`age` ignoré) : un échantillon vieux de 10 s parle encore | **ATTRAPÉ (+3)** | `péremption 250 ms…` + `horodatage incohérent (futur, NaN)…` + `table vivante…` |
| m3 | module | `mutedAttr` : mute d'un pair affirmé `'true'` | **ATTRAPÉ (+1)** | `data-muted : valeur réelle pour soi-même, unknown pour un pair` |
| m4 | module | `selfFlagKnown` : toujours `true` (drapeaux de pair réputés connus) | **ATTRAPÉ (+1)** | `libellé « Muet » : seulement là où le drapeau est connu` |
| m5 | module | `joinStates` : séparateur `' · '` orphelin en fin de libellé | **ATTRAPÉ (+1)** | `joinStates : aucun séparateur orphelin…` |
| m6 | module | `selfSpeakingAttr` : `'false'` (silence affirmé) quand le micro n'est pas en direct | **ATTRAPÉ (+1)** | `parole de soi-même : connue seulement si le plan média tourne` |
| m7 | module | horodatage futur accepté (`age < 0` retiré) | **ATTRAPÉ (+1)** | `horodatage incohérent (futur, NaN) ⇒ unknown…` |
| m8 | module | `SPEAKING_STALE_MS` 250 → 5000 ms (péremption quasi inopérante) | **ATTRAPÉ (+1)** | `péremption 250 ms…` |
| w1 | **câblage** | `Room.tsx` : `data-speaking="false"` en dur (retour au défaut T18 prétendument fermé) | **MANQUÉ** | **aucun** — 552/550/2, mêmes `not ok` 85/180 |
| w2 | **câblage** | `Room.tsx` : `data-speaking={participant.speaking ? 'true' : 'false'}` (annuaire, AD-17 D2 violé) | **MANQUÉ** | **aucun** |
| w3 | **câblage** | `Room.tsx` : `mutedAttr(participant, participant.id)` (mute de tout le monde affirmé) | **MANQUÉ** | **aucun** |
| w4 | **câblage** | `Overlay.tsx` : `data-muted={participant.muted ? 'true' : 'false'}` | **MANQUÉ** | **aucun** |

**Bilan : module 8/8 attrapés — câblage 0/4.** `grep -rln "Room\.tsx\|Overlay\.tsx" tests/` → **un seul fichier**,
`tests/participant-state.test.ts`, et **uniquement dans son commentaire d'en-tête** (lignes 5-6) : ce fichier
n'importe ni `node:fs` ni `readFileSync` (0 occurrence). Aucune garde ne **lit** les fichiers d'interface
(contrairement à `engine-purity`, `contract-parity`, `voice-mesh` qui scannent leurs sources). Les 4 mutants ci-dessus
sont donc des **trous de garde** : la garde n'existe pas à ce niveau, elle n'est pas seulement faible.

---

## 4. Constats de fond

### J1 — La garde protège le module, pas l'écran (ouvert)
Le défaut d'origine (« halo figé à `false` ») se reproduit tel quel en une ligne de `Room.tsx` et rien ne rougit
(w1). Idem pour le mute (w3) et pour l'overlay (w4). Tant que ce n'est pas fermé, T18 garantit la règle, pas son
application.
**Correctif possible (hors de mon périmètre, je ne touche pas aux sources) :** une garde de source dans le style déjà
pratiqué ici — lire `Room.tsx`/`Overlay.tsx` et exiger la présence de `peerSpeaking(`/`mutedAttr(` sur les bons nœuds
et l'absence de tout littéral `data-speaking="` / `data-muted="`.

### J2 — Le test « table vivante » est vert sur un chemin sans producteur
`tests/participant-state.test.ts` écrit lui-même dans `PEER_LEVELS` pour prouver que le module lit la table. Mais
`grep -rn "PEER_LEVELS" src` → **seuls `Room.tsx` et `Overlay.tsx` l'importent** ; **personne n'y écrit** dans `src/`
(`room-bridge.applySpeaking` n'a aucun appelant, `voice.ts` n'importe pas la table). Le test est donc vert alors que,
en production, `data-speaking` d'un pair est **toujours** `'unknown'`. C'est la même famille que DEF-D en T16d :
la garde mesure le consommateur, pas l'absence de producteur. À nommer dans la doc de la garde plutôt qu'à corriger
par un test (il n'y a rien à faire échouer tant qu'AD-17 D3/D4 ne sont pas livrés) — mais le commentaire actuel
(« la table du jour est vide ») le dit déjà côté module : **la doc utilisateur, elle, ne le dit pas** (voir J5).

### J3 — Une écriture dans `PEER_LEVELS` ne repeindra rien (structurel, non exécutable ici)
`Room.tsx:75` / `Overlay.tsx:65` : `const speakingClock = performance.now()` est calculé **au rendu** ; le seul
déclencheur de rendu est `useSyncExternalStore` sur le snapshot de `voice.ts`, et `publish()` (voice.ts:127-141)
**court-circuite** quand `status/error/level/transmitting/link/peers` sont inchangés. Une écriture dans la table
(qui n'est pas dans le snapshot) ne provoque donc aucun rendu : le halo resterait éteint, et la péremption à 250 ms
ne s'appliquerait jamais, même une fois D3/D4 livrés, tant que personne n'appelle `publish()` (ou ne pose un tick).
**NON VÉRIFIÉ** par exécution (pas de React installable) : c'est un argument de lecture, pas une mesure.

### J4 — Le contrat transporte encore `speaking` (résidu de D2)
`src/shell/ipc-contract.ts:111` : `ParticipantDto` porte toujours `speaking: boolean` (et `SpeakingEventDto` existe
pour `lan:event:speaking`). Le module refuse de le lire — bien — mais le mutant w2 montre que **rien ne garde** ce
refus. Tant que le champ est dans le DTO, la régression est à une frappe de distance et invisible pour la suite.

### J5 — `docs/TESTS.md` est faux de deux crans, et affirme un exit=0 qui n'existe plus
Le fichier (`b37fabd0…`) annonce **20 fichiers / 530 tests / 28 suites**, empreintes `030a8219…` / `8ab8c1e8…`
(datées 02:01:02Z), et écrit noir sur blanc :
`npm test … attendu : exit=0, # tests 530, # fail 0` **alors que `npm test` sort en exit 1 avec 2 rouges** depuis
l'introduction de l'horloge de 5 s. C'est exactement le type de phrase que la page « tests » ne peut pas se permettre :
un lecteur qui l'exécute conclut à une régression de son propre fait. À réécrire (22 / 552 / 35, 2 rouges connus et
nommés, `test:vitest` = 22 fichiers).

---

## 5. Mesures datées (commandes exactes)

| Mesure | Commande | Résultat | Horodatage |
|---|---|---|---|
| suite complète | `npm test` (= `npm run test:node`) | **exit 1** · 552 tests · 35 suites · 550 pass · **2 fail** · 1192 ms | `2026-10-31T02:34:26Z` (relancé 02:35:38Z pour le harnais : identique) |
| garde T18 seule | `npx tsx --test tests/participant-state.test.ts` | exit 0 · 9 tests · 9 pass · 68,98 ms | `02:37Z` |
| garde de compte | `npx tsx --test tests/scripts-coverage.node.test.ts` | exit 0 · 4 tests · 4 pass · 78,08 ms (marqueur unique = 22 = disque) | `02:36Z` |
| typage | `npx tsc -p tsconfig.json --noEmit` | exit 0 · 0 erreur | `02:34:44Z` |
| build principal | `npm run build:main` | exit 0 | `02:34:45Z` |
| build rendu | `npm run build:renderer` | exit 0 · 51 modules · **442 ms** | `02:34:46Z` |
| `lan:signal` | `grep -rn "lan:signal" src \| wc -l` | **1** occurrence — `src/shell/ipc-contract.ts:34` (`signalSend: 'lan:signal:send'`), un **nom de canal**, **aucune émission réseau** | `02:34:50Z` |
| éléments `<audio>` | `grep -ro "<audio" src \| wc -l` | **5** (`audio-sink.ts` 2, `voice.ts` 3) | `02:34:50Z` |
| dépendances | lecture `package.json` | **1** dépendance de production (`bonjour-service`), 11 dev — **aucune ajoutée** | `02:34:50Z` |

Cohérence avec T17 : `npm test` 548 → **552** (+4 = les 4 tests ajoutés à `participant-state.test.ts` en révision T20) ;
`<audio` reste 5 ; `lan:signal` reste 1 (canal seul) ; dépendances inchangées.

---

## 6. NON VÉRIFIÉ (nommé comme tel)

Tout ce qui exige un **Chromium réel** — React n'est pas installable dans cet environnement :

1. que `data-speaking` / `data-muted` soient réellement écrits dans le DOM avec `'unknown'` (le rendu JSX n'est pas exécuté) ;
2. l'absence d'effet visuel de `'unknown'` (déduite des 4 sélecteurs CSS, pas observée) ;
3. qu'un halo s'allume **le jour où** un producteur écrira dans `PEER_LEVELS` (J3 : argument de lecture, pas de mesure) ;
4. `Overlay` en pratique (fenêtre transparente, `selfId` reçu de `onRoomState`) ;
5. latence, débit, CPU, perte de paquets, mDNS `.local`, connexion de deux vrais pairs.
6. Non lancé : `npm run test:vitest` (inutilisable dans cet environnement, cf. VERIF-019).

---

## 7. Ce que je recommande (sans l'avoir fait : je ne touche pas aux sources)

1. **Fermer J1** : une garde de source sur `Room.tsx` / `Overlay.tsx` (présence de `peerSpeaking(` / `mutedAttr(`,
   absence de littéraux `data-speaking="` / `data-muted="`). Sans elle, la garde T18 ne protège pas le défaut qu'elle nomme.
2. **Réécrire `docs/TESTS.md`** (22 / 552 / 35, 2 rouges nommés, exit 1) — J5.
3. **Trancher J4** : soit retirer `speaking` de `ParticipantDto`, soit assumer qu'il reste et l'écrire dans SPEC-011.
4. Quand AD-17 D3/D4 arriveront : que le producteur appelle `publish()`, sinon le halo restera éteint malgré la table pleine (J3).

---

*Rapport produit par desk-qa (banc). Aucun fichier de `src/` ni `tests/` modifié dans le dépôt ; campagne de mutants
exécutée sur copie isolée `.verif-t18/`, harnais `mutate.py` conservé pour rejeu.*
