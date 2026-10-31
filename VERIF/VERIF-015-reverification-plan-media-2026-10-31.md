# VERIF-015 — plan média : 6 items rejoués, 4 clos par mesure, 2 défauts trouvés

**Banc** · 2026-10-31T01:39:52Z · canon `/work/lan-voice` · suite de VERIF-014 (T14c) · commande de T15c
Hôte : Linux 7.0.0-1019-nvidia aarch64 · node v22.23.4 · npm 10.9.9 · tsx v4.23.15
Statut : **15 contrôles adversariaux + 452 tests de la suite + 24 mesures contre une pile WebRTC réelle, tous
exécutés ici. Sur les 6 items de VERIF-014 : 4 clos par mesure (a, b, c, f), 1 clos avec réserve (d),
1 partiellement clos (e). 2 défauts du plan média trouvés par falsification. 6 mesures restent hors
d'atteinte de cet hôte, raisons nommées §6.**

---

## 0. Verdict

1. **La prémisse de VERIF-014 était périmée par la livraison, pas par la nature.** `media-plane.ts` est là,
   `sha256 = 9dbba690…90327`, 14 217 o — mesuré deux fois, à 01:35 et à 01:39 (§2).
2. **J'ai rejoué les 6 items contre cet artefact.** Trois leviers ont été utilisés : la doublure de Carillon
   (`tests/fake-rtc.ts`, atterrie à 01:34:10Z pendant que je mesurais), **et une pile WebRTC réelle en Node
   (libwebrtc via `@roamhq/wrtc`)** que j'ai trouvée et fait tourner — c'est ce qui débloque les items (a),
   (b), (c) et (f), que je croyais hors d'atteinte (§4.2, §5).
3. **Phrase sans ambiguïté sur le produit** : `createMediaPlane` **est** dans le bundle (1 occurrence), le micro
   est ouvert, le PTT est câblé — **mais `attach`/`accept`/`addRemoteCandidate` n'ont AUCUN appelant dans
   `src/renderer` (grep = 0), donc aucune `RTCPeerConnection` n'est jamais construite dans le produit :
   deux participants ne peuvent pas s'entendre.** Mesuré, pas déduit : §3, contrôle `F0`.

---

## 1. Ce qui a atterri pendant que je mesurais

Je mesure des artefacts qui bougent. Tout ce qui suit est horodaté pour que le prochain lecteur sache
contre quoi ce rapport a été écrit.

| artefact | atterrissage (mtime) | empreinte |
|---|---|---|
| `src/engine/rtc/media-plane.ts` | 2026-10-31 02:31:34 +0100 (01:31:34Z) | `9dbba690…9090327`, 14 217 o |
| `src/engine/rtc/media-config.ts` | 02:29:16 +0100 | `a5204654…37f4b8fc`, 9 242 o |
| `src/engine/rtc/ice-filter.ts` | (antérieur) | `80110d8a…1232336e` |
| `tests/fake-rtc.ts` (T15a, Carillon) | **02:34:10 +0100 (01:34:10Z)** | `97ed1db1…7b3a52a5d1`, 14 935 o |
| `src/renderer/voice.ts` (T15b, Cadre) | 02:34:49 +0100 | (branché sur `Room.tsx`) |
| `dist/main/index.js` | 02:38:05 +0100 | `77534730…338fe981`, 19 530 o |
| `dist/renderer/assets/index.js` | 02:38:05 +0100 | `ca134a56…c6819312`, 32 553 o |

`tests/fake-rtc.ts` **n'existait pas** à mon premier `find` (01:35:47Z) et existait au second (01:36:0x).
C'est la même cause d'écart que celle qui avait périmé VERIF-014 : trois tâches T14/T15 écrivent en parallèle.

---

## 2. Re-certification de tes chiffres — je ne t'ai pas cru, j'ai mesuré

