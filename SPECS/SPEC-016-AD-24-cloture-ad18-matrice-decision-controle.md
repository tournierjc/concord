# SPEC-016 — AD-24 : AD-18 clos sur périmètre daté, matrice décision → contrôle, garde verte avant VERIF-024

**Régie, 2026-10-31, relevé 04:1x–04:2xZ.** Cet AD retire une demande que j'ai faite au tour précédent
(« le découpage AC18-1..3 ») : ce découpage n'existe pas (§5). Il la remplace par la matrice
décision → contrôle, qui est ce dont une clôture a besoin.

---

## 0. Verdict en six lignes

1. **VERIF-023 = PASS**, sur un périmètre **nommé** : les 11 fichiers d'AD-18 dont l'empreinte est
   identique à l'octet avant et après la fenêtre de mesure (11/11, 03:11:00Z → 03:13:06Z). Sur tout autre
   fichier, ce PASS ne dit rien — et c'est écrit dans le rapport, pas seulement dans ma tête.
2. **AD-18 est clos.** A1, A3r, A4r, A6, A8 conformes ; A5 et A7 « non rejoués par identité d'octets » —
   ce n'est pas une absence de mesure, c'est un constat daté, et il est nommé.
3. **Quatre réserves nommées** : A8 est sensible à l'orthographe (§4), et **trois décisions d'AD-18 n'ont
   aucun contrôle mécanique** (D2, D7, D9 — §3). Elles sont **livrées, pas vérifiées**. La différence est
   écrite ici pour ne pas disparaître dans un rapport de clôture.
4. **`npm test` est rouge** : 25 fichiers sur le disque, 24 dans `test:node`, marqueur `compte courant`
   à 24 (§1). Le 615/615 de 03:11Z ne décrit plus l'arbre.
5. **L'arbre bouge encore** : quatre fichiers modifiés après 03:13Z, le dernier à **04:17Z**.
6. **Conséquence** : aucun feu T23, aucune VERIF-024 tant que la garde est rouge. La garde verte n'est pas
   une conséquence de la clôture, c'est son préalable (§5 D2).

---

## 1. Ce que j'ai mesuré moi-même (04:1x–04:2xZ, `/work/lan-voice`)

| Mesure | Commande | Résultat |
|---|---|---|
| Fichiers de test sur le disque | `ls tests/*.test.ts \| wc -l` | **25** |
| Fichiers cités par `test:node` | `grep -o 'tests/[a-z.-]*\.test\.ts' package.json \| sort -u \| wc -l` | **24** |
| Marqueur de `scriptsNote` | `grep 'compte courant' package.json` | **« compte courant : 24 fichiers »** |
| Conséquence | assertions 1 et 4 de `tests/scripts-coverage.node.test.ts` | **rouges** ; le fichier manquant est `tests/speaking-relay.test.ts` |
| Ce que Banc a vu | son relevé | `npm test` **613/615**, 2 échecs, tous deux dans la garde |

Empreintes du moment (mtime, `ls --time-style`), pour que ce constat soit daté comme le reste :

| Fichier | mtime |
|---|---|
| `package.json` (porte la liste et le marqueur) | **03:58Z** |
| `src/shell/ipc-contract.ts` | 04:14Z |
| `src/preload/index.ts` | 04:14Z |
| `src/main/index.ts` | 04:16Z |
| `tests/speaking-relay.test.ts` | **04:17Z** |

`tests/speaking-relay.test.ts` a été réécrit **après** la fenêtre de Banc et **après** l'apparition du
défaut : le remède à la garde n'existait pas encore quand il l'a constatée. Personne n'a tort ici ; c'est
un décalage d'une heure, exactement la leçon que porte déjà AD-18 §4.

---

## 2. Pourquoi un PASS sur arbre mobile tient ici — et ne tiendra pas ailleurs

Banc a fait ce qu'AD-22 D2 exige, dans l'ordre : empreintes **avant**, mesure, empreintes **après**,
écart **vide sur les 11 objets mesurés**, et il a **refusé d'extrapoler** son 615/615 à T21 en écrivant que
l'arbre avait bougé ailleurs. C'est ce refus qui rend le verdict utilisable.

Contraste, et la règle qui en sort : le premier tour de VERIF-023 s'est terminé « failed » sans une seule
empreinte — **NON RENDU**, ni PASS ni FAIL. Le second a raison *et* montre sa borne. La différence n'est
pas le chiffre, c'est la borne.

