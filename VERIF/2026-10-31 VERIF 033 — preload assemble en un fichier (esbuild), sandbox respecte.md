# VERIF 033 — le preload ne se chargeait pas : `tsc` l'émettait en plusieurs fichiers sous `sandbox: true`

Date de la campagne : **2026-10-31**, mesures entre **20:03Z et 20:08Z** (UTC).
Dépôt : clone de `tournierjc/concord` à `c24e913` (branche de travail `fix/preload-bundle`, coupée de
`origin/main`), hôte de recette Linux `aarch64`, `node v26.5.1`, `npm 11.17.0`, `tsx 4.23.15`,
`esbuild 0.28.2`, Electron `30.5.1`.

**Défaut mesuré.** `npm run build:main` produisait `dist/preload/index.js` par `tsc` en CommonJS
**multi-fichiers** : la sortie contenait `require("../shell/ipc-contract")`. Or la fenêtre principale
(`src/main/index.ts`, `secureWebPreferences`) et l'overlay (`src/main/overlay-controller.ts`) imposent
`sandbox: true`. La documentation d'Electron 30.5.1 (`docs/tutorial/sandbox.md`, lue dans le dépôt
amont à la ref `v30.5.1`) est sans ambiguïté :

> In order to allow renderer processes to communicate with the main process, preload scripts attached
> to sandboxed renderers will still have a polyfilled subset of Node.js APIs available. A `require`
> function similar to Node's `require` module is exposed, but can only import a subset of Electron and
> Node's built-in modules: `electron`, `events`, `timers`, `url`. […] Because the `require` function is
> a polyfill with limited functionality, you will not be able to use CommonJS modules to separate your
> preload script into multiple files. If you need to split your preload code, use a bundler.

Conséquence : « Unable to load preload script », `window.lanAPI` absent, `src/renderer/api.ts` lève au
premier rendu, fenêtre vide (les devTools sont désactivés en paquet : `devTools: !app.isPackaged`).

## 1. Ce qui change

| Fichier | Changement |
|---|---|
| `scripts/build-preload.mjs` | **nouveau** — assemble `src/preload/index.ts` en UN fichier par `esbuild` (`format: cjs`, `platform: node`, `target: node20`, `external: ['electron']`) ; option `--outfile` |
| `package.json` | `build:preload` ajouté ; `build` = `build:main && build:preload && build:renderer` ; `esbuild` en `devDependencies` (`^0.28.2`, version déjà présente dans l'arbre via `tsx` — le lockfile ne gagne qu'une ligne) |
| `tsconfig.main.json` | `src/preload/**/*.ts` **retiré** de `include` : `tsc` ne doit plus émettre de preload ; la note racine dit pourquoi. Le preload reste typé par `npm run typecheck` (`tsconfig.json` couvre `src/**/*.ts`) |
| `tests/preload-bundle.node.test.ts` | **nouveau**, 5 tests — exécute le script réel vers un répertoire temporaire et mesure l'artefact |
| `docs/TESTS.md` | TL;DR re-mesuré, ligne `build:preload`, historique, bloc « Reproduire » |

## 2. Mesures (commandes exactes, horodatées)

| Commande | Sortie mesurée | Verdict |
|---|---|---|
| `grep -o 'require("[^"]*")' dist/preload/index.js \| sort -u` | `require("electron")` — **1 seul**, aucun relatif | ✅ |
| `wc -c dist/preload/index.js` | **25 853 o** (contre 5 163 o de source ; le contrat et ses gardes sont inlinés) | ✅ |
| `npx tsx --test tests/preload-bundle.node.test.ts` | 5 tests, 5 pass, exit=0 | ✅ |
| `npm test` | **27 fichiers · 669 tests · 669 pass · 0 fail · 50 suites · 5 225 ms** (`20:07:25Z`), rejoué `20:07:42→20:07:48Z` mêmes comptes | ✅ |
| `npm run typecheck` | exit=0 (`20:07:41Z`) | ✅ |
| `npm run build:main` | exit=0 (`20:07:42Z`), n'émet plus `dist/preload/` | ✅ |
| `npm run build:preload` | exit=0, 0,09 s (`20:07:42Z`) | ✅ |
| `npm run build` (arbre propre, `rm -rf dist`) | exit=0 — `dist/main`, `dist/preload`, `dist/renderer` | ✅ |
| `npx electron-builder --linux AppImage` | exit=0, `release/concord-1.0.0-arm64.AppImage` **96 499 655 o** (`20:08:13→20:08:16Z`) ; `asar extract-file … dist/preload/index.js` → un seul `require("electron")` | ✅ l'artefact LIVRÉ contient le bundle |
| `npm run test:vitest` | exit=1, 27 fichiers « no tests » (`20:07:51→20:07:54Z`) — rouge par construction, inchangé | ⚠️ connu |

Ce que le nouveau test mesure, précisément : le script passe par `node`, écrit le fichier, et
l'assertion lit **chaque valeur de canal `lan:…` du contrat** dans `src/shell/ipc-contract.ts` pour
vérifier qu'elle est présente dans la sortie — donc que `guardPayload` voyage bien avec le preload.
Il vérifie aussi `exposeInMainWorld`, `Object.freeze` et une borne de taille (< 200 Ko).

## 3. Non vérifié, nommé

- **Le chargement réel du preload dans un renderer Electron** : impossible sur cet hôte, `libgtk-3.so.0`
  absent (`electron --version` → `error while loading shared libraries`). Le défaut est donc établi par
  la documentation amont **et** l'artefact compilé, pas par un lancement. C'est le premier geste à faire
  sur une machine de bureau (cf. `VERIF/smoke-desktop.md`, items P1 et S1).
- La CSP effective sur les réponses `app://` (`webRequest.onHeadersReceived` intercepte-t-il un
  protocole maison ?) — question ouverte, non mesurée ici.
- Windows, macOS : non construits, non lancés.
- Aucune mesure réseau (mDNS, WebRTC) : le changement ne touche ni la découverte, ni le média.
