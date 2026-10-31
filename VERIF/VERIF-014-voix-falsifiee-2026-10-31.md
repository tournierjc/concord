# VERIF-014 — harnais de falsification de la voix (T14c)

**Banc** · 2026-10-31T01:29Z · canon `/work/lan-voice` · protocole : SPEC-005 §3
Statut : **harnais écrit, packagé, parsé — NON EXÉCUTÉ. Les 6 items produit sont NON MESURÉS.**

> ## ⚠️ PLAN B — ET RIEN DE PLUS
> `src/engine/rtc/media-plane.ts` **n'existe pas** (mesuré, §2) : le plan A est impossible.
> Le plan B a été monté (page + deux `RTCPeerConnection` nus), mais **il n'a pas pu tourner** : aucune
> pile Chromium ne démarre dans cet environnement, **bibliothèques système absentes** (mesuré sur le
> binaire Electron réellement présent, §3).
> **Conséquence à lire telle quelle : les items (a) à (f) sont NON MESURÉS. Ce document ne prouve NI
> que l'application parle, NI que le harnais fonctionne à l'exécution. Il prouve seulement l'état des
> fichiers, le hash de l'artefact certifié, et la cause exacte du blocage.**

Pas de tableau de scores global : ci-dessous des faits datés, chacun avec la commande qui le produit.

---

## 1. Le hash certifié est retrouvé — l'écart d'ordonnancement est clos

```
$ sha256sum /work/lan-voice/dist/main/index.js
c5d37f07e4ecca8b2ac933785d3074a681d204d5fabfc651690a5f29bf75f118  /work/lan-voice/dist/main/index.js

$ stat -c '%n %s %y' /work/lan-voice/dist/main/index.js
/work/lan-voice/dist/main/index.js 19497 2026-10-31 02:26:01.082767990 +0100
```

- sha256 **identique au caractère près** à celui que Régie a certifié (`c5d37f07…bf75f118`) ;
- 19 497 o, identique ;
- mtime `02:26:01.082 +0100` = **01:26:01.083Z**, c'est-à-dire *dans* la fenêtre de build déclarée
  (01:26:00→01:26:01Z).

**Conclusion : l'artefact que j'audite est bien celui qui a été certifié.** Mon signalement d'un
artefact 01:18:27Z non certifié (VERIF-013) portait sur une génération antérieure ; il est périmé et
je le retire. Le hash fait foi, pas le mtime.

---

## 2. Plan A impossible : il n'y a pas de module média dans le produit

```
$ find /work/lan-voice/src -name "*media*"
(aucune sortie)

$ ls -la /work/lan-voice/src/engine/rtc/
-rw-r--r-- 1 node node 3778 Oct 31 00:15 ice-filter
-rw-r--r-- 1 node node 7167 Oct 31 02:04 ice-filter.ts

$ grep -rn "RTCPeerConnection" /work/lan-voice/src
src/engine/README.md:47:   ... pas de dns.lookup, pas de RTCPeerConnection,
src/engine/README.md:158:  ... maillage WebRTC réel (deux instances en loopback, RTCPeerConnection de bout en
→ 2 occurrences, toutes deux dans de la **prose**, 0 dans du code .ts

$ grep -rlc "RTCPeerConnection" /work/lan-voice/dist
(exit 1 : aucune correspondance)
```

**Fait mesuré, non contournable** : `src/engine/rtc/media-plane.ts` n'existe pas à 01:29Z ; le seul
code WebRTC du dépôt est `ice-filter.ts`, un **parseur de chaînes** (aucun `RTCPeerConnection`, aucun
`getUserMedia`, aucun `getStats` — confirmé par les exports : `isLanCandidate`, `filterLanCandidates`).
Le `dist/` livré n'en contient pas davantage.

Donc : **le produit n'a pas de plan média à falsifier ce tour.** Toute mesure (a)-(f) porterait sur mes
deux pairs nus, c'est-à-dire sur le harnais. C'est exactement le cas « plan B » prévu par la mission.

---

## 3. Pourquoi rien ne peut tourner ici — cause mesurée, pas « plafond de méthode »

### 3.1 Le binaire Electron est là (ta prémisse est périmée)

```
$ ls -la /work/lan-voice/node_modules/electron/dist
drwxr-xr-x 4 node node 4096 Oct 31 02:18 .
-rwxr-xr-x 1 node node 57024 Oct 31 02:18 chrome-sandbox
-rw-r--r-- 1 node node 226946 Oct ... (…)
$ du -sh /work/lan-voice/node_modules/electron/dist
262M    /work/lan-voice/node_modules/electron/dist
$ cat /work/lan-voice/node_modules/electron/path.txt
electron
```

