#!/bin/sh
# =============================================================================
# check-labels.sh — parité FR/EN des libellés (design/i18n)
# -----------------------------------------------------------------------------
# Pourquoi : un libellé manquant en anglais s'affiche comme une clé brute
# (`chat.mute`) ou comme du français dans l'interface anglaise. Ce contrôle
# compare l'arbre de clés des deux locales, avant toute traduction humaine.
#
# CONTROLES
#   L1  locales FR et EN détectées (sinon SKIP motivé : parité non mesurable)
#   L2  mêmes clés de part et d'autre (écart symétrique vide)
#   L3  aucune valeur vide / blanc / null / non textuelle
#   L4  clés orphelines / usage : combien de clés sont réellement appelées par
#       le code sous la forme t('section.cle'), et lesquelles ne le sont pas.
#       -> INFORMATION, jamais bloquant : un catalogue peut précéder son UI.
#          La parité entre locales reste jugée par L1/L2/L3.
#   L5  (information) clés dont FR et EN sont identiques : suspectes de
#       non-traduction (« OK », « Mute »…), à relire, jamais bloquant.
#
# Sources acceptées (la première trouvée gagne) :
#   design/i18n/*.json      (un fichier par locale : fr.json, en.json, …)
#   design/i18n.json        (un seul fichier, racines `fr` et `en`)
#
# Usage : ./check-labels.sh [RACINE]      RACINE par défaut = dossier parent
# Dépendances : sh, node (intégré). Aucun paquet npm.
# Sortie machine : CHECK_LABELS RESULT=PASS|FAIL|SKIP ...
# =============================================================================

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 2
ROOT=${1:-}
if [ -z "$ROOT" ]; then
  ROOT=$(CDPATH= cd -- "$HERE/.." && pwd) || exit 2
fi
NOW=$(date -Is 2>/dev/null || date)

echo "=== check-labels.sh — $NOW ==="
echo "RACINE   : $ROOT"

SRC=""
if [ -d "$ROOT/design/i18n" ]; then SRC="$ROOT/design/i18n"
elif [ -f "$ROOT/design/i18n.json" ]; then SRC="$ROOT/design/i18n.json"; fi

if [ -z "$SRC" ]; then
  echo ""
  echo "[SKIP] L0  aucun catalogue i18n : ni design/i18n/ ni design/i18n.json"
  echo "       -> parité FR/EN NON vérifiée (ce n'est pas un succès)."
  echo "--- résumé ---"
  echo "locales=0 clés=0 échecs=0 skips=5"
  printf 'CHECK_LABELS RESULT=SKIP locales=0 keys=0 reason=i18n-absent\n'
  exit 0
fi
echo "catalogue: $SRC"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "[SKIP] L0  'node' introuvable : comparaison impossible."
  echo "--- résumé ---"
  echo "locales=0 clés=0 échecs=0 skips=5"
  printf 'CHECK_LABELS RESULT=SKIP locales=0 keys=0 reason=node-absent\n'
  exit 0
fi

