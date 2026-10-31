# Note pour Cadre — clés i18n et jetons exacts à consommer

Version : 1.1 — 2026-10-30 — **Maquette** · compagnon de `SPECS/SPEC-002-ergonomie.md` v1.1
Racine unique : `/work/lan-voice`. Rien à installer : les deux contrôles sont en node pur.

## 0. Règles de consommation (non négociables)

1. **Aucune valeur en dur.** Couleur, taille, espacement, rayon, durée, seuil → `design/tokens.json`.
   Aucun texte visible, aucun `aria-label`, aucun `title` → `design/i18n/{fr,en}.json`.
2. **Deux langues livrées ensemble.** Une clé ajoutée dans `fr.json` doit exister dans `en.json`, dans le
   même ordre, avec les mêmes moustaches. `node design/check-i18n.mjs` doit sortir en 0.
3. **Interpolation** : `{{nom}}` uniquement, aucune concaténation de phrases.
4. **Raccourcis** : la valeur technique est `input.ptt.defaultAccelerator` (`Alt+Space`) ; le libellé
   affiché s'assemble avec `common.key.ctrl|alt|shift|space|esc` joints par `+` sous `common.keyChord` —
   d'où `Alt+Espace` en FR et `Alt+Space` en EN. Ne jamais écrire le raccourci en dur dans une chaîne.
5. **Tokens jamais mutés** : `design/tokens.json` et `design/i18n/*.json` sont lus, pas édités par la coquille.
6. **Overlay** : la valeur d'opacité applique `overlay.opacity.min` (0.6) à la **plaque seule** ;
   `win.setOpacity()` est interdit (§6.5) et la fenêtre doit rester `setIgnoreMouseEvents(true, { forward: true })`.

## E1 — Salons (accueil / découverte)

Coquille : `DiscoveryScreen, RoomList, CreateRoomDialog`.

**Clés i18n : 33** — toutes présentes dans `design/i18n/fr.json` et `en.json`.

- `app.nickname.*` (4) : `app.nickname.error.empty`, `app.nickname.help`, `app.nickname.label`, `app.nickname.saved`
- `discovery.empty.*` (4) : `discovery.empty.action.create`, `discovery.empty.action.refresh`, `discovery.empty.body`, `discovery.empty.title`
- `discovery.error.*` (4) : `discovery.error.alldown.body`, `discovery.error.alldown.title`, `discovery.error.mdns.body`, `discovery.error.mdns.title`
- `discovery.footer.*` (1) : `discovery.footer.offline`
- `discovery.method.*` (2) : `discovery.method.broadcast`, `discovery.method.none`
- `discovery.offline.*` (1) : `discovery.offline.title`
- `discovery.state.*` (5) : `discovery.state.count.other`, `discovery.state.long`, `discovery.state.refreshing`, `discovery.state.searching`, `discovery.state.searchingHint`
- `room.create.*` (5) : `room.create.capacity`, `room.create.error.empty`, `room.create.error.exists`, `room.create.error.tooLong`, `room.create.namePlaceholder`
- `room.row.*` (7) : `room.row.full`, `room.row.fullReason`, `room.row.gone`, `room.row.host`, `room.row.join`, `room.row.members`, `room.row.peopleMore`

**Jetons : 28** — chemins à lire dans `design/tokens.json`.

```
bg.hover
bg.inset
bg.raised
bg.surface
border.strong
border.subtle
focus.ring
motion.duration.fade
motion.duration.hover
motion.spinnerPeriod
radius.md
radius.sm
radius.xl
scrim.dialog
space.1
space.2
space.3
space.4
space.5
space.6
space.8
state.mute
state.muteSubtle
state.warn
state.warnSubtle
text.muted
text.primary
text.secondary
```

## E2 — Dans un salon (Room)

Coquille : `RoomScreen, ParticipantTile, ControlBar`.

**Clés i18n : 51** — toutes présentes dans `design/i18n/fr.json` et `en.json`.

