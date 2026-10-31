#!/bin/sh
# =============================================================================
# verif-024-harness.sh — harnais de VERIF-024 (T23 : fusion des listes + relais)
# -----------------------------------------------------------------------------
# ÉTAT : PRÉPARÉ, NON LANCÉ (2026-10-31T04:2x+01:00). L'arbre n'est pas gelé :
#   tests/speaking-relay.test.ts et package.json ont bougé à 04:18 (heure locale),
#   et le feu d'écriture T23 n'a pas eu lieu. Aucune mesure de VERIF-024 n'existe
#   à ce jour : ce script est le mode d'emploi exécutable de la mesure à venir.
#
# Usage :
#   sh VERIF/verif-024-harness.sh                    # mesure complète
#   sh VERIF/verif-024-harness.sh --baseline F       # + comparaison à une empreinte
#                                                    #   antérieure (gel attendu)
#   sh VERIF/verif-024-harness.sh --dry              # affiche le plan, ne mesure rien
#
# Ce qu'il fait, dans cet ordre, en n'écrivant QUE sous VERIF/raw/verif-024-<stamp>/ :
#   0. préalables (node, npx tsx, tsc, sha256sum, python3) — un préalable absent
#      donne SKIP explicite, jamais un PASS.
#   1. liste test:node vs fichiers tests/*.test.ts réellement présents : un test
#      présent sur disque mais absent de package.json n'est pas exécuté par
#      `npm test` — il est nommé, pas caché.
#   2. empreinte AVANT (sha256 de src/, tests/, package.json, tsconfig*.json,
#      vite.config.ts, electron-builder.yml, index.html, overlay.html).
#   3. contrôles : VERIF/run-all.sh (A1..A11 + LAN only + parité).
#   4. suite : npm run test:node (tsx), compteurs pass/fail.
#   5. types : tsc -p tsconfig.json --noEmit et -p tsconfig.main.json --noEmit.
#   6. A8 : table de variants (VERIF/a8-variants.py) sur copies isolées —
#      5 mutants doivent rougir, 2 témoins rester verts.
#   7. ACo (SPEC-015 rév. 5) : garde des surfaces — check-aco-015.sh (statique)
#      + son autotest. Une surface absente donne NOTRUN, jamais PASS.
#   8. empreinte APRÈS + diff : si l'arbre a bougé pendant la mesure, le verdict
#      est VOID (mesure sans valeur), pas PASS.
#
# Verdict machine (dernière ligne) : CHECK_VERIF024 RESULT=PASS|FAIL|VOID|SKIP
# =============================================================================

set -u

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$HERE/.." && pwd)
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
NOW=$(date -Is 2>/dev/null || date)
RAW="$HERE/raw/verif-024-$STAMP"
BASELINE=""
DRY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --baseline) BASELINE="${2:-}"; shift 2 ;;
    --dry) DRY=1; shift ;;
    *) printf 'option inconnue : %s\n' "$1"; exit 2 ;;
  esac
done

say() { printf '%s\n' "$*"; }

say "=== verif-024-harness.sh — $NOW ==="
say "RACINE : $ROOT"
say "JOURNAUX : $RAW"
[ -n "$BASELINE" ] && say "GEL ATTENDU (baseline) : $BASELINE"

if [ "$DRY" -eq 1 ]; then
  say ""
  say "--dry : plan seulement, aucune mesure lancée."
  say "  1) test:node vs tests/*.test.ts   2) sha256 AVANT   3) run-all.sh"
  say "  4) npm run test:node               5) tsc x2          6) a8-variants.py"
  say "  7) ACo SPEC-015 : check-aco-015.sh (+ autotest)
  7bis) ACo SPEC-015 rev. 6 : check-aco-016.sh — ACo-16 (rendus observés), statuts C4/C5, F1 chiffrée
  7ter) ACo SPEC-015 rev. 7 : check-aco-018.sh — étiquettes F2, statuts T23, C5(a), couverture
        plafond 10, vocabulaire de citation (R21)"
  say "  8) sha256 APRÈS + diff (VOID si l'arbre a bougé)"
  say "CHECK_VERIF024 RESULT=SKIP reason=dry-run (aucune mesure)"
  exit 0
