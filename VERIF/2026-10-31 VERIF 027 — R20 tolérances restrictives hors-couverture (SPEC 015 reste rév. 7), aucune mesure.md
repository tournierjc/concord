# 2026-10-31 VERIF 027 — « hors-couverture » : les deux tolérances restrictives encodées (R20)

**Rédigé par :** desk-qa (Banc) — **Date :** 2026-10-31T03:38Z — **Banc :** `/work/lan-voice`
**Objet :** intégrer dans le validateur les deux tolérances **restrictives** de la note de portée
ACo-1 / ACo-10 livrée par desk-design (2026-10-31, work/), sans toucher à SPEC-015 et **sans lancer
aucune mesure**.
**Page de référence :** `SPECS/SPEC-015-overlay-population-unie-et-halo.md`,
**rév. 7** — sha256 `cf1b2bbe536a80b53025b0016eb55855400f139faa1a14402aed0f313652498a`,
mtime `2026-10-31T04:33:17Z`.

## 0. Verdict de cet addendum, en trois lignes

| Objet | Verdict | Preuve |
|---|---|---|
| Encodage R20 (tolérances restrictives) | **PASS** | `--selftest` = **22/22**, dont **5 nouveaux cas illégaux** (m18..m22), chacun **isolé** (1 seule violation, motif R20) — §3 et §4 |
| Comportement sur le journal réel | **NOTRUN** | `RESULT=NOTRUN criteres=8 raison=T23-non-merge-et-arbre-non-gele ; gele=2 ; FAIL=0` — §5 |
| Mesures (latence, CPU, débit, perte, LAN-only) | **AUCUNE** | hors périmètre de cet addendum (§7) |

**Aucun AC coché.** Aucun chiffre de performance produit ici : cet addendum ne fait que durcir le
**validateur de journaux**, pas la recette.

## 1. Ce qui change — et ce qui ne change pas

- **Ne change pas :** la page reste **rév. 7**. ACo-1 = « 1..8 », ACo-10 = « 8 puis 9 », textes intacts ;
  aucun caractère de §5.2 modifié. Je n'ai **rien réencodé** des quatre points que desk-design a
  confirmés conformes (R15 étiquette F2 canon + `verdict=NON-CONFORME-C6` ; R16 motif nommant T23 ;
  R17 ACo-16 les deux sens ; R18 ACo-14/15 gelés pour mesure).
- **Change :** deux tolérances **restrictives** ajoutées sous la règle **R20** (elles n'existaient que
  sous forme narrative dans la note, pas sous forme exécutable) :
  1. `verdict=hors-couverture` **sans population chiffrée** sur la ligne ⇒ **rejet** (avant R20,
     `population` absente tombait dans le `case` de R19 sans rien déclencher : trou réel).
  2. `verdict=hors-couverture` sur une population **dans la couverture** ⇒ **rejet symétrique**
     (« dérobade, pas mesure ») : ACo-1 **1..8**, ACo-10 **8 ou 9**. Conséquence logique de la note :
     **ACo-10 n'a aucun cas `hors-couverture` légal** (10 n'est pas chiffré au §5.2).
  3. Corollaire déjà porté par R16 mais désormais fermé aussi par R20 : ACo-8 / ACo-9 / ACo-16 avec
     `verdict=hors-couverture` ⇒ rejet, statut attendu `non-executable-relais` (motif nommant **T23**).

Aucune des trois n'assouplit quoi que ce soit. `hors-couverture` reste **exécutable** (l'AC n'est pas
gelé), la **population** sort de la borne, et la citation **AD-26 §2** reste obligatoire (R19).

## 2. Le vrai blocage (motif de desk-design) vérifié indépendamment

Je n'ai pas pris le motif sur parole ; je l'ai relu dans la page :

```
$ cd /work/lan-voice
$ grep -n "ACo-1 —\|ACo-10 —\|rangée" SPECS/SPEC-015-overlay-population-unie-et-halo.md
345:8 vignettes = 1 rangée, hauteur 44 DIP ; **9 vignettes = 2 rangées, hauteur 80 DIP**. Une fenêtre
665:| **ACo-1 — Population identique** | ... pour 1..8 participants et pour chaque cas de 013b §4 ...
674:| **ACo-10 — Trois usages, un compte** | Pour 8 puis 9 vignettes : ... Rappel des chiffres :
     8 ⇒ 1 rangée/44 DIP, 9 ⇒ 2 rangées/80 DIP | ...
```

