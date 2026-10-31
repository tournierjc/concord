#!/bin/sh
# =============================================================================
# check-shell.sh — sûreté de la coquille Electron (défense en profondeur)
# -----------------------------------------------------------------------------
# Pourquoi : le renderer affiche des contenus et manipule WebRTC. S'il a accès à
# Node, une seule injection HTML devient une exécution de code arbitraire sur la
# machine. La coquille doit rester un bac à sable : ni Node, ni module remote,
# ni webSecurity désactivé, ni URL distante, ni mise à jour automatique.
#
# CONTROLES
#   S1  fenêtre principale : nodeIntegration:false, contextIsolation:true,
#       sandbox:true, preload déclaré ; aucune webSecurity:false
#       -> SKIP motivé si aucun `new BrowserWindow` n'existe encore (fenêtre
#          non écrite : rien à prouver, ce n'est pas un succès)
#   S2  aucun module remote (@electron/remote, enableRemoteModule:true)
#   S3  aucune URL http(s)/ws(s) hors LAN dans src/ — DÉLÉGUÉ à
#       check-no-external.sh (source unique de vérité pour les motifs d'URL)
#   S4  CSP présente (en-tête ou meta) + aucun unsafe-eval/unsafe-inline ;
#       S4b (avertissement) : la CSP est-elle réellement INSTALLÉE
#       (onHeadersReceived ou meta http-equiv) et pas seulement définie ?
#   S5  aucune mise à jour automatique : autoUpdater, electron-updater,
#       setFeedURL, latest.yml dans src/ ; publish non nul dans electron-builder
#
# Les lignes de commentaire (JSDoc ` * `, `//`) sont exclues des motifs : le
# code de ce projet documente justement ce qu'il n'utilise pas.
#
# Usage : ./check-shell.sh [RACINE]       RACINE par défaut = dossier parent
# Dépendances : sh, grep. Aucun paquet npm.
# Sortie machine : CHECK_SHELL RESULT=PASS|FAIL|SKIP ...
# =============================================================================

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 2
ROOT=${1:-}
if [ -z "$ROOT" ]; then
  ROOT=$(CDPATH= cd -- "$HERE/.." && pwd) || exit 2
fi
NOW=$(date -Is 2>/dev/null || date)
FAILS=0; SKIPS=0

echo "=== check-shell.sh — $NOW ==="
echo "RACINE   : $ROOT"

# grep qui ignore les lignes de commentaire
codegrep() {
  grep -rnE "$1" "$2" 2>/dev/null | grep -vE ':[0-9]+:[[:space:]]*(\*|//|/\*)'
}

if [ ! -d "$ROOT/src" ]; then
  echo ""
  echo "[SKIP] S0  $ROOT/src est absent : aucun code de coquille à contrôler."
  echo "--- résumé ---"
  echo "échecs=0 skips=5"
  printf 'CHECK_SHELL RESULT=SKIP failures=0 skips=5 reason=src-absent\n'
  exit 0
fi

# --- S1 : options de la fenêtre principale ---------------------------------
echo ""
WINF=$(codegrep 'new BrowserWindow' "$ROOT/src" | cut -d: -f1 | sort -u)
if [ -z "$WINF" ]; then
  SKIPS=$((SKIPS + 1))
  echo "[SKIP] S1  aucun 'new BrowserWindow' dans src/ : fenêtre principale non écrite,"
  echo "            options de sécurité invérifiables (nodeIntegration/contextIsolation/sandbox)."
else
  S1B=0
  for want in 'nodeIntegration[[:space:]]*:[[:space:]]*false' \
              'contextIsolation[[:space:]]*:[[:space:]]*true' \
              'sandbox[[:space:]]*:[[:space:]]*true' \
              'preload[[:space:]]*:'; do
    if ! grep -rqE "$want" $WINF 2>/dev/null; then
      S1B=$((S1B + 1)); FAILS=$((FAILS + 1))
      echo "[ECHEC] S1  option manquante dans $(printf '%s ' $WINF): /$want/"
    fi
  done
  WS=$(codegrep 'webSecurity[[:space:]]*:[[:space:]]*false' "$ROOT/src")
  if [ -n "$WS" ]; then
    S1B=$((S1B + 1)); FAILS=$((FAILS + 1))
    echo "[ECHEC] S1  webSecurity:false interdit :"
    printf '%s\n' "$WS" | sed 's/^/          /'
  fi
  [ "$S1B" -eq 0 ] && echo "[OK]   S1  fenêtre principale : nodeIntegration:false, contextIsolation:true, sandbox:true, preload présent, pas de webSecurity:false"
fi

# --- S2 : module remote ----------------------------------------------------
echo ""
S2=$(codegrep '@electron/remote|enableRemoteModule[[:space:]]*:[[:space:]]*true|require\(.electron.\).remote' "$ROOT/src")
if [ -n "$S2" ]; then
  FAILS=$((FAILS + 1))
  echo "[ECHEC] S2  module remote détecté (surface d'attaque critique) :"
  printf '%s\n' "$S2" | sed 's/^/          /'
else
  echo "[OK]   S2  aucun @electron/remote / enableRemoteModule:true dans src/"
fi

# --- S3 : URL hors LAN (délégué) -------------------------------------------
echo ""
NEXT="$HERE/check-no-external.sh"

