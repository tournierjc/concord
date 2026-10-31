#!/bin/sh
# check-aco-016.sh — SPEC-015 rév. 6 (errata canon AD-25) : ACo-16 + statuts + falsification F1 chiffrée.
# Usage:
#   sh check-aco-016.sh                  -> état de l'arbre (aucun journal) : statuts NOTRUN motivés
#   sh check-aco-016.sh --validate F     -> valide un journal de recette (format ci-dessous)
#   sh check-aco-016.sh --selftest       -> prouve que le validateur sait rougir
#
# Journal = une ligne par critère, champs k=v :
#   ACo-8  statut=non-executable-relais cable=0
#   ACo-9  F1 statut=PASS cable=1 reload=0 extinction_ms=2050 budget_ms=2016 falsification=balayage periode_ms=2000 pire_cas_ms=4000 verdict=ROUGE accepte_balayage=0
#   ACo-9  F2 statut=... constante=SPEAKING_RELAY_STALE_MS valeur=2000 t1999=true t2001=false
#   ACo-16 statut=PASS cable=1 duree_s=3 garde_vie_hz=1 messages=3 compte=rendus methode=MutationObserver rendus_overlay=0 rendus_test=0
#   ACo-14 statut=gele raison=C5-observe_ms=...
#   ACo-15 statut=gele raison=C5
# Règles R10..R14 (rév. 6) — toute violation = rejet, jamais "vert".

set -u
HERE=$(cd "$(dirname "$0")" && pwd)
MODE=${1:-etat}
JOURNAL=${2:-}

field() { printf '%s\n' "$1" | tr ' ' '\n' | grep "^$2=" | tail -1 | cut -d= -f2- ; }

validate() {
  J=$1
  [ -f "$J" ] || { echo "CHECK_ACO016 RESULT=FAIL reason=journal-absent"; return 1; }
  V=0
  bad() { echo "  [REJET] $1"; V=$((V+1)); }
  # --- statuts par critère (R11) --------------------------------------------
  while IFS= read -r L; do
    case "$L" in ''|\#*) continue ;; esac
    CRIT=$(printf '%s\n' "$L" | awk '{c=$1; if ($1=="ACo-9" && ($2=="F1"||$2=="F2")) c=$1" "$2; print c}')
    ST=$(field "$L" statut)
    case "$CRIT" in
      "ACo-8"|"ACo-9"|"ACo-9 F1"|"ACo-9 F2"|"ACo-16")
        [ "$ST" = "gele" ] && bad "$CRIT statut=gele — C4 est tranché (AD-25 D4) : statut attendu « non exécutable jusqu'au câblage du relais », pas « gelé »"
        [ "$ST" = "PASS" ] && [ "$(field "$L" cable)" != "1" ] && bad "$CRIT statut=PASS sans cable=1 — vert par vacuité refusé" ;;
      "ACo-14"|"ACo-15")
        [ "$ST" = "non-executable-relais" ] && bad "$CRIT non-executable-relais — C5 ouvert : statut attendu « gelé »" ;;
    esac
  done < "$J"
  # --- ACo-16 (R10 + R13) ---------------------------------------------------
  G16=$(grep '^ACo-16 ' "$J" || true)
  if [ -n "$G16" ]; then
    ST=$(field "$G16" statut)
    if [ "$ST" = "PASS" ] || [ "$ST" = "FAIL" ]; then
      [ "$(field "$G16" duree_s)" -lt 3 ] 2>/dev/null && bad "ACo-16 duree_s<3 — la fenêtre d'observation doit être de 3 s"
      [ "$(field "$G16" garde_vie_hz)" != "1" ] && bad "ACo-16 garde_vie_hz!=1 — 1 Hz, 3 messages attendus"
      [ "$(field "$G16" messages)" -lt 3 ] 2>/dev/null && bad "ACo-16 messages<3 — garde-vie non prouvée émise"
      [ "$(field "$G16" compte)" != "rendus" ] && bad "ACo-16 compte=$(field "$G16" compte) — on compte les RENDUS, pas les messages IPC"
      case "$(field "$G16" methode)" in *MutationObserver*) : ;; *) bad "ACo-16 methode sans MutationObserver — ne prouve pas un comptage de rendus" ;; esac
      RO=$(field "$G16" rendus_overlay); RT=$(field "$G16" rendus_test)
      [ -z "$RO" ] && bad "ACo-16 rendus_overlay absent"
      [ -z "$RT" ] && bad "ACo-16 rendus_test absent — un rendu provoqué par le test se compte à part et se déclare"
      case "$RO" in ''|*[!0-9]*) bad "ACo-16 rendus_overlay non numérique" ;; *) [ "$RO" -ge 1 ] && bad "ACo-16 rendus_overlay=$RO — un seul rendu imputable à la garde-vie suffit à faire échouer" ;; esac
    fi
  fi
  # --- F1 falsification chiffrée (R12) --------------------------------------
  GF=$(grep '^ACo-9 *F1 ' "$J" || true)
  [ -z "$GF" ] && GF=$(grep '^ACo-9 F1 ' "$J" || true)
  if [ -n "$GF" ]; then
    P=$(field "$GF" periode_ms); W=$(field "$GF" pire_cas_ms); PR=$(field "$GF" pire_cas_attendu_ms)
    [ "$(field "$GF" falsification)" != "balayage" ] && bad "ACo-9 F1 sans falsification=balayage — la falsification doit être chiffrée"
    [ "$(field "$GF" accepte_balayage)" = "1" ] && bad "ACo-9 F1 accepte_balayage=1 — un balayage à 2000 ms contredit ACo-9 (pire cas 4000 ms) ; §4.3 pt3 le supprime"
    [ -n "$P" ] && [ -n "$W" ] && [ "$P" -gt 0 ] 2>/dev/null && {
      ATT=$((P*2))
      [ "$W" != "$ATT" ] && bad "ACo-9 F1 pire_cas_ms=$W != 2*periode=$ATT — falsification mal chiffrée (échéancier remplacé par un balayage ⇒ extinction au pire à F+P)"
      [ "$W" -le 2000 ] 2>/dev/null && bad "ACo-9 F1 pire_cas_ms=$W ≤ 2000 — un balayage est censé DÉPASSER le budget, sinon il n'y a pas falsification"
    }
    [ "$(field "$GF" verdict)" != "ROUGE" ] && bad "ACo-9 F1 verdict!=ROUGE — la falsification au balayage doit faire rougir F1"
  fi
  if [ "$V" -eq 0 ]; then echo "CHECK_ACO016 RESULT=PASS violations=0"; return 0; fi
  echo "CHECK_ACO016 RESULT=FAIL violations=$V"; return 1
}