fi

# --- 0. préalables -----------------------------------------------------------
MISSING=""
for tool in node npx sha256sum python3; do
  command -v "$tool" >/dev/null 2>&1 || MISSING="$MISSING $tool"
done
if [ -n "$MISSING" ]; then
  say "outil(s) absent(s) :$MISSING — mesure impossible, et un SKIP n'est pas un succès."
  say "CHECK_VERIF024 RESULT=SKIP reason=outils-absents:$MISSING"
  exit 0
fi
if ! npx --no-install tsx --version >/dev/null 2>&1; then
  say "tsx indisponible (npx --no-install tsx) : la suite npm test ne peut pas tourner."
  say "CHECK_VERIF024 RESULT=SKIP reason=tsx-absent"
  exit 0
fi

mkdir -p "$RAW" || { say "impossible de créer $RAW"; exit 1; }

# --- 1. test:node vs fichiers présents --------------------------------------
say ""
say "--- 1. couverture de la liste test:node ---"
node -e '
const fs = require("fs"), path = require("path")
const root = process.argv[1]
const pkg = require(path.join(root, "package.json"))
const list = (pkg.scripts && pkg.scripts["test:node"] || "")
const wired = new Set(list.split(/\s+/).filter((t) => /\.test\.ts$/.test(t)))
const onDisk = fs.readdirSync(path.join(root, "tests")).filter((f) => /\.test\.ts$/.test(f)).map((f) => "tests/" + f)
const orphan = onDisk.filter((f) => !wired.has(f))
const ghost = [...wired].filter((f) => !fs.existsSync(path.join(root, f)))
console.log(`  fichiers tests/*.test.ts : ${onDisk.length}   listés dans test:node : ${wired.size}`)
orphan.forEach((f) => console.log(`  [ORPHELIN] présent, non exécuté par npm test : ${f}`))
ghost.forEach((f) => console.log(`  [FANTÔME] listé, absent du disque : ${f}`))
console.log(`  ORPHELINS=${orphan.length} FANTOMES=${ghost.length}`)
' "$ROOT" | tee "$RAW/1-test-node-coverage.log"
ORPHANS=$(grep -o 'ORPHELINS=[0-9]*' "$RAW/1-test-node-coverage.log" | tail -1 | cut -d= -f2)

# --- 2. empreinte AVANT ------------------------------------------------------
manifest() {
  (
    cd "$ROOT" || exit 1
    find src tests -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.json' -o -name '*.css' \) -print0 2>/dev/null \
      | sort -z | xargs -0 sha256sum 2>/dev/null
    for f in package.json tsconfig.json tsconfig.main.json vite.config.ts electron-builder.yml index.html overlay.html; do
      [ -f "$f" ] && sha256sum "$f"
    done | sort -k2
  )
}

say ""
say "--- 2. empreinte AVANT ---"
manifest > "$RAW/2-sha-avant.txt"
NFILES=$(wc -l < "$RAW/2-sha-avant.txt" | tr -d ' ')
say "  fichiers empreintés : $NFILES"
if [ -n "$BASELINE" ] && [ -f "$BASELINE" ]; then
  if diff -q "$BASELINE" "$RAW/2-sha-avant.txt" >/dev/null 2>&1; then
    say "  [OK]   identique à la baseline (arbre gelé depuis $BASELINE)"
  else
    say "  [INFO] diffère de la baseline (attendu : le feu T23 a écrit) :"
    diff "$BASELINE" "$RAW/2-sha-avant.txt" | sed 's/^/        /' | head -40
  fi
fi

