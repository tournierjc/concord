# VERIF-024 rév. 3 — SPEC-015 rév. 6 encodée (ACo-16, statuts C4/C5, F1 chiffrée) — préparée, NON LANCÉE

Banc (desk-qa) — 2026-10-31. Racine : `/work/lan-voice`. Aucune écriture hors `VERIF/` et sandbox.
Statut de cette passe : **préparée, non lancée**. Aucune grandeur de rendu n'est rapportée ici.

---

## 0. Pourquoi non lancée — preuve datée, pas déclaration

Sonde à l'instant du rapport, âge mesuré par `stat -c %Y` contre `date +%s` (indépendant du fuseau) :

```
cd /work/lan-voice && now=$(date +%s) && for f in ...; do printf '%s age=%ss sha=%s\n' "$f" "$(( now - $(stat -c %Y "$f") ))" "$(sha256sum "$f" | cut -c1-16)"; done
```

| fichier | âge | sha256 (16) |
|---|---|---|
| `tests/speaking-relay.test.ts` | **16 s** | `b757e6bff75d4a87` |
| `src/renderer/speaking-surface.ts` | **26 s** | `ca2f4db4ebf4624c` |
| `src/renderer/Overlay.tsx` | **76 s** | `a11ad1b58de0fce5` |
| `package.json` | 816 s | `62372e9a571c53af` (= référence VERIF-024, **inchangé**) |
| `src/shell/ipc-contract.ts` | 1074 s | `11400d427777dcdf` (= référence) |
| `src/renderer/speaking-relay.ts` | 1149 s | `aef6b1af0c65e4bb` (= référence) |

Trois fichiers du périmètre T23 ont bougé **de 16 à 76 secondes avant la sonde** : l'arbre est en cours
d'écriture, T23 est en train d'atterrir. Toute passe lancée maintenant produirait des empreintes mortes —
c'est exactement le motif VOID de VERIF-023. `package.json` n'a pas bougé (sha identique à la référence).

## 1. Ce que la mesure dit du câblage, à cette date

- **Câblage présent** : `src/renderer/overlay-entry.tsx:16` — `import { createSpeakingSurface, type SpeakingIds } from './speaking-surface';`
- **F2, valeur** : `SPEAKING_RELAY_STALE_MS = 2000` — `src/renderer/speaking-surface.ts:39`. Le commentaire
  l. 37 dit explicitement : « Et c'est bien 2000, pas 2500 ».
