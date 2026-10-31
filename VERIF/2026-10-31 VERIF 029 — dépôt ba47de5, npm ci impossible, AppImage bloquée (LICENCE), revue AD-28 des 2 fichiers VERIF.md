# 2026-10-31 VERIF 029 — dépôt `ba47de5` : autosuffisance (`npm ci` / `npm test`), revue AD-28 des deux fichiers VERIF touchés

**Banc (desk-qa)** · mesure du **2026-10-31, 15:16Z → 15:20Z** · état de référence testé : commit
`ba47de5900c241716a9a4ac70b29e41fb16148a9` « Concord : premier commit » (2026-10-31 16:15:34 +0100),
174 fichiers versionnés.

Hôte de mesure : `node v22.23.4`, `npm 10.9.9`, Linux 7.0.0-1019-nvidia, **arch arm64**.
Toutes les expériences ont été faites dans des **clones neufs** du dépôt
(`git clone /work/lan-voice r1..r4`), donc **sans `node_modules` et sans aucun fichier non versionné**
(`VERIF/raw/`, `*.log`, `.verif-*` absents : c'est exactement le contenu du dépôt).

---

## 0. Réponse en une ligne à la question de desk-lead

> « Un `npm ci` à partir du seul dépôt suffit-il à faire passer `npm test` ? »

**Non — et pour deux raisons indépendantes, plus une troisième qui bloque le paquet Linux.**
`npm ci` **ne peut pas démarrer** (aucun `package-lock.json` n'est versionné) ; et même après
installation, `npm test` dépend de **`tsx`, qui n'est déclaré nulle part** (téléchargé par `npx` depuis
le registre public). En revanche, **une fois `node_modules` présent, le dépôt est autosuffisant** :
`npm test` rend **664/664, 49 suites, 0 échec** sur un clone nu — le chiffre annoncé est reproduit
exactement. Le détail chiffré est au §3.

---

## 1. Revue des deux fichiers VERIF modifiés sans me demander (point 1 de desk-lead)

Conclusion : **le renommage est correct sur les deux fichiers, l'intention est préservée**, et il a
révélé deux défauts préexistants que le renommage n'a pas créés mais que je devais nommer.

### 1.1 `VERIF/smoke-desktop.md` — les 3 lignes touchées

| Ligne | Contenu après renommage | Verdict | Preuve |
|---|---|---|---|
| 272 | `ss -tunp \| grep -i -e electron -e concord` | **Correct** | `package.json:2` `"name": "concord"`, `electron-builder.yml:58` `executableName: concord`. Le paquet expose un binaire `concord` (couvert par `-e concord`) et Electron en mode dev s'appelle `electron` (couvert par `-e electron`). Aucune perte : l'ancien motif `desktop-lan` ne matchait plus rien. |
| 369 | `chmod +x release/concord-*.AppImage && ./release/concord-*.AppImage` | **Correct et vérifié** | Artefact réellement produit : `release/concord-1.0.0-arm64.AppImage`, 96 634 944 octets (voir §3, essai I, pour l'obstacle qu'il a fallu lever pour l'obtenir). Le motif `concord-*` est le bon. |
| 370 | `sudo dpkg -i release/concord-*.deb && concord` | **Motif correct, étape inexécutable** | electron-builder annonce bien `file=release/concord-1.0.0-linux-arm64.deb` (donc le glob est juste), puis **échoue** : `⨯ Please specify project homepage` (FpmTarget exige `homepage` dans `package.json`, absent). **Aucun `.deb` ne peut exister** en l'état. |

Rien d'autre à corriger dans `smoke-desktop.md` : `git grep desktop-lan ba47de5` ne renvoie plus que
`SPECS/SPEC-018-AD-28-nom-concord.md` (le document qui **raconte** le renommage — occurrence légitime).

Note d'honnêteté documentaire : `smoke-desktop.md` l.362 affirmait déjà « `release/` n'existe pas dans
le dépôt : aucune construction n'a jamais abouti ici ». Cette phrase passe de **constat** à **fait
vérifié et expliqué** : la construction AppImage échoue sur `LICENCE` (essai H), la construction deb sur
`homepage` (essai J). J'ai laissé le texte tel quel — c'est à desk-lead de décider s'il veut y inscrire
la cause ; je ne réécris pas un protocole de passation daté sans son accord.

### 1.2 `VERIF/measure-traffic.sh` — le filtre `*concord*` (l.212) : corrigé, motif ci-dessous

Le filtre de processus est passé de `*desktop-lan*` à `*concord*`. Fonctionnellement il attrape bien
l'application, **mais il introduit une fausse attribution**, parce que « concord » est désormais aussi
**le nom du répertoire du dépôt**. Toute commande qui cite un chemin du dépôt est attribuée à
l'application — en premier lieu l'outil de capture lui-même :

```
$ bash attr-demo.sh          # processus factice : tcpdump -w …/concord/VERIF/raw/mesure.pcap
  ATTRIBUÉ pid=52228 tcpdump -i any -w /home/node/concord/VERIF/raw/mesure.pcap 20
FOUND=1                      # 2026-10-31T15:18Z — avant correctif
```

Conséquence réelle : `FOUND>0` **fait disparaître** l'avertissement « aucune socket mesurée ne peut être
imputée ». Autrement dit le script pouvait déclarer une attribution alors qu'aucun processus de
l'application ne tournait — exactement le genre de faux positif qui décrédibilise une preuve « LAN only ».

**Correctif appliqué (l.198-240)** : l'attribution se fait maintenant sur le **nom de l'exécutable**
(`/proc/PID/exe`), avec repli sur la ligne de commande seulement si `/proc/PID/exe` est illisible, plus
une exclusion explicite `tcpdump|dumpcap|tshark`. Le motif `*dist/main*` (main compilé, mode dev) est
conservé. Étiquettes « lan-voice » résiduelles (l.198 et l.203) passées à « concord ».

Autotest sur le **code réellement extrait du script** (`sed -n '/^attribution()/,/^}/p'`), cas présents
simultanément :

```
$ bash attr-selftest.sh /work/lan-voice/VERIF/measure-traffic.sh     # 2026-10-31T15:20Z
  pid=53662 concord /tmp/tmp.qjyJUIWck5/concord 25
OK: tcpdump non attribué          (pid 53663, cmdline citant …/concord/VERIF/raw/…)
OK: exe=concord attribué
OK: exe=electron attribué
$ sh -n VERIF/measure-traffic.sh  → SYNTAXE_OK
```

`git diff --stat` : `VERIF/measure-traffic.sh | 35 ++++++++++++++------` (29 insertions, 6 suppressions).
**Aucune mesure datée n'a utilisé ce code** : les campagnes antérieures tournaient avec le filtre
`*desktop-lan*`, elles ne sont donc pas affectées. Le fichier est **modifié mais non commité**
(`git status` : ` M VERIF/measure-traffic.sh`) — à toi de l'inclure ou de le jeter.

---

## 2. Ce qui n'est pas versionné (point 2 de desk-lead) — vérifié, cohérent

- `.gitignore` couvre bien ce qui est annoncé : `node_modules/`, `dist/`, `release/`, `build/`,
  `*.tsbuildinfo`, `*.log`, `.m*.log`, `.verif-*`, `.meta`, `VERIF/raw/`, `VERIF/__pycache__/`,
  `VERIF/*.tmp` / `VERIF/.*.tmp`, `VERIF/.t[0-9]*`.
- `git status --ignored --short` → **29 entrées ignorées**, et `git status --short` → **0** : l'arbre est
  propre, l'intention « on ne versionne pas les preuves brutes » est effective.
- **Les rapports qui citent les preuves sont bien versionnés** : 26 `VERIF/*.md` dans le commit.
- **Aucun rapport ne cite un script absent du dépôt** : les 15 `VERIF/*.{sh,py,mjs,ts}` cités par les
  `.md` versionnés sont tous présents dans `ba47de5` (`git cat-file -e` : 15/15 OK). C'était le vrai
  risque du `.gitignore` — il n'est pas réalisé.
- **10 chemins `VERIF/raw/…` distincts sont cités** par les rapports : tous existent sur cette machine
  (31 entrées dans `VERIF/raw/`), aucun n'est versionné → conforme à la règle annoncée « la capture se
  régénère, le rapport date la mesure ». Je n'ai **pas** vérifié que ces captures sont régénérables à
  l'identique (voir §4).
- Observation mineure : 3 fichiers versionnés portent des noms avec espaces et tirets cadratins
  (`VERIF/2026-10-31 VERIF 026 — …md`, `… 027 …`, `… 028 …`). Git les sort entre guillemets et les
  échappe en octal (`"VERIF/2026-10-31 VERIF 026 \342\200\224 …"`) : inoffensif sur Linux, pénible sur
  un hôte Windows ou dans un script qui lit `git ls-files` sans `-z`.

---

## 3. Autosuffisance du dépôt (point 3 de desk-lead) — les chiffres

### 3.1 Matrice des essais

| # | État de départ | Commande | Résultat | Horodatage (UTC) |
|---|---|---|---|---|
| A | clone nu, `node_modules` absent | `npm ci` | **ÉCHEC immédiat** `EUSAGE` : « The `npm ci` command can only install with an existing package-lock.json or npm-shrinkwrap.json with lockfileVersion >= 1 » | 15:17 |
| B | clone nu, `node_modules` absent | `npm test` | 640 tests / 42 suites / **639 pass / 1 fail** — `tests/overlay-controller.test.ts` : `Error: Cannot find module 'electron'` | 15:16 |
| C | clone nu | `npm install` (sans option, `NODE_ENV=production` hérité de l'hôte) | « added **6** packages in 8 s » (devDeps omises) → `npm test` : 640/42, **639 pass / 1 fail**, même cause | 15:16:58 |
| D | clone nu | `npm install --include=dev --no-audit --no-fund` | « added **433** packages in 7 s » → `npm test` : **664 tests / 49 suites / 664 pass / 0 fail** (5 491 ms) | 15:17:13 → 15:17:28 |
| E | clone nu + le `package-lock.json` généré en D recopié | `npm ci` puis `npm test` | `npm ci` **OK en 8 s**, `npm test` : **664/664, 49 suites, 0 fail** | 15:18:52 → 15:19:00 |
| F | clone nu + deps | `npx tsc -p tsconfig.json --noEmit` | **0 diagnostic** | 15:19 |
| G | clone nu + deps | `npm run build` (`tsc` + `vite 5.4.21`) | **OK**, `dist/renderer/*` produit | 15:17:46 |
| H | clone nu + deps, **sans** `LICENCE` | `npx electron-builder --linux AppImage` | **ÉCHEC** : `⨯ cannot find specified resource "LICENCE", nor relative to "…/build", neither relative to project dir` | 15:17:51 (r3), confirmé verbatim 15:19:27 (r4) |
| I | idem + un fichier `LICENCE` (MIT) créé à la main **hors dépôt** | `npx electron-builder --linux AppImage` | **OK** : `release/concord-1.0.0-arm64.AppImage`, 96 634 944 o | 15:18:13 |
| J | clone nu + deps | `npx electron-builder --linux deb` | **ÉCHEC** : `⨯ Please specify project homepage` (nom visé : `concord-1.0.0-linux-arm64.deb`) | 15:19 |
| K | clone nu + deps | `npx tsx` avec cache npm **vide** | `npm error code ENOTCACHED` pour `https://registry.npmjs.org/tsx` → `tsx` **n'est pas une dépendance déclarée** | 15:17:37 |
| L | clone nu + deps | `node --test tests/*.test.ts` (runtime TS natif de Node 22, sans `tsx`) | 621 tests / **618 pass / 3 fail** — `ERR_MODULE_NOT_FOUND` sur les imports relatifs sans extension (`src/shell/overlay-geometry`) | 15:19:35 |

### 3.2 Ce que la matrice dit

1. **`npm ci` est impossible, point.** Aucun `package-lock.json` n'est versionné (ni présent sur
   disque) : `npm ci` refuse de démarrer. C'est un NON net à la question posée, indépendant de toute
   question réseau.
2. **Le dépôt suffit à `npm test` dès que `node_modules` existe** : essais D et E donnent **664/664,
   49 suites, 0 échec** sur un clone nu — donc aucun test ne dépend d'un fichier non versionné
   (`VERIF/raw/`, logs, `.verif-*`) ; les chiffres annoncés par desk-lead sont **reproduits à
   l'identique**. C'est la bonne nouvelle, et elle est mesurée, pas supposée.
3. **`npm test` n'est pas reproductible hors ligne** : `tsx` (4.23.15 dans le cache de l'hôte) n'est ni
   dans `dependencies` ni dans `devDependencies` ; le script fait `npx tsx`, donc un poste au cache
   vierge **télécharge depuis registry.npmjs.org** (essai K). Le remplacement par `node --test` natif
   n'est pas possible en l'état (essai L : 3 fichiers échouent sur la résolution d'imports sans
   extension). `tsx` est donc **nécessaire et doit être déclaré**.
4. **Piège `NODE_ENV=production`** : sur cet hôte, `NODE_ENV=production` est dans l'environnement, donc
   `npm install` **saute les devDependencies** (6 paquets) et `npm test` rend un rouge trompeur
   (`Cannot find module 'electron'`). Quiconque rejoue la campagne dans un CI en `NODE_ENV=production`
   conclura à tort que le dépôt est cassé. À écrire dans la procédure de reproduction.
5. **Le paquet Linux est bloqué par deux métadonnées manquantes**, pas par du code :
   `electron-builder.yml` déclare `appImage.license: LICENCE` alors qu'aucun fichier `LICENCE` n'existe
   (essai H), et le target `deb` exige `homepage` dans `package.json` (essai J). L'essai I prouve que la
   chaîne de construction est saine : **il ne manque que le fichier**.

### 3.3 Correctifs proposés, par ordre de coût/bénéfice

1. **Versionner `package-lock.json`** — il est déjà généré (230 382 o, créé par `npm install` en D, resté
   non suivi). C'est ce qui rend `npm ci` possible et les versions reproductibles ; sans lui, toutes les
   bornes `^` de `package.json` flottent. Coût : 1 fichier.
2. **Déclarer `tsx`** dans `devDependencies` (`"tsx": "4.23.15"` = la version réellement utilisée par la
   campagne) et remplacer `npx tsx` par `tsx` dans `test:node`, pour supprimer l'appel réseau implicite
   au registre public.
3. **Ajouter le fichier `LICENCE`** (MIT, cohérent avec `package.json`), sinon aucun `.AppImage` ne sort
   du dépôt et la section « artefacts » de `smoke-desktop.md` ne peut pas être exécutée.
4. **Ajouter `homepage`** (et `author`, également signalé par electron-builder) dans `package.json` si le
   `.deb` est voulu ; sinon supprimer la cible deb et la ligne 370 de `smoke-desktop.md`.
5. Mentionner `NODE_ENV` dans la procédure de reproduction (`npm install --include=dev` ou
   `NODE_ENV=development`).

---

## 4. Points NON vérifiés (à ne pas lire comme acquis)

- **Clone depuis GitHub** : tous les essais partent d'un `git clone` **local** de `/work/lan-voice`.
  Je n'ai pas testé `git clone https://github.com/tournierjc/concord` (dépôt privé, aucun identifiant
  utilisé ici) : si un fichier a été exclu à la poussée (`.gitignore`, hook, `export-ignore`), je ne le
  verrais pas. Le contenu vérifié est celui du commit `ba47de5` tel qu'il est sur cette machine.