**D1 — Un PASS est toujours borné par sa liste d'empreintes.** Un rapport qui prononce un PASS sans les
deux listes (avant / après) vaut NON RENDU, même s'il a raison sur le fond. Symétriquement, un contrôle
« non rejoué par identité d'octets » est **recevable** — à condition d'être écrit, jamais tu.

---

## 3. Matrice décision → contrôle (le contenu réel de la clôture)

Les décisions sont celles d'AD-18 §3 (D1..D9) ; les contrôles ceux d'AD-18 §4 et §6 quater §2 (A1..A8).
Une décision sans contrôle n'est pas « vérifiée », elle est « livrée, non vérifiée ». Je l'écris au lieu de
laisser la case vide se lire comme un vert.

| Décision (AD-18 §3) | Contrat | Contrôle | État |
|---|---|---|---|
| **D1** moteur sans horloge ni `Date.now()` | 0 site dans `src/engine` | **A1** | couvert |
| **D2** `Timers` sans `now()` | `once` + `cancel`, rien d'autre | **aucun** | **livré, non vérifié** — mesuré conforme à la main (§3.1), non protégé |
| **D3** `timers` requis sur `Mesh`/`MediaPlane` | pas de `timers?:` qui dégrade en silence | **A5** (tsc mutant) | couvert |
| **D4** une horloge réelle par processus | 2 fichiers nommés, `setInterval` nulle part hors porte | **A3r, A4r** | couvert |
| **D5** désarmement à `close()` / arrivée / fin de ramassage | assertion dans `tests/`, pas dans un commentaire | **A6** | **partiel** — A6 est un `grep` : il prouve la présence de `cancel(`, pas l'atteinte des deux chemins. Banc a vérifié l'atteinte **à la main** ; ce n'est pas rejouable par une machine |
| **D6** horloge manuelle déterministe | pas de `mock.timers`, pas de `Date.now()` de test | **A5, A7** indirects | partiel — `tests/manual-timers.ts` existe, aucun contrôle ne l'impose |
| **D7** test « plafond de 1 s » réécrit | plus aucune fenêtre de durée | **aucun** | **livré, non vérifié** ; mesuré à l'instant : 0 occurrence de `elapsed` dans `tests/media-plane.node.test.ts` |
| **D8** `tests/` attrape les 12 mutants (contre 8) | 12/12 | **A7** | couvert |
| **D9** titre de `voice-mesh.node.test.ts` remis sur le contrat | plus de titre qui ment | **aucun** | **livré, non vérifié** |

### 3.1 Trois trous, trois contrôles d'une ligne — et le piège évité

Adoptés, à câbler dans `VERIF/run-all.sh` et à rejouer dans VERIF-024 :

| # | Décision | Contrôle | Attendu | Mesuré ce tour |
|---|---|---|---|---|
| **A9** | D2 | nombre de membres de `export interface Timers` (`src/engine/timers.ts`) | **2** (`once`, `cancel`), **0** `now` | 2 / 0 conforme |
| **A10** | D7 | `grep -c elapsed tests/media-plane.node.test.ts` | **0** | 0 conforme |
| **A11** | D9 | `grep -nE "^\s*(it\|test)\(.*JAMAIS diffusé" tests/voice-mesh.node.test.ts` | **0** (ligne de titre seulement) | 0 conforme ; la phrase ne survit que dans un commentaire d'explication |

**A11 est écrit comme ça parce que ma première version était fausse.** Un `grep "JAMAIS diffusé"` sur le
fichier sort **vert sur une ligne 264 qui est un commentaire** racontant l'ancien titre. C'est exactement
le défaut d'A8 (§4) et la raison d'être du filtre `^[^*/]*` d'AD-18 §6 quater : **un contrôle qui compte la
prose se fait désarmer par un commentaire**. A9 et A10 sont conformes aujourd'hui ; ils ne protègent de
rien tant qu'ils ne sont pas dans `run-all.sh`.

---

## 4. A8 : un contrôle qui compte l'orthographe n'est pas un contrôle

A8 (`unref(` / `clearTimeout(` / `clearInterval(` confinés aux deux portes) est **conforme** et n'a
manqué aucun des cas qu'il visait. Il est **incomplet**, ce qui n'est pas la même chose : il apparie du
**texte**, donc il est aveugle à tout mutant qui garde le comportement et change l'écriture —

```ts
const c = clearTimeout; c(h)                 // alias : A8 ne voit rien
globalThis.clearTimeout(h)                   // forme qualifiée : A8 ne voit rien
queueMicrotask(() => clearTimeout(h))        // le littéral est là, le confinement ne l'est pas
```

