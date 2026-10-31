# SPEC-011 — Tri-état de la parole : `data-speaking`, et ce que devient l'indicateur quand le producteur n'existe pas (T19)

Maquette · 2026-10-31 · conception, sans code · réf. **SPEC-008** (échelle des états de liaison),
**SPEC-009** (câblage maillage), **SPEC-010 / AD-16** (`voice.peer.mute`), **T18** (application §4/§7
par desk-shell), **T19**.

**Demande traitée.** desk-shell annonce avoir appliqué mon audit T18 : `data-speaking="unknown"` sur la
liste de signalisation (`voice.peers`) au lieu d'un `false` affirmatif, `data-muted="unknown"` pour un
pair, libellés « Muet »/« Sourdine » réservés à la ligne locale, séparateur orphelin corrigé. Il signale
en retour deux choses : la présence ne transporte pas `muted`, et **`lan:event:speaking` n'a aucun
producteur**. Cette fiche fait trois choses : (1) elle érige le tri-état en **règle de conception
générale** et non en rustine locale ; (2) elle recense les **surfaces où la règle ne tient pas encore** ;
(3) elle dit ce que l'écran doit faire quand la donnée n'existe pas — et retire en conséquence trois
critères d'acceptation de la recette, plutôt que de les laisser verts par vacuité.

---

## §1 Mesures — code lu, pas supposé (2026-10-31)

| Fait | Preuve | Conséquence design |
|---|---|---|
| **Aucun producteur de parole distante** | `applySpeaking()` défini `src/main/room-bridge.ts:169`, **zéro appelant** (`grep -rn applySpeaking src/`) ⇒ `IPC.eventSpeaking` (`'lan:event:speaking'`) n'est jamais émis | Le halo d'un pair ne peut pas s'allumer, même parfaitement câblé. Aucun écran ne doit prétendre mesurer la parole d'un pair. |
| `ParticipantDto.speaking` est une constante | initialisé `false` (`room-bridge.ts:101`), muté seulement par `applySpeaking` | Un booléen ne sait pas dire « je ne sais pas » : le tri-état ne peut pas venir de ce champ tel quel (§3). |
| **Aucun producteur de présence** | `addParticipant()` **zéro appelant** | La liste de participants ne contient jamais que soi : tout le volet « pair » est non exerçable sur une machine seule (§8, AC-B2). |
| Deux surfaces affirment encore un silence | `Room.tsx:155` (`participant.speaking` sur une ligne de pair **et** sur soi hors `live`), `Overlay.tsx:69` (`data-speaking={participant.speaking ? 'true' : 'false'}`) | §7 de T18 n'est appliqué qu'à `voice.peers`. R-TRI (§2) vaut pour **les trois** surfaces. |
| `data-muted` corrigé sur les deux surfaces | `participant-state.ts` `mutedAttr()`, consommé `Overlay.tsx:70` | ✓ conforme. Reste à décider ce que `selfId` devient quand il est absent (§5). |
| La pastille et le texte de l'overlay lisent encore le booléen brut | `Overlay.tsx:77`, `Overlay.tsx:81` | Inoffensif aujourd'hui (un pair est toujours `false`), **faux dès que la présence portera `muted`** : la pastille s'allumerait sur un pair non mesuré. |
| Un seul chiffre de parole réel dans le produit | `Room.tsx:63` : `voice.status === 'live' && voice.level >= SPEAKING_LEVEL` (niveau du micro local) | La parole **locale** est mesurée ; elle peut donc porter `'true'`/`'false'` honnêtement. C'est la seule. |

---

## §2 Règle R-TRI — sémantique et rendu du tri-état (normatif)

Trois valeurs, jamais deux, sur **toute** surface qui publie un état de parole ou de mute :
`data-speaking` et `data-muted` des lignes de participant, des avatars d'overlay et des pairs de
signalisation.

| Valeur | Signification exacte | Halo / pastille | Libellé visible | Texte a11y |
|---|---|---|---|---|
| `true` | mesure positive (au moins une mesure récente) | oui | oui (« parle », « Muet »…) | oui |
| `false` | **mesure effectuée**, concluant négatif | non | **non** | non |
| `unknown` | **aucune mesure disponible** | non | **non** | non — et surtout **jamais** un texte affirmant le silence |

