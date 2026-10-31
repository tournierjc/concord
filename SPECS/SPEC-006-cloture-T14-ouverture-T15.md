# SPEC-006 — Clôture de T14, ouverture de T15 : le plan média existe, l'app ne parle pas encore

Régie · 2026-10-31 · statut : **T14 clos par mesure, T15 ouvert**

---

## 1. Le problème, en une phrase

T14 a produit un plan média WebRTC correct et testé **que rien n'appelle** : le code de la voix
existe, le produit n'a toujours pas de voix. Ce n'est plus « il n'y a pas de code » (VERIF-014),
c'est « le code n'a pas de consommateur et le runtime Chromium ne démarre pas ici ».

## 2. Ce qui est certifié — mes chiffres, pas ceux de la flotte

Mesure de la régie, `2026-10-31T01:32:11Z → 01:32:21Z`, sur `/work/lan-voice`.

| # | mesure (sans pipe, exit réel) | résultat |
|---|---|---|
| 1 | `find src -name "*media*"` | `src/engine/rtc/media-config.ts`, `src/engine/rtc/media-plane.ts` **présents** |
| 2 | `sha256sum src/engine/rtc/media-plane.ts` | **`9dbba690077c960b74022668f684308fe96a2fe8a15c997b57fc181ac9090327`**, 14 217 o |
| 3 | `grep -rn RTCPeerConnection src --include=*.ts \| wc -l` | **8** — dont **6** dans `media-plane.ts`, 2 dans `media-config.ts`, **0 en prose seule** |
| 4 | `npx tsc -p tsconfig.json --noEmit` | **EXIT=0** |
| 5 | `npx tsx --test tests/*.test.ts` | **431 tests, 431 pass, 0 fail** (sommaire TAP lu tel quel) |
| 6 | `npm run build` | **EXIT=0** |
| 7 | `sha256sum dist/main/index.js` | **`77534730cf9f44cec6f40772955b82d0503cf16a233ec9242122ed56338fe981`**, 19 530 o |
| 8 | `grep -c '"ws"' package.json` | **0** (runtime) — `@types/ws` subsiste ligne 29 (résidu, cf. §5) |

Le n° 7 vaut certification croisée : c'est **exactement** le hash annoncé par Cadre pour son build
de 01:27:51Z. Deux builds indépendants, même `sha256` au bit près ⇒ la chaîne de build est
déterministe, et l'écart avec le `c5d37f07…` antérieur s'explique par un commentaire de prose dans
`src/main/index.ts` (`removeComments: false`), sans ligne de code touchée.

## 3. La contradiction T14a / VERIF-014 est levée, et elle est datée

Banc conclut « Plan A impossible : `find src -name "*media*"` → rien » ; Carillon livre
`media-plane.ts` dans le même lot. Les deux ont raison : **les tâches du lot T14 ont tourné en
parallèle**, et le fichier a atterri pendant que l'audit regardait. Conséquence à assumer :

- **les 6 items « NON MESURÉS » de VERIF-014 sont périmés par cause d'absence**, pas par cause de
  nature : l'objet à falsifier existe désormais. Ils doivent être rejoués (T15c), pas archivés ;
- la seule exception reste tout ce qui exige un vrai Chromium (§4) : là, le blocage est réel et
  n'a rien à voir avec le lot.

## 4. Le runtime réel ne démarre pas ici — mesuré, pas supposé

```
./node_modules/electron/dist/electron --version   →  EXIT=127
ldd … | grep "not found"  →  26 bibliothèques absentes
```

Manquent la pile X/GTK et l'audio système : `libgtk-3`, `libglib-2.0`, `libgobject-2.0`,
`libgio-2.0`, `libX11`, `libxcb`, `libgbm`, `libdrm`, `libasound`… Ce n'est ni une question de
droits ni une régression du projet : c'est l'image d'exécution qui n'a pas d'affichage ni de
serveur de son. **Toute mesure qui exige du son réel reste donc NON MESURÉE** : écho de bout en
bout, deux machines en mDNS, perte 5 %, CPU sous charge. Je ne les déclarerai pas faites.

Corollaire de méthode : la falsification utile passe par un **faux `RTCPeerConnection` en Node**,
pas par Chromium. `media-plane.ts` est écrit en types DOM purs et n'importe aucune API Node ; il
suffit de lui fournir le global. C'est le seul angle qui rend le plan média falsifiable aujourd'hui.

## 5. Ce qui n'est pas rendu, dit comme tel

1. **Aucun consommateur.** `grep -rn "media-plane" src` → zéro import hors du module lui-même ;
   `grep -c createMediaPlane dist/renderer/assets/index.js` → **0** (43 modules transformés, aucun
   n'est le plan média). `Room.tsx` n'appelle pas la voix. Un module sans appelant n'est pas une
   fonctionnalité : **le chat vocal ne parle pas.**
2. **Résidu d'hygiène** : `@types/ws` ligne 29 de `package.json` alors que le runtime `ws` est
   parti. Une ligne, pour Cadre.
3. Les 4 mesures audio réelles listées au §4 : absentes, et je ne les compte pas.

## 6. Critères d'acceptation de T15 (mesurables, un par un)

| Id | Critère | Preuve attendue |
|---|---|---|
| A1 | La voix est branchée dans le renderer | `grep -c createMediaPlane dist/renderer/assets/index.js` **≥ 1**, et le module apparaît dans la liste des modules Vite |
| A2 | Le PTT coupe vraiment le micro au repos | test Node ou banc : `setTransmitting(false)` ⇒ `track.enabled === false` sur **tous** les pairs |
| A3 | Une `RTCPeerConnection` par pair, jamais réutilisée | compteur du faux constructeur : N pairs ⇒ N constructions, 0 réutilisation |
| A4 | Étanchéité par absence de config | `iceServers` reçu par le constructeur === `[]`, **toujours**, même si l'appelant passe une config |
| A5 | Candidat non `host` refusé | candidat `srflx`/`relay` ou IP publique ⇒ refus explicite, jamais ajouté |
| A6 | Opus 48 kHz mono 32 kbps dans le SDP émis | `maxaveragebitrate=32000`, `stereo=0`, `useinbandfec=1` présents dans le SDP après munging |
| A7 | Build déterministe | `npm run build` EXIT=0 **et** `sha256` relevé, comparable d'un build à l'autre |
| A8 | Aucune sortie hors LAN | aucun `stun:`/`turn:`/URL absolue dans le code produit ; `fetch`/WS sortants = 0 |

## 7. Qui fait quoi

- **Carillon (T15a)** — rendre le plan média falsifiable : surface DOM injectable (sans changer le
  contrat gelé du §2 de SPEC-005), et tests Node des points A2→A6 avec un faux `RTCPeerConnection`.
- **Cadre (T15b)** — brancher la voix : `Room.tsx` appelle `createMediaPlane`, PTT de l'overlay lié à
  `setTransmitting`, `level()` sur l'anneau d'avatar, signalisation par les canaux du contrat IPC
  existant. Plus la ligne `@types/ws`.
- **Banc (T15c)** — VERIF-015 : rejouer les 6 items périmés de VERIF-014 contre l'artefact présent
  (`9dbba690…`), exécuter le banc A2→A6 en Node, et chiffrer ce qui reste hors d'atteinte avec
  l'exit code qui le prouve.

**Ligne tenue** : aucune sortie hors LAN, aucun compte, et rien de moitié rendu — A1 est le critère
qui empêche de revendiquer la voix tant qu'elle n'est pas appelée par un écran.