- `a11y.iceRecovered.*` (1) : `a11y.iceRecovered`
- `a11y.left.*` (1) : `a11y.left`
- `a11y.pttIgnored.*` (1) : `a11y.pttIgnored`
- `a11y.roomJoined.*` (1) : `a11y.roomJoined`
- `a11y.selfDeafened.*` (1) : `a11y.selfDeafened`
- `a11y.selfMuted.*` (1) : `a11y.selfMuted`
- `a11y.selfUndeafened.*` (1) : `a11y.selfUndeafened`
- `a11y.selfUnmuted.*` (1) : `a11y.selfUnmuted`
- `common.retry.*` (1) : `common.retry`
- `control.deafen.*` (2) : `control.deafen.help`, `control.deafen.state`
- `control.mute.*` (1) : `control.mute.state`
- `control.ptt.*` (2) : `control.ptt.active`, `control.ptt.whileMuted`
- `discovery.state.*` (1) : `discovery.state.long`
- `error.body.*` (1) : `error.body`
- `participant.connecting.*` (1) : `participant.connecting`
- `participant.connectionLost.*` (1) : `participant.connectionLost`
- `participant.deafened.*` (1) : `participant.deafened`
- `participant.iceFailed.*` (1) : `participant.iceFailed`
- `participant.iceRetrying.*` (1) : `participant.iceRetrying`
- `participant.left.*` (1) : `participant.left`
- `participant.muted.*` (1) : `participant.muted`
- `participant.speaking.*` (1) : `participant.speaking`
- `participant.you.*` (1) : `participant.you`
- `room.connecting.*` (1) : `room.connecting`
- `room.empty.*` (1) : `room.empty.action`
- `room.error.*` (4) : `room.error.audioInit`, `room.error.audioInitAction`, `room.error.deviceLost`, `room.error.deviceLostBody`
- `room.full.*` (3) : `room.full.action`, `room.full.body`, `room.full.title`
- `room.header.*` (4) : `room.header.latency`, `room.header.members`, `room.header.peers`, `room.header.quality`
- `settings.audio.*` (1) : `settings.audio.input`
- `settings.vad.*` (12) : `settings.vad.calibrateApply`, `settings.vad.calibrateFailed`, `settings.vad.calibrated`, `settings.vad.calibrating`, `settings.vad.help`, `settings.vad.helpTooLow`, `settings.vad.hysteresis`, `settings.vad.liveLevel`, `settings.vad.noiseFloor`, `settings.vad.noiseMeasuring`, `settings.vad.threshold`, `settings.vad.thresholdValue`

**Jetons : 28** — chemins à lire dans `design/tokens.json`.

```
accent.default
bg.hover
bg.inset
bg.raised
bg.surface
border.subtle
motion.duration.fade
motion.duration.halo
motion.duration.panel
motion.reducedMotionDuration
motion.spinnerPeriod
overlay.haloOffset
radius.lg
radius.pill
radius.sm
space.2
space.4
space.6
state.mute
state.ok
state.speaking
state.warn
state.warnSubtle
text.inverse
text.muted
text.primary
text.secondary
typography.family.mono
```

## E3 — Réglages (Settings)

Coquille : `SettingsScreen (Audio, Entrée, Réseau, Overlay, À propos)`.

**Clés i18n : 45** — toutes présentes dans `design/i18n/fr.json` et `en.json`.

- `a11y.settingsSaved.*` (1) : `a11y.settingsSaved`
- `control.ptt.*` (1) : `control.ptt.hold`
- `settings.audio.*` (14) : `settings.audio.aecHelp`, `settings.audio.aecUnavailable`, `settings.audio.inputNone`, `settings.audio.inputNoneHelp`, `settings.audio.outputNone`, `settings.audio.outputNoneHelp`, `settings.audio.permissionRetry`, `settings.audio.permissionTitle`, `settings.audio.rnnoise`, `settings.audio.rnnoiseUnavailable`, `settings.audio.systemDefault`, `settings.audio.test`, `settings.audio.testDone`, `settings.audio.testing`
- `settings.error.*` (1) : `settings.error.save`
- `settings.network.*` (9) : `settings.network.discovery`, `settings.network.external`, `settings.network.externalHelp`, `settings.network.externalNone`, `settings.network.identity`, `settings.network.identityHelp`, `settings.network.name`, `settings.network.port`, `settings.network.portBumped`
- `settings.overlay.*` (5) : `settings.overlay.disabledHint`, `settings.overlay.help`, `settings.overlay.opacityValue`, `settings.overlay.screen.n`, `settings.overlay.screenMissing`
- `settings.ptt.*` (6) : `settings.ptt.active`, `settings.ptt.conflict`, `settings.ptt.inactive`, `settings.ptt.needModifier`, `settings.ptt.recorded`, `settings.ptt.recording`
- `settings.vad.*` (8) : `settings.vad.calibrateFailed`, `settings.vad.calibrated`, `settings.vad.calibrating`, `settings.vad.helpTooLow`, `settings.vad.liveLevel`, `settings.vad.noiseFloor`, `settings.vad.noiseMeasuring`, `settings.vad.thresholdValue`

**Jetons : 24** — chemins à lire dans `design/tokens.json`.

```
accent.default
accent.subtle
bg.hover
bg.inset
bg.surface
border.strong
border.subtle
motion.duration.panel
radius.lg
radius.md
radius.sm
space.1
space.2
space.4
space.6
state.mute
state.muteSubtle
state.ok
state.speaking
state.warn
text.muted
text.primary
text.secondary
typography.family.mono
```

