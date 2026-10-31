# 2026-10-31 VERIF 028 — Errata de VERIF 027 (3 corrections) + R21 « vocabulaire de citation »

**Rédigé par :** desk-qa (Banc) — **Date :** 2026-10-31T03:44Z — **Banc :** `/work/lan-voice`
**Objet :** appliquer les trois corrections factuelles de desk-design à VERIF 027, les **vérifier sur la
page** (pas sur message), encoder une règle qui rend désormais ce contrôle automatique (R21), ouvrir
l'état **honnête** de ACo-10 population 10 (`EN-ATTENTE-C1C2`), durcir R16.
**Aucun AC coché, aucune mesure :** l'arbre n'est pas gelé et les trois termes de la rév. 8 ne tiennent pas (§6).

**Page de référence (inchangée, non modifiée par ce travail) :**
`/work/lan-voice/SPECS/SPEC-015-overlay-population-unie-et-halo.md`
sha256 `cf1b2bbe536a80b53025b0016eb55855400f139faa1a14402aed0f313652498a` · 99 290 o · **1 010 l.** ·
`stat --format=%y` → `2026-10-31 04:33:17.454518823 +0100`.

---

## 1. Les trois errata — confirmés par moi sur la page

| # | Ce que disait VERIF 027 | Fait sur la page | Commande exacte | Décision |
|---|---|---|---|---|
| E1 | `mtime 04:33:17Z` | `2026-10-31 04:33:17.454518823 **+0100**` = **03:33:17Z** | `stat --format=%y …/SPEC-015-overlay-population-unie-et-halo.md` | **corrigé.** Mon erreur : j'avais recopié l'heure murale sans convertir. Le fichier est plus vieux de 1 h que ce que j'ai écrit. |
| E2 | « l. 345 = seules occurrences chiffrées » | **2** lignes portent `44 DIP` : l. **345** *et* l. **674**, cette dernière **dans la ligne ACo-10** (« Rappel des chiffres : 8 ⇒ 1 rangée/44 DIP, 9 ⇒ 2 rangées/80 DIP ») | `grep -n "44 DIP" …` → `345:…`, `674:…` (2 lignes, pas 1) | **corrigé, et le motif se renforce :** l'AC qui mesure la géométrie **chiffre 8 et 9 dans sa propre ligne** et ne dit **rien de 10**. |
| E3 | je citais « hors-couverture » comme si la page le disait | `grep -c "hors-couverture"` → **0**, exit **1** | `grep -c "hors-couverture" …` → `0` (code 1) | **corrigé.** `hors-couverture` est une **valeur de champ `verdict=`**, jamais une citation. Mots de la page pour le même fait : `câblage du relais` (**8** lignes : 62, 151, 672, 673, 680, 791, 970, 1004), `gelés` **révoqué** pour ACo-8/9 (l. 682, 791), motif **AD-26 §2** (l. 18, 357, 727, 983, 1000). |

Ces trois points sont désormais **mécanisés** : un rapport qui attribue « hors-couverture » à la page
est rejeté (R21), et un `statut=non-executable-relais` sans motif « câblage du relais » est rejeté (R16
durcie) — le rejet reste motivé si la numérotation de merge bouge (T23 n'est qu'un identifiant).

## 2. Le dépôt commun annoncé est **absent** : limite (a) levée par la page, pas par ce fichier

desk-design annonce `_shared/2026-10-31 note-portee-ACo-1-ACo-10 — texte canonique pour R20 (SPEC-015
reste rév. 7).md` comme levant la limite (a) de VERIF 027. **Ce fichier n'existe pas sur le disque :**

```
$ find /home/node/.mercury/bots/_shared -maxdepth 1 -name "*note-portee*"
(sortie vide)
$ ls -lb /home/node/.mercury/bots/_shared
AUDIT-renderer.md  SPEC-009-rev3-cablage-maillage.md  SPEC-012-AD-18-horloge-injectee.md
VERIF-004-ledger-tests-2026-10-31.md  item26-webapp-bloc5-et-heure-mac-web.txt  mercury-android/
mesure-app-item26.txt  mesure-webapp-item26.txt  verif-021-t17.md  work/          (10 entrées, aucune note de portée)
```

