#!/bin/bash
# Démonstration : le filtre *concord* de VERIF/measure-traffic.sh l.212
# (identique ici) capture-t-il un processus qui n'est PAS l'application ?
# On lance un faux processus dont la ligne de commande ressemble à un tcpdump
# écrivant dans un chèque nommé concord/ (le nom du dépôt après AD-28).
bash -c 'exec -a "tcpdump -i any -w /home/node/concord/VERIF/raw/mesure.pcap" sleep 20' &
FAUX=$!
sleep 0.5
echo "faux processus lancé : pid=$FAUX"
FOUND=0
for d in /proc/[0-9]*; do
  [ -r "$d/cmdline" ] || continue
  cl=$(tr '\0' ' ' < "$d/cmdline" 2>/dev/null)
  case "$cl" in
    *measure-traffic.sh*) continue ;;
  esac
  case "$cl" in
    *electron*|*concord*|*dist/main*)
      echo "  ATTRIBUÉ pid=${d#/proc/} $cl"
      FOUND=$((FOUND + 1)) ;;
  esac
done
echo "FOUND=$FOUND"
kill "$FAUX" 2>/dev/null
wait "$FAUX" 2>/dev/null
