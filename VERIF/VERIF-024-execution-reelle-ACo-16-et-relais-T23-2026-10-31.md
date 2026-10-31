# VERIF-024 — Exécution réelle d'ACo-16 et du relais T23

**Date du relevé** : 2026-10-31, 03:47:12Z → 03:56:00Z (mesures), gel vérifié avant **et** après.
**Arbre** : `/work/lan-voice` (pas de dépôt git ⇒ empreintes par `sha256sum`).
**Banc** : `desk-qa`, bac à sable `/home/node/.mercury/bots/desk-lead/desk-qa/sandbox/aco16`.
**Canon** : SPEC-015 (rév. AD-25/AD-26 : E13, E15, E16, E17), SPEC-016 (E3, E8).

---

## 0. Verdict global, sans ambiguïté

**PASS sur ce qui est mesuré**, avec **une réserve nommée** : la fenêtre Electron réelle n'a **pas** pu
être ouverte (lib système absente), donc le rendu a été compté dans un **DOM React réel sous jsdom 26**
avec le **module d'entrée de l'arbre chargé tel quel** — pas une copie, pas un selftest. ACo-16 est
**EXÉCUTÉ** au sens « compteur de rendus alimenté par une exécution, avec falsification qui rougit » ;
il n'est **pas** exécuté « dans Electron ». Les deux phrases sont dans ce rapport, aucune n'est à lire
sans l'autre.

| Critère | Verdict | Preuve (chiffre) |
|---|---|---|
| 1. Empreintes identiques au gel | **PASS** | 9/9, `diff` rc=0 **avant** et **après** (aucune a bougé) |
| 2. `check-aco-016.sh` câblé au 7bis + exécuté sur l'arbre | **PASS** | `--selftest` = `PASS selftest=10/10` ; journal réel validé `violations=0` |
| 3. **ACo-16 — compteur de rendus** | **EXÉCUTÉ — PASS** | 3 garde-vie à 1 Hz sur **3 007 ms** ⇒ **0 rendu** ; falsification **3 rendus ⇒ REJET** |
| 4. ACo-9 F1 — extinction / échéancier armé à l'arrivée | **PASS** | extinction **2 007 ms** (pas 10 ms) ≤ budget **2 016 ms** ; 2 000 ms exact au niveau module |
| 5. ACo-8 — reload 0, un seul créneau | **PASS** (modules + document) | minuteurs survivants au démontage = **0** ; extinction 2 000 ms |
| 6. Suite complète rejouée | **PASS** | **639/639**, `fail 0`, `skipped 0`, **exit 0** (baseline T24 : 630/630 ⇒ +9, zéro régression) |
| 7. Harnais VERIF-024 complet | **PASS** | `CHECK_VERIF024 RESULT=PASS` exit **0**, `gel=OUI` (81 fichiers), `tsc=0/0`, `a8_rouge=5 a8_vert=4` |
| 8. « aucun trafic hors LAN » sur les fichiers T23 | **PASS** | `overlay-entry.tsx` : 0 hit ; `speaking-surface.ts` : 0 hit ; imports = `react`, `react-dom/client`, modules locaux |
| 9. Fenêtre Electron / trajet IPC physique | **NON EXÉCUTÉ** | `electron --version` ⇒ exit **127**, `libgobject-2.0.so.0: cannot open shared object file` |

---

## 1. Empreintes — relevé, comparaison au gel, re-relevé après mesures

Commande (relevé initial **et** re-relevé final, même commande) :

```
cd /work/lan-voice && sha256sum src/renderer/Overlay.tsx src/renderer/overlay-entry.tsx \
  src/renderer/speaking-surface.ts src/renderer/speaking-relay.ts src/renderer/voice.ts \
  src/preload/index.ts src/shell/ipc-contract.ts tests/speaking-relay.test.ts package.json
```

