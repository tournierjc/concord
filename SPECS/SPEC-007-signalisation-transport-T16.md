# SPEC-007 — T16 : le plan média a un consommateur, le maillage n'a pas de transport

Régie · 2026-10-31 · statut : **T15 clos par mesure, T16 ouvert** · canon `/work/lan-voice`

---

## 1. Le problème, en une phrase

Depuis T15, l'app **ouvre le micro** et affiche un anneau qui bouge : elle n'ouvre en revanche
**aucune connexion vers personne**, parce qu'il n'existe ni transport de signalisation entre les
deux processus, ni sortie audio distante. Le trou n'est plus « pas de code », ni « pas de
consommateur » : c'est **le maillage n'est pas câblé de bout en bout**, et je sais exactement où.

## 2. Ma mesure — 2026-10-31T01:4x, sur `/work/lan-voice`

| # | mesure (exit réel, sans pipe de complaisance) | résultat |
|---|---|---|
| 1 | `sha256sum src/engine/rtc/media-plane.ts` | `9dbba690…c9090327`, 14 217 o — **inchangé depuis T14** |
| 2 | `sha256sum src/renderer/voice.ts` / `Room.tsx` | `088a6ca8…367726f` / `d068913e…825721f` |
| 3 | `npx tsc -p tsconfig.json --noEmit` | **EXIT=0** |
| 4 | `npx tsx --test tests/*.test.ts` | **452 tests, 452 pass, 0 fail**, 23 suites |
| 5 | `grep -rn "attach\|acceptAnswer\|addRemoteCandidate\|\.accept(" src/renderer` | **1 résultat — un commentaire** (`voice.ts:37`) |
| 6 | `grep -c "lan:signal" src/shell/ipc-contract.ts` | **0** |
| 7 | `grep -rn "<audio" src/renderer` | **0** |
| 8 | `grep -rn "onRemoteStream\|onLocalCandidate\|onStateChange" src` | **3 définitions** (`media-plane.ts:47/48/49`), **0 consommateur** |
| 9 | `grep -n "createMediaPlane({" src/renderer/voice.ts` | `177: createMediaPlane({ localId })` — **sans aucun callback** |