- Population ACo-1 = **1..8** (l. 665) ; ACo-10 = **8 puis 9** (l. 674). Conforme à R19/R20.
- Géométrie **chiffrée** pour **8** (1 rangée / 44 DIP) et **9** (2 rangées / 80 DIP) — **et pour rien
  d'autre** (l. 345 et 674 sont les seules occurrences chiffrées ; la l. 731 affirme « la géométrie sait
  déjà faire deux rangées » **sans chiffrer** 10). ⇒ un AC à population 10 serait un AC **sans valeur
  attendue**. Mon rejet de `ACo-10 population=10` (R19) et de tout `hors-couverture` sur ACo-10 (R20)
  est donc fondé sur la page, pas sur une convention de procédure.
- En-tête : **rév. 7 courante** (l. 8), **aucune rév. 8** dans le fichier ⇒ R19/R20 restent la borne
  exacte du jour. Condition de rév. 8 (nommée par desk-design, trois termes cumulatifs : lot C1 mergé /
  géométrie à 10 chiffrée / T23 mergé) : **non tenue à 03:38Z** (voir §5) — donc rien à réencoder avant.

## 3. R20 — les 5 cas illégaux, avec la sortie exacte

Commande (une ligne par cas, journal d'une ligne) :

```
$ cd /home/node/.mercury/bots/desk-lead/desk-qa/sandbox
$ printf '%s\n' "<cas>" > r20.j && sh /work/lan-voice/VERIF/check-aco-017.sh --validate r20.j
```

| # | Ligne injectée | Sortie (verbatim, tronquée à la 1re ligne) |
|---|---|---|
| m18 | `ACo-1 verdict=hors-couverture` | `[REJET] R20 ACo-1 verdict=hors-couverture sans population CHIFFRÉE sur la ligne (population='') — hors-couverture non chiffrée = rejet` |
| m19 | `ACo-1 population=8 verdict=hors-couverture AD-26 §2` | `[REJET] R20 ACo-1 population=8 verdict=hors-couverture : 1..8 est DANS la couverture (rejet symétrique — dérobade, pas mesure)` |
| m20 | `ACo-10 population=9 verdict=hors-couverture AD-26 §2` | `[REJET] R20 ACo-10 population=9 verdict=hors-couverture : ACo-10 couvre 8 et 9, et 10 n'est pas chiffré au §5.2 (géométrie 8/9 seule) — hors-couverture n'est jamais légal sur cet AC` |
| m21 | `ACo-1 population=neuf verdict=hors-couverture AD-26 §2` | `[REJET] R20 ACo-1 verdict=hors-couverture sans population CHIFFRÉE sur la ligne (population='neuf') — hors-couverture non chiffrée = rejet` |
| m22 | `ACo-16 population=9 statut=non-executable-relais raison=relais-non-cable-T23 verdict=hors-couverture` | `[REJET] R20 ACo-16 verdict=hors-couverture : statut attendu non-executable-relais (motif nommant T23)` |

Chaque cas produit **exactement 1 violation** (`violations=1`), et cette violation est **R20** : le
rejet vient bien de la nouvelle règle, pas d'un effet de bord de R15..R19. C'est le critère qui rend le
selftest probant (un test qui rougit pour la mauvaise raison ne prouve rien).

## 4. Le légal reste accepté (garde anti-sur-blocs)

```
$ printf 'ACo-1 population=9 paroleurs=9 verdict=hors-couverture motif=population-9>8 AD-26 §2\nACo-1 population=10 verdict=hors-couverture motif=plafond-10-declare lot=C1 AD-26 §2\n' > ok20.j
$ sh /work/lan-voice/VERIF/check-aco-017.sh --validate ok20.j
CHECK_ACO017 RESULT=PASS violations=0
```

⇒ `hors-couverture` **chiffré** sur ACo-1 à 9 (et à 10, avec citation AD-26 §2) reste **accepté** : R20
n'interdit pas le statut, elle interdit le statut **non chiffré** et le statut **dérobé** (population
dans la couverture). Le journal « légal » du selftest contient désormais cette forme.

Compteurs à 03:38Z :

```
$ sh /work/lan-voice/VERIF/check-aco-017.sh --selftest | tail -1
CHECK_ACO017 RESULT=PASS selftest=22/22
$ sha256sum /work/lan-voice/VERIF/check-aco-017.sh
a3deb7eebe284f8124d1aacdf080f983b487ed17c6b1c3ec527b31b676ebd793
$ wc -l /work/lan-voice/VERIF/check-aco-017.sh
295
```

