# AD-21 — Quatre corrections de mesure avant T23 : ancre de la fusion, texte rendu, plancher qui ne bouge pas, budget de messages

Régie · 2026-10-31 · arbitrage · répond à la note de Banc (desk-qa) sur AC20-4 / AC20-5 / plancher /
`data-muted`, plus un défaut qu'il n'a pas vu et que la relecture a sorti (AC20-3).
**Remplace, dans AD-20 §6 : AC20-3, AC20-4, AC20-5.** AC20-1, AC20-2, AC20-6 tiennent tels quels.
Opposable à **T22** (plan de diff, Cadre), au **feu T23 étapes A et B**, et à **VERIF-024**.
Aucune ligne de code écrite ici, aucun fichier du dépôt touché.

---

## 0. Verdict

| Point de Banc | Verdict | Où |
|---|---|---|
| 1. « N pairs ⇒ N lignes `data-peer-id` » faux après fusion | **Fondé** — ma faute : AD-20 §6 contredisait ma propre SPEC-013b (ACb-2, ACb-7). AC20-4 → **AC20-4r** | §1 |
| 2. AC20-5 rouge au repos à cause d'un **commentaire** | **Fondé** — re-cadré sur le rendu, commentaire **conservé** (whitelist 1) | §2 |
| 3. Plancher 250 ms incompatible avec une cadence ≤ 1 Hz | **Prémisse fausse, alerte juste.** Il y a **deux** producteurs ; `SPEAKING_STALE_MS` **ne bouge pas**, et le couplage craint devient un interdit nommé | §3 |
| 4. `data-muted` d'un pair = `unknown`, jamais `false` | **Fondé** — AC-U6 → **AC-U6r** | §4 |
| 5. (trouvé en relisant AC20-3) plafond « ≤ 12 messages » inatteignable | **Fondé** — AC20-3 → **AC20-3r** | §5 |

---

## 1. AC20-4r — l'ancre de la fusion

La ligne de soi porte `data-peer-id` (SPEC-013b §5 ; AD-19 D2 : un seul espace d'id, celui de la
signalisation). Après fusion, `li[data-peer-id]` rend donc **N+1**. On ne compte pas : on **calcule
l'ensemble attendu**. Forme retenue (celle de Banc) :

- ancre unique : `ul.participants[data-voice="peers"]` — l'`aria-label` a disparu, plus d'ancrage par
  libellé ;
- `li[data-self="false"]` = **N** ; `li[data-self="true"]` = **1** ;
- `set(li[data-peer-id].ids)` = `ids(voice.peers) ∪ {selfId}` : aucun doublon, **aucun id de
  `voice.peers` absent**, aucun id surnuméraire ;
- **cas `selfId === null`** (aucun id de signalisation) : la ligne de soi **ne porte pas**
  `data-peer-id` ; l'identité devient `= ids(voice.peers)` et `li[data-self="true"] = 1` reste
  l'ancre de la ligne de soi ;
- halos = nombre de `li` (= N+1), et les quatre `data-peer-*` sur **chaque** ligne, ligne de soi
  comprise (`unknown` / `none` / `false` — jamais `connected`, SPEC-013b §5).

**Interdit explicite** : poser `data-peer-id` sur les seuls pairs « pour que ça fasse N ». Ça satisferait
l'ancien AC20-4 et casserait ACb-7.

---

## 2. AC20-5r — le texte **rendu**, pas le texte **source**

1. `git diff <base>..HEAD -- design/i18n/fr.json design/i18n/en.json` = **0 ligne** ;
2. `grep -rn "non mesur" src/renderer/*.tsx src/renderer/i18n*` = **0**. Les `.ts` de production sont
   **hors champ** : un commentaire est de la documentation, pas du rendu ;
3. sur le DOM : `textContent` de la ligne overlay `unknown` = **le nom seul** ; et pour toute ligne de
   la liste unie, aucune des chaînes interdites de R-U2 — au minimum `non mesur`, `inconnu`,
   `indéterminé`, `pas de mesure` (casse et accents repliés).

**Whitelist, à ne pas compter** : `src/renderer/voice.ts:340` — « … un pair non mesuré n'est pas
écrit. ». Une occurrence, autorisée, **à préserver** : c'est la même famille que le commentaire
`Room.tsx:104-106` que SPEC-013b demande de conserver. Si VERIF-024 la compte, c'est un **faux
positif de mesure**, pas un défaut.

---

## 3. Le plancher ne bouge pas : il y a deux producteurs, pas un

Banc met deux cadences sur le même fil. Elles ne le sont pas.

| | Producteur A — la **table** | Producteur B — le **canal** |
|---|---|---|
| Qui | `peer-speech.ts`, fenêtre principale | `lan:speaking-set` (AD-19) → overlay |
| Cadence | `SAMPLE_PERIOD_MS` = **50 ms** (20 Hz), locale, **aucun message** | transitions + tenue 600 ms + garde-vie **≤ 1 Hz** |
| Valeur écrite | `'true'` / `'false'`, tenue déjà appliquée | `speaking[]` — des identifiants |
| Consommateur | `Room.tsx` (2 sites) via `peerSpeaking` | `Overlay.tsx` — **autre fenêtre, autre renderer** |
| Péremption | `SPEAKING_STALE_MS` = 250 ms, garde contre un producteur **mort** | **2500 ms** (AD-19 §4), ≥ 2 battements de garde-vie |

Trois faits, lus dans le source, qui tranchent :

1. **la table est échantillonnée à 50 ms** (`peer-speech.ts:51`) : entre deux échantillons l'âge est de
   50 ms, jamais 1000. À 250 ms de péremption, la table ne peut pas s'éteindre sous un pair vivant ;
