#!/bin/sh
# =============================================================================
# check-aco-018.sh — SPEC-015 rév. 7 (errata AD-26), suite de check-aco-017.sh.
# Delta rév. 6 -> rév. 7 : AC retirés/ajoutés = 0 (ACo-1..ACo-16 inchangés).
# Delta 017 -> 018 : +R21 (vocabulaire de citation), R16 durcie (motif « câblage du relais »),
#   R19 : ACo-10 population=10 a un état légal (EN-ATTENTE-C1C2), 017 conservé tel quel (sha256
#   a3deb7ee…, 2026-10-31T03:2xZ) pour la trace. La page n'est PAS modifiée par ce delta.
#
# Usage :
#   sh check-aco-018.sh                 # état de l'arbre + statuts motivés (aucune mesure)
#   sh check-aco-018.sh --validate F    # valide un journal de recette rév. 7
#   sh check-aco-018.sh --selftest      # prouve que le validateur SAIT rougir
#   ACO_PAGE=/chemin/page sh … --validate F   # surcharge la page (contrôle de citation)
#
# Règles R15..R21 (chacune a un cas illégal dans --selftest) :
#   R15 ACo-9 F2 : valeur != 2000 -> étiquette EXACTE
#       etiquette="non conforme — défaut de valeur, corrigé par une constante (C6, AD-26)"
#       verdict=NON-CONFORME-C6 ; jamais « hors canon »/« arbitrage C6 » (C6 fermé, AD-26 §1),
#       jamais coché vert ni rouge de RENDU (la valeur n'est pas une mesure de rendu).
#   R16 ACo-8 / ACo-9 / ACo-16 : statut « non exécutable jusqu'au câblage du relais » (T23),
#       motif obligatoire = « câblage du relais » (motif de page) ET T23 (identifiant de merge) :
#       T23 seul ne motive plus rien si la numérotation bouge ; « gelé » est un rejet.
#   R17 ACo-16, les deux sens : garde-vie seule 3 s @1 Hz sur état inchangé => rendus=0 => PASS ;
#       re-rendu par message => 3 rendus => ROUGE (verdict=ROUGE). Compte des RENDUS, pas des messages.
#   R18 ACo-14 / ACo-15 : restent « gelé », mais pour une MESURE ; C5 = (a)
#       backgroundThrottling:false, une ligne main/index.ts sur la fenêtre portant la boîte aux
#       lettres ; sorties exigées extinction_ms <= 2000 + 1 trame ET rendus_par_s <= 2 ;
#       repli (b) Timers seulement après un échec nommé. ACo-15 : ni vert ni rouge avant mesure.
#   R19 ACo-1 ne couvre que 1..8, ACo-10 que 8 puis 9 : population 9 ou 10 => « hors couverture »
#       (AD-26 §2, plafond d'affichage 10 déclaré sans élargissement d'AC = lot C1), jamais PASS.
#       ACo-10 population=10 : seul état légal verdict=EN-ATTENTE-C1C2 (l. 969-970 : « La population
#       (ACo-1, ACo-2, ACo-10) attend C1/C2 ») ; un tel AC n'est ni PASS ni clôturé.
#   R20 hors-couverture : les deux tolérances RESTRICTIVES de la note de portée ACo-1/ACo-10
#       (desk-design, 2026-10-31 ; page reste rév. 7, aucun caractère de §5.2 modifié) :
#       (a) population obligatoirement CHIFFRÉE sur la ligne, sinon rejet ;
#       (b) hors-couverture sur une population DANS la couverture = rejet SYMÉTRIQUE (dérobade,
#           pas mesure) : ACo-1 1..8, ACo-10 8 ou 9 -> rejet ; ACo-10 n'a aucun cas
#           hors-couverture légal (10 n'est pas chiffré : géométrie 8/9 seulement, l. 345 + 674) ;
#           ACo-8 / ACo-9 / ACo-16 -> statut attendu non-executable-relais, motif « câblage du
#           relais » (T23), pas hors-couverture.
#   R21 vocabulaire de citation (page relue, jamais « sur parole ») :
#       « hors-couverture » est une VALEUR de champ verdict=, jamais une citation : 0 occurrence
#       dans SPEC-015 (grep -c = 0, exit 1) -> l'attribuer à la page = rejet ;
#       tout champ citation= / dixit= doit être VERBATIM dans la page (grep -F après normalisation
#       des blancs) ; page illisible => RESULT=NOTRUN, jamais PASS (fail-closed).
#
# Dernière ligne : CHECK_ACO018 RESULT=PASS|FAIL|NOTRUN
# =============================================================================
set -u
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
MODE=${1:-etat}
JOURNAL=${2:-}
SAY() { printf '%s\n' "$*"; }

