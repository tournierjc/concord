# SPEC-004 — Contraintes d'exécution du dépôt (arbitrage Régie)

Version : 1.0 — 2026-10-30 — Régie
Statut : **imposé** — s'applique à tous les livrables, sans exception.

## 1. Racine canonique

Tout le chantier vit dans **`/work/lan-voice`** : `SPECS/`, `src/`, `tests/`, `design/`, `VERIF/`.
`_shared/lan-voice/` n'est **plus** une source de vérité : on n'y écrit plus rien. Ce qui y traîne
encore est déplacé, pas recopié en double.

## 2. Ce que l'environnement permet réellement

| Élément | État mesuré (2026-10-30) |
|---|---|
| `node` | v22.23.4 |
| `npm` | 10.9.9 |
| `node_modules` | **absent** |
| `npm install` | indisponible (aucun registre joignable) |
| `node --test` sur un `.test.ts` | **fonctionne** (type-stripping natif) |

Conséquence : **aucun livrable ne dépend d'un paquet npm pour être vérifié.**
Electron, React et Vite restent l'architecture cible déclarée dans `package.json`, mais aucune
commande `npm run build` n'est exécutable ici.

## 3. Règles de code

1. TypeScript **erasable syntax** uniquement : pas d'`enum`, pas de `namespace`, pas de *parameter
   properties* (`constructor(private x)`). Types, interfaces, génériques : OK.
2. Imports relatifs **avec extension** : `import { frameRms } from '../src/engine/vad.ts'`.
3. `src/engine/**` est **pur** : aucun import de `electron`, `ws`, `node:net`, `node:dgram`,
   `node:http(s)`, aucun `fetch`, aucun accès `fs`, aucun timer interne. Le réseau vit ailleurs.
4. Un module pur = un fichier de test `tests/<sujet>.test.ts` exécutable seul.
5. Zéro URL distante dans le code livré (police, CDN, image, télémétrie) : le LAN est la seule sortie.

## 4. Règle de livraison (non négociable)

Toute livraison **se termine par la commande exacte qui la vérifie et sa sortie brute**
(`node --test …`, `sh VERIF/…`, `node design/…`). Une partie non compilable ici est déclarée
**NON VÉRIFIÉE**, avec la raison et la commande qui la vérifiera plus tard. Jamais de faux PASS :
un contrôle impossible à exécuter est un **SKIP motivé**.

## 5. Répartition

| Sujet | Équipier | Où |
|---|---|---|
| Ergonomie, tokens, i18n FR/EN | Maquette | `SPECS/SPEC-002`, `design/` |
| Moteur pur : VAD, gain, périphérique, salon | Carillon | `src/engine/`, `tests/` |
| Coquille Electron, overlay, réglages, IPC | Cadre | `src/main`, `src/preload`, `src/shell`, `src/renderer` |
| Scripts de vérification, verdict global | Banc | `VERIF/` |

## 6. Migration du 2026-10-30 23:52 (faite par Régie)

`_shared/lan-voice/` contenait des artefacts produits avant la correction de cadre. Ils ont été
**déplacés** dans `/work/lan-voice` (pas recopiés en double) :

| Depuis `_shared/lan-voice/` | Vers `/work/lan-voice/` | Auteur |
|---|---|---|
| `design/i18n.json` (26 876 o) | `design/i18n.json` | Maquette |
| `src/main/csp.ts`, `src/main/net-guard.ts` | `src/main/` | Cadre |
| `tests/ice-filter.test.ts` | `tests/` | Banc |
| `VERIF/measure-traffic.sh`, `VERIF/run-all.sh` | `VERIF/` | Banc |
| `electron-builder.yml`, `vite.config.ts`, `index.html`, `tsconfig.main.json` | racine | Cadre |

`_shared/lan-voice/` est désormais **gelé** : plus aucune écriture, plus aucune lecture comme source
de vérité. Le dossier n'est pas supprimé (il appartient à tous), il est **ignoré**.

**Cause de l'alerte Maquette (23:48)** : ce n'était pas une perte de données. `_shared/lan-voice/`
a reçu une ré-initialisation de squelette (`package.json`, `index.html`, `vite.config.ts`, `src/`),
et `SPECS/` y était vide **parce que JC avait déjà déplacé les SPECS vers `/work/lan-voice`**.
`SPEC-001-conception.md` n'a jamais disparu : il est à `/work/lan-voice/SPECS/`, 19 739 octets.

## 7. Nombres canoniques (figés — SPEC-001 fait foi)

| Paramètre | Valeur imposée | Source |
|---|---|---|
| Port balayage UDP broadcast | **47820** | SPEC-001 A4 |
| Port WebSocket de signalisation | **47821**, incrément jusqu'à **47830** si pris ; port réel publié dans le beacon | SPEC-001 A5 |
| Service mDNS | **`_lanvoice._udp.local`** | SPEC-001 A4 |
| Plafond participants | **8** en maillage (7 pairs sortants/nœud) ; le **9ᵉ est refusé avec message UI** | SPEC-001 A2 |
| Raccourci PTT par défaut | **`Alt+Space`** — *et non `Ctrl+Alt+Espace`* — configurable, conflit signalé dans l'UI | SPEC-001 A11 |
| Avatar d'overlay | **28 px**, halo 2 px, animation 80 ms | SPEC-001 §overlay |
| Codec | **Opus 48 kHz mono, 32 kbps** | SPEC-001 |
| Verdict réseau | seuls les candidats ICE d'hôte RFC1918 / link-local / loopback sont conservés | SPEC-001 CA7 / B3 |

Tout livrable qui s'écarte de ce tableau est **faux**, même s'il est cohérent avec lui-même.

## 8. Limite d'exécution côté Régie (à savoir)

Régie a **l'écriture** sur `/work/lan-voice` (migration ci-dessus effectuée), mais l'**exécution**
(`node`, `sh`) y est refusée par le garde-fou en mode non surveillé. Les commandes de vérification
sont donc **exécutées par Carillon, Cadre et Banc**, et leur sortie brute est la seule preuve
acceptée. Régie juge sur pièces : sortie collée + fichier livré.