| Fichier | sha256 relevé | = gel Régie |
|---|---|---|
| `src/renderer/Overlay.tsx` (157 l.) | `a11ad1b58de0fce5f23e4c4cfadee84bb7300bd90a1647a3597407fb3687efdc` | **identique** |
| `src/renderer/overlay-entry.tsx` (83 l.) | `b8ea9ba595863a0ad8afd74340b68bdfcc8c4d33490e5e85da785028e92fc0a2` | **identique** |
| `src/renderer/speaking-surface.ts` (181 l.) | `ca2f4db4ebf4624c2baed7b9d37d5d0123a1b7e4f02b015aa12db850d1d99e5f` | **identique** |
| `src/renderer/speaking-relay.ts` (128 l.) | `aef6b1af0c65e4bb5fb9fc4a1aeca078bc6e633218d5797e4090615c17fc88a7` | **identique** |
| `src/renderer/voice.ts` | `bff4ded8d5ced218c2cfa883a09502066004ad54fa906dc835b74b27bb19e3b0` | **identique** |
| `src/preload/index.ts` | `89cf79cf5fa612ac8b29c66afbd00ee04dd41370b72c48e54f3eb6613542a41d` | **identique** |
| `src/shell/ipc-contract.ts` | `11400d427777dcdfbcf50362ac85425e45ea741495708044a9c3c90f7dfdd210` | **identique** |
| `tests/speaking-relay.test.ts` | `ac0090434257449e5db5188077812a7795d6e03b22b34e5f1db1ed39134e5223` | **identique** |
| `package.json` | `62372e9a571c53af75d75a1a182e33de648cb5a1ef3d395a135e3f983bb92e05` | **identique** |

Traces : `VERIF/verif-024-sha-gel.txt` (gel recopié) vs `VERIF/verif-024-sha-apres.txt` (relevé après
toutes les mesures) → `diff -u` **rc=0**. Comptes de lignes conformes à ceux annoncés (157/83/181).
Troisième contrôle, indépendant du mien : le harnais §8 compare l'empreinte de l'arbre avant/après la
passe → `[OK] arbre inchangé pendant la mesure (81 fichiers)`.

**Conclusion : aucune empreinte n'a bougé.** Le protocole d'arrêt prévu par la consigne n'a pas eu lieu
d'être déclenché.

---

## 2. Câblage de `check-aco-016.sh` au point 7bis et exécution

Le validateur était déjà appelé par le 7bis. Ce tour-ci il a été (a) **exécuté**, (b) **complété** par la
validation d'un journal de recette **réel**, jamais du seul selftest.

```
cd /work/lan-voice/VERIF && sh check-aco-016.sh --selftest
  CHECK_ACO016 RESULT=PASS selftest=10/10                        exit 0
cd /work/lan-voice/VERIF && sh check-aco-016.sh            (mode état, sans journal)
  RESULT=NOTRUN surfaces=3 ... gele=2 (ACo-14, ACo-15) ; FAIL=0   exit 0
cd /work/lan-voice/VERIF && sh check-aco-016.sh --validate verif-024-journal-aco-2026-10-31.txt
  CHECK_ACO016 RESULT=PASS violations=0                           exit 0
```

