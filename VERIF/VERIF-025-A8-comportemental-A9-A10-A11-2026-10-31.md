# VERIF-025 — A8 devient comportemental, A9/A10/A11 câblés, harnais VERIF-024 préparé (non lancé)

Banc (desk-qa) · 2026-10-31 · **mesures 03:19Z → 03:26Z** (04:19 → 04:26 heure locale, +01:00) · dépôt `/work/lan-voice`
Demandeur : Régie (tâche `b59c3329`, suite d'AD-24 §4). **Aucune écriture hors `VERIF/` et mon sandbox** :
`src/`, `tests/`, `package.json` ont gardé leurs empreintes et leurs mtimes de 04:18 maximal (§5).
Ancrage : empreintes SHA-256 des 8 fichiers que ces mesures touchent, §5.1 — **elles ne sont pas** le périmètre
gelé de VERIF-023 : `src/main/timers.ts` a été réécrit à **04:16:18**, `tests/main-timers.node.test.ts` à 04:18:44,
`package.json` à 04:18:58. Mon PASS est borné à ces octets-là.

---

## 0. Verdict en sept lignes

1. **A8 est désormais un contrôle sémantique**, pas un grep : `VERIF/check-a8-timers.sh` →
   `VERIF/a8-confinement.mjs` lit l'arbre syntaxique (typescript déjà dans `node_modules`) et relève les
   *références* à `setTimeout/setInterval/setImmediate/clearTimeout/clearInterval/unref` hors des deux portes.
   Sur les octets du 04:24Z : **45 fichiers `src/` analysés, 8 références dans les portes, 0 hors portes → PASS**.
2. **Table de variants, 9 lignes, copies isolées** (§2.3). A8 comportemental : **5 ROUGE (m1..m5), 4 VERT
   (b0, w0, w1, m6-limite-connue)** — exactement ce qu'on lui demande.
3. **A8 texte est aveugle à 3 formes mesurées** : alias `m1` VERT, accès calculé `m4` VERT, chaînage optionnel
   `m5` VERT. Il **n'est pas** aveugle aux deux formes annoncées `m2`/`m3` : `globalThis.clearTimeout(timer)` et
   `queueMicrotask(() => clearTimeout(timer))` portent le littéral `clearTimeout(` sur la ligne, donc la 3e
   porte apparaît et A8 texte rougit. Ma mesure contredit la prémisse sur ces deux-là, je l'écris (§2.4).
4. **A8 texte produit un faux positif** : `w1` (`void 'clearTimeout('`, littéral dans une chaîne, aucun
   comportement) le fait ROUGE. Le contrôle sémantique reste VERT.
5. **A9, A10, A11 sont câblés** dans `VERIF/run-all.sh` (une ligne chacun, §3), verts sur l'arbre, et **chacun
   sait rougir** : trois arbres mutés exprès les font FAIL avec le bon motif (contre-épreuves §3.2).
6. **DÉFAUT DEF-25-1 (neuf, non corrigeable par moi)** : la garde textuelle d'A8 survit dans
   `tests/main-timers.node.test.ts` (test « `unref` et les désarmements bruts ne sortent pas de
   `src/main/timers.ts` »), **et seulement sur `src/main`**. Elle hérite des mêmes angles morts (m1, m4, m5
   verts) et du même faux positif (w1 rouge). Elle doit être remplacée par l'appel au contrôle sémantique :
   je ne peux pas écrire dans `tests/`.
7. **VERIF-024 : harnais PRÉPARÉ, NON LANCÉ.** Raison mesurée : l'arbre n'est pas gelé (quatre écritures
   entre 04:16:18 et 04:18:58, §5.1). **Aucune mesure sur T23 n'a été prise.**

---

## 1. Ce que A8 historique mesurait, et ce qu'il ne pouvait pas voir

Commande historique (AD-18 §4, réutilisée par VERIF-023) :

```sh
grep -rnE "^[^*/]*(unref\(|clearTimeout\(|clearInterval\()" src/    # attendu : 2 fichiers, les portes
```

Sur les octets du 04:24Z : **5 lignes dans 2 fichiers** — `src/main/timers.ts` (4) et
`src/renderer/browser-timers.ts` (1). C'est un contrôle de **nombre de fichiers** : il rougit dès qu'un
littéral apparaît ailleurs, il reste vert dès qu'un appel se présente autrement. Ce n'est pas la même
propriété que « l'horloge ambiante ne sort pas des portes ».

## 2. A8 comportemental — protocole et résultats

### 2.1 Le contrôle

```sh
sh VERIF/check-a8-timers.sh /work/lan-voice
# … CHECK_A8 RESULT=PASS refs_hors_portes=0 portes=src/main/timers.ts,src/renderer/browser-timers.ts refs_dans_portes=8
```

`a8-confinement.mjs` (lecture seule, aucun accès réseau, `typescript` résolu depuis `node_modules` du dépôt) :
`ts.createSourceFile` par fichier `src/**/*.ts{,x}`, puis relève
`Identifier` (nu ou en alias), `PropertyAccessExpression.name` (`x.clearTimeout`), `ElementAccessExpression`
à argument `StringLiteral` (`x['clearTimeout']`), liaisons déstructurées. Les commentaires et les chaînes
ordinaires ne comptent pas : **la prose ne rougit pas**, seule une référence rougit. Portes autorisées, et
elles seules : `src/main/timers.ts`, `src/renderer/browser-timers.ts`.

### 2.2 Table de variants — copies isolées (protocole VERIF-021 §5)

```sh
python3 VERIF/a8-variants.py /work/lan-voice VERIF/raw/a8-variants-20261031T032437Z
```
Copie isolée par variante (`src/` + `tests/` + `node_modules` en lien symbolique), **remplacement littéral
exact d'une seule occurrence** de `timers.cancel(timer)` dans `src/main/signaling-link.ts` (site hors portes,
exercé par `tests/signaling-link.node.test.ts`) ; le dépôt n'est jamais modifié. Trois mesures par variante :
A8 texte, A8 comportemental, et `npx tsx --test tests/signaling-link.node.test.ts tests/main-timers.node.test.ts`.

