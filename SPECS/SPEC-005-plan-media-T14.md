# SPEC-005 — T14 : plan média, falsifiabilité de la voix

Régie · 2026-10-31T01:26Z · remplace les critères partiels de C12-3 pour T14.

## 0. Ma mesure, avant tout (01:26:00→01:26:01Z)

| mesure | valeur |
|---|---|
| `npm run build` (complet) | **EXIT=0**, 01:26:00Z → 01:26:01Z |
| `sha256(dist/main/index.js)` **avant** mon build | `c5d37f07e4ec…bf75f118` |
| `sha256(dist/main/index.js)` **après** mon build | `c5d37f07e4ec…bf75f118` (identique) |
| `dist/main/index.js` | 19 497 o |

⇒ Le build est **reproductible au bit près** sur cet artefact, et l'artefact que Banc mesurait
(01:18:27Z), que Cadre a reconstruit (01:24:40Z) et que j'ai reconstruit (01:26:00Z) convergent.
**Item 1 et item 4 de VERIF-013 : fermés par exit code de ma main.**

Corollaire de méthode, définitif : **on certifie un `sha256`, pas une narration de mtime.** Toute
preuve de build à partir de T14 cite le hash, la taille et l'exit code, pas seulement l'horodatage.

## 1. Arbitrages tranchés (je ne reviens pas dessus)

1. **Marqueur (a) requalifié.** Le critère n'est plus « le raisonnement n'est pas dans
   `compilerOptions` sous forme de commentaire » mais : *`tsconfig.main.json` reste du **JSON strict**
   (chargeable par `require()`), et aucune clé inconnue ne réside **dans** `compilerOptions`*. La
   formulation de Carillon (clés `"//…"` à la racine) satisfait ce critère. TS5025 est fermé sur le
   fond **et** la lettre est désormais celle-ci. Banc n'a plus à cocher un marqueur littéral caduc.
2. **Le plan média vit dans le renderer Chromium**, pas dans le main. Raison : `RTCPeerConnection`,
   Opus, echo-cancel et AudioWorklet sont natifs dans Chromium ; le main n'a aucun WebRTC et exigerait
   `wrtc`/`node-datachannel` (binaire natif, surface de packaging). Le main garde signalisation,
   mDNS et l'IPC déjà vérifié.
3. **`iceServers: []` par défaut, aucun STUN/TURN, jamais.** L'étanchéité hors LAN n'est pas un filtre
   posé après coup, c'est une **absence de configuration** : sans serveur STUN, Chromium ne collecte
   que des candidats `host`, qui sont déjà locaux. `src/engine/rtc/ice-filter.ts` reste le garde-fou
   de second rang (refus explicite de `srflx`/`relay` et de toute adresse publique).
4. **`ws` sort de `dependencies`.** Mesuré : `grep -rn "from 'ws'|require('ws')" src tests` = **0**.
   Dépendance morte, embarquée par `electron-builder` indépendamment de `build.files`. `bonjour-service`
   reste (utilisée par `src/main/discovery-bridge.ts`).
5. **Falsifiabilité.** Aucun `.ts` de `src/` ne contient `RTCPeerConnection` (mesuré : 2 occurrences,
   toutes deux dans `src/engine/README.md`). Tant que c'est vrai, « chat **vocal** » n'est falsifiable
   par aucune mesure : on ne peut prouver que l'absence. **C'est le seul chantier de T14.** Le reste
   (overlay, réglages, i18n) est déjà couvert.

## 2. Contrat d'interface — imposé, à ne pas renégocier

`src/engine/rtc/media-plane.ts` (Carillon) :

```ts
export interface MediaPlaneOptions {
  localId: string
  rtcConfig?: RTCConfiguration            // défaut imposé : { iceServers: [] }
  onLocalCandidate?: (c: RTCIceCandidateInit) => void
  onRemoteStream?: (s: MediaStream) => void
  onStateChange?: (s: { connectionState: RTCPeerConnectionState }) => void
}
export interface PeerStats { bytesSent: number; bytesReceived: number; packetsLost: number; rttMs: number }
export interface MediaPlane {
  startMicrophone(): Promise<void>                               // getUserMedia mono, EC/NS/AGC
  attach(remoteId: string): Promise<RTCSessionDescriptionInit>    // offre
  accept(remoteId: string, offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit>
  acceptAnswer(remoteId: string, answer: RTCSessionDescriptionInit): Promise<void>
  addRemoteCandidate(remoteId: string, c: RTCIceCandidateInit): Promise<void>
  setTransmitting(on: boolean): void                             // PTT : track.enabled
  level(): number                                                // RMS 0..1 (AnalyserNode)
  stats(remoteId: string): Promise<PeerStats>
  close(): void
}
export function createMediaPlane(o: MediaPlaneOptions): MediaPlane
```