fld() { # fld "<ligne>" <cle>  -> valeur nue (guillemets retirés, valeurs à espaces gérées)
  printf '%s\n' "$1" | awk -v k="$2" '{
    for (i = 1; i <= NF; i++) {
      if (index($i, k "=") == 1) {
        v = substr($i, length(k) + 2)
        if (substr(v, 1, 1) == "\"") {
          v = substr(v, 2)
          for (j = i + 1; j <= NF && substr(v, length(v), 1) != "\""; j++) v = v " " $j
          sub(/"$/, "", v)
        }
        print v; exit
      }
    }
  }'
}

CANON='non conforme — défaut de valeur, corrigé par une constante (C6, AD-26)'

validate() {
  J=$1
  [ -f "$J" ] || { SAY "CHECK_ACO018 RESULT=FAIL reason=journal-absent"; return 1; }
  V=0; CITE_NOTRUN=0
  bad() { SAY "  [REJET] $1"; V=$((V + 1)); }
  # R21 : page de référence pour le contrôle de citation (verbatim). Surchargeable (ACO_PAGE).
  PAGE=${ACO_PAGE:-$HERE/../SPECS/SPEC-015-overlay-population-unie-et-halo.md}
  PAGENORM=
  [ -f "$PAGE" ] && PAGENORM=$(tr '\n' ' ' < "$PAGE" | tr -s ' \t' ' ')
  while IFS= read -r L; do
    case "$L" in ''|\#*) continue ;; esac
    CRIT=$(printf '%s\n' "$L" | awk '{ if ($1=="ACo-9" && ($2=="F1" || $2=="F2")) print $1" "$2; else print $1 }')
    ST=$(fld "$L" statut)

    # ---- R16 : statuts des trois critères non exécutables -------------------
    case "$CRIT" in
      ACo-8|"ACo-9 F1"|"ACo-9 F2"|ACo-16)
        case "$ST" in
          gele|gelé) bad "R16 $CRIT statut=gelé — rév. 7 : « non exécutable jusqu'au câblage du relais (T23) », pas gelé" ;;
          non-executable-relais)
            RSN=$(fld "$L" raison)
            case "$RSN" in
              *T23*) : ;;
              *) bad "R16 $CRIT statut=non-executable-relais sans raison nommant T23 (motif périmé = rejet)" ;;
            esac
            case "$RSN" in
              *"câblage du relais"*|*cablage-du-relais*) : ;;
              *) bad "R16 $CRIT statut=non-executable-relais : motif de page attendu « câblage du relais » (T23 = identifiant de merge, il peut bouger) — raison='$RSN'" ;;
            esac ;;
        esac ;;
    esac

    # ---- R15 : étiquette F2 non conforme ------------------------------------
    case "$CRIT" in
      "ACo-9 F2")
        VV=$(fld "$L" valeur)
        case "$(fld "$L" verdict)" in
          VERT|ROUGE|PASS|FAIL) bad "R15 $CRIT verdict=$(fld "$L" verdict) — F2 est une valeur, pas un rendu : ni vert ni rouge" ;;
        esac
        if [ -n "$VV" ] && [ "$VV" != "2000" ]; then
          case "$L" in
            *"etiquette=\"$CANON\"") : ;;
            *hors\ canon*|*arbitrage\ C6*) bad "R15 $CRIT valeur=$VV : étiquette périmée « hors canon / arbitrage C6 » — C6 est fermé (AD-26 §1)" ;;
            *) bad "R15 $CRIT valeur=$VV : étiquette absente ou non canonique (attendu, en fin de ligne : etiquette=\"$CANON\")" ;;
          esac
          case "$(fld "$L" verdict)" in
            NON-CONFORME-C6) : ;;
            *) bad "R15 $CRIT valeur=$VV verdict='$(fld "$L" verdict)' — attendu NON-CONFORME-C6 (ni vert, ni rouge de rendu)" ;;
          esac
        else
          case "$L" in
            *hors\ canon*|*"défaut de valeur"*)
              bad "R15 $CRIT : étiquette de non-conformité sur une valeur 2000 (faux défaut)" ;;
          esac
        fi ;;
    esac

    # ---- R17 : ACo-16, les deux sens ---------------------------------------
    case "$CRIT" in
      ACo-16)
        case "$ST" in
          PASS|FAIL|ROUGE)
            [ "$(fld "$L" duree_s)" -lt 3 ] 2>/dev/null && bad "R17 ACo-16 duree_s<3 — 3 s à 1 Hz"
            [ "$(fld "$L" garde_vie_hz)" != "1" ] && bad "R17 ACo-16 garde_vie_hz!=1 — 3 messages attendus sur 3 s"
            [ "$(fld "$L" compte)" != "rendus" ] && bad "R17 ACo-16 compte=$(fld "$L" compte) — on compte les rendus, pas les messages"
            R=$(fld "$L" rendus_overlay)
            case "$(fld "$L" variante)" in
              garde-vie-seule)
                case "$R" in ''|*[!0-9]*) bad "R17 ACo-16 rendus_overlay non numérique ($R)" ;;
                  *) [ "$R" -ne 0 ] && bad "R17 ACo-16 garde-vie seule : rendus_overlay=$R, attendu 0 (rendu par message = garde qui dessine)" ;
                     [ "$ST" = "PASS" ] || bad "R17 ACo-16 garde-vie seule avec $R rendu(s) : verdict $ST, attendu PASS" ;;
                esac ;;
              re-rendu-par-message)
                case "$R" in ''|*[!0-9]*) bad "R17 ACo-16 rendus_overlay non numérique ($R)" ;;
                  *) [ "$R" -lt 1 ] && bad "R17 ACo-16 re-rendu par message sans aucun rendu compté — le compteur ne prouve rien" ;;
                esac
                case "$ST" in PASS) bad "R17 ACo-16 re-rendu par message coché PASS — c'est le cas ROUGE attendu" ;; esac ;;
              *) bad "R17 ACo-16 variante='$(fld "$L" variante)' — attendu garde-vie-seule ou re-rendu-par-message" ;;
            esac ;;
        esac ;;
    esac

    # ---- R18 : ACo-14 / ACo-15, gelés pour une mesure -----------------------
    case "$CRIT" in
      ACo-14|ACo-15)
        S=$(fld "$L" statut)
        case "$S" in
          gele|gelé)
            case "$L" in
              *verdict=*) bad "R18 $CRIT : statut gelé ET verdict — un critère gelé ne porte ni vert ni rouge" ;;
            esac ;;
          PASS|FAIL|ROUGE)
            [ "$(fld "$L" repli)" = "Timers" ] && [ -z "$(fld "$L" echec)" ] && \
              bad "R18 $CRIT : repli (b) Timers sans échec nommé — le repli se justifie par une mesure ratée"
            EX=$(fld "$L" extinction_ms)
            if [ -n "$EX" ]; then
              case "$EX" in *[!0-9]*) bad "R18 $CRIT extinction_ms non numérique ($EX)" ;;
                *) [ "$EX" -gt 2016 ] && bad "R18 $CRIT extinction_ms=$EX > 2000+1 trame (2016) fenêtre réduite" ;; esac
            fi
            RPS=$(fld "$L" rendus_par_s)
            if [ -n "$RPS" ]; then
              case "$RPS" in *[!0-9]*) bad "R18 $CRIT rendus_par_s non numérique ($RPS)" ;;
                *) [ "$RPS" -gt 2 ] && bad "R18 $CRIT rendus_par_s=$RPS > 2 : l'overlay redessine au-delà du budget" ;; esac
            fi ;;
          *)
            [ -n "$S" ] && bad "R18 $CRIT statut='$S' — attendu gelé (avant mesure) ou PASS/FAIL mesuré daté" ;;
        esac
        if [ -n "$(fld "$L" c5)" ] || [ -n "$(fld "$L" measure)" ]; then
          case "$(fld "$L" c5)" in
            backgroundThrottling-false) case "$L" in
                *borne=*boite-aux-lettres*|*borne=mailbox*) : ;;
                *) bad "R18 $CRIT C5(a) sans borne=boite-aux-lettres (une ligne main/index.ts sur la fenêtre qui la porte)" ;; esac ;;
            "") bad "R18 $CRIT mesure sans c5= : C5 est arbitré (a), il doit être nommé" ;;
            *) bad "R18 $CRIT c5=$(fld "$L" c5) — C5(a) est backgroundThrottling-false (Timers = repli (b), pas l'option par défaut)" ;;
          esac
        fi ;;
    esac

    # ---- R19 : couverture ACo-1 / ACo-10 vs plafond 10 ----------------------
    POP=$(fld "$L" population)
    [ -z "$POP" ] && POP=$(fld "$L" parole_max)
    case "$CRIT" in
      ACo-1)
        case "$POP" in
          9|10)
            case "$(fld "$L" verdict)" in
              hors-couverture) case "$L" in
                  *AD-26*|*"§2"*) : ;;
                  *) bad "R19 ACo-1 population=$POP hors-couverture sans citation d'AD-26 §2" ;; esac ;;
              *) bad "R19 ACo-1 population=$POP : hors couverture (l'AC ne couvre que 1..8 ; plafond 10 = lot C1) — verdict attendu hors-couverture, jamais PASS" ;;
            esac ;;
        esac ;;
      ACo-10)
        case "$POP" in
          10)
            case "$(fld "$L" verdict)" in
              EN-ATTENTE-C1C2)
                case "$(fld "$L" attente)" in
                  C1/C2) : ;;
                  *) bad "R19 ACo-10 population=10 verdict=EN-ATTENTE-C1C2 sans attente=C1/C2 (l. 969-970 : la population ACo-1/ACo-2/ACo-10 attend C1/C2)" ;;
                esac ;;
              *) bad "R19 ACo-10 population=10 : ACo-10 ne couvre que 8 puis 9 (géométrie chiffrée 8/9 : l. 345, 674) ; 10 attend C1/C2 (l. 969-970) — seul verdict légal EN-ATTENTE-C1C2, jamais PASS ni hors-couverture" ;;
            esac ;;
        esac ;;
    esac

    # ---- R20 : hors-couverture, tolérances restrictives (note de portée 2026-10-31) --
    case "$(fld "$L" verdict)" in
      hors-couverture)
        case "$POP" in
          ''|*[!0-9]*)
            bad "R20 $CRIT verdict=hors-couverture sans population CHIFFRÉE sur la ligne (population='${POP}') — hors-couverture non chiffrée = rejet" ;;
          *)
            case "$CRIT" in
              ACo-1)
                [ "$POP" -ge 9 ] || bad "R20 ACo-1 population=$POP verdict=hors-couverture : 1..8 est DANS la couverture (rejet symétrique — dérobade, pas mesure)" ;;
              ACo-10)
                bad "R20 ACo-10 population=$POP verdict=hors-couverture : ACo-10 couvre 8 et 9 (géométrie chiffrée 8/9 seulement, l. 345 + 674) et 10 attend C1/C2 (l. 969-970) — hors-couverture n'est jamais légal sur cet AC" ;;
              ACo-8|ACo-9*|ACo-16)
                bad "R20 $CRIT verdict=hors-couverture : statut attendu non-executable-relais, motif « câblage du relais » (T23)" ;;
              *) bad "R20 $CRIT verdict=hors-couverture : statut non prévu pour cet AC" ;;
            esac ;;
        esac ;;
    esac

    # ---- R21 : vocabulaire de citation (verbatim ou rejet, page illisible = NOTRUN) ----
    CIT=$(fld "$L" citation)
    [ -z "$CIT" ] && CIT=$(fld "$L" dixit)
    if [ -n "$CIT" ]; then
      case "$CIT" in
        *hors-couverture*)
          bad "R21 $CRIT citation='$CIT' : « hors-couverture » a 0 occurrence dans SPEC-015 (grep -c, exit 1) — c'est une valeur de verdict=, jamais une citation ; motif de page = « câblage du relais » (T23) ou AD-26 §2" ;;
        *R20*)
          bad "R21 $CRIT citation='$CIT' : « R20 » est le nom de MA regle, pas un mot de la page (grep -c 'R20' SPEC-015 => 0, exit 1) — le vocabulaire citable est celui de la page : « cablage du relais », T23, AD-26 §2" ;;
        *)
          if [ -z "$PAGENORM" ]; then
            CITE_NOTRUN=1
          else
            FOUND=$(printf '%s' "$PAGENORM" | awk -v c="$CIT" 'index($0,c)>0{print 1;exit}')
            [ "$FOUND" = "1" ] || bad "R21 $CRIT citation non verbatim : \"$CIT\" absente de $(basename "$PAGE") (grep -F après normalisation des blancs) — une citation se recopie sur la page ou ne s'écrit pas"
          fi ;;
      esac
    fi
  done < "$J"
  if [ "$V" -eq 0 ]; then
    if [ "$CITE_NOTRUN" -eq 1 ]; then
      SAY "CHECK_ACO018 RESULT=NOTRUN violations=0 reason=page-illisible citations-non-verifiees page=$PAGE"
      return 2
    fi
    SAY "CHECK_ACO018 RESULT=PASS violations=0 citations=verifiees page=$(basename "$PAGE")"; return 0
  fi
  SAY "CHECK_ACO018 RESULT=FAIL violations=$V"; return 1
}

