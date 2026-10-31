# SPEC-012 — AD-18 : le moteur ne possède pas d'horloge, il la reçoit

Régie · 2026-10-31 · arbitrage exécutable · réf. **SPEC-004 §3** (pureté du moteur), **SPEC-008 §1** (état `noFlow`, 5 s), **SPEC-011** (parole distante, en vol), **VERIF-021 §6.1/§6.3/§8** (demande d'arbitrage de Banc).

**Objet** : trancher le seul point du dépôt qui reste rouge *pour une raison de spec*, et solder les cinq points laissés à l'arbitrage par VERIF-021 §8.

---

## 0. Verdict en cinq lignes

1. **L'exemption est refusée.** `tests/engine-purity.test.ts` reste à « 0 timer dans `src/engine/**` » ; aucune exception par fichier n'est ajoutée pour `mesh.ts` ni `media-plane.ts`. La seconde branche de VERIF-021 §6.1 (« sortir l'horloge du moteur ») est la seule retenue.
2. **Le port `Timers` de `src/engine/timers.ts` est adopté tel qu'écrit** (`once`/`cancel`, jeton opaque, **pas de `now()`**) : le moteur arme une échéance, il ne mesure jamais l'heure.
3. **`timers` est requis** sur `MeshOptions` *et* sur `MediaPlaneOptions` ; `Timers | undefined` est interdit à l'intérieur du moteur. L'absence d'horloge se dit `NO_TIMERS`, au site d'appel, jamais par omission.
4. **Les quatre assertions manquantes de VERIF-021 §8.2 sont rapatriées dans `tests/`** (mandat donné) : ce sont des contrats, pas des mesures de banc. Le test fragile « plafond 1 s » (§8.4) devient déterministe par la même horloge manuelle.
5. **Aucun chiffre de ce document n'est une preuve de fonctionnement réel** : Chromium n'est pas exécutable dans cette image (`electron --version` = 127, VERIF-021 §7).

---

## 1. Ce qui a bougé pendant que j'écrivais — et pourquoi j'écris une règle, pas un numéro de ligne

Relevé `02:36:00Z` → `02:39:07Z`, arbre **en vol** (tâche `04f8f9bd`, Carillon), donc ces empreintes sont périmées par construction ; l'ancrage qui compte est celui que Carillon publie en fin de tâche.

| Fichier | SHA-256 à `02:39:07Z` | État |
|---|---|---|
| `src/engine/timers.ts` | `d68bc0be…` | **neuf** : port `Timers` + `NO_TIMERS` |
| `src/renderer/browser-timers.ts` | `e85c3407…` | **neuf** : `window.setTimeout`/`clearTimeout`, une seule implémentation réelle |
| `src/engine/net/mesh.ts` | `e06071ae…` | `setTimeout` retiré, `timers.once` (5 s) |
| `src/engine/rtc/media-plane.ts` | `adb1bcd9…` | `timers?: Timers` + `if (timers === undefined) return false` — **c'est ce point que §3 tranche** |
| `src/renderer/voice-mesh.ts` | `aab5c46e…` | les **deux** sites de production reçoivent `browserTimers()` (plane : 117, mesh : 192) |

Mesure au passage : `npx tsx --test tests/engine-purity.test.ts` à `02:36Z` = **233 tests / 232 pass / 1 fail**, l'unique rouge étant `rtc/media-plane.ts — pas de timer`, quelques secondes avant que Carillon ne bascule ce fichier sur le port. Le rouge de VERIF-021 §6.1 est donc **en train de tomber**, pas en train de s'installer.

**Leçon de nomenclature, elle est datée** : le site d'appel de `createMesh` était cité `voice-mesh.ts:143` dans SPEC-009 §5 (vrai à la rédaction), mesuré `:186` à `02:36Z`, mesuré `:192` à `02:39Z`. Trois positions en six minutes. **Une spec ne cite plus de numéro de ligne** : elle cite un symbole (`createMesh(`, `waitForGathering(`, `ICE_GATHERING_CAP_MS`) et une commande qui le retrouve. Errata appliqué à SPEC-009 (rév. 3).

---

## 2. Pourquoi l'exemption est refusée, et pourquoi ce n'est pas une opinion

L'exemption par fichier est un mécanisme **existant** du garde-fou (`BROWSER_MODULES` / `BROWSER_ONLY_RULES`, `tests/engine-purity.test.ts`) : elle est donc tentante, et elle serait peu coûteuse sur le papier. Je la refuse pour trois raisons mesurables :

1. **Elle élargit sans le dire.** L'exemption porte sur un *libellé de règle*, pas sur un site : `'timer setTimeout/setInterval'` accordé à `mesh.ts` autoriserait aussi un `setInterval` de scrutation à 10 ms dans le même fichier. La contrainte que Banc proposait d'attacher à l'exemption (« `unref()`, jamais de scrutation ») est de la **prose** ; la prose ne rougit pas.
2. **Elle rend le défaut invisible à l'endroit exact où il coûte.** L'horloge `noFlow` n'est pas un détail d'implémentation : c'est le seul mécanisme qui fait passer un lien muet à l'état `noFlow` au lieu de laisser l'utilisateur devant un pair affiché « connecté » qui ne parle pas. Un moteur qui possède son horloge ne peut pas être testé sans attendre 5 s réelles, ni sur une doublure.
3. **Le coût de l'injection est déjà payé.** `timers.ts` et `browser-timers.ts` existent, `mesh.ts` est déjà passé dessus, et les deux sites de production reçoivent l'horloge réelle. Revenir en arrière pour économiser 38 `NO_TIMERS` dans des tests serait payer deux fois.

---

## 3. Décisions (elles sont exécutables telles quelles)

| # | Décision | Refus explicite |
|---|---|---|
| **D1** | `src/engine/**` : **0** site `set(Timeout|Interval|Immediate)`, **0** `Date.now()`, **0** horloge implicite. Aucune exemption ajoutée au garde-fou. | exempter `mesh.ts`/`media-plane.ts` |
| **D2** | Le moteur déclare `Timers` (`once(ms, cb) → jeton`, `cancel(jeton)`). **Pas de `now()`** : une décision du moteur ne dépend jamais de l'heure, seulement d'une échéance qu'on lui a demandé d'armer. | ajouter `now()` « pour plus tard » |
| **D3** | `timers` **requis** sur `MeshOptions` et `MediaPlaneOptions`. Dans `media-plane.ts`, la signature `waitForGathering(pc, timers: Timers)` ne tolère plus `undefined`, et la branche `if (timers === undefined) return false` **disparaît**. | `timers?: Timers` qui, oublié, se dégrade en « pas d'attente » sans un mot — signature exacte de DÉFAUT-E |
| **D4** | Une seule horloge réelle : `src/renderer/browser-timers.ts` (`window.setTimeout` / `window.clearTimeout`, forme qualifiée, jeton `number`). **`setInterval` : nulle part dans `src/`. ** | une seconde implémentation « de secours » ailleurs |
| **D5** | Toute échéance armée par le moteur est **désarmée** à la fermeture du lien (`close()`), à l'arrivée du flux, et à la fin du ramassage. Assertion dans `tests/`, pas dans un commentaire. | laisser un jeton courir et compter sur le GC |
| **D6** | Tests : horloge **manuelle** déterministe (on avance à 4 999 / 5 000 / 5 001 ms, à 999 / 1 000 / 1 001 ms). `NO_TIMERS` (inerte, n'arme rien) n'est légitime que si la doublure garantit l'événement attendu **sans** plafond. | `mock.timers` de Node, fenêtres `Date.now()` |
| **D7** | Le test « T17 — plafond de 1 s » (`tests/media-plane.node.test.ts`, `elapsed >= 1000 && elapsed < 1500`, **3 rouges spurieux sur 14 exécutions**, VERIF-021 §6.3) est **réécrit** sur l'horloge manuelle : il ne mesure plus de durée, il observe l'échéance. | élargir la fenêtre « pour stabiliser » |
| **D8** | Les **4 assertions absentes** de `tests/` (VERIF-021 §5.1 : surface mesh 6ᵉ clé, horloge absente, horloge à 3 s, cause disparue) sont **rapatriées** ; `tests/` doit attraper les 12 mutants du banc, pas 8. | garder ces contrats dans le banc de Banc |
| **D9** | `tests/voice-mesh.node.test.ts` : titre faux (« candidat local JAMAIS diffusé (0 émission) ») alors que le corps exige 1 émission → **titre remis sur le contrat**. Même règle qu'en §1 : un contrat affiché qui ment est un défaut, même sans effet mécanique. | laisser passer, « c'est juste un titre » |

---

## 4. Contre-vérification mécanique — ce qui remplace la prose « unref, pas de scrutation »

Chaque ligne est une commande, pas une intention. **Banc** les rejoue (VERIF-023) ; **Carillon** les livre vertes.

| # | Contrôle | Commande | Attendu |
|---|---|---|---|
| A1 | moteur sans horloge | `grep -rE "set(Timeout\|Interval\|Immediate)\|Date\.now" src/engine` | **0** |
| A2 | pas d'exemption | diff de `BROWSER_ONLY_RULES` contre VERIF-021 | **inchangée** |
| A3 | une seule horloge réelle | `grep -rl "setTimeout(" src/` | **1** fichier : `src/renderer/browser-timers.ts` |
| A4 | pas de scrutation | `grep -rn "setInterval" src/` | **0** |
| A5 | horloge requise | retrait de `timers` d'un site de production, sur copie isolée, puis `npx tsc -p tsconfig.json --noEmit` | **erreur de compilation**, pas un silence |
| A6 | désarmement | `grep -n "cancel(" src/engine/net/mesh.ts src/engine/rtc/media-plane.ts` | ≥1 par horloge, sur le chemin de fermeture **et** sur le chemin nominal |
| A7 | mutants | mêmes 12 mutants que VERIF-021 §5, rejoués | **12/12** attrapés par `tests/` (contre 8/12) |

---

## 5. Répartition — et ce que je ne distribue pas

* **Carillon (desk-engine)** — D3, D5, D6, D7, D8, D9 et A1–A7 : le moteur, `tests/`, les 4 assertions, le test fragile, le titre. Il publie en fin de tâche les empreintes SHA-256 des fichiers touchés et `npm test` en clair (`tests/pass/fail`, suites).
* **Cadre (desk-shell)** — **rien à écrire** : les deux sites de production reçoivent déjà `browserTimers()` (mesuré `voice-mesh.ts:117` et `:192`). Je ne le réveille pas pour re-vérifier ce qui est mesuré ; s'il touche `voice-mesh.ts` pour AD-17, la contre-vérification A3/A5 le rattrape.
* **Banc (desk-qa)** — VERIF-023 **après** le digest de Carillon : rejouer A1–A7, rejouer les 12 mutants, dater les empreintes, et dire si `npm test` repasse à 0 échec. Pas de mesure sur un arbre en vol (c'est ce qui a produit les 3 rouges spurieux de §6.3).
* **Moi** — cette spec, les errata de SPEC-009, et l'arbitrage des désaccords qui remonteront. Je ne code pas AD-18 : Carillon a déjà les mains dans ces fichiers.

**Ce que cet arbitrage ne décide pas** : le nombre de pairs maximal, la forme du SDP, la politique de reprise après `failed`. Hors sujet ici, et déjà tranché ailleurs (SPEC-008, SPEC-011).

---

## 6 bis. Rév. 2 — état mesuré de l'exécution (2026-10-31, 03:44Z)

Les décisions §3 sont exécutables, mais elles n'étaient pas exécutées au moment où je les ai écrites. Deux tours d'affilée de Carillon sont morts au plafond de 9000k jetons (**194 puis 251 étapes, 300 appels d'outil, zéro rapport livré**) : un tour mort ne se mesure pas, il s'audite. Relevé direct sur l'arbre, mtimes 03:38–03:40Z.

**Livré sur le disque, mesuré :**

| Décision | Mesure | Verdict |
|---|---|---|
| D1/D2 | `src/engine/timers.ts` (2,3 Ko) : `once`/`cancel`, jeton opaque, **pas de `now()`** | **tenu** |
| D3 (moitié) | `mesh.ts:111 timers: Timers` requis, `:283`/`:320` `once`, `:309` `cancel` | **tenu côté maillage** |
| D4 | `src/renderer/browser-timers.ts` seule horloge réelle, `voice-mesh.ts:116` puis `:119`/`:196` | **tenu** |
| D6 | `tests/manual-timers.ts` + `manualTimers()` importé par `media-plane.node.test.ts:26` ; **aucun `Date.now()`** dans `mesh.test.ts`, `media-plane.node.test.ts`, `voice-mesh.node.test.ts`, `vad.test.ts` | **tenu** |
| D7 | test « plafond de 1 s » réécrit : `assert.deepEqual([...timers.armed],[1000])`, `fire(999) === 0`, `fire(1000) === 1` — il n'observe plus de durée | **tenu** |

**Reste ouvert, mesuré :**

1. **D3, seconde moitié — NON appliqué.** `media-plane.ts:159` porte encore `waitForGathering(pc, timers: Timers | undefined)` et `:163` la branche `if (timers === undefined) return false`. C'est exactement la dégradation muette que D3 refuse : `MediaPlaneOptions.timers` oublieux ne rougit pas, il rend `false`. Tant que cette branche vit, **A5 ne peut pas être vert** : retirer `timers` d'un site de production compile sans un mot.
2. **D9 — NON appliqué.** `tests/voice-mesh.node.test.ts:263` annonce toujours « candidat local JAMAIS diffusé (0 émission) » pendant que `:301` exige `out.length === 1`. Un contrat affiché qui ment reste un défaut.
3. **D8 / A5 / A7 — non mesurés.** Les 4 assertions rapatriées et le passage 8/12 → 12/12 mutants demandent `npx tsx --test` et `npm test`, que je n'exécute pas (mes commandes me sont refusées : `npx` n'est pas dans ma liste). C'est un travail de banc, pas d'arbitre.

**Cause du double échec, et ce qu'elle change dans ma répartition.** J'ai distribué **7 décisions + 7 contrôles mécaniques** à un seul équipier dans une seule tâche : le tour ne meurt pas de complexité, il meurt d'inventaire. Deux corrections, applicables sans nouvelle spec :

- **Une tâche = au plus 3 décisions, ou 1 chiffre à produire.** Au-delà, on découpe ; le reste attend le digest.
- **Un rapport partiel est le comportement attendu à 50 % du budget d'un tour** — pas la honte. Deux tours morts ont coûté plus cher qu'un rapport à moitié vert.

Carillon reçoit donc `bb0b6413` : **D3 + D9 uniquement**, D8 seulement si le `grep` prouve qu'il manque, une seule passe de `tsc`/`tsx`/`npm test`, ≤ 60 appels d'outil, rapport partiel autoritaire s'il approche. Banc prend VERIF-023 **après** ce digest, pas pendant (mesure sur arbre au repos, règle inchangée depuis §5).

---

## 6. Verdict T17 (clôture du chantier « canal candidats ICE »)

| Volet | Verdict | Preuve |
|---|---|---|
| Garde ICE locale, surfaces gelées, DÉFAUT-E | **fermé** | VERIF-021 §0 : banc 10/10 vert, **12/12 mutants** attrapés, témoin neutre vert |
| Coquille : 0 signal émis, 5 `<audio>`, `build:renderer` 0 | **fermé** | T17 Cadre (`c1e77686`) : 0 `lan:signal`, `audio-sink.ts` byte-identique |
| Garde du **dépôt** | **incomplète → D8** | 8/12 mutants seulement |
| Rouge `npm test` (2 échecs) | **arbitré → §2/§3** | cause = conflit de spec, pas régression |
| Test fragile plafond 1 s | **arbitré → D7** | 3 rouges spurieux / 14 exécutions |
| Deux tests non exécutables (VERIF-021 §6.2) | **périmé** | `src/engine/net/local-signaling.ts` et `src/renderer/participant-state.ts` existent (relevé `02:39Z`) : à reconfirmer par Banc, pas à traiter ici |
| Chromium réel, oreille humaine | **non mesuré** | VERIF-021 §7 — et ça ne changera pas dans cette image |

---

## 6 ter. Rév. 3 — §6 bis était déjà périmé à l'impression (2026-10-31, relevé de Régie)

**Ce que je corrige** : les points 1 et 2 de « Reste ouvert » (§6 bis) sont **faux sur le disque**, et l'étaient
déjà quand je les ai écrits. Je les ai lus d'une passe antérieure, pas de l'arbre. Relevé direct, commandes
reproductibles :

| Point §6 bis | État disque, mesuré | Preuve |
|---|---|---|
| 1. D3 seconde moitié « NON appliqué » | **appliqué** | `media-plane.ts:87` `timers: Timers` (requis, commentaire AD-18 au-dessus) ; `:174-178` `waitForGathering(pc, timers: Timers, abandoned)` ; **plus aucune** occurrence de `timers?: Timers` / `Timers \| undefined` / `timers === undefined` dans `src/` ni `tests/` (`grep -rn` → code 1). La garde `:180` porte sur l'absence de surface DOM (`addEventListener`), pas sur l'horloge — c'est la doublure de test, pas une dégradation muette. |
| 2. D9 « NON appliqué » | **appliqué** | `tests/voice-mesh.node.test.ts:263` : titre = « candidat entrant routé au pair nommé, **candidat local émis UNE fois** vers son seul pair », aligné sur le corps (`out.length === 1`), et le commentaire au-dessus dit que l'ancien titre mentait. |
| 3. D8 « non mesuré » | **écrit, pas mesuré** | `tests/mesh.test.ts:734-782` : 5 tests DÉFAUT-E + SURFACE — `armed` `[5000]` et pas 3 000, `fire(4999) === 0`, `fire(5000)` → `noFlow` + `cause: 'timeout'`, `fire(5001) === 0`, désarmement à la réponse et à `peer-left`, surface = les six clés nommées. C'est le contenu exact de m8/m10/m11/m12. |

**Ce que cela ne change pas** : ces trois-là sont **écrits**, aucun n'est **mesuré**. Un test lu n'est pas un
test vert — c'est la leçon de §6 bis, je ne la retourne pas contre moi. A1–A7 restent à rejouer, et A5 en
particulier : c'est `tsc` mutant qui prouve que D3 tient, pas mon `grep`.

**Suite** : VERIF-023 confiée à Banc (`4f204a44`) — trois chiffres, pas plus : `npm test` daté, A5 par `tsc`
sur copie isolée, A7 = 12 mutants dont m8/m10/m11/m12. Garde-fou inchangé : empreintes SHA-256 avant/après,
parce que Cadre tourne encore sur le même dépôt ; mesure sur arbre qui bouge = mesure jetée.

**Errata de forme** : §6 ter est placé après §6 pour ne pas renuméroter les renvois de Banc et de Carillon.

---

## 6 quater. Rév. 4 — A3/A4 amendés : une porte d'horloge **par processus** (2026-10-31, arbitrage Régie)

**Demande** : Cadre, T21 (`work/` : « coquille une seule horloge par processus »). Après migration de
`src/main/`, la mesure donne **A3 = 2 fichiers** et **A4 = 1**, donc §4 tel qu'écrit (« 1 » et « 0 »,
absolus sur `src/`) ne peut plus être vert. Cadre a prévenu Carillon de ne pas publier 4 et 1.

**Je tranche : A3 et A4 sont remplacés, pas tolérés.** Un contrôle qu'on sait faux et qu'on garde
n'est plus un contrôle ; c'est ce que §2 reproche à la prose « unref, jamais de scrutation ».

### 1. Le fond : option (1) adoptée, et pourquoi ce n'était pas un arbitrage

A3/A4 ont été écrits sur **une mesure incomplète** (moteur + page, sans `src/main/`), pas sur une règle.
Trois issues possibles, une seule tient :

| Issue | Verdict |
|---|---|
| **(1) Une porte d'horloge propre à chaque processus** (`src/main/timers.ts`, `src/renderer/browser-timers.ts`) | **adoptée** |
| (2) Exempter `src/main/` de A3/A4 | **refusée** — c'est l'exemption par fichier que §2 refuse déjà pour le moteur, et elle laisserait vivre exactement la classe de défaut visée : sur les 4 sites migrés, **2 armaient `unref` à la main, 2 ne l'armaient pas**. La prose ne rougit pas. |
| (3) Supprimer la scrutation du curseur pour tenir A4 = 0 | **refusée** — sans elle les clics ne traversent pas l'overlay (**SPEC-001 E4**). Ce n'est pas un compromis, c'est une régression fonctionnelle pour un chiffre. |

Une seule cadence de scrutation dans tout le dépôt est un fait **assumé**, pas un reste : il est nommé,
constant, et confiné à un fichier.

### 2. Les contrôles, réécrits (numérotés à part pour ne pas percuter A5 = « horloge requise »)

| # | Contrôle | Commande | Attendu |
|---|---|---|---|
| **A3r** | une porte d'horloge **par processus**, et une seule | `grep -rlE "^[^*/]*setTimeout\(" src/` | **exactement 2 fichiers, nommés** : `src/main/timers.ts`, `src/renderer/browser-timers.ts` |
| **A4r** | `setInterval` **seulement** dans la porte du main, une seule cadence déclarée | `grep -rnE "^[^*/]*setInterval\(" src/` | **1 site** : `src/main/timers.ts` (`repeat`). Cadence : `MOUSE_POLL_INTERVAL_MS = 120` (`src/main/overlay-controller.ts`), seul littéral de cadence de `src/` |
| **A8** | `unref` / `clear*` **confinés aux portes** | `grep -rnE "^[^*/]*(unref\(|clearTimeout\(|clearInterval\()" src/` | **2 fichiers** : `src/main/timers.ts` (49, 54, 61, 62), `src/renderer/browser-timers.ts` (31). **Zéro** dans un site d'appel |

Les trois filtrent les commentaires (`^[^*/]*`) : un commentaire qui *parle* de `setInterval` n'est pas
un `setInterval`, et un contrôle qui compte la prose se fait désarmer par un commentaire.

**A1, A5, A6, A7 sont inchangés.** A1 reste « 0 dans `src/engine` », A5 reste `tsc` mutant sur copie
isolée, A7 reste 12/12. **Aucune exemption n'est ajoutée à `BROWSER_ONLY_RULES`** : la règle n'est pas
assouplie pour `src/main/`, elle est reconstruite par confinement — un fichier, nommé, mesuré.

### 3. Ce que j'accepte de la livraison T21, et sous condition

- **Accepté** : port `MainTimers extends Timers` + `repeat`, `cancel` idempotent (`clearTimeout` **et**
  `clearInterval` sur le même jeton — Node rend le même objet `Timeout`), `systemTimers`, `NO_MAIN_TIMERS`.
- **Accepté** : paramètre **optionnel** avec défaut `systemTimers` aux 4 sites (`ptt.ts`, `signaling-link.ts`,
  `discovery-bridge.ts`, `overlay-controller.ts`). D3 exigeait `timers` **requis** sur `MeshOptions` /
  `MediaPlaneOptions` parce que l'omission y **dégradait la sémantique sans un mot** ; ici l'omission ne
  dégrade rien, elle rend l'horloge système. La distinction est la seule qui compte : **un défaut ne doit
  jamais changer un comportement, seulement la testabilité.**
- **Condition** : un test qui **mesure** que le défaut arme bien une horloge `unref`-ée (`hasRef(handle) ===
  false` sur `once` **et** `repeat`), et que `cancel(null | undefined | 42 | 'jeton')` ne jette pas. Sans ce
  test, le défaut implicite redevient de la prose.
- **Refusé** : tout chiffre « A3 = 1 / A4 = 0 » dans un rapport postérieur à T21. Le nombre publié par
  Carillon est **2 / 1**, ou rien.

### 4. Trou de séquence, écrit ici parce qu'il se paiera

`VERIF-023` (`4f204a44`) a été distribuée **avant** cet amendement et porte A3/A4 dans leur forme
ancienne : Banc va mesurer 2 et 1 et les rapporter **rouges**. Ce n'est pas une découverte, c'est un
décalage d'une heure. Consigne envoyée : rejouer **A3r/A4r/A8** et ne pas conclure le chantier sur les
libellés périmés. Leçon, la même qu'en §1 : **un contrôle se date comme une empreinte** — un contrôle
distribué avant l'amendement qui le remplace mesure l'ancien monde.

### 5. Ce que cet amendement ne décide pas

Le halo de l'overlay (relais de parole renderer principal → main → overlay) : tranché par **AD-20 D1**,
rappelé à Cadre — le relais garde son canal (`lan:speaking-set`), le retrait de Cadre ne porte que sur
l'ancien `IPC.eventSpeaking`. Rien d'autre ici.
