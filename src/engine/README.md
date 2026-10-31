# src/engine — Carillon

Moteur **pur** de l'application vocale LAN : tout ce qui est décidable sans réseau,
sans carte son et sans navigateur. Le réseau (WebRTC, mDNS, signalisation) vit
ailleurs (`src/main/`, Cadre) ; ici on ne trouve que des fonctions déterministes,
testables avec `node --test`, **sans aucune dépendance externe**.

## Commandes de vérification

```bash
cd /work/lan-voice
npm test                                           # toute la suite
node --test tests/vad.test.ts                      # un fichier seul, sans npm
node --test tests/gain.test.ts tests/room.test.ts  # plusieurs fichiers
```

> **Ne pas recopier ici la liste des fichiers de test.** Cette énumération a déjà
> dérivé deux fois (7 cités pour 14 sur disque, puis 19 pour 20) : elle n'a pas sa
> place dans un README. Liste de référence = `package.json#test:node` (c'est lui qui
> garde `tests/scripts-coverage.node.test.ts`) ; mesure datée avec exit codes =
> `docs/TESTS.md` (Banc). Au **2026-10-31T02:03Z** : `npm test` → **exit=0**,
> **530 tests / 530 pass / 0 fail / 28 suites**, **20** fichiers sous `tests/*.test.ts`.

`tests/ice-filter.test.ts` (Banc) a d'abord été écrit pour vitest ; il importe
désormais `node:test` comme le reste de `tests/` et tourne sous `node --test`
(mesuré 2026-10-31T02:03Z : 15/15, exit=0). `tests/ice-filter.node.test.ts` reste sa
réplique autonome, utile pour rejouer le contrat (mêmes listes ACCEPTED/REJECTED)
sans passer par npm.

Typecheck (mesuré 2026-10-31T02:03Z, TypeScript du dépôt) :

```bash
npx tsc --noEmit -p tsconfig.json   # exit=0, 0 ligne ; `allowImportingTsExtensions` couvre les imports .ts
```

---

## Ce qui est implémenté et comment c'est censé marcher

### `rtc/ice-filter.ts` — aucun candidat hors du LAN

`isLanCandidate(candidate: string | RTCIceCandidateInit): boolean` et
`filterLanCandidates<T extends string | RTCIceCandidateInit>(list: T[]): T[]`
accepte la ligne SDP (`candidate:…`, avec ou sans préfixe `a=`) **et** l'objet
`RTCIceCandidateInit` (champ `candidate`).

Règle : `typ host` est la seule voie. On accepte hôte + RFC1918 (10/8,
172.16/12, 192.168/16), link-local (169.254/16, fe80::/10), loopback (127/8, ::1),
ULA (fc00::/7) et nom mDNS `.local`. On rejette `srflx`, `prflx`, `relay` — y
compris quand l'adresse mappée est privée — et tout `host` sur adresse publique
(8.8.8.8, 1.1.1.1, CGNAT 100.64/10, 172.32.0.1, 192.169.0.1, 11.0.0.1).

C'est du **parsing de chaîne pur** : pas de `dns.lookup`, pas de `RTCPeerConnection`,
rien qui puisse partir sur le réseau. Raison d'être : Cadre branche ce prédicat sur
`onicecandidate` et n'ajoute à la description que ce qui est accepté. Deux postes du
même LAN ne peuvent alors négocier que par leurs adresses locales — la mesure C1 = 0
(de zéro requête hors LAN) n'est pas une promesse, c'est une conséquence de structure.

Fonctions annexes exportées (diagnostic, pas décision) : `parseCandidateString`,
`evaluateCandidate` (motif de rejet stable : `empty`, `malformed`, `not-host-type`,
`public-address`…), `isLanAddress`, `filterLanSdp(sdp: string): string` pour filtrer
un bloc SDP complet sans toucher aux autres lignes.

