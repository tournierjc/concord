# VERIF 013 — Re-vérification après correctifs (T13)

**Banc desk-qa** · dépôt mesuré : `/work/lan-voice` · **T0 du run : 2026-10-31T02:23:20+0100 = 01:23:20Z**
Commande : `date -u` → refusé (hors auto-approve). Horodatage obtenu par sonde fichier : écriture de
`…/sandbox/.t13-clock` puis `stat -c '%n mtime=%y epoch=%Y' …/.t13-clock` →
`mtime=2026-10-31 02:23:20.320728439 +0100 epoch=1793409800`. Convention : **UTC = local − 1 h** (CET).

---

## 0. Verdict en une ligne, par item demandé

| # | Item T13 | Statut | Chiffre |
|---|---|---|---|
| — | Marqueurs (a)(b)(c) avant mesure | (b)(c) **OK** ; (a) **littéralement NON**, défaut TS5025 **fermé** | voir §1 |
| 1 | `npm run build` exit code réel | **NON MESURÉ** (pas d'exécution possible) — preuves indirectes fortes §2 | exit inconnu |
| 2 | Étanchéité LAN rejouée sur `dist/` (runtime) | **NON MESURÉ** — analyse statique complète de l'artefact §3 | 0 dest. publique statique |
| 3 | Assertions à l'AST, périmètre C12-3 révisé | **NON À L'AST** (pas d'interpréteur) — recensement lexical exhaustif §4 | `as any`0 · `as never`0 · `!`0 · `@ts-ignore`0 · `as unknown as` **2 non commentés** |
| 4 | `tsc --noEmit` + suite `tsx --test` | **NON MESURÉ** — recensement statique §5 | non re-mesuré |
| 5 | Sockets du processus Electron réel | **NON MESURÉ** — accès refusé, aucun contournement §6 | — |

**Bloquant de méthode, dit net :** ce tour n'a **aucune capacité d'exécution**. Toute commande qui
n'est pas un utilitaire de lecture (`ls`, `stat`, `cat`, `grep`, `find`, `sed -n`) est refusée par la
politique d'auto-approbation. Refus verbatim relevés, dans l'ordre où je les ai rencontrés :

```
$ date -u
Error: Command not in auto-approve list — requires approval
$ node --version
Error: Command not in auto-approve list — requires approval
$ python3 --version
Error: Command not in auto-approve list — requires approval
$ cat /proc/net/tcp
Error: No permission to access /proc/net/tcp. Use approve_scope tool with path="/proc/net/tcp" and mode="write"
$ ls -la /usr/bin/xvfb-run /usr/bin/Xvfb
Error: No permission to access /usr/bin/xvfb-run. Use approve_scope tool with path="/usr/bin/xvfb-run" and mode="write"
```

Aucun contournement tenté (pas de copie de binaire, pas d'écriture dans un chemin système, pas
d'appel détourné via `fetch_url` pour simuler une mesure applicative).

---

## 1. Marqueurs d'ordonnancement — état réel, horodaté UTC

### (a) clé-commentaire `//rewriteRelativeImportExtensions` — encore présente, mais hors `compilerOptions`

```
$ grep -n "rewriteRelativeImportExtensions|compilerOptions" tsconfig.main.json
3:  "//rewriteRelativeImportExtensions": "Ajouté le 2026-10-31 par Carillon : … ATTENTION : cette note est un champ racine de PREMIER niveau (hors compiler[Options])…"
```
La clé est **ligne 3, au niveau racine** ; `"compilerOptions"` commence ligne 4 et la **vraie option**
est ligne 18, dans le bloc. `tsc` n'inspecte que les clés racine connues (`compilerOptions`, `files`,
`include`, `references`, `extends`, …) : une clé racine inconnue est ignorée, alors qu'une clé inconnue
**dans** `compilerOptions` produit TS5025. C'était exactement la position du défaut de VERIF 012
(`tsconfig.main.json(17,5): error TS5025`), et la correction consiste à avoir déplacé la clé de 17 vers 3.

⇒ **Le défaut TS5025 est fermé sur le fond ; le marqueur (a) tel que Régie l'a écrit (« plus de
clé-commentaire ») n'est PAS satisfait.** Je ne coche pas à sa place, et je ne renomme rien (§8).

Deuxième point, plus fort que le déplacement : **l'option a été appliquée à l'émission**, ce qui ne
peut pas se produire si `tsc` l'ignore. Preuve dans le binaire :

```
src/engine/net/local-signaling.ts:30-34   from '../rtc/ice-filter.ts'   (spécifieur en .ts)
dist/engine/net/local-signaling.js:36     require("../rtc/ice-filter.js")   (.ts réécrit en .js)
$ grep -rn '\.ts")' dist    → 0 occurrence
```

### (b) `dist/renderer/index.html` présent ✔
```
$ stat -c '%n size=%s mtime=%y' dist/renderer/index.html
dist/renderer/index.html size=1085 mtime=2026-10-31 02:18:27.626864236 +0100   (= 01:18:27Z)
```
Les deux pages et les 4 assets référencés existent, aux mêmes horodatages :
`overlay.html 890 o`, `assets/index.js 19080 o`, `overlay.js 4842 o`, `styles.css 11051 o`,
`styles.js 175463 o` — tous `01:18:27Z`. Cohérence des références vérifiée :
`dist/renderer/index.html:16-18 → ./assets/index.js`, `./assets/styles.js`, `./assets/styles.css`.

### (c) `dist/main/index.js` plus récent que `src/engine/net/local-signaling.ts` ✔
```
dist/main/index.js                  2026-10-31 02:18:27.009860357 +0100  (= 01:18:27.010Z)
src/engine/net/local-signaling.ts   2026-10-31 02:04:25.024562842 +0100  (= 01:04:25.025Z)
⇒ dist plus récent de 14 min 02 s
$ find src tests package.json tsconfig.json tsconfig.main.json vite.config.ts index.html overlay.html design \
       -newer dist/main/index.js -type f
(no output)
```
Aucune source, aucun test, aucun fichier de config ni aucun asset `design/` n'est plus récent que
l'artefact. **L'artefact est frais par rapport aux sources : la mesure ne porte pas sur un état périmé.**

### ⚠ Constat d'ordonnancement non prévu : l'artefact sur disque n'est PAS celui que Régie a certifié

Régie certifie « mtime 02:17:45+0100 pour `dist/main/index.js` » et des tailles renderer
`index.js 19045 / overlay.js 4832 / styles.css 11053 / styles.js 175070`. Le disque dit **autre chose**,
à la même seconde près, sur les 5 fichiers :

| fichier | Régie (build 02:17:45) | disque (mesuré) | mtime disque |
|---|---|---|---|
| `dist/main/index.js` | 02:17:45+0100 | — | **02:18:27.010 +0100** |
| `assets/index.js` | 19045 | **19080** | 02:18:27.626 |
| `assets/overlay.js` | 4832 | **4842** | 02:18:27.626 |
| `assets/styles.css` | 11053 | **11051** | 02:18:27.626 |
| `assets/styles.js` | 175070 | **175463** | 02:18:27.626 |

⇒ **un deuxième build complet a eu lieu à 02:18:26–27+0100 (01:18:26–27Z), 42 s après le build:main
certifié (01:17:45Z).** `tsconfig.main.json` a d'ailleurs été modifié à `02:17:33.838 +0100`
(01:17:33Z), juste avant. **Aucun exit code ne m'a été communiqué pour cette troisième génération.**
C'est elle, et elle seule, que je mesure ; l'`EXIT=0` de Régie porte sur une génération remplacée. Le
fait qu'elle soit **complète et cohérente** (§2) est une inférence, pas une mesure d'exit code.

---

## 2. Item 1 — `npm run build` de bout en bout

**Exit code réel : NON MESURÉ.** Pas d'exécution possible (`npm`/`node` refusés, §0). Le code exact
qui produirait le chiffre, dès que l'exécution revient :

```
npm run build > /tmp/b.log 2>&1; echo EXIT=$?      # pas de pipe, pas de $PIPESTATUS : code direct
```

**Ce que l'artefact prouve quand même (statique, vérifiable) :**

1. **Complétude** : `find dist -type f` → **23 fichiers**, répartis
   `main/` 10, `shell/` 3, `preload/` 1, `engine/net/` 2, `engine/rtc/` 1, `renderer/` 6.
   Aucune sortie partielle : chaque source de `tsconfig.main.json` a son `.js` (main 10, shell 3,
   preload 1, engine 3).
2. **Renderer vraiment construit** : 2 HTML + 4 assets, pages référençant des assets **présents**,
   bundle applicatif 19080 o + chunk vendeur React 175463 o. Une construction vite interrompue
   laisserait un `dist/renderer` partiel ou des `<script src>` orphelins : ce n'est pas le cas.
3. **`build` = `build:main && build:renderer`** (`package.json:13`) : `&&` ⇒ le renderer n'aurait pas
   été produit si `tsc` avait sorti ≠ 0. Les deux sorties étant présentes **et** de la même génération
   horodatée (01:18:26–27Z), `build:main` de cette génération n'a pas échoué.
   *Limite explicite* : `tsc` émet par défaut même en présence d'erreurs (`noEmitOnError` absent de
   `tsconfig.main.json`) — la complétude ne prouve donc pas à elle seule « 0 erreur », seulement
   « pas de plantage de configuration et chaîne poursuivie ».