# --- 3. run-all.sh -----------------------------------------------------------
say ""
say "--- 3. contrôles (run-all.sh) ---"
sh "$HERE/run-all.sh" > "$RAW/3-run-all.log" 2>&1
RUNALL_RC=$?
grep -E '^CHECK_[A-Z0-9_]+ RESULT=' "$RAW/3-run-all.log" | sed 's/^/  /' | tee "$RAW/3-results.txt" >/dev/null
grep -E '^LAN-VOICE VERIF RESULT=' "$RAW/3-run-all.log" | sed 's/^/  /'
NF=$(grep -c 'RESULT=FAIL' "$RAW/3-results.txt" || true)
NS=$(grep -c 'RESULT=SKIP' "$RAW/3-results.txt" || true)
say "  FAIL=$NF SKIP=$NS (rc=$RUNALL_RC)"

# --- 4. suite npm ------------------------------------------------------------
say ""
say "--- 4. npm run test:node ---"
(cd "$ROOT" && npm run test:node) > "$RAW/4-npm-test.log" 2>&1
NPM_RC=$?
NPM_PASS=$(grep -E '^# pass ' "$RAW/4-npm-test.log" | tail -1 | awk '{print $3}')
NPM_FAIL=$(grep -E '^# fail ' "$RAW/4-npm-test.log" | tail -1 | awk '{print $3}')
say "  pass=${NPM_PASS:-?} fail=${NPM_FAIL:-?} rc=$NPM_RC"

# --- 5. types ---------------------------------------------------------------
say ""
say "--- 5. tsc --noEmit ---"
(cd "$ROOT" && npx --no-install tsc -p tsconfig.json --noEmit) > "$RAW/5-tsc-renderer.log" 2>&1
TSC1=$?
(cd "$ROOT" && npx --no-install tsc -p tsconfig.main.json --noEmit) > "$RAW/5-tsc-main.log" 2>&1
TSC2=$?
say "  tsconfig.json=$([ "$TSC1" -eq 0 ] && echo OK || echo KO) tsconfig.main.json=$([ "$TSC2" -eq 0 ] && echo OK || echo KO)"

# --- 6. A8 : table de variants ----------------------------------------------
say ""
say "--- 6. A8 : variants sur copies isolées ---"
python3 "$HERE/a8-variants.py" "$ROOT" "$RAW/a8" > "$RAW/6-a8-variants.log" 2>&1
A8_RC=$?
sed -n '/^TABLE/,$p' "$RAW/6-a8-variants.log" | sed 's/^/  /'
A8_MUT=$(grep -c '"a8_comportemental": "ROUGE"' "$RAW/a8/a8-variants.json" 2>/dev/null || true)
A8_VERT=$(grep -c '"a8_comportemental": "VERT"' "$RAW/a8/a8-variants.json" 2>/dev/null || true)
say "  A8 comportemental : ${A8_MUT:-?} ROUGE / ${A8_VERT:-?} VERT (attendu 5 ROUGE — m1..m5 — et 4 VERT : b0, w0, w1, m6-limite-connue)"

# --- 7. ACo (SPEC-015 rév. 5) : garde des surfaces ---------------------------
say ""
say "--- 7. ACo SPEC-015 rév. 5 : surfaces + règles de rapport ---"
sh "$HERE/check-aco-015.sh" > "$RAW/7-aco-etat.log" 2>&1
ACO_RC=$?
sh "$HERE/check-aco-015.sh" --selftest > "$RAW/7-aco-selftest.log" 2>&1
ACO_ST=$?
ACO_LINE=$(grep -E '^CHECK_ACO015 RESULT=' "$RAW/7-aco-etat.log" | tail -1)
ACO_FAIL=$(printf '%s' "$ACO_LINE" | grep -c 'RESULT=FAIL' || true)
say "  $(printf '%s' "$ACO_LINE" | sed 's/^CHECK_ACO015 //')"
say "  autotest du validateur : $(grep -E '^CHECK_ACO015 RESULT=' "$RAW/7-aco-selftest.log" | tail -1 | sed 's/^CHECK_ACO015 //')"
say "  attendu au merge de T23 : ACo-9 F2 PASS (constante=2000 >= 2x1000) ; ACo-9 F1 mesuré reload=0 ;"
say "  ACo-14 observe_ms rapporté ; ACo-6 attr ∈ {true,unknown} — tout 'false' est ILLÉGAL, pas vert."
say "  AD-26 : un canal à 2500 se rapporte « F1 vert / F2 non conforme — défaut de valeur (C6, AD-26) »."
say "  ACo-15 et le plafond 10 (lot C1a) restent hors de cette passe : R7 et R8 refusent de les cocher."