NODE_SRC=$(cat <<'NODE_EOF'
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[1];
const DIR = path.join(ROOT, 'design', 'i18n');
const FILE = path.join(ROOT, 'design', 'i18n.json');
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

let locales = {};
let origin = '';

function flatten(obj, prefix, out) {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const key = prefix ? prefix + '.' + k : k;
    if (isObj(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

try {
  if (fs.existsSync(DIR) && fs.statSync(DIR).isDirectory()) {
    origin = DIR;
    for (const f of fs.readdirSync(DIR).sort()) {
      if (!/\.json$/i.test(f)) continue;
      const name = f.replace(/\.json$/i, '');
      const j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
      locales[name] = flatten(isObj(j) && isObj(j[name]) ? j[name] : j, '', {});
    }
  } else if (fs.existsSync(FILE)) {
    origin = FILE;
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    for (const k of Object.keys(j)) if (isObj(j[k])) locales[k] = flatten(j[k], '', {});
  }
} catch (e) {
  console.log('[ECHEC] L0  catalogue i18n illisible : ' + e.message);
  process.exit(1);
}

const names = Object.keys(locales).sort();
if (names.length === 0) {
  console.log('[ECHEC] L0  catalogue trouvé mais aucune locale exploitable dans ' + origin);
  process.exit(1);
}
const nKeys = (l) => Object.keys(locales[l]).length;
console.log('[INFO] L0  catalogue=' + path.relative(ROOT, origin) + ' locales=[' +
            names.map(n => n + ':' + nKeys(n)).join(', ') + ']');

let fails = 0, skips = 0;
const ok = (ctrl, msg) => console.log('[OK]    ' + ctrl + ' ' + msg);
const ko = (ctrl, msg) => { fails++; console.log('[ECHEC] ' + ctrl + ' ' + msg); };
const sk = (ctrl, msg) => { skips++; console.log('[SKIP]  ' + ctrl + ' ' + msg); };

if (!names.includes('fr') || !names.includes('en')) {
  sk('L1', 'FR et EN ne sont pas tous deux présents (locales: ' + names.join(', ') + ') : parité non mesurable');
} else {
  ok('L1', 'locales FR (' + nKeys('fr') + ' clés) et EN (' + nKeys('en') + ' clés) présentes');
}

if (names.length >= 2) {
  const ref = names.includes('fr') ? 'fr' : names[0];
  const refKeys = new Set(Object.keys(locales[ref]));
  let diff = 0;
  const report = [];
  for (const l of names) {
    if (l === ref) continue;
    const ks = new Set(Object.keys(locales[l]));
    const abs = [...refKeys].filter(k => !ks.has(k));
    const sup = [...ks].filter(k => !refKeys.has(k));
    diff += abs.length + sup.length;
    report.push({ l, abs, sup });
  }
  if (diff === 0) {
    ok('L2', 'mêmes ' + refKeys.size + ' clés dans toutes les locales (' + names.join('/') + ')');
  } else {
    ko('L2', 'écart de clés entre ' + names.join('/') + ' : ' + diff + ' écart(s)');
    for (const r of report) {
      for (const k of r.abs.slice(0, 12)) console.log('          ' + ref + ':' + k + '  ABSENT de ' + r.l);
      for (const k of r.sup.slice(0, 12)) console.log('          ' + r.l + ':' + k + '  ABSENT de ' + ref);
      const more = r.abs.length + r.sup.length - 24;
      if (more > 0) console.log('          … et ' + more + ' autre(s) pour ' + r.l);
    }
  }
} else {
  sk('L2', 'une seule locale : comparaison de clés impossible');
}

const empties = [];
for (const l of names) {
  for (const k of Object.keys(locales[l])) {
    const v = locales[l][k];
    if (v === null || v === undefined) empties.push(l + ':' + k + ' (null)');
    else if (typeof v === 'string' && v.trim() === '') empties.push(l + ':' + k + ' (chaîne vide)');
    else if (typeof v !== 'string') empties.push(l + ':' + k + ' (type ' + typeof v + ', attendu string)');
  }
}
if (empties.length === 0) ok('L3', 'aucune valeur vide (null / chaîne vide / blanc)');
else {
  ko('L3', empties.length + ' valeur(s) vide(s) ou non textuelle(s) :');
  for (const e of empties.slice(0, 20)) console.log('          ' + e);
  if (empties.length > 20) console.log('          … et ' + (empties.length - 20) + ' autre(s)');
}

const codeFiles = [];
(function walk(d) {
  if (!fs.existsSync(d)) return;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (/\.(ts|tsx|js|jsx|mjs|cjs|html)$/.test(e.name)) codeFiles.push(p);
  }
})(path.join(ROOT, 'src'));

let corpus = '';
try {
  const idx = path.join(ROOT, 'index.html');
  if (fs.existsSync(idx)) corpus += fs.readFileSync(idx, 'utf8');
} catch (e) { /* ignore */ }
for (const f of codeFiles) {
  try { corpus += fs.readFileSync(f, 'utf8'); } catch (e) { /* ignore */ }
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const refKeys = Object.keys(locales[names.includes('fr') ? 'fr' : names[0]]);
let used = 0;
const orphans = [];
for (const k of refKeys) {
  const leaf = k.split('.').pop();
  const quoted = new RegExp('[\'"`]' + escRe(leaf) + '[\'"`]');
  if (corpus.indexOf(k) >= 0 || quoted.test(corpus)) { used++; continue; }
  orphans.push(k);
}

// L4 = MESURE D'USAGE, non bloquante (et distincte de la parité L2/L3).
// Un catalogue peut légitimement précéder son interface : « clé pas encore
// câblée » est un état d'avancement, pas un défaut de parité. La nommer
// [ECHEC] reviendrait à condamner un renderer à moitié écrit — faux rouge.
// On la rapporte donc en clair, avec le compte exact, pour le pilotage.
const tCallKeys = refKeys.filter(k => new RegExp('\\bt\\(\\s*[\'"]' + escRe(k) + '[\'"]').test(corpus));
const uiDirs = ['src/renderer', 'src/ui', 'src/app'].filter(d => fs.existsSync(path.join(ROOT, d)));
if (tCallKeys.length === 0) {
  console.log('[INFO]  L4  usage : aucune clé appelée via t(\'section.cle\') dans ' + codeFiles.length +
              ' fichier(s) de src/ [couche UI: ' + (uiDirs.join(', ') || 'aucune') + '] — ' +
              'les ' + used + '/' + refKeys.length + ' clés trouvées ne le sont que comme sous-chaîne. ' +
              'Mesure d\'usage non bloquante.');
} else {
  const unwired = refKeys.filter(k => !tCallKeys.includes(k));
  console.log('[INFO]  L4  usage : ' + tCallKeys.length + '/' + refKeys.length + ' clés appelées via t() ; ' +
              unwired.length + ' pas encore câblées côté UI (mesure de pilotage, NON bloquante)' +
              (unwired.length ? ' — ex. : ' + unwired.slice(0, 8).join(', ') + (unwired.length > 8 ? ' …' : '') : ''));
}
if (names.includes('fr') && names.includes('en')) {
  const same = Object.keys(locales.fr).filter(k => locales.en[k] !== undefined && locales.en[k] === locales.fr[k]);
  if (same.length) {
    console.log('[INFO]  L5  ' + same.length + ' clé(s) identiques FR=EN (à relire, ex. OK / Mute) : ' +
                same.slice(0, 10).join(', ') + (same.length > 10 ? ' …' : ''));
  } else {
    console.log('[INFO]  L5  aucune valeur identique FR/EN');
  }
}

console.log('SUMMARY\t' + JSON.stringify({ locales: names.length, keys: refKeys.length, fails, skips }));
NODE_EOF
)

OUT=$(node -e "$NODE_SRC" "$ROOT" 2>&1)
RC=$?
SUM=$(printf '%s\n' "$OUT" | grep '^SUMMARY' | tail -1 | sed 's/^SUMMARY\t//')

if [ -z "$SUM" ]; then
  echo "[ECHEC] L0  l'analyseur node a échoué (code $RC) :"
  printf '%s\n' "$OUT" | sed 's/^/  | /'
  printf 'CHECK_LABELS RESULT=FAIL locales=0 keys=0 reason=analyseur-en-erreur rc=%s\n' "$RC"
  exit 1
fi

printf '%s\n' "$OUT" | grep -v '^SUMMARY'
LOC=$(printf '%s' "$SUM" | sed 's/.*"locales":\([0-9]*\).*/\1/')
KEY=$(printf '%s' "$SUM" | sed 's/.*"keys":\([0-9]*\).*/\1/')
F=$(printf '%s' "$SUM" | sed 's/.*"fails":\([0-9]*\).*/\1/')
S=$(printf '%s' "$SUM" | sed 's/.*"skips":\([0-9]*\).*/\1/')

echo "--- résumé ---"
echo "locales=$LOC clés=$KEY échecs=$F skips=$S"
if [ "$F" -gt 0 ]; then
  printf 'CHECK_LABELS RESULT=FAIL locales=%s keys=%s failures=%s skips=%s\n' "$LOC" "$KEY" "$F" "$S"
  exit 1
fi
printf 'CHECK_LABELS RESULT=PASS locales=%s keys=%s failures=0 skips=%s\n' "$LOC" "$KEY" "$S"
exit 0
