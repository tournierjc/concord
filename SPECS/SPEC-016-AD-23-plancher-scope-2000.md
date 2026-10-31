# AD-23 — Le plancher de 250 ms n'est pas remplacé : il est scopé. Le rendu relayé a son propre plancher : 2000 ms, et pas 1000.

Régie · 2026-10-31T03:2xZ · arbitrage · répond à SPEC-015 **rév. 3** (desk-design, étape B de la page
overlay) qui tranche un point d'ouverture de desk-engine.

**Objet du litige.** SPEC-015 rév. 3 §4.1 écrit que `SPEAKING_STALE_MS = 250` est « ce qu'on remplace »
par un « plancher de péremption ≥ 1000 ms » valable pour « le rendu (overlay **et** salon) », au motif
qu'à 250 ms le halo clignote à chaque respiration. Le motif est **juste**. Le remède est **faux sur
deux points** : il supprime un plancher qui protège d'autre chose, et il choisit 1000 ms qui vaut
exactement une période de garde-vie. AD-21 §3 avait déjà tranché la moitié de la question
(plancher par surface, ≥ 2000 ms pour la surface relayée) ; cette note fixe l'ensemble et **amende
SPEC-015 rév. 3 §4.1** en conséquence.

## 1. Les faits mesurés (03:15Z, arbre = empreintes de AD-22 §D2)

| Fait | Mesure | Où |
|---|---|---|
| Cadence de la table locale | `SAMPLE_PERIOD_MS` = **50 ms** (20 Hz), local, **aucun message** | `src/renderer/voice.ts:336` |
| Garde-vie du canal | `SPEAKING_KEEPALIVE_MS` = **1000 ms** (1 Hz exactement) | `src/renderer/speaking-relay.ts:31` |
| Tenue de relâchement | **600 ms**, un seul étage ; la cascade 600+600 = 1200 ms a été mesurée **et refusée** | `src/renderer/speaking-relay.ts:19-22` |
| Péremption partagée | `SPEAKING_STALE_MS` = **250 ms** | `src/renderer/participant-state.ts` |
| Consommateur du rendu relayé | `peerSpeaking(id, PEER_LEVELS, clock)` — `PEER_LEVELS` vide dans l'overlay aujourd'hui, donc tout est `unknown` | `src/renderer/Overlay.tsx:75` |

## 2. Décisions

### D1 — `SPEAKING_STALE_MS = 250` ne bouge pas : il est **scopé**

Domaine : la **table producteur** (`peer-speech` → `PEER_LEVELS` → `Room.tsx`), cadence 50 ms, aucun
message. Là, 250 ms = 5 échantillons : ça ne protège que d'un **producteur mort**, et c'est exactement
ce qu'on lui demande. Le passer à 1000 ms affaiblirait cette garde d'un facteur 4 sans rien régler.

La phrase de SPEC-015 rév. 3 §4.1 (« l'actuel `SPEAKING_STALE_MS = 250` est ce qu'on remplace ») est
**annulée**. Formulation canon : *250 n'est pas remplacé, il est confiné à la table producteur.*

### D2 — La surface relayée a son propre plancher, nommé, **2000 ms**

Nouvelle constante, exportée, par surface :

```
SPEAKING_RELAY_STALE_MS = 2000   // surface dont la seule entrée est lan:speaking-set
```

Dérivation, pas goût : la garde-vie est à **1000 ms exactement**. Un plancher égal à une période
expire **sur la frontière** — une gigue d'IPC, une trame de rendu, un message de 1 ms de retard et le
halo retombe : c'est le clignotement qu'on corrige, déplacé d'un cran. Il faut **au moins deux
périodes**. 2000 ms est donc le plancher, et c'est déjà le nombre de AC20-7r(b) : une seule valeur,
pas deux.

**1000 ms est refusé** (frontière) ; 2500 ms est acceptable mais inutile (il ne protège de rien de plus
et retarde l'affichage honnête d'un producteur mort). 2000 ms = canon.

### D3 — Le salon ne prend **pas** cette constante

`Room.tsx` lit la table locale à 50 ms dans le même renderer : c'est le producteur A, pas la surface
relayée. AC20-7r(c) tient. La ligne de SPEC-015 rév. 3 §4.1 « rendu (overlay **et** salon) » est
**fausse** : elle devient **deux lignes**, table producteur (250) et surface relayée (2000).
Un seul nombre pour les deux est précisément le défaut d'origine.

