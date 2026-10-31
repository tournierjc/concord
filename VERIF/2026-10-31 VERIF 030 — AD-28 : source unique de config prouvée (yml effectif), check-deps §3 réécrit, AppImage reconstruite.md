# VERIF 030 — AD-28 : `electron-builder.yml` seule source de config (preuve), §3 de `check-deps.sh` réécrit, AppImage reconstruite

Date de campagne : **2026-10-31**, mesures horodatées ci-dessous (UTC).
Machine : même hôte que VERIF 029 (linux arm64, node 22, electron-builder 24.13.3).
État de référence : commit **`87ad81a`** (« electron-builder.yml seule source de config ») sur `main` local, après `ba47de5`.
Auteur de la modification de config : desk-shell (cadre/packaging). Auteur du patch de `check-deps.sh` : banc (ce rapport).

---

## 1. La priorité `package.json["build"]` → yml est **mesurée**, pas supposée

Code visé : `node_modules/read-config-file/out/main.js` — `loadConfig()` construit la requête `{packageKey:"build", configFilename:"electron-builder"}`, donc `package.json.build` est lu **avant** toute recherche de fichier ; `electron-builder.yml` n'est ouvert que si ce champ est absent. Vérifié à l'exécution en appelant directement le résolveur d'electron-builder (`app-builder-lib/out/util/config.js`, `getConfig(projectDir)`), sur trois arborescences :

    node probe-cfg.js cfg1 cfg2 /work/lan-voice

| fixture | `package.json` | fichier de config retenu | `appId` effectif | `artifactName` effectif | `publish` effectif |
|---|---|---|---|---|---|
| `cfg1` | champ `build:{appId:"PKG-APPID"}` | **`package.json` ("build" field)** | `PKG-APPID` | *(absent)* | *(absent)* |
| `cfg2` | aucun champ `build` | **`electron-builder.yml`** | `YML-APPID` | `yml-${name}` | `null` |
| dépôt `/work/lan-voice` | aucun champ `build` | **`electron-builder.yml`** | `local.concord.app` | `concord-${version}-${os}-${arch}.${ext}` | `null` |

Conclusion mesurée : **avant** `87ad81a`, tout `electron-builder.yml` était inerte (le build venait du champ `build` de `package.json`, 6 clés : `appId`, `productName`, `publish`, `files`, `linux`, `win`) ; **après**, c'est le yml qui pilote. AD-28 n'est donc **pas** un renommage cosmétique : c'est un changement du contenu de paquet (voir §3).

Nuance mesurée (fixture `cfg3`) : un `publish` **à la racine** de `package.json` (`{"provider":"github",…}`) est **purement décoratif** — config retenue = `electron-builder.yml`, `publish` effectif = `null`. Le seul contrôle qui protège vraiment est « pas de champ `build` » + « `publish: null` **dans le yml** ».

## 2. `VERIF/check-deps.sh` — §3 réécrit (patch demandé par desk-shell)

Le 26e rouge observé par desk-shell (`[FAIL] publish n'est pas null partout (top-level=null build.publish=ABSENT)`) était un **faux positif** : le §3 testait une forme (`build.publish` présent) que AD-28 supprime volontairement. Réécriture, pas rafistolage de motif :

- le snippet node calcule un **verdict explicite** au lieu de laisser un `case` deviner une forme :
  `build=PRESENT|ABSENT` + `state=OK-UNIQUE|BAD-DOUBLE-SOURCE|BAD-PUBLISH` ;
- `case` : `state=OK-UNIQUE` → `[OK] pas de champ build ; publish=null (yml = seule source de config)` ;
  `state=BAD-DOUBLE-SOURCE` → `[FAIL] double source de config : … electron-builder.yml est alors IGNORÉ — AD-28` ;
  `state=BAD-PUBLISH` → `[FAIL] publish n'est pas null à la racine de package.json` ;
- §3bis : ajout d'un `[INFO] ce publish: null est INERTE : package.json contient encore un champ build` (le yml ne protège rien s'il est ignoré) ;
- en-tête l. 13-20 : ancienne règle (« racine et/ou build.publish ») remplacée par l'invariant AD-28 (absence de champ `build` = condition pour que le yml soit lu) + ligne 3bis.

Choix assumé, contrairement à la suggestion « garder l'ancien motif en `ok` de transition » : **un champ `build` réintroduit est un `FAIL`**, même si son `build.publish` vaut `null`. Sinon une régression réelle (retour de la double source, donc yml inerte) passerait en silence ; le rôle du script est de garder l'invariant, pas d'accompagner la transition.

Contrôles de non-régression du script (autotest, fixtures dans le bac à sable) :

| fixture | état simulé | attendu | obtenu |
|---|---|---|---|
| `A` | état `ba47de5` : champ `build` + `publish:null` partout | FAIL 1, message « double source » | **FAIL 1** |
| `B` | état `87ad81a` : aucun champ `build`, `publish:null` racine | PASS | **PASS** |
| `C` | aucun champ `build`, `publish` racine absent | FAIL 1 | **FAIL 1** |
| `D` | aucun champ `build`, yml **sans** `publish: null` | FAIL 1 | **FAIL 1** |

Sur le dépôt : `sh VERIF/check-deps.sh .` → `CHECK_DEPS RESULT=PASS failures=0 skips=0` (2026-10-31T16:23:42+01:00 / 15:23:42Z), `sh -n` OK.
Fichier : `sha256 5e9f60a42b8d0da0…`, **171 lignes** (`git diff --stat` : 24 insertions, 5 suppressions ; encore **non commité**, indexé `M`).

