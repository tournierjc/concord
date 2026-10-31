# VERIF — smoke desktop : ce que le bac à sable n'a jamais peint

**Objet** : T23 étape B (SPEC-017 / AD-27), classe C. Procédure destinée à JC sur une **vraie
machine de bureau**. Elle ne remplace pas les tests : elle couvre exactement ce qu'aucun double ne
prouve — le pixel, le compositeur de fenêtres, le réseau réel.

**Aucune case n'est pré-remplie, aucun résultat n'est supposé.** Chaque item se termine par une
ligne `PASS/FAIL : ☐ PASS ☐ FAIL` et une case « observé » à remplir à la main (heure, message exact,
capture d'écran si utile). Si un item n'est pas réalisable sur la machine disponible, écrire `N/A` et
le motif — c'est une information, pas un échec.

**Contexte mesuré le 2026-10-31 (bac à sable, sans X, sans binaire Electron exécutable)** : `electron`
sort en **exit 127** (`libgobject-2.0.so.0` absent, aucun serveur X) ⇒ **aucune fenêtre n'a jamais été
peinte**. La logique est mesurée par `tests/overlay-controller.test.ts` (25 tests) et la suite
complète est verte (**26 fichiers, 664 tests, 664 pass, 0 fail, exit 0**) ; `npx tsc --noEmit -p
tsconfig.json` sort **0**. Le rendu, lui, n'a aucun chiffre : c'est l'objet de ce document.

> Convention de ce fichier : **« mesuré »** = chiffre obtenu par une commande ou un test déjà exécuté ;
> **« à observer »** = rien n'est connu, la case est vide. Aucune ligne « attendu » n'est un résultat.

---

## 0. Préparation (une fois)

Matériel / réseau :

- 2 postes **A** et **B** sur le **même LAN** (même sous-réseau, même commutateur), avec micro et
  casque. Un seul poste ne suffit pas : l'application prend un verrou d'instance unique
  (`src/main/index.ts:78`, `requestSingleInstanceLock`) — un second lancement local rend la main
  immédiatement.
- Le poste A (Linux) : session graphique X11 **ou** Wayland (noter lequel : le comportement
  always-on-top et click-through en dépend, voir S8 et S9).
- Pour l'item S10 uniquement : le même LAN **sans accès Internet** (débrancher le câble WAN du
  routeur, garder le LAN actif).

Outils à vérifier présents :

```bash
node -v && npm -v            # npx tsx et node --test sont utilisés par les scripts
ip -o -4 addr show           # relever l'interface LAN et son CIDR : <iface> et <LAN>/<préfixe>
which ss tcpdump scrot       # ss et tcpdump servent aux items S10 ; scrot aux captures
```

Relever et noter : version de Node, distribution et version du noyau, serveur graphique (X11 /
Wayland + compositeur), deux modèles de machines.

---

## 1. Installation et build

### P1 — installation

```bash
cd /work/lan-voice
npm ci
```

**Mesuré avant vous** : le dépôt **ne contient aucun `package-lock.json`**
(`ls package-lock.json` → `No such file or directory`, relevé du 2026-10-31T04:03Z). `npm ci` échoue
donc par construction (« can only install with an existing package-lock.json »). **Ce n'est pas un
résultat à trouver, c'est un fait à confirmer** : recopiez le message exact.

Repli si l'échec est confirmé :

```bash
npm install            # écrit package-lock.json (fichier nouveau : le signaler à Régie)
```

Hors ligne (poste sans Internet, cache npm déjà chaud) :

```bash
npm install --offline
```

Attendu : exit 0, `node_modules/electron` et `node_modules/electron-builder` présents, aucune
tentative d'accès réseau au-delà du registre configuré (à observer dans la sortie).

```
PASS/FAIL : ☐ PASS ☐ FAIL      observé : ____________________________________________
```

### P2 — build

```bash
npm run build     # = build:main (tsc -p tsconfig.main.json) + build:renderer (vite build)
echo "build exit=$?"
ls -l dist/main/index.js dist/preload/index.js dist/renderer/index.html dist/renderer/overlay.html
```

