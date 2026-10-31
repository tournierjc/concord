#!/bin/sh
# =============================================================================
# check-a9.sh — A9 : le port `Timers` du moteur a exactement deux gestes
# -----------------------------------------------------------------------------
# Usage : ./check-a9.sh [RACINE]
#
# Contrôle (AD-18 §6 quater, adossé AD-24 §3) : dans src/engine/timers.ts,
#   `export interface Timers` déclare exactement 2 membres — `once` et `cancel` —
#   et 0 occurrence de `now`.
# Pourquoi : le moteur n'a pas besoin de l'heure ; `now` est un besoin des sites
# de datation du main, pas du port. Un `now` qui apparaît dans le port du moteur
# est une horloge de lecture qui fuit dans la couche testable hors Electron.
#
# Sortie : dernière ligne machine  CHECK_A9 RESULT=PASS|FAIL|SKIP
# Code de retour : 0 = PASS ou SKIP, 1 = FAIL
# =============================================================================

set -u

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DEFAULT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ROOT="${1:-$ROOT_DEFAULT}"
NOW=$(date -Is 2>/dev/null || date)
FILE="$ROOT/src/engine/timers.ts"

say() { printf '%s\n' "$*"; }

say "=== check-a9.sh — $NOW ==="
say "RACINE : $ROOT"

if [ ! -f "$FILE" ]; then
  say "src/engine/timers.ts absent : rien à contrôler."
  say "CHECK_A9 RESULT=SKIP reason=fichier-absent"
  exit 0
fi

DECL=$(grep -c '^export interface Timers[[:space:]]*{' "$FILE" 2>/dev/null || true)
if [ "${DECL:-0}" -eq 0 ]; then
  say "aucune déclaration \`export interface Timers {\` : le contrôle n'a pas de cible."
  say "CHECK_A9 RESULT=FAIL reason=interface-Timers-absente (vue 0)"
  exit 1
fi
if [ "$DECL" -gt 1 ]; then
  say "déclarations \`export interface Timers\` : $DECL (attendu 1) — ambigu, FAIL."
  say "CHECK_A9 RESULT=FAIL reason=declarations-multiples=$DECL"
  exit 1
fi

BLOCK=$(awk '/^export interface Timers[[:space:]]*\{/ {f=1} f {print} f && /^\}/ {exit}' "$FILE")
if [ -z "$BLOCK" ]; then
  say "bloc d'interface non extrait (accolade fermante en colonne 0 introuvable)."
  say "CHECK_A9 RESULT=FAIL reason=bloc-non-extrait"
  exit 1
fi

say "--- bloc mesuré ---"
printf '%s\n' "$BLOCK" | sed 's/^/  | /'
say "--- fin du bloc ---"

MEMBERS=$(
  printf '%s\n' "$BLOCK" \
  | grep -vE '^[[:space:]]*(/\*|\*|//)' \
  | grep -vE '^export interface' \
  | grep -vE '^[[:space:]]*\}[[:space:]]*$' \
  | grep -vE '^[[:space:]]*$' \
  | sed -n 's/^[[:space:]]*\([A-Za-z_$][A-Za-z0-9_$]*\)[[:space:]]*[(:?<].*/\1/p'
)
N=$(printf '%s\n' "$MEMBERS" | grep -c . || true)
NAMES=$(printf '%s\n' "$MEMBERS" | grep . | sort | tr '\n' ' ' | sed 's/ *$//')
NOWCOUNT=$(printf '%s\n' "$BLOCK" | grep -cw 'now' 2>/dev/null || true)

say "membres déclarés : $N [$NAMES]"
say "occurrences de \`now\` dans le bloc : ${NOWCOUNT:-0}"

FAILS=0
if [ "$N" -ne 2 ]; then
  say "  [FAIL] membres=$N (attendu 2 : once, cancel)"
  FAILS=$((FAILS + 1))
fi
if [ "$NAMES" != "cancel once" ]; then
  say "  [FAIL] noms=[$NAMES] (attendu : cancel once)"
  FAILS=$((FAILS + 1))
fi
if [ "${NOWCOUNT:-0}" -ne 0 ]; then
  say "  [FAIL] \`now\` présent dans le port du moteur : ${NOWCOUNT} occurrence(s)"
  FAILS=$((FAILS + 1))
fi

if [ "$FAILS" -eq 0 ]; then
  say "  [OK]   port = {once, cancel}, 0 \`now\`"
  say "CHECK_A9 RESULT=PASS membres=2 noms=once,cancel now=0"
  exit 0
fi
say "CHECK_A9 RESULT=FAIL membres=$N noms=$(printf '%s' "$NAMES" | tr ' ' ',') now=${NOWCOUNT:-0}"
exit 1