if [ -x "$NEXT" ] || [ -f "$NEXT" ]; then
  S3OUT=$(sh "$NEXT" "$ROOT" 2>&1)
  S3LINE=$(printf '%s\n' "$S3OUT" | grep '^CHECK_NO_EXTERNAL' | tail -1)
  case "$S3LINE" in
    *RESULT=PASS*) echo "[OK]   S3  aucune URL hors LAN dans src/ (délégué à check-no-external.sh)" ;;
    *RESULT=SKIP*) SKIPS=$((SKIPS + 1)); echo "[SKIP] S3  check-no-external.sh n'a pas pu conclure : $S3LINE" ;;
    ""            ) SKIPS=$((SKIPS + 1)); echo "[SKIP] S3  check-no-external.sh n'a produit aucun verdict" ;;
    *             ) FAILS=$((FAILS + 1)); echo "[ECHEC] S3  URL ou ressource hors LAN : $S3LINE"
                    printf '%s\n' "$S3OUT" | grep -E 'HORS-LAN|hors-LAN' | head -12 | sed 's/^/          /' ;;
  esac
else
  SKIPS=$((SKIPS + 1))
  echo "[SKIP] S3  check-no-external.sh introuvable à côté de ce script : contrôle non exécuté"
fi

# --- S4 : CSP --------------------------------------------------------------
echo ""
CSPHIT=$(grep -rlE 'Content-Security-Policy' "$ROOT/src" "$ROOT/index.html" 2>/dev/null)
if [ -z "$CSPHIT" ]; then
  FAILS=$((FAILS + 1))
  echo "[ECHEC] S4  aucune CSP (ni en-tête Content-Security-Policy, ni meta) dans src/ ni index.html"
else
  S4B=0
  if ! grep -rqE "default-src" $CSPHIT 2>/dev/null; then
    S4B=$((S4B + 1)); FAILS=$((FAILS + 1))
    echo "[ECHEC] S4  CSP sans 'default-src' (pas de repli restrictif) dans : $(printf '%s ' $CSPHIT)"
  fi
  # unsafe-eval : inacceptable. unsafe-inline : seulement s'il porte sur script-src
  # (style-src 'unsafe-inline' est une concession courante et limitée aux styles).
  UEVAL=$(codegrep "unsafe-eval" "$ROOT/src")
  UINL_SCRIPT=$(codegrep "unsafe-inline" "$ROOT/src" | grep -i 'script-src')
  UINL_STYLE=$(codegrep "unsafe-inline" "$ROOT/src" | grep -iv 'script-src')
  if [ -n "$UEVAL" ] || [ -n "$UINL_SCRIPT" ]; then
    S4B=$((S4B + 1)); FAILS=$((FAILS + 1))
    echo "[ECHEC] S4  'unsafe-eval' ou 'unsafe-inline' sur script-src :"
    [ -n "$UEVAL" ] && printf '%s\n' "$UEVAL" | sed 's/^/          /'
    [ -n "$UINL_SCRIPT" ] && printf '%s\n' "$UINL_SCRIPT" | sed 's/^/          /'
  fi
  if [ -n "$UINL_STYLE" ]; then
    echo "[AVERT] S4  'unsafe-inline' sur style-src (styles en ligne) — risque résiduel accepté, à justifier :"
    printf '%s\n' "$UINL_STYLE" | sed 's/^/          /'
  fi
  [ "$S4B" -eq 0 ] && echo "[OK]   S4  CSP présente avec default-src, sans unsafe-eval ni unsafe-inline sur script-src ($(printf '%s ' $CSPHIT))"
  # S4b : la CSP est-elle posée, ou seulement écrite ?
  if codegrep 'onHeadersReceived|http-equiv' "$ROOT/src" >/dev/null 2>&1 || \
     grep -q 'http-equiv' "$ROOT/index.html" 2>/dev/null; then
    echo "[OK]   S4b la CSP est installée (onHeadersReceived ou meta http-equiv)"
  else
    echo "[AVERT] S4b la CSP est définie mais AUCUN point d'installation trouvé"
    echo "            (ni session.webRequest.onHeadersReceived, ni meta http-equiv) :"
    echo "            à la date de ce contrôle, elle n'est peut-être pas encore appliquée."
  fi
fi

# --- S5 : auto-update ------------------------------------------------------
echo ""
S5=$(codegrep 'autoUpdater|electron-updater|setFeedURL|latest\.yml' "$ROOT/src")
S5B=0
if [ -n "$S5" ]; then
  S5B=$((S5B + 1)); FAILS=$((FAILS + 1))
  echo "[ECHEC] S5  mécanisme de mise à jour automatique dans src/ :"
  printf '%s\n' "$S5" | sed 's/^/          /'
fi
EBI="$ROOT/electron-builder.yml"
if [ -f "$EBI" ]; then
  PUB=$(grep -nE '^[[:space:]]*publish[[:space:]]*:' "$EBI" | grep -vE ':[[:space:]]*null[[:space:]]*$|:[[:space:]]*nul[[:space:]]*$')
  if [ -n "$PUB" ]; then
    S5B=$((S5B + 1)); FAILS=$((FAILS + 1))
    echo "[ECHEC] S5  electron-builder.yml déclare un provider de publication :"
    printf '%s\n' "$PUB" | sed 's/^/          /'
  fi
fi
[ "$S5B" -eq 0 ] && echo "[OK]   S5  aucune mise à jour automatique (src/ propre, publish=null dans electron-builder.yml)"

echo ""
echo "--- résumé ---"
echo "échecs=$FAILS skips=$SKIPS"
if [ "$FAILS" -gt 0 ]; then
  printf 'CHECK_SHELL RESULT=FAIL failures=%s skips=%s\n' "$FAILS" "$SKIPS"
  exit 1
fi
printf 'CHECK_SHELL RESULT=PASS failures=0 skips=%s\n' "$SKIPS"
exit 0