- **R-TRI-1 — le CSS ne peint que `true`.** `styles.css:362` et `:589` ne réagissent qu'à `'true'` ;
  il est **interdit** d'ajouter une règle pour `'unknown'` ou `'false'`. Vérification : le rendu d'un
  pair `unknown` est **pixel-identique** à celui d'un pair `false`, à 100 % comme à 60 % d'opacité.
- **R-TRI-2 — le silence n'est pas une information.** Aucun libellé, aucune icône, aucun attribut
  `title` pour `false` ou `unknown` : on ne remplit pas une liste de « ne parle pas ».
- **R-TRI-3 — pas de région live sur la parole d'un pair.** `a11y.speaking` / `a11y.speakingSelf`
  existent au catalogue mais ne sont **appelés nulle part** (vérifié) : c'est correct, un lecteur
  d'écran qui annoncerait chaque changement de niveau serait inutilisable. Le tri-état ne doit pas
  introduire de `aria-live` pour compenser.
- **R-TRI-4 — `unknown` n'est pas un état de chargement.** Pas de point de suspension, pas de
  « … », pas de grisé, pas de texte d'attente : l'écran est simplement plus calme. Un `unknown`
  durable (cas actuel) doit se lire comme « rien à signaler », pas comme une panne.
- **R-TRI-5 — la règle est la même pour `data-muted`.** Mute et déafen d'un pair restent `unknown`
  jusqu'à ce que la présence les transporte (SPEC-010) ; côté soi-même ils valent `'true'`/`'false'`,
  et `'unknown'` seulement si l'identité locale n'est pas connue du composant.

---

## §3 Comment le renderer apprend « mesuré » — trois options, une recommandation

Je ne touche ni au contrat IPC ni au bridge : l'option retenue est un arbitrage desk-lead/desk-engine.

- **O1 — mémoire locale des ids mesurés** (aucun changement de contrat). Le renderer retient tout id
  vu au moins une fois dans `onSpeaking` ; un id jamais vu rend `'unknown'`. Coût ≈ 5 lignes,
  falsifiable dans `participant-state.ts`. Suffisant, mais la connaissance vit dans l'UI.
- **O2 — `ParticipantDto.speaking: boolean | null`** (`null` = jamais mesuré). Lecture la plus
  honnête, un seul endroit décide ; touche `ipc-contract.ts` et `room-bridge` (init `null`,
  `applySpeaking` écrit `true`/`false`).
- **O3 — `speakingUntil?: number`** (horodatage de fin). Nécessaire **de toute façon** au moment où le
  producteur arrive : sinon un `true` sans `false` de retour laisse le halo collé indéfiniment.
  À ouvrir en même temps que le producteur, pas avant.

**Recommandation** : O2 maintenant (le moins ambigu, une seule source de vérité), O3 le jour où le
producteur existe. **Repli obligatoire, indépendant de l'option** : tant qu'aucun producteur n'émet,
tout pair rend `'unknown'` — jamais `'false'`. C'est le seul comportement que je demande aujourd'hui.

Helper pur proposé, dans l'esprit de `participant-state.ts` (testable en `node --test`, sans React) :

```
speakingAttr(participant, selfId, measuredIds: ReadonlySet<string>): Tri
  self  → voice.status !== 'live' ? 'unknown' : (selfSpeaking ? 'true' : 'false')
  pair  → measuredIds.has(participant.id) ? (participant.speaking ? 'true' : 'false') : 'unknown'
```

---

## §4 Contrat DOM attendu — les six lignes

