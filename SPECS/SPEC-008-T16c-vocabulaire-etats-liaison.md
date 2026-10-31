# T16c — vocabulaire des états de liaison (FR/EN)

Maquette · 2026-10-31 · conception, sans code · réf. **SPEC-007 §4.3** (état par pair visible, mot « muet » quand aucun flux, jamais d'anneau sur du vide) et **§7** (si mDNS échoue, l'écran doit le dire) · 9 états, 29 clés `room.peer.*`.

**Échelle à 5 paliers, un seul affiché à la fois** (`connecting` → `connected` → `speaking` → `noFlow` → `failed`). `connected` = lien établi **et** flux reçu il y a **< 5 s** ; `noFlow` commence exactement à 5 s sans flux. C'est le seul horodatage de la fiche.

**Règles ARIA valables pour tout l'écran.** Deux régions vivantes en tout : une `aria-live="polite"`, une `assertive`. **Aucune ligne de pair ne porte `aria-live`** (sinon N annonces par changement). `role="alert"` **seulement** si la ligne contient une action ; information seule ⇒ `polite`, ou rien.

## 1. Décisions par état

Abréviations : **P** = pastille d'avatar (`avatarTint.*`, initiale `text.primary`) ; **anneau** = 2 px autour de P, transition 80 ms ; **halo** = `state.speaking` 2 px ; **badge** = 12 px sous le nom.

| # | État (source) | (a) ce que l'écran montre | (b) mot FR | (b) mot EN | (c) cliquable / non cliquable | (d) lecteur d'écran |
|---|---|---|---|---|---|---|
| **1** | pair qui se connecte (`link.state = connecting`) | P 100 %, **arc pointillé 2 px `text.muted`** tournant 1 tr/s **au plus 10 s** puis figé ; badge `text.muted`. Ni halo, ni point vert, ni nom grisé | Connexion… | Connecting… | ligne **non focusable** ; volume et « Couper … pour moi » `aria-disabled` ; pas de menu contextuel | ligne `aria-busy="true"` ; **une seule** annonce `polite` à 10 s (`a11y.connectingLong`), pas à l'ouverture ; `alert` non |
| **2** | connecté, parle (flux + niveau > seuil) | P 100 %, **halo** `state.speaking`, badge `state.speaking`. Aucun anneau animé | Parle | Speaking | ligne focusable (flèches = volume) ; volume actif ; « Couper … pour moi » actif | `aria-label="{{nom}}, parle"` **lu au focus seulement** ; aucune annonce par syllabe |
| **3** | connecté, **aucun flux ≥ 5 s** | P 100 %, **aucun halo, aucun anneau** ; badge `state.warn` avec compteur qui monte. Jamais de point vert | Aucun flux depuis {{s}} s | No audio for {{s}} s | volume actif (mémorisé pour la reprise) ; « Couper … pour moi » actif ; **pas** de « Réessayer » (le lien est vivant) | `polite` **une fois** à 5 s (`a11y.noFlow`), pas à chaque seconde ; `alert` non |
| **4** | micro coupé (vous) | P **60 % dans la liste seulement** ; anneau `state.mute` ; badge `state.mute`. Variante PTT relâché : badge avec le raccourci. Overlay : texte **jamais** atténué (R2 : seule la plaque se délave à 60 %, halos et texte restent opaques) | Micro coupé / Micro coupé — maintenez {{shortcut}} | Mic off / Mic off — hold {{shortcut}} | badge = bouton bascule **dans le salon** ; overlay traversant, rien n'y est cliquable | `polite` (écho d'action) ; `alert` **seulement** si l'appui PTT a été refusé (`a11y.pttIgnored`, existant) |
| **5** | pair en échec (`failed`) + cause réelle | P 100 %, anneau `state.mute` ; badge « Échec de la liaison » + **2ᵉ ligne 12 px `text.secondary` = cause mesurée** (`cause.*`). Jamais « une erreur est survenue » | Échec de la liaison | Link failed | **Réessayer** et **Copier le diagnostic** actifs ; volume et « Couper pour moi » **non** | `role="alert"` sur la 2ᵉ ligne (actionnable) : `a11y.failed` ; le code brut de `detail` n'est jamais lu à voix haute |
| **6** | pair parti | sortie 200 ms (opacité 60 %→0) puis **retrait** ; toast 5 s ; **aucune stèle grisée** qui reste | {{nom}} a quitté le salon. | {{nom}} left the room. | rien à cliquer (ligne absente) ; toast non cliquable | `polite` (`a11y.left`, existant) ; `alert` non |
| **7** | salon plein (9ᵉ) | **aucun 9ᵉ avatar, pas même en « Connexion… »** ; côté hôte une ligne `state.warn` **sans pastille** ; côté refusé : dialogue avec corps + une action. Pas de « Réessayer » : réessayer pendant que c'est plein est un mensonge d'action | Salon plein | Room full | une seule action : **Revenir aux salons** ; « Créer un salon » reste actif | `role="alert"` (actionnable) : `a11y.full`, une fois |
| **8** | lien de signalisation refusé (`refused`) | bandeau 2 px `state.mute` en tête de salon + cause ; côté pair : P + anneau `state.mute`, badge. 3 tentatives (1 s / 2 s / 4 s) puis **état figé** — jamais de spinner qui persiste | Signalisation refusée | Signaling refused | **Réessayer** (relance les 3 tentatives), **Copier le diagnostic** ; le port ne se change pas ici (Réglages ▸ Réseau) | `role="alert"` + `assertive`, **une fois par salve** de tentatives (`a11y.refused`) |
| **9** | découverte mDNS en échec | aucun modal, aucun blocage ; bandeau 1 ligne `state.warn` ; si **tout** est tombé, titre + **Réessayer** (`discovery.error.alldown`, existant). Dans le salon : simple puce `discovery.method.broadcast` | mDNS indisponible — recherche par broadcast | mDNS unavailable — searching by broadcast | bandeau **non** cliquable ; « Réessayer » seulement dans le cas « tout tombé » ; rejoindre/créer restent actifs | mDNS seul : `polite`, pas d'`alert` ; tout tombé : `role="alert"` (`a11y.mdnsDown`) |

