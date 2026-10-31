# VERIF-020 — T16d (SPEC-009) : câblage du maillage, rejeu indépendant des six critères

Banc (desk-qa) · **2026-10-31, mesures entre 02:08:37Z et 02:11:30Z** · arbre `/work/lan-voice`
Node **v22.23.4** · tsx **v4.23.15** · aucun Chromium (image : 26 `.so` absentes, cf. VERIF-015).

## 0. Les cinq chiffres à retenir

1. **DÉFAUT-C : fermé en source**, vérifié à deux niveaux (§2).
2. **DÉFAUT-D : NON fermé, mesuré** — 2 candidats ramassés par la connexion, **0 émis**, aucun avertissement (§3). Le puits est muet, pas corrigé.
3. **DÉFAUT-E : NON fermé, mesuré** — `noFlow` : 0 occurrence dans `src/`, horloge 5 s : 0 occurrence (§4).
4. **Mes six critères rejoués indépendamment : 10/10 verts** (§5) et **falsifiables** : 7 mutations, chacune fait rougir le test visé et lui seul (§6).
5. **La suite de Cadre est falsifiable sur trois axes** (drain → T1+T2, purge → T6, ordre → T4), mais **son T3 ne peut pas rougir** : il n'assert que la moitié négative de son critère (§7).

Empreintes au moment des mesures (elles sont aussi une garde : test X4 de mon harnais rougit si l'une bouge) :

| fichier | sha256 (12 premiers) | état |
|---|---|---|
| `src/engine/net/mesh.ts` | `3b6d6ab8c9d9` | **= empreinte gelée de la régie** |
| `src/engine/rtc/media-plane.ts` | `54709eacf758` | **= empreinte gelée** |
| `tests/mesh.test.ts` | `34b827cbb862` | **= empreinte gelée** |
| `src/renderer/voice-mesh.ts` | `7e2e20689ad2` | nouveau (T16d), vivant |
| `src/renderer/voice.ts` | `b55144b89fcd` | réécrit par T16d |
| `src/renderer/audio-sink.ts` | `5a9313ffb447` | inchangé depuis DÉFAUT-C |

Les trois empreintes gelées sont **identiques à celles que la régie tient** : aucun écart d'API sur
`mesh.ts` / `media-plane.ts` / `mesh.test.ts` pendant T16d. `voice-mesh.ts` et `voice.ts` étaient
stables de 03:07 à 03:11 (heure locale) : mes mesures ne courent pas après un fichier en cours
d'écriture — ce point a coûté une passe, voir §8.

---

## 1. Méthode

Deux harnais, hors `tests/` (la liste de `test:node` est écrite à la main et gardée par
`tests/scripts-coverage.node.test.ts` ; un fichier de plus dans `tests/` ferait rougir cette garde) :

- `.verif-t19/banc-t16d.node.test.ts` — **rejeu indépendant** des six critères de SPEC-009 §3, écrit
  depuis la spec, pas depuis le code de Cadre. 10 tests. Il pilote la couture `createVoiceWiring` par
  sa surface publique, retient `getUserMedia` (pour mesurer ce qui se passe *pendant* le vol), espionne
  le plan média réel et lit ce qui sort sur le fil (`send`).
- `.verif-t19/mut/M*/` — copies **de la source** avec une mutation ciblée, rejouées par le **même**
  fichier de test via `VERIF_ROOT`. Une mutation est un remplacement de chaîne **exacte** : si le
  texte a bougé, la mutation échoue bruyamment plutôt que de produire un faux vert.

Reproductibilité : `VERIF_ROOT=<copie> npx tsx --test .verif-t19/banc-t16d.node.test.ts`.

---

## 2. DÉFAUT-C (« aucun puits audio ») — FERMÉ EN SOURCE, deux niveaux de preuve

Régie l'avait mesuré à 03:0x ; je le re-mesure, sans le recopier.

- **Niveau source** : `src/renderer/audio-sink.ts` (`5a9313ffb447…`, 5 498 o) expose un registre ;
  `voice.ts` crée un `<audio>` par pair et `attach(peerId, stream)` au `onRemoteStream`.
  `grep -rn "<audio" src/renderer` → **5** occurrences : 2 dans `audio-sink.ts` (le seul fichier qui
  crée l'élément), 3 en commentaires dans `voice.ts` — **aucun** élément construit ailleurs.
- **Niveau exécution** (test X3 de mon harnais, hôte factice) : `ensure('A')`, `ensure('B')`,
  `attach('A', flux)` → **2 éléments créés, 1 seul porte le flux**, `clear()` en retire **2**.
  Un `<audio>` par pair : mesuré, pas supposé.

**Réserve nommée** : le plan média ne dit pas de quel pair vient le flux (`onRemoteStream` n'a qu'un
paramètre). `voice.ts` attribue donc le flux au « premier pair connu sans flux », à défaut le nomme
`distant-<n>`. C'est déclaré dans le code. Conséquence : avec deux pairs qui arrivent avant le premier
flux, le son peut être **étiqueté sur le mauvais pair** dans l'interface. Non mesurable ici (il
faudrait deux flux réels) : **NON VÉRIFIÉ**, pas « conforme ».

---

## 3. DÉFAUT-D (ICE) — **NON fermé, et mesuré comme tel**

Ce que fait T16d : `createMediaPlane` est appelé **sans** `onLocalCandidate`, et aucun `sendCandidate`
ne subsiste. C'est conforme à la lettre de SPEC-009 §1(b). Ce que ça produit :

```
[T3c] RTCPeerConnection construites = 1
[T3c] candidats ramassés = 2 | messages ice émis = 0
[T3c] avertissements du plan = []
```

**Protocole exact** : `npm test` vert, `openVoice` démarré, une offre entrante → 1 `RTCPeerConnection` ;
puis **2 candidats host injectés dans `onicecandidate`** (comme Chromium les produit), plus le marqueur
de fin de ramassage. Mesure : **0 message `ice` sur le fil, 0 avertissement** — les candidats sont
**jetés silencieusement**.

Trois faits rendent la conclusion solide, tous mesurables ici :

1. `grep -c "icegathering" src/engine/rtc/media-plane.ts` → **0** : le plan média **n'attend pas** la
   fin de ramassage avant de rendre son SDP ;
2. `grep -rn "onLocalCandidate" src/` → l'option est **déclarée** (`media-plane.ts:47`), **utilisée**
   dans son propre `onicecandidate` (`:251`), et **fournie par personne** côté renderer ;
3. `mesh.ts` (gelé) **n'a aucun canal de candidats** : 0 occurrence de `kind: 'ice'` émis, aucun champ
   de `MeshOptions` (`onLocalCandidate`, `sendCandidate`, `candidate`) — vérifié à l'exécution sur la
   surface réelle de l'objet rendu : `["close","onSignal","peers"]`.

**Donc** : l'arbitrage « le maillage devient seul propriétaire de l'ICE » supprime le seul émetteur qui
existait (une diffusion mal adressée) **sans en mettre un autre en place**. Avec `iceServers: []`,
aucun chemin ne peut être trouvé. Le seul espoir serait que le SDP porte des candidats `a=candidate`
en ligne — ce qui n'est **pas garanti** par la spec WebRTC sans attente de ramassage (fait 1) et
**non mesurable sans Chromium** (voir §9).

**Écart d'API à arbitrer (c'est celui que la régie demandait de signaler)** : la correction propre
exige un canal qui n'existe pas. Deux chemins, tous deux hors des contrats gelés actuels :

