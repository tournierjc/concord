# Arbitrage des 157 clés mortes — feature/i18n-wiring, commit 54e960c

Catalogue final : 172 clés × 2 locales (312 → 172). 32 legacy supprimées, 108 mortes supprimées, 16 câblées, 1 faux positif de l'audit conservé (app.nickname.error.empty).


## (B) Legacy supprimées — doublons historiques des familles vivantes (32)

| Clé | Verdict | Motif |
|---|---|---|
| audio.default_device | B supprimée | doublon historique de la famille vivante settings.audio.* ; 0 référence vérifiée |
| audio.device_input | B supprimée | doublon historique de la famille vivante settings.audio.* ; 0 référence vérifiée |
| audio.device_output | B supprimée | doublon historique de la famille vivante settings.audio.* ; 0 référence vérifiée |
| audio.gain | B supprimée | doublon historique de la famille vivante settings.audio.* ; 0 référence vérifiée |
| audio.level | B supprimée | doublon historique de la famille vivante settings.audio.* ; 0 référence vérifiée |
| audio.loopback_test | B supprimée | doublon historique de la famille vivante settings.audio.* ; 0 référence vérifiée |
| audio.permission_denied | B supprimée | doublon historique de la famille vivante settings.audio.* ; 0 référence vérifiée |
| audio.vad_off | B supprimée | doublon historique de la famille vivante settings.audio.* ; 0 référence vérifiée |
| audio.vad_on | B supprimée | doublon historique de la famille vivante settings.audio.* ; 0 référence vérifiée |
| erreurs.copy_diagnostic | B supprimée | doublon historique de la famille vivante error.*/room.error.* ; 0 référence vérifiée |
| erreurs.generic | B supprimée | doublon historique de la famille vivante error.*/room.error.* ; 0 référence vérifiée |
| erreurs.retry | B supprimée | doublon historique de la famille vivante error.*/room.error.* ; 0 référence vérifiée |
| ptt.conflict | B supprimée | doublon historique de la famille vivante settings.ptt.* ; 0 référence vérifiée |
| ptt.down | B supprimée | doublon historique de la famille vivante settings.ptt.* ; 0 référence vérifiée |
| ptt.edit | B supprimée | doublon historique de la famille vivante settings.ptt.* ; 0 référence vérifiée |
| ptt.hint | B supprimée | doublon historique de la famille vivante settings.ptt.* ; 0 référence vérifiée |
| ptt.reset | B supprimée | doublon historique de la famille vivante settings.ptt.* ; 0 référence vérifiée |
| ptt.unbound | B supprimée | doublon historique de la famille vivante settings.ptt.* ; 0 référence vérifiée |
| ptt.up | B supprimée | doublon historique de la famille vivante settings.ptt.* ; 0 référence vérifiée |
| reseau.beacon | B supprimée | doublon historique de la famille vivante settings.network.* ; 0 référence vérifiée |
| reseau.lan_only | B supprimée | doublon historique de la famille vivante settings.network.* ; 0 référence vérifiée |
| reseau.mdns_unavailable | B supprimée | doublon historique de la famille vivante settings.network.* ; 0 référence vérifiée |
| reseau.no_peer_found | B supprimée | doublon historique de la famille vivante settings.network.* ; 0 référence vérifiée |
| reseau.port_conflict | B supprimée | doublon historique de la famille vivante settings.network.* ; 0 référence vérifiée |
| reseau.ws_port | B supprimée | doublon historique de la famille vivante settings.network.* ; 0 référence vérifiée |
| salle.empty | B supprimée | doublon historique de la famille vivante room.* ; 0 référence vérifiée |
| salle.full | B supprimée | doublon historique de la famille vivante room.* ; 0 référence vérifiée |
| salle.full.ok | B supprimée | doublon historique de la famille vivante room.* ; 0 référence vérifiée |
| salle.join | B supprimée | doublon historique de la famille vivante room.* ; 0 référence vérifiée |
| salle.leave | B supprimée | doublon historique de la famille vivante room.* ; 0 référence vérifiée |
| salle.reconnecting | B supprimée | doublon historique de la famille vivante room.* ; 0 référence vérifiée |
| salle.self_muted | B supprimée | doublon historique de la famille vivante room.* ; 0 référence vérifiée |