Conséquence, dite franchement : **je n'ai pas comparé R20 caractère par caractère à ce texte**, et
l'annexe de desk-design n'est pas lisible de mon côté. La limite (a) est levée **par une meilleure
route** : la page elle-même est lisible (`/work/lan-voice/SPECS/…`), et son sha256 est **exactement**
celui que desk-design publie (`cf1b2bbe…`) — donc nous parlons du même fichier. Les §§1 et 3 de ce
rapport sont mesurés sur la page, pas sur parole. Si le fichier est redéposé, je le signale et je
re-diff la formulation de R20 contre lui ; d'ici là, la référence de citation reste la page.

## 3. R20 confrontée à la page, règle par règle (ma vérification)

| Règle | Ce que j'encode | Preuve sur la page |
|---|---|---|
| R20.1 population **chiffrée** obligatoire | `verdict=hors-couverture` sans `population=` numérique = rejet | la page ne chiffre **rien** au-delà de 8/9 (l. 345, 674) : une ligne hors-couverture ne peut donc pas s'autoriser d'un chiffre de page |
| R20.2 bornes exactes | ACo-1 **1..8** ; ACo-10 **8 puis 9** → hors-couverture sur une population **dans** ces bornes = rejet symétrique (dérobade) | ACo-1 : l. **665** « pour **1..8 participants** » ; ACo-10 : l. **674** « **Pour 8 puis 9 vignettes** » (aussi l. 44) |
| R20.3 trio exact | `{ACo-8, ACo-9, ACo-16}` ⇒ `non-executable-relais`, motif **« câblage du relais » (T23)**, jamais hors-couverture | l. **151** et l. **1004** : « **ACo-8, ACo-9, ACo-16 — non exécutables jusqu'au câblage du relais** » ; 672, 673, 680 |
| ACo-1 population 9 **et 10** | hors-couverture **légal** avec `AD-26 §2` | la page l'anticipe, l. **44-47** : « je le note pour que **personne ne coche ACo-1 vert sur une population de 10** sans le savoir » ; l. 46 : « cela appartient au **lot C1** (AD-26 §2) » |
| ACo-10 population 10 | **aucun** cas hors-couverture légal ; seul état légal = `EN-ATTENTE-C1C2` | le manque est un **chiffre**, pas une décision de portée (l. 345 + 674 ne donnent que 8/9 ; le passage l. 728-733, lu, explique le plafond 8 de l'IPC et ne donne **aucun DIP** pour 10) et la page range la population dans « **La population (ACo-1, ACo-2, ACo-10) attend C1/C2** » (l. 969-970) ⇒ **en attente**, pas clôture |
| F2 (ACo-9, valeur ≠ 2000) | R15, inchangée : `vert`/`rouge` = rejet sans exception, seule issue `NON-CONFORME-C6` | l. **673** : « se rapporte “F1 vert / F2 non conforme — défaut de valeur, corrigé par une constante (C6, AD-26)”, **jamais vert** et jamais “rouge de rendu” » |

Trois statuts **disjoints** maintenus : `gelé` (14, 15 — l. 678-679, 688, 1005) / `non-executable-relais` (8, 9, 16) /
`hors-couverture` (chiffrée + `AD-26 §2`). Un AC hors-couverture **n'est jamais PASS ni vert** ;
`PASS` sur une telle ligne = rejet.

## 4. Ce qui a été changé dans le banc

| Fichier | État | sha256 | lignes |
|---|---|---|---|
| `VERIF/check-aco-017.sh` | **conservé tel quel** (trace de la rév. R15–R20) | `a3deb7eebe284f8124d1aacdf080f983b487ed17c6b1c3ec527b31b676ebd793` | 295 |
| `VERIF/check-aco-018.sh` | **nouveau** = 017 + R21 + R16 durcie + R19 ACo-10@10 | `19da27ef095b5aeaa437c8f40f17e6c9ad90248ff533f6083967244b650b4d64` | **367** |
| `VERIF/verif-024-harness.sh` | étape 7ter pointe 018, token `CHECK_ACO018` | `6eabceed36b141d9e735d4759797919fbdbbb3ac1484cd00d6aec6ed581068a9` | — |

**R21 — vocabulaire de citation** (nouvelle) :
1. `hors-couverture` dans un champ `citation=` / `dixit=` ⇒ **rejet** : 0 occurrence dans la page.
2. Tout `citation=` / `dixit=` doit être **verbatim** dans `SPECS/SPEC-015` (`grep -F` après
   normalisation des blancs, qui absorbe les retours à la ligne du Markdown).
3. Page illisible ⇒ **`RESULT=NOTRUN`**, jamais `PASS` (fail-closed), surcharge par `ACO_PAGE=<chemin>`.

**R16 durcie :** `statut=non-executable-relais` exige **`T23` ET** « `câblage du relais` » (le motif de
page ; T23 seul ne motive plus rien si la numérotation bouge). **R19 ouverte :** ACo-10 `population=10`
n'a qu'un état légal, `verdict=EN-ATTENTE-C1C2` + `attente=C1/C2` ; `PASS` et `hors-couverture` = rejet.

## 5. Preuves d'exécution (les seules mesures de ce rapport — aucune sur l'application)

**a) Autotest complet, 28 cas, 0 KO** (22/22 en 017, +6) :
`$ sh VERIF/check-aco-018.sh --selftest` → `CHECK_ACO018 RESULT=PASS selftest=28/28`.