- (a) rendre `mesh.ts` propriétaire pour de vrai : ajouter à `MeshOptions` un point d'entrée candidats
  (`onLocalCandidate(candidate, peerId)` ou `sendCandidate`), et que le renderer le lui passe →
  **casse l'empreinte gelée `3b6d6ab8…`** ;
- (b) garder l'émission côté coquille mais **corriger l'adressage** : il faut que
  `media-plane.onLocalCandidate` porte l'identité du pair → **casse l'empreinte `54709eac…`**.

Il n'existe pas de troisième voie : le pair émetteur de la connexion est connu du seul plan média, et
le contrat gelé ne le transmet pas. **Décision produit, pas correctif de banc.**

Note de traçabilité : le commentaire d'en-tête de `voice.ts:31` nomme ce défaut **« DÉFAUT-E »**, alors
que la nomenclature de la régie l'appelle **DÉFAUT-D** (`E` = UI ne distingue pas connecté/échec). Deux
défauts, une lettre : à réaligner avant que le suivi ne dérive.

---

## 4. DÉFAUT-E (l'UI ne distingue pas « connecté » d'« échec ») — **NON fermé, mesuré**

SPEC-008 impose **5 paliers** (`connecting → connected → speaking → noFlow → failed`), `Connecté`
exigeant **lien + flux < 5 s**, et `noFlow` démarrant **exactement à 5 s**.

- `grep -rn "noFlow" src/renderer` → **uniquement des commentaires** (`voice-mesh.ts:35`, `:46`) qui
  disent que `speaking`/`noFlow` « restent à l'interface ». Aucune implémentation.
