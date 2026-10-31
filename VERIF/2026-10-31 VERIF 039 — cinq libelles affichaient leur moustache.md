# VERIF 039 — cinq libellés s'affichaient avec leur moustache

Date de la campagne : **2026-10-31**, mesures entre **20:24Z et 20:26Z** (UTC).
Dépôt : clone de `tournierjc/concord` à `c24e913`, branche `fix/i18n-interpolation` coupée de `origin/main`.
Hôte Linux `aarch64`, `node v26.5.1`, `npm 11.17.0`, `tsx 4.23.15`.

**Défaut mesuré.** `interpolate()` (`src/renderer/i18n.ts:24-30`) remplace une moustache par `''` quand
la variable est absente, et rend la chaîne **brute** quand aucun objet de variables n'est passé :

```ts
function interpolate(template, vars) {
  if (!vars) return template;                 // ← moustache affichée telle quelle
  return template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_m, name) => {
    const value = vars[name];
    return value === undefined ? '' : String(value);   // ← trou vide
  });
}
```

Cinq appels ne fournissaient pas les variables que le libellé attend :

| Appel | Libellé FR | Affiché |
|---|---|---|
| `App.tsx:349` `t('room.create.namePlaceholder')` | `Salon de {{name}}` | **`Salon de {{name}}`** (placeholder du champ) |
| `Room.tsx:199` `t('participant.volume')` + `— {participant.name}` | `Volume de {{name}}` | **`Volume de {{name}} — Léo`** |
| `Room.tsx:221` `t('room.empty.body')` | `Plus personne n'est connecté à « {{name}} ».` | **`… à « {{name}} »`** |
| `Settings.tsx:242` `t('settings.ptt.reset')` | `Rétablir {{shortcut}}` | **`Rétablir {{shortcut}}`** |
| `Settings.tsx:200` `t('settings.vad.thresholdValue', { value })` | `{{db}} dBFS` | **` dBFS`** (nom de variable faux : trou vide) |

Pourquoi ce n'était vu par personne : `design/check-i18n.mjs` (le contrôle i18n documenté, 8 contrôles)
vérifie la **parité du catalogue** — mêmes clés, mêmes moustaches FR/EN, typographie — et
`VERIF/check-labels.sh` mesure l'usage des clés. **Aucun des deux ne vérifie que le code d'appel
fournit les variables.** Le défaut était donc conforme à toutes les portes existantes.

## 1. Ce qui change

| Fichier | Changement |
|---|---|
| `src/renderer/App.tsx` | `RoomList` reçoit `nickname` ; le placeholder est `t('room.create.namePlaceholder', { name: nickname })` **ou absent** si le pseudo est vide (afficher « Salon de » serait un libellé cassé) |
| `src/renderer/Room.tsx` | `t('participant.volume', { name: participant.name })` (le nom n'est plus concaténé à la main) ; `t('room.empty.body', { name: room.roomName ?? '' })` |
| `src/renderer/Settings.tsx` | `{ db: settings.talk.vadThresholdDb }` au lieu de `{ value: … }` ; `{ shortcut: DEFAULT_PTT_ACCELERATOR }` pour le bouton de rétablissement (c'est la valeur qu'il restaure) |
| `tests/i18n-interpolation.node.test.ts` | **nouveau**, 8 tests : détecteur joué sur extraits fabriqués **avant** le scan du dépôt, + parité des moustaches FR/EN, + garde anti-test-vide |
| `package.json`, `docs/TESTS.md` | liste `test:node` (27 fichiers), marqueur `scriptsNote`, TL;DR re-mesuré |

## 2. Mesures (commandes exactes, horodatées)

| Commande | Sortie mesurée | Verdict |
|---|---|---|
| `npx tsx --test tests/i18n-interpolation.node.test.ts` **avant correction** (20:25Z) | 8 tests, **7 pass, 1 fail** — les 5 manques listés avec `fichier:ligne` | ✅ le détecteur voit le défaut |
| idem **après correction** | 8 tests, 8 pass, exit=0 | ✅ |
| `npm test` | **27 fichiers · 672 tests · 672 pass · 0 fail · 51 suites · 5 216 ms** (`20:25:54→20:25:59Z`), rejoué `20:26:05→20:26:10Z` mêmes comptes | ✅ |
| `npx tsc -p tsconfig.json --noEmit` | exit=0 | ✅ |
| `node design/check-i18n.mjs` | `I18N RESULT=PASS` (bundle `ok`, typographie 0) | ✅ |
| `npm run build` | exit=0 | ✅ |
| `sh VERIF/run-all.sh` | `LAN-VOICE VERIF RESULT=PASS` | ✅ |

Ce que le nouveau fichier prouve :
1. un libellé appelé **sans** variables est signalé (moustache brute) ;
2. une variable **au mauvais nom** est signalée (trou vide) ;
3. un libellé à deux moustaches dont **une seule** est fournie est signalé ;
4. la forme abrégée (`{ shortcut }`) et la forme complète (`{ db: … }`) sont acceptées, y compris avec
   des expressions contenant virgules et parenthèses — le détecteur ne fabrique pas de faux positif ;
5. les appels sans moustache et les clés inconnues sont ignorés (la parité des clés reste jugée par
   `design/check-i18n.mjs`) ;
6. sur le dépôt réel : 0 manque, **et** le test exige > 100 appels `t('…')` et > 20 fichiers
   analysés — un test qui passerait parce qu'il n'a rien lu échouerait ici.

## 3. Non vérifié, nommé

- **Aucun rendu réel** : les cinq libellés n'ont pas été relus dans une fenêtre Electron (aucun binaire
  Electron exécutable ici, `libgtk-3.so.0` absent). Ce qui est mesuré est l'appel de traduction
  (variables fournies) et la fonction d'interpolation, pas le pixel.
- Le choix pour `room.create.namePlaceholder` quand le pseudo est vide est **le mien** : pas
  d'indication plutôt qu'une phrase tronquée. Le pseudo reste vide par défaut (A6 : « défaut = nom du
  compte OS ») — l'écrire au premier lancement est une décision laissée ouverte (déjà signalée en
  VERIF 034).
- Le catalogue contient des clés à moustaches **jamais appelées** (mesure de `VERIF/check-labels.sh`
  L4, non bloquante) : ce fichier ne juge pas les clés orphelines, seulement les appels existants.
- Aucune mesure réseau, audio ou microphone : cette unité ne touche que l'habillage.