Un contrôle d'orthographe mesure la mode, pas la règle. **Ce n'est pas un FAIL** : il n'a pas menti, il a
répondu à une question plus étroite que celle qu'on croyait poser. D'où l'étiquette **conforme avec
réserve**, et non un rouge qui accuserait un travail juste.

Le remède est **comportemental** et il est déjà dans la maison : appliquer le mutant sur copie isolée et
exiger un rouge (protocole VERIF-021 §5). Il ne demande aucune écriture dans le produit — c'est de
l'outillage de vérification, donc **Banc**. C'est un préalable de VERIF-024, pas une amélioration
souhaitable : tant qu'A8 compte des lettres, « confiné » est une revendication, pas une mesure.

---

## 5. Décisions

- **D1 (borne d'empreintes)** — §2. Un PASS sans liste avant/après = NON RENDU. Un contrôle non rejoué
  par identité d'octets est recevable **s'il est écrit**.
- **D2 (la garde verte est un préalable)** — `package.json` : ajouter `tests/speaking-relay.test.ts` à
  `test:node` et porter le marqueur à **25**. On corrige **la liste et le marqueur**, jamais la garde :
  AD-22 D3 tient, y compris quand c'est elle qui nous dérange. Aucun feu T23, aucune VERIF-024 avant
  `npm test` vert sur l'arbre gelé.
- **D3** — **A9, A10, A11 adoptés** (§3.1) et **A6 requalifié « partiel »** : un `grep` de présence n'est
  pas une preuve d'atteinte. Si l'atteinte des deux chemins de D5 reste à la main, elle reste datée.
- **D4** — A8 devient **comportemental** dans VERIF-024. Tant que ce n'est pas fait, AD-18 est clos **avec
  la réserve écrite**, pas avec un silence : une clôture qui cache un trou est pire qu'une clôture en
  retard.
- **D5** — **Je retire « AC18-1..3 ».** L'AD-18 ne numérote pas de critère d'acceptation : elle numérote
  des **décisions** (D1..D9) et des **contrôles** (A1..A8, amendés A3r/A4r/A8). Ma demande du tour
  précédent était fautive et aurait produit une nomenclature parallèle à celle du contrat — le plus sûr
  moyen d'obtenir deux vérités. La numérotation d'AD-18 ne bouge pas ; la matrice §3 est la table de
  correspondance, et elle est unique.
- **D6** — Pas de feu T23 tant que (a) garde verte sur arbre gelé, (b) le plan T22 relu. Ces deux
  conditions sont dans cet ordre : un plan relu sur un arbre rouge ferait mesurer le plan, pas le produit.

---

## 6. Répartition

| Qui | Quoi | « Fini » |
|---|---|---|
| **Carillon** | Les deux corrections de `package.json` (liste + marqueur), puis `npm test` en entier | Garde verte (assertions 1→4), `npm test` rejoué, et **empreintes annoncées** de `speaking-relay.ts`, `speaking-relay.test.ts`, `package.json` : je dois savoir si le fichier livré à 04:17Z est **gelé** ou s'il bouge encore |
| **Banc** | A8 comportemental (copie isolée, rouge attendu, variantes alias / qualifiée / microtâche) + A9/A10/A11 câblés dans `run-all.sh` + harnais VERIF-024 prêt | Contrôles rejouables par une machine, **zéro écriture dans `src/`, `tests/` ou `package.json`** ; verdict ≤ 20 lignes dans le message (AD-22 D1), y compris pour dire « rien lancé sur T23 » |
| **Cadre** | Rien de neuf distribué | T22 (plan) puis T23 étape A déjà en file ; **aucune** écriture avant le feu, la consigne AD-22 D2 les empreintes avant/après tient |

**Ce que je ne fais pas moi-même, alors que ce serait deux lignes.** Corriger `package.json` serait un
geste de dix secondes, et la règle de la maison m'y autorise une ligne. Je ne le fais pas : Carillon écrit
dans ce dépôt **en ce moment** (`tests/speaking-relay.test.ts`, 04:17Z), et une liste que je modifierais
sous sa main changerait le compte pendant qu'il le mesure — soit exactement le défaut d'AD-22 D2, cette
fois provoqué par moi. L'exception « une ligne » ne couvre pas un fichier que son auteur est en train
d'écrire.

---

## 7. Ce que cet AD ne décide pas

Le feu T23 et son contenu (il attend le plan T22, et la garde) ; le halo relayé et son plancher de 2000 ms
(AD-23, clos) ; le budget de clignotement (AD-21, clos) ; le sort des 4 mutants que le dépôt n'attrape pas
(VERIF-021 §4.3, AD-18 D8) : tranché par A7, mais **rejoué** seulement quand l'arbre sera gelé.
