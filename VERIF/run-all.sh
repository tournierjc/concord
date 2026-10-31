#!/bin/sh
# =============================================================================
# run-all.sh — agrégateur des contrôles LAN-voice
# -----------------------------------------------------------------------------
# Enchaîne, sans aucune dépendance npm :
#   check-deps.sh        CA16/A16  zéro télémétrie, pas d'auto-update
#   check-no-external.sh CA4/5/20  « LAN only » statique (aucune URL hors LAN)
#   check-engine.sh      pureté de src/engine (ni E/S, ni réseau, ni timer)
#   check-shell.sh       sûreté de la coquille Electron
#   check-labels.sh      parité FR/EN de design/i18n
#   check-a8-timers.sh   A8 comportemental (AD-24 §4) : horloge ambiante confinée
#                        aux deux portes — analyse AST, pas de grep de texte
#   check-a9.sh          A9 : port `Timers` du moteur = {once, cancel}, 0 `now`
#   check-a10.sh         A10 : 0 `elapsed` dans tests/media-plane.node.test.ts
#   check-a11.sh         A11 : 0 TITRE de test « JAMAIS diffusé » (prose admise)
#   tests                chaque tests/*.test.ts via `node --test`, FICHIER PAR
#                        FICHIER : un test qui ne peut pas être chargé (paquet
#                        absent) ne doit pas masquer les autres.
#
# Chaque contrôle écrit son journal complet dans
#   VERIF/raw/run-<horodatage>/<contrôle>.log
# et laisse une ligne machine CHECK_<NOM> RESULT=PASS|FAIL|SKIP.
#
# REGLES DE VERDICT
#   PASS = contrôlé et conforme.  FAIL = contrôlé et non conforme.
#   SKIP = NON contrôlé (cible absente, outil absent, dépendance manquante) :
#          un SKIP n'est JAMAIS un succès ; il est compté et listé à part.
#   Verdict global = FAIL si au moins un FAIL, sinon PASS ; les SKIP restent
#   visibles sur la ligne de verdict et dans « points non vérifiés ».
#
# Usage : ./run-all.sh [-q]           (exécutable depuis n'importe quel cwd)
#           -q  n'affiche pas les lignes de journal (les RESULT restent)
# Sortie machine : une ligne RESULT <verdict> <contrôle>, une ligne CHECK_* par
#   contrôle, et la dernière ligne LAN-VOICE VERIF RESULT=PASS|FAIL
# Code de sortie : 0 si PASS, 1 si FAIL, 2 si l'agrégateur lui-même échoue.
# =============================================================================

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 2
ROOT=$(CDPATH= cd -- "$HERE/.." && pwd) || exit 2
QUIET=0
for a in "$@"; do
  case "$a" in
    -q) QUIET=1 ;;
    -h|--help) sed -n '2,34p' "$0"; exit 0 ;;
  esac
done

NOW=$(date -Is 2>/dev/null || date)
STAMP=$(date +%Y%m%dT%H%M%S)
RAW="$ROOT/VERIF/raw/run-$STAMP"
mkdir -p "$RAW" || { echo "ERREUR : impossible de créer $RAW"; exit 2; }

NODE_V=$(node --version 2>/dev/null || echo absent)
SH_V=$(readlink /bin/sh 2>/dev/null || echo sh)
echo "============================================================================="
echo " LAN-VOICE — vérification complète"
echo " date      : $NOW"
echo " racine    : $ROOT"
echo " journaux  : VERIF/raw/run-$STAMP/"
echo " outils    : sh=$SH_V node=$NODE_V (aucun paquet npm requis)"
echo "============================================================================="

FAILS=0; SKIPS=0; PASSES=0
rows=""

