# Tests — ce qui tourne réellement dans ce dépôt

> Tenu par le Banc (desk-qa). Dernière re-mesure : **T20, 2026-10-31T15:25:09Z → 15:28:44Z**
> (UTC), sur `/work/lan-voice` @ `15aed91` (« clone nu réparé »), `node v22.23.4`,
> `tsx v4.23.15`, `npm 10.9.9`, arm64. Toutes les commandes sont lancées sous
> `env -u NODE_ENV` (cet hôte exporte `NODE_ENV=production` — voir l'addendum Régie en fin de page).
> Règle de la maison : **aucun compte publié sans exit code ni horodatage de début de run**.
> Une ligne sans exit code est une ligne non mesurée. Un chiffre daté d'hier est un chiffre
> périmé, pas un chiffre vrai : il est conservé en fin de page (§« Historique ») avec sa date.
>
> Empreintes des fichiers témoins de cette page (sha256, `2026-10-31T15:27:56Z`) :
> `package.json` `be6c0e89…`, `tests/scripts-coverage.node.test.ts` `53326963…`,
> `src/engine/README.md` `338df4a1…`, version précédente de la présente page `5085ad20…`.

## TL;DR — état courant (T-PRELOAD, 2026-10-31T20:07Z)

| Script | Commande réelle | Sortie mesurée (début UTC) | Verdict |
|---|---|---|---|
| `npm test` (= `npm run test:node`) | `tsx --test` sur **27 fichiers** listés à la main (plus de `npx`) | **exit=0 · 669 tests · 669 pass · 0 fail · 0 skip · 50 suites · 5 225 ms** (`20:07:25Z`) | ✅ le seul runner de recette |
| `npm run typecheck` | `tsc -p tsconfig.json --noEmit` | **exit=0 · 0 ligne de sortie** (`15:28:02Z`) | ✅ |
| `npm run build:main` | `tsc -p tsconfig.main.json` (main **seul** : le preload n'est plus émis ici) | **exit=0** (`20:07:42Z`) | ✅ |
| `npm run build:preload` | `node scripts/build-preload.mjs` (esbuild, `electron` seul externe) | **exit=0 · `dist/preload/index.js` 25 853 o · 1 seul `require` (`electron`) · 0,09 s** (`20:07:42Z`) | ✅ indispensable : un preload `tsc` multi-fichiers ne se charge pas sous `sandbox: true` |
| `npx vite build` | vite → `dist/` | **exit=0 · built in 459 ms** (`15:28:04Z`) | ✅ |
| `npm run test:vitest` | `vitest run` | **exit=1 · 27 fichiers en échec · « Tests no tests » · 3 s** (`20:07:51→20:07:54Z`, arbre de travail) — compte dépendant de l'arbre, écart expliqué ci-dessous | ❌ inutilisable ici (rouge par construction) |
| `npx electron-builder --linux AppImage` | electron-builder 24.13.3 | **exit=0 · 96 634 946 o** (`15:28:41Z → 15:28:44Z`), aucun `latest-linux.yml` | ✅ (depuis le retrait de `appImage.license`) |
| `npx electron-builder --linux deb` | idem, cible `deb` | **exit=1 · `Exec format error`** (`15:28:23Z`) — `fpm` embarqué est un binaire **x86** | ❌ limitation d'hôte (arm64), cible **non vérifiée** |
| `npm run dev` / `npm start` | vite dev / electron | **non exécutés** | ⚠️ non vérifié — §« Points non vérifiés » |

Déterminisme : `npm test` lancé **deux fois** dans la même session sur l'arbre courant, mêmes
comptes — run 1 (`20:07:25Z`) 669 / 669 / 0 fail / 50 suites / 5 225 ms ; run 2
(`20:07:42→20:07:48Z`) 669 / 669 / 0 fail. La durée varie, jamais les comptes.

Note T-PRELOAD : `tests/preload-bundle.node.test.ts` (5 tests) **exécute** `scripts/build-preload.mjs`
vers un répertoire temporaire et mesure l'artefact produit — `electron` seul module requis, contrat
IPC inliné (chaque canal `lan:…` du contrat est présent dans la sortie), pont exposé et gelé. Ce
qu'il ne prouve pas : qu'un vrai renderer Electron charge ce preload (aucun binaire Electron
exécutable sur cet hôte, cf. §« Points non vérifiés »).

**Le compte de `test:vitest` dépend de l'arbre de travail, pas du code** (mesuré T20) : `vitest run`
n'a aucune configuration `test.exclude` dans `vite.config.ts`, il ramasse donc tout
`*.{test,spec}.*` sous la racine, y compris les copies de captures **non versionnées** :
26 (`tests/`) + 1 350 (`VERIF/raw/**/copies/…`) + 334 (`.verif-t17/`, `.verif-t18/`, `.verif-t19/`)
= **1 710** dans l'arbre de travail, contre **26** dans un clone nu (`git clone`, `15:27:47Z`).
Les deux runs sont `exit=1` et rendent « Tests no tests » (0 assertion exécutée). Conséquence
pratique : citer « N fichiers en échec » pour vitest sans dire dans quel arbre est un chiffre
non reproductible. Correctif proposé (non appliqué, `vite.config.ts` n'est pas à moi) :
`test: { exclude: [...configDefaults.exclude, 'VERIF/**', '.verif-*/**'] }`.

Reproduire à l'identique (état de référence `15aed91`) :

```
cd /work/lan-voice
ls tests/*.test.ts | wc -l                     # 27
env -u NODE_ENV npm test                       # attendu : exit=0, # tests 669, # fail 0
env -u NODE_ENV npx tsc -p tsconfig.json --noEmit  # attendu : exit=0, 0 ligne
env -u NODE_ENV npm run build:main             # attendu : exit=0 (main seul)
env -u NODE_ENV npm run build:preload          # attendu : exit=0, dist/preload/index.js autonome
env -u NODE_ENV npx vite build                 # attendu : exit=0
env -u NODE_ENV npm run test:vitest            # attendu : exit=1 (26 fichiers en arbre propre,
                                               #   1710 si VERIF/raw et .verif-t*/ sont présents)
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
npm test            # → npm run test:node (26 fichiers, liste explicite dans package.json)
npm run test:node   # le runner de référence : tsx --test <26 fichiers>
npm run test:vitest # mesuré exit=1 (26 en arbre propre, 1710 en arbre de travail), ne pas utiliser
```

## Points non vérifiés (nommés comme tels)

- `npm run dev` et `npm start` : **pas lancés** par le Banc dans cette session (Electron exige
  un affichage). Aucune affirmation n'est faite ici sur leur comportement.
- `npm run dist` : mesuré **par cible**, pas globalement. `npx electron-builder --linux AppImage`
  → **exit=0**, 96 634 946 o (`15:28:41Z → 15:28:44Z`), sans `latest-linux.yml` ;
  `npx electron-builder --linux deb` → **exit=1 `Exec format error`** (`15:28:23Z`, `fpm`
  embarqué x86) ⇒ cible `deb` **non vérifiée**. Windows/`nsis` et cible `x64` : **non mesurés**
  (hôte arm64, pas de Wine).
- `src/engine/README.md` (sha `338df4a1…`) cite **7** fichiers de test sur les **26** du disque
  et **en omet donc 19** : `audio-sink`, `contract-parity.node`, `engine-purity`, `ipc-contract`,
  `local-signaling`, `main-timers.node`, `media-plane.node`, `media-plane`, `mesh`,
  `overlay-controller`, `overlay-geometry`, `participant-state`, `peer-speech`,
  `room-discovery-sec.node`, `room-discovery.node`, `settings-schema`, `signaling-link.node`,
  `speaking-relay`, `voice-mesh.node`. Sa liste est un
  **sous-ensemble illustratif**, pas une énumération : à ne pas lire comme la liste des tests.
  Non corrigé ici (fichier tenu par un autre poste) — signalé à desk-engine. La liste de
  référence, gardée mécaniquement, est `package.json#test:node` ; la mesure datée est la
  présente page.
- La couverture (lignes / branches) n'est mesurée par aucun script de ce dépôt : aucun chiffre
  de couverture n'est publié ici, faute d'instrument.
- Machine vierge : **mesuré depuis T20**, partiellement. Le `package-lock.json` est **versionné**
  depuis `15aed91` (lockfileVersion 3, 524 entrées, 245 590 o, `esbuild`/`rollup` x64 **et**
  arm64 présents) et présent dans un clone nu ; `npm ci --include=dev` puis `npm test` y rendent
  **664 / 664 / 0 fail / 49 suites** (mesure Régie, `15:24Z`, harnais du Banc). Restent **non
  vérifiés par le Banc** : le clone depuis GitHub (dépôt privé, test fait en clone local), le
  cache npm **froid** (le run a bénéficié du cache de l'hôte) et le cache `npx` vide.

## Historique des mesures (périmé, conservé pour la trace)

| Date (UTC) | Fichiers | Tests | `typecheck` | `build:main` | Source |
|---|---|---|---|---|---|
| `2026-10-30T23:29–23:31Z` | 12 | 371 (371 pass) | exit=2 · 52 erreurs | exit=2 · 20 erreurs | VERIF-004 |
| `2026-10-31T01:05Z` | 13 | 378 (378 pass) | exit=0 | — | VERIF-006 (T11) |
| `2026-10-31T01:55Z` | 14 | 523 (523 pass) | exit=0 | exit=0 | VERIF-016 (T16b) |
| `2026-10-31T02:0xZ` | 20 | 530 (530 pass) | exit=0 | exit=0 | T19 |
| **`2026-10-31T20:07Z`** | **27** | **669 (669 pass)** | **exit=0** | **exit=0** | **T-PRELOAD (branche `fix/preload-bundle`)** |
| `2026-10-31T15:2xZ` | 26 | 664 (664 pass) | exit=0 | exit=0 | T20 (VERIF 031) |

Les lignes plus anciennes de ce tableau sont **fausses aujourd'hui** : elles décrivent un état
daté, utile seulement pour savoir depuis quand un chiffre a cessé d'être vrai.

T20 précise deux choses que T19 ne pouvait pas dire : (a) les chiffres sont ceux de l'état
`15aed91`, rejoués **deux fois** avec les mêmes comptes ; (b) le compte de `test:vitest`
dépend de l'arbre de travail (26 en clone nu, 1 710 avec les copies de captures non
versionnées) — c'est pourquoi cette page ne cite plus « 20/20 » pour vitest.

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
