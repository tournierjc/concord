# Tests — ce qui tourne réellement dans ce dépôt

> Tenu par le Banc (desk-qa). Dernière re-mesure : **T19, 2026-10-31T02:00:57Z → 02:02:05Z**
> (UTC), sur `/work/lan-voice`, `node v22.23.4`, `tsx v4.23.15`, `npm 10.9.9`.
> Règle de la maison : **aucun compte publié sans exit code ni horodatage de début de run**.
> Une ligne sans exit code est une ligne non mesurée. Un chiffre daté d'hier est un chiffre
> périmé, pas un chiffre vrai : il est conservé en fin de page (§« Historique ») avec sa date.
>
> Empreintes des fichiers témoins de cette page (sha256, `2026-10-31T02:01:02Z`) :
> `package.json` `030a8219…`, `tests/scripts-coverage.node.test.ts` `8ab8c1e8…`,
> `src/engine/README.md` `d48932c8…`, version précédente de la présente page `d62b7768…`.

## TL;DR — état courant (T19, 2026-10-31T02:0xZ)

| Script | Commande réelle | Sortie mesurée (début UTC) | Verdict |
|---|---|---|---|
| `npm test` (= `npm run test:node`) | `npx tsx --test` sur **20 fichiers** listés à la main | **exit=0 · 530 tests · 530 pass · 0 fail · 0 skip · 28 suites · 580 ms** (`02:00:58.065Z`) | ✅ le seul runner de recette |
| `npm run typecheck` | `tsc -p tsconfig.json --noEmit` | **exit=0 · 0 ligne de sortie** (`02:00:59.314Z`) | ✅ |
| `npm run build:main` | `tsc -p tsconfig.main.json` | **exit=0** (`02:01:00.756Z`) | ✅ |
| `npx vite build` | vite → `dist/` | **exit=0 · 48 modules · built in 444 ms** (`02:01:01.559Z`) | ✅ |
| `npm run test:vitest` | `vitest run` | **exit=1 · 20 fichiers en échec · « Tests no tests » · 866 ms** (`02:01:27.112Z`) | ❌ inutilisable ici (rouge par construction) |
| `npm run dev` / `npm start` / `npm run dist` | vite dev / electron / electron-builder | **non exécutés** | ⚠️ non vérifié — §« Points non vérifiés » |

Déterminisme : `npm test` lancé **deux fois** dans la même session, mêmes comptes —
run 1 (`02:00:58.065Z`) 530 / 530 / 0 / 28 suites / 580 ms ; run 2 (`02:01:28.293Z`)
530 / 530 / 0 / 28 suites / 512 ms. La durée varie, jamais les comptes.

Reproduire à l'identique :

```
cd /work/lan-voice
ls tests/*.test.ts | wc -l          # 20
npm test                            # attendu : exit=0, # tests 530, # fail 0
npx tsc -p tsconfig.json --noEmit    # attendu : exit=0, 0 ligne
npm run build:main                   # attendu : exit=0
npx vite build                       # attendu : exit=0
npm run test:vitest                  # attendu : exit=1 (20 fichiers) — c'est normal
```

## La liste des tests est écrite à la main — et désormais gardée

`test:node` énumère ses fichiers un par un (pas de glob : un fichier non node-runnable doit
être **visible dans le diff**, pas silencieusement embarqué). Ce choix a un coût mesuré : une
liste manuelle dérive du disque sans que rien ne le signale. C'est arrivé — la liste a annoncé
14 fichiers alors que le disque en portait 19 (voir `VERIF/VERIF-018`, §2).

La garde `tests/scripts-coverage.node.test.ts` (4 tests, incluse dans `test:node`) vérifie sur
le **disque réel** :

1. tout `tests/*.test.ts` du disque est lancé par `npm test` ;
2. la liste ne cite aucun fichier absent du disque (nom fantôme) ;
3. la liste est explicite : aucun glob, aucun doublon ;
4. le **dernier** compte « N fichiers » de `package.json#scriptsNote` égale le nombre de
   fichiers du disque (`scriptsNote` est un journal daté : les re-mesures s'appendent, la
   dernière fait foi).

**Falsifiée ×4 par le Banc** (`2026-10-31T02:02:01–02:02:05Z`), sur une **copie isolée** du
dépôt (fichier de garde + `package.json` + 20 fichiers témoins dans un répertoire de sandbox ;
dépôt réel intact — `package.json` sha `030a8219…` et garde sha `8ab8c1e8…` identiques
avant/après) :