Attendu : exit 0 et les quatre fichiers ci-dessus. `dist/` est déjà présent dans le dépôt (sortie
d'une construction antérieure) : **noter la date des fichiers** pour prouver que le build a bien
réécrit.

```
PASS/FAIL : ☐ PASS ☐ FAIL      observé : ____________________________________________
```

### P3 — typecheck (déjà mesuré ici, à re-confirmer sur la machine)

```bash
npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
```

Mesuré dans le bac à sable : **exit 0**. Sur votre machine, le résultat peut différer (versions) :
recopiez le code de sortie.

```
PASS/FAIL : ☐ PASS ☐ FAIL      code de sortie : ______
```

---

## 2. Lancement

```bash
npm start        # = electron .
```

À noter dans « observé » : nombre de fenêtres ouvertes, position et taille de l'overlay, ce qu'il
affiche quand aucun participant n'est là, et si un menu/dock/taskbar le référence.

**Item S1 — démarrage** : l'application démarre hors ligne (couper Internet avant de lancer), la
fenêtre principale s'ouvre, l'overlay apparaît **sans prendre le focus**.

```
PASS/FAIL : ☐ PASS ☐ FAIL      observé : ____________________________________________
```

---

## 3. Checklist overlay — un item = un chiffre ou une observation datée

Sur **A**, rejoindre un salon avec **B** (créer le salon sur A, B le rejoint dans la liste).
Mettre sous l'overlay une fenêtre simple qui montre où va le clic : un éditeur de texte
(`gedit`, `kate`, `mousepad`) avec le curseur de saisie visible.

### S2 — halo visible quand un participant parle

**Geste** : A et B dans le même salon ; **B** parle (sans casque pour l'entendre, ou via une seconde
pièce). Regarder l'avatar de B dans l'overlay de A.

**Attendu (à confirmer, pas mesuré)** : l'avatar de B prend un halo pendant la parole, l'avatar de A
n'en prend pas ; le halo s'éteint seul après l'arrêt de la parole.

**Comment l'observer** : capture d'écran pendant la parole puis 3 s après ; comparer les deux images
(`scrot`). Noter le délai perçu d'allumage et d'extinction (chronomètre à la main, grossier).

```
PASS/FAIL : ☐ PASS ☐ FAIL      observé : ____________________________________________
```

### S3 — halo éteint quand personne ne parle

**Geste** : silence total 5 s, personne ne touche au micro.

**Attendu** : aucun halo, aucun clignotement résiduel.

```
PASS/FAIL : ☐ PASS ☐ FAIL      observé : ____________________________________________
```

### S4 — plafond d'avatars

**Mesuré dans le code** : le salon accepte **8 participants** (`IPC_MAX_PARTICIPANTS = 8`,
`src/shell/ipc-contract.ts:311`) et l'overlay découpe à **10** (`MAX_OVERLAY_PARTICIPANTS = 10`,
`src/shell/overlay-geometry.ts:67` ; `src/renderer/Overlay.tsx:52`). **Le plafond 10 n'est donc pas
atteignable en usage réel** : c'est une marge, pas un état observable.

**Ce que vous pouvez mesurer** : avec **2 participants** (A + B), puis avec autant de postes que
vous en avez, vérifier que les avatars restent **sur une seule rangée**, sans retour à la ligne, sans
avatar coupé, et que la fenêtre s'élargit quand un participant arrive.

```
PASS/FAIL : ☐ PASS ☐ FAIL      nombre de participants réellement présents : ______
observé : __________________________________________________________________
```

### S5 — le clic traverse l'overlay, sauf sur un avatar et sur la poignée

**Geste** : éditeur de texte au premier plan, overlay au-dessus, **sans cliquer sur l'overlay
d'abord**. Cliquer dans une zone **vide** de l'overlay (entre deux avatars, ou dans la bande entre le
dernier avatar et la poignée).

**Attendu** : le clic atteint l'éditeur (le curseur de saisie se déplace à l'endroit cliqué) ; la
frappe suivante s'écrit dans l'éditeur.

Puis cliquer **sur un avatar**, puis **sur la poignée** : le clic ne doit **pas** atteindre l'éditeur
(le curseur de saisie ne bouge pas).

**Comment l'observer** : taper `xxxxx` après chaque clic. Si les `x` apparaissent dans l'éditeur, le
clic a traversé ; s'ils n'apparaissent pas (ou si la fenêtre active a changé), il a été capté.
Répéter **3 fois par zone** et noter le nombre de clics qui ont traversé (attendu : 3/3 en zone vide,
0/3 sur avatar, 0/3 sur poignée — à confirmer).