Modification du harnais (additive, `sh -n` OK) : le 7bis valide désormais un journal fourni par
`ACO16_JOURNAL=<fichier>` et **rougit si le validateur rejette** (`A16_V` entre dans la condition
d'échec du bilan). **Défaut retenu : sans journal, `A16_V=1` = FAIL** — « aucune mesure ACo-16 » n'est
pas un PASS. C'est un durcissement : avant ce tour, l'absence de journal laissait le harnais vert.

```
cd /work/lan-voice && ACO16_JOURNAL=/work/lan-voice/VERIF/verif-024-journal-aco-2026-10-31.txt \
  sh VERIF/verif-024-harness.sh
  ... journal réel (...) : RESULT=PASS violations=0
  gel=OUI orphelins_test_node=0 runall_fail=0 runall_skip=0 npm=639/0 tsc=0/0 a8_rc=0 \
  a8_rouge=5 a8_vert=4 aco_rc=0 aco_selftest=0 aco16_rc=0 aco16_selftest=0 aco16_validate=0
  CHECK_VERIF024 RESULT=PASS gel=oui runall_fail=0 a8_rouge=5 npm_fail=0 tsc=0/0 orphelins=0
  exit 0
```

Journal de recette réel — `VERIF/verif-024-journal-aco-2026-10-31.txt` :

```
ACo-8 statut=PASS cable=1 reload=0 extinction_ms=2007 extinction_module_ms=2000 budget_ms=2016 portee=surface+entree-overlay-executees-dans-un-DOM-React-reel
ACo-9 F1 statut=PASS cable=1 reload=0 extinction_ms=2007 budget_ms=2016 falsification=balayage periode_ms=2000 pire_cas_ms=4000 pire_cas_attendu_ms=4000 verdict=ROUGE accepte_balayage=0
ACo-9 F2 statut=NON-EXECUTE raison=E17-C6-ferme-constat-documentaire-pas-une-mesure
ACo-16 statut=PASS cable=1 duree_s=3 garde_vie_hz=1 messages=3 compte=rendus methode=MutationObserver+commits-React rendus_overlay=0 rendus_test=1
ACo-14 statut=gele raison=C5-mesure-non-rendue
ACo-15 statut=gele raison=C5
```

« Relais câblé » n'est pas une déclaration : il est **traçable dans l'arbre** —
`src/shell/ipc-contract.ts:35` `speakingSet: 'lan:speaking-set'`, `:52` `eventSpeakingSet: 'lan:event:speaking-set'` ;
`src/main/index.ts:302` `sendEvent(IPC.eventSpeakingSet, { speaking }, 'overlay')`, `:524` handler `IPC.speakingSet` ;
preload abonne `eventSpeakingSet` ; `overlay-entry.tsx` consomme `api.onSpeakingSet`. Les trois étages existent.

---

## 3. ACo-16 — **EXÉCUTÉ** (pas en selftest)

### 3.1 Pourquoi jsdom et pas Electron

```
/work/lan-voice/node_modules/electron/dist/electron --no-sandbox --headless t0.js
  error while loading shared libraries: libgobject-2.0.so.0: cannot open shared object file
  exit 127
ldconfig -p | grep -c gobject  ->  0
DISPLAY=""  ; xvfb-run/Xvfb absents
```

Electron **ne démarre pas** : bibliothèque GLib/GTK absente du conteneur, aucun serveur X. Donc :

- **ce qui est mesuré** : React 18 + `react-dom/client` réels, DOM réel (jsdom 26.1.0), **module
  `src/renderer/overlay-entry.tsx` de l'arbre chargé tel quel** via esbuild (aucune copie, aucune
  réécriture, `--define:process.env.NODE_ENV="production"`), `window.lanAPI` remplacé par un mock aux
  mêmes signatures que `ipc-contract` ;
- **ce qui n'est pas mesuré** : la fenêtre Chromium d'Electron, la composition GPU, et le **trajet IPC
  physique** (renderer → main → overlay) dont seule l'existence statique est prouvée (§2).

### 3.2 Le compteur de rendus

Deux instruments, alimentés en parallèle, sur `#root` :

1. **commits React** — faux hook `__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot` : React appelle ce
   point **à chaque commit**, indépendamment du fait que le DOM change. C'est le compteur de rendus.
2. **MutationObserver** — `subtree+childList+attributes+characterData` sur `#root`, comme le demande R10.

Non-vacuité : l'état affiché est lu à chaque échantillon (`li.overlay__avatar[data-speaking="true"]`),
donc « 0 rendu » n'est pas obtenu en n'ayant rien affiché.

### 3.3 Résultat sur l'arbre réel (`node driver.cjs prod`)

