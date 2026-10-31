# VERIF 037 — un hôte hostile tuait le process principal (déni de service à la connexion)

Date de la campagne : **2026-10-31**, mesures entre **20:20Z et 20:23Z** (UTC).
Dépôt : clone de `tournierjc/concord` à `c24e913`, branche `fix/signal-hardening` coupée de `origin/main`.
Hôte Linux `aarch64`, `node v26.5.1`, `npm 11.17.0`, `tsx 4.23.15`.

**Défaut mesuré.** `parseServerLine` (`src/main/signaling-link.ts`) ne validait que le champ `type` :

```ts
const type = (parsed as { type?: unknown }).type;
if (typeof type !== 'string') return null;
return parsed as ServerMessage;      // le reste n'est jamais vérifié
```

Le résultat était consommé deux fois sans garde :

- `handleServerMessage` fait `for (const peer of message.peers ?? []) { emit({ kind: 'peer-joined', peerId: peer.peerId, name: peer.name }) }` (`:354-356`) ;
- cette fonction est appelée depuis le gestionnaire `data` de la socket (`:395`), **hors de tout `try`**.

Une ligne de 40 octets suffisait donc — `{"type":"hello","peers":[null]}` — pour lever
`TypeError: Cannot read properties of null (reading 'peerId')` dans le process principal, qui mourait
(desktop entier, pas seulement le lien). Le vecteur est le **chemin de connexion** : c'est l'hôte qui
parle en premier, juste après le `join` du client — aucune interaction de l'utilisateur au-delà de
« rejoindre ce salon ». Variante sans fin : une liste de plusieurs centaines de milliers de pairs
forçait l'allocation de la même taille côté client.

## 1. Ce qui change

| Fichier | Changement |
|---|---|
| `src/engine/net/local-signaling.ts` | `REFUSE_CODES` exporté (miroir exécutable du type `RefuseCode`, même patron que `SIGNALING_MESSAGE_TYPES`) et `isRefuseCode(value)` |
| `src/main/signaling-link.ts` | `parseServerLine` valide **chaque champ** : `hello` (`peerId`, `peers` = tableau de `{peerId, name}` uniquement, `maxParticipants` numérique), `join` (`peer` objet valide), `leave` (`peerId` non vide), `offer`/`answer` (`from`/`to`/`sdp` textuels), `ice` (`from`/`to`/`candidate`), `refuse` (code **du protocole** + raison), `bye` (raison) ; tout le reste → `null` |
| | `MAX_PEERS_PER_HELLO = 64` : au-delà, la ligne est refusée en entier (jamais gardée à moitié) |
| | le gestionnaire `data` est enveloppé d'un `try/catch` : un message entrant ne peut plus tuer le process — au pire il compte (`stats.malformed`), refuse le lien et ferme cette socket |
| `tests/signaling-link.node.test.ts` | + 5 tests, dont un bout-en-bout sur sockets réelles |

## 2. Mesures (commandes exactes, horodatées)

| Commande | Sortie mesurée | Verdict |
|---|---|---|
| `npx tsx --test tests/signaling-link.node.test.ts` | 17 tests, 17 pass, exit=0 | ✅ |
| `npm test` | **26 fichiers · 669 tests · 669 pass · 0 fail · 49 suites · 5 221 ms** (`20:21:40→20:21:45Z`), rejoué `20:21:53→20:21:58Z` mêmes comptes | ✅ |
| `npx tsc -p tsconfig.json --noEmit` / `-p tsconfig.main.json` | exit=0 / exit=0 | ✅ |
| `npm run build` | exit=0 | ✅ |
| `npx electron-builder --linux AppImage` | exit=0, `concord-1.0.0-arm64.AppImage` (96 577 524 o, `20:22Z`) | ✅ |
| `sh VERIF/run-all.sh` | `LAN-VOICE VERIF RESULT=PASS` | ✅ |

Ce que les nouveaux tests figent :
1. `{"type":"hello","peers":[null]}`, `peers:[42]`, `peers:[{}]`, `peers:{…}`, `hello` sans `peerId`,
   `peerId` vide → **`null`** (ligne refusée) ;
2. un `hello` complet passe et rend ses pairs ;
3. **borne** : 64 pairs passent, 65 refusent, 100 000 refusent — l'hôte hostile n'impose aucune
   allocation démesurée ;
4. `refuse` sans raison, code hors protocole, `bye` sans raison, `offer.from` non textuel,
   `ice.candidate` nul, `leave.peerId` vide, `join` sans objet pair, type inconnu, `[]`, `null`,
   « pas du json » → `null` ;
5. **bout en bout** : un faux hôte écrit `{"type":"hello","peers":[null]}` puis un `hello` sain. La
   liaison **survit** (`stats.malformed === 1`, aucun état `refused`), aucun pair n'est annoncé par la
   ligne refusée, et le pair du `hello` sain est bien annoncé ensuite.

## 3. Non vérifié, nommé

- Le défaut d'origine (process tué) a été établi par lecture et par le fait que le `throw` se produit
  hors de tout `try` ; il n'a **pas** été reproduit en tuant un process Electron réel (aucun binaire
  Electron exécutable ici, `libgtk-3.so.0` absent). Ce qui est mesuré, c'est que la ligne piégée ne
  produit plus aucun effet : elle est refusée, comptée, et la liaison continue.
- Le **côté hôte** (analyse des lignes clientes) n'était pas vulnérable : `parseClientMessage`
  (`src/engine/net/local-signaling.ts:349`) valide déjà chaque champ et `receive()` refuse proprement.
  Aucun test de robustesse n'a été ajouté là — le chemin était déjà couvert par
  `tests/local-signaling.test.ts`.
- Bornes restantes : une ligne ≤ 64 Ko reste acceptée (plafond du protocole), donc un `hello` de 64 Ko
  de pairs valides est refusé par la borne de 64 pairs, pas par la taille. Le débit d'un hôte qui
  inonde de lignes valides n'est pas limité (aucun quota) — non traité ici.
- Aucune mesure réseau, audio ou microphone : cette unité ne touche que l'analyse des messages.
