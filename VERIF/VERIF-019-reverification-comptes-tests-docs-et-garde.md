# VERIF-019 — Contre-vérification des comptes de tests (T19) et remise à jour de `docs/TESTS.md`

**Auteur** : Banc (desk-qa) — **Date** : 2026-10-31 — **Session de mesure** :
`02:00:57Z → 02:03:01Z` (UTC), sur `/work/lan-voice`
**Machine** : `node v22.23.4`, `npm 10.9.9`, `tsx v4.23.15`, `vitest 1.6.1`, `node_modules/` présent.
**Déclencheur** : message de desk-shell (02:2x–02:4xZ) transmettant ses chiffres pour mon relevé
`docs/TESTS.md`, avec la mention « je ne réécris pas tes lignes, je te passe la mesure ».
**But de cette passe** : ne pas recopier un chiffre sur parole. Re-mesurer soi-même, publier, et
remettre la page de référence à jour — les 8 chiffres transmis étaient exacts, la page ne l'était pas.

---

## 1. Verdict

| Chiffre transmis par desk-shell | Re-mesuré par le Banc | Écart |
|---|---|---|
| `ls tests/*.test.ts \| wc -l` = 20 (19 avant son ajout) | **20** | aucun |
| `npm test` : exit=0 · 20 fichiers · 530 tests · 530 pass · 0 fail · 28 suites · 566 ms | **exit=0 · 530 tests · 530 pass · 0 fail · 0 skip · 28 suites · 580 ms** (`02:00:58.065Z`) | aucun sur les comptes ; durée +14 ms (run différent) |
| `npx tsc -p tsconfig.json --noEmit` : exit=0 | **exit=0 · 0 ligne** (`02:00:59.314Z`) | aucun |
| `npm run build:main` : exit=0 | **exit=0** (`02:01:00.756Z`) | aucun |
| `npx vite build` : exit=0, 416 ms | **exit=0 · 48 modules · built in 444 ms** (`02:01:01.559Z`) | +28 ms — deux runs distincts, la durée n'est pas un critère |
| `docs/TESTS.md` l.13 annonce « 12 fichiers · 371 tests » = périmé de 8 fichiers / 159 tests | **confirmé périmé**, et plus largement : `typecheck` annoncé exit=2 (52 err.) et `build:main` exit=2 (20 err.) étaient faux aussi | corrigé (§3) |
| `src/engine/README.md` omet `contract-parity.node.test.ts` et `scripts-coverage.node.test.ts` | **confirmé, et pire** : 7 fichiers cités sur 20, **13 omis** (§4) | chiffre précisé |
| garde `tests/scripts-coverage.node.test.ts` = 4 tests, falsifiée ×2 | **4 tests confirmés** ; **falsifiée ×4** par le Banc, + **1 réserve réelle trouvée** (C5, §5) | garde validée, une fragilité nommée |

Aucun chiffre de desk-shell n'est faux. Un seul écart numérique (444 vs 416 ms) : c'est une durée
de build, elle n'a pas valeur de preuve — les comptes et les exit codes, eux, sont identiques.

Déterminisme contrôlé : `npm test` lancé **trois fois** dans la session
(`02:00:58.065Z`, `02:01:28.293Z`, `02:02:58.412Z`) → trois fois `exit=0`, 530/530/0, 28 suites.
Durées : 580 / 512 / n.c. ms. Les comptes ne bougent pas, la durée bouge : c'est le comportement
attendu sur un runner à base de processus node.

---

## 2. Commandes exactes (rejeu à l'identique)

```bash
cd /work/lan-voice
node --version ; npx tsx --version          # v22.23.4 / tsx v4.23.15

ls tests/*.test.ts | wc -l                  # 20
node -e 'const s=require("./package.json").scripts["test:node"];
  console.log(s.split(/\s+/).filter(x=>x.endsWith(".test.ts")).length)'   # 20
# diff des deux ensembles (noms, triés) : vide, exit=0 → la liste == le disque
node -e 'const s=require("./package.json").scripts["test:node"];
  console.log(/[*?]/.test(s))'              # false → aucun glob

date -u +%FT%T.%3NZ ; npm test ; echo EXIT=$?          # EXIT=0, # tests 530, # fail 0, # suites 28
npx tsc -p tsconfig.json --noEmit ; echo EXIT=$?       # EXIT=0, 0 ligne
npm run build:main ; echo EXIT=$?                      # EXIT=0
npx vite build ; echo EXIT=$?                          # EXIT=0, 48 modules, built in 444ms
npm run test:vitest ; echo EXIT=$?                     # EXIT=1, Test Files 20 failed (20)
```

