# VERIF 036 — la liste des participants ne suivait pas la signalisation

Date de la campagne : **2026-10-31**, mesures entre **20:18Z et 20:20Z** (UTC).
Dépôt : clone de `tournierjc/concord` à `c24e913`, branche `fix/roster-wiring` coupée de `origin/main`.
Hôte Linux `aarch64`, `node v26.5.1`, `npm 11.17.0`, `tsx 4.23.15`.

**Défaut mesuré.** Le main recevait tout ce qu'il faut pour tenir la liste des participants — le tuyau
de signalisation émet `peer-joined {peerId, name}` et `peer-left {peerId}`
(`src/main/signaling-link.ts:215-218`, émis `:355`) et l'interface affiche `ParticipantDto[]` **venue du
main** (`src/renderer/App.tsx:89` → `api.onParticipants`). Entre les deux, il n'y avait rien :

- `RoomBridge.addParticipant` (`room-bridge.ts:166`) n'avait **aucun appelant** dans tout le dépôt ;
- aucune méthode ne **retirait** un participant — la liste ne pouvait que grandir ;
- `IPC.eventParticipants` n'était donc émis que pour soi-même : compteur figé à **1/8**, garde
  « salon plein » inatteignable côté hôte, écran de salon sans personne, overlay sans personne à
  dessiner (`participants.length <= 1` → message « vous êtes seul »).

## 1. Ce qui change

| Fichier | Changement |
|---|---|
| `src/main/roster-link.ts` | **nouveau**, module pur : `applySignalToRoster(roster, message, selfSignalingId)` reporte `peer-joined`/`peer-left` sur l'annuaire et rend `true` si la liste a changé |
| `src/main/room-bridge.ts` | `addParticipant` rend désormais `boolean` (faux si doublon ou salon plein) ; **`removeParticipant(peerId)` nouvelle**, ne retire jamais la ligne locale |
| `src/main/index.ts` | `onMessage` appelle `applyRoster(message)` **avant** de transmettre au renderer ; identifiant de notre connexion (assigned par le serveur) passé pour ne pas s'ajouter en double |
| `tests/roster-link.node.test.ts` | **nouveau**, 10 tests, sur un **vrai** `RoomBridge` |
| `package.json`, `docs/TESTS.md` | liste `test:node` (27 fichiers), marqueur `scriptsNote`, TL;DR re-mesuré |

## 2. Mesures (commandes exactes, horodatées)

| Commande | Sortie mesurée | Verdict |
|---|---|---|
| `npx tsx --test tests/roster-link.node.test.ts` | 10 tests, 10 pass, exit=0 | ✅ |
| `npm test` | **27 fichiers · 674 tests · 674 pass · 0 fail · 52 suites · 5 238 ms** (`20:19:25→20:19:31Z`), rejoué `20:19:38→20:19:43Z` mêmes comptes | ✅ |
| `npx tsc -p tsconfig.main.json --noEmit` | exit=0 | ✅ |
| `npm run build` | exit=0 | ✅ |
| `sh VERIF/run-all.sh` | `LAN-VOICE VERIF RESULT=PASS` (`20:19:4xZ`) | ✅ |

Ce que les tests figent, précisément :
1. `peer-joined('12','Léo')` → participant `12` nommé `Léo`, gain 1, `connection: 'connected'`,
   `participantCount` 2, `lan:event:participants` émis ;
2. un `peer-joined` **rejoué** (le fil répète un `hello`) ne change rien : aucun événement, aucune
   arrivée fantôme ;
3. un pair sans nom occupe une ligne nommée par son identifiant (jamais une ligne vide) ;
4. notre **propre connexion** (l'hôte se connecte à son salon) n'est pas ajoutée en double ;
5. `peer-left` retire le pair et décrémente le compte ; un départ inconnu ne change rien ; le
   participant local ne se retire pas par ce chemin ;
6. un pair parti peut revenir et reprendre sa place ;
7. le plafond de 8 est **enfin atteignable** : le 9ᵉ est refusé (`addParticipant` → faux) ;
8. `offer`, `answer`, `ice`, `link` ne touchent pas l'annuaire.

## 3. Non vérifié, nommé

- **Aucun affichage réel** : la liste n'a pas été regardée dans une fenêtre Electron (aucun binaire
  Electron exécutable ici, `libgtk-3.so.0` absent). Le comportement est mesuré sur l'annuaire et ses
  événements, pas sur le pixel.
- **`connection` d'un pair n'est renseigné qu'à l'arrivée.** L'état ICE vit dans le plan média du
  renderer et **aucun canal IPC** ne permet de le remonter à l'annuaire : le libellé
  `participant.iceFailed` (`Room.tsx:192-193`) reste donc inatteignable pour un pair. Ce n'est pas une
  régression (la liste était vide avant), mais ce n'est pas résolu non plus — unité séparée.
- `muted`/`deafened` d'un pair restent `false` (inconnu) : le fil de signalisation ne les transporte
  pas, et `participant-state.ts` Règle 2 les rend `unknown` à l'affichage. On n'invente pas un état.
- Le TXT `participants` de l'annonce mDNS n'est **pas** rafraîchi ici : cette branche part de `main`,
  où l'annonce n'existe pas encore (branche `fix/mdns-announce`, PR séparée). À raccorder après
  fusion.
- Aucune mesure réseau, audio ou microphone : cette unité ne touche que l'état du main.
