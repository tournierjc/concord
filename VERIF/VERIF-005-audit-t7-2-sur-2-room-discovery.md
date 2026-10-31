# VERIF-005 — Contrôle indépendant de `room-discovery.ts` (T7, 2/2)

**Auteur** : Banc (desk-qa) · **Date** : 2026-10-31, ~00:37 CET (heure locale du poste ; fichier de test créé à 00:36, `ls -l tests`) · **Destinataire** : Régie / Carillon.

## Objet et version contrôlée

| Fichier | Taille | mtime | `wc -l` |
|---|---|---|---|
| `src/engine/net/room-discovery.ts` | 12 950 o | 31 oct. 00:25 | **317** |
| `tests/room-discovery.node.test.ts` | — | — | **437** |
| `tests/room-discovery-sec.node.test.ts` (créé par ce contrôle) | 7 780 o | 31 oct. 00:36 | 179 |

```
$ wc -l src/engine/net/room-discovery.ts tests/room-discovery.node.test.ts
  317 src/engine/net/room-discovery.ts
  437 tests/room-discovery.node.test.ts
  754 total
$ grep -c "^test(" tests/room-discovery.node.test.ts
28
```

Les deux tailles annoncées par Carillon sont exactes (317 / 437), et le fichier de tests contient bien **28 déclarations `test(`**. Le module n'a pas bougé pendant le contrôle (mtime 00:25 < début du contrôle).

**Vocabulaire des verdicts** : `OK` = prouvé ci-dessous · `DÉFAUT` = écart réel, preuve ci-dessous · `NON VÉRIFIÉ` = le banc n'a pas pu produire la preuve (motif explicité).

---

## 0. DÉFAUT D'OUTILLAGE — l'exécution a été refusée pendant tout ce run

**À lire avant les verdicts.** Ce run n'a obtenu aucune permission d'exécution : tout binaire hors liste blanche (`ls`, `cat`, `grep`, `find`, `wc`, `head`, `tail`, `git`) est refusé, `node`/`npx`/`npm` compris. Sortie textuelle, identique à chaque tentative :

```
$ npx tsx --test tests/room-discovery-sec.node.test.ts
Error: Command not in auto-approve list — requires approval

$ npx tsx --test tests/room-discovery.node.test.ts
Error: Command not in auto-approve list — requires approval

$ npm test
Error: Command not in auto-approve list — requires approval

$ node -v
Error: Command not in auto-approve list — requires approval
```

Conséquences, assumées sans contournement (les échappatoires type alias git sont interdites par mes règles) :

- **Tous les verdicts ci-dessous reposent sur la lecture du code + `grep`**, jamais sur une sortie de test produite par moi.
- Le « 28/28 exit=0 à 00:26:53 » de Régie **n'est pas re-mesuré** ici : je confirme seulement le **nombre** de cas (28) par `grep`; le chiffre d'exécution reste celui de Régie.
- Mes 3 tests adversariaux **existent mais n'ont pas été exécutés**. Leur résultat attendu est déduit pas à pas du code (§4), pas mesuré.
- Pour clore les points 2 et 3 par exécution, une seule commande suffit, à lancer par Régie ou Carillon :

```
cd /work/lan-voice && npx tsx --test tests/room-discovery-sec.node.test.ts   # attendu : 3 pass, 1 skip, exit=0
cd /work/lan-voice && npx tsx --test tests/room-discovery.node.test.ts       # attendu : 28 pass, exit=0
```

---

## 1. Aucune duplication de la règle LAN — **VERDICT : OK**

### 1.1 Aucun littéral d'adresse dans le module

```
$ grep -n "[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}" src/engine/net/room-discovery.ts
(sortie vide — exit=1)

$ grep -n "192\.168\|172\.16\|169\.254\|127\.0\|10\.[0-9]" src/engine/net/room-discovery.ts
(sortie vide — exit=1)
```

