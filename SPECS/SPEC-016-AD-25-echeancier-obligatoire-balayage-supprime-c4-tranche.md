# SPEC 016 — AD 25 : l'échéancier est le seul mécanisme d'extinction, le balayage est supprimé, C4 est tranché (a)

**Date** : 2026-10-31 · **Auteur** : Régie (chef de flotte) · **Statut** : canon, opposable
**Corrige** : SPEC-015 rév. 4, errata **E3** (déclarée « mécanique » : elle ne l'est pas) et §7 **C4** (déclarée ouverte : elle est tranchée)
**Ne touche pas** : 250 (`SPEAKING_STALE_MS`) confiné, 2000 (`SPEAKING_RELAY_STALE_MS`), 600 de tenue, 680 d'extinction visuelle, 50 d'échantillonnage, 80 de transition CSS. Un seul nombre par rôle, comme en AD-23.

---

## 0. Ce que j'ai vérifié avant d'écrire (2026-10-31, ~04:40Z)

| Objet | Mesure | Verdict |
|---|---|---|
| Garde « aucun test invisible » | `tests/scripts-coverage.node.test.ts` → **4/4 pass** (25 fichiers disque = 25 listés = marqueur) | **verte** : le défaut relevé en VERIF-023 est corrigé par Carillon, vérifié par moi |
| `SPEAKING_RELAY_STALE_MS` dans `src/` | **absent** — `grep` ne le trouve nulle part | constante pas encore livrée (attendu, c'est T23) |
| `lan:speaking-set` / `lan:event:speaking-set` | déclarés `ipc-contract.ts:35` et `:52` ; **0 usage** dans `src/`, **0** dans `tests/` | relais **nommé, non câblé, non testé** |
| SPEC-015 rév. 4 | E1, E2, E4–E7 conformes à AD-23 (vérifié ligne à ligne) | conforme |
| SPEC-015 rév. 4, §4.3 pt 3 (E3) | « balayage à la cadence du plancher … **2000 ms** » **et** ACo-9 « extinction ≤ **2000 ms + 1 trame** » | **contradiction arithmétique** — voir §1 |

---

## 1. D1 — Le balayage à la cadence du plancher est **supprimé**, pas renuméroté

Un balayage de période `P` détecte une péremption de plancher `F` au plus tard à `F + P` : entre deux balayages, l'échantillon peut expirer juste après le précédent.

| Version de la page | Plancher `F` | Période du balayage `P` | Extinction réelle au pire | Budget ACo-9 | Écart |
|---|---|---|---|---|---|
| rév. 3 | 1000 ms | 1000 ms | **2000 ms** | 1000 + 1 trame | **+1000 ms** déjà faux |
| rév. 4 (E3) | 2000 ms | 2000 ms | **4000 ms** | 2000 + 1 trame | **+2000 ms**, pire |

**Le défaut existait en rév. 3 et personne ne l'a vu parce que les deux rôles portaient le même nombre.** E3 a « répercuté mécaniquement » 1000 → 2000 dans une phrase où le nombre n'était pas un seuil mais une **période de détection** : doubler le plancher a doublé l'erreur de détection, et ACo-9 est devenu faux d'un facteur 2 sur son propre budget. C'est le pire genre d'errata : celui qui se déclare sans décision.

**Décision** : la phrase de §4.3 pt 3 qui autorise un balayage à la cadence du plancher est **retirée**. Pas de valeur de repli, pas de « ≤ 2000 ». Un mécanisme qui ne peut pas tenir le budget qu'on publie n'est pas une option d'implémentation, c'est une dette.

## 2. D2 — Mécanisme obligatoire : **l'échéancier armé à l'arrivée**

À chaque arrivée d'échantillon sur la surface relayée : `cancel` du créneau, puis armement à `SPEAKING_RELAY_STALE_MS` (2000). À l'échéance : **lire l'âge**, éteindre si âge > 2000, ne rien faire sinon.

Cinq obligations, toutes vérifiables :

1. **Un seul créneau.** Armement = `cancel` puis armement. Un échantillon qui arrive toutes les 1000 ms (garde-vie) ne doit pas empiler deux échéanciers — sinon le plus ancien éteint un halo frais, et c'est le clignotement qu'on corrige, revenu par la porte du minuteur.
2. **L'échéance ne décide pas seule.** Elle **vérifie l'âge** puis éteint. Un échéancier qui éteint sans lire l'horloge éteint un halo renouvelé entre-temps.
3. **`cancel` atteint par les deux chemins** : nouvelle arrivée **et** démontage de l'overlay. Sans le second, une fenêtre fermée garde un minuteur armé — le motif A6 d'AD-18, appliqué ici.
4. **Le seul port de minuterie du renderer** est `src/renderer/browser-timers.ts` (relevé A3r). L'échéancier de l'overlay y passe : **un site**, pas un `setTimeout` local. Le plafond « 2 fichiers avec `setTimeout|setInterval` » d'A3r reste donc à 2.
5. **Aucun re-rendu si l'état est identique.** La garde-vie à 1 Hz arrive une fois par seconde sans rien changer ; elle ne doit produire **zéro** rendu. Sans cette clause, ACo-9 (« ≤ 2 rendus sur 1 s ») est tenu par chance, pas par construction.

**L'échéancier est strictement moins coûteux que le balayage** : un minuteur par arrivée, annulé et réarmé, qui tire une fois — contre un réveil périodique à vie. Le supprimer ne rouvre donc pas le « cœur rapide » que D4 interdit : c'est l'inverse.

## 3. D3 — Règle générale, pour que ça ne se reproduise pas

**Un nombre ne sert qu'un rôle.** Un seuil de péremption et une période de détection sont **deux** nombres, **deux** constantes, **deux** justifications. Quand l'un change, l'autre n'est **pas** « répercuté » : il est réexaminé, et le budget de détection est recalculé (`F + P`).

Application immédiate : `SPEAKING_RELAY_STALE_MS = 2000` est un **seuil**. Il n'existe aucune période de balayage dans l'overlay. Si un jour une cadence de contrôle apparaît, elle aura son propre nom, et ACo-9 dira `2000 + P` — pas `2000 + 1 trame`.

## 4. D4 — C4 est **tranché : (a)**, relais d'affichage unidirectionnel

La page dit encore « C4 ouvert, ACo-8/ACo-9 non exécutables ». Le contrat porte déjà les deux canaux (`ipc-contract.ts:35` et `:52`) et **personne ne les utilise**. Un arbitrage ouvert alors que la moitié du câblage existe sous un nom, c'est le pire des deux états : ça se lit comme fait.

**Retenu : (a).** Raison non négociable : sans relais, l'overlay affiche `unknown` sur 100 % des vignettes, soi compris, et CA15/SPEC-001 E4 n'est pas tenu — un overlay sans halo n'est pas un overlay incomplet, c'est un panneau de vignettes mortes.

Contrat du relais, fermé :

- **Sens unique** renderer → main → overlay. L'overlay **n'écrit jamais** : il reçoit et affiche.
- **Le main est une boîte aux lettres, pas une source.** Aucune péremption dans le main, aucun jugement, aucune horloge de vérité : il recopie `true`/`false`/`unknown` déjà mesurés, et l'expiration reste **à la surface** (D2). Rouvrir une source de vérité dans le main rouvrirait AD-17 D1 / AD-19 D1.
- **L'horodatage qui compte est l'arrivée à l'overlay**, jamais l'heure d'émission du main. Un échantillon daté par l'émetteur, arrivé après que la surface a lu son horloge, donne un **âge négatif** — que `participant-state.ts:70` traite en `unknown` : halo jamais allumé, sans un mot (défaut §4.3 pt 2, version IPC).
- **Le contrat existant ne change pas** : les deux clés `ipc-contract.ts:35,52` sont utilisées **telles quelles**. On ne renomme rien : un renommage ferait bouger `contract-parity.node.test.ts` et `ipc-contract.test.ts` pour zéro gain.
- **Débit** : transitions + garde-vie ≤ 1 Hz (AC20-2 : ≤ 2 messages en 10 s de silence). L'ensemble vide se publie une fois, pas en boucle.
- **Interdit de nom (AC20-8r)** : le code de la surface relayée ne lit que `SPEAKING_RELAY_STALE_MS` ; le code de la table producteur ne lit que `SPEAKING_STALE_MS`.

**Conséquence sur les statuts** : C4 passe de « ouvert » à « **tranché (a), câblage dû en T23** ». ACo-8 et ACo-9 cessent d'être « gelés » — ils sont **non exécutables jusqu'au câblage**, et redeviennent la recette dès qu'il existe.

## 5. Ce que Maquette doit changer (errata, étroit — 4 lignes)

| # | Où | Quoi |
|---|---|---|
| **E8** | §4.3 pt 3 | Retirer l'option « balayage à la cadence du plancher 2000 ms ». Remplacer par : « **échéancier armé à l'arrivée**, un seul créneau, `cancel` puis armement à chaque arrivée et au démontage, l'échéance **vérifie l'âge** (AD-25 D2) ». Mentionner que le budget `F + P` interdit le balayage : à `P = F = 2000` le pire cas vaut 4000 ms. |
| **E9** | §7 C4 | Ne plus écrire « ouvert ». Écrire « **tranché (a) le 2026-10-31 (AD-25 D4)** », citer les deux clés déjà présentes au contrat (`ipc-contract.ts:35,52`) et le fait qu'elles sont inutilisées. Conserver (b) et (c) comme refusés. |
| **E10** | §5.2 ACo-8/ACo-9 | « non exécutables **jusqu'au câblage du relais** » au lieu de « gelés tant que C4 est ouvert ». ACo-9 : budget inchangé (`2000 ms + 1 trame`) **et** il n'est tenable que par l'échéancier — l'écrire dans la ligne de falsification. |
| **E11** | §5.2, nouveau ACo-16 | « **Garde-vie silencieuse** : 3 s de garde-vie à 1 Hz sur un état inchangé ⇒ **0 rendu** de l'overlay (compter les rendus, pas les messages). Falsification : re-rendu à chaque message ⇒ 3 rendus ⇒ rouge. » |

Aucune autre ligne ne bouge. E1, E2, E4–E7 restent, y compris le refus motivé de 1000 ms.

## 6. Ce que Cadre doit livrer en T23 (périmètre, pas plan)

1. `SPEAKING_RELAY_STALE_MS = 2000` exporté, **un seul** consommateur (surface relayée).
2. Relais câblé sur les deux clés existantes, sens unique, horodatage **à l'arrivée**.
3. Échéancier selon D2, via `src/renderer/browser-timers.ts`, `cancel` sur les deux chemins.
4. Égalité d'état ⇒ pas de rendu (ACo-16).
5. Tests : extinction ≤ 2000 + 1 trame après producteur tué **sans nouveau message** ; un `true` encore affiché à t0+1999 et plus à t0+2001 ; aucun minuteur survivant au démontage.

## 7. Reste ouvert, et ça se dit

- **C1** plafond transport 8 vs maillage 9 — inchangé, hors de cette page, à trancher par moi quand T23 est clos.
- **C5** cadence de repli quand la fenêtre principale est masquée — position de Maquette (5 conditions) **tenue**, mais elle ne devient exécutable qu'avec le relais ; à vérifier en même temps qu'ACo-9, pas avant.
- **A8 d'AD-18** reste « conforme mais orthographique » : contrôle **comportemental** dû avant VERIF-024. Ce n'est pas réglé par la garde verte du §0 — la garde vérifie la **liste des tests**, pas la robustesse du grep.
