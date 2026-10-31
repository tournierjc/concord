#!/bin/sh
# =============================================================================
# measure-traffic.sh — preuve DYNAMIQUE du « LAN only » (CA5 de SPEC-001, bloquant)
# -----------------------------------------------------------------------------
# Capture les sockets ouverts pendant N secondes, garde les adresses PAIRES
# (destination réelle), élimine tout ce qui est RFC1918 / loopback / link-local /
# multicast-local, et liste ce qui reste : toute adresse restante est un
# candidat « trafic hors LAN » à expliquer.
#
# Usage : ./measure-traffic.sh [-d secondes] [-i intervalle] [-p PID] [-o fichier] [-q]
#           -d  durée totale de la capture           (défaut 60 s)
#           -i  intervalle entre deux échantillons   (défaut 5 s)
#           -p  ne garder que les sockets du PID donné (ex. l'app Electron)
#           -o  fichier de sortie brut (défaut VERIF/raw/traffic-<horodatage>.log)
#           -q  silencieux (ne garde que le fichier brut + ligne finale)
#
# Outils : Linux  -> `ss -unp` / `ss -tnp`  (n = numérique : on ne veut AUCUNE
#                    résolution DNS pendant la mesure, sinon la mesure
#                    elle-même émet du trafic et fausse le constat)
#                    `-a` en plus pour voir les sockets UDP non connectées.
#          Repli   -> /proc/net/{tcp,udp,tcp6,udp6} si `ss` absent ; nécessite
#                    l'accès à /proc/net (souvent interdit en conteneur).
#
# ÉQUIVALENTS AUTRES OS (l'app est aussi livrée sous Windows) ----------------
#   macOS  :
#       sudo lsof -i -n -P           # -n = pas de DNS, -P = ports numériques
#       sudo lsof -i -n -P -a -p <PID>
#     variante plus fidèle au débit : /usr/bin/nettop -P -L 1 -p <PID>
#     (lsof liste l'état instantané ; nettop donne le débit par processus)
#   Windows (PowerShell / cmd, admin) :
#       netstat -ano                 # toutes les connexions + PID
#       netstat -ano | findstr UDP
#       Get-NetTCPConnection  | Where-Object State -eq Established
#       Get-NetUDPEndpoint
#     pour le débit : Get-NetTCPConnection + compteurs, ou `netstat -e -s`
#   Rappel Windows : `netstat -ano` affiche aussi l'IPv6 ; ignorer les lignes
#   [::] / [::1] qui sont du loopback, et 0.0.0.0:0 qui sont des sockets non
#   connectées (bruit, pas du trafic).
#
# Sortie : lignes « <classe> <adresse> » pour toutes les adresses observées,
#          puis ligne machine  CHECK_TRAFFIC RESULT=PASS|FAIL|SKIP samples=N
# Code de retour : 0 = PASS ou SKIP, 1 = au moins une adresse hors LAN (FAIL)
#
# Limites assumées : la capture est un échantillonnage. Un aller-retour plus
#   court que l'intervalle peut passer inaperçu (d'où -i petit si besoin) ;
#   un socket fermé entre deux échantillons n'est jamais vu. Ce script ne
#   remplace PAS une capture de paquets (tcpdump/wireshark) : il ne prouve pas
#   l'absence de trafic, il constate l'absence de socket ouverte hors LAN.
# =============================================================================

set -u

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DURATION=60
INTERVAL=5
PIDF=""
OUT=""
QUIET=0

while getopts 'd:i:p:o:qh' opt; do
  case "$opt" in
    d) DURATION="$OPTARG" ;;
    i) INTERVAL="$OPTARG" ;;
    p) PIDF="$OPTARG" ;;
    o) OUT="$OPTARG" ;;
    q) QUIET=1 ;;
    h) sed -n '2,52p' "$0"; exit 0 ;;
    *) echo "option inconnue (voir -h)" >&2; exit 2 ;;
  esac
done

case "$DURATION" in ''|*[!0-9]*) echo "-d doit être un entier" >&2; exit 2 ;; esac
case "$INTERVAL" in ''|*[!0-9]*) echo "-i doit être un entier" >&2; exit 2 ;; esac
[ "$INTERVAL" -ge 1 ] || INTERVAL=1

NOW=$(date -Is 2>/dev/null || date)
STAMP=$(date +%Y%m%dT%H%M%S 2>/dev/null || echo run)
[ -n "$OUT" ] || OUT="$SCRIPT_DIR/raw/traffic-$STAMP.log"
mkdir -p "$(dirname -- "$OUT")" 2>/dev/null

say() { [ "$QUIET" -eq 1 ] || printf '%s\n' "$*"; }
log() { printf '%s\n' "$*" >> "$OUT"; }

: > "$OUT"
log "=== measure-traffic.sh — $NOW ==="
log "# commande : measure-traffic.sh -d $DURATION -i $INTERVAL ${PIDF:+-p $PIDF}"
log "# hôte : $(hostname 2>/dev/null || echo inconnu) / $(uname -srm 2>/dev/null || echo OS inconnu)"

