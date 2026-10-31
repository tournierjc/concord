# VERIF-006 — T11 : `npx tsc --noEmit -p tsconfig.json` → EXIT=0

**Banc (desk-qa) — 2026-10-31T01:05:38Z**
Canon : `/work/lan-voice` (pas de git dans ce canon : aucun `diff` possible, les
preuves sont des sorties de commandes horodatées reproduites ci-dessous).
Objet : ramener à `EXIT=0` les 17 diagnostics de typage que Régie a mesurés à
`2026-10-31T01:02:02Z`, tous dans `tests/`.

---

## 1. Résultat mesuré — deux objets, deux chiffres, non fusionnés

| Mesure | Commande exacte | Horodatage | Résultat |
|---|---|---|---|
| Typage | `npx tsc --noEmit -p tsconfig.json` | `2026-10-31T01:05:24Z` → `01:05:25Z` | **EXIT=0**, 0 diagnostic, 0 octet sur stderr (`wc -c` = 0) |
| Suite de tests | `npx tsx --test <13 fichiers>` (voir §5) | `2026-10-31T01:05:37Z` → `01:05:38Z` | **EXIT=0**, `# tests 378`, `# pass 378`, `# fail 0`, `# skipped 0`, `# todo 0` |

Conformément à l'arbitrage de Régie, ces deux lignes ne se recouvrent pas :
la première ferme la dette de **typage** (seule sortie `tsc` qui compte), la
seconde atteste que les **tests s'exécutent et passent** — elle ne ferme aucune
dette de typage, et `tsc` ne dit rien de l'exécution. Une suite verte sous `tsx`
n'a jamais annulé un `tsc` rouge ; réciproquement, `EXIT=0` sous `tsc` ne prouve
pas un seul test vert. Les deux ont été re-mesurés **après** la dernière
modification de fichiers, pas avant.

Avant / après, même commande, même canon :

| | Avant (`01:02:54Z`, mesure de contrôle du banc) | Après (`01:05:24Z`) |
|---|---|---|
| EXIT | **2** | **0** |
| Diagnostics | **17** | **0** |
| Octets stderr | 1 889 (fichier `tsc-before.txt`, 21 lignes) | 0 |

Environnement : `node --version` → **v22.23.4** ; `./node_modules/.bin/tsc
--version` → **Version 5.9.3** (le TypeScript local du projet, celui que `npx`
résout dans `/work/lan-voice`).
Commande de contrôle recopiée telle quelle, sans pipe, redirection vers un
fichier de sandbox uniquement pour capturer la sortie :

```
cd /work/lan-voice && date -u && npx tsc --noEmit -p tsconfig.json > <sandbox>/tsc-final.txt 2>&1; echo "EXIT_TSC=$?"; date -u; wc -c < <sandbox>/tsc-final.txt
```

Sortie obtenue :

```
Sat Oct 31 01:05:24 UTC 2026
EXIT_TSC=0
Sat Oct 31 01:05:25 UTC 2026
0
```

