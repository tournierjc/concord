# VERIF-000 — État du chantier « Desktop LAN » (phase 1)

**Rapport de vérification daté** — Banc (desk-qa)
Rédigé : **2026-10-30T23:55+01:00** — mesures exécutées entre **23:46:16** et **23:54:30** (heure locale du poste, `date -Is`).
Arbre mesuré : `/home/node/.mercury/bots/_shared/lan-voice` — **pas de dépôt git** (`git status` → `fatal: not a git repository`), donc aucun commit de référence : toutes les mesures sont horodatées, aucune n'est reproductible à l'identique.
Référence : `SPECS/SPEC-001-conception.md` v1.0 (2026-02-14).

> **Règle tenue dans ce rapport** : rien n'est écrit « vérifié » sans avoir été exécuté. Chaque chiffre vient d'une commande citée.
> Là où je n'ai pas pu mesurer, c'est écrit **NON VÉRIFIÉ** avec la raison — y compris quand la raison est « le code n'existe pas encore ».

---

## 0. En une ligne

Le harnais de vérification est **écrit, exécutable et lancé** ; l'application, à l'instant de la mesure, **n'existe presque pas** (`src/` = 2 fichiers, pas de `package.json`, pas de `src/engine/`, pas de build). Conséquence directe : **1 PASS**, **1 FAIL non imputable à l'application**, **2 SKIP motivés**, et **17 critères d'acceptation sur 20 NON VÉRIFIÉS** faute de code à mesurer ou de matériel.

| Contrôle | Résultat | Chiffre |
|---|---|---|
| C1 — aucune référence hors LAN (statique) | **PASS** | 8 fichiers scannés, 12 occurrences brutes, **0 hors LAN** |
| C2 — dépendances / `publish: null` | **SKIP** | `package.json` absent à 23:53:35 (volet electron-builder : OK) |
| C3 — sockets hors LAN pendant 20 s (dynamique) | **FAIL** | 7 adresses hors LAN — **aucune imputable à l'app** (l'app n'a jamais tourné) |
| C4 — tests unitaires (vitest) | **SKIP** | `node_modules` absent → vitest non exécuté |

---

## 1. Le harnais livré

Tous les fichiers sont dans `VERIF/` et `tests/`, **exécutables** (`chmod +x` vérifié).

| Fichier | Rôle | Usage | Codes retour |
|---|---|---|---|
| `VERIF/check-no-external.sh` | Statique : grep du code livré (URL, WS, STUN/TURN, domaines publics, CDN, télémétrie). Sort chaque `fichier:ligne:contenu`, classé HORS-LAN / LOCAL / MODELE. | `./check-no-external.sh [RACINE]` | 0 = propre, 1 = occurrence hors LAN |
| `VERIF/check-deps.sh` | `package.json` (dépendances interdites), `node_modules/`, `publish: null` (package.json **et** electron-builder.yml) + **aucun champ `build`** dans `package.json` (AD-28 : sinon le yml est ignoré, cf. VERIF 030), `src/` (autoUpdater). | `./check-deps.sh [RACINE]` | 0 = PASS/SKIP, 1 = FAIL |
| `VERIF/measure-traffic.sh` | Dynamique : `ss -unp` / `ss -tnp` (repli `/proc/net/*`), N secondes, filtre des adresses non-RFC1918/loopback/link-local/multicast, attribution des processus, classe chaque adresse. Équivalents **macOS `lsof -i -n -P`** et **Windows `netstat -ano`** documentés en tête du script. | `./measure-traffic.sh [-d s] [-i s] [-p PID] [-o log]` | 0 = propre, 1 = adresse hors LAN |
| `VERIF/run-all.sh` | Lance C1→C4, agrège en tableau PASS/FAIL/SKIP, écrit chaque sortie brute dans `VERIF/raw/run-<horodatage>/`. Un SKIP n'est jamais compté comme un succès. | `./run-all.sh [-d s]` | 0 = aucun FAIL, 1 = au moins un FAIL |
| `tests/ice-filter.test.ts` | Test vitest du filtre de candidats ICE : `isLanCandidate()` doit **rejeter** `srflx`, `relay`, `prflx`, et toute adresse publique (8.8.8.8, 172.32.0.1, 100.64.0.1…), et **accepter** 192.168/16, 10/8, 172.16/12, 169.254/16, 127.0.0.1, en composant 1 et 2, TCP et UDP. Écrit **avant** le module, contre la signature attendue (`isLanCandidate`, `filterLanCandidates` + alias tolérés). | `npx vitest run tests/ice-filter.test.ts` | — |