Le binaire a été téléchargé à `02:18 +0100` (= 01:18Z), **après** ta mesure de 01:26Z qui le disait
absent. `node_modules/electron/dist` existe, 262 Mo, sur **aarch64**.

### 3.2 …mais il ne peut pas se charger : bibliothèques système manquantes

```
$ /work/lan-voice/node_modules/electron/dist/electron --version
/work/lan-voice/node_modules/electron/dist/electron: error while loading shared libraries:
libgobject-2.0.so.0: cannot open shared object file: No such file or directory
(exit 127)

$ ldd /work/lan-voice/node_modules/electron/dist/electron
libffmpeg.so => /work/lan-voice/node_modules/electron/dist/libffmpeg.so
libdl.so.2 => /lib/aarch64-linux-gnu/libdl.so.2
libpthread.so.0 => /lib/aarch64-linux-gnu/libpthread.so.0
libgobject-2.0.so.0 => not found
libglib-2.0.so.0 => not found
libgio-2.0.so.0 => not found
libnss3.so => not found
… (sortie tronquée par mon outil après la 8e ligne ; au moins ces 4 sont absentes)
```

C'est le **niveau système**, pas mes droits et pas le projet : il n'y a ni glib/GTK, ni NSS, ni X11,
ni ALSA dans cette image. Un Chromium Playwright a besoin du **même** jeu (`libnss3`, `libnspr4`,
`libgbm1`, `libxkbcommon0`, `libasound2`, `libatk*`, `libcups2`, `libdrm2`, `libpango*`, `libcairo2`…),
qu'il ne fournit pas lui-même : il téléchargerait 150 Mo puis échouerait au lancement avec la même
erreur de chargement. **Cette dernière phrase est une prédiction, pas une mesure** — je ne peux pas
l'installer pour la vérifier (§3.3). Ce qui est mesuré, c'est l'absence des bibliothèques.

### 3.3 Ce qui m'est refusé, nommé pour ce que c'est

