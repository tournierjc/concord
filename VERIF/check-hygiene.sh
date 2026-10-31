#!/bin/sh
# check-hygiene.sh — invariants d'hygiène du dépôt concord : ce qui est SUIVI
# ne doit jamais être un fragment de travail, une capture ou un journal, et ce
# qui est CITÉ par un rapport doit exister dans le dépôt.
#
# Motivation (2026-10-31, VERIF 032) : des fragments d'autotest (VERIF/.a.tmp,
# VERIF/.t1 … .t4, VERIF/.v.tmp) ont été crus committés. Ils étaient ignorés
# depuis le premier commit. Ce script rend la réponse mécanique au lieu de
# dépendre d'une lecture de `git status`.
#
# Usage : sh VERIF/check-hygiene.sh [chemin-du-depot]
#         (défaut : racine déduite de l'emplacement du script)
# Sortie : une ligne [OK]/[FAIL]/[INFO] par invariant, puis CHECK_HYGIENE RESULT=…
# Code retour : 0 si aucun FAIL, 1 sinon, 2 si le dépôt est introuvable.

set -u

SELF_DIR=$(dirname "$0")
REPO=${1:-$(cd "$SELF_DIR/.." 2>/dev/null && pwd)}

if [ -z "${REPO:-}" ] || [ ! -d "$REPO/.git" ]; then
    echo "ECHEC: dépôt git introuvable: ${REPO:-<vide>}" >&2
    echo "       usage: sh VERIF/check-hygiene.sh /chemin/vers/concord"
    exit 2
fi

G() { git -C "$REPO" "$@" 2>/dev/null; }

OK=0; BAD=0; INFO=0
ok()   { OK=$((OK + 1));   echo "  [OK] $1"; }
bad()  { BAD=$((BAD + 1)); echo "  [FAIL] $1"; }
info() { INFO=$((INFO + 1)); echo "  [INFO] $1"; }

# badlist PRÉFIXE LISTE : une ligne [FAIL] par élément, compteur exact.
# (une boucle `while` dans un pipe tourne dans un sous-shell et perdrait les
#  incrémentations : le total n'aurait compté que les blocs en échec)
badlist() {
    N=0
    for e in $2; do
        echo "  [FAIL] $1$e"
        N=$((N + 1))
    done
    BAD=$((BAD + N))
}

echo "== dépôt : $REPO"
echo "== HEAD   : $(G rev-parse --short HEAD || echo '(aucun commit)')"

# 1. Aucun fichier suivi ne doit être ignoré. C'est l'invariant exact : un
#    fragment ajouté avec `git add -f` (donc soustrait à .gitignore) tombe ici.
echo "== 1. fichiers suivis ET ignorés"
TRACKED_IGNORED=$(G ls-files -ci --exclude-standard | grep -vE '^VERIF/\.keep$')
if [ -z "$TRACKED_IGNORED" ]; then
    ok "aucun fichier suivi n'est ignoré"
else
    badlist "suivi mais ignoré: " "$TRACKED_IGNORED"
fi

# 2. Aucun chemin suivi ne doit ressembler à un fragment/capture/journal, même
#    si .gitignore a été contourné (règle absente, `-f`, motif cassé).
echo "== 2. chemins suivis ressemblant à des fragments"
SUSPECT=$(G ls-files | grep -E '^VERIF/[^/]*\.tmp$|^VERIF/\.t[0-9]|^VERIF/raw/|^\.verif-|/\.verif-|\.log$|\.meta$|^node_modules/|^release/')
if [ -z "$SUSPECT" ]; then
    ok "aucun fragment, capture, journal ni artefact de build dans l'index"
else
    badlist "fragment suivi: " "$SUSPECT"
fi

# 3. VERIF/ doit survivre à un clone : sans .keep, git n'archive pas le
#    répertoire et les scripts cités par les rapports disparaissent du clone.
echo "== 3. VERIF/ présent après clone"
if G ls-files --error-unmatch VERIF/.keep >/dev/null 2>&1; then
    ok "VERIF/.keep suivi (répertoire non vide dans un clone)"
else
    bad "VERIF/.keep absent de l'index : VERIF/ peut disparaître d'un clone"
fi

# 3bis. build/ est ignoré SAUF les ressources déclarées (icône applicative).
#       Toute autre chose versionnée sous build/ est un artefact de compilation.
echo "== 3bis. exceptions versionnées de build/"
BUILT=$(G ls-files build)
if [ -z "$BUILT" ]; then
    info "aucun fichier build/ suivi (icône non versionnée : clone sans icône applicative)"
else
    BADB=$(echo "$BUILT" | grep -vE '^build/icon\.(png|svg|ico|icns)$')
    if [ -z "$BADB" ]; then
        ok "$(echo "$BUILT" | wc -l | tr -d ' ') ressource(s) d'icône versionnée(s) sous build/, rien d'autre"
    else
        badlist "artefact de build suivi: " "$BADB"
    fi
fi

# 4. Tout script VERIF/*.sh cité par un rapport suivi doit être suivi. Un
#    rapport qui pointe vers un script absent du dépôt n'est pas rejouable.
echo "== 4. scripts cités par les rapports"
CITED=$(G grep -h -o -E 'VERIF/[A-Za-z0-9._-]+\.sh' -- 'VERIF/*.md' | sed 's/.*://' | sort -u)
if [ -z "$CITED" ]; then
    info "aucun script cité dans VERIF/*.md"
else
    MISSING=$(for s in $CITED; do G ls-files --error-unmatch "$s" >/dev/null 2>&1 || echo "$s"; done)
    if [ -z "$MISSING" ]; then
        ok "les $(echo "$CITED" | wc -l | tr -d ' ') scripts cités par les rapports sont suivis"
    else
        badlist "cité mais absent du dépôt: " "$MISSING"
    fi
fi

# 5. Inventaire (informatif) : ce qui est ignoré reste sur le disque, et c'est
#    voulu. On le compte pour que « capture absente du dépôt » soit un fait daté.
echo "== 5. inventaire des preuves locales (non versionnées, voulu)"
N_IGN=$(G status --ignored --porcelain | grep -c '^!!')
if [ -d "$REPO/VERIF/raw" ]; then
    info "$N_IGN entrées ignorées sur le disque ; VERIF/raw = $(du -sh "$REPO/VERIF/raw" | cut -f1)"
else
    info "$N_IGN entrées ignorées sur le disque ; VERIF/raw absent (captures régénérables)"
fi

if [ "$BAD" -eq 0 ]; then
    echo "CHECK_HYGIENE RESULT=PASS ok=$OK info=$INFO"
    exit 0
else
    echo "CHECK_HYGIENE RESULT=FAIL failures=$BAD ok=$OK info=$INFO"
    exit 1
fi
