# VERIF 032 — Hygiène du dépôt : les 7 fragments d'autotest n'ont **jamais** été suivis, et c'est désormais mécanique

Date de la campagne : **2026-10-31**, mesures entre **15:24Z et 15:33:02Z** (UTC).
Dépôt : `/work/lan-voice`, HEAD **`03e6205`** (« VERIF 030 … VERIF 031 … versionnees »), arbre de travail
avec `M .gitignore` (pas de moi) et `?? build/`.
Question posée par desk-shell : « à HEAD, tes fixtures d'autotest sont *committées* dans `VERIF/`
(`.a.tmp`, `.b.tmp`, `.t1`…`.t4`, `.v.tmp`) — supprime-les (`git rm`) ou dis-moi que je le fais, mais un
seul de nous deux ».

**Réponse : il n'y avait rien à committer ni à supprimer du dépôt. Ces 7 fichiers n'ont jamais été dans
l'index, à aucun commit.** Ils étaient ignorés depuis le premier commit. Je les ai quand même retirés de
l'arbre de travail (c'étaient mes brouillons) et j'ai ajouté un script qui tranche la question sans
lecture humaine : `VERIF/check-hygiene.sh`.

---

## 1. Preuves : jamais suivis, à aucun commit

| Preuve | Commande exacte | Résultat mesuré (2026-10-31 15:24–15:33Z) |
|---|---|---|
| Contenu de l'index à HEAD sous `VERIF/` commençant par un point | `git ls-tree -r HEAD --name-only VERIF \| grep -E '^VERIF/\.'` | **`VERIF/.keep`** — 1 seul fichier (`-c` = 1) |
| Ces noms ont-ils déjà été ajoutés dans *un* commit, toutes branches ? | `git log --all --diff-filter=A --name-only --pretty=format: \| grep -E '\.(a\|b\|v)\.tmp$\|\.t[0-9]$' \| sort -u \| wc -l` | **0** |
| Sont-ils ignorés, et par quelle règle ? | `git check-ignore -v VERIF/.a.tmp VERIF/.b.tmp VERIF/.t1 VERIF/.t2 VERIF/.t3 VERIF/.t4 VERIF/.v.tmp` | `.gitignore:33:VERIF/.*.tmp` (`.a.tmp`, `.b.tmp`, `.v.tmp`) et `.gitignore:34:VERIF/.t[0-9]*` (`.t1`…`.t4`) |
| Ces règles existaient-elles dès le premier commit ? | `git show ba47de5:.gitignore \| sed -n '25,28p'` | oui : `VERIF/*.tmp`, `VERIF/.*.tmp`, `VERIF/.t[0-9]*` (l. 27-28 à `ba47de5`, l. 33-34 après l'ajout de 6 lignes au `.gitignore` par un autre poste, non commité) |
| Un fichier **suivi** est-il ignoré (l'invariant exact) ? | `git ls-files -ci --exclude-standard` | **vide** |
| Apparaissent-ils dans `git status` ? | `git status --short` puis `git status --short --ignored VERIF` | absents du premier ; présents en `!!` (ignorés) dans le second |

Cause probable de l'écart : `ls -a VERIF` (ou `git status --ignored`) montre les 7 fichiers sur le disque,
et `git add -A` ne les aurait pas pris — un `??` ne peut pas apparaître pour un fichier ignoré. Le doute
venait d'une lecture de disque, pas de l'index. C'est précisément ce que le §1 du nouveau script calcule.

## 2. Ce que j'ai fait dans l'arbre de travail

`rm -f VERIF/.a.tmp VERIF/.b.tmp VERIF/.t1 VERIF/.t2 VERIF/.t3 VERIF/.t4 VERIF/.v.tmp` → `rc=0`,
**4 947 octets** au total (723 / 321 / 123 / 63 / 92 / 69 / 3 556). Après : `ls -a VERIF` → `.`, `..`,
`.keep`. **Pas de `git rm`** : `git rm` sur des fichiers non suivis échoue (`did not match any files`),
et il n'y avait rien à retirer de l'index. L'index est donc inchangé par cette suppression.

Aucun de ces fragments n'était cité : `grep -rnE '\.(a|b|v)\.tmp|VERIF/\.t[0-9]' --include='*.sh'
--include='*.md' --include='*.js' --include='*.mjs' --include='*.py' VERIF docs` (hors `VERIF/raw/`) →
**0 ligne**. Les supprimer ne rend aucun rapport non rejouable.

## 3. Garde-fou : `VERIF/check-hygiene.sh`

`sha256 8a80904abf27ff805eb56fd13dc00c1389bf880ba7375a9fc396267efa0bca8c`, **124 lignes**, indexé `A`
(ajouté à l'index, **non commité** — à toi de committer, aucun conflit avec mes autres fichiers).
Usage : `sh VERIF/check-hygiene.sh [chemin-du-depot]` (défaut : racine déduite de `dirname $0/..`).

| § | Invariant | Forme du contrôle |
|---|---|---|
| 1 | aucun fichier **suivi** n'est **ignoré** | `git ls-files -ci --exclude-standard` (attrape aussi le `git add -f`) |
| 2 | aucun chemin suivi ne ressemble à un fragment / capture / journal / artefact | motifs `VERIF/*.tmp`, `VERIF/.t[0-9]`, `VERIF/raw/`, `.verif-*`, `*.log`, `*.meta`, `node_modules/`, `release/` |
| 3 | `VERIF/` survit à un clone | `VERIF/.keep` présent dans l'index |
| 3bis | sous `build/`, **seules** les ressources d'icône sont versionnées | tout fichier `build/` suivi hors `icon.{png,svg,ico,icns}` = FAIL (garde la nouvelle exception du `.gitignore`) |
| 4 | tout `VERIF/*.sh` cité par un `VERIF/*.md` suivi **est** suivi | `git grep -h -o` + `ls-files --error-unmatch` |
| 5 | inventaire informatif des preuves locales | nombre d'entrées `!!` + taille de `VERIF/raw` |

Exécution sur le dépôt, **2026-10-31T15:33:02Z** :

```
$ sh VERIF/check-hygiene.sh            # HEAD 03e6205
  [OK] aucun fichier suivi n'est ignoré
  [OK] aucun fragment, capture, journal ni artefact de build dans l'index
  [OK] VERIF/.keep suivi (répertoire non vide dans un clone)
  [INFO] aucun fichier build/ suivi (icône non versionnée : clone sans icône applicative)
  [OK] les 14 scripts cités par les rapports sont suivis
  [INFO] 23 entrées ignorées sur le disque ; VERIF/raw = 61M
CHECK_HYGIENE RESULT=PASS ok=4 info=2          # rc=0
```

« 14 scripts » = ceux des rapports **suivis** à cet instant : ce rapport-ci n'était pas encore indexé
(`git grep` ne lit pas les fichiers non suivis). Rejoué à `15:33:41Z` avec le rapport **indexé** :
`[OK] les 15 scripts cités par les rapports sont suivis`, toujours `PASS ok=4 info=2` — le compteur suit
l'index, pas une constante (cf. §4, où il est aussi passé à FAIL sur ma propre prose).

Lancé **depuis `VERIF/` sans argument** : dépôt résolu (`/work/lan-voice`), même verdict `PASS`.
Sur un chemin sans `.git` : `ECHEC: dépôt git introuvable` + usage, **rc=2** (pas de faux PASS).

## 4. Autotests sur fixtures construites hors du dépôt (sandbox)

Trois dépôts git synthétiques, dans `/home/node/.mercury/bots/desk-lead/desk-qa/sandbox/fx/` :

| Fixture | Contenu | Attendu | Mesuré |
|---|---|---|---|
| **A** | `.keep` suivi ; `.t1`, `.a.tmp`, `run.log` ajoutés avec `git add -f` ; `VERIF/r.md` citant un script absent (contenu littéral : `voir <VERIF>/nope.sh`) | 3 + 3 + 1 FAIL | `CHECK_HYGIENE RESULT=FAIL failures=7 ok=1 info=2`, **rc=1** |
| **B** | `VERIF/x.md` suivi, **pas** de `.keep` | 1 FAIL | `FAIL failures=1 ok=2 info=3`, **rc=1** |
| **C** | `build/icon.png` suivi (exception légitime) + `build/main.js` ajouté de force | 1 FAIL (§1) + 1 FAIL (§3bis), `icon.png` **non** signalé | `FAIL failures=2 ok=2 info=2`, **rc=1** |

Un `FAIL` ne peut donc pas être silencieux et une exception légitime ne produit pas de faux rouge.

**Le garde-fou a attrapé ma propre prose** : la première version de ce rapport décrivait la fixture A en
citant littéralement `<VERIF>/nope.sh` dans son tableau ; à l'instant où le rapport a été indexé, le §4
est passé à `FAIL failures=1` (« cité mais absent du dépôt : …/nope.sh »). C'est exactement le
comportement voulu — la citation a été reformulée, pas la règle.

## 5. Trois défauts de mon propre script, trouvés et corrigés avant livraison

1. Les boucles `… | while read` comptaient dans un sous-shell : 6 lignes `[FAIL]` affichées, compteur à
   `failures=2` (fixture A, 15:31Z). Remplacé par `badlist`, qui imprime et compte dans le shell courant.
2. `badlist` appelait `bad()` (qui incrémente) **puis** ajoutait `N` : double comptage, `failures=12`
   pour 6 réels (fixture C, 15:32Z). Corrigé (`badlist` imprime directement).
3. Une édition par recherche/remplacement a scindé la ligne du filtre `build/icon.*` : fichier
   syntaxiquement valide mais logiquement démembré (`sh -n` disait OK). Détecté en relisant le fichier,
   pas par le test — d'où la réécriture complète et la ré-exécution des 3 fixtures + du dépôt.

## 6. Signaux pour l'arbre courant (à ta main, pas la mienne)

- `.gitignore` est **modifié et non commité** : `build/` → `build/*` + `!build/icon.png`, `!build/icon.svg`,
  `!build/icon.ico`/`icns` (commentaire 3 lignes). Et `?? build/` : l'icône existe sur le disque mais
  **n'est pas indexée** → à HEAD, un clone ne peut pas rebâtir avec la bonne icône. Le §3bis passera en
  `[OK]` dès qu'elle sera committée ; aujourd'hui il est `[INFO]`, ce qui est exact.
- `VERIF/check-hygiene.sh` est **indexé mais non commité** : c'est le seul ajout qui m'appartient dans
  l'index. `git status --short` = ` M .gitignore` / `A  VERIF/check-hygiene.sh` / `?? build/`.

## 7. Non vérifié, nommé

- Clone depuis `github.com/tournierjc/concord` (privé) : tout est mesuré en local.
- Comportement du script sur un dépôt Windows (fins de ligne CRLF dans `.gitignore`, `du -sh` absent).
- `badlist` découpe sur les blancs : un chemin **suivi** contenant une espace serait affiché en morceaux
  (le comptage resterait non nul, donc le FAIL reste visible). Aucun cas dans ce dépôt ; non corrigé, assumé.
- Les mesures REF 030/031 (AppImage, `npm ci`) ne sont pas rejouées ici : aucune n'est affectée par ce
  patch, qui ne touche ni `package.json`, ni `electron-builder.yml`, ni le code.
