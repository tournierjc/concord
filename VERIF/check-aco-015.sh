#!/bin/sh
# =============================================================================
# check-aco-015.sh — garde des critères d'exécution de SPEC-015 rév. 5 (ACo) pour
# VERIF-024 (T23), RÉVISION 2 : règles d'AD-26 encodées (C6 fermé, C1 lot séparé,
# C5 sous mesure datée). PRÉPARÉ, NON MESURÉ : T23 n'est pas mergé.
#
# Usage :
#   sh VERIF/check-aco-015.sh              # état des surfaces (statique) + règles
#   sh VERIF/check-aco-015.sh --selftest   # prouve que le validateur SAIT rougir
#
# Ce script ne mesure AUCUNE grandeur de rendu : il (a) dit si la surface existe,
# (b) valide la FORME d'un futur journal de mesure ACo. Une surface absente donne
# NOTRUN, jamais PASS (AD-24 §4 : pas de vert sans mesure).
#
# Format de journal attendu (une ligne par fait mesuré, AD-26 oblige) :
#   ACo-6  id=<id> attr=<true|unknown>                                  # jamais false
#   ACo-9  F1 extinction_ms=<n> trames=<n> rendus=<n> reload=0
#   ACo-9  F2 constante=SPEAKING_RELAY_STALE_MS valeur=<n> keepalive=<n> ratio=<n>
#                    t1999=<true|false> t2001=<true|false> [verdict=...]
#   ACo-14 surface=<producteur|relayee> observe_ms=<n>
#   ACo-15 fenetre_reduite=1 producteur_tue=1 rendus_par_s=<n<=2> date=<ISO> verdict=PASS
#   ACo-7  population=10 soi_inclus=1 lot=C1a parole_max=10            # lot C1a seulement
#
# Règles encodées (chacune a un cas illégal dans --selftest) :
#   R1  aucun AC sur un "false" (overlay à deux valeurs)
#   R2  ACo-9 se rapporte en deux fragments F1/F2
#   R3  F1 sans rechargement d'overlay (reload=0)
#   R4  ACo-14 rapporte observe_ms, ne recopie pas 680
#   R5  étiquette « hors canon, arbitrage C6 » = question fermée (AD-26 §1) ;
#       une valeur != 2000 n'est jamais cochée conforme/verte
#   R6  F2 nomme 2000 et ses bornes t0+1999 vrai / t0+2001 faux (cohérence)
#   R7  ACo-15 ne se coche pas sur le drapeau : mesure datée, rendus <= 2/s
#   R8  le plafond 10 (lot C1a) ne se mesure pas contre T23 ni contre un canal à 9
#   R9  seul ACo-2 nomme un id quand il échoue
#
# Dernière ligne : CHECK_ACO015 RESULT=PASS|FAIL|NOTRUN|SKIP
# =============================================================================
set -u

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$HERE/.." && pwd)
say() { printf '%s\n' "$*"; }
num() { printf '%s' "$1" | sed -n 's/.*[^0-9]//p' >/dev/null 2>&1; }