- `grep -rn "5000\|5_000" src/renderer` → **0 occurrence** : l'horloge des 5 s n'existe pas.
- `onPeerState` du maillage porte **2 arguments** (`peerId`, état) et n'observe que
  `connecting`/`connected`/`failed` — mesuré à l'exécution (`[["B","connecting"],["C","connecting"]]`).
  Aucune cause (`cause.ice`, `cause.timeout`) n'est transmise : le `detail?` de SPEC-009 §2 n'a pas de
  source dans le contrat gelé. `failed` reste donc indiscernable d'un délai dépassé.

Conséquence : aujourd'hui, un pair dont la connexion échoue et un pair en attente s'affichent de la
même façon, et **rien** ne distingue « connecté » de « connecté sans flux ». DÉFAUT-E est ouvert, et
sa fermeture complète bute sur le même mur que DÉFAUT-D (identité du pair absente des callbacks du
plan média, cause d'échec absente du maillage).

---

## 5. Rejeu indépendant des six critères — 10/10 verts

`.verif-t19/banc-t16d.node.test.ts`, arbre courant, 2026-10-31T02:11Z.

| critère | ce que je mesure (et non ce que le code prétend) | verdict |
|---|---|---|
| **T1** | 3 messages injectés pendant que `getUserMedia` est **retenu** : `sent=0`, aucun `attach`/`accept`, `buffered=3` ; après libération, tout est routé. Le premier geste du plan vient **après** l'ouverture du micro. | PASS |
| **T2** | 3 offres reçues avant l'existence du mesh → routées au plan **dans l'ordre** `accept:B, accept:C, accept:D`, **une fois chacune**. Le test mesure la **vidange**, pas l'arrivée (`onMessage` se déclenche à l'entrée et ne prouverait rien). | PASS |
| **T3** | 1 seul site `createMesh(` en production (`voice-mesh.ts:143`), **0** `onLocalCandidate` côté renderer, **0** `sendCandidate`. | PASS |
| **T3b** | Tout message sortant porte un destinataire ; ICE sortante comptée : **0**. | PASS (vacuité assumée, voir §7) |
| **T3c** | Candidat réellement ramassé → **0 émis** (mesure du puits, cf. §3). | PASS |
| **T4** | Ordre de fermeture : `fermeture:mesh` **avant** `fermeture:plan` ; `plane.close()` appelé **2 fois**. | PASS (double fermeture déclarée idempotente) |
| **T5a** | `openVoice('salon-1','moi')` ×2 → 1 seul `getUserMedia` ; après `closeVoice`, `status=idle`, `peers=[]`. | PASS (partiel, voir §9) |
| **T6** | 16 candidats précoces → `purged: 16` sur **une** ligne, **0 rejeu**. | PASS |
| **T6b** | Aucun appelant de production ne fournit `earlyCandidates`. | PASS (= **la purge ne s'exécute jamais en production**, voir §7) |
| **X4** | Les 3 empreintes gelées sont inchangées. | PASS |

Point d'honnêteté sur mon propre harnais : deux de mes assertions étaient fausses au premier jet, et je
les ai corrigées après les avoir vues mentir — (i) T1 comptait `startMicrophone` (qui **est**
`getUserMedia`) comme un « geste avant le micro » ; (ii) T4 cherchait `/mesh/i` dans les diagnostics et
matchait `mesh:ouvert`, émis au **démarrage** : le test était vert par accident, la mutation d'ordre
passait. Ancré sur `^fermeture:mesh\b`, il rougit correctement (§6, M3).

---

## 6. Falsifications — 7 mutations, 7 rouges attendus et obtenus

Instantané figé (`.verif-t19/snap/`, `voice-mesh.ts 7e2e20689ad2`, `voice.ts b55144b89fcd`) puis
baseline **9/9 vert** et 7 copies mutées rejouées par le **même** fichier :

| mutation | ce qu'elle casse | rouges observés | verdict |
|---|---|---|---|
| `M1_drain` | vidange du tampon supprimée | **T1, T2** | le test de la vidange mord |
| `M2_ice_hors_mesh` | `onLocalCandidate` recâblé côté renderer | **T3** | l'ownership de l'ICE est gardé |
| `M2b_send_candidate` | un `sendCandidate` diffusant réapparaît | **T3** | idem, par l'autre moitié |
| `M3_ordre_close` | plan fermé **avant** le mesh | **T4** et lui seul | l'ordre est gardé |
| `M4_purge` | compte de purge supprimé | **T6** | le compte est gardé |
| `M5_tampon` | tampon supprimé (messages jetés) | **T1, T2** | idem M1 par l'autre bout |
| `M6_empreinte` | `mesh.ts` touché d'un commentaire | **X4** et lui seul | la garde d'empreinte mord |

Aucune mutation ne laisse la suite entièrement verte : **le harnais n'est pas tautologique**.

### La falsification que la régie avait écrite d'avance

> « retirer le vidage de la file des messages reçus pendant `getUserMedia` doit ROUGIR T2 »

**Vérifiée sur les deux suites, même mutation, même instantané** :

- mon T2 : rouge (`vidange absente ou désordonnée : []`) ;
- **la suite de Cadre** (`tests/voice-mesh.node.test.ts`, 6 tests) : **4 pass / 2 fail — T1 et T2
  rouges**. Baseline de sa suite sur le même instantané : **6/6 pass**.

Idem pour ses T4 et T6 : ordre inversé → **T4 rouge** ; purge supprimée → **T6 rouge**. Ses tests ne
sont donc pas décoratifs sur ces trois axes.

---

## 7. Ce que le vert ne prouve pas — trois angles morts mesurés

1. **Le T3 de Cadre ne peut pas rougir sur le défaut qu'il visait.** Il s'intitule « l'ICE entrant va au
   bon pair, **rien ne sort** » et n'assert que la moitié négative. SPEC-009 §3, lui, exige la moitié
   positive : « **tout ICE sort par le `send` du mesh avec un peerId** ». Or rien ne peut sortir (§3).
   Son vert **est le symptôme**, pas la preuve : il restera vert tant que le puits est muet, donc aussi
   longtemps que DÉFAUT-D est ouvert. Le critère est **à moitié couvert, et la moitié couverte est celle
   qui passe quand la fonctionnalité est absente**.
2. **`purged: N` vaut toujours `purged: 0` en production.** Mesuré dans les diagnostics de T2 et T4 :
   `"ice sans destinataire — purged: 0"`. Aucun appelant ne fournit `earlyCandidates` (T6b). Le T6 de
   Cadre est falsifiable (M4 le rougit), mais il mesure une **file que la production ne remplit jamais** :
   la ligne existe, le mécanisme est mort. Il n'y a pas de « candidats hérités » : il n'y a plus aucun
   candidat du tout.
3. **Le site unique de `createMesh` est dans `voice-mesh.ts:143`, pas dans `voice.ts`.** L'invariant de
   la régie (« exactement 1, dans voice.ts, 0 ailleurs ») est satisfait **d'esprit** (1 site, renderer,
   la couture que `voice.ts` instancie) et **pas de lettre** : `grep -rn "createMesh(" src/renderer/voice.ts`
   → 0. Risque concret : un contrôle qui grep `voice.ts` lit 0 et conclut « maillage non câblé », puis
   « corrige » en ajoutant un **deuxième** mesh. La formulation de l'invariant doit nommer le fichier
   qui le porte, ou dire « 1 dans `src/renderer` ».