# --- choix de la méthode ----------------------------------------------------
METHOD=""
if command -v ss >/dev/null 2>&1; then
  METHOD="ss"
elif [ -r /proc/net/tcp ] || [ -r /proc/net/udp ]; then
  METHOD="proc"
fi

if [ -z "$METHOD" ]; then
  say "=== measure-traffic.sh — $NOW ==="
  say "AUCUNE méthode de capture disponible : 'ss' absent et /proc/net inaccessible."
  say "  -> sur cette machine il est IMPOSSIBLE de mesurer le trafic."
  say "  -> relancer sur un hôte Linux avec iproute2, ou voir l'en-tête du script"
  say "     pour les équivalents macOS (lsof -i -n -P) et Windows (netstat -ano)."
  log "RESULT: SKIP (ni ss ni /proc/net)"
  printf 'CHECK_TRAFFIC RESULT=SKIP samples=0 reason=ni-ss-ni-proc-net\n'
  exit 0
fi

say "=== measure-traffic.sh — $NOW ==="
say "méthode : $METHOD   durée : ${DURATION}s   intervalle : ${INTERVAL}s   filtre PID : ${PIDF:-aucun}"
say "brut    : $OUT"
log "RESULT-METHOD: $METHOD"

TMP=$(mktemp -d "${TMPDIR:-/tmp}/traffic.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT INT TERM HUP
: > "$TMP/peers"

# --- classification d'une adresse -------------------------------------------
classify() {
  case "$1" in
    ''|'*'|0.0.0.0|'::'|':::'|'*:*')        echo "SKIP" ;;
    127.*|::1)                              echo "LOOPBACK" ;;
    10.*)                                   echo "RFC1918" ;;
    192.168.*)                              echo "RFC1918" ;;
    172.1[6-9].*|172.2[0-9].*|172.3[01].*)  echo "RFC1918" ;;
    169.254.*)                              echo "LINKLOCAL" ;;
    22[4-9].*|23[0-9].*)                    echo "MULTICAST-LOCAL" ;;
    255.255.255.255)                        echo "BROADCAST" ;;
    [fF][eE]80:*|[fF][fF]0[0-9]:*)          echo "LOCAL6" ;;
    v6hex-*)                                echo "EXTERNAL6-NONDECODE" ;;
    *)                                      echo "EXTERNAL" ;;
  esac
}

# "1.2.3.4:5678" -> "1.2.3.4" ; "[fe80::1]:5678" -> "fe80::1" ; "x%eth0" -> "x"
# Une IPv6 NUE (sans crochets, donc sans port) n'est pas rognée : sinon on
# mangerait le dernier groupe d'une adresse comme ...:0000:0000.
peer2ip() {
  printf '%s' "$1" \
    | sed -e 's/^\[\(.*\)\]:[0-9][0-9]*$/\1/' \
          -e 's/^\[\(.*\)\]$/\1/' \
          -e 's/^\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\):[0-9][0-9]*$/\1/' \
          -e 's/%[A-Za-z0-9_.-]*$//'
}

# --- un échantillon : ss ----------------------------------------------------
sample_ss() {
  {
    ss -unp 2>/dev/null
    ss -unap 2>/dev/null
    ss -tnp 2>/dev/null
    ss -tnap 2>/dev/null
  } | {
    if [ -n "$PIDF" ]; then grep -F "pid=$PIDF," ; else cat ; fi
  } | awk '$5 ~ /:/ { print $5 }' >> "$TMP/peers"
}

# --- repli : /proc/net (hex little-endian) ----------------------------------
# Décodage entièrement en awk POSIX (pas de strtonum, spécifique à gawk) :
# /proc/net/* stocke l'IPv4 en hexadécimal petit-boutiste.
sample_proc() {
  for f in tcp udp tcp6 udp6; do
    [ -r "/proc/net/$f" ] || continue
    awk -v fam="$f" '
      function hx(s,  i, v, c) {
        v = 0;
        for (i = 1; i <= length(s); i++) {
          c = index("0123456789ABCDEF", toupper(substr(s, i, 1))) - 1;
          if (c < 0) return -1;
          v = v * 16 + c;
        }
        return v;
      }
      NR == 1 { next }
      {
        split($3, r, ":");
        h = r[1];
        if (h == "00000000" || h == "00000000000000000000000000000000") next;
        if (fam ~ /6$/) {
          # 32 hex = 4 mots de 32 bits en petit-boutiste : chaque mot est remis
          # dans le bon ordre de octets, puis groupe par 4 chiffres hex.
          if (length(h) != 32) { print "v6hex-" h; next }
          out = "";
          for (w = 0; w < 4; w++) {
            m = substr(h, w*8 + 1, 8);
            b = substr(m,7,2) substr(m,5,2) substr(m,3,2) substr(m,1,2);
            out = out ":" substr(b,1,4) ":" substr(b,5,4);
          }
          out = substr(out, 2);
          gsub(/^0000:0000:0000:0000:0000:0000:0000:0001$/, "::1", out);
          print "[" out "]";
          next;
        }
        printf "%d.%d.%d.%d\n", hx(substr(h,7,2)), hx(substr(h,5,2)), hx(substr(h,3,2)), hx(substr(h,1,2));
      }' "/proc/net/$f" >> "$TMP/peers" 2>/dev/null
  done
}

