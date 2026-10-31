# VERIF-024 — addendum ACo (SPEC-015 rév. 5) : surfaces et règles de rapport

> **ERRATUM (2026-10-31T03:30Z, AD-26)** — La question C6 est **fermée** : `SPEAKING_RELAY_STALE_MS`
> vaut **2000**, sans dérogation, bornes `t0+1999` vrai / `t0+2001` faux. Partout où ce document
> écrit « hors canon, arbitrage C6 », lire : **« F2 non conforme — défaut de valeur (C6, AD-26) »**.
> Aucun chiffre de ce document ne change ; seule l'étiquette de rapport est périmée. Le validateur
> `VERIF/check-aco-015.sh` (rév. 2) **refuse** désormais l'ancienne étiquette (règle R5).

**Date** : 2026-10-31T03:27Z (04:27 CEST) · **Banc** : desk-qa · **Statut** : préparation seule,
**aucune mesure de rendu produite**, T23 non mergé.

Cet addendum encode, dans le harnais VERIF-024, les cinq contraintes d'exécution transmises pour
SPEC-015 rév. 5. Il ne coche **aucun** AC : il rend chaque AC soit mesurable, soit explicitement
`NOTRUN` avec sa raison. Règle appliquée : une surface absente ne donne jamais PASS.

## 1. Pourquoi rien n'est mesuré (état de l'arbre à 03:27Z)

| Fichier | mtime |
|---|---|
| `src/renderer/Overlay.tsx` | 2026-10-31T04:07:39 |
| `tests/speaking-relay.test.ts` | 2026-10-31T04:18:16 |
| `package.json` | 2026-10-31T04:18:58 |

L'arbre a bougé après la clôture de VERIF-023 ; aucune empreinte n'est stable. `git log` impossible :
`/work/lan-voice` n'est pas un dépôt git (`fatal: not a git repository`) — l'état se prouve donc par
`sha256sum`, pas par un commit.

## 2. Surfaces présentes / absentes — mesuré, pas supposé

```
$ cd /work/lan-voice && sh VERIF/check-aco-015.sh
```
Sortie (extraits, 03:27Z) :

- **ACo-6** — `overlaySpeaking` exporté par `participant-state.ts` : **0**. Appels `peerSpeaking(`
  dans `Overlay.tsx` : **1** (ligne 75). ⇒ `NOTRUN` (surface absente).
- **ACo-9 F2** — `SPEAKING_RELAY_STALE_MS` : **absente** de `src/renderer/speaking-relay.ts`.
  Seule `SPEAKING_KEEPALIVE_MS = 1000` existe (ligne 31). ⇒ `NOTRUN`, aucune constante à comparer
  au canon 2000. **Le « 2500 » annoncé pour le consommateur n'existe nulle part dans l'arbre**
  (`grep -rn "2500\|stale" src tests` → 0 occurrence hors `SPEAKING_STALE_MS = 250`, autre grandeur) :
  l'arbitrage C6 est donc à trancher sur la spécification, pas sur une valeur mesurée ici.
- **ACo-9 F1** — aucune mesure : exige le relais vivant et un producteur tuable.
- **ACo-14** — surface relayée non instrumentée.

**Constat qui compte** : le « `unknown` sur 100 % des vignettes » d'aujourd'hui tient **par vacuité**,
pas par construction. `Overlay.tsx` lit `PEER_LEVELS`, table locale **vide** dans la fenêtre d'overlay
(commentaire ligne 23 et suivantes). Preuve que la valeur `false` est atteignable dès que T23 remplit
cette table :

```
$ npx --no-install tsx -e 'import {peerSpeaking} from "./src/renderer/participant-state.ts";
  const t=new Map([["p1",{speaks:"false",at:1000}]]);
  console.log(peerSpeaking("p1",t,1100), peerSpeaking("p1",t,2000), peerSpeaking("p1",new Map(),1100))'
false unknown unknown
```

⇒ Au merge de T23, si l'overlay continue d'appeler `peerSpeaking(` au lieu d'une porte à deux valeurs,
`data-speaking="false"` devient émissible et ACo-6 casse **sans qu'aucun test ne rougisse** (aucun test
actuel n'attend `false` sur une vignette d'overlay : rien ne le garde). C'est ce que la garde S1 de
`check-aco-015.sh` détecte.

## 3. Les quatre règles de rapport, encodées et autotestées

Le validateur de journal (`check-aco-015.sh`, fonction `validate`) refuse :

| Règle | Ce qui est refusé | Pourquoi |
|---|---|---|
| R1 | `ACo-6 … attr=false` | l'overlay ne produit que `true\|unknown` ; un test qui attend `false` est **non exécutable**, pas rouge |
| R2 | `ACo-9` non fragmenté (ni ` F1 ` ni ` F2 `) | F1 autonomie et F2 valeur sont deux rapports distincts |
| R3 | `ACo-9 F1 …` sans `reload=0` | le main rejoue le dernier ensemble au `did-finish-load` et la charge n'a pas d'horodatage : un rechargement remet l'horloge à zéro ⇒ faux vert |
| R4 | `ACo-14` sans `observe_ms=`, ou portant `attendu_ms=680` | les 680 ms ± 1 image sont établis sur la **table producteur** ; sur la surface relayée on rapporte l'observé, sans recopier la tolérance |

