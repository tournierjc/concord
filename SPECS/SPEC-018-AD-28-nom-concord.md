# SPEC-018 · AD-28 — Le produit s'appelle **Concord** (sans « e »)

**Date** : 2026-10-31 · **Rédacteur** : Régie (chef de flotte) · **Entrée** : arbitrage du propriétaire, 31/10.
**Statut** : décision. Elle tranche, elle ne propose pas.

---

## 1. Décision

Nom du produit : **Concord**. Pas « Concorde ». Le « e » ne revient nulle part : ni dans un titre de
fenêtre, ni dans un identifiant, ni dans un libellé d'overlay, ni dans un commentaire de code.

Le nom de **projet** reste `lan-voice` : `/work/lan-voice`, pipeline `lan-voice`, préfixes `SPEC-`,
`VERIF-`, `AD-`. Renommer le dossier ou le pipeline n'apporte rien et casserait les chemins
historiques des rapports. Deux noms, deux rôles : `lan-voice` = le chantier, `Concord` = le produit.

## 2. Ce que ça coûte maintenant, et ce que ça aurait coûté après

Rien à défaire : `grep -ri concord` sur le dépôt ne rend **aucune** occurrence du nom produit
aujourd'hui — seulement le mot français « concordance » dans `SPECS/SPEC-002-ergonomie.md:2574`,
qui ne bouge pas. Le nom actuel est **Desktop LAN**, présent à 12 endroits (§3).

La fenêtre est ouverte et elle est étroite : aucune fenêtre Electron n'a jamais tourné (exit 127,
libgobject absent), aucun paquet n'a été produit puis distribué, donc **aucun sha de livrable ne
contient encore l'ancien nom**, et **aucune donnée utilisateur n'existe à migrer**. Dès qu'un
installeur part chez quelqu'un, `appId` et le chemin `userData` deviennent un contrat : les changer
après oblige à un shim de migration, à un second dossier de réglages, à des salons mDNS devenus
invisibles entre anciennes et nouvelles versions. On paie maintenant, une fois.

**Conséquence assumée sur le mDNS** : le type de service passe de `_lanvoice._udp.local` à
`_concord._udp.local`. Une build d'avant et une build d'après ne se voient plus. Acceptable
aujourd'hui (personne n'a de build), inacceptable dans un mois — d'où le gel ici. `concord` fait
7 caractères, sous la limite de 15 d'un label RFC 6763 : c'est un type non enregistré, ce qui est
la norme pour un service local qui ne sort pas du LAN.

**Pas de migration, et c'est dit** : aucun shim pour reprendre `userData/Desktop LAN/settings.json`
vers `userData/Concord/settings.json`. Il n'y a pas de données à reprendre. Si un jour il y en a,
ce sera une AD, pas un ajout silencieux.

## 3. Carte de renommage (exacte, à appliquer telle quelle)

| Fichier | Ligne | Avant | Après |
|---|---|---|---|
| `package.json` | 2 | `"name": "desktop-lan"` | `"name": "concord"` |
| `package.json` | 3 | `"productName": "Desktop LAN"` | `"productName": "Concord"` |
| `package.json` | 40 | `"appId": "local.desktoplan.app"` | `"appId": "local.concord.app"` |
| `package.json` | 41 | `"productName": "Desktop LAN"` | `"productName": "Concord"` |
| `electron-builder.yml` | 1 | commentaire `— Desktop LAN` | `— Concord` |
| `electron-builder.yml` | 14 | `appId: local.desktoplan.app` | `appId: local.concord.app` |
| `electron-builder.yml` | 15 | `productName: Desktop LAN` | `productName: Concord` |
| `electron-builder.yml` | 54 | `Name: Desktop LAN` | `Name: Concord` |
| `electron-builder.yml` | 59 | `maintainers@desktoplan.local` | `maintainers@concord.local` |
| `electron-builder.yml` | 95 | `shortcutName: Desktop LAN` | `shortcutName: Concord` |
| `index.html` | 15 | `<title>Desktop LAN</title>` | `<title>Concord</title>` |
| `overlay.html` | 13 | `<title>Desktop LAN — overlay</title>` | `<title>Concord — overlay</title>` |
| `src/main/index.ts` | 192 | `title: 'Desktop LAN'` | `title: 'Concord'` |
| `src/main/discovery-bridge.ts` | 29-30 | `_lanvoice._udp.local`, `'lanvoice'` | `_concord._udp.local`, `'concord'` |
| `src/shell/ipc-contract.ts` | 132 | `_lanvoice._udp.local` | `_concord._udp.local` |
| `tests/room-discovery.node.test.ts` | 32 occurrences | `._lanvoice._udp.local` | `._concord._udp.local` |