**Limites que je déclare moi-même :**
- C1 est statique : il prouve l'absence de *référence* hors LAN dans le code, **pas** l'absence de trafic.
- C3 est un **échantillonnage** (une socket fermée entre deux échantillons n'est jamais vue). Il ne remplace pas `tcpdump`. Et sans `-p <PID>`, il mesure **toute la machine**.
- Le test ICE n'a **pas été exécuté** : voir §3 (CA4).

---

## 2. Sorties brutes (copiées telles quelles)

### 2.1 Commande de référence

```
$ VERIF/run-all.sh -d 20
=== run-all.sh — 2026-10-30T23:53:35+01:00 ===
RACINE : /home/node/.mercury/bots/_shared/lan-voice
sorties brutes : /home/node/.mercury/bots/_shared/lan-voice/VERIF/raw/run-20261030T235335
```
Lignes machines produites par cette exécution (reprises telles quelles des logs C1→C4) :

```
CHECK_NO_EXTERNAL RESULT=PASS files=8 hits=12 horslan=0 local=7 modele=5
CHECK_DEPS RESULT=SKIP failures=0 skips=2 reason=package.json-absent-ou-illisible electron_builder=1
CHECK_TRAFFIC RESULT=FAIL samples=4 external=7
C4 SKIP : node_modules absent, vitest non exécuté
RUN_ALL RESULT=FAIL pass=1 fail=1 skip=2
```

### 2.2 C1 — `check-no-external.sh` (2026-10-30T23:53:35+01:00)

```
=== check-no-external.sh — 2026-10-30T23:53:35+01:00 ===
RACINE   : /home/node/.mercury/bots/_shared/lan-voice
motifs   : 29 règles ERE (voir en-tête)
exempt.  : LOCAL  = (https?|wss?)://(127\.[0-9.]+|localhost|\[::1\]|10\.[0-9]|192\.168\.[0-9xX]|172\.(1[6-9]|2[0-9]|3[01])\.[0-9])
           MODELE = (://\$\{)|(://\*)|(\*://\*/\*)
fichiers : 8 fichier(s) de code à scanner
--- occurrences brutes (12) : HORS-LAN=0  LOCAL=7  MODELE=5 ---
[MODELE] hôte dynamique / motif de filtre — non décidable, A RELIRE :
  .../src/main/net-guard.ts:68:  const filter = { urls: ['*://*/*', 'ws://*/*', 'wss://*/*', 'http://*/*', 'https://*/*'] };
  .../src/main/csp.ts:12: *    rejoint). `ws://*:*` n'est JAMAIS utilisé.
  .../src/main/csp.ts:76:    sources.add(`ws://${host}:*`);
  .../src/main/csp.ts:83:    sources.add(`ws://${clean}:*`);
  .../src/main/csp.ts:84:    sources.add(`ws://${clean.includes(':') ? `[${clean}]` : clean}:*`);
[LOCAL] loopback / RFC1918 littéral — pas un départ hors LAN :
  .../vite.config.ts:11: *   que par le serveur de dev http://127.0.0.1:5173.
  .../vite.config.ts:27:  "connect-src 'self' ws://127.0.0.1:* ws://localhost:* ws://[::1]:*",
  .../src/main/net-guard.ts:22:  /** Origine du serveur de dev (ex. http://127.0.0.1:5173), null en production. */
  .../src/main/csp.ts:71:    'ws://127.0.0.1:*',
  .../src/main/csp.ts:72:    'ws://localhost:*',
  .../src/main/csp.ts:73:    'ws://[::1]:*',
  .../index.html:9:      bloquerait donc ws://192.168.x.y:* en production. La CSP est appliquée par en-tête sur la
INFO tests/ : 0 ligne(s) URL/fetch/WebSocket (périmètre exclu du verdict)
--- résumé ---
fichiers scannés=8 occurrences brutes=12  hors-LAN=0 local=7 modele=5
CHECK_NO_EXTERNAL RESULT=PASS files=8 hits=12 horslan=0 local=7 modele=5
```

**Lecture honnête de ce PASS :**
- Les 7 lignes LOCAL sont du loopback (serveur de dev Vite) ou un blanc d'adresse dans une doc — aucun départ hors LAN.
- Les 5 lignes MODELE ne sont **pas** blanches : `csp.ts:76/83/84` construit `ws://${host}:*` **à partir d'un hôte dynamique**. Un CSP n'émet pas de départ, mais il **autorise** : si `host` venait d'une source non filtrée, la CSP ouvrirait la porte. **À relire en phase 2** avec `src/main/csp.ts` + `net-guard.ts` sous les yeux. `net-guard.ts:68` (`*://*/*`) est au contraire un **filtre de blocage**, usage correct.
- 8 fichiers scannés seulement : c'est le reflet de l'arbre, pas de la complétude du contrôle.

### 2.3 C2 — `check-deps.sh` (2026-10-30T23:53:35+01:00)

```
=== check-deps.sh — 2026-10-30T23:53:35+01:00 ===
RACINE : /home/node/.mercury/bots/_shared/lan-voice
  [SKIP] package.json absent (/home/node/.mercury/bots/_shared/lan-voice/package.json) — contrôle des dépendances impossible
--- 3bis. electron-builder.yml : publish == null ---
  [OK]   electron-builder.yml : publish: null présent
--- 2. paquets réellement installés (node_modules) ---
  [SKIP] node_modules absent : aucune dépendance installée, contrôle différé (relancer après npm install)
--- 4. code source : autoUpdater / electron-updater ---
  [OK]   aucune occurrence d'auto-update dans src/
--- résumé ---
échecs=0 skips=2 package.json_jugé=0 electron-builder_jugé=1
CHECK_DEPS RESULT=SKIP failures=0 skips=2 reason=package.json-absent-ou-illisible electron_builder=1
```
`package.json` existait à **23:46** (913 octets), il n'existait plus à **23:48** (réécriture de l'arbre par un autre équipier), il était **toujours absent à 23:53:52**. Le volet « dépendances » n'a donc pas pu être jugé : **SKIP, pas PASS**.

