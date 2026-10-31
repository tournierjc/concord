# VERIF 035 — l'hôte n'annonçait son salon à personne

Date de la campagne : **2026-10-31**, mesures entre **20:12Z et 20:17Z** (UTC).
Dépôt : clone de `tournierjc/concord` à `c24e913`, branche `fix/mdns-announce` coupée de `origin/main`.
Hôte Linux `aarch64`, `node v26.5.1`, `npm 11.17.0`, `tsx 4.23.15`.

**Défaut mesuré.** Le dépôt ne publiait **aucun** service mDNS : `grep -rn "\.publish(" src/` rendait
0 occurrence, `discovery-bridge.ts` ne faisait que `find()` (browse), et `BEACON_PORT` (47820) était
déclaré sans jamais être utilisé. Conséquence : le registre de `room-discovery` ne recevait jamais
d'annonce, `list()` restait vide, l'écran d'accueil affichait « aucun salon », et `startSignalingLink`
prenait **toujours** le rôle `host` (`remote` introuvable) — rejoindre le salon d'un autre poste était
structurellement impossible, hors boucle locale.

Second défaut, de plomberie : le port publié devait être celui **réellement écouté**, mais
`createSignalingLink` n'exposait aucun moyen de savoir qu'un port avait été pris : `SIGNALING_PORT_RANGE`
ports sont essayés à la suite (`signaling-link.ts:416-437`) et seul `listen` était lisible après coup.

## 1. Ce qui change

| Fichier | Changement |
|---|---|
| `src/main/discovery-bridge.ts` | `announce({roomName, port, participants})`, `retract()`, `announced()` ; publication `_concord._udp` avec TXT `roomName` (≤ 64, borne de l'engine) et `participants` ; nom d'instance = `instanceId` aléatoire par session (A4/A6, aucun identifiant persistant) ; notre propre annonce est écartée du browse ; `close()` retire l'annonce ; mDNS devient un **port injectable** (`MdnsPort`, `BrowserLike`) ; port non entier ou hors bornes → aucune annonce (jamais un port arrondi) |
| `src/main/signaling-link.ts` | option `onListen?: (listen) => void`, appelée après un bind réussi et une seule fois |
| `src/main/index.ts` | `onListen` → `discovery.announce({ roomName, port: listen.port, participants })` côté hôte uniquement, et ignoré si le lien a été remplacé entre-temps ; `stopSignalingLink` → `discovery.retract()` |
| `tests/discovery-bridge.node.test.ts` | **nouveau**, 9 tests, pile mDNS en mémoire (aucun socket, aucun port 5353) |
| `tests/signaling-link.node.test.ts` | + 2 tests `onListen` sur sockets loopback réelles |
| `package.json`, `docs/TESTS.md` | liste `test:node` (27 fichiers), marqueur `scriptsNote`, TL;DR re-mesuré |

## 2. Mesures (commandes exactes, horodatées)

| Commande | Sortie mesurée | Verdict |
|---|---|---|
| `npx tsx --test tests/discovery-bridge.node.test.ts` | 9 tests, 9 pass, exit=0 | ✅ |
| `npx tsx --test tests/signaling-link.node.test.ts` | 14 tests, 14 pass, exit=0 | ✅ |
| `npm test` | **27 fichiers · 675 tests · 675 pass · 0 fail · 49 suites · 5 238 ms** (`20:16:28→20:16:34Z`), rejoué `20:16:43→20:16:48Z` mêmes comptes | ✅ |
| `npx tsc -p tsconfig.main.json --noEmit` | exit=0 | ✅ |
| `npm run build` | exit=0 | ✅ |
| `sh VERIF/run-all.sh` | `LAN-VOICE VERIF RESULT=PASS` (`20:16:5xZ`) | ✅ |

Ce que les nouveaux tests figent :
1. `announce({roomName:'Salon cuisine', port:47823, participants:3})` publie **une** annonce
   `_concord._udp`, port `47823`, TXT `{roomName:'Salon cuisine', participants:'3'}` ;
2. une seconde annonce **retire** la première (le TXT `participants` suit la population) ;
3. ports `0`, `-1`, `NaN`, `70000`, `12.5` → **aucune** publication, `announced()` reste `null` ;
4. pile mDNS indisponible (fabrique qui lève) → aucune publication, le bridge ne plante pas ;
5. après `close()` : plus rien n'est publié, la pile est détruite ;
6. notre propre service, relu par le multicast, **n'entre pas** dans la liste (le proposer inviterait
   à rejoindre le salon qu'on héberge) — et il ne masque pas les salons voisins ;
7. un salon voisin entre avec `roomName`/`participants` du TXT, `roomId = hôte:port` ;
8. côté lien : `onListen` n'est **pas** appelé avant le bind, l'est une fois, et rend `base + 1`
   quand le port demandé est déjà occupé — donc ce qui part sur le réseau est bien le port qui écoute.

## 3. Non vérifié, nommé

- **Aucune mesure mDNS réelle** : pas de multicast sur cet hôte, et `bonjour-service` n'a pas été
  lancé. Ce qui est prouvé est la **logique** du bridge contre un port mDNS doublé, et l'unicité du
  port via des sockets TCP réelles. Reste non mesuré : la visibilité effective d'un poste à l'autre
  sur un vrai LAN (avahi/mDNS, conflits de noms, réseau invité).
- **Deux postes réels, audio et micro** : hors de portée de ce conteneur (aucun binaire Electron
  exécutable, `libgtk-3.so.0` absent).
- Le TXT `participants` est figé à l'annonce : rejoindre/quitter un salon **n'actualise pas** encore
  le compte annoncé (le pont média ne remonte pas encore la population — unité séparée).
- Le beacon UDP de A4 (`BEACON_PORT`, 47820) reste **non implémenté** : cette unité traite la
  découverte mDNS, pas le chemin de repli sans mDNS.
- Le nom d'instance annoncé est aléatoire par session : un second lancement sur la même machine
  apparaît comme un service distinct — non mesuré (un seul poste ici).
