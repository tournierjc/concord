# SPEC-010 — libellé d'un pair : arbitrage `voice.peer.mute` (T17, AD-16)

Maquette · 2026-10-31 · conception, sans code · réf. **SPEC-008** (échelle à 5 paliers, vocabulaire),
**SPEC-009** (câblage maillage), **AD-16** (4 paliers + cause), T17 (ajout `voice.peer.noFlow` par desk-shell).

Demande traitée : desk-shell signale que `voice.peer.mute` = « Muet — aucun flux audio » est devenu
ambigu depuis AD-16, et que la clé `voice.peer.noFlow` a été ajoutée à mon catalogue.
**Arbitrage rendu, catalogue mis à jour, parité fr = en = 297.**

---

## 1. Le défaut, en une phrase

Dans `Room.tsx`, le palier `connected` portait deux sous-libellés :

| condition | clé | ancien texte |
|---|---|---|
| `state === 'connected' && hasStream` | `voice.peer.audio` | « Audio reçu » |
| `state === 'connected' && !hasStream` | `voice.peer.mute` | « Muet — aucun flux audio » |

Or `connected && !hasStream` est **la fenêtre normale** entre la fin de la connexion ICE et l'arrivée du
premier `MediaStream` (l'attachement se fait sur l'événement `track`, pas sur `connectionState`). Pendant
cette fenêtre, l'écran affirmait deux choses fausses :

