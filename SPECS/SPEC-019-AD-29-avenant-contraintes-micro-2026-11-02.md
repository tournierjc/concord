# SPEC-019 — Avenant 2026-11-02 : contraintes micro réglables (arbitrage JC)

Régie · 2026-11-02 · statut : **amendement de SPEC-004 §3 / SPEC-005 §2, arbitrage JC**
(pieuvre du diagnostic 0.4.2 : « voice detection doesn't seem to work », causes #1 et #2)

---

## 1. L'objet, en une phrase

Les réglages `audio.inputDeviceId`, `audio.noiseSuppression`, `audio.echoCancellation` et
`audio.inputGain` étaient écrits dans `settings.json` par l'UI et **lus par personne** : le micro
était capturé en toutes circonstances avec NS + EC + AGC forcés et le périphérique défaut du
système (`MIC_CONSTRAINTS`, media-config.ts). JC arbitre le 2026-11-02 : le branchement de ces
réglages jusqu'au `getUserMedia` est autorisé, comme **amendement ciblé** de ce que SPEC-004 §3
et SPEC-005 §2 tenaient figé.

## 2. Ce qui est amendé, et pourquoi ce n'est pas le contrat média

Le contrat gelé de SPEC-005 §2 est le **contrat média** : `MediaPlaneOptions`, la signature des
méthodes de `MediaPlane`, la sémantique de `level(peerId)`, le munging Opus, la configuration ICE
LAN-only. Les **contraintes de capture** (`MIC_CONSTRAINTS`) ne sont pas ce contrat : elles ne
voyagent jamais sur le réseau, ne touchent ni à ICE ni à Opus ni à la topologie du maillage. Un
`deviceId` ou un booléen `noiseSuppression` passés à `getUserMedia` ne changent rien de ce que
SPEC-005 fige ; ils changent seulement **quel micro parle et comment le navigateur le prétraite**.

Constat d'exécution qui rend l'amendement nécessaire (sonde `peer_probe.ts`, diagnostic 2026-11-02) :
avec NS + AGC forcés et le micro défaut imposé, un poste à plusieurs entrées (casque USB, micro de
caméra, micro virtuel) capture une source qui ne capte rien — le RMS post-traitement reste à 0,001,
la table `PEER_LEVELS` ne reçoit que `'false'`, le halo ne s'allume jamais. Le réglage qui
permettrait de le corriger existait : il n'avait aucun consommateur.

## 3. Les conditions (liste close — aucun élargissement sans nouvel avenant)

1. **Un seul fichier du moteur touché** : `src/engine/rtc/media-config.ts`.
   `src/engine/rtc/media-plane.ts` reste **intact** — l'appelant passe les contraintes prêtes
   sous la clé `audio` de l'objet `getUserMedia`, la forme `{ audio: constraints }` de l'appel
   existant est conservée.
2. **La valeur par défaut est inchangée** : `MIC_CONSTRAINTS` (mono, EC/NS/AGC à `true`) reste
   la valeur exacte rendue quand l'appelant n'a rien à dire. Un poste sans réglage personnalisé
   capture exactement comme avant 0.4.2 — l'amendement n'est pas une régression déguisée.
3. **La portée de la dérogation est la capture, rien d'autre** : le champ additionnel
   `MediaPlaneOptions.microConstraints` est lu à la construction par `voice-mesh.ts`, qui est
   **déjà** l'appelant autorisé du constructeur ; `createMediaPlane` n'est pas modifié ailleurs,
   `lanOnlyConfiguration` garde `iceServers: []` imposé, et les seuils du VAD du moteur
   (`OPEN_DBFS`/`CLOSE_DBFS`) ne bougent pas — le réglage `talk.vadThresholdDb` branche le seuil
   d'**affichage** (coquille), jamais la porte de l'émetteur du moteur.
4. **Les contraintes sont recalculées, jamais mutées** : la fabrique pure
   `buildMicrophoneConstraints(reglages)` rend un objet neuf ; aucune lecture d'un réglage ne se
   fait dans le moteur (le moteur ne connaît pas les réglages, c'est la coquille qui les lit et
   les traduit).

## 4. Surface implémentée

`src/engine/rtc/media-config.ts` (`MicrophoneConstraints`, `buildMicrophoneConstraints`,
champ optionnel `microConstraints` dans les options du plan média lu à la construction),
câblage coquille (`src/renderer/voice-mesh.ts`, `src/renderer/voice.ts` — seuil local
`levelToSpeaking` issu de `talk.vadThresholdDb`), tests : `tests/mic-settings-consumers.node.test.ts`.