```json
{"mode":"prod","dom":"jsdom 26.1.0","react_hook_actif":true,"commits_total":3,"rendus_test":1,
 "fenetre":{"duree_ms":3007,"garde_vie_hz":1,"messages":3,"rendus_overlay":0,
            "mutations_lots":0,"mutations_enregistrements":0,
            "halo_lit_echantillons":[1,1,1,1,1,1],
            "halo_avant":{"lit":1,"all":2},"halo_apres":{"lit":0,"all":2}},
 "extinction":{"extinction_ms":2007,"pas_echantillonnage_ms":10,"rendus_extinction":1},
 "horodatage_utc":"2026-10-31T03:49:40.039Z"}
```

Lecture, sans arrondi :

- fenêtre **3 007 ms**, **3** trames identiques (`['p1']`) à 1 Hz, deux vignettes montées ;
- **`rendus_overlay` = 0** (commits) et **mutations = 0** — l'état est resté identique, halo allumé
  aux 6 échantillons (`1,1,1,1,1,1`) : la garde-vie silencieuse est **silencieuse en rendu** ;
- `rendus_test` = **1**, déclaré à part : c'est le commit d'établissement de l'état (participants +
  salon + première trame, regroupés par React 18), imputable au banc, pas à la garde-vie ;
- après la dernière trame, extinction en **2 007 ms** (échantillonnage 10 ms ⇒ valeur réelle dans
  [1 997 ; 2 007]) pour **1 seul rendu** — l'extinction coûte exactement un rendu, puis plus rien.

### 3.4 Falsification — le compteur sait-il rougir ? 3 rendus ⇒ **ROUGE**

Jumeau **défectueux** (`sandbox/aco16/twin-defect.tsx`, hors arbre) : même câblage, mêmes modules
importés depuis l'arbre, **un seul écart** — `forcer(t => t + 1)` à chaque trame reçue, c'est-à-dire le
défaut visé (un rendu par garde-vie). Même driver, même fenêtre :

```json
{"mode":"twin","rendus_test":1,"fenetre":{"duree_ms":3009,"messages":3,
  "rendus_overlay":3,"mutations_lots":0,"mutations_enregistrements":0},
 "extinction":{"extinction_ms":2006,"rendus_extinction":1}}
```

```
sh check-aco-016.sh --validate sandbox/aco16/journal-twin-falsifie.txt
  [REJET] ACo-16 rendus_overlay=3 — un seul rendu imputable à la garde-vie suffit à faire échouer
  CHECK_ACO016 RESULT=FAIL violations=1        exit 1
```

`0` (arbre) vs `3` (jumeau), **même instrument, même fenêtre, même journée** : le compteur discrimine.
Et le validateur transforme ce 3 en **FAIL** — la chaîne mesure → jugement est fermée.

### 3.5 Constat de banc à verser au canon (défaut de formulation, pas de code)

Sur le jumeau défectueux : **`mutations_lots` = 0 alors que 3 rendus ont eu lieu**. Un re-rendu qui
produit le même DOM ne mute rien : **le MutationObserver seul est aveugle** à ce défaut, donc R10 tel
qu'écrit (« compte les RENDUS (MutationObserver) ») ne peut pas voir le défaut qu'il prétend décrire.
Ce qui voit le défaut, c'est le compteur de **commits** React. Recommandation : SPEC-015 rév. suivante,
R10 → « compte les rendus par commits React (`onCommitFiberRoot`) ; le MutationObserver est un
instrument **secondaire**, non suffisant », et exiger les deux champs au journal. Tant que ce n'est pas
écrit, le journal ci-dessus porte `methode=MutationObserver+commits-React` : les deux sont là, et le
chiffre qui juge (`rendus_overlay`) est celui des commits.

---

## 4. Échéancier armé à l'arrivée (2 000 ms, budget 2 000 + 1 trame = 2 016 ms)

