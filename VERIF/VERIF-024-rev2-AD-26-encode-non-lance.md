# VERIF-024 rév. 2 — AD-26 encodé dans le banc (C6 = 2000, C1a séparé, C5 sous mesure)

**Date** : 2026-10-31T03:30Z (04:30 CEST) · **Banc** : desk-qa · **Statut** : **préparée, NON lancée**.
**Aucune mesure de rendu, aucun chiffre T23** dans ce document. Tout ce qui suit est soit statique
(lecture d'arbre), soit un autotest du banc, soit une mesure de contrat isolée et datée.

Arbre au moment de l'écriture : T23 **non mergé** — `SPEAKING_RELAY_STALE_MS` **absente** de
`src/renderer/speaking-relay.ts` (sha256 `aef6b1af0c65e4bb`), `backgroundThrottling` **0 occurrence**
dans `src/main/index.ts` (`242c8e6f992346ce`), `SPEAKING_SET_MAX = 9`
(`src/shell/ipc-contract.ts` `11400d427777dcdf`), `package.json` `62372e9a571c53af` (04:18:58 CEST).

---

## 1. Ce qu'AD-26 change dans le banc, et rien d'autre

| Décision AD-26 | Traduction exécutable | Preuve que le banc l'applique |
|---|---|---|
| **C6 fermé : 2000**, bornes `t0+1999` vrai / `t0+2001` faux | R5 + R6 du validateur : l'étiquette « hors canon / arbitrage C6 » est **rejetée** ; une valeur ≠ 2000 **ne peut pas** être cochée `conforme`/`vert`/`PASS` ; une F2 à 2000 avec `t2001=true` est une **contradiction** rejetée | selftest cas 5, 6, 8 |
| **C1 (a) : affichage 10 / rejoindre 8**, lot **hors T23** | R8 : `population=10` sans `lot=C1a` rejeté ; `lot=T23` rejeté ; `population=10` avec `parole_max=9` rejeté ; S5b : invariante `SPEAKING_SET_MAX ≥ IPC_MAX_PARTICIPANTS + 1` | selftest cas 11 ; mutants A/B §3 |
| **ACo-15 gelé**, C5 sous mesure datée | R7 : `ACo-15 … verdict=PASS` sans `fenetre_reduite=1` **et** `producteur_tue=1` **et** `date=` **et** `rendus_par_s≤2` est rejeté — le drapeau posé ne coche rien | selftest cas 9, 10 |

Étiquettes désormais **imposées** (elles ne sont pas des préférences de rédaction, elles sont dans le
validateur) : un consommateur à 2500 se rapporte **« F1 vert / F2 non conforme — défaut de valeur,
corrigé par une constante (C6, AD-26) »**. Jamais « vert » (F2 est faux), jamais « rouge de rendu »
(le mécanisme et ACo-8 tiennent). Seul **ACo-2** nomme un id quand il échoue → règle R9.
L'addendum livré à 03:27Z portait l'ancienne étiquette : **erratum posé en tête du fichier**
(`VERIF-024-addendum-ACo-SPEC-015-rev5.md`), aucun chiffre de ce document n'est modifié.

## 2. Le validateur sait rougir — `--selftest`

```
$ sh VERIF/check-aco-015.sh --selftest
…
CHECK_ACO015 RESULT=PASS selftest=12/12 rejets + 1 journal légal accepté (AD-26)
```

12 journaux **illégaux** rejetés (un par règle, plus les doublons de la même règle atteinte par un
autre chemin), 1 journal **légal** accepté — dont une F2 à **2500 correctement étiquetée
« non conforme »** et une ACo-15 **datée** à `rendus_par_s=1`. Chaque rejet nomme sa règle :

```
$ printf '%s\n' 'ACo-9 F2 constante=SPEAKING_RELAY_STALE_MS valeur=2500 keepalive=1000 ratio=2.5 t1999=true t2001=true verdict=conforme' \
  | sh VERIF/check-aco-015.sh --validate
  [ILLEGAL] R5 valeur=2500 (canon 2000) cochée conforme/verte
CHECK_ACO015_JOURNAL RESULT=ILLEGAL
```

## 3. Contre-épreuves sur copies isolées (protocole VERIF-021 §5, hors `src/`)

Deux arbres bricolés dans le sandbox, script copié avec la source mutée ; **aucune écriture dans
`src/`, `tests/`, `package.json`**.

| Mutant | Mutation | Attendu | Obtenu |
|---|---|---|---|
| **A** | `IPC_MAX_PARTICIPANTS` 8→9 (salon plein = 10 ids, parole reste 9) | FAIL invariante | `[FAIL] 9 < 9+1 … halo éteint partout` · `RESULT=FAIL` · `rc=1` |
| **B** | `SPEAKING_RELAY_STALE_MS = 2500` ajoutée dans la copie | FAIL valeur, étiquette imposée | `[FAIL] hors canon 2000` + étiquette AD-26 · `RESULT=FAIL` · `rc=1` |

## 4. État des surfaces, mesuré à 03:29:23Z — `NOTRUN=6 FAIL=0`

```
$ sh VERIF/check-aco-015.sh
CHECK_ACO015 RESULT=NOTRUN surfaces_absentes=6 raison=T23-non-merge (ACo-13 seul état livrable)
```

ACo-6 (pas d'`overlaySpeaking`, `Overlay.tsx` appelle encore `peerSpeaking(` → `false` atteignable dès
que la table se remplit), ACo-9 F1, ACo-9 F2 (constante absente), ACo-14 (surface relayée), C1a,
ACo-15 : **aucun n'est coché**. ACo-13 reste le seul état livrable.

## 5. Ce que ta note ne dit pas et que la mesure dit : le piège C1a est **déjà armé**

`MAX_OVERLAY_PARTICIPANTS = 10` **existe déjà** (`src/shell/overlay-geometry.ts:67`,
`1ecac92fb60eeca5`) et `Overlay.tsx:43` tranche à 10 : le côté **affichage** de C1 (a) est en place
depuis 2026-10-30T23:59 CEST. Seul le côté **parole** est resté à 9. Mesure de contrat, isolée :

```
$ npx --no-install tsx sandbox/c1a-probe.mts
date            2026-10-31T03:29:42.004Z
SPEAKING_SET_MAX                 9
MAX_OVERLAY_PARTICIPANTS         10
canal                           lan:event:speaking-set
ids= 1  ACCEPTE      ids= 8  ACCEPTE      ids= 9  ACCEPTE
ids=10  REFUS-EN-BLOC code=invalid-payload msg="payload.speaking: plus de 9 entrées"
ids=11  REFUS-EN-BLOC code=invalid-payload msg="payload.speaking: plus de 9 entrées"
temoin id>64 ids=1  REFUS code=invalid-payload
```

Conséquences, bornées à ce que j'ai mesuré :

1. Le refus est **en bloc, pas une troncature** (`idList` : `value.length > max` ⇒ tout le payload
   invalide, `ipc-contract.ts:412`) : une population de 10 ferait tomber **tous** les halos à
   `unknown`, ce qui se lirait comme un échec d'ACo-8/ACo-9 alors que c'est un plafond.
2. Il est **aujourd'hui inatteignable par le chemin normal** : rejoindre plafonne à 8, donc 9 ids avec
   soi — l'invariante `9 ≥ 8+1` tient. Ce qui protège, c'est le plafond de **rejoindre**, pas le code
   d'affichage.
3. Donc l'ordre du lot C1a est contraint : **`SPEAKING_SET_MAX` 9→10 doit partir dans le même
   changement que toute hausse du plafond de rejoindre**. Un merge qui ne toucherait que
   `ipc-contract.ts:282/606–609/642` côté affichage laisserait le piège armé sans le déclencher, et le
   premier salon à 10 produirait un noir intégral. C'est encodé (S5b, R8) et non laissé à la lecture.
4. Ce n'est **pas** un défaut de rendu à ouvrir : c'est une contrainte d'ordonnancement de merge.

## 6. VERIF-024 : préparée, **non lancée** — raison datée

```
$ sh VERIF/verif-024-harness.sh --dry
  1) test:node vs tests/*.test.ts   2) sha256 AVANT   3) run-all.sh
  4) npm run test:node               5) tsc x2          6) a8-variants.py
  7) ACo SPEC-015 : check-aco-015.sh (+ autotest)  8) sha256 APRÈS + diff (VOID si l'arbre a bougé)
CHECK_VERIF024 RESULT=SKIP reason=dry-run (aucune mesure)
```

Arbre non gelé au 03:30Z : `package.json` 04:18:58, `tests/speaking-relay.test.ts` 04:18:16,
`src/main/index.ts` 04:17:43, `src/shell/ipc-contract.ts` 04:14:40 (CEST) — et T23 absent. Lancer
maintenant produirait un `NOTRUN` de rendu et un diff d'empreintes **VOID**. Les quatre constantes
ci-dessus sont mon jeu de référence ; toute passe réelle commencera par un `sha256` AVANT/APRÈS
(étape 2/8) et sera **VOID** si un seul octet bouge. Le harnais vérifie désormais aussi que
`check-aco-015.sh --selftest` reste `PASS` : un contrôle dont l'autotest casse ne compte pas.

## 7. Non vérifié — nommé comme tel

- **Aucune** grandeur de rendu : ni F1 (`extinction_ms`), ni F2 observée, ni ACo-14 sur surface
  relayée, ni `rendus_par_s`. Les règles R1–R9 valident la **forme et la cohérence** d'un journal ;
  elles ne prouvent pas qu'un journal dit vrai — c'est la mesure qui le dit, pas le validateur.
- La sonde du §5 importe la **source** via `tsx`, pas le bundle `dist/` : elle établit le comportement
  du contrat, pas celui de l'application empaquetée.
- La garde S1 (`peerSpeaking(` dans `Overlay.tsx`) reste **textuelle** : un alias la trompe, exactement
  comme A8 avant VERIF-025. Elle vaut comme garde de merge, pas comme preuve de comportement.
- Je n'ai pas vérifié l'effet **visuel** de la tranche `slice(0, 10)` (10 vignettes à l'écran) : hors
  de ce que je mesure sans T23.
- ACo-15 : le protocole (fenêtre principale réduite + producteur tué ⇒ F1 passe, `rendus_par_s ≤ 2`)
  est écrit et refusé en forme s'il est incomplet, mais **non exécuté** ; le drapeau n'est même pas
  posé dans l'arbre (0 occurrence).

## 8. Fichiers touchés (tous sous `VERIF/` et sandbox)

`VERIF/check-aco-015.sh` (rév. 2, R1–R9, `--validate`, `--selftest`, S5b) ·
`VERIF/verif-024-harness.sh` (2 lignes d'attendu AD-26 ajoutées à l'étape 7) ·
`VERIF/VERIF-024-addendum-ACo-SPEC-015-rev5.md` (erratum d'étiquette) ·
`VERIF/VERIF-024-rev2-AD-26-encode-non-lance.md` (ce document) ·
sandbox : `c1a-probe.mts`, `mutA/`, `mutB/`.
