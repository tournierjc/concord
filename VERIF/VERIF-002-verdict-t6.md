# VERIF-002 — verdict T6 (lecture seule, zéro ré-exécution)

Source : `tail -40` de raw/t6-tests-20261031-0005.log (1744 lignes) + dernier run raw/run-20261031T000519/ (2026-10-31T00:05:19+01:00). Chemins relatifs à /work/lan-voice/VERIF/.

| script | verdict | preuve (chemin:ligne) |
|---|---|---|
| check-engine.sh | PASS files=5 failures=0 warnings=0 | raw/run-20261031T000519/check-engine.log:12 |
| check-no-external.sh | PASS files=38 hits=0 horslan=0 | raw/run-20261031T000519/check-no-external.log:11 |
| check-shell.sh | PASS failures=0 (1 AVERT : style-src 'unsafe-inline' src/main/csp.ts:106) | raw/run-20261031T000519/check-shell.log:12,19 |
| check-labels.sh | PASS locales=2 keys=241 failures=0 | raw/run-20261031T000519/check-labels.log:12 |
| check-deps.sh | PASS failures=0 skips=1 (node_modules absent) | raw/run-20261031T000519/check-deps.log:10,15 |
| node --test, fichier par fichier | FAIL files=10 run=9 pass=7 fail=2 not_run=1 | raw/run-20261031T000519/tests.log:14 |
| node --test, run global T6 | PASS 255 tests / 60 suites / 0 fail | raw/t6-tests-20261031-0005.log:1739-1740 |

Contradiction non résolue : le run global annonce 255/255 pass, le run fichier par fichier annonce 2 fichiers en échec + 1 non exécutable. Les deux chiffres sont cités tels quels ; aucun test n'a été relancé pour arbitrer.

## ÉCHECS (noms exacts)

1. « constantes d'overlay conformes à SPEC-001 et à design/tokens.json » — design/tokens.json introuvable → raw/run-20261031T000519/tests-overlay-geometry.test.ts.log:8
2. « valeurs par défaut conformes aux nombres figés par SPEC-001 » — design/tokens.json introuvable → raw/run-20261031T000519/tests-settings-schema.test.ts.log:8
3. /work/lan-voice/tests/ice-filter.test.ts (not ok 1, non exécutable) — ERR_MODULE_NOT_FOUND : Cannot find package 'vitest' → raw/run-20261031T000519/tests-ice-filter.test.ts.log:5,19

Aucune assertion de logique métier en échec : les 3 échecs sont des artefacts de dépendance de fichier (tokens.json, vitest), pas des régressions du code lan-voice.

À CORRIGER PAR : Carillon (livrer design/tokens.json) | Cadre (rien d'imputé par ces logs) | Banc (tests/ice-filter.test.ts : remplacer vitest par node:test/assert).

Non vérifiés (absents de ce run) : mesure de trafic LAN, latence bout-en-bout, CPU repos/conversation, débit par participant, perte 5 % — aucun log measure-traffic dans raw/run-20261031T000519/.

Aucun fichier de src/ ni tests/ n'a été modifié ; aucun test n'a été relancé.
