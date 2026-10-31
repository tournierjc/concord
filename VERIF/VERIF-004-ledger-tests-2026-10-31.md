# VERIF-004 — Ledger de tests honnête : 12 fichiers, 371/371, exit=0

**Auteur** : Banc (desk-qa) — tâche `9c41d7e5` (Régie)
**Date de la campagne** : `2026-10-30T23:28:06Z → 2026-10-30T23:30:40Z`
(soit 00:28:06 → 00:30:40 heure locale CET, 2026-10-31)
**Machine** : conteneur `node`, aucun réseau utilisé, `node v22.23.4`, `tsx v4.23.15`
**Verdict** : `RUNNABLE: 12/12` — 12 fichiers de `tests/`, **371 tests, 371 pass, 0 fail,
0 skip, 12/12 exit=0**. Aucune quarantaine.

Règle appliquée : **aucun compte publié sans exit code + horodatage de début de run.**
Chaque ligne ci-dessous a été produite par un process séparé, un fichier à la fois.

---

## 1. Ledger fichier par fichier (mesure principale)

Commande exacte par ligne (script en §4) :

```
cd /work/lan-voice && npx tsx --test <fichier>   # exit code = celui de npx tsx
```

| # | Fichier | exit | tests | pass | fail | skip | début (UTC) | fin (UTC) |
|---|---|---|---|---|---|---|---|---|
| 1 | tests/device.test.ts | 0 | 11 | 11 | 0 | 0 | 2026-10-30T23:29:59.038Z | 23:29:59.640Z |
| 2 | tests/engine-purity.test.ts | 0 | 154 | 154 | 0 | 0 | 2026-10-30T23:29:59.642Z | 23:30:00.241Z |
| 3 | tests/gain.test.ts | 0 | 15 | 15 | 0 | 0 | 2026-10-30T23:30:00.243Z | 23:30:00.874Z |
| 4 | tests/ice-filter.node.test.ts | 0 | 38 | 38 | 0 | 0 | 2026-10-30T23:30:00.876Z | 23:30:01.501Z |
| 5 | tests/ice-filter.test.ts | 0 | 44 | 44 | 0 | 0 | 2026-10-30T23:30:01.503Z | 23:30:02.156Z |
| 6 | tests/ipc-contract.test.ts | 0 | 12 | 12 | 0 | 0 | 2026-10-30T23:30:02.158Z | 23:30:02.814Z |
| 7 | tests/local-signaling.test.ts | 0 | 17 | 17 | 0 | 0 | 2026-10-30T23:30:02.815Z | 23:30:03.448Z |
| 8 | tests/overlay-geometry.test.ts | 0 | 13 | 13 | 0 | 0 | 2026-10-30T23:30:03.450Z | 23:30:04.060Z |
| 9 | tests/room-discovery.node.test.ts | 0 | 28 | 28 | 0 | 0 | 2026-10-30T23:30:04.062Z | 23:30:04.682Z |
| 10 | tests/room.test.ts | 0 | 13 | 13 | 0 | 0 | 2026-10-30T23:30:04.684Z | 23:30:05.317Z |
| 11 | tests/settings-schema.test.ts | 0 | 11 | 11 | 0 | 0 | 2026-10-30T23:30:05.319Z | 23:30:05.925Z |
| 12 | tests/vad.test.ts | 0 | 15 | 15 | 0 | 0 | 2026-10-30T23:30:05.927Z | 23:30:06.551Z |

**Somme, recalculable :**
`11+154+15+38+44+12+17+13+28+13+11+15 = 371`
`exit≠0 : 0 / 12` — `fail : 0` — `skip : 0` — `todo : 0`
Vérifiée par machine, pas à la main : `awk -F'\t' '{t+=$3;p+=$4;f+=$5;s+=$6} END {print t,p,f,s}'` →
`371 371 0 0`.

**Contre-mesure agrégée, par le script déclaré :**

```
cd /work/lan-voice && npm test          # = npm run test:node
début 2026-10-30T23:30:09.641Z · exit=0
# tests 371 · # pass 371 · # fail 0 · # skipped 0 · # todo 0 · duration_ms 175.7
```