selftest() {
  T=$(mktemp -d); OK=0; KO=0
  mk() { printf '%s\n' "$2" > "$T/$1"; }
  mk legal "ACo-8 statut=non-executable-relais raison=cablage-du-relais-T23
ACo-9 F1 statut=non-executable-relais raison=cablage-du-relais-T23
ACo-9 F2 statut=non-executable-relais raison=cablage-du-relais-T23
ACo-16 statut=non-executable-relais raison=cablage-du-relais-T23
ACo-10 population=10 verdict=EN-ATTENTE-C1C2 attente=C1/C2 citation=\"La population (ACo-1, ACo-2, ACo-10) attend C1/C2\"
ACo-14 statut=gele raison=C5-a-a-mesurer
ACo-15 statut=gele raison=C5-a-a-mesurer
ACo-1 population=8 soi_inclus=1 verdict=PASS
ACo-1 population=9 paroleurs=9 verdict=hors-couverture motif=population-9>8 AD-26 §2
ACo-10 population=9 verdict=PASS
ACo-9 F2 valeur=2500 keepalive=1000 t1999=true t2001=true verdict=NON-CONFORME-C6 etiquette=\"non conforme — défaut de valeur, corrigé par une constante (C6, AD-26)\""
  mk m1 "ACo-9 F2 valeur=2500 keepalive=1000 t1999=true t2001=true verdict=hors canon, arbitrage C6"
  mk m3 "ACo-9 F2 valeur=2000 keepalive=1000 t1999=true t2001=false verdict=VERT"
  mk m4 "ACo-8 statut=gele raison=C4"
  mk m5 "ACo-9 F1 statut=non-executable-relais raison=arbre-non-gele"
  mk m6 "ACo-16 statut=PASS variante=garde-vie-seule duree_s=3 garde_vie_hz=1 messages=3 compte=rendus rendus_overlay=3"
  mk m7 "ACo-16 statut=PASS variante=re-rendu-par-message duree_s=3 garde_vie_hz=1 messages=3 compte=rendus rendus_overlay=3"
  mk m8 "ACo-16 statut=PASS variante=garde-vie-seule duree_s=3 garde_vie_hz=1 messages=3 compte=messages rendus_overlay=0"
  mk m9 "ACo-1 population=9 verdict=PASS"
  mk m10 "ACo-1 population=10 verdict=hors-couverture"
  mk m11 "ACo-10 population=10 verdict=PASS"
  mk m12 "ACo-14 statut=gele verdict=PASS"
  mk m13 "ACo-15 statut=PASS fenetre_reduite=1 extinction_ms=2400 rendus_par_s=1 date=2026-10-31T05:00Z"
  mk m14 "ACo-15 statut=PASS fenetre_reduite=1 extinction_ms=2000 rendus_par_s=3 date=2026-10-31T05:00Z"
  mk m15 "ACo-15 statut=PASS repli=Timers extinction_ms=2000 rendus_par_s=1 date=2026-10-31T05:00Z"
  mk m16 "ACo-15 statut=PASS c5=Timers extinction_ms=2000 rendus_par_s=1 date=2026-10-31T05:00Z"
  mk m17 "ACo-9 F2 valeur=2500 keepalive=1000 t1999=true t2001=true verdict=NON-CONFORME-C6 etiquette=\"non conforme — défaut de valeur (C6, AD-26)\""
  mk m18 "ACo-1 verdict=hors-couverture"
  mk m19 "ACo-1 population=8 verdict=hors-couverture AD-26 §2"
  mk m20 "ACo-10 population=9 verdict=hors-couverture AD-26 §2"
  mk m21 "ACo-1 population=neuf verdict=hors-couverture AD-26 §2"
  mk m22 "ACo-16 population=9 statut=non-executable-relais raison=cablage-du-relais-T23 verdict=hors-couverture"
  mk m23 "ACo-1 population=9 verdict=hors-couverture motif=population-9>8 AD-26 §2 citation=\"hors-couverture\""
  mk m24 "ACo-8 statut=non-executable-relais raison=T23"
  mk m25 "ACo-1 population=9 verdict=hors-couverture motif=population-9>8 AD-26 §2 citation=\"population hors-couverture par AD-26 §2\""
  mk m26 "ACo-10 population=10 verdict=EN-ATTENTE-C1C2"
  mk m27 "ACo-10 population=10 verdict=hors-couverture attente=C1/C2"
  for f in legal m1 m3 m4 m5 m6 m7 m8 m9 m10 m11 m12 m13 m14 m15 m16 m17 m18 m19 m20 m21 m22 m23 m24 m25 m26 m27; do
    if validate "$T/$f" >/dev/null 2>&1; then R=accepte; else R=rejete; fi
    if [ "$f" = legal ]; then
      [ "$R" = accepte ] && { OK=$((OK + 1)); SAY "  [OK] journal légal accepté"; } || { KO=$((KO + 1)); SAY "  [KO] journal légal REJETÉ"; }
    else
      [ "$R" = rejete ] && { OK=$((OK + 1)); SAY "  [OK] $f rejeté"; } || { KO=$((KO + 1)); SAY "  [KO] $f ACCEPTÉ (ne sait pas rougir)"; }
    fi
  done
  # R21 fail-closed : page absente => NOTRUN (jamais PASS), citations non vérifiées.
  printf '%s\n' 'ACo-1 population=9 verdict=hors-couverture motif=x AD-26 §2 citation="1..8 participants"' > "$T/np"
  NP=$(ACO_PAGE=/nonexistant sh "$0" --validate "$T/np")
  case "$NP" in
    *"RESULT=NOTRUN"*) { OK=$((OK + 1)); SAY "  [OK] m28 page absente => NOTRUN (pas PASS)"; } ;;
    *) { KO=$((KO + 1)); SAY "  [KO] m28 page absente => $(printf '%s' "$NP" | tail -1)"; } ;;
  esac
  # R21 piege 1 : citation coupee par un retour de ligne (SPEC-015 l. 969/970). Si la
  #   normalisation cesse d'absorber les \n, cette citation devient NOTVERBATIM EN SILENCE.
  printf '%s\n' 'ACo-10 population=10 verdict=EN-ATTENTE-C1C2 attente=C1/C2 citation="La population (ACo-1, ACo-2, ACo-10) attend C1/C2"' > "$T/m29"
  if validate "$T/m29" >/dev/null 2>&1; then OK=$((OK + 1)); SAY "  [OK] m29 citation a cheval sur l. 969/970 acceptee (normalisation absorbe les \\n)"; else KO=$((KO + 1)); SAY "  [KO] m29 citation multi-lignes REJETEE (normalisation ne compacte plus les \\n)"; fi
  # R21 piege 2 : R16 exige les deux jetons dans le champ libre -> la forme verbatim
  #   exacte de la page (l. 791-792, gras + retour de ligne) doit passer telle quelle.
  printf '%s\n' 'ACo-16 statut=non-executable-relais raison=cablage-du-relais-T23 citation="**non exécutables jusqu'"'"'au câblage du relais** (T23)"' > "$T/m30"
  if validate "$T/m30" >/dev/null 2>&1; then OK=$((OK + 1)); SAY "  [OK] m30 forme verbatim R16 (gras + T23) acceptee"; else KO=$((KO + 1)); SAY "  [KO] m30 forme verbatim R16 REJETEE"; fi
  # R21 : « R20 » = nom de ma regle, 0 occurrence dans la page => rejet nomme.
  printf '%s\n' 'ACo-1 population=9 verdict=hors-couverture motif=population-9>8 AD-26 §2 citation="R20.3 : ACo-8, ACo-9, ACo-16"' > "$T/m31"
  if validate "$T/m31" >/dev/null 2>&1; then KO=$((KO + 1)); SAY "  [KO] m31 citation contenant « R20 » ACCEPTEE"; else OK=$((OK + 1)); SAY "  [OK] m31 citation contenant « R20 » rejetee (mot de ma regle, absent de la page)"; fi
  # R21 piege 3 (controle negatif du piege 2) : la forme SANS les deux ** n'existe pas sur la
  #   page (le gras separe « relais » de « (T23) ») => doit etre REJETEE. m30/m32 forment la paire.
  printf '%s\n' 'ACo-16 statut=non-executable-relais raison=cablage-du-relais-T23 citation="non exécutables jusqu'"'"'au câblage du relais (T23)"' > "$T/m32"
  if validate "$T/m32" >/dev/null 2>&1; then KO=$((KO + 1)); SAY "  [KO] m32 forme sans les ** ACCEPTEE (le verbatim ne discrimine plus)"; else OK=$((OK + 1)); SAY "  [OK] m32 forme sans les ** rejetee (verbatim discrimine, paire avec m30)"; fi
  # R19 : ACo-10 population=10 sans attente=C1/C2 est un rejet (m26) ; avec, il est accepté (legal).
  rm -rf "$T"
  [ "$KO" -eq 0 ] && { SAY "CHECK_ACO018 RESULT=PASS selftest=$OK/$OK"; return 0; }
  SAY "CHECK_ACO018 RESULT=FAIL selftest=$OK/$((OK + KO))"; return 1
}

