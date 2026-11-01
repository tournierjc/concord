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

- **AppImage** (recommandée, toutes distributions) :
  ```bash
  chmod +x concord-0.3.0-x86_64.AppImage
  ./concord-0.3.0-x86_64.AppImage
  ```
- **.deb** (Debian/Ubuntu) :
  ```bash
  sudo apt install ./concord-0.3.0-linux-amd64.deb
  concord
  ```
  Le paquet déclare les dépendances Electron standard (libgtk-3, libnss3…) —
  toutes en paquets des dépôts officiels, aucune dépendance réseau.

## Vérifier l'intégrité

Chaque publication Releases porte les empreintes SHA-256 des trois fichiers.
Vérification locale :

```bash
sha256sum concord-0.3.0-setup-x64.exe   # Windows (Git Bash) ou shasum -a 256
sha256sum concord-0.3.0-x86_64.AppImage
sha256sum concord-0.3.0-linux-amd64.deb
```

L'empreinte affichée doit être identique à celle de la page Releases.

## Comment les installateurs sont construits

De façon reproductible depuis un clone nu :

```bash
npm ci
npm run build
npx electron-builder --linux AppImage deb --x64
npx electron-builder --win nsis --x64
```

Sorties dans `release/`. Notes d'environnement (conteneur de construction
aarch64, 2026-11-01) :

- la cible `deb` d'electron-builder embarque `fpm` en binaire x86_64 et ne
  fonctionne pas sans émulation ; le `.deb` est donc produit par
  `scripts/build-deb.py` (dpkg-deb natif, même contenu : `/opt/Concord`,
  icône, `.desktop`, postinst/prerm, mêmes dépendances que la cible officielle) ;
- la cible NSIS appelle `rcedit` et l'installeur **sous wine** pour poser
  l'icône et produire l'uninstallateur ; sans wine ni certificat, ces deux
  étapes sont court-circuitées localement (le vrai uninstallateur est écrit
  par NSIS au premier lancement de `setup.exe`, pas à la construction) ;
- `makensis` est fourni par le paquet Debian `nsis` via
  `ELECTRON_BUILDER_NSIS_DIR`, et `7za` par le paquet `7zip`.

Ces contournements sont des adaptations **du conteneur de build**, pas de
l'application : sur une machine x86_64 standard avec wine, les cibles
officielles d'electron-builder produisent les mêmes artefacts.
