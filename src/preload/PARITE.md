# T8 — Parité contrat ↔ preload (lecture seule)

Source : `src/shell/ipc-contract.ts` (grep ciblé, jamais lu en entier) vs `src/preload/index.ts` (lu, 4,1 Ko).

- Canaux contrat : 17 (10 invoke : settings get/set/open, room join/leave, control set-mute/set-deafen/push-to-talk/set-gain, overlay set ; 7 events : participants, speaking, room-state, control-state, settings-changed, overlay-geometry, shortcut-conflict)
- Exposés : 17 (10 invoke + 7 events via `subscribe`)
- Manquants : aucun — les 10 `IPC.*` invoke et les 7 `IPC.event*` sont consommés
- En trop : aucun — `lanAPI` est typé `LanAPI`, aucune surface hors contrat
- Désabonnements : oui (ligne 55, `ipcRenderer.removeListener` dans le retour de `subscribe`, ligne 43)
- Accès node/require direct dans le preload : non (`grep` = 0 `require(`, 0 `process.` ; seuls imports `electron` + contrat + `import type { Settings }`)
- Gel : oui (ligne 93 `Object.freeze(lanAPI)`, ligne 94 `exposeInMainWorld` unique)
- Gardes : `guardPayload` avant chaque `invoke` (ligne 36) et avant chaque relais d'événement (ligne 46) ; événement hors contrat ignoré + log
- `api.d.ts` : conforme (495 o, `Window.lanAPI: LanAPI`, aucun code)
- Fichiers `index.ts` / `api.d.ts` : non modifiés par cette tâche (lecture seule)
- Réserve : non vérifié à l'exécution (nécessite Electron) — c'est le rôle du build/QA, hors périmètre T8

PROCHAIN GESTE : vérifier dans `src/main/ipc.ts` que les 10 `handle(IPC.*)` et les 7 `send(IPC.event*)` couvrent exactement ces 17 canaux — un seul fichier, lecture ciblée par grep.

## Constat main ↔ canon — 17 canaux (T4491d116, lecture seule)

Cible réelle : `src/main/ipc.ts` **n'existe pas** ; le câblage est dans `src/main/index.ts` (`registerIpcHandlers` l.291-337, `sendEvent`/`forwardBridgeEvent` l.238-263). `src/shell/ipc.ts` (supprimé) : aucune référence dans `src/main`, `src/preload`, `src/shell`.

- lan:settings:get, :set, :open · lan:room:join, :leave · lan:control:set-mute, :set-deafen, :push-to-talk, :set-gain · lan:overlay:set (10 invoke) → CÂBLÉ, 10/10 clés `[IPC.*]`, 0 littéral
- lan:event:settings-changed → câblé (`IPC.eventSettingsChanged`, `persist`)
- lan:event:overlay-geometry → câblé (`IPC.eventOverlayGeometry`, l.184 + l.258)
- lan:event:shortcut-conflict → câblé (`IPC.eventShortcutConflict`, l.111)
- lan:event:participants → ABSENT (câblé en apparence, cassé sur le fil)
- lan:event:room-state → ABSENT (idem)
- lan:event:control-state → ABSENT (idem)
- lan:event:speaking → ABSENT (jamais émis)

ÉCARTS
1. Canon non câblé : 4 events sur 7. `room-bridge.ts` émet `{channel:'eventParticipants'|'eventRoomState'|'eventControlState'}` : discriminant = nom de clé, pas la valeur `lan:event:*` ; `forwardBridgeEvent` le caste `as IpcEventChannel` (le cast masque l'erreur au compilateur) et `sendEvent` envoie ce littéral → refusé par `guardPayload` avant `webContents.send`, donc jamais reçu côté renderer.
2. `eventSpeaking` : présent dans l'union `BridgeEvent` (room-bridge l.29), aucune fonction ne l'émet → canal mort.
3. Littéral au lieu de `IPC.*` : 3 (les events du point 1) ; côté invoke 0 (grep `'lan:` dans src/main = 0 hit).
4. Canaux câblés hors canon : 0 — `ipcMain.handle` sur liste fermée de 10 clés, pas de wildcard.
Hors périmètre : renderer/tests non greppés, aucun test lancé, aucun code modifié (seul ce fichier).