Empreintes des témoins au moment de la mesure (`02:01:02.360Z`) :
`package.json` `030a8219…`, `tests/scripts-coverage.node.test.ts` `8ab8c1e8…`,
`src/engine/README.md` `d48932c8…`, `docs/TESTS.md` (avant réécriture) `d62b7768…`.

---

## 3. `docs/TESTS.md` : réécrit, avec les chiffres du jour

La page portait les mesures du `2026-10-30T23:29–23:31Z` (avant `node_modules`, avant que la
suite ne triple). Trois de ses lignes étaient devenues fausses :

| Ligne | Annonçait | Réalité mesurée |
|---|---|---|
| TL;DR `npm test` | 12 fichiers · 371 tests | **20 fichiers · 530 tests** |
| TL;DR `typecheck` | exit=2 · 52 erreurs | **exit=0 · 0 ligne** |
| TL;DR `build:main` | exit=2 · 20 erreurs | **exit=0** |
| §vitest | 12 fichiers en échec | **20 fichiers en échec** (le rouge a suivi la croissance de la suite) |

Traitement (pas un blanchiment) : les chiffres périmés ne sont pas effacés, ils sont **déplacés
en fin de page** dans un tableau « Historique des mesures » avec leur date et leur source
(VERIF-004, VERIF-006/T11, VERIF-016/T16b, T19). Une page de mesures perd son sens si elle
réécrit son passé : ce qui compte, c'est de savoir *depuis quand* un chiffre a cessé d'être vrai.

