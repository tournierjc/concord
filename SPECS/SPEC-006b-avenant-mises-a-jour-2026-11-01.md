# SPEC-006b — Avenant 2026-11-01 : mises à jour automatiques depuis les releases GitHub (arbitrage JC)

Régie · 2026-11-01 · statut : **amendement de SPEC-001 A15 / CA19, arbitrage JC, choix 3 (pleinement automatique)**

---

## 1. L'objet, en une phrase

SPEC-001 A15 / CA19 et la garde réseau (`src/main/net-guard.ts`, SPEC-001 CA20) interdisaient
jusqu'ici **toute** requête vers un domaine public. JC arbitre le 2026-11-01 : la vérification et
l'installation automatiques des mises à jour depuis les publications GitHub du dépôt deviennent
autorisées, à **ces conditions strictes et uniques dérogations**, et à rien d'autre.

## 2. Les conditions (liste close — aucun élargissement sans nouvel avenant)

1. **Hôtes** : seuls `api.github.com` et `objects.githubusercontent.com` (+ les redirections du CDN
   GitHub, qui mènent à `objects.githubusercontent.com`) sont joignables. La liste est **allowlistée
   en dur** dans le module de mise à jour ; l'hôte est vérifié sur l'URL initiale ET sur chaque
   redirection ; HTTPS obligatoire, `http:` refusé.
2. **Aucun `electron-updater`** : ni la dépendance, ni un équivalent. Le téléchargement se fait par
   le module `node:https` du **process principal seul** — jamais par le `fetch` du renderer, jamais
   par une session Electron avec `webRequest` (le CSP du renderer continue d'interdire tout `https:`
   dans `connect-src`, `net-guard.ts` n'est pas touché).
3. **Aucune télémétrie** : l'application n'envoie **jamais** d'identifiant. La requête est la requête
   API GitHub publique standard, sans token, sans query personnalisée, avec un `User-Agent` fixe
   `ConcordDesktop`. Les releases privées ou « insiders » ne sont pas supportées.
4. **Intégrité obligatoire** : chaque artefact est vérifié par l'empreinte SHA-256 publiée dans le
   corps de la release (bloc « Empreintes SHA-256 », même format que la release v0.3.0). Un artefact
   sans empreinte vérifiable n'est **jamais** installé.
5. **Dérogation désactivable** : `update.auto = false` dans les réglages ⇒ plus **aucun** cycle
   automatique hors LAN, retour au comportement CA20 intégral. **Exception** : la demande manuelle
   de l'utilisateur (bouton « Vérifier maintenant ») reste autorisée — c'est une commande explicite,
   pas une initiative de l'application.
6. **Jamais pendant un salon actif** : l'installation (le lancement de l'installeur) ne peut survenir
   pendant qu'un salon est rejoint (`joining` / `connected` / `retrying`). La garde est relue à
   chaque tentative, automatique comme manuelle.

## 3. Conséquences sur les textes antérieurs

- SPEC-001 A15 / CA19 et CA20 (« 0 requête vers un domaine public ») sont amendés **pour ce seul
  chemin** : la boucle `net-guard.ts` (renderer) et la CSP restent inchangées — la dérogation
  n'existe que dans le process principal, hors session Electron.
- La page d'installation (`docs/INSTALL.md`) et le corps de release publiés décrivent les mêmes
  empreintes ; le garde-fous du module est l'empreinte **publiée**, jamais un hash embarqué.

## 4. Surface implémentée

`src/main/update.ts` (service + pures + seam `UpdateIo`), réglage `update` (`src/shell/settings-schema.ts`),
canaux `updateCheckNow` / `updateInstallNow` / `eventUpdateState` (`src/shell/ipc-contract.ts`),
pont (`src/preload/index.ts`), bandeau + réglages (`src/renderer/App.tsx`, `src/renderer/Settings.tsx`),
clés `update.*` FR/EN. Tests : `tests/update-pures.node.test.ts`, `tests/update-service.node.test.ts`,
`tests/update-ipc-settings.node.test.ts`.
