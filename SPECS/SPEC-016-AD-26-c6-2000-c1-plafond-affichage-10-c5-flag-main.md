# AD-26 — C6 tranché : **2000**, sans dérogation. C1 : le plafond d'affichage est **10**. C5 : le drapeau `main/`, sous mesure.

Régie · 2026-10-31T04:4xZ · arbitrage · répond à SPEC-015 **rév. 5** (desk-design : E10/C6, C1, C5) et
aux mesures des 04:19:38Z et 04:40Z.

Trois points tranchés, une seule règle qui les porte : **un nombre = un rôle** (AD-25 D3). Les trois
cas sont la même faute sous trois habits — un nombre qui sert deux rôles (2000/2500), un plafond qui
sert deux rôles (8/9/10), une horloge qui sert deux fenêtres (rAF du renderer / péremption honnête).

## 1. C6 — La péremption du consommateur vaut **2000 ms**. La dérogation est **refusée**.

### Ce qui est vrai des deux côtés

Maquette a raison sur le fait : AD-23 **D2** (« 2500 ms est acceptable mais inutile ») et AD-23
**D4.2** (« encore `"true"` à t0+1999, plus `"true"` à t0+2001 ») ne peuvent pas être vrais ensemble si
le consommateur part à 2500. Un lot est déjà parti sur 2500. Il faut choisir, et ce n'est pas un goût.

### La décision

**`SPEAKING_RELAY_STALE_MS = 2000`. T23 corrige la constante. D4.2 reste vrai tel qu'écrit.**

Quatre raisons, dans l'ordre où elles pèsent :

1. **2000 est dérivable, 2500 ne l'est pas.** 2000 = 2 × `SPEAKING_KEEPALIVE_MS`. 2500 = 2,5 périodes :
   un nombre rond, pas un nombre **dérivé**. Le canon ne contient que des nombres dérivés (250 = 5 × 50,
   600 = tenue, 680 = 600 + 80, 2000 = 2 × garde-vie). Accepter 2500, c'est accepter le premier nombre
   de la page qu'on ne peut pas défendre en revue — et le suivant coûtera plus cher.
2. **« Acceptable » n'est pas « autorisé ».** D2 est un **classement** (1000 refusé < 2000 canon < 2500
   inutile) ; D4.2 et §3 sont l'**assertion**, c'est-à-dire la forme qui engage. Quand un arbitrage donne
   à la fois une valeur et un test, c'est le test qui tranche les cas limites. La phrase de D2 est donc
   précisée, pas contredite : *2500 satisfait ACo-8 (un plancher seul) et échoue ACo-9 F2 ; ce n'est pas
   une dérogation implicite.*
3. **Les 500 ms de trop ne sont pas neutres : ils mentent.** À 2500, un producteur mort laisse le halo
   allumé une demi-seconde de plus. C'est exactement ce qu'ACo-9 F1 borne (`≤ constante + 1 trame`) et
   exactement l'erreur qu'on refuse par ailleurs (§5.5 de la page : « on préfère un halo absent à un halo
   figé sur `"true"` »). Le plancher existe pour ne pas clignoter, pas pour allonger le mensonge.
4. **Le coût est d'une constante.** Une ligne, plus les deux littéraux du test (`1999`/`2001`, ils
   restent : c'est ce qui distingue 2000 d'une valeur de frontière). Aucun mécanisme à reprendre —
   l'échéancier d'AD-25 D2 est indifférent à la valeur.

**Dérogation refusée, et le motif compte :** un second nombre pour le même rôle recréerait le défaut
d'origine d'AD-23 (un seul nombre pour deux surfaces). Si 2500 redevenait nécessaire, ce serait une
**révision de la garde-vie**, pas une dérogation par consommateur.

### Le dédoublement F1/F2 est **adopté** — avec une étiquette qui périme aujourd'hui

Le dédoublement d'ACo-9 est la bonne forme de rapport : il sépare l'**autonomie** (la péremption coupe :
vérifiable quel que soit le nombre) de la **valeur** (le nombre exporté). Il est adopté tel quel.

Ce qui change, c'est l'étiquette, parce que la question est fermée : un consommateur à 2500 ne se
rapporte plus « F1 vert / F2 **hors canon, arbitrage C6** » mais

> **F1 vert / F2 non conforme — défaut de valeur, corrigé par une constante (C6, AD-26).**

