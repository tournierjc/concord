# VERIF-021 — T17 : juge de la garde (ICE local, surfaces gelées, DÉFAUT-E)

Banc (desk-qa) · 2026-10-31 · mesures 02:23:38Z → 02:33:20Z · dépôt `/work/lan-voice`
Ancrage : empreintes SHA-256 en §1, recalculées **après** la dernière mesure (§1.3).
Demandeur : Régie (tâche `b0f92672`). Aucune source modifiée par ce rapport.

---

## 0. Verdict en cinq lignes

1. **La garde existe et elle est falsifiable** : 10/10 banc vert, **12/12 mutants de comportement
   attrapés**, témoin neutre vert (§5). Les trois défauts visés (canal ICE local, dérive des surfaces,
   horloge 5 s + cause) sont désormais mesurés dans le sens positif, plus dans le sens « rien ne sort ».
2. **La garde du dépôt est incomplète** : sur les mêmes 12 mutants, `tests/` n'en attrape que **8**.
   Manqués : surface mesh (6ᵉ clé), horloge absente, horloge à 3 s, cause disparue → **ces quatre
   assertions n'existent que dans mon banc** (§5.1).
3. **Le dépôt est ROUGE pour une raison de spec, pas de code** : `npm test` = 546/548, 2 échecs =
   règle SPEC-004 « pas de timer » contre `setTimeout` exigé par l'horloge 5 s de SPEC-008 et le
   plafond de ramassage ICE (§6.1). **Arbitrage lead nécessaire** (§6.1).
4. **Un test du dépôt est fragile** : « T17 — plafond de 1 s » mesure `Date.now()` sur 1000–1500 ms et
   tombe sous charge — **3 rouges spurieux observés** sur 14 exécutions (§6.3).
5. **NON VÉRIFIÉ** : tout ce qui exige Chromium réel — ramassage ICE effectif, `addIceCandidate`
   accepté, connexion entre deux vrais pairs, mDNS, latence/débit/CPU réels (§7).

---

## 1. Ancrage — empreintes et dérive du dépôt pendant la mesure

### 1.1 Empreintes au début de la mesure (T0 = 2026-10-31T02:23:38Z)

Fichier de référence : `/work/lan-voice/.verif-t17/empreintes-T0.txt` (copie des fichiers au T0 :
`…/desk-qa/sandbox/t17/snap-T0/`). Contrôle automatique : test **T17z** du banc (`sha256sum` comparé
au manifeste) — il est vert, donc les chiffres ci-dessous portent bien sur ce code.

```
7969eb50df4d488196fcaff82df03678b91d3368e6d94732acebbcdeb313c377  src/engine/net/mesh.ts
25db1a66e3bc8bb2a9942707b3c853b00efb7fed915364f96193cf120828f192  src/engine/rtc/media-plane.ts
80110d8a08d4fef54df84612bf5b1629d351a600fb01190f3f89a7861232336e  src/engine/rtc/ice-filter.ts
63a2322fcc7d38ce79212753dfbb7b80282b68dc9ef680de5dc6ae8e4c47fffe  src/renderer/voice-mesh.ts
12d48580bdb881b85829fe6b0354c0467f7202cc83a55cb3d708f26b9824ce63  src/renderer/voice.ts
d20c9cf2f6fe2247afa3caaf5876f7a53fa5838af1290f6905dd362b807637dd  tests/fake-rtc.ts
8acb18944155175fa24656eb9de5ba40cec85115f039067a66da570705952554  tests/voice-mesh.node.test.ts
76a1c69bf3421821d3df3d476fa9d9a62b687a69eaa14bcb2402c535bdca4bfe  tests/mesh.test.ts
c55809aa8e1ea7590f45ae6d97016c2a7e015f1543a3acc7209b5fe0c0f4fce1  tests/media-plane.node.test.ts
afd55b39b2f0c920a9ed6b586dd804d8f4f61d6ed7b8107e8cf492b8484869f6  tests/engine-purity.test.ts
53326963d9a98420725cad671872e0a0f6fdf41ff79eda7d145988dc452cc861  tests/scripts-coverage.node.test.ts
68eac3f5a7f19d1eeba0f8c526d07430c2867c5051330be993531d0c4781e92f  package.json
```

