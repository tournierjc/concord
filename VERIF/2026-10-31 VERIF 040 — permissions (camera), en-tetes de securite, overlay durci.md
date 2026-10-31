# VERIF 040 — la caméra était accordée, trois en-têtes jamais posés, overlay non durci

Date de la campagne : **2026-10-31**, mesures entre **20:28Z et 20:30Z** (UTC).
Dépôt : clone de `tournierjc/concord` à `c24e913`, branche `fix/permissions-hardening` coupée de
`origin/main`. Hôte Linux `aarch64`, `node v26.5.1`, `npm 11.17.0`, `tsx 4.23.15`.

## Défauts mesurés

**1. La caméra était accordée.** `src/main/index.ts:256-261` :

```ts
ses.setPermissionRequestHandler((_contents, permission, callback) => {
  callback(permission === 'media');          // ← mediaTypes jamais lu
});
ses.setPermissionCheckHandler((_contents, permission) => permission === 'media');
```

`MediaAccessPermissionRequest.mediaTypes` (Electron) dit ce qui est réellement demandé : `['video']`
pour `getUserMedia({video:true})`, `['audio']` pour le micro. Répondre `media` en bloc accordait donc
la caméra — alors que l'application n'en a aucun usage et que `Permissions-Policy` annonce
littéralement `camera=()`.

**2. `securityHeaders()` n'était utilisé nulle part.** Le module définit six en-têtes
(`Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`,
`Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `Permissions-Policy`) mais
`applySecurityPolicies()` recomposait sa propre liste à la main (`index.ts:245-254`) : **trois des six
n'étaient posés sur aucune réponse** — dont `Permissions-Policy`, qui était donc un vœu.

**3. L'overlay n'était pas durci.** `harden()` (refus d'ouverture de fenêtre, refus de navigation hors
`app://`, refus de `<webview>`) n'était appelé que sur la fenêtre principale (`index.ts:211`) ;
`createOverlay()` (`:227-236`) créait un second webContents sans aucune de ces gardes.

## 1. Ce qui change

| Fichier | Changement |
|---|---|
| `src/main/permissions.ts` | **nouveau**, module pur : `isPermissionAllowed(permission, mediaTypes)` / `isPermissionCheckAllowed(permission, mediaType)`. Seul `media` + types tous `audio` est accordé ; `video` refusé, seul ou accompagné ; 13 autres permissions refusées dans les DEUX gestionnaires |
| `src/main/index.ts` | les deux gestionnaires passent par ces décisions ; les en-têtes viennent **tous** de `securityHeaders()` (une seule définition) ; `harden()` appliqué aussi au webContents de l'overlay |
| `tests/security-policy.node.test.ts` | **nouveau**, 11 tests : décisions + les six en-têtes + gardes de source sur `index.ts` |
| `package.json`, `docs/TESTS.md` | liste `test:node` (27 fichiers), marqueur `scriptsNote`, TL;DR re-mesuré |

## 2. Mesures (commandes exactes, horodatées)

| Commande | Sortie mesurée | Verdict |
|---|---|---|
| `npx tsx --test tests/security-policy.node.test.ts` | 11 tests, 11 pass, exit=0 | ✅ |
| `npm test` | **27 fichiers · 675 tests · 675 pass · 0 fail · 51 suites · 5 266 ms** (`20:29:52→20:29:58Z`), rejoué `20:30:04→20:30:10Z` mêmes comptes | ✅ |
| `npx tsc -p tsconfig.json --noEmit` / `-p tsconfig.main.json` | exit=0 / exit=0 | ✅ |
| `npm run build` | exit=0 | ✅ |
| `sh VERIF/run-all.sh` | `LAN-VOICE VERIF RESULT=PASS` (`CHECK_A8/A9/A10/A11` PASS, check-shell PASS) | ✅ |

Ce que les tests figent :
1. `media` + `['audio']` accordé, mais `['video']`, `['audio','video']`, `['video','audio']` refusés —
   c'est le défaut exact ;
2. `media` sans type annoncé traité comme une demande de micro (aucun `getUserMedia` du dépôt ne
   demande `video`) ;
3. `geolocation`, `notifications`, `clipboard-read`, `clipboard-sanitized-write`, `usb`, `serial`,
   `hid`, `display-capture`, `midi`, `fullscreen`, `openExternal`, `unknown`, `speaker-selection` :
   refusés dans la **requête** comme dans la **vérification** ;
4. `securityHeaders()` rend exactement six en-têtes, `Permissions-Policy` contient `camera=()` et
   `microphone=(self)`, la CSP n'a ni `unsafe-eval` ni `unsafe-inline` sur les scripts ;
5. **gardes de source** : `index.ts` importe et applique `securityHeaders(...)`, ne recompose plus
   d'en-tête à la main (`'Content-Security-Policy': [` absent), utilise les deux décisions (et plus
   `callback(permission === 'media')`), et durcit l'overlay après la fenêtre principale.

## 3. Non vérifié, nommé

- **Aucune fenêtre Electron n'a été ouverte** (pas de binaire Electron exécutable ici,
  `libgtk-3.so.0` absent) : les en-têtes n'ont pas été relus dans un `webRequest` réel, et le refus de
  la caméra n'a pas été vérifié en appelant `getUserMedia({video:true})`. Ce qui est prouvé est la
  **décision** (module pur, testé) et son **application** (guardes de source) — pas l'effet dans un
  moteur.
- `isPermissionCheckAllowed('media','unknown')` rend `true` **par choix** : ce gestionnaire ne fait que
  prévenir, la requête reste le seul endroit qui accorde (et elle refuse la vidéo). Refuser `unknown`
  aurait pu casser le micro d'un moteur qui demande son avis avant de connaître le type — un défaut
  non mesurable ici, donc non pris. Le test nomme ce choix.
- L'overlay garde des `webPreferences` moins détaillées que la fenêtre principale
  (`overlay-controller.ts:220-228` : pas de `nodeIntegrationInWorker`, `allowRunningInsecureContent`,
  `experimentalFeatures` explicites). Ces valeurs sont les **défauts Electron** (tous sûrs), et
  `tests/overlay-controller.test.ts:449` fige ce `deepEqual` : aligner les deux listes demanderait de
  modifier un test gelé, hors de cette unité. La garde manquante (`harden`) est posée.
- Aucune mesure réseau, audio ou microphone.
