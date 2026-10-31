#!/bin/sh
# =============================================================================
# check-a8-timers.sh — A8 *comportemental* : confinement de l'horloge ambiante
# -----------------------------------------------------------------------------
# Usage : ./check-a8-timers.sh [RACINE]
#
# Pourquoi ce contrôle n'est plus un grep (AD-24 §4) :
#   A8 historique — `grep -rnE "^[^*/]*(unref\(|clearTimeout\(|clearInterval\()" src/`
#   — apparie du TEXTE. Mesuré sur copies isolées (VERIF-024, table de variants) :
#     * aveugle à l'alias        `const ct = clearTimeout; ct(h)`
#     * aveugle à l'accès calculé `globalThis['clearTimeout'](h)`
#     * aveugle au chaînage optionnel `globalThis.clearTimeout?.(h)`
#     * FAUX POSITIF sur un littéral dans une chaîne (`void 'clearTimeout('`)
#   A8 comportemental lit l'arbre syntaxique (typescript, déjà dans node_modules)
#   et relève les *références* à setTimeout/setInterval/setImmediate/clearTimeout/
#   clearInterval/unref : identifiant nu, accès membre, accès calculé par littéral,
#   alias, liaison déstructurée. Commentaires et chaînes ordinaires ne comptent pas.
#   Portes autorisées (les deux seules) : src/main/timers.ts, src/renderer/browser-timers.ts.
#
# Sortie : dernière ligne machine  CHECK_A8 RESULT=PASS|FAIL|SKIP
# Code de retour : 0 = PASS ou SKIP, 1 = FAIL
# =============================================================================

set -u

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DEFAULT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ROOT="${1:-$ROOT_DEFAULT}"
NOW=$(date -Is 2>/dev/null || date)
GATES="src/main/timers.ts src/renderer/browser-timers.ts"

say() { printf '%s\n' "$*"; }

say "=== check-a8-timers.sh — $NOW ==="
say "RACINE : $ROOT"

if [ ! -d "$ROOT/src" ]; then
  say "src/ absent : rien à contrôler."
  say "CHECK_A8 RESULT=SKIP reason=src-absent"
  exit 0
fi
if ! command -v node >/dev/null 2>&1; then
  say "node absent : analyse AST impossible. Un SKIP n'est pas un succès."
  say "CHECK_A8 RESULT=SKIP reason=node-absent"
  exit 0
fi
if [ ! -f "$ROOT/node_modules/typescript/lib/typescript.js" ]; then
  say "node_modules/typescript absent : analyse AST impossible."
  say "CHECK_A8 RESULT=SKIP reason=typescript-absent"
  exit 0
fi

say "portes autorisées : $GATES"
say ""
OUT=$(node "$SCRIPT_DIR/a8-confinement.mjs" "$ROOT" 2>&1)
RC=$?
printf '%s\n' "$OUT"
if [ "$RC" -ne 0 ]; then
  say "CHECK_A8 RESULT=FAIL reason=harnais-en-erreur rc=$RC (voir ci-dessus)"
  exit 1
fi
LAST=$(printf '%s\n' "$OUT" | grep '^CHECK_A8' | tail -1)
case "$LAST" in
  *RESULT=PASS*) exit 0 ;;
  *) exit 1 ;;
esac
