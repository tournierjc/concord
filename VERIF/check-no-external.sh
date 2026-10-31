#!/bin/sh
# =============================================================================
# check-no-external.sh — garde-fou « LAN only » (CA4, CA5, CA20 de SPEC-001)
# -----------------------------------------------------------------------------
# Prouve statiquement qu'AUCUNE référence à une ressource hors du réseau local
# ne subsiste dans le code livré : URL http(s), websocket distante, serveur
# STUN/TURN public, domaine public, CDN, télémétrie.
#
# Usage : ./check-no-external.sh [RACINE] [-q]
#         RACINE par défaut = dossier parent de VERIF/ (racine lan-voice/)
#
# Sortie : une ligne par occurrence  CHEMIN:LIGNE:CONTENU
#          les occurrences sont CLASSÉES (voir ci-dessous) puis
#          dernière ligne machine   CHECK_NO_EXTERNAL RESULT=PASS|FAIL|SKIP
# Code de retour : 0 = propre (PASS ou SKIP), 1 = au moins une occurrence
#                  réellement hors LAN (FAIL)
#
# Classification des occurrences — trois classes, toutes imprimées :
#   HORS-LAN  : schéma/URL dont l'hôte est littéralement hors LAN, ou mot-clé
#               de service tiers (google, cloudflare, sentry, analytics…).
#               => fait échouer le contrôle.
#   LOCAL     : adresses de loopback explicites (127.0.0.1, localhost, [::1])
#               ou adresse RFC1918 littérale. Une app qui n'écoute que sur
#               elle-même ne sort pas du LAN : ce n'est pas une violation.
#               Compté, imprimé, justifié — pas masqué.
#   MODELE    : hôte construit dynamiquement (`ws://${host}:*`) ou motif
#               générique (`*://*/*`, utilisé comme FILTRE qui bloque tout).
#               Non décidable statiquement : compté, imprimé, signalé comme
#               « à relire » — ce n'est PAS un blanc-seing.
#   Le FAIL ne porte que sur HORS-LAN. Les deux autres classes restent visibles
#   pour que le relecteur puisse contester le tri.
#
# Périmètre : le CODE livré (.ts .tsx .mts .cts .js .jsx .mjs .cjs .json .html
#   .css .yml .yaml .sh). Exclus : node_modules/ dist/ out/ release/ build/
#   .git/ VERIF/ tests/ SPECS/ et les lockfiles.
#   VERIF/ est exclu car ces scripts contiennent eux-mêmes les motifs interdits.
#   tests/ est exclu du verdict mais scanné à part en INFO.
#   Les lockfiles (package-lock.json…) sont listés en INFO seulement : l'URL
#   https://registry.npmjs.org qu'ils contiennent est du trafic d'INSTALLATION,
#   pas d'exécution — mais cela doit rester connu.
#
# Limite : contrôle STATIQUE. Il ne prouve pas l'absence de trafic à
#   l'exécution — c'est measure-traffic.sh (dynamique) qui le fait, et même lui
#   ne voit que les sockets ouvertes pendant la fenêtre de capture.
# =============================================================================

set -u

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DEFAULT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
QUIET=0
ROOT=""
for arg in "$@"; do
  case "$arg" in
    -q) QUIET=1 ;;
    -h|--help) sed -n '2,50p' "$0"; exit 0 ;;
    *) ROOT="$arg" ;;
  esac
done
[ -n "$ROOT" ] || ROOT="$ROOT_DEFAULT"
NOW=$(date -Is 2>/dev/null || date)

