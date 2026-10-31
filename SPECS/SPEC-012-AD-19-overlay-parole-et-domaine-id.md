# SPEC-012 · AD 19 — le halo de l'overlay, et le domaine d'id de `PEER_LEVELS`

Arbitrage de Régie, 2026-10-31. Répond à la question posée par Cadre à la livraison de T20.
S'appuie sur SPEC-001 E4/CA15, SPEC-011 (AD-17 D1/D5/D6), SPEC-012 (AD-18).

---

## Le problème, en deux phrases

T20 a fait passer les deux listes de la fenêtre principale par une porte unique (`peerSpeaking`),
mais l'**overlay est un autre renderer** : pas de plan média, pas de flux, donc `unknown` pour tout
le monde et un halo (E4/CA15) qui ne peut **structurellement jamais** s'allumer. Par ailleurs la
table `PEER_LEVELS` est indexée par un id dont personne n'a encore écrit la règle ; un remplissage
sous un autre espace d'id donne `unknown` partout **sans lever une seule erreur**.

---

## D1 — Le halo de l'overlay s'allume : un relais de transitions, agrégé, borné

**Décision : on relaie.** On ne documente pas « l'overlay n'affiche pas la parole » : E4/CA15 est une
promesse de spec, et une fonctionnalité affichée qui ne peut rien afficher est une fonctionnalité
absente tout en occupant l'écran — c'est exactement ce que la règle « rien de moitié rendu » refuse.

Le canal retiré par AD-17 D1 (`lan:event:speaking`, `SpeakingEventDto`) était un canal **sans
producteur** ; il n'était pas la forme à conserver. On ne le restaure pas. On ajoute autre chose, et
la différence est mesurable :

| | Ancien `lan:event:speaking` (retiré) | `lan:speaking-set` (AD-19 D1) |
|---|---|---|
| Fréquence | par événement de niveau | **sur changement d'ensemble** + 1 Hz **seulement si l'ensemble est non vide** |
| Charge utile | événement par pair | **un seul message : la liste des id qui parlent** |
| Débit max | ~20 Hz × N pairs | **≤ 1 msg/s**, taille = nombre de parleurs |
| Vérité | niveau (nombre) | **état dérivé** (booléen, verdict de `speakingFromLevel`, D5) |

Règles de forme, non négociables :

1. **Contenu = un ensemble d'id, rien d'autre.** `{ speaking: string[] }`. Aucun niveau, aucun
   flottant, aucun horodatage, aucune durée de parole. Le récepteur ne rejuge pas le son : il applique.
2. **Émission sur changement d'ensemble** (membre ajouté ou retiré), plus **un battement à 1 Hz tant
   que l'ensemble est non vide** — ce battement est la seule chose qui empêche un halo bloqué si un
   message se perd ; il n'est pas émis quand personne ne parle (débit de repos = 0).
3. **Remplacement complet, pas un delta.** L'overlay remplace son ensemble entier à chaque message :
   pas d'état à réconcilier, pas de fuite d'entrée périmée.
4. **Péremption de sûreté 2500 ms** côté overlay : sans message depuis 2,5 s, tout repasse à
   `unknown` (et non à `false`). Une fenêtre morte ne laisse donc jamais un halo allumé.
5. **`unknown` reste `unknown`.** L'overlay n'affiche jamais « parle » ni « ne parle pas » pour un
   pair dont il n'a pas reçu d'état. L'attribut `data-speaking` garde la valeur `unknown`.
