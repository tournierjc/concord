# VERIF-028 — addendum B — 2026-10-31

**Objet** : lever la limite (a) de VERIF-028 (« dépôt commun de desk-design annoncé mais absent »),
comparer le dépôt à la page, et encoder les pièges de citation R21/R16 annoncés par desk-design.
**Auteure** : desk-qa (banc). **Date du relevé** : 2026-10-31, 04:56Z–05:00Z (horodatages de fichiers
en +0100, soit −1 h sur UTC — les deux formes sont données).
**Portée** : lecture seule sur l'arbre `/work/lan-voice` et sur `_shared` ; une seule écriture : mon
propre contrôleur `VERIF/check-aco-018.sh`. Aucune mesure de rendu, aucun AC coché, aucun verdict
d'ergonomie.

---

## 0. VERDICT PAR CRITÈRE

| # | Critère | Verdict | Preuve (commande, code de sortie) |
|---|---|---|---|
| B1 | Dépôt commun présent et identique à l'annonce | **PASS** | `sha256sum` = `b38922b0…dc0e81`, `stat %s` = 7488, `wc -l` = 123, `stat %y` = `04:40:48.784600995 +0100` = **03:40:48Z** |
| B2 | Cause de mon « absent » identifiée, sans incriminer la locale | **PASS** | `find -name 'note-portee*'` → **0** ; `find -name '*note-portee*'` → **1** (motif ancré au début, le nom commence par `2026-10-31 `) |
| B3 | Page identique à mon relevé, et inchangée après mes mesures | **PASS** | `cf1b2bbe…652498a`, 99 290 o, 1 010 l., mtime `04:33:17.454518823 +0100` = 03:33:17Z — revérifié en fin de passe |
| B4 | Les 6 citations annoncées, comptées ici | **PASS** | C1=1, C2=1, C3=1, C4=1, C5=2 (l. 151, 1004), C6=0 brut / 1 normalisé |
| B5 | Piège « gras » du trio R20.3 | **PASS** | `**ACo-8, ACo-9, ACo-16**` → **1** (l. 151) ; sans les `**` → **2** (l. 151 et 1004) |
| B6 | Piège « retour de ligne » l. 969/970 | **PASS** | `La population (ACo-1, ACo-2, ACo-10) attend C1/C2` → **0** brut, **1** après normalisation des blancs |
| B7 | Piège R16 « forme verbatim unique » | **PASS** | `**non exécutables jusqu'au câblage du relais** (T23)` → **0** brut, **1** normalisé ; sans les `**` → **0** même normalisé ; `awk` deux jetons sur une même ligne → **0** ligne |
| B8 | « R20 » et « hors-couverture » ne sont pas du vocabulaire de page | **PASS** | `grep -c 'R20'` → `0`, **exit 1** ; `grep -F -c 'hors-couverture'` → `0`, **exit 1** |
| B9 | Dépôt ↔ page : fragments ancrés (ligne + texte) | **PASS avec réserve nommée** | 24 fragments : **23/24** verbatim brut, **24/24** après normalisation des blancs ; le seul écart brut est exactement le piège B6 |
| B10 | Les pièges sont encodés dans l'autotest, pas seulement constatés | **PASS** | `check-aco-018.sh --selftest` → `RESULT=PASS selftest=32/32`, **rc=0** (28/28 avant, +m29..m32) |
| B11 | Rien cassé : harnais et suite complets | **PASS** | `verif-024-harness.sh` avec journal → `CHECK_VERIF024 RESULT=PASS`, **rc=0**, `npm=639/0`, `tsc=0/0`, `a8_rouge=5`, `gel=oui`, arbre inchangé (81 fichiers) |
| B12 | `check-aco-017.sh` intact | **PASS** | `a3deb7ee…6ebd793`, **295** lignes — inchangé |
| B13 | « C'est ce fichier qui fait foi » (primauté du dépôt sur la page) | **NON EXÉCUTÉ** | décision de propriétaire (desk-design) ; je mesure la convergence, je ne l'arbitre pas |
| B14 | Équivalence juridique dépôt ↔ page | **NON EXÉCUTÉ** | je compare les fragments cités, pas l'ensemble des deux textes ; le dépôt reste une note (123 l.) et **n'est pas** une rév. 8 |

---

## 1. Le dépôt était là — mon relevé était faux, la cause est mesurée

```
$ LANG=C.UTF-8 find /home/node/.mercury/bots/_shared -maxdepth 1 -name '*note-portee*' -type f
/home/node/.mercury/bots/_shared/2026-10-31 note-portee-ACo-1-ACo-10 — texte canonique pour R20 (SPEC-015 reste rév. 7).md
$ sha256sum <ce fichier>
b38922b0c100da8f5acd9376b0ee1450edbe19570824fb6e228e62ea23dc0e81
$ stat --format='SIZE=%s MTIME=%y' <ce fichier>
SIZE=7488 MTIME=2026-10-31 04:40:48.784600995 +0100        (= 03:40:48Z, soit 2 min 52 s avant mon état de 03:43:40Z)
$ wc -l < <ce fichier>
123
```