**Overlay** : mêmes mots, sans les badges longs de 5 et 8 (remplacés par l'anneau `state.mute` + infobulle au survol) ; P 28 px, halo 2 px, 80 ms ; **aucun clic volé** (fenêtre `ignoreMouseEvents`, traversante) ; lisible à 100 % comme à 60 % parce que **seule la plaque** est atténuée.

## 2. Clés i18n prêtes à recopier (`design/i18n/fr.json` puis `en.json`, même ordre)

| clé | FR | EN |
|---|---|---|
| `room.peer.state.connecting` | Connexion… | Connecting… |
| `room.peer.state.connectingLong` | Connexion… ({{s}} s) | Connecting… ({{s}} s) |
| `room.peer.state.speaking` | Parle | Speaking |
| `room.peer.state.connected` | Connecté | Connected |
| `room.peer.state.noFlow` | Aucun flux depuis {{s}} s | No audio for {{s}} s |
| `room.peer.state.selfMuted` | Micro coupé | Mic off |
| `room.peer.state.selfPttUp` | Micro coupé — maintenez {{shortcut}} | Mic off — hold {{shortcut}} |
| `room.peer.state.failed` | Échec de la liaison | Link failed |
| `room.peer.state.left` | {{name}} a quitté le salon. | {{name}} left the room. |
| `room.peer.state.full` | Salon plein | Room full |
| `room.peer.state.refused` | Signalisation refusée | Signaling refused |
| `room.peer.state.mdnsDown` | mDNS indisponible — recherche par broadcast | mDNS unavailable — searching by broadcast |
| `room.peer.cause.ice` | Aucune route réseau entre les deux machines ({{code}}). | No network route between the two machines ({{code}}). |
| `room.peer.cause.refused` | {{host}} refuse la connexion sur le port {{port}}. | {{host}} refused the connection on port {{port}}. |
| `room.peer.cause.timeout` | Aucune réponse après {{s}} s. | No answer after {{s}} s. |
| `room.peer.cause.sink` | Le flux arrive, mais aucun haut-parleur n’est ouvert pour {{name}}. | Audio arrives, but no speaker is open for {{name}}. |
| `room.peer.cause.full` | 8 participants déjà connectés : ce pair n’a pas été admis. | 8 participants already connected: this peer was not admitted. |
| `room.peer.cause.malformed` | Message de signalisation rejeté : format ou taille (64 ko maximum). | Signaling message rejected: format or size (64 kB max). |
| `room.peer.cause.unknown` | Cause inconnue — copiez le diagnostic. | Unknown cause — copy the diagnostic. |
| `room.peer.action.retry` | Réessayer | Retry |
| `room.peer.action.copy` | Copier le diagnostic | Copy diagnostic |
| `room.peer.action.back` | Revenir aux salons | Back to rooms |
| `room.peer.full.hostNotice` | 9ᵉ pair refusé — salon plein | 9th peer refused — room full |
| `room.peer.a11y.connectingLong` | Connexion à {{name}} toujours en cours. | Still connecting to {{name}}. |
| `room.peer.a11y.noFlow` | {{name}} est connecté mais n’envoie aucun flux. | {{name}} is connected but sending no audio. |
| `room.peer.a11y.failed` | Échec de la liaison avec {{name}}. {{cause}} | Link failed with {{name}}. {{cause}} |
| `room.peer.a11y.refused` | Signalisation refusée par {{host}}. {{cause}} | Signaling refused by {{host}}. {{cause}} |
| `room.peer.a11y.full` | Vous n’avez pas été connecté : le salon est complet. | You were not connected: the room is full. |
| `room.peer.a11y.mdnsDown` | Découverte mDNS indisponible. Recherche par broadcast. | mDNS discovery unavailable. Searching by broadcast. |

`room.peer.action.retry`, `.copy` et `.back` sont des libellés **visibles de bouton** : à ajouter à `BUTTON_KEYS` dans `design/check-i18n.mjs` (9, 20 et 18 caractères, plafond 20 tenu). **Remplace** : `participant.connecting`, `participant.iceFailed`, `participant.iceFailedAction`, `participant.left`, `overlay.muted`. **Supprime** : `room.header.quality.*` et `participant.iceRetrying` (cf. ci-dessous).

## 3. Règle de non-mensonge — ce qu'on n'affiche pas

| jamais | à la place |
|---|---|
| « Connecté » sans lien prouvé, ni « Parle » sans flux prouvé | `Connecté` exige `link.state = connected` **et** un flux < 5 s ; `Parle` exige un **niveau mesuré par pair** (`getStats`), jamais le VAD local, jamais un minuteur |
| « Muet » pour un pair qui n'envoie rien | `Aucun flux depuis {{s}} s` — constatable. La signalisation ne transporte pas l'état de micro distant (§4.1), donc on ne peut pas savoir s'il est muet |
| un pourcentage, des barres, « Qualité excellente » sans mesure | faits mesurés seulement : `room.header.latency` si le RTT existe, sinon **rien**. `room.header.quality.*` est supprimé |
| un anneau qui tourne sans opération en cours ni échéance ; un spinner après `failed` / `refused` / `full` | rotation plafonnée à 10 s, puis état **figé et daté** ; après un refus, un état, pas une animation |
| une cause inventée ou un code brut traduit en cause plausible | `cause.unknown` + **Copier le diagnostic** (le code brut ne sort que dans le diagnostic) |
| une valeur inconnue écrite « — » ou « 0 % » | l'inconnu est **absent** : une absence ne se lit pas comme une mesure |
| « son OK » alors qu'aucun `<audio>` n'existe pour ce pair | `cause.sink` (DÉFAUT-C de SPEC-007) : un flux reçu sans haut-parleur est une panne, pas un état sain |

## 4. Ce que la spec ne dit pas encore

1. `SignalIn` (§4.1) n'a **aucun message d'état de micro distant** : impossible d'afficher « muet » pour un pair. Il manque `{ kind: 'mute'; peerId; muted; mode: 'ptt' | 'vad' }`.
2. Aucun **seuil de parole distante** n'est fixé : le VAD de SPEC-002 est local. Il faut une mesure par pair et son seuil, sinon « Parle » reste indécidable.
3. `link.state` n'a ni `retrying` ni `degraded` (d'où la suppression de `participant.iceRetrying`), et `detail` n'a pas d'énumération : sans elle, `cause.*` se mappe sur du texte libre.