# --- 7bis. ACo (SPEC-015 rev. 6) : ACo-16 + statuts + falsification F1 ------
say ""
say "--- 7bis. ACo SPEC-015 rev. 6 : ACo-16 (rendus), statuts C4/C5, F1 chiffree ---"
sh "$HERE/check-aco-016.sh" > "$RAW/7b-aco16-etat.log" 2>&1
A16_RC=$?
sh "$HERE/check-aco-016.sh" --selftest > "$RAW/7b-aco16-selftest.log" 2>&1
A16_ST=$?
A16_LINE=$(grep -E '^CHECK_ACO016 RESULT=' "$RAW/7b-aco16-etat.log" | tail -1)
say "  $(printf '%s' "$A16_LINE" | sed 's/^CHECK_ACO016 //')"
say "  autotest : $(grep -E '^CHECK_ACO016 RESULT=' "$RAW/7b-aco16-selftest.log" | tail -1 | sed 's/^CHECK_ACO016 //')"
# Journal de recette ACo-16 produit par une EXÉCUTION RÉELLE (jamais le selftest) :
# ACO16_JOURNAL=/chemin/journal.txt — validé ici, et le harnais rougit si le validateur rejette.
A16_V=1  # 1 = FAIL : une mesure ACo-16 absente n'est pas un PASS
if [ -n "${ACO16_JOURNAL:-}" ]; then
  sh "$HERE/check-aco-016.sh" --validate "$ACO16_JOURNAL" > "$RAW/7b-aco16-validate.log" 2>&1
  A16_V=$?
  say "  journal réel ($ACO16_JOURNAL) : $(grep -E '^CHECK_ACO016 RESULT=' "$RAW/7b-aco16-validate.log" | tail -1 | sed 's/^CHECK_ACO016 //')"
else
  say "  journal réel : AUCUN (ACO16_JOURNAL non fourni) — le selftest ne vaut pas mesure d'ACo-16."
fi
say "  attendu au merge de T23 : ACo-16 duree_s=3 hz=1 messages=3 compte=rendus rendus_overlay=0 rendus_test declare ;"
say "  F1 falsification=balayage periode_ms=2000 pire_cas_ms=4000 verdict=ROUGE ; statut ACo-8/9/16 = non executable, ACo-14/15 = gele."

