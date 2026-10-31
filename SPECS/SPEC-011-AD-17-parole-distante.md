# SPEC-011 — AD-17 : la parole distante, qui la produit et où elle vit

Rév. 1 — 2026-10-31 · Régie (desk-lead) · issue de la trouvaille de Cadre (desk-shell, T18) :
`SpeakingEventDto` a un consommateur (`room-bridge.applySpeaking`, `onSpeaking` preload) et
**aucun producteur dans `src/`**. Question posée par Cadre : d'où doit venir l'événement ?
Conséquence mesurée : le halo d'un pair (SPEC-010 §4) ne peut pas s'allumer, même bien câblé.

## 1. Le problème, énoncé sans détour

Trois faits, vérifiés dans le code ce tour :

1. **Le process principal n'a aucun audio.** WebRTC, `getUserMedia`, `MediaStream` et
   `AnalyserNode` vivent dans le renderer (`src/engine/rtc/media-plane.ts:216-220`). `src/main/`
   ne voit jamais un échantillon. Aucun producteur de `lan:event:speaking` ne peut donc naître
   côté main — si on l'écrit quand même, il inventera.
2. **Le niveau distant existe déjà, mais agrégé.** `media-plane.level()` (`:354`) fait un RMS
   maximum **sur tous les analyseurs confondus** : `meters` est un tableau plat, un analyseur par
   flux entrant, sans identité. La mesure est vraie, l'attribution est absente.
3. **L'attribution est exactement DÉFAUT-C.** `onRemoteStream(stream)` ne porte pas de `peerId`
   (contrat gelé), d'où l'étiquetage heuristique `distant-<n>` de `voice.ts`. AD-16 a corrigé la
   même forme de défaut sur les candidats ICE (`onLocalCandidate(peerId, cand)`). Le flux entrant
   n'a pas encore reçu le même traitement.

**Donc : la parole distante n'est pas un problème de producteur d'événement. C'est DÉFAUT-C.**
Tant que le flux entrant ne dit pas de quel pair il vient, tout halo de pair est un mensonge
possible — et `distant-<n>` est le nom du mensonge.

## 2. Décision (AD-17)

**D1 — La parole distante est un état temps réel du plan média, pas une propriété d'annuaire.**
Elle ne transite pas par le main. `SpeakingEventDto`, `IPC.eventSpeaking`, `applySpeaking` et
`onSpeaking` sont **retirés** du contrat. Un canal IPC à 20 Hz pour un booléen que le renderer
mesure déjà est un aller-retour sans information ; et un canal sans producteur est précisément
ce qui a fait écrire `data-speaking="false"` en dur dans `Room.tsx`. On ne remplace pas une
absence par un abonnement.

**D2 — `ParticipantDto` perd `speaking`.** L'annuaire (id, nom, `muted`, `deafened`, `gain`,
`connection`) vient du main ; la parole vient du média. Mélanger les deux dans une seule structure
oblige à écrire `speaking: false` pour un participant dont on ne sait rien
(`room-bridge.ts:101`) — c'est une affirmation de silence, exactement la faute corrigée par Cadre
au niveau de l'attribut. `participant-state.ts` garde son ternaire `true|false|unknown` et devient
la seule porte d'entrée du rendu.

**D3 — Le flux entrant porte son pair : `onRemoteStream(peerId, stream)`.** Même forme qu'AD-16,
même commit, même exigence de revue : **les deux fichiers ensemble** (`mesh.ts` + `media-plane.ts`),
jamais l'un sans l'autre. Application partielle = refus. C'est Carillon qui tranche le point
d'appel exact ; l'invariant est : un flux reçu sans `peerId` connu est **compté et tracé**
(`unattributed: N`), jamais nommé `distant-<n>` à l'écran, et **jamais** rattaché au premier pair
venu. Le repli `distant-<n>` disparaît de l'interface ; il peut rester une ligne de diagnostic.

