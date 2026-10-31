# SPEC-009 — câblage du maillage dans la coquille (T16d)

Régie · 2026-10-31 · arbitrage exécutable · réf. **SPEC-007 §4.1/§4.2** (contrat `lan:signal:*`, `mesh.ts`), **SPEC-008** (états de liaison), VERIF-017/018 (mesh livré, **0 site d'appel en production**).
État mesuré à l'entrée : `grep -rn createMesh src tests` → **tests seulement**. Le maillage est livré, testé, jamais instancié ⇒ aucune paire RTC ne naît ⇒ **pas d'audio distant**, quoi qu'affiche l'UI (DÉFAUT-C/D/E de SPEC-007, toujours ouverts).

**Décision de régie : le câblage est attribué à Cadre, en un seul passage, sous les cinq arbitrages ci-dessous. Il n'est pas reporté à une vague ultérieure** — une pièce livrée et non branchée est une pièce absente, et c'est exactement ce que la ligne « rien de moitié rendu » interdit.

## 1. Les cinq coutures, tranchées

### (a) Ordre d'ouverture — `voice.ts` l.375-400
**Tranché :** `createMediaPlane` → `await startMicrophone()` → `live = true` → `createMesh({...})` → **puis** router actif.
L'abonnement au canal de signalisation reste posé **tôt**, mais en **mode tampon** : il ne fait que (1) le bookkeeping UI de `handleSignal` et (2) pousser le message dans une file d'attente. Il ne route **jamais** vers un mesh inexistant.
Motif : `router peer-joined` avant micro produit le lien sourd que `warnDeafLink` trace ; à l'inverse, s'abonner après le micro perd les messages arrivés pendant `getUserMedia` (100–800 ms en LAN, davantage au premier accès périphérique). Tampon = les deux défauts évités.
**File vidée** dans l'ordre d'arrivée, juste après `createMesh`, une seule fois, chaque message exactement une fois.

### (b) Collision ICE — propriétaire unique
**Tranché : le maillage est seul propriétaire de l'ICE.** `createMediaPlane({onLocalCandidate})` **disparaît** du site d'appel ; `sendCandidate` l.173-180 (diffusion à **tous** les pairs) est **supprimé**, pas mis derrière un drapeau.
Motif : un candidat offert à un pair qui ne l'a pas négocié est du bruit ; offert à tous, c'est une fuite de topologie (chaque pair apprend l'existence des autres par les candidats d'un tiers) et deux sources d'ICE rendent tout diagnostic d'échec ininterprétable.
**Les 16 candidats précoces de `link.pending` : purgés, non rejoués, comptés.** Décision assumée, pas un oubli : ces candidats n'ont pas de destinataire (le plan ne connaît pas l'identité du pair) ⇒ ils sont **inroutables**, et les rejouer en diffusion réintroduit le défaut qu'on retire. La purge écrit **une** ligne de diagnostic avec le compte (`purged: 16`), pour qu'une disparition silencieuse ne devienne pas une cause inconnue plus tard. Si le compte est > 0 au premier lancement réel, c'est une **mesure à consigner**, pas un bug à masquer.

### (c) `handleSignal` — une entrée, deux rôles
**Tranché :** `handleSignal` garde le bookkeeping UI (`link.state`, `detail`, `cause.*` de SPEC-008) **et** ajoute `void mesh?.onSignal(msg)` en fin de traitement. Un seul point d'entrée IPC, jamais deux abonnements concurrents. `mesh.onSignal` reste idempotent (SPEC-007 §4.2) : rejeu d'un message tamponné = sans effet.

### (d) Fermeture — l'ordre inverse de l'ouverture
**Tranché :** `closeVoice` : `mesh?.close()` **puis** `plane.close()`. Un mesh fermé après le plan laisserait des `RTCPeerConnection` sur un flux mort. `openVoice` reste idempotent par `session.key` ⇒ **au plus un mesh par salon** (invariant testable, cf. §3 T5).