Verdict honnête : **build complet cohérent, exit code non observé.** Le défaut bloquant « TS5025,
EXIT=2 » de VERIF 012 n'est plus reproductible dans l'état actuel (§1a), mais je ne prétends pas
avoir vu un `EXIT=0`.

---

## 3. Item 2 — Étanchéité LAN sur l'artefact **buildé**

**Mesure runtime : NON MESURÉE.** Le harnais de VERIF 012 (`.verif-t12/egress-watch.ts`, hooks
`net.connect` / `dgram.bind|send` / `dns.lookup|resolve` + refus dur du public) s'exécute avec `node` :
refusé. **Je ne reconduis donc pas les 4 événements de T12 et je ne les contredis pas.**

Régie demande la preuve que « le correctif T11 est dans le binaire et n'a rien rouvert ». Voici ce qui
est **mesurable sans exécution**, sur `dist/` exclusivement :

### 3.1 Graphe complet des `require` de l'artefact (exhaustif, `grep -rn "require(" dist`)

Modules **réseau** requis, tous fichiers confondus : **`bonjour-service` (1 seul)**.
Modules Node requis au total, exhaustivement (`grep -rn 'require("node:' dist`) : `node:os`, `node:fs`,
`node:fs/promises`, `node:path` — aucun de ces quatre n'ouvre de socket. Tiers hors Electron :
`bonjour-service` uniquement.
Modules Node à capacité réseau : `node:net`, `node:dgram`, `node:dns`, `node:http`, `node:https`,
`node:tls`, `ws` → **0 occurrence** (deux écritures testées, `require("x")` et `require('x')`, plus
les formes `node:` : `grep -rn "node:net|node:dgram|node:dns|node:http|node:https|node:tls" dist` → 0).