**D4 — Un analyseur par pair, lu par `level(peerId)`.** `MediaPlane.level(peerId)` rend
`number | null` : `null` = aucun analyseur pour ce pair (pas de flux, piste terminée, mesure
périmée) — jamais `0`, jamais « silencieux ». `level()` sans argument (agrégat) reste pour le
vumètre global existant, il n'est pas une source de parole.

**D5 — Une seule définition de « parle », locale et distante.** On réutilise les constantes de
`src/engine/vad.ts` (OPEN_DBFS −38, CLOSE_DBFS −45, ATTACK 2 trames / 40 ms, RELEASE 6 trames /
120 ms), via un helper exporté unique `speakingFromLevel(prev, levelDb)`, plutôt que d'inventer
un second seuil. Le lointain a déjà franchi sa propre porte : en réutiliser l'hystérésis garantit
que le halo du pair et l'indicateur de l'émetteur ne se contredisent pas sur le même son. On
**n'applique pas** ZCR/voisé côté distant (le signal reçu est déjà passé par la porte et RNNoise ;
re-juger la voisement ajouterait une deuxième opinion sur la même trame).

**D6 — Péremption à 250 ms.** Sans échantillon depuis 250 ms, l'état du pair retombe à
`'unknown'` (pas `false`). 250 ms ≈ deux trames de relâche + marge : en dessous on clignote, au
delà on affirme un silence qu'on ne mesure plus.

## 3. Ce que ça change pour SPEC-010 §4

§4 devient vérifiable : `peerSpeaking(peerId)` lit `level(peerId)` → `speakingFromLevel` →
`'true' | 'false' | 'unknown'`. Le critère « le halo ne s'allume que si un pair parle vraiment »
devient mesurable sans navigatrice : une table de niveaux injectée suffit.

## 4. Qui fait quoi

- **Carillon (desk-engine)** — D3 + D4 + D5 : `onRemoteStream(peerId, stream)` (mesh + plan, même
  commit), analyseurs indexés par pair, `level(peerId): number | null`, helper
  `speakingFromLevel` exporté depuis `vad.ts` réutilisant les constantes, `unattributed` compté et
  tracé. Nouvelles empreintes à geler au commit ; celles d'AD-17 remplacent, elles ne coexistent pas.
  Il reprend en même temps le T17 resté ouvert (DÉFAUT-D deux-fichiers, DÉFAUT-E `noFlow` +
  `onPeerState(peerId,state,cause)`) : c'est le même commit de contrat, le séparer produirait une
  troisième empreinte et deux revues.
- **Cadre (desk-shell)** — D1 + D2 : retrait de `eventSpeaking`/`applySpeaking`/`onSpeaking` du
  contrat, du preload et de `room-bridge` ; suppression du `speaking: false` de l'annuaire ;
  `Room.tsx` / `Overlay.tsx` branchés sur la source média avec le ternaire et la péremption 250 ms.
  Il garde son correctif T18 tel quel (il est juste) et doit encore le renommage
  `voice.peer.mute` → `pending` de Maquette.
- **Banc (desk-qa)** — trois mutants neufs, un rouge chacun : (M-a) réintroduire un `speaking`
  dans `ParticipantDto` ⇒ rouge ; (M-b) `level(peerId)` rendant `0` au lieu de `null` pour un pair
  sans analyseur ⇒ rouge ; (M-c) supprimer la péremption ⇒ un pair muet reste `'false'` après
  250 ms ⇒ rouge. Plus une garde statique : aucun abonné `lan:event:speaking` sans producteur.

## 5. Non mesuré, et dit comme tel

- Chromium réel toujours `EXIT=127` : le halo n'a été vu par personne. Oreille humaine : NON MESURÉE.
- Le comportement de `AnalyserNode` sur une piste `muted` (le pair se coupe) : à trancher par
  mesure, pas par raisonnement — un pair muet doit rendre `'unknown'` **ou** mesuré silencieux,
  les deux sont défendables, aucun n'est prouvé. Banc instruit ce point au T19.
- Les 2 tests rouges de pureté SPEC-004 (`setTimeout` dans `mesh.ts` / `media-plane.ts`) restent
  rouges et inchangés ; ils ne sont pas une régression d'AD-17.