(17/17 → **22/22** : m18..m22 ajoutés ; aucun ancien cas retiré. Le harnais `verif-024-harness.sh`
étape **7ter** a sa ligne de sortie mise à jour ; `--dry` reste `RESULT=SKIP reason=dry-run (aucune mesure)`.)

## 5. État de l'arbre re-mesuré (aucune mesure d'exécution)

```
$ cd /work/lan-voice/VERIF && sh check-aco-017.sh
=== check-aco-017.sh — SPEC-015 rév. 7 (errata AD-26), T23 : état, aucune mesure ===
RACINE : /work/lan-voice   DATE : 2026-10-31T03:38:03Z
-- câblage : overlay-entry speaking-relay=0  STALE=2000  KEEPALIVE=1000
-- C5(a) backgroundThrottling : ABSENT de main/index.ts -> ACo-14/ACo-15 restent gelés POUR UNE MESURE
CHECK_ACO017 RESULT=NOTRUN criteres=8 raison=T23-non-merge-et-arbre-non-gele ; gele=2 (ACo-14, ACo-15, pour mesure) ; FAIL=0
```

Lecture : `speaking-relay` importé **0** fois par `overlay-entry.tsx` ⇒ **T23 non mergé** ⇒ ACo-8,
ACo-9, ACo-16 restent `non-executable-relais` (R16) et **aucune population 9/10 n'est atteignable à
l'écran** — ce qui rend ACo-1 population 9/10 et ACo-10 non mesurables aujourd'hui, indépendamment de
la borne de la page. `backgroundThrottling` absent ⇒ C5(a) non posée ⇒ ACo-14/ACo-15 **gelés** (R18),
sans verdict. `FAIL=0` : R20 ne déclenche rien sur les journaux réels actuels — cohérent, aucun journal
ne porte encore de `hors-couverture`.

## 6. Ce que je ne relâcherai pas (maintenu contre desk-design si besoin)

`VERT`/`ROUGE` sur une ligne **F2** reste un **rejet**. F2 est une **valeur** ; sa seule issue légale
est `verdict=NON-CONFORME-C6` avec l'étiquette **mot pour mot**. Aucun AC coché, rien mesuré : d'accord
pour attendre l'arbre gelé + T23 mergé.

## 7. Points **non vérifiés** (nommés comme tels)

1. **La note de portée elle-même n'a pas été lue en fichier.** L'accès en lecture à
   `/home/node/Mercury/Desktop LAN/work` m'est refusé (`Permission denied`, mode `read`). L'encodage
   R20 repose donc sur le **texte du message** de desk-design (2026-10-31) et sur ma **relecture
   indépendante de SPEC-015** (§2). Si le fichier livré diffère du message sur un point, c'est le
   message que j'ai encodé — à re-vérifier dès que la lecture de `work/` m'est accordée.
2. **Géométrie à 10 : non vérifiée, et non chiffrable depuis la page** — c'est précisément le blocage
   (motif de rév. 8, terme (b)).
3. **ACo-14 / ACo-15 : aucun verdict** (gelés) — C5(a) non posée, non mesuré.
4. **ACo-8 / ACo-9 / ACo-16 : non exécutables** — T23 non mergé, non mesuré.
5. **ACo-1 population 9/10 et ACo-10 population 10 : jamais exécutés** — hors couverture, et population
   9/10 inatteignable à l'écran tant que T23 n'est pas mergé.
6. **Aucune mesure** de latence, CPU, débit, perte de paquets, ni de « LAN only » dans cet addendum :
   rien n'a été lancé, `RESULT=NOTRUN` le dit. Ces chiffres viendront avec VERIF-024 quand l'arbre sera
   gelé et T23 mergé.
7. **Condition de rév. 8 non vérifiée par moi** au-delà du terme (c) : je constate T23 non mergé
   (`speaking-relay=0`) ; je n'ai pas contrôlé le lot C1 ni `SPEAKING_SET_MAX 9→10` dans cet addendum
   (hors objet R20, et déjà tracé dans VERIF-026).

## 8. Repro complète

```
cd /work/lan-voice/VERIF
sh check-aco-017.sh --selftest          # -> RESULT=PASS selftest=22/22
sh check-aco-017.sh                     # -> RESULT=NOTRUN ... FAIL=0
sh verif-024-harness.sh --dry           # -> RESULT=SKIP reason=dry-run (aucune mesure)
sha256sum check-aco-017.sh SPECS/../SPECS/SPEC-015-overlay-population-unie-et-halo.md
```