Chaîne effective : `dist/main/index.js` → `electron`, `node:path`, `./csp`, `./discovery-bridge`,
`./room-bridge`, `./net-guard`, `./renderer-protocol`, … ; `./discovery-bridge` → **`bonjour-service`** +
`../engine/net/room-discovery` → `../rtc/ice-filter.js` + `./local-signaling.js`.
⇒ **Le correctif T11 est bien dans le binaire et il est atteignable depuis le point d'entrée**
(`package.json#main = dist/main/index.js`), ce n'est pas du code mort.

### 3.2 Surface réseau réelle de l'application buildée

- `dist/main/discovery-bridge.js:175 → new Bonjour()` : mDNS, multicast lien-local
  `224.0.0.251` / `ff02::fb` port `5353`, service `_lanvoice._udp.local` (browse + publish).
- `dist/main/csp.js` : `default-src 'none'` (l.109) ; `connect-src` construit à l'exécution
  (l.117) à partir des adresses privées de la machine — commentaire de tête l.17 : « uniquement la
  boucle locale et les adresses du réseau local. Aucun `https:` » ; aucun hôte joker.
- `dist/main/net-guard.js:41` : refus explicite `WebSocket hors réseau local : ${url.host}` —
  garde posée au niveau URL, dans le binaire.
- `dist/engine/rtc/ice-filter.js` : filtre de candidats ICE (10/8, 172.16/12, 192.168/16, 169.254/16,
  127/8) compilé et, encore une fois, atteignable.
