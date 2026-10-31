# SPEC-013 — État « inconnu » : maquette, lisibilité et anti-faux-silence (T21)

Maquette · 2026-10-31 · conception, sans code · réf. **SPEC-001** (halo 2 px / 80 ms),
**SPEC-008** (échelle des états de liaison), **SPEC-010** (libellés de pair), **SPEC-011** (tri-état
`data-speaking`), **SPEC-012** (clôture T19), **T19/T20** (application §4/§7 par desk-shell), **AD-17 D3/D4/D6**.

**Demande traitée.** desk-shell (message T20) : le libellé « parle » n'apparaît plus que si
`data-speaking` vaut exactement `'true'` ; un pair non mesuré porte `data-speaking="unknown"` ; le CSS
ne réagit qu'à `'true'` ; dans l'overlay le badge « Micro coupé » est réservé à soi-même. Conséquence
annoncée : tant qu'AD-17 D3/D4 n'est pas livré, **aucun pair n'a de halo nulle part**. Demande
explicite : « si tu as une maquette d'état *inconnu*, c'est le moment ».

Livrée avec : **`SPEC-013-planche-etat-inconnu.html`** (planche de contrôle, valeurs recopiées de
`tokens.json` et de `styles.css`, à ouvrir dans un navigateur).

---

## 1. Ce que le code fait réellement (mesuré, pas supposé)

| Point | Fichier:ligne | Constat |
|---|---|---|
| Attribut tri-état, liste « Pairs distants » | `Room.tsx:141` | `data-speaking={peerSpeaking(...)}` → `'true' \| 'false' \| 'unknown'` |
| … mais **aucun halo** dans cette liste | `Room.tsx:135-158` | pas de `.participant__halo` : cette liste ne peut jamais s'allumer, quel que soit l'état |
| Attribut tri-état, liste des participants | `Room.tsx:175` | idem, sur les lignes qui portent le halo |
| Halo toujours présent, transparent | `Room.tsx:182`, `styles.css:352-360` | `border: 2px solid transparent`, `position:absolute` ⇒ **aucun décalage de mise en page** quand l'état change |
| Libellé « parle » | `Room.tsx:191` | `speaks === 'true' ? t('participant.speaking') : null` — donc `'unknown'` et `'false'` rendent **la même chose** |
| CSS | `styles.css:362`, `styles.css:589` | seuls sélecteurs sensibles à la parole : `[data-speaking='true']` |
| Soi-même, toujours mesuré | `Room.tsx:71-72`, `288-290` | `selfSpeaking` / `micLevel` viennent du plan média **local** ; le vumètre du micro est vivant même si tous les pairs sont `unknown` |
| Overlay, halo | `Overlay.tsx:83-87` | halo présent, `data-speaking` tri-état, mais la fenêtre n'a **aucune mesure** ⇒ toujours `'unknown'` |
| Overlay, badge muet | `Overlay.tsx:78, 91, 95` | `flagsKnown = selfFlagKnown(...) && participant.muted` : réservé à soi, conforme au message de desk-shell |
| Péremption | `participant-state.ts:31, 65-70` | `SPEAKING_STALE_MS = 250` ; âge invalide ou > 250 ms ⇒ `'unknown'` |
| Opacité de la fenêtre overlay | `overlay-controller.ts:149` | `setOpacity(settings.opacity)` — 60 % veut dire **toute la fenêtre composée sur le papier peint** |

**Conclusion de lecture.** L'état inconnu n'est pas un cas de bord : c'est l'état **nominal actuel de
tous les pairs, dans les deux surfaces**. Il n'est donc pas traité comme un « chargement » (il ne se
résoudra pas), et c'est là que se joue le seul vrai risque d'ergonomie : un salon où rien ne
s'allume se lit « application cassée » aussi facilement que « personne ne parle ».

---

## 2. Règles normatives de l'état inconnu