---

## 8. Invariants re-mesurés (arbre vivant, 02:11:30Z)

| contrôle | commande | résultat |
|---|---|---|
| suite du dépôt | `npm test` | **EXIT=0** · **21 fichiers** · **536 tests** · **536 pass** · **0 fail** · **34 suites** · 537 ms |
| types | `npx tsc -p tsconfig.json --noEmit` | **EXIT=0**, 0 ligne |
| build principal | `npm run build:main` | **EXIT=0** |
| build renderer | `npx vite build` | **EXIT=0**, 434 ms |
| sites `createMesh(` (hors définition) | `grep -rn "createMesh(" src` | **1 actif** (`voice-mesh.ts:143`) + 3 en commentaires |
| socket dans le renderer | `grep -rn "lan:signal" src/renderer \| wc -l` | **0** |
| `<audio>` | `grep -rn "<audio" src/renderer` | **5** (2 dans `audio-sink.ts`, 3 en commentaires) |
| dépendances | `package.json` | **1** runtime (`bonjour-service`), 11 dev ; **aucun ajout** (le retrait de `ws` est antérieur à T16d : `package.json.bak` le porte encore) |

Le compte de tests est passé de 530 (VERIF-019, 20 fichiers) à **536 (21 fichiers)** : les 6 tests et
le fichier `tests/voice-mesh.node.test.ts` de Cadre, **déjà dans la liste écrite à la main** (la garde
`scripts-coverage` serait rouge sinon — elle est verte).