| variante | patch | A8 **texte** | A8 **comportemental** | tests pass/fail |
|---|---|---|---|---|
| b0-temoin-base | aucun | VERT | VERT | 26/0 |
| m1-alias | `const ct = clearTimeout; ct(timer)` | **VERT** (aveugle) | **ROUGE** ✓ | 26/0 |
| m2-qualifiee | `globalThis.clearTimeout(timer)` | **ROUGE** | **ROUGE** ✓ | 25/1 |
| m3-reportee | `queueMicrotask(() => clearTimeout(timer))` | **ROUGE** | **ROUGE** ✓ | 25/1 |
| m4-calculee | `(globalThis as any)['clearTimeout'](timer)` | **VERT** (aveugle) | **ROUGE** ✓ | 26/0 |
| m5-chaine-optionnelle | `globalThis.clearTimeout?.(timer)` | **VERT** (aveugle) | **ROUGE** ✓ | 26/0 |
| w0-temoin-neutre | commentaire citant `clearTimeout(` | VERT | VERT (attendu) | 26/0 |
| w1-litteral-dans-chaine | `void 'clearTimeout('` | **ROUGE** (faux positif) | VERT (attendu) | 25/1 |
| m6-composee | `(globalThis as any)['clear' + 'Timeout'](timer)` | VERT | **VERT — trou connu** | 26/0 |

Jeu de données : `VERIF/raw/a8-variants-20261031T032437Z/a8-variants.json` (champ `a8_detail` = ligne fautive
relevée par l'AST, n° de ligne à l'appui, p. ex. `HORS-PORTE src/main/signaling-link.ts:397 [ident] clearTimeout`).

### 2.3 Lecture des rouges « 25/1 »