| Mesure | Commande | Résultat |
|---|---|---|
| Extinction document réel (jsdom) | `node driver.cjs prod` | **2 007 ms** (pas 10 ms), 1 rendu |
| Extinction modules réels (horloge injectée, résolution 1 ms) | `npx tsx sandbox/aco16/measure-surface.mjs` | **2 000 ms** exact, `budget_ms` 2 016 |
| Minuteurs survivants au démontage | idem | **0** (reload = 0) |
| Un seul créneau, annulation puis réarmement | `npx tsx --test tests/speaking-relay.test.ts` | `ok 17 - AD-25 D2 — un seul créneau : chaque arrivée annule puis réarme, jamais d’empilement` |
| Seuil et non cadence | idem | `ok 15 - AD-25 §6.5b — encore vrai à t0+1999, plus à t0+2001` |
| Producteur tué, zéro message | idem | `ok 14 - AD-25 §6.5a — halo éteint à 2000 ms, sans message` |
| Aucun minuteur survivant (test) | idem | `ok 16 - AD-25 §6.5c — aucun minuteur survivant au démontage de l’overlay` |

Le **4 000 ms** de SPEC-016 E3 n'est pas une mesure, c'est le **pire cas de la falsification « balayage »**
(F + P = 2 000 + 2 000) : il est porté au journal (`pire_cas_ms=4000 pire_cas_attendu_ms=4000
verdict=ROUGE accepte_balayage=0`) et le validateur refuse `accepte_balayage=1`. L'échéancier réellement
livré est **armé à l'arrivée** : l'extinction tombe à 2 000/2 007 ms après la **dernière** trame, jamais
dans une fenêtre de 3 000–4 000 ms — ce que le balayage aurait produit.

---

## 5. Contrôle « aucun trafic hors LAN » — fichiers touchés par T23

```
grep -cE "https?://|fetch\(|XMLHttpRequest|WebSocket|sendBeacon|dns|telemetry|analytics|sentry|posthog|gtag" \
  src/renderer/overlay-entry.tsx src/renderer/speaking-surface.ts
  overlay-entry.tsx   hits=0
  speaking-surface.ts hits=0
grep -nE "^import" (les deux fichiers)
  overlay-entry.tsx : 'react', 'react-dom/client', '../shell/ipc-contract' (type), './api', './browser-timers',
                      './Overlay', './speaking-surface', './theme', './styles.css'
  speaking-surface.ts : type Timers + constantes locales
```

Aucune URL, aucun `fetch`, aucun XHR/WebSocket/beacon, aucune résolution de nom, aucun identifiant de
télémétrie, **aucun `Math.random`** (pas de jeton de corrélation sortant). Les seuls modules importés
sont React et des modules locaux de l'arbre : la surface d'appel réseau de ces deux fichiers est **vide**,
ce qui est plus fort que « on n'a pas vu de paquet ». Ce contrôle ne couvre pas une éventuelle émission
depuis `src/main` (hors périmètre T23) ni une capture réseau réelle, impossible sans pile Electron.

---

## 6. Ce qui n'est PAS vérifié (nommé, pas arrondi)

1. **Fenêtre Electron réelle** — aucune exécution : `libgobject-2.0` absent, exit 127. Le rendu a été
   compté dans jsdom ; **la composition Chromium et la vraie fenêtre sans cadre ne sont pas mesurées**.
2. **Trajet IPC physique** `renderer → main → overlay` — les trois étages existent dans le code (§2),
   mais **aucun aller-retour IPC n'a été exécuté ni chronométré**. ACo-8/ACo-9 sont donc PASS **au
   niveau modules + document**, ce que le champ `portee` du journal dit explicitement.
3. **`styles.css` non appliqué** : esbuild marque l'import CSS « sans effet de bord » ; l'absence de style
   ne change ni les commits ni les mutations observées, mais rend nul tout verdict visuel (position,
   halo peint). Aucun verdict visuel n'est rendu ici.
4. **Mode développement React (StrictMode double rendu)** non couvert : bundle en `NODE_ENV=production`,
   où StrictMode est transparent. Une double invocation de rendu en dev n'est pas comptée.