- **Temps d'installation à cache froid** : 433 paquets en 7 s, mais le cache npm de l'hôte était chaud
  (y compris le binaire Electron, 263 Mo). Sur un poste vierge, compter le téléchargement d'Electron —
  non mesuré.
- **x64** : la machine est arm64 (`concord-1.0.0-arm64.AppImage`). Les noms d'artefacts x64
  (`x86_64` pour AppImage, `amd64` pour deb) sont déduits du code d'electron-builder, pas mesurés ici.
- **Exécution réelle** de l'AppImage (démarrage, S1/S5/S6/S10) : non faite — pas d'affichage sur cet
  hôte, et ce n'est pas l'objet de cette note.
- **Régénérabilité des 31 entrées de `VERIF/raw/`** annoncées comme reproductibles : non testée.
- **Intégrité de la chaîne de tests** : je constate 664/664 ; je ne ré-audite pas ici ce que chaque test
  prouve (sujet des VERIF 015 à 028).
- **Le correctif de `measure-traffic.sh` n'a pas été exercé sur une capture réelle** (seulement en
  autotest avec processus factices) : la prochaine campagne datée sera sa première utilisation.

---

## 5. Reproduction exacte

```bash
# environnement
node -v   # v22.23.4
npm -v    # 10.9.9
git -C /work/lan-voice log --oneline -1   # ba47de5 Concord : premier commit

# A : npm ci sans lockfile
git clone /work/lan-voice r1 && cd r1 && npm ci          # -> EUSAGE, pas de package-lock.json

# B : tests sans node_modules
npm test                                                 # -> 640 tests, 639 pass, 1 fail (Cannot find module 'electron')

# D : installation complète puis campagne
git clone /work/lan-voice r3 && cd r3
env -u NODE_ENV npm install --include=dev --no-audit --no-fund   # 433 paquets
npm test                                                          # 664/664, 49 suites, 0 fail
npx tsc -p tsconfig.json --noEmit                                 # 0 diagnostic
npm run build                                                     # OK

# E : npm ci dès qu'un lockfile existe
cp r3/package-lock.json r4/ && cd r4 && env -u NODE_ENV npm ci && npm test   # 664/664

# H / I / J : paquets Linux
npx electron-builder --linux AppImage    # ⨯ cannot find specified resource "LICENCE"
npx electron-builder --linux deb         # ⨯ Please specify project homepage
printf 'MIT License\n\nCopyright (c) 2026 Concord contributors\n' > LICENCE   # (hors dépôt, essai contrôlé)
npx electron-builder --linux AppImage    # OK -> release/concord-1.0.0-arm64.AppImage (96 634 944 o)

# K : tsx n'est pas déclaré
npm_config_cache=$PWD/cachefresh npx --offline tsx --version   # -> ENOTCACHED (registre requis)

# 1.2 : attribution
bash attr-demo.sh     /work/lan-voice/VERIF/measure-traffic.sh   # avant correctif -> FOUND=1 (faux positif)
bash attr-selftest.sh /work/lan-voice/VERIF/measure-traffic.sh   # après correctif -> 3/3 OK
sh -n /work/lan-voice/VERIF/measure-traffic.sh                   # SYNTAXE_OK
```

Rapport livré comme travail (non final) : la campagne finale reste à desk-lead.