(Le « 0 » final est le nombre d'octets de sortie de `tsc` : plus aucun message.)

---

## 2. Table avant / après, diagnostic par diagnostic (17 → 0)

Colonne « sort » = ce qui fait disparaître le diagnostic. Règle respectée
partout : **aucun `as`, aucun `!`, aucun `@ts-ignore`/`@ts-expect-error`** —
garde explicite (`if (x === undefined) throw`), jamais une assertion.

### `tests/gain.test.ts` — 6 → 0

| Ligne (col) | Code TS | Message (verbatim) | Correction (sort) |
|---|---|---|---|
| 227 (9) | TS2345 | `Argument of type 'number \| undefined' is not assignable to parameter of type 'number'` | `close(curve[0], …)` → `close(sampleAt(curve, 0), …)` |
| 228 (9) | TS2345 | idem | `curve[curve.length - 1]` → `sampleAt(curve, curve.length - 1)` |
| 230 (15) | TS2532 | `Object is possibly 'undefined'` | `curve[i]` → `const current = sampleAt(curve, i)` |
| 230 (27) | TS2532 | `Object is possibly 'undefined'` | `curve[i - 1]` → `const previous = sampleAt(curve, i - 1)` |
| 237 (9) | TS2345 | `Argument of type 'number \| undefined' …` | `output[0]` → `sampleAt(output, 0)` |
| 237 (26) | TS2532 | `Object is possibly 'undefined'` | `curve[0]` → `sampleAt(curve, 0)` |

Outil ajouté (une seule fois, en tête de fichier) :

```ts
function sampleAt(curve: Float32Array, index: number): number {
  const value = curve[index]
  if (value === undefined) {
    throw new Error(`échantillon ${index} absent de la courbe (${curve.length} valeurs)`)
  }
  return value
}
```

Pourquoi une garde et pas `??`/`!` : dans un test de courbe, substituer une
valeur de repli à un échantillon absent **fabrique** la valeur attendue. La
garde transforme l'absence en échec nommé.

### `tests/room.test.ts` — 6 → 0

| Ligne (col) | Code TS | Message (verbatim) | Correction (sort) |
|---|---|---|---|
| 70 (16) | TS2532 | `Object is possibly 'undefined'` | `participants[0].self` → `first(join.room.participants, 'participants après join').self` |
| 200 (16) | TS18048 | `'rejection' is possibly 'undefined'` | `effects[0]` → `first(refused.effects, 'effets du refus')` |
| 200 (51) | TS18048 | `'rejection' is possibly 'undefined'` | idem (même variable, même garde) |
| 200 (61) | TS2339 | `Property 'code' does not exist on type 'RoomEffect'` (détail : `'{ readonly type: "join-transport"; readonly roomId: string; }'`) | **conséquence** des deux précédents : l'union `RoomEffect \| undefined` ne se réduisait pas, donc `rejection.type === 'reject-peer'` ne rétrécissait pas le type. La garde rend le narrowing opérant ; `rejection.code` redevient typé `RefuseCode`. Aucune autre modification sur cette ligne. |
| 271 (16) | TS2532 | `Object is possibly 'undefined'` | `lost.effects[0].type` → `first(lost.effects, 'effets de la perte de transport').type` |
| 331 (27) | TS2532 | `Object is possibly 'undefined'` | boucle sur `seqs` : `seqs[i]` / `seqs[i - 1]` lus une fois dans des `const`, puis `if (currentSeq === undefined \|\| previousSeq === undefined) throw` |

Outil ajouté (une seule fois) :

```ts
function first<T>(items: readonly T[], what: string): T {
  const value = items[0]
  if (value === undefined) {
    throw new Error(`${what} : liste vide alors qu’un élément est attendu`)
  }
  return value
}
```

### `tests/local-signaling.test.ts` — 4 → 0

| Ligne (col) | Code TS | Message (verbatim) | Correction (sort) |
|---|---|---|---|
| 93 (39) | TS2339 | `Property 'peerId' does not exist on type 'ReceiveAccepted'` | Arbitrage Régie appliqué : on ne lit plus `result.peerId` mais `harness.connection.peerId` (`string \| null`), avec garde `if (peerId === null) throw`. **Le test n'a pas été affaibli** : la garde échoue si le `join` est accepté sans identité attribuée. |
| 271 (7) | TS18048 | `'relayed' is possibly 'undefined'` | `const relayed = offerAtBob[0]; if (relayed === undefined) throw` |
| 272 (18) | TS18048 | `'relayed' is possibly 'undefined'` | rétrécissement par `if (relayed.type !== 'offer') throw` |
| 273 (18) | TS18048 | `'relayed' is possibly 'undefined'` | idem |

Code final de `connectAndJoin` :

```ts
  if (!result.ok) throw new Error('inatteignable')
  // L'identité attribuée est lue sur la connexion, pas sur le retour de
  // `receive` : `ReceiveAccepted` ne déclare pas encore `peerId` (dette de
  // typage côté engine, arbitrée par Régie). Garde explicite sur `string | null`.
  const peerId = harness.connection.peerId
  if (peerId === null) {
    throw new Error(`join(${name}) accepté mais la connexion n’a pas reçu de peerId`)
  }
  return { ...harness, peerId }
```

**Note de forme — un faux vert supprimé au passage** : avant correction, le
bloc du relais était `if (relayed.type === 'offer') { assert… }`. Si Bob avait
reçu autre chose qu'une offre, les deux assertions auraient été **sautées** et
le test serait resté vert. Le remplacement par `if (relayed.type !== 'offer')
throw` rend l'attente explicite : Bob doit recevoir une offre, pas « une offre
ou n'importe quoi ».

### `tests/ice-filter.node.test.ts` — 1 → 0 (corrigé côté moteur, pas côté test)

| Ligne (col) | Code TS | Message (verbatim) | Sort |
|---|---|---|---|
| 111 (9) | TS2353 | `Object literal may only specify known properties, and 'sdpMid' does not exist in type 'IceCandidateLike'` | **Carillon** a élargi `IceCandidateLike` dans `src/engine/rtc/ice-filter.ts` ( `sdpMid` et `sdpMLineIndex` déclarés, conformément au commentaire qui revendiquait la compatibilité structurelle avec `RTCIceCandidateInit`). **Je n'ai pas touché à ce fichier de test**, conformément à la consigne : il s'agit du contrat de `src/engine`. |

Preuve que la correction vient bien du moteur et pas d'un test adouci : le test
`ice-filter.node.test.ts` est inchangé par moi (38 tests, 38 pass, exit=0 —
voir §5) et `tsc` ne signale plus TS2353 ; la seule manière d'obtenir ce
résultat sans toucher au test est d'élargir le type côté `src/engine`.

### État intermédiaire mesuré (utile pour la traçabilité)

À `2026-10-31T01:04:00Z`, après mes 16 corrections et **avant** la livraison de
Carillon, `tsc` rendait `EXIT=2` avec **exactement 1** diagnostic restant :
`tests/ice-filter.node.test.ts(111,9): error TS2353`. La fermeture des 16
diagnostics de ma compétence ne dépendait donc pas de son changement.

---

## 3. Fichiers modifiés par ce run

| Fichier | Nature | Contenu du changement |
|---|---|---|
| `tests/gain.test.ts` | édition | helper `sampleAt` + 6 appels (aucun changement d'attendu) |
| `tests/room.test.ts` | édition | helper `first` + 3 appels, 1 garde de boucle (aucun changement d'attendu) |
| `tests/local-signaling.test.ts` | édition | `connectAndJoin` lit `connection.peerId` avec garde ; bloc relais rendu strict |
| `tests/room-discovery-sec.node.test.ts` | **réécriture partielle (mien)** | suppression des 21 assertions non nulles (`!`) que j'y avais laissées au run précédent → helper `summary()` à garde explicite. Comportement des 4 tests inchangé (mêmes attendus, mêmes contrôles négatifs), 4/4 verts après. |
| `package.json` | édition | `scriptsNote` : la note « 13e fichier, 3 tests + 1 skip, aucun chiffre re-mesuré » (fausse depuis la correction DEF-1 et depuis ce run) est remplacée par les chiffres mesurés du §5, avec horodatage. JSON validé (`node -e JSON.parse` → OK). |

Aucun fichier de `src/` touché par moi. `src/engine/rtc/ice-filter.ts` a été
modifié par Carillon, dans son périmètre.

### Contrôle « aucune assertion ajoutée dans tests/ »

```
grep -rno "!\.\|!)\|!," tests/*.ts | grep -v "!==\|!="   → 0
grep -rn "@ts-ignore\|@ts-expect-error" tests/*.ts        → 0
grep -rn " as " tests/*.ts                                → 56 (tous antérieurs à ce run)
grep -rn " as " tests/room-discovery-sec.node.test.ts      → 0
```

Les 8 `as` présents dans les quatre fichiers que j'ai touchés sont **tous**
antérieurs et lisibles : 6 `as const` (littéraux de test), 2 `as never`
(`{ type: 'teleport' as never }`, `null as never` — entrées volontairement
invalides passées à `dispatch`), 1 `as ServerMessage` sur un `JSON.parse`.
Je n'en ai ajouté aucun. Le seul `as` de mon propre fichier a été supprimé par
la réécriture du §3.

---

## 4. Sémantique préservée — ce que j'ai vérifié, pas supposé

Chaque correction conserve l'attendu d'origine : les gardes ne remplacent aucune
valeur attendue, elles transforment un « élément absent » en échec nommé. Points
de contrôle explicites :

- `gain.test.ts` : les trois attendus (`curve[0]` = `dbToGain(state.fromDb)`,
  dernier = `dbToGain(state.db)`, monotonie) sont inchangés ; seul le chemin
  d'accès change. 15/15 verts avant et après.
- `room.test.ts` : `participants[0].self === true`, `code === 'room-full'`,
  `effects[0].type === 'retry-transport'`, continuité des `seq` — inchangés.
  13/13 verts.
- `local-signaling.test.ts` : `peerId` provient désormais de
  `connection.peerId`, **la même valeur** que celle rendue par
  `receive({type:'join'})` (L499/L534 de `src/engine/net/local-signaling.ts`) ;
  les 10 tests du fichier qui utilisent `connectAndJoin` restent verts, ce qui
  atteste l'égalité en pratique. 17/17 verts.
- Aucun test supprimé, aucun `skip` ajouté : `# skipped 0` sur les 13 fichiers.

---

## 5. Ledger de la suite — les 13 fichiers, nominativement (mesure `2026-10-31T01:05:2xZ`)

Régie a relevé que le ledger T8 reçu s'arrêtait à 7 lignes sur 12 et qu'un
« 12/12 runnables » sans les 12 lignes n'est pas une preuve. Voici la table
complète, **13 fichiers** (le 13e est le mien), chacun exécuté seul pour que le
compte soit attribuable à un fichier :

| # | Fichier | tests | pass | fail | skip | exit |
|---|---|---|---|---|---|---|
| 1 | `tests/device.test.ts` | 11 | 11 | 0 | 0 | 0 |
| 2 | `tests/engine-purity.test.ts` | 154 | 154 | 0 | 0 | 0 |
| 3 | `tests/gain.test.ts` | 15 | 15 | 0 | 0 | 0 |
| 4 | `tests/ice-filter.node.test.ts` | 38 | 38 | 0 | 0 | 0 |
| 5 | `tests/ice-filter.test.ts` | 44 | 44 | 0 | 0 | 0 |
| 6 | `tests/ipc-contract.test.ts` | 12 | 12 | 0 | 0 | 0 |
| 7 | `tests/local-signaling.test.ts` | 17 | 17 | 0 | 0 | 0 |
| 8 | `tests/overlay-geometry.test.ts` | 13 | 13 | 0 | 0 | 0 |
| 9 | `tests/room-discovery-sec.node.test.ts` | 4 | 4 | 0 | 0 | 0 |
| 10 | `tests/room-discovery.node.test.ts` | 31 | 31 | 0 | 0 | 0 |
| 11 | `tests/room.test.ts` | 13 | 13 | 0 | 0 | 0 |
| 12 | `tests/settings-schema.test.ts` | 11 | 11 | 0 | 0 | 0 |
| 13 | `tests/vad.test.ts` | 15 | 15 | 0 | 0 | 0 |
| | **somme** | **378** | **378** | **0** | **0** | **0** |

La somme par fichier (378) égale exactement le compte du run groupé
(`# tests 378`), ce qui vérifie que les 13 fichiers ont bien été exécutés et
qu'aucun n'a été silencieusement ignoré.

**Écart avec le chiffre de 371** : 371 était la mesure du ledger T8 à
`2026-10-30T23:29Z` sur 12 fichiers. Le delta +7 se décompose sans reste :
`room-discovery.node.test.ts` 28 → 31 (+3, ajouts de Carillon, dont le cas
DEF-1 désormais actif) et `room-discovery-sec.node.test.ts` 0 → 4 (+4, mon
fichier de sonde d'injection, dont l'ex-cas `skip` devenu test actif). Les 11
autres fichiers sont au même compte qu'à 23:29Z. **371 n'est donc pas faux, il
est daté** ; 378 est l'état courant.

Reproduction, par fichier :

```
cd /work/lan-voice && for f in tests/device.test.ts tests/engine-purity.test.ts \
  tests/gain.test.ts tests/ice-filter.node.test.ts tests/ice-filter.test.ts \
  tests/ipc-contract.test.ts tests/local-signaling.test.ts \
  tests/overlay-geometry.test.ts tests/room-discovery-sec.node.test.ts \
  tests/room-discovery.node.test.ts tests/room.test.ts \
  tests/settings-schema.test.ts tests/vad.test.ts; do
  out=$(npx tsx --test "$f" 2>&1); echo "$f exit=$? $(printf '%s\n' "$out" | grep -m1 '^# tests ')"; done
```

Run groupé, commande exacte et sortie :

```
cd /work/lan-voice && date -u && npx tsx --test tests/device.test.ts tests/engine-purity.test.ts \
  tests/gain.test.ts tests/ice-filter.node.test.ts tests/ice-filter.test.ts tests/ipc-contract.test.ts \
  tests/local-signaling.test.ts tests/overlay-geometry.test.ts tests/room-discovery-sec.node.test.ts \
  tests/room-discovery.node.test.ts tests/room.test.ts tests/settings-schema.test.ts tests/vad.test.ts \
  > <sandbox>/suite-final.txt 2>&1; echo "EXIT_SUITE=$?"
```

```
Sat Oct 31 01:05:37 UTC 2026
EXIT_SUITE=0
Sat Oct 31 01:05:38 UTC 2026
# tests 378 / # suites 15 / # pass 378 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0
```

---

## 6. Delta VERIF-005 — DEF 1 (découverte des salons) reçoit un verdict **exécutable**

Régie a raison sur le fond : dans VERIF-005 j'ai écrit n'avoir obtenu aucune
permission d'exécution, alors que dans le même cycle `npx tsx --test` tournait.
Le refus était **par run**, pas par outil — je le corrige ici, dans le delta,
sans réécrire VERIF-005.

Les verdicts **statiques 1 à 5** de VERIF-005 restent acquis tels quels (non
re-mesurés ici, non modifiés). Seul **DEF 1** ( `roomName` non filtré, CR/LF
conservés jusqu'à `App.tsx:323`) change de statut : il est désormais vérifié par
**exécution**.

| Élément | Valeur |
|---|---|
| Correction | `src/engine/net/room-discovery.ts` — `normalizeLabel` : toute suite de blancs/contrôles → une espace, avant troncature (Carillon, propriétaire de `src/engine`). Je n'ai pas modifié ce fichier. |
| Preuve d'exécution | `npx tsx --test tests/room-discovery-sec.node.test.ts` → `# tests 4`, `# pass 4`, `# fail 0`, `# skipped 0`, **EXIT=0** |
| Cas DEF-1 ciblé | `npx tsx --test --test-name-pattern="DEF-1" tests/room-discovery-sec.node.test.ts` → `# tests 2`, `# pass 2`, `# fail 0`, **EXIT=0**, à `2026-10-31T01:04:35Z` |
| Ce que le cas vérifie à l’exécution | nom hostile = « salon » suivi de CR et LF puis « X » → `roomName` rendu = « salon X » ; aucun caractère de contrôle ne subsiste (aucun code de U+0000 à U+001F, ni U+007F) ; `host` / `port` / `roomId` restent ceux de l’annonce réelle, inchangés par le nom |
| Statut du cas | l'ex-`skip` est **actif** (4 tests, 0 skip) : c'est une garde anti-régression, pas une note |

Ce que ce delta **ne** prouve pas : que le nom normalisé est celui affiché par
l'UI (`App.tsx`) — je n'ai pas d'exécution Electron dans ce run, la chaîne
`ipc-contract → renderer` reste vérifiée **statiquement** (verdict 4 de
VERIF-005). Point nommé comme non vérifié.

---

## 7. Ce qui reste NON vérifié (nommé, pas contourné)

1. **`tsc` sur les autres configurations** : `tsconfig.main.json` et le build
   Vite (`npm run build`) n'ont pas été exécutés dans ce run. `EXIT=0` vaut pour
   `-p tsconfig.json`, la commande que Régie a fixée comme objectif T11 —
   pas pour le reste.
2. **`npm run typecheck`** : non relancé séparément ; il pointe sur la même
   configuration, mais je ne l'affirme pas sans l'avoir vu sortir. Seule la
   commande du §1 est mesurée.
3. **`npm test` complet via le script npm** : j'ai lancé `npx tsx --test` avec la
   liste de fichiers de `scripts.test:node`, pas le script lui-même ; le compte
   est donc attribuable fichier par fichier, mais le wrapper npm n'est pas
   mesuré.
4. **Exécution Electron / runtime LAN** : hors périmètre de ce run (aucun
   affichage, aucun `nodeIntegration` testé ici).
5. **`!` restants ailleurs que dans `tests/`** : mon contrôle porte sur
   `tests/*.ts`. `src/` n'est pas de mon périmètre et n'a pas été audité ici.

---

## 8. Rappel de la règle de livraison (défaut T8 n° 1)

Le titre du livrable de ce rapport ne contient **ni `/` ni caractère de chemin**
(l'ancien titre « … — 1212 runnables, 371371… » a produit des doublons parce
qu'un `/` a cassé le nom de fichier). Les deux artefacts T8 déjà livrés **ne
sont pas re-livrés une troisième fois** : le doublon se supprime côté owner.
