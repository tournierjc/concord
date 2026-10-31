# VERIF 034 — le nom du salon affichait votre pseudo, et l'annuaire de salon n'avait aucun test

Date de la campagne : **2026-10-31**, mesures entre **20:09Z et 20:11Z** (UTC).
Dépôt : clone de `tournierjc/concord` à `c24e913`, branche `fix/room-name-semantics` coupée de
`origin/main`. Hôte Linux `aarch64`, `node v26.5.1`, `npm 11.17.0`, `tsx 4.23.15`.

**Défaut mesuré.** `App.tsx` envoyait `api.joinRoom({ roomId, name: settings.nickname || roomId })` et
`room-bridge.ts` faisait `this.roomName = payload.name` : le nom du salon et le nom du participant
local étaient **le même champ**. Conséquence visible : l'en-tête de l'écran de salon affichait le pseudo
de la personne qui venait de rejoindre, et le salon n'avait aucun nom propre. Le même champ servait
aussi de repli quand le pseudo était vide.

Second défaut, de méthode : `src/main/room-bridge.ts` — le module qui tient l'état affiché par
l'interface — n'était importé par **aucun** test. Trois de ses comportements étaient donc non gardés,
dont l'émission d'événements par **valeur** de canal (`lan:event:room-state`) et non par nom de clé
(`eventRoomState`) : le second était refusé en silence par `guardPayload` et n'atteignait jamais le
renderer.

## 1. Ce qui change

| Fichier | Changement |
|---|---|
| `src/shell/ipc-contract.ts` | `RoomJoinPayload.name` est documenté comme le nom du **salon** ; `roomId` porte `hôte:port` pour un salon découvert, le nom saisi pour un salon créé |
| `src/shell/settings-schema.ts` | `resolveDisplayName(nickname, osUserName)` (pure) : pseudo réglé → nom du compte OS → `« Concord »`, borné à 32 points de code |
| `src/main/room-bridge.ts` | `join(payload, selfName)` : `roomName` vient de `payload.name` (rogné, repli sur `payload.roomId`), le nom du participant local de `selfName` |
| `src/main/index.ts` | `bridge.join(join, resolveDisplayName(settings.nickname, osUserName()))` ; `osUserName()` (au repli sûr) encapsule `userInfo()` |
| `src/renderer/App.tsx` | `joinRoom(roomId, roomName)` ; la liste passe `room.roomName` pour un salon découvert, le nom saisi pour une création |
| `tests/room-bridge.node.test.ts` | **nouveau**, 10 tests |
| `tests/settings-schema.test.ts` | + 4 tests sur `resolveDisplayName` |
| `package.json`, `docs/TESTS.md` | liste `test:node` (27 fichiers), marqueur `scriptsNote`, TL;DR re-mesuré |

## 2. Mesures (commandes exactes, horodatées)

| Commande | Sortie mesurée | Verdict |
|---|---|---|
| `npx tsx --test tests/room-bridge.node.test.ts` | 10 tests, 10 pass, exit=0 | ✅ |
| `npm test` | **27 fichiers · 678 tests · 678 pass · 0 fail · 53 suites · 5 208 ms** (`20:11:21→20:11:26Z`), rejoué `20:11:40→20:11:50Z` mêmes comptes | ✅ |
| `npm run typecheck` | exit=0 | ✅ |
| `npm run build:main` | exit=0 | ✅ |
| `npm run build` | exit=0 | ✅ |
| `sh VERIF/run-all.sh` | `LAN-VOICE VERIF RESULT=PASS` (`20:11:50Z`) | ✅ |

Ce que les nouveaux tests figent, précisément :
1. `join({roomId:'192.168.1.24:47821', name:'Salon cuisine'}, 'Marion')` → `roomName === 'Salon cuisine'`
   et le participant local s'appelle `Marion` ;
2. un nom de salon vide retombe sur `roomId` (jamais un en-tête vide) ;
3. **tous** les événements émis par le pont portent un canal `^lan:event:` (le bug des noms de clé ne
   peut pas revenir) ;
4. le plafond de 8 est tenu par le pont lui-même, et le 9ᵉ participant se voit refusé avec
   `notice = 'room.row.fullReason'` sans que le salon courant soit remplacé ;
5. `setGain` ignore un identifiant inconnu ; PTT lève le mute local.

## 3. Non vérifié, nommé

- **Affichage réel** : l'en-tête de salon n'a pas été regardé dans une fenêtre Electron (aucun binaire
  Electron exécutable sur cet hôte : `libgtk-3.so.0` absent). Le comportement est mesuré sur l'état du
  pont, pas sur le pixel.
- Le **défaut de pseudo = nom du compte OS** (A6) est désormais *calculé* (`resolveDisplayName`) mais
  n'est pas écrit dans le fichier de réglages : le champ reste vide dans `settings.json`, et l'UI
  affiche `« Aucun »` tant que le pseudo n'est pas saisi. Décision à prendre (écrire le défaut au
  premier lancement, ou l'afficher comme valeur calculée) — hors périmètre de cette unité.
- Aucune mesure réseau : cette unité ne touche ni la découverte, ni la signalisation, ni le média.