| Cas injecté | Attendu | Mesuré |
|---|---|---|
| C0 — état sain, copie fidèle | vert | exit=0 · 4/4 pass |
| C1 — `tests/ghost.test.ts` ajouté à la liste | rouge | exit=1 · `not ok 2` (nom fantôme) |
| C2 — `scripts-coverage.node.test.ts` retiré de la liste | rouge | exit=1 · `not ok 1` (fichier non lancé) |
| C3 — `tests/extra-*.test.ts` (glob) ajouté | rouge | exit=1 · `not ok 2` **et** `not ok 3` (glob) |
| C4 — « … 19 fichiers. » appendé à `scriptsNote` | rouge | exit=1 · `not ok 4` (compte annoncé) |

La garde n'est donc pas tautologique : chaque assertion a été **vue rouge** pour la faute
qu'elle prétend attraper. **Réserve C5, mesurée** : appendre à `scriptsNote` une mention
*historique* citant un ancien compte (« rappel : 12 fichiers au départ ») la fait rougir à tort
(exit=1, `not ok 4`) — la garde prend le **dernier** « N fichiers » du champ. C'est un faux
positif, pas un trou (elle échoue du côté sûr), mais la règle de maintenance est explicite :
**toute** mention ajoutée en fin de `scriptsNote` doit soit ne citer aucun compte, soit être
suivie du compte courant.

Ce que la garde **ne** couvre **pas** (à ne pas lui faire dire) :

- un fichier présent des deux côtés mais dont tous les `it` sont `skip` — il compte dans les
  fichiers, pas dans les tests ; ce sont `# tests` / `# skipped` de `npm test` qui parlent ;
- les chiffres publiés dans la **documentation** (`docs/TESTS.md`, `src/engine/README.md`) :
  aucun test ne lit ces fichiers. C'est un contrôle humain, refait à chaque re-mesure ;
- la **qualité** des assertions : la garde compte des fichiers, elle ne dit rien de ce qu'ils
  prouvent.

## Prérequis réels

- **node v22.23.4**, **npm 10.9.9**.
- **tsx v4.23.15** — fourni par le cache npx (`/home/node/.npm/_npx/…`), **non déclaré dans
  `package.json`**. `npm run test:node` marche aujourd'hui parce que ce cache existe ; sur une
  machine vierge il faut `npm i -D tsx` (réseau requis).
- **`node_modules/` existe** — 34 exécutables dans `node_modules/.bin`, dont `vitest` 1.6.1,
  `vite`, `electron` : installé par un autre poste de la flotte à `2026-10-31T00:29:03Z`. Les
  mesures antérieures à cette date (VERIF-002/003) ont été prises **sans** `node_modules` et ne
  sont pas comparables telles quelles.
- `dist/` est produit localement (`npx vite build` exit=0 ci-dessus) ; `npm run build:main`
  compile le processus principal.

## Pourquoi vitest ne peut pas être le runner

Les 20 fichiers de `tests/` sont écrits avec **`node:test` + `node:assert/strict`**. Vitest
1.6.1 ne voit aucune suite dedans — 20 fichiers, 20 échecs :

```
$ npm run test:vitest                        # 2026-10-31T02:01:27.112Z
 FAIL  tests/vad.test.ts
Error: No test suite found in file /work/lan-voice/tests/vad.test.ts
…
 FAIL  tests/scripts-coverage.node.test.ts
Error: No test suite found in file /work/lan-voice/tests/scripts-coverage.node.test.ts
 Test Files  20 failed (20)
      Tests  no tests
   Duration  866ms
# exit=1
```

`test:vitest` est conservé **parce qu'il est mesurablement rouge**, pas comme alternative. Ne
pas l'utiliser comme critère de recette. Le rouge est *attendu* : le jour où il passerait au
vert sans qu'on ait touché aux tests, c'est le runner qu'il faudrait suspecter, pas la suite.

## Pourquoi pas d'`import` de `vitest` ni de top-level await dans un `tests/*.test.ts`

`package.json` n'a pas `"type": "module"`. tsx passe donc par esbuild en sortie **CJS**, qui
refuse le top-level await :

```
$ npx tsx --test tests/ice-filter.test.ts    # 2026-10-30T23:28:0xZ, version d'alors
ERROR: Top-level await is currently not supported with the "cjs" output format
# exit=1, 0 assertion exécutée
```

Règles pour tout nouveau fichier de test :

1. `import { describe, it } from 'node:test'` + `import assert from 'node:assert/strict'`.
2. Import STATIQUE du module testé, **avec l'extension `.ts`** :
   `import { isLanCandidate } from '../src/engine/rtc/ice-filter.ts'`.
3. Aucun `await` au niveau module (le mettre dans un `it` async).
4. Ajouter le fichier **explicitement** à `test:node`, puis mettre à jour le compte de
   `scriptsNote` — la garde refuse la liste incomplète comme le compte périmé.

## Scripts

```
npm test            # → npm run test:node (20 fichiers, liste explicite dans package.json)
npm run test:node   # le runner de référence : npx tsx --test <20 fichiers>
npm run test:vitest # mesuré exit=1 (20/20), ne pas utiliser
```

