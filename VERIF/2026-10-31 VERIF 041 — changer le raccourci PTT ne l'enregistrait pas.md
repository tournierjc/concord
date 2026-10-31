# VERIF 041 — changer le raccourci push-to-talk ne l'enregistrait pas

Date de la campagne : **2026-10-31**, mesures entre **20:32Z et 20:34Z** (UTC).
Dépôt : clone de `tournierjc/concord` à `c24e913`, branche `fix/ptt-reregister` coupée de
`origin/main`. Hôte Linux `aarch64`, `node v26.5.1`, `tsx 4.23.15`.

## Défaut mesuré

Le raccourci push-to-talk n'est pas un réglage mou : il est réservé auprès du **système** par
`globalShortcut` (`src/main/ptt.ts:67`). Or rien ne le ré-enregistrait jamais :

- `registerPushToTalkShortcut()` (`src/main/index.ts:139`) n'était appelé qu'une fois, au démarrage ;
- `persist()` (`src/main/index.ts:368-381`) écrivait les réglages et publiait
  `eventSettingsChanged`, **sans jamais toucher au raccourci**.

Conséquence exacte : l'utilisateur change `talk.pttAccelerator` dans les réglages ; l'UI affiche la
nouvelle valeur, le fichier de réglages la contient, et le clavier continue de répondre à **l'ancien**
accélérateur — jusqu'au redémarrage. Inversement, un accélérateur libéré n'était pas repris dans la
session en cours.

## 1. Ce qui change

| Fichier | Changement |
|---|---|
| `src/shell/settings-schema.ts` | `pushToTalkAcceleratorChanged(previous, next)` — **nouveau**, pur : la décision « faut-il ré-enregistrer ? » |
| `src/main/index.ts` | `persist()` compare et ré-enregistre si l'accélérateur a changé ; `registerPushToTalkShortcut()` libère l'ancien **avant** de réserver le nouveau, et publie le conflit (le second envoi, en fin de `bootstrap`, faisait doublon) |
| `tests/ptt-reregistration.node.test.ts` | **nouveau**, 9 tests : la décision + les gardes de source (ordre libérer→réserver, unicité du conflit, `ptt.ts` seul à importer `globalShortcut`) |
| `package.json`, `docs/TESTS.md` | liste `test:node` (27 fichiers), marqueur `scriptsNote`, TL;DR re-mesuré |

Pourquoi libérer d'abord : `globalShortcut.register` refuse un accélérateur déjà tenu — le plus
souvent **par nous-mêmes**, puisque le changement se fait pendant que l'ancien est enregistré.

## 2. Mesures (commandes exactes, horodatées)

| Commande | Sortie mesurée | Verdict |
|---|---|---|
| `npx tsx --test tests/ptt-reregistration.node.test.ts` | 9 tests, 9 pass, exit=0 | ✅ |
| `npm test` | **27 fichiers · 673 tests · 673 pass · 0 fail · 51 suites · 5 344 ms** (`20:33:19→20:33:25Z`), rejoué `20:34:0xZ` mêmes comptes | ✅ |
| `npx tsc -p tsconfig.json --noEmit` / `-p tsconfig.main.json --noEmit` | exit=0 / exit=0 | ✅ |
| `npm run build` | exit=0 | ✅ |
| `sh VERIF/run-all.sh` | `LAN-VOICE VERIF RESULT=PASS` | ✅ |

Ce que les tests figent :
1. `pushToTalkAcceleratorChanged` : vrai si et seulement si `talk.pttAccelerator` diffère — faux pour
   `vadThresholdDb`, `inputDeviceId`, `vadEnabled`, `overlay.scale` (aucun geste système inutile) ;
2. dans `persist()` : la décision est évaluée **avant** `registerPushToTalkShortcut()` ;
3. dans `registerPushToTalkShortcut()` : `releasePushToTalk()` précède `registerPushToTalk(` ;
4. `IPC.eventShortcutConflict` est publié **une seule fois** dans `index.ts`, à l'intérieur de
   `registerPushToTalkShortcut` ; un seul appel inconditionnel de ce dernier au démarrage ;
5. garde de source : `src/main/ptt.ts` est le **seul** module du dépôt à importer `globalShortcut` —
   ce qui rend légitime le `globalShortcut.unregisterAll()` de `releasePushToTalk()` en pleine course
   (aucun raccourci d'un autre module ne serait perdu). La garde cherche l'**import** réel, pas le mot
   (il vit aussi dans la prose des commentaires).

## 3. Non vérifié, nommé

- **Le geste clavier lui-même n'a pas été mesuré** : `electron.globalShortcut` n'est pas chargeable
  hors application (aucun binaire Electron exécutable ici, `libgtk-3.so.0` absent). Ce qui est prouvé
  est la décision et l'ordre des gestes dans la source — pas « Alt+Espace répond après changement ».
- Une bannière de conflit **déjà affichée** n'est pas effacée par un changement réussi : le contrat IPC
  n'a pas de canal « conflit résolu » (`ShortcutConflictDto` décrit un conflit, pas son absence, et
  `App.tsx:208` affiche la bannière dès qu'un objet arrive). En ajouter un est un changement de
  contrat, hors de cette unité. La bannière reste fermable (`common.close`).
- Aucune mesure réseau, audio ou microphone.