Le seul test rouge de m2, m3 et w1 est **le même** : `not ok 3 - « unref » et les désarmements bruts ne
sortent pas de « src/main/timers.ts »` — c'est-à-dire la garde **textuelle** du dépôt, pas une assertion de
comportement. Aucun test de comportement ne distingue ces variantes : elles gardent le comportement, comme
demandé, et seule la garde les voit. Pour w1 le rouge est un **faux positif** (la chaîne n'appelle rien).
Preuve : `grep -n 'not ok' VERIF/raw/a8-variants-20261031T032437Z/a8-variants.json` (champ `tests_rouges`).

### 2.4 Ce que la mesure dit de la prémisse

- « alias » : **confirmé aveugle** (m1 VERT).
- « forme qualifiée » : **non confirmé** (m2 ROUGE). Le littéral est sur la ligne ; A8 compte les fichiers.
- « littéral présent mais confinement rompu » : **non confirmé** (m3 ROUGE), pour la même raison.
- Angles morts réels mesurés, plus larges : `m4` (accès par littéral), `m5` (chaînage optionnel), et `m6`
  (accès composé) qui échappe **à tout contrôle statique** — c'est le trou nommé, pas un trou caché.

## 3. A9, A10, A11 câblés

### 3.1 Une ligne chacun dans `run-all.sh`

```sh
run_check check-a8-timers   check-a8-timers.sh   "check-a8-timers"
run_check check-a9          check-a9.sh          "check-a9"
run_check check-a10         check-a10.sh         "check-a10"
run_check check-a11         check-a11.sh         "check-a11"
```

Résultats sur les octets du 04:22Z (`sh VERIF/run-all.sh`, journal `VERIF/raw/run-20261031T042250/_results`) :

```
check-a8-timers PASS CHECK_A8 RESULT=PASS refs_hors_portes=0 portes=src/main/timers.ts,src/renderer/browser-timers.ts refs_dans_portes=8
check-a9        PASS CHECK_A9 RESULT=PASS membres=2 noms=once,cancel now=0
check-a10       PASS CHECK_A10 RESULT=PASS occurrences=0
check-a11       PASS CHECK_A11 RESULT=PASS titres_fautifs=0 prose_acceptee=1
```

`prose_acceptee=1` : la phrase « JAMAIS diffusé » survit bien dans le commentaire (ligne 264), et le motif
`^\s*(it|test)\(.*JAMAIS diffusé` ne la voit pas — c'est le piège que le contrôle devait éviter.

### 3.2 Contre-épreuves : chaque contrôle sait rougir

Arbre muté exprès dans mon sandbox (`a8/neg` : 3e membre `now()` dans le port, `const elapsed = 0` dans le
test média-plane, un `it('JAMAIS diffusé …')` ajouté au maillage) :

```
check-a9  FAIL membres=3 noms=cancel,now,once now=1        (rc=1)
check-a10 FAIL occurrences=1  | 586:const elapsed = 0      (rc=1)
check-a11 FAIL titres_fautifs=1 prose_acceptee=1           (rc=1)
check-a8-timers FAIL sur la copie m1 (rc=1)                # grep vert, contrôle sémantique rouge
```

## 4. Observations hors périmètre, nommées

1. **DEF-25-1** : la garde textuelle d'A8 dans `tests/main-timers.node.test.ts` (test #3, `src/main` seulement)
   est aussi aveugle que le grep (m1/m4/m5 verts) et aussi fausse positive (w1 rouge). À remplacer par
   `node VERIF/a8-confinement.mjs`, ou par un appel au contrôle. **Je n'écris pas dans `tests/`.**
2. `CHECK_TESTS RESULT=PASS files=25 run=23 pass=23 fail=0 not_run=2` — un PASS agrégé qui **cache deux
   fichiers non chargés** (`participant-state.test.ts`, `signaling-link.node.test.ts` :
   `ERR_MODULE_NOT_FOUND` sur imports sans extension, `node --experimental-strip-types`). Les deux passent
   sous `npx tsx` (signaling-link : 26/26). Non corrigé : `run-all.sh` n'a été touché que pour A8..A11.
3. Préexistants, hors de ce tour : `check-no-external` FAIL (`horslan=2`), `check-shell` FAIL (`failures=1`).
4. Le défaut que j'avais signalé en VERIF-023 (test `speaking-relay` absent de `test:node`) est **corrigé** :
   25 fichiers sur disque, 25 listés dans `test:node`, **0 orphelin, 0 fantôme** (mesure 03:24Z, §5.2).

## 5. Périmètre, empreintes, et non-écriture

### 5.1 Empreintes des octets mesurés (2026-10-31)

| fichier | mtime (locale) | SHA-256 |
|---|---|---|
| `src/main/timers.ts` | 04:16:18 | `1fd8a4bf4d2593c59f23cd32327e88f54da31cc218b7072fcec43361398fbeac` |
| `src/renderer/browser-timers.ts` | 03:38:39 | `e85c340718f8d481fa6bc75e68754e6d44bf44667e917963f60bb91cef083efe` |
| `src/engine/timers.ts` | 03:43:49 | `93d65b10c3db7a4dd350a389016fc4354be1b230ace2f5ab841ad359509bf46b` |
| `src/main/signaling-link.ts` (site des mutants) | 03:55:16 | `9bd11d319da94ae4ec85130e7abb371b0eb568b10f7acaa3c2b6126460cc8484` |
| `tests/main-timers.node.test.ts` | 04:18:44 | `b59bc85c3269edcc06d90ba144e90dea2169e0242fe41ea1229bff45f7131d33` |
| `tests/media-plane.node.test.ts` | 03:44:34 | `b64beae35f2607e0119fe79d424a4197afc6e3536cabd520b5278dc2d3a03b88` |
| `tests/voice-mesh.node.test.ts` | 03:44:52 | `55a26e6901ab1fc3b6b9f8298b76a092ebc2e87c3f4ba931da62ae210e8d9070` |
| `tests/speaking-relay.test.ts` | 04:18:16 | — (hors champs A8..A11) |
| `package.json` | 04:18:58 | — (hors champs A8..A11) |

### 5.2 Non-écriture, vérifiée et non affirmée

```sh
find . -newermt "2026-10-31 04:19" -type f -not -path "./node_modules/*" -not -path "./VERIF/*"
# → ./SPECS/SPEC-015-… .md et ./SPECS/SPEC-016-AD-25-… .md  (écrits par Régie, pas par moi)
```
Aucun fichier de `src/`, `tests/`, ni `package.json` n'a été touché après 04:18:58. Mes seules écritures :
`VERIF/` (9 fichiers listés §6) et mon sandbox (`…/desk-qa/sandbox/a8/`).

## 6. VERIF-024 — harnais préparé, non lancé

`VERIF/verif-024-harness.sh` (exécutable, `sh -n` OK, `python3 -m py_compile` OK sur `a8-variants.py`).
**Non lancé** : seule sa bannière `--dry` a été affichée (aucune mesure produite). Séquence prévue, dans
`VERIF/raw/verif-024-<stamp>/` : (1) couverture `test:node` vs disque, (2) empreinte **avant** (66 fichiers
`src/`+`tests/`+8 fichiers de configuration), (3) `run-all.sh`, (4) `npm run test:node`, (5) `tsc --noEmit`
×2, (6) `a8-variants.py` (attendu 5 ROUGE / 4 VERT), (7) empreinte **après** + `diff` → **VOID** si l'arbre a
bougé pendant la mesure.

Pourquoi pas lancé, en une phrase : l'arbre n'est pas gelé — quatre écritures entre 04:16:18 et 04:18:58
(`src/main/timers.ts`, `tests/speaking-relay.test.ts`, `tests/main-timers.node.test.ts`, `package.json`) — et le
feu T23 n'a pas eu lieu ; une mesure maintenant serait une mesure VOID par construction. **Aucun chiffre de
T23 n'est publié ici.**

## 7. Points NON vérifiés (nommés comme tels)

1. **A8 comportemental ne voit pas l'accès composé** (`m6`, mesuré VERT) ni une construction dynamique
   (`Reflect.get(globalThis, 'clear' + 'Timeout')`, exécution de code généré). Aucun contrôle statique ne le
   verra ; seul un contrôle **à l'exécution** le pourrait, et il serait aveugle aux chemins non exercés.
2. **A8b ne prouve rien sur l'exécution réelle** : la table dit que la garde *voit* cinq mutants, pas qu'un
   mutant *fonctionne* dans le produit. Le confinement n'a pas été observé à l'exécution (aucune
   instrumentation de `globalThis.clearTimeout` posée).
3. **Witness w0/w1 : un seul site** (`signaling-link.ts`). Je n'ai pas mesuré de variante dans
   `src/engine/**` (interdite par A1) ni dans `src/renderer/**` (seconde porte : muter *dans* une porte n'est
   pas un test de confinement, muter à côté l'est ; non fait, faute de temps de banc).
4. **A9** vérifie la forme de la déclaration (`once`, `cancel`, pas `now`), **pas** que le moteur n'implémente
   pas une horloge ailleurs : cette propriété est couverte par A1 (`Date.now`/`setTimeout` dans `src/engine`).
5. `CHECK_TESTS` de `run-all.sh` reste **PASS avec 2 fichiers non exécutés** (§4.2) : non corrigé, hors
   périmètre de ce tour.

---

## 8. Commandes exactes, pour rejouer chaque chiffre

```sh
# A8 comportemental sur l'arbre
sh VERIF/check-a8-timers.sh /work/lan-voice

# table de variants (5 ROUGE attendus m1..m5, 4 VERT b0/w0/w1/m6)
python3 VERIF/a8-variants.py /work/lan-voice VERIF/raw/a8-variants-20261031T032437Z

# A9 / A10 / A11, et les quatre dans l'agrégateur
sh VERIF/check-a9.sh  /work/lan-voice
sh VERIF/check-a10.sh /work/lan-voice
sh VERIF/check-a11.sh /work/lan-voice
sh VERIF/run-all.sh

# contre-épreuves (chaque contrôle doit rougir)
sh VERIF/check-a9.sh  <arbre-muté>   # 3e membre now()  → FAIL membres=3
sh VERIF/check-a10.sh <arbre-muté>   # const elapsed=0  → FAIL occurrences=1
sh VERIF/check-a11.sh <arbre-muté>   # it('JAMAIS …')   → FAIL titres_fautifs=1

# couverture de test:node (étape 1 du harnais, extrait testé à l'identique)
node -e '…' /work/lan-voice   # → fichiers=25 listés=25 ORPHELINS=0 FANTOMES=0

# harnais VERIF-024 : PLAN seulement
sh VERIF/verif-024-harness.sh --dry
```

Fichiers livrés par ce tour (tous sous `VERIF/`, aucun ailleurs) : `check-a8-timers.sh`, `a8-confinement.mjs`,
`a8-variants.py`, `check-a9.sh`, `check-a10.sh`, `check-a11.sh`, `verif-024-harness.sh`, `run-all.sh` (4 lignes
ajoutées + 4 lignes d'en-tête), ce rapport ; journaux sous `VERIF/raw/run-20261031T042250/` et
`VERIF/raw/a8-variants-20261031T032437Z/`.