Ajouts à la page : section « La liste des tests est écrite à la main — et désormais gardée »
(ce que la garde vérifie, ses 4 falsifications, sa réserve C5, et **ce qu'elle ne couvre pas**),
section « Prérequis réels » (`tsx` vient du cache npx, **non déclaré** dans `package.json` ;
`node_modules/` présent depuis `00:29:03Z`), et section « Points non vérifiés » nommés.

État final : `docs/TESTS.md`, **179 lignes**, sha256 `b37fabd0…`.
Contrôle après réécriture (`02:02:58.412Z`) : `npm test` **exit=0** 530/530, `tsc --noEmit`
**exit=0**. La documentation n'est lue par aucun test — l'édition ne peut pas casser la suite, et
inversement **rien ne protège cette page de la dérive** : c'est un contrôle humain, refait ici.

---

## 4. `src/engine/README.md` — écart plus large qu'annoncé (non corrigé, hors de mon poste)

`src/engine/README.md` (sha `d48932c8…`) illustre l'usage de `node --test` avec **7** fichiers :

`device`, `engine-purity`, `gain`, `ice-filter.node`, `ice-filter`, `room`, `vad`.

Le disque en porte **20** : **13 ne sont pas cités**, dont ceux qui portent les contrats et la
garde — `contract-parity.node`, `ipc-contract`, `local-signaling`, `media-plane.node`,
`media-plane`, `mesh`, `overlay-geometry`, `room-discovery-sec.node`, `room-discovery.node`,
`scripts-coverage.node`, `settings-schema`, `signaling-link.node`, `audio-sink`.

Conséquence pratique : un lecteur qui prend ce bloc pour la liste des tests sous-estime la suite
d'un facteur ~3. Le README est un fichier tenu par un autre poste — **non modifié ici**, signalé
à desk-engine. La liste de référence gardée mécaniquement est `package.json#test:node` ; la
mesure datée est `docs/TESTS.md`.

---

## 5. La garde `scripts-coverage.node.test.ts` — falsifiée ×4, une réserve trouvée

Falsification faite sur une **copie isolée** (garde + `package.json` + 20 fichiers témoins dans un
répertoire de sandbox), **dépôt réel jamais modifié** : `package.json` `030a8219…` et garde
`8ab8c1e8…` identiques avant/après (contrôle sha en fin de script).

| Cas injecté dans la copie | Attendu | Mesuré |
|---|---|---|
| C0 — copie fidèle de l'état sain | vert | exit=0 · `# tests 4` · 4 pass |
| C1 — `tests/ghost.test.ts` ajouté à `test:node` | rouge | exit=1 · `not ok 2` (nom cité absent du disque) |
| C2 — `scripts-coverage.node.test.ts` retiré de la liste | rouge | exit=1 · `not ok 1` (fichier du disque non lancé) |
| C3 — `tests/extra-*.test.ts` (glob) ajouté | rouge | exit=1 · `not ok 2` **et** `not ok 3` (glob) |
| C4 — `"… 19 fichiers."` appendé à `scriptsNote` | rouge | exit=1 · `not ok 4` (compte annoncé ≠ disque) |
| C5 — `"(rappel historique : 12 fichiers au départ.)"` appendé | vert attendu | **rouge : exit=1 · `not ok 4`** |

Les quatre assertions de la garde ont donc été **vues rouges pour la faute qu'elles prétendent
attraper** : elle n'est pas tautologique. Chaque cas rouge a été obtenu en n'ajoutant que la faute,
sans toucher au reste.

**Réserve C5 (nouvelle, mesurée le `2026-10-31T02:02:0xZ`)** : la quatrième assertion retient le
**dernier** « N fichiers » du champ `scriptsNote`. Toute mention *historique* ajoutée en fin de
champ fait donc rougir la garde à tort (`12 fichiers au départ` → `not ok 4`, exit=1). Ce n'est
pas un trou (elle échoue du côté sûr, jamais l'inverse), mais c'est un piège de maintenance :
la règle « toute mention ajoutée en fin de `scriptsNote` doit soit ne citer aucun compte, soit
être suivie du compte courant » doit être écrite là où l'on édite ce champ. Deux options pour
desk-shell, si le bruit gêne : ancrer la regex sur la **première** occurrence, ou exiger un
marqueur (`« compte courant : N fichiers »`). Non fait ici : la garde n'est pas mon fichier, je
rapporte la mesure.

**Ce que la garde ne couvre pas** (déjà écrit dans `docs/TESTS.md`, à ne pas lui faire dire) : un
fichier dont tous les `it` sont `skip` compte dans les fichiers ; les chiffres publiés en
documentation ne sont lus par personne ; la qualité des assertions n'est pas évaluée.

---

## 6. Points non vérifiés (nommés, pas contournés)

1. **`npm run dev` / `npm start` / `npm run dist`** : non exécutés (Electron exige un affichage,
   `electron-builder` un téléchargement). Aucune affirmation sur leur comportement.
2. **Comportement sur machine vierge** (sans `node_modules`, sans cache npx) : non mesuré. Le
   prérequis `tsx` **non déclaré** dans `package.json` est un risque d'installation nommé, pas
   une vérification.
3. **Couverture** lignes/branches : aucun instrument dans le dépôt, donc aucun chiffre publié.
4. **Qualité** des 530 tests (ce qu'ils prouvent réellement) : hors périmètre de cette passe ;
   déjà traité ailleurs pour le plan média (`VERIF-013` → `VERIF-015`).

---

## 7. Livrables de cette passe

- `/work/lan-voice/docs/TESTS.md` — remis à jour, daté, 179 lignes, sha256 `b37fabd0…`
  (version précédente `d62b7768…` conservée en copie sandbox `t17/TESTS.md.avant`).
- `/work/lan-voice/VERIF/VERIF-019-reverification-comptes-tests-docs-et-garde.md` — le présent
  rapport.
- Harnais rejouables : `sandbox/t17/run-t17.sh` (mesures), `run-t17b.sh` / `run-t17d.sh`
  (vitest, déterminisme, falsification ×4 + C5), `run-t19b.sh` (contrôle après réécriture) ;
  sorties brutes dans `sandbox/t17/`.

*Règle appliquée : un chiffre sans exit code et sans horodatage n'est pas un chiffre, c'est une
opinion.*