**R-U1 — Identité de rendu.** `'unknown'` et `'false'` produisent un rendu **indiscernable** : même
classe, même bordure transparente, même libellé (absent), **0 px** d'écart de géométrie. L'écart entre
les deux n'existe que dans l'attribut DOM, jamais à l'écran. Corollaire : le halo doit rester monté
en permanence (c'est déjà le cas), sinon l'arrivée d'un échantillon provoquerait un saut de mise en
page — interdit.

**R-U2 — Aucun texte ajouté.** Pas de « non mesuré », pas de « … », pas d'infobulle, pas de
`title`, pas de squelette. Raison **mesurée** : tout texte secondaire (`text.muted`) tombe à
**2,78:1** à 60 % d'opacité sur fond clair, sous le seuil de 4,5:1 (§4). Un libellé d'incertitude
serait donc illisible précisément là où l'overlay en aurait besoin, et bavard partout ailleurs.

**R-U3 — Pas de grisé.** L'inconnu ne baisse ni l'opacité de l'avatar, ni celle du nom, n'applique
aucun `filter: grayscale`. Le grisé est déjà un sens pris (indisponible / désactivé) ; le réutiliser
ferait lire « ce pair est hors ligne ».

**R-U4 — Aucune animation.** Rien qui tourne, pulse ou clignote dans une ligne `unknown`. Le
mouvement promet une résolution ; ici il n'y en a aucune (pas de producteur). Les seules animations
autorisées dans la ligne restent la transition de 80 ms du halo et le vumètre **local**.

**R-U5 — La parole ne dit jamais l'absence.** Le seul texte qu'une ligne de pair puisse porter sur le
son est un état de **liaison** (`voice.peer.pending` « Audio en attente… », `voice.peer.connecting`,
`voice.peer.noFlow`, `voice.peer.failed`, `participant.iceRetrying`, `participant.iceFailed`) ou, pour
soi, un état de **micro** (`participant.muted` « Muet », `participant.deafened`). Un pair muet sans
sample ne doit **jamais** afficher « Muet » : `muted: false` signifie « non renseigné » (règle
desk-shell, conservée).

**R-U6 — Le « salon mort » se corrige ailleurs que dans la ligne.** La contre-impression est portée
par deux éléments déjà présents et qui ne doivent jamais dépendre des pairs : (a) le **vumètre du
micro local** (`Room.tsx:288-290`), vivant dès que `voice.status === 'live'` ; (b) la **bannière de
liaison** en tête de salon. Si un jour le vumètre local est gaté par des données de pairs, l'écran
entier devient muet et la règle est violée.

**R-U7 — Accessibilité : ne rien inventer.** `data-speaking="unknown"` n'expose aucune information
d'accessibilité. Le texte `visually-hidden` de l'overlay (`Overlay.tsx:93-96`) contient le nom seul,
**sans** « silencieux » ni « non mesuré ». Quand le relais arrivera, `overlay.speaking` (« En train de
parler » / « Speaking ») s'y ajoutera — la clé existe déjà, inutilisée à ce jour.

**R-U8 — Attaque immédiate, relâchement tenu (exigence pour le producteur AD-17 D3/D4).**
Le halo doit s'allumer sur la première image d'un échantillon parlant (0 ms d'attaque) et **ne pas
s'éteindre sur une pause naturelle**. Or `SPEAKING_STALE_MS = 250` transforme en `unknown` tout
silence de 250 ms : avec un producteur qui n'émet qu'aux changements, les pauses inter-mots
(50–200 ms) et inter-phrases (300–800 ms) feraient **clignoter** le halo à chaque respiration — un
défaut visuel que la transition de 80 ms ne corrige pas, elle ne fait que l'adoucir.
Exigence de conception, à l'attention de desk-engine : le producteur émet au moins **5 Hz** pendant la
parole (heartbeat < 250 ms) **et** calcule lui-même une tenue de relâchement d'environ **600 ms**
(`speakingUntil`), de sorte que la péremption de 250 ms du renderer ne s'applique jamais en plein
milieu d'une phrase. Côté maquette : attaque 0 ms, tenue 600 ms, extinction ensuite par la transition
de 80 ms — au total ≈ 680 ms entre la dernière syllabe et le halo éteint.

---

## 3. Maquette — les six états, surface par surface

Valeurs visuelles de référence : avatar 28 px en salon / 34 px + anneau en overlay, halo 2 px,
transition 80 ms, `state.speaking` `#3DDC84`, `state.mute` `#FF6B6B`, `text.primary` `#F1F4F8`,
`text.muted` `#8B97A5`, `border.subtle` `#2A323D`.

| # | État | Salon — ce qui est dessiné | Overlay — ce qui est dessiné | Ce que l'utilisateur doit pouvoir conclure | Ce qui doit **not** apparaître |
|---|---|---|---|---|---|
| E1 | soi, micro ouvert, silencieux | avatar + nom + « (Vous) », vumètre à 0 | avatar + initiales | « je suis connecté, je ne parle pas » | halo, texte de pair |
| E2 | soi, en train de parler | halo vert + « parle », vumètre qui bouge | halo vert | « on m'entend » | libellé de pair, badge muet |
| E3 | soi, muet | avatar teinté `state.mute` + « Muet » | initiales rouges + pastille rouge | « mon micro est fermé » | halo |
| E4 | pair, silence **mesuré** (`false`) | avatar + nom, aucun libellé de parole | anneau subtil, aucun halo | rien à conclure — état normal | « silencieux », grisé, point d'attente |
| E5 | pair, **inconnu** (`unknown`) — l'état d'aujourd'hui | **rendu identique à E4** ; seul le texte de liaison peut apparaître (« Audio en attente… », « Audio échoué ») | **rendu identique à E4** | « rien n'est mesuré ; l'audio, lui, est en attente » | tout ajout : texte, icône, opacité, animation (R-U2..R-U4) |
| E6 | pair, parlant (cible D3/D4) | halo vert + « parle » | halo vert (+ « En train de parler » en a11y) | « il parle » | badge « Muet » (réservé à soi) |

**Le seul écart autorisé entre E4 et E5 est hors de la ligne de parole** : c'est le texte de liaison
(R-U5), et il parle du flux audio, jamais du silence.

**Planche de contrôle** — `SPEC-013-planche-etat-inconnu.html` : lignes de salon `false` / `unknown` /
`true` / soi muet / liaison instable, puis overlay à 100 % et à 60 % sur fond sombre **et** clair.
Superposer E4 et E5 dans un même écran est volontaire : si l'œil trouve une différence, la règle est
violée.

---

## 4. Lisibilité mesurée à 60 % d'opacité (composite sur papier peint)

Méthode : composition alpha de chaque couleur sur le papier peint, contraste WCAG 2.1 sur le résultat
(sombre `#000000`, gris 50 %, clair `#FFFFFF`, bleu clair `#A8C0FF`).

| Élément | α = 100 % | α = 60 % / blanc | / gris 50 % | / noir | Seuil |
|---|---|---|---|---|---|
| Initiales sur avatar (`text.primary` sur `bg.inset`) | 17,85 | **4,91** | 6,65 | 6,51 | 4,5:1 ✔ |
| Nom + état (`text.muted` sur `bg.overlay`) | 6,51 | **2,78** ✘ | 3,35 ✘ | 2,89 ✘ | 4,5:1 |
| Halo de parole (`state.speaking`) | 10,83 | **3,52** | 4,52 | 4,28 | 3:1 ✔ |
| Pastille muette (`state.mute`, aplat) | 6,97 | 2,73 | 3,33 | 3,02 | 3:1 (aplat, toléré) |

Trois conséquences :
1. **L'état inconnu est l'état le mieux préservé à 60 %** : il ne repose que sur des initiales à
   4,91:1 dans le pire cas. Aucun jeton à changer, aucune exception à créer.
2. **Aucun texte d'auxiliaire n'est possible** à 60 % (2,78:1) : c'est la justification chiffrée de
   R-U2, pas une préférence.
3. **Le halo reste perceptible** (≥ 3,52:1) donc le rendu cible E6 tient à 60 %, sans épaissir le
   halo ni changer `state.speaking`. À surveiller côté QA : la pastille muette à 2,73:1 sur fond
   clair est le point le plus faible de l'overlay ; elle reste une **forme pleine** (8 px, liseré
   sombre `bg.overlay`) donc perceptible, mais c'est le premier candidat si un défaut de lisibilité
   est signalé.

---

## 5. Position sur l'overlay (recommandation, arbitrage à desk-lead)

Avec `unknown` partout, l'overlay ne remplit plus sa fonction : sa raison d'être est de montrer qui
parle, et il n'a **aucune** mesure — pas même de soi, alors que la source existe (le plan média de la
fenêtre principale connaît `voice.level`). Je recommande deux étages, dans cet ordre :