Les deux chiffres (somme des 12 runs séparés = 371 ; run unique = 371) concordent.

**Re-run final après toutes les écritures** (`tests/ice-filter.test.ts`, `package.json`,
`docs/TESTS.md` en place), pour ne pas publier un chiffre antérieur aux correctifs :
`cd /work/lan-voice && npm test` — début `2026-10-30T23:31:54.976Z`, **exit=0**,
`# tests 371 · # pass 371 · # fail 0 · # skipped 0`.

### Croisement avec la mesure de Régie (00:26:49–00:26:55)

Les 11 fichiers déjà exécutables donnent **exactement** les mêmes comptes :
device 11, engine-purity 154, gain 15, ice-filter.node 38, ipc-contract 12,
local-signaling 17, overlay-geometry 13, room-discovery.node 28, room 13,
settings-schema 11, vad 15 → **327/327 exit=0**. Ma mesure du 12ᵉ fichier réparé
ajoute **44** cas : 327 + 44 = **371**. La somme de Régie (327) est donc confirmée
à l'identique, puis étendue.

### Les comptes ne sont pas vides (plancher d'assertions, mesuré)

Nombre d'occurrences statiques d'appels `assert.` par fichier (les cas générés par
boucle — engine-purity 154, ice-filter.node 38, ice-filter 44 — portent leur
assertion dans la boucle, ces chiffres sont donc un plancher, pas un total) :

```
cd /work/lan-voice && for f in tests/*.test.ts; do
  printf "%s assert=%s\n" "$(basename $f)" "$(grep -c 'assert\.' $f)"; done
```

```
device 59 · engine-purity 8 · gain 94 · ice-filter.node 59 · ice-filter 46 ·
ipc-contract 81 · local-signaling 109 · overlay-geometry 91 ·
room-discovery.node 96 · room 117 · settings-schema 92 · vad 88
```

Aucun `skip`, aucun `todo` : `# skipped 0` et `# todo 0` dans les sorties TAP
(vérifié : `grep -h '^# skipped\|^# todo' raw/*.log | sort | uniq -c` →
`13 × "# skipped 0"` et `13 × "# todo 0"` — 12 runs par fichier + le run agrégé
`npm test`, aucun compteur non nul).

---

## 2. Ce qui a été réparé

### 2.1 `tests/ice-filter.test.ts` — « présent et mort » → 44 cas réels

