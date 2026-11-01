# SPEC-002 — Spécification d'écrans, design system, ergonomie PTT/VAD et libellés

Version : 1.2 — 2026-10-31 — **Maquette** (design des écrans, overlay, ergonomie PTT, libellés FR/EN)
Rév. 1.2 — **seul changement** : le type de service mDNS affiché passe de `_lanvoice._udp` à `_concord._udp`
(SPEC-018 **AD-28**, tâche T24), soit la clé `discovery.method.mdns` dans `design/i18n/fr.json`,
`design/i18n/en.json` et le bundle `design/i18n.json`, et ses trois citations ici (§0.2, §9 E1, §12 lecture L5).
Aucune autre ligne, aucune clé, aucun jeton : `node design/check-i18n.mjs` → `RESULT=PASS`
(297 clés FR/EN, parité, ordre, placeholders, bundle identique).
Statut : spécification de référence. **Aucun écran n'est implémenté dans la coquille à ce jour** : le dépôt
contient `src/main/`, `src/engine/`, `src/preload/` et `src/shell/`, mais **pas de `src/renderer/`** — donc
aucun composant E1–E4. Tout ce document décrit une **maquette seule** ; chaque état de §10 reste à livrer par
Cadre puis à vérifier par Sonde. Aucun état n'est « fait » du seul fait qu'il est décrit ici.
Racine unique du dépôt : **`/work/lan-voice`**. `_shared/lan-voice/` est **gelé** (ni source de vérité, ni cible
d'écriture) ; tout ce qui suit s'y réfère par des chemins relatifs à cette racine.
Fichiers compagne, importés tels quels par la coquille : **`design/tokens.json`** (jetons),
**`design/i18n/fr.json`** + **`design/i18n/en.json`** (libellés) ; **`design/i18n.json`** est le bundle
`{ "fr": …, "en": … }` maintenu identique par le contrôle (compatibilité des imports existants).
Note d'archive : `SPECS/SPEC-002-ui.md` (v1.0, 2026-02-14) reste dans ce dossier pour historique et ne fait
**plus** foi — cette version 1.1 le remplace intégralement (même plan, §1 à §12). Ne pas implémenter la v1.0.
Contrôles exécutables, node pur sans dépendance : `node design/check-i18n.mjs`, `node design/check-contrast.mjs`
(sorties brutes en §12).

---

## 0. Périmètre, contraintes dures, décisions

### 0.1 Ce que ce document couvre

Le rendu de **4 écrans** et de **tous leurs états** (découverte, vide, chargement, erreur, salon complet,
connexion en cours, pair en échec ICE, pair parti, moi muet, moi sourd, PTT enfoncé, réglage de seuil en cours),
l'arborescence des composants React, le design system complet, l'ergonomie PTT et VAD, la spécification
visuelle de l'overlay, l'accessibilité, et **toutes les chaînes visibles en FR et EN**.

Il ne couvre pas : protocole, signalisation, WebRTC, stack audio (SPEC-001 + fiches moteur), ni le code.

### 0.2 Décisions reprises de SPEC-001, et ce qui reste hypothèse

`SPECS/SPEC-001-conception.md` **fait foi** pour les quatre décisions structurantes ci-dessous : elles ne sont
pas des choix de ce document, elles sont recopiées pour que toute divergence future se règle en un seul endroit.

| # | Décision (SPEC-001) | Réf. | Où l'interface l'applique |
|---|---|---|---|
| **D1** | Ports **`47820`** (balayage UDP broadcast) et **`47821`** (WebSocket de signalisation), incrément jusqu'à **`47830`** si pris ; **le port réellement utilisé est publié dans le beacon** — l'interface n'affiche jamais un port qu'elle n'a pas lu du beacon | A4, A5 | §3 S1.2 (compteur de découverte), §5 S3.15 (`settings.network.port`, lecture seule) |
| **D2** | Raccourci PTT par défaut **`Alt+Space`** (affiché `Alt+Espace` en FR par assemblage de `common.key.alt` + `common.key.space`), **configurable**, échec d'enregistrement **signalé dans l'interface** | A11 | §5 S3.7, §4 bandeau `● Inactif`, §7.3 |
| **D3** | **8 participants** en maillage, plafond **dur** ; le 9ᵉ est **refusé avec un message explicite** — jamais ignoré en silence | A2, CA8 | §3 S1.6 (`room.full.*`), §4 S2.13, §7.5 |
| **D4** | Overlay : avatar **`28 px`**, halo **`2 px`**, animation **`80 ms** | A10, §Interface | §6 (`overlay.avatarSize`, `overlay.haloWidth`, `overlay.haloTransitionMs`) |

Le tableau suivant complète ces quatre décisions (contraintes de rendu héritées, mêmes références) :

| Point | Valeur | Source |
|---|---|---|
| Raccourci PTT par défaut | **`Alt+Espace`**, configurable, avec détection de conflit | SPEC-001 **A11** |
| Port de signalisation | `47821`, incrémenté jusqu'à `47830` si occupé, port réel publié dans le beacon | SPEC-001 **A5** |
| Découverte | mDNS `_concord._udp.local` **+** balayage broadcast UDP `47820` (non optionnel) | SPEC-001 **A4**, renommé par SPEC-018 **AD-28** |
| Plafond de participants | `8` (maillage complet) ; le 9ᵉ est refusé **avec un message clair** | SPEC-001 **A2**, CA8 |
| Identité | aucun identifiant persistant ; pseudo local (défaut = prénom du compte OS) ; `instanceId` UUIDv4 par lancement ; pastille dérivée de l'`instanceId` | SPEC-001 **A6** |
| VAD | `AnalyserNode` RMS + plancher adaptatif (médiane glissante 3 s) ; gate auditif ouvrant ≥ 120 ms / fermant ≥ 400 ms | SPEC-001 **A12** |
| AEC | état **réel** lu via `track.getSettings().echoCancellation`, jamais l'état souhaité | SPEC-001 **A9** |
| RNNoise | wasm dans un `AudioWorklet`, **activé par défaut**, désactivable | SPEC-001 **A8** |
| Overlay | `frame:false`, transparente, `alwaysOnTop: 'screen-saver'`, `focusable:false`, `skipTaskbar:true`, route `#/overlay`, déplacement par `-webkit-app-region: drag` sur la poignée | SPEC-001 **A10** |
| Avatar d'overlay | `28 px`, halo `2 px`, animation `80 ms` | SPEC-001 §Interface, T1 |
| Taille d'avatar overlay | `28 px` | `overlay.avatarSize` |
| Halo de parole | `2 px`, transition `80 ms` | `overlay.haloWidth`, `overlay.haloTransitionMs` |
| Opacité overlay | défaut `0.9`, plage `0.6 → 1.0`, pas `0.05` (§6.5) | `overlay.opacity` |
| Plage de seuil VAD | `−70 dBFS` → `−10 dBFS`, pas `1 dB` | §7.2 |
| Fenêtre principale | `1024 × 680`, minimum `880 × 560` | §3.0 |

**Deux points consignés — R1 tranché par SPEC-001 A11, R2 tranché par §6.5 :**

- **R1 — `Alt+Espace` reste le défaut unique, sur les trois plateformes.** Sous Windows, `Alt+Espace` ouvre le
  menu système de la fenêtre active et `globalShortcut.register` peut échouer **dès l'installation** ; le design
  ne masque pas l'échec : S3.7 et §7.3 couvrent le cas (message explicite, saisie d'un nouveau raccourci,
  `● Inactif` dans la barre de E2, `control.ptt.hold` qui affiche le raccourci **réellement enregistré**). La
  variante « `Ctrl+Alt+Espace` amorcé sur Windows » est **rejetée** : un seul défaut (`Alt+Space`), un seul
  chemin de configuration, un seul comportement à tester. Risque résiduel **accepté et connu** : sur une machine
  Windows neuve, CA11 (« audio émis pendant l'appui ») échoue tant que l'utilisateur n'a pas changé le
  raccourci — c'est exactement ce que vérifie S3.7, pas une régression silencieuse.
- **R2 — L'opacité de l'overlay n'est pas une opacité de fenêtre.** §6.5 : `win.setOpacity()` délave le texte et
  casse le 4.5:1 dès 60 % ; seule la plaque est atténuée, les enfants restent opaques. Plancher à 60 %, porté par
  `overlay.opacity.min` (v1.1 : **0.6** — corrigé depuis un `0.4` qui contredisait ce paragraphe ;
  `node design/check-contrast.mjs` ne mesure que des paires de couleurs, le plancher se vérifie en recette, S4.6).

### 0.3 Contraintes dures — application vérifiable à chaque écran

| Contrainte | Ce que ça interdit à l'écran | Comment le design l'applique |
|---|---|---|
| **Aucun compte, aucun login, aucun profil serveur, aucun « se connecter »** | champ e-mail, champ mot de passe, avatar de profil **serveur**, bouton « Se connecter / S'inscrire », menu de compte en haut à droite | l'identité reste **100 % locale** (`app.nickname.label` + avatar choisi dans la galerie embarquée ou image prise sur le disque) : aucun compte, aucune e-mail, aucune photo téléversée ; rien de tout cela n'est envoyé ailleurs que sur le LAN — voir l'amendement ci-dessous |

> **Amendement 2026-10-31 (directive produit) — profil = pseudo + avatar, galerie ET image locale.**
> La ligne ci-dessus interdisait l'« avatar de profil persistant » ; elle est remplacée : le profil
> est un **pseudo + un avatar**, tous deux purement locaux. L'avatar se choisit (1) dans une
> **galerie embarquée** d'une quinzaine de dessins prédéfinis ou (2) par **« Choisir une image »**
> (png/jpg/webp ≤ 2 Mo, redimensionnée en carré 256 px et stockée sous `userData/avatars/`).
> Ce qui reste INTERDIT et tient la contrainte d'origine : tout compte, toute e-mail, tout
> téléversement, tout avatar hébergé. Le fil de signalisation ne transporte que l'**empreinte**
> (16 hex) de l'image, jamais le binaire ; un pair qui ne connaît pas l'empreinte la réclame par
> `avatar_get` sur la signalisation LAN existante, et retombe sur les **initiales** en cas d'absence
> ou de contenu corrompu. L'avatar ne quitte donc jamais le réseau local.
| **Aucun cloud, aucune synchronisation** | « synchronisé », « en ligne », icône nuage, « vos données partout », « sauvegarde » | E3 ▸ Réseau affiche `settings.network.externalHelp` (« Aucun STUN, aucun TURN, aucun serveur hors du réseau local ») et `settings.about.nocloud` ; le mot « cloud » n'apparaît nulle part |
| **Aucune mise à jour automatique** | bandeau « nouvelle version disponible », bouton « Redémarrer pour mettre à jour », spinner de vérification de version | E3 ▸ À propos n'affiche que `settings.about.version`, `license`, `local`, `nocloud` — aucun bouton de mise à jour, aucun appel réseau de version |
| **Utilisable quand la liste des salons est vide (mode hors ligne complet)** | écran bloquant, modale obligatoire, bouton « Créer » grisé faute de réseau | E1.S3 (liste vide), E1.S5 (découverte en échec) et E1.S10 (aucune interface réseau) conservent **toujours** `[Créer un salon]` actif et la saisie du pseudo ; un salon créé hors ligne est jouable dès qu'un 2ᵉ participant arrive |
| Thème sombre par défaut, thème clair disponible | — | §2.1, bascule dans l'en-tête E1, mémorisée localement |
| Overlay jamais focalisable, clics traversants sauf poignée | — | §6.6 |

**Vocabulaire proscrit** (grep à passer sur le code et sur `i18n.json`) : `login`, `sign in`, `sign up`, `account`,
`profile`, `password`, `cloud`, `sync`, `update available`, `connexion` employé dans le sens « se connecter à un
service ». « Connexion » n'est utilisé que pour **l'établissement d'un lien pair-à-pair** (`room.connecting`,
`participant.connecting`) — jamais pour une authentification.

### 0.4 Conventions

- **Identifiants d'état** : `S<écran>.<n>` — par ex. `S2.5`. Chaque état est un rendu distinct et testable ; un état non décrit est un état manquant (§10).
- **Jetons** : toute valeur visuelle est référencée par son chemin dans `tokens.json` — `color.theme.dark.bg.surface`, `space.3`, `radius.lg`. Aucune valeur en dur ailleurs.
- **Variables CSS** : `--color-bg-surface`, `--space-3`, `--radius-lg` (chemin en kebab-case, thème actif résolu en amont). `tokens.json` reste la source.
- **Interpolation** : `{{nom}}` (moustaches doubles), jamais de concaténation. Les paires FR/EN ont **exactement** les mêmes moustaches — vérifié par `node design/check-i18n.mjs` sur les **241** clés (§12.1).
- **Unités** : toutes les dimensions de `tokens.json` sont en **px** (nombres nus).
- **Plages de focus** : `outline: 2px solid color.focus.ring`, `outline-offset: 2px`, jamais supprimé.

---

## 1. Inventaire des fenêtres et navigation

```
┌─ Fenêtre principale (1024×680, min 880×560) ───────────────────────────┐
│  E1 Salons  ──[rejoindre / créer]──►  E2 Salon  ──[quitter]──►  E1     │
│       └──[⚙ / Ctrl+,]──►  E3 Réglages (dialogue modal, 760×560)        │
└────────────────────────────────────────────────────────────────────────┘
┌─ Fenêtre overlay (frameless, transparente, always-on-top, sans focus) ─┐
│  E4 Overlay — visible dans E2 uniquement, si activée dans E3 ▸ Overlay │
└────────────────────────────────────────────────────────────────────────┘
```

- **Une seule fenêtre applicative.** E3 est un **dialogue modal** dans la fenêtre principale (pas une route) : il se ferme par `Échap`, `Ctrl+,` ou `[Fermer]`, et rend le focus à l'élément qui l'a ouvert.
- **E4 est une fenêtre séparée** (frameless + `alwaysOnTop` + `skipTaskbar` + click-through sélectif). Elle n'a **aucun rôle de navigation** : on n'y accède jamais au clavier, elle ne prend jamais le focus (§6.6).
- **Transitions d'écran** : `motion.duration.screen` (240 ms) `easing.standard`, fondu + 4 px de translation verticale. Si `prefers-reduced-motion`, durée `motion.reducedMotionDuration` (0).
- **Pas d'historique, pas de routeur** : deux vues (`lobby`, `room`) + un dialogue. Aucun état restauré au démarrage en dehors de : thème, périphériques choisis, mode PTT/VAD, seuil, raccourci, activation/opacité/taille/position de l'overlay, pseudo.

---

## 2. Design system

### 2.1 Palette

Deux thèmes, mêmes **rôles**, valeurs différentes. Le thème sombre est le **défaut**. Le thème suit
`app.theme.system` si l'utilisateur choisit « Suivre le système ».

**Thème sombre (défaut)** — `color.theme.dark`

| Jeton | Hex | Rôle |
|---|---|---|
| `bg.canvas` | `#0E1116` | fond de fenêtre |
| `bg.surface` | `#151A21` | panneaux, barres, dialogues |
| `bg.raised` | `#1C232C` | cartes, lignes de salon, tuiles de participant |
| `bg.inset` | `#090B0F` | champs de saisie, puits de la barre de niveau |
| `bg.hover` | `#232B36` | survol de ligne / de bouton neutre |
| `bg.overlay` | `#0B0E13` | fond de la fenêtre overlay |
| `border.subtle` | `#2A323D` | bordure de carte (décorative, non informative) |
| `border.strong` | `#6E7D90` | bordure de champ de saisie (seule limite visible) |
| `text.primary` | `#F1F4F8` | titres, pseudos, valeurs |
| `text.secondary` | `#AEB9C6` | texte courant, aides |
| `text.muted` | `#8B97A5` | métadonnées, horodatage, unités |
| `text.inverse` | `#0B0E13` | texte sur aplat clair (usage rare) |
| `accent.default` | `#4C9AFF` | action primaire, sélection, lien |
| `accent.hover` | `#6FB0FF` | survol de l'action primaire |
| `accent.pressed` | `#2F7FE0` | appui sur l'action primaire |
| `accent.subtle` | `#16273D` | fond de badge accentué |
| `accent.on` | `#06121F` | libellé sur aplat accentué |
| `state.speaking` | `#3DDC84` | halo de parole |
| `state.mute` | `#FF6B6B` | micro coupé, erreur |
| `state.muteSubtle` | `#3A1417` | fond de bandeau d'erreur |
| `state.warn` | `#FFB020` | avertissement, qualité dégradée |
| `state.warnSubtle` | `#33260A` | fond de bandeau d'avertissement |
| `state.ok` | `#3DDC84` | état sain, qualité excellente |
| `focus.ring` | `#8CC4FF` | anneau de focus clavier |
| `scrim.dialog` | `rgba(9, 11, 15, 0.72)` | voile derrière E3 |

**Thème clair** — `color.theme.light`

| Jeton | Hex | Rôle |
|---|---|---|
| `bg.canvas` | `#F4F6F9` | fond de fenêtre |
| `bg.surface` | `#FFFFFF` | panneaux, barres, dialogues |
| `bg.raised` | `#FFFFFF` | cartes, tuiles (séparées par `border.subtle` + ombre 1) |
| `bg.inset` | `#EDF0F4` | champs de saisie, puits de la barre de niveau |
| `bg.hover` | `#E7ECF2` | survol |
| `bg.overlay` | `#FFFFFF` | fond de la fenêtre overlay |
| `border.subtle` | `#D5DCE4` | bordure de carte |
| `border.strong` | `#767F8C` | bordure de champ |
| `text.primary` | `#12171D` | titres, pseudos |
| `text.secondary` | `#48545F` | texte courant |
| `text.muted` | `#5B6672` | métadonnées |
| `text.inverse` | `#FFFFFF` | texte sur aplat sombre |
| `accent.default` | `#1B62D6` | action primaire |
| `accent.hover` | `#1751B0` | survol |
| `accent.pressed` | `#12408C` | appui |
| `accent.subtle` | `#E3EDFC` | fond de badge accentué |
| `accent.on` | `#FFFFFF` | libellé sur aplat accentué |
| `state.speaking` | `#0D6B43` | halo de parole |
| `state.mute` | `#C4282B` | micro coupé, erreur |
| `state.muteSubtle` | `#FDE9E9` | fond de bandeau d'erreur |
| `state.warn` | `#8A5A00` | avertissement |
| `state.warnSubtle` | `#FDF3DC` | fond de bandeau d'avertissement |
| `state.ok` | `#0D6B43` | état sain |
| `focus.ring` | `#1B62D6` | anneau de focus |
| `scrim.dialog` | `rgba(18, 23, 29, 0.48)` | voile derrière E3 |

**Pastilles d'avatar** (dérivées de l'`instanceId`, §6.2) — `color.avatarTint.{dark,light}` :

| # | sombre | clair |
|---|---|---|
| 1 | `#2B5E8F` | `#BBD3F7` |
| 2 | `#2F6B4F` | `#C6E6CB` |
| 3 | `#7D5A2A` | `#F3D9B4` |
| 4 | `#6F3A78` | `#EBC9EE` |
| 5 | `#834040` | `#F6C9C9` |
| 6 | `#256A6E` | `#BFE6EA` |
| 7 | `#5A4A9E` | `#D3CBFA` |
| 8 | `#6B6526` | `#EDE6B8` |