# --- validateur de journal ---------------------------------------------------
# lit stdin, rend 0 si le journal est légal, 1 sinon ; chaque violation nommée.
validate() {
  VIOL=0
  N=0
  while IFS= read -r line; do
    case "$line" in
      ACo-*) N=$((N + 1)) ;;
      *) continue ;;
    esac

    # R1 — aucun AC sur un "false" : l'overlay ne produit que true|unknown.
    case "$line" in
      *attr=false*) say "  [ILLEGAL] R1 ACo-6 : attr=false — non exécutable (jeu légal true|unknown) : $line"; VIOL=$((VIOL + 1)) ;;
    esac

    # R9 — seul ACo-2 nomme un id en échec.
    case "$line" in
      ACo-2*) : ;;
      *verdict=FAIL*id=*) say "  [ILLEGAL] R9 : un échec nomme un id hors ACo-2 : $line"; VIOL=$((VIOL + 1)) ;;
    esac

    # R5 — étiquette périmée : la question C6 est fermée (AD-26 §1).
    case "$line" in
      *"hors canon"*|*"arbitrage C6"*)
        say "  [ILLEGAL] R5 étiquette périmée « hors canon / arbitrage C6 » — C6 est tranché (AD-26) : $line"; VIOL=$((VIOL + 1)) ;;
    esac

    # --- ACo-9 : deux fragments, et leurs formes propres.
    case "$line" in
      ACo-9*)
        case "$line" in
          *" F1 "*|*" F2 "*) : ;;
          *) say "  [ILLEGAL] R2 ACo-9 non fragmenté (F1 autonomie / F2 valeur) : $line"; VIOL=$((VIOL + 1)) ;;
        esac
        # R3 — F1 sans rechargement d'overlay (horloge remise à zéro = faux vert).
        case "$line" in
          *" F1 "*)
            case "$line" in
              *reload=0*) : ;;
              *) say "  [ILLEGAL] R3 ACo-9 F1 sans reload=0 : rechargement = horloge remise à zéro : $line"; VIOL=$((VIOL + 1)) ;;
            esac ;;
        esac
        # R5/R6 — F2 : valeur 2000 nommée, bornes cohérentes, pas de vert à 2500.
        case "$line" in
          *" F2 "*)
            V=$(printf '%s' "$line" | sed -n 's/.*valeur=\([0-9][0-9]*\).*/\1/p')
            T2001=$(printf '%s' "$line" | sed -n 's/.*t2001=\([a-z]*\).*/\1/p')
            case "$line" in
              *t1999=*) : ;;
              *) say "  [ILLEGAL] R6 ACo-9 F2 sans borne t1999= (AD-26 : t0+1999 vrai) : $line"; VIOL=$((VIOL + 1)) ;;
            esac
            case "$line" in
              *t2001=*) : ;;
              *) say "  [ILLEGAL] R6 ACo-9 F2 sans borne t2001= (AD-26 : t0+2001 faux à 2000) : $line"; VIOL=$((VIOL + 1)) ;;
            esac
            case "$line" in
              *constante=SPEAKING_RELAY_STALE_MS*) : ;;
              *) say "  [ILLEGAL] R6 ACo-9 F2 ne nomme pas la constante exportée : $line"; VIOL=$((VIOL + 1)) ;;
            esac
            if [ -n "${V:-}" ] && [ "$V" -eq 2000 ] 2>/dev/null && [ "${T2001:-}" != "false" ]; then
              say "  [ILLEGAL] R6 valeur=2000 annoncée mais borne t2001=${T2001:-absente} (doit être false) : $line"
              VIOL=$((VIOL + 1))
            fi
            if [ -n "${V:-}" ] && [ "$V" -ge 2001 ] 2>/dev/null && [ "${T2001:-}" = "false" ]; then
              say "  [ILLEGAL] R6 valeur=$V mais t2001=false : contradiction : $line"
              VIOL=$((VIOL + 1))
            fi
            if [ -n "${V:-}" ] && [ "$V" -ne 2000 ] 2>/dev/null; then
              case "$line" in
                *"non conforme"*) : ;;   # étiquette AD-26 correcte, acceptée
                *conforme*|*vert*|*PASS*) say "  [ILLEGAL] R5 valeur=$V (canon 2000) cochée conforme/verte : $line"; VIOL=$((VIOL + 1)) ;;
              esac
            fi ;;
        esac ;;
    esac

    # R4 — ACo-14 : valeur observée rapportée, tolérance producteur non recopiée.
    case "$line" in
      ACo-14*)
        case "$line" in
          *observe_ms=*) : ;;
          *) say "  [ILLEGAL] R4 ACo-14 sans observe_ms= : valeur non rapportée : $line"; VIOL=$((VIOL + 1)) ;;
        esac
        case "$line" in
          *attendu_ms=*|*"-eq 680"*) say "  [ILLEGAL] R4 ACo-14 recopie la tolérance producteur (680 ms) : $line"; VIOL=$((VIOL + 1)) ;;
        esac ;;
    esac

    # R7 — ACo-15 : jamais coché sur le drapeau ; mesure datée, rendus <= 2/s.
    case "$line" in
      ACo-15*)
        case "$line" in
          *verdict=PASS*|*vert*)
            case "$line" in
              *fenetre_reduite=1*) : ;;
              *) say "  [ILLEGAL] R7 ACo-15 coché sans fenetre_reduite=1 : $line"; VIOL=$((VIOL + 1)) ;;
            esac
            case "$line" in
              *producteur_tue=1*) : ;;
              *) say "  [ILLEGAL] R7 ACo-15 coché sans producteur_tue=1 : $line"; VIOL=$((VIOL + 1)) ;;
            esac
            case "$line" in
              *date=*) : ;;
              *) say "  [ILLEGAL] R7 ACo-15 coché sans date= : le drapeau posé ne dégèle pas (AD-26 §3) : $line"; VIOL=$((VIOL + 1)) ;;
            esac
            RPS=$(printf '%s' "$line" | sed -n 's/.*rendus_par_s=\([0-9][0-9]*\).*/\1/p')
            case "$line" in
              *rendus_par_s=*) : ;;
              *) say "  [ILLEGAL] R7 ACo-15 coché sans rendus_par_s= : $line"; VIOL=$((VIOL + 1)) ;;
            esac
            if [ -n "${RPS:-}" ] && [ "$RPS" -gt 2 ] 2>/dev/null; then
              say "  [ILLEGAL] R7 ACo-15 rendus_par_s=$RPS > 2 : le drapeau ressuscite un cœur de dessin : $line"
              VIOL=$((VIOL + 1))
            fi ;;
        esac ;;
    esac

    # R8 — le plafond 10 (lot C1a) ne se mesure pas contre T23 ni contre un canal à 9.
    case "$line" in
      *population=10*|*plafond_affichage=10*|*parole_max=*)
        case "$line" in
          *lot=T23*) say "  [ILLEGAL] R8 plafond 10 mesuré contre T23 : le lot C1a n'est pas dans T23 (AD-26 §2) : $line"; VIOL=$((VIOL + 1)) ;;
          *lot=C1a*) : ;;
          *) say "  [ILLEGAL] R8 plafond 10 sans lot=C1a : périmètre non déclaré : $line"; VIOL=$((VIOL + 1)) ;;
        esac
        case "$line" in
          *population=10*)
            case "$line" in
              *parole_max=9*) say "  [ILLEGAL] R8 population=10 contre parole_max=9 : refus en bloc pris pour un défaut d'affichage : $line"; VIOL=$((VIOL + 1)) ;;
            esac ;;
        esac ;;
    esac
  done
  say "  lignes ACo lues : $N   violations : $VIOL"
  [ "$VIOL" -eq 0 ]
}

