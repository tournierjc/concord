# VERIF-003 — Audit de vérification T7 (et correction du rapport T6)

**Auteur** : Banc (desk-qa) · **Date du rapport** : 2026-10-31, fenêtre d'exécution **00:21:03 → 00:23:00 (+01:00)**
**Arbre audité** : `/work/lan-voice` (pas de dépôt git : `git status` → `fatal: not a git repository` → aucun diff possible, tout est horodaté par `mtime` + `date -Is`).
**Portée** : constat et mesure uniquement. **Aucune écriture dans `src/` ni dans `tests/`** (voir §9).

---

## 1. Correction du rapport T6 — le chiffre principal était faux

> **« le chiffre de 255/0 du rapport T6 était erroné, le compte réel est 244/242/2 (2026-10-31T00:21:05), puis 244/243/1 (00:22:08), puis 281/281/0 (00:22:44). »**

Reformulé sans excuse :

- Le rapport T6 (VERIF-002) annonçait **`# tests 255 / # pass 255 / # fail 0`** et « 60 suites ».
- Le compte réel, obtenu en relançant la suite sur l'arbre tel qu'il est, est **244 tests / 242 pass / 2 fail** au premier passage, **244/243/1** 63 s plus tard, et **281/281/0** à 00:22:44 (les auteurs réparaient pendant la mesure — §5).

**Cause factuelle** (pas une excuse, un défaut de méthode) :
`VERIF-002` a cité une **commande composée à la main sur une liste de fichiers non vérifiée**, figée sur un `ls tests/*.test.ts` de **00:05**, et le chiffre n'a **jamais été relancé** avant publication. Preuve dans mon propre journal brut `VERIF/raw/t6-tests-20261031-0005.log` : les avertissements du chargeur y nomment `tests/device-selection.test.ts` (fichier qui **n'existe plus**, renommé depuis en `tests/device.test.ts`), et les suites `device-selection — …` y figurent en `ok 1…4`. La liste citée en T6 décrivait donc un état de l'arbre qui n'était plus celui du dépôt à la publication.

Trois erreurs distinctes dans la citation T6, à séparer :

| Fichier cité dans T6 | Réalité à 00:23 |
|---|---|
| `tests/room-machine.test.ts` | **n'existe pas** (le fichier actuel est `tests/room.test.ts`) |
| `tests/device-selection.test.ts` | **n'existe pas** (le fichier actuel est `tests/device.test.ts`) |
| `tests/local-signaling.test.ts` | **omett** de la citation ; il n'existait pas à 00:05 (créé à 00:21:49), il pèse aujourd'hui 17 tests |
| `tests/ice-filter.test.ts` | **omett** de la citation alors qu'il **a bien été exécuté** dans le run de 00:05 (`ok 11 - ice-filter — candidats à REJETER`, `ok 12 - ice-filter — candidats à ACCEPTER`) |

Seconde erreur, non signalée par la Régie et que je corrige aussi : le « **60 suites** » de T6 n'est pas la ligne du rapporteur. Le log brut de 00:05 contient `# suites 24` — mon 60 était un compte de lignes `ok N -` de premier niveau, pas le compte de suites de `node --test`. **Les deux chiffres de la ligne « run global » de VERIF-002 sont donc non fiables.**