# run_check <nom> <script.sh> <libellé>
run_check() {
  name=$1; script=$2; label=$3
  log="$RAW/$name.log"
  tag=$(echo "$name" | tr 'a-z-' 'A-Z_')
  detail=""
  if [ ! -f "$HERE/$script" ]; then
    verdict="SKIP"
    detail="reason=script-absent ($script)"
    printf 'CHECK_%s RESULT=SKIP reason=script-absent\n' "$tag" > "$log"
  else
    sh "$HERE/$script" "$ROOT" > "$log" 2>&1
    line=$(grep '^CHECK_' "$log" | tail -1)
    case "$line" in
      *RESULT=PASS*) verdict="PASS" ;;
      *RESULT=FAIL*) verdict="FAIL" ;;
      *RESULT=SKIP*) verdict="SKIP" ;;
      *)             verdict="FAIL"; detail="aucune ligne CHECK_ produite (voir journal)" ;;
    esac
    if [ -z "$detail" ]; then
      detail=$(printf '%s' "$line" | sed 's/^CHECK_[A-Z_]* RESULT=[A-Z]* *//' | cut -c1-110)
      [ -n "$detail" ] || detail="(ligne machine vide)"
    fi
  fi
  case "$verdict" in
    PASS) PASSES=$((PASSES + 1)) ;;
    FAIL) FAILS=$((FAILS + 1)) ;;
    SKIP) SKIPS=$((SKIPS + 1)) ;;
  esac
  printf '%-17s [%s] %s\n' "$label" "$verdict" "$detail"
  [ "$QUIET" -eq 1 ] || printf '                   journal : raw/run-%s/%s.log\n' "$STAMP" "$name"
  echo "RESULT $verdict $label"
  rows="$rows$label|$verdict|$detail
"
  echo "$label $verdict $detail" >> "$RAW/_results"
}

echo ""
echo "--- contrôles ---"
run_check check-deps        check-deps.sh        "check-deps"
run_check check-no-external check-no-external.sh "check-no-external"
run_check check-engine      check-engine.sh      "check-engine"
run_check check-shell       check-shell.sh       "check-shell"
run_check check-labels      check-labels.sh      "check-labels"
run_check check-a8-timers   check-a8-timers.sh   "check-a8-timers"
run_check check-a9          check-a9.sh          "check-a9"
run_check check-a10         check-a10.sh         "check-a10"
run_check check-a11         check-a11.sh         "check-a11"

# --- tests : node --test, fichier par fichier ------------------------------
echo ""
TESTLOG="$RAW/tests.log"
NTEST=0; TRUN=0; TPASS=0; TFAIL=0; TSKIP=0; TFIRSTSKIP=""
: > "$TESTLOG"
echo "=== node --test --experimental-strip-types, fichier par fichier — $NOW ===" >> "$TESTLOG"
if command -v node >/dev/null 2>&1; then
  for f in "$ROOT"/tests/*.test.ts; do
    [ -f "$f" ] || continue
    NTEST=$((NTEST + 1))
    b=$(basename "$f")
    one="$RAW/tests-$b.log"
    {
      echo "### $b — node --test --experimental-strip-types"
      node --test --experimental-strip-types "$f" 2>&1
      echo "### code de sortie node : $?"
    } > "$one" 2>&1
    rc=$(grep -o 'code de sortie node : [0-9]*' "$one" | tail -1 | grep -o '[0-9]*$')
    stats=$(grep -E '^# (pass|fail)' "$one" | tr '\n' ' ' | sed 's/  */ /g')
    if [ "${rc:-1}" -eq 0 ]; then
      TPASS=$((TPASS + 1)); TRUN=$((TRUN + 1))
      printf '  [OK]    %-30s %s\n' "$b" "$stats"
    elif grep -qE "Cannot find package|ERR_MODULE_NOT_FOUND|Cannot find module" "$one"; then
      TSKIP=$((TSKIP + 1))
      miss=$(grep -oE "Cannot find (package|module) '[^']*'" "$one" | head -1)
      [ -n "$TFIRSTSKIP" ] || TFIRSTSKIP="$miss"
      printf '  [SKIP]  %-30s NON EXÉCUTÉ (%s) — pas un succès\n' "$b" "$miss"
    else
      TFAIL=$((TFAIL + 1)); TRUN=$((TRUN + 1))
      printf '  [ECHEC] %-30s %s (journal : tests-%s.log)\n' "$b" "$stats" "$b"
    fi
    echo "RESULT-FILE $b rc=${rc:-?} $stats" >> "$TESTLOG"
  done