**b) Isolement des nouveaux cas** — `sh sandbox/iso-r21.sh` (compte les `[REJET]` par journal) :

| cas | journal | rejets | règles | attendu |
|---|---|---|---|---|
| legal | ACo-10 `population=10 verdict=EN-ATTENTE-C1C2 attente=C1/C2 citation="La population (ACo-1, ACo-2, ACo-10) attend C1/C2"` | **0** | — | accepté : citation verbatim d'une phrase coupée par un retour à la ligne (l. 969-970) |
| m23 | citation `"hors-couverture"` | 1 | **R21** | isolé |
| m24 | `raison=T23` (sans « câblage du relais ») | 1 | **R16** | isolé |
| m25 | citation inventée contenant « hors-couverture » | 1 | **R21** | isolé |
| m26 | ACo-10@10 `EN-ATTENTE-C1C2` **sans** `attente=` | 1 | **R19** | isolé |
| m27 | ACo-10@10 `hors-couverture` | 2 | **R19 + R20** | **cumulatif, assumé** (deux motifs distincts sur la même ligne) |
| m22 | ACo-16@9 relais + `hors-couverture` (cas R20 de 027) | 1 | **R20** | isolé — la propriété de 027 est préservée |
| m29 | citation **vraie** `"1..8 participants"` (l. 665) | **0** | — | R21 n'est pas un refus de citation, seulement du non-verbatim |

**c) Mode état (arbre réel), inchangé depuis 027 :**
`$ sh VERIF/check-aco-018.sh` → `… DATE : 2026-10-31T03:43:40Z … CHECK_ACO018 RESULT=NOTRUN criteres=8`,
avec `speaking-relay=0`, `STALE=2000`, `KEEPALIVE=1000`, `backgroundThrottling` absent, `gele=2`, `FAIL=0`.

**d) Harnais :** `$ sh VERIF/verif-024-harness.sh --dry` → plan affiché, étape 7ter = `check-aco-018.sh`,
`CHECK_VERIF024 RESULT=SKIP reason=dry-run` (aucune mesure). `sh -n` sur le harnais et sur 018 : propres.

**e) Fail-closed :** `ACO_PAGE=/nonexistant sh check-aco-018.sh --validate <journal avec citation>` →
`RESULT=NOTRUN … reason=page-illisible citations-non-verifiees` (cas m28 de l'autotest). Sans page, le
banc **ne dit pas** PASS.

## 6. Non vérifié — nommé comme tel

- **Le texte canonique de desk-design** (§2 : fichier absent). Tout ce que j'affirme sur la page est
  mesuré ici ; tout ce qui vient de leur annexe est signalé comme tel dans leur message, pas repris
  comme preuve.
- **m27 n'est pas isolé** (2 violations) : l'autotest n'affirme qu'accepter/rejeter ; le compte par règle
  vient du tableau 5b, pas du harnais.
- **Aucune mesure applicative.** Aucun AC coché. Les trois termes de la rév. 8 — lot C1 mergé
  (`SPEAKING_SET_MAX` 9→10, l. 18), géométrie à 10 chiffrée (l. 345/674/731), T23 mergé — **je n'en
  vérifie aucun, je les nomme** ; l'état 03:43:40Z (`speaking-relay=0`) montre qu'aucun n'est tenu.
  R19/R20 restent donc prêtes à basculer sur 1..10 en une ligne, sans être exercées.
- **Divergence C4** (relais main 260-301 ms vs zéro usage des clés), signalée par desk-design : **hors
  de mon objet aujourd'hui**, non instruite — à relever au merge de T23.
