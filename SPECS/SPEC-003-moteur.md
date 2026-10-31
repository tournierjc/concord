# SPEC-003 — Moteur pur (`src/engine`)

Statut : **implémenté** (T2, Carillon). Portée : les quatre modules décidables du
moteur vocal — `vad`, `gain`, `device`, `room` — plus leur point d'entrée
`index.ts`. Le transport (WebRTC maillé, mDNS, signalisation) et le graphe audio
(`AudioWorklet`, RNNoise, Opus) vivent **hors** de `src/engine` : ils dépendent du
navigateur ou du réseau et ne sont pas testables ici.

Ce document fixe l'interface **exacte** (noms exportés, constantes, formes d'état)
pour que l'UI, le worklet et les tests puissent s'y brancher sans se lire.

---

## 1. Règles de pureté (vérifiées mécaniquement)

| Règle | Vérification |
|---|---|
| Aucun import `node:*`, `electron`, `ws`, `http`, `net`, `dgram`, `dns`, `tls` | `VERIF/check-engine.sh`, `tests/engine-purity.test.ts`, grep §8 |
| Aucune dépendance npm (imports relatifs uniquement, suffixés `.ts`) | idem |
| Aucun timer, aucune horloge, aucun `Math.random`, aucun `process` | idem |
| Aucun accès navigateur (`navigator.`, `window.`, `document.`, `RTCPeerConnection`) | idem |
| TypeScript « erasable syntax » : pas d'`enum`, pas de `namespace`, pas de parameter properties | idem + exécution directe par `node` (type stripping) |
| Aucune exception attendue : les entrées invalides rendent un refus motivé | tests §6 |

Conséquence de la dernière règle : **aucune fonction du moteur ne lève** sur une
entrée utilisateur (liste vide, identifiant vide, événement inconnu, état
terminal). Un `throw` dans ce périmètre deviendrait une erreur non gérée dans le
processus principal d'Electron, donc une fenêtre qui ne répond plus.

Corollaire de la pureté : le temps n'existe pas dans le moteur. Il n'y a **que des
trames**. Chaque pas avance d'exactement une trame, ce qui rend deux exécutions
identiques comparables au bit près — condition nécessaire pour rejouer un
incident (un enregistrement de salon) et retomber sur la même décision.

---

## 2. `src/engine/vad.ts` — porte du micro

### Constantes

| Nom | Valeur | Justification |
|---|---|---|
| `SAMPLE_RATE` | `48000` | Opus mono 48 kHz : la seule fréquence du moteur, on ne rééchantillonne pas. |
| `FRAME_MS` | `20` | Trame Opus par défaut ; granularité de la décision. |
| `FRAME_SAMPLES` | `960` | `48000 × 20 / 1000`. |
| `MIN_DBFS` | `-100` | Plancher du vumètre : silence numérique fini, jamais `-Infinity` (qui contaminerait toute moyenne). |
| `OPEN_DBFS` | `-38` | Ouverture : au-dessus du bruit de fond d'une pièce calme, sous une voix à 30 cm. |
| `CLOSE_DBFS` | `-45` | Fermeture : hystérésis de 7 dB, assez large pour absorber les fins de mots, assez étroite pour ne pas garder une porte ouverte sur du bruit. |
| `ATTACK_FRAMES` | `2` | 40 ms : un clic de souris ou une toux n'ouvre pas le micro. |
| `RELEASE_FRAMES` | `6` | 120 ms de hangover : couvre les occlusives (p, t, k) dont le silence interne dure 40–80 ms ; sans lui, la fin des mots est hachée. |
| `ZCR_MAX` | `0,45` | Garde-fou anti-bruit : souffle ≈ 0,5, voix voisée ≈ 0,01–0,05. |
| `NO_CHANGE_FRAME` | `-1` | `changedAtFrame` quand la porte n'a jamais changé. |
| `METER_WINDOW_FRAMES` | `150` | 3 s : assez long pour ignorer une phrase, assez court pour suivre un fond qui change. |

### État

```ts
interface VadState {
  speaking: boolean        // contrat T2
  levelDb: number          // contrat T2 — dBFS de la dernière trame, ≥ MIN_DBFS
  changedAtFrame: number   // contrat T2 — index (0-based) de la trame qui a décidé
  frame: number            // index de la prochaine trame à traiter
  aboveFrames: number      // trames consécutives au-dessus de OPEN_DBFS (attaque)
  belowFrames: number      // trames consécutives sous CLOSE_DBFS (relâche)
}
```