Cause, mesurée et non supputée :

```
$ find <_shared> -maxdepth 1 -name 'note-portee*'      | wc -l   → 0
$ find <_shared> -maxdepth 1 -name '*ACo-1-ACo-10*'    | wc -l   → 1
```

Le nom commence par `2026-10-31 ` : mon motif était **ancré au début du nom**, il ne pouvait pas
correspondre. Ni la locale, ni le tiret cadratin, ni les accents, ni les parenthèses n'y sont pour
quoi que ce soit — desk-design avait raison sur le fond, et sa cause supposée n'était pas la bonne.
**Limite (a) de VERIF-028 : LEVÉE.** Le fichier n'a pas bougé de la passe (mtime identique avant et
après toutes mes lectures).

## 2. Les 6 citations, comptées ici (`grep -F -c` sur SPEC-015, sha `cf1b2bbe…`)

| Citation annoncée | Annoncé | Mesuré | Lignes | Verdict |
|---|---|---|---|---|
| `pour 1..8 participants` | 1 | **1** | 665 | PASS |
| `Pour 8 puis 9 vignettes` | 1 | **1** | 674 | PASS |
| `Rappel des chiffres : 8 ⇒ 1 rangée/44 DIP, 9 ⇒ 2 rangées/80 DIP` | 1 | **1** | 345 | PASS |
| `personne ne coche ACo-1 vert sur une population de 10 sans le savoir` | 1 | **1** | 44 | PASS |
| `ACo-8, ACo-9, ACo-16` | 2 | **2** | 151, 1004 | PASS |
| `La population (ACo-1, ACo-2, ACo-10) attend C1/C2` | 0 / 1 | **0** brut, **1** normalisé | 969→970 | PASS |

## 3. Les trois pièges, vérifiés ligne par ligne

**(3.1) Gras du trio.** `**ACo-8, ACo-9, ACo-16**` → **1** occurrence, l. 151. La l. 1004 porte le
trio sans gras propre (le gras enveloppe la proposition entière). Compté, conforme.

**(3.2) Retour de ligne l. 969/970.** `grep -F` brut → **0** ; `tr '\n' ' ' | tr -s ' ' ' '` → **1**.
Mon `PAGENORM` absorbe déjà les `\n` (`check-aco-018.sh`, l. 80), donc le piège était couvert — mais
**implicitement**, enfoui dans le journal « légal » : un jour où la normalisation ne compacterait plus
que les espaces, l'échec serait apparu comme « journal légal rejeté » sans dire pourquoi. D'où le cas
nommé **m29**.

**(3.3) Forme verbatim unique de R16.**

```
**non exécutables jusqu'au câblage du relais** (T23)      brut 0   normalisé 1     ← la seule forme qui passe
non exécutables jusqu'au câblage du relais (T23)          brut 0   normalisé 0     ← n'existe pas sur la page
awk 'index($0,"câblage du relais") && index($0,"T23")'    → 0 ligne
```

La raison du `0` brut est le retour de ligne **entre** `relais**` (fin l. 791) et `(T23)` (début
l. 792) : ce n'est pas un caractère invisible, c'est une coupure de ligne.

**Nuance que je mesure et qui n'était pas annoncée** : retirer **seulement** le `**` ouvrant —
`non exécutables jusqu'au câblage du relais** (T23)` — **passe** (sous-chaîne verbatim valide, le `**`
restant ferme le gras de la page). Ce n'est pas un trou : `grep -F` est un test de sous-chaîne, pas
d'égalité de champ. Seule la suppression des **deux** `**` produit une forme absente, et c'est celle-là
que **m32** encode comme rejet. La paire **m30 (accepté) / m32 (rejeté)** est ce qui empêche le test
de devenir vert par accident.

**(3.4) Une précision qui manquait au dépôt, sans le contredire.** `« câblage du relais »` figure sur
**8** lignes : **62, 151, 672, 673, 680, 791, 970, 1004**. Le dépôt en cite six (151, 672, 673, 680,
791, 1004). Sous-ensemble exact, aucune contradiction — mais un contrôle qui n'examinerait que la liste
du dépôt laisserait passer l. 62 (en-tête) et l. 970 (attente C1/C2). À savoir avant d'écrire un test
basé sur cette liste.

**(3.5) Vocabulaire de citation.** `R20` → 0 ligne, `exit 1`. `hors-couverture` → 0, `exit 1`.
Confirmé. J'ai ajouté au contrôleur un rejet **nommé** pour `R20` (le message dit « c'est le nom de ma
règle, 0 occurrence dans la page ») : le verdict ne change pas d'un point — une citation contenant
`R20` était déjà non verbatim — mais l'opérateur lit la vraie raison au lieu de « non verbatim ».

## 4. Dépôt ↔ page : 24 fragments ancrés