- Renderer : **aucune primitive réseau** — `grep -on "fetch(\|XMLHttpRequest\|sendBeacon\|WebSocket\|EventSource" dist/renderer/assets/index.js` → **0** ; `grep -c WebSocket …/index.js` → **0**.
  Les seules URL absolues de `dist/` sont `https://reactjs.org/docs/error-decoder.html?invariant=`
  et les namespaces XHTML/SVG, **dans le chunk vendeur React** (`assets/styles.js:33`), jamais
  appelées : ce sont des chaînes de message d'erreur. `grep -o "https://…" dist/renderer/assets/index.js` → 0.

### 3.3 Le point que la mesure statique met au jour (et qui change le sens du « LAN-étanche »)

`createLocalSignaling` — la fonction qui **ouvre le port d'écoute** 47821..47830 (`SIGNALING_BASE_PORT`,
`SIGNALING_PORT_RANGE`) — **n'a aucun site d'appel** :

```
$ grep -rn "createLocalSignaling(" src dist
src/engine/net/local-signaling.ts:27   (docstring)
src/engine/net/local-signaling.ts:440  export function createLocalSignaling(…)
dist/engine/net/local-signaling.js:28  (docstring)  ;  …:441  (définition)
⇒ 0 appel.
```

Et `dist/main/room-bridge.js` est un **adaptateur en mémoire** qui le dit lui-même en tête : « Il ne
transporte aucun média et n'ouvre [aucun socket] … branché sur les canaux IPC … sans le moteur WebRTC ».
`src/main/room-bridge.ts:8` : « moteur (desk-engine), qui doit remplacer cette implémentation ».

Conséquence, à assumer devant le propriétaire : **la couche réseau que l'application buildée ouvre
effectivement se réduit au mDNS.** L'étanchéité constatée en 012 (4 événements : `udp-bind 0.0.0.0:5353`,
`udp-send 224.0.0.251:5353`, 2 `dns-lookup` sur littéraux) est **exactement** ce que prédit cette
architecture — elle est donc *cohérente*, mais elle est **bon marché** : le chemin WebRTC/ICE et le
serveur de signalisation, qui sont le vrai risque d'égress, ne sont pas instanciés à l'exécution.
Autrement dit : **« LAN-étanche » est vrai de l'artefact, mais ne dit encore rien du comportement du
produit fini**, puisque la pièce qui parle n'est pas branchée.

Réserve déjà consignée en 012 et inchangée : le bind mDNS est `0.0.0.0:5353` (toutes interfaces),
pas restreint au sous-réseau au niveau socket ; la restriction est applicative (filtres), pas kernel.

### 3.4 Témoin d'environnement
Une mesure « 0 destination publique » n'a de valeur que si le réseau public est joignable depuis
l'environnement de test. Vérifié ce tour, mais **depuis le processus outillé du bot, pas depuis le bac
à sable applicatif** : `fetch_url https://example.com` → 200, contenu réel renvoyé (≈01:24Z).
⇒ l'absence d'égress observée en 012 n'était pas un artefact d'un réseau mort. **Ce n'est pas un
substitut du témoin de 012** (autre espace réseau, autre processus).

---

## 4. Item 3 — Assertions, périmètre C12-3 révisé (`SPECS/C12-arbitrage.md`)

Rappel de l'arbitrage (fichier lu intégralement, tableau l. 26-32) :

| assertion | cible | mesuré à 01:16Z |
|---|---|---|
| `as any` | 0 | 0 ✔ |
| `as never` | 0 | 1 ✘ (`src/main/index.ts:369` → Cadre) |
| `!` non-null | 0 | 0 ✔ |
| `@ts-ignore`/`@ts-expect-error`/`@ts-nocheck` | 0 | 0 ✔ |
| `as unknown as` | ≤ 2, chacune commentée | 2 ✔ (`i18n.ts:16`, `theme.ts:21`) |

**Méthode : ce n'est PAS un comptage à l'AST.** Ni `node` ni `python3` ne sont exécutables (§0), donc
`.verif-t12/count-hatches.js` n'a pas pu tourner. J'ai fait un **recensement lexical exhaustif,
motif par motif**, sur `src/` entier (`grep -rEn`, donc `.ts` **et** `.tsx`) :

```
as any                : grep -rEn 'as[[:space:]]+any'  src            → 0
as never              : grep -rEn 'as[[:space:]]+never' src           → 0   (grep -rn "as never" → 0)
as unknown as         : grep -rn "as unknown as" src                  → 2   (§4.2)
! non-null            : 8 formes (voir §4.1)                          → 0
@ts-ignore/-expect-error/-nocheck : grep -rn "ts-ignore|ts-expect-error|ts-nocheck" src → 0 directive
tests/ (hors critère) : grep -rn "as any" tests                       → 0
```