### 2.4 C3 — `measure-traffic.sh` (2026-10-30T23:53:35+01:00, 20 s, 4 échantillons)

```
=== measure-traffic.sh — 2026-10-30T23:53:35+01:00 ===
méthode : proc   durée : 20s   intervalle : 5s   filtre PID : aucun
brut    : .../VERIF/raw/run-20261030T235335/C3-traffic.log
--- attribution : processus lan-voice/electron actifs ---
  (aucun) -> aucune socket mesurée ne peut être imputée à l'application
  échantillon #1 à 2026-10-30T23:53:35+01:00 — 17 socket(s) cumulées
  échantillon #2 à 2026-10-30T23:53:40+01:00 — 35 socket(s) cumulées
  échantillon #3 à 2026-10-30T23:53:45+01:00 — 50 socket(s) cumulées
  échantillon #4 à 2026-10-30T23:53:50+01:00 — 66 socket(s) cumulées
--- adresses observées (9) ---
  EXTERNAL 162.159.133.234
  EXTERNAL 162.159.135.234
  EXTERNAL 162.159.136.234
  EXTERNAL 2606:B740:0001:0020:0000:0000:0000:0102
  EXTERNAL 2606:B740:0049:0000:0000:0000:0000:0109
  EXTERNAL 2A00:DD80:003E:0000:0000:0000:0000:0F2E
  EXTERNAL 3.173.21.63
  LOOPBACK 127.0.0.1
  RFC1918 192.168.1.254
--- adresses HORS LAN (7) ---
  (les 7 EXTERNAL ci-dessus)
CHECK_TRAFFIC RESULT=FAIL samples=4 external=7
```

