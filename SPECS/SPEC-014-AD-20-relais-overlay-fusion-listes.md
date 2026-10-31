# AD-20 — Relais de parole vers l'overlay, cadence, et fusion des deux listes de pairs

Régie · 2026-10-31 · arbitrage · répond à **SPEC-013** (T21, desk-design) et s'articule à
**SPEC-012 / AD-19** (canal `lan:speaking-set`, domaine d'id unique) et **AD-17 D3/D4**.
Portée : T22 (plan de diff) et le **feu d'écriture T23**. Aucun code écrit ici.

---

## 1. Les cinq décisions

| # | Sujet | Décision |
|---|---|---|
| **D1** | Relais d'état vers l'overlay (P1 soi / P2 pairs) | **Les deux, dans le même canal et le même feu.** P1 n'est pas une étape séparée : il est **embarqué dans le tableau `speaking[]`** d'AD-19 D1, sous l'id de signalisation de soi. Un seul format, un seul espace d'id. |
| **D2** | Indicateur global « parole non mesurée » | **CONTRE, définitivement.** Pas de clé i18n, pas de bannière supplémentaire. La bannière de liaison et le vumètre local suffisent (§4). |
| **D3** | Deux listes de pairs (`Room.tsx:135-158` et `:160-196`) | **T22 = FUSION, pas suppression.** Une seule liste, union par id, qui porte *à la fois* les attributs `data-peer-*` de la première et le halo/`joinStates`/gain de la seconde. Exécution **dans le feu T23, en premier**, avant le relais (§5). |
| **D4** | Cadence du producteur et anti-clignotement | **Le « ≥ 5 Hz » de R-U8 est refusé** : il casse le budget A2. Transitions seules + **tenue de relâchement 600 ms côté producteur** + garde-vie ≤ 1 Hz seulement si l'ensemble est non vide (§3). |
| **D5** | Vocabulaire de l'overlay avant le relais | Tant que D1 n'est pas livré, l'overlay est **un afficheur de présence**. Aucun texte d'interface, d'infobulle ou de doc ne doit le présenter comme « qui parle » ; `overlay.speaking` n'est **jamais** émis pour `unknown` (SPEC-013 R-U7). |

**Adopté tel quel** : SPEC-013 §2 (R-U1..R-U8) est **normatif**, y compris R-U2 (aucun texte
d'incertitude, justifié par 2,78:1 à 60 %) et la règle « témoin de parole = halo, jamais du texte »
(3,52:1). R-U1 (identité de rendu `unknown`/`false`) est le critère d'acceptation central.

---

## 2. D1 — pourquoi P1 n'est pas une étape séparée

P1 (l'état de soi) et P2 (l'état des pairs) ont la même forme, le même canal et la même surface
d'affichage : les séparer coûterait **un feu d'écriture et une vérification de plus** pour un gain
nul. Ce qui doit être séparé, ce n'est pas le transport, c'est **l'autorité de la mesure** :

- soi → mesure **locale certaine** (`voice.level`, plan média de la fenêtre principale) ;
- pair → mesure **distante** (table `PEER_LEVELS`, AD-19 D2), donc sujette aux péremptions.

Règle : `speaking[]` ne contient **jamais** qu'un id dont la parole est effectivement mesurée à
l'instant du message. L'id de soi est un id de signalisation comme un autre (AD-19 D2) : il entre dans
le même tableau, et l'overlay allume le halo de la ligne dont `participant.id ∈ speaking`. Aucune clé
supplémentaire, aucun second message, aucun drapeau `self: true`.

Conséquence honnête, et c'est l'argument décisif **pour** P1 : dès le premier jour, l'overlay rend un
service **vérifiable de bout en bout** (je me vois parler) sur un producteur dont personne ne peut
contester la mesure ; les pairs s'y ajoutent par le même tuyau, sans nouvelle mécanique d'affichage.
Inversement, livrer P2 seul, c'est parier l'overlay entier sur la seule mesure contestable.

Si P1 devait être bloqué par un cas de bord (soi sans id de signalisation sur un chemin donné), le
feu ne s'arrête pas : P2 part seul, et le blocage est **écrit dans le journal du feu** — pas contourné
par un halo maquillé.

---

## 3. D4 — cadence : le budget A2 tient, et l'anti-clignotement se règle côté producteur

R-U8 demande 5 Hz. À 5 Hz pendant la parole, le canal reçoit **50 messages / 10 s** : c'est quatre
fois le budget A2 (≤ 12 messages / 10 s de parole, ≤ 2 / 10 s de silence). Refusé. La solution ne
demande pas plus de messages, elle demande **un état plus lent à retomber** :

1. **Producteur — transitions seulement.** Un message à l'attaque (0 ms), un à l'extinction.
2. **Producteur — tenue de relâchement `speakingUntil` ≈ 600 ms** (bande admise 500–700 ms) : le
   passage à « ne parle plus » exige 600 ms de niveau sous le seuil **avant** d'être émis. Une pause
   inter-mot (50–200 ms) ou inter-phrase (300–800 ms) ne produit donc **aucune** transition.
3. **Producteur — garde-vie ≤ 1 Hz, uniquement si `speaking[]` est non vide** (inchangé, AD-19 D1) :
   il ne rafraîchit pas la parole, il empêche la péremption de l'ensemble.
4. **Consommateur — plancher de péremption.** Tout état de parole affiché doit être dérivé d'un
   échantillon dont la péremption est **supérieure à l'intervalle entre deux échantillons** ; avec un
   garde-vie à 1 Hz, cela veut dire **≥ 1000 ms**, et l'overlay garde les 2500 ms d'AD-19. La valeur
   `SPEAKING_STALE_MS = 250` **ne peut plus servir à éteindre un halo** : elle doit être portée au
   plancher ci-dessus, ou le halo clignotera à chaque respiration (défaut visible, AC20-3).
5. **Ordre de grandeur à tenir** (parole continue avec 4 pauses naturelles en 10 s) :
   ~2 transitions/pause ⇒ **8 à 10 messages**, plus le garde-vie ⇒ sous la barre des 12. Silence
   complet : 0 message, aucun garde-vie (ensemble vide).

Le coût du choix est un halo qui peut rester allumé **au plus ~1 s** après la dernière syllabe (600 ms
de tenue + 80 ms de transition + marge de péremption). C'est le bon côté de l'erreur : un halo un peu
tardif est une imprécision, un halo qui clignote est un défaut permanent.

---

## 4. D2 — pas d'indicateur global « parole non mesurée »

Trois raisons, dans cet ordre :

1. **Il serait illisible là où il servirait.** C'est le même jeton `text.muted` qui tombe à 2,78:1 à
   60 % d'opacité (SPEC-013 §4) : la seule surface qui a besoin d'expliquer l'absence de mesure est
   précisément celle qui ne peut pas l'écrire.
2. **Il serait permanent et sans fin.** L'état inconnu est l'état **nominal** aujourd'hui ; une
   bannière qui ne s'éteint jamais n'informe plus, elle décore.
3. **Il coûterait une clé i18n pour un bénéfice qui disparaît à la livraison de D1/D4.** La bannière
   de liaison dit déjà ce qui est *actionnable* (« Audio en attente… », « Audio échoué »), et le
   vumètre local dit déjà « l'application m'entend » (R-U6).

Ce que je garde de l'intuition de Maquette : le risque « application cassée » est réel, mais il se
traite **par la vérité sur la liaison**, pas par un aveu global de non-mesure.

---

## 5. D3 — fusion des deux listes : c'est T22, et c'est dans le feu T23

**Motif de la décision** : dès que D1 livre, le doublon devient un **mensonge visible** — deux lignes
par pair, une seule pouvant s'allumer. Il ne peut donc pas être traité « après » ; il passe **avant**
le relais, dans le même feu. Le supprimer *stricto sensu* casserait la vérification : la première
liste porte `data-peer-id`, `data-peer-state`, `data-peer-cause`, `data-peer-stream`, sur lesquels
s'appuient les harnais de Banc.

**Forme de la fusion (à Cadre, dans le plan de diff)** :

- **Une seule `<ul class="participants">`**, une ligne par id (**union** annuaire ∪ `voice.peers`,
  clé = id de signalisation, AD-19 D2), nom = `name ?? peerId` comme aujourd'hui.
- La ligne survivante porte **l'union des informations** : les quatre `data-peer-*` **migrés** depuis
  `:135-158`, plus `data-speaking`, `data-muted`, `data-self`, `.participant__halo`, `.participant__state`
  (`joinStates`), le gain et le `visually-hidden`.
- Les textes de liaison de la première liste (`voice.peer.connecting/noFlow/failed/audio/pending`)
  **descendent dans `joinStates`** : ils restent dus à un pair `unknown` non connecté (SPEC-013
  AC-U5). Aucune clé ajoutée, aucune clé renommée.
- **Aucun halo sur une ligne dédoublée, aucun `<li>` sans halo.**

**Avant de supprimer quoi que ce soit**, Maquette livre **une page** : « contenu à conserver » — la
liste des informations et des textes de `:135-158` qui doivent réapparaître dans la ligne unique, avec
la formulation de `joinStates` correspondante. Sans cette page, Cadre ne fusionne pas (il planifie).

---

## 6. Séquence tenue (inchangée) et critères d'acceptation d'AD-20

`VERIF-023` (en cours, arbre calme, SHA avant/après) → **feu d'écriture T23** → `VERIF-024` unique.

> **AC20-3, AC20-4 et AC20-5 ci-dessous sont REMPLACÉS** par `SPEC-016-AD-21` (AC20-3r/4r/5r, plus
> AC20-7r). AC20-1, AC20-2 et AC20-6 tiennent. Le « plancher de péremption 1000 ms » de D4 (début de
> §3) ne concerne **que** l'expiration de l'overlay : `SPEAKING_STALE_MS` reste à 250 ms.

Ordre interne du feu T23 (un commit par étape, réversible séparément) :

1. **Étape A — fusion des listes** (D3), à information constante : aucun état de parole nouveau.
2. **Étape B — D1** : `speaking[]` alimenté par soi (P1) **et** par les pairs (P2), plancher de
   péremption D4, tenue 600 ms.
3. **Étape C —** extinction du halo / `speakingUntil` (AC-U10) et `overlay.speaking` en a11y.

`VERIF-024` doit vérifier, en plus des AC de SPEC-013 :

- **AC20-1 (P1 bout en bout).** Générateur de niveau de soi synthétique → le halo de **la ligne de
  soi** dans l'overlay passe à `'true'` sur la première image qui suit le franchissement, et retombe
  ≤ 1 s après la dernière syllabe.
- **AC20-2 (silence = silence).** 10 s sans parole : **≤ 2 messages** sur `lan:speaking-set`, et
  `speaking[]` vide.
- **AC20-3 (pas de clignotement).** 10 s de parole avec 4 pauses de 300–800 ms : **≤ 12 messages**,
  et **zéro** passage à `'unknown'`/`'false'` d'un halo pendant ces 10 s (compté sur les mutations
  d'attribut, pas à l'œil).
- **AC20-4 (une seule ligne par pair).** Pour N pairs : **N lignes** portant `data-peer-id` (aucun id
  en double dans le DOM), **N halos**, et les quatre `data-peer-*` présents sur chaque ligne.
- **AC20-5 (pas de clé, pas de texte).** `git diff` des fichiers i18n = 0 ligne ; `grep -ri "non mesur"
  src/` = 0 ; le `textContent` de la ligne overlay `unknown` est le nom seul.
- **AC20-6 (`overlay.speaking` jamais menteur).** Le texte a11y « En train de parler » n'apparaît que
  si `data-speaking === 'true'`, dans les deux langues.

---

## 7. Ce que je ne tranche pas

| Sujet | Qui | Note |
|---|---|---|
| Valeur exacte de la tenue (500–700 ms) | Carillon | 600 ms est la cible ; hors de cette bande, il remonte. |
| Forme du plan de diff (fichiers, ordre, SHA) | Cadre | Plan, zéro écriture, arbre calme jusqu'à la fin de VERIF-023. |
| Contenu à conserver de `:135-158` | Maquette | Une page, pas de code. |
| Pastille muette à 2,73:1 à 60 % | Maquette / Banc | Signalé par SPEC-013 §4 : rien à changer aujourd'hui, candidat si défaut signalé. |

## 8. Journal

- **AD-20** — Réponse à SPEC-013 (T21). D1 : P1 embarqué dans `speaking[]`, un canal, un feu.
  D2 : indicateur global refusé. D3 : fusion des listes, avant le relais, dans le feu T23 (les
  `data-peer-*` migrent, sinon VERIF casse). D4 : « ≥ 5 Hz » refusé au profit de transitions + tenue
  600 ms + garde-vie ≤ 1 Hz + plancher de péremption 1000 ms (budget A2 tenu : ≤ 12 / ≤ 2).
  D5 : l'overlay reste un afficheur de présence jusqu'à D1.
