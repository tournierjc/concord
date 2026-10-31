# VERIF-005 — DELTA (pas une réécriture) : DEF 1 passe de statique à **exécuté**

**Banc (desk-qa) — 2026-10-31T01:05Z.** Canon `/work/lan-voice`.
Portée : **un seul point** de VERIF-005. Les verdicts statiques **1 à 5** de
VERIF-005 restent acquis tels quels — ils ne sont ni re-mesurés, ni réécrits ici.

## Ce que je corrige dans mon propre rapport

Dans VERIF-005 j'ai conclu la moitié runtime du contrôle T7 2/2 (découverte des
salons) comme **non mesurée**, motif : `node`/`npx`/`npm` refusés « requires
approval ». C'était une erreur d'attribution : dans le même cycle,
`npx tsx --test` a exécuté la suite entière sans blocage. Le refus était **par
run**, pas par outil. Conséquence : le câblage était prouvé par lecture, pas par
exécution — c'est exactement le trou relevé par Régie à 23:31Z.

## DEF 1 — verdict exécutable

| Élément | Valeur mesurée |
|---|---|
| Défaut | `roomName` non filtré : CR/LF conservés, traversant `guard.string` d'`ipc-contract` (longueur seule) jusqu'à `App.tsx:323` |
| Correction | `src/engine/net/room-discovery.ts`, `normalizeLabel` : toute suite de blancs / contrôles → une espace, avant troncature. **Auteur : Carillon** (propriétaire de `src/engine`) ; je n'ai pas touché à ce fichier |
| Commande | `cd /work/lan-voice && npx tsx --test tests/room-discovery-sec.node.test.ts` |
| Horodatage | `2026-10-31T01:04:35Z` (run ciblé) / `01:05:37Z` (run groupé 13 fichiers) |
| Compte | `# tests 4`, `# pass 4`, `# fail 0`, `# skipped 0` |
| **EXIT** | **0** (pas de pipe : redirection vers fichier, `echo $?` immédiat) |
| Cas ciblé | `npx tsx --test --test-name-pattern="DEF-1" tests/room-discovery-sec.node.test.ts` → `# tests 2`, `# pass 2`, `# fail 0`, **EXIT=0**, `01:04:35Z` |
| Statut du cas | l'ex-`skip` est **actif** : c'est une garde anti-régression, pas une note de dette |

Ce que le cas vérifie à l'exécution (pas par lecture) :

- nom hostile « salon » + CR + LF + « X » via `txt.roomName` (qui a la priorité
  sur le nom d'annonce) → `roomName` rendu = « salon X » ;
- aucun caractère de contrôle ne subsiste (U+0000 à U+001F, U+007F) ;
- `host` / `port` / `roomId` restent ceux de l'annonce réelle, le nom n'y
  injecte rien ;
- contrôle négatif associé : le même nom ne blanchit pas un hôte public, et un
  hôte porteur de CR/LF est refusé.

## Ce que ce delta ne prouve pas

Le nom normalisé **affiché par l'UI** (`App.tsx`) n'est pas vérifié par
exécution : pas de runtime Electron dans ce run. La chaîne
`ipc-contract → renderer` reste couverte **statiquement** (verdict 4 de
VERIF-005). Point nommé comme non vérifié, pas contourné.

## Rappel d'arbitrage, pour éviter la confusion

`tsc --noEmit` et `tsx --test` sont deux objets : le vert de la suite (378/378,
exit=0, `01:05:37Z`) ne ferme aucune dette de typage, et `tsc EXIT=0`
(`01:05:24Z`, VERIF-006) ne prouve aucun test vert. Les deux chiffres restent
séparés dans mes rapports.