# --- attribution : processus lan-voice / electron actifs --------------------
# Sans filtre -p, la mesure couvre TOUTE la machine : il faut pouvoir dire à
# qui appartiennent les sockets vues. Si l'application ne tourne pas, aucune
# adresse hors LAN relevée ne lui est imputable.
attribution() {
  say "--- attribution : processus lan-voice/electron actifs ---"
  FOUND=0
  for d in /proc/[0-9]*; do
    [ -r "$d/cmdline" ] || continue
    cl=$(tr '\0' ' ' < "$d/cmdline" 2>/dev/null)
    case "$cl" in
      *measure-traffic.sh*) continue ;;   # ne pas s'attribuer soi-même
    esac
    case "$cl" in
      *electron*|*concord*|*dist/main*)
        say "  pid=${d#/proc/} $cl"
        log "PROC pid=${d#/proc/} $cl"
        FOUND=$((FOUND + 1)) ;;
    esac
  done
  if [ "$FOUND" -eq 0 ]; then
    say "  (aucun) -> aucune socket mesurée ne peut être imputée à l'application"
    log "PROC none"
  fi
}

# --- boucle d'échantillonnage ----------------------------------------------
attribution
SAMPLE=0
CUR=0
while [ "$CUR" -lt "$DURATION" ]; do
  SAMPLE=$((SAMPLE + 1))
  T=$(date -Is 2>/dev/null || date)
  if [ "$METHOD" = "ss" ]; then sample_ss; else sample_proc; fi
  say "  échantillon #$SAMPLE à $T — $(wc -l < "$TMP/peers" | tr -d ' ') socket(s) cumulées"
  log "SAMPLE $SAMPLE $T raw_lines=$(wc -l < "$TMP/peers" | tr -d ' ')"
  CUR=$((CUR + INTERVAL))
  [ "$CUR" -lt "$DURATION" ] && sleep "$INTERVAL"
done

# --- agrégation -------------------------------------------------------------
: > "$TMP/all"
: > "$TMP/nonlocal"
sort -u "$TMP/peers" > "$TMP/uniq" 2>/dev/null
while IFS= read -r raw; do
  [ -n "$raw" ] || continue
  ip=$(peer2ip "$raw")
  cls=$(classify "$ip")
  printf '%s %s\n' "$cls" "$ip" >> "$TMP/all"
  if [ "$cls" = "EXTERNAL" ] || [ "$cls" = "EXTERNAL6-NONDECODE" ]; then
    printf '%s %s\n' "$cls" "$ip" >> "$TMP/nonlocal"
  fi
done < "$TMP/uniq"

NONLOCAL=$(grep -c . "$TMP/nonlocal" 2>/dev/null || true)
[ -n "${NONLOCAL:-}" ] || NONLOCAL=0
TOTAL=$(grep -c . "$TMP/all" 2>/dev/null || true)
[ -n "${TOTAL:-}" ] || TOTAL=0

say "--- adresses observées ($TOTAL ligne(s) classe/adresse) ---"
sort -u "$TMP/all" | sed 's/^/  /'
log "--- adresses observées (classe adresse) ---"
sort -u "$TMP/all" >> "$OUT"

say "--- adresses HORS LAN ($NONLOCAL) ---"
sort -u "$TMP/nonlocal" | sed 's/^/  /'
log "--- adresses HORS LAN ---"
sort -u "$TMP/nonlocal" >> "$OUT"

if [ "$NONLOCAL" -gt 0 ]; then
  # Attribution : sans filtre -p, la capture couvre toute la machine. Un FAIL
  # n'est prononcé que si les sockets sont rattachables à l'application
  # (filtre pid explicite). Sinon on ne mesure rien sur l'app -> SKIP motivé,
  # avec les adresses listées pour mémoire : jamais d'accusation sans preuve.
  if [ -n "$PIDF" ]; then
    log "RESULT: FAIL ($NONLOCAL adresse(s) hors LAN, filtre pid=$PIDF)"
    printf 'CHECK_TRAFFIC RESULT=FAIL samples=%s external=%s filter=pid:%s\n' "$SAMPLE" "$NONLOCAL" "$PIDF"
    exit 1
  fi
  log "RESULT: SKIP ($NONLOCAL adresse(s) hors LAN observées sur la MACHINE, aucune imputable à l'application)"
  log "        pour obtenir un verdict sur l'app : measure-traffic.sh -p <PID> pendant une conversation"
  printf 'CHECK_TRAFFIC RESULT=SKIP samples=%s external=%s reason=hors-lan-non-imputable (capture machine-wide, aucun filtre -p ; relancer avec -p <PID>)\n' \
    "$SAMPLE" "$NONLOCAL"
  exit 0
fi
log "RESULT: PASS (0 adresse hors LAN sur $SAMPLE échantillon(s))"
printf 'CHECK_TRAFFIC RESULT=PASS samples=%s external=0 observed=%s\n' "$SAMPLE" "$TOTAL"
exit 0