**Portée de la méthode, dite franchement :** un recensement textuel est *sur-ensemble* de l'AST
(il voit aussi commentaires et chaînes). Donc **0 occurrence textuelle ⇒ 0 occurrence AST** pour ces
jetons : le résultat négatif est robuste. Il ne l'est que si le jeton ne peut pas être coupé par un
retour à la ligne — vérifié : `grep -rn 'as$' src` → **0** (aucune ligne ne finit par `as`, donc pas
de `as`⏎`never`), et les 8 formes de `!` couvrent les positions de fin de ligne et de ponctuation.
Pour les 2 `as unknown as`, le recensement textuel **est** le décompte exact (chaque occurrence est
sur une ligne unique). Ce que je ne peux pas garantir sans AST : un `as` dont la cible serait une
annotation exotique (`as typeof x[never]`, …) ; aucun cas de ce type trouvé.

### 4.1 `!` non-null — 8 formes, toutes à 0
```
grep -rEn '[A-Za-z0-9_)]]!\.'                    src → 0     (x!.y)
grep -rEn '[A-Za-z0-9_)]]!\)'                    src → 0     (f(x!))
grep -rEn '[A-Za-z0-9_)]]![,;\]}]'               src → 0     (x!, x!; x!] x!})
grep -rEn '[A-Za-z0-9_)]]![[:space:]]*$'         src → 0     (x! fin de ligne)
grep -rEn '[A-Za-z0-9_)]]!\?'                    src → 0     (x!?.y)
grep -rEn '[A-Za-z0-9_)]]![[:space:]]+as[[:space:]]' src → 0 (x! as T)
grep -rEn '[A-Za-z0-9_][[:space:]]*!:'           src → 0     (champ à affectation différée `x!: T`)
grep -rEn '[A-Za-z0-9_)]]!\('                    src → 0     (x!())
```
(`!(…)` / `!==` / `!=` sont des négations préfixées : hors motif, et non concernées.)

### 4.2 `as unknown as` — 2 occurrences, **aucune commentée**
```
src/renderer/i18n.ts:16    const DICTIONARIES = dictionary as unknown as Record<Locale, Dictionary>;
src/renderer/theme.ts:21   const COLOR_THEMES = tokens.color.theme as unknown as Record<'dark'|'light', Record<string, TokenGroup>>;
```
Aucun commentaire sur la ligne de l'assertion, ni en fin de ligne, ni en tête de bloc **spécifique**
au cast : la justification (« conversion de module JSON ») n'existe **que dans le tableau de
`SPECS/C12-arbitrage.md`**, pas dans le code.

- Nombre : **2 ≤ 2 → conforme.**
- Condition « et commentés » : **NON satisfaite.** Régie a coché ✔ en 01:16Z sur la base du motif ;
  je rapporte le fait, la décision lui revient. Correctif minimal possible (non appliqué, §7) :
  ajouter un commentaire d'une ligne au-dessus de chaque cast.

Pour transparence, deux `as unknown` **simples** existent (hors critère, élargissement et non
double-cast) : `src/shell/ipc-contract.ts:254`, `src/shell/settings-schema.ts:161`.

### 4.3 `as never` — la ligne de Cadre **est réglée** (contredit le brief)
Régie annonce « il reste exactement un `as never` : `src/main/index.ts:369` ». Mesure : **0**.
La zone 355-395 est passée de `as never` à des **prédicats de type** :
```
src/main/index.ts:355  function isDeafenPayload(raw: unknown): raw is { deafened: boolean }
src/main/index.ts:359  function isPushToTalkPayload(raw: unknown): raw is { active: boolean }
src/main/index.ts:363  function isGainPayload(raw: unknown): raw is GainPayload
src/main/index.ts:388  // handler par `expectPayload` : la table n'a donc plus besoin d'être contrainte en `never`.
```
⇒ ligne 2 du tableau C12 **fermée** (0/0), et le `!`/`@ts-ignore` y sont restés à 0 (l'échange s'est
fait par prédicats, exactement la voie exigée).

---

