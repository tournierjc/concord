# AD-22 — Le verdict voyage dans le message, et on ne vérifie pas un arbre qui bouge

Régie · 2026-10-31T03:1xZ · arbitrage · conséquence de la vérification VERIF-023 (AD-18) rendue
« failed » côté desk-qa (« Turn failed: Failed to process successful response ») : aucun verdict,
aucun fichier lisible de mon côté.

**Portée.** S'applique à toute vérification (desk-qa) et à tout travail dont un autre poste dépend.
Ne remplace aucun critère d'acceptation : elle dit *comment* un critère est déclaré tenu ou non.

## 1. Pourquoi cette note existe

VERIF-023 a consommé un tour, produit un dossier que je ne peux pas lire, et laissé AD-18 ouvert.
Ce n'est ni un PASS ni un FAIL : c'est un **non-rendu**. Sans règle écrite, la tentation suivante est
de rejouer la même vérification à l'identique et d'obtenir le même silence.

## 2. Décisions

### D1 — Le verdict voyage dans le message, jamais seulement dans un fichier

Un tour de vérification se juge sur son **message** de retour, ≤ 20 lignes, format fixe :

```
VERIF-0NN · <objet> · <AMBRE d'empreinte> · <horodate UTC début> → <UTC fin>
PASS|FAIL par AC : AC-id = attendu / mesuré (fichier:ligne de la mesure)
Échecs : AC-id — cause, plus petit correctif possible
Non mesuré : AC-id — pourquoi (outil absent, arbre mobile, …)
Fichier de rapport : <chemin>
```

Un tour terminé « failed » (erreur d'exécution, timeout, réponse illisible) vaut **NON RENDU**.
Il ne vaut **ni PASS ni FAIL** : rien n'est acquis, rien n'est perdu, le critère reste ouvert et la
vérification se rejoue. Conséquence immédiate : **AD-18 reste ouvert**, VERIF-023 est non avenue.

### D2 — Interdit de vérifier un arbre qui bouge

`/work/lan-voice` n'est **pas** un dépôt git (mesuré : `git -C /work/lan-voice log` → exit 128,
*not a git repository*). Il n'y a donc aucun commit pour dater un état : l'empreinte est un
**sha256 annoncé**.

Protocole obligatoire, dans cet ordre :

1. **Avant** de mesurer : annoncer dans le message la liste des fichiers couverts et leur sha256.
2. Mesurer.
3. **Après** mesure : recalculer la même liste.
4. Écart entre (1) et (3) ⇒ **FAIL de procédure**, pas un FAIL de code. On rejoue sur arbre stable,
   et le rapport dit « mesure datée mais non concluante » — jamais « tenu ».

Empreintes du moment (2026-10-31T03:15Z, sha256 tronqués à 16 caractères) :

| Fichier | sha256 |
|---|---|
| `package.json` | `47a3dfd24ed73435` |
| `tests/speaking-relay.test.ts` | `f1e4479a12381f00` |
| `src/renderer/speaking-relay.ts` | `aef6b1af0c65e4bb` |
| `src/renderer/participant-state.ts` | `57ebff4229a067c2` |
| `src/renderer/Overlay.tsx` | `bd275e1aaa87da7b` |

Ces valeurs sont un **repère daté**, pas une foi : le même calcul au début et à la fin du tour fait foi,
c'est l'égalité qui compte, pas la valeur.

### D3 — La garde a raison ; c'est la liste qui est fausse

Mesuré à 03:1xZ, `npx tsx --test tests/scripts-coverage.node.test.ts` :
`expected: 25 / actual: 24`, `# pass 2`, `# fail 2`, dont
`not ok 1 - scripts-coverage — la liste de test:node couvre exactement tests/*.test.ts`.

Faits : `tests/*.test.ts` = **25** fichiers sur disque ; la liste `test:node` de `package.json` en
déclare **24** ; le marqueur `compte courant : 24 fichiers` est resté à 24 ; `tests/speaking-relay.test.ts`
est absent de la liste. Rien d'autre n'est en cause — au même instant les 27 tests de AD-20 sont verts.

Règle : **on corrige la liste et le marqueur, jamais la garde.** Assouplir l'assertion (glob, tolérance
de ±1, marqueur optionnel) est un refus de principe : une garde qui pardonne ne garde rien. Le seul
correctif admis est d'ajouter le fichier manquant à `test:node` et de mettre le marqueur à 25 — puis
de relancer la suite complète et d'exiger 25/25 sur cette garde.

## 3. Qui fait quoi

- **desk-shell (Cadre)** : T22 reste **plan-zéro-écriture** (aucun fichier du produit modifié pendant
  le plan) ; avant le feu T23, annoncer l'empreinte de l'arbre et geler.
- **desk-qa (Banc)** : VERIF-024 se **prépare** (liste des AC, commandes, fichiers d'empreinte), mais
  ne se **joue** qu'après le feu T23 et sur un arbre dont l'empreinte début = fin.
- **desk-engine (Carillon)** : les deux corrections ciblées (liste `test:node` + marqueur 25, et son
  propre correctif) et l'annonce de l'empreinte de son rendu.
- **Régie** : ne clôt AD-18 que sur un message PASS/FAIL conforme à D1, jamais sur un dossier déposé.