| ton chiffre (01:32:11Z) | ma mesure | verdict |
|---|---|---|
| `sha256 media-plane.ts = 9dbba690…90327` | identique, deux fois (§7 cmd 1) | **CONFIRMÉ** |
| `14 217 o` | `stat` → 14 217 | **CONFIRMÉ** |
| `grep RTCPeerConnection src *.ts = 8 (6 media-plane, 2 media-config)` | 8 (`grep -rn`, EXIT=0) ; 9 aujourd'hui, `voice.ts:12` s'est ajoutée depuis | **CONFIRMÉ** à ton instant |
| « ZÉRO en prose seule » | **4 des 8 sont des commentaires** (`media-plane.ts:10`, `:128`, `media-config.ts:19`, `:153`) ; 4 sont du code (`:49` type d'interface, `:75` champ `pc`, `:210` type de paramètre, `:230` **`new RTCPeerConnection`**) | **INFIRMÉ** |
| `tsc --noEmit EXIT=0` | EXIT=0, **0 ligne** de sortie | **CONFIRMÉ** |
| `431/431 tests pass` | **452/452**, `fail 0`, EXIT=0 | **CONFIRMÉ** à ton instant — la suite a crû de 21 (média + voix) |
| `npm run build` | EXIT=0, **déterministe** : deux builds consécutifs ⇒ empreintes identiques | mesuré (tu ne l'avais pas chiffré) |
| `grep -c createMediaPlane dist/renderer/assets/index.js ≥ 1` | **1** | **CONFIRMÉ** — mais la conclusion qu'on en tire est fausse (§3, `F0`) |

**Le point qui compte** : ta métrique `grep -c createMediaPlane = 1` est valide — elle discrimine vraiment,
et je le prouve par témoin négatif : `createRoom = 0`, `reconcileDevice = 0` dans le même bundle, alors que
`isLanCandidate = 1`, `lanOnlyConfiguration = 1`, `summarizeStats = 1`, `maxaveragebitrate = 1`.
Ces noms survivent à la minification via `keepNames` (extrait verbatim du bundle :
`r(Ue,"createMediaPlane")`, `r(Z,"isLanCandidate")`, `Ie=32e3,J=[["max`). Donc **1 = la voix est dans le
bundle**, sans ambiguïté — c'est `"createMediaPlane"` en tant que chaîne, pas un identifiant local renommé.
Ce que la métrique ne dit pas, c'est si la voix **fonctionne** : voir `F0`.

---

## 3. Les 6 items de VERIF-014, rejoués — verdict, commande, exit code

Protocole : `.verif-t15/falsify-media-plane.ts` (doublure) + `.verif-t15/../wrtc/real-rtc.mts` (pile réelle).
Les deux passent par **l'API publique du produit** (`createMediaPlane`, `startMicrophone`, `attach`, `accept`,
`acceptAnswer`, `addRemoteCandidate`, `setTransmitting`, `level`, `stats`, `close`) — aucun accès aux internes.

| # | item VERIF-014 (critère d'origine) | verdict | mesure | commande / exit |
|---|---|---|---|---|
| **a** | `connectionState === 'connected'` en moins de 10 s | **CLOS** | `37 ms` mesuré (3 passes : 56 / 37 / 31 ms) ; séquence `new@0.029s → connecting@0.030s → connected@0.031s` | `npx tsx real-rtc.mts` → **EXIT=0** |
| **b** | 100 % de candidats `host` privés/loopback ; `srflx`=0 ; `relay`=0 | **CLOS** | **10/10 `host`** ; `srflx`=0, `relay`=0, `prflx`=0 ; **0 candidat hors LAN** ; **2 adresses distinctes réellement refusées** par le filtre (IPv6 global `2a01:e0a:…`, et `100.101.50.16`) | `npx tsx real-rtc.mts` → **EXIT=0** ; doublure : `F3.fuiteICE` 9/9 conformes → PASS |
| **c** | `bytesReceived > 0` et croissant sur 5 s | **CLOS** | **113 → 11 164 o en 5,0 s**, 11 échantillons, stricto croissant (~2,2 ko/s, Opus 32 kb/s plafonné) | `npx tsx real-rtc.mts` → **EXIT=0** |
| **d** | `level() > 0.001` côté réception | **CLOS avec réserve** | `level() = 0,2500` après `ontrack` avec une piste de 0,25 (doublure, `F9`) ; `0,2113` avec la doublure d'`AudioContext` sous libwebrtc. **La valeur n'a pas été alimentée par le vrai flux audio reçu** — `wrtc` n'expose pas d'`AnalyserNode` | `npx tsx .verif-t15/falsify-media-plane.ts` → **EXIT=1** (contrôle `F9` = PASS) |
| **e** | 0 événement réseau hors du sous-réseau | **PARTIELLEMENT CLOS** | Statique : **0 URL `http(s)://`**, **0** `dns.*` / `net.connect` / `socket` / `fetch(` / XHR dans `src` (`grep` EXIT=1). Runtime : `iceServers: []` sur les 3 pairs (`F1`), `iceTransportPolicy: 'all'`, pool 0 ⇒ aucun STUN/TURN donc **aucune résolution DNS publique possible**. Réel : 0 candidat hors LAN, 2 refus effectifs. **Non mesuré : la capture au niveau socket (aucun `tcpdump`/`ss` autorisé ici).** | `grep -rn 'https\?://' src` → **EXIT=1** ; `F1.iceServers` PASS ; `real-rtc.mts` EXIT=0 |
| **f** | `rttMs` rapporté (non jugé) | **CLOS** | `0 ms` sur les 2 premières secondes, puis **`1 ms`** stable (boucle locale, donc plancher) | `npx tsx real-rtc.mts` → **EXIT=0** |

**Aucun item n'est clos sans la commande et l'exit code ci-contre.** Les deux qui ne le sont pas entièrement
le disent : (d) pour la provenance de la valeur, (e) pour le niveau d'observation.

---

## 4. Falsification du plan A — deux étages

### 4.1 Étage 1 — doublure `tests/fake-rtc.ts` (Carillon, T15a) : 15 contrôles, 13 PASS, 2 ÉCHEC

Commande : `npx tsx .verif-t15/falsify-media-plane.ts` → **EXIT=1** (1 = au moins un échec, c'est voulu).
Angle volontairement différent de `tests/media-plane.node.test.ts` : je cherche à casser, pas à confirmer.

```
PASS   F0.produitSansPair   createMediaPlane + startMicrophone (flux exact de voice.ts) ⇒ 0 RTCPeerConnection
                            construite(s) ; micro ouvert=1
PASS   F1.iceServers        3 pc ; iceServers vides partout ; iceTransportPolicy=[all,all,all]
PASS   F2.uneParPair        attach('a') rejoué ⇒ 3 pc (attendu 3)
PASS   F7.closeIdempotent   close() ×2 sans jet ; pc fermées 3/3
PASS   F3.fuiteICE          9/9 conformes au contrat ; fuites (publique/relay/srflx/prflx) = 0 sur 5 émis
PASS   F3b.finCollecte      candidat null (fin de collecte) : émission supplémentaire = 0
ÉCHEC  F4.renegociation     attach() AVANT micro : senders 0→1, createOffer 1→1, setLocalDescription 1→1
                            ⇒ AUCUNE renégociation
PASS   F5.pairInconnu       candidat pour un pair jamais attaché ⇒ 0 pc créée
PASS   F6.plafondFile       300 candidats déposés avant acceptAnswer() ⇒ 256 ajoutés (plafond tenu)
PASS   F8.statsMapping      {"bytesSent":1200,"bytesReceived":3400,"packetsLost":2,"rttMs":13} exact
PASS   F9.ontrack           onRemoteStream 1 fois ; niveau agrégé = 0,2500
PASS   F10.pttAvantMicro    jamais d'audio non demandé (écritures [false,false]) mais l'appui PTT est perdu
PASS   F11.opusReponse      answer mungé dans le retour ET dans localDescription
ÉCHEC  F12.candidatDegenere candidate:"" toléré | {} toléré | candidate:null toléré | null JETTE
                            (Cannot read properties of null (reading 'candidate'))
PASS   F13.sansWebRTC       sans global : ReferenceError franche, pas de silence
TOTAL 15 contrôles, 2 échec(s)
```

**DÉFAUT-1 — pas de renégociation après `addTrack`.** `media-plane.ts` ajoute la piste locale aux pairs
existants (`attachLocalTrack`, appelé par `startMicrophone`) **sans jamais déclencher d'offre** :
`grep -rn 'onnegotiationneeded\|addTransceiver' src` → **EXIT=1, aucune occurrence**. Si le micro est ouvert
après la négociation, la piste est ajoutée à une session déjà négociée et **l'audio ne circule jamais**.
*Atteignabilité aujourd'hui : nulle* — `voice.ts:188` appelle `startMicrophone()` avant tout `attach`, et
`attach` n'est de toute façon jamais appelé (§3 `F0`). C'est un défaut **latent**, pas un défaut actif, et il
deviendra actif le jour où la signalisation sera branchée si l'ordre n'est pas imposé. Correctif attendu :
`pc.onnegotiationneeded` + un chemin de ré-offre, ou `addTransceiver` à la construction.

**DÉFAUT-2 — `addRemoteCandidate(remoteId, null)` jette.** La spec WebRTC utilise `candidate: ''` comme
fin-de-collecte, et le module tolère `''`, `{}` et `{candidate: null}` — mais pas `null` : `TypeError:
Cannot read properties of null (reading 'candidate')`. Un pair qui propage un `null` brut (ce que fait
naturellement un code qui recopie `event.candidate`) fait jeter la promesse côté appelant.

### 4.2 Étage 2 — pile WebRTC **réelle** en Node : ce que je croyais impossible et qui marche

`npm i @roamhq/wrtc` → **EXIT=0**, 4 paquets, 2 s. Le binaire natif libwebrtc se charge en aarch64 :

```
RTCPeerConnection = function | MediaStream = function | RTCAudioSource = function
```

Trois exécutions de `real-rtc.mts`, **EXIT=0** chacune, avec le produit tel quel (globals `RTCPeerConnection`,
`MediaStream`, `navigator.mediaDevices.getUserMedia` fournis par `wrtc`, source audio réelle 440 Hz) :

| mesure | passe 1 | passe 2 | passe 3 |
|---|---|---|---|
| connexion (a) | 56 ms | 37 ms | 31 ms |
| candidats (b) | 10/10 `host` | 10/10 `host` | 10/10 `host` |
| hors LAN | 0 | 0 | 0 |
| `bytesReceived` 5 s (c) | 105 → 9 835 | 108 → 10 018 | 113 → 11 164 |
| `rttMs` (f) | 1 | 1 | 1 |
| SDP Opus 32 k accepté | oui | oui | oui |

Adresses réellement collectées : `192.168.1.135`, `172.17.0.1` (docker), `fd7a:115c:a1e0::4533:3211`
(ULA), `::1`, `127.0.0.1`. Adresses réellement **refusées** par le filtre : `2a01:e0a:b6e:a590:…`
(IPv6 global) et `100.101.50.16` (**CGNAT 100.64/10 — c'est une adresse de tailnet**).

> **Conséquence de conception à arbitrer, pas un défaut** : sur un poste dont le « LAN » est un tailnet
> (`100.64.0.0/10`), le filtre refuse l'adresse et **la voix ne passera pas**. C'est cohérent avec la
> promesse « LAN only » telle qu'elle est écrite dans `ice-filter.ts` (RFC1918, link-local, loopback, ULA,
> mDNS) ; ce n'en est pas moins une décision produit à valider explicitement.

`offerHasOpus32k: true` prouve en plus que **libwebrtc accepte le SDP mungé** du produit — ce n'était
jusqu'ici vérifié que contre une doublure.

Le code de sortie 139 (SIGSEGV) apparaît si on laisse la boucle d'événements se vider (démontage de
libwebrtc). Le harnais sort par `writeSync` + `process.exit`, ce qui donne EXIT=0 reproductible ; c'est un
détail de démontage, pas une instabilité de la mesure.

---

## 5. Ton blocage runtime : confirmé, et contourné

```
./node_modules/electron/dist/electron --version
→ error while loading shared libraries: libgobject-2.0.so.0
→ EXIT=127
ldd ./node_modules/electron/dist/electron | grep -c 'not found' → 26
```

**Ton constat est exact et je le certifie indépendamment** : 26 bibliothèques absentes, aucune pile Chromium
ne démarre sur cet hôte (niveau système, aarch64). Conséquence : tout item qui exige un `RTCPeerConnection`
*de navigateur* reste hors d'atteinte **par cette pile**.

Mais la pile n'est pas la seule : **`wrtc` fournit libwebrtc en processus Node, sans X11, sans GLib, sans
Chromium** — et c'est prouvé ci-dessus (§4.2). Ce qui reste hors d'atteinte n'est donc plus « le média »,
c'est « le navigateur » : les couches que seul Chromium apporte (`getUserMedia` sur un périphérique physique,
`AnalyserNode` réel, mDNS obfusqué côté navigateur, cache média/périphérie).

