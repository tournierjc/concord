# VERIF 031 — T20 : `664/664` reproduits sur `15aed91`, AppImage débloquée, TL;DR de `docs/TESTS.md` rafraîchi

- **Poste** : Banc (desk-qa) — tests, mesures datées, vérification.
- **Date de la campagne** : 2026-10-31, `15:25:00Z → 15:30:01Z` (UTC).
- **État de référence** : dépôt `/work/lan-voice`, commit **`15aed91`** (« Concord : clone nu réparé
  (lockfile + tsx), AppImage débloquée, attribution trafic corrigée », committé `15:24:20Z`), `main`.
- **Hôte** : `node v22.23.4`, `npm 10.9.9`, `tsx 4.23.15`, `electron-builder 24.13.3`, `electron 30.5.1`,
  Linux arm64 (`os=7.0.0-1019-nvidia`), **`NODE_ENV=production` exporté par l'hôte** ⇒ toutes les
  commandes npm tournent sous `env -u NODE_ENV` (piège mesuré en VERIF 029/030).
- **Arbre au moment des mesures** : `15aed91` + `docs/TESTS.md` réécrit par cette campagne (voir §5)
  + `VERIF/VERIF-000` (errata VERIF 030) + VERIF 030 non suivie. Aucun commit fait par le Banc.

---

## 1. Résultat en une ligne

`npm test` sur `15aed91` : **exit=0, 664 tests, 664 pass, 0 fail, 0 skip, 49 suites**, rejoué
**trois fois** avec les mêmes comptes. `AppImage` : **exit=0**, 96 634 946 o. `deb` : **exit=1**
(`Exec format error`, fpm x86 — limitation d'hôte, cible **non vérifiée**). `check-deps.sh` :
**PASS**. `attr-selftest.sh` : **3/3** sans argument. Le fichier `docs/TESTS.md` est passé de
« 530 tests / 20 fichiers / 28 suites » à **664 / 26 / 49**, daté.

---

## 2. Mesures (commande exacte → sortie, horodatage de début en UTC)

| # | Commande | Sortie mesurée | Début → fin (UTC) |
|---|---|---|---|
| 1 | `env -u NODE_ENV npm test` | **exit=0** · `# tests 664` · `# suites 49` · `# pass 664` · `# fail 0` · `# skipped 0` · `# duration_ms 5307.155957` | `15:25:09Z → 15:25:15Z` |
| 2 | `env -u NODE_ENV npm test` (run 2, déterminisme) | **exit=0** · 664 · 49 · 664 pass · 0 fail · `duration_ms 5301.573521` | `15:27:56Z → 15:28:02Z` |
| 3 | `env -u NODE_ENV npm test` (run 3, **après** réécriture de `docs/TESTS.md`) | **exit=0** · 664 · 49 · 664 pass · 0 fail | `15:29:35Z → 15:29:40Z` |
| 4 | `env -u NODE_ENV npx tsc -p tsconfig.json --noEmit` | **exit=0** · 0 ligne de sortie | `15:28:02Z → 15:28:03Z` |
| 5 | `env -u NODE_ENV npm run build:main` (`tsc -p tsconfig.main.json`) | **exit=0** | `15:28:03Z → 15:28:04Z` |
| 6 | `env -u NODE_ENV npx vite build` | **exit=0** · `✓ built in 459ms` | `15:28:04Z → 15:28:05Z` |
| 7 | `env -u NODE_ENV npm run test:vitest` (arbre de travail) | **exit=1** · `Test Files 1710 failed (1710)` · `Tests no tests` | `15:25:48Z` |
| 8 | `env -u NODE_ENV npx vitest run` dans un **clone nu** (`git clone /work/lan-voice`) | **exit=1** · `Test Files 26 failed (26)` · `Tests no tests` | `15:27:47Z → 15:27:48Z` |
| 9 | `env -u NODE_ENV npx electron-builder --linux AppImage` | **exit=0** · `release/concord-1.0.0-arm64.AppImage` **96 634 946 o** · `sha256 1486e3c9…` | `15:28:41Z → 15:28:44Z` |
| 10 | `env -u NODE_ENV npx electron-builder --linux deb` | **exit=1** · `Exec format error` (fpm x86) | `15:28:23Z → 15:28:24Z` |
| 11 | `sh VERIF/check-deps.sh` | **exit=0** · `CHECK_DEPS RESULT=PASS failures=0 skips=0` | `15:30:00Z` |
| 12 | `sh VERIF/attr-selftest.sh` (sans argument) | **exit=0** · 3 × `OK` | `15:30:00Z → 15:30:01Z` |
| 13 | `sh VERIF/attr-selftest.sh` depuis `VERIF/` (sans argument) | **exit=0** · 3 × `OK` | idem lot |
| 14 | `sh attr-selftest.sh` dans un répertoire **sans** `measure-traffic.sh` | **exit=2** · `ECHEC: script introuvable: ./measure-traffic.sh` | idem lot |
| 15 | `sh attr-selftest.sh <chemin inexistant>` | **exit=2** · `ECHEC: script introuvable: …/nope.sh` | idem lot |

Déterminisme : runs 1, 2 et 3 → comptes identiques (664 / 49 / 664 / 0), durées 5 307 / 5 302 ms.
La durée varie, **jamais les comptes**. Les chiffres de Régie (`15:24:20Z`, 664 / 664 / 0 / 49
suites / 5,3 s) sont **reproduits à l'identique** par un tiers, sur un arbre différent (le sien
était propre, le mien porte mes éditions de documentation).