# --- 7ter. ACo (SPEC-015 rev. 7, errata AD-26) : etiquettes, statuts, C5(a) --
say ""
say "--- 7ter. ACo SPEC-015 rev. 7 (errata AD-26) : F2 etiquette, statuts T23, C5(a), plafond C1 ---"
sh "$HERE/check-aco-018.sh" > "$RAW/7c-aco18-etat.log" 2>&1
A17_RC=$?
sh "$HERE/check-aco-018.sh" --selftest > "$RAW/7c-aco18-selftest.log" 2>&1
A17_ST=$?
A17_LINE=$(grep -E '^CHECK_ACO018 RESULT=' "$RAW/7c-aco18-etat.log" | tail -1)
say "  $(printf '%s' "$A17_LINE" | sed 's/^CHECK_ACO018 //')"
say "  autotest : $(grep -E '^CHECK_ACO018 RESULT=' "$RAW/7c-aco18-selftest.log" | tail -1 | sed 's/^CHECK_ACO018 //')"
say '  rev. 7 : ACo-9 F2 valeur != 2000 => etiquette="non conforme — défaut de valeur, corrigé par une constante (C6, AD-26)" verdict=NON-CONFORME-C6 ; ni vert ni rouge de rendu.'
say "  ACo-8/9/16 = non-executable-relais(T23) ; ACo-14/15 geles POUR UNE MESURE, C5(a) backgroundThrottling=false,"
say "  extinction<=2016 ms fenetre reduite et rendus overlay<=2/s, repli Timers apres echec nomme ;"
say "  ACo-1 population 9/10 = hors-couverture (AD-26 §2), jamais PASS ; ACo-10 population 10 = EN-ATTENTE-C1C2 (l. 969-970), jamais PASS ni hors-couverture."
say "  hors-couverture : population CHIFFREE obligatoire sur la ligne ; population dans la couverture (ACo-1 1..8, ACo-10 8/9) = rejet symetrique ; ACo-8/9/16 = non-executable-relais, motif « cablage du relais » (T23)."
say "  R21 : « hors-couverture » n'est jamais une citation (0 occurrence dans la page) ; citation=/dixit= doit etre verbatim dans SPECS/SPEC-015 ; page illisible => NOTRUN."

# --- 8. empreinte APRÈS + verdict -------------------------------------------
say ""
say "--- 8. empreinte APRÈS ---"
manifest > "$RAW/8-sha-apres.txt"
if cmp -s "$RAW/2-sha-avant.txt" "$RAW/8-sha-apres.txt"; then
  GEL="OUI"
  say "  [OK]   arbre inchangé pendant la mesure ($NFILES fichiers)"
else
  GEL="NON"
  say "  [VOID] l'arbre a bougé pendant la mesure — la mesure ne vaut rien :"
  diff "$RAW/2-sha-avant.txt" "$RAW/8-sha-apres.txt" | sed 's/^/        /' | head -40
fi

say ""
say "=== bilan VERIF-024 ==="
say "gel=$GEL orphelins_test_node=${ORPHANS:-?} runall_fail=${NF:-?} runall_skip=${NS:-?} npm=${NPM_PASS:-?}/${NPM_FAIL:-?} tsc=$TSC1/$TSC2 a8_rc=$A8_RC a8_rouge=${A8_MUT:-?} a8_vert=${A8_VERT:-?} aco_rc=$ACO_RC aco_selftest=$ACO_ST aco16_rc=$A16_RC aco16_selftest=$A16_ST aco16_validate=$A16_V"

if [ "$GEL" != "OUI" ]; then
  say "CHECK_VERIF024 RESULT=VOID reason=arbre-modifie-pendant-la-mesure"
  exit 1
fi
if [ "${NF:-0}" -ne 0 ] || [ "${A8_MUT:-0}" -ne 5 ] || [ "${NPM_FAIL:-1}" -ne 0 ] || [ "$TSC1" -ne 0 ] || [ "$TSC2" -ne 0 ] || [ "$ACO_FAIL" -ne 0 ] || [ "$ACO_ST" -ne 0 ] || [ "${A16_RC:-1}" -ne 0 ] || [ "${A16_ST:-1}" -ne 0 ] || [ "${A16_V:-1}" -ne 0 ]; then
  say "CHECK_VERIF024 RESULT=FAIL runall_fail=${NF:-?} a8_rouge=${A8_MUT:-?} npm_fail=${NPM_FAIL:-?} tsc=$TSC1/$TSC2 aco_fail=${ACO_FAIL:-?} aco_selftest=$ACO_ST aco16_rc=${A16_RC:-?} aco16_selftest=${A16_ST:-?} aco16_validate=${A16_V:-?}"
  exit 1
fi
say "CHECK_VERIF024 RESULT=PASS gel=oui runall_fail=0 a8_rouge=5 npm_fail=0 tsc=0/0 orphelins=${ORPHANS:-0}"
exit 0