## 3. Le yml désormais effectif : ce que ça change dans le paquet (mesuré)

Commande : `npx electron-builder --linux AppImage` (2026-10-31T15:23Z, rc=0, log « loaded configuration file=/work/lan-voice/electron-builder.yml »).

- AppImage produite : `release/concord-1.0.0-arm64.AppImage`, **96 634 968 o**, `sha256 480e471356e799b4…`.
  Le blocage `LICENCE` de VERIF 029 **a disparu** : le champ `appImage.license: LICENCE` a été retiré (fichier absent du dépôt, la construction échouait avant de commencer).
- `release/` ne contient **aucun** `latest-linux.yml` / `latest.yml` ; `release/linux-arm64-unpacked/resources/` ne contient que `app.asar` (**aucun `app-update.yml`**) ⇒ `publish: null` effectif, aucune dépendance electron-updater.
- `asar` : 0 fichier `*.md` et 0 chemin `src/` embarqué ⇒ les filtres `files:` du yml (`!**/*.md`, `!**/{…,src,…}/**`) s'appliquent — ils étaient inertes avant AD-28.
- `locales/` = **2** fichiers (`fr.pak`, `en-US.pak`) ⇒ `electronLanguages` du yml s'applique ; taille de l'arbre décompressé 226 Mo.
- `[warning] default Electron icon is used` : pas d'icône applicative (aucune ressource `build/`), sans effet sur la vérification.

## 4. Autosuffisance du dépôt, re-mesurée à l'état courant

Recopie **depuis l'index git uniquement** (`git ls-files` → tar, `node_modules/`, `dist/`, `release/`, `VERIF/raw/` absents), puis :

    env -u NODE_ENV npm ci        # rc=0
    env -u NODE_ENV npm test      # tests 664 / suites 49 / pass 664 / fail 0
    npx tsc --noEmit -p tsconfig.json   # 0 diagnostic

⇒ Avec **`package-lock.json` versionné**, `npm ci` puis `npm test` passent depuis le seul dépôt : l'autosuffisance de VERIF 029 est **levée**, à une condition près : le lockfile est actuellement **indexé mais pas commité** (`A package-lock.json` dans `git status`). Tant qu'il n'est pas dans un commit, un clone du dépôt reste sans lockfile et `npm ci` échoue (`EUSAGE`). `tsx` est désormais déclaré (`devDependencies.tsx: 4.23.15`) et `test` passe par `tsx --test` — le piège `npx tsx` / `ENOTCACHED` de VERIF 029 est fermé.

## 5. Non vérifié — nommé comme tel

- **`deb`** (fpm) et **`nsis`/Windows** (pas de Wine) : non construits ; le yml les décrit (`deb.maintainer`, `deb.recommends: []`, `nsis.*`), aucune preuve d'exécution.
- **x64** : hôte arm64, seul `--linux AppImage` arm64 construit.
- **Lancement réel de l'AppImage** : non exécutée (FUSE/affichage absents) ; seule la construction et le contenu de l'asar sont constatés.
- **Clone GitHub** : non testé (dépôt privé) ; la recopie ci-dessus vient de l'index local.
- **Cache npm froid** : non testé (`npm ci` a pu réutiliser le cache de l'hôte).
- **`VERIF/raw/`, `*.log`, `.verif-*`** : toujours hors dépôt par choix (cf. VERIF 029 §3), non re-mesurés ici.

## 6. Commandes exactes (reproductibles)

    # 1. résolution de config (3 fixtures + dépôt)
    node probe-cfg.js cfg1 cfg2 /work/lan-voice     # bac à sable desk-qa, script de 5 lignes, cf. §1
    # 2. gate dépendances
    sh VERIF/check-deps.sh .
    # 3. paquet
    npx electron-builder --linux AppImage
    ls release ; ls release/linux-arm64-unpacked/resources ; ls release/linux-arm64-unpacked/locales | wc -l
    # 4. autosuffisance
    git ls-files -z | tar --null -T - -cf - | tar -xf - -C <clone>
    cd <clone> && env -u NODE_ENV npm ci && env -u NODE_ENV npm test && npx tsc --noEmit -p tsconfig.json

---

## Errata T20 (2026-10-31T15:30:01Z, Banc)

Deux corrections apportées en VERIF 031, sans réécrire ce rapport :

1. **Le sha256 de l'AppImage n'est pas une empreinte d'état.** Le `sha256 480e4713…` cité au §3
   vaut pour *cette* construction (`2026-10-31T15:2xZ`) seulement : reconstruite depuis le **même
   arbre** à `15:28:41Z → 15:28:44Z`, l'AppImage fait **96 634 946 o** et `sha256 1486e3c9…` (la
   première faisait 96 634 968 o). Le blocage `LICENCE` est bien levé (exit=0 reproduit), mais ce
   qui est reproductible est le nom, l'exit code et l'absence de `latest-linux.yml` — pas les octets.
2. **`deb` : hypothèse confirmée, cause exacte.** `npx electron-builder --linux deb` → exit=1
   `Exec format error` (`15:28:23Z`), avec `--url https://github.com/tournierjc/concord`,
   `--architecture arm64`, `--license MIT` bien passés : la correction `homepage`/`author` est
   active, l'échec est **architectural** (fpm embarqué x86 sur hôte arm64).
