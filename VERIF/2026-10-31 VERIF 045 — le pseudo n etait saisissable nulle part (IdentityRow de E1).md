# VERIF 045 — le pseudo n'était saisissable nulle part (IdentityRow de E1)

Date de la campagne : **2026-10-31**, mesures entre **20:53Z et 21:01Z** (UTC).
Dépôt : clone de `tournierjc/concord` à `c24e913`, branche `fix/identity-row` coupée de `origin/main`.
Hôte Linux `aarch64`, `node v26.5.1`, `tsx 4.23.15`. Rendu : Chromium headless (`chrome-headless-shell`),
bundle Vite réel, couche IPC simulée hors dépôt (harnais `/opt/data/cache/scratch/uiharness-concord`).

## Défaut mesuré

`settings.nickname` existait dans le schéma, était lu par l'écran — et **aucun champ ne l'écrivait** :

| Emplacement | Ce qu'on y trouve | Ce que la spécification demande |
|---|---|---|
| `App.tsx:270` | `<span className="titlebar__identity">{settings.nickname \|\| t('common.none')}</span>` — lecture seule, dans la barre de titre | SPEC-002 **S1.11** : le pseudo va dans une **`IdentityRow` dédiée, sous l'en-tête** ; la barre de titre garde ses 4 contrôles (un champ de 32 caractères dans une barre de 44 px ne porte ni `app.nickname.label`, ni `app.nickname.help`, ni le compteur `n/32`) |
| `App.tsx:162` | `api.joinRoom({ roomId, name: settings.nickname \|\| roomId })` — sans saisie, le nom du salon devient le nom du participant | le nom vient du pseudo (SPEC-001 A6) |
| dictionnaire | `app.nickname.{label,placeholder,help,error.empty,error.tooLong,saved}` — 6 clés, jamais citées | S1.11 les exige toutes les six |

Conséquence : l'utilisateur ne pouvait pas se nommer, et l'écran de salon affichait le nom du salon
comme nom de participant.

## 1. Ce qui change

| Fichier | Changement |
|---|---|
| `src/shell/nickname.ts` | **nouveau** — `NICKNAME_MAX_LENGTH = 32`, `nicknameError(value)` → `'empty' \| 'tooLong' \| null`, `nicknameErrorKey(error)`. Module pur, aucune dépendance |
| `src/renderer/App.tsx` | `IdentityRow` sous l'en-tête (libellé, compteur `n/32`, champ `maxLength`, aide, erreur liée par `aria-describedby`, `aria-invalid`, bordure `state.mute`), région de toast `aria-live="polite"` (`app.nickname.saved`, minuteur par `browser-timers`), **retrait du pseudo de la barre de titre** |
| `src/renderer/styles.css` | `.identity`, `.identity__counter`, `.input--invalid`, `.toast-region`, `.toast` — jetons uniquement ; la règle morte `.titlebar__identity` est retirée |
| `design/i18n/{fr,en}.json` + `design/i18n.json` | clé `common.counter` (`{{value}}/{{max}}`), insérée à la même position dans les deux langues (le contrôle d'ordre de `check-i18n.mjs` l'exige) |
| `tests/identity-row.node.test.ts` | **nouveau**, 12 tests (voir §2) |
| `package.json`, `docs/TESTS.md` | liste `test:node` (27 fichiers), marqueur `scriptsNote`, TL;DR re-mesuré |

Deux déclencheurs distincts, comme le veut S1.11 : `tooLong` tombe **à la frappe** (c'est un collage),
`empty` tombe **à la sortie de champ** — accuser « Entrez un pseudo. » pendant qu'on efface la ligne
pour la réécrire serait un reproche en pleine saisie. Dans tous les cas, **la valeur en vigueur ne
suit que les saisies valides** : le pseudo précédent reste en vigueur, et rien n'est désactivé.

## 2. Mesures

| Commande / sonde | Sortie mesurée | Verdict |
|---|---|---|
| `npx tsx --test tests/identity-row.node.test.ts` | 12 tests, 12 pass | ✅ |
| `npm test` | **27 fichiers · 676 tests · 676 pass · 0 fail · 49 suites · 5 257 ms** (`21:00:51→21:00:56Z`) | ✅ |
| `npx tsc -p tsconfig.json --noEmit` | exit=0 | ✅ |
| `npm run build` | exit=0 | ✅ |
| `sh VERIF/run-all.sh` | **`LAN-VOICE VERIF RESULT=PASS`** (`21:00:56Z`) | ✅ |
| `node design/check-i18n.mjs` | 298 clés fr/en, `orderDiff=0`, `bundle=ok`, **`RESULT=PASS`** | ✅ |
| sonde DOM `?view=identity` | `counter=2/32 aria=false describedby=identity-help help=Visible par les autres participants du réseau local.` | ✅ le compteur, l'aide et le lien d'accessibilité sont bien rendus |
| sonde DOM `?view=identity-error` (champ vidé puis quitté) | `aria=true border=rgb(255, 107, 107) error=Entrez un pseudo.` | ✅ `rgb(255,107,107)` = jeton `state.mute` (`#FF6B6B`) : la bordure passe bien en `state.mute`, et le message est celui du dictionnaire |
| sonde DOM `?view=identity-saved` (pseudo valide puis sortie de champ) | `toast=Pseudo enregistré.Fermer live=polite` | ✅ le toast est rendu et annoncé poliment |

Les 12 tests couvrent : la règle pure (valide, 32 exactement, 33 refusé, blancs = vide, ordre
`tooLong` avant `empty`) ; la **cohérence avec le schéma de réglages** (32 accepté, 33 refusé avec
`.nickname:range`) ; le câblage (`titlebar__identity` absent du TSX **et** du CSS, libellé/aide/compteur
/`aria`/`maxLength` présents, aucun bouton désactivé par une saisie invalide, `onChange` seulement sur
saisie valide, `setError(found)` seulement à la sortie de champ) ; les clés de dictionnaire présentes
dans les deux langues et parallèles ; les jetons CSS employés, sans nom mort.

## 3. Non vérifié, nommé

- **Aucune fenêtre Electron ne s'ouvre dans ce conteneur** (`libgtk-3` absent) : le rendu est celui du
  bundle Vite réel dans Chromium headless, avec un faux `window.lanAPI` hors dépôt. La saisie réelle au
  clavier, le focus système et l'enregistrement disque des réglages (IPC réel) ne sont pas exercés.
- La capture montre le message d'erreur en blanc : sur `main`, `.field__error` pointe encore sur
  `--color-state-danger`, un jeton **inexistant** — c'est l'objet de la PR #11 (`fix/design-tokens`),
  qui le ramène à `state.mute` (gris) comme l'exige S1.11. La **bordure** du champ, elle, est déjà
  mesurée en `state.mute` (`rgb(255,107,107)`) parce que `.input--invalid` emploie le bon jeton.
- Le prénom du compte OS (SPEC-001 A6) comme valeur initiale vient de la PR #2
  (`fix/room-name-semantics`, `resolveDisplayName`) : sur `main`, le champ démarre vide, ce qui est
  cohérent avec l'état actuel du dépôt. Les deux PR touchent `package.json` et `docs/TESTS.md` : rebase
  trivial.
- Les autres éléments de l'arbre S1.11 (`LobbyFooter { port, discoveryMethod, offline }`, bannière,
  squelettes) ne sont **pas** traités ici : ce lot ne fait que le pseudo.