6. Le soi-même suit la même règle (présent dans l'ensemble quand `speakingFromLevel` le dit), donc
   `selfSpeakingAttr` s'applique à l'overlay comme à la fenêtre principale.

Ce que ça coûte : un canal IPC de plus, ≤ 1 msg/s, alimenté par le renderer **principal** (seul à
avoir un plan média), relayé par le main, consommé par l'overlay. Ce n'est pas une seconde source de
vérité — c'est la même, transportée.

**Conséquence de séquencement :** D1 d'AD-19 (ce relais) se fait **avec** D1/D2 d'AD-17 dans le même
passage, pour ne pas laisser la fenêtre principale sans producteur d'état de parole à aucun instant.

---

## D2 — Un seul espace d'id : l'id de signalisation

**Décision :** `PEER_LEVELS` est indexée par l'**id de signalisation du maillage**, c'est-à-dire
exactement la valeur qui sert à recouper un participant dans le maillage et à remplir
`ParticipantDto.id`. Un seul espace d'id dans toute l'application ; toute conversion se fait à la
frontière, dans le moteur, jamais dans le rendu.

Corollaires, tous vérifiables :

- **Écriture** : le moteur écrit la table sous l'id de signalisation, et sous aucun autre (pas
  d'index de `RTCPeerConnection`, pas d'id de socket, pas d'index de tableau).
- **Lecture** : le rendu lit `participant.id`, valeur identique par construction. Aucun préfixe, aucun
  hachage, aucune normalisation de casse entre l'écriture et la lecture.
- **Écriture orpheline** : un id inconnu du maillage est **ignoré** (pas de ligne fantôme créée), et
  ça se voit dans un test — pas dans le silence.
- **Test d'étanchéité** : un échantillon écrit pour le pair A ne modifie jamais l'état du pair B.
  (Le test existe ; on y ajoute l'assertion d'espace d'id si elle n'y est pas.)

---

## Critères d'acceptation (mesurables, par qui)

| # | Critère | Mesuré par |
|---|---|---|
| A1 | Deux renderers distincts : la fenêtre principale publie `lan:speaking-set`, l'overlay le consomme ; aucun autre producteur. | Cadre (test d'IPC-contrat) |
| A2 | Débit mesuré : sur 10 s de parole continue d'un pair, **≤ 12 messages** émis (1 transition + 10 battements). Sur 10 s de silence après, **≤ 2 messages**. | Cadre (compteur dans le test) |
| A3 | Aucune charge utile ne contient de niveau : le DTO ne porte que `speaking: string[]` (test de forme). | Cadre |
| A4 | Overlay : ensemble vide → `unknown` ; id présent → `true` ; id retiré → `false` ou `unknown` selon le cas ; **aucun message pendant 2,5 s → `unknown`**. | Cadre (test du module) |
| A5 | Un pair qui parle fait basculer `data-speaking` dans l'overlay, de bout en bout (test d'intégration renderer, pas seulement unitaire). | Cadre + Banc |
| A6 | `PEER_LEVELS.set` avec un id hors maillage : aucune ligne créée, aucun état rendu. | Carillon |
| A7 | Étanchéité des id : un échantillon du pair A ne touche pas B. | Banc (mutant : décaler la clé d'un cran doit rougir ce test) |
| A8 | Arbre stable pendant la mesure : empreintes SHA-256 avant/après identiques. | Banc |

## Qui fait quoi

- **Cadre** : AD-17 D1+D2 (retrait `SpeakingEventDto`, `IPC.eventSpeaking`, `applySpeaking`,
  `onSpeaking`, `ParticipantDto.speaking`, tests ipc-contract) **et** AD-19 D1 (canal
  `lan:speaking-set` : producteur dans la fenêtre principale, relais main, consommateur overlay,
  péremption 2500 ms), **et** le branchement de `voice.ts` (`PEER_LEVELS.set` alimenté par
  `speakingFromLevel`). Zéro ligne de rendu à réécrire pour la fenêtre principale.
- **Carillon** : écrit la table sous l'id de signalisation (D2) ; ne change pas la forme du canal.
- **Banc** : VERIF-024, une seule mesure, sur arbre calme (A5, A6, A7, A8 + `npm test` daté).

## Règle de séquencement (rappel, payée deux fois déjà)

Aucune mesure sur arbre en vol. VERIF-023 mesure la clôture d'AD-18 **avant** que Cadre n'écrive
AD-19/AD-17-D1D2 ; VERIF-024 mesure AD-19 quand Cadre a fini. Une mesure prise pendant qu'un autre
édite est une mesure jetée — et une mesure jetée coûte plus cher qu'une mesure retardée.