---

## 3. `test:vitest` : le compte dépend de l'arbre, pas du code (mesuré, décomposé)

`vite.config.ts` **n'a aucun bloc `test:`** (`grep -n "test\|exclude\|include" vite.config.ts` → rien) :
vitest 1.6.1 applique ses motifs par défaut et ramasse tout `*.{test,spec}.?(c|m)[jt]s?(x)` sous la
racine, **y compris les répertoires non versionnés**.

Décomposition exacte de `1710` (run 7) :

| Source | Fichiers |
|---|---|
| `tests/*.test.ts` (les vrais tests) | 26 |
| `VERIF/raw/**/copies/**/*.test.ts` (copies de captures, **ignorées par git**) | 1 350 |
| `.verif-t17/` (288) + `.verif-t18/` (22) + `.verif-t19/` (24) — répertoires de travail ignorés | 334 |
| **Total** | **1 710** |

Dans un clone nu (run 8) : **26**, seul chiffre reproductible. Les deux runs sont `exit=1` et
rendent `Tests no tests` : **0 assertion exécutée** dans les deux cas.

**Correctif proposé (non appliqué — `vite.config.ts` n'est pas un fichier du Banc)** :

```ts
// vite.config.ts
test: { exclude: [...configDefaults.exclude, 'VERIF/**', '.verif-*/**'] }
```

Sans lui, tout rapport citant « N fichiers en échec » pour `test:vitest` publie un chiffre qui
dépend du disque de la personne qui l'a lancé.

---

## 4. AppImage : la levée du blocage est mesurée, mais les octets ne sont **pas** reproductibles

- `appImage.license: LICENCE` retiré de `electron-builder.yml` (remplacé par un commentaire de
  3 lignes, `l.75-80`) ⇒ `--linux AppImage` **exit=0** (`15:28:41Z → 15:28:44Z`). Le blocage
  `⨯ cannot find specified resource "LICENCE"` de VERIF 029 est **levé**, constaté par exécution
  (et non par lecture du yml).
- Effet de bord relevé : **deux constructions du même arbre** donnent
  `96 634 968 o / sha256 480e4713…` (artefact présent à l'ouverture de la session, construit par
  Régie) puis `96 634 946 o / sha256 1486e3c9…` (ma reconstruction, même arbre, 22 octets de moins).
  ⇒ **ni la taille ni le sha256 de l'AppImage ne sont un empreinte d'état** : squashfs embarque des
  horodatages. Ce qui est reproductible et donc citable : `exit=0`, le **nom**
  (`concord-1.0.0-arm64.AppImage`), l'**absence** de `latest-linux.yml` (le seul `.yml` de
  `release/` est `builder-debug.yml`), l'absence de `resources/app-update.yml`, l'asar sans `*.md`
  ni `src/` (0), et `locales/` = 2 (`fr.pak`, `en-US.pak`).
  **Errata pour VERIF 030** : le sha `480e4713…` y était cité comme empreinte d'artefact ; il ne
  vaut que pour la construction du `15:2xZ`, pas comme identité de l'arbre.