Le n° 5 confirme le **F0 de VERIF-015** (je l'ai rejoué, pas recopié). Les n° 6 à 9 sont
**neufs et de ma main** : ils déplacent le diagnostic d'un cran. Trois défauts nommés :

- **DÉFAUT-C (moi).** `createMediaPlane` est appelé **sans `onRemoteStream`** : `media-plane.ts:241`
  sort immédiatement, aucun flux distant n'atteint un haut-parleur, et **aucun `<audio>` n'existe
  dans le renderer** (n° 7). Même un maillage parfait serait **muet**.
- **DÉFAUT-D (moi).** `onLocalCandidate` n'est pas branché ⇒ `media-plane.ts:222` retourne sans
  rien faire : les candidats ICE locaux **ne quittent jamais** le processus. La connectivité
  reposerait sur les seuls candidats host du SDP, sans filet.
- **DÉFAUT-E (moi).** `onStateChange` n'est pas branché ⇒ l'UI ne peut pas distinguer « pair
  connecté » de « pair en échec ». C'est le mensonge d'interface que je refuse.

## 3. L'arbitrage — la signalisation, et pourquoi ce n'est pas un serveur

**Décision (régie, non négociable pour T16) : la signalisation est un relais TCP ligne-JSON dans
le processus principal, lié à une adresse du LAN. Pas de WebSocket, pas de dépendance ajoutée.**

Raisons, dans l'ordre :

1. **Le renderer n'ouvre aucune socket.** Il parle à `main` par IPC, comme tout le reste ; la CSP
   et `net-guard` restent la seule frontière réseau. Un `WebSocket` côté renderer obligerait à
   élargir `connect-src`, c'est-à-dire à affaiblir la garde pour un confort.
2. **Aucune dépendance.** `ws` avait déjà été retiré du `package.json` (n° 8 de SPEC-006). Un
   protocole ligne-JSON sur `node:net` fait le travail : nous sommes notre propre client.
3. **La sémantique existe déjà.** `src/engine/net/local-signaling.ts` (join/offer/answer/ice/leave,
   `maxPeers`, refus explicites) est pure ; `src/engine/rtc/ice-filter.ts` filtre les candidats.
   T16 ne réécrit pas la signalisation : il lui **donne un tuyau** et ne laisse pas le filtre à
   l'entrée.
4. **Écoute jamais `0.0.0.0`.** Le serveur se lie à **une** adresse locale non-loopback choisie
   dans les interfaces (ou loopback pour un test mono-machine), port **47821→47830** avec repli
   explicite, et refuse de démarrer plutôt que d'écouter large.

Chiffrement : **aucun**, et c'est dit. Le trafic ne quitte pas le LAN, il ne contient ni compte ni
identifiant persistant, et DTLS-SRTP chiffre déjà le média. Prétendre ajouter du TLS local
ajouterait des certificats à gérer pour un gain nul.

## 4. Les contrats figés (les trois équipiers codent contre ceci, pas contre leur intuition)

### 4.1 IPC — deux canaux, ajoutés au contrat avec test de parité

```ts
// src/shell/ipc-contract.ts
signalSend: 'lan:signal:send',   // renderer → main (invoke), un message à destination d'un pair
eventSignal: 'lan:event:signal', // main → renderer (event), messages entrants + état du lien
```

```ts
// charge utile, exportée du contrat
export type SignalKind = 'offer' | 'answer' | 'ice';

export type SignalOut =
  | { kind: SignalKind; to: string; payload: unknown }
  | { kind: 'leave' };

export type SignalIn =
  | { kind: 'peer-joined'; peerId: string; name: string }
  | { kind: 'peer-left'; peerId: string }
  | { kind: SignalKind; from: string; payload: unknown }
  | { kind: 'link'; state: 'connecting' | 'connected' | 'refused' | 'closed'; detail: string | null };
```

### 4.2 Moteur — le pilote de maillage, sans transport, sans horloge

```ts
// src/engine/net/mesh.ts  (nouveau, Carillon)
export interface MeshOptions {
  localId: string;
  plane: MediaPlane;
  send: (msg: SignalOut) => void;          // l'appelant fournit le tuyau
  maxPeers?: number;                       // défaut 8
  onPeerState?: (peerId: string, state: 'connecting' | 'connected' | 'failed') => void;
}
export interface Mesh {
  onSignal(msg: SignalIn): Promise<void>;  // entrée unique, idempotente
  peers(): string[];                       // triés, jamais de doublon
  close(): void;
}
export function createMesh(o: MeshOptions): Mesh;
```

Règle d'offreur, **déterministe** : `localId < remoteId` (ordre lexicographique) ⇒ c'est moi qui
`attach()` et j'envoie l'`offer` ; sinon j'attends et j'`accept()`. Deux offreurs simultanés = un
seul SDP gagnant, jamais deux. `acceptAnswer` pour l'offreur, `addRemoteCandidate` pour tous, y
compris les candidats arrivés **avant** la description distante (la file `pending` de
`media-plane.ts` le permet déjà — c'est le DÉFAUT-2 de VERIF-015 à rendre tolérant).

### 4.3 Coquille — le tuyau et le haut-parleur

- `src/main/signaling-link.ts` : serveur TCP (`node:net`) + client, cadrage ligne-JSON, bornes de
  taille de ligne, `createLocalSignaling` pour la sémantique, `filterIceCandidate` sur tout
  candidat relayé, arrêt propre au `leave` et à la fermeture de fenêtre.
- `src/renderer/audio-sink.ts` + un `<audio autoPlay>` **par pair distant**, alimenté par
  `onRemoteStream` : le son sort du haut-parleur, pas d'un vumètre.
- `Room.tsx` : état par pair (`connecting` / `connected` / `failed`) **visible**, mot « muet » dit
  quand aucun flux n'arrive, jamais un anneau qui tourne sur du vide.

## 5. Critères d'acceptation — mesurables, tous falsifiables sans Chromium

| id | critère | seuil |
|---|---|---|
| **A1** | `grep -c "lan:signal:" src/shell/ipc-contract.ts` | **2** canaux, test de parité preload↔contrat PASS |
| **A2** | deux nœuds Node, **vraies sockets TCP loopback** (pas de doublure) : join → offer → answer → ice | SDP échangés **dans les deux sens**, session établie |
| **A3** | même test, avec `@roamhq/wrtc` : `stats(pair).bytesReceived` | **> 0** des deux côtés |
| **A4** | `onRemoteStream` branché, sink audio créé | **1 `<audio>` par pair**, `srcObject` non nul (mesuré en Node avec faux DOM) |
| **A5** | `net-guard` + audit : aucune adresse hors LAN contactée | **0** destination hors RFC1918/loopback/link-local |
| **A6** | refus : 9ᵉ pair, ligne JSON > 64 ko, `ice` malformé, `addRemoteCandidate(id, null)` | **4 refus explicites**, 0 exception non gérée, 0 crash |
| **A7** | `tsc --noEmit` · `npm run build` · suite complète | **EXIT=0** · **EXIT=0** · **0 fail** |
| **A8** | `grep -c '"ws"' package.json` et `dependencies` totales | **0** · **+0 dépendance** |

Ce qui reste **hors d'atteinte ici**, et sera dit tel quel : le rendu Chromium réel (26 `.so`
absentes, EXIT=127) et donc l'oreille humaine. Le maillage se prouve en Node contre libwebrtc ;
l'ergonomie se prouve par les états affichés.

## 6. Qui fait quoi

| qui | tâche | livrable |
|---|---|---|
| **Carillon** | `src/engine/net/mesh.ts` (§4.2), DÉFAUT-1 renegotiation et DÉFAUT-2 `null` tolérant, ≥10 tests | `T16a` |
| **Cadre** | contrat §4.1, `signaling-link.ts` §4.3, sink audio, états par pair, ≥12 tests loopback | `T16b` |
| **Maquette** | vocabulaire des états de liaison + règle « muet vs absent » FR/EN, sans code | `T16c` |
| **Banc** | audit adversarial du tuyau : bind, refus, cadrage, hors-LAN, non-régression | `VERIF-016` |

Le câblage final `mesh` ↔ `voice.ts` est **ma** vague 2 : il dépend des deux livrables ci-dessus,
et je refuse de le faire écrire contre un fichier qui n'existe pas encore.

## 7. Ce que cette spec ne promet pas

Pas de son dans un vrai haut-parleur ici. Pas de NAT traversal (il n'y en a pas besoin sur un LAN,
et `iceServers: []` l'interdit déjà). Pas de chiffrement de la signalisation. Pas de plus de 8
pairs. Pas de zéro configuration parfaite : si la découverte mDNS échoue, l'écran doit le dire.