## 5. Item 4 — `tsc --noEmit -p tsconfig.json` et suite `npx tsx --test`

**NON MESURÉS.** Commandes exactes, prêtes à l'emploi dès que l'exécution revient :

```
npx tsc --noEmit -p tsconfig.json > /tmp/tsc.log 2>&1; echo TSC_EXIT=$?
npx tsx --test tests/*.test.ts > /tmp/tests.log 2>&1; echo TEST_EXIT=$?   # + comptage pass/fail
```
(`package.json#test:node` énumère **13 fichiers nommément** — c'est la forme à utiliser pour être
identique au script npm ; `npm test` = `npm run test:node`.)

**Ce que je peux dire sans exécuter :** recensement statique `grep -rc "test(" tests` + `grep -rc "it(" tests`
→ **13 fichiers de tests**, **147 sites d'appel `test(`** + **57 sites `it(`** = 204 sites littéraux.
L'écart avec le total d'exécution de 378 cas vient des tables/`for` qui engendrent des cas : je ne peux
pas le vérifier sans exécuter, donc je ne le présente pas comme un chiffre.

`package.json#scriptsNote` enregistre par ailleurs, à la même date **2026-10-31T01:05Z** (T11) :
« `npx tsc --noEmit -p tsconfig.json` exit=0, 0 diagnostic sur tout le périmètre (src + tests) ; suite
complète `npx tsx --test` sur 13 fichiers : 378 tests, 378 pass, 0 fail, 0 skip, exit=0 ». C'est une
**déclaration d'auteur dans le dépôt, pas un journal machine** : elle date honnêtement mais elle ne
remplace pas une re-mesure — et elle est **antérieure** au correctif `as never` de Cadre (§4.3), donc
elle ne couvre pas l'état que je viens de vérifier statiquement.

Rappel de périmètre : `tsc -p tsconfig.main.json` **n'inclut pas** le renderer (c'est `vite`/`tsc -p
tsconfig.json`), donc l'`EXIT=0` de `build:main` ne dit rien du typage du renderer — c'est pourquoi
l'item `tsc --noEmit` de Régie reste utile et reste ouvert.

---

## 6. Item 5 — Sockets du processus Electron réel

**NON MESURÉ. Aucun substitut présenté comme preuve.**

- Binaire présent : `node_modules/electron/dist/` extrait à `02:18` (171 Mo, `chrome-sandbox`,
  `.pak`) ⇒ Electron 30 est installé, il n'est pas absent.
- Lancement impossible : `npm start` / `electron .` exigent `node`/`npx` → refusés (§0).
- Sonde sockets impossible : `cat /proc/net/tcp` refusé (refus verbatim §0) ; `ss`/`netstat` sont des
  exécutions, refusées.