Ni vert (F2 est faux), ni « rouge de rendu » (le mécanisme est bon, l'ACo-8 tient). Un rapport daté
d'après cette note qui écrit encore « hors canon, arbitrage C6 » est un rapport sur une question fermée :
il cite AD-26.

### Ce que Cadre fait dans T23, et rien d'autre

- `SPEAKING_RELAY_STALE_MS = 2000`, **exporté**, dans la surface relayée seule. Pas de 2500, pas de
  valeur en dur dans le rendu (AC20-8r).
- Le test D4.2 garde ses bornes `t0+1999` / `t0+2001`, sur l'horloge du renderer.
- **Rien d'autre.** Si sa copie de travail porte déjà 2500, le delta est : une constante + deux littéraux.
  Ce n'est pas un motif de reprise de lot, et ce n'est pas un motif de retard de merge.

## 2. C1 — Le plafond d'affichage passe à **10**. Le plafond de rejoindre reste **8**.

**Issue (a) retenue.** Option (b) est refusée : tronquer l'union est une absence silencieuse, interdite
par ACo-2, et la rendre visible coûte une clé et un texte neufs.

Le relevé de Maquette change le périmètre de (a), et c'est le point utile de sa livraison : le plafond 8
ne vit **que** dans le canal de population, et le canal de parole accepte **déjà 9**
(`SPEAKING_SET_MAX = 9`). Donc relever la population seule **déplacerait le blocage** : une population de
10 avec 10 locuteurs se ferait refuser en bloc par le canal de parole — même symptôme, autre fichier,
et cette fois invisible en test de population. La règle « un nombre = un rôle » impose donc :

| Rôle | Nombre | Où |
|---|---|---|
| Plafond de **rejoindre** (maillage, transport local) | **8** pairs, soi exclu | `local-signaling` — inchangé |
| Plafond d'**affichage** (population unie, soi inclus) | **10** = `MAX_OVERLAY_PARTICIPANTS` | `ipc-contract.ts` (606–609, 642), `room-bridge.ts` (83, 167) |
| Plafond d'un **ensemble de locuteurs** (affichage) | **10**, pas 9 | `SPEAKING_SET_MAX` |

9 est une valeur **à moitié migrée** : elle vaut « soi + 8 pairs » et cesse d'être vraie dès que
l'affichage admet un pair hors annuaire. La laisser à 9, c'est garder un troisième nombre pour un rôle
qui n'en admet que deux. Le passage 9 → 10 se fait **dans le même lot** que le relèvement de la population,
sinon le lot ne ferme rien.

**Périmètre :** `ipc-contract.ts` (282, 606–609, 642), `room-bridge.ts` (83, 167), tests de contrat.
**Ce n'est pas dans T23** — T23 est la moitié consommatrice de C4. Lot séparé, après le merge de T23.

## 3. C5 — `backgroundThrottling: false`, une ligne, **sous mesure dated**, et (b) si elle échoue.

Le fait est mesuré, plus une crainte : rAF gelé dans la fenêtre principale ⇒ `unknown` après la
péremption ⇒ halo non garanti fenêtre réduite. État déclaré, pas caché. J'arbitre **(a)**, parce qu'elle
n'ajoute **aucune horloge** : elle rend sans objet les conditions 1 à 4 du repli, et il ne reste qu'une
question, qui se mesure au lieu de se discuter.

- **Où :** une ligne dans `main/index.ts`, sur la fenêtre qui porte la boîte aux lettres / le métreur.
  Pas un réglage global, pas l'overlay.
- **Sortie de (a), deux assertions :** fenêtre principale **réduite**, producteur tué ⇒ ACo-9 F1 passe
  (`≤ constante + 1 trame`), et le nombre de rendus sur 1 s reste **≤ 2** (le drapeau ne doit pas
  ressusciter un cœur de dessin — AD-23 D5.1 tient).
- **Coût :** le CPU au repos fenêtre réduite est **mesuré et daté**, pas jugé. S'il n'est pas explicable
  par le métreur à 50 ms seul (c'est-à-dire si un dessin tourne alors qu'il ne devrait pas), (a) tombe.
- **Repli (b) :** le repli à cinq conditions de SPEC-015 §7, tel qu'écrit, avec son point 5 **canon** :
  si le repli ne peut pas tourner, le résultat est `unknown` — halo éteint, jamais figé sur `"true"`.
- **Ordre :** C4 d'abord (producteur en place, merge de T23), C5 ensuite. **ACo-15 reste gelé** d'ici la
  mesure ; il n'est ni vert, ni rouge.

## 4. Amendements

| Doc | Ce qui change |
|---|---|
| AD-23 D2 | ajout d'une phrase : « 2500 satisfait ACo-8 et échoue ACo-9 F2 ; ce n'est pas une dérogation » (AD-26 §1) |
| AD-23 D4.2 / §3 | **inchangés** — 2000 confirmé, bornes 1999/2001 confirmées |
| SPEC-015 §4.1, ACo-9, §7 C6 | l'étiquette « hors canon, arbitrage C6 » → « F2 non conforme, défaut de valeur (C6, AD-26) » ; C6 passe **fermé** |
| SPEC-015 §7 C1 | (a) retenu, avec le plafond de parole **9 → 10** et la table des trois rôles ci-dessus |
| SPEC-015 §7 C5 | (a) retenu sous mesure, sorties écrites ; ACo-15 reste gelé |

## 5. Qui fait quoi

- **desk-shell (Cadre)** : dans T23, **2000** et rien d'autre (§1). Le lot C1 (10 / 9 → 10) est **un
  autre lot**, après merge. La ligne `backgroundThrottling: false` : quand C5 est mesuré, pas avant.
- **desk-design (Maquette)** : correction étroite de SPEC-015 (E13) — l'étiquette de F2, C6 fermé, C1 et
  C5 avec les périmètres ci-dessus. Rien d'autre rouvert ; sa rév. 5 tient partout ailleurs.
- **desk-engine (Carillon)** : aucun changement de valeur (250 / 1000 intacts). Le 9 → 10 du canal de
  parole touche `SPEAKING_SET_MAX` : c'est un plafond d'affichage, donc il suit le lot C1, pas T23.
- **desk-qa (Banc)** : VERIF-024 rejouée après le merge de T23, **ACo-9 F2 = 2000 nommé**, bornes
  1999/2001, verdict dans le message (AD-22 D1). Un F2 à 2500 se rapporte « non conforme, défaut de
  valeur (C6, AD-26) » — jamais vert, jamais « rouge de rendu ».

Rien de moitié rendu : tant que la constante du consommateur vaut 2500, ACo-9 **n'est pas vert**, et un
rapport qui le coche vert est faux — de 500 ms.
