# SPEC-017 · AD-27 — Clôture de T23 étape A, périmètre de l'étape B

**Date** : 2026-10-31 · **Rédacteur** : Régie (chef de flotte) · **Entrée** : VERIF-024 (Banc, 03:56Z),
VERIF-028 addendum B (Banc).
**Statut** : décision. Elle tranche, elle ne propose pas.

---

## 1. Décision : l'étape A de T23 est CLOSE

Verdict VERIF-024 : **PASS sur ce qui est mesuré**, réserve unique et nommée (pas de fenêtre Electron).

| Acquis | Chiffre | Portée réelle |
|---|---|---|
| ACo-16 compteur de rendus | 0 rendu / 3 garde-vie à 1 Hz / 3 007 ms ; jumeau défectueux ⇒ 3 rendus ⇒ **REJET** | **EXÉCUTÉ** sur le module d'entrée réel, dans jsdom 26 — **pas** dans Electron |
| ACo-9 F1 échéancier | extinction 2 007 ms (document) / 2 000 ms (module), budget 2 016 ms | armé à l'arrivée, pas de balayage |
| ACo-8 | 0 minuteur survivant au démontage | modules + document |
| Suite | 639/639, fail 0, skipped 0, exit 0 (+9 / baseline 630) | aucune régression |
| Gel | 9/9 empreintes identiques avant **et** après (diff rc=0) | le protocole d'arrêt n'a pas eu à se déclencher |
| Hors-LAN sur les fichiers T23 | 0 hit URL/fetch/XHR/WS/beacon/dns/télémétrie, 0 `Math.random` | surface d'appel réseau **vide** |

**Trois lignes tenues, donc je clôture** : rien n'est sorti du LAN, aucun compte/identifiant serveur,
et ce qui n'est pas mesuré est écrit « non mesuré » dans le rapport (§6, huit points nommés).

Ce qui n'est **pas** clos, et que je ne maquille pas en vert : ACo-9 et ACo-8 sont PASS **au niveau
modules + document** ; aucun aller-retour IPC renderer → main → overlay n'a été exécuté, aucune
composition Chromium observée. Le champ `portee` du journal ACo-8 le dit ; AD-27 le reprend.

## 2. Deux errata au canon, adoptés sans attendre

**E-R10 (formulation fautive, pas de code).** R10 dit « compte les RENDUS (MutationObserver) ». Mesure
de Banc : sur le jumeau défectueux, 3 rendus et **0** mutation — un re-rendu à DOM identique est
invisible pour MutationObserver. Donc R10 tel qu'écrit ne peut pas voir le défaut qu'il décrit.
→ **R10 devient** : « compte les rendus par **commits React** (`onCommitFiberRoot`) ; le MutationObserver
est un instrument **secondaire, non suffisant** ». Journal ACo-16 : les deux champs obligatoires,
`rendus_overlay` = commits. Applicable dès la prochaine rév. de SPEC-015 ; en attendant, c'est la règle.

**E-LABEL (défaut d'affichage, à corriger, pas à contourner).** `check-aco-016.sh` en mode état imprime
`raison=arbre-non-gele` alors que l'arbre est gelé. Libellé trompeur, sans effet sur le verdict (qui vient
du journal validé), mais **interdit de citation par un tiers** tant qu'il n'est pas corrigé. Porteur :
Banc, à son déblocage (budget quotidien épuisé au moment de cette décision). Reste **ouvert et nommé**.

## 3. Étape B : un trou réel, mais seul un tiers du trou est du code

La fiche « étape B » que je portais mêlait trois natures de travail. Elles n'ont ni le même porteur ni
la même valeur de preuve. Je les sépare.

**Classe A — vérifiable ici, maintenant, sans Electron.** Cadre rend `OverlayController`
(`src/main/overlay-controller.ts`) testable par **injection** : port écran (`getCursorScreenPoint`,
`getBounds`), fabrique de fenêtre, port d'horloge déjà présent. Puis on **mesure** au lieu de lire :
click-through bascule exactement aux frontières de `hitTest`, **dédoublonnage** (`lastIgnore`) ⇒ aucun
appel redondant à `setIgnoreMouseEvents` sur un balayage de positions, `showInactive` jamais `show`,
niveau `screen-saver` + `setVisibleOnAllWorkspaces` appliqués une fois, `focusable:false` /
`acceptFirstMouse:false` présents dans les options, glisser la poignée ⇒ `setPosition` ⇒ `setBounds`
borné par `computeOverlayGeometry`, et **pas de scrutation orpheline** après `destroy()`.
Le commentaire d'en-tête « NON VÉRIFIÉ unitairement » doit disparaître — ou rester avec un chiffre qui
le justifie.

**Classe B — statique, honnête, aujourd'hui.** Configuration de packaging (`electron-builder` / cibles),
`no-auto-update`, aucune URL de mise à jour, aucun identifiant de build. Preuve = fichier + ligne lus,
pas un « ça devrait ».

**Classe C — BLOQUÉE PAR L'ENVIRONNEMENT, et le dire ainsi.** Fenêtre Electron réelle, composition GPU,
halo **peint**, plafond 10 **à l'œil**, aller-retour IPC chronométré, exécution d'un paquet produit.
`electron --version` ⇒ **exit 127** (`libgobject-2.0.so.0` absent, `ldconfig -p | grep gobject` = 0,
aucun X). Ce n'est la faute d'aucun équipier : c'est le bac à sable. Ce qui reste à faire de mon côté
est de **livrer la procédure exacte** que JC exécute sur une vraie machine de bureau, courte et sans
ambiguïté, et de refuser de compter ces points comme rendus d'ici là.

## 4. Distribution

| Qui | Quoi | « Fini » veut dire |
|---|---|---|
| Cadre (desk-shell) | Classe A : injection + tests ; Classe B : relevé statique du packaging ; script de fumée `VERIF/smoke-desktop.md` pour la Classe C | tests ajoutés au vert sur la suite complète, aucun sha de la surface gelée T23 modifié, script de fumée exécutable tel quel par JC |
| Banc (desk-qa) | au déblocage : E-LABEL, puis VERIF de l'étape B (relance étroite, mêmes instruments) | libellé corrigé + rapport daté qui cite les chiffres de Cadre ou les contredit |
| Maquette (desk-design) | rien pour l'instant | le halo peint relève de la Classe C ; pas de planche à produire avant qu'on puisse la regarder |

**Périmètre d'écriture de l'étape B** (gel T23 levé pour ces seuls fichiers) :
`src/main/overlay-controller.ts`, `tests/overlay-controller.test.ts` (nouveau), `VERIF/smoke-desktop.md`
(nouveau), `package.json` **uniquement** si une cible de packaging manque — et alors le dire.
Tout le reste de l'arbre reste gelé ; si Cadre a besoin d'un autre fichier, il me le demande **avant**.

## 5. Ce que je refuse

- Compter « Electron absent » comme un PASS ou comme un échec : c'est **non exécuté**, un point c'est tout.
- Écrire un plan de diff, un rapport de plan, ou une mesure « prévue » : on mesure ou on se taît.
- Présenter l'overlay comme fini : le halo n'a **jamais** été vu peint. Cette phrase reste dans tout
  point d'étape jusqu'à ce qu'une machine de bureau la contredise.
