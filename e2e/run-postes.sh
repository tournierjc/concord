#!/usr/bin/env bash
# Banc deux postes isolés — version sérialisée (flock) + logs par run.
# Usage: RUN_TAG=$i bash e2e/run-postes.sh   (logs: <dir>/host-$RUN_TAG.log, join-$RUN_TAG.log)
# Sans RUN_TAG : host.log / join.log (compat smoke).
set -u
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.."
export HOME=/opt/data/profiles/martin/home
DIR=/opt/data/profiles/banctol/cache/scratch
TAG="${RUN_TAG:-}"
SFX=""; [ -n "$TAG" ] && SFX="-$TAG"
HLOG="$DIR/host$SFX.log"; JLOG="$DIR/join$SFX.log"

# Verrou global : un seul banc à la fois (batches sérialisés, plus de chevauchement).
exec 9>"$DIR/banc.lock"
flock 9

timeout 150 npx tsx e2e/post-runner.mts host > "$HLOG" 2>&1 &
HP=$!
if [ "${SIMULTANE:-0}" = "1" ]; then
  # Mode simultane : le join se lance des que le port du host EST EN LISTEN (pas de sommeil
  # arbitraire). Les deux postes sont en course des leur hello : c'est la que le glare frappe.
  for i in $(seq 1 300); do
    (exec 3<>/dev/tcp/"${LAN_IP:-127.0.0.1}"/"${CONCORD_E2E_PORT:-47821}") 2>/dev/null && { exec 3>&- 3<&-; break; }
    sleep 0.1
  done
else
  sleep 6
fi
timeout 150 npx tsx e2e/post-runner.mts join > "$JLOG" 2>&1 &
JP=$!
wait $JP; JC=$?
# Le host tourne jusqu'à sa fin Naturelle (90 s max) : le tuer à la sortie du client
# tronque son relevé. On l'attend, borné.
for i in $(seq 1 90); do kill -0 $HP 2>/dev/null || break; sleep 1; done
kill $HP 2>/dev/null; wait $HP 2>/dev/null
echo "== JOIN (exit $JC) =="
grep -E "RESULTAT|charge utile non objet|noFlow" "$JLOG" | tail -4
echo "== HOST =="
grep -E "RESULTAT|charge utile non objet|noFlow" "$HLOG" | tail -4
