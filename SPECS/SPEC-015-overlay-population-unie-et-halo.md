# SPEC-015 — Overlay : population unie, vignette adressable, halo relayé

Maquette (desk-design) · 2026-10-31 · **étape B** (le feu T23 A reste en vol, cette page ne le modifie pas)
Répond à Régie (message d9152402) : le trou de §10 de SPEC-013b. Références : **SPEC-013b** §2–§5 et §10,
**SPEC-014 / AD-20** D1 (P1), D3, D4 et AC20-1..AC20-5, **SPEC-012 / AD-19** D1/D2, **SPEC-013 §2**
(R-U1..R-U8), AD-17 D1/D2/D3. **Aucun code, aucune clé i18n, aucun texte nouveau.**

**rév. 7 — errata (courante)** — même jour, correction **étroite** imposée par Régie, canon
`SPEC-016-AD-26-c6-2000-c1-plafond-affichage-10-c5-flag-main` §1 (C6), §2 (C1), §3 (C5). **Trois lignes, rien
d'autre.** Deux arbitrages y **ferment** ce que la page portait comme ouvert — **C6** et **C1** — et le
troisième (C5) passe de « décision produit demandée à Maquette » à un arbitrage **sous mesure datée**. Ce
n'est pas une révision de fond : le canon de **2000** est **confirmé** (AD-23 D4.2 et le §3 de cette page
sont **inchangés**), et §3, O-P, §4.2, §4.4 ne bougent pas d'un caractère.

| AD-26 | page | Endroit | Ce qui change |
|---|---|---|---|
| **§1** (C6) | **E17** | §4.1 (puce « 2500 ») + §5.2 **ACo-9** F2 + §7 **C6** | **l'étiquette seule** : « F1 vert / F2 **hors canon, arbitrage C6** » → « **F1 vert / F2 non conforme — défaut de valeur, corrigé par une constante (C6, AD-26)** ». **C6 fermé**, daté, citant AD-26 §1. Valeurs et bornes **inchangées** (2000, `t0+1999` / `t0+2001`). La **trace de la contradiction D2/D4.2 est conservée** — elle est instructive — mais elle n'est plus ouverte |
| **§2** (C1) | **E18** | §2.5 + §7 **C1** | **(a) retenu le 2026-10-31 (AD-26 §2)**, avec la **table des trois rôles** : **8** = rejoindre (`local-signaling`, inchangé) / **10** = affichage (`MAX_OVERLAY_PARTICIPANTS`, `ipc-contract.ts` 606–609 et 642, `room-bridge.ts` 83 et 167) / **10** = ensemble de locuteurs (`SPEAKING_SET_MAX` **9 → 10**, même lot). **(b)** conservé comme **refusé** : absence silencieuse (ACo-2) |
| **§3** (C5) | **E19** | §7 **C5** | **(a) `backgroundThrottling: false` arbitré sous mesure datée** : **une** ligne `main/index.ts`, sur la fenêtre qui porte la boîte aux lettres — **pas** global, **pas** l'overlay. Deux sorties écrites. **Repli (b)** à cinq conditions si la mesure échoue, point 5 canon. **ACo-15 reste gelé** — ni vert, ni rouge |