```
PASS/FAIL : ☐ PASS ☐ FAIL      traversées zone vide : __/3  avatar : __/3  poignée : __/3
observé : __________________________________________________________________
```

### S6 — glisser la poignée déplace l'overlay, et la position survit au redémarrage

**Geste** : appuyer sur la poignée, glisser de **200 px vers la gauche / 120 px vers le bas**,
relâcher. Quitter l'application, la relancer, rejoindre un salon.

**Attendu** : l'overlay suit le curseur pendant le glissement, reste **entièrement dans l'écran**
(il ne sort pas par le bord), et réapparaît **à la même position** au redémarrage.

**Comment l'observer** : capture avant/après, et position relue dans les réglages persistés
(`~/.config/Desktop LAN/` — relever le chemin exact et le champ `position`).

```
PASS/FAIL : ☐ PASS ☐ FAIL      position après glissement : x=____ y=____
position après redémarrage : x=____ y=____      observé : ______________________
```

### S7 — l'overlay ne vole jamais le focus

**Geste** : cliquer dans l'éditeur, taper une phrase **sans s'arrêter** pendant que B parle (donc
pendant que l'overlay s'allume) et pendant qu'un participant arrive.

**Attendu** : aucun caractère perdu, la fenêtre active ne change pas, le curseur de saisie ne saute
pas.

**Comment l'observer** : la phrase doit être continue, sans trou. En parallèle, relever la fenêtre
active avant/après :

```bash
xdotool getactivewindow getwindowname     # X11 ; sous Wayland : outil du compositeur (noter lequel)
```

```
PASS/FAIL : ☐ PASS ☐ FAIL      fenêtre active avant : ______________________
fenêtre active après : ______________________   caractères perdus : ____
```

### S8 — push-to-talk global, application au second plan

**Geste** : mettre le focus sur l'éditeur (l'application n'a plus le focus), maintenir
**`Alt+Space`**, parler, relâcher.

**Attendu** : B entend A **uniquement** pendant l'appui ; le relâchement coupe ; aucune frappe
`Alt+Space` ne part dans l'éditeur.

**Comment l'observer** : B écoute ; compter les secondes de son audible et les comparer à la durée
d'appui.

```
PASS/FAIL : ☐ PASS ☐ FAIL      durée d'appui : ____ s   son audible chez B : ____ s
observé : __________________________________________________________________
```

### S9 — l'overlay reste au-dessus d'une application plein écran

**Geste** : lancer une vidéo en plein écran (par ex. `mpv --fullscreen <fichier>`, ou un jeu) puis
faire parler B.

**Attendu** : l'overlay et son halo restent **visibles au-dessus** du plein écran.

**Comment l'observer** : capture d'écran pendant le plein écran. Noter si le compositeur est X11 ou
Wayland : sous Wayland, un client ne peut pas s'élever au-dessus d'un plein écran sans protocole
dédié — dans ce cas écrire `N/A (Wayland)` et le motif, ce n'est pas un échec du code.

```
PASS/FAIL : ☐ PASS ☐ FAIL      serveur graphique : __________  observé : ___________
```

### S10 — aucune requête hors du LAN (observation réseau concrète)

**a) Pendant le repos et pendant un appel**, relever les sockets de l'application :

```bash
ss -tunp | grep -i -e electron -e concord
ss -tunp | grep -v -e '127.0.0.1' -e '\[::1\]'
```

**Attendu** : uniquement des adresses du LAN `192.168.x.x` / `10.x.x.x` (ou lien-local `fe80::`),
et les ports attendus côté code : **mDNS 5353/udp** (découverte, `src/main/discovery-bridge.ts:11`)
et **signalisation 47821/tcp** (repli 47822→47830, `src/shell/settings-schema.ts:27-28`).
Toute ligne vers une adresse publique, `:443`, `:80` ou `:53` est un **échec**.

> Note relevée en statique : `BEACON_PORT = 47820` est déclaré (`src/shell/settings-schema.ts:30`)
> mais n'est référencé nulle part ailleurs dans `src/` (grep). Ne pas s'étonner de ne pas le voir
> dans `ss`.

**b) Capture réseau** (60 s, repos puis appel) :