selftest() {
  T=$(mktemp -d); OK=0; KO=0
  mk() { printf '%s\n' "$2" > "$T/$1"; }
  mk legal "ACo-8 statut=non-executable-relais cable=0
ACo-9 F1 statut=PASS cable=1 reload=0 extinction_ms=2050 budget_ms=2016 falsification=balayage periode_ms=2000 pire_cas_ms=4000 verdict=ROUGE accepte_balayage=0
ACo-16 statut=PASS cable=1 duree_s=3 garde_vie_hz=1 messages=3 compte=rendus methode=MutationObserver rendus_overlay=0 rendus_test=1
ACo-14 statut=gele raison=C5-observe_ms-non-etabli
ACo-15 statut=gele raison=C5"
  mk i1 "ACo-16 statut=FAIL cable=1 duree_s=3 garde_vie_hz=1 messages=3 compte=rendus methode=MutationObserver rendus_overlay=3 rendus_test=1"
  mk i2 "ACo-16 statut=FAIL cable=1 duree_s=3 garde_vie_hz=1 messages=3 compte=messages methode=MutationObserver rendus_overlay=0 rendus_test=1"
  mk i3 "ACo-9 statut=gele cable=0"
  mk i4 "ACo-16 statut=PASS cable=1 duree_s=3 garde_vie_hz=1 messages=3 compte=rendus methode=MutationObserver rendus_overlay=0"
  mk i5 "ACo-9 F1 statut=PASS cable=1 reload=0 extinction_ms=2100 budget_ms=2016 falsification=balayage periode_ms=2000 pire_cas_ms=4000"
  mk i6 "ACo-9 F1 statut=PASS cable=1 reload=0 falsification=balayage periode_ms=2000 pire_cas_ms=4000 verdict=ROUGE accepte_balayage=1"
  mk i7 "ACo-9 F1 statut=PASS cable=1 reload=0 falsification=balayage periode_ms=2000 pire_cas_ms=2000 verdict=VERT accepte_balayage=0"
  mk i8 "ACo-15 statut=non-executable-relais cable=0"
  mk i9 "ACo-16 statut=PASS cable=1 duree_s=1 garde_vie_hz=1 messages=3 compte=rendus methode=capture-ipc rendus_overlay=0 rendus_test=0"
  for f in legal i1 i2 i3 i4 i5 i6 i7 i8 i9; do
    if validate "$T/$f" >/dev/null 2>&1; then R=accepte; else R=rejete; fi
    case "$f" in
      legal) [ "$R" = accepte ] && { OK=$((OK+1)); echo "  [OK] journal légal accepté"; } || { KO=$((KO+1)); echo "  [KO] journal légal REJETÉ"; } ;;
      *) [ "$R" = rejete ] && { OK=$((OK+1)); echo "  [OK] $f rejeté"; } || { KO=$((KO+1)); echo "  [KO] $f ACCEPTÉ (le validateur ne sait pas rougir)"; } ;;
    esac
  done
  rm -rf "$T"
  [ "$KO" -eq 0 ] && { echo "CHECK_ACO016 RESULT=PASS selftest=$OK/$OK"; return 0; }
  echo "CHECK_ACO016 RESULT=FAIL selftest=$OK/$((OK+KO))"; return 1
}

case "$MODE" in
  --selftest) selftest ;;
  --validate) validate "${JOURNAL:?journal attendu}" ;;
  *)
    echo "  R10 ACo-16 : compte les RENDUS (MutationObserver), rendus_overlay doit valoir 0, rendus_test déclaré à part."
    echo "  R11 statuts : ACo-8/ACo-9/ACo-16 « non exécutable jusqu'au câblage du relais » (C4 tranché) ; ACo-14/ACo-15 « gelé » (C5 ouvert)."
    echo "  R12 F1 : falsification=balayage, pire_cas_ms = 2 x periode_ms = 4000, verdict=ROUGE, accepte_balayage=0."
    echo "  R13 attribution : un rendu dû au test se compte à part (rendus_test) et ne peut pas être noyé dans rendus_overlay=0."
    echo "  R14 'gelé' sur ACo-8/9/16 et 'non exécutable' sur ACo-14/15 sont des rejets, pas des statuts."
    echo "CHECK_ACO016 RESULT=NOTRUN surfaces=3 (ACo-8, ACo-9 F1/F2, ACo-16) raison=arbre-non-gele (cablage present : speaking-surface.ts, stale=2000) ; gele=2 (ACo-14, ACo-15) ; FAIL=0"
    echo "  note AD-26 : C6 est TRANCHÉ à 2000 par AD-26 (R6 de check-aco-015.sh) — la mention « C6 non tranché » de SPEC-015 rév. 6 est antérieure à AD-26."
    exit 0 ;;
esac
