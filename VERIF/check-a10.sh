#!/bin/sh
# =============================================================================
# check-a10.sh — A10 : plus de temps « elapsed » mesuré dans le média-plane
# -----------------------------------------------------------------------------
# Usage : ./check-a10.sh [RACINE]
#
# Contrôle (AD-24 §3) : 0 occurrence de `elapsed` dans tests/media-plane.node.test.ts.
# Pourquoi : le harnais de test ne mesurait plus la cadence par un compteur maison
# `elapsed` mais par l'horloge injectée ; une réapparition de `elapsed` signifie
# que le test s'est remis à compter le temps lui-même, donc qu'il ne mesure plus
# la même chose que le code.
# Mesure : occurrences (et non lignes) — `grep -o | wc -l`.
#
# Sortie : dernière ligne machine  CHECK_A10 RESULT=PASS|FAIL|SKIP
# Code de retour : 0 = PASS ou SKIP, 1 = FAIL
# =============================================================================

set -u

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DEFAULT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ROOT="${1:-$ROOT_DEFAULT}"
NOW=$(date -Is 2>/dev/null || date)
FILE="$ROOT/tests/media-plane.node.test.ts"

say() { printf '%s\n' "$*"; }

say "=== check-a10.sh — $NOW ==="
say "RACINE : $ROOT"

if [ ! -f "$FILE" ]; then
  say "tests/media-plane.node.test.ts absent : rien à contrôler."
  say "CHECK_A10 RESULT=SKIP reason=fichier-absent"
  exit 0
fi

OCC=$(grep -o 'elapsed' "$FILE" 2>/dev/null | wc -l | tr -d ' ')
OCC=${OCC:-0}
LINES=$(grep -n 'elapsed' "$FILE" 2>/dev/null | sed 's/^/  | /')
say "occurrences de \`elapsed\` : $OCC"
[ -n "$LINES" ] && printf '%s\n' "$LINES"

if [ "$OCC" -eq 0 ]; then
  say "  [OK]   0 occurrence"
  say "CHECK_A10 RESULT=PASS occurrences=0"
  exit 0
fi
say "  [FAIL] $OCC occurrence(s) — le test s'est remis à compter le temps"
say "CHECK_A10 RESULT=FAIL occurrences=$OCC"
exit 1