| commande | résultat exact |
|---|---|
| `node -v`, `npm --version`, `npx ...`, `bash --version`, `python3 --version`, `date -u` | `Error: Command not in auto-approve list — requires approval` (pas d'approbation possible en run non surveillé) |
| `ls /usr/bin`, `ls /usr/lib`, `ls /lib/aarch64-linux-gnu`, `/usr/local/bin/node` | `No permission to access … Use approve_scope tool` |
| `find … node_modules -name "*playwright*"` | aucune sortie → **Playwright n'est pas installé**, et absent de `package.json` (`grep -n playwright package.json` : rien) |
| `ls ~/.cache/ms-playwright` | `No permission to access` (je ne peux même pas constater s'il existe) |

Ce n'est donc ni « le projet est inmesurable », ni « mes droits » seuls : c'est **les deux, distinctement**.
Sans `node`/`npm`, je ne peux pas installer Playwright ; sans les bibliothèques système, un Playwright
installé ne lancerait pas ; et dans tous les cas il n'y a **aucun module média produit** à mesurer (§2).

### 3.4 Ce qui marche quand même dans mes droits (et que j'ai utilisé)

- `sha256sum`, `stat`, `ldd`, `ls`, `find`, `grep`, `cat` : oui.
- **`esbuild` 0.21.5 tourne** — c'est un binaire Go natif, il n'a pas besoin de `node` :
  `/work/lan-voice/node_modules/@esbuild/linux-arm64/bin/esbuild`. C'est par lui que j'ai validé les
  étapes « bundle » et « parse » du harnais.

---

## 4. Le harnais livré (prêt à tourner, non tourné)

Tous dans `/work/lan-voice/.verif-t14/` :

| fichier | rôle |
|---|---|
| `verif014.page.js` (15 386 o) | le harnais : plan A si `window.MP.createMediaPlane` existe, sinon plan B (deux `RTCPeerConnection` nus). Mesure (a)-(f), gardes réseau (e), sortie `window.__VERIF014__` |
| `verif014.html` (1 290 o) | page locale, charge les bundles optionnels (`media-plane.js`, `ice-filter.bundle.js`) puis le harnais |
| `driver.mjs` (2 189 o) | pilote Playwright headless : flags, attente du résultat, JSON sur stdout + `result.json`, code de sortie 0/1/2 |
| `run-verif-014.sh` (1 790 o) | rejoue tout : hash → `npm i -D playwright` → `playwright install chromium` → bundles esbuild → driver |
| `ice-filter.bundle.js` (4 633 o) | **bundle réel produit**, fait ce tour (§5) |

Ce que chaque item calcule, dans le harnais :

- **(a)** `connectMs` = temps entre `performance.now()` avant `createOffer()` et l'instant où **les deux**
  `connectionState === 'connected'` ; timeout dur 10 000 ms → PASS si `0 < connectMs < 10000`.
- **(b)** chaque candidat local est parsé (`type` = champ après `typ`, `address` = 5e champ) et classé ;
  PASS si `total>0 && host===total && hostLan===total && srflx===0 && relay===0` (mDNS `*.local` compté LAN,
  conforme à `ice-filter.ts`).
- **(c)** `getStats()` sur le récepteur à t = 0,1,2,3,4,5 s ; PASS si `bytesReceived(5s) > 0` **et**
  croissance monotone.
- **(d)** `AudioContext` + `AnalyserNode` sur le flux distant reçu, RMS crête sur 2 s (40 échantillons à 50 ms) ;
  PASS si `> 0.001`. En plan A, c'est `pb.level()` du produit qui est lu à la place.
- **(e)** `fetch`, `XMLHttpRequest.open`, `WebSocket` sont **remplacés** : toute destination non
  LAN/localhost/`.local` est enregistrée puis **refusée par exception** ; on ajoute les
  `performance.getEntriesByType('resource')`, et `getConfiguration().iceServers.length === 0` est
  vérifié ; PASS si le total hors LAN = 0.
- **(f)** `rttMs` = `candidate-pair.state==='succeeded'.currentRoundTripTime * 1000`, **rapporté, non jugé**.

Lancement (une seule commande, depuis un compte qui a `node`/`npm` **et** les bibliothèques système) :

```
cd /work/lan-voice && bash .verif-t14/run-verif-014.sh
```

Équivalent manuel, commandes exactes :

```
npm i -D playwright
npx playwright install chromium            # --with-deps si root dispo (installe les .so manquantes)
npx esbuild src/engine/rtc/media-plane.ts --bundle --format=iife --global-name=MP --outfile=.verif-t14/media-plane.js
npx esbuild src/engine/rtc/ice-filter.ts  --bundle --format=iife --global-name=ICF --outfile=.verif-t14/ice-filter.bundle.js
node .verif-t14/driver.mjs
```

Flags passés au navigateur (`driver.mjs`) : `--use-fake-device-for-media-stream`,
`--use-fake-ui-for-media-stream`, `--autoplay-policy=no-user-gesture-required`, `--no-sandbox`,
`--disable-dev-shm-usage`, et `--disable-features=WebRtcHideLocalIpsWithMdns` — ce dernier **change le
comportement par défaut** de Chromium (qui obfusque les IP locales en `*.local`) : il est là pour que (b)
mesure des adresses, pas des pseudonymes. À discuter : en production, l'obfuscation mDNS est plus stricte
et reste LAN.

---

## 5. Ce qui a réellement tourné ce tour (chiffres et horodatages)

| mesure | valeur | commande |
|---|---|---|
| version esbuild | **0.21.5** | `node_modules/@esbuild/linux-arm64/bin/esbuild --version` |
| bundle réel `ice-filter.ts` → IIFE `ICF` | **4 633 o**, 2026-10-31 02:28:32.56 +0100 (= 01:28:32.56Z) | `… esbuild src/engine/rtc/ice-filter.ts --bundle --format=iife --global-name=ICF --outfile=.verif-t14/ice-filter.bundle.js` |
| sha256 de ce bundle | `71124d783af3d34e48566ec5b1fa6a99dc21c66596407a37de40e1df66900b35` | `sha256sum .verif-t14/ice-filter.bundle.js` |
| parse du harnais `verif014.page.js` | **0 erreur**, sortie 14 824 o à 02:29:16.07 +0100 | `… esbuild .verif-t14/verif014.page.js --target=chrome120 --outfile=.verif-t14/_parse_check.js` |
| parse du pilote `driver.mjs` | **0 erreur** | `… esbuild .verif-t14/driver.mjs --format=esm --platform=node --target=node22 --outfile=.verif-t14/_parse_driver.js` |
| `RTCPeerConnection` dans `dist/` | **0** | `grep -rlc RTCPeerConnection dist` (exit 1) |
| `media-plane.ts` | **absent** | `find src -name "*media*"` (vide) |
| `node_modules/electron/dist` | **présent, 262 Mo**, 02:18 +0100 | `du -sh …` |
| `electron --version` | **EXIT=127**, `libgobject-2.0.so.0: cannot open shared object file` | commande en §3.2 |

Ce que cela vaut : **le harnais est syntaxiquement valide et son étape de bundling est exercée sur un
module réel du dépôt.** Cela ne vaut **pas** validation à l'exécution : ni la signalisation croisée, ni
`getStats`, ni le niveau audio n'ont été exécutés une seule fois.

---

## 6. Les 6 items — état, et la commande qui produirait le chiffre

| # | item | état | chiffre disponible | producteur |
|---|---|---|---|---|
| a | `connectionState === 'connected'` sous 10 s | **NON MESURÉ** | — | `driver.mjs` → `harness.numbers.connectMs` |
| b | 100 % ICE `host` + privé/loopback, `srflx=0`, `relay=0` | **NON MESURÉ** | — | `harness.numbers.candidates` |
| c | `bytesReceived > 0` et croissant sur 5 s | **NON MESURÉ** | — | `harness.numbers.bytesReceivedSamples` |
| d | `level() > 0.001` côté réception | **NON MESURÉ** | — | `harness.numbers.levelPeak` |
| e | 0 événement réseau hors LAN | **NON MESURÉ** | — | `harness.numbers.networkEventsOutsideLan` |
| f | `rttMs` documenté, non jugé | **NON MESURÉ** | — | `harness.numbers.rttMs` |

Aucun de ces six champs n'existe aujourd'hui : le fichier `result.json` n'a pas été produit.
Je ne mets ni PASS ni FAIL là où je n'ai pas la mesure — un PASS inventé serait pire qu'un trou.

---

## 7. Limites explicites (à ne pas effacer en reprenant ce rapport)

1. **Chromium dans une page de vérification ≠ la fenêtre Electron finale.** Pas de `preload`, pas
   d'IPC, pas de sélection de périphérique par `device.ts`, pas de CSP de production. Une voix qui
   passe ici ne prouve pas que l'application embarque le bon chemin de code : elle prouve que la
   plateforme sait faire du WebRTC en loopback dans cet environnement.
2. **Packaging non mesuré** : ni `electron-builder`, ni l'installateur, ni le binaire final.
3. **Le plan B ne mesure pas le produit.** Si `media-plane.ts` n'est pas bundlé, `verif014.page.js`
   écrit lui-même `errors: "PLAN B … produit NON MESURÉ"` et lève `productMeasured: false` : le
   rapport ne peut pas se tromper de cible par accident.
4. **(e) n'est pas une capture de trafic.** Je mesure les API JS (`fetch`/XHR/WebSocket, refus dur) et
   les candidats ICE — pas les sockets du processus. Un appel sortant fait hors de ces API (process
   principal Node, mDNS, `dns.lookup`) échapperait à (e). Pour l'étanchéité au niveau socket, il faut
   `ss`/`tcpdump`/`lsof` sur le processus, ce que je n'ai pas les droits d'exécuter ici.
5. **Faux périphérique** : `--use-fake-device-for-media-stream` produit une tonalité synthétique. Le
   niveau (d) prouve un chemin audio non silencieux, pas l'intelligibilité d'une voix humaine.
6. **Mesure réseau en loopback** : deux pairs dans le **même** processus Chromium. Cela ne prouve rien
   du cas « troisième machine sur le LAN » (perte de 5 %, latence réelle).

---

## 8. Ce qui débloque la mesure (deux chemins, aucun ne passe par moi)

1. **Installer les bibliothèques système (root requis)** puis relancer `run-verif-014.sh` :
   `apt-get install -y libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0
   libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2
   libgobject-2.0-0 libglib2.0-0` (ou `npx playwright install --with-deps chromium`).
   Sans cela, `npm i -D playwright` réussira et `playwright install chromium` téléchargera, puis le
   lancement échouera — c'est ma prédiction, à confirmer par toi.
2. **M'accorder `node`/`npm`/`npx`** et l'accès à `~/.cache/ms-playwright` : je ferai les étapes 1-3
   moi-même. Cela ne suffira pas sans (1) : les bibliothèques manquent au niveau système.
3. **Pour le plan A, il manque le code** : `src/engine/rtc/media-plane.ts` (Carillon). Dès qu'il existe,
   `run-verif-014.sh` le bundle automatiquement et bascule en plan A — les 6 items deviennent alors
   des mesures **produit**, sans que je change une ligne de harnais.

---

### Reproductibilité, en trois commandes

```
sha256sum /work/lan-voice/dist/main/index.js
ldd /work/lan-voice/node_modules/electron/dist/electron
find /work/lan-voice/src -name "*media*"
```

Elles suffisent à refaire, de mémoire de fichier, les trois faits qui portent tout ce rapport :
l'artefact certifié est bien celui-ci, aucune pile Chromium ne peut démarrer ici, et le produit n'a
pas de plan média à falsifier.
