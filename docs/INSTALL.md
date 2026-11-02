# Installation depuis les binaires — Concord

Concord se installe sans compte, sans cloud et sans dépendance réseau après le
téléchargement. Les trois installateurs sont construits depuis la même source
(`electron-builder.yml`, seule source de config — le champ `build` de
`package.json` n'existe pas, cf. AD-28) et publiés sur la page Releases.

## Fichiers livrés (à partir de v0.3.0)

| Fichier | Plateforme | Installation |
|---|---|---|
| `concord-<version>-setup-x64.exe` | Windows 10/11 64 bits | installeur assisté (choix du dossier, raccourcis) |
| `concord-<version>-x86_64.AppImage` | n'importe quelle Linux x64 | exécutable autonome, aucune installation |
| `concord-<version>-linux-amd64.deb` | Debian 12+/Ubuntu 22.04+ x64 | `sudo apt install ./concord-*-linux-amd64.deb` |

Aucun fichier de mise à jour automatique (`latest.yml`) n'est publié : c'est un
choit de conception (SPEC-001 A15) — Concord ne téléphone jamais.

## Windows — ce qu'il faut savoir

Les binaires Windows sont livrés **non signés** (arbitrage assumé : aucun
certificat Authenticode acheté). Au premier lancement, Windows SmartScreen
affiche « Windows a protégé votre PC » : cliquer sur **Plus d'informations**
puis **Exécuter quand même**. C'est attendu et sans danger si le fichier vient
de la page Releases officielle.

L'installeur est « assisté » : il demande où installer, crée les raccourcis, et
se désinstalle proprement depuis Paramètres → Applications. Les réglages
(personnalisation, pseudos) survivent à la désinstallation ; rien n'est envoyé
ailleurs que le réseau local.

## Linux

- **AppImage** (toutes distributions) :
  ```bash
  chmod +x concord-0.4.2-x86_64.AppImage
  ./concord-0.4.2-x86_64.AppImage
  ```
  Aucun drapeau spécial n'est nécessaire. Sur Ubuntu 24.04+ (et toute
  distribution sans `libfuse2` préinstallé), l'AppImage exige la bibliothèque
  FUSE 2 :
  ```bash
  sudo apt install libfuse2     # Ubuntu 24.04+ (fournie par défaut sur 22.04)
  ```
  Sans elle, l'AppImage s'arrête avant toute fenêtre avec
  « dlopen(): error loading libfuse.so.2 » — c'est une dépendance du format
  AppImage lui-même, pas de Concord (voir Dépannage).
- **.deb** (Debian/Ubuntu — recommandé sur Ubuntu 24.04+) :
  ```bash
  sudo apt install ./concord-0.4.2-linux-amd64.deb
  concord
  ```
  Le paquet déclare les dépendances Electron standard (libgtk-3, libnss3…) —
  toutes en paquets des dépôts officiels, aucune dépendance réseau. Depuis la
  0.4.2, son `chrome-sandbox` est installé **setuid root** : le bac à sable
  Chromium démarre normalement même sur les systèmes qui restreignent les
  espaces de noms utilisateur (Ubuntu 24.04+), sans `--no-sandbox`.

## Vérifier l'intégrité

Chaque publication Releases porte les empreintes SHA-256 des trois fichiers.
Vérification locale :

```bash
sha256sum concord-0.4.2-setup-x64.exe   # Windows (Git Bash) ou shasum -a 256
sha256sum concord-0.4.2-x86_64.AppImage
sha256sum concord-0.4.2-linux-amd64.deb
```

L'empreinte affichée doit être identique à celle de la page Releases.

## Comment les installateurs sont construits

De façon reproductible depuis un clone nu :

```bash
npm ci
npm run dist:linux   # AppImage + deb
npm run dist:win     # installeur NSIS (sous Linux : wine requis)
```

Sorties dans `release/`. `npm run build` vide `dist/`, compile le main, le
preload et le renderer, puis lance `scripts/verify-build.mjs` ; electron-builder
relance la même vérification sur l'`app.asar` empaqueté (`afterPack`). Un
preload absent ou périmé fait donc échouer la construction au lieu de produire
une application à fenêtre vide.

Exigences de la machine de construction :

- **x86_64**. Ne pas construire sur aarch64 : la v0.4.0 l'a été, avec des
  contournements qui ont produit un installeur Windows dont l'« uninstaller »
  était un binaire Linux ARM et un `.deb` sans `chrome-sandbox` setuid ni lien
  `/usr/bin/concord`.
- **wine** (`wine64`) pour la cible Windows depuis Linux : electron-builder
  l'utilise pour `rcedit` (icône et métadonnées de `concord.exe`) et pour
  générer le vrai désinstalleur. Sans wine, la construction échoue — elle ne
  doit pas être court-circuitée.

Vérifier un paquet déjà construit :

```bash
node scripts/verify-build.mjs --asar release/linux-unpacked/resources/app.asar
node scripts/verify-build.mjs --asar release/win-unpacked/resources/app.asar
```

## Dépannage

- **Fenêtre vide ou noire** : relancer depuis un terminal avec
  `--enable-logging` ; depuis cette version, une erreur de rendu affiche un
  écran d'erreur lisible au lieu d'une fenêtre vide.
- **Linux, l'AppImage ne démarre pas du tout** (« dlopen(): error loading
  libfuse.so.2 ») : il manque la bibliothèque FUSE 2, retirée de
  l'installation par défaut d'Ubuntu 24.04. `sudo apt install libfuse2`, puis
  relancer l'AppImage normalement — sans aucun drapeau. Le format AppImage
  lui-même a cette dépendance : aucune application AppImage n'y échappe.
- **Linux, « The SUID sandbox helper binary was found, but is not configured
  correctly »** : les espaces de noms utilisateur non privilégiés sont
  restreints par AppArmor (Ubuntu 24.04+) ET l'aide de bac à sable n'est pas
  setuid. Installer le `.deb` 0.4.2+ : son `chrome-sandbox` est setuid root et
  le bac à sable démarre normalement. NE PAS lancer avec `--no-sandbox` :
  cela désactive la protection du processus de rendu, ce n'est pas un contournement
  acceptable.
- **Windows/Linux — fermer la fenêtre ne quitte plus l'application** (0.4.2) :
  la fenêtre se range dans la zone de notification (barre des tâches) ; son
  icône « Concord » donne « Ouvrir Concord » et « Quitter Concord ». Relancer
  Concord pendant qu'elle est cachée ramène la fenêtre existante.