Un nom mDNS `.local` est accepté **volontairement** : c'est la forme par défaut des
hôtes dans Chromium. Le rejeter rendrait le maillage impossible entre deux machines
qui n'ont pas désactivé le masquage mDNS — alors qu'un `.local` ne résout que sur le
lien local, donc ne sort pas du LAN.

### `vad.ts` — porte du micro par trames de 20 ms

`stepVad(state, frame) → VadState` (`{ speaking, levelDb, changedAtFrame, frame,
aboveFrames, belowFrames }`), pur, sans horloge : le temps est compté **en trames**
(1 trame = 20 ms = 960 échantillons à 48 kHz). `stepVadDetailed` ajoute `zcr`,
`voiced` et la `transition` (`'open'` / `'close'` / `'none'`).

1. RMS → dBFS (plancher −100, jamais `-Infinity`).
2. ZCR : garde-fou anti-bruit. Un bruit large bande à −10 dBFS a un ZCR ≈ 0,5 et
   **n'ouvre pas** ; une voix voisée à 200–300 Hz est à ≈ 0,01.
3. Hystérésis : ouverture à **−38 dBFS**, fermeture à **−45 dBFS**. Entre les deux
   la porte ne bouge pas.
4. Tenue : **2 trames (40 ms)** au-dessus du seuil avant d'ouvrir, **6 trames
   (120 ms)** sous le seuil avant de fermer (hangover). 40 ms filtrent clics de
   souris et toux ; 120 ms couvrent les occlusives (p, t, k) et empêchent la fin des
   mots d'être hachée.
5. Push-to-talk : `gateOpen('ptt', _, held)` rend exactement l'appui — micro coupé
   au repos, ouvert pendant l'appui, sans attaque ni hangover. En `vad`, la porte
   automatique fait foi et l'appui est ignoré.

Le vumètre est séparé : `createLevelMeter` / `pushLevel` / `meterMedianDb` tiennent
une **médiane glissante sur 3 s** (150 trames) — estimateur robuste du plancher de
bruit, insensible aux pics de parole — et alimentent le mode `auto` du gain.

### `gain.ts` — modes auto / manual / muted, rampe smoothstep

`stepGain(state, { mode, manualDb?, levelDb?, noiseFloorDb? })` : la cible est
clampée dans **[-60 dB, +12 dB]**, la rampe est un **smoothstep** (dérivée nulle aux
deux bouts, donc pas de clic au raccord), **attaque 20 ms** (une trame) et
**relâche 120 ms** (six trames). `frameGains(state)` rend les 960 gains d'une trame
et `applyFrameGain` les applique.

`auto` normalise vers −18 dBFS et n'amplifie jamais sous le plancher de bruit ;
`manual` suit le curseur ; `muted` vise **exactement 0** d'amplitude après la rampe
(un mute n'est pas −60 dB : le résidu s'entend en sommation). `percentToGainDb` /
`gainDbToPercent` font la passerelle avec le volume d'UI 0–200 %, `duckedPercent`
avec l'atténuation automatique quand quelqu'un parle.

### `device.ts` — repli stable, jamais de `throw`

`chooseDevice(list, { preferredId, fallback: 'default' })` : préféré présent →
retenu ; absent → repli sur `default`/`communications` (ou premier utilisable) avec
une `reason` qui **nomme l'identifiant manquant** ; liste vide ou inexploitable →
`{ deviceId: null, code: 'empty-list', reason }`, **jamais d'exception**.

`reconcileDevice(previousId, list, options)` couvre le cas qui casse la moitié des
applis de visio — le casque débranché en pleine réunion : toujours là → `'kept'`,
rien ne bouge ; disparu → repli motivé (`'previous-missing'`). Le choix est
déterministe, donc stable tant que le périphérique reste disponible.

### `room.ts` — machine d'état, plafond de maillage 10

`dispatch(room, event) → { ok, code, reason, room, effects, entry }`, pur : l'état
reçu n'est jamais muté. États : `idle → joining → connected ↔ reconnecting → left`,
`left` terminal. Une transition illégale est **refusée avec un motif** et l'état ne
bouge pas ; le refus est **journalisé** (`JournalEntry.seq` strictement croissant,
`from`/`to`/`ok`/`code`/`reason`). Aucune exception, jamais.