# --validate : valide un journal ACo fourni sur stdin, en nommant chaque violation.
if [ "${1:-}" = "--validate" ]; then
  say "=== check-aco-015 --validate (journal lu sur stdin) ==="
  if validate; then
    say "CHECK_ACO015_JOURNAL RESULT=LEGAL"
    exit 0
  fi
  say "CHECK_ACO015_JOURNAL RESULT=ILLEGAL"
  exit 1
fi

if [ "${1:-}" = "--selftest" ]; then
  say "=== check-aco-015 --selftest : le validateur rougit-il ? ==="
  BAD=0
  BADN=0
  for case_ in \
    'ACo-6 id=peer-1 attr=false' \
    'ACo-9 extinction_ms=2100 trames=1 rendus=2 reload=0' \
    'ACo-9 F1 extinction_ms=2100 trames=1 rendus=2 reload=1' \
    'ACo-14 surface=relayee attendu_ms=680' \
    'ACo-9 F2 constante=SPEAKING_RELAY_STALE_MS valeur=2500 keepalive=1000 ratio=2.5 t1999=true t2001=true verdict=hors canon, arbitrage C6' \
    'ACo-9 F2 constante=SPEAKING_RELAY_STALE_MS valeur=2500 keepalive=1000 ratio=2.5 t1999=true t2001=true verdict=conforme' \
    'ACo-9 F2 constante=SPEAKING_RELAY_STALE_MS valeur=2000 keepalive=1000 ratio=2' \
    'ACo-9 F2 constante=SPEAKING_RELAY_STALE_MS valeur=2000 keepalive=1000 ratio=2 t1999=true t2001=true' \
    'ACo-15 flag=backgroundThrottling:false verdict=PASS' \
    'ACo-15 fenetre_reduite=1 producteur_tue=1 rendus_par_s=3 date=2026-10-31T05:10Z verdict=PASS' \
    'ACo-7 population=10 soi_inclus=1 lot=T23 parole_max=9' \
    'ACo-9 F1 extinction_ms=3000 trames=3 rendus=1 reload=0 verdict=FAIL id=peer-3'
  do
    BADN=$((BADN + 1))
    say "CAS ILLÉGAL : $case_"
    printf '%s\n' "$case_" | validate >/dev/null 2>&1 && { say "  [ÉCHEC DU CONTRÔLE] le validateur a laissé passer"; BAD=$((BAD + 1)); } || say "  [OK] rejeté"
  done
  say "CAS LÉGAL : journal AD-26 conforme (F2 à 2000 + un relevé 2500 correctement étiqueté)"
  LEGAL='ACo-6 id=peer-1 attr=unknown