Chaque fragment est testé sur **la ligne que le dépôt annonce**, pas seulement « quelque part dans le
fichier » — sinon un décalage de numérotation passerait inaperçu.

```
OK  l.18   table des trois rôles (SPEAKING_SET_MAX)     OK  l.672  ACo-8 + motif relais
OK  l.44   anticipation ACo-1 (population 10)           OK  l.673  ACo-9 + motif relais + étiquette F2
OK  l.47   « population de 10 sans le savoir »          OK  l.674  borne ACo-10 + 44 DIP
OK  l.151  trio non exécutable                          OK  l.680  ACo-16 + motif relais
OK  l.345  44 DIP                                       OK  l.682  révocation « gelés »
OK  l.665  borne ACo-1 1..8                             OK  l.727  AD-26 §2
OK  l.731  « deux rangées »                             OK  l.791  révocation « gelés »
OK  l.1004 trio l.1004 + motif relais                   BAD l.970  « attend C1/C2 » (coupé 969/970)
PASS=23 BAD=1  — et BAD=0 après normalisation des blancs
```

Le seul `BAD` est le piège (3.2) : le dépôt écrit lui-même « **l. 969-970** » et cite une proposition
qui chevauche la coupure. **Le dépôt est fidèle à la page.** Réserve : fidélité des fragments cités,
pas équivalence des deux textes (B14).

## 5. Ce que j'ai changé (une seule écriture)

`VERIF/check-aco-018.sh` — sha256 `a444f5e9 0414da52 0669e9ea 3a9c907e 46930388 288de13c a552698c 5ae0b61d`,
**384 lignes** (367 avant). `--selftest` : **32/32**, rc=0 (28/28 avant).

- **m29** — citation à cheval sur l. 969/970 → doit être **acceptée**. Garde la normalisation des `\n`.
- **m30** — forme verbatim R16 complète (`**…relais** (T23)`) → doit être **acceptée**.
- **m31** — citation contenant `R20` → doit être **rejetée** (motif nommé).
- **m32** — forme sans les deux `**` → doit être **rejetée**. Contrôle négatif de m30.
- **R21** — branche `*R20*` ajoutée à côté de `*hors-couverture*` : message de rejet nommé, verdict inchangé.
- **Libellé** — le mode état annonçait `raison=T23-non-merge-et-arbre-non-gele`, devenu **faux** (T23 a
  atterri, empreintes gelées) ; remplacé par `raison=mode-etat-aucune-mesure` + l'état réel des AC.
  Sans effet sur un verdict : le harnais ne lit pas cette chaîne (vérifié : `grep` → 0 ligne).

`check-aco-017.sh` : `a3deb7ee…`, **295** lignes, **intact**. `check-aco-016.sh` : `61c3d6ca…`, intact,
`--selftest` → `PASS selftest=10/10`, rc=0.

## 6. Rejeu complet

```
$ sh check-aco-018.sh --selftest
CHECK_ACO018 RESULT=PASS selftest=32/32                                  rc=0
$ sh check-aco-018.sh
CHECK_ACO018 RESULT=NOTRUN criteres=8 raison=mode-etat-aucune-mesure …  rc=0  (gele=2, FAIL=0)
$ ACO16_JOURNAL=VERIF/verif-024-journal-aco-2026-10-31.txt sh verif-024-harness.sh
CHECK_VERIF024 RESULT=PASS gel=oui runall_fail=0 a8_rouge=5 npm_fail=0 tsc=0/0 orphelins=0   rc=0
  npm=639/0 · tsc=0/0 · a8_rouge=5 a8_vert=4 · aco_selftest=0 · aco16_validate=0
  [OK] arbre inchangé pendant la mesure (81 fichiers)
```

**Point d'attention, ce n'est pas une régression** : lancé **sans** `ACO16_JOURNAL`, le même harnais
rend `RESULT=FAIL … aco16_validate=1`. C'est mon durcissement de VERIF-024 (`A16_V=1` par défaut) :
un journal ACo-16 absent n'est pas un PASS. Le harnais exige donc son journal comme **précondition
déclarée** — il est vert *parce que* la mesure existe, pas parce qu'elle manque.

## 7. Non vérifié — nommé comme tel

1. **B13/B14** : primauté du dépôt sur la page et équivalence des deux textes — hors de ma portée, ce
   sont des actes de propriétaire.
2. Le dépôt n'est **pas** une rév. 8 : la page reste rév. 7 (`cf1b2bbe…`). Conséquence pratique : `R20`
   et `R21` ne sont **pas** citables comme vocabulaire de page — d'où m31.
3. Aucune mesure de rendu dans cette passe : ACo-16 a été exécuté dans VERIF-024
   (`rendus_overlay=0` sur 3 007 ms, falsification 3 rendus ⇒ rouge) ; **rien de neuf ici**, et
   `check-aco-018.sh` en mode état reste `NOTRUN` par construction.
4. Le libellé `motif C5(a) non posé` pour ACo-14/ACo-15 reste un état, pas une mesure : ils restent
   **gelés** et je ne les coche pas.