## (B) Mortes supprimées — sans écran réel ou sans donnée mesurée (108)

| Clé | Verdict | Motif |
|---|---|---|
| a11y.discoveryError | B supprimée | aucun événement renderer ne publie ces annonces ; les notifications existantes passent par la region live avec les clés vivantes |
| a11y.iceFailed | B supprimée | aucun événement renderer ne publie ces annonces ; les notifications existantes passent par la region live avec les clés vivantes |
| a11y.iceRecovered | B supprimée | aucun événement renderer ne publie ces annonces ; les notifications existantes passent par la region live avec les clés vivantes |
| a11y.joined | B supprimée | aucun événement renderer ne publie ces annonces ; les notifications existantes passent par la region live avec les clés vivantes |
| a11y.left | B supprimée | aucun événement renderer ne publie ces annonces ; les notifications existantes passent par la region live avec les clés vivantes |
| a11y.muted | B supprimée | aucun événement renderer ne publie ces annonces ; les notifications existantes passent par la region live avec les clés vivantes |
| a11y.pttIgnored | B supprimée | aucun événement renderer ne publie ces annonces ; les notifications existantes passent par la region live avec les clés vivantes |
| a11y.roomJoined | B supprimée | aucun événement renderer ne publie ces annonces ; les notifications existantes passent par la region live avec les clés vivantes |
| a11y.selfDeafened | B supprimée | aucun événement renderer ne publie ces annonces ; les notifications existantes passent par la region live avec les clés vivantes |
| a11y.selfMuted | B supprimée | aucun événement renderer ne publie ces annonces ; les notifications existantes passent par la region live avec les clés vivantes |
| a11y.selfUndeafened | B supprimée | aucun événement renderer ne publie ces annonces ; les notifications existantes passent par la region live avec les clés vivantes |
| a11y.selfUnmuted | B supprimée | aucun événement renderer ne publie ces annonces ; les notifications existantes passent par la region live avec les clés vivantes |
| a11y.settingsSaved | B supprimée | aucun événement renderer ne publie ces annonces ; les notifications existantes passent par la region live avec les clés vivantes |
| a11y.speaking | B supprimée | aucun événement renderer ne publie ces annonces ; les notifications existantes passent par la region live avec les clés vivantes |
| a11y.speakingSelf | B supprimée | aucun événement renderer ne publie ces annonces ; les notifications existantes passent par la region live avec les clés vivantes |
| app.avatar.upload.error.not-an-image | B supprimée | upload d'avatar recâblé : le flux image locale existe déjà avec les clés vivantes app.avatar.* ; title serait un doublon de légende |
| app.avatar.upload.error.too-large | B supprimée | upload d'avatar recâblé : le flux image locale existe déjà avec les clés vivantes app.avatar.* ; title serait un doublon de légende |
| app.avatar.upload.error.wrong-format | B supprimée | upload d'avatar recâblé : le flux image locale existe déjà avec les clés vivantes app.avatar.* ; title serait un doublon de légende |
| app.avatar.upload.title | B supprimée | upload d'avatar recâblé : le flux image locale existe déjà avec les clés vivantes app.avatar.* ; title serait un doublon de légende |
| app.theme.dark | B supprimée | thème forcé : l'app suit le système, aucun sélecteur de thème n'existe (aucun contrôle dans Settings.tsx) |
| app.theme.label | B supprimée | thème forcé : l'app suit le système, aucun sélecteur de thème n'existe (aucun contrôle dans Settings.tsx) |
| app.theme.light | B supprimée | thème forcé : l'app suit le système, aucun sélecteur de thème n'existe (aucun contrôle dans Settings.tsx) |
| app.theme.system | B supprimée | thème forcé : l'app suit le système, aucun sélecteur de thème n'existe (aucun contrôle dans Settings.tsx) |
| app.window.close | B supprimée | minimiser/fermer/épingler existent en chrome natif Electron ; recâbler des boutons would dupliquer le titre système et toucher src/main (interdit) |
| app.window.maximize | B supprimée | minimiser/fermer/épingler existent en chrome natif Electron ; recâbler des boutons would dupliquer le titre système et toucher src/main (interdit) |
| app.window.minimize | B supprimée | minimiser/fermer/épingler existent en chrome natif Electron ; recâbler des boutons would dupliquer le titre système et toucher src/main (interdit) |
| common.key.alt | B supprimée | unités/« secondes »/keyChord : aucun affichage temporel ou affichage de raccourci formaté n'existe (le raccourci est affiché brut, déjà libellé) |
| common.key.ctrl | B supprimée | unités/« secondes »/keyChord : aucun affichage temporel ou affichage de raccourci formaté n'existe (le raccourci est affiché brut, déjà libellé) |
| common.key.esc | B supprimée | unités/« secondes »/keyChord : aucun affichage temporel ou affichage de raccourci formaté n'existe (le raccourci est affiché brut, déjà libellé) |
| common.key.shift | B supprimée | unités/« secondes »/keyChord : aucun affichage temporel ou affichage de raccourci formaté n'existe (le raccourci est affiché brut, déjà libellé) |
| common.key.space | B supprimée | unités/« secondes »/keyChord : aucun affichage temporel ou affichage de raccourci formaté n'existe (le raccourci est affiché brut, déjà libellé) |
| common.keyChord | B supprimée | unités/« secondes »/keyChord : aucun affichage temporel ou affichage de raccourci formaté n'existe (le raccourci est affiché brut, déjà libellé) |
| common.seconds | B supprimée | unités/« secondes »/keyChord : aucun affichage temporel ou affichage de raccourci formaté n'existe (le raccourci est affiché brut, déjà libellé) |
| control.deafen.help | B supprimée | les boutons mute/deafen/PTT rendent déjà leurs libellés d'état via les clés vivantes control.* ; les variantes .state/.help n'ont pas de surface distincte sans duplication |
| control.deafen.state | B supprimée | les boutons mute/deafen/PTT rendent déjà leurs libellés d'état via les clés vivantes control.* ; les variantes .state/.help n'ont pas de surface distincte sans duplication |
| control.mute.state | B supprimée | les boutons mute/deafen/PTT rendent déjà leurs libellés d'état via les clés vivantes control.* ; les variantes .state/.help n'ont pas de surface distincte sans duplication |
| control.ptt.whileMuted | B supprimée | les boutons mute/deafen/PTT rendent déjà leurs libellés d'état via les clés vivantes control.* ; les variantes .state/.help n'ont pas de surface distincte sans duplication |
| control.settingsAudio | B supprimée | les boutons mute/deafen/PTT rendent déjà leurs libellés d'état via les clés vivantes control.* ; les variantes .state/.help n'ont pas de surface distincte sans duplication |
| control.vad.noise | B supprimée | les boutons mute/deafen/PTT rendent déjà leurs libellés d'état via les clés vivantes control.* ; les variantes .state/.help n'ont pas de surface distincte sans duplication |
| control.vad.threshold | B supprimée | les boutons mute/deafen/PTT rendent déjà leurs libellés d'état via les clés vivantes control.* ; les variantes .state/.help n'ont pas de surface distincte sans duplication |
| discovery.error.alldown.body | B supprimée | état long / tous-down : le footer du lobby affiche déjà l'état mesuré (lobbyFooterView) avec les clés vivantes |
| discovery.state.long | B supprimée | état long / tous-down : le footer du lobby affiche déjà l'état mesuré (lobbyFooterView) avec les clés vivantes |
| error.body | B supprimée | catalogue d'erreurs génériques sans code d'erreur publié par le contrat IPC (ipc-contract.ts interdit) ; les erreurs réellement remontées utilisent room.error.*/error.* vivants |
| error.roomGone | B supprimée | catalogue d'erreurs génériques sans code d'erreur publié par le contrat IPC (ipc-contract.ts interdit) ; les erreurs réellement remontées utilisent room.error.*/error.* vivants |
| error.signaling | B supprimée | catalogue d'erreurs génériques sans code d'erreur publié par le contrat IPC (ipc-contract.ts interdit) ; les erreurs réellement remontées utilisent room.error.*/error.* vivants |
| error.signalingBody | B supprimée | catalogue d'erreurs génériques sans code d'erreur publié par le contrat IPC (ipc-contract.ts interdit) ; les erreurs réellement remontées utilisent room.error.*/error.* vivants |
| error.title | B supprimée | catalogue d'erreurs génériques sans code d'erreur publié par le contrat IPC (ipc-contract.ts interdit) ; les erreurs réellement remontées utilisent room.error.*/error.* vivants |
| overlay.anim | B supprimée | 0 référence vérifiée dans src/, tests/, design/*.mjs ; aucun écran correspondant |
| overlay.avatar | B supprimée | 0 référence vérifiée dans src/, tests/, design/*.mjs ; aucun écran correspondant |
| overlay.click_through | B supprimée | 0 référence vérifiée dans src/, tests/, design/*.mjs ; aucun écran correspondant |
| overlay.halo | B supprimée | 0 référence vérifiée dans src/, tests/, design/*.mjs ; aucun écran correspondant |
| overlay.hover_show | B supprimée | 0 référence vérifiée dans src/, tests/, design/*.mjs ; aucun écran correspondant |
| overlay.no_peers | B supprimée | 0 référence vérifiée dans src/, tests/, design/*.mjs ; aucun écran correspondant |
| participant.connecting | B supprimée | états de pair non publiés par le maillage (voice-mesh.ts interdit) ; les états réellement reçus sont déjà rendus par les clés vivantes room.peer.* |
| participant.connectionLost | B supprimée | états de pair non publiés par le maillage (voice-mesh.ts interdit) ; les états réellement reçus sont déjà rendus par les clés vivantes room.peer.* |
| participant.joined | B supprimée | états de pair non publiés par le maillage (voice-mesh.ts interdit) ; les états réellement reçus sont déjà rendus par les clés vivantes room.peer.* |
| participant.left | B supprimée | états de pair non publiés par le maillage (voice-mesh.ts interdit) ; les états réellement reçus sont déjà rendus par les clés vivantes room.peer.* |
| participant.localMute | B supprimée | états de pair non publiés par le maillage (voice-mesh.ts interdit) ; les états réellement reçus sont déjà rendus par les clés vivantes room.peer.* |
| participant.localMuted | B supprimée | états de pair non publiés par le maillage (voice-mesh.ts interdit) ; les états réellement reçus sont déjà rendus par les clés vivantes room.peer.* |
| participant.localUnmute | B supprimée | états de pair non publiés par le maillage (voice-mesh.ts interdit) ; les états réellement reçus sont déjà rendus par les clés vivantes room.peer.* |
| room.connecting | B supprimée | restant : connecting/full/pin/error/leave sans surface — soit déjà couvert par les clés vivantes, soit sans donnée mesurée (qualité/latence/pin : aucune mesure ⇒ la clé meurt avec l'absence d'indicateur, loi du repo) |
| room.create.error.tooLong | B supprimée | titre/sous-titre : le modal de création a déjà ses libellés vivants ; error.tooLong sans garde de longueur côté UI existante |
| room.create.subtitle | B supprimée | titre/sous-titre : le modal de création a déjà ses libellés vivants ; error.tooLong sans garde de longueur côté UI existante |
| room.create.title | B supprimée | titre/sous-titre : le modal de création a déjà ses libellés vivants ; error.tooLong sans garde de longueur côté UI existante |
| room.error.audioInit | B supprimée | restant : connecting/full/pin/error/leave sans surface — soit déjà couvert par les clés vivantes, soit sans donnée mesurée (qualité/latence/pin : aucune mesure ⇒ la clé meurt avec l'absence d'indicateur, loi du repo) |
| room.error.deviceLost | B supprimée | restant : connecting/full/pin/error/leave sans surface — soit déjà couvert par les clés vivantes, soit sans donnée mesurée (qualité/latence/pin : aucune mesure ⇒ la clé meurt avec l'absence d'indicateur, loi du repo) |
| room.error.deviceLostBody | B supprimée | restant : connecting/full/pin/error/leave sans surface — soit déjà couvert par les clés vivantes, soit sans donnée mesurée (qualité/latence/pin : aucune mesure ⇒ la clé meurt avec l'absence d'indicateur, loi du repo) |
| room.full.body | B supprimée | restant : connecting/full/pin/error/leave sans surface — soit déjà couvert par les clés vivantes, soit sans donnée mesurée (qualité/latence/pin : aucune mesure ⇒ la clé meurt avec l'absence d'indicateur, loi du repo) |
| room.full.title | B supprimée | restant : connecting/full/pin/error/leave sans surface — soit déjà couvert par les clés vivantes, soit sans donnée mesurée (qualité/latence/pin : aucune mesure ⇒ la clé meurt avec l'absence d'indicateur, loi du repo) |
| room.header.latency | B supprimée | restant : connecting/full/pin/error/leave sans surface — soit déjà couvert par les clés vivantes, soit sans donnée mesurée (qualité/latence/pin : aucune mesure ⇒ la clé meurt avec l'absence d'indicateur, loi du repo) |
| room.header.peers | B supprimée | restant : connecting/full/pin/error/leave sans surface — soit déjà couvert par les clés vivantes, soit sans donnée mesurée (qualité/latence/pin : aucune mesure ⇒ la clé meurt avec l'absence d'indicateur, loi du repo) |
| room.header.quality | B supprimée | restant : connecting/full/pin/error/leave sans surface — soit déjà couvert par les clés vivantes, soit sans donnée mesurée (qualité/latence/pin : aucune mesure ⇒ la clé meurt avec l'absence d'indicateur, loi du repo) |
| room.header.quality.excellent | B supprimée | restant : connecting/full/pin/error/leave sans surface — soit déjà couvert par les clés vivantes, soit sans donnée mesurée (qualité/latence/pin : aucune mesure ⇒ la clé meurt avec l'absence d'indicateur, loi du repo) |
| room.header.quality.fair | B supprimée | restant : connecting/full/pin/error/leave sans surface — soit déjà couvert par les clés vivantes, soit sans donnée mesurée (qualité/latence/pin : aucune mesure ⇒ la clé meurt avec l'absence d'indicateur, loi du repo) |
| room.header.quality.poor | B supprimée | restant : connecting/full/pin/error/leave sans surface — soit déjà couvert par les clés vivantes, soit sans donnée mesurée (qualité/latence/pin : aucune mesure ⇒ la clé meurt avec l'absence d'indicateur, loi du repo) |
| room.pin.off | B supprimée | restant : connecting/full/pin/error/leave sans surface — soit déjà couvert par les clés vivantes, soit sans donnée mesurée (qualité/latence/pin : aucune mesure ⇒ la clé meurt avec l'absence d'indicateur, loi du repo) |
| room.pin.on | B supprimée | restant : connecting/full/pin/error/leave sans surface — soit déjà couvert par les clés vivantes, soit sans donnée mesurée (qualité/latence/pin : aucune mesure ⇒ la clé meurt avec l'absence d'indicateur, loi du repo) |
| room.row.gone | B supprimée | compteurs « vus »/« +N » sans liste longue mesurée (le lobby liste tous les salons découverts, pas de pagination) ; gone sans événement de disparition rendu |
| room.row.peopleMore | B supprimée | compteurs « vus »/« +N » sans liste longue mesurée (le lobby liste tous les salons découverts, pas de pagination) ; gone sans événement de disparition rendu |
| settings.about.license | B supprimée | onglet À propos : SPEC-002-ui.md ne le prévoit pas (S3 énumère les sections, aucune section À propos) ⇒ pas d'écran réaliste |
| settings.about.nocloud | B supprimée | onglet À propos : SPEC-002-ui.md ne le prévoit pas (S3 énumère les sections, aucune section À propos) ⇒ pas d'écran réaliste |
| settings.about.version | B supprimée | onglet À propos : SPEC-002-ui.md ne le prévoit pas (S3 énumère les sections, aucune section À propos) ⇒ pas d'écran réaliste |
| settings.audio.aecActive | B supprimée | aucune donnée moteur mesurable côté renderer (voice.ts/intéracts interdits) ou redondant avec le sélecteur déjà libellé |
| settings.audio.aecInactive | B supprimée | aucune donnée moteur mesurable côté renderer (voice.ts/intéracts interdits) ou redondant avec le sélecteur déjà libellé |
| settings.audio.aecUnavailable | B supprimée | aucune donnée moteur mesurable côté renderer (voice.ts/intéracts interdits) ou redondant avec le sélecteur déjà libellé |
| settings.audio.permissionBody | B supprimée | aucune donnée moteur mesurable côté renderer (voice.ts/intéracts interdits) ou redondant avec le sélecteur déjà libellé |
| settings.audio.permissionTitle | B supprimée | aucune donnée moteur mesurable côté renderer (voice.ts/intéracts interdits) ou redondant avec le sélecteur déjà libellé |
| settings.audio.rnnoiseUnavailable | B supprimée | aucune donnée moteur mesurable côté renderer (voice.ts/intéracts interdits) ou redondant avec le sélecteur déjà libellé |
| settings.audio.testDone | B supprimée | aucune donnée moteur mesurable côté renderer (voice.ts/intéracts interdits) ou redondant avec le sélecteur déjà libellé |
| settings.audio.testing | B supprimée | aucune donnée moteur mesurable côté renderer (voice.ts/intéracts interdits) ou redondant avec le sélecteur déjà libellé |
| settings.error.save | B supprimée | toast d'échec de sauvegarde : le main persiste en silence et ne renvoie pas de code d'échec au renderer (contrat interdit) ⇒ rien à afficher honnêtement |
| settings.network.external | B supprimée | external : exposer une IP externe demanderait une requête hors-LAN (non prévue, et src/main interdit) |
| settings.overlay.preview | B supprimée | échelles/aperçu/écran manquant : l'overlay est une fenêtre native pilotée par le main (interdit) ; position+help câblés, le reste sans surface réelle |
| settings.overlay.scale.lg | B supprimée | échelles/aperçu/écran manquant : l'overlay est une fenêtre native pilotée par le main (interdit) ; position+help câblés, le reste sans surface réelle |
| settings.overlay.scale.md | B supprimée | échelles/aperçu/écran manquant : l'overlay est une fenêtre native pilotée par le main (interdit) ; position+help câblés, le reste sans surface réelle |
| settings.overlay.scale.sm | B supprimée | échelles/aperçu/écran manquant : l'overlay est une fenêtre native pilotée par le main (interdit) ; position+help câblés, le reste sans surface réelle |
| settings.overlay.screenMissing | B supprimée | échelles/aperçu/écran manquant : l'overlay est une fenêtre native pilotée par le main (interdit) ; position+help câblés, le reste sans surface réelle |
| settings.ptt.active | B supprimée | « actif » : rien côté renderer ne prouve qu'un raccourci global est enregistré ⇒ « Inactif » (preuve de refus) est rendu, l'étiquette optimiste est supprimée |
| settings.tab.about | B supprimée | sans section À propos, l'onglet n'a pas d'écran |
| settings.vad.calibrateFailed | B supprimée | calibrage/bruit de fond/live level : aucune API de mesure accessible sans toucher src/engine ni voice.ts (fichiers interdits) — pas de mesure ⇒ pas d'écran ⇒ la clé meurt |
| settings.vad.calibrated | B supprimée | calibrage/bruit de fond/live level : aucune API de mesure accessible sans toucher src/engine ni voice.ts (fichiers interdits) — pas de mesure ⇒ pas d'écran ⇒ la clé meurt |
| settings.vad.calibrating | B supprimée | calibrage/bruit de fond/live level : aucune API de mesure accessible sans toucher src/engine ni voice.ts (fichiers interdits) — pas de mesure ⇒ pas d'écran ⇒ la clé meurt |
| settings.vad.helpTooLow | B supprimée | calibrage/bruit de fond/live level : aucune API de mesure accessible sans toucher src/engine ni voice.ts (fichiers interdits) — pas de mesure ⇒ pas d'écran ⇒ la clé meurt |
| settings.vad.hysteresis | B supprimée | calibrage/bruit de fond/live level : aucune API de mesure accessible sans toucher src/engine ni voice.ts (fichiers interdits) — pas de mesure ⇒ pas d'écran ⇒ la clé meurt |
| settings.vad.liveLevel | B supprimée | calibrage/bruit de fond/live level : aucune API de mesure accessible sans toucher src/engine ni voice.ts (fichiers interdits) — pas de mesure ⇒ pas d'écran ⇒ la clé meurt |
| settings.vad.noiseFloor | B supprimée | calibrage/bruit de fond/live level : aucune API de mesure accessible sans toucher src/engine ni voice.ts (fichiers interdits) — pas de mesure ⇒ pas d'écran ⇒ la clé meurt |
| settings.vad.noiseMeasuring | B supprimée | calibrage/bruit de fond/live level : aucune API de mesure accessible sans toucher src/engine ni voice.ts (fichiers interdits) — pas de mesure ⇒ pas d'écran ⇒ la clé meurt |
| voice.remote.absent | B supprimée | « sans voix » : l'indicateur d'activité vocale existe déjà via les clés vivantes voice.* |

## (A) Câblées sur des écrans réels (16)

| Clé | Verdict | Où |
|---|---|---|
| common.off | A câblée | Settings.tsx (ligne Decouverte inactive, hors-ligne mesure) |
| common.on | A câblée | Settings.tsx (ligne Decouverte active) |
| room.create.capacity | A câblée | App.tsx (places : plafond du maillage) |
| room.create.nameHelp | A câblée | App.tsx (aide du champ nom de salon) |
| room.leave.toast | A câblée | App.tsx (toast region live au depart du salon) |
| room.row.fullAria | A câblée | App.tsx (aria-label du bouton Complet) |
| room.row.joinAria | A câblée | App.tsx (aria-label du bouton Rejoindre) |
| settings.audio.inputNone | A câblée | Settings.tsx (S3.2, option micro sans nom) |
| settings.audio.mode | A câblée | Settings.tsx (S3.1, libelle du segmented PTT/VAD) |
| settings.audio.outputNone | A câblée | Settings.tsx (S3.3, option sortie sans nom) |
| settings.network.discovery | A câblée | Settings.tsx (S3.15, etat mesure de la sante decouverte) |
| settings.network.name | A câblée | Settings.tsx (S3.15, lecture seule du pseudo, meme source que E1) |
| settings.overlay.help | A câblée | Settings.tsx (S3.12, aide permanente de la section Overlay) |
| settings.overlay.position | A câblée | Settings.tsx (S3.12, champ Position au-dessus de [Recentrer]) |
| settings.ptt.inactive | A câblée | Settings.tsx (S3.7, etat mesure du raccourci via onShortcutConflict) |
| settings.ptt.recorded | A câblée | Settings.tsx (S3.6, annonce aria-live de la sequence capturee) |

## Faux positif de l'audit (1)

| Clé | Verdict | Motif |
|---|---|---|
| app.nickname.error.empty | conservée | construite par `nicknameErrorKey('empty')` (src/shell/nickname.ts), rendue par IdentityRow, assertée par tests/identity-row.node.test.ts — l'audit ne voyait pas la construction dynamique ; liste d'exceptions nommée dans le garde |