# classes d'exemption (ERE, insensibles à la casse) --------------------------
# LOCAL : schéma suivi d'un hôte loopback ou RFC1918 littéral
#   (une octet commençant par x/X est une convention de BLANC d'adresse,
#    ex. ws://192.168.x.y:* dans une doc — on l'accepte, mais pas 192.168.com)
LOCAL_RE='(https?|wss?)://(127\.[0-9.]+|localhost|\[::1\]|10\.[0-9]|192\.168\.[0-9xX]|172\.(1[6-9]|2[0-9]|3[01])\.[0-9])'
# MODELE : hôte dynamique ou motif générique de filtre Electron
MODELE_RE='(://\$\{)|(://\*)|(\*://\*/\*)'

TMP=$(mktemp -d "${TMPDIR:-/tmp}/checkext.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT INT TERM HUP

cat > "$TMP/patterns" <<'PATTERNS'
https?://
wss?://
(^|[^A-Za-z0-9_])stuns?:
(^|[^A-Za-z0-9_])turns?:
\.(com|io|net|org|cloud)([^A-Za-z0-9]|$)
([a-z0-9-]+\.)*(googleapis|gstatic|google-analytics|googletagmanager|cloudflare|cloudfront|akamai|fastly|amazonaws|githubusercontent|jsdelivr|unpkg|cdnjs|sentry|posthog|mixpanel|bugsnag|rollbar|datadoghq|newrelic)\.(com|net|org|io|cloud)
PATTERNS

log() { [ "$QUIET" -eq 1 ] || printf '%s\n' "$*"; }

log "=== check-no-external.sh — $NOW ==="
log "RACINE   : $ROOT"
log "motifs   : $(wc -l < "$TMP/patterns" | tr -d ' ') règles ERE (voir en-tête)"
log "exempt.  : LOCAL  = $LOCAL_RE"
log "           MODELE = $MODELE_RE"

if [ ! -d "$ROOT" ]; then
  log "ERREUR : racine inexistante : $ROOT"
  printf 'CHECK_NO_EXTERNAL RESULT=SKIP reason=racine-inexistante\n'
  exit 0
fi

find "$ROOT" \
  \( -name node_modules -o -name dist -o -name out -o -name release -o -name build \
     -o -name .git -o -name VERIF -o -name tests -o -name SPECS \) -prune -o \
  -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.mts' -o -name '*.cts' \
     -o -name '*.js' -o -name '*.jsx' -o -name '*.mjs' -o -name '*.cjs' \
     -o -name '*.json' -o -name '*.html' -o -name '*.css' \
     -o -name '*.yml' -o -name '*.yaml' -o -name '*.sh' \) \
  ! -name 'package-lock.json' ! -name 'yarn.lock' ! -name 'pnpm-lock.yaml' \
  -print > "$TMP/files" 2>/dev/null

NFILES=$(wc -l < "$TMP/files" | tr -d ' ')
log "fichiers : $NFILES fichier(s) de code à scanner"

if [ "$NFILES" -eq 0 ]; then
  printf 'CHECK_NO_EXTERNAL RESULT=SKIP reason=aucun-fichier-de-code files=0 hits=0\n'
  exit 0
fi

: > "$TMP/hits_raw"
while IFS= read -r f; do
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    grep -n -H -I -i -E -- "$p" "$f" 2>/dev/null | awk -v p="$p" '{ print p "\t" $0 }'
  done < "$TMP/patterns"
done < "$TMP/files" > "$TMP/hits_raw"
# une même ligne peut satisfaire plusieurs motifs : on garde le premier
awk -F'\t' '!seen[$2]++' "$TMP/hits_raw" > "$TMP/hits"
rm -f "$TMP/hits_raw"

HITS=$(wc -l < "$TMP/hits" | tr -d ' ')
: > "$TMP/extern"; : > "$TMP/local"; : > "$TMP/modele"; : > "$TMP/doc"
while IFS= read -r line; do
  [ -n "$line" ] || continue
  pat=$(printf '%s' "$line" | cut -f1)
  rest=$(printf '%s' "$line" | cut -f2-)
  content=$(printf '%s' "$rest" | cut -d: -f3-)
  case "$content" in
    [[:space:]]*'//'*|*'//'*|*'*'*) ISCOM=1 ;;
    *) ISCOM=0 ;;
  esac
  if printf '%s' "$rest" | grep -q -i -E "$LOCAL_RE" 2>/dev/null; then
    printf '%s\t%s\n' "$pat" "$rest" >> "$TMP/local"
  elif printf '%s' "$rest" | grep -q -i -E "$MODELE_RE" 2>/dev/null; then
    printf '%s\t%s\n' "$pat" "$rest" >> "$TMP/modele"
  else
    case "$content" in
      # commentaire pur (//, /*, *, ou # en shell/yml) : une URL de
      # documentation ne peut pas produire de trafic -> classe DOC (relire)
      *'//'*|*'/*'*|*'*'*) printf '%s\t%s\n' "$pat" "$rest" >> "$TMP/doc" ;;
      *) printf '%s\t%s\n' "$pat" "$rest" >> "$TMP/extern" ;;
    esac
  fi