ACo-9 F1 extinction_ms=2050 trames=1 rendus=1 reload=0
ACo-9 F2 constante=SPEAKING_RELAY_STALE_MS valeur=2000 keepalive=1000 ratio=2 t1999=true t2001=false
ACo-9 F2 constante=SPEAKING_RELAY_STALE_MS valeur=2500 keepalive=1000 ratio=2.5 t1999=true t2001=true verdict="non conforme, défaut de valeur (C6, AD-26)"
ACo-14 surface=relayee observe_ms=712
ACo-15 fenetre_reduite=1 producteur_tue=1 rendus_par_s=1 date=2026-10-31T05:10Z verdict=PASS
ACo-7 population=10 soi_inclus=1 lot=C1a parole_max=10'
  printf '%s\n' "$LEGAL" | validate >/dev/null 2>&1 || { say "  [ÉCHEC DU CONTRÔLE] journal légal rejeté"; BAD=$((BAD + 1)); }
  say ""
  if [ "$BAD" -eq 0 ]; then
    say "CHECK_ACO015 RESULT=PASS selftest=$BADN/$BADN rejets + 1 journal légal accepté (AD-26)"
    exit 0
  fi
  say "CHECK_ACO015 RESULT=FAIL selftest_manques=$BAD/$BADN"
  exit 1
fi

# --- état des surfaces (statique) -------------------------------------------
say "=== check-aco-015.sh rév. 2 — état des surfaces SPEC-015 rév. 5 (T23) + règles AD-26 ==="
say "RACINE : $ROOT   DATE : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
say ""

NOTRUN=0
FAIL=0

# S1 — ACo-6 : l'attribut d'overlay doit venir d'une fonction à deux valeurs.
SITES=$(grep -c 'peerSpeaking(' "$ROOT/src/renderer/Overlay.tsx" 2>/dev/null || true)
HAS2=$(grep -c 'overlaySpeaking' "$ROOT/src/renderer/participant-state.ts" 2>/dev/null || true)
say "-- ACo-6 (overlay à deux valeurs : true|unknown, jamais false)"
say "   overlaySpeaking exporté (participant-state.ts) : ${HAS2:-0}"
say "   appels peerSpeaking( dans Overlay.tsx          : ${SITES:-0}  (Tri peut rendre false)"
if [ "${HAS2:-0}" -eq 0 ]; then
  say "   [NOTRUN] surface absente (T23 non mergé) : l'overlay lit une table VIDE,"
  say "            donc unknown par vacuité — ACo-13 est le seul état livrable."
  NOTRUN=$((NOTRUN + 1))
elif [ "${SITES:-0}" -ne 0 ]; then
  say "   [FAIL] overlaySpeaking existe mais Overlay.tsx appelle encore peerSpeaking( : false atteignable."
  FAIL=$((FAIL + 1))