**État mesuré avant (fichier d'origine, run isolé)** :

```
cd /work/lan-voice && npx tsx --test tests/ice-filter.test.ts
début 2026-10-30T23:28:06Z · exit=1 · tests 1 · pass 0 · fail 1 · 0 assertion exécutée
TAP: Error: Transform failed with 1 error:
     tests/ice-filter.test.ts:40:9: ERROR: Top-level await is currently not
     supported with the "cjs" output format
```

Deux défauts cumulés : (a) top-level `await import(...)` transformé en CJS par
esbuild (`package.json` n'a pas `"type":"module"`) ; (b) `import ... from 'vitest'`
alors qu'aucune dépendance n'était installée à cet instant (le seul `vitest`
présent était un stub maison de 3,8 Ko, sans `node_modules/.bin`).

**Correctif** (réécriture complète, contrat inchangé) :

- `import { isLanCandidate, filterLanCandidates } from '../src/engine/rtc/ice-filter.ts'`
  — import **statique**, extension explicite, aucun `await` de niveau module ;
- `node:test` + `node:assert/strict` uniquement (aucune dépendance, aucun réseau) ;
- 44 cas répartis en 7 groupes :

| Groupe | Cas |
|---|---|
| surface du module (2 exports, types) | 2 |
| à REJETER : table (11) + forme objet RTCIceCandidateInit + `undefined`/`null` + entrées non-SDP (42, {}, [], `'typ host'`, `'typ'`) | 14 |
| à ACCEPTER : table (11) + forme objet + préfixe `a=` | 13 |
| bornes RFC1918 : 10/8, 172.16/12, 192.168/16, 169.254/16, 127/8 — bornes exactes **et** voisines immédiates rejetées | 5 |
| CGNAT 100.64/10 : 4 adresses internes + 2 voisines publiques (100.63.255.255, 100.128.0.0), + un `typ host` CGNAT | 2 |
| « le type prime sur l'adresse » : srflx, relay, prflx, type inconnu — tous sur adresse LAN | 4 |
| `filterLanCandidates` : ordre, typage d'entrée conservé, entrée non-tableau, liste 100 % publique | 4 |

Total **44**, tous verts : `exit=0 · tests 44 · pass 44 · fail 0`
(début `2026-10-30T23:30:01.503Z`, voir ligne 5 du ledger).

**Contrôles négatifs — preuve que les assertions mordent** (les deux copies sont
instrumentées en sandbox, `src/` n'est pas touché) :

1. *Mutation d'assertion* (une seule attente inversée : `out.length` 1→2) :
   `exit=1 · tests 44 · pass 43 · fail 1` — `not ok 7 - ice-filter — filterLanCandidates`
   (log écrit `2026-10-30T23:29:03.8Z`).
2. *Mutation du module* (copie de `ice-filter.ts` où `if (parsed.type !== 'host')`
   devient inopérant) contre le même fichier de test :
   `exit=1 · tests 44 · pass 40 · fail 4` — les 4 échecs sont exactement les 4 cas
   « le type prime sur l'adresse » : srflx/relay/prflx/type inconnu sur adresse LAN
   (log écrit `2026-10-30T23:29:07.8Z`).

Conclusion : le fichier ne peut pas être vert si le module accepte un srflx/relay
sur adresse LAN, ni si `filterLanCandidates` rend trop d'éléments.

**Pourquoi ne pas l'avoir supprimé** (option prévue par la tâche) : la comparaison
cas par cas montre que les deux fichiers ne se recouvrent pas entièrement.

| Bloc | ice-filter.node.test.ts (38) | ice-filter.test.ts (44) |
|---|---|---|
| Table REJETER (srflx/relay/prflx/publics/172.32/192.169/11.x/100.64/ligne vide/tronquée) | 11 | 11 (identique) |
| Table ACCEPTER (RFC1918 + link-local + loopback + tcp + composant 2) | 11 | 11 (identique) |
| Forme objet RTCIceCandidateInit | 2 (rejet + acceptation) | 2 |
| `undefined`/`null`, préfixe `a=` | oui | oui |
| Bornes RFC1918 avec voisines immédiates | 1 test groupé (« plat les bornes ») | 4 tests, 16 bornes explicites |
| CGNAT 100.64/10 | 1 adresse dans la table | 6 adresses (4 internes + 2 voisines) |
| « le type prime sur l'adresse » (isolé, nommé) | non isolé | 4 cas nommés |
| Entrées non-SDP (42, {}, [], fragments) | non | 5 |
| IPv6 (ULA / link-local / publique), mDNS, 0.0.0.0 et :: | **oui** (5 cas) | non |
| Bloc SDP multi-lignes nettoyé | **oui** (2 cas) | non |
| `filterLanCandidates` | 3 | 4 |
| Décisions de diagnostic (indépendance composant/transport/port/famille) | **oui** (2 cas) | non |

Le fichier de Carillon est un sur-ensemble sur IPv6/mDNS/SDP ; le mien est un
sur-ensemble sur la matrice de bornes, le CGNAT et la robustesse d'entrée.
Supprimer l'un ferait perdre des cas ; les garder coûte 80 ms. **Décision : garder
les deux, les deux tournent.**

### 2.2 `package.json` — plus de script qui mente

```diff
-    "test": "vitest run"
+    "test": "npm run test:node",
+    "test:node": "npx tsx --test tests/device.test.ts tests/engine-purity.test.ts
+      tests/gain.test.ts tests/ice-filter.node.test.ts tests/ice-filter.test.ts
+      tests/ipc-contract.test.ts tests/local-signaling.test.ts
+      tests/overlay-geometry.test.ts tests/room-discovery.node.test.ts
+      tests/room.test.ts tests/settings-schema.test.ts tests/vad.test.ts",
+    "test:vitest": "vitest run"
   },
+  "scriptsNote": "Vérité mesurée le 2026-10-30T23:29Z …"
```

- liste **explicite** des 12 fichiers (pas de glob) : un futur fichier non
  node-runnable apparaît dans le diff au lieu d'être embarqué en silence ;
- `test` pointe désormais sur le runner qui tourne réellement ;
- `test:vitest` est conservé mais **mesuré rouge** (§2.3), pas présumé bon ;
- clé `scriptsNote` : état mesuré de chaque script, avec horodatage, lisible par
  n'importe qui ouvrant `package.json` (JSON ne permet pas de commentaire) ;
- **aucune dépendance ajoutée, aucun `npm install`, aucun accès réseau.**

### 2.3 `docs/TESTS.md` — la vérité écrite noir sur blanc

Nouveau fichier : prérequis réels (node 22.23.4 ; `tsx` fourni par le **cache npx**
et **non déclaré** dans `package.json`), statut mesuré de chaque script, interdiction
d'`import` de `vitest` et du top-level await dans `tests/*.test.ts` (avec la sortie
d'erreur exacte), et la règle « tout compte publié porte son exit code et son
horodatage ».

**Mesure du script `test:vitest`, pour information — il est rouge même installé :**

```
cd /work/lan-voice && npm run test:vitest
début 2026-10-30T23:30:35.765Z · exit=1
 Test Files  12 failed (12)      Tests  no tests
 # « Error: No test suite found in file … » sur les 12 fichiers
```

Raison : les 12 fichiers utilisent `node:test`, que vitest n'exécute pas. Ce n'est
donc pas un problème de dépendance manquante, c'est un problème de runner.

---

## 3. Ce qui est rouge et ne vient pas des tests (mesuré, non corrigé)

| Commande | Début (UTC) | exit | Constat |
|---|---|---|---|
| `npm run typecheck` (`tsc -p tsconfig.json --noEmit`) | 2026-10-30T23:30:35.773Z | **2** | 52 erreurs TS |
| `npm run build:main` (`tsc -p tsconfig.main.json`) | 2026-10-30T23:30:39.032Z | **2** | 20 erreurs TS |

Répartition des 52 erreurs de `typecheck` : `src/engine/rtc/ice-filter.ts` 8,
`src/shell/ipc-contract.ts` 7, `src/engine/vad.ts` 7, `tests/room.test.ts` 6,
`tests/gain.test.ts` 6, `tests/room-discovery.node.test.ts` 4,
`tests/local-signaling.test.ts` 4, `src/engine/device.ts` 4, `src/engine/gain.ts` 2,
`tests/ice-filter.node.test.ts` 1, `src/renderer/App.tsx` 1, `src/main/index.ts` 1,
+ 1 divers.

**`tests/ice-filter.test.ts` n'ajoute aucune erreur** : 2 erreurs TS2353 lors du
premier jet (`sdpMid` en propriété excédentaire sur le type `IceCandidateLike`),
**corrigées** (variable intermédiaire) — mesuré 2 → 0 après correction. Ce rouge est
donc préexistant aux tests et relève de Carillon / desk-shell, pas du Banc.

Deux variations du compte entre deux runs sont attribuées à des écritures
concurrentes d'autres postes de la flotte, pas à moi :
`node_modules/` installé à `2026-10-31T00:29:03+01:00` (=23:29:03Z) **pendant** ma
campagne (avant : stub `vitest` de 3,8 Ko, pas de `.bin`), et
`src/renderer/App.tsx` réécrit à `00:29:44+01:00` (=23:29:44Z), ce qui ajoute 1
erreur TS à `typecheck` (53 → 52 en brut, dont −2 de mon fait et +1 du sien).
Le Banc n'a écrit **ni dans `src/`, ni dans `tests/`** en dehors de
`tests/ice-filter.test.ts`.

---

## 4. Reproductibilité

Script utilisé pour le ledger (un process par fichier, exit code du runner, pas
celui d'un `tail`) :

```bash
#!/bin/bash
# ledger-run.sh <ledger.tsv> <fichier…>
LEDGER="$1"; shift; cd /work/lan-voice || exit 1
for f in "$@"; do
  start=$(date -u +%FT%T.%3NZ)
  npx tsx --test "$f" > "/tmp/$(basename "$f").log" 2>&1
  code=$?
  tests=$(sed -n 's/^# tests \([0-9]*\)$/\1/p' "/tmp/$(basename "$f").log" | tail -1)
  pass=$(sed -n 's/^# pass \([0-9]*\)$/\1/p'  "/tmp/$(basename "$f").log" | tail -1)
  fail=$(sed -n 's/^# fail \([0-9]*\)$/\1/p'  "/tmp/$(basename "$f").log" | tail -1)
  echo -e "$f\t$code\t$tests\t$pass\t$fail\t$start"
done
```

Sorties TAP brutes conservées pour la campagne (12 + 6 journaux) dans le bac à
sable du Banc : `…/sandbox/raw/` (`device.log`, `ice-filter.log`,
`vitest-run.log`, `npm-test.log`, `typecheck2.log`, …).

---

## 5. Points NON vérifiés (nommés comme tels)

1. **Pas de `git`** dans `/work/lan-voice` : aucun `diff`/`commit` ne prouve mes
   écritures. Preuve disponible : contenu relu des fichiers (`tests/ice-filter.test.ts`,
   `package.json`, `docs/TESTS.md`) + sorties TAP horodatées.
2. **`npm install` non lancé** (pas de réseau) : `dev`, `build:renderer`, `start`,
   `dist` n'ont **pas** été exécutés. Ils sont déclarés tels quels dans `scriptsNote`
   et `docs/TESTS.md`. L'installation de `node_modules` à `23:29:03Z` vient d'un
   autre poste.
3. **`tsx` n'est pas une dépendance déclarée** : `npm run test:node` dépend du cache
   npx de cette machine. Sur une machine vierge, il faudra `npm i -D tsx`.
4. **`typecheck` et `build:main` restent rouges** (52 et 20 erreurs TS). Je n'ai
   corrigé aucune erreur de `src/` : hors de mon périmètre, et une correction à
   l'aveugle pendant que d'autres postes réécrivent ces fichiers produirait des
   conflits. **Conséquence : la compilation n'est pas prouvée ; seul le
   comportement runtime (371 tests) l'est.**
5. **Aucun test LAN réel** (2ᵉ machine, `tcpdump`, perte de paquets, CPU) n'a été
   refait dans cette campagne : hors du périmètre de la tâche. Le présent document ne
   prouve rien sur la promesse « aucun trafic hors LAN ».
6. **Artefact à nettoyer, non touché par respect du périmètre `src/`** :
   `src/engine/rtc/ice-filter` (fichier **sans extension**, miroir CJS du module,
   daté `00:15:22`) n'existait que pour rendre résolvable l'ancien import dynamique
   sans extension de mon test. Depuis la réparation, **aucun fichier ne l'importe**
   (`grep -rn "rtc/ice-filter" tests/ src/` → 0 site d'import hors commentaires,
   `2026-10-30T23:30:5xZ`). Il est désormais **mort** : à supprimer par Carillon.
7. **`dist/`** a été émis par mon run `tsc -p tsconfig.main.json` (`noEmitOnError`
   n'est pas activé : 20 erreurs mais émission quand même, `00:30:39+01:00`).
   Je l'ai supprimé derrière (`rm -r dist`, exit=0) : l'arbre est dans l'état où je
   l'ai trouvé, sans sortie de build trompeuse.

---

## 6. Verdict

```
RUNNABLE: 12/12
```

- 12 fichiers de `tests/`, 12 exit=0, 371 tests, 371 pass, 0 fail, 0 skip, 0 todo.
- Quarantaine : **aucune**. Aucun fichier laissé « présent et mort ».
- `package.json` : `test` exécute le runner qui tourne (`test:node`), la liste des
  12 fichiers est explicite, et `scriptsNote` + `docs/TESTS.md` déclarent noir sur
  blanc ce qui ne tourne pas (`test:vitest` exit=1, `typecheck` exit=2,
  `build:main` exit=2, scripts d'IHM non exécutables sans `npm install`).