Les deux empreintes annoncées par Cadre (`tests/scripts-coverage.node.test.ts` = `533269…`,
`package.json` = `68eac3…`) **correspondent** : le rebanc de C5 (marqueur unique) a bien été mesuré
sur ces octets-là (contrôle C0 = 4/4 vert dans mon exécution de `scripts-coverage.node.test.ts`, §5.2).

### 1.2 La seule dérive observée (hors T17)

`package.json` a changé à **02:28:04Z** sous mes mesures : `68eac3f5…` → `785510e4…`. Delta unique :
la liste `test:node` gagne `tests/participant-state.test.ts` (**21 → 22 fichiers**). Ce n'est pas T17,
c'est une tâche concurrente. Tous les fichiers `src/` de T17 et `tests/fake-rtc.ts` sont **identiques
au bit près** entre T0 et la fin (`7969eb50…`, `25db1a66…`, `63a2322f…`, `d20c9cf2…`) : les
conclusions T17 valent pour les deux ancrages.

### 1.3 Empreintes à la fin (2026-10-31T02:30:12Z)

```
7969eb50… mesh.ts            25db1a66… media-plane.ts      63a2322f… voice-mesh.ts
d20c9cf2… fake-rtc.ts        8acb1894… tests/voice-mesh.node.test.ts
76a1c69b… tests/mesh.test.ts c55809aa… tests/media-plane.node.test.ts
afd55b39… tests/engine-purity.test.ts  53326963… tests/scripts-coverage.node.test.ts
785510e4… package.json   ← a bougé (T18, cf. §1.2)
banc-t17.node.test.ts = 1c161f71… (fichier de mesure, à côté du dépôt)
```

---

## 2. (a) T3c réécrit — le canal ICE local, sens positif

**Ce que j'ai remplacé.** Ma T3c de VERIF-020 (« un candidat réellement ramassé ne sort pas ») était
verte tant que le puits était muet : elle constatait un zéro, pas une arrivée. Elle est remplacée par
quatre mesures qui exigent que le canal **existe et porte l'identité** :

| # | Assertion | Mesure au T0 |
|---|---|---|
| T17a/1 | 3 candidats LAN injectés sur la connexion de A ⇒ **4** messages `ice` (3 + fin de ramassage), tous `to:'A'`, charge utile `{candidate,sdpMid,sdpMLineIndex}` **intacte** | 4 messages, `to:"A"`, lignes 192.168.1.10 / .11 / 10.0.0.7 + `null` |
| T17a/2 | 2 pairs : candidat de A ⇒ 1 message vers A **seulement**, candidat de B ⇒ 1 message vers B, **aucune diffusion** | 2 messages, `A→candidate:1…`, `B→candidate:2…` |
| T17a/3 | candidat `srflx` public + ligne illisible ⇒ **0 émission** et avertissement `REFUSÉ (non host/LAN)` | 0 émission, avertissement présent |
| T17a/4 | `ice` reçu de A ⇒ `addIceCandidate` **une fois sur la connexion de A**, `0` sur celle de B ; `ice` d'un pair inconnu ⇒ aucun effet | `addedCandidates(A)=[{…LAN_A}]`, `(B)=[]` |

Commandes :

```
npx tsx --test .verif-t17/banc-t17.node.test.ts          # 10/10, 118 ms  (02:27:31Z)
grep -n "addEventListener\|onicecandidate" src/engine/rtc/media-plane.ts   # site unique d'émission
```

**« Il doit rougir si le canal disparaît » — prouvé, pas affirmé** : mutant `m5_wire_coupe`
(`voice-mesh.ts`, la ligne `current.onLocalCandidate(peerId, candidate)` remplacée par des `void`) ⇒
**2 rouges** (T17a/1 et T17a/2). Mutant `m4_mesh_diffuse` (émission vers tous les pairs au lieu du pair
émetteur) ⇒ **1 rouge** (T17a/2). Mutant `m1_plane_sans_pair` (`notify('', init)`) ⇒ **2 rouges**.