Le test `room-discovery` doit rester vert **sans** qu'on touche à sa logique : seul le littéral du
type de service change. S'il casse ailleurs que sur ce littéral, c'est un vrai défaut, on s'arrête.
Les assertions qui comptent (dédoublonnage, tri, `roomId` sans le type dans le nom) doivent rendre
le même verdict avant et après.

## 4. Qui fait quoi

- **Cadre** : la carte §3, plus le relevé statique `userData`/`appId` (aucun `app.setName` dans
  `src/`, donc le chemin dérive de `productName` — à confirmer par lecture, pas par exécution).
- **Carillon** : le type mDNS `_concord` (2 fichiers `src/` + le test), et il dit si une quelconque
  annonce en dur traîne dans `dist/` ou dans un log.
- **Maquette** : libellés visibles — titre de fenêtre, overlay, écran d'accueil, aides. « Concord »
  est un nom propre : il ne se traduit pas, il ne s'accorde pas, il ne s'abrège pas en « Conc. ».
- **Banc** : après coup, `grep -rn concorde` doit rendre 0 hors ce document, et la suite doit être
  verte au même compte.

## 5. Ce que cette AD ne tranche pas

- Le domaine public, un éventuel dépôt npm, une icône, une baseline. Aucun n'est nécessaire pour
  un logiciel qui ne sort pas du LAN, et aucun ne doit être ajouté sans demande.
- La graphie dans les documents **déjà livrés** au propriétaire : on ne réécrit pas l'historique.
  Une pièce datée qui dit « Desktop LAN » reste datée et reste vraie à sa date ; à partir de cette
  AD, tout ce qui est écrit dit « Concord ».

## 6. Complément d'application (Régie, même jour)

Ma carte §3 comptait les 12 occurrences de la chaîne « Desktop LAN » et du slug `desktop-lan` de
`package.json`, mais **omettait six lignes de `electron-builder.yml`** qui portent le slug et qui
nomment les artefacts livrés : `artifactName` (l. 16, 77, 96), `executableName` (l. 58, 87) et
`StartupWMClass` (l. 57). Les laisser en `desktop-lan` aurait produit un paquet nommé
`desktop-lan-1.0.0-*.AppImage` sous `productName: Concord` : un renommage à moitié fait, et deux
noms pour un même logiciel dans la même release. Aucun script du dépôt ne dépendait de ces noms
(`grep` : 0 référence hors `VERIF/smoke-desktop.md` et `VERIF/measure-traffic.sh`, mis à jour).

- `artifactName` → `concord-${version}-…` (3 lignes) ; `executableName` → `concord` (2 lignes) ;
  `StartupWMClass` → `concord` (doit rester égal au nom de l'exécutable, sinon l'icône de barre des
  tâches se détache de la fenêtre).
- `maintainer` (l. 59) → `Concord <maintainers@concord.local>` : le titulaire de paquet n'est plus
  l'ancien nom du projet, et l'adresse reste locale (aucun domaine public, aucun compte).
- Conséquence assumée : le binaire installé s'appelle `concord` et les artefacts `concord-*`. Aucune
  version n'ayant jamais été distribuée, il n'y a pas de migration de nom à assurer.

Reste ouvert, hors de ma compétence : `package.json` déclare `"license": "MIT"` et
`electron-builder.yml` (l. 76) référence un fichier `LICENCE` qui **n'existe pas** — le premier
paquet AppImage échouera sur cette ligne. Il faut un texte de licence et un nom de titulaire ; je
n'en invente pas. À trancher par le propriétaire avant toute distribution, et avant tout passage du
dépôt en public.
