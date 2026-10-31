#!/bin/sh
# =============================================================================
# check-a11.sh — A11 : aucun TITRE de test ne clame « JAMAIS diffusé »
# -----------------------------------------------------------------------------
# Usage : ./check-a11.sh [RACINE]
#
# Contrôle (AD-24 §3) : 0 ligne de TITRE dans tests/voice-mesh.node.test.ts
#   motif visé : ^\s*(it|test)\(.*JAMAIS diffusé
#
# Piège mesuré, et c'est tout l'objet de ce script : la phrase « JAMAIS diffusé »
# SURVIT dans un commentaire (ligne 264 au 04:1xZ, qui explique l'ancien titre).
# Un `grep -c 'JAMAIS diffusé'` nu serait donc ROUGE pour la bonne raison… ou
# VERT pour la mauvaise selon le sens du contrôle : ici on exige 0 sur le TITRE
# et on accepte la prose. Le motif est donc ancré sur le début de ligne de code
# (`^\s*(it|test)\(`) et n'attrape pas les commentaires.
#
# Sortie : dernière ligne machine  CHECK_A11 RESULT=PASS|FAIL|SKIP
# Code de retour : 0 = PASS ou SKIP, 1 = FAIL
# =============================================================================

set -u

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DEFAULT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ROOT="${1:-$ROOT_DEFAULT}"
NOW=$(date -Is 2>/dev/null || date)
FILE="$ROOT/tests/voice-mesh.node.test.ts"
PHRASE='JAMAIS diffusé'
TITLE_RE='^[[:space:]]*(it|test)\(.*JAMAIS diffusé'

say() { printf '%s\n' "$*"; }

say "=== check-a11.sh — $NOW ==="
say "RACINE : $ROOT"

if [ ! -f "$FILE" ]; then
  say "tests/voice-mesh.node.test.ts absent : rien à contrôler."
  say "CHECK_A11 RESULT=SKIP reason=fichier-absent"
  exit 0
fi

TITLES=$(grep -nE "$TITLE_RE" "$FILE" 2>/dev/null || true)
NT=$(printf '%s\n' "$TITLES" | grep -c . || true)
NT=${NT:-0}
ALLN=$(grep -c "$PHRASE" "$FILE" 2>/dev/null || true)
ALLN=${ALLN:-0}
# « ailleurs » = phrase présente sur une ligne qui n'est PAS un titre de test.
# Le tri se fait sur le contenu de la ligne (pas sur une sortie déjà préfixée par
# `grep -n`, sinon l'ancre `^\s*(it|test)\(` ne mord plus et tout passe pour de la prose).
ELSEWHERE=$(awk -v p="$PHRASE" -v re="$TITLE_RE" 'index($0, p) > 0 && $0 !~ re {n++} END {print n+0}' "$FILE")

say "motif TITRE   : $TITLE_RE"
say "titres fautifs : $NT"
if [ "$NT" -gt 0 ]; then printf '%s\n' "$TITLES" | sed 's/^/  ! titre fautif : /'; fi
say "lignes contenant la phrase (toutes) : $ALLN  (dont hors titre : $ELSEWHERE)"
if [ "$ELSEWHERE" -gt 0 ]; then
  awk -v p="$PHRASE" -v re="$TITLE_RE" 'index($0, p) > 0 && $0 !~ re {printf "  ~ prose acceptée : %d:%s\n", NR, $0}' "$FILE"
fi

if [ "$NT" -eq 0 ]; then
  say "  [OK]   0 titre — la phrase ne subsiste qu'en prose (non comptée)"
  say "CHECK_A11 RESULT=PASS titres_fautifs=0 prose_acceptee=$ELSEWHERE"
  exit 0
fi
say "  [FAIL] $NT titre(s) de test clamant « JAMAIS diffusé »"
say "CHECK_A11 RESULT=FAIL titres_fautifs=$NT prose_acceptee=$ELSEWHERE"
exit 1