Les trois champs de T2 sont présents tels quels. Les trois autres sont **la
condition de la pureté** : compter « 2 trames consécutives » exige de porter le
compteur dans l'état qu'on repasse à la fonction. Aucun n'est une horloge.

### API

```ts
frameSamples(config?)                     → number          // 960
frameRms(frame: ArrayLike<number>)        → number
frameDbfs(frame, config?)                 → number          // borné à MIN_DBFS
zeroCrossingRate(frame)                   → number          // 0…1
createVadState(config?)                   → VadState
stepVad(state, frame, config?)            → VadState
stepVadDetailed(state, frame, config?)    → { state, levelDb, zcr, voiced, transition }
stepAll(state, frames, config?)           → VadState
gateOpen(mode: 'vad'|'ptt', vadSpeaking, pttHeld) → boolean
createLevelMeter(window?) / pushLevel(meter, db) / meterMedianDb(meter)
DEFAULT_VAD_CONFIG: VadConfig
```

`VadConfig` = `{ sampleRate, frameMs, openDbfs, closeDbfs, attackFrames,
releaseFrames, zcrMax, minDbfs }`. Tout est paramétrable : aucune constante n'est
codée en dur dans l'algorithme.

### Algorithme (une trame)

1. `levelDb = 20·log10(RMS)`, borné à `minDbfs` ; les `NaN` de la trame sont ignorés.
2. `zcr` = changements de signe / (n−1) ; `voiced = zcr ≤ zcrMax`.
3. Porte fermée : `aboveFrames++` si `voiced && levelDb ≥ openDbfs`, sinon 0 ;
   ouverture quand `aboveFrames ≥ attackFrames` (donc à la **2ᵉ** trame), et
   `changedAtFrame` reçoit l'index de cette trame.
4. Porte ouverte : `belowFrames++` si `levelDb ≤ closeDbfs`, sinon 0 — la zone
   −45…−38 dBFS ne compte donc **ni** ouverture **ni** fermeture (hystérésis) ;
   fermeture quand `belowFrames ≥ releaseFrames`, et `changedAtFrame` est mis à jour.
5. `frame++`. L'état reçu n'est jamais muté.

### Push-to-talk

`gateOpen('ptt', _, held)` rend exactement `held` : en PTT le micro est **coupé au
repos** et ouvert pendant l'appui, sans attente d'attaque ni hangover (le locuteur
sait quand il parle ; lui imposer 40 ms serait une faute d'ergonomie). En `vad`,
la porte de la VAD fait foi et l'appui est ignoré. Le module ne lit aucune touche :
la couche UI (Cadre, `src/main/ptt.ts`) lui passe le booléen.

---

## 3. `src/engine/gain.ts` — gain par participant

### Constantes

| Nom | Valeur | Justification |
|---|---|---|
| `MIN_GAIN_DB` | `-60` | Sous −60 dB on est inaudible : autant couper. |
| `MAX_GAIN_DB` | `+12` | Maximum qu'on s'autorise à amplifier un micro lointain sans remonter le bruit. |
| `ATTACK_MS` | `20` | Une trame : la parole devient présente immédiatement. |
| `RELEASE_MS` | `120` | Six trames : une baisse ne s'entend pas, pas de « pompage ». |
| `GAIN_FRAME_MS` / `GAIN_SAMPLE_RATE` | `20` / `48000` | Même découpage que la VAD : 960 échantillons par trame. |
| `AUTO_TARGET_DBFS` | `-18` | Cible de normalisation : un ami au casque et un ami au micro interne sortent au même volume. |
| `AUTO_NOISE_FLOOR_DBFS` | `-60` | Sous ce niveau, `auto` n'amplifie pas (sinon on pompe le souffle d'une pièce vide). |
| `UNITY_GAIN_DB` | `0` | Référence 1,0. |

### Modes

```ts
type GainMode = 'auto' | 'manual' | 'muted'
```

* `manual` — `clampGainDb(manualDb ?? 0)`.
* `auto` — `clampGainDb(autoTargetDbfs − levelDb)` ; `0 dB` si le niveau est
  manquant, non fini, ou ≤ au plancher de bruit (`noiseFloorDb` du vumètre, sinon
  la constante).