Le validateur est autotesté (4 journaux illégaux doivent être rejetés, 1 journal légal accepté) :

```
$ sh VERIF/check-aco-015.sh --selftest
  [OK] rejeté  (ACo-6 id=peer-1 attr=false)
  [OK] rejeté  (ACo-9 bloc non fragmenté)
  [OK] rejeté  (ACo-9 F1 … reload=1)
  [OK] rejeté  (ACo-14 surface=relayee attendu_ms=680)
CHECK_ACO015 RESULT=PASS selftest=4/4 rejets + 1 journal légal accepté
```

Un contrôle qui ne sait pas rougir n'est pas un contrôle : c'est ce que ce `--selftest` établit.

## 4. Protocole à exécuter au merge de T23 (écrit, non lancé)

**ACo-9 F2** (statique, 30 s) — `sh VERIF/check-aco-015.sh` doit rendre
`ACo-9 F2 … [OK]` avec `valeur=2000` et `2000 >= 2 × 1000`. Si la constante vaut 2500 : F2 est
**hors canon** ⇒ rapport « arbitrage C6 », ni vert ni rouge de rendu.

**ACo-9 F1** (comportemental) — 1 overlay chargé, relais actif, un producteur publiant `true` ;
tuer le producteur à `t0` **sans toucher à la fenêtre** (interdit : `reload`, `did-finish-load`
supplémentaire, recréation de la `BrowserWindow`). Journaliser la date du dernier `true` reçu et du
premier `unknown` : `extinction_ms = t(unknown) − t(dernier true)`, attendu `≤ constante + 1 trame`
et `≤ 2` rendus sur la fenêtre d'1 s. Ligne de rapport :
`ACo-9 F1 extinction_ms=<n> trames=<n> rendus=<n> reload=0`.
Le cas **« rechargement + producteur mort »** se rapporte à part (il ne vaut pas F1 : l'horloge repart
de zéro sur un ensemble périmé).

**ACo-14** — mesurer sur la surface relayée, rapport `observé_ms=<n>` ; ne pas réutiliser 680.

## 5. Table d'état (03:27Z) — rien de coché

| AC | État | Raison |
|---|---|---|
| ACo-6 | `NOTRUN` | `overlaySpeaking` absent ; `unknown` tient par vacuité (voir §2) |
| ACo-8 | `NOTRUN` (gel) | hors gel jusqu'au merge de T23 (C4 §7) |
| ACo-9 F1 | `NOTRUN` | producteur tuable + relais vivant requis |
| ACo-9 F2 | `NOTRUN` | `SPEAKING_RELAY_STALE_MS` absente de l'arbre |
| ACo-13 | **seul état livrable** | halo éteint partout, `unknown` sur 100 % des vignettes |
| ACo-14 | `NOTRUN` | surface relayée non instrumentée |

## 6. Câblage et vérification du harnais

`VERIF/verif-024-harness.sh` : nouvelle étape **7** (`check-aco-015.sh` + autotest), ancienne étape
empreinte devient **8** (journaux renommés `8-sha-apres.txt`). Le bilan porte `aco_rc=` et
`aco_selftest=` ; une surface en contradiction (`FAIL`) ou un autotest cassé fait échouer le harnais,
un `NOTRUN` ne le fait pas échouer (pré-merge légitime, mais alors la ligne `bilan` le dit).

```
$ sh -n VERIF/verif-024-harness.sh && sh VERIF/verif-024-harness.sh --dry
sh -n OK
  7) ACo SPEC-015 : check-aco-015.sh (+ autotest)
CHECK_VERIF024 RESULT=SKIP reason=dry-run (aucune mesure)
```

Aucune mesure VERIF-024 n'a été lancée : `--dry` seulement.

## 7. Non vérifié (nommé comme tel)

- Aucun chiffre de rendu : pas de `extinction_ms`, pas de rendu/s, pas de latence.
- ACo-8/ACo-9 restent hors gel : **aucun** essai de halo, aucune vignette observée à l'écran.
- Le « 2500 » du consommateur n'est pas constatable dans l'arbre (§2) ; il n'est donc ni confirmé ni
  infirmé par mesure.
- La garde S1 est **textuelle** (occurrence de `peerSpeaking(` dans `Overlay.tsx`) : un alias ou un
  appel indirect la tromperait, exactement comme A8 avant VERIF-025. Elle vaut comme garde de merge,
  pas comme preuve de comportement.
- Empreintes : `sha256sum` des cinq fichiers cités §1 ; sans dépôt git, aucune preuve par commit.