- **P1 — relayer l'état de soi.** Producteur certain, aucune question de mesure distante : la fenêtre
  principale publie `selfSpeakingAttr(...)`, l'overlay le consomme. L'overlay cesse d'être
  décoratif, et son halo se valide de bout en bout.
- **P2 — relayer les pairs.** Même canal, table `PEER_LEVELS` recopiée par IPC ; l'overlay ne mesure
  toujours rien lui-même, il affiche un état mesuré ailleurs — ce qui reste honnête.

Tant que P1 n'est pas là : **ne rien maquiller** pour faire vivant (R-U2..R-U4). Un overlay dont les
halos sont éteints est conforme ; un overlay dont les halos s'allument au hasard serait un mensonge.
En revanche il ne faut pas le présenter comme « qui parle » : c'est un afficheur de présence tant que
le relais n'existe pas.

---

## 6. Critères d'acceptation (vérifiables sans nouveau code)

- **AC-U1 — Identité DOM/CSS.** Pour un pair sans échantillon et pour un pair à `data-speaking="false"`,
  `getComputedStyle` de `.participant__halo` (salon) et `.overlay__halo` (overlay) renvoient des
  valeurs identiques, `border-color` comprise (transparent des deux côtés).
- **AC-U2 — Aucun texte de parole.** Le `textContent` de la ligne `unknown` ne contient ni
  `participant.speaking` ni `overlay.speaking` (FR « parle » / EN « speaking ») et est **égal** à celui
  de la ligne `false`.