else
  say "   [OK] une seule porte à deux valeurs."
fi

# S2 — ACo-9 F2 : la constante et l'inégalité sont statiquement vérifiables.
F2VAL=$(grep -oE 'SPEAKING_RELAY_STALE_MS[[:space:]]*=[[:space:]]*[0-9]+' "$ROOT/src/renderer/speaking-relay.ts" 2>/dev/null | grep -oE '[0-9]+$' | head -1)
KEEP=$(grep -oE 'SPEAKING_KEEPALIVE_MS[[:space:]]*=[[:space:]]*[0-9]+' "$ROOT/src/renderer/speaking-relay.ts" 2>/dev/null | grep -oE '[0-9]+$' | head -1)
say ""
say "-- ACo-9 F2 (valeur) : constante exportée = 2000 nommé (C6 fermé, AD-26 §1) et >= 2 x SPEAKING_KEEPALIVE_MS"
say "   SPEAKING_KEEPALIVE_MS = ${KEEP:-absent}"
if [ -z "${F2VAL:-}" ]; then
  say "   SPEAKING_RELAY_STALE_MS = ABSENTE de src/renderer/speaking-relay.ts"
  say "   [NOTRUN] F2 non exécutable : aucune constante à comparer au canon 2000."
  say "            Un 2500 annoncé hors arbre n'est pas constatable : il se rapportera"
  say "            « F2 non conforme, défaut de valeur (C6, AD-26) », jamais « hors canon »."
  NOTRUN=$((NOTRUN + 1))
elif [ "$F2VAL" -eq 2000 ] && [ -n "${KEEP:-}" ] && [ "$F2VAL" -ge $((2 * KEEP)) ]; then
  say "   SPEAKING_RELAY_STALE_MS = $F2VAL  ($F2VAL >= 2 x $KEEP)  [OK statique]"
  say "   borne attendue : t0+1999 vrai / t0+2001 faux (à mesurer, pas à recopier)"
else
  say "   SPEAKING_RELAY_STALE_MS = $F2VAL  [FAIL] hors canon 2000 ou < 2 x $KEEP"
  say "   étiquette de rapport imposée : « F2 non conforme, défaut de valeur (C6, AD-26) »"
  FAIL=$((FAIL + 1))
fi

# S3 — ACo-9 F1 : comportemental, non mesurable sans producteur tuable.
say ""
say "-- ACo-9 F1 (autonomie) : producteur tué => extinction <= constante + 1 trame, <= 2 rendus/s"
say "   [NOTRUN] aucune mesure : exige le relais vivant (T23) et un producteur tuable."
say "            Protocole écrit (VERIF-024 addendum ACo) : 1 relais, producteur tué à t0,"
say "            journal horodaté du dernier 'true' -> premier 'unknown', reload=0 exigé."
NOTRUN=$((NOTRUN + 1))

# S4 — ACo-14 : forme seulement (valeur observée obligatoire, tolérance non recopiée).
say ""
say "-- ACo-14 (680 ms ± 1 image) : établi sur la table PRODUCTEUR seulement"
say "   [NOTRUN] surface relayée non mesurée. Règle : observe_ms=<n>, jamais 'attendu 680' (E12)."
NOTRUN=$((NOTRUN + 1))