L'initiale est toujours `text.primary` (contraste ≥ 5.4:1 dans les deux thèmes, voir §2.2).
La teinte **n'est jamais la seule information** : le pseudo est toujours affiché à côté (tuile E2) ou
accessible en infobulle (overlay, §6.6 — l'infobulle ne capte pas la souris).

### 2.2 Contrastes WCAG AA calculés

Méthode : luminance relative WCAG 2.1 (`0.2126 R + 0.7152 G + 0.0722 B`, linéarisée), ratio `(L1+0.05)/(L2+0.05)`.
Seuils : **4.5:1** texte normal, **3:1** composants d'interface et éléments graphiques (1.4.11).
Toutes les paires ci-dessous passent : **37 paires par thème, 0 échec**, plus **12 paires d'état** ajoutées en v1.1 (sourdine, reconnexion, pair parti) — soit **86 paires** recalculées par `node design/check-contrast.mjs`, qui échoue si un ratio passe sous son seuil **ou** si `tokens.json` s'écarte d'une valeur de ce tableau (sortie brute en §12.2).

#### Thème sombre (défaut)

| Jeton premier plan | Jeton arrière-plan | Usage | Ratio calculé | Exigence | Verdict |
|---|---|---|---|---|---|
| `text.primary` #F1F4F8 | `bg.canvas` #0E1116 | Texte principal sur fond de fenêtre | **17.14:1** | 4.5:1 (AA texte) | ✅ AA |
| `text.primary` #F1F4F8 | `bg.surface` #151A21 | Texte principal sur panneau | **15.84:1** | 4.5:1 (AA texte) | ✅ AA |
| `text.primary` #F1F4F8 | `bg.raised` #1C232C | Texte principal sur carte / ligne de salon | **14.35:1** | 4.5:1 (AA texte) | ✅ AA |
| `text.primary` #F1F4F8 | `bg.hover` #232B36 | Texte principal sur ligne survolée | **12.95:1** | 4.5:1 (AA texte) | ✅ AA |
| `text.primary` #F1F4F8 | `bg.inset` #090B0F | Texte principal sur champ creux | **17.85:1** | 4.5:1 (AA texte) | ✅ AA |
| `text.primary` #F1F4F8 | `bg.overlay` #0B0E13 | Texte principal dans l overlay | **17.52:1** | 4.5:1 (AA texte) | ✅ AA |
| `text.secondary` #AEB9C6 | `bg.canvas` #0E1116 | Texte secondaire sur fond de fenêtre | **9.51:1** | 4.5:1 (AA texte) | ✅ AA |
| `text.secondary` #AEB9C6 | `bg.surface` #151A21 | Texte secondaire sur panneau | **8.78:1** | 4.5:1 (AA texte) | ✅ AA |
| `text.secondary` #AEB9C6 | `bg.raised` #1C232C | Texte secondaire sur carte | **7.96:1** | 4.5:1 (AA texte) | ✅ AA |
| `text.secondary` #AEB9C6 | `bg.inset` #090B0F | Texte de champ creux | **9.90:1** | 4.5:1 (AA texte) | ✅ AA |
| `text.secondary` #AEB9C6 | `bg.overlay` #0B0E13 | Pseudo dans l overlay | **9.71:1** | 4.5:1 (AA texte) | ✅ AA |
| `text.muted` #8B97A5 | `bg.canvas` #0E1116 | Texte atténué sur fond de fenêtre | **6.36:1** | 4.5:1 (AA texte) | ✅ AA |
| `text.muted` #8B97A5 | `bg.surface` #151A21 | Texte atténué sur panneau (aide, horodatage) | **5.88:1** | 4.5:1 (AA texte) | ✅ AA |
| `text.muted` #8B97A5 | `bg.raised` #1C232C | Texte atténué sur carte | **5.33:1** | 4.5:1 (AA texte) | ✅ AA |
| `accent.default` #4C9AFF | `bg.surface` #151A21 | Lien / texte accent sur panneau | **6.14:1** | 4.5:1 (AA texte) | ✅ AA |
| `accent.default` #4C9AFF | `bg.canvas` #0E1116 | Lien / texte accent sur fond de fenêtre | **6.64:1** | 4.5:1 (AA texte) | ✅ AA |
| `accent.on` #06121F | `accent.default` #4C9AFF | Libellé du bouton primaire | **6.62:1** | 4.5:1 (AA texte) | ✅ AA |
| `accent.on` #06121F | `accent.hover` #6FB0FF | Libellé du bouton primaire survolé | **8.37:1** | 4.5:1 (AA texte) | ✅ AA |
| `accent.on` #06121F | `accent.pressed` #2F7FE0 | Libellé du bouton primaire enfoncé | **4.70:1** | 4.5:1 (AA texte) | ✅ AA |
| `text.primary` #F1F4F8 | `accent.subtle` #16273D | Texte sur fond accentué discret (badge) | **13.68:1** | 4.5:1 (AA texte) | ✅ AA |
| `state.mute` #FF6B6B | `bg.surface` #151A21 | Texte / icône muet sur panneau | **6.30:1** | 4.5:1 (AA texte) | ✅ AA |
| `state.mute` #FF6B6B | `state.muteSubtle` #3A1417 | Texte de bandeau d erreur | **5.86:1** | 4.5:1 (AA texte) | ✅ AA |
| `state.mute` #FF6B6B | `bg.overlay` #0B0E13 | Croix de muet dans l overlay | **6.97:1** | 4.5:1 (AA texte) | ✅ AA |
| `state.warn` #FFB020 | `bg.surface` #151A21 | Texte / icône d avertissement sur panneau | **9.56:1** | 4.5:1 (AA texte) | ✅ AA |
| `state.warn` #FFB020 | `state.warnSubtle` #33260A | Texte de bandeau d avertissement | **8.07:1** | 4.5:1 (AA texte) | ✅ AA |
| `state.ok` #3DDC84 | `bg.surface` #151A21 | Texte / icône état sain sur panneau | **9.79:1** | 4.5:1 (AA texte) | ✅ AA |
| `state.ok` #3DDC84 | `bg.raised` #1C232C | Pastille qualité sur carte | **8.87:1** | 4.5:1 (AA texte) | ✅ AA |
| `text.inverse` #0B0E13 | `text.primary` #F1F4F8 | Texte sur pastille pleine (avatar de secours) | **17.52:1** | 4.5:1 (AA texte) | ✅ AA |
| `border.strong` #6E7D90 | `bg.surface` #151A21 | Bordure de champ de saisie (seule limite visible) | **4.16:1** | 3:1 (AA non-texte) | ✅ AA |
| `border.strong` #6E7D90 | `bg.inset` #090B0F | Bordure de champ sur fond creux | **4.69:1** | 3:1 (AA non-texte) | ✅ AA |
| `focus.ring` #8CC4FF | `bg.canvas` #0E1116 | Anneau de focus sur fond de fenêtre | **10.32:1** | 3:1 (AA non-texte) | ✅ AA |
| `focus.ring` #8CC4FF | `bg.surface` #151A21 | Anneau de focus sur panneau | **9.53:1** | 3:1 (AA non-texte) | ✅ AA |
| `focus.ring` #8CC4FF | `bg.overlay` #0B0E13 | Anneau de focus dans l overlay (jamais rendu) | **10.54:1** | 3:1 (AA non-texte) | ✅ AA |
| `state.speaking` #3DDC84 | `bg.raised` #1C232C | Halo de parole 2 px autour de l avatar | **8.87:1** | 3:1 (AA non-texte) | ✅ AA |
| `state.speaking` #3DDC84 | `bg.overlay` #0B0E13 | Halo de parole dans l overlay | **10.83:1** | 3:1 (AA non-texte) | ✅ AA |
| `accent.default` #4C9AFF | `bg.canvas` #0E1116 | Bouton primaire (aplat) sur fond de fenêtre | **6.64:1** | 3:1 (AA non-texte) | ✅ AA |
| `accent.default` #4C9AFF | `bg.surface` #151A21 | Bouton primaire (aplat) sur panneau | **6.14:1** | 3:1 (AA non-texte) | ✅ AA |

#### Thème clair

| Jeton premier plan | Jeton arrière-plan | Usage | Ratio calculé | Exigence | Verdict |
|---|---|---|---|---|---|
| `text.primary` #12171D | `bg.canvas` #F4F6F9 | Texte principal sur fond de fenêtre | **16.64:1** | 4.5:1 (AA texte) | ✅ AA |
| `text.primary` #12171D | `bg.surface` #FFFFFF | Texte principal sur panneau | **18.01:1** | 4.5:1 (AA texte) | ✅ AA |
| `text.primary` #12171D | `bg.raised` #FFFFFF | Texte principal sur carte / ligne de salon | **18.01:1** | 4.5:1 (AA texte) | ✅ AA |
| `text.primary` #12171D | `bg.hover` #E7ECF2 | Texte principal sur ligne survolée | **15.16:1** | 4.5:1 (AA texte) | ✅ AA |
| `text.primary` #12171D | `bg.inset` #EDF0F4 | Texte principal sur champ creux | **15.76:1** | 4.5:1 (AA texte) | ✅ AA |
| `text.primary` #12171D | `bg.overlay` #FFFFFF | Texte principal dans l overlay | **18.01:1** | 4.5:1 (AA texte) | ✅ AA |
| `text.secondary` #48545F | `bg.canvas` #F4F6F9 | Texte secondaire sur fond de fenêtre | **7.16:1** | 4.5:1 (AA texte) | ✅ AA |
| `text.secondary` #48545F | `bg.surface` #FFFFFF | Texte secondaire sur panneau | **7.75:1** | 4.5:1 (AA texte) | ✅ AA |
| `text.secondary` #48545F | `bg.raised` #FFFFFF | Texte secondaire sur carte | **7.75:1** | 4.5:1 (AA texte) | ✅ AA |
| `text.secondary` #48545F | `bg.inset` #EDF0F4 | Texte de champ creux | **6.78:1** | 4.5:1 (AA texte) | ✅ AA |
| `text.secondary` #48545F | `bg.overlay` #FFFFFF | Pseudo dans l overlay | **7.75:1** | 4.5:1 (AA texte) | ✅ AA |
| `text.muted` #5B6672 | `bg.canvas` #F4F6F9 | Texte atténué sur fond de fenêtre | **5.41:1** | 4.5:1 (AA texte) | ✅ AA |
| `text.muted` #5B6672 | `bg.surface` #FFFFFF | Texte atténué sur panneau (aide, horodatage) | **5.85:1** | 4.5:1 (AA texte) | ✅ AA |
| `text.muted` #5B6672 | `bg.raised` #FFFFFF | Texte atténué sur carte | **5.85:1** | 4.5:1 (AA texte) | ✅ AA |
| `accent.default` #1B62D6 | `bg.surface` #FFFFFF | Lien / texte accent sur panneau | **5.58:1** | 4.5:1 (AA texte) | ✅ AA |
| `accent.default` #1B62D6 | `bg.canvas` #F4F6F9 | Lien / texte accent sur fond de fenêtre | **5.15:1** | 4.5:1 (AA texte) | ✅ AA |
| `accent.on` #FFFFFF | `accent.default` #1B62D6 | Libellé du bouton primaire | **5.58:1** | 4.5:1 (AA texte) | ✅ AA |
| `accent.on` #FFFFFF | `accent.hover` #1751B0 | Libellé du bouton primaire survolé | **7.39:1** | 4.5:1 (AA texte) | ✅ AA |
| `accent.on` #FFFFFF | `accent.pressed` #12408C | Libellé du bouton primaire enfoncé | **9.82:1** | 4.5:1 (AA texte) | ✅ AA |
| `text.primary` #12171D | `accent.subtle` #E3EDFC | Texte sur fond accentué discret (badge) | **15.25:1** | 4.5:1 (AA texte) | ✅ AA |
| `state.mute` #C4282B | `bg.surface` #FFFFFF | Texte / icône muet sur panneau | **5.70:1** | 4.5:1 (AA texte) | ✅ AA |
| `state.mute` #C4282B | `state.muteSubtle` #FDE9E9 | Texte de bandeau d erreur | **4.89:1** | 4.5:1 (AA texte) | ✅ AA |
| `state.mute` #C4282B | `bg.overlay` #FFFFFF | Croix de muet dans l overlay | **5.70:1** | 4.5:1 (AA texte) | ✅ AA |
| `state.warn` #8A5A00 | `bg.surface` #FFFFFF | Texte / icône d avertissement sur panneau | **5.93:1** | 4.5:1 (AA texte) | ✅ AA |
| `state.warn` #8A5A00 | `state.warnSubtle` #FDF3DC | Texte de bandeau d avertissement | **5.37:1** | 4.5:1 (AA texte) | ✅ AA |
| `state.ok` #0D6B43 | `bg.surface` #FFFFFF | Texte / icône état sain sur panneau | **6.56:1** | 4.5:1 (AA texte) | ✅ AA |
| `state.ok` #0D6B43 | `bg.raised` #FFFFFF | Pastille qualité sur carte | **6.56:1** | 4.5:1 (AA texte) | ✅ AA |
| `text.inverse` #FFFFFF | `text.primary` #12171D | Texte sur pastille pleine (avatar de secours) | **18.01:1** | 4.5:1 (AA texte) | ✅ AA |
| `border.strong` #767F8C | `bg.surface` #FFFFFF | Bordure de champ de saisie (seule limite visible) | **4.05:1** | 3:1 (AA non-texte) | ✅ AA |
| `border.strong` #767F8C | `bg.inset` #EDF0F4 | Bordure de champ sur fond creux | **3.54:1** | 3:1 (AA non-texte) | ✅ AA |
| `focus.ring` #1B62D6 | `bg.canvas` #F4F6F9 | Anneau de focus sur fond de fenêtre | **5.15:1** | 3:1 (AA non-texte) | ✅ AA |
| `focus.ring` #1B62D6 | `bg.surface` #FFFFFF | Anneau de focus sur panneau | **5.58:1** | 3:1 (AA non-texte) | ✅ AA |
| `focus.ring` #1B62D6 | `bg.overlay` #FFFFFF | Anneau de focus dans l overlay (jamais rendu) | **5.58:1** | 3:1 (AA non-texte) | ✅ AA |
| `state.speaking` #0D6B43 | `bg.raised` #FFFFFF | Halo de parole 2 px autour de l avatar | **6.56:1** | 3:1 (AA non-texte) | ✅ AA |
| `state.speaking` #0D6B43 | `bg.overlay` #FFFFFF | Halo de parole dans l overlay | **6.56:1** | 3:1 (AA non-texte) | ✅ AA |
| `accent.default` #1B62D6 | `bg.canvas` #F4F6F9 | Bouton primaire (aplat) sur fond de fenêtre | **5.15:1** | 3:1 (AA non-texte) | ✅ AA |
| `accent.default` #1B62D6 | `bg.surface` #FFFFFF | Bouton primaire (aplat) sur panneau | **5.58:1** | 3:1 (AA non-texte) | ✅ AA |

#### Pastilles d'avatar — thème sombre (initiale = `text.primary`)

| Jeton | Hex | Couleur d'initiale | Contraste | Verdict |
|---|---|---|---|---|
| `avatarTint.1` | #2B5E8F | `#F1F4F8` | 6.14:1 | ✅ AA |
| `avatarTint.2` | #2F6B4F | `#F1F4F8` | 5.70:1 | ✅ AA |
| `avatarTint.3` | #7D5A2A | `#F1F4F8` | 5.65:1 | ✅ AA |
| `avatarTint.4` | #6F3A78 | `#F1F4F8` | 7.46:1 | ✅ AA |
| `avatarTint.5` | #834040 | `#F1F4F8` | 6.87:1 | ✅ AA |
| `avatarTint.6` | #256A6E | `#F1F4F8` | 5.66:1 | ✅ AA |
| `avatarTint.7` | #5A4A9E | `#F1F4F8` | 6.55:1 | ✅ AA |
| `avatarTint.8` | #6B6526 | `#F1F4F8` | 5.42:1 | ✅ AA |

#### Pastilles d'avatar — thème clair (initiale = `text.primary`)

| Jeton | Hex | Couleur d'initiale | Contraste | Verdict |
|---|---|---|---|---|
| `avatarTint.1` | #BBD3F7 | `#12171D` | 11.81:1 | ✅ AA |
| `avatarTint.2` | #C6E6CB | `#12171D` | 13.36:1 | ✅ AA |
| `avatarTint.3` | #F3D9B4 | `#12171D` | 13.20:1 | ✅ AA |
| `avatarTint.4` | #EBC9EE | `#12171D` | 12.11:1 | ✅ AA |
| `avatarTint.5` | #F6C9C9 | `#12171D` | 12.11:1 | ✅ AA |
| `avatarTint.6` | #BFE6EA | `#12171D` | 13.48:1 | ✅ AA |
| `avatarTint.7` | #D3CBFA | `#12171D` | 11.74:1 | ✅ AA |
| `avatarTint.8` | #EDE6B8 | `#12171D` | 14.25:1 | ✅ AA |

> **Exception documentée** : `border.subtle` (`#2A323D` sur `#151A21` = 1.43:1, `#D5DCE4` sur `#FFFFFF` = 1.36:1)
> est **décoratif** (séparation visuelle de cartes). Il n'est jamais la seule limite d'un contrôle : les champs
> de saisie utilisent `border.strong` (4.05:1 / 5.15:1), les zones cliquables ont un fond et un libellé.
> Si Sonde exige 3:1 sur toutes les bordures, remplacer `border.subtle` par `border.strong` sur les cartes —
> aucune autre conséquence.

### 2.3 Typographie

| Jeton | Valeur |
|---|---|
| `typography.family.ui` | `Inter, 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif` |
| `typography.family.mono` | `'JetBrains Mono', 'Cascadia Mono', Consolas, monospace` |
| `typography.size.xs` | 11 px |
| `typography.size.sm` | 12 px |
| `typography.size.md` | 13 px (corps par défaut) |
| `typography.size.lg` | 15 px |
| `typography.size.xl` | 18 px |
| `typography.size.2xl` | 22 px |
| `typography.size.3xl` | 28 px |
| `typography.lineHeight.tight` | 1.2 |
| `typography.lineHeight.snug` | 1.35 |
| `typography.lineHeight.normal` | 1.5 |
| `typography.weight.regular / medium / semibold` | 400 / 500 / 600 |
| `typography.letterSpacing.tight / none / wide` | `-0.01em` / `0` / `0.02em` |

**Échelle et rôles** (aucune autre combinaison n'est autorisée) :

| Rôle | Taille | Interligne | Graisse | Espacement | Couleur | Usage |
|---|---|---|---|---|---|---|
| `title.screen` | 22 | tight | semibold | tight | `text.primary` | titre de E1 (« Salons sur le réseau local ») |
| `title.section` | 18 | snug | semibold | none | `text.primary` | titre de E3, nom du salon en E2 |
| `title.card` | 15 | snug | semibold | none | `text.primary` | titre d'état vide, nom de salon sur une ligne |
| `body` | 13 | normal | regular | none | `text.secondary` | texte courant, aides |
| `body.strong` | 13 | normal | medium | none | `text.primary` | pseudo d'un participant, libellé de valeur |
| `meta` | 12 | snug | regular | none | `text.muted` | « 4/8 participants », latence, unités |
| `label` | 12 | snug | medium | none | `text.secondary` | libellé de champ, de bouton |
| `eyebrow` | 11 | tight | semibold | wide | `text.muted` | intitulé de section en petites capitales |
| `mono` | 12 | snug | regular | none | `text.secondary` | port, `instanceId`, dBFS |
| `overlay.name` | 12 | tight | medium | none | `text.primary` | (overlay uniquement, §6) |

Le corps à 13 px est le plancher de l'interface ; `xs` (11 px) est réservé aux intitulés de section et aux
badges, jamais à une phrase. Un texte de plus de 2 lignes ne descend jamais sous `md`.

### 2.4 Espacement — base 4 px

| Jeton | px | Usage type |
|---|---|---|
| `space.0` | 0 | — |
| `space.1` | 4 | écart icône/texte, écart entre deux lignes de métadonnées |
| `space.2` | 8 | padding interne d'un badge, écart entre avatar et pseudo (overlay) |
| `space.3` | 12 | padding d'une ligne de salon, écart entre tuiles |
| `space.4` | 16 | padding de carte, marge entre sections |
| `space.5` | 20 | padding de l'en-tête E1 |
| `space.6` | 24 | padding de contenu d'écran, gouttière de dialogue |
| `space.7` | 28 | écart entre blocs de formulaire E3 |
| `space.8` | 32 | marge au-dessus d'un état vide |
| `space.10` | 40 | hauteur d'un état vide (icône + titre) |
| `space.12` | 48 | réserve basse au-dessus de la barre de contrôle |
| `space.16` | 64 | hauteur d'une ligne de salon (`64 = 2×space.8`) |

### 2.5 Rayons

`radius.none` 0 · `radius.sm` 4 (badge, champ) · `radius.md` 6 (bouton, ligne de salon) ·
`radius.lg` 8 (carte, tuile) · `radius.xl` 12 (dialogue) · `radius.pill` 999 (pastille d'état, segmented) ·
`radius.circle` 9999 (avatar… non : l'avatar est un cercle parfait, `border-radius: 50%` — `radius.circle`
sert à la poignée et aux points de la poignée). L'overlay utilise `overlay.radius` (10).

### 2.6 Ombres (élévation)

Seules valeurs de ce document qui ne sont **pas** des jetons de `tokens.json` (une ombre est composée de
couleurs et de flous ; elle est donnée ici, une fois, pour ne pas être réinventée) :

| Niveau | Sombre | Clair | Usage |
|---|---|---|---|
| `shadow.1` | `0 1px 2px rgba(0,0,0,0.40)` | `0 1px 2px rgba(18,23,29,0.08)` | ligne de salon, tuile |
| `shadow.2` | `0 4px 12px rgba(0,0,0,0.45), 0 1px 2px rgba(0,0,0,0.40)` | `0 4px 12px rgba(18,23,29,0.10), 0 1px 2px rgba(18,23,29,0.06)` | barre de contrôle, infobulle |
| `shadow.3` | `0 16px 40px rgba(0,0,0,0.55)` | `0 16px 40px rgba(18,23,29,0.16)` | dialogue E3 |
| `shadow.overlay` | `0 2px 8px rgba(0,0,0,0.50)` | `0 2px 8px rgba(18,23,29,0.14)` | fenêtre E4 |

Aucune ombre en `:focus` (on utilise `focus.ring`), aucune ombre sur les boutons (aplats uniquement).

### 2.7 Mouvement

| Jeton | ms | Usage |
|---|---|---|
| `motion.duration.instant` | 0 | changement d'état binaire sans transition |
| `motion.duration.halo` | 80 | **halo de parole** (obligatoire, identique overlay et E2) |
| `motion.duration.hover` | 120 | fond au survol, changement de couleur de bouton |
| `motion.duration.fade` | 160 | apparition d'un bandeau, d'une infobulle, d'un toast (sortie) |
| `motion.duration.panel` | 200 | ouverture/fermeture de E3, du panneau de volume |
| `motion.duration.screen` | 240 | passage E1 ↔ E2 |
| `motion.spinnerPeriod` | 900 | tour complet du spinner |
| `motion.easing.standard` | `cubic-bezier(0.2, 0, 0, 1)` | défaut |
| `motion.easing.decelerate` | `cubic-bezier(0, 0, 0, 1)` | entrée |
| `motion.easing.accelerate` | `cubic-bezier(0.3, 0, 1, 1)` | sortie |

**Règles** : le halo de parole ne clignote **jamais** (transparence + couleur, pas de flash, pas de `blink`) ;
aucune animation en boucle en dehors du spinner de chargement ; `prefers-reduced-motion: reduce` met toutes
les durées à `motion.reducedMotionDuration` (0) **sauf** rien — le halo reste instantané, ce qui est acceptable
car il ne bouge pas, il change de couleur.

### 2.8 Icônes

Jeu unique, trait `1.5 px`, `currentColor`, coins arrondis, taille `16` (boutons, lignes), `20` (barre de
contrôle), `12` (badge de muet). Noms : `mic`, `mic-off`, `headphones`, `headphones-off`, `pin`, `gear`,
`leave`, `plus`, `refresh`, `waveform`, `keyboard`, `chevron-down`, `warning`, `check`, `x`, `grip`, `speaker`.
Une icône seule n'est **jamais** un contrôle sans `aria-label` ; dans l'overlay, aucune icône n'est un contrôle.

---

### 2.9 Jetons complémentaires v1.1 (ajouts, aucune rupture)

`design/tokens.json` est **conservé** : toutes les clés v1.0 gardent leur valeur, sauf **une correction**
(`overlay.opacity.min` : `0.4` → `0.6`, aligné sur §6.5). Blocs ajoutés, tous consommés par la coquille :

| Bloc | Contenu | Écrans concernés |
|---|---|---|
| `color.theme.{dark,light}.state.{deaf,deafSubtle,reconnect,reconnectSubtle,offline,offlineSubtle}` | états **sourdine**, **reconnexion**, **pair parti** (mêmes teintes que les états déjà mesurés : `mute`/`warn`/`text.muted`) | E2, E3, E4 |
| `layout` | fenêtre `1024×680` (min `880×560`), `titleBarHeight 44`, `listRowHeight 64`, `listSkeletonRows 3`, `rowAvatarSize 32`, `tileAvatarSize 40`, `emptyBlockMinHeight 160`, `bandHeight 28` | E1, E2 |
| `component` | hauteurs de bouton `32`/`28`, champ `32`, `meter` `32`/`48`, `radio 32`, badge `12`, épaisseurs `1`/`2`, focus `2` + offset `2` | E2, E3 |
| `input.ptt` | `defaultAccelerator: "Alt+Space"`, `configurable`, `global`, `conflictReporting: "inline"` | E2, E3 |
| `input.shortcuts` | `Ctrl+M` muet, `Ctrl+Shift+M` sourdine, `Ctrl+,` réglages, `Alt+S` niveau, `Ctrl+N` créer, `Escape` annuler (§8.1) | E1, E2, E3 |
| `input.vad` | `gateOpenMs 120`, `gateCloseMs 400`, `floorWindowMs 3000`, seuil `-70…-10` dBFS, défaut `-45`, pas `1`/`6` | E3 |
| `a11y` | seuils de contraste (`textAA 4.5`, `uiComponentAA 3`), `minHitTarget 24`, focus visible, `colorNeverAlone` | tous |
| `meta` | `version`, `source`, `verifiedBy` (`check-i18n.mjs`, `check-contrast.mjs`) | — |

Le raccourci PTT n'est **pas** écrit en dur dans un libellé : l'interface stocke `input.ptt.defaultAccelerator`
(forme technique anglaise `Alt+Space`) et l'affiche en assemblant les touches localisées
(`common.key.ctrl|alt|shift|space|esc` jointes par `+`, séparateur de `common.keyChord`). C'est ce qui fait
apparaître **`Alt+Espace`** en FR et **`Alt+Space`** en EN, avec une seule valeur à configurer.

## 3. E1 — Salons (écran d'accueil)

### 3.0 Anatomie et arborescence des composants

```
App
└─ AppShell            { theme, displayName, onDisplayNameChange, onOpenSettings }
   ├─ TitleBar         { displayName, theme, onToggleTheme, onOpenSettings, windowControls }
   │  ├─ AppMark       { size: 20 }
   │  ├─ WindowTitle   { textKey: 'app.title' }
   │  └─ TitleBarActions
   │     ├─ ThemeToggle   { value: 'dark' | 'light' | 'system', onChange }
   │     ├─ IconButton    { icon: 'gear', labelKey: 'app.settings.open', shortcut: 'Ctrl+,' }
   │     └─ WindowControls{ onMinimize, onMaximize, onClose }
   ├─ LobbyScreen      { rooms, discoveryStatus, banners, toasts, displayName }
   │  ├─ LobbyHeader   { roomCount, status, onRefresh, onCreate }
   │  │  ├─ ScreenTitle  { titleKey: 'room.list.title' }
   │  │  └─ HeaderActions
   │  │     ├─ Button  { variant: 'secondary', icon: 'refresh', labelKey: 'common.refresh', loading }
   │  │     └─ Button  { variant: 'primary', icon: 'plus', labelKey: 'room.list.create' }
   │  ├─ IdentityRow   { displayName, onChange, error, saved }
   │  │  ├─ TextField  { labelKey: 'app.nickname.label', maxLength: 32, state }
   │  │  ├─ HelpText   { textKey: 'app.nickname.help' }
   │  │  └─ InlineError{ textKey }
   │  ├─ BannerStack   { banners: Banner[] }
   │  │  └─ Banner     { tone: 'info' | 'warn' | 'error', titleKey, bodyKey, actionKey?, onAction? }
   │  ├─ DiscoveryList { status: 'idle' | 'discovering' | 'ready' | 'error', rooms, onJoin, staleRoomIds }
   │  │  ├─ SkeletonRow { count: 3, index }
   │  │  ├─ RoomRow     { room, joinability: 'open' | 'full' | 'joining', onJoin }
   │  │  │  ├─ RoomAvatar   { instanceId, hostName, size: 32 }
   │  │  │  ├─ RoomIdentity { name, hostName, memberCount, openForLabel }
   │  │  │  └─ JoinButton   { state: 'join' | 'full' | 'joining', onJoin }
   │  │  └─ EmptyState  { icon, titleKey, bodyKey, primaryAction, secondaryAction }
   │  ├─ ToastRegion   { toasts, onDismiss }        // aria-live="polite"
   │  └─ LobbyFooter   { port, discoveryMethod, offline }
   └─ CreateRoomDialog { open, defaultName, hostName, onConfirm, onCancel, error }
      ├─ DialogHeader  { titleKey: 'room.create.title', onClose }
      ├─ TextField     { labelKey: 'room.create.nameLabel', maxLength: 32 }
      ├─ HelpText      { textKey: 'room.create.nameHelp' }
      ├─ CapacityRow   { capacity: 8 }
      ├─ InlineError   { textKey }
      └─ DialogFooter  { cancelKey: 'common.cancel', confirmKey: 'room.create.confirm' }
```

**Props — détail**

| Composant | Prop | Type | Rôle |
|---|---|---|---|
| `AppShell` | `theme` | `'dark' \| 'light' \| 'system'` | thème résolu en amont, applique `color.theme.*` |
| | `displayName` | `string` (≤ 32) | pseudo local, source unique (aussi lu par E3 ▸ Réseau) |
| `LobbyScreen` | `discoveryStatus` | `'idle' \| 'discovering' \| 'ready' \| 'error'` | pilote S1.1 / S1.3 / S1.4 / S1.5 |
| | `banners` | `Banner[]` | 0 à 2 bandeaux empilés, jamais plus |
| `DiscoveryList` | `rooms` | `Room[]` | tri : ouverts d'abord, puis par `openedAt` décroissant, puis par nom (`Intl.Collator('fr')`) |
| | `staleRoomIds` | `Set<instanceId>` | salons disparus entre l'affichage et le clic (S1.9) |
| `RoomRow` | `joinability` | `'open' \| 'full' \| 'joining'` | `full` dès `memberCount >= 8` |
| `JoinButton` | `state` | `'join' \| 'full' \| 'joining'` | `joining` = ce salon précis est en cours de connexion |
| `Button` | `variant` | `'primary' \| 'secondary' \| 'ghost' \| 'danger'` | un seul `primary` par écran |
| | `loading` | `boolean` | spinner 12 px + libellé conservé (jamais de libellé qui disparaît) |
| `TextField` | `state` | `'default' \| 'error' \| 'disabled'` | `error` ⇒ `aria-invalid` + `InlineError` lié par `aria-describedby` |

**Géométrie de l'écran**

| Zone | Hauteur | Padding | Fond |
|---|---|---|---|
| `TitleBar` | 44 | `space.3` / `space.4` | `bg.surface`, bordure basse `border.subtle` |
| `LobbyHeader` | 72 | `space.5` horizontal | transparent |
| `IdentityRow` | 56 | `space.5` horizontal | transparent |
| `BannerStack` | auto (min 56) | `space.3` | `state.*Subtle` |
| `DiscoveryList` | flexible, défile | `space.5` horizontal, `space.2` vertical | transparent |
| Ligne `RoomRow` | 64 | `space.3` | `bg.raised`, `radius.md`, `shadow.1`, bordure `border.subtle` |
| `LobbyFooter` | 32 | `space.4` horizontal | `bg.surface`, bordure haute `border.subtle` |

Largeur de contenu : `min(720px, 100% − 2×space.6)`, centrée. Au-delà de 720 px, la liste ne s'élargit pas
(lecture en colonne), l'en-tête reste aligné sur la liste.

### 3.1 États

#### S1.1 — Découverte en cours (chargement)

**Déclencheur** : ouverture de l'application, ou clic sur `[Actualiser]` alors que `discoveryStatus === 'discovering'`.

**Rendu**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ◈ Desktop LAN — voix locale                         [☾]  [⚙ Réglages]  – □ ×  │
├──────────────────────────────────────────────────────────────────────────────┤
│  Salons sur le réseau local                        Recherche de salons…       │
│  Pseudo   [ Vous                    ]     [⟳ Actualisation…] [＋ Créer un salon]│
│  Pseudo visible par les autres participants du réseau local.                  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  ▒▒▒▒▒▒    ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒    ▒▒▒▒▒▒▒▒▒▒▒▒            ▒▒  │  │
│  │            ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒                                         │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│  (idem ligne 2, ligne 3)                                                      │
│                                                                              │
│  ①  Un réseau chargé peut mettre quelques secondes.                           │
├──────────────────────────────────────────────────────────────────────────────┤
│  mDNS + balayage broadcast                          Port de signalisation 47821│
└──────────────────────────────────────────────────────────────────────────────┘
```

| Élément | Spécification exacte |
|---|---|
| Squelettes | **3** `SkeletonRow`, hauteur 64, `radius.md`, fond `bg.raised`, blocs internes de 32/224/96 px de large, `bg.hover`, `radius.sm` |
| Animation | pulsation d'opacité `1 → 0.55 → 1`, période `900 ms` (`motion.spinnerPeriod`), `easing.standard`. **Aucune** si `prefers-reduced-motion` |
| En-tête | compteur remplacé par `discovery.state.searching` (12 px `meta`, `text.muted`) |
| Bouton actualiser | libellé `discovery.state.refreshing`, icône `refresh` en rotation, `disabled` (mais **focusable** : `aria-disabled="true"`, pas `disabled`, pour ne pas perdre le focus) |
| Bouton créer | **actif** — la création ne dépend jamais de la découverte |
| Aide ① | `discovery.state.searchingHint`, 12 px `meta`, sous la liste, marge haute `space.3` |
| Pastille d'état | aucune (pas de `role="alert"`) : le chargement est annoncé une fois par la région `aria-live="polite"` de l'en-tête |

**Après 8 s** (S1.1b, même état, texte différent) : l'aide ① devient `discovery.state.long` en `text.secondary`,
et un lien `[common.retry]` apparaît à sa droite. La liste continue de se remplir ; rien d'autre ne change.

**Clavier** : le focus reste où il était (sur `[Actualiser]` s'il a été cliqué) ; les squelettes ne sont pas focusables, `aria-hidden="true"`. L'en-tête expose `aria-live="polite"` + `aria-busy="true"` sur `DiscoveryList`.

#### S1.2 — Découverte terminée, liste vide

**Déclencheur** : `discoveryStatus === 'ready'` et `rooms.length === 0` (réseau actif, personne n'héberge).

**Rendu**

```
│                                                                              │
│                            ┌──────────────────────┐                          │
│                            │        ◇ (40 px)     │                          │
│                            └──────────────────────┘                          │
│                             Aucun salon pour l'instant.                       │  15/600
│                Créez un salon sur cette machine, ou attendez qu'un            │  13/1.5 muted
│                     voisin en ouvre un.                                       │
│                                                                              │
│                    [ Créer un salon ]   [ Chercher à nouveau ]                │
│                                                                              │
```

| Élément | Spécification |
|---|---|
| Icône | `◇` 40 px, `text.muted`, `stroke 1.5` — décorative, `aria-hidden` |
| Titre | `discovery.empty.title`, rôle `title.card` (15/600), `text.primary`, marge haute `space.3` |
| Corps | `discovery.empty.body`, `body` (13/1.5), `text.muted`, largeur max 380 px, centré, `text-wrap: pretty` |
| Action primaire | `discovery.empty.action.create` → même action que `[Créer un salon]` |
| Action secondaire | `discovery.empty.action.refresh`, variante `ghost` |
| Bloc | centré verticalement dans la zone de liste, hauteur min `space.10 × 4` (160 px), padding `space.8` |
| Footer | `discovery.state.count.other` avec `{{count}} = 0` → **ne pas afficher le compteur** quand il vaut 0 (sinon on lit « 0 salons » : redondant avec le titre) |
| Bandeau | aucun : l'absence de salon n'est **pas** une erreur |

**ARIA** : le bloc est `role="status"` (pas `alert`) ; annonce unique à l'arrivée dans l'état : titre + corps concaténés.
**Clavier** : `Tab` va au bouton primaire ; `Entrée` crée.

#### S1.3 — Liste peuplée (nominal)

**Déclencheur** : `rooms.length ≥ 1`.

**Rendu (3 salons, dont un complet)**

```
│  Salons sur le réseau local                        3 salons sur ce réseau      │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ (MD)  Salon de Marie                          4/8      [ Rejoindre ]    │  │
│  │       Marie, Théo, Léna, +1                                            │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ (TK)  Table de la cuisine                     8/8      [ Complet ]      │  │
│  │       Théo, Alice, Bob, +5                                             │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ (LN)  Réunion projet                          2/8      [ Rejoindre ]    │  │
│  │       Léna, Sam                                                        │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
```

| Élément | Spécification |
|---|---|
| Pastille | 32 px, cercle, teinte `avatarTint` selon `hash(instanceId) % 8`, initiale du nom d'hôte en 12/600 `text.primary` |
| Nom du salon | `body.strong` (13/500) `text.primary`, **ellipsis** sur 1 ligne (`text-overflow: ellipsis`), largeur max = ligne − 32 − 96 (bouton) − `space.3`×3 |
| Ligne 2 gauche | **les pseudos présents**, 12 px `meta` `text.muted`, comme le croquis de SPEC-001 : jusqu'à **3** noms séparés par `, `, puis `room.row.peopleMore` (`+{{count}}`) si le salon est plus peuplé. Source : liste des membres du beacon (A4/A5). **Repli** si le beacon ne porte pas les noms : `room.row.host` (`Hôte : Marie`). Le nom est ellipsé, jamais coupé au milieu d'un caractère |
| Pourquoi les noms | c'est l'information qui décide de rejoindre (« untel est-il là ? ») ; l'ancienneté du salon ne la remplace pas. Deux lignes suffisent : nom du salon + qui est dedans |
| Compteur | `room.row.members` (`4/8`), 12 px `meta` `text.secondary`, aligné à droite de la ligne 1, marge droite `space.4` |
| Bouton | `room.row.join`, variante `secondary`, hauteur 32, padding `space.1 space.3`, 12/500 |
| Bouton complet | `room.row.full`, variante `secondary`, `aria-disabled="true"`, couleur `text.muted`, fond `bg.inset`, **focusable** (S1.6) |
| Survol de ligne | fond `bg.hover` en `motion.duration.hover`, **sauf** sur une ligne complète (fond inchangé, curseur `default`) |
| Focus clavier | la ligne entière **n'est pas** focusable : seuls les boutons le sont. `Tab` suit l'ordre des lignes |
| Espacement | `space.2` (8 px) entre deux lignes |
| Défilement | la liste défile seule, `scroll-padding-block: space.2`, en-tête et footer fixes |
| Tri | ouverts d'abord (par `openedAt` décroissant), complets en fin de liste |

**Compteur d'en-tête** : `discovery.state.count.other` avec `{{count}} = rooms.length`, pluriel `one`/`other` géré par la clé.
**ARIA** : `DiscoveryList` est un `<ul>` (`role="list"`), chaque `RoomRow` un `<li>` contenant un `<button>` ; le `<button>` porte `aria-label={room.row.joinAria}` (nom + effectif), ce qui évite de lire 5 fragments.

#### S1.4 — Erreur de découverte partielle (mDNS indisponible, repli broadcast)

**Déclencheur** : l'annonce mDNS n'a pas pu démarrer ; le balayage broadcast, lui, fonctionne (liste non vide ou vide mais rafraîchie).

**Rendu**

```
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ ⚠  Découverte mDNS indisponible                                        │  │  state.warn
│  │    Repli automatique sur le balayage broadcast UDP (port 47820).        │  │
│  │    Les salons restent trouvables.                                      │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ (MD)  Salon de Marie                                  4/8 · Hôte : Marie │  │
```

| Élément | Spécification |
|---|---|
| Band | hauteur auto, padding `space.3`, fond `state.warnSubtle`, bordure gauche **3 px** `state.warn`, `radius.md`, marge basse `space.3` |
| Icône | `warning` 16 px, `state.warn`, alignée sur la première ligne de texte |
| Titre | `discovery.error.mdns.title`, 13/600, `state.warn` |
| Corps | `discovery.error.mdns.body`, 12/1.5, `text.secondary` |
| Action | aucune (état récupéré automatiquement) — pas de bouton, rien à faire pour l'utilisateur |
| Liste | **conservée et fonctionnelle** : le bandeau ne remplace jamais le contenu |
| Footer | la méthode affichée devient `discovery.method.broadcast` |

**ARIA** : `role="status"` + `aria-live="polite"` (ce n'est pas bloquant). Jamais `alert`.

#### S1.5 — Découverte totalement en échec

**Déclencheur** : aucune méthode n'a démarré (mDNS KO **et** bind UDP 47820 impossible).

**Rendu**

```
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ ⛔ Découverte impossible                           [ Réessayer ]        │  │  state.mute
│  │    Aucune méthode de découverte n'a pu démarrer.                        │  │
│  │    Vous pouvez quand même créer un salon sur cette machine.             │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  ◇  Aucun salon pour l'instant.                                        │  │
│  │     La liste ne peut pas être remplie pour le moment.                   │  │
│  │     [ Créer un salon ]                                    [ Réessayer ] │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
```

| Élément | Spécification |
|---|---|
| Bandeau | fond `state.muteSubtle`, bordure gauche 3 px `state.mute`, `role="alert"`, annoncé **une fois** |
| Titre | `discovery.error.alldown.title`, 13/600 `state.mute` |
| Corps | `discovery.error.alldown.body`, 12/1.5 `text.secondary` |
| Action du bandeau | `[common.retry]`, variante `ghost`, relance les deux méthodes ; hauteur 28 |
| Liste | remplacée par un `EmptyState` **spécifique** : titre `discovery.empty.title`, corps = **`discovery.error.alldown.body` réutilisé** (pas de nouvelle clé) |
| Bouton créer | **actif**, variante `primary` — c'est le seul chemin utile, il est mis en avant |
| Footer | méthode `discovery.method.none`, en `state.mute` |
| Interdits | pas de modale bloquante, pas de grisé global, pas de « réessayer » unique en plein écran |

**Mode hors ligne complet** : dans cet état, on peut créer un salon et y rester seul, changer de pseudo,
ouvrir E3, régler le micro, l'overlay et le raccourci. La seule chose impossible est de voir les salons des autres.

#### S1.6 — Salon complet (refus d'entrée côté liste)

**Déclencheur** : `room.memberCount === 8`.

**Rendu (zoom sur la ligne et l'infobulle)**

```
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ (TK)  Table de la cuisine                             8/8 · Hôte : Théo  │  │
│  │       ouvert il y a 3 min                                    [ Complet ] │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                          ┌─────────────────────────────────┐ │
│                                          │ Ce salon a déjà 8 participants. │ │
│                                          └─────────────────────────────────┘ │
```

| Élément | Spécification |
|---|---|
| Bouton | `room.row.full`, libellé `room.row.full` (« Complet »), `aria-disabled="true"`, `aria-describedby` → l'id de la raison |
| Couleurs | fond `bg.inset`, texte `text.muted`, bordure `border.subtle` — lecture « inactif » sans descendre le contraste du texte sous 4.5:1 (`text.muted` sur `bg.inset` = 5.99:1 sombre / 5.35:1 clair) |
| Curseur | `not-allowed` |
| Infobulle | affichée au survol **et au focus clavier**, après 400 ms ; contenu `room.row.fullReason` ; 12 px, fond `bg.raised`, `shadow.2`, `radius.sm`, padding `space.4 space.2` ; **ne reçoit jamais la souris** (`pointer-events: none`) |
| Compteur | `8/8` en `text.secondary` ; `8/8` n'est jamais coloré en `state.mute` (un salon plein n'est pas une erreur) |
| Clic | ignoré : pas de navigation, pas de toast répété. Un `Entrée` sur le bouton **focusé** re-annonce la raison via la région `aria-live` |
| Tri | ces lignes passent en fin de liste (S1.3) |

#### S1.7 — Actualisation manuelle en cours

**Déclencheur** : clic sur `[Actualiser]` alors que des salons sont déjà affichés.

| Élément | Spécification |
|---|---|
| Bouton | `disabled` **visuellement** mais `aria-disabled="true"` (le focus reste), icône `refresh` en rotation, libellé conservé |
| Liste | **inchangée**, pas de squelettes, pas de clignotement (on ne détruit pas une liste valide) |
| Compteur | inchangé ; un `aria-live="polite"` annonce `discovery.state.refreshing` |
| Durée minimale d'affichage du spinner | 400 ms (évite le flash si la réponse est immédiate) |
| Fin | soit la liste se met à jour sans transition, soit S1.4/S1.5 s'ajoute en bandeau |

#### S1.8 — Création de salon (dialogue)

**Déclencheur** : `[Créer un salon]` ou `Ctrl+N`.

**Rendu (état par défaut)**

```
│        ┌──────────────────────────────────────────────────────────┐          │
│        │  Créer un salon                                      [×] │          │
│        │                                                          │          │
│        │  Le salon n'existe que sur cette machine, tant que vous  │          │
│        │  y êtes.                                                 │          │
│        │                                                          │          │
│        │  Nom du salon                                            │          │
│        │  ┌────────────────────────────────────────────────────┐  │          │
│        │  │ Salon de Vous                                  32 │  │          │
│        │  └────────────────────────────────────────────────────┘  │          │
│        │  Visible sur le réseau local. 32 caractères maximum.     │          │
│        │                                                          │          │
│        │  Places : 8 (plafond du maillage)                        │          │
│        │                                                          │          │
│        │                              [ Annuler ]  [Créer et rejoindre]│       │
│        └──────────────────────────────────────────────────────────┘          │
```

| Élément | Spécification |
|---|---|
| Boîte | largeur **420 px**, `radius.xl`, fond `bg.surface`, `shadow.3`, scrim `scrim.dialog`, padding `space.6` |
| Focus initial | le champ `Nom du salon`, texte **présélectionné** |
| Pré-remplissage | `room.create.namePlaceholder` avec `{{name}}` = pseudo → `Salon de Vous` ; si le champ est vidé, on ne re-pré-remplit pas |
| Compteur | `{{n}}/32` à droite dans le champ, 11 px `text.muted`, passe `state.warn` à 28, `state.mute` à 32 |
| Capacité | `room.create.capacity`, 12 px `text.secondary`, **non modifiable** (plafond matériel du maillage) |
| Erreur `vide` | `room.create.error.empty` sous le champ, `border.strong` remplacée par `state.mute`, `aria-invalid` |
| Erreur `trop long` | `room.create.error.tooLong` + compteur en `state.mute` ; la saisie est **bloquée** à 32 (`maxLength`) donc l'erreur ne devrait jamais apparaître — elle existe pour le collage programmatique |
| Erreur `déjà un salon` | `room.create.error.exists`, bandeau dans le dialogue, `[Créer et rejoindre]` désactivé |
| Fermeture | `Échap`, `[×]`, `[Annuler]`, clic sur le scrim ; focus rendu au bouton d'origine |
| Piège de focus | `role="dialog" aria-modal="true"` + `aria-labelledby` du titre ; `Tab` reste dans le dialogue |

#### S1.9 — Salon disparu entre l'affichage et le clic

**Déclencheur** : l'utilisateur clique `[Rejoindre]` sur un salon qui vient de fermer (la tentative de connexion échoue).

| Élément | Spécification |
|---|---|
| Action | la ligne concernée passe en état `stale` : nom conservé, compteur remplacé par `room.row.gone` (12 px, `text.muted`), bouton remplacé par un `[common.refresh]` ghost de 28 px |
| Toast | `room.row.gone`, `role="status"`, bas-droite, `bg.raised`, `shadow.2`, `radius.md`, bordure gauche 3 px `state.warn`, 4 s puis disparition en `motion.duration.fade` |
| Focus | reste sur le bouton `[Actualiser]` de la ligne (pas de perte de focus) |
| Nettoyage | la ligne est retirée à la prochaine découverte réussie (pas d'accumulation) |

#### S1.10 — Aucune interface réseau active (hors ligne complet)

**Déclencheur** : aucune interface réseau « up » ; la découverte ne peut rien trouver.

**Rendu**

```
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ ⚠  Aucun réseau actif                                                  │  │
│  │    Vous pouvez créer un salon sur cette machine et y parler. Il         │  │
│  │    deviendra visible pour les autres dès qu'une interface réseau sera   │  │
│  │    connectée.                                                          │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                        ◇                                                    │
│              Aucun salon pour l'instant.                                     │
│              Créez un salon sur cette machine, ou attendez qu'un             │
│              voisin en ouvre un.                                             │
│              [ Créer un salon ]        [ Chercher à nouveau ]                │
│  ──────────────────────────────────────────────────────────────────────────  │
│  Hors ligne — la liste se remplira dès qu'un réseau sera disponible.         │
```

| Élément | Spécification |
|---|---|
| Bandeau | `discovery.offline.title` / `.body`, ton `warn` (pas `error` : ce n'est pas la faute de l'app) |
| Liste | `EmptyState` standard (S1.2) |
| Boutons | les deux **actifs** ; `[Chercher à nouveau]` relance la découverte (elle échouera, l'état reste identique, pas de pile de bandeaux) |
| Footer | `discovery.footer.offline` remplace le port + la méthode ; la mention du port disparaît (il n'y a pas de socket) |
| Reprise | dès qu'une interface remonte, l'état repasse à S1.1 puis S1.2/S1.3 sans action utilisateur |
| Interdits | pas de plein écran « Hors ligne », pas de bouton « Réessayer » unique, pas de `role="alert"` |

### 3.2 Deux écarts assumés avec le croquis de SPEC-001

Le croquis de SPEC-001 (§Interface) est un schéma de principe ; deux détails de mise en œuvre s'en écartent.
Ils sont listés ici pour ne pas être découverts à la relecture.

| Croquis SPEC-001 | Ce document | Pourquoi |
|---|---|---|
| `Desktop LAN  [pseudo: Régie]  [⚙] [—][□][×]` — le pseudo est **dans la barre de titre** | le pseudo est dans une **`IdentityRow`** dédiée, sous l'en-tête | un champ de saisie de 32 caractères dans une barre de 44 px ne laisse la place ni au libellé (`app.nickname.label`), ni à l'aide (`app.nickname.help`), ni au compteur `n/32` : trois exigences de S1.11 et de l'accessibilité (8.3) qu'un champ de barre de titre ne peut pas porter. La barre de titre garde 4 contrôles et reste lisible à 200 % de zoom |
| `● Studio  3/8  Alice, Bob, Chloé  [Rejoindre]` — une seule ligne avec les noms | deux lignes : nom du salon + compteur/bouton, puis **les pseudos** en `meta` | on garde exactement l'information voulue par le croquis (les noms sont là), mais la ligne de 64 px permet deux niveaux de lecture sans troncature agressive du nom du salon |

Rien d'autre ne s'écarte : ports, plafond de 8, pastille dérivée de l'`instanceId`, VAD 120/400 ms,
overlay 28 px / halo 2 px / 80 ms, `focusable:false`, `-webkit-app-region: drag` sont repris tels quels.
Le **pseudo par défaut** est le prénom du compte OS (SPEC-001 A6) : `IdentityRow` est initialisé avec cette
valeur, et le champ n'est **pas** un placeholder trompeur — si le prénom OS est introuvable, le champ est vide
et l'erreur `app.nickname.error.empty` s'applique à la sortie de champ.

#### S1.11 — Pseudo invalide (champ d'identité)

**Déclencheur** : champ vidé puis quitté, ou saisie > 32 caractères (collage).

| Élément | Spécification |
|---|---|
| Champ | bordure `state.mute` (1 px, pas 2 : le focus garde son anneau `focus.ring` à 2 px), `aria-invalid="true"` |
| Message | `app.nickname.error.empty` / `.tooLong`, 12 px `state.mute`, marge haute `space.1`, `id` lié par `aria-describedby` |
| Effet | le pseudo **précédent valide reste en vigueur** ; les salons continuent de l'afficher ; rien d'autre n'est bloqué |
| Retour à la normale | à la première frappe valide, l'erreur disparaît (`instant`), puis `app.nickname.saved` en toast à la sortie de champ |
| Interdit | pas de validation bloquante, pas de `disabled` sur `[Créer un salon]` |

---

## 4. E2 — Dans un salon

### 4.0 Anatomie et arborescence des composants

```
RoomScreen              { room, participants, selfId, connection, audio }
├─ TitleBar             { displayName, theme, onToggleTheme, onOpenSettings, windowControls }
├─ RoomHeader           { roomName, memberCount, quality, latencyMs, pinned, isHost, onTogglePin, onOpenSettings, onLeave }
│  ├─ RoomName          { name }
│  ├─ MembersBadge      { count, capacity: 8 }
│  ├─ QualityPill       { quality: 'excellent' | 'fair' | 'poor', latencyMs }
│  ├─ IconButton        { icon: 'pin', pressed: pinned, labelKey: 'room.pin.off' | 'room.pin.on' }
│  ├─ IconButton        { icon: 'gear', labelKey: 'control.settingsAudio' }
│  └─ Button            { variant: 'danger', labelKey: 'room.leave' }
├─ BannerStack          { banners }                       // erreurs de périphérique / moteur audio
├─ ParticipantGrid      { participants, selfId, selfMuted, selfDeafened, mode, onLocalVolume, onLocalMute, onRetryPeer }
│  ├─ ParticipantTile   { participant, isSelf, speaking, micState, deafened, connection, localVolume, localMuted }
│  │  ├─ Avatar         { instanceId, initial, size: 40, speaking, muted, deafened, badge: 'mic-off' | null }
│  │  ├─ TileIdentity   { displayName, stateLine, isSelf }
│  │  ├─ LocalVolumeControl { value, onChange, muted, visible: hover | focus-within }
│  │  └─ ConnectionBadge{ state, retryInSeconds, onRetry }
│  └─ TileSkeleton     { count }                          // S2.1 uniquement
├─ ControlBar           { selfMuted, selfDeafened, mode, level, threshold, noiseFloor, calibrating, pttActive }
│  ├─ MicMeter          { levelDbfs, thresholdDbfs, noiseFloorDbfs, mode, state: 'idle' | 'live' | 'calibrating' | 'calibrated' }
│  ├─ MeterPopover      { open, value, noiseFloor, onChange, onCalibrate, calibrating }   // ancré au-dessus de MicMeter
│  ├─ ControlButton     { kind: 'mute' | 'deafen', active, labelKey, shortcutKey }
│  ├─ ModeSegment       { value: 'ptt' | 'vad', onChange }
│  ├─ PttHint           { shortcut, active, suppressedByMute }
│  └─ Button            { variant: 'danger', icon: 'leave', labelKey: 'control.leave' }
├─ ToastRegion          { toasts, onDismiss }
└─ LiveRegion           { message }                       // sr-only, aria-live="polite"
```

**Props — détail**

| Composant | Prop | Type | Rôle |
|---|---|---|---|
| `RoomScreen` | `connection` | `'connecting' \| 'connected' \| 'full-rejected' \| 'closed'` | pilote S2.1 / S2.2 / S2.11 / S2.12 |
| | `audio` | `{ status: 'ok' \| 'init-failed' \| 'device-lost', ... }` | pilote S2.13 / S2.14 |
| `ParticipantTile` | `connection` | `'connecting' \| 'connected' \| 'ice-retrying' \| 'ice-failed'` | pilote S2.3 |
| | `micState` | `'on' \| 'muted'` | état **reçu** du pair (fiabilité : c'est le pair qui déclare son mute) |
| | `localVolume` | `number` (0–1.5) | volume local de ce pair, jamais transmis au pair |
| | `localMuted` | `boolean` | « couper pour moi » |
| `MicMeter` | `levelDbfs` | `number` (−70…0) | niveau **post-traitement** (après RNNoise / AEC), celui qui décide l'ouverture |
| | `thresholdDbfs` | `number` (−70…−10) | seuil VAD ; non utilisé en mode PTT (masqué, §7.1) |
| | `noiseFloorDbfs` | `number` | plancher de bruit mesuré, recalculé en continu (médiane glissante 3 s) |

**Géométrie**

| Zone | Hauteur | Padding | Fond |
|---|---|---|---|
| `RoomHeader` | 56 | `space.4` horizontal | `bg.surface`, bordure basse `border.subtle` |
| `BannerStack` | auto | `space.4` horizontal, `space.2` vertical | `state.*Subtle` |
| `ParticipantGrid` | flexible, défile | `space.6` | transparent |
| Grille | `repeat(auto-fill, minmax(200px, 1fr))`, `gap: space.3` | — | — |
| `ParticipantTile` | 88 | `space.4` | `bg.raised`, `radius.lg`, `shadow.1`, bordure `border.subtle` |
| `ControlBar` | 72 | `space.4`, `gap: space.3` | `bg.surface`, bordure haute `border.subtle`, `shadow.2` |
| `MeterPopover` | 168 | `space.4` | `bg.raised`, `shadow.3`, `radius.lg`, largeur 300, ancré `space.2` au-dessus de la barre |
| `ToastRegion` | — | `space.4` de la barre | bas-droite, largeur 320, empilé `space.2` |

**Contenu d'une tuile** (deux lignes, jamais trois) :

```
┌──────────────────────────────────────────────┐
│ (MD)   Marie                       🔊 ───●── │   40 px avatar | nom 13/500
│        parle                                  │   ligne 2 = UNE seule info d'état
└──────────────────────────────────────────────┘
```

La ligne 2 porte **une** information, par ordre de priorité : `participant.iceFailed` > `participant.iceRetrying`
> `participant.connecting` > `participant.muted` > `participant.deafened` > `participant.speaking` > (rien, vide).
Ainsi deux états ne se disputent jamais la même ligne. Les icônes correspondantes s'ajoutent à côté du nom.

### 4.1 États

#### S2.1 — Connexion en cours

**Déclencheur** : le salon est rejoint, la signalisation a répondu, les `RTCPeerConnection` ne sont pas encore `connected`. Dure typiquement 200 ms – 3 s.

**Rendu**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ◈ Desktop LAN — voix locale                         [☾]  [⚙ Réglages]  – □ ×  │
├──────────────────────────────────────────────────────────────────────────────┤
│  ← Salon de Marie            4/8 participants   ◌ Connexion au salon…   📌 ⚙  │
├──────────────────────────────────────────────────────────────────────────────┤
│  ┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐          │
│  │ (VO)  Vous        │ │ ▒▒▒▒              │ │ ▒▒▒▒              │          │
│  │       Connexion…  │ │ ▒▒▒▒▒▒▒▒▒▒▒▒      │ │ ▒▒▒▒▒▒▒▒▒▒▒▒      │          │
│  └───────────────────┘ └───────────────────┘ └───────────────────┘          │
│  ┌───────────────────┐                                                      │
│  │ (MD)  Marie       │                                                      │
│  │       Connexion…  │                                                      │
│  └───────────────────┘                                                      │
├──────────────────────────────────────────────────────────────────────────────┤
│ ▏░░░░░░▕  [🎙 Muet]  [🎧 Sourdine]  ( Appuyer | Détection )   Maintenez…    │
└──────────────────────────────────────────────────────────────────────────────┘
```

| Élément | Spécification |
|---|---|
| En-tête | occupation conservée (`4/8 participants`), qualité masquée (aucune mesure fiable) |
| Ma tuile | **toujours rendue en premier**, état `participant.connecting`, avatar à teinte pleine, pas de squelette (je sais qui je suis) |
| Tuiles des pairs | `TileSkeleton` de même géométrie (88 px), 3 blocs internes, pulsation `motion.spinnerPeriod` |
| Barre de contrôle | **entièrement utilisable** : je peux me mettre muet avant même que le son passe (c'est le comportement attendu) |
| MicMeter | actif : le niveau local ne dépend pas du réseau |
| Sortie | `[Quitter]` actif à tout moment, sans confirmation |
| Durée > 8 s | l'en-tête ajoute `discovery.state.long` réutilisée ? **Non** — on garde `room.connecting` et on ajoute un `aria-live` `participant.iceRetrying` par pair concerné |
| ARIA | `aria-busy="true"` sur `ParticipantGrid` ; annonce unique `a11y.roomJoined` **à la fin** de S2.1, pas au début |

#### S2.2 — Nominal : tout le monde est connecté

**Déclencheur** : `connection === 'connected'` et toutes les tuiles `connected`.

**Rendu**

```
├──────────────────────────────────────────────────────────────────────────────┤
│  Salon de Marie              4/8 participants   ● Qualité excellente · 12 ms  │
├──────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────┐ ┌─────────────────────────┐                    │
│  │ (VO)  Vous              │ │ (MD)  Marie       🔊 ─●─ │                    │
│  │                         │ │       parle              │                    │
│  └─────────────────────────┘ └─────────────────────────┘                    │
│  ┌─────────────────────────┐ ┌─────────────────────────┐                    │
│  │ (TK)  Théo        🔊 ─●─ │ │ (LN)  Léna        🔊 ─●─ │                    │
│  │                         │ │                          │                    │
│  └─────────────────────────┘ └─────────────────────────┘                    │
├──────────────────────────────────────────────────────────────────────────────┤
│ ▏███░░░░▕ 7 dB  [🎙 Muet]  [🎧 Sourdine] (Appuyer|Détection) Maintenez Alt+Espace│
```

| Élément | Spécification |
|---|---|
| Badge d'occupation | `room.header.members` (`4/8 participants`), 12 px `meta`, `radius.pill`, fond `bg.inset`, padding `space.1 space.2` |
| Pastille qualité | pastille 6 px + `room.header.quality` avec `quality.excellent` = `state.ok`, `fair` = `state.warn`, `poor` = `state.mute`, suivi de ` · ` + `room.header.latency` |
| Tuile qui parle | avatar entouré d'un **halo 2 px** `state.speaking` à `2 px` de l'avatar (`overlay.haloOffset`), transition **80 ms** ; la ligne 2 affiche `participant.speaking` en `text.secondary` |
| Tuile silencieuse | pas de halo, ligne 2 vide (hauteur de ligne conservée pour éviter le saut de mise en page) |
| Ma tuile | jamais de halo si muet ; nom = `participant.you` (+ pseudo réel en `title`) ; pas de curseur de volume |
| Volume local | `LocalVolumeControl` visible au survol ou `:focus-within`, sinon masqué (`opacity: 0`, mais **focusable** : il apparaît au focus) |
| Ordre de la grille | moi d'abord, puis par ordre d'arrivée (stable) |
| Qualité « dégradée » | voir S2.15 |

#### S2.3 — Pair en échec ICE

**Déclencheur** : `iceConnectionState` d'un pair passe à `disconnected` / `failed` alors que la connexion était établie.

**Rendu**

```
│  ┌─────────────────────────┐ ┌─────────────────────────┐                    │
│  │ (MD)  Marie       🔊 ─●─ │ │ (TK)  Théo ⚠      🔊 ─●─ │                    │
│  │       parle              │ │  Reconnexion… (4 s)      │                    │
│  └─────────────────────────┘ └─────────────────────────┘                    │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ ⚠  Connexion perdue avec Théo.                          [ Réessayer ]  │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
```

| Élément | Spécification |
|---|---|
| Phase 1 (`ice-retrying`, 0–30 s) | avatar à **40 % d'opacité sur la seule pastille** (le texte reste à pleine opacité, contraste inchangé) ; `ConnectionBadge` = `participant.iceRetrying` avec secondes restantes ; icône `warning` 16 px `state.warn` après le nom ; bordure de tuile `state.warn` 1 px |
| Phase 2 (`ice-failed`, > 30 s) | bordure `state.mute`, badge `participant.iceFailed` + bouton `[participant.iceFailedAction]` 28 px `ghost`, halo de parole **forcé à 0** |
| Bandeau | apparaît **seulement en phase 2** ou si ≥ 2 pairs sont en échec en même temps ; `role="status"` ; texte `participant.connectionLost` (`{{name}}`) + action `common.retry` |
| Reprise auto | backoff 1 → 2 → 4 → 8 → 16 → 30 s, **plafonné à 30 s**, jamais abandonné tant que le salon est ouvert |
| Reprise réussie | badge disparaît, bordure redevient `border.subtle`, annonce `a11y.iceRecovered` |
| Audio | le pair en échec est **retiré du mixage** immédiatement (pas de silence trompeur ni de crachotement) |
| Mon audio vers lui | suspendu ; je continue d'entendre les autres |
| Ne pas faire | ❌ fermer la tuile, ❌ afficher une modale, ❌ retirer le pair de la liste, ❌ bloquer le reste du salon |

#### S2.4 — Pair parti

**Déclencheur** : un pair ferme sa session (départ propre ou timeout de signalisation > 10 s).

**Rendu (pendant 2 s)**

```
│  ┌─────────────────────────┐ ┌─────────────────────────┐                    │
│  │ (MD)  Marie       🔊 ─●─ │ │ ░░░░  Léna  (fondu)     │                    │
│  │       parle              │ │                          │                    │
│  └─────────────────────────┘ └─────────────────────────┘                    │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                      ┌─────────────────────┐ │
│                                                      │ Léna a quitté le…   │ │
│                                                      └─────────────────────┘ │
```

| Élément | Spécification |
|---|---|
| Tuile | fondu `1 → 0` sur `motion.duration.fade` (160 ms) **puis** effondrement de la case (largeur/hauteur animées `motion.duration.panel`, 200 ms) ; les autres tuiles se replacent sans à-coup |
| Compteur | `room.header.members` décrémenté **immédiatement** (pas après l'animation) |
| Toast | `participant.left` (`{{name}}`), 4 s, `role="status"` |
| Annonce SR | `a11y.left`, **une seule fois** (le toast et la région live ne se doublent pas : le toast est `aria-hidden="true"`, la région live parle) |
| Pair sans audio depuis > 10 s mais signalisation vivante | **ne pas** afficher « parti » : c'est S2.3 |
| Dernier pair parti | voir S2.12, pas de toast « Léna a quitté » suivi immédiatement d'un écran vide |
| `prefers-reduced-motion` | disparition instantanée (`motion.reducedMotionDuration`) |

#### S2.5 — Moi muet

**Déclencheur** : clic sur `[Muet]` ou `Ctrl+M`.

**Rendu (barre de contrôle et ma tuile)**

```
│  ┌─────────────────────────┐                                                │
│  │ (VO)  Vous        🎙̸    │                                                │
│  │       Muet               │                                                │
│  └─────────────────────────┘                                                │
├──────────────────────────────────────────────────────────────────────────────┤
│ ▏░░░░░░▕  —   [🔇 Muet]  [🎧 Sourdine]  ( Appuyer | Détection )  Maintenez…  │
```

| Élément | Spécification |
|---|---|
| Bouton | variante `danger` **pleine** (fond `state.mute`, texte `text.inverse` : contraste 5.29:1), libellé `control.mute.state` (« Muet »), `aria-pressed="true"` |
| Ma tuile | badge `mic-off` 12 px en bas-droite de l'avatar (fond `bg.surface`, icône `state.mute`, cercle 12 px à cheval sur le bord) ; ligne 2 = `participant.muted` ; **pas de halo, jamais**, même si du son arrive |
| MicMeter | remplacé par un état « muet » : barre vide `bg.inset` + tiret `—` à la place du niveau ; le seuil reste affiché en mode VAD (il reste utile) mais grisé à 60 % (élément décoratif, pas de texte) |
| Transmission | la piste est **coupée côté émetteur** (`track.enabled = false`), pas seulement en aval — l'indicateur ne peut donc pas mentir |
| Annonce | `a11y.selfMuted` / `a11y.selfUnmuted` via `LiveRegion` |
| Persistance | le mute **ne survit pas** à la sortie du salon (on repart micro ouvert au prochain salon) — décision : un mute oublié est la première cause de « on ne m'entend pas » |
| Clavier | `Ctrl+M` bascule ; le bouton est dans l'ordre de tabulation |

#### S2.6 — Moi sourd (sourdine)

**Déclencheur** : clic sur `[Sourdine]` ou `Ctrl+Shift+M`.

**Rendu**

```
│  ┌─────────────────────────┐ ┌─────────────────────────┐                    │
│  │ (VO)  Vous              │ │ (MD)  Marie 🎧̸    🔊 ─●─ │                    │
│  │                         │ │       parle              │                    │
│  └─────────────────────────┘ └─────────────────────────┘                    │
├──────────────────────────────────────────────────────────────────────────────┤
│ ▏███░░░░▕ 7 dB  [🎙 Muet]  [🎧̸ Sourdine] (Appuyer | Détection)  Maintenez…  │
```

| Élément | Spécification |
|---|---|
| Bouton | variante `danger` pleine, `aria-pressed="true"`, libellé `control.deafen.state` |
| Effet audio | **la sortie est coupée, l'entrée reste active** — je peux parler, je n'entends personne. C'est la sémantique de `control.deafen.help`, affichée en infobulle (400 ms, au survol **et** au focus) |
| Tuiles distantes | icône `headphones-off` 16 px `state.mute` après le nom, **et** un liseré de 1 px `state.mute` en haut de la tuile (repère de forme, pas seulement de couleur) |
| Halos de parole | **conservés** : je vois qui parle, je ne l'entends pas. (Information utile, et c'est la seule façon de savoir que le salon est vivant.) |
| Textes | **aucune** réduction d'opacité : le contraste doit rester AA (piège classique) |
| MicMeter | inchangé et actif (mon micro continue d'émettre) |
| Interaction avec le mute | indépendants : muet + sourd est un état valide (S2.6 ne modifie pas S2.5) |
| Annonce | `a11y.selfDeafened` / `a11y.selfUndeafened` |
| Clavier | `Ctrl+Shift+M` |

#### S2.7 — PTT enfoncé (mode « Appuyer pour parler », appui en cours)

**Déclencheur** : raccourci global maintenu, mode `ptt`, micro non muet.

**Rendu**

```
├──────────────────────────────────────────────────────────────────────────────┤
│  Salon de Marie       4/8 participants   ● Qualité excellente · 12 ms         │
│  ┌─────────────────────────┐                                                │
│  │ (VO)  Vous              │   ◄ halo 2 px state.speaking, apparu en 80 ms   │
│  │       parle              │                                                │
│  └─────────────────────────┘                                                │
├──────────────────────────────────────────────────────────────────────────────┤
│ ▏██████░▕ −18 dB  [🎙 Muet] [🎧 Sourdine] (Appuyer|Détection)               │
│ ┌─────────────────────┐                                                      │
│ │ ● Micro ouvert      │  ← pastille state.speaking + control.ptt.active       │
│ └─────────────────────┘                                                      │
```

| Élément | Spécification |
|---|---|
| Ma tuile | halo `state.speaking` 2 px, `opacity` du halo `0 → 1` en `motion.duration.halo` (80 ms), **pas de scale, pas de flash** ; ligne 2 = `participant.speaking` |
| Indicateur | pastille 6 px `state.speaking` + `control.ptt.active` (« Micro ouvert ») dans la barre, à droite du `MicMeter` ; apparaît/disparaît en 80 ms |
| MicMeter | barre de niveau active et colorée `state.speaking` (le niveau reste affiché : c'est la preuve visuelle que ça capte) |
| Seuil | **masqué** en mode PTT (§7.1) : il n'a aucun effet, l'afficher serait un mensonge |
| Fenêtre en arrière-plan | l'indicateur doit rester visible : c'est l'overlay qui porte l'information (S4.2) ; la barre de contrôle n'est pas visible, donc **pas de dépendance à E2** |
| Relâchement | halo `1 → 0` en 80 ms, pastille masquée, `track.enabled = false` |
| Annonce SR | **aucune** à chaque appui (ce serait du spam toutes les 2 s). Le changement de mode est annoncé, pas chaque appui |
| Anti-rebond | un appui < 120 ms est ignoré (évite un clic parasite en changeant de fenêtre) ; `Espace` répété ne relance pas de tonalité |

#### S2.8 — PTT enfoncé alors que je suis muet (état d'échec explicite)

**Déclencheur** : raccourci maintenu, mode `ptt`, `selfMuted === true`.

**Décision de conception** : **le mute est prioritaire.** Un mute est une intention explicite et durable (« je ne veux pas être entendu ») ; un appui réflexe ne doit pas l'annuler en silence. L'application **n'ouvre pas** le micro et le dit.

**Rendu**

```
├──────────────────────────────────────────────────────────────────────────────┤
│ │🔇 Muet  ⚠  Vous êtes muet : Alt+Espace n'ouvre pas le micro.        │
└──────────────────────────────────────────────────────────────────────────────┘
```

| Élément | Spécification |
|---|---|
| Bandeau | apparaît dans la barre de contrôle, au-dessus du `MicMeter` : fond `state.warnSubtle`, texte `control.ptt.whileMuted` 12 px, bordure gauche 2 px `state.warn`, hauteur 28, `radius.sm` |
| Durée | reste tant que la touche est tenue + 1,5 s après le relâchement |
| Audio | **rien n'est transmis** ; `track.enabled` reste `false` ; aucun paquet n'est émis |
| Ma tuile | **pas de halo** (sinon on mentirait sur l'émission) |
| Annonce SR | `a11y.pttIgnored`, une fois par appui (pas en boucle tant que la touche est tenue) |
| Sortie | un clic sur `[Muet]` lève le mute ; le prochain appui fonctionne |
| Alternative écartée | ⛔ « PTT annule le mute » : provoque des fuites de voix involontaires et un état de mute qui ne veut plus rien dire |

#### S2.9 — Mode détection de voix, réglage du seuil en cours

**Déclencheur** : mode `vad` et l'utilisateur ouvre `MeterPopover` (clic sur le `MicMeter` ou `Alt+S`).

**Rendu**

```
│        ┌──────────────────────────────────────────────────────────────┐      │
│        │  Détection de voix                                   [×]     │      │
│        │  ┌────────────────────────────────────────────────────────┐  │      │
│        │  │▒▒▒▒▒▒▒▒▒▒▒▒│█████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│  │ 48 px
│        │  │  bruit    ▲ seuil −38 dBFS                             │  │      │
│        │  └────────────────────────────────────────────────────────┘  │      │
│        │    −70      −60      −50      −40      −30      −20      −10 │      │
│        │  Seuil d'ouverture                        −38 dBFS           │      │
│        │  ─────────●──────────────────────────────                    │      │
│        │  Bruit ambiant mesuré : −62 dBFS                             │      │
│        │  Niveau actuel : −24 dBFS                                    │      │
│        │  Ouvre en 120 ms, ferme en 400 ms                            │      │
│        │  Gardez le seuil au-dessus du bruit ambiant et sous votre voix│      │
│        │                                    [ Calibrer ]  [ Fermer ] │      │
│        └──────────────────────────────────────────────────────────────┘      │
├──────────────────────────────────────────────────────────────────────────────┤
│ ▏████░░░▕ −24 dB  [🎙 Muet] [🎧 Sourdine] ( Appuyer | Détection )           │
```

| Élément | Spécification exacte |
|---|---|
| Puits | hauteur **48 px** (popover) / **32 px** (barre), fond `bg.inset`, `radius.sm`, bordure `border.subtle` |
| Barre de niveau | remplissage horizontal `−70 → −10 dBFS` mappé sur 0 → 100 % ; couleur `accent.default` sous le seuil, `state.speaking` au-dessus ; rafraîchi à **30 Hz**, lissage attaque 10 ms / release 180 ms |
| **Zone de bruit ambiant** | bande de `−70` à `noiseFloor + 6 dB`, fond `bg.hover` à 100 % et hachures diagonales 45° (`repeating-linear-gradient`, trait 1 px `border.subtle`, pas 6 px) — on **voit** où est le plancher, sans lire un chiffre |
| **Marqueur de seuil** | ligne verticale **2 px** `state.warn` sur toute la hauteur + poignée triangulaire 8×6 px au-dessus ; déplaçable (souris) et au clavier (flèches ±1 dB, `Page↑/↓` ±6 dB) ; `role="slider"`, `aria-valuemin=-70`, `aria-valuemax=-10`, `aria-valuenow`, `aria-valuetext="{−38} dBFS"` |
| Graduations | −70 / −60 / −50 / −40 / −30 / −20 / −10, 11 px `typography.family.mono` `text.muted`, sous le puits |
| Valeur | `settings.vad.thresholdValue` avec `{{db}} = −38`, en `body.strong`, alignée à droite du libellé `settings.vad.threshold` |
| Bruit ambiant | `settings.vad.noiseFloor` (`−62 dBFS`), 12 px `meta` ; pendant les 3 premières secondes : `settings.vad.noiseMeasuring` |
| Niveau actuel | `settings.vad.liveLevel`, 12 px `meta`, mis à jour à 10 Hz (pas 30 Hz : le texte qui bouge est illisible) |
| Hystérésis | `settings.vad.hysteresis`, 12 px `text.muted` — rend le comportement prévisible |
| **Avertissement de seuil trop bas** | dès que `threshold < noiseFloor + 6`, le texte d'aide devient `settings.vad.helpTooLow` en `state.warn` et le marqueur passe à 3 px ; **on n'empêche pas** de descendre (l'utilisateur peut vouloir un micro très sensible), mais il est averti |
| Aide | `settings.vad.help` sinon, 12 px `text.secondary` |
| Effet immédiat | chaque mouvement du marqueur s'applique **en direct** au moteur (pas de `[Appliquer]`), avec anti-rebond 100 ms ; la valeur est persistée à la fermeture |
| Fermeture | `Échap`, `[×]`, clic extérieur ; le focus revient au `MicMeter` |
| Fermeture pendant un drag | le drag est abandonné, la dernière valeur appliquée est conservée |

#### S2.10 — Calibration du seuil en cours, puis proposition

**Déclencheur** : `[Calibrer]` dans `MeterPopover`.

**Rendu — pendant (3 s)**

```
│        │  ┌────────────────────────────────────────────────────────┐  │
│        │  │ Calibration… restez silencieux (3)                      │  │
│        │  │ ▒▒▒▒▒▒▒▒▒▒▒▒▒▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│  │
│        │  └────────────────────────────────────────────────────────┘  │
│        │  Mesure du bruit ambiant…                                    │
```

| Élément | Spécification |
|---|---|
| Puits | le remplissage est **gelé** (dernière valeur), remplacé par un surlignage `bg.hover` animé (balayage 900 ms) |
| Texte | `settings.vad.calibrating` avec `{{s}}` décompté 3 → 2 → 1, 13/500 `text.primary`, centré |
| Sous-titre | `settings.vad.noiseMeasuring` |
| Boutons | `[Calibrer]` devient `#Calibration…` `aria-disabled`, `[Fermer]` reste actif (annule proprement) |
| Échantillonnage | 3 s × médiane + écart-type ; seuil proposé = `max(noiseFloor + 10 dB, −55 dBFS)`, borné `[−70, −10]` — formules données à titre indicatif pour le moteur, l'UI ne fait qu'afficher |

**Rendu — proposition**

```
│        │  Seuil proposé : −46 dBFS                                    │
│        │  [ Utiliser ce seuil ]              [ Conserver −38 dBFS ]   │
```

| Élément | Spécification |
|---|---|
| Texte | `settings.vad.calibrated` avec `{{db}} = −46` |
| Bouton primaire | `settings.vad.calibrateApply` — applique et ferme le popover |
| Bouton secondaire | libellé **dynamique** issu de `settings.vad.thresholdValue` (« Conserver −38 dBFS ») : jamais un « Annuler » ambigu |
| Rien n'est appliqué sans clic | la calibration ne modifie **jamais** le seuil dans le dos de l'utilisateur |
| Échec (bruit > −30 dBFS pendant l'échantillonnage) | `settings.vad.calibrateFailed` en `state.mute`, les deux boutons restent, `[Calibrer]` redevient actif |

#### S2.11 — Salon complet (refus à l'entrée)

**Déclencheur** : la signalisation refuse la 9ᵉ connexion (`room_full`).

**Rendu (écran plein, pas une modale par-dessus un salon vide)**

```
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                            ┌──────────────────────┐                          │
│                            │      👥 8/8 (40 px)  │                          │
│                            └──────────────────────┘                          │
│                              Salon complet                                    │
│                « Table de la cuisine » réunit déjà 8 participants.            │
│                Vous n'avez pas été connecté.                                  │
│                                                                              │
│                          [ Revenir aux salons ]                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

| Élément | Spécification |
|---|---|
| Écran | remplace E2 **après** une tentative de connexion ; on est déjà sorti du salon (pas de barre de contrôle, pas de tuiles fantômes) |
| Titre | `room.full.title` (`title.card`) |
| Corps | `room.full.body`, `{{name}}` = nom du salon |
| Action | `room.full.action`, variante `primary`, seule action ; ramène à E1 avec la ligne du salon marquée « complet » (S1.6) |
| Pas de bouton « réessayer » | réessayer un salon plein est une boucle inutile ; la liste se met à jour toute seule |
| Décompte | aucune durée d'attente affichée (on ne sait pas quand une place se libère) |
| ARIA | `role="alert"` sur le bloc titre+corps, focus programmatique sur `[Revenir aux salons]` |
| Cas limite | si je suis déjà dans le salon et que la limite change, on ne m'éjecte pas : je reste, les nouveaux sont refusés |

#### S2.12 — Le salon s'est vidé / a été fermé

**Déclencheur** : l'hôte part (le salon n'existe plus) ou je suis le dernier (`participants.length === 1` **et** l'hôte est parti).

**Rendu**

```
├──────────────────────────────────────────────────────────────────────────────┤
│                            ◇ (40 px)                                          │
│                          Le salon est vide                                    │
│              Plus personne n'est connecté à « Salon de Marie ».               │
│                      [ Revenir aux salons ]                                   │
└──────────────────────────────────────────────────────────────────────────────┘
```

| Élément | Spécification |
|---|---|
| Délai | 2 s après le départ du dernier pair (laisse voir l'animation de sortie de S2.4), avec un compte à rebours discret en `text.muted` (`{{s}}` réutilisé) |
| Audio | `track` local arrêté, mixage libéré ; plus aucune connexion ICE maintenue en arrière-plan |
| Boutons | une seule action `room.empty.action` ; **pas** de « rester seul » (un salon sans hôte n'est pas joignable, y rester créerait un état mort) |
| Ma tuile | retirée à l'affichage de cet état |
| ARIA | `role="status"`, focus sur le bouton |
| Non-déclenchement | si je suis le dernier **et** que je suis l'hôte, le salon reste ouvert (je peux attendre quelqu'un) : S2.12 ne s'applique pas |

#### S2.13 — Micro débranché en cours de salon

**Déclencheur** : `track.onended` (débranchage USB/Jack) sans action utilisateur.

**Rendu**

```
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ ⛔ Le microphone a été débranché.                        [ Réglages ]   │  │
│  │    Rebranchez-le, ou choisissez un autre périphérique dans les réglages.│  │
│  └────────────────────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────────────────┤
│ ▏        ▕  —   [🔇 Muet]  [🎧 Sourdine] (Appuyer | Détection)              │
```

| Élément | Spécification |
|---|---|
| Bandeau | ton `error`, `role="alert"`, `room.error.deviceLost` + `room.error.deviceLostBody`, action `[control.settingsAudio]` |
| Barre de niveau | vide, tiret `—`, bordure `state.mute` sur le puits |
| Mode | le mode PTT/VAD est conservé et affiché (il redevient actif au rebranchement) |
| Émission | le bouton mute passe en `aria-disabled` (rien à couper) mais **la sourdine reste utilisable** |
| Réception | **non affectée** : j'entends toujours les autres |
| Reprise auto | rebranchement du même périphérique → le bandeau disparaît, `a11y` annonce le retour, le halo revient à l'appui |
| Cas 2 périphériques | si le périphérique choisi disparaît mais qu'un autre existe, le bandeau propose un remplacement en un clic (même bandeau, action différente : libellé `settings.audio.input`) |

#### S2.14 — Le moteur audio n'a pas démarré

**Déclencheur** : `AudioContext` en échec, ou `getUserMedia` rejeté pour une raison non liée à la permission.

**Rendu**

```
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ ⛔ Le moteur audio n'a pas pu démarrer.          [ Réessayer le son ]   │  │
│  │    L'action n'a pas pu aboutir. Réessayez.                              │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ (MD)  Marie 🎧̸   🔊 ─●─ │  (tuiles en lecture seule)                    │  │
```

| Élément | Spécification |
|---|---|
| Bandeau | `room.error.audioInit` + `error.body`, ton `error`, `role="alert"` |
| Action | `room.error.audioInitAction` (`Réessayer le son`), variante `secondary` |
| État du salon | **on reste dans le salon** : la signalisation et la liste des participants fonctionnent, seul le média est mort. Quitter serait une punition disproportionnée |
| Tuiles | affichées, halos de parole pilotés par la signalisation (les pairs annoncent leur état) — mais **sans audio** : le badge « sourdine » global est affiché pour ne pas laisser croire que le silence vient des autres |
| Curseurs de volume | `aria-disabled`, visuellement à 60 % — ils n'ont aucun effet sans moteur |
| Après 2 échecs | le bandeau ajoute un lien `[control.settingsAudio]` (piste : mauvais périphérique système) |
| Interdit | pas de sortie forcée du salon, pas de modale |

#### S2.15 — Qualité dégradée

**Déclencheur** : RTT médian > 150 ms, ou perte > 5 %, ou jitter > 30 ms sur au moins un pair.

| Élément | Spécification |
|---|---|
| Pastille | `room.header.quality` avec `quality.fair` (`state.warn`) ou `quality.poor` (`state.mute`) |
| Latence | `room.header.latency` affichée en permanence dès que la qualité n'est pas `excellent` |
| Croisement d'information | `room.header.peers` (`{{count}} pairs connectés`) apparaît à côté, pour distinguer « réseau lent » de « pairs perdus (S2.3) » |
| Seuil de passage | `excellent` < 80 ms et perte < 1 % ; `fair` < 150 ms et perte < 5 % ; `poor` au-delà |
| Anti-scintillement | hystérésis 5 s + moyenne glissante 10 s : la pastille ne clignote pas entre deux valeurs |
| Action | aucune. Pas de « optimiser », pas de conseil réseau, pas de bannière : la mesure suffit |
| ARIA | la pastille porte un `aria-label` complet (`room.header.quality` + `room.header.latency`) ; pas d'annonce live (ce serait du bruit) |

---

## 5. E3 — Réglages

Dialogue **modal** dans la fenêtre principale, `760 × 560` (min `640 × 480`), ouvert par `⚙`, `Ctrl+,`
ou `[Réglages audio]` depuis un bandeau de E2. Il se ferme par `Échap`, `Ctrl+,`, `[×]` ou un clic sur le scrim.
Le focus revient **toujours** à l'élément qui l'a ouvert.

### 5.0 Anatomie et arborescence des composants

```
SettingsDialog        { open, tab, onTabChange, onClose, draft, onPatch, errors, saveError }
├─ DialogScrim        { onClick: onClose }
├─ DialogHeader       { titleKey: 'settings.title', onClose }
├─ SettingsNav        { tabs, active, onSelect }          // role="tablist", flèches ← →
│  └─ NavItem         { key, labelKey }
├─ SettingsPanel      { tab }                              // role="tabpanel"
│  ├─ AudioPanel      { devices, selection, mode, vad, ptt, processing, permission }
│  │  ├─ Section              { titleKey }
│  │  ├─ DeviceSelect         { labelKey, devices, value, onChange, noneKey, noneHelpKey, onRescan }
│  │  ├─ LevelMeter           { levelDbfs, thresholdDbfs, noiseFloorDbfs, state }
│  │  ├─ ModeRadioGroup       { value, onChange }           // 'ptt' | 'vad'
│  │  ├─ VadBlock             { threshold, noiseFloor, level, calibrating, onThreshold, onCalibrate }
│  │  │  ├─ ThresholdSlider   { value, min: -70, max: -10, step: 1, onChange }
│  │  │  ├─ NoiseFloorReadout { value, measuring }
│  │  │  ├─ CalibrateButton   { state: 'idle' | 'running' | 'done' | 'failed', onStart }
│  │  │  └─ HelpText          { textKey, tone: 'neutral' | 'warn' }
│  │  ├─ PttBlock             { chord, registered, recording, conflict, onRecord, onCancel, onReset }
│  │  │  ├─ ShortcutChip      { chord }
│  │  │  ├─ ShortcutRecorder  { recording, onKeyCapture, onEsc }
│  │  │  └─ InlineMessage     { tone: 'error' | 'success', textKey }
│  │  ├─ ProcessingRow        { rnnoise: { on, available }, aec: 'active' | 'inactive' | 'unavailable' }
│  │  └─ OutputTestButton     { state: 'idle' | 'testing', onTest }
│  ├─ OverlayPanel    { enabled, opacity, scale, screen, screens, position, missingScreen, onPatch, onRecentre }
│  ├─ NetworkPanel    { displayName, port, portBumped, discoveryMethod, external: 'none', instanceId }
│  └─ AboutPanel      { version, license }
├─ DialogFooter       { onClose }                          // [Fermer] à droite
└─ SaveError          { textKey: 'settings.error.save' }
```

**Navigation** : `SettingsNav` = 4 onglets, panneau de gauche de **168 px**, fond `bg.inset`,
`radius.lg` ; onglet actif : fond `accent.subtle`, texte `accent.default` en `label` + barre gauche 2 px
`accent.default`. Flèches `↑ ↓` entre onglets, `Tab` sort du `tablist` vers le panneau (un seul onglet
dans l'ordre de tabulation : `tabindex="0"` sur l'actif, `-1` sur les autres).

**Chaque modification est appliquée et persistée immédiatement** (`onPatch` débouncé 250 ms) : pas de bouton
« Enregistrer », pas de bouton « Annuler » (sauf sur le champ pseudo, qui garde `Blur`/`Entrée`).

### 5.1 États

#### S3.1 — Nominal (onglet Audio)

```
┌─ Réglages ──────────────────────────────────────────────────────── [×] ──────┐
│ ┌──────────┐  ┌───────────────────────────────────────────────────────────┐ │
│ │ Audio  ▸ │  │ AUDIO                                                     │ │
│ │ Overlay  │  │ Périphérique d'entrée                                     │ │
│ │ Réseau   │  │ [ Micro (Realtek) ▾ ]                                     │ │
│ │ À propos │  │ Niveau d'entrée                                           │ │
│ │          │  │ ┌─ ▒▒▒▒▒▒│████░░░░░░░░░░░░░░░░░░░░░░░░░░ ─36 ────────────┐ │ │
│ │          │  │ └──────────────────────────────────────────────────────────┘ │ │
│ │          │  │ Mode de prise de parole                                   │ │
│ │          │  │ ( ● Appuyer pour parler )  ( ○ Détection de voix )        │ │
│ │          │  │ Appuyer pour parler n'émet que pendant l'appui. La …      │ │
│ │          │  │ Appuyer pour parler       Raccourci actuel  [Alt+Espace] Actif│
│ │          │  │                           [ Changer ]                     │ │
│ │          │  │ Fonctionne même quand la fenêtre n'a pas le focus.        │ │
│ │          │  │ Périphérique de sortie  [ Casque (USB) ▾ ]   [Tester la sortie (1 s)]│
│ │          │  │ Réduction de bruit (RNNoise) [ on ]   Annulation d'écho : Active│
│ └──────────┘  └───────────────────────────────────────────────────────────┘ │
│                                                                    [ Fermer ]│
└──────────────────────────────────────────────────────────────────────────────┘
```

| Élément | Spécification |
|---|---|
| `Section` | intitulé `eyebrow` (11/600 `wide` `text.muted`, majuscules par `text-transform`), filet 1 px `border.subtle` de `space.2` de large à droite, marge basse `space.2`, marge haute `space.6` entre sections |
| Libellés de champ | `label` (12/500 `text.secondary`), marge basse `space.1` |
| `DeviceSelect` | `<select>` natif stylé : `bg.inset`, `border.strong`, `radius.sm`, hauteur 32, padding `space.1 space.3`, texte `body.strong` ; chevron 12 px à droite |
| `LevelMeter` | identique à S2.9 mais **32 px** de haut, non modifiable (le seuil ne se règle que dans `VadBlock`) — en mode PTT, pas de marqueur |
| `ModeRadioGroup` | deux boutons radio de 32 px, `radius.md`, groupés `role="radiogroup"` ; sélectionné = fond `accent.subtle`, bordure `accent.default` 1 px, point 6 px `accent.default` ; non sélectionné = `bg.surface` + `border.strong` |
| `PttBlock` | visible **uniquement** en mode `ptt` (§7.1) ; apparaît avec `motion.duration.panel` |
| `ShortcutChip` | `typography.family.mono`, 12 px, fond `bg.inset`, `border.subtle`, `radius.sm`, padding `space.1 space.2` |
| État du raccourci | `settings.ptt.active` en `state.ok` / `settings.ptt.inactive` en `state.warn`, 12 px, suivi d'une pastille 6 px |
| `ProcessingRow` | deux lignes : RNNoise (interrupteur, libellé `settings.audio.rnnoise`) et AEC (texte d'état, **pas** un interrupteur) |
| AEC | affiche `aecActive` / `aecInactive` / `aecUnavailable` en lecture seule : c'est l'état **réel** du pilote, on ne ment pas avec un toggle (justifié par `settings.audio.aecHelp`) |
| Persistance | chaque changement → `onPatch`, pastille discrète `a11y.settingsSaved` dans la région live (pas de toast visuel : ça clignote trop) |

#### S3.2 — Aucun périphérique d'entrée

```
│  Périphérique d'entrée                                                    │
│  ┌────────────────────────────────┐  ┌──────────────────────────────────┐ │
│  │ Aucun microphone détecté       │  │  ⛔ Aucun microphone détecté.     │ │
│  └────────────────────────────────┘  │     Branchez un microphone, puis │ │
│  (liste déroulante désactivée)       │     rouvrez ce panneau.          │ │
│                                      │     [ Réanalyser ]               │ │
```

| Élément | Spécification |
|---|---|
| `DeviceSelect` | `aria-disabled="true"`, affiche `settings.audio.inputNone` en `text.muted`, `bg.inset` (contraste 5.99:1 sombre / 5.35:1 clair) ; **aucune** option fictive |
| Bloc d'aide | `settings.audio.inputNoneHelp` + action `[common.refresh]` → relance `enumerateDevices` ; icône `warning` |
| `LevelMeter` | remplacé par un puits vide + `—` ; `aria-disabled` |
| Mode / PTT | **toujours réglables** (le raccourci et le mode se configurent sans micro) |
| VAD | `ThresholdSlider` et `Calibrer` `aria-disabled` (rien à mesurer) ; valeurs conservées et affichées |
| Blocage | **aucun** : on peut tout régler et fermer, la session audio est simplement muette |

#### S3.3 — Aucun périphérique de sortie

| Élément | Spécification |
|---|---|
| `DeviceSelect` sortie | `settings.audio.outputNone`, `aria-disabled`, `bg.inset` |
| Aide | `settings.audio.outputNoneHelp` |
| `OutputTestButton` | `aria-disabled="true"` (aucun son possible) ; ne disparaît pas (évite le saut de mise en page) |
| Réception | E2 continue de fonctionner : aucune piste de sortie, les halos restent (S2.6/S2.14) |

#### S3.4 — Accès au microphone refusé

```
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ ⛔ Accès au microphone refusé                                          │ │
│  │    Autorisez le microphone dans les réglages du système, puis rouvrez   │ │
│  │    ce panneau.                                                          │ │
│  │    [ Redemander l'accès ]                                              │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│  Périphérique d'entrée   [ Par défaut du système ▾ ]  (désactivé)           │
```

| Élément | Spécification |
|---|---|
| Bandeau | `role="alert"`, ton `error`, **en haut** du panneau Audio, avant le premier champ |
| Textes | `settings.audio.permissionTitle` / `.permissionBody` |
| Action | `settings.audio.permissionRetry` : relance `getUserMedia` ; si le système refuse définitivement, le bouton reste et le bandeau se met à jour après 1 s |
| Champ d'entrée | `aria-disabled`, libellé `settings.audio.systemDefault` |
| Reste de l'écran | utilisable : sortie, mode, PTT, overlay, réseau |
| Différence avec S2.13 | ici la permission manque ; là, le périphérique a disparu en cours d'usage |
| Interdit | pas de bouton « Ouvrir les réglages système » (dépend de l'OS, impossible à garantir multiplateforme) |

#### S3.5 — Test de sortie en cours

| Élément | Spécification |
|---|---|
| Bouton | `settings.audio.testing`, icône `speaker` + 3 arcs animés en boucle 900 ms, `aria-disabled="true"` (focusable) |
| Durée | 1 s de tonalité 440 Hz à −18 dBFS, **jamais** plus fort que le volume courant ; rampe de sortie 20 ms (anti-clic) |
| Pendant | les autres champs restent actifs ; un second clic est ignoré |
| Fin | retour au libellé `settings.audio.test`, annonce `settings.audio.testDone` (région live) |
| Si la sortie change pendant le test | le test s'arrête, le bouton revient à l'état initial (pas d'erreur) |

#### S3.6 — Capture d'un nouveau raccourci (enregistrement en cours)

```
│  Appuyer pour parler        Raccourci actuel   [ Alt+Espace ]  ● Actif   │
│                             [ Enregistrement… ]                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  Appuyez sur une combinaison… (Échap pour annuler)                     │  │
│  │  ████████████████████████████░░░░░░░░░░  (anneau de focus animé)       │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
```

| Élément | Spécification |
|---|---|
| Déclencheur | `[Changer]` ou `Entrée` sur le `ShortcutChip` |
| Zone de capture | encadré 44 px de haut, `bg.inset`, bordure **2 px** `accent.default` (état actif), `radius.md` |
| Texte | `settings.ptt.recording`, 13/500 `text.primary`, centré |
| Capture | `keydown` global sur la fenêtre, `preventDefault` ; on **n'enregistre** que sur `keyup` de la dernière touche non modificatrice ; `Échap` annule ; un clic hors de la zone annule aussi |
| Modificateurs seuls | tant que seuls `Ctrl/Alt/Maj/Meta` sont enfoncés, on affiche les modificateurs en puces `mono` (`Ctrl` `Alt`) — l'utilisateur voit sa frappe en direct |
| Retour visuel | à chaque touche, la puce correspondante s'allume (fond `accent.subtle`, 80 ms) |
| Reste de l'interface | inchangé, mais **les raccourcis globaux PTT sont suspendus** pendant la capture (sinon on déclencherait un appui en enregistrant) |
| Annulation | l'ancien raccourci reste affiché et actif pendant toute la capture |
| Accessibilité | `role="dialog"` inline évité : la zone est un `button` avec `aria-live="assertive"` annonçant le texte d'invite ; la séquence finale est annoncée (`settings.ptt.recorded`) |

#### S3.7 — Raccourci déjà pris par le système (conflit)

```
│  Raccourci actuel   [ Alt+Espace ]   ● Actif                          │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ ⛔ Ctrl+Shift+M est déjà pris par le système. L'ancien raccourci      │  │
│  │    (Alt+Espace) reste actif.                                    │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
```

| Élément | Spécification |
|---|---|
| Détection | `globalShortcut.register()` retourne `false` (enregistrement refusé par l'OS) — on ne se contente pas de tester une liste de raccourcis connus |
| Message | `settings.ptt.conflict` avec `{{shortcut}}` = la combinaison refusée, `{{previous}}` = l'ancienne |
| Ton | `error`, bordure gauche 3 px `state.mute`, fond `state.muteSubtle`, `role="alert"` |
| État du raccourci | **l'ancien reste affiché, actif, et `settings.ptt.active` reste visible** — on n'échoue jamais en laissant l'application sans PTT |
| Bouton | `[common.retry]` implicite : le `[Changer]` redevient immédiatement disponible pour réessayer ; le message reste jusqu'au prochain enregistrement réussi |
| Cas « reprise par une autre application plus tard » | au démarrage, si `register()` échoue, E3 s'ouvre sur l'onglet Audio avec ce message et `settings.ptt.inactive` en `state.warn` ; E2 affiche `settings.ptt.inactive` dans la barre au lieu de `control.ptt.hold` |
| Ne pas faire | ❌ accepter silencieusement un raccourci non enregistré, ❌ désactiver le mode PTT sans le dire, ❌ passer en VAD d'office |

#### S3.8 — Combinaison refusée par la règle locale (sans modificateur)

| Élément | Spécification |
|---|---|
| Déclencheur | l'utilisateur n'appuie que sur des touches non modificatrices (`K`, `F5`, `Espace` seul) |
| Message | `settings.ptt.needModifier`, ton `error`, sous la zone de capture |
| Pourquoi | un raccourci global sans modificateur capture la frappe dans **toutes** les applications : inutilisable et dangereux |
| Comportement | la capture **reste ouverte** (on ne la ferme pas sur une erreur), l'utilisateur réessaie immédiatement |
| Exception | `Espace` seul est refusé aussi (réservé aux jeux/lecteurs) ; la règle est unique et documentée par le message |

#### S3.9 — Seuil de détection de voix en cours de réglage (dans E3)

Même composant que `MeterPopover` de S2.9, mais **en place** (pas de popover) dans le panneau Audio, en mode `vad` :

| Élément | Spécification |
|---|---|
| Puits | 48 px, `bg.inset`, graduations `mono` 11 px `text.muted` |
| Barre de niveau | live 30 Hz, `accent.default` sous le seuil / `state.speaking` au-dessus |
| Zone de bruit | hachures 45° de `−70` à `noiseFloor + 6` (§7.2 : c'est **la** partie qui évite l'erreur de réglage) |
| Marqueur | 2 px `state.warn` + poignée 8×6 ; `role="slider"` ; flèches ±1 dB, `Page↑/↓` ±6 dB, `Home/End` aux bornes |
| Valeur | `settings.vad.thresholdValue`, `body.strong`, alignée à droite |
| Texte live | `settings.vad.liveLevel` (10 Hz) et `settings.vad.noiseFloor` (3 s de moyenne) |
| Effet | appliqué en direct au moteur, anti-rebond 100 ms, persisté à la fermeture |
| Avertissement | bascule vers `settings.vad.helpTooLow` en `state.warn` dès `threshold < noiseFloor + 6` |
| En mode PTT | tout le bloc VAD est **masqué** (il n'aurait aucun effet) ; on affiche à la place `control.ptt.hold` |

#### S3.10 — Calibration du seuil (E3) : en cours, réussie, échouée

| Phase | Rendu |
|---|---|
| En cours (3 s) | puits gelé + balayage `bg.hover` 900 ms, texte `settings.vad.calibrating` (`{{s}}` = 3→1), sous-titre `settings.vad.noiseMeasuring`, `[Calibrer]` en `aria-disabled`, `[Fermer]` actif (annule) |
| Proposé | `settings.vad.calibrated` (`−46 dBFS`) + `[Utiliser ce seuil]` (primaire) + `[Conserver −38 dBFS]` (secondaire, libellé dynamique) |
| Échoué | `settings.vad.calibrateFailed` en `state.mute`, les boutons précédents disparaissent, `[Calibrer]` redevient actif, le seuil **n'a pas changé** |
| Règle | la calibration ne modifie jamais le seuil sans confirmation explicite |

#### S3.11 — Traitements indisponibles (RNNoise / AEC)

| Élément | Spécification |
|---|---|
| RNNoise indisponible (WASM en échec) | l'interrupteur passe `aria-disabled="true"`, reste visible et **désactivé visuellement sans perdre son contraste** (`text.muted` sur `bg.surface` = 5.79:1), ligne d'aide `settings.audio.rnnoiseUnavailable` en `text.muted` |
| AEC non proposée | texte `settings.audio.aecUnavailable` en `text.muted` à la place de l'état, jamais un toggle |
| Ne pas faire | ❌ masquer la ligne (on croit que la fonction n'existe pas), ❌ afficher « activée » par optimisme |

#### S3.12 — Onglet Overlay : overlay désactivé

```
│  Afficher l'overlay                                   [ off ]              │
│  Activez l'overlay pour régler son opacité et sa taille.                    │
│  Opacité        ──────●──────  90 %        (grisé)                          │
│  Taille des avatars   ( Petit ) (● Normal ) ( Grand )     (grisé)          │
│  Écran          [ Écran 1 ▾ ]     Position : ∩ bas-droite  [ Recentrer ]    │
│  ┌── Aperçu ─────────────────────────────────────────────┐                  │
│  │  ┌──────────────────────────┐                          │                  │
│  │  │ ⠿  (MD) (TK) (LN)        │   ← aperçu à l'échelle 1  │                  │
│  │  └──────────────────────────┘                          │                  │
│  └────────────────────────────────────────────────────────┘                  │
```

| Élément | Spécification |
|---|---|
| Interrupteur | `role="switch"`, `aria-checked`, 36×20, piste `bg.inset` / `accent.default` quand actif, curseur 16 px |
| Contrôles dépendants | `OpacitySlider`, `ScaleSegmented`, `ScreenSelect`, `[Recentrer]` en `aria-disabled` ; **conservés à l'écran** (on voit ce qu'on retrouvera) |
| Aide | `settings.overlay.disabledHint`, 12 px `text.muted`, marge haute `space.1` |
| Aperçu | **toujours actif** (il montre l'état actuel, même masqué), 32 px de haut, échelle 1 |
| Aide permanente | `settings.overlay.help` en bas de section (rappel : ne vole pas le focus, laisse passer les clics) |
| Opacité | `OpacitySlider` : plage **60 % → 100 %** (`overlay.opacity.min/max`), pas 5 %, valeur `settings.overlay.opacityValue` ; **pas de cran sous 60 %** (§6.5 : sous 60 % le texte ne tient plus 4.5:1 sur un fond d'écran clair) |

#### S3.13 — Écran cible de l'overlay absent

| Élément | Spécification |
|---|---|
| Déclencheur | l'écran mémorisé n'est plus connecté (débranchement HDMI, changement de configuration) |
| Rendu | `ScreenSelect` revient à `settings.overlay.screen.n` de l'écran principal ; message `settings.overlay.screenMissing` en `state.warn` sous le champ, 12 px |
| Overlay | repositionné dans le coin bas-droit de l'écran principal (`space.4` de marge), **jamais hors écran** |
| Position mémorisée | conservée en pourcentage de l'écran, pas en pixels absolus (sinon la fenêtre sort de l'écran au changement de résolution) |
| Retour de l'écran | **pas** de retour automatique : l'utilisateur repositionne une fois, on ne « saute » pas d'écran en pleine partie |

#### S3.14 — Les réglages n'ont pas pu être enregistrés

| Élément | Spécification |
|---|---|
| Déclencheur | écriture du fichier de préférences impossible (lecture seule, disque plein, droits) |
| Rendu | bandeau en bas du dialogue, au-dessus du pied : `settings.error.save`, ton `error`, `role="alert"`, action `[common.retry]` |
| État courant | les réglages **s'appliquent quand même pour la session** (en mémoire) — l'utilisateur n'est pas bloqué |
| Persistance de l'alerte | réapparaît à chaque tentative d'écriture échouée, mais une seule fois par ouverture de dialogue (pas de martèlement) |
| Ne pas faire | ❌ modale bloquante, ❌ perte silencieuse des réglages |

#### S3.15 — Port de signalisation déjà occupé (onglet Réseau)

| Élément | Spécification |
|---|---|
| Rendu | `settings.network.port` affiche le port **effectif** en `mono`, suivi de `settings.network.portBumped` (`{{default}} = 47821`, `{{port}} = 47822`) en `state.warn`, 12 px |
| Lecture seule | le port n'est pas modifiable depuis l'UI (il est négocié au démarrage) ; pas de champ, pas de « changer de port » |
| Onglet Réseau — autres lignes | `settings.network.name` (champ pseudo, même source que E1), `settings.network.discovery` (méthode active), `settings.network.external` = `settings.network.externalNone` + `settings.network.externalHelp`, `settings.network.identity` = identifiant court en `mono` + `settings.network.identityHelp` |
| Interdits | aucune ligne « compte », aucune « connexion à un serveur », aucune case « synchronisation » |

---

## 6. E4 — Overlay

Fenêtre séparée : `frameless`, transparente, `alwaysOnTop` (niveau `screen-saver`), `skipTaskbar`,
non redimensionnable, `focusable: false`, `acceptFirstMouse: false` (macOS). **Visible uniquement dans E2**
(`room.lifecycle === 'joined'`) et si `settings.overlay.enabled`.

### 6.1 Anatomie et arborescence

```
OverlayRoot          { participants, selfId, selfDeafened, opacity, scale, visible, position, onDragEnd }
├─ OverlayPlate      { opacity }                            // plaque de fond, seule à porter l'opacité
└─ OverlayStrip      { participants, selfDeafened, scale }
   ├─ DragHandle     { onPointerDown, dragging }            // 12 px, non focalisable
   └─ OverlayAvatar  { participant, speaking, muted, deafened, size: 28 }
      ├─ AvatarDisc  { instanceId, initial }
      ├─ SpeakingRing{ speaking }
      └─ MuteBadge   { muted } / DeafSlash { deafened }
```

Props : `participant = { instanceId, displayName, initial, speaking, muted, deafened }`.
`speaking` provient de la même source que E2 (VAD du pair ou état PTT annoncé) : **un seul état, deux rendus**.

### 6.2 Géométrie

| Élément | Valeur | Jeton |
|---|---|---|
| Hauteur de la bande | **44 px fixe** (jamais de retour à la ligne, jamais de 2ᵉ ligne) | `overlay.rowHeight` |
| Marge verticale interne | 8 px de chaque côté (28 + 2×8 = 44) | `overlay.paddingY` |
| Avatar | cercle **28 × 28** | `overlay.avatarSize` |
| Initiale | 12 px / 600, centrée, `text.primary` | `overlay.avatarFontSize` |
| Écart entre avatars | 8 px | `overlay.avatarGap` |
| Largeur de la poignée | 12 px | `overlay.handleWidth` |
| Padding horizontal | 8 px (poignée collée au bord gauche) | `overlay.paddingX` |
| Rayon de la plaque | 10 px | `overlay.radius` |
| **Largeur** | **auto** : `12 + 8 + n×28 + (n−1)×8 + 8` → 1 participant = 60 px, 8 participants = 308 px | `overlay.minWidth` / `maxWidth` |
| Ombre | `shadow.overlay` | §2.6 |
| Position par défaut | coin bas-droit, marge 16 px de l'écran | `space.4` |

Vérification : 8 × 28 = 224 ; 7 × 8 = 56 ; + 12 + 8 + 8 = **308 px** ≤ `overlay.maxWidth` (336). Aucun défilement
horizontal possible : le plafond de participants (8) garantit que la bande tient.

### 6.3 Couleur dérivée de l'`instanceId`

- `teinte = avatarTint[(hash32(instanceId) >>> 0) % 8]`, `hash32` = FNV-1a 32 bits — déterministe, stable pendant toute la session, identique dans E2 et E4 (même paire, même pastille).
- **L'initiale** = première lettre du pseudo, mise en capitale, `text.primary`. Pour un pseudo vide : `?`.
- La couleur **n'est jamais la seule information** : l'initiale identifie, la couleur aide seulement à retrouver quelqu'un d'un coup d'œil. Deux participants peuvent partager une teinte (8 teintes, jusqu'à 8 personnes) : c'est acceptable parce que l'initiale porte l'identité.
- Pas de génération de teinte arbitraire (HSL aléatoire) : 8 valeurs **fixes et vérifiées** en contraste (§2.2), sinon on obtient des pastilles illisibles.

### 6.4 Le halo de parole

| Élément | Spécification |
|---|---|
| Forme | anneau de **2 px** autour de l'avatar, décalé de **2 px** (`outline: 2px solid; outline-offset: 2px`) → diamètre extérieur 36 px, tient dans les 44 px de haut |
| Couleur | `state.speaking` (`#3DDC84` / `#0D6B43`) |
| **Liseré de séparation** | un anneau **1 px** `bg.overlay` opaque entre l'avatar et l'anneau vert (ou `box-shadow: 0 0 0 1px var(--bg-overlay)` sous l'outline). Raison mesurée : à 60 % d'opacité, le vert sur une plaque composée au-dessus d'un bureau blanc tombe à **2.86:1** ; le liseré ramène le voisinage immédiat à **10.83:1** et rend le halo identifiable quelle que soit l'image de fond |
| Transition | `opacity` (et seulement `opacity`) `0 → 1`, `motion.duration.halo` = **80 ms**, `easing.standard` — **aucun flash, aucun clignotement, aucune mise à l'échelle** |
| Fin de parole | `1 → 0` en 80 ms |
| Plusieurs parleurs | halos simultanés autorisés (pas de « dernier qui parle seulement » : on veut voir un chevauchement) |
| Moi | j'ai aussi un halo quand j'émets (PTT ou VAD) : c'est le seul retour que j'aie si E2 est en arrière-plan |
| Mouvement réduit | durée 0 (changement instantané de couleur — rien ne bouge, donc rien à réduire) |

### 6.5 Opacité — pourquoi la plaque seule est atténuée

**Décision** : `overlay.opacity` s'applique à la **plaque de fond uniquement** (`OverlayPlate.background`, couleur
`bg.overlay` avec alpha). Les enfants — initiales, halo, croix — restent à **100 %**. On n'utilise **pas**
`BrowserWindow.setOpacity()`, qui délave le texte avec la plaque et fait passer le contraste sous 4.5:1.
La plaque porte en plus une bordure interne 1 px `border.subtle` (à pleine opacité) pour rester délimitée sur un fond clair.

| Opacité `overlay.opacity` | Thème | Bureau le plus défavorable | Fond composé | Texte | Ratio texte | Halo **sans** liseré | Croix **sans** disque | Verdict texte |
|---|---|---|---|---|---|---|---|---|
| 0.60 | sombre | blanc | rgb(109,110,113) | #F1F4F8 | **4.62:1** | 2.86:1 | 1.84:1 | ✅ AA |
| 0.60 | clair | noir | rgb(153,153,153) | #12171D | **6.32:1** | 2.30:1 | 2.00:1 | ✅ AA |
| 0.70 | sombre | blanc | rgb(84,86,90) | #F1F4F8 | **6.67:1** | 4.12:1 | 2.65:1 | ✅ AA |
| 0.70 | clair | noir | rgb(179,179,179) | #12171D | **8.59:1** | 3.13:1 | 2.72:1 | ✅ AA |
| 0.80 | sombre | blanc | rgb(60,62,66) | #F1F4F8 | **9.71:1** | 6.00:1 | 3.86:1 | ✅ AA |
| 0.80 | clair | noir | rgb(204,204,204) | #12171D | **11.21:1** | 4.08:1 | 3.55:1 | ✅ AA |
| 0.90 | sombre | blanc | rgb(35,38,43) | #F1F4F8 | **13.76:1** | 8.51:1 | 5.47:1 | ✅ AA |
| 0.90 | clair | noir | rgb(230,230,230) | #12171D | **14.43:1** | 5.26:1 | 4.57:1 | ✅ AA |
| 1.00 | sombre | blanc | rgb(11,14,19) | #F1F4F8 | **17.52:1** | 10.83:1 | 6.97:1 | ✅ AA |
| 1.00 | clair | noir | rgb(255,255,255) | #12171D | **18.01:1** | 6.56:1 | 5.70:1 | ✅ AA |

Contre-exemple mesuré — **opacité de fenêtre** (`win.setOpacity`), overlay sombre sur bureau blanc : le texte se délave avec la plaque.

| `win.setOpacity` | Texte composé | Fond composé | Ratio | Verdict |
|---|---|---|---|---|
| 0.60 | rgb(247,248,251) | rgb(109,110,113) | **4.80:1** | ✅ |
| 0.70 | rgb(245,247,250) | rgb(84,86,90) | **6.85:1** | ✅ |
| 0.80 | rgb(244,246,249) | rgb(60,62,66) | **9.90:1** | ✅ |
| 0.90 | rgb(242,245,249) | rgb(35,38,43) | **13.88:1** | ✅ |
| 1.00 | rgb(241,244,248) | rgb(11,14,19) | **17.52:1** | ✅ |

> Les colonnes « Halo sans liseré » et « Croix sans disque » sont mesurées **sans** leur renfort, pour montrer pourquoi il est indispensable. Avec le liseré 1 px `bg.overlay` (halo, §6.4) et le disque 12 px `bg.surface` opaque (croix, S4.4), le contraste réel est de **10.83:1** et **6.97:1** — constant, quelle que soit l’opacité de la plaque.

**Conséquence de conception** : le curseur d'opacité est borné à **60 %** (`overlay.opacity.min`). En dessous,
sur un fond d'écran clair, le texte ne peut plus tenir 4.5:1 — proposer 20 % serait proposer un overlay illisible.
À 60 % (le minimum) et à 100 % (le maximum), le texte et la croix de muet restent au-dessus du seuil AA,
et le halo reste repérable grâce au liseré de séparation (§6.4).

### 6.6 L'overlay ne vole jamais le focus — conséquences UI

| Règle | Conséquence concrète |
|---|---|
| `focusable: false` sur la fenêtre, aucun élément focalisable dans le DOM (`tabindex` absent, aucun `<button>`, aucun `<input>`) | **aucun champ de saisie**, aucun formulaire, aucune case à cocher : il n'y a rien à quoi le focus pourrait s'accrocher |
| Aucune infobulle émise par l'overlay | pas de `title`, pas de tooltip DOM : une infobulle qui suivrait la souris obligerait à capturer les événements, et la fenêtre resterait visible dans la barre des tâches/au clavier. Le pseudo est disponible dans E2 (tuile) et par lecteur d'écran via E2 |
| Aucun menu contextuel | pas de clic droit, pas de `contextmenu` : `preventDefault` et rien d'autre (on n'ouvre pas de menu, on l'ignore) |
| Clics traversants | `setIgnoreMouseEvents(true, { forward: true })` sur toute la surface, **sauf** la zone de poignée (12 × 44) qui appelle `setIgnoreMouseEvents(false)` au `pointerenter` et repasse à `true` au `pointerleave` — un clic destiné à l'application en dessous n'est **jamais** intercepté ailleurs que sur la poignée |
| Pas de sélection de texte | `user-select: none`, `cursor: default` hors poignée (`grab` / `grabbing` sur la poignée) |
| Pas de raccourci clavier propre | l'overlay n'écoute **aucune** touche ; tout passe par la fenêtre principale (PTT global inclus) |
| Affichage / masquage | uniquement piloté par E3 (`settings.overlay.enabled`) et par l'état du salon ; jamais par une interaction dans l'overlay |
| Accessibilité | l'overlay **n'est pas** dans l'ordre de tabulation et n'est pas annoncé comme une fenêtre à part entière ; les informations qu'il porte (qui parle, qui est muet) sont déjà annoncées par la région live de E2 (`a11y.speaking`, `a11y.muted`). L'overlay est une **redondance visuelle**, pas une source d'information unique |

### 6.7 États

#### S4.1 — Aucun salon (overlay absent)

**Déclencheur** : `room.lifecycle !== 'joined'` ou `settings.overlay.enabled === false`.

| Élément | Spécification |
|---|---|
| Rendu | **la fenêtre n'est pas affichée** (`hide()`), pas de bande vide, pas de « personne » |
| Pourquoi | une bande vide en surimpression est un élément parasite qui appartient à l'utilisateur, pas à l'app |
| Reprise | retour dans un salon → `showInactive()` (jamais `show()` : ça volerait le focus) |
| Position | conservée entre deux sessions |

#### S4.2 — Nominal, 4 participants, personne ne parle

```
      ┌──────────────────────────────────────┐
      │ ⠿  (VO) (MD) (TK) (LN)               │   308 px max, ici 200 px
      └──────────────────────────────────────┘
```

| Élément | Spécification |
|---|---|
| Poignée | 12 px de large, 3 points de 2 px empilés (`overlay.handleDots`), espacés de 3 px, couleur `text.muted`, centrés verticalement ; curseur `grab` |
| Avatars | 28 px, ordre = ordre stable de E2 (moi d'abord, puis ordre d'arrivée) |
| Aucun nom | **pas de texte de pseudo** dans l'overlay : 28 px ne permet pas de lire un nom, et un nom tronqué est pire que pas de nom. Le pseudo est dans E2, et annoncé par lecteur d'écran via E2 |
| Largeur | 200 px = 12 + 8 + 4×28 + 3×8 + 8 → la bande se resserre quand des gens partent, sans saut (transition de largeur `motion.duration.panel`) |
| Fond | plaque `bg.overlay` à `overlay.opacity` (0.9 par défaut) + bordure 1 px `border.subtle` |

#### S4.3 — Quelqu'un parle (halo)

| Élément | Spécification |
|---|---|
| Halo | 2 px `state.speaking`, offset 2 px, liseré 1 px `bg.overlay`, fondus 80 ms (S6.4) |
| Deux parleurs | deux halos simultanés, indépendants (pas de file d'attente) |
| Bruit bref | le halo suit le VAD du pair avec la même hystérésis (ouverture 120 ms, fermeture 400 ms) : pas de clignotement sur une toux ou un clic de clavier |
| Moi | halo si j'émets — y compris en PTT, ce qui est le seul retour visuel quand je joue en plein écran |

#### S4.4 — Moi muet

| Élément | Spécification |
|---|---|
| Croix | badge **12 px** en bas-droite de **mon** avatar, à cheval sur le bord (décalage +2/−2) : disque opaque `bg.surface` (100 % d'opacité, sinon la croix perdrait son contraste), glyphe `×` 8 px trait 2 px `state.mute` |
| Contraste | croix vs son disque : **6.97:1** (sombre) / **5.70:1** (clair) — indépendant de l'opacité de la plaque, parce que le disque est opaque |
| Halo | **aucun**, même en PTT : je n'émets pas (S2.8) |
| Annonce | rien (déjà annoncé par E2) |

#### S4.5 — Je suis en sourdine

**Décision** : la sourdine est un état **global de ma part** ; elle s'affiche donc sur **tous** les autres avatars, sous forme de **barre diagonale** (« barré »), et non sur le mien.

| Élément | Spécification |
|---|---|
| Barre | segment de **2 px** `state.mute`, en diagonale à 45°, de 32 px de long, centré sur chaque avatar distant ; passe **derrière** l'initiale (masque de 3 px autour du glyphe) pour que le prénom reste lisible |
| Mon avatar | **pas** barré (je ne suis pas coupé, je suis celui qui n'entend pas) ; petit glyphe `headphones-off` 12 px collé à la poignée, en `state.mute` |
| Halos | **conservés** : je vois qui parle. Retirer le halo rendrait l'overlay muet deux fois |
| Contraste | `state.mute` sur plaque composée : **6.97:1** à 100 %, **5.47:1** à 90 %, mais **1.84:1** à 60 %. La barre est donc tracée avec un liseré `bg.overlay` **1 px de chaque côté** (même principe que le halo, §6.4) : le voisinage immédiat de la barre reste à **6.97:1** quelle que soit l'opacité de la plaque |
| Cumul muet + sourdine | croix sur mon avatar **et** barres sur les autres : les deux se lisent sans se confondre (croix = je n'émets pas, barre = je n'entends pas) |

#### S4.6 — Opacité à 60 % (minimum)

| Élément | Spécification |
|---|---|
| Rendu | plaque à `alpha 0.6` sur `bg.overlay` ; sur un bureau clair, le fond composé devient `rgb(109,110,113)` ; initiales, halo, croix **inchangés** |
| Mesures | texte **4.62:1** ✅ ; croix (sur disque opaque) **6.97:1** ✅ ; halo avec liseré **10.83:1** vs son voisin ✅ (voir le tableau §6.5) |
| Interdit | ❌ `win.setOpacity(0.6)` — mesuré 4.80:1 sur fond blanc, mais 3.45:1 à 0.5 et un texte délávé qui devient gris clair sur gris : la plaque seule est la seule méthode qui tienne |
| Bordure | 1 px `border.subtle` à pleine opacité, pour que la bande reste délimitée sur fond clair |

#### S4.7 — Déplacement (poignée)

| Élément | Spécification |
|---|---|
| Déclencheur | `pointerdown` sur la poignée, puis déplacement > `overlay.dragThresholdPx` (3 px). Implémentation conforme à SPEC-001 A10 : la poignée porte `-webkit-app-region: drag`, et `setIgnoreMouseEvents(false)` n'est activé que sur ses 12 px de large (sinon le `drag` de la région serait ignoré par l'OS) |
| Retour | poignée : points `text.primary`, curseur `grabbing`, 2 points de préhension bougent de 1 px ; la plaque gagne `shadow.3` pendant le drag (elle « se soulève ») |
| Pendant | aucune transition de position (suivi direct du pointeur, pas de lissage : ça donne un effet caoutchouc) |
| Aimantation | à 16 px des bords de l'écran, la position colle au bord (`space.4` de marge) ; à 16 px du centre horizontal, centrage |
| Fin | position persistée en **pourcentage de l'écran** (résiste au changement de résolution) ; l'ombre revient à `shadow.overlay` |
| Contraintes | la plaque ne peut jamais sortir entièrement de l'écran : au moins 60 px (`overlay.minWidth`) restent visibles |
| Clavier | **aucun** : pas de déplacement au clavier, la fenêtre n'est pas focalisable. Le recentrage se fait dans E3 ▸ Overlay (`settings.overlay.positionReset`) |
| Multi-écrans | le drag peut changer d'écran ; l'écran de destination devient l'écran mémorisé |

#### S4.8 — Huit participants (largeur maximale)

| Élément | Spécification |
|---|---|
| Largeur | 308 px (calcul §6.2), sous le plafond de 336 : jamais de défilement, jamais d'avatar coupé |
| Ordre | moi en premier, puis ordre d'arrivée ; l'arrivée d'un 8ᵉ avatar élargit la plaque en `motion.duration.panel` (200 ms) |
| 9ᵉ impossible | plafond de 8 participants tenu par la signalisation (S2.11) : l'overlay n'a pas de cas « trop de monde » à gérer |
| Perte de lisibilité | aucun texte à tronquer (pas de pseudo) : la largeur maximale est sûre par construction |

#### S4.9 — Bascule parole / silence (anti-flash)

| Élément | Spécification |
|---|---|
| Ce qu'on voit | rien d'autre que l'apparition/disparition du halo en 80 ms |
| Ce qu'on ne voit jamais | pas de clignotement, pas de changement de taille, pas de texte « parle » qui apparaît, pas de réorganisation de la bande (les avatars ne bougent pas quand quelqu'un parle : sinon la bande « danse ») |
| Parole très courte (< 120 ms) | aucun halo (hystérésis d'ouverture) : un clic de souris ne fait pas clignoter l'overlay |
| Changement de participant | l'avatar apparaît/disparaît en fondu 160 ms, les autres glissent de `motion.duration.panel` |

#### S4.10 — Mouvement réduit

| Élément | Spécification |
|---|---|
| `prefers-reduced-motion: reduce` | halos et fondus instantanés (`motion.reducedMotionDuration` = 0) ; **aucune** autre différence visuelle |
| Pulsation | jamais de pulsation, ni en mode normal ni en mode réduit (l'overlay ne doit pas attirer l'œil en continu) |

#### S4.11 — Au-dessus d'une autre application : focus et clics traversants

C'est **l'état par défaut** de l'overlay (il est toujours au-dessus de quelque chose). Il est donc testé
comme un état à part entière.

| Élément | Spécification |
|---|---|
| Clic dans l'application en dessous, **hors poignée** | traverse l'overlay : l'application reçoit le clic (placement de curseur, jeu, clic de bouton). Zone ignorée par la souris : toute la plaque **sauf** les 12 × 44 px de la poignée |
| Clic **sur la poignée** | capté par l'overlay : `setIgnoreMouseEvents(false)` au `pointerenter` de la poignée (~100 ms de latence acceptable), `true` au `pointerleave` |
| Apparition de l'overlay | `showInactive()` — la fenêtre **ne prend pas** le focus ; l'application active le reste |
| `Alt+Tab` / `Cmd+Tab` | l'overlay n'apparaît pas dans la liste (pas de focus, `skipTaskbar`) |
| Clic droit | aucun menu : `contextmenu` neutralisé, aucun événement transmis à une couche DOM interactive (il n'y en a pas) |
| Survol | aucun changement visuel hors poignée (`cursor: default`) : pas de surbrillance qui laisserait croire à une zone cliquable |
| Sélection / glisser de texte | impossible (`user-select: none`), l'overlay ne « mange » pas un drag commencé dans l'application |
| Lecteur d'écran | l'overlay n'est pas une fenêtre annoncée ; aucune information n'y est **exclusive** (tout est aussi dans E2, §8.4) |
| Test d'acceptation | 20 clics consécutifs dans un éditeur de texte sous l'overlay : 20 placements de curseur corrects, 0 clic perdu ; puis 5 déplacements par la poignée : 5 déplacements, 0 clic transmis à l'éditeur |

---

## 7. Ergonomie PTT et VAD

### 7.1 Les deux modes, et ce que ça change à l'écran

| Élément | Mode « Appuyer pour parler » (`ptt`) | Mode « Détection de voix » (`vad`) |
|---|---|---|
| Ouverture du micro | pendant l'appui, **jamais** autrement | automatique au-dessus du seuil |
| `LevelMeter` dans la barre | visible, actif | visible, actif |
| Marqueur de seuil dans la barre | **masqué** (aucun effet : l'afficher serait un mensonge) | visible |
| `MeterPopover` | ne s'ouvre pas ; le clic sur le mètre ouvre E3 ▸ Audio | s'ouvre : c'est le réglage principal |
| Zone de bruit ambiant | masquée | visible |
| `PttHint` | `control.ptt.hold` (`Maintenez Alt+Espace pour parler`) | absent |
| Bloc `VadBlock` dans E3 | masqué, remplacé par `control.ptt.hold` | présent (§S3.9) |
| `PttBlock` dans E3 | présent | masqué (le raccourci reste enregistré, il resservira) |
| Retour de parole | halo sur ma tuile + pastille `control.ptt.active` | halos automatiques |
| Risque principal | oublier d'appuyer (« on ne m'entend pas ») → traité par `PttHint` permanente | micro qui s'ouvre tout seul (bruit de fond) → traité par la calibration et la zone de bruit |

Le **changement de mode est un choix explicite**, mémorisé, et il ne se produit jamais tout seul (pas de repli
automatique PTT → VAD, pas de « votre raccourci ne marche pas, on passe en détection »). Le mode courant est
toujours affiché dans le segment de la barre de contrôle.

### 7.2 Régler un seuil de détection de voix sans se tromper — parcours pas à pas

Le problème : un seuil trop bas ouvre le micro sur le bruit de fond (les autres entendent ma pièce) ;
un seuil trop haut ne s'ouvre jamais (on ne m'entend pas). L'utilisateur, lui, ne sait pas ce qu'est un dBFS.
D'où trois aides **simultanées** : une barre de niveau **live**, un **marqueur de seuil** déplaçable,
et une **zone de bruit ambiant affichée** — plus un bouton « Calibrer » pour ceux qui ne veulent pas comprendre.

**Parcours (mode `vad`)**

1. **Entrer dans le réglage.** Deux chemins : cliquer le `MicMeter` dans la barre de contrôle (E2), ou `Alt+S`.
   → S2.9 s'ouvre : puits de 48 px, graduations −70…−10 dBFS, barre live, marqueur `state.warn` à la valeur courante.
   L'utilisateur voit **immédiatement** sa propre voix et le bruit de sa pièce sans avoir rien à comprendre.
2. **Lire la zone de bruit.** La bande hachurée à gauche s'arrête à `bruit ambiant + 6 dB`
   (`settings.vad.noiseFloor`, par ex. `−62 dBFS`). Règle visuelle : *le marqueur doit être à droite des hachures.*
   Aucune notion de décibel n'est nécessaire pour appliquer la règle.
3. **Parler normalement.** La barre franchit le marqueur → elle passe de `accent.default` à `state.speaking`.
   **C'est la démonstration du réglage** : « si la barre passe au vert quand je parle, ça marche ».
4. **Ajuster.** Glisser le marqueur (souris) ou flèches / `Page↑↓` (clavier, ±1 / ±6 dB).
   Effet immédiat sur le moteur (anti-rebond 100 ms) : aucun bouton « Appliquer », donc aucun doute sur l'état enregistré.
5. **Si le seuil descend dans les hachures** (`threshold < bruit ambiant + 6`) : le texte d'aide devient
   `settings.vad.helpTooLow` en `state.warn` et le marqueur s'épaissit à 3 px. On **n'empêche pas** —
   un cas légitime existe (micro très faible, pièce très calme) — mais l'utilisateur est averti explicitement.
6. **Ou ne pas comprendre et cliquer `[Calibrer]`.** 3 s de silence demandé (`settings.vad.calibrating` avec décompte),
   mesure du plancher + écart-type, puis **proposition** : `settings.vad.calibrated` (`Seuil proposé : −46 dBFS`),
   `[Utiliser ce seuil]` et `[Conserver −38 dBFS]` (libellé dynamique avec l'ancienne valeur — jamais un « Annuler » ambigu).
   Rien n'est appliqué sans clic : la calibration ne change jamais le seuil dans le dos de l'utilisateur.
7. **Échec de calibration** (pièce trop bruyante) : `settings.vad.calibrateFailed` en `state.mute`, seuil **inchangé**,
   `[Calibrer]` de nouveau actif. On propose de réessayer au calme, on ne force rien.
8. **Vérifier en conditions réelles.** Fermer (`Échap`) : le focus revient au `MicMeter` ; en mode `vad`,
   le mètre de la barre garde le marqueur, donc l'état reste lisible d'un coup d'œil pendant qu'on parle.

**Garde-fous contre les erreurs classiques**

| Erreur classique | Ce qui l'empêche |
|---|---|
| Seuil sous le bruit de fond | hachures visibles + `settings.vad.helpTooLow` + marqueur épaissi |
| Seuil au maximum « pour être sûr » | la barre ne passe jamais au vert quand on parle → l'utilisateur voit que ça ne marche pas, sur place |
| Régler sans entendre | bouton `[Tester la sortie (1 s)]` à côté, et les autres participants restent visibles dans E2 derrière le popover |
| Ne pas savoir si c'est enregistré | application immédiate + persistance à la fermeture, aucun état « brouillon » |
| Régler en PTT et croire que ça agit | le bloc VAD et le marqueur sont **masqués** en mode PTT |

### 7.3 Découvrir et changer le raccourci PTT — parcours pas à pas

**Découverte (sans lire de documentation)**

1. En mode `ptt`, la barre de contrôle de E2 affiche en permanence `control.ptt.hold` :
   `Maintenez Alt+Espace pour parler` — le raccourci est écrit là où on en a besoin, pas dans une aide.
2. Un clic (ou `Alt+S`) sur le `MicMeter` ouvre E3 ▸ Audio, où le bloc « Appuyer pour parler » montre le raccourci
   dans un `ShortcutChip` monospace, avec son état : `● Actif` (`settings.ptt.active`) ou `● Inactif` (`state.warn`).
3. `settings.ptt.globalHelp` répond à la question suivante (« et si la fenêtre n'a pas le focus ? ») :
   *Fonctionne même quand la fenêtre n'a pas le focus.*

**Changement**

1. `[Changer]` (ou `Entrée` sur le chip) → la zone de capture s'ouvre (S3.6) : bordure 2 px `accent.default`,
   texte `settings.ptt.recording` — `Appuyez sur une combinaison… (Échap pour annuler)`.
2. Les raccourcis globaux PTT sont **suspendus** pendant la capture : appuyer sur l'ancien raccourci ne déclenche
   pas d'appui, il ne fait qu'afficher ses modificateurs.
3. Les modificateurs s'allument en direct (`Ctrl`, `Alt`, `Maj`) : on voit sa frappe avant de valider.
4. On valide au **relâchement** de la dernière touche non modificatrice (pas de validation à l'appui : on évite
   d'enregistrer une combinaison incomplète).
5. `Échap` ou un clic hors zone annule : **l'ancien raccourci reste affiché et actif** pendant toute la capture.
6. Succès → `settings.ptt.recorded` en `state.ok` sous le champ, l'état repasse à `● Actif`, et la `PttHint` de E2
   affiche la nouvelle combinaison immédiatement (source unique).

**Si le raccourci est déjà pris** (S3.7)

1. `globalShortcut.register()` échoue → on **ne garde pas** la nouvelle combinaison.
2. Message `settings.ptt.conflict` : `Ctrl+Shift+M est déjà pris par le système. L'ancien raccourci (Alt+Espace) reste actif.`
   → nomme **la combinaison refusée** *et* **celle qui reste active** : les deux informations dont on a besoin.
3. Ton erreur (`state.mute`, `role="alert"`), pas de modale : on reste dans le champ pour réessayer.
4. `[Changer]` est de nouveau disponible immédiatement ; le message disparaît au premier enregistrement réussi.
5. **Cas au démarrage** (le raccourci a été pris par une autre application depuis la dernière session) :
   l'état passe à `● Inactif` (`state.warn`), E3 s'ouvre sur l'onglet Audio si l'utilisateur y va, et surtout E2
   affiche `settings.ptt.inactive` **dans la barre** au lieu de `control.ptt.hold` — on ne laisse jamais croire
   que le PTT fonctionne. Le mode **n'est pas** changé d'office (pas de bascule silencieuse en VAD).
6. **Combinaison sans modificateur** (S3.8) : `settings.ptt.needModifier`, la capture reste ouverte.

**Pendant un appui (S2.7)**

| Situation | Comportement |
|---|---|
| Fenêtre principale en arrière-plan, jeu en plein écran | le raccourci est **global** ; l'overlay montre le halo, c'est le seul retour nécessaire |
| Appui alors que je suis muet | refus explicite : bandeau `control.ptt.whileMuted`, annonce `a11y.pttIgnored`, **aucun** audio, **aucun** halo (S2.8) |
| Appui très court (< 120 ms) | ignoré (anti-rebond) : un `Alt+Tab` malheureux n'émet pas un clic |
| Appui maintenu puis changement de mode | le changement de mode est appliqué au relâchement, la piste est coupée d'abord |
| Deux appuis rapides | pas de tonalité, pas de clignotement : le halo suit l'état réel de la piste |
| Perte du focus de l'application pendant l'appui | la piste se coupe (un appui ne survit pas à un changement de contexte), l'overlay retire le halo |

### 7.4 Critères ergonomiques mesurables

| Critère | Cible |
|---|---|
| Nombre d'actions pour se mettre muet en pleine conversation | **1** (bouton) ou **0** (raccourci `Ctrl+M`) |
| Nombre d'actions pour régler le seuil sans calibration | 2 (ouvrir le popover, glisser le marqueur) |
| Nombre d'actions pour régler le seuil avec calibration | 3 (ouvrir, `Calibrer`, `Utiliser ce seuil`) |
| Délai entre l'appui et le halo | ≤ 80 ms perçus (durée de la transition), l'état audio réel est immédiat |
| Délai entre le relâchement et la coupure | immédiat (`track.enabled = false`), le halo s'éteint en 80 ms |
| Raccourci oublié | toujours écrit à l'écran en mode `ptt` (`PttHint`), jamais seulement dans une aide |

---

## 8. Accessibilité

### 8.1 Navigation clavier — carte complète (hors overlay)

| Contexte | Touche | Action |
|---|---|---|
| Global | `Tab` / `Shift+Tab` | élément suivant / précédent |
| Global | `Ctrl+,` | ouvre / ferme E3 (focus rendu à l'origine) |
| Global | `Ctrl+M` | muet / réactivé |
| Global | `Ctrl+Shift+M` | sourdine / réactivé |
| Global | `Alt+Espace` | appui PTT (global, fonctionne sans focus) |
| Global | `Alt+S` | mètre / réglage du seuil (E2) |
| Global | `Ctrl+N` | nouveau salon (E1) |
| Global | `Échap` | ferme le dialogue, le popover ou annule une capture de raccourci |
| E1 liste | `↑` / `↓` | déplace le focus entre les boutons de ligne (les lignes non joignables sont incluses et annoncent leur raison) |
| E1 liste | `Entrée` | rejoint le salon focusé |
| E2 tuiles | `Tab` | parcourt les contrôles de volume et de coupure locale, tuile par tuile |
| E2 tuiles | `↑` / `↓` sur un curseur de volume | ±40 % ; `Page↑↓` ±100 % ; `0` remet à 100 % |
| E2 barre | `←` / `→` dans le segment de mode | change de mode |
| E2 barre | `Échap` | ferme le popover du seuil |
| E3 onglets | `←` / `→` | onglet précédent / suivant (un seul onglet dans l'ordre de `Tab`) |
| E3 seuil | `←` / `→` | ±1 dB ; `Page↑↓` ±6 dB ; `Home`/`End` aux bornes |
| E3 capture | `Échap` | annule la capture, l'ancien raccourci reste actif |

**Ordre de tabulation** (fixe, jamais réordonné dynamiquement) :

- **E1** : `ThemeToggle` → `[⚙ Réglages]` → `[Réduire]` → `[Agrandir]` → `[Fermer]` → champ `Pseudo` →
  `[Actualiser]` → `[Créer un salon]` → (action de bandeau si présente) → boutons `[Rejoindre]` dans l'ordre
  d'affichage de la liste → (actions de l'état vide si présent).
- **E2** : `[Épingler]` → `[Réglages audio]` → `[Quitter le salon]` → (action de bandeau) →
  pour chaque tuile dans l'ordre de la grille : `[Couper pour moi]` puis curseur `Volume` (les tuiles distantes
  seulement ; ma tuile n'a que deux arrêts) → `MicMeter` (ouvre le popover) → `[Muet]` → `[Sourdine]` →
  segment de mode → `[Quitter]`.
- **E3** : onglet actif → premier champ du panneau → … → `[Fermer]`.
- **E4** : **rien** — l'overlay n'est jamais dans l'ordre de tabulation (§6.6).

Règle : rien n'est atteignable uniquement à la souris ; tout élément survolable a un état `:focus-visible`
(jamais `outline: none` sans remplacement) ; les `LocalVolumeControl` masqués au repos apparaissent au focus.

### 8.2 Gestion du focus

| Événement | Focus va à |
|---|---|
| Ouverture de E3 | le premier contrôle du panneau, ou l'onglet actif si le panneau n'a pas de contrôle |
| Fermeture de E3 | l'élément qui l'a ouvert |
| Ouverture de `CreateRoomDialog` | le champ `Nom du salon` (texte présélectionné) |
| Fermeture de `CreateRoomDialog` | `[Créer un salon]` |
| Ouverture de `MeterPopover` | le `Marqueur de seuil` (`role="slider"`) |
| Fermeture de `MeterPopover` | le `MicMeter` |
| Refus « salon complet » (S2.11) | `[Revenir aux salons]` |
| Erreur de découverte (S1.5) | **nulle part** : le focus ne bouge pas, le bandeau est annoncé |
| Disparition d'une tuile (S2.4) | la tuile suivante si le focus y était, sinon inchangé |
| `Échap` sur un toast | le toast est `aria-hidden`, non focalisable : `Échap` ne le concerne pas |

Aucun « vol de focus » : pas d'autofocus au chargement, pas de focus déplacé par une annonce, pas de focus dans
une fenêtre qui apparaît (l'overlay utilise `showInactive()`).

### 8.3 Rôles et attributs ARIA

| Composant | Rôle / attributs |
|---|---|
| `AppShell` | `<main>` + `aria-label` = `app.title` |
| `TitleBar` | `<header>` ; boutons icône avec `aria-label` explicite + `aria-keyshortcuts` |
| `DiscoveryList` | `<ul role="list">` ; chaque ligne `<li>` avec un `<button>` |
| `RoomRow` (bouton) | `aria-label = room.row.joinAria` (nom + effectif) ; `full` → `aria-disabled="true"` + `aria-describedby` vers la raison |
| `Banner` (`error`/S1.5) | `role="alert"` ; `warn` → `role="status"` |
| `EmptyState` | `role="status"` (annonce unique) |
| `CreateRoomDialog` | `role="dialog" aria-modal="true"`, `aria-labelledby`, `aria-describedby` |
| `TextField` | `<label for>` réel, `aria-invalid`, `aria-describedby` vers l'aide **et** l'erreur |
| `ParticipantGrid` | `<ul role="list">` ; `aria-busy="true"` pendant S2.1 |
| `ParticipantTile` | `<li>` avec `aria-label` complet : pseudo + état (`participant.speaking` / `.muted` / `.iceRetrying`…) |
| `LocalVolumeControl` | `role="slider"`, `aria-valuemin=0`, `aria-valuemax=150`, `aria-valuetext = participant.volumeValue`, `aria-label = participant.volume` |
| `ControlButton` muet / sourdine | `role="button"` + `aria-pressed` + `aria-keyshortcuts` |
| `ModeSegment` | `role="radiogroup"` + deux `role="radio"` (`aria-checked`) |
| `MicMeter` | `role="img"` + `aria-label` = `control.micLevel` ; `aria-live="off"` (le niveau change 30×/s : **jamais** annoncé) |
| `ThresholdSlider` | `role="slider"`, `aria-valuemin=-70`, `aria-valuemax=-10`, `aria-valuenow`, `aria-valuetext = "−38 dBFS"` |
| `SettingsDialog` | `role="dialog" aria-modal="true"`, `aria-labelledby = settings.title` |
| `SettingsNav` | `role="tablist"`, `aria-orientation="vertical"` ; items `role="tab"` + `aria-selected` ; panneau `role="tabpanel"` + `aria-labelledby` |
| `LayoutPreference` (toggle overlay) | `role="switch"` + `aria-checked` |
| `ToastRegion` | `aria-hidden="true"` (le contenu est déjà annoncé par `LiveRegion`) — évite le doublon |
| `LiveRegion` | `<div aria-live="polite" aria-atomic="true" class="sr-only">` |
| `AlertRegion` | `<div aria-live="assertive" aria-atomic="true" class="sr-only">` |
| Thème / densité | aucun attribut ARIA : préférences visuelles, pas d'annonce |

### 8.4 Annonces lecteur d'écran

Deux régions seulement (`polite` et `assertive`), une annonce par événement, **jamais** pendant un flux continu.

| Événement | Clé | Région | Politique |
|---|---|---|---|
| J'ai rejoint un salon | `a11y.roomJoined` | polite | une fois, **après** la connexion réelle (pas à l'entrée dans S2.1) |
| Un participant **commence** à parler | `a11y.speaking` (`X parle.`) | polite | transition montante seulement, **max 1 annonce / 4 s**, et seulement si personne n'était déjà annoncé comme parlant : 4 personnes qui parlent ne produisent pas 4 phrases par seconde |
| Je parle | `a11y.speakingSelf` | *non annoncé* | ce serait du bruit permanent en PTT ; l'utilisateur sait qu'il appuie |
| Un participant est muet | `a11y.muted` (`X est muet.`) | polite | sur changement d'état, une fois |
| **Je** suis muet | `a11y.selfMuted` / `a11y.selfUnmuted` | polite | sur action utilisateur, une fois |
| **Je** suis en sourdine | `a11y.selfDeafened` / `a11y.selfUndeafened` | polite | sur action utilisateur, une fois |
| Un participant rejoint / part | `a11y.joined` / `a11y.left` | polite | une fois par événement |
| Échec ICE avec un pair | `a11y.iceFailed` | **assertive** | interruption justifiée : on perd quelqu'un |
| Reprise ICE | `a11y.iceRecovered` | polite | une fois |
| Appui PTT ignoré (muet) | `a11y.pttIgnored` | assertive | une fois par appui, jamais en boucle |
| Découverte indisponible | `a11y.discoveryError` | assertive | une fois à l'entrée dans l'état, **pas** à chaque tentative de refresh |
| Erreur bloquante (moteur audio, disque) | `error.*` | assertive | une fois par occurrence, pas de répétition tant que l'état dure |
| Réglage enregistré | `a11y.settingsSaved` | polite | groupé (débounce 1 s) : pas une phrase par pixel de curseur |

**Ce qui n'est jamais annoncé** : le niveau du micro, le compteur de participants qui change à chaque frappe,
les mesures de qualité réseau, l'apparition d'un halo, la position de l'overlay, les toasts (doublon).

### 8.5 Autres exigences

| Exigence | Application |
|---|---|
| Contraste texte ≥ 4.5:1 | §2.2 : 37 paires × 2 thèmes vérifiées, 0 échec |
| Contraste non-texte ≥ 3:1 | bordures de champs (`border.strong`), anneau de focus, halo (avec liseré §6.4), croix de muet (sur disque opaque) |
| Ne pas coder l'information par la couleur seule | muet = icône **et** croix **et** texte ; sourdine = icône **et** barre **et** texte ; parole = anneau (changement de forme) **et** mot `participant.speaking` dans E2 ; qualité = pastille **et** libellé |
| Cible de clic ≥ 24 × 24 px | boutons 32 px de haut (28 pour les actions secondaires), poignée de l'overlay 12 × 44 (exception documentée : zone de préhension volontairement fine, mais c'est la **seule** zone interactive et elle ne recouvre aucune cible d'une autre application) |
| Zoom texte 200 % | toutes les tailles sont en `px` mais les conteneurs en `min-height` / `flex` : la grille de tuiles passe à 1 colonne à 200 %, l'overlay **ne suit pas** le zoom (taille fixe, sinon il sort de l'écran — documenté : `settings.overlay.scale` sert à ça) |
| Mouvement réduit | respecté partout (§2.7, §S4.10) |
| Pas de limite de temps | aucune action n'expire ; les toasts disparaissent mais l'information reste dans l'écran (ex. `room.row.gone` reste sur la ligne) |
| Langue | `lang="fr"` par défaut, `lang="en"` quand `i18n` sert l'anglais ; les unités (`dBFS`, `ms`, `%`) ne sont pas traduites |

---

## 9. Libellés FR et EN

**241 clés**, deux langues, mêmes clés dans le même ordre. Sources : **`design/i18n/fr.json`** et
**`design/i18n/en.json`** ; **`design/i18n.json`** est le bundle `{ "fr": {...}, "en": {...} }` que la coquille
importe, et `node design/check-i18n.mjs` échoue s'il cesse d'être la copie exacte des deux fichiers. Le tableau
ci-dessous en est la reproduction exacte et sert de référence de revue ; en cas d'écart, les fichiers
`i18n/fr.json` + `i18n/en.json` font foi.

**Convention d'interpolation** : `{{nom}}` en moustaches doubles. Les jeux FR et EN portent **exactement** les
mêmes moustaches (vérifié : 0 divergence). Les pluriels utilisent deux clés (`…count.one` / `…count.other`)
résolues par `Intl.PluralRules`. Aucune chaîne n'est concaténée dans le code : une clé = une phrase complète.
Les guillemets français « » sont dans la chaîne FR, les “ ” dans la chaîne EN — jamais ajoutés par le composant.

#### Général / Common (39)

| Clé | FR | EN |
|---|---|---|
| `common.cancel` | Annuler | Cancel |
| `common.confirm` | Valider | Confirm |
| `common.close` | Fermer | Close |
| `common.retry` | Réessayer | Retry |
| `common.apply` | Appliquer | Apply |
| `common.back` | Retour | Back |
| `common.on` | Activé | On |
| `common.off` | Désactivé | Off |
| `common.none` | Aucun | None |
| `common.loading` | Chargement… | Loading… |
| `common.refresh` | Actualiser | Refresh |
| `common.percent` | {{value}} % | {{value}} % |
| `common.seconds` | {{s}} s | {{s}} s |
| `common.keyChord` | {{keys}} | {{keys}} |
| `common.key.ctrl` | Ctrl | Ctrl |
| `common.key.alt` | Alt | Alt |
| `common.key.shift` | Maj | Shift |
| `common.key.space` | Espace | Space |
| `common.key.esc` | Échap | Esc |
| `app.title` | Desktop LAN — voix locale | Desktop LAN — local voice |
| `app.nickname.label` | Pseudo | Display name |
| `app.nickname.placeholder` | Votre pseudo | Your name |
| `app.nickname.help` | Visible par les autres participants du réseau local. | Visible to the other people on your local network. |
| `app.nickname.error.empty` | Entrez un pseudo. | Enter a name. |
| `app.nickname.error.tooLong` | 32 caractères maximum. | 32 characters maximum. |
| `app.nickname.saved` | Pseudo enregistré. | Name saved. |
| `app.settings.open` | Réglages (Ctrl+,) | Settings (Ctrl+,) |
| `app.window.minimize` | Réduire | Minimize |
| `app.window.maximize` | Agrandir | Maximize |
| `app.window.close` | Fermer la fenêtre | Close window |
| `app.theme.label` | Thème | Theme |
| `app.theme.dark` | Sombre | Dark |
| `app.theme.light` | Clair | Light |
| `app.theme.system` | Suivre le système | Follow system |
| `error.title` | Une erreur est survenue | Something went wrong |
| `error.body` | L’action n’a pas pu aboutir. Réessayez. | The action could not be completed. Try again. |
| `error.signaling` | Le serveur de signalisation local ne répond pas. | The local signaling server is not responding. |
| `error.signalingBody` | Vérifiez que le port {{port}} n’est pas bloqué par un pare-feu local. | Check that port {{port}} is not blocked by a local firewall. |
| `error.roomGone` | Ce salon n’existe plus. | That room no longer exists. |

#### E1 — Salons (44)

| Clé | FR | EN |
|---|---|---|
| `discovery.state.searching` | Recherche de salons sur le réseau local… | Looking for rooms on your local network… |
| `discovery.state.searchingHint` | Un réseau chargé peut mettre quelques secondes. | A busy network can take a few seconds. |
| `discovery.state.long` | La recherche prend plus de temps que d’habitude… | This is taking longer than usual… |
| `discovery.state.refreshing` | Actualisation… | Refreshing… |
| `discovery.state.count.one` | 1 salon sur ce réseau | 1 room on this network |
| `discovery.state.count.other` | {{count}} salons sur ce réseau | {{count}} rooms on this network |
| `discovery.method.mdns` | mDNS (_concord._udp) | mDNS (_concord._udp) |
| `discovery.method.broadcast` | Balayage broadcast UDP (port 47820) | UDP broadcast scan (port 47820) |
| `discovery.method.both` | mDNS + balayage broadcast | mDNS + broadcast scan |
| `discovery.method.none` | Aucune | None |
| `discovery.empty.title` | Aucun salon pour l’instant. | No rooms yet. |
| `discovery.empty.body` | Créez un salon sur cette machine, ou attendez qu’un voisin en ouvre un. | Create a room on this machine, or wait for someone nearby to open one. |
| `discovery.empty.action.create` | Créer un salon | Create a room |
| `discovery.empty.action.refresh` | Chercher à nouveau | Search again |
| `discovery.offline.title` | Aucun réseau actif | No active network |
| `discovery.offline.body` | Vous pouvez créer un salon sur cette machine et y parler. Il deviendra visible pour les autres dès qu’une interface réseau sera connectée. | You can create a room on this machine and talk in it. It will become visible to others as soon as a network interface is connected. |
| `discovery.error.mdns.title` | Découverte mDNS indisponible | mDNS discovery unavailable |
| `discovery.error.mdns.body` | Repli automatique sur le balayage broadcast UDP (port 47820). Les salons restent trouvables. | Automatically falling back to UDP broadcast scanning (port 47820). Rooms stay discoverable. |
| `discovery.error.alldown.title` | Découverte impossible | Discovery unavailable |
| `discovery.error.alldown.body` | Aucune méthode de découverte n’a pu démarrer. Vous pouvez quand même créer un salon sur cette machine. | No discovery method could start. You can still create a room on this machine. |
| `discovery.footer.port` | Port de signalisation {{port}} | Signaling port {{port}} |
| `discovery.footer.offline` | Hors ligne — la liste se remplira dès qu’un réseau sera disponible. | Offline — the list fills in as soon as a network is available. |
| `room.list.title` | Salons sur le réseau local | Rooms on the local network |
| `room.list.create` | Créer un salon | Create a room |
| `room.list.retry` | Réessayer | Retry |
| `room.row.join` | Rejoindre | Join |
| `room.row.joinAria` | Rejoindre le salon {{name}}, {{count}} participants sur 8 | Join room {{name}}, {{count}} of 8 participants |
| `room.row.full` | Complet | Full |
| `room.row.fullAria` | Salon {{name}}, complet : 8 participants sur 8 | Room {{name}}, full: 8 of 8 participants |
| `room.row.fullReason` | Ce salon a déjà 8 participants. | This room already has 8 participants. |
| `room.row.gone` | Ce salon n’est plus disponible. | That room is no longer available. |
| `room.row.host` | Hôte : {{name}} | Host: {{name}} |
| `room.row.members` | {{count}}/8 | {{count}}/8 |
| `room.row.peopleMore` | +{{count}} | +{{count}} |
| `room.create.title` | Créer un salon | Create a room |
| `room.create.subtitle` | Le salon n’existe que sur cette machine, tant que vous y êtes. | The room exists only on this machine, for as long as you are in it. |
| `room.create.nameLabel` | Nom du salon | Room name |
| `room.create.namePlaceholder` | Salon de {{name}} | {{name}}’s room |
| `room.create.nameHelp` | Visible sur le réseau local. 32 caractères maximum. | Visible on the local network. 32 characters maximum. |
| `room.create.capacity` | Places : 8 (plafond du maillage) | Slots: 8 (mesh limit) |
| `room.create.confirm` | Créer et rejoindre | Create and join |
| `room.create.error.empty` | Donnez un nom au salon. | Give the room a name. |
| `room.create.error.tooLong` | 32 caractères maximum. | 32 characters maximum. |
| `room.create.error.exists` | Un salon est déjà ouvert sur cette machine. | A room is already open on this machine. |

#### E2 — Dans un salon (56)

| Clé | FR | EN |
|---|---|---|
| `room.connecting` | Connexion au salon… | Joining the room… |
| `room.header.members` | {{count}}/8 participants | {{count}}/8 participants |
| `room.header.quality` | Qualité {{quality}} | Quality {{quality}} |
| `room.header.quality.excellent` | excellente | excellent |
| `room.header.quality.fair` | moyenne | fair |
| `room.header.quality.poor` | dégradée | poor |
| `room.header.latency` | Latence {{ms}} ms | Latency {{ms}} ms |
| `room.header.peers` | {{count}} pairs connectés | {{count}} peers connected |
| `room.pin.on` | Fenêtre au premier plan | Window always on top |
| `room.pin.off` | Mettre la fenêtre au premier plan | Keep window on top |
| `room.leave` | Quitter le salon | Leave room |
| `room.leave.toast` | Vous avez quitté « {{name}} ». | You left “{{name}}”. |
| `room.empty.title` | Le salon est vide | The room is empty |
| `room.empty.body` | Plus personne n’est connecté à « {{name}} ». | Nobody is connected to “{{name}}” any more. |
| `room.empty.action` | Revenir aux salons | Back to rooms |
| `room.full.title` | Salon complet | Room full |
| `room.full.body` | « {{name}} » réunit déjà 8 participants. Vous n’avez pas été connecté. | “{{name}}” already has 8 participants. You were not connected. |
| `room.full.action` | Revenir aux salons | Back to rooms |
| `room.error.audioInit` | Le moteur audio n’a pas pu démarrer. | The audio engine could not start. |
| `room.error.audioInitAction` | Réessayer le son | Retry audio |
| `room.error.deviceLost` | Le microphone a été débranché. | The microphone was unplugged. |
| `room.error.deviceLostBody` | Rebranchez-le ou choisissez un autre périphérique dans les réglages. | Plug it back in, or pick another device in settings. |
| `participant.you` | Vous | You |
| `participant.muted` | Muet | Muted |
| `participant.deafened` | Sourdine | Deafened |
| `participant.speaking` | parle | speaking |
| `participant.connecting` | Connexion… | Connecting… |
| `participant.iceRetrying` | Reconnexion… ({{s}} s) | Reconnecting… ({{s}} s) |
| `participant.iceFailed` | Connexion impossible | Connection failed |
| `participant.iceFailedAction` | Réessayer | Retry |
| `participant.left` | {{name}} a quitté le salon. | {{name}} left the room. |
| `participant.joined` | {{name}} a rejoint le salon. | {{name}} joined the room. |
| `participant.volume` | Volume de {{name}} | {{name}}’s volume |
| `participant.volumeValue` | {{percent}} % | {{percent}} % |
| `participant.localMute` | Couper {{name}} pour moi | Mute {{name}} for me |
| `participant.localUnmute` | Rétablir {{name}} pour moi | Unmute {{name}} for me |
| `participant.localMuted` | Coupé pour vous | Muted for you |
| `participant.connectionLost` | Connexion perdue avec {{name}}. | Lost connection to {{name}}. |
| `control.mute.on` | Couper mon micro | Mute my mic |
| `control.mute.off` | Réactiver mon micro | Unmute my mic |
| `control.mute.state` | Muet | Muted |
| `control.deafen.on` | Me rendre sourd | Deafen |
| `control.deafen.off` | Rétablir le son | Undeafen |
| `control.deafen.state` | Sourdine | Deafened |
| `control.deafen.help` | Vous n’entendez plus personne ; votre micro reste actif. | You hear nobody; your mic stays active. |
| `control.mode` | Mode | Mode |
| `control.mode.ptt` | Appuyer pour parler | Push to talk |
| `control.mode.vad` | Détection de voix | Voice detection |
| `control.ptt.hold` | Maintenez {{shortcut}} pour parler | Hold {{shortcut}} to talk |
| `control.ptt.active` | Micro ouvert | Mic open |
| `control.ptt.whileMuted` | Vous êtes muet : {{shortcut}} n’ouvre pas le micro. | You are muted: {{shortcut}} does not open the mic. |
| `control.leave` | Quitter | Leave |
| `control.micLevel` | Niveau du micro | Mic level |
| `control.vad.threshold` | Seuil | Threshold |
| `control.vad.noise` | Bruit ambiant | Ambient noise |
| `control.settingsAudio` | Réglages audio | Audio settings |

#### E3 — Réglages (84)

| Clé | FR | EN |
|---|---|---|
| `settings.title` | Réglages | Settings |
| `settings.close` | Fermer les réglages | Close settings |
| `settings.tab.audio` | Audio | Audio |
| `settings.tab.overlay` | Overlay | Overlay |
| `settings.tab.network` | Réseau | Network |
| `settings.tab.about` | À propos | About |
| `settings.audio.input` | Périphérique d’entrée | Input device |
| `settings.audio.output` | Périphérique de sortie | Output device |
| `settings.audio.systemDefault` | Par défaut du système | System default |
| `settings.audio.inputNone` | Aucun microphone détecté | No microphone detected |
| `settings.audio.outputNone` | Aucun haut-parleur détecté | No speaker detected |
| `settings.audio.inputNoneHelp` | Branchez un microphone, puis rouvrez ce panneau. | Plug in a microphone, then reopen this panel. |
| `settings.audio.outputNoneHelp` | Branchez un casque ou un haut-parleur, puis rouvrez ce panneau. | Plug in a headset or speaker, then reopen this panel. |
| `settings.audio.level` | Niveau d’entrée | Input level |
| `settings.audio.test` | Tester la sortie | Test output |
| `settings.audio.testing` | Lecture du bip (1 s)… | Playing test tone (1 s)… |
| `settings.audio.testDone` | Son de test joué. | Test sound played. |
| `settings.audio.rnnoise` | Réduction de bruit (RNNoise) | Noise reduction (RNNoise) |
| `settings.audio.rnnoiseHelp` | Atténue les bruits de fond avant l’envoi. | Reduces background noise before sending. |
| `settings.audio.rnnoiseUnavailable` | Indisponible sur cette machine. | Unavailable on this machine. |
| `settings.audio.aec` | Annulation d’écho | Echo cancellation |
| `settings.audio.aecActive` | Active | Active |
| `settings.audio.aecInactive` | Inactive | Inactive |
| `settings.audio.aecUnavailable` | Non proposée par le pilote | Not offered by the driver |
| `settings.audio.aecHelp` | État réel lu sur le périphérique, pas la valeur demandée. | Actual state read from the device, not the requested value. |
| `settings.audio.permissionTitle` | Accès au microphone refusé | Microphone access denied |
| `settings.audio.permissionBody` | Autorisez le microphone dans les réglages du système, puis rouvrez ce panneau. | Allow the microphone in your system settings, then reopen this panel. |
| `settings.audio.permissionRetry` | Redemander l’accès | Ask again |
| `settings.audio.mode` | Mode de prise de parole | Talk mode |
| `settings.audio.modeHelp` | Appuyer pour parler n’émet que pendant l’appui. La détection de voix ouvre le micro au-dessus du seuil. | Push to talk transmits only while held. Voice detection opens the mic above the threshold. |
| `settings.vad.title` | Détection de voix | Voice detection |
| `settings.vad.threshold` | Seuil d’ouverture | Open threshold |
| `settings.vad.thresholdValue` | {{db}} dBFS | {{db}} dBFS |
| `settings.vad.noiseFloor` | Bruit ambiant mesuré : {{db}} dBFS | Measured ambient noise: {{db}} dBFS |
| `settings.vad.noiseMeasuring` | Mesure du bruit ambiant… | Measuring ambient noise… |
| `settings.vad.liveLevel` | Niveau actuel : {{db}} dBFS | Current level: {{db}} dBFS |
| `settings.vad.calibrate` | Calibrer | Calibrate |
| `settings.vad.calibrating` | Calibration… restez silencieux ({{s}}) | Calibrating… stay quiet ({{s}}) |
| `settings.vad.calibrated` | Seuil proposé : {{db}} dBFS | Suggested threshold: {{db}} dBFS |
| `settings.vad.calibrateApply` | Utiliser ce seuil | Use this threshold |
| `settings.vad.calibrateFailed` | Trop de bruit pour calibrer. Réessayez dans un endroit plus calme. | Too noisy to calibrate. Try again somewhere quieter. |
| `settings.vad.hysteresis` | Ouvre en 120 ms, ferme en 400 ms | Opens in 120 ms, closes in 400 ms |
| `settings.vad.help` | Gardez le seuil au-dessus du bruit ambiant et sous votre voix. | Keep the threshold above ambient noise and below your voice. |
| `settings.vad.helpTooLow` | Seuil sous le bruit ambiant : le micro s’ouvrira tout seul. | Threshold below ambient noise: the mic opens on its own. |
| `settings.ptt.title` | Appuyer pour parler | Push to talk |
| `settings.ptt.current` | Raccourci actuel | Current shortcut |
| `settings.ptt.change` | Changer | Change |
| `settings.ptt.recording` | Appuyez sur une combinaison… (Échap pour annuler) | Press a key combination… (Esc to cancel) |
| `settings.ptt.recorded` | Raccourci enregistré : {{shortcut}} | Shortcut saved: {{shortcut}} |
| `settings.ptt.conflict` | {{shortcut}} est déjà pris par le système. L’ancien raccourci ({{previous}}) reste actif. | {{shortcut}} is already taken by the system. The previous shortcut ({{previous}}) stays active. |
| `settings.ptt.needModifier` | La combinaison doit inclure Ctrl, Alt ou Maj. | The combination must include Ctrl, Alt or Shift. |
| `settings.ptt.reset` | Rétablir {{shortcut}} | Reset to {{shortcut}} |
| `settings.ptt.globalHelp` | Fonctionne même quand la fenêtre n’a pas le focus. | Works even when the window is not focused. |
| `settings.ptt.active` | Actif | Active |
| `settings.ptt.inactive` | Inactif | Inactive |
| `settings.overlay.enabled` | Afficher l’overlay | Show overlay |
| `settings.overlay.opacity` | Opacité | Opacity |
| `settings.overlay.opacityValue` | {{percent}} % | {{percent}} % |
| `settings.overlay.scale` | Taille des avatars | Avatar size |
| `settings.overlay.scale.sm` | Petit | Small |
| `settings.overlay.scale.md` | Normal | Normal |
| `settings.overlay.scale.lg` | Grand | Large |
| `settings.overlay.screen` | Écran | Display |
| `settings.overlay.screen.n` | Écran {{n}} | Display {{n}} |
| `settings.overlay.screenMissing` | L’écran choisi n’est plus connecté. Overlay replacé sur l’écran principal. | The chosen display is no longer connected. Overlay moved back to the main display. |
| `settings.overlay.position` | Position | Position |
| `settings.overlay.positionReset` | Recentrer | Recentre |
| `settings.overlay.disabledHint` | Activez l’overlay pour régler son opacité et sa taille. | Enable the overlay to adjust its opacity and size. |
| `settings.overlay.help` | L’overlay ne prend jamais le focus et laisse passer les clics ; seule sa poignée répond à la souris. | The overlay never takes focus and lets clicks through; only its handle responds to the mouse. |
| `settings.overlay.preview` | Aperçu | Preview |
| `settings.network.name` | Nom affiché sur le réseau | Name shown on the network |
| `settings.network.port` | Port de signalisation | Signaling port |
| `settings.network.portBumped` | Port {{default}} occupé — port {{port}} utilisé. | Port {{default}} busy — using port {{port}}. |
| `settings.network.discovery` | Découverte active | Active discovery |
| `settings.network.external` | Serveur externe | External server |
| `settings.network.externalNone` | Aucun | None |
| `settings.network.externalHelp` | Aucun STUN, aucun TURN, aucun serveur hors du réseau local. | No STUN, no TURN, no server outside the local network. |
| `settings.network.identity` | Identité de session | Session identity |
| `settings.network.identityHelp` | Identifiant éphémère, régénéré à chaque lancement. Rien à créer, rien à retenir, aucun historique. | Ephemeral identifier, regenerated at every launch. Nothing to create, nothing to remember, no history. |
| `settings.about.version` | Version {{version}} | Version {{version}} |
| `settings.about.license` | Licence {{license}} | License {{license}} |
| `settings.about.local` | Vos réglages restent sur cette machine. | Your settings stay on this machine. |
| `settings.about.nocloud` | Aucune donnée ne quitte votre réseau local. | No data leaves your local network. |
| `settings.error.save` | Vos réglages n’ont pas pu être enregistrés (fichier local en lecture seule). | Your settings could not be saved (local file is read-only). |

#### E4 — Overlay (3)

| Clé | FR | EN |
|---|---|---|
| `overlay.handle` | Déplacer l’overlay | Move overlay |
| `overlay.group` | Participants du salon (overlay) | Room participants (overlay) |
| `overlay.empty` | Personne pour l’instant. | Nobody yet. |

#### Accessibilité / ARIA (15)

| Clé | FR | EN |
|---|---|---|
| `a11y.speaking` | {{name}} parle. | {{name}} is speaking. |
| `a11y.speakingSelf` | Vous parlez. | You are speaking. |
| `a11y.muted` | {{name}} est muet. | {{name}} is muted. |
| `a11y.selfMuted` | Vous êtes muet. | You are muted. |
| `a11y.selfUnmuted` | Votre micro est réactivé. | Your mic is back on. |
| `a11y.selfDeafened` | Vous êtes en sourdine. | You are deafened. |
| `a11y.selfUndeafened` | Sourdine désactivée. | Deafening off. |
| `a11y.roomJoined` | Vous avez rejoint {{name}}, {{count}} participants. | You joined {{name}}, {{count}} participants. |
| `a11y.left` | {{name}} a quitté le salon. | {{name}} left the room. |
| `a11y.joined` | {{name}} a rejoint le salon. | {{name}} joined the room. |
| `a11y.iceFailed` | Connexion interrompue avec {{name}}. Nouvelle tentative. | Connection to {{name}} interrupted. Retrying. |
| `a11y.iceRecovered` | Connexion rétablie avec {{name}}. | Connection to {{name}} restored. |
| `a11y.pttIgnored` | Muet : l’appui n’a pas ouvert le micro. | Muted: the key press did not open the mic. |
| `a11y.settingsSaved` | Réglages enregistrés. | Settings saved. |
| `a11y.discoveryError` | Découverte des salons indisponible. | Room discovery unavailable. |

**Règles de rédaction respectées dans les deux langues** : pas de « compte », « profil », « se connecter »,
« cloud », « synchronisation », « mise à jour » ; pas de point final sur les libellés de bouton ; impératif
pour les actions (« Rejoindre », « Réessayer », « Calibrer »), présent descriptif pour les états
(« Connexion… », « Muet ») ; les messages d'erreur disent **ce qui s'est passé** et **ce qui reste vrai**.

---

## 10. Critères d'acceptation

Un critère est vérifiable par inspection visuelle ou par test ; il n'y a pas de « à peu près ».

### 10.1 Transverses (les 4 écrans)

- [ ] `design/tokens.json` et `design/i18n.json` se chargent en JSON strict, sans commentaire (`JSON.parse` OK) ;
      aucune valeur de couleur, d'espace, de rayon, de durée ou de libellé n'est écrite en dur dans le code.
- [ ] Les 6 clés de premier niveau de `tokens.json` sont exactement `color`, `space`, `radius`, `typography`, `motion`, `overlay`.
- [ ] `design/i18n/fr.json` et `design/i18n/en.json` contiennent **241 clés identiques**, aucune valeur vide, aucune moustache divergente, bundle `design/i18n.json` synchronisé — `node design/check-i18n.mjs` sort en 0 (§12.1).
- [ ] Le thème sombre est le défaut ; le thème clair est atteignable en un contrôle depuis E1, mémorisé.
- [ ] Toutes les paires texte/fond mesurées ≥ 4.5:1 (37 × 2) ; non-texte ≥ 3:1 ; l'exception `border.subtle` est documentée (§2.2).
- [ ] Aucune occurrence de « compte », « login », « se connecter », « profil », « cloud », « synchronisation »,
      « mise à jour » dans les libellés visibles (grep sur `i18n.json`).
- [ ] Tous les états listés en §10.2–10.5 existent et sont atteignables par un test.
- [ ] Le focus clavier est visible partout (`focus.ring`), l'ordre de tabulation est celui de §8.1.
- [ ] `prefers-reduced-motion` supprime toutes les durées (sauf le halo, qui devient instantané).

### 10.2 E1 — Salons (11 états + sous-cas S1.1b)

- [ ] **S1.1** Découverte en cours : 3 squelettes, `[Créer un salon]` actif, aide affichée, `aria-busy`.
- [ ] **S1.1b** > 8 s : l'aide devient `discovery.state.long` et un `[Réessayer]` apparaît ; rien d'autre ne change.
- [ ] **S1.2** Liste vide : titre + corps + deux actions centrés ; compteur masqué à 0.
- [ ] **S1.3** Liste peuplée : lignes de 64 px, pastille 32, nom ellipsé, compteur `n/8`, tri ouverts/fermés.
- [ ] **S1.4** Erreur mDNS : bandeau `warn` non bloquant, liste conservée, footer en `broadcast`.
- [ ] **S1.5** Découverte impossible : bandeau `error` + état vide, `[Créer un salon]` **actif**, footer `Aucune`.
- [ ] **S1.6** Salon complet : bouton `Complet` avec `aria-disabled`, raison en infobulle au survol **et** au focus, pas de clic.
- [ ] **S1.7** Actualisation : bouton en rotation, **liste intacte** (pas de squelette), durée min 400 ms.
- [ ] **S1.8** Création : dialogue 420 px, pré-rempli `Salon de {pseudo}`, compteur 0/32, `Échap` ferme, focus rendu.
- [ ] **S1.9** Salon disparu : ligne marquée `room.row.gone`, toast, focus conservé.
- [ ] **S1.10** Aucune interface réseau : bandeau `warn`, mode hors ligne complet (créer, régler, pseudo), footer dédié.
- [ ] **S1.11** Pseudo invalide : erreur sous le champ, ancien pseudo conservé, rien n'est bloqué.

### 10.3 E2 — Dans un salon (15 états)

- [ ] **S2.1** Connexion en cours : ma tuile tout de suite, squelettes pour les autres, barre de contrôle utilisable.
- [ ] **S2.2** Nominal : halo 2 px / offset 2 px / 80 ms, ligne 2 = une seule information par priorité, qualité + latence.
- [ ] **S2.3** Échec ICE : 2 phases (reconnexion ≤ 30 s, puis échec + `Réessayer`), audio du pair retiré, aucun autre impact.
- [ ] **S2.4** Pair parti : fondu 160 ms, compteur décrémenté immédiatement, une seule annonce SR.
- [ ] **S2.5** Moi muet : bouton `danger` `aria-pressed`, badge sur l'avatar, **pas de halo**, piste coupée côté émetteur.
- [ ] **S2.6** Moi sourd : sortie coupée, entrée active, halos **conservés**, aucune baisse d'opacité du texte.
- [ ] **S2.7** PTT enfoncé : halo + `control.ptt.active`, seuil masqué, aucune annonce SR par appui.
- [ ] **S2.8** PTT + muet : bandeau `control.ptt.whileMuted`, **aucun** audio, **aucun** halo, `a11y.pttIgnored` une fois.
- [ ] **S2.9** Réglage du seuil : barre live 30 Hz, marqueur `role="slider"` (souris + flèches), zone de bruit hachurée, avertissement `helpTooLow`.
- [ ] **S2.10** Calibration : décompte 3 s, proposition avec deux boutons explicites, échec géré, seuil jamais modifié sans clic.
- [ ] **S2.11** Salon complet : écran plein, une seule action, pas de « réessayer ».
- [ ] **S2.12** Salon vide : délai 2 s, une action, aucun bouton « rester seul ».
- [ ] **S2.13** Micro débranché : bandeau `error`, réception intacte, reprise automatique au rebranchement.
- [ ] **S2.14** Moteur audio KO : on **reste** dans le salon, badge sourdine, actions désactivées, `Réessayer le son`.
- [ ] **S2.15** Qualité dégradée : pastille + latence + nb de pairs, hystérésis 5 s, aucune bannière.

### 10.4 E3 — Réglages (15 états)

- [ ] **S3.1** Nominal : 4 onglets ARIA, application + persistance immédiates, aucun bouton « Enregistrer ».
- [ ] **S3.2** Aucun périphérique d'entrée : sélecteur désactivé avec libellé explicite, `[Réanalyser]`, reste réglable.
- [ ] **S3.3** Aucun périphérique de sortie : `[Tester]` désactivé mais présent, message dédié.
- [ ] **S3.4** Permission refusée : bandeau `alert` en tête, `[Redemander l'accès]`, pas de bouton système.
- [ ] **S3.5** Test de sortie : 1 s, rampe anti-clic, annonce de fin, second clic ignoré.
- [ ] **S3.6** Capture de raccourci : zone 2 px accent, modificateurs en direct, validation au relâchement, `Échap` annule, raccourcis PTT suspendus.
- [ ] **S3.7** Conflit : message nommant la combinaison refusée **et** l'ancienne qui reste active ; jamais d'état « PTT cassé silencieux ».
- [ ] **S3.8** Sans modificateur : `settings.ptt.needModifier`, capture maintenue ouverte.
- [ ] **S3.9** Seuil en place : mêmes aides qu'en S2.9, bloc VAD masqué en mode PTT.
- [ ] **S3.10** Calibration : 3 phases distinctes, jamais appliquée sans confirmation.
- [ ] **S3.11** RNNoise / AEC indisponibles : ligne conservée, état réel, contraste AA maintenu.
- [ ] **S3.12** Overlay désactivé : contrôles `aria-disabled` mais visibles, `disabledHint`, opacité bornée 60–100 %.
- [ ] **S3.13** Écran absent : `screenMissing`, overlay replacé, position en pourcentage, pas de retour auto.
- [ ] **S3.14** Écriture impossible : `settings.error.save`, réglages actifs pour la session, pas de modale.
- [ ] **S3.15** Port occupé : port effectif + `portBumped` en `mono`, lecteur seule, aucune ligne « compte ».

### 10.5 E4 — Overlay (11 états)

- [ ] **S4.1** Hors salon ou désactivé : fenêtre `hide()`, rien à l'écran.
- [ ] **S4.2** Nominal : 44 px de haut, avatar 28, écart 8, poignée 12 + 3 points, largeur auto, aucun pseudo.
- [ ] **S4.3** Parole : halo 2 px + liseré 1 px, 80 ms, sans flash, multi-parleurs simultanés.
- [ ] **S4.4** Moi muet : croix 12 px sur disque **opaque** (6.97:1 / 5.70:1), pas de halo.
- [ ] **S4.5** Sourdine : barres diagonales 2 px sur les autres avatars, `headphones-off` à côté de la poignée, halos conservés.
- [ ] **S4.6** Opacité 60 % : plaque seule atténuée, texte 4.62:1 (sombre, pire cas) et 6.32:1 (clair), `win.setOpacity` **non** utilisé.
- [ ] **S4.7** Déplacement : seuil 3 px, `grabbing`, aimantation 16 px, persistance en %, jamais hors écran, aucun clavier.
- [ ] **S4.8** 8 participants : 308 px ≤ 336, aucun défilement, élargissement en 200 ms.
- [ ] **S4.9** Anti-flash : aucun clignotement, aucun déplacement d'avatar à la parole, hystérésis 120/400 ms.
- [ ] **S4.10** Mouvement réduit : tout instantané, aucune pulsation.
- [ ] **S4.11** **Focus** : `focusable: false`, aucun élément `tabindex`, aucun champ, aucun menu contextuel, aucun `title`,
      clics traversants partout **sauf** la poignée 12 × 44 ; `showInactive()` et jamais `show()`.
      *Test manuel : overlay au-dessus d'un éditeur de texte, cliquer dans l'éditeur à travers l'overlay → le curseur doit se placer dans l'éditeur, 20 fois de suite.*

---

## 11. Traçabilité brief → spécification

| État exigé par le brief | Où il est spécifié |
|---|---|
| découverte en cours | **S1.1** (+ S1.1b après 8 s), **S1.7** (refresh manuel) |
| liste vide | **S1.2** |
| liste peuplée | **S1.3** |
| erreur de découverte | **S1.4** (partielle, mDNS), **S1.5** (totale), **S1.10** (aucune interface) |
| salon complet | **S1.6** (refusé dans la liste), **S2.11** (refusé à l'entrée) |
| connexion en cours | **S2.1** |
| pair en échec ICE | **S2.3** |
| pair parti | **S2.4**, **S2.12** (salon vidé) |
| moi muet | **S2.5**, **S2.8** (PTT + muet), **S4.4** (overlay) |
| moi sourd | **S2.6**, **S4.5** (overlay) |
| PTT enfoncé | **S2.7**, **S4.3** (halo dans l'overlay) |
| réglage de seuil en cours | **S2.9** (dans le salon), **S3.9** (dans les réglages), **S2.10** / **S3.10** (calibration) |
| sans périphérique (ajouté) | **S3.2**, **S3.3**, **S2.13** |
| overlay (états) | **S4.1** à **S4.11** |

**Total : 4 écrans, 52 états décrits (dont 1 sous-cas), 241 clés de libellés × 2 langues, 86 paires de contraste calculées (74 du tableau §2.2 + 12 paires d'état).**

*Fin de SPEC-002.*


---

## 12. Preuves exécutables (node pur, sans `node_modules`)

Racine : `/work/lan-voice`. Node v22 présent, `node_modules` absent, `npm install` indisponible : les deux
contrôles n'utilisent que la bibliothèque standard (`node:fs`), aucun paquet, aucun réseau.

### 12.1 Parité des libellés FR/EN

```
$ cd /work/lan-voice && node design/check-i18n.mjs
I18N files=design/i18n/fr.json,design/i18n/en.json bundle=design/i18n.json
I18N keys fr=241 en=241 duplicate=0 empty=0 nonString=0
I18N parity missingInEn=0 missingInFr=0 orderDiff=0
I18N placeholders mismatch=0 badSyntax=0
I18N buttons=29 maxLen=19<=20 (fr settings.close = "Fermer les réglages")
I18N typography quoteErrors=0
I18N bundle=ok
I18N RESULT=PASS
EXIT=0
```

Contrôles exercés : JSON strict, **clés en double dans le texte brut**, parité des clés et de leur ordre,
valeurs vides ou non textuelles, moustaches `{{…}}` identiques et bien formées, libellés de bouton ≤ 20
caractères, bundle `design/i18n.json` identique aux deux fichiers, typographie des guillemets. Non vacuité
vérifiée : sur un jeu d'essai volontairement cassé (une clé supprimée côté EN, une valeur vidée, une clé
dupliquée dans le texte), le script affiche `I18N RESULT=FAIL` et sort en **1**.

### 12.2 Contrastes WCAG AA

```
$ cd /work/lan-voice && node design/check-contrast.mjs
CONTRAST pairs=86 (dark=43 light=43) text=68 nonText=18 checked=86
CONTRAST minText=4.70:1 (dark accent.on/accent.pressed) seuil 4.5:1
CONTRAST minNonText=3.54:1 (light border.strong/bg.inset) seuil 3:1
CONTRAST RESULT=PASS
EXIT=0
```

Le script recalcule chaque ratio à partir de `design/tokens.json` (pas du tableau), vérifie le seuil de la
paire (4.5:1 texte, 3:1 non-texte) **et** la concordance avec le ratio annoncé en §2.2 : une valeur de jeton
modifiée sans mise à jour du tableau fait échouer le contrôle.

### 12.3 État d'implémentation

| Écran | Spécifié | Implémenté (coquille) | Déclaration |
|---|---|---|---|
| E1 — Salons | §3 (11 états + S1.1b) | non — pas de `src/renderer/` | **maquette seule** |
| E2 — Dans un salon | §4 (15 états) | non | **maquette seule** |
| E3 — Réglages | §5 (15 états) | non | **maquette seule** |
| E4 — Overlay | §6 (11 états) | non | **maquette seule** |

Aucun de ces écrans ne peut être déclaré « fait » sur la foi de ce document : « fait » exige le composant
livré par Cadre **et** la sortie de `VERIF/run-all.sh` reproduite.

### 12.4 Contrôle de Régie : `VERIF/check-labels.sh`

Le contrôle du dépôt lit le **même** catalogue (`design/i18n/`, une locale par fichier) :

```
$ cd /work/lan-voice && sh VERIF/check-labels.sh
=== check-labels.sh — 2026-10-31T00:03:08+01:00 ===
RACINE   : /work/lan-voice
catalogue: /work/lan-voice/design/i18n
[INFO] L0  catalogue=design/i18n locales=[en:241, fr:241]
[OK]    L1 locales FR (241 clés) et EN (241 clés) présentes
[OK]    L2 mêmes 241 clés dans toutes les locales (en/fr)
[OK]    L3 aucune valeur vide (null / chaîne vide / blanc)
[ECHEC] L4 188 clé(s) jamais référencée(s) dans src/ (3/241 référencées) : common.cancel, common.confirm, common.retry, common.apply, common.back, common.on, common.off, common.loading, common.refresh, common.percent, common.seconds, common.keyChord, common.key.ctrl, common.key.alt, common.key.shift …
[INFO]  L5  20 clé(s) identiques FR=EN (à relire, ex. OK / Mute) : common.percent, common.seconds, common.keyChord, common.key.ctrl, common.key.alt, discovery.method.mdns, room.row.members, room.row.peopleMore, room.header.members, participant.volumeValue …
--- résumé ---
locales=2 clés=241 échecs=1 skips=0
CHECK_LABELS RESULT=FAIL locales=2 keys=241 failures=1 skips=0
EXIT=1
```

Lecture — **L1–L3 sont verts** : 241 clés identiques FR/EN, aucune valeur vide, catalogue au format attendu.
**L4 échoue et c'est cohérent** : seules 3 clés sur 241 sont encore appelées par un `t('section.cle')` dans
`src/`, donc 188 libellés sont orphelins. Ce n'est pas un défaut du catalogue mais **la mesure exacte du
chantier d'intégration** : tant que les écrans de §3–§6 ne sont pas câblés, L4 ne peut pas passer, et aucun
écran ne peut être déclaré « fait » (§12.3). Le critère de sortie est mécanique : L4 vert quand les 241 clés
sont référencées, ou liste d'exceptions justifiées. **L5** recense 20 clés identiques FR=EN ; elles ont été
relues une par une et sont légitimes :
unités et formats (`{{value}} %`, `{{count}}/8`, `{{db}} dBFS`), touches (`Ctrl`, `Alt`), emprunts identiques
(`Audio`, `Overlay`, `Position`, `Mode`, `Normal`, `mDNS (_concord._udp)`), et `Active`/`Inactive` qui
s'accordent avec « réduction d'écho » (féminin). Une vraie fuite a été trouvée et corrigée à cette relecture :
`settings.about.license` affichait « Licence » côté EN — devenu **`License {{license}}`**.