---

## 6. Ce qui reste non mesuré, et pourquoi — sans ambiguïté

1. **Écho de bout en bout avec du vrai son acoustique** — non mesuré. `wrtc` me donne des *paquets audio
   réels* (§4.2, `bytesReceived` croissant), pas une *onde acoustique* : il n'y a ni périphérique de capture
   ni haut-parleur, et l'`AnalyserNode` est une doublure. Ce qui est prouvé : le transport, le débit, le RTT,
   la négociation, le munge SDP. Ce qui ne l'est pas : que ce que l'un dit soit compris par l'autre.
2. **Deux machines sur le LAN + mDNS réel** — non mesuré. Un seul hôte ici ; `avahi`/`dns-sd` non disponibles
   et aucune seconde machine dans le périmètre. Le mDNS du produit vit dans `src/main/discovery-bridge.ts` et
   n'a pas été exercé contre un vrai répondant.
3. **Perte de 5 % de paquets** — non mesuré. Aucun `tc netem` possible (pas de `NET_ADMIN`). Route identifiée :
   relais UDP Node interposé entre les deux pairs (les candidats étant échangés en mémoire, réécrire
   l'adresse du candidat vers le relais est direct), avec abandon d'1 datagramme sur 20 — faisable, non fait.
4. **CPU au repos et en conversation** — non mesuré. Le CPU du produit est celui d'Electron, qui ne démarre pas
   (§5). Mesurer le CPU de `wrtc` mesurerait mon harnais, pas l'application : je ne le fais pas et je ne le
   présente pas comme l'application.
5. **Item (d) — provenance de la valeur `level()`** : la chaîne `ontrack → AnalyserNode → level()` s'exécute,
   mais sur une doublure d'analyseur ; la valeur publiée (0,2113) ne prouve rien sur le signal reçu.
6. **Item (e) — capture socket** : j'ai mesuré les API JS (0 URL, 0 DNS, `iceServers: []`, 0 candidat hors
   LAN). Je n'ai pas vu un octet sortir ou ne pas sortir : c'est un cran d'observation en moins, et je le
   nomme comme tel.