* `muted` — cible `minDb` **et** amplitude finale **exactement 0** (voir §3.2).

### 3.1 Rampe

Une rampe est décrite par `{ fromDb, targetDb, elapsedFrames, rampFrames }`.
À chaque trame : `elapsedFrames++`, puis

```
db = fromDb + (targetDb − fromDb) · smoothstep(elapsedFrames / rampFrames)
smoothstep(x) = x²·(3 − 2x),  x ∈ [0,1]
```

`rampFrames = ceil(durée / frameMs)` : **1 trame en attaque (20 ms)**, **6 trames en
relâche (120 ms)**. Quand `elapsedFrames ≥ rampFrames`, `db = targetDb` exactement
(pas de résidu d'arrondi qui laisserait un souffle à −11,7 dB au lieu de −12).
Un changement de cible en cours de rampe repart du **gain courant** (`fromDb =
db`), jamais de zéro : pas de saut.

`smoothstep` et non une interpolation linéaire : sa dérivée est nulle aux deux
bouts, donc le raccord entre deux trames est continu — c'est ce qui supprime le
clic audible à chaque changement de gain.

### 3.2 Mute

Un mute n'est pas « −60 dB », c'est **0**. `gainOf(state)` rend `0` exactement
dès que la rampe de relâche est terminée en mode `muted` ; `targetGain({mode:
'muted'})` rend `0` immédiatement. Pendant la rampe, le gain reste > 0 : couper
net produirait un clic.

### API

```ts
clampGainDb(db, config?)          → number            // [-60, +12]
dbToGain(db) / gainToDb(gain)     → number            // 0 dB = 1 ; gainToDb(0) = -Infinity
smoothstep(t)                     → number
framesForMs(ms, frameMs?)         → number
gainFrameSamples(config?)         → number            // 960
percentToGainDb(pct) / gainDbToPercent(db)            // volume d'UI 0–200 %
resolveTargetDb({mode, manualDb?, levelDb?, noiseFloorDb?}, config?) → number
targetGain(input, config?)        → number            // amplitude visée (mute → 0)
createGainState()                 → GainState
stepGain(state, input, config?)   → GainState
stepAllGain(state, inputs, config?) → GainState
gainOf(state)                     → number            // amplitude à appliquer
frameGains(state, config?)        → Float32Array      // 960 gains, smoothstep intra-trame
applyFrameGain(frame, gains)      → Float32Array
duckedPercent(basePercent, duckPercent) → number      // 0–200
DEFAULT_GAIN_CONFIG: GainConfig
```

`GainState` = `{ db, fromDb, targetDb, elapsedFrames, rampFrames, frame, mode,
mutedTarget }` — tout est explicite, rien n'est caché dans une closure.

---

## 4. `src/engine/device.ts` — sélection de périphérique

### API

```ts
sanitizeDevices(list, kind = 'audioinput')       → AudioDevice[]
findDevice(list, deviceId, kind?)                → AudioDevice | undefined
isDefaultDeviceId(id)                            → boolean
chooseDevice(list, { preferredId?, fallback?: 'default', kind? }) → DeviceChoice
reconcileDevice(currentId, list, options?)       → DeviceChoice
isUsableChoice(choice)                           → boolean
DEFAULT_DEVICE_IDS = ['default', 'communications']
DEFAULT_KIND = 'audioinput'
```

```ts
interface DeviceChoice {
  deviceId: string | null
  label: string | null
  code: 'preferred' | 'preferred-missing' | 'default-device' | 'fallback-first' | 'kept' | 'previous-missing' | 'empty-list'
  reason: string        // phrase française affichable telle quelle
  requestedId: string | null
  candidates: number
}
```

### Ordre de décision

1. `preferredId` **présent** dans la liste nettoyée ⇒ retenu (`code: 'preferred'`).
2. Sinon `fallback: 'default'` : périphérique `default`/`communications` retenu ;
   `code: 'preferred-missing'` si un préféré était demandé, `'default-device'` sinon.
   La `reason` **nomme l'identifiant manquant** et dit qu'il s'agit d'un repli.
3. Sinon premier candidat : `'preferred-missing'` (avec préféré) ou `'fallback-first'`.
4. Liste vide, `null`, `undefined`, ou uniquement des entrées invalides ⇒
   `{ deviceId: null, code: 'empty-list', reason }`, **sans exception** : le micro
   reste fermé et l'UI affiche la raison.

Le nettoyage écarte les `deviceId` vides ou blancs, déduplique (le premier gagne :
l'ordre du navigateur fait foi) et filtre le `kind`.

### Stabilité

`chooseDevice` est **déterministe** : à liste et options égales, réponse identique.
`reconcileDevice` conserve `currentId` tant qu'il est présent (`code: 'kept'`) même
si un nouveau `default` apparaît ; s'il a disparu, la raison dit « débranché » et
le repli s'applique (`'previous-missing'`). Sans cette règle, chaque
`devicechange` du navigateur (casque en charge, écran qui s'allume) ferait sauter
la sélection en pleine réunion.

---

## 5. `src/engine/room.ts` — machine d'état du salon

### États et transitions

```
idle ──join──▶ joining ──transport-connected──▶ connected ──transport-lost──▶ reconnecting
  │               │                                  │  ▲                          │
  └──leave────────┴──────────leave───────────────────┴──transport-restored────────┘
                                        ▼
                                       left  (terminal)
```

| Depuis | Événement | Vers |
|---|---|---|
| `idle` | `join` | `joining` |
| `joining` | `transport-connected` | `connected` |
| `connected` | `transport-lost` | `reconnecting` |
| `reconnecting` | `transport-restored` *ou* `transport-connected` | `connected` |
| `idle`, `joining`, `connected`, `reconnecting` | `leave` | `left` |
| `left` | `leave` | `left` (idempotent, `ok: true`, sans effet) |
| toute autre combinaison | — | refus `{ ok: false, code: 'illegal-transition', reason }`, état inchangé |

`peer-joined` / `peer-left` ne sont acceptés qu'en `connected`. Après `left`, tout
événement autre que `leave` est refusé avec `code: 'room-left'`.

### Capacité — plafond de maillage

| Nom | Valeur | Justification |
|---|---|---|
| `MAX_MESH_PARTICIPANTS` | `8` | Plafond arbitré par desk-lead (SPEC-001 A2), soi-même compris. |
| `MESH_LINKS_MAX` | `28` | `n·(n−1)/2` à 8 : 28 paires, 7 pistes Opus à décoder par poste. À 10 (45 paires, 10 pistes) un portable du LAN sature en CPU avant le réseau — cf. SPEC-001 CA7. |
| `createRoom({ maxParticipants })` | `1…8` | Capacité par salon, **bornée** au plafond ; une valeur absurde (0, `NaN`, 50) est ramenée dans les bornes. |

Au-delà du plafond, le pair n'est pas ignoré : il reçoit un refus explicite
(`code: 'room-full'`, raison « plafond de 8 participants atteint ») et les effets
`reject-peer` + `notify`. Un refus silencieux laisserait l'invité attendre une
réponse qui n'arrive jamais — c'est le pire des deux mondes en LAN.

### Journal

Chaque `dispatch` ajoute **une** entrée, acceptée ou refusée :

```ts
interface JournalEntry {
  seq: number                    // strictement croissant, +1 par événement
  type: RoomEventType | 'unknown'
  peerId: string | null
  from: RoomState; to: RoomState // `to === from` si refusé
  ok: boolean
  code: RoomResultCode
  reason: string                 // toujours renseignée, même en cas de succès
}
```

Le journal est **totalement ordonné** (`seq` avance aussi sur les refus) : on peut
reconstituer un incident, y compris les tentatives rejetées, ce qu'un journal qui
ne garde que les succès ne permet pas.

### Codes de résultat

`'accepted' | 'illegal-transition' | 'room-full' | 'room-left' | 'unknown-event' |
'duplicate-peer' | 'self' | 'invalid-peer' | 'peer-not-found'`

### Effets (exécutés par la couche réseau)

`join-transport`, `leave-transport`, `retry-transport` (avec `attempt`),
`open-peer`, `close-peer`, `reject-peer` (avec `code`), `notify` (`info` | `warn`).
Le moteur ne fait aucun I/O : il décrit ce qu'il faut faire.

### API

```ts
createRoom({ roomId?, localId?, displayName?, maxParticipants? }) → Room
dispatch(room, event)            → { ok, code, reason, room, effects, entry }
dispatchAll(room, events)        → DispatchResult
canAdmit(room)                   → { ok, code, reason, seatsLeft }
canTransmit(room)                → boolean          // vrai seulement en `connected`
isLegalTransition(from, to)      → boolean
isFull(room) / occupancy(room) / seatsLeft(room) / participantIds(room)
findParticipant(room, peerId)    → Participant | undefined
meshLinks(n)                     → number           // n·(n−1)/2
```

`Room` = `{ roomId, localId, displayName, state, participants, journal, seq,
maxParticipants, reconnectAttempts }` ; `Participant` = `{ peerId, displayName,
self, admittedAtSeq }`.

---

## 6. Tests

Quatre fichiers, `import test from 'node:test'` + `assert` strict, aucune carte
son, aucun socket, deux instances du même code pour les scénarios réseau.

| Fichier | Cas | Couverture |
|---|---|---|
| `tests/vad.test.ts` | 15 | 960 éch./20 ms, dBFS et plancher, ZCR, attaque 2 trames, hystérésis et bornes −38/−45, relâche 6 trames, bruit fort refusé, config 0/1, déterminisme, PTT, vumètre |
| `tests/gain.test.ts` | 15 | bornes [−60, +12], conversions, `smoothstep`, attaque 1 trame, relâche 6 trames, changement de cible en rampe, mute = 0 exact, courbe 960 échantillons, pureté, 0–200 %, ducking |
| `tests/device.test.ts` | 11 | préféré, préféré absent + raison, liste vide `null`/`undefined`/invalide, doublons et kind, stabilité, `reconcileDevice`, `findDevice` |
| `tests/room.test.ts` | 13 | cycle nominal, transitions illégales et état terminal, événement inconnu, plafond 8 et refus explicite du 9ᵉ, place libérée, admissions douteuses, reprise, pureté, ordre du journal |

```bash
cd /work/lan-voice
node --test tests/vad.test.ts tests/gain.test.ts tests/device.test.ts tests/room.test.ts
node --test tests/engine-purity.test.ts
```

---

## 7. Arbitrages et écarts assumés

1. **Consolidation (T2).** Les anciens modules `src/engine/audio/vad.ts`,
   `audio/gain.ts`, `audio/device-selection.ts` et `room/room-machine.ts` ont été
   fusionnés dans `vad.ts`, `gain.ts`, `device.ts`, `room.ts`. Deux VAD aux
   constantes différentes dans le même dossier est un défaut, pas une option :
   toutes leurs fonctionnalités (vumètre, ducking, `reconcile`, effets, journal)
   sont conservées dans les modules canoniques.
2. **Plafond 8 (tranché : desk-lead, 2026-10-30).** T2 demandait 10, SPEC-001 A2
   et SPEC-002 §10 décrivent 8. Arbitrage rendu : **8 est la règle produit**.
   `MAX_MESH_PARTICIPANTS = 8`, `MESH_LINKS_MAX = 28`, la capacité par salon reste
   configurable dans `1…8`. Le 9ᵉ pair reçoit un refus explicite (`room-full`) +
   `reject-peer` ; aucun refus silencieux. Si la règle produit repassait à 10, la
   constante suffit (le reste du code est paramétré par `room.maxParticipants`).
3. **VAD 2/6 trames vs 120/400 ms (SPEC-001 A12).** Idem : les valeurs par défaut
   sont celles de T2 (40 ms d'attaque, 120 ms de hangover). Les valeurs de
   SPEC-001 A12 restent atteignables par configuration
   (`{ attackFrames: 6, releaseFrames: 20 }`) — la décision est donc réversible
   sans toucher à l'algorithme. **Arbitrage demandé** : une seule des deux valeurs
   doit rester dans la spec produit, sinon deux écrans afficheront deux
   comportements différents.
4. **Le mute est un zéro, pas un plancher.** À −60 dB, un résidu reste audible en
   sommation avec les autres pistes ; `muted` cible donc 0 d'amplitude, après une
   rampe de 120 ms pour éviter le clic.

---

## 8. Vérifications reproductibles

```bash
cd /work/lan-voice && node --test tests/vad.test.ts tests/gain.test.ts tests/device.test.ts tests/room.test.ts
# # tests 54 / # pass 54 / # fail 0

cd /work/lan-voice
grep -rnE "(^|[[:space:]])(import|export)[^;]*from[[:space:]]*['\"](node:|electron|http|https|net|dgram|dns|tls|ws|node-fetch|undici)" src/engine
# aucune ligne (grep exit=1) : aucun import réseau/electron dans src/engine
```