Aucune plage d'adresses n'est recodée : ni IPv4 pointée, ni préfixe RFC1918, ni link-local, ni loopback. (Les seuls littéraux `192.168.x` du dépôt sont des **fixtures** de `tests/room-discovery.node.test.ts`, l.34, 63, 69, 71 — c'est normal et sans effet sur la règle.)

### 1.2 La décision passe par la source unique `isLanCandidate`

```
$ grep -n "isLanCandidate\|isAllowedListenHost" src/engine/net/room-discovery.ts
23: * Règle « LAN uniquement » : une seule source de vérité, `isLanCandidate` de
25: * d'une ligne de candidat ICE d'hôte (même procédé que `isAllowedListenHost` dans
35:import { isLanCandidate } from '../rtc/ice-filter.ts'
62:/** Priorité factice de la ligne ICE servant à interroger `isLanCandidate`. */
113: * des jetons supplémentaires dans la ligne ICE présentée à `isLanCandidate`.
124:  return isLanCandidate(`candidate:1 1 udp ${HOST_CANDIDATE_PROBE_PRIORITY} ${host} 9 typ host`)

$ grep -n "isLanCandidate(" src/engine/net/room-discovery.ts
124:  return isLanCandidate(`candidate:1 1 udp ${HOST_CANDIDATE_PROBE_PRIORITY} ${host} 9 typ host`)
```

`isAllowedListenHost` n'apparaît **que dans un commentaire** (l.25). L'unique appel réel est `isLanCandidate` (l.124), dans `isLanHost` (l.123-125), appelé par `parseAnnouncement` (l.192). Une seule source de vérité, aucun `if (ip.startsWith('192.168'))` caché : **OK**.

---

## 2. Aucun cycle, aucun `import` runtime vers `src/shell` — **VERDICT : OK (statique)** · run isolé : **NON VÉRIFIÉ**

### 2.1 Un seul lien vers `src/shell`, et il est `import type`

```
$ grep -rn "from '.*shell\|require('.*shell" src/engine/
src/engine/net/room-discovery.ts:42:import type { RoomSummaryDto } from '../../shell/ipc-contract.ts'
```

1 occurrence, `import type` → effacé à la compilation : aucun `require`/`import` runtime, aucun `require()` dynamique (`grep -n "import("` sur le module : exit=1, sortie vide).

### 2.2 Le graphe runtime complet du module, énuméré

```
$ grep -n -A 7 "^import {" src/engine/net/room-discovery.ts
35:import { isLanCandidate } from '../rtc/ice-filter.ts'
36:import {
37-  DEFAULT_MAX_PARTICIPANTS,
38-  SIGNALING_BASE_PORT,
39-  SIGNALING_PORT_RANGE
40-} from './local-signaling.ts'
41-
42:import type { RoomSummaryDto } from '../../shell/ipc-contract.ts'

$ grep -n "import\|require" src/engine/net/local-signaling.ts
30:import {
    → 30-33 : import { filterLanCandidates, isLanCandidate } from '../rtc/ice-filter.ts'

$ grep -n "import" src/engine/rtc/ice-filter.ts
11: *   - aucun import (ni electron, ni ws, ni node:*, ni rien) ;
```

Graphe : `room-discovery → ice-filter` (valeur), `room-discovery → local-signaling` (valeur), `room-discovery → shell/ipc-contract` (**type seul**), `local-signaling → ice-filter`, `ice-filter → ∅`. Aucun retour vers `room-discovery` : **aucun cycle**.

### 2.3 `src/shell` ne regarde jamais `src/engine` → pas même un cycle de types

```
$ grep -rn "engine" src/shell
src/shell/ipc-contract.ts:112: * `src/engine/rtc/ice-filter.ts` (isLanCandidate) côté process principal, jamais ici.

$ grep -rn "from '../engine\|from '../../engine" src/shell src/main
src/main/discovery-bridge.ts:26:} from '../engine/net/room-discovery';
```

Dans `src/shell` : **zéro import**, la seule occurrence est un commentaire. Le seul consommateur est `src/main/discovery-bridge.ts` (process principal), c.-à-d. le sens autorisé main → engine.

### 2.4 Un effet de bord top-level serait le vrai risque : il n'y en a pas

`local-signaling.ts` est le seul import non trivial du module. Son corps top-level est exclusivement des déclarations (`grep -n "^export\|^function\|^class\|^const"` : l.36-425, uniquement consts/types/interfaces/fonctions ; `createLocalSignaling` l.425 crée le serveur **à l'appel**). Importer `room-discovery` n'instancie donc aucun serveur.

> **NON VÉRIFIÉ** : le « run du fichier isolé » demandé (preuve *par exécution*). Commande refusée (§0) : `npx tsx --test tests/room-discovery-sec.node.test.ts`. Les 2.1-2.3 établissent le même fait **par lecture**.

---

## 3. Aucune sortie hors LAN, module pur — **VERDICT : OK (statique)** · exécution sans réseau : **NON VÉRIFIÉ**

### 3.1 Aucune primitive réseau, aucun accès DNS

```
$ grep -n "WebSocket\|fetch(\|http\|net\.\|dgram\|bonjour\|require(\|XMLHttpRequest\|node:" src/engine/net/room-discovery.ts
11: *   • AUCUN réseau : pas de socket, pas d'UDP, pas de `dns-sd`, pas de `bonjour`,
13: *     des enregistrements déjà résolus. Le browse mDNS réel (bonjour-service, socket
77: * avec ce que rend `bonjour-service`). Le module ne sait rien de plus.

$ grep -n "import(\|setTimeout\|setInterval\|process\.\|globalThis\|Date\.now\|Math\.random" src/engine/net/room-discovery.ts
(sortie vide — exit=1)
```

**Trois** occurrences, **toutes dans des commentaires** (l.11, 13, 77) : `bonjour`, socket, dns-sd. Aucun appel : pas de `new WebSocket`, pas de `fetch(`, pas de `dgram`, pas de `node:dns`, pas de `net.`, pas de `import()` dynamique, aucun timer, aucune horloge système (`Date.now` absent — le temps est injecté via `options.now`, l.275-278), aucun `Math.random`, aucun `process`. Rien au top-level ne s'exécute (§2.4) : **aucun appel sortant au démarrage**, par construction.

### 3.2 Le module ne fait pas de mDNS lui-même — il n'en reçoit que le résultat

`room-discovery` ne prend que `MdnsRecordLike { name, host, port, txt? }` (l.79-84) **déjà résolu** ; le browse réel vit dans `src/main/discovery-bridge.ts` (qui importe le module, l.26). Le module est donc plus strict que « mDNS seulement » : il est **sans I/O**.

### 3.3 Transitivement, rien de `node:*` dans `src/engine`

```
$ grep -rn "node:" src/engine
src/engine/rtc/ice-filter.ts:11:  *   - aucun import (ni electron, ni ws, ni node:*, ni rien) ;
src/engine/index.ts:9:  * Aucun import de `node:*` ni d'`electron` : `src/engine` est exécutable et
```

Deux occurrences, deux **commentaires**. Donc même le graphe d'imports complet (§2.2) ne charge aucun module `node:`.

### 3.4 Les deux fichiers de tests n'ouvrent rien

```
$ grep -n "net\|fetch\|http\|socket\|dgram\|child_process" tests/room-discovery.node.test.ts
22:} from '../src/engine/net/room-discovery.ts'
24:import type { MdnsRecordLike } from '../src/engine/net/room-discovery.ts'

$ grep -n "node:" tests/room-discovery.node.test.ts tests/room-discovery-sec.node.test.ts
tests/room-discovery.node.test.ts:11:import assert from 'node:assert/strict'
tests/room-discovery.node.test.ts:12:import { test } from 'node:test'
tests/room-discovery-sec.node.test.ts:26:import assert from 'node:assert/strict'
tests/room-discovery-sec.node.test.ts:27:import { test } from 'node:test'
```

Seuls `node:assert/strict` et `node:test` : aucun module réseau chargé par les tests (les 2 hits de la 1re commande sont le chemin du répertoire `.../engine/net/`).

> **NON VÉRIFIÉ** : l'exécution des 28 tests **sans réseau** (elle exigerait un `npx tsx` refusé, §0). La preuve ci-dessus est statique mais complète : aucune primitive réseau n'existe dans le graphe chargé.

---

## 4. Sonde d'injection de nom d'annonce — **VERDICT : OK sur la propriété ICE · DÉFAUT DEF-1 sur le filtre du nom**

### 4.1 Pourquoi la propriété tient (lecture)

```
$ grep -n -A 8 "^function isLanHost" src/engine/net/room-discovery.ts
123:function isLanHost(host: string): boolean {
124-  return isLanCandidate(`candidate:1 1 udp ${HOST_CANDIDATE_PROBE_PRIORITY} ${host} 9 typ host`)
125-}

$ grep -n -A 4 "117:function" src/engine/net/room-discovery.ts   →  isWellFormedHost (l.117-120)
118:  if (host.length === 0 || host.length > MAX_HOST_LENGTH) return false
119:  return !FORBIDDEN_HOST_CHARS.test(host)

$ grep -n -A 3 "const FORBIDDEN" src/engine/net/room-discovery.ts
67:const FORBIDDEN_HOST_CHARS = /[\s\u0000-\u001f\u007f]/
```

La ligne ICE factice est construite avec **`host` seul** (l.124) et `host` a été validé juste avant par `isWellFormedHost` (l.191) : ni espace, ni `\u0000-\u001f`, ni `\u007f`. Le nom de salon n'entre **jamais** dans cette ligne — le seul autre champ texte (`roomName`, l.204) n'est pas concaténé. Conclusion : **l'injection de jetons dans la ligne ICE est impossible par construction**, quel que soit le nom. La description de Carillon est vraie quant à la conclusion, mais **mal attribuée** : « ce filtre empêche un nom d'injection » (commentaire l.111-113) — en réalité ce filtre porte sur `host`, et le nom est hors circuit.

### 4.2 Ce que j'ai écrit — `tests/room-discovery-sec.node.test.ts` (fichier NEUF, 4 cas)

Aucune ligne de `tests/room-discovery.node.test.ts` n'est touchée. Chaque test vérifie (a) que `host`/`port`/`roomId` valent exactement ceux de l'annonce réelle, (b) un contrôle négatif (le nom ne blanchit pas un hôte public), (c) que les jetons du nom ne deviennent jamais l'hôte.

| # | Nom hostile | Attendu (déduit du code) |
|---|---|---|
| 1 | `salon des amis 10.0.0.5 9 typ host` (espaces) | accepté, `host='10.0.0.5'`, `roomId='10.0.0.5:47820'`, DTO identique au témoin hors `roomName` ; `8.8.8.8` reste refusé ; hôte contenant des espaces refusé |
| 2 | `salon\r\ncandidate:1 1 udp 2122260223 10.9.9.9 5000 typ host` (CRLF, via `txt.roomName` qui a la priorité, l.152-154) | accepté, `host='192.168.1.30'`, `roomId='192.168.1.30:47820'` ; `93.184.216.34` reste refusé ; hôte avec CRLF refusé — **mais `roomName` conserve le CRLF (DEF-1)** |
| 3 | `candidate:1 1 udp 2122260223 192.168.1.99 47820 typ relay` | accepté avec `host='10.1.2.3'`, `roomId='10.1.2.3:47820'` (aucune trace de `192.168.1.99`) ; `203.0.113.7` refusé ; port 47899 refusé ; hôte = cette chaîne refusé |
| 4 | DEF-1, **`skip`** | rouge dès qu'on retire le `skip` : `assert.equal(/[\u0000-\u001f\u007f]/.test(roomName), false)` échoue |

Traçage manuel du cas 2 (le plus risqué), pas à pas : `readTxt` garde `txt.roomName` (l.135-142) → `resolveRoomName` prend `fromTxt` (l.152-154) → `trim()` ne retire que les bords, les `\r\n` internes restent (l.155) → `truncate` à 64 points de code, chaîne de 58 → `roomName` = chaîne avec CRLF (l.204). Les assertions `host`/`port`/`roomId` du cas 2 ne dépendent que de l.190-198 : vertes.

`npx tsx --test tests/room-discovery-sec.node.test.ts` **n'a pas pu être lancé** (§0) : « 3 pass, 1 skip » est une **prévision par lecture**, pas une mesure. Le fichier est ajouté à `scripts.test:node` (13e fichier) pour être couvert par `npm test` ; `package.json` porte la mention datée de cet ajout.

### 4.3 DÉFAUT DEF-1 — le nom n'est pas filtré lexicalement

Preuve (lecture + grep) :

```
$ grep -n -A 8 "^function resolveRoomName" src/engine/net/room-discovery.ts
151:function resolveRoomName(txt: Record<string, string>, recordName: string): string {
152-  const fromTxt = txt['roomName']
153-  const candidate =
154-    typeof fromTxt === 'string' && fromTxt.trim().length > 0 ? fromTxt : recordName
155-  const trimmed = candidate.trim()
156-  if (trimmed.length === 0) return FALLBACK_ROOM_NAME
157-  return truncate(trimmed, MAX_ROOM_NAME_LENGTH)
158-}

$ grep -n "FORBIDDEN" src/engine/net/room-discovery.ts
67:const FORBIDDEN_HOST_CHARS = /[\s\u0000-\u001f\u007f]/
119:  return !FORBIDDEN_HOST_CHARS.test(host)
```

Entre l.151 et l.158 : **aucun** contrôle de caractère. `FORBIDDEN_HOST_CHARS` n'est testé qu'à l.119, dans `isWellFormedHost(host)`. Donc :

- `roomName` peut contenir `\r`, `\n`, `\t`, `\u0000`… (seuls les bords sont `trim()`és, la longueur est bornée à 64 points de code) ;
- la valeur traverse l'IPC sans être assainie : `guard.string` ne contrôle **que la longueur** —

```
$ grep -n -A 10 "string(source: Dict" src/shell/ipc-contract.ts
289-    if (value.length < min || value.length > max) {
290-      this.invalid(`${path}.${key}`, `longueur hors bornes [${min}, ${max}]`);
291-      return null;
292-    }
```

  (bornes 1..64, l.402) — un nom de 58 caractères avec CRLF passe ;
- elle est **affichée** : `src/renderer/App.tsx:323` `{room.roomName}`, `src/renderer/Room.tsx:52` `{room.roomName ?? ...}`. Rendu en nœud texte React → **pas de XSS**, mais retour à la ligne / tabulation dans un libellé, et **injection de ligne dans tout journal** qui concatène `roomName`.

**Sévérité : faible** (affichage + journaux ; **aucun** contournement de la règle LAN, la décision ne dépend pas du nom). **Propriétaire : Carillon** (je ne touche pas à `room-discovery.ts`). Correctif suggéré, non appliqué : réutiliser le même prédicat que pour l'hôte sur le nom — remplacer les caractères de contrôle par une espace, ou refuser l'annonce (`null`) quand `FORBIDDEN_HOST_CHARS` matche `roomName` ; et corriger le commentaire l.111-113 qui attribue au filtre un rôle qu'il n'a pas.

---

## 5. Liste des défauts et observations

| Id | Gravité | Objet | Preuve | Propriétaire |
|---|---|---|---|---|
| **DEF-1** | faible (affichage/journaux, pas de contournement LAN) | `roomName` n'est pas filtré lexicalement : `\r\n` et caractères de contrôle conservés dans le DTO, puis à travers l'IPC jusqu'au rendu | §4.3 — `resolveRoomName` l.151-158, `FORBIDDEN_HOST_CHARS` utilisé seulement l.119, `guard.string` l.289-292, `App.tsx:323` | Carillon |
| **DOC-1** | — (documentaire) | Le commentaire l.111-113 dit que le filtre lexical empêche *« un nom d'annonce »* d'injecter des jetons : le filtre porte en réalité sur `host`; le nom est protégé parce qu'il n'entre jamais dans la ligne, pas parce qu'il est filtré | §4.1 | Carillon |
| **OBS-1** | — (hors périmètre, à trancher par Régie) | Le registre est clé par **nom d'annonce** (`key: rawName.trim()`, l.209), pas par `roomId` : deux salons distincts portant le même nom (typiquement le défaut `'Salon LAN'`, l.55) se recouvrent — le second écrase le premier, et un nom uniquement composé d'espaces donne une clé `''` partagée | l.171 (commentaire), l.209, `upsert` l.274+ | Carillon / Régie |

Aucun autre écart trouvé sur les quatre points demandés.

---

## 6. Ce que le banc n'a pas vérifié (nommé comme tel)

1. **Aucune exécution** de ma part dans ce run (§0) : ni les 28 tests de Carillon, ni mes 3 tests adversariaux, ni le run « fichier isolé », ni le run « sans réseau ». Tout ce qui précède est **statique**.
2. Le **28/28 exit=0 à 00:26:53** est repris de Régie ; je n'ai vérifié que le **nombre** de cas (28, `grep -c "^test("`).
3. Le **comportement à l'exécution** du cas 4 (skip → rouge) est déduit du code, pas observé.
4. **Couverture LAN réelle** (sous-réseau, mDNS) : hors sujet de ce module (il ne fait aucune I/O) — non traitée ici.
5. `docs/TESTS.md` et le compteur « 12 fichiers / 371 tests » de `scriptsNote` **ne sont pas à jour** de mon ajout (13e fichier, +3 tests +1 skip) : je n'ai pas réécrit ce total puisque je ne peux pas le mesurer ; la mention datée de l'ajout est dans `package.json`.

## 7. Reproductibilité — à lancer par l'ayant-droit

```
cd /work/lan-voice
npx tsx --test tests/room-discovery-sec.node.test.ts   # attendu : 3 pass, 1 skip, exit=0
npx tsx --test tests/room-discovery.node.test.ts       # attendu : 28 pass, exit=0
npm test                                               # attendu : 13 fichiers, exit=0
# preuve de DEF-1 (rouge) : retirer `{ skip: … }` du dernier test du fichier sec, puis :
npx tsx --test tests/room-discovery-sec.node.test.ts   # attendu : 1 fail (caractère de contrôle dans roomName)
```

Commandes statiques de ce rapport (toutes rejouables, sorties citées au fil du texte) : `wc -l`, `grep -c "^test("`, et les `grep -n` des §1 à §4.

---

**Synthèse** : points 1, 2, 3 → **OK** sur preuves statiques (aucun littéral d'adresse, source unique `isLanCandidate`, `import type` unique vers `src/shell`, zéro cycle, zéro `node:*` dans `src/engine`, zéro primitive réseau) ; point 4 → **OK** sur la propriété d'injection ICE (impossible par construction), **DÉFAUT DEF-1** sur le filtre lexical du nom. Exécution : **refusée** à ce run, donc aucun chiffre de test produit par moi.