- `deb` : `packaging platform=linux arch=arm64 … target=deb file=release/concord-1.0.0-linux-arm64.deb`
  puis `Exec format error` — le `fpm` embarqué est un binaire **x86**. La correction `homepage`
  (+ `author`) de Régie est **active** : la ligne de commande fpm porte bien
  `--url https://github.com/tournierjc/concord`, `--license MIT`, `--architecture arm64`. Donc
  l'échec n'est plus « homepage manquante », il est **architectural**. Cible `deb` :
  **NON VÉRIFIÉE** (hôte arm64, pas de machine x64 dans ce sandbox).

---

## 5. Ce que j'ai fait de `docs/TESTS.md` (le TL;DR daté du 2026-10-30)

Réécrit par le Banc (c'est ma page), `sha256 9082a55d…`, 243 lignes, `git diff --stat` : 66 insertions,
36 suppressions.

1. **En-tête** : `T19 → T20`, état `15aed91`, `env -u NODE_ENV` explicité, **nouvelles empreintes
   témoins** (`15:27:56Z`) : `package.json` `be6c0e89…`, `tests/scripts-coverage.node.test.ts`
   `53326963…`, `src/engine/README.md` `338df4a1…`, version précédente de la page `5085ad20…`.
2. **TL;DR** : 20 → **26 fichiers**, 530 → **664 tests**, 28 → **49 suites**, `npx tsx` → **`tsx`**
   (tsx déclaré en devDependency), chaque ligne datée à la seconde ; deux lignes neuves pour
   `electron-builder --linux AppImage` (exit=0) et `--linux deb` (exit=1, non vérifié).
3. **Paragraphe neuf** sur la dépendance de `test:vitest` à l'arbre (§3 ci-dessus), avec le
   correctif proposé, et **abandon de la formule « 20/20 »** qui n'était vraie que dans un arbre
   sans captures.
4. **Bloc « Reproduire »** : toutes les commandes sous `env -u NODE_ENV`, attendus chiffrés
   (664 / 0 fail), état de référence nommé (`15aed91`).
5. **Points non vérifiés** mis à jour : `npm run dist` éclaté par cible (AppImage ✅ / deb ❌ /
   Windows et x64 non mesurés) ; README `src/engine/README.md` : **7** fichiers cités sur **26**,
   **19 omis** listés nommément (la liste précédente en citait 13 sur 20 et datait) ; couverture
   toujours non instrumentée ; **« machine vierge » requalifié** : `package-lock.json` désormais
   versionné (524 entrées, 245 590 o) et présent dans un clone nu, `npm ci` + `npm test` →
   664/664/0/49 (mesure Régie `15:24Z`) ; restent **non vérifiés par le Banc** le clone GitHub
   (dépôt privé), le cache npm **froid**, le cache `npx` vide.
6. **Historique** : ligne T19 conservée avec sa date, ligne **T20** ajoutée, note sur ce que T20
   ajoute (rejeu ×3, dépendance d'arbre de `test:vitest`).

---

## 6. Revue des trois points confiés par Régie

1. **`VERIF/attr-selftest.sh` (défaut + exit 2)** — ✅ vérifié, pas seulement relu :
   sans argument depuis la racine (run 12) et depuis `VERIF/` (run 13) → **exit=0, 3 OK / 3**,
   plus aucun `ECHEC` trompeur ; dans un répertoire où `measure-traffic.sh` est absent →
   **exit=2** avec `ECHEC: script introuvable: ./measure-traffic.sh` (message actionnable) ;
   argument explicite inexistant → **exit=2** également. L'intention (« extraire le code réel, ne
   pas le réécrire ») est intacte.
2. **TL;DR de `docs/TESTS.md`** — ✅ refait (voir §5), pas seulement complété d'une section datée.
3. **VERIF 029 versionné** — ✅ constaté : `git status` ne montre plus de VERIF 029 non suivi, et
   le clone nu de `15aed91` contient le fichier, le lockfile (245 590 o) et `VERIF/raw` **absent**
   (`du -sh clone` = 5,3 Mo). Les 26 fichiers `VERIF/*.md` restent versionnés, les captures non.

---

## 7. Ce que cette campagne n'a PAS vérifié (nommé, pas « ça marche »)

- **`npm ci` rejoué par moi-même** : refusé cette session (`No permission to install`/hors
  auto-approbation, fail-closed). Je **n'ai donc pas** reproduit le `npm ci` de Régie ; ce que j'ai
  vérifié de mon côté : `package-lock.json` **présent dans le clone nu** (`git clone` → 245 590 o),
  `lockfileVersion 3`, **524 entrées**, `esbuild`/`rollup` x64 **et** arm64 présents. Le chiffre
  « npm ci → 433 paquets → 664/664 » reste **de Régie**, non remesuré ici.
- `git clone` **depuis GitHub** (dépôt privé) — non testé, clone **local** uniquement.
- Cache **npm froid** et cache `npx` vide — le run a bénéficié du cache de l'hôte.
- `npm run dev`, `npm start` : non lancés (Electron exige un affichage).
- **Exécution réelle** de l'AppImage (construite, jamais lancée) et de l'installeur `deb`.
- Cibles **x64** et **Windows/nsis** : non mesurées (hôte arm64, pas de Wine).
- Icône `build/` : toujours absente ⇒ l'app sort avec l'icône Electron par défaut
  (`• default Electron icon is used`, relevé à chaque construction). Décision de JC, hors Banc.
- Régénérabilité des 1 350 copies de `VERIF/raw/` : non tentée.

---

## 8. État laissé derrière moi

| Fichier | État |
|---|---|
| `docs/TESTS.md` | **modifié** (T20, `sha256 9082a55d…`), non commité — à commiter par Régie |
| `VERIF/2026-10-31 VERIF 031 …` (ce fichier) | **nouveau**, non commité |
| `VERIF/2026-10-31 VERIF 030 …` | non suivie (campagne précédente), non commitée |
| `VERIF/VERIF-000-etat-chantier.md` | **modifié** (errata VERIF 030), non commité |
| `VERIF/measure-traffic.sh`, `VERIF/check-deps.sh`, `VERIF/attr-selftest.sh`, harnais | déjà versionnés dans `15aed91` |
| `release/` | AppImage reconstruite (`15:28:41Z`), taille/sha propres à cette construction |
| Aucun correctif appliqué à `vite.config.ts` | proposition seulement (§3) |

Toutes les traces brutes de cette campagne (logs `npm test` ×3, `tsc`, `vite`, `vitest` ×2,
`electron-builder` ×2, `check-deps`, `attr-selftest`, clone nu) sont dans le bac à sable du Banc
`desk-qa/sandbox/v031/` — **non versionnées**, par la règle du dépôt (§2 du message de Régie) ;
les chiffres ci-dessus sont rejouables par les commandes des tableaux §2.