1. **« Muet »** — la signalisation ne transporte pas l'état de mute d'un pair (`participant.muted`
   n'est alimenté que pour *self* par `room-bridge`). L'écran ne peut donc pas savoir qu'un pair est muet ;
   il ne doit pas le dire. Règle de SPEC-008 §3 : *on n'affirme jamais un fait qu'on n'a pas reçu*.
2. **« aucun flux »** — vrai à l'instant t, mais c'est désormais le rôle du palier `noFlow` (horloge 5 s),
   qui a son propre libellé. Deux textes pour un même fait, et un troisième état sans texte.

Pire cas : un pair muet (micro coupé) et un pair dont le flux n'est pas encore arrivé s'affichaient
**identiquement**, alors que le premier est normal et durable, le second transitoire.

## 2. Décision

`voice.peer.mute` devient le libellé de la **fenêtre d'attente** (lien ouvert, flux pas encore attaché).
La clé est **conservée** (aucune suppression, aucune casse de `Room.tsx` dans le même lot) ; son **nom**
devient historique et ne doit plus être lu comme « muet ».

| clé | fr | en |
|---|---|---|
| `voice.peer.connecting` | Connexion audio… | Connecting audio… |
| `voice.peer.audio` | Audio reçu | Audio received |
| **`voice.peer.mute`** *(nom historique)* | **Audio en attente…** | **Waiting for audio…** |
| **`voice.peer.noFlow`** *(T17, desk-shell)* | **Pas de flux audio** | **No audio stream** |
| `voice.peer.failed` | Audio échoué | Audio failed |

Pourquoi « Audio en attente… » et pas autre chose :

- **« Flux »** est réservé à `noFlow` (constat d'absence au bout de 5 s) ; **« audio »** est la famille de
  `connecting` / `audio` — la ligne d'état reste dans une seule famille de mots.
- Le libellé est **vrai dans tous les cas** de la fenêtre : rien n'est arrivé, on attend, rien n'est affirmé
  sur le micro du pair.
- Les points de suspension disent « transitoire » ; `noFlow` est sans points de suspension et sans
  adoucissement : la différence se lit à l'œil sans couleur ni icône.
- Longueurs : 17 / 17 car. (fr), 18 / 15 car. (en) → la ligne `participant__state` tient comme avant
  (les anciens textes faisaient 23 / 23 car.) ; aucun des deux libellés n'atteint la limite de 20 car.
  du contrôle #6 de `design/check-i18n.mjs` — ce ne sont pas des libellés de bouton, la règle ne
  s'applique pas, mais cela garantit la tenue sur une ligne étroite.

## 3. Matrice de la ligne d'état d'un pair (état de référence)

Un seul libellé à la fois, dans `.participant__state` ; `speaking` reste décidé par l'interface et
n'ajoute pas de texte (il ne remplace pas le libellé de lien).

| palier mesh | `hasStream` | texte affiché | `data-peer-state` | ton visuel |
|---|---|---|---|---|
| `connecting` | — | Connexion audio… | `connecting` | neutre |
| `connected` | `false` | **Audio en attente…** | `connected` | neutre (pas d'alerte : c'est normal < 5 s) |
| `connected` | `true` | Audio reçu | `connected` | neutre / anneau si `speaking` |
| `noFlow` | — | Pas de flux audio | `noFlow` | attention (jamais rouge bloquant) |
| `failed` | — | Audio échoué | `failed` | erreur + cause si connue |

La cause (`ice` \| `timeout` \| `sink`) reste **exposée en attribut** (`data-peer-cause`) et **n'est pas
écrite en clair** tant qu'aucune clé n'existe : l'écran n'invente pas de phrase de diagnostic. Quand T18
l'affichera, les clés suivantes sont spécifiées d'avance (à ajouter **au moment** de l'affichage, pas
avant — pas de clé morte dans le catalogue) :

| clé proposée | fr | en |
|---|---|---|
| `voice.peer.cause.ice` | Le lien réseau n’a pas abouti | Network link did not complete |
| `voice.peer.cause.timeout` | Aucune réponse du pair | No response from peer |
| `voice.peer.cause.sink` | Lecture audio indisponible | Audio playback unavailable |

## 4. Vocabulaire : qui a le droit de dire « muet »

- **Micro local** : `salle.self_muted` « Votre micro est coupé. », `overlay.muted` « Micro coupé »,
  `control.mute.on/off` « Couper mon micro » / « Réactiver mon micro » — inchangés, c'est le seul endroit
  où « muet / coupé » est un fait connu de l'écran.
- **Pair** : « Muet » (`participant.muted`) n'est légitime que si le flag `muted` du pair provient de la
  présence (donc du pair lui-même). Aujourd'hui `room-bridge` ne renseigne `muted` que pour `self`.
  **Point ouvert pour desk-shell** (hors de mon périmètre, aucune modification faite) : tant que la
  présence ne transporte pas `muted`, `Room.tsx:174` / `Overlay.tsx:72` n'ont rien à afficher pour un
  pair et le libellé « Muet » ne doit apparaître que sur la ligne du participant local.
- Aucun libellé de lien ne contient plus le mot « muet ».

## 5. Ce que j'ai modifié / ce que je n'ai pas touché

Modifié — `design/i18n.json` uniquement, et les deux vues dérivées resynchronisées :

- `voice.peer.mute` : fr « Muet — aucun flux audio » → « Audio en attente… » ; en « Muted — no audio
  stream » → « Waiting for audio… ».
- `voice.peer.noFlow` **conservée** telle que livrée par desk-shell (fr « Pas de flux audio » /
  en « No audio stream »), à la même position, dans les deux langues.
- `design/i18n/fr.json` et `design/i18n/en.json` : régénérés depuis `design/i18n.json` (ils étaient
  restés à **296 clés**, sans `voice.peer.noFlow` → la vue de relecture des chaînes mentait sur le
  catalogue). Ils font désormais 297 clés chacun, ordre des clés identique à `design/i18n.json`.
- Parité : fr = en = **297** clés, mêmes clés des deux côtés.

Non touché : aucun fichier de `src/`, aucun test, aucun `.tsx`, aucune autre clé du catalogue
(`git`-diff attendu : 3 fichiers de design, 3 lignes).

## 6. Critères d'acceptation

1. `design/i18n.json` : 297 clés `fr`, 297 clés `en`, **mêmes clés** (parité stricte) ;
   `voice.peer.noFlow` présente dans les deux langues ; `voice.peer.mute` = « Audio en attente… » /
   « Waiting for audio… ».
2. `design/i18n/fr.json` et `design/i18n/en.json` : 297 clés, contenu **strictement égal** aux vues
   correspondantes de `design/i18n.json` (zéro dérive entre catalogue et vues de relecture).
3. Aucun libellé de lien ne contient « muet » / « muted » (contrôle : `grep -i "muet\|muted"` sur les
   valeurs des clés `voice.peer.*` → 0 résultat).
4. À l'écran, pour un pair `connected` sans flux : « Audio en attente… » — **jamais** la clé brute
   (`voice.peer.mute`), jamais une chaîne vide ; pour un pair `noFlow` : « Pas de flux audio ».
   Les deux textes sont distincts et le restent aux deux langues (test d'écran à faire par desk-qa).
5. Aucun pair `connected`/`noFlow` sans libellé : chaque valeur de `data-peer-state` parmi
   `connecting`/`connected`/`noFlow`/`failed` produit un texte non vide (table de vérité §3).
6. `data-peer-cause` ∈ {`ice`,`timeout`,`sink`,`none`} et **aucun** texte de cause affiché (pas de clé
   → pas de phrase) jusqu'à T18.
7. Le libellé ne porte pas seul l'information : l'état reste lisible sans couleur (texte explicite),
   et tient sur une ligne à 200 px de large (mesure §2) — pas d'ellipsis CSS nécessaire.
8. Aucun ajout de clé non utilisée dans le catalogue (les 3 clés `voice.peer.cause.*` ne sont ajoutées
   qu'au lot qui les affiche).

## 7. Suites proposées (non faites ici — code hors périmètre)

| lot | action | porteur |
|---|---|---|
| T18 | renommer `voice.peer.mute` → `voice.peer.pending` (fr/en identiques) et retirer le nom historique ; à faire en un seul commit avec `Room.tsx` | desk-shell |
| T18 | afficher la cause sous le libellé `failed` et ajouter les 3 clés `voice.peer.cause.*` | desk-shell + maquette |
| T18 | si la présence transporte `muted` pour les pairs : valider « Muet » sur la ligne du pair, sinon retirer `participant.muted` de `Room.tsx:174` et garder l'icône d'overlay pour le local seulement | desk-engine + desk-shell |
| T18 | `data-speaking="false"` est codé en dur dans `Room.tsx:129` : l'indicateur de parole de la liste des pairs (SPEC-002 §4) n'est pas câblé — à couvrir | desk-shell |