**Ce que ce FAIL dit, et ce qu'il ne dit pas.** Il dit : *cette machine*, pendant ces 20 secondes, entretenait 7 sockets vers des adresses publiques (Cloudflare 162.159.x / 2606:B740, AWS 3.173.21.63, 2A00:DD80 — infrastructure de l'agent qui exécute ce rapport). Il **ne dit pas** que l'app fait fuiter quoi que ce soit : **aucun processus lan-voice/electron n'était actif** (voir la ligne d'attribution) — l'app n'a même pas de `package.json` à cet instant. Le script fait donc exactement son travail, sur le mauvais sujet. **Pour CA5, la mesure valable est à refaire avec `-p <PID de l'app>`**, app lancée.

`ss` est absent de ce conteneur (`which ss lsof netstat ip` → rien) : la capture est passée par le repli `/proc/net/*`. Le chemin `ss` (celui de la cible Linux de livraison) **n'a donc pas été exercé** — voir §4.

### 2.5 C4 — vitest (2026-10-30T23:53:35+01:00)

```
C4 SKIP : node_modules absent, vitest non exécuté
```
`npx vitest` **sans** `node_modules` irait télécharger vitest sur le registre public : c'est-à-dire exactement le trafic que l'on doit prouver absent. `run-all.sh` refuse donc de le lancer et le déclare SKIP.

---

## 3. Les 20 critères d'acceptation — statut par statut

Légende : **MESURÉ** = chiffre obtenu par une commande citée · **ÉCHEC** = preuve contraire · **NON VÉRIFIÉ** = pas mesuré, raison donnée. Aucune ligne sans chiffre ni raison.

| CA | Critère (SPEC-001) | Statut | Chiffre / preuve, ou raison |
|----|--------------------|--------|------------------------------|
| **CA1** | Deux instances se découvrent (< 5 s mDNS, < 8 s broadcast) | **NON VÉRIFIÉ** | Un seul poste (pas de second hôte joignable), et `src/engine/` **n'existe pas** à 23:53:52 (`ls src` → `main/` seulement : `csp.ts`, `net-guard.ts`). Aucun code de découverte à exercer. |
| **CA2** | Audio bidirectionnel, 0 coupure > 200 ms, MOS ≥ 3.5 | **NON VÉRIFIÉ** | Pas de carte son, pas de second poste, pas de moteur audio. Mesure impossible sans périphérique d'entrée/sortie réel. |
| **CA3** | Débit 28–40 kbps par pair (`getStats()` `outbound-rtp`) | **NON VÉRIFIÉ** | Aucune instance de `RTCPeerConnection` exécutable : pas de build, pas de `node_modules`, pas de `src/engine/`. |
| **CA4** *(bloquant)* | Aucun candidat hors LAN | **NON VÉRIFIÉ** | `tests/ice-filter.test.ts` est **écrit** (11 rejets + 11 acceptations + formes objet / préfixe `a=`), mais **non exécuté** : `src/engine/rtc/ice-filter.ts` absent, `node_modules` absent donc vitest non installable. Le test échouera explicitement (message « module introuvable ») tant que le module n'existe pas — c'est voulu. |
| **CA5** *(bloquant)* | Aucun trafic hors LAN applicatif (`ss -u -p` / `nettop`, 60 s) | **NON VÉRIFIÉ (pour l'app)** — machine : FAIL | Machine : **7 adresses hors LAN / 20 s** (voir §2.4). App : 0 socket mesurable, **aucun processus lan-voice/electron actif** à 23:53:35 → non imputable. À refaire avec `-p <PID>` sur 60 s d'usage complet. |
| **CA6** *(bloquant)* | Démarrage hors ligne (interface `down`) | **NON VÉRIFIÉ** | Rien à démarrer : pas de `package.json`, pas de build, pas de `dist/`. En plus, je n'ai pas la main sur l'interface réseau de cette machine (conteneur). |
| **CA7** | Maillage 8 participants (CPU < 60 % d'un cœur, uplink < 400 kbps) | **NON VÉRIFIÉ** | Huit instances impossibles sans moteur ni build ; une seule machine, aucun pair. |
| **CA8** | Refus du 9ᵉ participant | **NON VÉRIFIÉ** | Aucun salon créable (pas de serveur de signalisation dans l'arbre). |
| **CA9** *(bloquant)* | Mute < 50 ms, `track.enabled === false` | **NON VÉRIFIÉ** | Aucun flux média : `src/renderer/` n'existe pas à 23:53:52. |
| **CA10** | Volume par participant (0 / 50 / 200 %) | **NON VÉRIFIÉ** | Idem : aucun graphe audio, aucun pair. |
| **CA11** | PTT global (`globalShortcut`, < 100 ms) | **NON VÉRIFIÉ** | Pas de session graphique ni de build Electron ; aucun raccourci enregistrable. |
| **CA12** | VAD, seuil −35 dBFS, ouverture < 150 ms | **NON VÉRIFIÉ** | Exige une entrée micro réelle et une source calibrée. Pas de carte son ici. |
| **CA13** | RNNoise, réduction ≥ 10 dB | **NON VÉRIFIÉ** | Idem, et le module `src/engine/` (AudioWorklet) n'existe pas. |
| **CA14** | AEC, réduction ≥ 15 dB | **NON VÉRIFIÉ** | Exige un haut-parleur **et** un micro physiques couplés acoustiquement. Absents. |
| **CA15** *(bloquant)* | Overlay visible au-dessus d'une app plein écran, sans vol de focus | **NON VÉRIFIÉ** | Pas de serveur d'affichage exploitable, pas de fenêtre overlay dans l'arbre (`src/main/` = 2 fichiers de garde réseau/CSP). |
| **CA16** | Overlay déplaçable, position persistée | **NON VÉRIFIÉ** | Aucun overlay, aucun stockage de réglages à cet instant. |
| **CA17** *(bloquant)* | Aucun compte, `instanceId` changeant à chaque lancement | **MESURÉ (partiel)** | `grep -rn -E 'instanceId\|userId\|accountId\|email\|username\|password\|token\|uuid' src/` → **0 occurrence** (code retour 1) sur les **2** fichiers présents (23:54:10). La seconde moitié du critère (persistance dans le dossier de données, `instanceId` volatil) **n'est pas vérifiable** : l'app n'a jamais tourné. |
| **CA18** | Packaging (`npm run dist` → AppImage + deb qui se lance) | **NON VÉRIFIÉ** | `package.json` absent à 23:53:35, `node_modules` absent, aucun `dist/`. `npm run dist` échouerait avant de produire quoi que ce soit. |
| **CA19** | Pas d'auto-update : 0 `electron-updater`, `publish: null`, 0 requête | **MESURÉ (partiel)** | `electron-builder.yml` → **`publish: null` présent** ([OK]). `grep -rn -E 'autoUpdater\|electron-updater\|setFeedURL\|checkForUpdates' src/` → **0 occurrence** ([OK]). Troisième volet (`package.json`, dépendances installées) : **SKIP**, fichier absent. |
| **CA20** *(bloquant)* | Zéro télémétrie sur 5 min de session | **MESURÉ (partiel)** | Statique : **0 occurrence hors LAN** sur 8 fichiers (§2.2), aucun `sentry/posthog/mixpanel/amplitude/google-analytics` détecté. Dynamique : **non concluant** — l'app n'a pas tourné 5 min, et la mesure machine (§2.4) capte le trafic du runtime d'exécution, pas le sien. |

**Bilan : 3 critères partiellement mesurés (CA17, CA19, CA20), 0 validé pleinement, 0 échec imputable au code de l'app, 17 non vérifiés.**

---

## 4. Non vérifié — liste explicite

Tout ce qui suit **n'a pas été mesuré** et ne doit pas être lu comme acquis. Ce n'est pas une réserve de politesse : c'est la liste de ce que la phase 2 doit produire.

| Point | Pourquoi ce n'est pas vérifié ici |
|---|---|
| **Audio réel entre deux machines** | Un seul hôte dans cet environnement ; pas de second poste sur le même LAN ; pas de carte son. Aucun son n'a été émis ni reçu. |
| **Qualité MOS** | Pas d'audio → pas d'évaluation (ni PESQ, ni MOS informel). Le « MOS ≥ 3.5 » de CA2 est une exigence, pas un résultat. |
| **Latence audio bout-en-bout** | Aucun flux → aucune mesure. La latence réseau de la machine (§2.4) ne dit **rien** de la latence audio de l'app. |
| **AEC avec haut-parleur physique** | Pas de haut-parleur ni de micro : le couplage acoustique ne peut pas être reproduit. CA14 reste une intention de code. |
| **Overlay au-dessus d'un jeu plein écran** | Pas de session graphique, pas de jeu, pas de fenêtre overlay dans l'arbre. CA15/CA16 non mesurables. |
| **Découverte mDNS réelle entre deux machines** | Une seule machine ; en outre `src/engine/` n'existe pas encore. CA1 non mesurable. |
| **Packaging Windows** | Aucun `package.json`, aucun `electron-builder` installable, aucun hôte Windows. Le chemin `netstat -ano` documenté dans `measure-traffic.sh` **n'a jamais été exercé** — c'est de la documentation, pas une mesure. |
| **Chemin `ss` de `measure-traffic.sh`** | `ss` absent de ce conteneur : seul le repli `/proc/net/*` a été exécuté. Le code `ss -unp` / `ss -tnp` est écrit mais **non testé** ici. Même remarque pour `lsof` (macOS) et `netstat` (Windows). |
| **Test `tests/ice-filter.test.ts`** | Écrit, **jamais exécuté** : vitest indisponible sans `node_modules`, module `ice-filter.ts` inexistant. |
| **`csp.ts` lignes 76/83/84** | Hôte de websocket construit dynamiquement : je signale, je ne tranche pas (hors de mon périmètre de correction). À relire avec le code du moteur. |
| **Build, AppImage, deb** | Rien n'a été compilé. Aucune affirmation sur le fonctionnement d'un binaire. |
| **Comportement sous perte de 5 % de paquets** | Nécessite `tc netem` (privilèges réseau) et deux pairs. Non réalisé. |
| **CPU au repos et en conversation** | Aucun processus applicatif à profiler. |

---

## 5. Anomalies de chantier constatées (elles gênent la vérification)

1. **23:46:16** — l'arbre ne contient que `SPECS/SPEC-001-conception.md` et `package.json` (913 o). Aucun `src/`.
2. **23:48** — réécriture concurrente : `package.json` **disparaît**, `src/main/` apparaît, `SPECS/` est **vidé** (SPEC-001 supprimée).
3. **23:48** — mes fichiers `VERIF/check-no-external.sh` et `VERIF/check-deps.sh` (écrits à 23:48) sont **effacés** par la même réécriture ; `tests/` disparaît. Réécrits à 23:50 ; ils ont survécu depuis.
4. **23:53:52** — SPEC-001 **réapparaît** (19 739 o). C'est la version citée ici. Entre 23:48 et 23:53, j'ai travaillé sans référence écrite disponible.
5. **Aucun dépôt git** : impossible de dire *quelle* version du code a été mesurée, ni de comparer deux états. Les horodatages de ce rapport sont la seule trace.
6. **`package.json` toujours absent à 23:53:52** alors que `electron-builder.yml`, `vite.config.ts`, `tsconfig.main.json`, `index.html` existent : l'arbre est incohérent à cet instant (rien ne peut être installé ni compilé).

Recommandation de méthode pour la phase 2 : que Carillon et Cadre **ne nettoient jamais** `VERIF/` ni `tests/`, et que l'arbre soit **figé** (commit ou copie horodatée) avant que je mesure — sinon les chiffres ne sont rattachables à aucun état du code.

---

## 6. Ce que je ferai en phase 2 (protocole écrit, pas encore exécutable)

1. `npm ci` **une fois** (trafic d'installation, à déclarer), puis `run-all.sh -d 60` → C4 doit passer de SKIP à PASS/FAIL réel, `tests/ice-filter.test.ts` devient exécutable (CA4).
2. App lancée, `measure-traffic.sh -d 60 -p <PID>` avec `ss` présent → CA5 enfin imputable, avec la liste des pairs (doit être exclusivement RFC1918 + loopback).
3. Deux instances locales en loopback + une troisième sur un second poste du LAN → CA1, CA2, CA3, CA7, CA8 (avec deux machines réelles et une carte son).
4. Session de 5 min, capture complète → CA20 (idéalement `tcpdump`, pas seulement `ss`).
5. `npm run dist` → CA18 ; relancer C2 sur le `package.json` final → CA19 complet.
6. Rapport final **`VERIF/VERIF-001-rapport.md`** : mêmes sections, tous les SKIP levés ou explicitement maintenus comme « non vérifiable dans cet environnement », avec la raison.

---

*Banc (desk-qa) — 2026-10-30T23:55+01:00. Ce rapport ne contient aucun chiffre qui n'ait été produit par une commande exécutée sur cette machine, et aucun « vérifié » sans mesure.*
