# SPEC-001 — Desktop LAN : application de chat vocal sur réseau local

Version : 1.0 — 2026-02-14 — Régie (chef de flotte)
Statut : **arbitrages tranchés** — exécutable par les quatre équipiers.

---

## 1. Le problème

Un groupe de personnes sur le même réseau local veut se parler comme sur un salon vocal
Discord : on rejoint un salon, on voit qui parle, on se mute, on baisse un râleur — sans
créer de compte, sans serveur chez un tiers, sans que rien ne sorte du LAN. Les solutions
existantes imposent toutes un compte (Discord, Teams), un serveur cloud (Mumble public,
Jitsi meet.jit.si) ou de la télémétrie.

Ce qu'on veut : **un exécutable qu'on lance, un salon qui apparaît tout seul sur le LAN, on
clique, on parle.** Zéro configuration réseau, zéro compte, zéro appel sortant.

Non-objectifs explicites (v1) : pas de chat texte, pas de partage d'écran, pas de
persistance d'historique, pas de traversée de NAT (le LAN est une hypothèse dure), pas de
chiffrement de bout en bout négocié (le média reste sur le lien local ; voir §7).

---

## 2. Arbitrages techniques structurants (tranchés)

| # | Sujet | Décision | Justification |
|---|-------|----------|---------------|
| A1 | Socle applicatif | **Electron + React 18 + TypeScript strict** | Demandé. Donne accès à `desktopCapturer`, aux raccourcis globaux, à une fenêtre overlay sans focus, et à `AudioWorklet` via Chromium à jour. Un seul runtime pour l'audio (Chromium) sur Linux et Windows = un seul jeu de bugs. |
| A2 | Topologie média | **WebRTC en maillage complet (full mesh)**, plafond **8 participants** (7 pairs sortants par nœud) | Sous 8, le maillage gagne : latence minimale (1 saut), pas de serveur média à installer, pas de mixage à coder. Au-delà de 8, l'uplink explose : 8 participants × 32 kbps ≈ 256 kbps montants + surcoût d'en-têtes par pair. **Garde-fou obligatoire** : le 9ᵉ participant est refusé avec un message clair dans l'UI, pas silencieusement ignoré. |
| A3 | Codec | **Opus 48 kHz mono, 32 kbps, `useinbandfec=1`, `ptime=20`** ; désactivation de RED et du stereo | La voix ne justifie pas plus. 32 kbps mono avec FEC in-band tient sur n'importe quel Wi-Fi. Mono car la spatialisation est hors périmètre et le stereo double le débit pour rien. Rééchantillonnage côté Chromium, pas à la main. |
| A4 | Découverte des pairs | **mDNS (`bonjour`/`dns-sd`)**, service `_lanvoice._udp.local` + **balayage UDP broadcast de secours** sur le port 47820 | mDNS est le standard LAN et fonctionne sans config sur macOS/Linux (avahi) et Windows 10+ (mDNS natif). Mais mDNS est capricieux (pare-feu Windows, avahi absent, réseau d'entreprise qui filtre le multicast 5353) : **le broadcast UDP de secours est obligatoire, pas optionnel**. Le beacon porte un `instanceId` aléatoire par session — voir A6. |
| A5 | Signalisation | **Serveur WebSocket local embarqué dans le process principal Electron**, port 47821, + un échange SDP/ICE direct | Pas de compte : l'identité d'un pair est son `instanceId` éphémère. Le serveur ne fait que relayer SDP/ICE entre membres d'un même salon. Il n'écrit rien sur disque. **Conflit de port** : si 47821 est pris, on incrémente jusqu'à 47830, et le port réel est publié dans le beacon mDNS. |
| A6 | Identité | **Aucun identifiant persistant.** Pseudo choisi localement (défaut = prénom du compte OS, modifiable), `instanceId` = UUIDv4 régénéré à **chaque lancement** | C'est la contrainte dure n°2. Pas de clé, pas de certificat, pas de « user id ». Deux personnes peuvent avoir le même pseudo : on affiche une pastille de couleur dérivée du `instanceId` pour les distinguer. Rien n'est conservé d'une session à l'autre sauf les préférences purement locales (périphériques, seuil VAD, raccourci) — et ces préférences sont dans un fichier local, pas indexé par une identité. |
| A7 | ICE | **`iceServers: []`** — aucun STUN, aucun TURN, `iceTransportPolicy: 'all'` mais **filtre post-gathering : on ne garde que les candidats d'hôtes RFC1918 / link-local**. Tout candidat réflexif ou relay est jeté avant d'être envoyé. | C'est la garantie mécanique du « aucun trafic hors LAN ». Le filtre est dans le code, testable, et couvert par un test unitaire (Banc). Si un candidat public apparaît, c'est un bug bloquant. |
| A8 | Suppression de bruit | **RNNoise (wasm) dans un `AudioWorklet`**, activé par défaut, désactivable | Demandé. Le wasm RNNoise tourne en 48 kHz nativement : pas de rééchantillonnage. Coût ≈ 1 % d'un cœur. Chaîne : `MediaStreamSource → [RNNoise] → GainNode (PTT/VAD gate) → sender`. |
| A9 | Annulation d'écho | **`echoCancellation: true` dans les contraintes `getUserMedia`, avec repli propre** si le pilote ne l'offre pas (on lit `track.getSettings().echoCancellation` et on affiche l'état réel, pas l'état souhaité) | Chromium fournit AEC3 ; le refaire à la main serait absurde. Mais « quand elle est disponible » est dans la demande : l'UI doit dire la vérité sur ce qui est actif. |
| A10 | Overlay | **Fenêtre Electron `BrowserWindow` transparente, `frame:false`, `alwaysOnTop` niveau `screen-saver`, `focusable:false`, `skipTaskbar:true`, `hasShadow:false`**, chargée depuis une route React séparée (`#/overlay`) | `focusable:false` est la clé du « ne vole jamais le focus ». Le niveau `screen-saver` passe au-dessus des jeux en plein écran fenêtré sans les déranger. Déplacement par `-webkit-app-region: drag` sur la poignée. |
| A11 | Push-to-talk | **`globalShortcut.register` (Electron)**, défaut **`Alt+Space`**, configurable, avec détection de conflit d'enregistrement | Un raccourci global est la seule façon de parler quand le jeu a le focus. Si l'enregistrement échoue (déjà pris par le système), on le dit dans l'UI et on propose de changer — pas de silence. |
| A12 | Détection de voix | **VAD à deux étages** : (1) `AnalyserNode` RMS + plancher de bruit adaptatif (médiane glissante 3 s) pour le **niveau de micro affiché** ; (2) **gate audio** dans l'AudioWorklet : ouverture au-dessus du seuil pendant ≥ 120 ms, fermeture sous le seuil pendant ≥ 400 ms, avec rampe de 15 ms pour éviter les clics | Un simple seuil RMS claque sur les respirations. L'hystérésis (ouvertures/fermetures asymétriques) est ce qui rend le VAD supportable. Le seuil est réglable en dBFS dans les réglages, avec retour visuel immédiat. |
| A13 | Volume par participant | **`GainNode` par pair dans le graphe de sortie local** (0 à 200 %, défaut 100 %), plus mute local par participant | Côté réception, jamais côté émission : baisser quelqu'un ne doit pas changer ce que les autres entendent. |
| A14 | Packaging | **electron-builder** : AppImage + deb (Linux x64), NSIS (Windows x64). `publish: null`. Signature de code : hors périmètre v1 (documenté comme tel). | Demandé. `publish: null` garantit qu'aucun `autoUpdater` ne peut être branché par accident. |
| A15 | Anti-télémétrie | Aucun `electron-updater`, aucun crash reporter, aucun `Sentry`. `app.setPath('crashDumps', <dossier temp>)` + `crashReporter` désactivé. **CSP interdisant tout `connect-src` hors `ws://127.0.0.1:*` et `ws://<lan>:*`** | Contrainte dure. C'est vérifiable par inspection des requêtes sortantes (Banc) et par la CSP. |

---

## 3. Écrans et états

### E1 — Fenêtre principale : « Salons »

```
┌──────────────────────────────────────────────────────────┐
│  Desktop LAN            [pseudo: Régie]     [⚙] [—][□][×]│
├──────────────────────────────────────────────────────────┤
│  Salons sur le réseau local            [ + Créer un salon]│
│                                                          │
│  ● Studio           3/8    Alice, Bob, Chloé    [Rejoindre]│
│  ● Salon de Léa     1/8    Léa                  [Rejoindre]│
│  ○ Salle réunion    8/8    (complet)            [Complet]  │
│                                                          │
│  ────────────────────────────────────────────────────────│
│  Aucun salon trouvé. Vérifiez que les autres machines     │
│  sont sur le même réseau.        [Actualiser] [Créer]     │
└──────────────────────────────────────────────────────────┘
```
États : `découverte en cours` (skeleton + spinner), `liste vide` (message + action),
`liste peuplée`, `erreur réseau` (bandeau : « Découverte mDNS indisponible —
repli broadcast actif »), `complet` (bouton désactivé, raison au survol).

### E2 — Fenêtre principale : « Dans un salon »

```
┌──────────────────────────────────────────────────────────┐
│  Desktop LAN    ● Studio  (3/8)        [📌] [⚙] [—][□][×]│
├──────────────────────────────────────────────────────────┤
│   ┌────────┐  ┌────────┐  ┌────────┐                     │
│   │  (AR)  │  │  (BO)  │  │  (CH)  │   ← avatar, anneau   │
│   │ Alice  │  │  Bob   │  │ Chloé  │     vert si parle    │
│   │ 🔊 100%│  │ 🔇 muet│  │ 🔊 60% │                     │
│   └────────┘  └────────┘  └────────┘                     │
│                                                          │
│  Qualité : ● excellent   Latence : 24 ms   Pairs : 2      │
├──────────────────────────────────────────────────────────┤
│  [🎤 Muet]  [🎧 Sourdine]  [Mode: PTT ▾]  [Quitter]      │
│  ▁▂▃▅▇▅▃▂▁  niveau micro (barre live)   seuil ────┼──    │
└──────────────────────────────────────────────────────────┘
```
États : `connexion en cours` (spinner sur l'avatar du pair), `pair connecté`,
`pair en échec ICE` (avatar grisé + « reconnexion… »), `pair parti`, `moi muet`,
`moi sourd` (tous les avatars barrent leur son), `PTT enfoncé` (halo sur mon avatar),
`seuil VAD en cours de réglage` (barre de niveau qui montre la position du seuil).

### E3 — Réglages (panneau ou fenêtre séparée)

Sections : **Audio** (périphérique d'entrée ▾ + niveau live, périphérique de sortie ▾ +
bouton « test » 1 s, RNNoise on/off, annulation d'écho : état *réel* lu depuis le track,
mode de prise de parole PTT/VAD, seuil VAD en dBFS avec barre visuelle, raccourci PTT avec
bouton « réenregistrer »), **Overlay** (activer, opacité, taille, écran cible, position),
**Réseau** (nom affiché de l'instance, port de signalisation *réel*, méthode de découverte
active, « aucun serveur externe configuré » en lecture seule), **À propos** (version,
licence, « aucune donnée ne quitte votre réseau local »).

### E4 — Overlay (fenêtre transparente, toujours au premier plan)

```
        ╭──────────────────────────────────╮
        │  ⬤ Alice    ⬤ Bob    ⬤ Chloé     │   ← 28 px, déplaçable,
        ╰──────────────────────────────────╯     jamais focusable
```
Rendu : un avatar circulaire 28 px par participant, initiale ou pastille de couleur
(dérivée du `instanceId`), **halo animé 2 px** sur celui qui parle (transition 80 ms,
pas de flash), croix rouge si muet, croix barrée si je suis en sourdine. Largeur
auto, hauteur fixe. Position persistée localement. Jamais dans la barre des tâches,
`setIgnoreMouseEvents(true)` sauf sur la poignée de déplacement.

---

## 4. Critères d'acceptation mesurables

Tous vérifiés par Banc, chiffres à l'appui dans `VERIF/`. Une ligne sans mesure est une
ligne non vérifiée et doit être marquée comme telle.

| ID | Critère | Mesure | Seuil |
|----|---------|--------|-------|
| CA1 | Deux instances sur le même LAN se découvrent | temps entre lancement et apparition dans la liste | < 5 s (mDNS), < 8 s (repli broadcast) |
| CA2 | Audio bidirectionnel audible | 2 pairs, 30 s de parole, aucune coupure > 200 ms | 0 coupure, MOS informel ≥ 3.5 |
| CA3 | Débit audio conforme | `getStats()` sur le `outbound-rtp` | 28–40 kbps par pair à 32 kbps configuré |
| CA4 | Aucun candidat hors LAN | inspection de tous les `candidate` SDP échangés + `chrome://webrtc-internals` wolf | 0 candidat non-RFC1918/link-local ; 0 paquet vers une IP publique |
| CA5 | Aucun trafic hors LAN applicatif | capture `ss -u -p` / `nettop` pendant 60 s d'usage complet | 0 socket vers une IP hors RFC1918, hors loopback |
| CA6 | Démarrage hors ligne | lancer avec l'interface réseau `down` (ou sans route par défaut) | fenêtre principale utilisable, création de salon OK, 0 erreur fatale |
| CA7 | Maillage 8 participants | 8 instances (ou simulation), 60 s | tous entendent tous, CPU < 60 % d'un cœur, uplink < 400 kbps |
| CA8 | Refus du 9ᵉ | tentative de rejoindre un salon 8/8 | refus explicite, message UI, pas de crash |
| CA9 | Mute / sourdine | clic mute | `track.enabled === false` sur tous les senders < 50 ms ; sourdine coupe la sortie, pas l'émission |
| CA10 | Volume par participant | réglage 0 % / 50 % / 200 % sur un pair | gain appliqué localement, les autres pairs inchangés |
| CA11 | PTT global | app focus sur une autre application, maintenir le raccourci | audio émis pendant l'appui, coupé au relâchement, < 100 ms |
| CA12 | VAD avec seuil | seuil réglé à −35 dBFS, parole à −25, silence à −55 | ouverture < 150 ms, aucune ouverture sur le silence, hystérésis respectée |
| CA13 | RNNoise | bruit blanc à −30 dBFS en entrée, RNNoise on/off | réduction mesurable ≥ 10 dB de bruit résiduel, voix préservée (SNR ne se dégrade pas) |
| CA14 | AEC | haut-parleur + micro ouverts, RNNoise off | réduction d'écho audible ≥ 15 dB, état affiché = `getSettings()` réel |
| CA15 | Overlay au premier plan | overlay actif + fenêtre plein écran au premier plan | overlay visible au-dessus, saisie clavier continue dans l'autre app (aucun vol de focus) |
| CA16 | Overlay déplaçable | glisser la poignée | position change, persistée après redémarrage |
| CA17 | Aucun compte | inspection du code + du dossier de données | 0 champ identifiant persistant, `instanceId` change à chaque lancement |
| CA18 | Packaging | `npm run dist` sur Linux | AppImage + deb produits, l'AppImage se lance et sert un salon |
| CA19 | Absence de mise à jour auto | inspection `package.json`, `main.ts`, CSP | 0 dépendance `electron-updater`, `publish: null`, 0 requête de mise à jour |
| CA20 | Zéro télémétrie | capture réseau complète d'une session de 5 min | 0 requête vers un domaine public |

**Critères bloquants** (l'app ne part pas sans eux) : CA4, CA5, CA6, CA9, CA15, CA17, CA20.

---

## 5. Qui fait quoi

| Équipier | Périmètre | Livrable |
|----------|-----------|----------|
| **Maquette** (design) | Écrans E1–E4 : arborescence des composants, design system (couleurs, espacements, typo), libellés FR **et** EN, états vides/erreur/chargement, ergonomie PTT et VAD (comment on règle un seuil sans se tromper), spécification visuelle de l'overlay (28 px, halo 2 px, animation 80 ms), accessibilité (contraste, focus clavier hors overlay). | `SPECS/SPEC-002-ui.md` + jetons de design en JSON consommables par Cadre |
| **Carillon** (moteur) | A2–A13 côté technique : graphe audio (`AudioWorklet` RNNoise + gate VAD), `RTCPeerConnection` maillé, filtre de candidats RFC1918, mDNS + beacon broadcast, serveur de signalisation WS embarqué, `getStats()` normalisé (débit, latence, perte), API interne (`LanVoiceEngine`) que Cadre branche. | `src/engine/**` + `SPECS/SPEC-003-engine-api.md` |
| **Cadre** (coquille) | A1, A10, A11, A14 : Electron main + preload (contextIsolation, pas de `nodeIntegration`), React pour E1–E4 selon SPEC-002, fenêtre overlay non focusable, `globalShortcut`, réglages persistés localement, `electron-builder` (AppImage/deb/NSIS, `publish: null`), CSP. | `src/main/**`, `src/renderer/**`, `electron-builder.yml` |
| **Banc** (vérification) | CA1–CA20 : harnais de test, mesures datées chiffrées, contrôle « aucun trafic hors LAN », rapport avec points **non vérifiés** explicitement listés. Ne corrige pas le code : il mesure et signale. | `VERIF/VERIF-001-rapport.md` + scripts de mesure |

### Ordre d'exécution

```
Maquette (SPEC-002 + jetons)  ─┐
                               ├─→ Carillon (moteur) ──┐
Cadre (squelette Electron)  ───┘                       ├─→ Banc (vérification)
                                                       │
Carillon + Cadre intégrés ─────────────────────────────┘
```

Pipeline `lan-voice` : **design → engine → shell → verif**. Le contrat d'interface entre
Carillon et Cadre est `SPEC-003-engine-api.md` ; Cadre code contre ce contrat avant que le
moteur soit fini, ce qui permet le parallélisme.

---

## 6. Découpage en tâches (dispatch)

1. **T1 → Maquette** — SPEC-002 : les 4 écrans, tous les états, FR/EN, jetons JSON, spec overlay.
2. **T2 → Carillon** — Le moteur : audio, RNNoise, VAD, maillage, mDNS, signalisation, filtre LAN. Publie SPEC-003 (l'API) **en premier**, puis implémente.
3. **T3 → Cadre** — La coquille : Electron main/preload, React pour E1–E4, overlay sans focus, PTT global, réglages, packaging, CSP. Code contre SPEC-003.
4. **T4 → Banc** — Le harnais de vérification et le rapport CA1–CA20, avec chiffres et points non vérifiés.

T1 et T2 démarrent en parallèle. T3 démarre sur le squelette (main/preload/overlay) sans
attendre le moteur, puis se raccorde. T4 prépare le harnais en parallèle et mesure à la fin.

---

## 7. Ce qui n'est pas fait, et qu'on dit

- **Pas de chiffrement de bout en bout négocié.** DTLS-SRTP est actif (c'est obligatoire en
  WebRTC) mais il n'y a **pas d'authentification des pairs** : sur un LAN hostile, un
  attaquant qui peut faire du MITM sur la signalisation pourrait s'insérer. C'est le prix
  de « aucun compte ». Documenté, pas caché.
- **Pas de traversée de NAT.** Deux personnes derrière deux routeurs différents ne se
  verront pas. C'est une décision, pas un oubli : STUN/TURN public = trafic hors LAN.
- **Pas de signature de code.** Windows SmartScreen affichera un avertissement au premier
  lancement. Hors périmètre v1.
- **Pas de persistance d'historique** de salon : rien à retrouver, rien à fuiter.
- **Plafond 8 participants** en maillage. Au-delà, il faudrait un serveur média (SFU) : hors
  périmètre, et ça changerait la nature du produit.
- **macOS non packagé** : le code doit tourner, mais seuls Linux et Windows sont livrés.