Une passe a été jetée : entre deux exécutions séparées de 50 s, l'ordre de fermeture de `voice-mesh.ts`
a changé sous mes yeux (le plan avant le mesh, puis l'inverse). Depuis, **mesure sur instantané figé**,
shas publiés, baseline et mutations sur le **même** instantané. Une falsification sur un arbre qui bouge
ne vaut rien.

---

## 9. NON VÉRIFIÉ — nommé comme tel

1. **L'audio sort-il par le haut-parleur ?** Aucun Chromium dans l'image (`electron --version` → 127,
   26 `.so` absentes). DÉFAUT-C est fermé **en source** et mesuré au registre (§2) : je n'ai pas
   entendu un son.
2. **Le SDP porte-t-il des candidats en ligne ?** Non décidable ici : dépend du comportement de
   `setLocalDescription` sous Chromium. Si oui, DÉFAUT-D serait inoffensif ; si non (comportement
   standard, ramassage asynchrone), **aucune connexion ne peut aboutir**. C'est la mesure qui manque, et
   elle demande un runtime navigateur.
3. **T5 en conditions réelles** : le déclencheur `retrying → suspendVoice()` vit dans le hook
   `useVoicePlane` (`voice.ts:544-549`) — non exécutable sans renderer React. Je n'ai mesuré que
   l'idempotence par clé (`openVoice` ×2 → 1 micro). Le test T5 de Cadre couvre la couture, pas le hook.
4. **Deux pairs réels sur le LAN** : la latence, le CPU, le débit, la perte de 5 % de VERIF-014 restent
   non re-mesurés après T16d — le trafic de signalisation n'a pas changé de nature (`lan:signal` : 0
   dans le renderer, tout passe par l'IPC), mais **la voix ne peut pas être établie** (§3), donc ces
   mesures n'ont pas d'objet tant que DÉFAUT-D est ouvert.

---

## 10. Commandes exactes (annexe)

```bash
# 1. rejeu indépendant des 6 critères (10 tests), arbre vivant
cd /work/lan-voice && VERIF_ROOT=/work/lan-voice \
  npx tsx --test .verif-t19/banc-t16d.node.test.ts

# 2. instantané figé + baseline + 7 mutations (shas publiés en tête de sortie)
bash ~/.mercury/bots/desk-lead/desk-qa/sandbox/snap-falsify-t19.sh

# 3. falsification des tests de Cadre sur copies mutées (patron : 6/6, puis 4/2, 5/1, 5/1)
bash ~/.mercury/bots/desk-lead/desk-qa/sandbox/falsify-cadre-t19.sh

# 4. invariants (npm test, tsc, build:main, vite build, greps, dépendances)
bash ~/.mercury/bots/desk-lead/desk-qa/sandbox/invariants-t19.sh
```

Harnais : `/work/lan-voice/.verif-t19/` (`banc-t16d.node.test.ts`, `snap/`, `mut/M1…M6`).
Scripts : sandbox desk-qa (`snap-falsify-t19.sh`, `falsify-cadre-t19.sh`, `invariants-t19.sh`,
`mutate-t19.mjs`, `run-t19.sh`).

---

## 11. Verdict

| item | état |
|---|---|
| DÉFAUT-C — puits audio | **FERMÉ-EN-SOURCE** (2 niveaux de preuve) · réserve : flux étiqueté au « premier pair sans flux », non mesuré avec 2 flux réels |
| DÉFAUT-D — ICE | **OUVERT, mesuré** : 2 candidats ramassés → 0 émis, 0 avertissement · **bloqué par contrat gelé** : aucun canal de candidats dans `mesh.ts`, aucune identité de pair dans `media-plane.onLocalCandidate` |
| DÉFAUT-E — états de liaison | **OUVERT, mesuré** : `noFlow` absent, horloge 5 s absente (0 occurrence), `onPeerState` sans cause |
| T16d — câblage | **1 site, renderer, conforme** ; 10/10 critères rejoués verts ; 7/7 mutations rougissent la cible |
| Suite de Cadre | **falsifiable ×3** (drain, purge, ordre) · **T3 à moitié couvert** (moitié négative seule) |

**Ce que je recommande à la régie** : arbitrer DÉFAUT-D **avant** de considérer T16d clos. Les trois
défauts de la voix (C, D, E) ont la même racine — les callbacks du plan média ne portent pas l'identité
du pair, et le maillage n'a pas de canal de candidats. Fermer C sans D laisse une application qui
construit un haut-parleur par pair **et ne peut pas établir la connexion qui l'alimenterait**.