## E4 — Overlay

Coquille : `OverlayWindow`.

**Clés i18n : 4** — toutes présentes dans `design/i18n/fr.json` et `en.json`.

- `a11y.muted.*` (1) : `a11y.muted`
- `a11y.speaking.*` (1) : `a11y.speaking`
- `settings.overlay.*` (2) : `settings.overlay.enabled`, `settings.overlay.positionReset`

**Jetons : 24** — chemins à lire dans `design/tokens.json`.

```
bg.overlay
bg.surface
border.subtle
motion.duration.halo
motion.duration.panel
motion.reducedMotionDuration
overlay.avatarFontSize
overlay.avatarGap
overlay.avatarSize
overlay.dragThresholdPx
overlay.handleDots
overlay.handleWidth
overlay.maxWidth
overlay.minWidth
overlay.opacity.min
overlay.paddingX
overlay.paddingY
overlay.radius
overlay.rowHeight
space.4
state.mute
state.speaking
text.muted
text.primary
```

## Ergonomie PTT et détection de voix

Coquille : `ptt.ts, vad.ts, ControlBar`.

**Clés i18n : 16** — toutes présentes dans `design/i18n/fr.json` et `en.json`.

- `a11y.pttIgnored.*` (1) : `a11y.pttIgnored`
- `control.ptt.*` (3) : `control.ptt.active`, `control.ptt.hold`, `control.ptt.whileMuted`
- `settings.ptt.*` (7) : `settings.ptt.active`, `settings.ptt.conflict`, `settings.ptt.globalHelp`, `settings.ptt.inactive`, `settings.ptt.needModifier`, `settings.ptt.recorded`, `settings.ptt.recording`
- `settings.vad.*` (5) : `settings.vad.calibrateFailed`, `settings.vad.calibrated`, `settings.vad.calibrating`, `settings.vad.helpTooLow`, `settings.vad.noiseFloor`

**Jetons : 5** — chemins à lire dans `design/tokens.json`.

```
accent.default
state.mute
state.ok
state.speaking
state.warn
```

## Accessibilité transversale

Coquille : `tous les écrans`.

**Clés i18n : 20** — toutes présentes dans `design/i18n/fr.json` et `en.json`.

- `a11y.discoveryError.*` (1) : `a11y.discoveryError`
- `a11y.iceFailed.*` (1) : `a11y.iceFailed`
- `a11y.iceRecovered.*` (1) : `a11y.iceRecovered`
- `a11y.joined.*` (1) : `a11y.joined`
- `a11y.left.*` (1) : `a11y.left`
- `a11y.muted.*` (1) : `a11y.muted`
- `a11y.pttIgnored.*` (1) : `a11y.pttIgnored`
- `a11y.roomJoined.*` (1) : `a11y.roomJoined`
- `a11y.selfDeafened.*` (1) : `a11y.selfDeafened`
- `a11y.selfMuted.*` (1) : `a11y.selfMuted`
- `a11y.selfUndeafened.*` (1) : `a11y.selfUndeafened`
- `a11y.selfUnmuted.*` (1) : `a11y.selfUnmuted`
- `a11y.settingsSaved.*` (1) : `a11y.settingsSaved`
- `a11y.speaking.*` (1) : `a11y.speaking`
- `a11y.speakingSelf.*` (1) : `a11y.speakingSelf`
- `app.title.*` (1) : `app.title`
- `control.micLevel.*` (1) : `control.micLevel`
- `participant.speaking.*` (1) : `participant.speaking`
- `room.row.*` (1) : `room.row.gone`
- `settings.overlay.*` (1) : `settings.overlay.scale`

**Jetons : 1** — chemins à lire dans `design/tokens.json`.

```
border.strong
```

## Récapitulatif

- 241 clés i18n au total (FR et EN identiques, contrôlées par `node design/check-i18n.mjs`).
- 132 clés citées par les sections écran ci-dessus. Les 109 autres
  sont citées ailleurs dans le SPEC (en-tête, §2, §9, §10) et doivent être consommées de la même façon :
  §9 les liste **toutes**, dans l'ordre, avec leur traduction.
- 54 chemins de jetons distincts cités ; `design/tokens.json` en contient davantage
  (`color.*`, `typography.*`, `space.*`, `radius.*`, `motion.*`) — les sections §2.1 à §2.9 du SPEC font foi.

## Vérification avant livraison (à coller dans ton rapport)

```bash
cd /work/lan-voice
node design/check-i18n.mjs      # doit afficher I18N RESULT=PASS et sortir en 0
node design/check-contrast.mjs  # doit afficher CONTRAST RESULT=PASS et sortir en 0
VERIF/run-all.sh                # contrôles réseau/dépendances du dépôt
```