---

## 3. (b) Dérive des deux surfaces runtime gelées

Listes **écrites à la main depuis le contrat** (pas lues dans les sources) : un ajout, un retrait ou un
renommage rougit même si les sources se déclarent d'accord avec elles-mêmes.

```
mesh           (5) : addCandidate close onLocalCandidate onSignal peers
media-plane    (9) : accept acceptAnswer addRemoteCandidate attach close level setTransmitting
                     startMicrophone stats
```

Arités vérifiées : `onLocalCandidate.length === 2` (l'identité du pair **est** le contrat),
`addCandidate === 2`, `onSignal === 1`, `close === 0`, `peers === 0`.
Mesure : `Object.keys(createMesh(...))` et `Object.keys(createMediaPlane(...))` — **égaux aux listes**,
toutes valeurs `function`. Falsification : `m8_mesh_surface_six` (6ᵉ clé `debug`) ⇒ **rouge T17b/1** ;
`m9_plane_surface_sans_level` (8 clés) ⇒ **rouge T17b/2**.

---

## 4. (c) DÉFAUT-E — horloge 5 s et cause

| Assertion | Mesure |
|---|---|
| à **4 999 ms** : aucun `noFlow` | 0 |
| à **5 000 ms** : exactement 1 `noFlow`, `onPeerState` reçoit **3 arguments**, `(peerId,state,cause) = ('b','noFlow','timeout')` | 1 / 3 args / `'b'`,`'noFlow'`,`'timeout'` |
| `noFlow` n'est **pas terminal** : réponse tardive ⇒ `connected`, cause `'ice'` | 1 `connected`, cause `'ice'` |
| horloge **désarmée** par réponse, par `peer-left`, par `close()` (tick 5 000 ms ⇒ 0 `noFlow`) | 0 / 0 / 0 |
| chemin d'échec : `accept()` qui rejette ⇒ `failed` avec cause `'ice'`, 3 arguments | 1 `failed`, cause `'ice'` |

Horloge pilotée par `mock.timers` de `node:test` (deterministe, pas d'attente réelle).
Falsification : `m10_horloge_absente` (appel `armClock` retiré) ⇒ rouge ; `m11_horloge_3s`
(`FLOW_TIMEOUT_MS = 3_000`) ⇒ rouge (le tick à 4 999 ms voit déjà le `noFlow`) ;
`m12_cause_disparue` (`notify(peerId,'noFlow',undefined)`) ⇒ rouge. **C'est exactement le trou de la
garde du dépôt** : ces trois mutants y restent verts (§4.3).

---

## 5. (d) Table de mutants — attrapés / manqués

Protocole : chaque mutant est appliqué par **remplacement littéral exact, une seule occurrence**
(`.verif-t17/patch.py`), sur une **copie isolée** du dépôt (`<copie>/src` + `<copie>/tests` +
`node_modules` en lien symbolique) ; le dépôt n'est jamais modifié. Pour chaque mutant :

* colonne **banc** : `VERIF_ROOT=<copie> npx tsx --test .verif-t17/banc-t17.node.test.ts`
* colonne **dépôt** : `npx tsx --test tests/voice-mesh.node.test.ts tests/mesh.test.ts tests/media-plane.node.test.ts`

Exécution : **02:26:14Z**, 13 mutants, logs `…/sandbox/t17/mut-022614Z/<mutant>/{banc,repo}.log`.

| # | Mutant | Fichier | Banc | Dépôt |
|---|---|---|---|---|
| m1 | `onLocalCandidate` sans pair (`notify('', init)`) | media-plane.ts | **attrapé** (a/1, a/2) | attrapé (T3, media-plane) |
| m2 | filtre LAN supprimé sur le candidat local | media-plane.ts | **attrapé** (a/3) | attrapé (media-plane) |
| m3 | `sdpMid` perdu (`null`) | media-plane.ts | **attrapé** (a/1) | attrapé (T3) |
| m4 | émission ICE vers **tous** les pairs | mesh.ts | **attrapé** (a/2) | attrapé (T3) |
| m5 | fil `plane → mesh` coupé | voice-mesh.ts | **attrapé** (a/1, a/2) | attrapé (T3) |
| m6 | fin de ramassage (`null`) non signalée | media-plane.ts | **attrapé** (a/1) | attrapé (media-plane) |
| m7 | réception ICE perdue (`addCandidate` non appelé) | mesh.ts | **attrapé** (a/4) | attrapé (T3 + 5 sous-tests mesh) |
| m8 | **6ᵉ clé** sur la surface mesh | mesh.ts | **attrapé** (b/1) | **MANQUÉ** (seul le test fragile « plafond 1 s » est tombé) |
| m9 | clé `level` retirée de la surface plan média | media-plane.ts | **attrapé** (b/2) | attrapé (media-plane : `level() = RMS`) |
| m10 | appel `armClock(link)` retiré | mesh.ts | **attrapé** (c/1) | **MANQUÉ** (0 sous-test) |
| m11 | `FLOW_TIMEOUT_MS = 3_000` | mesh.ts | **attrapé** (c/1) | **MANQUÉ** (aucune assertion d'horloge) |
| m12 | cause retirée (`undefined`) | mesh.ts | **attrapé** (c/1) | **MANQUÉ** (0 sous-test) |
| m13 | **témoin neutre** : texte d'avertissement renommé | mesh.ts | **vert (attendu)** | vert (attendu) |

### 5.1 Bilan honnête

* **Banc : 12/12 mutants de comportement attrapés, 0 manqué, témoin neutre vert.** Aucun de mes tests
  n'est décoratif sur ces 12 classes de défaut.
* **Dépôt : 8/12.** Les quatre manqués sont nommés : **surface mesh non gelée par un test**,
  **horloge 5 s non testée**, **durée de l'horloge non testée**, **cause de `onPeerState` non testée**.
  Autrement dit : le code de DÉFAUT-E pourrait être supprimé entièrement et `npm test` resterait vert
  (à la réserve du test fragile près). **C'est le trou que ma tâche devait rendre visible.**
* Le mutant `m13` reste vert des deux côtés : c'est un changement de **texte**, sans effet
  comportemental. Un test qui l'attraperait testerait du décor, pas la promesse.

---

## 6. (e) Mesures — 2026-10-31T02:29Z → 02:30Z

| Mesure | Commande exacte | Résultat |
|---|---|---|
| suite complète | `npm test` | **exit 1** · 548 tests / 35 suites / **546 pass / 2 fail** · 1 257 ms |
| typage | `npx tsc -p tsconfig.json --noEmit` | exit **0**, 0 erreur |
| build principal | `npm run build:main` | exit **0** |
| build renderer | `npm run build:renderer` | exit **0** · **51 modules** · **452 ms** |
| `lan:signal` dans le renderer | `grep -r lan:signal src/renderer \| wc -l` | **0** (le canal IPC reste côté shell : `src/shell/ipc-contract.ts:34`) |
| `<audio>` | `grep -o "<audio" src/renderer/*.ts \| wc -l` | **5** (`audio-sink.ts` 2, `voice.ts` 3) |
| dépendances | `package.json` §`dependencies` | **`bonjour-service` seule**, inchangée depuis T0 : **0 dépendance ajoutée** |
| contrôles LAN | `sh VERIF/run-all.sh` | **exit 1** · PASS `check-deps`, `check-labels` · FAIL `no-external`, `engine`, `shell`, `tests` |

### 6.1 Les 2 échecs de `npm test` — conflit de SPEC, pas régression de code

```
not ok 85  - net/mesh.ts — pas de timer setTimeout/setInterval
not ok 180 - rtc/media-plane.ts — pas de timer setTimeout/setInterval
```

Cause datée : `src/engine/net/mesh.ts` (`setTimeout` de l'horloge 5 s) et
`src/engine/rtc/media-plane.ts` (`setTimeout` du plafond de ramassage `ICE_GATHERING_CAP_MS = 1_000`).
La règle SPEC-004 (`tests/engine-purity.test.ts:72`, motif `/\bset(Timeout|Interval|Immediate)\s*\(/`)
interdit tout timer dans `src/engine/`. **Les deux exigences sont incompatibles telles qu'écrites** :
soit on exempte les deux sites nommés (avec la contrainte « `unref()`, jamais de scrutation »), soit on
sort l'horloge du moteur. Je ne tranche pas : c'est un arbitrage de spec (§7.1).

### 6.2 `run-all.sh` — détail des 4 rouges

* `check-no-external` **FAIL** : `files=552 hits=22 horslan=2`. Les **2** occurrences hors-LAN sont
  **préexistantes**, hors `src/`, dans `VERIF/.verif-t12/egress-control.js` (URL `example.com` et
  `registry.npmjs.org` d'un harnais d'egress daté du 30/10). Aucun départ hors LAN depuis `src/`.
  *Transparence* : mon premier passage affichait `horslan=6` — les 4 de trop venaient de **ma propre
  copie** de `tests/fake-rtc.ts` (lignes `stuns:`/`turns:`) que j'avais laissée dans le dépôt ; je
  l'ai déplacée dans mon bac à sable à 02:27:30Z, et le compte est retombé à 2. Le contrôle est donc
  utile : il attrape un `stun:` oublié dans l'arbre.
* `check-engine` **FAIL** : exactement le timer de `mesh.ts` (§6.1).
* `check-shell` **FAIL** : S3 = le même `check-no-external` (verdict hérité, 2 occurrences t12).
* `check-tests` **FAIL** : 18/22 verts, 2 en échec, 2 non exécutables :
  `tests/engine-purity.test.ts` (2, §6.1) ; `tests/media-plane.node.test.ts` (1, test fragile §6.3) ;
  **non exécutables** : `tests/signaling-link.node.test.ts` (`src/engine/net/local-signaling` absent) et
  `tests/participant-state.test.ts` (`src/renderer/participant-state` absent — test de T18 ajouté à
  02:28:04Z avant son module). Ces deux derniers sont **hors T17** et livrés tels quels à l'arbitrage.

### 6.3 Test fragile — « plafond de 1 s » (décoratif par construction sous charge)

`tests/media-plane.node.test.ts:447` mesure `Date.now()` :
`assert.ok(elapsed >= 1000 && elapsed < 1500)`. Fenêtre de 500 ms sur une machine qui exécute 13 copies
du banc en parallèle : **3 rouges spurieux observés** (m8, m11, et `check-tests` du 02:29Z) alors que le
code mesuré était sain. Un test dont le rouge dépend de la charge ne prouve rien : il faut le rendre
déterministe (`mock.timers`) ou l'élargir explicitement.

---

## 7. NON VÉRIFIÉ — ce qui exige Chromium réel

Rien de ce qui suit n'est mesuré ici ; aucun chiffre de ce rapport ne doit être lu comme une preuve sur
ces points.

1. **Ramassage ICE réel** : je **fabrique** les candidats (`FakePeerConnection.fireIceCandidate`). Que
   Chromium produise ≥1 candidat host LAN, et lesquels, n'est pas mesuré.
2. **`addIceCandidate` accepté** : le faux enregistre l'appel ; le succès/échec réel de l'ajout, non.
3. **Connexion entre deux vrais pairs** : aucune `RTCPeerConnection` réelle n'est instanciée ici
   (`electron --version` = 127 dans cette image, 26 `.so` absentes — SPEC-006 §4). La phrase « deux
   pairs se connectent » reste **non vérifiée**.
4. **mDNS (`*.local`)** : `ice-filter` les accepte par lecture de code ; aucun candidat mDNS réel n'a
   traversé le fil.
5. **Latence, débit, CPU, perte de paquets** : aucune pile audio, aucun socket ; non mesurés.
6. **Transitions `iceGatheringState` et plafond 1 s** : mesurés sur une doublure (`holdGathering`), pas
   sur l'API réelle.
7. **« LAN only » sur le trafic** : vérifié **statiquement** (aucune URL hors LAN dans `src/`, filtre
   LAN sur les candidats) ; **aucune capture de trafic** n'a été faite dans cette passe
   (`VERIF/measure-traffic.sh` existe, non exécuté ici : il exige une session réelle).
8. **Identité du pair à travers Chromium** : `onLocalCandidate(peerId, …)` est vérifié au niveau de la
   couture ; que Chromium associe bien le candidat à la `RTCPeerConnection` du bon pair est vrai par
   construction (une PC par pair) mais non observé en runtime.

---

## 8. Points à arbitrer (je ne tranche pas)

1. **SPEC-004 « pas de timer » vs horloge 5 s** : exempter `mesh.ts`/`media-plane.ts` avec contrainte
   (`unref()`, pas de scrutation) ou déplacer l'horloge ? Tant que ce n'est pas tranché, `npm test` et
   `check-engine` restent rouges pour un code conforme à SPEC-008.
2. **Quatre assertions absentes de `tests/`** (surface mesh, horloge 5 s, durée, cause). Mon banc les
   couvre ; faut-il les rapatrier dans `tests/` (ce serait ma recommandation : ce sont des contrats, pas
   des mesures de banc) ? Je ne modifie pas `tests/` sans mandat.
3. **Titre périmé** dans `tests/voice-mesh.node.test.ts:263` : « candidat local JAMAIS diffusé
   (0 émission) » alors que le corps exige désormais 1 émission par candidat. Le contrat affiché ment
   sur ce qu'il vérifie (titre seulement, assertions à jour).
4. **Test fragile « plafond 1 s »** (§6.3) : le rendre déterministe.
5. **Deux tests non exécutables** (`signaling-link.node.test.ts`, `participant-state.test.ts`) : modules
   absents ; hors T17, mais ils font échouer `check-tests`.

---

## 9. Reproduire

```sh
cd /work/lan-voice

# (a)(b)(c) — banc T17, y compris le contrôle d'empreinte (T17z)
npx tsx --test .verif-t17/banc-t17.node.test.ts            # attendu : 10/10, exit 0

# (d) — 13 mutants sur copies isolées (le dépôt n'est pas touché)
sh .verif-t17/mutants.sh                                    # ~3 min ; logs dans .verif-t17/mut-<HHMMSS>Z/
python3 .verif-t17/summary.py <dossier-mut>                 # tableau attrapés/manqués

# (e) — mesures
npm test ; npx tsc -p tsconfig.json --noEmit ; npm run build:main ; npm run build:renderer
grep -r lan:signal src/renderer ; grep -o "<audio" src/renderer/*.ts ; sh VERIF/run-all.sh
```

Fichiers : banc `.verif-t17/banc-t17.node.test.ts` · mutants `.verif-t17/mutants.sh` +
`patch.py` + `summary.py` · manifeste `.verif-t17/empreintes-T0.txt` · logs
`.verif-t17/mesures/` · copies `.verif-t17/mut-*/` (déplacées dans mon bac à sable
`…/desk-qa/sandbox/t17/` pour ne pas polluer l'arbre scanné par `check-no-external`).

---

## 10. Reprise de contrôle — 2026-10-31T02:31:00Z → 02:33:20Z

Motif : entre T0 (02:23:38Z) et cette reprise, l'arbre a bougé deux fois (T18 : `tests/participant-state.node.test.ts`
ajouté, compte marqué 21 → 22 dans `package.json`), et desk-shell m'a remis une contre-falsification de la garde
`scripts-coverage` (C5) à juger. **Tout ce qui suit est ré-exécuté par moi** sur l'arbre courant.

### 10.1 Empreintes à T1 — quelles empreintes valent encore

```
$ sha256sum -c .verif-t17/empreintes-T0.txt
src/engine/net/mesh.ts: OK                     src/engine/rtc/media-plane.ts: OK
src/engine/rtc/ice-filter.ts: OK               src/renderer/voice-mesh.ts: OK
src/renderer/voice.ts: OK                      tests/fake-rtc.ts: OK
tests/voice-mesh.node.test.ts: OK              tests/mesh.test.ts: OK
tests/media-plane.node.test.ts: OK             tests/engine-purity.test.ts: OK
tests/scripts-coverage.node.test.ts: OK        package.json: FAILED
```

**11 OK / 1 FAILED.** Les 11 fichiers de code et de test — dont `tests/scripts-coverage.node.test.ts` = `53326963…`,
la nouvelle empreinte annoncée — sont **identiques à T0**. Seul `package.json` a bougé : `785510e4…` (compte marqué 22 =
22 fichiers au disque), conformément à §1.2. Le `package.json` de T0 (`68eac3f5…`) n'existe plus dans l'arbre : la garde
a donc été rejouée sur celui qui est là, pas sur une empreinte disparue. Banc : `1c161f71…`, inchangé.

### 10.2 Banc T17 rejoué

```
$ npx tsx --test .verif-t17/banc-t17.node.test.ts          # 2026-10-31T02:32:38Z
exit=0 · # tests 10 · # pass 10 · # fail 0 · 114.8 ms
```

### 10.3 Table de mutants rejouée (run 4, sur copies isolées)

```
$ sh .verif-t17/mutants.sh        # → .verif-t17/mutants-run4.log, copies mut-023137Z/, arbre intact
```

| Mutant | Fichier | Attrapé par le banc | Attrapé par `tests/` |
|---|---|---|---|
| m1 `plane_sans_pair` | media-plane.ts | **oui** (2 assertions) | **oui** (2) |
| m2 `plane_sans_filtre_lan` | media-plane.ts | **oui** (1) | **oui** (1) |
| m3 `plane_sdpmid_perdu` | media-plane.ts | **oui** (1) | **oui** (1) |
| m4 `mesh_diffuse` | mesh.ts | **oui** (1) | **oui** (1) |
| m5 `wire_coupe` | voice-mesh.ts | **oui** (2) | **oui** (1) |
| m6 `plane_fin_ramassage_perdue` | media-plane.ts | **oui** (1) | **oui** (1) |
| m7 `reception_perdue` | mesh.ts | **oui** (1) | **oui** (2) |
| m8 `mesh_surface_six` | mesh.ts | **oui** (1) | **MANQUÉ** |
| m9 `plane_surface_sans_level` | media-plane.ts | **oui** (1) | **oui** (1) |
| m10 `horloge_absente` | mesh.ts | **oui** (1) | **MANQUÉ** |
| m11 `horloge_3s` | mesh.ts | **oui** (1) | **MANQUÉ** |
| m12 `cause_disparue` | mesh.ts | **oui** (1) | **MANQUÉ** |
| m13 `neutre_texte` (témoin) | mesh.ts | non (attendu) | non (attendu) |

**Banc 12/12 attrapés, 0 manqué · dépôt 8/12, 4 manqués** — identique au run 3, sur les empreintes de §10.1.
Sur le critère « mutant non attrapé = test décoratif » : ces quatre-là ne sont pas des tests décoratifs, ce sont des
tests **absents** (aucune assertion de `tests/` ne porte sur la surface mesh, la valeur de l'horloge, sa durée, ni la
cause). Un test décoratif serait vert sur son mutant ; ici il n'y a rien à être vert.

### 10.4 Garde `scripts-coverage` — C0 / C5 / C4a / C4b jugées par moi

Copies isolées (`tests/`, `src/`, `package.json`, `node_modules` en lien), arbre jamais touché :

| Cas | Mutation | Résultat | Verdict |
|---|---|---|---|
| C0 | aucune | **4/4, exit 0** | garde verte sur l'arbre réel (22 fichiers) |
| C5 | `scriptsNote` += « (rappel historique : 12 fichiers au départ.) » | **4/4, exit 0** | **réserve fermée** : le journal daté ne rougit pas |
| C4a | marqueur `22` → `21` | not ok 4, fail 1 | bon rouge |
| C4b | second marqueur « compte courant : 19 fichiers. » | not ok 4 — « trouvé 2 », fail 1 | bon rouge (ambiguïté détectée) |

**Jugement sur « marqueur unique » plutôt que « 1re occurrence »** : fondé. La 1re occurrence est un chiffre daté
légitime (12/13/14/20 dans l'historique) ; ancrer la garde dessus la rendrait fausse par construction, et un test faux
par construction ne protège rien. Le marqueur est désigné par le commentaire de l'assertion : la règle est explicite,
donc non arbitraire.

**Limite résiduelle, nommée** : un « 19 fichiers » ajouté **sans** marqueur ne rougit pas. Je ne demande pas de
resserrement — un test qui rougirait sur tout entier voisin de « fichiers » produirait un faux rouge à chaque entrée de
journal, et un garde qui crie à tort est désarmé en une semaine. Mais cette limite **doit être écrite dans
`docs/TESTS.md`**, sinon le prochain rédacteur croira que tout chiffre faux rougit.

**Piège rencontré, à consigner** : `package.json` est du JSON strict. Ma première greffe a inséré un vrai saut de ligne
dans la chaîne `scriptsNote` → `ERR_INVALID_PACKAGE_CONFIG` (Node refuse le fichier entier, la garde ne s'exécute même
pas). Toute entrée de journal doit être échappée (`\n`) ou n'être qu'un ajout en fin de chaîne.

### 10.5 Mesures rejouées (02:32:17Z → 02:33:20Z)

| Mesure | Commande exacte | Résultat | Exit |
|---|---|---|---|
| Tests | `npm test` | **548 tests / 35 suites / 546 pass / 2 fail** | **1** |
| Types | `npx tsc -p tsconfig.json --noEmit` | 0 erreur | 0 |
| Main | `npm run build:main` | OK | 0 |
| Renderer | `npx vite build` | 51 modules, 447 ms | 0 |
| `lan:signal` hors shell | `grep -rn "lan:signal" src` | **1** occurrence, `src/shell/ipc-contract.ts:34` → **0 côté renderer/engine** | — |
| Surface audio | `grep -rn "<audio" src \| wc -l` | **5** | — |
| Dépendances | `python3 -c "…len(dependencies)…"` | **1 prod** / 11 dev — aucune ajoutée depuis T0 | — |

Les 2 rouges sont les mêmes qu'en §6.1 : `tests/engine-purity.test.ts` interdit `setTimeout` dans `src/engine/**`,
or `mesh.ts:302` (horloge 5 s) et `media-plane.ts:168` (plafond de ramassage) en posent un. **Ce n'est pas une
régression de T17, c'est le conflit SPEC-004 / SPEC-008 déjà arbitré par le lead : il reste ouvert.**

### 10.6 Ce que la reprise change au verdict

Rien sur le fond : les cinq lignes de §0 tiennent, avec les chiffres de §10.5 et la table de §10.3. Deux précisions :

1. La garde `scripts-coverage` est jugée **falsifiable et suffisante** pour ce qu'elle prétend (le compte courant),
   avec la limite de §10.4 écrite noir sur blanc — ce n'est pas une garde contre un chiffre faux ailleurs dans le
   fichier, et elle ne le prétend pas.
2. **NON VÉRIFIÉ, inchangé et non réductible ici** : tout ce qui exige un Chromium réel — ramassage ICE effectif
   (STUN éteint, seuls les candidats host), `addIceCandidate` accepté par le pair, connexion effective de deux vrais
   pairs, résolution mDNS `.local`, latence de bout en bout, débit montant/descendant, CPU au repos et en
   conversation, comportement à 5 % de perte. Aucun de ces chiffres ne figure dans ce rapport, et aucun test de
   `tests/` ne les approche. **Non lancé non plus** : `npm run test:vitest` (hors périmètre T17, signalé par desk-shell).

Aucune source de production n'a été modifiée par cette reprise (`sha256sum -c` = 11 OK, cf. §10.1).