# S5 — C1 (a) : plafond d'affichage 10, lot SÉPARÉ, après T23.
# S5 — C1 (a) : plafond d'affichage 10, lot SÉPARÉ, après T23.
SMAX=$(grep -oE 'SPEAKING_SET_MAX[[:space:]]*=[[:space:]]*[0-9]+' "$ROOT/src/shell/ipc-contract.ts" 2>/dev/null | grep -oE '[0-9]+$' | head -1)
JOINMAX=$(grep -oE 'IPC_MAX_PARTICIPANTS[[:space:]]*=[[:space:]]*[0-9]+' "$ROOT/src/shell/ipc-contract.ts" 2>/dev/null | grep -oE '[0-9]+$' | head -1)
POPMAX=$(grep -oE 'MAX_OVERLAY_PARTICIPANTS[[:space:]]*=[[:space:]]*[0-9]+' "$ROOT/src/shell/overlay-geometry.ts" 2>/dev/null | grep -oE '[0-9]+$' | head -1)
POPFILE=$(grep -lE 'export const MAX_OVERLAY_PARTICIPANTS[[:space:]]*=' "$ROOT/src/shell/"*.ts 2>/dev/null | head -1 | sed "s#^$ROOT/##")
say ""
say "-- C1(a) plafond d'affichage 10 / rejoindre 8 (AD-26 §2, lot C1a — PAS dans T23)"
say "   SPEAKING_SET_MAX (canal de parole, ipc-contract.ts)  = ${SMAX:-absent}"
say "   IPC_MAX_PARTICIPANTS (rejoindre, ipc-contract.ts)    = ${JOINMAX:-absent}"
say "   MAX_OVERLAY_PARTICIPANTS (affichage, ${POPFILE:-absent}) = ${POPMAX:-absent}"
if [ "${POPMAX:-0}" -eq 10 ] && [ "${SMAX:-0}" -eq 10 ]; then
  say "   [OK statique] affichage et parole à 10 : le lot C1a est posé."
else
  say "   [NOTRUN] lot C1a non posé : affichage=$POPMAX déjà à 10, parole=$SMAX encore à 9."
  say "            Interdit de mesurer une population de 10 contre un canal à 9 : tout le"
  say "            payload serait refusé en bloc et le noir passerait pour un défaut d'affichage."
  say "            Journal exige lot=C1a + parole_max=10."
  NOTRUN=$((NOTRUN + 1))
fi

# S5b — invariante qui protège du « refus en bloc » : le canal de parole doit tenir le salon
#       plein PLUS soi. Mesuré le 2026-10-31T03:29:42Z (sandbox/c1a-probe.mts) : 10 ids sur
#       lan:event:speaking-set -> invalid-payload « plus de 9 entrées », ensemble rejeté entier.
say ""
say "-- invariante parole/salon : SPEAKING_SET_MAX >= IPC_MAX_PARTICIPANTS + 1 (soi)"
if [ -n "${JOINMAX:-}" ] && [ -n "${SMAX:-}" ]; then
  if [ "$SMAX" -ge $((JOINMAX + 1)) ]; then
    say "   [OK] $SMAX >= $JOINMAX+1 : un salon plein tient dans le canal de parole."
  else
    say "   [FAIL] $SMAX < $JOINMAX+1 : tout l'ensemble serait rejeté = halo éteint partout"
    say "          (mécanisme mesuré : c1a-probe, 03:29:42Z — refus en bloc, pas troncature)."
    FAIL=$((FAIL + 1))
  fi
else
  say "   [NOTRUN] constante de plafond illisible."
  NOTRUN=$((NOTRUN + 1))
fi

# S6 — C5 : le drapeau ne dégèle rien ; seule une mesure datée dégèle ACo-15.
FLAG=$(grep -c 'backgroundThrottling' "$ROOT/src/main/index.ts" 2>/dev/null || true)
say ""
say '-- C5 / ACo-15 (drapeau backgroundThrottling: false dans src/main/index.ts, AD-26 §3)'
say "   occurrences dans src/main/index.ts : ${FLAG:-0}"
say "   [NOTRUN] ACo-15 gelé dans tous les cas de figure à ce stade, drapeau posé ou non :"
say "            il faut la mesure datée (fenêtre principale réduite + producteur tué,"
say "            rendus_par_s <= 2, date=). Le drapeau seul ne coche rien — R7 le refuse."
NOTRUN=$((NOTRUN + 1))

say ""
say "bilan : NOTRUN=$NOTRUN FAIL=$FAIL  (aucune mesure de rendu produite par ce script)"
if [ "$FAIL" -ne 0 ]; then
  say "CHECK_ACO015 RESULT=FAIL surfaces_en_contradiction=$FAIL"
  exit 1
fi
say "CHECK_ACO015 RESULT=NOTRUN surfaces_absentes=$NOTRUN raison=T23-non-merge (ACo-13 seul état livrable)"
exit 0