| Surface | Sujet | Situation | `data-speaking` | Visible |
|---|---|---|---|---|
| participants | soi | `voice.status === 'live'`, parle | `true` | halo + « parle » |
| participants | soi | `voice.status === 'live'`, muet au niveau | `false` | rien |
| participants | soi | `voice.status !== 'live'` (idle, erreur, PTT fermé) | **`unknown`** | rien |
| participants | pair | producteur absent (aujourd'hui) | **`unknown`** | rien |
| participants | pair | producteur présent, parle | `true` | halo + « parle » |
| participants | pair | producteur présent, silencieux | `false` | rien |
| overlay (`li.overlay__avatar`) | idem, une ligne par avatar, même règle | | | |
| `voice.peers` | pair de signalisation | id non recoupé | `unknown` (fait, T18) | rien |

La troisième ligne est un **défaut réel** aujourd'hui : `Room.tsx:155` retombe sur
`participant.speaking` (= `false`) quand `voice.status !== 'live'`, donc **soi-même apparaît comme
« mesuré silencieux » alors que le micro n'est pas capté** (idle, erreur de périphérique, PTT
relâché avant la première mesure). Hors `'live'`, il n'y a pas de mesure : `'unknown'`.

---

## §5 Mute / déafen — quatre prescriptions

1. **Pastille d'overlay** (`Overlay.tsx:77`) : conditionner à `mutedAttr(participant, selfId) === 'true'`,
   pas à `participant.muted`. Aujourd'hui sans effet visible ; demain, garde-fou.
2. **Texte a11y d'overlay** (`Overlay.tsx:81`) : même condition pour le suffixe « Micro coupé » /
   "Mic muted".