Les effets (`join-transport`, `retry-transport`, `leave-transport`, `open-peer`,
`close-peer`, `reject-peer`, `notify`) sont la frontière avec la couche réseau : la
machine dit *quoi faire*, elle ne le fait pas — c'est ce qui la rend testable sans
deux postes.

Plafond : `MAX_MESH_PARTICIPANTS = 8` (soi-même compris, 28 liens à décoder,
arbitrage desk-lead aligné sur SPEC-001 A2), et une capacité par salon **bornée** à
ce plafond (`createRoom({ maxParticipants: 1…8 })`). Le 9ᵉ pair n'est **pas ignoré** : `dispatch` renvoie
`ok: false, code: 'room-full'` **et** les effets `reject-peer` + `notify` (`warn`).
Sans ça, il attendrait une réponse qui ne viendrait jamais. Une place libérée rouvre
immédiatement le salon.

## Ce qui est simulé ou factice

**Rien n'est factice dans `src/engine`.** Aucun module ne renvoie de valeur codée en
dur ni de « TODO qui fait semblant » : chaque décision est calculée. En particulier,
aucun `catch {}` silencieux, aucun `return true` de complaisance, aucun chemin qui
contourne le filtre ICE.

Ce qui est **simulé, et assumé comme tel, dans les tests** :

| Simulé | Où | Pourquoi c'est acceptable |
|---|---|---|
| Trames audio synthétiques (sinus 300 Hz au dBFS exact, bruit blanc par PRNG déterministe) | `tests/vad.test.ts` | la VAD ne voit que des `Float32Array` ; un sinus calibré en RMS teste le seuil, le ZCR et la tenue aussi bien qu'une voix, et reproductiblement |
| Listes de périphériques fabriquées (`default`, `mic-usb`, `hp-1`) | `tests/device.test.ts` | ces fonctions ne parlent jamais à `navigator` ; la forme des objets est celle de `MediaDeviceInfo` |
| Scénarios d'événements rejoués (`join`, `transport-connected`, 10 `peer-joined`) | `tests/room.test.ts` | la machine d'état est déterministe ; rejouer les événements teste exactement ce que produira le réseau |
| Candidats SDP écrits à la main, au format Chrome | `tests/ice-filter.node.test.ts` | le filtre est un parseur de chaîne : le format est la seule entrée possible |

Le graphe audio réel (AudioWorklet, `GainNode`, `getUserMedia`, `setSinkId`) et le
transport WebRTC **ne sont pas dans ce dossier** : `src/engine` s'arrête à la
décision, la plomberie est chez Cadre.

---

## Ce qui n'a pas été testé et pourquoi

1. **Deux postes sur un vrai LAN.** Pas de second poste dans cet environnement. Le
   maillage WebRTC réel (deux instances en loopback, `RTCPeerConnection` de bout en
   bout, reprise après perte de pair) **n'a pas été exécuté** : cela demande un
   navigateur et une implémentation réseau qui n'existe pas encore dans
   `src/engine` par construction. Ce qui est prouvé ici est en amont : *ce qui*
   entre dans la négociation (filtre ICE) et *quand* on émet (porte VAD + état salon).