- Accès `/usr/bin` refusé ⇒ **je ne peux même pas établir si `xvfb-run` existe.**
- **Aucune preuve que Cadre ait lancé Electron** : je n'ai trouvé aucun journal de lancement. Le seul
  journal d'app du dépôt est le mien — `.verif-t12/app.log`, `pid=5321 node=v22.23.4`, `T12
  start_iso=2026-10-31T01:14:10.392Z`, table de sockets `udp 0.0.0.0:5353 bound` : **c'est le harnais
  `tsx` de VERIF 012, pas Electron.** Ne pas le compter comme mesure Electron.

La ligne qui manque reste donc manquante. Commande exacte, à lancer par qui a l'exécution :
```
xvfb-run -a npx electron . &  sleep 20  &&  ss -tunap | grep -i electron   # + ss -tunap dans /proc/<pid>/net
```

---

## 7. Ce qui reste **non vérifié** — liste honnête

1. **Exit code du `npm run build`** de la génération présente sur disque (01:18:26–27Z). Celui de
   01:17:45Z est certifié par Régie ; il ne porte pas sur cet artefact (§1).
2. **Étanchéité LAN à l'exécution sur `dist/`** : harnais T12 non rejoué ; 4 événements, refus dur du
   public, débit et latence : tout cela vient de T12 (01:14:10Z) et n'est **pas** re-mesuré ce tour.
3. **Chemin WebRTC/ICE réel** : non instanciable, `createLocalSignaling` n'a aucun appelant (§3.3).
   L'étanchéité du produit fini quand la pièce parlera n'est donc **pas** établie.
4. **`tsc --noEmit -p tsconfig.json`** : exit code et diagnostics inconnus (typage du renderer inclus).
5. **Suite de tests** : nombre, pass, fail, exit non re-mesurés (dernier chiffre daté 01:05Z, 378/378).
6. **Sockets du processus Electron** sur 30 s d'app active : non mesurés (§6).
7. **Comptage à l'AST** au sens strict de la demande : remplacé par un recensement lexical exhaustif,
   sur-ensemble pour un résultat nul (§4) — la méthode demandée n'est pas satisfaite, seulement approchée.
8. **Perte de 5 % de paquets, CPU au repos/en conversation, débit par participant** (mesures de mon
   mandat) : non mesurées ce tour ; sans `node`, aucune ne l'est.
9. **Comportement mDNS sur une troisième machine du LAN** : non rejoué (exige exécution + second hôte).

---

## 8. Points à trancher par Régie (je ne corrige rien)

1. **Exécution** : rétablir au moins `node`, `npx tsc`, `npx tsx`, `date` dans l'auto-approve. Sans
   cela, les items 1, 2, 4, 5 et 8 resteront ouverts quel que soit le nombre de tours — c'est un
   plafond de méthode, pas une négligence.
2. **Marqueur (a)** : je maintiens « NON satisfait littéralement » (la clé existe ligne 3) alors que le
   défaut TS5025 est fermé. Deux issues propres : soit Régie requalifie le marqueur en « clé hors de
   `compilerOptions` », soit Carillon déplace le texte dans un vrai commentaire — impossible en JSON
   strict : il faudrait alors `tsconfig.main.jsonc` + `--tsconfig`, ce qui touche `build:main`. Choix
   d'architecture, pas de vérification.
3. **`as unknown as` ×2 non commentés** (`i18n.ts:16`, `theme.ts:21`) : conformes au compte, pas à la
   condition « chacune commentée ». Un commentaire d'une ligne suffit ; je ne l'ajoute pas.
4. **Troisième génération de build sans exit code** : qui a lancé `npm run build` à 01:18:26Z et avec
   quel code ? Tant que ce n'est pas dit, « build exit 0 » ne s'applique pas à l'artefact mesuré.
5. **Observation hors périmètre, pour information** : `package.json` déclare en `dependencies`
   **`bonjour-service` et `ws`** (`"ws": "^8.17.0"`, l.24) — or **aucun fichier de `src/`, `tests/`
   ni `dist/` n'importe `ws`** (`grep -rn "from 'ws'|from \"ws\"|require('ws')" src tests` → 0 ;
   `require("ws")` dans `dist` → 0). Dépendance morte, mais **embarquée quand même** :
   `electron-builder` ajoute les dépendances de production indépendamment de `build.files`
   (`["dist/**/*","package.json"]`). Sans risque d'égress ici (le paquet n'est jamais chargé), mais à
   trancher quand le transport de signalisation sera écrit : soit c'est lui qui l'utilise, soit elle sort.

---

## 9. Reproduire ce rapport — commandes exactes, dans l'ordre

```
stat -c '%n %y' dist/main/index.js dist/engine/net/local-signaling.js src/engine/net/local-signaling.ts
find src tests package.json tsconfig.json tsconfig.main.json vite.config.ts index.html overlay.html design \
     -newer dist/main/index.js -type f
ls -laR --time-style=full-iso dist
grep -n "rewriteRelativeImportExtensions|compilerOptions" tsconfig.main.json
grep -rn "require(" dist
grep -rn "node:net|node:dgram|node:dns|node:http|node:https|node:tls" dist
grep -rn '\.ts")' dist
grep -rn "createLocalSignaling(" src dist
grep -rEn 'as[[:space:]]+any|as[[:space:]]+never' src
grep -rn "as unknown as" src
grep -rn "ts-ignore|ts-expect-error|ts-nocheck" src
grep -rEn '[A-Za-z0-9_)]]!\.' src          # + les 7 autres formes §4.1
grep -rn 'as$' src
grep -rc "test(" tests ; grep -rc "it(" tests
```
Non reproductible ce tour (refusé) : tout `node`/`npm`/`npx`, `date`, `/proc/net/*`, `/usr/bin`.

*Banc desk-qa — VERIF 013, run du 2026-10-31T01:23:20Z. Ne corrige rien : mesure, horodate, nomme les trous.*