- **AC-U3 — Pas de grisé.** `opacity` de l'avatar et du nom = 1, `filter` = `none` pour `unknown`.
- **AC-U4 — Aucune animation.** `element.getAnimations()` sur la ligne `unknown` = 0 (hors vumètre
  local, hors ligne de soi).
- **AC-U5 — Le lien reste dit.** Un pair `unknown` dont `state ≠ connected` affiche **son** texte de
  liaison (`voice.peer.*`, `participant.ice*`) dans `.participant__state`.
- **AC-U6 — Muet réservé à soi.** Aucune ligne de pair, dans aucune des deux surfaces, n'affiche
  `participant.muted` / `overlay.muted`, ni `data-muted="true"`.
- **AC-U7 — A11y.** Le texte `visually-hidden` d'un avatar overlay `unknown` = le nom seul.
- **AC-U8 — Pas de saut.** Hauteur de ligne et position du nom identiques à ±0 px entre `false`,
  `unknown` et `true`.
- **AC-U9 — Diff de pixels.** Capture de la même ligne en `unknown` et en `false` : différence nulle,
  à 100 % **et** à 60 % d'opacité de fenêtre.
- **AC-U10 — Attaque/relâchement (quand D3/D4 arrive).** Un échantillon parlant fait apparaître le
  halo sur l'image suivante ; le halo reste allumé pendant une pause de 400 ms puis s'éteint ; une
  rafale d'échantillons à 10 Hz ne produit aucun clignotement.

---

## 7. Ce que je ne tranche pas

| Sujet | Qui tranche | Ma position |
|---|---|---|
| Indicateur global « parole non mesurée » en tête de salon | desk-lead | Contre : bruit permanent aujourd'hui, nouvelle clé i18n, et aucun bénéfice une fois D3/D4 livré. La bannière de liaison suffit. |
| Priorité P1/P2 du relais d'état vers l'overlay | desk-lead | P1 (soi) d'abord — cf. §5. |
| Heartbeat ≥ 5 Hz et tenue `speakingUntil` ≈ 600 ms | desk-engine | Exigence de conception R-U8 ; la valeur exacte de la tenue peut vivre entre 500 et 700 ms, le seuil de 250 ms du renderer ne doit jamais expirer en pleine phrase. |
| Deux listes de pairs à l'écran, dont une sans halo (`Room.tsx:135-158` vs `160-196`) | desk-lead / desk-shell | Coût de compréhension réel — deux lignes par pair, une seule pouvant s'allumer. Hors périmètre de cette fiche, à traiter comme un point d'ergonomie distinct (T22 candidat). |
| Fusion du texte de liaison et du texte de micro sur une même ligne | desk-shell | Déjà couvert par `joinStates` ; aucun changement demandé ici. |

---

## 8. Journal

- **T21** — Message desk-shell T20 reçu et intégré sans rouvrir ses clés : `voice.peer.pending`
  (« Audio en attente… » / « Waiting for audio… ») consommée par `Room.tsx:154`, libellé « parle »
  conditionné à `'true'`, badge muet réservé à soi. Aucune clé i18n ajoutée ni renommée par cette
  fiche : les trois clés utiles (`participant.speaking`, `overlay.speaking`, `overlay.muted`) existent
  déjà, dont une (`overlay.speaking`) encore inutilisée à l'écran.
- Livré : cette fiche + `SPEC-013-planche-etat-inconnu.html`.
- **À rouvrir** quand AD-17 D3/D4 livre le producteur : AC-U10, extinction du halo (`speakingUntil`),
  et P1/P2 de l'overlay. AC-U1..AC-U9 sont vérifiables dès aujourd'hui.