2. **Une carte son / un micro.** Aucun périphérique audio disponible, donc aucune
   mesure de niveau réelle : les seuils −38/−45 dBFS sont testés sur des trames
   synthétiques calibrées, pas sur une voix enregistrée. Conséquence pratique : le
   réglage par défaut est un **point de départ raisonnable**, à réécouter sur du
   matériel réel (le seuil est réglable, c'est prévu pour ça).
3. **`npm install` / `vitest` / `tsc` du dépôt — levé le 2026-10-31T02:03Z.** À la
   rédaction de ce fichier il n'y avait pas de `node_modules` et l'installation
   était injoignable ; ce n'est plus le cas (`node_modules/.bin` porte `tsc` et
   `vitest`). Mesures du jour, sur la source : `npm test` → **exit=0**, 530/530,
   28 suites ; `npx tsc --noEmit -p tsconfig.json` → **exit=0**, 0 ligne ;
   `tests/ice-filter.test.ts` (écrit pour vitest à l'origine) importe `node:test` et
   passe 15/15 sous `node --test`. Ce qui reste vrai : ces tests sont **écrits pour
   `node --test`** (type-stripping natif de Node 22), donc `npx vitest run` échoue par
   construction — écart de harnais, pas défaut de code.
4. **RNNoise (WASM) et `AudioWorklet`.** Le filtre de nuisances est un module WASM
   qui tourne dans un worklet : il n'existe pas sans navigateur, et il n'entre pas
   dans `src/engine` (règle de pureté). La VAD de ce dossier est ce qui décide
   *d'ouvrir* le micro ; RNNoise nettoie le signal *une fois ouvert*. Les deux sont
   indépendants, et seul le premier est vérifiable hors navigateur.
5. **`setSinkId` / annulation d'écho du navigateur.** Ce sont des comportements
   d'implémentation (Chrome ≥ 110, Firefox partiel) : `device.ts` fournit
   l'identifiant et le repli, il ne peut pas prouver que le navigateur obéit. À
   vérifier à la première exécution réelle, casque Bluetooth inclus.
6. **Le 11ᵉ pair en conditions réelles.** Le refus est prouvé au niveau de la machine
   d'état (événement + effets) ; rien ne prouve encore que la couche réseau de Cadre
   exécute bien `close-peer` — c'est un test d'intégration à faire quand le transport
   sera branché.

---

## Arbitrages signalés (à trancher par Régie)

1. **Loopback et link-local.** La consigne orale du 30/10 demandait de *refuser*
   127/8 et 169.254/16. SPEC-001 (CA7) et `tests/ice-filter.test.ts` (Banc, qui
   « fait foi ») les **acceptent** explicitement. Le code suit la spec et le test :
   loopback et link-local sont acceptés. Refuser 127.0.0.1 rendrait impossible le
   test à deux instances sur une seule machine (Banc en a besoin), et 169.254/16 est
   joignable sur le lien local — c'est bien du LAN, même si c'est fragile.
   Bascule possible sans toucher au code : `DEFAULT_ICE_FILTER_CONFIG.allowLoopback`.
2. **Signature de `filterLanCandidates`.** La consigne T2bis demandait
   `filterLanCandidates(sdp: string): string`. Le test de Banc l'appelle avec un
   **tableau** (`filterLanCandidates([...])`). Le tableau l'emporte (test = contrat) ;
   la variante SDP existe sous un nom distinct, `filterLanSdp(sdp)`, pour ne pas
   créer d'ambiguïté sur un argument `string` qui serait tantôt une ligne, tantôt un
   bloc.
3. **Plafond de maillage 10 (T2) vs 8 (SPEC-001 A2 / SPEC-002 §10) et VAD 2/6
   trames (T2) vs 120/400 ms (SPEC-001 A12).** Le moteur suit **T2** par défaut,
   mais les deux valeurs produit restent atteignables sans toucher au code :
   `createRoom({ maxParticipants: 8 })` pour la capacité, et
   `{ attackFrames: 6, releaseFrames: 20 }` pour la tenue de la VAD. Une seule
   valeur doit rester dans les specs produit, sinon l'UI et le moteur divergeront.
   Détail et justifications : `SPECS/SPEC-003-moteur.md` §7.
4. **`isLanCandidate` et `undefined`.** Le type déclaré est
   `string | RTCIceCandidateInit`, mais le test appelle `isLanCandidate(undefined)`
   et attend `false` sans exception : le code traîne le cas `null`/`undefined` au
   runtime (`candidateLineOf`) sans polluer la signature publique.