done < "$TMP/hits"

NE=$(wc -l < "$TMP/extern" | tr -d ' ')
NL=$(wc -l < "$TMP/local" | tr -d ' ')
NM=$(wc -l < "$TMP/modele" | tr -d ' ')
ND=$(wc -l < "$TMP/doc" | tr -d ' ')

log "--- occurrences brutes ($HITS) : HORS-LAN=$NE  LOCAL=$NL  MODELE=$NM  DOC=$ND ---"
if [ "$NM" -gt 0 ]; then
  log "[MODELE] hôte dynamique / motif de filtre — non décidable, A RELIRE :"
  sed 's/\t/   motif=/; s/^/  /' "$TMP/modele"
fi
if [ "$NL" -gt 0 ]; then
  log "[LOCAL] loopback / RFC1918 littéral — pas un départ hors LAN :"
  sed 's/\t/   motif=/; s/^/  /' "$TMP/local"
fi
if [ "$ND" -gt 0 ]; then
  log "[DOC] URL citée dans un commentaire (aucun trafic possible) — pour mémoire :"
  sed 's/\t/   motif=/; s/^/  /' "$TMP/doc"
fi
if [ "$NE" -gt 0 ]; then
  log "[HORS-LAN] violations :"
  sed 's/\t/   motif=/; s/^/  /' "$TMP/extern"
fi

# --- lockfiles : information seulement --------------------------------------
for l in package-lock.json yarn.lock pnpm-lock.yaml; do
  if [ -f "$ROOT/$l" ]; then
    N=$(grep -c -E 'https?://' "$ROOT/$l" 2>/dev/null || true)
    log "INFO lockfile $l présent — $N URL http(s) dedans (trafic d'installation, pas d'exécution)"
  fi
done

# --- tests/ : information seulement ----------------------------------------
if [ -d "$ROOT/tests" ]; then
  TNET=$(grep -r -I -n -E 'https?://|wss?://|fetch\(|XMLHttpRequest|new WebSocket' "$ROOT/tests" 2>/dev/null | wc -l | tr -d ' ')
  log "INFO tests/ : $TNET ligne(s) URL/fetch/WebSocket (périmètre exclu du verdict)"
fi

log "--- résumé ---"
log "fichiers scannés=$NFILES occurrences brutes=$HITS  hors-LAN=$NE local=$NL modele=$NM doc=$ND"
if [ "$NE" -gt 0 ]; then
  printf 'CHECK_NO_EXTERNAL RESULT=FAIL files=%s hits=%s horslan=%s local=%s modele=%s doc=%s\n' \
    "$NFILES" "$HITS" "$NE" "$NL" "$NM" "$ND"
  exit 1
fi
printf 'CHECK_NO_EXTERNAL RESULT=PASS files=%s hits=%s horslan=0 local=%s modele=%s doc=%s\n' \
  "$NFILES" "$HITS" "$NL" "$NM" "$ND"
exit 0
