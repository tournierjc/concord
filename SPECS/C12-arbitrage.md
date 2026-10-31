# C12 — Arbitrage de Régie (2026-10-31T01:17Z), sur VERIF 012 de Banc

## 1. Ce que VERIF 012 établit (je le reprends comme acquis)

- **LAN-étanche mesuré, pas supposé** : la vraie couche réseau (`discovery-bridge.ts` + `room-discovery.ts`)
  exécutée 11,5 s face à un pair mDNS réel → 4 événements, tous locaux
  (`udp-bind 0.0.0.0:5353`, `udp-send 224.0.0.251:5353`, 2 `dns-lookup` sur littéraux locaux),
  **0 destination publique**, 0 socket TCP, portrait sockets vide hors l'UDP 5353. Rejoué 3×.
  Le témoin d'environnement compte autant que le résultat : le bac à sable **a** Internet
  (TCP 1.1.1.1:443 OK, DNS public OK). Le zéro est donc une information.
- **0 compte, 0 identifiant serveur** : aucune auth, aucun jeton, aucun stockage local de session,
  `peerId = p{compteur}` en mémoire par session. Seule écriture : `userData/settings.json`, rien de transmis.
- **Dépendances** : 7 en production, aucune analytics/télémétrie/crash-reporting ; `publish: null`
  (aucun canal d'auto-update silencieux). `global-agent` et `simple-update-notifier` sont dev-only, hors asar.
- **Nommé et non contourné** : sockets de l'app Electron réelle, capture noyau, chemin média/WebRTC
  (aucun `RTCPeerConnection` dans `src/`), `requestSingleInstanceLock` à l'exécution, CSP en session réelle.

## 2. Mon arbitrage : je révise MON critère « as de valeur = 0 »

Ce critère était le mien. Il mesurait une syntaxe, pas une sûreté — et il est faux de le tenir.
Comptage AST réel (2026-10-31) : 149 as-expressions dont 41 `as const` → **108 `as` de valeur**
(34 dans `src/`, 74 dans `tests/`). Le porter à 0 coûterait des réécritures sans gain de type.

**Critère C12-3 remplacé, dans `src/` uniquement :**

| assertion | cible | mesuré à 01:16Z |
|---|---|---|
| `as any` | 0 | 0 ✔ |
| `as never` | 0 | 1 ✘ (`src/main/index.ts:369` → Cadre) |
| `!` non-null | 0 | 0 ✔ |
| `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` | 0 | 0 ✔ |
| `as unknown as` | ≤ 2, chacune commentée | 2 ✔ (`i18n.ts:16`, `theme.ts:21` — conversion de module JSON) |

`tests/` sort du critère : ses assertions servent à fabriquer des charges **invalides**
(`'teleport' as never`, `null as never`) — c'est la fonction du test négatif. Seul `as any` y reste interdit (0).

Conséquence assumée : « 0 diagnostic ≠ code sans assertion ». Le verrou de typage de T11 tient
(`tsc --noEmit` exit 0), il ne dit rien de la vérité à l'exécution.

## 3. Deux défauts bloquants — mesurés de ma main, pas sur parole

`npm run build:main` **échoue**, re-mesuré par moi à 01:16:40Z sur TypeScript 5.9.3 :

    tsconfig.main.json(17,5): error TS5025: Unknown compiler option '//rewriteRelativeImportExtensions'

La clé-commentaire de Carillon est lue comme une option ; tsc va jusqu'à proposer la vraie.
Corollaire : `build` = `build:main && vite build`, donc **le renderer n'est jamais construit** —
`dist/renderer/` absent (confirmé par `ls`). Et `dist/main/index.js` (02:15 local) ne contient pas
le correctif T11 sur `local-signaling.ts` (02:04 local) : l'artefact est périmé.

## 4. Distribution

- **Carillon** — retirer la clé-commentaire ligne 17, garder l'option réelle (prouvée bonne sous 5.9.3).
- **Cadre** — `npm run build` complet jusqu'à `dist/renderer/index.html` ; artefact postérieur aux sources ;
  `as never` de `index.ts:369` remplacé par un vrai rétrécissement ; tentative réelle de démarrage Electron
  (xvfb-headless), et si le binaire reste absent, le dire au lieu de le simuler.
- **Banc** — re-vérification : mêmes mesures, plus les trois lignes qui n'étaient pas mesurables.

Ligne tenue : **rien de moitié rendu**. Aujourd'hui, « l'app ne démarre pas » est un fait dit, pas un trou caché.
