#!/bin/sh
# =============================================================================
# check-deps.sh — pas d'auto-update, pas de télémétrie (CA19 et CA20 de SPEC-001)
# -----------------------------------------------------------------------------
# Usage : ./check-deps.sh [RACINE]
#
# Contrôles :
#   1. package.json : aucune dépendance interdite (electron-updater, @sentry/*,
#      analytics, posthog, mixpanel, amplitude, google-analytics, segment,
#      bugsnag, rollbar, datadog, newrelic, countly, react-ga).
#   2. node_modules/ : aucun de ces paquets n'est présent sur le disque
#      (node_modules absent -> SKIP explicite, pas un succès).
#   3. package.json : AUCUN champ `build` (AD-28). read-config-file lit
#      package.json["build"] EN PRIORITÉ et n'ouvre electron-builder.yml que si
#      ce champ est absent (node_modules/read-config-file/out/main.js:68-72) :
#      un champ build rend le yml INERTE, donc c'est une double source de config
#      = échec, même si le build qu'il contient est propre. `publish` doit en
#      outre valoir null à la racine de package.json.
#   3bis. electron-builder.yml : `publish: null` — SEULE source de config après
#      AD-28 (invariant : pas de champ build + publish null dans le yml).
#   4. src/ : aucune occurrence de autoUpdater / electron-updater / setFeedURL.
#
# Sortie : dernière ligne machine  CHECK_DEPS RESULT=PASS|FAIL|SKIP
# Code de retour : 0 = PASS ou SKIP, 1 = FAIL
# =============================================================================

set -u

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DEFAULT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ROOT="${1:-$ROOT_DEFAULT}"
NOW=$(date -Is 2>/dev/null || date)

FAILURES=0
SKIPS=0
PKG_CHECKED=0   # 1 seulement si package.json a pu être lu et jugé
YML_CHECKED=0   # 1 si electron-builder.yml a pu être lu et jugé
say() { printf '%s\n' "$*"; }
ok()  { say "  [OK]   $*"; }
bad() { say "  [FAIL] $*"; FAILURES=$((FAILURES + 1)); }
skip(){ say "  [SKIP] $*"; SKIPS=$((SKIPS + 1)); }

FORBIDDEN='electron-updater|@sentry/|sentry|analytics|posthog|mixpanel|amplitude|google-analytics|googletagmanager|segment|bugsnag|rollbar|datadog|newrelic|countly|react-ga'

say "=== check-deps.sh — $NOW ==="
say "RACINE : $ROOT"

PKG="$ROOT/package.json"

# --- 1. package.json --------------------------------------------------------
if [ ! -f "$PKG" ]; then
  skip "package.json absent ($PKG) — contrôle des dépendances impossible"
else
  say "--- 1. dépendances déclarées dans package.json ---"
  HIT=$(grep -n -i -E "$FORBIDDEN" "$PKG" 2>/dev/null)
  if [ -n "$HIT" ]; then
    bad "dépendance interdite trouvée dans package.json :"
    printf '%s\n' "$HIT" | sed 's/^/         /'
  else
    ok "aucune dépendance interdite dans package.json"
    PKG_CHECKED=1
  fi

  # --- 3. publish:null ------------------------------------------------------
  say "--- 3. electron-builder : publish == null ---"
  if command -v node >/dev/null 2>&1; then
    PUB=$(node -e '
      const fs=require("fs");
      let p;
      try { p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); }
      catch(e){ console.log("ERR:package.json illisible"); process.exit(0); }
      const has=(o,k)=>o&&Object.prototype.hasOwnProperty.call(o,k);
      const top = has(p,"publish") ? p.publish : undefined;
      const inBuild = has(p.build,"publish") ? p.build.publish : undefined;
      const show = v => v===undefined ? "ABSENT" : (v===null ? "null" : JSON.stringify(v));
      const buildState = has(p,"build") ? "PRESENT" : "ABSENT";
      // state = verdict explicite calcule ici, pas une heuristique sur la forme
      // de la chaine : ajouter un champ ne peut plus changer un OK en FAIL muet.
      const state = buildState==="PRESENT" ? "BAD-DOUBLE-SOURCE"
                  : top===null              ? "OK-UNIQUE"
                  :                           "BAD-PUBLISH";
      console.log("top-level="+show(top)+" build.publish="+show(inBuild)+" build="+buildState+" state="+state);
    ' "$PKG" 2>/dev/null)
    case "$PUB" in
      *"state=OK-UNIQUE"*)
        ok "pas de champ build ; publish=null (yml = seule source de config)" ;;
      *"state=BAD-DOUBLE-SOURCE"*)
        bad "double source de config : package.json contient un champ build, lu EN PRIORITÉ par read-config-file, electron-builder.yml est alors IGNORÉ — AD-28 ($PUB)" ;;
      ERR*) skip "package.json illisible par node ($PUB)" ;;
      *) bad "publish n'est pas null à la racine de package.json ($PUB)" ;;
    esac
  else
    skip "node absent : contrôle JSON impossible, repli grep"
    if grep -q -E '"publish"[[:space:]]*:[[:space:]]*null' "$PKG"; then
      ok "grep : \"publish\": null présent"
    else
      bad "grep : aucun \"publish\": null dans package.json"
    fi
  fi

