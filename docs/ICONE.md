# Icône applicative — état câblé

**Date :** 2026-10-31 · **Auteur :** Cadre · **Dépôt :** `/work/lan-voice`, câblage mesuré sur
`03e6205` + arbre local, **commité ensuite** par la régie (commit dont le message cite VERIF 032/ICONE).

## Provenance
Icône livrée par Maquette dans `_shared/concord-icon/` : `icon.svg` (source), `icon-1024.png`
(1024×1024 RGBA8), déclinaisons 512/256/128, `render-icon.mjs`. Aucune régénération : fichiers **copiés**.

## Fichiers versionnés (build/)
- `build/icon.png` — copie de `icon-1024.png`, sha256 `b2cfe8992326d89f1e633e6b2cec3b896d04e0890dc93845825ebd13393febac`
- `build/icon.svg` — source éditable, sha256 `76c4991b59dbc172d3b8f112643d1b9174212bec27ab9183976c9ad0bc5c8ba2`

`.gitignore` : la ligne `build/` (même piège qu'un lockfile ignoré : un clone nu rebâtirait sans icône)
devient `build/*` + `!build/icon.png`, `!build/icon.svg`, `!build/icon.ico`, `!build/icon.icns`.
Preuve : `git check-ignore build/icon.png` → aucune sortie (rc=1) ; `git status --short -uall` →
`?? build/icon.png`, `?? build/icon.svg`.

## Détection electron-builder
`directories.buildResources: build` inchangé, **aucun champ `icon:` explicite** : la détection par
défaut fonctionne (artefact = icône Concord, pas celle d'Electron). Reconstruction :
`electron-builder --linux AppImage --arm64` → rc=0, `release/concord-1.0.0-arm64.AppImage`.

Contenu (extrait du squashfs, offset 197808) :
- `usr/share/icons/hicolor/0x0/apps/concord.png` — 16672 o, sha256 `b2cfe899…93febac`, IHDR 1024×1024 RGBA8
- `concord.png` et `.DirIcon` → liens vers ce PNG
- `concord.desktop` → `Icon=concord`, `StartupWMClass=Concord`

Hash **identique octet à octet** à `icon-1024.png` : electron-builder recopie le PNG, ne rééchantillonne pas.
Contre-preuve : icône Electron par défaut (`node_modules/electron/dist/resources/default_app.asar` →
`/icon.png`) = `b0f6f06d7e94053dabcc7dd8adc83d925089dbca55df0ca573b267b710e1f79d` (73801 o) ; aucun
fichier de l'arbre extrait ne porte ce hash, le seul PNG de l'archive est celui de Concord.

En dev (`npm start`), `src/main/index.ts` passe `icon:` (`join(app.getAppPath(), 'build', 'icon.png')`,
seulement si `!app.isPackaged` — `build/` n'est pas dans l'asar).

## Constats mesurés, non corrigés ici
1. Dossier de thème en **`hicolor/0x0/`** : `app-builder icon --format set` lit la taille dans le **nom**
   du fichier (`256x256.png` → 256) et renvoie `size: 0` pour `icon.png`. Un `deb` installerait donc
   l'icône dans `/usr/share/icons/hicolor/0x0/`. Remède : `build/icons/1024x1024.png` (+ `!build/icons/`) —
   non appliqué, l'arbitrage fige `build/icon.png` + `icon.svg`.
2. `electron-builder.yml` porte `linux.desktop.entry:` (syntaxe v25) : en 24.13.3 la clé sort en
   `entry=[object Object]` et `Name/Comment/Categories/StartupWMClass` du bloc ne sont pas appliqués.
   Correctif : aplatir sous `desktop:`.

## Non vérifié ici (à dire, pas à supposer)
- **deb** : non reconstruit (fpm embarqué x86 → *Exec format error* sur cet hôte arm64).
- **Windows / NSIS / `.ico`** : pas de build Windows possible (pas de Wine) ; conversion PNG→ICO non mesurée.
- **Icône de fenêtre en dev** : code compilé (`tsc` rc=0), rendu non observé (pas de serveur X).
- **Reproductibilité bit à bit** de l'AppImage : non (horodatages squashfs ; deux builds, deux sha256).
- **Intégration `.desktop` sur un vrai bureau** (appimaged/GNOME/KDE) : non testée.