### D4 — Ce qui est asserté, et par quel test

1. `SPEAKING_RELAY_STALE_MS` est exporté et vérifié `≥ 2 × SPEAKING_KEEPALIVE_MS` **et** `> SPEAKING_STALE_MS`.
2. Test à horloge simulée, sur la surface relayée : publication `['p1']` à t0, garde-vie identique à
   t0+1000, puis plus rien. Assertions : la surface est encore `'true'` à **t0+1999**, et n'est plus
   `'true'` à **t0+2001**. Avec un plancher de 1000 ms ce test tombe à t0+1000 — c'est sa raison d'être.
3. AC20-8r (nouveau, garde de constante) : les deux valeurs sont assertées **par nom** ; toute
   modification de l'une fait échouer la suite en nommant la constante.
4. Interdit de nom : aucun code de rendu ne lit `SPEAKING_STALE_MS` pour juger un message relayé, et
   aucun code de table ne lit `SPEAKING_RELAY_STALE_MS`. `grep` des deux noms, chemins attendus
   documentés dans le test.

### D5 — Les deux autres arbitrages de Maquette sont **acceptés**

1. **« Pas de cœur à 5 Hz »** est scopé au **rendu**, pas au métreur : aucune boucle qui *dessine* ;
   un battement qui *mesure* (20 Hz, local, rien de publié) est autorisé. Correctif accepté : sans lui
   la page interdisait le code que desk-engine venait de livrer.
2. **Ancre de l'attaque** = dernière trame **mesurée** au-dessus du seuil, pas `vad.speaking`
   (l'hystérésis aurait coûté 100 ms). Contrat visuel retenu : **attaque 0 ms**, **extinction 680 ms**
   (600 de tenue + 80 d'une trame), et **1200 ms refusé** (cascade de deux tenues). C'est cohérent avec
   `speaking-relay.ts:19-22` et avec ACo-14 : une page à 900 ms est un défaut d'ancre, pas un choix.

## 3. Amendements (à appliquer, pas à discuter)

| Doc | Ce qui change |
|---|---|
| SPEC-015 §4.1 | « on remplace 250 » → « 250 est confiné à la table » ; une ligne → deux (250 / 2000) ; « ≥ 1000 ms » → « **2000 ms** » + dérivation 2 × garde-vie |
| SPEC-015 ACo-9 | plancher mesuré = **2000 ms** (producteur tué ⇒ extinction ≤ 2000 + 1 trame, jamais de re-rendu rapide) |
| SPEC-015 ACo-8 | inchangé sur le fond (0 aller-retour de clignotement) — c'est 2000 ms qui le rend vrai |
| SPEC-015 ACo-14 | confirmé : 680 ms ± 1 trame |
| AD-21 §3 | confirmé, avec la précision : « plancher par surface ≥ 2000 » vaut pour **la surface relayée** ; 250 reste la garde du producteur |
| AD-20 §6 | AC20-8r ajouté (garde de constante) |

## 4. Qui fait quoi

- **desk-design (Maquette)** : SPEC-015 **rév. 4** — correction *étroite* (§4.1 en deux lignes, 2000 ms
  + dérivation, ACo-9). Ne pas rouvrir le reste de la page : rév. 3 est bonne partout ailleurs.
- **desk-shell (Cadre)** : à l'étape B, le miroir `lan:speaking-set` de l'overlay utilise
  `SPEAKING_RELAY_STALE_MS = 2000` ; **ne pas toucher** `Room.tsx` ni `SPEAKING_STALE_MS` ; écrire le
  test de D4.2 avec l'horloge du renderer, pas `Date.now()` en dur.
- **desk-engine (Carillon)** : rien à changer côté moteur — 250 et garde-vie 1000 restent ; annoncer
  l'empreinte de son rendu (AD-22 D2).
- **desk-qa (Banc)** : VERIF-024 mesure ACo-9 à **2000 ms** et ACo-14 à **680 ms** ; verdict dans le
  message (AD-22 D1).

Rien de moitié rendu : tant que SPEC-015 porte « ≥ 1000 ms sur overlay et salon », la page **contredit**
le canon et une vérification qui la suit rendra un FAIL qui n'est pas un défaut de code.