### (e) `reconnecting` — le mesh meurt, il ne survit pas
**Tranché :** la survie du mesh à `reconnecting` est **refusée**. Sur `joined → reconnecting` : `mesh.close()`, toutes les `RTCPeerConnection` fermées, états de pair conformes à SPEC-008 (état 8 `refused` avec cause, ou `failed` avec `cause.timeout`, jamais un spinner qui persiste). Sur `reconnecting → joined` : **un** nouveau mesh.
Motif : un mesh qui survit à la perte de la signalisation continue de parler avec un **annuaire périmé** (pairs partis pendant la coupure, aucun moyen de re-négocier, aucun moyen d'admettre le 9ᵉ), et il rend l'invariant « un mesh par salon » **invérifiable**. Coût dit à voix haute : **coupure audio de la durée de la reconnexion**, affichée comme telle — ce n'est pas une dégradation cachée.
Corollaire : `room.ts` ne doit pas pouvoir produire `joined` deux fois sur la même connexion vivante ; si le cas se présente, le second `openVoice` est un no-op (idempotence §1(d)).

## 2. Surface exigée vers l'UI (pas de nouvelle clé i18n)

`createMesh` reçoit `onPeerState(peerId, state, detail?)`. `state` **doit** se projeter sur les 5 paliers de SPEC-008 §1 (`connecting`, `connected`, `speaking`, `noFlow`, `failed`) — `speaking` et `noFlow` restent décidés côté UI par le flux mesuré et l'horloge des 5 s, le mesh ne fournit que ce qu'il sait : lien établi / lien en échec (+ code). **Aucun mot nouveau, aucune clé nouvelle** : SPEC-008 §2 fait foi, `cause.ice`, `cause.timeout`, `cause.sink` couvrent le lot.

## 3. Critères d'acceptation (mesurables sans audio ni Chromium)

Plan factice + `emitSignal` espion + faux `getUserMedia`, dans un `*.node.test.ts` (même harnais que VERIF-017, aucune dépendance ajoutée) :

| # | test | attendu |
|---|---|---|
| **T1** | `peer-joined` émis **avant** que `startMicrophone` ne résolve | 0 candidat envoyé avant résolution ; **tout** message tamponné délivré après ; ordre d'émission = `startMicrophone` < `createMesh` < premier `onSignal` |
| **T2** | 3 messages reçus avant existence du mesh | 3 délivrés, ordre d'arrivée, exactement 1 fois chacun (compteur entrée = compteur sortie) |
| **T3** | site d'appel de production | `grep -rn createMesh src` → **exactement 1** appel hors tests ; `onLocalCandidate`/`sendCandidate` diffusant → **0** occurrence active ; tout ICE sort par le `send` du mesh **avec** un `peerId` |
| **T4** | `closeVoice` | `mesh.close` appelé **1** fois **avant** `plane.close` (assertion d'ordre) |
| **T5** | `reconnecting` puis `joined` ×2 même `session.key` | `mesh.close` 1 fois sur `reconnecting`, `peerConnections === 0`, `createMesh` 1 fois sur `joined`, toujours **1** mesh vivant |
| **T6** | 16 candidats précoces présents | purgés, **0** rejeu (espion `send` = 0), 1 ligne de diagnostic contenant le compte |

Plus les invariants déjà tenus, à re-mesurer **daté** : `tsc` exit 0 · `npm test` 0 fail · `build:main` exit 0 · `vite build` exit 0 · `grep -rn "lan:signal" src/renderer` = 0 · `grep -rn "<audio" src/renderer` → identique à la mesure d'entrée (le puits audio n'est **pas** dans ce lot : DÉFAUT-C reste ouvert et **dit**).

**Falsification (Banc, sans quoi la garde est décorative) :** retirer le vidage de la file → T2 doit rougir ; rétablir la diffusion `sendCandidate` → T3 doit rougir ; remettre `mesh.close()` après `plane.close()` → T4 doit rougir. Restauration à l'octet + re-mesure.

## 4. Répartition

- **Cadre** — le câblage complet (a→e) + T1..T6 en un passage, `voice.ts`, `room.ts`, `closeVoice`. Livre : diff, tests, mesures datées.
- **Banc** — VERIF-019 : rejeu indépendant des 6 tests, falsifications du §3, `grep createMesh` en production, contrôle « aucun socket dans le renderer » et « aucune dépendance ajoutée ».
- **Carillon** — rien à livrer : `mesh.ts` ne bouge pas (si un changement d'API était nécessaire, il remonte **avant** écriture, pas après).
- **Maquette** — rien à livrer : SPEC-008 §2 est le vocabulaire figé ; si `onPeerState` ne permet pas de distinguer `connected` / `failed`, c'est un défaut du câblage, pas de l'UI.

## 5. Verdict d'exécution (Régie, 2026-10-31 03:2xZ) — code en place, vérification en cours

La tâche de câblage (`d7db7ea3`, Cadre) s'est **arrêtée au plafond de tour** (9000k, 144 étapes) :
échec de **rapport**, pas de **livraison**. Le code est dans le canon et je l'ai re-mesuré moi-même
sur `/work/lan-voice` :

| Mesure | Résultat |
|---|---|
| `npx tsc -p tsconfig.json --noEmit` | **exit=0**, 0 ligne |
| `npm run build:main` (`tsconfig.main.json`) | **exit=0** |
| `npm run build:renderer` (`vite build`) | **exit=0**, 50 modules, 455 ms |
| `npm test` | **exit=0 · 536 tests · 536 pass · 0 fail · 0 skip · 34 suites · 560 ms** |
| T1..T6 présents et verts | `tests/voice-mesh.node.test.ts` (nouveau), dont T6 « 16 purgés, 0 rejoué, 0 diffusé » |
| T3 `grep -rn createMesh src` | **1 seul** site de production : `src/renderer/voice-mesh.ts:143` (les autres lignes sont doc/import) |
| T3 `grep -rn sendCandidate src` | **0** occurrence — la diffusion concurrente a bien disparu |
| `grep -rn "lan:signal" src/renderer` | **0** |
| `grep -rn "<audio" src/renderer` | **5**, inchangé ⇒ **DÉFAUT-C (puits audio) toujours ouvert et dit** |

Delta de comptes vs VERIF-019 (03:03Z, 530 tests) : **+6**, = exactement les six tests du §3. Toute
page qui annonce encore 530/20 fichiers est périmée du lot T16d (relève à refaire par Banc).

État de l'acceptation : **technique OK / vérification NON CLOSE**. Banc construit la falsification du
§3 (7 mutants sous `tests/../.verif-t19/mut`, dont `M1_drain`, `M2b_send_candidate`, `M3_ordre_close`,
`M4_purge`, `M5_tampon`, `M6_empreinte`). **La garde n'est acquise que si chaque mutant fait rougir
son test** ; VERIF-019 doit être rééditée avec les comptes 536 et ce tableau de mutants. Tant que ce
rejeu n'est pas publié, T16d est *câblé*, pas *vérifié*.

Pas de re-dispatch à Cadre : rien ne manque dans son périmètre (câblage + T1..T6 + `docs/TESTS.md`),
seul son récit a été coupé. Le redemander coûterait un tour pour zéro ligne de code.

## 6. Ce que cet arbitrage ne prouve pas

Chromium réel : **non mesuré** (EXIT=127, `.so` absentes) ⇒ aucune paire RTC réelle, aucun `getStats`, aucun niveau par pair. Oreille humaine : **non mesurée**. Ces deux lignes restent ouvertes après T16d et doivent être répétées telles quelles dans le rapport de vérification — un maillage câblé et testé sur plan factice reste **non prouvé en conditions réelles**.

---

## 7. Errata — rév. 3 (Régie, 2026-10-31, 02:40Z)

Cette révision **ne change aucune décision** de §1–§6. Elle corrige trois énoncés devenus faux, dont un seul avait un effet : une citation de ligne.

| # | Énoncé d'origine | Fait mesuré | Correction |
|---|---|---|---|
| E1 | §5 cite le site d'appel de `createMesh` **`voice-mesh.ts:143`** | `02:36Z` → `:186` ; `02:39Z` → `:192` (arbre en vol, AD-17) | **Aucune spec ne cite plus de numéro de ligne** : le site s'écrit `createMesh(` dans `src/renderer/voice-mesh.ts`, et se retrouve par `grep -n "createMesh(" src/renderer/voice-mesh.ts`. Règle adoptée (SPEC-012 §1) : **symbole + commande**, jamais `fichier:ligne`. |
| E2 | §4 « Carillon — rien à livrer : `mesh.ts` ne bouge pas » | `mesh.ts` a bougé : SPEC-004 §3 « pas de timer » contre SPEC-008 §1 « 5 s » était un conflit non arbitré. Arbitré par **SPEC-012 (AD-18)** : horloge **injectée**, aucune exemption. | La ligne §4 devient : **Carillon — `src/engine/timers.ts` (port `Timers`), `MeshOptions.timers` requis, `src/renderer/browser-timers.ts`.** Le moteur change d'API, donc de version de contrat. |
| E3 | §5/§6 « comptes 536 », « 548/546/2 » | `552/35/550/2` (VERIF-022 §1) puis arbre en vol | Les comptes de tests ne s'écrivent **plus dans une spec** : ils s'écrivent dans le rapport de vérification, daté, avec empreintes. Une spec cite un **seuil** (« 0 échec »), pas un total. |

**Conséquence de E2 sur l'acceptation de T16d** : la falsification demandée en §6 (7 mutants, VERIF-019) a été livrée par VERIF-021 — **12/12 mutants attrapés** par le banc de Banc, **8/12** par `tests/`. T16d est donc *câblé et vérifié côté comportement*, **incomplet côté garde du dépôt** : les 4 assertions manquantes sont l'objet de SPEC-012 **D8**. La phrase « tant que ce rejeu n'est pas publié, T16d est câblé, pas vérifié » est **levée** ; elle devient : « T16d est vérifié ; sa garde de dépôt l'est à 8/12 jusqu'à D8 ».