case "$MODE" in
  --selftest) selftest ;;
  --validate) validate "${JOURNAL:?journal attendu}" ;;
  *)
    ROOT=$(CDPATH= cd -- "$HERE/.." 2>/dev/null && pwd || printf '%s' "$HERE/..")
    SAY "=== check-aco-018.sh — SPEC-015 rév. 7 (errata AD-26), T23 : état, aucune mesure ==="
    SAY "RACINE : $ROOT   DATE : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    # Câblage du relais : ce qui rend ACo-8/9/16 exécutables.
    C1=$(grep -c 'speaking-relay' "$ROOT/src/renderer/overlay-entry.tsx" 2>/dev/null || true)
    STALE=$(grep -oE 'SPEAKING_RELAY_STALE_MS[[:space:]]*=[[:space:]]*[0-9]+' "$ROOT/src/renderer/speaking-surface.ts" 2>/dev/null | grep -oE '[0-9]+$' | head -1)
    KA=$(grep -oE 'SPEAKING_KEEPALIVE_MS[[:space:]]*=[[:space:]]*[0-9]+' "$ROOT/src/renderer/speaking-relay.ts" 2>/dev/null | grep -oE '[0-9]+$' | head -1)
    SAY "-- câblage : overlay-entry speaking-relay=$C1  STALE=${STALE:-absent}  KEEPALIVE=${KA:-absent}"
    if [ "${STALE:-0}" = "2000" ]; then
      SAY "   F2 : valeur 2000 conforme (C6 fermé, AD-26 §1). Toute mesure à 2500 se rapporte"
      SAY "        etiquette=\"$CANON\" verdict=NON-CONFORME-C6 — ni vert, ni rouge de rendu."
    else
      SAY "   F2 : constante=${STALE:-absente} != 2000 -> défaut de valeur à rapporter (R15), pas un échec de rendu."
    fi
    # C5 (a) : une ligne main/index.ts sur la fenêtre portant la boîte aux lettres.
    BT=$(grep -n 'backgroundThrottling' "$ROOT/src/main/index.ts" 2>/dev/null | head -3)
    if [ -n "$BT" ]; then
      SAY "-- C5(a) backgroundThrottling : présent main/index.ts -> $(printf '%s' "$BT" | tr '\n' ' ')"
      case "$BT" in *false*) SAY "   c5=backgroundThrottling-false borne=boite-aux-lettres (à confirmer : la fenêtre porte la boîte aux lettres)" ;;
        *) SAY "   [FAIL] backgroundThrottling présent mais pas false : ACo-14/ACo-15 non mesurables" ;; esac
    else
      SAY "-- C5(a) backgroundThrottling : ABSENT de main/index.ts -> ACo-14/ACo-15 restent gelés POUR UNE MESURE (motif : ligne C5(a) non posée)"
    fi
    SAY "  R15 ACo-9 F2 etiquette canonique si valeur!=2000 ; R16 statut non-executable-relais, motif"
    SAY "      « câblage du relais » + T23 ;"
    SAY "  R17 ACo-16 rendus 0 (garde seule) / ROUGE (re-rendu par message) ; R18 ACo-14/15 gelés pour mesure,"
    SAY "      extinction<=2016 ms fenêtre réduite, rendus overlay<=2/s, repli Timers après échec nommé ;"
    SAY "  R19 ACo-1 couvre 1..8, ACo-10 couvre 8 puis 9 : population 9/10 = hors-couverture (AD-26 §2) ;"
    SAY "      ACo-10 population=10 : seul état légal EN-ATTENTE-C1C2 (l. 969-970), jamais PASS."
    SAY "  R20 hors-couverture : population CHIFFRÉE obligatoire sur la ligne (sinon rejet) ; population"
    SAY "      dans la couverture = rejet symétrique (ACo-1 1..8, ACo-10 8/9 : dérobade) ; aucun cas"
    SAY "      hors-couverture légal sur ACo-10 ; ACo-8/9/16 => non-executable-relais, motif « câblage"
    SAY "      du relais » (T23)."
    SAY "  R21 « hors-couverture » = valeur de verdict=, jamais une citation (0 occurrence dans la page) ;"
    SAY "      citation=/dixit= doit être VERBATIM dans SPECS/SPEC-015 (page illisible => NOTRUN)."
    SAY "CHECK_ACO018 RESULT=NOTRUN criteres=8 raison=mode-etat-aucune-mesure ; T23 a atterri (relais cable) : ACo-8/9/16 mesurables, gele=2 (ACo-14, ACo-15, motif C5(a) non pose) ; FAIL=0"
    exit 0 ;;
esac