fi
echo "" >> "$TESTLOG"
echo "bilan : fichiers=$NTEST exécutés=$TRUN pass=$TPASS échec=$TFAIL non-exécutables=$TSKIP" >> "$TESTLOG"

if [ "$NTEST" -eq 0 ]; then
  TESTV="SKIP"; TESTD="aucun tests/*.test.ts découvert sous $ROOT/tests"
elif [ "$TFAIL" -gt 0 ]; then
  TESTV="FAIL"; TESTD="$TPASS/$NTEST fichiers verts, $TFAIL en ÉCHEC, $TSKIP non exécutable(s)"
elif [ "$TRUN" -eq 0 ]; then
  TESTV="SKIP"; TESTD="aucun fichier exécutable : $TSKIP non exécutable(s) ($TFIRSTSKIP)"
else
  TESTV="PASS"; TESTD="$TPASS/$NTEST fichiers exécutés et verts"
  [ "$TSKIP" -gt 0 ] && TESTD="$TESTD ; $TSKIP NON EXÉCUTÉ(s) ($TFIRSTSKIP) — non comptés comme succès"
fi
printf 'CHECK_TESTS RESULT=%s files=%s run=%s pass=%s fail=%s not_run=%s\n' \
  "$TESTV" "$NTEST" "$TRUN" "$TPASS" "$TFAIL" "$TSKIP" >> "$TESTLOG"

case "$TESTV" in
  PASS) PASSES=$((PASSES + 1)) ;;
  FAIL) FAILS=$((FAILS + 1)) ;;
  SKIP) SKIPS=$((SKIPS + 1)) ;;
esac
printf '%-17s [%s] %s\n' "check-tests" "$TESTV" "$TESTD"
echo "RESULT $TESTV check-tests"
rows="$rows
check-tests|$TESTV|$TESTD
"

# --- tableau final ---------------------------------------------------------
echo ""
echo "============================================================================="
echo " TABLEAU FINAL — $(date -Is 2>/dev/null || date)"
echo "============================================================================="
printf '%-18s %-6s %s\n' "CONTROLE" "VERDICT" "SYNTHESE"
printf '%s\n' "$rows" | while IFS='|' read -r l v d; do
  [ -n "$l" ] || continue
  printf '%-18s %-6s %s\n' "$l" "$v" "$(printf '%s' "$d" | cut -c1-110)"
done
echo "-----------------------------------------------------------------------------"
printf 'controles=%s reussis=%s échecs=%s skips=%s\n' \
  "$((PASSES + FAILS + SKIPS))" "$PASSES" "$FAILS" "$SKIPS"

# un contrôle peut différer un de ses sous-contrôles (ex. dépendances non
# installées) : on le remonte pour que le compte de skips ne sous-déclare rien.
INT=0
for lf in "$RAW"/check-*.log; do
  [ -f "$lf" ] || continue
  v=$(grep -o 'skips=[0-9]*' "$lf" | tail -1 | cut -d= -f2)
  [ -n "$v" ] && INT=$((INT + v))
done
[ "$INT" -gt 0 ] && printf 'dont sous-controles différes a l interieur d un controle : %s\n' "$INT"

if [ "$SKIPS" -gt 0 ]; then
  echo ""
  echo "POINTS NON VÉRIFIÉS ($SKIPS — un SKIP n'est PAS un succès) :"
  printf '%s\n' "$rows" | while IFS='|' read -r l v d; do
    [ "$v" = "SKIP" ] || continue
    printf '  - %-16s %s\n' "$l" "$(printf '%s' "$d" | cut -c1-140)"
  done
  echo "  Ces contrôles n'ont produit AUCUNE preuve : à rejouer quand leur"
  echo "  préalable existe (npm ci pour les dépendances installées, vitest ou"
  echo "  node:test pour les fichiers de test non chargeables)."
fi
echo ""
echo "Journaux détaillés : $RAW/"
if [ "$FAILS" -gt 0 ]; then
  echo "LAN-VOICE VERIF RESULT=FAIL"
  exit 1
fi
echo "LAN-VOICE VERIF RESULT=PASS"
exit 0