3. **Pas de doublon visible** : dans l'overlay l'information de mute reste **la pastille seule** (pas de
   libellé — la place manque, et un texte dans une pastille de 36 px est illisible à 60 % d'opacité) ;
   dans la liste de participants ce sont les **libellés** (pas de pastille). Deux surfaces, deux
   grammaires, une seule source : `mutedAttr`.
4. **`selfId` absent** (overlay monté avant `room-state`) : `mutedAttr` rend `'unknown'` partout — donc
   pas de pastille, pas de texte. Ne jamais retomber sur « considérer tous les drapeaux comme faux »,
   qui allumerait les libellés au mauvais endroit au retour de l'état.

Le jour où la présence transporte `muted` : `mutedAttr` passe à la valeur réelle pour tous, la pastille
et les libellés s'étendent aux pairs, **aucune clé i18n ne change** (même clé, même place).

---

## §6 Jointure des états (R-JOIN, normatif) — pour mémoire et pour la recette

Éléments possibles d'une ligne : `Muet`, `Sourdine`, puis `parle`. Le séparateur ` · ` est inséré
**entre deux éléments présents** ; jamais en tête, jamais doublé, jamais en fin.

| États vrais | FR rendu | EN rendu |
|---|---|---|
| muet | `Muet` | `Muted` |
| muet + sourdine | `Muet · Sourdine` | `Muted · Deafened` |
| sourdine + parle | `Sourdine · parle` | `Deafened · speaking` |
| parle | `parle` | `speaking` |
| aucun / `unknown` | *(rien, pas même un espace)* | *(idem)* |

Détail de registre maintenu (SPEC-002) : dans la liste, `participant.speaking` = « parle » minuscule,
sans « est » — c'est un attribut de ligne, pas une phrase ; dans l'overlay, `overlay.speaking` reste
« En train de parler » / "Speaking" (phrase courte, hors ligne de texte). Ne pas uniformiser.

---

## §7 i18n — aucune clé nouvelle

Clés concernées, toutes présentes en FR et EN (`design/i18n/fr.json`, `design/i18n/en.json`) :
`participant.speaking` (145), `participant.muted` (143), `participant.deafened` (144),
`overlay.speaking` (20), `overlay.muted` (21), `voice.peer.noFlow` (297) — inchangée, `voice.peer.mute`
inchangée (SPEC-010). `a11y.speaking` / `a11y.speakingSelf` / `a11y.muted` (268-270) restent **au
catalogue, non câblées** : R-TRI-3 interdit de les brancher sur un état de pair.

Le tri-état **n'ajoute aucun texte** : `unknown` ne s'écrit pas à l'écran. Si un jour le besoin d'un
état explicite apparaît (support, diagnostic), la clé serait `participant.unmeasured` — FR « Parole non
mesurée » / EN "Speech not measured" — et **jamais en production** dans la liste de participants.

---

## §8 Critères d'acceptation

### Vérifiables maintenant (sans donnée distante)

- **AC-1** — Plus aucune surface n'écrit `data-speaking` depuis le booléen seul : aucune occurrence de
  `participant.speaking ? 'true' : 'false'` (grep), les trois surfaces passent par le helper (§3).
- **AC-2** — Sur une machine seule : chaque pair rendu porte `data-speaking="unknown"`, et **soi-même
  hors `voice.status === 'live'`** aussi ; `data-speaking="false"` n'apparaît que pour un sujet
  effectivement mesuré.
- **AC-3** — `unknown` invisible : rendu identique à `false` (mêmes captures à 100 % et 60 %
  d'opacité, halo éteint, aucune règle CSS ajoutée pour `unknown`).
- **AC-4** — `data-muted="unknown"` sur chaque pair (participants **et** overlay) ; aucune pastille ni
  libellé « Muet »/« Sourdine » hors de la ligne locale ; overlay sans `selfId` ⇒ aucune pastille.
- **AC-5** — Aucune chaîne d'état ne commence ni ne finit par ` · `, ni ne contient ` ·  · ` (§6).
- **AC-6** — Nom accessible d'un pair **identique** pour `unknown` et `false` (donc : non modifié par
  l'incertitude) — vérifiable à l'arbre d'accessibilité.

### Bloqués — retirés de la recette tant que la donnée n'existe pas

- **AC-B1 — « le halo d'un pair s'allume quand il parle »** : impossible, `lan:event:speaking` n'a
  aucun producteur (`applySpeaking` sans appelant). Non testable, **pas « vert par vacuité »**.
  Propriétaire : desk-engine.
- **AC-B2 — « les pairs apparaissent dans le salon avec leur état de liaison »** : `addParticipant`
  sans appelant ⇒ le volet pair (halo, volume par participant, états ICE, mute) n'est exerçable sur
  aucune machine. Propriétaire : desk-engine / desk-lead.
- **AC-B3 — « mute d'un pair affiché »** : la présence ne transporte pas `muted`. Décision maintenue :
  on l'affiche le jour où la donnée passe, on n'invente pas le champ (ni côté contrat, ni côté écran).

---

## §9 Périmètre, hypothèses, points à arbitrer

- **Je ne code pas** et je ne touche ni à `ipc-contract.ts` ni à `room-bridge.ts` : O1/O2/O3 (§3) sont
  une recommandation, pas une décision d'implémentation.
- **Hypothèse** : l'id de signalisation et l'id de présence sont destinés à coïncider. S'ils divergent
  durablement, le symptôme est un halo qui ne s'allume jamais — pas une erreur visible : c'est
  acceptable (R-TRI-4), mais à savoir avant de chercher un bug ailleurs.
- **Hors de mon périmètre, à arbitrer** : mesurer la parole distante côté renderer (WebAudio sur le
  flux reçu via `onRemoteStream`) ne demanderait aucune modification de la signalisation — mais le flux
  arrive **sans `peerId`** (écart E2), donc l'appariement flux ↔ participant serait fragile. À
  trancher au contrat **avant** d'en faire un producteur de secours ; je ne le prescris pas.

## §10 Récapitulatif actionnable pour desk-shell

1. `Room.tsx:155` — remplacer le repli `participant.speaking` par `speakingAttr(...)` : `'unknown'`
   pour un pair, et `'unknown'` pour soi hors `'live'` (§4, AC-1/AC-2).
2. `Overlay.tsx:69` — `data-speaking` via le même helper, `selfId` déjà en main (§4).
3. `Overlay.tsx:77` et `:81` — conditionner la pastille et le suffixe a11y à
   `mutedAttr(...) === 'true'`, pas à `participant.muted` (§5).
4. Rien à changer sur `voice.peers`, `voice.peer.noFlow` ni `voice.peer.mute` (T18 conforme).

## §11 Fichiers lus pour cette fiche

`src/renderer/Room.tsx`, `src/renderer/Overlay.tsx`, `src/renderer/participant-state.ts`,
`src/renderer/styles.css` (350-395, 580-615), `src/renderer/voice-mesh.ts`,
`src/main/room-bridge.ts`, `src/shell/ipc-contract.ts`, `src/preload/index.ts`,
`design/i18n/fr.json`, `design/i18n/en.json` ; SPEC-008, SPEC-009, SPEC-010, C12.