Aucun de ces six points n'est marqué clos, et aucun n'est présenté comme un « ça marche ».

---

## 7. Reproductibilité — les commandes exactes

```bash
# 1. l'artefact et son empreinte
cd /work/lan-voice && sha256sum src/engine/rtc/media-plane.ts dist/main/index.js dist/renderer/assets/index.js
#   → 9dbba690…9090327 / 77534730…338fe981 / ca134a56…c6819312

# 2. le build, et son déterminisme (deux passes ⇒ mêmes empreintes)
npm run build   → EXIT=0

# 3. la voix est-elle dans le bundle, et la métrique discrimine-t-elle ?
grep -c createMediaPlane dist/renderer/assets/index.js   # → 1
grep -c createRoom       dist/renderer/assets/index.js   # → 0  (témoin négatif)
grep -o '.\{20\}createMediaPlane.\{20\}' dist/renderer/assets/index.js  # → r(Ue,"createMediaPlane")

# 4. typage
npx tsc --noEmit → EXIT=0, 0 ligne

# 5. suite complète (elle inclut désormais le média)
npx tsx --test tests/*.test.ts  → EXIT=0, 452 tests, 452 pass, 0 fail
npm test                        → EXIT=0, 452 / 452 / 0

# 6. falsification contre la doublure (15 contrôles, 2 échecs attendus)
npx tsx .verif-t15/falsify-media-plane.ts → EXIT=1

# 7. falsification contre une pile WebRTC RÉELLE, sans Chromium
bash .verif-t15/run-real-rtc.sh   → EXIT=0     # installe @roamhq/wrtc au premier run, puis mesure

# 8. le blocage Electron, chiffré
./node_modules/electron/dist/electron --version                    # EXIT=127
ldd ./node_modules/electron/dist/electron | grep -c 'not found'    # 26
```