## Points non vérifiés (nommés comme tels)

- `npm run dev`, `npm start`, `npm run dist` : **pas lancés** par le Banc dans cette session
  (Electron exige un affichage ; `electron-builder` exige un téléchargement réseau). Aucune
  affirmation n'est faite ici sur leur comportement.
- `src/engine/README.md` (sha `d48932c8…`) cite **7** fichiers de test sur les **20** du disque
  et **en omet donc 13** : `audio-sink`, `contract-parity.node`, `ipc-contract`,
  `local-signaling`, `media-plane.node`, `media-plane`, `mesh`, `overlay-geometry`,
  `room-discovery-sec.node`, `room-discovery.node`, `scripts-coverage.node`, `settings-schema`,
  `signaling-link.node`. Sa liste est un
  **sous-ensemble illustratif**, pas une énumération : à ne pas lire comme la liste des tests.
  Non corrigé ici (fichier tenu par un autre poste) — signalé à desk-engine. La liste de
  référence, gardée mécaniquement, est `package.json#test:node` ; la mesure datée est la
  présente page.
- La couverture (lignes / branches) n'est mesurée par aucun script de ce dépôt : aucun chiffre
  de couverture n'est publié ici, faute d'instrument.
- Le comportement de `npm test` **sur une machine vierge** (sans `node_modules`, sans cache
  npx) n'est pas mesuré : les prérequis ci-dessus sont déclarés, pas vérifiés par exécution.

## Historique des mesures (périmé, conservé pour la trace)

| Date (UTC) | Fichiers | Tests | `typecheck` | `build:main` | Source |
|---|---|---|---|---|---|
| `2026-10-30T23:29–23:31Z` | 12 | 371 (371 pass) | exit=2 · 52 erreurs | exit=2 · 20 erreurs | VERIF-004 |
| `2026-10-31T01:05Z` | 13 | 378 (378 pass) | exit=0 | — | VERIF-006 (T11) |
| `2026-10-31T01:55Z` | 14 | 523 (523 pass) | exit=0 | exit=0 | VERIF-016 (T16b) |
| **`2026-10-31T02:0xZ`** | **20** | **530 (530 pass)** | **exit=0** | **exit=0** | **T19 (cette page)** |

Les lignes plus anciennes de ce tableau sont **fausses aujourd'hui** : elles décrivent un état
daté, utile seulement pour savoir depuis quand un chiffre a cessé d'être vrai.

## Addendum 2026-10-31T15:2xZ (Régie) — installation et `npm test` sur clone nu, mesurés

Comble le point « non mesuré » ci-dessus : une machine vierge a été essayée pour de vrai
(VERIF 029, clone nu de `ba47de5`, node v22.23.4 / npm 10.9.9, arm64), puis rejouée par la Régie
après correctifs.

**Procédure qui marche, depuis un clone sans `node_modules`** :

```bash
env -u NODE_ENV npm ci     # exit 0, 433 paquets — lockfile désormais versionné
env -u NODE_ENV npm test   # 664 tests · 664 pass · 0 fail · 49 suites · ~5,3 s
```

**Deux causes d'échec trouvées et corrigées le 2026-10-31** (elles rendaient la recette impossible
sur un poste neuf) :

1. **Aucun `package-lock.json` versionné** → `npm ci` refusait de démarrer
   (`npm error code EUSAGE`). Le lockfile (lockfileVersion 3, 524 entrées) est maintenant dans le
   dépôt ; il a été résolu depuis le registre, donc il porte les binaires optionnels de toutes les
   architectures (esbuild/rollup x64 comme arm64), pas seulement ceux de cet hôte.
2. **`tsx` n'était déclaré nulle part** alors que `test:node` faisait `npx tsx` → sur cache npm
   vierge : `npm error code ENOTCACHED … registry.npmjs.org/tsx`. `tsx` est maintenant en
   devDependency (`4.23.15`) et le script l'appelle directement. Le remplacer par `node --test`
   natif ne marche pas : 621 tests, 3 échecs `ERR_MODULE_NOT_FOUND` (imports relatifs sans
   extension).

**Piège d'environnement à connaître** : si `NODE_ENV=production` traîne dans l'environnement (c'est
le cas sur cet hôte), `npm install`/`npm ci` sautent les devDependencies et `npm test` rend un rouge
trompeur « Cannot find module 'electron' » (640 tests, 639 pass / 1 fail). D'où le `env -u NODE_ENV`
ci-dessus : ce n'est pas une précaution de style, c'est la différence entre 664/664 et un faux rouge.

**Le dépôt est autosuffisant** une fois `node_modules` présent : aucun test ne lit `VERIF/raw/`, un
journal ou un fichier non versionné. `tsc --noEmit` : 0 diagnostic. `npm run build` : OK.