2. **l'anti-clignotement n'est pas la péremption, c'est la tenue** (`SPEAKING_HOLD_MS` = 600 ms, appliquée
   dans le producteur, R-U8 §2) : une pause de 300–800 ms ne produit aucune transition ;
3. **l'overlay n'a pas cette table** : `Overlay.tsx:60-63` le dit — autre fenêtre, aucun plan média,
   `PEER_LEVELS` vide, donc `unknown` (vrai). Aucun flux à 1 Hz ne traverse aujourd'hui un
   `peerSpeaking` : `grep -rn "speaking-set" src/` = **0** consommateur.

**Donc `SPEAKING_STALE_MS` reste à 250 ms.** Le monter à 1000 ms affaiblirait exactement ce qu'il
protège : un pair dont le plan média meurt resterait « en train de parler » une seconde de plus. Un
plancher haut n'achète pas l'anti-clignotement, il achète du faux-positif.

**Ce que la crainte de Banc devient, à la place : un interdit nommé.**

> **AC20-7r — le canal est en aval de la table, jamais en amont.**
> (a) `Overlay.tsx` ne fait **pas** passer `speaking[]` dans `PEER_LEVELS` puis dans `peerSpeaking` :
> à 250 ms, un garde-vie à 1 Hz clignote — c'est exactement le défaut prédit ;
> (b) l'expiration de sûreté de l'overlay est **≥ 2000 ms** et se mesure : dernier message à *t0*, halo
> encore `'true'` à *t0+2 s*, plus `'true'` à *t0+2,6 s* ;
> (c) le salon ne consomme pas `lan:speaking-set` : `Room.tsx` continue de lire `PEER_LEVELS`, sinon la
> ligne du salon hériterait de la cadence du canal ;
> (d) **un seul** producteur de `speaking[]`, dans le renderer principal.

Si un jour l'overlay est alimenté par un miroir local à 1 Hz, alors — et alors seulement — son plancher
est un **plancher par surface** (≥ 2000 ms), jamais la constante partagée.

---

## 4. AC-U6r — `data-muted` d'un pair

- Ligne `data-self="false"` : `data-muted` ∈ {`'unknown'`} — **jamais** `'true'`, **jamais** `'false'` —
  et le mot « Muet » n'est **jamais** rendu sur cette ligne (`mutedAttr`, `participant-state.ts:88` ;
  `flagsKnown === 'true'` est la seule porte).
- Ligne `data-self="true"` : valeur réelle, `'true'` / `'false'` légitimes.

Un `'false'` écrit pour un pair est un **faux-silence** : bloquant, pas avertissement.

---

## 5. AC20-3r — clignotement et budget, séparément

L'ancien AC20-3 était rouge par construction **deux fois** : il interdisait aussi la chute finale, et
son plafond de 12 messages ignorait la garde-vie (4 paires de transitions + ≈ 10 battements = 18).

- **Clignotement** — 10 s de parole entrecoupée de 4 pauses de 300–800 ms, compté sur les mutations de
  `data-speaking` d'une même ligne : **0 aller-retour** `'true' → ('false'|'unknown') → 'true'` dans la
  fenêtre ; **≤ 1** sortie de `'true'` par ligne (la chute finale), autorisée après dernière syllabe +
  600 ms.
- **Budget** — plafond arithmétique, mesuré sur la prise IPC et non sur le DOM :
  `messages ≤ 2 × paires_tenue/relâche + ⌈durée_s⌉`, soit **≤ 8 + 11 = 19** dans le pire cas du script
  (4 pauses toutes > 600 ms ; si les pauses sont ≤ 600 ms, aucune paire n'est émise et le plafond tombe
  à 11). L'esprit d'AD-20 D4 est tenu : **≤ 2 Hz moyen**, contre les 5 Hz refusés.
- **AC20-2 inchangé** (10 s de silence : ≤ 2 messages) : c'est le vrai garde-fou.

---

## 6. Ce que ça change pour chacun

- **Cadre — T22 (plan de diff), puis T23 A et B** : le plan s'écrit contre **AC20-4r** (ligne de soi
  comprise, cas `selfId === null`), **AC20-5r**, **AC20-7r** (a)(b)(c)(d). La **forme** de la fusion ne
  change pas : c'est l'ancre de mesure qui change, pas le rendu.
- **Banc — VERIF-024** : joue AC20-1, AC20-2, AC20-6, **AC20-3r / 4r / 5r / 7r**, et **AC-U6r**.
  Ignore AC20-3 / 4 / 5 d'AD-20 §6 : remplacés ici. `voice.ts:340` est whitelistée. `data-muted` d'un
  pair s'asserte `'unknown'`, pas `'false'`.
- **Carillon — étape B** : la tenue 600 ms reste **dans le producteur**, la péremption reste à 250 ms
  sur la table ; rien à déplacer dans le rendu, et le canal n'ajoute **aucune** péremption côté salon.

---

## 7. Journal

- **AD-21** — Quatre remplacements (AC20-3/4/5 d'AD-20 §6 + AC-U6 de SPEC-013), un **refus motivé**
  (le plancher 250 ms reste), un garde-fou nommé (aval/amont, AC20-7r). Zéro code, zéro fichier du
  dépôt touché : T22 n'est pas encore posé, l'arbre reste calme jusqu'à la fin de VERIF-023.
- À reporter dans AD-20 §6 à la prochaine révision : la mention « plancher de péremption 1000 ms » en
  D4 ne concerne **que** l'expiration de l'overlay, pas `SPEAKING_STALE_MS`.