5. **ACo-9 F2** : statut NON EXÉCUTÉ — E17 (C6 fermé) en fait un **constat documentaire** sur l'étiquette
   et la constante, pas un comportement à mesurer au banc. Rien n'est coché de ce côté.
6. **ACo-14 / ACo-15** restent `gele` (C5 : la mesure datée de `observe_ms` n'est pas rendue) — non
   touchés par cette passe, et le harnais les compte comme tels (`gele=2`).
7. **Perte de paquets 5 %, latence de bout en bout, CPU, débit** : hors périmètre de ce tour (T23 ne les
   touche pas, et sans pile Electron ils ne sont pas mesurables ici).
8. **Mode état de `check-aco-016.sh`** : il imprime `raison=arbre-non-gele` alors que l'arbre **est** gelé.
   Libellé trompeur du mode sans journal ; il n'a aucun effet sur le verdict (qui vient du journal
   validé), mais il est à corriger avant d'être cité par un tiers.

---

## 7. Reproduction intégrale

```
# empreintes (avant / après)
cd /work/lan-voice && sha256sum src/renderer/Overlay.tsx src/renderer/overlay-entry.tsx \
  src/renderer/speaking-surface.ts src/renderer/speaking-relay.ts src/renderer/voice.ts \
  src/preload/index.ts src/shell/ipc-contract.ts tests/speaking-relay.test.ts package.json
diff -u VERIF/verif-024-sha-gel.txt VERIF/verif-024-sha-apres.txt   # rc=0

# suite complète
cd /work/lan-voice && npm test > VERIF/verif-024-suite.log 2>&1 ; echo $?
grep -E "^# (tests|pass|fail|skipped)" VERIF/verif-024-suite.log    # 639 / 639 / 0 / 0

# ACo-16 : deux bundles, même driver, deux exécutions
cd /home/node/.mercury/bots/desk-lead/desk-qa/sandbox/aco16
/work/lan-voice/node_modules/.bin/esbuild /work/lan-voice/src/renderer/overlay-entry.tsx --bundle \
  --format=cjs --platform=browser --outfile=bundle-entry.cjs --loader:.css=text \
  --define:process.env.NODE_ENV='"production"'
NODE_PATH=/work/lan-voice/node_modules /work/lan-voice/node_modules/.bin/esbuild twin-defect.tsx \
  --bundle --format=cjs --platform=browser --jsx=automatic --outfile=bundle-twin.cjs \
  --loader:.css=text --define:process.env.NODE_ENV='"production"'
node driver.cjs prod     # rendus_overlay=0, mutations=0, extinction 2007 ms
node driver.cjs twin     # rendus_overlay=3, mutations=0   <-- falsification

# échéancier : extinction exacte au niveau module
cd /work/lan-voice && npx tsx /home/node/.mercury/bots/desk-lead/desk-qa/sandbox/aco16/measure-surface.mjs

# jugement
cd /work/lan-voice/VERIF
sh check-aco-016.sh --selftest                       # PASS selftest=10/10
sh check-aco-016.sh --validate verif-024-journal-aco-2026-10-31.txt        # PASS violations=0
sh check-aco-016.sh --validate /home/node/.mercury/bots/desk-lead/desk-qa/sandbox/aco16/journal-twin-falsifie.txt   # FAIL violations=1
cd /work/lan-voice && ACO16_JOURNAL=$PWD/VERIF/verif-024-journal-aco-2026-10-31.txt \
  sh VERIF/verif-024-harness.sh                      # CHECK_VERIF024 RESULT=PASS  exit 0
```

**ACo-16 : EXÉCUTÉ** — compteur = commits React sur le module d'entrée réel, 3 garde-vie à 1 Hz sur
3 007 ms ⇒ **0 rendu** ; falsification 3 rendus injectés ⇒ **REJET (exit 1)**.
Réserve unique, nommée : **pas dans une fenêtre Electron** (lib système absente, exit 127) — jsdom 26.
