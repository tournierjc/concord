# VERIF 042 — l'onglet Réseau affichait un port qui n'était pas celui utilisé

Date de la campagne : **2026-10-31**, mesures entre **20:35Z et 20:41Z** (UTC).
Dépôt : clone de `tournierjc/concord` à `c24e913`, branche `fix/settings-truth` coupée de
`origin/main`. Hôte Linux `aarch64`, `node v26.5.1`, `tsx 4.23.15`.

## Défauts mesurés (et ce que la SPEC en dit)

**1. Le port affiché n'était pas le port utilisé.** `Settings.tsx:352` affichait
`{settings.network.signalingPort}`, la valeur **demandée** dans le fichier de réglages. Le moteur ne
la lit pas : `signaling-link.ts:279` prend `options.port ?? SIGNALING_BASE_PORT` et le main n'injecte
jamais `port` pour un hôte (`index.ts:462-470`), donc le port part toujours de 47821.

Ce n'est pas un détail d'implémentation, c'est le contrat du dépôt :

> SPEC-001 **A5** — « port 47821 […] **Conflit de port** : si 47821 est pris, on incrémente jusqu'à
> 47830, et **le port réel est publié dans le beacon mDNS** ».
> SPEC-002 **D1** — « le port réellement utilisé est publié dans le beacon — **l'interface n'affiche
> jamais un port qu'elle n'a pas lu du beacon** ».
> SPEC-002 **S3.15** — « `settings.network.port` affiche le port **effectif** […] suivi de
> `settings.network.portBumped` (`{{default}} = 47821`, `{{port}} = 47822`) ».

La clé `settings.network.portBumped` existait dans `design/i18n/fr.json` et **n'était affichée nulle
part** : la ligne prévue par la spec était morte parce que l'UI ne lisait jamais la mesure.

**2. « Identité de session » mélangeait un fait et deux constantes.** `Settings.tsx:356-358` :
`{settings.nickname} · {MAX_ROOM_PARTICIPANTS} · {SIGNALING_PORT_DEFAULT}` — le pseudo suivi de `8`
et `47821`, deux constantes de compilation présentées comme des faits de session, sous un libellé
(« Identité de session ») dont le texte d'aide dit « Identifiant éphémère, régénéré à chaque
lancement ». Or le contrat **expose** cet identifiant : `RoomStateDto.selfId` (`ipc-contract.ts:151`).

## 1. Ce qui change

| Fichier | Changement |
|---|---|
| `src/main/signaling-port.ts` | **nouveau**, pur : `effectiveSignalingPort({listen, roomId, rooms})` — l'écoute l'emporte, sinon le port **lu** dans l'annonce du salon courant, sinon `null` |
| `src/shell/ipc-contract.ts` | `RoomStateDto.signalingPort` (entier 1..65535 ou `null`) + `guard.nullablePort` (**nouveau** : un port est un entier, `47821.5` est refusé) + type `RoomStateCore` (l'état sans le port) |
| `src/main/room-bridge.ts` | `getRoomState()`/`join()`/`leave()` rendent `RoomStateCore` : le pont **ne prétend pas** connaître le port (sinon il devrait écrire `signalingPort: null`, c'est-à-dire affirmer « aucun port » sur un salon qui en a un) |
| `src/main/index.ts` | `currentSignalingPort()` + `forwardBridgeEvent` enrichit `eventRoomState` de la mesure ; les autres canaux sont inchangés |
| `src/renderer/Settings.tsx` | port **mesuré** (`session.signalingPort`, « aucun » hors salon), ligne `portBumped` en `state.warn` quand le port a été incrémenté (S3.15), « Identité de session » = `session.selfId` + `identityHelp` |
| `src/renderer/App.tsx` | `session={room}` passé au panneau (source unique), `EMPTY_ROOM.signalingPort: null` |
| `src/renderer/styles.css` | `.field__help--warn { color: var(--color-state-warn) }` |
| `tests/signaling-port.node.test.ts` | **nouveau**, 13 tests : la mesure, le contrat, le câblage |
| `tests/ipc-contract.test.ts` | l'état de salon de test porte `signalingPort` ; refus d'un flottant, d'une chaîne, d'un champ absent |

## 2. Mesures (commandes exactes, horodatées)

| Commande | Sortie mesurée | Verdict |
|---|---|---|
| `npx tsx --test tests/signaling-port.node.test.ts` | 13 tests, 13 pass, exit=0 | ✅ |
| `npm test` | **27 fichiers · 677 tests · 677 pass · 0 fail · 49 suites · 5 293 ms** (`20:37:18→20:37:24Z`), rejoué mêmes comptes | ✅ |
| `npx tsc -p tsconfig.json --noEmit` / `-p tsconfig.main.json --noEmit` | exit=0 / exit=0 | ✅ |
| `npm run build` | exit=0 (renderer + main) | ✅ |
| `sh VERIF/run-all.sh` | `LAN-VOICE VERIF RESULT=PASS` | ✅ |
| **Rendu réel** (Chromium headless, harnais hors dépôt) | voir §3 | ✅ |

## 3. Preuve de rendu (pas seulement des tests)

Le renderer reconstruit est servi dans un harnais **hors du dépôt**
(`/opt/data/cache/scratch/uiharness-concord`, faux `window.lanAPI` qui émet un état de salon avec
`signalingPort: 47822` et `selfId: 'self-1'`), puis lu avec le Chromium headless de Playwright :

- `--dump-dom` → la ligne est bien là, interpolée :
  `class="field__help field__help--warn">Port 47821 occupé — port 47822 utilisé.`
- sonde `getComputedStyle` (lue dans le DOM après rendu) →
  `<title>PROBE warn=rgb(255, 176, 32) token=#FFB020</title>`

`rgb(255, 176, 32)` = `#FFB020` = le jeton `color.theme.dark.state.warn` de `design/tokens.json` :
l'avertissement est réellement coloré, pas hérité.

Capture : `net-settings2.png` (les valeurs affichées sont `47822` pour « Port de signalisation »,
`self-1` pour « Identité de session », et **aucune moustache brute** dans la section Réseau).

## 4. Non vérifié, nommé

- **Pas de vraie machine à deux postes** : la mesure vient d'un état de salon injecté (harnais), pas
  d'un hôte ayant réellement incrémenté un port occupé. Ce qui est prouvé : la règle de calcul (pure,
  testée), le contrat (refus/acceptation vérifiés), le câblage (gardes de source) et le rendu
  (DOM + couleur calculée).
- `settings.network.signalingPort` reste **dans le schéma** (une installation existante doit continuer
  à lire son fichier) mais n'est plus affiché comme le port utilisé. Le supprimer du schéma est une
  migration de fichier de réglages : décision laissée au mainteneur, nommée ici.
- Le pont de salon ne publie pas le port : `RoomStateCore` existe pour que le type dise la vérité. Si
  un autre producteur d'état de salon apparaissait, il devrait passer par la coquille.
- **6 déclarations de couleur de `styles.css` renvoient à des variables qui n'existent dans AUCUN
  jeton** (`--color-state-warning` ×2, `--color-state-danger` ×2, `--color-state-success`,
  `--color-state-danger-subtle`) : les jetons s'appellent `state.warn`, `state.mute`/`state.deaf`,
  `state.ok`, `state.muteSubtle`. Ces textes héritent donc leur couleur — mesuré dans cette même
  campagne en comparant `styles.css` aux clés de `design/tokens.json`. Hors de cette unité (le défaut
  ne concerne pas le port) : à traiter avec une garde « toute `var()` employée existe ».