fi

# --- 3bis. electron-builder.yml : publish:null (indépendant de package.json) -
say "--- 3bis. electron-builder.yml : publish == null ---"
YML=""
for y in electron-builder.yml electron-builder.yaml; do
  [ -f "$ROOT/$y" ] && YML="$ROOT/$y"
done
if [ -n "$YML" ]; then
  if grep -q -E '^[[:space:]]*publish[[:space:]]*:[[:space:]]*null' "$YML"; then
    ok "$(basename "$YML") : publish: null présent"
    YML_CHECKED=1
    case "${PUB:-}" in
      *build=PRESENT*)
        say "  [INFO] ce publish: null est INERTE : package.json contient encore un champ build, lu en priorité (voir §3)" ;;
    esac
  else
    bad "$(basename "$YML") : aucun 'publish: null'"
    YML_CHECKED=1
  fi
else
  say "  [INFO] pas de electron-builder.yml — config attendue dans package.json (build)"
fi

# --- 2. node_modules --------------------------------------------------------
say "--- 2. paquets réellement installés (node_modules) ---"
NM="$ROOT/node_modules"
if [ ! -d "$NM" ]; then
  skip "node_modules absent : aucune dépendance installée, contrôle différé (relancer après npm install)"
else
  FOUND=0
  for p in electron-updater "@sentry" sentry posthog mixpanel amplitude \
           google-analytics react-ga gtag segment bugsnag rollbar datadog newrelic countly; do
    if [ -e "$NM/$p" ]; then
      bad "paquet interdit installé : node_modules/$p"
      FOUND=$((FOUND + 1))
    fi
  done
  [ "$FOUND" -eq 0 ] && ok "aucun paquet interdit dans node_modules"
fi

# --- 4. src/ : auto-update --------------------------------------------------
say "--- 4. code source : autoUpdater / electron-updater ---"
if [ -d "$ROOT/src" ]; then
  HIT=$(grep -r -n -I -E 'autoUpdater|electron-updater|setFeedURL|checkForUpdates' "$ROOT/src" 2>/dev/null)
  if [ -n "$HIT" ]; then
    bad "occurrence d'auto-update dans src/ :"
    printf '%s\n' "$HIT" | sed 's/^/         /'
  else
    ok "aucune occurrence d'auto-update dans src/"
  fi
else
  skip "src/ absent : rien à scanner"
fi

# --- verdict ----------------------------------------------------------------
say "--- résumé ---"
say "échecs=$FAILURES skips=$SKIPS package.json_jugé=$PKG_CHECKED electron-builder_jugé=$YML_CHECKED"
if [ "$FAILURES" -gt 0 ]; then
  printf 'CHECK_DEPS RESULT=FAIL failures=%s skips=%s\n' "$FAILURES" "$SKIPS"
  exit 1
fi
if [ "$PKG_CHECKED" -eq 0 ]; then
  # Le volet « dépendances » n'a pas pu être jugé : ce n'est PAS un succès,
  # même si electron-builder.yml est propre. SKIP explicite.
  printf 'CHECK_DEPS RESULT=SKIP failures=0 skips=%s reason=package.json-absent-ou-illisible electron_builder=%s\n' \
    "$SKIPS" "$YML_CHECKED"
  exit 0
fi
printf 'CHECK_DEPS RESULT=PASS failures=0 skips=%s\n' "$SKIPS"
exit 0