```bash
sudo tcpdump -ni <iface> -c 2000 'not net <LAN>/<préfixe>'      # attendu : 0 paquet
sudo tcpdump -ni <iface> 'udp port 53 or tcp port 53'           # attendu : 0 paquet (aucun DNS)
sudo tcpdump -ni <iface> 'tcp port 443 or udp port 443'         # attendu : 0 paquet
```

**c) Hors ligne** : couper le WAN du routeur, garder le LAN, relancer `npm start`, refaire un appel
A↔B : il doit fonctionner **sans Internet**.

```
PASS/FAIL : ☐ PASS ☐ FAIL      paquets hors LAN : ____   DNS : ____   :443 : ____
ss (copier/coller) : ______________________________________________________
observé : __________________________________________________________________
```

### S11 — transparence et opacité

**Geste** : régler l'opacité de l'overlay dans les réglages, du minimum au maximum.

**Attendu (bornes mesurées dans le schéma, à confirmer visuellement)** : l'overlay est translucide,
jamais noir opaque, et l'opacité suit le réglage.

```
PASS/FAIL : ☐ PASS ☐ FAIL      observé : ____________________________________________
```

### S12 — désactiver / réactiver l'overlay

**Geste** : couper l'interrupteur d'overlay dans les réglages (noter le libellé exact), puis le
remettre.

**Attendu** : la fenêtre disparaît immédiatement (plus aucune zone cliquable), puis revient à sa
position, sans redémarrer l'application.

> Mesuré en test unitaire : `enabled:false` ⇒ 1 `hide()`, géométrie `null`, 0 scrutation ensuite
> (`tests/overlay-controller.test.ts`, « overlay désactivée »). Ici on vérifie **le pixel**.

```
PASS/FAIL : ☐ PASS ☐ FAIL      observé : ____________________________________________
```

### S13 — pas de vol de focus à l'apparition, pas d'entrée dans la barre des tâches

**Geste** : lancer l'application alors que l'éditeur a le focus ; puis regarder la barre des tâches /
le sélecteur Alt+Tab.

**Attendu** : le focus reste sur l'éditeur ; l'overlay n'apparaît **pas** dans Alt+Tab ni dans la
barre des tâches (`skipTaskbar: true`, mesuré dans les options capturées par le test unitaire).

```
PASS/FAIL : ☐ PASS ☐ FAIL      observé : ____________________________________________
```

---

## 4. Packaging (`npm run dist`)

### D1 — Linux (poste A)

```bash
npm run dist                       # = npm run build && electron-builder
echo "dist exit=$?"
ls -l release
```

Attendu (cibles déclarées `electron-builder.yml:41-46`) : un `.AppImage` x64 et un `.deb` x64 dans
`release/`.

**Points à surveiller, relevés en statique et NON vérifiés par une construction** :

- `electron-builder.yml:76` déclare `appImage.license: LICENCE`, or **aucun fichier `LICENCE` n'existe
  à la racine** (`ls LICENCE` → `No such file or directory`, 2026-10-31). Recopiez le message exact
  d'electron-builder : s'il échoue, c'est un défaut à corriger (fichier hors du périmètre de cette
  étape).
- `buildResources: build` (`electron-builder.yml:20`) pointe vers un dossier `build/` **absent** :
  l'icône sera celle d'Electron par défaut (avertissement, pas une erreur).
- `release/` n'existe pas dans le dépôt : **aucune construction n'a jamais abouti ici**.

Vérifications sur les artefacts :

```bash
ls release | grep -i -e latest -e update      # attendu : AUCUNE ligne (aucun canal de mise à jour)
chmod +x release/concord-*.AppImage && ./release/concord-*.AppImage
sudo dpkg -i release/concord-*.deb && concord
```

Attendu : l'AppImage et le paquet installé démarrent **hors ligne** et refont S1, S5, S6, S10.

```
PASS/FAIL : ☐ PASS ☐ FAIL      artefacts : __________________________________________
fichiers latest*/update* : ____   observé : ________________________________
```

### D2 — Windows (machine Windows x64)

```bash
npm ci            # même réserve que P1 (aucun package-lock.json)
npm run dist
dir release
```

Attendu (cible déclarée `electron-builder.yml:79-83`) : un installeur NSIS x64. **Signature non
exigée** (`forceCodeSigning: false`, ligne 84) : la construction ne doit pas échouer faute de
certificat ; Windows SmartScreen affichera un avertissement, c'est attendu et à noter.