**Note de numérotation (même règle qu'à la rév. 6, dite une fois).** AD-26 nomme cette correction **E13** : il
relit la page en **rév. 5**. Depuis, la page est partie en **rév. 6**, où **E13–E16** désignent déjà le retrait
du balayage, C4 (a), le motif d'ACo-9 et ACo-16. Les trois lignes d'AD-26 portent donc ici **E17–E19**. Même
raison pour le numéro de révision : une seconde « rév. 6 » au contenu différent ferait deux documents sous une
étiquette, et desk-shell comme desk-qa tiennent des renvois datés à la rév. 6.

**Effets mécaniques — six endroits, comptés, pas « etc. » (aucune décision nouvelle)** : (i) le paragraphe de
statut après le tableau §5.2 et (ii) le point 5 de §0 doivent dire que **C1 et C6 sont tranchés** et que
**C5 n'est plus ouvert** (ACo-14/ACo-15 restent gelés, mais pour une **mesure**, plus pour une décision) ;
(iii) §9 « Cadre, moitié consommatrice » ne peut plus écrire « sauf dérogation écrite sous C6 » — la
dérogation est **refusée** (AD-26 §1) ; (iv) §9 « desk-shell » perd « C6 (2000 ou dérogation) » et gagne le
**lot C1** (10, 9 → 10, après T23) ainsi que la ligne `backgroundThrottling` **sous mesure** ; (v) §2.5 et
§7 C1 ne peuvent plus dire « tant qu'il n'est pas arbitré » ; (vi) §3.2 renvoie la question du drapeau
« mesuré » à « **C6** (ou une AD de plus) » : C6 est fermé et portait la **valeur**, pas cette question — le
renvoi ne cite plus C6.

**Non touché par cette révision** : §1 (dont §1.3), §2.1–§2.4, **§3 et §3.2** (sauf l'incise (vi)), §3.4,
**§4.2**, §4.3 (dont l'échéancier d'E13), **§4.4** (attaque **0** / extinction **680**), §5.1 (**O-P, O1–O5,
O7–O10**), §6, C2, **C3**, **C4** (tranché (a), AD-25 D4), **ACo-1..ACo-8**, **ACo-10..ACo-15** (textes
intacts, y compris leur mot « gelé »), **ACo-16**, et la page **SPEC-013b**. **Aucun AC retiré**, aucun
ajouté. **Zéro code, zéro clé i18n, zéro texte d'interface.**

**Une conséquence que je déclare sans l'appliquer** : avec un plafond d'affichage à **10**, **ACo-1** ne
couvre encore que « 1..8 participants » et **ACo-10** que « 8 puis 9 vignettes ». Le plafond change de valeur
avant que les AC qui le mesurent couvrent 9 **et** 10. Étendre ACo-1 et ACo-10 est un **changement de portée
d'AC**, donc une décision — pas un errata : cela appartient au **lot C1** (AD-26 §2, « tests de contrat »), et
je le note pour que personne ne coche ACo-1 vert sur une population de 10 sans le savoir.

**rév. 6 — errata (appliquée ; historique ci-dessous)** — même jour, correction **étroite** imposée par Régie, canon
`SPEC-016-AD-25-echeancier-obligatoire-balayage-supprime-c4-tranche` §1 D1, §2 D2, §4 D4. **Quatre lignes,
rien d'autre.** Deux corrections de fond : le **balayage disparaît** de §4.3 pt 3 (un balayage de période `P`
détecte une péremption `F` au plus tard à `F + P` : à `P = F = 2000`, pire cas **4000 ms** pour un budget de
2000 + 1 trame) et **C4 n'est plus « ouvert »** mais **tranché (a)**. C'est la dette la plus utile de la page :
depuis la rév. 3, §4.3 pt 3 autorisait un mécanisme **incapable de tenir le budget que publie ACo-9**, et E3
l'avait aggravé en se déclarant « répercussion mécanique » — un seuil de péremption et une période de
détection ne portent jamais le même nombre (AD-25 D3).

| AD-25 | page | Endroit | Ce qui change |
|---|---|---|---|
| **E8** | **E13** | §4.3 pt 3 | l'option « **balayage à la cadence du plancher** » est **retirée** — pas renumérotée, pas de valeur de repli « ≤ 2000 ». Remplacée par « **échéancier armé à l'arrivée** » avec les 5 obligations d'AD-25 D2 (un seul créneau `cancel`-puis-armement ; l'échéance **vérifie l'âge** ; `cancel` sur arrivée **et** démontage ; port unique `browser-timers.ts` ; état identique ⇒ **zéro rendu**), plus la raison chiffrée `F + P` (2000 + 2000 = 4000 ms) |
| **E9** | **E14** | §7 **C4** | « ouvert » → « **tranché (a) le 2026-10-31 (AD-25 D4)** », en citant les deux clés **déjà présentes au contrat** (`ipc-contract.ts:35`, `:52`) et leur **inutilisation** mesurée ; **(b)** et **(c)** conservés comme **refusés** |
| **E10** | **E15** | §5.2 **ACo-8** / **ACo-9** | « gelés tant que C4 est ouvert » → « **non exécutables jusqu'au câblage du relais** ». ACo-9 : budget **inchangé** (2000 ms + 1 trame), et la falsification **dit** qu'un balayage à 2000 ms échoue à **4000 ms** : seul l'échéancier tient ce budget |
| **E11** | **E16** | §5.2, **ACo-16** (neuf) | **garde-vie silencieuse** : 3 s de garde-vie à 1 Hz sur un état inchangé ⇒ **0 rendu** de l'overlay — on compte les **rendus**, pas les messages. Falsification : un re-rendu par message ⇒ **3 rendus** ⇒ rouge |

**Note de numérotation (à lire une fois).** AD-25 nomme ces quatre errata **E8–E11** : il relit la page en
**rév. 4**. La page est partie chez vous en **rév. 5** (03:20Z), qui avait déjà consommé les identifiants
**E8–E12** pour ses propres constats (canal réel mesuré, sentinelles, C5, C6). Les quatre lignes d'AD-25
portent donc ici **E13–E16**, avec le numéro d'AD-25 conservé en première colonne : aucun numéro ne désigne
deux choses, et rien de ce qui a été envoyé à desk-shell, desk-qa ou à Régie ne change de nom. Même raison
pour le numéro de révision — une seconde « rév. 5 » au contenu différent ferait deux documents sous une
étiquette.

**Effets mécaniques (aucune décision nouvelle) — cinq endroits, comptés, pas « etc. » :** (i) le paragraphe
de statut juste après le tableau §5.2 et (ii) le point 5 de §0 disent « **non exécutables jusqu'au câblage** »
au lieu de « gelés » (c'est E15) ; (iii) §9 « Suites » ne peut pas garder « échéancier **ou balayage** à
2000 » après le retrait de E13 — la phrase ne nomme plus que l'échéancier, le décompte y passe à
**ACo-1..ACo-16**, et deux mentions « si (a) est arbitré » y deviennent « (a) tranché le 2026-10-31 », avec la
divergence de mesure renvoyée au merge ; (iv) l'« ordre de lecture » de §5.2 place **ACo-16 juste après
ACo-9** (même banc, même relais) ; (v) dans l'historique, la ligne **E3** de la rév. 4 porte désormais
« **annulée par E13** » — une trace d'erreur ne doit pas rester lisible comme une prescription. Les AC
**non retouchés** qui écrivent encore « tant que C4 est ouvert » (ACo-13, ACo-14, ACo-15)
gardent leur texte — consigne explicite — et se lisent « **tant que le relais n'est pas câblé** » :
convention donnée en §7 C4.

**Non touché par cette révision** (le dire est le seul moyen qu'on puisse le vérifier) : §1 (dont §1.3), §2,
**§3** (dont le tableau de vérité et §3.2), §3.4, §4.1, **§4.2**, **§4.4** (attaque **0** / extinction **680**),
§5.1 (**O-P, O1–O5, O7–O10**), §6, **C1**, C2, **C3**, **C5**, C6, **ACo-7**, **ACo-10..ACo-15**, et la page
**SPEC-013b**. **Aucun AC retiré** ; ACo-8 et ACo-9 ne sont pas « dégelés » — ils changent de **motif** de
non-exécution (décision manquante → livraison manquante), pas d'état, et restent non exécutables aujourd'hui.
**Zéro code, zéro clé i18n, zéro texte d'interface.**

**Historique.** rév. 2 (même jour) : §1.4 corrigé par desk-shell (`overlay__mute` et suffixe a11y gardés
par `mutedAttr`, l.78 et non 79), C4 ajouté, ACo-13 ajouté, ACo-8/ACo-9 gelés. **rév. 3** (même jour) :
§4.1/§4.4 passent des valeurs *demandées* aux valeurs **mesurées** du producteur livré par desk-engine
(`SAMPLE_PERIOD_MS = 50`, `SPEAKING_HOLD_MS = 600`, extinction 680 ms — le chiffre de la maquette, contre
900 ms dans la première implémentation) ; C5 ajouté (cadence de repli quand la fenêtre principale est
masquée) ; ACo-14 ajouté, lui aussi conditionné à C4. Les décisions O-P, O1..O10, ACo-1..ACo-13 et le
tableau de vérité §3 sont **inchangés** — les numéros de ligne de l'overlay n'ont pas bougé.

**rév. 4** (même jour, correction **étroite** imposée par Régie — canon : `SPEC-016-AD-23-plancher-scope-2000`
§2 D1–D3 et §3). Le §4.1 de la rév. 3 était faux sur deux points : il **supprimait** un plancher qui protège
d'autre chose, et il choisissait une valeur égale à une période de garde-vie. Ce qui change, exhaustivement
(rien d'autre dans la page n'est rouvert — décisions O-P, O1..O10, §3, §4.2, §4.4, C1..C5, ACo-1..ACo-7,
ACo-10..ACo-13, ACo-14, ACo-15 sont **inchangés**) :

| # | Endroit | Ce qui change |
|---|---|---|
| E1 | §4.1, tableau | une ligne « rendu (overlay **et** salon) ≥ 1000 ms » → **deux** lignes : **table producteur 250 ms** / **surface relayée 2000 ms** |
| E2 | §4.1, prose | « `SPEAKING_STALE_MS = 250` est ce qu'on remplace » **annulé** → 250 n'est pas remplacé, il est **confiné** à la table producteur ; le plancher de la surface relayée est **`SPEAKING_RELAY_STALE_MS = 2000`**, dérivé (2 × `SPEAKING_KEEPALIVE_MS`), 1000 ms **refusé** (frontière) |
| E3 | §4.3 pt 3 | « balayage à la cadence du plancher (≥ 1000 ms) » → **2000 ms** (c'est la surface relayée) — **ANNULÉE par E13 (rév. 6)** : l'erreur n'était pas la valeur, c'était de tenir un balayage pour un plancher (`F + P` = 4000 ms). Ligne conservée comme trace de l'erreur, pas comme prescription |
| E4 | §5.1 O6 | « péremption ≥ 1000 ms » → péremption **par surface** (250 table / 2000 relayée) |
| E5 | §5.2 ACo-8 | plancher d'extinction ≥ 1000 ms → **2000 ms** ; fond inchangé |
| E6 | §5.2 ACo-9 | plancher mesuré = **2000 ms** (producteur tué ⇒ extinction ≤ 2000 ms + 1 trame) + falsification « plancher à 1000 ms = expire sur la frontière » |
| E7 | §7 C5 | « ≥ 1000 ms au rendu » → « 250 table producteur / 2000 relayée » (même lecture, pas de décision nouvelle) |

Les E1–E2 sont l'arbitrage ; E3–E7 sont la **répercussion mécanique du même nombre** dans les endroits qui
le citaient encore. Aucun AC n'est ajouté, aucun n'est retiré, aucun gel n'est levé : ACo-8 et ACo-9 restent
**gelés** tant que C4 est ouvert, et se rapportent gelés, jamais verts par vacuité.

**rév. 5** (même jour, retour de Cadre sur l'**état réel du canal** — mesuré dans `/work/lan-voice` à
04:19:38Z, message desk-shell « Cadre — état réel du halo »). Ce n'est pas une correction de la rév. 4 :
c'est l'arrivée de **faits de terrain** qui rendent deux formulations fausses par excès et une troisième
fausse par défaut. Rien n'est rouvert ailleurs (§1.1/§1.2, §2, §3.1, §3.3, §3.4, §4.2, §4.4, O1–O5, O7–O10,
ACo-1..ACo-7, ACo-10..ACo-13 restent **inchangés**) :

| # | Endroit | Ce qui change |
|---|---|---|
| E8 | §1.3 + §7 **C4** | C4 n'est plus « aucun chemin » : la **moitié productrice est posée de bout en bout** (contrat, preload, relais du main, module de cadence 1 kHz, branchement dans `voice.ts`) et **mesurée**. Il manque la **moitié consommatrice** (lot T23 de Cadre : `overlaySpeaking`, abonnement `onSpeakingSet`, péremption). C4 devient « demi-fermé », avec une **condition de sortie nommée** au lieu d'un constat d'absence |
| E9 | §3 (ligne `data-speaking`) + §3.2 | l'overlay ne produira **que deux** des trois sentinelles : `"true"` ou `"unknown"`, **jamais `"false"`** — ni pour un pair, ni pour soi. La sentinelle `"false"` reste **légale** (ACo-6 inchangé) mais **personne ne doit la chercher à l'overlay**. Le soi-même ne passe **pas** par `selfSpeakingAttr` ici (§3.2, argument et falsification) |
| E10 | §4.1 + §5.2 **ACo-9** + §7 **C6** (neuf) | le consommateur de T23 est annoncé à **2500 ms** ; le canon fixe **2000** (AD-23 D4.2, et le §3 qui a produit E6) et **contredit D2 de la même page**, qui déclare 2500 « acceptable ». ACo-9 ne peut plus être un nombre unique : il se dédouble en **F1 autonomie** / **F2 valeur**, et la valeur hors canon **n'est jamais verte** — arbitrage C6, pas défaut de rendu |
| E11 | §4.3 pt 4 (neuf) + §7 **C5** | la limite est maintenant **mesurée et nommée** : le producteur publie depuis le `requestAnimationFrame` de la fenêtre principale ; fenêtre réduite ⇒ Chromium gèle `rAF` ⇒ l'overlay retombe à `unknown` au bout de la péremption. Deux options chiffrées (a `backgroundThrottling: false`, 1 ligne / b port `Timers`). D'ici l'arbitrage : **le halo n'est pas garanti fenêtre principale cachée**, et ça s'écrit |
| E12 | §4.4 + §5.2 **ACo-14** | les **680 ms ± 1 image** sont établis sur la **table producteur** seulement. Sur la surface relayée s'ajoutent une traversée IPC et une mise à jour d'état React : la tolérance **n'y est pas établie**. Ne pas recopier ± 1 image ; mesurer et **rapporter la valeur observée** |

E8–E9 sont des **faits** (le canal, les sentinelles possibles) ; E10 est un **conflit de nombres** entre deux
pages du canon, que je ne tranche pas ; E11–E12 sont des **limites de mesure** déclarées. Aucun gel n'est levé
par cette révision : ACo-8/ACo-9 restent gelés **jusqu'au merge de T23**, et leur sortie de gel est désormais
conditionnée à un événement nommé, pas à une décision.

---

## 0. Comment s'en servir

1. §1 donne l'état mesuré — lignes recalculées, écart avec les numéros cités, et ce que la vignette ne
   porte pas. C'est le seul état de départ.
2. §2 tranche la source de vérité. C'est la décision de cette page, et elle a une conséquence de
   transport qui n'est pas dans mon périmètre (§7).
3. §3 est le tableau à coder : aucun attribut de vignette n'existe en dehors de lui.
4. §4 est le halo : quatre nombres, ce que fait `unknown`, et le piège d'horloge à ne pas reproduire.
5. §5 est normatif (O1..O10 + ACo-1..ACo-16). §6 dit ce que vous **ne** faites pas. §7 est pour Régie,
   pas pour vous. Cinq AC **ne sont pas exécutables aujourd'hui**, et pour deux raisons distinctes :
   **ACo-8, ACo-9, ACo-16** le sont « **jusqu'au câblage du relais** » (C4 **tranché (a)**, la livraison
   manque), **ACo-14 et ACo-15** restent **gelés** (leur second motif, **C5**). C'est
   écrit, ce n'est pas un oubli : ne les cochez pas « verts », rapportez le motif exact, l'arbitrage et la
   condition de sortie. **MAJ rév. 6 (E15) :** le mot « gelés » disparaît pour ACo-8 et ACo-9 — C4 n'est plus
   ouvert, il est **tranché (a)** ; la sortie d'inexécutabilité est une **livraison** (merge de T23, §7 C4),
   sans nouvelle révision de cette page. ACo-9 se rapporte alors en **deux fragments** (F1 autonomie /
   F2 valeur, C6 **fermé** : 2000, AD-26 §1 — rév. 7, E17). **MAJ rév. 7 (E19) :** ACo-14 et ACo-15 restent
   gelés, mais **C5 n'est plus ouvert** — il est tranché (a) **sous mesure datée** (AD-26 §3), donc la sortie
   de gel d'ACo-15 est désormais un **résultat de mesure**, pas un arbitrage à venir. Et l'overlay ne produit **que deux** sentinelles de parole
   (`"true"`/`"unknown"`) : un AC qui attend `"false"` y est **non exécutable** (§3.2).

---

## 1. État mesuré de l'overlay (au 2026-10-31, code lu en entier)

### 1.1 Anatomie, ligne par ligne

`src/renderer/Overlay.tsx` (150 lignes, lues en entier ; les numéros ci-dessous sont recalculés, pas repris) :

| Ligne | Ce qui s'y trouve | Ce que ça implique |
|---|---|---|
| 26–33 | `OverlayProps` : `locale`, `participants: ParticipantDto[]`, `selfId?: string \| null` | La population est **une prop**, pas une souscription |
| 35–38 | `initials(name)` — 2 mots, 1ʳᵉ lettre de chacun | Un nom d'un seul mot donne 1 lettre ; un id opaque donne 1 lettre |
| 41 | `t = createTranslator(locale)` | 5 clés seulement sont utilisées : `overlay.group`, `overlay.speaking`, `overlay.muted`, `overlay.empty`, `overlay.handle` |
| 42–43 | `visible = participants.slice(0, MAX_OVERLAY_PARTICIPANTS)` | **La seule garde** : une troncature à 10, sans filtre de soi, sans dédoublonnage, sans union |
| 45–53 | `useMemo` de géométrie, dépendance `visible.length`, `workArea` = `MAX_OVERLAY_WIDTH_PX * 4` | Le rendu **recalcule** sa propre géométrie à partir de `visible.length` ; commentaire 46–47 : « on ne veut jamais de retour à la ligne » (faux au-delà de 8, cf. §2.4) |
| 58–65 | commentaire 58–64 puis `speakingClock = performance.now()` (l.65), une lecture par rendu | La péremption se juge contre l'horloge **du rendu**, pas d'une boucle (cf. §4.3) |
| 68–72 | racine `.overlay`, `data-empty` = `visible.length === 0` (l.71) | L'état vide suit la liste reçue |
| 73 | `ul.overlay__avatars`, `aria-label = overlay.group` | Rôle liste, un seul libellé de groupe |
| 74–75 | `visible.map`, `speaks = peerSpeaking(participant.id, PEER_LEVELS, speakingClock)` | `PEER_LEVELS` est une **table de module, par renderer** : vide dans cette fenêtre ⇒ `unknown` (commentaire 61–64, honnête) |
| 79 | `flagsKnown = mutedAttr(participant, selfId) === 'true'` | « Muet » ne s'affiche que sur un `true` **mesuré**, c'est-à-dire en pratique sur soi seul (commentaire 76–78) |
| 81–86 | `li` : `key={participant.id}` (82), `className="overlay__avatar"` (83), `data-speaking` (84), `data-muted` (85), `title={participant.name}` (86) | **Aucun `id` dans le DOM** : ni `data-peer-id`, ni `data-self` |
| 88 | `span.overlay__halo` — toujours présent | Un halo par vignette, allumé ou non |
| 89–91 | `span.overlay__initials` = initiales, `aria-hidden` | Avatar = initiales, rien d'autre |
| 92 | pastille `span.overlay__mute`, **rendue seulement si `flagsKnown`** | La pastille n'existe que pour soi |
| 93–97 | texte `visually-hidden` : nom + `overlay.speaking` (95) si `true` + `overlay.muted` (96) si `flagsKnown` | Aucun texte pour `unknown` |
| 103 | `visible.length === 0` ⇒ `p.overlay__empty` = `overlay.empty` | Le seul texte d'absence qui existe |
| 105–140 | poignée `role="button"`, `tabIndex={-1}` (112), glisser | Seule zone focusable du document, et elle est à −1 |

Provenance de la population — **cinq sites**, pas deux (c'est là que le diagnostic cité était court) :

| # | Site | Rôle |
|---|---|---|
| P1 | `overlay-entry.tsx:29` — `api.onParticipants(setParticipants)` | La **seule** souscription de la fenêtre overlay |
| P2 | `ipc-contract.ts:240` / `preload/index.ts:82` | Canal `lan:event:participants`, payload `ParticipantDto[]` |
| P3 | `main/room-bridge.ts` (`join`, `addParticipant`, `emit`) | Producteur de la liste : **l'annuaire** |
| P4 | `Overlay.tsx:42–43` | Troncature de rendu à 10 |
| P5 | `main/index.ts:288` — `overlay.apply(settings.overlay, bridge.getRoomState().participantCount)` | **La fenêtre et les zones de clic** sont dimensionnées sur un compte d'annuaire, décidé hors de l'overlay |

Conséquence mesurée de P3+P5 : `addParticipant` n'a **aucun appelant** dans l'arbre (vérifié : une seule
occurrence, sa définition) et `join` ne pose que soi ⇒ aujourd'hui l'overlay rend **exactement une
vignette : soi**, `data-speaking="unknown"`, halo éteint. La coquille est un adaptateur en mémoire ; ce
n'est pas un défaut, c'est l'état de départ à ne pas confondre avec « ça marche ».

### 1.2 Écart avec les numéros cités

| Cité (message d9152402, §10 de 013b) | Recalculé | Verdict |
|---|---|---|
| `Overlay.tsx` ~:28 lit l'annuaire | `:28` = `participants: ParticipantDto[]` (déclaration de prop) | Numéro **exact**, mais la ligne ne *lit* rien : la lecture est `overlay-entry.tsx:29` |
| `Overlay.tsx` ~:43 lit l'annuaire | `:43` = `visible = participants.slice(0, MAX_OVERLAY_PARTICIPANTS)` | Numéro **exact** |
| (non cité) | `:49` géométrie du rendu, `main/index.ts:288` fenêtre + hit-test, `ipc-contract.ts:606–609 / :642` plafond 8 | **Écart de diagnostic** : la population est fixée à 5 endroits, dont 3 hors de `Overlay.tsx` |

L'écart n'est donc pas dans les numéros mais dans la portée : deux lignes de `Overlay.tsx` ne suffisent pas
à décrire le couplage, et deux des cinq sites sont dans `main/`. Toute décision qui ne parle qu'à
`Overlay.tsx` laisse P5 désynchronisé (cf. ACo-10).

### 1.3 Ce que la vignette ne porte pas (mesuré)

- Pas d'identité dans le DOM : ni `data-peer-id`, ni `data-self`. Un harnais ne peut pas dire **laquelle**
  des vignettes correspond à quel participant. AC20-1 (« le halo de la ligne de soi dans l'overlay »)
  n'est donc **pas falsifiable** aujourd'hui.
- Pas de parole : `data-speaking` vaut `unknown` sur 100 % des vignettes : aucun relais de parole n'arrive dans cette fenêtre (voir §4.1).
  **MAJ 2026-10-31 04:19:38Z (rév. 5, E8) — le relais existe maintenant jusqu'à la fenêtre, pas dedans.**
  Mesuré par Cadre : le canal `lan:speaking-set` est posé **de bout en bout côté producteur** —
  `src/shell/ipc-contract.ts:35` (nom du canal), `:52` (événement), `:93`/`:106` (listes d'autorisation),
  `:622`/`:685` (gardes de charge), `:209` (`SPEAKING_SET_MAX = 9`) ; preload l. 84 et 105 ; relais du
  process principal `src/main/index.ts:260-301` (avec rejeu au `did-finish-load`, l. 215-219) ; module de
  cadence `src/renderer/speaking-relay.ts` (`SPEAKING_KEEPALIVE_MS = 1000`, l. 31, garde-vie seulement si
  l'ensemble est non vide, l. 116) ; producteur branché `src/renderer/voice.ts:382`. **Ce qui manque est
  l'autre moitié** — la moitié consommatrice, lot **T23** de Cadre : `overlaySpeaking` + péremption de
  surface + abonnement `onSpeakingSet` dans `Overlay.tsx` / `overlay-entry.tsx`. Vérifié de mon côté à la
  même heure : `overlaySpeaking` **n'existe pas** dans `src/renderer/` (`peerSpeaking`, `mutedAttr`,
  `selfSpeakingAttr` existent ; grep sans résultat sur `onSpeakingSet` dans `src/renderer/**`). Donc tant
  que T23 n'est pas mergé, **cette ligne reste vraie** : 100 % `unknown`, halo éteint, et **ACo-13 est le
  seul état livrable**.
- **MAJ 2026-10-31, retour desk-shell, mesuré, postérieur à la première rédaction.** Les deux portes ne
  lisent plus `participant.speaking` : `Overlay.tsx:76` appelle `peerSpeaking(peerId, PEER_LEVELS, clock)`,
  la **même fonction** que la liste de pairs du salon (`Room.tsx:141`) et que la ligne de participant
  (`Room.tsx:170`) — une seule porte pour trois surfaces, ce qui renforce §2. Le garde de la pastille
  `overlay__mute` et du suffixe a11y (`Overlay.tsx:78`) est `mutedAttr(participant, selfId) === 'true'` :
  c'est exactement ce que §1.4 demandait, et `selfFlagKnown` a disparu du fichier (il ne servait qu'ici).
  Aucun `participant.speaking` ni `participant.muted` brut ne subsiste dans une ligne de vignette.
  **Écart noté** : §1.4 relevait `flagsKnown` l.79 ; le garde est l.78, le suffixe a11y juste après, dans le
  même bloc 81–86. Décalage d'une ligne, défaut identique, fermé — les deux numéros de §1.1 restent bons.
- **Ce que la MAJ ne change pas** : `PEER_LEVELS` reste **vide dans cette fenêtre** (aucun plan média,
  aucun flux, producteur `src/renderer/peer-speech.ts` vivant dans l'autre renderer). La bonne porte branchée
  sur une carte vide rend `unknown` — voir **C4** (le chemin existe jusqu'à la fenêtre, pas dedans : demi-fermé,
  rév. 5 E8) et **C5** (la cadence s'arrête quand la fenêtre principale est masquée), les deux points encore
  ouverts sur le halo.
- Pas d'état de signalisation : ni `data-peer-state`, ni `data-peer-cause`, ni `data-peer-stream` — l'overlay
  ne reçoit aucun événement de signalisation (constat, pas oubli : cf. §3.3).
- Pas de gain, pas de badge, pas d'anneau de connexion, pas d'indicateur de parole non mesurée : cette
  fenêtre n'a que halo, initiales, pastille de mute (soi seul) et un texte d'absence.
- Pas de nom visible : le nom n'est que dans `title` (infobulle native), et dans le texte lisible par
  lecteur d'écran. Sur une fenêtre qui traverse les clics, l'infobulle n'apparaît que sur les rectangles
  qui captent (avatars + poignée) : elle n'est pas une information d'écran.

### 1.4 Deux autres écarts mesurés, hors périmètre (à ne pas mélanger avec la population)

1. **Échelle non transmise au rendu.** `overlay.apply` reçoit `settings.overlay` (donc `scale`),
   `Overlay.tsx:48–51` ne transmet **ni `scale` ni `maxWidth`** : le rendu calcule toujours en `md` (28 px),
   la fenêtre en `settings.scale`. En `lg` (36 px) la fenêtre se dimensionne pour 7 colonnes alors que le
   rendu en pose 8. Défaut réel, **hors étape B** (§6) : il ne doit pas être confondu avec le défaut de
   population que ACo-10 mesure.
2. **Compte plancher.** `Math.max(1, visible.length)` (l.49) et `MIN_OVERLAY_PARTICIPANTS = 1` donnent une
   fenêtre d'une vignette même à population vide : `data-empty="true"` cohabite avec une fenêtre non nulle.
   C'est voulu (la poignée doit rester attrapable) — aucune règle n'est ajoutée ici.

---

## 2. Décision — l'overlay affiche **la même liste unie que le salon**

### 2.1 Décision O-P

> **O-P — Une population, un producteur.** L'overlay rend la **liste unie du salon** telle qu'elle est
> produite en amont, par le canal existant `lan:event:participants` (P2). `Overlay.tsx` **ne fusionne
> rien**, ne filtre rien, ne complète rien, et **ne lit jamais `voice.peers`** : il rend ce qu'il reçoit,
> avec les règles ci-dessous. Le merge appartient à un seul endroit, celui où les deux listes existent.

Motifs, dans l'ordre de force :

1. **Deux surfaces qui montrent « qui est là » ne peuvent pas différer** sans que l'une mente. Après
   T23 A, la divergence devient visible à l'œil nu : une ligne au salon, pas de vignette à l'overlay.
   AD-20 D3 a déjà refusé cette forme (« deux lignes par pair dont une seule s'allume, c'est-à-dire un
   mensonge visible ») ; la même phrase s'applique une surface plus loin.
2. **Une vignette manquante est un halo structurellement impossible.** C'est exactement la classe de
   défaut qu'AD-19 a refusée (un halo qui ne peut rien afficher). Un pair qui parle sans vignette est un
   halo qui ne peut pas s'allumer : pas un état dégradé, une fonctionnalité morte.
3. **L'overlay ne peut pas fusionner lui-même.** Il est une autre fenêtre ; `voice.peers` vit dans le
   renderer de la fenêtre principale et n'est pas transporté. Un merge local exigerait un transport de
   présence — surface neuve, refusée à cette étape — et produirait **deux** merges, donc deux vérités :
   précisément ce que T23 A supprime.
4. **P5 dimensionne la fenêtre et les zones de clic sur un compte que l'overlay ne contrôle pas.** Si la
   population du DOM dépasse ce compte, les vignettes en trop tombent **hors de la fenêtre** : absences
   muettes, et une zone de clic qui n'existe plus (voir le calcul en 2.4). Si elle est en dessous, des
   rectangles de capture subsistent **sans vignette** : des clics destinés à l'application en dessous sont
   avalés dans du vide. Un seul compte pour trois usages (DOM, fenêtre, hit-test) est la seule forme qui
   ne peut pas se désynchroniser.

### 2.2 Ce que O-P ne dit pas

- Ce n'est **pas** « l'overlay va chercher `voice.peers` » : il n'y a pas accès, et il ne doit pas y avoir
  accès (motif 3).
- Ce n'est **pas** un nouveau canal, ni un champ neuf dans un DTO : `ParticipantDto` porte déjà tout ce que
  la vignette affiche et l'union ne l'enrichit pas (§3.3).
- Ce n'est **pas** un changement de règle du salon : la ligne unie reste celle de SPEC-013b §3–§5, l'ordre
  et l'état vide de l'overlay reprennent les mêmes décisions (O2, O9).

### 2.3 Variante écartée, et pourquoi (pour qu'on ne la repropose pas)

**Présence déduite du canal de parole** (`speaking[]` de l'étape B) : un id inconnu de l'annuaire créerait
sa vignette au premier échantillon. Refusée, trois fois :

- **naissance/mort avec la parole** : la vignette du pair apparaît à sa première syllabe et disparaît au
  silence. Une vignette qui vit et meurt avec la parole n'est pas une présence, c'est un compteur de bruit ;
- **remontage** : chaque apparition est un nœud neuf (`key` présente pour la première fois), donc un halo
  qui repart de zéro, et un `MutationObserver` d'ACo-4 verrait une suppression d'élément — ce que la page
  interdit ;
- **budget du canal** : `AC20-2` compte les messages en silence (≤ 2 en 10 s). Porter de la présence là
  oblige à un garde-vie de présence, donc à dépasser le budget, ou à faire entrer la présence dans les
  messages de parole — deux compteurs sur un canal, l'un des deux mentira.

### 2.4 key / remontage : ce que l'union change exactement

Ce qui **ne change pas** : `key={participant.id}` (l.82) reste la clé, et l'id est déjà l'unique espace
d'id (AD-19 D2 : un seul domaine, signalisation ou annuaire). C'est la condition qui rend le transitoire
inoffensif.

Ce qui est **interdit** (sinon le transitoire démonte la vignette) :

| Interdit | Ce qui se passerait |
|---|---|
| Mettre la source dans la clé (`id:annuaire` / `id:pair`) | À l'arrivée du pair dans l'annuaire, la clé change ⇒ **nœud neuf** ⇒ halo coupé au milieu d'une syllabe |
| Changer de type d'élément ou de composant selon la source | Deux types au même emplacement = démontage/remontage, même avec la même clé |
| Dériver la présence d'une liste qui peut rétrécir | Un pair hors annuaire disparaîtrait à chaque rafraîchissement d'annuaire : clignotement de vignette |
| Tronquer avant de fusionner | Un pair hors annuaire chasserait un pair d'annuaire, ou l'inverse : la population dépendrait de l'ordre d'arrivée |

Ce qui est **attendu**, et qu'il ne faut pas chercher à lisser : quand l'annuaire rattrape le pair, ses
champs changent (nom, initiales, `data-speaking`, `data-muted`) et il **se déplace** vers sa position
d'annuaire, puisque l'overlay suit l'ordre du salon (O2). Le déplacement a lieu au même instant, dans le
même sens, au salon : les deux surfaces restent superposables. Un seul déplacement, pas deux.

Ce que l'union **ajoute comme contrainte de dimensionnement** (calcul exact, échelle `md`, largeur par
défaut) : 8 colonnes au maximum (336 − 12 de poignée = 324 utiles ; `floor((324 − 16 + 8) / 36) = 8`).
8 vignettes = 1 rangée, hauteur 44 DIP ; **9 vignettes = 2 rangées, hauteur 80 DIP**. Une fenêtre
dimensionnée pour 8 (P5) qui doit en afficher 9 coupe la seconde rangée : 36 DIP de vignettes invisibles,
et une zone de clic qui ne les couvre pas. C'est le seul chiffre à retenir de cette section.

### 2.5 La condition de transport (et pourquoi ce n'est pas dans mon périmètre)

O-P exige que la liste unie arrive **par le canal existant**. Ce canal est gardé : `eventParticipants`
refuse un tableau de plus de 8 éléments (`ipc-contract.ts:606–609`) et `participantCount` est borné à 8
(`:642`). **Le canal de parole, lui, accepte déjà 9** (`SPEAKING_SET_MAX = 9`, `ipc-contract.ts:209`) alors
que le canal participants plafonne à 8 (`IPC_MAX_PARTICIPANTS`, `:311`) : le plafond à 8 ne vit que dans le
canal de population, et l'écart est déjà dans le contrat. Or l'union peut atteindre **9 puis 10** : soi + 8
pairs du maillage (plafond de `local-signaling` : 8 pairs, soi exclu) dont un absent de l'annuaire (plafond
8, soi inclus) — et **C1, retenu (a) le 2026-10-31 (AD-26 §2), fixe le plafond d'affichage à 10** (rév. 7,
E18). Au-delà du plafond du canal, le payload n'est pas tronqué : il est **refusé en bloc** — l'overlay garde
l'ancienne liste, ce qui est pire que tout. ⇒ **§7, conflit C1 — tranché** : trois rôles, trois nombres —
**deux changent** (affichage 8 → **10**, ensemble de locuteurs 9 → **10**) et **un ne bouge pas** (rejoindre,
**8**). Le canal
participants passe à **10** dans le contrat (`ipc-contract.ts:606–609`, `:642`, `room-bridge.ts:83`, `:167`
via `MAX_OVERLAY_PARTICIPANTS`), et **relever la population seule déplacerait le blocage au canal de parole** :
à 10 participants et un ensemble de locuteurs à 9, le dixième locuteur n'est **pas rapportable** — et si la
garde du canal de parole refuse **en bloc** comme celle de la population, l'overlay retombe à **100 %
`unknown`** : le défaut que cette page corrige. Dans les deux lectures, l'état de parole du dixième est perdu. L'étape B peut livrer le halo et les
attributs d'adressage sans attendre (§6), mais **pas** la population : elle attend le lot C1 (contrat + les
deux bornes, après T23).

---

## 3. Tableau de vérité des attributs de vignette

Une vignette = un `li.overlay__avatar`. Rien d'autre n'est ajouté au DOM, **aucun attribut n'existe en
dehors de ce tableau**.

| Attribut | Présence | Valeurs (sentinelles) | Source | Ce que ça dit / ce que ça ne dit pas |
|---|---|---|---|---|
| `key` (React, hors DOM) | toujours | l'id, tel quel | liste unie | Identité de rendu. Jamais suffixée (§2.4) |
| `data-peer-id` | **toujours** (nouveau à l'overlay) | id non vide, espace d'id unique (AD-19 D2) | liste unie | **La** clé de rapprochement avec le salon. Même nom, même sémantique que `Room.tsx:137` |
| `data-self` | **toujours** (nouveau à l'overlay) | `"true"` \| `"false"` | comparaison à `selfId` | Rend AC20-1 adressable. Même nom et mêmes deux valeurs que `Room.tsx:177` ; pas de troisième valeur : `selfId` inconnu ⇒ `"false"` partout, et la fenêtre est alors hors salon |
| `data-speaking` | toujours | `"true"` \| `"false"` \| `"unknown"` — **à l'overlay, en pratique : `"true"` ou `"unknown"`, jamais `"false"`** (rév. 5 E9, §3.2) | relais d'étape B (AD-20 D1/D4) | Trois valeurs **légales**, comme au salon ; deux **produites** ici. `"unknown"` = aucun ensemble frais — jamais un quatrième état, jamais un texte. Un harnais qui attend `"false"` à l'overlay attend un mot que personne n'écrit |
| `data-muted` | toujours | `"true"` \| `"false"` \| `"unknown"` | `mutedAttr(participant, selfId)` (l.85) | `"unknown"` pour **tout pair** (le DTO ne renseigne que soi) ; `"true"` n'est possible que sur la ligne de soi. Aucune pastille sur un pair |
| `title` | toujours | le nom de la liste unie ; pour un pair hors annuaire, **son id tel quel** (F4 de 013b), jamais une chaîne inventée | liste unie | Infobulle native. Pas une information d'écran (§1.3) |
| `className` | toujours | `overlay__avatar` | — | Une seule forme pour toutes les vignettes, quelle que soit la source |
| *(absent)* `data-peer-state`, `data-peer-cause`, `data-peer-stream` | jamais | — | — | **Décision** : non portés (§3.3) |
| *(absent)* `data-empty` sur la vignette | jamais | — | — | `data-empty` reste sur la racine (§3.4) |

Note d'affichage héritée, à ne pas « corriger » ici : les initiales d'un pair hors annuaire se calculent
sur son id (`initials`, l.35–38, repli `?`), et un id opaque ne donne **qu'une lettre** — deux pairs dont
l'id commence par la même lettre affichent donc la même pastille à l'overlay comme au salon. C'est la règle
de 013b §4 (avatar calculé sur l'id), pas un défaut de cette page : rien à ajouter, rien à distinguer.

### 3.1 L'id de soi à l'overlay : **oui**

Décidé : l'overlay continue d'afficher une vignette pour soi, exactement une, avec `data-self="true"`.

- **AC20-1 le nomme** : « le halo de **la ligne de soi** dans l'overlay passe à `'true'` ». Une ligne
  d'overlay non adressable n'est pas un critère, c'est une phrase. `data-self` est le prix minimal
  (attribut, zéro texte, zéro clé).
- C'est l'usage : on veut voir **son propre micro** pendant qu'on parle, et l'overlay est la seule surface
  visible quand la fenêtre principale est derrière le jeu ou l'éditeur.
- C'est la seule ligne dont le mute est **certain** (l.79) : la retirer supprimerait la seule pastille qui
  ne soit pas `"unknown"`.
- Conséquence de dédoublonnage, héritée de T23 A (013b F1/F3) : si `voice.peers` venait à contenir `selfId`,
  il y aurait **une seule** vignette de soi, et `data-self="true"` exactement une fois.

### 3.2 Sentinelles : trois valeurs, fermées

`"unknown"` n'est pas une valeur de plus, c'est l'aveu d'une absence de mesure — et il ne s'écrit
**jamais** en clair à l'écran (aucun « non mesuré », aucune infobulle, aucun sixième libellé, aucune
pastille grisée). Déjà vrai au salon (SPEC-013b §3), repris tel quel : mêmes noms d'attributs, mêmes
sentences, même silence.

**Asymétrie à l'overlay : trois valeurs légales, deux produites (rév. 5, E9).** Le canal de parole ne
transporte **aucune information négative** : il publie une **liste d'ids qui parlent**, et rien d'autre —
pas d'horodatage de mesure, pas de drapeau « non mesuré », pas de complément. Un id **absent** d'un
ensemble frais peut donc vouloir dire « muet », « jamais mesuré », ou « le producteur ne sait pas encore
qui il est » : l'ensemble ne distingue pas. Conséquence, à écrire noir sur blanc pour que personne ne la
cherche :

- **pour un pair** : `"true"` si son id est dans l'ensemble frais, **`"unknown"` sinon — jamais `"false"`** ;
- **pour soi** : **même règle**, et c'est un **changement de programme par rapport au message de Cadre**
  (qui annonçait un soi à trois états via `selfSpeakingAttr`). Voici pourquoi, et c'est falsifiable :

  1. `selfSpeakingAttr(live, speaks)` (`participant-state.ts:78-81`) rend `"unknown"` dès que `live` est faux.
     Dans la fenêtre d'overlay, **il n'y a pas de plan média** : `Overlay.tsx` n'importe ni `voice.ts` ni
     d'état `voice` (l. 13-24 : `api`, `participant-state`, `i18n`, rien d'autre), et `voice.status ===
     'live'` n'a donc **pas de source** ici. Appelé tel quel avec `live = false`, `selfSpeakingAttr` rend
     `"unknown"` **100 % du temps** : le « troisième état » du soi n'existe pas, il dégénère silencieusement
     en `"unknown"` — un test qui l'attendrait resterait rouge pour une raison qui n'a rien à voir avec le
     relais.
  2. Si on remplace `live` par « un ensemble frais est arrivé », alors on écrit `"false"` sur la ligne de
     soi **chaque fois que l'ensemble frais ne contient pas selfId** — y compris quand le micro est mort,
     refusé, ou qu'aucun périphérique d'entrée n'existe. C'est exactement l'état « sans périphérique » :
     l'overlay affirmerait « tu es muet, mesuré » alors que **rien n'a été mesuré**. Une mesure fabriquée,
     la même faute que §3.3 refuse pour `data-peer-stream`.
  3. Rien ne dédommage : `"false"` et `"unknown"` donnent **le même pixel** (halo éteint). Aucun écran ne
     perd une information en perdant `"false"` ; un contrat, si — le canal devrait porter un drapeau
     « mesuré », ce que AD-20 D1 refuse explicitement (un seul id, pas de drapeau self).

  ⇒ Règle d'étape B : `overlaySpeaking(id, selfId, set, now)` rend `"true"` si `id ∈ set` frais, sinon
  `"unknown"`, **pour tout id, soi compris**. Une seule règle, une seule fonction, deux valeurs.
  `selfSpeakingAttr` **reste au salon**, où `live` est réel. Si Régie veut un `"false"` de soi à l'overlay,
  il faut un signal « mesuré » **dans la charge** : c'est une réouverture de AD-20 D1, pas un détail de
  rendu — donc une AD de plus (**pas** C6 : il est fermé, il portait la **valeur** 2000, pas cette question —
  rév. 7), pas cette page.
- **Conséquence sur les AC** : ACo-6 (valeurs légales) est **inchangé** — `"false"` reste dans le jeu fermé
  et reste produit au salon. ACo-13 (100 % `"unknown"` tant que C4 est ouvert) est **inchangé**. ACo-8/ACo-9
  ne dépendent que de `"true"`, donc **inchangés par E9**. Un AC qui exigerait `"false"` sur une vignette
  d'overlay serait **non exécutable**, et se rapporte comme tel, pas comme rouge.

### 3.3 Ce qui n'est **pas** porté : état/cause/flux de signalisation

Le salon porte `data-peer-state` (`unknown`/…), `data-peer-cause` (`none`/…), `data-peer-stream`
(`false`/…). L'overlay ne les porte **pas**, et c'est une décision, pas un oubli :

- ces trois attributs décrivent l'état du **tuyau de signalisation** ; la fenêtre overlay ne reçoit aucun
  événement de signalisation. Les écrire `unknown`/`none`/`false` partout ne serait pas « la même
  sentinelle », ce serait une **mesure fabriquée** : au salon, `unknown` veut dire « mesuré, indéterminé »,
  pas « pas transporté » ;
- l'overlay n'a aucun anneau de connexion : pas de flux, pas d'anneau, pas de cause à dire ;
- coût nul pour l'AC de population : ACo-1 et ACo-2 rapprochent les deux surfaces **par `data-peer-id`**,
  pas par un état.

### 3.4 `data-empty` et l'état vide suivent l'union

`data-empty` (racine, l.71) et `overlay.empty` (l.103) doivent se calculer sur la **population unie**, pas
sur la liste reçue avant fusion. Sinon on obtient le défaut symétrique de F9 (013b §5) : « Personne pour
l'instant. » affiché **sous une vignette**. Aucun texte nouveau : `overlay.empty` existe (« Personne pour
l'instant. » / « Nobody yet. »), et c'est le seul texte d'absence de cette fenêtre.

---

## 4. Halo : cadence et péremption (conforme AD-20 D4)

### 4.1 Les quatre nombres, et rien d'autre (rév. 4 : le quatrième se dédouble **par surface**, 250 / 2000)

| Où | Nombre | Rôle | Mesuré (2026-10-31, desk-engine) |
|---|---|---|---|
| Producteur (fenêtre principale) | **transitions** d'abord : non vide → vide, vide → non vide | Une transition par changement d'état, pas une image par image | `peer-speech.ts`, 17 tests dédiés |
| Producteur | **tenue 600 ms** avant de publier le retour au vide | Anti-clignotement entre deux syllabes | `SPEAKING_HOLD_MS = 600`, plage 500–700 **assertée** |
| Producteur | **échantillonnage local 50 ms** (jamais publié) | Le métreur doit battre plus vite que la péremption, sinon un `true` peut expirer entre deux échantillons | `SAMPLE_PERIOD_MS = 50` **exporté** ; un test asserte 50 < 250 **et** 50 ≤ 250/4, et l'absence de trou d'horodatage sur 40 échantillons |
| Producteur | **garde-vie ≤ 1 Hz, uniquement si `speaking[]` non vide** (AD-19 D1) | Empêche la péremption de l'ensemble ; ne rafraîchit rien | inchangé, c'est la cadence **publiée** |
| Rendu — **table producteur** (salon) | **`SPEAKING_STALE_MS = 250`** — **confiné**, ni remplacé ni relevé | Garde contre un **producteur mort** sur une table lue à 50 ms dans le même renderer (5 échantillons) | `participant-state.ts` ; le porter à 1000 affaiblirait la garde d'un facteur 4 sans rien régler |
| Rendu — **surface relayée** (overlay, seule entrée `lan:speaking-set`) | **`SPEAKING_RELAY_STALE_MS = 2000`** | Un état affiché dérive d'un échantillon plus jeune que le plancher, **sans** clignoter sur une frontière de garde-vie | à livrer par Cadre ; dérivation : **2 × `SPEAKING_KEEPALIVE_MS = 1000`** (AD-23 D2) |

Le **50 ms est local** : il ne traverse aucune frontière de fenêtre, ne coûte aucun message et n'est pas un
cœur. Ce qui est interdit par D4 — et ce que cette page continue d'interdire — c'est une **cadence publiée**
ou une **animation de rendu** à 5 Hz. Un métreur qui échantillonne à 50 ms puis **publie des transitions**
est exactement la forme demandée ; un overlay qui redessinerait 20 fois par seconde ne le serait pas.

**Deux surfaces, deux planchers — et c'est le défaut d'origine que d'avoir un seul nombre.** La rév. 3
écrivait « `SPEAKING_STALE_MS = 250` est ce qu'on remplace » et « péremption ≥ 1000 ms au rendu (overlay
**et** salon) ». Les deux phrases sont **annulées** (AD-23 D1–D3) :

- **`SPEAKING_STALE_MS = 250` ne bouge pas.** Il est **confiné** à la table producteur (`peer-speech` →
  `PEER_LEVELS` → `Room.tsx`), cadence locale 50 ms, aucun message. Là, 250 ms = 5 échantillons : ça ne
  protège que d'un producteur mort, et c'est exactement ce qu'on lui demande. Le commentaire de
  `Overlay.tsx:58` (« la péremption de 250 ms ») reste donc **vrai pour la table** et doit être **daté
  d'un renvoi** vers la constante de surface au moment du relais (C4 a), pas réécrit en 1000.
- **La surface relayée a son propre plancher, nommé, par surface** —
  `SPEAKING_RELAY_STALE_MS = 2000` (exporté, AD-23 D2). C'est le seul nombre qui gouverne l'extinction du
  halo de l'overlay.
- **Dérivation, pas goût :** la garde-vie du canal vaut `SPEAKING_KEEPALIVE_MS = 1000` **exactement**
  (`speaking-relay.ts:31`). Un plancher **égal à une période** expire *sur la frontière* : 1 ms de gigue
  d'IPC ou une trame de rendu, et le halo retombe — c'est le clignotement qu'on corrige, déplacé d'un cran.
  Il faut **deux périodes** : 2000 ms. C'est déjà le nombre de AC20-7r(b) : **une seule valeur, pas deux**.
- **1000 ms est refusé** (frontière, et c'est le seul point où Régie me contredit sur le fond — le refus est
  retenu). **2500 ms : refusé — et le canon ne se contredit plus (C6 fermé le 2026-10-31, AD-26 §1 ; rév. 7,
  E17).** La contradiction était réelle : AD-23 **D2** écrit « 2500 ms est acceptable mais inutile », tandis
  qu'AD-23 **D4.2** (et le §3 qui a produit E6) exige l'extinction relayée à **2000 + 1 trame** — un
  consommateur à 2500 ms fait tomber D4.2. Sa résolution n'amende pas D4.2 : **D2 était un classement**
  (1000 refusé < 2000 canon < 2500 inutile), **D4.2 est l'assertion**, donc c'est elle qui engage, et AD-26 §4
  **précise** D2 d'une phrase. Deux raisons de plus, dans cet ordre : **2000 est dérivable** (2 × garde-vie de
  1000), 2500 ne l'est pas ; et 2500 laisse le halo allumé **500 ms de trop sur un producteur mort** —
  exactement ce que F1 borne. La dérogation par consommateur est **refusée** pour le motif d'origine : un
  second nombre pour le même rôle recréerait le défaut d'AD-23. La valeur **2000** reste donc la valeur de
  cette page (seule dérivable), ACo-9 reste dédoublé en **F1 autonomie** et **F2 valeur**, et un consommateur
  à 2500 ms se rapporte **« F1 vert / F2 non conforme — défaut de valeur, corrigé par une constante (C6,
  AD-26) »** : ni vert (F2 est faux), ni rouge de rendu (le mécanisme et ACo-8 tiennent).
- **Le salon ne prend pas 2000** (D3) : `Room.tsx` lit la table locale à 50 ms dans le même renderer, c'est
  le producteur, pas la surface relayée. Un seul nombre pour les deux est précisément le défaut d'origine.
- Interdit de nom (AC20-8r) : aucun code de rendu relayé ne lit `SPEAKING_STALE_MS`, aucun code de table ne
  lit `SPEAKING_RELAY_STALE_MS`.

Le CSS ne bouge pas : transition de 80 ms sur `border-color` (`styles.css:585–587`), halo
`pointer-events: none` (il ne capte aucun clic), **aucune animation en boucle** — le commentaire de
`styles.css:579` le dit déjà (« transition, pas d'animation en boucle »).

**Pas de cœur à 5 Hz.** Côté **rendu** (overlay et salon) : aucune boucle de rendu, aucun
`requestAnimationFrame` décoratif, aucun intervalle de rafraîchissement — le halo ne s'allume que sur un
`data-speaking="true"` **déjà** dans l'état, et s'éteint sur la transition inverse ou sur la péremption.
Côté **producteur**, le seul `requestAnimationFrame` autorisé est celui du métreur (`startMeter`, 50 ms
d'échantillonnage, non publié) : il mesure, il n'anime pas. La phrase à retenir pour la revue est donc
« un battement qui mesure, zéro battement qui dessine ».

### 4.2 Ce que l'overlay fait d'un `unknown`

- **Halo jamais allumé**, vignette **présente**, `data-speaking="unknown"` dans le DOM.
- Aucune différence visuelle avec `"false"` : `styles.css:589` n'a qu'un sélecteur, `[data-speaking='true']`.
  C'est voulu — « on n'affiche pas l'absence de mesure ».
- Aucun texte, aucun attribut de plus, aucune infobulle : `overlay.speaking` n'est rendu que si `"true"`
  (l.95), et `flagsKnown` n'ouvre `overlay.muted` que pour soi.
- **C'est l'état d'aujourd'hui, sur 100 % des vignettes** (table de module vide dans ce renderer, l.62–64).
  L'étape B ne change pas cette règle, elle change la provenance de l'échantillon.

### 4.3 Le piège d'horloge (mesuré, à ne pas recopier)

`speakingClock = performance.now()` est bien relu **à chaque rendu** (l.65), donc rien n'est figé au
chargement — mais il n'existe aujourd'hui **aucune cause de rendu liée à la parole** dans cette fenêtre :
`PEER_LEVELS` est une table mutable lue pendant le rendu, sans état React. Conséquence à retenir pour
l'étape B :

1. `data-speaking` doit venir d'un **état** mis à jour par l'événement de relais (sinon le halo ne bouge
   qu'au prochain `participants`, c'est-à-dire jamais) ;
2. l'horloge de péremption doit être lue **après** la dernière mise à jour d'état. Un échantillon arrivé
   plus tard qu'une horloge capturée plus tôt donne un âge **négatif**, et `peerSpeaking` traite un âge
   négatif comme `unknown` (`participant-state.ts:70`) : le halo **ne s'allume jamais**, sans un mot. C'est
   la même classe de défaut qu'AD-19 (« un halo qui ne peut rien afficher »), mais cette fois avec un
   relais en place — donc invisible au relecteur ;
3. la péremption doit être **autonome**, et elle n'a **qu'un** mécanisme : un **échéancier armé à l'arrivée**
   de l'échantillon, à **`SPEAKING_RELAY_STALE_MS = 2000`** (surface relayée). C'est ce qui éteint le halo si
   le producteur se tait ou meurt (ACo-9), sans cœur rapide. **Cinq obligations** (AD-25 D2), toutes
   vérifiables, aucune négociable :
   1. **un seul créneau** : armement = `cancel` puis armement. Un échantillon toutes les 1000 ms (la
      garde-vie) ne doit pas empiler deux échéanciers — sinon le plus ancien éteint un halo frais, et c'est
      le clignotement qu'on corrige, revenu par la porte du minuteur ;
   2. **l'échéance ne décide pas seule** : elle **lit l'âge** et n'éteint que si `âge > 2000` ; un échéancier
      qui éteint sans lire l'horloge éteint un halo renouvelé entre-temps ;
   3. **`cancel` atteint par les deux chemins** : nouvelle arrivée **et** démontage de l'overlay (motif A6
      d'AD-18 : une fenêtre fermée ne garde pas un minuteur armé) ;
   4. **un seul port de minuterie** : `src/renderer/browser-timers.ts` (relevé A3r). L'échéancier de l'overlay
      y passe — **un site**, pas un `setTimeout` local ; le plafond « 2 fichiers avec `setTimeout|setInterval` »
      reste à 2 ;
   5. **état identique ⇒ zéro rendu** : la garde-vie à 1 Hz arrive une fois par seconde sans rien changer ;
      elle ne doit produire **aucun** rendu (ACo-16). Sans cette clause, le « ≤ 2 rendus sur 1 s » d'ACo-9
      serait tenu par chance, pas par construction.

   **Le balayage périodique est interdit, et le chiffre le dit** (rév. 6, E13 / AD-25 D1) : un balayage de
   période `P` ne détecte une péremption de plancher `F` qu'au plus tard à **`F + P`** — entre deux balayages,
   l'échantillon peut expirer juste après le précédent. À `P = F = 2000`, le pire cas vaut **4000 ms**, soit
   **2000 ms de trop** sur le budget qu'ACo-9 publie (2000 + 1 trame). La rév. 3 avait déjà ce défaut
   (1000/1000 ⇒ 2000 ms pour un budget de 1000 + 1 trame) et il était invisible parce que les deux rôles
   portaient le **même nombre** ; la rév. 4 l'a doublé en « répercutant » 1000 → 2000 dans une phrase où le
   nombre n'était pas un seuil mais une **période de détection**. Il n'y a donc **pas** de valeur de repli
   « ≤ 2000 » : un mécanisme qui ne peut pas tenir le budget qu'on publie est une dette, pas une option.
   Corollaire (AD-25 D3) : s'il apparaît un jour une cadence de contrôle, elle aura **son** nom et **son**
   nombre, et ACo-9 dira `2000 + P` — jamais « 2000 + 1 trame » avec un balayage en place.
4. **L'âge se compte à la réception, pas à la mesure (rév. 5, E8/E10)** — et c'est mesuré, pas supposé : la
   charge du canal ne porte **aucun horodatage** (garde `ipc-contract.ts:622`, l. 645 : une liste d'ids
   bornée par `SPEAKING_SET_MAX = 9`, rien d'autre). L'overlay ne peut donc dater un ensemble qu'à son
   **arrivée**. Deux conséquences à ne pas confondre avec un défaut :
   - la péremption est une **fenêtre de réception** : elle borne « depuis quand je n'ai rien reçu », pas
     « depuis quand la mesure est vieille ». Un retard d'IPC **allonge** le halo d'autant — c'est accepté,
     parce que le producteur est dans le même processus machine ;
   - le process principal **rejoue le dernier ensemble connu** au `did-finish-load` de l'overlay
     (`src/main/index.ts:215-219`, décision AD-20 D1) : à un rechargement, l'horloge **repart de zéro** sur
     un ensemble qui peut déjà être périmé. Donc **ACo-9 se mesure sans rechargement** ; le cas
     « rechargement avec producteur mort » donne un halo allumé jusqu'à une péremption pleine et se rapporte
     **à part**, pas comme une extinction manquée. Un `"false"`/`unknown` forcé au chargement serait une
     mesure fabriquée ; on ne l'écrit pas.

### 4.4 Les deux temps du halo, mesurés : 0 ms et 680 ms (rév. 3)

La maquette demandait **attaque immédiate, extinction ≈ 680 ms** (600 ms de tenue + 80 ms de transition).
Le producteur livré par desk-engine donne exactement ces deux temps, et il vaut la peine d'écrire **par
quel défaut on passe à côté**, parce que la première implémentation l'a fait :

| Temps | Ce qui se passe à l'écran | Ancre correcte | Défaut évité |
|---|---|---|---|
| **Attaque** | halo allumé dès l'image qui suit la première trame mesurée au-dessus du seuil d'ouverture | dernière trame **mesurée** au-dessus du seuil | attendre l'hystérésis du VAD (2 trames) = **+100 ms** de retard à 50 ms d'échantillonnage ; le signal distant a déjà franchi la porte de l'émetteur, on ne ré-applique pas la sienne |
| **Extinction** | halo éteint **680 ms** après la dernière trame au-dessus du seuil (600 + 80) | même ancre, même seuil (−38 dBFS) | ancrer la tenue sur la dernière trame où `vad.speaking` est vrai : le relâchement du VAD (`releaseFrames = 6`, écrit pour des trames de 20 ms) vaut **300 ms réels** à 50 ms, donc 600 + 300 = **900 ms** — un halo qui traîne 220 ms de trop, et qui le fait **sans erreur** |

Conséquence pour Cadre : **680 ms est la valeur du contrat visuel**, 900 ms est un défaut d'ancre, pas une
tolérance. Aucun réglage CSS n'est à faire — la transition reste 80 ms, la tenue reste côté producteur ;
si vous mesurez 900 ms à l'écran, le défaut est dans le producteur, pas dans votre halo, et C4/C5 ne sont
pas en cause. Corollaire : **aucun second seuil** n'est introduit (le même −38 dBFS sert à l'attaque et à
l'extinction) — un seuil d'extinction plus bas rouvrirait le faux-halo que R-U1 interdit.

**Une réserve de mesure, à ne pas transformer en tolérance (rév. 5, E12).** Ces deux temps sont établis
**dans le renderer qui mesure** (table producteur). À l'overlay, la valeur arrive par le relais puis par un
rendu React : la mesure à l'écran peut sortir à 680 ms **plus** une ou deux trames de transport, et ça
**n'est pas** un défaut d'ancre. On mesure et on **rapporte la valeur observée** (« 690 ms, surface
relayée ») ; on ne recopie pas « ± 1 image » d'une surface à l'autre sans l'avoir mesuré là où on l'applique.
Même prudence pour l'attaque, qui hérite de la période d'échantillonnage (50 ms) : « 0 ms » veut dire
« aucune image intermédiaire », pas « sans latence de transport ».

---

## 5. Règles (normatives) et critères d'acceptation

### 5.1 Règles

- **O1 — Une population.** L'overlay rend la liste unie du salon, reçue en amont. Aucun merge, aucun
  filtre, aucun ajout, aucune lecture de `voice.peers` dans cette fenêtre.
- **O2 — Une vignette par id, clé = id.** Ordre identique à celui du salon (ordre de l'union, 013b §3).
  La clé n'est jamais suffixée par la source ; aucune branche de type d'élément selon la source.
- **O3 — Le transitoire ne démonte pas.** Un pair hors annuaire garde sa vignette pendant tout son séjour
  dans le maillage ; l'annuaire qui le rattrape change ses champs et le déplace, il ne le recrée pas.
- **O4 — Deux attributs d'adressage, pas trois.** `data-peer-id` et `data-self` sont les **seuls** ajouts
  au DOM de cette étape. Rien d'autre (§3).
- **O5 — Sentinelles fermées.** `data-speaking` et `data-muted` n'ont que trois valeurs ; `"unknown"` ne
  s'écrit jamais en clair ; aucun pair ne porte `data-muted="true"`.
- **O6 — Halo par transition.** Allumé seulement sur `"true"`, transition 80 ms, tenue producteur **600 ms
  mesurés** (500–700), échantillonnage local 50 ms (non publié), péremption **par surface** (rév. 4, E4) :
  `SPEAKING_STALE_MS = 250` pour la table producteur du salon, **`SPEAKING_RELAY_STALE_MS = 2000`** pour la
  surface relayée de l'overlay — jamais un seul nombre pour les deux. Conséquence
  visuelle mesurée : **attaque 0 ms, extinction 680 ms** (§4.4) — 900 ms est un défaut d'ancre, pas une
  tolérance. Aucune animation en boucle, aucun cœur publié à 5 Hz.
- **O7 — `unknown` silencieux.** Halo éteint, vignette présente, texte inchangé.
- **O8 — Soi, une fois.** `data-self="true"` exactement une fois quand `selfId` est connu, zéro fois sinon.
- **O9 — État vide sur l'union.** `data-empty` et `overlay.empty` se calculent sur la population unie.
- **O10 — Trois usages, un compte.** Le nombre de vignettes (DOM), le compte passé à `overlay.apply`
  (fenêtre) et le nombre de rectangles de capture (hit-test) sont **le même nombre**. Aucune vignette
  hors fenêtre, aucune zone de capture sans vignette.

### 5.2 Critères d'acceptation

Chaque AC est vérifiable sans lire mon intention : la colonne « falsification » dit quelle mutation doit
faire échouer le test.

| AC | Ce qui est mesuré | Falsification attendue |
|---|---|---|
| **ACo-1 — Population identique** | Ensemble des `data-peer-id` du DOM de l'overlay = ensemble des `data-peer-id` de la ligne unie du salon, pour 1..8 participants et pour chaque cas de 013b §4 (pair hors annuaire) | Retirer un pair de la liste transmise à l'overlay, ou ajouter un filtre dans l'overlay ⇒ ensembles différents |
| **ACo-2 — Aucune absence muette** | Pour **chaque pair affiché au salon**, soit il a une vignette à l'overlay portant le même `data-peer-id`, soit l'absence est **dite** : population vide ⇒ `data-empty="true"` + `overlay.empty`. Aucun troisième cas. En cas d'échec, le message **nomme l'id** manquant | Supprimer une vignette (slice à 7, filtre) ⇒ test rouge nommant l'id. C'est le « DIT » du critère : une absence ne peut pas être un silence, elle est soit une vignette, soit un texte existant, soit un échec nommé |
| **ACo-3 — Une vignette, un halo** | N participants ⇒ N `li.overlay__avatar`, N `data-peer-id` distincts, N `span.overlay__halo`, N `data-speaking` | Doublon d'id, halo absent d'une vignette, ou deux halos sur une ⇒ rouge |
| **ACo-4 — Le transitoire ne démonte pas** | Scénario en trois temps : pair dans `voice.peers` seul → annuaire qui le rattrape → annuaire qui le perd. `MutationObserver` sur la liste : **aucune suppression** de nœud pour cet id, le nœud garde le même identifiant d'objet DOM du début à la fin, et son `data-speaking` ne retombe pas à `"unknown"`/`"false"` **du seul fait** du rattrapage (l'état de parole ne dépend pas de la source) | Ajouter la source à la clé, ou changer de composant selon la source ⇒ une suppression est observée ; recalculer `data-speaking` depuis la liste d'annuaire ⇒ retombée au rattrapage |
| **ACo-5 — Soi adressable** | Exactement une vignette `data-self="true"` quand `selfId` est connu, aucune sinon ; la vignette de soi est celle qui satisfait AC20-1 | Retirer `data-self` ⇒ AC20-1 n'est plus adressable (rouge) ; le rendre toujours `"true"` ⇒ deux vignettes de soi |
| **ACo-6 — Sentinelles** | Toute valeur de `data-speaking` / `data-muted` ∈ {`true`,`false`,`unknown`} ; aucun pair ne porte `muted="true"` ; aucun quatrième état, aucun texte pour `unknown` | Introduire `"none"` ou `"n/a"` ⇒ rouge ; poser une pastille sur un pair ⇒ rouge |
| **ACo-7 — `unknown` silencieux** | Vignette d'un pair sans échantillon : `data-speaking="unknown"`, couleur de bordure du halo = valeur éteinte du jeton, `textContent` = le nom seul | Faire allumer le halo sur `unknown` ⇒ rouge ; ajouter un mot pour `unknown` ⇒ rouge |
| **ACo-8 — Cadence du halo** *(non exécutable **jusqu'au câblage du relais** — AD-25 D4, E15 ; ni vert ni gelé : son texte est déjà la recette du jour du câblage)* | 10 s de parole continue : `element.getAnimations()` ne contient **aucune animation en boucle** ; le halo ne repasse jamais par `"unknown"` (ni par `"false"`, que l'overlay n'écrit pas — §3.2 E9) entre deux syllabes ≤ 600 ms (AC20-3) ; à la dernière syllabe, éteint **pas avant** le plancher de la **surface relayée** (**2000 ms**, AC20-1r/AC20-7r(b)) — c'est un **plancher seul**, pas une fenêtre : une constante de 2500 ms **satisfait ACo-8** (rév. 5, E10 ; c'est ACo-9 F2 qui porte la valeur) | Poser une pulsation CSS, ou publier le vide sans tenue 600 ms ⇒ clignotement visible et rouge |
| **ACo-9 — Péremption autonome** *(rév. 5, E10 : **deux fragments**, vert seulement si F1 ∧ F2 ; **non exécutable jusqu'au câblage du relais** — AD-25 D4, E15)* | **F1 — autonomie** : après un `"true"`, le producteur est tué (aucun message) : l'overlay éteint le halo **sans nouveau message**, dans **`≤ constante exportée + 1 trame`** — **budget inchangé : 2000 ms + 1 trame** —, et **sans** re-rendu rapide (compter les rendus sur 1 s : ≤ 2). **F2 — valeur** : la constante exportée par le consommateur vaut **`SPEAKING_RELAY_STALE_MS = 2000`** (nom lu par le test, valeur en dur interdite côté rendu, AC20-8r) **et** ≥ 2 × `SPEAKING_KEEPALIVE_MS`. Mesure **sans rechargement** (§4.3 pt 4) | Péremption à 250 ms ⇒ extinction trop tôt ; **plancher à 1000 ms ⇒ expire sur la frontière de garde-vie, clignotement** ; pas de péremption ⇒ halo allumé indéfiniment ; **constante exportée = 2500** ⇒ F1 vert, **F2 non conforme** : se rapporte « **F1 vert / F2 non conforme — défaut de valeur, corrigé par une constante (C6, AD-26)** », **jamais vert** et jamais « rouge de rendu » ; la dérogation par consommateur est **refusée** (AD-26 §1, rév. 7 E17) ; **remplacer l'échéancier par un balayage de période 2000 ms ⇒ extinction au pire à `F + P = 4000 ms` ⇒ F1 rouge** : le budget 2000 + 1 trame n'est tenable que par un **échéancier armé à l'arrivée** (E13/E15, AD-25 D1–D2) — la falsification doit l'écrire, pas le suggérer |
| **ACo-10 — Trois usages, un compte** | Pour 8 puis 9 vignettes : chaque `li` a sa boîte **dans** les bornes de la fenêtre (aucune vignette coupée), chaque rectangle de capture correspond à une vignette existante, `columns`/`rows` du rendu = ceux de `overlay.apply`. Rappel des chiffres : 8 ⇒ 1 rangée/44 DIP, 9 ⇒ 2 rangées/80 DIP | Transmettre à la fenêtre un compte d'annuaire plus petit que la population ⇒ seconde rangée hors fenêtre ; plus grand ⇒ zone de capture fantôme (clic avalé) |
| **ACo-11 — Focus et clics** | Aucun élément focusable ajouté : `tabIndex = -1` reste sur la poignée seule, les `li` ne sont ni focusables ni cliquables ; hors rectangles des vignettes + poignée, `setIgnoreMouseEvents(true)` est actif (les clics traversent) | Rendre une vignette focusable, ou cliquable, ⇒ vol de focus possible / clic détourné |
| **ACo-12 — Zéro clé, zéro texte** | `design/i18n.json` inchangé : 297 clés FR, 297 EN, mêmes clés des deux côtés ; les 5 clés de l'overlay sont les mêmes ; le `textContent` d'une vignette ne contient que le nom et, si `"true"`, `overlay.speaking` / `overlay.muted` | Toute clé ajoutée ou supprimée, tout mot nouveau dans le DOM ⇒ rouge |
| **ACo-13 — Le halo éteint est un état, pas un oubli** | Tant que C4 est ouvert : 100 % des vignettes `data-speaking="unknown"`, aucun halo à la couleur allumée, **aucun texte de silence**, et aucun `"true"` ne peut apparaître sans relais. Corollaire d'ACo-2 : un pair sans halo n'est jamais un pair sans vignette | Un halo allumé sans relais ⇒ mesure fabriquée (rouge) ; un mot « non mesuré » ajouté ⇒ clé neuve (rouge) ; une vignette retirée parce que `unknown` ⇒ rouge au titre d'ACo-2 |
| **ACo-14 — Les deux temps du halo** *(gelé tant que C4 est ouvert — il n'y a pas de `"true"` à produire)* | Sur la vignette, producteur en place : **attaque** = halo allumé à la première image qui suit la première trame mesurée au-dessus du seuil (aucune image intermédiaire avec `"false"`, donc **0 ms** de retard dû à l'hystérésis) ; **extinction** = halo éteint à **680 ms ± 1 image** après la dernière trame au-dessus du seuil (600 de tenue + 80 de transition CSS). Mesure par `data-speaking` **et** capture datée. **Tolérance (rév. 5, E12) : ± 1 image n'est établie que sur la table producteur (même renderer) ; sur la surface relayée il s'ajoute une traversée IPC et une mise à jour d'état React — la tolérance n'y est pas établie, donc on **mesure et on rapporte la valeur observée** (ex. « 690 ms à l'overlay »), on ne recopie pas ± 1 image** | Ancrer la tenue sur `vad.speaking` au lieu de la dernière trame mesurée ⇒ extinction à ≈ 900 ms (rouge, 220 ms de trop) ; attendre les 2 trames d'hystérésis ⇒ attaque ≈ 100 ms (rouge) ; changer la transition CSS pour compenser ⇒ la maquette devient un réglage, rouge |
| **ACo-15 — Halo sur fenêtre principale masquée** *(gelé tant que C4 **et** C5 sont ouverts ; C5 porte désormais la mesure et les deux options — rév. 5, E11)* | Fenêtre principale réduite ou entièrement occultée (overlay visible sur un autre écran), pair qui parle : si le relais existe (C4 a) et que la cadence de repli existe (C5, option a `backgroundThrottling: false` **ou** option b port `Timers`), la vignette s'allume encore. Sinon : `unknown` **assumé**, aucun halo, aucun texte, et c'est déclaré non vérifié — jamais coché vert | Un `requestAnimationFrame` unique comme seule cadence ⇒ plus aucun allumage overlay sur fenêtre occultée (rouge si C4/C5 sont censés être fermés) ; une cadence de repli plus rapide que 50 ms ⇒ cœur déguisé (rouge) |
| **ACo-16 — Garde-vie silencieuse** *(neuf — rév. 6, E16 ; AD-25 D2 pt 5 ; non exécutable jusqu'au câblage du relais, même condition qu'ACo-8/ACo-9)* | État **rigoureusement inchangé** (un pair, `"true"` stable, aucune variation de population, de mute ni de focus) pendant **3 s**, la garde-vie du relais arrivant à **1 Hz** — donc **3 messages** attendus : l'overlay produit **0 rendu**. On compte les **rendus**, **jamais les messages** : montage, écritures de `textContent`/attributs `data-*`, relance d'animation. Instrumentation côté rendu (`MutationObserver` sur le conteneur de vignettes + compteur d'écritures d'attribut), pas côté canal IPC — un total de messages ≠ 0 est **normal** et ne fait pas échouer l'AC | **Re-rendu par message** (`setState` par garde-vie, `render()` par tick) ⇒ **3 rendus en 3 s ⇒ rouge**. **Un seul** rendu imputable à la garde-vie suffit à faire échouer : une garde-vie est un **silence**, pas une pulsation. Un rendu provoqué par le test lui-même (état forcé) se compte à part et se déclare |

**ACo-8 et ACo-9 ne sont plus « gelés »** (E15, AD-25 D4) : ils sont **non exécutables jusqu'au câblage du
relais**, aucun `"true"` n'étant encore produit à l'overlay. La distinction n'est pas cosmétique : « gelé »
disait « la décision manque », « non exécutable jusqu'au câblage » dit « **la décision est prise, la
livraison manque** » — et T23 est un merge, pas un arbitrage. Ce qui se rapporte reste identique dans les
deux cas : **jamais vert par vacuité**, avec la raison et le numéro de l'arbitrage ; la pire réponse reste
« vert ». ACo-16 tombe sous la même condition (la garde-vie n'existe à l'overlay que si le relais existe).
**ACo-14 et ACo-15 restent gelés**, mais plus pour la même raison (rév. 7, E19) : **C5 n'est plus ouvert — il
est tranché (a) sous mesure datée** (AD-26 §3), et **ACo-15 reste gelé jusqu'à cette mesure**, ni vert ni
rouge : ce n'est plus une **décision** qui manque, c'est un **chiffre**. La formule « tant que C4 et C5 sont
ouverts » de leur en-tête se lit donc « tant que le relais n'est pas câblé et que la mesure C5 n'a pas rendu
son verdict » — leur texte n'est **pas** retouché (consigne d'errata). ACo-14 se mesurera avec la tolérance
**observée**, pas recopiée (E12).

Ordre de lecture pour l'exécution : ACo-3 et ACo-5 d'abord (structure), ACo-1/ACo-2 ensuite (population),
ACo-4 (transitoire), puis ACo-6 à ACo-9 (sentinelles et cadence) et **ACo-16 juste après ACo-9** (même banc,
même relais), ACo-10/ACo-11 (fenêtre et clics),
ACo-12 en dernier (rien n'a bougé côté chaînes).

---

## 6. Hors périmètre de l'étape B (à ne pas gonfler)

1. **Pas de refonte de l'overlay** : position, glisser, ancrage, opacité, thème, poignée, hover,
   commandes — inchangés.
2. **Pas de surface neuve** : pas de canal, pas de champ de DTO, pas de fenêtre, pas de canal de présence.
   Si l'union ne peut pas passer par `lan:event:participants`, c'est un arbitrage (§7), pas un ajout.
3. **Pas de texte neuf, pas de clé neuve** : donc **pas** de message « N pairs masqués », pas de mention
   « non mesuré », pas de sixième libellé. La seule absence dite reste `overlay.empty`.
4. **Pas de correction de l'échelle** (§1.4) : défaut réel, autre sujet.
5. **Pas de `data-peer-state` / `cause` / `stream` à l'overlay** (§3.3).
6. **Pas de pastille de mute pour un pair**, pas de curseur de gain, pas d'anneau de connexion.
7. **Pas de modification du salon ni de SPEC-013b** : le feu T23 A garde ses règles ; cette page les
   réutilise (ordre de l'union, état vide, sentinelles) sans en rouvrir une seule.

---

## 7. Conflit à arbitrer

*État au 2026-10-31 (rév. 7) : **C1 fermé** (a), **C4 tranché** (a), **C5 arbitré** (a) sous mesure datée,
**C6 fermé** (2000). Ce qui reste ouvert n'est plus un arbitrage de cette page : c'est le **câblage** de T23
(C4), la **mesure** de C5, et une **constante** à corriger. Les textes de conflit sont conservés tels qu'ils
ont été soumis — ils portent le raisonnement, et le raisonnement reste la seule chose qui empêche de refaire
l'erreur.*

**C1 — Le plafond du transport (8) n'est pas le plafond du maillage (9).** *Fermé : **(a)** retenu le
2026-10-31 (AD-26 §2) — rév. 7, E18. Le plafond d'affichage est **10**, et il y a **trois rôles, trois
nombres**.* Mesuré : `local-signaling` plafonne à **8 pairs** (soi exclu) ; `IPC_MAX_PARTICIPANTS = 8`
plafonne l'annuaire (**soi inclus**) ; `eventParticipants` refuse un tableau de plus de 8
(`ipc-contract.ts:606–609`) et `participantCount` est borné à 8 (`:642`), alors que
`MAX_OVERLAY_PARTICIPANTS = 10` et que la géométrie sait déjà faire deux rangées. Une union soi + 8 pairs,
dont un hors annuaire, vaut 9 : le payload est **refusé en bloc**, l'overlay garde l'ancienne liste (pire
qu'une troncature, qui serait au moins visible).

**La table des trois rôles (`un nombre = un rôle`, AD-25 D3).** Le piège que mon relevé a mis au jour : la
population n'est pas le seul plafond sur le chemin, et **relever la population seule déplacerait le blocage**
du canal de population vers le canal de parole.

| Rôle | Plafond | Où | Ce qui change |
|---|---|---|---|
| **Rejoindre** (maillage) | **8** | `local-signaling` (8 pairs, soi exclu) | **inchangé** — le maillage n'est pas le sujet de cette page |
| **Affichage** (population unie) | **10** | `MAX_OVERLAY_PARTICIPANTS` ; `ipc-contract.ts` **606–609**, **642** ; `room-bridge.ts` **83**, **167** | **8 → 10** : le payload de 9 ou 10 est **accepté**, plus refusé en bloc |
| **Ensemble de locuteurs** | **10** | `SPEAKING_SET_MAX = 9` (`ipc-contract.ts:209`) | **9 → 10**, **dans le même lot** : à 10 affichés et 9 locuteurs, le dixième n'est pas rapportable — si la garde refuse en bloc, l'overlay retombe à **100 % `unknown`** |

Le lot C1 est donc **une seule livraison** : contrat (`ipc-contract.ts`, `room-bridge.ts`) **et** les deux
constantes d'ensemble, plus les tests de contrat. Livrer le contrat seul laisserait un overlay à 10 vignettes
dont **aucune ne peut parler au-delà de la neuvième** — le défaut de cette page, déguisé en progrès. **(b)** reste **refusé** : laisser 8 et
plafonner l'union est une **absence silencieuse**, interdite par **ACo-2** ; la rendre visible coûterait une
clé et un texte neufs, refusés à cette étape.

**C2 — Le compte de la fenêtre est un compte d'annuaire.** `main/index.ts:288` passe
`bridge.getRoomState().participantCount` : conséquence mécanique de O-P, il doit recevoir le compte de la
population unie, sinon ACo-10 échoue (vignettes hors fenêtre ou zones de capture fantômes). Ce n'est pas un
arbitrage de conception, c'est un appelant à corriger dans `main/` — donc hors de mon périmètre, et à
inscrire au plan de diff de Cadre/shell, pas à improviser dans `Overlay.tsx`.

**C3 — Pour mémoire, refusé et à ne pas reproposer :** porter la présence sur le canal de parole
(`lan:speaking-set`) casserait `AC20-2` (≤ 2 messages en 10 s de silence) ou ferait dépendre la population
de la parole (§2.3). Aucune concession n'est possible sur ce point sans rouvrir AD-19 D1.

**C4 — L'overlay est une autre fenêtre : le halo n'a aucun chemin jusqu'à elle.** ***Tranché (a) le 2026-10-31
(AD-25 D4)** : relais d'affichage unidirectionnel renderer → main → overlay. Le câblage reste **dû**, et il
est nommé (lot T23 de Cadre) ; voir l'état daté en fin de C4. Remonté par desk-shell à Régie le 2026-10-31
comme arbitrage, pas comme défaut de rendu.* Ce qui a décidé l'arbitrage, en une phrase : **le contrat porte
déjà les deux canaux** — `lan:speaking-set` (`src/shared/ipc-contract.ts:35`) et
`lan:event:speaking-set` (`:52`) — **et aucun code ne les utilise** (mesure de Régie, 04:40Z : 0 usage dans
`src/`, 0 dans `tests/`). Un arbitrage laissé « ouvert » alors que la moitié du câblage existe sous un nom,
c'est le pire des deux états : **ça se lit comme fait**. « Ouvert » se lit désormais « fait », et la seule
chose qui reste ouverte est une **livraison** (T23), pas une décision. Mesuré **à la rédaction**
(état d'origine, conservé pour la trace — depuis, le remplaçant existe, voir l'état daté plus bas) : D1
retire `lan:event:speaking` du contrat **sans remplaçant** ni abonnement — la parole ne remonte plus du main. La
seule source de niveaux est le producteur renderer `src/renderer/peer-speech.ts` (alimenté par `voice.ts`,
`onRemoteStream` + `level` + `speakingFromLevel` de `vad.ts`), unique écrivain de `PEER_LEVELS`, avec
péremption 250 ms → `unknown` ; un pair non mesuré n'est jamais écrit. `Overlay.tsx:76` lit donc la bonne
porte, mais son `PEER_LEVELS` est celui de **sa** fenêtre : pas de plan média, pas de flux, pas de relais
main → overlay. Conséquence, à dire tout haut plutôt qu'à masquer par du CSS : **à l'étape B l'overlay rend
`data-speaking="unknown"` sur 100 % des vignettes, soi compris, et le halo ne s'allume jamais.** SPEC-001 E4
/ CA15 n'est donc pas satisfait par l'overlay — non pas parce que la vignette est mal dessinée, mais parce
que le chemin d'affichage a été coupé par la décision même (AD-17 D1, reprise AD-20 D1) qui a fermé la
source. **Trois issues ont été examinées ; une seule est retenue :**
  - **(a) RETENU (AD-25 D4)** — relais d'affichage renderer → main → overlay, unidirectionnel, porté par les
    **deux clés déjà présentes au contrat** (`ipc-contract.ts:35`, `:52`), sans renommage ni clé neuve : on ne
    fait que recopier des `true`/`false`/`unknown` déjà mesurés dans la carte de la fenêtre d'overlay, on ne
    réintroduit **pas** de source de vérité dans le main (le main est une boîte aux lettres : aucune
    péremption, aucun jugement — l'expiration reste à la surface, §4.3 pt 3). L'horodatage qui compte est
    l'**arrivée** à l'overlay (D4, §4.3 pt 4). Débit : transitions + garde-vie ≤ 1 Hz (AC20-2).
  - **(b) REFUSÉ** — assumer un overlay sans halo à l'étape B et réécrire CA15 en « indicateur de parole :
    non disponible à l'overlay, voir le salon ». Zéro code, mais un overlay sans halo n'est pas un overlay
    incomplet : c'est un panneau de vignettes mortes, et CA15/SPEC-001 E4 ne serait plus tenu nulle part.
  - **(c) REFUSÉ** — déplacer l'overlay dans la fenêtre principale : refonte, §6.1, et perte du hors-focus.
  **ACo-8 et ACo-9 ne sont donc plus « gelés »** : ils sont **non exécutables jusqu'au câblage du relais**
  (T23), aucun `"true"` n'étant encore à produire à l'overlay ; l'état livrable et dit reste **ACo-7 +
  ACo-13**. Dès que le câblage existe, ils redeviennent la recette **sans nouvelle révision de cette page** —
  c'est déjà leur texte. (b) n'est plus un scénario : il est refusé, et ACo-8/ACo-9 ne « sortent » donc pas du
  lot, ils attendent une livraison.

**Convention de lecture pour les AC non retouchés.** ACo-13, ACo-14 et ACo-15 écrivent encore « tant que C4
est ouvert » : leur texte est **inchangé** (consigne d'errata), et cette formule se lit désormais « **tant que
le relais n'est pas câblé** ». Même chose partout où la page dit « demi-fermé » : c'est l'**état de câblage**
(une moitié posée, l'autre due), pas l'**état de la décision**, qui est tranchée (a).

**C4 — état daté (rév. 5, E8 ; conservé, c'est l'état de *câblage* et non de décision) : demi-fermé au
2026-10-31 04:19:38Z, et la sortie d'inexécutabilité est un événement nommé.**
L'issue (a) a été tranchée et **la moitié productrice est en place** : `lan:speaking-set` +
`lan:event:speaking-set` au contrat (`ipc-contract.ts:35`, `:52`, listes `:93`/`:106`, gardes `:622`/`:685`),
preload l. 84/105, relais du process principal `main/index.ts:260-301`, module de cadence
`renderer/speaking-relay.ts` (garde-vie `SPEAKING_KEEPALIVE_MS = 1000`, publication seulement si
l'ensemble est non vide), producteur branché `voice.ts:382`. **Ce qui manque est la moitié consommatrice**
(lot **T23** de Cadre : `overlaySpeaking`, abonnement `onSpeakingSet` dans `Overlay.tsx` /
`overlay-entry.tsx`, péremption de surface). Donc C4 n'est plus « aucun chemin » mais « le chemin
s'arrête à la porte » : l'overlay ne s'abonne pas encore.

- **Condition de sortie, écrite** : C4 est fermé quand `grep -r onSpeakingSet src/renderer/` retourne un
  abonnement dans `overlay-entry.tsx` **et** que `overlaySpeaking` existe et est exporté. Ce jour-là,
  **ACo-8 et ACo-9 deviennent exécutables sans nouvelle révision de cette page** — c'est déjà leur texte.
- **Ce qui ne change pas** : le sélecteur CSS reste **exactement** `[data-speaking='true']`
  (`styles.css:589`, §4.2). La moitié consommatrice n'ajoute aucune couleur, aucune animation, aucun état :
  rien à toucher côté feuille. Confirmé par Cadre le 04:19:38Z.
- **Ce qui reste vrai tant que T23 n'est pas mergé** : `unknown` sur 100 % des vignettes, halo éteint
  partout, **ACo-13 est le seul état livrable**. Un rapport qui coche ACo-8 ou ACo-9 avant ce merge est un
  vert par vacuité.

**Divergence de mesure, à ne pas lisser (rév. 6, E14).** Au **04:19:38Z** j'ai relevé la moitié productrice en
place (relais `main/index.ts:260-301`, branchement `voice.ts:382`, `speaking-relay.ts` à 1 kHz) ; au
**04:40Z** la mesure de Régie donne **0 usage** des deux clés dans `src/` **et** dans `tests/`. Les deux
relevés ne peuvent pas être vrais ensemble : soit un revert ou un renommage est passé entre-temps, soit l'un
des deux `grep` a raté le fichier. Le fait de décision **ne dépend pas** de la réponse — (a) est tranché, que
le canal soit déjà posé ou qu'il faille le poser — mais l'écart doit être **relevé au câblage de T23**, pas
absorbé : un rapport qui annonce « déjà branché » sur la foi d'un seul des deux chiffres est un vert de
lecture, pas une mesure. Critère de sortie, inchangé et vérifiable : `grep -r onSpeakingSet src/renderer/`
retourne un abonnement dans `overlay-entry.tsx` **et** `SPEAKING_RELAY_STALE_MS` existe.

**C5 — La cadence du métreur meurt avec la visibilité de la fenêtre principale — et c'est le cas normal
d'un overlay.** ***Arbitré : (a) `backgroundThrottling: false`, sous mesure datée (AD-26 §3, rév. 7 E19).***
*Ouvert au moment de la rédaction — décision produit demandée à Maquette, je la prends ici (depuis :
**arbitré (a)**, AD-26 §3). Remonté par desk-engine le 2026-10-31.* Mesuré : le métreur est un `requestAnimationFrame` (`startMeter`, `voice.ts`). Fenêtre
principale masquée ou entièrement occultée ⇒ rAF suspendu ⇒ plus d'échantillon ⇒ `unknown` après la
péremption (250 ms pour la table producteur, **2000 ms** pour la surface relayée — rév. 4 E7, même lecture).

**Décision (AD-26 §3) — l'issue, la portée, et ce qui la valide.** L'issue retenue est **(a)** :
`backgroundThrottling: false`, **une ligne de `main/index.ts`, sur la fenêtre qui porte la boîte aux
lettres** — **pas** global (pas de `webPreferences` commune, pas de `app.commandLine`), **pas** sur
l'overlay (une fenêtre d'overlay non étranglée est un coût sans contrepartie : elle ne mesure rien). Ce
n'est pas un réglage de confort, c'est la seule issue qui n'ajoute pas **deuxième horloge** : le rAF non
étranglé **est** le métreur, donc les conditions 1 à 4 de (b) sont satisfaites par construction.

Deux **sorties** écrites, vérifiables, et c'est la mesure qui les rend vraies :

| Sortie | Ce qui est mesuré | Falsification |
|---|---|---|
| **S1 — ACo-9 F1 fenêtre réduite** | fenêtre principale réduite (`minimize`), producteur tué sans message : le halo s'éteint dans **≤ 2000 ms + 1 trame** | si l'extinction n'arrive pas (halo figé `"true"`) ou dépasse le budget ⇒ **rouge** ⇒ (a) ne tient pas sa promesse |
| **S2 — coût borné** | fenêtre réduite, sur 10 s : **rendus de l'overlay ≤ 2/s** et CPU au repos de la fenêtre principale sous le **bruit de mesure** de la même fenêtre visible | rendus > 2/s ⇒ rouge (le rAF décore l'overlay au lieu de le mettre à jour) ; CPU mesurablement au-dessus du bruit ⇒ l'option tombe |

**Ce que (a) ne fait pas** : elle ne **ferme pas** C4 et elle ne rend pas ACo-15 vert. **ACo-15 reste gelé,
ni vert ni rouge, tant que la mesure datée n'a pas rendu son verdict** (AD-26 §3) : le mécanisme est
arbitré, le chiffre ne l'est pas encore. **Repli (b) à cinq conditions**, si S1 ou S2 échoue : (b) prend le
relais **tel qu'écrit ci-dessous, sans modification**, y compris son point 5 canon — `unknown` plutôt qu'un
`"true"` figé. Aucun mélange des deux : on ne garde pas le drapeau **et** le timer.

**MAJ 04:19:38Z (rév. 5, E11) — mesuré côté canal, et deux options chiffrées pour Régie.** Cadre a
re-mesuré le chemin complet du producteur : la publication part de la boucle `requestAnimationFrame` de la
fenêtre principale. Fenêtre **réduite**, Chromium ne se contente pas d'étrangler : il **gèle** `rAF` —
l'overlay retombe alors à `unknown` au bout de la péremption (2500 ms dans le consommateur annoncé — **périmé**,
C6 est fermé à 2000, AD-26 §1 ; 2000 ms au canon). Ce n'est plus une crainte de conception, c'est le comportement observé, et il tombe
**exactement dans l'usage de l'overlay**. Deux issues, une ligne chacune — **arbitrage rendu : (a)** (AD-26 §3,
rév. 7 E19) ; les deux restent écrites ci-dessous, **(b) est le repli**, pas une alternative ouverte :

- **option a — `backgroundThrottling: false` sur la fenêtre principale** (1 ligne, `main/index.ts`). Le
  métreur continue à 20 Hz fenêtre cachée, **aucun nouveau chemin**, aucune constante neuve, aucun
  `lan:event:speaking` ressuscité (C5 conditions 1, 2, 3 et 4 satisfaites *par construction* : le rAF non
  étranglé **est** le métreur). Coût à mesurer avant de signer : la fenêtre entière cesse d'être étranglée
  (peintures, animations, timers du salon) — si le CPU au repos fenêtre réduite dépasse le bruit de mesure,
  l'option tombe.
- **option b — porter le métreur sur `Timers`** (un `setInterval` de repli, déclenché par la visibilité).
  Plus de code, mais le coût est **borné au métreur** : c'est la version « conditions 1 à 5 » ci-dessous,
  et la seule qui reste valable si (a) coûte trop cher.

**Ma position de conception, inchangée sur le fond** : (a) d'abord parce qu'elle ne crée pas de seconde
horloge ; (b) si la mesure CPU de (a) n'est pas négligeable — position **suivie par AD-26 §3**. Dans les deux
cas, **d'ici la mesure datée** (l'arbitrage est rendu, pas la mesure), le halo n'est pas présenté comme
garanti fenêtre principale cachée : il se rapporte `unknown` assumé, **ACo-15 reste gelé**, et aucune page ne
promet l'inverse.
Côté salon, c'est sans conséquence : personne ne
regarde une fenêtre invisible. **Côté overlay, c'est le contraire** : un overlay sert *précisément*
pendant que la fenêtre principale est derrière un jeu, un éditeur ou un autre écran. Autrement dit, si C5
n'était pas tranché, un relais (C4 a) livrerait des halos qui s'éteignent **exactement dans l'usage pour
lequel l'overlay existe** — et c'est cette phrase, écrite avant l'arbitrage, qui a fixé la priorité de (a).

Ma position, et elle est une exigence de conception, pas un détail d'implémentation : **oui à une cadence
de repli**, sous cinq conditions, aucune négociable :

1. **Déclenchée par la visibilité, pas en permanence** : repli actif seulement quand
   `document.visibilityState === 'hidden'` (ou `document.hidden`) *et* qu'un consommateur existe (relais
   de C4 a). Fenêtre visible ⇒ rAF seul, comme aujourd'hui.
2. **Même période, jamais plus vite** : le repli échantillonne à `SAMPLE_PERIOD_MS` (50 ms), la constante
   exportée, pas à une valeur recopiée. Une période plus courte rouvrirait le cœur que D4 interdit ; une
   période plus longue que 250 ms rouvrirait les trous d'horodatage que le test actuel interdit.
3. **Sémantique de tenue inchangée** : 600 ms ancrées sur la dernière trame **mesurée** au-dessus du seuil
   d'ouverture (§4.4), même seuil, aucun second seuil, aucune hystérésis ajoutée pour « faire propre ».
4. **Rien de neuf au contrat** : pas de `lan:event:speaking` ressuscité (AD-17/AD-20 D1 tiennent), pas de
   clé i18n, pas de texte, pas d'attribut. Le repli est un **timer**, pas une surface.
5. **L'état affiché reste honnête** : si le repli ne peut pas tourner (politique de la plateforme,
   `setInterval` étranglé), le résultat est `unknown` — halo éteint, vignette présente, zéro texte. On
   préfère un halo absent à un halo figé sur `"true"`.

**Ces cinq conditions décrivent l'option (b).** L'option (a) `backgroundThrottling: false` n'ajoute aucune
horloge : elle rend 1 à 4 **sans objet** (le rAF non étranglé *est* le métreur) et ne laisse qu'une question
mesurable, le CPU au repos fenêtre réduite — si elle passe, elle est plus simple et je la préfère ; sinon,
(b) tel quel.

Ce que ça ne règle pas, et qu'il faut dire : C5 **ne ferme pas C4**. Sans relais cross-fenêtre, un métreur
qui tourne 24 h/24 dans la fenêtre principale ne fait toujours rien allumer à l'overlay. L'ordre des
dépendances est donc **C4 d'abord, C5 ensuite** — mais C5 est la raison pour laquelle C4 (a) ne suffit pas,
et c'est pourquoi il est écrit ici plutôt que découvert après livraison.

**C6 — 2000 ou 2500 : le canon se contredisait, et le consommateur de T23 avait déjà choisi (rév. 5, E10).**
***Fermé — tranché le 2026-10-31 par AD-26 §1 : `2000`, sans dérogation (rév. 7, E17).*** *La contradiction
ci-dessous est **conservée** — elle est instructive, et c'est elle qui a rendu le défaut visible — mais elle
n'est plus ouverte : **D4.2 était l'assertion, D2 n'était qu'un classement** (1000 refusé < 2000 canon < 2500
inutile), et AD-26 §4 **précise** D2 d'une phrase. D4.2 et le §3 de cette page sont donc **inchangés**. Ce
qui reste n'est pas un arbitrage, c'est une **constante à corriger dans T23**.*

- **Les faits.** AD-23 **D2** : « 2500 ms est acceptable mais inutile » (et D2 fixe `2000` comme la valeur
  retenue, « 1000 refusé »). AD-23 **D4.2** : après le dernier message, la constante `2000` est assertée
  « encore `"true"` à t0 + 1999 ms, plus `"true"` à t0 + 2001 ms » — **un consommateur à 2500 ms fait
  tomber D4.2**, et AD-23 **§3** (l'amendement d'ACo-9, rév. 4 E6) écrit la même borne haute. Cadre annonce
  une péremption consommateur à **2500 ms**. Donc : soit D2 a raison et D4.2/§3 sont trop serrés, soit
  l'inverse. 500 ms d'écart, mesurables, sur l'état le plus visible de l'overlay.
- **Ce que je ne fais pas** : changer 2000 en 2500 dans cette page parce qu'un lot est parti sur 2500 — ce
  serait aligner le canon sur un choix d'implémentation. Et je ne déclare pas 2500 « rouge » : il satisfait
  le plancher (≥ 2 périodes de garde-vie), donc il **ne clignote pas**, ce qui est la raison d'être du
  plancher.
- **Ce que je fais** : ACo-9 est dédoublé (F1 autonomie mesurée / F2 valeur de la constante exportée), et
  un consommateur à 2500 se rapporte **« F1 vert / F2 non conforme — défaut de valeur, corrigé par une
  constante (C6, AD-26) »** — ni vert (F2 est faux), ni « rouge de rendu » (le mécanisme et ACo-8 tiennent).
  **Issue retenue (AD-26 §1)** : **T23 prend 2000** — une constante, zéro autre changement, D4.2 reste vrai,
  E1–E7 restent cohérents. **La dérogation à 2500 est refusée**, pour trois raisons chiffrées : **2000 est
  dérivable** (2 × garde-vie de 1000), **2500 ne l'est pas** ; 2500 laisse le halo allumé **500 ms de trop
  sur un producteur mort**, exactement ce que F1 borne ; et une dérogation par consommateur, c'est **un
  second nombre pour le même rôle** — le défaut d'AD-23 rejoué.
- **Ce que ça ne touche pas** : ACo-8 est un **plancher seul**, 2500 le satisfait (§5.2). Le sélecteur CSS
  `[data-speaking='true']` ne bouge pas. Aucune clé, aucun texte.

**Aucun conflit avec le feu T23 A** : cette page ne modifie aucune de ses règles (ordre de l'union, forme
de la ligne, sentinelles, état vide, libellé audio). Elle ajoute deux attributs à une **autre** surface et
une contrainte de compte (C2) qui appartient à `main/`.

---

## 8. Zéro clé, zéro texte (état exact, pour la revue)

- `design/i18n.json` : **297 clés FR, 297 clés EN**, mêmes clés des deux côtés — avant et après.
  Aucune clé ajoutée, aucune supprimée, aucune renommée.
- Clés consommées par l'overlay, les cinq mêmes qu'aujourd'hui : `overlay.group`, `overlay.speaking`,
  `overlay.muted`, `overlay.empty`, `overlay.handle`. `overlay.empty` reste le **seul** texte d'absence.
- Attributs ajoutés au DOM : **deux**, `data-peer-id` et `data-self` — même nom, même sémantique, mêmes
  valeurs que la ligne de salon ; ils n'affichent rien.
- Aucun libellé en dur introduit ; aucun texte ne s'affiche pour `unknown`; aucune mention de comptage.
- Si un arbitrage venait à rendre une absence légitime (cas (b) de C1), **il faudrait une clé neuve** :
  ce serait une décision explicite, chiffrée, et hors de cette page.

---

## 9. Suites

- **Cadre (étape B)** : §3 (les deux attributs), §4.1–4.4 (halo par état, péremption autonome, les deux
  temps 0/680 ms), §5.2 ACo-3 à ACo-9 et ACo-11/ACo-12. §4.1 en clair (rév. 4) : **exporter
  `SPEAKING_RELAY_STALE_MS = 2000`** pour la surface relayée ; **ne pas toucher `SPEAKING_STALE_MS = 250`**,
  qui reste au salon ; aucun des deux symboles ne franchit sa surface (AC20-8r). La population (ACo-1, ACo-2, ACo-10) attend
  C1/C2 ; ACo-14 et ACo-15 attendent le **câblage du relais** (C4 est **tranché (a)**) et, pour le second,
  la **mesure datée de C5** (arbitré (a), AD-26 §3 — ce n'est plus un arbitrage) ; **ACo-16** se mesure au
  même banc qu'ACo-9 (rév. 6, E16).
- **Cadre, moitié consommatrice de T23 — quatre points précis (rév. 5)** : (i) **péremption à 2000, pas
  2500** — la dérogation est **refusée** (C6 fermé, AD-26 §1 ; D4.2 tombe à 2500) ; (ii) **deux sentinelles, pas
  trois** : `overlaySpeaking(id, selfId, set, now)` rend `"true"` ou `"unknown"` **pour tout id, soi
  compris** — `selfSpeakingAttr` n'a pas sa place dans cette fenêtre (`live` y est faux par construction,
  §3.2 pt 1), et un `"false"` de soi exigerait un drapeau « mesuré » que AD-20 D1 refuse ; (iii) la
  **péremption est autonome** — **échéancier armé à l'arrivée, à 2000, et rien d'autre** (le balayage est
  interdit : `F + P` = 4000 ms, rév. 6 E13) → et ACo-9 se mesure **sans rechargement** —
  le rejeu du `did-finish-load` remet l'âge à zéro (§4.3 pt 4) ; (iv) **rien à toucher au CSS** : le
  sélecteur reste `[data-speaking='true']`.
- **desk-shell** : C2 (l'appelant `main/index.ts:288`) et le plafond du transport — **(a) retenu le
  2026-10-31 (AD-26 §2)**, plus de condition d'arbitrage à surveiller de ce côté ; la **table des trois rôles**
  (§7 C1) dit quel nombre va où, et surtout lequel **ne change pas** (8, rejoindre).
  Les trois restes de la revue sont **fermés côté code** (portes `peerSpeaking` / `mutedAttr`, 2026-10-31).
  **C4 n'attend plus d'arbitrage** : l'issue (a) est tranchée (AD-25 D4) et la moitié productrice est en place
  d'après **ma** mesure du 04:19:38Z — mesure que la tienne (04:40Z, 0 usage) contredit : c'est la **divergence
  à relever au merge**, pas à trancher ici (§7 C4). Ce qui reste est le **merge de T23** (moitié
  consommatrice), et c'est la condition de sortie d'inexécutabilité écrite en §7 C4. Trois choses pour lui, de son ressort : **la constante du consommateur vaut `2000`, sans dérogation**
  (C6 fermé, AD-26 §1 — ce n'est plus une question, c'est une correction) ; la ligne
  `backgroundThrottling: false` dans `main/index.ts`, **sur la fenêtre qui porte la boîte aux lettres
  seulement** — c'est du `main/`, donc chez lui, pas chez le renderer du salon, et c'est **(a) de C5,
  arbitré sous mesure datée** (AD-26 §3) ; et le **lot C1** (plafond d'affichage **10** + `SPEAKING_SET_MAX`
  **10** dans la même livraison), **après** T23.
- **desk-engine** : le producteur est **livré et conforme** (`peer-speech.ts`, 50 ms / tenue 600 ms /
  680 ms d'extinction, AC-U10 rejoué sur `peerSpeaking` lui-même) — plus rien à demander de ce côté pour le
  salon. Deux restes : la **cadence de repli** de C5 — (a) `backgroundThrottling: false` **arbitré** (AD-26
  §3), une ligne côté `main/`, donc desk-shell ; (b) port `Timers` **en repli seulement si S1 ou S2 échoue** ;
  dans les deux cas aucune constante recopiée, pas de `lan:event:speaking` ressuscité — et le producteur de
  présence en amont, O-P étant retenu en (a) (C1, AD-26 §2) — un seul merge, celui du salon. Note E12 : les 680 ms ± 1 image sont établis
  sur **sa** table (même renderer) ; sur la surface relayée la tolérance reste à mesurer, pas à recopier.
- **Banc / VERIF** : ACo-1..ACo-**16**, plus AC20-1..AC20-5 déjà prescrits par AD-20. Le seul AC dont
  l'échec doit **nommer** un id est ACo-2. Aucun AC ne se rapporte vert par vacuité, et cinq ne sont pas
  exécutables : **ACo-8, ACo-9, ACo-16 — non exécutables jusqu'au câblage du relais** (C4 tranché (a),
  rév. 6 E15 : le mot « gelés » est retiré pour ces trois-là) ; **ACo-14, ACo-15 — gelés, pour une mesure
  et non plus pour une décision** (C5 arbitré (a) sous mesure datée, AD-26 §3 ; rév. 7 E19).
  **ACo-9 se rapporte en deux fragments** (F1 autonomie / F2 valeur, rév. 5 E10) : un consommateur à 2500 ms
  donne « **F1 vert / F2 non conforme — défaut de valeur, corrigé par une constante (C6, AD-26)** » — ni
  vert, ni « rouge de rendu ». Aucun AC ne se rapporte vert sur la base d'un `"false"` : l'overlay n'en produit
  aucun (§3.2, E9). Tolérance d'ACo-14 : valeur **observée** sur la surface relayée, pas ± 1 image (E12).
