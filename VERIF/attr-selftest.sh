#!/bin/sh
# Autotest ciblé de la fonction attribution() de VERIF/measure-traffic.sh
# (extrait le code réel du script, ne le réécrit pas).
# Cas 1 : faux tcpdump citant un chemin …/concord/…  -> ne doit PAS être attribué
# Cas 2 : processus dont l'exécutable s'appelle concord -> doit être attribué
# Cas 3 : processus dont l'exécutable s'appelle electron -> doit être attribué
# Argument = chemin de measure-traffic.sh ; à défaut, celui du même dossier (un
# argument absent donnerait sinon un autotest qui « échoue » sans rien tester).
SCRIPT="${1:-$(dirname "$0")/measure-traffic.sh}"
[ -r "$SCRIPT" ] || { echo "ECHEC: script introuvable: $SCRIPT"; exit 2; }
TMPDIRT=$(mktemp -d)
sed -n '/^attribution()/,/^}/p' "$SCRIPT" > "$TMPDIRT/attr.sh"
say() { echo "$@"; }
log() { :; }
. "$TMPDIRT/attr.sh"

cp /bin/sleep "$TMPDIRT/concord"
cp /bin/sleep "$TMPDIRT/electron"
"$TMPDIRT/concord" 25 &
P1=$!
bash -c 'exec -a "tcpdump -i any -w /home/node/concord/VERIF/raw/mesure.pcap" sleep 25' &
P2=$!
sleep 0.4
echo "=== cas 1+2 (tcpdump-concord pid=$P2, exe=concord pid=$P1)"
attribution > "$TMPDIRT/out1.txt" 2>&1
cat "$TMPDIRT/out1.txt"
grep -q "pid=$P2 " "$TMPDIRT/out1.txt" && echo "ECHEC: tcpdump attribué" || echo "OK: tcpdump non attribué"
grep -q "pid=$P1 " "$TMPDIRT/out1.txt" && echo "OK: exe=concord attribué" || echo "ECHEC: exe=concord non attribué"
kill "$P1" 2>/dev/null; kill "$P2" 2>/dev/null
wait 2>/dev/null
echo "=== cas 3 (exe=electron)"
"$TMPDIRT/electron" 25 &
P3=$!
sleep 0.4
attribution > "$TMPDIRT/out2.txt" 2>&1
grep -q "pid=$P3 " "$TMPDIRT/out2.txt" && echo "OK: exe=electron attribué" || echo "ECHEC: exe=electron non attribué"
kill "$P3" 2>/dev/null
wait 2>/dev/null
rm -rf "$TMPDIRT"
