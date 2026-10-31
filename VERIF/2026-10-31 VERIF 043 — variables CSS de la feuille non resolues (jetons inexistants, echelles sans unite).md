# VERIF 043 — les variables CSS de la feuille ne résolvaient pas (jetons inexistants, échelles sans unité)

Date de la campagne : **2026-10-31**, mesures entre **20:42Z et 20:48Z** (UTC).
Dépôt : clone de `tournierjc/concord` à `c24e913`, branche `fix/design-tokens` coupée de
`origin/main`. Hôte Linux `aarch64`, `node v26.5.1`, `tsx 4.23.15`.

## Défauts mesurés

`src/renderer/styles.css` pose la règle : « aucune couleur, taille, durée ni police en dur. Tout passe
par les variables générées depuis `design/tokens.json` (`src/renderer/theme.ts`) ». Deux façons de la
casser, toutes deux silencieuses — `var(--inconnu)` n'est pas une erreur CSS, la propriété retombe
simplement sur sa valeur héritée ou initiale.

**1. Neuf noms de variables employés n'existent pas** (comparaison de `styles.css` avec les noms
produits par `tokensStyleSheet()` et `overlayCssVariables`) :

| Employé dans la feuille | Jeton réel (`design/tokens.json`) | Effet du décalage |
|---|---|---|
| `--color-state-danger` (×2) | `state.mute` — « micro coupé, **erreur** » | message d'erreur non rouge |
| `--color-state-danger-subtle` | `state.muteSubtle` — « **fond de bandeau d'erreur** » | bandeau d'erreur sans fond |
| `--color-state-warning` (×2) | `state.warn` | bandeau d'avertissement sans couleur |
| `--color-state-success` | `state.ok` | état « live » non vert |
| `--layout-list-row` (×2) | `--layout-row` (clé d'alias de `theme.ts`) | `min-height` de ligne jamais appliqué |
| `--layout-row-avatar-size` (×4) | `--layout-row-avatar` | avatars de liste sans taille (mesuré : `4,09 px`) |
| `--motion-fast` (×2) | aucun jeton `fast` (`instant`/`halo`/`hover`/`fade`/`panel`/`screen`) | `transition` invalide, aucune transition |

**2. Les échelles `layout` et `component` étaient injectées SANS unité.** `theme.ts` appelait
`scalarDeclarations('layout', {…})` et `scalarDeclarations('component', {…})` sans le troisième
argument (`'px'`), là où `space`, `radius` et `text` le passent. La déclaration produite était
`--component-hairline: 1;` : `border: var(--component-hairline) solid …` devient alors **invalide au
calcul**, et toute la propriété retombe sur sa valeur initiale.

Mesuré dans Chromium (harnais hors dépôt, `?view=room`), avant correctif :

```
--component-hairline = 1      → border: 0px none      (aucune bordure)
--component-button-padding-x = 12 → padding-inline: 0px
--space-3 = 12px (OK)         → bouton haut de 21,5 px (contenu seul, pas 32 px)
--layout-row-avatar-size absent  → avatar 4,09 px
```

C'est-à-dire : bordures, marges internes et hauteurs de toute l'interface ne s'appliquaient pas.

## 1. Ce qui change

| Fichier | Changement |
|---|---|
| `src/renderer/styles.css` | les 6 couleurs passent aux jetons réels (`state.mute`, `state.mute-subtle`, `state.warn`, `state.warn-subtle`, `state.ok`) ; `--layout-list-row` → `--layout-list-row-height`, `--layout-title-bar` → `--layout-title-bar-height` ; `--motion-fast` → `--motion-hover` (120 ms, le jeton sémantique de survol, employé par deux transitions de survol) ; le bandeau d'avertissement prend le fond `state.warnSubtle` prévu par la spec (il utilisait `bg.raised`, donc ne se distinguait pas d'une carte) |
| `src/renderer/theme.ts` | les clés de l'échelle `layout` portent le nom exact du jeton (`listRowHeight`, `rowAvatarSize`, `titleBarHeight`…) ; jetons px ajoutés (`identityRowHeight`, `emptyBlockMinHeight`, `bandHeight`, `bandBorderWidth`) ; `listSkeletonRows` reste dehors (c'est un COMPTE, pas une longueur) ; **unité `'px'`** passée pour `layout` et `component` |
| `tests/design-tokens.node.test.ts` | **nouveau**, 10 tests |