Contraintes de code : **zéro `as`, zéro `!`, zéro `@ts-ignore`** dans le fichier ; aucun appel à une
API Node (il doit tourner dans une page) ; audio `{ channelCount: 1, echoCancellation: true,
noiseSuppression: true, autoGainControl: true }` ; Opus **48 kHz mono, 32 kbps** via
`RTCRtpSender.setParameters({ encodings: [{ maxBitrate: 32000 }] })` **et** munging SDP
`maxaveragebitrate=32000;stereo=0;useinbandfec=1`.

## 3. Harnais de falsification (Banc) — sans Electron, sans écran

Electron n'a pas de binaire ici (`node_modules/electron/dist`, `path.txt` absents) et `xvfb-run` est
introuvable, mais **Internet est disponible**. Le harnais ne dépend donc ni de l'un ni de l'autre :

1. `npx esbuild src/engine/rtc/media-plane.ts --bundle --format=iife --global-name=MP --outfile=.verif-t14/media-plane.js`
2. Playwright **chromium headless**, drapeaux `--use-fake-device-for-media-stream
   --use-fake-ui-for-media-stream --autoplay-policy=no-user-gesture-required`.
3. Une page locale charge le bundle et monte **deux `MediaPlane` en loopback** (signalisation en
   mémoire, `attach`/`accept`/`acceptAnswer`/`addRemoteCandidate` croisés).
4. Ce qui doit être **mesuré et chiffré**, pas décrit :
   - `pc.connectionState === 'connected'` sous 10 s ;
   - **100 % des candidats ICE sont `host` et dans 10/8, 172.16/12, 192.168/16 ou 127/8**,
     `srflx` = 0, `relay` = 0 ;
   - `bytesReceived` > 0 et croissant sur 5 s côté pair B ;
   - `level()` > 0.001 côté réception alors que A émet (tonalité de test) ;
   - **aucune socket hors LAN** : le harnais refuse dur le public et compte **0** événement ;
   - `rttMs` documenté, pas jugé.
5. Sortie : un rapport `VERIF-014` avec les 6 chiffres ci-dessus, chacun PASS/FAIL, et la mention
   explicite de la limite : *c'est bien Chromium réel qui parle, mais sous une page de vérification,
   pas dans la fenêtre Electron finale — le packaging reste non mesuré.*

## 4. Qui fait quoi

| bot | livrable | « fini » = |
|---|---|---|
| **Carillon** | `src/engine/rtc/media-plane.ts` conforme §2 + non-régression `room-discovery`/`local-signaling` | fichier existe, `grep -c RTCPeerConnection` ≥ 1 dans un `.ts`, `tsc -p tsconfig.json --noEmit` EXIT=0 de sa main, hash+exit cités |
| **Cadre** | renderer branché sur le plan média (PTT → `setTransmitting`, avatar « parle » ← `level()`), 2 `as unknown as` commentés (`i18n.ts:16`, `theme.ts:21`), `ws` retiré de `dependencies`, build re-mesuré | `npm run build` EXIT=0 **+ sha256** cités, `grep -c '"ws"' package.json` = 0, `as never`/`as any` = 0 dans `src/` |
| **Banc** | `VERIF-014` = harnais §3 exécuté | les 6 chiffres présents, chacun PASS/FAIL, commandes exactes rejouables |

## 5. Ce qui reste explicitement NON rendu après T14

- Démarrage de la fenêtre Electron (binaire absent) : non mesuré.
- Packaging `electron-builder` : non mesuré.
- mDNS réel entre deux machines du LAN : non mesuré (une seule machine).
- Perte de paquets 5 %, CPU en conversation : non mesurés.

Ces quatre points sont **dits absents**, pas maquillés.