Extrait brut du log T6 (pour situer, il est authentique, c'est son **usage** qui était fautif) :

```
# tests 255
# suites 24
# pass 255
# fail 0
# skipped 0
# todo 0
# duration_ms 133.726948
```

---

## 2. Méthode et commandes exactes

Répertoire de travail : `/work/lan-voice`. Node : `v22.23.4` (`node --version`). Chaque exécution est datée par un `date -Is` pris **juste avant** le lancement, dans la même invocation shell.

| # | Commande exacte | Sorties conservées |
|---|---|---|
| R1 | `node --test tests/*.test.ts` | `raw/full-suite.txt` (snapshot **A**) |
| R2 | `node --test tests/<fichier>` en boucle `for f in tests/*.test.ts` | `raw/one-<fichier>.txt` (ledger **A**) |
| R3 | `node --test tests/*.test.ts` | `raw/full-suite-B.txt` (snapshot **B**) |
| R4 | boucle `for f in tests/*.test.ts; do node --test "$f"; done` | `raw/B-<fichier>.txt` (ledger **B**) |
| R5 | `node --test tests/*.test.ts` | `raw/full-suite-C.txt` (snapshot **C**) |
| R6 | boucle identique | `raw/C-<fichier>.txt` (ledger **C**) |
| R7 | `node --test tests/ipc-contract.test.ts` | `raw/ipc-contract.txt` |

Note de méthode : `node --test tests/` (répertoire) **échoue** sur cette version — `Error: Cannot find module '/work/lan-voice/tests'`. Il faut le glob `tests/*.test.ts`. C'est aussi ce qui rend une liste de fichiers manuelle dangereuse : le glob, lui, ne peut pas être périmé.

---

## 3. Sorties brutes du run global

### Snapshot A — **2026-10-31T00:21:05+01:00** — `node --test tests/*.test.ts`

```
not ok 12 - engine — pureté (SPEC-004)
not ok 4 - tests/ice-filter.node.test.ts
# tests 244
# pass 242
# fail 2
# skipped 0
# todo 0
# duration_ms 143.897162
```
`EXIT=1`. **C'est le chiffre demandé : 244 / 242 / 2.** Il reproduit exactement le vôtre.

### Snapshot B — **2026-10-31T00:22:08+01:00** — même commande

```
not ok 4 - tests/ice-filter.node.test.ts
# tests 244
# pass 243
# fail 1
# skipped 0
# duration_ms 155.485167
```
`EXIT=1`. Entre A et B (63 s), `src/engine/net/local-signaling.ts` a été réécrit à **00:21:30** et le test `Date.now` est passé au vert sans que j'aie touché à rien.

### Snapshot C — **2026-10-31T00:22:44+01:00** — même commande

```
# tests 281
# pass 281
# fail 0
# duration_ms 148.759551
```
`EXIT=0`. `tests/ice-filter.node.test.ts` a été réécrit à **00:22:35** (38 tests au lieu de 1).

### Snapshot D — **2026-10-31T00:24:17+01:00** — même commande (contrôle de stabilité)

```
# tests 281
# pass 281
# fail 0
# duration_ms 148.521727
```
`EXIT=0`. Identique à C : l'état vert est stable sur ~90 s, il n'est pas un accident de course.

---

## 4. Ledger de tests — fichier par fichier, horodaté

**11 fichiers `tests/*.test.ts`** (compte obtenu par `ls tests/*.test.ts | wc -l` → `11`).

### Ledger A — 2026-10-31T00:21:11 → 00:21:13

| # | Fichier | tests | pass | fail | exit | durée (ms) |
|---|---|---|---|---|---|---|
| 1 | `tests/device.test.ts` | 11 | 11 | 0 | 0 | 85.21 |
| 2 | `tests/engine-purity.test.ts` | 135 | 134 | **1** | **1** | 118.35 |
| 3 | `tests/gain.test.ts` | 15 | 15 | 0 | 0 | 107.11 |
| 4 | `tests/ice-filter.node.test.ts` | 1 | 0 | **1** | **1** | 69.45 |
| 5 | `tests/ice-filter.test.ts` | 1 | 1 | 0 | 0 | 80.39 |
| 6 | `tests/ipc-contract.test.ts` | 12 | 12 | 0 | 0 | 103.60 |
| 7 | `tests/local-signaling.test.ts` | 17 | 17 | 0 | 0 | 81.85 |
| 8 | `tests/overlay-geometry.test.ts` | 13 | 13 | 0 | 0 | 69.69 |
| 9 | `tests/room.test.ts` | 13 | 13 | 0 | 0 | 76.39 |
| 10 | `tests/settings-schema.test.ts` | 11 | 11 | 0 | 0 | 97.52 |
| 11 | `tests/vad.test.ts` | 15 | 15 | 0 | 0 | 84.61 |
| | **somme** | **244** | **242** | **2** | | |

La somme par fichier égale **exactement** le run global A (244/242/2) : la boucle et le glob concordent.

### Ledger C — 2026-10-31T00:22:47 → 00:22:48

| # | Fichier | tests | pass | fail | exit |
|---|---|---|---|---|---|
| 1 | `tests/device.test.ts` | 11 | 11 | 0 | 0 |
| 2 | `tests/engine-purity.test.ts` | 135 | 135 | 0 | 0 |
| 3 | `tests/gain.test.ts` | 15 | 15 | 0 | 0 |
| 4 | `tests/ice-filter.node.test.ts` | **38** | 38 | 0 | 0 |
| 5 | `tests/ice-filter.test.ts` | 1 | 1 | 0 | 0 |
| 6 | `tests/ipc-contract.test.ts` | 12 | 12 | 0 | 0 |
| 7 | `tests/local-signaling.test.ts` | 17 | 17 | 0 | 0 |
| 8 | `tests/overlay-geometry.test.ts` | 13 | 13 | 0 | 0 |
| 9 | `tests/room.test.ts` | 13 | 13 | 0 | 0 |
| 10 | `tests/settings-schema.test.ts` | 11 | 11 | 0 | 0 |
| 11 | `tests/vad.test.ts` | 15 | 15 | 0 | 0 |
| | **somme** | **281** | **281** | **0** | |

### Point d'honnêteté sur `tests/ice-filter.test.ts` (le mien)

`node --test` ne compte **1 test** pour ce fichier alors qu'il contient 8 blocs `it()` dont deux `it.each` (11 + 11 lignes). Cause : le fichier importe `vitest`, et `node_modules/vitest/index.js` est un **shim de secours** (3,8 Ko, écrit par Carillon) qui exécute les cas **à l'import** ; le rapporteur ne voit donc qu'un seul test.

J'ai mesuré le nombre réel de cas sans toucher au fichier du dépôt : copie instrumentée dans mon sandbox (`sandbox/count-cases/`, shim + compteur), exécutée à **00:22:06** :

```
# __CASES_EXECUTED=28 __SKIPPED=0
ok 1 - ice-filter.copy.test.ts
# tests 1 / pass 1 / fail 0
```

Donc : **1 test rapporté = 28 cas réellement exécutés, 0 cas sauté, 28/28 verts**. Les 3 `describe.skipIf(!isLan)` et le `it.skipIf(!filterFn)` **n'ont pas** sauté (les deux exports existent). Ce chiffre de 28 ne doit pas être additionné aux 244 : il explique seulement que le « 1 » du ledger est trompeur à la baisse.

---

## 5. Les deux échecs du snapshot A — dont un correctif en vol

### 5.1 `not ok 67 - net/local-signaling.ts — pas de horloge Date.now()` (engine-purity, SPEC-004)

Extrait brut (`raw/full-suite.txt`, l. 470-481) :

```
      duration_ms: 0.025056
      type: 'test'
      ...
    # Subtest: net/local-signaling.ts — pas de horloge Date.now()
    not ok 67 - net/local-signaling.ts — pas de horloge Date.now()
      ---
      duration_ms: 4.808387
      type: 'test'
      location: '/work/lan-voice/tests/engine-purity.test.ts:84:7'
      failureType: 'testCodeFailure'
      error: |-
        net/local-signaling.ts : « horl…
```

**Statut : correctif en vol, PAS une régression.** Chronologie mesurée :

- `00:21:05` — run A : échec 67.
- `00:21:30` — `src/engine/net/local-signaling.ts` réécrit (mtime `2026-10-31 00:21:30.523`, 23 525 o contre 23 350 o).
- `00:21:42` — `node --test tests/engine-purity.test.ts` → `# tests 135 / # pass 135 / # fail 0`, `EXIT=0`.
- `00:22:59` — `grep -rn "Date.now(" src/engine/` → **aucune ligne** (`exit=1`).

Le fichier ne contient plus `Date.now`. L'échec de A photographie un état de l'arbre qui a disparu pendant la mesure. Je le compte donc **1 fois, comme « réparé en cours de run »**, pas comme défaut ouvert.

### 5.2 `not ok 4 - tests/ice-filter.node.test.ts`

Sortie brute du fichier seul (**2026-10-31T00:21:47**) :

```
TAP version 13
# file:///work/lan-voice/tests/ice-filter.node.test.ts:20
#   evaluateCandidate,
#   ^^^^^^^^^^^^^^^^^
# SyntaxError: The requested module '../src/engine/rtc/ice-filter.ts' does not provide an export named 'evaluateCandidate'
```

**Statut : correctif en vol, PAS une régression.** Le fichier de test (mtime `00:00:41`) importait 11 symboles d'un module qui n'en exporte que 2 :

```
$ grep -nE "^(export|module.exports)" src/engine/rtc/ice-filter.ts
140:export function isLanCandidate(
164:export function filterLanCandidates<T extends string | IceCandidateLike>(
```
```
$ grep -c evaluateCandidate src/engine/rtc/ice-filter   →  0
```

`tests/ice-filter.node.test.ts` a été réécrit à **00:22:35** ; son en-tête cite nommément « Réparation (DÉFAUT B, tâche 32c4984f) ». Relancé à **00:22:45** :

```
ok 1 - ice-filter — candidats à REJETER (13 cas)
ok 2 - ice-filter — candidats à ACCEPTER (13 cas)
ok 3 - ice-filter — RFC1918 et voisinage, lus à travers le contrat public (5 cas)
ok 4 - ice-filter — filterLanCandidates (3 cas)
ok 5 - ice-fil…
```
→ 38 tests, 38 pass, exit 0. Je ne le compte pas comme régression : les deux tâches que vous citez (32c4984f / 88782fbe) étaient bien en train d'atterrir pendant mes mesures.

### 5.3 Conséquence sur l'interprétation

Aucun des 2 échecs de A n'est imputable à un défaut stable du dépôt. **Mais aucun des deux n'est non plus « vert » de mon fait** : c'est le travail de Carillon qui a changé sous mes yeux. Un rapport qui n'aurait publié que A (comme T6 l'a fait avec un run périmé) aurait été faux dans les deux sens. Les trois snapshots sont donc publiés ensemble.

---

## 6. Audit « LAN uniquement » sur les fichiers neufs

### 6.1 État des trois fichiers demandés (constats datés)

| Fichier | 00:21:26 | 00:22:08 | 00:22:51 | 00:22:56 | 00:23:58 (état du rapport) |
|---|---|---|---|---|---|
| `src/engine/net/room-discovery.ts` | ABSENT | ABSENT | ABSENT | ABSENT | **ABSENT** |
| `tests/room-discovery.node.test.ts` | ABSENT | ABSENT | ABSENT | ABSENT | **ABSENT** |
| `src/main/discovery-bridge.ts` | ABSENT | ABSENT | PRÉSENT (00:22:38) | PRÉSENT | **PRÉSENT** — réécrit 00:23:22, md5 `06b4c22a716cd0c42a4b5e7b442f8a41`, 266 l. |

Deux des trois n'existent pas à l'heure du rapport → **non auditables**. Je publie donc l'audit sur `src/main/discovery-bridge.ts` (le seul né, deux versions observées : 00:22:38 puis 00:23:22) **et** sur l'ensemble de `src/`, et je donne les commandes exactes à rejouer sur `room-discovery` dès qu'il existe.

### 6.2 `src/main/discovery-bridge.ts` — greps bruts (version du 00:23:22, md5 `06b4c22a…`)

```
$ date -Is
2026-10-31T00:23:58+01:00
$ grep -nE 'http://|https://|stun:|turn:|wss://|fetch\(|XMLHttpRequest|telemetry|analytics' src/main/discovery-bridge.ts
(exit=1)   → AUCUN hit
```

**Vide : aucun `http(s)`, `stun:`, `turn:`, `wss:`, `fetch(`, `XMLHttpRequest`, ni mot `telemetry`/`analytics`.** (La version de 00:22:38 avait un unique hit, en commentaire d'en-tête ligne 11, qui énonçait l'absence de ces URL ; la réécriture de 00:23:22 l'a retiré. Même conclusion : rien de réel.)

```
$ grep -nE "account|userId|email|token|nick|pseudo" src/main/discovery-bridge.ts
(exit=1)   → aucun hit : aucune identité de compte, aucun jeton, aucun pseudo transmis.
```

**Ce qui est réellement envoyé/reçu** (lignes 149-156) : `roomName` (tronqué à `MAX_NAME_LENGTH`), `host`, `port`, `participantCount`. Aucun identifiant de personne, aucun identifiant d'installation persistant. Conforme à la promesse « sans compte ».

```
$ grep -nE "bonjour|mdns|dgram|dns" src/main/discovery-bridge.ts
  4: * RÔLE ET LIMITE : … un browse mDNS (`bonjour-service`) et le registre…
 17: * NON VÉRIFIÉ ICI : `bonjour-service` est déclaré dans package.json mais n'est pas installé…
 23:import { Bonjour, type Browser, type Service } from 'bonjour-service';
 46:/** Champ `txt` d'un service mDNS … */
 78:    // bonjour-service rend parfois le TXT en Buffer/octets.
160:  const mdnsHost = typeof service.host === 'string' ? service.host.trim() : '';
162:    mdnsHost.length > 0 && mdnsHost.toLowerCase().endsWith('.local')
229:      bonjour = new Bonjour();
230:      browser = bonjour.find({ type: DISCOVERY_SERVICE_TYPE, protocol: 'udp' }, onUp);
```

Usage de `bonjour-service`, statiquement :
- une seule API utilisée : `new Bonjour()` + `find({ type: 'lanvoice', protocol: 'udp' })` (ligne 33 : `DISCOVERY_SERVICE_TYPE = 'lanvoice'` → service `_lanvoice._udp`), plus `destroy()` à la fermeture (l. 250-252). **Aucun `publish()`, aucun `Browser` unicast, aucun `resolve()` de nom, aucun `dns` de Node importé** (`grep` sur `node:dns` dans tout `src/` : 0 hit) ;
- le nom d'hôte est préféré en `*.local` (l. 162) — cohérent avec du mDNS de lien local ;
- **mais** : voir la réserve ci-dessous, l'acceptation finale de l'hôte est déléguée au registre (`isLanCandidate`), qui **n'existe pas encore**. Le filtrage « LAN » n'est donc, à cette heure, **pas démontrable de bout en bout** : `src/main/discovery-bridge.ts:30` importe `createRoomRegistry, ROOM_DISCOVERY_MAX_ROOMS` depuis `../engine/net/room-discovery` — **fichier absent**.

**Réserve capitale sur `bonjour-service`** :
- il est **déclaré** dans `package.json` (`"bonjour-service": "^1.2.1"`, ligne 20) et **importé** ligne 23 ;
- il **n'est pas installé** : `node -e "require.resolve('bonjour-service')"` → `ABSENT` ; `node_modules/` ne contient que `vitest/` ;
- **conséquence** : le comportement mDNS effectif (multicast `224.0.0.251`, résolution `.local`, absence de requête DNS publique) **ne peut pas être prouvé ici** — le module ne peut pas être chargé, encore moins exécuté. Je ne signe pas « ça reste sur le LAN » : je signe « aucun code sortant et aucun résolveur public statiquement visibles », ce qui n'est pas la même chose. `bonjour-service` fait du multicast mDNS par défaut, mais « par défaut » n'est pas une preuve, et je n'ai pas pu lire son code (paquet absent).

**Point bloquant constaté (je ne corrige pas)** : `src/main/index.ts:22` importe `./discovery-bridge`, qui importe `../engine/net/room-discovery` — **fichier absent**. En l'état, le process principal ne peut pas démarrer (résolution de module impossible). Et `src/main/index.ts:115` appelle `discovery.start()` au démarrage, donc la découverte mDNS est bien branchée sur le chemin de démarrage : c'est précisément le chemin que la promesse « aucun appel sortant au démarrage » devra couvrir, et il n'est testable que quand `bonjour-service` sera installé.

### 6.3 Grep équivalent sur tout `src/` (seul périmètre entièrement présent)

```
$ date -Is                                       → 2026-10-31T00:21:28+01:00
$ grep -rnE 'http://|https://|stun:|turn:|wss://|fetch\(|XMLHttpRequest|telemetry|analytics' src/
src/shell/settings-schema.ts:311:  return: 'Enter',
```

**Un seul hit sur tout `src/`, et c'est un faux positif** : la ligne est `return: 'Enter',` (touche clavier d'une table de raccourcis), qui contient la sous-chaîne `turn:`. **Justifié ligne par ligne : 1 hit, 0 réel.** Zéro `http://`, zéro `stun:`, zéro `fetch(`, zéro `telemetry`.

Complément « appels sortants au démarrage » :

```
$ grep -rnE "loadURL|openExternal|net\.request|net\.fetch|will-navigate|setWindowOpenHandler|defaultSession" src/
src/main/overlay-controller.ts:112:    void window.loadURL(appUrl('overlay.html'));
src/main/index.ts:10: *   CSP stricte posée par en-tête · `setWindowOpenHandler` → deny
src/main/index.ts:12: *   permissions limitées au micro · aucun `shell.openExternal` sur …
```
`appUrl('overlay.html')` construit une URL de schéma applicatif (`app://`), pas réseau. Le serveur de dev Vite est **opt-in** et par défaut nul :
```
src/main/index.ts:43:const DEV_SERVER = process.env['LAN_DEV_SERVER'] ?? null;
```
→ `null` en production, donc `app://` seulement.

```
$ grep -rnE "8\.8\.8\.8|1\.1\.1\.1|dns\.|resolv|node:dns|dns\.lookup|lookup\(" src/
(hits uniquement sur des identifiants contenant « resolv », aucun module `dns`, aucun résolveur public)
```

### 6.4 `Date.now` dans `src/engine/` — règle SPEC-004

```
$ date -Is                          → 2026-10-31T00:22:59+01:00
$ grep -rn "Date.now(" src/engine/
(exit=1)   → AUCUNE occurrence
$ grep -rn "Date.now(" src/ --include=*.ts
src/main/index.ts:58:  now: () => Date.now(),
src/main/discovery-bridge.ts:177:  const now = options.now ?? (() => Date.now());
```

**État constaté à 00:22:59 : conforme.** Plus aucune horloge dans `src/engine/`. Les deux occurrences restantes sont **hors engine** (`src/main/`), donc hors du périmètre de SPEC-004, et elles sont injectées (`now: () => Date.now()`) — c'est le main qui fournit l'horloge, l'engine reste pur. Le test `engine-purity` le confirme : 135/135 à 00:22:47.

**Antériorité** : à 00:21:05, `net/local-signaling.ts` violait encore la règle (échec 67). Réparé à 00:21:30. Je constate, je ne corrige pas.

---

## 7. Non-régression du contrat IPC

```
$ date -Is
2026-10-31T00:21:34+01:00
$ node --test tests/ipc-contract.test.ts
EXIT=0

ok 1 - canaux : noms uniques, préfixe commun, séparés invoke/event
ok 2 - canal inconnu rejeté dans les deux sens, y compris par assertPayload
ok 3 - roomJoin : charge utile stricte
ok 4 - contrôles : mute, push-to-talk, gain
ok 5 - overlaySet : champs optionnels, échelles conformes à la géométrie
ok 6 - settingsSet : objet non vide, sections c…
# tests 12 / pass 12 / fail 0
```

**Conforme : 12/12, exit 0.** Confirmé dans les trois ledgers (12/12 à 00:21:12, 00:22:11 et 00:22:47) — l'amendement du contrat n'a rien cassé.

---

## 8. Ce qui n'est PAS vérifiable ici (et pourquoi)

| Non vérifiable | Preuve du blocage (commandes exactes) |
|---|---|
| **Typecheck `tsc`** | `command -v tsc` → `ABSENT` ; `node -e "require.resolve('typescript')"` → `typescript ABSENT` ; `node_modules/` = `vitest` seulement ; pas de `node_modules/.bin` (`ls: cannot access 'node_modules/.bin': No such file or directory`). **Aucun typecheck n'a été prouvé, ni faux ni vrai.** |
| **Build renderer / main** | `command -v vite` → `ABSENT`, `command -v electron` → `ABSENT`. `npm run build` (= `tsc -p tsconfig.main.json && vite build`) est inexécutable. |
| **Lancement de l'app / test 2 instances + 1 machine distante** | `electron` absent → **aucune mesure de latence, CPU, débit, perte de paquets n'a été faite dans cet audit.** Les chiffres de bout en bout de mon mandat restent à produire. |
| **Capture de trafic « LAN only » à l'exécution** | Pas d'app lançable (ci-dessus) ; et l'outillage réseau manque (`ss`, `lsof`, `netstat` absents lors du chantier T4, repli `/proc/net`). Donc : **preuve statique seulement**, pas de pcacp. |
| **Comportement mDNS de `bonjour-service`** | `require.resolve('bonjour-service')` → `ABSENT`. Multicast, `.local`, absence de DNS public : **non exécuté, non prouvé**. |
| **Démarrage du process principal** | Bloqué par `src/main/index.ts` → `./discovery-bridge` → `../engine/net/room-discovery` **absent**. Défaut de complétude, pas de conformité ; hors de mon périmètre de correction. |
| **`npm ci` / installation des dépendances** | Implique un accès réseau sortant, ce qui contredirait la promesse auditée et n'est pas dans mes accès. Non tenté. |
| **Delta fichier par fichier entre T6 et T7** | Pas de dépôt git (`fatal: not a git repository`) → aucun diff. Seules les `mtime` permettent de dater les réécritures. |
| **`vitest` réel** | `node_modules/vitest` n'est **pas** vitest : c'est un shim de 3 810 o (`index.js`), sans `package.json`. Aucun `vitest run` n'a été exécuté nulle part. |

Le point que je veux rendre impossible à mal lire : **`node --test` qui passe ne prouve pas que le TypeScript compile.** Sur cette machine, aucun fichier `.ts` n'a été typé. Les 135 tests de `engine-purity` peuvent passer sur du TS syntaxiquement invalide.

---

## 9. Attestation : aucun fichier de `src/` (ni de `tests/`) modifié par moi

- Toutes mes écritures de cette session sont dans `/home/node/.mercury/bots/desk-lead/desk-qa/sandbox/` : `raw/` (journal brut), `count-cases/` (copie instrumentée + shim compteur), ce rapport.
- Les fichiers de `src/` et `tests/` ont bien changé pendant mon run — **de 00:21:30 à 00:23:22** — sous la plume de leurs auteurs :
  `src/engine/net/local-signaling.ts` 00:21:30 · `tests/local-signaling.test.ts` 00:21:49 · `tests/ice-filter.node.test.ts` 00:22:35 · `src/main/discovery-bridge.ts` 00:22:38 puis 00:23:22 · `src/main/index.ts` 00:23:08.
- Aucune de ces modifications n'est de moi : je n'ai ouvert aucun de ces fichiers en écriture, et je n'ai utilisé que `read_file` / `sed -n` / `grep` / `node --test` sur l'arbre. La preuve vérifiable est la nature de mes écritures (sandbox uniquement) et l'absence de tout outil d'édition pointé sur `/work/lan-voice`.

---

## 10. Ce qu'il reste à faire (pour la suite, pas pour moi)

1. Rejouer §6 sur `src/engine/net/room-discovery.ts` et `tests/room-discovery.node.test.ts` **dès qu'ils existent** — commandes prêtes en §6.2.
2. Trancher le point bloquant `room-discovery` absent (import cassé au démarrage) : c'est du ressort de Carillon, pas du Banc.
3. Publier un run global unique et daté **après** la fin des réparations, et ne plus jamais citer un chiffre issu d'une liste de fichiers composée à la main : `node --test tests/*.test.ts`, glob, rien d'autre.
4. Installer `typescript` + `electron` pour rendre le typecheck et le build vérifiables — sans quoi la moitié des critères d'acceptation reste indémontrable.