```bash
dir release | findstr /I "latest update"     # attendu : aucune ligne
```

Puis installer, lancer hors ligne, refaire S1, S5, S6, S8, S10.

```
PASS/FAIL : ☐ PASS ☐ FAIL      artefact : ______________________  observé : ______
```

### D3 — reproductibilité (facultatif mais chiffrable)

```bash
sha256sum release/*.AppImage release/*.deb       # Linux
```

Refaire `npm run dist` une seconde fois et comparer : noter si les empreintes sont identiques ou non
(les horodatages internes peuvent différer — c'est une observation, pas un critère de réussite ici).

```
empreinte 1 : ______________________________  empreinte 2 : ______________________________
identiques : ☐ oui ☐ non        observé : ______________________________________
```

---

## 5. Tableau de résultats (à remplir — aucune case pré-remplie)

| ID  | Item                                              | PASS/FAIL | Observé (heure, message, capture) |
| --- | ------------------------------------------------- | --------- | --------------------------------- |
| S1  | démarrage hors ligne, overlay sans focus          |           |                                   |
| S2  | halo visible quand B parle, pas sur A             |           |                                   |
| S3  | aucun halo résiduel au silence                    |           |                                   |
| S4  | avatars sur une rangée, pas de coupure            |           |                                   |
| S5  | clic traverse hors avatars/poignée                |           |                                   |
| S6  | glisser + position conservée au redémarrage       |           |                                   |
| S7  | aucun vol de focus (phrase continue)              |           |                                   |
| S8  | push-to-talk global, app au second plan           |           |                                   |
| S9  | overlay au-dessus du plein écran                  |           |                                   |
| S10 | 0 paquet hors LAN, 0 DNS, 0 :443 ; hors ligne OK  |           |                                   |
| S11 | transparence et opacité réglable                  |           |                                   |
| S12 | désactiver / réactiver l'overlay                  |           |                                   |
| S13 | pas de focus à l'apparition, pas d'Alt+Tab        |           |                                   |
| P1  | `npm ci` (ou repli `npm install`)                 |           |                                   |
| P2  | `npm run build` → 4 fichiers                      |           |                                   |
| P3  | `npx tsc --noEmit`                                |           |                                   |
| D1  | `npm run dist` Linux → AppImage + deb             |           |                                   |
| D2  | `npm run dist` Windows → NSIS                     |           |                                   |
| D3  | empreintes de deux constructions                  |           |                                   |

**Ce que ce tableau ne prouvera toujours pas** : la latence audio perçue, la qualité du halo à
l'œil, le comportement sous un compositeur non testé. Ces points restent hors périmètre et doivent
être nommés comme tels, jamais cochés.

---

## 6. Ce qui est déjà mesuré, et où (pour ne pas le re-mesurer à la main)

| Propriété                                              | Où c'est mesuré                                    | Chiffre |
| ------------------------------------------------------ | -------------------------------------------------- | ------- |
| click-through : 8 franchissements ⇒ 8 appels            | `tests/overlay-controller.test.ts`                 | 8 / 8   |
| balayage 21 points (1 px) ⇒ 1 appel                     | idem                                               | 1       |
| dédoublonnage : 5 scrutations même zone ⇒ 0 appel      | idem                                               | 0       |
| focus : `focusable:false`, `acceptFirstMouse:false`     | idem (options capturées)                           | 2 / 2   |
| `showInactive` = 1, `show` = 0                          | idem                                               | 1 / 0   |
| always-on-top : 1 `('screen-saver')`, 1 `(visibleOnFullScreen)` | idem                                       | 1 / 1   |
| glisser : `{300,200}` conservé, largeur 128 → 200 DIP   | idem                                               | 300/200 |
| hors écran : borné à `{1792,1036}`                      | idem                                               | 1792/1036 |
| démontage : `destroy()` + 10 ticks ⇒ 0 scrutation       | idem                                               | 0       |
| `enabled:false` : 1 `hide()`, géométrie `null`, 0 scrutation | idem                                          | 1/0/0   |
| suite complète                                          | `npm test`                                         | 26 fichiers, 664 tests, 664 pass, 0 fail, exit 0 |
| typage                                                  | `npx tsc --noEmit -p tsconfig.json`                 | exit 0  |

Tout ce qui n'est pas dans ce tableau n'est **pas** mesuré et doit être observé ci-dessus.