## 2. Mesures (commandes exactes, horodatées)

| Commande | Sortie mesurée | Verdict |
|---|---|---|
| `npx tsx --test tests/design-tokens.node.test.ts` | 10 tests, 10 pass, exit=0 | ✅ |
| `npm test` | **27 fichiers · 674 tests · 674 pass · 0 fail · 49 suites · 5 220 ms** (`20:48:14→20:48:19Z`) | ✅ |
| `npx tsc -p tsconfig.json --noEmit` | exit=0 | ✅ |
| `npm run build` | exit=0 | ✅ |
| **Rendu réel** (Chromium headless) | `--component-hairline=[1px] border=1px solid padInline=12px height=32px` — après correctif | ✅ |

Ce que les tests figent :
1. **toute** variable employée par `styles.css` est définie — l'ensemble des variables définies est
   **lu du générateur réel** (`tokensStyleSheet()`) et de `overlayCssVariables`, jamais recopié : une
   liste recopiée divergerait, c'est exactement le défaut réparé ;
2. contrôle négatif : la garde signale bien `--color-state-nope` et `--space-99` (elle peut échouer) ;
3. les quatre noms fantômes ne reviennent pas ;
4. les rôles nommés par SPEC-002 : erreur = `state.mute` (+ fond `muteSubtle`), avertissement =
   `state.warn` (+ fond `warnSubtle`), voix `live` = `state.ok`, `unavailable` = `state.warn` ;
5. les échelles de longueur (`space`, `radius`, `text`, `layout`, `component`) portent toutes `px` —
   contrôle négatif inclus (`component-hairline: 1` est signalé) ;
6. les jetons d'échelle réellement employés (`component-hairline`, `component-button-padding-x`,
   `component-button-height`) existent **avec** leur unité.

## 3. Le harnais du dépôt a trouvé une suite

`sh VERIF/run-all.sh` a d'abord rendu **`RESULT=FAIL`** sur cette branche : `check-tests` exécute
chaque fichier avec `node --test --experimental-strip-types`, et `theme.ts` importait les jetons sans
attribut d'import —

```
TypeError [ERR_IMPORT_ATTRIBUTE_MISSING]: Module "…/design/tokens.json" needs an import attribute of "type: json"
```

Autrement dit : le module du thème n'était **pas chargeable hors bundler**, donc intestable par le
harnais. `theme.ts` importe désormais les jetons avec `with { type: 'json' }` (attribut d'import
standard). Vérifié après correctif : `node --test --experimental-strip-types
tests/design-tokens.node.test.ts` → 10/10, `npm run build` → exit=0 (l'attribut est compris par
esbuild/Vite), `sh VERIF/run-all.sh` → **`LAN-VOICE VERIF RESULT=PASS`** (`20:49:41Z`).

C'est exactement ce que la garde devait attraper : un test qui passe sous `tsx` mais pas sous le
runner de recette du dépôt est un test non mesuré.

## 4. Non vérifié, nommé

- **Aucune comparaison visuelle avant/après n'a été produite** : les mesures sont des valeurs
  calculées (`getComputedStyle`) lues dans le DOM rendu, pas une capture commentée. Elles suffisent à
  dire que la bordure existe (`1px solid` vs `0px none`) et que la hauteur est celle du jeton
  (`32px` vs `21,5px`).
- `--motion-fast` → `--motion-hover` est un **choix** : `design/tokens.json` n'a pas de durée `fast`,
  et les deux transitions concernées sont des survols. Si un jeton `fast` doit exister, c'est une
  décision de design (ajouter le jeton, pas renommer la feuille).
- Le fond `state.warnSubtle` du bandeau d'avertissement suit SPEC-002 (« fond de bandeau
  d'avertissement ») ; aucune capture de ce bandeau en situation réelle n'a été prise.
- `--layout-window-*` restent injectés et ne sont pas employés par la feuille (ils servent à la
  fenêtre) : la garde vérifie le sens feuille → jetons, pas l'inverse (une variable non employée n'est
  pas un défaut, cf. `VERIF/check-labels.sh` L4).