---

## 8. Ce que je corrige dans mes propres écrits

- **VERIF-014, §2 (« plan A impossible : il n'y a pas de module média »)** : exact à 01:26Z, périmé à 01:31Z.
  Ta lecture est la bonne — cause d'ordonnancement, pas cause de nature. Je ne réécris pas VERIF-014 : je
  laisse la trace et je la périme ici, ce qui est plus honnête qu'un rapport rétro-corrigé.
- **Le statut « NON EXÉCUTÉ » de mon harnais de VERIF-014** est levé, mais **pas par mon harnais** : par
  celui de Carillon (`fake-rtc.ts`), auquel j'ai ajouté mon propre jeu de 15 contrôles adversariaux, puis par
  `wrtc`. Le harnais de VERIF-014 n'est toujours pas exécuté et je ne prétends pas le contraire.
- **Ce que j'avais classé « hors d'atteinte » à tort** : `connectMs`, les candidats réels, `bytesReceived`,
  le RTT. Ce n'était pas hors d'atteinte — c'était hors de *ma* pile. Un `npm i` l'a levé. La leçon vaut pour
  la suite : « Chromium ne démarre pas » ne veut pas dire « pas de WebRTC ».

---

*Banc — VERIF-015. Copie canon : `/work/lan-voice/VERIF/VERIF-015-reverification-plan-media-2026-10-31.md`.
Harnais rejouables : `/work/lan-voice/.verif-t15/` (`falsify-media-plane.ts`, `run-verif-015d.sh`,
`wrtc/real-rtc.mts`, `run-real-rtc.sh`, `LISEZ-MOI.md`).*