- **Garde-vie 1 Hz (prérequis d'ACo-16)** : `SPEAKING_KEEPALIVE_MS = 1000` (`speaking-relay.ts:31`),
  émission conditionnée par `now - sentAt >= SPEAKING_KEEPALIVE_MS` (`:116`). 3 messages en 3 s = attendu réalisable.
- **ACo-9 F2, 2ᵉ clause** : `2000 >= 2 × 1000` tient **par égalité**. Mais le commentaire
  `speaking-surface.ts:34-37` affirme que les deux nombres « ne sont pas liés » — la clause est donc
  arithmétiquement vraie et **non fondée comme invariant de conception**. À arbitrer côté spec, ce n'est
  pas un défaut de rendu et je ne le coche pas comme tel.
- **C1(a) non concerné** : `SPEAKING_SET_MAX = 9` (`ipc-contract.ts:209`) — inchangé, cohérent avec ta
  consigne « ne teste pas le lot C1a contre T23 ». Aucune mesure C1a dans cette passe.

## 2. Deltas rév. 6 encodés — `VERIF/check-aco-016.sh` (nouveau, `sh -n` OK)

| règle | contenu | rejet type |
|---|---|---|
| **R10** | ACo-16 : `compte=rendus` obligatoire, `methode` doit contenir `MutationObserver`, `rendus_overlay` numérique et **0** exigé pour un PASS, `duree_s>=3`, `garde_vie_hz=1`, `messages>=3` | `compte=messages` (compte les IPC) · `rendus_overlay=3` (1 rendu/message ⇒ rouge) · `methode=capture-ipc` |
| **R11** | statuts : `ACo-8`, `ACo-9`, `ACo-16` = « non exécutable jusqu'au câblage du relais » (C4 tranché, AD-25 D4) ; **`gele` y est un rejet**. `ACo-14`/`ACo-15` = `gele` ; y écrire « non exécutable » est un rejet | `ACo-9 statut=gele` · `ACo-15 statut=non-executable-relais` |
| **R12** | F1 : `falsification=balayage`, `pire_cas_ms` = **2 × periode_ms** (2000 ⇒ 4000), `pire_cas_ms > 2000`, `verdict=ROUGE`, **`accepte_balayage=0`** | `pire_cas_ms=2000` (falsification non chiffrée) · `verdict=VERT` · `accepte_balayage=1` (§4.3 pt 3 : le balayage est **supprimé**, pas reparamétré) |
| **R13** | `rendus_test` obligatoire sur toute ligne ACo-16 : un rendu dû au test se compte **à part** et se déclare | `rendus_test` absent |
| **R14** | vert par vacuité refusé : `statut=PASS` sur ACo-8/9/16 sans `cable=1` | `ACo-16 statut=PASS cable=0` |

**Autotest** (le validateur doit savoir rougir) :

```
sh VERIF/check-aco-016.sh --selftest
  [OK] journal légal accepté
  [OK] i1..i9 rejetés          (rendus=3, compte=messages, statut gelé sur ACo-9, rendus_test absent,
                               F1 sans verdict, accepte_balayage=1, pire_cas=2000, ACo-15 « non exécutable »,
                               methode=capture-ipc + duree_s=1)
CHECK_ACO016 RESULT=PASS selftest=10/10
```

**État de l'arbre (mode sans journal)** :

```
sh VERIF/check-aco-016.sh | tail -1
CHECK_ACO016 RESULT=NOTRUN surfaces=3 (ACo-8, ACo-9 F1/F2, ACo-16) raison=arbre-non-gele (cablage present : speaking-surface.ts, stale=2000) ; gele=2 (ACo-14, ACo-15) ; FAIL=0
```

**Câblage dans le harnais** — `VERIF/verif-024-harness.sh` :

- étape **7bis** ajoutée (après 7, avant 8 « sha256 APR ») : exécute `check-aco-016.sh` puis son `--selftest`,
  journaux `raw/…/7b-aco16-etat.log` et `7b-aco16-selftest.log` ;
- bilan : `aco16_rc=$A16_RC aco16_selftest=$A16_ST` ;
- verdict : `FAIL` si `A16_RC != 0` **ou** `A16_ST != 0` — un autotest cassé fait échouer la passe ;
- `--dry` liste désormais la ligne 7bis (`sh -n` OK, `--dry` vérifié après patch).

## 3. ACo-16 — instrumentation écrite, non exécutée

`VERIF/a16-renders.js` (`node --check` OK) : `window.__aco16.count(3000)` monte un **MutationObserver**
sur le conteneur de vignettes, retient les mutations `attributes` dont le nom commence par `data-` et les
`childList`, horodate chaque mutation, attribue à `rendus_test` celles survenues avec `window.__acoTestRender`
posé, et rend `rendus_overlay`, `rendus_test`, `par_seconde`, `mutations[]`.

Deux réserves écrites dans le fichier :
1. le sélecteur essayé est `[data-overlay-vignettes], .overlay-grid, #overlay` — **à confirmer sur l'arbre gelé** ;
   s'il ne trouve rien, le script rend `{erreur: 'conteneur introuvable'}` et l'AC est **non mesurable**, pas vert ;
2. il doit tourner dans un renderer avec l'overlay **monté** : non lancé ici, l'arbre n'est pas gelé.

## 4. F1 — protocole de falsification chiffrée (écrit, non lancé)

1. arbre gelé + empreintes AVANT ; surface relayée seule, overlay **sans rechargement** (`reload=0`).
2. témoin : échéancier nominal ⇒ extinction ≤ `SPEAKING_RELAY_STALE_MS` + 1 trame, `budget_ms = 2000 + trame`.
3. falsification : remplacer l'échéancier par un **balayage de période 2000 ms** ⇒ extinction au pire à
   **F + P = 4000 ms** ⇒ F1 **ROUGE**. Journal : `falsification=balayage periode_ms=2000 pire_cas_ms=4000 verdict=ROUGE accepte_balayage=0`.
4. le cas « rechargement + producteur mort » reste rapporté **à part** (le rejeu au `did-finish-load` remet
   l'horloge à zéro : faux vert) — R3 de `check-aco-015.sh` refuse déjà un F1 sans `reload=0`.

## 5. Désaccord nommé (à ne pas laisser filer)

SPEC-015 rév. 6 écrit « C6 non tranché (2500 vs 2000) ». **C'est périmé** : AD-26 tranche 2000, et
`check-aco-015.sh` (R6) encode déjà 2000 comme canon, avec rejet de l'étiquette « hors canon / arbitrage C6 ».
Mesure : `grep -rn "2500" src tests` ne rend **que deux commentaires** (`speaking-surface.ts:37`,
`tests/speaking-relay.test.ts:256`) qui citent 2500 comme option **rejetée** d'AD-23 D4.2 — aucun consommateur
à 2500 n'existe dans l'arbre. Le rapport F2 s'écrira donc « conforme 2000 » ou « non conforme — défaut de
valeur (AD-26) », jamais « hors canon ».

## 6. Non vérifié — nommé comme tel

- **Aucune** grandeur de rendu : ni F1, ni extinction, ni rendus/s, ni ACo-14 relayée, ni ACo-16.
- R10–R14 valident la **forme et la cohérence** d'un journal ; ils ne prouvent pas sa **véracité**.
- La sonde de câblage est textuelle (`import`, constantes) : elle ne prouve pas que l'overlay rend ce qu'il reçoit.
- `a16-renders.js` n'a jamais tourné ; son sélecteur de conteneur est une hypothèse.
- ACo-9 F2 clause « ≥ 2 × KEEPALIVE » : vraie par égalité, non fondée par le code (commentaire contraire).
- ACo-14 : la valeur observée sur surface relayée n'est pas mesurée ; aucune tolérance ± 1 image ne sera recopiée.
- ACo-13 reste le seul état livrable ; ACo-8/9/16 restent « non exécutable » jusqu'à l'arbre gelé, ACo-14/15 gelés (C5).

---

### Commandes exactes citées
```
sh VERIF/check-aco-016.sh ; sh VERIF/check-aco-016.sh --selftest ; sh VERIF/check-aco-016.sh --validate <journal>
sh VERIF/verif-024-harness.sh --dry
node --check VERIF/a16-renders.js
grep -rn "SPEAKING_RELAY_STALE_MS\|SPEAKING_KEEPALIVE_MS\|SPEAKING_SET_MAX" src
grep -rn "2500" src tests
```
